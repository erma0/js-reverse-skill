# 最终规范项目交付

本文件只在 fixtures 多样本通过，并准备最终交付时读取。这里的"一体化"不是指整个项目只能有一个文件，而是指：**最终项目只有一个可直接执行的入口文件；执行该入口后，自动完成生成加密参数、发送 Node.js / Python 模拟请求，并输出请求成功/失败结果**。

> 适用范围：所有级别的 case 交付前必读。

## 硬性要求

1. **最终项目必须干净**
   最终交付目录（`result/`）不得包含临时文件、测试文件、trace、HAR、hook、截图、缓存、浏览器 Profile、调试日志或空目录。case 根目录不得散落调试/抓包/提取脚本（如 `test_debug.js`、`capture_network.py`、`extract_xxx.py`）。取证/调试脚本优先使用 skill 的 `scripts/` 通用脚本；临时脚本放 `case/tmp/`，用完清理。

2. **最终项目必须是规范目录结构**
   允许把补环境、目标入口、请求客户端、配置、工具函数拆成模块，避免把所有代码硬塞进一个超大文件。

3. **最终项目只能有一个执行入口**
   默认入口为 `result/final.js`（Python 为 `result/final.py`）。入口执行后必须完成：安装/加载补环境 → 调用目标 JS 入口生成加密参数 → 组装请求 → 用 Node.js / Python TLS 指纹兼容 Session 客户端发送模拟请求 → 输出验证结果 → 销毁 session。

   硬性要求：`final.js` / `final.py` 必须带 `require.main === module` / `if __name__ == "__main__"` 守卫，被其他项目 `require` / `import` 时不得自动执行、不得发请求（守卫让交付物也能被当库 `require` 取 `sign` 等函数，但不会自动跑主流程、不会发请求）。

   其他文件只能作为被入口调用的模块，不得再提供 `server.js`、`bridge.py`、`runner.js`、`sign.js`、`test.js` 等会自行执行的第二入口或测试入口。

4. **最终项目不能有自动化操作代码**
   最终项目内任何源码文件不得出现：ruyiPage / RuyiTrace 启动或控制代码、Playwright / Puppeteer / Selenium / browser-use、CDP / WebDriver / Marionette 控制代码、`page.goto`、`browser.launch`、`chromium.launch`、`FirefoxPage`、`page.capture` 等自动化取证调用。

   ruyiPage / RuyiTrace / Playwright / Puppeteer 只能用于前置取证、环境日志采集和指纹采样；不能进入最终项目代码。Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何指纹应由 Node.js 终端 API 值回放实现，不得通过自动化浏览器实时生成。

5. **最终加密参数必须由补环境生成，禁止复用样本值**
   cURL / HAR / fixture 中已有的 sign、token、a_bogus、h5st、x-s、x-t、mtgsig、w_rid 等值只能作为浏览器真实样本和 expected fixture。最终项目不得把这些值硬编码到 `final.js`、请求模块、配置文件或 signer 模块中。入口必须调用补环境后的目标 JS 入口 / signer 重新生成加密参数，再组装请求。

6. **最终请求必须由前置阶段已确认的 Node.js 或 Python Session 客户端完成（默认行为）**
   最终验证流程必须是：创建 session → 生成加密参数 → 用已确认的 TLS 指纹兼容客户端在同一 session 中组装请求 → 发起少量授权验证请求 → 销毁 session。

   可选客户端为 Node.js curl-cffi-node / impers（模板内置）/ Node.js CycleTLS（需手动实现，不与统一 request 包装兼容），或 Python curl_cffi / cffi_curl / cyCronet。**默认必须发真实 API 请求验证**；仅当用户明确说"只输出参数不验证"时，入口才用 `--sign-only` 跳过 HTTP 请求，只输出本地 sign / 参数和组装后的脱敏请求信息。即使只有一个目标 API，也必须使用 Session 模式，动态资源刷新、Cookie / challenge 生成链路和目标 API 复用同一 Cookie jar / Header / UA / Client Hints / TLS 指纹 / fingerprint baseline。

   **内容还原型交付形态**（请求侧全明文参数、难点在响应解码的 case，如字体映射 / 图片拼装）：可省略 signer / 补环境 / TLS 指纹客户端模块，`requests` 直连即可（TLS 客户端门禁按既有文档证据豁免机制处理，在最终总结声明"目标无 TLS 指纹检测"）；但 `Session` 复用 + 显式关闭、`__main__` 守卫、responseValidation 三态判定、`验证记录.json` 与两份必选文档（最终总结 / 经验沉淀）要求不变。批量翻页请求默认带温和间隔（1-2 秒，可配置）——对目标站保持最小影响，速度不是首要目标。登录凭据通过 CLI 参数（如 `--sessionid`）注入，不硬编码进交付物。

7. **项目完成后默认生成最终总结**
   最终交付前必须生成 `result/最终项目总结.md`。总结必须使用 `scripts/write_markdown_utf8.js` 以 UTF-8 写入，模板见 `references/quality/final-summary.md`。

8. **最终代码必须简洁可读并带中文注释**
   最终补环境代码必须按职责拆分模块，禁止压缩、堆叠、过长函数、过深嵌套和无意义命名。所有手写源码必须有文件头中文职责注释，关键 WebAPI、getter / setter、NativeProtect 保护、fallback、指纹回放和加密入口必须有中文说明。中文注释必须 UTF-8 正常显示，不得包含问号、连续问号或乱码。

9. **动态 HTML / JS 必须运行时刷新**
   如果 `case/notes/resource-manifest.json` 中存在 `dynamic: true` 且 `requiredForFinal: true` 的资源，最终项目必须包含运行时刷新模块。`final.js` / `final.py` 执行顺序必须是：创建请求 session → 刷新当前 HTML / JS / challenge / seed → 更新同一 session 的 Cookie / Storage / runtime context → 加载当前资源运行 signer → 使用已确认 TLS 指纹兼容客户端在同一 session 发送最终请求 → 销毁 session。

10. **验证码接口的轨迹入口必须可替换**
    如果目标是验证码 / 风控验证接口，并且加密参数依赖点击、鼠标移动、拖动或触摸事件，最终项目允许保留旧轨迹 fixture 作为参数生成输入，但必须暴露可替换入口，例如 `motionTrack`、`eventFixture`、`verifyContext`、`clickPoints` 或 `dragPath`，并使用 UTF-8 中文注释说明"当前旧轨迹只用于补环境生成加密参数，不保证最终验证通过"。

11. **必须交付前检查**
    交付前运行：

    ```bash
    node scripts/write_markdown_utf8.js --input case/tmp/最终项目总结草稿.md --out result/最终项目总结.md --require-chinese-name --markdown
    node scripts/check_final_artifact.js --case-dir <project-root> --markdown
    node scripts/clean_case.js --case-dir <project-root> --dry-run --json
    ```

    若检查失败，先修复和清理，再交付。

## 推荐 Node.js 最终目录

目录结构详见 `references/quality/code-style.md` 的"按职责拆模块"段。补充要求：

- `final.js` 是**唯一执行入口**，必须带 `require.main === module` 守卫（被 `require('./result')` 时只导出 `sign` / `buildSignedRequest` 等 API、不自动执行、不发请求）。
- `result/final.js` 无外部依赖文件（有依赖需放 `result/src/` 下）。
- `src/` 中模块不能直接启动浏览器、启动服务或发起额外批量请求。
- `native-protect.js` 已内联进 `result/src/env/`（从 `templates/vm-sandbox/` 复制），交付物不依赖 skill 仓库目录。
- 不交付 `test/`、`tests/`、`__tests__/`、`tmp/`、`logs/`、`hooks/`、`screenshots/`、`ruyi-trace/`、`browser-profile/`。

```text
result/
├── final.js              # 唯一执行入口：node final.js（带 require.main 守卫，可被 require 取 sign）
├── config.json           # 外置配置（脱敏静态配置）
├── package.json          # 依赖契约（curl-cffi-node 等），main: final.js
├── 最终项目总结.md       # 必选：项目总结报告
├── 经验沉淀-<站点>.md    # 必选：经验沉淀文档（按 cases/_template.md 的 Part 2 格式）
└── src/
    ├── signer.js        # generateSign(params, env) + buildParams(config)，用户实现
    ├── env/
    │   ├── install-env.js
    │   ├── vm-context.js
    │   ├── native-protect.js   # 已内联，无需 skill 目录
    │   └── fixtures/index.js
    ├── request/client.js
    └── resources/fetch-runtime-resources.js   # 可选（动态资源刷新）
```

## 推荐 Python 最终目录

仅当用户明确选择 Python 请求客户端时使用：

```text
result/
├── final.py              # 唯一执行入口：python final.py（带 __main__ 守卫）
├── requirements.txt      # 依赖契约（curl_cffi 等）
├── 最终项目总结.md       # 必选：项目总结报告
├── 经验沉淀-<站点>.md    # 必选：经验沉淀文档（按 cases/_template.md 的 Part 2 格式）
└── src/
    ├── request/client.py  # 从 templates/python-request/client.py 复制，含 create_request_session
    ├── signer.py         # generate_sign(params, env) + build_params(config)，用户实现
    └── normalize.py
```

如果目标 JS 必须在 Node.js 补环境里执行，优先交付 Node.js 项目，不要用 Python 调浏览器自动化来完成签名。


## `final.js` 入口职责

验证码入口例外：`templates/captcha-verify/` 和 `templates/captcha-verify-py/` 是 provider-neutral 骨架。真实验证码协议必须由当前 case 的 adapter 实现，不能把某个厂商的接口、字段、请求方法或凭据形态写入通用模板。

成功语义（所有入口统一）：HTTP 200 ≠ 成功。自验必须在 config.json 配置 `responseValidation`（`jsonPath` / `minLength` / `contains`，从本 case 真实成功样本提取，风控接口常以 200 + 错误码返回）；未配置时所有 200 响应记「未判定」并以退出码 3 结束，交付不得宣称通过。退出码约定：0=全部通过、1=入口异常、2=存在失败、3=存在未判定。自验结束必须写 `验证记录.json`（`mode` / `responseValidation` / `summary{pass,fail,unverified}` / `attempts[]{judgment: pass|fail|unverified|error}`）。

`final.js` 是 **唯一执行入口**：不需要包含全部源码，但必须串联完整流程，且带 `require.main === module` 守卫（被 `require('./result')` 时只导出 `sign` / `buildSignedRequest` 等 API、不自动执行、不发请求）。

```javascript
// 自验入口：生成加密参数并使用已确认的请求客户端验证结果
// 注意：必须带 require.main 守卫，否则被 import 时会自动发请求
'use strict';

let fetchRuntimeResources = null;
try {
  ({ fetchRuntimeResources } = require('./src/resources/fetch-runtime-resources'));
} catch (_) {
  // 无动态资源时可以不提供刷新模块；存在动态资源时必须提供并通过检查。
}

const { installEnv } = require('./src/env/install-env');   // 用户从 templates/vm-sandbox/ 复制
const { generateSign, buildParams } = require('./src/signer'); // 用户实现 generateSign + buildParams
const { createRequestSession } = require('./src/request/client');

// 请求配置来自脱敏后的浏览器成功样本，敏感值由用户本地补充
const CONFIG = {
  api: 'https://example.com/api',
  method: 'GET',
  headers: {
    'user-agent': '<从样本脱敏迁移>',
  },
  query: {},
  body: null,
};

async function main() {
  const session = await createRequestSession(CONFIG);
  try {
    // 如果存在动态 HTML / JS / challenge，必须在同一 session 中刷新当前有效资源
    const runtimeResources = typeof fetchRuntimeResources === 'function'
      ? await fetchRuntimeResources(CONFIG, session)
      : null;

    // 补环境（安装 NativeProtect 等）；加密参数必须由补环境后动态生成，不复用 cURL 样本值
    const env = installEnv({ fixtures: {}, userAgent: CONFIG.headers['user-agent'], cookie: '' });
    const params = buildParams(CONFIG);
    const signature = generateSign(params, env);

    const response = await session.request({ config: CONFIG, params: Object.assign({}, params, { sign: signature }) });

    const ok = response.status >= 200 && response.status < 300;
    console.log(JSON.stringify({ ok, params: Object.assign({}, params, { sign: signature }), response }, null, 2));

    if (!ok) process.exitCode = 2;
  } finally {
    // 中文说明：无论请求成功还是失败，都销毁 session，清理 Cookie jar 和敏感运行态
    await session.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
```

## `final.py` 入口职责

`final.py` 是 **唯一执行入口**：必须带 `if __name__ == "__main__"` 守卫（被 `from final import ...` 时只导出、不自动执行、不发请求）。

```python
# 自验入口：生成加密参数并使用已确认的请求客户端验证结果
# 注意：必须带 __main__ 守卫，否则被 import 时会自动发请求
from src.signer import generate_sign, build_params
from src.request.client import create_request_session, CookieJar

# 请求配置来自脱敏后的浏览器成功样本，敏感值由用户本地补充
# 字段名与 Node final.js 的 config.json 完全一致，可共用同一份 config.json
CONFIG = {
    "TARGET_URL": "https://example.com/api",
    "METHOD": "GET",
    "USER_AGENT": "<从样本脱敏迁移>",
    "IMPERSONATE": "chrome135",
    "SIGN_PARAM_NAME": "sign",
    "DEVICE_COOKIE": "",
    "extraHeaders": {},
}

def main():
    session = create_request_session(
        impersonate=CONFIG["IMPERSONATE"],
        user_agent=CONFIG.get("USER_AGENT") or None,
    )
    jar = CookieJar()
    try:
        # 加密参数必须由补环境后的目标入口动态生成，不复用 cURL 样本值
        # 补环境为可选：Python 侧通常不需要；如需则 `from src.env.install_env import install_env`
        env = None
        params = build_params(CONFIG)
        signature = generate_sign(params, env)
        params[CONFIG["SIGN_PARAM_NAME"]] = signature

        response = session.request(
            CONFIG["METHOD"],
            CONFIG["TARGET_URL"],
            headers={**CONFIG.get("extraHeaders", {}), "Cookie": jar.to_string(), "User-Agent": CONFIG["USER_AGENT"]},
        )

        ok = 200 <= response.status_code < 300
        print({"ok": ok, "params": params, "status": response.status_code})

        if not ok:
            raise SystemExit(2)
    finally:
        # 中文说明：请求结束后销毁 Session，清理 Cookie jar 和敏感运行态
        session.close()

if __name__ == "__main__":
    main()
```

不得在 `final.py` 或 `src/` 中引入 Selenium、Playwright、pyppeteer、ruyiPage 或其他浏览器自动化。

## 交付前检查清单

- [ ] `result/` 是规范项目目录，而不是临时文件堆。
- [ ] `result/最终项目总结.md` 已生成（必选，不生成 = 任务未完成）。
- [ ] `result/经验沉淀-<站点>.md` 已生成（必选，按 `cases/_template.md` 的 Part 2 格式；仅用户明确拒绝时才跳过并传 `--no-require-experience`）。
- [ ] case 根目录只有 `case/` 和 `result/` 两个子目录，无散落脚本。
- [ ] 执行入口 `final.js` / `final.py` 带 `require.main` / `__main__` 守卫，被 `require` / `import` 时只导出 API、不自动执行、不发请求。
- [ ] 已交付 `package.json`（Node）/ `requirements.txt`（Python）依赖契约，复制方 `npm install` / `pip install -r` 即可。
- [ ] `native-protect.js` 已内联进 `result/src/env/`，交付物不 `require` skill 仓库的 `assets/`。
- [ ] 执行入口可直接运行，并会生成加密参数、使用 Session 发送模拟请求、输出请求结果并销毁 session。
- [ ] 模块拆分合理，必要源码位于 `src/`。
- [ ] 补环境代码已运行 `check_code_quality.js`，中文注释 UTF-8 正常、无问号、无连续问号、无乱码。
- [ ] 项目内任何源码都不包含 ruyiPage / RuyiTrace / Playwright / Puppeteer / Selenium / CDP / WebDriver 自动化代码。
- [ ] 如涉及 Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何指纹，最终项目使用真实浏览器采样 fixture + 终端 API 值回放，不依赖 node-canvas / headless-gl / 自动化浏览器。
- [ ] 最终请求由前置阶段已确认的 Node.js / Python TLS 指纹兼容 Session 客户端发起（默认行为）；仅用户明确说"只输出参数不验证"时才用 `--sign-only` 跳过；同一请求链复用 session，结束后销毁。
- [ ] fixtures 已通过；动态参数建议三组以上。
- [ ] 如存在动态 HTML / JS / challenge，已生成 `case/notes/resource-manifest.json`，并运行 `check_dynamic_resources.js --require-runtime-refresh` 通过。
- [ ] 动态快照未复制进 `result/`；最终入口会运行时刷新当前资源。
- [ ] Cookie、token、Authorization、localStorage 等敏感值已脱敏或仅由用户本地配置，不明文写入报告。
- [ ] 临时 trace、hook、日志、HAR、截图、Profile、缓存和测试文件已清理。
- [ ] `case/tmp/` 下的调试/抓包/提取脚本已清理。
- [ ] 已运行 `check_code_quality.js`、`check_fingerprint_fixture.js`，已生成 UTF-8 `result/最终项目总结.md`，并运行 `check_final_artifact.js` 和 `clean_case.js --dry-run`，且已手动复核 NativeProtect 保护证据。

## 补环境真实性交付检查

交付前执行：

```bash
node scripts/check_fingerprint_fixture.js --case-dir <project-root> --require canvas,webgl,audio,dom --markdown
node scripts/check_final_artifact.js --case-dir <project-root> --markdown
```

要求最终环境代码体现：属性描述符、访问器、原型链、构造函数、函数 toString 保护、访问器 toString 保护、实例对象 toString 保护；创建函数、构造函数、getter、setter、`document.all`、原型链时从补环境初始化阶段就必须启用 `NativeProtect` 保护，用户明确豁免才允许降级并记录原因；涉及浏览器指纹时必须保留真实采样 fixture 并做终端 API 值回放；使用 Trace 时必须保留 `notes/trace-summary.md` 与 `notes/missing-env-priority.md` 证据摘要。
