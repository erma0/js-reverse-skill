# Case：响应侧 Unicode 码位单表替换（"伪字体"，无字体文件）+ 还原表在站方 JS 明文常量（码上爬平台题17）

> 难度：★★
> 还原方案：A 纯算还原（内容还原型，**Step 2 豁免**，无运行时签名链路）：运行时拉取站方 `pagination17.js`
> → 正则提取明文 `FONT_DECRYPT_MAP` → 逐字符查表 → 20 页求和提交；**不执行任何站方 JS、不解析任何字体文件**
> 实现语言：Node.js（`node:https` + `node:crypto`，零第三方依赖）
> 最后验证日期：2026-09-20
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- 入口页特征：详情页 HTML 通用注入 `script.src = "/static/js/pagination" + problemId + ".js"` →
  `script.onload = () => loadPage(1)`；**题17 没有 problemId 专属分支**（题11/13/14/16/18/19 才有），
  单文件即完成全部还原
- 响应特征：`{"problem":{…},"pagination":{"num_pages":20,…},"current_array":["બફસ", …]}`，
  元素码位**横跨多个非 PUA 区块**（孟加拉文 U+09A7 / 古吉拉特文 U+0A8A·U+0AA4–U+0AB8 / 西里尔文扩充-B U+A66E），
  不是 PUA 私用区 —— 与真字体反爬的码位布局不同
  （**码位区块以落盘样本实测为准**：源文档初稿误写"天城文/古嘉摩基/西里尔补充"，两份同源文档互相印证仍会一起错）
- JS 特征：`pagination17.js` 仅 3671B / **7 行**（首行 3377B 是 `jsjiami.com.v7` 打包行，2-7 行为明文 `loadPage` fetch 逻辑；
  判"单行"前先 `wc -l`），家族特征（`var _js='jsjiami.com.v7'`、自引用字符串数组 `a()` + `b()` 解码器、
  `_0x` 十六进制下标、`var version_ = 'jsjiami.com.v7';` 在打包行**内**而非文件尾），
  **但还原表是未被字符串化的明文对象字面量**（在第 1 行打包行内，字节偏移 ~737）：
  `const FONT_DECRYPT_MAP={'ꙮ':'0','ઊ':'1',…}`（混淆器对非 ASCII 键常直接留明文字面量）
- 请求特征：`GET /api/problem-detail/17/data/?page=N`，**除 `page` 外零动态字段**；
  头集为标准 fetch 头（`accept: */*` + referer + cookie），**无 `x-requested-with`、无自定义签名头、无 body**
- 资源特征：全包 14 个请求内**无任何字体资源与 `@font-face`/`FontFace`**（仅 cdnjs 的 fontawesome，与题面无关）
  ⇒ "字体加密"是**码位替换 + 前端查表还原**，页面看到的数字是 JS 解码后写入 DOM 的
- 提交特征：`POST /problem/17/submit/`，multipart（`csrfmiddlewaretoken` + `user_answer`）+ `X-CSRFToken` 头，
  csrf 取详情页隐藏 input（服务端同时下发 `csrftoken` Cookie）；成功 200 + `{"status":"success","message":"答案正确，加10积分..."}`
- 答案口径来源：页面正文直接印出提示文本（"…依次向每个接口发起请求，获取接口返回的数组，并对这些数组中的元素进行求和运算"）

## 加密方案

- 路径：A 纯算还原（查表），**零补环境、零沙箱、零字体解析**
- 本质：**单表替换密码**（monoalphabetic substitution over Unicode codepoints）
- 链路：`loadPage(N)` → `fetch(data?page=N)` → `updateCounter(data)` → 逐元素 `decryptFontNumber(str)`
  （`FONT_DECRYPT_MAP[ch] || ch`，表外字符原样保留）→ `updatePageContent(g)` **只写 DOM**
  ⇒ writer 不触及任何请求字段，运行时不存在签名生成点
- 本次落盘映射表（运行时重新拉取，不硬编码）：U+A66E→0、U+0A8A→1、U+0AB8→2、U+0AA4→3、U+09A7→4、
  U+0AA8→5、U+0AAA→6、U+0AAB→7、U+0AAC→8、U+0AAD→9（10 项、数字双射）
- 交付三要点：① 表**运行时抓取** + `sha256` 记录（换表即暴露，避免"格式全对但答案全错"）；
  ② 表解析后校验"10 项 + 0-9 双射"；③ 解码结果必须 `^\d+$`，出现表外码位**硬失败**而非静默产 NaN
- 会话/TLS：Node 原生 `https` 单 keepAlive Agent 复用整轮，无 TLS 指纹层；`sessionid` 运行时 `--cookie` 注入

## 踩坑记录

1. **坑（按题型命名选工具链）**：题面写"字体加密"，直觉路线是 `fontTools` + brotli + `glyf` 轮廓指纹
   （即 `references/rendering/font-anti-crawl.md` 的整条链）。实际本题**没有任何字体文件**，
   还原信息 100% 在一个 3.6KB JS 的明文常量里。
   → 正确顺序：先 30 秒确认「有无字体资源/`@font-face`」+「站方 JS 里有无明文映射常量」，
   两问都否定/命中即定为伪字体形态，跳过字体解析链（反模式 11 第七形态）。
2. **坑（CASE_LOOKUP 多关键词 AND 语义 → 假阴性"本地无案例"）**：本次用
   `search_cases.js 字体 font unicode 字形` 得到 `未找到匹配案例`，据此险些判定本地无先例；
   实际 `scripts/search_cases.js:102` 是 `queries.every(q => values.some(...))` = **多词 AND**，
   单词 `字体` 立即命中直系先例 `cases/yuanrenxue-match7-dynamic-font.md`
   （同为内容还原型 + Step 2 豁免 + 翻页求和 + "开窗会 Set-Cookie 重置登录态致提交 401"）。
   → 下"本地未命中"结论前必须逐词/用最宽 1–2 词复检（反模式 41）。
3. **坑（离线 `--selftest` 分支覆写在线交付记录）**：selftest 复用在线模式的 `verification` 对象并调用
   `writeVerification()` ⇒ 已实时落盘的 23 条真实 attempts 被清零，`check_final_artifact.js` 只报
   「attempts 只有 0 条」不给根因，最后只能重跑真实请求恢复（规则 56）。
   → 实时验证记录只允许在线路径写；离线/自检产物落 `case/tmp/`。
4. **注意（`--targets` 终态命中即收尾 ⇒ 翻页类只有第 1 页真机样本）**：`check_final_artifact` 要求
   多请求 case 至少固化 2 个不同请求序号样本，本题浏览器侧拿不到第 2 页。
   → 用「构造性等价（站方对全部页共用同一张静态表，浏览器亦如此）+ 运行时逐页表外码位硬失败」替代，
   并在总结显式声明；不要为了凑样本再跑一轮浏览器。
5. **注意（数据轮换不是严格分钟周期）**：同一 sessionid 三轮整轮 total = 100419(08:52) / 97651(08:54) /
   97651(09:03)——9 分钟不变、2 分钟却变过，触发点未归因。
   → 结论只落到操作纪律：同轮取数同轮提交，禁止复用历史 total（页面自述"有效期一分钟"是上界不是周期）。
6. **注意（同平台历史载体不可外推）**：题13 header / 题14 query `m` / 题15 cookie `v` / 题16 body `h5`
   全有签名，容易让人去找"第 5 种载体"。本题请求侧全干净。
   → "请求侧是否明文"必须回看本次 `target-hits.json` 头集 + 路径 E 三判据。

## 可验证事实清单（经验资产）

1. 目标请求头全集（本次真机）：`host`/`user-agent`/`accept: */*`/`accept-language`/`accept-encoding`/
   `referer`/`connection`/`cookie: sessionid=…`/`sec-fetch-dest|mode|site`/`priority`/`te`；无签名头、无 body。
2. 表外码位实测为零：第 1 页 10 个元素 + 运行时 20 页 200 个元素全部在 10 项表内命中。
3. `base.js` / `auto_block.js` grep `document.cookie|fetch(|XMLHttpRequest|@font-face|.woff|localStorage|sessionStorage|CryptoJS.md5|sign`
   → **0 命中**；14 包内无 WASM、无第三方签名域名 ⇒ 目标域无 JS 写 cookie、无运行时签名 SDK。
4. 整轮 20 页 + 详情页 + 映射表 = 22 个只读请求，单 keepAlive 连接串行实测 0.82–1.03s，无频率墙（`pageIntervalMs=0`）。
5. 平台三态提交语义第 4 次命中（题14/16 已记）：`success`（答案正确加分）/ `info`（"你已经完成过这道题目了"
   ＝历史已成功，须算成功）/ `error`（答案错）。
6. 详情页 `document.html` 同时给出：答案口径提示文本 + 提交实现（`fetch(form.action, {method:'POST',
   body:new FormData(form), headers:{'X-CSRFToken':…}})`）⇒ 写请求格式无需猜测。
7. 本次成功答案 **100419**（`status:success 答案正确，加10积分`）。

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/rendering/font-anti-crawl.md`「形态三分诊」 | 本 case 是"伪字体（无字体文件）"形态实证；含先做三问分诊再选还原链的判定测试 |
| `references/workflow/experience-rules.md` 规则 56 | 交付入口离线分支不得写在线实时记录文件（本 case 实证：selftest 清空 attempts） |
| `references/workflow/common-pitfalls.md` 反模式 41 | CASE_LOOKUP 多关键词 AND 假阴性（本 case 实证） |
| `references/workflow/common-pitfalls.md` 反模式 11 第七形态 | 按题型命名选工具链（"字体加密"→ 直接上 fontTools） |
| `cases/yuanrenxue-match7-dynamic-font.md` | 同族内容还原型先例（真字体形态、Step 2 豁免先例、开窗重置登录态坑） |
| `cases/ob-string-array-purealgo-mashangpa-p8.md` | 同平台"请求侧明文 + 纯算还原"先例 |
| `SKILL.md` §4.4 例外 3 | 内容还原型 Step 2 豁免三条判据（本 case 首次用 `--exempt` 合法登记通道） |
