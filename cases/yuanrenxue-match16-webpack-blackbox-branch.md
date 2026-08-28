# Case：webpack 混淆包黑盒执行 + 分支漂移（猿人学第16题）

> 难度：★★
> 还原方案：B 最小 JS 沙箱（webpack 模块切片黑盒执行，不反混淆）
> 实现语言：Node.js（原生 https + `new Function` 沙箱，无第三方依赖）
> 最后验证日期：2026-08-28
> 平台类型：match.yuanrenxue.cn（猿人学练习平台）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：webpack 打包的单行 bundle（`static/new_match/question/16/webpack.js`，310882 B，sha256 `61db470194e960523d2e9c87fa1aa2cbca6a14705de905301b2341c473b98ab0`）+ obfuscator.io 混淆（字符串数组 `push/shift` 轮转、反调试、控制台检测）。签名只依赖两个模块：模块 127（混淆 MD5，挂 `window.md5`）、模块 732（126 字符变形 base64 字母表，挂 `window.btoa` / `window.request`）
- 参数特征：`m = d(15) + md5(变形base64(t)) + d(10)`，**定长 57**；前后缀是随机串、服务端不校验，**中间 32 位 MD5 才是签名本体**；`t = Date.parse(new Date).toString()` 为**秒级**时间戳（末三位恒为 0）
- 请求特征：`GET /api/question/16?page=N&m=...&t=...`；Cookie 侧无签名（仅 `sessionid` + 百度统计 `Hm_lvt_*`）；page5 要求 `UA=yuanrenxue`，否则 **HTTP 200 但 `data` 是 9 条中文提示字符串**
- 分支特征：模块 732 的 `case 1` 用 `n.g` 决定走 try（正确）还是 catch（错误），`n` 是 webpack 的 `__webpack_require__`、`n.g = globalThis`——**抠代码到 Node 裸跑时 `n` 缺失，静默走 catch 分支**
- 反调试特征：模块尾部 `onOpen/onClose/init` 是 200ms `setInterval` + `console.info` 控制台检测，Node 内必然抛错，但发生在签名函数挂载**之后**，try/catch 包住即可，不必删
- 风控特征：数据**绑定 sessionid**（同 session 各页数值恒定，可反复复验）

## 加密方案

- 路径：B 最小 JS 沙箱（模块 127 与 732 原样黑盒执行，不反混淆、不还原算法）
- 框架：Node.js 内置 `https`（keepAlive Agent）+ `new Function` 隔离作用域，无第三方依赖
- TLS 客户端：不需要（Node 原生 https 直连，无 TLS 指纹校验）
- 核心思路：从 310KB 单行 bundle 里切出两个模块源码 → `new Function('window','document','n', body)` 逐个执行、共享同一个自定义 `window` 对象（复刻 webpack 模块语义：各模块有自己的 `var e,t,n`，不能塞进同一作用域）→ `btoa(t)` 即得 `m`
- 服务端校验语义：用请求里的 `t` 重算 `md5(变形base64(t))`，与 `m` 中间 32 位比对；`t` 只到秒级，故相邻秒的 `t` 可能因变形 base64 丢位而碰撞出相同 MD5 段，服务端用同一算法重算所以不影响通过

签名调用链：`模块127(window.md5) → 模块732(window.btoa) → 模块58($.ajax hook 改写接口路径) → /api/question/16`

## 踩坑记录

1. **坑：抠代码后静默走错 try/catch 分支（本题最耗时，也是全案关键）**。模块 732 的 `case 1` 是 `try { n.g && c.push(...) } catch { c.push(另一种拼接) }`：浏览器里 `n` 是 webpack 的 `__webpack_require__`、`n.g === globalThis`（真值）走 try；把代码抠到 Node 裸跑时 `n` 未定义 → ReferenceError → 落进 catch。**两条分支产出的 `m` 长度与格式都正常，但服务端只接受 try 分支的结果**，表现为"格式全对却被拒"，极易误归因会话/TLS/频率。正确做法：① 向 `new Function` 传入 require 桩并设 `n.g = globalThis`，复刻打包器注入的宿主对象；② 用**两组取证样本**反证分支——只有 try 分支能复现样本里的 MD5 段。详见反模式 26、规则 26。
2. **坑：`charAt` 越界返回空串是算法语义，不能用数组下标改写**。`case 4` 的索引最大到 259，而变形 base64 字母表只有 126 字符，越界时 `charAt` 返回空串——那一位**就是不产出字符**。用 `alphabet[i]` 实现会拿到 `undefined`（拼进字符串变成 `"undefined"`），结果静默错误。正确做法：黑盒执行时保持 `charAt` 原样；自实现时必须用 `charAt` 而非下标，并保留越界即空串的行为。
3. **坑：page5 仍用普通 UA → HTTP 200 + 中文提示数组**。服务端不返回 400 也不报错，`data` 是 `["请","将","UA","改","为","yuan","ren","xue","哦"]` 这类 9 条字符串，**只看状态码会误判通过**。正确做法：page5 单独用 `UA=yuanrenxue`，并对每页响应做 `data` 元素类型校验（数值数组才算通过）。
4. **坑：时间戳精度**。`p_s = Date.parse(new Date).toString()` 会丢掉毫秒，末三位恒为 0；自己用 `Date.now()` 得到的是毫秒值，重算出的 MD5 与服务端不一致。
5. **坑：模块切片边界**。模块体边界 = 下一个模块起点 - 2（去掉尾部 `},`），多取一个 `}` 就 `SyntaxError: Unexpected token '}'`，而错误位置在超长单行里极难定位。正确做法：正则扫出所有 `\d+:function(...){` / `\d+:()=>{` 起点按偏移排序定位，再对切片尝试追加 0~5 个 `}` 并逐个 `node --check`，第一个通过的即正确切片。

## 可验证事实清单（经验资产）

1. 固定 sessionid `p4av26i0hl3t4dar70r5icog4vytlguo` 下 5 页加和稳定 **25052175**（2026-08-28 实测）；各页小计 3,965,362 + 5,131,251 + 4,946,591 + 5,828,521 + 5,180,450
2. 同 sessionid 下各页数值恒定，4 轮 20 次真实请求结果完全一致，page1 数据与浏览器取证样本逐条一致——适合做离线回归基线
3. `m` 定长 57 = 15 位随机前缀 + 32 位 md5 + 10 位随机后缀；服务端只校验中间 32 位，前后缀可任意随机（本次实现仍按原样生成）
4. 秒级 `t` 会碰撞：page2~page5 的 `t` 相差 1 秒但 MD5 段相同，服务端照常返回 200（服务端用同一算法重算，不是漏洞）
5. 分支反证：try 分支能复现取证样本中的 MD5 段，catch 分支不能——**"格式正确但被拒"时应优先怀疑分支漂移，而非算法或通道**
6. page5 普通 UA 返回 9 条中文提示字符串（HTTP 200、data 非数值）；`UA=yuanrenxue` 返回 10 个数值
7. 模块偏移（单行压缩文件字符偏移）：模块 127 = `webpack.js[154109:166540]`，模块 732 = `webpack.js[193225:198328]`；bundle sha256 `61db4701...`，`last-modified` 2026-02-15（算法更新后载荷会失效，表现为签名格式正常但服务端拒收）
8. 接口路径已从老版 `/api/match/16` 改为 `/api/question/16`（JS 内仍保留 `/api/match/16` 常量，由模块 58 的 `$.ajax` hook 改写）；**接口路径以本次抓包为准，外部老题解仅作假设**
9. 提交 `POST /a/16` 表单编码（`answer` 字段）为 match 系列惯例，本 case 未做提交实测

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/common-pitfalls.md` | 反模式 26（抠代码后分支静默漂移）本 case 实证；反模式 23（签名含不可复算随机量 → 分支判定失败信号）同源 |
| `references/workflow/experience-rules.md` | 规则 26（webpack bundle 模块切片黑盒执行：切片边界 + 隔离作用域 + require 桩 + 反调试处理）本 case 实证 |
| `references/workflow/decision-tree.md` | 题型判定 + 路径决策（混淆但可定位到独立模块 → 路径 B 黑盒执行） |
| `cases/yuanrenxue-match-index.md` | match 系列速查（sessionid 数据绑定、末页 UA 红线、接口版本变化） |
| `cases/yuanrenxue-match15-wasm-deterministic-signature.md` | 同源题型对照：同为定长签名参数、末页 UA 红线、数据绑定 sessionid |
| `cases/yuanrenxue-match14-fingerprint-cookie-m-mz.md` | 同源题型对照：签名格式正常但被拒时的归因顺序 |
