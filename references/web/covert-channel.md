# 浏览器隐蔽信道与数据暗度陈仓

**读取时机**：参数出现在请求里但 trace 定位不到 writer；签名/状态输入依赖页面上一次会话或其他上下文；分析 log 上报、链路追踪参数（tfstk/spm/aui 类埋点）；验证码或风控流程的数据在 iframe/worker/页面间传递；目标把数据"藏"在渲染产物里（动画终态、canvas 像素）。

经验源：yazong 博客《利用浏览器特性进行数据加密与传输的 N 种方式》《从阿里滑块 _rand 参数谈基于 CSS 动画特性的参数传递机制》（2026-09 对照分析入库）。核心认知：**参数不一定走请求体构造函数，可以先"写"进浏览器某个载体，再从载体读出拼进请求**——只盯 `Headers.set`/`xhr.send` 写入点会漏掉整条输入链。

## 1. 存储机制信道

| 载体 | 特点 | 实证形态 |
|---|---|---|
| localStorage | 永久键值 | 某淘宝系 tfstk 链路参数经 localStorage 传递 |
| sessionStorage | 会话级键值 | 同上，会话内状态 |
| cookie | 跨请求 | 某 isg、abck 依赖**上一次**写入的 cookie 值（链式生成，见 `network/cookie-generation.md`） |
| IndexedDB | 大容量结构化 | 风控 SDK 缓存设备状态 |
| Cache API | 可缓存自定义 `Response` 对象 | `caches.put('/key', new Response(data))` 存任意字符串 |

trace 信号：`localStorage.setItem`、`document.cookie` 写入、`indexedDB` put、`caches.put`。注意裸 `setItem` 属泛化 API，evidence-signal 必须带参数名/键名组合（SKILL.md §4.2 三类必然未命中）。

## 2. 跨上下文/线程信道

- `MessageChannel` + `postMessage`（iframe/Worker 间）、`BroadcastChannel`（同源页面间）、`WebSocket`（页面内建连接）。
- **5s 盾、kasada 的主通信技术**；某阿里 231 小版本加入了 postMessage 功能性检测——不只是传数据，信道本身被检测。
- 取证时 iframe/worker 上下文的事件也要看：`env-iframe.md` 的 Realm 隔离同样适用于这里的数据流。

## 3. DOM 属性信道

- `dataset`/自定义 attribute 写入后另一处读取；修改独有标签的 value/text/className。
- `img.src = "/upload_log?data=..."` 伪装成图片请求上报（某宝、某音日志上传常用）——这类"请求"在 capture.json 里是图片 URL，容易漏判为静态资源。

## 4. 文件/渲染产物隐写

- **Canvas LSB 隐写**：像素低位嵌数据（`data[i*4] = (data[i*4] & 0xFE) | bit`），兼用作 canvas 指纹对抗（对抗指纹浏览器对 `toDataURL` 的改写，如 adspower）。
- SVG path、CSS 动画、GIF 动态帧、Font 色差：原理同为"细微修改特定片段，肉眼难辨、程序可解析"。
- trace 信号：`canvas.toDataURL`、`getImageData`、`animationend`、`getComputedStyle`（须与参数名/写入点组合使用）。

## 5. CSS 动画参数传递（阿里滑块 `_rand` 实证，纯协议可还原）

机制：VM 用时间戳+随机数+token 生成一段动态 HTML/CSS——大量 `@keyframes`（只动 opacity）+ `@supports`/`@media` 条件块挑选生效规则 + 带 `data-x*` 属性的 span 链；播放动画后 `animationend` 里读每个元素的 `opacity/color/background-color/border-color` 终态，序列化进 `_rand`。**一石二鸟：既验证客户端真实执行了 CSS 动画与条件筛选链路（环境真实性检测），又隐秘传输数据。**

纯协议还原六步（无需浏览器，与真机渲染结果一致）：

1. 剥离 `<style>` 取纯 CSS；
2. 按 ENV 配置过滤 `@media`（width/height 判定，`not all`→false、未识别条件默认通过）与 `@supports`（递归 strip 括号 → not/and/or 顶层分割 → 特性查 `ENV.supports` 表；**无效特性/非标准值必须为 false**）；
3. 解析 `@keyframes` → `{name: [{offset, opacity}]}`（按 offset 排序）；
4. 解析类规则（后写入覆盖：按出现顺序 tick 记录 color/bgc/bdc/animation）；
5. 解析 `animation` 简写（duration/delay/iterations/direction/fill-mode/timing，name 取最后一个 token）；
6. 模拟终态：`fillMode` 为 `forwards/both` 时按 `finalOffsetAtEnd` 取样——`normal`→offset 1、`reverse`→0、`alternate(-reverse)` 按迭代奇偶；否则回初始 opacity 1。颜色关键字查表转 `rgb(r, g, b)`，opacity 字符串化。关键帧间**线性插值**。

## 6. 落地纪律

- 隐写信道**参与参数生成时**属于"参与参数的模块"，按 §8 证据驱动最小集合原则必须实现，不得以"环境检测代码"为由省略。
- ENV 配置（视口尺寸、supports 表）来自取证 baseline，不凭常识补全；与真机 `getComputedStyle` 采样对拍验收。
- 交付仍是纯协议：上述还原逻辑进 `result/src`，禁止为过此类检测退回浏览器自动化。
