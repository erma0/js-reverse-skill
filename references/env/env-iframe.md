# iframe 补环境专项

进入 Node.js 补环境阶段、目标 JS 创建或访问 `iframe`、`frame`、`contentWindow`、`contentDocument`、`postMessage` 跨 frame 通信、验证码 SDK iframe 等场景时读取本文件。本文件聚焦 iframe 的 realm 隔离、跨 frame 通信、取证方式与补环境模拟策略；通用对象模型遵循 `env-object-model.md`，行为矩阵门禁遵循 `webapi-env-detection-matrix.md`。

> **知识分级**：本文件中出现的厂商 iframe 端点与 SDK 全局入口属于 T1 识别指纹（仅用于识别"目标 JS 在访问哪个验证码 iframe"，见 SKILL.md 厂商知识分级）；各厂商协议与字段结构（T2）以 `references/captcha/` 厂商知识库与 case 证据为准。

## 总体原则

```text
iframe = 独立 Realm + 独立构造器图 + 独立 navigator/document/location/performance/crypto，
        parent/top/frames 仅按需暴露引用，绝不直接复用主 Realm wrapper。
```

iframe 不是普通 DOM 元素，而是承载独立 JS Realm 的容器。补 iframe 的核心不是 `document.createElement('iframe')` 返回一个对象，而是**为每个 iframe 建立独立的 global、独立的构造器图和独立的环境对象**，同时按同源策略决定哪些底层状态可共享。

## 触发条件

RuyiTrace NDJSON、Node trace、阶段报告或目标 JS 源码出现以下任一信号时，必须按本文件建立 iframe 补环境：

- `iframe`、`<iframe>`、`srcdoc`、`sandbox` 属性访问
- `contentWindow`、`contentDocument`、`frameElement`、`defaultView` 访问
- `window.frames`、`window.length`、`window[0]` 索引访问
- `window.top`、`window.parent`、`window.self`、`window.frameElement` 关系判定
- `postMessage`、`MessageEvent`、`MessageChannel`、`MessagePort` 跨 frame 通信
- `document.write()`、`document.close()` 在 iframe 内的执行
- `Same-Origin` / `Cross-Origin` frame 错误（如 `SecurityError: Blocked a frame with origin`）
- 验证码 SDK 加载 iframe（reCAPTCHA `bframe`、hCaptcha `hcaptcha-checkbox`、极验 v3/v4 弹窗 iframe、数美 iframe、腾讯防水墙 iframe、阿里云 nc iframe）

## iframe Window Realm 模型

### 全局关系（必须闭合）

每个 iframe 拥有独立 Window Realm，全局关系必须满足：

```js
// iframe 内：
iframe.contentWindow.self === iframe.contentWindow       // true
iframe.contentWindow.window === iframe.contentWindow     // true
iframe.contentWindow.globalThis === iframe.contentWindow // true
iframe.contentWindow.frames === iframe.contentWindow     // true
iframe.contentWindow.parent === mainWindow              // 顶层或父级 window
iframe.contentWindow.top === topWindow                   // 最顶层 window

// 主窗口与 iframe 的双向引用：
iframe.contentWindow.frameElement === iframe             // true（同源时）
iframe.contentDocument.defaultView === iframe.contentWindow  // true

// 主窗口通过 frames 索引访问：
window.frames[0] === iframe.contentWindow                // true
window.frames.length === document.querySelectorAll('iframe').length  // true（同源时）
```

### 构造器图隔离

主 Realm 与 iframe Realm 必须拥有独立的构造器图，**identity 必须不同**：

```js
// 以下全部必须为 false：
iframe.contentWindow.Object === window.Object
iframe.contentWindow.Function === window.Function
iframe.contentWindow.Array === window.Array
iframe.contentWindow.Promise === window.Promise
iframe.contentWindow.Event === window.Event
iframe.contentWindow.EventTarget === window.EventTarget
iframe.contentWindow.URL === window.URL
iframe.contentWindow.Blob === window.Blob
iframe.contentWindow.Headers === window.Headers
iframe.contentWindow.Request === window.Request
iframe.contentWindow.Response === window.Response
iframe.contentWindow.XMLHttpRequest === window.XMLHttpRequest
iframe.contentWindow.HTMLCanvasElement === window.HTMLCanvasElement
```

`iframe.contentWindow.Object.prototype !== window.Object.prototype` 也必须成立。

**禁止做法**：把主 Realm 的构造器直接赋给 iframe Realm（如 `iframeCtx.Object = mainCtx.Object`）—— 这会让 `obj instanceof iframeCtx.Object` 与浏览器行为不一致，目标 JS 检测会立即识破。

### 环境对象隔离

iframe 的 `navigator`、`document`、`location`、`performance`、`crypto`、`storage`、`screen`、`history` 必须是独立实例，不能直接复用主 Realm 的 wrapper：

| 对象 | 隔离要求 |
|---|---|
| `navigator` | 独立 Navigator 实例，userAgent/language/platform 等可同值，但 identity 不同 |
| `document` | 独立 Document 实例，cookie/referrer/URL 独立，但同源时共享 cookie 后端 |
| `location` | 独立 Location 实例，href 按 iframe 的 src 解析 |
| `performance` | 独立 Performance 实例，timeOrigin 按 iframe 创建时间，不能与主 Realm 共享 entries |
| `crypto` | 独立 Crypto 实例，可共享随机源但 wrapper 不同 |
| `localStorage` / `sessionStorage` | 同源时共享后端，但 wrapper 实例独立 |
| `screen` | 通常同值，但 wrapper 独立 |
| `history` | 独立 History 实例，按 iframe 自己的会话历史 |

**允许共享**：同源 Cookie/Storage 后端、TLS Session（同一指纹 baseline）。
**禁止共享**：navigator/performance/crypto/storage wrapper、fetch/timer 公开对象。

## 跨 frame 通信（postMessage）

### 标准行为

```js
// 主窗口向 iframe 发消息：
iframe.contentWindow.postMessage(message, targetOrigin);
// iframe 内接收：
window.addEventListener('message', (event) => {
  event.data;        // 消息内容
  event.origin;      // 发送方 origin
  event.source;      // 发送方 window 引用（跨源时为透明代理）
  event.ports;       // MessagePort 数组
});

// iframe 向主窗口发消息：
window.parent.postMessage(message, targetOrigin);
```

### 补环境要点

1. `postMessage` 是**异步**派发，进入 task queue，不在同步栈内执行
2. `event.origin` 必须按发送方 location.origin 计算，不能伪造
3. `event.source` 跨源时为透明 wrapper，访问其大部分属性会抛 `SecurityError`
4. `MessagePort` 必须 `start()` 或设置 `onmessage` 才开始派发消息
5. `MessagePort.prototype.postMessage(fn)` 会抛 `DataCloneError`（函数不可结构化克隆）
6. `MessagePort.close()` 后 pending 消息不再派发，且对端 `onmessage` 不再触发

详见 `webapi-env-detection-matrix.md` 的 `message-lifecycle` 章节。

## cross-origin frame 访问限制

### 同源策略（Same-Origin Policy）

| 访问行为 | 同源 | 跨源 |
|---|---|---|
| `iframe.contentDocument` | 可读可写 | `null` 或抛 `SecurityError` |
| `iframe.contentWindow.document` | 可读可写 | 抛 `SecurityError` |
| `iframe.contentWindow.location.href` | 可读可写 | 只读（可写不可读） |
| `iframe.contentWindow.location`（设置） | 可设置 | 可设置（允许导航） |
| `iframe.contentWindow.navigator` | 可读 | 抛 `SecurityError` |
| `iframe.contentWindow.eval` | 可调用 | 抛 `SecurityError` |
| `iframe.contentWindow.Function` | 可访问 | 抛 `SecurityError` |
| `iframe.contentWindow.postMessage` | 可调用 | 可调用（标准跨 frame 通信方式） |

### sandbox 属性

`<iframe sandbox="...">` 限制 iframe 能力：

- `allow-same-origin`：不强制视为 unique origin
- `allow-scripts`：允许执行 JS
- `allow-forms`：允许表单提交
- `allow-top-navigation`：允许导航顶层窗口
- `allow-popups`：允许 `window.open`
- 无 sandbox 属性时，iframe 全部能力开放（受同源策略约束）

补环境时按 iframe 的 sandbox 属性模拟对应限制；不能无视 sandbox 给 iframe 全部权限。

## ruyipage / RuyiTrace iframe 取证

### ruyipage 取证

ruyipage 定制 Firefox 可抓取 iframe 相关网络包与 DOM 事件：

- iframe 加载的 URL、响应状态码、Set-Cookie
- iframe 内执行的 JS 文件（按 `targets=True` 抓全部包，从 `steps` 过滤）
- iframe 内的 cookie 是否与主页面共享（同源时共享）
- iframe 的 sandbox 属性、srcdoc 内容

注意：ruyipage 抓包结果是**主页面视角**的网络包，iframe 内的执行栈需结合 RuyiTrace NDJSON 定位。

### RuyiTrace NDJSON 采集

RuyiTrace 定制 trace Firefox 可采集 iframe 内运行时日志：

- `api` 字段标注 iframe 内的 API 调用（如 `iframe.contentWindow.document.cookie`）
- `stack.file` / `line` / `col` 定位到具体 iframe 内的 JS 文件
- 多个 Realm 的调用栈会分别记录，可按 `realm` / `windowId` 区分（具体字段以 RuyiTrace 版本为准）

**搜索策略**：
1. 在 NDJSON 中 grep `iframe`、`contentWindow`、`contentDocument`、`postMessage`、`frameElement`
2. 按时间窗口与目标请求邻近度定位 iframe 内的关键 API 调用
3. 对比主 Realm 与 iframe Realm 的 `Object/Function/Array` identity 是否被检测

## 补环境模拟策略

### 策略 A：单 Realm 简化（探测模式）

仅当目标 JS 只读取 `iframe.contentWindow.location.href` 等少量字段时，可简化为：

```js
const iframeElement = Object.create(HTMLIFrameElement.prototype);
const fakeContentWindow = {
  location: { href: 'about:blank', origin: 'null' },
  postMessage: NativeProtect.setNativeFunc(function(msg, origin) {
    // 记录调用，异步触发 message 事件
  }, 'postMessage'),
};
Object.defineProperty(iframeElement, 'contentWindow', {
  get: NativeProtect.setNativeFunc(() => fakeContentWindow, 'get contentWindow'),
  enumerable: true, configurable: true,
});
```

**仅限探测模式**，交付模式必须升级到策略 B。

### 策略 B：多 Realm 完整模拟（交付模式）

为每个 iframe 建立独立 vm context（`vm.createContext`），加载独立 env 模块：

```js
const vm = require('vm');
const NativeProtect = require('./native-protect');

function createIframeRealm(options) {
  const { src, sandboxAttrs, parentRealm, baseline } = options;
  // 1. 创建独立 context
  const iframeCtx = vm.createContext({});
  // 2. 加载独立 env 模块（不能复用主 Realm 的 env）
  vm.runInContext(envBootstrapCode, iframeCtx);
  // 3. 设置全局关系
  iframeCtx.self = iframeCtx;
  iframeCtx.window = iframeCtx;
  iframeCtx.globalThis = iframeCtx;
  iframeCtx.frames = iframeCtx;
  iframeCtx.parent = parentRealm;
  iframeCtx.top = parentRealm.top;
  // 4. 设置 frameElement 双向引用
  const iframeElement = createHTMLIFrameElement(iframeCtx, src, sandboxAttrs);
  iframeCtx.frameElement = iframeElement;
  Object.defineProperty(iframeElement, 'contentWindow', {
    get: () => iframeCtx,
    enumerable: true, configurable: true,
  });
  // 5. 按 sandbox 与同源策略配置可访问属性
  applySandboxPolicy(iframeCtx, sandboxAttrs);
  applySameOriginPolicy(iframeCtx, parentRealm, src);
  return { ctx: iframeCtx, element: iframeElement };
}
```

**关键点**：
- 每个 iframe 用独立 `vm.createContext`，不共享主 Realm 的 `Object/Function` 等
- 独立 env 模块（`env-iframe-bootstrap.js`），不直接 require 主 Realm 的 env
- `postMessage` 实现为跨 context 异步任务，不能同步触发
- `event.source` 跨源时返回透明 wrapper（Proxy 限制可访问字段）

### 策略 C：具备原生语义的隔离运行时（高强度检测）

目标 JS 检测 iframe Realm 的原生行为（如 `typeof iframe.contentWindow.document.all === 'undefined'`、`Object.prototype.toString.call(iframe.contentWindow.document)` 等不可检测语义）时，纯 JS 无法可靠模拟，应根据证据选择具备对应能力的隔离运行时：

- 运行时必须能创建独立 Realm，并保持 Window、Document、构造器和内部槽关系
- 对 `document.all` 等 HTMLDDA 行为必须做浏览器基线与 Node 行为对比，不能以普通对象近似
- 具体运行时必须由用户提供可用构建和 API 契约，详见 `runtime-frameworks.md`

## 验证码 iframe 场景

### 厂商 iframe 模式

| 厂商 | iframe 特征 | 跨源 | 关键 API |
|---|---|---|---|
| reCAPTCHA v2/v3 | `google.com/recaptcha/api2/bframe`、`anchor` | 跨源 | `grecaptcha.render`、`grecaptcha.execute` |
| hCaptcha | `hcaptcha.com/checksiteconfig`、`hcaptcha-checkbox` | 跨源 | `hcaptcha.execute`、`hcaptcha.getRespKey` |
| 极验 v3 | `geetest.com/static/tools/gt.js` 创建 iframe | 跨源 | `initGeetest`、`captchaObj.appendTo` |
| 极验 v4 | `gcaptcha4.geetest.com/load` 创建 iframe | 跨源 | `initGeetest4`、`captcha4Obj.appendTo` |
| 数美 | `shumei-captcha` 内嵌 iframe | 跨源 | `initSMCaptcha` |
| 腾讯防水墙 | `t.captcha.qq.com` iframe | 跨源 | `TencentCaptcha` |
| 易盾 | `c.dun.163.com` iframe | 跨源 | `initNECaptcha` |
| 阿里云 nc | `AliyunCaptcha` iframe | 跨源 | `AliyunCaptcha` |

### 验证码 iframe 补环境要点

1. **跨源通信**：主页面与验证码 iframe 通过 `postMessage` 通信，不能直接读 iframe 内状态
2. **iframe 内 JS 不必补环境**：验证码 SDK 自己在 iframe 内运行，我们只需补主页面侧的 SDK 调用入口（`grecaptcha.execute`、`initGeetest` 等）
3. **回调契约**：SDK 通过 callback 或 Promise 返回 token/ticket/validate，补环境时记录回调调用栈
4. **轨迹事件**：滑动验证码的鼠标/触摸事件在 iframe 内捕获，需通过 RuyiTrace NDJSON 追踪，不能直接读 iframe DOM
5. **详见**：`references/captcha/captcha-request-chain.md`、`references/captcha/captcha-motion-encryption.md`

## 必查清单

补 iframe 时必须验证以下项：

| 项 | 期望 |
|---|---|
| `iframe.contentWindow Object === window Object` | `false`（identity 不同） |
| `iframe.contentWindow.Function === window.Function` | `false` |
| `iframe.contentWindow.Array === window.Array` | `false` |
| `iframe.contentWindow.self === iframe.contentWindow` | `true` |
| `iframe.contentWindow.parent === window` | `true`（顶层 iframe） |
| `iframe.contentWindow.top === window.top` | `true` |
| `iframe.contentWindow.frameElement === iframe` | `true`（同源时） |
| `iframe.contentDocument.defaultView === iframe.contentWindow` | `true`（同源时） |
| `window.frames[0] === iframe.contentWindow` | `true`（同源时） |
| `window.frames.length` | 等于 iframe 元素数量 |
| `postMessage` 派发时机 | 异步（task queue），不在同步栈 |
| `event.origin` | 等于发送方 location.origin |
| `event.source` 跨源访问 | 抛 `SecurityError` 或返回透明 wrapper |
| `iframe.contentDocument` 跨源 | `null` 或抛 `SecurityError` |
| sandbox 属性 | 按属性值限制 iframe 能力 |
| `Object.keys(iframe.contentWindow)` 数量/顺序 | 与浏览器 baseline 一致 |
| `Object.prototype.toString.call(iframe.contentWindow)` | `[object Window]` |
| `iframe.contentWindow instanceof iframe.contentWindow.Window` | `true` |

## 常见踩坑

### 1. 直接复用主 Realm 构造器

```js
// ❌ 错误：让 iframe 复用主 Realm 的 Object
iframeCtx.Object = mainCtx.Object;
// 后果：目标 JS 检测 `iframe.contentWindow.Object === window.Object` 时识破
```

正确做法：在 iframe context 内独立定义 `Object`、`Function` 等构造器（vm.createContext 默认会创建独立 intrinsic，不要覆盖）。

### 2. postMessage 同步触发

```js
// ❌ 错误：postMessage 同步触发 message 事件
iframe.contentWindow.postMessage = function(msg, origin) {
  const event = new MessageEvent('message', { data: msg, origin });
  iframe.contentWindow.dispatchEvent(event);  // 同步派发
};
// 后果：目标 JS 依赖 postMessage 异步性（如 Promise.resolve().then 后才收到消息），同步派发会导致顺序错误
```

正确做法：用 `queueMicrotask` 或 `setTimeout(0)` 异步派发。

### 3. 跨源访问未限制

```js
// ❌ 错误：跨源 iframe 也能直接读 contentDocument
const doc = iframe.contentDocument;  // 跨源时应为 null 或抛错
```

正确做法：按 origin 判定，跨源时 `contentDocument` 返回 `null` 或抛 `SecurityError`。

### 4. 忽略 sandbox 属性

```js
// ❌ 错误：sandbox="allow-scripts"（无 allow-same-origin）的 iframe 仍能访问 parent.document
iframe.contentWindow.parent.document  // 应抛 SecurityError
```

正确做法：按 sandbox 属性模拟对应限制，`allow-same-origin` 缺失时 iframe 视为 unique origin。

### 5. iframe 内 navigator/performance 复用主 Realm

```js
// ❌ 错误：iframe 的 navigator 直接复用主 Realm
iframeCtx.navigator = mainCtx.navigator;
// 后果：navigator identity 与浏览器行为不一致
```

正确做法：在 iframe context 内创建独立 Navigator 实例，可同值但 wrapper 不同。

## 与其他文档的关系

| 文档 | 关系 |
|---|---|
| `env-object-model.md` | iframe 内的对象模型同样遵循通用原则，本文件补充 iframe 特有内容 |
| `env-native-protection.md` | iframe 内的 native-like 保护与主 Realm 一致 |
| `webapi-env-detection-matrix.md` | iframe/Worker/MessagePort 行为矩阵门禁，本文件是其 iframe 章节的展开 |
| `runtime-frameworks.md` | 多 Realm 模拟的运行时选择与兼容性要求 |
| `references/captcha/captcha-request-chain.md` | 验证码 iframe 的请求链模型 |
| `references/captcha/captcha-motion-encryption.md` | 验证码 iframe 内的轨迹采集与加密 |

## 相关案例

| 案例文件 | 关联点 |
|---------|--------|
| `cases/jsvmp-xhr-interceptor-env-emulation.md` | XHR 拦截器与 iframe 的环境差异 |
