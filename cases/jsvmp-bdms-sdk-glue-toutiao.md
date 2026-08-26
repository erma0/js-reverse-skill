# Case：sdk-glue + bdms 黑盒执行 + _SdkGlueInit 调度截获 a_bogus（头条 PC）

> 难度：★★★★
> 还原方案：D 环境伪装（vm 沙箱 + _SdkGlueInit 完整调度 + XHR 触发截获）
> 实现语言：Node.js
> 最后验证日期：2026-08-15
> 平台类型：今日头条（toutiao.com）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

### JS 特征
- [x] 三层 SDK 联动：`sdk-glue.js`（99KB）→ `bdms.js`（254KB）→ `acrawler.js`（71KB），**无独立 webmssdk.js**（与抖音三件套不同）
- [x] `bdms.js` 是 webpack + JSVMP（`_$jsvmprt` 解释器 + `HNOJ@?RC` 魔数），a_bogus 在字节码内生成
- [x] `sdk-glue.js` 导出 `window._SdkGlueInit`，是 bdms/acrawler/csrf/verifyCenter 的真正调度者；单独调 `bdms.init()` 不安装 URLSearchParams hook
- [x] a_bogus 在 XHR send 时由 bdms hook 的 `URLSearchParams.append("a_bogus", 值)` 自动追加（先 `has("a_bogus")` 检查）
- [x] `acrawler.js` 的 `sign({url})` 返回 47 字符老版 `_signature`，**不是 a_bogus**，feed 接口不使用

### 参数特征
- [x] `a_bogus`：144~152 字符，Base64 变体编码，含时间因子每次不同
- [x] `msToken`：来自 `POST mssdk.bytedance.com/web/common?ms_appid=24`，返回 protobuf 二进制；**匿名场景服务端非强校验**（省略/任意值均 200+success）
- [x] 签名触发：XHR open+send 带 query 的 URL → bdms hook 检查 URLSearchParams → 生成并追加 a_bogus

### 请求特征
- [x] mssdk.bytedance.com 请求获取 msToken（SDK 发起，需真发或可省略）
- [x] feed 接口匿名即可请求，无需登录/验证码
- [x] 真实 API 验证：HTTP 200 + `{"has_more":true,"message":"success","data":[...]}`

### 反调试特征
- [x] JSVMP 字节码（`bdms.init` 走到签名核心时环境检测不通过会崩）
- [x] bdms 槽位访问环境（槽位 15~27 映射 localStorage/XHR/URL/navigator/RAF/document/performance/Request/location/setTimeout/setInterval）
- [x] XHR 形状敏感：加载时 XHR 必须极简（open/send/setRequestHeader），复杂实现导致加载崩（`_u` undefined）
- [x] bdms 闭包捕获加载时的 XHR 引用，事后 patch `window.XMLHttpRequest` 无效

### 混淆类型
- [x] JSVMP（字节码虚拟机），本案例采用「让 SDK 原样运行 + _SdkGlueInit 调度 + XHR 截获」而非「trace 字节码」

---

## 加密方案

- **路径**：D 环境伪装（vm 沙箱 + _SdkGlueInit 完整调度 + XHR 触发截获）
- **框架**：vm（Node.js 原生 vm，非 jsdom）
- **TLS 客户端**：Node.js 原生 https（OpenSSL TLS 指纹）
- **核心思路**：构造 Firefox 151 环境（UA/navigator.plugins/document.fonts/screen 等，均取自 trace 真实值）→ 加载 acrawler+bdms+sdk-glue 三件套 → `_SdkGlueInit(config)` 初始化 → XHR 触发签名截获 a_bogus

### 算法细节

**a_bogus** 由 bdms.js JSVMP 字节码计算，算法不可直接提取。策略 = 让 SDK 原样运行 + XHR 截获输出：

1. 构造 Firefox 151 沙箱环境（trace 证实项：plugins 完整结构、document.fonts、permissions、indexedDB、buildID/oscpu 等）
2. **加载顺序固定**：acrawler.js → bdms.js → sdk-glue.js（XHR 实现必须在三者加载前就位且极简）
3. 调用 `window._SdkGlueInit(config)` 完整调度（config 含 `bdms:{aid,paths,pageId,appName}` + `mssdk:{aid,enablePathList}`）
4. 构造 XHR open+send 带 feed query 的 URL → bdms hook 检查 URLSearchParams → 生成并追加 a_bogus
5. XHR.send 内联 mssdk 真发逻辑（匿名场景可省略，msToken 非强校验）

**签名公式**：无法提取（JSVMP）。策略 = _SdkGlueInit 调度 + XHR 触发截获。

---

## 方案方向

与抖音同源案例（jsvmp-bundle-bdms-a_bogus-douyin）的区别：

| 维度 | 抖音案例 | 本案例（头条 PC） |
|------|----------|-------------------|
| SDK 三件套 | sdk-glue + bdms + **webmssdk.es5** | sdk-glue + bdms + **acrawler**（无 webmssdk） |
| a_bogus 生成器 | bdms.js | bdms.js（同源） |
| 老版签名 | —— | acrawler.sign → `_signature`（47 字符，feed 不用） |
| 调度入口 | `bdms.init` + bundle 常驻 | **`_SdkGlueInit(config)`** 完整调度 |
| XHR 时序 | patch 在 SDK 加载后（SDK 会覆盖 prototype） | XHR 形状在 SDK 加载前就位（bdms 闭包捕获） |
| 触发方式 | `signUrl(config)` 同步触发 | XHR open+send 触发 hook |
| msToken | 必须真发 mssdk 获取 | 匿名场景非强校验，可省略 |
| crash 处理 | `process.on('uncaughtException')` 兜底 | 无异步 crash（_SdkGlueInit 同步初始化） |

**关键差异**：XHR 时序表面矛盾实则两个层面——抖音说「hook patch 在加载后」（SDK 会覆盖 prototype，patch 要兜底），头条说「XHR 基础形状在加载前就位」（bdms 闭包捕获 XHR 引用）。两者不冲突：基础实现先就位，hook patch 后兜底。

---

## 标准流程

### FORENSIC_CAPTURE → TRACE_CAPTURE：定位 + SDK 提取

```
1. ruyipage 网络取证：首页加载自动触发 feed 请求，抓到 acrawler.js + bdms.js + sdk-glue.js + runtime_bundler_52.js
2. RuyiTrace 采集（70306 行，目标信号命中 86 次）
3. trace 定位请求链：
   - 业务代码 index.7b88c11c.js 调 window.byted_acrawler.sign({url, body})
   - bdms.js 在 axios URL 序列化时注入 a_bogus：URLSearchParams.has → append
   - 栈: vendor.js(axios) → bdms.js:2:224763 → bdms.js:2:225789
4. 确认 sdk-glue.js blockXhr(2:14137) 拦截 send，sdk-glue 负责调度 bdms/acrawler/csrf/verifyCenter
5. 保存 SDK 源文件到 result/src/vendor/（3 个文件）
```

### TRACE_ANALYZE：环境清单提取（trace 证据）

```
从 NDJSON 提取 bdms.js 实际读取的环境属性及返回值：
- bdms 槽位 getters: 15=localStorage, 16=XMLHttpRequest, 17=URL, 20=navigator,
  21=requestAnimationFrame, 22=document, 23=performance, 24=Request, 25=location,
  26=setTimeout, 27=setInterval
- 环境读取 TOP: document.fonts(62次)/navigator.permissions(42)/navigator.plugins(28)/indexedDB/pageYOffset
- 指纹调用: FontFaceSet.check(字体列表全 true), WebGL getParameter(3412=8等), PluginArray.item(5个)
- Firefox 专有: buildID=20181001000000, oscpu, maxTouchPoints=5
- UA: Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0
```

### IMPLEMENT：_SdkGlueInit 调度 + XHR 截获

```javascript
// signer.js 结构
// 1. 构造 Firefox 151 环境（trace 证实项，最小化，禁止过度添加）
// 2. 加载 SDK：acrawler.js → bdms.js → sdk-glue.js（XHR 极简实现加载前就位）
// 3. 调用 _SdkGlueInit({bdms:{aid,paths,pageId,appName}, mssdk:{aid,enablePathList}})
// 4. XHR 触发：open(feed_url) → send() → bdms hook 截获 a_bogus

// XHR 极简实现（形状敏感，复杂实现导致 bdms 加载崩）
class XMLHttpRequest {
  open(method, url) { this._url = url; }
  send(body) {
    // bdms hook 在此触发：检查 URLSearchParams.has("a_bogus") → append
    // 截获 this._url 中已带 a_bogus 的最终 URL
  }
  setRequestHeader(k, v) {}
}
```

### REAL_VERIFY

```
1. 连续 5 次真实 API 请求，HTTP 200 + message:success + 真实文章数据
2. 签名动态性：同 URL 两次 a_bogus 不同（含时间因子）
3. msToken 三场景：无/假/真 全部成功（a_bogus 是核心签名，msToken 非强校验）
4. 平均响应 832ms
```

---

## 🚫 禁动清单（实战踩过的"不要碰"）

| # | 禁动 | 原因 |
|---|------|------|
| 1 | 不要单独调 `bdms.init()` 期望生成 a_bogus | bdms 单独 init 不安装 URLSearchParams hook，必须走 `_SdkGlueInit` 完整调度 |
| 2 | 不要在 SDK 加载后 patch `window.XMLHttpRequest` | bdms 闭包捕获加载时的 XHR 引用，事后 patch 无效；XHR 形状必须在加载前就位 |
| 3 | 不要用复杂 XHR 实现（含完整状态机/事件） | bdms 加载时形状敏感，复杂实现导致 `_u` undefined 崩溃；保持 open/send/setRequestHeader 极简 |
| 4 | 不要环境大而全（一次性补完整 Firefox 环境） | 环境过度设计反而破坏 JSVMP 加载（undefined is not a function）；只补 trace 证实的项 |
| 5 | 不要测 `acrawler.sign()` 当 a_bogus | acrawler.sign 返回 47 字符老版 `_signature`，feed 接口的 a_bogus 由 bdms 生成 |
| 6 | 不要纠结 msToken 的 protobuf 解析 | 匿名场景 msToken 非强校验，省略/任意值均通过；登录态接口才可能强制 |

## 踩坑记录

| # | 坑 | 现象 | 解决方法 |
|---|---|------|---------|
| 1 | 只调 bdms.init 不装 hook | URL 无 a_bogus | 走 `_SdkGlueInit({bdms:{aid,paths}, mssdk:{aid,enablePathList}})` 完整调度 |
| 2 | SDK 加载前 patch XHR | bdms 加载崩 | 加载前保持极简 XHR；mssdk 真发逻辑内联在极简 XHR.send 里 |
| 3 | 环境过度设计（env 大而全） | bdms 加载反而失败（undefined is not a function） | 环境最小化，只补 trace 证实的项 |
| 4 | 缺 XMLHttpRequest/requestAnimationFrame 顶层引用 | bdms 加载崩 | sandbox 必须暴露 XMLHttpRequest + requestAnimationFrame（bdms 槽位 16/21） |
| 5 | Proxy 拦截不到 SDK 闭包环境 | 环境调试无效 | SDK JSVMP 通过闭包槽位访问环境，Proxy 只能拦 window 级访问 |
| 6 | msToken 以为必须真实 | mssdk 返回 protobuf 解析麻烦 | 匿名场景 msToken 非强校验，可省略/任意值 |
| 7 | process.exit 提前杀异步请求 | 真实验证无输出 | 请求回调内再退出 |
| 8 | 在 acrawler.init/bdms.init 间反复横跳 | 十几步空转 | 直接走 _SdkGlueInit 调度（命中案例 index.json 的 `_SdkGlueInit` 信号词即线索） |

## 边界判断

```
a_bogus 由哪个 SDK 生成？
  ├─ trace 定位到 URLSearchParams.append("a_bogus") 的栈 → bdms.js
  └─ acrawler.sign() 返回 _signature（47 字符）→ 老版签名，非目标

bdms.init 不装 hook 怎么办？
  ├─ 查 sdk-glue.js 导出 _SdkGlueInit（trace 的 blockXhr 栈指向 sdk-glue:2:14137）
  └─ _SdkGlueInit(config) 是 bdms/acrawler/csrf/verifyCenter 的真正调度者

XHR patch 无效？
  ├─ bdms 闭包捕获加载时的 XHR 引用
  └─ XHR 形状必须在 SDK 加载前就位（与抖音「patch 在加载后」不冲突：基础实现先就位，hook patch 后兜底）
```

## 可验证事实清单（经验资产）

1. 头条 PC 三件套：acrawler.js(71KB) + bdms.js(254KB) + sdk-glue.js(99KB)，无 webmssdk.js
2. a_bogus 由 bdms.js JSVMP 生成，144~152 字符 Base64 变体，含时间因子每次不同
3. acrawler.sign({url}) 返回 47 字符老版 `_signature`，feed 接口不使用
4. a_bogus 追加发生在 XHR send 时（bdms hook URLSearchParams），不是 new URL().toString()
5. 必须走 `_SdkGlueInit({bdms:{aid,paths,pageId,appName}, mssdk:{aid,enablePathList}})` 完整调度
6. _SdkGlueInit config 结构 = `{self:{pageId,aid}, bdms:{aid,paths,pageId,appName}, mssdk:{aid,enablePathList}}`
7. bdms 闭包捕获加载时的 XHR，XHR 形状必须在 SDK 加载前就位且极简
8. bdms 槽位 15~27 映射：localStorage/XHR/URL/navigator/RAF/document/performance/Request/location/setTimeout/setInterval
9. 环境最小化：只补 trace 证实项（plugins 完整结构/document.fonts/permissions/indexedDB/buildID/oscpu 等）
10. msToken 匿名场景非强校验（无/假/真三场景均 200+success），登录态接口可能强制
11. msToken 协议：`POST mssdk.bytedance.com/web/common?ms_appid=24`（protobuf，非 JSON）
12. ≥5 次真实请求稳定通过，平均 832ms

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `cases/jsvmp-bundle-bdms-a_bogus-douyin.md` | 字节系同源案例，bdms 生成 a_bogus，XHR 时序差异对比 |
| `cases/jsvmp-xhr-interceptor-env-emulation.md` | 字节系 jsdom 方案对比 |
| `references/workflow/trace-flow.md` | 标准两步取证流程 |
| `references/env/env-debug-loop.md` | RuyiTrace 优先诊断门禁（本案例教训：补环境前必须先看 trace） |
| `references/workflow/common-pitfalls.md` | 反模式 20（环境补丁没让 SDK 激活不等于方案不可行） |
