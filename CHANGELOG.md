# CHANGELOG


> 历史版本（2.3.87 及更早）已归档至 CHANGELOG.archive.md。

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

