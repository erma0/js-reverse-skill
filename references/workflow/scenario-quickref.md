# 常见签名分析场景速查

10 个核心场景的快速定位卡。AI 在 FORENSIC_CAPTURE → TRACE_CAPTURE 识别目标特征后速查本文件。

## 场景 1：请求参数签名（sign/m/token）
- **特征**：URL/Body 含签名参数
- **定位**：搜索参数名 → 追踪赋值 → 签名函数
- **ruyiPage**：`search_code` + `inject_hook_preset("xhr")` + `get_request_initiator`

## 场景 2：动态 Cookie 生成
- **特征**：Cookie 中有频繁变化字段
- **类型**：eval 首包 / 预热请求 / 指纹 Cookie
- **ruyiPage**：`hook_function("Document.prototype.cookie", position='before')` + `inject_hook_preset("crypto")`
- **两大子型判别**：cookie 值有本地算法（RSA/MD5/指纹）→ 补环境或纯算还原；cookie 值来自**前置接口下发的 JS 文本 + `eval`** → 复现前置请求并解码脚本取值，本地无算法。先看 `case/ruyi-trace/logs/eval/` 有无落盘脚本即可分型。
- **定位路径**：`references/network/cookie-generation.md` 的「服务端下发脚本型 cookie 的最短定位路径」（eval 落盘取 builder → cookieWrites 确认 writer → capture 找 source → document.html 确认 entry）

## 场景 3：响应数据加密
- **特征**：接口返回加密字符串非明文 JSON
- **定位**：Hook JSON.parse 或解密函数入口
- **ruyiPage**：`search_code("decrypt|JSON.parse|atob")` + `inject_hook_preset("crypto")`

## 场景 4：JS 混淆/OB 混淆
- **特征**：`_0x` 前缀 / 十六进制字符串数组 / 控制流平坦化
- **还原**：走 `assets/ast-patterns/` AST 反混淆流水线

## 场景 5：WASM 加密
- **特征**：加密函数调用 WebAssembly 导出函数；或 webpack bundle 内嵌 wasm base64 + Emscripten glue（异步 glue + 内部 fetch，如 handshake 类风控 SDK）
- **路径**：确认加密在 WASM 后先整包黑盒（vm 加载原版 glue + mock 环境 + hook fetch），不先手撕字节码
- **ruyiPage**：`search_code("WebAssembly|.wasm|instantiate")` + `list_network_requests` 找 .wasm
- **详见** `references/env/env-wasm.md`、`references/env/env-wasm-advanced.md`「整包 Emscripten bundle 黑盒执行」

## 场景 6：TLS 指纹/协议检测
- **特征**：算法全对但请求失败（403/连接超时）
- **解法**：Node.js `curl-cffi-node` / Python `curl_cffi` / HTTP/2
- **详见** `references/network/tls-validation.md`

## 场景 7：反检测站点分析
- **特征**：Cloudflare/瑞数/极验等反爬检测
- **ruyiPage**（仅取证）：`launch_browser(humanize=true)` → 观察 `redirect_chain` → `inject_hook_preset("debugger_bypass")` → 采集证据后用纯协议代码还原

## 场景 8：JSVMP + 环境伪装
- **特征**：JSVMP 不可拆解，签名算法封装在字节码中，与环境指纹深度绑定
- **路径**：JS 需完整浏览器环境，路径 D 补环境
- **方法论**（路径 D 六步法）：
  1. RuyiTrace 采集 JSVMP 实际读取的属性
  2. 在 Node 环境中运行相同采集代码
  3. 逐项 diff，按影响分级修复（致命级→高危→中危）
  4. 编写 patchEnvironment() 全量修复
  5. 验证所有检测点通过
  6. 端到端验证：生成签名 → 请求接口 → 返回有效数据

## 场景 9：请求体整体加密
- **特征**：请求 Body 不是 JSON 明文，而是 AES/SM4/DES 整体加密后的 Base64/Hex 字符串；服务端解密后处理
- **与场景 1 的区别**：场景 1 是参数级签名（sign 字段），场景 9 是 Body 级加密（整个 payload 加密）
- **路径**：标准算法可提取或自定义算法需 vm 执行
- **识别信号**：
  - Content-Type 是 `application/octet-stream` 或非标准类型
  - Body 是 Base64/Hex 字符串，非 JSON 可读
  - JS 中有 `encrypt(JSON.stringify(data), key)` 模式
  - 响应也是加密字符串（与场景 3 联动）
- **方法论**：
  1. `search_code(keyword="encrypt|AES|SM4|CryptoJS")` 定位加密函数
  2. 提取密钥来源（硬编码 / 接口下发 / 指纹派生）
  3. 确认加密模式（AES-CBC/GCM/ECB + PKCS7/NoPadding）和 IV 来源
  4. 用 Node.js `crypto` 或 `crypto-js` 复现加密
  5. 请求 Body 用加密后的字符串，Content-Type 按抓包样本设置
- **常见模式**：
  ```javascript
  // AES-CBC + 固定 IV
  const encrypted = CryptoJS.AES.encrypt(
      JSON.stringify(data),
      CryptoJS.enc.Utf8.parse(KEY),
      { iv: CryptoJS.enc.Utf8.parse(IV), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  ).toString();
  // 请求 Body = encrypted（Base64 字符串）
  ```
- **国密 SM4 场景**：用 `sm-crypto` 库，注意 SM4 的 ECB/CBC 模式和 padding 差异

## 场景 10：WebSocket / SSE 消息签名
- **特征**：接口用 WebSocket 或 SSE 通信，签名在消息帧或连接 URL 中
- **路径**：消息签名算法可提取或消息签名依赖环境指纹
- **方法论**：详见 `references/network/websocket-signing.md`

---

## 相关案例

| 案例文件 | 关联点 |
|---------|--------|
| `cases/sha1-sort-params-zhitongcaijing.md` | 场景 1 实战（标准算法纯算 + 零浏览器路径） |
| `cases/jsvmp-xhr-interceptor-env-emulation.md` | 场景 8 实战（JSVMP + jsdom 环境伪装） |
| `cases/jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md` | 场景 8 双签名变体 |
| `cases/jsvmp-ruishu6-cookie-412-sdenv.md` | 场景 2 + 场景 7（瑞数 RS6 Cookie 生成 + 412 挑战） |
| `cases/yuanrenxue-match13-eval-cookie.md` | 场景 2 下发脚本子型（`eval` 首包写 cookie，服务端令牌无本地算法） |
| `cases/universal-vmp-source-instrumentation.md` | 场景 8 通用 VMP 方法论 |
