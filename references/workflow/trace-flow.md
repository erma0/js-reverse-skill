# trace 流程：ruyipage 网络取证（Step 1）+ RuyiTrace 日志采集（Step 2）

> **触发条件**：执行 FORENSIC_CAPTURE → TRACE_CAPTURE 取证/采集时读。本文档是两步取证流程的展开，所有 case 一律走此路径。

## 总览

```
Step 1: ruyipage 网络取证（FORENSIC_CAPTURE）
  → 抓网络包（HAR）+ 下载 JS 文件 + Cookie + 指纹基线
  → 建立网站轮廓，识别反爬类型，定位加密参数

Step 2: RuyiTrace 日志采集（TRACE_CAPTURE）
  → 采集 NDJSON 运行时 DOM/JS API 调用日志
  → 环境指纹采集，调用链追踪，补环境证据
```

这两步是 ruyiTrace 官方提示词模板的标准流程，两者互补：
- ruyipage 提供网络包和 JS 文件（"网站轮廓"）
- RuyiTrace 提供运行时日志（"DOM/JS API 调用细节"）

## ruyipage 取证流程

### 启动硬约束

| 约束 | 要求 |
|---|---|
| 定制内核 | 必须显式使用已验证的 ruyiPage 定制 Firefox runtime；不得使用系统 Firefox fallback |
| 有头模式 | 必须 `headless(False)` 或等价有头模式；不要用 headless 做高风控取证 |
| 独立 Profile | 使用本 case 专用临时 `user_dir` / profile，不复用脏 profile |
| 智能指纹 | 默认调用 `opts.smart_fingerprint(require_country=None, base_dir=..., userdir=...)`；如果地理探测失败，要求安装 `requests` 或提供 `manual_geo`，不要静默跳过 |
| 仿真注入 | 如果 `smart_fingerprint()` 返回 `ctx`，创建页面后必须执行 `ctx.apply_emulation(page)` |
| 指纹一致性 | 第一次成功取证后写入 `case/notes/fingerprint-baseline.json` 和 `baselineId`；后续复用同一 `base_dir` / `userdir`，不要每次随机新指纹 |
| 拟人动作 | 设置 `set_human_algorithm("windmouse")` 或 `"bezier"`，优先使用拟人滚动 / 点击触发业务动作 |
| 取证时机 | `page.capture.start(...)` 必须在 `page.get(...)` 之前执行 |
| 自检 | 导航后检查 `navigator.webdriver`，期望为 `false`；若为 `true`，判定当前取证不合格 |
| 验收 | 目标接口必须捕获到非失败响应；对跨域接口不要把单独的 `OPTIONS` preflight 当作业务取证成功 |
| isTrusted | 点击、拖拽、鼠标、键盘、滚动优先使用原生 BiDi / human actions；确需 JS 构造事件时必须带 `ruyi: true` |

### 取证步骤

1. 检查 ruyiPage 包、`requests` 依赖和 Firefox runtime，并确认 runtime 是 ruyiPage 定制 Firefox。
   - 如果只检测到系统 Firefox fallback，立即暂停，不启动浏览器。
   - 如果已找到定制 Firefox 但不是默认解析路径，启动时必须显式指定 `browser_path` / `set_browser_path`。
   - 如果缺少 `requests`，必须安装依赖或让用户提供 `manual_geo`；不要静默跳过智能指纹。
2. 按启动硬约束启动 ruyipage；任一硬约束失败时，停止并报告，不要继续取证。
3. 确认是否需要登录；需要登录时让用户手动完成。
4. 使用有头模式打开页面。
5. 触发最少量必要业务动作。
6. 收集：
   - Network / cURL / HAR。
   - JS bundle / chunk / sourcemap URL。
   - Cookie、本地存储键名、请求头、响应状态。
   - source / entry / builder / writer 链路证据。
7. 单个取证动作完成并沉淀必要结论后，立即清理临时截图、失败下载、临时日志和无登录态 profile；登录态 profile 单独询问用户是否保留。

### 取证：首选通用脚本（不要手写）

直接运行 skill 通用脚本 `scripts/forensic_ruyipage.py`，它会自动满足下方所有硬约束，并用 `targets=True` 抓全部包（事后从 `steps` 过滤，避免漏掉 JS 文件）：

```bash
python scripts/forensic_ruyipage.py --url <目标页> --case-dir <project-root> --targets "pc_home_feed" --browser-path <定制Firefox> --markdown
# 取证入口在登录后 / 页面试业务前需预置会话：加 --cookie "a=1; b=2"（分号分隔，可多条，
#   缺省 domain 取 --url 主机，可用 --cookie-domain 显式指定）。注入发生在导航前，页面与抓包均携带该会话。
```

取证会自动保存入口页面 HTML 到 `case/forensic/document.html`（含 412/JS challenge 页内联脚本，是 acw_sc__v2 等 challenge cookie 的强制证据），无论是否指定 `--targets`。

预算与落盘细则（终态等待 `--wait 120` / `--manual-pause` / `--target-settle`、60 包/100MB 关联预算、body 单体 10MB、WASM 50MB、JSON 内联预览 1MB、四类落盘位置 target-hits/related-hits/bodies/wasm/js、`*_complete=false` 与 `saved_to` 语义）见 `scripts/README.md` 网络取证与日志采集一节；本节只保留流程与硬约束。

仅在复杂多步交互超出脚本参数（`--click` / `--scroll` / `--manual-pause`）能力时才手写，且必须：用 `targets=True` 抓全部包、`page.capture.wait(count=1)` 取单包、`page.capture.steps` 读全部包、`CapturePacket.to_dict()` 取响应体。详见 `references/tooling/ruyi-tooling.md` 的“逃生舱”小节。

只有当 `node scripts/check_external_tools.js --markdown --project-dir <project-root>` 显示"默认解析路径是否为定制 Firefox：是"时，才可直接 `FirefoxPage()` 或 `launch(headless=False)`。否则必须显式指定已验证的定制 Firefox 路径。

### 取证验收标准

- JD `pc_home_feed` 类接口：至少捕获到 URL 包含 `pc_home_feed` 的 2xx 响应，并能看到请求 URL 中的加密 / 风控参数，例如 `h5st`。
- 美团外卖 `shopList` 类跨域接口：必须区分 `OPTIONS` preflight 与真实业务请求；只有捕获到非 `OPTIONS` 的 2xx `shopList` 响应，才算取证成功。若返回登录 / Yoda / 401 风控信息，应按"需要登录 / 风控验证"流程暂停，不要宣称已绕过。
- 用户完成操作后直接关闭 ruyiPage 浏览器窗口，视为明确的手动结束抓包信号：脚本检测到浏览器断连后应立即收尾、分类并落盘已捕获数据，报告 `endReason=browser-closed`，不能把 WebSocket 断连本身判为取证失败，也不要强杀仍在收尾的脚本进程；等待 `FORENSIC DONE` 或最终 JSON / Markdown 输出。浏览器关闭只决定采集生命周期，不放宽上述接口验收：指定终态仍未捕获到非 `OPTIONS` 2xx 时，结果仍为 `NO_TARGET` / `PARTIAL`，Step 1 仍缺失。若进程被不可捕获的硬杀且只残留 `case/forensic/partial-steps.jsonl`，该文件仅是已抓包元数据兜底，说明正常收尾未完成，不能替代 `capture.json` 与完整 body 证据。
- 等待期间会增量预取 JS、目标和动态 API body，并在收尾阶段复用缓存；报告 `liveBodyPrefetch` 可审计断连前已保住的正文范围。Cookie 报告只保留名称、域、属性和长度摘要，禁止把完整会话值写入 JSON/Markdown。

## RuyiTrace 日志采集流程

取证来源需要 RuyiTrace 时，默认自动 trace（脚本自动启动 trace Firefox 捕获，不询问用户选择采集方式）；用户已提供 NDJSON 时直接导入，不重复采集。自动 trace 失败、需要登录/验证/权限交互时转手动 trace。

### 方式一：自动 trace

检测到 `RuyiTrace.exe`、定制内核 `firefox(.exe)` 和 `RUYI_DOMTRACE.txt` 完整后（新版 2.5+ 位于 `resources/kernel/`，旧版 1.x 位于 `firefox/`），可使用随包脚本自动启动 RuyiTrace 的 trace Firefox，并通过 `MOZ_DOM_TRACE` 环境变量写出 NDJSON：

```bash
node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir <project-root> --ruyitrace-home <RuyiTrace-dir> --dry-run --markdown
node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir <project-root> --ruyitrace-home <RuyiTrace-dir> --evidence-signal handshake --import-after --markdown
```

执行要求：

1. 自动创建或使用 `case/ruyi-trace/logs/` 作为日志目录，使用 `case/tmp/ruyitrace-profile/` 或临时 Profile。
2. 使用 RuyiTrace 随包 trace Firefox，而不是普通系统 Firefox、普通 Playwright 或 ruyiPage 的 Firefox runtime。
3. 设置 `MOZ_DOM_TRACE=1`、`MOZ_DOM_TRACE_FILE=<case trace file>`、`MOZ_DOM_TRACE_LIMIT=<limit>` 和 `MOZ_DISABLE_LAUNCHER_PROCESS=1`。
4. 打开目标页面后触发最少量必要业务动作；如果需要登录、验证码、MFA、设备验证或权限确认，暂停让用户在该 trace Firefox 中手动完成，再继续采集。
5. 自动 trace 结束后，立即运行 `import_ruyitrace_log.js` 导入日志、生成 `notes/ruyitrace-summary.md`，并检查长字段截断风险。
6. 如果自动 trace 没有生成 NDJSON，先记录失败原因和已执行命令，再转手动 trace（方式二）；不要把"没有日志"误写成目标没有环境访问。

自动 trace 成功后继续：

```bash
node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir <project-root> --truncation-threshold 3900 --markdown
```

### Trace 质量判定与重试

> **触发条件**：TRACE_CAPTURE 采集到 NDJSON 并导入生成 `notes/ruyitrace-summary.md` 后立即读。本节合并了原先散落在采集流程、RuyiTrace 优先诊断原则、验证码覆盖三处的质量规则，统一判定标准与处理顺序，消除「生成了但质量不足」的规则盲区。

采集到 NDJSON ≠ 质量达标。导入后必须先按质量标准判定，未达标不得推进 `CASE_LOOKUP`。

#### TRACE_CAPTURE 出口门禁复检（不可跳过，先于质量判定）

进入 CASE_LOOKUP 前必须复跑出口门禁脚本，确认 Step 2（RuyiTrace NDJSON）真实产出。这是状态机内复检，防止 AI 声明「已采集 trace」但实际跳过 RuyiTrace 直接转静态分析 / EXTERNAL_LOOKUP 拼凑方案：

```powershell
node scripts/check_trace_gate.js --case-dir <project-root> --url <target-url> --require-trace-signal <环境API/写入点> --markdown
```

退出码 0（Step 2 已具备：NDJSON 存在 + 关联目标域；如要求 writer/API 信号则本次全部有效进程文件聚合后命中）才可进入 CASE_LOOKUP；退出码 1 时区分两类：无有效 NDJSON = Step 2 缺失，停在 TRACE_CAPTURE；NDJSON 存在但 writer/API 未命中 = Step 2 已具备、目标链路覆盖不足，停在 TRACE_RETRY。两类都不得进入 CASE_LOOKUP / EXTERNAL_LOOKUP，不得以边界声明或 mock 替代。FORENSIC_CAPTURE → TRACE_CAPTURE 路径同样适用：FORENSIC_CAPTURE 补采后必须通过出口门禁才进 CASE_LOOKUP。STEP2_ONLY 路径（用户已提供 NDJSON）同样需要按是否要求 trace 信号判断覆盖。

本脚本同时报告 Step 2 是否真产出（`step2.evidence`）和目标链路是否覆盖（`step2.targetCoverage`）；产出后的栈/API 整体质量是否达标见下方「质量判定标准」。三件事不混淆：Step 2 未产出 = 停在 TRACE_CAPTURE；NDJSON 已产出但 writer 未命中 = 不得说“没有 trace”，停在 TRACE_RETRY；writer 命中但整体质量不足 = 仍进 TRACE_RETRY。`evidence-signal` 只影响证据门禁，`end-signal` 只影响自动采集生命周期；不传 `end-signal` 时不得因证据信号命中而提前关闭。

#### 质量判定标准

| 等级 | 判定信号（来自 `ruyitrace-summary.md`） | 处理 |
|---|---|---|
| 重度不足 | 摘要输出「未发现 stack.file」/ 成功解析极低（建议 < 10 条）/ topApis 找不到目标参数 writer 附近调用 / **质量判定输出「未覆盖页面 JS」**（stack.file 无任何 http/https 页面脚本，全为浏览器内核 resource:// / file:// / self-hosted 路径，疑似只采到 parent 内核进程）/ **有效 API 调用占比过低（api 字段几乎全空）** | 必须进入 TRACE_RETRY，不得推进 |
| 轻度不足 | 有栈但覆盖不全 / 截断风险表非空 | 可进入 CASE_LOOKUP，但须在分析时降级补充 |

阈值用建议值，AI 可按目标站点复杂度自主判断上调或下调，但「无 stack.file」是硬性重度不足信号，不得自行放宽。

> **多进程与跨域 trace 合并**：RuyiTrace 一次采集会按进程写多个 `domtrace/trace_process_<pid>.ndjson`——`process_type` 为 `tab`/`content` 的内容进程才是业务 JS，`parent` 是浏览器父进程/内核活动（`resource://gre/modules/*`、`builtin-addons/*` 等，不含页面 JS，参与 trace-signal 必然误报）。`capture_ruyitrace_log.js` 会把所有非 parent 的 domtrace 文件合并导入，`ruyitrace-summary.md` 反映合并全量；手动导入多文件用 `import_ruyitrace_log.js --input a --input b ...` 合并统计。只取单个进程文件（尤其 mtime 最新的那个）会漏掉真正的业务 JS 调用，把有效 trace 误判为空。验证码/支付 SDK 常运行在第三方 iframe：日志未出现业务站点 hostname，但明确的 writer/API 信号在有效内容进程中全部命中时，仍可确认 Step 2；没有明确信号时不得用任意跨域日志替代目标证据。

#### TRACE_RETRY 处理顺序（按序降级，不回退）

1. **查失败原因**：`--duration` 不够 / 未触发目标业务动作 / 需要登录或验证码 / trace Firefox 配置异常（`MOZ_DOM_TRACE` 未生效、用错内核等）。
2. **自动 trace 重试一次**：修正参数后重跑 `capture_ruyitrace_log.js`。
3. **转手动 trace**：让用户在 trace Firefox 里操作触发目标参数生成路径（见下方方式二）。
4. **降级补充**：用 `run_with_trace.js`、Proxy trace、Hook 或断点补充。仅当 NDJSON 缺失/未覆盖当前路径/结论不足时使用，不得把降级补充当作首轮手段。验证码/重度混淆场景推荐「拦截 JS 响应注入日志」：在 ruyipage 里拦截目标 SDK 的 JS 响应，往加密入口附近注入 `window.__log = <明文/key/密文中间值>`，拿到真实明文+密钥+密文后与本地实现逐字段 diff——这比盲试 RSA 字节序/编码/填充快得多，是定位「算法对了但服务端不认」的最直接手段（见 `references/captcha/captcha-motion-encryption.md` 加密入口定位）。
5. **全部失败**：走 `FORENSIC_CAPTURE` 已有证据继续，但必须在 `最终项目总结.md` 声明 trace 未覆盖及已尝试手段。

#### 与现有规则的对应关系（避免重复执行）

- 「自动 trace 没有生成 NDJSON」（采集流程第 6 条）= **采集失败**，直接转方式二手动 trace，不进 TRACE_RETRY 质量判定。
- 「日志结论不足用 run_with_trace/Hook 补充」（RuyiTrace 优先诊断原则第 5 条）= TRACE_RETRY 第 4 步降级补充。
- 「验证码场景只覆盖页面加载需重新采集」（验证码覆盖节末尾）= 重度不足的特化判定，走 TRACE_RETRY 重试。

### 方式二：手动 trace（用户指定日志）

适用场景：自动 trace 启动失败 / trace Firefox 无法写日志 / 需登录验证等复杂交互时转手动（不询问用户选择采集方式）；用户已提供 NDJSON 时直接导入。质量不足（日志生成了但未覆盖目标参数生成路径）的处理见上方「Trace 质量判定与重试」TRACE_RETRY 第 3 步。

手动流程：

1. 打开 `RuyiTrace.exe`。
2. 填写启动页面。
3. 选择日志目录，建议选择当前 case 的 `ruyi-trace/logs/` 或用户指定目录。
4. 点击"开始采集"。
5. 在浏览器中正常浏览并触发目标指纹 / 加密参数生成逻辑。
6. 点击"停止采集"。
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

## RuyiTrace 长字段截断保护

> 本段与 `references/tooling/ruyi-tooling.md` 同名段保持同步，修改任一处需同步另一处。

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
- 不得写"该加密参数长度为 4000"。只能写"RuyiTrace 可见长度为 4000，疑似被截断，真实长度未知，至少 4000"。
- 不得把 RuyiTrace 中的长字段可见值直接作为 fixture 期望值或最终参数值。
- 如果该字段影响签名、指纹回放或最终请求验证，必须从以下来源补采完整值：
  1. HAR / cURL / Network 完整请求。
  2. ruyiPage `collect_bodies=True` 网络抓包。
  3. 专用 Hook 对 writer 或加密入口做分片落盘，并记录完整长度、SHA256、前后片段。
  4. 最终 Node.js signer 输出，并与浏览器样本的完整长度或 hash 对比。
- 写入 `notes/missing-env-priority.md`、阶段报告或最终总结时，必须区分"RuyiTrace 未截断可用值""RuyiTrace 可见但疑似截断值"和"其他来源补采完整值"。
- 对 Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何、`navigator`、`screen`、`window`、`document` 等具体值：RuyiTrace 未截断值是优先来源；只要日志缺失、未覆盖或疑似截断，就改用已确认的 ruyiPage / 手动浏览器采样，并记录 `baselineId`、`capturedBy`、完整长度和 hash。不得把 AI 猜值、静态推断或 Node.js 模拟库结果写入最终 fixture。

摘要中出现 `## 长字段截断风险` 时，后续分析要先处理完整值补采问题，再判断参数长度、结构、hash、编码或是否可复现。

## 根据 RuyiTrace 日志逆向分析（TRACE_ANALYZE）

日志导入后按以下顺序分析。所有 case 必须先完成 Step 1（ruyipage 网络包）+ Step 2（RuyiTrace NDJSON），再进入 Node.js 缺失环境追踪：

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
   - `notes/missing-env-priority.md`：必须包含命中的 `api`、`stack.file`、`line`、`col`、环境模块分类、补齐优先级，以及"RuyiTrace 证据 / Node trace 补充 / 推断"标记。
   - `notes/entry-chain.md`
5. 再进入 Node.js 缺失环境追踪和 fixtures 验证。

遇到环境错误时的处理顺序：

1. 先在 `notes/ruyitrace-summary.md` 中搜索缺失对象、方法或相关模块，例如 `navigator`、`document.cookie`、`localStorage`、`canvas`、`WebGL`、`performance`。
2. 摘要不足时，在原始 `case/ruyi-trace/logs/*.ndjson` 中按目标 JS 文件名、目标 API 关键词、调用栈行列号或时间窗口过滤。
3. 将命中的 `api`、`stack.file`、`line`、`col`、参数摘要写入 `notes/missing-env-priority.md`。
4. 再用 Node trace 复现缺失路径，确认哪些对象需要在 `env.js` 中固化；固化时要同时处理属性描述符、访问器、原型链、函数 / 访问器 / 实例对象 toString 保护。
5. 如果 RuyiTrace 没有相关证据，明确标记"RuyiTrace 未覆盖"，再使用 Proxy trace / Hook / 断点继续排查。
6. 交付前运行 `node scripts/check_fingerprint_fixture.js --case-dir <project-root> --require canvas,webgl,audio,dom --markdown`；并手动复核 NativeProtect 保护证据（涉及 `document.all` 时确认 HTMLDDA 近似处理）。

日志可能很大。大文件处理原则：

- 不把完整日志直接写入最终报告。
- 先导入并生成摘要（`import_ruyitrace_log.js` 已流式读取，不会 OOM）。
- 单次会话可能产生数百 MB，**按 5-10 万行一段分批投喂分析**，防止一次性贴入撑爆上下文；优先分析和目标 API / 参数生成时间段相关的片段（先 `search_trace.js --url/--keyword` 定位到相关行段，只读那段）。
- 采集时可用 `--limit` 限制单进程行数、`--ptype` 只保留关心的进程类型，从源头缩小日志。
- 原始日志保存在 case 内，任务结束前询问是否保留。

## RuyiTrace 优先诊断原则

> RuyiTrace NDJSON 不是可选参考，而是逆向分析的优先证据源。必须先完成 Step 1（ruyipage 网络取证）拿到 JS 文件和网络包，再进行 Step 2（RuyiTrace 日志采集）。
>
> **Step 2 不可跳过的硬约束**：本 skill 以 RuyiTrace NDJSON 为主要证据进行分析。用户提供 cURL/HAR/JS 文件只能跳过 Step 1 网络取证，**Step 2 RuyiTrace 日志采集仍必须完成**。例外共两类（对应 SKILL.md 状态机节点）：① 用户提供真实存在的 RuyiTrace NDJSON 日志（STEP2_ONLY）；② RuyiTrace 工具不可用且 `install_all.js` 自动安装失败、用户材料经 `check_evidence.js` 校验通过（MATERIALS_FALLBACK，见 decision-tree.md 阻塞点#5）——该路径必须在经验沉淀与最终总结写明取证偏差，REAL_VERIFY 不可豁免。仅提供 URL 时两步全做，禁止以"用户提供了证据"为由跳过 trace。任何"跳过取证 / 已具备证据"判定必须先运行 `node scripts/check_evidence.js --case-dir <project-root> --url <目标URL> --inputs <用户材料> --markdown`，以脚本输出为准。

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

## trace 覆盖矩阵（8 种 API 状态）

有 Trace 时硬性要求，详见 `references/quality/trace-api-coverage.md`：

| API 状态 | 含义 | 处理 |
|---|---|---|
| 0. 未命中 | Trace 未覆盖 | Node trace 补充 |
| 1. 命中无值 | Trace 命中但未采集值 | 补采 |
| 2. 命中截断 | 值疑似截断 | 补采完整值 |
| 3. 命中完整 | 值完整可用 | 直接用 |
| 4. 命中但 Node 缺失 | Trace 有但 Node 没有 | 补环境 |
| 5. 命中但值不一致 | Trace 值与 Node 不一致 | 修正 Node 值 |
| 6. 命中但 API 缺失 | Trace 命中但 API 不存在 | 实现 API |
| 7. 命中但 API 行为不一致 | API 存在但行为不同 | 修正 API 行为 |

## Replay Trace 对比方法论

在补环境完成后，用无浏览器 JS 引擎执行补环境脚本，生成 replay trace，与浏览器基准 trace 做**逐 API 调用顺序对比**。这是比指纹 fixture 值对比更底层的验证方式——不仅对比值，还对比调用时机和顺序。

### 对比流程

```
浏览器 trace（真环境）
  │
  ├─ 采集 replay 值 + 调用顺序
  │   → traceOut/replay/trace_replay_process_.jsonl
  │
JS 引擎 trace（补环境）
  │
  ├─ Node.js vm 沙箱执行补环境脚本
  │   → 记录 replayValue.api 和调用堆栈
  │
对拍
  │
  ├─ 按 api 名对齐两个 trace 的调用序列
  ├─ 对比每个 api 的返回值
  ├─ 标记差异：值不一致 / 调用顺序不同 / 缺失调用
  │
修复
  │
  ├─ 缺什么 → 从浏览器 trace 取真实值补到补环境
  ├─ 值不一致 → 修正补环境模拟逻辑
  ├─ 调用顺序不同 → 修正初始化时序
  │
复验 → 重新对拍直到一致
```

### 对比维度

| 维度 | 检查内容 | 一致性要求 |
|---|---|---|
| 值一致性 | 同一 api 在两端的返回值 | 严格相等（字符串/数字/布尔）或结构一致（对象/数组） |
| 调用顺序 | api 被调用的先后次序 | 顺序一致（工具链差异导致的无关调用可忽略） |
| 调用次数 | 同一 api 的总调用次数 | 次数一致（多环境预读导致的差异需分析和标注） |
| 缺失项 | 浏览器有但补环境没有的 api | 补全或确认不需要后标注"非关键" |
| 多余项 | 补环境有但浏览器没有的 api | 确认是补环境自身调用后标注"休泄漏" |

### 与本 skill 工具链的映射

- **浏览器 trace**：RuyiTrace NDJSON
- **JS 引擎 trace**：`scripts/run_with_trace.js`（vm 探测模式，输出 env-trace.jsonl）
- **对比脚本**：`scripts/compare_fixture.js`（值对比）+ 手动对比调用顺序
- **指纹 fixture**：`scripts/check_fingerprint_fixture.js`（指纹值对比的补充层）

### 注意事项

- standalone 引擎（SpiderMonkey 等）没有 DOM，canvas/navigator/crypto/WebGL 等需要补环境层模拟，真实值来源以浏览器 trace 为准
- Node.js vm 沙箱有宿主泄漏风险（Node 21+ navigator 等），见 `references/network/node-leakage.md`
- 不要追求 100% 调用顺序对齐——浏览器自身预读、优化、事件队列可能导致少量无关差异
- 聚焦于签名计算链路上的 api 调用，非关键路径的差异可标注后跳过

## 验证码场景的 RuyiTrace 覆盖

如果目标是验证码 / 风控验证 / challenge / WAF 接口，RuyiTrace 自动捕获或手动捕获都必须覆盖完整链路：触发验证码、验证码组件初始化、用户交互事件、加密参数生成、verify / validate / challenge 接口发起、结果回调。

验证码/JSONP 的最小可审计链路为：`callback 注册 → script.src/请求参数构造 → script 插入或等价网络写入 → load/verify 请求 → callback 执行 → 结果回调`。仅命中 `createElement`、`appendChild` 或页面初始化 API 不算覆盖；若无法记录网络 writer，必须在总结中明确“trace 只覆盖环境读取，未证明请求写入”。

- 用户提供完整流程时，自动捕获脚本应按该流程执行；若流程需要人工识别、登录、验证码答案或权限交互，暂停让用户完成。
- 流程需要登录、验证码答案、人工识别或权限确认（AI 无法替代的物理交互）时，先启动 RuyiTrace 记录，再让用户操作；只有用户回复"已经完成触发到验证流程"后，才停止记录并导入 NDJSON。
- 如果 `notes/ruyitrace-summary.md` 只覆盖页面加载、没有交互事件或 verify 接口附近调用栈，属于重度质量不足，按上方「Trace 质量判定与重试」TRACE_RETRY 流程重新采集，不得直接进入补环境。
