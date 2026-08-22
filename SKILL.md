---
name: js-reverse-skill
description: >
  网页端 JavaScript 加密参数逆向与纯协议还原。逆向还原浏览器请求中加密参数、签名、token、
  cookie、设备指纹的生成逻辑；适用于各类动态参数的生成逻辑分析，覆盖标准算法、自定义混淆、
  obfuscator.io、JSVMP 黑盒补环境、WASM 加密、TLS 指纹模拟、Session 请求链、验证码 verify、
  反爬风控对抗等场景。覆盖桌面网页、移动 H5 与内置浏览器，交付 Node.js/Python 实现。
  不用于 App、小程序、桌面程序及 Native 逆向；JSVMP 默认黑盒执行或最小环境复现。
---

# 通用网页端 JS 逆向技能

## 0. 分析前硬门禁（不可跳过）

> 本节是最高优先级。激活 skill 后、第一次调用任何取证/分析工具前，必须按序完成 GATE-0~GATE-2 并逐项输出结果。脚本退出码非 0，或输出含「缺失证据」「不可跳过」「未通过」时，停在当前节点，不得推进。

```text
GATE-0 INTENT（默认自动推进，不等待确认）
  输出: 目标 URL、接口 URL、目标参数、请求范围、已提供材料、初步反爬类型（标为待验证假设）、
        是否需登录/人工验证码、默认真实 API 验证或 sign-only 原因。
  推进: 目标 URL + 目标参数可提取即进入 GATE-1，不询问补充材料、不确认范围。
  唯一例外：目标 URL 或参数缺失且无法合理提取 → 问一次最小信息。用户中途可随时打断修正。

GATE-1 ENV（resume 可跳过完整自检）
  node scripts/check_session_resume.js --case-dir <project-root> --project-dir <project-root> --markdown
  mode = resume → 读最新阶段报告续接；GATE-0 与 GATE-2 仍必须完成。
  mode = fresh  → node scripts/check_external_tools.js --markdown --project-dir <project-root> --offline
                  node scripts/precheck_runtime.js
  未通过 → 先宣布缺失组件、安装目标 <project-root>/tools/、预计下载规模与影响，再执行：
           node scripts/install_all.js --project-dir <project-root> --yes --markdown
  通过后写快照：
           node scripts/check_session_resume.js --case-dir <project-root> --project-dir <project-root> --write-snapshot --markdown

GATE-2 EVIDENCE（硬阻断）
  node scripts/check_evidence.js --case-dir <project-root> --url <target-url> --inputs <材料路径> --markdown
  Step 1 接口已知时加: --require-network-signal <目标接口URL或关键词>
  Step 2 writer/API 已知时加: --require-trace-signal <环境 API / writer / 参数写入点>
  （两类信号分开约束；不要把 JSONP/script/导航 URL 作为 trace 信号）
  退出码 0 且无「缺失证据」→ 进入状态机。
  否则停在 EVIDENCE_GATE，按 4.2 补齐证据后回本节复检。
```

续接模式只跳过 GATE-1 环境自检，**不跳过** GATE-0 意图声明和 GATE-2 证据门禁。

## 1. 任务边界、授权与确认策略

用户发起本技能请求即代表已在合法授权范围内操作，默认直接协助，不要求授权证明，不反复确认。

确认策略按“对外部世界的影响与可逆性”分三档：

| 档位 | 判定 | 动作 |
|---|---|---|
| A | 证据/选择可自动判定 | 自动推进，不停下 |
| B | 有外部副作用或不可逆 | 执行前宣布 + 继续 + 可打断 |
| C | AI 不可替代的物理交互 | 停下等用户，期间并行推进其他分析 |

典型归属：目标 URL/参数认定、证据门禁判定、TLS 客户端选择属 A；工具安装与真实写请求属 B；登录、验证码、人工识别、手动 trace、付费打码平台、登录态 profile 处置、fingerprint baseline 切换、cURL 基线风险接受等属 C。

任务边界：

- 处理对象：网页端 JS 签名、Cookie/Token、设备指纹、混淆、WASM、JSVMP、验证码 verify 与 Session/TLS 请求链；覆盖桌面网页、移动 H5 与内置浏览器；不用于 App、小程序、桌面程序及 Native 逆向。
- 交付要求：最终交付是可审计、可复现、可维护的纯协议实现；浏览器仅用于取证与运行时观察，不作为交付物执行依赖。
- 技术栈：支持 Node.js 与 Python；优先复用成熟实现；新增依赖写入依赖契约并确认来源和版本。

## 2. 绝对规则

1. 所有关键结论必须有本次任务证据：RuyiTrace NDJSON、网络请求记录、落盘 JS、调用栈、运行时变量、中间值对比或用户提供的真实材料。
2. 历史案例只能作为假设和路径提示，不能替代本次证据；与本次 trace 冲突时以本次 trace 为准。
3. 默认先定位请求链，再确定还原方式。不得先凭参数名猜算法、补环境或写最终代码；未过 GATE-2 就分析参数或猜算法 = 违反本条，视为任务失败。
4. JSVMP 默认黑盒执行或最小环境复现，不反编译字节码源码。
5. 最终交付必须能在无浏览器、无显示器、无 X11 的环境中独立运行。
6. 默认完成真实 API 验证；只有用户明确要求“只输出参数”“不发真实请求”时才允许 sign-only 模式。
7. 不记录、提交或硬编码用户密钥、完整登录 Cookie、Authorization、验证码答案或其他秘密材料。
8. 取证只允许三个来源：① ruyipage 定制 Firefox（经 `scripts/forensic_ruyipage.py`）② RuyiTrace（经 `scripts/capture_ruyitrace_log.js`）③ 用户手动提供材料。任何阶段不得手写 fetch/curl/requests 抓取目标页面或下载目标 JS，不得使用系统 Chrome/Edge/Firefox、Playwright/Puppeteer/Selenium 或浏览器 MCP 取证。

## 3. 纯协议红线

- 不交付 Playwright、Puppeteer、Selenium、浏览器扩展、浏览器 MCP 或 ruyipage/RuyiTrace 自动化代码。
- 不以自动化浏览器完成反爬挑战，不把浏览器抓到的关键 Cookie 作为固定常量。
- 不把目标网页作为最终签名服务，不通过打开网页、执行页面脚本或读取浏览器状态生成参数。
- 允许取证阶段使用 ruyipage 定制 Firefox 和 RuyiTrace；允许把取证得到的算法、静态资源、必要 fixture 转化为纯协议实现。
- 交付入口必须是 Node.js `final.js` 或 Python `final.py`，运行时只使用 HTTP、TLS、密码学、序列化和必要的最小 JS 沙箱能力。
- 交付物不得依赖 skill 仓库路径、临时脚本、系统浏览器 profile 或用户机器上的登录态。
- 关键 Cookie 必须区分静态配置、运行时生成值、服务端下发值和会话绑定值；禁止把成功样本中的动态秘密直接复制进代码。

判定标准：删除浏览器和显示环境后，交付程序仍能独立生成请求并得到预期响应。

## 4. 唯一启动状态机与执行主线

状态转换是唯一准入规则，旧版编号清单不得并行执行。

```text
INTENT_CONFIRM
  ├─ 范围明确 → ENV_READY
  └─ 缺少信息 → WAIT_USER
ENV_READY
  ├─ 环境正常 → EVIDENCE_GATE
  └─ 环境缺失 → ENV_READY
EVIDENCE_GATE
  ├─ Step 1 与 Step 2 均具备 → CASE_LOOKUP
  ├─ 只有 Step 1 → TRACE_CAPTURE
  ├─ 只有 Step 2 → STEP2_ONLY
  └─ 两步均缺失 → FORENSIC_CAPTURE
STEP2_ONLY → CASE_LOOKUP
FORENSIC_CAPTURE → TRACE_CAPTURE
TRACE_CAPTURE
  ├─ 采集成功 + 质量达标 + 出口门禁复检通过 → CASE_LOOKUP
  ├─ 质量不足 → TRACE_RETRY
  └─ 采集失败 → 转手动 trace
TRACE_RETRY
  ├─ 重试达标 + 出口门禁复检通过 → CASE_LOOKUP
  ├─ 仍不足 → 降级补充，标 trace 未覆盖
  └─ 全部失败 → 用 FORENSIC_CAPTURE 证据继续 + 总结声明 trace 缺失
CASE_LOOKUP
  ├─ 本地命中且时效校验通过 → IDENTIFY
  └─ 本地未命中 → EXTERNAL_LOOKUP
EXTERNAL_LOOKUP
  ├─ 搜到方案且算法可读 → IMPLEMENT
  └─ 搜不到或黑盒 → FORENSIC_CAPTURE
IDENTIFY → TRACE_ANALYZE → IMPLEMENT
IMPLEMENT → REAL_VERIFY
REAL_VERIFY
  ├─ 默认真实验证通过 → DELIVER
  ├─ 失败 + 已有 trace → DIAGNOSE → IMPLEMENT
  ├─ 失败 + 无 trace → FORENSIC_CAPTURE
  └─ sign-only → SIGN_ONLY_DELIVER
DELIVER / SIGN_ONLY_DELIVER → CLEANUP → DONE
```

**TRACE_CAPTURE / TRACE_RETRY 出口门禁（不可跳过）**：进入 CASE_LOOKUP 前必须复跑出口门禁脚本，确认 Step 2（RuyiTrace NDJSON）真实产出：

```powershell
node scripts/check_trace_gate.js --case-dir <project-root> --url <target-url> --require-trace-signal <环境API/写入点> --markdown
```

退出码 0（Step 2 已具备且目标 writer 覆盖满足）才可进入 CASE_LOOKUP；NDJSON 已产出但 writer 信号未命中时，状态是“Step 2 已具备、目标链路覆盖不足”，进入 TRACE_RETRY，不得写成“没有 trace”。详见 4.2 节「TRACE_CAPTURE 出口门禁复检」。

激活后立即建立以下 11 项 TODO 并随状态推进勾选：

1. INTENT_CONFIRM
2. ENV_READY（续接模式直接勾掉）
3. EVIDENCE_GATE
4. FORENSIC_CAPTURE / TRACE_CAPTURE
5. CASE_LOOKUP（本地 search_cases + EXTERNAL_LOOKUP）
6. IDENTIFY
7. TRACE_ANALYZE
8. IMPLEMENT
9. REAL_VERIFY（含 DIAGNOSE）
10. DELIVER / SIGN_ONLY_DELIVER
11. CLEANUP

每进入一个状态立即勾选对应项；回退时把对应项重新置为进行中，不新建子任务。

### 4.1 路径、意图与环境

`<project-root>` 指项目根目录，其下平级包含 `case/` 与 `result/`。所有脚本的 `--case-dir` 统一传 `<project-root>`；`scripts/lib/paths.js` 已兼容 `<project-root>` 与 `<project-root>/case`。环境检测类脚本用 `--project-dir <project-root>` 指定 tools/ 所在工程根。多 case 项目共享 tools（`<project-root>/tools/` 与各 `<case-name>/` 平级）时，`--project-dir`/`--case-dir` 传 case 目录或共享工程根均可：脚本会自动向上查找含 `tools/` 的祖先目录，避免把已装在共享工程根的 RuyiTrace/ruyipage runtime 误判缺失或重复下载。

从请求中提取目标 URL、接口 URL、目标参数、请求方法、范围和项目根目录。目标 URL + 目标参数可确定即直接推进；仅两者缺一且无法合理提取时才问一次最小信息。若实现需要额外动态参数，列出参数名、位置、用途假设和证据后纳入请求链范围。

用户说明重装 Node、替换 Firefox、迁移 tools 目录或升级 ruyipage/RuyiTrace 时，重新执行完整环境检查，不得沿用旧快照。

环境检查与快照写入按第 0 节 GATE-1 执行。不得因已有阶段报告或 `result/` 跳过环境快照写入或证据核验。

### 4.2 取证与证据门禁

EVIDENCE_GATE 运行：

```powershell
node scripts/check_evidence.js --case-dir <project-root> --url <target-url> --inputs <材料路径> --markdown
```

URL 不是证据。脚本确认文件真实存在并可归类，才允许跳过对应步骤。退出码非 0 或输出含「缺失证据」「不可跳过」时，停在 EVIDENCE_GATE 补证并复检，禁止进入 IDENTIFY/TRACE_ANALYZE/IMPLEMENT。

- Step 1：有效 `capture.json` 网络记录，或通过内容校验的 HAR、cURL、原始 HTTP 请求文本；目标接口已知时用 `--require-network-signal <目标接口URL或关键词>` 约束 capture/用户材料。
- Step 2：内容可解析、记录非空且关联目标域的 RuyiTrace NDJSON/JSONL；`ruyitrace-summary.md` 不能替代 NDJSON。Step2-only 时先导入并生成摘要，再结合日志定位，不重复采集 trace，也不因缺少 Step 1 强制网络取证。
- 单独 JS、截图或指纹基线只作辅助材料，不计为 Step 1。

网络取证：

```powershell
# 已知目标接口时必须加 --targets；它表示本次流程的终态接口（如最终登录/业务提交接口），
# 任一目标 URL 的非 OPTIONS 2xx 响应命中后进入短暂收尾窗口并结束取证。
# 抓包从页面打开前覆盖到终态：capture.json 保存全量请求元数据；终态之前最近的 API/JSON、
# 验证码/风控资源与 WASM 等动态材料会受 60 包/100MB 默认预算限制自动关联；普通 body 默认单体完整保存上限 10MB，WASM 默认 50MB。
# JSON 只内联/预览 1MB；超过该预览阈值的完整 body 写入 case/forensic/bodies/，WASM 写入 case/forensic/wasm/，不会把不可解析的半包当作完整证据。
# 因此不要求用户预先知道或列全验证码 load/verify 等中间接口。
# 注意：capture.json 是纯请求元数据（不存响应体），响应体按用途落盘到四类位置：
#   ① target-hits.json / related-hits.json（元数据、小 body 或预览）
#   ② case/forensic/bodies/（大 body 完整文件）③ case/forensic/wasm/（完整 WASM）④ case/js/original/（JS 资源）。
# 自动筛选不等于保存所有响应体：大页面不会逐包拉 body；图片/字体/视频等非动态静态资源仍不自动保存。
# 首次终态等待默认 --wait 120，登录场景可加 --manual-pause 暂停等待（AI 后台运行遇非交互 stdin 时自动退化为等待 --wait，不阻塞）；窗口不够可调大 --wait。终态命中后另完整执行 --target-settle，不占用 --wait 余额。
python scripts/forensic_ruyipage.py --url <target-url> --case-dir <project-root> --targets <最终业务接口关键词> --markdown
```

取证会自动保存入口页面 HTML 到 `case/forensic/document.html`（含 412/JS challenge 页内联脚本，是 acw_sc__v2 等 challenge cookie 的强制证据），无论是否指定 `--targets`。

终态目标请求未命中 = Step 1 缺失，禁止转源码搜索继续。指定 `--targets/--targets-regex` 时只按 URL 匹配；多个目标表示替代终态，任一目标捕获到非 OPTIONS 2xx 响应即 `PASS` 并退出码 0。命中后默认继续抓取 3 秒，随后保存全量元数据、终态 body、关联动态 body 与 JS。这里的 HTTP 2xx 只表示目标请求已取证，不表示响应体中的业务结果成功；通用脚本无法猜测各站点业务码。若一次登录可能因验证码或业务校验失败而重新提交，应调大 `--target-settle`，保证额外重试仍在同一会话内被捕获；关联材料以最后一次已捕获的有效终态向前回溯。body 若超过 JSON 内联预览阈值，必须读取对应 `saved_to` 完整文件；若报告 `*_complete=false`，说明受单体上限或总预算影响，不能拿预览替代原始证据。只出现 OPTIONS/非 2xx 报告 `PARTIAL`，完全未命中报告 `NO_TARGET`，两者均退出码非 0。验证码是最终业务接口的前置链路时，用户只提供最终接口；分析阶段从同一会话的 `related-hits.json`、`capture.json` 与完整 body/WASM 文件、RuyiTrace 向前回溯 load → verify，不把验证码中间接口当成额外终态门禁。若需用户交互，提示用户在窗口完成操作，或请其提供 cURL/HAR/原始请求文本；终态命中并落盘后再回 EVIDENCE_GATE。JS 源码关键词定位只能作辅助假设。

Windows 下若 Python 脚本输出仍现编码异常，用 `PYTHONUTF8=1` 前缀兜底（PowerShell：`$env:PYTHONUTF8="1"`）；仓库脚本已内置 UTF-8 强制与 emoji 安全化，正常无需手动加。

日志采集：

```powershell
node scripts/capture_ruyitrace_log.js --url <target-url> --case-dir <project-root> --evidence-signal <环境API或签名写入点关键词> --end-signal <明确完成事件> --import-after --markdown
# --trace-signal / --evidence-signal 只匹配 RuyiTrace 记录的环境 API / 写入点（如 Headers.set(<参数>)、参数名、JSONP callback 注册），
# 不传目标接口 URL——trace 记录的是 API 调用，不记录请求 URL，传 URL 字面量必然未命中。
# 不得使用裸 createElement、appendChild、querySelector、JSON.stringify、Date.now 等泛化 API 作为 writer 信号；
# 它们只能证明页面运行过，不能证明目标参数写入请求。门禁脚本会拒绝这些信号。
# 也不传密钥/常量名（如 appSignKey、bl、secret）——trace 记录运行时值与写入点，不记录密钥字面量，
# 传密钥名必然未命中并误触发硬阻断；应选参数写入点/参数名（如 noncestr、x-zse-96、Headers.set(...)）。
# --end-signal 只控制自动采集何时提前关闭；不传时仅用户关闭或 duration 到期结束。
# evidence-signal 与 end-signal 不再混用；JSONP/验证码优先使用网络终态或 callback/参数写入的具体信号。
# 目标接口 URL 的命中证据由 Step 1 取证承担：forensic_ruyipage.py --targets <URL> + check_evidence.js --require-network-signal <URL>。
# --target-signal 仅为兼容旧调用，同时作为 evidence-signal 和 end-signal；新流程不要使用。
# --signal-policy advisory 可用于人工结束或信号尚未确定的采集：日志仍会导入并报告覆盖不足，不误报为“没有 trace”。
# 自动 trace 默认采集窗口 --duration 120 秒；达到 end-signal 时自动收尾并关闭浏览器；用户提前关闭也会记录 endReason。
# 窗口结束后仍需关闭进程、等待 NDJSON 完整刷盘并导入，命令总耗时可略超过 120 秒，但浏览器不应继续留存。
```

用户已提供 NDJSON 时用 `--input <ndjson>` 导入并生成摘要，不重复采集；多个进程日志用 `import_ruyitrace_log.js --input a --input b`，复制到 case 时会按来源摘要命名，避免同名文件覆盖。取证结果只进入 `case/`，原始 JS 放入 `case/js/original/`，临时材料放入 `case/tmp/`。

目标请求需手动触发时，必须提示用户在 trace 浏览器中完成操作；用户确认“已触发”前不得结束采集。不得把“没触发目标路径”当成“采集完成”。

**TRACE_CAPTURE 质量判定与 TRACE_RETRY**：采集到 NDJSON 不等于达标。摘要显示「未发现 stack.file」、成功解析极低、topApis 找不到目标参数 writer、质量判定「未覆盖页面 JS」（stack.file 全为浏览器内核路径，无 http/https 页面脚本）或「有效 API 调用占比过低」（api 字段几乎全空），均按重度不足处理并进入 TRACE_RETRY。RuyiTrace 一次采集按进程写多个 `domtrace/trace_process_<pid>.ndjson`，主日志须合并所有 tab/content 进程文件（排除 parent 内核进程），只取单个文件（尤其 mtime 最新的）会把有效 trace 误判为空。完整降级顺序与验证码特化判定见 `references/workflow/trace-flow.md`。

**TRACE_CAPTURE 出口门禁复检（不可跳过）**：采集声明完成、进入 CASE_LOOKUP 前必须复跑出口门禁脚本，确认 Step 2（RuyiTrace NDJSON）真实产出。这是状态机内复检，不是 GATE-2 入口门禁的重复——GATE-2 判定初始证据路由到 TRACE_CAPTURE，出口门禁确认 TRACE_CAPTURE 是否真把 Step 2 补上了：

```powershell
node scripts/check_trace_gate.js --case-dir <project-root> --url <target-url> --require-trace-signal <环境API/写入点> --markdown
```

退出码 0（Step 2 已具备且目标 writer 覆盖满足）才可进入 CASE_LOOKUP；NDJSON 已产出但 writer 信号未命中时，状态是“Step 2 已具备、目标链路覆盖不足”，进入 TRACE_RETRY，不得写成“没有 trace”。声明「已采集 trace」不等于 Step 2 已产出——AI 可能声明跑 RuyiTrace 但实际转去做静态分析 / EXTERNAL_LOOKUP，出口门禁用脚本退出码硬卡，防止「声明不执行」绕过 Step 2 直接拼凑交付。FORENSIC_CAPTURE → TRACE_CAPTURE 路径同样适用：FORENSIC_CAPTURE 补采后必须通过出口门禁才进 CASE_LOOKUP。STEP2_ONLY 路径（用户已提供 NDJSON）Step 2 本就具备，出口门禁直接通过。

`--trace-signal` 命中的是 trace 覆盖得到的「环境 API / 签名写入点」，不是网络请求 URL；网络 URL 使用 `--require-network-signal`，两者不可混用：

- 信号是环境 API（`fetch`、`XMLHttpRequest.send`、`handshake`、参数名等）未命中 → 目标路径未触发，是硬信号，进入 TRACE_RETRY，不得自行放宽。
- 目标是纯网络接口、trace 未覆盖 URL 字面量 → 属预期，不算采集失败，不要反复重试 trace；改用参数写入点（如 `Headers.set("x-zse-96", ...)`）或参数名定位签名链，并显式声明「trace 未覆盖目标接口 URL 字面量；签名链定位依据为 <写入点/关键词>」，写入 `notes/ruyitrace-summary.md`、阶段报告（如已启用）与最终总结；未声明不得进入 IMPLEMENT。目标接口 URL 的命中证据由 Step 1 取证承担（`forensic_ruyipage.py --targets` + `check_evidence.js --require-network-signal`）。

证据信号必须是具体 writer、参数名、callback 注册或带限定对象的 API。裸 `createElement`、`appendChild`、`querySelector`、`JSON.stringify`、`Date.now` 等泛化 API 不能作为目标链路覆盖证据，也不能作为自动结束条件；脚本会直接拒绝。证据信号与自动采集结束信号必须分离。

### 4.3 EXTERNAL_LOOKUP

本地 CASE_LOOKUP 未命中时，搜索网络已有方案作为假设来源，不替代本次证据。目标：目标域名 + 参数名 + “逆向/签名/加密”等关键词。

- 算法可读 → 方案作为假设进入 IMPLEMENT。
- 算法黑盒、来源不可信或搜不到 → 进入 FORENSIC_CAPTURE。

网络方案失败后不得反复试方案；验证失败且当前为轻量路径时，强制升级到 FORENSIC_CAPTURE。

**EXTERNAL_LOOKUP 豁免**：仅当本次取证已同时具备 Step 1 + Step 2，且 TRACE_ANALYZE 已定位 source/entry/builder/writer 时，可跳过 EXTERNAL_LOOKUP 直接 IMPLEMENT；需在状态行或阶段报告中显式声明「EXTERNAL_LOOKUP 豁免：Step1+Step2 齐备 + 链已定位」。仅凭「本地案例未命中」或「证据链看起来完整」不得跳过。CASE_LOOKUP 是必经节点：先 `search_cases` 查本地相似案例（同算法族/同参数名可复用方法论），未命中才考虑豁免；不得直接从 EVIDENCE_GATE 跨过 CASE_LOOKUP/EXTERNAL_LOOKUP 进 TRACE_ANALYZE。

### 4.4 状态记录与 IMPLEMENT 前置条件

每次状态转换必须输出一行状态行，格式固定为 `当前状态(证据状态) → 目标状态(关键结论)`，必须包含：
- 当前状态名与证据状态（Step1/Step2 齐备情况、trace 质量）
- 若跳过任何必经节点（CASE_LOOKUP / EXTERNAL_LOOKUP），必须显式写出豁免依据（如「EXTERNAL_LOOKUP 豁免：Step1+Step2 齐备 + TRACE_ANALYZE 已定位链」）
- 若 trace 未覆盖目标接口 URL 字面量，状态行需带「trace 定位依据：<写入点/关键词>」

示例：`TRACE_ANALYZE(Step1+Step2 齐备，noncestr 写入点命中) → IMPLEMENT`。关键结论随节点落盘，供压缩/续接使用：

```powershell
node scripts/write_stage_report.js --case-dir <project-root> --stage <阶段> --input <草稿.md> --markdown
```

输出到 `case/阶段报告/`。状态失败时停留在当前节点，不得把失败标记为通过。

**阶段报告默认不生成，仅在以下场景按需落盘**：多轮复杂补环境 / 跨会话续接风险、上下文防耗尽检查点触发、或用户明确要求。关键结论随节点落盘（IDENTIFY 结论、WASM 黑盒跑通、body 结构确认、实现方案选定等）不受默认省略限制，必须写入 `case/阶段报告/`；最小报告至少含当前状态、已证实事实、缺失证据、下一步输入。

**进入补环境前的证据前置（硬约束）**：走路径 B/C/D（最小 JS 沙箱、WASM、环境伪装）且需要提供或补齐浏览器对象时，必须先基于 RuyiTrace NDJSON 产出以下两份文件，禁止先根据 Node.js 报错盲补——盲补会导致十几轮「加载→崩→猜→再加载」的空转循环：
- `notes/entry-chain.md`：入口函数 → 请求链 → 关键 `stack.file:line:col`；其中 TRACE_ANALYZE 已定位的 builder/writer 即 IMPLEMENT 第一实现目标。
- `notes/missing-env-priority.md`：用 `scripts/analyze_trace.js --summary` 从 NDJSON 抽取的 SDK 实际读取环境清单（含 `api`、`stack.file`、`line`、`col`、环境模块、补齐优先级和「RuyiTrace 证据 / Node trace 补充 / 推断」标记）。黑盒执行无法逐项精确复现时，该文件至少列出已观测的环境读取/挂载点，并标注「黑盒执行，不逐项精确复现」；不得以黑盒为由跳过。
两文件缺一不得开始补环境；详见 `references/env/env-debug-loop.md` 的「RuyiTrace 优先诊断门禁」。

**上下文防耗尽检查点（硬约束）**：TRACE_ANALYZE / IMPLEMENT / REAL_VERIFY 任一阶段消耗大量步骤（20+ 步未推进）或上下文接近耗尽时，先回看上条两份文件是否已覆盖当前崩溃点：未覆盖先补全再继续；已覆盖仍打转时落阶段报告。判定标准：trace 已定位到关键资源/入口，或当前节点已消耗 20+ 步仍未推进（TRACE_ANALYZE 未进 IMPLEMENT、IMPLEMENT 黑盒调试打转、REAL_VERIFY 反复排查未定位根因）。

**IMPLEMENT 硬前置条件**：必须满足「trace 质量达标（含目标信号命中）」或「用户明确确认轻量路径」。两条均不满足时停在 TRACE_ANALYZE，不得以 mock、猜测或实验性实现替代证据。EXTERNAL_LOOKUP 的假设若与本次 trace 定位的 builder/writer 冲突，以 trace 为准，禁止先去测未被 trace 证明的 SDK 导出接口。**Step 2 缺失（check_trace_gate.js 退出码 1）时不得进入 IMPLEMENT**：不得以 EXTERNAL_LOOKUP 网络方案、边界声明、同族算法替代或 mock 填补 Step 2 证据缺口；轻量路径豁免的前提是 Step 1 + Step 2 齐备（见 4.3），Step 2 未产出不构成豁免条件。

## 5. CASE_LOOKUP

不要扫描全部案例。按域名、参数名、SDK 名称、状态码和网络特征组合关键词：

```powershell
node scripts/search_cases.js <关键词...>
node scripts/search_cases.js --domain <域名> --signal <信号>
```

只读命中案例，提取可复用定位方法、已知坑点、验证日期。命中后做时效校验：JS URL/文件名/资源版本、sha256 或资源清单、参数名称/长度/写入位置/请求链均一致才复用算法；否则降级为方法论参考。未命中进入 EXTERNAL_LOOKUP。新经验写入本次 `result/`，不修改 skill 仓库的 `cases/`。

## 6. 范围与环境复核

案例证据显示目标接口、参数或运行环境与初始范围不一致时，回 INTENT_CONFIRM；工具环境变化时回 ENV_READY。未变化则直接进入 IDENTIFY。

## 7. IDENTIFY

先比较至少三组请求，把字段分为固定值、时间值、随机值、会话值、服务端下发值、加密值。对每个目标参数建立 `source → entry → builder → writer` 链。

| 信号 | 初始路径 |
|---|---|
| md5、sha、aes、hmac、SM2/SM4/SM3 | 定位入口后优先纯算法还原 |
| `_0x`、obfuscator.io、控制流平坦化 | AST 识别和最小化反混淆，再判断是否可纯算 |
| 200KB+、while-switch、dispatcher、字节码数组 | JSVMP 黑盒执行或最小环境复现，不反编译 |
| WebAssembly、wasm base64、webpack 内嵌 wasm | 先整包黑盒，不默认补完整浏览器、禁止先手撕字节码 |
| 412 循环、sdenv、挑战 Cookie | 先还原挑战链，再确认业务签名链 |
| webmssdk、byted_acrawler、bdms、a_bogus、X-Bogus、_signature | trace 定位环境读取和签名写入；注意 `byted_acrawler.sign` 多返回老版 `_signature`，`a_bogus`/`X-Bogus` 由 `bdms` 生成，两者不可混淆 |
| geetest、smcp、dx-captcha、TCaptcha、NECaptcha、AWSC | 按封装层、答案层、verify 链分别处理 |
| h5st、js_security_v3、JA3/JA4 | 先确认会话绑定和 TLS 指纹，再实现请求链 |

识别结果必须引用落盘资源、NDJSON 或网络包具体字段，不以站点名称直接定类。

验证码/JSONP 链路的最低证据要求：`callback 注册 → script.src/请求参数构造 → script 插入或等价网络写入 → load/verify 请求 → callback 执行 → 结果回调`。仅命中 `createElement`、`appendChild` 或页面初始化 API 不算 writer 覆盖；若 trace 只覆盖环境读取，必须在阶段报告和最终总结中明确未证明请求写入。

## 8. TRACE_ANALYZE

**先 trace、后读源码（硬约束）**：进入本节后先跑 `import_ruyitrace_log` 生成摘要，再用 `search_trace --url <target-signal>` 直接定位请求链和 `stack.file:line:col`，最后才按行号/字符偏移切源码片段。禁止在拿到 trace 前先读 8MB 大 bundle 手工猜 webpack module id 或写 probe1~N 静态解析——那会耗尽上下文且命中率低。定位大文件 JS 关键词必须用 `search_js.js`；禁止 grep 单行超 64KB 的压缩 JS、禁止现场手搓 `node -e`（PowerShell 转义翻车）。**响应体非明文（`code` 非 0、`data` 二进制/乱码）时同理**：先查 trace 的 xhrNative 响应记录确认响应形态，再按响应方向四层（response→reader→decoder→parser，见 `references/crypto/crypto-entry.md`）追响应处理链；禁止先搜源码里的密钥串猜解密算法——密钥可能作用于别的字段。

读取 NDJSON 的 API、时间、stack、文件、行列号和参数摘要，按调用频率与网络写入时间定位热路径。分析时按定位顺序使用：

```powershell
# 1) 先导入生成摘要（高频 API、stack.file、目标信号命中）
node scripts/import_ruyitrace_log.js --input <project-root>/case/ruyi-trace/logs/trace.ndjson --case-dir <project-root> --markdown
# 2) 用目标信号直接定位请求链和 stack.file:line:col
node scripts/search_trace.js --trace <project-root>/case/ruyi-trace/logs/trace.ndjson --url <目标接口URL或关键词> --markdown
node scripts/search_trace.js --trace <project-root>/case/ruyi-trace/logs/trace.ndjson --keyword <关键词> --context 3 --markdown
# 3) 按行号切源码片段；只有 trace 缺失/截断时才全资源关键词兜底
node scripts/search_js.js --file <project-root>/case/js/original/<资源名>.js --keyword <关键词> --context 200 --markdown
node scripts/analyze_trace.js --trace <project-root>/case/tmp/env-trace.jsonl --summary <project-root>/case/tmp/missing-env.json --markdown
node scripts/check_trace_api_coverage.js --case-dir <project-root> --markdown
```

不要在命令行手搓 `python -c` 或引号嵌套 grep NDJSON。默认只观察不修改；仅当 NDJSON 缺失、截断或无法覆盖关键入口时，才使用 Hook 模板，并只注入 ruyipage 定制 Firefox。Hook 必须在目标 SDK 加载前安装，命中后及时移除。

环境补齐采用证据驱动的最小集合。只有 trace 显示参与参数或服务端校验的模块才实现；每轮补齐保存输入、中间值、输出和请求结果，禁止一次性伪造大量浏览器 API。环境检测代码不等于服务端约束，未进入关键链路的检测不纳入最终环境。

## 9. IMPLEMENT

实现路径按以下顺序降级：

A. 纯算法：Node `crypto`、Python `hashlib`/成熟密码库和原始序列化规则。
B. 最小 JS 沙箱：提取算法闭包，在隔离上下文提供已证实需要的对象和函数。
C. WASM：复现加载、内存、导入和导出调用，固定输入输出契约。
D. 环境伪装：仅补 trace 证明必要的 Web API、对象形状、Realm、时间、随机数和指纹行为。
E. TLS/Session：对齐客户端指纹、连接复用、Cookie 顺序、重定向和动态资源预热。

中间值必须可单独验证；时间、随机数、UA、指纹和会话状态必须有明确来源；静态配置外置，秘密从环境变量或用户运行时输入读取。验证码拆成 `load → solve → verify`，封装层只负责接口参数和轨迹加密；成功样本先逐字段确认明文类型、长度和绑定关系，再编写生成器，不得把一次性 challenge、ticket 或答案固定到代码。

## 10. REAL_VERIFY

默认验证是交付必要条件，不是可选演示。除非用户明确 sign-only，否则必须用最终纯协议入口向真实 API 发请求。只读/验签请求默认真实执行；有业务副作用的写请求执行前先宣布目标 URL、方法、次数和预期影响，随后继续。

范围纪律：黑盒输出与取证样本结构一致后，直接用真实目标 URL 进入 REAL_VERIFY；内部参数映射等旁支问题记录到 `经验沉淀-<站点>.md`，不阻塞主交付、不横向展开。

最低要求：连续完成不少于 5 次真实请求，并记录每次时间、HTTP 状态、目标参数摘要、会话阶段和响应判定。成功标准：

- HTTP 状态符合目标接口成功语义，且响应结构和业务数据正确，不只检查状态码。
- 动态参数在不同时间、输入或会话下按预期变化。
- Cookie、Token、TLS、Header、Body 序列化和请求顺序不依赖浏览器状态。
- 失败请求能区分签名错误、会话过期、资源过期、频率限制、IP 风控和业务参数错误。

至少保留一份脱敏验证摘要和可复现命令；不得输出完整 Authorization、Cookie、Token、密钥或验证码答案。401/403/412/429 先诊断，不得用浏览器自动化或硬编码成功样本绕过。

真实验证失败时不得进入 `DELIVER`。可以交付“未完成/诊断中”的中间材料，但执行入口、最终总结和状态行必须标为 `REAL_VERIFY_FAILED`，不得使用“已完成还原”“服务端已接受”或等价成功措辞；只有 sign-only 明确豁免，且必须单独标注未做真实验证。

sign-only 模式必须：标明未完成真实 API 验证；只验证本地输入输出、中间值和格式约束；不宣称签名已被服务端接受；入口提供显式 `--sign-only` 或等价模式且不默认联网。

## 11. DELIVER、CLEANUP 与失败处理

交付目录保持单入口和最小依赖：

```text
result/
├── final.js 或 final.py
├── config.json、package.json 或 requirements.txt
├── 最终项目总结.md
├── 经验沉淀-<站点>.md
├── 验证记录.json
└── src/
```

入口被 `require`/`import` 时只导出 API，命令行执行时才运行。交付前必跑：

```powershell
node scripts/check_final_artifact.js --case-dir <project-root> --markdown
node scripts/check_code_quality.js --case-dir <project-root> --markdown
```

`最终项目总结.md` 与 `经验沉淀-<站点>.md` 是必需交付文档；模板与写入规则见 `references/quality/final-summary.md`、`references/workflow/phase-flow.md`。仅用户明确要求不生成时才用对应 `--no-require-*` 豁免，并在输出中记录原因。

用户要求“生产级交付”时追加：

```powershell
node scripts/check_final_artifact.js --case-dir <project-root> --production --markdown
```

清理 `case/tmp/` 中的调试脚本、临时下载和秘密材料，保留可复核的最小证据、脱敏样本和必要 fixture。轻量路径交付必须在最终总结中标注算法来源 URL、验证日期和未做 trace 取证声明。

卡住时按顺序：重看本次证据、运行 trace 覆盖检查、比较请求字段、定位中间值、缩小环境、再升级沙箱或 TLS 路径；最后输出卡点、已证实事实、缺失证据和下一步输入，不用浏览器自动化代替协议实现。

## 12. references 按需路由

不要全量必读，按当前状态选最小集合；读完仍无法推进再追加。高频入口：

| 当前需要 | 首选 reference |
|---|---|
| 状态机细则、常见坑、经验法则 | `references/workflow/phase-flow.md`、`decision-tree.md`、`common-pitfalls.md`、`experience-rules.md` |
| 取证、trace 质量与重试、工具安装 | `references/workflow/trace-flow.md`、`references/tooling/ruyi-tooling.md`、`browser-acquisition.md` |
| 加密、混淆、环境、WASM、网络、指纹、验证码、交付 | 按场景细分见 `references/workflow/reference-map.md` |

完整目录和场景索引在 `references/workflow/reference-map.md`。目录、脚本和模板的具体参数以实际脚本 `--help` 输出为准。若 reference 与本文件冲突，以本文件的状态机、真实 API 验证规则和纯协议红线为准。

## 13. 完成判定

- 目标范围已声明且要素齐备，证据来源可追溯。
- 请求链、动态字段和实现路径有本次证据支持。
- 交付入口不依赖浏览器、不硬编码关键动态秘密。
- 默认模式已完成不少于 5 次真实 API 请求并确认正确业务数据；或明确标记 sign-only 且未冒充真实验证通过。
- `最终项目总结.md` 与 `经验沉淀-<站点>.md` 已生成，或用户明确豁免。
- 交付检查和代码质量检查通过。
- 临时文件已清理，产出可被普通开发者和其他 AI 直接理解。
