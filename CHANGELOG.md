# CHANGELOG

## 2.3.52 - 2026-08-22

### 变更
- **IMPLEMENT 补环境前置门禁落地（文本规则→脚本兜底，2.3.22 原则）**：新增 `scripts/check_env_prerequisites.js`——SKILL.md 4.4「entry-chain.md + missing-env-priority.md 两文件缺一不得开始补环境」此前是纯文本规则，现校验两文件齐备且内容达标（entry-chain 含 stack.file:line:col 定位与入口表述；missing-env-priority 含优先级标记与「RuyiTrace 证据 / Node trace 补充 / 推断」来源标记或「黑盒执行，不逐项精确复现」声明），退出码非 0 不得开始补环境；SKILL.md 4.4 挂入门禁命令，自测 5 项断言。
- **路由基准扩容 16→25**：新增 IMPLEMENT 前置门禁（RB-017/018）、多进程 NDJSON 信号聚合语义（RB-019，锁住 2.3.48 修复的「不同进程文件各命中一个 writer 信号按聚合判定」行为）、验证码门禁链（RB-020 classify_verify 自测、RB-021/022 check_captcha_answer FAIL 拦截与 CLEAN 放行）、identify_crypto 形态矩阵（RB-023 JWT / RB-024 WASM magic / RB-025 UUID）。
- **Python 包供应链锁定**：`tool-pins.json` 新增 `pythonPackages` 段并固化 ruyiPage==1.2.62（2.3.47 验证组合）；`install_all.js` 按锁定版本精确安装（升级必须先更新锁定记录并回归）；`check_tool_pins.js` 新增 `--python <cmd>` 复验本机已装版本（pip show 只读，SKEW 即失败），自测 6→10 项。本机实测 ruyiPage 1.2.62 与锁定一致。
- **CI 自测覆盖补齐**：接入此前有 `--self-test` 却未进 CI 的脚本——`capture_ruyitrace_log.js`、`check_final_artifact.js`（Node）与 `classify_verify.py`、`forensic_ruyipage.py`（Python，新增 setup-python 步骤，两脚本自测均为离线确定性）。
- **SKILL.md §4.2 瘦身（压缩约 34 行细则）**：网络取证的预算/落盘/等待参数长注释压缩为 4 行核心语义 + 指针（细则已在 scripts/README 与 trace-flow.md，document.html 自动保存事实下沉 trace-flow.md「首选通用脚本」节）；终态语义长段压缩约半（保留 PARTIAL/NO_TARGET 退出码、2xx≠业务成功、`saved_to`/`*_complete` 等硬规则与全部基准锚点）；出口门禁复检段与状态机后段落的逐字重复压缩。锚点完整性由 25 条路由基准与 check_skill_consistency 双向校验兜底。

### 修复
- README 目录树声称「版本号见 front-matter `version`」但 SKILL.md frontmatter 并无该字段（skill 标准也不建议放版本号）——改为「版本变更见 CHANGELOG.md」。

## 2.3.51 - 2026-08-22

### 变更（吸纳热门同类 skill 项目的工程化能力）
- **路由/门禁回归基准**：新增 `scripts/check_routing_benchmarks.js` + `tests/routing-benchmarks/cases.json`（14 用例）。每条用例在独立临时目录还原证据现场（capture/NDJSON/用户材料），真实执行门禁脚本并断言退出码与输出关键词；`skillAnchors` 同步断言 SKILL.md 规则文本存在，实现「改门禁语义不改文档」「改文档不改基准」双向防漂移。覆盖 GATE-2 硬阻断、JS 辅助材料不计 Step 1、OPTIONS 非命中、TRACE_CAPTURE 出口门禁（放行/阻断/覆盖不足/泛化信号拒绝）、STEP2_ONLY、cURL 材料计入 Step 1、MATERIALS_FALLBACK/IMPLEMENT Step 2 前置/T1 信号表文本锚点。CI 全量运行。
- **Cookie 归因融合分析**：新增 `scripts/analyze_cookie_attribution.js`——capture.json 的 Set-Cookie（服务端下发）× RuyiTrace NDJSON 的 document.cookie/CookieStore 写入（含 stack.file:line:col）双源融合，逐 Cookie 判定 server/js/both/unknown 并给出下一步路径（server→复现请求链禁止硬编码；js→按写入点还原挑战/签名算法）。数据源取自现有 Step 1 + Step 2 取证产物，无新增采集动作。
- **密文特征识别（T1 入口脚本化）**：新增 `scripts/identify_crypto.js`——按长度/字符集/香农熵/结构（JWT/UUID/JSON/URL 编码）/base64 解码 magic bytes（WASM/ZIP/gzip 等）输出算法族假设排序，把 `references/crypto/algorithm-families.md` 的 T1 识别指纹落成可执行入口；输出明示「识别≠协议复现，同长度族不可仅凭密文区分」。
- **字体反爬知识库（CSS/渲染层分类）**：新增 `references/rendering/font-anti-crawl.md`（新 rendering 专题目录）。按内容渲染层反爬定位（非验证码题型）：T1 识别信号（@font-face/FontFace、woff/woff2 动态 URL、PUA 码点）、静态/动态映射二分、还原路径（取证判形态→fontTools 解 cmap→明文比对/字形相似度→映射表外置交付）、映射参与签名/字体 URL 需签名的叠加场景与常见坑（woff2 需 brotli、同会话取样）。SKILL.md 第 7 节 T1 信号表新增字体反爬行，reference-map 同步路由。
- **供应链 pin 门禁**：新增 `scripts/lib/tool-pins.json` 锁定清单 + `scripts/check_tool_pins.js`（记录/复验/`--strict` 拒绝未锁定）；`download_ruyi_tool.js` 新增 `--sha256` 并在命中锁定记录时强制哈希校验（不匹配即删产物并失败），未锁定下载在输出中报告 sha256 与固化命令。SKILL.md「新增依赖写入依赖契约」规则获得机器强制层。
- **CI 双平台矩阵**：`skill-checks.yml` 从仅 ubuntu-latest 扩为 Ubuntu + Windows 矩阵（主用环境是 Windows，PowerShell 命令与编码兜底此前无 CI 覆盖）；语法检查、确定性自测扩到全部新脚本，新增路由回归基准步骤。
- **离线回归标准化（吸纳上游 verify_signer_offline 思路）**：SKILL.md 第 10 节 REAL_VERIFY 前置「fixture 离线回归」硬步骤——取证真实样本固化为 `case/fixtures/*.fixture.json`，本地入口同输入生成实际输出过 `compare_fixture.js` 逐字段比对，退出码 0 才进真实 API 验证，退出码 2 回 IMPLEMENT；路由基准新增 RB-015/016（一致放行 / 偏差拦截退出码 2）。
- **scripts/README 索引漂移检测（吸纳上游 INDEX 自动生成思路）**：`check_skill_consistency.js` 新增 `checkScriptsIndex`——scripts/ 顶层脚本必须被索引、索引表格不得指向不存在脚本、头部计数（总/JS/Python）与实际文件数三方一致；自测扩 drift 场景（未索引/残留/计数失同步三类 problem）。
- **多客户端安装说明**：README 新增「安装到 AI 编程助手」——Agent Skills 目录（`~/.agents/skills`、`~/.claude/skills`、项目级 `.claude/skills`/`.codex/skills`）与系统提示注入两种接入方式、Node/Python 运行要求与首次安装后固化 pin 的提示。

### 修复
- **scripts/README 计数失同步**：头部宣称 54 个脚本（47 JS）但数量核对表合计 53 且网络取证类少计 1（2.3.47 加 check_trace_gate 后未同步表）；按实际文件重数并随本次 4 个新脚本对齐为 58（51 JS + 7 Py），新增「识别与归因辅助」分类。
- SKILL.md 第 7 节 IDENTIFY 补特征驱动识别入口（identify_crypto / analyze_cookie_attribution）与使用边界说明，IDENTIFY 阶段不再只依赖人工对照 T1 表。

## 2.3.50 - 2026-08-22

### 变更
- **验证码模板 provider-neutral 化**：`templates/captcha-verify/` 与 `captcha-verify-py/` 改为纯流程骨架 + 六方法 adapter 契约（`adapter.example.js` / `adapter_example.py`），config 全占位；SKILL.md 纯协议红线新增模板边界条款——通用模板不得预填任何厂商接口名、字段名、HTTP 方法、JSONP、加密结构、凭据字段或默认轨迹，平台细节一律由本 case 抓包/RuyiTrace/成功样本驱动写入 `result/src/adapter.*`。
- **入口成功语义收紧（HTTP 200 ≠ 成功）**：`final-entry/final.js` 与 `python-request/final.py` 自验引入 `responseValidation`（jsonPath/minLength/contains）三态判定——未配置规则时所有 200 响应记「未判定」，退出码 3，拒绝宣称通过（0=通过/1=异常/2=失败/3=未判定）；修复 Node 版 attempts 从未落盘、`验证记录.json` 仅 sign-only 模式写入的缺陷，两版统一写 `mode/responseValidation/summary{pass,fail,unverified}/attempts[].judgment`。
- **请求层 Cookie 生命周期 + 原始请求描述符**：`node-request/client.js` 与 `python-request/client.py` 的 CookieJar 解析 Set-Cookie 属性（Domain/Path/Max-Age/Expires），Max-Age<=0 或过期即删除；`session.request` 支持 `{method, url, opts}` 描述符单对象形态（可直接透传 trace 导出/adapter 契约请求）；`session.defaults({jar})` 后自动携带 Cookie、响应后自动合并 Set-Cookie，显式 Cookie 头优先；Python 版补齐 `defaults()`/`body`/多条 Set-Cookie 提取。
- **T1/T2 厂商知识分级政策**：SKILL.md 新增红线——识别指纹（参数名↔算法族、厂商 Cookie/组件名、响应码特征，T1）只允许留在标注过的识别参考与分类脚本；协议语义（字段语义、加密结构、接口链、实测轨迹参数，T2）只进 `captcha-providers.md`/`cases/`/case adapter 并带验证日期。algorithm-families、env-iframe、ip-risk-control、ast-patterns、SKILL.md 信号表加 T1 分级声明；experience-rules 易盾 m 空串语义、verification-workflow 案例实测数字、handoff 的 buildCheckData 厂商函数名、模板与 click_gap 易盾举例全部泛化为指针。

### 修复
- **classify_verify.py 路由死链（识别→下一步闭环断裂）**：PLAYBOOKS/VERIFICATION_FLOW 输出的 53 处 `references/*.md` 裸路径全部重映射到 `references/captcha/`、`references/tooling/` 真实路径；不存在的 `scripts/inspect_assets.py` 引用清零；新增语序点选题型 `word-order-click`（信号/playbook/求解链/自测），题型数对齐为 25 信号题型 + unknown-custom = 26 标签；self-test 从 5 例（全 slider）扩到 7 例并支持无 provider 期望用例。
- **验证码答案层门禁从宣称变实现**：`check_final_artifact.js` 新增验证码交付检测（config 含 captcha 对象或引用 adapter 契约），强制校验 `result/src/adapter.*` 与答案层接入（`src/solver.*` 或等效求解代码）同时存在，缺一 FAIL，自带 3 组自测；`captcha-solving-handoff.md` 的门禁描述同步对齐。
- **Step 2 可否跳过三文档互斥**：SKILL.md 状态机正式建模 `MATERIALS_FALLBACK` 节点（RuyiTrace 工具不可用且自动安装失败 + 用户材料经 check_evidence.js 校验通过 → CASE_LOOKUP，强制声明取证偏差、REAL_VERIFY 不可豁免），decision-tree 阻塞点#5、trace-flow 硬约束、SKILL.md IMPLEMENT 前置四处统一为同一语义。
- **验证码门禁挂进主状态机**：SKILL.md 第 7 节挂 classify_verify + check_captcha_answer + 坐标来源 A/B/C 判定，第 9 节挂模板骨架与 solver 交付要求，第 10 节挂 success_baseline + attempts 复盘；此前按主文档执行的 agent 可完全绕过验证码专属门禁。
- **5 连败决策机与优先级链不同轨**：`check_verification_attempts.js` 在 recommend-platform-control 之前补 `try-manual-takeover`（当前方案已是人工时才直接切平台），与 handoff「②人工接管 → ③打码平台」链一致；"Phase 5" 编号残留清理。
- **文档失同步**：phase-flow 参数分类对齐 SKILL.md 六分类、IDENTIFY 定位为取证期观察（正式节点以状态机为准）、必填措辞修正；`check_fingerprint_fixture.js` 统一为「有 env 必跑/纯算豁免」；trace-runtime-conformance 对拍循环按实现路径分层（B/C/D 强制、A 豁免）；cleanup.md 目录树升为唯一权威版本（合并 snapshots/static/extracted/forensic/ruyi-trace/阶段报告）；样本对比放宽为 ≥2 组（区分计数器与随机存疑时补第 3 组）；web-verify-patcher 标注为外部可选 skill。
- **验证码流补强**：协议失败先读 verify 错误码归因再进五键诊断；凭据 TTL/一次性消费实测提示（captcha-request-chain）；移动 H5 touch 轨迹形态说明（generate_motion_track 只产鼠标式，touch 由 case adapter 适配）；scripts/README 示例 `--captcha-type slide` 修正为 `slider`。

## 2.3.49 - 2026-08-22

### 修复
- **trace 证据与生命周期语义拆分**：新增 `--evidence-signal` / `--end-signal`，证据信号不再自动承担浏览器关闭条件；采集器改用增量日志扫描，避免 signal 滚出尾部 1MB 后漏判；新增信号策略门禁，拒绝裸 `createElement`、`appendChild`、`querySelector` 等泛化 API 作为 writer 证据；补充验证码/JSONP 的 callback→参数构造→网络写入→回调最小链路要求。

## 2.3.48 - 2026-08-22

### 修复
- **RuyiTrace 采集生命周期闭环**：默认 `--duration 120` 明确为采集窗口；窗口到期、用户关闭浏览器或全部 trace 信号命中后都会进入统一收尾，按 trace Firefox 可执行路径与 profile 清理进程树，并复检残留进程。输出新增明确的 `endReason` 与实际命令耗时，避免把关闭/刷盘/导入时间误解为采集仍在继续。
- **关闭浏览器后的半条日志误判**：导入前等待全部 NDJSON 的大小与修改时间稳定，并要求文件最后一个字节为换行，避免用户手动关闭或进程退出时把未写完的 JSON 当作完整 trace 导入。
- **“真实操作了却提示未命中”误判**：网络接口 URL 与 trace writer/API 信号拆分；网络信号只约束 Step 1，trace 信号只约束 Step 2。多进程、多用户 NDJSON 的信号按本次全部有效日志聚合，不再要求单个进程文件独自命中全部信号。验证码/支付等跨域 iframe 在明确 writer/API 信号全部命中时允许以信号确认 Step 2，不再强制要求日志出现业务站点 hostname。
- **“没有 trace”与“覆盖不足”混淆**：Step 2 拆分为 `evidence`（有效 NDJSON 已存在）与 `targetCoverage`（writer/API 链已覆盖）。NDJSON 存在但信号未命中时明确进入 TRACE_RETRY，不再误报为日志未产出；人工结束或信号尚不确定时可使用 `--signal-policy advisory` 保留有效日志并只报告覆盖不足。
- **人工关闭后的导入策略**：检测到用户提前关闭/浏览器崩溃时，自动导入临时采用 `advisory`，保留完整 NDJSON 和摘要；`check_trace_gate.js` 仍严格检查 writer 覆盖，未命中只会停在 TRACE_RETRY，不再显示成“导入失败/没有 trace”。
- **延迟生成日志不丢失**：刷盘等待阶段持续重新扫描 trace 目录，覆盖浏览器退出后才落盘的 content 进程文件。

### 变更
- `capture_ruyitrace_log.js` 支持 `--trace-signal`（`--target-signal` 仅兼容旧调用）、实时观察内容进程日志并在全部信号命中时自动结束采集。
- `check_evidence.js` 新增 `--require-network-signal` / `--require-trace-signal`，`check_trace_gate.js` 按 Step 2 证据与目标覆盖双门禁判定。
- `import_ruyitrace_log.js` 统一支持 `--trace-signal`，旧 `--target-signal` 保持兼容；多文件导入复制时加入来源摘要，避免同名 NDJSON 静默覆盖。
- 同步更新 `SKILL.md`、`references/workflow/trace-flow.md` 与 `scripts/README.md` 的状态语义和操作说明。

## 2.3.47 - 2026-08-21

### 变更
- **ruyiPage 升级至 1.2.62 + 适配**：`pip install ruyiPage --upgrade`（1.2.45 → 1.2.62）。ruyipage ≥1.2.62 已原生内置 Firefox 155+ 的 privileged-scope 兼容：`capture.start` 上下文订阅失败自动降级全局、`smart_fingerprint` 自带脚本可访问的 `about:blank` 启动页、提权窗口下 `allow_system_access` 按需自动开启。`forensic_ruyipage.py` 的 `_apply_ruyipage_capture_compat_patch` 增加版本门控（≥1.2.62 走原生、跳过补丁，<1.2.62 走原补丁）；`set_argument("--remote-allow-system-access")` 在 1.2.62 会被自动转发到 `allow_system_access()`，行为等价。文档 `references/tooling/ruyi-tooling.md` 同步更新兼容说明。
- **RuyiTrace 确认为最新版本**：`tools/RuyiTrace-2.5.5`（Windows 新结构 `resources/kernel/`）经 `check_external_tools.js` 验证通过，与 GitHub release v2.5 一致，无需更新。检测脚本对比结果显示 ruyiPage 包已是 PyPI 最新 v1.2.62。

### 修复
- **TRACE_CAPTURE 出口门禁复检（P0-1）**：新增 `scripts/check_trace_gate.js`，状态机内复检 Step 2（RuyiTrace NDJSON）是否真实产出。GATE-2 入口门禁只判定初始证据路由，TRACE_CAPTURE → CASE_LOOKUP 转换此前无脚本接住——AI 可声明「已采集 trace」但实际跳过 RuyiTrace 直接转静态分析 / EXTERNAL_LOOKUP 拼凑方案（geetest slide-popup 案例正是如此：声明跑 RuyiTrace 却全程没跑，最终用 4 个外部仓库拼凑 final.js）。现在 TRACE_CAPTURE / TRACE_RETRY 出口必须复跑 `check_trace_gate.js`，退出码 0（`step2.evidence=true`）才可进 CASE_LOOKUP，退出码 1 停在 TRACE_CAPTURE。脚本复用 `check_evidence.js` 的 `check()` 判定 `step2.evidence`，透传 `--require-target-signal` 同时卡目标信号命中；自测 5 项断言（step1-only/both/target-signal 未命中/step2-only/空目录）。
- **IMPLEMENT 硬前置补 Step 2 缺失约束**：Step 2 缺失（`check_trace_gate.js` 退出码 1）时不得进入 IMPLEMENT，不得以 EXTERNAL_LOOKUP 网络方案、边界声明、同族算法替代或 mock 填补 Step 2 证据缺口；轻量路径豁免前提是 Step 1 + Step 2 齐备，Step 2 未产出不构成豁免条件。

### 变更
- SKILL.md 第 4 节状态机 TRACE_CAPTURE / TRACE_RETRY 出口加「出口门禁复检通过」；状态机图后与 4.2 节加「TRACE_CAPTURE 出口门禁复检」小节；4.4 节 IMPLEMENT 硬前置补 Step 2 缺失约束。
- `references/workflow/trace-flow.md`「Trace 质量判定与重试」节加「TRACE_CAPTURE 出口门禁复检」子节，明确「Step 2 是否真产出（出口门禁）」与「Step 2 产出后质量是否达标（质量判定）」是两件事，不混淆。
- `scripts/README.md` 网络取证与日志采集类补 `check_trace_gate.js` 索引，脚本总数 53→54。

> 本次是 2.3.22（文本规则必须有脚本兜底）+ 2.3.7（脚本信号必须由 SKILL.md 文本接住）两条原则在「状态机节点转换」位置的回归修复：状态机内部节点转换此前全是纯文本规则、无脚本复检，AI 可「声明通过」但实际跳过关键步骤。

## 2.3.45 - 2026-08-17

### 修复
- **import_ruyitrace_log.js 多文件合并 + API 字段修正（P0）**：`--input` 支持多次传入，合并统计多个 NDJSON（用于 domtrace 多进程文件）；api 字段补 `evt.interface`（RuyiTrace NDJSON 实际用 `interface`/`member` 表示调用对象，原 `evt.api/name/path` 读取恒空，导致 API 统计恒空、分类恒 other、质量判定失效）。
- **capture_ruyitrace_log.js 主日志多进程合并（P0）**：RuyiTrace 一次采集按进程写多个 `domtrace/trace_process_<pid>.ndjson`，`process_type` 为 `tab`/`content` 的才是业务 JS，`parent` 是浏览器父进程/内核活动。原 `listNdjsonFiles` 按 mtime 倒序取 `logs[0]` 作主日志，会漏掉真正内容进程、误取 parent 内核空壳。改为合并所有非 parent 的 domtrace 文件作主日志，target-signal 在合并全量上判定。
- **trace 质量判定补「未覆盖页面 JS」/「API 全空」重度不足信号**：import_ruyitrace_log.js 新增「质量判定」段——stack.file 无任何 http/https 页面脚本（全 resource:// / file:// / self-hosted 内核路径）或有效 API 占比过低时输出重度不足，进入 TRACE_RETRY，不再把「只采到内核进程」当有效 trace。

### 优化
- **TRACE_RETRY 降级补充补「拦截 JS 响应注入日志」**：验证码/重度混淆场景推荐在 ruyipage 拦截目标 SDK 的 JS 响应，往加密入口注入 `window.__log` 捕获真实明文/key/密文后逐字段 diff，比盲试 RSA 字节序/编码/填充快得多。来源：geetest slide-popup 案例 trace 两次未命中后，模型靠盲试 + 临时 Hook 才定位到「所有请求复用同一 AES key + 掩码 base64」，该手段本应在降级补充阶段就指引。

## 2.3.44 - 2026-08-17

### 修复
- **forensic 终态目标与验证码前置链路解耦**：撤销 2.3.43 的多 targets 全部命中语义；`--targets/--targets-regex` 恢复为 URL OR 匹配，用户只需提供最终业务/登录接口，命中后默认再等待 3 秒接收后置回调。
- **关联动态材料自动保留**：全量请求元数据继续写入 `capture.json`，终态前最近的 API/JSON、验证码/风控资源与 WASM 按默认 60 包、100MB 总预算自动保留；避免预先列全验证码接口，也避免逐包拉取所有 body。
- **目标误命中修复**：目标过滤只匹配 URL，不再因 `Referer` 或响应头文字命中接口关键词。
- **无 targets 模式 body 过度读取修复**：未指定终态目标时不再把所有网络包误当作目标包拉取响应体。
- **关联材料原因标注**：`related-hits.json` 按 `flow-url`、`write-request`、`wasm`、`dynamic-response` 标记自动保留原因，便于后续快速区分验证码/风控与业务请求。
- **多次终态回溯修复**：同一会话中存在多次最终接口提交时，以最后一次已捕获的非 OPTIONS 2xx 终态为关联锚点，保留失败重试之间重新触发的验证码/风控链；HTTP 2xx 不等同业务成功，预期重试时通过 `--target-settle` 扩大继续抓取窗口。`--wait` 只限制首次终态等待，命中后始终执行完整收尾窗口，不再被总超时余额截断。
- **完整 body/WASM 落盘**：JSON 默认只保留 1MB 内联/预览；普通大 body 默认完整写入 `forensic/bodies/`（单体 10MB），WASM 默认完整写入 `forensic/wasm/`（单体 50MB），关联总预算提高到 100MB。超过安全上限或预算时不写不可解析半包，并在记录中写入 `*_complete=false` 与原因；完整文件带大小和 SHA-256。gzip/br/deflate 响应保存解码后的分析 payload，并用 `*_content_decoded` 明示，避免误当 wire-level 字节。
- **新增 `forensic_ruyipage.py --self-test`**：覆盖终态 OR、URL 匹配、多次终态回溯、普通大 body/WASM 逐字节落盘、预算拒绝半包和关联筛选。

## 2.3.43 - 2026-08-16

### 修复
- **forensic_ruyipage.py 多 targets 命中判定 any → all（P0）**：原 `_target_reached`/`acceptance` 是 any 语义——`--targets` 列多个时，页面加载只触发第一个接口（如验证码 gettype.php）就提前收尾关浏览器，用户后续交互（滑动/登录）触发的接口（ajax.php/login）永远抓不到，"一次会话列全 targets"（2.3.40）实际不成立，geetest 案例被迫分三次重采。来源：用户指出"抓到 target 立马就会关闭浏览器吧"。修复：
  - 新增 `_target_acceptance`：每个 target 都必须有非 OPTIONS 2xx 命中（all 语义），单 target 与 any 等价
  - `_target_reached` 等待循环改 all 语义：全部命中才停；等不到的目标由 `--wait` 超时兜底，已抓包仍落盘
  - `_build_result` acceptance 改 all：部分命中 → `PARTIAL`（带 `missingTargets` 未命中清单），完全未命中 → `NO_TARGET`，全部命中 → `PASS`
  - main 退出码 `target_verified = acceptance == "PASS"`：部分命中不再误判 Step 1 通过
  - 报告输出新增 `[未命中目标]` 行，明确列出缺哪些接口
- 自测：13 项断言全过（含核心回归"多 targets 部分命中 = 不停止"、OPTIONS/412 不算命中）

### 优化
- **SKILL.md 4.2 同步全部命中判定**：多 targets 全部命中才 PASS；部分命中 → `PARTIAL` + 未命中清单，停在 EVIDENCE_GATE，不得视为 Step 1 通过。全部命中判定保证验证码场景一次会话列全 targets 时，脚本会等到用户滑完、全链路接口都出现才收尾关浏览器。

## 2.3.42 - 2026-08-16

### 优化
- **SKILL.md 4.2 验证码 targets 注释去掉厂商接口名示例（修正 2.3.41）**：2.3.41 写的"极验 v3 gettype/get/ajax、v4 load/verify、易盾 get/check"仍属具体厂商细节，写进通用 SKILL.md 不通用且可能误导照抄。改为只保留通用原则（一次会话抓全 load→verify、接口名以实际链路为准、禁止分多次重采），厂商接口矩阵仅指向 `references/captcha/captcha-providers.md`。来源：用户反馈"不通用就不要写进去"。

## 2.3.41 - 2026-08-16

### 优化
- **SKILL.md 4.2 验证码 targets 示例通用化**：原"如 gettype.php,get.php,ajax.php"是极验 GT3 专用，其他厂商（GT4 的 load/verify、易盾的 get/check、TCaptcha 的 ticket+randstr 等）接口名不同，写死会误导照抄。改为"接口名因厂商/版本而异，以实际抓包链路为准"并给多厂商代表性示例 + "勿照抄"提示。来源：用户反馈 target 三个不是所有验证码都有。

## 2.3.40 - 2026-08-16

### 修复
- **forensic_ruyipage.py 取证等待机制三处断裂（P0）**：验证码/登录等需人工交互的取证场景下，AI 后台运行脚本时浏览器被提前关闭，用户还没操作就收尾。来源：geetest 滑动验证码取证复现（`--manual-pause` 后台 EOF 崩溃 → 改用 `--wait` 死等 → 分三次重采才凑齐链路）。
  - `--manual-pause` EOF 容错：`input()` 遇非交互 stdin（EOF）不再抛异常崩溃导致 finally 强制关浏览器，改为跳过暂停并进入 `--wait` 等待循环，让用户有时间在窗口完成操作。
  - `capture.wait` 连续异常计数容错：原单次异常即 `break` 提前收尾关浏览器（BiDi 抖动一次就放弃整个等待窗口）；改为连续 5 次异常才放弃，单次抖动继续等 deadline。有目标/无目标两处等待循环均已接入。
  - `--wait` 超时收尾警告强化：目标未命中超时收尾从 `logger.info` 提升为 `logger.warning` 并带 `[超时]` 标记，明确提示"若用户尚未完成操作请调大 `--wait` 或重采；已捕获的包仍会落盘"。

### 优化
- **SKILL.md 4.2 验证码取证一次会话抓全三段链（P1）**：验证码场景（geetest/易盾/TCaptcha 等）`--targets` 应逗号分隔列全 load/get → verify 三段链接口（如 `gettype.php,get.php,ajax.php`），用户滑动一次即拿全链路；明确禁止分多次重采——challenge 强绑定 Session，每次新会话 profile 必然失效。同步更新 `--manual-pause` 说明（AI 后台遇非交互 stdin 自动退化为等待 `--wait`）与 `--wait` help（验证码/登录场景建议调大至 300）。

## 2.3.39 - 2026-08-16

### 修复
- **check_evidence.js NDJSON 扫描不递归子目录（P0）**：`listNdjsonFiles` 只扫 `case/ruyi-trace/logs/` 顶层，而 RuyiTrace 新版按进程类型分目录输出（`domtrace/` 主日志 + `cookie/descriptor/event/storage` 分类，`capture_ruyitrace_log.js` 已递归且 domtrace 优先）。主日志在 `domtrace/` 子目录时被漏扫，出现「Trace 只采到 1 行且无 stack.file」的误判，AI 被迫手动复制文件到顶层才能过 EVIDENCE_GATE。修复：递归扫描 + 内容指纹去重（防顶层副本重复计数，domtrace 主日志优先保留），与 `capture_ruyitrace_log.js` 语义对齐；自测新增子目录递归 + 顶层副本去重两个回归用例。来源：丁香园 DXY paid-post/page 案例复盘。

### 优化
- **trace 覆盖声明加脚本兜底（P1）**：SKILL.md 4.2「trace 未覆盖目标接口 URL 字面量须显式声明，未声明不得进入 IMPLEMENT」原为纯文本规则。`check_final_artifact.js` 新增 `inspectTraceCoverageDeclaration`：解析 `case/notes/ruyitrace-summary.md` 的「目标信号命中检查」段落，存在未命中信号时要求 `最终项目总结.md` 含「trace 未覆盖 / 定位依据为」声明，缺失则报问题；自测覆盖未命中+无声明、未命中+已声明、无未命中三种情形。
- **capture.json 与 target-hits.json 分工写明（SKILL.md 4.2）**：明确 `capture.json` 是纯请求元数据（不含响应体），响应体只落盘到 `target-hits.json`（`--targets` 命中）与 `case/js/original/`；需确认某接口响应体时（如 serverTimestamp 来源接口 `time-millis` 的 data 格式）必须把它加进 `--targets`，不要从 capture.json 找响应体。来源：DXY 案例 AI 绕路确认 time-millis 响应格式。
- **--target-signal 选信号指导（SKILL.md 4.2）**：补充「不传密钥/常量名（appSignKey、bl、secret）——trace 记录运行时值与写入点，不记录密钥字面量，传密钥名必然未命中并误触发硬阻断；应选参数写入点/参数名（noncestr、x-zse-96、Headers.set(...)）」。来源：DXY 案例传 appSignKey 导致摘要误报 [未通过]。
- **EXTERNAL_LOOKUP 豁免与状态行格式强化（SKILL.md 4.3/4.4）**：豁免必须在状态行显式写「EXTERNAL_LOOKUP 豁免：Step1+Step2 齐备 + 链已定位」；CASE_LOOKUP 是必经节点，先 `search_cases` 查本地相似案例再考虑豁免，不得直接从 EVIDENCE_GATE 跨过；状态行固定格式 `当前状态(证据状态) → 目标状态(关键结论)`，跳过必经节点必须带豁免依据，trace 未覆盖 URL 字面量时带「trace 定位依据：<写入点>」。来源：DXY 案例直接跳过 CASE_LOOKUP/EXTERNAL_LOOKUP 未声明。

## 2.3.38 - 2026-08-16

### 修复
- **check_final_artifact.js Session 复用检测从字面量正则改为语义检测**：原 `SESSION_REUSE_PATTERNS`/`SESSION_CLEANUP_PATTERNS` 只认 `session.`/`client.` 变量名字面量，`req`/`sess`/`agent` 等自然命名被误判「未复用/未清理」，导致反复改名返工。改为 `extractSessionVarNames` 提取 `new Agent({keepAlive})`/`new Session()` 的变量名后按变量名动态匹配复用（`X.request(...)`、`agent: X`、`{X}` 简写）与清理（`X.destroy/close/dispose/end`），保留字面量兜底。来源：B 站评论 WBI 案例 5 次返工。
- **check_final_artifact.js AUTOMATION_PATTERNS 排除注释**：`\bRuyiTrace\b` 等工具名检测全文扫描，命中注释里的「本算法由 RuyiTrace 实证」纯说明文字，误判为引用取证工具。新增 `stripComments`（状态机去除 // 与 /* */，保留字符串/模板字面量）后再匹配；自测新增注释说明、自然命名 keepAlive 复用两个回归用例。

### 优化
- **target-signal 证据层语义拆分（SKILL.md + import_ruyitrace_log.js）**：明确 `--target-signal` 命中的是 RuyiTrace 记录的环境 API / 签名写入点，不是网络请求 URL；目标接口 URL 的命中证据由 Step 1 取证承担（`forensic_ruyipage.py --targets` + `check_evidence.js --require-target-signal`）。网络接口目标的 URL 未命中 trace 字面量属预期、不算采集失败，改走写入点定位 + 声明豁免，而非反复重试 trace；只有环境 API 信号未命中才是 TRACE_RETRY。来源：B 站评论滚动出评论但 trace 仍报「未命中目标」。
- **密钥来源接口响应体保留（SKILL.md + forensic_ruyipage.py）**：签名密钥/配置来源接口（如 B 站 nav 下发 wbi_img）也要加入 `--targets`，否则其响应体不进 target-hits.json，无法从证据反推密钥；取证命令与 `--targets` 帮助文本同步说明。

## 2.3.37 - 2026-08-15

### 优化
- **统一阶段报告策略**：SKILL.md 4.4 原「每个阶段结束必须落报告」与 `references/quality/stage-reports.md`、`check_final_artifact.js` 的「默认不生成」互相冲突。改为统一口径：阶段报告默认不生成，仅多轮复杂补环境 / 上下文防耗尽检查点触发 / 用户明确要求时按需生成；关键结论（IDENTIFY、WASM 黑盒跑通、body 结构、实现方案选定）仍必须随节点落盘。`check_stage_reports.js` 默认对缺失目录/文件仅提醒，传入 `--require-stage` 或 `--require-initial` 时才硬门禁，避免快速解题被误判失败。
- **target-signal 未命中降级必须显式声明**：目标接口 URL 因动态拼接未命中字面量时，改用参数写入点/参数名定位后，必须声明「trace 未覆盖目标接口 URL 字面量；定位依据为 <写入点/关键词>」并写入 summary、阶段报告（如已启用）和最终总结；`import_ruyitrace_log.js` 摘要同步给出该降级提示。
- **补环境证据前置覆盖黑盒路径**：`missing-env-priority.md` 从仅路径 D 扩展为路径 B/C/D 需要提供/补齐浏览器对象时均强制；JSVMP 黑盒执行也须给出简版环境清单并标注「黑盒执行，不逐项精确复现」，不得跳过。
- **EXTERNAL_LOOKUP 增加证据链完整豁免**：Step 1 + Step 2 齐备且 TRACE_ANALYZE 已定位 builder/writer 时，可声明豁免后直接 IMPLEMENT，避免 AI 自行裁量。
- **check_final_artifact webdriver 误报修复**：废弃宽泛的 `(?<!navigator\.)\bwebdriver\b`，改为只匹配 `webdriver.Builder/Chrome/Firefox/...`、`new webdriver`、`require('webdriver')`、`from 'webdriver'`、`import webdriver`、`webdriverio`，不再误伤 `webdriver: false`、字符串拼接 mock 和注释；自测新增 webdriver mock / selenium-webdriver 两个回归用例。

## 2.3.36 - 2026-08-15

### 修复
- **多 case 项目共享 tools 时 RuyiTrace/ruyipage 被误判缺失、重复下载**：`check_external_tools.js`/`install_all.js` 拿到 `--project-dir` 后直接用 `path.resolve` 拼 `tools/`，不向上查找；当 AI 把 case 目录（如 `ai-js-reverse/zhihu-xzse96`）当 `<project-root>` 传入时，`zhihu-xzse96/tools/` 不存在，已装在上一级共享工程根 `ai-js-reverse/tools/RuyiTrace-2.5.5` 的组件检测不到，触发重复安装。修复：`scripts/lib/paths.js` 抽出 `findToolsRoot`（向上含自身最多 5 层找含 `tools/` 的目录），新增 `normalizeProjectDir` 供 `--project-dir` 归一（命中返回祖先、未命中原样返回，向后兼容）；`check_external_tools.js` 入口与 `install_all.js` `initPaths` 均接入，`resolveProjectDirFromCaseDir` 复用 `findToolsRoot` 并保持原兜底语义。SKILL.md 4.1 与两脚本 usage 同步「多 case 共享 tools 自动向上查找」说明。

## 2.3.35 - 2026-08-15

### 优化
- **补「进入补环境前的证据前置」硬约束（SKILL.md 4.4）**：来源——头条 feed a_bogus 实战中，补环境阶段先盲补 probe 十几轮崩溃才回看 trace，与 `env-debug-loop.md`「RuyiTrace 优先诊断门禁」冲突。修复：把 `notes/entry-chain.md` + `notes/missing-env-priority.md`（`analyze_trace.js --summary` 产出）从「20 步未推进兜底」提升为路径 D 补环境的硬前置，两文件缺一不得开始补环境。原防耗尽检查点改为「先回看两文件是否覆盖崩溃点」。
- **IMPLEMENT 硬前置锚定 trace 结论（SKILL.md 4.4）**：EXTERNAL_LOOKUP 假设与本次 trace 定位的 builder/writer 冲突时以 trace 为准，禁止先测未被 trace 证明的 SDK 导出接口。来源——头条实战中 trace 已证明 a_bogus 由 bdms 生成，但 IMPLEMENT 先测了 `acrawler.sign()` 才发现返回老版 `_signature`。
- **IDENTIFY 信号表区分 byted_acrawler 与 bdms（SKILL.md 第7节）**：`byted_acrawler.sign` 多返回老版 `_signature`，`a_bogus`/`X-Bogus` 由 `bdms` 生成，两者不可混淆。来源——头条 PC 用 acrawler+bdms+sdk-glue 三件套（无 webmssdk），与抖音三件套同源但签名产物不同。
- **cases 新增 `jsvmp-bdms-sdk-glue-toutiao.md`**：头条 PC feed 接口 a_bogus 逆向，字节系 sdk-glue+bdms 黑盒执行案例。含 _SdkGlueInit 完整调度、XHR 闭包捕获时序差异（加载前就位 vs 抖音的加载后 patch）、环境过度设计反例、bdms 槽位 15~27 映射等可验证事实；index.json 同步登记。

## 2.3.34 - 2026-08-15

### 优化
- **cases 新增 `acw-sc-v2-blackbox-leisu.md`**：阿里云盾 acw_sc__v2 新版黑盒执行 + accept AES 签名 + 响应三重编码的完整案例。含 acw 黑盒执行坑点清单（NFE toString 一致性、Proxy 不改源码观测、洗牌器与主逻辑共享括号不可单独提取、裸标识符 `reload`、`alichlgref` 必带、55vs50 长度教训）+ 可验证事实清单；index.json 同步登记。
- **check_final_artifact.js 修复 webdriver 误伤**：`AUTOMATION_PATTERNS` 的 `\bwebdriver\b` 会命中 `navigator.webdriver`（黑盒执行 acw/JSVMP 时的环境模拟，被误判为浏览器自动化）。改为负向断言 `(?<!navigator\.)` 排除点访问的环境模拟，保留 `selenium-webdriver`/`WebDriver`/`webdriver` 包的自动化检测。

## 2.3.33 - 2026-08-15

### 优化
- **补「响应方向」链路模型（crypto-entry.md）**：新增 response→reader→decoder→parser 四层（与请求方向 source→entry→builder→writer 对称），并给两条关键原则——「先看 code 分支再判错误/风控」「先判 data 编码特征再套算法」。来源：leisu api-gateway 案例中 `code 1-130 是加密容器标识（code-100=凯撒位移量）`，被误判为 IP 风控绕了几十步。
- **SKILL.md 第8节 trace 优先原则覆盖响应方向**：响应体非明文时先查 trace 的 xhrNative 响应记录确认响应形态，再按响应方向四层追处理链，禁止先搜源码密钥串猜解密算法（密钥可能作用于别的字段）。
- **crypto-patterns.md 加「响应体编码识别表」**：gzip `1f8b` / zlib `789c` magic number、`mod16≠0` 排除 AES-ECB、凯撒位移、`code` 作位移量/模式标识等负向判型。
- **SKILL.md 4.4 防耗尽检查点覆盖阶段扩展**：从仅 TRACE_ANALYZE 扩到 IMPLEMENT/REAL_VERIFY 的打转场景（黑盒调试、参数长度纠结、响应解密误判）。

### 文档
- **common-pitfalls.md 新增反模式 10**：响应体 `code 非 0 + data 乱码` 被误判为风控/错误码（leisu 案例），正确做法是先查前端 `if(code...)` 分支 + 判 data 编码特征。

## 2.3.32 - 2026-08-14

### 修复
- **ruyipage 取证目标未命中仍返回 0，导致 Step 1 假通过**：`forensic_ruyipage.py` 指定 `--targets/--targets-regex` 后，即使目标接口完全未命中或只命中非 2xx 响应，脚本仍无条件 `return 0`；模型会把同域无关请求（如 `public/time`）当成 Step 1 取证成功并转入源码搜索。修复：`main()` 以 `acceptedTargetCount` 为硬信号——指定目标过滤且未捕获到非 OPTIONS 2xx 目标响应时返回 `1`，报告 `NO_TARGET`/`PARTIAL`，并在 Markdown 报告尾部输出“Step 1 缺失，不得转源码搜索”。
- **`--require-target-signal` 只约束 Step 2 NDJSON，未约束 Step 1**：`check_evidence.js` 的 `--require-target-signal` 只扫 NDJSON，不检查 `capture.json` 是否命中目标接口，导致同域 `public/time` 也能让 Step 1 通过。修复：`inspectCapture()` 同步做目标信号命中判定；同时 `classifyUserInput()` 对 Step 1 用户 HAR/cURL/请求文本也做同样检查。未命中按 Step 1 缺失处理并退出码非 0。

### 优化
- **SKILL.md/scripts/README 同步目标信号门禁口径**：目标接口已知时 GATE-2 必须加 `--require-target-signal`，网络取证命令必须带 `--targets`；文档明确 `forensic_ruyipage.py` 退出码非 0 时回到 `EVIDENCE_GATE` 重采/补材料，而不是转源码搜索。
- **`phase-flow.md`/`ruyi-tooling.md` 同步取证失败处理**：Step 1 抓包从“一次抓完不复抓”改为“目标未命中必须停在 EVIDENCE_GATE 重采或由用户补材料”。

## 2.3.31 - 2026-08-14

### 优化
- **`forensic_ruyipage.py` 加 `--proxy`/`--proxy-auth` 参数**：透传 `smart_fingerprint` 的 `proxy_host`/`proxy_port`/`proxy_user`/`proxy_pwd`（基于本机 ruyipage 1.2.61 内省确认参数名），支持固定出口 IP / 国家匹配的取证场景；国内站点默认直连不受影响。
- **`ruyi-tooling.md` 补代理认证分离原则**：代理账号密码由 `smart_fingerprint` 写 fpfile，不写业务脚本 / `capture.json` / 交付物。

## 2.3.30 - 2026-08-14

### 优化
- **`capture_ruyitrace_log.js` 加 `--ptype` 参数**：透传 `MOZ_DOM_TRACE_PTYPE`，大页面可只保留主/content 进程类型，从源头缩小无关日志（对齐 RuyiTrace 上游文档的环境变量能力）。
- **`ruyi-tooling.md` 补 RuyiTrace NDJSON 事件结构**：`t`/`api`/`args`/`stack` 字段权威说明 + 检索要点，明确 `stack.file:line:col` 是定位关键证据的唯一权威来源。
- **`ruyi-tooling.md` 补「为什么不是 Playwright/Puppeteer」论证**：JS 钩子可被原型检测/`toString` 嗅探/`navigator.webdriver` 探测，RuyiTrace 探针在 C++ 内核层从 JS 视角不可见。
- **`trace-flow.md` 大文件处理原则具体化**：按 5-10 万行一段分批投喂分析防撑爆上下文，采集时用 `--limit`/`--ptype` 从源头缩小日志。

## 2.3.29 - 2026-08-14

### 修复
- **脚本输出 GBK 编码崩溃（Windows PowerShell cp936）**：`check_evidence.js`/`capture_ruyitrace_log.js`/`import_ruyitrace_log.js`/`check_skill_consistency.js` 的 stdout 含 ✅/❌/⚠️ 非 GBK 字符，GBK 控制台直接 UnicodeEncodeError，把 GATE-1/GATE-2/网络取证/trace 采集四阶段输出整体吞掉。修复：状态标记统一改 `[通过]`/`[未通过]`/`[警告]`；`precheck_runtime.js` 的 emoji 测试样本在输出时转 `\uXXXX` 代理对（内部仍用真实 emoji 校验代理对处理）；`forensic_ruyipage.py` 的 `configure_utf8_stdio()` 提前到 `logging.basicConfig` 之前并加 `errors="replace"` 兜底。
- **大 NDJSON 检索 OOM**：`search_trace.js`/`check_evidence.js`(inspectNdjson)/`analyze_trace.js`/`analyze_trace_complexity.js` 用 `readFileSync`+`split` 全量读入 26 万行 trace 触发 `JavaScript heap out of memory`。修复：`search_trace.js` 改 readline 流式 + 前后文环缓冲（顺带修掉"每命中一条就重读整个文件取上下文"的 O(matches×size) 退化）；`check_evidence.js` 用同步分块读（`fs.readSync` 64KB 块）保持 `check()`/自测同步签名；两个 analyze 脚本改流式聚合。
- **取证缺失入口 challenge 页**：`forensic_ruyipage.py` 只保存 JS 和 `--targets` 命中包，acw_sc__v2 首次 412/challenge 页内联脚本被排除在落盘范围外。修复：始终保存入口 HTML 到 `case/forensic/document.html`（识别 text/html 或 URL 精确匹配），报告与输出区均标注，challenge cookie 类目标不再缺失挑战源码。

### 优化
- **新增 `scripts/search_js.js`**：大文件/单行 8MB 压缩 bundle 关键词检索，输出 `line:col` + 有限字符上下文，替代 grep（单行超 64KB 报 "Ripgrep JSON record exceeded 65536 bytes"）和现场 `node -e`（PowerShell 引号转义翻车）。
- **SKILL.md TRACE_ANALYZE 加「先 trace 后读源码」硬约束**：先 `import_ruyitrace_log` 摘要 → `search_trace --url` 定位请求链与 `stack.file:line:col` → 再按行号/字符偏移切片段；禁止先读大 bundle 手猜 webpack module id 或写 probe1~N 静态解析。
- **SKILL.md 4.4 加阶段报告最小落盘 + 上下文防耗尽检查点**：每阶段结束必落最小报告；TRACE_ANALYZE 接近耗尽或 20+ 步未进 IMPLEMENT 前，强制先写 `notes/entry-chain.md`/`notes/missing-env-priority.md`，避免续接从零开始。
- **SKILL.md 补 `PYTHONUTF8=1` 兜底说明**。

## 2.3.28 - 2026-08-14

### 优化
- **SKILL.md 降密度重构**：正文从约 480 行 / 38.6KB 降到约 344 行 / 22.2KB，保留 GATE-0~GATE-2、绝对规则、纯协议红线、状态机、真实 API 验证与交付检查；将完整 references 路由迁至 `references/workflow/reference-map.md`。
- **新增 `scripts/check_skill_consistency.js`**：校验 SKILL.md frontmatter、关键门禁锚点、引用路径和 references 孤儿文件，防止后续精简误删约束。
- **同步 `scripts/README.md`**：脚本总数更新为 52（45 JavaScript、7 Python）。

## 2.3.27 - 2026-08-14

### 修复
- **`check_session_resume.js` tools 根推断错误（多 case 项目第一遍必失败）**：`paths.resolveProjectDirFromCaseDir` 只认 `basename==='case'`，嵌套 case 目录（`<project-root>/<case-name>/` 与 `<project-root>/tools/` 平级）被误当工程根，快照写入被拒（日志里靠 junction 绕过、快照绝对路径绑定 junction，删 junction 后续接失败）。修复：① 该函数改为从 case 目录向上（最多 5 层）查找包含 `tools/` 的目录；② `check_session_resume.js` 新增 `--project-dir` 显式覆盖推断；③ 快照 `projectRoot` 记录真实工程根而非 skill 安装根。
- **`forensic_ruyipage.py` 取证第一遍必失败 + 成功后仍退出 1**：`_find_managed_runtime` 只扫 `find_project_root()/tools`（安装模式下是 skill 根，无 tools/），明明 `check_external_tools.js` 已检测到 runtime 还是定位不到；且脚本无 UTF-8 stdio 配置，GBK 控制台输出含 `⚠️` 直接 `UnicodeEncodeError` 崩在渲染阶段。修复：runtime 兜底扫描候选对齐 JS 侧 `getDefaultRuyiBrowsersDirs`（`--project-dir` → `--case-dir` 及其上级 → `RUYIPAGE_BROWSERS_PATH` → cwd 及其上级 → skill 根 → 平台缓存），新增 `--project-dir`；模块顶部按仓库惯例 `configure_utf8_stdio()`。
- **RuyiTrace `--target-signal` 逐文件硬门禁误报**：`capture_ruyitrace_log.js` 对每个 NDJSON（含 cookie/storage/event/descriptor/eval/wasm 分类日志）都传 `--target-signal`，任一文件未命中即退出 4——业务目标接口只可能出现在主 DOM trace 日志，分类日志必然"未命中"。且隐藏 bug：`import_ruyitrace_log.js` 每次导入都覆盖 `notes/ruyitrace-summary.md`，多文件导入后摘要被最后一个分类日志覆盖。修复：目标信号只在主 DOM trace 日志（logs[0]）上判定，退出 4 只由主日志未命中触发；分类日志照常导入做摘要但加 `--no-summary-write` 不覆盖主摘要。
- **`check_final_artifact.js` 联网模式验证记录被绕过**：验证记录检查只认文档声明的 `networkMode`，文档未标记时真实联网项目（代码含 `https.request`/`session.request`）整体跳过"至少 5 条有效 attempts"。修复：联网模式判定以代码真实请求为准（`online = 文档声明 || 代码请求命中`），代码有真实请求即强制检查验证记录；代码/文档明确 sign-only 且无真实请求时检查 sign-only 豁免。
- **`check_final_artifact.js` 硬编码检查误报 package.json 脚本名**：`hardcodedRe` 扫 `isCodeLikeFile`（含 .json），`"verify": "node ..."` 命中加密参数名正则。修复：硬编码加密参数检查只对源码文件（js/mjs/cjs/py）生效，元数据文件跳过。
- **`check_code_quality.js` Object.assign 误报 HTTP 客户端**：`Object.assign(...{...{...})` 单行堆叠规则对所有文件生效，`src/request/client.js` 合并 headers/options 被报"补环境代码应拆为 createProtoChains/defineProperty"。修复：该规则只对补环境主体域（`src/env/`、`src/signer/`、probe/runtime-runner 类文件）生效。
- **`check_node_runtime_compat.js` 与 SKILL 统一参数规则冲突**：SKILL.md 4.1 规定所有脚本 `--case-dir` 统一传 `<project-root>`，该脚本不认 `--case-dir` 直接抛"未知参数"。修复：接受 `--case-dir/--dir/-d`（本脚本只需 Node 版本信息，参数接受但不参与逻辑）。

### 优化
- **SKILL.md GATE-1 / 4.1 同步**：`check_session_resume.js` 命令模板补 `--project-dir <project-root>`（与 `check_external_tools.js` 一致），并说明未传时自动从 `--case-dir` 向上推断 tools/ 的布局兼容。

## 2.3.26 - 2026-08-13

### 修复
- **取证 JS 落盘 0B 根因（forensic_ruyipage.py 防挂补丁误伤新流程）**：`_apply_ruyipage_anti_hang_patch` 全局置空 `CapturePacket._fallback_fetch_body` 且把 `response_body_timeout` 压到 1s，是为旧 `capture.stop()` 全量拉 body 写的；`run_forensic` 改按需 `to_dict(include_bodies=True)` 后补丁未删，把 gzip/br 响应体唯一的 replay 兜底砍了——大 JS 落盘 0B、取证"带病 PASS"。现改为：fallback 仅对非 JS GET 跳过（JS 保留 replay 兜底，这是 0B 的真正修复），timeout 恢复默认 10s；另加 `_maybe_decompress` 做 gzip/deflate 防御性解压（ruyipage 已把 body 解码为字符串的场景不触发，仅兜住未来 raw 压缩字节直接到达的情况）。
- **JS 落盘质量暴露为硬信号（防带病 PASS）**：`forensic_ruyipage.py` 报告新增 `jsQuality`/`jsMissingCount`（缺失 ≥50% 标 FAIL 并输出重采提示）；`check_evidence.js` 新增 JS 落盘质量门禁——capture 记录到 JS 资源但全部落盘为空（0B）时按 Step 1 缺失处理（退出码 1），部分缺失给警告，并补自测断言。

### 优化
- **WASM 决策前置强规则 + 整包 Emscripten bundle 黑盒打法（此前空白）**：`decision-tree.md` / `scenario-quickref.md` / `SKILL.md` IDENTIFY 增加"确认加密在 WASM 后先整包黑盒（vm 加载原版 glue + mock window/document/第三方 SDK/fetch + hook fetch 抓 body），禁止先手撕字节码"；`env-wasm-advanced.md` 新增「整包 Emscripten bundle 黑盒执行」章节（webpack 内嵌 wasm base64、Asyncify ccall、跨 realm instanceof、WebAssembly.Table funcref/anyfunc、CaptchaSDK 回调生命周期 mock）；新增 `templates/wasm-loader/emscripten-bundle-blackbox.js` harness 模板。
- **CASE_LOOKUP 拆回独立 TODO 项**：SKILL.md 执行主线 TODO 第 5 项从「定位 IDENTIFY（含 CASE_LOOKUP/EXTERNAL_LOOKUP）」拆为「案例检索 CASE_LOOKUP」与「定位 IDENTIFY」两项，让"先搜本地+网络现成结论"成为可勾选强制节点（本次实战因合并导致跳过案例检索、多走了约 40 条手撕消息）。
- **trace 检索助手**：新增 `scripts/search_trace.js`（`--keyword`/`--regex`/`--url` 按行号+上下文检索 NDJSON），SKILL.md TRACE_ANALYZE 显式指向，替代命令行手搓 `python -c`/引号嵌套 grep（本次实战反复出现 SyntaxError/AttributeError）。
- **关键结论随节点落盘（防上下文压缩丢主线）**：SKILL.md 4.5 状态记录新增要求——IDENTIFY 结论、WASM 黑盒跑通、body 结构确认、实现方案选定等重活节点转移时必须 `write_stage_report.js` 写入 `case/阶段报告/`，续接不靠对话记忆重复确认。
- **REAL_VERIFY 范围纪律**：SKILL.md REAL_VERIFY 新增"黑盒输出与取证样本结构一致后直接用真实 URL 进验证；内部参数映射等旁支问题不阻塞交付，记录到经验沉淀而非反复排错"。

## 2.3.25 - 2026-08-13

### 修复
- **Firefox 155 取证启动兼容（ruyipage 1.2.45~1.2.61 均未处理，共享脚本补齐）**：
  - `forensic_ruyipage.py` `build_options` 补 `--remote-allow-system-access`：管理员/提权 Windows 会话下 Firefox 155+ 默认拒绝浏览器外的远程调试连接，缺参表现为"浏览器启动了但 BiDi 连不上、抓包脚本启动卡死"；
  - `forensic_ruyipage.py` 新增 capture 订阅降级补丁：ruyipage 1.2.61 的 `capture.start` 在 `session.subscribe` 无条件传 `contexts`，privileged scope（Firefox 155+）下直接抛错导致抓包无法启动；运行时把 subscribe 包一层，带 contexts 失败自动降级为全局订阅（1.2.45 首次尝试即成功，无额外 RPC）。
- **禁止再改 site-packages/wheel 内部绕过**：ruyipage 1.2.61 的这两个缺口一律在共享脚本层修复（`forensic_ruyipage.py`），wheel 内直接改 `capture.py` 会在升级/重装后丢失且不可复现；环境检测与文档同步更新。

### 保留的用户决策区（C 档，勿当作残留清理）
登录/验证码/人工识别、手动 trace、打码平台等付费服务与人工接管选择、登录态 profile 处置、fingerprint baseline 切换、cURL 基线风险接受、工具版本升级——这些属于 C 档，仍由用户决定，等待期间并行推进其他分析。

## 2.3.24 - 2026-08-12

### 优化
- **确认策略收口为唯一稳定原则（SKILL.md 第 1 节新增）**：是否停下等用户，按同一根轴判定（**对外部世界的影响与可逆性**）分 A/B/C 三档——A 证据/选择可自动判定 → 默认自动推进，不停下；B 有外部副作用/不可逆 → **执行前宣布一行（做什么、影响什么、装到哪、发几个什么请求、如何打断）+ 继续 + 可打断**，不停下等回复；C AI 不可替代的物理交互 → 停下等用户，期间并行推进其他分析。2.3.23 的"默认自动推进"只覆盖 A 档，把 B 档也静默执行（且把 C 档边界模糊化），是过度纠正；本版补齐 B/C 两档。
- **GATE-1 安装改为「宣布 + 继续 + 可打断」（修正 2.3.23 的错误表述）**：`install_all.js --yes` 执行前必须先输出一行宣布（缺失组件、安装目标 `<project-root>/tools/`、预计下载规模与影响）。核实现状：install_all.js 带 `--yes` 时直接 `install()`，**不带 `--yes` 才打印计划并退出**——SKILL.md 原"输出会打印安装计划与目标目录"对 `--yes` 调用不成立，计划必须由 AI 在调用前以文本宣布承担。
- **REAL_VERIFY 写请求分级**：只读/验签请求（GET、验签类 POST）默认真实执行，不逐次确认；有业务副作用的写请求（提交表单、修改状态）执行前先宣布（目标 URL、方法、次数、预期业务影响），随后继续。
- **标签与命名修正**：SKILL.md 启动顺序"确认范围"改"意图声明"（:96 与 TODO 第 1 项 :138）；cases/_template.md 检查清单"TLS 客户端已确认/可疑加密参数已确认"改为自动探测与证据定位表述（阶段报告文件名沿用脚本 `--stage` token 不改名，加注记说明）。

### 修复
- **同文件/跨文件残留矛盾清零**（2.3.23 只改了部分节点，本版补齐）：
  - `tls-validation.md`：:47"只在用户确认后安装"与 :30 新政策同文件矛盾 → 改为默认自动安装 + 执行前宣布；前置阶段字段同步（任务确认 → GATE-0 意图声明；"若未安装：安装该客户端/改选" → 自动安装默认）。
  - `ruyi-tooling.md`：介入确认清单 item 2（"由用户选择"）改自动安装、失败后才选择；:104-119「ruyiPage + RuyiTrace 但 RuyiTrace 未安装」整节重写为先自动安装→失败后才由用户选择；:54"用户选择后沿用"残留清除；手动 ruyiPage/RuyiTrace 安装流程统一加"仅自动安装失败后使用"前置并更新提示模板。
  - `browser-acquisition.md`：:106 与 :108 同文件矛盾（自动安装 vs 暂停让用户选）→ 统一为自动安装、安装失败后才选择；定制 Firefox 检测失败提示模板改为自动安装优先；登录后意图确认句改自动推进。
  - `intake-template.md` / `phase-flow.md` 阻断项："未确认目标参数"改"目标参数未列全 → 证据列全候选继续"；"选了 RuyiTrace 未安装暂停让用户装"改自动安装、失败后才选择。
  - `decision-tree.md` 阻塞点 #5：工具未装 → 默认自动安装，安装失败时暂停。
  - `trace-flow.md`：:75/:88/:132/:333 旧"用户选择 RuyiTrace/确认 Profile"句式清理，统一为自动 trace 默认 + 交互才转手动。
  - `env-debug-loop.md`：:43 旧"暂停要求用户提供或采集日志"改默认自动采集、交互转手动。
  - `validation.md`：测试 1/2 移除 TLS 客户端必填（自动探测补齐）；测试 8"询问用户是否授权取证"改直接使用已确认取证工具；测试 4/20 新增「执行安装前必须输出独立宣布行」「写请求执行前宣布」断言，反例明确"静默执行 install_all.js --yes 不先宣布"。
- **案例库教训恢复**：`sm2-sm4-sm3-guomi-jobonline.md` INTENT_CONFIRM 条目被 2.3.23 就地改写（历史教训文本被替换）→ 恢复原文并追加 2.3.24 修正注记：确认门禁把"要素缺失该问"与"要素齐全也确认"混为一谈，现行正确读法是"信息缺失时不得凭猜测推进"，而非"每节点都要确认"；同案例 item 3"由用户选择安装方式"同样追加修正注记。
- **脚本层旧政策输出同步（文档 vs 门禁脚本矛盾清零）**：文档已统一 A/B/C 政策，但 GATE 脚本输出仍是旧流程的"下一步需要用户确认"，不修则下次跑 GATE-1 时脚本输出会把 agent 拉回确认模型：
  - `check_external_tools.js`（GATE-1 硬信号）：ruyiPage 未装 / 版本过低 / runtime 缺失 / RuyiTrace 未通过 4 处"下一步"文案全部改"自动安装（`install_all.js --yes`，执行前先宣布缺失组件、安装目标与规模），失败后才由用户选择"；RuyiTrace 采集方式"由用户选择"改"默认自动 trace，不询问"；`## 下一步需要用户确认` 标题改 `## 下一步`。
  - `check_intake.js`：必填清单收窄为目标 URL + 目标参数名（取证模式、TLS 客户端移出必填；API/方法/位置/样本由取证补采）；缺失提示改"目标 URL 或参数名缺失且无法提取时才问一次最小信息，其余由门禁补采/自动探测补齐，不阻塞推进"；通过分支的"整理给用户确认，用户确认后再…"改直接进入 GATE-1。
  - `check_tls_clients.js`：未安装提示改"按交付语言自动安装默认客户端（执行前先宣布）"；REAL_VERIFY 自动选用已安装客户端 + 写请求执行前宣布。
  - `capture_ruyitrace_log.js`：dry-run 文案改"按 GATE-1 自动安装，失败后才可让用户安装/提供路径或确认降级"；采集方式不再询问。
  - `init_env_case.js`：case 清单"用户已确认本次要分析哪些加密参数""浏览器取证模式已由用户选择"改"已按证据定位参数""取证来源已由 EVIDENCE_GATE 判定"。
  - `write_stage_report.js`：默认下一步"列出所有可疑加密参数并等待用户确认""确认取证工具和 TLS 客户端可用性"改"按证据列出候选并定位""按 GATE-1 检测/安装（默认自动，执行前宣布）"。
  - `validation.md` 测试 107：由"缺少 TLS 客户端时 check_intake.js 检查不通过"改为断言"TLS 客户端与取证模式不阻塞信息完整性门禁"（与测试 1/2 一致，消除 validation 自身左右互搏）。
  - `check_web_verify_patcher.js`：安装指引"自动安装前先让用户确认安装目录"改"执行前先宣布安装目标，随后执行，不要求用户确认"。
  - `install_ruyipage_runtime.js`：帮助文本与 dry-run 输出"必须先获得用户确认"改 B 档"执行前先宣布"；`scripts/README.md` check_intake 描述注明必填仅 URL + 参数名。
- **文档边角**：phase-flow 0.2"可选确认：TLS 客户端、登录态"→ 登录态属 C 档、TLS 自动探测；tls-validation :3/:12、protocol-analysis:82 统一"自动探测"措辞；ruyi-tooling"只有以下场景才需要用户介入确认"清单头改"需要特殊处理"；SKILL.md 完成判定"目标范围已确认"改"已声明且要素齐备"。

### 保留的用户决策区（C 档，勿当作残留清理）
登录/验证码/人工识别、手动 trace、打码平台等付费服务与人工接管选择、登录态 profile 处置、fingerprint baseline 切换、cURL 基线风险接受、工具版本升级——这些属于 C 档，仍由用户决定，等待期间并行推进其他分析。

## 2.3.23 - 2026-08-12

### 优化
- **默认自动推进，消除"断会话等用户回复"（真实使用反馈）**：原流程在 GATE-0 要求"用户确认范围后才继续"，GATE-1 安装前、GATE-2 入口、TLS 客户端选择、RuyiTrace 采集方式选择等节点多次停下等待用户输入，与第 1 节"不进入拦截或反复确认逻辑"自相矛盾；实测日志中意图声明要素齐全仍输出"是否继续？"。修复：统一为"默认自动推进"模型——GATE-0 要素齐备（目标 URL + 参数名可确定）即直接进入 GATE-1，不询问补充材料、不要求确认；GATE-1 缺失组件直接 `install_all.js --yes` 自动安装；GATE-2 无用户确认环节；TLS 客户端自动探测（curl-cffi-node → impers → curl_cffi）；RuyiTrace 采集方式默认自动 trace、失败或需交互时转手动 trace，不询问选择。仅两类情况才停下等用户：① 目标 URL / 参数名缺失且无法合理提取（问一次最小信息）；② 需要登录、验证码、人工识别等 AI 无法替代的物理交互（提示用户在取证浏览器操作并等待确认）。同步更新 validation 测试 3/4/5/20、decision-tree 阻塞点 1-3、intake-template、phase-flow、browser-acquisition、ruyi-tooling 与案例库中"要求用户确认"的旧表述。

## 2.3.22 - 2026-08-12

### 修复
- **forensic_ruyipage.py 二进制 body 被 UTF-8 解码破坏（真实案例复盘 P0）**：`capture.json` 目标命中记录的 response/request body 一律 `.decode("utf-8","replace")`，`application/octet-stream` 等二进制响应被损坏（字节丢失），后续所有基于坏样本的 body 对比失真。修复：新增 `_body_to_text` 按 Content-Type 或 UTF-8 严格解码结果区分——文本落字符串，二进制（octet-stream / 解码失败）落 base64 并写 `response_body_binary` / `response_body_bytes` 字段保留原始字节信息。
- **trace 采集默认时长口径不一致（真实案例复盘 P2）**：`capture_ruyitrace_log.js` 默认 `--duration` 60 秒，而取证侧 `--wait` 已是 120 秒；需要手动触发的目标请求（登录/点击/验证码）在自动跑满时长后未触发即收工。修复：默认 60 → 120 秒（含 usage 示例同步）。

### 新增
- **目标信号检测（真实案例复盘 P1，GATE-2 盲区修复）**：`check_evidence.js` 的 Step 2 只验「可解析、非空、关联目标域」，页面加载日志天然满足——一份未触发目标接口的 NDJSON 也能过证据门禁。修复：`import_ruyitrace_log.js` 新增 `--target-signal <信号>`（可多次），导入时扫描 NDJSON 是否命中目标接口 URL / 关键词，未命中输出 ⚠️ 且退出码非 0（硬信号）；`capture_ruyitrace_log.js` 新增同名参数并透传给导入；`check_evidence.js` 新增 `--require-target-signal <信号>`，未命中按 Step 2 缺失处理（退出码 1）；SKILL.md 4.3 质量判定新增「目标信号未命中 = 质量不足（硬信号）」，TRACE_CAPTURE 命令模板带 `--target-signal`。
- **浏览器关闭失败显眼告警（真实案例复盘 P3）**：`killOk=false` 时除报告字段外，stderr 与 markdown 报告同时输出 ⚠️ 浏览器未能自动关闭提示（含 profile 路径）。

### 优化
- **SKILL.md 4.3 手动触发协调环节（真实案例复盘 P1）**：目标请求需登录/点击/验证码/权限确认时，启动 trace（或取证）后必须提示用户在 trace 浏览器操作，**用户确认「已触发」前不得结束采集**；自动 trace 默认 120 秒兜底，不足转手动 trace。此前的提示逻辑散落在 references（browser-acquisition.md / trace-flow.md），自动 trace 主路径未覆盖。
- **逃生舱边界（真实案例复盘 P2）**：ruyi-tooling.md 新增第 0 条——共享脚本缺陷/能力缺口不得用 case 内手写脚本绕过，先修共享脚本或请用户提供材料；手写仅限「复杂多步交互」一种理由。
- **SKILL.md 4.5 状态记录强制输出（真实案例复盘 P3）**：状态转换必须输出一行「当前状态 + 证据状态 + 门禁结论」状态行（示例：`TRACE_RETRY：目标路径未覆盖（--target-signal 未命中，退出码 1），阻断分析`）；新增 IMPLEMENT 前置条件硬约束（trace 达标或用户确认轻量路径，两条均不满足停在 TRACE_ANALYZE）。

---

## 2.3.21 - 2026-08-12

### 修复
- **forensic_ruyipage.py 取证窗口默认 30 秒过短（真实案例复盘 P1）**：99.com handshake 案例中目标握手请求需在登录页手动触发，默认 `--wait 30` 秒窗口在用户来得及操作前就超时关闭。修复：默认 `--wait` 30 → 120 秒；行为保持「窗口内命中 `--targets` 目标接口即提前关闭，未命中到点自动关闭」，浏览器打开期间供用户手动触发。

### 优化
- **取证脚本命令模板显式化 + 目标请求未命中硬规则（真实案例复盘）**：SKILL.md 4.3 新增硬规则——取证窗口结束仍未捕获目标接口且需用户交互时，重采必须在浏览器打开期间提示用户操作（窗口不够可调大 `--wait`）或请用户提供该接口 cURL / HAR / 原始请求文本，Step 1 缺失前不得进入 `IDENTIFY` / `TRACE_ANALYZE` / `IMPLEMENT`；取证命令模板补 `--targets` 示例与 `--wait` 说明；scripts/README.md 同步说明窗口行为。

---

## 2.3.20 - 2026-08-12

### 修复
- **install_all.js Python 自动探测死代码（外部审计 P1）**：`parseArgs` 的 `--python` 默认值与兜底值均为 `'python'`（恒真），`resolvePython` 的 `if (explicit)` 分支永远命中，`python3 → py -3` 探测循环永不执行，与 usage（第 49 行）及 2.3.19「未提供时按 python → python3 → py -3 自动探测」声明矛盾；在只有 python3/py -3 的机器上 GATE-1 硬门禁检测会失败。修复：默认值与兜底值改为 `''`，恢复自动探测。
- **install_all.js 镜像探测 `-o NUL` 跨平台问题（外部审计 P3）**：`curl -o NUL` 在 Linux/macOS 会在 cwd 留下名为 `NUL` 的文件。修复：改用 `os.devNull`（Windows=NUL、Linux/macOS=/dev/null）。
- **三个 Python 脚本工作树 CRLF 未归一（外部审计 P3）**：`analyze_tile_restore.py` / `generate_motion_track.py` / `map_coordinates.py` 磁盘为 CRLF（`i/lf w/crlf`），与 `.gitattributes eol=lf` 及 2.3.19 归一声明不符，`core.autocrlf=false` 下会把 CRLF 重新带进后续提交。修复：重新检出归一为 LF。
- **git upstream 失效（外部审计 P2）**：本地 `refs/remotes/origin/main` 缺失导致 `[origin/main: gone]`，推送会失败，且 `.git/config` 残留 `vscode-merge-base = origin/main`。修复：fetch 后手动补 ref、重置 upstream 为 `origin/main`、清除残留配置（远端 main 分支实际存在，非远端删除）。
- **README 案例数量与索引不符（外部审计 P3）**：`cases/` 17 条中 2 条为 `kind: template` 方法论骨架（universal-vmp-source-instrumentation、vm-sandbox-custom-algo），实证案例实为 15 个。修复：README 目录结构改为「15 个实证案例 + 2 个方法论模板」。
- **缺 LICENSE 文件（外部审计 P2）**：README 声明 MIT 但根目录无 LICENSE。修复：新增 MIT LICENSE 文件；README 来源表补充 4 个上游项目许可证标注（hello_js_reverse_skill / RuyiTrace 未声明、xbsReverseSkill MIT、ruyipage BSD-3-Clause）与合规提示。

---

## 2.3.19 - 2026-08-12

### 修复
- **install_all.js 安装失败退出码可被后验 Python 回退绕过（复核 P1）**：安装阶段严格用 `--python` 指定解释器，但后验 `verify()` 调 `check_external_tools.js` 在显式 Python 不可用时回退 `python`/`python3`/`py -3`，本机任一解释器装有 ruyiPage 即判环境完整，而 `computeAllOk` 只看最终环境不看本次安装步骤 → 安装动作失败仍退 0，AI/CI 误判成功。修复：退出码改为 `stepsOk && computeAllOk`（本次安装步骤任一失败即退非零）；新增 `resolvePython`——显式 `--python` 严格使用不回退，未提供时按 `python → python3 → py -3` 自动探测，安装与后验全程同一解释器；`check_external_tools.js` 新增 `--python-args`（如 `--python py --python-args -3`）支持显式解释器带前缀严格探测，不传时行为不变（向后兼容）。端到端验证：显式不存在 Python + 安装步骤全失败 + 后验回退成功，现在正确退 1。

### 优化
- **新参数同步到主流程文档**：`install_all.js --project-dir`（SKILL.md GATE-1 / phase-flow / ruyi-tooling / scripts-README）、`check_external_tools.js --offline`（SKILL.md GATE-1 检测命令）补齐。安装不再依赖"先 cd"软约束，GATE-1 检测默认离线保证确定性（需版本对比提示时去掉 `--offline`）。

---

## 2.3.18 - 2026-08-12

### 修复
- **tooling 两文档「取证模式选择」旧模型残留（2.3.5/2.3.17 同类漏网）**：2.3.5 清 validation.md、2.3.17 清 cases/_template 与 stage-reports 的「取证模式选择/已确认」字段时，漏掉 tooling 子域两份文档。`browser-acquisition.md` 第 3/5/19/21-41 行整节（「取证模式选择触发时机」「取证模式选择」要求任何取证动作前先让用户选模式、未选择前不能开浏览器）与 `ruyi-tooling.md` 第 38-53 行「取证工具选择权必须交给用户」4 选项模板（含「仅 ruyiPage」「AI 自行决定」）仍与 EVIDENCE_GATE 自动判定模型冲突（validation.md 测试 7「取证路径由 EVIDENCE_GATE 自动判定」），且「仅 ruyiPage」选项与 SKILL.md TRACE_CAPTURE 必做步骤矛盾。修复：两文档改为「取证来源由 EVIDENCE_GATE 自动判定」——ruyipage 网络取证 / RuyiTrace 日志采集 / 用户手动材料，用户提供真实材料跳过对应步骤；删除 4 选项选择模板；RuyiTrace 缺失时的安装/降级确认流程（ruyi-tooling 第 103-130 行）保留并改为「取证需要 RuyiTrace」表述；browser-acquisition 的登录处理 / Cookie 分类 / 指纹基线 / isTrusted / ruyiPage 启动硬约束等有效内容全部保留。
- **ruyi-tooling.md RuyiTrace 采集方式默认值矛盾（validation.md 测试 13）**：原文「采集方式由用户选择（手动/自动二选一）」与 validation.md 测试 13「RuyiTrace 采集默认自动、失败转手动」矛盾。改为默认自动 trace（capture_ruyitrace_log.js），自动失败 / 需登录验证 / 用户指定日志时转手动 trace。
- **scripts/README.md check_evidence 退出码旧表述（2.3.17 漏同步）**：2.3.17 把 check_evidence.js 退出码改为「缺失证据退 1」并同步脚本 usage，但 scripts/README.md 第 40 行仍写「四种证据路由都是正常诊断结果并退出 0」，与 SKILL.md 第 0 节「退出码是硬信号」及脚本实际行为矛盾。修复：同步为「缺失证据（missing 非空）或材料格式错误（errors 非空）退出 1，两步齐全退出 0」。
- **browser-acquisition.md 验证码/登录模板残留「取证模式」字段**：第 90 行「让用户选择取证方式」改为「让用户确认取证方式（AI 自动最小交互 / 用户自己在取证浏览器中触发）」，第 182 行登录提示模板字段「取证模式：ruyiPage + RuyiTrace / 用户手动取证」改为「取证来源：ruyipage 网络取证 / RuyiTrace 日志采集 / 用户手动材料」。
- **templates/README.md `src/signer.py` 引用不存在的文件**：模板中无 src/signer.py（python-request 只有 final.py/client.py/requirements.txt），原文「按需引用 client.py 和 src/signer.py」易被理解为模板自带。改为「按需引用模板的 client.py；signer 逻辑按站点实现，交付时自建 src/signer.py」。

---

## 2.3.17 - 2026-08-12

### 修复
- **check_evidence.js 缺证据时退出码为 0，与「退出码是硬信号」承诺矛盾（约束流程）**：脚本 `errors` 只在材料格式错误时填充，缺失证据（missing）不进入 errors，导致无证据时退出码 0——SKILL.md 第 0 节/GATE-2 宣称"退出码非 0 必须停"，实际靠输出文本「缺失证据」兜底，退出码信号是假的。修复：退出码改为 `errors.length || missing.length ? 1 : 0`，缺任何一步证据即退 1；usage 说明同步更新为「退出码是硬信号」；自测新增空证据退 1 / 双证据退 0 断言（23 项）。
- **--case-dir 语义分裂：SKILL.md 4.1「所有脚本统一传 <project-root>」与 12+ 个质检脚本实际期望 case 子目录矛盾**：check_object_shape_audit / check_webapi_env_detection_matrix / check_xhr_fetch_semantics / check_xhr_fetch_session_bridge / check_dynamic_resources / check_change_memory / check_stage_reports / check_trace_runtime_conformance / analyze_trace_complexity / build_trace_runtime_contract / check_environment_closure / run_trace_runtime_audit / check_env_realism 默认 `'case'` 期望 case 子目录，AI 按 SKILL.md 传 project-root 会检查错目录（如检查范围变成 `<project-root>/../result`）。修复：`scripts/lib/paths.js` 新增共享 `resolveCaseDir`（兼容 project-root 与 case 子目录，统一返回 case 目录），13 个脚本接入替换本地 `path.resolve`；SKILL.md 4.1 更新为「所有脚本统一传 <project-root>（已全局归一化）」。实测双传参均正确。
- **references 中 6 处 `check_external_tools.js` 命令缺 `--project-dir`（GATE-1 铁律未全量同步）**：phase-flow.md / trace-flow.md / ruyi-tooling.md / browser-acquisition.md / validation.md 的检测命令模板未带 `--project-dir <project-root>`，AI 照抄会在安装模式下检测失败（2.3.14 修复点）。修复：6 处命令补全 `--project-dir`。
- **browser-acquisition.md 残留旧工具与错误命令**：`capture_ruyitrace_log.js --case-dir case` 相对路径传 case 子目录（A 类脚本期望 project-root，会错位），改为 `--case-dir <project-root>` 并去掉多余的 `--ruyitrace-home`（可由 --project-dir 推断）。
- **captcha 子域残留旧概念**：verification-workflow.md「ruyiPage/Camoufox/CloakBrowser 模式」→ 改为「ruyiPage + RuyiTrace / 用户手动取证」（Camoufox/CloakBrowser 是 2.2.0 已移除工具，违反绝对规则 8 取证白名单）；solver-platform-recipes.md「未确认授权、未选择平台」→ 去掉「未确认授权」（2.3.5 同类残留）。
- **common-pitfalls.md「红线四条」残留**：当前第 3 节纯协议红线无编号（实为 7 条），改为「第 3 节纯协议红线违反即失败」。
- **cases/_template.md 与 stage-reports.md 残留「取证模式选择/已确认」字段**：与 EVIDENCE_GATE 自动判定模型冲突（2.3.5 清 validation.md 时漏这两处），改为「取证来源：ruyipage / RuyiTrace / 用户手动材料」与「证据门禁已通过」。
- **debug-playbook.md `--case-dir <case>/case` 占位符错误**：改为 `--case-dir <project-root>`（无 `<case>` 占位符定义）。

---

## 2.3.16 - 2026-08-12

### 修复
- **AI 实战不传 --project-dir 导致 RuyiTrace 检测仍失败 + 提示不引导**：装版 skill 已是 2.3.15，但 AI 跑 GATE-2 不传 `--project-dir`（SKILL.md 模板写了，AI 没遵守），且 `check_external_tools.js` 的"未检测到 RuyiTrace"提示只写 `--ruyitrace-home` / `RUYI_TRACE_HOME`，没提 `--project-dir`，AI 跟着提示走没想到用它。修复：① `check_external_tools.js` 的 reason + nextRequiredInput 提示加 `--project-dir` 引导（AI 看到提示知道用）；② SKILL.md GATE-2 把 `--project-dir` 从"模板写法"升级为铁律（安装模式下必须传，否则检测必失败）。
- **AI 自建 fetch_page.js 抓页面（2.2.0 重构把全局硬约束降级为局部节内约束）**：用户实战反馈 AI 自建脚本抓取目标页面，重构前不会。"禁止手写抓取/禁止 requests/curl 下载目标 JS"约束在 2.2.0 重构前是红线3（全局最高优先级，覆盖所有阶段），重构后降到 4.3 FORENSIC_CAPTURE 节内，AI 在意图声明阶段（还没到 FORENSIC_CAPTURE）自建 `fetch_page.js` 认为不违反 4.3。修复：把该约束上移到第 2 节绝对规则第 8 条（全局，覆盖意图声明/取证/分析所有阶段），4.3 节保留指向。本质是"2.2.0 重构把全局硬约束降级成局部节内约束"的回归，与已记 MEMORY 的"2.2.0 重构回归点"同类但此前未发现。
- **GATE 编号顺序仍与状态机矛盾（2.3.11 修复未彻底）**：2.3.11 把续接单列成 GATE-0 放在意图之前，自称"编号顺序状态机三者统一"，但状态机没有续接节点（续接是 ENV_READY 内部判定），GATE-0 在 GATE-1 意图之前运行环境脚本 check_session_resume.js，AI 实际行为仍是"先测环境后看范围"。且第 0 节（GATE-0 续接在前）与 4.1 节（先意图后环境）顺序相反，AI 读哪边都困惑。修复：合并续接判定进 GATE-1 环境自检（作为第一步：先判模式，resume 跳过完整自检，fresh 全跑），GATE 编号重排为 GATE-0 意图 / GATE-1 环境(含续接) / GATE-2 证据，严格一一对应 INTENT_CONFIRM / ENV_READY / EVIDENCE_GATE。同步第 17 行 GATE-0~3→GATE-0~2、第 48 行澄清句、第 66 行绝对规则 3 的 GATE-3→GATE-2。2.3.12 的 resume 澄清迁移到 GATE-1 内部。

---

## 2.3.15 - 2026-08-12

### 重构
- **抽共享路径模块 `scripts/lib/paths.js` 统一环境检测路径定位**：路径逻辑（findProjectRoot / normalizeTraceHome / getDefaultRuyiBrowsersDirs）原散落在 check_external_tools.js / capture_ruyitrace_log.js / check_session_resume.js 三脚本各自重复实现，且细节不一致（findProjectRoot 三份实现：capture/check_session_resume 直接 return cwd，check_external_tools 有 cwd 向上找10层段），改一处漏一处（2.3.8 漏 check_session_resume、2.3.14 漏 capture）。本次抽 `scripts/lib/paths.js` 共享模块，导出 `findProjectRoot / normalizeTraceHome / getDefaultRuyiBrowsersDirs / resolveProjectDirFromCaseDir`，自包含辅助函数（exists/isDir/whereCommand/compareVersion/uniquePaths）。三脚本 require 接入并删除重复实现：check_external_tools.js 删 findProjectRoot/getDefaultRuyiBrowsersDirs/whereCommand/normalizeTraceHome；capture_ruyitrace_log.js 删 whereCommand/normalizeTraceHome/compareVersion/findProjectRoot；check_session_resume.js 删 findProjectRoot。
- **capture_ruyitrace_log.js 补 --project-dir + 自动推断（修复 2.3.14 漏改）**：2.3.14 漏改 capture 的 normalizeTraceHome（还是老的 cwd+findProjectRoot 两候选，安装模式下撞车失效）。本次接入共享模块修复，新增 --project-dir 参数；未传时从 --case-dir 自动推断工程根（resolveProjectDirFromCaseDir），AI 传 --case-dir 即可定位 tools/，无需显式 --project-dir。
- **路径定位逻辑统一**：候选顺序全模块统一为 `显式参数 > 环境变量 > --project-dir/tools > cwd/tools > findProjectRoot/tools > where`；findProjectRoot 行为统一（__dirname 找 SKILL.md 5 层 + cwd 找 10 层 + return cwd）。
- 验证：临时目录模拟安装环境（假 SKILL.md + 无 tools/），check_external_tools 与 capture 不传 --project-dir 均检测失败（复现实战），传 --project-dir 均检出 RuyiTrace-2.5.5；三脚本开发仓库无回归。

---

## 2.3.14 - 2026-08-12

### 修复
- **安装模式下 `check_external_tools.js` 检测不到 RuyiTrace（2.3.8 修复盲区）**：实战 AI 按 GATE-2 命令模板 `cd skill安装目录 && node scripts/check_external_tools.js` 运行，`process.cwd()`=skill 安装目录（无 tools/，gitignore 不随分发）；`normalizeTraceHome` 两个候选 `cwd/tools` 与 `findProjectRoot()/tools` 撞车——skill 安装目录有 SKILL.md 导致 `findProjectRoot()` 第一段 `__dirname` 命中并 return，两个候选都指向 skill 安装目录下不存在的 `tools/`，RuyiTrace 无兜底直接失败（4/5）。2.3.8 的"cwd 优先"假设 cwd=用户工程目录（tools/ 所在），但 AI 实际 cd 到 skill 安装目录，假设不成立。修复：`check_external_tools.js` 新增 `--project-dir` 参数，`normalizeTraceHome` / `getDefaultRuyiBrowsersDirs` 候选最前插 `--project-dir/tools`；`check_session_resume.js` 把已算出的 `projectRootOfCase` 作为 `--project-dir` 透传给子进程（与 spawn cwd 双保险）；SKILL.md GATE-2 两处命令模板加 `--project-dir <project-root>`。候选顺序统一为 `--project-dir/tools → cwd/tools → findProjectRoot()/tools → 环境变量 → where`，符合"先用户工程目录 → 再 skill 安装路径"。
- **测试盲区复盘**：2.3.8 / 683cb83 测试通过是因为用"cwd=有 tools/ 的目录"或开发版脚本（`findProjectRoot()` 靠 `__dirname` 永远指向开发仓库，有 tools/），未覆盖"安装版脚本 + AI cd 到 skill 安装目录"这条实战路径。本次用临时目录模拟安装环境（假 SKILL.md + 无 tools/）验证：不传参 RuyiTrace 未检测到（复现实战），传 `--project-dir` 检出。后续环境检测类改动须用"安装版脚本 + AI 真实 cd"组合测试。

---

## 2.3.13 - 2026-08-12

### 修复
- **TRACE_CAPTURE 质量不足不会触发重试（状态机盲区）**：状态机 `TRACE_CAPTURE → CASE_LOOKUP` 原为无条件推进，AI 看到「生成了 NDJSON」就推进，没有质量门槛。实测案例只采到 1 条无栈事件（Step 2 偏弱），AI 直接转静态还原，未触发重试。根因：`import_ruyitrace_log.js` 已输出质量信号（如「未发现 stack.file」），但 SKILL.md 状态机和 references 没规则接住；trace-flow.md 现有 3 条质量规则散落且触发条件互不重叠，有盲区（「生成了但无栈/事件极少」无人覆盖）。修复：状态机 `TRACE_CAPTURE` 节点内补 `TRACE_RETRY` 分支（不新增编号，避免 GATE/TODO 编号回归）；SKILL.md 4.3 节补「质量判定标准」+「TRACE_RETRY 处理顺序」5 步降级；`references/workflow/trace-flow.md` 补「Trace 质量判定与重试」统一节，合并现有 3 条散落规则，消除盲区。阈值用建议值让 AI 自主判断（符合 EXTERNAL_LOOKUP 设计原则），但「无 stack.file」是硬性重度不足信号不得放宽。

---

## 2.3.12 - 2026-08-12

### 修复
- **GATE-0 措辞歧义（可能误导 AI 跳过 GATE-1 意图声明）**：GATE-0 resume 路径原写"直接进 GATE-3"，字面上易被理解为 GATE-0→GATE-3（跳过 GATE-1 意图声明）。虽然第47行澄清了"不跳过 GATE-1"，但 AI 可能只读 GATE-0 那行就行动。改为「跳过 GATE-2 完整环境自检，读最新阶段报告续接（GATE-1 意图声明仍需完成）」，消除"直接进 GATE-3"的误导。

---

## 2.3.11 - 2026-08-12

### 修复
- **门禁 GATE 编号顺序与状态机矛盾（2.3.7 设计 bug）**：2.3.7 恢复硬门禁时 GATE 编号顺序为 GATE-0 续接→GATE-1 环境→GATE-2 证据→GATE-3 意图，与第4节状态机 `INTENT_CONFIRM(意图)→ENV_READY(环境)→EVIDENCE_GATE(证据)` 顺序相反。AI 加载 skill 后两套顺序打架，建 TODO 时出现错位（如 `INTENT→EVIDENCE→取证→ENV_READY`），且 ENV_READY 被勾但前序项未勾。重排 GATE 编号与状态机统一：GATE-0 续接（前置判定）/GATE-1 意图/GATE-2 环境/GATE-3 证据。同步改第47行续接说明、第65行绝对规则3 的 GATE 引用。
- 全仓 grep 确认 GATE 编号仅出现在 SKILL.md（脚本/references/cases 均无引用），改动自包含，无外部影响。

### 背景
用户反馈 AI 建的待办清单顺序混乱（前面项没执行直接跳环境检测）。根因是门禁编号顺序与状态机流程顺序相反，AI 两套都读导致混乱。本次按「编号、顺序、状态机三者统一」原则重排，彻底消除矛盾。与 2.3.10 的 TODO 指令改具体可执行互补（2.3.10 改 TODO 呈现，2.3.11 改 GATE 编号顺序）。

---

## 2.3.10 - 2026-08-12

### 修复
- **check_session_resume.js 内 RuyiTrace 路径检测为空（安装模式回归）**：`runCheckExternalTools()` 在 spawn `check_external_tools.js` 时强制 `cwd: projectRoot`（即 skill 安装根）。而 `check_external_tools.js` 的 `normalizeTraceHome()` 优先扫 `process.cwd()/tools`——安装模式下 tools/ 在用户工程目录（gitignore 不随 skill 分发），skill 根没有 tools/，于是找不到 RuyiTrace；但你单独跑 `check_external_tools.js`（cwd=用户工程目录）能找到。这把 2.3.8 的 `cwd/tools` 优先修复给抵消了。修复：spawn 的 `cwd` 改为「--case-dir 解析出的用户工程根」（tools/ 实际所在处），并透传 `--ruyitrace-home/--ruyitrace-exe`。

### 优化
- **执行主线 TODO 指令改具体可执行**：原指令是弱 blockquote + 一整条箭头字符串（无离散可勾项、无明确建清单/勾选触发）。改为「激活即建 + 10 个离散项（1:1 对应状态机节点）+ 明确勾选规则（进入即勾、分支回退重置、续接跳过 ENV_READY 直接勾第 2 项）」，解决 AI 加载 skill 后不及时建清单、不逐步勾选的问题。内容更具体，不改变状态机/门禁/节号结构。

---

## 2.3.9 - 2026-08-12

### 修复
- **references 过时「红线 N」编号引用（2.2.0 重构遗留）**：2.2.0 把「五条红线」改为「第3节纯协议红线」（无编号 bullet）后，references 仍有两处引用旧编号，2.3.5 全量同步旧概念时漏网。修复：`references/tooling/browser-acquisition.md:32`「红线 3 取证禁用清单」→「第3节纯协议红线与第4.3节 FORENSIC_CAPTURE」；`references/captcha/captcha-overview.md:29`「红线 4」→「第3节纯协议红线」。`cases/` 历史资产按规则不改（且自带完整说明）。

### 背景
门禁与红线审计发现：门禁（GATE-0~3）与红线主体完整、无缺漏，约束力已恢复到重构前水平且更精确；唯一问题是 2.2.0 重构后「红线 N」编号引用未全量同步（属杂乱非缺漏）。本次按 working memory「重构后 references 同步原则」全仓 grep 修复，符合「不能只改触发问题的那一个」原则。

---

## 2.3.8 - 2026-08-12

### 修复
- **安装模式下工具检测失效（findProjectRoot fallback 死代码）**：`findProjectRoot()` 第一段用 `__dirname` 向上找 SKILL.md，skill 安装目录里必然有 SKILL.md → 第一段必然 return，第二段 cwd fallback 永远走不到。后果：用户在独立文件夹（非 skill 项目根）建 `tools/` 装工具，跑安装版 skill 的脚本检测不到——项目根永远是 skill 安装目录，不是 cwd。安装版 skill 目录又没有 `tools/`（gitignore 不随安装分发），所以 `scannedInstallDirs` 指向不存在的路径。
- **工具定位优先 cwd/tools/**：`check_external_tools.js` 的 `getDefaultRuyiBrowsersDirs()` 和 `normalizeTraceHome()`、`capture_ruyitrace_log.js` 的 `normalizeTraceHome()`，候选路径列表在 `findProjectRoot()/tools/` 之前插入 `cwd/tools/`。开发模式下 cwd = skill 项目根，两者相同（`unique()` 去重）；安装模式下 cwd = 用户工作目录，优先扫到。
- **install_all.js 默认安装目录改 cwd**：`PROJECT_ROOT` 从 `findProjectRoot()` 改为 `process.cwd()`，默认装到 `cwd/tools/`。删除不再使用的 `findProjectRoot()` 函数。安装模式下不再污染 skill 安装目录。

### 优化
- **新增执行主线 TODO 指令（SKILL.md 第4节状态机图后）**：激活 skill 后把状态机主干建成可勾选 TODO 暴露给用户，每完成一项勾一项；明确分支判定以状态机为准、分支跳出=重做对应项不新建子项。解决 AI 加载 skill 后不主动建可见清单、用户看着没章法的问题。仅 +1 段引用，不碰状态机/门禁/节结构。
- **补 bump SKILL.md version 2.3.7→2.3.8**：d1110bf 提交了 2.3.8 的 CHANGELOG 与脚本改动，但漏 bump front-matter version 字段，本次一并补齐。

### 背景
用户反馈"在独立文件夹的 tools 路径安装了工具，在那个文件夹跑检测不到"。根因是 `findProjectRoot()` 的设计假设「脚本和 tools/ 在同一个项目根下」，安装模式下这个假设破了——skill 安装目录有 SKILL.md 但无 tools/，用户工作目录有 tools/ 但无 SKILL.md。本次改动把"找 tools/"和"找 SKILL.md"解耦：工具定位优先 cwd，`findProjectRoot()` 语义不变（继续用于读模板/references/case 结构）。

---

## 2.3.7 - 2026-08-11

### 修复
- **恢复分析前硬门禁锚点（约束流程回归）**：2.2.0 重构把强约束锚点（硬约束 Checklist / 五条红线 / 会话续接判定 / CHECK-0~3 / 不可跳过 / 任一违反即失败）从 38 处清零到 0 处，SKILL.md 从 758 行精简到 293 行。门禁脚本本身有 `process.exit(1)` 拦截力，但 SKILL.md 文本没接住这个信号，导致 AI 加载 skill 后没有任何结构阻止它直接拿参数名开猜（如 aq99 项目"凭空分析"）。新增 `## 0. ⚠️ 分析前硬门禁（不可跳过）` 作为最高优先级锚点，GATE-0~GATE-3 四步全部复用现有脚本（check_session_resume / check_external_tools / precheck_runtime / check_evidence），写明"未过门禁就分析参数/猜算法/写代码 = 违反绝对规则 3，视为任务失败"。
- **绝对规则 3 补 hard-stop 后果**：把"不得先凭参数名称猜算法"与门禁失败直接挂钩，补"未过 GATE-2 就分析 = 违反本条，视为任务失败"。
- **4.2 EVIDENCE_GATE 补阻断指令**：补一句"check_evidence.js 退出码非 0 或输出含「缺失证据」「不可跳过」时必须停在 EVIDENCE_GATE，禁止进入 IDENTIFY/TRACE_ANALYZE/IMPLEMENT"，接住脚本的 exit(1) 信号。

### 背景
用户反馈"现在的 skill 约束流程非常弱，重构之前基本都能按流程一步一步推进，现在完全不按 skill 走"。复核 git 历史确认 2.2.0 重构是分水岭，之后 2.3.0→2.3.6 全是"恢复/补齐重构误删的约束"。本次按"最小改动、复用现有脚本"原则恢复阻断力，不恢复 758 行旧结构。

---

## 2.3.6 - 2026-08-11

### 优化
- **术语统一**：路径 D 名称「环境复现」（SKILL.md:240、common-pitfalls.md:155）改为「环境伪装」，与 cases/index.json 机器检索字段及 references 全仓 40+ 处一致。保留「最小环境复现」固定搭配（泛指复现环境的动作，非路径 D 名称）。
- **路径矩阵去冗余**：phase-flow.md 4.2 解法模式表与 decision-tree.md 模式选择矩阵近乎逐字重复，改为交叉引用 decision-tree.md，减少维护负担。
- **反爬识别加交叉引用**：phase-flow.md 1.2、intake-template.md 反爬类型识别简表末尾补「详细识别标准见 decision-tree.md」，避免三处简表各自演进漂移。
- **截断保护加同步提示**：trace-flow.md 与 ruyi-tooling.md 的「RuyiTrace 长字段截断保护」段近乎逐字重复，仿 native-protect.js 双副本模式各加同步提示，提醒修改任一处需同步另一处。

---

## 2.3.5 - 2026-08-11

### 修复
- **B 组脚本 --case-dir 参数错误（8 处）**：2.2.1 统一 A/B 组脚本语义时只改了触发问题的 trace-flow.md，同类错误在 7 个文件 8 处遗留。check_evidence.js（5 处）和 import_ruyitrace_log.js（3 处）的 `--case-dir` 应传 `<project-root>`，原文误填 `<case>`/`case` 会被解析成 `case/case/...` 路径错误。涉及 phase-flow.md、decision-tree.md、intake-template.md、browser-acquisition.md、env-debug-loop.md、ruyi-tooling.md。
- **旧授权阻断项残留（2 处）**：2.2.3 清理"未确认授权"阻断项时只清了 phase-flow.md，intake-template.md:113 和 decision-tree.md:25 两处残留，与第 1 节「默认已授权」冲突。改为「需要登录态：暂停要求用户手动登录或补充请求包」，去掉"授权"措辞。
- **validation.md 取证模式必填（3 处）**：测试 1/2/4 把"取证模式"列为用户必填字段，与状态机 EVIDENCE_GATE 自动判定冲突（且与同文件测试 7 矛盾）。去掉"取证模式"必填要求。
- **decision-tree 阻塞点 #1 旧模型残留**：阻塞点 #1「未确认取证模式」与状态机不符（INTENT_CONFIRM 不含取证模式选择，由 EVIDENCE_GATE 自动判定）。改为「未确认目标范围」。
- **phase-flow 状态机链不全**：2.3.4 只改了版本号写死，未补全跳过的 6 个分支状态（FORENSIC_CAPTURE、TRACE_CAPTURE、STEP2_ONLY、EXTERNAL_LOOKUP、DIAGNOSE、SIGN_ONLY_DELIVER）。改为提"含分支状态"的表述，不重复 SKILL.md 完整状态机图。

### 待后续处理（P2）
- 术语「环境伪装」vs「环境复现」分裂：涉及 cases/index.json 机器检索字段，全量替换风险高，需单独评估。
- 3 处内容冗余重复（截断保护/反爬识别/路径矩阵）：需合并大段内容，可能丢失细节，需谨慎设计。

---

## 2.3.4 - 2026-08-11

### 修复
- **phase-flow.md 版本号写死漏网**：2.3.3 修复 experience-rules.md 两处写死「SKILL.md 2.2.2」时，漏掉 `references/workflow/phase-flow.md:5` 的「SKILL.md 4.0」。改为「SKILL.md 状态机」与 experience-rules.md 一致，落实「references 文件不写死版本号」原则。
- **第12节路由表漏指向**：2.3.2 修 experience-rules.md 漏指向时确立「references/ 下文件必须在第12节路由表有对应指向」原则，但仍有 19 个有实质内容且有明确触发条件的文件未指向（env/5、quality/8、network/4、hooks/2、workflow/3、tooling/1）。补齐后路由表覆盖全部 66 个 references 文件，AI 不再因「文件在但路由表没指」而漏读。captcha/ 下 12 个细分文件维持间接覆盖（"再按厂商、题型、轨迹或验证失败路由到具体文档"）。

---

## 2.3.3 - 2026-08-11

### 修复
- **经验法则版本号过时**：`references/workflow/experience-rules.md` 两处写死「SKILL.md 2.2.2 状态机」，版本已升至 2.3.x。改为不写死版本号，引用「SKILL.md 状态机」，避免后续版本升级时再次过时。生产级门禁模板（`final-summary.md`）与检查脚本口径一致，无需优化。

---

## 2.3.2 - 2026-08-11

### 修复
- **经验法则路由丢失**：`references/workflow/experience-rules.md` 文件一直在，但 2.2.0 重构后第 12 节路由表未指向它，AI 不知道有此文件可读。第 12 节「任务分流、阶段安排、常见坑」行追加 `experience-rules.md`。
- **生产级交付门禁说明丢失**：`check_final_artifact.js --production` 模式一直在（校验 9 个生产级附加章节），但 2.2.0 重构后第 11 节未说明此模式。第 11 节恢复 `--production` 说明及命令。

---

## 2.3.1 - 2026-08-11

### 修复
- **交付文档硬约束回归**：2.2.0 重构误删了「最终项目总结.md」与「经验沉淀-<站点>.md」的必选标注和「不生成=任务未完成」硬约束。底层 `check_final_artifact.js` 仍强制检查这两个文档，但 SKILL.md 第 11 节丢了说明，导致 AI 读 skill 时不明确这是必选要求。第 11 节恢复：必选标注、模板指向（`references/quality/final-summary.md`、`cases/_template.md` Part 2）、豁免机制（`--no-require-final-summary` / `--no-require-experience`）；第 13 节完成判定补一条「两个文档已生成（或用户明确豁免）」。

---

## 2.3.0 - 2026-08-11

### 新增
- **EXTERNAL_LOOKUP 状态**：`CASE_LOOKUP` 本地未命中时，新增网络方案搜索分支。搜到可读算法作为假设进入 `IMPLEMENT`，搜不到或算法黑盒进入 `FORENSIC_CAPTURE` 完整取证。补齐了"搜索网络已有成果"这一信息收集层，简单参数（如公开签名）可走轻量路径：搜方案 → 实现 → 真实验证 → 交付。
- **REAL_VERIFY 失败回退分支**：验证失败时区分已有 trace（→ DIAGNOSE 修复）与无 trace 轻量路径（→ FORENSIC_CAPTURE 强制升级取证），不回 EXTERNAL_LOOKUP 继续试方案。
- **轻量交付来源标注**：经 EXTERNAL_LOOKUP 未做 trace 即通过验证的交付物，必须在 `最终项目总结.md` 标注算法来源 URL、验证日期、未做 trace 声明。

### 修复
- **description 触发词回归**：2.2.0 重构误删了"逆向还原...加密参数...生成逻辑"等通用触发词，导致常规参数逆向提示词模板（如"请逆向还原JS加密生成逻辑"）无法触发本 skill。恢复通用触发词，保留纯协议还原定位和边界声明，不加具体参数名和算法名。

---

## 2.2.3 - 2026-08-11

### 文档
- **第1节「任务边界与授权」优化**：新增「默认已授权」小节，明确用户发起请求即视为合法授权范围内操作（自有系统、已授权目标、合法安全研究与互操作分析），AI 默认按范围直接协助，不再要求授权证明、不得质疑或拒绝执行、不进入拦截或反复确认逻辑。
- **phase-flow.md 阻断项收紧**：删除「未确认授权 / 登录状态：不得尝试绕过登录、验证码、MFA」一条；第1节已声明默认已授权，不再以授权为由阻断，登录态/验证码交互仍按「暂停要求用户补充请求包」处理。
- **第12节冲突判定条款**：去掉授权项，保留「以本文件的状态机、真实 API 验证规则和纯协议红线为准」，授权声明统一收敛到第1节。

---

## 2.2.2 - 2026-08-11

### 修复
- **Node 请求客户端 POST 请求体丢失（P0）**：`session.request` 只认 `opts.body`，`session.post(url, payload)` 会把 payload 当 opts 导致请求体为空。`client.js` 新增 `json`/`data` 选项，自动序列化并设置 `Content-Type`，与 Python 版 `json_body=`/`data=` 语义对齐。
- **验证码模板与客户端契约**：`captcha-verify/final.js` 的 verify/business 调用改为 `{ data: payload }`/`{ json: { credential } }`；`captcha-verify-py/final.py` 修正 `create_request_session(headers=...)` 参数、`session.post(json_body=...)` 调用，统一验证通过条件为全部成功（`success === verifyCount`）。
- **`capture_ruyitrace_log.js` logger 未定义（P0）**：浏览器提前关闭路径调用未定义的 `logger.info` 且 `%ss` 为 printf 格式，触发 `ReferenceError`。改为 `console.log` + 模板字符串。
- **Node 验证码模板 session 泄漏**：`captcha-verify/final.js` 的 `runOnce` 与 `sign-only` 模式补 `try/finally session.close()`，与 Python 版对齐。
- **`captcha-verify-py/final.py` `load_config` 默认值合并**：config.json 缺失时 `main()` 访问 `config['captcha']['provider']` 抛 `KeyError`，新增 defaults 深层合并，与 Node 版 `Object.assign` 对齐。
- **AST 流水线/安装脚本退出码**：`assets/ast-patterns/scripts/run-pipeline.js` 步骤失败、`scripts/install_ruyipage_runtime.js` 安装失败时设置 `process.exitCode = 1`，不再静默成功。
- **Windows 采集进程清理边界**：`capture_ruyitrace_log.js` 的 `killProcessTree` 中 taskkill/PowerShell 调用加 15s 超时包装，防止子进程挂起；CLI 参数补齐 `help: false` 默认值。

### 验证
- `node --check` 全部脚本通过。
- `check_evidence.js --self-test` 22 项断言通过。

---

## 2.2.1 - 2026-08-10

### 修复
- **`--case-dir` 语义分裂根治**：A 组脚本（`check_session_resume`/`check_fingerprint_fixture`/`check_trace_api_coverage`）入口加 `resolveCaseDir` 归一化，兼容"项目根"与"case 目录"两种输入，统一返回 case 目录；内部路径逻辑不变，向后兼容旧调用。
- **`check_fingerprint_fixture.js` defaultEnvFiles 路径**：`caseDir/result` 在 case 目录语义下指向 `case/result`（不存在），改为 `caseDir/../result` 指向项目根 `result/`，避免 env 代码检查被静默跳过。
- **`check_code_quality.js` 默认值**：`--case-dir` 无参回退由 `'.'` 改为 `'.'`，与"项目根"约定和 `check_final_artifact.js` 一致（原默认会算成 `case/result` 找不到文件）。
- **`trace-flow.md` 错误命令**：`import_ruyitrace_log.js`（122/154 行）、`check_evidence.js`（212 行）属 B 组脚本，`--case-dir` 应指项目根，原文误填 `case`/`<case>` 会被解析成 `case/case/...`，已改为 `<project-root>`。
- **`scripts/README.md` import 示例**：`import_ruyitrace_log.js` 典型用法由 `--case-dir case` 改为 `--case-dir <project-root>`（B 组脚本）。
- **A 组脚本 result 路径 bug**（审计发现）：`run_trace_runtime_audit`/`check_env_realism`/`check_environment_closure`/`check_object_shape_audit`/`check_dynamic_resources`/`check_xhr_fetch_session_bridge` 在 case 目录语义下用 `caseDir/result`（case 目录下无 result），改为 `caseDir/../result` 指向项目根 `result/`，避免最终代码检查被静默跳过。其中 4 个默认值 `'.'` 改为 `'case'`（与 `check_dynamic_resources`/`check_stage_reports`/`check_change_memory` 一致，A 组期望 case 目录）。
- **A 组脚本剩余 5 个默认值统一**：`check_xhr_fetch_semantics`/`build_trace_runtime_contract`/`check_trace_runtime_conformance`/`check_webapi_env_detection_matrix` 无参回退由 `'.'`/`process.cwd()` 改为 `'case'`；`analyze_trace_complexity` 的 `root` 与 `discoverTraceFiles` 入口一并默认 `'case'`（去掉 `if (args.caseDir)` 守卫，无参也能从 `case/` 自动发现 Trace）。与 A 组约定一致，无参运行不再找不到 `notes`/`fixtures`/`tmp`。

### 文档
- 统一所有 A 组 3 脚本调用点为 `--case-dir <project-root>`（SKILL.md、phase-flow、trace-flow、ruyi-tooling、trace-api-coverage、delivery-templates、code-style、cleanup、fingerprint-value-replay、env-native-protection、scripts/README、README）。
- SKILL.md 4.1 段补 `--case-dir` 约定说明；scripts/README 说明 3 脚本已归一化。
- `cases/index.json` 为方法论骨架模板（`universal-vmp-source-instrumentation`、`vm-sandbox-custom-algo`）加 `"kind": "template"` 标记，`cases/README` 补标记要求说明。
- `search_cases.js` 默认从结果排除 `kind:template` 模板，新增 `--include-templates` 开关显式包含；`cases/README` 同步说明。
- `native-protect.js` 双副本（`assets/env-patch-snippets/` 与 `templates/vm-sandbox/`）文件头加同步提示注释，提醒修改任一处需同步另一处。

### 验证
- `node --check` 全部脚本通过。
- 归一化功能性验证：传项目根与传 case 目录两种输入归一化到同一 case 目录（PASS）。

---

更早版本历史见 `git log`。
