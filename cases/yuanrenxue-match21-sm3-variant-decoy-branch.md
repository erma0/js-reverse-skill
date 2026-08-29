# Case：SM3 变体 + JSVMP 环境分支诱饵变体 + Firefox 内核毒化（猿人学第21题）

> 难度：★★★
> 还原方案：A 纯算还原（SM3 变体常量自真机提取）+ B 最小沙箱（过程工具与对拍基准）
> 实现语言：Node.js
> 最后验证日期：2026-08-29
> 平台类型：match.yuanrenxue.cn（猿人学练习平台，match2023 第三题「守心」等效移植）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`https://download.python-spider.com/match2023/corejs/match3.js`（525561B 单行，sha256 `73268ed2b454656bc129edaee507244d41c0f57515dcfbb78c9b9ee132b81b11`，静态资源三次拉取一致）；JSVMP while-switch 解释器 + 字节码数组（`i(l,C,...)`）；顶层自暴露 `window.SM3`（构造器）、`window.sm3Digest`（hex 入口）、全局 `call(page)`；开头伪造 `Navigation.toString`（`'function Navigation() { [native code] }'` 字面量）
- 参数特征：`POST /api/question/21` body `page=1&pageSize=10&kw=&token=<64 位 hex>`；请求头 `accept-time: <服务器毫秒>`（match3.js 自设，非 jQuery headers）
- 页面 hook（document.html 内联，题目设计的适配层）：① `XMLHttpRequest.open` 把 `/api/match2023/3` 改写为 `/api/question/21` 并标 `this._o`；② `setRequestHeader` 记录 `Accept-Time` 到 `this._t`；③ `send` 拦截 `_o` 请求解析 body 后转调页面 `req(obj)` 由 jQuery 重发；④ `String.prototype.indexOf` 让 `'/api/question/21'.indexOf('match')` 返回 true（骗过 match3.js 的 URL 含 match 校验）；⑤ `Date.now` 重写为同步 `GET /api/getTime`（每次调用实时取值）
- 时间源双轨：match3.js 既有 `Date.now()`（hook 后每次实时）又有**直接同步 XHR getTime**——trace 实证 Accept-Time 头值 `1787960032933` 不等于任何一次 `Date.now` 返回值（32659/33488/33496/...）
- 风控特征：数据绑定 sessionid；末页 UA=yuanrenxue；提交 `POST /a/21` 表单编码 `{answer}`，`code=2` 通关
- **服务端拒绝语义分叉（本题最坑）**：Firefox 内核（含 ruyipage 取证浏览器）访问时**浏览器自己发的请求也 400**（页面显示「接口异常」）；Chrome 真机 200 正常——match3.js 按 Function.toString 环境自检结果走**双算法变体**（见踩坑 1）

## 加密方案

- 路径：A 纯算还原（最终交付）+ B 最小 JS 沙箱（黑盒执行 match3.js 作对拍基准与过程工具）
- 框架：Node 原生 `vm`（沙箱过程件）+ Node `https`（keepAlive Agent）
- TLS 客户端：Node 原生 https（本题未被 TLS 策略拦截，与 match19 不同；curl_cffi chrome124 也被拒时先排查 token 内容而非传输层）
- 核心思路：`token = SM3变体(str(服务器毫秒) + str(page))`，`Accept-Time` 头传**同一时间值**（服务端重算比对）；SM3 变体常量自 Chrome 真机 `window.SM3` 行为提取

### SM3 变体完整常量（Chrome 真机分支，2026-08-29 提取）

- IV = `7380067c 7634d2c9 170042d6 da887534 a10c30bc 151137ad e37caa4d eeeb0f4e`
- T(j<16) = `0x79dd4519`，T(j≥16) = `0x7c179d8a`
- SS1 = rotl(((rotl(A,12) + **rotl(Tj, j)** + E) & **0xFCFFFFFF**), 7)——注意 **Tj 先循环左移 j 位**（rotl 0..63 各出现一次，ops 序列实锤），整体再移 7
- tt1 = (FF_j + D + ss2 + W[68+j]) & **0xFFFFFFFA**；tt2 = (GG_j + H + ss1 + W[j]) & **0xFFAFFFFF**
- E = rotl(tt2,9) ^ tt2 ^ rotl(tt2,17)（P0 标准）；expand/P1 标准（P1 三步同源 x：x ^ rotl(x,15) ^ rotl(x,23)）
- **strToBytes 字节偶数化**：每字节 `c - c%2`（'a'0x61→0x60、'c'0x63→0x62；'b'0x62 不变）——输入串先逐字节偶数化再做标准填充

## 踩坑记录

1. **坑（环境分支诱饵变体——本题核心）**：同一 match3.js 文件、同一输入，Chrome 真机与沙箱/Firefox 产出**不同的 token**。黑盒沙箱观测 `write("17879600329331")` → `sm3Digest(t+page)` 完全自洽、格式正确，但服务端拒绝；扫遍 AcceptTime ±1500ms 窗口也找不到浏览器 token 对应输入。→ 正确做法：**同输入直接对拍真机输出**（`sm3Digest('1787964480457'+'1')`：Chrome=76598cb6... vs 沙箱=53f84e4e...），并用**变体指纹**快速判定分支——`new SM3().reg`（IV 数组）+ `strToBytes('abc')`：诱饵分支 IV[1]=IV[4]=7370067d（重复值）且 strToBytes 标准 ASCII [97,98,99]；真分支 IV[1]=7634d2c9、IV[4]=a10c30bc 且 strToBytes 偶数化 [96,98,98]。反模式 23/29。
2. **坑（外部情报对拍失败 ≠ 情报过期）**：掘金 2023 文章给的 mask（ssr=0xFCFFFFFF/M1=0xFFFFFFFA/M2=0xFFAFFFFF）在沙箱诱饵变体上对拍全部失败 → 误判「文章值过期」转而穷举结构。→ 正确做法：**先怀疑自己环境分支，再怀疑情报过期**——用诱饵分支观测反推的常量去否定外部情报是双重错误；真分支的 mask 恰好就是文章值（反模式 29）。
3. **坑（检测点是 Function.toString native 自检，桩必须 nativize）**：match3.js 初始化对 `Object/Document/Window/Location/FocusEvent/Node/HTMLDocument/print` 及 DOM 方法（getElementsByClassName/querySelectorAll/matches/compareDocumentPosition）做 `toString()` native 特征检测；桩函数是 JS 函数 → 检测失败 → 诱饵分支。→ 正确做法：**每个桩函数 `defineProperty` 伪装 `name` 与 `toString`（返回 `function X() { [native code] }`）**；缺失构造器（Window/FocusEvent/print 等）用 native 样式空壳补齐；获取检测目标清单的方法：Chrome MCP `navigate_page --initScript` 注入 `Function.prototype.toString` 记录器后 reload，diff 沙箱与真机的检测目标集。
4. **坑（DOM 原型链与构造器完整性）**：`document instanceof HTMLDocument` 等 instanceof 分支需要原型链；`HTMLDocument.prototype = document` 会循环 __proto__。→ 正确做法：`HTMLDocProto = Object.create(Document.prototype)`、`setPrototypeOf(document, HTMLDocProto)`、把 createElement 等方法以 native 样式挂到 `Document.prototype`（真 Chrome 里它们定义在原型上）。
5. **坑（时间源双轨 → Accept-Time 同源性）**：match3.js 既有 `Date.now()`（hook 后每次实时）又有直接同步 getTime；token 用的 t 与 Accept-Time 头的值**不同次调用即不同值**，服务端重算失败（浏览器自己 400 的成因之一）。→ 正确做法：脚本侧**单飞缓存**——token 输入与 Accept-Time 头强制同值（`genToken(t, page)` 返回两者）。
6. **坑（Firefox 内核被针对性屏蔽 + 状态机死路）**：ruyipage 取证 ×2 全 400、--ua 覆盖无效、Node/curl/curl_cffi 全 400，浏览器（Firefox 真内核）自己也 400。想用 Chrome MCP 取成功样本时 `DIAGNOSE → BLOCKED_FORENSIC` 被状态机判非法跳转、`--guard mcp` 因未过 BLOCKED_FORENSIC 拒绝——**卡点只能靠用户指引绕过**。→ 正确做法：2.3.87 起 state_machine 允许 `DIAGNOSE → BLOCKED_FORENSIC`（取证浏览器毒化证据 + 用户确认）；确有检测证据（浏览器与沙箱同输入不同输出、toString 检测清单）时主动向用户对齐请求 Chrome MCP 对照，不要在诱饵变体上空转。
7. **坑（校准脚本的无符号/undefined 陷阱）**：JS 的 `^`/`|` 返回**带符号** 32 位值，diff 脚本里负数与 JSON 数值比较 `!==` 恒 true；`hex(undefined)` 输出 `0x0` 掩盖缺字段；包装 `_rotl` 用 `proto[m].apply` 自引用无限递归（须先存 origs）。→ 正确做法：校准脚本统一 `(x>>>0)` 再比较/打印；包装前先缓存原引用；reg/reg 之外的记录器字段名与 push 的简写属性名保持一致。
8. **坑（forensic 轮转吃掉正在分析的产品）**：第二轮取证把 `document.html` 轮转为 `document.html.prev-1`，分析中途 FileNotFoundError 两次。→ 正确做法：取证完成后立即 `cp document.html.prev-N document.html` 固化，或分析副本放 `case/notes/`。

## 可验证事实清单（经验资产）

1. 固定 sessionid 下 5 页加和恒 **29083835**（2026-08-29 纯算 token 采集 + 提交 `code=2` 通关；重复运行采集结果一致）
2. token 输入输出对拍样本：`('1', 1787964480457) → 76598cb68a8ba099053de686c2064539ad58a57717ff18ef9223d7c46e5a7f2d`（Chrome 真机成功样本，MCP 实测）；`('2', 1787964556010) → 135f01dc0c423ceb3f6d5355a5b865252b779e2428c6a9e83f6527256c9dc826`（页面翻页观测）
3. match3.js 静态：525561B、sha256 `73268ed2...`（三次拉取一致，非动态下发）
4. 分支指纹：真分支 `new SM3().reg` = `[7380067c,7634d2c9,170042d6,da887534,a10c30bc,151137ad,e37caa4d,eeeb0f4e]` 且 `strToBytes('abc')=[96,98,98]`；诱饵分支 reg=`[7380067c,7370067d,170042d6,da887534,7370067d,151137ad,e37caa4d,7370066d 或 7370067d]` 且 `[97,98,99]`
5. Firefox 内核（ruyipage 定制版 155.0a1）访问该页：浏览器自身 POST 400 `{"error":"token failed"}`（非脚本问题，是内核毒化）；Chrome 真机 200
6. Node https / curl / curl_cffi chrome124 发「诱饵分支 token」均 400；发「真分支 token」（纯算）全 200——本题 400 语义是**算法分支**而非 TLS 黑名单（与 match19 相反）
7. accept-time 头为小写即可（HTTP/2 规范化）；Accept-Time 与 token 输入时间必须同值
8. 页面 TP=5/PS=10 写死；题面「试炼步骤」区块为唯一口径来源（全部 5 页求和 + 末页 UA=yuanrenxue + sessionid 绑定）
9. `POST /a/21` 表单编码 `{answer}`：`{"result":"success","created":true,"code":2,"exp":200}` 通关；重复提交 `code=1`
10. match3.js 的 toString 自检目标（Chrome initScript 记录器实测）：Object、getElementsByClassName、querySelectorAll、matches、compareDocumentPosition、Document、Window、Location、FocusEvent、Node、HTMLDocument、print（各 ×3，一致性三连测）

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/env/env-debug-loop.md` | 「环境分支诱饵变体：native toString 自检与桩 nativize」专节（检测清单获取法 + 伪装实现） |
| `references/workflow/common-pitfalls.md` | 反模式 29（诱饵变体 + 外部情报对拍失败先怀疑分支）+ 反模式 23（分支漂移主条目） |
| `cases/yuanrenxue-match18-jsvmp-mouse-gated-signature.md` | 同为 JSVMP 黑盒 + 环境语义对齐（探测属性挂原型），静默退出 vs 本题毒化输出 |
| `cases/yuanrenxue-match19-tls-fingerprint-blocklist.md` | 同文案 `token failed` 不同病因（TLS 黑名单 vs 算法分支），跨客户端栈对照判读矩阵 |
| `cases/yuanrenxue-match14-fingerprint-cookie-m-mz.md` | Firefox/ruyipage 全 API 400 → MCP 真实 Chrome 兜底取证先例 |
| `cases/yuanrenxue-match-index.md` | match 系列速查（末页 UA 第 7 次实证、sessionid 数据绑定、题面试炼步骤区块） |
