---
name: js-reverse-skill
description: >
  网页端 JavaScript 加密参数逆向与纯协议还原：还原浏览器请求中签名、token、cookie、设备指纹的生成逻辑，
  覆盖标准算法、自定义混淆、JSVMP、WASM、TLS 指纹、Session 请求链与验证码 verify，交付 Node.js/Python 纯协议实现。
  不用于 App、桌面程序及 Native 逆向；小程序仅限纯 JS 参数还原。
---

# 通用网页端 JS 逆向技能

## 执行速查卡（上下文压缩/续接后先读这里重建主干）

- **初始化/推进**：`node scripts/state_machine.js --case-dir <project-root> --init --markdown`（已有 state.json 就直接读当前节点）；`--set <NODE> --note "<结论>"` 推进；细则见 0.0 节。
- **续接判定**：`check_session_resume.js --case-dir <project-root> --project-dir <project-root> --markdown` 判 resume/fresh（GATE-1，见 0.0 节）。
- **主线**：INTENT_CONFIRM → ENV_READY → EVIDENCE_GATE →（FORENSIC_CAPTURE → TRACE_CAPTURE）→ CASE_LOOKUP → IDENTIFY → TRACE_ANALYZE → IMPLEMENT → REAL_VERIFY → DELIVER → CLEANUP → DONE；打转信号：检索输出 `[WARN] 重复检索` 或 `[STATE]` 提示即执行 §4.4 防耗尽序列。
- **约束分级（第 2 节）**：`R0` 红线（不可协商）/ `R1` 门禁（脚本裁定，未过=补齐后复检）/ `R2` 默认（可偏离，说明一句）。
- **命令索引**：全量脚本见 `scripts/README.md`；各节点命令在对应节（取证/trace 4.2、检索与反混淆 7、分析 8、验证与交付 10）。**所有 `node scripts/...` / `python scripts/...` 命令必须在 skill 根目录执行**（相对路径入口依赖 cwd=skill 根；在 case 目录执行会「找不到脚本」并诱使手改 state.json）。

## 0. 分析前硬门禁（GATE-0~GATE-2）

### 0.0 状态机强制跟踪与动作守卫（R1）

全程用脚本跟踪“当前在哪个步骤”，让动作边界成为技术约束而非口头约定：

```powershell
# 初始化（写入 case/state.json，起点 INTENT_CONFIRM）
node scripts/state_machine.js --case-dir <project-root> --init --markdown
# 状态转换：--set 校验合法性（跳过必经节点直接报错，--force 放行但留审计）
node scripts/state_machine.js --case-dir <project-root> --set <NODE> --note "<关键结论>" --markdown
# 动作守卫：重放/写请求前 replay；外部检索前 external；MCP 兜底取证前 mcp（前置以绝对规则 8 为准）
node scripts/state_machine.js --case-dir <project-root> --guard <replay|external|mcp>
# 节点聚合门禁：进入每个节点前聚合跑该节点必验门禁；输出含 FAIL 或需参数缺失时停在当前节点
node scripts/gate.js --case-dir <project-root> --at <NODE> --url <目标URL> --inputs <材料路径> --markdown
```

换节点时脚本随输出投递 `[GUIDE]`（该节点操作细则的权威 references）与 `[RULE]`（该节点规则，未标级别者按 R1，见第 2 节）；正文只保留跨题通用规则与路由，冲突时以本文件为准。编号知识（反模式/规则）用 `node scripts/search_references.js --id` 按号提取（见第 12 节）。

**TODO 清单（R2 默认）**：上述命令每次输出都渲染 11 项单行勾选表（`[x]`/`[~]`/`[ ]`）并落盘 `state.json.todo`，**脚本输出即权威**。默认原样附在回复里，宿主有 TODO 工具时逐项同名同序同步；漏贴不判违规，不得手写清单代替脚本输出。

执行与 state.json 不一致（未 init、非法跳转、越权重放）是任务失败信号：回读 state.json 自修，禁止口头宣称代替 `--set` 与门禁输出；门禁/守卫拒绝即停（R1），`--force` 只用于显式声明例外且须在总结写明。

```text
GATE-0 INTENT（R2 自动推进）
  输出：目标 URL、接口 URL、目标参数、请求范围、已提供材料、初步反爬类型（假设）、是否需登录/人工验证码、默认真实验证或 sign-only 原因。
  推进：目标 URL + 目标参数可提取即进 GATE-1，不问补充材料、不确认范围；两者缺一且无法合理提取才问一次最小信息。用户随时可打断。
GATE-1 ENV（resume 可跳过自检）
  node scripts/check_session_resume.js --case-dir <project-root> --project-dir <project-root> --markdown
  resume → 读最新阶段报告续接（GATE-0/GATE-2 仍必须完成）；fresh → 依序跑：
  node scripts/check_external_tools.js --markdown --project-dir <project-root> --offline
  node scripts/precheck_runtime.js
  未通过 → 先宣布缺失组件、安装到 <project-root>/tools/ 的规模与影响，再：
  node scripts/install_all.js --project-dir <project-root> --yes --markdown
  通过后写快照：node scripts/check_session_resume.js --case-dir <project-root> --project-dir <project-root> --write-snapshot --markdown
GATE-2 EVIDENCE（R1 硬阻断）
  node scripts/check_evidence.js --case-dir <project-root> --url <target-url> --inputs <材料路径> --markdown
  Step 1 接口已知加 --require-network-signal <目标接口URL或关键词>；Step 2 writer/API 已知加 --require-trace-signal <环境 API / writer / 参数写入点>
  （两类信号分开约束；不要把 JSONP/script/导航 URL 当 trace 信号）
  用户材料旁路（取证源③）：用户直接提供 cURL/HAR/请求文本/NDJSON/JS 时，先落盘再走 --inputs 组合判定——材料命中 Step 1/Step 2 即免对应取证（两类齐备免启动 ruyipage/RuyiTrace），按状态机正常节点推进，并在经验沉淀写明材料来源。
  退出码 0 且无「缺失证据」→ 进入状态机；否则停在 EVIDENCE_GATE，按 4.2 补证后复检。
```

续接模式只跳过 GATE-1 环境自检，**不跳过** GATE-0 意图声明与 GATE-2 证据门禁。

Windows 下手动跑 Python 脚本用环境检查选定的解释器（通常 `py -3`）；裸 `python` 可能命中 WindowsApps stub 静默失败（exit 9009）。

## 1. 任务边界、授权与确认策略

用户发起本技能请求即代表已在合法授权范围内，默认直接协助：不要求授权证明，不反复确认。确认按「对外部世界的影响与可逆性」分三档：

| 档位 | 判定 | 动作 | 典型场景 |
|---|---|---|---|
| A | 证据/选择可自动判定 | 自动推进，不停下 | 目标 URL/参数认定、证据门禁判定、TLS 客户端选择、fingerprint baseline 切换（重新采样统一后宣布继续）、原始日志与登录态 profile 处置（默认保留并说明，用户明确要求才删） |
| B | 有外部副作用或不可逆 | 执行前宣布 + 继续 + 可打断 | 工具安装、真实写请求 |
| C | AI 不可替代的物理交互 | 停下等用户，期间并行推进其他分析 | 登录、验证码、人工识别、手动 trace、付费打码平台 |

**连续执行总则（横切全部阶段；先决条件以第 0 节门禁为准）**：默认单会话连续执行到 DONE，唯一停点是 C 档。GATE 结果、状态行、B 档宣布、报告落盘、卡点说明都是执行流内动作，输出后立即继续；落盘中间产物 ≠ 阶段终点。门禁失败先自修复复检，连续 2 轮仍失败才输出卡点与默认方向（继续攻坚）并继续——禁止以「已保留中间产物，请确认下一步」结束回合。

任务边界：

- 处理对象：网页端 JS 签名、Cookie/Token、设备指纹、混淆、WASM、JSVMP、验证码 verify、Session/TLS 请求链与隐蔽信道参数；覆盖桌面网页、移动 H5 与内置浏览器；不用于 App、桌面程序、Native 逆向。小程序底层多为 JS 封装（wx 对象即 JS），其**纯 JS 参数还原**走本 skill Web 路径；涉及 Native .so、加壳或非 JS 层超出范围。
- 交付要求：可审计、可复现、可维护的纯协议实现；浏览器只用于取证与运行时观察（红线见第 3 节）。
- 技术栈：Node.js 与 Python；优先复用成熟实现；新增依赖写入依赖契约并确认来源与版本。

## 2. 约束分级与绝对规则

所有约束分三级：级别决定能否偏离与谁有裁定权，同时属多级时按最高级执行。下文用 `R0`/`R1`/`R2` 标注，未标注者按语境判断、拿不准按更高级执行：

| 级别 | 含义 | 偏离条件 | 裁定方 |
|---|---|---|---|
| **R0 红线** | 合规、安全、防伪证、交付边界 | 无例外条款；「用户没反对」「时间紧」不放宽 | 不可协商 |
| **R1 门禁** | 证据与产物的准入条件 | 未过 = 停在当前节点补齐后复检，**不是违规** | 脚本退出码 / 落盘产物 |
| **R2 默认** | 顺序、格式、话术等流程约定 | 有理由即可偏离，说明一句 | 本次证据 + 用户约束 |

1. **（R0）本次证据**：关键结论必须有本次任务证据——RuyiTrace NDJSON、网络请求记录、落盘 JS、调用栈、运行时变量、中间值对比或用户提供的真实材料。
2. **（R0）历史案例只是假设**：不作替代证据；与本次 trace 冲突时以 trace 为准。
3. **（R1）先定位请求链，再定还原方式**：未过 GATE-2 就猜算法、补环境或写最终代码，即停在当前节点补齐。
4. **（R0）JSVMP 边界**：默认黑盒执行或最小环境复现，不反编译字节码源码。
5. **（R0）交付边界**：最终交付须能在无浏览器、无显示器、无 X11 环境独立运行。
6. **（R1）默认真实验证**：仅用户明确要求「只输出参数」「不发真实请求」时走 sign-only。
7. **（R0）秘密材料**：不记录、提交或硬编码密钥、完整登录 Cookie、Authorization、验证码答案等秘密材料。
8. **（R0）取证只允许四源**：① ruyipage 定制 Firefox（`scripts/forensic_ruyipage.py`）② RuyiTrace（`scripts/capture_ruyitrace_log.js`）③ 用户手动提供材料 ④ 浏览器 MCP 连真实 Chrome 内核（**仅 BLOCKED_FORENSIC 降级兜底**：取证浏览器被引擎级检测拒绝且 `--ua` 覆盖无效时，经用户确认并过 `--guard mcp`；产物必须落盘 `case/`，后续分析只认落盘产物，只取证不交付）。四源之外一律封死：不得手写 fetch/curl/requests 抓目标页或下载目标 JS，不得用系统 Chrome/Edge/Firefox、Playwright/Puppeteer/Selenium 或浏览器 MCP 取证（④ 不满足前置时同样禁止）；DOM 模拟库（jsdom / happy-dom / domino）不得**联网加载目标页**取证（`JSDOM.fromURL()`、`resources: 'usable'`、传目标站 `url` 均属联网取证通道），合规形态见第 3 节。

## 3. 纯协议红线

- 不交付 Playwright、Puppeteer、Selenium、浏览器扩展、浏览器 MCP 或 ruyipage/RuyiTrace 自动化代码；交付物不得使用浏览器、浏览器自动化或浏览器运行态生成参数（含打开网页、执行页面脚本、读取浏览器状态）。
- 不以自动化浏览器完成反爬挑战；不把浏览器抓到的关键 Cookie 或动态秘密当固定常量或签名来源。唯一例外：目标参数是**设备级凭据**且沙箱/纯协议无法自生成时，说明并经用户确认后走配置注入，标注来源与有效期；未经确认即违规。
- 用 jsdom / happy-dom / domino 时不得联网加载目标页生成参数（HTML 用本地字符串、脚本取自本 case 落盘产物、不开 `resources: 'usable'`、不传目标站 `url`）；动态挑战类目标确需在线执行官方 JS 时例外，走 `references/env/runtime-frameworks.md` 的 sdenv 路径并在总结标注联网依赖。
- 交付入口必须是 Node.js `final.js` 或 Python `final.py`，运行时只用 HTTP、TLS、密码学、序列化与必要的最小 JS 沙箱能力。
- 通用模板不得在 `assets/templates/` 预填真实厂商的接口名、字段名、HTTP 方法、JSONP、加密结构、凭据字段或默认轨迹；平台细节由本 case 的抓包、RuyiTrace 与成功样本驱动，落在 case adapter/result 中。
- 厂商知识分级（T1 识别指纹 / T2 协议语义）不得越界：识别信号（参数名↔算法族映射、厂商 Cookie/组件名、响应码特征）只留在标注过的识别参考（`references/crypto/algorithm-families.md`、`references/network/ip-risk-control.md`）与分类脚本（`scripts/classify_verify.py`），不进通用 workflow/质量文档；协议知识（字段语义、加密结构、接口链、实测轨迹参数）只留在 `references/captcha/`、`cases/*.md` 与 case adapter（带验证日期）；通用文档与案例表不得出现具体厂商名、平台名或协议参数，引用只写「见 <知识库/案例>」。
- 交付物不得依赖 skill 仓库路径、临时脚本、系统浏览器 profile 或用户机器登录态。
- 关键 Cookie / 凭据必须区分静态配置、运行时生成值、服务端下发值、会话绑定值与**设备级凭据**（后者只走上述例外路径）；禁止把成功样本中的动态秘密复制进代码。

判定标准：删除浏览器和显示环境后，交付程序仍能独立生成请求并得到预期响应。

## 4. 唯一启动状态机与执行主线

状态转换是唯一准入规则，旧版编号清单不得并行执行。（命令参数细则见 `scripts/README.md`，trace 策略见 `references/workflow/trace-flow.md`；本节只讲状态流转与门禁。）

```text
INTENT_CONFIRM ─ 范围明确 → ENV_READY；缺信息 → WAIT_USER
ENV_READY ─ 环境正常 → EVIDENCE_GATE；缺失 → 修复后重检
EVIDENCE_GATE
  ├─ Step 1 + Step 2 均具备 → CASE_LOOKUP
  ├─ 只有 Step 1 → 先过「速通路径速查」（4.2）：命中全明文/源码可读形态且用户确认免采 → CASE_LOOKUP（义务见 4.4 例外 4）；未命中/未确认 → TRACE_CAPTURE（RuyiTrace 不可用且自动安装失败 → MATERIALS_FALLBACK）
  ├─ 只有 Step 2 → STEP2_ONLY
  └─ 两步均缺 → FORENSIC_CAPTURE
MATERIALS_FALLBACK（工具不可用降级，见 decision-tree.md 阻塞点#5）
  ├─ 用户材料（JS/cURL/HAR，含经确认的浏览器 MCP 代采落盘产物）过 check_evidence.js 内容校验 → CASE_LOOKUP
  │  （必备声明：经验沉淀与最终总结写明未走 ruyipage/RuyiTrace、证据为手动材料 + 真实请求反证）
  └─ 仅 URL 或校验不过 → FORENSIC_CAPTURE（先修工具）
STEP2_ONLY → CASE_LOOKUP
FORENSIC_CAPTURE ─ 终态 2xx 命中 → TRACE_CAPTURE；持续被拒且定位到内核级/环境检测阻断 → BLOCKED_FORENSIC
BLOCKED_FORENSIC（被检测阻断，与工具缺失不同；未定位到检测证据不得进入）
  ├─ UA 类检测 → forensic_ruyipage.py --ua 覆盖后重采 → 达成则 TRACE_CAPTURE
  └─ UA 覆盖无效的引擎级检测（eval.toString/Error.stack 等，见 references/env/env-detect-bypass.md）→ 对齐用户后三选一：
     ① 浏览器 MCP 连真实 Chrome 内核取证（过 `--guard mcp`，样本落盘 case/，按用户材料归类过 MATERIALS_FALLBACK 校验）
     ② 用户提供真实浏览器 cURL/HAR 走 MATERIALS_FALLBACK
     ③ 用户确认降级（义务同 MATERIALS_FALLBACK：总结写明 Step 2 缺失原因）
TRACE_CAPTURE ─ 采集成功+质量达标+出口门禁复检通过 → CASE_LOOKUP；质量不足 → TRACE_RETRY；采集失败 → 转手动 trace
TRACE_RETRY ─ 重试达标+复检通过 → CASE_LOOKUP；仍不足 → 降级补充并标 trace 未覆盖；全失败 → 用 FORENSIC_CAPTURE 证据继续 + 总结声明 trace 缺失
CASE_LOOKUP ─ 本地命中且时效校验通过 → IDENTIFY；未命中 → EXTERNAL_LOOKUP
EXTERNAL_LOOKUP（前置：已有本次取证产物 + `--guard external`）─ 方案可读 → IMPLEMENT；搜不到或黑盒 → FORENSIC_CAPTURE
IDENTIFY → TRACE_ANALYZE → IMPLEMENT → REAL_VERIFY
REAL_VERIFY ─ 验证通过 → DELIVER；失败+有 trace → DIAGNOSE；失败+无 trace → FORENSIC_CAPTURE；sign-only → SIGN_ONLY_DELIVER
DIAGNOSE（403/风控码失败首选入口；双对照协议见第 10 节）
  ├─ 200 + 业务层风控文案 → 会话状态类风控（蜜月期/惩罚计数；"放慢速度"类文案在签名确认正确前不得按字面归因频率，按 ip-risk-control.md 专节排查；惩罚期内基线失败 → 冷却不做实验）
  ├─ 正向 200 + 反向 403 → 签名内容层 → 环境检测对齐（探针法）→ IMPLEMENT
  ├─ 正向 403 → 连接层嫌疑成立 → IMPLEMENT 路径 E（TLS/Session 对齐）
  ├─ 会话/资源/频率/业务参数错误 → 对应修复 → IMPLEMENT
  ├─ 确认取证浏览器被引擎级毒化（浏览器自身 400 且 --ua 无效，或与真机同输入对拍不一致）→ 补登记 BLOCKED_FORENSIC（match21：该证据常在分析阶段才齐备）
  └─ 双对照未完成（过期样本/hook 未验证标记/惩罚期污染数据）→ 停在 DIAGNOSE，不下拦截层结论、不转浏览器内核方案；过 check_risk_layer_diagnosis.js 后按结论路由
DELIVER / SIGN_ONLY_DELIVER → CLEANUP → DONE
```

**TRACE_CAPTURE / TRACE_RETRY 出口门禁（R1）**：进 CASE_LOOKUP 前必须复跑 `check_trace_gate.js` 复检（退出码 0 放行）；命令、信号语义与「NDJSON 已产出但 writer 未命中 = 进 TRACE_RETRY，不得写成“没有 trace”」判定见 `references/workflow/trace-flow.md`「TRACE_CAPTURE 出口门禁复检」。

**阶段动作边界与外部检索时序（R1，`--guard replay|external|mcp` 裁定）**：每个节点只做本节点允许的动作，前置阶段不得发起外部重放/对照实验；向目标接口发真实请求（含“只发一次看看返回什么”）前先过 `--guard replay`，外部题解检索前先过 `--guard external`（退出码 0 放行，越权退出 2 并写 `blocks` 审计）；自我判断“这算 DIAGNOSE”不构成放行依据——守卫读 `state.json` 实际节点。外查只允许在 CASE_LOOKUP / EXTERNAL_LOOKUP / DIAGNOSE 进行（取证前外查会被过期情报带偏）；情报一律标为假设、以本次证据为准（绝对规则 2）、逐条验证后才升级为结论。允许范围、越权代价与情报处置细则见 `references/workflow/phase-flow.md`「阶段动作边界与外部检索时序」。

### 4.1 路径、意图与环境

`<project-root>` 是项目根目录，其下**平级**为 `case/`（取证与分析中间产物）与 `result/`（交付物）；`notes/` 在 `case/` 内，**不与 `result/` 平级**：

```text
<project-root>/         # 所有脚本的 --case-dir 传这一层
├─ case/                # 中间产物，可清理
│  ├─ state.json        # 状态机（state_machine.js --init 写入）
│  ├─ notes/            # env-snapshot.json / entry-chain.md / missing-env-priority.md 等门禁依赖
│  ├─ 阶段报告/ tmp/ fixtures/ requests/ hooks/ env/ forensic/
│  ├─ js/{original,pretty,extracted}/  ruyi-trace/logs/  browser/ruyipage/
└─ result/              # 交付物：final.js|final.py、config.json、最终项目总结.md、经验沉淀-<站点>.md、验证记录.json、src/
```

多 case 同目录时，**每个 `<case-name>/` 自身就是一个 `<project-root>`**，`tools/` 放外层共享：`<workspace>/{tools/, <case-a>/{case,result}, <case-b>/{case,result}}`。

`--case-dir` 统一传 `<project-root>`；`scripts/lib/paths.js` 的 `resolveCaseDir()`/`resolveResultDir()`/`resolveNotesDir()` 是唯一路径真源（兼容 `<project-root>` 与 `<project-root>/case`），脚本内不要自行拼 `caseDir/result`。环境检测用 `--project-dir` 指向 tools/ 所在工程根，多 case 共享时自动上溯含 `tools/` 的祖先目录。

从请求中提取目标 URL、接口 URL、目标参数、方法、范围与项目根（推进规则见 GATE-0）；实现若需额外动态参数，列出参数名、位置、用途假设与证据后纳入请求链范围。

用户约束与 skill 规则的仲裁（启动阶段只裁定一次）：用户说「不接受浏览器自动化」「不用 Playwright」，默认约束**最终交付物**（第 3 节），不改取证阶段允许 ruyipage 定制 Firefox / RuyiTrace 的规则（绝对规则 8）；「忽略已有案例经验」指不直接套用历史结论（绝对规则 2 的 CASE_LOOKUP 时效校验仍在），不是跳过必经节点。仅当约束明确指向取证动作本身（如「不许打开浏览器」）时才问一次确认。

环境检查与快照写入按 GATE-1 执行，不因已有阶段报告或 `result/` 跳过；用户说明重装 Node、替换 Firefox、迁移 tools 或升级 ruyipage/RuyiTrace 时重跑完整环境检查，不沿用旧快照。

### 4.2 取证与证据门禁

URL 不是证据——脚本确认文件真实存在且可归类才允许跳过对应步骤；退出码非 0 或输出含「缺失证据」时停在 EVIDENCE_GATE 补证复检，禁止进入 IDENTIFY/TRACE_ANALYZE/IMPLEMENT。

- Step 1：有效 `capture.json` 网络记录，或过内容校验的 HAR、cURL、原始 HTTP 请求文本；目标接口已知时加 `--require-network-signal <目标接口URL或关键词>`。Step 2：可解析、非空且关联目标域的 RuyiTrace NDJSON/JSONL（`ruyitrace-summary.md` 不算）；Step2-only 时先导入生成摘要再定位，不重复采集。单独 JS、截图或指纹基线只作辅助材料，不计为 Step 1。

**取证前速查（R2）**：路由到 FORENSIC_CAPTURE / TRACE_CAPTURE 后、发起采集前，先按第 5 节跑 `search_cases.js`；命中则提取三项情报（校准 `--targets`、坑点与采集参数建议、题型假设）写入状态行后再取证，未命中按全新 case 取证。速查只是假设与路径提示（绝对规则 2）。

网络取证（入口页 HTML 自动存 `case/forensic/document.html`）：

```powershell
python scripts/forensic_ruyipage.py --url <target-url> --case-dir <project-root> --targets <最终业务接口关键词> --markdown
```

- 先 `--set` 本节点再发起取证（取证完成再补设会被拒绝）；`--targets` 只写唯一标识终态接口的完整路径子串（禁宽正则，反模式 22）；禁止手写取证探针；`--ua` 只覆盖 UA（内核级检测无效，按 BLOCKED_FORENSIC 处理）；`--cookie/--cookie-domain` 仅注入会话、不替代交付实现；退出码三态与预算上限见 `references/workflow/trace-flow.md`「取证验收标准 / 操作细则」与 `scripts/README.md`。

终态目标请求未命中 = Step 1 缺失，禁止转源码搜索继续；JS 关键词定位只作辅助假设（用户也可提供 cURL/HAR/原始请求文本），终态命中落盘后再回 EVIDENCE_GATE。

**速通路径速查（发起 trace 采集前必查，R1）**：EVIDENCE_GATE 判定「只有 Step 1」时、启动日志采集前，先判定可否免采 Step 2（两种形态：全明文采集型 / 简单加密源码可读型）；命中即单行向用户提议（形态 + 判定依据 + 免采 Step 2），用户确认 → 跳过 TRACE_CAPTURE 直接 CASE_LOOKUP；未确认或未命中 → 正常采集。形态判据、落盘要求与失格规则见 `references/workflow/trace-flow.md`「速通路径判定」；判定材料须落盘引用、不得凭页面观感定性，AI 不得以「看起来简单」自行免采。

日志采集：

```powershell
node scripts/capture_ruyitrace_log.js --url <target-url> --case-dir <project-root> --evidence-signal <环境API或签名写入点关键词> --end-signal <明确完成事件> --import-after --markdown
```

- 信号语义：`--evidence-signal` 只传**浏览器内建 API/写入点**（参数名、请求头名，如 `noncestr`、`Headers.set(...)`）；四类必然不命中、一律不传——①目标接口 URL ②裸 `createElement` 等泛化 API（门禁会拒绝）③密钥/常量名 ④站方自定义函数/方法名。`--end-signal` 只控制提前关闭；`--target-signal` 仅兼容旧调用。信号记录形态、定向收窄与闸门参数见 `references/workflow/trace-flow.md`「定向 trace 策略 / trace 信号的记录形态与匹配规则」与 `references/tooling/ruyi-tooling.md`「闸门窗口」。

用户已提供 NDJSON 用 `--input <ndjson>` 导入生成摘要，不重复采集；多进程日志用 `import_ruyitrace_log.js --input a --input b` 合并导入，复制到 case 时按来源摘要命名避免同名覆盖（见 trace-flow.md）。目标请求需手动触发时，提示用户在 trace 浏览器中操作；用户确认“已触发”前不得结束采集。

**质量判定与 TRACE_RETRY（R1）**：采集到 NDJSON ≠ 达标；重度不足判据与降级顺序见 `references/workflow/trace-flow.md`「Trace 质量判定与重试」（含「合并所有 tab/content 进程文件」与「禁止跳过重采直接转静态分析」）。

**TRACE_CAPTURE 出口门禁复检（R1）**：采集声明完成、进 CASE_LOOKUP 前必须复跑 `check_trace_gate.js`（退出码 0 放行）；`--trace-signal` 命中「环境 API / 签名写入点」而非网络 URL，两类判定（未命中 = 硬信号进 TRACE_RETRY；网络 URL 未覆盖属预期）与退出码语义见 `references/workflow/trace-flow.md`「TRACE_CAPTURE 出口门禁复检 / trace 信号的记录形态与匹配规则」。

### 4.3 EXTERNAL_LOOKUP

本地 CASE_LOOKUP 未命中时，搜网络已有方案作假设来源（目标域名 + 参数名 + “逆向/签名/加密”），不替代本次证据。

- 算法可读 → 方案作假设进 IMPLEMENT；黑盒、来源不可信或搜不到 → FORENSIC_CAPTURE。
- 网络方案失败后不得反复试方案；验证失败且当前为轻量路径时，强制升级 FORENSIC_CAPTURE。

**EXTERNAL_LOOKUP 豁免（R1）**：仅当 Step 1 + Step 2 齐备且 TRACE_ANALYZE 已定位 source/entry/builder/writer 时可跳过直接 IMPLEMENT，须在状态行或阶段报告声明「EXTERNAL_LOOKUP 豁免：Step1+Step2 齐备 + 链已定位」；仅凭「本地案例未命中」不得跳过；CASE_LOOKUP 始终必经（不得从 EVIDENCE_GATE 跨过进 TRACE_ANALYZE）。

### 4.4 状态记录与 IMPLEMENT 前置条件

每次状态转换默认输出一行状态行（R2 模板，缺项按语境补齐）：`当前状态(证据状态) → 目标状态(关键结论)`，含 ①当前状态与证据状态（Step1/Step2 齐备情况、trace 质量）②跳过必经节点（CASE_LOOKUP / EXTERNAL_LOOKUP）的豁免依据 ③trace 未覆盖目标接口 URL 字面量时带「trace 定位依据：<写入点/关键词>」。

示例：`TRACE_ANALYZE(Step1+Step2 齐备，noncestr 写入点命中) → IMPLEMENT`；`DIAGNOSE(正向对照 200 + 反向对照 403 → 签名内容层，探针法 diff 出 4 差异位) → IMPLEMENT`。关键结论随节点落盘，供压缩/续接使用：

```powershell
node scripts/write_stage_report.js --case-dir <project-root> --stage <阶段> --input <草稿.md> --markdown
```

输出到 `case/阶段报告/`；状态失败时停在当前节点，不把失败标记为通过。

**阶段报告按需落盘（R2）**：多轮复杂补环境 / 跨会话续接风险 / 防耗尽触发 / 用户要求时生成。关键结论（IDENTIFY 结论、WASM 黑盒跑通、body 结构确认、实现方案选定等）必须写入 `case/阶段报告/`，最小报告含当前状态、已证实事实、缺失证据、下一步输入；落盘后立即按「下一步输入」继续（见第 1 节）。

**IMPLEMENT 准入三件套（R1）**：进 IMPLEMENT 前按序完成，任一缺失停在 TRACE_ANALYZE；**禁止先根据 Node.js 报错盲补**（会陷入十几轮「加载→崩→猜」空转）：
1. 产出 `notes/entry-chain.md` 与 `notes/missing-env-priority.md`（内容要求见 `references/env/env-debug-loop.md`「进入条件」）；**两文件缺一不得开始补环境**。
2. `node scripts/check_env_prerequisites.js --case-dir <project-root> --markdown` 退出码 0。
3. `node scripts/check_trace_gate.js --case-dir <project-root> --markdown` 退出码 0（缺失判定与例外见下段）。

**上下文防耗尽检查点（R1）**：TRACE_ANALYZE / IMPLEMENT / REAL_VERIFY 满足其一即已触发：① 同节点 20+ 步未推进（`state.json.stepCount` 自动计，12 步 WARN、20 步起 `--guard` 拒绝）② 「想问用户 vs 再试一轮」摇摆超 2 轮 ③ 同一决策反复权衡 ≥2 次或重复检索 ④ 脚本 WARN。触发后：补准入两文件 → 落阶段报告并继续 → 输出卡点+默认方向继续；不得以「预防性落盘」提前触发。细则见 `references/workflow/phase-flow.md`「上下文防耗尽检查点」。

**收尾保底（R1）**：无论预算消耗到什么程度，进入收尾时交付物清单不得缩水——`最终项目总结.md`、`经验沉淀-<站点>.md`、`验证记录.json` 与 `check_final_artifact.js` 门禁一项不可省；只写总结就收场 = 任务未完成。

**IMPLEMENT 前置条件（R1）**：满足「trace 质量达标（含目标信号命中）」「轻量路径豁免（4.3，前提 Step1+Step2 齐备）」「速通免采 Step 2（4.2 速查 + 例外 4）」之一；都不满足就停在 TRACE_ANALYZE，不得以 mock、猜测或实验性实现替代证据。EXTERNAL_LOOKUP 假设与 trace 定位的 builder/writer 冲突时以 trace 为准。

**Step 2 缺失（check_trace_gate.js 退出码 1）时不得进入 IMPLEMENT**：不得以 EXTERNAL_LOOKUP 网络方案、边界声明、同族算法替代或 mock 填补缺口（轻量路径豁免的前提是 Step 1 + Step 2 齐备，见 4.3）。例外四个（**AI 自行判定「trace 采集不到/太难」不构成降级理由**；例外 1、2、4 的 REAL_VERIFY 不可豁免；四个例外都须在经验沉淀与最终总结写明取证偏差或判定依据）：

1. **MATERIALS_FALLBACK**（需用户显式确认）：RuyiTrace 不可用且自动安装失败 + 用户材料过 check_evidence.js 校验，以「Node 直连真实接口、服务端响应反证」替代 Step 2。
2. **BLOCKED_FORENSIC**（需用户显式确认）：内核级检测使 RuyiTrace 无法触发目标路径，以 Step 1 网络证据 + 落盘 JS 源码分析替代。
3. **内容还原型豁免（无需用户确认）**：请求侧参数全明文且难点在响应解密/内容还原、Step 1 已捕获完整响应证据——声明「Step 2 豁免：内容还原型」后跳过 TRACE_CAPTURE 直接 CASE_LOOKUP。
4. **速通路径（Step 2 免采，需用户确认）**：按 4.2「速通路径速查」命中且用户确认；形态②对拍不一致即失格，回 TRACE_CAPTURE，禁止枚举猜算法。

各例外的判据细则、检测证据要求与材料义务见 `references/workflow/decision-tree.md`「取证例外通道」。

## 5. CASE_LOOKUP

不扫描全部案例，按域名、参数名、SDK 名称、状态码和网络特征组合关键词：

```powershell
node scripts/search_cases.js <关键词...>
node scripts/search_cases.js --domain <域名> --signal <信号>
```

只读命中案例，提取可复用定位方法、已知坑点、验证日期；做时效校验——JS URL/文件名/资源版本、sha256 或资源清单、参数名称/长度/写入位置/请求链均一致才复用算法，否则降级为方法论参考。未命中进 EXTERNAL_LOOKUP。新经验写入本次 `result/`，不改 skill 仓库的 `cases/`。

目标为 match.yuanrenxue.cn（教学靶场 match 题）时，先读平台共性基线 `cases/yuanrenxue-match-platform.md`（请求/提交链路、末页 UA、sessionid 数据绑定、风控底座、token failed 多义性等，match4~29 沉淀），再按 `cases/yuanrenxue-match-index.md` 题号速查定位该题案例；平台共性仍是假设，各题风控独立，须本次取证逐项验证。

## 6. 范围与环境复核

案例证据显示目标接口、参数或运行环境与初始范围不一致时回 INTENT_CONFIRM；工具环境变化时回 ENV_READY；未变化直接进 IDENTIFY。

## 7. IDENTIFY

先比较至少两组请求（计数器递增与纯随机难分辨时补第三组），把字段分为固定值、时间值、随机值、会话值、服务端下发值、加密值；随请求序号递增的字段单独标记为**请求序号计数器**——服务端可能校验其等于页码/请求序号（match14 的 `window.n`：page2 要求 n=2），签名生成器必须与浏览器生命周期对齐（SDK 加载一次、计数器随每次签名调用递增；每请求重建沙箱会使计数器恒 1，只有首个请求通过）。对每个目标参数建立 `source → entry → builder → writer` 链。

**参数名存在 ≠ 参数生效（比较前先核对真实请求）**：页面源码里的参数名可能是 hook 遗留、旧版残留或求值为 `undefined` 被请求库丢弃。分组比较前先以 `case/forensic/target-hits.json` 的 `url` 或 trace `xhrNative` 的 `url` 为准确认参数**真实存在于请求中**，不以 `document.html` 的字面量为准。

**T1 识别信号路由表（信号 → 初始路径）见 `references/crypto/algorithm-families.md`**——识别信号属 T1 指纹，按第 3 节厂商知识分级不得驻留通用文档。

识别结果必须引用落盘资源、NDJSON 或网络包具体字段，不以站点名称直接定类。特征驱动的识别入口与配套工具（输出均为 T1 假设，不构成协议复现依据）：

```powershell
# 密文/哈希特征 → 算法族假设（长度/字符集/结构/magic bytes）；长样本必须走 --file 防 shell 截断误判
node scripts/identify_crypto.js --value <密文样本> --label <参数名> --markdown
node scripts/identify_crypto.js --file <样本文件路径> --markdown
# Cookie 归因：capture.json Set-Cookie（服务端）× trace cookie 写入（JS）融合，判定每个 Cookie 生成方
node scripts/analyze_cookie_attribution.js --case-dir <project-root> [--cookie <名称>] --markdown
# 用户追问「哪些接口携带该头/是否校验」：先 search_capture 盘点抓包接口谱，再上 probe_endpoints 四态对照
node scripts/search_capture.js --capture <project-root>/case/forensic/capture.json --by-header <头名>
node scripts/probe_endpoints.js --session <会话cookies> --endpoints '<JSON数组>' --tokens '<JSON对象：valid/garbage/tamper>'
# 混淆 JS 反混淆（命中 _0x / obfuscator / 控制流平坦化时；babel 依赖安装见 scripts/ast-patterns/README.md）：
node scripts/ast-patterns/scripts/detect-patterns.js <input.js> [hint]        # 1) 先检测混淆家族
node scripts/ast-patterns/scripts/run-pipeline.js <input.js> <output-dir> [hint]  # 2) 执行反混淆流水线（分层、可回退）
```

**运行混淆 JS 禁止手写 vm runner（R2）**：用 `run_with_trace.js`（内置 vm 超时保护与环境访问日志；命令见第 8 节）。手写 runner 无超时保护，混淆脚本的反调试死循环（`while(!![])` 等）卡死后无法区分「挂起」与「静默失败」。字符串数组解码优先走 ast-patterns 流水线，只在不适配时才写最小提取脚本（写前过 `node --check`）；桩不足用 `--env-module <文件>` 注入（自动切 minimal bootstrap 防默认桩泄漏改变环境分支）+ `__overrideGlobal` 受控覆盖（写保护沙箱直接赋值会被静默拦截）；自引用解码器的执行纪律见反模式 31。

`identify_crypto.js` 只做族级指纹（同长度的 SHA-256/SM3 无法仅凭密文区分），实现仍以 trace 定位的 builder/writer 为准。`analyze_cookie_attribution.js` 判定每个 Cookie 生成方：server → 复现请求链、禁止硬编码；js → 按写入点 stack 还原挑战/签名算法；both → 按请求顺序拆分串联链。

验证码/JSONP 链路的最低证据：`callback 注册 → script.src/请求参数构造 → script 插入或等价网络写入 → load/verify 请求 → callback 执行 → 结果回调`。仅命中 `createElement`、`appendChild` 或页面初始化 API 不算 writer 覆盖；trace 只覆盖环境读取时，必须在阶段报告与最终总结中明确未证明请求写入。

验证码配套门禁（识别为验证码 case 后必用）：题型/厂商判定跑 `python scripts/classify_verify.py`；滑块先判缺口坐标来源（`references/captcha/gap-coordinate-source.md` 的 A/B/C 路线）；answer JSON 提交前过 `node scripts/check_captcha_answer.js`，FAIL 不得进入参数化实现。

## 8. TRACE_ANALYZE

**先 trace、后读源码（R2 默认）**：先 `import_ruyitrace_log` 出摘要，再 `search_trace --url <target-signal>` 定位请求链与 `stack.file:line:col`，最后才按行号/偏移切源码片段。**JSVMP 判定后先核对 eval 落盘**（规则 39/反模式 37）：有 `eval_*_eval-direct.js` 直接读（落盘即解混淆后逻辑），并 grep 其源码 `token`/`case 64` 定位 data 构造点。禁止拿 trace 前读大 bundle 猜 webpack module id 或写 probe1~N 静态解析；定位大文件关键词必须用 `search_js.js`，禁止 grep 单行超 64KB 的压缩 JS、禁止手搓 `node -e`。**响应体非明文（`code` 非 0、`data` 二进制/乱码）同理**：先查 trace xhrNative 记录确认形态，再按响应方向四层（response→reader→decoder→parser，见 `references/crypto/crypto-entry.md`）追链，禁止先搜源码密钥串猜算法。

**Windows 写临时脚本规范（探针/runner/补环境脚本，R2）**：优先用编辑工具直接写文件；必须用 PowerShell 时用单引号 here-string `@'...'@`（不做 `$` 插值）+ `[IO.File]::WriteAllText($path, $content, [Text.UTF8Encoding]::new($false))` 落盘；禁止双引号 here-string、base64 绕路与 `node -e`/`python -c` 内联长脚本。写完先 `node --check` / `py -3 -m py_compile` 再执行，避免把转义错误误判成目标 JS 行为。沙箱跑混淆 JS 走 `run_with_trace.js`（见第 7 节）。

**依赖 JS 版本校验（R2）**：黑盒 SDK 可能**定期更新**（公钥/算法随版本变化），旧副本会导致「格式全对但服务端全拒」且极难排查——进实现前用 `curl -s <url> | md5sum` 对比本地副本；抓取 JS **一律二进制**（禁 `decode('utf-8', errors='ignore')` 后文本写回，静默丢字节）。交付脚本对关键依赖内置「启动自动抓取 + hash 对比」（细节见 `references/network/dynamic-resource.md`）。

读取 NDJSON 的 API、时间、stack、文件、行列号与参数摘要，按调用频率与网络写入时间定位热路径。按序使用：

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
# 4) 需要运行混淆 JS 观察行为/补环境探测时（禁手写 vm runner，见第 7 节）
node scripts/run_with_trace.js --target <project-root>/case/js/original/<资源名>.js --entry <入口函数> --timeout 5000
```

默认只观察不修改；仅当 NDJSON 缺失、截断或无法覆盖关键入口时才用 Hook 模板，且只注入 ruyipage 定制 Firefox；Hook 须在目标 SDK 加载前安装，命中后及时移除。签名层未安装（栈走原版 jQuery）即重采无解，改沙箱直调落盘脚本（见 trace-flow.md）。

环境补齐用证据驱动的最小集合：只有 trace 显示参与参数或服务端校验的模块才实现；每轮补齐保存输入、中间值、输出与请求结果，禁止一次性伪造大量浏览器 API。未进入关键链路的检测代码不等于服务端约束，不纳入最终环境。

**签名输入含不可复算随机值 = 分支判定失败（R2）**：复现出签名后先自问「服务端能用请求里已有信息复算出这个值吗」。若依赖服务端无法复算的量（RSA 随机 padding、`Math.random`/`getRandomValues` 结果、客户端本地状态），说明沙箱走进了错误分支，**不得继续枚举算法组合或拼接顺序**——转 DIAGNOSE，从随机量产生处回溯最近的分支条件，逐个对照其依赖的环境值（单变量）。全局对象被目标 JS 覆盖是最常见诱因，见 `references/env/env-object-model.md` 与反模式 23。

**参数输入链可能经隐蔽信道（提醒）**：签名/状态的输入不一定来自同上下文 JS——可能经 localStorage/cookie/IndexedDB/Cache、postMessage/BroadcastChannel 跨上下文、DOM 属性或 CSS 动画终态/canvas 像素等渲染产物传递，再由业务 JS 读出拼参。trace 摘要里目标参数 writer 缺失、或输入含「上一次请求的产物」时，按 `references/web/covert-channel.md` 四类信道排查（信号须与参数名组合，避免泛化命中被门禁拒绝）；隐写信道参与参数生成时属「参与参数的模块」，按证据驱动最小集合原则必须实现。

## 9. IMPLEMENT

**交付语言（进本节点即定；更换须凭证据）**：默认 Node.js，不按路径预判；用户显式指定其他语言时遵从并写入最终总结。两类例外/更换须在总结声明依据：① 用户显式指定（任意阶段）② **服务端封锁证据驱动的栈切换**——按规则 27 三级客户端阶梯证明默认栈被传输层指纹策略拦截（match19）后换被拉黑的客户端栈。补环境题型（B/C/D）选 Python 入口时须声明 JS 执行桥接方式，禁止静默包 Node 子进程充当「Python 交付」。

实现路径按序降级：

A. 纯算法：Node `crypto`、Python `hashlib`/成熟密码库和原始序列化规则。**明文含运行时未知常量且公钥/模数有多个候选时，用「候选 X × 候选公钥」扫描实证定案**（match27，规则 38）。
B. 最小 JS 沙箱：提取算法闭包，在隔离上下文提供已证实需要的对象和函数。症状 → 编号速查（机理用 `search_references.js --id` 按号提取）：

- bundle 抠模块缺宿主对象（`__webpack_require__` 桩）→ 兜底分支静默走错、「格式全对但服务端全拒」（规则 26 / 反模式 26）。
- JSVMP 整体黑盒：值对 ≠ 对齐（反模式 28 / 规则 28）。
- 黑盒输出自洽 ≠ 与真实浏览器一致：SDK 自检走「环境分支诱饵变体」（分支指纹 + 真机同输入对拍判定，桩须 nativize；反模式 29）。
- 自引用解码 + 环境分派：禁用反混淆产物执行，逐分支以 trace 证据对齐（反模式 31）。
- 分页类优先「页面自驱动翻页」：jq 桩让页面自身走翻页链产出全部页签名（反模式 24 同族，case match26/27/29）。
- 环境桩三纪律：沙箱内执行 / 独立模块注入（禁大段模板字符串，check_code_quality 红线）/ 不包 IIFE（规则 33 / 反模式 34）。
C. WASM：复现加载、内存、导入与导出调用，固定输入输出契约，三形态判定——**无外部导入的确定性 wasm** 直接 Node `WebAssembly.instantiate` 执行导出（同实例跨请求复用）；**wasm-bindgen 模块**原样还原 glue + `__wbg_*` 桩（get-global 初始化链陷阱见 env-debug-loop.md）；**自同构校验签名型**（官方包 200/重建包 500）走透明边界捕获 + 直接 wasm harness，不做环境层修补。字节获取、落盘形态与边界捕获见规则 41~43 / 反模式 25/39/40 / `references/env/env-wasm-advanced.md` / 案例 `cases/wasm-harness-selfhash-fp-blackbox.md`。
D. 环境伪装：仅补 trace 证明必要的 Web API、对象形状、Realm、时间、随机数与指纹行为。验收线是**服务端校验的自洽性**，不是与真实浏览器逐字节一致——先用最小沙箱 + 真实请求试探、按需对齐（match14：mz 指纹 53 字段中 4 处差异不影响通过）；服务端校验签名内嵌环境检测时用对齐探针法定位差异位（见 `references/env/env-detect-bypass.md`）。
E. TLS/Session：对齐客户端指纹、连接复用、Cookie 顺序、重定向与动态资源预热。**不是每题都有签名**——请求侧参数全明文时走 A+E，不做补环境（match4/7/12/17 实证；取证侧速通见 4.2「速通路径速查」形态① / 4.4 例外 4）。判定「无签名」须过三条判据：① 网络层——`target-hits.json` 目标请求除业务参数外无动态字段，可疑参数名在 capture.json 反查 0 次；② trace writer 层——`XMLHttpRequest.open`/`fetch`/`Headers.set` 参数全文无该字段；③ Cookie/存储层——目标域无 JS 写 cookie、无 WASM/JSVMP/混淆 SDK。三条全干净即收手，转查传输层与响应层。实现侧用 Node 原生 `node:http2`（一次 `connect()` 多次 `request()` 复用、`alpnProtocol` 自检、不发 `accept-encoding`，规则 27）。
F. **沙箱 [Unforgeable] 全局绑定对齐 + base64 字母表分支（match22，反模式 30）**：`window/self/top/parent/frames` 须定义为不可配置 accessor（vm data 属性会被 `delete window`/`window=0` 探针真删真换 → 诱饵分支）；同字节点但密文串不同 = 字母表分支，用已知 (明文↔密文串) 配对反推两侧字母表。

中间值必须可单独验证；时间、随机数、UA、指纹与会话状态必须有明确来源；静态配置外置，秘密从环境变量或用户运行时输入读取。验证码拆成 `load → solve → verify`，按 `assets/templates/captcha-verify/`（Node）或 `captcha-verify-py/`（Python）骨架 + 本 case `result/src/adapter` 实现，`result/src/solver` 答案层是交付组成部分；成功样本先逐字段确认明文类型、长度与绑定关系，不得把一次性 challenge/ticket/答案固定到代码。

## 10. REAL_VERIFY

默认验证是交付必要条件：除非用户明确 sign-only，必须用最终纯协议入口向真实 API 发请求。只读/验签请求默认真实执行；有业务副作用的写请求执行前先宣布目标 URL、方法、次数与预期影响后继续。

**写请求格式取证（R2）**：提交/写入接口的请求格式（Content-Type、body 编码、字段名）必须从页面源码（`case/forensic/document.html` 的 form/submit 逻辑）或 capture.json 的真实成功样本取证，**禁止猜测**；写请求前列出「Content-Type + body 构造依据」并引用行号。常见陷阱（jQuery `$.ajax` 默认表单编码、CSRF 字段位置、跨域提交接口）见 `references/network/ip-risk-control.md`「写请求与 Session 形态门禁」。

进真实请求前先做离线回归：把取证样本（同输入参数 + 浏览器侧期望输出）固化为 `case/fixtures/*.fixture.json`，用本地入口以同样输入生成实际输出，**逐字段过门禁比对**；任一字段不一致先回 IMPLEMENT 排查，**不得带着已知偏差发起真实请求**。多请求 case（翻页/批量/序列调用）fixture 至少固化 2 个不同请求序号的样本——计数器/会话状态类 bug 只在第 2+ 样本暴露（反模式 24）：

```powershell
node scripts/compare_fixture.js --fixture case/fixtures/<样本>.fixture.json --actual case/tmp/<实际输出>.json --field <目标参数> --markdown
```

退出码 0（字段一致）才进真实 API 验证；退出码 2 = 首个偏差点已定位，回 IMPLEMENT 修复后复跑。fixtures **只放 `case/fixtures/`**（随项目保留）——`result/` 下任何文本文件不得含样本加密参数值（含期望值），`check_final_artifact.js` 命中即判「复用样本参数」。交付入口 selftest 用 `../case/fixtures/...` 相对路径并容忍缺失（缺失则警告跳过对拍，match20 返工点）。

范围纪律：黑盒输出与取证样本结构一致后，直接用真实目标 URL 进 REAL_VERIFY；内部参数映射等旁支问题记入 `经验沉淀-<站点>.md`，不阻塞主交付、不横向展开。

交付检查要求至少 5 条有效真实请求记录（时间、HTTP 状态、目标参数摘要、会话阶段、响应判定）。用户限制或禁止请求时必须遵从，停止相应请求并标记验证未完成，不得为凑数继续请求或虚构记录。成功标准：

- HTTP 状态符合成功语义且响应结构与业务数据正确（不只查状态码）；动态参数在不同时间、输入或会话下按预期变化；Cookie/Token/TLS/Header/Body 序列化与请求顺序不依赖浏览器状态；失败请求能区分签名错误、会话过期、资源过期、频率限制、IP 风控与业务参数错误。
- **提交/写接口前先验活会话（match26）**：数据接口不校验登录仍 200，容易把 401 误判成签名问题——登录态依赖的写/提交前先 GET 会话状态接口（如 `/api/user`）确认 `isLogin:true`；会话过期后服务端可能主动清 sessionid cookie，需用户重新提供。

**Session 门禁（R1，match18 返工点）**：本阶段起联网入口即写成可复用 Session + 显式关闭，且**调用形态按字面识别**——复用/清理须以 `client/session.<get|post|request>`、`agent: <keepAlive变量>`、`agent.destroy()`、`client.close()` 等形态出现在 result 入口源码；封装进辅助模块或局部重命名不计入，裸 `urllib.request`/每次独立连接判不合格。形态细则（Node/Python 对应写法）见 `references/network/ip-risk-control.md`「写请求与 Session 形态门禁」。

至少保留一份脱敏验证摘要与可复现命令；不得输出完整 Authorization、Cookie、Token、密钥或验证码答案。401/403/412/429 先诊断，不得用浏览器自动化或硬编码成功样本绕过。验证码交付追加两项记录：手动成功样本基线（`node scripts/check_success_baseline.js`，要求与豁免见 `references/captcha/verification-workflow.md`）与逐次 attempts 复盘（`node scripts/check_verification_attempts.js`）；成功标准 = verify 返回通过凭据且业务接口消费凭据返回正确业务数据，视觉答案正确不算通过。

**403/风控码分层定位协议（R1：结论前必须完成，`check_risk_layer_diagnosis.js` 裁定）**：用「签名来源 × 连接来源」双对照隔离变量——① 正向：浏览器**新鲜**签名 + 纯协议客户端重放；② 反向：自己的签名 + 真实浏览器连接（ruyipage `add_preload_script` hook `XMLHttpRequest.prototype.open` 换参，取证脚本已提供入口 `forensic_ruyipage.py --preload-script <JS|文件>`；1.2.62+FF155 下库层带 `contexts` 会抛 privileged scope，脚本内置降级为全局注册，见规则 44 与 `references/tooling/ruyi-tooling.md`；hook 须带执行标记并验证）。**对照纪律**：过期样本的 403 不构成结论；每组对照前先复刻成功基线，健康 session 下一次只改一个变量（连续失败触发站点惩罚，惩罚期内数据作废）。结果解读矩阵、三个先量后动的子协议（时间戳 T 偏移矩阵 / 三级客户端阶梯 / 错误文案多义，规则 27/34/37、反模式 36）与操作步骤见 `references/network/ip-risk-control.md`。
1. **签名内容层**（①200 + ②403）→ **对齐探针法**：测量 SDK 实际内嵌的环境检测并逐位对齐（见 `references/env/env-detect-bypass.md`），不要先假设需要复现完整浏览器指纹。
2. **中间值断点采样**（DIAGNOSE 双对照的浏览器侧合法用途，match22 实证）：沙箱与真机同输入异输出且常规探针够不到闭包中间值时，用浏览器 MCP 调试器在真机断点 dump 中间值，与沙箱同断点 dump 逐字 diff，第一处分歧即环境分支点。须 `--guard mcp` 且用户知情；采样纪律见反模式 30。
3. **会话状态类风控**（HTTP 200 + 业务层文案）→ 按 `references/network/ip-risk-control.md` 会话状态类专节排查，惩罚期内基线失败即冷却、不做实验。

**引擎检测 case 的双对照浏览器侧（R1）**：取证浏览器被引擎级检测拒绝的 case（已过 BLOCKED_FORENSIC），浏览器侧经 `--guard mcp` 用 MCP 连真实 Chrome 内核执行；hook 须带执行标记并验证，对照产物落盘 `case/` 供审计。未经 BLOCKED_FORENSIC 的 case 一律用 ruyipage，不得借双对照名义引入 MCP。取证浏览器毒化证据常在分析阶段才齐备（match21）——落盘 `case/notes/` 后走 `DIAGNOSE → BLOCKED_FORENSIC` 补登记，再回 DIAGNOSE 走 `--guard mcp`。

未完成上述对照，不得宣布连接层风控结论，不得转而交付浏览器内核取数方案（取证浏览器脚本放进 `case/` 也算交付违规）。双对照结果写入 `result/验证记录.json` 顶层 `riskLayerDiagnosis` 字段（`forwardControl`/`reverseControl`/`conclusion`，正向须含 `captureToReplayMs` 采集→重放延迟，反向须含 `hookVerified: true`），并过门禁：

```powershell
node scripts/check_risk_layer_diagnosis.js --case-dir <project-root> --markdown
```

退出码非 0 = 对照缺失 / 样本过期 / hook 未验证 / 结论与对照矛盾，停在 DIAGNOSE 补对照，不得按未验证结论推进。

真实验证失败不得进入 `DELIVER`：可交付「未完成/诊断中」的中间材料，但入口、总结与状态行须标 `REAL_VERIFY_FAILED`，不得用「已完成还原」「服务端已接受」等成功措辞。sign-only 是唯一豁免，须标明未做真实 API 验证、只验本地输入输出/中间值/格式约束、不宣称签名被服务端接受，入口提供显式 `--sign-only` 或等价模式且不默认联网。

## 11. DELIVER、CLEANUP 与失败处理

交付目录保持单入口和最小依赖（`result/` 布局见 4.1 节）。入口被 `require`/`import` 时只导出 API，命令行执行时才运行。**取证落盘的原始 JS 副本（字节码/混淆单行文件）放 `result/src/target/original/`**——`check_code_quality.js` 对 `src/target/{original,vendor,bundle,bundles}/` 不做压缩/单行长度检查，入口启动时对副本做 sha256 校验防站点改版（match18：直接放 `src/` 会被质量门禁判失败）。**写交付文档前先读 `references/quality/final-summary.md`**（最终总结模板、`FINAL_ARTIFACT_*` 机器标记、`验证记录.json` 结构契约都在那里，不读必返工）。

交付前必跑：

```powershell
# 先读要求清单对齐交付物（无需预防性读门禁源码）：编写交付物的规范项都在 --explain 里
node scripts/check_final_artifact.js --explain
node scripts/check_code_quality.js --explain
# 再跑门禁
node scripts/check_final_artifact.js --case-dir <project-root> --markdown
node scripts/check_code_quality.js --case-dir <project-root> --markdown
```

验证记录含 401/403/412/429 失败尝试（触发过分层定位）的 case 追加 `node scripts/check_risk_layer_diagnosis.js --case-dir <project-root> --markdown`；用户要求“生产级交付”时改用 `node scripts/check_final_artifact.js --case-dir <project-root> --production --markdown`。

`最终项目总结.md` 与 `经验沉淀-<站点>.md` 是必需交付文档（模板与写入规则见 `references/quality/final-summary.md`、`references/workflow/phase-flow.md`）；仅用户明确要求不生成时才用对应 `--no-require-*` 豁免，并记录原因。

清理 `case/tmp/` 中的调试脚本、临时下载和秘密材料，保留可复核的最小证据、脱敏样本和必要 fixture。轻量路径交付须在最终总结标注算法来源 URL、验证日期和未做 trace 取证声明；速通路径交付须标注速通形态 + 判定依据落盘引用 + 未做 trace 取证声明。

卡住时按序：重看本次证据、跑 trace 覆盖检查、比较请求字段、定位中间值、缩小环境、再升级沙箱或 TLS 路径；最后输出卡点、已证实事实、缺失证据和下一步输入，不用浏览器自动化代替协议实现。

## 12. references 按需路由

不要全量必读，按当前状态选最小集合；读完仍无法推进再追加。正文与 references 中的「反模式 N / 规则 N」编号**按号提取小节**后再读；**R2 默认不要为单个编号整读** `common-pitfalls.md` / `experience-rules.md` 全文——不是错，只是浪费上下文预算。高频入口：

| 当前需要 | 首选 reference |
|---|---|
| 反模式/规则编号提取（跟进「见反模式 N」类指针）、references 关键词检索 | `node scripts/search_references.js --id "反模式 28"`（`--keyword` 兜底，`--case-dir` 记入打转检测） |
| 状态机细则、常见坑、经验法则 | `references/workflow/` 下 `phase-flow.md`、`decision-tree.md`、`common-pitfalls.md`、`experience-rules.md` |
| 某教学靶场 match 题（match.yuanrenxue.cn） | `cases/yuanrenxue-match-platform.md`（平台共性基线）+ `cases/yuanrenxue-match-index.md`（题号速查） |
| 取证、trace 质量与重试、工具安装 | `references/workflow/trace-flow.md`、`references/tooling/ruyi-tooling.md`、`browser-acquisition.md` |
| 混淆 JS 反混淆（`_0x`/字符串表/控制流平坦化） | `scripts/ast-patterns/README.md`：`detect-patterns.js` 检测家族 → `run-pipeline.js` 执行流水线 |
| 运行混淆 JS 验证行为（vm 沙箱 + 超时 + 环境访问日志） | `node scripts/run_with_trace.js --help`（禁止手写 vm runner；分支对齐桩用 `--env-module` + `--bootstrap-mode minimal`） |
| 隐蔽信道（参数经 storage/postMessage/DOM/CSS 动画隐写传递） | `references/web/covert-channel.md` |
| 补环境服务化（并发/OOM/vm2 选型）、TLS 已对齐仍被拦、纯 Web VMP 黑盒失败 | `references/env/env-concurrency.md`、`references/network/tls-handshake-gotchas.md`、`references/deobfuscation/vmp-decompile-optional.md` |
| 加密、混淆、环境、WASM、网络、指纹、验证码、交付 | 按场景细分见 `references/workflow/reference-map.md` |

完整目录与场景索引见 `references/workflow/reference-map.md`；脚本与模板参数以实际 `--help` 为准。reference 与本文件冲突时，以本文件的状态机、真实 API 验证规则和纯协议红线为准。

新经验默认沉淀到 `references/` 与 `cases/`：只有「跨题通用」且「不写入正文就会犯错」两条同时满足，才允许加进本文件（本文件是常驻注入区，每加一句按激活次数付费）。

## 13. 完成判定

- 目标范围已声明且要素齐备，证据来源可追溯。
- 请求链、动态字段和实现路径有本次证据支持。
- 交付入口不依赖浏览器、不硬编码关键动态秘密。
- 默认模式已完成不少于 5 次真实 API 请求并确认正确业务数据；或明确标记 sign-only 且未冒充真实验证通过。
- `最终项目总结.md` 与 `经验沉淀-<站点>.md` 已生成，或用户明确豁免。
- 交付检查和代码质量检查通过。
- 临时文件已清理，产出可被普通开发者和其他 AI 直接理解。
