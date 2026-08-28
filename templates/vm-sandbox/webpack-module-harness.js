'use strict';

// webpack 打包 bundle 的模块黑盒执行 harness（路径 B）
//
// 适用：签名逻辑集中在 webpack bundle 的少数几个模块里，无需整体补环境。
// 用法：把切片出的模块源码（字符串）逐个传给 loadModule，共享同一个 window 对象，
//      执行完从 window 上取目标函数（如 window.md5 / window.btoa）即可签名。
//
// 模块切片定界见规则 26：正则扫 `\d+:function(...){` 起点按偏移排序，
// 模块体边界 = 下一模块起点 - 2（去掉尾部 `},`），追加 0~5 个 `}` 逐个 `node --check`。
//
// require 桩是分支漂移的防线（反模式 26）：webpack 模块的第三个参数 `n`
// 就是 __webpack_require__，浏览器里 `n.g === globalThis` 走 try 分支；
// 抠代码裸跑时 n 缺失 → ReferenceError → 静默落进 catch 分支，
// 产出"长度格式全对但服务端全拒"的签名，极易误归因会话/TLS/频率。

function createWebpackRequireStub() {
  const stub = function webpackRequire() { return {}; };
  stub.g = globalThis;
  return stub;
}

// 逐个执行模块并共享同一 window：各模块有自己的 var e,t,n，
// 塞进同一作用域会互相覆盖——必须逐个执行以复刻 webpack 的模块作用域语义。
function loadModule(src, sharedWindow, options) {
  const opts = options || {};
  const req = opts.requireStub || createWebpackRequireStub();
  try {
    new Function('window', 'document', 'n', src)(sharedWindow, undefined, req);
  } catch (err) {
    // 模块尾部的反调试 .init()（setInterval + console 检测）在 Node 内必然失败，
    // 但签名函数通常在此之前已挂载，不必删代码（删了反而可能破坏模块结构）。
    // catch 命中本身就是分支漂移的最强信号，必须可见，禁止静默吞错。
    if (opts.onError) opts.onError(err);
    else console.error('[webpack-harness] 模块执行异常（签名函数已挂载则可忽略）：', err.message);
  }
  return sharedWindow;
}

module.exports = { createWebpackRequireStub, loadModule };
