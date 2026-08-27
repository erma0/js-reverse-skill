# 浏览器环境对象模型补齐指南

进入 Node.js 补环境阶段、需要从 RuyiTrace / Node trace / fixtures 编写 `env.js`、`runner.js` 或最终 `result/src/env/*` 时读取本文件。本文件决定"补哪些浏览器对象"，但不降低对象真实性要求；真实性保护细节遵循 `env-native-protection.md`。

## 总体原则

```text
最小范围，完整真实性。只减少对象覆盖范围，不降低已补对象质量。
```

不要一开始伪造完整浏览器，但凡某个 WebAPI 进入补环境范围，就必须从第一版实现开始执行：

1. 先建立构造函数、构造函数非法调用行为、原型链、实例工厂、`prototype.constructor` 和 `Symbol.toStringTag`。
2. 再安装属性描述符、getter / setter、方法、内部状态和真实样本值。
3. getter / setter / 方法 / 构造函数默认 native-like，统一使用 `Object.defineProperty` + `NativeProtect.setNativeFunc` / `setObjFunc` 保护。
4. 实例对象默认要满足 `Object.prototype.toString.call(obj)`、`constructor.name`、`instanceof` 和 descriptor 检查。
5. 真实性要求无法用纯 JS 满足时（如 `document.all` 的 HTMLDDA），在 notes、阶段报告和最终总结中明确标记真实性不足。

"根据访问路径补最小对象模型"只表示不一次性补全所有 DOM / BOM，不表示可以先用普通对象、普通赋值或普通函数跑通后再补保护。

## 构造函数行为采样

每个进入补环境范围的构造函数都要记录浏览器真实行为：

- `Ctor()` 是否允许直接调用。
- `new Ctor()` 是否允许构造。
- 失败时的 `error.name`、`error.constructor.name`、`error.message`、`String(error)` 和 stack 首行。
- 成功时的实例原型、`instanceof`、`constructor.name` 和 `Object.prototype.toString.call(instance)`。

不要把所有构造错误都写成同一个 `Illegal constructor`。`EventTarget()`、`new Node()`、`new Document()`、`new Blob()`、`DOMRect()` 等在不同浏览器和调用方式下表现不同；必须以本 case 的取证浏览器为准。建议把结果保存到 `case/fixtures/constructor-errors.fixture.json`（模板见 `assets/fixture-templates/constructor-errors.fixture.json`，复制后按采样填充）。构造函数用 `Object.defineProperty` + `NativeProtect.setNativeFunc` 创建并抛出浏览器式错误。

推荐补齐顺序：

```text
Node 泄露阻断 → 目标对象范围确认 → 构造函数 / 原型链 / 实例工厂 → 属性描述符 / 访问器 / 方法 → 样本值写入 → fixtures 验证
```

## 对象补齐硬性清单

每补一个浏览器对象，先检查以下项目：

| 项目 | 要求 |
|---|---|
| 构造函数 | 使用 `Object.setPrototypeOf` / `Object.create` + `NativeProtect.setNativeFunc`；构造函数名称、`length`、`prototype` 描述符要明确 |
| 非法构造行为 | 按真实浏览器采样复现错误类型、错误构造器和完整 message，不能统一写泛化 `Illegal constructor` |
| 原型链 | 先建 `Constructor.prototype` 与父级链，再创建实例 |
| `prototype.constructor` | 通常不可枚举，指回构造函数 |
| `Symbol.toStringTag` | 挂在正确 prototype 或实例上，按浏览器样本设置 |
| 属性描述符 | 全部关键属性用 `Object.defineProperty` / `defineProperties` |
| 访问器 | 浏览器中是 getter / setter 的属性，不得降级为 data descriptor |
| 方法 | 统一使用 `NativeProtect.setNativeFunc` 创建 native-like 函数 |
| 访问器 toString | getter / setter 函数统一使用 `NativeProtect.setNativeFunc` 保护 |
| 实例 toString | 使用 `Symbol.toStringTag` + `NativeProtect.setObjFunc` 实现原型链与实例工厂 |
| 内部状态 | 使用 `WeakMap` / `Map` 管理私有状态 |
| 降级记录 | 真实性无法满足时必须写入 notes、阶段报告和最终总结 |

## 全局对象

基础关系可按目标需要安装，但**不得使用普通赋值**：

```js
// 错误：vm 里 window 变成可写属性
globalThis.window = globalThis;

// 正确：只读 getter，写入静默失效（与浏览器一致）
for (const name of ['window', 'self', 'top', 'parent', 'frames']) {
  Object.defineProperty(globalThis, name, { get: () => globalThis, set() {}, enumerable: true, configurable: true });
}
```

### 目标 JS 会主动覆盖全局对象（高频卡点）

除了「被检测」，全局对象还有一个更隐蔽的**被破坏**面：混淆代码里常出现 `window = {}`、`navigator = {}`、`var window = window || {}` 这类语句（自建作用域、兼容 Node/Worker 的降级分支、反调试干扰都会产生）。

- 浏览器中 `window` / `navigator` / `document` / `location` / `screen` 是宿主提供的**不可写**属性，这类赋值静默失效，目标 JS 照常运行。
- vm / 普通对象沙箱里若用普通赋值安装，这条语句会**真的顶掉全局对象**：此前注册在 `window` 上的模块、构造器（如 ASN1 / Base64 / Hex / 加密库懒加载产物）全部丢失。
- 典型症状：`sandbox.window !== sandbox`；某个模块「明明加载过」却报 undefined；同一段代码在浏览器正常、沙箱里缺依赖。这类故障不报错、不留栈，极易被误诊成「算法没搞对」而在错误方向上反复试错。

排查手段：

1. 执行目标 JS 后先断言 `sandbox.window === sandbox`、`sandbox.navigator` 仍是安装时的对象。
2. 用 `scripts/run_with_trace.js` 跑一遍，摘要里的 `blockedGlobalWrites` 字段会列出目标 JS 试图覆盖的全局对象名（该 runner 已内置只读保护并记账）。
3. 手写沙箱必须对 window / self / top / parent / frames / navigator / document / location / screen / history / localStorage / sessionStorage / crypto / performance 全部用只读 getter 安装。

### 真实性检查面

真实浏览器的 `window` 不是普通对象。只要补 `Window` / `window`，就默认需要考虑：

- `Window` 构造函数和非法构造行为。
- `Object.prototype.toString.call(window)`。
- `window instanceof Window`。
- `window.window === window`、`window.self === window`。
- `window.navigator`、`window.document`、`window.location` 的 descriptor。

探测模式可以最小化；交付模式不得把普通对象当作最终 `window` 真实性方案。

## 属性定义工具与模板模块

关键属性必须统一使用 `Object.defineProperty` + `NativeProtect` 保护，不得使用普通赋值：

```js
const userAgentGetter = NativeProtect.setNativeFunc(function userAgent() {
  return fixture.browser.userAgent;
}, 'get userAgent');

Object.defineProperty(Navigator.prototype, 'userAgent', {
  get: userAgentGetter,
  enumerable: true,
  configurable: true,
});
```

描述符来源优先级：

1. 用户真实浏览器控制台采集。
2. ruyiPage / 真实浏览器取证样本。
3. RuyiTrace 环境访问证据。
4. 常见浏览器行为模板。
5. 目标 JS 检测结果。

## navigator

常见字段：

| 字段 | 来源 |
|---|---|
| `userAgent` | 必须尽量来自真实请求 UA |
| `language` / `languages` | 来自浏览器样本 |
| `platform` | 来自浏览器样本 |
| `hardwareConcurrency` | 来自浏览器样本或用户确认 |
| `deviceMemory` | 来自浏览器样本或用户确认 |
| `webdriver` | 普通浏览器通常应为 `false` 或不存在，取决于目标环境 |
| `plugins` / `mimeTypes` | 优先真实采集，建立 `PluginArray` / `MimeTypeArray` 原型链与索引属性 |
| `userAgentData` | 来自浏览器样本；`brands/fullVersionList/platform/mobile/getHighEntropyValues` 必须与请求头 Client Hints 一致 |

补 `navigator` 时不要先手写普通 `function Navigator(){}` 作为主路径。推荐：

1. 优先建立 `Navigator` 构造函数、`Navigator.prototype` 和 `navigator` 实例工厂。
2. `Navigator` 构造函数按浏览器行为模拟非法构造。
3. `Navigator.prototype.constructor`、`Symbol.toStringTag = "Navigator"`、实例原型链在第一版就补齐。
4. `userAgent`、`language`、`languages`、`platform`、`hardwareConcurrency`、`plugins`、`mimeTypes` 等用 `Object.defineProperty` + `NativeProtect.setNativeFunc` 安装为 accessor。
5. 内部状态用 `WeakMap` 管理。

`navigator.userAgentData` 是高强度检测重点。进入补环境范围时必须采样真实浏览器：

- `brands`、`mobile`、`platform`、`toJSON`。
- `getHighEntropyValues()` 的 Promise 行为、参数校验、返回字段和错误模式。
- `architecture`、`bitness`、`model`、`platformVersion`、`uaFullVersion`、`fullVersionList` 等字段。
- 与最终请求头 `User-Agent`、`sec-ch-ua`、`sec-ch-ua-mobile`、`sec-ch-ua-platform` 保持一致；不一致时先修正 fixture 和请求头。

## window.chrome 与 Chrome 专有对象

如果目标检测 `window.chrome`，不要只补空对象。按目标浏览器版本采样后再决定是否提供：

- `chrome.app`
- `chrome.csi`
- `chrome.loadTimes`
- `chrome.runtime`

这些属性的 key、descriptor、函数 `name/length/toString`、返回对象结构都可能被检测。旧 Chrome API 不要盲目全补；版本不匹配也会形成指纹。

## location

`location` 经常参与签名。不要用空字符串猜测。值应从目标页面 URL 解析：

```js
const u = new URL(fixture.pageUrl);
```

补 `location` 时默认需要：

- 优先建立 `Location` 构造函数和 `Location.prototype`。
- `Location` 构造函数按浏览器行为模拟非法构造。
- `href`、`origin`、`protocol`、`host`、`hostname`、`port`、`pathname`、`search`、`hash` 优先按真实浏览器 descriptor 安装。
- 浏览器中是 getter / setter 的属性保持 accessor，不要降级成普通字段。
- getter / setter 用 `NativeProtect.setNativeFunc` 保护。
- 内部 URL 状态使用 `WeakMap` 管理。
- 安装 `Symbol.toStringTag = "Location"`，并验证 `Object.prototype.toString.call(location)`。

## document 与 cookie

常见访问：`document.cookie`、`document.referrer`、`document.URL`、`document.documentElement`、`document.createElement`、`document.querySelector`、`document.all`。

补 `document` 时默认先建立：

```text
EventTarget → Node → Document → HTMLDocument
```

然后再创建 `document` 实例。`Document` / `HTMLDocument` 构造函数、`prototype.constructor`、`Symbol.toStringTag`、实例 `Object.prototype.toString` 和非法构造行为都属于默认真实性基线。

`document.cookie` 必须作为 accessor descriptor 处理。即使当前样本只读取 cookie，也建议同时准备最小 setter，setter 可以只实现当前 case 需要的写入、覆盖和过期策略，但不得把 cookie 做成普通 data 属性。

DOM 方法如 `createElement`、`querySelector`、`querySelectorAll`、`getElementById` 进入补环境范围后，用 `NativeProtect.setNativeFunc` 包装，并挂在正确 prototype 上。

`document.createElement(tag)` 不能统一返回普通对象。进入补环境范围的 tag 必须映射到正确构造链：

| tag | 期望实例与原型链 |
|---|---|
| `canvas` | `HTMLCanvasElement → HTMLElement → Element → Node → EventTarget → Object` |
| `video` | `HTMLVideoElement → HTMLMediaElement → HTMLElement → Element → Node → EventTarget → Object` |
| `audio` | `HTMLAudioElement → HTMLMediaElement → HTMLElement → Element → Node → EventTarget → Object` |
| `img` / `image` | `HTMLImageElement → HTMLElement → Element → Node → EventTarget → Object` |
| `a` | `HTMLAnchorElement → HTMLElement → Element → Node → EventTarget → Object` |

同时验证 `constructor.name`、`instanceof`、`Object.prototype.toString.call(element)`、`Symbol.toStringTag`、`Object.getPrototypeOf` walk、跨原型方法 brand check。

### 元素语义不能只是"形状正确"

原型链补对只是及格线；目标代码实际**读取/调用**的元素行为必须有真实语义，两个实测案例（match10 瑞数 v3）：

- **`<a>` 的 href 必须有真实 URL 解析**：瑞数核心代码（match10）用 `createElement('a').href` 规范化 URL 并判定协议，stub 元素读 href 返回 undefined → 协议判定失败 → 签名函数原样返回 URL 不注入参数。`href` 要做成 accessor，setter 接 Node `URL` 解析后回填 `protocol/hostname/port/pathname/search/hash`，getter 返回解析结果。
- **被读取的 DOM 属性必须回填真实值**：瑞数核心代码（match10）取最后一个 `meta` 的 `content` 解码字符串表，stub 空串 → 表长 1 → 查表全 miss → 下游全崩。`meta.content`、`document.title`、`input.value` 这类值型属性，凡被目标代码读取，一律回填抓包/trace 的真实值，不得用空 stub 顶替。

判定方法：trace（RuyiTrace NDJSON）里出现的 `createElement`/`getElementsByTagName` 调用，其返回元素上被 GET 的属性清单就是"必须有真实语义"的最小集合。

## `document.all`

`document.all` 是 HTMLDDA / 不可检测特殊对象，不得用普通对象、普通 Proxy 或 `undefined` 声称完整实现。

如需精确 HTMLDDA 行为（`typeof === 'undefined'`、`Boolean === false`、`== null`），建议使用 sdenv 或其他 C++ Addon 方案；纯 JS 无法可靠模拟不可检测语义。

期望关键行为：

```js
typeof document.all === 'undefined'
document.all == null
document.all !== undefined
Boolean(document.all) === false
'all' in document
Object.prototype.toString.call(document.all) === '[object HTMLAllCollection]'
typeof document.all.length === 'number'
typeof document.all.item === 'function'
typeof document.all.namedItem === 'function'
```

使用 sdenv / C++ Addon 时硬规则：

- HTMLDDA 实现负责 `typeof all === "undefined"`、`Boolean(all) === false`、`all == null` 等不可检测语义。
- `length / item / namedItem / [0] / 命名属性 / descriptor / enumerator` 需要由 C++ 实现与 `HTMLAllCollection.prototype` 配合实现。
- `length / item / namedItem / constructor` 等原型链已有属性不要定义成 `document.all` 自有属性。

纯 JS 无法实现时必须写明降级近似，并必须在 notes、阶段报告和最终总结中标记真实性不足；不得声称完全一致。

## Storage

实现 `localStorage` / `sessionStorage` 时，不要以普通对象或普通函数作为主路径。推荐：

1. 优先建立 `Storage` 构造函数、`Storage.prototype` 和实例工厂。
2. `Storage` 构造函数按浏览器行为模拟非法构造。
3. `localStorage` / `sessionStorage` 由实例工厂创建，并设置正确 `Symbol.toStringTag`、原型链和 `constructor`。
4. `getItem`、`setItem`、`removeItem`、`clear`、`key` 用 `NativeProtect.setNativeFunc` 包装。
5. `length` 保持 accessor descriptor，getter 由 `NativeProtect.setNativeFunc` 保护。
6. 内部键值状态使用 `WeakMap` / `Map` 管理。

JS 实现示例：

```js
function Storage() {
  throw new TypeError("Illegal constructor");
}
const localStorage = Object.create(Storage.prototype);
```

实现仍必须显式 descriptor、原型链、`Symbol.toStringTag`、方法 toString 和访问器 toString，不得只用普通赋值。

## crypto

`crypto.getRandomValues`、`crypto.subtle`、`crypto.randomUUID` 可能参与签名。

- 如果签名依赖随机数，fixtures 必须记录对应随机输入或控制随机源。
- 不能随意用真实随机数比较固定期望值。
- `Crypto` / `SubtleCrypto` 构造函数、`crypto` 实例、`getRandomValues`、`randomUUID` 进入补环境范围后，要建立构造函数、原型链、descriptor 和 native-like 方法。
- `getRandomValues` 在测试模式下可使用 fixture 中的固定字节序列，但函数形态仍要像浏览器 native API。

## performance 与时间

`Date.now()`、`new Date()`、`performance.now()` 经常影响签名。

探测模式可以临时固定；交付模式要求：

- `Date` 构造函数、`Date.now`、`Date.parse`、`Date.UTC` 的 `name`、`length`、`toString` 和调用行为要受保护。
- `new Date()` 与 `Date()` 两种调用路径都要按样本验证。
- `Performance` 构造函数、`Performance.prototype.now`、`timeOrigin`、相关 descriptor 要明确。
- `performance.now` 用 `NativeProtect.setNativeFunc` 包装，不要暴露 Node `performance.nodeTiming/eventLoopUtilization/timerify`。

## Canvas / WebGL / WebGPU / 字体 / DOM 几何指纹

这类指纹不要优先在 Node.js 中真实模拟渲染。真实浏览器的 Skia、GPU、字体、抗锯齿、颜色管理和布局细节很难由 `node-canvas` / `headless-gl` / `jsdom` 精确复现。

处理原则：

- 先读取 `references/fingerprint/fingerprint-value-replay.md` 中的指纹值回放原则（3 层值来源优先级）。
- 用用户确认的取证模式采集终端 API 返回值，例如 `toDataURL`、`getImageData`、`measureText`、`getParameter`、`readPixels`、`getBoundingClientRect`。
- 在 Node.js 中按调用特征回放采样值（参考 `references/env/env-native-protection.md` 保护策略）。
- 回放函数也要挂在正确 prototype 上，并保持原型链、属性描述符、native-like `toString` 和实例对象 `Object.prototype.toString`。
- 缺少采样值时阻塞并提示补采样，不要静默返回空值或改用自动化浏览器作为最终方案。

```js
// 说明：fingerprint-env.js 由使用者按 references/fingerprint/fingerprint-value-replay.md 的 3 层值来源优先级自行实现，
// skill 不随包该模块；下方仅为其对外 API 契约示例（installFingerprintValueReplay 挂载于 globalThis）。
const { installFingerprintValueReplay } = require('./fingerprint-env'); // 使用者按 fixture 实现的模块
const fingerprintFixture = require('../../fixtures/fingerprint.fixture.json');

installFingerprintValueReplay(globalThis, fingerprintFixture, {
  strict: true,
});
```

最终项目中不得包含用于采样的 Hook、Playwright、Puppeteer、ruyiPage 或其他浏览器自动化代码。

## 高强度补充 WebAPI 对象清单

从 Cloudflare / Turnstile / Akamai / DataDome / Kasada / Shape / F5 等高强度检测样本抽象出的通用对象范围。只有目标 trace / fixture / 取证证据访问到时才补，但一旦补就必须遵循行为基线、原型链、描述符、访问器、构造函数行为、`Symbol.toStringTag` 和 native-like 保护。具体实现可使用纯 JS、框架或 native 扩展，以证据和运行时能力为准。

| 对象 / API | 重点行为 | 补环境要求 |
|---|---|---|
| `navigator.permissions` / `PermissionStatus` | `query()` Promise、`state`、`onchange`、错误类型 | 采样真实浏览器；方法 native-like；返回对象原型链和 descriptor 不得用普通对象 |
| `navigator.plugins` / `navigator.mimeTypes` | 长度、索引属性、命名属性、`item()`、`namedItem()` | 建立 `PluginArray` / `MimeTypeArray` 原型链与索引属性；禁止空数组或普通数组 |
| `speechSynthesis` / `SpeechSynthesisUtterance` | `getVoices()` 列表、异步 voiceschanged | 只回放真实采样的 voices 摘要；构造函数、事件属性和方法 toString 需保护 |
| `AudioContext` / `OfflineAudioContext` | 构造限制、采样率、`startRendering()` Promise | 终端值走指纹值回放；不要用 Node 音频模拟库猜值 |
| `DOMRect` / layout dimensions | `getBoundingClientRect()`、offset/client/scroll 尺寸 | 按目标元素和调用栈采样；DOMRect 原型链、只读属性、`toJSON` 行为要真实 |
| `CSSStyleDeclaration` / `getComputedStyle` / `matchMedia` | 属性名、索引、`length`、media query 结果 | 使用真实浏览器样本；不要只返回空对象或固定字符串 |
| `navigator.mediaDevices` / WebRTC | `enumerateDevices()`、`getUserMedia()` 错误模式 | 不暴露宿主 Node；需要权限或设备时记录降级 |
| `screen` / viewport / DPR | `width/height/avail*`、`colorDepth`、`devicePixelRatio` | 必须与取证工具 viewport、最终请求 UA / Client Hints 和 fingerprint baseline 一致 |

禁止把以下写法作为主路径：

```js
ctx.Blob = function Blob() {};
ctx.screen = { width: 1920, height: 1080 };
ctx.indexedDB = { open() {} };
ctx.URL.createObjectURL = function createObjectURL() {};
HTMLCanvasElement.prototype = { getContext() {} };
Object.assign(ctx, { history: { back() {} } });
ctx.TextEncoder = globalThis.TextEncoder;
```

正确方向：

1. 构造函数优先由 `Object.setPrototypeOf` / `Object.create` + `NativeProtect.setNativeFunc` 创建。
2. 普通方法优先由 `NativeProtect.setNativeFunc` 创建。
3. getter / setter 由 `NativeProtect.setNativeFunc` 保护后挂到 `Object.defineProperty`。
4. 实例对象优先由实例工厂创建，禁止直接 `{}`。
5. 内部状态使用 `WeakMap` 管理。

重点对象最低结构清单：

| 对象 / API | 必须补齐的最低结构 |
|---|---|
| `screen` / `Screen` / `ScreenOrientation` | `Screen` 构造函数、`prototype`、`screen instanceof Screen`、descriptor；`orientation` 需要 `ScreenOrientation` 原型链和 `type/angle` 访问器 |
| `Blob` / `File` | 构造函数可 `new`、`size/type/name/lastModified` descriptor、`slice/text/arrayBuffer/stream` native-like 方法 |
| `FormData` | 构造函数可 `new`、`append/delete/get/getAll/has/set/entries/keys/values/forEach` 均 native-like |
| `Event` / `CustomEvent` / `MessageEvent` | 构造函数、继承链、`type/bubbles/cancelable/detail/data/origin/source` descriptor，`preventDefault/stopPropagation/stopImmediatePropagation` native-like |
| `XMLHttpRequest` | `EventTarget → XMLHttpRequestEventTarget → XMLHttpRequest` 链路，`open/send/abort/setRequestHeader` native-like，`readyState/status/responseText` descriptor |
| `indexedDB` / `IDBFactory` / `IDBOpenDBRequest` / `IDBKeyRange` | `indexedDB` 必须是 `IDBFactory` 实例；`open/deleteDatabase/cmp` native-like；`IDBKeyRange.only/lowerBound/upperBound/bound` 为静态 native-like |
| `URL.createObjectURL` / `URL.revokeObjectURL` | 作为 `URL` 静态方法用 descriptor 安装，函数体用 `NativeProtect.setNativeFunc` 包装；`URL` 本体不要盲目透传 Node 宿主构造器 |
| `CSS.supports` / `CSS.escape` | `CSS` 不能是普通对象字面量；静态方法必须 native-like |
| `MutationObserver` / `IntersectionObserver` / `ResizeObserver` | 构造函数可 `new`，`observe/unobserve/disconnect/takeRecords` native-like |
| `BroadcastChannel` / `MessageChannel` / `MessagePort` | 构造函数与 `MessagePort` 原型链，`postMessage/start/close/addEventListener` native-like |
| Canvas / WebGL 上下文 | 原型链，`getContext/toDataURL/getImageData/measureText/getParameter/readPixels` 等终端 API 用 `NativeProtect.setNativeFunc` 包装并按指纹 fixture 回放 |
| `AudioContext` / `OfflineAudioContext` | 构造函数、`BaseAudioContext` 链路、`createAnalyser/createOscillator/decodeAudioData/startRendering` native-like |
| `Image` / `HTMLImageElement` / `Worker` | 需要 `HTMLElement → HTMLImageElement`、`EventTarget → Worker` 链路，`postMessage/terminate/addEventListener` native-like |

直接复用 Node 宿主对象也属于风险写法。`TextEncoder`、`TextDecoder`、`URL`、`URLSearchParams`、`fetch`、`Headers`、`Request`、`Response`、`WebAssembly`、Streams、Events、`crypto` 等如果参与目标检测，不能简单写成 `ctx.X = globalThis.X`；必须按浏览器样本和目标调用范围建立可控实现，或明确记录不可用原因。

## fetch 与 XMLHttpRequest

补环境阶段默认不应让目标 JS 真的发网络请求。

- 如果目标 JS 只构造请求或计算签名，`fetch` / `XMLHttpRequest` 可以记录调用并返回离线 fixture。
- `fetch`、`Headers`、`Request`、`Response`、`XMLHttpRequest` 一旦进入补环境范围，仍要建立构造函数、原型链、方法、访问器、descriptor 和 native-like 行为。
- 不要直接透传 Node 宿主 `fetch` / undici，也不要把最终验证交给浏览器自动化。
- 如果必须访问网络，先确认用户授权和访问范围；最终真实请求应由已确认的 Node.js / Python TLS 指纹兼容客户端完成。

## 原型链

原型链不是最后补的附加项，而是每个对象进入补环境范围时的第一步。

以下内容默认要考虑：

```js
navigator instanceof Navigator
document instanceof Document
Object.getPrototypeOf(navigator)
navigator.constructor.name
Object.prototype.toString.call(navigator)
Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')
Function.prototype.toString.call(Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent').get)
```

基础链路示例：

```text
EventTarget → Node → Document → HTMLDocument
EventTarget → XMLHttpRequestEventTarget → XMLHttpRequest
HTMLElement → HTMLCanvasElement
```

使用 `Object.setPrototypeOf` / `Object.create` 一次性定义构造函数、父级、实例工厂、`Symbol.toStringTag`、只读 prototype 和不可变原型设置，并用 `NativeProtect` 做函数和实例保护。无法用纯 JS 表达的真实性要求（如 `document.all` HTMLDDA），按 `document.all` 段落指引使用 sdenv 或其他 C++ Addon 方案。

不要为了"完整"一次性补所有 DOM。只补 RuyiTrace / Node trace / fixtures / 目标检测证明目标 JS 会访问或依赖的部分；但已补的部分必须完整真实性。

## 深度行为审计（移植自 xbs）

对象模型补齐后，还要通过两层"行为像不像真实浏览器"的深度审计。这两层回答的是**访问到的浏览器行为是否一致**，而不是"访问了什么 API"（后者由 Trace 覆盖矩阵负责）。

| 审计层 | 文档 | 触发条件 | 关注点 |
|---|---|---|---|
| 对象形状审计 + 私有状态泄露 | `references/env/object-shape-private-state.md` | 目标检测命中 `Reflect.ownKeys` / `Object.getOwnPropertyDescriptors` / prototype walk / `_${__}` 私有字段枚举 | ownKeys 顺序、descriptor 完整性、prototype 链路 walk、`WeakMap` 私有状态不泄露 |
| WebAPI 行为矩阵门禁 | `references/env/webapi-env-detection-matrix.md` | iframe / Worker / PerformanceTimeline / DOM-CSSOM / EventTarget / timer / writer 分支行为被检测 | iframe Realm 隔离、Worker 入口语义、PerformanceTimeline 时序、CSSOM 计算值、EventTarget 派发顺序、timer 排序、writer 分支 |

对象模型补齐清单只解决"对象长什么样"；上述两层解决"对象行为像不像浏览器"。两者都通过才算补环境完成。

> iframe Realm 隔离的专项补环境（独立 context、跨域通信、frameElement 双向引用、sandbox 策略）详见 `references/env/env-iframe.md`。

## 相关案例

| 案例文件 | 关联点 |
|---------|--------|
| `cases/jsvmp-xhr-interceptor-env-emulation.md` | 58 项环境差异对齐（jsdom 环境伪装） |
| `cases/jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md` | 62 项差异（58 基础 + 4 Firefox 特有） |
| `cases/jsvmp-ruishu6-cookie-412-sdenv.md` | sdenv 对象模型（魔改 jsdom + C++ Addon） |
| `cases/universal-vmp-source-instrumentation.md` | 分支 C 环境伪装（hot_keys → 环境属性集） |
