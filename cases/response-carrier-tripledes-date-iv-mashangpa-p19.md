# Case：响应体整包 `{"r","k"}` = 标准 Triple-DES/CBC/PKCS7 + 日期型 IV（码上爬平台题19）

> 难度：★★☆
> 还原方案：A 纯算还原（Node 原生 `crypto` 的 `des-ede3-cbc`，**零沙箱、零补环境**）；
> 请求侧无签名 ⇒ Step 2 运行时日志按 §4.4 例外 3「内容还原型」豁免；`k` 随响应下发、IV 由时间推导，均不硬编码
> 实现语言：Node.js（`node:https` + `node:crypto`，零第三方依赖）
> 最后验证日期：2026-09-20
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- 入口页特征：详情页 HTML 专属分支 `if (problemId === 19) { script.src = "/static/js/19pro.js" }`
  （`document.html:190-196`）＋ 通用注入 `"/static/js/pagination" + problemId + ".js"` 与 `script.onload → loadPage(1)`（`:302-307`）
- JS 特征：`pagination19.js` 仅 492B **完全明文**（无 `jsjiami`/`obfuscator` 包装，同平台题17 的 3.6KB jsjiami 包装在本族不出现），
  核心一行 `updatePageContent(JSON.parse(DES3.decrypt(data.r, data.k)))`；
  `19pro.js` 40446B = **未混淆的 crypto-js 打包副本** + 尾部 `formatDate`（1285-1323）与 `var DES3 = {iv, encrypt, decrypt}`（1325-1346）
- 参数特征：请求 `GET /api/problem-detail/19/data/?page=N`，**除 `page` 外零动态字段**；
  头集为标准 fetch 头（`accept: */*` + referer + `cookie: sessionid=…`），无 `x-requested-with`、无自定义签名头、无 POST body
- 响应特征：`{"r": "<base64 密文>", "k": "<24 字符密钥>"}`（`r` 本次 780 字符），明文为
  `{"problem":{…},"pagination":{"num_pages":20,…},"current_array":[10 个整数]}`
- 算法识别信号：源码出现 `CryptoJS.TripleDES` + `mode.CBC` + `pad.Pkcs7` + `enc.Utf8.parse(密钥串)`，
  且 `iv:` 实参是**函数调用**（`DES3.iv()`）而非字面量 ⇒ 时间派生 IV 型（见规则 55）
- 拒绝特征：同平台形态（HTTP 200 + `{"code":"400","message":"小鸡…"}`）；本次四类请求全 200 未触发
- 提交特征：`POST /problem/19/submit/`，multipart（`csrfmiddlewaretoken` + `user_answer`）+ `X-CSRFToken` 头，
  csrf 取详情页隐藏 input（`document.html:221-235` 表单 / `:310-321` 提交实现），服务端同时下发 `csrftoken` Cookie

## 加密方案

- 路径：A 纯算还原。**不是签名题**——请求侧没有任何待还原参数，难点 100% 在响应解密（与题17 同为「内容还原型」，但结构完全不同）
- 框架：无沙箱、无补环境；`crypto.createDecipheriv('des-ede3-cbc', key, iv)` + `Buffer.from(r,'base64')` + 默认 PKCS7
- TLS 客户端：Node 原生 `https`（keepAlive 单连接复用 20 页，实测无 TLS/连接层拦截）
- 链路：

```text
source  ：服务端加密；密文与密钥同响应下发（r=密文、k=24 字符密钥），IV 由客户端时间派生
entry   ：pagination19.js:8  fetch(`/api/problem-detail/${problemId}/data/?page=N`)   ← 参数集合字面量只有 page
builder ：（无）请求侧不构造任何动态字段
writer  ：（无）解密结果只写 DOM：pagination19.js:14 DES3.decrypt(data.r, data.k) → :13 updatePageContent
decoder ：19pro.js:1339-1346  CryptoJS.enc.Utf8.stringify(CryptoJS.TripleDES.decrypt(
                              b, CryptoJS.enc.Utf8.parse(c),
                              { iv: CryptoJS.enc.Utf8.parse(a || DES3.iv()),
                                mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }))
iv      ：19pro.js:1326-1328  DES3.iv() = formatDate(new Date(), "yyyyMMdd")   ← 8 字节 ASCII，本地日期
key     ：enc.Utf8.parse(k) 的 word 切片 0-2/2-4/4-6 = k 的前 24 字节（本次 k 恰 24 字符，全用）
parser  ：JSON.parse → {problem, pagination, current_array}
```

- 答案口径：`document.html:229` 前端文案直书「依次向每个接口发起请求…对这些数组中的元素进行求和运算」
  ⇒ 20 页 × 10 项 = 200 项**全量求和、不去重**；本次答案 **102679** →
  `{"status":"success","message":"答案正确，加10积分..."}`

## 踩坑记录

1. **坑（crypto-js 有两种 `decrypt` 语义，按"看到 MD5/EvpKDF 就判 passphrase"会全解不开）**：
   同一份打包里既有 `lib.Cipher._createHelper`（密钥直接当 key 用）又有 `PasswordBasedCipher`（`n.kdf.execute(...)` → EVP-MD5 派生）。
   `19pro.js` 里 `MD5` 命中 4 次、`EvpKDF` 在场，全是打包进来的**死定义**，目标链一次都没调。
   → 判定动作固定为「看 `CryptoJS.TripleDES` 由哪个类的 `_createHelper` 产出」，见规则 54 与
   `references/crypto/crypto-entry.md`「库语义判定：同一算法的两条调用路径」。
   与 `cases/yuanrenxue-match22-openssl-salted-alphabet-branch.md` 是**对偶**：那题有 `Salted__` 魔数 ⇒ 真走 EvpKDF；本题无魔数 ⇒ 零派生。
2. **坑（站方 IV 取浏览器本地日期，加密却在服务端时区做）**：`DES3.iv()` 用 `new Date()` 的本地 `yyyyMMdd`，
   客户端非东八区、或整轮取数跨过 UTC+8 零点时按本地日期取 IV 直接解不开，且症状是"padding 错误"而非明文异常。
   → 见规则 55：候选排序「服务端时区 → 运行机本地 → 各 ±1 天」+ PKCS7 与 `JSON.parse` 双校验 + 全候选失败即抛错。
   **任何情况下不得把 8 字节 IV 写成常量**（跨天即失效且看着"今天能跑"）。
3. **坑（"复现一次样本"不能证伪轮换）**：取证样本（+25 分钟）与首轮运行的 page1 数组逐字节相同，
   极易下结论成"本题数据按会话永久固定"；隔 4 分钟再打一次才看到数组变化。
   → 规则 36 再实证（题10 已记「两轮一致是碰巧」，本题是第三次命中）：判定轮换至少要有**间隔的第二次采样**，
   安全做法恒为「同一运行内取完全部页并立即提交」（实测整轮 1.13~1.21s）。
4. **坑（24 字符可读密钥 `k` 极易被当站点常量硬编码）**：`k` 是 base64 形态、看起来像写死的 AppKey。
   → 一次只读探针即可定性（连续 3 次请求的 `k` 前缀 3/3 不同、长度均 24），比上重型取证便宜得多；
   实现侧改成逐响应读取。（轮换**粒度**未取证：同请求内逐页不同 vs 每次运行整体换一套，本题不影响实现，别顺手写结论。）
5. **注意（内容还原型的门禁落点在实现侧，不在取证侧）**：Step 2 豁免省掉的只是"为零增量价值的 writer 日志跑重型工具"，
   fixture 逐字节对拍、`--guard replay`、真实提交验证、凭据不落盘四项一步都不能省（题17 同记，第二次命中）。

## 可验证事实清单（经验资产）

1. `GET /api/problem-detail/19/data/?page=1` 请求头全集：`host`/`user-agent`/`accept: */*`/`accept-language`/
   `accept-encoding`/`referer`/`connection`/`cookie: sessionid=…`/`sec-fetch-dest`/`sec-fetch-mode`/`sec-fetch-site`/
   `priority`/`te`；无签名头、无 body（`case/forensic/target-hits.json`）。
2. 解密链是**标准件**，Node 原生 crypto 一发即通：`des-ede3-cbc` + PKCS7 + base64，
   真机样本 page1 十个整数 `[737,267,200,335,228,471,108,363,911,881]`（sum 4501）逐字节复现。
3. `base.js`（3086B）与 `auto_block.js`（7802B）对 `document.cookie|fetch(|XMLHttpRequest|setRequestHeader|
   localStorage|sessionStorage|MD5|HmacSHA|.sign` **零命中**；12 个包内无 `.wasm`、无第三方签名域名
   ⇒ 目标域无 JS 写 cookie、无 JSVMP/WASM 签名 SDK（内容还原型判据二成立）。
4. `k` 随响应下发（3 次请求 3 个不同前缀、均 24 字符）、`r` 均 780 字符 base64 ⇒ 交付代码与 `result/` 无任何样本密文/密钥常量。
5. 题面数据按窗口轮换：同 sessionid 相隔 4 分钟两次运行 page1 数组不同（sum 4501 → 6274）；
   20 页取数 + 提交在同一运行内 1.13s 完成，`pageIntervalMs=0` 无频率墙。
6. 平台三态提交语义第四次命中：`success`（答案正确加分）/ `info`（已完成过这道题＝历史成功）/ `error`（答案错）；
   按 `status!=='success'` 判失败会误报还原失败（题14/16/17 已记）。
7. 会话存活探针形态：详情页能取到 64 字符 `csrfmiddlewaretoken` 且数据接口返回 `current_array` 数组 ⇒ 登录态有效；
   取不到 csrf 时直接报「会话可能已过期」，避免把会话问题误读成算法问题（题16 匿名会话退化同族）。
8. 交付结构：`result/final.js`（单入口 + 被 require 时只导出 API）+ `result/src/des3.js`（解密核心与 IV 候选）
   + `result/config.json`（problemId/路径/UA/超时/答案窗口）；`--selftest` 离线对拍 `../case/fixtures/*.fixture.json`，
   缺文件时警告跳过而非 FAIL。

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/crypto/crypto-entry.md`「库语义判定：同一算法的两条调用路径」 | 规则 54 的操作落点（调用点第二实参判据 + 死定义排除） |
| `references/workflow/experience-rules.md` 规则 54 | crypto-js 双 `decrypt` 路径与"定义在场≠被调用" |
| `references/workflow/experience-rules.md` 规则 55 | 时间/日期派生 key·iv 的时区与跨零点候选法 |
| `references/workflow/experience-rules.md` 规则 36 | 题面数据轮换判定纪律（本题第三次命中，含"复现一次不能证伪"） |
| `cases/yuanrenxue-match22-openssl-salted-alphabet-branch.md` | 对偶样本：真走 EvpKDF 派生（有 `Salted__` 魔数）vs 本题零派生 |
| `cases/ob-string-array-selfdefending-mashangpa.md` | 同平台另一道响应侧加密题（AES-CBC，沙箱+纯算混合），密钥来源不同 |
| `cases/unicode-codepoint-substitution-no-font-file-mashangpa-p17.md` | 同平台「内容还原型」首例（响应侧码位单表替换，Step 2 豁免形态与请求侧明文清单可对照）；本题是其第二次命中，解密结构完全不同 |
| `references/workflow/experience-rules.md` 规则 54/55 | 双 `decrypt` 路径判据与时间派生 IV 候选法（本 case 的识别信号落点） |
| `SKILL.md` §4.4 例外 3 | 内容还原型 Step 2 豁免三条判据（本题判据逐条落盘形态可作模板） |
| `SKILL.md` §9 路径 A | 纯算优先：标准件算法不得上沙箱 |
