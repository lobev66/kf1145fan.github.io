import { Hono } from "hono";
import type { Env, UserInfo, Variables } from "./waline/env.js";
import walineApp from "./waline/subapp.js";
import { auth } from "./waline/middleware/auth.js";
import { unzipSync } from "fflate";
import { renderAdminPage } from "./admin-ui.js";
import { renderAdminLoginPage } from "./admin-login.js";
import { sendMail } from "./mail/smtp.js";

// 整合后的完整 Bindings：博客文章(gh + D1 评论) + Waline(JWT/D1)
type Bindings = Env & {
  DB: D1Database;
  JWT_SECRET?: string;
  SITE_URL?: string;
  // 文章发布
  GH_TOKEN?: string;
  GH_REPO?: string;
  GH_BRANCH?: string;
  POSTS_DIR?: string;
  PAGES_URL?: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// ---------- 0. 配置兜底：减少部署时的手动填写 ----------
// SITE_URL（对外域名）：未显式配置时，自动取当前请求的域名。
// 因此绑定自定义域名 / Workers 自带域名后，无需再手动配置该项（邮件里的链接也会用该域名）。
app.use("*", async (c, next) => {
  const env = c.env as Bindings;
  if (!env.SITE_URL) {
    try {
      (env as { SITE_URL?: string }).SITE_URL = new URL(c.req.url).origin;
    } catch {
      /* ignore */
    }
  }
  await next();
});

// PAGES_URL（GitHub Pages 地址）：未配置时按 GH_REPO 推导，形如 https://<owner>.github.io[/repo]
function pagesBaseUrl(env: Bindings): string {
  const raw = (env.PAGES_URL || "").trim();
  if (raw) return raw.replace(/\/+$/, "");
  const m = /^([^/\s]+)\/([^/\s]+)$/.exec((env.GH_REPO || "").trim());
  if (m) {
    const owner = m[1];
    const name = m[2];
    return name.toLowerCase() === owner.toLowerCase() + ".github.io"
      ? `https://${owner}.github.io`
      : `https://${owner}.github.io/${name}`;
  }
  return "https://kf1145fan.github.io";
}

// ---------- 1. 统一鉴权（复用 Waline 管理员 JWT）----------
function isAdmin(user?: UserInfo): boolean {
  return !!user && user.type === "administrator";
}

// ---------- 2. Waline 评论系统挂载到 /waline/* ----------
// 主题中 serverURL 设为 blog.902786.xyz/waline，客户端会自动拼接 /api/xxx
app.route("/waline", walineApp);

// ---------- 3. 健康检查 ----------
app.get("/api/health", async (c) => {
  const env = c.env as Bindings;
  const jwtSet = !!env.JWT_SECRET;
  return json({
    ok: true,
    worker: "blog-worker",
    waline: true,
    ver: "1.0.0",
    jwt_set: jwtSet,
    gh_token_set: !!env.GH_TOKEN,
  });
});

// ---------- 3.1 站点初始化状态（首次部署时引导创建管理员）----------
// 无任何用户时返回 needInit=true，登录页据此自动切换到「创建管理员」表单。
app.get("/api/site/init", async (c) => {
  const db = (c.env as Bindings).DB;
  try {
    // 自愈：全新环境下 D1 迁移可能未执行，先确保用户表存在（否则注册也会失败）
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS "wl_Users" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT,
          "display_name" TEXT NOT NULL DEFAULT '',
          "email" TEXT NOT NULL DEFAULT '',
          "password" TEXT NOT NULL DEFAULT '',
          "type" TEXT NOT NULL DEFAULT 'guest',
          "label" TEXT DEFAULT '',
          "url" TEXT DEFAULT '',
          "avatar" TEXT DEFAULT '',
          "github" TEXT DEFAULT '',
          "twitter" TEXT DEFAULT '',
          "facebook" TEXT DEFAULT '',
          "google" TEXT DEFAULT '',
          "weibo" TEXT DEFAULT '',
          "qq" TEXT DEFAULT '',
          "2fa" TEXT DEFAULT '',
          "createdAt" TEXT DEFAULT (datetime('now')),
          "updatedAt" TEXT DEFAULT (datetime('now'))
        )`
      )
      .run();
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_email" ON "wl_Users" ("email")`
      )
      .run();
    const row = await db
      .prepare(`SELECT COUNT(*) AS count FROM "wl_Users"`)
      .first<{ count: number }>();
    return json({ ok: true, needInit: (row?.count ?? 0) === 0 });
  } catch (e) {
    console.error("site init check failed", e);
    return json({ ok: true, needInit: true });
  }
});

// ---------- 3.5 访问量统计 API ----------
// 允许跨域（博客静态站可能部署在 github.io 等其它域名）
const VISIT_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};
const visitJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...VISIT_CORS },
  });

// 日期按东八区（Asia/Shanghai）计算，格式 YYYY-MM-DD；offsetDays 表示往前推几天
function visitDay(offsetDays = 0): string {
  const t = Date.now() + 8 * 3600 * 1000 - offsetDays * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// 数据默认保留 365 天（可在后台「访问量」页调整）
const VISIT_DEFAULT_RETENTION = 365;

// 确保访问量表存在（自愈：CI 的 D1 迁移可能因令牌权限失败，此处按需建表）
let visitTablesReady: Promise<unknown> | null = null;
function ensureVisitTables(db: D1Database): Promise<unknown> {
  if (!visitTablesReady) {
    visitTablesReady = db
      .batch([
        db.prepare(
          `CREATE TABLE IF NOT EXISTS "wl_Visit" ("day" TEXT PRIMARY KEY, "count" INTEGER NOT NULL DEFAULT 0)`
        ),
        db.prepare(
          `CREATE TABLE IF NOT EXISTS "wl_VisitVisitor" ("day" TEXT NOT NULL, "visitor" TEXT NOT NULL, PRIMARY KEY("day","visitor"))`
        ),
        // 保留天数等设置存放于此（与 Waline 共用 wl_Settings，缺失时自愈创建）
        db.prepare(
          `CREATE TABLE IF NOT EXISTS "wl_Settings" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL DEFAULT '', "updatedAt" TEXT DEFAULT (datetime('now')))`
        ),
      ])
      .catch((e) => {
        visitTablesReady = null;
        throw e;
      });
  }
  return visitTablesReady;
}

// 读取数据保留天数（存于 wl_Settings，默认 365）
async function visitRetention(db: D1Database): Promise<number> {
  try {
    const row = await db
      .prepare(`SELECT "value" FROM "wl_Settings" WHERE "key"=?1`)
      .bind("visit_retention_days")
      .first<{ value: string }>();
    const n = parseInt(row?.value ?? "", 10);
    if (Number.isFinite(n) && n >= 1 && n <= 3650) return n;
  } catch (e) {
    /* wl_Settings 不存在等情况忽略，用默认值 */
  }
  return VISIT_DEFAULT_RETENTION;
}

// 读取今日/总访问量
async function visitStats(db: D1Database) {
  const day = visitDay();
  await ensureVisitTables(db);
  const row = await db
    .prepare(
      `SELECT (SELECT "count" FROM "wl_Visit" WHERE "day"=?1) AS today,
              (SELECT COALESCE(SUM("count"),0) FROM "wl_Visit") AS total`
    )
    .bind(day)
    .first<{ today: number | null; total: number }>();
  return { today: row?.today ?? 0, total: row?.total ?? 0 };
}

// 最近 days 天的访问趋势（缺失日期补 0）
async function visitDaily(db: D1Database, days: number) {
  await ensureVisitTables(db);
  const from = visitDay(days - 1);
  const rows = await db
    .prepare(`SELECT "day","count" FROM "wl_Visit" WHERE "day">=?1 ORDER BY "day" ASC`)
    .bind(from)
    .all<{ day: string; count: number }>();
  const map = new Map<string, number>();
  (rows.results || []).forEach((r) => map.set(r.day, r.count));
  const series: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = visitDay(i);
    series.push({ day: d, count: map.get(d) ?? 0 });
  }
  return series;
}

// 过期数据清理：同一隔离实例每天最多执行一次
let lastCleanupDay = "";
async function visitCleanup(db: D1Database) {
  const today = visitDay();
  if (lastCleanupDay === today) return;
  lastCleanupDay = today;
  try {
    const retention = await visitRetention(db);
    const cutoff = visitDay(retention - 1);
    await db.batch([
      db.prepare(`DELETE FROM "wl_Visit" WHERE "day"<?1`).bind(cutoff),
      db.prepare(`DELETE FROM "wl_VisitVisitor" WHERE "day"<?1`).bind(cutoff),
    ]);
  } catch (e) {
    console.error("visit cleanup failed", e);
  }
}

// 访客标识：IP + UA 的 SHA-256（同一访客当天只计一次）
async function visitorId(c: { req: { header: (k: string) => string | undefined } }): Promise<string> {
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "";
  const ua = c.req.header("user-agent") || "";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + ua));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

// 预检
app.options("/api/visit", (c) => new Response(null, { status: 204, headers: VISIT_CORS }));

// 查询：GET /api/visit/stats
app.get("/api/visit/stats", async (c) => {
  try {
    const s = await visitStats((c.env as Bindings).DB);
    return visitJson({ ok: true, ...s });
  } catch (e) {
    console.error("visit stats failed", e);
    return visitJson({ ok: false, today: 0, total: 0 });
  }
});

// 记录一次访问：POST /api/visit（同一访客同一天只计一次，刷新不重复计数）
app.post("/api/visit", async (c) => {
  const db = (c.env as Bindings).DB;
  const day = visitDay();
  try {
    await ensureVisitTables(db);
    const vid = await visitorId(c);
    const ins = await db
      .prepare(`INSERT OR IGNORE INTO "wl_VisitVisitor" ("day","visitor") VALUES (?1,?2)`)
      .bind(day, vid)
      .run();
    const counted = ((ins.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
    if (counted) {
      await db
        .prepare(
          `INSERT INTO "wl_Visit" ("day","count") VALUES (?1,1)
           ON CONFLICT("day") DO UPDATE SET "count"="count"+1`
        )
        .bind(day)
        .run();
    }
    try {
      c.executionCtx.waitUntil(visitCleanup(db));
    } catch (e) {
      /* 无 executionCtx 时忽略 */
    }
    const s = await visitStats(db);
    return visitJson({ ok: true, counted, ...s });
  } catch (e) {
    console.error("visit record failed", e);
    return visitJson({ ok: false, today: 0, total: 0 });
  }
});

// ---------- 4. 文章管理 API（需 Waline 管理员 JWT）----------
app.use("/admin/api/*", auth);

app.get("/admin/api/posts", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleListPosts(c.env as Bindings);
});

app.get("/admin/api/post", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const path = c.req.query("path") || "";
  if (!path) return json({ error: "path required" }, 400);
  return handleGetPost(c.env as Bindings, path);
});

app.post("/admin/api/post", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleWritePost(c.env as Bindings, await c.req.json(), false);
});

app.put("/admin/api/post", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleWritePost(c.env as Bindings, await c.req.json(), true);
});

// 删除文章（移入回收站）：DELETE /admin/api/post?path=xxx
app.delete("/admin/api/post", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const path = c.req.query("path") || "";
  if (!path) return json({ error: "path required" }, 400);
  const r = await handleRecyclePaths(c.env as Bindings, [path]);
  return json({ ...r, message: r.moved ? "已移入回收站" : "" });
});

// 批量删除文章（移入回收站）：POST /admin/api/posts/delete  body { paths: string[] }
app.post("/admin/api/posts/delete", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { paths?: unknown };
  return json(await handleRecyclePaths(c.env as Bindings, body.paths));
});

// 批量上传文章：POST /admin/api/posts/upload  body { files: [{name, content}] }
app.post("/admin/api/posts/upload", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { files?: unknown };
  return handleUploadPosts(c.env as Bindings, body.files);
});

// 部署工作流状态：/admin/api/build
app.get("/admin/api/build", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleBuildStatus(c.env as Bindings);
});

// 手动触发部署工作流：/admin/api/build/trigger
app.post("/admin/api/build/trigger", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleTriggerBuild(c.env as Bindings);
});

// 部署历史记录：/admin/api/build/history
app.get("/admin/api/build/history", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleBuildHistory(c.env as Bindings);
});

// 部署工作流日志：/admin/api/build/log?id=<runId>
// 由 Cloudflare 直接代理获取 GitHub Actions 运行日志（zip）并解压为文本，前端无需跳转 GitHub。
// id 缺省时取最近一次 deploy.yml 运行。
app.get("/admin/api/build/log", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleBuildLog(c.env as Bindings, c.req.query("id") || "");
});

// ---------- 访问量（仅管理员可见）----------
// 最近 N 天趋势：/admin/api/visit/daily?days=30
app.get("/admin/api/visit/daily", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const raw = parseInt(c.req.query("days") || "30", 10);
  const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 3650) : 30;
  try {
    const series = await visitDaily((c.env as Bindings).DB, days);
    return json({ ok: true, days, series, sum: series.reduce((a, b) => a + b.count, 0) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// 读取设置：/admin/api/visit/settings
app.get("/admin/api/visit/settings", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  try {
    await ensureVisitTables(db);
    return json({ ok: true, retention_days: await visitRetention(db) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// 保存设置：/admin/api/visit/settings（数据保留天数，1-3650）
app.put("/admin/api/visit/settings", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { retention_days?: unknown };
  const n = parseInt(String(body?.retention_days ?? ""), 10);
  if (!Number.isFinite(n) || n < 1 || n > 3650) {
    return json({ error: "retention_days 需为 1-3650 的整数" }, 400);
  }
  try {
    await ensureVisitTables((c.env as Bindings).DB);
    await (c.env as Bindings).DB.prepare(
      `INSERT INTO "wl_Settings" ("key","value","updatedAt") VALUES (?1,?2,datetime('now'))
       ON CONFLICT("key") DO UPDATE SET "value"=?2, "updatedAt"=datetime('now')`
    )
      .bind("visit_retention_days", String(n))
      .run();
    return json({ ok: true, retention_days: n });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// ---------- 3.55 站点功能设置（访客评论开关、数据保留等）----------
// 统一存于 wl_Settings，供后台「设置」标签页读写
async function getSiteSetting(db: D1Database, key: string, fallback: string): Promise<string> {
  try {
    const row = await db
      .prepare(`SELECT "value" FROM "wl_Settings" WHERE "key"=?1`)
      .bind(key)
      .first<{ value: string }>();
    return row?.value ?? fallback;
  } catch (e) {
    return fallback;
  }
}
async function setSiteSetting(db: D1Database, key: string, value: string): Promise<void> {
  await ensureVisitTables(db);
  await db
    .prepare(
      `INSERT INTO "wl_Settings" ("key","value","updatedAt") VALUES (?1,?2,datetime('now'))
       ON CONFLICT("key") DO UPDATE SET "value"=?2,"updatedAt"=datetime('now')`
    )
    .bind(key, value)
    .run();
}

app.get("/admin/api/site/settings", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  try {
    const allowGuest = (await getSiteSetting(db, "allow_guest_comment", "true")) !== "false";
    return json({ ok: true, allow_guest_comment: allowGuest, retention_days: await visitRetention(db) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

app.put("/admin/api/site/settings", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.allow_guest_comment !== undefined) {
      await setSiteSetting(db, "allow_guest_comment", body.allow_guest_comment ? "true" : "false");
    }
    if (body.retention_days !== undefined) {
      const n = parseInt(String(body.retention_days), 10);
      if (!Number.isFinite(n) || n < 1 || n > 3650) {
        return json({ error: "retention_days 需为 1-3650 的整数" }, 400);
      }
      await setSiteSetting(db, "visit_retention_days", String(n));
    }
    const allowGuest = (await getSiteSetting(db, "allow_guest_comment", "true")) !== "false";
    return json({ ok: true, allow_guest_comment: allowGuest, retention_days: await visitRetention(db) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// ---------- 3.58 AI 设置（OpenAI 兼容接口）----------
// 配置统一存于 wl_Settings(key=ai_config)，序列化为 JSON，模仿订阅配置的写法。
// 注意：评论区垃圾过滤另行使用 llm_endpoint/llm_api_key/llm_model/llm_prompt，
// 与本模块的 ai_config 相互独立。
interface AiConfig {
  baseUrl: string; // API 基础地址，如 https://api.openai.com/v1
  apiKey: string; // API 密钥（读取接口不回传明文）
  model: string; // 默认模型
  models: string[]; // 可选模型列表（AI 助手中可切换）
  prompt: string; // 系统提示词（AI 助手的角色设定）
  enabled: boolean; // 是否启用
  clientProxy: boolean; // 前端代理：由浏览器直连服务商
  permission: string; // 权限级别：safe 安全访问 / important 重要确认 / all 全部确认 / full 完全访问
}

const AI_DEFAULT_CONFIG: AiConfig = {
  baseUrl: "",
  apiKey: "",
  model: "",
  models: [],
  prompt: "",
  enabled: false,
  clientProxy: false,
  permission: "safe",
};

// 权限级别白名单：非法值回退为 safe（安全访问）
const AI_PERMISSIONS = ["safe", "important", "all", "full"];
function normalizePermission(v: unknown): string {
  const s = String(v ?? "").trim();
  return AI_PERMISSIONS.indexOf(s) >= 0 ? s : "safe";
}

// 内置默认系统提示词：未自定义时使用（前端「还原」按钮也会恢复为它）
const AI_DEFAULT_PROMPT = [
  "你是这个博客后台的 AI 助手，请用简洁的中文回答。",
  "你可以调用工具查看/修改仓库文件、触发部署、读写站点设置；危险操作在执行前可能会请用户确认。",
  "回答使用 Markdown（标题、要点、代码块），不要编造未实际执行的结果。",
].join("\n");

const AI_CONFIG_KEY = "ai_config";

async function getAiConfig(db: D1Database): Promise<AiConfig> {
  const raw = await getSiteSetting(db, AI_CONFIG_KEY, "");
  if (!raw) return { ...AI_DEFAULT_CONFIG };
  try {
    return { ...AI_DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (e) {
    return { ...AI_DEFAULT_CONFIG };
  }
}

async function saveAiConfig(db: D1Database, cfg: AiConfig): Promise<void> {
  await setSiteSetting(db, AI_CONFIG_KEY, JSON.stringify(cfg));
}

// 拼接 OpenAI 兼容接口地址：用户可能填或不填结尾的 /v1，做健壮处理
function aiEndpoint(baseUrl: string, path: string): string {
  let base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  // 结尾缺少版本段（如 /v1）时自动补全，兼容标准 OpenAI 与第三方兼容接口
  if (!/\/v\d+[a-zA-Z]*$/.test(base)) base += "/v1";
  return base + path;
}

// GET 读取 AI 配置（管理员，密钥不回传，以 hasKey 表示是否已设置）
app.get("/admin/api/ai/settings", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  try {
    const cfg = await getAiConfig((c.env as Bindings).DB);
    return json({ ok: true, ...cfg, apiKey: "", hasKey: !!cfg.apiKey, defaultPrompt: AI_DEFAULT_PROMPT });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// PUT 保存 AI 配置（管理员，apiKey 留空表示不修改）
app.put("/admin/api/ai/settings", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const cur = await getAiConfig(db);
    const next: AiConfig = {
      baseUrl: body.baseUrl === undefined ? cur.baseUrl : String(body.baseUrl).trim(),
      apiKey:
        body.apiKey === undefined || body.apiKey === "" ? cur.apiKey : String(body.apiKey),
      model: body.model === undefined ? cur.model : String(body.model).trim(),
      models: Array.isArray(body.models)
        ? body.models.map((m) => String(m)).filter(Boolean)
        : cur.models,
      prompt: body.prompt === undefined ? cur.prompt : String(body.prompt),
      enabled: body.enabled === undefined ? cur.enabled : !!body.enabled,
      clientProxy: body.clientProxy === undefined ? cur.clientProxy : !!body.clientProxy,
      permission: body.permission === undefined ? cur.permission : normalizePermission(body.permission),
    };
    await saveAiConfig(db, next);
    return json({ ok: true, ...next, apiKey: "", hasKey: !!next.apiKey });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// POST 测试连通性（管理员）：向 {baseUrl}/chat/completions 发一个最小请求
// body 可选 {baseUrl, apiKey, model}，未传则使用已保存配置，方便未保存时先测试
app.post("/admin/api/ai/test", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const cfg = await getAiConfig(db);
    const baseUrl = (body.baseUrl ? String(body.baseUrl) : cfg.baseUrl).trim();
    const apiKey = body.apiKey ? String(body.apiKey) : cfg.apiKey;
    const model = (body.model ? String(body.model) : cfg.model).trim();
    if (!baseUrl) return json({ ok: false, error: "请先填写 API 地址" }, 400);
    if (!model)
      return json({ ok: false, error: "请先填写或勾选一个模型" }, 400);
    const url = aiEndpoint(baseUrl, "/chat/completions");
    const started = Date.now();
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "你好，这是一条连通性测试消息，请回复一句话确认。" }],
        max_tokens: 32,
      }),
    });
    const elapsed = Date.now() - started;
    const text = await resp.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch (e) {}
    if (!resp.ok) {
      const detail =
        data?.error?.message || data?.message || text.slice(0, 300) || `HTTP ${resp.status}`;
      return json({ ok: false, elapsed, status: resp.status, error: String(detail) });
    }
    const reply = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
    return json({
      ok: true,
      elapsed,
      status: resp.status,
      model: data?.model || model,
      reply: String(reply).trim().slice(0, 300),
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// GET 返回明文密钥（管理员）：仅用于「前端代理」模式下由浏览器直连服务商
app.get("/admin/api/ai/key", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  try {
    const cfg = await getAiConfig((c.env as Bindings).DB);
    return json({ ok: true, apiKey: cfg.apiKey });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// 获取模型列表（管理员）：调用 {baseUrl}/models（OpenAI 兼容格式）
// 支持通过参数覆盖 baseUrl / apiKey，因此「无需保存即可获取模型列表」
async function aiModelsHandler(
  c: any,
  over: { baseUrl?: string; apiKey?: string }
) {
  try {
    const cfg = await getAiConfig((c.env as Bindings).DB);
    const baseUrl = String(over.baseUrl || cfg.baseUrl || "").trim();
    const apiKey = over.apiKey !== undefined && over.apiKey !== null && over.apiKey !== ""
      ? String(over.apiKey)
      : cfg.apiKey;
    if (!baseUrl) return json({ ok: false, error: "请先填写 API 地址" }, 400);
    const url = aiEndpoint(baseUrl, "/models");
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });
    const text = await resp.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch (e) {}
    if (!resp.ok) {
      const detail =
        data?.error?.message || data?.error || data?.message || text.slice(0, 300) || `HTTP ${resp.status}`;
      return json({ ok: false, status: resp.status, error: String(detail) });
    }
    const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const models = list
      .map((m) => (typeof m === "string" ? m : m?.id))
      .filter((m): m is string => typeof m === "string" && !!m);
    return json({ ok: true, count: models.length, models });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

app.get("/admin/api/ai/models", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return aiModelsHandler(c, { baseUrl: c.req.query("baseUrl"), apiKey: c.req.query("apiKey") });
});

app.post("/admin/api/ai/models", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { baseUrl?: string; apiKey?: string };
  return aiModelsHandler(c, { baseUrl: body.baseUrl, apiKey: body.apiKey });
});

// ---------- 3.59 AI 助手（聊天：流式输出 + 历史记录）----------
// 历史会话存于 D1 表 wl_AiConversation（messages 为 JSON 数组），表按需创建。
let aiTablesReady: Promise<unknown> | null = null;
function ensureAiTables(db: D1Database): Promise<unknown> {
  if (!aiTablesReady) {
    aiTablesReady = db
      .prepare(
        `CREATE TABLE IF NOT EXISTS "wl_AiConversation" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT,
          "title" TEXT NOT NULL DEFAULT '',
          "messages" TEXT NOT NULL DEFAULT '[]',
          "createdAt" TEXT DEFAULT (datetime('now')),
          "updatedAt" TEXT DEFAULT (datetime('now'))
        )`
      )
      .run()
      .catch((e) => {
        aiTablesReady = null; // 失败则下次重试
        throw e;
      });
  }
  return aiTablesReady;
}

// GET 会话列表（管理员）
app.get("/admin/api/ai/conversations", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  try {
    await ensureAiTables(db);
    const rows = await db
      .prepare(
        `SELECT "id","title","createdAt","updatedAt" FROM "wl_AiConversation" ORDER BY "updatedAt" DESC LIMIT 100`
      )
      .all();
    return json({ ok: true, list: rows.results || [] });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// GET 单个会话（含消息）（管理员）
app.get("/admin/api/ai/conversation", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  const id = parseInt(c.req.query("id") || "", 10);
  if (!Number.isFinite(id)) return json({ ok: false, error: "id 无效" }, 400);
  try {
    await ensureAiTables(db);
    const row = await db
      .prepare(
        `SELECT "id","title","messages","createdAt","updatedAt" FROM "wl_AiConversation" WHERE "id"=?1`
      )
      .bind(id)
      .first<{ id: number; title: string; messages: string; createdAt: string; updatedAt: string }>();
    if (!row) return json({ ok: false, error: "未找到会话" }, 404);
    let messages: unknown = [];
    try {
      messages = JSON.parse(row.messages || "[]");
    } catch (e) {}
    return json({
      ok: true,
      conversation: {
        id: row.id,
        title: row.title,
        messages,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// PUT 保存会话（管理员）：body {id?, title?, messages}，id 存在则更新，否则新建
app.put("/admin/api/ai/conversation", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: unknown;
    title?: unknown;
    messages?: unknown;
  };
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const title = String(body.title ?? "").trim().slice(0, 100);
  const id = parseInt(String(body.id ?? ""), 10);
  try {
    await ensureAiTables(db);
    if (Number.isFinite(id) && id > 0) {
      const r = await db
        .prepare(
          `UPDATE "wl_AiConversation" SET "title"=?1,"messages"=?2,"updatedAt"=datetime('now') WHERE "id"=?3`
        )
        .bind(title, JSON.stringify(messages), id)
        .run();
      if (((r.meta as { changes?: number } | undefined)?.changes ?? 0) > 0) {
        return json({ ok: true, id, updated: true });
      }
    }
    const ins = await db
      .prepare(`INSERT INTO "wl_AiConversation" ("title","messages") VALUES (?1,?2)`)
      .bind(title, JSON.stringify(messages))
      .run();
    return json({ ok: true, id: (ins.meta as { last_row_id?: number } | undefined)?.last_row_id, created: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// DELETE 删除会话（管理员）
app.delete("/admin/api/ai/conversation", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  const id = parseInt(c.req.query("id") || "", 10);
  if (!Number.isFinite(id)) return json({ ok: false, error: "id 无效" }, 400);
  try {
    await ensureAiTables(db);
    const r = await db.prepare(`DELETE FROM "wl_AiConversation" WHERE "id"=?1`).bind(id).run();
    return json({ ok: true, deleted: ((r.meta as { changes?: number } | undefined)?.changes ?? 0) > 0 });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// POST 聊天（管理员，流式）：转发到 OpenAI 兼容接口，原样回传 SSE（text/event-stream）
// body {messages, model?, baseUrl?, apiKey?}，未传 model/baseUrl/apiKey 则用已保存配置
app.post("/admin/api/ai/chat", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const cfg = await getAiConfig((c.env as Bindings).DB);
  const baseUrl = String(body.baseUrl || cfg.baseUrl || "").trim();
  const apiKey = String(body.apiKey || cfg.apiKey || "");
  const model = String(body.model || cfg.model || "").trim();
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const prompt =
    body.prompt === undefined
      ? String(cfg.prompt || "").trim() || AI_DEFAULT_PROMPT
      : String(body.prompt).trim() || AI_DEFAULT_PROMPT;
  // 未自带系统消息时，使用配置中的 AI 提示词作为角色设定
  const msgs =
    prompt && (messages[0] as { role?: string } | undefined)?.role !== "system"
      ? [{ role: "system", content: prompt }, ...messages]
      : messages;
  if (!baseUrl) return json({ ok: false, error: "请先在「设置 → AI 设置」填写并保存 API 地址" }, 400);
  if (!model) return json({ ok: false, error: "请先填写默认模型（或在聊天页指定模型）" }, 400);
  if (!messages.length) return json({ ok: false, error: "messages required" }, 400);
  // 工具调用：前端仅在权限允许时下发 tools，此处原样转发给上游
  const tools = Array.isArray(body.tools) ? (body.tools as unknown[]) : null;
  // 思考强度（白名单校验后透传 reasoning_effort）
  const effortRaw = String(body.reasoning_effort || "").trim();
  const reasoningEffort = ["low", "medium", "high"].indexOf(effortRaw) >= 0 ? effortRaw : "";
  try {
    const upstream = await fetch(aiEndpoint(baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: msgs,
        stream: true,
        // 让上游在流末尾附带 usage（token 用量 / 缓存命中），供前端展示
        stream_options: { include_usage: true },
        ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      }),
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      let detail: unknown = text.slice(0, 300) || `HTTP ${upstream.status}`;
      try {
        const d = JSON.parse(text);
        detail = d?.error?.message || d?.error || detail;
      } catch (e) {}
      return json({ ok: false, status: upstream.status, error: String(detail) }, 502);
    }
    // 原样透传上游 SSE
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// ---------- 3.595 AI 密钥（占位符 {name}）：值不下发给 AI，仅在执行工具时替换 ----------
// 密钥仅管理员可维护；列表接口只返回名称，绝不回传明文，避免密钥进入 AI 上下文。
interface SecretRow {
  name: string;
  value: string;
}

let aiSecretTablesReady: Promise<unknown> | null = null;
function ensureSecretTables(db: D1Database): Promise<unknown> {
  if (!aiSecretTablesReady) {
    aiSecretTablesReady = db
      .prepare(
        `CREATE TABLE IF NOT EXISTS "wl_Secret" (
          "name" TEXT PRIMARY KEY,
          "value" TEXT NOT NULL DEFAULT '',
          "updatedAt" TEXT DEFAULT (datetime('now'))
        )`
      )
      .run()
      .catch((e) => {
        aiSecretTablesReady = null;
        throw e;
      });
  }
  return aiSecretTablesReady;
}

async function getSecrets(db: D1Database): Promise<SecretRow[]> {
  await ensureSecretTables(db);
  const rows = await db.prepare(`SELECT "name","value" FROM "wl_Secret" ORDER BY "name"`).all();
  return (rows.results || []) as unknown as SecretRow[];
}

// 把文本中的 {name} 替换为真实密钥值；未定义的占位符原样保留
function applySecrets(text: string, secrets: SecretRow[]): string {
  if (!text) return text;
  let out = text;
  for (const s of secrets) {
    if (!s.name) continue;
    out = out.split("{" + s.name + "}").join(s.value);
  }
  return out;
}

// GET 密钥名称列表（仅名称）
app.get("/admin/api/secrets", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  try {
    const list = await getSecrets((c.env as Bindings).DB);
    return json({ ok: true, names: list.map((s) => s.name) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// PUT 新增/更新密钥（值仅保存于服务端）
app.put("/admin/api/secrets", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; value?: unknown };
  const name = String(body.name || "").trim();
  const value = String(body.value ?? "");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name))
    return json({ ok: false, error: "名称仅支持字母、数字与 _ . -（1-64 位）" }, 400);
  if (!value) return json({ ok: false, error: "密钥值不能为空" }, 400);
  try {
    await ensureSecretTables(db);
    await db
      .prepare(
        `INSERT INTO "wl_Secret" ("name","value","updatedAt") VALUES (?1,?2,datetime('now'))
         ON CONFLICT("name") DO UPDATE SET "value"=?2,"updatedAt"=datetime('now')`
      )
      .bind(name, value)
      .run();
    return json({ ok: true, name });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// DELETE 删除密钥
app.delete("/admin/api/secrets", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  const name = String(c.req.query("name") || "").trim();
  if (!name) return json({ ok: false, error: "name required" }, 400);
  try {
    await ensureSecretTables(db);
    await db.prepare(`DELETE FROM "wl_Secret" WHERE "name"=?1`).bind(name).run();
    return json({ ok: true, name });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// ---------- 3.596 AI 工具（AI 主动调用，服务端执行；危险操作由前端按权限确认）----------
// 工具定义遵循 OpenAI function calling 规范
const AI_TOOLS = [
  { type: "function", function: { name: "list_files", description: "列出博客仓库某个目录下的文件（path 为空表示仓库根目录）", parameters: { type: "object", properties: { path: { type: "string", description: "目录路径，如 source/_posts" } } } } },
  { type: "function", function: { name: "read_file", description: "读取仓库中某个文本文件的内容", parameters: { type: "object", properties: { path: { type: "string", description: "文件完整路径" } }, required: ["path"] } } },
  { type: "function", function: { name: "list_branches", description: "列出仓库分支及当前分支", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "write_file", description: "新建或覆盖写入一个文本文件并提交到仓库（会自动触发部署）", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function", function: { name: "delete_file", description: "删除仓库中的文件或目录（移入回收站，可恢复）", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "build_status", description: "查询最近的部署构建状态", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "trigger_build", description: "手动触发一次部署构建", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_settings", description: "读取站点设置（站点功能 + 邮件服务器 + 订阅设置/邮件模板，密码以是否已设置表示）", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "set_setting", description: "修改站点设置。key 支持：站点功能 allow_guest_comment / retention_days；邮件服务器 smtp_host / smtp_port / smtp_user / smtp_pass / smtp_from_name / smtp_from_email；订阅设置 sub_site_name / sub_site_url / sub_need_confirm / sub_daily_limit；订阅邮件模板 sub_subject / sub_body / sub_notify_subject / sub_notify_body / sub_unsub_subject / sub_unsub_body。", parameters: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] } } },
  { type: "function", function: { name: "save_secret", description: "当用户在对话中直接给出了密钥/授权码/密码并要你保存时调用。name 为占位符名称（如 SMTP_PASS），value 为用户给出的真实值；保存后在写入文件或设置时用 {name} 引用。", parameters: { type: "object", properties: { name: { type: "string" }, value: { type: "string" } }, required: ["name", "value"] } } },
  { type: "function", function: { name: "request_secret", description: "当需要用户提供密钥/授权码/密码，但用户尚未在对话中提供时调用：系统会弹窗让用户在本地输入，输入内容不会发送给你，你只会收到是否设置成功的结果。切勿要求用户把密码直接发到对话里。", parameters: { type: "object", properties: { name: { type: "string", description: "占位符名称，如 SMTP_PASS" }, purpose: { type: "string", description: "用途说明，会展示给用户" } }, required: ["name"] } } },
  { type: "function", function: { name: "send_email", description: "使用已配置的 SMTP 发送邮件。默认发送单封给 to；若 broadcast=true 则群发给全部「已确认」的订阅者（忽略 to）。主题/正文必填，正文支持 HTML，可用 {{site}} {{email}} {{unsubscribe}} 变量。", parameters: { type: "object", properties: { to: { type: "string", description: "收件邮箱（发单封时必填）" }, subject: { type: "string" }, body: { type: "string", description: "正文，支持 HTML" }, broadcast: { type: "boolean", description: "true 时群发给全部已确认订阅者" } }, required: ["subject", "body"] } } },
  { type: "function", function: { name: "http_get", description: "发起一个 HTTP GET 请求并返回状态码、响应头与响应体（用于抓取网页、调用 REST API）。", parameters: { type: "object", properties: { url: { type: "string", description: "完整 URL，必须以 http:// 或 https:// 开头" }, headers: { type: "object", description: "可选请求头键值对，如 {\"Accept\":\"application/json\"}" } }, required: ["url"] } } },
  { type: "function", function: { name: "http_post", description: "发起一个 HTTP POST 请求并返回状态码、响应头与响应体（用于提交表单、调用需要写入的 REST API）。", parameters: { type: "object", properties: { url: { type: "string", description: "完整 URL，必须以 http:// 或 https:// 开头" }, body: { type: "string", description: "请求体文本（如 JSON 字符串）" }, contentType: { type: "string", description: "请求体类型，如 application/json、application/x-www-form-urlencoded；默认 text/plain" }, headers: { type: "object", description: "可选请求头键值对" } }, required: ["url"] } } },
  { type: "function", function: { name: "download_file", description: "从网络下载一个文件并保存到博客仓库（exe/图片/zip/压缩包等二进制均可）。url 也可传 GitHub 仓库的 owner/repo 或 https://github.com/owner/repo 链接，会自动下载该仓库源码 zip。path 为仓库内目标路径：以 / 结尾或省略表示目录（自动使用下载文件名），否则视为完整文件路径。上限约 45MB。", parameters: { type: "object", properties: { url: { type: "string", description: "http(s) 下载地址，或 GitHub 仓库 owner/repo" }, path: { type: "string", description: "仓库内目标路径或目录（目录以 / 结尾），可省略" }, name: { type: "string", description: "可选：保存的文件名" }, branch: { type: "string", description: "可选：分支，默认当前分支" } }, required: ["url"] } } },
  { type: "function", function: { name: "unzip_file", description: "解压仓库内已有的 zip 文件到它所在目录：小于 50MB 由 Cloudflare 即时解压；大于 50MB 自动触发 GitHub 工作流异步解压。", parameters: { type: "object", properties: { path: { type: "string", description: "zip 文件在仓库中的完整路径" }, branch: { type: "string", description: "可选：分支" } }, required: ["path"] } } },
  { type: "function", function: { name: "unzip_status", description: "查询大文件解压工作流（unzip.yml）的运行状态与最近结果。", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_build_logs", description: "获取部署工作流（deploy.yml）的运行日志文本，用于排查构建失败原因。runId 可省略，默认取最近一次运行。", parameters: { type: "object", properties: { runId: { type: "string", description: "可选：工作流 run id，省略则为最近一次" } } } } },
];

// set_setting 允许修改的设置项（站点功能走 wl_Settings，其余写入订阅/SMTP 配置）
const AI_SETTING_KEYS = [
  "allow_guest_comment", "retention_days",
  "smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from_name", "smtp_from_email",
  "sub_site_name", "sub_site_url", "sub_subject", "sub_body", "sub_notify_subject", "sub_notify_body",
  "sub_unsub_subject", "sub_unsub_body", "sub_need_confirm", "sub_daily_limit",
];

// 危险工具：需要「重要确认」及以上权限时需用户确认
const AI_DANGER_TOOLS = ["write_file", "delete_file", "trigger_build", "set_setting", "save_secret", "send_email", "http_post", "download_file", "unzip_file"];

// 生成工具使用说明（含可用密钥占位符名称，绝不含密钥值）
async function aiToolsHint(db: D1Database): Promise<string> {
  const secrets = await getSecrets(db).catch(() => [] as SecretRow[]);
  const names = secrets.map((s) => s.name);
  return [
    "你已接入该博客后台，可通过工具直接读写仓库文件、触发部署、修改站点设置。",
    "仓库根目录即工作目录；文章位于 source/_posts。修改文件后会自动部署。",
    "危险操作（写文件 / 删除 / 触发构建 / 改设置 / 保存密钥 / 发邮件）可能会被系统拦截并等待用户确认。",
    "密钥用法：严禁把任何真实密钥写进回答。如需使用密钥，请在写入内容里写占位符（如 {MY_API}），系统会在执行时自动替换为真实值；你无法也不应获取真实密钥。",
    "凭据规则：绝对不要要求用户把密码/授权码直接发到对话里。若你确实需要而用户尚未提供，请调用 request_secret（系统会弹窗让用户本地输入，你不会看到内容）；若用户已在对话中直接把密码/授权码给了你并要你保存，请调用 save_secret 保存为占位符。",
    "可用 set_setting 修改的设置项 key：" + AI_SETTING_KEYS.join("、") + "。",
    "发邮件：用 send_email 发单封（to）或 broadcast=true 群发给已确认订阅者；需先在设置里配置 SMTP。发送前可先用 get_settings 确认 smtp.host 与 hasPass。",
    "联网：用 http_get 抓取网页或调用 GET 类接口，用 http_post 提交数据或调用写入类接口（需 http(s):// 开头，可自定义 headers/contentType）。响应体会自动截断，超长内容请分页或改用接口的查询参数。",
    "下载与解压：用 download_file 把网络上的文件（含 GitHub 仓库 owner/repo 源码 zip）保存进仓库；用 unzip_file 解压仓库里的 zip（<50MB 即时完成，>50MB 触发 GitHub 工作流异步解压，可用 unzip_status 查看进度）。",
    "部署排错：用 build_status 查看部署状态；用 get_build_logs 拉取部署工作流日志文本（可传 runId，省略则取最近一次），用于分析构建失败原因。",
    names.length
      ? "当前可用的密钥占位符：" + names.map((n) => "{" + n + "}").join("、")
      : "当前没有配置任何密钥占位符（管理员可在「设置 → AI 密钥」中添加）。",
  ].join("\n");
}

// 把 AI 传入的 headers 对象转成字符串键值对，并把其中 {NAME} 占位符替换为已保存的密钥
function aiSecretHeaders(headers: unknown, secrets: SecretRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers && typeof headers === "object") {
    for (const k of Object.keys(headers as Record<string, unknown>)) {
      out[k] = applySecrets(String((headers as Record<string, unknown>)[k]), secrets);
    }
  }
  return out;
}

// 发起外网 HTTP 请求（AI 的 http_get / http_post 工具）：返回状态码、响应头、响应体（超长截断）
async function aiHttpRequest(
  method: string,
  url: string,
  body: string,
  headers: unknown,
  contentType: string
): Promise<string> {
  try {
    if (!/^https?:\/\//i.test(url)) return JSON.stringify({ ok: false, error: "url 必须以 http:// 或 https:// 开头" });
    const h: Record<string, string> = {};
    if (headers && typeof headers === "object") {
      for (const k of Object.keys(headers as Record<string, unknown>)) h[k] = String((headers as Record<string, unknown>)[k]);
    }
    const hasCT = Object.keys(h).some((k) => k.toLowerCase() === "content-type");
    if (method === "POST" && contentType && !hasCT) h["Content-Type"] = contentType;
    const t0 = Date.now();
    const r = await fetch(url, { method, headers: h, body: method === "POST" ? body || "" : undefined, redirect: "follow" });
    const ms = Date.now() - t0;
    const text = await r.text().catch(() => "");
    const out = text.length > 100000 ? text.slice(0, 100000) + "\n...(内容过长已截断)" : text;
    const rh: Record<string, string> = {};
    r.headers.forEach((v, k) => { rh[k] = v; });
    return JSON.stringify({ ok: r.ok, status: r.status, ms, headers: rh, body: out });
  } catch (e) {
    return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

// 执行工具，返回给 AI 的文本结果（JSON 字符串）
async function aiRunTool(env: Bindings, name: string, args: Record<string, unknown>): Promise<string> {
  const db = env.DB;
  const secrets = await getSecrets(db).catch(() => [] as SecretRow[]);
  const s = (k: string) => (args && args[k] !== undefined && args[k] !== null ? String(args[k]) : "");
  const jr = async (r: Response) => JSON.stringify(await r.json().catch(() => ({})));
  switch (name) {
    case "list_files":
      return jr(await handleListFiles(env, s("path")));
    case "read_file": {
      const r = await handleGetFile(env, s("path"));
      const d = (await r.json().catch(() => ({}))) as { content?: unknown };
      if (d && typeof d.content === "string" && d.content.length > 100000)
        d.content = d.content.slice(0, 100000) + "\n...(内容过长已截断)";
      return JSON.stringify(d);
    }
    case "list_branches":
      return jr(await handleListBranches(env));
    case "build_status":
      return jr(await handleBuildStatus(env));
    case "get_build_logs": {
      const r = await handleBuildLog(env, s("runId"));
      const d = (await r.json().catch(() => ({}))) as { text?: unknown };
      if (d && typeof d.text === "string" && d.text.length > 30000)
        d.text = d.text.slice(-30000) + "\n...(为节省上下文，日志已截断)";
      return JSON.stringify(d);
    }
    case "write_file":
      return jr(await handleSaveFile(env, { path: s("path"), content: applySecrets(s("content"), secrets) }));
    case "delete_file":
      return JSON.stringify(await handleRecyclePaths(env, [s("path")]));
    case "trigger_build":
      return jr(await handleTriggerBuild(env));
    case "get_settings": {
      const allowGuest = (await getSiteSetting(db, "allow_guest_comment", "true")) !== "false";
      const retention = await getSiteSetting(db, "retention_days", "365");
      const sub = await getSubscribeConfig(db);
      return JSON.stringify({
        ok: true,
        allow_guest_comment: allowGuest,
        retention_days: retention,
        smtp: {
          host: sub.host,
          port: sub.port,
          user: sub.user,
          hasPass: !!sub.pass,
          fromName: sub.fromName,
          fromEmail: sub.fromEmail,
        },
        subscription: {
          siteName: sub.siteName,
          siteUrl: sub.siteUrl,
          needConfirm: sub.needConfirm,
          dailyLimit: sub.dailyLimit,
          subject: sub.subject,
          body: sub.body,
          notifySubject: sub.notifySubject,
          notifyBody: sub.notifyBody,
          unsubSubject: sub.unsubSubject,
          unsubBody: sub.unsubBody,
        },
      });
    }
    case "set_setting": {
      const key = s("key");
      if (AI_SETTING_KEYS.indexOf(key) < 0)
        return JSON.stringify({ ok: false, error: "不支持的设置项：" + key + "（允许：" + AI_SETTING_KEYS.join("、") + "）" });
      const val = applySecrets(s("value"), secrets);
      if (key === "allow_guest_comment" || key === "retention_days") {
        await setSiteSetting(db, key, val);
        return JSON.stringify({ ok: true, key, message: "已更新" });
      }
      const cur = await getSubscribeConfig(db);
      const next: SubscribeConfig = { ...cur };
      const asBool = (v: string) => ["true", "1", "yes", "on", "是"].indexOf(v.trim().toLowerCase()) >= 0;
      const asInt = (v: string, fb: number, max: number) => {
        const n = parseInt(v, 10);
        return Number.isFinite(n) && n > 0 && n <= max ? n : fb;
      };
      switch (key) {
        case "smtp_host": next.host = val.trim(); break;
        case "smtp_port": next.port = asInt(val, cur.port, 65535); break;
        case "smtp_user": next.user = val.trim(); break;
        case "smtp_pass": next.pass = val; break;
        case "smtp_from_name": next.fromName = val; break;
        case "smtp_from_email": next.fromEmail = val.trim(); break;
        case "sub_site_name": next.siteName = val; break;
        case "sub_site_url": next.siteUrl = val.trim(); break;
        case "sub_subject": next.subject = val; break;
        case "sub_body": next.body = val; break;
        case "sub_notify_subject": next.notifySubject = val; break;
        case "sub_notify_body": next.notifyBody = val; break;
        case "sub_unsub_subject": next.unsubSubject = val; break;
        case "sub_unsub_body": next.unsubBody = val; break;
        case "sub_need_confirm": next.needConfirm = asBool(val); break;
        case "sub_daily_limit": next.dailyLimit = asInt(val, cur.dailyLimit, 1000000); break;
      }
      await saveSubscribeConfig(db, next);
      return JSON.stringify({ ok: true, key, message: "已更新" });
    }
    case "save_secret": {
      const name = s("name").trim();
      const value = s("value");
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name))
        return JSON.stringify({ ok: false, error: "名称仅支持字母、数字与 _ . -（1-64 位）" });
      if (!value) return JSON.stringify({ ok: false, error: "值不能为空" });
      await ensureSecretTables(db);
      await db
        .prepare(
          `INSERT INTO "wl_Secret" ("name","value","updatedAt") VALUES (?1,?2,datetime('now'))
           ON CONFLICT("name") DO UPDATE SET "value"=?2,"updatedAt"=datetime('now')`
        )
        .bind(name, value)
        .run();
      return JSON.stringify({ ok: true, name, message: "已保存为占位符 {" + name + "}" });
    }
    case "request_secret":
      return JSON.stringify({ ok: false, error: "request_secret 需由前端弹窗处理，请勿发送到服务端" });
    case "send_email": {
      const cfg = await getSubscribeConfig(db);
      if (!cfg.host || !cfg.port)
        return JSON.stringify({ ok: false, error: "请先在「设置 → SMTP 邮件服务器」配置 SMTP（Workers 仅支持 465 端口）" });
      const subject = applySecrets(s("subject"), secrets).trim();
      const bodyHtml = applySecrets(s("body"), secrets);
      if (!subject || !bodyHtml) return JSON.stringify({ ok: false, error: "subject 与 body 不能为空" });
      const broadcast = args.broadcast === true || String(args.broadcast || "") === "true";
      try {
        if (broadcast) {
          const origin = (env.SITE_URL || "").replace(/\/+$/, "");
          const r = await broadcastToConfirmed(env, subject, bodyHtml, {}, origin);
          if (!r.total) return JSON.stringify({ ok: false, error: "暂无已确认的订阅者" });
          return JSON.stringify({ ok: true, sent: r.sent, failed: r.failed, total: r.total, limited: r.total > 100, message: "群发完成" });
        }
        const to = applySecrets(s("to"), secrets).trim();
        if (!to) return JSON.stringify({ ok: false, error: "请提供收件邮箱 to，或设置 broadcast=true 群发" });
        await sendMail(mailSmtp(cfg), { to, subject, html: wrapMailHtml(bodyHtml) });
        return JSON.stringify({ ok: true, message: "已发送给 " + to });
      } catch (e) {
        return JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    case "http_get":
      return await aiHttpRequest("GET", s("url"), "", aiSecretHeaders(args.headers, secrets), "");
    case "http_post":
      return await aiHttpRequest(
        "POST",
        s("url"),
        applySecrets(s("body"), secrets),
        aiSecretHeaders(args.headers, secrets),
        s("contentType")
      );
    case "download_file":
      return jr(
        await handleDownloadFile(env, {
          url: applySecrets(s("url"), secrets),
          path: s("path"),
          name: s("name"),
          branch: s("branch"),
        })
      );
    case "unzip_file":
      return jr(await handleUnzipByPath(env, { path: s("path"), branch: s("branch") }));
    case "unzip_status":
      return jr(await handleUnzipStatus(env));
    default:
      return JSON.stringify({ ok: false, error: "未知工具：" + name });
  }
}

// GET 工具定义与使用说明（前端据此发起带工具的对话）
app.get("/admin/api/ai/tools", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  try {
    return json({ ok: true, tools: AI_TOOLS, danger: AI_DANGER_TOOLS, hint: await aiToolsHint((c.env as Bindings).DB) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// POST 执行工具（管理员）：body {name, args}
app.post("/admin/api/ai/tool", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; args?: unknown };
  const name = String(body.name || "");
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  if (!name) return json({ ok: false, error: "name required" }, 400);
  try {
    return json({ ok: true, name, result: await aiRunTool(c.env as Bindings, name, args) });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// ---------- 3.6 邮件订阅 API ----------
// SMTP 配置存于 wl_Settings(key=subscribe_config)，订阅者存于 wl_Subscriber。
// 公开接口（/api/subscribe*）允许跨域，方便在任意站点调用；管理接口走 /admin/api/*。
interface SubscribeConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  secure: boolean;
  siteName: string;
  siteUrl: string;
  subject: string;
  body: string;
  needConfirm: boolean;
  // 新文章发布通知（构建完成后由工作流回调本 Worker 发送）
  notifySubject: string;
  notifyBody: string;
  // 退订成功提示（仅用户通过邮件链接主动退订时发送）
  unsubSubject: string;
  unsubBody: string;
  // 当日最多订阅量（按东八区计日）：达到上限后当天不再接受新订阅，用于暴力防刷
  dailyLimit: number;
}

const SUBSCRIBE_DEFAULT_CONFIG: SubscribeConfig = {
  host: "",
  port: 465,
  user: "",
  pass: "",
  fromName: "",
  fromEmail: "",
  secure: true,
  siteName: "我的博客",
  siteUrl: "",
  subject: "【{{site}}】订阅确认",
  body:
    "<p>你好！</p><p>感谢订阅 <b>{{site}}</b>。</p>" +
    '<p>请点击下面的链接确认订阅：</p><p><a href="{{link}}">{{link}}</a></p>' +
    '<p>如果不是你本人操作，请忽略这封邮件。</p>',
  needConfirm: true,
  notifySubject: "【{{site}}】新文章：{{title}}",
  notifyBody:
    "<p>你好！</p><p><b>{{site}}</b> 发布了新文章：</p>" +
    '<p style="font-size:16px"><a href="{{url}}">{{title}}</a></p>' +
    '<p><a href="{{url}}">阅读全文</a></p>' +
    '<hr><p style="color:#888;font-size:12px"><a href="{{unsubscribe}}">不再接收邮件</a></p>',
  unsubSubject: "【{{site}}】已成功退订",
  unsubBody:
    "<p>你好！</p><p>你已成功退订 <b>{{site}}</b> 的邮件通知，之后不会再收到新文章邮件。</p>" +
    "<p>如果这不是你本人的操作，可回到站点重新订阅。</p>",
  dailyLimit: 100,
};

const subscribeJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...VISIT_CORS },
  });

// 确保订阅相关表存在（自愈建表，与访问量表同样的策略）
let subscribeTablesReady: Promise<unknown> | null = null;
function ensureSubscribeTables(db: D1Database): Promise<unknown> {
  if (!subscribeTablesReady) {
    subscribeTablesReady = db
      .batch([
        db.prepare(
          `CREATE TABLE IF NOT EXISTS "wl_Subscriber" (
            "id" INTEGER PRIMARY KEY AUTOINCREMENT,
            "email" TEXT NOT NULL,
            "status" TEXT NOT NULL DEFAULT 'pending',
            "token" TEXT NOT NULL,
            "ip" TEXT,
            "ua" TEXT,
            "createdAt" TEXT DEFAULT (datetime('now')),
            "confirmedAt" TEXT,
            "updatedAt" TEXT DEFAULT (datetime('now'))
          )`
        ),
        db.prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS "idx_subscriber_email" ON "wl_Subscriber" ("email")`
        ),
        db.prepare(
          `CREATE INDEX IF NOT EXISTS "idx_subscriber_token" ON "wl_Subscriber" ("token")`
        ),
        db.prepare(
          `CREATE TABLE IF NOT EXISTS "wl_Settings" ("key" TEXT PRIMARY KEY, "value" TEXT NOT NULL DEFAULT '', "updatedAt" TEXT DEFAULT (datetime('now')))`
        ),
      ])
      .catch((e) => {
        subscribeTablesReady = null;
        throw e;
      });
  }
  return subscribeTablesReady;
}

async function getSubscribeConfig(db: D1Database): Promise<SubscribeConfig> {
  await ensureSubscribeTables(db);
  const row = await db
    .prepare(`SELECT "value" FROM "wl_Settings" WHERE "key"='subscribe_config'`)
    .first<{ value: string }>();
  if (!row?.value) return { ...SUBSCRIBE_DEFAULT_CONFIG };
  try {
    return { ...SUBSCRIBE_DEFAULT_CONFIG, ...JSON.parse(row.value) };
  } catch (e) {
    return { ...SUBSCRIBE_DEFAULT_CONFIG };
  }
}

async function saveSubscribeConfig(db: D1Database, cfg: SubscribeConfig): Promise<void> {
  await ensureSubscribeTables(db);
  await db
    .prepare(
      `INSERT INTO "wl_Settings" ("key","value","updatedAt") VALUES ('subscribe_config',?1,datetime('now'))
       ON CONFLICT("key") DO UPDATE SET "value"=?1, "updatedAt"=datetime('now')`
    )
    .bind(JSON.stringify(cfg))
    .run();
}

function randomToken(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
}

function mailSmtp(cfg: SubscribeConfig) {
  return {
    host: cfg.host,
    port: Number(cfg.port),
    user: cfg.user,
    pass: cfg.pass,
    fromName: cfg.fromName,
    fromEmail: cfg.fromEmail || cfg.user,
  };
}

function wrapMailHtml(inner: string): string {
  return (
    '<div style="font:14px/1.75 -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,\'PingFang SC\',\'Microsoft YaHei\',Arial,sans-serif;color:#1f2328">' +
    inner +
    "</div>"
  );
}

// 群发给全部已确认订阅者（单次上限 100 封，避免 Worker 超时）
async function broadcastToConfirmed(
  env: Bindings,
  subjectTpl: string,
  bodyTpl: string,
  extraVars: Record<string, string>,
  origin: string
): Promise<{ sent: number; failed: number; total: number }> {
  const cfg = await getSubscribeConfig(env.DB);
  if (!cfg.host || !cfg.port) throw new Error("请先配置 SMTP");
  await ensureSubscribeTables(env.DB);
  const rows = await env.DB.prepare(
    `SELECT "email","token" FROM "wl_Subscriber" WHERE "status"='confirmed'`
  ).all<{ email: string; token: string }>();
  const list = rows.results || [];
  // 模板未包含退订按钮时，自动在邮件末尾补一个，确保每封邮件都能退订
  const tplHasUnsub = /\{\{\s*unsubscribe\s*\}\}/.test(bodyTpl);
  let sent = 0;
  let failed = 0;
  for (const s of list) {
    if (sent + failed >= 100) break;
    const vars: Record<string, string> = {
      site: cfg.siteName || "本站",
      email: s.email,
      unsubscribe: origin + "/api/subscribe/unsubscribe?token=" + s.token,
      ...extraVars,
    };
    try {
      let html = renderTemplate(bodyTpl, vars);
      if (!tplHasUnsub) {
        html +=
          '<hr><p style="color:#888;font-size:12px"><a href="' +
          vars.unsubscribe +
          '">不再接收邮件</a></p>';
      }
      await sendMail(mailSmtp(cfg), {
        to: s.email,
        subject: renderTemplate(subjectTpl, vars),
        html: wrapMailHtml(html),
      });
      sent++;
    } catch (e) {
      failed++;
      console.error("broadcast to " + s.email + " failed", e);
    }
  }
  return { sent, failed, total: list.length };
}

function subscribeResultPage(
  title: string,
  message: string,
  siteUrl?: string,
  unsubUrl?: string
): string {
  const back = siteUrl
    ? '<p style="margin-top:16px"><a href="' + siteUrl + '" style="color:#f97316">返回站点</a></p>'
    : "";
  const unsub = unsubUrl
    ? '<p style="margin-top:16px"><a href="' +
      unsubUrl +
      '" style="display:inline-block;padding:8px 18px;border:1px solid #d0d7de;border-radius:4px;color:#1f2328;text-decoration:none">取消订阅</a></p>'
    : "";
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    title +
    "</title></head>" +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    "font:14px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',Arial,sans-serif;" +
    'background:#f7f7f8;color:#1f2328">' +
    '<div style="max-width:420px;width:calc(100% - 32px);padding:28px;background:#fff;border:1px solid #e3e3e4;border-radius:6px;text-align:center">' +
    '<h1 style="margin:0 0 10px;font-size:18px">' +
    title +
    '</h1><p style="color:#6b7280;margin:0">' +
    message +
    "</p>" +
    unsub +
    back +
    "</div></body></html>"
  );
}

// 订阅者提交（公开）：POST /api/subscribe  body: {"email":"a@b.com"}
app.options("/api/subscribe", (c) => new Response(null, { status: 204, headers: VISIT_CORS }));

app.post("/api/subscribe", async (c) => {
  const db = (c.env as Bindings).DB;
  const body = (await c.req.json().catch(() => ({}))) as { email?: unknown };
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return subscribeJson({ ok: false, error: "邮箱格式不正确" }, 400);
  }
  try {
    const cfg = await getSubscribeConfig(db);
    if (!cfg.host || !cfg.port) {
      return subscribeJson({ ok: false, error: "订阅功能尚未配置" }, 503);
    }
    // 已订阅（待确认/已确认）的邮箱不再重复发送确认邮件；已退订的可重新订阅
    const existing = await db
      .prepare(`SELECT "status" FROM "wl_Subscriber" WHERE "email"=?1`)
      .bind(email)
      .first<{ status: string }>();
    if (existing && existing.status !== "unsubscribed") {
      return subscribeJson({
        ok: true,
        needConfirm: existing.status === "pending",
        message:
          existing.status === "confirmed"
            ? "该邮箱已订阅，无需重复订阅"
            : "该邮箱已提交订阅，请到邮箱完成确认",
      });
    }
    // 当日订阅上限（东八区）：达到后拒绝新订阅，防暴力刷订阅
    const limit = cfg.dailyLimit > 0 ? cfg.dailyLimit : 0;
    if (limit > 0) {
      const todayRow = await db
        .prepare(
          `SELECT COUNT(*) AS c FROM "wl_Subscriber" WHERE date("createdAt",'+8 hours')=?1`
        )
        .bind(visitDay())
        .first<{ c: number }>();
      if ((todayRow?.c ?? 0) >= limit) {
        return subscribeJson(
          { ok: false, error: `今日订阅名额已满（上限 ${limit}），请明天再试` },
          429
        );
      }
    }
    const token = randomToken();
    const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "";
    const ua = c.req.header("user-agent") || "";
    const status = cfg.needConfirm ? "pending" : "confirmed";
    await db
      .prepare(
        `INSERT INTO "wl_Subscriber" ("email","status","token","ip","ua","confirmedAt")
         VALUES (?1,?2,?3,?4,?5, CASE WHEN ?2='confirmed' THEN datetime('now') ELSE NULL END)
         ON CONFLICT("email") DO UPDATE SET "token"=?3,"status"=?2,"ip"=?4,"ua"=?5,"updatedAt"=datetime('now')`
      )
      .bind(email, status, token, ip, ua)
      .run();

    if (cfg.needConfirm) {
      const origin = new URL(c.req.url).origin;
      const vars = {
        site: cfg.siteName || "本站",
        email,
        link: origin + "/api/subscribe/confirm?token=" + token,
        unsubscribe: origin + "/api/subscribe/unsubscribe?token=" + token,
      };
      await sendMail(mailSmtp(cfg), {
        to: email,
        subject: renderTemplate(cfg.subject, vars),
        html: wrapMailHtml(renderTemplate(cfg.body, vars)),
      });
    }
    return subscribeJson({
      ok: true,
      needConfirm: cfg.needConfirm,
      message: cfg.needConfirm ? "确认邮件已发送，请查收邮箱完成订阅" : "订阅成功",
    });
  } catch (e) {
    console.error("subscribe failed", e);
    return subscribeJson(
      { ok: false, error: "订阅失败：" + (e instanceof Error ? e.message : String(e)) },
      500
    );
  }
});

// 确认订阅：GET /api/subscribe/confirm?token=xxx
app.get("/api/subscribe/confirm", async (c) => {
  const token = c.req.query("token") || "";
  const cfg = await getSubscribeConfig((c.env as Bindings).DB).catch(
    () => SUBSCRIBE_DEFAULT_CONFIG
  );
  if (!token) {
    return c.html(subscribeResultPage("链接无效", "缺少确认参数。", cfg.siteUrl), 400);
  }
  try {
    const r = await (c.env as Bindings).DB.prepare(
      `UPDATE "wl_Subscriber" SET "status"='confirmed',"confirmedAt"=datetime('now'),"updatedAt"=datetime('now') WHERE "token"=?1`
    )
      .bind(token)
      .run();
    const ok = ((r.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
    const unsubUrl =
      new URL(c.req.url).origin + "/api/subscribe/unsubscribe?token=" + token;
    return c.html(
      ok
        ? subscribeResultPage("订阅成功", "你已成功订阅，感谢关注！", cfg.siteUrl, unsubUrl)
        : subscribeResultPage("链接无效", "该确认链接已失效或不存在。", cfg.siteUrl),
      ok ? 200 : 404
    );
  } catch (e) {
    console.error("subscribe confirm failed", e);
    return c.html(subscribeResultPage("处理失败", "请稍后重试。", cfg.siteUrl), 500);
  }
});

// 退订：GET /api/subscribe/unsubscribe?token=xxx
app.get("/api/subscribe/unsubscribe", async (c) => {
  const token = c.req.query("token") || "";
  const cfg = await getSubscribeConfig((c.env as Bindings).DB).catch(
    () => SUBSCRIBE_DEFAULT_CONFIG
  );
  if (!token) {
    return c.html(subscribeResultPage("链接无效", "缺少退订参数。", cfg.siteUrl), 400);
  }
  try {
    const r = await (c.env as Bindings).DB.prepare(
      `UPDATE "wl_Subscriber" SET "status"='unsubscribed',"updatedAt"=datetime('now') WHERE "token"=?1`
    )
      .bind(token)
      .run();
    const ok = ((r.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
    // 用户主动退订成功后，发一封「已退订」提示邮件（后台删除不在此逻辑内）
    if (ok && cfg.host && cfg.port) {
      try {
        const sub = await (c.env as Bindings).DB.prepare(
          `SELECT "email" FROM "wl_Subscriber" WHERE "token"=?1`
        )
          .bind(token)
          .first<{ email: string }>();
        if (sub?.email) {
          const vars = {
            site: cfg.siteName || "本站",
            email: sub.email,
            unsubscribe: new URL(c.req.url).origin + "/api/subscribe/unsubscribe?token=" + token,
          };
          await sendMail(mailSmtp(cfg), {
            to: sub.email,
            subject: renderTemplate(cfg.unsubSubject, vars),
            html: wrapMailHtml(renderTemplate(cfg.unsubBody, vars)),
          });
        }
      } catch (e) {
        console.error("send unsubscribe mail failed", e);
      }
    }
    return c.html(
      ok
        ? subscribeResultPage("已退订", "你已成功退订，不会再收到邮件。", cfg.siteUrl)
        : subscribeResultPage("链接无效", "该退订链接已失效或不存在。", cfg.siteUrl),
      ok ? 200 : 404
    );
  } catch (e) {
    console.error("subscribe unsubscribe failed", e);
    return c.html(subscribeResultPage("处理失败", "请稍后重试。", cfg.siteUrl), 500);
  }
});

// 订阅数统计（公开）：GET /api/subscribe/stats
app.get("/api/subscribe/stats", async (c) => {
  try {
    const db = (c.env as Bindings).DB;
    await ensureSubscribeTables(db);
    const row = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM "wl_Subscriber") AS total,
                (SELECT COUNT(*) FROM "wl_Subscriber" WHERE "status"='confirmed') AS confirmed`
      )
      .first<{ total: number; confirmed: number }>();
    return subscribeJson({
      ok: true,
      total: row?.total ?? 0,
      confirmed: row?.confirmed ?? 0,
    });
  } catch (e) {
    return subscribeJson({ ok: false, total: 0, confirmed: 0 });
  }
});

// 读取订阅/SMTP 配置（管理员，密码不回传）
app.get("/admin/api/subscribe/settings", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  try {
    const cfg = await getSubscribeConfig((c.env as Bindings).DB);
    return json({ ok: true, ...cfg, pass: "", hasPass: !!cfg.pass });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// 保存订阅/SMTP 配置（管理员，pass 留空表示不修改）
app.put("/admin/api/subscribe/settings", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const asStr = (v: unknown, fb: string) => (v == null ? fb : String(v));
  const asBool = (v: unknown, fb: boolean) => (v == null ? fb : !!v);
  const asNum = (v: unknown, fb: number) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) && n > 0 && n < 65536 ? n : fb;
  };
  const asLimit = (v: unknown, fb: number) => {
    const n = parseInt(String(v ?? ""), 10);
    return Number.isFinite(n) && n > 0 && n <= 1000000 ? n : fb;
  };
  try {
    const cur = await getSubscribeConfig(db);
    const next: SubscribeConfig = {
      host: asStr(body.host, cur.host).trim(),
      port: asNum(body.port, cur.port),
      user: asStr(body.user, cur.user).trim(),
      pass: body.pass === undefined || body.pass === "" ? cur.pass : String(body.pass),
      fromName: asStr(body.fromName, cur.fromName),
      fromEmail: asStr(body.fromEmail, cur.fromEmail).trim(),
      secure: asBool(body.secure, cur.secure),
      siteName: asStr(body.siteName, cur.siteName),
      siteUrl: asStr(body.siteUrl, cur.siteUrl).trim(),
      subject: asStr(body.subject, cur.subject),
      body: asStr(body.body, cur.body),
      needConfirm: asBool(body.needConfirm, cur.needConfirm),
      notifySubject: asStr(body.notifySubject, cur.notifySubject),
      notifyBody: asStr(body.notifyBody, cur.notifyBody),
      unsubSubject: asStr(body.unsubSubject, cur.unsubSubject),
      unsubBody: asStr(body.unsubBody, cur.unsubBody),
      dailyLimit: asLimit(body.dailyLimit, cur.dailyLimit),
    };
    await saveSubscribeConfig(db, next);
    return json({ ok: true, ...next, pass: "", hasPass: !!next.pass });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// 发送测试邮件（管理员）：POST /admin/api/subscribe/test  body {"to":"..."}
app.post("/admin/api/subscribe/test", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { to?: unknown };
  const to = String(body?.to ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return json({ ok: false, error: "收件邮箱格式不正确" }, 400);
  }
  try {
    const cfg = await getSubscribeConfig((c.env as Bindings).DB);
    if (!cfg.host || !cfg.port) {
      return json({ ok: false, error: "请先填写并保存 SMTP 配置" }, 400);
    }
    await sendMail(mailSmtp(cfg), {
      to,
      subject: "【测试】" + (cfg.siteName || "邮件配置"),
      html: wrapMailHtml(
        "<p>这是一封测试邮件。</p><p>收到即表示你的 SMTP 配置可用，可以正常发送订阅邮件了。</p>"
      ),
    });
    return json({ ok: true, message: "测试邮件已发送，请查收" });
  } catch (e) {
    console.error("subscribe test failed", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// 订阅者列表（管理员）：GET /admin/api/subscribe/list?status=&q=&page=&pageSize=
app.get("/admin/api/subscribe/list", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const db = (c.env as Bindings).DB;
  try {
    await ensureSubscribeTables(db);
    const page = Math.max(1, parseInt(c.req.query("page") || "1", 10) || 1);
    const pageSize = Math.min(
      200,
      Math.max(1, parseInt(c.req.query("pageSize") || "50", 10) || 50)
    );
    const status = c.req.query("status") || "";
    const q = (c.req.query("q") || "").trim();
    const where: string[] = [];
    const binds: unknown[] = [];
    if (["pending", "confirmed", "unsubscribed"].includes(status)) {
      where.push('"status"=?');
      binds.push(status);
    }
    if (q) {
      where.push('"email" LIKE ?');
      binds.push("%" + q + "%");
    }
    const clause = where.length ? " WHERE " + where.join(" AND ") : "";
    const totalRow = await db
      .prepare(`SELECT COUNT(*) AS count FROM "wl_Subscriber"` + clause)
      .bind(...binds)
      .first<{ count: number }>();
    const rows = await db
      .prepare(
        `SELECT "id","email","status","createdAt","confirmedAt" FROM "wl_Subscriber"` +
          clause +
          ` ORDER BY "id" DESC LIMIT ? OFFSET ?`
      )
      .bind(...binds, pageSize, (page - 1) * pageSize)
      .all();
    const stats = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM "wl_Subscriber") AS total,
                (SELECT COUNT(*) FROM "wl_Subscriber" WHERE "status"='confirmed') AS confirmed,
                (SELECT COUNT(*) FROM "wl_Subscriber" WHERE "status"='pending') AS pending,
                (SELECT COUNT(*) FROM "wl_Subscriber" WHERE "status"='unsubscribed') AS unsubscribed,
                (SELECT COUNT(*) FROM "wl_Subscriber" WHERE date("createdAt",'+8 hours')=?1) AS today`
      )
      .bind(visitDay())
      .first();
    return json({
      ok: true,
      page,
      pageSize,
      total: totalRow?.count ?? 0,
      stats,
      list: rows.results || [],
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// 删除订阅者（管理员）：DELETE /admin/api/subscribe/subscriber?id=1
app.delete("/admin/api/subscribe/subscriber", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const id = parseInt(c.req.query("id") || "", 10);
  if (!Number.isFinite(id)) return json({ error: "id 无效" }, 400);
  try {
    await (c.env as Bindings).DB.prepare(`DELETE FROM "wl_Subscriber" WHERE "id"=?1`)
      .bind(id)
      .run();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// 手动通过（管理员）：POST /admin/api/subscribe/approve  body {"id":1}
// 将「待确认」订阅者直接置为「已确认」，无需对方点邮件确认
app.post("/admin/api/subscribe/approve", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { id?: unknown };
  const id = parseInt(String(body?.id ?? ""), 10);
  if (!Number.isFinite(id)) return json({ ok: false, error: "id 无效" }, 400);
  try {
    const r = await (c.env as Bindings).DB.prepare(
      `UPDATE "wl_Subscriber" SET "status"='confirmed',"confirmedAt"=datetime('now'),"updatedAt"=datetime('now')
       WHERE "id"=?1 AND "status"!='confirmed'`
    )
      .bind(id)
      .run();
    const changed = ((r.meta as { changes?: number } | undefined)?.changes ?? 0) > 0;
    return json({ ok: true, changed });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

// 群发邮件给全部已确认订阅者（管理员）：POST /admin/api/subscribe/send
// body {"subject":"...","body":"<html>"}，单次最多 100 封（避免 Worker 超时）
app.post("/admin/api/subscribe/send", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    subject?: unknown;
    body?: unknown;
  };
  const subject = String(body?.subject ?? "").trim();
  const content = String(body?.body ?? "").trim();
  if (!subject || !content) return json({ ok: false, error: "主题和正文不能为空" }, 400);
  try {
    const origin = new URL(c.req.url).origin;
    const r = await broadcastToConfirmed(c.env as Bindings, subject, content, {}, origin);
    if (!r.total) return json({ ok: false, error: "暂无已确认的订阅者" }, 400);
    return json({ ok: true, ...r, limited: r.total > 100 });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// 新文章发布通知（内部接口）：由 GitHub Actions 在博客构建完成后回调
// 鉴权：请求头 x-notify-secret 必须等于 Worker 的 GH_TOKEN（与工作流的 secrets.GH_TOKEN 同值）
// body {"title":"文章标题","url":"文章链接"}
app.post("/api/internal/notify-published", async (c) => {
  const env = c.env as Bindings;
  const secret = c.req.header("x-notify-secret") || "";
  if (!env.GH_TOKEN || secret !== env.GH_TOKEN) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = (await c.req.json().catch(() => ({}))) as { title?: unknown; url?: unknown };
  const title = String(body?.title ?? "").trim();
  const url = String(body?.url ?? "").trim();
  if (!title) return json({ ok: false, error: "title required" }, 400);
  try {
    const cfg = await getSubscribeConfig(env.DB);
    const origin = new URL(c.req.url).origin;
    const r = await broadcastToConfirmed(
      env,
      cfg.notifySubject,
      cfg.notifyBody,
      { title, url },
      origin
    );
    return json({ ok: true, ...r });
  } catch (e) {
    console.error("notify published failed", e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// ---------- 文件管理（GitHub Contents API）----------
app.get("/admin/api/branches", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleListBranches(c.env as Bindings);
});

app.get("/admin/api/files", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const path = c.req.query("path") || "";
  const branch = c.req.query("branch") || "";
  return handleListFiles(c.env as Bindings, path, branch || undefined);
});

app.get("/admin/api/file", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const path = c.req.query("path") || "";
  if (!path) return json({ error: "path required" }, 400);
  const branch = c.req.query("branch") || "";
  return handleGetFile(c.env as Bindings, path, branch || undefined);
});

app.put("/admin/api/file", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleSaveFile(c.env as Bindings, await c.req.json());
});

// 回收站：批量移入 / 恢复 / 彻底删除（回收站为同分支下的 _recycle 目录，不单独开分支）
app.post("/admin/api/files/recycle", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { paths?: unknown; branch?: unknown };
  return json(await handleRecyclePaths(c.env as Bindings, body.paths, body.branch));
});

app.post("/admin/api/files/restore", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { paths?: unknown; branch?: unknown };
  return json(await handleRestorePaths(c.env as Bindings, body.paths, body.branch));
});

app.post("/admin/api/files/purge", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as { paths?: unknown; branch?: unknown };
  return json(await handlePurgePaths(c.env as Bindings, body.paths, body.branch));
});

app.post("/admin/api/upload", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleUploadFile(c.env as Bindings, c.req.raw);
});

app.post("/admin/api/unzip", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleUnzipFile(c.env as Bindings, c.req.raw);
});

app.post("/admin/api/unzip-path", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleUnzipByPath(c.env as Bindings, await c.req.json());
});

// 从网络下载文件保存进仓库
app.post("/admin/api/download", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleDownloadFile(c.env as Bindings, await c.req.json().catch(() => ({})));
});

// 大文件解压工作流状态
app.get("/admin/api/unzip-status", async (c) => {
  if (!isAdmin(c.get("userInfo"))) return json({ error: "unauthorized" }, 401);
  return handleUnzipStatus(c.env as Bindings);
});

// ---------- 5. /admin 统一管理后台（独立页面：管理文章 / 写作 / 评论 / 文件）----------
// 独立登录页：未登录跳转到 /admin/login
app.get("/admin/login", (c) => c.html(renderAdminLoginPage(c.env.SITE_URL || "")));
app.get("/admin/login/", (c) => c.html(renderAdminLoginPage(c.env.SITE_URL || "")));
// 已登录访问任意后台页直接渲染，不做跳转
// 后台页面内联了脚本/样式：禁止缓存，避免更新部署后仍拿到旧界面（如 Markdown 不渲染）
const adminPage = (c: any, initial: string) => {
  c.header("Cache-Control", "no-store, must-revalidate");
  return c.html(renderAdminPage(c.env.SITE_URL || "", c.env.GH_REPO || "", initial));
};
app.get("/admin", (c) => adminPage(c, "manage"));
app.get("/admin/", (c) => adminPage(c, "manage"));
app.get("/admin/manage", (c) => adminPage(c, "manage"));
app.get("/admin/manage/", (c) => adminPage(c, "manage"));
app.get("/admin/write", (c) => adminPage(c, "write"));
app.get("/admin/write/", (c) => adminPage(c, "write"));
app.get("/admin/comments", (c) => adminPage(c, "comments"));
app.get("/admin/comments/", (c) => adminPage(c, "comments"));
app.get("/admin/files", (c) => adminPage(c, "files"));
app.get("/admin/files/", (c) => adminPage(c, "files"));
app.get("/admin/build", (c) => adminPage(c, "build"));
app.get("/admin/build/", (c) => adminPage(c, "build"));
app.get("/admin/visit", (c) => adminPage(c, "visit"));
app.get("/admin/visit/", (c) => adminPage(c, "visit"));
app.get("/admin/subscribe", (c) => adminPage(c, "subscribe"));
app.get("/admin/subscribe/", (c) => adminPage(c, "subscribe"));
app.get("/admin/ai", (c) => adminPage(c, "ai"));
app.get("/admin/ai/", (c) => adminPage(c, "ai"));
// 带会话 id：/admin/ai/<id>，刷新后仍停留在该对话
app.get("/admin/ai/:id", (c) => adminPage(c, "ai"));
app.get("/admin/ai/:id/", (c) => adminPage(c, "ai"));
app.get("/admin/settings", (c) => adminPage(c, "settings"));
app.get("/admin/settings/", (c) => adminPage(c, "settings"));

// ---------- 6. 其余路径：反向代理 GitHub Pages 静态站点 ----------
app.all("*", async (c) => {
  const env = c.env as Bindings;
  const url = new URL(c.req.url);
  const path = url.pathname;

  // /ui（原 waline 后台）并入统一后台 /admin
  if (path === "/ui" || path.startsWith("/ui/")) {
    return Response.redirect(`${url.origin}/admin`, 302);
  }

  const pagesBase = pagesBaseUrl(env);
  // 注意：不能用 new URL(path, pagesBase)，因为前导 "/" 会丢掉 pagesBase 的路径前缀。
  // 项目站点的 pagesBase 形如 https://<owner>.github.io/<repo>，必须把 /<repo> 拼回去。
  const target = new URL(pagesBase + "/");
  const basePath = target.pathname.replace(/\/+$/, ""); // 用户站点为 ""，项目站点为 "/<repo>"
  let reqPath = path.startsWith("/") ? path : "/" + path;
  // 项目站点的 Hexo root 会是 /<repo>/，页面资源会带该前缀；这里先剥掉，避免拼成 /<repo>/<repo>/...
  if (basePath && reqPath === basePath) reqPath = "/";
  else if (basePath && reqPath.startsWith(basePath + "/")) reqPath = reqPath.slice(basePath.length);
  target.pathname = basePath + reqPath;
  target.search = url.search;
  if (reqPath.endsWith("/")) {
    target.pathname += "index.html";
  }
  try {
    const resp = await fetch(target.toString());
    if (resp.status === 404 && path !== "/") {
      const root = await fetch(pagesBase + "/");
      return new Response(root.body, {
        status: 200,
        headers: root.headers,
      });
    }
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  } catch (e) {
    return new Response("Worker proxy error: " + String(e), { status: 502 });
  }
});

// ==================== GitHub 文章 CRUD 逻辑 ====================

function ghConfig(env: Bindings) {
  const token = env.GH_TOKEN;
  const repo = env.GH_REPO || "kf1145fan/kf1145fan.github.io";
  const branch = env.GH_BRANCH || "main";
  const postsDir = env.POSTS_DIR || "source/_posts";
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "user-agent": "blog-worker",
    "content-type": "application/json",
  };
  return { token, repo, branch, postsDir, headers };
}

async function handleListPosts(env: Bindings): Promise<Response> {
  const { token, repo, postsDir, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/${postsDir}`,
      { headers },
    );
    if (!res.ok) return json({ ok: false, error: "github error " + res.status }, 502);
    const data = (await res.json()) as any[];
    const files = (data || []).filter((f) => f.name?.endsWith(".md"));

    // 并行读取每篇 front matter，提取分类/标签/日期
    const posts = await Promise.all(files.map(async (f) => {
      let categories: string[] = [];
      let tags: string[] = [];
      let date = "";
      try {
        const g = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(f.path)}`, { headers });
        if (g.ok) {
          const d = (await g.json()) as any;
          const raw = decodeURIComponent(escape(atob(d.content)));
          const parsed = parseFrontMatter(raw);
          categories = parsed.categories || [];
          tags = parsed.tags || [];
          date = parsed.date || "";
        }
      } catch {}
      // 日期回退：优先 front matter date，其次文件名内 YYYY-MM-DD 前缀，最后用名字兜底
      const nameDate = String(f.name || "").match(/(\d{4}[-.]\d{2}[-.]\d{2})/);
      const sortDate = date || (nameDate ? nameDate[1].replace(/\./g, "-") : "");
      return { name: f.name, path: f.path, sha: f.sha, size: f.size, categories, tags, date: sortDate };
    }));

    // 按日期倒序（最新在前）
    posts.sort((a, b) => (b.date || "").localeCompare(a.date || "") || String(b.name).localeCompare(String(a.name)));

    // 聚合历史分类/标签（供输入框下拉建议）
    const allCategories = [...new Set(posts.flatMap((p) => p.categories))];
    const allTags = [...new Set(posts.flatMap((p) => p.tags))];

    return json({ ok: true, posts, allCategories, allTags });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleGetPost(env: Bindings, path: string): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`,
      { headers },
    );
    if (!res.ok) return json({ ok: false, error: "github error " + res.status }, 502);
    const data = (await res.json()) as any;
    const raw = decodeURIComponent(escape(atob(data.content)));
    const parsed = parseFrontMatter(raw);
    return json({
      ok: true,
      post: { path: data.path, sha: data.sha, content: raw, ...parsed },
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleWritePost(
  env: Bindings,
  body: any,
  isUpdate: boolean,
): Promise<Response> {
  const { token, repo, branch, postsDir, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);

  const title = String(body.title || "").trim();
  const content = String(body.content || "");
  const tags = Array.isArray(body.tags) ? body.tags.map((x: any) => String(x)) : [];
  const categories = Array.isArray(body.categories)
    ? body.categories.map((x: any) => String(x))
    : [];
  const date = String(body.date || new Date().toISOString().slice(0, 10));
  const targetPath = String(body.path || "").trim();

  if (!title) return json({ ok: false, error: "title required" }, 400);
  if (!content) return json({ ok: false, error: "content required" }, 400);

  const slug = title
    .replace(/[^\w\u4e00-\u9fa5\- ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const filename = isUpdate && targetPath ? targetPath.split("/").pop()! : `${date}-${slug || "post"}.md`;
  const path = isUpdate && targetPath ? targetPath : `${postsDir}/${filename}`;

  // front matter
  const fm: string[] = ["---", `title: '${title.replace(/'/g, "\\'")}'`, `date: ${date} 00:00:00`];
  if (categories.length) fm.push(`categories:\n  ${categories.map((x: any) => `- ${x}`).join("\n  ")}`);
  if (tags.length) fm.push(`tags:\n  ${tags.map((x: any) => `- ${x}`).join("\n  ")}`);
  fm.push("---", "");
  const fileContent = fm.join("\n") + (isUpdate ? stripFrontMatter(content) : content) + "\n";

  const rawApi = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  let sha: string | undefined;
  try {
    const exist = await fetch(rawApi, { headers });
    if (exist.ok) sha = ((await exist.json()) as any).sha;
  } catch {}

  const payload: any = {
    message: isUpdate ? `docs: update post ${filename}` : `docs: add post ${filename}`,
    content: btoa(unescape(encodeURIComponent(fileContent))),
    branch,
  };
  if (sha) payload.sha = sha;

  try {
    const res = await fetch(rawApi, { method: "PUT", headers, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json({ ok: false, error: "github error: " + (data as any).message || res.status }, 502);

    // 仅「添加新文章」时触发构建，并在构建完成后由工作流回调通知订阅者。
    // 手动运行工作流不会带 notify 参数，所以不会发邮件。
    let notifyPipeline = false;
    if (!isUpdate) {
      // 优先用站点对外地址（SITE_URL，未配置时由中间件取当前请求域名），回退到 GitHub Pages 地址
      const pagesUrl =
        (env.SITE_URL || "").trim().replace(/\/+$/, "") || pagesBaseUrl(env);
      const pageTitle = filename.replace(/\.md$/, "");
      const postUrl = pagesUrl
        ? pagesUrl +
          "/" +
          (date.replace(/-/g, "/") + "/" + pageTitle)
            .split("/")
            .map(encodeURIComponent)
            .join("/") +
          "/"
        : path;
      const disp = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/update-gh.yml/dispatches`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            ref: branch,
            inputs: { notify: "true", post_title: title, post_url: postUrl },
          }),
        }
      ).catch(() => null);
      notifyPipeline = !!disp && disp.ok;
    }
    return json({
      ok: true,
      path,
      filename,
      notifyPipeline,
      message: notifyPipeline
        ? "已提交，正在构建博客；构建完成后会自动邮件通知订阅者"
        : "已提交，工作流会自动重建博客",
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// ---------- 回收站（同分支 _recycle 目录，可恢复 / 彻底删除）----------
const RECYCLE_DIR = "_recycle";

type OpResult = { path: string; ok: boolean; moved?: string; error?: string };

// 读取仓库节点（文件或目录）；不存在返回 null
async function ghGetNode(env: Bindings, path: string, branch: string): Promise<any | null> {
  const { repo, headers } = ghConfig(env);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/contents/${ghPath(path)}?ref=${encodeURIComponent(branch)}`,
      { headers },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// 目标已存在时自动加序号，避免覆盖
async function freePath(env: Bindings, path: string, branch: string): Promise<string> {
  if (!(await ghGetNode(env, path, branch))) return path;
  const idx = path.lastIndexOf("/");
  const dir = idx >= 0 ? path.slice(0, idx) : "";
  const base = idx >= 0 ? path.slice(idx + 1) : path;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let i = 1; i <= 100; i++) {
    const cand = (dir ? dir + "/" : "") + `${stem}-${i}${ext}`;
    if (!(await ghGetNode(env, cand, branch))) return cand;
  }
  return `${path}-${Date.now()}`;
}

// 移动文件/目录（目录递归），返回实际落点
async function movePath(
  env: Bindings,
  from: string,
  to: string,
  branch: string,
): Promise<{ ok: boolean; moved?: string; error?: string }> {
  const { token, repo, headers } = ghConfig(env);
  if (!token) return { ok: false, error: "GH_TOKEN not configured" };
  const node = await ghGetNode(env, from, branch);
  if (!node) return { ok: false, error: "未找到 " + from };

  if (Array.isArray(node)) {
    const target = await freePath(env, to, branch);
    for (const f of node as any[]) {
      const rel = String(f.path).slice(String(from).length).replace(/^\/+/, "");
      const r = await movePath(env, f.path, `${target}/${rel}`, branch);
      if (!r.ok) return r;
    }
    return { ok: true, moved: target };
  }

  const target = await freePath(env, to, branch);
  let content: string = node.content || "";
  if (!content && node.git_url) {
    // 超过 1MB 的文件 contents API 不返回内容，改取 blob
    try {
      const b = await fetch(node.git_url, { headers });
      if (b.ok) content = ((await b.json()) as any).content || "";
    } catch {}
  }
  const put = await fetch(`https://api.github.com/repos/${repo}/contents/${ghPath(target)}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ message: `docs: move ${from} -> ${target}`, content, branch }),
  });
  if (!put.ok) return { ok: false, error: "写入目标失败 " + put.status };
  const del = await fetch(`https://api.github.com/repos/${repo}/contents/${ghPath(from)}`, {
    method: "DELETE",
    headers,
    body: JSON.stringify({ sha: node.sha, message: `docs: move ${from} -> ${target}`, branch }),
  });
  if (!del.ok) return { ok: false, error: "删除源失败 " + del.status };
  return { ok: true, moved: target };
}

function normalizePaths(input: unknown): string[] {
  return Array.isArray(input)
    ? input.map((x: unknown) => String(x).replace(/^\/+|\/+$/g, "")).filter(Boolean)
    : [];
}

// 移入回收站（文章删除、文件管理删除、批量删除共用）
async function handleRecyclePaths(env: Bindings, input: unknown, branchIn?: unknown) {
  const branch = String(branchIn || "").trim() || ghConfig(env).branch;
  const paths = normalizePaths(input);
  const results: OpResult[] = [];
  if (!paths.length) return { ok: false, error: "paths required", moved: 0, total: 0, results };
  for (const p of paths) {
    if (p === RECYCLE_DIR || p.startsWith(RECYCLE_DIR + "/")) {
      results.push({ path: p, ok: false, error: "已在回收站中" });
      continue;
    }
    const r = await movePath(env, p, `${RECYCLE_DIR}/${p}`, branch);
    results.push({ path: p, ok: r.ok, moved: r.moved, error: r.error });
  }
  const moved = results.filter((r) => r.ok).length;
  return { ok: moved > 0, moved, total: paths.length, results };
}

// 从回收站恢复（回到原路径）
async function handleRestorePaths(env: Bindings, input: unknown, branchIn?: unknown) {
  const branch = String(branchIn || "").trim() || ghConfig(env).branch;
  const paths = normalizePaths(input);
  const results: OpResult[] = [];
  if (!paths.length) return { ok: false, error: "paths required", restored: 0, total: 0, results };
  for (const p of paths) {
    if (!p.startsWith(RECYCLE_DIR + "/")) {
      results.push({ path: p, ok: false, error: "不在回收站中" });
      continue;
    }
    const r = await movePath(env, p, p.slice(RECYCLE_DIR.length + 1), branch);
    results.push({ path: p, ok: r.ok, moved: r.moved, error: r.error });
  }
  const restored = results.filter((r) => r.ok).length;
  return { ok: restored > 0, restored, total: paths.length, results };
}

// 彻底删除（不可恢复）
async function handlePurgePaths(env: Bindings, input: unknown, branchIn?: unknown) {
  const branch = String(branchIn || "").trim() || ghConfig(env).branch;
  const paths = normalizePaths(input);
  const results: OpResult[] = [];
  if (!paths.length) return { ok: false, error: "paths required", purged: 0, total: 0, results };
  for (const p of paths) {
    const r = await deletePath(env, p, branch);
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    results.push({ path: p, ok: r.ok && !!d.ok, error: d?.error });
  }
  const purged = results.filter((r) => r.ok).length;
  return { ok: purged > 0, purged, total: paths.length, results };
}

// 批量上传 Markdown 文章：自动补 front matter，重名自动加序号
async function handleUploadPosts(env: Bindings, files: unknown): Promise<Response> {
  const { token, repo, branch, postsDir, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  const list = Array.isArray(files) ? (files as any[]) : [];
  if (!list.length) return json({ ok: false, error: "files required" }, 400);

  const results: Array<{ name: string; path?: string; ok: boolean; error?: string }> = [];
  for (const item of list) {
    const rawName = String(item?.name || "").trim();
    const content = String(item?.content ?? "");
    try {
      if (!rawName) throw new Error("文件名为空");
      if (!content.trim()) throw new Error("文件内容为空");
      let base = (rawName.split(/[\\/]/).pop() || "").replace(/[^\w\u4e00-\u9fa5.\- ]/g, "").trim();
      if (!base) throw new Error("文件名无效");
      if (!/\.(md|markdown)$/i.test(base)) base = base.replace(/\.(txt|text)$/i, "") + ".md";

      // 同名文件自动加序号，避免覆盖
      let filename = base;
      for (let n = 1; n <= 100; n++) {
        const exists = await fetch(
          `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(`${postsDir}/${filename}`)}`,
          { headers },
        );
        if (!exists.ok) break;
        filename = base.replace(/\.md$/i, "") + "-" + n + ".md";
      }
      const path = `${postsDir}/${filename}`;

      let body = content;
      if (!/^---\r?\n/.test(content)) {
        const title = filename.replace(/\.md$/i, "");
        const date = new Date().toISOString().slice(0, 10);
        body = `---\ntitle: '${title.replace(/'/g, "\\'")}'\ndate: ${date} 00:00:00\n---\n\n${content}\n`;
      } else if (!body.endsWith("\n")) {
        body += "\n";
      }

      const put = await fetch(
        `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            message: `docs: add post ${filename}`,
            content: btoa(unescape(encodeURIComponent(body))),
            branch,
          }),
        },
      );
      if (!put.ok) throw new Error("github error " + put.status);
      results.push({ name: rawName, path, ok: true });
    } catch (e) {
      results.push({
        name: rawName || "(未命名)",
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const created = results.filter((r) => r.ok).length;
  return json({ ok: created > 0, created, total: results.length, results });
}

// ---------- front matter 解析（逐行，稳健）----------
function parseFrontMatter(raw: string): {
  title: string;
  date: string;
  categories: string[];
  tags: string[];
  body: string;
} {
  let title = "";
  const categories: string[] = [];
  const tags: string[] = [];
  let date = "";
  let body = raw;
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (m) {
    body = m[2];
    const lines = m[1].split(/\r?\n/);
    let key = ""; // categories / tags
    const cleanList = (v: string): string[] =>
      v.replace(/\[|\]|"|'/g, "").split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    for (const line of lines) {
      const kv = line.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
      if (kv) {
        const k = kv[1].toLowerCase();
        const v = kv[2];
        if (k === "title") title = v.trim();
        else if (k === "date") {
          const d = v.match(/(\d{4}-\d{2}-\d{2})/);
          if (d) date = d[1];
        } else if (k === "categories") {
          key = "categories";
          if (v.trim()) categories.push(...cleanList(v));
          else categories.length = 0;
        } else if (k === "tags") {
          key = "tags";
          if (v.trim()) tags.push(...cleanList(v));
          else tags.length = 0;
        } else if (k === "theme") {
          // 忽略
        } else {
          // 其他键（title/date 之外的历史选项），停止收集列表项
          if (!/^(categories|tags)$/.test(k)) key = "";
        }
      } else {
        // 列表项：连字符开头
        const item = line.trim();
        if (key && /^[-*]\s+/.test(item)) {
          const v = item.replace(/^[-*]\s*/, "").trim();
          if (v) (key === "categories" ? categories : tags).push(v);
        }
      }
    }
  }
  return { title, date, categories, tags, body: body.replace(/<!--\s*more\s*-->[\s\S]*$/, "").trimStart() };
}

function stripFrontMatter(content: string): string {
  const m = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return (m ? m[1] : content).trimStart();
}

// ---------- 部署工作流状态 ----------
async function handleBuildStatus(env: Bindings): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    // 查询最近几次 workflow run（deploy.yml 由 push / workflow_dispatch 触发）
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/runs?per_page=5`,
      { headers },
    );
    if (!res.ok) return json({ ok: false, error: "github error " + res.status }, 502);
    const data = (await res.json()) as any;
    const runs = ((data.workflow_runs || []) as any[]).map((r: any) => ({
      id: r.id,
      event: r.event || "",
      status: r.status,
      conclusion: r.conclusion || "",
      created_at: r.created_at || "",
      html_url: r.html_url || "",
    }));
    const latest = runs[0] || null;
    if (!latest) return json({ ok: true, running: false, status: "none", conclusion: "none", runs: [] });
    const isActive = (s: string) => s === "in_progress" || s === "queued" || s === "pending" || s === "waiting";
    // 只要最近几次里还有正在运行的，就视为整体运行中
    const running = runs.some((r: any) => isActive(r.status));
    return json({
      ok: true,
      running,
      status: latest.status,
      conclusion: latest.conclusion || "",
      name: data.workflow_runs?.[0]?.name || data.workflow_runs?.[0]?.display_title || "",
      started: latest.created_at || "",
      html_url: latest.html_url || "",
      latest,
      runs,
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 手动触发部署工作流（改完文章/文件后一键重建站点）
async function handleTriggerBuild(env: Bindings): Promise<Response> {
  const { token, repo, branch, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/dispatches`,
      { method: "POST", headers, body: JSON.stringify({ ref: branch }) },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json({ ok: false, error: "触发失败 github error " + res.status, detail }, 502);
    }
    return json({ ok: true, message: "已触发部署工作流" });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 部署历史记录（最近 20 次）
async function handleBuildHistory(env: Bindings): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/runs?per_page=20`,
      { headers },
    );
    if (!res.ok) return json({ ok: false, error: "github error " + res.status }, 502);
    const data = (await res.json()) as any;
    const runs = ((data.workflow_runs || []) as any[]).map((r: any) => ({
      id: r.id,
      name: r.display_title || r.name || "",
      status: r.status,
      conclusion: r.conclusion || "",
      created_at: r.created_at || "",
      head_sha: (r.head_sha || "").slice(0, 7),
      html_url: r.html_url || "",
    }));
    return json({ ok: true, runs });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 部署工作流日志（Cloudflare 代理）：获取 GitHub Actions 运行日志 zip，解压为纯文本返回。
// GitHub 的 /actions/runs/{id}/logs 会 302 到签名地址（zip），fetch 自动跟随；用 fflate 解压。
async function handleBuildLog(env: Bindings, runId: string): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    let id = String(runId || "").trim();
    if (!id) {
      const lr = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/deploy.yml/runs?per_page=1`,
        { headers },
      );
      if (!lr.ok) return json({ ok: false, error: "github error " + lr.status }, 502);
      const ld = (await lr.json()) as any;
      id = String(ld.workflow_runs?.[0]?.id || "");
      if (!id) return json({ ok: false, error: "没有可用的工作流运行记录" }, 404);
    }
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${id}/logs`, { headers });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json({ ok: false, error: "获取日志失败 github error " + res.status, detail: detail.slice(0, 300) }, 502);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    let text = "";
    try {
      const files = unzipSync(buf);
      const names = Object.keys(files).sort();
      const parts: string[] = [];
      for (const name of names) {
        parts.push("===== " + name + " =====\n" + new TextDecoder().decode(files[name]));
      }
      text = parts.join("\n\n");
    } catch {
      // 极少数情况下不是 zip，直接按文本解码
      text = new TextDecoder().decode(buf);
    }
    const max = 200000;
    const truncated = text.length > max;
    if (truncated) text = "...(日志过长，已截断，仅保留末尾)\n" + text.slice(-max);
    return json({ ok: true, id, truncated, text });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// ---------- 文件管理 ----------
function ghPath(path: string): string {
  return String(path || "").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

async function handleListBranches(env: Bindings): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, { headers });
    if (!res.ok) return json({ ok: false, error: "github error " + res.status }, 502);
    const data = (await res.json()) as any[];
    const branches = (data || []).map((b: any) => b.name).filter(Boolean);
    const current = ghConfig(env).branch;
    return json({ ok: true, branches, current });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleListFiles(env: Bindings, path: string, branch?: string): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  const useBranch = branch || ghConfig(env).branch;
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const clean = String(path || "").replace(/^\/+|\/+$/g, "");
    const url = clean
      ? `https://api.github.com/repos/${repo}/contents/${ghPath(clean)}?ref=${encodeURIComponent(useBranch)}`
      : `https://api.github.com/repos/${repo}/contents/?ref=${encodeURIComponent(useBranch)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 404) return json({ ok: false, error: "目录不存在" }, 404);
      return json({ ok: false, error: "github error " + res.status }, 502);
    }
    const data = (await res.json()) as any[];
    const items = (data || []).map((f: any) => ({
      name: f.name,
      path: f.path,
      type: f.type,
      size: f.size || 0,
    }));
    return json({ ok: true, path: clean, branch: useBranch, items });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleGetFile(env: Bindings, path: string, branch?: string): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  const useBranch = branch || ghConfig(env).branch;
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${ghPath(path)}?ref=${encodeURIComponent(useBranch)}`, { headers });
    if (!res.ok) return json({ ok: false, error: "github error " + res.status }, 502);
    const d = (await res.json()) as any;
    if (d.type !== "file") return json({ ok: false, error: "不是文件" }, 400);
    // 二进制文件（图片等）仅返回元信息
    const raw = decodeURIComponent(escape(atob(d.content)));
    const isBinary = /[\x00-\x08\x0e-\x1f]/.test(raw.slice(0, 4096));
    return json({
      ok: true,
      path: d.path,
      sha: d.sha,
      size: d.size,
      content: isBinary ? "" : raw,
      binary: isBinary,
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

async function handleSaveFile(env: Bindings, body: any): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  const useBranch = String(body.branch || "").trim() || ghConfig(env).branch;
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  const path = String(body.path || "").trim();
  const content = String(body.content ?? "");
  if (!path) return json({ ok: false, error: "path required" }, 400);
  try {
    const rawApi = `https://api.github.com/repos/${repo}/contents/${ghPath(path)}`;
    let sha: string | undefined;
    const exist = await fetch(`${rawApi}?ref=${encodeURIComponent(useBranch)}`, { headers });
    if (exist.ok) sha = ((await exist.json()) as any).sha;
    const payload: any = {
      message: `docs: update ${path}`,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: useBranch,
    };
    if (sha) payload.sha = sha;
    const res = await fetch(rawApi, { method: "PUT", headers, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return json({ ok: false, error: "github error: " + ((data as any).message || res.status) }, 502);
    return json({ ok: true, path, branch: useBranch, message: "已保存" });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 递归删除文件/目录（GitHub 目录需逐个删文件）
async function deletePath(env: Bindings, path: string, branch?: string): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  const useBranch = branch || ghConfig(env).branch;
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const rawApi = `https://api.github.com/repos/${repo}/contents/${ghPath(path)}`;
    const exist = await fetch(`${rawApi}?ref=${encodeURIComponent(useBranch)}`, { headers });
    if (!exist.ok) return json({ ok: false, error: "未找到 " + path }, 404);
    const data = (await exist.json()) as any;
    if (Array.isArray(data)) {
      for (const f of data as any[]) {
        const r = await deletePath(env, f.path, useBranch);
        const rr = (await r.json()) as { ok?: boolean };
        if (!rr.ok) return r;
      }
      return json({ ok: true, message: "已删除目录 " + path });
    }
    const res = await fetch(rawApi, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ sha: data.sha, message: `docs: delete ${path}`, branch: useBranch }),
    });
    if (!res.ok) return json({ ok: false, error: "github error " + res.status }, 502);
    return json({ ok: true, message: "已删除 " + path });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 上传文件（multipart：path=目标目录, branch=分支, files=多个文件）
async function handleUploadFile(env: Bindings, req: Request): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const form = await req.formData();
    const dir = String((form.get("path") || "") as string).replace(/^\/+|\/+$/g, "");
    const useBranch = String((form.get("branch") || "") as string).trim() || ghConfig(env).branch;
    const files = (form.getAll("files") as any[]).filter((f) => f && typeof f === "object") as File[];
    if (!files.length) return json({ ok: false, error: "没有文件" }, 400);
    const saved: string[] = [];
    for (const f of files) {
      const name = f.name.split("/").pop() || "";
      const target = dir ? `${dir}/${name}` : name;
      const buf = new Uint8Array(await f.arrayBuffer());
      const content = bytesToBase64(buf);
      const rawApi = `https://api.github.com/repos/${repo}/contents/${ghPath(target)}`;
      let sha: string | undefined;
      const exist = await fetch(`${rawApi}?ref=${encodeURIComponent(useBranch)}`, { headers });
      if (exist.ok) sha = ((await exist.json()) as any).sha;
      const payload: any = { message: `docs: upload ${target}`, content, branch: useBranch };
      if (sha) payload.sha = sha;
      const res = await fetch(rawApi, { method: "PUT", headers, body: JSON.stringify(payload) });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return json({ ok: false, error: `上传 ${name} 失败: ${(d as any).message || res.status}` }, 502);
      }
      saved.push(target);
    }
    return json({ ok: true, saved, message: `已上传 ${saved.length} 个文件` });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 解压 zip（multipart：path=目标目录, branch=分支, zip=zip 文件）
async function handleUnzipFile(env: Bindings, req: Request): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const form = await req.formData();
    const dir = String((form.get("path") || "") as string).replace(/^\/+|\/+$/g, "");
    const useBranch = String((form.get("branch") || "") as string).trim() || ghConfig(env).branch;
    const zipFile = form.get("zip") as File | null;
    if (!zipFile) return json({ ok: false, error: "没有 zip 文件" }, 400);
    const buf = new Uint8Array(await zipFile.arrayBuffer());
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(buf);
    } catch {
      return json({ ok: false, error: "zip 解析失败，请确认是有效的 zip 文件" }, 400);
    }
    const saved: string[] = [];
    const failed: string[] = [];
    const names = Object.keys(entries || {}).filter((n) => n && !n.endsWith("/"));
    for (const name of names) {
      const target = dir ? `${dir}/${name}` : name;
      const rawApi = `https://api.github.com/repos/${repo}/contents/${ghPath(target)}`;
      let sha: string | undefined;
      const exist = await fetch(`${rawApi}?ref=${encodeURIComponent(useBranch)}`, { headers });
      if (exist.ok) sha = ((await exist.json()) as any).sha;
      const payload: any = { message: `docs: unzip ${target}`, content: bytesToBase64(entries[name]), branch: useBranch };
      if (sha) payload.sha = sha;
      const res = await fetch(rawApi, { method: "PUT", headers, body: JSON.stringify(payload) });
      if (!res.ok) { failed.push(name); continue; }
      saved.push(target);
    }
    return json({
      ok: true,
      saved,
      failed,
      message: `解压完成：成功 ${saved.length} 个` + (failed.length ? `，失败 ${failed.length} 个（${failed.slice(0, 3).join("、")}）` : ""),
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 小于该大小：Cloudflare 直接解压；超过：交给 GitHub Actions 工作流
const UNZIP_INLINE_LIMIT = 50 * 1024 * 1024;
// 从网络下载并写进仓库的单个文件上限（受 Worker 内存与 base64 开销限制）
const DOWNLOAD_MAX_BYTES = 45 * 1024 * 1024;

// 触发 GitHub 解压工作流（大文件走这里）
async function triggerUnzipWorkflow(env: Bindings, zipPath: string, branch: string, dir: string): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/unzip.yml/dispatches`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          ref: branch,
          inputs: { zip_path: zipPath, branch, target_dir: dir || "", delete_zip: "true" },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json({ ok: false, error: "触发解压工作流失败 github error " + res.status, detail }, 502);
    }
    return json({
      ok: true,
      workflow: true,
      running: true,
      message: "文件较大，已触发 GitHub 解压工作流，正在解压（10 秒左右完成）",
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 解压仓库内的已在目录里的 zip 文件到当前目录（不要求再上传）
// <50MB 由 Cloudflare 即时解压；>50MB 触发 GitHub 工作流异步解压
async function handleUnzipByPath(env: Bindings, body: any): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  const useBranch = String(body.branch || "").trim() || ghConfig(env).branch;
  const zipPath = String(body.path || "").trim();
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  if (!zipPath) return json({ ok: false, error: "path required" }, 400);
  // 目标目录 = zip 所在目录
  const dir = zipPath.split("/").filter(Boolean).slice(0, -1).join("/");
  try {
    // 1) 读取 zip 文件元信息（拿到大小，决定解压方式）
    const apiUrl = `https://api.github.com/repos/${repo}/contents/${ghPath(zipPath)}?ref=${encodeURIComponent(useBranch)}`;
    const metaRes = await fetch(apiUrl, { headers });
    if (!metaRes.ok) return json({ ok: false, error: "读取 zip 失败 " + metaRes.status }, 502);
    const meta = (await metaRes.json()) as any;
    if (meta.type !== "file") return json({ ok: false, error: "不是文件" }, 400);
    const size = Number(meta.size || 0);
    // 2) 大文件：触发 GitHub 工作流
    if (size > UNZIP_INLINE_LIMIT) {
      return await triggerUnzipWorkflow(env, zipPath, useBranch, dir);
    }
    // 3) 小文件：Cloudflare 直接读取原始字节并解压
    //    注意：>1MB 的文件 contents API 默认不返回 content，需用 raw accept 头取原始内容
    const rawRes = await fetch(apiUrl, { headers: { ...headers, accept: "application/vnd.github.raw" } });
    if (!rawRes.ok) return json({ ok: false, error: "下载 zip 失败 " + rawRes.status }, 502);
    const bytes = new Uint8Array(await rawRes.arrayBuffer());
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      return json({ ok: false, error: "zip 解析失败，请确认是有效的 zip 文件" }, 400);
    }
    const saved: string[] = [];
    const failed: string[] = [];
    const names = Object.keys(entries || {}).filter((n) => n && !n.endsWith("/"));
    for (const name of names) {
      const target = dir ? `${dir}/${name}` : name;
      const rawApi = `https://api.github.com/repos/${repo}/contents/${ghPath(target)}`;
      let sha: string | undefined;
      const exist = await fetch(`${rawApi}?ref=${encodeURIComponent(useBranch)}`, { headers });
      if (exist.ok) sha = ((await exist.json()) as any).sha;
      const payload: any = { message: `docs: unzip ${target}`, content: bytesToBase64(entries[name]), branch: useBranch };
      if (sha) payload.sha = sha;
      const res = await fetch(rawApi, { method: "PUT", headers, body: JSON.stringify(payload) });
      if (!res.ok) { failed.push(name); continue; }
      saved.push(target);
    }
    return json({
      ok: true,
      saved,
      failed,
      size,
      message: `解压完成：成功 ${saved.length} 个` + (failed.length ? `，失败 ${failed.length} 个（${failed.slice(0, 3).join("、")}）` : ""),
    });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 大文件解压工作流运行状态
async function handleUnzipStatus(env: Bindings): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/unzip.yml/runs?per_page=5`,
      { headers },
    );
    if (!res.ok) return json({ ok: false, error: "github error " + res.status }, 502);
    const data = (await res.json()) as any;
    const isActive = (s: string) => s === "in_progress" || s === "queued" || s === "pending" || s === "waiting";
    const runs = ((data.workflow_runs || []) as any[]).map((r: any) => ({
      id: r.id,
      status: r.status,
      conclusion: r.conclusion || "",
      created_at: r.created_at || "",
      html_url: r.html_url || "",
    }));
    const running = runs.some((r: any) => isActive(r.status));
    return json({ ok: true, running, latest: runs[0] || null, runs });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 从网络下载文件并保存进仓库
async function handleDownloadFile(env: Bindings, body: any): Promise<Response> {
  const { token, repo, headers } = ghConfig(env);
  const useBranch = String(body.branch || "").trim() || ghConfig(env).branch;
  if (!token) return json({ ok: false, error: "GH_TOKEN not configured" }, 500);
  let url = String(body.url || "").trim();
  const target = String(body.path || "").trim();
  if (!url) return json({ ok: false, error: "url required" }, 400);
  try {
    // GitHub 仓库 owner/repo 简写或仓库主页地址 → 转为源码 zip 下载地址
    const gh = url.match(/^([\w.-]+)\/([\w.-]+)$/) || url.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    if (gh) {
      const owner = gh[1], name = gh[2];
      let defBranch = "main";
      const info = await fetch(`https://api.github.com/repos/${owner}/${name}`, { headers });
      if (info.ok) defBranch = ((await info.json()) as any).default_branch || "main";
      url = `https://codeload.github.com/${owner}/${name}/zip/refs/heads/${defBranch}`;
    }
    if (!/^https?:\/\//i.test(url)) return json({ ok: false, error: "url 必须以 http:// 或 https:// 开头" }, 400);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return json({ ok: false, error: `下载失败 HTTP ${res.status}` }, 502);
    const len = Number(res.headers.get("content-length") || 0);
    if (len && len > DOWNLOAD_MAX_BYTES)
      return json({ ok: false, error: `文件过大（${(len / 1048576).toFixed(1)}MB），超过 ${DOWNLOAD_MAX_BYTES / 1048576}MB 上限` }, 400);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length) return json({ ok: false, error: "下载内容为空" }, 400);
    if (buf.length > DOWNLOAD_MAX_BYTES)
      return json({ ok: false, error: `文件过大（${(buf.length / 1048576).toFixed(1)}MB），超过 ${DOWNLOAD_MAX_BYTES / 1048576}MB 上限` }, 400);
    // 目标路径：以 / 结尾或省略视为目录，自动使用文件名；否则视为完整文件路径
    const name = String(body.name || "").trim() || guessDownloadName(url, res.headers);
    let full: string;
    if (!target || /\/$/.test(target)) full = (target.replace(/\/+$/, "") ? target.replace(/\/+$/, "") + "/" : "") + name;
    else full = target;
    const rawApi = `https://api.github.com/repos/${repo}/contents/${ghPath(full)}`;
    let sha: string | undefined;
    const exist = await fetch(`${rawApi}?ref=${encodeURIComponent(useBranch)}`, { headers });
    if (exist.ok) sha = ((await exist.json()) as any).sha;
    const payload: any = { message: `docs: download ${full}`, content: bytesToBase64(buf), branch: useBranch };
    if (sha) payload.sha = sha;
    const put = await fetch(rawApi, { method: "PUT", headers, body: JSON.stringify(payload) });
    const putData = await put.json().catch(() => ({}));
    if (!put.ok) return json({ ok: false, error: "保存失败：" + ((putData as any).message || put.status) }, 502);
    return json({ ok: true, path: full, size: buf.length, message: `已下载并保存到 ${full}（${(buf.length / 1024).toFixed(1)} KB）` });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

// 从响应头/URL 推断文件名
function guessDownloadName(url: string, headers: Headers): string {
  const cd = headers.get("content-disposition") || "";
  const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (m) {
    try { return decodeURIComponent(m[1].replace(/"/g, "").trim()); } catch { /* ignore */ }
  }
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop() || "";
    if (seg) return decodeURIComponent(seg);
  } catch { /* ignore */ }
  return "download.bin";
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export default app;