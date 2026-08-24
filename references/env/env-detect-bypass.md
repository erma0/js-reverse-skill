# 环境检测绕过清单

将浏览器端 JS 代码移植到 Node.js 执行时，需要模拟浏览器环境并绕过环境检测。本指南提供各种场景下的环境检测识别与绕过方案。

## 原则

1. **最小补全优先**：只补目标代码实际访问的 API，不要一次性补全所有浏览器 API
2. **按需扩展**：运行报错时再补对应的属性/方法
3. **真实值优先**：尽量使用真实浏览器采集的值，而非随意伪造
4. **真实性保护**：补全的对象必须遵循 `env-native-protection.md` 的真实性要求，不得只用普通对象 / 普通赋值

## 环境检测绕过清单

| 检测项 | Node.js 默认 | 需要补全的值 |
|--------|-------------|-------------|
| `typeof window` | `undefined` | `object` |
| `typeof document` | `undefined` | `object` |
| `typeof navigator` | `undefined` | `object` |
| `typeof process` | `object` (暴露) | 需要删除 |
| `typeof module` | `object` (暴露) | 需要删除 |
| `typeof global` | `object` (暴露) | 视情况删除 |
| `typeof Buffer` | `function` (暴露) | 需要删除 |
| `typeof require` | `function` (暴露) | 需要删除 |
| `navigator.webdriver` | N/A | `false` / `undefined` |
| `window.chrome` | N/A | `{ runtime: {} }` |
| `navigator.plugins.length` | N/A | `> 0` |

### 清除 Node.js 特征

```javascript
function hideNodeFeatures(sandbox) {
    delete sandbox.process;
    delete sandbox.module;
    delete sandbox.exports;
    delete sandbox.require;
    delete sandbox.global;
    delete sandbox.__filename;
    delete sandbox.__dirname;
    delete sandbox.Buffer;
}
```

### Node.js 环境检测

```javascript
// 目标 JS 可能通过以下方式检测 Node.js 环境
if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    throw new Error('Node.js detected');
}
if (typeof module !== 'undefined' && module.exports) {
    throw new Error('CommonJS detected');
}
if (typeof global !== 'undefined') {
    throw new Error('Non-browser detected');
}
```

绕过：在 vm 沙箱中删除这些全局变量。

### 浏览器指纹检测

```javascript
if (!window.chrome || !window.chrome.runtime) {
    throw new Error('Not Chrome');
}
if (navigator.webdriver) {
    throw new Error('WebDriver detected');
}
if (navigator.plugins.length === 0) {
    throw new Error('Headless browser detected');
}
```

绕过：补全环境变量（参考 `references/env/env-object-model.md`）。

### Selenium / Puppeteer 检测

```javascript
const checks = [
    'webdriver' in navigator,
    '_Selenium_IDE_Recorder' in window,
    'callSelenium' in document,
    '__webdriver_script_fn' in document,
    '$cdc_asdjflasutopfhvcZLmcfl_' in document,
    '_phantom' in window,
    'callPhantom' in window
];
if (checks.some(Boolean)) {
    throw new Error('Automation detected');
}
```

绕过：

```javascript
// 清除自动化指纹
delete navigator.webdriver;
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
delete window._Selenium_IDE_Recorder;
// ... 逐个清除
```

## Node.js vm 沙箱最小环境

### 基础模板

```javascript
const vm = require('vm');

function createMinimalSandbox(options = {}) {
    const sandbox = {
        // 全局对象
        window: null,
        self: null,
        globalThis: null,

        // DOM 最小模拟（探测模式可用；交付模式需按 references/env/env-object-model.md 补齐原型链）
        document: {
            cookie: options.cookie || '',
            createElement: (tag) => ({
                tagName: tag.toUpperCase(),
                style: {},
                setAttribute: () => {},
                getAttribute: () => null,
                appendChild: () => {},
                innerHTML: '',
                src: '',
            }),
            getElementById: () => null,
            getElementsByTagName: () => [],
            getElementsByClassName: () => [],
            querySelector: () => null,
            querySelectorAll: () => [],
            head: { appendChild: () => {} },
            body: { appendChild: () => {} },
            location: { href: options.url || 'https://example.com', hostname: 'example.com' },
            referrer: options.referrer || '',
            title: '',
            readyState: 'complete',
        },

        // Navigator（探测模式可用；交付模式需按 env-object-model.md 补齐原型链）
        navigator: {
            userAgent: options.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            appCodeName: 'Mozilla',
            appName: 'Netscape',
            appVersion: '5.0',
            platform: 'MacIntel',
            language: 'zh-CN',
            languages: ['zh-CN', 'zh', 'en'],
            cookieEnabled: true,
            onLine: true,
            plugins: { length: 3 },
            mimeTypes: { length: 4 },
            webdriver: false,
            hardwareConcurrency: 8,
            maxTouchPoints: 0,
        },

        // Location
        location: {
            href: options.url || 'https://example.com',
            protocol: 'https:',
            host: 'example.com',
            hostname: 'example.com',
            port: '',
            pathname: '/',
            search: '',
            hash: '',
            origin: 'https://example.com',
        },

        // Screen
        screen: {
            width: 1920,
            height: 1080,
            availWidth: 1920,
            availHeight: 1055,
            colorDepth: 24,
            pixelDepth: 24,
        },

        // 定时器
        setTimeout: setTimeout,
        setInterval: setInterval,
        clearTimeout: clearTimeout,
        clearInterval: clearInterval,

        // 内置对象
        String, Array, Object, Math, Date, RegExp, JSON, Map, Set, WeakMap, WeakSet,
        parseInt, parseFloat, isNaN, isFinite, NaN, Infinity, undefined,
        encodeURIComponent, decodeURIComponent,
        encodeURI, decodeURI,
        escape, unescape,
        Error, TypeError, RangeError, SyntaxError, ReferenceError,
        ArrayBuffer, Uint8Array, Int32Array, Float64Array, DataView,
        Promise,
        Proxy, Reflect,
        Symbol,

        // Base64
        btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
        atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),

        // Console（用于调试）
        console: console,
    };

    // 循环引用
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.top = sandbox;
    sandbox.parent = sandbox;
    sandbox.frames = sandbox;

    return sandbox;
}

// 使用示例
function runInSandbox(code, options = {}) {
    const sandbox = createMinimalSandbox(options);
    vm.createContext(sandbox);

    try {
        vm.runInContext(code, sandbox, {
            timeout: options.timeout || 5000,
            filename: options.filename || 'sandbox.js',
        });
    } catch (e) {
        console.error('沙箱执行错误:', e.message);
        throw e;
    }

    return sandbox;
}
```

### Cookie 拦截模式

```javascript
function createCookieTrapSandbox(options = {}) {
    const sandbox = createMinimalSandbox(options);
    const cookies = {};

    Object.defineProperty(sandbox.document, 'cookie', {
        get() {
            return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
        },
        set(val) {
            const parts = val.split(';')[0].split('=');
            const name = parts[0].trim();
            const value = parts.slice(1).join('=').trim();
            cookies[name] = value;
            console.log(`[Sandbox] Cookie Set: ${name}=${value}`);
        }
    });

    sandbox._cookies = cookies;
    return sandbox;
}
```

## XMLHttpRequest 模拟

```javascript
function createXHRStub(interceptor) {
    return class XMLHttpRequest {
        constructor() {
            this.readyState = 0;
            this.status = 0;
            this.responseText = '';
            this.response = '';
        }

        open(method, url) {
            this._method = method;
            this._url = url;
            this.readyState = 1;
        }

        setRequestHeader(name, value) {
            this._headers = this._headers || {};
            this._headers[name] = value;
        }

        send(body) {
            if (interceptor) {
                interceptor({
                    method: this._method,
                    url: this._url,
                    headers: this._headers,
                    body: body,
                });
            }
            this.readyState = 4;
            this.status = 200;
            if (this.onreadystatechange) this.onreadystatechange();
            if (this.onload) this.onload();
        }

        addEventListener(event, handler) {
            this['on' + event] = handler;
        }
    };
}
```

## jQuery 模拟

```javascript
function createjQueryStub() {
    const $ = function(selector) {
        return {
            length: 1,
            val: () => '',
            text: () => '',
            html: () => '',
            attr: () => '',
            css: () => ({}),
            find: () => $(''),
            each: (fn) => { fn(0, {}); },
            click: () => {},
            on: () => {},
            ajax: $.ajax,
        };
    };

    $.ajax = function(options) {
        console.log('[jQuery] $.ajax:', options.url, options.data);
        return { done: (fn) => ({ fail: () => ({}) }) };
    };

    $.get = $.post = $.ajax;
    $.fn = $.prototype = {};
    $.extend = Object.assign;

    return $;
}
```

## 完整环境补全模板（jsdom）

当最小补全不够时，使用 jsdom 提供完整 DOM 环境：

```javascript
const { JSDOM } = require('jsdom');

function createFullBrowserEnv(options = {}) {
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
        url: options.url || 'https://example.com',
        referrer: options.referrer || '',
        contentType: 'text/html',
        pretendToBeVisual: true,
        runScripts: 'dangerously',
        resources: 'usable',
    });

    const { window } = dom;

    // 补充 jsdom 缺少的 API
    if (!window.btoa) {
        window.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
    }
    if (!window.atob) {
        window.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
    }

    return { dom, window, document: window.document };
}
```

## ruyiPage + RuyiTrace 辅助确定环境需求

```
1. ruyiPage 加载目标页面，RuyiTrace 记录脚本访问的 window|document|navigator|location|screen 等 API
   → 先在 trace 中识别代码访问了哪些浏览器 API

2. 通过 RuyiTrace 环境访问日志统计运行时真正访问了哪些环境字段
   → 确定需要补全的环境字段范围

3. 在 RuyiTrace 中定位环境检测函数入口，捕获入参、返回值和调用栈
   → 确认需要补全的关键分支
```

## 签名内嵌环境检测的对齐探针法（浏览器采样 + 沙箱 diff）

> **触发条件**：分层定位矩阵（`references/network/ip-risk-control.md`）判定「服务端校验签名内容」，且黑盒密文无法反推哪个字段被校验时使用。实战来源：拼多多 anti_content——服务端校验 fbeZ `Wt()` 19 位环境检测 flag，对齐 4 个差异位后纯协议 8/8 通过（`cases/pdd-anti-content-fbez-blackbox.md`）。

核心思想：**不要猜服务端校验什么，测量 SDK 实际内嵌什么**。签名内嵌的检测结果（而非 canvas/行为等原始指纹）才是对齐目标，通常是有限的几十个 0/1 位。

步骤：

1. **注入导出检测函数**：在 SDK 源码的稳定锚点后注入导出语句（如 fbeZ 的 `var de=new se;` 后注入 `window.__fbezWt=Wt;`），Node 沙箱加载同一份注入版源码。锚点选模块尾部单例创建处，保证检测函数与闭包变量均已定义。
2. **浏览器采样 ground-truth**：取证阶段 ruyipage 打开空白页，跑与沙箱相同的加载器（伪造 `window.webpackJsonp` push + 注册 chunk + require 目标模块），调用导出的检测函数记录真实浏览器输出。空白页即可——检测结果只依赖 window/navigator/document 等浏览器级对象，与业务页面无关。
3. **沙箱采样并逐位 diff**：同一份注入版在 Node 沙箱调用，逐位对比，得到有限差异位清单（拼多多案例 19 位中仅 4 位不同）。
4. **翻译差异位语义**：混淆 SDK 的检测项用其字符串解码函数解出——在浏览器里注入导出解码函数（如 `window.__fbezW = W`）后调用 `W("0x..","salt")` 批量解键，比静态正则提取字符串数组可靠（静态提取易匹配到内嵌子模块的数组，索引越界产出乱码）。
5. **按检测项修环境并复测**：差异位归零后重新生成签名做真实验证。高频差异项即 `node-leakage.md` 与本文件上方清单的内容（Node 泄露全局、plugins 空置、webdriver 自有属性、DOM 方法非 native toString 等）。

注意：对齐目标以「真实浏览器实测输出」为准，不以「检测项列表理论值」为准——某些位在真实浏览器里就是 null/未设置（如 fbeZ 的 index 7），沙箱照抄实测值即可，不要"修正"它。

## 内核级差异检测（UA 覆盖无效的深层检测）

> **触发条件**：目标站提示"限制浏览器"（如仅支持 Chrome），但用 `forensic_ruyipage.py --ua` 覆盖 UA 后行为不变——检测的不是 UA 字符串，而是浏览器内核固有差异。实战来源：猿人学 match5——题目"限制 chrome"，改 UA 为 Chrome 后签名 `m` 仍不生成；真正机制是混淆加载器用 `eval.toString()` 精确匹配 Chrome 的单行格式选择解码分支，Firefox（取证内核）走错分支产生 PUA 非法字符（`SyntaxError: illegal character U+F759`），签名永不生成（`cases/modified-md5-xhr-done-yuanrenxue.md`）。

常见内核级检测项（改 UA / 改指纹均无效）：

| 检测项 | Chrome / Node | Firefox（取证内核） | 典型用法 |
|--------|--------------|--------------------|---------|
| `eval.toString()` | `"function eval() { [native code] }"`（单行） | 同串但含换行 `\n` | 与 Chrome 格式全等比较，决定走正确解码分支还是干扰分支 |
| `new Error().stack` 帧格式 | `    at fn (file:1:2)` | `fn@file:1:2` | 分支选择 / 环境识别 |
| `window.chrome` | 存在 | 不存在 | Chrome 内核识别（见上方指纹检测） |

诊断动作（取证浏览器内 `run_js` 一次采齐，无需多轮探针）：

```javascript
JSON.stringify({
  ua: navigator.userAgent,
  evalStr: eval.toString(),
  stackHead: new Error().stack.split('\n').slice(0, 3),
  hasChrome: typeof window.chrome
})
```

**取证侧影响**：ruyipage / RuyiTrace 均为 Firefox 内核，命中内核级检测时取证浏览器无法触发目标路径（签名不生成、目标请求 400/403 且与 UA、Cookie 无关）。此时按 SKILL.md 状态机进入 `BLOCKED_FORENSIC`：输出卡点与检测证据对齐用户，不要无限换姿势重试取证，也不要跳过 Step 2 静默推进。

**补环境侧机会**：Node 的 `eval.toString()` 恰为 Chrome 单行格式——检测 Chrome 内核的分支在 Node 沙箱**天然走对**（match5 即靠此路径纯协议还原，Node 补环境无需伪造该检测项，保持默认即通过）；反过来检测 Firefox 内核的站点则不适合 Node 路线。判断顺序：先在取证浏览器内采样确认检测项，再决定取证降级方式与补环境方向。

## 重要说明

本文件提供的"最小沙箱"、"XHR stub"、"jQuery stub"等模板仅适用于**探测模式**。进入**交付模式**时，必须按 `env-object-model.md` 和 `env-native-protection.md` 的要求补齐原型链、属性描述符、访问器、native-like toString 等真实性保护，不得把普通对象作为最终交付方案。

## 相关案例

| 案例文件 | 关联点 |
|---------|--------|
| `cases/jsvmp-xhr-interceptor-env-emulation.md` | 环境检测绕过（navigator.webdriver / plugins / DOM 布局） |
| `cases/pdd-anti-content-fbez-blackbox.md` | 签名内嵌环境检测对齐探针法（Wt() flag 浏览器采样 + 沙箱 diff） |
| `cases/modified-md5-xhr-done-yuanrenxue.md` | 内核级差异检测（eval.toString() 分支检测，Node 天然匹配 Chrome 格式） |
