# Case：WASM wasm-bindgen 签名 + 服务器时间 + Node 沙箱 import 桩语义对齐（猿人学第20题）

> 难度：★★
> 还原方案：C WASM 加载（Node 原生 WebAssembly）+ B 最小 JS 沙箱（glue 原样还原）
> 实现语言：Node.js
> 最后验证日期：2026-08-29
> 平台类型：match.yuanrenxue.cn（猿人学练习平台）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：webpack 三 chunk（index.js 16KB 入口 / 0.index.js 639KB vendor / 1.index.js 15.9KB = `pkg/index_bg.js` glue）+ **`/api2/20` 返回 `application/wasm`**（Rust wasm-bindgen 产物，~188KB，funcCount=791，imports 13 / exports 8，**导出名为 `sign`**）
- wasm-bindgen 实锤特征：RuyiTrace trace_wasm 日志 importsSample 全为 `./index_bg.js` 模块的 `__wbg_*`/`__wbindgen_*` 函数（`__wbg_instanceof_Window_434ce1849eb4e0fc` / `__wbindgen_add_to_stack_pointer` / `__wbindgen_malloc` 等）；domtrace 调用栈出现 `webpack:///./pkg/index_bg.js` 的 `passStringToWasm0` / `getStringFromWasm0` / `sign`
- 签名公式（入口 index.js eval 内 `req()` 明文）：`sign = m.sign(p + '|' + t.toString())`，`t` = 每次数据请求前同步 `xhr.open("GET","/api/getTime",false)` 取回的服务器毫秒时间**纯文本**（responseText 原样使用不 trim）；请求 `GET /api/question/20?sign=...&t=...&page=...`
- sign 是 32 位 hex 但**不是** `md5("page|t")`（实测排除，勿再试 MD5/拼接族）——必须真跑 wasm
- 请求头特征（capture.json 实测）：数据接口（$.ajax）带 `X-Requested-With: XMLHttpRequest` + `accept: application/json, text/javascript, */*; q=0.01`；getTime/api2/20 为原生 XHR/fetch **无** X-Requested-With；全部带 `Referer: /match/20`；api2/20 是 webpack `requireEnsure` 里 `fetch("/api2/20")` 发起
- 页面规则（document.html 试炼步骤原文）：**请求全部 5 页数据求和**（TP=5/PS=10 写死）；**发送最后一页时 UA 改为 `yuanrenxue`**，否则不返回最后一页数据（末页 UA 规则第 6 次实证）
- 页面 hook 残留（反模式 27 同族）：内联 script `$.ajax` 拦 `/api/match/20` 存 `window.match20`——老版接口遗留从未被请求，本题生效接口是 `/api/question/20`
- 风控特征：数据绑定 sessionid（两轮取证会话 page1 数据逐字节恒定）；无蜜月期/无挑战 cookie（仅百度统计 Hm_*）；提交 `POST /a/20` 表单编码 `code=2` 通关 / `code=1` 已做过 / `code=0 msg=wrong answer` 答案错

## 加密方案

- 路径：C WASM 加载（Node 原生 `WebAssembly.compile + instantiate`）+ B 最小 JS 沙箱（glue 原样还原：heap 管理 / passStringToWasm0 / getStringFromWasm0 / getInt32Memory0 / 13 个 import 桩）
- 框架：不使用（glue 代码量 ~150 行，直接重写；无需 vm/环境框架）
- 核心思路：sign 是 wasm 纯字符串函数，**黑盒执行不反编译**；本地唯一补环境点是 wasm-bindgen get-global 初始化链的桩语义（见踩坑 2）
- 服务端校验语义：sign 重算比对（wasm 输入只有 `page|t`，无会话/指纹参与）+ sessionid 登录态 + 末页 UA

## 踩坑记录

1. **坑（取证通道拿不到 wasm 字节）**：ruyipage 落盘的 `forensic/wasm/*.wasm` 经库层 UTF-8 replace 文本化（FFFD×7427），本地编译报 `section (code 1, "Type") extends past end of the module (length 3104751)`；RuyiTrace 对 `instantiateStreaming` 流式源 `dumped:false, dumpReason:no_bytes/metadata_only` 只记元数据。两条取证通道都拿不到无损字节时，改走**运行时二进制拉取**（`GET /api2/20` HTTP 客户端直拉 + `\0asm` 魔数/sha256 校验 + fixture 对拍兜底版本变更，match9 先例），不要试图从损坏产物里"修复"字节。反模式 25 第二形态；2.3.86 起 forensic_ruyipage.py 已改走 BiDi base64 无损通道（`response_body_lossless: true`）。
2. **坑（Node 沙箱调 wasm 报裸 `unreachable`）**：实例化成功、调 `sign` 抛 `RuntimeError: unreachable`，无 JS 堆栈。wasm-bindgen get-global 初始化链（`self() → newnoargs("return this") → call(null) → instanceof_Window(global) → document → body`）要求 `instanceof_Window` 桩**返回 true**（浏览器里 `globalThis instanceof Window === true`）、`document`/`body` 桩返回**非空对象**（空壳 `{document:{body:{}}}` 即可），否则 Rust 端分支枚举全不匹配 / unwrap(None) 进 unreachable。桩返回"Node 里合理"的值（false/None）反而错——反模式 28 形态四。定位手段：每个 import 桩加一行访问日志看序列停在哪个桩之后。
3. **坑（答案口径想当然）**：首跑按"3 页求和"提交 17383787 → `{"result":"fail","msg":"wrong answer","code":0}`。题面唯一权威来源是 `document.html` 的「试炼步骤」区块：**全部 5 页数据加和 + 末页 UA=yuanrenxue**。提交前先读题面原文，不按题号相邻题或通用模板假设口径；错误提交本身无惩罚（页面警告的"提交过频"指高频刷），但每次提交都消耗账号风控余量，能先验证就先验证。
4. **坑（RuyiTrace 分类日志质量误判）**：自动采集的 `--import-after` 只导入主 trace 后，按告警手动导入最大的候选日志 `trace_storage_process_31672.ndjson`（7241 行，实为 storage 分类日志），导入摘要判「重度不足：未覆盖页面 JS」——分类日志本就不含 stack.file，该判定对它必然误报；且纯分类日志导入会覆盖 `notes/ruyitrace-summary.md`，导致 `check_trace_gate.js` 读到「摘要未关联目标域」假警告。trace 质量必须以 `domtrace/trace_process_*.ndjson`（tab 进程主日志）为准。2.3.86 起导入脚本对纯分类日志输入改判「说明」并默认跳过摘要覆盖。
5. **坑（check_env_prerequisites stack 正则拒绝 webpack 形态）**：trace 里的 stack 形态是 `webpack:///./pkg/index_bg.js?:147:37`（sourceURL 带 `?`），旧正则字符类不含 `?` 直接判 BLOCK「未发现 stack 定位」。entry-chain.md 里把 stack 归一化写为 `./pkg/index_bg.js:147:37` 即可过门禁；2.3.86 起正则已兼容 `?` 形态。
6. **坑（result/ 不得含样本加密参数值）**：把 fixture 期望值（3 组真实 sign）放 `result/fixtures/sign-fixtures.json` 被 `check_final_artifact.js` 判「复用样本参数」——门禁对 result 全量文本扫描，**期望值也只能放 `case/fixtures/`**；交付入口读取时用 `../case/fixtures/` 相对路径并容忍缺失（缺失警告跳过对拍）。同轮被扫出的还有 fixture 描述文本里的 "ruyipage" 字样（判为取证代码痕迹），result/ 下文档避免出现工具名。

## 可验证事实清单（经验资产）

1. 固定 sessionid 下 5 页加和恒 **27713926**（2026-08-29 协议取数 + 提交 code=2 通关）
2. 3 组跨会话 sign 对拍样本：`("1","1787955720511")→10f576874ed92905f4b0568964ab8493`；`("1","1787955775765")→46d64cd44d3a522a9780c77bfc9dd002`；`("2","1787955782806")→d9ab71962f79c0bb9b2783238d1ed092`（`case/fixtures/match20-sign.fixture.json`）
3. `/api2/20` 返回 wasm：字节数 187989、sha256 前缀 `c107194a4e4c5250`（2026-08-29）；`getTime` 响应为 13 字节纯文本毫秒时间，page2 请求 t 与 getTime.js 落盘文件内容逐字节一致（t = 服务器时间实锤）
4. 5 页数据（2026-08-29 会话）：p1 `[813856,804332,188393,941520,903571,805949,108995,293873,117284,813048]`…p5 `[326358,929920,978821,255550,317854,746984,610290,669836,588900,327540]`
5. `POST /a/20` 表单编码 `answer=<加和>`：`{"result":"success","created":true,"code":2,"exp":300}` 通关；3 页口径错误答案 → `{"result":"fail","msg":"wrong answer","code":0}`
6. wasm imports 13 个桩名与 1.index.js `wasmImportObjects` 一一对应（`__wbg_instanceof_Window_434ce1849eb4e0fc` 等）；glue `sign(content)` 为字符串进/字符串出（retptr -16/+16 + malloc/realloc/free）

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/env/env-debug-loop.md` | 「WASM trap：unreachable」专节（get-global 桩语义 + 修复清单 + 桩日志定位法） |
| `references/workflow/common-pitfalls.md` | 反模式 28 形态四（wasm-bindgen import 桩语义）+ 反模式 25 第二形态（取证产物二进制损坏） |
| `references/tooling/ruyitrace-cheatsheet.md` | WASM 节「字节获取边界」（instantiateStreaming 只记元数据） |
| `references/network/dynamic-resource.md` | 运行时二进制拉取 + hash 校验纪律（wasm 字节获取的唯一可靠路径） |
| `cases/yuanrenxue-match15-wasm-deterministic-signature.md` | 同为 WASM 签名题对照：无导入纯确定性 wasm 直跑 vs 本题 wasm-bindgen 带导入 + glue |
| `cases/yuanrenxue-match9-dynamic-cookie2.md` | "运行时二进制抓取最新版"先例（wasm/SDK 字节获取） |
| `cases/yuanrenxue-match-index.md` | match 系列速查（末页 UA 第 6 次实证、sessionid 数据绑定、题面试炼步骤区块） |
