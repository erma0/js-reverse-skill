# 经验法则详解（高级手动取证参考）

> 本文件收集手动取证和高级调试场景下的经验法则，作为 RuyiTrace NDJSON 自动采集的补充。默认流程以 SKILL.md 状态机为准，使用统一脚本取证（`forensic_ruyipage.py` + `capture_ruyitrace_log.js`）；以下内容仅在自动采集不足、需要手动介入时参考。文中涉及的 ruyipage 交互式 API（`instrumentation`、`search_code`、`evaluate_js` 等）属于高级手动取证手段，不是默认路线。

## 一、Hook 安装与入口确认

### 1. Hook 与环境补丁必须在目标 SDK/JSVMP 加载前就位（原 18 已并入）
签名型反爬的签名函数在 SDK 加载时即注册到拦截器，Hook 装晚了就截不到调用栈；环境补丁同理——JSVMP 先加载并缓存了 `XMLHttpRequest.prototype.open` 的原始引用或 `window.chrome` 的取值，后装的 Hook/补丁拦截不到、改不动。正确做法：用 `instrumentation(action='reload')` 装完 Hook 后一步重载（默认 `clear_log=True` 拿到干净快照，保证 Hook 先于页面 JS 生效），环境补丁放在 `instrumentation` 的 `pre_eval` 回调中执行，整体顺序固定为「装 Hook → 补环境 → 加载 JSVMP → 触发签名」。**反例**：裸 `reload()` 不能保证顺序，常丢前几条调用；先加载 JSVMP 再补 `window.chrome`，JSVMP 启动时读到 undefined 已写入内部缓存，后续补丁无效。注意：`pre_inject_hooks` 仅适用于行为型反爬（首屏挑战页 navigate 时装 Hook），对签名型反爬**永远不要用**，签名型需要源码级插桩控制。常用 Hook 不要手写，`inject_hook_preset` 一键覆盖 xhr/fetch/crypto/websocket/debugger_bypass/cookie/runtime_probe。

### 2. JSVMP 寄存器数是分叉判断依据
JSVMP 字节码 dispatch 形如 `u[xxx]: x(offset, t, this, arguments, 0, N)`，尾部 `N`（寄存器数）是区分不同函数的分叉依据。同一 opcode 在不同函数中 `N` 不同、行为也不同。识别 JSVMP 后先用 `hook_jsvmp_interpreter` 观察 dispatch 表，按 `N` 值聚类，能快速锁定目标函数所在分支，避免在全部 case 中盲目 trace。**反例**：只看 opcode 不看 `N`，多个函数混在一起，trace 日志爆炸且无法定位签名函数。这是 JSVMP 双路径决策（路径 A 算法追踪 / 路径 D 环境伪装补环境）的前提判断。

### 3. 环境补丁前必须确认签名函数入口
开始 6 步法的环境采集之前，先用 `search_code` 确认 JSVMP 的签名入口类型：单通道 XHR / 双通道 XHR + fetch / 导出函数 / cacheOpts 初始化。**反例**：不确认入口就补大量环境，最后发现入口是导出函数而非 XHR，补的环境白做。可用 `get_request_initiator(request_id=N)` 直达签名函数，省去大量搜索。双签名场景必须同时 Hook XHR 和 fetch——某些平台 JSVMP 同时改写 `XMLHttpRequest.prototype.open` 和 `window.fetch`，只 Hook 一个通道会丢另一半签名。Cookie 归因先用 `analyze_cookie_sources()` 区分纯 JS 写入 / 纯 Set-Cookie / JS 算 token + 服务端带回。

## 二、经验资产与离线验证

### 4. case 是经验资产：升级时核对"可验证事实清单"，命中后精读踩坑记录转检查项（原 7 已并入）
case 文件的价值随实战次数指数级增长：第一次分析某站点写的 case 可能粗糙；第二次分析（升级或变体）时用 case 发现 80% 还成立、20% 变了，就把变化追加到"变体章节"。"可验证事实清单"是核心资产，同站升级时逐条核对找出"哪些变了"。**示例**：case 记录"签名函数位于 acw_sc.2.js 第 12 万行附近的 dispatch"，升级后核对发现位移到第 15 万行但函数特征不变。EVIDENCE_GATE 指纹匹配时优先检测 `cacheOpts` 和 `X-Gnarly` 区分 SDK 变体（单签名 vs 双签名、bdms.paths vs cacheOpts）。
命中经验库后不能直接套用，必须按 SKILL.md 状态机正常走完整流程：IMPLEMENT 编码前逐条回查踩坑记录，将每条记录写成可核对的实现约束和验证项（case 记录"该站点 cacheOpts 是新版 SDK 必传项，缺少会导致业务路径未注册、拦截器不触发"，则初始化代码必须传入 cacheOpts，并在验证清单中检查业务路径已注册——旧版只需 `bdms.paths`）。**反例**：只看 case 的算法部分就动手，漏了踩坑记录里的"预热请求注入动态密钥"，跳过 `/api2` 预热导致签名缺密钥。

### 5. `verify_signer_offline` 是协议代码的 unit test
把签名算法移植成 Python/Node 协议代码后，用 N 个真实样本（含原始输入 + 浏览器产出的签名）离线验证，字符级定位首个偏差点。这是协议代码的 unit test——只要有一个样本不过，就说明算法有 bug。**反例**：只拿一个样本跑通就交付，结果线上偶发失败（时间戳精度、随机串字符集差异）。注意事项：样本要覆盖不同时间窗、不同参数长度、不同用户态，才能逼出边界 bug。把它当作 CI 门禁，协议代码每次改动都跑全量样本。

### 6. 想放弃时先回查 cases/ 和 common-pitfalls.md
绝大多数"想放弃"是踩了已知反模式。降级梯度必须逐级走：`instrumentation(mode="ast")` → 失败 → `mode="regex"` 覆盖率不足 → `hook_jsvmp_interpreter(mode="transparent")` 日志太少 → `mode="proxy"` 破坏签名 → 路径 D（jsdom 环境伪装）→ 也失败 → 向用户说明。每级至少尝试一次并记录失败原因。**示例**：AST 插桩失败常因严格 CSP，v0.6.0 的 `csp_bypass=True` 可自动绕过。回查 common-pitfalls.md 往往 10 分钟解决卡了 2 小时的问题，不要跳过这一步。

## 三、JSVMP 路径选择

### 8. JSVMP 先选路径再动手（原 15 已并入）
识别到 JSVMP 后立即在路径 A（算法追踪）和路径 D（环境伪装/补环境）间决策，不要边做边换。签名型反爬只能走源码级插桩（`instrumentation mode="ast"`）；可在 Node 中加载执行、无反 jsdom/vm 检测的"签名黑箱"优先走路径 D（采集→对比→补丁），比追踪字节码执行快 10 倍。运行成本梯度：能 Node `crypto` 解决的不用 `vm`；能 `vm` 的不用 jsdom；能 jsdom 的不开浏览器。RS 5/6、某 CDN 风控 sensor_data、webmssdk 这类"算法全在 opcode dispatch 循环内"的 VMP，`hook_jsvmp_interpreter` 也看不到 switch/case 内部，AST 插桩是唯一能打开黑箱的工具。**反例**：先试路径 D 跑半天发现 JSVMP 有反 jsdom 检测，再换路径 A，前功尽弃；或明明无 vm 检测却硬啃 20 万行字节码 trace，3 天没出结果。决策依据见规则 2 的寄存器数分析；路径 D 前先确认无 vm 检测——Node vm 沙箱 ≠ 浏览器，部分调试干扰机制只在非浏览器环境触发（`window`/`document`/`navigator` 未定义、定时器行为不同），有检测时补的环境会被识破。

## 四、签名不一致排查

### 10. 签名不一致时逐环节对比
排查链路（逐项对比脚本值 vs 浏览器值）：① 原始输入参数 → ② 参数排序/拼接字符串 → ③ 时间戳（精度：秒 vs 毫秒）→ ④ 随机串（长度、字符集）→ ⑤ 密钥/盐值 → ⑥ 中间摘要 → ⑦ 最终密文（编码方式：hex/base64/自定义）。找到第一个偏差点。**示例**：脚本用毫秒、浏览器用秒，时间戳差 1000 倍。若链路全对仍失败，考虑：服务端静默拒绝（HTTP 200 + 空 body 说明环境指纹不匹配）、预热请求未做（`/api2` 类请求注入动态密钥）、TLS 指纹壁垒（Node 用 `got-scraping`/`curl-cffi-node`，Python 用 `curl_cffi` 模拟 Firefox/Chrome TLS）。

## 五、运行时复用与 Hook 持久化

### 12. 运行时与 Hook 必须持久化：context 复用、防覆盖（原 11 已并入）
JSVMP 常在运行时重新赋值 `XMLHttpRequest.prototype.open` 等原型方法，覆盖掉你装的 Hook。必须用 `persistent=True`（页面导航/重载后自动重装）+ `non_overridable=True`（阻止后续覆写）。**示例**：某平台 SDK 加载后立即 `XMLHttpRequest.prototype.open = nativeOpen`，未加 `non_overridable` 的 Hook 被静默还原，截不到任何调用。注意事项：`non_overridable` 对部分严格检测环境的站点可能被探测到（属性描述符不可写），权衡使用；若站点主动检测描述符，改用实例级覆写。交付侧同理——Python `execjs` 编译一次 context 多次调用（`ctx = execjs.compile(js_code)` 后多次 `ctx.call("sign", params)`，比每次 `execjs.eval` 快 10 倍以上）；**反例**：在请求循环里每次 `execjs.compile`，单次耗时 200ms 起步 QPS 上不去，且计数器/时间窗等状态随重建重置（见反模式 7）。context 内若维护了状态（计数器、时间窗），跨请求复用要确认状态污染；多线程场景每个线程独立 context，避免共享运行时崩溃。

## 六、工具技巧

### 13. 大文件定位：`search_code` + 高频信号词（原 9 已并入）
JSVMP 文件通常 200KB+，直接读全文件 token 爆炸。用 `search_code(keyword, script_url=url)` 在指定脚本中搜索关键词，返回匹配行 + 前后上下文，精准定位。高频信号词：`String.fromCharCode`（VM 解释器大量用它构造字符串绕开字面量静态扫描，高密度区是字符串构造区、紧邻签名算法——某 acw_sc VMP 中 `fromCharCode` 调用密集区往后 200 行就是签名入口）、`prototype.open`、`Object.defineProperty`、`toString`、签名函数名（`X-Bogus`、`_signature`）。**示例**：搜 `fromCharCode` 找到 30 处命中，每处给 5 行上下文，比读 20 万行文件高效。**反例**：关键词太泛（如 `function`）命中太多，太窄可能漏，先用 `analyze_cookie_sources(name_filter="目标cookie名")` 缩小范围再搜。注意事项：单纯 hook `fromCharCode` 会触发太多次，应结合寄存器数（见规则 2）过滤到目标函数后再 hook。

### 14. `compare_env` + 分批采集是补环境起点（原 17 已并入）
先在 ruyiPage（真实 Firefox 内核）中采集环境基准数据，再用 `evaluate_js` 在 jsdom 中分批采集细粒度值，与基准逐项 diff，差什么补什么。**反例**：凭经验猜缺 `navigator.webdriver`，补了仍报错，实际缺的是 `window.chrome.runtime`。`compare_env` 自动输出 diff 报告，避免盲补。采集必须分批：单次 `evaluate_js` 代码太长会报错（jsdom 执行超时或内存溢出），分 4-5 批（① navigator → ② screen + window → ③ document + performance + toString → ④ DOM + Canvas + WebGL + Audio → ⑤ 其它），每批 30-50 项，每批结果与基准 diff 后立即补、再采下一批——单批失败也能快速定位（**反例**：一次采 200 项属性，jsdom 卡死，无法定位是哪项触发检测）；toString 单独成批，它需要遍历所有原型方法，单独处理便于排查。注意事项：ruyiPage 基于 Firefox，原生函数 toString 返回含换行缩进格式（`function name() {\n    [native code]\n}`），与 Chrome（`function name() { [native code] }`）不同，补丁格式必须匹配采集基准浏览器，否则被指纹库识别。

## 七、环境伪装踩坑

### 16. `Function.prototype.toString` 是第一杀手
jsdom 所有 DOM 方法的 `toString()` 会暴露实际 JS 代码（如 `function() { return this._domImpl.foo(); }`），JSVMP 一调用就识破。必须三层防御：① WeakSet 记录已伪装函数 → ② 实例级覆写（`Object.defineProperty` 单个方法）→ ③ 源码模式正则（批量替换 toString 返回值）。**示例**：补 `document.createElement.toString()` 必须返回 `function createElement() { [native code] }`。注意 Firefox 格式与 Chrome 不同（见规则 14），`markNative` 必须匹配基准浏览器格式，否则被指纹库识别。这是 jsdom 环境伪装失败的最高频原因。

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

可直接复用的骨架：`assets/templates/vm-sandbox/webpack-module-harness.js`（切片模块逐个执行 + 共享 `window` + require 桩 + catch 可见化）。

## 十一、服务端校验语义假设

### 25. 环境指纹对齐的验收线是"参数自洽"，不是"逐字节复刻真实浏览器"——先最小沙箱试探再按需对齐
多数站点的服务端校验是**参数间自洽性**：解码指纹参数、重算签名比对（如 mz 解码后重算 md5 与 m 比对），而不是拿指纹与某个"真实浏览器基线"逐字段比对。因此 vm 沙箱生成的指纹与真实浏览器存在少量差异（UA 版本号、colorDepth 等）通常**不影响通过**——match14 实证：mz 指纹 53 字段中 4 处与真实 Chrome 不同，5 页全部 200。**反例**：为"保险"预先逐字节复刻真实浏览器指纹、大量补环境后才敢发真实请求，成本高且多数对齐是无用功。正确做法：先用最小沙箱 + 真实请求试探（低成本验证自洽性假设）；被拒且双对照定位为签名内容层后，再用对齐探针法（`references/env/env-detect-bypass.md`）逐位 diff 定位**被校验**的差异位按需对齐；有真实浏览器成功样本时，把样本指纹解码后与沙箱生成值做结构 diff，可快速区分"结构性缺失"（必须补）与"取值性差异"（通常无需对齐）。

## 十二、无签名 / 传输层题型

### 27. 不是每题都有签名——请求侧"无签名"要走三条判据确认后收手，转查传输层与响应层
默认假设"存在待还原签名"会让简单题变成无解题：某教学靶场 match 系列已有多题请求侧全明文（match4/7/12/17），把诱饵参数当签名去逆是纯浪费（反模式 27）。IDENTIFY 阶段按下面三条判据确认，全部干净即**明确判定"请求侧无签名"并收手**：
1. **网络层**：`case/forensic/target-hits.json` 里目标请求的 URL / 请求体，除业务参数（`page`/`pageSize`/`kw`/分页/搜索词）外**没有任何动态字段**；把可疑参数名拿去 capture.json 全量反查，出现 0 次即未生效。
2. **trace writer 层**：`XMLHttpRequest.open` / `fetch` / `Headers.set` 的**参数全文**里没有该字段（`search_trace.js --keyword <目标URL>` 直接检索 URL 字面量最快——trace 里的 XHR 记录常被第三方 SDK 淹没，match17 实测前两名高频栈是 transcend-cdn 与 mozilla 站点脚本，目标域脚本只排第三）。
3. **Cookie/存储层**：`case/ruyi-trace/logs/cookie/*.ndjson` 里目标域**无 JS 写入的 cookie**（只有 `Hm_*` 之类统计 cookie 即视为干净），无 WASM/JSVMP/混淆 SDK 调用，`crypto` 类 trace 条数为个位数且不来自目标域脚本。

判定时机可前移（SKILL.md 4.2「速通路径速查」）：EVIDENCE_GATE「只有 Step 1」时，判据① + 落盘 JS 源码级反证（判据②③的源码替代，条件加载/动态注入脚本须核实不适用于本题）+ 响应明文自包含，即可单行提议免采 Step 2（速通形态①），用户确认后直接 CASE_LOOKUP，不必先采 trace 再收手；简单加密（如单层 md5 摘要签名）源码可读 + ≥2 组不同输入样本对拍逐字节一致时走速通形态②。免采不降验证标准——真实请求、fixture 回归、多轮稳定性验证照做。

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

## 十四、混淆识别与执行纪律（match23 实证）

### 29. 低雪崩 token 扩散判别 + 自引用解码文件执行纪律

1. **低雪崩 token 扩散判别（先判扩散再选路线）**：拿到 2-3 组不同输入的签名样本后先做**逐位 diff**——标准哈希（MD5/SHA/SM3）对输入雪崩，不同输入的输出应面目全非；若输出仅个别 nibble/字节随输入变化（甚至不同输入产出相同输出——弱扩散碰撞，服务端复算同一函数仍验证通过），则排除"标准哈希(动态输入)"假设，指向**环境分派 IV + 掩码运算加法器**一类的结构化魔改算法，应优先原码执行 + 环境分支对齐，而不是去逆标准算法。反向也成立：同输入两次计算输出不同 → 有随机量，按随机量回溯分支（反模式 23）；同输入恒同输出但服务端拒 → 环境分支（反模式 29/31）。
2. **obfuscator 家族短名变体识别**：混淆识别不要只盯 `_0x` 前缀——obfuscator.io 关闭 rename 时是 a1/Q/zk 等短名。真信号是结构性的：字符串表轮转 IIFE（`['push'](['shift']())`）、自保护陷阱（`'newState'` + `\w+ *\(\)` 正则源）、小写在前 base64 字母表、解码器 `charCodeAt(变量+常量)` 求和偏移。detect-patterns 已内置 ob-io 家族与自引用解码器告警。
3. **同站邻题不迁移算法假设**：同平台相邻题号（match22 的 Salted+AES vs match23 的魔改 MD5）算法结构与"真实浏览器行为基准"都可能不同（22 的对拍基准 Chrome 暴露 WindowProperties，23 的取证 Firefox 不暴露）——每个 case 的环境分支证据必须来自**本 case 的 trace**（instanceof 记录的缺席 = typeof fallback 的直接证据），历史案例只提供方法论。
4. **trace 折叠与调用计数**：RuyiTrace 对重复调用序列有折叠（elision），"只出现过一次"≠"只调用过一次"（match23：md5 实际 2 次调用但 charCodeAt 读数会话只记 1 组）。判断真实调用次数/输入长度，用**未被折叠的辅助函数计数**反推（轮函数/加法器调用数 ÷ 单次哈希用量），不要凭读数会话数下结论。

## 十五、沙箱对拍：逐位 diff 判分布（match24 实证）

### 30. 沙箱与浏览器输出对不上时，先做逐位 diff/XOR 看分布，再决定是"就地修正"还是"逐环节对齐"

黑盒沙箱跑通但 token 被服务端拒、或与浏览器对拍不一致时，最容易犯的错是把分歧归因成"某个未知的环境读取"，然后逐环节堆环境对齐——范围越查越大、轮次越耗越多。破局第一步是**把两侧的中间输出（VM 状态数组、字节流、token 分段）做逐位异或/差值，看分布**：

- **差值是常数**（match24：TL[11..] 起恒差 `XOR 30`）= **一次性注入的状态偏移**——某个状态量在两侧差一个常量，之后被链式地保持住。这种形态**补环境消除不了**（它不是环境读取本身，而是状态初值的落点），正确做法是**在 VM 输出上就地修正**（对状态数组逐元素 XOR 常数，让 VM 自己完成后续序列化），即可与浏览器逐字节一致。
- **差值逐步发散** = 链式差异，才需要逐环节对齐环境（回到规则 28 / 反模式 23 的分支漂移排查）。

判定后还要反向验证：差值是常数时，位置 0 起应有一段**完全一致**（match24 前 5 字符一致、第 6 字符起才分岔），这确认了"初态一致、某处一次性注入偏移"的形态，而非整体错位。

配套要点（match24 实战）：① VM 探针必须走**直达路径**（分发器第一个形参的 `[1][0].time_list`）——递归扫描版在每指令一次的调用频率下直接 OOM；② 钩子必须装在 `vm.createContext` 的**沙箱 realm 内**；③ 就地修正记录已处理长度（不可枚举属性）防重复异或；④ **修正输出而非输入**——改 `charCodeAt` 让材料变形会让链式密钥流跟着发散。

## 十六、约束边界先实测 + 随机环境值的补法（match24 实证）

### 31. 疑似"超时/时序/频控"问题，先实测约束边界再改代码——不要凭直觉加等待/补偿/重试

黑盒产物被服务端拒，第一反应常是"生成太慢超时了"→ 于是加时间补偿（提前量）、加重试、加等待——match24 曾为此加了 `LEAD_MS=8000` 补偿和整套失败重试，实测后全部删除：**真正的约束是"token 生成到请求到达的 age ≤ 2~4 秒"，而瓶颈是"一次构建 5 页要依次派发 4 次点击（7.6s）"不是"需要时间补偿"**——改成按页构建（跳过中间页，0.8~2.1s）后 age 天然落在窗口内，零补偿零重试。

纪律：
1. **先实测边界**：同一 token 递增延迟重放（736ms/2019ms/4016ms/6016ms/8015ms），把"通过/拒绝"的阈值打出来（match24：≤2s 过、≥4s 拒），再判断当前实现落在哪一侧。
2. **改掉"慢的根源"，而不是"为慢做补偿"**：先问耗时花在哪（match24：是逐页点击序列化派发，不是计算本身），去掉根源后往往不需要任何补偿。
3. 补偿/重试是"约束不可消除"时的最后手段，且必须写清触发条件与上限；用实测边界证明需要它，而不是默认需要它。

### 32. 随机环境值（jQuery expando 等）按"格式正确 + 运行时随机"补，不固定对齐；先判断服务端校验"精确值"还是"结构自洽"

VM 读取页面运行时产生的随机量（match24：jQuery expando `jQuery341062000212550838322`，每次页面加载不同）参与 token 派生时，**不要把它当成需要逐字节对齐的环境指纹**：服务端不校验 expando 的精确值（任意随机值都能过），校验的是 token 内部的**结构自洽**（part2 = 变换输出指纹必须自洽）。补法：

1. **格式正确**：同格式生成（match24 是 `jQuery` + 18 位数字），运行时随机，不写死副本。
2. **先判断校验维度**：用"一个随机值 + 一次真实请求"验证服务端是否接受——接受则只保格式，拒绝才考虑固定对齐或找其他分歧。
3. 与"固定对齐类"环境值（UA、时区、构建时钟）区分：后者服务端可能精确校验（match24 的 UA 绑定），前者只保随机性结构。
4. **同一判据要从「随机量」扩到「整条编码链」**：参数看着穿了位打包 + 滚动校验和 + XOR keystream + 自研 base64，
   **不等于每一层都被服务端校验**。交付形态定案（沙箱 vs 纯算闭式）前，先跑一组受控单变量请求把边界打出来——
   缺参数 / 换载体（规则 49）/ **结构合法但内容全伪造** / 改内嵌时间戳 / 截断 / 重放 / 时间戳超前——再决定要不要还原闭式；
   （信封型的可操作用例全单与易错点见 `references/crypto/crypto-entry.md`「信封型」节，共七个。）
   实证：mashangpa 题15 的 45 字节指纹结构体，伪造内容体（合法长度 + 合法 ts）照样 200，服务端实际只校
   「载体存在 + 解码后定长 + |Δts| 在窗口内」；据此把交付停在最小沙箱黑盒，省掉 18 个字段位宽与 XOR 递推常数的还原。
   反例即按「编码链长度」推断必须闭式还原——链长是客户端混淆强度，不是服务端校验强度。

## 十七、环境桩执行位置与时间窗口量化（match25 实证）

### 33. 环境桩必须在沙箱内执行——self-reference 自检失败会产出"格式全对但服务端全拒"的签名

环境桩里凡涉及自引用的赋值（`win.window = globalThis`、`win.self = winProxy` 等），**执行上下文必须是沙箱本身**：
桩代码在 Node **主 realm** 定义时，`globalThis` 绑定的是主进程全局对象；目标混淆 JS 在沙箱里执行
`function(){return this}()` 拿到沙箱 globalThis，两者不等 → `window.window == function(){return this}()`
自检判 false → 误走错误分支（match25 是 `_$VM=111`）→ token 全错 → 403 token failed。
症状与反模式 26（webpack `n.g` 缺失）一模一样，但根因在运行位置。纪律：

1. 环境桩写成独立脚本文件，随目标代码一起 `vm.runInContext(envCode, sandbox)`（或 `run_with_trace.js --env-module`）执行；
   模块间用 `globalThis.__M25_*` 之类命名空间传递对象。
2. **同输入双环境对比定位**：同一环境桩分别"沙箱内执行"与"主 realm 执行后注入"，同输入各跑一次目标函数，
   输出逐字节比对——不一致即命中运行位置问题（match25 一锤定音，比逐环节排查省十几轮）。
3. 环境桩文件**不要用 IIFE 包裹**：check_code_quality 把 IIFE 主体当单函数，行数=文件行数必超 90；
   >500 行 + 多类 WebAPI 判「补环境主体堆叠」。用顶层代码 + 具名函数（<90 行）+ `Object.assign` 合并方法集，
   拆 `src/env/browser-objects/{dom,window,jquery,webapi}.js` 按职责分文件。

### 34. 签名内时间戳先做 T 偏移矩阵量化服务端窗口，再决定是否补偿

token 含 `+new Date`/`Date.now()` 派生时间戳且服务端 403 时，对 now 做 ±N 偏移（如 −100s~+30s 十几档）
各生成 token 请求，看通过区间：**全过** = 服务端不校验时间窗口 → 直接冻结 Date=getTime 返回的服务器时间戳最稳，
无需时间补偿/重试（match25 实测 ±100s 全 200）；存在窗口则按区间中值冻结并保持 getTime→生成→请求 <1s。
与规则 31 同精神：先量边界再动手，不凭直觉加 LEAD_MS 类补偿。

## 十八、JSVMP 字节码字面量直读纯算 + 会话绑定与限流判别（match28 实证）

### 35. JSVMP 不一定非要黑盒——先扫字节码数字字面量判断标准算法族，命中即转纯算

JSVMP（单行 VM + 字节码串）的字节码尾部常含**大数字面量序列**（如 `m324665p2098959o9832905...`），
这是 JSBN 类大数库的 **28-bit limbs**（RSA 模数/公钥）或算法常数。先扫字节码找数字段、判断标准算法族
（RSA/AES/哈希），命中标准算法立即转纯算——match28 实证：token 是确定性 RSA-1024（明文
`/api/question/28`+now+`28$`+page，PKCS#1 填充固定 0x01，指数 65537），limbs 直读 + Node BigInt 模幂 +
JSBN hex2b64（3 hex→2 b64 非标准 base64）即可复现，**完全不需要跑 VM**；黑盒调试（run_with_trace 的
bootstrap 与 VM `(p.v=p.apply).v=p.call` 元编程冲突、逐 opcode 插桩）全是弯路。
两条子规则：

1. **确定性 padding → 本地对拍**：PKCS#1 填充固定 0x01（非随机）时 token 可对拍——用 capture 真实样本
   （now+page → token）逐字节比对，零成本验证后再发真实请求。
2. **limbs 出现序 ≠ 数组序**：字节码里 limb 字面量的压栈顺序与构造数组的顺序可能不同，按出现序拼模数
   会得到错误 N（token 长度对但全拒）→ 必须用对拍修正数组顺序。

### 36. 数据绑定 sessionid：同会话恒定 ≠ 跨会话相同，换会话必须重算答案

同 sessionid 数据恒定（可做 fixture 回归），但**不同 sessionid 数据完全不同**（match28 实证：旧会话
page1 `[263432,...]` vs 新会话 `[636803,...]`，总和差 ~180 万）。换会话（尤其用户重新登录提供新
sessionid）后必须用新会话重新采集计算答案，不得复用旧答案；换会话先 `GET /api/user` 验活
（`isLogin:true`），数据接口往往不校验登录仍 200 容易误判。

**更极端形态：同 sessionid 数据也可能每次请求随机**（mashangpa 题10 实证）。题10 服务器对固定
sessionid 每次请求返回不同随机数组，两轮拉取求和可能碰巧一致（97664）造成"数据确定"假象，实际提交
时需实时拉取重算（103727）。**判定纪律**：① 不默认"固定会话数据恒定"——先两轮拉取对比，但仍需在
**提交前最后一步**用当前会话实时重拉一次并立即提交（含答案时效窗口，题9/10 均为 1 分钟内）；② 单次
采样"两轮一致"只证明短窗口稳定，不能证明提交时刻仍有效；③ 同平台逐题验证数据稳定性（题9 恒定可
fixture、题10 随机不可复用），不跨题套用。

### 37. 站点限流 vs 签名错误的判别——"第 N 页起 403 token failed"先做单请求诊断

连续快速请求时约第 3 页起 403 `token failed`、而单请求/第 1/2 页正常 = **频率墙限流**，不是签名错
（同文案，match19 教训"错误文案不指示病因层"）。判别：单独发一次 page=1（fresh now+token）→ 200 即签名
正确。应对：页间 3s + getTime 后 300ms 间隔 + 重试前冷却 3~4 分钟（恢复期长，反复重试持续触发）；
**采集与提交解耦**（算好答案后 `--submit --answer <总和>` 单请求提交不受限）。

### 38. X.509 SPKI hex 公钥 + getRandomValues = JSEncrypt 随机 RSA → publicEncrypt 纯算 + X 值扫描实证明文常量

混淆 JS 内 `30819f300d06092a864886f70d01...`（rsaEncryption OID 头）开头的 162 字节 hex 字符串是
**标准 X.509 SPKI 公钥 DER**（`indexOf(Buffer.from([0x02,0x81,0x81,0x00]))` 定位 128B N），配合加载期
`crypto.getRandomValues(Uint32Array 256)`（PKCS#1 随机填充源，无 `crypto.subtle` = 纯 JS 加密库）→
**JSEncrypt 随机 RSA**（与 match28 的 JSBN limbs 确定性 RSA 互补）：`publicEncrypt({key, padding:
RSA_PKCS1_PADDING})` 直出，无需沙箱，token 每次不同属预期（服务端解密校验明文，200 即签名正确）。

明文含运行时未知常量（如 `N + window._$v`）且公钥有多个候选时，用**候选 X × 候选公钥扫描实证**：
对 X ∈ 小整数集 × 各候选公钥逐个 `publicEncrypt` 生成 token 发真实请求（每请求 300ms 间隔防限流），
找到 200 的那组即定案（match27：pubkey1 + X=27 → 200，X=28/pubkey2 全 403，证明服务端校验明文确切值）。

**沙箱跑通 + token 结构像 ≠ 服务端接受**：黑盒沙箱自洽产出签名但仍 403，可能是**环境依赖的数值常量**
算错（match27 实证：`_$v` 依赖 `document.all["pgxDebug"]` 分支，桩导致 N+_$v≠27）——与 match21/26 的
环境分派诱饵分支、match25 的 realm 自检都不同。当算法可纯算（公钥/模数可提取）时**直接转纯算 + 扫描
实证，不要死磕沙箱环境对齐**。

### 39. JSVMP 业务逻辑反序列化经 eval 执行——RuyiTrace eval 分类日志直接落盘业务源码（match29 实证）

vmpzl 系 VM 执行到业务层时通过 **eval 执行"反序列化生成的 JS 源码"**。RuyiTrace 的 **eval 分类日志**
（`logs/eval/trace_eval_process_*.ndjson`）记录该 eval 的完整源码并落盘 `logs/eval/eval_<pid>_<seq>_eval-direct.js`，
**绕开 LZ 压缩/字节码/VM 指令三层直接拿到业务逻辑源码**。用法与特征：

1. **识别**：JSVMP 文件是 `eval((function(){...VM 编译器...})())` 包裹（页面脚本可能**全部 VM 化**，
   match29 三脚本 _jquery/_common/29.js 各对应一个 eval 落盘文件）；尾部常有 `$fast_unpack("LZ.xxx")`
   （自定义 LZ 压缩字节码）——有 eval 就有落盘，无需手工解压字节码。
2. **定位**：grep eval 源码里的 `token` / `case 64`（vmpzl 编译产物里请求 data 构造常在 switch-case 中）
   找参数拼接点，再逆变量赋值链。eval 源码变量名是 `_$`+随机（每次加载不同）但**结构稳定**——
   token 拼接点在相邻 `case` 之间以字符串拼接形态固定出现（match29：`case 3` 与 `case 64`）。
3. **判定算法可算性**：哈希函数体内有 rotl + 32 位加法 + 消息填充 = MD5/SHA 结构；标准 K 表十六进制/
   十进制全搜不到 = **魔改**；配合 46 项 `typeof X==="..." && X.xxx` 环境探测 → 不可纯算，黑盒执行
   （环境桩须让探测全 true：`Symbol.toStringTag` 补 `[object HTMLDocument]`/`[object Navigator]`，
   `document.all.pgxDebug` 恒 falsy 保证 `_$v=0`）。
4. **手写 LZ 解压/反编译字节码是死路**（反模式 37）：`LZ.` 前缀压缩 + WAFJ 魔数 + bit 流解压极易出
   bug，eval 日志已把解压后的业务源码直接落盘，先查日志再动手。
5. **页面自驱动翻页的 now 注入**（match26 同款再实证）：每次翻页前注入新的服务器时间再触发
   `#pgxNext` click——页面自身走"getTime → 算 token → ajax"链路，天然复用会话内递增计数器；
   沙箱必须跨页复用（token 材料含 counter，重建沙箱会让 counter 回初值）。

## 十九、AI 协作：大体积材料的处理纪律

### 40. AI 负责组织证据与缩小范围，不负责猜答案——大体积材料先脚本聚合再分段阅读

逆向真正卡住人的往往不是"看不懂算法"，而是"信息太多"：指令插桩轨迹、NDJSON trace、反混淆产物动辄数万行到几百 MB，逐行人工翻不现实。此时 AI 的正确定位是**稳定地组织证据、缩小范围、验证猜想**，不是替人猜算法/猜签名构造。

正确做法：

1. **先聚合再阅读**：用脚本按维度分组统计（handler/信号类型、`stack.file`、seq 片段、命中关键词计数）产出摘要，再让人或 AI 读摘要定位候选区，最后只读命中的切片。聚合脚本优先复用现有工具（`capture_ruyitrace_log.js` 摘要、`identify_crypto.js`、`collect-residue-metrics.js`），不手写一次性分析器。
2. **AI 结论必须回落到证据坐标**：任何由 AI 阅读得出的判断（分支走向、算法族、参数构造点）都要能指到具体证据行（`seq`/`file:line:col`/日志片段），否则只算假设，不进结论、不驱动 IMPLEMENT。
3. **AI 适合的任务**：批量规则改写（写 AST 还原插件/插桩器）、跨文件一致性核对、日志聚类与异常提取、按假设生成对照实验代码。
4. **AI 不适合的任务**：跳过证据直接给"答案"；以经验替代本次 trace/取证；在缺 Step 2 证据时用"AI 推断的算法"填坑。

反例：面对几万行指令轨迹直接问 AI"这个算法是什么"并采信回答——没有证据坐标的答案无法验收（规则 30 对拍、规则 23 大样本统计均无法执行）；或让 AI 生成一遍"看起来对"的签名实现，跳过 `verify_signer_offline` 直接发真实请求（违反 IMPLEMENT 准入三件套与 REAL_VERIFY 前置）。**AI 参与不改变门禁权威**：`state_machine.js --guard` 与 `check_*.js` 校验序列仍是唯一放行依据。

## 二十、自同构校验与 wasm 边界捕获（设备指纹 SDK 实证，详见案例库）

### 41. 「官方包 200 / 重建包必 500」= 自同构校验信号，先查自喂输入再谈环境对齐

当签名型 SDK 在真实页用官方包请求通过，而沙箱/反混淆重打包/插桩版本**同机同页同输入**恒被拒，且唯一变量是 JS 包本身时，优先怀疑 **SDK 把自身构件喂进了指纹计算**：捕获 wasm 导入返回值即可确认——出现「返回脚本源码全文」「返回 wasm 自身字节（`0061736d` 魔数头）」即为实锤。此时逐槽对齐环境取值、全量回灌真机值、TLS 替换、内存快照全部无效（三个输入是：脚本源字节、wasm 字节、来源类复合槽如 `currentScriptSrc`），正确动作是**停止环境层修补**，转「透明边界捕获 + 直接 wasm harness」（`env-wasm-advanced.md` 专节）。配套纪律：画像、脚本源、wasm 二进制按同一次会话**成对固化**并各自 sha256（存在两个长度相同字节不同的 wasm 构建时，混用即静默被拒）；指纹 ground truth 不得采自 file:// 探针页（来源类槽携带本地路径污染而不自知）。

### 42. 透明边界全量捕获优先于 wasm 全量逆向——成本差两个数量级，一次会话捕获即固化全部输入

签名型 wasm（导入由 JS 闭包提供、无隐式外部 I/O）不必逆向 WAT：用透明 hook 包裹 `WebAssembly` 构造器（prepend 进 SDK JS 响应体主 world，**不是** `add_preload_script` 独立 world），记录导入调用序 + 全部返回值（结构体 verbatim 字节 + 返回 ptr + f64 数组 + NUL 串）+ 导出调用序 + 输出字节，即得「真机当次调用的完整输入」。hook 必过两个坑：`instantiate(module, imports)` 的 module 重载解析结果是 **Instance 本体**（非 `{module, instance}`），只处理后者会让导出包裹静默失效（exp=0 无报错）；内存导出名不一定是 `memory`（用 `instanceof WebAssembly.Memory` 探测）。捕获前先做**透明性验证**（官方包+hook 走完整链路业务 200），观测无副作用才可用。

### 43. fresh 生成优于字节级回放；载荷自包含性用实验测定，不默认注册

wasm 输出 = f(线性内存, wasm 全局, 导入值)，全局变量（堆指针/状态机）从 JS 不可恢复——**跨实例内存快照恢复是结构性死路**（恢复 7MB 后 pre-hash 一致仍 OOB，反模式 40），不要试图字节级复现历史会话。正确目标是用捕获的真实设备输入 + 运行时时间/随机做 **fresh 生成**：fresh 实例自带一致的 (初始内存, 初始全局)，产出载荷自洽即可被服务端接受（真机自身的时间/随机也每次漂移）。配套两个减负实验：①`导入调用序`每次运行漂移（24~27 条、分支性导入出现/消失），交付侧导入实现为幂等动态函数，不按静态表硬编码；②**载荷自包含性实测**——跳过注册上报直发业务接口，若 200 则注册非必需，交付流程少一次请求足迹。不确定的输入语义（如异或对的位宽语义）用双变体实测定夺，不靠猜。

## 二十一、工具链根因定位与交付入库（ruyipage 1.2.62 实证）

### 44. 工具高层封装报「不支持」时，先定位库层参数根因再判定能力缺失——误判会污染证据链

`page.add_preload_script()` 在 ruyipage 1.2.62 + Firefox 155 恒抛 `BiDiError: unsupported operation: The command does not support browsing contexts in privileged scope`（**IIFE 与函数声明两种形态都抛**，不是「IIFE 静默不执行」那条已知坑）。据此下「本环境没有 hook 能力」结论，会把 writer 级调用栈证据整个放弃，退化成只靠源码静态判读——实战为此白跑三轮取证。

根因在库层而非内核：`FirefoxBase.add_preload_script` 无条件传 `contexts=[self._context_id]`，FF155 privileged scope 不接受该参数；底层 `ruyipage._bidi.script.add_preload_script(driver, fnDecl)` **不传 contexts 即注册成功**。实测该路径落在**页面主 world**（页面自身脚本发的 2 次 `fetch` 被 hook 包装计数、hook 写的 `window.__hookWorld` 可被 `run_js` 读到、`remove_preload_script` 生效），故「preload 必是独立 world」不能当默认前提（规则 42 的响应体 prepend 路线仍是 wasm 导入捕获首选，但先做一次同 world 验证再选路）。同一封装的连带受害者：`page.set_bypass_csp()`（内部调同一方法，同版本同样抛错）。

纪律：①报「不支持/不可用」前先读 site-packages 里该方法实现（分钟级成本）；②查同族已有补丁（本仓 `forensic_ruyipage.py` 的 `_apply_ruyipage_capture_compat_patch` 处理的 `session.subscribe` 是同一根因家族）；③用「同一命令换参数」的反例实测一次再定性；④定性写成「库层封装缺陷 + 绕过方式」，不得写成「能力不可用」；⑤`forensic_ruyipage.py` 已内置 `_apply_ruyipage_preload_script_compat_patch()` 与 `--preload-script <JS|文件>`，hook 仍必须带执行标记并核验（坑 2）。

**判定测试**：你的「工具做不到」结论，是否有一个"同 API 少传一个参数就成功"的反例没测？

### 45. 交付前对 `result/` 全量跑一次 `git check-ignore`——门禁豁免目录名可能与 workspace `.gitignore` 撞车

交付规范把取证落盘的原始 JS/wasm 副本放 `result/src/target/original/`（`check_code_quality.js` 对该豁免路径不查压缩/单行长度）。若工作区 `.gitignore` 含 `**/original/`（常见的前端/取证忽略项），**这个目录连同其中的 wasm/二进制资源会被静默排除版本库**：本地跑通、别人 clone 后入口直接报文件缺失，且交付过程零报错零警告。

纪律：DELIVER 前对 `result/` 逐文件 `git check-ignore -v <path>`（或 `git add --dry-run result/`）；命中即把资源改放不被忽略的路径（如实测改用 `result/src/wasm/`），或在 `最终项目总结.md` 显式写明「该文件需 `git add -f`」。二进制入库后仍要保留入口侧的 sha256 启动校验（规则 25 同源要求），入库成功 ≠ 版本正确。

**判定测试**：把 `result/` 拷进一个干净目录（或 fresh clone）后，交付入口能否零改动跑通？

### 46. skill 自身安装残缺（只有 `SKILL.md`）时按「手工等价登记」继续，不得误判为外部工具缺失去重装

`~/.qoder-cn/skills/js-reverse-skill/` 只装了 `SKILL.md` 而无 `scripts/` 时，状态机与门禁脚本（`state_machine.js` / `check_evidence.js` / `check_trace_gate.js` / `forensic_ruyipage.py` / `capture_ruyitrace_log.js`）全部 FileNotFound。这**不是** ruyipage/RuyiTrace 未安装（`tools/` 与 pip 包可能完好），跑 `install_all.js` 只会重装外部组件、仍缺脚本。

纪律：①先分辨「skill 自身残缺」与「外部工具缺失」（`ls <skill 目录>/scripts` 一条命令）；②残缺时把 SKILL.md 要求的门禁改手工等价——`case/state.json` 手写节点与 history、`case/notes/entry-chain.md` 承担证据链、取证驱动脚本落 `case/tools/`；③在 `最终项目总结.md`「偏差与未完成项」显式声明哪些门禁未机器化、证据以何种等价物替代；④**严禁**因脚本缺失而跳过 Step 2 证据要求——按 `ruyi-tooling.md` 的可用通道（含规则 44 的 hook 绕过）补真机证据；⑤手工复刻 ruyipage 驱动前，先读 `forensic_ruyipage.py` 已内置的兼容补丁清单（二进制 body 无损读取、capture 订阅降级、防挂超时），否则会把已修的坑重新踩一遍（实测：自写驱动用文本通道取响应体，wasm 被 U+FFFD 破坏 229B→241B 且无报错）。

**判定测试**：你重装的到底是外部工具，还是 skill 自身的脚本目录？两者路径不同、结论不同。

### 47. 目标签名器自身抛错 ≠ 补环境不足——先用还原算式对同一失败输入打真实接口判别

**实证来源**：mashangpa 题12（JSVMP 自实现 SHA-1）。官方 `pagination12.js` 的字节码对约 4% 的 `(page, t)`
组合稳定抛 `Q0OQO0O.apply is not a function`（同一 `t` 必抛、连续时间戳最长失败段 ≤2），沙箱里 1:1 复现；
题面自己给了用户侧处置「如果页面数组无法显示请重新从首页访问即可」。把这类失败输入改用**还原出的纯算 `m`**
打真实接口，服务端 4/4 全返回 200 + 正常数组 ⇒ 判为**目标客户端实现缺陷**，不是环境不足，也不是校验策略。

**具体操作**：①先量化"是不是自抛"——固定 page 扫连续 `t`（数百个）统计失败率与最长连续失败段，随机散布且段短 = 输入内容相关缺陷；
②用已对拍通过的独立实现（纯算式或另一条代码路径）对**同一批失败输入**发真实请求；
③服务端接受 ⇒ 转独立实现为主路径、把抛错的一方降级为对照器；服务端拒绝 ⇒ 才是环境/分支未对齐，继续按 规则 28/29 对齐。

**反例**：看到沙箱偶发抛错就认定"还差环境项"，继续加 `canvas`/`performance`/realm 桩并反复重跑——
本 case 该缺陷在真实浏览器里同样存在，桩补得再全也不会消失，会把 IMPLEMENT 拖成无限循环；
另一个反例是把它当成"站点有随机性"，回头去枚举算法组合或给请求加重试掩盖（重试掩盖 ≠ 判别）。

**正确做法**：判别动作要在"交付主路径选型"之前完成，并把结论与证据（失败率、连续段、真实接口 200 计数）
写进 `case/notes/` 与经验沉淀；交付物注明"站点自身缺陷 + 本实现如何规避"，避免后续维护者再判一遍。

**判定测试**：这个抛错在**真实浏览器**里同输入也会发生吗？答不出就先做这次判别，别继续补环境。

### 48. 「锁随机源」探针失效 ≠ 无随机性——按「锁随机源 → 锁时钟 → 受控扫描」二分，小值域即折叠索引信号

**实证来源**：mashangpa 题14（URL query 签名 `m=base64(CODE4+ts+NUL)`）。签名的 4 字符前缀 `CODE4` 被误判为
随机盐：沙箱里锁 `Math.random=0.5` 后它**仍然逐次变化**（且沙箱中 `crypto` 为 undefined，熵不可能来自 WebCrypto）
——这恰好证明它**不是**随机量而是**确定性哈希**。改桩 `Date` 构造器把 ts 冻结后，CODE4 连续 12 次调用完全不变，
即证明 `CODE4 = H(ts)`；再对 320 连续 ms + 200 步进 7919ms 共 520 个受控 ts 扫描，发现取值域**恰 16 个固定值**
（结构 `(0x10+a)<<8 | (b[a]^(c?0xDE:0))`，同一 `a` 的两成员恒相差异或 `0xDE`）⇒ 4 bit 折叠索引。

**具体操作**：① 锁 `Math.random` 定值重复调用——输出定住 = 随机盐（题13 的 `r`），照变 = 确定性哈希，**立即停止找随机源**；
② 改锁 `Date` **构造器**（不是 `Date.now`，站点常用 `new Date().getTime()`；vm 内冻结必须写 context 侧，
见 `env-debug-loop.md`「沙箱内时间/随机冻结不生效」）——输出定住 = 时间派生；
③ 受控 ts 扫描（连续段 + 大步长段各一批）统计**取值域大小**：值域极小（2^n 量级）⇒ 先挖结构
（配对关系/异或恒等/查找表），值域大 ⇒ 才考虑还原哈希闭式。

**反例**：锁 `Math.random` 无效后继续找别的熵源（PerformanceAPI、地址熵、内部 PRNG），在源头上空转——
本题若沿此路会错过「锁时钟一击定音」；另一反例是值域只有 16 个却去硬啃 520 组样本拟合哈希闭式
（本 case 排除了 mod/shift/digit-sum/djb2/FNV/XOR 折叠/GF(2) 线性组合仍无解），而服务端接受黑盒产物时
闭式只是「去依赖」优化项，不是交付阻塞项。

**正确做法**：黑盒执行站方原始脚本、以**真机同输入**驱动并要求**逐字节一致**（`compare_fixture`），
即是分支对齐的最强证据（真机出现过的输出落在沙箱输出集合内 ⇒ 非诱饵变体，免规则 29 的 nativize 对拍）；
闭式还原记入总结的「后续建议」，不阻塞 REAL_VERIFY。

### 49. 同值多载体参数（Header 与 Cookie 同时出现）——先单变量定「哪个载体被校验」，否则会往错方向排障

**实证来源**：mashangpa 题15「cookie对抗」。签名以 `hexin-v` 请求头 + `v` cookie **同值双发**
（trace 同一轮内既有 `Headers.append("hexin-v", v)` 又有 `Document.set cookie` 写 `v=`）。
默认推定「头是被校验的那个」，单变量对照实测：**只带 Header → 拒（HTTP 200 包业务码 400）；只带 Cookie → 过**。
载体判错时「签名算法完全正确却被拒」会被误读成算法/环境未对齐，从而白跑补环境轮次。

**具体操作**：①取证阶段就把同一取值的**全部出现位置**列清（trace writer 点 × 真机请求头 × cookie 三处对齐）；
②发真实请求前，对每个载体各做一次「只带它」与一次「去掉它」——两次请求即可定案，成本远低于事后误判；
③结论写进 `case/notes/` 与经验沉淀，交付按「被校验载体必带 + 其余载体按真机形态同带」实现；
④与 `analyze_cookie_attribution.js` 的**生成方**归因（server / js / both）分开——**生成方 ≠ 校验方**，
该脚本回答"谁写的"，本规则回答"服务端认哪个位置"。

**反例**：浏览器发了 Header 就认定服务端校 Header；或反过来把 cookie 里的同名值当静态凭据硬编码进交付
（它是每请求重算的动态值，属第 3 节禁止的"把动态秘密复制进代码"）。

**正确做法**：请求侧参数的三个正交维度各自实测——**存在性**（缺了会不会拒）、**载体**（校哪个位置）、
**内容强度**（伪造值会不会过，见规则 32 第 4 条）。三者都只有真实请求能回答，读源码至多给出假设。

**判定测试**：把这个参数从 Cookie 挪到 Header（或反过来）再发一次，服务端反应有区别吗？
没做过这次对照，就不要在总结里宣布"参数校在 X 上"。

## 二十二、黑盒签名 SDK 的沙箱执行与还原深度判定（mashangpa 题16 实证）

### 50. 黑盒 SDK「返回 Promise 但永不 settle」——先补异步调度泵并记录回调异常，再怀疑环境检测分支

**实证来源**：mashangpa 题16（上游电商 h5st 协议的移植版签名 SDK `PcSign.js`，在 vm 沙箱执行；
协议血统与平台细节见 `cases/body-carrier-h5st-remote-algo-mashangpa-p16.md`）。症状全套"看似被反调试拦住"：
官方 JS 顶层确实执行（`window.PcSign` 已挂载、`loadPage` 可调用、localStorage 有写入），
`sign()` 返回 Promise 但 5 轮全不 settle，**零报错**。补上
①`MutationObserver.observe()` 真把回调排上一轮（`Promise.resolve().then(cb)` + `setInterval` 泵）+
`MessageChannel`/`setImmediate`/`postMessage` 可派发，②沙箱 XHR 事件回推逐个 `try/catch` 并记
`xhr.handler-error` 之后，**同一入参第一次调用即出值**。

**具体操作**：按固定顺序试，不许跳步——①调度四件套 → ②网络回调异常记录 → ③才进
规则 28/29 的"值对≠对齐/诱饵变体"与逐字段指纹对齐。最小实现见
`references/env/env-debug-loop.md`「异步死等：签名 Promise 永不 settle」。

**反例**：一见不返回就补 canvas/WebGL 真值、去跑整包反混淆、或断定"该 SDK 有引擎检测只能靠真机"
（本题取证浏览器确实另有引擎级阻断，但那是**另一条独立结论**，见规则 51 与
`env-detect-bypass.md` 的 C 形态——两者混淆会让"沙箱本可跑通"这件事永远发现不了）。

**判定测试**：在沙箱里 `Promise.resolve().then(()=>log('pump'))` 能打出，而 SDK 的 `.then` 打不出
⇒ 它用的不是原生 Promise，去查它自带的调度器读了哪些全局。

### 51. 摘要算法本体由服务端下发（RAC 形态）= 还原深度的止点，不要追闭式

**实证来源**：mashangpa 题16。签名 SDK 运行时向 `cactus.jd.com/request_algo` POST 设备指纹，
响应的 `data.result.algo` **就是一段 JS 源码串**（`function test(tk,fp,ts,ai,algo){…return algo.MD5(str)}`）
＋ 远程 `data.result.tk`，客户端 eval 它再算摘要（`fv=h5_file_v5.0.6`，URL 里 `?v=<yyyyMMdd>` 按日更新）。

**为什么这是止点**：闭式不存在——算法是服务端此刻决定的，今天还原的式子明天随版本变。
交付的正确形态是**沙箱黑盒执行官方 JS + 网络桥接上游**，把上游当"动态资源"对待
（`references/network/dynamic-resource.md`：启动抓取 + sha256 对比 + 本地副本回落），
并在 `manifest.json`/总结里显式写明这层外部依赖与失效表现。

**与规则 32 第 4 条 / 规则 49 构成三判据**：决定"要不要啃编码链闭式"的**不是链的长度**——
本题编码链很短但服务端真验内容（伪造同长度签名直接拒）；题15 编码链极长（位打包+校验和+XOR+自研 base64）
但服务端只验长度与时间窗（伪造内容体照过）。三判据各自实测：
①**存在性/载体**（规则 49）、②**内容强度**（受控伪造样本打靶）、③**算法是否本地可得**（本规则）。

**判定测试**：把 SDK 的哈希入口打桩截获"它 eval 的函数源码来自哪个响应字段"。若来源是网络响应，
立刻停止闭式推导，转 ② 的打靶结论决定交付深度。

### 52. 拿不到真机 oracle 时，fixture 固化为「结构基线」而非逐字节值，并显式标注证据替代关系

**实证来源**：mashangpa 题16——Step 1 真机签名样本因引擎级阻断完全拿不到，
但 SDK 内嵌 ts 自取（`sign` 内部再 `Date.now()` 一次，与调用方传入的 t 差几毫秒），逐字节本不可复现。

**具体操作**：fixture 只固化**结构不变量**（字段数、各段长度、前缀、字符集判定），
入口 `--selftest` 用同一套键现场生成再比对；fixture 文件与总结里写明
「结构基线，非逐字节 oracle；逐字节级验证由**服务端接受该产物**承担，
且**伪造同长度值被拒**即为反向证据」。这样既满足 REAL_VERIFY 的离线回归要求，
又不会把「自己生成、自己对拍」读成自证。上游改版监控同样落在结构基线上（`f6Version`/段长变化即 FAIL）。

**反例**：把一次沙箱产物的完整签名值写进 fixture 当期望值再让交付码去复现同一串
（时间戳一动就 FAIL，且容易顺手改成"从样本里取参数"——踩第 3 节红线）；
或在只有 fixture 自对拍的情况下直接宣布"与真实浏览器一致"。

**判定测试**：fixture 里任何一个字段的期望值，是否在服务端**收到过**？没有，就不要称其为真机基线。

## 二十三、响应侧加密还原的库语义与时间参数判定（mashangpa 题19 实证）

### 54. crypto-js 家族有两种 `decrypt` 语义——按调用点第二实参类型定密钥语义，不按"库里有没有 KDF"

**实证来源**：mashangpa 题19（响应体 `{"r":base64密文,"k":24 字符密钥}`，站方 `19pro.js` = 未混淆 crypto-js 打包副本 + `DES3` 包装）。
打包文件里 `MD5` 命中 4 次、`EvpKDF` 定义在场，看起来像"口令派生 key/iv"，实际**一次都没调用**——
目标链是 `CryptoJS.TripleDES.decrypt(cipherText, enc.Utf8.parse(k), {iv, mode, padding})`，
第二实参是 `enc.Utf8.parse(k)` 产出的 WordArray ⇒ 直接密钥路径，密钥原样当 3DES key 用，零派生。
（`CryptoJS.<算法>` 一律由同一个 `Cipher._createHelper` 产出，内部分叉在实参类型——静态看出处分不出两条路径。）
误判成 passphrase 路径会导致解不出、进而误升级成"要补环境跑官方 JS"。

**具体操作**（三步，全部在落盘源码里做，不需运行时）：
① 读调用点第二实参：`enc.*.parse(...)` 产出或 WordArray ⇒ 直接密钥；字符串口令 ⇒ 派生路径（`cfg.kdf` 参与）；
② 看密文串**自身**有无容器魔数——`Salted__`（`53616c7465645f5f`）前缀才是 OpenSSL 派生格式（走 EvpKDF，见
`cases/yuanrenxue-match22-openssl-salted-alphabet-branch.md`）；Salted__ 容器 = 16 字节头 + 块对齐密文，
「裸 base64 且块对齐」不能当直接密钥型判据，魔数只看前缀；
③ 用 `grep -c` 统计候选哈希/KDF 的**调用点**（`X.execute(`、`Hash(` 形式），只有定义无调用点的即打包死代码，不进还原链。
操作细则落 `references/crypto/crypto-entry.md`「库语义判定：同一算法的两条调用路径」。

**反例**：看到文件里有 `MD5`/`EvpKDF`/`HmacSHA` 就假设参与派生；或反过来"标准库一定按标准用法"，
不查 Helper 就照 `createDecipheriv` 写，遇到真派生型时表现为**填充错误而非明文异常**，极易误判成密钥字节序问题。

**判定测试**：把 `CryptoJS.<算法>.decrypt` 在沙箱/浏览器里打桩，打印实参类型——
`WordArray` ⇒ 直接密钥路径；字符串口令 + `cfg.kdf` 被读 ⇒ 派生路径。
打不了桩时用 ②：密文头 8 字节是否为 `Salted__`。

### 55. 时间/日期派生的 key·iv：按"加密方时区"排候选 + 双校验 + 全失败硬抛，禁止写成常量

**实证来源**：mashangpa 题19。站方 `DES3.iv() = formatDate(new Date(), "yyyyMMdd")`——取的是**浏览器本地日期**，
而加密发生在服务端（UTC+8）。两者只在客户端处于东八区时偶然一致：客户端换时区、或整轮取数跨过 UTC+8 零点，
解密就全页失败，且症状是首块乱码 + `JSON.parse` 失败（PKCS#7 去填充照样通过，不会报 padding 异常）——填充错误对应的是密钥/派生问题（规则 54 反例），别把两处症状弄反。

**具体操作**：
① **主候选按加密发生地的时区**（服务端/站点所在地）推日期串，运行机本地日期作次候选，再各 ±1 天覆盖跨零点；
② 每个候选都要**双校验**——PKCS7 去填充成功 **且** 明文能 `JSON.parse` 成预期结构，任一不过即换下一候选；
③ 候选全部失败必须**抛错终止**（错误里带上试过的候选值），不许"取第一个候选硬解"或返回空串，
否则答案会静默算错；④ 日期串的补零语义要从站方 `formatDate` 实现核对（`M+`/`d+` 是否补零、`y` 是否截断），
不同库写法不同（`yyyyMMdd` / `yyyy-MM-dd` / 时间戳整除）。
交付实现里把这段做成独立模块（如 `src/des3.js`），把 `ivUsed` 写进验证记录摘要，便于事后判断当天用的是哪个候选。

**反例**：把 8 字节日期 IV 当常量写进代码（"今天能跑"是最强陷阱，两天后静默失效）；
只试本地日期，在非东八区机器上首跑失败后误判"站点改版"并去重跑取证；
或用 `try/catch` 吞掉解密失败、按 0 参与求和（答案错但全程 200，REAL_VERIFY 查不出来）。

**判定测试**：把系统时区改成 UTC±0 再跑一次交付入口——仍成功说明候选集正确，
失败说明只写了本地日期一条路径。无改时区条件时，用固定 `now` 注入跑一次 UTC+8 与一次 UTC±0 输出对比。

## 二十四、交付记录与证据的写入边界（mashangpa 题17 实证）

### 56. 实时验证记录只允许在线路径写；离线/`--selftest` 分支一律落 `case/tmp/`

**实证来源**：mashangpa 题17（内容还原型，零沙箱零签名，交付入口 `final.js`）。`--selftest` 分支与在线分支
共用同一个模块级 `verification` 对象（`attempts: []` 起算）并同样调用 `writeVerification()`
⇒ 已实时落盘的 23 条真实 attempt（详情页 + 映射表 + 20 页取数 + 提交，含 `status:success` 那条）
**被一次离线自检清空**，`check_final_artifact.js` 只报「联网模式至少需要 5 条 attempts，当前只有 0 条」，
不给根因，最后只能重新发起一轮真实请求才恢复记录。

**为什么危险**：`验证记录.json` 是 REAL_VERIFY 的唯一交付证据，规则要求"每次请求实时落盘、不事后回填"。
离线模式覆写它＝静默销毁证据，且表象像"门禁在挑格式"，极易被当成门禁误报而手工回填（那是伪造）。

**具体操作**：① 交付入口把"在线记录"与"离线自检输出"分成两个落盘目标——在线分支写
`result/验证记录.json`；`--selftest`/离线对拍只写 `case/tmp/<实际输出>.json`（供 `compare_fixture.js` 读）；
② 自检函数不得调用记录写入函数，也不得在共用模块作用域持有 `verification` 单例并在离线分支复用；
③ 记录若被误毁：**重跑真实请求**恢复，禁止手工回填、禁止用另一轮运行的数据拼装。
`check_final_artifact.js` 在 attempts 不足且入口含 selftest 分支时会直接提示本条根因。

**反例**：把 `writeVerification()` 放在模块底部"反正离线模式也会提前 return"的位置直觉里——
真实事故正是 selftest 走完对拍后照样执行了写入。

**判定测试**：跑一次 `--selftest`（或等价离线模式），再看 `result/验证记录.json` 的 attempts 条数是否变化。
变了即本条命中。

## 已合并条目指针（旧编号 → 主条目）

| 旧编号 | 并入 | 原主题 |
|-------|------|--------|
| 7 | 规则 4 | 命中案例后必须精读踩坑记录并转成检查项 |
| 9 | 规则 13 | `String.fromCharCode` 是高频信号 |
| 11 | 规则 12 | Python `execjs` 复用 context |
| 15 | 规则 8 | JSVMP 环境伪装优先于算法追踪 |
| 17 | 规则 14 | 环境对比要分批采集 |
| 18 | 规则 1 | 环境补丁必须在 JSVMP 脚本加载前完成 |
| 53 | 规则 56 | 编号调整残留（并发编号期间曾用于 p17，后改判 56） |

## 贡献新规则

不是每个案例都产生新规则：多数案例的经验已被现有条目覆盖，案例细节写进 `result/经验沉淀-<站点>.md` 交付物即可，引用现有编号（含上方指针表旧编号）优于新增。确需新增时：
1. 先检索确认未覆盖：速查 `search_references.js --keyword <关键词>` + 通读本文件同章节条目，确认根因确实未被覆盖且可跨站点泛化。
2. 按"### N. XXX"格式追加一条（编号顺延，不重排既有编号），必须有**实证来源**（案例/站点）、**具体操作**、**反例**、**正确做法**。
3. **同根因合并优先**：新经验与既有条目同根因时并入既有条目（原编号保留在上方指针表），不新增编号；并入前同时检查主条目与指针条目两处。当前规模：**49 条实条 + 7 条指针**（7/9/11/15/17/18/53）。

## 相关案例

| 案例文件 | 关联点 |
|---------|--------|
| `cases/unicode-codepoint-substitution-no-font-file-mashangpa-p17.md` | 规则 56 实证（离线 `--selftest` 复用在线 `verification` 对象并 `writeVerification()`，把 23 条真实 attempts 清零，门禁只报条数不给根因）+ 反模式 41 实证（`search_cases.js` 多关键词 AND ⇒ "本地无案例"假阴性，差点漏掉 match7 同族先例）+ 反模式 11 第七种形态实证（题型名"字体加密"被当实现形态依据）+ `font-anti-crawl.md` 形态三（伪字体：零字体资源、表在 JS 明文常量） |
| `cases/jsvmp-xhr-interceptor-env-emulation.md` | 规则 1/3/5/12/16 实战验证（原 18 已并入 1） |
| `cases/jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md` | 规则 1/3/12/14/16 实战验证 |
| `cases/jsvmp-ruishu6-cookie-412-sdenv.md` | 规则 2/6/8 实战验证 |
| `cases/universal-vmp-source-instrumentation.md` | 规则 1/2/8/13 实战验证（原 9 已并入 13） |
| `cases/modified-md5-xhr-done-yuanrenxue.md` | 规则 10 实战验证（T常量篡改 + XHR.DONE 步长退化根因；降级前先做时间冻结对照法） |
| `cases/yidun-jigsaw.md` | 规则 20 实战验证（m 空串陷阱 + 全字段解密 + 逐点统计） |
| `cases/yidun-intellisense-vm-env.md` | 规则 20 实战验证（成功样本链路字段核对） |
| `cases/yuanrenxue-match4-sprite-pixelsort.md` | 规则 21 + 图片像素判定（base64 唯一 ≠ 像素唯一）实战验证 |
| `cases/yuanrenxue-match6-aarcsa-honeymoon-risk.md` | 会话状态类风控（蜜月期/频率/惩罚层）+ 反模式 13/14 实战验证 |
| `cases/yuanrenxue-match9-dynamic-cookie2.md` | 规则 22 实战验证（RSA 循环加密禁缓存）+ 规则 23 实战验证（随机边缘拒绝需大样本判别）+ 数据绑定会话（反模式 18）+ 黑盒 SDK 定期更新（dynamic-resource.md 专节） |
| `cases/yuanrenxue-match10-ruishu3-replay-defense.md` | 规则 24 实战验证（预填状态快照致引导脚本走旁路）+ 反模式 16/11 实战验证（插桩 while(1) 禁令 / VM 卡死转投浏览器（已并 16）/ 外部失败误归因通道层）+ 会话配套资源（dynamic-resource.md 专节）+ 元素语义真实化（env-object-model.md） |
| `cases/yuanrenxue-match16-webpack-blackbox-branch.md` | 规则 26 实战验证（webpack 模块切片定界 + 隔离作用域 + require 桩 + 反调试处理）+ 反模式 26 实战验证（抠代码后分支漂移：格式全对却被拒） |
| `cases/yuanrenxue-match17-http2-transport-plaintext.md` | 规则 27 实战验证（请求侧无签名三条判据 + 传输层 HTTP/2/UA/Cookie 对齐）+ 反模式 27 实战验证（诱饵参数 `m` 恒 undefined 被序列化层丢弃）+ 反模式 22 二次实证（`--targets "question/17"` 误命中静态资源） |
| `cases/yuanrenxue-match18-jsvmp-mouse-gated-signature.md` | 规则 28 实战验证（JSVMP 静默退出双层插桩定位 + 语义级环境对齐：内建自有属性 / webdriver 挂原型 / 鼠标事件门控）+ 反模式 28 实证 + 反模式 27 四次实证（`window.match18` 连环诱饵）+ 末页 page=05 双重校验 |
| `cases/yuanrenxue-match19-tls-fingerprint-blocklist.md` | 规则 27 扩充实证（跨客户端栈对照法定位 TLS ClientHello 黑名单 + 交付语言切换依据；末页 UA 提示数组按元素类型判别）+ 反模式 27 五次实证并修正机理（丢弃在 `k.extend` 深拷贝 `copy!==undefined` 守卫，非 `$.param`——debug 文本含参数 ≠ wire URL 含参数） |
| `cases/webpack-ob-hmac-sha1-mashangpa-p9.md` | 规则 36 实战验证（题9 数据恒定可 fixture，同平台题10 随机不可复用）+ trace 常量命中法（jscall 搜签名前缀常量直击构造点）+ 死代码伪造赋值陷阱 |
| `cases/ob-string-array-modified-sha256-blackbox-mashangpa-p10.md` | 规则 36 极端形态实证（同 sessionid 数据每次请求随机，两轮一致是碰巧，提交前实时重拉）+ 魔改 SHA-256 识别信号（标准 crypto 输出不匹配）+ VM 沙箱黑盒整体加载 |
| `cases/yuanrenxue-match24-jsvmp-blackbox-tl-xor30.md` | 规则 30 实战验证（逐位 diff 判分布→常量偏移 XOR 30 就地修正；VM 探针直达路径/沙箱 realm 钩子/按页构建时效窗口）+ 规则 31 实证（LEAD_MS 补偿伪需求：先测 age 窗口 2~4s，慢的根源是逐页点击派发非时间补偿）+ 规则 32 实证（jQuery expando 随机值：格式正确+运行时随机，服务端只验结构自洽）+ 反模式 23/18 实证（常量偏移 XOR 30 就地修正 / 对拍锁同源） |
| `cases/yuanrenxue-match26-sm3-blackbox-page-drive.md` | 反模式 29/31 同族实证（SM3 魔改 8 组环境分派 IV，Firefox 取证内核 403 诱饵分支）+ 页面自驱动翻页（jq 桩 on() 记录 handler + 手动触发 click）+ 成对相同 token 的字节级折叠诊断（strToBytes `k & 0xfe` 偶数化）+ 会话验活（数据接口 200 ≠ 登录态存活）+ detect-patterns 自引用检测补强（拼接结果被 charCodeAt 形态漏报） |
| `cases/yuanrenxue-match25-cfa-vm-blackbox-env-realm.md` | 规则 33 实战验证（环境桩必须在沙箱内执行：主 realm 定义 `win.window=globalThis` → self-reference 自检失败 → `_$VM=111` 分支 → 403 token failed；同输入双环境对比定位）+ 规则 34 实证（T 偏移矩阵 now±100s 全过 = 服务端不校验时间窗口，冻结 Date=now 即可，无需补偿）+ 反模式 34 实证 + IIFE 门禁坑（环境桩拆 browser-objects 顶层代码，check_code_quality 单函数上限） |
| `cases/yuanrenxue-match28-jsvmp-rsa-purecompute.md` | 规则 35 实战验证（JSVMP 字节码 limbs 字面量直读 → 确定性 RSA-1024 纯算，无需跑 VM；固定 0x01 padding 对拍；limbs 出现序≠数组序）+ 规则 36 实证（数据绑定 sessionid：换会话数据完全不同必须重算，答案 25808383→27673886）+ 规则 37 实证（限流 403 token failed 单请求诊断法：第 3 页起 403 但单请求 200 = 频率墙；页间 3s+冷却+提交 --answer 解耦）+ 反模式 18/36 实证（换会话数据绑定重算 / 限流单请求诊断）+ JSBN hex2b64 非标准编码 |
| `cases/yuanrenxue-match27-jsencrypt-random-rsa-purecompute.md` | 规则 38 实战验证（X.509 SPKI hex 公钥 + getRandomValues = JSEncrypt 随机 RSA → publicEncrypt 纯算；候选 X×公钥扫描实证明文常量：pubkey1+X=27 → 200、pubkey2 全 403；**沙箱跑通+结构像 ≠ 服务端接受**——_$v 依赖 document.all 分支致运行时常量算错，可纯算时转纯算不死磕沙箱）+ 反模式 27 五次实证（m=window["matchnumber"]=undefined 诱饵）+ 反模式 36 同族实证（429 限流）+ jq 桩 Proxy 缓存坑（缓存裸 obj 致二次访问缺失方法报错） |
| `cases/yuanrenxue-match29-vmpzl-eval-log-source.md` | 规则 39 实战验证（JSVMP 业务逻辑经 eval 反序列化执行 → RuyiTrace eval 分类日志落盘业务源码，绕开 LZ 压缩/字节码/VM 指令三层直读；eval 源码变量名 `_$`+随机但结构稳定，grep `token`/`case 64` 定位请求构造）+ 反模式 37 实证（手写 `LZ.` 前缀解压器是死路，先查 eval 日志）+ 反模式 27 再实证（m=window.matchnumber 诱饵）+ match26 同款实证（页面自驱动翻页注入新 now、jQuery 桩 `.add()` 必须有）+ 46 项环境探测桩全 true（Symbol.toStringTag 补 HTMLDocument/Navigator）+ Session 门禁字面识别再实证（`client.getPage(` 不算复用，须 `client.get/post(`） |
| `cases/wasm-zero-import-linear-signer-mashangpa-p11.md` | 规则 44 实证（`add_preload_script` 抛 privileged scope 被误判"无 hook 能力"，白跑三轮；根因是库层无条件带 contexts，底层不传即成功且落主 world）+ 规则 45 实证（交付 wasm 放 `src/target/original/` 被 workspace `.gitignore` 的 `**/original/` 静默排除）+ 规则 46 实证（skill 只装 SKILL.md 时手工等价登记）+ 规则 36 新形态（同窗口内各页数组重洗而总和稳定，判数据窗只能用聚合值）+ 反模式 11 第六形态；无 RuyiTrace 时用「真机 oracle 直调表 × 本地同 wasm 执行 × 算式全量对拍」三步闭合 writer 证据（30/30 + 4/4 + 4280/4280） |
| `cases/wasm-harness-selfhash-fp-blackbox.md` | 规则 41~43 实战验证（自同构校验：wasm 导入自喂脚本源全文与 wasm 自身字节 → 官方包 200/重建包必 500 的真因；透明边界全量捕获 hook 两个重载/内存导出名坑；跨实例内存快照恢复 OOB 死路 → fresh 生成 + 成对设备画像；载荷自包含实测 no-register 也 200）+ 反模式 39/40 实证 + 7 轮环境层修补（逐槽对齐/全量回灌/凭据注入/TLS 替换）全部无效的教训：对照实验未锁"脚本源与 wasm 字节逐字节相同"这一前置 |
| `cases/jsvmp-sha1-const-table-jscall-args-mashangpa-p12.md` | 规则 47 实证（目标 JSVMP 对约 4% 的 (page,t) 自抛，用还原算式打真实接口 4/4 返回 200 判为客户端缺陷，转纯算主路径）+ jscall args 直读 VM 常量表定算法族（SHA-1 族但 7 个常数仅 3 个标准、IV3 偏 1、4 个非标准 ⇒ VM 改动过 SHA-1 常数，初始化按真机表不能套标准 IV；另有盐值 fu/aa + 挂载成员名 originalAjax/requestInterceptors，未开 MOZ_DOM_JSVMP_* 也未反编译字节码）+ run_with_trace 两个静默致死形态（minimal bootstrap 缺 window 使 VM IIFE 抛 ReferenceError、setTimeout 桩不执行回调）+ 规则 36 新形态（同站题1恒定与题11/12 轮换并存，逐题实测）+ 交付瘦身（还原期沙箱挪 case/，避免 result 携带补环境主体） |
| `cases/obfuscated-url-param-signer-safekodo-mashangpa-p14.md` | 规则 48 实证（锁 `Math.random` 仍变 ⇒ 确定性哈希，锁 `Date` 构造器定音 `CODE4=H(ts)`；值域恰 16 个 ⇒ 4bit 折叠索引 + `0xDE` 配对结构；闭式未还原不阻塞交付，黑盒在真机输入上逐字节复现即分支对齐证据）+ env-debug-loop「沙箱内时间冻结不生效」实证（vm realm 边界：宿主改 `globalThis.Date` 不跨 realm；取时入口是 `new Date().getTime()` 非 `Date.now`）+ trace-flow 竞态第④坑实证（`--targets` 把 200+业务拒绝当终态命中，取证提前收尾 `--click` 永不发生）+ 竞态非恒定（ruyipage 两轮裸发、RuyiTrace 轮成功，判「恒定」前先换工具重采）+ 规则 36 再实证（相隔 2 分钟 103291/99128，取数提交同窗） |
| `cases/cookie-carrier-hexinv-fingerprint-struct-mashangpa-p15.md` | 规则 49 实证（`hexin-v` 头与 Cookie `v` 同值双发，只带头被拒、只带 Cookie 通过 ⇒ 服务端校 Cookie；生成方归因 ≠ 校验载体归因）+ 规则 32 第 4 条实证（45B 指纹结构体穿位打包+校验和+XOR+自研 base64，伪造内容体仍 200，ts ±540s 过 / ±600s 拒 ⇒ 链长是客户端混淆强度不是服务端校验强度，据此把交付停在黑盒沙箱）+ env-object-model Canvas 节新增 triage 实证（`getContext` 只被 `!!ctx` 消费，折成 1 个 bit）+ vm realm 新形态（沙箱键预置 `globalThis: null` 使 context 内 `defineProperty` 报 non-object）+ `forensic_ruyipage.py` 入口页被收尾轮转丢失缺陷的实证与修复 |
| `cases/body-carrier-h5st-remote-algo-mashangpa-p16.md` | 规则 50 实证（黑盒 SDK 自带 asap 型 Promise：`MutationObserver.observe()` 空桩使 `sign()` 5 轮不 settle 且零报错，被误读成反调试；补调度四件套 + XHR 回调异常记录后 round 1 出值）+ 规则 51 实证（`request_algo` 响应 `data.result.algo` 就是摘要函数源码 ⇒ 闭式不存在，交付停在沙箱黑盒 + 上游桥接；与题15 构成"链长≠校验强度"的对偶：本题链短但伪造即拒）+ 规则 52 实证（Step 1 永久缺失时 fixture 转结构基线，逐字节交服务端承担）+ `env-detect-bypass.md` C 形态实证（3+1 轮取证浏览器 0 次目标请求、`--ua` 覆盖后包谱同构，Node/V8 同文件跑通 = 引擎级分歧）+ storage 键位进度探针首次应用（断点钉在 `WQ_gather_*` 之后、`request_algo` 之前）+ 失败处理器自身抛错的新静默形态（`onSign` 引用未定义的 `a` → `ReferenceError`，Promise 既不 resolve 也不 reject） |
| `cases/response-carrier-tripledes-date-iv-mashangpa-p19.md` | 规则 54 实证（站方 `19pro.js` 是未混淆 crypto-js 打包副本，`MD5`/`EvpKDF` 定义在场但零调用，第二实参 `enc.Utf8.parse(k)` 即直接密钥路径，误判 passphrase 会全解不开；与 match22 的 `Salted__` 真派生型构成对偶）+ 规则 55 实证（`DES3.iv()=formatDate(new Date(),'yyyyMMdd')` 取浏览器本地日期而加密在服务端 UTC+8 ⇒ 候选排序+双校验+硬抛，IV 绝不写成常量）+ 规则 36 第三次命中（取证样本隔 25 分钟仍逐字节复现、第 4 次采样才变 ⇒ "复现一次"不能证伪轮换）+ §4.4 例外 3 内容还原型豁免第二次启用（判据三条逐条落盘形态可作模板）+ A 纯算路径（该平台 13 题里第二个完全零沙箱零补环境，前例 p17） |
