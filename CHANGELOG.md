# CHANGELOG


> 历史版本（2.3.87 及更早）已归档至 CHANGELOG.archive.md。

## 2.3.141 - 2026-09-25

### §4 节点级细则整体外迁 references（常驻体积 35000 → 32639 字符）

**SKILL.md §4 外迁（正文只留节标题 + 触发条件 + 指针 + 关键判据句）**
- §4.2：网络取证/日志采集命令段的重复细则删（trace-flow.md 已有）；速通路径两形态判据迁 trace-flow.md 新增「速通路径判定」节；质量判定与出口门禁段压为指针行（核心判据由 state_machine `[RULE]` 换节点投递 + trace-flow 承接）
- 阶段动作边界与外部检索时序、§4.4 防耗尽检查点：细则迁 phase-flow.md 新增两节（横切规则），正文留判据行
- §4.4 例外四个：判据明细迁 decision-tree.md 新增「取证例外通道」节；SKILL.md 保留编号目录（check_skill_consistency 的 extractExceptions 解析依赖，删则全库「例外 N」引用批量死链）
- §4.3 EXTERNAL_LOOKUP 豁免、§4.4 准入三件套/IMPLEMENT 前置：压缩保留判据句（含 RB 锚点句）

**references 承接（搬迁保措辞 → RB 锚点自动承接，41/41 通过）**
- `trace-flow.md`：新增「速通路径判定」节；出口门禁「不得写成"没有 trace"」措辞对齐；质量判定补「禁止跳过重采直接转静态分析」；多进程合并补「合并所有 tab/content 进程文件」；信号规则补「纯网络接口 URL 不在 trace 中属预期」条与「裸 `createElement`」措辞；自动 trace 执行要求补「已触发」确认纪律；取证细则补 Windows `PYTHONUTF8` 兜底
- `env-debug-loop.md`：进入条件补两文件内容要求、「两文件缺一不得开始补环境」与「禁止先根据 Node.js 报错盲补」原串
- `phase-flow.md`：新增「阶段动作边界与外部检索时序」「上下文防耗尽检查点」两节
- `decision-tree.md`：新增「取证例外通道（SKILL.md §4.4 例外四个细则）」节

**验证**：check_skill_consistency 0 问题（147 引用）；check_routing_benchmarks 41/41 通过；state_machine --self-test PASS；RB-034 锚点「按来源摘要命名」在首轮验证中丢失去向已修复（回归守卫生效）

## 2.3.140 - 2026-09-21

### P0 事实错误修正 + P1 工具门禁缺陷修复 + check_skill_consistency 扫描范围扩展

**P0 文档事实修正（批次 A）**
- `references/workflow/experience-rules.md`：规则 54（crypto-js 双 `decrypt` 语义）判据改为「按调用点第二实参类型定密钥语义，静态看不出处分不出」；规则 55（时间派生 key·iv）判据修正；规则 53 已并入 56、原编号进指针表（防旧编号引用变死链）；「信封型」用例数统一为 7 个（补「时间戳超前」）
- `references/crypto/crypto-entry.md`：crypto-js 双 `decrypt` 判据补「调用点第二实参类型」
- `references/env/env-debug-loop.md`：`run_with_trace.js` 默认注入 `globalThis.window = globalThis` 的事实修正 + R2 红线对齐（禁止手写 vm runner）
- `references/tooling/ruyitrace-cheatsheet.md`：SHA-1 常数表结论修正（重新计算并校验）
- `references/network/ip-risk-control.md`：旧「IIFE 会静默不执行」措辞修正为 ruyipage 1.2.62 + FF155 恒抛 privileged scope（两种形态都抛）+ `_apply_ruyipage_preload_script_compat_patch()` / `--preload-script` 注入（规则 44）
- `SKILL.md`：例外 5→4（§4.4 仅四个例外）、形态编号统一（第八形态→第七形态）、p18/p19 案例补段与悬空行清理
- `cases/index.json`：重写为 2 空格缩进；p17 编号修正
- 删除冗余临时文件 `cases/index.json.bak1sp`、`tmp_ap.txt`

**P1 工具脚本修复（批次 B）**
- `scripts/compare_fixture.js`：`--sample` 非法值（page 不匹配且非合法下标）退出码 1（区别于实现偏差退 2）；catch 错误消息改走 stdout 便于门禁断言
- `scripts/search_cases.js`：`zeroHitDiagnosis` 按 flag 限定统计字段（domains→domains 列，signals→signals 列，防止「域名词在 signals 里偶合命中」制造假阴性）；`--json` 零命中时诊断写 stderr、stdout 保持纯 JSON
- `scripts/write_markdown_utf8.js`：`--project-dir` 必须 existsSync + isDirectory 校验；输出补「项目根目录（解析后）」行
- `scripts/state_machine.js`：`--exempt` 登记逻辑重写——edges=非法边需 gate、docEdges=文档授权合法边可登记留痕；依据路径含 `.md/.json/.jsonl` 时 existsSync 校验（相对 caseDir 解析）；无效豁免不阻断合法转换但追加 `exemptWarn` 提示；self-test 扩 docEdges 校验与登记断言
- `scripts/analyze_cookie_attribution.js`：删除死代码 `isCookieWriteApi`；self-test 硬编码计数改为 `assert` 辅助函数动态计数
- 新增 RB-043~RB-046：`--sample` 未命中退 1 / `--json` 零命中 stdout 纯净 / `--exempt` 登记留痕 / `zeroHitDiagnosis` 限定字段回归

**P1 门禁扩展（批次 C）**
- `scripts/check_skill_consistency.js`：
  - 扫描范围从「仅 SKILL.md」扩到 SKILL.md + `references/**/*.md` + `cases/*.md` 全语料（fence 内代码不参与抽取）
  - 新增「例外 N」编号校验（目标为 SKILL.md §4.4 已声明的例外编号）
  - 新增「反模式 N 第 M 形态」越界校验（形态数不超过该反模式段落声明的形态总数；中文数字/阿拉伯数字兼容）
  - 新增指针表并入目标死链校验（目标必须是实条，不能指向另一个指针或空编号）
  - 新增 `references/**/*.md` + `cases/*.md` 内引用路径存在性校验
  - 体积预算新增 `< 500` 字告警（疑似正文被误删）
  - `collectRefs` 前缀边界修正，排除 `src/renderer/assets/…` 等外部工具源码路径被误抽
  - `countCaseFiles` 口径对齐 README「N 个实证案例 + M 个模板」：`index.json` 中 `kind:template` 的不计入实证案例
  - 编号引用正则排除 `100%` 等自然语言数字误报
  - 修复案例 `cases/jsvmp-vm-blackbox-acs-token-baidu-finance.md` 中 `cases/gitee nox/tox` 假引用为真实文件路径
  - self-test 扩：越界形态 / 死反模式 / 死规则 / 死例外 / 指针死链 / 树内缺失路径 / 低预算告警 全部断言
- 新增 RB-047：`check_skill_consistency.js --self-test` 断言全量新检查生效
- `scripts/README.md`：同步 check_skill_consistency 检查范围描述

## 2.3.139 - 2026-09-20

### 码上爬题18（Header `m` 指纹信封）经验吸纳：cookie 归因读写混判修复 + trace 信号第④类 + 信封型签名形态入库

- 新增案例 `cases/header-m-fingerprint-envelope-tail-ts-mashangpa-p18.md` 并注册 index.json（第 63 例）：
  `m = anti(4)({serverTime:ts}).messagePack() + base64("luoge"+ts)`，`anti` 是站方 bundle 把
  `__webpack_require__` 改名的全局别名（`n.p = "", anti = n`），交付 = B 最小 vm 沙箱黑盒执行站方
  `actoken.js` 原样副本（sha256 漂移自检）+ `node:https` keepAlive，20 页全量求和同轮提交
  `status:success`（答案 103848），复验轮 total 变化实证数据按运行轮换
- **修复 `analyze_cookie_attribution.js` 读/写混判（实测假阳性，三类污染源）**：归因原按「事件是否含 cookie 字样」
  计数，把 **JS 读整串 cookie**（`Document.get cookie`、`cookieReads.jar`）、**浏览器内核与 HTTP 层记录**
  （`cookieSendDecisions` / `CookieService.GetCookiesForURI` / `source=http|storage|native` / `process_type=parent`）、
  以及 **`cookieWrites` 记录里的写入后快照 `jar`** 全算成 JS 写入。后果不是漏判而是**错判方向**：
  本题 `sessionid`（HttpOnly，JS 根本写不了）被判 `both`、`taarId` 被判 `js`，
  两者的"下一步"都指向按写入点还原算法 = 纯浪费一轮。现：`source` 白名单只放 `document.cookie`/`cookieStore`，
  非页面接口（CookieService/CookieStorage/nsICookie）整条排除，写入只从 `raw`/`rawHead`/`args`/`value` 取名，
  读取降级为辅助计数并新增 `unknown` 态（旧版无该态，任何未匹配形态都保守落 `js`）。
  自测 6→16 项断言（三代记录形态全覆盖）；回归：本题 `sessionid`→server、`_nano_fp`→js，
  题15 `v`→js / `checkcookie`→js / `sessionid`→server 全部与已交付结论一致
- **trace 信号「必然不命中」补第④类：站方自定义函数/方法名**。`check_trace_gate.js --require-trace-signal messagePack`
  实测 0 命中并被误路由到 TRACE_RETRY（本次真实损失一轮门禁）——根因是 RuyiTrace 的 `interface`/`member`
  只会是浏览器内建 API，用户函数名不作为任何字段出现。SKILL.md §4.2 由"三类"改"四类"并给出正确取法
  （该函数最终写进浏览器 API 的字面量），`references/workflow/trace-flow.md`「trace 信号的记录形态与匹配规则」
  补根因段并点明与 `MOZ_DOM_JSCALL_DETAIL_FUNCS`（那条通道恰恰按 JS 函数名过滤）的区分；
  `check_trace_gate.js` 在「Step 2 已具备但信号选错」时直接打印当前信号与自查提示
  （原提示只出现在 `missing` 为空的分支，实测本题走的是 `missing` 非空分支，等于没提示），
  并把 `requireTraceSignal` 挂进渲染用的 result（`checkEvidence` 返回体不带该字段）；gate 自测 5 项回归通过
- `references/crypto/crypto-entry.md`「常见案例模式」新增**「信封型：不透明体 + 明文可复算尾段（跨载体通用）」**：
  规则 32 第 4 条只给了抽象的"打边界再定深度"，缺可操作的入手点。补齐三条——
  ①先切段：**服务端只能复算请求里已有的信息，故尾段明文（盐/ts/回显字段）才是校验点**，不透明段含
  `Math.random`/`getRandomValues` 时不可能按字节校验；②取证捷径：这类尾段几乎都经 `btoa`/`atob` 落地，
  RuyiTrace `Window.btoa` 记录的 `args` 就是未编码明文，一次命中即钉死 source↔writer 配对，不必先反混淆；
  ③两个易错点：伴生头可完全不校验（`timestamp` 改 1h 前仍过 ∧ 尾段内嵌 ts 挪 −30min 即拒 同时成立）、
  时间窗可能不对称（+10min 同样拒，排候选须同时测超前）。四案例交叉引用（题14/15/16/18，同形态不同算法族）
- `references/env/env-debug-loop.md`「`run_with_trace.js` 的两个静默致死形态」第 2 条补齐本题实证：
  症状是**入口函数同步返回空串**（`if (!ready) return "";` + `setTimeout(复位采集器, 0)`），零报错零耗时，
  与"被反调试检测走死循环"同表象，给出"手动补跑一次挂起回调看返回值是否变非空"的一秒判定动作；
  并写下泵的实现约束——**必须真实让出事件循环**，忙等自旋会把 `Date.now()`/`performance.now()` 差值塌成 0，
  而采集器普遍有 `Math.max/min` 节拍统计，后果是"签名产出了但内容退化"（比空串更难查）；
  `scripts/README.md` 的 `run_with_trace.js` 行同步标注该局限
- **正文预算实测**：SKILL.md 有 35000 字常驻注入预算（`check_skill_consistency.js` 裁定）。本次想在 §7
  「禁止手写 vm runner」加例外指针、在 §7 cookie 归因加读写纪律，均因预算不足被拒——在飞改动已把文件推到
  34997（HEAD 34833 + 在飞 164），任何净增都会红。处置：第 ④ 类信号在 §4.2 **以等量压缩换等量新增**
  （删掉与 trace-flow.md 重复的 `--trace-env`/`STACK_FULL` 括注与"与 evidence-signal 分离"，正好容纳 ④），
  其余两条全部下沉到 `references/`、`scripts/README.md` 与工具自身的 `--help`/失败输出——
  `check_trace_gate.js` 在犯错当场打印提示，比正文规则更可达。改后 `check_skill_consistency.js` 问题 0
- README 案例数 54→63（59 实证 + 4 模板，131-138 新增九例在本版统一刷新计数）；`check_skill_consistency.js` / `check_vendor_leakage.js` 复跑通过

## 2.3.138 - 2026-09-20

### 码上爬题19（响应体整包 Triple-DES + 日期型 IV）经验吸纳：新增规则 54/55 + crypto-js 库语义判定 + 检测链 tools/ 上溯修复

- 新增案例 `cases/response-carrier-tripledes-date-iv-mashangpa-p19.md` 并注册 index.json（第 62 例）：
  请求侧零加密参数（`GET /api/problem-detail/19/data/?page=N` 除 `page` 外全明文，`pagination19.js:4-8`
  URL 构造点参数集合字面量只有 page），难点全在响应侧 `{"r":base64 密文,"k":24 字符密钥}`；
  解密链明文可读（`19pro.js` = 未混淆 crypto-js 打包副本 + `DES3` 尾巴），交付 = **A 纯算路径**
  （Node 原生 `crypto` 的 `des-ede3-cbc` + PKCS7，该平台第二个完全零沙箱零补环境的 case，前例 p17），
  20 页全量求和同轮提交 `status:success`（答案 102679）；`k` 随响应下发（只读探针 3 次请求 3 个不同前缀）
- 新增**规则 54**：crypto-js 家族有两种 `decrypt` 语义（`enc.*.parse`/WordArray 直接密钥 vs
  字符串口令走 `cfg.kdf` 默认 EvpKDF-MD5 派生），按调用点第二实参类型定密钥语义、
  按密文头有无 `Salted__` 魔数定容器格式——**文件里 `MD5`/`EvpKDF` 命中可为零调用的打包死代码**
  （题19 `19pro.js` MD5 命中 4 次全为死定义；与 match22 的真派生型构成对偶）。误判时症状是
  "填充错误"而非明文异常，极易误读成密钥字节序问题并误升级成补环境
- 新增**规则 55**：时间/日期派生的 key·iv——站方 `DES3.iv()=formatDate(new Date(),'yyyyMMdd')` 取
  **浏览器本地日期**而加密发生在服务端（UTC+8），两者仅在客户端处于东八区时偶然一致。交付按
  「加密方时区 → 运行机本地 → 各 ±1 天」排候选 + PKCS7 与 `JSON.parse` 双校验 + 全候选失败硬抛
  （错误信息带候选值），8 字节 IV 任何情况下不得写成常量；验收动作 = 把系统时区改 UTC±0 重跑交付入口
- `references/crypto/crypto-entry.md` 响应方向四层链路补两节"怎么做"落点：
  **「库语义判定：同一算法的两条调用路径」**（三步静态判定 + 密钥随响应下发时的探针纪律）与
  **「时间派生的 key·iv：按加密方时区排候选」**（候选顺序/双校验/硬抛/`ivUsed` 落验证记录）
- **检测链 tools/ 上溯修复（题19 GATE-1 实测）**：`check_external_tools.js:810` 注释声称
  "`--project-dir` 被传成 case 目录时向上查找含 tools/ 的祖先"，实际只做 `normalizeProjectDir`
  纯 resolve ⇒ 传无 tools/ 的 case 目录时 ruyitrace/ruyitraceKernel 双双误报、快照被拒写，
  只能手工把 `--project-dir` 改指共享工程根。现真正接上 `paths.resolveProjectDirFromCaseDir`
  （本目录有 tools/ 时返回自身，无 tools/ 上溯，遇 SKILL.md 停止回退输入值），
  上溯发生时打印 `[提示]`；`check_session_resume.js --write-snapshot` 的 toolsBase 同口径修复。
  GATE-1 模板传 `<project-root>`（多 case 布局下无 tools/）从"必失败"变为两个调用形态全过（实测）
- `scripts/write_markdown_utf8.js` 新增 `--project-dir`：输出路径守卫原按 `findRepoRoot(process.cwd())`
  判定，与 SKILL.md §0.0"所有脚本必须在 skill 根目录执行"互斥——写交付文档必然报
  「输出路径越界」（题19 实测连续命中）。现支持显式项目根，报错文案给出可操作提示；
  实测：skill 根目录执行 + `--project-dir` 指向 case 项目 = 写入成功
- `scripts/compare_fixture.js` 支持 **`samples[]` 多样本 fixture**：原自动路径只认顶层
  `expected.<field>`，翻页/批量类案例（题17、题19）的 fixture 都用 `samples[]` 承载，
  首跑必判「失败/期望值未找到」，得手写 `--expected-path samples.0.expected.X`。
  现自动探测 `samples[].expected.<field>`，`--sample <page|下标>` 选样本；旧显式路径用法回归通过
- 修正 2.3.137 沿袭源文档的**码位区块名误差**（子代理按 p17 落盘 fixture 逐码位实测）：
  U+09A7 = 孟加拉文（Bengali）非"天城文"、U+0AA4–U+0AB8 = 古吉拉特文（Gujarati）非"古嘉摩基"、
  U+A66E = 西里尔文扩充-B；`pagination17.js` 实为 7 行（首行 3377B 打包行）非"单行"，
  `var version_` 在打包行内非文件尾。教训同反模式 11 第七形态：**同源文档互相印证仍会一起错，
  落盘样本是唯一仲裁**；cases/index.json p17 strategy 与 `font-anti-crawl.md` 同步修正，
  p17 条目 strategy 里并发编号调整期间残留的"规则 53"引用同步改为规则 56
- README 案例数维持（统一在 2.3.139 刷新）；`check_skill_consistency.js` 通过（问题 0）
- `check_vendor_leakage.js` 两处存量命中清零（`experience-rules.md:425` 规则 50 实证来源、
  `ruyitrace-cheatsheet.md:292` 题16 键位实例均出现上游厂商名）：改"上游电商 h5st 协议"通用表述 +
  cases 指针，协议细节归属案例文件（SKILL.md §3 知识分级）；改后该门禁通过

## 2.3.137 - 2026-09-20

### 码上爬题17（响应侧码位单表替换「伪字体」）经验吸纳：新增规则 56 + 反模式 41 + 状态机豁免登记通道

- 新增案例 `cases/unicode-codepoint-substitution-no-font-file-mashangpa-p17.md` 并注册 index.json（第 61 例）：
  请求侧**零加密参数**（`GET /api/problem-detail/17/data/?page=N` 除 `page` 外全明文），难点全在响应侧——
  `current_array` 是横跨天城文/古嘉摩基/西里尔补充块的**码位单表替换**串，还原表以明文字面量
  `FONT_DECRYPT_MAP` 挂在站方 `pagination17.js`（jsjiami v7 包装，但非 ASCII 键的对象常量未被字符串化）；
  **全站零字体资源**（14 包无 woff/ttf、无 `@font-face`），交付 = 运行时重拉脚本提表 + sha256 记录 +
  10 项双射校验 + 表外码位硬失败，零字体解析零补环境，20 页全量求和同窗提交 `status:success`（答案 100419）
- `references/rendering/font-anti-crawl.md` 补**形态三「伪字体（无字体文件）」**：§1 形态表加第三行、
  §2 加反向识别信号（零字体资源 + JS 明文映射常量 + 乱码不在 PUA 区）、§3 前置**「三问分诊」**
  （有字体资源吗 → 静态还是动态 → 站方 JS 有无明文表，命中即跳过整条 fontTools/brotli/字形指纹链）、
  §5 加两条坑（题型命名不作实现依据；伪字体的表同样不得硬编码，须运行时重拉 + 校验 + 硬失败）
- 新增**规则 56**：实时验证记录只允许在线路径写，离线/`--selftest` 分支一律落 `case/tmp/`——
  题17 实证 selftest 复用在线 `verification` 单例并 `writeVerification()`，把 23 条真实 attempts 清零，
  门禁只报「attempts 0 条」不给根因，最终只能重跑真实请求恢复（手工回填属伪造）。
  配套 `check_final_artifact.js`：attempts 不足且入口含 selftest 分支时直接提示该根因（`--self-test` 5 例仍通过）；SKILL.md 正文不改（预算已满），enforcement 落在门禁提示与规则 56
- 新增**反模式 41**：`search_cases.js` 多关键词是 AND（`queries.every(...)`），
  题17 用「字体 font unicode 字形」得到假 0 命中，差点判"本地无案例"而漏掉直系先例
  `cases/yuanrenxue-match7-dynamic-font.md`（同族内容还原型 + Step 2 豁免 + 开窗重置登录态坑）。
  配套 `search_cases.js` 零命中且有 ≥2 个检索词时输出 `[WARN]`：逐词单独命中数 + 按词序收敛过程，
  并区分「某词全库零命中」与「各词都有命中但交集为空」两种成因（SKILL.md 正文净零：预算已由并发会话占满，约束以脚本 WARN + 反模式 41 为 enforcement 点）
- **反模式 11 追加第七种形态**：题型命名（"字体加密"）与同平台历史载体被当作实现形态依据，
  正确做法第 11 条改为"命名只作检索关键词，先跑三问分诊"
- `scripts/state_machine.js` 新增**取证例外登记通道 `--exempt "<代码>:<判据与落盘材料路径>"`**：
  §4.4 例外 3（`step2-content-only`）与 §4.2 速通路径（`step2-fastlane`）承认跳过 TRACE_CAPTURE，
  但状态图没有对应边，导致合规豁免只能 `--set CASE_LOOKUP --force`，每次都在 `state.json.blocks`
  留一条 `illegal-transition-force`——把越权跳转和合规豁免混在同一审计里。
  现按 `EXEMPTIONS` 表登记进 `state.exemptions`（码不认识/边不匹配/缺依据一律拒绝，退出码 2），
  被拒文案追加本跳转可用码提示；`--force` 语义不变（SKILL.md 例外 3 段正文未改，指引由拒绝输出投递）。
  `--self-test` 追加 6 项断言（缺依据/未知码/边不匹配不得登记、合规登记必须通过、登记边不得已是合法后继、提示文案可用码）；  被拒时的 `exemptionsHint` 即用户可见指引，故不改 SKILL.md 正文（预算已满）
- 登记纪律：`cases/index.json` p17 条目 signals 写同义词族（字体加密/码位替换/单表替换/伪字体/无 @font-face…），
  降低检索侧假阴性；README 案例数维持（统一在 2.3.139 刷新）



## 2.3.136 - 2026-09-20

### 码上爬题16（京东 h5st RAC 移植版 Body 内签名）经验吸纳：新增规则 50/51/52 + storage 键位进度探针 + 自动化扫描范围收窄

- 新增案例 `cases/body-carrier-h5st-remote-algo-mashangpa-p16.md` 并注册 index.json（第 60 例）：
  签名载体 = **POST body 的 `h5` 字段**（`h5 = base64(h5st + String(t))`，恒 948 字符），
  `h5st` 为 9 字段分号串的**京东 h5st v5.0 RAC 形态整包移植**（`appId=b5216` / `fv=h5_file_v5.0.6` /
  `cactus.jd.com/request_algo` / localStorage 键 `JDst_rac_*`、`WQ_gather_cv1`）；交付 B 路径沙箱黑盒 +
  Node https 上游桥，20 页全量求和同窗提交 `status:success`
- 新增**规则 50**：黑盒 SDK「返回 Promise 但永不 settle」的两个真因——① SDK 自带 asap 调度型 Promise，
  `MutationObserver.observe()` 写成空桩 ⇒ `resolve` 永不排上（宿主给了真 `setTimeout` 也一样挂死，
  与题12 的「`run_with_trace.js` setTimeout 桩不执行回调」是两条不同根因）；② 沙箱 XHR 事件回推里
  SDK 回调抛错被 Promise 链吞掉。排查顺序固定为「调度四件套 → 回调异常记录 → 才怀疑环境检测分支」；
  配套最小实现落 `references/env/env-debug-loop.md` 新节「异步死等：签名 Promise 永不 settle」
- 新增**规则 51**：摘要算法本体由服务端下发（`request_algo` 响应 `data.result.algo` 就是一段 JS 源码串）
  ⇒ **闭式不存在，还原深度到此为止**，交付转沙箱黑盒 + 上游当动态资源（sha256 校验 + 本地副本回落）；
  与规则 32 第 4 条、规则 49 合成"要不要啃闭式"的三判据（存在性 / 内容强度 / 算法是否本地可得）
- 新增**规则 52**：Step 1 真机 oracle 永久缺失时 fixture 的合规形态——固化**结构基线**
  （字段数 / 各段长度 / 前缀）而非逐字节值，并在 fixture 与总结里写明"逐字节级验证由服务端接受承担、
  伪造同长度被拒即反向证据"，避免"自己生成自己对拍"被读成一致性证明
- 新增 `references/tooling/ruyitrace-cheatsheet.md` **§6.3 storage 分类日志 = SDK 执行进度探针**：
  SDK 的阶段状态会写进 localStorage，键位序列即状态机轨迹，**第一个只在一侧出现的键就是断点**；
  比看请求列表早一步且零额外采集（本题靠它把取证浏览器断点钉在 `WQ_gather_*` 之后、`request_algo` 之前）
- `references/env/env-detect-bypass.md`「内核级差异检测」补**三种命中形态证据表**：A 报错型 / B 拒绝型 /
  **C 静默断链型（目标请求一次都没发出）**——C 最易误判成"路径猜错或还差一轮浏览器"，
  降级证据是「同一份落盘 JS 跨引擎执行进度不同」+ `--ua` 覆盖后包谱逐位同构；
  并写明判 C 前要先排除 `--targets` 把 HTTP 200 业务拒绝当终态命中的坑
- **门禁修正** `scripts/check_final_artifact.js`：浏览器自动化 / 指纹渲染的内容扫描原按 `isCodeLikeFile`
  （含全部 `.json`）且只豁免 `验证记录.json` 一个文件名 ⇒ `src/target/original/manifest.json` 的
  `captureTool` 说明被误判"包含浏览器自动化代码"（实战被迫改措辞）。改为**只扫代码文件 + `package.json`
  依赖清单**；注释仍由 `stripComments` 豁免、代码内字符串字面量仍命中（已写入注释与自测断言），
  自测 3 → 5 项（新增 manifest 豁免、package.json 必扫两条）
- 计数漂移修正：`experience-rules.md`「当前规模」38 → **46 条实条 + 6 条指针**（规则 1..52 去掉 6 个并入号）；
  README 案例数维持（统一在 2.3.139 刷新）；`check_skill_consistency.js` 复跑通过（引用 146 条全存在）

## 2.3.135 - 2026-09-20

### 码上爬题15（同花顺 hexin-v 移植版 Cookie 载体指纹结构体）经验吸纳：新增规则 49 校验载体归因 + 规则 32 扩条 + `forensic_ruyipage.py` 入口页丢失缺陷修复

- **工具缺陷修复** `scripts/forensic_ruyipage.py`：入口页 `document.html` 在采集期写入（`:1175`），收尾
  `_write_outputs` 又把它列进 `_rotate_previous`（`:1320`）⇒ **每轮跑完 `case/forensic/document.html` 必不存在**，
  只剩 `.prev-N` 且不再写回；连续复现于 mashangpa 题13（3 份 prev）/题14（2 份）/题15（1 份），
  仅早于轮转特性的题12 留有文件——而 SKILL.md §4.2 把 document.html 定为 challenge cookie 强制证据。
  改为「本轮首次覆盖上一轮入口页时」就地轮转，并从收尾轮转列表移除；自测新增反证断言
  （直接调 `_rotate_previous(['document.html'])` 证明旧行为会搬走本轮产物），自测项 10 → 11
- 新增案例 `cases/cookie-carrier-hexinv-fingerprint-struct-mashangpa-p15.md` 并注册 index.json（第 59 例）：
  hexin-v 整包移植（识别信号 `thsi.cn`/`chameleon`/`TOKEN_SERVER_TIME`/`X-Antispider-Message`），
  值 = `base64(60 字符自研 base64url + 13 位毫秒 ts)`，体内 45 字节 = `[0x03 魔数][滚动校验和][43B 位打包指纹结构体 XOR]`；
  交付 B 路径最小 vm 沙箱黑盒，20 页全量求和同运行同窗提交 `status:success`
- 新增**规则 49**：同值多载体（Header 与 Cookie 同时出现）必须先单变量定「哪个载体被校验」——
  实测只带 `hexin-v` 头被拒、只带 `v` Cookie 通过；判错会把「签名正确却被拒」误读成算法/环境问题。
  与 `analyze_cookie_attribution.js` 的生成方归因分工写明（生成方 ≠ 校验方）；SKILL.md §7 加一行指针
- **规则 32 新增第 4 条**：校验强度判据从「随机环境值」扩到「整条编码链」——链长是客户端混淆强度不是服务端校验强度，
  交付形态定案前先用一组受控单变量请求（缺参/换载体/伪造内容体/改 ts/截断/重放）打边界再决定是否还原闭式；
  本题据此把交付停在黑盒沙箱，省掉 18 字段位宽与 XOR 递推常数
- `references/env/env-object-model.md` Canvas/WebGL 节新增 triage：**先判返回值是否真被消费**
  （`!!ctx` 可用性探针 / 固定枚举 / 像素与串参与拼接），只有后者才走值回放；本题 webgl2 探针只折 1 个 bit
- `references/crypto/algorithm-families.md` 站点速查表补 hexin-v 族 T1 识别信号行（原「同花顺 | token」行保留，二者不同接口族）
- `scripts/README.md` 标注同类 flag 在两个脚本中不同名（采集 `--evidence-signal` / 导入 `--trace-signal`），
  并强调多进程 domtrace 必须一次传多个 `--input` 合并导入

## 2.3.134 - 2026-09-20

### 码上爬题14（safekodo 打包器 URL query 签名）经验吸纳：探针二分法 + vm realm 时间冻结 + 竞态非恒定修订 + `--targets` 业务拒绝终态坑

- 新增案例 `cases/obfuscated-url-param-signer-safekodo-mashangpa-p14.md` 并注册 index.json（第 58 例）：
  签名挂 `XMLHttpRequest.prototype.open` 重写 URL（`m=base64(CODE4+ts+NUL)`），CODE4=H(ts) 为打包器内部哈希
  （16 值域/4bit 索引/`0xDE` 配对，闭式未还原），交付 B 路径最小 vm 沙箱黑盒，两组真机 ts 逐字节对拍 PASS，
  20 页全量求和同运行同窗提交 `status:success`
- 新增规则 48（experience-rules.md + 案例对照表）：「锁随机源 → 锁时钟 → 受控扫描」探针二分法——
  锁 `Math.random` 仍变即排除随机盐改锁 `Date` 构造器；输出值域极小（2^n 量级）先挖配对/异或/查找表结构；
  黑盒在真机同输入上逐字节复现即分支对齐证据，闭式未还原不阻塞交付
- env-debug-loop.md 新增「沙箱内时间/随机冻结不生效」：vm realm 边界（宿主改 `globalThis.Date` 不跨 realm，
  冻结须 context 侧 `vm.runInContext('Date', sandbox)` 后覆盖）+ 取时入口判别（桩 `Date.now` 无效 ⇒ 目标用 `new Date().getTime()`）
- trace-flow.md 两处修订：①「签名脚本注入竞态」补非恒定性——竞态是时序性的，换采集工具即改变时序
  （题14 ruyipage 两轮裸发、RuyiTrace 轮成功），判「恒定」前先换工具重采一轮；②翻页点击坑 ③→④，
  新增第④坑：`--targets` 按「非 OPTIONS 2xx」判终态，把 HTTP 200+业务拒绝当命中 ⇒ 取证提前收尾、
  `--click` 永不发生，先读 `target-hits.json` 响应 body，预期首屏被拒时改 `--settle` 模式

## 2.3.133 - 2026-09-20

### 码上爬题13（ob-io 三头签名 + 签名脚本注入竞态）经验吸纳：MSYS 入参改写 + 「trace 过了门禁却没覆盖签名写入点」的替代取证路线

码上爬题十三「风火轮」（标签 headers验证/js加密/js混淆）实测：签名层是挂在 `$.ajaxSettings.beforeSend` 上的单个函数，
`s = MD5(JSON.stringify({page:"N"}) + r + t)`，`t` 为秒对齐毫秒、`r` 为 UUIDv4 风格 32hex 随机盐；
9 组沙箱样本逐字节对拍 + 20 页真实请求 + 提交 `status:"success"`。本轮代价集中在**取证侧的四轮空转**与**一次误判共享脚本缺陷**，沉淀这两类。

- **scripts/forensic_ruyipage.py（修共享脚本，非 case 内绕过）**：新增 `_looks_msys_mangled()` +
  `_warn_mangled_target_patterns()`，在 `main()` 解析入参后（启动浏览器之前）与实时分类前各告警一次。
  根因：Git Bash/MSYS 把以 `/` 开头的入参静默改写成 Windows 路径——`--targets "/api/x/data"` 到达 Python argv 时是
  `D:/Program Files/Git/api/x/data/`，子串永不匹配 ⇒ 目标明明抓到却报 `NO_TARGET`、真终态被降级成 related 候选。
  已在 `run_self_test()` 追加断言（盘符正/反斜杠两形态识别 + 合法值零误报），自测清单同步扩写。
- **scripts/write_stage_report.js（能力补齐）**：新增 `STAGE_ALIASES`，`--stage` 接受 19 个**状态机英文节点名**
  （`TRACE_ANALYZE`/`FORENSIC_CAPTURE`/`REAL_VERIFY` …）映射到既有固定中文阶段。此前 SKILL.md 0.0 节用英文节点推进、
  报告脚本却要求中文阶段名，`--stage TRACE_ANALYZE` 报「未知阶段/自定义阶段名称必须包含中文」并只打印 usage，连撞两轮；
  现在未知 token 的报错会直接列出全部可用别名。
- **references/tooling/ruyi-tooling.md**：① 典型用法块新增 **Windows/Git Bash 入参硬约束**（targets 值勿以 `/` 开头，
  或 `MSYS_NO_PATHCONV=1` / `MSYS2_ARG_CONV_EXCL="*"`）；② `add_preload_script` 追加**坑 4**——箭头函数形 hook 会正常
  报「已安装」，但 hook 内调页面自有全局函数（`window.loadPage(n)`）**零请求产出**；本环境未定位到是 world 隔离还是求值时机，
  故只登记操作结论：试一次不产请求即换路线，不要连环试到第 3 轮。
- **references/workflow/trace-flow.md**：① 「翻页点击**两**个静默失败坑」升级为**三**个——新增③「分页/列表 DOM 从未生成」：
  服务端把拒绝包在 `HTTP 200` + 业务码里，页面渲染分支未进 ⇒ 任何 `#pagination …` 选择器必然未命中而提示语只谈语法；
  并补「核对 `.prev-N` 时间戳再断定产物属于哪一轮」。② 新增「签名脚本注入竞态」段：判据是 RuyiTrace 调用栈显示请求走
  **官方原版 jQuery 文件**、`setRequestHeader` 只有标准三头，且冷/暖缓存各采一次均复现 ⇒ 非 BLOCKED_FORENSIC、非工具缺口，
  writer 真值改由 `run_with_trace.js` 沙箱直调落盘的站方原始脚本取得。
- **scripts/lib/query_log.js（误导修正）**：`FORENSIC_NODES` 分支的 `[STATE]` 提示原本只说"trace 质量不足应先重采，
  重采一次仍不足才降级静态分析"——本案正是被这句推着连开 4 轮浏览器。追加一条**重采前排除项**：栈显示请求走官方原版
  jQuery 且只有标准三头、冷暖缓存均复现 ⇒ 属注入竞态的"重采无解"分支，直接转沙箱直调。放在门禁输出里而非正文，
  是因为它必须在该决策时刻投递才起作用（正文预算已饱和）。
- **references/workflow/common-pitfalls.md（同根因合并，不新增编号）**：反模式 11 追加第 11 项  「判『共享脚本有 bug』前先验证入参到达进程时的真实值，再验证自己读的是哪一轮产物」——本案曾据
  「子串形 3 轮 NO_TARGET、regex 形 1 轮 PASS」写下脚本缺陷结论并差点进案例库，实际二层根因都不在脚本里
  （MSYS 改写 + 反证用的 `capture.json` 其实是第 4 轮 regex 产物）；`判定测试` 同步补该问句。
- **cases/obio-md5-header-triple-script-inject-race-mashangpa-p13.md（新增）+ index.json 注册（57 条）+ README 案例数维持（统一在 2.3.139 刷新）**：
  12 条可验证事实（`s` 拼接顺序 body→r→t、`t` 毫秒位恒 000、`r` 是随机盐不是数据哈希及其 UUIDv4 生成式、
  **form-urlencoded 头 + JSON 串体错配**即识别该链的强信号、求和不去重、答案按分钟窗轮换 99300↔98326、
  沙箱只需 4 类桩不需真实 jQuery、头名单字符 `r/s/t` 与题7 `m/ts/x`、题9 `m/tt`、题12 `m/t` 互不可复用）
  与 6 条踩坑（含自写 Node 客户端 advertise `accept-encoding` 却不解压，致 gzip 正文乱码被误报「Cookie 失效」）。

**SKILL.md 只做了等量替换，未增体量**（正文预算 34994/35000 已近饱和，加字必触门禁）：
① §4.2 的 `--targets` 纪律在 196/202 两行**逐字重复**，删去引导语里的一份（`--targets` 只写唯一标识终态接口的
完整路径子串 + 禁宽正则），-41 字、零语义损失；② 省出的额度还给 §8 一句指针——「签名层未安装（栈走原版 jQuery）
即重采无解，改沙箱直调落盘脚本」，插在既有"才用 Hook 模板"那句之后（该句原本会把此类目标误导去装 hook，
而 hook 实测打不通页面自有函数）。MSYS 入参改写**不再占正文**：`forensic_ruyipage.py` 已在解析入参时自行 WARNING，
属脚本自证型经验，按第 12 节留在 references。



## 2.3.132 - 2026-09-19

### 码上爬题12（JSVMP 自实现 SHA-1）经验吸纳：jscall `args` 直读 VM 常量表 + 规则 47「目标自身抛错 ≠ 补环境不足」

码上爬题十二（标签 `jsvmp`，难度困难）实测：签名链是 JSVMP 内自实现的 SHA-1，`m = SHA-1("fu" + 相对 url + t)`，
8 组真机 `(page,t,m)` 逐字节对拍 + 沙箱黑盒双向对拍 + 服务端 `status:"success"` 三重确认。过程中两处代价最高，本轮只沉淀它们。

- **references/tooling/ruyitrace-cheatsheet.md（扩充）**：JSVMP 表后新增「先零成本读 jscall 的 `args`」一节 ——
  VM 会把**运行时常量表当普通实参整份传出去**（实测 148 项，`type:'jscall_detail'` 的 `args[i].value`），
  在**完全不开** `MOZ_DOM_JSVMP_TRACE/AUTODETECT/CONST_SLOT` 的情况下即可读到 SHA-1 族的运行时常量表
  （`1732584193/271733879/1009589776/1518500249/1859775393/1894007588/899497514`——仅 3 个是标准 SHA-1 常数，
  IV3 偏 1、4 个非标准 ⇒ 该 VM 改过 SHA-1 常数，初始化按真机表不能套标准 IV）、实现成员名
  （`rol/hex/encodeUTF8/Uint32Array/getUint32`）、盐值串（`"fu"/"aa"`）与挂载点成员名
  （`originalAjax/requestInterceptors/addRequestInterceptor`），算法族与注入机制一次定死，且不越绝对规则 4 的黑盒边界。
  同时给出三档选用次序（读 args → `CONST_SLOT` → `AUTODETECT`），补齐此前只有开关表、没有取数次序的空档。
- **references/env/env-debug-loop.md（扩充）**：`run_with_trace.js` 两个**静默致死形态**——① 默认上下文已注入 `window`，
  但 `--bootstrap-mode minimal`/`--env-module` 下没有，此时此类目标启动式 `typeof window !== 'undefined' ? window : (window = global, window)`
  退到 `global`，Node 的 vm 上下文同样没有 `global` → 整个 VM IIFE 抛 ReferenceError 死掉，症状却是「脚本跑通、入口函数在、url 里没有 m/t」，
  极易误判为"钩子没装/还差环境项"；② 它的 `setTimeout` 桩只记日志**不执行回调**，定时器初始化的链路全丢。
  ⇒ 明确 `run_with_trace.js` 不得当 JSVMP 类的交付级 runner；需要真定时器/真 window 走 `--env-module` 注入（SKILL.md R2），
  禁止自写 `node:vm` harness。
- **references/workflow/experience-rules.md（新增规则 47 + 案例表行 + 规模 37→38）**：目标签名器自身抛错 ≠ 补环境不足。
  官方 VM 对约 4% 的 `(page,t)` 稳定自抛（同一 `t` 必抛、连续时间戳最长失败段 ≤2），题面「数组无法显示请重新从首页访问」即其
  用户可见形态；判别动作是**用已对拍通过的独立实现对同一批失败输入打真实接口**——服务端接受即转独立实现为主路径，
  拒绝才按 规则 28/29 继续对齐环境。反例明确写为两类：继续加 `canvas/performance/realm` 桩空转、以及把自抛误读成
  "站点有随机性"去枚举算法组合。
- **cases/jsvmp-sha1-const-table-jscall-args-mashangpa-p12.md（新增）+ index.json 注册（56 条）+ README 案例数维持（统一在 2.3.139 刷新）**：
  含 15 条可验证事实（sha256 基线、参数顺序 `page,m,t`、`m` 只依赖 `(page,t)` 故服务端可复算、数据按时间窗轮换
  94522→94544、题号→挑战脚本分派表）与 9 条踩坑（含"引入真 jQuery = 同时引入它对 DOM 的全部要求"、
  构造函数共享 `Object.prototype` 致 `instanceof` 恒真、ruyipage `run_js` realm ≠ 页面主 world）。
- **交付瘦身纪律**（记入案例，不新增规则）：算式经双对拍确认后，还原期沙箱（740 行环境桩 + 193KB 官方 JS 副本）
  挪 `case/tools/` 当可复跑对照器，`result/` 只留 `final.js` + 纯算模块——留在 `result/` 会被
  `check_code_quality.js` 判失败（单文件 >500 行、单函数 >90 行、要求拆 `src/env/browser-objects/`）。

**未改 SKILL.md 正文**：预算已饱和（34998/35000 字），规则 47 的可发现性由 `cases/` 内的编号引用与
`search_references.js --id` 承担，符合「新经验默认进 references/cases」的既有纪律。

**效果**：下一个 JSVMP 站点少掉两类空转——一类是"常量表就在 trace 里却没读，回头去开 opcode trace 或猜算法族"，
一类是"把目标自身缺陷当环境不足无限加桩"；`check_skill_consistency.js` 0 问题通过。

## 2.3.131 - 2026-09-19

### 工具链根因定位与交付入库（规则 44~46）+ 码上爬题11 case + ruyipage preload hook 兼容补丁

码上爬题十一（wasm 加密）实测：skill 安装目录只剩 `SKILL.md`（`scripts/` 缺失），被迫手写 ruyipage 取证驱动，由此暴露三件仓库此前未覆盖的事——其中一条**修正了现有文档的错误结论**。

- **references/tooling/ruyi-tooling.md（修正 + 扩充）**：`add_preload_script` 一节原记「两个坑」，现补第三坑并更正：**ruyipage 1.2.62 + FF155 下 IIFE 与函数声明两种形态都硬抛** `BiDiError: ... privileged scope`（原文只说 IIFE 静默不执行，对该版本不成立）。根因定位到库层 `FirefoxBase.add_preload_script` 无条件传 `contexts=[self._context_id]`（与 `_apply_ruyipage_capture_compat_patch` 处理的 `session.subscribe` 同族）；给出底层不带 contexts 的等价写法，并记录 world 归属实测结论——**该路径落在页面主 world**（页面自身 2 次 `fetch` 被 hook 计数、hook 写的全局可被 `run_js` 读到、`remove_preload_script` 生效），故"preload 必是独立 world"不得当默认前提（规则 42 的响应体 prepend 仍为首选路线之一，选路前先做一次同 world 验证）。连带记录 `page.set_bypass_csp()` 同版本同样抛错。
- **scripts/forensic_ruyipage.py（新增能力）**：`_apply_ruyipage_preload_script_compat_patch()`（带 contexts 抛错即降级为全局注册，日志可见）+ `--preload-script <JS|文件路径>`（可多次传，导航前安装，IIFE 形态告警，结果以 `preloadHooks` 进报告）。此前 SKILL.md 反向对照配方要求"ruyipage add_preload_script hook XHR.open"，但该脚本无任何 hook 入口，配方实际不可执行。实测验证要点：被补丁类必须是方法真实归属的 `FirefoxBase`（写成 `FirefoxPage` 会 ImportError → 静默 no-op，首次功能测试即抓到此错）。
- **references/workflow/experience-rules.md（新增 44/45/46）**：规则 44 工具高层封装报「不支持」先定位库层参数根因再判定能力缺失（误判会污染证据链，实战白跑三轮）；规则 45 交付前对 `result/` 跑 `git check-ignore`——交付规范豁免目录 `src/target/original/` 会被 workspace `.gitignore` 的 `**/original/` 静默排除，二进制"交付了但没入库"零报错；规则 46 skill 自身安装残缺（仅 SKILL.md）时按手工等价登记推进，不得误判为外部工具缺失去重装，且手工复刻驱动前须先读 `forensic_ruyipage.py` 已内置的兼容补丁清单（二进制 body 无损读取等），否则重复踩已修坑（实测自写驱动把 229B wasm 取成 241B 带 U+FFFD）。
- **references/workflow/common-pitfalls.md（并入反模式 11，不新增编号）**：按本仓「同根因合并优先」纪律，作为第六形态「工具能力误判不可用」并入 实战案例/正确做法(第 10 条)/判定测试/速查表，标题与形态计数同步。
- **cases/wasm-zero-import-linear-signer-mashangpa-p11.md（新增）+ index.json 注册（55 条）+ README 案例数维持（统一在 2.3.139 刷新）**：题11 = `encrypt.wasm` 生成 Query `m`，wasm 229B **零导入**（页面预构造的 `env.stackAlloc/wasi_snapshot_preview1` 导入对象是无效装饰），Node 原生实例化即可，等价式 `m = (16358 + page + trunc(_ts/3)) | 0`；沉淀**无 RuyiTrace 时的三步 writer 证据闭合**（真机 `exports.encrypt` 直调 30 组 oracle × 本地同 wasm 执行 × 算式 4280 组对拍，全部一致）+ jsjiami v7 self-defending 分支内含假 `fetch` 诱饵 + 规则 36 新形态（同窗口内各页数组重洗而 20 页总和稳定，判数据窗只能用聚合值）。

**效果**：`add_preload_script` 从"文档说可用实则抛错"变为"根因明确 + 脚本内置降级 + CLI 可传"；交付入库新增一条可执行检查；skill 安装残缺场景有明确的手工等价路径而不误重装；码上爬平台 7/8/9/10/11 五题签名链全部沉淀（逐题不同算法族，跨题复用被再次证伪）。

## 2.3.130 - 2026-09-19

### 经验库新增：码上爬平台题9（webpack+HmacSHA1 纯算）与题10（魔改 SHA-256 沙箱黑盒）+ 规则36 补随机数据形态

码上爬平台题9/题10 连续实测，两条签名链再次与题7/题8 不同，进一步证实"同平台逐题核对"。

- **cases/webpack-ob-hmac-sha1-mashangpa-p9.md（新增）**：题9 = webpack + 轻度 ob-io + 标准 HmacSHA1，纯算还原 `m=HmacSHA1("9527"+ts,"xxxooo")`、`tt=base64(String(ts))`；定位方法=**trace 常量命中**（jscall 搜签名前缀常量 "9527" 直接命中 `_createHmacHelper` 构造点）；踩坑含**死代码伪造赋值**（`t(763)==t(763)` 恒真判断 else 分支的 `.m=`/`.tt=` 伪造 switch 不可达）。
- **cases/index.json（更新）**：注册题9、题10 两条记录，`search_cases.js --domain mashangpa.com` 命中 4 条（题7/8/9/10 全链路）。
- **references/workflow/experience-rules.md（规则36 扩充）**：补"更极端形态：同 sessionid 数据也可能每次请求随机"（题10 实证：两轮拉取求和碰巧一致 97664 造成"数据确定"假象，提交时实时重算 103727）——判定纪律：不默认固定会话数据恒定、提交前最后一步实时重拉并立即提交（答案 1 分钟时效）、同平台逐题验证数据稳定性（题9 恒定可 fixture / 题10 随机不可复用）。
- **cases/ob-string-array-modified-sha256-blackbox-mashangpa-p10.md（此前已新增，补注册）**：题10 = 魔改 SHA-256（标准 crypto 输出不匹配 → VM 沙箱黑盒整体加载 pagination10.js 调 OOOO(url)），数组每次请求随机。

**效果**：mashangpa 平台四题（7/8/9/10）签名链全部沉淀，CASE_LOOKUP 按域名命中即可快速判别题号对应算法族与数据稳定性，避免跨题复用算法与复用静态答案。

## 2.3.129 - 2026-09-19

### 经验库新增：码上爬平台题8 纯算签名链（b-io string-array + 环境注入全局 + 明文 JSON）

码上爬平台题8（`/api/problem-detail/8/data/`）实测沉淀另一条签名链，与题7 完全不同：`m=OOOoOo(sms+ts+page, sms)`（逐字节 `(char+key[i%len])%256` 求和卷积转 hex）、`t=btoa(Date.now())`，响应为明文 JSON（无题7 的 AES r 字段）。

- **cases/ob-string-array-purealgo-mashangpa-p8.md（新增）**：技术指纹（b-io 变体、纯索引解码 `idx-0x1da`、旋转终止 `0xcea7c`、环境注入全局 `sms` 等短名零脚本定义）；6 条踩坑（环境全局需由真实样本反推 `sms="oooooo"`、静态 s cookie 必带、**服务端要求 page=1..20 顺序翻页到最后一页才能提交**、频控 403 限速、csrf 需从 `/problem-detail/8/` 动态获取、b-io 家族优先用 trace JSON.parse 参数快照直读字符串映射零执行）；10 条可验证事实（4 个真实样本 OOOoOo 全 MATCH、`sms="oooooo"` 由 6 字节 0xde 前缀反推、TOTAL=96640 多次稳定并提交 success、trace seq896 泄露 `Sms="xoxoxoxo"` 等全集映射）。
- **cases/index.json（更新）**：新增题8 记录，`domains:["mashangpa.com"]`，信号 `sms/OOOoOo/oooooo/暂无答案/index` 等，`search_cases.js --domain mashangpa.com` 命中 2 条。
- **方法论要点**：同平台题号升级**签名链可完全更换**（题7 MD5/SHA256/AES vs 题8 卷积+btoa），CASE_LOOKUP 仅复用平台请求/提交骨架，算法须按题重取证；纯协议还原可零执行反混淆。

## 2.3.128 - 2026-09-19

### 经验库新增：obfuscator.io self-defending 反调试绕过 + 码上爬题7 签名链（题7实测沉淀）

码上爬平台题7（`/api/problem-detail/7/data/`）实测沉淀 ob-io 特有 self-defending（防篡改）反调试的绕过方法，此前 `references/hooks/anti-debug.md` 仅覆盖 debugger/toString 检测、未知 ob-io 的 `new ctor()['method']()` + `array.push(Math.round(Math.random()))` 无限扩容自毁。

- **cases/ob-string-array-selfdefending-mashangpa.md（新增）**：技术指纹（ob-io + self-defending + 旋转 IIFE + m/ts/x 签名链）、6 条踩坑（self-defending 触发、剥离调用连带逗号、T/R 定义在旋转之后勿截断原文件、旋转终止 W=636998、解码索引偏移 308、header 不齐 400）、10 条可验证事实（`m=MD5("xialuo"+ts)`、`x=SHA256(m+"xxoo")`、AES-128-CBC key=xxxxxxxxoooooooo iv=0123456789ABCDEF、求和不去重 200 项、答案口径澄清 92835 为误用去重）。
- **cases/index.json**：新增记录，`domains:["mashangpa.com"]`，关键词 `self-defending/AKcqZX/bTcNvY/rRRNBk/xialuo/xxoo/current_array` 等，`search_cases.js` 按域名/信号/策略检索均命中。
- **references/hooks/anti-debug.md**：新增「obfuscator.io self-defending（防篡改）反调试」专项节——识别特征、高信号命名、绕过 6 步（原始单行提取 y/T/R + 剥离调用连带逗号 + 保留旋转 IIFE 原码运行 + 最小沙箱）、与 string-array 常规还原的区别。

**效果**：后续同平台/同混淆家族案例在 IDENTIFY 阶段即可按索引命中本案例与方法论；ob-io self-defending 不再被误当普通 toString 检测处理。

## 2.3.127 - 2026-09-18

### 速通路径：无加密 / 简单加密案例的 Step 2 免采机制（mashangpa 题一实测暴露的空白）

实测 mashangpa.com 题一（请求侧零加密）暴露两个空白：「轻量路径」在 SKILL.md 使用 3 次但从未定义；AI 在「只有 Step 1」时默认启动 trace 采集而非提议免采，用户必须主动提醒才能走捷径。

- **SKILL.md §4 路由**：「只有 Step 1」分支前置「速通路径速查」——命中且用户确认免采 → 直转 CASE_LOOKUP；未命中/未确认 → 照常 TRACE_CAPTURE。
- **SKILL.md §4.2 新增「速通路径速查」块**：两种免采形态——① 全明文采集型（判据① + 落盘 JS 源码级反证 + 响应明文自包含）；② 简单加密源码可读型（签名链无混淆完整可读 + ≥2 组不同输入样本 Node 复现逐字节对拍一致，任一不一致即未命中、禁止枚举猜算法）。判定材料必须落盘引用，AI 不得以「看起来简单」自行免采。
- **SKILL.md §4.4 例外 4**：Step 2 缺失例外三个扩为四个（速通需用户确认、REAL_VERIFY 不豁免、总结与经验沉淀写明形态与判定依据）；IMPLEMENT 前置条件（R1）补第三分支；CLEANUP 行补速通标注义务。
- **路径 E 指针纠偏**：全明文采集的取证侧豁免原指向例外 3（其定义要求难点在响应解密，纯明文采集套不进），改指速查形态① / 例外 4。
- **state_machine.js**：EVIDENCE_GATE 节点规则新增速查提示行（match14 教训：规则沉到脚本输出驱动，不靠跨轮记忆）。
- **规则 27 增补**：无签名判定时机可前移至 EVIDENCE_GATE（速通形态①②），不必先采 trace 再收手。
- **RB-041/042**：断言 EVIDENCE_GATE → CASE_LOOKUP 速通转换合法 + 速查提示行随节点投递。

**效果**：无加密与简单加密案例从「跑完 Step 2 或用户主动喊停」变为「AI 主动单行提议、用户一句确认即免采」；state_machine 的 EDGES 本就含 EVIDENCE_GATE → CASE_LOOKUP，脚本转换层零改动；RB-005（check_trace_gate 对 Step 1-only 拒绝）语义不变——速通不经该门禁。

## 2.3.126 - 2026-09-18

### 目录布局规范化：多 case 布局 `<workspace>/{tools/, <case-name>/{case,result}}` 落地并固化

用户确认后，把 SKILL.md §4.1 已声明但未显式固化的多 case 层级变成默认工作形态。

- **布局规范**：每个案例目录 `<case-name>/` 自身即 `<project-root>`（`--case-dir` 传它，其下平级 `case/` + `result/`）；`tools/` 放外层 workspace 与案例目录平级共享：`<workspace>/{tools/, <case-a>/{case,result}, <case-b>/{case,result}}`。`scripts/README.md` 顶部新增该布局说明；SKILL.md §4.1 原有表述不变（已是权威）。
- **实际迁移（用户环境）**：`D:\test\git\jsskilltt\` 作为 workspace——`tools/`（RuyiTrace + ruyipage-browsers 未来落点）迁至 `jsskilltt\tools\`，现有 baidu-finance 案例迁入 `jsskilltt\baidu-finance\{case,result}`（原根级 `jsskilltt/{case,result}` 归位）。`normalizeTraceHome` 上溯自动命中 `jsskilltt\tools\RuyiTrace`，无需手工 `--ruyitrace-home`；`check_external_tools` 全项通过（node/ruyipage 包/runtime/RuyiTrace/内核）。
- **迁移后注意**：tools 位置变化使 `check_session_resume` 判为 resume/fresh（环境快照与当前不一致），须重跑完整 ENV_READY 检测——与 SKILL.md「迁移 tools 重跑环境检查」一致。

**效果**：目录结构对齐 SKILL.md §4.1 规范；多 case 后续平级扩展；tools 一处共享、案例各自独立。

## 2.3.125 - 2026-09-17

### baidu-finance 实测回归优化：安装路径归一 + 门禁 --explain + 两个新工具 + case 吸纳

用真实 case（finance.pae.baidu.com acs-token）完整跑通主线后，按日志暴露的摩擦点收敛 8 项改动，全部为通用修复，不引入 case 专用代码。

- **P0 安装路径「传哪装哪」**：`normalizeProjectDir` 不再向上查找已含 tools/ 的祖先——此前 `--project-dir D:\test\git\jsskilltt` 会被吸到祖父 `D:\test\git\tools`，首装后本地 tools/ 为空、`capture_ruyitrace_log` 检测不到需手工 `--ruyitrace-home`（实测 5 步返工）。现指定哪就装到哪（多 case 共享 tools 须显式传共享工程根）；检测侧 `normalizeTraceHome` 增加 caseDir 祖先链兜底，存量共享布局的复用不破坏。
- **P1 门禁要求可读对齐**：`check_final_artifact.js` / `check_code_quality.js` 新增 `--explain` 输出完整硬性要求清单（交付结构/联网模式/Session 形态/TLS 声明/红线/验证记录/总结 8 章/经验沉淀/质量规则），SKILL.md §11 交付前先读 explain 再跑门禁，AI 无需预防性读校验源码（实测该行为合计约 21 步、是最大浪费源）。
- **P1 新工具 `search_capture.js`**：从 capture.json 盘点「哪些接口携带某请求头 + 状态码分布 + Set-Cookie」，替代手工 PowerShell 解析（实测踩过 hashtable 拼串漏匹配）；配套 SKILL.md §7 命令入口。
- **P1 实况修复 `run_with_trace.js`**：minimal 模式（含 env-module 自动切换）下跳过全部浏览器桩导致 vm 内 `new URL()` 等宿主构造器缺失挂起——新增 injectHostBuiltins 兜底注入（仅 undefined 时注入，bootstrap 桩 / env-module 自定义优先）。
- **P1 新工具 `probe_endpoints.js`**：同会话 有效/垃圾/无/篡改末位 四态多接口对照，判定服务端是否真校验某头；默认间隔 + 变体顺序随机防频率风控混淆；实测定位 hotmetrics 为装饰头、hotrank/blocks/marketquote 真校验（有效 200 / 篡改 403 hit risk）。
- **P2 命令纪律**：SKILL.md 速查卡明示「所有 scripts 命令必须在 skill 根目录执行」，杜绝 cwd 漂移后「找不到脚本 → 手改 state.json」；`identify_crypto.js` 补 `--file` 示例并注明长样本必须走文件防 shell 截断误判（实测 273/256 字节误判返工）。
- **case 吸纳**：新增 `cases/jsvmp-vm-blackbox-acs-token-baidu-finance.md`（ParisSDK bdjsvmp 黑盒 + 装饰头四态鉴别方法论，关键坑：env-module 自动 minimal、vm 宿主 URL 挂起、密文长度随环境分支变化），`cases/index.json` 注册可被 search_cases 命中。
- **门禁文案**：install_all/usage 与注释同步「传哪装哪」语义。

**效果**：search_cases acs-token 命中 1（新 case）；不一致检查、self-test、routing benchmarks 全绿；改动未新增 references 文件、未增加经验库编号（复用反模式 36 装饰头对照）。

## 2.3.124 - 2026-09-17

### §4.2/§10 操作细则外迁：正文只留决策规则+指针（34.1K → 33.3K 字）

第 4 轮瘦身的折中执行（用户确认）：不碰结构与红线，只把两大操作细则块外迁到权威 references，正文保留「一句话规则 + 锚点句 + 指针」。语义零丢失——所有外迁内容在目标文件有完整版，缺失部分先补齐再删正文。

- **§4.2 取证与证据门禁**：退出码三态（PASS/PARTIAL/NO_TARGET）语义、PARTIAL 三步路由、翻页类 ≥2 请求序号三条此前 references 均无系统版，先补进 `trace-flow.md`「取证验收标准 / 取证操作细则」；正文四个参数细则 bullet（退出码/翻页/收尾/预算）压成一句指针。信号语义三 bullet（信号定义 + 定向收窄 + STACK_FULL 闸门参数）压成一条（保留 `--target-signal` 兼容提示锚点——consistency 校验实测拦截过一次误删），定向收窄组合表与闸门参数指向 trace-flow.md「定向 trace 策略」与 ruyi-tooling.md。质量判定「重度不足」五个判据枚举改为指针（trace-flow.md 已有完整表）。
- **§10 REAL_VERIFY**：Session 门禁 Node/Python 形态枚举与「最稳妥写法」外迁 `ip-risk-control.md` 新增「写请求与 Session 形态门禁」小节（含写请求三陷阱：jQuery 默认表单编码/CSRF 字段位置/跨域提交），正文保留 R1 判定核心（按字面识别、封装不计入、裸 urllib 判不合格）+ 指针；`--guard mcp` 调试器工具枚举、引擎检测双对照段的重复新鲜度纪律压缩。
- **NODE_RULES 补投递**：REAL_VERIFY 节点新增 Session 门禁规则（第 3 条），换节点时随 `[RULE]` 重新注入，弥补正文细则外迁后的常驻性。
- **锚点安全**：外迁前逐条核对 34 个 RB 锚点在 SKILL.md / trace-flow.md / ip-risk-control.md 的命中分布，8 个 SM-only 锚点（RB-007/008/010/015/016/019/028/034）全部保留在正文原句中。

**效果**：SKILL.md 34096 → 33324 字（-772），references 侧 +1.0K（trace-flow +530 / ip-risk-control +470，先补后删非平移）；RB 34/34、consistency 143 引用 0 问题、state_machine self-test PASS、vendor leakage 0 命中。

## 2.3.123 - 2026-09-16

### 规范对齐重构：SKILL.md 77.4KB → 60.7KB（达成 2.3.118 规划的 60-70KB 目标）

按 skill 规范逐条复核全仓后的结构性优化。目标是「发现要便宜且精确」：description 在每个请求上都要付一次成本，正文只在真正需要时才被读取——所以描述要短而准，正文只留跨题通用硬规则与路由。

**① description 重写（293 → 179 字）**：删掉能力枚举清单（catchall 措辞稀释触发精度，违反规范「避免穷举能力」），行为规定（JSVMP 默认黑盒等）移入正文。保留「做什么 + 覆盖场景 + 不适用边界」三段。

**② 官方校验器对齐（`check_skill_consistency.js` 新增两组检查）**
- `checkFrontmatterSpec()`：逐条对齐官方 `skill-creator/scripts/quick_validate.py`——frontmatter 允许键、name 小写连字符 ≤64、description 无尖括号 ≤1024、正文无 `[TODO:]` 占位行。
- `checkDescriptionQuality()`：三条红线——体积预算 200 字、禁 catchall 措辞（各类/各种/所有/任何/等场景/等等/任意）、必须有边界声明（不用于/不适用）。
- 官方脚本在 Windows GBK 下会 `UnicodeDecodeError`（需 `PYTHONUTF8=1`），故 CI 不直连 Python，改以 Node 等价实现覆盖；本地另跑官方脚本确认「Skill is valid!」。

**③ 路由基准去「文本镜像」化（25 → 34 用例）**：删除 2 个 `script=null` 纯锚点用例——它们只断言「SKILL.md 里存在某句话」，属规范明令避免的 tests that merely match generated wording。改为行为断言：调 `state_machine.js --set <NODE> --force` 断言 `[RULE]` 投递文本，新增 IDENTIFY（参数名存在 ≠ 参数生效）与 SIGN_ONLY_DELIVER（不得宣称真实验证通过）两例。`check_routing_benchmarks.js` 现将 `script=null` 直接判错并说明理由。锚点保留在语料中作防漂移守卫，但不再有只验文本的用例。

**④ 触发精度评估（新增 `scripts/eval_trigger.js` + `tests/trigger-eval/cases.json`）**：26 条语料（12 应触发 / 14 不应触发，含 App、桌面程序、小程序 Native、Playwright 交付、通用问答等边界）。`--score` 输出 precision/recall/F1 与逐条漏召/误召归因，门槛 0.95——26 条下单条误判必然暴露。触发与否需模型逐条裁定后回填，离线不可判，故 CI 只跑 `--self-test`。

**⑤ 目录性质归位**：`assets/ast-patterns/`（可执行反混淆工具链）→ `scripts/ast-patterns/`；`templates/`（交付骨架）→ `assets/templates/`。前者是工具不是素材、后者是素材不是代码，同放 `assets/` 顶层会让人误判哪个该被调用。全仓引用同步（ast-patterns 19 处、templates 26 文件），`vm-context.js` 跨目录 require 已修正并实测可加载。

**⑥ `agents/openai.yaml` 补齐**：`display_name` / `short_description` / 含 `$js-reverse-skill` 的 `default_prompt`。

**⑦ CI 门禁补漏**：`check_risk_layer_diagnosis.js` 与 `check_vendor_leakage.js` 早已实现 `--self-test` 却从未进 CI；厂商知识越界（§3 T1/T2 分级）是 R0 级不变量，此前只靠发版手动跑。两者现入 CI 常规步骤，厂商越界另提为独立步骤。另修正 `git diff --check` 步骤——干净检出下它是空操作，现改为显式 rev 区间（PR 取 `base.sha`、push 取 `before`，按需浅取基线，失败回退工作区）。

**⑧ 正文去重与收尾**：`run_with_trace.js` 命令在 §7/§8 重复出现（保留 §8 全路径形态）；§12 路由表与正文重复的 `--id` 命令归一到表格；修正 §7「两个识别入口」实际列了 4 项；§4 越权代价、trace 出口门禁前向指针、§4.2 取证前速查命令形态等重复表述压缩。经验规则未变，只删冗余。

**⑨ 表述精炼（结构不动，纯语义压缩）**：9 处零语义损失精炼——删 §4 尾第三遍初始化指令（速查卡与 0.0 双覆盖）；§4.1 推进规则与 GATE-0 重复句改指针；§8「环境检测代码不等于服务端约束」两句同义合并；§1 连续执行总则、§7 手写 runner 句、§10 验证必要条件句的强调性冗词（「不是可选演示」「不等用户回应」等）删减；§4.4 阶段报告触发条件紧凑化；规则 8「第五种通道」悬空编号改为自释表述「联网取证通道」。

**效果**：SKILL.md 43123 → 34096 字（79209 → 61934 字节，77.4 → 60.5 KB，-21.0%），598 → 470 行；强制词密度 4.15 → 3.04 每千字（179 → 104 处）。正文体积预算 35000 字，现余量 904 字；超预算时错误信息会带出超出量。

**未完成/待定**：`eval_trigger.js --score` 的实际跑分需模型逐条判定后回填（打分器已就绪，答案键自校通过）；`cases/` 目录改名会破坏 SKILL.md 与历次 CHANGELOG 的多处引用，属破坏性变更，待单独确认。

校验：check_routing_benchmarks 34/34、check_skill_consistency 0 问题（143 引用）、check_vendor_leakage 0 命中、eval_trigger --self-test PASS、官方 quick_validate.py「Skill is valid!」、`git diff --check` 零输出。
## 2.3.122 - 2026-09-14

### 缺口识别可目视确认：detect_gap.py 新增 --annotate 标注对比图

用户提问点出的一处真实空白：`detect_gap.py` 只输出 JSON，文档里写的「素材图目测交叉验证」全靠人自己开图比对，脚本不给任何可视化。补一条渲染通路，人工（或 AI 自动定位后交用户）能一眼确认识别坐标是否落在缺口上：

- **`detect_gap.py --annotate <out.png> [--annotate-scale N]`**：把 best 候选画红框 + 红色竖线，其它左边缘候选择橙框，中心锚点候选（`slide_comparison`）画品红圆点，左上角写一致性摘要（best 方法/x/方法覆盖数/最大分歧），分歧超阈值时追加 WARNING 行。默认放大 2 倍便于看清，`--annotate-scale` 可调。
- **每个方法补几何字段**：`rect`（absdiff / slide_match / template 的矩形）与 `point`（slide_comparison 的中心点），图片像素坐标系——标注渲染与人工核对共用，JSON 取值与判定逻辑不变。
- **标注文字仅 ASCII**：OpenCV 无法渲染中文，图内标签全英文（`<method> x=<n>`），不影响 JSON 中的中文说明。
- **无候选/背景图不可读**也照常写图或降级为 `annotation.status=failed`，不抛异常、不改变退出码。
- **修正 `slide_match` 返回形态假设**：实测 ddddocr 1.6.1 返回 `{'target': [x, y], 'target_x', 'target_y', 'confidence'}`（**点**），并非仓库文档沿用的 4 元 bbox；脚本改为按长度兼容两形态（≥4 → `rect`，≥2 → `point`），`x` 取值方式不变。同步修正 `captcha-solving-handoff.md`、`open-source-recipes.md`、`templates/captcha-verify-py/README.md` 三处「bbox」硬描述为「版本相关形态 + 锚点语义需实测确认」。
- **诚实边界**：合成图无真实拼图轮廓（alpha 为整矩形），不足以断言 slide_match 的锚点语义（左边缘 vs 中心）——故自测只锁「两形态都能解析且不抛异常」，精度判定留给真实样本 + `--annotate` 目视确认。
- 自测补标注图断言（写出成功、尺寸 = 背景 × scale、缺图降级 failed）并在 ddddocr 可用时实跑 slide_match 路径；同步 `scripts/README.md`、`gap-coordinate-source.md`（C 路线新增「目视确认」条目 + C 路线升级第 1 步）、`verification-workflow.md` 第 5 步。
- 校验：`detect_gap.py --self-test` PASS（含标注与 slide_match 形态兼容断言，本机 ddddocr 1.6.1 + opencv 4.13.0.92）、CLI 端到端 `--annotate` 实测输出 640×240（320×120 × 2）、`check_skill_consistency.js` 0 问题、`check_vendor_leakage.js` 0 命中。

## 2.3.121 - 2026-09-14

### SKILL.md 进一步瘦身 + 锚点/门禁去冗余（81.4→77.9KB；RB 31→25 条）

用户反馈「还是臃肿」+「想改锚点判定和门禁要求」。逐条分析 RB 基准用例与 SKILL.md 被锚点钉死的双覆盖段，删冗余、改机制：

- **RB 锚点机制改造**：`skillAnchors` 命中范围从「仅 SKILL.md」扩为「SKILL.md + references 全库」——锚点句可随文本外迁到 references 而不破坏基准；`loadCases` 允许行为用例无锚点（纯锚点用例必带锚点）。消除文本固化，为后续持续外迁解锁。
- **RB 用例 31→25**：删 6 条——RB-011/012/026（纯文本锚点用例，守护内容三处覆盖、不测行为）；RB-013/023/025（identify_crypto 功能测试，与 `--self-test` 重复，且自测补 UUID 断言后全覆盖 7 项）；RB-029 与 RB-017 锚点去重。
- **§7 特征表瘦身**：JSBN limbs/SPKI hex/Salted 盐语义/短名混淆细节/折叠分析案例/covert 隐写示例等实证细节压为「指针 + 一句话」，权威（规则 29/31/35/38、反模式 29/31/37/39/40、match22/26 案例、covert-channel.md）已逐一核实存在。
- **§4.4 Step 2 例外段**：三例外压缩（MATERIALS_FALLBACK→decision-tree.md 阻塞点#5、BLOCKED_FORENSIC→env-detect-bypass.md、内容还原型三条判据保留行内）。
- **§4 状态机图 BLOCKED_FORENSIC**：三选一细则与 match14 实证压缩，指针指向 env-detect-bypass.md。
- **执行速查卡（续接重建）**：命令表（16 行）删——每条命令与通过标准均已双覆盖于正文 0.0/4.2/7/8/10 节与 scripts/README.md，核实无独有信息；保留续接核心（初始化/推进/续接判定/主线/打转信号）+ 命令索引指针。续接用户首要需求（重建主干）不被破坏。
- 校验：RB 25/25 + self-test PASS、consistency 0 问题 + self-test PASS、vendor_leakage 0、tool_pins schema 通过。

## 2.3.120 - 2026-09-13

### SKILL.md 主体瘦身：操作细则外迁，正文只留硬规则 + 指针（88.9→81.4KB，-8.5%）

用户反馈「主体还是太长」。执行 2.3.118 预告的结构性外迁，原则：SKILL.md 只保留硬门禁/硬约束/RB 锚点句，match 实战细节一律迁往权威 references（先补目标文件再删正文，指针零悬空）：

- **§4.2 取证**：match19 翻页静默失败坑、收尾耗时预期、NO_TARGET 重采候选/全 403 语义、重试场景参数 → trace-flow.md 新增「取证操作细则（match 实证）」节；速查段与 trace-flow 双覆盖压一行；信号语义保留三类不命中 + 正面示例指针。
- **§9 IMPLEMENT**：A-F 路径的 match 实战细节压缩为「症状一句话 + 指针」；C 路径 WASM 三形态各一句 + 汇总指针；F 路径桥式交付形态补入反模式 30「交付形态」（原仅存于 SKILL.md）。
- **§10 REAL_VERIFY**：1a MCP 断点采样细则压为一句+反模式 30 指针；双对照三子协议各压一半（规则 34/27、反模式 36 指针不变）；Session 门禁字面形态细节收紧；fixture 段 match14 复述删（反模式 24 已覆盖）。
- **§4 主线 / §4.4**：外部检索时序 4 条压 1 段；上下文防耗尽 4+3 条压 2 段（机器强制事实保留）；§0.0 TODO 11 项编号列表压为行内主链（权威在脚本渲染 + state.json.todo）。
- 校验：RB 31/31、consistency 0 问题、vendor_leakage 0、state_machine --init 冒烟通过。

剩余结构：进一步压缩需动 31 条 RB 基准锚点所在段（出口门禁/三件套/特征表等高密度区），留待案例实测反馈后决定。

## 2.3.119 - 2026-09-13

### 经验库条目治理：同根因合并 + 指针跳转 + 编号引用校验 + 沉淀门槛

用户反馈「正反模式不用这么多，选取有代表性的保留即可，不是每个案例都有经验需要保存」。对两层经验库做同标准治理——同根因条目并入主条目、旧编号留指针不废弃、检索工具与一致性门禁跟上指针语义、新增条目设门槛：

- **common-pitfalls.md**：17 条同根因反模式并入 7 个主条目（2→1、5/17/20→16、6/10/12/21/38→11、14/15→13、19/33/35→18、24→7、26/32→23），40→23 条实条（80.1→73.8KB），知识点零丢失（形态并入主条目正文）；「贡献新反模式」加门槛——不是每次失败都产生新反模式，案例细节写 `result/经验沉淀-<站点>.md` 交付物，引用现有编号优于新增。
- **experience-rules.md**：6 条同根因规则并入主条目（7→4 案例资产使用、9→13 定位信号、11→12 运行时持久化、15→8 路径选择、17→14 分批采集、18→1 安装顺序），43→37 条实条 + 6 条指针；新增「已合并条目指针」表与「贡献新规则」节（同门槛）；修复重复的「十八」章节号（AI 协作→十九、自同构→二十）。
- **search_references.js**：parseMergedPointers 扩展为双文件解析（反模式→common-pitfalls、规则→experience-rules），`--id "规则 18"` 等旧编号自动跳转主条目并标注 `[已合并]`；未命中提示列出现有实条编号。
- **check_skill_consistency.js**：新增 checkNumberedRefs——SKILL.md 引用的「反模式 N / 规则 N」必须在对应文件中真实存在（实条或指针），防合并后留死编号（阴性测试：注入 30 个死编号全部拦截、干净文件 0 误报）。
- **SKILL.md §4.2**：browser-closed/partial-steps 双覆盖段压为一行指针（细则权威在 `scripts/README.md` 与 `trace-flow.md`，双覆盖前提已核验）。
- **ruyitrace-cheatsheet.md / scripts/README.md**：同步指针后编号与两个脚本的描述。

效果：经验库入口从 83 条降到 60 条实条（-28%），速查表扫描面变小且无死链风险（编号引用有门禁兜底）。校验：check_routing_benchmarks 31/31、check_skill_consistency 0 问题（143 引用）、--self-test PASS、check_vendor_leakage 0 命中、check_tool_pins 通过。

## 2.3.118 - 2026-09-13

### 状态机节点细则指针（[GUIDE] 行）：按节点发射权威 references 路由

SKILL.md 的节点操作细则此前只能靠模型自觉跟进指针；本次把「节点 → 细则权威」路由固化进 state_machine.js 输出——指针由脚本在动作时刻喂进上下文，不再依赖模型记忆：

- **state_machine.js**：新增 NODE_GUIDES 映射（ENV_READY / 取证 / trace / IMPLEMENT / REAL_VERIFY / DIAGNOSE / DELIVER 等 15 个节点），`--init` 与 `--set` 换节点时输出一行 `[GUIDE] <节点> 节点细则：<references 指针>`；同节点重复 `--set` 不重复发射（防输出膨胀）；`--self-test` 新增映射断言（PASS）。
- **SKILL.md §0.0**：新增「节点细则指针」段——操作细则按 GUIDE 指针读取，正文只保留硬规则与路由，规则冲突仍以本文件为准。
- **scripts/README.md**：state_machine.js 行同步 GUIDE 行为说明。

这是结构性外迁（SKILL.md 90KB → 60-70KB）的前置基础设施：细则外迁后「找不到细则」的风险由 GUIDE 行 + search_references.js（2.3.116）双保险兜住；外迁本体需逐节验证后单独执行。校验：check_routing_benchmarks 31/31、check_skill_consistency 0 问题、check_vendor_leakage 0 命中、check_tool_pins 通过。

## 2.3.117 - 2026-09-13

### 状态机 TODO 清单单行化：脚本输出与贴回双程瘦身（上下文经济学 P1）

每次 `--init/--set/--guard` 输出渲染 11 项多行清单，且 SKILL.md §0.0 要求模型在回复中原样贴回——双倍消耗，单 case 实测 20-40 次状态命令。本次把渲染压成单行：

- **state_machine.js `renderTodo`**：11 项压成一行（`[~]1.INTENT_CONFIRM [ ]2.ENV_READY…`），勾选符号、序号、条目名与「权威清单」声明全部保留，仅去掉多行列表的每行前缀与箭头；`state.json.todo` 数据层与 self-test 断言不变（`--self-test` PASS）。
- **SKILL.md §0.0**：勾选表描述同步标注「单行形态」，判定标准语义不变（清单必须在回复中出现，脚本输出原样贴上即可）。

效果：每次状态命令输出 + 贴回双程省 ~140B（信息量不变），清单在长输出中更易扫读。校验：check_routing_benchmarks 31/31（RB-027/028 状态机输出断言不受影响）、check_skill_consistency 0 问题、check_vendor_leakage 0 命中。

## 2.3.116 - 2026-09-13

### 新增 search_references.js：「反模式/规则」指针按号提取，补齐 references 检索闭环

量化分析：references 层 75 个文件 ≈ 27.4 万 tokens，`common-pitfalls.md` 单文件 ~40KB（约 2.2 万 tokens），而 SKILL.md 有 23 处「反模式 N」+ 23 处「规则 N」引用——跟进一个指针的代价是整读全文件。仓库已有 search_cases / search_trace / search_js 三个检索工具，唯独缺 references 检索，本次补齐：

- **新脚本**（`scripts/search_references.js`）：`--id "反模式 28" / "规则 34"` 按号提取小节（小节标题到下一个同级标题，上限 140 行）；同号标题命中多文件时按权威归属取正文（反模式 → common-pitfalls，规则 → experience-rules），其余列一行指针；`--keyword` 跨 `references/**/*.md` + `scripts/README.md` + ast-patterns README 关键词兜底（按命中数排序、样例行定位）；`--dir` 限定路径子串；编号未命中列出现有编号清单并退出码 1；`--case-dir` 提供时复用 `lib/query_log` 记入打转检测（第 2 次 WARN、第 3 次打转实证）。
- **SKILL.md §12**：新增规则「编号用 `--id` 按号提取小节后再读，禁止为单个编号整读 common-pitfalls / experience-rules 全文」+ 路由表一行。
- **scripts/README.md**：新增「references 知识检索」分类；头部计数 65→66（57 JS）。
- **RB-030/031**：提取命中与编号未命中两条基准（锚点 `search_references.js` / 「禁止为单个编号整读」）。

效果：单次指针跟进成本 ~22K tokens → ~0.5K tokens。校验：check_routing_benchmarks 31/31、check_skill_consistency 0 问题（143 引用）、check_vendor_leakage 0 命中、check_tool_pins 通过。

## 2.3.115 - 2026-09-13

### SKILL.md 上下文瘦身第四步：经验证外迁收尾 + 绝对规则 8 拆行

复盘 2.3.110~112 三轮瘦身的遗留重复，本轮只执行「外迁前提逐一验证命中」的收敛与排版改进（正文压缩、无语义变化），90,411B → 90,206B：

- **§10 1a 算法中间值断点采样**：四条约束压缩为短句；卡死处置（CommandLine 核对 profile 来源）、锚点定位与工具名适配细则指向 `common-pitfalls.md` 反模式 30「采样纪律」（该节已完整承载全部约束，先验证后压缩）；「不支持帧内求值时逐帧 `step` 读作用域」为 SKILL.md 独有操作项，保留。
- **§4.2 TRACE_CAPTURE 质量判定**：五个重度不足判据的括号解释删除——`trace-flow.md`「重度不足」表已逐条承载（未发现 stack.file / 成功解析 <10 / topApis 无 writer / 未覆盖页面 JS / 有效 API 占比过低）；判据名保留作路由；「必须先重采一次才允许降级静态分析」硬规则与 RB-019 锚「合并所有 tab/content 进程文件」原样保留。
- **§9 路径 C wasm-bindgen 桩语义**：`instanceof_Window`/document 括号细节删除（`env-debug-loop.md`「WASM trap：unreachable」专节已完整承载触发链与修复清单）。
- **绝对规则 8 拆行**（纯排版，按 2.3.110 分析方案 C 收尾）：789 字符单行拆为「四个来源 + 四源之外一律封死 + DOM 模拟库禁令」子弹列表；jsdom 同条禁令的双重陈述合并为一条（全文件唯一减少的 1 处「不得」来源于此），合规形态四要点（HTML 本地字符串/脚本取自落盘产物/不开 `resources: 'usable'`/不传目标站 `url`）原样保留。

不动的部分：RB 锚点 38/38 逐字保留（含 1a、质量判定段内锚文本）；frontmatter description 未触碰；状态机节点/转移/门禁/守卫规则零改动；带「返工点/实证」标记的行为规则全部保留原位。

校验：check_routing_benchmarks 29/29、check_skill_consistency 0 问题、check_vendor_leakage 0 命中、check_tool_pins 通过。

## 2.3.114 - 2026-09-13

### 吸纳 9air black_box 纯逆向案例：自同构校验 + wasm 边界透明捕获 + 直接 harness（7 轮环境层死局 → 纯协议 14/14 通过的完整方法论）

某航空站点设备指纹 black_box（tddf 信封）历经 7+ 轮环境层实验（逐槽对齐/全量回灌真机值/注册凭据注入/TLS 替换/内存快照）全部 500 后，定位到「官方包 200 / 重建包必 500」的唯一变量是 JS 包本身——**SDK 把自身脚本源码全文与 wasm 自身字节经 wasm 导入喂进指纹计算（自同构校验/自哈希绑定）**。改用「透明边界捕获 + 直接 wasm harness」后纯协议达成：Node fresh 实例化 wasm + 成对设备画像 + 运行时时间/随机 → 真实业务接口连续 14 次全 200。零浏览器、零 jsdom、零凭据注入，替代原「一次性真机注册 + 凭据复用」中间方案。

- **新案例**（`cases/wasm-harness-selfhash-fp-blackbox.md`）：完整导入契约实测值（`m` 导入恒返回 wasm 自身 138510B、`o` 导入喂 fm.js 源全文 577583B、`s` 为动态 nonce 型 version、导入调用序 24~27 条漂移）、10 条踩坑记录、12 条可验证事实、成对资产固化清单（fp 数组 + 脚本源 + wasm 二进制同会话提取，各 sha256）；index.json 同步新增（domains: 9air.com/trustdecision.com/apitd.net）。
- **env-wasm-advanced.md 新增「wasm 边界透明捕获 → 直接 harness」专节**：适用场景（带导入的签名型 wasm + 官方包可通过/重建包恒拒）、五步流程（透明 hook → 200 透明性验证 → 画像固化 → fresh 生成 → 500 排查序）、四个实测坑（`instantiate(module,imports)` 的 module 重载解析结果是 **Instance 本体**而非记录、内存导出名须 `instanceof WebAssembly.Memory` 探测、导入调用序漂移须按捕获序弹出、结构体标量头不可信以字节 buffer 重解析为准）、fresh 生成 vs 字节级回放接受模型、成本对比表（何时选捕获/纯算/全量逆向）。
- **反模式 39**（common-pitfalls.md）：官方包 200/重建包必 500 归因"环境没对齐"——7 轮单变量实验全无效的教训；判定测试：对照两侧喂给 wasm 的脚本源与 wasm 字节是否逐字节相同。
- **反模式 40**（common-pitfalls.md）：wasm 内存快照跨实例恢复死路——`输出 = f(线性内存, wasm 全局, 导入值)`，全局（堆指针）从 JS 不可恢复，恢复 7MB 后 pre-hash 一致仍 OOB；快照仅留诊断/对拍用途，复现改走 fresh 生成。
- **经验规则 41~43 + 新章「十九」**（experience-rules.md）：41 自同构校验识别与成对资产纪律；42 透明全量捕获优先于 wasm 全量逆向（成本差两个数量级）+ hook 两大坑；43 fresh 生成优于字节级回放 + 载荷自包含性实测（no-register 直发业务也 200，注册非必需）+ 双变体实测不确定输入语义。
- **SKILL.md**：第 7 节信号表新增「官方包 200/重建包必 500 → 自同构校验」路由行；第 9 节路径 C 追加「透明边界捕获 + 直接 wasm harness」完整指针。
- **decision-tree.md**：WASM 加密题型新增「改包即拒（自同构校验分支）」。

校验：`check_vendor_leakage` 0 命中、`check_routing_benchmarks`、`check_skill_consistency`、`search_cases` 按域名/信号均命中新案例。

## 2.3.113 - 2026-09-12

### 吸纳外部经验库（ima《学习逆向的公众号文章》调研落地）

对 ima 知识库 3,944 篇逆向公众号文章做七轮主题检索（补环境/验证码/风控指纹/AST/AI 辅助/学习路线），去重 ~490 条标题摘要后提炼经验，按「并入现有文档、不新增文件」原则落地 8 处：

- **解混淆还原原语菜单**（`deobfuscation/obfuscation-identify.md`）：新增「残留症状 → 通用还原原语」小节，补类型级流水线跑完后的特征级还原动作映射（变量还原 / 动态字面量提常量折叠 / 函数别名合并 / 调用表达式还原 / 二元表达式折叠 / switch 控制器提取 + 无效分支剔除），与现有 ast-patterns 脚本互引，点明多层混淆逐层套原语优于一次性手写 pass。
- **jsvmp 插桩优先**（`deobfuscation/vmp-decompile-optional.md`）：穷尽清单增第 5 条「AST 自动插桩（还原前的默认停靠层）」——插桩轨迹层推不出内部逻辑才进完整反编译；方法第 3 步同步收窄。
- **行为/模型层天花板止损**（`network/ip-risk-control.md`）：新增专节，给出三条判据（双对照 200 / 基线稳定 / 换 IP 换内核失败率不变）+ 排查表（链路完整性：设备注册→上报→业务构成完整序列；字段同源性；行为序列），明确本层不可绕过、据此写结论止损，回应待办 2.3.103 闭环止损判据。
- **AI 协作纪律**（`workflow/experience-rules.md`）：新增「十八、AI 协作」+ 经验规则 40——大体积材料先脚本聚合再分段阅读、AI 结论必须回落证据坐标、限定 AI 适合/不适合的任务；AI 参与不改变门禁权威。
- **TLS 选型顺序**（`network/tls-validation.md`）：新增「选型顺序（按成本递增，命中即停）」——默认 curl_cffi 同族模板 → 双对照结论触发时升 Chrome 系网络栈 → JA3 过 JA4 不过时优先升模板版本而非手拼指纹 → BoringSSL/chromium 抽离属高成本进阶。
- **验证码自训模型**（`captcha/captcha-solving-handoff.md`）：ddddocr/OpenCV 零样本失效题型（图标点选/旋转回归/孪生匹配）的最小自训流程（采集→标注→训练→接入），注明离线准确率 ≠ 通过率。
- **验证码通道形态**（`captcha/captcha-request-chain.md`）：新增通道变体表（HTTP / wss 帧 / wasm 内编码），纪律：链路表出现「找不到 verify 请求」时先排查通道，不得判无验证提交。
- **外查检索源优选**（`SKILL.md` §4）：外部检索时序增第 4 条，优先查按平台/题型归类的文章索引库（如 GitHub 公众号文章归档仓库），命中后仍按「标记假设、本次证据为准」处置。

**未实施**：补环境 document.all/jsdom 检测面（`native-capability-gap.md`、`runtime-frameworks.md` 已完整覆盖，遵循收敛原则不重复新增）；高熵指纹分级（价值有限，待随案例沉淀）。

调研报告：`.workbuddy/知识库JS逆向经验分析-2026-09-12.md`。校验：check_routing_benchmarks 29/29、check_vendor_leakage 0 命中、check_skill_consistency 0 问题。

## 2.3.112 - 2026-09-11

### SKILL.md 上下文瘦身第三步：档位 1 无风险微调

复盘 2.3.110/111 后确认优化到位，执行收尾微调 4 处（复述收敛 + 序位统一 + 双向指针，不涉锚点文本）：

- **§0.0 `--guard mcp` 注释收敛**：与速查卡逐字重复的前置条件复述（BLOCKED_FORENSIC 须用户确认 / DIAGNOSE 双对照须已过 BLOCKED_FORENSIC）改为指针，权威在绝对规则 8；速查卡简版保留（速查卡本身是压缩续接重建主干的摘要层）。
- **两处「本节最高优先级」序位统一**：第 0 节硬门禁保留最高优先级；第 1 节连续执行总则改标「横切全部阶段；先决条件仍以第 0 节硬门禁为准」，消除优先级声明打架。
- **§4.4 准入三件套第 3 条收敛**：「Step 2 缺失不得进入 IMPLEMENT」与紧随其后的「Step 2 缺失」段重复，改指针；RB-011 锚「Step 2 缺失（check_trace_gate.js 退出码 1）时不得进入 IMPLEMENT」在权威段保留原样。
- **例外 3 ↔ 路径 E 双向指针**：内容还原型豁免的「请求侧明文」判定材料指向路径 E「无签名三条判据」（注明无 trace 时用①网络层+③Cookie/存储层）；路径 E 反向指向 4.4 例外 3，取证侧豁免与实现侧判定不再各自孤立叙述。

校验：check_routing_benchmarks 29/29、check_vendor_leakage 0 命中、check_skill_consistency 0 问题。

## 2.3.111 - 2026-09-11

### SKILL.md 上下文瘦身第二步：案例叙事外迁 + 过度解释压缩

续 2.3.110 方案 A，执行**方案 B（match 案例细节外迁）与方案 C（过度解释压缩）**。**外迁前提逐一验证**：先 grep 确认目标文档已沉淀对应细节（反模式 28 三条对齐、规则 26 模块切片、match26/27/29 案例的翻页/now 注入/Proxy 缓存、match18 重采候选、match28 hex2b64、反模式 36 限流节奏、match19 翻页坑、规则 33/反模式 34 环境桩主 realm 坑等），全部命中后才压缩正文。97,154B → 89,000B（-8.4%，含 2.3.110 的 1.4KB）：

- **§9 路径 B 重写（3,160B → 1.5KB）**：五个 match 题的机理叙事与操作细节压缩为「症状特征 + 指针」，唯一权威分别在反模式 28/29/31、规则 26/33、match26/27/29 案例；保留 RB-027 锚「环境分支诱饵变体」与「黑盒输出自洽 ≠ 与真实浏览器一致」等决策判据。
- **§10 正向对照段重写**：match25 T 偏移矩阵、match19 三级客户端阶梯、match28 限流节奏的展开叙事压缩为三条子协议 + 规则 27/31/34/37、反模式 36 指针。
- **§7 T1 信号表 6 行瘦身**：库家族/JSVMP/JSBN/JSEncrypt/Salted/成对折叠行的单题解法细节（fe() 三层降级、indexOf 定位 N、`k & 0xfe` 具体值等）删除，保留信号特征与路径判定；RB-012 锚定四行（webmssdk/h5st/geetest/woff）与 RB-024 锚「先整包黑盒」不动。
- **§4.2 坑点收敛**：NO_TARGET/命中全 403 叙事、翻页两个静默失败坑压缩，细节指向 match18/26/19 案例。
- **微压**：§7 vm-runner 两点纪律（①与反模式 31 重复删除）、路径 A 候选扫描、路径 F 反模式 30 三条、§8 eval 落盘重复句（指向 §7 信号表）、交付语言段 match19 细节、§11 实测返工叙事、§4.2 多进程 domtrace 句（保留 RB-019 锚「合并所有 tab/content 进程文件」）。
- **不动的部分**（功能影响风险评估）：绝对规则 8 红线权威定义、IMPLEMENT 准入三件套格式要求、防耗尽检查点机制说明、Session 门禁形态识别、依赖 JS 版本校验等行为契约段落。

校验：check_routing_benchmarks 29/29、check_vendor_leakage 0 命中、check_skill_consistency 0 问题。

## 2.3.110 - 2026-09-11

### SKILL.md 上下文瘦身第一步：语义去重（无损）

量化分析确认 SKILL.md 臃肿（97,154B / 644 行，约 40k+ tokens 全量注入）：12 组语义重复 + 28 处「match NN 实证」案例叙事内联 + 过度解释。本次执行**方案 A 无损去重**（同一语义只留一处权威，其余改指针；有损的案例外迁方案另行确认后执行），97,154B → 95,713B（-1.4KB，12 行）：

- **速查卡 Step 2 行**：括号内长注释（domtrace 漏导核对、`--gate` 带栈配方）压缩为指针——权威在 §4.2 与 `trace-flow.md` 多进程合并/诊断顺序专节。
- **§4 出口门禁段**：删除与 §4.2「出口门禁复检」逐句重复的解释句与完整命令行，只留一句硬约束 + 指针（RB-005/006/007 锚定文本均在 §4.2 权威版，不受影响）。
- **§4.2 泛化 API 段整删**：三个语义点由信号语义条（②泛化 API 门禁拒绝）、`--end-signal` 分离条、§7 验证码/JSONP 最低证据要求分别承载；RB-008 锚「裸 `createElement`」并入信号语义②（createElement 单独反引号，精确匹配）。
- **§4.2 出口门禁定位句**：「不是 GATE-2 的重复——…」四行解释压为一句括号。
- **§8 内联脚本禁令**：删除与「Windows 写临时脚本规范」重复的提醒，改指针。
- **§10 fixture 多序号**：删与 §4.2 取证覆盖要求重复的尾句，改回指。
- **§10 match21 毒化段**：与状态机 DIAGNOSE 节点重复的实证展开压缩为指针（保留 RB-027 锚「DIAGNOSE → BLOCKED_FORENSIC」与 RB-028 锚标题）。
- **§11 result/ 目录树**：删除与 §4.1 逐字段一致的 7 行树，改一行指针。
- **vm runner 回指 ×2**（§8 末句、§12 路由表）：压缩为最短指针，权威在 §7 硬约束。

校验：check_routing_benchmarks 29/29、check_vendor_leakage 0 命中、check_skill_consistency 0 问题。
复核修正：初版分析报告高估了无损空间——「Windows Python 坑 4 处」实为 3 个不同坑、「禁手写 vm runner 5 处」中 3 处已是指针，均不动；无损去重实际净省 1.4KB（非初估 15-20KB，该量级属方案 B 案例外迁）。

## 2.3.109 - 2026-09-11

### 吸收外部题解方法论：VMP 前置判结构闸门 + 负结论采集范围纪律 + REAL_VERIFY 负对照

外部某教学靶场 match26 同题独立复盘（静态反混淆路线）与本仓库 match26 案例交叉复核：案例事实两源一致，仅吸收方法论增量，全部为既有文档内小改，不新建文档——

- `deobfuscation/vmp-decompile-optional.md`：前置清单新增第 2 条「**AST 反混淆判结构**」——混淆 ≠ 虚拟化，反混淆后源码可读 = 算法在源码层禁入本路径，只剩 dispatcher + 常量池才轮到逐 op；原 2/3 顺延为 3/4。
- `workflow/common-pitfalls.md`：新增**反模式 38**「负结论未查采集范围」——"全场没有 X"先核对采集过滤（match26 实证：fn 0..60 过滤漏掉 fn>60 哈希核，得出"零移位零异或=自定义构造"的错误结论），热点统计三类防御设施污染（NaN 诱饵 / 字符串解码器 / 反调试层）先排除再谈算法族；速查表、头部计数、贡献守则同步 30 条实条。
- `quality/validation.md`：新增**测试 89**「REAL_VERIFY 负对照」——正对照通过后还须发一次错误签名确认被拒，排除"服务端未校验、200 是会话层放行"；并与反模式 36 限流 403 给出区分判据。
- `deobfuscation/obfuscation-identify.md`：AST 工具链补第三方反混淆器备注——`npx deobfuscator` 纯 JS 无 native 依赖可作首选；webcrack 依赖 isolated-vm 在新版本 Node 常安装失败。

## 2.3.108 - 2026-09-10

### 修正 MCP 隐私边界的采集范围：外站 SDK 必须一并采集

2.3.107 把采集范围写成「只采目标站产物」**过窄**：加密与指纹的加密 SDK 常挂在第三方域（风控 SDK / CDN / 上报端点 / 验证码端点），不采则取不到证据。

- 改为按「**是否属于本次取证链路**」判定，而非「是否同域」：目标站**及其依赖的第三方 SDK / CDN / 风控上报端点 / 验证码端点**一并采集落盘 `case/`。
- 仍禁止的是**与本次 case 无关**的用户数据（无关站点的 Cookie / Storage / 登录态、书签、密码、历史、扩展数据）。

## 2.3.107 - 2026-09-10

### MCP 部分：profile 语义统一 + 隐私授权边界 + 工具名核对 + 重复收敛

- **profile 语义统一**：原「连接用户真实浏览器」（绝对规则 8 ④、SKILL §4、browser-acquisition、decision-tree 阻塞点 8）与「chrome-devtools-mcp 专属 profile」（SKILL §7 1a、common-pitfalls 采样纪律）口径矛盾 → 统一为「连接真实 Chrome 内核浏览器」，并在新增专节区分两种接入模式（独立 profile 优先 / 附加用户运行中的浏览器须额外告知）。
- **新增「浏览器 MCP 隐私与授权边界」**（`references/tooling/browser-acquisition.md`）：接入模式、采集范围（只采目标站产物落盘 `case/`，不得读取/外传其它站点数据）、连接前告知（与 `--guard mcp` 同一次确认）、跨内核证据**互补对照 ≠ 混用等同**（样本记 `baselineId`）；MCP 兜底取证行挂指针。
- **工具名核对**：`SKILL.md` §7 1a 的 `evaluateOnCallFrame` 改为「工具名以所连 MCP 实际暴露为准（如 `evaluate_script`）；不支持帧内求值时用 `get_paused_info` + 逐帧 `step` 读作用域」；卡死处置改为先按 CommandLine 确认实例 profile 来源再操作。
- **收敛**：`common-pitfalls.md` 重复的 BLOCKED_FORENSIC 三选一改为指向 `decision-tree.md` 阻塞点 8 的指针。

## 2.3.106 - 2026-09-10

### 通用文档清除厂商/平台名（T1/T2 越界）+ 新增防漂移检查脚本

- **清除越界**：21 篇通用文档的叙述与举例里的具体厂商名、目标平台名改为通用指代（抖音→某短视频平台、瑞数→某签名型风控、拼多多→某电商、猿人学→某教学靶场、Cloudflare/Akamai→某 CDN 风控 等）；保留 `cases/` 指针与域名等路由键，不改案例文件。
- **保留（规则允许）**：`cases/`、`references/captcha/`（验证码厂商知识库）、识别参考（`crypto/algorithm-families.md`、`network/ip-risk-control.md`、`env/env-iframe.md`、`rendering/font-anti-crawl.md`、`rendering/image-content-reversal.md`，后四者自带「知识分级」声明）、`deobfuscation/obfuscation-identify.md`（表内为 assets 真实子目录名）。
- **新增 `scripts/check_vendor_leakage.js`**：扫描非豁免文档的厂商/平台词表，命中即 FAIL（`--self-test` 覆盖）。已登记进 `scripts/README.md`（计数 64→65 同步）。
- 说明：纯 SDK/组件名（`webmssdk`、`byted_acrawler`、`TCaptcha`、`smcp` 等）属 CI 层识别信号，不在词表内；`微信/QQ/UC` 等浏览器标识按功能性词汇保留。

## 2.3.105 - 2026-09-10

### 清除通用文档中的厂商/平台名（T1/T2 越界）；修正规则知识库路径

- **修正 2.3.103/2.3.104 引入的越界**：`cookie-generation.md` 设备级凭据行去掉「同盾 / 瑞数」，`env-detect-bypass.md` 跨内核条去掉「9air / fm.js / tddf」，改为通用表述。
- **规则修正（§3 厂商知识分级）**：T2 知识库路径由 `references/captcha/captcha-providers.md` 改为 `references/captcha/`（整个目录才是厂商知识库，原写法与实际不符）；明确「通用文档（含相关案例表）不得出现具体厂商名、目标平台名或协议参数」。
- **遗留**：全仓仍有约 30 篇通用文档存在厂商/平台名（集中在 `相关案例表` 描述与 `反模式` 举例），属系统性漂移，需专项清理（详见项目记忆）。

## 2.3.104 - 2026-09-10

### 设备级凭据例外路径（迫不得已 + 用户确认）；文档触发条件格式归一

- **设备级凭据例外（§3 红线 + `cookie-generation.md` + `delivery-templates.md`）**：新增对「设备级凭据」（同盾 `black_box` / 瑞数设备 token 等，厂商 SDK 绑设备签发、沙箱/纯协议无法自生成）的处理——**默认视为红线违规**；仅**迫不得已**时，须先向用户说明并经**用户确认**，凭据走配置注入（不硬编码），并在最终总结标注来源、有效期与不可自生成原因。§3 关键 Cookie 分类同步补「设备级凭据」为第五类。
- **文档触发条件格式归一（21 处）**：消除「读取时机 / 适用条件 / 适用场景」异名，统一为 `> **触发条件**：…`（文档级一行）与 `## 触发条件`（多行判定）；`> 适用范围：…必读` 保留为优先级标签。统一约定写入 `reference-map.md`。

## 2.3.103 - 2026-09-10

### 补闭环止损判据 + 跨内核证据规则；TODO 硬门禁去宿主依赖

源自 9air 同盾 case 日志与 TODO 呈现问题的复盘。

- **闭环止损（`runtime-frameworks.md`）**：「何时升级」表后补止损判据——同一检测点连续 2 轮修复仍失败即逐级升级（手补环境面 → 离线 DOM 起底 → native/sdenv），不无限重试、不横向跳浏览器。
- **跨内核证据规则（`env-detect-bypass.md`）**：9air 实证 ruyipage 与 RuyiTrace 是**不同的定制 Firefox 构建**（同一 fm.js 在 ruyipage 下产出 `tddf`、在 RuyiTrace 下只产出 26 字符 deviceId）。补「跨内核证据不可混用，跨内核结论须同内核单独复核」。
- **TODO 硬门禁去宿主依赖（SKILL §0.0 + `state_machine.js`）**：权威清单改为「脚本渲染文本 + `state.json.todo`」；宿主 TODO 同步降为**尽力而为**，宿主呈现/折叠差异不再作为违规判据；判定标准改为"回复中必须出现脚本渲染的 11 项清单文本"。

## 2.3.102 - 2026-09-10

### 纯协议红线改「只写禁用」形态 + 判据收窄；env-free 前置；案例联网边界标注

按「红线区只写禁止、不列允许清单」的写作约定重写 §3，并把红线判据从「禁 jsdom 类库联网」收窄到「禁浏览器 / 自动化」，消除「禁纯协议中继、却允许补环境中继」的自相矛盾。

- **§3 重写（10 条 → 9 条）**：
  - 旧「交付物不得在运行时联网加载目标页再执行其脚本」→ 新「交付物不得使用浏览器、浏览器自动化或浏览器运行态生成参数」：**纯协议（无浏览器）获取并执行目标 JS 放行**。
  - 旧「不把目标网页作为最终签名服务」并入上条；删旧「允许取证阶段使用 ruyipage/RuyiTrace + 允许转纯协议实现」纯允许条（rule 8 已列四个取证来源，转换本就是流程）。
  - jsdom / happy-dom / domino 联网禁令保留为独立禁止条，并**内联「动态挑战类（瑞数）例外」**（走 sdenv 路径 + 总结标注联网依赖）。
  - 模板预填、厂商知识分级两条由许可式改写为「不得…」式。
- **绝对规则 8 尾部**：「边界：DOM 模拟库只允许离线使用」→「DOM 模拟库不得联网加载目标页取证」（禁止式内联）。
- **decision-tree**：文首加「判定顺序」——先判 env-free（同输入同输出、不依赖时间/随机/环境）→ 用 vm 输出当 oracle 反测升级为路径 A，砍掉整层补环境；再按题型表选路径。
- **案例标注**：`cases/jsvmp-ruishu6-cookie-412-sdenv.md` 补「联网边界」说明，标明属 §3 动态挑战类例外、交付须标注联网依赖。

## 2.3.101 - 2026-09-10

### 决策层矛盾修正：补环境框架默认与升级口径统一（X1/X2/X3）

补环境框架决策在三个文档间口径不一致，统一为「路径 ≠ 框架：默认不用框架，启用须用户确认」。纯删改、不新增决策点，净减 7 行。

- **X1**：`decision-tree.md` 把题型 6 / 412 签名型直接写成「路径 D（sdenv）」，与 `runtime-frameworks.md`（默认不用 + 须确认）、`validation.md` 测试 87/88（复杂度再高也不得自动选择）冲突。改为题型表只保留「D 补环境」，并在文首加指针：本文只定路径（A/B/C/D），框架选择见 `runtime-frameworks.md`。
- **X2**：`runtime-frameworks.md` 核心规则 2「AI 自动判断是否需要升级」与同文件二次提醒「不得自动启用框架，需用户确认」自相矛盾。规则 2 补「判定可自动，**启用框架须用户确认**」，题型 6 措辞由「需升级」改「建议升级」。
- **X3**：sdenv 的 `jsdomFromUrl` 会联网加载目标页，与 SKILL.md 绝对规则 8 / §3 纯协议红线边界未澄清。`runtime-frameworks.md` 框架说明补一句：联网边界以该两处为准，采用前确认离线/授权。
- **去重**：`quality/intake-template.md` 的「反爬类型」「TLS 指纹客户端」两段清单为 decision-tree / tls-validation 的纯重复（旁边已有指针），收敛为指针。

## 2.3.100 - 2026-09-06

### 修复 RB-026 锚点漂移（CI failure）

- 2.3.98 精简 SKILL.md 取证注释块时，把硬约束原文「禁止用会误命中同号旁路接口的宽正则」改写为「禁止宽正则误命中旁路」，导致 `check_routing_benchmarks.js --markdown` 的 RB-026 锚点断言失配（双平台 CI 失败，本地 Windows 因跑的是 `--self-test` 未复现）。
- **修复**：SKILL.md §6 网络取证行恢复锚点原文；反模式 22 细节仍在 `references/workflow/common-pitfalls.md`，指针不变。
- 教训：SKILL.md 中被 `skillAnchors` 依赖的硬约束短语属于「防漂移契约」，精简措辞前先跑 `--markdown` 全量基准（不只是 `--self-test`）。

## 2.3.99 - 2026-09-06

### 算法家族表吸收外部仓库通用经验（yunforis/js-reverser 对照，T1 形态不落站点密钥）

对照该学习笔记仓库（~40 站点）逐条复核后，仅吸收可固化的通用模式进 `references/crypto/algorithm-families.md`，站点具体盐值/密钥一律不写（T2 政策）。多数内容已被本 skill 覆盖（瑞数/易盾/极验/猿人学/重放反模式），净增三处：

- **识别关键词新增「百度系」**：gtk 位运算哈希族形态（`String.fromCharCode` 拼属性名、种子 "." 切分、操作串 3 字符步进位运算、>30 头中尾 10 截断）+ token 三段式形态 + 固定 seed 可过期警示。
- **识别关键词新增「密钥来源两形态」**：动态下发型（key-getter，sign 换密钥接口，`keyid/secretKey/aesIv/pointParam` 信号，"先查前置接口再回 JS"排查分支）与常量派生型（URI 伪装密钥常量 + md5 截 16 字节派生 AES key/iv）；两形态可同站并存。
- **站点速查表补百度指数 / youdao.com 两行路由；混淆特征补 `fromCharCode` 拼属性名与 `\xHH` 转义 + 字符串数组索引两行。**
- 评估结论存档：PSM 目录（统计学）无关；数美 yolo.onnx 滑块缺口检测模型层（C 路线增强）经评审暂不采纳。

## 2.3.98 - 2026-09-06

### CHANGELOG 归档拆分 + SKILL.md 取证两节注释块精简

- **CHANGELOG 拆分**：2.3.87 及更早历史版本归档至 `CHANGELOG.archive.md`（最旧到 2.2.1，尾部以"更早版本历史见 git log"收尾）；主文件仅保留 2.3.88 起最近版本（261 行）。README 目录树同步补归档条目说明。
- **引用跟随**：`install_all.js` ruyipage 锁定注释与 `tool-pins.json` note 中的"CHANGELOG 2.3.47"改为"CHANGELOG.archive.md 2.3.47"，避免指向已迁走的内容。
- **SKILL.md 精简**：§5 状态机后补细则指针行；网络取证 / trace 采集两节 PowerShell 注释块压缩为要点列表——与 `scripts/README.md`、`references/workflow/trace-flow.md`、`ruyitrace-cheatsheet.md` 重复的参数细则（XHR 分存字段、cookies.sqlite 预写、tier-pin 三层 pref 理由、MOZ_DOM_* 开关组合、收尾窗口语义）交还下游文档承载，SKILL 层只留硬约束与红线。

## 2.3.97 - 2026-09-06

### 1997.pro 博客 44 篇逆向经验对照入库：4 份新 reference + 小程序边界澄清

系统抓取 yazong 博客（1997.pro）全部 44 篇文章并逐域对照本 skill（对照分析报告见本地
`analysis-1997-blog/REPORT.md`，不随仓库分发）。结论：Web JS 主干域（混淆/平坦化/指纹/
TLS 对齐/验证码/WASM）skill 已覆盖且更工程化，本次只吸收博客的**真增量**，四份均为新增
文档、不改动既有行为：

- **新增 `references/web/covert-channel.md`（新领域）**：浏览器隐蔽信道四分类（存储机制/
  跨上下文线程/DOM 属性/文件与渲染产物隐写）+ trace 取证信号；重点收录阿里滑块 `_rand`
  的 **CSS 动画隐写**案例（@keyframes+@supports/@media 条件块 → animationend 终态
  opacity/color 读取序列化进参数）与**纯协议还原六步法**（ENV 过滤条件规则 + 关键帧线性
  插值 + direction/fill-mode 终态模拟，与真机渲染一致）。
- **新增 `references/network/tls-handshake-gotchas.md`**：JA4 已对齐仍被拦的三个握手级
  残差——ClientHello 记录层分段（Chrome 分片 vs 库整发）、Key Share PQC 混合
  （x25519+kyber768 vs 纯 x25519）、TCP seq 恒 1；附单变量诊断流程。对齐主流程仍以
  `tls-validation.md` 为准，本文只管残差。
- **新增 `references/env/env-concurrency.md`**：补环境服务化工程。vm2 实测陷阱（CPU 密集
  PoW 下 +1069% 耗时 / 十倍内存）→ 禁用 vm2；OOM 根因 = V8 **isolate 级 code cache 不随
  context 回收** × Piscina 复用 worker 单调累积 → 修复 `idleTimeout=1 + minThreads=0`；
  PoW 类任务 MAX_ITERATIONS/MAX_TIME 双保险模板。单请求取证仍走 `run_with_trace.js` 不变。
- **新增 `references/deobfuscation/vmp-decompile-optional.md`（例外路径）**：纯 Web JS
  VMP 黑盒穷尽（eval 落盘/字面量转纯算/带栈 opcode）仍失败时的反编译逃生舱——调度核
  `Q[m[g++]]` 插桩 → 指令语义重写 → 闭包/异常表建模 → AST 重建；黑盒默认不变，Native
  严禁（绝对规则 4）。
- **SKILL.md 三处接入**：§7 IDENTIFY 信号表补"隐蔽信道"路由行；§8 TRACE_ANALYZE 补
  "参数输入链可能经浏览器隐蔽信道"硬提醒段落；§12 路由表补 2 行。
- **小程序边界澄清**：frontmatter 与 §1 任务边界由"不用于小程序"精确为"小程序限纯 JS
  参数还原（Native/加壳部分除外）"——小程序底层多为 JS 封装（wx 对象即 JS），纯 JS 参数
  还原属 Web 路径，与博客 rid 还原实践一致。
- **`references/workflow/reference-map.md`**：场景表补 4 行 + 目录索引补 web/ 节与 3 条
  新文档条目。

## 2.3.96 - 2026-09-01

### 近期 match18~29 经验沉淀复核：common-pitfalls 四处修正（编号体系完整性）

对 2.3.83~2.3.95 期间 match18~29 的非案例改动（SKILL.md、experience-rules、common-pitfalls、
tooling 文档、capture_ruyitrace_log/run_with_trace/state_machine/check_env_prerequisites/
check_final_artifact 脚本能力）做了一轮完整性复核。脚本能力与文档声称全部一致（`--gate`/
`--max-log-bytes`/`--pref`/`--env-module`/`DIAGNOSE→BLOCKED_FORENSIC`/P0-P2 硬校验/样本值扫描/
Session 字面识别均在）；规则 20~39 编号连续、SKILL.md 引用的全部反模式编号均有落点。
common-pitfalls.md 修正四处：

- **速查表漏条目（实质问题）**：反模式 34/35/36/37（match25/28/29 实证新增）没进速查表——而
  使用方式规定 CASE_LOOKUP 只扫速查表，四条新经验在速查路径下不可见。已补 4 行。
- **头部计数过时**：「20 条主条目」/「28 个编号 = 20 实条 + 8 指针」为 2.3.82 时状态，现为
  37 编号 = 29 实条 + 8 指针，两处已更新。
- **反模式 29/30 正文顺序颠倒**：30 块排在 29 之前（match22 补录早于 match21 入库所致），已按
  编号归位并补块间空行。
- **贡献节规模数字过时**：「21 条实条（封顶 20 已超）」→ 29 条实条，措辞同步更新。

## 2.3.95 - 2026-09-01

### 猿人学 match 案例体系整理：平台共性沉淀 + 24 篇案例瘦身 + 通用/专属边界固化

系统梳理 match4~29 共 24 篇案例，把反复重写的平台级共性收敛为单一真源，案例文件只保留本题差异与专属事实：

- **新案例文件 `cases/yuanrenxue-match-platform.md`（平台共性知识库）**：请求/提交链路（`/api/question/N` +
  `POST /a/N` 表单编码 + sessionid 数据绑定）、末页 UA 校验、`/api/getTime` 时间源与 now 注入、诱饵参数
  惯例（反模式 27）、风控底座（蜜月期/限流/`token failed` 多义性）、取证注意（≥2 序号/轮转/内核诱饵分支
  403/试炼步骤口径）、**§7 通用 vs 案例专属边界维护规则**。每条标注实证题号；明确平台共性是基线假设、
  各题风控独立（反模式 18）。
- **24 篇案例瘦身**：头部加平台共性指针；蜜月期参数、sessionid 绑定概念、表单编码成因、UA 提示数组
  解释、限流通用节奏等纯共性重述删除/指针化（净减约 10KB）；算法链/常量/变体指纹/答案数字/各题差异
  全量保留。瘦身前已做"索引独有事实"核查：match29 的 `page=min(5,max(1,p))` 钳位从索引抢救进案例。
- **`cases/yuanrenxue-match-index.md` 重写**：修复第 22/23 题行间空行导致的表格断裂；24 行技术要点
  压缩到 ≤260 字符（识别信号 + 关键坑 + 题间差异）；「用法」蜜月期/sessionid 两条共性段落并入平台篇
  指针；「相关参考」补平台篇入口。
- **`cases/index.json`**：新增 `yuanrenxue-match-platform.md` 记录（kind: template，48 条）。
- **SKILL.md 两处路由**：§5 CASE_LOOKUP 补"猿人学题先读平台共性基线再查题号速查"；§12 路由表加
  猿人学 match 行。
- **边界纪律（沉淀给后续维护）**：案例文件写差异与专属事实；平台级新共性先验证再进 platform.md 并标注
  实证题号；例外（如 match7 勿开窗、match21 无 TLS 拦）必须留在案例文件——例外往往正是该题核心考点。

## 2.3.94 - 2026-09-01

### 经验固化（match29 案例入库：vmpzl 三脚本全 VM 化 + RuyiTrace eval 日志直读业务源码 + 魔改 MD5 黑盒）

match29（`/api/question/29`，js混淆源码乱码）通关（答案 27105688，code=2 exp=107）：页面
`_jquery.js`/`_common.js`/`29.js` **三脚本全 vmpzl VM 化**（eval 包裹 + 尾部 `$fast_unpack("LZ.xxx")`
自定义 LZ 压缩字节码 → WAFJ 魔数 → VM 执行）。token = **魔改 MD5**（标准 K 表十六进制/十进制全缺失 +
46 项 `typeof X==="..." && X.xxx` 环境探测分派，不可纯算），材料 =
`'/api/question/29' + now + (counter + _$v) + '()' + page`（counter 初值 28 随翻页递增、`_$v`=pgxDebug
检测恒 0、page=min(5,max(1,p))）。

- **决定性取证（规则 39 / 反模式 37）**：vmpzl 系 VM 业务层通过 **eval 执行反序列化生成的 JS 源码**，
  RuyiTrace 的 **eval 分类日志**（`logs/eval/trace_eval_process_*.ndjson`）记录完整源码并落盘
  `logs/eval/eval_<pid>_<seq>_eval-direct.js`——**绕开 LZ 压缩/字节码/VM 指令三层直接拿到业务逻辑**
  （29.js 46KB → eval 源码 60KB，`token = _$hal8sh(path+now+(counter+_$v)+"()"+page)` 直接读出）。
  grep eval 源码里的 `token`/`case 64` 定位请求 data 构造（vmpzl 产物请求构造在 switch-case 中）；
  eval 源码变量名 `_$`+随机但**结构稳定**（相邻 case 间固定出现）。
- **新案例 `cases/yuanrenxue-match29-vmpzl-eval-log-source.md`**：8 条可复用经验——① eval 日志落盘
  直读源码（先查日志，勿手写 `LZ.` 解压器）；② vmpzl 三层包装特征（eval 包裹 + $fast_unpack + 字节码
  eval 反序列化）；③ 46 项环境探测桩全 true（Symbol.toStringTag 补 HTMLDocument/Navigator、
  document.all.pgxDebug 恒 falsy 保 `_$v=0`）；④ 页面自驱动翻页的 now 注入（每次翻页前注入新 getTime，
  沙箱必须跨页复用保计数器递增）；⑤ jQuery 桩 `.add()` 必须有（match26 同款再实证）；⑥ m=undefined
  诱饵（反模式 27 再实证）；⑦ 末页 UA=yuanrenxue；⑧ Session 门禁字面识别再实证（`client.getPage(` 不
  算复用，须 `client.get/post(`）。
- **规则 39（新）**：JSVMP 业务逻辑经 eval 反序列化执行 → RuyiTrace eval 分类日志落盘业务源码，绕开
  三层直读；识别/定位/算法可算性判定/now 注入四步法。
- **反模式 37（新）**：JSVMP 一上来就手写解压器/反编译字节码，而 eval 日志已落盘业务源码（match29
  实证修 LZ 解压耗 3~4 轮；判定测试 = `case/ruyi-trace/logs/eval/` 是否有 `eval_*_eval-direct.js`）。
  反模式实条 21 → 22（文档"封顶 20"提示已超，本次为新根因且与既有条目无重复，按编号顺延新增）。
- **SKILL.md 四处补强**：① IDENTIFY 表 JSVMP 行补「先查 eval 分类日志落盘源码」捷径（置于 limbs 直读
  之前）；② §8 TRACE_ANALYZE 开头补 eval 落盘核对与定位命令；③ 4.2 定向 trace 段补「JSVMP 采集后核对
  logs/eval/」；④ IMPLEMENT 路径 B 页面自驱动翻页补「now 注入 + 沙箱跨页复用」细节（match29 实证）。
- **ruyitrace-cheatsheet.md**：新增「§1.0 eval 源码落盘（JSVMP 破局捷径）」小节（落盘文件位置、用法、
  多脚本全 VM 化对应多份落盘、指向规则 39/反模式 37/案例）。
- **案例索引**：`cases/yuanrenxue-match-index.md` 加第 29 题行；`cases/index.json` 追加
  `yuanrenxue-match29-vmpzl-eval-log-source`（46 → 47 条）。


### 经验固化（match27 案例入库：336KB 短名混淆内嵌 JSEncrypt 随机填充 RSA-1024 纯算 + X 值扫描实证 + 沙箱跑通≠服务端接受）

match27（`/api/question/27`，js混淆源码乱码）通关：token 是 **RSA-1024 PKCS#1 v1.5 随机填充密文**
（128B/172 字符标准 base64，每次不同属预期），明文=`/api/question/27`+now+`27`+page，公钥=27.js
内嵌 **X.509 SPKI hex**（pubkey1，`30819f300d06092a864886f70d01...` OID 头，E=65537）。
**破局：X.509 SPKI 公钥直读 + Node `publicEncrypt` 纯算**——先写 vm 沙箱（jQuery 桩 + crypto 真随机）
跑通签名确认结构，再提取 SPKI hex 转纯算；明文含运行时未知常量 X=N+window._$v 且有双公钥候选，
用**候选 X × 公钥扫描实证**（publicEncrypt 逐个发请求，300ms 间隔防限流）：pubkey1+X=27→200、
X=28/pubkey2 全 403 → 明文/公钥双确认。5 页全 200，答案 26217857 提交 code=2 通关（exp=131）。

- **新案例 `cases/yuanrenxue-match27-jsencrypt-random-rsa-purecompute.md`**：7 条可复用坑点，
  核心三条——① **X.509 SPKI hex 公钥 + getRandomValues = JSEncrypt 随机 RSA**（与 match28 的 JSBN
  limbs 确定性 RSA 互补：SPKI 用 `indexOf([0x02,0x81,0x81,0x00])` 定位 N，publicEncrypt 直出，
  无需沙箱）；② **候选 X×公钥扫描实证明文常量**（服务端校验明文确切值，X=27 过 X=28 拒即铁证）；
  ③ **沙箱跑通+token 结构像 ≠ 服务端接受**——`_$v` 依赖 `document.all["pgxDebug"]` 分支致运行时
  数值常量算错（N+_$v≠27），可纯算时转纯算不死磕沙箱。
- **规则 38（新）**：X.509 SPKI hex + getRandomValues = JSEncrypt 随机 RSA → publicEncrypt 纯算 +
  X 值扫描实证明文常量；沙箱跑通≠服务端接受三形态归纳（环境分派诱饵分支 match21/26、realm 自检
  match25、环境依赖数值常量 match27）。
- **SKILL.md 三处补强**：① IDENTIFY 表新增「128B 密文 + SPKI hex + getRandomValues = JSEncrypt 随机
  RSA」识别行（与 match28 的 JSBN limbs 确定性 RSA 并列）；② IMPLEMENT 路径 A 补「明文含运行时未知
  常量 → 候选 X×公钥扫描实证」；③ 路径 B 补 jq 桩 Proxy 缓存坑（`__jqCache` 必须缓存 Proxy 本体，
  否则同 key 二次访问裸对象缺失方法报错，match27 实证）。
- **algorithm-families.md**：新增「RSA 家族」识别关键词段（确定性 JSBN limbs vs 随机 JSEncrypt SPKI
  两形态对照）。
- **common-pitfalls.md**：反模式 29 补「形态二（环境依赖的数值常量算错）」——沙箱自洽但 403 的
  match27 实证，与 match21 诱饵算法变体（IV 常量不同）区分；按同根因合并原则并入既有条目。
- **案例索引**：index.json（46 条）+ match-index.md 补 match27（含 id 字段）。

## 2.3.92 - 2026-08-31

### 经验固化（match28 案例入库：JSVMP 内嵌确定性 RSA-1024 字节码 limbs 直读纯算 + 数据绑定 sessionid + 站点限流判别）

match28（`/api/question/28`，JSVMP 单行 VM）通关：token 是 **RSA-1024 确定性密文**（128B），
明文=`/api/question/28`+now+`28$`+page，PKCS#1 填充 `00 02||01×k||00`（固定 0x01 无随机），
指数 65537，N 由 36 个 28-bit limbs 重建，编码 = JSBN hex2b64（3 hex→2 b64 非标准 base64）。
**破局：JSVMP 不一定非要黑盒**——字节码尾部 `m324665p2098959o9832905...` 数字字面量正是
JSBN limbs，直读重建算法 + Node BigInt 模幂纯算即可，完全不用跑 VM（黑盒调试全是弯路）。
capture 样本对拍逐字节一致后纯协议直连，5 页全 200，答案 27673886 提交 code=2 通关（exp=176）。

- **新案例 `cases/yuanrenxue-match28-jsvmp-rsa-purecompute.md`**：8 条可复用坑点，
  核心三条——① JSVMP 先扫字节码数字字面量判断标准算法族（limbs/常数），命中转纯算；
  ② **数据绑定 sessionid**（同会话恒定≠跨会话相同，换会话必须重算，旧会话答案 25808383 对新会话无效）；
  ③ **站点限流 403 token failed 误判**（短窗口连续请求约第 3 页起 403、单请求正常 = 频率墙非签名错，
  先单请求诊断区分；页间 3s + 冷却 3~4 分钟 + 采集提交解耦 `--submit --answer` 单请求提交）。
- **规则 35/36/37（新）**：JSVMP 字节码 limbs 直读纯算（确定性 padding→本地对拍、limbs 出现序≠数组序）、
  数据绑定 sessionid 换会话重算、限流 vs 签名错误的单请求诊断判别。
- **反模式 35/36（新）**：换会话复用旧答案；把站点限流 403 误判成签名/环境错误。
- **SKILL.md 三处补强**：① IDENTIFY 表 JSVMP 行补「先扫字节码尾部大数字面量判断算法族」+
  新增「128B 密文 + 字节码大数字面量 = JSBN/RSA 族」识别行（hex2b64 非标准编码提醒）；
  ② REAL_VERIFY 403 分层定位补 match28 限流判别（token failed 第三形态：频率墙）；
  ③ 主条目补充说明。
- **案例索引**：index.json + match-index.md 补 match28（含 id 字段，吸取 2.3.90/91 索引遗漏教训）。

## 2.3.91 - 2026-08-31

### 经验固化（match25 案例入库：控制流扁平化 VM 混淆 token + 环境桩必须在沙箱内运行的 403 根因 + 案例索引补漏）

match25（`/api/question/25`，控制流扁平化 VM 混淆）通关：token = x('/api/question/25' + now + page)，
x 是 25.js 顶层函数（48071B，`for(;;) if(_$XX==...)` dispatcher），黑盒执行即可，无需逆向 VM 内部逻辑。
token 结构 = base64段|Huffman编码段*段（char/frequency/left/right 字符+频次交替，含 g 等非 hex 字符，
勿当 hex 解）；x 内部 `(()=>_$AX=_$XL(+new Date))` 时间戳参与编码 → 生成时冻结 Date=getTime 返回的服务器时间戳。
5 页纯协议取数全部 200，求和 26878107 提交 code=2 通关。

- **新案例 `cases/yuanrenxue-match25-cfa-vm-blackbox-env-realm.md`**：8 条可复用坑点，
  核心是 **403 根因**——环境桩在主 realm 定义时 `win.window=globalThis` 指向 Node 主进程全局对象，
  x 在沙箱里 `function(){return this}()` 返回沙箱 globalThis，两者不等 → `window.window==function(){return this}()`
  自检失败 → 误走 `_$VM=111` 分支 → token 全错 → 403 token failed（症状同反模式 26，但根因在**环境桩运行位置**）。
  定位法：**同输入双环境对比**（同一环境桩分别沙箱内执行 vs 主 realm 执行后注入，token 输出一比对就现形）。
- **反模式 34（新）**：环境桩主 realm 定义 → self-reference 自检失败 → 格式全对但服务端全拒（match25 实证），
  含修复纪律（环境桩随目标代码 `vm.runInContext` 执行 / `--env-module`）与 403 排查顺序。
- **SKILL.md 两处补强**：① 路径 B——环境桩必须在沙箱内执行（self-reference 自检）+ **环境桩文件勿用 IIFE 包裹**
  （check_code_quality 把 IIFE 主体当单函数必超 90 行、>500 行多域判「补环境主体堆叠」，用顶层代码+具名函数
  +Object.assign 合并方法集，match25 返工点）；② REAL_VERIFY——**签名内时间戳先做 T 偏移矩阵**（now±N 各生成
  token 请求看通过区间；match25 实测 ±100s 全过 = 不校验窗口，直接冻结 Date=now，勿凭直觉加时间补偿）。
  顺带修复 match26 段落的多处内容空白（`__click('#pgxNext')`/`setInterval` 等代码被渲染吞掉）。
- **案例库索引补漏（2.3.90 声称已入库实际遗漏）**：match26 案例文件存在但 index.json **完全无条目**
  （search_cases 搜不到）、match24/match20 索引条目缺 `id` 字段——本轮补齐；match 题号速查表补 match25/26 两行。

## 2.3.90 - 2026-08-31

### 经验固化（match26 案例入库：SM3 魔改 8 组环境分派 IV + 页面自驱动翻页 + detect-patterns 自引用检测补强）

match26（`/api/question/26`，SM3 魔改 token，26.js 原码黑盒执行）通关：token = SM3 魔改('/api/question/26' + now + page)，
与 match21 同族但环境分派从 4 组扩到 **8 组**（reg[0..7] 分别检测 Document/Window/Navigation/Location/FocusEvent/require/Node/HTMLDocument 的 String() native 串）。
5 页纯协议取数全部 200，求和 29597657 提交 code=2 通关。

- **新案例 `cases/yuanrenxue-match26-sm3-blackbox-page-drive.md`**：与 match21 同族对照（8 组 IV 差异 + _compress 掩码分支
  `document.__proto__===HTMLDocument.prototype→0xfcffffff`）+ 10 条可复用坑点（jq 桩自驱动翻页、setInterval 桩、sessionid 时效等）。
- **detect-patterns 自引用检测补强（match26 实证漏报）**：26.js 解码器形态是 `q = o + i` + **拼接结果 q** 被
  `q['charCodeAt'](u + 0xa)` 读取（带求和偏移），旧规则只匹配"拼接右侧变量自身被 charCodeAt"或显式 `toString()` 调用，
  对该形态漏报 → 误用 AST 反混淆产物执行。pipeline-config.js 的 detectSelfReferencingDecoder 新增第三形态：
  `(\w+)=\w+\+\w+[,;]...\1['charCodeAt'](\w+ + 常量)`（拼接结果 + 求和偏移）。回归：match23 仍告警（无回归）、match22 无误报、match26 现在告警。
- **SKILL.md 四处补强**：① IMPLEMENT 路径 B——页面自驱动翻页（jq 桩按 selector 缓存 + on() 记录 handler + 手动触发
  click，复用页面页码计数器，match26 实证）+ 混淆文件尾反调试 IIFE 需空 setInterval 桩 + **环境桩拆独立文件
  （fs.readFileSync 注入，禁大段模板字符串——check_code_quality 红线，match26 返工点）**；② IDENTIFY 表——签名/token
  **成对或周期相同**先做字节级折叠分析（strToBytes `k & 0xfe` 使 '2'/'3'→0x32、'4'/'5'→0x34，消息字节级相同→hash 相同，
  真浏览器与服务端一致，不是沙箱 bug）；③ REAL_VERIFY——**提交/写接口前先验活会话**（数据接口 200 ≠ 登录态存活，
  会话过期后服务端还会主动清 sessionid cookie）；④ EVIDENCE_GATE——**目标接口命中但全 403** 时 target-hits 的 URL/参数
  结构仍是有效接口证据，不无限重采，签名正确性由 trace+沙箱+REAL_VERIFY 闭环验证（取证侧 403 可能是环境分派诱饵分支）。

## 2.3.89 - 2026-08-31

### 经验固化（match24 案例入库：JSVMP 常量偏移就地修正 + 工具三能力补强 + ruyitrace 参数文档三方核对）

match24（vmpzl 1.5.1 JSVMP 黑盒）通关并**纯协议 token 生成全打通**：沙箱与浏览器的差异只有**一个常量**（状态数组 TL[11..] 起恒差 `XOR 30`），在 VM 分发器入口注入探针就地修正后 token 逐字节一致，5 页纯协议取数全部 200，求和 25650736 通关。本题最大教训不是算法，而是**过程方法论**——一整天攻坚里 17 轮中有 7 轮被"跨构建缓存混对比"的假分歧带偏（见反模式 33）。

- **新案例 `cases/yuanrenxue-match24-jsvmp-blackbox-tl-xor30.md`** + 反模式 32（常量偏移误判为环境读取）已在 2.3.88 尾部同批入库，本轮补 10 条完整踩坑记录与「对 skill 的贡献」节。
- **反模式 33（新）**：跨样本对拍未锁同源——VM 解码缓存跨构建累积、页码=密钥选择器，把不同页码/构建序号/缓存代数的 {c,v} 混对比会产出"解码键链分岔/常量池差异/诱饵编解码器"三个假结论（match24 各耗数轮）；信号=差异项随轮次漂移。
- **规则 31（新）**：疑似超时/时序/频控先实测约束边界再改代码——LEAD_MS=8000 补偿与整套重试是伪需求，实测 age 窗口 2~4s 后按页构建（跳过中间页 0.8~2.1s）天然满足，全部删除。
- **规则 32（新）**：随机环境值（jQuery expando）按"格式正确+运行时随机"补、不固定对齐；先判断服务端校验精确值还是结构自洽。
- **capture_ruyitrace_log.js 三能力补强**：① `--user-js/--pref`——Firefox 层 pref 通道（tier-pin 的 `javascript.options.blinterp=false` 等没有对应环境变量，此前只能复制 profile 手写 user.js 再 subprocess 直启，绕开本脚本）；② `--gate/--gate-after/--gate-duration`——运行时闸门脚本化（带栈 opcode 必须开→交互→关，`MOZ_DOM_TRACE_GATE` 纳入脚本托管）；③ `--max-log-bytes`——采集期日志体积熔断（cheatsheet 一直要求"驱动侧监控超阈值杀浏览器"但脚本此前无此能力，match24 采出 6.6GB）。顺带修复 2.3.88 引入的正则 bug：`JIT_OPTION_` 后是驼峰名（`baselineInterpreterWarmUpThreshold`），原 `[A-Z0-9_]+` 拒绝小写必报错。自测 20 项通过。
- **ruyitrace 参数文档三方核对**：内核二进制（xul.dll）提取 78 个 `MOZ_DOM_*` 开关 + 官方随包 cheatsheet.md + switches.js schema 三方对照，skill 文档开关清单 100% 覆盖无遗漏。补：① `TRACE_GATE*` 在 GUI 开关表是 hidden（只能手动 set / 脚本 --gate）；② **ruyipage 每次启动重写 profile 的 user.js**——tier-pin pref 被冲掉，正路是直启/脚本 `--pref`（match24 实证）；③ 官方「区分 WindowProxy 来源」场景行；④ §6.2 判读形态扩为三种（常数偏移/逐步发散/位置值互换=枚举序问题）+ 带栈采集前置条件（`tier=jit` 无栈值）；⑤ §7 官方闸门实测背书。
- **ruyi-tooling 新增「方式一点五：闸门窗口 + 外部驱动采集」**：capture `--gate` 配方 + 直启+`attach_exist_browser` 逃生舱（match24 用该模式采到 2GB 带栈指令流、800 万条 opcode 全 interp 带值）。
- **case 库**：match24 案例补录完成；match 题号速查表同步。

## 2.3.88 - 2026-08-29

### 经验固化（match23 案例入库：toString 自引用解码 + 环境分派魔改 MD5 + 工具三处补强）

match23（js混淆源码乱码）完整实战成果入库。token = `md5变体('/api/question/23' + now + page)`（now 来自 /api/getTime 服务器毫秒文本），原始 23.js 原码进 Node vm 沙箱 + 4 处环境分支对齐后与浏览器逐字节一致，5 页求和通关（答案 29674800，`code=2`）。本题暴露的不是算法难度，而是 **AST 反混淆破坏 toString 自引用解码器**（产物能跑但解出垃圾/轮转死循环）、**环境分派 IV 的"缺席证据"读法**（Firefox 不暴露 WindowProperties，trace 无第 4 次 instanceof 记录即 fallback 证据）、以及 **官方沙箱默认桩泄漏改变目标环境分支** 三个新坑——均已固化为工具告警与流程规则。

- **新案例 `cases/yuanrenxue-match23-selfref-decoder-env-dispatch.md`** + `cases/index.json`（41 条）+ match 题号速查表补 22/23 两行（22 此前仅在文末 bullet）。技术指纹：obfuscator 短名混淆（无 `_0x` 前缀）+ 解码器 `q=o+g` 读自身源码字节 + 自保护陷阱 `newState/MKZrLm`；环境分派 IV（EventTarget/Window/WindowProperties-absent/Document）、successAlert 移位表分派、createElement instanceof Node 掩码加法器、魔改 T 常量 11 处；低雪崩 token（不同输入仅个位 nibble 变化甚至同输出）；诱饵 m 第六次实证；Node https 直连可用（与 match19/22 TLS 白名单对照）。踩坑 8 条。
- **detect-patterns.js / pipeline-config.js 补强**：① 新增 `ob-io` 家族识别——不依赖 `_0x` 命名的 obfuscator.io 特征（轮转 IIFE / newState 陷阱 / 小写在前 base64 字母表 / charCodeAt 求和偏移），match23 的短名混淆此前 bestId=generic、detections 为空；② 新增 `detectSelfReferencingDecoder` 静态告警——命中即 `[WARN]`「AST 产物仅可阅读、禁止执行」，同步进 detect-patterns CLI 与 run-pipeline 的 pipeline-report.json（warnings 字段）；普通 jQuery/标准 md5 不误报。
- **run_with_trace.js 扩展点**：① 新增 `--env-module`（可重复/逗号分隔）——目标执行前按序注入自定义环境模块（instanceof 类层次、锚点元素 URL 语义等分支对齐需求官方桩不覆盖）；② 新增 `--bootstrap-mode full|minimal`，提供 `--env-module` 时自动 minimal——默认桩的半真半假状态是环境分支干扰源（match23 实测：bootstrap 的 XHR/HTMLElement 桩泄漏致内嵌 axios 走错适配器、md5 IV 错位、token 全错）；③ bootstrap 新增 `__overrideGlobal(name, value)` 受控覆盖 API——写保护沙箱里环境模块直接赋值被静默拦截（目标仍拿默认桩），覆盖后保持只读 getter 语义并记 `env-module-override` 事件。端到端验证：match23 目标 + 6 个环境模块 → token 与浏览器样本一致。
- **check_env_prerequisites.js 正则放宽**：证据来源标记接受 `RuyiTrace seq<N>` / `trace 证据` 形态（match23 实测「RuyiTrace seq7664」被判 BLOCK 返工）；自测 6 项通过。
- **search_cases.js**：新增 `--markdown` 输出（与其他脚本 CLI 风格对齐；此前 `--markdown` 直接报"未知参数"）。
- **文档四处**：① common-pitfalls 新增**反模式 31**（toString 自引用解码器：AST 产物禁执行 / 补丁位置约束 / 导出桩时序 / 环境分派叠加分支对齐 + 判定测试）；② experience-rules 新增**第十四节「混淆识别与执行纪律」**（低雪崩 token 扩散判别 / 短名混淆识别 / 同站邻题不迁移算法假设 / trace 折叠与调用计数反推）；③ env-debug-loop 新增「自引用解码与原码执行纪律」+「环境分支证据的缺席读法」两专节（`__overrideGlobal` 用法、IV dump 验收）；④ ruyitrace-cheatsheet 新增「折叠/省略（elision）与调用计数反推」节（543≈2×260 反推 md5 两次调用，勿以读数会话数下结论）。
- 验证：`node --check` 全部改动脚本通过；`check_env_prerequisites.js --self-test` 6 项通过；`search_cases.js` 对 match23 / "toString 自引用" 均命中；`detect-patterns.js` 对 match23 23.js 报 ob-io 家族 + 自引用 WARN，对 jquery/标准 md5 无误报。


### 同批入库（上一会话成果，一并提交）：match22 案例入库

- 新案例 `cases/yuanrenxue-match22-openssl-salted-alphabet-branch.md`：OpenSSL Salted
  格式 + EvpKDF-MD5 三块链 + base64 字母表环境分支 + TLS 指纹白名单（curl_cffi
  chrome131）+ [Unforgeable] 沙箱探针 + 第 2 次计算反调试死循环；通关（code=2）。
- SKILL.md：识别表增 OpenSSL Salted/EvpKDF 行；实现路径增 F（[Unforgeable] 对齐 +
  字母表环境分支 + 桥式交付）；403 分层定位增 1a（MCP 断点采样路线与反调试纪律）。
- common-pitfalls.md：反模式 30（[Unforgeable] 探针 + 字母表环境分支 + 采样纪律）。
- env-detect-bypass.md：[Unforgeable] 全局绑定探针专节（accessor 化代码模板）。
- check_final_artifact.js：Session 变量提取扩展 requests/creq/curl_cffi 前缀
  （match22 实测 `session = creq.Session(...)` 变量名提取失效）。

