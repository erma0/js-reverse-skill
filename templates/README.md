# 交付模板索引

本目录保持 7 类模板资产。它们不是 7 个互斥的交付方案：`final-entry/`、`python-request/` 和两个验证码模板提供执行入口，其余目录是按实现路径组合进交付物的请求或运行时模块。

## 模板清单

| 模板 | 角色 | 入口或模块 | 适用模式 |
|------|------|-----------|---------|
| `final-entry/` | Node.js 基础入口 | `final.js` + `config.json` + `package.json` | A/B/C/D |
| `node-request/` | Node.js 请求模块 | `client.js` | 需要 TLS 指纹或统一 Session 的 Node.js 交付 |
| `python-request/` | Python 基础入口与请求模块 | `final.py` + `client.py` + `requirements.txt` | A/B/C/D |
| `vm-sandbox/` | Node.js 运行时模块 | `install-env.js` + `vm-context.js` + `native-protect.js` | B/D |
| `wasm-loader/` | Node.js WASM 模块 | `loader.js`（干净 `.wasm` + 导出函数）；`emscripten-bundle-blackbox.js`（整包 Emscripten glue 黑盒，webpack 内嵌 wasm base64） | C |
| `captcha-verify/` | Node.js 验证码协议骨架 | `final.js` + `config.json` + `adapter.example.js` | 真实平台协议必须由 case adapter 实现 |
| `captcha-verify-py/` | Python 验证码协议骨架 | `final.py` + `config.json` + `adapter_example.py` | 答案层主要使用 ddddocr/OpenCV/Whisper |

## 实际组合

按最终语言和证据确定的实现路径选择组合，不要机械复制全部 7 类：

| 场景 | 基础模板 | 按需组合 |
|------|---------|---------|
| Node.js 纯算法 | `final-entry/` | 有 TLS 指纹或 Session 要求时加入 `node-request/` |
| Node.js vm 补环境 | `final-entry/` | `vm-sandbox/`；需要真实请求适配时再加入 `node-request/` |
| Node.js WASM | `final-entry/` | `wasm-loader/`；WASM 外层依赖浏览器环境时再加入 `vm-sandbox/`；目标是 webpack 内嵌 wasm + Emscripten glue 时用 `wasm-loader/emscripten-bundle-blackbox.js` 整包黑盒 |
| Python 纯算法或协议请求 | `python-request/` | 标准算法直接在 Python signer 中实现 |
| Python 调用原始 JavaScript | `python-request/` | 仅在证据要求时通过 JS 运行时桥接所需模块，不复制 Node.js 入口 |
| 验证码 Node.js | `captcha-verify/` | 封装层需要 vm 时加入 `vm-sandbox/`；请求层需要 TLS 适配时复用 `node-request/` |
| 验证码 Python | `captcha-verify-py/` | solver 直接使用 Python 答案层库；只有封装层必须执行原始 JS 时才桥接 Node.js 模块 |

`final-entry/` 和 `python-request/` 已分别承担常规 Node.js、Python 交付入口；`captcha-verify/` 与 `captcha-verify-py/` 只承担 provider-neutral 验证码三段链骨架。真实平台协议放在 case adapter，一个交付物只保留一个最终执行入口。

## 入口成功语义与请求层约定

- 所有执行入口统一：HTTP 200 ≠ 成功。`final-entry/final.js` 与 `python-request/final.py` 的自验必须配置 `config.json` 的 `responseValidation`（`jsonPath` / `minLength` / `contains`，从本 case 真实成功样本提取）；未配置时 200 响应记「未判定」并以退出码 3 结束，不能宣称通过（退出码：0=全部通过、1=入口异常、2=存在失败、3=存在未判定）。
- 请求层（`node-request/client.js` 与 `python-request/client.py`）的 `CookieJar` 解析 Set-Cookie 属性（Domain / Path / Max-Age / Expires），支持过期删除语义；`session.request` 额外接受 `{ method, url, opts }` 原始请求描述符（可直接透传 trace 导出或 adapter 契约返回的请求描述）；传入 `jar`（或 `session.defaults({ jar })`）时自动携带 Cookie、响应后自动合并 Set-Cookie，显式 Cookie 头优先。

## 组合结构

典型 Node.js 组合：

```text
result/
├── final.js
├── config.json
├── package.json
└── src/
    ├── signer.js
    ├── env/
    │   ├── install-env.js
    │   └── native-protect.js
    ├── request/
    │   └── client.js
    └── wasm/
        └── loader.js
```

其中 `src/env/`、`src/request/`、`src/wasm/` 都是按需项。`final.js` 带 `require.main` 守卫，被其他项目 `require` 时只导出 API，不自动执行或发请求。

Python 交付以 `final.py` 为唯一入口，按需引用模板的 `client.py`；signer 逻辑按站点实现，交付时自建 `src/signer.py`（参考上方 Node.js 组合结构的 result/ 目录约定）。验证码模板已经包含 load→solve→verify 三段链骨架和一次性 challenge 约束，不再叠加常规入口模板。

## 使用方式

1. 根据实现语言和解法模式确定唯一入口模板。
2. 只复制实际需要的请求、vm 或 WASM 模块到 `result/` 的对应 `src/` 目录。
3. 按站点逻辑实现 signer、环境安装和请求链，不从案例 README 手工速查；案例检索统一使用 `cases/index.json` 与 `scripts/search_cases.js`。
4. 保持模板自带的入口守卫、配置外置和依赖契约。
5. `vm-sandbox/` 是运行时骨架，正式交付时必须按本次 trace 证据补齐必要对象语义，不扩展无关环境。
