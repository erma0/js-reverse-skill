# Case：HTTP/2 传输层约束 + 请求侧全明文（猿人学第17题）

> 难度：★
> 还原方案：A 纯算还原（无签名可还原）+ E 传输层对齐（HTTP/2 + 末页 UA）
> 实现语言：Node.js（原生 `node:http2`，无第三方依赖）
> 最后验证日期：2026-08-28
> 平台类型：match.yuanrenxue.cn（猿人学练习平台）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：页面无混淆、无 SDK、无 WASM、无 JSVMP；请求由内联 script block 12（IIFE，`window.jQuery`）直接 `$.ajax({url:"/api/question/17", data:{page,pageSize,kw,m}})` 发起
- 参数特征：`page`(1-5) / `pageSize`(固定 10) / `kw`(固定空串)，**全明文**；无签名、无 token、无时间戳、无随机量、无指纹参数
- **诱饵参数特征**：页面 `data` 对象里写了 `m:window.match17`，但 `window.match17` 由 `$.ajax` hook 在有人请求 `/api/match/17` 时才赋值——该接口从未被调用（25 个包全量核对），值恒为 `undefined`，被序列化/拷贝层直接丢弃。真实 writer 参数全文：`["GET","/api/question/17?page=1&pageSize=10&kw=",true,"undefined","undefined"]`。（match19 trace 修正机理：`$.param` 对 undefined 渲染空串 `m=` 并不丢弃，真正丢弃发生在 `$.ajax` 内部 `k.extend` 深拷贝的 `copy!==undefined` 守卫——详见反模式 27 机理精确版）
- 请求特征：`GET /api/question/17?page=N&pageSize=10&kw=`；Cookie 侧无签名（仅 `sessionid` + 百度统计 `Hm_*`）；**无 JS 写入的挑战 cookie**
- 传输层特征：必须以 HTTP/2 发起（题名「天杀的 Http2.0」）；第 5 页（末页）UA 必须改为 `yuanrenxue`，否则不返回该页数据
- 风控特征：数据**绑定 sessionid**（同 session 各页数值恒定，可反复复验）

## 加密方案

- 路径：A（纯算还原，本题无可还原算法）+ E（传输层对齐）
- 框架：Node.js 内置 `http2`，一次 `http2.connect()` 建 Session，5 次 `client.request()` 复用，最后 `client.close()`；零第三方依赖
- TLS 客户端：不需要（Node 原生 http2 直连，无 TLS 指纹校验）
- 核心思路：**请求侧没有任何待还原参数**，实现工作量全在传输层——协议必须是 h2、末页 UA 必须切换、cookie 带 sessionid
- 服务端校验语义：按 `sessionid` 返回该账号绑定的数据；末页按 UA 字符串放行

调用链：`内联 script block 12（var d={page,pageSize,kw,m}）→ $.ajax → jQuery $.param 丢弃 m → XMLHttpRequest.open("GET","/api/question/17?page=N&pageSize=10&kw=")`

## 踩坑记录

1. **坑：诱饵参数 `m`（参数名存在 ≠ 参数生效，本题唯一可能浪费大量时间的点）**。`document.html` 的 script block 12 明确写了 `m:window.match17`，script block 10 还有个 `$.ajax` hook 声明"请求 `/api/match/17` 时把 `data.m` 赋给 `window.match17`"——看上去 `m` 就是待还原签名。实际上 `/api/match/17` 从未被请求，值恒为 `undefined`，jQuery `$.param` 序列化时丢弃 undefined 值，URL 里根本没有 `m`。正确做法：**判定参数是否生效，一律以 trace writer 的参数全文或 capture.json 真实请求 URL 为准，不能以 document.html 里的字面量为准**；发现"签名参数恒为 undefined"时，先查它的赋值路径有没有被执行，而不是立刻去找算法。详见反模式 27。
2. **坑：`--targets` 不能用 `question/17`**。静态资源 `https://match.yuanrenxue.cn/static/new_match/question/17/webpack.js` 的路径里含 `question/17`，会先于目标接口命中，取证提前收尾、目标响应体丢失。正确做法：用带参数的子串锁定翻页请求，如 `--targets "page=1"` / `"page=2"`——无论接口是新版 `/api/question/N` 还是老版 `/api/match/N` 都能命中。详见反模式 22。
3. **坑：接口路径随站点版本变化**。老版 `/api/match/N`，新版 `/api/question/N`；本题 JS 内仍保留 `/api/match/17` 老常量。外部老题解只作假设，**接口路径以本次抓包为准**。
4. **坑：`capture_ruyitrace_log.js --import-after` 漏导入大日志**。本次自动导入只收进 823 B 的 `trace_process_28516.ndjson`，而真正含页面 JS 的三个 tab 进程日志（1.8 MB / 2.5 MB / 1.2 MB）在浏览器被 kill 后 10~33 秒才刷盘，此时导入早已结束。正确做法：导入后核对 `case/ruyi-trace/logs/domtrace/` 各文件体积，与摘要里的"合并文件数/行数"比对，明显偏小就用 `import_ruyitrace_log.js --input <file>` 手动合并导入。
5. **坑：trace 里的 XHR 记录会被第三方 SDK 淹没**。本次 trace 高频调用栈前两名是 `transcend-cdn.com/airgap.js`（6066 次）与 `mozilla.org` 站点脚本，目标域 `jquery.js` 只有 2020 次。正确做法：直接检索目标接口 URL 字面量（`/api/question/17`）定位 writer，不要从 `XMLHttpRequest` 事件列表逐条翻。
6. **坑：提交必须表单编码**。`document.html` script block 11 是 `$.ajax({url:'/a/17', method:'POST', data:{answer:...}})`，jQuery 默认 `contentType: application/x-www-form-urlencoded`，**用 JSON 会被拒**。返回码语义：`code === 2` 通关；`1` 已做过；其他为答案错误。

## 可验证事实清单（经验资产）

1. 固定 sessionid `p4av26i0hl3t4dar70r5icog4vytlguo` 下 5 页加和稳定 **25585231**（2026-08-28 实测）；各页小计 3,999,783 + 4,317,740 + 6,280,131 + 5,662,478 + 5,325,099
2. 4 轮 20 次真实请求全部 HTTP 200、协议 `h2`、`data` 各 10 条；page1 / page2 数据与浏览器取证样本**逐元素一致**——适合做离线回归基线
3. 请求侧字段分组无任何加密值 / 随机值 / 时间值 / 服务端下发值 / 会话绑定值；`crypto` 相关 trace 仅 2 条且来自第三方 SDK，页面自身零密码学调用
4. Cookie 侧无 JS 写入的挑战 cookie（仅百度统计 `Hm_lvt_*` / `Hm_lpvt_*` / `Hm_ck_*` / `HMACCOUNT`）；`sessionid` 为用户提供的静态登录凭据，非 JS 生成
5. writer 定位：`XMLHttpRequest.open` @ `https://match.yuanrenxue.cn/static/new_match/jquery/jquery.js:2391:23`（func `send`），证据行 `case/ruyi-trace/logs/domtrace/trace_process_31888.ndjson:781`
6. 提交 `POST /a/17` 表单编码（`answer` 字段）实测通关：`{"result":"success","created":true,"code":2,"exp":70}`；提交过频会封号，只提交一次
7. 末页 UA 校验不看状态码：UA 不对时可能仍是 HTTP 200 但 `data` 非数值数组，必须对每页做 `data` 元素类型校验（同 match14/15/16）
8. Node 原生 `http2` 交付要点：一次 `http2.connect()` 复用全部请求 + 显式 `client.close()`（交付门禁 Session 三件套）；**不要发 `accept-encoding`**，避免 br/zstd 需额外解压，同时保留 zlib 解压兜底；`client.alpnProtocol === 'h2'` 可作协议自检断言

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/common-pitfalls.md` | 反模式 27（诱饵参数：参数名存在 ≠ 参数生效）本 case 实证；反模式 22（终态过滤宽正则/静态资源路径误命中）本 case 二次实证 |
| `references/workflow/experience-rules.md` | 规则 27（请求侧无签名的三条判据 + 传输层题型 Node http2 实现要点）本 case 实证 |
| `references/network/protocol-analysis.md` | HTTP/2 请求实现骨架与 TLS 指纹边界说明 |
| `references/workflow/decision-tree.md` | 题型判定 + 路径决策（请求侧全明文 → 路径 A + E，不做补环境） |
| `cases/yuanrenxue-match-index.md` | match 系列速查（sessionid 数据绑定、末页 UA 红线、接口版本变化） |
| `cases/yuanrenxue-match16-webpack-blackbox-branch.md` | 同源站点对照：同为 `/api/question/N` 新版路径、末页 UA 红线、数据绑定 sessionid |
| `cases/yuanrenxue-match7-dynamic-font.md` | 同源诱饵参数对照：`m` 是 `/api/match/7`（404）hook 遗留，真实请求无 m |
| `cases/yuanrenxue-match13-eval-cookie.md` | 同源诱饵参数对照：`m:window.match13` 是 hook 遗留，真实请求无 m |
