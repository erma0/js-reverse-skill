# Case：JSVMP 内自实现 SHA-1 —— 从 jscall 的 args 直读 VM 常量表定算法族（码上爬平台题12）

> 难度：★★★（★最简 ~ ★★★★★最复杂）
> 还原方案：A 纯算还原（还原期用 B vm 沙箱黑盒执行官方 JSVMP 作权威对照源）
> 实现语言：Node.js
> 最后验证日期：2026-09-19
> 平台类型：码上爬（mashangpa.com，题号 12「如来神掌」，题面标签 `jsvmp`、难度「困难」）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：单行 5 万字符级 jsjiami.com.v7 壳（`var O／0$='jsjiami.com.v7'`，标识符含全角 `／`）；
  含具名 `function interpreter(...)` + `switch(opcode)` 派发 + `interpreter(...)` 递归帧（字节码 VM 的直接文本特征）；
  头部 `const <全局>=<解码器>` 的字符串数组解码器（`QOQQ` 型）；**尾部保留明文 `loadPage(page)`**——
  明文体只带 `page`，签名参数却出现在请求里，即"注入发生在下游钩子"
- 参数特征：Query `m` = 40 位小写 hex（SHA-1 族）+ `t` = 13 位十进制毫秒 + `page` 明文；三者顺序固定 `page → m → t`
- 请求特征：`GET /api/problem-detail/{id}/data/?page=N&m=&t=`（`x-requested-with: XMLHttpRequest`，
  `accept: application/json, text/javascript, */*; q=0.01`）；提交 `POST /problem/{id}/submit/` 为 `multipart/form-data`
  （`csrfmiddlewaretoken` + `user_answer`，同时带 `X-CSRFToken` 头且 `csrftoken` cookie 同值）；响应明文 JSON
- 反调试特征：`loadPage` 内 `if (navigator.webdriver) window.close()`；decoy 分支引用未声明变量
  （`QOQO0QQ[OOQ0OOQ]['apply']` 这类"看着像真链路"的死代码）；页面模板无条件引入 `crypto-js.js`（本题不参与链路）

## 加密方案

- 路径：A 纯算还原（B 沙箱仅作还原期对照与改版复核）
- 框架：不使用（交付期零 JS 执行）；对照器用 Node 原生 `node:vm`
- TLS 客户端：Node 原生 `node:https` + `https.Agent({keepAlive:true})`，全程 200，无连接层拦截
- 核心思路：**先翻 RuyiTrace jscall 明细的 `args`**——VM 会把运行时常量表当普通实参整份传出去，
  一眼看到 SHA-1 的 IV/轮常数与盐值串，据此把"猜算法"收敛成"验证一个候选拼接式"

```js
// m = SHA-1("fu" + 未注入签名前的相对 url + t)，t 为 unix 毫秒，输出小写 hex
const crypto = require('node:crypto');
const t = Date.now();
const url = `/api/problem-detail/12/data/?page=${page}`;
const m = crypto.createHash('sha1').update(`fu${url}${t}`, 'utf8').digest('hex');
// GET ${base}${url}&m=${m}&t=${t}
```

## 一次取证拿到的三类直证

| 证据 | 内容 | 作用 |
|---|---|---|
| `xhrNative` stack | `send(jquery:2411) ← ajax(jquery:2286) ← interpreter(pagination12.js:1:31452)` | writer 定位：注入在 VM 帧，不在明文 `loadPage` |
| `body_builder(URLSearchParams) @loadPage:9` | 字段只有 `page` | 反证 `m`/`t` 由下游钩子追加 |
| `jscall_detail` 的 `args[4]`（VM 常量表，148 项） | `1732584193 / 271733879 / 1009589776 / 1518500249 / 1859775393 / 1894007588 / 899497514`（**SHA-1 族但改动过的常数**：仅 1732584193=IV0、1518500249=K0、1859775393=K1 是标准值；271733879 比标准 IV3=271733878 大 1，其余 4 个不在 SHA-1/MD5/SHA-256 常数表 ⇒ 初始化按真机表填，不能套标准 IV）、`rol/hex/encodeUTF8/Uint8Array/Uint32Array/DataView/getUint32`、盐值 `"fu"`/`"aa"`、挂载点 `jQuery/$/originalAjax/ajax/requestInterceptors/addRequestInterceptor/interceptor` | 定算法族 + 定挂载机制，**无需开 `MOZ_DOM_JSVMP_*`，也未反编译字节码**（绝对规则 4） |

> 与既有路线的次序：**先零成本读 jscall `args`** → 不足再开 `MOZ_DOM_JSVMP_CONST_SLOT`（需声明槽号并开 JSVMP trace）
> → 最后才考虑 match29 的 eval 日志直读源码路线。

## 踩坑记录

1. **坑：`run_with_trace.js` 里目标"跑通了"，但 url 里没有 `m`/`t`，误判为"钩子没装上/环境不够"**
   → 正确做法：这类 JSVMP 的启动式是 `typeof window !== 'undefined' ? window : (window = global, window)`，
   而探测上下文按设计不暴露 `window` → 整个 VM IIFE 在 `global` 上抛 ReferenceError **静默死掉**，
   明文 `loadPage` 却还在（它是独立函数），于是症状酷似"签名链没挂钩"。
   判定动作：先确认沙箱里 `typeof window === 'object'`，再谈其它环境项。
2. **坑：同一个 runner 里 `setTimeout` 只记日志不执行回调，定时器驱动的初始化全部丢失**
   → 正确做法：`run_with_trace.js` 是探测工具，不能当交付级 runner；
   JSVMP/带初始化定时器的站点自写 harness，注入真实宿主定时器（handle `unref()` + 退出前统一清理）。
3. **坑：VM 抛 `Cannot read properties of undefined (reading 'apply')`，且异常逃出 VM 自己的 try/catch，一路误以为"分支走错/被反调试"**
   → 正确做法：那是 VM 的"方法调用"opcode `obj[name]['apply'](...)`，`obj[name]` 未定义即缺环境成员。
   本次是 `canvas.getContext`——**常量表里出现 `canvas`/`ctx`/`canvasData` 就是预告**，补 2D 上下文桩即通。
   定位手段：读 V8 报的 `file:line:col` 按列切源码，别全文 grep `.apply`（命中的多半是 decoy 死分支）。
4. **坑：为了 fidelity 引入真 jQuery，结果卡在 `Cannot read properties of null (reading 'checked')`**
   → 正确做法：真 jQuery 的 support 检测硬依赖 `innerHTML` 物化 + `getElementsByTagName` +
   `document.implementation.createHTMLDocument`。要么把这些补齐，要么别引真 jQuery（先用桩拿到 writer 再决定）。
   引依赖前先想清楚：**引入真库 = 同时引入它对 DOM 的全部要求**。
5. **坑：所有 `HTMLXxx` 构造器共享 `Object.prototype`，`instanceof` 恒真，分支与真机不一致却看不出来**
   → 正确做法：原型分层 `Object ← Node ← Element ← HTMLElement ← HTMLXxx`，每标签独立 prototype。
6. **坑：`jsjiami.com.v7` 页面里按字面量搜 `.apply` / `fetch(` 定位链路**
   → 正确做法：这些字符串多数在死分支（引用 `QOQO0QQ` 等未声明量，执行即 ReferenceError）。
   以 trace 的 `stack.file:line:col` 为唯一入口反向切源码。
7. **坑：站点自己的 VM 对约 4% 的 `(page,t)` 组合抛 `Q0OQO0O.apply is not a function`（同一 `t` 稳定复现），
   看起来像"沙箱不稳定/补环境不彻底"**
   → 正确做法：拿还原出的算式对**同一批失败输入**打真实接口，返回 200 即判为站点客户端缺陷，转纯算主路径。
   题面「如果页面数组无法显示请重新从首页访问即可」就是它的用户可见形态——
   **不要**把目标自身缺陷当环境问题无限加桩（详见 规则 47）。
8. **坑：ruyipage `run_js` 里 `typeof window.loadPage === 'function'`，但 `window.loadPage(2)` 报 not a function、
   `window.eval('loadPage(2)')` 报 not defined**
   → 正确做法：`run_js` 的求值 realm 与页面主 world 不同，别指望代打页面函数取多页样本；
   多样本靠 `capture` 的 url 列表或 trace 的 `xhrNative.url` 拿。
9. **坑：把还原期沙箱（740 行环境桩 + 193KB 官方 JS 副本）留在 `result/` 当"改版探针"，`check_code_quality.js` 直接判失败**
   → 正确做法：算式一经"真机样本 + 黑盒"双对拍确认，交付只留纯算模块，沙箱挪 `case/tools/` 当可复跑对照器。
   既符合单入口/最小依赖，也避免交付物携带补环境主体。

## 可验证事实清单（经验资产）

1. `m` 长度 40、字符集 `[0-9a-f]`，算法为 **SHA-1**（非 MD5/SHA-256/RIPEMD-160）。
2. `m = SHA-1("fu" + "/api/problem-detail/12/data/?page=" + page + t)`，输入是**未注入签名前的相对 url**（不含域名、不含 `m`/`t`）。
3. `t` = 客户端 `Date.now()` 毫秒（13 位），与服务端接收时刻差 < 1.1s；换 `t` 必须重算 `m`。
4. `page` 明文、不参与任何编码；请求参数顺序恒为 `page, m, t`。
5. 8 组真机 `(page,t,m)` 样本（含 page 1 与 2）全部被纯算式逐字节复现，0 不匹配。
6. `m` 只依赖 `(page, t)`，服务端可用请求内已有信息复算 → **无不可复算随机量**（若沙箱输出含随机量，即分支走错）。
7. 签名注入点是 `jQuery.ajax` 被换成 204 字符 interpreter 蹦床（真机 `String(jQuery.ajax)` 实测），
   挂载成员名可在常量表里核对：`originalAjax` / `requestInterceptors` / `addRequestInterceptor`。
8. `crypto-js.js`（91728B）由模板无条件引入，但 `pagination12.js` 与 `crypto-js.js` **同栈记录 0 条** → 与签名链无关。
9. 目标域无 JS 写签名 cookie：`cookieWrites` 只有百度统计 `Hm_*` / `HMACCOUNT`。
10. `pagination12.js` sha256 = `175c5874a3d157b38fafd188e70a9a7258f81603b28ebaa3215e33f60354a310`（53987B）；
    `jquery-3.6.0.min.js` sha256 = `3c61a8785a00adb9a53f9e5579821d1e338608743767d817c1d887566f781133`（139002B）。
11. 数据**按时间窗轮换**：同会话相隔约 13 分钟的两批运行，答案 94522 → 94544，第 1 页数组整体替换
    （与同站题1「6 轮恒定」相反 → 同站不同题不可外推）。
12. 提交成功回执 `{"status":"success","message":"答案正确，加10积分..."}`；重复提交返回
    `{"status":"info","message":"你已经完成过这道题目了..."}`（协议层仍 200）。
13. 频率阈值沿用同站题1 实测：约 60 请求/30s 触发业务层 403（JSON 体非 HTML）；`pageDelayMs=120` 时单轮 21 请求 ≈3.3s。
14. 详情页服务端渲染 `let isAuthenticated = true` 可作会话验活，无需额外探活请求。
15. 题号 → 挑战脚本分派（`document.html` 内联块）：11→`encrypt.wasm`、12→`pagination12.js`(JSVMP)、
    13→`jqueryxhr.js`、14→`xhr.js`、16→`PcSign.js`、18→`actoken.js`、19→`19pro.js`；各题另有独立 `pagination{id}.js`。

## 变体与未决

- 常量表里还有一个 `"aa"` 盐值**未**出现在请求侧输入式中，推测服务于其它题号或响应侧拦截器
  （表内同时存在 `responseInterceptors`）。若站点日后把它并入请求侧输入，本算式失效——
  复跑对照器（`case/tools/jsvmp/sandbox.js` 等价物）即可立刻给出差异，而不是在服务端拒绝码里猜。
- 交付主路径为纯算，因此**不受**第 7 条站点自抛影响；对照器遇到该类样本按设计跳过而非误报。

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/tooling/ruyitrace-cheatsheet.md` | jscall 明细 `args` 直读 VM 常量表；与 `MOZ_DOM_JSVMP_CONST_SLOT` 的选用次序 |
| `references/env/env-debug-loop.md` | `run_with_trace.js` 两个静默致死形态（缺 `window` / `setTimeout` 桩不执行回调）与收敛标准 |
| `references/workflow/experience-rules.md` | 规则 47（目标签名器自身抛错 ≠ 补环境不足）；规则 4/绝对规则 4 JSVMP 黑盒边界；规则 36（数据窗轮换按聚合值判别） |
| `references/crypto/algorithm-families.md` | 40 hex → SHA-1/RIPEMD-160 同长度族，须由常量表/IV 定族而非长度 |
| `cases/wasm-zero-import-linear-signer-mashangpa-p11.md` | 同站上一题（wasm 黑盒），本题的"真机 oracle 对拍"方法来源 |
| `cases/webpack-ob-hmac-sha1-mashangpa-p9.md` | 同站 trace 常量命中法（搜签名前缀常量直击构造点）的前例 |
| `cases/yuanrenxue-match28-jsvmp-rsa-purecompute.md` | 同类"JSVMP 但可纯算"路线（字节码字面量直读 → 纯算，不跑 VM） |
