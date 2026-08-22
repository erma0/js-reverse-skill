# captcha-verify 验证码逆向交付骨架

验证码逆向通用骨架（load → solve → verify 三段链路 + 业务接口消费凭据），Node.js 版。
与签名逆向模板（final-entry/）的区别：签名是"生成参数→请求"单段；验证码是三段链路，challenge 一次性。

本目录只提供接口骨架，不内置任何真实平台协议。厂商、版本、接口顺序、HTTP 方法、JSONP、字段名、加密和成功凭据都必须从本 case 的抓包与 RuyiTrace 证据实现到 `result/src/adapter.js`。

> **模板选择**：答案层用 ddddocr/OpenCV/Whisper（Python 生态）时，优先选 Python 版 `templates/captcha-verify-py/`（solver 直接 `import ddddocr`，免跨语言桥接）。本模板适用于封装层加密只在 Node 侧还原（vm 沙箱/JS 执行）的场景。

## 文件清单

| 文件 | 作用 |
|------|------|
| `final.js` | 唯一执行入口（带 require.main 守卫）：完整链路自验 + 可被 require 调用 |
| `config.json` | 外置配置（目标页、case 标识和 solver 配置；不预填平台接口） |
| `package.json` | 依赖契约（curl-cffi-node） |

## 使用方式

1. IMPLEMENT 编码时复制到 `result/`：
   ```
   cp templates/captcha-verify/final.js result/
   cp templates/captcha-verify/config.json result/
   cp templates/captcha-verify/adapter.example.js result/src/adapter.js
   cp templates/captcha-verify/package.json result/
   ```
2. 从 `templates/node-request/client.js` 复制 TLS 客户端到 `result/src/request/client.js`
3. 实现 `result/src/adapter.js`，至少提供：
   `loadChallenge`、`resolveAssets`、`prepareAnswer`、`buildVerifyRequest`、`parseVerifyResponse`、`consumeCredential`
4. 实现 `result/src/solver.js`（答案求解：`solve(imageBytes, type, options)`，参考 `references/captcha/captcha-solving-handoff.md`）
5. 轨迹生成或行为构造由 adapter / solver 按本 case 证据决定，不使用默认通用轨迹冒充真实协议

## 三段链路结构

```
final.js（唯一执行入口）
  ├── ① adapter.loadChallenge()    → 按本 case 证据完成 bootstrap/load 链
  │     └── result/src/request/client.js（TLS 客户端，复制自 node-request/）
  ├── ② solveCaptcha()     → 下载素材 → 本地求解 → answer JSON（含 offset/points/track/challenge_binding）
  │     ├── result/src/solver.js（ddddocr 或打码平台适配器）
  │     └── result/src/track.js（轨迹生成，slider/drag-drop/scratch/trace）
  ├── ③ adapter.buildVerifyRequest() → 按本 case 原始请求语义构造 verify 请求
  │     └── adapter.parseVerifyResponse() → 按本 case 响应格式解析凭据
  └── ④ adapter.consumeCredential() → 业务接口消费凭据
```

## answer JSON 契约

`solveCaptcha()` 返回的 answer JSON 必须符合 `references/captcha/captcha-overview.md` 的接口契约（`source_image_size` 必填，缺了会被 `check_captcha_answer.js` 判 FAIL）：
```json
{
  "captcha_type": "slider",
  "provider": "<case provider>",
  "solver": "<case solver>",
  "confidence": 0.95,
  "coordinate_space": "image-pixel",
  "source_image_size": [260, 160],
  "display_size": [260, 160],
  "offset": { "x": 87, "y": null, "angle": null },
  "points": [],
  "track": [{ "x": 0, "y": 0, "t": 0 }],
  "challenge_binding": { "gt": "", "challenge": "", "lot_number": "" }
}
```
交付前跑 `node scripts/check_captcha_answer.js --file answer.json` 校验。

## REAL_VERIFY

- 成功基线：`node scripts/check_success_baseline.js --file success_samples.json`
- 失败复盘：`node scripts/check_verification_attempts.js --file attempts.json`
- answer schema：`node scripts/check_captcha_answer.js --file answer.json`

详见 `references/captcha/verification-workflow.md`。

## 注意

- challenge 一次性：每次验证必须从 load 重新走，禁止复用旧 challenge
- 素材下载用与业务请求一致的 TLS 指纹客户端 + Session cookie（部分厂商素材 URL 绑 Session）
- 凭据形态按 case 不同，由 `adapter.parseVerifyResponse` 和 `adapter.consumeCredential` 按证据实现
- 没有 adapter 时模板必须失败，不得猜测平台协议或把示例字段当作通用字段
