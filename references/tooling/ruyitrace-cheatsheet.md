# RuyiTrace 定向 trace 开关速查表

> 来源：RuyiTrace 2.5+ 随包 cheatsheet（`src/renderer/assets/cheatsheet.md`），2026-08 快照，并经应用源码（`src/shared/switches.js`、`src/main/main.js` 等）核对补充。工具升级后以随包最新文档为准，本表过期时优先更新本文件再继续用。
>
> 用途：TRACE_CAPTURE 采集前做**定向选型**——先判题型，再选最小开关组合，从源头避免日志过大（见 `references/workflow/trace-flow.md`「定向 trace 策略」）。自动采集用 `capture_ruyitrace_log.js --trace-env KEY=VALUE` 透传下表任意 `MOZ_DOM_*` 开关（脚本自管的 5 个除外：`MOZ_DOM_TRACE` / `MOZ_DOM_TRACE_FILE` / `MOZ_DOM_TRACE_LIMIT` / `MOZ_DOM_TRACE_PTYPE` / `MOZ_DISABLE_LAUNCHER_PROCESS`，分别对应 `--url`、`--case-dir`、`--limit`、`--ptype` 与固定值）。
>
> 所有开关在启动 `firefox.exe` 前设置，进程启动时读取一次，**运行中改无效**。唯一例外：`MOZ_DOM_TRACE_GATE` 受控模式下可在运行中靠控制文件随时开/关落盘（见 §7），但「录什么」的配置仍启动定死。

## 0. 应用层使用机制（源码确认）

- **全部开关都是环境变量，不是命令行参数**。RuyiTrace GUI 的开关总表每项即一个 `MOZ_DOM_*` env；启动时主进程 `spawn(firefox.exe, args, { env: { ...process.env, ...switches } })` 注入。命令行参数只有：`-profile <dir>`、`-no-remote`、`-headless`、`-private-window`、`--fpfile=<path>`（**必须等号形式**，见 §9）与目标 URL。
- 终端等价命令（GUI「复制启动命令」生成 PowerShell 形式）：`$env:MOZ_DOM_JSCALL_TRACE="1"` … 逐行 set 后 `& "firefox.exe" -profile <dir> -no-remote <url>`；Python/ruyiPage 集成同理——`os.environ["MOZ_DOM_*"]=...` 设好后再 `FirefoxPage(opt)`（Popen 继承环境变量）。
- **GUI 会额外注入 3 个默认开关**（用户未显式关闭时）：`MOZ_DOM_EXCEPTION_TRACE=1`、`MOZ_DOM_EXCEPTION_LIMIT=0`、`MOZ_DOM_EXCEPTION_FLUSH_INTERVAL=1`——即 GUI 启动默认开启 exception trace（无限、每条刷盘）。下表「默认」列是**内核默认**（不设时的行为）；本 skill 的 `capture_ruyitrace_log.js` 自己 spawn 不带这 3 个，需要 exception 证据时用 `--trace-env` 显式开。
- **`TRACE_GATE*` 在 GUI 开关总表里是隐藏项**（switches.js schema `hidden: true`），只能手动 `set` 环境变量或经脚本 `--gate` 启用——GUI 里找不到这两个开关是正常的，不是遗漏。
- **GUI / ruyipage 启动会重写 profile 的 user.js**：GUI 启动自动写入代理 prefs，ruyipage 每次启动也重建 user.js——因此 **tier-pin 等 Firefox 层 pref 不能靠「先写 user.js 再让 GUI/ruyipage 启动」注入**（match24 实证：写在 user.js 的 JIT prefs 被冲掉、写 prefs.js 也未生效）。正路是**不经 GUI/ruyipage 的直启**：`capture_ruyitrace_log.js --pref javascript.options.blinterp=false …`（脚本自己 spawn firefox，user.js 不会被外部重写），或 subprocess 直启 firefox.exe + `ruyipage.attach_exist_browser` 挂上去驱动（见 ruyi-tooling.md「闸门窗口 + 外部驱动采集」）。
- **锚点自动注入**：GUI「日志目录」未手动设 `MOZ_DOM_TRACE_FILE` 时自动注入 `<日志目录>\trace.jsonl`；主进程会自动 mkdir 锚点目录（内核不建目录，脚本方式自建目录同样必要）。
- GUI 内置「常规采集」快捷组合与各题型预设见 §6。

## 1. 总开关与输出

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_TRACE` | `1` / `0` / 不设 | 不设 | 主开关。`1` 开核心 DOM/BOM；`0` **强制全关**（优先级最高） |
| `MOZ_DOM_TRACE_FILE` | 文件路径 | 空 | **总锚点**。设它即自动派生各模块文件（同目录、改前缀） |
| `MOZ_DOM_TRACE_PTYPE` | `parent`/`content`/任意串 | `parent` | 进程类型标签，写进记录 + 文件名 |
| `MOZ_DOM_TRACE_LIMIT` | 整数，`0`=无限 | `0` | 核心 trace 事件上限（不含 jscall） |
| `MOZ_DOM_TRACE_INTERNAL` | `1` / 不设 | 关 | `1` 恢复记录浏览器内部噪声（chrome://、resource:// 等），排查内部行为用 |
| `MOZ_DOM_TRACE_GATE` | 控制文件路径 | 空 | **运行时启停闸门**。设了即受控模式：启动默认暂停，控制文件**存在=开、删除=关**。未设恒开（向后兼容）。配套 session_started/stopped 哨兵 |
| `MOZ_DOM_TRACE_GATE_POLL_MS` | `20`..`5000` | `200` | 后台线程轮询控制文件间隔（ms）。仅受控模式生效 |
| `MOZ_DOM_TRACE_RUN_ID` | 任意字符串 | 内核自动生成 | 采集运行标识，写进记录与文件名，便于多次采集区分。不设则内核自动生成 |
| `MOZ_DOM_COOKIE_TRACE_FILE` / `MOZ_DOM_STORAGE_TRACE_FILE` / `MOZ_DOM_WASM_TRACE_FILE` | 文件路径 | 锚点派生 | 单独把某模块导到别处（一般不用） |

**锚点派生文件**：`trace_process_<pid>`（核心）、`_cookie_`、`_storage_`、`_eval_`、`_event_`、`_descriptor_`、`_wasm_`、`_jscall_`（主力）、`_exception_`。设 `MOZ_DOM_TRACE_FILE` 后这些模块日志自动落到同目录子文件夹（如 `jscall/trace_jscall_process_<pid>.jsonl`），无需单独传 `*_TRACE_FILE`。

> **cookie trace 无痕（无开关）**：cookie 读/写/拒绝/发送在 C++ 网络层 + Document 层插桩，一律传 `cx=nullptr`，不进 JS realm、不抓栈、不调 `JS_ClearPendingException`，`stack` 字段恒 `[]`，页面 JS（含 performance.now 时序检测）无从感知。两种来源都覆盖：HTTP `Set-Cookie`（`source:"http"`）与 `document.cookie=`（`source:"document.cookie"`）。无需任何开关；旧 `MOZ_DOM_COOKIE_TRACE_STACK` 已废弃删除。

### 1.0 eval 源码落盘（JSVMP 破局捷径，match29 实证）

**JSVMP（vmpzl 系）的 VM 执行到业务层时通过 eval 执行"反序列化生成的 JS 源码"——RuyiTrace 的 eval
分类日志记录该 eval 的完整源码并落盘 `logs/eval/eval_<pid>_<seq>_eval-direct.js`**。这意味着对
vmpzl 类混淆，**无需解 LZ 压缩、无需读字节码、无需逐 opcode 反编译**——落盘文件就是解混淆后的
业务源码（match29 实证：46KB 的 29.js 对应 60KB 的 eval 源码，`token = 魔改MD5(path+now+(counter+_$v)+"()"+page)`
直接读出）。

- 自动采集默认产出该分类（`trace_eval_process_*.ndjson` + `eval/` 子目录落盘文件），无需额外开关；
  `--import-after` 导入后核对 `case/ruyi-trace/logs/eval/` 是否落盘目标脚本对应的文件。
- 用法：先 grep eval 源码里的 `token` / `case 64`（vmpzl 编译产物里请求 data 构造在 switch-case 中）
  找参数拼接点，再逆变量赋值链；eval 源码变量名 `_$`+随机但**结构稳定**（相邻 `case` 间固定出现）。
- 页面多脚本全 VM 化（如 `_jquery.js`/`_common.js`/`29.js` 全部 eval 包裹）时，每个脚本对应一份
  eval 落盘文件（按 seq 区分，三份大小分别为 370KB/48KB/60KB 级）。
- 详见规则 39 / 反模式 37 / `cases/yuanrenxue-match29-vmpzl-eval-log-source.md`。

### 1.1 JS 异常 trace（exception）

> GUI 启动默认注入 `TRACE=1` / `LIMIT=0` / `FLUSH_INTERVAL=1`（见 §0）；下表「默认」为内核默认。脚本方式需要异常证据时显式开：`--trace-env MOZ_DOM_EXCEPTION_TRACE=1 --trace-env MOZ_DOM_EXCEPTION_LIMIT=0 --trace-env MOZ_DOM_EXCEPTION_FLUSH_INTERVAL=1`。

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_EXCEPTION_TRACE` | `1` / 不设 | 不设 | JS pending exception trace 主开关，可独立于 `MOZ_DOM_TRACE` |
| `MOZ_DOM_EXCEPTION_TRACE_FILE` | 文件路径 | 锚点派生 | 输出锚点。实际文件在同目录 `exception/trace_exception_process_<pid>.jsonl` |
| `MOZ_DOM_EXCEPTION_LIMIT` | 整数，`0`=无限 | `50000` | 异常事件上限，命中写 `limit_reached` 哨兵 |
| `MOZ_DOM_EXCEPTION_FLUSH_INTERVAL` | `0`..`1000000` | `256` | 每多少条刷盘。进程可能被杀时调小（如 `8`） |
| `MOZ_DOM_EXCEPTION_STACK_FRAMES` | `1`..`64` | `8` | 保存多少帧 `SavedFrame` |
| `MOZ_DOM_EXCEPTION_MAX_STRING_CHARS` | `256`..`131072` | `4096` | message / file / 字符串 preview 的字符上限 |

捕获点在 `JSContext::setPendingException`：记录 `TypeError`/`SyntaxError` 等 `ErrorObject` 类型、message、file、line/column、原生 `JSErrorReport`、已有 `SavedFrame`、`origin_call_id`；可 native unwrap 的 `DOMException`/`Exception` 额外输出 `native_exception_*`。不读 JS 属性、不触发 getter、不调用 `toString`、不构造 `Error.stack`。

## 2. JS 调用 trace（jscall）—— 逆向加密算法主力

### 2.1 开关与文件

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_JSCALL_TRACE` | `1` / 不设 | 不设 | jscall 主开关（可独立于 `MOZ_DOM_TRACE`） |
| `MOZ_DOM_JSCALL_TRACE_FILE` | 文件路径 | 锚点派生 | 输出文件（设了也会开 jscall） |
| `MOZ_DOM_JSCALL_LIMIT` | 整数，`0`=无限 | `50000` | 事件上限。逆向常设 `0`；命中写 `limit_reached` 哨兵 |
| `MOZ_DOM_JSCALL_FLUSH_INTERVAL` | `0`..`1000000` | `256` | 每多少条刷盘。进程可能被杀时调小（如 `8`），勿设 `1` |
| `MOZ_DOM_JSCALL_SUMMARY_INTERVAL` | `1`..`1000000` | `256` | 每多少条输出汇总统计行 |

### 2.2 抓哪些调用

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_JSCALL_NATIVE` | `1` / 不设 | 关 | `1` 连原生 builtin 调用也记 |
| `MOZ_DOM_JSCALL_SELFHOSTED` | `1` / 不设 | 关 | `1` 连 self-hosted（Array.map 等）也记 |
| `MOZ_DOM_JSCALL_TARGET_ONLY` | `1` / 不设 | 关 | `1` 只记命中 detail 过滤器的目标函数及子调用，**大幅降噪** |
| `MOZ_DOM_JSCALL_SCRIPT_URL` | 逗号/分号分隔 URL 子串 | 空 | **记录范围过滤**：调用方或被调方 URL 命中才记；大小写敏感，非 regex/glob |
| `MOZ_DOM_JSCALL_SCRIPT_URL_EXCLUDE` | 逗号/分号分隔 URL 子串 | 空 | **记录范围排除**：调用方或被调方 URL 命中即不记；优先级高于 include |

> `SCRIPT_URL*` 只过滤 jscall 记录范围，不触发 detail；`DETAIL_SCRIPT_URL` 才抓参数/返回值真值。`TARGET_ONLY` 仍按 detail 命中树裁剪。

**例子**：
- 只看单脚本：`MOZ_DOM_JSCALL_SCRIPT_URL=target.js`
- 多 token：`MOZ_DOM_JSCALL_SCRIPT_URL=challenge.js;static/crypto,cdn-cgi/challenge-platform`
- 排除噪声：`MOZ_DOM_JSCALL_SCRIPT_URL_EXCLUDE=analytics;telemetry;sentry`
- include+exclude：`MOZ_DOM_JSCALL_SCRIPT_URL=challenges.cloudflare.com;target.js` + `MOZ_DOM_JSCALL_SCRIPT_URL_EXCLUDE=analytics;vendor/noise.js`
- 记录范围 + 抓真值：`MOZ_DOM_JSCALL_SCRIPT_URL=target.js` + `MOZ_DOM_JSCALL_DETAIL_SCRIPT_URL=target.js`

### 2.3 detail 过滤器（抓参数+返回值真值，四者 OR）

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_JSCALL_DETAIL_FUNCS` | 逗号分隔函数名 | 空 | 按函数名定向，如 `encrypt,sign`。命中者强制深抓不截断 |
| `MOZ_DOM_JSCALL_DETAIL_URL_CONTAINS` | 逗号分隔 URL 子串 | 空 | 调用方/被调方 URL 含子串则抓（旧式，需配函数名） |
| `MOZ_DOM_JSCALL_DETAIL_SCRIPT_URL` | 逗号分隔 URL 子串 | 空 | **按脚本来源整体抓**，不需预知函数名。锁单脚本逆向用 |
| `MOZ_DOM_JSCALL_DETAIL_SHA256` | 逗号分隔 sha256 | 空 | 按源码 sha256 抓，对付 URL 不稳定的动态/混淆脚本。**基准=源码 UTF-8 字节**（Latin1/UTF-16 都转 UTF-8 再算），与外部 `sha256sum`/`certutil` 一致 |

### 2.4 序列化深度/大小

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_JSCALL_SHALLOW` | `1` / 不设 | 关 | `1` 浅序列化（保留标量+TypedArray/Array，普通对象塌缩）。降热函数开销、**避免拖慢 VM 触发反爬** |
| `MOZ_DOM_JSCALL_SHALLOW_DEPTH` | `0`..`12` | `0` | 浅序列化下普通对象递归层数。`2` 够看多数嵌套 |
| `MOZ_DOM_JSCALL_MAX_VALUE_BYTES` | `256`..`131072` | `65536` | 单值序列化字节上限 |
| `MOZ_DOM_JSCALL_DEEP_LONG_STR` | `512`..`131072`，`0`=关 | `0` | 长字符串整体抓的触发阈值，让长密文（HMAC hex）不被截断 |

### 2.5 opcode 级 trace（看穿自建字节码 VM / jsvmp）

下沉到逐 JS 字节码 op。**双层覆盖**：C++ 解释器（带栈值）+ Baseline JIT（仅 pc+op，`tier` 字段区分）。

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_JSCALL_OPCODE_URL` | 逗号分隔 URL 子串 | 空 | **opcode trace 总开关**。务必收窄单脚本，量极大 |
| `MOZ_DOM_JSCALL_OPCODE_PC_START` | 整数 | `0` | 只 trace PC ≥ 此值的 op（配 `_END` 锁字节码片段） |
| `MOZ_DOM_JSCALL_OPCODE_PC_END` | 整数，`0`=不限 | `0` | 只 trace PC ≤ 此值的 op。`_END > _START` 时窗口生效 |
| `MOZ_DOM_JSCALL_OPCODE_STACK` | `1` / 不设 | 关 | `1` 每条 op dump 栈顶值（**仅解释器层有值**）。看 SetElem 的 index/value 用 |
| `MOZ_DOM_JSCALL_OPCODE_STACK_SLOTS` | `1`..`32` | `3` | 抓栈顶几槽。SetElem 需 3；Call 抓到数组参数需调大 |
| `MOZ_DOM_JSCALL_OPCODE_STACK_FULL` | `1` / 不设 | 关 | `1` 栈槽深序列化（不截断）。抓内层 cipher 完整密钥+明文用，**爆量主因，必配 PC 窗口** |
| `MOZ_DOM_JSCALL_OPCODE_LIMIT` | 整数，`0`=无限 | `0` | opcode 事件上限（独立于 jscall） |
| `MOZ_DOM_JSCALL_OPCODE_OPERANDS` | `1` / 不设 | 关 | `1` 每条 op 带 `operands`（解码立即数：local 槽号/常量/jump 偏移/atom 名/字符串）。**认出 VM 的 pc/栈指针/key 槽的关键**，解释器/JIT 两层都带 |

### 2.6 vm_step —— VM 指令层（jsvmp 还原核心）

把派发循环里几十条宿主 op 折叠成一条 VM 指令记录。核心产出 `(vm_pc, op_byte, vm_pc_next)`，对所有 jsvmp 通用。**手动声明三槽**（金标准）或 **autodetect 自动锁**（省心）。

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_JSVMP_TRACE` | `1` / 不设 | 关 | vm_step 总开关 |
| `MOZ_DOM_JSVMP_SCRIPT_URL` | 逗号分隔 URL 子串 | 空 | **脚本过滤（必填）**，否则任意脚本误命中产垃圾 |
| `MOZ_DOM_JSVMP_AUTODETECT` | `1` / 不设 | 关 | **自动检测派发器**，免声明 DISPATCH_PC/PC_SLOT，落 `vm_dispatch_detected`。解 CF 每会话 pc 漂移。锁定后须 tier-pin 才能持续产 step（见底部限制） |
| `MOZ_DOM_JSVMP_MAX_DISPATCH` | `1`..`12` | `1` | autodetect 最多锁几个派发器。CF 9 并列派发器设 `9` |
| `MOZ_DOM_JSVMP_DISPATCH_PC` | 整数（宿主 pc） | 无 | 取字节那条 `GetElem` 的 pc。**autodetect 时可省** |
| `MOZ_DOM_JSVMP_PC_SLOT` | 整数（槽号） | 无 | VM pc 所在宿主槽。**autodetect 时可省** |
| `MOZ_DOM_JSVMP_PC_KIND` | `arg` / `local` | `local` | PC_SLOT 是实参还是局部。CF VM 在 `arg` |
| `MOZ_DOM_JSVMP_KEY_SLOT` | 整数（槽号） | 无 | **可选**。rolling key 槽。仅 CF 式有独立 key 槽才声明 |
| `MOZ_DOM_JSVMP_KEY_KIND` | `arg` / `local` | `local` | KEY_SLOT 是 arg 还是 local |
| `MOZ_DOM_JSVMP_BRANCH_PC` | 整数（宿主 pc） | 无 | VM 派发比较 op 的 pc，产 `vm_branch{lhs,rhs,cmp,taken}`（全比较族）。**autodetect 时可省** |
| `MOZ_DOM_JSVMP_DUMP_BYTECODE` | `1` / 不设 | 关 | `1` 首次 dispatch 时整段 dump 字节码数组（`vm_bytecode` hex，≤1MB）。对拍联网换回+解密的 main VM |
| `MOZ_DOM_JSVMP_CONST_SLOT` | 整数（槽号） | 无 | **可选**。VM 常量表槽，dump 一条 `vm_const{values}`（opcode→语义映射，≤4096 元素） |
| `MOZ_DOM_JSVMP_CONST_KIND` | `arg` / `local` | `local` | CONST_SLOT 是 arg 还是 local |
| `MOZ_DOM_JSVMP_MIN_BYTECODE` | 整数（字节数） | `0`=不限 | **autodetect 滤噪**。只喂字节码长度 ≥ 此值的 GetElem，滤掉重混淆站点的短循环。真 VM 设 64/128 |
| `MOZ_DOM_JSVMP_MIN_HITS` | 整数 >0 | `6` | **autodetect 滤噪**。候选最少命中数。检测只在解释器（~10 圈即 tier-up），设 >10 反锁不到 |
| `MOZ_DOM_JSVMP_MIN_SPAN` | 整数（下标跨度） | `0`=不限 | **autodetect 滤噪（最有效）**。候选下标跨度 ≥ 此值才锁并按跨度择优。真 VM 跨度大、噪声循环抖动小。设 200 |
| `MOZ_DOM_JSVMP_OBSERVE_OPS` | 整数 >0 | `2000` | 仅 MIN_SPAN 模式生效：锁定前观察窗口，让真 VM 积累够跨度再择优 |
| `MOZ_DOM_JSVMP_LIMIT` | 整数，`0`=无限 | `0` | vm_step 事件上限 |

## 3. WASM trace（编译期静态反汇编，对时延安全）

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_WASM_DUMP` | `0` / 不设 | 开 | 模块反汇编 dump 开关（默认开，`0` 关） |
| `MOZ_DOM_WASM_DUMP_MAX` | 字节数 | `8388608`(8MB) | 单模块 dump 上限 |
| `MOZ_DOM_WASM_DUMP_TOTAL` | 字节数 | `134217728`(128MB) | 所有模块累计上限 |
| `MOZ_DOM_WASM_INSN` | `1` / 不设 | 关 | 指令级 trace（逐函数反汇编）开关 |
| `MOZ_DOM_WASM_INSN_FUNC_INDEX` | 函数索引，`-1`=全部 | `-1` | 只反汇编指定函数 |
| `MOZ_DOM_WASM_INSN_MAX_FUNCS` | 整数，`0`=无限 | `0` | 最多反汇编几个函数 |
| `MOZ_DOM_WASM_INSN_MAX_BYTES` | 字节数 | `1048576`(1MB) | 单函数反汇编上限 |

**字节获取边界（match20 实测，别在拿不到字节上空耗）**：

- 页面用 `WebAssembly.instantiateStreaming(fetch(...))` 时，trace 只记 `imports_resolve` / `instantiate` 元数据（imports/exports 清单、funcCount），`dumped:false, dumpReason:"no_bytes"`（compile start 阶段）或 `"metadata_only"`（success 阶段）——**流式源拿不到完整模块字节**，`byteLength:0`/`sha256` 为空是设计行为不是故障。
- ruyipage 网络层落盘的 wasm（bodies/wasm/ 或 forensic/wasm/）在旧版库层经 UTF-8 replace 文本化（FFFD×数千），二进制不可逆损坏、无法编译；2.3.86 起 `forensic_ruyipage.py` 已改走 BiDi base64 无损通道（记录带 `response_body_lossless: true`），**旧产物里的 wasm 落盘文件默认应视为损坏**。
- 结论：需要可执行的 wasm 字节时，按 `references/network/dynamic-resource.md` 的运行时二进制拉取纪律（HTTP 客户端直拉 + 魔数/hash 校验），不要试图从 trace 或旧抓包产物里恢复字节。

## 4. 全量事件 trace（异步 C++ 写入）

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_EVENT_TRACE_FULL` | `1` / 不设 | 关 | 全量异步事件 trace。需总开关 `MOZ_DOM_TRACE=1` 与输出锚点 |

输出：`<锚点目录>/event/trace_event_process_<pid>.jsonl`。覆盖 14 类原生事件：`mousemove/mousedown/mouseup/click`、`pointermove/pointerdown/pointerup`、`keydown/keypress/keyup`、`touchstart/touchmove/touchend`、`wheel`。

- `event_dispatch`：14 类全部记录；`listener_call` 通过 `event_id` 关联当前派发。
- 完整 Listener：点击、按键、Pointer down/up、Touch start/end；**1/32 采样**：`mousemove`/`pointermove`/`touchmove`/`wheel`（高频事件降采样，避免爆量）。
- 强制保留：慢调用、异常、`preventDefault()`、停止传播（即使命中 1/32 降采样也一定落盘）。
- 写入：事件线程非阻塞入队，Writer 线程批量写文件；队列约 8 MiB/进程，锁竞争/队列满/记录超限时丢弃最新记录。
- 统计：搜 `kind:event_trace_stats` 检查 `dropped` 与 `high-watermark`。
- 关闭：移除 `MOZ_DOM_EVENT_TRACE_FULL` 恢复原有采样行为；`MOZ_DOM_TRACE_GATE=0` 停止接收并 drain/flush 已入队记录。

> 用途：验证码轨迹还原（鼠标/触摸/按键时序）、交互事件链定位。事件 trace 与 jscall 独立，量较大，按需开。

## 5. HTTP 报文 / WebSocket 帧（C++ 网络层，无痕）

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_HTTP_PACKET_TRACE` | `0` / 非 `0` | 开 | HTTP 报文 trace（非 `0` 即开） |
| `MOZ_DOM_HTTP_PACKET_TRACE_DIR` | 目录路径 | 锚点目录 | HTTP 报文输出目录 |
| `MOZ_DOM_WS_TRACE` | `1` / 不设 | 关 | **WebSocket 帧 trace 总开关**。对页面 JS 完全无痕，抓解压/掩码前真实明文 |
| `MOZ_DOM_WS_MAX_BYTES` | `256`..`16777216` | `65536` | 单帧 payload 字节上限 |

## 6. 使用建议

**先判题型，再选最小开关组合——不要一上来全开。**

GUI 内置两个层次的现成组合（源码确认）：

- **「常规采集」快捷开关**（GUI 一键，日常推荐）：`MOZ_DOM_TRACE=1` + `JSCALL_TRACE=1` + `JSCALL_LIMIT=0` + `JSCALL_FLUSH_INTERVAL=8` + `JSCALL_SHALLOW=1` + `HTTP_PACKET_TRACE=1` + `EXCEPTION_TRACE=1` + `EXCEPTION_LIMIT=0` + `EXCEPTION_FLUSH_INTERVAL=1`。
- **题型预设**：A 加密函数（另加 `SHALLOW_DEPTH=2`、`MAX_VALUE_BYTES=131072`）、B 脚本整体抓值、C opcode 看穿 VM（`STACK=1`+`STACK_FULL=1`+`STACK_SLOTS=4`，必补 `OPCODE_URL` 与 PC 窗口）、D 反爬 VM(Turnstile)（`TARGET_ONLY=1`+`DETAIL_SCRIPT_URL=challenges.cloudflare.com`+`SHALLOW=1`）、E 重型 JSVM 定位（`OPCODE_LIMIT=4000000` 做硬保险）、F WebSocket 帧、jsvmp autodetect（含 `MIN_BYTECODE=128`+`MIN_SPAN=200`）。

| 场景 | 推荐开关组合 |
|---|---|
| **逆向某加密函数**（知道函数名） | `JSCALL_TRACE`+`TARGET_ONLY`+`DETAIL_FUNCS=xxx`+`SHALLOW`+`LIMIT=0` |
| **只缩小 jscall 范围** | `JSCALL_TRACE`+`JSCALL_SCRIPT_URL=xxx`+`SHALLOW`+`LIMIT=0` |
| **不知函数名 / 名字被混淆** | `JSCALL_TRACE`+`JSCALL_SCRIPT_URL=xxx`+`DETAIL_SCRIPT_URL=xxx`+`SHALLOW`+`DEEP_LONG_STR=512` |
| **排除无用 JS** | `JSCALL_TRACE`+`JSCALL_SCRIPT_URL_EXCLUDE=analytics;telemetry` |
| **看穿自建字节码 VM** | `JSCALL_TRACE`+`OPCODE_URL=xxx`+`OPCODE_STACK`+`OPCODE_OPERANDS`+`OPCODE_LIMIT` |
| **反爬 VM（Turnstile 等时延敏感）** | `JSCALL_SCRIPT_URL=xxx`+`DETAIL_SCRIPT_URL=xxx`+`SHALLOW`，**带 JIT 跑（勿禁）**，避免深序列化 |
| **还原 jsvmp 指令流**（已知槽） | `JSVMP_TRACE`+`SCRIPT_URL`+`DISPATCH_PC`+`PC_SLOT`(+`KEY_SLOT`/`BRANCH_PC`/`DUMP_BYTECODE`/`CONST_SLOT`) |
| **还原 jsvmp（不知槽，自动）** | `JSVMP_TRACE`+`SCRIPT_URL`+`AUTODETECT`(+重混淆站点加 `MIN_BYTECODE=128`+`MIN_SPAN=200`) |
| **抓 WebSocket 帧** | `TRACE_FILE`+`WS_TRACE=1` |
| **区分 WindowProxy 来源**（iframe/子窗口的 global 归属） | HTTP 打开官方 `verify/windowproxy_keys.html?auto=1` + `JSCALL_NATIVE=1` + `JSCALL_SCRIPT_URL=windowproxy_keys.html` + `DETAIL_SCRIPT_URL=windowproxy_keys.html`；日志里看 `args[0].object.relation_to_caller` / `browsing_context_id`（官方随包 cheatsheet 提供） |
| **运行时启停（启动后再开、随时停）** | 任意采集组合 + `TRACE_GATE=<控制文件>`；`ni 文件`=开、`del 文件`=关，产 `session_started/stopped` 哨兵 |

**关键纪律：**

1. **先收窄再开量大的开关**：普通 jscall 噪声用 `JSCALL_SCRIPT_URL` / `JSCALL_SCRIPT_URL_EXCLUDE` 收窄；`OPCODE_*` / `JSVMP_*` 必配 `SCRIPT_URL`/`OPCODE_URL` 锁单脚本，否则 GB 级日志撑爆盘。
2. **opcode 爆量防护**：`OPCODE_STACK_FULL` 必配 PC 窗口（`PC_START`/`PC_END`）+ `OPCODE_LIMIT`，并在驱动侧监控日志大小，超阈值杀浏览器。
3. **反爬站勿禁 JIT、勿深序列化**：会拖慢 VM 触发时序检测/重试。用 `SHALLOW`。栈值只在解释器层有，反爬站靠热循环仍走解释器的部分抓。
4. **vm_step 全程覆盖需 tier-pin**（仅离线对拍）：hook 只在 C++ 解释器 + Baseline Compiler；要全程不断流加 `JIT_OPTION_baselineInterpreterWarmUpThreshold=0` + `JIT_OPTION_normalIonWarmUpThreshold=2000000000`。真实 solve 慎用（会被时序 flag）。**pref/user.js 形式时，baseline interpreter 的 pref 名是 `javascript.options.blinterp`，不是 `baseline_interpreter`**（match24 实证：写错名导致热身函数逃进 blinterp、opcode trace 在 3 个输出后断流，带栈采集全程失败；三层 pref = `javascript.options.blinterp=false` + `baselinejit=false` + `ion=false`，配合 JIT_OPTION 形式等价）。
5. **手动声明 pc 是金标准，autodetect 是省心增强**：mini-VM/已知结构用手动（byte-exact 可靠）；CF 这种每会话 pc 漂移用 autodetect。
6. **进程可能被杀就调小 `FLUSH_INTERVAL`**（如 `8`）防丢缓冲。
7. 所有**配置**开关启动时读一次，运行中改无效；多进程各写带 `<pid>` 的文件。**例外**：`TRACE_GATE` 受控模式下「开/关」可运行时翻转（控制文件存在性），但「录什么」仍启动定死。
8. 跨模块用 `origin_call_id` 串数据流（「哪次调用读了哪些指纹/写了哪个 cookie」）。启用 `JSCALL_SCRIPT_URL*` 会让未记录调用不分配 `call_id`，parent/depth/summary/origin_call_id 树会被压缩。
9. **运行时启停（`TRACE_GATE`）不替代收窄纪律**：能随时停 ≠ 可以全开等手动停——关之前的 1~2 秒足以让 `STACK_FULL` 写出 GB；`OPCODE_LIMIT` 仍是硬保险。闸门对 JIT 安全（不重编、无卡顿），可放心用于真实反爬站。

### 6.1 折叠/省略（elision）与调用计数反推（match23 实证）

RuyiTrace 对重复调用序列有折叠行为（parent_elide_reason 一类），读数时注意两条铁律：

- **"只出现过一次" ≠ "只调用过一次"**。match23 中 md5 实际被调用 2 次（加法器 S 调用 543 ≈ 2×260），但 charCodeAt 读数会话只记录 1 组——凭读数会话数推断调用次数会误判输入被截断。
- **判断真实调用次数/输入规模，用未被折叠的下游函数计数反推**：轮函数/加法器/编码器这类每次哈希必调 N 次的函数，`总调用数 ÷ 单次用量 ≈ 真实调用次数`；`charCodeAt` 读数条数 × 常数 只能当输入长度的下界。

folded 与 unfolded 记录同批导出时，优先用 `parent_elide_reason` 字段识别折叠点，把"缺失的重复段"还原成计数而非逐条展开。

### 6.2 带栈对拍：STACK_SLOTS 盲区 + 逐位 XOR 判分布（match24 实证）

**STACK_SLOTS 盲区**：`OPCODE_STACK_SLOTS` 只 dump 栈顶 N 槽，**栈深 >N 槽处的算术对拍时看不到**。match24 里"值 65 从未出现在任何栈转储中"——因为它的计算发生在栈深 >6 槽处（STACK_SLOTS=6 的盲区）。要读深层算术，把 `STACK_SLOTS` 提到 ≥12 或开 `STACK_FULL`，**同时用 `TRACE_GATE` 把窗口收窄到 click→build 这段**防爆量（`STACK_FULL` 全开是 GB 级日志主因）。

**逐位 XOR 判分布（沙箱 vs 浏览器对拍的破局手法）**：黑盒沙箱与浏览器 trace 对拍不一致时，不要只做逐位相等比较，**先把两侧中间输出（VM 状态数组/字节流/token 分段）做逐位 XOR/差值，看分布**。判读三种形态：

- 差值是**常数**（match24：状态数组 TL[11..] 起恒差 `XOR 30`）= 一次性注入的状态偏移 → 在 VM 输出上**就地修正**（逐元素 XOR 常数），不必再逐环节对齐环境。
- 差值**逐步发散** = 链式差异 → 才需要逐环节对齐（见反模式 23）。
- 位置 **a/b 两值互换**（match24 实测 K[7]=123↔101、K[12]=101↔123）= 密钥流/常量表的**枚举序或索引来源**不同，不是算术不同——核对生成器的索引/计数器初值来源，比追算术链快。
- 差值是**同字符位置敏感 vs 位置无关**的算法级差异（match24 第三轮误判"诱饵编解码器"：MCP 看浏览器 '/'→7×6 查表式、沙箱位置依赖算术）——**先核对两侧样本是否同一状态**（同页码/同构建序号/同缓存代数，反模式 33），跨构建混对比会把"缓存状态差"误读成"算法不同"。

这是 opcode/带栈 trace 的典型收口用途：带栈采集拿到两侧完整中间态后，逐位 diff 一步就能把"未知环境分歧"降维成"一个常量"。详见 `cases/yuanrenxue-match24-jsvmp-blackbox-tl-xor30.md`。

**带栈采集的前置条件（tier-pin）**：opcode 记录里 `tier=jit` 的条目**只有 pc 没有栈值**（match24 实测 325 万条里仅 91 条 interp 带值）——要拿带栈指令流，必须先把热函数钉在纯解释器：三层 pref `javascript.options.blinterp=false` + `baselinejit=false` + `ion=false`（blinterp 名勿写错，见 §6 纪律 4）。pref 注入见 §0「GUI/ruyipage 会重写 user.js」条目：直启或 `capture_ruyitrace_log.js --pref`。

## 7. 运行时启停闸门（TRACE_GATE）

浏览器**启动后再开始、随时结束** trace，只抓关心的窗口（如手动点验证码那一刻）。配置（录什么）仍走 env 启动定死；闸门只翻「此刻落不落盘」一个布尔位。

| 开关 | 可选值 | 默认 | 功能 |
|---|---|---|---|
| `MOZ_DOM_TRACE_GATE` | 控制文件路径 | 空 | 设了即受控模式：启动默认暂停，控制文件**存在=开、删除=关**。未设恒开（向后兼容） |
| `MOZ_DOM_TRACE_GATE_POLL_MS` | `20`..`5000` | `200` | 后台线程轮询控制文件间隔（ms） |

**约定**：启动时控制文件已存在=即开；否则暂停等文件出现。`MOZ_DOM_TRACE=0` 仍优先级最高强制全关。

**操作流**（PowerShell）：
```
set MOZ_DOM_JSCALL_TRACE=1
set MOZ_DOM_JSCALL_TRACE_FILE=C:\out\jscall.jsonl
set MOZ_DOM_JSVMP_TRACE=1
set MOZ_DOM_JSVMP_SCRIPT_URL=challenges.cloudflare.com
set MOZ_DOM_JSVMP_AUTODETECT=1
set MOZ_DOM_TRACE_GATE=C:\out\trace.on
firefox.exe
```
启动→加载噪声全程暂停一条不写 → 目标时刻 `ni C:\out\trace.on`（开闸）→ 跑完 `del C:\out\trace.on`（关闸）。
反复开关得 session 1/2/3，挑配对完整的那段对拍。

**session 哨兵**：开/关边沿写 `session_started`/`session_stopped`{session:N}，立即 flush，同落核心+jscall 文件。关闸先 flush 缓冲再写哨兵。补齐「区分跑完/被截断/被杀」第三种=被人主动停。续写同一文件靠 `session` 字段区分，不切文件。`limit` 哨兵进程级跨 session 累计、不重置。

**要点**：
- JIT 安全——hook 编译期照常铺设，闸门只在 emit 最外层 gate，关时空跑、开时即时生效，无需重编、无卡顿。
- 时延安全——独立后台线程轮询控制文件，**绝不在热路径 stat**；热路径只读一个 atomic。
- 只做**全局总启停**（所有已配置模块同开同关）；脚本级收窄用 `OPCODE_URL`/`SCRIPT_URL` 配置层覆盖。
- HTTP 报文 / WS 握手暂不受闸门控制；WS **数据帧**受控制。
- **官方实测背书**（随包 cheatsheet）：噪声页面关 6s→开 5s→关 6s，窗口内 372 条记录 seq 全落在 started(1)/stopped(375) 之间、零泄漏，时间跨度 4.95s ≈ 5s 窗口；对照无闸门组各项 ≈5/17 比例，跨 8 个进程哨兵均正确配对——闸门边沿的 session 哨兵可用于挑配对完整的对拍窗口。
- **脚本方式**：`capture_ruyitrace_log.js --gate --gate-after <ms> --gate-duration <ms>` 自动管理控制文件（启动即暂停 → 到点开闸 → 开窗结束自动关闸），开窗期间需交互时用 ruyipage 挂到该浏览器驱动，见 ruyi-tooling.md「闸门窗口 + 外部驱动采集」。

## 8. Stderr warning 分诊（外部脚本）

`JavaScript warning:` on stderr is not a trace failure. A known example:

```text
https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q=shoes
```

with:

```text
[stderr] JavaScript warning: <url>, line 1: unreachable code after return statement
```

This is a SpiderMonkey page-script warning. Treat `[DOMTrace] ERROR:` as trace failure; do not fail automation only because stderr contains `JavaScript warning`.（外部仓库提供 `domtrace_stderr_classifier.py` 做分诊，本 skill 未随包含该脚本，按上述规则手动分诊即可。）

## 9. `--fpfile` 启动参数：指纹定制 + SOCKS5 认证（必须等号形式）

`--fpfile=<path>` 指向 profile 目录下的 `fingerprint.fp`，**必须等号形式**（`--fpfile C:\path` 空格分隔会让 SOCKS5 只发 `methods=00` 不带凭据；等号形式发 `methods=02` 完成 RFC1929 认证）。文件为逐行 `key<sep>value`：

- **指纹定制字段**（约 100 项，GUI「指纹」页同源，源码 `browser-fingerprint-schema.json`）：WebRTC IP（`local_webrtc_ipv4=` 等，分隔符 `=`）；时区/语言（`timezone:Asia/Shanghai`）、字体、`useragent`、`hardwareConcurrency`、屏幕宽高、Canvas seed（`canvas:<seed>`）、WebGL 全套（vendor/renderer/max_* /shader_precision/扩展列表）、WebGPU 全套（vendor/architecture/limits.*）、触控（`touch.*`、`maxTouchPoints`）——分隔符 `:`。
- **SOCKS5 认证**：`socksauth.host=` / `socksauth.port=` / `socksauth.username=` / `socksauth.password=` 四行（旧版独立 `proxy.fp` 在 GUI 内已合并进同一 fpfile）。国内站点默认直连，代理是边缘场景。

配套 `user.js`（proxy prefs，GUI 自动写入）：

```js
user_pref("network.proxy.type", 1);
user_pref("network.proxy.socks", "<proxy_host>");
user_pref("network.proxy.socks_port", 1080);
user_pref("network.proxy.socks_version", 5);
user_pref("network.proxy.socks_remote_dns", true);
user_pref("network.proxy.no_proxies_on", "localhost,127.0.0.1");
```

启动（等号形式）：

```bat
firefox.exe --new-instance -no-remote -profile C:\path\profile --fpfile=C:\path\profile\fingerprint.fp "https://example.com/"
```

## 10. 启动时 API 定制速查（`MOZ_DOM_API_*`）

启动 Firefox 前设置，进程内首次命中相关 API 时读取一次；默认不设 `MOZ_DOM_API_OVERRIDE` 时完全原生。对拍 / 复现实验用；真实取证保持默认，避免指纹基线被固定值污染。

覆盖项：`Date.now()` / `new Date()` / `Date()`、`Math.random()`、`crypto.getRandomValues()`、`performance.now()`。

| 开关 | 值 |
|---|---|
| `MOZ_DOM_API_OVERRIDE` | `1` 开启 API override；`0` 或不设为全原生 |
| `MOZ_DOM_API_DATE_NOW` | `native` / `fixed:<ms>` / `increment:<start_ms>:<step_ms>` / `sequence:<ms1>,<ms2>` |
| `MOZ_DOM_API_PERFORMANCE_NOW` | `native` / `fixed:<ms>` / `increment:<start_ms>:<step_ms>` / `sequence:<ms1>,<ms2>` |
| `MOZ_DOM_API_MATH_RANDOM` | `native` / `fixed:<0..1>` / `sequence:<v1>,<v2>` / `seeded:<seed>` |
| `MOZ_DOM_API_CRYPTO_RANDOM_VALUES` | `native` / `seeded:<seed>` / `increment:<0..255>` / `pattern:<hex>` |

四项全开调试组合：

```bat
set MOZ_DOM_API_OVERRIDE=1
set MOZ_DOM_API_DATE_NOW=fixed:1700000000000
set MOZ_DOM_API_PERFORMANCE_NOW=increment:1000:16.6667
set MOZ_DOM_API_MATH_RANDOM=seeded:0x123456789abcdef0
set MOZ_DOM_API_CRYPTO_RANDOM_VALUES=seeded:0xfedcba9876543210
firefox.exe
```

Cloudflare/挑战页默认建议：不需要就别设 `MOZ_DOM_API_OVERRIDE`；时间类优先 `native` 或 `increment`，不要长期 `fixed`；随机类优先 `seeded`；只开启当前需要 trace 的 API。

参数语义细节（源码确认）：`sequence` 最多读取 32 个值，耗尽后重复最后一个；`pattern` 支持连续十六进制或逗号分隔，最多读取 64 字节并循环填充；`seed` 支持十进制或 `0x` 十六进制；`performance.now` 覆盖后仍保持非负、不倒退；`crypto.getRandomValues` 保持返回原 TypedArray。
