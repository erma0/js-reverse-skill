# 经验法则详解（高级手动取证参考）

> 本文件收集手动取证和高级调试场景下的经验法则，作为 RuyiTrace NDJSON 自动采集的补充。默认流程以 SKILL.md 状态机为准，使用统一脚本取证（`forensic_ruyipage.py` + `capture_ruyitrace_log.js`）；以下内容仅在自动采集不足、需要手动介入时参考。文中涉及的 ruyipage 交互式 API（`instrumentation`、`search_code`、`evaluate_js` 等）属于高级手动取证手段，不是默认路线。

## 一、Hook 安装与入口确认

### 1. Hook 必须在 SDK 加载前安装
签名型反爬的签名函数在 SDK 加载时即注册到拦截器，Hook 装晚了就截不到调用栈。正确做法是用 `instrumentation(action='reload')`：装完 Hook 后一步重载，默认 `clear_log=True` 拿到干净快照，保证 Hook 先于页面 JS 生效。**反例**：裸 `reload()` 不能保证顺序，常丢前几条调用。注意：`pre_inject_hooks` 仅适用于行为型反爬（首屏挑战页 navigate 时装 Hook），对签名型反爬**永远不要用**，签名型需要源码级插桩控制。常用 Hook 不要手写，`inject_hook_preset` 一键覆盖 xhr/fetch/crypto/websocket/debugger_bypass/cookie/runtime_probe。

### 2. JSVMP 寄存器数是分叉判断依据
JSVMP 字节码 dispatch 形如 `u[xxx]: x(offset, t, this, arguments, 0, N)`，尾部 `N`（寄存器数）是区分不同函数的分叉依据。同一 opcode 在不同函数中 `N` 不同、行为也不同。识别 JSVMP 后先用 `hook_jsvmp_interpreter` 观察 dispatch 表，按 `N` 值聚类，能快速锁定目标函数所在分支，避免在全部 case 中盲目 trace。**反例**：只看 opcode 不看 `N`，多个函数混在一起，trace 日志爆炸且无法定位签名函数。这是 JSVMP 双路径决策（路径 A 算法追踪 / 路径 D 环境伪装补环境）的前提判断。

### 3. 环境补丁前必须确认签名函数入口
开始 6 步法的环境采集之前，先用 `search_code` 确认 JSVMP 的签名入口类型：单通道 XHR / 双通道 XHR + fetch / 导出函数 / cacheOpts 初始化。**反例**：不确认入口就补大量环境，最后发现入口是导出函数而非 XHR，补的环境白做。可用 `get_request_initiator(request_id=N)` 直达签名函数，省去大量搜索。双签名场景必须同时 Hook XHR 和 fetch——某些平台 JSVMP 同时改写 `XMLHttpRequest.prototype.open` 和 `window.fetch`，只 Hook 一个通道会丢另一半签名。Cookie 归因先用 `analyze_cookie_sources()` 区分纯 JS 写入 / 纯 Set-Cookie / JS 算 token + 服务端带回。

## 二、经验资产与离线验证

### 4. case 中的"可验证事实清单"是经验资产
case 文件的价值随实战次数指数级增长：第一次分析某站点写的 case 可能粗糙；第二次分析（升级或变体）时用 case 发现 80% 还成立、20% 变了，就把变化追加到"变体章节"。"可验证事实清单"是核心资产，同站升级时逐条核对找出"哪些变了"。**示例**：case 记录"签名函数位于 acw_sc.2.js 第 12 万行附近的 dispatch"，升级后核对发现位移到第 15 万行但函数特征不变。EVIDENCE_GATE 指纹匹配时优先检测 `cacheOpts` 和 `X-Gnarly` 区分 SDK 变体（单签名 vs 双签名、bdms.paths vs cacheOpts）。

### 5. `verify_signer_offline` 是协议代码的 unit test
把签名算法移植成 Python/Node 协议代码后，用 N 个真实样本（含原始输入 + 浏览器产出的签名）离线验证，字符级定位首个偏差点。这是协议代码的 unit test——只要有一个样本不过，就说明算法有 bug。**反例**：只拿一个样本跑通就交付，结果线上偶发失败（时间戳精度、随机串字符集差异）。注意事项：样本要覆盖不同时间窗、不同参数长度、不同用户态，才能逼出边界 bug。把它当作 CI 门禁，协议代码每次改动都跑全量样本。

### 6. 想放弃时先回查 cases/ 和 common-pitfalls.md
绝大多数"想放弃"是踩了已知反模式。降级梯度必须逐级走：`instrumentation(mode="ast")` → 失败 → `mode="regex"` 覆盖率不足 → `hook_jsvmp_interpreter(mode="transparent")` 日志太少 → `mode="proxy"` 破坏签名 → 路径 D（jsdom 环境伪装）→ 也失败 → 向用户说明。每级至少尝试一次并记录失败原因。**示例**：AST 插桩失败常因严格 CSP，v0.6.0 的 `csp_bypass=True` 可自动绕过。回查 common-pitfalls.md 往往 10 分钟解决卡了 2 小时的问题，不要跳过这一步。

### 7. 命中案例后必须精读踩坑记录并转成检查项
命中经验库后不能直接套用，必须按 SKILL.md 状态机正常走完整流程。IMPLEMENT 编码前逐条回查踩坑记录，将每条记录写成可核对的实现约束和验证项。**示例**：case 记录"该站点 cacheOpts 是新版 SDK 必传项，缺少会导致业务路径未注册、拦截器不触发"，则初始化代码必须传入 cacheOpts，并在验证清单中检查业务路径已注册（旧版只需 `bdms.paths`）。**反例**：只看 case 的算法部分就动手，漏了踩坑记录里的"预热请求注入动态密钥"，跳过 `/api2` 预热导致签名缺密钥。命中后第一步是通读 case 全文，把每条 pitfall 转成 checklist。

## 三、JSVMP 路径选择

### 8. JSVMP 先选路径再动手
识别到 JSVMP 后立即在路径 A（算法追踪）和路径 D（环境伪装/补环境）间决策，不要边做边换。签名型反爬只能走源码级插桩（`instrumentation mode="ast"`）；可在 Node 中加载执行的 JSVMP 优先走路径 D。RS 5/6、Akamai sensor_data、webmssdk 这类"算法全在 opcode dispatch 循环内"的 VMP，`hook_jsvmp_interpreter` 也看不到 switch/case 内部，AST 插桩是唯一能打开黑箱的工具。**反例**：先试路径 D 跑半天发现 JSVMP 有反 jsdom 检测，再换路径 A，前功尽弃。决策依据见规则 2 的寄存器数分析。

### 9. `String.fromCharCode` 是高频信号
VM 解释器大量使用 `String.fromCharCode` 构造字符串（绕开字面量静态扫描），该调用的高密度区往往是字符串构造区，紧邻签名算法。`search_code(keyword="String.fromCharCode", script_url=url)` 能快速定位 dispatch 表附近的代码。**示例**：在某 acw_sc VMP 中，`fromCharCode` 调用密集区往后 200 行就是签名入口。注意事项：单纯 hook `fromCharCode` 会触发太多次，应结合寄存器数（见规则 2）过滤到目标函数后再 hook。其它高频信号词：`prototype.open`、`Object.defineProperty`、`toString`、签名函数名（`X-Bogus`、`_signature`）。

## 四、签名不一致排查

### 10. 签名不一致时逐环节对比
排查链路（逐项对比脚本值 vs 浏览器值）：① 原始输入参数 → ② 参数排序/拼接字符串 → ③ 时间戳（精度：秒 vs 毫秒）→ ④ 随机串（长度、字符集）→ ⑤ 密钥/盐值 → ⑥ 中间摘要 → ⑦ 最终密文（编码方式：hex/base64/自定义）。找到第一个偏差点。**示例**：脚本用毫秒、浏览器用秒，时间戳差 1000 倍。若链路全对仍失败，考虑：服务端静默拒绝（HTTP 200 + 空 body 说明环境指纹不匹配）、预热请求未做（`/api2` 类请求注入动态密钥）、TLS 指纹壁垒（Node 用 `got-scraping`/`curl-cffi-node`，Python 用 `curl_cffi` 模拟 Firefox/Chrome TLS）。

## 五、运行时复用与 Hook 持久化

### 11. Python `execjs` 复用 context
Python 调 JS 签名时，`execjs` 编译一次 context 多次调用，避免每次请求重新创建运行时。**示例**：`ctx = execjs.compile(js_code)` 后多次 `ctx.call("sign", params)`，比每次 `execjs.eval` 快 10 倍以上。**反例**：在请求循环里每次 `execjs.compile`，单次耗时 200ms 起步，QPS 上不去。注意事项：context 内若维护了状态（如计数器、时间窗），跨请求复用要确认状态污染；多线程场景每个线程独立 context，避免共享运行时崩溃。

### 12. Hook 必须持久化 + 防覆盖
JSVMP 常在运行时重新赋值 `XMLHttpRequest.prototype.open` 等原型方法，覆盖掉你装的 Hook。必须用 `persistent=True`（页面导航/重载后自动重装）+ `non_overridable=True`（阻止后续覆写）。**示例**：某平台 SDK 加载后立即 `XMLHttpRequest.prototype.open = nativeOpen`，未加 `non_overridable` 的 Hook 被静默还原，截不到任何调用。注意事项：`non_overridable` 对部分严格检测环境的站点可能被探测到（属性描述符不可写），权衡使用；若站点主动检测描述符，改用实例级覆写。

## 六、工具技巧

### 13. `search_code(keyword, script_url=url)` 定位大文件
JSVMP 文件通常 200KB+，直接读全文件 token 爆炸。用 `search_code(keyword, script_url=url)` 在指定脚本中搜索关键词，返回匹配行 + 前后上下文，精准定位。**示例**：搜 `fromCharCode` 找到 30 处命中，每处给 5 行上下文，比读 20 万行文件高效。常见关键词：`fromCharCode`、`prototype.open`、`Object.defineProperty`、`toString`、签名函数名。注意事项：关键词太泛（如 `function`）命中太多，太窄可能漏，先用 `analyze_cookie_sources(name_filter="目标cookie名")` 缩小范围再搜。

### 14. `compare_env` 是补环境起点
先在 ruyiPage（真实 Firefox 内核）中采集环境基准数据，再用 `evaluate_js` 在 jsdom 中分批采集细粒度值，与基准逐项 diff，差什么补什么。**反例**：凭经验猜缺 `navigator.webdriver`，补了仍报错，实际缺的是 `window.chrome.runtime`。`compare_env` 自动输出 diff 报告，避免盲补。注意事项：ruyiPage 基于 Firefox，原生函数 toString 返回含换行缩进格式（`function name() {\n    [native code]\n}`），与 Chrome（`function name() { [native code] }`）不同，补丁格式必须匹配采集基准浏览器，否则被指纹库识别。

## 七、环境伪装踩坑

### 15. JSVMP 环境伪装优先于算法追踪
如果 JSVMP 只是"签名黑箱"且可在 jsdom 中加载执行，优先走路径 D（采集→对比→补丁），比追踪字节码执行快 10 倍。降级梯度：能 Node `crypto` 解决的不用 `vm`；能 `vm` 的不用 jsdom；能 jsdom 的不开浏览器。**反例**：明明 JSVMP 无反 jsdom 检测，却硬啃 20 万行字节码 trace，3 天没出结果。注意事项：Node vm 沙箱 ≠ 浏览器，部分调试干扰机制只在非浏览器环境触发（`window`/`document`/`navigator` 未定义、定时器行为不同），路径 D 前先确认无 vm 检测，否则补的环境会被识破。

### 16. `Function.prototype.toString` 是第一杀手
jsdom 所有 DOM 方法的 `toString()` 会暴露实际 JS 代码（如 `function() { return this._domImpl.foo(); }`），JSVMP 一调用就识破。必须三层防御：① WeakSet 记录已伪装函数 → ② 实例级覆写（`Object.defineProperty` 单个方法）→ ③ 源码模式正则（批量替换 toString 返回值）。**示例**：补 `document.createElement.toString()` 必须返回 `function createElement() { [native code] }`。注意 Firefox 格式与 Chrome 不同（见规则 14），`markNative` 必须匹配基准浏览器格式，否则被指纹库识别。这是 jsdom 环境伪装失败的最高频原因。

### 17. 环境对比要分批采集
单次 `evaluate_js` 代码太长会报错（jsdom 执行超时或内存溢出），分 4-5 批采集：① navigator → ② screen + window → ③ document + performance + toString → ④ DOM + Canvas + WebGL + Audio → ⑤ 其它。每批结果与基准 diff 后立即补，再采下一批。**反例**：一次采 200 项属性，jsdom 卡死，无法定位是哪项触发检测。分批后每批 30-50 项，单批失败也能快速定位。注意事项：toString 单独成批，因为它需要遍历所有原型方法，单独处理便于排查。

### 18. 环境补丁必须在 JSVMP 脚本加载前完成
XHR Hook 的安装顺序决定能否截获最终 URL——若 JSVMP 先加载并缓存了 `XMLHttpRequest.prototype.open` 的原始引用，后装的 Hook 拦截不到。**反例**：先加载 JSVMP 再补 `window.chrome`，JSVMP 启动时读到的是 undefined，已写入内部缓存，后续补丁无效。正确顺序：装 Hook → 补环境 → 加载 JSVMP → 触发签名。用 `instrumentation(action='reload')` 保证 Hook 在最早期注入，环境补丁放在 `instrumentation` 的 `pre_eval` 回调中执行。

## 八、evaluate_js 写法

### 19. `evaluate_js` 必须用 IIFE 包装 + 显式 return
`evaluate_js` 执行的代码必须有返回值，否则拿到 undefined。必须用 IIFE 包装 + 显式 return：
```javascript
(() => {
  const nav = navigator;
  return { userAgent: nav.userAgent, platform: nav.platform };
})()
```
**反例**：直接写 `navigator.userAgent`（无 return，返回 undefined）或 `const r = {...}; r`（语句而非表达式，部分引擎返回 undefined）。注意事项：IIFE 内可用 `try/catch` 包裹每个属性，避免单属性报错导致整批返回 undefined；返回大对象时序列化开销大，按需采集，不要一次返回所有属性。

## 九、成功样本分析与字段验证

### 20. 成功样本是"答案"：第一步全字段解密 + 逐点统计
拿到验证码成功样本 URL/参数（trace 或浏览器成功链路的请求）后，**先完整解密再写代码**。成功样本就是服务端接受的"标准答案"：把每个密文字段逐个解密成明文，核对字段类型、值域、格式；轨迹类字段做逐点 diff 统计（步长序列 / 时间间隔 / 点数-距离关系）后再写生成器。**反例**：只解关注字段就动手写代码，凭猜补其余字段（典型形态：把空串字段写成数字、把字符串时间戳写成数字——导致所有后续排除实验被这一个错误掩盖，白费大半天；厂商字段陷阱实例见 `references/captcha/captcha-providers.md` 与 `cases/yidun-jigsaw.md`）。注意事项：字段解密顺序从"结构已知的简单字段"开始（如长度/数值类），逐步到"复杂加密字段"（如轨迹/指纹），每个字段解出后先记录明文样本再继续；轨迹统计至少 2 个不同距离的样本，才能得出"点数由时长决定还是距离决定"这类结论。

### 21. 解析顺序/过滤不确定时，用页面渲染 DOM 做 ground truth
当纯协议解析结果不确定（如图片数字的**顺序**、干扰图**过滤**、**识别**是否正确），不要盲目提交答案。用 ruyipage 打开页面（如需登录态就注入 cookie），**同一时刻**做两件事：抓接口响应原始数据 + 从 DOM 提取渲染位置（`getBoundingClientRect` 的 x/y = 最终显示位置）。对比「协议解析结果」vs「DOM 实际显示顺序」，不一致就 dump 每张图的 index/left/x 反推排序规律，修正协议逻辑，一致后再提交做最终业务验证。**反例**：不验证就提交，首次 wrong 才定位到"HTML 顺序 ≠ 渲染顺序"。这比盲提交高效，且能逼出 CSS 布局参与的排序规则（如雪碧图 `inline-flex` + `width` + `left` 偏移 → 排序键 = `有效图序号 + left/宽度`）。见 `references/rendering/image-content-reversal.md`。

## 十、黑盒执行语义

### 22. 黑盒执行加密函数禁止缓存复用（挑战循环语义）
挑战代码常循环多次调用同一加密函数（如 `decrypt(ts)` 循环 N 次、N=2~5 随机、取最后一次结果），RSA 等算法每次真实加密带随机 padding、输出不同。把 N 次循环"优化"成缓存 1 次结果复用 = 改变挑战代码的实际执行语义 → 服务端全量拒绝（实测缓存版 8/8 失败，无缓存版稳定通过）。服务端校验的是**挑战代码语义**，不是"结果是否正确"，任何"性能优化"改变语义都会失败。**反例**：为性能缓存复用 RSA 结果，签名格式全对但全被拒，排查时误归因到算法/公钥。注意事项：循环次数、比较运算符等"常量"也可能是随机化的，必须原样执行挑战代码获取，不能静态提取数字（match9 的 prefix=循环次数 2~5 随机）。

### 23. 提交结果"时好时坏" → 先大样本统计判别随机拒绝 vs 固定条件，禁止盲试参数
当同一构造的提交结果**随机通过/拒绝**（如 10~50% 成功，且失败返回与成功相同的挑战文案）时，先用 **≥10 次大样本统计**确认是"随机边缘拒绝"还是"固定条件窗口（如 ts 年龄 2~4s）"，再决定应对。**反例**（match9 实测，第二大耗时点）：误以为存在 ts 年龄窗口，盲试 sleep 1.0/1.5/2.0/2.5s 与"精确控制年龄"多轮，实际是随机边缘拒绝（vm m 50% vs 浏览器 eval m 100%）。应对：① 确认签名语义正确（对照实验：浏览器 eval 生成同构造 m 提交 100% 通过）后**停止调参**；② 用**重试机制**兜底（≤8 次、间隔 2s，50% 成功率下 8 次重试通过概率 ≈99.6%）；③ 随机拒绝不等于签名错误，不因单次失败回改实现。黑盒 SDK 定期更新（依赖 JS 版本校验 + 二进制抓取）见 `references/network/dynamic-resource.md` 专节，不在此重复。

### 24. 黑盒执行禁止预填状态快照——会改变引导代码的分支走向
match10 实测：sandbox 预填"看起来完整"的运行时状态快照后，引导脚本检测到状态已存在走旁路，静默跳过动态初始化（不再发起动态资源请求），链路残缺且无任何报错。黑盒执行的价值在于让引导代码按真实分支自然驱动——预填快照相当于替目标代码做了分支决策，与缓存复用（规则 22）同属改变执行语义。正确做法：空状态起步，按浏览器加载顺序喂资源（静态脚本 → 动态密文/挑战配置 → 引导器），每步初始化由目标代码自己完成；确需注入状态时，先在 trace 中确认该状态的真实写入时机早于当前执行步骤，否则一律不预填。

### 26. webpack 打包 bundle 的模块切片黑盒执行要点
从 webpack 单行 bundle 里抠模块黑盒执行（路径 B），比整体补环境便宜得多，但四个环节各有硬约束（match16 实测，310882 B 单行压缩文件）：
1. **模块定界**：用正则扫出所有 `\d+:function(...){` / `\d+:()=>{` 起点并按字符偏移排序定位（**不要用 `--targets` 猜边界**）；模块体边界 = **下一个模块起点 - 2**（去掉尾部 `},`），多取一个 `}` 就 `SyntaxError: Unexpected token '}'`，而报错位置在超长单行里几乎无法定位。做法：对切片尝试追加 0~5 个 `}`，逐个 `node --check`，第一个通过的即正确切片。
2. **隔离作用域**：各模块有自己的 `var e,t,n`，塞进同一作用域会互相覆盖。用 `new Function('window','document','n', body)` **逐个执行、共享同一个自定义 `window` 对象**，即复刻 webpack 的模块作用域语义。
3. **require 桩（分支漂移防线）**：把 webpack 的 `__webpack_require__` 作为 `n` 传入并设 `n.g = globalThis`。缺这个桩会让依赖 `n.g` 的 `try/catch` 兜底分支静默走错分支——签名格式完全正常但服务端拒收，见**反模式 26**。
4. **反调试代码不必删**：模块尾部的 `.init()`（`setInterval` + `console.info` 控制台检测）在 Node 里必然失败，但它发生在签名函数挂载**之后**，用 `try/catch` 包住即可，删除反而可能破坏模块结构。
5. **语义不可"优化"**：`charAt` 索引超出字母表长度时返回空串（该位不产出字符）——这是算法语义，改成数组下标会拿到 `undefined`；同理 `Date.parse(new Date).toString()` 是秒级时间戳，换成 `Date.now()` 会改变精度。

可直接复用的骨架：`templates/vm-sandbox/webpack-module-harness.js`（切片模块逐个执行 + 共享 `window` + require 桩 + catch 可见化）。

## 十一、服务端校验语义假设

### 25. 环境指纹对齐的验收线是"参数自洽"，不是"逐字节复刻真实浏览器"——先最小沙箱试探再按需对齐
多数站点的服务端校验是**参数间自洽性**：解码指纹参数、重算签名比对（如 mz 解码后重算 md5 与 m 比对），而不是拿指纹与某个"真实浏览器基线"逐字段比对。因此 vm 沙箱生成的指纹与真实浏览器存在少量差异（UA 版本号、colorDepth 等）通常**不影响通过**——match14 实证：mz 指纹 53 字段中 4 处与真实 Chrome 不同，5 页全部 200。**反例**：为"保险"预先逐字节复刻真实浏览器指纹、大量补环境后才敢发真实请求，成本高且多数对齐是无用功。正确做法：先用最小沙箱 + 真实请求试探（低成本验证自洽性假设）；被拒且双对照定位为签名内容层后，再用对齐探针法（`references/env/env-detect-bypass.md`）逐位 diff 定位**被校验**的差异位按需对齐；有真实浏览器成功样本时，把样本指纹解码后与沙箱生成值做结构 diff，可快速区分"结构性缺失"（必须补）与"取值性差异"（通常无需对齐）。

## 十二、无签名 / 传输层题型

### 27. 不是每题都有签名——请求侧"无签名"要走三条判据确认后收手，转查传输层与响应层
默认假设"存在待还原签名"会让简单题变成无解题：猿人学 match 系列已有多题请求侧全明文（match4/7/12/17），把诱饵参数当签名去逆是纯浪费（反模式 27）。IDENTIFY 阶段按下面三条判据确认，全部干净即**明确判定"请求侧无签名"并收手**：
1. **网络层**：`case/forensic/target-hits.json` 里目标请求的 URL / 请求体，除业务参数（`page`/`pageSize`/`kw`/分页/搜索词）外**没有任何动态字段**；把可疑参数名拿去 capture.json 全量反查，出现 0 次即未生效。
2. **trace writer 层**：`XMLHttpRequest.open` / `fetch` / `Headers.set` 的**参数全文**里没有该字段（`search_trace.js --keyword <目标URL>` 直接检索 URL 字面量最快——trace 里的 XHR 记录常被第三方 SDK 淹没，match17 实测前两名高频栈是 transcend-cdn 与 mozilla 站点脚本，目标域脚本只排第三）。
3. **Cookie/存储层**：`case/ruyi-trace/logs/cookie/*.ndjson` 里目标域**无 JS 写入的 cookie**（只有 `Hm_*` 之类统计 cookie 即视为干净），无 WASM/JSVMP/混淆 SDK 调用，`crypto` 类 trace 条数为个位数且不来自目标域脚本。

三条都干净后，**约束只可能在三个地方**，逐项落实为交付实现（match17 实证：HTTP/2 + 末页 UA=yuanrenxue + sessionid；match19 实证：服务端 TLS ClientHello 黑名单 + 末页 UA 分流）：
1. **传输层**：协议版本（HTTP/2、ALPN）、TLS 指纹、连接复用与顺序——Node 侧用原生 `node:http2`：一次 `http2.connect()` 建会话、多次 `client.request()` 复用、最后 `client.close()`（交付门禁 Session 三件套天然满足，`client.alpnProtocol === 'h2'` 可作协议自检）；**不要发 `accept-encoding`**，避免 br/zstd 需额外解压，同时保留 zlib 解压兜底。协议要求以取证响应头（如 `x-firefox-spdy: h2`）与题面为准，不要用 HTTP/1.1 反向上报惩罚计数。
   **传输层失败先做「三级客户端阶梯」对照（match19 实证起点）**：以取证浏览器（ruyipage 成功样本）为 ground truth 锚点，协议客户端按代价从低到高逐级测——**每升一级只改"客户端栈"这一个变量**（同一份请求、同样的头/UA/时序）：
   - 第一级 · Node 默认栈：原生 `https` / `node:http2`（默认交付客户端）。
   - 第二级 · 跨栈普通客户端：curl（schannel/openssl）、Python `requests`（OpenSSL）——**指纹族不同但都非浏览器指纹**，用来区分"窄黑名单"与"更宽的过滤"。
   - 第三级 · 指纹客户端：Python `curl_cffi`（`impersonate` 固定到具体浏览器档位如 chrome/firefox）、Node `CycleTLS` / `impers` / `curl-cffi`——伪装浏览器 JA3/JA4/HTTP2 指纹（工具探测与安装见 `references/network/tls-validation.md`，`check_tls_clients.js` 自动检测本机可用性；`curl_cffi.requests.Session` 与 requests 同形 `session.get/close`，Session 三件套门禁已识别）。

   **判读矩阵**（前提：浏览器取证样本 200）：
   | Node 默认栈 | 普通跨栈 | 指纹客户端 | 结论 | 交付选择 |
   |---|---|---|---|---|
   | 200 | — | — | 无传输层约束 | Node 默认栈 |
   | 400 | 200 | — | **窄黑名单**（仅 Node 系/常见 bot 指纹被拉，match19 实证） | 通过验证的普通客户端即可，不上指纹伪装 |
   | 400 | 400 | 200 | **浏览器指纹白名单**（JA3/JA4/HTTP2 校验） | `curl_cffi`/`CycleTLS` 交付，**固定 impersonate 档位并写入验证记录** |
   | 400 | 400 | 400 | 非 TLS 层：h2 帧指纹细节、头序/大小写、会话武装、或内容层 → 回 DIAGNOSE 双对照 | — |

   三条纪律：① **"错误文案不指示病因层"**——同是 `token failed`，match9 是 m-cookie 缺失、match19 是 Node 指纹被拉黑；先阶梯定位再对症。② **最低可用栈交付**：第二级通过就不上指纹客户端（少依赖、少一个可被指纹检测/档位过期的伪装面；match19 交付即普通 requests）；第三级通过才用指纹客户端，且 impersonate 档位会随浏览器版本漂移，必须固定并记录。③ 第二级全拒**不等于**回内容层——必须先测完第三级把"白名单"排除，才能下内容层/会话层结论。
2. **请求头语义**：UA（末页 UA 红线是站点惯例）、Referer、`X-Requested-With`、Cookie 里的登录凭据——这些不是"签名"，但缺一项就取不到数据，且失败常表现为 **HTTP 200 + `data` 非数值**（必须对每页做元素类型校验，不能只看状态码——match19 末页 UA 未过时返回 200 + `["请","将","UA",...]` 提示数组）。
3. **响应层**：数据加密/字体映射/图片拼装（内容还原型，Step 2 可豁免）。

**反例**：三条判据已全干净却继续翻 JS 找"隐藏签名"、或把 `m:window.match17` 这类诱饵参数拿去逆算法（反模式 27）。收手不等于降低验证标准——真实请求、fixture 回归、多轮稳定性验证照样要做，只是工作量从"还原算法"转移到"对齐传输层与校验响应"。

## 十三、JSVMP 沙箱静默退出

### 28. VM 装不上 hook 且零报错 = 环境语义级偏差，用双层插桩对齐浏览器 trace，禁止全量堆桩

JSVMP 字节码对每个环境访问都有 try/catch 或条件分支：环境语义不对时走**干净退出分支**——顶层代码（如 `Date.now` 重写）正常生效、无任何报错，但 VM 的挂载物（XHR hook、全局函数、命名空间）不出现，签名静默不产出。此时在算法层枚举输入或盲目堆桩都是无解方向（反模式 28，match18 实证三层语义偏差：vm 内建经 window 取而非自有属性 / `navigator.webdriver` 误做自有属性——hasOwnProperty 语义与浏览器相反 / 鼠标事件门控未回放）。

**定位三板斧（按序执行，每修一层重跑一次）**：
1. **window 级记录 Proxy**：把沙箱 `window`（及嵌套 `navigator`/`document`）包成记录 get/set/has 的 Proxy 再 `createContext`，重放目标脚本，看**最后访问的属性**——那就是退出点。注意两个坑：把整个 globalThis 包 Proxy 会破坏 vm 内建解析（`Date` 等经 `Reflect.get(base)` 拿不到），只包 `window` 引用；VM 序言捕获的是 `window` 引用，包装它即可覆盖字节码的全局访问。
2. **VM 原语包装**：在脚本加载前包装 VM 序言捕获的原语（`String.fromCharCode`/`decodeURIComponent`/`parseInt`），记录解码串流——JSVMP 字符串全在运行时解码，检测词（webdriver/hasOwnProperty/selenium/debugger）会直接暴露字节码意图，无需反编译。
3. **浏览器 trace seq 对齐**：从 RuyiTrace NDJSON 里按序提取目标 VM 栈帧（如 `stack` 含 `line==727` 帧）的操作序列（interface/member/args/value），与沙箱 Proxy 记录逐条对照，**第一个分歧点**即缺失/偏差的环境项。

**语义级对齐清单（值对 ≠ 对齐）**：
- **内建取用路径**：VM 若以 `window.XXX` 方式取内建（BigInt/Math/…），须把宿主内建注入为 sandbox **自有属性**（`vm.createContext` 的内建不在宿主侧 base 对象上，经 window 取到 undefined）。
- **属性位置**：探测类属性（`navigator.webdriver`）必须挂在**原型**上——真实浏览器里它在 `Navigator.prototype`，自有属性会让 `hasOwnProperty` 探测返回 true 而被判定 bot；对齐的是 `hasOwnProperty` 语义，不是属性值。
- **运行时行为**：`addEventListener` 桩要**捕获监听器**供宿主派发合成事件（mousemove/mousedown/mouseup，坐标用取证 trace 实测值）；`document.readyState` 要给到浏览器同款值（'complete'）——这些都是字节码分支的前置条件。
- **验证收敛标准**：Proxy 记录的属性访问序列与浏览器 trace 的 VM 帧序列一致 + VM 挂载物出现（hook 装上）+ 真实请求通过。全量堆桩（一次加 10 个桩）会掩盖真正的分歧点，违反单变量原则（反模式 13/28）。

## 相关案例

| 案例文件 | 关联点 |
|---------|--------|
| `cases/jsvmp-xhr-interceptor-env-emulation.md` | 规则 1/3/5/12/16/18 实战验证 |
| `cases/jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md` | 规则 1/3/12/14/16 实战验证 |
| `cases/jsvmp-ruishu6-cookie-412-sdenv.md` | 规则 2/6/8 实战验证 |
| `cases/universal-vmp-source-instrumentation.md` | 规则 1/2/8/9 实战验证 |
| `cases/modified-md5-xhr-done-yuanrenxue.md` | 规则 10 实战验证（T常量篡改 + XHR.DONE 步长退化根因；降级前先做时间冻结对照法） |
| `cases/yidun-jigsaw.md` | 规则 20 实战验证（m 空串陷阱 + 全字段解密 + 逐点统计） |
| `cases/yidun-intellisense-vm-env.md` | 规则 20 实战验证（成功样本链路字段核对） |
| `cases/yuanrenxue-match4-sprite-pixelsort.md` | 规则 21 + 图片像素判定（base64 唯一 ≠ 像素唯一）实战验证 |
| `cases/yuanrenxue-match6-aarcsa-honeymoon-risk.md` | 会话状态类风控（蜜月期/频率/惩罚层）+ 反模式 13/14 实战验证 |
| `cases/yuanrenxue-match9-dynamic-cookie2.md` | 规则 22 实战验证（RSA 循环加密禁缓存）+ 规则 23 实战验证（随机边缘拒绝需大样本判别）+ 数据绑定会话（反模式 19）+ 黑盒 SDK 定期更新（dynamic-resource.md 专节） |
| `cases/yuanrenxue-match10-ruishu3-replay-defense.md` | 规则 24 实战验证（预填状态快照致引导脚本走旁路）+ 反模式 16/20/11 实战验证（插桩 while(1) 禁令 / VM 卡死转投浏览器 / 外部失败误归因通道层）+ 会话配套资源（dynamic-resource.md 专节）+ 元素语义真实化（env-object-model.md） |
| `cases/yuanrenxue-match16-webpack-blackbox-branch.md` | 规则 26 实战验证（webpack 模块切片定界 + 隔离作用域 + require 桩 + 反调试处理）+ 反模式 26 实战验证（抠代码后分支漂移：格式全对却被拒） |
| `cases/yuanrenxue-match17-http2-transport-plaintext.md` | 规则 27 实战验证（请求侧无签名三条判据 + 传输层 HTTP/2/UA/Cookie 对齐）+ 反模式 27 实战验证（诱饵参数 `m` 恒 undefined 被序列化层丢弃）+ 反模式 22 二次实证（`--targets "question/17"` 误命中静态资源） |
| `cases/yuanrenxue-match18-jsvmp-mouse-gated-signature.md` | 规则 28 实战验证（JSVMP 静默退出双层插桩定位 + 语义级环境对齐：内建自有属性 / webdriver 挂原型 / 鼠标事件门控）+ 反模式 28 实证 + 反模式 27 四次实证（`window.match18` 连环诱饵）+ 末页 page=05 双重校验 |
| `cases/yuanrenxue-match19-tls-fingerprint-blocklist.md` | 规则 27 扩充实证（跨客户端栈对照法定位 TLS ClientHello 黑名单 + 交付语言切换依据；末页 UA 提示数组按元素类型判别）+ 反模式 27 五次实证并修正机理（丢弃在 `k.extend` 深拷贝 `copy!==undefined` 守卫，非 `$.param`——debug 文本含参数 ≠ wire URL 含参数） |
