/**
 * 统一后台页：/admin（独立于登录页 /admin/login）。
 * - 无大圆角、简约、适配深色模式、字号偏小
 * - 顶部标签：管理文章（默认首页）/ 评论管理；写作页从「＋ 添加新文章」按钮进入
 * - 登录态：由服务端 Cookie(wl_token) 判定是否返回本页；本页加载时读取 token，
 *   无效则跳转 /admin/login，刷新不再闪登录界面
 * - 编辑器：Vditor「分屏复杂模式」（SV，参考 cp.802213.xyz）
 * - 评论管理：全部 / 待审批 / 已通过 / 垃圾 + 通过/垃圾/删除
 */

const VDIRTOR_CSS = "https://cdn.jsdelivr.net/npm/vditor@3.11.1/dist/index.css";
const VDIRTOR_JS = "https://cdn.jsdelivr.net/npm/vditor@3.11.1/dist/index.min.js";
// AI 消息 Markdown 渲染：使用完整的 GFM 解析器（支持表格、任务列表、删除线等），并用 DOMPurify 防 XSS
const MARKED_JS = "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js";
const DOMPURIFY_JS = "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js";

const STYLE = `
:root{color-scheme:light dark;--accent:#f97316;--accent-h:#ea580c;
--bg:#f7f7f8;--card:#fff;--fg:#1f2328;--muted:#6b7280;--border:#e3e3e4;--nav:#16181d;
--nav-fg:#e5e7eb;--nav-active:#ffffff;--hover:#f0f0f1;--input-bg:#fff;--danger:#dc2626}
@media(prefers-color-scheme:dark){:root{
--bg:#0f1115;--card:#181b20;--fg:#e8e8e8;--muted:#9ca3af;--border:#2b2f36;--nav:#0a0c10;
--nav-fg:#a3a3a3;--nav-active:#ffffff;--hover:#23272e;--input-bg:#14161a;--danger:#f87171}}
*{box-sizing:border-box}
body{margin:0;font:13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'PingFang SC','Microsoft YaHei',Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg)}
a{color:var(--accent);text-decoration:none}
/* 顶栏 */
.wk-nav{background:var(--nav);height:46px;display:flex;align-items:center;padding:0 20px;position:sticky;top:0;z-index:10}
.wk-nav .inner{max-width:1080px;margin:0 auto;width:100%;display:flex;align-items:center;gap:14px}
.wk-nav .brand{display:flex;align-items:center;gap:8px;color:var(--nav-active);font-size:14px;font-weight:600}
.wk-nav .spacer{flex:1}
.wk-nav .user{color:var(--nav-fg);font-size:12px}
.wk-nav .logout{color:var(--nav-fg);font-size:12px;cursor:pointer;border:1px solid var(--border);padding:3px 10px;border-radius:3px;background:transparent}
.wk-nav .logout:hover{color:var(--nav-active);border-color:var(--nav-fg)}
.wk-nav a.site{color:var(--nav-fg);font-size:12px}
.wk-nav a.site:hover{color:var(--nav-active)}
/* 标签页 */
.wk-tabs{display:flex;gap:0;max-width:1080px;margin:14px auto 0;padding:0 16px;border-bottom:1px solid var(--border)}
.wk-tab{padding:8px 16px;font-size:13px;border:none;background:transparent;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent}
.wk-tab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
.wk-tab:hover{color:var(--fg)}
/* 构建状态横幅 */
.build-banner{margin:10px 0 0;padding:8px 12px;font-size:12px;border:1px solid var(--border);border-radius:3px;background:var(--hover)}
.build-banner.ok{color:#1a7f37;background:#d1f5d3;border-color:transparent}
.build-banner.err{color:var(--danger);background:rgba(220,38,38,.08);border-color:transparent}
@media(prefers-color-scheme:dark){.build-banner.ok{color:#4ade80;background:rgba(74,222,128,.12)}}
/* 内容容器 */
.wk-wrap{max-width:1080px;margin:14px auto;padding:0 16px}
/* 卡片（无大圆角） */
.wk-card{background:var(--card);border:1px solid var(--border);border-radius:2px;padding:16px}
.wk-card+.wk-card{margin-top:12px}
.wk-title{font-size:14px;font-weight:600;margin:0 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border)}
/* 可展开/收起的卡片（设置页） */
.wk-collapse{background:var(--card);border:1px solid var(--border);border-radius:2px;overflow:hidden}
.wk-collapse+.wk-collapse{margin-top:12px}
.wk-collapse>summary{list-style:none;cursor:pointer;padding:12px 16px;font-size:14px;font-weight:600;color:var(--fg);display:flex;align-items:center;justify-content:space-between;gap:10px;user-select:none;-webkit-tap-highlight-color:transparent}
.wk-collapse>summary::-webkit-details-marker{display:none}
.wk-collapse>summary::after{content:'▾';color:var(--muted);font-size:12px;line-height:1;transition:transform .2s}
.wk-collapse[open]>summary::after{transform:rotate(180deg)}
.wk-collapse>summary:hover{background:var(--hover)}
.wk-collapse .wk-collapse-body{padding:2px 16px 16px;border-top:1px solid var(--border)}
.wk-api-h{font-size:12px;font-weight:600;color:var(--fg);margin:14px 0 6px;padding-left:6px;border-left:2px solid var(--accent)}
.wk-api-h:first-child{margin-top:0}
/* 表单 */
.wk-label{font-size:12px;color:var(--muted);margin:8px 0 4px;display:block}
.wk-input{width:100%;border:1px solid var(--border);border-radius:3px;padding:6px 10px;font-size:13px;font-family:inherit;outline:none;background:var(--input-bg);color:var(--fg)}
.wk-input:focus{border-color:var(--accent);box-shadow:0 0 0 2px rgba(249,115,22,.12)}
.wk-row{display:flex;gap:12px}
@media(max-width:640px){.wk-row{flex-direction:column;gap:0}.wk-row>.wk-field{flex-basis:auto;width:100%}}
.wk-row>.wk-field{flex:1}
/* 按钮 */
.wk-btn{background:var(--accent);color:#fff;border:none;border-radius:3px;padding:7px 14px;font-size:13px;cursor:pointer;font-weight:500}
.wk-btn:hover{background:var(--accent-h)}
.wk-btn.ghost{background:transparent;color:var(--muted);border:1px solid var(--border)}
.wk-btn.ghost:hover{background:var(--hover);color:var(--fg)}
.wk-btn.act{background:var(--nav);color:var(--nav-active);border:none}
.wk-btn.act:hover{background:var(--hover);color:var(--fg)}
.wk-btn.danger{background:transparent;color:var(--danger);border:1px solid var(--border)}
.wk-btn.danger:hover{background:var(--hover)}
.wk-btn:disabled{opacity:.5;cursor:not-allowed}
.wk-btn.sm{padding:3px 10px;font-size:12px;border-radius:3px}
/* 列表 */
.wk-list{list-style:none;margin:0;padding:0}
.wk-list li{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 6px;border-bottom:1px solid var(--border)}
.wk-list li:last-child{border-bottom:none}
.wk-list .name{font-size:13px;font-weight:500}
.wk-list .meta{font-size:11px;color:var(--muted);margin-top:1px}
.wk-list .chip{display:inline-block;font-size:11px;color:var(--accent);background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.25);border-radius:3px;padding:1px 7px;margin-top:4px;margin-right:6px}
.wk-list .chipTag{color:var(--muted);background:var(--hover);border-color:var(--border)}
.wk-list .ops{display:flex;gap:6px;flex-shrink:0}
/* 评论条目 */
.wk-comment{display:flex;gap:10px;padding:10px 6px;border-bottom:1px solid var(--border)}
.wk-comment:last-child{border-bottom:none}
.wk-comment .avatar{width:32px;height:32px;border-radius:3px;background:var(--hover);flex-shrink:0;overflow:hidden}
.wk-comment .avatar img{width:100%;height:100%;object-fit:cover}
.wk-comment .nick{font-size:13px;font-weight:600}
.wk-comment .mail{font-size:11px;color:var(--muted);margin-left:6px}
.wk-comment .path{font-size:11px;color:var(--muted);margin-left:8px;word-break:break-all}
.wk-comment .time{font-size:11px;color:var(--muted);margin-left:8px}
.wk-comment .body{margin-top:3px;font-size:13px;word-break:break-word}
.wk-comment .status{display:inline-block;font-size:10px;padding:0 6px;border-radius:2px;margin-left:8px;vertical-align:middle}
.wk-comment .status.waiting{background:#fff3cd;color:#8a6d00}
.wk-comment .status.approved{background:#d1f5d3;color:#147d19}
.wk-comment .status.spam{background:#fde3e3;color:#d1241f}
.wk-comment .ops{margin-top:4px;display:flex;gap:6px}
.wk-comment .ip{font-size:10px;color:var(--muted);margin-left:4px}
/* 编辑区 */
#edt{min-height:480px;border:1px solid var(--border);border-radius:3px}
.hidden{display:none!important}
.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px}
.empty{color:var(--muted);text-align:center;padding:26px 0;font-size:13px}
.filters{display:flex;gap:6px;flex-wrap:wrap}
.filters .wk-btn{padding:3px 12px;font-size:12px;border-radius:3px}
.msg{font-size:12px;min-height:18px}.msg.err{color:var(--danger)}.msg.ok{color:#1a7f37}
@media(prefers-color-scheme:dark){.msg.ok{color:#4ade80}}
/* 部署历史 */
/* 分类/标签历史建议（浏览器原生 datalist，可输入或选择） */
/* 访问量统计卡片 */
.stats-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:12px}
.stats{display:flex;gap:12px;min-width:max-content}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:2px;padding:14px 22px;min-width:130px}
.stat-card .num{font-size:22px;font-weight:700;color:var(--accent);line-height:1.3}
.stat-card .lbl{font-size:11px;color:var(--muted)}
/* 订阅者表格 */
.wk-table{width:100%;border-collapse:collapse;font-size:13px}
.wk-table th{text-align:left;font-size:11px;color:var(--muted);font-weight:500;padding:8px 6px;border-bottom:1px solid var(--border);white-space:nowrap}
.wk-table td{padding:8px 6px;border-bottom:1px solid var(--border);word-break:break-all}
.wk-table tr:last-child td{border-bottom:none}
.wk-tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:3px;border:1px solid var(--border);color:var(--muted)}
.wk-tag.ok{color:#1a7f37;border-color:rgba(26,127,55,.35);background:rgba(26,127,55,.08)}
.wk-tag.wait{color:#b45309;border-color:rgba(180,83,9,.35);background:rgba(180,83,9,.08)}
.wk-tag.off{color:var(--muted)}
/* 访问趋势折线图 */
#visitChart{position:relative}
.chart-svg{max-width:100%}
.chart-svg .cl-grid{stroke:var(--border);stroke-width:1}
.chart-svg .cl-ytxt{fill:var(--muted);font-size:11px}
.chart-svg .cl-xtxt{fill:var(--muted);font-size:11px}
.chart-svg .cl-line{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart-svg .cl-area{fill:var(--accent);opacity:.1;stroke:none}
.chart-svg .cl-dot{fill:var(--accent)}
.chart-svg .cl-cross{stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3;pointer-events:none}
.chart-svg .cl-mark{fill:var(--card);stroke:var(--accent);stroke-width:2;pointer-events:none}
.chart-tip{position:absolute;transform:translate(-50%,0);background:var(--nav);color:var(--nav-active);font-size:12px;line-height:1.4;padding:4px 8px;border-radius:3px;white-space:nowrap;pointer-events:none;z-index:5}
@media(max-width:640px){.chart-svg .cl-ytxt,.chart-svg .cl-xtxt{font-size:15px}}
/* 顶部标签栏：移动端横向滑动 */
.wk-tabs{display:flex;gap:0;max-width:1080px;margin:14px auto 0;padding:0 16px;border-bottom:1px solid var(--border);overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
.wk-tabs::-webkit-scrollbar{display:none}
.wk-tab{padding:8px 16px;font-size:13px;border:none;background:transparent;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;flex:0 0 auto}
/* 部署记录表格：移动端横向滚动 */
.table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.wk-build-table{width:100%;border-collapse:collapse;font-size:12px;min-width:600px}
.wk-build-table th,.wk-build-table td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--border);vertical-align:middle;white-space:nowrap}
.wk-build-table code{background:var(--hover);padding:1px 5px;border-radius:2px;font-size:11px}
.wk-badge{display:inline-block;font-size:11px;padding:1px 8px;border-radius:2px;white-space:nowrap}
.wk-badge.success{background:#d1f5d3;color:#147d19}
.wk-badge.fail{background:#fde3e3;color:#d1241f}
.wk-badge.running{background:#fff3cd;color:#8a6d00}
.wk-badge.wait{background:var(--hover);color:var(--muted)}
@media(prefers-color-scheme:dark){.wk-badge.success{color:#4ade80;background:rgba(74,222,128,.12)}.wk-badge.fail{color:#f87171;background:rgba(248,113,113,.12)}.wk-badge.running{color:#fbbf24;background:rgba(251,191,36,.12)}}

/* AI 助手（聊天）：扁平风格，方形直角，贴合后台原有样式 */
.ai-chat{position:relative;display:flex;gap:0;padding:0;height:calc(100vh - 128px);min-height:420px;overflow:hidden}
.ai-chat.ai-full{position:fixed;inset:0;width:100vw;height:100vh;min-height:0;margin:0;z-index:200;border:none;border-radius:0}
.ai-chat.ai-full .ai-col{max-width:none;padding-left:32px;padding-right:32px}
.ai-side{width:216px;flex-shrink:0;display:flex;flex-direction:column;min-width:0;border-right:1px solid var(--border);padding:12px;background:var(--hover);overflow:hidden;transition:width .26s ease,padding .26s ease,border-right-width .26s ease}
.ai-side-head{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.ai-side-title{font-size:11px;color:var(--muted);margin:14px 0 6px;letter-spacing:.06em}
.ai-conv-list{flex:1;overflow:auto;display:flex;flex-direction:column;gap:2px;margin:0 -6px;padding:0 6px}
.ai-conv{display:flex;align-items:center;gap:6px;padding:6px 8px;border:1px solid transparent;border-left:2px solid transparent;border-radius:2px;cursor:pointer;font-size:13px;color:var(--fg)}
.ai-conv:hover{background:var(--card)}
.ai-conv.active{background:var(--card);border-color:var(--border);border-left-color:var(--accent)}
.ai-conv-t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-main{flex:1;display:flex;flex-direction:column;min-width:0}
.ai-bar{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;min-width:0}
.ai-scroll{flex:1;overflow:auto;min-height:0;display:flex;justify-content:center}
.ai-col{max-width:748px;width:100%;padding:18px 16px;display:flex;flex-direction:column;gap:16px}
.ai-msg{display:flex;flex-direction:column;gap:4px;min-width:0}
.ai-msg.user{align-items:flex-end}
.ai-msg.assistant{align-items:stretch}
.ai-who{font-size:11px;color:var(--muted)}
/* 正文严格限制在气泡内换行：长链接/长串也不会顶出左右两边 */
.ai-body{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;max-width:100%;line-height:1.7;font-size:14px;border-radius:2px}
.ai-msg.assistant .ai-body{background:transparent;border:none;padding:0}
.ai-msg.user .ai-body{max-width:82%;padding:8px 12px;background:var(--hover);border:1px solid var(--border)}
/* Markdown 渲染 */
.ai-body.md{white-space:normal}
.ai-body.md>*:first-child{margin-top:0}
.ai-body.md p{margin:0 0 8px}
.ai-body.md p:last-child{margin-bottom:0}
.ai-body.md ul,.ai-body.md ol{margin:0 0 8px;padding-left:22px}
.ai-body.md li{margin:2px 0}
.ai-body.md h1,.ai-body.md h2,.ai-body.md h3,.ai-body.md h4,.ai-body.md h5,.ai-body.md h6{margin:12px 0 6px;line-height:1.4;font-size:15px}
.ai-body.md h1{font-size:18px}
.ai-body.md h2{font-size:16px}
.ai-body.md code{background:var(--hover);border:1px solid var(--border);padding:0 4px;border-radius:2px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.ai-body.md pre{background:var(--hover);border:1px solid var(--border);border-radius:2px;padding:8px 10px;overflow:auto;margin:0 0 8px}
.ai-body.md pre code{background:transparent;border:none;padding:0;font-size:12.5px;line-height:1.6}
.ai-body.md blockquote{margin:0 0 8px;padding:2px 10px;border-left:2px solid var(--border);color:var(--muted)}
.ai-body.md hr{border:none;border-top:1px solid var(--border);margin:10px 0}
.ai-body.md a{text-decoration:underline}
.ai-body.md img{max-width:100%;height:auto}
/* GFM 表格（marked 渲染）：窄屏可横向滚动 */
.ai-body.md table{border-collapse:collapse;margin:0 0 8px;display:block;width:max-content;max-width:100%;overflow:auto}
.ai-body.md th,.ai-body.md td{border:1px solid var(--border);padding:4px 10px;text-align:left;vertical-align:top}
.ai-body.md th{background:var(--hover);font-weight:600}
.ai-body.md tbody tr:nth-child(even){background:color-mix(in srgb,var(--hover) 45%,transparent)}
/* 任务列表 */
.ai-body.md li:has(input[type=checkbox]){list-style:none;margin-left:-18px}
.ai-body.md input[type=checkbox]{width:auto;margin:0 6px 0 0;vertical-align:middle}
/* 思考过程（可展开/收起） */
.ai-think{border:1px dashed var(--border);border-radius:2px;padding:6px 10px;margin:0 0 8px;font-size:12.5px;color:var(--muted);background:var(--hover)}
.ai-think>summary{cursor:pointer;font-size:12px;color:var(--muted);outline:none}
.ai-think-body{margin-top:6px;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;line-height:1.7}
/* 思考与工具调用过程：生成结束默认收起，可展开查看 */
.ai-proc{border:1px solid var(--border);border-radius:2px;background:var(--hover);margin:0 0 8px}
.ai-proc>summary{cursor:pointer;font-size:12px;color:var(--muted);padding:6px 10px;outline:none}
.ai-proc>summary:hover{color:var(--fg)}
.ai-proc-body{padding:2px 10px 8px;max-height:420px;overflow:auto;font-size:12.5px;color:var(--muted)}
.ai-proc-seg{margin:0 0 8px}
.ai-proc-tag{font-size:11px;color:var(--muted);opacity:.85;margin-bottom:2px}
.ai-proc-text{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;line-height:1.7}
/* 最终回答：与过程分开，始终显示 */
.ai-answer{margin:0}
/* 单个工具调用 + 结果：可单独展开收起 */
.ai-tool-fold{border:1px solid var(--border);border-radius:2px;margin:0 0 6px;background:var(--card)}
.ai-tool-fold>summary{cursor:pointer;padding:5px 8px;list-style:none;outline:none;word-break:break-word}
.ai-tool-fold>summary::-webkit-details-marker{display:none}
.ai-tool-fold>summary:before{content:'▸ ';color:var(--muted)}
.ai-tool-fold[open]>summary:before{content:'▾ '}
.ai-tool-fold-body{padding:0 8px 8px}
.ai-tool-fold-sec{margin:0 0 6px}
.ai-tool-fold-pre{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;line-height:1.6;max-height:240px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px}
.ai-tool-fold-pre.err{color:#d9534f}
/* 等待模型响应：首个输出片段到达后隐藏 */
.ai-wait{font-size:12.5px;color:var(--muted);padding:2px 0;animation:aiWaitPulse 1.2s ease-in-out infinite}
@keyframes aiWaitPulse{0%,100%{opacity:.45}50%{opacity:1}}
/* 输入区上方一行的「i」按钮：查看已用 token / 缓存命中 */
#aiUsageBtn{margin-left:auto;flex:0 0 auto;width:26px;height:26px;padding:0;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;line-height:1}
.ai-usage-pop{position:fixed;z-index:1200;background:var(--card);border:1px solid var(--border);border-radius:4px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:10px 12px;min-width:190px;font-size:12px}
.ai-usage-pop-h{font-size:12px;font-weight:600;margin-bottom:8px}
.ai-usage-row{display:flex;justify-content:space-between;gap:18px;padding:3px 0;color:var(--muted)}
.ai-usage-row b{color:var(--fg);font-weight:600}
.ai-usage-empty{color:var(--muted);max-width:210px;line-height:1.6}
.ai-input{display:flex;gap:8px;align-items:flex-end;padding:8px 14px 12px;flex-shrink:0}
/* 输入框不显示拖拽手柄：随内容自动向上增高（到上限后内部滚动） */
.ai-input textarea{flex:1;resize:none;min-height:34px;max-height:220px;overflow-y:hidden;border-radius:2px}
/* 生成中：发送键原地变成灰色「停止」 */
#aiSendBtn{flex:0 0 auto}
#aiSendBtn.stop{background:var(--muted);color:#fff}
#aiSendBtn.stop:hover{background:var(--muted);opacity:.88}
.ai-foot{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;overflow-x:auto;padding:10px 14px 0;border-top:1px solid var(--border);flex-shrink:0}
.ai-foot .wk-label{flex:0 0 auto;white-space:nowrap}
.ai-foot select.wk-input{flex-shrink:1}
.ai-model-list{max-height:240px;overflow:auto;display:flex;flex-wrap:wrap;gap:6px;align-content:flex-start}
.ai-pick{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border);border-radius:2px;padding:3px 8px;font-size:12px;cursor:pointer;background:var(--input-bg)}
.ai-pick:hover{background:var(--hover)}
.ai-pick.on{border-color:var(--accent);color:var(--accent)}
.ai-pick input{width:auto;margin:0}
.ai-pick-n{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-chat.side-off .ai-side{width:0;padding-left:0;padding-right:0;border-right-width:0}
.ai-chat-title{font-size:14px;font-weight:600;flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text}
/* 顶栏右侧操作区：编辑/全屏/停止 强制同一行、靠右上角 */
.ai-bar-acts{display:flex;align-items:center;gap:6px;flex:0 0 auto;margin-left:auto}
#aiChatHint{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ai-icon-btn{display:inline-flex;align-items:center;justify-content:center;padding:4px 6px;line-height:0}
.ai-acts{display:flex;gap:12px;margin-top:2px}
.ai-msg.user .ai-acts{justify-content:flex-end}
.ai-acts button{border:none;background:transparent;color:var(--muted);font-size:11px;cursor:pointer;padding:0;font-family:inherit}
.ai-acts button:hover{color:var(--accent);text-decoration:underline}
.ai-secret-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px}
.ai-secret-box{background:var(--card);border:1px solid var(--border);border-radius:4px;padding:16px;max-width:430px;width:100%}
.ai-secret-title{font-size:14px;font-weight:600;margin-bottom:8px}
.ai-secret-desc{font-size:12px;color:var(--muted);margin:0 0 12px;line-height:1.7}
.ai-tool-note{font-size:12px;color:var(--muted);border-left:2px solid var(--border);padding:4px 10px;margin:0;word-break:break-all;background:var(--hover)}
.ai-tool-note.err{border-left-color:#dc2626}
.ai-tool-tag{display:inline-block;font-size:11px;padding:0 6px;margin-right:6px;border:1px solid var(--border);border-radius:2px;color:var(--muted)}
.ai-tool-inline{opacity:.8}
.ai-tool-confirm{border:1px solid var(--accent);border-radius:2px;padding:10px 12px;background:var(--card)}
.ai-tool-head{font-size:13px;font-weight:600;margin-bottom:6px}
.ai-tool-pre{margin:0;max-height:200px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-all;background:var(--hover);padding:8px;border-radius:2px}
@media(max-width:640px){
/* 手机端：聊天区占满可视高度，输入框贴到屏幕底部（精确高度由 aiFitHeight() 计算，此处为兜底） */
.ai-chat{height:calc(100dvh - 114px);min-height:0;border-radius:0}
.ai-side{position:absolute;top:0;left:0;bottom:0;width:min(78vw,260px);z-index:6;transition:transform .26s ease}
.ai-chat.side-off .ai-side{width:min(78vw,260px);padding:12px;border-right-width:1px;transform:translateX(-100%)}
.ai-scroll{min-height:0}
/* 顶栏：所有按钮强制一行靠右上角，标题溢出省略，提示文字手机端隐藏 */
.ai-bar{gap:4px;padding:8px 10px}
.ai-bar .wk-btn{padding:4px 6px;font-size:12px;flex:0 0 auto;white-space:nowrap}
.ai-bar-acts{gap:4px}
.ai-chat-title{font-size:13px}
#aiChatHint{display:none}
/* 进入 AI 页时不保留容器下边距，避免底部出现可滚动的空隙 */
.wk-wrap:has(#page-ai:not(.hidden)){margin-bottom:0}
/* 控制行：隐藏文字标签，选择器尽量紧凑，单行不换行（不够时横向滑动） */
.ai-foot{gap:6px;padding:6px 10px 0;flex-wrap:nowrap;overflow-x:auto;flex-shrink:0}
.ai-foot .wk-label{display:none}
.ai-foot select.wk-input{flex:0 0 auto!important;width:auto!important;min-width:0!important;max-width:38vw!important;padding:3px 4px!important;font-size:12px;text-overflow:ellipsis}
#aiChatModel{max-width:34vw!important}
.ai-input{padding:6px 10px calc(6px + env(safe-area-inset-bottom))}
}
`;

const SCRIPT = `
const API_BASE = '/admin/api';
const storage = {
  get: k => { try { return localStorage.getItem(k)||sessionStorage.getItem(k)||'' } catch(e){ return '' } },
  set: (k,v) => { try { localStorage.setItem(k,v) } catch(e){} }
};
let token = '';
let editor = null;
let editorInited = false;
let editingPath = '';
let pendingEditorValue = '';
let editorReadyWait = 0;
let activePage = 'manage';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const api = async (url, opt={}) => {
  const h = Object.assign({'Content-Type':'application/json'}, opt.headers||{});
  if (token) h['Authorization'] = 'Bearer ' + token;
  const r = await fetch(url, Object.assign({}, opt, {headers:h}));
  let d = null; try { d = await r.json(); } catch(e){}
  return { ok: r.ok, status: r.status, data: d };
};

function toast(msg, isErr){
  let el = $('#msg');
  if(!el || el.offsetParent===null){
    // 全局兜底：当前激活页没有可见的 #msg 时，用一个全局浮层
    el = $('#wk-toast');
    if(!el){
      el = document.createElement('div');
      el.id='wk-toast';
      el.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2000;padding:8px 16px;font-size:13px;border-radius:3px;color:#fff;background:#111827;box-shadow:0 2px 8px rgba(0,0,0,.2);max-width:80vw';
      document.body.appendChild(el);
    }
    el.style.background = isErr ? '#dc2626' : '#111827';
  }
  el.textContent = msg;
  el.className = 'msg ' + (isErr ? 'err' : 'ok') + (el.id==='wk-toast' ? ' wk-toast' : '');
  el.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>{ el.style.opacity='0'; }, 2400);
}

// 读取登录态：Cookie 或 localStorage；非法则跳登录页（由 /admin 服务端已保证 Cookie 存在）
function getToken(){
  const c = document.cookie.split(';').map(s=>s.trim()).find(s=>s.startsWith('wl_token='));
  if (c) { try { return decodeURIComponent(c.slice('wl_token='.length)); } catch(e){} }
  return storage.get('TOKEN');
}

// ---------- tab（独立路由 /admin/xxx，SPA 切换：仅改地址栏，绝不刷新）----------
const TAB_NAMES=['manage','comments','files','build','visit','subscribe','ai','settings','write'];
function showPage(name){ activePage=name; $$('.wk-page').forEach(p=>p.classList.toggle('hidden', p.id!=='page-'+name)); }
// 进入写作页（新建/编辑共用）：首次初始化编辑器与草稿
let writeInited=false;
function enterWritePage(){
  if(!writeInited){
    writeInited=true;
    if(!editingPath){
      if(!loadDraft()) $('#date').value=new Date().toISOString().slice(0,10);
      restoreDraft();
    }
    initEditorOnce();
    loadTaxonomySuggest();
  }
  showPage('write');
  window.scrollTo(0,0);
}
// 统一切换：先显示页面，再更新地址栏（replaceState 不新增历史，稳定不刷新）
function go(name){
  name=TAB_NAMES.includes(name)?name:'manage';
  $$('.wk-tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  if(name==='write'){ enterWritePage(); }
  else {
    showPage(name);
    if(name==='manage'){ loadPosts(); initBuildStatus(); }
    if(name==='comments') loadComments();
    if(name==='files'){ loadFiles(); resumeUnzipStatus(); }
    if(name==='build') loadBuildHistory();
    if(name==='visit') loadVisit();
    if(name==='subscribe') loadSubscribe();
    if(name==='ai'){ loadAiChat(); aiFitHeight(); }
    if(name==='settings'){ loadSubscribeSettings(); loadSiteSettings(); loadAiSettings(); loadSecrets(); }
    window.scrollTo(0,0);
  }
  // AI 页保留会话 id（/admin/ai/<id>），其余标签页用 /admin/<name>
  const url = (name === 'ai' && aiConvId) ? ('/admin/ai/' + aiConvId) : ('/admin/' + name);
  try{ history.replaceState(null,'',url); }catch(e){}
}
function switchTab(name){ go(name); }

// ---------- 访问量（仅管理员可见）----------
let visitDays = 30;

// 折线图：用内联 SVG 绘制最近 N 天访问量
function renderVisitChart(series){
  const el = $('#visitChart');
  if(!el) return;
  if(!series || !series.length){ el.innerHTML = '<div class="empty">暂无数据</div>'; return; }
  const W = 800, H = 260, padL = 46, padR = 16, padT = 16, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = series.length;
  const max = Math.max(1, ...series.map(p => Number(p.count) || 0));
  const X = i => padL + (n === 1 ? iw / 2 : iw * i / (n - 1));
  const Y = v => padT + ih - ih * (v / max);
  let grid = '';
  for(let t = 0; t <= 4; t++){
    const v = max * t / 4, yy = Y(v);
    grid += '<line class="cl-grid" x1="'+padL+'" y1="'+yy.toFixed(1)+'" x2="'+(W-padR)+'" y2="'+yy.toFixed(1)+'"/>';
    grid += '<text class="cl-ytxt" x="'+(padL-6)+'" y="'+(yy+3).toFixed(1)+'" text-anchor="end">'+Math.round(v)+'</text>';
  }
  const pts = series.map((p,i) => X(i).toFixed(1)+','+Y(Number(p.count)||0).toFixed(1)).join(' ');
  const area = '<polygon class="cl-area" points="'+padL+','+(padT+ih)+' '+pts+' '+(W-padR)+','+(padT+ih)+'"/>';
  const line = '<polyline class="cl-line" points="'+pts+'"/>';
  let dots = '';
  if(n <= 62){
    dots = series.map((p,i) => '<circle class="cl-dot" cx="'+X(i).toFixed(1)+'" cy="'+Y(Number(p.count)||0).toFixed(1)+'" r="2.5"><title>'+esc(p.day)+'：'+esc(p.count)+'</title></circle>').join('');
  }
  const step = Math.ceil(n / 6);
  let xl = '';
  series.forEach((p,i) => {
    if(i % step === 0 || i === n - 1){
      xl += '<text class="cl-xtxt" x="'+X(i).toFixed(1)+'" y="'+(H-9)+'" text-anchor="middle">'+esc(String(p.day).slice(5))+'</text>';
    }
  });
  const cross = '<line class="cl-cross" y1="'+padT+'" y2="'+(padT+ih)+'" style="opacity:0"/>';
  const mark = '<circle class="cl-mark" r="4" style="opacity:0"/>';
  el.innerHTML = '<div class="chart-tip hidden"></div><svg viewBox="0 0 '+W+' '+H+'" class="chart-svg" style="width:100%;height:auto;display:block">'+grid+area+line+dots+cross+mark+xl+'</svg>';
  const svg = el.querySelector('svg');
  el.__geo = {
    W:W, H:H, padL:padL, padT:padT, iw:iw, ih:ih, n:n, series:series, X:X, Y:Y,
    cross: svg.querySelector('.cl-cross'),
    mark: svg.querySelector('.cl-mark'),
    tip: el.querySelector('.chart-tip')
  };
  // 鼠标悬停：显示该点对应的日期与访问量（补齐「列」的提示）
  el.onmousemove = function(ev){
    const g = el.__geo;
    if(!g || !g.tip) return;
    const rect = el.getBoundingClientRect();
    if(!rect.width) return;
    const px = (ev.clientX - rect.left) * (g.W / rect.width);
    let i = g.n === 1 ? 0 : Math.round((px - g.padL) / (g.iw / (g.n - 1)));
    i = Math.max(0, Math.min(g.n - 1, i));
    const p = g.series[i] || {};
    const cx = g.X(i), cy = g.Y(Number(p.count) || 0);
    g.cross.setAttribute('x1', cx.toFixed(1));
    g.cross.setAttribute('x2', cx.toFixed(1));
    g.cross.style.opacity = '1';
    g.mark.setAttribute('cx', cx.toFixed(1));
    g.mark.setAttribute('cy', cy.toFixed(1));
    g.mark.style.opacity = '1';
    g.tip.textContent = String(p.day || '') + '：' + (Number(p.count) || 0) + ' 次';
    g.tip.classList.remove('hidden');
    const tx = Math.max(34, Math.min(rect.width - 34, (cx / g.W) * rect.width));
    const ty = Math.max(0, (cy / g.H) * rect.height - 36);
    g.tip.style.left = tx + 'px';
    g.tip.style.top = ty + 'px';
  };
  el.onmouseleave = function(){
    const g = el.__geo;
    if(!g) return;
    g.cross.style.opacity = '0';
    g.mark.style.opacity = '0';
    if(g.tip) g.tip.classList.add('hidden');
  };
}

// 读取今日/总访问量 + 最近 N 天趋势
async function loadVisit(){
  const today = $('#statToday'), total = $('#statTotal');
  if(today) today.textContent = '-';
  if(total) total.textContent = '-';
  try{
    const r = await api('/api/visit/stats');
    if(r.ok){
      const d = r.data || {};
      if(today) today.textContent = (d.today == null ? '-' : d.today);
      if(total) total.textContent = (d.total == null ? '-' : d.total);
    }
  }catch(e){}
  const chart = $('#visitChart'), sumEl = $('#visitRangeSum');
  if(chart) chart.innerHTML = '<div class="empty">加载中...</div>';
  try{
    const r = await api('/admin/api/visit/daily?days=' + visitDays);
    if(r.ok && r.data){
      renderVisitChart(r.data.series || []);
      if(sumEl) sumEl.textContent = (r.data.sum == null ? '-' : r.data.sum);
    } else {
      if(chart) chart.innerHTML = '<div class="empty">加载失败</div>';
      if(sumEl) sumEl.textContent = '-';
    }
  }catch(e){
    if(chart) chart.innerHTML = '<div class="empty">加载失败</div>';
    if(sumEl) sumEl.textContent = '-';
  }
  const ld = $('#visitDaysLabel');
  if(ld) ld.textContent = visitDays;
}

// 快捷按钮：7/30/90/365
function setVisitDays(n){ visitDays = n; const i = $('#visitDays'); if(i) i.value = n; loadVisit(); }
// 自定义天数
function applyVisitDays(){
  const i = $('#visitDays');
  const n = parseInt((i && i.value) || '', 10);
  if(!Number.isFinite(n) || n < 1 || n > 3650){ toast('显示天数需为 1-3650 的整数', true); return; }
  visitDays = n; loadVisit();
}

// ---------- 站点设置（设置标签页：数据保留 + 访客评论开关）----------
async function loadSiteSettings(){
  try{
    const r = await api('/admin/api/site/settings');
    if(r.ok && r.data){
      const d = r.data;
      const rd = $('#retentionDays'); if(rd) rd.value = d.retention_days;
      const gk = $('#allowGuestComment'); if(gk) gk.checked = !!d.allow_guest_comment;
    }
  }catch(e){}
}
async function saveSiteSettings(){
  const rd = $('#retentionDays');
  const n = parseInt((rd && rd.value) || '', 10);
  if(!Number.isFinite(n) || n < 1 || n > 3650){ toast('保留天数需为 1-3650 的整数', true); return; }
  const gk = $('#allowGuestComment');
  const payload = { retention_days: n, allow_guest_comment: !!(gk && gk.checked) };
  const r = await api('/admin/api/site/settings', { method:'PUT', body: JSON.stringify(payload) });
  const msg = $('#siteMsg');
  if(r.ok){
    toast('设置已保存');
    if(msg){ msg.className='msg ok'; msg.textContent='设置已保存'; }
  } else {
    const err = (r.data && r.data.error) || '保存失败';
    toast(err, true);
    if(msg){ msg.className='msg err'; msg.textContent=err; }
  }
}

// ---------- AI 设置（OpenAI 兼容接口：配置 / 测试 / 模型列表 / 前端代理）----------
let aiModels = [];   // 拉取到的全部模型
let aiPicked = [];   // 已选入的模型（保存后可被 AI 助手切换）
const aiVal = id => { const el=$('#'+id); return el ? el.value : ''; };
// 拼接 OpenAI 兼容地址：结尾无 /vN 时自动补 /v1（与后端 aiEndpoint 逻辑一致）
function aiJoin(base, path){
  let b = String(base || '').trim();
  while(b.slice(-1) === '/') b = b.slice(0, -1);
  if(!b) return '';
  const seg = b.split('/').pop() || '';
  const c0 = seg.charAt(0), c1 = seg.charAt(1);
  const isVer = c0 === 'v' && c1 >= '0' && c1 <= '9';
  if(!isVer) b += '/v1';
  return b + path;
}
// 前端直连所需的密钥：优先输入框，其次取已保存的
async function resolveAiKey(formKey){
  if(formKey) return formKey;
  try{ const r = await api('/admin/api/ai/key'); if(r.ok && r.data && r.data.apiKey) return r.data.apiKey; }catch(e){}
  return '';
}
function aiProxyOn(){ const el = $('#aiClientProxy'); return !!(el && el.checked); }
// 聊天页是否启用前端代理（跟随设置中已保存的配置）
function aiChatProxyOn(){ return !!aiChatProxy; }
// 前端直连所需的 API 地址：优先设置页输入框（支持未保存），其次后端已保存配置
async function resolveAiBase(){
  const v = aiVal('aiBaseUrl').trim();
  if(v) return v;
  try{ const r = await api('/admin/api/ai/settings'); if(r.ok && r.data && r.data.baseUrl) return r.data.baseUrl; }catch(e){}
  return '';
}
async function loadAiSettings(){
  try{
    const r = await api('/admin/api/ai/settings');
    if(r.ok && r.data){
      const d = r.data;
      const bu = $('#aiBaseUrl'); if(bu) bu.value = d.baseUrl || '';
      const cp = $('#aiClientProxy'); if(cp) cp.checked = !!d.clientProxy;
      const pm = $('#aiPermission'); if(pm) pm.value = d.permission || 'safe';
      aiPicked = Array.isArray(d.models) && d.models.length ? d.models.slice() : (d.model ? [String(d.model)] : []);
      aiSyncModelsToText();
      renderAiModels();
      const pr = $('#aiPrompt'); if(pr) pr.value = d.prompt || d.defaultPrompt || '';
      const k = $('#aiApiKey');
      if(k){ k.value = ''; k.placeholder = d.hasKey ? '已保存（留空表示不修改）' : '未设置'; }
    }
  }catch(e){}
}
async function saveAiSettings(){
  aiSyncModelsFromText(); // 以文本框为准（可能刚编辑过还没失焦）
  const picked = aiPicked.slice();
  // 没有独立的「默认模型」：以第一个已选模型作为助手默认，其余可在助手里切换
  const payload = {
    baseUrl: aiVal('aiBaseUrl').trim(),
    apiKey: aiVal('aiApiKey'),
    model: picked[0] || '',
    models: picked,
    prompt: aiVal('aiPrompt'),
    clientProxy: aiProxyOn(),
    permission: aiVal('aiPermission') || 'safe'
  };
  const r = await api('/admin/api/ai/settings', { method:'PUT', body: JSON.stringify(payload) });
  const msg = $('#aiMsg');
  if(r.ok){
    toast('AI 配置已保存');
    if(msg){ msg.className='msg ok'; msg.textContent='AI 配置已保存'; }
    const k = $('#aiApiKey'); if(k) k.value='';
    loadAiSettings();
  } else {
    const err = (r.data && r.data.error) || '保存失败';
    toast(err, true);
    if(msg){ msg.className='msg err'; msg.textContent=err; }
  }
}
// 测试连通性：只用第一个已选模型发一个最小请求
async function testAiSettings(){
  const msg = $('#aiMsg');
  aiSyncModelsFromText();
  const model = aiPicked[0] || '';
  if(!model){
    if(msg){ msg.className='msg err'; msg.textContent='请先填写或勾选一个模型'; }
    toast('请先填写或勾选一个模型', true);
    return;
  }
  if(msg){ msg.className='msg'; msg.textContent='测试中...'; }
  toast('测试中...');
  const base = aiVal('aiBaseUrl').trim();
  const key = aiVal('aiApiKey');
  try{
    let elapsed = null, reply = '', err = '';
    if(aiProxyOn()){
      // 前端代理：浏览器直连服务商（绕过 Cloudflare 出网限制）
      const k = await resolveAiKey(key);
      const t0 = Date.now();
      const resp = await fetch(aiJoin(base, '/chat/completions'), {
        method:'POST',
        headers: Object.assign({'Content-Type':'application/json'}, k ? {Authorization:'Bearer ' + k} : {}),
        body: JSON.stringify({ model: model, messages:[{role:'user', content:'你好，这是一条连通性测试消息，请回复一句话确认。'}], max_tokens:32 })
      });
      elapsed = Date.now() - t0;
      const d = await resp.json().catch(()=>({}));
      if(resp.ok){
        reply = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
      } else {
        err = (d.error && (d.error.message || d.error)) || ('HTTP ' + resp.status);
      }
    } else {
      const r = await api('/admin/api/ai/test', { method:'POST', body: JSON.stringify({ baseUrl: base, apiKey: key, model: model }) });
      const d = (r.data || {});
      if(r.ok && d.ok){ elapsed = d.elapsed; reply = d.reply || ''; }
      else err = d.error || '测试失败';
    }
    if(err){
      toast('测试失败：' + err, true);
      if(msg){ msg.className='msg err'; msg.textContent='测试失败（' + model + '）：' + err; }
    } else {
      toast('连接成功（' + (elapsed == null ? '-' : elapsed) + 'ms）');
      if(msg){ msg.className='msg ok'; msg.textContent='连接成功（' + model + '），耗时 ' + (elapsed == null ? '-' : elapsed) + 'ms；回复：' + (reply || '（空）'); }
    }
  }catch(e){
    const hint = aiProxyOn() ? '（前端代理直连失败，可能是服务商未开放跨域/CORS）' : '';
    toast('测试失败', true);
    if(msg){ msg.className='msg err'; msg.textContent='测试失败（' + model + '）：' + ((e && e.message) ? e.message : e) + hint; }
  }
}
async function loadAiModels(){
  const box = $('#aiModelList');
  const msg = $('#aiMsg');
  if(box) box.innerHTML = '<span class="wk-label" style="margin:0">加载中...</span>';
  const base = aiVal('aiBaseUrl').trim();
  const key = aiVal('aiApiKey');
  try{
    let models = null, err = '';
    if(aiProxyOn()){
      const k = await resolveAiKey(key);
      const resp = await fetch(aiJoin(base, '/models'), { headers: Object.assign({Accept:'application/json'}, k ? {Authorization:'Bearer ' + k} : {}) });
      const d = await resp.json().catch(()=>({}));
      if(resp.ok){
        const list = Array.isArray(d.data) ? d.data : (Array.isArray(d) ? d : []);
        models = list.map(x => (typeof x === 'string' ? x : (x && x.id))).filter(Boolean);
      } else {
        err = (d.error && (d.error.message || d.error)) || ('HTTP ' + resp.status);
      }
    } else {
      const r = await api('/admin/api/ai/models', { method:'POST', body: JSON.stringify({ baseUrl: base, apiKey: key }) });
      const d = (r.data || {});
      if(r.ok && d.ok) models = Array.isArray(d.models) ? d.models : [];
      else err = d.error || '获取失败';
    }
    if(models){
      // 去重
      const seen = Object.create(null), uniq = [];
      models.forEach(function(m){ if(m && !seen[m]){ seen[m] = 1; uniq.push(m); } });
      aiModels = uniq;
      // 重新拉取后清掉已不在列表里的旧选择，避免「已选 N 个」凭空多出来
      const set = Object.create(null);
      uniq.forEach(function(m){ set[m] = 1; });
      const kept = aiPicked.filter(function(m){ return set[m]; });
      const dropped = aiPicked.length - kept.length;
      aiPicked = kept;
      aiSyncModelsToText();
      renderAiModels();
      let tip = '共获取到 ' + aiModels.length + ' 个模型';
      if(dropped > 0) tip += '，已移除 ' + dropped + ' 个列表中不存在的旧模型';
      if(msg){ msg.className='msg ok'; msg.textContent = tip + '，可勾选后保存为可选模型'; }
    } else {
      aiModels = [];
      renderAiModels();
      if(msg){ msg.className='msg err'; msg.textContent='获取失败：' + err; }
      toast('获取模型失败：' + err, true);
    }
  }catch(e){
    aiModels = [];
    renderAiModels();
    const hint = aiProxyOn() ? '（前端代理直连失败，可能是服务商未开放跨域/CORS）' : '';
    if(msg){ msg.className='msg err'; msg.textContent='获取失败：' + ((e && e.message) ? e.message : e) + hint; }
    toast('获取模型失败', true);
  }
}
function renderAiModels(){
  const box = $('#aiModelList');
  const cnt = $('#aiPickedCount');
  if(cnt) cnt.textContent = aiPicked.length ? ('已选 ' + aiPicked.length + ' 个模型') : '尚未选择模型';
  if(!box) return;
  // 未重新拉取列表时，已保存的可选模型也要显示出来（避免看起来像没保存）
  if(!aiModels.length){
    if(!aiPicked.length){ box.innerHTML = '<span class="wk-label" style="margin:0">未获取到模型，请先点「获取模型列表」</span>'; return; }
    aiModels = aiPicked.slice();
  }
  const qEl = $('#aiModelSearch');
  const q = (qEl && qEl.value ? qEl.value : '').trim().toLowerCase();
  const list = q ? aiModels.filter(m => String(m).toLowerCase().indexOf(q) >= 0) : aiModels;
  if(!list.length){ box.innerHTML = '<span class="wk-label" style="margin:0">没有匹配「' + esc(q) + '」的模型</span>'; return; }
  box.innerHTML = list.map(m => {
    const on = aiPicked.indexOf(m) >= 0;
    return '<label class="ai-pick' + (on ? ' on' : '') + '">' +
      '<input type="checkbox"' + (on ? ' checked' : '') + ' onchange="toggleAiModel(&#39;' + esc(m) + '&#39;)">' +
      '<span class="ai-pick-n">' + esc(m) + '</span></label>';
  }).join('');
}
// 「已选的模型」文本框 → 勾选列表。用户正在输入，不回写文本框以免打断光标
function aiSyncModelsFromText(){
  const el = $('#aiModelsText'); if(!el) return;
  const seen = {}, arr = [];
  String(el.value || '').split(/[,，]/).forEach(function(s){
    const v = s.trim();
    if(!v || seen[v]) return;
    seen[v] = 1; arr.push(v);
  });
  aiPicked = arr;
  renderAiModels();
}
// 勾选列表 → 「已选的模型」文本框（点勾选框 / 全选 / 清空时调用）
function aiSyncModelsToText(){
  const el = $('#aiModelsText'); if(el) el.value = aiPicked.join(', ');
}
function toggleAiModel(m){
  const i = aiPicked.indexOf(m);
  if(i >= 0) aiPicked.splice(i, 1); else aiPicked.push(m);
  aiSyncModelsToText();
  renderAiModels();
}
function aiPickVisible(){
  const qEl = $('#aiModelSearch');
  const q = (qEl && qEl.value ? qEl.value : '').trim().toLowerCase();
  return q ? aiModels.filter(m => String(m).toLowerCase().indexOf(q) >= 0) : aiModels.slice();
}
function aiPickAll(){
  aiPickVisible().forEach(m => { if(aiPicked.indexOf(m) < 0) aiPicked.push(m); });
  aiSyncModelsToText();
  renderAiModels();
}
function aiPickNone(){
  aiPicked = [];
  aiSyncModelsToText();
  renderAiModels();
}

// ---------- AI 助手（聊天：流式输出 + 历史记录）----------
let aiConvId = null;          // 当前会话 id（null 表示新对话，首次保存后回填）
let aiPendingConv = null;     // 从 URL（/admin/ai/<id>）解析出的待打开会话 id
let aiConvMessages = [];      // [{role, content}]
let aiStreaming = false;      // 是否正在流式接收
let aiAbort = null;           // 中止控制器
let aiUsagePending = null;    // 进行中一轮的 usage（尚未写入消息，供「i」面板实时展示）
let aiPerfPending = null;     // 进行中一轮的耗时（首字延迟等，供「i」面板实时展示）
let aiChatProxy = false;      // 前端代理（取自设置中已保存的配置）
let aiPrompt = '';            // AI 提示词（系统提示）
let aiPromptDefault = '';     // 内置默认系统提示词（「还原默认」用）
let aiThinkLevel = 'off';     // 思考强度：off / low / medium / high（非 off 时作为 reasoning_effort 下发）
let aiThink = false;          // 是否开启思考（由 aiThinkLevel 派生）
let aiConvTitle = '';         // 当前会话标题（重命名后使用；为空时按首条用户消息生成）
let aiPermission = 'safe';    // 权限级别：safe 安全访问 / important 重要确认 / all 全部确认 / full 完全访问
let aiTools = null;           // 工具定义（权限非安全时加载）
let aiToolsHint = '';         // 工具使用说明（含密钥占位符名称）
let aiToolDanger = [];        // 危险工具名单
const AI_MAX_ROUNDS = 50;     // 单轮AI回复允许的最大工具调用轮数（最后一轮不再给工具，强制收尾）

async function loadAiChat(){
  // 进入页面：加载历史会话列表 + 模型下拉（可选模型）
  // 若 URL 带会话 id，先立刻显示「加载中」，避免打开期间标题/内容空白
  if(aiPendingConv) aiShowLoading('加载中…');
  loadAiConversations();
  aiInitSide();
  aiLoadPrefs();
  try{
    const r = await api('/admin/api/ai/settings');
    const d = (r.ok && r.data) ? r.data : {};
    aiChatProxy = !!d.clientProxy;
    aiPromptDefault = String(d.defaultPrompt || '').trim();
    aiPrompt = String(d.prompt || '').trim() || aiPromptDefault;
    aiPermission = d.permission || 'safe';
    const pm = $('#aiChatPermission'); if(pm) pm.value = aiPermission;
    const sel = $('#aiChatModel');
    if(sel){
      const list = (Array.isArray(d.models) && d.models.length) ? d.models : (d.model ? [d.model] : []);
      const sig = list.join('|');
      // 仅在可选模型发生变化时重建下拉
      if(sel.dataset.sig !== sig){
        sel.dataset.sig = sig;
        sel.innerHTML = list.length
          ? list.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('')
          : '<option value="">（未配置模型）</option>';
      }
      // 记住用户在该聊天页选择的模型：优先恢复上次选择，否则用默认（第一个已选模型）
      let saved = '';
      try{ saved = localStorage.getItem('aiChatModel') || ''; }catch(e){}
      const want = (saved && list.indexOf(saved) >= 0)
        ? saved
        : (d.model && list.indexOf(d.model) >= 0 ? d.model : (list[0] || ''));
      sel.value = want;
    }
    aiUpdateHint();
  }catch(e){}
  aiLoadTools();
  // URL 带会话 id（/admin/ai/<id>）时，进入页面即打开该对话
  if(aiPendingConv){ const id = aiPendingConv; aiPendingConv = null; aiOpenConv(id); }
}
// 按权限加载工具定义与使用说明（安全访问不加载工具，AI 只能对话）
async function aiLoadTools(){
  aiTools = null; aiToolsHint = ''; aiToolDanger = [];
  if(aiPermission === 'safe'){ aiUpdateHint(); return; }
  try{
    const r = await api('/admin/api/ai/tools');
    if(r.ok && r.data){
      aiTools = Array.isArray(r.data.tools) ? r.data.tools : [];
      aiToolsHint = String(r.data.hint || '');
      aiToolDanger = Array.isArray(r.data.danger) ? r.data.danger : [];
    }
  }catch(e){}
  aiUpdateHint();
}
// 收起 / 展开会话侧边栏（手机端默认收起，从侧面滑出；选择会被记住）
function aiSetSide(off){
  const el = document.querySelector('.ai-chat'); if(!el) return;
  el.classList.toggle('side-off', off);
  const btn = $('#aiSideToggle'); if(btn) btn.style.display = off ? '' : 'none';
}
function aiToggleSide(){
  const el = document.querySelector('.ai-chat'); if(!el) return;
  const off = !el.classList.contains('side-off');
  aiSetSide(off);
  try{ localStorage.setItem('aiSideOff', off ? '1' : '0'); }catch(e){}
}
function aiInitSide(){
  let pref = null;
  try{ pref = localStorage.getItem('aiSideOff'); }catch(e){}
  aiSetSide(pref === null ? window.innerWidth <= 640 : pref === '1');
}
// 顶栏提示：仅在未配置 AI 时给出引导（权限在输入框下方选择）
async function aiUpdateHint(){
  const hint = $('#aiChatHint'); if(!hint) return;
  const base = await resolveAiBase();
  hint.textContent = base ? '' : '尚未配置 AI，请到「设置 → AI 设置」填写';
}
// 切换权限级别：生效并同步保存到设置
async function aiSetPermission(v){
  aiPermission = v || 'safe';
  const sel = $('#aiChatPermission'); if(sel && sel.value !== aiPermission) sel.value = aiPermission;
  aiLoadTools();
  try{ await api('/admin/api/ai/settings', { method:'PUT', body: JSON.stringify({ permission: aiPermission }) }); }catch(e){}
}
// 记录用户在聊天页选择的模型（localStorage），刷新后仍生效
function aiSetChatModel(v){
  try{ localStorage.setItem('aiChatModel', String(v || '')); }catch(e){}
}
// 读取本地偏好：思考强度、全屏
function aiLoadPrefs(){
  let lv = 'off';
  try{ lv = localStorage.getItem('aiThinkLevel') || 'off'; }catch(e){}
  aiSetThink(lv);
  try{ if(localStorage.getItem('aiFull') === '1') aiSetFull(true); }catch(e){}
}
// 思考强度：off 关闭；low/medium/high 作为 reasoning_effort 发给服务商
function aiSetThink(lv){
  lv = ['off','low','medium','high'].indexOf(lv) >= 0 ? lv : 'off';
  aiThinkLevel = lv;
  aiThink = lv !== 'off';
  const sel = $('#aiChatThink'); if(sel && sel.value !== lv) sel.value = lv;
  try{ localStorage.setItem('aiThinkLevel', lv); }catch(e){}
}
function aiSetFull(on){
  const el = document.querySelector('.ai-chat'); if(!el) return;
  el.classList.toggle('ai-full', !!on);
  const b = $('#aiFullBtn'); if(b) b.textContent = on ? '退出全屏' : '全屏';
  aiFitHeight();
}
function aiToggleFull(){
  const el = document.querySelector('.ai-chat'); if(!el) return;
  const on = !el.classList.contains('ai-full');
  aiSetFull(on);
  try{ localStorage.setItem('aiFull', on ? '1' : '0'); }catch(e){}
  scrollAiBottom();
}
// 手机端：把聊天卡片高度精确设为「卡片顶部到屏幕底部」，确保输入框紧贴屏幕底边
function aiFitHeight(){
  const el = document.querySelector('.ai-chat'); if(!el) return;
  if(window.innerWidth > 640 || el.classList.contains('ai-full')){ el.style.height = ''; return; }
  const page = $('#page-ai');
  if(page && page.classList.contains('hidden')) return;
  const rect = el.getBoundingClientRect();
  const absTop = rect.top + (window.scrollY || window.pageYOffset || 0);
  const vh = document.documentElement.clientHeight || window.innerHeight;
  el.style.height = Math.max(220, Math.round(vh - absTop)) + 'px';
  scrollAiBottom();
}
// 保存系统提示词（立即生效，改动过大可能导致 AI 不好用）
async function aiSavePrompt(){
  const ta = $('#aiPrompt'); if(!ta) return;
  if(!confirm('保存后立即生效。\\n\\n系统提示词会直接影响 AI 的工具调用与回答方式，改动不当可能导致 AI 无法正常使用，请确认保存。')) return;
  const r = await api('/admin/api/ai/settings', { method:'PUT', body: JSON.stringify({ prompt: ta.value }) });
  if(r.ok && r.data){
    aiPrompt = String(r.data.prompt || '').trim() || aiPromptDefault;
    toast('系统提示词已保存');
  } else toast('保存失败', true);
}
// 还原为内置默认提示词（需再点「保存」才生效）
function aiResetPrompt(){
  const ta = $('#aiPrompt'); if(!ta) return;
  if(!confirm('还原为内置默认系统提示词？还原后需点「保存」才会生效。')) return;
  ta.value = aiPromptDefault || '';
}
async function loadAiConversations(){
  const box = $('#aiConvList'); if(!box) return;
  // 列表为空（首次加载/尚无数据）时显示加载中，已有内容则不闪烁
  if(!box.querySelector('.ai-conv')) box.innerHTML = '<div class="empty">加载中…</div>';
  try{
    const r = await api('/admin/api/ai/conversations');
    if(!r.ok || !r.data){ box.innerHTML = '<div class="empty">加载失败</div>'; return; }
    const list = (r.data.list || []);
    if(!list.length){ box.innerHTML = '<div class="empty">暂无历史会话</div>'; return; }
    box.innerHTML = list.map(c=>{
      const active = (c.id === aiConvId) ? ' active' : '';
      return '<div class="ai-conv'+active+'" data-id="'+c.id+'" onclick="aiOpenConv('+c.id+')">'+
        '<span class="ai-conv-t">'+esc(c.title || '未命名对话')+'</span>'+
        '<button class="wk-btn ghost sm" onclick="event.stopPropagation();aiDelConv('+c.id+')">删</button>'+
      '</div>';
    }).join('');
  }catch(e){ box.innerHTML = '<div class="empty">加载失败</div>'; }
}
// 加载中/加载失败：顶部标题与消息区同时提示（用户能一眼看到正在加载）
function aiShowLoading(tip){
  const t = $('#aiChatTitle'); if(t) t.textContent = tip || '加载中…';
  const col = $('#aiCol'); if(col) col.innerHTML = '<div class="empty">' + (tip || '加载中…') + '</div>';
}
// 同步地址栏：/admin/ai/<id>（新对话则回到 /admin/ai），刷新后仍停留在当前对话
function aiSyncUrl(){
  try{ history.replaceState(null, '', aiConvId ? ('/admin/ai/' + aiConvId) : '/admin/ai'); }catch(e){}
}
function aiNewChat(){
  if(aiStreaming){ toast('正在回复中，请稍候', true); return; }
  aiConvId = null; aiConvMessages = []; aiConvTitle = ''; aiUsagePending = null; aiPerfPending = null;
  aiSetTitle('');
  aiUpdateUsagePop();
  renderAiMessages();
  loadAiConversations();
  aiSyncUrl();
  const i = $('#aiInput'); if(i) i.focus();
}
async function aiOpenConv(id){
  if(aiStreaming){ toast('正在回复中，请稍候', true); return; }
  // 打开会话期间：顶部名字与消息区都显示「加载中」
  aiShowLoading('加载中…');
  const oldId = aiConvId;
  aiConvId = id; // 先高亮，避免列表点击无反馈
  loadAiConversations();
  let r;
  try{
    r = await api('/admin/api/ai/conversation?id=' + id);
  }catch(e){
    aiConvId = oldId;
    aiShowLoading('加载失败');
    toast('加载会话失败：网络错误', true);
    return;
  }
  if(!r.ok || !r.data || !r.data.conversation){
    aiConvId = oldId;
    aiShowLoading('加载失败');
    toast('加载会话失败' + (r.data && r.data.error ? '：' + r.data.error : ''), true);
    loadAiConversations();
    return;
  }
  const c = r.data.conversation;
  aiConvId = c.id;
  aiConvMessages = Array.isArray(c.messages) ? c.messages : [];
  aiConvTitle = c.title || ''; aiUsagePending = null; aiPerfPending = null;
  aiSetTitle(aiConvTitle);
  aiUpdateUsagePop();
  renderAiMessages();
  aiSyncUrl();
  loadAiConversations();
}
// 顶部标题：空标题时回退到首条用户消息前 30 字
function aiSetTitle(t){
  const firstUser = aiConvMessages.find(m => m.role === 'user');
  const show = (t || (firstUser ? firstUser.content.slice(0, 30) : '') || '新对话');
  const el = $('#aiChatTitle');
  if(el) el.textContent = show;
}
// 重命名当前对话（取首次用户消息作为默认名）
function aiRenameConv(){
  if(aiStreaming){ toast('正在回复中，请稍候', true); return; }
  const firstUser = aiConvMessages.find(m => m.role === 'user');
  const cur = aiConvTitle || (firstUser ? firstUser.content.slice(0, 30) : '新对话');
  const t = prompt('重命名对话', cur);
  if(t === null) return;
  const nt = t.trim().slice(0, 100);
  if(!nt) return;
  aiConvTitle = nt;
  aiSetTitle(nt);
  aiSaveConversation();
}
async function aiDelConv(id){
  if(!confirm('确认删除该会话？')) return;
  const r = await api('/admin/api/ai/conversation?id=' + id, { method:'DELETE' });
  if(r.ok){ if(aiConvId === id) aiNewChat(); else loadAiConversations(); }
  else toast('删除失败', true);
}
// ===== 轻量 Markdown 渲染（先转义再转换，防 XSS）=====
function mdInline(s){
  s = s.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
  s = s.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\\*([^*]+)\\*/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}
function mdToHtml(src){
  const lines = String(src == null ? '' : src).replace(/\\r\\n?/g, '\\n').split('\\n');
  let out = '', list = null, i = 0;
  function closeList(){ if(list){ out += (list === 'ul' ? '</ul>' : '</ol>'); list = null; } }
  while(i < lines.length){
    const line = lines[i];
    // 代码块
    if(/^\\s*\`\`\`/.test(line)){
      closeList();
      const buf = []; i++;
      while(i < lines.length && !/^\\s*\`\`\`/.test(lines[i])){ buf.push(lines[i]); i++; }
      i++;
      out += '<pre class="md-pre"><code>' + esc(buf.join('\\n')) + '</code></pre>';
      continue;
    }
    if(!line.trim()){ closeList(); i++; continue; }
    // 标题
    let m = line.match(/^(#{1,6})\\s+(.*)$/);
    if(m){ closeList(); const lv = m[1].length; out += '<h' + lv + '>' + mdInline(esc(m[2])) + '</h' + lv + '>'; i++; continue; }
    // 分割线
    if(/^\\s*([-*_])\\1{2,}\\s*$/.test(line)){ closeList(); out += '<hr>'; i++; continue; }
    // 引用
    if(/^\\s*>\\s?/.test(line)){
      closeList();
      const buf = [];
      while(i < lines.length && /^\\s*>\\s?/.test(lines[i])){ buf.push(lines[i].replace(/^\\s*>\\s?/, '')); i++; }
      out += '<blockquote>' + mdInline(esc(buf.join('\\n'))).replace(/\\n/g, '<br>') + '</blockquote>';
      continue;
    }
    // 列表
    const ul = line.match(/^\\s*[-*+]\\s+(.*)$/);
    const ol = line.match(/^\\s*\\d+[.)]\\s+(.*)$/);
    if(ul || ol){
      const want = ul ? 'ul' : 'ol';
      if(list !== want){ closeList(); out += want === 'ul' ? '<ul>' : '<ol>'; list = want; }
      out += '<li>' + mdInline(esc((ul || ol)[1])) + '</li>';
      i++; continue;
    }
    // 段落
    closeList();
    const buf = [line]; i++;
    while(i < lines.length && lines[i].trim() && !/^\\s*(#{1,6}\\s|>|[-*+]\\s|\\d+[.)]\\s|\`\`\`)/.test(lines[i])){ buf.push(lines[i]); i++; }
    out += '<p>' + mdInline(esc(buf.join('\\n'))).replace(/\\n/g, '<br>') + '</p>';
  }
  closeList();
  return out;
}
// 优先使用完整的 GFM 解析器（marked）渲染，缺失时回退到内置轻量渲染；输出均经 DOMPurify 清洗
function renderMd(src){
  const s = String(src == null ? '' : src);
  const M = (typeof window !== 'undefined') ? window.marked : null;
  if(M && typeof M.parse === 'function'){
    try{
      // 兼容不同版本的配置入口（marked.parse 在 v5+ 可直接调用）
      const opts = { gfm:true, breaks:true };
      let html = (typeof M.use === 'function') ? M.parse(s, opts) : M(s, opts);
      // 链接在新标签打开
      html = html.replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=');
      const D = (typeof window !== 'undefined') ? window.DOMPurify : null;
      if(D && typeof D.sanitize === 'function'){
        html = D.sanitize(html, { ADD_ATTR:['target', 'rel'] });
      }
      return html;
    }catch(e){}
  }
  return mdToHtml(s);
}
// 工具结果：紧凑展示
function aiToolNoteHtml(m){
  const denied = !!(m && m.denied);
  const short = String((m && m.content) == null ? '' : m.content).replace(/\\s+/g, ' ').slice(0, 200);
  return '<div class="ai-tool-note'+(denied?' err':'')+'"><span class="ai-tool-tag">'+
    (denied?'已拒绝':'工具结果')+'</span>'+esc((m && m.name) || '')+(short ? '：' + esc(short) : '')+'</div>';
}
// 折叠块的展开状态（data-k -> 是否展开）。只记录用户手动操作过的块，
// 其余按默认状态：过程块在生成中默认展开、生成结束后默认收起
const aiFoldOpen = {};
// 生成后立即绑定：用户手动展开/收起时记住状态，重渲染后按此恢复
function aiBindFolds(box){
  box.querySelectorAll('details[data-k]').forEach(function(d){
    d.addEventListener('toggle', function(){ aiFoldOpen[d.getAttribute('data-k')] = d.open; });
  });
}
// 折叠块的 open 属性：用户操作过就听用户的，否则用默认值
function aiFoldAttr(key, defOpen){
  const v = aiFoldOpen[key];
  return (v === undefined ? !!defOpen : v) ? ' open' : '';
}
function renderAiMessages(){
  const box = $('#aiCol'); if(!box) return;
  if(!aiConvMessages.length){ box.innerHTML = '<div class="empty">开始和 AI 对话吧</div>'; return; }
  let html = '';
  let i = 0;
  while(i < aiConvMessages.length){
    const m = aiConvMessages[i] || {};
    if(m.role === 'user'){ html += aiBubbleHtml('user', m.content, i, m); i++; continue; }
    // 一轮 AI 回复：assistant 及其后的 tool 结果合并成一个气泡
    const start = i, turn = [];
    while(i < aiConvMessages.length && (aiConvMessages[i] || {}).role !== 'user'){ turn.push(aiConvMessages[i]); i++; }
    // 只有「正在生成中的最后一轮」默认展开过程，方便实时看进展
    const live = aiStreaming && i >= aiConvMessages.length;
    html += aiTurnHtml(turn, start, live);
  }
  box.innerHTML = html;
  aiBindFolds(box);
  scrollAiBottom();
}
// 撤回：删除该条及其之后的消息，并把该条内容放回输入框
function aiRecall(i){
  if(aiStreaming){ toast('正在回复中，请稍候', true); return; }
  if(i < 0 || i >= aiConvMessages.length) return;
  const m = aiConvMessages[i] || {};
  if(!confirm('撤回这条及之后的消息？内容会回到输入框。')) return;
  const text = (typeof m.content === 'string') ? m.content : '';
  aiConvMessages = aiConvMessages.slice(0, i);
  renderAiMessages();
  aiSetTitle(aiConvTitle);
  const inp = $('#aiInput'); if(inp){ inp.value = text; inp.focus(); }
  aiSaveConversation();
}
// 复制文本到剪贴板（供 aiCopy / aiCopyTurn 复用）
function aiCopyText(text){
  if(!text){ toast('没有可复制的内容', true); return; }
  const done = function(){ toast('已复制'); };
  const fallback = function(){
    try{
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); toast('已复制');
    }catch(e){ toast('复制失败', true); }
  };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else fallback();
}
// 复制单条消息原始内容（Markdown 源码 / 纯文本）
function aiCopy(i){
  if(i < 0 || i >= aiConvMessages.length) return;
  const m = aiConvMessages[i] || {};
  aiCopyText((typeof m.content === 'string') ? m.content : '');
}
// 复制本轮最终回答（与界面上单独显示的那一段一致，不含过程）
function aiCopyTurn(startIdx){
  let text = '';
  for(let k = startIdx; k < aiConvMessages.length; k++){
    const m = aiConvMessages[k] || {};
    if(m.role === 'user') break;
    if(m.role === 'tool') continue;
    if(m.tool_calls && m.tool_calls.length) continue;
    if(typeof m.content === 'string' && m.content.trim()) text = m.content;
  }
  aiCopyText(text);
}
// 单个工具：一次调用 + 它的结果，默认收起，展开后可见完整参数与返回内容
function aiToolFoldHtml(name, args, r, key){
  const denied = !!(r && r.denied);
  const argsFull = String(args == null ? '' : args).trim();
  const argsBrief = argsFull.replace(/\\s+/g, ' ').slice(0, 120);
  const resFull = r ? String(r.content == null ? '' : r.content).trim() : '';
  let head = '<span class="ai-tool-tag">调用</span>' + esc(name || '');
  if(argsBrief) head += ' <span class="ai-tool-inline">' + esc(argsBrief) + '</span>';
  if(denied) head += ' <span class="ai-tool-tag err">已拒绝</span>';
  let body = '<div class="ai-tool-fold-sec"><div class="ai-proc-tag">参数</div>' +
    '<div class="ai-tool-fold-pre">' + esc(argsFull || '{}') + '</div></div>';
  if(r){
    body += '<div class="ai-tool-fold-sec"><div class="ai-proc-tag">' + (denied ? '已拒绝' : '返回结果') + '</div>' +
      '<div class="ai-tool-fold-pre' + (denied ? ' err' : '') + '">' + esc(resFull || '（空）') + '</div></div>';
  }
  return '<details class="ai-tool-fold" data-k="' + key + '"' + aiFoldAttr(key, false) + '><summary>' +
    head + '</summary><div class="ai-tool-fold-body">' + body + '</div></details>';
}
// 汇总用量：兼容 OpenAI（prompt_tokens_details.cached_tokens）与 DeepSeek（prompt_cache_hit_tokens）
function aiAccUsage(acc, u){
  if(!u || typeof u !== 'object') return;
  acc.has = true;
  acc.prompt += (+u.prompt_tokens || 0);
  acc.completion += (+u.completion_tokens || 0);
  acc.total += (+u.total_tokens || ((+u.prompt_tokens || 0) + (+u.completion_tokens || 0)));
  acc.cached += ((u.prompt_tokens_details && +u.prompt_tokens_details.cached_tokens) || (+u.prompt_cache_hit_tokens) || 0);
}
function aiFmtNum(n){ n = +n || 0; return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ','); }
// 累计一段耗时数据：首字延迟取各轮平均；token 速率按「首字之后到结束」的生成时长平均
function aiAccPerf(u, p){
  if(!p || typeof p !== 'object') return;
  if(+p.ttft > 0){ u.ttftSum += +p.ttft; u.ttftN++; }
  const gen = (+p.ms || 0) - (+p.ttft || 0);
  if(+p.out > 0 && gen > 0){ u.genMs += gen; u.outTok += +p.out; }
}
// 整段对话累计用量（用于「i」按钮弹层）：已落库消息 + 进行中一轮的实时用量与耗时
function aiConvUsage(){
  const u = { has:false, total:0, cached:0, prompt:0, completion:0,
              ttftSum:0, ttftN:0, genMs:0, outTok:0 };
  aiConvMessages.forEach(function(m){ if(m && m.usage) aiAccUsage(u, m.usage); });
  if(aiUsagePending) aiAccUsage(u, aiUsagePending);
  aiConvMessages.forEach(function(m){ if(m && m.perf) aiAccPerf(u, m.perf); });
  if(aiPerfPending) aiAccPerf(u, aiPerfPending);
  return u;
}
// 速度行：首字速度（取整段平均）+ 平均 Token 速度
function aiSpeedRows(u){
  let s = '';
  if(u.ttftN > 0){
    s += '<div class="ai-usage-row"><span>首字速度</span><b>' + (u.ttftSum / u.ttftN / 1000).toFixed(2) + ' s</b></div>';
  }
  if(u.genMs > 0 && u.outTok > 0){
    s += '<div class="ai-usage-row"><span>平均Token速度</span><b>' + (u.outTok / (u.genMs / 1000)).toFixed(1) + ' tok/s</b></div>';
  }
  return s;
}
function aiUsagePopHtml(u){
  const speed = aiSpeedRows(u);
  if(!u.has && !speed){
    return '<div class="ai-usage-pop-h">Token 用量</div><div class="ai-usage-empty">当前对话暂无用量的数据（服务商未返回 usage）</div>';
  }
  let body = '';
  if(u.has){
    body = '<div class="ai-usage-row"><span>已使用</span><b>' + aiFmtNum(u.total) + ' tokens</b></div>'+
      '<div class="ai-usage-row"><span>输入</span><span>' + aiFmtNum(u.prompt) + '</span></div>'+
      '<div class="ai-usage-row"><span>输出</span><span>' + aiFmtNum(u.completion) + '</span></div>'+
      '<div class="ai-usage-row"><span>缓存命中</span><b>' + aiFmtNum(u.cached) + ' tokens</b></div>';
  }
  return '<div class="ai-usage-pop-h">Token 用量</div>' + body + speed;
}
// 弹层常开时，实时刷新其中的用量数字
function aiUpdateUsagePop(){
  const pop = document.getElementById('aiUsagePop');
  if(!pop) return;
  pop.innerHTML = aiUsagePopHtml(aiConvUsage());
  aiPositionUsagePop();
}
function aiPositionUsagePop(){
  const pop = document.getElementById('aiUsagePop');
  const btn = document.getElementById('aiUsageBtn');
  if(!pop || !btn) return;
  const r = btn.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = Math.max(8, r.top - pop.offsetHeight - 8) + 'px';
}
function aiCloseUsage(){
  const p = document.getElementById('aiUsagePop');
  if(p) p.remove();
  document.removeEventListener('click', aiCloseUsage);
}
// 「i」按钮：点击在按钮上方弹出用量详情
function aiToggleUsage(ev){
  if(ev) ev.stopPropagation();
  const existed = !!document.getElementById('aiUsagePop');
  aiCloseUsage();
  if(existed) return;
  const pop = document.createElement('div');
  pop.id = 'aiUsagePop';
  pop.className = 'ai-usage-pop';
  pop.innerHTML = aiUsagePopHtml(aiConvUsage());
  pop.addEventListener('click', function(e){ e.stopPropagation(); });
  document.body.appendChild(pop);
  aiPositionUsagePop();
  setTimeout(function(){ document.addEventListener('click', aiCloseUsage); }, 0);
}
// 一整轮 AI 回复（assistant + 其后的工具结果）渲染成一个气泡，分成两块：
//   ① 思考与工具调用过程：思考 / 中间输出 / 工具调用与结果，严格按 AI 实际发生的先后顺序，
//      生成中默认展开便于实时查看，生成结束后默认收起（用户可手动展开）
//   ② 最终回答：本轮最后一个 assistant 消息的正文，始终显示
// 生成过程中不显示「AI」标签与「复制」按钮，避免运行时的重复标记。
function aiTurnHtml(turn, startIdx, live){
  const resById = {};
  turn.forEach(function(m){ if(m && m.role === 'tool' && m.tool_call_id) resById[m.tool_call_id] = m; });
  // 最终回答 = 本轮最后一个「不带工具调用」的 assistant 消息的正文；其余正文都算过程
  let ansIdx = -1;
  for(let k = turn.length - 1; k >= 0; k--){
    const m = turn[k] || {};
    if(m.role === 'tool') continue;
    if(m.tool_calls && m.tool_calls.length) continue;
    if(typeof m.content === 'string' && m.content.trim()){ ansIdx = k; break; }
  }
  let proc = '', toolCount = 0, anyDenied = false;
  for(let k = 0; k < turn.length; k++){
    const m = turn[k] || {};
    if(m.role === 'tool') continue; // 结果已合并到对应「调用」处展示
    // 1) 思考
    if(m.reasoning){
      proc += '<div class="ai-proc-seg"><div class="ai-proc-tag">思考</div>' +
        '<div class="ai-proc-text">' + esc(m.reasoning) + '</div></div>';
    }
    // 2) 中间输出（不是最终回答的正文）
    if(m.content && k !== ansIdx){
      proc += '<div class="ai-proc-seg"><div class="ai-proc-tag">输出</div>' +
        '<div class="ai-body md">' + renderMd(m.content) + '</div></div>';
    }
    // 3) 工具调用与结果（保持紧跟在它发生的位置）
    if(m.tool_calls && m.tool_calls.length){
      m.tool_calls.forEach(function(t){
        const f = t.function || {};
        const r = resById[t.id];
        if(r && r.denied) anyDenied = true;
        toolCount++;
        proc += aiToolFoldHtml(f.name, f.arguments, r, 'tool-' + startIdx + '-' + k + '-' + toolCount);
      });
    }
  }
  const procKey = 'proc-' + startIdx;
  const procHtml = proc
    ? '<details class="ai-proc" data-k="' + procKey + '"' + aiFoldAttr(procKey, live || ansIdx < 0) + '>' +
        '<summary>思考与工具调用过程' + (toolCount ? '（' + toolCount + ' 次工具调用）' : '') +
        (anyDenied ? '（含被拒绝）' : '') + '</summary>' +
        '<div class="ai-proc-body">' + proc + '</div></details>'
    : '';
  const answerHtml = (ansIdx >= 0)
    ? '<div class="ai-body md ai-answer">' + renderMd(turn[ansIdx].content) + '</div>'
    : '';
  const acts = (!aiStreaming && ansIdx >= 0)
    ? '<div class="ai-acts"><button title="复制本段回复内容" onclick="aiCopyTurn(' + startIdx + ')">复制</button></div>'
    : '';
  const whoHtml = aiStreaming ? '' : '<div class="ai-who">AI</div>';
  return '<div class="ai-msg assistant">' + whoHtml + procHtml + answerHtml + acts + '</div>';
}
function aiBubbleHtml(role, content, idx, m){
  m = m || {};
  if(role === 'tool') return aiToolNoteHtml(m);
  const isUser = role === 'user';
  const hasText = content !== undefined && content !== null && String(content) !== '';
  const hasIdx = !(idx === undefined || idx === null);
  // 消息操作统一放到气泡底部：复制（复制原始 Markdown/文本）+ 撤回（仅用户消息）
  let acts = '';
  if(hasText || (hasIdx && isUser)){
    const copy = hasText ? '<button title="复制消息内容" onclick="aiCopy('+idx+')">复制</button>' : '';
    // 只有用户消息可撤回；AI 消息不显示撤回
    const recall = (hasIdx && isUser) ? '<button title="撤回这条及之后的消息" onclick="aiRecall('+idx+')">撤回</button>' : '';
    if(copy || recall) acts = '<div class="ai-acts">'+copy+recall+'</div>';
  }
  return '<div class="ai-msg '+(isUser?'user':'assistant')+'">'+
    '<div class="ai-who">'+(isUser?'我':'AI')+'</div>'+
    (hasText ? '<div class="ai-body'+(isUser?'':' md')+'">'+(isUser?esc(content):renderMd(content))+'</div>' : '')+
    acts +
  '</div>';
}
// 滚到聊天底部。消息渲染（Markdown/代码块/图片/折叠）可能在设置后继续改变内容高度，
// 导致停在半路、需要手动下滑；这里用「多帧 + 定时兜底」把这些延迟的高度变化也滚到底。
function scrollAiBottom(){
  const box = $('#aiMessages'); if(!box) return;
  aiEnsureColObserver();
  const pin = function(){ try{ box.scrollTop = box.scrollHeight; }catch(e){} };
  pin();
  requestAnimationFrame(function(){ pin(); requestAnimationFrame(pin); });
  clearTimeout(scrollAiBottom._t1); clearTimeout(scrollAiBottom._t2);
  scrollAiBottom._t1 = setTimeout(pin, 80);
  scrollAiBottom._t2 = setTimeout(pin, 260);
}
// 监听聊天内容高度变化：生成过程中（或用户已在底部附近）内容变高时保持贴底
let aiColObserver = null;
function aiEnsureColObserver(){
  const col = $('#aiCol'), box = $('#aiMessages');
  if(!col || !box || aiColObserver) return;
  try{
    aiColObserver = new ResizeObserver(function(){
      const nearBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 120;
      if(aiStreaming || nearBottom) box.scrollTop = box.scrollHeight;
    });
    aiColObserver.observe(col);
  }catch(e){}
}
function aiStop(){ if(aiAbort){ try{ aiAbort.abort(); }catch(e){} } }
// 发送键状态：生成中原地变成灰色「停止」按钮（同一个按钮，不额外加按钮）
function aiSetSendState(busy){
  const b = $('#aiSendBtn'); if(!b) return;
  b.textContent = busy ? '停止' : '发送';
  b.title = busy ? '停止生成' : '发送';
  if(busy) b.classList.add('stop'); else b.classList.remove('stop');
}

// 输入框自动增高（底部对齐，视觉上向上拉升）；超过上限后内部滚动
function aiAutoGrow(){
  const el = $('#aiInput'); if(!el) return;
  el.style.height = 'auto';
  const max = 220;
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
}
async function aiSend(){
  if(aiStreaming){ aiStop(); return; } // 生成中：该按钮就是「停止」
  const input = $('#aiInput');
  const text = ((input && input.value) || '').trim();
  if(!text){ toast('请输入内容', true); return; }
  aiConvMessages.push({ role:'user', content:text });
  if(input){ input.value = ''; aiAutoGrow(); }
  aiSetTitle(aiConvTitle);
  renderAiMessages();
  await aiAgentLoop();
}
// 是否需要用户确认：full 不确认；important 仅危险操作确认；all/其他 全部确认
function aiNeedConfirm(name){
  if(aiPermission === 'full') return false;
  if(aiPermission === 'important') return aiToolDanger.indexOf(name) >= 0;
  return true;
}
async function aiAgentLoop(){
  const modelEl = $('#aiChatModel');
  const modelName = modelEl ? modelEl.value.trim() : '';
  aiStreaming = true;
  aiSetSendState(true);
  const msg = $('#aiChatMsg'); if(msg){ msg.className = 'msg'; msg.textContent = ''; }
  aiAbort = new AbortController();
  let rounds = 0, finished = false;
  try{
    while(rounds < AI_MAX_ROUNDS){
      rounds++;
      // 最后一轮不再提供工具，强制模型用文字给出收尾答复，避免「执行到一半被截断」
      const lastRound = rounds >= AI_MAX_ROUNDS;
      renderAiMessages();
      const box = $('#aiCol');
      // 生成中的临时气泡：不显示「AI」标签；首个输出片段到达前先显示「等待模型响应」
      if(box) box.insertAdjacentHTML('beforeend', '<div class="ai-msg assistant">'+
        (aiThink ? '<details class="ai-think" id="aiCurThink" style="display:none" open><summary>思考中…</summary><div class="ai-think-body"></div></details>' : '')+
        '<div class="ai-body md" id="aiCurBody"></div>'+
        '<div class="ai-wait" id="aiCurWait">等待模型响应…</div></div>');
      scrollAiBottom();
      const bodyEl = box ? box.querySelector('#aiCurBody') : null;
      const thinkEl = box ? box.querySelector('#aiCurThink') : null;
      const waitEl = box ? box.querySelector('#aiCurWait') : null;
      const ui = { bodyEl: bodyEl, thinkEl: thinkEl, waitEl: waitEl, acc: '' };
      let res;
      try{
        res = await aiStreamRound(modelName, ui, lastRound);
      }catch(e){
        if(e && e.name === 'AbortError'){
          if(msg){ msg.className = 'msg'; msg.textContent = '已停止生成'; }
          // 停止时保留已生成的部分内容，重渲染后仍可见
          if(ui.acc){ aiConvMessages.push({ role:'assistant', content: ui.acc }); }
          finished = true;
          break;
        }
        const err = (e && e.message) ? e.message : String(e);
        const hint = aiChatProxyOn() ? '（前端代理请求失败：服务商可能不允许跨域）' : '';
        if(msg){ msg.className = 'msg err'; msg.textContent = '请求失败：' + err + hint; }
        toast('请求失败：' + err, true);
        // 保留已收到的部分内容，并清掉临时气泡（否则会残留「等待模型响应」）
        if(ui.acc){ aiConvMessages.push({ role:'assistant', content: ui.acc }); }
        finished = true;
        break;
      }
      if(res.toolCalls && res.toolCalls.length && !lastRound){
        const am = {
          role:'assistant',
          content: res.content || '',
          tool_calls: res.toolCalls.map(function(t){ return { id:t.id, type:'function', function:{ name:t.name, arguments:t.arguments } }; })
        };
        if(aiThink && res.reasoning) am.reasoning = res.reasoning;
        if(res.usage) am.usage = res.usage;
        if(res.perf) am.perf = res.perf;
        aiConvMessages.push(am);
        aiUsagePending = null; aiPerfPending = null; // 已并入消息，避免重复累计
        renderAiMessages();
        aiUpdateUsagePop();
        for(let k=0; k<res.toolCalls.length; k++){
          const t = res.toolCalls[k];
          let args = {};
          try{ args = JSON.parse(t.arguments || '{}'); }catch(e){ args = {}; }
          let resultStr, denied = false;
          if(t.name === 'request_secret'){
            // 凭据只能由用户在前端本地输入，绝不经过 AI：弹窗收集后直接写入服务端
            const out = await aiAskSecret(args);
            if(!out.ok) denied = true;
            resultStr = JSON.stringify(out);
          } else {
            let allow = true;
            if(aiNeedConfirm(t.name)) allow = await aiAskConfirm(t.name, args);
            if(allow){
              const rr = await api('/admin/api/ai/tool', { method:'POST', body: JSON.stringify({ name:t.name, args:args }) });
              if(rr.ok && rr.data && rr.data.ok) resultStr = String(rr.data.result || '');
              else resultStr = JSON.stringify({ ok:false, error:(rr.data && rr.data.error) || '执行失败' });
            } else {
              denied = true;
              resultStr = JSON.stringify({ ok:false, error:'用户已拒绝执行该操作' });
            }
          }
          aiConvMessages.push({ role:'tool', tool_call_id:t.id, name:t.name, content: resultStr, denied: denied });
        }
        renderAiMessages();
        continue;
      }
      const fm = { role:'assistant', content: res.content || (lastRound ? '（工具调用次数已达本轮上限，请回复「继续」以接着处理）' : '') };
      if(aiThink && res.reasoning) fm.reasoning = res.reasoning;
      if(res.usage) fm.usage = res.usage;
      if(res.perf) fm.perf = res.perf;
      aiConvMessages.push(fm);
      aiUsagePending = null; aiPerfPending = null;
      finished = true;
      break;
    }
  }finally{
    aiStreaming = false; aiAbort = null; aiUsagePending = null; aiPerfPending = null;
    aiSetSendState(false);
    aiUpdateUsagePop();
    // 生成结束（非中断/异常）后重渲染一次：恢复「AI」标签与「复制」按钮
    if(finished) renderAiMessages();
  }
  await aiSaveConversation();
  scrollAiBottom();
}
// 清理历史消息：去掉仅供前端展示的字段（思考/拒绝/用量），避免上游接口报错
function aiCleanMsg(m){
  if(!m || (m.reasoning === undefined && m.denied === undefined && m.usage === undefined && m.perf === undefined)) return m;
  const c = {};
  for(const k in m){ if(k !== 'reasoning' && k !== 'denied' && k !== 'usage' && k !== 'perf') c[k] = m[k]; }
  return c;
}
// 流式请求一轮，返回 {content, toolCalls, reasoning, usage}
async function aiStreamRound(modelName, ui, noTools){
  // 系统提示词（AI 提示词）+ 工具使用说明：仅在请求时附加，不写入历史
  const sysParts = [];
  if(aiPrompt) sysParts.push(aiPrompt);
  if(aiToolsHint && !noTools) sysParts.push(aiToolsHint);
  const hist = aiConvMessages.map(aiCleanMsg);
  const reqMessages = sysParts.length ? [{ role:'system', content: sysParts.join('\\n\\n') }].concat(hist) : hist;
  // stream_options.include_usage：让上游在流末尾附带 usage（token 用量/缓存命中）
  const payload = { messages: reqMessages, model: modelName, stream_options: { include_usage: true } };
  // 思考强度：作为 reasoning_effort 一并发给服务商（关闭时不发送）
  if(aiThink) payload.reasoning_effort = aiThinkLevel;
  // 收尾轮不带工具，让模型直接输出文字总结
  if(aiTools && aiTools.length && !noTools){ payload.tools = aiTools; payload.tool_choice = 'auto'; }
  const t0 = Date.now();   // 本轮发起点：用于首字速度与平均 token 速度
  let ttft = null;         // 首个输出片段耗时（ms）
  let resp;
  if(aiChatProxyOn()){
    // 前端代理：浏览器直连服务商（仅当服务商允许跨域 CORS 时可用）
    const base = await resolveAiBase();
    if(!base) throw new Error('前端代理需要 API 地址，请先在「设置 → AI 设置」填写 API 地址');
    const k = await resolveAiKey(aiVal('aiApiKey'));
    payload.stream = true;
    resp = await fetch(aiJoin(base, '/chat/completions'), {
      method:'POST',
      headers: Object.assign({'Content-Type':'application/json'}, k ? {Authorization:'Bearer ' + k} : {}),
      signal: aiAbort.signal,
      body: JSON.stringify(payload)
    });
  } else {
    const headers = { 'Content-Type':'application/json' };
    if(token) headers['Authorization'] = 'Bearer ' + token;
    resp = await fetch('/admin/api/ai/chat', {
      method:'POST',
      headers: headers,
      signal: aiAbort.signal,
      body: JSON.stringify(payload)
    });
  }
  const ct = resp.headers.get('content-type') || '';
  if(!resp.ok || ct.indexOf('application/json') >= 0){
    const d = await resp.json().catch(()=>({}));
    const em = d && d.error && (d.error.message || d.error);
    throw new Error((typeof em === 'string' && em) || ('HTTP ' + resp.status));
  }
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '', acc = '', reasonAcc = '', lastPaint = 0, usageAcc = null;
  const toolAcc = {};
  // 首个输出片段到达：撤掉「等待模型响应」，记录首字延迟并实时反映到「i」面板
  const markFirst = function(){
    if(ttft !== null) return;
    ttft = Date.now() - t0;
    if(ui && ui.waitEl) ui.waitEl.style.display = 'none';
    aiPerfPending = { ttft: ttft };
    aiUpdateUsagePop();
  };
  while(true){
    const chunk = await reader.read();
    if(chunk.done) break;
    buf += dec.decode(chunk.value, { stream:true });
    let idx;
    while((idx = buf.indexOf('\\n')) >= 0){
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if(!line || line.indexOf('data:') !== 0) continue;
      const pl = line.slice(5).trim();
      if(pl === '[DONE]'){ buf = ''; break; }
      let j;
      try{ j = JSON.parse(pl); }catch(e){ continue; }
      // usage 可能在末尾单独一帧（choices 为空）返回，需在取 delta 之前解析；
      // 同步给全局并刷新「i」面板，做到实时更新
      if(j.usage){ usageAcc = j.usage; aiUsagePending = j.usage; aiUpdateUsagePop(); }
      const delta = j.choices && j.choices[0] && j.choices[0].delta;
      if(!delta) continue;
      // 思考模式：保留模型返回的推理内容（reasoning_content / reasoning）
      if(aiThink){
        const rc = delta.reasoning_content || delta.reasoning;
        if(rc){
          reasonAcc += rc;
          markFirst();
          if(ui && ui.thinkEl){ ui.thinkEl.style.display = ''; const b = ui.thinkEl.querySelector('.ai-think-body'); if(b) b.textContent = reasonAcc; }
        }
      }
      if(delta.content){
        acc += delta.content;
        markFirst();
        if(ui) ui.acc = acc; // 暴露给调用方，停止时可保留部分内容
        const now = Date.now();
        if(ui && ui.bodyEl && (now - lastPaint > 80)){ lastPaint = now; ui.bodyEl.innerHTML = renderMd(acc); scrollAiBottom(); }
      }
      if(delta.tool_calls && delta.tool_calls.length){
        markFirst();
        for(let ti=0; ti<delta.tool_calls.length; ti++){
          const tc = delta.tool_calls[ti];
          const key = (tc.index === undefined || tc.index === null) ? 0 : tc.index;
          if(!toolAcc[key]) toolAcc[key] = { id:'', name:'', args:'' };
          if(tc.id) toolAcc[key].id = tc.id;
          if(tc.function){
            if(tc.function.name) toolAcc[key].name = tc.function.name;
            if(tc.function.arguments) toolAcc[key].args += tc.function.arguments;
          }
        }
      }
    }
  }
  const keys = Object.keys(toolAcc).sort(function(a,b){ return (+a) - (+b); });
  const toolCalls = keys.map(function(k){
    const t = toolAcc[k];
    return { id: t.id || ('call_' + k), name: t.name, arguments: t.args || '{}' };
  }).filter(function(t){ return !!t.name; });
  // 收尾：把流式内容按 Markdown 完整渲染一次
  if(ui && ui.bodyEl) ui.bodyEl.innerHTML = renderMd(acc);
  if(aiThink && ui && ui.thinkEl && !reasonAcc) ui.thinkEl.style.display = 'none';
  if(ui && ui.waitEl) ui.waitEl.style.display = 'none';
  scrollAiBottom();
  // out：本轮的输出 token 数（取上游 usage），用于折算平均 token 速度
  const outTok = usageAcc ? (+usageAcc.completion_tokens || 0) : 0;
  const perf = (ttft === null) ? null : { ttft: ttft, ms: Date.now() - t0, out: outTok };
  return { content: acc, toolCalls: toolCalls, reasoning: reasonAcc, usage: usageAcc, perf: perf };
}
// 危险操作确认卡片（返回 Promise：允许=true / 拒绝=false）
function aiAskConfirm(name, args){
  return new Promise(function(resolve){
    const box = $('#aiCol');
    if(!box){ resolve(false); return; }
    let argTxt = '';
    // save_secret 的确认卡片里不展示真实凭据值
    if(name === 'save_secret' && args && args.value){
      args = Object.assign({}, args, { value: '（已隐藏）' });
    }
    try{ argTxt = JSON.stringify(args, null, 2); }catch(e){ argTxt = String(args); }
    const div = document.createElement('div');
    div.className = 'ai-tool-confirm';
    div.innerHTML = '<div class="ai-tool-head">需要确认：' + esc(name) + '</div>'+
      '<pre class="ai-tool-pre">' + esc(argTxt) + '</pre>'+
      '<div class="filters" style="margin:8px 0 0">'+
        '<button class="wk-btn sm" data-yes>允许执行</button>'+
        '<button class="wk-btn ghost sm" data-no>拒绝</button>'+
      '</div>';
    box.appendChild(div);
    scrollAiBottom();
    div.querySelector('[data-yes]').onclick = function(){ div.remove(); resolve(true); };
    div.querySelector('[data-no]').onclick = function(){ div.remove(); resolve(false); };
  });
}
// AI 需要凭据但用户尚未提供：前端弹窗本地输入，值直接写入服务端密钥库，绝不发送给 AI
function aiAskSecret(args){
  args = args || {};
  return new Promise(function(resolve){
    const preName = String(args.name || '').trim();
    const purpose = String(args.purpose || preName || '凭据');
    const mask = document.createElement('div');
    mask.className = 'ai-secret-mask';
    mask.innerHTML = '<div class="ai-secret-box">'+
      '<div class="ai-secret-title">AI 请求你提供凭据</div>'+
      '<p class="ai-secret-desc">用途：'+esc(purpose)+'<br>该内容<b>不会发送给 AI</b>，将直接安全写入服务端，之后 AI 只能用占位符引用。</p>'+
      '<label class="wk-label">占位符名称</label>'+
      '<input class="wk-input" data-name value="'+esc(preName)+'" placeholder="如 SMTP_PASS">'+
      '<label class="wk-label">凭据值</label>'+
      '<input class="wk-input" type="password" data-value placeholder="在此输入，不会发给 AI">'+
      '<div class="filters" style="margin:14px 0 0">'+
        '<button class="wk-btn sm" data-ok>保存</button>'+
        '<button class="wk-btn ghost sm" data-cancel>取消</button>'+
      '</div>'+
      '<div class="msg" data-msg></div>'+
    '</div>';
    document.body.appendChild(mask);
    const nameEl = mask.querySelector('[data-name]');
    const valEl = mask.querySelector('[data-value]');
    const msgEl = mask.querySelector('[data-msg]');
    if(preName) valEl.focus(); else nameEl.focus();
    const close = function(v){ mask.remove(); resolve(v); };
    mask.querySelector('[data-cancel]').onclick = function(){ close({ ok:false, error:'用户取消输入' }); };
    mask.querySelector('[data-ok]').onclick = async function(){
      const nm = (nameEl.value || '').trim();
      const v = valEl.value || '';
      if(!nm){ msgEl.className = 'msg err'; msgEl.textContent = '请填写占位符名称'; return; }
      if(!v){ msgEl.className = 'msg err'; msgEl.textContent = '请填写凭据值'; return; }
      const r = await api('/admin/api/secrets', { method:'PUT', body: JSON.stringify({ name:nm, value:v }) });
      if(r.ok){
        toast('凭据已安全保存');
        try{ loadSecrets(); }catch(e){}
        close({ ok:true, name:nm, saved:true, message:'凭据已安全保存，可用占位符 {'+nm+'} 引用' });
      } else {
        msgEl.className = 'msg err'; msgEl.textContent = (r.data && r.data.error) || '保存失败';
      }
    };
  });
}

async function aiSaveConversation(){
  if(!aiConvMessages.length && !aiConvId) return;
  const firstUser = aiConvMessages.find(m => m.role === 'user');
  const title = (aiConvTitle || (firstUser ? firstUser.content.slice(0, 30) : '新对话')).slice(0, 100);
  const r = await api('/admin/api/ai/conversation', {
    method:'PUT',
    body: JSON.stringify({ id: aiConvId, title: title, messages: aiConvMessages })
  });
  if(r.ok && r.data && r.data.id){ aiConvId = r.data.id; aiSyncUrl(); loadAiConversations(); }
}

// ---------- AI 密钥（占位符 {name}，仅存名称，值不下发）----------
async function loadSecrets(){
  const box = $('#secList'); if(!box) return;
  try{
    const r = await api('/admin/api/secrets');
    const names = (r.ok && r.data && Array.isArray(r.data.names)) ? r.data.names : [];
    if(!names.length){ box.innerHTML = '<div class="empty">暂无密钥</div>'; return; }
    box.innerHTML = names.map(function(n){
      return '<div class="ai-conv" style="cursor:default"><span class="ai-conv-t">{'+esc(n)+'}</span>'+
        '<button class="wk-btn ghost sm" onclick="delSecret(\\''+esc(n)+'\\')">删</button></div>';
    }).join('');
  }catch(e){ box.innerHTML = '<div class="empty">加载失败</div>'; }
}
async function saveSecret(){
  const msg = $('#secMsg');
  const name = aiVal('secName').trim();
  const value = aiVal('secValue');
  if(!name){ toast('请填写名称', true); return; }
  if(!value){ toast('请填写密钥值', true); return; }
  const r = await api('/admin/api/secrets', { method:'PUT', body: JSON.stringify({ name:name, value:value }) });
  const err = (r.data && r.data.error) || '保存失败';
  if(r.ok){
    toast('密钥已保存');
    if(msg){ msg.className='msg ok'; msg.textContent='密钥已保存（AI 只能看到占位符 {' + name + '}）'; }
    const v = $('#secValue'); if(v) v.value='';
    loadSecrets();
  } else {
    toast(err, true);
    if(msg){ msg.className='msg err'; msg.textContent=err; }
  }
}
async function delSecret(name){
  if(!confirm('确认删除密钥 {' + name + '} ？')) return;
  const r = await api('/admin/api/secrets?name=' + encodeURIComponent(name), { method:'DELETE' });
  if(r.ok){ toast('已删除'); loadSecrets(); } else toast('删除失败', true);
}

// ---------- 订阅管理（SMTP 配置 + 订阅者 + 群发）----------
function subSet(id, v){ const el=$('#'+id); if(el) el.value = (v==null?'':v); }
// 仅加载 SMTP/订阅邮件模板（SMTP 字段在「设置」页，模板在「订阅管理」页）
async function loadSubscribeSettings(){
  try{
    const r = await api('/admin/api/subscribe/settings');
    if(r.ok && r.data){
      const d = r.data;
      subSet('smHost', d.host); subSet('smPort', d.port); subSet('smUser', d.user);
      subSet('smFromName', d.fromName); subSet('smFromEmail', d.fromEmail);
      subSet('smSiteName', d.siteName); subSet('smSiteUrl', d.siteUrl);
      subSet('smSubject', d.subject); subSet('smBody', d.body);
      subSet('smNotifySubject', d.notifySubject); subSet('smNotifyBody', d.notifyBody);
      subSet('smUnsubSubject', d.unsubSubject); subSet('smUnsubBody', d.unsubBody);
      const p = $('#smPass');
      if(p){ p.value=''; p.placeholder = d.hasPass ? '已保存（留空表示不修改）' : '未设置'; }
      const ck = $('#smNeedConfirm'); if(ck) ck.checked = !!d.needConfirm;
      subSet('smDailyLimit', d.dailyLimit);
      subSet('subDailyLimit', d.dailyLimit);
    }
  }catch(e){}
}
async function loadSubscribe(){
  await loadSubscribeSettings();
  loadSubscribers();
}
async function saveSubscribeSettings(){
  const v = id => { const el=$('#'+id); return el ? el.value : ''; };
  const ck = $('#smNeedConfirm');
  const payload = {
    host: v('smHost').trim(), port: v('smPort'), user: v('smUser').trim(),
    pass: v('smPass'), fromName: v('smFromName'), fromEmail: v('smFromEmail').trim(),
    siteName: v('smSiteName'), siteUrl: v('smSiteUrl').trim(),
    subject: v('smSubject'), body: v('smBody'), needConfirm: !!(ck && ck.checked),
    notifySubject: v('smNotifySubject'), notifyBody: v('smNotifyBody'),
    unsubSubject: v('smUnsubSubject'), unsubBody: v('smUnsubBody'),
    dailyLimit: v('smDailyLimit')
  };
  const r = await api('/admin/api/subscribe/settings', { method:'PUT', body: JSON.stringify(payload) });
  const msg = $('#subMsg');
  if(r.ok){
    toast('配置已保存');
    if(msg){ msg.className='msg ok'; msg.textContent='配置已保存'; }
    const p = $('#smPass'); if(p) p.value='';
    loadSubscribe();
  } else {
    const err = (r.data && r.data.error) || '保存失败';
    toast(err, true);
    if(msg){ msg.className='msg err'; msg.textContent=err; }
  }
}
async function sendSubscribeTest(){
  const to = ((($('#smTestTo')||{}).value) || '').trim();
  if(!to){ toast('请输入测试收件邮箱', true); return; }
  toast('发送中...');
  const r = await api('/admin/api/subscribe/test', { method:'POST', body: JSON.stringify({ to: to }) });
  if(r.ok) toast((r.data && r.data.message) || '测试邮件已发送');
  else toast('发送失败：' + ((r.data && r.data.error) || '未知错误'), true);
}
async function loadSubscribers(){
  const box = $('#subList');
  const st = $('#subStatus'), q = $('#subQ');
  const ps = [];
  if(st && st.value) ps.push('status=' + encodeURIComponent(st.value));
  if(q && q.value.trim()) ps.push('q=' + encodeURIComponent(q.value.trim()));
  try{
    const r = await api('/admin/api/subscribe/list' + (ps.length ? '?' + ps.join('&') : ''));
    if(!r.ok || !r.data){ if(box) box.innerHTML = '<div class="empty">加载失败</div>'; return; }
    const d = r.data, s = d.stats || {};
    const set = (id, n) => { const el=$('#'+id); if(el) el.textContent = (n==null?'-':n); };
    set('subTotal', s.total); set('subConfirmed', s.confirmed);
    set('subPending', s.pending); set('subUnsub', s.unsubscribed);
    set('subToday', s.today);
    const list = d.list || [];
    if(!box) return;
    if(!list.length){ box.innerHTML = '<div class="empty">暂无订阅者</div>'; return; }
    const cls = { confirmed:'ok', pending:'wait', unsubscribed:'off' };
    const label = { confirmed:'已确认', pending:'待确认', unsubscribed:'已退订' };
    let h = '<table class="wk-table"><thead><tr><th>邮箱</th><th>状态</th><th>订阅时间</th><th></th></tr></thead><tbody>';
    list.forEach(x => {
      const passBtn = x.status === 'pending'
        ? '<button class="wk-btn sm" onclick="approveSubscriber(' + x.id + ')">通过</button> '
        : '';
      h += '<tr><td>' + esc(x.email) + '</td>'
        + '<td><span class="wk-tag ' + (cls[x.status]||'') + '">' + esc(label[x.status]||x.status) + '</span></td>'
        + '<td>' + esc((x.createdAt||'').slice(0,10)) + '</td>'
        + '<td style="text-align:right">' + passBtn + '<button class="wk-btn ghost sm" onclick="delSubscriber(' + x.id + ')">删除</button></td></tr>';
    });
    h += '</tbody></table>';
    box.innerHTML = h;
  }catch(e){ if(box) box.innerHTML = '<div class="empty">加载失败</div>'; }
}
async function delSubscriber(id){
  if(!confirm('确认删除该订阅者？')) return;
  const r = await api('/admin/api/subscribe/subscriber?id=' + id, { method:'DELETE' });
  if(r.ok){ toast('已删除'); loadSubscribers(); } else toast('删除失败', true);
}
async function approveSubscriber(id){
  if(!confirm('确认通过该订阅者？通过后立即变为「已确认」，无需对方点邮件确认。')) return;
  const r = await api('/admin/api/subscribe/approve', { method:'POST', body: JSON.stringify({ id: id }) });
  if(r.ok){ toast('已通过'); loadSubscribers(); } else toast('操作失败：' + ((r.data && r.data.error) || '未知错误'), true);
}
async function saveSubLimit(){
  const el = $('#subDailyLimit');
  const v = el ? el.value : '';
  const r = await api('/admin/api/subscribe/settings', { method:'PUT', body: JSON.stringify({ dailyLimit: v }) });
  const msg = $('#subLimitMsg');
  if(r.ok){
    toast('已保存当日订阅上限');
    if(msg){ msg.className='msg ok'; msg.textContent='已保存'; }
    loadSubscribeSettings();
  } else {
    const err = (r.data && r.data.error) || '保存失败';
    toast(err, true);
    if(msg){ msg.className='msg err'; msg.textContent=err; }
  }
}
async function broadcastSubscribe(){
  const v = id => { const el=$('#'+id); return el ? el.value : ''; };
  const subject = v('bcSubject').trim(), body = v('bcBody').trim();
  if(!subject || !body){ toast('请填写主题和正文', true); return; }
  if(!confirm('确认发送给全部已确认订阅者？')) return;
  toast('发送中，请稍候...');
  const r = await api('/admin/api/subscribe/send', { method:'POST', body: JSON.stringify({ subject: subject, body: body }) });
  if(r.ok){
    const d = r.data || {};
    let tip = '发送完成：成功 ' + (d.sent||0) + '，失败 ' + (d.failed||0);
    if(d.limited) tip += '（单次上限 100 封，可再次点击继续）';
    toast(tip);
  } else toast('发送失败：' + ((r.data && r.data.error) || '未知错误'), true);
}

// ---------- 管理文章 ----------
// 用历史分类/标签填充输入框浏览器原生 datalist（可输入或从历史下拉选择）
function wireTaxonomySuggest(d){
  const ac=d&&d.allCategories||[], at=d&&d.allTags||[];
  const cl=$('#catList'), tl=$('#tagList');
  if(cl){ cl.innerHTML=''; ac.forEach(x=>{ const o=document.createElement('option'); o.value=x; cl.appendChild(o); }); }
  if(tl){ tl.innerHTML=''; at.forEach(x=>{ const o=document.createElement('option'); o.value=x; tl.appendChild(o); }); }
}
// 独立拉取历史分类/标签，填充写作页下拉建议（管理页由 loadPosts 调用；写作页单独调用）
async function loadTaxonomySuggest(){
  const r=await api(API_BASE+'/posts');
  if(r.ok&&r.data) wireTaxonomySuggest(r.data);
}
async function loadPosts(){
  const list = $('#postList'); if(!list) return;
  list.innerHTML = '<li class="empty">加载中...</li>';
  const r = await api(API_BASE+'/posts');
  if(r.status===401){ redirectLogin(); return; }
  if(!r.ok){ list.innerHTML = '<li class="empty">加载失败：'+(r.data&&r.data.error||r.status)+'</li>'; hideBatchBar(); return; }
  const posts = (r.data.posts||[]).slice().sort((a,b)=> (b.date||'').localeCompare(a.date||'') || String(b.name||'').localeCompare(String(a.name||'')));
  selectedPosts.clear();
  if(!posts.length){ list.innerHTML='<li class="empty">还没有文章，点右上角「＋ 添加新文章」开始写作</li>'; hideBatchBar(); return; }
  wireTaxonomySuggest(r.data);
  list.innerHTML='';
  posts.forEach(p=>{
    const li=document.createElement('li');
    const name=(p.name||'').replace(/\\.md$/,'');
    const cat=(p.categories||[]).map(esc).join(' / ');
    const tag=(p.tags||[]).map(esc).join(' · ');
    const taxo='<div class="meta">'+esc(p.path)+'</div>'+(cat?'<span class="chip">'+cat+'</span>':'')+(tag?'<span class="chip chipTag">'+tag+'</span>':'');
    li.innerHTML = '<div style="display:flex;align-items:center;gap:10px;min-width:0">'+
        '<input type="checkbox" class="postCheck" data-path="'+esc(p.path)+'" style="width:auto;flex-shrink:0">'+
        '<div><div class="name">'+esc(name)+'</div>'+taxo+'</div>'+
      '</div>'+
      '<div class="ops">'+
      '<button class="wk-btn ghost sm" data-a="edit" data-path="'+esc(p.path)+'">编辑</button>'+
      '<button class="wk-btn danger sm" data-a="del" data-path="'+esc(p.path)+'" data-name="'+esc(name)+'">删除</button>'+
      '</div>';
    list.appendChild(li);
  });
  showBatchBar();
}
// ---------- 管理文章：多选 / 批量操作 ----------
let selectedPosts = new Set();
function showBatchBar(){ const b=$('#batchBar'); if(b) b.classList.remove('hidden'); updateBatchBar(); }
function hideBatchBar(){ const b=$('#batchBar'); if(b) b.classList.add('hidden'); }
function updateBatchBar(){
  const n=selectedPosts.size;
  const cnt=$('#pickCount'); if(cnt) cnt.textContent=n;
  const del=$('#batchDelBtn'); if(del) del.disabled = n===0;
  const all=$('#pickAll');
  if(all){ const boxes=$$('#postList .postCheck'); all.checked = boxes.length>0 && n===boxes.length; }
}
async function deleteSelectedPosts(){
  const paths=Array.from(selectedPosts);
  if(!paths.length) return;
  if(!confirm('确认删除所选 '+paths.length+' 篇文章？将移入回收站，可恢复。')) return;
  const r=await api(API_BASE+'/posts/delete',{method:'POST',body:JSON.stringify({paths:paths})});
  if(r.status===401){ redirectLogin(); return; }
  if(r.ok&&r.data&&r.data.ok){
    toast('已移入回收站 '+(r.data.moved||0)+'/'+(r.data.total||paths.length)+' 篇，已推送到 GitHub');
    await loadPosts();
  } else toast('批量删除失败：'+(r.data&&r.data.error||r.status),true);
}
async function batchUploadPosts(files){
  if(!files||!files.length) return;
  toast('读取文件中…');
  const out=[];
  for(let i=0;i<files.length;i++){
    try{ out.push({name:files[i].name, content:await files[i].text()}); }
    catch(e){ toast('读取「'+files[i].name+'」失败',true); return; }
  }
  toast('上传中…');
  const r=await api(API_BASE+'/posts/upload',{method:'POST',body:JSON.stringify({files:out})});
  if(r.status===401){ redirectLogin(); return; }
  if(r.ok&&r.data&&r.data.created>0){
    toast('已上传 '+(r.data.created||0)+'/'+(r.data.total||out.length)+' 篇，已推送到 GitHub');
    await loadPosts();
  } else {
    const firstErr=(r.data&&r.data.results&&r.data.results[0]&&r.data.results[0].error)||(r.data&&r.data.error)||r.status;
    toast('上传失败：'+firstErr,true);
  }
}
function onListClick(e){
  const btn=e.target.closest('button'); if(!btn) return;
  const path=btn.dataset.path, name=btn.dataset.name;
  if(btn.dataset.a==='edit') openEdit(path);
  if(btn.dataset.a==='del') delPost(path,name);
}
async function openEdit(path){
  editingPath=path;
  const r=await api(API_BASE+'/post?path='+encodeURIComponent(path));
  if(r.status===401){ redirectLogin(); return; }
  if(!r.ok){ toast('加载失败 '+r.status,true); return; }
  const p=r.data.post||{};
  $('#title').value=p.title||'';
  $('#date').value=(p.date||new Date().toISOString().slice(0,10)).slice(0,10);
  $('#tags').value=(p.tags||[]).join('，');
  $('#categories').value=(p.categories||[]).join('，');
  $('#editorTitle').textContent='编辑：'+(p.title||nameOf(p.path));
  $('#saveBtn').textContent='保存修改';
  hideBuildBanner();
  pendingEditorValue=p.body||'';
  go('write');
  initEditorOnce();
  loadTaxonomySuggest(); // 编辑页也需要分类/标签历史建议（SPA 切换不会重新加载页面）
}
function nameOf(path){ return String(path||'').split('/').pop().replace(/\\.md$/,'')||'未命名'; }
function backToManage(){ go('manage'); }

async function savePost(){
  const title=$('#title').value.trim();
  const content=editor?editor.getValue():'';
  if(!title){ toast('请填写标题',true); return; }
  if(!content.trim()){ toast('请填写正文',true); return; }
  const body={ title, content,
    date:$('#date').value||new Date().toISOString().slice(0,10),
    tags:$('#tags').value.split(/[,，\\s]+/).map(s=>s.trim()).filter(Boolean),
    categories:$('#categories').value.split(/[,，\\s]+/).map(s=>s.trim()).filter(Boolean) };
  if(editingPath) body.path=editingPath;
  const isUpd=!!editingPath;
  $('#saveBtn').disabled=true; $('#saveBtn').textContent='提交中...';
  const r=await api(API_BASE+'/post',{method:isUpd?'PUT':'POST',body:JSON.stringify(body)});
  $('#saveBtn').disabled=false; $('#saveBtn').textContent=isUpd?'保存修改':'发布文章';
  if(r.status===401){ redirectLogin(); return; }
  if(r.ok&&r.data&&r.data.ok){
    toast(isUpd?'已保存并推送到 GitHub':'已发布并推送到 GitHub');
    clearDraft();
    go('manage');
  } else toast('保存失败：'+(r.data&&r.data.error||r.status),true);
}
async function delPost(path,name){
  if(!confirm('确认删除文章「'+name+'」？将移入回收站，可恢复。')) return;
  const r=await api(API_BASE+'/post?path='+encodeURIComponent(path),{method:'DELETE'});
  if(r.status===401){ redirectLogin(); return; }
  if(r.ok&&r.data&&r.data.ok){
    toast('已移入回收站，已推送到 GitHub');
    loadPosts();
  }
  else toast('删除失败：'+(r.data&&r.data.error||r.status),true);
}

// ---------- Vditor「分屏复杂模式」----------
function initEditorOnce(){
  // 等待 Vditor 脚本就绪
  if(!window.Vditor){ if(++editorReadyWait<200) setTimeout(initEditorOnce,250); return; }
  if(!editorInited){ initEditor(); }
  else if(editor){
    if(pendingEditorValue!=='' && editor.getValue()!==pendingEditorValue){
      editor.setValue(pendingEditorValue);
    }
    pendingEditorValue='';
    try{ editor.focus(); }catch(e){}
  }
}
function initEditor(){
  const opts={
    height: 540,
    lang: 'zh_CN',
    mode: 'sv',                       // 分屏预览「复杂模式」（cp.802213.xyz）
    theme: window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'classic',
    icon: 'ant',
    outline: true,
    counter: { enable: true, type: 'text' },
    cache: { enable: false },
    preview: {
      delay: 300,
      hljs: { enable:true, lineNumber:false, style: window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'atom-one-dark':'github' },
      markdown: { toc:true, mark:true, math:true, codeBlockPreview:true, at:true, gfmAutoLink:true, footnotes:true },
      tex: { inline:true, display:true },
      theme: { current: window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light' }
    },
    previewTheme: window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light',
    codeTheme: 'github',
    toolbarConfig: { pin: true, hide: false },
    toolbar: [
      'emoji','headings','bold','italic','strike','link','|',
      'list','ordered-list','check','outdent','indent','|',
      'quote','line','code','inline-code','table','|',
      'undo','redo','|','upload','record','|',
      'edit-mode','both','preview','fullscreen','outline','export','br'
    ],
    upload: { fieldName:'file', encoding:'base64', insertTo:2, linkToImgUrl:true },
    input: (v)=>{ saveDraft(); },
    after: ()=>{ editorInited=true; if(editor&&pendingEditorValue!==''){ editor.setValue(pendingEditorValue); pendingEditorValue=''; } }
  };
  try {
    editor = new Vditor('edt', opts);
    // 若 after 未触发，兜底延迟注入正文
    setTimeout(()=>{ if(editor&&pendingEditorValue!==''){ editor.setValue(pendingEditorValue); pendingEditorValue=''; } }, 800);
  } catch(e){
    console.error('Vditor init error:', e);
    $('#edt').innerHTML='<textarea id="edtFallback" style="width:100%;min-height:480px;"></textarea>';
    if(pendingEditorValue!==''){ const ta=document.querySelector('#edtFallback'); if(ta) ta.value=pendingEditorValue; pendingEditorValue=''; }
  }
}

// ---------- 评论管理 ----------
let commentFilter='all';
function setCommentFilter(f){
  commentFilter=f;
  $$('#commentFilter .wk-btn').forEach(b=>b.classList.toggle('act', b.dataset.f===f));
  loadComments();
}
async function loadComments(){
  const box=$('#commentList'); if(!box) return;
  box.innerHTML='<div class="empty">加载中...</div>';
  const statusParam=commentFilter==='all'?'':('&status='+commentFilter);
  const r=await api('/waline/api/comment?type=list&page=1&pageSize=100'+statusParam);
  if(r.status===401||r.status===403){ redirectLogin(); return; }
  const data=(r.data&&r.data.data)||{};
  const items=data.data||[];
  if(!items.length){ box.innerHTML='<div class="empty">暂无评论</div>'; return; }
  box.innerHTML='';
  items.forEach(it=>{
    const el=document.createElement('div');
    el.className='wk-comment';
    const st=it.status==='approved'?'<span class="status approved">已通过</span>':(it.status==='spam'?'<span class="status spam">垃圾</span>':'<span class="status waiting">待审批</span>');
    const time=it.insertedAt?new Date(it.insertedAt).toLocaleString('zh-CN',{hour12:false}):'';
    let ops='';
    if(it.status!=='approved') ops+='<button class="wk-btn sm" data-a="approve">通过</button>';
    if(it.status!=='spam') ops+='<button class="wk-btn act sm" data-a="spam">垃圾</button>';
    ops+='<button class="wk-btn danger sm" data-a="del">删除</button>';
    el.innerHTML='<div class="avatar">'+(it.avatar?'<img src="'+esc(it.avatar)+'">':'')+'</div>'+
      '<div style="flex:1">'+
        '<div><span class="nick">'+esc(it.nick)+'</span><span class="mail">'+esc(it.mail||'')+'</span><span class="ip">'+esc(it.ip||'')+'</span><span class="path">'+esc(it.url||'')+'</span><span class="time">'+esc(time)+'</span>'+st+'</div>'+
        '<div class="body">'+(it.comment||'')+'</div>'+
        '<div class="ops">'+ops+'</div>'+
      '</div>';
    el.dataset.id=it.objectId;
    box.appendChild(el);
  });
}
async function onCommentAction(e){
  const btn=e.target.closest('button'); if(!btn) return;
  const card=btn.closest('.wk-comment'); if(!card) return;
  const id=card.dataset.id, a=btn.dataset.a; if(!id) return;
  if(a==='del'&&!confirm('确认删除该评论？')) return;
  if(a==='approve'||a==='spam'){
    const r=await api('/waline/api/comment/'+id,{method:'PUT',body:JSON.stringify({status:a==='approve'?'approved':'spam'})});
    if(r.ok) loadComments(); else toast('操作失败',true);
  } else if(a==='del'){
    const r=await api('/waline/api/comment/'+id,{method:'DELETE'});
    if(r.ok) loadComments(); else toast('操作失败',true);
  }
}

// ---------- 构建状态横幅 ----------
let buildTimer=null;
// 进入管理页时：若已有构建在跑，则显示进度横幅并开始轮询（此前刚发布/删除会跳到这里）
async function initBuildStatus(){
  const r=await api(API_BASE+'/build');
  const d=r.data||{};
  if(!r.ok||!d||!d.ok) return;
  if(d.running){
    showBuildBanner('部署工作流正在重建站点…');
    pollBuild();
    return;
  }
  // 非运行中：最近一次失败也保留横幅与「查看日志 / 发给 AI」入口，成功后自动清除
  const latest=d.latest||{};
  if(latest.conclusion && latest.conclusion!=='success') showBuildResult(latest.conclusion, latest.id);
  else hideBuildBanner();
}
function buildBannerTargets(){ return [$('#globalBuildBanner'), $('#buildBanner'), $('#buildBannerBuild')]; }
function showBuildBanner(msg, cls){
  buildBannerTargets().forEach((b)=>{
    if(!b) return;
    b.className='build-banner '+(cls||'');
    b.textContent=msg;
    b.classList.remove('hidden');
  });
}
// 允许横幅里放按钮（如失败时的「查看日志 / 发给 AI」）
function showBuildBannerHtml(html, cls){
  buildBannerTargets().forEach((b)=>{
    if(!b) return;
    b.className='build-banner '+(cls||'');
    b.innerHTML=html;
    b.classList.remove('hidden');
  });
}
function hideBuildBanner(){
  buildBannerTargets().forEach((b)=>{ if(b) b.classList.add('hidden'); });
}
// 当前是否有可展示的构建结果 + AI 是否已配置（决定是否显示「发给 AI」）
let aiConfigured=false;
async function checkAiConfigured(){
  try{
    const r=await api(API_BASE+'/ai/settings');
    const d=r.data||{};
    aiConfigured = !!(d.baseUrl && d.hasKey && ((d.models&&d.models.length) || d.model));
  }catch(e){ aiConfigured=false; }
}
// 部署结束（成功/失败）：失败时在横幅里给出「查看日志(CF代理)」与「发给 AI」入口
function showBuildResult(conclusion, runId){
  const ok = conclusion==='success' || conclusion==='completed';
  if(ok){ showBuildBanner('站点已更新完成，可以刷新首页查看','ok'); return; }
  const id = runId ? String(runId) : '';
  let html = '<span>部署工作流失败（'+esc(conclusion||'未知')+'）</span>';
  html += '<button class="wk-btn ghost sm" onclick="showBuildLog(\\''+esc(id)+'\\')">查看日志(CF代理)</button>';
  if(aiConfigured) html += '<button class="wk-btn ghost sm" onclick="sendBuildLogsToAi(\\''+esc(id)+'\\')">发给 AI</button>';
  showBuildBannerHtml(html,'err');
}
function pollBuild(){
  if(buildTimer) clearInterval(buildTimer);
  let tries=0;
  buildTimer=setInterval(async ()=>{
    tries++;
    const r=await api(API_BASE+'/build');
    const d=r.data||{};
    if(!d.ok){
      if(tries>=12){ clearInterval(buildTimer); buildTimer=null; showBuildBanner('暂时无法获取构建状态，请稍后刷新页面查看站点','err'); return; }
      return;
    }
    const runs=d.runs||[];
    if(d.running){
      showBuildBanner('部署工作流正在运行中，已等待约 '+(tries*5)+' 秒…');
      if(tries>=24){ clearInterval(buildTimer); buildTimer=null; showBuildBanner('部署工作流仍在运行中，可稍后刷新查看',''); return; }
      return;
    }
    clearInterval(buildTimer); buildTimer=null;
    const runId=(d.latest&&d.latest.id)||(runs[0]&&runs[0].id)||'';
    showBuildResult(d.conclusion||d.status, runId);
    const box=$('#buildHistory'); if(box) loadBuildHistory();
  }, 5000);
}

// ---------- 手动运行工作流 + 部署记录 ----------
async function triggerBuild(){
  // 先检测是否已有构建在跑/排队，避免手动触发叠加出重复构建
  const st=await api(API_BASE+'/build');
  if(st.ok&&st.data&&st.data.running){
    const n=(st.data.runs||[]).length;
    if(!confirm('已有一个部署正在进行中'+(n>1?'（最近有 '+n+' 次构建）':'')+'，再触发一个会造成重复构建。确定还要运行吗？')) return;
  }
  if(!confirm('确定运行部署工作流吗？将重建整个站点。')) return;
  const r=await api(API_BASE+'/build/trigger',{method:'POST'});
  if(r.status===401){ redirectLogin(); return; }
  if(r.ok&&r.data&&r.data.ok){
    toast('已触发部署工作流，稍候开始构建');
    showBuildBanner('已触发部署工作流，正在重建站点…');
    // 触发后 run 需几秒才出现，稍作延迟后开始轮询与刷新历史
    setTimeout(pollBuild, 3000);
    setTimeout(()=>{ const box=$('#buildHistory'); if(box) loadBuildHistory(); }, 4000);
  } else {
    toast('触发失败：'+(r.data&&r.data.error||r.status),true);
    if(r.data&&r.data.detail) toast(r.data.detail,true);
  }
}
function buildBadge(status, conclusion){
  if(conclusion==='success') return '<span class="wk-badge success">成功</span>';
  if(conclusion==='failure') return '<span class="wk-badge fail">失败</span>';
  if(conclusion==='cancelled') return '<span class="wk-badge fail">已取消</span>';
  if(conclusion==='timed_out') return '<span class="wk-badge fail">超时</span>';
  if(status==='completed') return '<span class="wk-badge wait">'+(conclusion||'结束')+'</span>';
  return '<span class="wk-badge running">运行中</span>';
}
async function loadBuildHistory(){
  const box=$('#buildHistory'); if(!box) return;
  box.innerHTML='<div class="empty">加载中...</div>';
  const r=await api(API_BASE+'/build/history');
  if(r.status===401){ redirectLogin(); return; }
  if(!r.ok){ box.innerHTML='<div class="empty">加载失败：'+(r.data&&r.data.error||r.status)+'</div>'; return; }
  const runs=r.data.runs||[];
  if(!runs.length){ box.innerHTML='<div class="empty">暂无部署记录</div>'; return; }
  let html='<table class="wk-build-table"><thead><tr><th>#</th><th>时间</th><th>提交</th><th>状态</th><th>操作</th></tr></thead><tbody>';
  runs.forEach(rn=>{
    const t=rn.created_at?new Date(rn.created_at).toLocaleString('zh-CN',{hour12:false}):'';
    const id=esc(rn.id);
    html+='<tr><td><a href="'+esc(rn.html_url)+'" target="_blank" rel="noopener">#'+id+'</a></td>'+
      '<td>'+esc(t)+'</td><td><code>'+esc(rn.head_sha)+'</code></td>'+
      '<td>'+buildBadge(rn.status,rn.conclusion)+'</td>'+
      '<td style="white-space:nowrap">'+
        '<a class="wk-btn ghost sm" href="'+esc(rn.html_url)+'" target="_blank" rel="noopener" title="在 GitHub 打开">↗</a> '+
        '<button class="wk-btn ghost sm" onclick="showBuildLog(\\''+id+'\\')">查看日志</button>'+
      '</td></tr>';
  });
  html+='</tbody></table>';
  box.innerHTML=html;
}

// ---------- 工作流日志（Cloudflare 代理获取，不跳转 GitHub）----------
let logModalRunId='';
function closeLogModal(){ const m=$('#logModal'); if(m) m.classList.add('hidden'); }
async function fetchBuildLog(runId){
  const r=await api(API_BASE+'/build/log?id='+encodeURIComponent(runId||''));
  if(r.status===401){ redirectLogin(); return null; }
  if(!r.ok||!r.data||!r.data.ok) return null;
  return r.data;
}
async function showBuildLog(runId){
  const m=$('#logModal'), body=$('#logModalBody'); if(!m||!body) return;
  logModalRunId=runId||'';
  m.classList.remove('hidden');
  const gh=$('#logModalGh');
  if(gh) gh.href=logModalRunId?('https://github.com/__REPO__/actions/runs/'+logModalRunId):'https://github.com/__REPO__/actions';
  const ttl=$('#logModalTitle'); if(ttl) ttl.textContent=logModalRunId?('#'+logModalRunId):'（最近一次）';
  body.textContent='正在从 GitHub 获取日志（经 Cloudflare 代理）…';
  const d=await fetchBuildLog(logModalRunId);
  if(!d){ body.textContent='获取日志失败，请稍后重试，或点右上角「在 GitHub 打开」查看。'; return; }
  body.textContent=d.text||'（日志为空）';
}
// 把失败日志发给 AI 助手分析：切到 AI 页，填入日志并自动发送
async function sendBuildLogsToAi(runId){
  closeLogModal();
  go('ai');
  const input=$('#aiInput');
  const head='部署工作流'+(runId?(' #'+runId):'（最近一次）')+'失败了，请分析下面的构建日志，指出失败原因并给出修复建议：\\n\\n';
  if(input){ input.value=head+'（正在获取日志…）'; aiAutoGrow(); }
  const d=await fetchBuildLog(runId);
  let log=(d&&d.text)||'（未能获取到日志）';
  if(log.length>12000) log='...(日志已截断)\\n'+log.slice(-12000);
  if(input){ input.value=head+log; aiAutoGrow(); input.focus(); }
  setTimeout(()=>{ aiSend(); }, 80);
}

// ---------- 文件管理 ----------
let filePath='';
let fileBranch='';
let branchesLoaded=false;
let selectedFiles=new Set();
const RECYCLE_DIR='_recycle';
function curBranch(){ return fileBranch || 'main'; }
function isRecycleView(){ return filePath===RECYCLE_DIR || filePath.indexOf(RECYCLE_DIR+'/')===0; }
function fileApi(url){
  const sep=url.indexOf('?')>=0?'&':'?';
  return url+sep+'branch='+encodeURIComponent(curBranch());
}
function fmtSize(n){
  n=n||0;
  if(n<1024) return n+' B';
  if(n<1024*1024) return (n/1024).toFixed(1)+' KB';
  return (n/1024/1024).toFixed(1)+' MB';
}
function upLevel(){
  const parts=filePath.split('/').filter(Boolean);
  parts.pop();
  filePath=parts.join('/');
  loadFiles();
}
function renderCrumb(){
  const c=$('#fileCrumb'); if(!c) return;
  const parts=filePath.split('/').filter(Boolean);
  let html='<a href="javascript:;" data-dir="">根目录</a>';
  let cur='';
  parts.forEach((p,i)=>{
    cur=cur?cur+'/'+p:p;
    html+=' / <a href="javascript:;" data-dir="'+esc(cur)+'">'+esc(p)+'</a>';
  });
  c.innerHTML=html;
  $$('#fileCrumb a').forEach(a=>a.onclick=()=>{ filePath=a.dataset.dir; loadFiles(); });
}
async function loadBranches(selectCur){
  const sel=$('#branchSel'); if(!sel) return;
  const r=await api(API_BASE+'/branches');
  if(!r.ok||!r.data){ return; }
  const branches=r.data.branches||[];
  if(selectCur) fileBranch=r.data.current||'main';
  sel.innerHTML='';
  branches.forEach(b=>{
    const o=document.createElement('option'); o.value=b; o.textContent=b; sel.appendChild(o);
  });
  sel.value=fileBranch||(r.data.current||'main');
  if(!fileBranch||!sel.value) fileBranch=sel.value||'main';
  branchesLoaded=true;
}
async function loadFiles(){
  const list=$('#fileList'); if(!list) return;
  list.innerHTML='<li class="empty">加载中...</li>';
  const r=await api(fileApi(API_BASE+'/files?path='+encodeURIComponent(filePath)));
  if(r.status===401){ redirectLogin(); return; }
  selectedFiles.clear();
  renderCrumb();
  updateFileToolbar();
  if(!r.ok){
    if(isRecycleView()){ list.innerHTML='<li class="empty">回收站是空的</li>'; hideFileBatchBar(); return; }
    list.innerHTML='<li class="empty">加载失败：'+(r.data&&r.data.error||r.status)+'</li>'; hideFileBatchBar(); return;
  }
  const items=(r.data&&r.data.items)||[];
  list.innerHTML='';
  if(!items.length){ list.innerHTML='<li class="empty">'+(isRecycleView()?'回收站是空的':'空目录')+'</li>'; hideFileBatchBar(); return; }
  const rc=isRecycleView();
  items.forEach(f=>{
    const li=document.createElement('li');
    const isDir=f.type==='dir';
    const isZip=/\\.zip$/i.test(f.name||'');
    li.style.cursor=isDir?'pointer':'default';
    const pick='<input type="checkbox" class="filePick" data-path="'+esc(f.path)+'" style="width:auto;flex-shrink:0">';
    const label=isDir?('📁 '+esc(f.name)):('📄 '+esc(f.name)+' · '+fmtSize(f.size));
    let ops;
    if(rc){
      // 回收站：可恢复 / 彻底删除
      ops='<button class="wk-btn sm" data-a="restore">恢复</button>'+
          '<button class="wk-btn danger sm" data-a="purge">彻底删除</button>';
      if(!isDir) ops='<button class="wk-btn ghost sm" data-a="dl">下载</button>'+ops;
    } else if(isDir){
      ops='<button class="wk-btn danger sm" data-a="del">删除</button>';
    } else {
      ops='<button class="wk-btn ghost sm" data-a="edit">编辑</button>'+
          '<button class="wk-btn ghost sm" data-a="dl">下载</button>'+
          '<button class="wk-btn danger sm" data-a="del">删除</button>';
      if(isZip) ops='<button class="wk-btn act sm" data-a="zip">解压</button>'+ops;
    }
    li.innerHTML='<div style="display:flex;align-items:center;gap:10px;min-width:0">'+pick+'<div class="name">'+label+'</div></div>'+
      '<div class="ops">'+ops+'</div>';
    li.dataset.type=f.type; li.dataset.path=f.path; li.dataset.name=f.name;
    list.appendChild(li);
  });
  showFileBatchBar();
}
// ---------- 文件管理：多选 / 回收站 ----------
function updateFileToolbar(){
  const b=$('#recycleBtn'); if(b) b.textContent=isRecycleView()?'退出回收站':'回收站';
  const rc=isRecycleView();
  const toggle=(id,v)=>{ const el=$(id); if(el) el.classList.toggle('hidden',!v); };
  toggle('#fileBatchRecycle',!rc);
  toggle('#fileBatchRestore',rc);
  toggle('#fileBatchPurge',rc);
}
function showFileBatchBar(){ const b=$('#fileBatchBar'); if(b) b.classList.remove('hidden'); updateFileBatchBar(); }
function hideFileBatchBar(){ const b=$('#fileBatchBar'); if(b) b.classList.add('hidden'); }
function updateFileBatchBar(){
  const n=selectedFiles.size;
  const c=$('#filePickCount'); if(c) c.textContent=n;
  const all=$('#filePickAll');
  if(all){ const boxes=$$('#fileList .filePick'); all.checked=boxes.length>0&&n===boxes.length; }
}
async function fileBatchOp(kind){
  const paths=Array.from(selectedFiles);
  if(!paths.length) return;
  const conf={
    recycle:'确认将所选 '+paths.length+' 项移入回收站？',
    restore:'确认恢复所选 '+paths.length+' 项？',
    purge:'确认彻底删除所选 '+paths.length+' 项？此操作不可恢复！'
  }[kind];
  if(!confirm(conf)) return;
  const r=await api(API_BASE+'/files/'+kind,{method:'POST',body:JSON.stringify({paths:paths,branch:curBranch()})});
  if(r.status===401){ redirectLogin(); return; }
  const key={recycle:'moved',restore:'restored',purge:'purged'}[kind];
  const label={recycle:'移入回收站',restore:'恢复',purge:'彻底删除'}[kind];
  if(r.ok&&r.data&&r.data[key]>0) toast('已'+label+' '+r.data[key]+'/'+(r.data.total||paths.length)+' 项');
  else toast(label+'失败：'+(r.data&&r.data.error||r.status),true);
  selectedFiles.clear();
  loadFiles();
}
async function onFileClick(e){
  const btn=e.target.closest('button'); if(!btn) return;
  const li=btn.closest('li'); if(!li) return;
  const path=li.dataset.path, name=li.dataset.name, a=btn.dataset.a;
  if(a==='zip'){
    if(!confirm('解压「'+name+'」到当前目录？\\n小于 50MB 直接解压，大于 50MB 会触发 GitHub 工作流异步解压。')) return;
    const btn0=btn.textContent; btn.disabled=true; btn.textContent='解压中...';
    const r=await api(API_BASE+'/unzip-path',{method:'POST',body:JSON.stringify({path,branch:curBranch()})});
    btn.disabled=false; btn.textContent=btn0;
    if(r.status===401){ redirectLogin(); return; }
    if(r.ok&&r.data&&r.data.workflow){
      toast(r.data.message||'已触发解压工作流，正在解压...');
      startUnzipPoll();
      return;
    }
    if(r.ok&&r.data&&r.data.ok) toast(r.data.message||'解压完成');
    else toast('解压失败：'+(r.data&&r.data.error||r.status),true);
    loadFiles();
    return;
  }
  if(a==='del'){
    if(!confirm('确认删除「'+name+'」？将移入回收站，可恢复。')) return;
    const r=await api(API_BASE+'/files/recycle',{method:'POST',body:JSON.stringify({paths:[path],branch:curBranch()})});
    if(r.status===401){ redirectLogin(); return; }
    const err=(r.data&&r.data.error)||(r.data&&r.data.results&&r.data.results[0]&&r.data.results[0].error);
    if(r.ok&&r.data&&r.data.ok) toast('已移入回收站');
    else toast('删除失败：'+(err||r.status),true);
    loadFiles();
    return;
  }
  if(a==='restore'){
    const r=await api(API_BASE+'/files/restore',{method:'POST',body:JSON.stringify({paths:[path],branch:curBranch()})});
    if(r.status===401){ redirectLogin(); return; }
    const err=(r.data&&r.data.error)||(r.data&&r.data.results&&r.data.results[0]&&r.data.results[0].error);
    if(r.ok&&r.data&&r.data.ok) toast('已恢复');
    else toast('恢复失败：'+(err||r.status),true);
    loadFiles();
    return;
  }
  if(a==='purge'){
    if(!confirm('确认彻底删除「'+name+'」？此操作不可恢复！')) return;
    const r=await api(API_BASE+'/files/purge',{method:'POST',body:JSON.stringify({paths:[path],branch:curBranch()})});
    if(r.status===401){ redirectLogin(); return; }
    const err=(r.data&&r.data.error)||(r.data&&r.data.results&&r.data.results[0]&&r.data.results[0].error);
    if(r.ok&&r.data&&r.data.ok) toast('已彻底删除');
    else toast('彻底删除失败：'+(err||r.status),true);
    loadFiles();
    return;
  }
  if(a==='edit'){
    const r=await api(fileApi(API_BASE+'/file?path='+encodeURIComponent(path)));
    if(r.status===401){ redirectLogin(); return; }
    if(!r.ok){ toast('读取失败：'+(r.data&&r.data.error||r.status),true); return; }
    const d=r.data||{};
    if(d.binary){ toast('二进制文件暂不支持在线编辑，请下载后修改再上传',true); return; }
    fileEditPath=path;
    $('#fileEditPath').textContent=path;
    $('#fileEditArea').value=d.content||'';
    $('#fileEditor').classList.remove('hidden');
    return;
  }
  if(a==='dl'){
    const repo='__REPO__';
    const url=repo?('https://raw.githubusercontent.com/'+repo+'/'+curBranch()+'/'+encodeURIComponent(path)):('#');
    if(!repo){ toast('仓库未配置',true); return; }
    window.open(url,'_blank');
  }
}
async function onFileListClick(e){
  // 文件夹整行点击进入
  const li=e.target.closest('li'); if(!li||li.dataset.type!=='dir') return;
  if(e.target.closest('button')) return; // 点击按钮时交给 onFileClick
  if(e.target.closest('input')) return;  // 点击复选框时不进入目录
  filePath=li.dataset.path;
  loadFiles();
}
async function saveFileEdit(){
  const content=$('#fileEditArea').value;
  const r=await api(API_BASE+'/file',{method:'PUT',body:JSON.stringify({path:fileEditPath,content,branch:curBranch()})});
  if(r.status===401){ redirectLogin(); return; }
  if(r.ok&&r.data&&r.data.ok){
    toast('已保存到 GitHub 仓库，如需部署请点击「运行工作流」');
    $('#fileEditor').classList.add('hidden');
    loadFiles();
  } else toast('保存失败：'+(r.data&&r.data.error||r.status),true);
}
async function doUpload(files){
  if(!files.length) return;
  const fd=new FormData();
  fd.append('path', filePath);
  fd.append('branch', curBranch());
  files.forEach(f=>fd.append('files', f));
  const r=await fetch(API_BASE+'/upload',{method:'POST',body:fd,headers:{Authorization:'Bearer '+token}});
  let d=null; try{ d=await r.json(); }catch(e){}
  if(r.status===401){ redirectLogin(); return; }
  if(d&&d.ok) toast(d.message||'上传成功');
  else toast('上传失败：'+(d&&d.error||r.status),true);
  loadFiles();
}
function newFolder(){
  const name=prompt('输入文件夹名称：');
  if(!name||!name.trim()) return;
  const target=(filePath?filePath+'/':'')+name.trim();
  const r=api(fileApi(API_BASE+'/file'),{method:'PUT',body:JSON.stringify({path:target+'/.gitkeep',content:'',branch:curBranch()})});
  r.then(res=>{
    if(res.ok&&res.data&&res.data.ok){ toast('已创建 '+name.trim()); loadFiles(); }
    else toast('创建失败',true);
  });
}
// ---------- 文件管理：从网络下载 / 大文件解压状态 ----------
async function downloadFromUrl(){
  const url=prompt('输入要下载的文件地址（http/https，或 GitHub 仓库 owner/repo）：');
  if(!url||!url.trim()) return;
  const suggest=url.trim().split(/[?#]/)[0].split('/').filter(Boolean).pop()||'';
  const name=prompt('保存的文件名（可修改，留空自动识别）：', /\.[a-z0-9]{2,5}$/i.test(suggest)?suggest:'');
  const dir=filePath?filePath+'/':'';
  toast('正在下载...');
  const r=await api(API_BASE+'/download',{method:'POST',body:JSON.stringify({url:url.trim(),name:(name||'').trim(),path:dir,branch:curBranch()})});
  if(r.status===401){ redirectLogin(); return; }
  if(r.ok&&r.data&&r.data.ok){ toast(r.data.message||'下载完成'); loadFiles(); }
  else toast('下载失败：'+(r.data&&r.data.error||r.status),true);
}
let unzipTimer=null, unzipSeen=false, unzipTries=0;
const UNZIP_DOT='<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);animation:aiWaitPulse 1s infinite;margin-right:6px"></span>';
function renderUnzipStatus(info){
  const el=$('#unzipStatus'); if(!el) return;
  if(!info){ el.classList.add('hidden'); el.innerHTML=''; return; }
  el.classList.remove('hidden');
  const label=info.label||'解压工作流';
  if(info.running){
    el.innerHTML=UNZIP_DOT+'<span>'+(info.text||'正在运行解压工作流…（大文件解压，约 10 秒完成）')+'</span>';
  }else{
    const okc=info.conclusion==='success';
    el.innerHTML=label+'已结束：'+(okc?'✅ 成功':'⚠️ '+(info.conclusion||'未知'))+
      (info.html_url?' <a href="'+info.html_url+'" target="_blank" style="color:var(--accent)">查看日志</a>':'');
    setTimeout(()=>{ const e2=$('#unzipStatus'); if(e2){ e2.classList.add('hidden'); e2.innerHTML=''; } },6000);
  }
}
async function checkUnzipStatus(){
  const r=await api(API_BASE+'/unzip-status');
  if(r.status===401){ redirectLogin(); return null; }
  if(!r.ok||!r.data||!r.data.ok) return null;
  return r.data;
}
function stopUnzipPoll(){ if(unzipTimer){ clearInterval(unzipTimer); unzipTimer=null; } }
async function unzipPollTick(){
  unzipTries++;
  const d=await checkUnzipStatus();
  if(!d){ if(unzipTries>=8){ stopUnzipPoll(); renderUnzipStatus(null); } return; }
  if(d.running){ unzipSeen=true; renderUnzipStatus({running:true}); return; }
  // GitHub 记录 run 有几秒延迟：没观察到 running 前先多等几轮
  if(!unzipSeen && unzipTries<8) return;
  stopUnzipPoll();
  const latest=d.latest||{};
  renderUnzipStatus({running:false,conclusion:latest.conclusion,html_url:latest.html_url});
  loadFiles();
}
function startUnzipPoll(){
  if(unzipTimer) return;
  stopClonePoll();
  unzipSeen=false; unzipTries=0;
  renderUnzipStatus({running:true});
  unzipTimer=setInterval(unzipPollTick,2500);
  unzipPollTick();
}
// ---------- 文件管理：克隆外部仓库（触发 clone-repo.yml）----------
let cloneTimer=null, cloneTries=0;
function stopClonePoll(){ if(cloneTimer){ clearInterval(cloneTimer); cloneTimer=null; } }
async function clonePollTick(target){
  cloneTries++;
  const r=await api(API_BASE+'/workflows/runs?workflow=clone-repo.yml');
  if(r.status===401){ redirectLogin(); return; }
  const d=r.data||{};
  if(!r.ok||!d.ok){ if(cloneTries>=8){ stopClonePoll(); renderUnzipStatus(null); } return; }
  if(d.running){ renderUnzipStatus({running:true,text:'正在克隆「'+(target||'目标目录')+'」…（约 10 秒完成）'}); return; }
  // 触发后 GitHub 记录 run 有几秒延迟，前几轮没观察到结果时继续等
  if(!d.latest && cloneTries<8) return;
  stopClonePoll();
  const latest=d.latest;
  if(!latest){ renderUnzipStatus({label:'克隆工作流',conclusion:'未发现运行记录（可能触发失败）'}); return; }
  renderUnzipStatus({label:'克隆工作流',conclusion:latest.conclusion,html_url:latest.html_url});
  if(latest.conclusion==='success') loadFiles();
}
async function cloneRepoFromUrl(){
  if(!confirm('克隆一个外部仓库到当前目录？\\n将自动触发 GitHub 工作流完成（约 10 秒），目标文件夹已存在且非空时会中止。')) return;
  const repo=prompt('输入要克隆的仓库（owner/repo 或完整 URL），例如 Hexo 主题：');
  if(!repo||!repo.trim()) return;
  const slug=(repo.trim().split('/').filter(Boolean).pop()||'repo').replace(/\.git$/,'');
  const sub=prompt('克隆到当前目录下的文件夹名：', slug);
  if(sub===null) return;
  const name=(sub.trim()||slug);
  const target=(filePath?filePath+'/':'')+name;
  toast('正在触发克隆工作流…');
  const r=await api(API_BASE+'/clone-repo',{method:'POST',body:JSON.stringify({repo_url:repo.trim(),target_dir:target,branch:curBranch()})});
  if(r.status===401){ redirectLogin(); return; }
  if(r.ok&&r.data&&r.data.ok){
    toast(r.data.message||'已触发克隆工作流');
    stopUnzipPoll();
    renderUnzipStatus({running:true,text:'正在克隆「'+name+'」…（约 10 秒完成）'});
    cloneTries=0;
    stopClonePoll();
    cloneTimer=setInterval(()=>clonePollTick(name),2500);
    clonePollTick(name);
  } else toast('克隆失败：'+(r.data&&r.data.error||r.status),true);
}
// 进入文件页时：若后台仍有解压工作流在跑，恢复「正在运行」提示
async function resumeUnzipStatus(){
  if(unzipTimer) return;
  const d=await checkUnzipStatus();
  if(d&&d.running) startUnzipPoll();
}

// ---------- 写作页草稿自动保存（刷新后恢复，参考 cp.802213.xyz）----------
// 仅「发布新文章」页（/admin/write）自动保存；编辑已有文章不覆盖草稿。
const DRAFT_KEY='wk_draft_v1';
function loadDraft(){
  try{
    const raw=localStorage.getItem(DRAFT_KEY);
    if(!raw) return null;
    const d=JSON.parse(raw);
    return d&&typeof d==='object'?d:null;
  }catch(e){ return null; }
}
function saveDraft(){
  if(activePage!=='write'||editingPath) return;
  const d={
    title:$('#title').value,
    date:$('#date').value,
    tags:$('#tags').value,
    categories:$('#categories').value,
    content:editor?editor.getValue():'',
    ts:Date.now()
  };
  try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); }catch(e){}
}
function clearDraft(){
  try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}
}
function restoreDraft(){
  const d=loadDraft();
  if(!d) return;
  $('#title').value=d.title||'';
  $('#date').value=(d.date||new Date().toISOString().slice(0,10)).slice(0,10);
  $('#tags').value=d.tags||'';
  $('#categories').value=d.categories||'';
  if(d.content){ pendingEditorValue=d.content; $('#editorTitle').textContent='发布新文章（已恢复草稿）'; }
  toast('已恢复上次未发布的草稿');
}

// ---------- init ----------
function redirectLogin(){ location.replace('/admin/login'); }
document.addEventListener('DOMContentLoaded', ()=>{
  token = getToken();
  if(!token){ redirectLogin(); return; }
  // 记录 URL 中的会话 id（/admin/ai/<id>），供进入 AI 页时自动打开
  try{
    const m = location.pathname.match(/\\/admin\\/ai\\/([^\\/]+)\\/?$/);
    if(m) aiPendingConv = decodeURIComponent(m[1]);
  }catch(e){}
  // 校验 token，无效跳登录页
  fetch('/waline/api/token',{headers:{Authorization:'Bearer '+token}})
    .then(r=>r.json()).then(d=>{
      if(d.errno!==0||!d.data||d.data.type!=='administrator'){ redirectLogin(); return; }
      $('#userName').textContent=d.data.display_name||'管理员';
      if(window.__INITIAL__==='write'){
        enterWritePage();
      } else {
        switchTab(window.__INITIAL__||'manage');
      }
      // 全局：任意标签页都能看到「正在运行的部署工作流」与失败入口
      // 先确认 AI 是否已配置，再渲染横幅（决定失败横幅里是否给「发给 AI」按钮）
      checkAiConfigured().finally(()=>initBuildStatus());
    }).catch(()=>redirectLogin());

  $('#logoutBtn').onclick=()=>{
    document.cookie='wl_token=;path=/;max-age=0';
    try{ localStorage.removeItem('TOKEN'); }catch(e){}
    location.replace('/admin/login');
  };
  // AI 助手：Enter 发送，Shift+Enter 换行
  const aiInputEl = $('#aiInput');
  if(aiInputEl){
    aiInputEl.addEventListener('keydown', e=>{
      if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); aiSend(); }
    });
    // 输入框随内容自动增高（上限后内部滚动），因为是底部对齐，视觉上向上拉升
    aiInputEl.addEventListener('input', aiAutoGrow);
    aiAutoGrow();
  }
  // 手机端：尺寸变化 / 旋转 / 软键盘弹出时重新计算聊天区高度，保证输入框始终贴屏幕底边
  const aiFitSoon = ()=>{ if(window.innerWidth<=640) aiFitHeight(); };
  window.addEventListener('resize', aiFitSoon);
  window.addEventListener('orientationchange', ()=>setTimeout(aiFitSoon,120));
  if(window.visualViewport) window.visualViewport.addEventListener('resize', aiFitSoon);
  if(window.__INITIAL__==='ai') setTimeout(aiFitSoon, 350);
  // 新建文章：重置表单后 SPA 进入写作页（不刷新）
  $('#newBtn').onclick=()=>{
    editingPath='';
    ['title','date','tags','categories'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    $('#date').value=new Date().toISOString().slice(0,10);
    $('#editorTitle').textContent='发布新文章';
    $('#saveBtn').textContent='发布文章';
    pendingEditorValue='';
    try{ if(editor) editor.setValue(''); }catch(e){}
    go('write');
  };
  $('#saveBtn').onclick=savePost;
  // 写作页表单：输入即自动保存草稿；关闭/刷新前兜底保存
  ['title','date','tags','categories'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.addEventListener('input',saveDraft);
  });
  window.addEventListener('beforeunload', saveDraft);
  $('#postList').addEventListener('click',onListClick);
  // 管理文章：多选 / 批量删除 / 批量上传
  $('#postList').addEventListener('change',e=>{
    const c=e.target;
    if(!c||!c.classList||!c.classList.contains('postCheck')) return;
    const p=c.dataset.path;
    if(c.checked) selectedPosts.add(p); else selectedPosts.delete(p);
    updateBatchBar();
  });
  $('#pickAll').onchange=e=>{
    const on=e.target.checked;
    $$('#postList .postCheck').forEach(c=>{
      c.checked=on;
      const p=c.dataset.path;
      if(on) selectedPosts.add(p); else selectedPosts.delete(p);
    });
    updateBatchBar();
  };
  $('#batchDelBtn').onclick=deleteSelectedPosts;
  $('#batchUpBtn').onclick=()=>$('#batchUpInput').click();
  $('#batchUpInput').onchange=e=>{ batchUploadPosts(Array.from(e.target.files||[])); e.target.value=''; };
  $('#commentList').addEventListener('click',onCommentAction);
  $$('#commentFilter .wk-btn').forEach(b=>b.onclick=()=>setCommentFilter(b.dataset.f));
  $('#fileList').addEventListener('click',onFileClick);
  $('#fileList').addEventListener('click',onFileListClick);
  $('#fileEditSave').onclick=saveFileEdit;
  $('#fileEditBack').onclick=()=>$('#fileEditor').classList.add('hidden');
  $('#upBtn').onclick=()=>$('#upInput').click();
  $('#upInput').onchange=e=>{ doUpload(Array.from(e.target.files||[])); e.target.value=''; };
  $('#upDirBtn').onclick=upLevel;
  $('#dlUrlBtn').onclick=downloadFromUrl;
  $('#cloneRepoBtn').onclick=cloneRepoFromUrl;
  const lm=$('#logModal'); if(lm) lm.addEventListener('click',e=>{ if(e.target===lm) closeLogModal(); });
  $('#branchSel').onchange=e=>{ fileBranch=e.target.value||'main'; filePath=''; loadFiles(); };
  $('#newFolderBtn').onclick=newFolder;
  // 文件管理：多选 / 回收站
  $('#recycleBtn').onclick=()=>{ filePath=isRecycleView()?'':RECYCLE_DIR; loadFiles(); };
  $('#fileList').addEventListener('change',e=>{
    const c=e.target;
    if(!c||!c.classList||!c.classList.contains('filePick')) return;
    const p=c.dataset.path;
    if(c.checked) selectedFiles.add(p); else selectedFiles.delete(p);
    updateFileBatchBar();
  });
  $('#filePickAll').onchange=e=>{
    const on=e.target.checked;
    $$('#fileList .filePick').forEach(c=>{
      c.checked=on;
      const p=c.dataset.path;
      if(on) selectedFiles.add(p); else selectedFiles.delete(p);
    });
    updateFileBatchBar();
  };
  $('#fileBatchRecycle').onclick=()=>fileBatchOp('recycle');
  $('#fileBatchRestore').onclick=()=>fileBatchOp('restore');
  $('#fileBatchPurge').onclick=()=>fileBatchOp('purge');
  loadBranches(true);
  $$('.wk-tab').forEach(t=>t.onclick=()=>switchTab(t.dataset.tab));
});
`;

export function renderAdminPage(siteUrl: string, ghRepo?: string, initial = "manage"): string {
  const repo = String(ghRepo || "");
  const INITIAL = ["manage","comments","files","build","visit","subscribe","ai","settings","write"].includes(initial)
    ? initial
    : "manage";
  // 服务端就直接渲染出正确的初始页面，避免先闪一下「管理文章」再切过去
  const pageCls = (name: string) => "wk-page" + (INITIAL === name ? "" : " hidden");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>博客管理后台</title>
<link rel="stylesheet" href="${VDIRTOR_CSS}">
<style>${STYLE}</style>
</head>
<body>
<nav class="wk-nav">
  <div class="inner">
    <div class="brand">
      <span>博客后台</span>
    </div>
    <div class="spacer"></div>
    ${siteUrl ? '<a class="site" href="' + siteUrl + '" target="_blank">查看站点</a>' : ''}
    <span class="user" id="userName"></span>
    <button class="logout" id="logoutBtn">退出</button>
  </div>
</nav>

<div class="wk-tabs">
  <button class="wk-tab ${INITIAL === "manage" ? "active" : ""}" data-tab="manage">管理文章</button>
  <button class="wk-tab ${INITIAL === "comments" ? "active" : ""}" data-tab="comments">评论管理</button>
  <button class="wk-tab ${INITIAL === "files" ? "active" : ""}" data-tab="files">文件管理</button>
  <button class="wk-tab ${INITIAL === "build" ? "active" : ""}" data-tab="build">部署记录</button>
  <button class="wk-tab ${INITIAL === "visit" ? "active" : ""}" data-tab="visit">访问量</button>
  <button class="wk-tab ${INITIAL === "subscribe" ? "active" : ""}" data-tab="subscribe">订阅管理</button>
  <button class="wk-tab ${INITIAL === "ai" ? "active" : ""}" data-tab="ai">AI 助手</button>
  <button class="wk-tab ${INITIAL === "settings" ? "active" : ""}" data-tab="settings">设置</button>
</div>

<div class="wk-wrap">

  <!-- 全局工作流横幅：任意标签页都能看到「正在运行 / 失败」 -->
  <div id="globalBuildBanner" class="build-banner hidden" style="margin:0 0 12px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>

  <!-- 管理文章（默认首页） -->
  <div id="page-manage" class="${pageCls("manage")}">
    <div id="buildBanner" class="build-banner hidden" style="margin-bottom:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>
    <div class="wk-card">
      <div class="toolbar" style="justify-content:space-between;align-items:center">
        <h3 class="wk-title" style="margin:0;border:none;padding:0">已有文章</h3>
        <div style="display:flex;gap:6px">
          <button class="wk-btn ghost sm" id="batchUpBtn">批量上传</button>
          <button class="wk-btn sm" id="newBtn">＋ 添加新文章</button>
        </div>
      </div>
      <div class="filters hidden" id="batchBar" style="margin:10px 0 0">
        <label class="wk-label" style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer">
          <input type="checkbox" id="pickAll" style="width:auto"> 全选
        </label>
        <span class="wk-label" style="margin:0">已选 <b id="pickCount">0</b> 篇</span>
        <button class="wk-btn danger sm" id="batchDelBtn" disabled>删除所选</button>
      </div>
      <ul class="wk-list" id="postList"><li class="empty">加载中...</li></ul>
      <input type="file" id="batchUpInput" accept=".md,.markdown,.txt" multiple class="hidden">
    </div>
  </div>

  <!-- 写作页 -->
  <div id="page-write" class="${pageCls("write")}">
    <div class="wk-card">
      <div class="toolbar" style="justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <button class="wk-btn ghost sm" onclick="go('manage')">← 返回管理文章</button>
          <h3 class="wk-title" style="margin:0;border:none;padding:0" id="editorTitle">发布新文章</h3>
        </div>
        <button class="wk-btn" id="saveBtn">发布文章</button>
      </div>
      <label class="wk-label">标题</label>
      <input class="wk-input" id="title" placeholder="文章标题">
      <div class="wk-row">
        <div class="wk-field"><label class="wk-label">日期</label><input class="wk-input" type="date" id="date"></div>
        <div class="wk-field"><label class="wk-label">分类</label><input class="wk-input" id="categories" list="catList" placeholder="可输入或从历史下拉选择，多个用逗号分开"></div>
        <div class="wk-field"><label class="wk-label">标签</label><input class="wk-input" id="tags" list="tagList" placeholder="可输入或从历史下拉选择，多个用逗号分开"></div>
      </div>
      <datalist id="catList"></datalist>
      <datalist id="tagList"></datalist>
      <label class="wk-label">正文（Markdown，分屏预览）</label>
      <div id="edt"></div>
      <div class="msg" id="msg" style="margin-top:8px"></div>
    </div>
  </div>

  <!-- 评论管理 -->
  <div id="page-comments" class="${pageCls("comments")}">
    <div class="wk-card">
      <div class="toolbar" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <h3 class="wk-title" style="margin:0;border:none;padding:0">评论管理</h3>
        <div id="commentFilter" class="filters">
          <button class="wk-btn act sm" data-f="all">全部</button>
          <button class="wk-btn ghost sm" data-f="waiting">待审批</button>
          <button class="wk-btn ghost sm" data-f="approved">已通过</button>
          <button class="wk-btn ghost sm" data-f="spam">垃圾</button>
        </div>
      </div>
      <div id="commentList"><div class="empty">切换到此页加载评论</div></div>
    </div>
  </div>

  <!-- 文件管理 -->
  <div id="page-files" class="${pageCls("files")}">
    <div class="wk-card">
      <div class="toolbar" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <div style="display:flex;align-items:center;gap:10px">
          <h3 class="wk-title" style="margin:0;border:none;padding:0">文件管理</h3>
          <select class="wk-input" id="branchSel" style="width:auto;min-width:120px;padding:4px 8px" title="切换分支">
            <option value="">加载分支...</option>
          </select>
        </div>
        <div class="filters" id="fileOps">
          <button class="wk-btn ghost sm" id="upDirBtn" title="返回上一级">← 上一级</button>
          <button class="wk-btn sm" id="upBtn">上传</button>
          <button class="wk-btn ghost sm" id="dlUrlBtn" title="从网络下载文件保存到当前目录">从网络下载</button>
          <button class="wk-btn ghost sm" id="cloneRepoBtn" title="把外部 Git 仓库克隆到当前目录（如克隆一个 Hexo 主题）">克隆仓库</button>
          <button class="wk-btn ghost sm" id="newFolderBtn">新建文件夹</button>
          <button class="wk-btn ghost sm" id="recycleBtn">回收站</button>
        </div>
        <input type="file" id="upInput" multiple style="display:none">
      </div>
      <div class="breadcrumb" id="fileCrumb" style="font-size:12px;color:var(--muted);padding:8px 6px 4px;word-break:break-all"></div>
      <div id="unzipStatus" class="hidden" style="margin:0 0 8px;padding:8px 10px;border-radius:6px;font-size:13px;background:var(--input-bg);color:var(--fg);display:flex;align-items:center;gap:8px"></div>
      <div class="filters hidden" id="fileBatchBar" style="margin:0 0 8px">
        <label class="wk-label" style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer">
          <input type="checkbox" id="filePickAll" style="width:auto"> 全选
        </label>
        <span class="wk-label" style="margin:0">已选 <b id="filePickCount">0</b> 项</span>
        <button class="wk-btn danger sm" id="fileBatchRecycle">移入回收站</button>
        <button class="wk-btn sm hidden" id="fileBatchRestore">恢复</button>
        <button class="wk-btn danger sm hidden" id="fileBatchPurge">彻底删除</button>
      </div>
      <ul class="wk-list" id="fileList"><li class="empty">加载中...</li></ul>
    </div>
    <!-- 全屏文本编辑器 -->
    <div id="fileEditor" class="hidden" style="position:fixed;inset:0;background:var(--bg);z-index:100;display:flex;flex-direction:column">
      <div class="wk-nav" style="position:static;height:46px">
        <div class="inner">
          <button class="logout" id="fileEditBack" style="color:var(--nav-fg);border:1px solid var(--border);background:transparent;padding:3px 10px;border-radius:3px;cursor:pointer">← 返回</button>
          <span class="brand" style="font-size:12px;color:var(--nav-fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="fileEditPath"></span>
          <div class="spacer"></div>
          <button class="logout" id="fileEditSave" style="color:#fff;background:var(--accent);border:none;padding:4px 14px;border-radius:3px;cursor:pointer">保存</button>
        </div>
      </div>
      <textarea id="fileEditArea" style="flex:1;width:100%;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border:none;border-radius:0;padding:14px;background:var(--input-bg);color:var(--fg);outline:none;resize:none"></textarea>
    </div>
  </div>

  <!-- 部署记录 -->
  <div id="page-build" class="${pageCls("build")}">
    <div id="buildBannerBuild" class="build-banner hidden" style="margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>
    <div class="wk-card">
      <div class="toolbar" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <h3 class="wk-title" style="margin:0;border:none;padding:0">部署记录</h3>
        <button class="wk-btn act sm" onclick="triggerBuild()">▶ 手动运行工作流</button>
      </div>
      <p class="wk-label" style="margin-top:0">改完文件后点「运行工作流」即可手动触发部署，无需推送代码。点击「查看日志」可跳转 GitHub Actions 查看完整构建日志。</p>
      <div class="table-scroll"><div id="buildHistory" class="empty">加载中...</div></div>
    </div>
  </div>

  <!-- 访问量（仅管理员可见） -->
  <div id="page-visit" class="${pageCls("visit")}">
    <div class="stats-scroll"><div class="stats">
      <div class="stat-card"><div class="num" id="statToday">-</div><div class="lbl">今日访问数</div></div>
      <div class="stat-card"><div class="num" id="statTotal">-</div><div class="lbl">总访问量</div></div>
    </div></div>

    <div class="wk-card">
      <h3 class="wk-title">访问趋势（最近 <span id="visitDaysLabel">30</span> 天）</h3>
      <div class="filters" style="margin:0 0 10px">
        <button class="wk-btn ghost sm" onclick="setVisitDays(7)">7 天</button>
        <button class="wk-btn ghost sm" onclick="setVisitDays(30)">30 天</button>
        <button class="wk-btn ghost sm" onclick="setVisitDays(90)">90 天</button>
        <button class="wk-btn ghost sm" onclick="setVisitDays(365)">365 天</button>
        <input class="wk-input" id="visitDays" type="number" min="1" max="3650" value="30" style="width:88px" placeholder="自定义">
        <button class="wk-btn sm" onclick="applyVisitDays()">应用</button>
      </div>
      <div id="visitChart"><div class="empty">加载中...</div></div>
      <p class="wk-label" style="margin:8px 0 0">图中区间合计：<b id="visitRangeSum">-</b></p>
    </div>
  </div>

  <!-- 订阅管理（订阅者 + 群发；订阅设置(邮件模板)、SMTP 均在「设置」页） -->
  <div id="page-subscribe" class="${pageCls("subscribe")}">
    <div class="wk-card">
      <h3 class="wk-title">订阅者</h3>
      <div class="stats-scroll"><div class="stats">
        <div class="stat-card"><div class="num" id="subTotal">-</div><div class="lbl">总数</div></div>
        <div class="stat-card"><div class="num" id="subConfirmed">-</div><div class="lbl">已确认</div></div>
        <div class="stat-card"><div class="num" id="subPending">-</div><div class="lbl">待确认</div></div>
        <div class="stat-card"><div class="num" id="subUnsub">-</div><div class="lbl">已退订</div></div>
      </div></div>
      <div class="filters" style="margin:10px 0">
        <select class="wk-input" id="subStatus" style="width:130px" onchange="loadSubscribers()">
          <option value="">全部状态</option>
          <option value="confirmed">已确认</option>
          <option value="pending">待确认</option>
          <option value="unsubscribed">已退订</option>
        </select>
        <input class="wk-input" id="subQ" style="width:200px" placeholder="按邮箱搜索">
        <button class="wk-btn ghost sm" onclick="loadSubscribers()">刷新</button>
      </div>
      <div id="subList"><div class="empty">加载中...</div></div>
    </div>

    <div class="wk-card">
      <h3 class="wk-title">订阅限制（防刷）</h3>
      <p class="wk-label" style="margin-top:0">按东八区计日，当天新订阅达到上限后，其他人将无法再提交订阅。</p>
      <div class="filters" style="margin:0 0 10px;align-items:center">
        <span class="wk-label" style="margin:0">当日最多订阅量</span>
        <input class="wk-input" id="subDailyLimit" type="number" min="1" max="1000000" style="width:130px" placeholder="100">
        <span class="wk-label" style="margin:0">今日已订阅 <b id="subToday">-</b> 人</span>
        <button class="wk-btn sm" onclick="saveSubLimit()">保存</button>
      </div>
      <div class="msg" id="subLimitMsg"></div>
    </div>

    <div class="wk-card">
      <h3 class="wk-title">群发邮件</h3>
      <label class="wk-label">主题</label>
      <input class="wk-input" id="bcSubject">
      <label class="wk-label">正文（HTML，支持 {{site}} {{email}} {{unsubscribe}}）</label>
      <textarea class="wk-input" id="bcBody" rows="6"></textarea>
      <div class="filters" style="margin:14px 0 0">
        <button class="wk-btn sm" onclick="broadcastSubscribe()">发送给全部已确认订阅者</button>
        <span class="wk-label" style="margin:0;align-self:center">单次上限 100 封</span>
      </div>
    </div>
  </div>

  <!-- AI 助手（聊天：流式输出 + 历史记录） -->
  <div id="page-ai" class="${pageCls("ai")}">
    <div class="wk-card ai-chat">
      <div class="ai-side">
        <div class="ai-side-head">
          <button class="wk-btn ghost sm" onclick="aiToggleSide()" title="收起侧边栏">‹</button>
          <span class="wk-label" style="margin:0">会话</span>
          <div style="flex:1"></div>
          <button class="wk-btn ghost sm" onclick="loadAiConversations()" title="刷新">刷新</button>
        </div>
        <button class="wk-btn sm" style="width:100%;margin-top:6px" onclick="aiNewChat()">＋ 新建对话</button>
        <div class="ai-side-title">历史对话</div>
        <div id="aiConvList" class="ai-conv-list"><div class="empty">加载中...</div></div>
      </div>
      <div class="ai-main">
        <div class="ai-bar">
          <button class="wk-btn ghost sm" id="aiSideToggle" onclick="aiToggleSide()" title="展开侧边栏" style="display:none">› 会话</button>
          <span class="ai-chat-title" id="aiChatTitle" title="双击可重命名" ondblclick="aiRenameConv()">新对话</span>
          <span class="wk-label" id="aiChatHint" style="margin:0"></span>
          <div class="ai-bar-acts">
            <button class="wk-btn ghost sm ai-icon-btn" onclick="aiRenameConv()" title="编辑 / 重命名对话" aria-label="重命名对话">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
            </button>
            <button class="wk-btn ghost sm" id="aiFullBtn" onclick="aiToggleFull()" title="全屏 / 退出全屏">全屏</button>
          </div>
        </div>
        <div id="aiMessages" class="ai-scroll"><div class="ai-col" id="aiCol"><div class="empty">开始和 AI 对话吧</div></div></div>
        <div class="msg" id="aiChatMsg" style="margin:0 14px"></div>
        <div class="ai-foot">
          <span class="wk-label" style="margin:0">模型</span>
          <select class="wk-input" id="aiChatModel" onchange="aiSetChatModel(this.value)" style="width:auto;flex:1 1 140px;min-width:80px;max-width:320px;padding:4px 8px"></select>
          <span class="wk-label" style="margin:0">权限</span>
          <select class="wk-input" id="aiChatPermission" onchange="aiSetPermission(this.value)" title="权限：安全模式=仅对话；重要确认=危险操作确认；全部确认=每步确认；完全允许=无需确认" style="width:auto;flex:0 0 auto;min-width:0;padding:4px 8px">
            <option value="safe" title="安全模式 · 仅对话，不执行任何操作">安全模式</option>
            <option value="important" title="重要确认 · 危险操作需确认">重要确认</option>
            <option value="all" title="全部确认 · 每次工具调用都需确认">全部确认</option>
            <option value="full" title="完全允许 · 无需确认，直接执行">完全允许</option>
          </select>
          <span class="wk-label" style="margin:0">思考强度</span>
          <select class="wk-input" id="aiChatThink" onchange="aiSetThink(this.value)" title="思考强度会作为 reasoning_effort 发给服务商；需所选模型支持推理（如 deepseek-reasoner），不支持时会报错" style="width:auto;flex:0 0 auto;min-width:0;padding:4px 8px">
            <option value="off">关闭</option>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
          <button class="wk-btn ghost sm ai-icon-btn" id="aiUsageBtn" onclick="aiToggleUsage(event)" title="查看已用 token / 缓存命中" aria-label="查看 token 用量">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          </button>
        </div>
        <div class="ai-input">
          <textarea class="wk-input" id="aiInput" rows="3" placeholder="输入文字"></textarea>
          <button class="wk-btn sm" id="aiSendBtn" onclick="aiSend()">发送</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 设置（各分区可展开/收起：SMTP、站点功能、订阅设置、API 说明） -->
  <div id="page-settings" class="${pageCls("settings")}">
    <details class="wk-collapse">
      <summary>SMTP 邮件服务器</summary>
      <div class="wk-collapse-body">
        <p class="wk-label" style="margin-top:0">用于发送订阅确认与群发邮件。<b>Workers 仅支持 465 端口（隐式 TLS）</b>；QQ/163 等邮箱请填写「授权码」而非登录密码。</p>
        <div class="wk-row">
          <div style="flex:2">
            <label class="wk-label">SMTP 服务器</label>
            <input class="wk-input" id="smHost" placeholder="smtp.qq.com">
          </div>
          <div style="flex:1">
            <label class="wk-label">端口</label>
            <input class="wk-input" id="smPort" type="number" value="465" placeholder="465">
          </div>
        </div>
        <div class="wk-row">
          <div style="flex:1">
            <label class="wk-label">用户名</label>
            <input class="wk-input" id="smUser" placeholder="you@qq.com">
          </div>
          <div style="flex:1">
            <label class="wk-label">密码 / 授权码</label>
            <input class="wk-input" id="smPass" type="password" placeholder="留空表示不修改">
          </div>
        </div>
        <div class="wk-row">
          <div style="flex:1">
            <label class="wk-label">发件人名称</label>
            <input class="wk-input" id="smFromName" placeholder="我的博客">
          </div>
          <div style="flex:1">
            <label class="wk-label">发件人邮箱（默认同用户名）</label>
            <input class="wk-input" id="smFromEmail" placeholder="you@qq.com">
          </div>
        </div>
        <div class="filters" style="margin:14px 0 0">
          <button class="wk-btn sm" onclick="saveSubscribeSettings()">保存 SMTP 配置</button>
          <input class="wk-input" id="smTestTo" style="width:220px" placeholder="测试收件邮箱">
          <button class="wk-btn ghost sm" onclick="sendSubscribeTest()">发送测试邮件</button>
        </div>
      </div>
    </details>

    <details class="wk-collapse">
      <summary>站点功能</summary>
      <div class="wk-collapse-body">
        <p class="wk-label" style="margin-top:0">默认保留 365 天访问数据，可设置更长或更短；超期数据会自动清理。</p>
        <div class="filters" style="margin:0 0 12px">
          <span class="wk-label" style="margin:0">访问量数据保留</span>
          <input class="wk-input" id="retentionDays" type="number" min="1" max="3650" style="width:110px" placeholder="365">
          <span class="wk-label" style="margin:0">天</span>
        </div>
        <label class="wk-label" style="display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer">
          <input type="checkbox" id="allowGuestComment" style="width:auto"> 允许访客评论（关闭后仅登录用户可评论）
        </label>
        <div class="filters" style="margin:14px 0 0">
          <button class="wk-btn sm" onclick="saveSiteSettings()">保存设置</button>
        </div>
        <div class="msg" id="siteMsg"></div>
      </div>
    </details>

    <details class="wk-collapse">
      <summary>订阅设置（邮件模板）</summary>
      <div class="wk-collapse-body">
        <div class="wk-row">
          <div style="flex:1">
            <label class="wk-label">站点名称</label>
            <input class="wk-input" id="smSiteName" placeholder="我的博客">
          </div>
          <div style="flex:1">
            <label class="wk-label">站点地址</label>
            <input class="wk-input" id="smSiteUrl" placeholder="https://blog.example.com">
          </div>
        </div>
        <label class="wk-label">确认邮件主题</label>
        <input class="wk-input" id="smSubject">
        <label class="wk-label">确认邮件正文（HTML，支持 {{site}} {{email}} {{link}} {{unsubscribe}}）</label>
        <textarea class="wk-input" id="smBody" rows="6"></textarea>
        <label class="wk-label" style="margin-top:14px">新文章通知主题（发布新文章并构建完成后自动发送）</label>
        <input class="wk-input" id="smNotifySubject">
        <label class="wk-label">新文章通知正文（HTML，支持 {{site}} {{title}} {{url}} {{unsubscribe}}）</label>
        <textarea class="wk-input" id="smNotifyBody" rows="6"></textarea>
        <label class="wk-label" style="margin-top:14px">退订成功提示主题（用户主动点邮件里的退订链接后发送）</label>
        <input class="wk-input" id="smUnsubSubject">
        <label class="wk-label">退订成功提示正文（HTML，支持 {{site}} {{email}}）</label>
        <textarea class="wk-input" id="smUnsubBody" rows="4"></textarea>
        <p class="wk-label" style="margin:6px 0 0;line-height:1.7">所有通知/群发邮件都会自动带上「取消订阅」按钮；只有订阅人自己点退订链接才会收到这封提示邮件，后台删除订阅者不会发送。</p>
        <label class="wk-label" style="display:flex;align-items:center;gap:6px;margin-top:10px;cursor:pointer">
          <input type="checkbox" id="smNeedConfirm" style="width:auto"> 需要邮件确认（关闭后提交即订阅成功）
        </label>
        <div class="filters" style="margin:12px 0 0;align-items:center">
          <span class="wk-label" style="margin:0">当日最多订阅量</span>
          <input class="wk-input" id="smDailyLimit" type="number" min="1" max="1000000" style="width:130px" placeholder="100">
          <span class="wk-label" style="margin:0">（按东八区计日，达到后当天不再接受新订阅，防刷）</span>
        </div>
        <div class="filters" style="margin:14px 0 0">
          <button class="wk-btn sm" onclick="saveSubscribeSettings()">保存配置</button>
        </div>
        <div class="msg" id="subMsg"></div>
      </div>
    </details>

    <details class="wk-collapse">
      <summary>AI 设置</summary>
      <div class="wk-collapse-body">
        <p class="wk-label" style="margin-top:0">配置一个 OpenAI 兼容的 AI 接口（Chat Completions 协议）。填入基础地址与密钥后，可直接测试连通性与获取模型列表。</p>
        <label class="wk-label">API 地址（基础地址，带或不带结尾的 /v1 均可）</label>
        <input class="wk-input" id="aiBaseUrl" placeholder="https://api.openai.com/v1">
        <label class="wk-label" style="margin-top:12px">API 密钥</label>
        <input class="wk-input" id="aiApiKey" type="password" placeholder="留空表示不修改">
        <label class="wk-label" style="margin-top:12px">已选的模型（多个用英文逗号分隔，可直接编辑，与下方「可选模型」联动）</label>
        <input class="wk-input" id="aiModelsText" placeholder="如：gpt-4o-mini, deepseek-chat" oninput="aiSyncModelsFromText()">
        <label class="wk-label" style="display:flex;align-items:center;gap:6px;margin-top:10px;cursor:pointer">
          <input type="checkbox" id="aiClientProxy" style="width:auto"> 前端代理：由浏览器直连服务商
        </label>
        <label class="wk-label" style="margin-top:14px">权限级别（AI 可执行的操作范围）</label>
        <select class="wk-input" id="aiPermission">
          <option value="safe">安全模式 · 仅对话，不执行任何操作</option>
          <option value="important">重要确认 · 危险操作需确认（写文件 / 删除 / 部署 / 改设置）</option>
          <option value="all">全部确认 · 每次工具调用都需确认</option>
          <option value="full">完全允许 · 无需确认，直接执行</option>
        </select>
        <div class="filters" style="margin:14px 0 0">
          <button class="wk-btn sm" onclick="saveAiSettings()">保存配置</button>
          <button class="wk-btn ghost sm" onclick="testAiSettings()">测试连通性</button>
          <button class="wk-btn ghost sm" onclick="loadAiModels()">获取模型列表</button>
        </div>
        <div class="msg" id="aiMsg"></div>
        <details class="wk-collapse" style="margin-top:12px;background:transparent;border:1px solid var(--border)">
          <summary>可选模型（勾选后可在 AI 助手中切换；测试连通性用第一个）</summary>
          <div class="wk-collapse-body" style="border-top:1px solid var(--border)">
            <input class="wk-input" id="aiModelSearch" placeholder="搜索模型，如 free / gpt / claude" oninput="renderAiModels()">
            <div class="filters" style="margin:8px 0 0">
              <span class="wk-label" style="margin:0" id="aiPickedCount"></span>
              <div style="flex:1"></div>
              <button class="wk-btn ghost sm" onclick="aiPickAll()">全选当前</button>
              <button class="wk-btn ghost sm" onclick="aiPickNone()">清空</button>
            </div>
            <div id="aiModelList" class="ai-model-list" style="margin-top:8px"></div>
          </div>
        </details>
        <details class="wk-collapse" style="margin-top:12px;background:transparent;border:1px solid var(--border)">
          <summary>系统提示词（AI 提示词）</summary>
          <div class="wk-collapse-body" style="border-top:1px solid var(--border)">
            <p class="wk-label" style="margin-top:0">直接作为系统提示词随每次对话发给模型（不写入历史记录）。可自行修改；改动会影响 AI 的工具调用与回答风格，<b>改动过大可能导致 AI 无法正常使用</b>。</p>
            <textarea class="wk-input" id="aiPrompt" rows="5" placeholder="例如：你是一个简洁的中文技术助手，回答尽量给要点。"></textarea>
            <div class="filters" style="margin:10px 0 0">
              <button class="wk-btn sm" onclick="aiSavePrompt()">保存提示词</button>
              <button class="wk-btn ghost sm" onclick="aiResetPrompt()">还原默认</button>
            </div>
          </div>
        </details>
        <details class="wk-collapse" style="margin-top:12px;background:transparent;border:1px solid var(--border)">
          <summary>AI 密钥（占位符，安全）</summary>
          <div class="wk-collapse-body" style="border-top:1px solid var(--border)">
            <p class="wk-label" style="margin-top:0">在此保存密钥（如第三方 API Key）。密钥值仅保存在服务端，<b>绝不会下发给 AI，也不会写进提示词</b>。AI 在写入文件或设置时使用占位符 <code>{名称}</code>，执行时会自动替换为真实值。<br>若 AI 需要凭据而你不便在对话里提供，它会发起<b>弹窗</b>让你在本地输入，输入内容直接写入服务端、<b>不会发送给 AI</b>。</p>
            <div class="wk-row">
              <div style="flex:1">
                <label class="wk-label">名称（用于占位符，如 MY_API）</label>
                <input class="wk-input" id="secName" placeholder="MY_API">
              </div>
              <div style="flex:2">
                <label class="wk-label">密钥值</label>
                <input class="wk-input" id="secValue" type="password" placeholder="粘贴密钥值">
              </div>
            </div>
            <div class="filters" style="margin:14px 0 0">
              <button class="wk-btn sm" onclick="saveSecret()">保存密钥</button>
              <button class="wk-btn ghost sm" onclick="loadSecrets()">刷新列表</button>
            </div>
            <div class="msg" id="secMsg"></div>
            <div id="secList" style="margin-top:10px"><div class="empty">加载中...</div></div>
          </div>
        </details>
      </div>
    </details>

    <details class="wk-collapse">
      <summary>API 说明</summary>
      <div class="wk-collapse-body">
        <div class="wk-api-h">访问量</div>
        <ul class="wk-list">
          <li>
            <div>
              <div class="name"><span class="chip">POST</span> /api/visit</div>
              <div class="meta">记录一次访问（前台调用）。同一访客同一天只计一次，刷新不重复。返回 {ok, counted, today, total}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /api/visit/stats</div>
              <div class="meta">查询访问量。返回 {ok, today, total}，today 按东八区计算</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /admin/api/visit/daily?days=30</div>
              <div class="meta">按天趋势（需管理员登录）。days 取值 1-3650，返回 {ok, days, sum, series:[{day,count}]}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /admin/api/visit/settings</div>
              <div class="meta">读取数据保留天数（需管理员登录）。返回 {ok, retention_days}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">PUT</span> /admin/api/visit/settings</div>
              <div class="meta">保存数据保留天数（需管理员登录）。请求体 {"retention_days": 365}，取值 1-3650</div>
            </div>
          </li>
        </ul>

        <div class="wk-api-h">订阅</div>
        <ul class="wk-list">
          <li>
            <div>
              <div class="name"><span class="chip">POST</span> /api/subscribe</div>
              <div class="meta">提交订阅（前台调用，允许跨域）。body {"email":"a@b.com"}；返回 {ok, needConfirm, message}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /api/subscribe/confirm?token=xxx</div>
              <div class="meta">确认订阅（邮件里的链接）。返回一个提示页面</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /api/subscribe/unsubscribe?token=xxx</div>
              <div class="meta">退订（邮件里的链接）。返回一个提示页面</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /api/subscribe/stats</div>
              <div class="meta">订阅数统计。返回 {ok, total, confirmed}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /admin/api/subscribe/settings</div>
              <div class="meta">读取 SMTP/订阅配置（需管理员登录）。返回配置，密码以 hasPass 表示</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">PUT</span> /admin/api/subscribe/settings</div>
              <div class="meta">保存配置（需管理员登录）。pass 留空表示不修改；dailyLimit 为当日最多订阅量（按东八区计日，默认 100）</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /admin/api/subscribe/list?status=&q=</div>
              <div class="meta">订阅者列表（需管理员登录）。返回 {ok, total, stats, list:[{id,email,status,createdAt}]}，stats.today 为今日新订阅数</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">POST</span> /admin/api/subscribe/approve</div>
              <div class="meta">手动通过订阅者（需管理员登录）。body {"id":1}，将「待确认」直接置为「已确认」</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">DELETE</span> /admin/api/subscribe/subscriber?id=1</div>
              <div class="meta">删除订阅者（需管理员登录，不会给该邮箱发退订提示）</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">POST</span> /admin/api/subscribe/test</div>
              <div class="meta">发送测试邮件（需管理员登录）。body {"to":"a@b.com"}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">POST</span> /admin/api/subscribe/send</div>
              <div class="meta">群发邮件（需管理员登录）。body {"subject":"","body":"&lt;html&gt;"}</div>
            </div>
          </li>
        </ul>

        <div class="wk-api-h">AI</div>
        <p class="wk-label" style="margin:0 0 8px;line-height:1.7">以下接口均需管理员登录。遵循 OpenAI 兼容约定，地址会自动拼接 {baseUrl}/v1/...（已带 /v1 则不重复）。</p>
        <ul class="wk-list">
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /admin/api/ai/settings</div>
              <div class="meta">读取 AI 配置。返回 {ok, baseUrl, model, enabled, hasKey}，密钥不回传</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">PUT</span> /admin/api/ai/settings</div>
              <div class="meta">保存 AI 配置。body {"baseUrl":"","apiKey":"","model":"","enabled":true}，apiKey 留空表示不修改</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">POST</span> /admin/api/ai/test</div>
              <div class="meta">测试连通性。向 {baseUrl}/chat/completions 发最小请求；body 可传 {"baseUrl","apiKey","model"} 覆盖。返回 {ok, elapsed, model, reply} 或 {ok:false, error}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /admin/api/ai/models</div>
              <div class="meta">获取全部可用模型。调用 {baseUrl}/models，返回 {ok, count, models:[id...]}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">POST</span> /admin/api/ai/chat</div>
              <div class="meta">聊天（流式）。body {"messages":[...],"model"?}，转发到 {baseUrl}/chat/completions 并原样回传 SSE（text/event-stream）</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /admin/api/ai/conversations</div>
              <div class="meta">历史会话列表。返回 {ok, list:[{id,title,createdAt,updatedAt}]}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">GET</span> /admin/api/ai/conversation?id=</div>
              <div class="meta">单个会话（含消息）。返回 {ok, conversation:{id,title,messages}}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">PUT</span> /admin/api/ai/conversation</div>
              <div class="meta">保存会话。body {"id"?,"title","messages"}，id 存在则更新，否则新建，返回 {ok, id}</div>
            </div>
          </li>
          <li>
            <div>
              <div class="name"><span class="chip">DELETE</span> /admin/api/ai/conversation?id=</div>
              <div class="meta">删除历史会话</div>
            </div>
          </li>
        </ul>
      </div>
    </details>
  </div>

</div>

<!-- 工作流日志弹窗（CF 代理获取，不跳转 GitHub） -->
<div id="logModal" class="hidden" style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px">
  <div class="wk-card" style="max-width:900px;width:100%;max-height:86vh;display:flex;flex-direction:column;margin:0">
    <div class="toolbar" style="justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap">
      <h3 class="wk-title" style="margin:0;border:none;padding:0">工作流日志<span id="logModalTitle" class="wk-label" style="margin-left:8px"></span></h3>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <a class="wk-btn ghost sm" id="logModalGh" target="_blank" rel="noopener">在 GitHub 打开 ↗</a>
        <button class="wk-btn ghost sm" onclick="closeLogModal()">关闭</button>
      </div>
    </div>
    <div id="logModalBody" style="flex:1;overflow:auto;white-space:pre-wrap;word-break:break-all;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--input-bg);color:var(--fg);border:1px solid var(--border);border-radius:3px;padding:10px;margin-top:10px">加载中...</div>
  </div>
</div>

<script src="${VDIRTOR_JS}"></script>
<script src="${MARKED_JS}"></script>
<script src="${DOMPURIFY_JS}"></script>
<script>var __INITIAL__='${INITIAL}';</script>
<script>${SCRIPT.replace(/__REPO__/g, repo)}</script>
</body>
</html>`;
}