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

## 执行速查卡（上下文压缩/续接后先读这里重建主干）

| 动作 | 命令 | 通过标准 |
|---|---|---|
| 启动 | `node scripts/state_machine.js --case-dir <project-root> --init --markdown` | state.json 生成 + 11 项 TODO 同步 |
| 状态推进 | `node scripts/state_machine.js --case-dir <project-root> --set <NODE> --note "<结论>"` | 合法转换 + TODO 勾选同步 |
| GATE-1 环境 | `node scripts/check_session_resume.js --case-dir <project-root> --project-dir <project-root> --markdown` | fresh 完整自检 / resume 续接 |
| GATE-2 证据 | `node scripts/check_evidence.js --case-dir <project-root> --url <目标> --markdown` | 退出码 0 |
| 取证前速查 | `node scripts/search_cases.js --domain <域名> --signal <信号>` | 提取终态接口/坑点校准参数 |
| Step 1 网络取证 | `python scripts/forensic_ruyipage.py --url <目标> --targets <终态接口> --markdown`（时间参数一律秒） | 终态 2xx + capture.json 落盘 |
| Step 2 trace | `node scripts/capture_ruyitrace_log.js --url <目标> --evidence-signal <writer写入点> --import-after --markdown` | NDJSON + trace 门禁退出码 0 |
| 证据检索 | `search_trace.js --keyword <kw>` / `search_js.js --file <js> --keyword <kw>` | 执行输出的 [WARN]/[STATE] 提示 |
| 运行混淆 JS | `node scripts/run_with_trace.js --target <js> --entry <fn> --timeout 5000` | 禁手写 vm runner |
| 混淆反混淆 | `node assets/ast-patterns/scripts/detect-patterns.js <js>` → `run-pipeline.js` | 按 README 分层执行 |
| IMPLEMENT 前 | `node scripts/check_env_prerequisites.js --case-dir <project-root> --markdown` | 退出码 0（两文件达标） |
| 重放/写请求前 | `node scripts/state_machine.js --case-dir <project-root> --guard replay` | 只在 REAL_VERIFY/DIAGNOSE 放行 |
| 外部题解检索前 | `node scripts/state_machine.js --case-dir <project-root> --guard external` | 只在 CASE_LOOKUP/EXTERNAL_LOOKUP/DIAGNOSE 放行 |
| 浏览器 MCP 兜底取证前 | `node scripts/state_machine.js --case-dir <project-root> --guard mcp` | BLOCKED_FORENSIC 取证（须用户确认）；DIAGNOSE 双对照浏览器侧（须已过 BLOCKED_FORENSIC） |
| 交付前 | `check_final_artifact.js` + `check_code_quality.js` | 退出码 0 |

主线：INTENT_CONFIRM → ENV_READY → EVIDENCE_GATE →（FORENSIC_CAPTURE → TRACE_CAPTURE）→ CASE_LOOKUP → IDENTIFY → TRACE_ANALYZE → IMPLEMENT → REAL_VERIFY → DELIVER → CLEANUP → DONE。打转信号：检索输出 `[WARN] 重复检索` 或 `[STATE]` 提示即执行 §4.4 防耗尽检查点序列。

## 0. 分析前硬门禁（不可跳过）

### 0.0 状态机强制跟踪与动作守卫（不可跳过）

激活 skill 后立即初始化执行状态，之后全程用脚本跟踪"当前在哪个步骤"，让动作边界成为技术约束而非口头约定：

```powershell
# 激活后立即初始化（写入 case/state.json，起点 INTENT_CONFIRM）
node scripts/state_machine.js --case-dir <project-root> --init --markdown
# 每次状态转换：--set 校验合法性，跳过必经节点（如直跳 IMPLEMENT）直接报错；--force 放行但留审计
node scripts/state_machine.js --case-dir <project-root> --set <NODE> --note "<关键结论>" --markdown
# 向目标接口发起重放/写请求前必过（细则见 4 节「阶段动作边界」）
node scripts/state_machine.js --case-dir <project-root> --guard replay
# 外部题解/文章检索前必过（细则见 4 节「外部检索时序」）
node scripts/state_machine.js --case-dir <project-root> --guard external
# 浏览器 MCP 连接用户真实浏览器兜底取证前必过（BLOCKED_FORENSIC 取证须用户确认；DIAGNOSE 双对照浏览器侧须已过 BLOCKED_FORENSIC）
node scripts/state_machine.js --case-dir <project-root> --guard mcp
# 进入每个节点前聚合跑该节点必验门禁；输出含 FAIL 或需参数缺失时停在当前节点
node scripts/gate.js --case-dir <project-root> --at <NODE> --url <目标URL> --inputs <材料路径> --markdown
```

**TODO 硬门禁（不可跳过）**：`--init` / `--set` / `--guard` 的输出都会渲染「执行 TODO 清单」勾选表（`[x]` 已完成 / `[~]` 进行中 / `[ ]` 待办），同时落盘到 `state.json.todo`。收到输出后必须立即把该清单**逐项同名同序**同步到宿主 TODO 工具（首次为创建，后续为更新状态），不新建子任务、不改写条目名；宿主无 TODO 工具时把清单原样输出给用户。判定标准：任何一次状态推进后的回复里看不到 11 项清单及其勾选状态，即视为流程违规，须立即补跑 `--set`（同节点重复设置合法）并输出清单。

清单 11 项（随状态推进勾选；每进入一个状态立即勾选对应项，回退时把对应项重新置为进行中，不新建子任务）：

1. INTENT_CONFIRM
2. ENV_READY（续接模式直接勾掉）
3. EVIDENCE_GATE
4. FORENSIC_CAPTURE / TRACE_CAPTURE（发起取证前先完成经验库速查定向，见 4.2 节）
5. CASE_LOOKUP（本地 search_cases + EXTERNAL_LOOKUP）
6. IDENTIFY
7. TRACE_ANALYZE
8. IMPLEMENT
9. REAL_VERIFY（含 DIAGNOSE：403/风控码先分层定位双对照，见第 10 节）
10. DELIVER / SIGN_ONLY_DELIVER
11. CLEANUP

违反规则：任何"当前执行与 state.json 不一致"（未 init、非法跳转、越权重放）都是任务失败信号；先回读 state.json 自修，禁止口头宣称"已进入某节点"代替 `--set` 与门禁实际输出。门禁/守卫拒绝即停，不得用 `--force` 常态绕过（`--force` 用于显式声明例外，仍须在阶段报告与最终总结写明）。

> 本节是最高优先级。激活 skill 后、第一次调用任何取证/分析工具前，必须按序完成 GATE-0~GATE-2 并逐项输出结果。GATE 逐项输出是执行流内动作：输出结果后立即执行下一步，不等用户回应。脚本退出码非 0，或输出含「缺失证据」「不可跳过」「未通过」时，停在当前节点自修复（补采证据 / 安装组件 / 重采）后复检；门禁失败是待办任务，不是向用户汇报并等待指示的理由，未通过不得推进。

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

Windows 下后续手动运行 Python 脚本一律用环境检查选定的解释器（通常是 `py -3`）；裸 `python` 可能命中 WindowsApps stub 并以 exit 9009 静默失败。

## 1. 任务边界、授权与确认策略

用户发起本技能请求即代表已在合法授权范围内操作，默认直接协助，不要求授权证明，不反复确认。

确认策略按“对外部世界的影响与可逆性”分三档：

| 档位 | 判定 | 动作 |
|---|---|---|
| A | 证据/选择可自动判定 | 自动推进，不停下 |
| B | 有外部副作用或不可逆 | 执行前宣布 + 继续 + 可打断 |
| C | AI 不可替代的物理交互 | 停下等用户，期间并行推进其他分析 |

典型归属：目标 URL/参数认定、证据门禁判定、TLS 客户端选择、fingerprint baseline 切换（自动重新采样统一后宣布继续）、原始日志与登录态 profile 处置（默认保留并在总结说明，用户明确要求才删）属 A/B；工具安装与真实写请求属 B；登录、验证码、人工识别、手动 trace、付费打码平台属 C。

**连续执行总则（本节最高优先级）**：本技能默认单会话连续执行到 DONE，唯一停点是 C 档物理交互。一切输出动作——GATE 逐项结果、状态行、B 档宣布、阶段报告/notes 落盘、卡点与方向说明——都是执行流内动作，输出后立即继续下一步，不等用户回应；落盘中间产物 ≠ 阶段终点。门禁/脚本失败时先自修复复检，连续 2 轮修复仍失败才把卡点连同默认方向（继续攻坚）一起输出并按默认方向继续，用户打断才改道。禁止把「已保留中间产物，请确认下一步」作为回合结束方式——那是未完成任务。

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
8. 取证只允许四个来源：① ruyipage 定制 Firefox（经 `scripts/forensic_ruyipage.py`）② RuyiTrace（经 `scripts/capture_ruyitrace_log.js`）③ 用户手动提供材料 ④ 浏览器 MCP 连接用户真实浏览器（**仅 BLOCKED_FORENSIC 降级兜底**：取证浏览器被引擎级检测拒绝且 `--ua` 覆盖无效时，经用户确认并过 `--guard mcp` 后放行；Chrome 等非 Firefox 内核与定制 Firefox 互补，match14 实证引擎检测不拦真实浏览器。产物必须落盘 `case/`——成功样本 Cookie/指纹/JS/网络记录，后续分析只认落盘产物；只取证不交付，纯协议红线不变）。常规取证不得手写 fetch/curl/requests 抓取目标页面或下载目标 JS，不得使用系统 Chrome/Edge/Firefox、Playwright/Puppeteer/Selenium 或浏览器 MCP 取证（④ 不满足前置条件时同样禁止）。也不得用 jsdom / happy-dom / domino 等 DOM 模拟库**联网加载目标页**取证（`JSDOM.fromURL()`、`new JSDOM(..., { url, resources: 'usable' })` 会真去拉取页面与子资源）：这是绕过本条的第五种取证通道，拿到的是"页面自己算出的值"而非可审计算法，且必然暴露 `jsdom/x.y.z` UA 与残缺 DOM 指纹被检测。边界：DOM 模拟库只允许**离线**使用——HTML 由本地字符串构造、脚本来自 ①②③④ 落盘产物、不开 `resources: 'usable'`、不传目标站 `url` 触发网络加载（`runScripts: 'dangerously'` 在纯离线输入下不受限）。

## 3. 纯协议红线

- 不交付 Playwright、Puppeteer、Selenium、浏览器扩展、浏览器 MCP 或 ruyipage/RuyiTrace 自动化代码。
- 交付物不得在运行时联网加载目标页再执行其脚本来生成参数（jsdom / happy-dom / domino 类 DOM 模拟库的联网禁令与离线允许边界见绝对规则 8）：脚本与 fixture 都必须来自本 case 取证产物。
- 不以自动化浏览器完成反爬挑战，不把浏览器抓到的关键 Cookie 作为固定常量。
- 不把目标网页作为最终签名服务，不通过打开网页、执行页面脚本或读取浏览器状态生成参数。
- 允许取证阶段使用 ruyipage 定制 Firefox 和 RuyiTrace；允许把取证得到的算法、静态资源、必要 fixture 转化为纯协议实现。
- 交付入口必须是 Node.js `final.js` 或 Python `final.py`，运行时只使用 HTTP、TLS、密码学、序列化和必要的最小 JS 沙箱能力。
- 通用模板只提供 provider-neutral 的流程骨架和 adapter 契约；不得在 `templates/` 中预填真实厂商的接口名、字段名、HTTP 方法、JSONP、加密结构、凭据字段或默认轨迹。所有平台细节必须由本 case 的抓包、RuyiTrace 和成功样本驱动，落在 case adapter/result 中。
- 厂商知识分级（T1 识别指纹 / T2 协议语义）：参数名↔算法族映射、厂商 Cookie/组件名、响应码特征等**识别信号（T1）**只允许保留在标注过的识别参考（如 `references/crypto/algorithm-families.md`、`references/network/ip-risk-control.md`）与分类脚本（`scripts/classify_verify.py`）中；字段语义、加密结构、接口链、实测轨迹参数等**协议知识（T2）**只能存在于 `references/captcha/captcha-providers.md` 厂商知识库、`cases/*.md` 案例与 case adapter，并带验证日期。通用 workflow/质量文档引用 T2 内容时只写「见 <知识库/案例>」指针，不复制具体参数。
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
  ├─ 只有 Step 1 且 RuyiTrace 工具不可用（install_all.js 自动安装失败）→ MATERIALS_FALLBACK
  ├─ 只有 Step 1 → TRACE_CAPTURE
  ├─ 只有 Step 2 → STEP2_ONLY
  └─ 两步均缺失 → FORENSIC_CAPTURE
MATERIALS_FALLBACK（工具不可用降级，细则见 decision-tree.md 阻塞点#5）
  ├─ 用户材料（JS/cURL/HAR，含经用户确认的浏览器 MCP 代采落盘产物）经 check_evidence.js
  │   内容校验通过 → CASE_LOOKUP
  │   （强制声明：经验沉淀与最终总结写明未走 ruyipage/RuyiTrace、证据为手动材料 + 真实请求反证）
  └─ 仅 URL 或材料校验不通过 → FORENSIC_CAPTURE（先修复工具）
STEP2_ONLY → CASE_LOOKUP
FORENSIC_CAPTURE
  ├─ 终态目标取证达成（终态 2xx 命中）→ TRACE_CAPTURE
  └─ 目标请求持续被拒且定位到内核级/环境检测阻断 → BLOCKED_FORENSIC
BLOCKED_FORENSIC（取证被目标站检测阻断，与工具缺失不同）
  ├─ UA 类检测 → 用 forensic_ruyipage.py --ua 覆盖后重采 → 达成则 TRACE_CAPTURE
  ├─ UA 覆盖无效的引擎级检测（eval.toString/Error.stack/引擎特征等，取证细则见
  │   references/env/env-detect-bypass.md 内核级差异检测）→ 输出卡点对齐用户后三选一：
  │   ① 用户确认后用浏览器 MCP 连接用户真实浏览器取证（先过 --guard mcp；成功样本
  │      Cookie/指纹/JS/网络记录落盘 case/，按用户材料归类走 MATERIALS_FALLBACK 校验；
  │      match14 实证：Firefox 取证全 400，MCP 真实 Chrome 拿到 200 成功样本与指纹基线）
  │   ② 用户提供真实浏览器 cURL/HAR 走 MATERIALS_FALLBACK
  │   ③ 用户确认降级（降级义务同 MATERIALS_FALLBACK：经验沉淀与最终总结写明 Step 2 缺失原因）
  └─ 未定位到检测证据不得进入本节点（先按 4.2 重采 / DIAGNOSE 排查）
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
EXTERNAL_LOOKUP（前置：必须已有本次取证产物；外查前过 `--guard external`）
  ├─ 搜到方案且算法可读 → IMPLEMENT
  └─ 搜不到或黑盒 → FORENSIC_CAPTURE
IDENTIFY → TRACE_ANALYZE → IMPLEMENT
IMPLEMENT → REAL_VERIFY
REAL_VERIFY
  ├─ 默认真实验证通过 → DELIVER
  ├─ 失败 + 已有 trace → DIAGNOSE
  ├─ 失败 + 无 trace → FORENSIC_CAPTURE
  └─ sign-only → SIGN_ONLY_DELIVER
DIAGNOSE（403/风控码失败的首选入口；双对照细则见第 10 节分层定位协议）
  ├─ 200 + 业务层风控文案 → 会话状态类风控（蜜月期/惩罚计数；"放慢速度"
  │  类文案在签名确认正确前不得按字面归因频率），
  │  按 ip-risk-control.md 专节排查；惩罚期内基线失败 → 冷却，不做实验
  ├─ 正向对照 200 + 反向对照 403 → 签名内容层 → 环境检测对齐（探针法）→ IMPLEMENT
  ├─ 正向对照 403 → 连接层嫌疑成立 → IMPLEMENT 路径 E（TLS/Session 对齐）
  ├─ 会话/资源/频率/业务参数错误 → 对应修复 → IMPLEMENT
  └─ 双对照未完成（含用过期样本、hook 未验证标记、惩罚期污染数据）→ 停在 DIAGNOSE，
     不得下拦截层结论、不得转投浏览器内核方案；对照结果写入验证记录并过
     check_risk_layer_diagnosis.js 后按结论路由
DELIVER / SIGN_ONLY_DELIVER → CLEANUP → DONE
```

**TRACE_CAPTURE / TRACE_RETRY 出口门禁（不可跳过）**：进入 CASE_LOOKUP 前必须复跑 `node scripts/check_trace_gate.js --case-dir <project-root> --url <target-url> --require-trace-signal <环境API/写入点> --markdown`，退出码 0（Step 2 已具备且目标 writer 覆盖满足）才放行；NDJSON 已产出但 writer 信号未命中时是「覆盖不足」不是「没有 trace」，进 TRACE_RETRY。完整判定规则、与 GATE-2 的区别、信号语义见 4.2 节「TRACE_CAPTURE 出口门禁复检」。

**阶段动作边界（硬约束）**：状态机每个节点只允许该节点的取证/分析动作，**前置阶段不得发起外部重放/对照实验**。

- 允许范围：TRACE_CAPTURE / CASE_LOOKUP / EXTERNAL_LOOKUP / IDENTIFY / TRACE_ANALYZE 只做取证（`forensic_ruyipage.py` / `capture_ruyitrace_log.js`）、本地证据分析（`import_ruyitrace_log.js` / `search_trace.js` / `search_js.js`）与案例/网络检索。
- 重放归属：判断参数可重放性、绑定关系、UA/cookie/TLS 因素属 **DIAGNOSE**。需要这类判断时，先 TRACE_ANALYZE 定位 builder/writer，IMPLEMENT 写出实现，再到 REAL_VERIFY/DIAGNOSE 做对照实验。
- 越权代价：①消耗会话状态、触发风控污染后续取证；②签名链未定位时缺乏对照基础，会把会话/cookie 层问题误判为签名或连接层问题。
- 技术入口：任何向目标接口发真实请求（含"只发一次看看返回什么"的诊断性请求）前必须先过 `--guard replay`（命令见 0.0 节），退出码 0 才允许发。自我判断"我现在做的算 DIAGNOSE"不构成放行依据——守卫读的是 `state.json` 里的实际节点。

**外部检索时序（硬约束）**：外部题解/文章检索（WebSearch/WebFetch 搜"XX 网站 JS 逆向"）只允许在 CASE_LOOKUP / EXTERNAL_LOOKUP / DIAGNOSE 节点进行，执行前必须过 `--guard external`（命令见 0.0 节；退出码 0 放行，越权退出 2 并写 `blocks` 审计）。EVIDENCE_GATE 及更早阶段一律不得外查——取证前外查的期望收益远低于被过期情报带偏的成本。情报到手后按以下规则处置：

1. 外部结论一律标记为**假设**，必须用本次 trace/capture 逐条验证签名字段名、接口路径、写入点后才能升级为结论。
2. 与本次证据冲突时无条件以本次证据为准（绝对规则 2），并在案例沉淀里记下"外部情报已过期/不适用"及差异点。
3. 不得因外部文章描述的方案更"完整"而回头修改本次证据的解读，也不得据此跳过取证。

激活后立即运行 `node scripts/state_machine.js --case-dir <project-root> --init --markdown` 建立执行状态；随状态推进勾选的 11 项 TODO 清单、同步规则与判定标准见 0.0 节「TODO 硬门禁」。

### 4.1 路径、意图与环境

`<project-root>` 指项目根目录，其下**平级**包含 `case/`（取证与分析中间产物）与 `result/`（交付物）。`notes/` 是 `case/` 的子目录，**不与 `result/` 平级**：

```text
<project-root>/                # 所有脚本的 --case-dir 传这一层
├─ case/                       # 中间产物，可清理
│  ├─ state.json               # 状态机（state_machine.js --init 写入）
│  ├─ notes/                   # env-snapshot.json / entry-chain.md / missing-env-priority.md 等门禁依赖
│  ├─ 阶段报告/  tmp/  fixtures/  requests/  hooks/  env/  forensic/
│  ├─ js/{original,pretty,extracted}/   ruyi-trace/logs/   browser/ruyipage/
└─ result/                     # 交付物：final.js|final.py、config.json、最终项目总结.md、经验沉淀-<站点>.md、验证记录.json、src/
```

一个文件夹内放多个 case 时，**每个 `<case-name>/` 自身就是一个 `<project-root>`**（各自有 `case/` 与 `result/`），`tools/` 提到外层与各 case 平级共享：

```text
<workspace>/
├─ tools/                      # RuyiTrace / ruyipage runtime，多 case 共享
├─ <case-a>/{case/, result/}
└─ <case-b>/{case/, result/}
```

所有脚本的 `--case-dir` 统一传 `<project-root>`；`scripts/lib/paths.js` 的 `resolveCaseDir()` / `resolveResultDir()` / `resolveNotesDir()` 是唯一路径真源，已兼容传 `<project-root>` 或 `<project-root>/case`，不要在脚本里自行拼 `caseDir/result` 或 `caseDir/../result`。环境检测类脚本用 `--project-dir <project-root>` 指定 tools/ 所在工程根；多 case 共享 tools 时 `--project-dir`/`--case-dir` 传 case 目录或共享工程根均可，脚本会自动向上查找含 `tools/` 的祖先目录，避免把已装在共享工程根的 RuyiTrace/ruyipage runtime 误判缺失或重复下载。

从请求中提取目标 URL、接口 URL、目标参数、请求方法、范围和项目根目录。目标 URL + 目标参数可确定即直接推进；仅两者缺一且无法合理提取时才问一次最小信息。若实现需要额外动态参数，列出参数名、位置、用途假设和证据后纳入请求链范围。

用户约束与 skill 规则的仲裁（启动阶段只裁定一次，不得反复权衡）：用户说「不接受浏览器自动化」「不用 Playwright」等，默认约束**最终交付物**（第 3 节纯协议红线），不改变取证阶段允许 ruyipage 定制 Firefox / RuyiTrace 的规则（绝对规则 8），两者不冲突时无需多轮权衡；「忽略已有案例经验」指不直接套用历史结论（绝对规则 2 仍要求先走 CASE_LOOKUP 做时效校验），不是跳过必经节点。仅当用户约束明确指向取证动作本身（如「不许打开浏览器」）时才问一次确认取舍。

用户说明重装 Node、替换 Firefox、迁移 tools 目录或升级 ruyipage/RuyiTrace 时，重新执行完整环境检查，不得沿用旧快照。

环境检查与快照写入按第 0 节 GATE-1 执行。不得因已有阶段报告或 `result/` 跳过环境快照写入或证据核验。

### 4.2 取证与证据门禁

EVIDENCE_GATE 运行 GATE-2 的 `check_evidence.js`（命令与信号参数见 0 节 GATE-2）。

URL 不是证据。脚本确认文件真实存在并可归类，才允许跳过对应步骤。退出码非 0 或输出含「缺失证据」「不可跳过」时，停在 EVIDENCE_GATE 补证并复检，禁止进入 IDENTIFY/TRACE_ANALYZE/IMPLEMENT。

- Step 1：有效 `capture.json` 网络记录，或通过内容校验的 HAR、cURL、原始 HTTP 请求文本；目标接口已知时用 `--require-network-signal <目标接口URL或关键词>` 约束 capture/用户材料。
- Step 2：内容可解析、记录非空且关联目标域的 RuyiTrace NDJSON/JSONL；`ruyitrace-summary.md` 不能替代 NDJSON。Step2-only 时先导入并生成摘要，再结合日志定位，不重复采集 trace，也不因缺少 Step 1 强制网络取证。
- 单独 JS、截图或指纹基线只作辅助材料，不计为 Step 1。

**取证前强制速查（不可跳过）**：EVIDENCE_GATE 路由到 FORENSIC_CAPTURE / TRACE_CAPTURE 后、发起任何取证采集命令前，先按目标域名与特征关键词查经验库提取定向情报：

```powershell
node scripts/search_cases.js --domain <目标域名> --signal <参数名或SDK特征>
```

命中时提取三项情报写入状态行后再取证：① 终态接口模式（校准 `--targets`，禁止靠记忆猜接口路径候选）；② 同站点已知坑点与采集参数建议（等待窗口、trace 信号选择等）；③ 题型假设与可复用方法论。未命中按全新 case 取证。速查结果只是假设与路径提示（绝对规则 2），不替代本次取证证据；同站历史案例不因速查命中而免除本次取证。

网络取证：

```powershell
# 发起取证命令前先 --set 对应节点（FORENSIC_CAPTURE / TRACE_CAPTURE），取证完成再补设会被状态机拒绝；
# 已完成上述取证前速查的情报用于校准本命令参数。
# --targets = 本次流程的终态接口（如最终登录/业务提交接口）；任一目标 URL 的非 OPTIONS 2xx 响应命中后进入短暂收尾窗口并结束取证，
# 抓包从页面打开前覆盖到终态，不要求用户预先列全验证码 load/verify 等中间接口。
# 自动保存入口页面 HTML 到 case/forensic/document.html（含 412/JS challenge 页内联脚本，是 acw_sc__v2 等 challenge cookie 的强制证据）。
# --targets 只写能唯一标识终态接口的完整路径子串（如 api/question/13）；禁止用会误命中同号旁路接口的宽正则
# （topic_info?href=N / api2/N / a/N 都含同一数字，宽正则会让取证在目标接口之前提前收尾 → 目标响应体丢失，见反模式 22）。
# 全部参数细则（时间参数一律「秒」、--wait/--target-settle 上限、--cookie/--cookie-domain 会话注入、--ua 覆盖、
# 60包/100MB 关联预算、bodies/wasm 落盘、预览阈值与 saved_to/_complete 语义）见 scripts/README.md
# 与 references/workflow/trace-flow.md，此处不重复。
# --ua 只覆盖 UA 字符串；eval.toString() 等内核级检测覆盖无效，命中此类检测按状态机 BLOCKED_FORENSIC 处理
# （见 references/env/env-detect-bypass.md 内核级差异检测），禁止为改 UA 手写取证探针。
# RED LINE：--cookie 仅用于"注入到取证浏览器以还原真实会话过程"，不替代最终交付的协议实现。
python scripts/forensic_ruyipage.py --url <target-url> --case-dir <project-root> --targets <最终业务接口关键词> --markdown
```

终态目标请求未命中 = Step 1 缺失，禁止转源码搜索继续。JS 源码关键词定位只能作辅助假设；用户也可提供 cURL/HAR/原始请求文本；终态命中并落盘后再回 EVIDENCE_GATE。

- **退出码语义**：`PARTIAL`（仅 OPTIONS/非 2xx）与 `NO_TARGET`（完全未命中）均非 0；任一非 OPTIONS 2xx 命中即 `PASS`、退出码 0。HTTP 2xx 只表示目标请求已取证，不表示业务成功（通用脚本不猜业务码）。
- **重试型场景**：登录可能因验证码/校验失败重试时调大 `--target-settle`（单位秒，默认 3；建议 10~30，上限 120），保证重试仍在同一会话内。关联材料以最后一次有效终态向前回溯，验证码中间接口不是额外终态门禁（load → verify 由分析阶段从同一会话回溯）。
- **翻页/序列请求类目标**：取证交互覆盖 ≥2 个请求序号（如翻 2 页再收尾），为 fixture 多序号比对留成功样本——单序号样本看不见计数器递增语义（反模式 24，match14 教训）。
- **收尾耗时预期**：≈ `--target-settle` 秒数 + 落盘时间（通常 1 分钟内）。等待远超预期（如超 5 分钟）时先核对时间参数是否把毫秒当秒传入，不要无限轮询干等。
- **证据完整性**：body 超过 JSON 内联预览阈值时必须读取对应 `saved_to` 完整文件，`*_complete=false` 不能拿预览替代原始证据。
- **手动结束**：需要用户交互时提示其在窗口完成操作——**操作完成后用户直接关闭浏览器窗口即视为手动结束抓包，脚本会立即收尾落盘（报告 endReason=browser-closed），不是失败**。
- **禁止 kill 进程**：浏览器已关/日志出现 WebSocket 断连时脚本仍在收尾分类，等 `FORENSIC DONE` 或 JSON 输出。万一进程被强杀，`case/forensic/partial-steps.jsonl` 保留全部包元数据兜底（该文件残留即说明未正常收尾）。

Windows 下若 Python 脚本输出仍现编码异常，用 `PYTHONUTF8=1` 前缀兜底（PowerShell：`$env:PYTHONUTF8="1"`）；仓库脚本已内置 UTF-8 强制与 emoji 安全化，正常无需手动加。

日志采集：

```powershell
node scripts/capture_ruyitrace_log.js --url <target-url> --case-dir <project-root> --evidence-signal <环境API或签名写入点关键词> --end-signal <明确完成事件> --import-after --markdown
# --trace-signal / --evidence-signal 只匹配 RuyiTrace 记录的环境 API / 写入点（如 Headers.set(<参数>)、参数名、JSONP callback 注册；
# XHR 类调用记录为 {"interface":"XMLHttpRequest","member":"open"} 分存字段，信号写 XMLHttpRequest.open 即可结构化命中）。
# 三类必然未命中的信号，一律不传：①目标接口 URL（trace 记录 API 调用不记录请求 URL）；
# ②裸 createElement/appendChild/querySelector/JSON.stringify/Date.now 等泛化 API（门禁脚本会拒绝）；
# ③密钥/常量名（如 appSignKey、bl、secret；trace 记录运行时值与写入点，不记录密钥字面量，会误触发硬阻断）。
# 应选参数写入点/参数名（如 noncestr、x-zse-96、Headers.set(...)）。
# 目标接口 URL 的命中证据由 Step 1 承担：forensic_ruyipage.py --targets <URL> + check_evidence.js --require-network-signal <URL>。
# --end-signal 只控制自动采集何时提前关闭，与 evidence-signal 不再混用；不传时仅用户关闭或 duration 到期结束。
# --target-signal 仅为兼容旧调用，同时作为 evidence-signal 和 end-signal；新流程不要使用。
# 定向采集：已锁定目标脚本/函数、jsvmp 题型或首轮日志过大时，追加 --trace-env KEY=VALUE 透传 MOZ_DOM_* 定向开关
#（jscall 收窄、detail 真值、opcode/vm_step、WS 帧）从源头收窄，先判题型再选最小开关组合；
# 场景组合表与收窄纪律见 references/workflow/trace-flow.md「定向 trace 策略」，完整开关手册见
# references/tooling/ruyitrace-cheatsheet.md。默认全量采集仍是首轮与出口门禁基准。
# 其余参数细则（--duration 默认 120 秒与收尾刷盘、--signal-policy advisory、--cookie/--cookie-domain 写入 trace profile
# cookies.sqlite 且 --input 导入时忽略、endReason 语义）见 scripts/README.md 与
# references/workflow/trace-flow.md，此处不重复。
```

用户已提供 NDJSON 时用 `--input <ndjson>` 导入并生成摘要，不重复采集；多个进程日志用 `import_ruyitrace_log.js --input a --input b`，复制到 case 时会按来源摘要命名，避免同名文件覆盖。取证结果只进入 `case/`，原始 JS 放入 `case/js/original/`，临时材料放入 `case/tmp/`。

目标请求需手动触发时，必须提示用户在 trace 浏览器中完成操作；用户确认“已触发”前不得结束采集。不得把“没触发目标路径”当成“采集完成”。

**TRACE_CAPTURE 质量判定与 TRACE_RETRY**：采集到 NDJSON 不等于达标。摘要显示「未发现 stack.file」、成功解析极低、topApis 找不到目标参数 writer、质量判定「未覆盖页面 JS」（stack.file 全为浏览器内核路径，无 http/https 页面脚本）或「有效 API 调用占比过低」（api 字段几乎全空），均按重度不足处理并进入 TRACE_RETRY。**判定重度不足后必须先执行重采动作（TRACE_RETRY，可调整信号/duration/手动触发方式），重采一次仍不足才允许降级做落盘 JS 静态分析**；禁止跳过重采直接进入源码静态分析——缺 trace 时静态分析极易在「参数来源靠猜」上打转空耗。RuyiTrace 一次采集按进程写多个 `domtrace/trace_process_<pid>.ndjson`，主日志须合并所有 tab/content 进程文件（排除 parent 内核进程），只取单个文件（尤其 mtime 最新的）会把有效 trace 误判为空。完整降级顺序与验证码特化判定见 `references/workflow/trace-flow.md`。

**TRACE_CAPTURE 出口门禁复检（不可跳过）**：采集声明完成、进入 CASE_LOOKUP 前必须复跑出口门禁脚本，确认 Step 2（RuyiTrace NDJSON）真实产出。这是状态机内复检，不是 GATE-2 入口门禁的重复——GATE-2 判定初始证据路由到 TRACE_CAPTURE，出口门禁确认 TRACE_CAPTURE 是否真把 Step 2 补上了：

```powershell
node scripts/check_trace_gate.js --case-dir <project-root> --url <target-url> --require-trace-signal <环境API/写入点> --markdown
```

退出码 0（Step 2 已具备且目标 writer 覆盖满足）才可进入 CASE_LOOKUP；NDJSON 已产出但 writer 信号未命中时，状态是“Step 2 已具备、目标链路覆盖不足”，进入 TRACE_RETRY，不得写成“没有 trace”。声明「已采集 trace」不等于 Step 2 已产出——出口门禁用脚本退出码硬卡「声明不执行」绕过 Step 2 直接拼凑交付。FORENSIC_CAPTURE 补采后同样必须通过本门禁才进 CASE_LOOKUP；STEP2_ONLY（用户已提供 NDJSON）Step 2 本就具备，直接通过。

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

示例：`TRACE_ANALYZE(Step1+Step2 齐备，noncestr 写入点命中) → IMPLEMENT`；`DIAGNOSE(正向对照 200 + 反向对照 403 → 签名内容层，探针法 diff 出 4 差异位) → IMPLEMENT`。关键结论随节点落盘，供压缩/续接使用：

```powershell
node scripts/write_stage_report.js --case-dir <project-root> --stage <阶段> --input <草稿.md> --markdown
```

输出到 `case/阶段报告/`。状态失败时停留在当前节点，不得把失败标记为通过。

**阶段报告默认不生成，仅在以下场景按需落盘**：多轮复杂补环境 / 跨会话续接风险、上下文防耗尽检查点触发、或用户明确要求。关键结论随节点落盘（IDENTIFY 结论、WASM 黑盒跑通、body 结构确认、实现方案选定等）不受默认省略限制，必须写入 `case/阶段报告/`；最小报告至少含当前状态、已证实事实、缺失证据、下一步输入。阶段报告落盘是后台动作：落盘后立即按「下一步输入」继续推进下一状态，不等用户确认——「报告已写、下一步等指示」违反第 1 节连续执行总则。

**IMPLEMENT 准入三件套（不可跳过）**：进入 IMPLEMENT 前必须按序完成，任一缺失停在 TRACE_ANALYZE。**禁止先根据 Node.js 报错盲补——盲补会导致十几轮「加载→崩→猜→再加载」的空转循环**：
1. **证据前置**：走路径 B/C/D（最小 JS 沙箱、WASM、环境伪装）且需补浏览器对象时，先基于 RuyiTrace NDJSON 产出 `notes/entry-chain.md`（入口函数 → 请求链 → 关键 `stack.file:line:col`，TRACE_ANALYZE 已定位的 builder/writer 即 IMPLEMENT 第一实现目标）与 `notes/missing-env-priority.md`（用 `scripts/analyze_trace.js --summary` 从 NDJSON 抽取的 SDK 实际读取环境清单，含 `api`、`stack.file`、`line`、`col`、环境模块、补齐优先级和「RuyiTrace 证据 / Node trace 补充 / 推断」标记；黑盒执行无法逐项精确复现时至少列出已观测的环境读取/挂载点并标注「黑盒执行，不逐项精确复现」）。两文件缺一不得开始补环境。
2. **门禁脚本复核**：`node scripts/check_env_prerequisites.js --case-dir <project-root> --markdown` 退出码非 0 不得开始补环境（详见 `references/env/env-debug-loop.md` 的「RuyiTrace 优先诊断门禁」）。
3. **Step 2 前置**：`node scripts/check_trace_gate.js` 退出码 0（Step 2 已具备且目标 writer 覆盖满足）。Step 2 缺失不得进入 IMPLEMENT，例外见下方「IMPLEMENT 硬前置条件」。

**上下文防耗尽检查点（硬约束）**：按硬计数触发，不得以「预防性落盘」「提前对齐用户」为由提前触发。触发条件（TRACE_ANALYZE / IMPLEMENT / REAL_VERIFY 任一阶段满足其一即视为已触发）：

- 当前节点已消耗 20+ 步仍未推进（TRACE_ANALYZE 未进 IMPLEMENT、IMPLEMENT 黑盒调试打转、REAL_VERIFY 反复排查未定位根因），或上下文接近耗尽；trace 已定位到关键资源/入口同样计入。**该条已机器强制**：`state_machine.js` 把同一节点的每次 `--guard` 与每次 `--set <同节点>` 记入 `state.json.stepCount`，12 步起输出 WARN，20 步起 `--guard` 直接拒绝（退出码 2）；只有 `--set <同节点> --note "<阶段报告文件路径>"` 且该文件真实存在才归零，口头声明「已记录」不生效。
- 「想问用户 vs 再试一轮」摇摆超过 2 轮——摇摆本身就在消耗步骤。
- 纯思考的决策循环：同一决策（方案/库选择、是否执行、档位判定）重新权衡 ≥2 次，或重复查询已查过的索引、重新判断已有结论。取首个决策立即执行，由验证结果而非思考内再确认判定对错；连续两段思考之间没有任何工具调用即说明正在打转。
- 脚本 WARN：`search_js.js` / `search_trace.js` 把每次查询记入 `case/tmp/query-log.jsonl`，同一（文件、关键词）第 2 次检索即在输出头部输出 WARN、第 3 次起输出「打转实证」强提示。收到 WARN 必须换检索词/换方法，不得无视提示继续同一路线重复检索。

触发后按固定动作序列执行：

1. 回看 IMPLEMENT 准入三件套第 1 条的两份文件是否已覆盖当前崩溃点——未覆盖先补全再继续。
2. 已覆盖仍打转 → 落阶段报告（当前状态、已证实事实、缺失证据、下一步输入），落盘后立即按报告中的下一步输入继续，不等用户。
3. 落报告后仍无新进展 → 输出卡点、已证实事实、缺失证据与默认方向（继续攻坚；仅当证据已证伪当前方向才换路径），输出后按默认方向继续执行，用户打断才改道，不得空等回复。

**收尾保底**：无论预算消耗到什么程度，进入 Phase 5 收尾时交付物清单不得缩水——`最终项目总结.md`、`经验沉淀-<站点>.md`、`验证记录.json` 与 `check_final_artifact.js` 门禁一项不可省；只写总结就收场 = 任务未完成。

**IMPLEMENT 硬前置条件**：必须满足「trace 质量达标（含目标信号命中）」或「用户明确确认轻量路径」。两条均不满足时停在 TRACE_ANALYZE，不得以 mock、猜测或实验性实现替代证据。EXTERNAL_LOOKUP 的假设若与本次 trace 定位的 builder/writer 冲突，以 trace 为准，禁止先去测未被 trace 证明的 SDK 导出接口。

**Step 2 缺失（check_trace_gate.js 退出码 1）时不得进入 IMPLEMENT**：不得以 EXTERNAL_LOOKUP 网络方案、边界声明、同族算法替代或 mock 填补 Step 2 证据缺口；轻量路径豁免的前提是 Step 1 + Step 2 齐备（见 4.3），Step 2 未产出不构成豁免条件。**AI 自行判定「trace 采集不到/太难」不构成降级理由**——没有用户确认的 Step 2 缺失一律停在状态机对应节点。例外共三个：

1. **MATERIALS_FALLBACK 节点**（需用户显式确认）：RuyiTrace 工具不可用且自动安装失败 + 用户材料经 check_evidence.js 校验通过，以「Node 直连真实接口、服务端响应反证」替代 Step 2。
2. **BLOCKED_FORENSIC 节点**（需用户显式确认）：内核级检测使 RuyiTrace 无法触发目标路径，有检测证据且用户已知情，以 Step 1 网络证据 + 落盘 JS 源码分析替代 Step 2。
3. **内容还原型豁免（无需用户确认）**：请求侧参数全部为明文（page/pageSize/kw 等，无任何待还原的签名/token/指纹参数），难点在响应解密/内容还原（字体映射、图片拼装等），且 Step 1 已捕获完整响应证据——此时 Step 2 无证据价值，可在 EVIDENCE_GATE 判定「只有 Step 1」时声明「Step 2 豁免：内容还原型，无运行时签名链路」后跳过 TRACE_CAPTURE 直接 CASE_LOOKUP。请求侧存在任何待还原参数的 case 不得使用本豁免。

例外 1、2 的 REAL_VERIFY 不可豁免；三个例外都必须在经验沉淀与最终总结写明取证偏差或判定依据（例外 3 写请求侧明文参数清单 + 响应自包含证据）。

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

先比较至少两组请求（区分计数器递增与纯随机存疑时补第三组），把字段分为固定值、时间值、随机值、会话值、服务端下发值、加密值；随请求序号递增的字段单独标记为**请求序号计数器**——服务端可能校验其等于页码/请求序号（match14 的 `window.n`：page2 要求 n=2），签名生成器必须与浏览器生命周期对齐：SDK 加载一次、计数器随每次签名调用递增；每请求重建沙箱会使计数器恒 1，只有首个请求通过。对每个目标参数建立 `source → entry → builder → writer` 链。

**参数名存在 ≠ 参数生效（比较前先核对真实请求）**：页面源码里出现的参数名可能是 hook 遗留、旧版残留或求值为 `undefined` 被请求库丢弃。分组比较字段前，先以 `case/forensic/target-hits.json` 的 `url` 或 trace `xhrNative` 的 `url` 为准确认参数**真实存在于请求中**，不要以 `document.html` 里的字面量为准。

下表为 T1 识别信号路由（识别指纹 → 初始路径；识别≠协议复现，协议细节以本 case 证据与厂商知识库为准）：

| 信号 | 初始路径 |
|---|---|
| md5、sha、aes、hmac、SM2/SM4/SM3 | 定位入口后优先纯算法还原 |
| `_0x`、obfuscator.io、控制流平坦化 | AST 反混淆工具链处理（命令入口见下方），再判断是否可纯算 |
| 200KB+、while-switch、dispatcher、字节码数组 | JSVMP 黑盒执行或最小环境复现，不反编译 |
| WebAssembly、wasm base64、webpack 内嵌 wasm | 先整包黑盒，不默认补完整浏览器、禁止先手撕字节码 |
| 412 循环、sdenv、挑战 Cookie | 先还原挑战链，再确认业务签名链 |
| webmssdk、byted_acrawler、bdms、a_bogus、X-Bogus、_signature | trace 定位环境读取和签名写入；注意 `byted_acrawler.sign` 多返回老版 `_signature`，`a_bogus`/`X-Bogus` 由 `bdms` 生成，两者不可混淆 |
| geetest、smcp、dx-captcha、TCaptcha、NECaptcha、AWSC | 按封装层、答案层、verify 链分别处理 |
| h5st、js_security_v3、JA3/JA4 | 先确认会话绑定和 TLS 指纹，再实现请求链 |
| @font-face/FontFace、woff/woff2 动态字体、PUA 码点（U+E000–U+F8FF） | CSS/渲染层字体映射反爬（非验证码题型）：先取证字体资源判静态/动态映射，再提取 cmap 映射；映射可能参与签名（见 references/rendering/font-anti-crawl.md） |

识别结果必须引用落盘资源、NDJSON 或网络包具体字段，不以站点名称直接定类。

特征驱动的两个识别入口（输出均为 T1 假设，不构成协议复现依据）：

```powershell
# 密文/哈希特征 → 算法族假设（长度/字符集/结构/magic bytes）
node scripts/identify_crypto.js --value <密文样本> --label <参数名> --markdown
# Cookie 归因：capture.json Set-Cookie（服务端）× trace cookie 写入（JS）融合，判定每个 Cookie 生成方
node scripts/analyze_cookie_attribution.js --case-dir <project-root> [--cookie <名称>] --markdown
# 混淆 JS 反混淆（命中 _0x / obfuscator / 控制流平坦化时；babel 依赖安装见 assets/ast-patterns/README.md）：
node assets/ast-patterns/scripts/detect-patterns.js <input.js> [hint]        # 1) 先检测混淆家族
node assets/ast-patterns/scripts/run-pipeline.js <input.js> <output-dir> [hint]  # 2) 执行反混淆流水线（分层、可回退）
# 需要运行混淆 JS 验证行为（解码字符串表、观察全局写入）时，一律用带超时保护的沙箱工具：
node scripts/run_with_trace.js --target case/js/original/<资源名>.js --entry <入口函数> --timeout 5000
```

**运行混淆 JS 禁止手写 vm runner（硬约束）**：`run_with_trace.js` 内置 vm 超时保护与环境访问日志，手写 `vm.runInContext` runner 无超时——混淆脚本普遍含反调试死循环（`while(!![])`、debuggerProtection、setInterval 干扰），卡死后无法区分"挂起"与"静默失败"，且重写解码器/runner 会反复踩转义与括号平衡坑。混淆 JS 的字符串数组解码优先走 ast-patterns 流水线（含 RC4/base64 变形的标准 obfuscator 处理），只在流水线不适配时才写最小提取脚本，且写前必须过 `node --check`。

`identify_crypto.js` 只做族级指纹（同长度的 SHA-256/SM3 无法仅凭密文区分），实现仍以 trace 定位的 builder/writer 为准。`analyze_cookie_attribution.js` 回答"这个 Cookie 是谁写的"：server → 复现请求链、禁止硬编码；js → 按写入点 stack 还原挑战/签名算法；both → 按请求顺序拆分串联链。

验证码/JSONP 链路的最低证据要求：`callback 注册 → script.src/请求参数构造 → script 插入或等价网络写入 → load/verify 请求 → callback 执行 → 结果回调`。仅命中 `createElement`、`appendChild` 或页面初始化 API 不算 writer 覆盖；若 trace 只覆盖环境读取，必须在阶段报告和最终总结中明确未证明请求写入。

验证码链路的配套门禁（识别为验证码 case 后必用）：题型/厂商判定跑 `python scripts/classify_verify.py`；滑块先判缺口坐标来源（`references/captcha/gap-coordinate-source.md` 的 A/B/C 路线）；answer JSON 提交前过 `node scripts/check_captcha_answer.js` 门禁，FAIL 不得进入参数化实现。

## 8. TRACE_ANALYZE

**先 trace、后读源码（硬约束）**：进入本节后先跑 `import_ruyitrace_log` 生成摘要，再用 `search_trace --url <target-signal>` 直接定位请求链和 `stack.file:line:col`，最后才按行号/字符偏移切源码片段。禁止在拿到 trace 前先读 8MB 大 bundle 手工猜 webpack module id 或写 probe1~N 静态解析——那会耗尽上下文且命中率低。定位大文件 JS 关键词必须用 `search_js.js`；禁止 grep 单行超 64KB 的压缩 JS、禁止现场手搓 `node -e`（PowerShell 转义翻车）。**响应体非明文（`code` 非 0、`data` 二进制/乱码）时同理**：先查 trace 的 xhrNative 响应记录确认响应形态，再按响应方向四层（response→reader→decoder→parser，见 `references/crypto/crypto-entry.md`）追响应处理链；禁止先搜源码里的密钥串猜解密算法——密钥可能作用于别的字段。

**Windows 写临时脚本规范（探针/runner/补环境脚本一律遵守）**：优先用编辑工具直接写文件；必须用 PowerShell 时一律单引号 here-string `@'...'@`（内部 `$` 不插值）配合 `[IO.File]::WriteAllText($path, $content, [Text.UTF8Encoding]::new($false))` 落盘。禁止双引号 here-string（`$` 插值破坏 JS 语法）、禁止 base64 编码绕路（多一轮转译仍会翻车）、禁止 `node -e` / `python -c` 内联长脚本。写完先跑一次语法检查（`node --check` / `py -3 -m py_compile`）再执行，避免把转义错误误判成目标 JS 的行为。运行混淆 JS 的沙箱需求一律走 `run_with_trace.js`（vm 超时保护 + 环境访问日志），不得手写 vm runner（硬约束见第 7 节）。

**依赖 JS 版本校验（硬约束）**：被挑战代码引用的黑盒 SDK（如 udc.js 类"动态工具 JS"）可能**定期更新**（公钥/算法随版本变化），用旧副本实现会导致签名"格式全对但服务端全拒"且极难排查。进入实现前校验关键依赖 JS 与站点当前版本一致（`curl -s <url> | md5sum` 对比本地副本）；抓取 JS **一律二进制**（`urlopen(url).read()` + `wb` 写回），**禁止** `decode('utf-8', errors='ignore')` 后文本写回——会静默丢字节损坏文件（md5 变化、无报错）。交付脚本对关键依赖内置"启动自动抓取 + hash 对比"。详见 `references/network/dynamic-resource.md` 专节。

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
# 4) 需要运行混淆 JS 观察行为/补环境探测时（禁手写 vm runner，见第 7 节硬约束）
node scripts/run_with_trace.js --target <project-root>/case/js/original/<资源名>.js --entry <入口函数> --timeout 5000
```

不要在命令行手搓 `python -c` 或引号嵌套 grep NDJSON。默认只观察不修改；仅当 NDJSON 缺失、截断或无法覆盖关键入口时，才使用 Hook 模板，并只注入 ruyipage 定制 Firefox。Hook 必须在目标 SDK 加载前安装，命中后及时移除。

环境补齐采用证据驱动的最小集合。只有 trace 显示参与参数或服务端校验的模块才实现；每轮补齐保存输入、中间值、输出和请求结果，禁止一次性伪造大量浏览器 API。环境检测代码不等于服务端约束，未进入关键链路的检测不纳入最终环境。

**签名输入含不可复算随机值 = 分支判定失败（硬约束）**：复现出签名后先自问「服务端能用请求里已有的信息复算出这个值吗」。若签名依赖服务端无法复算的量（RSA 随机 padding 产物、`Math.random`/`crypto.getRandomValues` 结果、只存在于客户端的本地状态），说明沙箱走进了错误分支，**不得继续枚举算法组合或拼接顺序**——转 DIAGNOSE，从随机量产生处回溯到最近的分支条件，逐个对照该条件依赖的环境值（单变量原则）。全局对象被目标 JS 覆盖是最常见诱因，见 `references/env/env-object-model.md` 与 `references/workflow/common-pitfalls.md` 反模式 23。

## 9. IMPLEMENT

**交付语言（进入本节点即定，中途不更换）**：默认 Node.js，不按路径预判；用户显式指定其他语言（如 Python）时遵从并写入最终总结。补环境题型（B/C/D）核心为执行目标 JS 算法，选 Python 入口时须在总结声明 JS 执行桥接方式，禁止静默包 Node 子进程充当"Python 交付"。

实现路径按以下顺序降级：

A. 纯算法：Node `crypto`、Python `hashlib`/成熟密码库和原始序列化规则。
B. 最小 JS 沙箱：提取算法闭包，在隔离上下文提供已证实需要的对象和函数。
C. WASM：复现加载、内存、导入和导出调用，固定输入输出契约。**无外部导入的确定性 wasm 是最简形态**（如猿人学 match15 的 `main.wasm`，`WebAssembly.Module.imports()` 为空、`(i32,i32)->i32` 纯确定性）：Node 原生 `WebAssembly.instantiate(bytes)` 直接执行导出函数即可，无需任何补环境，同一实例可跨请求复用；wasm 进交付物用独立文件（`result/wasm/`）或程序注入 base64（禁止手贴长字符串），注入后 md5 核对原始证据，见 common-pitfalls 反模式 25。
D. 环境伪装：仅补 trace 证明必要的 Web API、对象形状、Realm、时间、随机数和指纹行为。环境对齐的验收线是**服务端校验的自洽性**，不是与真实浏览器逐字节一致——多数站点只校验参数间自洽（解码指纹重算签名比对），vm 沙箱指纹与真实浏览器存在少量差异仍可通过（match14 实证：mz 指纹 53 字段中 4 处差异不影响通过）；先用最小沙箱 + 真实请求试探，按需对齐，不预先逐字节复刻。服务端校验签名内嵌环境检测结果时（403 但正反对照显示连接无问题），用对齐探针法定位差异位——注入导出 SDK 检测函数，浏览器采样 ground-truth 与沙箱采样逐位 diff（见 `references/env/env-detect-bypass.md`）。
E. TLS/Session：对齐客户端指纹、连接复用、Cookie 顺序、重定向和动态资源预热。

中间值必须可单独验证；时间、随机数、UA、指纹和会话状态必须有明确来源；静态配置外置，秘密从环境变量或用户运行时输入读取。验证码拆成 `load → solve → verify`，按 `templates/captcha-verify/`（Node）或 `templates/captcha-verify-py/`（Python）骨架 + 本 case `result/src/adapter` 实现，答案层接入（`result/src/solver`）是交付组成部分；成功样本先逐字段确认明文类型、长度和绑定关系，再编写生成器，不得把一次性 challenge、ticket 或答案固定到代码。

## 10. REAL_VERIFY

默认验证是交付必要条件，不是可选演示。除非用户明确 sign-only，否则必须用最终纯协议入口向真实 API 发请求。只读/验签请求默认真实执行；有业务副作用的写请求执行前先宣布目标 URL、方法、次数和预期影响，随后继续。

**写请求格式取证（硬约束）**：提交/写入接口的请求格式（Content-Type、body 编码方式、字段名）必须从页面源码（`case/forensic/document.html` 的 form/submit 逻辑）或 capture.json 的真实成功样本取证，**禁止猜测**。常见陷阱：①页面用 jQuery `$.ajax({data: {...}})` 默认表单编码（`application/x-www-form-urlencoded`），AI 误用 `application/json`；②CSRF token 字段名/位置因站点而异；③提交接口路径与数据接口不同域。写请求前必须列出「Content-Type + body 构造依据」并引用 capture/document.html 具体行号，不得凭"通常用 JSON"发起请求（实战：JSON 提交持续被服务端拒，改表单编码即通过）。

进入真实请求前先完成离线回归：把取证阶段抓到的真实样本（同输入参数 + 浏览器侧期望输出）固化为 `case/fixtures/*.fixture.json`，用本地入口以同样输入生成实际输出，逐字段过门禁比对；任一字段不一致先回 IMPLEMENT 排查，不得带着已知偏差发起真实请求。**多请求 case（翻页/批量/序列调用）fixture 至少固化 2 个不同请求序号的样本**（如 page1 与 page2）：计数器/会话状态类 bug 只在第 2+ 样本暴露——match14 的 n 计数器在单样本下与沙箱恒 1 巧合一致（反模式 24），取证阶段即应覆盖 ≥2 序号成功样本：

```powershell
node scripts/compare_fixture.js --fixture case/fixtures/<样本>.fixture.json --actual case/tmp/<实际输出>.json --field <目标参数> --markdown
```

退出码 0（字段一致）才进入真实 API 验证；退出码 2 表示首个偏差点已定位，回 IMPLEMENT 修复后复跑。fixtures 属于可复核证据，脱敏后随交付保留。

范围纪律：黑盒输出与取证样本结构一致后，直接用真实目标 URL 进入 REAL_VERIFY；内部参数映射等旁支问题记录到 `经验沉淀-<站点>.md`，不阻塞主交付、不横向展开。

最低要求：连续完成不少于 5 次真实请求，并记录每次时间、HTTP 状态、目标参数摘要、会话阶段和响应判定。成功标准：

- HTTP 状态符合目标接口成功语义，且响应结构和业务数据正确，不只检查状态码。
- 动态参数在不同时间、输入或会话下按预期变化。
- Cookie、Token、TLS、Header、Body 序列化和请求顺序不依赖浏览器状态。
- 失败请求能区分签名错误、会话过期、资源过期、频率限制、IP 风控和业务参数错误。

`REAL_VERIFY` 阶段就把联网入口写成**可复用的 Session + 显式关闭**，避免交付门禁返工：Python 用 `requests.Session()`（`session.get/post` + `session.close()`）；Node 用 `https.Agent({ keepAlive: true })`（复用 + `agent.destroy()`）或 `got/scraping` session。裸 `urllib.request`/每次独立连接会被 `check_final_artifact.js` 的 Session 门禁（创建/复用/清理三件套）判不合格。

至少保留一份脱敏验证摘要和可复现命令；不得输出完整 Authorization、Cookie、Token、密钥或验证码答案。401/403/412/429 先诊断，不得用浏览器自动化或硬编码成功样本绕过。验证码交付在此之上追加两项记录：手动成功样本基线（`node scripts/check_success_baseline.js`，要求与豁免条件见 `references/captcha/verification-workflow.md`）与逐次尝试 attempts 复盘（`node scripts/check_verification_attempts.js`）；成功标准以「verify 返回通过凭据且业务接口消费凭据返回正确业务数据」为准，视觉答案正确不算通过。

**403/风控码分层定位协议（硬约束：下「连接层拦截 / 纯协议不可绕过」结论前必须完成）**：用「签名来源 × 连接来源」双对照定位拦截层，完整矩阵见 `references/network/ip-risk-control.md`：

1. **正向对照**：浏览器**新鲜**签名 + 纯协议客户端（curl_cffi 等）重放 → 200 ⇒ 连接层无问题，问题在自己的签名内容；403 ⇒ 连接层嫌疑才成立。内嵌 serverTime/时间戳的签名有有效期，对照必须用采集后立即重放的新鲜样本并记录采集→重放延迟；**用过期样本得到的 403 不构成任何结论**（实战误判：拼多多 40002 被误判为连接层风控）。
2. **反向对照**：自己的签名 + 真实浏览器连接（取证阶段 ruyipage `add_preload_script` hook XHR.open 替换目标参数，hook 必须带执行标记并验证）→ 403 ⇒ 服务端校验签名内容，与连接无关。
3. 定位为「签名内容被校验」后，用**对齐探针法**测量 SDK 实际内嵌的环境检测并逐位对齐（见 `references/env/env-detect-bypass.md`），不要先假设需要复现 canvas/行为轨迹等完整浏览器指纹。
4. **对照必须在健康 session 下做，且一次只改一个变量**：连续失败会触发站点惩罚机制（惩罚期内连浏览器基线请求都被拒，对照数据全部作废）；每组对照前先复刻一次确定成功的基线请求，失败即冷却后重做。HTTP 200 + 业务层风控文案时先按 `references/network/ip-risk-control.md` 会话状态类风控专节（蜜月期窗口/"频率墙"误判警示/失败惩罚）排查。

**引擎检测 case 的双对照浏览器侧**：取证浏览器被引擎级检测拒绝的 case（state 已过 BLOCKED_FORENSIC），双对照的浏览器侧——正向的「浏览器新鲜签名」与反向的「真实浏览器连接」——经 `--guard mcp` 用浏览器 MCP 连接用户真实浏览器执行（站点只接受真实内核时 ruyipage 无法承担该角色，match14 语境）；hook 必须带执行标记并验证、样本新鲜度与 `captureToReplayMs` 记录要求不变，对照产物落盘 `case/` 供审计。未经 BLOCKED_FORENSIC 的 case 浏览器侧一律用 ruyipage，不得借双对照名义引入 MCP。

未完成上述对照，不得宣布连接层风控结论，不得转而交付浏览器内核取数方案（取证浏览器脚本放进 `case/` 也算交付违规）。双对照结果写入 `result/验证记录.json` 顶层 `riskLayerDiagnosis` 字段（`forwardControl`/`reverseControl`/`conclusion`，正向必须含 `captureToReplayMs` 采集→重放延迟，反向必须含 `hookVerified: true`），并过门禁：

```powershell
node scripts/check_risk_layer_diagnosis.js --case-dir <project-root> --markdown
```

退出码非 0 = 对照缺失 / 样本过期 / hook 未验证 / 结论与对照矛盾，停在 DIAGNOSE 补对照，不得按未验证结论推进。

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

验证记录含 401/403/412/429 失败尝试（触发过分层定位）的 case，交付前追加：

```powershell
node scripts/check_risk_layer_diagnosis.js --case-dir <project-root> --markdown
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
| 混淆 JS 反混淆（`_0x`/字符串表/控制流平坦化，AST 改写） | `assets/ast-patterns/README.md` 入口：`detect-patterns.js` 检测家族 → `run-pipeline.js` 执行流水线 |
| 运行混淆 JS 验证行为（vm 沙箱 + 超时 + 环境访问日志） | `node scripts/run_with_trace.js --help`（禁止手写 vm runner） |
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
