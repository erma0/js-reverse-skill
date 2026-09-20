# Case：百度财经 ParisSDK 请求头 acs-token 还原 + 装饰头鉴别

> 难度：★★★★
> 还原方案：P0 最小 vm 沙箱黑盒执行真实 SDK（bdjsvmp，不反编译字节码）
> 实现语言：Node.js（纯协议，无浏览器自动化）
> 最后验证日期：2026-09-17
> 平台类型：百度财经 Web（finance.pae.baidu.com，sapi/vapi 接口族）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

### JS 特征
- [x] 百度风控 Paris SDK：`acs-2108.js`（约 45KB 单行，bdjsvmp 字节码 VM）
- [x] 重型指纹 SDK：`abclite-2108-s.js`（acs-token 不依赖它，仅页面级指纹）
- [x] 加载入口：`ParisFactory.create({sid:'2108',...})`，暴露 `window.paris_2108`、`$BSB_2108`
- [x] token 获取：`$BSB_2108.gs(callback)` 同步回调单参数 token
- [x] 导出字符串加密：主 SDK 内不出现 `acs-token`/`getSign` 等字面量，靠应用侧 `s()`/`p()` 包装调用

### 参数特征
- [x] `acs-token`（请求头，大小写不敏感）：格式 `<固定时间戳>_<递增时间戳>_<base64 RSA 密文>`，三字段用 `_` 连接
- [x] 前缀固定为 SDK 内嵌常量（同一次加载内不变）
- [x] 每次请求新生成（每次 `gs()` 调用递增时间戳）
- [x] 密文长度随环境分支在 256/288/320 字节间变化（浏览器实测稳定 256）

### 请求特征
- [x] SDK 从 `dlswbr.baidu.com/heicha/mm/2108/acs-2108.js` 加载（URL 带 `?_=<时间戳>` 防缓存）
- [x] 通过 `req.setRequestHeader('Acs-Token', token)` 注入每个需签名请求
- [x] sapi/vapi 接口族 47+ 接口携带 Acs-Token，但**服务端校验范围不一**：部分接口纯装饰（不校验）

### 反调试特征
- [x] bdjsvmp 字节码，导出的函数名/字符串全部加密，黑盒探测优于反编译
- [x] 加载期静默无环境访问事件（依赖在首次触发时读取环境）

---

## 加密方案

- **路径**：P0 最小 vm 沙箱黑盒（D 环境伪装的轻量版，只补 SDK 实际读取的基础环境）
- **框架**：Node.js `vm.createContext` + 逐文件 `runInContext`
- **TLS 客户端**：Node.js 原生 https 直连即可（该站不校验 TLS 指纹）
- **核心思路**：
  - 加载 `acs-2108.js` 到 vm 沙箱 → `window`/`$BSB_2108` 出现后调 `$BSB_2108.gs(cb)` → 回调输出 token
  - 只需要基础环境：document.cookie / URL / UA / platform / history / screen / Date / Math.random
  - cookie 引导：先 GET 主页/bootstrap 拿 BAIDUID 等会话 cookie，再用同一会话请求带 token

### 算法细节

**token = `$BSB_2108.gs(cb)` 回调值**
- 前缀 `t1` 固定常量（SDK 内嵌），`t2` 为调用时刻时间戳，末段为 RSA-2048 单块加密密文 base64
- 环境分支影响密文长度；验收线是**参数自洽 + 服务端接受**，不逐字节对齐浏览器

---

## 踩坑记录

| # | 坑 | 现象 | 解决方法 |
|---|---|---|---|
| 1 | **装饰头误判（最重要）** | hotmetrics 用合法 token 200，篡改/无 token 也 200 | 抓包发现 47 接口带 Acs-Token 但只证明「携带」；用 probe_endpoints 四态对照（有效/垃圾/无/篡改末位）定位 hotrank / blocks/overview / marketquote 三个真校验接口（有效 200 / 篡改 403 hit risk） |
| 2 | **env-module 强制 minimal 导致 window 缺失** | 加 `--env-module` 自动切 minimal 模式，默认浏览器桩全跳过 | 显式 `--bootstrap-mode full` 重跑 |
| 3 | **vm 上下文内 new URL() 挂起** | location getter 里 new URL() 卡死，无法区分挂起与静默失败 | 根因：env-module 中引用宿主类但沙箱内该符号 undefined；修复为在 createContext 注入宿主类（run_with_trace 2.3.125 已内置 injectHostBuiltins 兜底） |
| 4 | **长样本 shell 截断误判** | python -c 传长 base64 被截断，273/256 字节误判成 RSA 格式不符 | 长 token 样本必须走 `identify_crypto.js --file` 或文件落盘，禁止 shell 内联 |
| 5 | **远端 hash 校验** | SDK 定期更新（URL 带时间戳），旧副本导致格式对但全拒 | 进实现前先 curl 远端与本地 sha256 对比 |
| 6 | **浏览器与沙箱密文长度不同** | 浏览器 256 字节，沙箱 288/320 随环境分支变化 | 以真实验证裁定（参数自洽即验收），不逐字节对齐指纹 |

---

## 可验证事实清单（经验资产）

1. 百度 Paris SDK 加载期静默，`sd(sign)` 导出字符串加密，黑盒探测优于反编译
2. `$BSB_2108.gs(cb)` 不依赖重型 abclite 指纹 SDK，只读基础环境即出 token
3. 三字段 token 格式：固定时间戳 + 递增时间戳 + RSA-2048 密文 base64
4. 请求头 `acs-token` 在大部分 sapi/vapi 接口是装饰头；**判定服务端是否真校验必须做四态对照**，不能只查「是否携带」
5. 真校验接口的典型响应：`403 {"code":403,"isCaptchaEnabled":true,"msg":"hit risk"}`
6. env-module 使 run_with_trace 自动切 minimal（有意设计），需要默认桩时显式 `--bootstrap-mode full`

---

## 适用 / 不适用场景

- 适用：finance.baidu.com / finance.pae.baidu.com 全套 Paris SDK（acs-2108 系列）站点
- 适用：任何「请求头装饰 vs 服务端真校验」存疑的多接口站（复用 probe_endpoints.js 四态对照）
- 不适用：需要 abclite 重型指纹的接口（acs-token 用不到）、App/桌面端

---

## 工具链使用经验

### ruyipage（取证）
- `forensic_ruyipage.py --targets "sapi/v1/financelsegmacro/hotmetrics"` 一次命中，SDK 完整落盘
- capture.json 记录完整（url/method/request_headers/response_status/response_headers），`search_capture.js --by-header acs-token` 直接盘点接口谱

### RuyiTrace（调试）
- `--evidence-signal acs-token` 命中 432 次写入点；NDJSON 定位 `setRequestHeader("Acs-Token", ...)` 注入位置
- 环境读取清单（UA/platform/history/screen/Date/Math.random/cookie）从 trace 抽取后写入 missing-env-priority.md，仅补这些即可

### 验证（核心方法）
- `search_capture.js --by-header acs-token`：哪些接口携带该头 + 状态码分布
- `probe_endpoints.js`：同会话 有效/垃圾/无/篡改末位 四态对照 → 「疑似校验 / 疑似装饰」启发式判定
- 调换顺序 + 篡改末位做二次对照，排除频率风控与签名内容层混淆

---

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/network/ip-risk-control.md` | 双对照协议 / hit risk 语义 / 反模式 36 装饰头 |
| `references/env/env-debug-loop.md` | missing-env-priority 门禁与补环境纪律 |
| `cases/jsvmp-baidu-waf-nox-tox-gitee.md` | 百度系 JSVMP 黑盒补环境对照 |