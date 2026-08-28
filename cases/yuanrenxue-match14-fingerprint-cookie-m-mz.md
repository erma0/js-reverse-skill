# Case：指纹数组 Cookie m/mz + 确定性哈希签名（猿人学第14题）

> 难度：★★
> 还原方案：B vm 沙箱补环境（持久沙箱 + 每页 eval 动态 api2）
> 实现语言：Node.js（vm + fetch）
> 最后验证日期：2026-08-28
> 平台类型：match.yuanrenxue.cn（猿人学练习平台）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：页面加载静态混淆 `m.js`（553KB，jsencrypt 公钥内嵌）；`GET /api2/14` 每次返回动态混淆 JS，`eval` 后定义 `v14`/`v142`，参与每次签名
- 参数特征：Cookie 双参数——`mz = btoa(z)`（z 为 53 字段指纹数组：navigator 25 + screen 9 + location 19，字段顺序与 m.js 中 z 构造一致）；`m = md5hex|b|a|n`
  - `b` = `Date.parse(new Date())`（毫秒时间戳）；`a` = `b * 8`
  - `n` = `window.n` 计数器（m.js 初始 0，每次 `sp()` +1，pageN 时 n=N，**跨请求累积**）
  - `aa` = `m5(RSA_encrypt(b))`（RSA PKCS#1 随机 padding，服务端不可复算）；`bb` = `m5(b)`
  - `md5hex` = `m5(gee(aa, bb, v14, z.toString(), v142, b64_zw))`
- 混淆特征：无 jsjiami/obfuscator 家族标记，纯体积混淆（553KB 单文件）；m.js 与 14.js 均有 `window = {}` / `delete document` 式全局覆盖环境检测
- 请求特征：`GET /api/question/14?page=N&pageSize=10&kw=`；**page5 要求 UA=yuanrenxue**（否则返回提示文案数组而非 400）
- 反调试特征：eval 动态代码 + 全局对象覆盖检测
- 风控特征：数据**绑定 sessionid**（数字答案随登录用户变化）；无蜜月期开窗要求

## 加密方案

- 路径：B vm 沙箱补环境
- 框架：Node.js 内置 `vm` + `fetch`（原生 https 直连，无 TLS 指纹校验）
- 核心思路：vm 执行静态混淆 m.js 一次（持久沙箱），每页请求前 `GET /api2/14` 取动态 JS eval 进同一沙箱，调 `sp()` 让 `n` 递增，取 `m`/`mz` 后带 sessionid + page5 UA=yuanrenxue 拉数据
- 服务端校验语义：解码 `mz` 指纹数组 → 用 v14/v142 + RSA(b) 重算 `md5hex` → 与 `m` 比对。**只校验 mz 与 m 的同源自洽性**，不要求指纹与真实浏览器逐字节一致

## 踩坑记录

1. **坑：Firefox/ruyipage 下全部 API 400 `{"error":"token failed"}`** → 该站做了 UA 检测（页面提示需 Chrome），RuyiTrace 采到的全是**被拒响应**，不能当成功证据。正确做法：取证前先确认终态接口 2xx；取证浏览器被拒时核对拒绝原因 → `--ua` 重采 → 仍全 4xx 即疑似引擎级检测，走 `BLOCKED_FORENSIC` 用 MCP 真实 Chrome 抓包（本次即用真实 Chrome 导出 reqid=23 成功样本含 m/mz 真实值）。
2. **坑：每页重建 vm 沙箱重新执行 m.js → `n` 恒为 1 → page2+ 全部 400**（page1 碰巧 n=1 通过，极具迷惑性，容易误判"算法对了，后面是会话/TLS 问题"）。正确做法：**持久沙箱**——m.js 只执行一次，每页 eval 新 api2 后调 `sp()`，让 `n` 自然递增（详见反模式 24）。判别信号：多请求场景"第 1 次成功、第 2+ 次失败"，先 diff 两次签名输入字段定位被重置的量。
3. **坑：page5 用 UA=yuanrenxue 后仍 400** → 指纹 UA 未同步。`mz` 指纹数组内含 navigator.userAgent，**请求 UA 改了什么，沙箱指纹 UA 必须同步改**，否则 mz↔m 不自洽 → 400。page5 时沙箱 `navigator.userAgent` 也须为 `yuanrenxue`。
4. **坑：mz 指纹字段错位 → 静默 400** → 53 字段顺序必须与 m.js 中 `z` 数组构造一致，任何字段错位导致 md5hex 不匹配。从 trace/m.js 静态读 `z` 构造顺序，不臆造顺序。
5. **坑：沙箱内 `window`/`navigator`/`document` 被 eval 动态代码覆盖** → m.js/14.js 有 `window = {}`、`delete document` 环境检测，普通赋值会被真的换掉全局对象（症状 `sandbox.window !== sandbox`）。正确做法：`Object.defineProperty` 只读 getter 保护 14 个全局名（window/self/top/parent/frames/navigator/document/location/screen/history/localStorage/sessionStorage/crypto/performance），写入被吞并记录（`run_with_trace.js` 已内置此保护）。
6. **坑：签名含 RSA 随机 padding 仍枚举算法组合** → `aa` 是 RSA PKCS#1 随机 padding 的产物却深度参与 `md5hex`，服务端无法复算——说明沙箱走进了**错误分支**（某环境探测点返回值不同），继续枚举拼法是无用功。正确做法：转 DIAGNOSE，从随机量产生处回溯最近分支条件，逐个对照环境值（详见反模式 23）。

## 可验证事实清单（经验资产）

1. 固定 sessionid 下求和稳定 **31256141**（sessionid `p4av26i0hl3t4dar70r5icog4vytlguo`，2026-08-28 实测）；数据绑定 sessionid，换登录用户答案变化
2. 连续 3 次全量运行 5 页全部 HTTP 200，响应均为 10 个数字真实业务数据
3. 自洽性实证：vm 沙箱指纹（UA 147 / colorDepth 32）与真实 Chrome（UA 151 / colorDepth 24）53 字段中 4 处差异，服务端照样接受——**服务端只校验 mz↔m 自洽，不校验与真实浏览器一致**（规则 25）
4. 每页重建沙箱（n 恒 1）→ page1 200、page2-4 400；改持久沙箱后 5 页全通——反模式 24 判别信号
5. page5 UA=Chrome 返回 `["请","将","UA","改","为",...]` 提示数组（非 400）；UA=yuanrenxue 且指纹同步后返回真实数据
6. `window.n` 与请求序号强对应：pageN 请求 m 末段 n=N，可作签名正确性自检

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/common-pitfalls.md` | 反模式 23（签名含服务端不可复算随机量 → 分支判定失败信号）+ 反模式 24（请求序号计数器随沙箱重建被重置）本 case 双实证 |
| `references/workflow/experience-rules.md` | 规则 25（指纹对齐验收线是"参数自洽"非"逐字节复刻"）+ 规则 22（黑盒执行禁缓存复用） |
| `references/env/env-detect-bypass.md` | 取证侧引擎级检测（ruyipage Firefox 被拒 → BLOCKED_FORENSIC + MCP 真实浏览器兜底）+ 对齐探针法（被校验差异位才需对齐） |
| `references/tooling/browser-acquisition.md` | BLOCKED_FORENSIC 浏览器 MCP 兜底通道（真实 Chrome 抓成功样本） |
| `references/network/cookie-generation.md` | 指纹 / challenge Cookie 分类（依赖 navigator/screen/location 的本地算法指纹） |
| `cases/yuanrenxue-match9-dynamic-cookie2.md` | 同源题型：match9 单 cookie m（RSA+循环前缀），本题升级为 m/mz 双 cookie（指纹数组），方法论可复用 |
| `cases/yuanrenxue-match-index.md` | match 系列速查（sessionid 数据绑定、末页 UA 红线、各题风控配置独立） |
