# 反调试对抗手册

现代网站常采用多种反调试技术阻止逆向分析。本手册涵盖常见反调试手段及其绕过策略。

## 1. debugger 语句

### 表现

```javascript
// 无限 debugger 循环
setInterval(function() { debugger; }, 100);

// 条件 debugger
(function check() {
    debugger;
    check();
})();

// 隐藏 debugger（通过 constructor）
(function() {
    var a = new Function("debugger");
    setInterval(a, 1000);
})();
```

### 绕过方案

**方案 A：ruyiPage 一键绕过**
```
ruyiPage: bypass_debugger_trap()
或
ruyiPage: inject_hook_preset(preset="debugger_bypass")
或手动注入：
ruyiPage: add_init_script(script=反debugger脚本)
```

```javascript
// 覆写 Function 构造器，过滤 debugger
const _Function = Function;
Function = function() {
    const body = arguments[arguments.length - 1];
    if (typeof body === 'string' && body.indexOf('debugger') !== -1) {
        arguments[arguments.length - 1] = body.replace(/debugger/g, '');
    }
    return _Function.apply(this, arguments);
};
Function.prototype = _Function.prototype;

// 覆写定时器，过滤 debugger
const _setInterval = setInterval;
setInterval = function(fn, ms) {
    if (typeof fn === 'function' && fn.toString().indexOf('debugger') !== -1) {
        return -1;
    }
    if (typeof fn === 'string' && fn.indexOf('debugger') !== -1) {
        return -1;
    }
    return _setInterval.apply(this, arguments);
};
```

**方案 B：加载前拦截 debugger 构造**
```
ruyiPage: add_init_script(script=反debugger脚本)
```

## 2. 开发者工具检测

### 2.1 窗口尺寸检测

```javascript
setInterval(function() {
    if (window.outerHeight - window.innerHeight > 200 ||
        window.outerWidth - window.innerWidth > 200) {
        // DevTools 已打开
        document.body.innerHTML = '';
    }
}, 500);
```

**绕过**：
```javascript
// 注入后锁定尺寸
Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight });
Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth });
```

### 2.2 console.log 计时检测

```javascript
setInterval(function() {
    var start = Date.now();
    console.log('check');
    console.clear();
    if (Date.now() - start > 10) {
        // DevTools 已打开（console.log 在 DevTools 打开时较慢）
        window.location = 'about:blank';
    }
}, 1000);
```

**绕过**：
```javascript
// 覆写 console 方法为空操作
const noop = function() {};
console.log = noop;
console.clear = noop;
```

### 2.3 toString 检测

```javascript
var devtools = /./;
devtools.toString = function() {
    // 只有在 DevTools 打开时，console.log 才会调用对象的 toString
    isDevToolsOpen = true;
    return '';
};
console.log(devtools);
```

**绕过**：
```javascript
// 覆写 console.log，阻止 toString 调用检测
const _log = console.log;
console.log = function() {
    // 不调用 toString
};
```

## 3. 代码完整性检测

### 3.1 函数 toString 检测

```javascript
function critical() {
    // 重要逻辑
}
if (critical.toString().indexOf('\n') !== -1) {
    // 代码被格式化，触发反调试
    while(true) {}
}
```

**绕过**：
```javascript
// 保存原始 toString 结果
const origToString = critical.toString();
Object.defineProperty(critical, 'toString', {
    value: function() { return origToString; }
});
```

### 3.2 源码长度检测

```javascript
if (someFunction.toString().length !== 1234) {
    // 代码被修改
    throw new Error('Integrity check failed');
}
```

**绕过**：不修改原始函数，使用 `add_init_script` 在页面脚本执行之前收集所需数据。

## 4. 时间差检测

```javascript
var t1 = Date.now();
// ... 执行代码 ...
var t2 = Date.now();
if (t2 - t1 > 100) {
    // 可能在断点处暂停了
    window.location = 'about:blank';
}
```

**绕过**：
```javascript
// Hook Date.now 返回连续值
const _now = Date.now;
let fakeTime = _now();
Date.now = function() {
    fakeTime += 1;
    return fakeTime;
};

// 或使用 performance.now
const _perfNow = performance.now;
performance.now = function() {
    return _perfNow.call(performance);
};
```

## 5. 环境检测

### 5.1 Node.js 环境检测

```javascript
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

**绕过**：在 vm 沙箱中删除这些全局变量。详见 `references/env/env-detect-bypass.md`。

### 5.2 浏览器指纹检测

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

**绕过**：补全环境变量（参考 `references/env/env-object-model.md` 和 `references/env/env-detect-bypass.md`）。

### 5.3 Selenium / Puppeteer 检测

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

**绕过**：
```javascript
// 清除自动化指纹
delete navigator.webdriver;
Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
delete window._Selenium_IDE_Recorder;
// ... 逐个清除
```

## 6. Object.defineProperty 篡改

```javascript
// 改变属性定义行为
const _defineProperty = Object.defineProperty;
Object.defineProperty = function(obj, prop, descriptor) {
    if (prop === 'cookie') {
        return ""; // 阻止 Cookie Hook
    }
    return _defineProperty.apply(this, arguments);
};
```

**绕过**：在注入脚本中保存原始引用。
```javascript
// 在所有代码之前保存原始方法
const originalDefineProperty = Object.defineProperty;
// 后续使用 originalDefineProperty 而非 Object.defineProperty
```

## 7. Proxy 检测

```javascript
// 某些代码会检测对象是否被 Proxy 包装
try {
    new Proxy({}, {});
} catch(e) {
    // 环境异常
}
```

**注意**：使用 Proxy 做 Hook 时，确保 Proxy 行为与原始对象一致。Proxy 是探测模式可用工具，但不应作为最终交付主路径；详见 `references/env/env-native-protection.md`。

## 通用反反调试注入脚本

以下脚本适合通过 `add_init_script` 在页面加载前注入：

```javascript
(function() {
    'use strict';

    // 保存原始方法引用
    const originals = {
        defineProperty: Object.defineProperty,
        getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
        setInterval: window.setInterval,
        setTimeout: window.setTimeout,
        Function: window.Function,
        eval: window.eval,
        dateNow: Date.now,
    };

    // 1. 拦截 debugger
    const _Function = originals.Function;
    window.Function = function() {
        let body = arguments[arguments.length - 1];
        if (typeof body === 'string' && body.includes('debugger')) {
            arguments[arguments.length - 1] = body.replace(/debugger\s*;?/g, '');
        }
        return _Function.apply(this, arguments);
    };
    window.Function.prototype = _Function.prototype;

    // 2. 过滤 debugger 定时器
    const _setInterval = originals.setInterval;
    window.setInterval = function(fn, ms) {
        if (typeof fn === 'function' && fn.toString().includes('debugger')) return -1;
        if (typeof fn === 'string' && fn.includes('debugger')) return -1;
        return _setInterval.apply(this, arguments);
    };

    const _setTimeout = originals.setTimeout;
    window.setTimeout = function(fn, ms) {
        if (typeof fn === 'function' && fn.toString().includes('debugger')) return -1;
        if (typeof fn === 'string' && fn.includes('debugger')) return -1;
        return _setTimeout.apply(this, arguments);
    };

    // 3. 隐藏 webdriver 属性
    originals.defineProperty.call(Object, navigator, 'webdriver', {
        get: () => undefined, configurable: true
    });

    console.log('[AntiDebug] 反反调试脚本已注入');
})();
```

## 沙箱执行侧输出劫持

混淆/反调试代码（如 jsjiami v5）可能主动**覆写 console 方法**（`console.log = noop` 或直接清空），作为反调试手段之一。浏览器里表现为 DevTools 无输出；**Node vm 沙箱里执行后同样生效**——挑战代码跑完 exit 0 但 `console.log(m)` 输出为空，极易误判"代码没执行/结果为空"（某教学靶场 match9 实测）。

识别与应对：

- 特征：沙箱执行无报错、无输出，但代码路径实际已跑。先插 `process.stdout.write('MARK\n')` 验证代码是否执行到，区分"没执行"与"输出被劫持"。
- 调试输出一律用 `process.stdout.write(...)`（或写入文件），不依赖 console。
- 需要保留 console 时，在挑战代码加载前保存原始引用（沙箱内先 `const _log = console.log` 再 eval 挑战代码），或加载后检查 `console.log === original` 是否被覆写。

## 反调试识别清单

在分析新目标时，先快速识别是否存在反调试：

| 检测类型 | 识别特征 | 影响阶段 |
|---|---|---|
| debugger 语句 | 打开 DevTools 后卡死 / 无限断点 | 动态调试 |
| 窗口尺寸检测 | `outerHeight - innerHeight` 比较 | DevTools 打开 |
| console.log 计时 | `console.log` + `Date.now` 时间差 | DevTools 打开 |
| toString 检测 | `obj.toString` 被赋值为 trap | DevTools 打开 |
| 函数 toString 检测 | `fn.toString().length` / `indexOf('\n')` | 代码格式化 |
| 时间差检测 | `Date.now()` 前后差值比较 | 断点暂停 |
| Node.js 环境检测 | `typeof process` / `typeof module` / `typeof global` | Node.js 补环境 |
| 浏览器指纹检测 | `navigator.webdriver` / `window.chrome` / `plugins.length` | 浏览器自动化 / 补环境 |
| Selenium 检测 | `$cdc_` / `__webdriver_script_fn` / `_phantom` | 浏览器自动化 |
| defineProperty 篡改 | `Object.defineProperty` 被覆写 | Hook 注入 |
| Proxy 检测 | `new Proxy` try/catch | Proxy Hook |
| console 方法覆写 | 混淆代码内 `console.log = noop` / 清空 console | Node 沙箱调试输出（用 process.stdout.write） |

识别到反调试后，先在 `case/notes/` 记录检测类型和触发条件，再按对应绕过方案处理。绕过脚本作为临时 Hook，调用栈确认后立即清理或归档。

## obfuscator.io self-defending（防篡改）反调试

obfuscator.io（ob-io）家族除标准 string-array 外，常带 **self-defending / selfDefending** 反调试：解码函数在首次初始化时校验自身源码完整性，校验失败即进入自毁死循环。识别特征与绕过方式不同于普通 debugger/toString 检测，单独列出。

### 识别特征

```javascript
// 解码器首层变量（典型短名 y/T/R + 旋转 IIFE）
function y(N, W) {
  const M = R();
  return y = function (O, T) {
    O = O - (<hex 常量表达式>);     // 索引偏移，字面量 - 该值
    let B = M[O];
    if (y['fMXGtx'] === undefined) {
      // ... base64 / RC4 解码原语 ...
      y['KuLLrv'] = A, N = arguments, y['fMXGtx'] = !![];
    }
    const x = M[<hex>], I = O + x, w = N[I];
    if (!w) {
      if (y['jddRuC'] === undefined) {
        const d = function () { /* 带 'newState' 字符串常量 */ };
        d['prototype']['bTcNvY'] = function () {
          // RegExp.test(某桩函数的 toString)
          const z = G['test'](...) ? --this['DURrIM'][<hex>] : --this['DURrIM'][<hex>];
          return this['ptBJaa'](z);
        };
        // ...
        new d(y)['bTcNvY']();       // ← self-defending 触发点
        y['jddRuC'] = !![];
      }
      B = y['KuLLrv'](B, T), N[I] = B;
    } else B = w;
    return B;
  }, y(N, W);
}

// 头部旋转 IIFE：校验和解处于 W 值时停止数组移位
(function (N, W) {
  while (!![]) { /* parseInt(解码后字符串) 求和 === W ? break : 移位 */ }
}(R, -0xe28cb * -0x1 + 0x716 * -0xf1 + 0x23b31));
```

高信号命名（实际是随机名，但不影响匹配逻辑）：`bTcNvY` / `rRRNBk` / `AKcqZX` / `PmpdcA` / `lJYsxr`（桩函数，源码形如 `function(){return 'newState';}`）；自毁副作用为 `kFdkIF.push(Math.round(Math.random()))` 无限扩容直到 RangeError "Invalid array length"。

### 表现

- 完整原始 JS 直接进 node 沙箱：打印反调试文本（如"我盯着你呢小子"）后**挂死**（setInterval + 自毁循环）；
- vm 运行或 require 提取的解码器：RangeError / 死循环；
- 反混淆（美化/换行）后函数 toString 变更，self-defending 校验更易失败。

### 绕过方案

1. **用原始单行文件**，不要用美化产物：self-defending 校验基于函数源码 toString，原始压缩文本才可能通过桩校验。
2. **提取解码器闭包**（y / T / R）与旋转 IIFE。可用括号配平在原始文件中定位 `function y(N,W)`、`function T(N,W)`、`function R()` 的起止。
3. **剥离 self-defending 调用本体**并同时移除其尾部逗号：
   - 形如 `new d(y)['bTcNvY'](),` → 替换为 ``（空串，连带逗号）。
   - 形如 `new A(T)['rRRNBk'](),` → 同理。
   - 只删本体不删逗号会出现 `,` 拼接语法错误（Unexpected token ','）。
4. **保留旋转 IIFE 原码运行**：让数组真实左移到终止条件（W 为 hex 表达式，如 `-0xe28cb*-0x1+0x716*-0xf1+0x23b31` = 636998），务必真跑完旋转，不能跳过——索引偏移即字面量减固定值（实例中为 308）。
5. 提取后拼接：`y` + `T` + `R` + 旋转 IIFE + 导出桩，进 `vm.createContext` 最小沙箱（补 `console/Math/decodeURIComponent/parseInt` 等即可）运行，导出 y/T 供后续解码。
6. 解码两个变体：`y(idx, key)` 走 RC4+base64；纯 `T(idx)` 走 base64-only。带 key 与纯索引的别名在最终文件中多处出现，按代码位置选对变体。

### 与 string-array 常规还原的区别

ob-io 常规字符串数组只需"旋转后再替换"，但 self-defending 场景下**美化产物不可执行**（源码 toString 校验），必须原码提取 + 剥离触发点。可复用案例见 `cases/ob-string-array-selfdefending-mashangpa.md`。
