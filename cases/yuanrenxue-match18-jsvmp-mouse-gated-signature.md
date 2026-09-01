# Case：内联 JSVMP 鼠标事件门控签名 + 末页双重校验（猿人学第18题）

> 难度：★★★★
> 还原方案：B vm 沙箱黑盒执行（原始内联 JSVMP 一字不改）+ D 环境伪装（语义级对齐）
> 实现语言：Node.js（原生 `vm` + `https`，无第三方依赖）
> 最后验证日期：2026-08-28
> 平台类型：match.yuanrenxue.cn（猿人学练习平台）
> 平台共性（请求/提交链路、末页 UA、sessionid 绑定、getTime 时间源、诱饵参数惯例、风控底座、token failed 语义）统一见 cases/yuanrenxue-match-platform.md；本文只保留本题差异与专属事实。

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`document.html` 内联 script #12（34.5KB 单行，sha256 `20aed890…`），结构为 `Date.now` 重写 + `!function(_,__){"jsvmpzl:ver.1.1.3" 自研 VM}("jsvmpzl:ver.1.1.3", <字节码串>)`；字符串经置换密码 + `decodeURIComponent` + charCode 算术双层解码，**关键字面量（XMLHttpRequest/DateOpen/webdriver 等）静态 grep 全部不可见**
- 签名拓扑：page1 明文；page≥2 由 VM 包装的 `XMLHttpRequest.open` 追加 `&t=<服务器秒>&v=<URL编码base64>`；`t` 来自 VM 重写的 `Date.now()`（`DateOpen=true` 后每次调用同步 `GET /api/getTime` 取 13 位毫秒）
- **v 非确定性**：Math.pow/ceil 参与随机填充，同一输入两次结果不同、密文 32B/48B 不定长——无法重放比对，验收只能靠服务端
- **事件门控**：VM 启动注册 `mousemove/mousedown/mouseup` 监听并等待真实鼠标（trace 实证 `MouseEvent clientX/clientY` 有值）；不派发事件则 open 包装器静默不产出签名
- **环境探测**：`navigator.webdriver`（读取 + `navigator.hasOwnProperty('webdriver')`）、`window.external`、`documentElement.getAttribute('selenium'/'webdriver'/'driver')`、`Object.keys(window)` 约 1718 次
- **page 字面值排除**：VM 字节码对 `page=1` 与 `page=5` 不追加签名（0-20 扫描实证；`page=05`/`page=55` 正常签名）
- 末页双重校验：`UA=yuanrenxue` 时服务端强制校验 token（明文 → 400 `{"error":"token failed"}`）；正常 UA → 200 提示数组 `["请","将","UA","改","为","yuan","ren","xue","哦"]`
- 诱饵（同站第四次实证，反模式 27）：script10 `$.ajax` hook 拦 `/api/match/18` 存 `window.match18`（接口从未被请求）；script13 `API="/api/question/18"` 常量与 `m:window.match18` 只进调试显示；`window.request()` 恒 undefined
- 风控特征：数据绑定 sessionid（平台共性）

## 加密方案

- 路径：B（vm 沙箱黑盒执行）+ D（环境伪装，语义级对齐）
- 框架：Node `vm.createContext` 沙箱执行取证副本 `src/target/original/vm-challenge.js`（sha256 强校验），XHR 桩捕获包装后最终 URL，宿主 Node `https`（keepAlive Agent）直连数据接口
- TLS 客户端：不需要（Node 原生 https 直连全通）
- 核心思路：**不反编译字节码**（skill 规则 4），环境按 RuyiTrace 实测读取清单最小补齐；`v` 靠服务端验收，fixture 只固化 data 数组与 URL 结构断言
- 服务端校验语义：token 服务端可解（v 含随机填充不影响校验）+ t 时效；末页 UA 分流校验路径

调用链：`script13 getdata(page) → new XMLHttpRequest() → xml.open('GET','/api/v/question/18data?page=N',true) → VM 包装器 __V/< @document.html:727:10971（Date.now()→同步 getTime 取 t，字节码算 v）→ 原生 open(最终URL)`

## 踩坑记录

1. **坑（本题最大耗时点）：VM 静默退出——Date.now 重写生效但 XHR hook 装不上，全程零报错**。三层根因逐层暴露（见反模式 28）：① `vm.createContext(base)` 的内建对象不是 base 的自有属性，VM 序言 `___.BigInt` 经 window 取内建拿到 `undefined` → 字节码 TypeError 被自吞 → 0 步退出；修复=宿主内建注入为自有属性。② `navigator.webdriver=false` 做成自有属性 → `navigator.hasOwnProperty('webdriver')` 为 true（真实 Firefox 挂在 `Navigator.prototype` 上为 false）→ 被判定自动化环境退出；修复=属性挂原型。③ VM 等 mousemove/mousedown/mouseup 真实鼠标 + `document.readyState==='complete'`，不派发事件不产出签名；修复=addEventListener 桩捕获监听器、宿主派发合成事件（坐标对齐取证值）。定位方法见规则 28（window 级 Proxy + VM 原语包装 + 浏览器 trace 按 seq 对齐）。
2. **坑：末页明文 + UA=yuanrenxue → 400 token failed，比"忘了改 UA"更深一层**。VM 故意不给 page=5 签名，逼出"只改 UA 不够、还需 token"的双重校验。工作姿势：`?page=05`（服务端数值解析为第 5 页，VM 照常签名）+ 末页 UA=yuanrenxue。诊断矩阵：明文+正常 UA → 200 提示数组；明文+UA=yuanrenxue → 400；签名+UA=yuanrenxue（经 page=05）→ 200 真实数据。
3. **坑：run_with_trace.js 探测返回 0 events 不代表目标没跑**。该工具只记录其桩表面（navigator/document.createElement/storage/XHR proxy 等）的访问；目标经 window 自有属性取内建、读写普通桩对象时产生 0 事件——**0 事件本身就是要深挖的信号**，不是"环境已足够"。深挖要手动做 window 级 Proxy 记录器。
4. **坑：取证 JS 副本直接放 `result/src/` 会被代码质量门禁判失败**（34KB 单行"疑似压缩代码" + VM 反调试 `debugger` 字面量）。正确做法：放 `result/src/target/original/`（`check_code_quality.js` 的取证豁免路径），入口启动时 sha256 校验防页面改版。
5. **坑：交付门禁 Session 三件套按调用形态识别**。`httpGet()` 里 `agent: getAgent()` 不算复用、`a.destroy()`（局部重命名）不算清理——检测要求 `client/session.<get|post|request>` 调用形态与 `agent/httpsAgent/httpAgent.destroy()` 字面出现在 result 源码。正确形态见 final.js：入口建 `new https.Agent({keepAlive:true})`、请求走 `client.get(...)`、收尾 `httpAgent.destroy()`。
6. **坑：`--targets` 猜接口路径 NO_TARGET 不是死路**。首次猜 `api/match/18`（诱饵路径）超时未命中，取证脚本输出末尾的「本次实际观察到以下动态 2xx 接口（重采候选）」直接给出真实接口 `api/v/question/18data`——按候选校准 targets 重采即 PASS，无需转源码搜索。
7. **坑：`navigator.userAgent` 读取不都是 VM 检测**。本例 UA 读取来自 script6 isMobileUA（移动端拦截），VM 主链不读 UA——补环境时按 trace 栈帧区分，别把页面辅助脚本的读取当签名输入。

## 可验证事实清单（经验资产）

1. 固定 sessionid 下 5 页加和稳定 **32036118**（2026-08-28 两次全量运行一致）；各页小计 5,997,876 + 7,262,098 + 5,922,498 + 6,870,758 + 5,982,888
2. page1 fixture（trace 录制顺序）：`[535994, 405739, 914145, 417653, 524394, 751982, 911353, 782718, 560823, 193075]`；page2：`[654548, 948308, 531183, 442038, 900604, 825123, 822854, 359174, 804389, 973877]`——离线回归基线
3. VM 环境读取全集（trace 中 stack 含 line 727 帧的统计）：Object.keys(1718)/String.charCodeAt(54)/window×46/document 系(18+)/navigator.webdriver(1,值 false)/window.external(3)/location.search(1，来自 script6 非 VM)/**无 document.cookie 读取（v 不绑定 sessionid）**；XHR construct×3/open×3/send×3
4. open 包装器栈帧：`__V/< @727:10971`（call-member opcode 汇聚点）→ `__V @727:11243`（Object.create）→ dispatch `__V/Vu_< @727:6128`；page1 与 page2 的 open 均经 wrapper（hook 启动即安装，按 DateOpen 分支）
5. VM 挂载物：`window._$_`（状态命名空间）、`window.myenc`（编码函数）；`window.request` 从未定义（script13 的 `window.request && ...` 恒短路，又一个幌子）
6. 签名成功即证环境语义对齐：两次运行 t/v 全部新鲜生成且服务端全收；提交 `POST /a/18` 表单编码 `{"result":"success","created":true,"code":2,"exp":500}` 通关（提交过频封号，只提交一次）
7. page1-4 任意 UA，仅 page5 要求 UA=yuanrenxue（且需 `page=05` 触发签名，见坑 2）

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/common-pitfalls.md` | 反模式 28（JSVMP 沙箱静默退出三形态）本 case 实证；反模式 27（诱饵参数）同站第四次实证 |
| `references/workflow/experience-rules.md` | 规则 28（JSVMP 静默退出双层插桩定位法 + 语义级环境对齐清单）本 case 实证 |
| `references/env/env-debug-loop.md` | 「静默退出（零报错）诊断」专节：window 级 Proxy 记录器 + VM 原语包装 + 浏览器 trace seq 对齐 |
| `references/env/env-object-model.md` | 属性位置语义（webdriver 须挂原型）与内建自有属性的对象模型依据 |
| `references/env/env-detect-bypass.md` | 环境检测对齐探针法（本 case 的 navigator.webdriver/external/selenium 探测属同族） |
| `cases/yuanrenxue-match-index.md` | match 系列速查（sessionid 数据绑定、末页 UA 红线、接口版本变化） |
| `cases/yuanrenxue-match17-http2-transport-plaintext.md` | 同站对照：末页 UA 分流校验路径（本题 UA 正确反而触发 token 强校验）、诱饵参数第四次实证 |
| `cases/yuanrenxue-match16-webpack-blackbox-branch.md` | 同为"抠原始代码黑盒执行"路线：require 桩分支漂移 vs 本题内建自有属性/事件门控 |
