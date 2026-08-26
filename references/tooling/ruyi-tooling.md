# ruyiPage / RuyiTrace 集成流程

当新 case 的取证来源涉及 ruyiPage / RuyiTrace（EVIDENCE_GATE 判定需补网络取证或 trace，见 SKILL.md 4.2/4.3），或需要检测、安装、采集、导入 ruyiPage / RuyiTrace 材料时读取本文件。不要等确认目标站点存在自动化、CDP、JS Hook 或浏览器指纹检测后才使用 ruyiPage / RuyiTrace。

## 来源与定位

- ruyiPage：<https://github.com/LoseNine/ruyipage>
  - Python Firefox 自动化框架。
  - 基于 Firefox + WebDriver BiDi，不走 CDP。
  - 支持配套 Firefox runtime、指纹浏览器、网络抓包、请求拦截、Cookie、本地存储、拟人动作等。
- RuyiTrace / 如意 Trace：<https://github.com/LoseNine/Firefox-FingerPrint-Analyzer>
  - Windows x64 桌面工具，随包包含定制 Firefox trace 内核。
  - 采集 NDJSON 运行时 DOM / JS API 调用日志。
  - 探针在浏览器内核层（C++ 层），适合为补环境提供高保真环境访问日志。
  - **为什么不是 Playwright / Puppeteer 的 JS 钩子**：JS 层注入的钩子可被页面脚本通过原型检测、`toString` 嗅探、`navigator.webdriver` 或已知 hook 特征发现，触发风控反制并污染采集结果；RuyiTrace 探针位于 C++ 内核层，从 JS 视角完全不可见，因此采集的 trace 是研究指纹检测策略的高保真基线。

仅在用户授权的网页端 JS 补环境、防御性分析、学术研究场景中使用。不要用这些工具绕过登录、验证码、MFA、付费墙、服务条款或业务风控。

## RuyiTrace 优先诊断原则

当取证来源包含 RuyiTrace（自动采集或用户提供 NDJSON）时，RuyiTrace NDJSON 不是可选参考，而是补环境阶段的优先证据源：

1. 进入 Node.js 补环境前，必须先确认是否已经采集并导入 RuyiTrace NDJSON。
2. 如果已有 NDJSON，先运行 `import_ruyitrace_log.js` 生成 `notes/ruyitrace-summary.md`，再阅读摘要和必要的原始日志片段。
3. 遇到 ReferenceError、TypeError、输出不一致、缺失指纹对象、静默失败、toString / descriptor / accessor / 原型链 / `document.all` 异常等环境问题时，先回看 NDJSON，而不是直接盲补 `env.js`。
4. 优先按以下证据定位：
   - `api` 调用频率和类别。
   - 与目标参数生成、请求发起、writer 写入时间邻近的调用。
   - `stack.file / line / col` 指向的 JS 文件、模块和函数。
   - navigator / screen / document / storage / canvas / WebGL / audio / crypto / performance / worker / iframe 等环境模块分类。
5. 只有在 NDJSON 缺失、未覆盖当前路径、日志时间段不对应、或日志结论不足时，才使用 `run_with_trace.js`、Proxy trace、Hook 或断点作为补充。
6. 输出补环境计划时，必须标明哪些环境依赖来自 RuyiTrace 证据，哪些只是 Node trace / 推断，避免把推断写成事实。
7. RuyiTrace 长字符串字段可能被截断。导入日志后，如果任意字符串字段达到或接近 4000 字符，必须标记为疑似截断：真实长度写 `unknown`，最小长度写可见长度，不能把 4000 或可见长度解释为加密参数或指纹值真实长度。涉及 WebAPI / 指纹具体值时，未截断 RuyiTrace 值优先；RuyiTrace 未选择、缺失、未覆盖或疑似截断时，必须使用当前用户确认的取证工具在同一 fingerprint baseline 下补采完整值，不能由 AI 猜值。

如果取证来源需要 RuyiTrace 但尚无日志，采集方式默认自动 trace（`scripts/capture_ruyitrace_log.js` 自动启动随 RuyiTrace 提供的 trace Firefox 捕获 NDJSON 并导入摘要），自动失败、需登录验证等复杂交互或用户指定日志时转手动 trace（用户用 RuyiTrace 采集完成后提供 NDJSON，用 `scripts/capture_ruyitrace_log.js --input <日志>` 直接导入）；用户已提供 NDJSON 时直接导入，不重复采集。用户明确确认无法提供 NDJSON 后，才降级为 ruyiPage 网络证据 + Node trace 流程。

如果取证来源需要 RuyiTrace 但检测到 RuyiTrace 未安装或目录不完整，按 GATE-1 安装计划自动安装（`install_all.js --yes`）并复检；安装失败或用户明确拒绝时才询问用户提供 RuyiTrace 路径或明确确认降级。不得自动改成“仅 ruyiPage”绕过，也不要只建议“仅使用 ruyiPage”。

## 取证来源由 EVIDENCE_GATE 自动判定

不需要用户在任务开始前“选择取证模式”。取证来源由 `scripts/check_evidence.js`（SKILL.md 4.2 EVIDENCE_GATE）按磁盘上真实存在的材料自动判定：

- 用户提供了有效 `capture.json` / HAR / cURL / 原始 HTTP 请求文本 → Step 1 具备，跳过 ruyipage 抓包。
- 用户提供了有效 RuyiTrace NDJSON → Step 2 具备，跳过 trace 采集。
- 两步均缺 → 依次执行 `forensic_ruyipage.py`（Step 1）与 `capture_ruyitrace_log.js`（Step 2），工具是固定路线，不需要用户逐个选择。
- 仅 URL 不是材料，不跳过任何取证步骤。

只有以下场景才需要特殊处理（均来自 SKILL.md 状态机与决策树阻塞点）：

1. 检测到 ruyiPage / RuyiTrace 未安装或目录不完整（GATE-1 未过）→ 直接执行 `install_all.js --yes` 自动安装（GATE-1 必需步骤，不询问用户）。
2. 取证需要 RuyiTrace 但未安装 → 按 GATE-1 自动安装（`install_all.js --yes`，执行前先宣布安装目标与规模）；自动安装失败时才由用户在「提供路径 / 手动安装」与「明确降级」之间选择。
3. RuyiTrace 自动采集失败、需登录/验证码/复杂交互 → 转手动 trace，让用户用 RuyiTrace GUI 采集。
4. 用户明确表示不提供自动化或需要真实登录态 → 用户手动材料来源，跳过对应取证步骤（先过 `check_evidence.js` 门禁，仅 URL 不触发）。

取证来源由 EVIDENCE_GATE 判定后，后续所有浏览器取证动作必须沿用该来源（证据完整性），不能临时 fallback 到普通 Playwright、Puppeteer 或系统 Firefox。

## 验证码场景的 RuyiTrace 覆盖

如果目标是验证码 / 风控验证 / challenge / WAF 接口，RuyiTrace 自动捕获或手动捕获都必须覆盖完整链路：触发验证码、验证码组件初始化、用户交互事件、加密参数生成、verify / validate / challenge 接口发起、结果回调。

- 用户提供完整流程时，自动捕获脚本应按该流程执行；若流程需要人工识别、登录、验证码答案或权限交互，暂停让用户完成。
- 流程需要登录、验证码答案、人工识别或权限确认（AI 无法替代的物理交互）时，先启动 RuyiTrace 记录，再让用户操作；只有用户回复“已经完成触发到验证流程”后，才停止记录并导入 NDJSON。
- 如果 `notes/ruyitrace-summary.md` 只覆盖页面加载、没有交互事件或 verify 接口附近调用栈，应要求重新采集，不得直接进入补环境。

## 本机工具检测

先运行检测脚本：

```bash
node scripts/check_external_tools.js --markdown --project-dir <project-root>
node scripts/check_external_tools.js --json --project-dir <project-root>
node scripts/check_external_tools.js --python python --ruyipage-install-dir <ruyipage-browsers-dir> --project-dir <project-root> --markdown
node scripts/check_external_tools.js --python python --ruyipage-browser-path <firefox.exe> --project-dir <project-root> --markdown
```

检测脚本会顺带对比 GitHub 最新 release：**发现新版只提示、不自动更新**，输出位于 `## 版本更新提示（仅提示，不自动更新）`。出现提示时由用户确认后再走 `download_ruyi_tool.js --dry-run` / `pip install --upgrade` 更新；更新工具版本会改变指纹基线与 NDJSON 日志格式，当前未完成的 case 建议保持版本不变，旧取证样本与新工具样本不能混用。网络失败或限流时该节静默跳过，不影响检测结果；透明代理自签 CA 环境下需设置 `RUYI_INSECURE_TLS=1` 才能完成版本查询（与 download_ruyi_tool.js 同开关）。

检测结果同时包含 ruyiPage 包**最低版本检查（>= 1.2.45，对应本 skill 取证脚本 API 依据）**：低于该版本时仅在"下一步"提示升级，不硬性阻断检测。本 skill 脚本 API 依据 ruyipage >=1.2.45 内省确认，151/155 runtime 均适用（含 v1.2.57 / v1.2.58）。

**强制要求**：选择 ruyiPage 时，不能只检测 `import ruyipage` 是否成功，也不能把系统 Firefox fallback 当作可用。必须确认：

- ruyiPage Python 包可导入。
- Python 环境具备 `requests`，或已准备 `smart_fingerprint(manual_geo=...)` 所需地理信息；否则默认智能指纹地理探测会失败。
- Firefox 可执行文件来自 ruyiPage managed runtime，或来自用户明确提供且可验证的 ruyiPage 定制 Firefox。
- runtime 根目录存在 `install.json`。
- `install.json.release`、`install.json.asset`、`install.json.url` 或 runtime 目录名体现 `ruyi` 定制标识。兼容三代命名：`151-ruyi`（含 ruyi）、`151-proxy` / `155-proxy`（Firefox 版本号前缀）、`v1.2.57` 类语义化 tag + `firefox-155.0a1...` 定制 asset（新版命名，检测脚本同时按 LoseNine/ruyipage 来源 url 判定）。
- `install.json.executable` 指向的 Firefox 文件确实存在。

如果检测结果显示“系统 Firefox fallback / 未验证路径风险”，判定 ruyiPage 绕检测方案 **不通过**，暂停流程并要求用户提供定制 Firefox 路径或安装目录。

如果用户已安装但脚本未检测到，要求用户提供：

- ruyiPage：Python 解释器路径，或确认当前 `python` 可以 `import ruyipage`。
- ruyiPage runtime：`python -m ruyipage path` 输出的 Firefox 路径、`--ruyipage-install-dir` 指向的 managed runtime 根目录，或 `--ruyipage-browser-path` 指向的定制 Firefox 可执行文件路径。
- RuyiTrace：`RuyiTrace.exe` 所在目录，或 `RuyiTrace.exe` 路径；该目录中应保留定制内核和 `RUYI_DOMTRACE.txt`。兼容两代目录结构：新版 2.5+（Electron 壳）为 `resources/kernel/firefox(.exe)` + `resources/kernel/RUYI_DOMTRACE.txt`；旧版 1.x 为 `firefox/` 子目录 + `firefox/RUYI_DOMTRACE.txt`。检测脚本自动识别任一结构。
- 日志目录：RuyiTrace 生成 NDJSON 的目录。

示例：

```bash
node scripts/check_external_tools.js --python python --ruyitrace-home <RuyiTrace-dir> --markdown
node scripts/check_external_tools.js --python python --ruyipage-browser-path <verified-ruyipage-firefox.exe> --markdown
```

## ruyiPage + RuyiTrace 但 RuyiTrace 未安装

当取证需要 RuyiTrace（GATE-2 判定需补 Step 2，或用户已提供 NDJSON 来源），检测脚本返回 RuyiTrace 未安装、`RuyiTrace.exe` 不存在、定制内核目录缺失（新版 `resources/kernel/` 或旧版 `firefox/`），或 `RUYI_DOMTRACE.txt` 缺失时，按以下强制流程处理：

1. **先自动安装（B 档宣布 + 继续 + 可打断）**：执行前先输出一行宣布（缺失组件、安装目标 `<project-root>/tools/`、预计下载规模），随后 `node scripts/install_all.js --project-dir <project-root> --yes --markdown` 自动安装并复检；不询问用户选择。
2. **不要自动降级**：安装与复检完成前，不得静默降级为“仅 ruyiPage 网络取证”，也不得继续进入需要 RuyiTrace NDJSON 的补环境分析。
3. **自动安装失败后，才由用户在「安装 / 提供 RuyiTrace 路径」与「明确降级为仅 ruyiPage 网络取证」之间选择**：
   - 用户选择安装 / 提供路径时：
     - 若已安装但未检测到，要求用户提供 `RuyiTrace.exe` 路径或所在目录。
     - 若未安装，要求用户提供下载 / 安装目录。
     - 先用 `download_ruyi_tool.js --tool ruyitrace --dest <download-dir> --dry-run --markdown` 输出下载计划。
     - 用户确认后才下载；下载后提示用户解压 / 安装。
     - 等用户确认 `RuyiTrace.exe` 可打开、定制内核目录（`resources/kernel/` 或 `firefox/`）存在、日志目录可选择后，再重新运行检测。
   - 用户选择降级时：
     - 记录“RuyiTrace 已由用户确认降级：后续仅 ruyiPage 网络取证 + Hook / Node trace”。
     - 后续不得再假设存在 NDJSON。
     - 补环境阶段使用 ruyiPage 网络证据、Hook / 断点证据、Node trace / Proxy trace 作为替代来源，并在输出中标明缺少 RuyiTrace 高保真日志。

提示模板：

```markdown
你选择的是 ruyiPage + RuyiTrace，但当前未检测到可用的 RuyiTrace。该模式需要 RuyiTrace NDJSON 作为补环境优先证据源。我将按 GATE-1 安装计划自动安装（`install_all.js --yes`，安装到 <project-root>/tools/）；只有自动安装失败时，才需要你提供 RuyiTrace 路径或明确确认降级为“仅 ruyiPage”（后续补环境使用 ruyiPage 网络证据 + Hook / Node trace 作为替代）。
```

## 未安装时的安装流程

检测到缺失组件时，优先使用一键安装脚本——**默认路径：执行前先输出一行宣布（缺失组件、安装目标与预计规模），随后直接 `install_all.js --yes` 自动安装（B 档宣布 + 继续 + 可打断）**。以下分项手动流程仅在自动安装失败、或用户需要指定已有安装路径时才使用：

```bash
node scripts/install_all.js --project-dir <project-root> --markdown          # 输出安装计划
node scripts/install_all.js --project-dir <project-root> --yes --markdown    # 默认自动安装到 <项目根>/tools/（不询问）
```

默认安装到 `<项目根>/tools/`：
- ruyiPage 定制 Firefox runtime：`tools/ruyipage-browsers/`
- RuyiTrace 定制 trace 内核：`tools/RuyiTrace/`（自动下载 zip 并解压）

install_all.js 内部按需执行：`pip install ruyiPage requests` → `python -m ruyipage install` → 下载 RuyiTrace.zip 并自动解压 → 重新检测验证。

如需单独安装或自定义目录，使用下方分项流程。

#### ruyiPage（仅自动安装失败后使用）

手动安装时确认安装意向，然后直接让用户选择准备状态或安装目录：

```markdown
自动安装未成功。请选择准备状态：

1. 你已经提前安装好 ruyiPage 定制 Firefox → 请提供 ruyiPage browsers 安装目录，或定制 Firefox 可执行文件路径。
2. 未安装 → 按下方命令自行安装到指定目录（或提供希望安装到的目录，我先输出 dry-run 计划再执行）。
```

推荐让用户自行在 Python 环境中安装：

```bash
python -m pip install ruyiPage --upgrade
python -m pip install requests --upgrade
python -m ruyipage install --install-dir <ruyipage-browsers-dir>
python -m ruyipage doctor --install-dir <ruyipage-browsers-dir>
python -m ruyipage path --install-dir <ruyipage-browsers-dir>
```

如果用户需要 async 支持：

```bash
python -m pip install "ruyiPage[async]" --upgrade
```

也可以使用随包安装脚本输出计划或直接安装（自动安装路径，执行前先宣布）：

```bash
node scripts/install_ruyipage_runtime.js --python python --install-dir <ruyipage-browsers-dir> --markdown
node scripts/install_ruyipage_runtime.js --python python --install-dir <ruyipage-browsers-dir> --install --markdown
```

如果用户已自行准备 Firefox、便携版 Firefox 或 Firefox 指纹浏览器，只有在它确认为 ruyiPage 定制 Firefox 或用户明确说明是等价指纹浏览器时才可跳过 runtime 安装；普通系统 Firefox 不能作为绕自动化检测的 ruyiPage 方案。

### RuyiTrace

RuyiTrace 是桌面工具。安装原则（默认自动安装 `install_all.js --yes`；仅自动安装失败后走下方手动流程）：

1. 先向用户确认下载目录。
2. 仅在用户确认后下载 Release 资产。
3. 下载完成后提示用户解压 / 安装，并保持 `RuyiTrace.exe` 与 `firefox/` 子目录在同一目录。
4. 等用户确认 `RuyiTrace.exe` 可以打开且“定制内核”状态正常后，再继续。

可用脚本查看下载计划或下载：

```bash
node scripts/download_ruyi_tool.js --tool ruyitrace --dest <download-dir> --dry-run --markdown
node scripts/download_ruyi_tool.js --tool ruyitrace --dest <download-dir> --markdown
```

如只需要 ruyiPage 配套 Firefox runtime，优先使用 `python -m ruyipage install`；需要离线下载时再使用：

```bash
node scripts/download_ruyi_tool.js --tool ruyipage-firefox --dest <download-dir> --dry-run --markdown
```

下载脚本只负责下载，不默认解压、安装或启动桌面程序。

## ruyiPage 取证流程

> **首选：通用取证脚本，不要每个 case 手写。**
> 直接运行 `python scripts/forensic_ruyipage.py`：它会自动满足下方所有启动硬约束、用 `targets=True` 抓全部包（事后从 `steps` 过滤，避免漏掉 JS 文件）、把 JS 文件落盘到 `case/js/original/`、并写出 `case/notes/fingerprint-baseline.json`。仅在脚本参数无法覆盖的极复杂多步交互时才走“逃生舱”手写（见文末），且手写也必须遵守同样的约束与正确 API。
>
> 典型用法：
> ```bash
> python scripts/forensic_ruyipage.py --url <目标页> --case-dir <project-root> --targets "feed/hot" --browser-path <定制Firefox> --markdown
> # 仅检测环境并打印计划（不启动浏览器）：
> python scripts/forensic_ruyipage.py --url <目标页> --case-dir <project-root> --dry-run --markdown
> ```
> 输出：`<case-dir>/forensic/capture.json`（全部包元数据）、`target-hits.json`（目标命中元数据/小 body/预览）、`related-hits.json`（前置链元数据/小 body/预览）、`bodies/`（超过 JSON 预览阈值的完整 body）、`wasm/`（完整 WASM）、`js/original/`（JS 文件）、`notes/fingerprint-baseline.json`。
>
> 指定 `--targets/--targets-regex` 后，未捕获到非 OPTIONS 2xx 目标响应时脚本退出码非 0（报告 `NO_TARGET`/`PARTIAL`），作为 Step 1 缺失硬信号；未命中不得转源码搜索，需重采或由用户提供 cURL/HAR。

取证来源判定为 ruyiPage 网络取证（需补 Step 1）后：

1. 检查 ruyiPage 包、`requests` 依赖和 Firefox runtime，并确认 runtime 是 ruyiPage 定制 Firefox。
   - 如果只检测到系统 Firefox fallback，立即暂停，不启动浏览器。
   - 如果已找到定制 Firefox 但不是默认解析路径，启动时必须显式指定 `browser_path` / `set_browser_path`。
   - 如果缺少 `requests`，必须安装依赖或让用户提供 `manual_geo`；不要静默跳过智能指纹。
2. 按“ruyiPage 启动硬约束”启动；任一硬约束失败时，停止并报告，不要继续取证。
3. 确认是否需要登录；需要登录时让用户手动完成。
4. 使用有头模式打开页面。
5. 触发最少量必要业务动作。
6. 收集：
   - Network / cURL / HAR。
   - JS bundle / chunk / sourcemap URL。
   - Cookie、本地存储键名、请求头、响应状态。
   - source / entry / builder / writer 链路证据。
7. 单个取证动作完成并沉淀必要结论后，立即清理临时截图、失败下载、临时日志和无登录态 profile；登录态 profile 默认保留至 CLEANUP 并在最终总结中说明处置，用户明确要求删除才删，不询问。

### ruyiPage 启动硬约束

不要把“能启动浏览器”当作 ruyiPage 取证成功。每次 ruyiPage 取证都必须从一开始满足以下约束：

| 约束 | 要求 |
|---|---|
| 定制内核 | 必须显式使用已验证的 ruyiPage 定制 Firefox runtime；不得使用系统 Firefox fallback |
| 有头模式 | 必须 `headless(False)` 或等价有头模式；不要用 headless 做高风控取证 |
| 独立 Profile | 使用本 case 专用临时 `user_dir` / profile，不复用脏 profile |
| 智能指纹 | 默认调用 `opts.smart_fingerprint(require_country=None, base_dir=..., userdir=...)`；如果地理探测失败，要求安装 `requests` 或提供 `manual_geo`，不要静默跳过 |
| 仿真注入 | 如果 `smart_fingerprint()` 返回 `ctx`，创建页面后必须执行 `ctx.apply_emulation(page)` |
| 指纹一致性 | 第一次成功取证后写入 `case/notes/fingerprint-baseline.json` 和 `baselineId`；geolocation、timezone、locale、viewport、UA、Client Hints、screen、WebGL 与 `smart_fingerprint` 输出和出口 IP 保持一致；后续复用同一 `base_dir` / `userdir`，不要每次随机新指纹 |
| 拟人动作 | 设置 `set_human_algorithm("windmouse")` 或 `"bezier"`，优先使用拟人滚动 / 点击触发业务动作 |
| 取证时机 | `page.capture.start(...)` 必须在 `page.get(...)` 之前执行 |
| 自检 | 导航后检查 `navigator.webdriver`，期望为 `false`；若为 `true`，判定当前取证不合格 |
| 验收 | 目标接口必须捕获到非失败响应；对跨域接口不要把单独的 `OPTIONS` preflight 当作业务取证成功 |
| isTrusted | 点击、拖拽、鼠标、键盘、滚动优先使用原生 BiDi / human actions；确需 JS 构造事件时必须带 `ruyi: true`；普通 `dispatchEvent` 不视为可信输入 |

这些约束只能降低普通自动化 / CDP / 指纹检测风险，不能保证绕过所有业务风控、登录、验证码、MFA、设备验证或服务端策略。

### add_preload_script 用法（页面脚本执行前注入 hook）

需要 hook 页面 JS（如拦截 `XMLHttpRequest.prototype.open` 做分层定位的反向对照、导出 SDK 内部函数）时用 `page.add_preload_script(script)`，注意两个坑：

1. **`script` 必须是函数声明字符串**（如 `"() => { ... }"`），传 IIFE 字符串会**静默不执行且无报错**。
2. **hook 必须带执行标记并验证**：函数体内设置 `window.__hookInstalled = true` / 递增 `window.__hookCount`，页面加载后先读标记确认 hook 生效，再解读实验结果——否则会把页面自身行为误当成注入效果（实战：反向对照实验曾因 IIFE 静默失效得出无效结论）。

```python
hook = """() => {
  window.__hookInstalled = true;
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string' && url.includes('<目标接口关键词>')) {
      window.__hookCount = (window.__hookCount || 0) + 1;
      // ... 改写 url / 记录参数
    }
    return origOpen.apply(this, arguments);
  };
}"""
page.add_preload_script(hook)   # 必须在 page.get(...) 之前
```

## ruyiPage / RuyiTrace 指纹基线固定

- ruyiPage 第一次成功取证后，把 `smart_fingerprint` 输出、profile / userdir、UA、Client Hints、locale、timezone、viewport、screen、WebGL 等写入 `case/notes/fingerprint-baseline.json`。
- RuyiTrace 自动捕获或手动采集前先确认使用同一 case profile / baseline；如果 RuyiTrace 定制内核不能复用同一 profile，必须采样核心字段并写入 `case/notes/fingerprint-baseline-diff.md`，不一致时暂停。
- 后续 Hook、截图、网络抓包、指纹 fixture 采样必须带同一 `baselineId`；缺少 `baselineId` 时不得把样本用于最终 env。
- 如果用户更换代理、地区、语言、profile 或工具，生成新的 baseline，旧样本不能和新样本混用。
- 出口代理（`forensic_ruyipage.py --proxy host:port` / `--proxy-auth user:pass`）只在目标站需要固定出口 IP / 国家匹配时使用，国内站点默认直连；代理账号密码由 `smart_fingerprint` 写入 fpfile，不写入业务脚本、`capture.json` 或最终交付物（与绝对规则第 7 条「不记录密钥」一致）。

### ruyiPage isTrusted 交互规则

高风控点击、拖拽、键盘输入、滚动和验证码交互优先使用 ruyiPage 原生 BiDi / human actions：

```python
page.actions.move_to(page.ele("#btn")).click().perform()
page.actions.drag(page.ele("#source"), page.ele("#target"), duration=640, steps=16).perform()
page.actions.release()
page.actions.human_move(ele, algorithm="windmouse").perform()
page.actions.human_click(ele, algorithm="windmouse").perform()
```

如果必须构造 JS 事件，只允许使用 ruyiPage 的 `ruyi: true` 特定能力，并在取证报告中说明事件类型和参数：

```javascript
new MouseEvent('click', { bubbles: true, clientX: 12, clientY: 24, ruyi: true });
new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', ruyi: true });
new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 3, clientY: 5, ruyi: true });
```

普通 `dispatchEvent(new MouseEvent(...))`、`new KeyboardEvent(...)` 不得作为验证码或高风控交互主路径。无法保证可信输入时，暂停并让用户手动完成或切换工具。

### 逃生舱：何时仍需手写（极少数）

通用脚本已覆盖绝大多数场景（打开页面、抓全部包、过滤目标、落盘 JS、指纹基线、登录前暂停、单点拟人点击 / 滚动）。仅在脚本参数无法覆盖的**复杂多步业务交互**时才手写，且必须遵守：

0. **脚本缺陷 / 能力缺口不是手写理由**：`forensic_ruyipage.py` / `capture_ruyitrace_log.js` 等共享脚本有 bug 或参数覆盖不了时，**禁止用 case 内手写脚本绕过**——先修共享脚本，或请用户提供材料（cURL / HAR / 手动 trace NDJSON）。手写仅限「复杂多步交互」这一种理由，且必须走完下方同一套启动硬约束与验收标准。

1. 复用通用脚本同一套启动硬约束（定制 Firefox、有头、独立 profile、smart_fingerprint + apply_emulation、capture.start 在 get 之前、navigator.webdriver 自检）。
2. **正确 API（基于 ruyipage >=1.2.45 内省确认，151/155 runtime 均适用，含 v1.2.57+，避免重蹈覆辙）**：
   - `page.capture.start(targets=True, collect_bodies=True)`：`targets=True` 抓**全部**请求；用字符串 / `list` 只做子串过滤，会漏掉 JS 文件。
   - `page.capture.wait(timeout=, count=1)` 返回**单个** `CapturePacket` 或 `None`；`count>1` 才返回列表。
   - 全部已抓包用 `page.capture.steps`（**不是** `get_all`）读取。
   - `CapturePacket.to_dict(include_bodies=True)` 含 `url / method / request_headers / response_status / response_headers / request_body / response_body / is_failed`。
   - `ctx = opts.smart_fingerprint(...)` → `ctx.apply_emulation(page)`；`ctx.to_dict()` 持久化基线。
   - **导航 / 交互 / 环境覆写（方法名与 Playwright 不同，勿按 Playwright 猜）**：
     - 构造：`page = FirefoxPage(opts)`（`opts` 由 `FirefoxOptions` 构建）；`launch()` 不接受 `opts` 参数，返回值即 page 对象。
     - 导航：`page.get(url, timeout=, wait="interactive")`（不是 `goto` / `navigate`）。
     - 执行 JS：`page.run_js(expr, timeout=)`，取返回值在表达式内 `return`。
     - UA 覆盖：`page.set_useragent(ua)`——在 `apply_emulation` **之后**调用才能覆盖指纹仿真设置的 UA；仅覆盖 UA 字符串，`eval.toString()` 等内核级检测无效（见 `references/env/env-detect-bypass.md` 内核级差异检测）。标准取证优先用 `forensic_ruyipage.py --ua`，不要为改 UA 手写探针。
     - Cookie：`page.set_cookies({"name": ..., "value": ..., "domain": ...})`（dict 或 dict 列表，不是 Playwright 的 `add_cookies`）；读取用 `page.get_cookies(all_info=True)`。
   - **Firefox 155+ 兼容**：ruyipage ≥1.2.62 已原生内置（`capture.start` 上下文订阅失败自动降级全局；`smart_fingerprint` 自带脚本可访问的 `about:blank` 启动页；提权窗口下 `allow_system_access` 按需自动开启）。**旧版本（<1.2.62）由共享脚本兜底，禁止改 site-packages/wheel 内部**：`forensic_ruyipage.py` 已自动补 `--remote-allow-system-access`（管理员/提权 Windows 下 Firefox 155+ 拒绝浏览器外的远程调试连接，ruyipage ≤1.2.61 均不自动加），并对 `session.subscribe` 的 privileged-scope 报错做全局订阅降级（ruyipage 1.2.61 回退了 1.2.45 自带的降级逻辑）。遇到这两个问题先修 `forensic_ruyipage.py`，不要在临时解压的 wheel / site-packages 里改 `capture.py` 或 `firefox_options.py`——升级或重装即丢失。
   - 不确定的方法名 / 签名一律先内省（`dir(page)`、`inspect.signature(page.get)`），禁止按 Playwright / Selenium API 命名习惯猜——match5 实测 `goto` / `add_cookies` / `page.close` 均不存在，按 Playwright 写法逐轮报错浪费 5+ 轮。
3. 抓包完成后 `page.capture.stop()` 会确保响应体加载；JS 文件优先从 `response_body` 落盘，不要改用普通 `requests` 重新下载（会丢失指纹上下文）。

只有当 `node scripts/check_external_tools.js --markdown --project-dir <project-root>` 显示“默认解析路径是否为定制 Firefox：是”时，才可直接 `FirefoxPage()` 或 `launch(headless=False)`。否则必须显式指定已验证的定制 Firefox 路径。

### ruyiPage 取证验收标准

- JD `pc_home_feed` 类接口：至少捕获到 URL 包含 `pc_home_feed` 的 2xx 响应，并能看到请求 URL 中的加密 / 风控参数，例如 `h5st`。
- 美团外卖 `shopList` 类跨域接口：必须区分 `OPTIONS` preflight 与真实业务请求；只有捕获到非 `OPTIONS` 的 2xx `shopList` 响应，才算取证成功。若返回登录 / Yoda / 401 风控信息，应按“需要登录 / 风控验证”流程暂停，不要宣称已绕过。
- 用户完成登录 / 点击 / 验证码等操作后，可直接关闭 ruyiPage 浏览器窗口表示“抓包结束”。脚本检测到浏览器关闭或 WebSocket 断连后会立即进入收尾，保存已捕获请求并报告 `endReason=browser-closed`；此时不要 kill Python 进程，应等待 `FORENSIC DONE` 或最终 JSON / Markdown 输出。该结束原因不是失败，但也不等于验收通过：指定 `--targets/--targets-regex` 时仍以是否捕获非 `OPTIONS` 2xx 终态为准，未命中仍返回 `NO_TARGET` / `PARTIAL`。等待期间脚本会增量写 `case/forensic/partial-steps.jsonl`；正常收尾后自动删除，若硬杀后残留则仅可作为 URL / 方法 / 状态 / 请求头元数据兜底，不能替代 `capture.json`、目标命中记录或完整 body。

## RuyiTrace 日志采集流程

取证来源需要 RuyiTrace 时，采集方式**默认自动 trace**（`capture_ruyitrace_log.js` 自动启动 trace Firefox），自动失败、需登录/验证/复杂交互或用户已提供日志时转手动 trace（用户提供 NDJSON 后直接导入，不重复采集）。**不询问用户选择采集方式**：

- 默认自动 trace：用 capture_ruyitrace_log.js 自动启动随 RuyiTrace 提供的 trace Firefox 捕获 NDJSON（需要 RuyiTrace 完整安装）。
- 转手动 trace：需要登录 / 验证码 / 复杂交互或用户已提供日志时，用户用 RuyiTrace.exe 自行采集，把 NDJSON 日志路径交给 AI 直接导入生成摘要。

### 方式一：自动 trace

检测到 `RuyiTrace.exe`、定制内核 `firefox(.exe)` 和 `RUYI_DOMTRACE.txt` 完整后（新版 2.5+ 位于 `resources/kernel/`，旧版 1.x 位于 `firefox/`），不要默认让用户手动打开 GUI。优先使用随包脚本自动启动 RuyiTrace 的 trace Firefox，并通过 `MOZ_DOM_TRACE` 环境变量写出 NDJSON：

```bash
node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir <project-root> --ruyitrace-home <RuyiTrace-dir> --dry-run --markdown
node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir <project-root> --ruyitrace-home <RuyiTrace-dir> --evidence-signal handshake --import-after --markdown
```

执行要求：

1. 自动创建或使用 `case/ruyi-trace/logs/` 作为日志目录，使用 `case/tmp/ruyitrace-profile/` 或临时 Profile。
2. 使用 RuyiTrace 随包 trace Firefox，而不是普通系统 Firefox、普通 Playwright、Puppeteer 或 ruyiPage 的 Firefox runtime。
3. 设置 `MOZ_DOM_TRACE=1`、`MOZ_DOM_TRACE_FILE=<case trace file>`、`MOZ_DOM_TRACE_LIMIT=<limit>` 和 `MOZ_DISABLE_LAUNCHER_PROCESS=1`。
4. 打开目标页面后触发最少量必要业务动作；如果需要登录、验证码、MFA、设备验证或权限确认，暂停让用户在该 trace Firefox 中手动完成，再继续采集。
5. 自动 trace 结束后，立即运行 `import_ruyitrace_log.js` 导入日志、生成 `notes/ruyitrace-summary.md`，并检查长字段截断风险。
6. 如果自动 trace 没有生成 NDJSON，先记录失败原因和已执行命令，再转手动 trace（方式二）；不要把"没有日志"误写成目标没有环境访问。

> 提前结束：采集期间用户观察访问完成、直接手动关闭 trace Firefox（或浏览器崩溃）时，脚本每 1.5s 检测一次内核进程（ExecutablePath 精确匹配），检测到进程归零即**提前结束采集**（不必等满 `--duration`）；NDJSON 由内核旁路写盘，正常关闭不丢日志，导入照常。仅启动慢/从未出现进程或非 Windows 时按 duration 兜底。

自动 trace 成功后继续：

```bash
node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir <project-root> --truncation-threshold 3900 --markdown
```

### 方式二：手动 trace（用户指定日志）

适用场景：自动 trace 启动失败 / trace Firefox 无法写日志 / 需登录验证等复杂交互 / 日志未覆盖目标参数生成路径时转手动（不询问用户选择采集方式）。

手动流程：

1. 打开 `RuyiTrace.exe`。
2. 填写启动页面。
3. 选择日志目录，建议选择当前 case 的 `ruyi-trace/logs/` 或用户指定目录。
4. 点击“开始采集”。
5. 在浏览器中正常浏览并触发目标指纹 / 加密参数生成逻辑。
6. 点击“停止采集”。
7. 找到 `trace_<时间戳>_<PID>.ndjson`，将路径提供给 AI / 直接用脚本导入：

```bash
node scripts/capture_ruyitrace_log.js --input <trace.ndjson> --case-dir <project-root> --markdown
```

该命令内部调用 `import_ruyitrace_log.js`：把日志复制到 `case/ruyi-trace/logs/`、生成 `notes/ruyitrace-summary.md`、检查长字段截断风险。如需调整截断阈值，直接使用导入脚本：

```bash
node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir <project-root> --truncation-threshold 3900 --markdown
```

高级手动启动方式仅在用户理解环境变量时使用：

```cmd
set MOZ_DOM_TRACE=1
set MOZ_DOM_TRACE_FILE=<trace-output.ndjson>
set MOZ_DOM_TRACE_LIMIT=<max-lines>
set MOZ_DISABLE_LAUNCHER_PROCESS=1
<ruyitrace-firefox.exe> -no-remote -new-instance <target-page-url>
```

可选环境变量：

| 变量 | 用途 |
|---|---|
| `MOZ_DOM_TRACE=1` | 开启 trace |
| `MOZ_DOM_TRACE_FILE=<path>` | 输出路径，PID 自动追加 |
| `MOZ_DOM_TRACE_LIMIT=<n>` | 单进程行数上限 |
| `MOZ_DOM_TRACE_PTYPE=<list>` | 启用 trace 的进程类型 |
| `MOZ_DISABLE_LAUNCHER_PROCESS=1` | Windows 下避免 launcher 提前退出 |

## RuyiTrace NDJSON 事件结构

NDJSON 每行一条事件，是 TRACE_ANALYZE 用 `search_trace.js` 检索、`analyze_trace.js` 分类、`import_ruyitrace_log.js` 摘要的共同依据。典型结构：

```json
{
  "t": "call",
  "api": "CanvasRenderingContext2D.fillText",
  "args": ["BrowserLeaks.com", 4, 17],
  "stack": [
    { "file": "https://example.test/fp.js", "line": 42, "col": 17 }
  ]
}
```

| 字段 | 含义 | 脚本兼容 |
|---|---|---|
| `t`（或 `type`） | 事件类型，如 `call` / `get` / `set` | `import_ruyitrace_log.js` 统计 `evt.t \|\| evt.type` |
| `api`（或 `name` / `path`） | 被访问的 DOM/JS API，如 `navigator.userAgent`、`XMLHttpRequest.send` | 统计 `evt.api \|\| evt.name \|\| evt.path` |
| `args` | 调用参数数组 | 定位参数生成：关注与目标参数值邻近的 `args` |
| `stack` | 调用栈帧数组 `{file,line,col}` | **核心定位依据** |

`stack.file:line:col` 是定位关键证据的唯一权威来源：先按 `api` / `args` 缩小范围，再用 `search_trace.js --url <stack.file>` 或 `--keyword` 拿到 `file:line:col`，最后按行号切源码片段（单行大 bundle 用 `search_js.js` 做字符偏移检索）。不要忽略 `stack` 而只凭 `api` 名猜文件。

## RuyiTrace 长字段截断保护

> 本段与 `references/workflow/trace-flow.md` 同名段保持同步，修改任一处需同步另一处。

RuyiTrace NDJSON 适合作为高保真环境访问日志，但长字符串字段可能因工具显示或记录限制被截断。典型风险是某个加密参数、长 token、长 Cookie、请求 body、dataURL 或大型对象序列化值真实长度为数万字符，但日志中只保留约 4000 字符。

硬性规则：

- 导入 NDJSON 时必须运行带截断检测的脚本，默认阈值为 3900：

```bash
node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir <project-root> --truncation-threshold 3900 --markdown
```

- 任何字符串字段长度达到或接近阈值时，统一标记：
  - `truncationSuspected: true`
  - `visibleLength: <日志中可见长度>`
  - `minLength: <日志中可见长度>`
  - `actualLength: unknown`
- 不得写“该加密参数长度为 4000”。只能写“RuyiTrace 可见长度为 4000，疑似被截断，真实长度未知，至少 4000”。
- 不得把 RuyiTrace 中的长字段可见值直接作为 fixture 期望值或最终参数值。
- 如果该字段影响签名、指纹回放或最终请求验证，必须从以下来源补采完整值：
  1. HAR / cURL / Network 完整请求。
  2. ruyiPage `collect_bodies=True` 网络抓包。
  3. 专用 Hook 对 writer 或加密入口做分片落盘，并记录完整长度、SHA256、前后片段。
  4. 最终 Node.js signer 输出，并与浏览器样本的完整长度或 hash 对比。
- 写入 `notes/missing-env-priority.md`、阶段报告或最终总结时，必须区分“RuyiTrace 未截断可用值”“RuyiTrace 可见但疑似截断值”和“其他来源补采完整值”。
- 对 Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何、`navigator`、`screen`、`window`、`document` 等具体值：RuyiTrace 未截断值是优先来源；只要日志缺失、未覆盖或疑似截断，就改用已确认的 ruyiPage / 手动浏览器采样，并记录 `baselineId`、`capturedBy`、完整长度和 hash。不得把 AI 猜值、静态推断或 Node.js 模拟库结果写入最终 fixture。

摘要中出现 `## 长字段截断风险` 时，后续分析要先处理完整值补采问题，再判断参数长度、结构、hash、编码或是否可复现。

如果截断字段是指纹 / WebAPI 返回值，例如 dataURL、WebGL 参数、字体探测结果、DOM 序列化结果或 Audio buffer 摘要，不得把 trace 可见片段直接写入 `fingerprint.fixture.json` 的最终 `result`；必须使用同一 case 已确认取证工具补采完整值，或显式阻塞等待用户提供完整真实浏览器材料。

## 根据 RuyiTrace 日志补环境

日志导入后按以下顺序分析。选择 ruyiPage + RuyiTrace 的 case，必须先完成本节，再进入 Node.js 缺失环境追踪：

1. 统计 `api` 调用频率，优先处理高频或和目标参数生成邻近的 API。
2. 按 `stack.file / line / col` 聚合，定位具体 JS 文件和函数。
3. 分类到环境模块：
   - Navigator / Screen / Location / Storage。
   - Canvas / WebGL / Audio / WebRTC。
   - Crypto / Performance / Date / Random。
   - DOM / Element / CSS / Layout。
   - Worker / Service Worker / iframe。
4. 将日志结论写入：
   - `notes/ruyitrace-summary.md`
   - `notes/missing-env-priority.md`：必须包含命中的 `api`、`stack.file`、`line`、`col`、环境模块分类、补齐优先级，以及“RuyiTrace 证据 / Node trace 补充 / 推断”标记。
   - `notes/entry-chain.md`
5. 再进入 Node.js 缺失环境追踪和 fixtures 验证。

遇到环境错误时的处理顺序：

1. 先在 `notes/ruyitrace-summary.md` 中搜索缺失对象、方法或相关模块，例如 `navigator`、`document.cookie`、`localStorage`、`canvas`、`WebGL`、`performance`。
2. 摘要不足时，在原始 `case/ruyi-trace/logs/*.ndjson` 中按目标 JS 文件名、目标 API 关键词、调用栈行列号或时间窗口过滤。
3. 将命中的 `api`、`stack.file`、`line`、`col`、参数摘要写入 `notes/missing-env-priority.md`。
4. 再用 Node trace 复现缺失路径，确认哪些对象需要在 `env.js` 中固化；固化时要同时处理属性描述符、访问器、原型链、函数 / 访问器 / 实例对象 toString 保护。
5. 如果 RuyiTrace 没有相关证据，明确标记“RuyiTrace 未覆盖”，再使用 Proxy trace / Hook / 断点继续排查。
6. 交付前运行 `node scripts/check_fingerprint_fixture.js --case-dir <project-root> --require canvas,webgl,audio,dom --markdown`；并手动复核 NativeProtect 保护证据（涉及 `document.all` 时确认 HTMLDDA 近似处理）。

日志可能很大。大文件处理原则：

- 不把完整日志直接写入最终报告。
- 先导入并生成摘要。
- 必要时按行分块，优先分析和目标 API / 参数生成时间段相关的片段。
- 原始日志保存在 case 内，默认作为可复核证据保留到 CLEANUP，按 SKILL.md 第 11 节清理规则处理，不询问。
