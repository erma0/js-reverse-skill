# 浏览器取证与 ruyiPage / RuyiTrace 流程

每次开始新的网页端 JS 补环境任务时读取本文件。不要等确认目标站存在自动化/CDP/JS Hook 检测后才选择工具；取证来源由 EVIDENCE_GATE 自动判定（ruyipage 网络取证 / RuyiTrace 日志采集 / 用户手动材料，见 SKILL.md 4.2/4.3），用户提供真实材料则跳过对应步骤。任务需要浏览器交互、用户提到 ruyiPage、RuyiTrace，或出现登录、验证码、MFA 时也读取本文件。

## 取证来源判定（EVIDENCE_GATE 自动路由）

取证来源不靠用户预先“选模式”，由 `scripts/check_evidence.js`（SKILL.md 4.2 EVIDENCE_GATE）按磁盘上真实存在的材料自动判定：

- 用户提供了有效的 `capture.json` / HAR / cURL / 原始 HTTP 请求文本 → Step 1 具备，跳过 FORENSIC_CAPTURE ruyipage 抓包。
- 用户提供了有效的 RuyiTrace NDJSON → Step 2 具备，跳过 TRACE_CAPTURE 采集。
- 两步均缺 → 依次执行 FORENSIC_CAPTURE（`forensic_ruyipage.py`）与 TRACE_CAPTURE（`capture_ruyitrace_log.js`），工具是固定路线，不需要用户逐个选择。
- 仅 URL 不是材料，不跳过任何取证步骤。

“取证动作”包括：打开目标页面、抓包/导出 cURL/HAR、收集 JS bundle/chunk/sourcemap、注入 Hook/断点/读取调用栈、截图/读取 Cookie/localStorage/sessionStorage、启动 ruyiPage/RuyiTrace、采集 RuyiTrace NDJSON——这些动作在 EVIDENCE_GATE 判定需要取证后按 SKILL.md 4.3 的命令执行，不需要先询问用户用哪个工具。

## 取证工具约束

取证工具固定为第 2 节绝对规则第 8 条允许的来源（常规三来源 + BLOCKED_FORENSIC 引擎检测降级时的浏览器 MCP 兜底），EVIDENCE_GATE 自动判定后按 SKILL.md 4.3 命令执行：

| 来源 | 使用条件 | 执行 |
|---|---|---|
| ruyiPage 网络取证 | 需补 Step 1（无有效 capture.json / HAR / cURL / 请求文本） | `python scripts/forensic_ruyipage.py --url <目标URL> --case-dir <project-root> --markdown` |
| RuyiTrace 日志采集 | 需补 Step 2（无有效 NDJSON） | `node scripts/capture_ruyitrace_log.js --url <目标URL> --case-dir <project-root> --import-after --markdown` |
| 用户手动材料 | 用户提供了真实存在的文件 | 先过 `check_evidence.js` 门禁，按可跳过步骤跳过取证 |
| 浏览器 MCP 兜底取证 | 仅 BLOCKED_FORENSIC：引擎级检测拒绝取证浏览器且 `--ua` 无效，经用户确认 + `node scripts/state_machine.js --case-dir <project-root> --guard mcp` | 连接用户真实浏览器采成功样本/Cookie/指纹/JS 落盘 `case/`，按用户材料走 check_evidence 校验（SKILL.md 绝对规则 8 ④；DIAGNOSE 双对照浏览器侧同守卫，须已过 BLOCKED_FORENSIC） |

> ⚠️ **URL ≠ 证据**：仅提供目标 URL / 接口 URL / JS URL 不构成任何取证材料，仍须走完整两步取证。用户手动提供材料时，先用 `node scripts/check_evidence.js --case-dir <project-root> --url <目标URL> --inputs <材料路径> --markdown` 验证文件真实存在，并以门禁输出的可跳过步骤为准（cURL/HAR/JS 只能跳过 Step 1；Step 2 RuyiTrace 日志采集需 NDJSON 才能跳过）。

门禁判定需要取证后，不要询问用户“用哪个工具”，直接按来源执行；禁止使用 chrome-devtools 类 MCP、agent-browser / browser 类 skill、系统 Chrome / Firefox / Edge 打开目标站，或用 requests / curl 直接抓取目标站 JS——这些不属于任何合法取证来源（BLOCKED_FORENSIC 引擎检测降级并经 `--guard mcp` + 用户确认的浏览器 MCP 兜底取证除外，见 SKILL.md 绝对规则 8 ④、第3节纯协议红线与第4.3节 FORENSIC_CAPTURE）。

已判定的取证来源在本次 case 内沿用，不中途更换：ruyipage 网络取证用 ruyiPage 做页面/网络/JS 取证；用户手动来源不启动本机浏览器自动化，只使用用户提供的真实文件。

如果取证工具不可用、路径缺失、runtime 不合格、需要登录、或必须更换取证方式：工具不可用先按 GATE-1 安装计划补齐（`scripts/install_all.js`），用户已提供真实材料时按决策树阻塞点 #5 降级为手动材料取证；RuyiTrace 缺失时的安装/降级确认见 `ruyi-tooling.md`「RuyiTrace 但未安装」节。不得自动 fallback 到普通系统 Firefox、普通 Playwright、Puppeteer 或其他 Playwright Firefox，也不得 fallback 到 chrome-devtools 类 MCP、agent-browser / browser 类 skill 等任何 AI 浏览器工具（引擎级检测降级语境的浏览器 MCP 兜底取证除外：须先过 BLOCKED_FORENSIC 定位检测证据 + 用户确认 + `--guard mcp`，见上表第 4 行）。

详细 ruyiPage / RuyiTrace 流程见 `ruyi-tooling.md`；自动点击、拖拽、键盘、滚动和验证码交互的 `isTrusted` 可信输入规则见 `quality/trusted-input.md`。

## 指纹基线一致性硬约束

使用 ruyiPage、RuyiTrace 或用户手动浏览器进行取证时，必须把“同一 case 的指纹一致性”作为前置门禁，而不是等发现指纹冲突后再补救。

- 第一次成功打开目标页并完成基础自检后，立即写入 `case/notes/fingerprint-baseline.json`，生成 `baselineId`。
- 后续抓包、Hook、RuyiTrace、截图、JS 收集、指纹采样和 fixture 对比必须复用同一 profile / userdir / seed / 代理 / locale / timezone / viewport / UA / Client Hints / screen / WebGL 基线。
- 禁止每次启动工具都重新随机指纹；如果工具默认会随机，必须通过持久 profile、固定 seed、固定配置或复用首次输出值来锁定本 case 基线。
- ruyiPage 与 RuyiTrace 如果不是同一浏览器或同一 profile，必须先对 baseline 做 diff。
- 发现 language、timezone、platform、UA、Client Hints、screen、DPR、WebGL、Canvas、Audio、字体或代理地区不一致时，写入 `case/notes/fingerprint-baseline-diff.md`，自动重新采样统一基线并宣布后继续；无法统一（多来源持续冲突）才输出卡点、只推进不依赖该基线的分析；不得自动混用样本。
- 用户明确更换代理、地区、profile 或工具时，生成新的 `baselineId`，旧样本只能保留为历史证据。

### WebAPI / 指纹值采样来源硬约束

当补环境需要具体值，例如 `navigator.userAgent`、`navigator.languages`、`screen.width`、`canvas.toDataURL()`、`WebGLRenderingContext.getParameter()`、`document.createElement()` 后的 DOM 几何、字体宽高、Audio / WebGPU 返回值等，必须遵循：

1. 用户选择 / 提供 RuyiTrace 或其他 trace 日志时，先查看 trace 中同一 `baselineId`、同一业务路径、未截断的真实值。
2. trace 未选择、缺失、未覆盖、疑似截断、真实长度为 `unknown` 或 baseline 不一致时，再用当前用户确认的取证工具采样；不得临时改用普通 Playwright、Puppeteer、系统浏览器或另一个随机指纹工具。
3. 自动化采样必须复用当前 case 的固定 profile / seed / 代理 / locale / timezone / UA / Client Hints / screen / WebGL 基线，并把采样结果写入 `case/fixtures/fingerprint.fixture.json` 或对应 fixture。
4. AI 不能根据经验猜值；静态分析只能帮助确定要采样的 API、调用参数和代码位置。
5. 每条采样值都要记录 `baselineId`、`source / capturedBy`、`traceStatus`、是否截断、长度 / hash 和采样时间。


## isTrusted 与原生输入硬约束

当取证阶段需要点击、鼠标移动、拖拽、键盘输入、滚动或验证码交互时，必须先按已确认工具选择可信输入路径：

- ruyiPage：优先 `page.actions` 原生 BiDi 动作链、`human_move`、`human_click`、`drag`；如果必须构造 JS 事件，必须使用 ruyiPage 特定的 `ruyi: true`。
- 用户手动：登录、MFA、验证码答案和高风险验证优先让用户在已确认取证浏览器中手动完成。

## 高强度自动化痕迹与取证风险

如果目标疑似高强度检测，不允许先用普通 headless Playwright / Puppeteer / Selenium / 系统浏览器探测再切换工具。必须从第一次打开页面起使用用户确认的 ruyiPage 或用户手动浏览器，并固定 fingerprint baseline。

取证阶段重点检查并记录：

- `navigator.webdriver` 是否为普通浏览器状态。
- `window._selenium`、`window.callSelenium`、`window.callPhantom`、`window._phantom`、`window.__nightmare`、`window.domAutomation`、`window.domAutomationController` 等自动化 honeypot 是否暴露。
- CDP / DevTools / Runtime 侧信道、console / stack 异常、debugger 检测或页面可见自动化 hook 是否存在。
- UA 中是否含 headless 特征，plugins / mimeTypes / permissions / WebGL / Canvas 是否呈现空值、随机化或隐私插件伪装。
- 鼠标、键盘、拖拽、滚动是否走可信输入；普通 `dispatchEvent` 不作为高风控主路径。
- Profile、Cookie、localStorage、sessionStorage、IndexedDB、权限状态是否属于同一 case；空 profile 或每次随机 profile 必须暂停确认。


普通 `dispatchEvent(new MouseEvent(...))`、`new KeyboardEvent(...)`、`new PointerEvent(...)` 默认是高风险合成事件，不能作为验证码或高风控交互的主路径。无法保证可信输入时，暂停并让用户选择手动完成、切换工具或明确接受风险。

## 验证码接口取证门禁

信息完整后、任何取证动作前，先判定目标是否为验证码 / 风控验证 / challenge / WAF 接口。若是，验证码场景参考 web-verify-patcher skill，**默认由 AI 用已确认取证工具完成最小必要交互和取证，不询问取证方式**：

1. 默认：用户提供从触发到验证的完整流程，AI 使用已确认取证工具自动完成最小必要交互和取证。
2. 仅当流程需要登录、验证码答案、人工识别或权限确认（AI 无法替代的物理交互）时：用户自己在取证浏览器中完成触发到验证，AI 提前开启网络捕获、Hook、截图或 Trace，并等待用户回复“已经完成触发到验证流程”。

验证码场景不得只打开页面首屏就宣称取证完成；必须覆盖触发、展示、交互、点击验证 / 提交、verify 接口返回和结果回调。需要登录、验证码答案、MFA、账号授权或人工判断时暂停，让用户手动完成，不要尝试绕过。

## ruyiPage / RuyiTrace 定位

根据官方仓库说明：

- ruyiPage 是 Python Firefox 自动化框架，基于 Firefox + WebDriver BiDi，不依赖 CDP，支持网络控制、Cookie、本地存储、拟人动作、Firefox runtime 安装和指纹浏览器配合。
- RuyiTrace 是桌面工具，包含定制 Firefox trace 内核和 Electron 客户端，采集 NDJSON DOM / JS API 运行时调用日志。
- 推荐工作流是：ruyiPage 抓取站点整体轮廓和网络数据 → RuyiTrace 采集运行时日志 → 结合 JS 文件、网络包和日志补环境。

检测：

```bash
node scripts/check_external_tools.js --markdown --project-dir <project-root>
node scripts/check_external_tools.js --python python --ruyipage-install-dir <ruyipage-browsers-dir> --project-dir <project-root> --markdown
node scripts/check_external_tools.js --python python --ruyipage-browser-path <firefox.exe> --project-dir <project-root> --markdown
```

如取证来源需要 ruyiPage / RuyiTrace，立即检测工具是否已安装；未检测到时按 GATE-1 安装计划自动安装（`install_all.js --yes`，执行前先宣布缺失组件与安装目标）并复检；安装失败时才询问用户提供路径或手动安装。

如果取证来源需要 **ruyiPage + RuyiTrace**，但仅检测到 ruyiPage、未检测到可用 RuyiTrace，不得直接建议“仅使用 ruyiPage”，也不得静默降级。按 GATE-1 先执行自动安装（`install_all.js --yes`，执行前先宣布缺失组件与安装目标）并复检；自动安装失败后，才暂停让用户选择：

- 安装 / 提供 RuyiTrace 路径，并等待安装完成与检测通过。
- 明确降级为“仅 ruyiPage”，后续不再假设存在 RuyiTrace NDJSON。

只有用户明确确认降级后，才可以进入仅 ruyiPage 取证；否则应保持 ruyiPage + RuyiTrace 模式，并先完成 RuyiTrace 安装 / 路径确认。RuyiTrace 检测通过后，采集方式**默认自动 trace**（运行 `scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir <project-root> --evidence-signal <信号> --import-after --markdown` 自动捕获；需要提前收尾时另加明确的 `--end-signal`）；自动失败、需登录/验证码/复杂交互或用户已提供日志时转手动 trace（用户用 RuyiTrace GUI 采集后提供 NDJSON，用 `scripts/capture_ruyitrace_log.js --input <trace.ndjson> --case-dir <project-root> --markdown` 导入）。不询问用户选择采集方式。

### ruyiPage 定制 Firefox 强制校验

ruyiPage 的价值在于使用 Firefox + WebDriver BiDi，并配合其 managed runtime / 定制 Firefox 降低普通自动化与 CDP 检测风险。执行 ruyiPage 流程前必须确认：

- ruyiPage Python 包可导入。
- `requests` 可导入，或用户已提供 `smart_fingerprint(manual_geo=...)` 所需地理信息；不要在智能指纹失败时静默降级。
- `scripts/check_external_tools.js` 输出“定制 Firefox runtime 是否通过验证：是”。
- 如果默认解析路径不是定制 Firefox，但检测到了已验证 runtime，启动示例必须显式 `set_browser_path("<verified-ruyipage-managed-firefox>")`。
- 如果只检测到系统 Firefox fallback，判定为不合格，不启动 ruyiPage；先按 GATE-1 自动安装定制 Firefox 并复检；仍失败才询问用户是否已经安装定制 Firefox。

选择 ruyiPage 后，从第一次打开目标页开始就必须使用 ruyiPage 启动硬约束：

- 有头模式，不使用 headless。
- 专用临时 Profile，不复用脏 profile；同一 case 后续取证复用该 profile / userdir，不得每次随机新 profile。
- `opts.smart_fingerprint(...)` 成功，并在创建页面后执行 `ctx.apply_emulation(page)`。
- 第一次成功后固化 `case/notes/fingerprint-baseline.json` 与 `baselineId`，后续复用 `base_dir`、`userdir` 和智能指纹输出。
- geolocation / timezone / locale / viewport 与出口 IP、智能指纹和 fingerprint baseline 保持一致。
- `page.capture.start(...)` 先于 `page.get(...)`。
- 导航后验证 `navigator.webdriver === false`。
- 对跨域接口，不能把单独的 `OPTIONS` preflight 当作业务取证成功。
- 自动交互优先使用 `page.actions` 原生 BiDi / human actions；确需 JS 事件时必须带 `ruyi: true`，普通 `dispatchEvent` 不视为可信输入。

如果任一硬约束失败，暂停并说明原因；不要自动切回普通 Playwright / Puppeteer / 系统 Firefox。

未检测到定制 Firefox 时使用以下提示：

```markdown
当前没有检测到 ruyiPage 定制 Firefox runtime，或 ruyiPage 可能会退回系统 Firefox。系统 Firefox 不视为通过。

我将按 GATE-1 自动安装 ruyiPage 定制 Firefox runtime 到 <project-root>/tools/（执行前先宣布安装计划与规模）。只有自动安装失败时，才需要你提供：
1. 已安装的 ruyiPage browsers 安装目录或定制 Firefox 可执行文件路径；或
2. 希望安装到的自定义目录。
```


## 登录处理

绝不要求用户提供：

- 账号密码。
- 短信或邮箱验证码。
- MFA Token 或 MFA Secret。
- 长期有效 Cookie 或 Authorization Token。

需要登录时，使用以下提示：

```markdown
当前目标站点需要登录。
请你在浏览器中手动完成登录、验证码、MFA 或其他安全验证。
完成后请回复：已经登录成功。

注意：请不要把真实账号密码直接发给我。在你确认登录成功前，我不会继续采集请求或分析接口。
```

用户回复 `已经登录成功` 后，不要立刻继续，先确认：

```markdown
已收到你确认登录成功。我将先检查当前登录态是否能够访问目标接口，然后按以下流程继续。

- 网站 URL：
- 目标页面：
- 目标 API：
- 请求方法：
- 加密参数：
- 参数位置：Query / Header / Body / Cookie
- 登录状态：用户已手动确认登录成功
- 取证来源：ruyipage 网络取证 / RuyiTrace 日志采集 / 用户手动材料
- 已知 JS 文件：
- 是否已有 Copy as cURL：
- 是否已有 HAR：
- 是否允许保存临时 Profile：
- 是否需要任务结束后删除登录态 Profile：

以上为当前意图声明与既有信息摘要；取证来源由 EVIDENCE_GATE 自动判定，缺失项按门禁补采处理。无异议我直接推进 GATE-1 环境自检与 GATE-2 证据门禁，不停下等待确认（要素缺失时才会问一次最小信息）。
```

## Cookie 过期与登录的区别

不要把所有 Cookie 失效都当作“需要用户重新给一份有效 Cookie”。处理顺序：

1. 先判断 Cookie 是否属于登录态 / 账号授权 / 会话权限，例如 session、SSO、Authorization、账号绑定 token。
2. 如果属于登录态或授权态，按登录流程暂停，让用户手动登录或提供授权样本；不要尝试绕过登录。
3. 如果目标站点不需要登录，或该 Cookie 明显是设备 Cookie、首访 Cookie、风控 Cookie、JS 生成 Cookie、challenge 派生 Cookie，则进入生成链路分析，而不是默认索要新 Cookie。
   - 非登录 Cookie 将分析生成 / 刷新链路，并尽量纳入最终入口。
4. 对非登录 Cookie，优先定位写入者：`Set-Cookie`、`document.cookie = ...`、JS 计算、Storage 派生、iframe / Worker / WASM、或服务端 challenge；并将 writer 纳入 `source → entry → builder → writer` 链路。
5. 最终交付时，非登录 Cookie 应由入口脚本生成 / 刷新后再用 Node.js 或 Python 请求客户端发送；不要把浏览器自动化作为最终验证方式。

## 验证码、MFA 与风控验证

如果出现验证码、MFA、设备验证或风险验证：

- 暂停流程。
- 让用户手动完成验证。
- 不自动破解验证码。
- 不调用第三方打码服务。
- 不索要 MFA 密钥。
- 如果用户无法完成验证，降级为离线分析，并要求用户提供 cURL、HAR、JS 文件、Initiator、调用栈样本。

## Profile 敏感性

浏览器 Profile 可能包含 Cookie、localStorage、IndexedDB 和缓存，必须按敏感材料处理。

- 默认不要把登录态 Profile 放入最终交付物。
- 登录态 Profile 默认保留并在最终总结中说明处置，用户明确要求删除才删，不为此询问。
- 不要把真实 Cookie / token 明文写入公开笔记。
- 优先保存脱敏后的请求样本。
