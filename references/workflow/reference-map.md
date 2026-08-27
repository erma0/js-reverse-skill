# references 路由地图

> 本文是 SKILL.md 第 12 节的完整版本。先在 SKILL.md 的高频路由里选择；仍无法确定时再读本文件。按当前状态和阻塞点取最小集合，读完一个仍无法推进再追加。

## 按场景首选

| 当前需要 | 首选 reference |
|---|---|
| 任务分流、阶段安排、常见坑、经验法则、场景速查、信息收集 | `references/workflow/decision-tree.md`、`phase-flow.md`、`scenario-quickref.md`、`common-pitfalls.md`、`experience-rules.md`、`references/quality/intake-template.md` |
| 案例搜索与版本复用、SDK 升级适配 | `cases/index.json`、`scripts/search_cases.js`，命中后才读对应 case；`references/workflow/version-adaptation.md` |
| 加密入口和算法识别 | `references/crypto/crypto-entry.md`、`crypto-patterns.md`、`algorithm-families.md`；密文特征入口 `scripts/identify_crypto.js`，Cookie 生成方归因 `scripts/analyze_cookie_attribution.js` |
| 混淆与 AST | `references/deobfuscation/obfuscation-identify.md`、`assets/ast-patterns/` |
| 字体映射/CSS 渲染层反爬（woff/woff2、PUA 码点） | `references/rendering/font-anti-crawl.md` |
| 图片型内容反爬（base64/像素判定、雪碧图数字拼装、DOM ground truth 验证） | `references/rendering/image-content-reversal.md` |
| 浏览器环境、对象模型、真实性保护与 native 缺口 | `references/env/env-object-model.md`、`env-debug-loop.md`、`env-detect-bypass.md`、`env-native-protection.md`、`native-capability-gap.md`、`object-shape-private-state.md`、`runtime-frameworks.md`、`webapi-env-detection-matrix.md` |
| iframe、Worker 或移动 H5 | `references/env/env-iframe.md`、`mobile-h5-env.md`、`references/workflow/worker-signing.md` |
| WASM | `references/env/env-wasm.md`，遇到 import、memory、streaming 或整包 Emscripten/webpack bundle 黑盒执行再读 `env-wasm-advanced.md`，harness 用 `templates/wasm-loader/emscripten-bundle-blackbox.js` |
| TLS、Cookie、Session、动态资源、协议分析、WebSocket | `references/network/tls-validation.md`、`session-chain.md`、`cookie-generation.md`、`dynamic-resource.md`、`protocol-analysis.md`、`websocket-signing.md` |
| XHR/fetch 语义或会话桥接 | `references/network/xhr-fetch-semantics-audit.md`、`xhr-fetch-session-bridge.md` |
| IP 风控与静默失败诊断 | `references/network/ip-risk-control.md`（含签名内容层/连接层分层定位矩阵）、`node-leakage.md` |
| 真实验证 403 / 签名内嵌环境检测对齐 | `references/env/env-debug-loop.md`「真实验证 403」节、`env-detect-bypass.md`「对齐探针法」；门禁 `node scripts/check_risk_layer_diagnosis.js` |
| 指纹一致性和信任判断 | `references/fingerprint/fingerprint-baseline-consistency.md`、`trust-matrix.md`、`fingerprint-value-replay.md` |
| 高强度检测排查与 trace 一致性 | `references/quality/high-strength-detection.md`、`trace-api-coverage.md`、`trace-runtime-conformance.md` |
| 反调试对抗与 Hook 模板 | `references/hooks/anti-debug.md`、`hook-templates.md` |
| 验证码 | 先读 `references/captcha/captcha-overview.md`，再按厂商、题型、轨迹或验证失败路由到具体文档 |
| 交付、验证、清理与代码规范 | `references/quality/delivery-templates.md`、`validation.md`、`cleanup.md`、`final-summary.md`、`code-style.md`、`code-change-memory.md`、`stage-reports.md`、`trusted-input.md` |
| 调试、取证流程与工具获取 | `references/debug/debug-playbook.md`、`references/workflow/trace-flow.md`、`references/tooling/ruyi-tooling.md`、`browser-acquisition.md` |

## 完整目录索引

### captcha

- `references/captcha/captcha-overview.md`
- `references/captcha/captcha-providers.md`
- `references/captcha/provider-products.md`
- `references/captcha/provider-execution-notes.md`
- `references/captcha/captcha-types.md`
- `references/captcha/captcha-request-chain.md`
- `references/captcha/captcha-solving-handoff.md`
- `references/captcha/captcha-motion-encryption.md`
- `references/captcha/gap-coordinate-source.md`
- `references/captcha/solution-playbooks.md`
- `references/captcha/open-source-recipes.md`
- `references/captcha/solver-platform-recipes.md`
- `references/captcha/verification-workflow.md`

### crypto

- `references/crypto/crypto-entry.md`
- `references/crypto/crypto-patterns.md`
- `references/crypto/algorithm-families.md`

### debug

- `references/debug/debug-playbook.md`

### deobfuscation

- `references/deobfuscation/obfuscation-identify.md`

### env

- `references/env/env-object-model.md`
- `references/env/env-debug-loop.md`
- `references/env/env-detect-bypass.md`
- `references/env/env-native-protection.md`
- `references/env/env-iframe.md`
- `references/env/env-wasm.md`
- `references/env/env-wasm-advanced.md`
- `references/env/mobile-h5-env.md`
- `references/env/native-capability-gap.md`
- `references/env/object-shape-private-state.md`
- `references/env/runtime-frameworks.md`
- `references/env/webapi-env-detection-matrix.md`

### fingerprint

- `references/fingerprint/fingerprint-baseline-consistency.md`
- `references/fingerprint/fingerprint-value-replay.md`
- `references/fingerprint/trust-matrix.md`

### hooks

- `references/hooks/anti-debug.md`
- `references/hooks/hook-templates.md`

### network

- `references/network/tls-validation.md`
- `references/network/session-chain.md`
- `references/network/cookie-generation.md`
- `references/network/dynamic-resource.md`
- `references/network/protocol-analysis.md`
- `references/network/websocket-signing.md`
- `references/network/xhr-fetch-semantics-audit.md`
- `references/network/xhr-fetch-session-bridge.md`
- `references/network/ip-risk-control.md`
- `references/network/node-leakage.md`

### quality

- `references/quality/intake-template.md`
- `references/quality/validation.md`
- `references/quality/delivery-templates.md`
- `references/quality/final-summary.md`
- `references/quality/cleanup.md`
- `references/quality/code-style.md`
- `references/quality/code-change-memory.md`
- `references/quality/stage-reports.md`
- `references/quality/trusted-input.md`
- `references/quality/high-strength-detection.md`
- `references/quality/trace-api-coverage.md`
- `references/quality/trace-runtime-conformance.md`

### rendering

- `references/rendering/font-anti-crawl.md`
- `references/rendering/image-content-reversal.md`

### tooling

- `references/tooling/browser-acquisition.md`
- `references/tooling/ruyi-tooling.md`
- `references/tooling/ruyitrace-cheatsheet.md`

### workflow

- `references/workflow/phase-flow.md`
- `references/workflow/decision-tree.md`
- `references/workflow/scenario-quickref.md`
- `references/workflow/common-pitfalls.md`
- `references/workflow/experience-rules.md`
- `references/workflow/trace-flow.md`
- `references/workflow/version-adaptation.md`
- `references/workflow/worker-signing.md`
