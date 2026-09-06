# 补环境服务化：并发、内存与执行引擎选型

**读取时机**：补环境代码要从"单请求取证/验证"升级为**服务化/高吞吐批量出参**（常驻进程、并发任务、PoW 类 CPU 密集算法）；或服务运行中内存单调爬升直至 OOM。

**与现有硬约束的关系**：单请求取证与混淆 JS 行为验证仍一律走 `run_with_trace.js`（禁手写 vm runner 不变，见 SKILL.md §7/§8）。本文只管**部署形态**的引擎选型与资源治理。

经验源：yazong 博客《基于多线程的一个 Node 补环境框架（踩坑 1/2）》（2026-09 对照分析入库，含实测数据）。

## 陷阱 1：执行引擎选型——vm2 是陷阱

同一 CPU 密集型工作量证明任务（迭代哈希找满足条件的 nonce）实测：

| 引擎 | 执行时间 | RSS 增长 | Heap 增长 |
|---|---|---|---|
| Node 直跑 | 456 ms | +8 MB | +1 MB |
| 原生 `vm` | 699 ms（+53%） | +7 MB | +0 MB |
| **vm2** | **5335 ms（+1069%）** | **+86 MB** | **+42 MB** |

结论：通用补环境框架**禁用 vm2**——CPU 密集任务下慢一个数量级、内存十倍占用，高并发下先把服务拖垮。原生 `vm` 的开销可接受；无沙箱逃逸顾虑的自有代码可直接 Node 直跑。

## 陷阱 2：线程池保活 + code cache 单调累积 → OOM

**症状**：Piscina 多线程补环境框架，部分任务跑着跑着 worker 内存单调爬升，最终 OOM；任务本身无泄漏。

**根因（V8 机制，非 bug）**：

- **isolate = 内存回收边界**：每个 worker_threads / Piscina worker 是独立 isolate（独立堆 + 独立 GC）；isolate 销毁（线程终止）时其内对象、编译产物、code cache 全部随 OS 回收。
- **builtin 按 context 独立**：`vm.createContext()` 每次注入一套独立内建（Object/Array/Math…），context 销毁即回收。
- **code cache 是 isolate 级**：V8 编译产物缓存在 isolate 级、**不随 context 回收**——同一段代码只编译一次，后续 `new vm.Script` 命中缓存。
- **累积条件**：每个任务编译的代码**互不相同**（如含时间戳/随机种的动态生成代码）→ V8 为每个版本各存一份且不回收；Piscina 默认复用 worker（`idleTimeout: 30000` + `minThreads ≥ 1` 保活）→ cache 在被复用的线程内**单调累积**。每任务代码相同则命中缓存、不累积。

**修复**：

```js
new Piscina({
  idleTimeout: 1,   // 任务完成后立即回收线程
  minThreads: 0,    // 不保活；用"杀线程"换 isolate 级内存回收
});
```

或让同版本任务复用同一份代码（命中 code cache）；两者取一，按任务代码是否动态生成决定。

## CPU 密集任务自我保护

工作量证明式 sign（迭代哈希找 nonce）必须内置双保险，防止单任务打满 CPU 拖垮服务：

```js
const MAX_ITERATIONS = 50000, MAX_TIME = 8000, t0 = Date.now();
do {
  if (matches(candidate)) return candidate;
  if (candidate % 1000 === 0) {
    if (candidate > MAX_ITERATIONS || Date.now() - t0 > MAX_TIME) break;
    await new Promise(r => setTimeout(r, 0)); // 让出事件循环
  }
} while (++candidate <= Number.MAX_VALUE);
```

配合上层：任务级超时 + 并发上限 + 失败快返回（返回空结果让调用方走降级，不重试打爆）。

## 选型速查

| 场景 | 方案 |
|---|---|
| 单请求取证 / 混淆 JS 行为验证 | `run_with_trace.js`（不变） |
| 服务化出参，任务代码固定 | 原生 `vm` + Piscina 保活（`minThreads ≥ 1`，同代码命中 cache 无累积） |
| 服务化出参，任务代码动态生成 | 原生 `vm` + Piscina `idleTimeout: 1, minThreads: 0` |
| CPU 密集（PoW 式）任务 | 上述任一 + MAX_ITERATIONS/MAX_TIME 双保险 + 服务级限流 |
