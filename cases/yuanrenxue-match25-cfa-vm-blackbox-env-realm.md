# 猿人学 match25：控制流扁平化 VM 混淆 token（x 黑盒执行 + 环境桩必须在沙箱内运行）

- 验证日期：2026-08-31
- 域名：match.yuanrenxue.cn
- 题型：接口 `/api/question/25?page=N&pageSize=10&kw=&token=<base64|编码串*编码串>&now=<ms>`；
  token = x('/api/question/25' + now + page)，now 来自 GET /api/getTime（每次翻页重新取）
- 策略：B vm 沙箱黑盒执行（25.js 截取 x 函数 + 环境桩）+ D 环境对齐（时间戳冻结 + global 别名 + pgxList 桩）；
  Node 原生 https 直连无 TLS 校验
- 答案：26878107（提交 POST /a/25 表单编码，code=2 通关）

> 平台共性（请求/提交链路、末页 UA、sessionid 绑定、getTime 时间源、诱饵参数惯例、风控底座、token failed 语义）统一见 cases/yuanrenxue-match-platform.md；本文只保留本题差异与专属事实。

## 算法要点

25.js 48071B 控制流扁平化 VM 混淆（`for(;;) if(_$XX==...)` dispatcher + 字符串表），
`x` 函数声明在文件顶层（26108B）。黑盒执行即可，无需逆向 VM 内部逻辑：

1. **token 结构**：`base64段|数字字母交替段*数字字母交替段`——第一段 24 字节 base64；
   `|` 后为逐字符 `charCodeAt(i) ^ _$VM` 后按字符频率构建 Huffman 树（char/frequency/left/right）
   编码的数字字母交替串（含 `g` 等非 hex 字符，**别当 hex 解**）。
2. **时间戳参与编码**：x 内部 `(()=>_$AX=_$XL(+new Date))` 首次执行时把 `+new Date`
   派生为数组（`_$XL` 是数组构造器）参与后续 Huffman 编码。生成 token 时**冻结 Date=now**
   （getTime 返回的服务器时间戳）最稳——token 内时间戳与 now 参数一致。
3. **服务端不校验时间窗口**：T 偏移矩阵实测 now−100s ~ now+30s 全部 200（见下），无需时间补偿/重试。
4. **x 的环境自检分支**：`window.window == function(){return this}()` 不成立 → `_$VM=111`；
   `!window.pgxList` → `_$VM=112`。两个分支都影响 XOR 密钥 `_$VM` 与后续编码。
5. 诱饵参数 `m`：页面 hook `/api/match/number` 才给 `window.matchnumber` 赋值，本页无此请求 →
   恒 undefined 被 jQuery 丢弃（trace 的 XHR open 参数全文确认无 m，反模式 27 第六次实证）。

## 关键坑点（均可复用）

1. **环境桩必须在 vm 沙箱内执行（本题最大的坑，403 根因）**：环境桩代码在**主 realm** 定义时，
   `win.window = globalThis` 指向 **Node 主进程全局对象**；x 在沙箱里执行
   `function(){return this}()` 返回的是**沙箱 globalThis**，两者不等 →
   `window.window == function(){return this}()` 判 false → 误走 `_$VM=111` 分支 → token 全错 →
   服务端 403 `{"error":"token failed"}`。症状与反模式 26 相同（"格式全对但服务端全拒"），
   但根因在**环境桩运行位置**（主 realm vs 沙箱），不是宿主对象属性。
   **解法**：环境桩写成独立脚本文件，在 `vm.runInContext(envCode, sandbox)`（或 `--env-module`）里执行，
   `globalThis` 自然指向沙箱。**定位法**：同输入双环境对比——同一环境桩分别"沙箱内执行"与
   "主 realm 执行后注入"，token 输出一比对就现形（本地能跑、结构像、服务端全拒时优先试此法）。
2. **global 标识符动态解析**：x 内 `typeof global == "function"` 分支用到 `global`——沙箱全局标识符
   `global` 必须用 getter/setter 动态指向 `window.global`（window.global 初始 undefined，由 x 内部置为函数，
   函数体 `return _$QJ+_$QA-_$DA-_$PG` 是闭包状态组合）。
3. **`document.querySelector('meta[name="match_num"]')` 必须返回 `{content:'25'}`**：x 用 meta content
   拼接口路径 `/api/question/25`；未知 selector 返回空元素桩（防 `document[_$YG](_$ME)[_$VM]` 报错）。
4. **T 偏移矩阵测时间窗口（DIAGNOSE 通用手法）**：token 含时间戳且服务端 403 时，不要凭直觉加
   时间补偿——对 now 做 ±N 偏移（−100s~+30s）各生成 token 请求，看通过区间。match25 实测**全过**
   （不校验窗口），直接冻结 Date=now 即可；若窗口存在，按区间中值冻结并保持
   getTime→生成→请求 <1s。
5. **环境桩文件不要用 IIFE 包裹**：check_code_quality 把 IIFE 主体当单个函数，行数=文件行数
   必超 90 上限；且单文件承载多类 WebAPI 时判"补环境主体堆叠"（>500 行 + 非 env 目录）。
   **解法**：拆 `src/env/browser-objects/{dom,window,jquery,webapi}.js`（按职责），每个文件
   **顶层代码 + 具名函数（各自 <90 行）+ `Object.assign` 合并方法集**（match25 返工点）。
6. **`--targets` 用 `page=1`/`page=2` 参数子串**（勿用 `question/25`：静态资源
   `static/new_match/question/25/*.js` 误命中提前收尾）。
7. **末页 UA=yuanrenxue**（page5 必须）；page1-4 用浏览器 UA（match17 同款）。
8. 5 页和 26878107 同会话可反复复验；提交过频封号，验证只提交一次。

## 交付结构（过双门禁）

```
result/
├─ final.js                 # 入口：读 config.json，5 页循环 + 求和 + 提交
├─ config.json              # sessionid / UA（外置不入代码）
├─ 验证记录.json            # 联网模式 35 条 attempts + 提交记录
└─ src/
   ├─ match25-client.js     # Session 封装：makeToken（黑盒）+ HTTP + 提交
   ├─ env/browser-objects/{dom,window,jquery,webapi}.js   # 环境桩（沙箱内执行）
   └─ target/original/25.js.5384da530a + 25_x_only.js     # 原始 25.js + x 截取版
```

- 环境桩模块在 `buildSandbox` 里按依赖序 `vm.runInContext`（dom → window → jquery → webapi），
  模块间用 `globalThis.__M25_*` 传递，`win.window = globalThis` 在 window.js 内执行（沙箱内）。
- 验证：`check_code_quality` PASS（无 IIFE、函数 <90 行、browser-objects 拆分）、
  `check_final_artifact` PASS（35 条 attempts、Session 三件套、无硬编码样本）。

## 对 skill 的贡献

- SKILL.md 路径 B：新增「环境桩必须在沙箱内执行（self-reference 自检）」规则 + IIFE 门禁坑
  （2.3.91 入库）。
- common-pitfalls 反模式 34：环境桩主 realm 定义 → `window.window==function(){return this}()`
  自检失败 → 格式全对但服务端全拒（match25 实证）。
- REAL_VERIFY：T 偏移矩阵量化测服务端时间窗口（match25 实证：now±100s 全过，无需补偿）。
