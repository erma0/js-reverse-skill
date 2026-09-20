# Node.js 补环境调试循环

当前置阶段已经完成，并且用户确认进入补环境阶段时读取本文件。

## 目标

补环境阶段不是为了让目标 JS "勉强不报错"，而是为了让目标网页原始 JS 在 Node.js 中生成与浏览器样本一致的结果。

核心原则：

```text
先记录，后补齐；先最小，后扩展；真实性保护从第一版 env 骨架开始；先样本验证，后交付。
```

对 Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何等浏览器指纹，额外遵循：

```text
先采真实浏览器终端 API 返回值，再在 Node.js 中回放；不要强行复刻渲染管线，不要把最终流程改成自动化浏览器。
```

真实性保护额外遵循：

```text
先启用 JS 层 NativeProtect，再编写 env；toString、属性描述符、访问器、原型链和实例对象保护是默认基线，不等待检测触发。
```

如果本 case 的取证模式是 ruyiPage + RuyiTrace，或用户明确说"已经 trace 好日志 / 已提供 NDJSON"，补环境阶段再增加一条硬规则：

```text
先看 RuyiTrace NDJSON，再跑 Node trace；先用浏览器内核日志定位环境依赖，再用 Node.js 复现和固化。
```

## 进入条件

进入本阶段前必须确认：

- 目标属于网页端 JS。
- 已有目标 API、请求方法、加密参数名和参数位置。
- 至少有一份成功请求样本，最好有多组样本。
- 已经定位或初步定位加密入口。
- 相关 JS 文件已经保存到本地，或确认可以获取。
- 已经整理 `source → entry → builder → writer` 四层链路，至少确认 writer。
- 已按 SKILL.md 4.4 产出 `notes/entry-chain.md` 与 `notes/missing-env-priority.md`，且 `node scripts/check_env_prerequisites.js --case-dir <project-root> --markdown` 退出码 0（两份文件缺一或门禁未过不得开始补环境）。
- 取证来源为 ruyiPage + RuyiTrace 时，已导入 NDJSON 日志并生成 `notes/ruyitrace-summary.md`；尚未导入时按默认自动 trace 采集（`capture_ruyitrace_log.js`）并导入，自动失败或需登录/验证码/复杂交互时转手动由用户提供日志；用户明确确认无法提供时才降级。
- 已经检查 Node 泄露阻断，不把 `process/Buffer/require/module/global` 暴露给目标 JS。
- 已经在补环境初始化阶段启用 JS 层 NativeProtect 保护，或记录用户明确豁免原因。
- 用户未明确要求关闭真实性保护；默认会对新增 WebAPI 执行属性描述符、访问器、原型链、函数 / 访问器 / 实例对象 toString 保护。
- 已经执行六项纯计算预检，或明确该目标不依赖相关差异。
- 如果目标访问 Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何等指纹 API，已经采集或计划采集真实浏览器终端 API 返回值；缺少样本时不得进入"静默伪造默认值"的交付模式。
- 如果目标是验证码接口，已确认事件轨迹 fixture 或旧轨迹样本来源，并明确该轨迹只用于补环境生成加密参数，不代表最终验证码验证成功。
- 用户已确认进入 Node.js 补环境阶段。

如果缺少任一关键条件，先回到 `references/workflow/phase-flow.md` 的前置流程，不要直接写 `env.js`。

六项纯计算预检：

1. `typeof window === 'object'`、`typeof document === 'object'`、`typeof navigator === 'object'`。
2. `typeof process === 'undefined'`、`typeof module === 'undefined'`、`typeof global === 'undefined'`（或显式删除 / 屏蔽）。
3. `Date.now()`、`performance.now()` 时间基线一致或固定。
4. `Math.random()`、`crypto.getRandomValues()` 可控或使用 fixture。
5. `navigator.userAgent`、`navigator.language`、`navigator.platform` 与请求头一致。
6. `location.href`、`document.cookie`、`document.referrer` 与样本一致。

## 验证码事件轨迹 fixture 门禁

验证码接口补环境时，如果加密参数依赖鼠标、点击、拖动、触摸、滚轮或键盘事件，先使用浏览器取证得到的旧轨迹 fixture 跑通参数生成。该阶段目标是让目标 JS 在 Node.js 中生成加密参数，不要求验证码最终验证通过。

硬性要求：

- 将轨迹设计为可替换入口，例如 `motionTrack`、`eventFixture`、`verifyContext`、`clickPoints`、`dragPath`。
- 推荐保存到 `case/fixtures/motion.fixture.json` 或 `result/src/verify/motion-track.js`。
- 代码中必须有 UTF-8 中文注释，说明旧轨迹来源、用途和后续由 `web-verify-patcher` 替换。
- 不得把旧轨迹硬编码成不可替换逻辑，不得宣称旧轨迹能稳定通过验证码。
- 生成验证码加密参数后，如需识别图片、生成真实轨迹、坐标换算或提交验证，先运行 `scripts/check_web_verify_patcher.js --require --markdown`，确认 `web-verify-patcher` 可用后再使用。

## RuyiTrace 优先诊断门禁

当取证模式为 ruyiPage + RuyiTrace 时，进入任何 `env.js` 编写、缺失对象补齐或环境问题排查前，先执行以下门禁：

1. 确认 `case/ruyi-trace/logs/*.ndjson` 或用户指定 NDJSON 存在。
2. 如果尚未导入，先执行：

   ```bash
   node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir <project-root> --markdown
   ```

3. 先阅读 `case/notes/ruyitrace-summary.md`，再按需过滤原始 NDJSON。
4. 针对当前错误或不一致，优先搜索：
   - 缺失对象名：如 `navigator`、`document`、`screen`、`localStorage`。
   - 缺失方法名：如 `getItem`、`getContext`、`getParameter`、`toDataURL`。
   - 目标 JS 文件名、入口函数名、writer 附近调用栈。
   - 与目标请求发起时间邻近的 `api` 调用。
5. 把命中证据写入 `notes/missing-env-priority.md`，至少包含 `api`、`stack.file`、`line`、`col`、所属环境模块、补齐优先级和"RuyiTrace 证据 / Node trace 补充 / 推断"分类，再决定 Level 1/2/3 补齐顺序。
6. 只有 NDJSON 缺失、未覆盖该逻辑或结论不足时，才把 `run_with_trace.js` / Proxy trace 作为主要发现来源。

不要在已有可用 RuyiTrace 日志时，直接根据 Node.js 报错盲目补环境。

## 推荐 case 目录

```text
case/
├── js/
│   ├── original/
│   ├── pretty/
│   └── extracted/
├── requests/
├── fixtures/
├── notes/
├── hooks/
├── env/
├── ruyi-trace/
│   └── logs/
├── browser/
│   └── ruyipage/
├── result/
└── tmp/
```

使用脚本创建：

```bash
node scripts/init_env_case.js --case-dir <项目名> --target app.js --entry window.makeSign --param sign --api https://example.com/api/search
```

目录含义：

| 目录 | 用途 |
|---|---|
| `js/original/` | 原始 JS、chunk、runtime、sourcemap |
| `js/pretty/` | 格式化后的 JS |
| `js/extracted/` | 抽取出的入口模块或片段 |
| `requests/` | 脱敏后的 cURL、HAR、请求说明 |
| `fixtures/` | 浏览器真实样本和期望输出 |
| `notes/` | 分析笔记、入口定位、环境依赖说明 |
| `hooks/` | 浏览器 Hook 模板和临时断点脚本；调用栈确认并写入 notes 后立即清理或归档 |
| `env/` | 分层 env 模块草稿 |
| `ruyi-trace/logs/` | 用户确认导入的 RuyiTrace NDJSON 原始日志 |
| `browser/ruyipage/` | ruyiPage 取证配置、非敏感脚本和用户确认保留的材料 |
| `result/` | 最终规范项目目录；唯一执行入口为 `final.js` 或 `final.py`，必要模块可放入 `src/`；不要放临时 runner、测试脚本或浏览器自动化代码 |
| `tmp/` | trace、临时 runner、日志、失败产物；每次测试或阶段完成后立即清理 |

## 双模式策略

### 探测模式

探测模式用于发现目标 JS 实际访问了哪些浏览器环境。

允许使用：

- JS `Proxy`。
- getter / setter hook。
- 函数调用记录。
- 构造调用记录。
- trace 文件。

运行示例：

```bash
node scripts/run_with_trace.js \
  --target case/js/original/app.js \
  --entry window.makeSign \
  --fixture case/fixtures/sample.fixture.json \
  --trace case/tmp/env-trace.jsonl \
  --summary case/tmp/missing-env.json
```

探测模式允许对象"不完全像浏览器"，但必须明确标记其用途只是调试，不要把全量 Proxy 作为最终交付。

### 交付模式

交付模式用于最终稳定运行。

要求：

- 从第一版可交付 env 开始就启用真实性保护，不等检测命中后再补。
- 进入本模式前已经启用 JS 层 NativeProtect；所有 native-like 函数、getter、setter、特殊对象和原型链 helper 都必须做 native-like 保护。
- 尽量不用全局 Proxy。
- 将 trace 中发现的访问路径固化为真实对象结构。
- 显式定义属性描述符。
- 建立必要原型链。
- 对构造函数、普通方法、getter、setter 做 native-like `toString` 保护；访问器函数也必须保护。
- 对实例对象设置正确 `Object.prototype.toString` / `Symbol.toStringTag`，并对 `document.all` 等特殊对象做 HTMLDDA 近似处理。
- 不输出调试 trace。
- 用 fixtures 验证输出。

## 分层补齐策略

补齐顺序固定为：

1. **Level 1 基础运行层**：window/self/globalThis、location、URLSearchParams、Storage、Date、crypto、console、定时器。
2. **Level 2 指纹与真实性层**：navigator、screen、document、plugins/mimeTypes、Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何终端 API 值回放、属性描述符、原型链、native-like toString。
3. **Level 3 目标 SDK 专用层**：SDK init、动态 chunk、Worker、WASM、postMessage、站点私有缓存。

真实性保护与 native-like 行为基线见 `references/env/env-native-protection.md`。输出不一致时先读取 `references/network/node-leakage.md`，不要盲目继续补对象。

## 运行顺序

```text
1. 创建 case 目录和 fixtures。
2. 如果取证模式为 ruyiPage + RuyiTrace，先导入 / 阅读 NDJSON 摘要，形成环境依赖优先级。
3. 执行 Node 泄露阻断检查和六项纯计算预检。
4. 启用 JS 层 NativeProtect 保护：后续 native-like 函数、访问器、`document.all`、原型链等都走 NativeProtect，未覆盖项记录降级状态。
5. 用最小浏览器环境运行目标 JS。
6. 捕获 ReferenceError / TypeError / 输出不一致。
7. 如已选择 RuyiTrace，先用 NDJSON 证据解释缺失路径；解释不足时再用 Proxy 记录实际访问路径。
8. 生成缺失环境报告，并用 `analyze_trace.js` 输出模块优先级。
9. 如果 trace 或 NDJSON 显示 Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何指纹，先读取 `references/fingerprint/fingerprint-value-replay.md` 中的指纹值回放原则（3 层值来源优先级），生成采样 Hook，采集 `fixtures/fingerprint.fixture.json`，再按调用特征做终端 API 值回放。
10. 按 RuyiTrace 证据 + Node trace 补充结论，分 Level 1/2/3 补齐环境。
11. 发现 Proxy、toString、descriptor、accessor、prototype、instanceof、constructor.name 或 `document.all` 检测信号时，迁移到真实对象 / NativeProtect 保护模式。
12. 如果是验证码接口，先注入可替换的 `motionTrack` / `eventFixture` 旧轨迹 fixture，仅用于生成验证码接口加密参数。
13. 调用加密入口。
14. 和浏览器样本对比；如果缺少指纹样本，补采样而不是改用自动化浏览器。
15. 多样本通过后整理规范项目目录，把补环境、入口调用、参数生成和最终 Node.js / Python 请求逻辑串联到唯一入口 `result/final.js` 或 `result/final.py`；必要模块可放入 `result/src/`。
16. 先确认 NativeProtect 保护证据（原型链、属性描述符、访问器、toString 保护、实例对象 toString 保护、document.all、RuyiTrace 证据和指纹值回放证据）；再运行 `check_fingerprint_fixture.js` 与 `check_final_artifact.js`，确认最终主文件不含 ruyiPage / Playwright / Puppeteer / Selenium 等自动化代码。
17. 清理 trace、临时日志、失败 runner、测试脚本、指纹采样 Hook 和多余文件。
```

## 错误分类

### ReferenceError

示例：

```text
ReferenceError: XMLHttpRequest is not defined
```

记录为：

```json
{
  "type": "missing-global",
  "name": "XMLHttpRequest"
}
```

处理：如果选择 ruyiPage + RuyiTrace，先在 NDJSON 中确认浏览器真实调用栈、构造方式和相关属性，再补全 `globalThis.XMLHttpRequest`，必要时建立构造函数和原型。

### TypeError：不是函数

示例：

```text
TypeError: localStorage.getItem is not a function
```

记录为：

```json
{
  "type": "missing-method",
  "path": "localStorage.getItem"
}
```

处理：如果选择 ruyiPage + RuyiTrace，先在 NDJSON 中确认该方法真实是否被调用、调用参数和调用栈，再补全对应方法。补全的方法使用 NativeProtect 做 native-like 保护。

### TypeError：读取 undefined 属性

示例：

```text
Cannot read properties of undefined (reading 'userAgent')
```

处理：优先结合 RuyiTrace NDJSON 判断浏览器真实路径；NDJSON 不足时再结合 Node trace，补齐缺失对象或属性。

### WASM trap：unreachable（wasm-bindgen 模块在 Node 沙箱）

**现象**：Node 原生 `WebAssembly.instantiate` 成功（imports/exports 对齐），但调用 wasm 导出函数时抛 `RuntimeError: unreachable`——没有 JS 堆栈、没有 glue 层异常，裸 trap。

**机理**：wasm-bindgen 生成代码带标准 get-global 检测序列，每次导出函数调用都会重跑：

```text
self() → is_undefined → object_drop_ref
→ newnoargs("return this") → call(null) → object_clone_ref
→ instanceof_Window(global) → document(global) → body(document) → ...
```

浏览器里 `globalThis instanceof Window === true`。`instanceof_Window` 桩返回 false 时，Rust 端的分支枚举（Window / Worker / …）全部不匹配，执行 `unreachable!()` 指令——**值对 ≠ 对齐的 wasm 版**：桩"合理地"返回 false 反而是错误语义。

**诊断**：给每个 import 桩加一行访问日志（桩名 + 实参），看序列停在哪个桩之后。上例序列停在 `instanceof_Window` 之后的 trap，即该桩返回值语义错误。

**修复清单（按序核对）**：

1. `instanceof_Window` 桩返回 `true`（对齐浏览器 `globalThis instanceof Window`）。
2. `document` / `body` 桩返回**非空对象**（空壳 `{document: {body: {}}}` 即可）——Rust 端对 `None` unwrap 同样进 unreachable；签名本体是纯字符串计算时不消费 DOM 内容，空壳无服务端影响。
3. heap 管理（32 槽数组 + `heap.push(undefined, null, true, false)`，`dropObject` 的 `idx < 36` 守卫）与原 glue 逐行一致——heap 槽位错位会让桩之间传参互相踩踏。
4. Node 侧全局兜底桩（`self`/`window`/`global`）对 undefined 取属性前判空，别让桩自己抛 ReferenceError 掩盖 wasm 端真实分支。

**红线**：这些桩只服务 wasm 内部的初始化链，禁止借机伪造 navigator/canvas 等指纹面——补环境最小集合原则不变（trace 未显示 sign 读取 DOM/指纹内容时，空壳即正确答案）。

实战参照：match20（`cases/yuanrenxue-match20-wasm-bindgen-sign.md`）——3 组跨会话样本对拍 3/3 通过。

### 输出不一致

如果不再报错但签名不一致，且已选择 ruyiPage + RuyiTrace，先回看目标请求前前的 NDJSON 调用，再检查：

- 请求 URL、Query、Body 是否完全一致。
- `Date.now`、`performance.now`。
- `Math.random`、`crypto.getRandomValues`。
- `navigator.userAgent`、语言、时区、屏幕信息。
- `document.cookie`、`localStorage`、`sessionStorage`。
- `location.href`、`origin`、`pathname`。
- 是否启用 native-like `toString`。
- `document.all` 是否走了 HTMLDDA 近似处理路径。
- `Object.getOwnPropertyDescriptor` 返回的 descriptor 是否与真实浏览器一致。
- getter / setter / 构造函数 / 原型方法的 `Function.prototype.toString.call(...)` 是否为 native-like。
- 实例对象的 `Object.prototype.toString.call(...)`、`constructor.name`、`instanceof` 是否一致。

如果 NDJSON 中没有覆盖目标参数生成时间段，明确标记"RuyiTrace 未覆盖"，再使用 Node trace / Hook / 断点补充。

### 沙箱内时间/随机冻结不生效（mashangpa题14 实证）

**现象**：给 `Date.now` 打桩后目标签名里的时间戳仍是真实时间；或者对拍 fixture 全 FAIL 但毫无报错——表象像「桩没装上 / 还差环境项」，实际冻结根本没跨进目标的世界。

**根因（两个独立陷阱叠加）**：

1. **vm realm 边界**：`vm.createContext(sandbox)` 后 context 有**独立 realm 的内建对象**。在宿主改
   `globalThis.Date = X` 对沙箱内代码完全无效且无任何报错。要影响沙箱读到的内建必须写 **context 侧**：
   先 `vm.runInContext('Date', sandbox)` 取出 realm 原生 Date，再 `sandbox.Date = FrozenDate`（用完还原）。
   在沙箱**内部**执行的 env-module（如 `run_with_trace.js --env-module`）里改 `globalThis.Date` 才有效。
2. **取时入口不是 `Date.now`**：站点常用 `new Date().getTime()` / `Date.parse(new Date())`——桩 `Date.now`
   只能拦住前者。判别：桩 `Date.now` 后时间戳仍走真实时间 ⇒ 入口是 `Date` 构造器；要冻结必须换掉构造器
   （`FrozenDate.now`/`parse`/`UTC`/`prototype` 全部接原生，缺一个就内部 TypeError）。

**标准动作**：先判入口（桩 `Date.now` 看是否生效）→ 再按 realm 边界把冻结写 context 侧 → 冻结后目标输出若
同步定住（如签名前缀随 ts 一起冻结），即证明该输出是时间的确定性函数，可直接用「受控 ts 扫描」做参数化对拍。

### 真实验证 403（离线一致但服务端拒绝）

**现象**：本地 fixture 对比全一致（签名结构、长度、前缀都对），真实请求却返回 403/412/429 或 JSON 风控码。

**关键认知**：离线 fixture 只能证明「输出与浏览器样本同构」，证明不了「服务端校验的内嵌字段正确」。签名内嵌的环境检测结果（0/1 flag、指纹摘要）在离线对比中不可见——服务端可能解包校验这些位。此时**不要**先猜 TLS/IP/换客户端，也不要假设要复现 canvas/行为等完整指纹。

**标准动作（按序，缺一不可）**：

1. **分层定位双对照**（`references/network/ip-risk-control.md` 定位矩阵）：正向=浏览器新鲜签名 + 纯协议客户端重放（记录采集→重放延迟，过期样本作废）；反向=自己签名 + ruyipage hook 注入浏览器连接（`add_preload_script` 函数声明字符串 + 执行标记验证）。结果写入验证记录 `riskLayerDiagnosis` 并过 `node scripts/check_risk_layer_diagnosis.js`。
2. **正向 403 才继续查连接层**（TLS/Session，路径 E）；**反向 403 = 签名内容层**，进入第 3 步。
3. **环境检测对齐探针法**（`env-detect-bypass.md`）：注入导出 SDK 检测函数 → 浏览器空白页采样 ground-truth → 沙箱采样 → 逐位 diff → 用运行中 SDK 的解码函数解差异位语义 → 修环境（高频项：Node 泄露全局、plugins 空置、webdriver 自有属性、DOM 方法非 native toString）→ diff 归零后重新真实验证。

实战参照：某电商 anti_content（`cases/pdd-anti-content-fbez-blackbox.md`）——19 位检测 flag 中 4 位不一致导致 40002，对齐后纯 Node H1 8/8 通过；期间两次误判（过期签名→连接层；未测量就断言需完整指纹）均已固化为 `common-pitfalls.md` 反模式 11/12。

### 静默吞错：运行成功但无输出

**现象**：vm.runInContext 运行成功（无错误抛出），但目标输出（cookie / 全局变量 / 返回值）未生成。

**根因**：目标 JS **自身**在初始化逻辑中用 `try{init()}catch(e){return e}` 或 `try{...}catch(...){}` 包裹，所有初始化错误被 JS 自己的 try-catch 吞掉，不会传播到 vm.runInContext 的外层 try-catch。这是混淆 JS 常见的反调试手段。

**诊断步骤**：
1. **Grep 静默吞错模式**：搜索目标 JS 中的 `try{...}catch(...){return ...}` 和 `try{...}catch(...){}`，特别关注末尾 IIFE 中的初始化包裹
2. **try-catch 透明化**：字符串替换把目标 JS 内部的 `try{fn()}catch(e){return e}` 改为 `fn()`，让真实错误抛出到外层
3. **重新运行**：透明化后通常会暴露 `ReferenceError: XXX is not defined` 或 `TypeError: xxx is not a function`
4. **修复缺失环境**：按真实错误补齐 sandbox
5. **验证**：目标输出成功生成后，可保留透明化版本或恢复原样

**示例**（同花顺 chameleon.js）：
```text
// 透明化前（静默吞错）：
window[r(791)]||(function(){var n=t;try{w[n(722)](e)}catch(n){return n}}(),window[r(791)]=!0)

// 透明化后（错误暴露）：
window[r(791)]||(function(){var n=t;w[n(722)](e);window[r(791)]=!0}())
// → ReferenceError: Element is not defined
```

详见 `references/workflow/common-pitfalls.md` 反模式 8。

### 同步死循环：vm 沙箱执行长时间不返回

**现象**：`vm.runInContext` 长时间不返回，外部超时 kill 后无任何错误栈，也没有新增输出。

**根因**：目标 JSVMP 在缺失环境下 opcode 分支跳转进入错误循环（真实浏览器中该分支不会进入）；或等待 `setInterval`/事件（见下节）。注意另一种静默退化：环境缺**静态属性**（如 `XMLHttpRequest.DONE`）时算法不报错但结果偏移（match5 实战：缺 DONE 导致 MD5 分组步长从 16 退化为 1），症状全部表现为 `token failed`，极难定位——补环境时静态属性与实例方法同等重要。

**诊断步骤**：
1. 用 `new vm.Script(code).runInContext(ctx, {timeout: 20000})` 设置同步超时；超时抛出的是普通 `Error`（`name` 不是 `TimeoutError`），catch 后按 message 判断
2. timeout 未生效时先确认包装/补丁代码真的被执行了——在 run 前后各打一行日志（match5 实战：字符串替换 patch 未命中导致实际跑的是旧代码，白等 60s）
3. 死循环大概率是环境缺失：给 ctx 的 window 套 Proxy，记录所有返回 `undefined` 的属性访问（探测模式），按缺失清单补齐后复测——**不要加大超时硬等**
4. 超过 20+ 步仍未推进：触发 SKILL.md 4.4 上下文防耗尽检查点（落阶段报告 → 对齐用户），不继续盲跑

**示例**（Proxy 探测缺失属性）：
```javascript
const missing = new Set();
const proxyWin = new Proxy(ctx.window, {
  get(t, k) {
    if (!(k in t) && typeof k === 'string' && !k.startsWith('__')) missing.add(k);
    return t[k];
  }
});
// 把 proxyWin 注入 ctx 再跑一轮，输出 [...missing] 即缺失清单
```

### setInterval 阻止进程退出

**现象**：vm 沙箱执行目标 JS 后，Node.js 进程挂起不退出。

**根因**：目标 JS 设置了 `setInterval(callback, delay)` 做定时刷新（如签名刷新、状态同步），Node.js 的事件循环保持活跃。

**解决方法**：
- **测试入口**：生成签名后立即 `process.exit(0)` 强制退出
- **生产代码**：signer 单例常驻模式不需要退出（复用 vm context）；一次性调用模式在签名生成后 `process.exit(0)`
- **避免 unref**：`setInterval(...).unref()` 会让定时器不阻止退出，但可能导致刷新逻辑失效（若需常驻刷新则不能用）

**示例**：
```javascript
// 测试入口
if (require.main === module) {
  const sign = generateSign(params);
  console.log(sign);
  process.exit(0);  // chameleon.js 的 setInterval 会阻止退出
}
```

### 异步死等：签名 Promise 永不 settle（黑盒 SDK 自带 asap 调度器，mashangpa 题16 实证）

**现象**：入口函数存在且能调用（`typeof loadPage === 'function'`、`window.PcSign` 已挂载），`sign()` 返回的是
Promise，但 `.then/.catch` 都不触发；**全程零报错**，官方 JS 顶层确实执行了（挂载物、localStorage 写入都在）。
最坏的误导是把它读成"SDK 检测到沙箱、走了反调试死循环"，于是去逐字段对齐 canvas/WebGL/plugins 或整包反混淆——方向全错。

**两个真因（都与"环境像不像浏览器"无关）**：

1. **SDK 自带 asap 调度型 Promise，而调度原语被写成了空桩。** 重度混淆/打包的签名 SDK 常不直接用原生
   `Promise`，而是自实现（内部靠 `MutationObserver` + `MessageChannel` + `setImmediate` 把 microtask 排上一轮）。
   桩里 `MutationObserver(){ this.observe = () => {} }` 这类"存在即可"的写法，会让 `resolve` 永远不被调度。
   注意这与「`run_with_trace.js` 的 setTimeout 桩不执行回调」是**两条不同根因**：那条缺的是定时器回调，
   这条缺的是微任务泵，宿主给了真 `setTimeout` 也一样挂死。
2. **沙箱 XHR 事件回推里 SDK 回调抛错，被 Promise 链吞掉。** `done()` 中直接 `fire('readystatechange')`，
   SDK 处理器一抛错就消失在 `promise.then` 的 rejection 黑洞里，症状与原因 1 完全相同。

**修法（可直接抄的最小形态）**：

```javascript
// ① 调度泵：observe() 必须真的把回调排上一轮
function MutationObserver(cb) {
  this.observe = () => {
    const run = () => { try { cb([{ type: 'attributes', target: doc.documentElement }], this); }
                        catch (e) { rec('mutationObserver.error', { message: String(e.message || e) }); } };
    Promise.resolve().then(run);
    this._id = setInterval(run, 4);           // 登记，退出前统一 clearInterval
  };
  this.disconnect = () => clearInterval(this._id);
  this.takeRecords = () => [];
}
// MessageChannel：port 双向 postMessage 要在下一轮真把 onmessage 打上
// ② XHR 回推逐个包 try/catch 并记录，别把异常留给 Promise
const fireSafe = (type) => { try { fire(xhr, type); }
  catch (e) { rec('xhr.handler-error', { type, message: String(e.stack || e) }); } };
```

**执行纪律**：碰到「黑盒 SDK 不返回」按固定顺序试，不要跳步——
① 补调度四件套（`MutationObserver`/`MessageChannel`/`setImmediate`/`postMessage`）→
② 给 XHR/fetch 桩的回调加异常记录 → ③ 才怀疑环境检测分支/诱饵变体（规则 29 的 nativize 对拍）。
本次实测：①②补上后**同一入参第一次调用即出值**（此前 5 轮全挂）。

**配套判别**：SDK 常把执行进度写进 localStorage，用 `case/ruyi-trace/logs/storage/*.ndjson` 的键位序列
（或沙箱内 `localStorage.setItem` 记录）当**进度探针**，比看请求列表更早定位断点——见
`references/tooling/ruyitrace-cheatsheet.md`「storage 分类日志 = SDK 进度探针」。
另注意 `node final.js --sign-only | tail` 看不到输出**不等于卡死**：值可能已全部生成，只是 SDK 的
`setInterval` 吊住了进程（上一节），改用 `timeout N node final.js --sign-only` 不经管道直接看退出码。

## 静默退出（零报错）诊断：JSVMP 字节码环境分支判定失败

「错误分类」覆盖的是**抛错**的场景；JSVMP 还有一类更隐蔽的失败：字节码对每个环境访问都有 try/catch 或条件分支，环境语义不对时走**干净退出分支**——顶层代码正常生效、无任何报错，但 VM 的挂载物（XHR hook、全局函数、命名空间）不出现。典型信号：`Date.now` 等全局重写已生效（说明目标脚本顶层跑了），但签名链路的 hook 装不上、签名不产出（match18 实证，反模式 28）。

### 诊断三板斧（每修一层重跑一次，单变量原则）

1. **window 级记录 Proxy**：把沙箱 `window`/`navigator`/`document` 包成记录 get/set/has 的 Proxy（只包 `window` 引用，**不要包整个 globalThis**——会破坏 vm 内建解析，`Date` 等经 `Reflect.get(base)` 拿不到），重放目标脚本，看最后访问的属性即退出点：

```javascript
const access = [];
const winProxy = new Proxy(base, {
  get(t, p, r) {
    const v = Reflect.get(t, p, r);
    if (typeof p === 'string') access.push(['get', p, typeof v]);
    if (p === 'hasOwnProperty' && typeof v === 'function') {
      return (k) => { const res = v.call(t, k); access.push(['hasOwn', String(k), res]); return res; };
    }
    return v;
  },
  set(t, p, v, r) { access.push(['set', String(p), typeof v]); return Reflect.set(t, p, v, r); },
});
base.window = winProxy; // VM 序言捕获的是 window 引用，包装它即可覆盖字节码的全局访问
```

2. **VM 原语包装**：脚本加载前包装 VM 序言捕获的原语（`String.fromCharCode`/`decodeURIComponent`/`parseInt`），记录解码串流——JSVMP 字符串全在运行时解码，检测词（webdriver/hasOwnProperty/selenium/事件名）直接暴露字节码意图，无需反编译。
3. **浏览器 trace seq 对齐**：从 RuyiTrace NDJSON 按序提取含目标 VM 栈帧（如 `stack` 含 `line==727` 帧）的记录（interface/member/args/value），与沙箱 Proxy 记录逐条对照，第一个分歧点即缺失/偏差的环境项。注意过滤口径：**同一 document 的所有内联脚本共享同一 file 字段**，按"栈中含 VM 行号帧"过滤而不是按 file 过滤，否则页面辅助脚本的读取会混入。

### 常见语义级根因（值对 ≠ 对齐）

| 根因 | 症状（Proxy 记录特征） | 对齐动作 |
|---|---|---|
| `vm.createContext(base)` 内建不是 base 自有属性，VM 经 `window.BigInt` 等取内建 | `get BigInt undefined` 后序列终止 | 把宿主内建注入为 sandbox 自有属性（BigInt 纯算术跨 realm 安全） |
| 探测类属性（`navigator.webdriver`）误做自有属性 | `hasOwn navigator.webdriver true` 后终止（真实浏览器挂原型、hasOwnProperty 为 false） | 属性挂原型，对齐 `hasOwnProperty` 语义而非属性值 |
| 交互事件门控（mousemove/mousedown/mouseup 监听）+ `document.readyState` | 访问序列停在 `addEventListener` / 事件相关属性 | addEventListener 桩**捕获监听器**，宿主派发合成事件（坐标用取证 trace 实测值）；readyState 给浏览器同款值 |
| `window.external` 缺失 / `getAttribute('selenium')` 探测 | 分歧点在 external / documentElement.getAttribute | external 给真值对象 `{}`；元素桩 getAttribute 返回 null |

### 环境分支诱饵变体：Function.toString native 自检与桩 nativize（match21 实证）

**症状**：沙箱黑盒执行产出「格式完全正确、内部自洽」的签名/token，但服务端拒绝；同一 JS 文件在真实 Chrome 里产出的结果与沙箱**不同**（同输入对拍即现形）。与反模式 28 的静默退出不同——这里**有产出，产出的是诱饵分支结果**。

**根因**：目标 JS 初始化时用 `Function.prototype.toString` 对一批构造器/DOM 方法做 native 自检（`String(fn)` 应为 `function X() { [native code] }`），检测不过则算法走**诱饵分支**（常量不同/魔改缺失），格式同构但服务端重算必然失败。match3.js（match21）的检测目标清单：`Object`、`Document`、`Window`、`Location`、`FocusEvent`、`Node`、`HTMLDocument`、`print` 及 DOM 方法（`getElementsByClassName`/`querySelectorAll`/`matches`/`compareDocumentPosition`），每个目标 ×3 一致性三连测。

**检测清单获取法**（Chrome MCP `navigate_page` 的 `initScript`，文档脚本前注入后 reload）：

```js
window.__ts = [];
const _fts = Function.prototype.toString;
Function.prototype.toString = function () {
  try { window.__ts.push(this.name || 'anon'); } catch (e) {}
  return _fts.call(this);
};
// reload 后读 window.__ts 去重即为检测目标清单；
// initScript 还可 hook navigator 各 getter 记录 match3.js 实际读取的环境属性
```

**桩 nativize 修复**（对每个桩函数）：

```js
function nativizeFn(fn, name) {
  Object.defineProperty(fn, 'name', { value: name, configurable: true });
  Object.defineProperty(fn, 'toString', {
    value: () => 'function ' + name + '() { [native code] }',
    writable: true, enumerable: false, configurable: true,
  });
}
```

- 元素/文档/XHR 桩的全部方法、window 顶层函数（含 `print` 这类易缺项）、缺失构造器（`Window`/`FocusEvent` 等，native 样式空壳 `nativeStyleCtor(name)`）逐一处理
- **分支指纹收敛判定**（不消耗请求额度）：`new SM3().reg`（IV 类常量数组）+ 探针函数输出（`strToBytes('abc')`）与真机值比对——诱饵分支特征是"常量数组某项重复"与"魔改变换消失"；每补一层环境看一次指纹，全部收敛后再上真实请求
- instanceof 分支需补原型链：`HTMLDocProto = Object.create(Document.prototype)` + `setPrototypeOf(document, HTMLDocProto)`（直接 `HTMLDocument.prototype = document` 会循环 __proto__）；构造器方法以 native 样式挂到 `Xxx.prototype`（真浏览器里 createElement 定义在 Document.prototype 上）
- 记录器陷阱：VM 里的全局与 Node 的 `globalThis` 不互通，记录 sink 要用模块级变量桥接；JS 的 `^`/`|` 返回带符号值，比对前统一 `(x >>> 0)`

### 收敛标准

Proxy 记录的属性访问序列与浏览器 trace 的 VM 帧序列一致 + VM 挂载物出现（hook 装上）+ 真实请求通过。`run_with_trace.js` 返回 0 事件不是"环境已足够"的信号——它只记录桩表面的访问，目标经 window 自有属性取内建、读写普通对象时产生 0 事件，此时应升级为手动 Proxy 插桩。

### `run_with_trace.js` 的两个静默致死形态（mashangpa 题12 JSVMP 实证）

用它给 JSVMP 定性前，先排除这两条——它们的症状都是"脚本跑通了、入口函数也在，但签名参数就是没被注入"，极易误判成"钩子没装上 / 还差环境项"，从而在错误方向上无限加桩：

1. **默认上下文已注入 `window`**（`globalThis.window = globalThis`，默认 bootstrap 分支）。**只有 `--bootstrap-mode minimal`、
   或按 `--env-module <文件>` 自动切 minimal 时才没有 `window`**——此时启动式
   `typeof window !== 'undefined' ? window : (window = global, window)` 退到 `global`，
   Node 的 vm 上下文同样没有 `global` → **整个 VM IIFE 抛 ReferenceError 死掉**。
   明文体（如 `loadPage`）是独立函数声明，照常存在，于是"入口能调用、url 里没有 `m`/`t`"。
   判定动作：先断言 `typeof window === 'object'`（默认应为 object；断言失败再排查是否误开 minimal），再看别的。
2. **它的 `setTimeout` 桩只记日志、从不执行回调**（`globalThis.setTimeout = function(fn, delay){ __push(...); return id++ }`）。
   任何"初始化挂在定时器里"的链路（挂钩子、装载 SDK、翻页派发）都不会发生。
   症状补充（同平台后一题实证）：这类指纹 SDK 的打包函数常写成 `if (!ready) return "";` +
   `setTimeout(复位采集器, 0)`，于是入口**同步返回空字符串**——与"被反调试检测走了死循环分支"表象一样，
   但零报错、零耗时，最容易被误读成环境检测对抗。判定动作：先在沙箱里断言"手动补跑一次挂起的定时器回调后
   返回值是否变非空"，变了就是定时器问题，不要去做环境逐字段对齐。
   **泵的实现约束**：必须用宿主真实时钟 + 真实让出事件循环（`await hostSetTimeout(...)` 再派发到期项）。
   忙等自旋会把 `Date.now()`/`performance.now()` 差值全塌成 0，而采集器里普遍有 `Math.max/min` 的节拍统计，
   结果是"签名产出了但内容退化"——比空串更难查。交付运行结束统一 `clearAll()`，否则 Node 进程不退出。

⇒ 结论：`run_with_trace.js` 是**探测**工具，不能当 JSVMP 类的交付级 runner。需要真定时器/真 window 时，
**禁止自写 `node:vm` harness（SKILL.md R2）**——走 `--env-module <文件>` 注入宿主定时器（`unref()`、
退出前统一 `clearTimeout/clearInterval`，否则进程挂住）+ `__overrideGlobal` 受控覆盖
`window/self/top/parent/frames` 指向上下文 global；`--env-module` 自动切 minimal bootstrap，避开默认桩泄漏
改变环境分支。确需脱离 run_with_trace 自建 runner 的，必须登记为 R2 例外且自带超时保护（手写 runner 无超时
保护，混淆脚本死循环后分不清挂起与静默失败）。对 eval 异常把"沙箱环境访问线索"挂在 error 上再抛
（只剩一句 `undefined.apply` 时定位极慢）。

## 自引用解码与原码执行纪律（match23 实证）

**适用形态**：obfuscator.io 家族 + 自保护陷阱（`'newState'`/`MKZrLm`）+ 解码器内 `q=o+g`（g 自身 toString 源码作解码密钥表）+ `charCodeAt(变量+常量)` 求和偏移。解码正确性逐字节依赖原始文件——AST 重写 g 即解出垃圾（轮转 IIFE 死循环）。detect-patterns.js 对该形态输出 `[WARN]`（ob-io 家族 + 自引用告警），命中后流程约束：

1. **执行只用原始字节文件**：分析期沙箱与最终交付都加载原始 JS；AST/pretty 产物仅用于阅读。交付副本放 `result/src/target/original/`（check_code_quality 取证豁免路径）并在旁记录 patch 说明 + sha256。
2. **打补丁的位置约束**：导出桩/记录器可以加在任何位置，但**不得改变被 toString 引用函数的 body 字节**（g/VVKAGE/MKZrLm 等）；toString 内容与函数在文件中的位置无关，因此"在 g 之前插入代码"安全、"改写 g 内部"必炸。
3. **导出桩时序**：导出语句按字节序执行，先于它的加载期崩溃（内嵌 axios 读 navigator、`createElement('a')` 锚点 URL 解析、meta querySelector 等）会让导出永不发生。先补齐 prelude 桩让加载走到导出点；包裹 `try/catch` 时只在"导出缺失"时重抛，容忍尾部页面逻辑崩溃。
4. **写保护沙箱的覆盖通道**：run_with_trace.js 等 bootstrap 对 window/document/navigator 等做只读 getter 写保护，环境模块直接赋值被静默拦截（目标仍拿到默认桩 → instanceof 分支错位）。用 `--env-module` 注入环境模块 + `__overrideGlobal(name, value)` 受控覆盖（覆盖后保持只读 getter 语义）；分支关键场景配 `--bootstrap-mode minimal`（提供 `--env-module` 时自动生效）跳过默认桩——**默认桩的半真半假状态本身就是环境分支的干扰源**（match23：bootstrap 的 XHR/HTMLElement 桩让内嵌 axios 走错适配器、md5 IV 错位，token 全错）。

## 环境分支证据的"缺席读法"（match23 实证）

环境分派代码常见 `typeof X !== 'undefined' ? (a instanceof X ? V1 : V2) : V3` 三层形态。**trace 中 instanceof 记录的缺席就是 typeof fallback 分支的直接证据**：RuyiTrace 会记录每次 instanceof（lhs/rhs/result），若某探测点在真机 trace 中**没有**对应 instanceof 记录，说明 `typeof X === 'undefined'` 短路——沙箱必须保持 X 未定义走 fallback，而不是按"标准浏览器常识"补上 X。match23 实证：md5 IV `_v` 的 WindowProperties 探测在 Firefox trace 中无 instanceof 记录 → `_v=0x20d90fe7e` fallback；按 Chrome 常识注入 WindowProperties 反而产出错误 token（16 字节错 5 字节，差一点误导成"再加桩"）。

操作序列：① 从 trace 提取该次哈希调用窗口内的全部 `type:'instanceof'` 记录（按 seq 与调用栈过滤）；② 与源码中的探测点清单逐一核对——**有记录**的取记录里的 rhs/result 定分支，**无记录**的取 typeof fallback 常量；③ 把最终 IV/分支常量在沙箱里 dump 出来与清单闭环（match23 用 `__iv=[0x188a7ae93,0x127794fb3,0x20d90fe7e,0x4a5bc3c6]` 验收）。

## trace 输出

推荐临时文件：

```text
case/tmp/
├── env-trace.jsonl
├── missing-env.json
├── runtime-error.log
└── env-access-summary.md
```

`env-trace.jsonl` 示例：

```json
{"type":"get","path":"navigator.userAgent"}
{"type":"get","path":"document.cookie"}
{"type":"call","path":"localStorage.getItem","args":["string"]}
```

`missing-env.json` 示例：

```json
{
  "missingGlobals": ["XMLHttpRequest"],
  "missingMethods": ["localStorage.getItem"],
  "missingProperties": ["navigator.userAgent", "document.cookie"],
  "specialObjects": ["document.all"],
  "nativeProtect": {
    "enabled": true,
    "coveredApis": ["markNativeFunction", "markNativeGetter", "createNativeCollection"]
  },
  "proxyRiskSignals": ["Object.getOwnPropertyDescriptor", "Function.prototype.toString"],
  "runtimeErrors": []
}
```

## 输出要求

阶段输出应包含：

```markdown
## Node.js 补环境运行结果

- 目标 JS：
- 入口函数：
- fixtures：
- NativeProtect：已启用 / 用户明确豁免；必须说明是否在补环境初始化阶段已启用
- 真实性检查：已确认 NativeProtect 保护证据（属性描述符、原型链、toString 保护、document.all）/ 未复核（需说明原因）
- RuyiTrace NDJSON：已优先分析 / 未提供 / 未覆盖当前问题
- 运行状态：成功 / 失败

## 缺失环境摘要

- RuyiTrace 证据：api、stack.file、line、col、相关时间窗口
- 缺失全局对象：
- 缺失方法：
- 缺失属性：
- 特殊对象：
- Proxy 检测风险：

## 下一轮补齐计划

1. ...
2. ...

## 清理检查

- [ ] 已清理临时 trace。
- [ ] 已清理失败 runner。
- [ ] 已把关键结论写入 notes。
- [ ] 已生成规范项目目录，且唯一执行入口为 `result/final.js` 或 `result/final.py`。
- [ ] 已确认最终项目所有源码不包含浏览器自动化代码。
- [ ] 已确认最终请求由 Node.js / Python HTTP 客户端实现。
- [ ] 已生成 `result/最终项目总结.md`，除非用户明确要求不生成。
```
