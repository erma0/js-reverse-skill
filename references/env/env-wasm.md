# WASM 环境补全指南

加密逻辑在 WebAssembly 中实现时的环境补全方案。模板参考 `templates/wasm-loader/`。

## 适用条件

- 加密函数通过 WebAssembly 实现
- WASM 有明确的导出函数接口
- 不打算反编译 WASM，先验证 I/O

## 技术栈

- `fs`（Node.js 内置）— 读取 .wasm 文件
- `WebAssembly`（Node.js 内置）— 加载和实例化

## 注意事项

1. **先验证 I/O，不要先反编译 WASM**
2. 检查 `WebAssembly.Module.imports()` 了解环境依赖
3. wasm-bindgen 生成的 WASM 需要补 `Window` 类和 DOM
4. `unreachable` panic 通常是环境缺失
5. 缺少采样值时阻塞并提示补采样，不要静默返回空值

## 基础 WASM 加载

```javascript
const fs = require('fs');

async function loadWasm(wasmPath, importObject = {}) {
    const wasmBuffer = fs.readFileSync(wasmPath);

    const defaultImports = {
        env: {
            memory: new WebAssembly.Memory({ initial: 256 }),
            table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
            abort: () => { throw new Error('WASM abort'); },
            ...importObject.env,
        },
        wasi_snapshot_preview1: {
            fd_write: () => 0,
            fd_close: () => 0,
            fd_seek: () => 0,
            proc_exit: () => {},
            ...importObject.wasi_snapshot_preview1,
        },
        ...importObject,
    };

    const result = await WebAssembly.instantiate(wasmBuffer, defaultImports);
    return result.instance;
}
```

## 检查 WASM 依赖

加载前先检查 WASM 的导入声明，了解需要补全哪些环境：

```javascript
const fs = require('fs');

function inspectWasmImports(wasmPath) {
    const wasmBuffer = fs.readFileSync(wasmPath);
    const module = new WebAssembly.Module(wasmBuffer);
    const imports = WebAssembly.Module.imports(module);

    console.log('WASM 导入依赖：');
    for (const imp of imports) {
        console.log(`  ${imp.module}.${imp.name} (${imp.kind})`);
    }

    return imports;
}

// 使用示例
const imports = inspectWasmImports('./encryption.wasm');
// 输出示例：
//   env.memory (memory)
//   env.__js_sign (function)
//   env.__js_get_time (function)
```

## wasm-bindgen (Rust) 环境补全

wasm-bindgen 生成的 WASM 通常需要 `Window` 类和 DOM：

```javascript
class Window {
    constructor() {
        this.document = {
            body: {},
            createElement: () => ({}),
            getElementById: () => null,
        };
    }
}

function patchWasmBindgenEnv() {
    const win = new Window();
    win.window = win;
    win.self = win;

    globalThis.Window = Window;
    globalThis.window = win;
    globalThis.self = win;
    globalThis.document = win.document;

    // wasm-bindgen 可能检查 instanceof
    // 确保 win instanceof Window === true
}
```

**import 桩语义（match20 实测的关键坑）**：不改写全局、直接提供 importObject 桩时，桩的返回值要按"浏览器里会返回什么"对齐，不是按"Node 里什么是真的"——get-global 初始化链要求 `__wbg_instanceof_Window_*` 桩返回 **true**、`__wbg_document_*`/`__wbg_body_*` 桩返回**非空对象**（空壳 `{body:{}}` 即可），返回 false/None 会让 Rust 端进 `unreachable`。详见 `env-debug-loop.md`「WASM trap：unreachable」专节。

## Emscripten 环境补全

Emscripten 编译的 WASM 通常需要提供 `Module` 对象：

```javascript
const Module = {
    print: console.log,
    printErr: console.error,
    TOTAL_MEMORY: 16777216,
    noInitialRun: true,
    onRuntimeInitialized: function() {
        console.log('WASM Runtime Ready');
    }
};
```

## 完整调用示例

```javascript
const fs = require('fs');
const path = require('path');

async function runWasmSign(wasmPath, inputData) {
    // 1. 检查导入依赖
    const wasmBuffer = fs.readFileSync(wasmPath);
    const module = new WebAssembly.Module(wasmBuffer);
    const requiredImports = WebAssembly.Module.imports(module);

    // 2. 准备导入对象
    const importObject = {
        env: {
            memory: new WebAssembly.Memory({ initial: 256 }),
            table: new WebAssembly.Table({ initial: 0, element: 'anyfunc' }),
            abort: (msg, file, line, col) => {
                throw new Error(`WASM abort at ${file}:${line}:${col}: ${msg}`);
            },
            // 按 requiredImports 补全其他依赖
        },
    };

    // 3. 实例化
    const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);
    const exports = instance.exports;

    // 4. 调用导出函数
    // 假设导出函数名为 _sign，输入为指针 + 长度，输出为指针
    const memory = exports.memory || importObject.env.memory;
    const sign = exports._sign || exports.sign;

    // 写入输入数据
    const inputBuf = new TextEncoder().encode(inputData);
    const inputPtr = exports._malloc(inputBuf.length + 1);
    new Uint8Array(memory.buffer, inputPtr, inputBuf.length).set(inputBuf);

    // 调用
    const outputPtr = sign(inputPtr, inputBuf.length);

    // 读取输出
    const outputBuf = new Uint8Array(memory.buffer, outputPtr);
    const nullIdx = outputBuf.indexOf(0);
    const result = new TextDecoder().decode(outputBuf.slice(0, nullIdx >= 0 ? nullIdx : undefined));

    // 释放
    exports._free(inputPtr);
    exports._free(outputPtr);

    return result;
}
```

## 调试技巧

### `unreachable` panic

通常是环境缺失导致。检查：

1. `WebAssembly.Module.imports()` 是否所有依赖都已提供
2. 内存大小是否足够（`TOTAL_MEMORY` / `initial`）
3. 是否缺少 `Math`、`Date` 等宿主对象
4. Emscripten 是否需要 `ENV`、`PATH`、`FS` 等运行时
5. **wasm-bindgen 的 get-global 检测链**（match20 实证）：imports 全部提供仍裸 trap `RuntimeError: unreachable` 时，优先怀疑 `instanceof_Window` 桩返回了 false（浏览器语义是 true）或 `document`/`body` 桩返回 None——给每个 import 桩加一行调用日志（桩名 + 实参），看访问序列停在哪个桩之后即可锁定。诊断流程与修复清单见 `env-debug-loop.md`「WASM trap：unreachable」专节。

### 输出为空或错误

1. 检查内存写入位置和偏移
2. 检查字节序（little-endian）
3. 检查字符串编码（UTF-8 vs UTF-16）
4. 检查是否需要 null terminator

### Worker 中的 WASM

如果目标 JS 在 Worker 中加载 WASM，需要补全：

- `self` 全局对象
- `postMessage` / `onmessage`
- `importScripts`
- `Worker` 构造函数（如果主线程也用）

## WASM 与补环境

WASM 加载进入补环境范围后，仍要按 `env-object-model.md` 和 `env-native-protection.md` 的要求：

- `WebAssembly` 对象本身要建立可控实现，不要盲目透传 Node 宿主 `WebAssembly`。
- `WebAssembly.Module`、`WebAssembly.Instance`、`WebAssembly.Memory`、`WebAssembly.Table` 等构造函数要按需建立原型链和 descriptor。
- 如果 WASM 访问 `navigator`、`document`、`crypto` 等环境对象，仍要按 NativeProtect 保护补齐。

最终项目中 WASM 加载代码应由 Node.js / Python 实现，不得依赖浏览器自动化。

## 进阶场景

基础加载（本文档）覆盖 I/O 验证、wasm-bindgen / Emscripten 环境补全、内存读写、调试技巧。

以下场景需要更深度的方法论：
- WASM import 依赖系统化分析（决策树 + 常见 import 函数表）
- Emscripten / wasm-bindgen 完整环境补全模板（含 ASYNCIFY / FS / PATH / GL）
- WASM memory 管理（malloc/free 分配器策略、内存增长、字符串读写边界）
- streaming 实例化（`WebAssembly.instantiateStreaming`）与 buffer 实例化的差异
- Worker 中的 WASM 加载链路（含 Service Worker fetch 拦截）
- 高级调试技巧系统化（unreachable panic 栈追踪、输出为空排查决策树、性能问题）

详见 `references/env/env-wasm-advanced.md`。
