# Case：同花顺 hexin-v 移植版以 Cookie `v` 承载指纹结构体，服务端只校「载体+定长+ts 窗口」（码上爬平台题15）

> 难度：★★★
> 还原方案：B 最小 vm 沙箱黑盒执行站方原始 `pagination15.js`（结构体 18 字段位宽与 XOR 常数未闭式还原，实测服务端不校验内容）
> 实现语言：Node.js
> 最后验证日期：2026-09-20
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- 入口页特征：`var problemId = 15;` + **通用**动态注入 `script.src = "/static/js/pagination" + problemId + ".js"`
  onload 后 `loadPage(1)`；题 11/13/14/16/18/19 在 HTML 里有专属 `if (problemId === N)` 分支，本题没有
- JS 特征：`pagination15.js` 50170B / **1259 行（已美化，非单行）**；混淆形态 = **两个字符串数组 + 5 个纯解码器**
  （`v`/`Wn`/`ot`/`at`/`an`），常量以**反转字符串**存放（数组内 `"v-nixeh"`=hexin-v、`"KCABLLAC_NOELEMAHC"`=CHAMELEON_LOADED、
  `"eikooCled"`=decodedCookie）；**核心计算函数体本身未字符串化**（`O()`/`qn`/`zn` 可直读）
- 血统特征：串表内保留 `"//s.thsi.cn/js/chameleon/time.1"`、`"X-Antispider-Message"`、`"CHAMELEON_LOADED"`，
  文件顶层常量 `var TOKEN_SERVER_TIME = 1736664896.387;` ⇒ **同花顺 chameleon hexin-v 整包移植**，不是自写哈希
- 参数特征：签名是 **Cookie `v`**（服务端唯一校验载体）+ 同值 **Header `hexin-v`**（浏览器冗余，服务端不校）；
  值恒 100 字符 base64；数据接口是 **GET**（题13/14 为 POST），**无 `x-requested-with`**，query 侧零签名位
- 明文结构：`base64( 60 字符自研 base64url 体 + 13 位毫秒 ts )` → 体内 **45 字节** = `[0x03 魔数][1B 滚动校验和][43B 位打包指纹结构体（XOR keystream）]`
- 拒绝特征：缺 `v` → **HTTP 200** + `{"code":"400","message":"小鸡，别爬了"}`（与题13/14 同款业务码包装）
- 缓存特征：`localStorage` 键 `hexin-v` + Cookie 双写；`setInterval` delay 1200000ms（20 分钟）重取服务器时间

## 加密方案

- 路径：B 最小 JS 沙箱黑盒（不反混淆、不改站方 JS 一个字节；入口对副本做 sha256 校验，漂移即显式报错）
- 框架：不使用；交付侧 Node 原生 `https`（keepAlive Agent，显式 destroy）+ `node:vm`
- TLS 客户端：Node 原生 `https`（首次直连即通过，无 TLS/HTTP2 指纹校验）
- 生成链：`loadPage` → 被 SDK 包装的 `window.fetch` → `rt.update()`（`pagination15.js:918`）
  字面即 `btoa(zn.encode(S.toBuffer()) + new Date().getTime())`；
  `S = new qn([18 个字段宽度])` 在 `rt.Init`（`:891`）填入 `Jn.random()` / `serverTimeNow` / `timeNow` /
  `strhash(navigator.userAgent)` / `tt.getBrowserFeature()` / `getPlatform()` / `getBrowserIndex()` / `getPluginNum()`，
  `rt.update` 每次再刷新鼠标键盘计数与自增序号
- writer 两分支都要覆盖：`init.headers` 为空 → `new Headers()` + `append('hexin-v', v)`（数据 GET）；
  `init.headers` 已是对象（提交请求带 `x-csrf-token`）→ 走 `init.headers['hexin-v'] = v` 直挂属性分支
- 提取方式：沙箱内 `fetch` 为**记录桩**（零网络），从被包装的 fetch 收到的最终 `(url, headers)` 同步取 v；
  真实请求全在交付入口发出

## 踩坑记录

1. **坑（把 Header 当校验载体）**：浏览器同值双发时默认认 Header。单变量实测相反——
   **只带 `hexin-v` 头 → 拒；只带 `v` cookie → 过** ⇒ 服务端只认 Cookie。
   → 见规则 49：同值多载体必须「只带它 / 去掉它」各打一次再定性。
2. **坑（按编码链长度推断必须闭式还原）**：位打包 + 滚动校验和 + XOR keystream + 自研 base64 看起来非还原不可，
   实测**伪造内容体（`A`+59×`x`+合法 ts）照样 200**，只有长度破坏与 ts ±600s 被拒
   ⇒ 服务端校验集 = 载体存在 ∧ 解出 73 字符 ∧ |Δts| 在窗口内（540s 过 / 600s 拒）。
   → 见规则 32 第 4 条：链长是**客户端混淆强度**，不是服务端校验强度；先用受控单变量请求打边界再决定还原深度。
3. **坑（vm 沙箱里预置 `globalThis: null`）**：为了让 window/self 有值而把 `globalThis` 显式写成沙箱键，
   context 内 `Object.defineProperty(globalThis, 'window', …)` 直接报 `called on non-object`。
   realm 自引用与内建构造器只能在 **context 侧脚本**里定义（`vm.createContext` 之后 `runInContext` 注入）。
4. **坑（canvas 出现在栈里就以为要补像素）**：`HTMLCanvasElement.getContext` 的调用点是 `$()` 的 `!!ctx`
   （`:806-815`），只折进 `getBrowserFeature()` 的 1 个 bit；按 fingerprint-value-replay 流程去采 canvas 真值是纯浪费。
   → 已把「先判返回值是否真被消费」写进 `references/env/env-object-model.md` Canvas 节。
5. **坑（首轮取证就没有 `case/forensic/document.html`）**：`forensic_ruyipage.py` 在采集期写入口页（`:1175`），
   收尾 `_write_outputs` 又把它列进 `_rotate_previous`（`:1320`）⇒ 本轮产物被搬成 `.prev-1` 且不再写回，
   **每轮跑完 document.html 必不存在**（题13 留 3 份 prev、题14 留 2 份、题15 同样，仅早于该特性的题12 留有文件）。
   本轮靠手动 `cp .prev-1 document.html` 才读到题面与 `loadPage`。已修 + 加反证回归自测。
6. **坑（`--import-after` 只导进 543B 的 jscall 分类日志）**：domtrace 主日志（2.6MB/2.3MB/782KB）在浏览器 kill 后
   才刷盘，自动导入只拿到分类日志并写出「记录 1」的摘要。属 match17/match20 已记的刷盘时序坑，
   脚本已提示「质量必须以 domtrace 主日志为准」，按提示手动 `import_ruyitrace_log.js --input a --input b --input c --summary-write` 即可。
7. **注意（flag 名不同源）**：`capture_ruyitrace_log.js` 用 `--evidence-signal`，`import_ruyitrace_log.js` 用 `--trace-signal`，
   传错直接报「未知参数」。已在 `scripts/README.md` 标注。

## 可验证事实清单（经验资产）

1. `hexin-v = base64(60 字符自研 base64url + 13 位毫秒 ts)`，明文恒 73 字符、密文恒 100 字符。
2. 60 字符体 → 45 字节 = `[0x03 魔数][1B 校验和][43B 混淆结构体]`；`x()` 为 `e=(e<<6)-e+byte` 取 `&0xff`；
   `g()` 为 `dst[i]=src[a]^(key&0xff); key=~(key*K)` 逐字节推进。
3. 服务端实测（9 组单变量对照）：缺 v 拒 / 只带头拒 / 只带 cookie 过 / 伪造内容体过 / 截断拒 /
   同一 v 重放过 / ts ±30..540s 过 / ts ±600s 拒。
4. SDK 的 `getServerTime` 会向 `s.thsi.cn` 注入时间脚本，但**真机抓包 0 次该请求**，`serverTimeNow()` 由文件首行
   `TOKEN_SERVER_TIME` 常量即可满足 ⇒ 沙箱无需联网、`createElement` 只需造 `div`/`canvas` 两种标签。
5. 沙箱最小环境（装载零 `missingGlobals`、零 `runtimeErrors`）：`navigator`(UA/platform/plugins/mimeTypes/languages/
   doNotTrack/webdriver/javaEnabled) + `document`(cookie 真实可读写/createElement/getElementsByTagName/addEventListener) +
   `location`(href/protocol/host/hostname) + `localStorage` + `Headers` + `fetch` 记录桩 + `XMLHttpRequest` +
   定时器 no-op + `btoa/atob` + `screen` + context 侧 `window/self/top/parent/frames`（不可配置 getter）与
   `HTMLCanvasElement/WebGL2RenderingContext`。**不需要** `crypto`（随机源是 `Math.random`）、`WebAssembly`、
   `performance`、真实 jQuery。
6. `getBrowserFeature()` 含 `-parseInt(…) === new Date().getTimezoneOffset()` 时区探针 ⇒ 交付环境须为 UTC+8，
   否则该 bit 与真机不一致（当前服务端不校此 bit）。
7. 每次 `rt.update()` 使 `S[R]++` ⇒ **整个进程复用同一沙箱实例**，禁止每请求重建（同规则 24 计数器族）。
8. 本题答案口径：20 页 × 10 项 = 200 项**全量求和、不去重**；按分钟轮换（相隔数分钟 101560 / 105621），
   取数与提交必须同运行完成；提交三态 `success` / `info`(已完成) / `error`。
9. 提交链：`POST /problem/15/submit/`，multipart(`csrfmiddlewaretoken` + `user_answer`) + `x-csrf-token` 头，
   token 取详情页隐藏 input（服务端同时下发 `csrftoken` cookie）。

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/experience-rules.md` | 规则 49（同值多载体的校验载体归因）本题实证 |
| `references/workflow/experience-rules.md` | 规则 32 第 4 条（校验强度判据从随机量扩到整条编码链）本题实证 |
| `references/env/env-object-model.md` | Canvas/WebGL 节新增「先判返回值是否真被消费」triage 条 |
| `references/crypto/algorithm-families.md` | 站点速查表新增 hexin-v 指纹结构体族（T1 识别信号） |
| `references/env/env-debug-loop.md` | vm realm 边界（题14 已记时间冻结一条，本题补「沙箱键预置 globalThis/window 为 null」形态） |
| `scripts/forensic_ruyipage.py` | 修复入口页收尾被轮转丢失缺陷 + 反证回归自测 |
| `cases/obfuscated-url-param-signer-safekodo-mashangpa-p14.md` | 同平台题14：同为 B 沙箱黑盒交付，但签名挂 query、值仅 18 字节明文，参数形不可跨题复用 |
| `cases/vm-sandbox-chameleon-iwencai.md` | **同族前置案例**（真·同花顺 iwencai hexin-v，2026-07-11 验证）：本题是站方把整包 chameleon SDK 内联进 `pagination15.js` 的教学复刻；原版补 Element/Document/XHR 中等规模环境，本题以 trace 把环境收敛到 8 个职责模块即可装载零报错。两侧都验证了「B 沙箱黑盒读 hexin-v」这条路，但**校验载体与校验强度必须逐站重测**（原版有 iwencai 专有链路，本题服务端只校载体+定长+ts 窗口） |
| `cases/obio-md5-header-triple-script-inject-race-mashangpa-p13.md` | 同平台题13：签名在 headers，与本题「头不被校验」形成对照 |
| `cases/yuanrenxue-match17-http2-transport-plaintext.md` | `--import-after` 刷盘时序坑同源（踩坑 6 复用其结论） |
