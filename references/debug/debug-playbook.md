# 错误排查指南

## 故障树总览

> **先用本决策树定位分支，再进入对应清单细查**。本 skill 有 4 份排查清单，散落在不同文档，用此树串联。

```
请求失败
  │
  ├─ HTTP 状态码非 200/2xx？
  │   ├─ 429 → 频率限制 → 退避 + 降频（见 ip-risk-control.md）
  │   ├─ 403 → 风控 challenge 或 WAF
  │   │   ├─ 有风控响应头（cf-mitigated / x-vc-bdturing）→ IP 风控（见 ip-risk-control.md）
  │   │   ├─ 有 challenge JS → 参考 web-verify-patcher
  │   │   └─ 无风控头 → 查签名/Cookie/UA（见下方"200 但异常"分支）
  │   ├─ 412 → Akamai/瑞数 sensor 失效
  │   │   └─ 查 high-strength-detection.md（10 步高强度排查顺序）
  │   └─ 5xx → 服务端错误或 IP 被封（见 ip-risk-control.md）
  │
  └─ 200 但异常？
      ├─ 空 body + 风控响应头 → IP 风控静默拒绝（见 ip-risk-control.md）
      ├─ 空 body 无风控头 → 环境指纹不对
      │   └─ 查 node-leakage.md（12 项静默失败清单）
      ├─ 业务码异常（code != 0）
      │   ├─ 含 verify/captcha 字样 → 验证码触发（参考 web-verify-patcher）
      │   └─ 其他业务码 → 查业务码含义
      ├─ 签名参数缺失/null
      │   └─ 查 node-leakage.md + 下方"签名 7 环节对比"
      └─ 签名参数存在但不一致
          └─ 查下方"签名 7 环节对比" + silent-failure-checklist.md
```

### 4 份排查清单对照

| 清单 | 文件 | 触发场景 | 内容 |
|---|---|---|---|
| 故障树总览 | `debug/debug-playbook.md`（本文件顶部） | 任何请求失败 | 决策树定位分支 |
| 请求失败 6 步 | `debug/debug-playbook.md`（下方） | 协议脚本请求异常 | Cookie/前置/时间戳/Header/环境/频率 |
| 签名 7 环节对比 | `debug/debug-playbook.md`（下方） | 签名值不一致 | 输入/排序/时间戳/随机串/密钥/中间摘要/输出 |
| 高强度 10 步 | `quality/high-strength-detection.md` | Cloudflare/Akamai/DataDome/Kasada | 高强度检测场景的排查顺序 |
| 静默失败 12 项 | `network/node-leakage.md` | 200 但空 body / 结果不一致 | Node 泄露 + 静默失败清单 |
| silent-failure-checklist | `case/notes/silent-failure-checklist.md`（由 `scripts/init_env_case.js` 自动生成；case/ 指 per-project 工作目录，非 skill 根目录的 cases/） | 签名通过服务端不认 | 12 项 + 项目特定排查 |

**查阅顺序建议**：先看本文件顶部故障树定位 → 按分支进入对应清单 → 多份清单可并行查（内容互补不冲突）。

---

## 请求失败排查流程

### 排查顺序（必须按序执行）

当协议脚本请求返回非预期结果时，**禁止盲目大改**，按以下 6 步逐项排查：

```
步骤 ① Cookie/Session 失效
  │
  ├─ 排查方法：
  │   · 浏览器 F12 → Application → Cookies 获取最新 Cookie
  │   · 对比脚本使用的 Cookie 与浏览器当前 Cookie
  │   · 检查是否有 HttpOnly Cookie 漏掉（Network 面板看完整 Cookie）
  │
  ├─ ruyiPage 辅助：
  │   · get_cookies → 获取浏览器中的 Cookie
  │   · evaluate_js(expression="document.cookie") → 获取 JS 可见 Cookie
  │
  └─ 常见原因：Cookie 过期、登录态失效、缺少 HttpOnly Cookie

步骤 ② 前置请求遗漏
  │
  ├─ 排查方法：
  │   · Network 面板查看主请求之前的所有请求
  │   · 重点关注：/api/init、/token、/config 等路径
  │   · 检查前置请求的响应中是否有 Token、Session ID
  │
  ├─ ruyiPage 辅助：
  │   · start_network_capture → 触发操作 → list_network_requests
  │   · 按时间排序，找到主请求之前的接口
  │
  └─ 常见原因：漏掉预热接口、Token 获取接口、验证码初始化接口

步骤 ③ 时间戳绑定
  │
  ├─ 排查方法：
  │   · 对比浏览器请求的时间戳与脚本生成的时间戳
  │   · 检查精度：秒（10位）vs 毫秒（13位）
  │   · 检查是否有时间窗口限制（如签名有效期 30 秒）
  │
  ├─ 常见坑：
  │   · Python time.time() 返回浮点数，需要 int()
  │   · Node.js Date.now() 返回毫秒
  │   · 服务端可能校验请求时间与服务器时间的差值
  │
  └─ 修复方法：确保签名计算和请求发送使用同一个时间戳值

步骤 ④ Header 缺失或错误
  │
  ├─ 排查方法：
  │   · 逐项对比浏览器 Request Headers 与脚本 Headers
  │   · 重点检查：Content-Type、Referer、Origin、Accept
  │   · 检查自定义 Header（X-开头的、大小写敏感的）
  │
  ├─ 常见坑：
  │   · Header 顺序可能影响（极少数站点）
  │   · sec-ch-ua 等 Client Hints Header
  │   · Accept-Encoding 不支持 br 但发了 br
  │
  └─ 修复方法：完整复制浏览器 Headers，逐个删减确认必要项

步骤 ⑤ 环境校验
  │
  ├─ 排查方法：
  │   · Hook navigator/screen/canvas 等环境 API
  │   · 检查签名计算是否包含环境指纹
  │   · 对比有无环境值时的请求结果
  │
  ├─ ruyiPage 辅助：
  │   · get_fingerprint_info → 查看浏览器指纹
  │   · search_code(keyword="navigator|screen|canvas") → 搜索环境检测代码
  │
  └─ 关键原则：先验证是否真正参与服务端校验，再决定是否补全

步骤 ⑥ 频率限制
  │
  ├─ 排查方法：
  │   · 降低请求频率重试（间隔 3-5 秒）
  │   · 检查响应中的限流相关字段（rate limit、retry-after）
  │   · 检查是否返回了 429 状态码
  │
  └─ 修复方法：增加请求间隔、使用代理 IP、添加随机延迟
```

---

## 签名值不一致排查

### 逐步对比法

当计算出的签名值与浏览器实际值不匹配时：

```
对比链路（脚本值 vs 浏览器值）：

环节 1：原始输入参数
  ├─ 参数名是否完全一致（大小写、下划线）
  ├─ 参数值是否完全一致
  └─ 是否有隐藏参数（空值但参与签名的参数）

环节 2：参数排序与拼接
  ├─ 参数排序规则（字典序、自定义顺序、原始顺序）
  ├─ 拼接分隔符（& / 空 / 其他）
  ├─ 是否包含 key=value 中的 key 名称
  ├─ 空值参数是否参与拼接
  └─ URL 编码是否在拼接前/后执行

环节 3：时间戳
  ├─ 精度：秒 (10位) vs 毫秒 (13位)
  ├─ 类型：字符串 vs 数字
  └─ 时区：UTC vs 本地时间

环节 4：随机串
  ├─ 长度是否匹配
  ├─ 字符集：hex / alphanumeric / 自定义
  ├─ 生成方法：Math.random vs crypto.randomBytes
  └─ 客户端随机源是否被魔改为确定性（快速判定：同一明文调用两次加密函数，
     密文相同 ⇒ 确定性加密/PRNG 被魔改）。注意：确定性存在 ≠ 服务端校验
     随机段——标准库密文被拒时先与成功样本逐字符 diff 自查编码细节
     （实战：误判"服务端校验 PS"实为 Python 侧编码 bug；
     详见 common-pitfalls.md 反模式 15）

环节 5：密钥/盐值
  ├─ 密钥值是否正确（注意空格、换行、编码）
  ├─ 密钥是否是硬编码还是动态获取
  └─ 是否有 IV / Salt（AES 加密场景）

环节 6：中间摘要
  ├─ 多次哈希时逐层对比中间值
  └─ 编码格式：hex(小写) vs hex(大写) vs base64

环节 7：最终输出
  ├─ 编码方式：hex / base64 / 自定义
  ├─ 大小写：hex 小写 vs 大写
  └─ 是否有额外处理（截断、拼接前缀等）
```

### 快速定位技巧

```
技巧 1：二分法
  如果有中间值可对比，先对比中间值，
  确定偏差发生在前半段还是后半段

技巧 2：固定输入法
  在浏览器和脚本中使用完全相同的：
  - 时间戳（硬编码一个固定值）
  - 随机串（硬编码一个固定值）
  - 页码（相同页码）
  然后对比签名结果，排除动态因素干扰

技巧 3：打印拼接字符串
  在签名函数的哈希/加密调用之前，
  打印完整的输入字符串，逐字符对比

技巧 4：ruyiPage 辅助对比
  - set_breakpoint_via_hook(target_function="签名函数")
  - get_breakpoint_data → 获取浏览器端的真实入参和返回值
  - 与脚本端逐项对比
```

---

## 常见错误与解决方案

### HTTP 状态码

| 状态码 | 常见原因 | 排查方向 |
|--------|---------|---------|
| 403 Forbidden | Cookie 失效 / Header 缺失 / IP 被封 / TLS 指纹 | 步骤 ①④⑤⑥ |
| 412 Precondition Failed | 签名校验失败 / 缺少前置请求 | 签名对比 + 步骤 ② |
| 429 Too Many Requests | 频率限制 | 步骤 ⑥ |
| 500 Internal Server Error | 参数格式错误 / 数据类型不匹配 | 检查请求 Body 格式 |
| 200 但数据为空 | 签名正确但参数错误 / 页码越界 / 缺权限 | 检查业务参数 |

### 加密相关

| 问题 | 可能原因 | 解决方法 |
|------|---------|---------|
| MD5 结果不一致 | 编码问题（UTF-8 vs ASCII） | 确认输入字符串的编码方式 |
| AES 解密失败 | 模式错误（CBC vs ECB）/ Padding 错误 / IV 错误 | 逐一确认模式、Padding、IV |
| Base64 结果多余字符 | URL-safe Base64 vs 标准 Base64 | 检查是否需要 `+/` → `-_` 替换 |
| HMAC 结果不一致 | 密钥编码问题 / 算法类型错误 | 确认密钥是字符串还是 hex bytes |
| RSA 加密失败 | 公钥格式错误 / PKCS1 vs OAEP | 检查公钥格式和填充方案 |

### 环境相关

| 问题 | 可能原因 | 解决方法 |
|------|---------|---------|
| Node.js vm 沙箱报错 | 缺少 DOM API（document/window） | 参考 `references/env/env-object-model.md` 补环境 |
| Python execjs 报错 | Node.js 未安装 / JS 代码有语法错误 | 检查 Node.js 环境、验证 JS 代码 |
| WASM 加载失败 | 缺少 imports / 内存不足 | 检查 WASM imports 并补全 |
| Cookie 设置不生效 | domain 不匹配 / path 不匹配 | 确认 Cookie 的 domain 和 path |

---

## Python 特有问题

| 问题 | 原因 | 解决方法 |
|------|------|---------|
| `requests` 请求被拒 | TLS 指纹被识别 | 换用 `curl_cffi`（支持浏览器指纹模拟） |
| `hashlib.md5()` 报错 | Python 3.9+ FIPS 模式限制 | 使用 `hashlib.md5(usedforsecurity=False)` |
| `execjs` 执行慢 | 每次创建新的 JS 运行时 | 编译后复用 context：`ctx = execjs.compile(js_code)` |
| `pycryptodome` 与 `pycrypto` 冲突 | 同时安装了两个库 | `pip uninstall pycrypto && pip install pycryptodome` |
| 中文编码问题 | 签名包含中文字符 | 使用 `urllib.parse.quote()` 或确认 UTF-8 编码 |
| `httpx` HTTP/2 连接失败 | 缺少 h2 依赖 | `pip install httpx[http2]` |

---

## Node.js 特有问题

| 问题 | 原因 | 解决方法 |
|------|------|---------|
| `crypto` 模块不可用 | 使用了浏览器打包版本 | 确认运行环境是 Node.js 而非浏览器 |
| `vm` 沙箱超时 | JS 代码有死循环 | 设置 `timeout` 选项 |
| `axios` 被 WAF 拦截 | 默认 User-Agent | 自定义完整浏览器 UA |
| HTTP/2 请求失败 | 证书验证失败 | `rejectUnauthorized: false`（调试用） |

---

## 排查工具速查

### ruyiPage 浏览器工具

| 排查场景 | ruyiPage 工具 | 用法 |
|---------|---------|------|
| 对比请求差异 | `start_network_capture` + `get_network_request` | 在浏览器中捕获真实请求，与脚本请求对比 |
| 获取真实签名值 | `set_breakpoint_via_hook` + `get_breakpoint_data` | 在签名函数设伪断点，捕获真实入参和返回值 |
| 验证环境检测 | `get_fingerprint_info` + `check_detection` | 确认哪些环境项参与校验 |
| 追踪调用链 | `get_request_initiator` | 从请求直接定位到签名函数 |
| 实时对比 | `evaluate_js` | 在浏览器中执行还原后的签名函数，与脚本输出对比 |
| Cookie 归因 | `analyze_cookie_sources` | 辨识 Cookie 是 HTTP Set-Cookie 还是 JS document.cookie 写的 |
| 源码级插桩 | `instrument_jsvmp_source` + `get_instrumentation_log` | 对 VMP 做 HTTP 层源码改写，hot_keys 暴露环境指纹集 |
| 首屏挑战 | `navigate(pre_inject_hooks=[...])` | RS/Akamai 412 挑战页 hook 预注入 |
| hook 重载 | `reload_with_hooks` | 重载使 persistent hook 先于页面 JS 执行 + 清日志 |
| 运行时探针 | `get_runtime_probe_log` | 快速摸底页面在读什么 / 调什么（低开销） |
| trace 属性访问 | `trace_property_access` | 追踪目标对象属性访问路径 |

### ruyiPage + RuyiTrace 工具

| 排查场景 | 工具 | 用法 |
|---------|---------|------|
| 自动捕获 Trace 日志 | `capture_ruyitrace_log.js` | 自动启动 RuyiTrace 采集 NDJSON |
| 导入 Trace 日志 | `import_ruyitrace_log.js` | 导入 NDJSON 并生成摘要 |
| 分析环境依赖 | `analyze_trace.js` | 从 trace 输出模块优先级 |
| 缺失环境追踪 | `run_with_trace.js` | 在 Node.js vm 中运行目标 JS，输出 trace 和 missing-env |
| fixture 对比 | `compare_fixture.js` | 对比浏览器期望值和 Node.js 实际值 |

### 通用排查脚本

| 排查场景 | 脚本 | 用法 |
|---------|---------|------|
| 外部工具检测 | `check_external_tools.js` | 检测 ruyiPage / RuyiTrace 可用性 |
| TLS 客户端检测 | `check_tls_clients.js` | 检测 CycleTLS / impers / curl_cffi 等可用性 |
| Node 泄露检查 | `check_node_leakage.js` | 检测宿主 Node 能力泄露 |
| 纯计算预检 | `precheck_runtime.js` | 六类纯计算能力检查 |
| 代码质量 | `check_code_quality.js` | 检查代码可读性、中文注释、模块拆分 |
| 指纹真实性 | `check_fingerprint_fixture.js` | 检查指纹 fixture 覆盖（Canvas/WebGL/Audio/DOM 几何） |
| 补环境真实性 | `check_env_realism.js` + 手动复核（属性描述符/原型链/toString 保护/document.all） | `node scripts/check_env_realism.js --case-dir <project-root> --markdown` |
| 最终产物 | `check_final_artifact.js` | 检查最终交付结构、入口唯一性、无自动化代码 |
| 清理 | `clean_case.js` | 清理临时文件、缓存、中间产物 |

---

## 高强度检测失败排查顺序

遇到最终请求失败、参数不一致、403 / 429 / 风控页、静默失败时，按以下顺序排查，不要直接反复改补环境代码：

1. 是否拿到 challenge / 风控页而非业务页。
2. 是否缺少入口 HTML、前置 JS、检测脚本或前置接口请求。
3. Cookie / Storage / device token / challenge 状态是否过期、缺失或不属于同一 session。
4. UA、UA-CH、Accept-Language、timezone、locale、screen、WebGL、Canvas、代理 / IP 是否与取证 baseline 一致。
5. TLS JA3/JA4、HTTP/2、Header 顺序、Sec-Fetch、Referer、Origin 是否与浏览器取证链一致。
6. fingerprint fixture 是否混用 baseline，trace 中长字段是否被截断。
7. Canvas / WebGL / WebGPU / Audio / Speech / Fonts / DOM geometry / Permissions / Plugins / MimeTypes 是否缺失真实样本或被随机化。
8. 取证阶段是否暴露 webdriver / CDP / headless / isTrusted 风险。
9. 请求顺序、请求间隔、Cookie jar 回写、动态资源刷新是否完整。
10. 以上排除后，再判断目标 JS 补环境对象、入口、writer 或 signer 逻辑是否缺失。

排查结论写入阶段报告、代码变更记忆和最终总结。
