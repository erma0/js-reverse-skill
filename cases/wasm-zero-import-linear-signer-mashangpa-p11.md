# Case：零导入确定性 wasm 线性混合签名 + 数据窗轮换（码上爬平台题11）

> 难度：★★
> 还原方案：C WASM 加载（黑盒直接实例化）+ A 纯算等价式作改版探针
> 实现语言：Node.js
> 最后验证日期：2026-09-19
> 平台类型：码上爬（mashangpa.com）题十一「wasm小试牛刀」，标签 wasm，难度"中等"

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`pagination{N}.js` 由入口页内联块 `script.src = "/static/js/pagination" + problemId + ".js"` 按题号加载；文件带 `var _js='jsjiami.com.v7'` + `version_ = 'jsjiami.com.v7'` 双端标记（ob-io 家族 + self-defending）
- 装载特征：入口页内联块 `if (problemId === 11) { … fetch("/static/wasm/encrypt.wasm") … window.exports = instance.exports; }`，并预构造 `info = {env:{memory,table,stackAlloc/stackSave/stackRestore}, wasi_snapshot_preview1:{}}` —— **这套导入对象是无效装饰**（wasm 零导入且自导出 `memory`）
- 参数特征：Query 三件套 `page`（明文序号）+ `m`（wasm 输出，9~10 位有符号十进制整数）+ `_ts`（**秒级** unix 时间戳，非毫秒）
- 请求特征：`GET /api/problem-detail/11/data/?page=N&m=&_ts=`，响应 `{problem, pagination:{num_pages:20, number}, current_array:[10 个整数]}`；提交 `POST /problem/11/submit/`（multipart，字段 `csrfmiddlewaretoken` + `user_answer`，头 `X-CSRFToken`）
- 反调试特征：`setInterval(()=>{…},0x3e8)` 体内含 `'bugger'`/`Function(...)` 构造的 self-defending 分支，且该分支里有一条**引用未定义变量的假 `fetch(...)` 调用**（形似签名 writer）
- 无效引入特征：`crypto-js.js`（91728B）被页面无条件 `<script src>` 引入但零引用（与题1/题7 同）

## 加密方案

- 路径：C WASM 黑盒（权威签名源）+ A 纯算等价式（仅作站点改版探针）
- 框架：不使用（`WebAssembly.Module.imports()` 为空 → Node 原生 `new WebAssembly.Instance(mod, {})` 直接执行，无补环境）
- TLS 客户端：Node 原生 `https` + `Agent({keepAlive:true})`（无指纹需求，实测未触发连接层拦截）
- 核心思路：`m = exports.encrypt(page, _ts)`，本次证据反推等价式 **`m = (16358 + page + trunc(_ts / 3)) | 0`**；答案 = 20 页 `current_array` 全元素求和，须在**同一次运行内**算完立即提交（数据按时间窗轮换）。
- 定位方法（无 RuyiTrace 时的等价取证，三步闭合）：
  1. **真机 oracle 表**：取证浏览器内直调 `window.exports.encrypt`，固定一个变量扫另一个（page∈{1,2,3,20,21,100} × ts∈{…297,…298,1700000000,1,0} = 30 组），一次拿全参数语义与取整方向；
  2. **本地同 wasm 执行**：落盘 wasm 字节在 Node 实例化，与 30 组真机值逐位对拍（本次 30/30 一致）+ 服务端 200 真实请求三元组复核（本次 4/4 一致）；
  3. **算式对拍**：等价纯算式 × wasm 输出做全量随机+边界扫描（本次 4280/4280 一致）→ 才允许写"算法已还原"。

## 踩坑记录

1. **坑：把 wasm 响应体当文本取回，二进制被静默破坏** → 正确做法：取证浏览器响应体走的是文本通道，wasm 落盘 241B（真值 229B，含 6 处 `EF BF BD`），PNG 同样损坏。必须页内 `fetch → arrayBuffer → btoa(String.fromCharCode(...))` 取 base64，落盘后校验魔数 `\0asm` 且能被 `WebAssembly.Module` parse。`forensic_ruyipage.py` 已内置无损通道（`_raw_body_from_packet`），**手写驱动前先读它的兼容补丁清单**（规则 46）。
2. **坑：`page.add_preload_script()` 抛 `privileged scope` 就判"本环境无 hook 能力"，放弃 writer 栈证据** → 正确做法：根因是 `FirefoxBase.add_preload_script` 无条件传 `contexts`；底层 `_bidi.script.add_preload_script(driver, fnDecl)` 不传即成功，且实测落**页面主 world**（规则 44 / 反模式 11 第六形态）。本次为此白跑三轮。
3. **坑：`browser.new_tab()` 后 `run_js` 打在失效 frame（`no such frame`），`browser.latest_tab` 又可能指回 `about:home`，于是把"空 realm 里没有该对象"当成页面行为**（本次把 `loadPage is not defined`、`anchors: []` 误读成页面结构，白跑两轮）→ 正确做法：用 `browser.latest_tab or browser.new_tab()`；每次 `run_js` 前先读 `location.href` 自检 realm，出现 `about:` 前缀立即停手重取句柄。
4. **坑：按字面量搜 `fetch(` 找 writer，命中 jsjiami self-defending 分支里的假 fetch** → 正确做法：真 writer 是被 entry 调用的具名小函数（`callEncryptFunction` → `window['exports']['encrypt']`）；陷阱分支特征是引用大量未声明变量与 `Function(...)` 构造。
5. **坑：`callEncryptFunction` 用 try/catch 吞 wasm 异常**，wasm 未装载完就翻页时 `m` 变 `undefined`、`URLSearchParams` 静默丢参 → 表现为"请求里怎么没有 m"（反模式 27 同族：参数名存在≠参数生效），根因是竞态不是签名错误。纯协议侧先实例化再请求即无此问题。
6. **坑：用"第 1 页数组是否相同"判断数据窗是否刷新** → 同窗口内各页数组会重新洗牌而 20 页**总和稳定**（实测两次运行第 1 页 `[81,18,…]` vs `[759,542,…]`，总和同为 101123）；判据只能是聚合值/全页指纹。规则 36 的新形态：题9 恒定可 fixture、题10 每次随机、**题11 窗口内洗牌的中间态**。
7. **坑：交付物放 `result/src/target/original/` 就以为入库了** → workspace `.gitignore` 的 `**/original/` 会静默排除该目录（wasm 交付"看着在、clone 后没了"）。DELIVER 前对 `result/` 跑 `git check-ignore -v`（规则 45），实测改放 `result/src/wasm/`。

## 可验证事实清单（经验资产）

1. 题 11 的挑战脚本是 `/static/wasm/encrypt.wasm`，入口页内联块按 `problemId === 11` 分派（题号→脚本映射：11 wasm / 13 jqueryxhr / 14 xhr / 16 PcSign / 18 actoken / 19 19pro）。
2. `encrypt.wasm` 229 字节、**导入表为空**，导出 `__indirect_function_table / memory / _initialize / stackAlloc / stackRestore / stackSave / encrypt`，sha256 `a1b78f471aa55f16cd0fcf68e7a31c1b24612d9c2a916c4a2c62309eb07aabd7`（2026-09-19 现网）。
3. `encrypt.length === 2`，第 3 个实参被忽略；签名式 `m = (16358 + page + trunc(_ts/3)) | 0`。
4. `page +1 ⇒ m +1`；`_ts +3 ⇒ m +1`；`_ts∈{0,1,2}` 同值、`{3,4,5}` 同值；负 `_ts` 向零截断（`-1` 与 `0` 同值）。
5. `_ts` 是**秒**：`parseInt(Math.floor(new Date().getTime()/1000).toString())`（`pagination11.js` 的 `loadPage`）。
6. 数据接口 `GET /api/problem-detail/11/data/?page=N&m=&_ts=`，20 页、每页 `current_array` 10 个元素，`pagination.number` 回显页码（可用来断言漏页/重页）。
7. 答案 = 200 个元素求和；本次实测同会话内跨窗口变化（98472 → 101123），提交时 `HTTP 200 {"status":"success","message":"答案正确，加10积分..."}`。
8. 提交体是 `multipart/form-data`（`new FormData(form)`），需 `X-CSRFToken` 头 + `csrftoken` Cookie 与页面内 `csrfmiddlewaretoken` 同值；令牌每会话现取，不得固化。
9. 会话验活复用详情页服务端渲染的 `let isAuthenticated = true;`，比额外探活请求省一次足迹。
10. 频率基线（同站题1 实测，本次未触发）：约 60 请求/30s → 403 业务层 JSON 文案「访问频率过快」；`pageDelayMs=120` + 403/429 指数退避即可，全链 21 请求 ≈3.3s。
11. `crypto-js.js` 与 `auto_block.js` 均不参与参数链（前者零引用死重量、后者纯禁右键/禁复制）。
12. ruyipage 高层 `add_preload_script` / `set_bypass_csp` 在 1.2.62 + FF155.0a1-v1.2.58 恒抛 privileged scope；底层不带 `contexts` 可用且落主 world。

## 还原代码骨架（Node）

```js
// 签名器：wasm 权威 + 算式探针
const inst = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(WASM)), {});
const m = inst.exports.encrypt(page, ts);                 // 权威源
const probe = (16358 + page + Math.trunc(ts / 3)) | 0;   // 改版探针，不参与出参

// 请求：_ts 现场取秒，逐页校验回显页码
const ts = Math.floor(Date.now() / 1000);
await get(`/api/problem-detail/11/data/?page=${page}&m=${sign(page, ts)}&_ts=${ts}`);

// 交付侧三重自检：①wasm sha256 基线 ②真机 fixture 对拍（缺失则警告跳过）③算式逐页分歧页清单
```

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/experience-rules.md` | 规则 44（工具能力先定位库层根因）/ 规则 45（交付前 `git check-ignore`）/ 规则 46（skill 自身残缺的手工等价登记）/ 规则 36 新形态（窗口内洗牌）/ 规则 25（黑盒资源 sha256 核对） |
| `references/workflow/common-pitfalls.md` | 反模式 11 第六形态（工具能力误判）/ 反模式 27 同族（`m` 因异常变 undefined 被静默丢参）/ 反模式 18（会话与数据状态） |
| `references/tooling/ruyi-tooling.md` | `add_preload_script` 坑 3 与底层绕过写法；`--preload-script` 入口 |
| `references/env/env-wasm.md` | 零导入确定性 wasm 的最简实例化路径 |
| `cases/yuanrenxue-match15-wasm-deterministic-signature.md` | 同型（零导入确定性 wasm）另一平台实证，实例化与跨请求复用要点可互参 |
| `cases/ob-string-array-modified-sha256-blackbox-mashangpa-p10.md` / `cases/webpack-ob-hmac-sha1-mashangpa-p9.md` | 同平台相邻题号算法族与数据稳定性对照（题9 恒定 / 题10 每次随机 / 题11 窗口内洗牌），禁止跨题复用算法与答案 |
