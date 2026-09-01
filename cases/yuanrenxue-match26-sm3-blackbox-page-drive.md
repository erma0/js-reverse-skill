# 猿人学 match26：SM3 魔改 token（26.js 原码黑盒执行 + 页面自驱动翻页）

- 验证日期：2026-08-31
- 域名：match.yuanrenxue.cn
- 题型：接口 `/api/question/26?page=N&pageSize=10&kw=&token=<64hex>&now=<ms>`；
  token = SM3 魔改('/api/question/26' + now + page)，now 来自 GET /api/getTime（每次翻页重新取）
- 策略：B vm 沙箱黑盒执行原 26.js（环境分支逐项对齐）+ 页面自驱动翻页签名；Node https 直连无 TLS 校验
- 答案：29597657（提交 POST /a/26 表单编码，code=2 通关）

> 平台共性（请求/提交链路、末页 UA、sessionid 绑定、getTime 时间源、诱饵参数惯例、风控底座、token failed 语义）统一见 cases/yuanrenxue-match-platform.md；本文只保留本题差异与专属事实。

## 与 match21 同族（强复用）

26.js 与 match21 的 match3.js 同源 SM3 魔改家族，魔改点一致：
SS1 掩码 `(q & 0xFCFFFFFF) >>> 0` 再 rotl 7、tt1&0xfffffffa、tt2&0xffafffff、
strToBytes 字节偶数化 `k & 0xfe`（条件 typeof __dirname=='undefined' && print native）、
T 常量环境分支（String(Date.now)=='function now() { [native code] }' → 0x7d123d8f，否则 0x7c179d8a 诱饵）、
方法命名 reg/strToBytes/sum/_compress/_expand/_fill/_ff/_gg/_rotl。

**差异**：26.js 把 4 组检测扩成 8 组环境分派 IV（reg[0..7] 分别检测
String(Document/Window/Navigation/Location/FocusEvent/require/Node/HTMLDocument) == 'function XXX() { [native code] }'，
typeof require 为 undefined 时 reg[5]=0x151137ad），并在 _compress/_expand 增加掩码分支
`document.__proto__ === HTMLDocument.prototype ? 0xfcffffff : 0xfceeeeee`。
真浏览器分支值：reg[0]=0x7380067c、reg[1]=0x7634d2c9、reg[2]=0x170042d6、reg[3]=0xda887534、
reg[4]=0xa10c30bc、reg[5]=0x151137ad、reg[6]=0xe37caa4d、reg[7]=0xeeeb0f4e。

## 关键坑点（均可复用）

1. **取证浏览器 token 必 403**（sessionid 带上也一样）——Firefox 内核走诱饵分支。
   不要在取证阶段无限重采；target-hits 的 URL+参数结构仍是 Step 1 有效证据（接口路径确认），
   签名正确性交给 trace+沙箱+REAL_VERIFY 真实 API 验证（5 页全 200 即证）。
2. **AST 反混淆产物禁执行**：解码器 h 含 toString 自引用（`q = o + i`，`q['charCodeAt'](u + 0xa)` 读自身源码），
   detect-patterns 旧版漏报该形态（只匹配"拼接右侧变量自身被 charCodeAt"）——2.3.90 已补"拼接结果被 charCodeAt+偏移"检测。
   解字符串表用「原码执行 + __probe 入口 dump h 映射」最稳：h 是顶层 hoisted 声明，顶层在 UI 构建处炸了也能在
   errors 吞错后从 --entry 拿到 h，dump 0xc7..0x340 全部字符串。
3. **obfuscator 自保护 setInterval**：文件尾反调试 IIFE `d.setInterval(c, 0xfa0)` 在 vm minimal bootstrap 下
   ReferenceError——补空 setInterval/clearInterval/setTimeout 桩即可，不影响主流程。
4. **顶层 UI 构建必须桩全**：26.js 顶层 getElementById→replaceChildren→createElement 一串构建分页控件，
   再 querySelector('meta[name="match_num"]').content 取题号 '26' 拼接口路径。
5. **jq 桩按 selector 缓存对象 + on() 记录 handler + 手动触发翻页（页面自驱动）**：signer 用
   `__click('#pgxNext')` 驱动 26.js 自身 `A(m+1)` 翻页链产出全部 5 页签名——天然复用页面页码计数器/状态，
   比自写翻页循环可靠（match26 实证）。$.param 必须丢 undefined（m 诱饵参数由此消失）、$.add() 必须有。
6. **strToBytes 偶数化的连锁效应**：page '2'/'3' → 0x32、'4'/'5' → 0x34，同 now 下 page2/3、page4/5 token
   **成对相同**——不同 now 不同 page 仍成对相同。真浏览器与服务端重算一致，**不是沙箱 bug**。
   诊断顺序：先做字节级分析（掩码/偶数化/取模折叠）再怀疑环境分支。
7. **sessionid 时效**：取证+分析 40+ 分钟后 sessionid 过期（/api/user isLogin:false，POST /a/26 还主动清 sessionid cookie）；
   数据接口不校验登录仍 200 容易误判登录态。**提交/写接口前先 GET 会话状态接口验活**；答案绑定 sessionid，换会话必须重跑全流程。
8. **环境桩拆独立文件**：交付时沙箱桩要拆成独立模块（如 src/sandbox-env.js + fs.readFileSync 注入），
   不要用大段模板字符串内嵌——check_code_quality 的「大段 *_SCRIPT 字符串」红线会判 FAIL（match26 返工点）。
9. 诱饵三件套（capture.json 真实 URL 反查识别）：m:window.matchnumber（/api/match/number 从未发出）、
   window.request、Accept-Time 头（XHR hook 只对 URL 含 'match' 的请求加头，数据 URL 不含）。
10. 数据接口答案口径：题目"遍历整卷五页"= 5 页全拉取，每页 10 个纯数字累加；末页 UA=yuanrenxue。
