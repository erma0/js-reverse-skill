# Case：站方 webpack 指纹 SDK（`anti = __webpack_require__` 改名别名）以 Header `m` 承载「不透明信封 + base64(盐+ts)」，服务端只校长度与尾段 ts（码上爬平台题18）

> 难度：★★★
> 还原方案：B 最小 vm 沙箱黑盒执行站方原始 `actoken.js`（前段 253 字节信封含客户端随机量，实测服务端不校验内容，不做闭式还原）
> 实现语言：Node.js
> 最后验证日期：2026-09-20
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- 入口页特征：`let problemId = 18;` + **专属分支** `if (problemId === 18) { script.src = "/static/js/actoken.js" }`
  ⇒ 只列 `<script src>` 看不到签名脚本，必须读内联分支；页面通用还会注入 `pagination18.js`
- 签名脚本特征：`pagination18.js` 5586B 单行 ob-io 风格（**签名公式是明文**），`actoken.js` 216324B / 3923 行
  **webpack bundle**，字符串表是 `jsjiami` 型 RC4+base64（`function ee(e,t)` + 数百个 `W4xx/8k` 形态条目），
  自定义 base64url 字母表 `a["+"]="-"; a["/"]="_"; a["="]="";`
- 别名特征（本题最好用的识别信号）：bundle 引导段把 require 函数改名成全局 —— `n.p = "", anti = n`，
  于是调用形态是 `anti(<模块号>)({serverTime: ts}).messagePack()`；`anti(4)` 返回单例工厂，
  原型方法表固定 `[constructor, updateServerTime, init, clearCache, messagePack, messagePackSync]`
  （`init`/`clearCache` 是空函数，`messagePackSync` 只是 `new Promise(r=>r(re()))`）
- 参数特征：签名在 **Header `m`**（362 字符），伴生头 `timestamp`（=ts）、`client-version`（=`1.0.0`）；
  数据接口 GET `?page=N`，除 page 外 query 侧零签名位；旁路 cookie `_nano_fp`（44 字符 base64url，同族前缀 `XpmJlpCbn`）
- 明文结构：`m = <253 字节不透明信封的 base64url（338 字符，首 2 字节恒 0xD1 0xAA）> + base64("luoge" + ts)`
- 拒绝特征：HTTP 200 + `{"code":"400","message":"小菜鸡，别爬了"}`（本任务系列里该文案已出现两种：「小鸡…」/「小菜鸡…」，按前缀匹配）
- 无 canvas / 无 WebGL：RuyiTrace 中栈含 `actoken.js` 的 56 类读取里没有任何 `getContext`/`WEBGL`/`Canvas` 项

## 加密方案

- 路径：B 最小 JS 沙箱黑盒（不改站方 JS 一个字节；入口对 `result/src/target/original/actoken.js` 副本做 sha256 校验，
  漂移即显式报错）。`sha256 = 8a684927ca0b3f075cbd66329b4b86e66e40fb3c89f346114edbca96d0d4cd07`
- 框架：不使用；交付侧 Node 原生 `node:https`（keepAlive Agent + 显式 destroy）+ `node:vm`
- TLS 客户端：Node 原生 `https`（真机走 h2，本侧 33 次请求零连接层拒绝）
- 生成链：`$.ajaxPrefilter` 三步状态机 → `VM_OPS[1]` 取 `new Date().getTime()` → `getCrawlerInfo(ts)`
  → `B(ts)` = `anti(4)({serverTime: ts}).messagePack()` → 拼 `btoa("luoge"+ts)`；
  `re()`（签名实体）从 23 个采集器取比特 → 补零到 16 → 位数组转字节 → `String.fromCharCode` → 自定义 base64url
- writer（真值取证点）：`XMLHttpRequest.setRequestHeader` ← `jquery-3.6.0.min.js:2412:186`
  ← `ajax` `jquery:2286:31` ← `loadPage/_0x522c3d<` `pagination18.js:2:5477`
- 尾部 oracle 的取证捷径：RuyiTrace `Window.btoa` 记录的 `args` 就是**未编码明文**
  （`args:["luoge1789895190761"] → "bHVvZ2UxNzg5ODk1MTkwNzYx"`），一次命中即钉死 source↔writer 配对，无需反混淆
- 补齐环境（全部有 trace 栈证据）：`window/self/top/parent/frames`（realm 内不可配置访问器）、`document`
  （cookie 读写袋 / createElement→`canPlayType` / addEventListener / referrer / visibilityState）、
  `navigator`（userAgent / plugins+length / languages / webdriver）、`screen`、`location`、`localStorage`、
  `history`、`performance`、`HTMLElement` 系构造器、`atob`/`btoa`、**真实可回推的定时器族**
- 提取方式：realm 内签名桥 `__p18Crawler(ts)` 只回传字符串；沙箱 `fetch` 不提供、`XMLHttpRequest` 为拒绝桩，零网络行为

## 踩坑记录

1. **坑（`setTimeout` 空桩让签名静默退化成空串）**：`run_with_trace.js`（含 full bootstrap）里
   `anti(4)({serverTime:ts}).messagePack()` 恒返回 `""` 且零报错，表象与"被沙箱检测、走反调试分支"完全一样。
   真因：`re()` 首行 `if (!h) return "";`，而 `h`/采集器靠 `setTimeout(te, 0)`（`actoken.js:2169`）复位填充。
   换宿主真实时钟驱动的定时器泵后**首调即 338 字符**。
   → 已把「返回空串」这一症状与「泵必须真实让出事件循环」写进 `references/env/env-debug-loop.md`
   「`run_with_trace.js` 的两个静默致死形态」，并在 SKILL.md §7 禁令处加了例外指针。
2. **坑（拿站方自定义方法名当 trace 信号）**：`check_trace_gate.js --require-trace-signal messagePack` → 0 命中，
   被门禁判成「Step 2 已具备、目标链路覆盖不足」并进 TRACE_RETRY。RuyiTrace 的 `interface`/`member` 只会是浏览器内建 API，
   用户函数名不作为任何字段出现；改用请求头名 `client-version` 立即 PASS。
   → 已补为「信号必然不命中」的第 ④ 类（SKILL.md §4.2 + trace-flow.md），并让 `check_trace_gate.js` 在
   「有证据、信号选错」时直接打印该自查提示。
3. **坑（`analyze_cookie_attribution.js` 把读当写）**：该工具把 `sessionid` 判成 `both`、`taarId` 判成 `js`
   「按写入点还原算法」——全是假阳性。三类污染源：JS 读整串 cookie（`Document.get cookie` / `cookieReads.jar`）、
   浏览器内核与 HTTP 层记录（`cookieSendDecisions`、`CookieService.GetCookiesForURI`、`process_type=parent`）、
   以及 `cookieWrites` 记录里的 `jar` 写入后快照。`sessionid` 是 HttpOnly，JS 根本写不了。
   → 已修：归因只认页面 JS 写入，读取降为辅助计数，`unknown` 态不再冒充 `js`；本题与题15 双案例回归通过。
4. **坑（同长度随机伪造体被接受 ⇒ 别再啃闭式）**：把 `m` 第 4 字符起整段换成随机 base64url 仍 200 + 正常数组；
   而截断到 120 字符、或把尾部内嵌 ts 挪 −30min/+10min 都拒。
   ⇒ 服务端校验集 = `m` 存在 ∧ 整体长度/结构 ∧ 尾段 `base64("luoge"+ts)` 的 ts 新鲜度；
   `timestamp`/`client-version` 头与 `_nano_fp` cookie **一个都不校验**（改错值或删掉都通过）。
   → 见规则 32 第 4 条；「先切可复算段再定还原深度」已提炼进 `references/crypto/crypto-entry.md`「信封型」一节。
5. **坑（页面加载了 crypto-js 就以为签名走它）**：`crypto-js.js` 91KB 随页加载，但
   `grep -c CryptoJS actoken.js` = 0 ⇒ 与签名链无关，沙箱不加载。判定依赖归属看「被引用」不是「被加载」。
6. **坑（cookie 名在 JS 里 grep 不到）**：`_nano_fp`/`taarId` 在全部落盘 JS 里 0 命中（被 RC4 字符串表加密），
   只能靠 trace 的 `Document set cookie` + `stack.file:line` 定位（本例 `actoken.js:3742`）。
7. **注意（参数名跨题重复不等于形态相同）**：题14 的载体也叫 `m`，但那是 query 参数
   `m=base64(CODE4+ts+NUL)`；本题是 Header、362 字符信封。同平台新题先看本次 `target-hits.json` 的载体位置与长度。

## 可验证事实清单（经验资产）

1. `pagination18.js` 明文给出装配式：`headers['m'] = crawler + vmExecute(3,{input:'luoge'+ts})`、
   `headers['timestamp']=ts`、`headers['client-version']='1.0.0'`，`crawler = anti(0x4)({serverTime:ts}).messagePack()`。
2. 真机两组 (ts, m) oracle 可逐字节核对尾段：`ts=1789895190761` ↔ 尾 24 字符 `bHVvZ2UxNzg5ODk1MTkwNzYx`
   = `base64("luoge1789895190761")`；`ts=1789894895750` 同样吻合。
3. 信封前 2 字节恒 `0xD1 0xAA`（两组真机 + 沙箱 9 轮采样一致）；长度随采集器状态在 338/340/342/346 间浮动
   （加载后首调 338，泵过后变长）⇒ 结构不变量该按「区间 + 前缀 + 字符集」写，不要写死长度。
4. 沙箱自生成 `_nano_fp` 与真机同族同形（真机 `XpmJlpCbn0Cb…` / 沙箱 `XpmJlpCbn5Tx…`）⇒ 设备指纹 cookie 可自产，
   不需要把取证 cookie 值搬进交付（未触发 §3 设备级凭据例外）。
5. 打靶矩阵（11 个单变量用例 / 两轮 19 次请求）：A 基线过；B 无 `m` 拒；C 随机伪造体过；D `timestamp` 改 1h 前过；
   E 无 `timestamp` 过；F 无 `client-version` 过；G 截断拒；H 无 `_nano_fp` 过；
   I 伪造体+尾 ts −30min 拒；J 真值 m + ts −30min 拒；K 真值 m + ts +10min 拒。
6. 数据按运行轮换：交付轮 total=103848（提交 `status:success 答案正确，加10积分`）→
   重构后复验轮 total=101679（提交 `status:info 你已经完成过这道题目了`）⇒ 必须同轮取数同轮提交，
   且 `info` 不是还原失败（同平台第 3 次命中该三态）。
7. 整轮 20 页 + 提交在单 keepAlive 连接上 4.0s（`pageIntervalMs=120`），19 次打靶 + 44 次正式请求零频率墙。
8. `anti = n` 之外没有全局副作用：actoken 只挂 `anti` 一个全局，签名器可稳定用 `anti(4)` 取单例；
   `anti(0..6)` 探测返回 `[object Object]`/function，模块号 4 是唯一带 `messagePack` 的工厂。

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/experience-rules.md` 规则 32 第 4 条 | 链长≠校验强度：服务端只校 `m` 的长度/结构与尾段 ts，伪造内容体通过（本 case 打靶矩阵 C/G 列，机制同题15 的 45B 指纹） |
| `references/crypto/crypto-entry.md`「信封型」 | 不透明信封 + 尾部可复算段：先切可复算段再定还原深度（本 case 坑 4） |
| `references/env/env-debug-loop.md`「`run_with_trace.js` 的两个静默致死形态」 | `setTimeout` 空桩致签名静默退化成空串，泵必须真实让出事件循环（本 case 坑 1） |
| `references/workflow/trace-flow.md` | trace 信号必须是浏览器内建 API，用户函数名必然不命中（第④类，本 case 坑 2） |
| `scripts/analyze_cookie_attribution.js` | Cookie 归因只认页面 JS 写入、读取降辅助计数、`unknown` 不冒充 `js`（本 case 坑 3，与题15 双案例回归） |
| `references/tooling/ruyitrace-cheatsheet.md` | `Window.btoa` args 直读未编码明文，一次命中钉死 source↔writer 配对 |
| `cases/cookie-carrier-hexinv-fingerprint-struct-mashangpa-p15.md` | Cookie 归因修复的对端回归案例 + 链长≠校验强度同族实证 |
