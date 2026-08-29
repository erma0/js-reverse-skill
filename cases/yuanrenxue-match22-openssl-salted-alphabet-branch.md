# Case：OpenSSL Salted 格式 + base64 字母表环境分支 + TLS 指纹白名单 + [Unforgeable] 沙箱探针（猿人学第22题）

> 难度：★★★
> 还原方案：A 纯算还原（EvpKDF 链 + 标准 AES-256-CBC，全部可纯代码）+ B 最小沙箱（22.js 黑盒跑"逆练MD5"变体）+ 桥式交付（Python curl_cffi + Node 子进程）
> 实现语言：Python(final.py, curl_cffi) + Node(src/token_bridge.js, 22.js 沙箱桥)
> 最后验证日期：2026-08-29
> 平台类型：match.yuanrenxue.cn（猿人学练习平台第 22 题「js加密-初识-魔改标准算法」）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`/match/22/js/22.js`（438719B 单行，sha256 原版 `7fdbd518dfa4b73665f16829b6231df03c6de93c25f166676685a8cfc37ffb4b`，控制流平坦化+字符串切片混淆，内嵌完整 crypto-js 魔改包；babel 解析失败「'return' outside of function」）
- 参数特征：`GET /api/question/22?page=N&pageSize=10&kw=&token=<32hex>&now=<13位ms>`；now = `GET /api/getTime` 服务器毫秒文本（每页独立获取）
- 文档内联钩子：`$.ajax` 包装器拦截 `/api/match/number`（诱饵，永不发送），`window.matchnumber = data.m`；`<meta name="match_num" content="22">`
- 风控特征：数据绑定 sessionid；末页(page5) UA=yuanrenxue；提交 `POST /a/22` 表单编码 `{answer}`，`code=2` 通关
- **传输层：服务端 TLS 指纹白名单**——Node https/http2、Python requests 全 403 `{"error":"token failed"}`，**curl_cffi impersonate=chrome131 通过**（连"未消费浏览器新鲜 token 跨栈重放"都 403，与算法内容无关）

## 加密方案（完整还原，全字节级验证）

```
salt8   = bb76994fbb76994f（常量！fe() 随机函数三层降级后的 fallback 常量 3145111887×2）
material(48B) = EvpKDF-MD5 三块链（password="666yuanrenxue66", salt=salt8, keySize=12字）：
  block1 = md5("666yuanrenxue66" ‖ salt8)
  block2 = md5(block1 ‖ "666yuanrenxue66" ‖ salt8)
  block3 = md5(block2 ‖ "666yuanrenxue66" ‖ salt8)
key = material[0:32], iv = material[32:48]（ECB 未用 iv，但材料含）
ct   = AES-256-CBC(key, iv, PKCS7(str(now)+str(page)))   # 14字节明文+2填充=单块
blob = "Salted__" ‖ salt8 ‖ ct（32字节, OpenSSL Salted 格式）
密文串(44字符) = base64(blob)                             # 字母表见下
token = 逆练MD5变体(密文串)                               # 22.js 内部, 输入对则输出对
```

- **字母表（环境分支！唯一的环境差异点）**：
  - 浏览器(FF/Chrome 一致)：`abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/`（小写在前）
  - 沙箱/Node：`abcdefghiABCDEFGHIJKLMNOPQRSTUVWXYZjklmnopqrstuvwxyz0123456789+/`（"混元表"：a-i、A-Z、j-z 分段）
  - 修复：22.js 副本打一行补丁暴露哈希器与密文串（在 `o[a](c),f+=10` 前 inject `globalThis.__hd=this,globalThis.__hs=String(i),`），桥内按位置翻译（sb[i]→ch[i]）后用变体 md5 重算
- 明文块字节级验证：`825702455,959985717,943075380,959513090` = "1787"+"9885"+"8604"+"91\x02\x02"

## 踩坑记录

1. **坑（TLS 指纹白名单的判定——本题第一关）**：沙箱 token + Node → 403；同一 token 用 curl_cffi → 200。排除法三连：①拦截浏览器 send 取**未消费**新鲜 token 亚秒级重放仍 403（排除时间窗）；②全头部(sec-fetch-*/accept-encoding/te/完整cookie)仍 403（排除头部）；③Z.ct 相同（排除内容）。→ 正确做法：**未消费 token + 三客户端阶梯**（Node → requests → curl_cffi）一次定位传输层；"请求自己 403 但浏览器 200"必须先过传输层再查算法。
2. **坑（[Unforgeable] 全局绑定探针——本题核心之一）**：AES `_doReset` 状态机内埋 `w=window → D=w[z] → z=w[b]=x → delete window → window=w`。真浏览器：delete 返回 false、赋值静默忽略；vm 沙箱 data 属性会被真删/真换 → 诱饵分支（调度表 S-box 查表索引变异，ks[12..15] 从标准值漂移）。→ 正确做法：沙箱把 `window/self/top/parent/frames` 定义为**不可配置 accessor**（get 返回全局、set 空操作、configurable:false）。验证手段：同 now 双侧断点比状态机变量（i=191/w=0/z/b/x/D 完全一致即对齐）。
3. **坑（base64 字母表环境分支——本题核心之二）**：Z.ciphertext（AES 输出 4 字）沙箱==Chrome **逐字节一致**，但密文串不同 → 差异只在编码层。沙箱解码出 `Salted__` 可读 → 沙箱字母表 = 片段拼装的"混元表"；Chrome 用另一套。→ 正确做法：用已知 (Z.ct, cipher44) 配对 + blob="Salted__"‖salt‖ct 结构假设，反推字母表全排列（本例 Chrome = a-z+A-Z+0-9++/，标准换序）；桥内按位置翻译后 token == Chrome token 闭环验证。识别信号：同 Z.ct 不同串、44 字符、`Salted__` 魔数（标准解码 53616c7465645f5f）。
4. **坑（反调试：第 2 次计算死循环）**：22.js 在调试器挂接时的**第 2 次计算**（翻页点击）稳定触发 while 死循环，MCP 全工具超时（渲染进程卡死）；第 1 次自动加载不受影响。→ 正确做法：MCP 采样**一次/会话**，采样前规划好全部 dump 项；卡死后**不要杀用户 Chrome**——先 `Get-CimInstance Win32_Process` 查 CommandLine 确认是 MCP 专属 profile（chrome-devtools-mcp）再杀渲染进程解锁。
5. **坑（MCP 断点跨 reload 易丢/易解析到别的函数）**：set_breakpoint_on_text 按 1-based 文本列下断，V8 实际命中列不同；`function(f,s){var s=e||19` 这类通用序言文本 find() 会命中别的函数。→ 正确做法：**每次 reload 后 list_breakpoints 确认**；锚点用**函数尾部的唯一长片段**（反向定位入口）；断点命中后用 `get_paused_info` 的 functionName+scope 判断是否真的落在目标函数。
6. **坑（jscall 折叠导致覆盖 diff 假阳性）**：RuyiTrace jscall 有 parent_elide_reason 递归折叠，1918 帧 vs V8 coverage 251 函数 → 250 个"幽灵函数"全是噪声，全量路径 diff 不可用。→ 正确做法：对比执行路径改用**同构探针双侧对拍**（charCodeAt NEWSTR-STACK / slice / toString(16)，两侧同一探针代码，事件流逐条 diff）。
7. **坑（charCodeAt NEWSTR 探针是最强武器）**：对混淆包内不可达的闭包中间值，`String.prototype.charCodeAt` 首读记录（串内容+长度+22.js 栈列号）一次暴露盐/时间串/密文三段输入；配合 slice 首见、toString(16) 逐位，可还原完整管线顺序（盐链3遍→时间串1遍→密文1遍→token 32个hex位）。→ 正确做法：探针装在**两侧**（沙箱 vm 与真机 hook），事件流逐条 diff，第一处分歧即答案。
8. **坑（OpenSSL Salted 识别）**：44 字符、尾部 `=`、标准解码前 8 字节 `53616c7465645f5f`（"Salted__"）→ OpenSSL 加密格式：`"Salted__"‖salt(8)‖ct`。盐在 blob 里 → 服务端可提取 → **盐可以随机也可以恒定**（本题 fe() fallback 常量恒定）。key/iv = EvpKDF-MD5(password, salt, keySize=12字=48B)（keySize:12+iterations:1 碎片是识别信号）。
9. **坑（验证记录 schema）**：check_final_artifact 要求 attempts[] 每条含 `timestamp`(可解析)/`httpStatus`(2xx整数)/`parameterSummary`(非空)/`sessionStage`(非空)/`responseValid`(严格true)，mode 必须字面 `"online"`，Session 检测按变量名模式（`creq.Session(` 赋值变量名不被动态提取，`sess.get` 不匹配 `session\.` 静态模式）。→ 正确做法：变量名直接叫 `session`；按 schema 生成 attempts。

## 复盘与网上题解对照

- 本题即"猿人学第二届第一题"同族重发（2025 新年挑战）。网上通行解法（CSDN 131065190/137403329、
  B站 BV1tiwBeSEDW）：**原样运行原码 + hook/diff 找出 MD5 与 AES 的魔改点**，与本题终局方案同族
  （沙箱原码跑 + 字母表翻译 + 变体 md5 桥内重算）。第三届同族题公开结构一致：token = MD5变体(AES变体(now+page))。
- **更简路线（事后诸葛）**：首次读 22.js 头部碎片（./cipher-core/./evpkdf/./mode-ecb）即应判定
  crypto-js 家族 → 直接在 Node `npm i crypto-js` 用库复现 EVP+AES-CBC（本会话已验证：标准
  EVP_BytesToKey+小写在前 b64 可复现前 21 字符），再仅逆向"逆练MD5"变体即可；全文件沙箱重建路线
  额外踩了 [Unforgeable] 与编码表两个环境分支。**教训：识别出知名加密库后，优先"原码执行+diff
  魔改点"，而非全量补环境重建**；库内标准件（EVP_BytesToKey/AES-CBC/PKCS7）不必重逆。
- **调度修正**：ct 的密钥调度为魔改版（ks[12..15]=[487147042,...] ≠ 标准扩展，两侧一致）——
  纯代码复现 ct 需用实测调度表或直接调用原码；"异化AES"变异点即在此。
- **效率复盘**：本题平台难度=简单(30分)，耗时远超 VMP 题。三大根因：
  ① crypto-js 家族识别过晚（"Salted__" 解码后未立即转库复现路线）；
  ② 真机调试器采样被 skill 默认流程压制，用户两次提醒才启用（已成文为 1a 路线）；
  ③ MCP 断点/objectId 竞态与反调试死循环的工具摩擦放大了每轮成本。

## 可验证事实清单（经验资产）

1. 固定 sessionid(p4av26i0) 下 5 页加和恒 **26240105**（2026-08-29 提交 `code=2, exp+107` 通关；两轮 5 连请求全 200 items=10）
2. token 输出对拍样本：now=1787988974130 → token `ce65bfcecae8a82632577cdcf6439776`、密文串 `u2fSDgvKx1+7DPLpU3Azt7/9AKF6ZSW6AAmK4aBP4d0=`（Chrome 真机，桥复现一致）；同 now 沙箱未翻译串 `L2fsUgMkO1+7UplGu3RQK7/9RkW6zsw6RRDk4aSp4d0=`
3. 22.js 静态：438719B 原版 sha256 `7fdbd518...`；补丁版（暴露 __hd/__hs）sha256 `023b3416...`
4. 密钥材料（12字，now 无关，双侧字节一致）：`[161474622, 909672010, -904373743, 392620821, -1900390002, 20483957, 31514546, 2063037571, 1973358300, 1942571111, 106271065, -140781227]`
5. 调度（60字，nRounds=14）：ks[0..11] 标准、ks[12..15] 沙箱实测 `[487147042, 473024855, 500242149, 1730568806]` ≠ 标准扩展 `[-1291237854, ...]`——**沙箱与 Chrome 的完整 60 字调度逐字一致**（变异是共享的，环境差异只在编码表）
6. 明文块（now=1787988586049 page=1）：`[825702455, 959985717, 943075380, 959513090]` = "1787"+"9885"+"8604"+"91\x02\x02"
7. 页面 hook 的 `window.matchnumber`：浏览器与沙箱均 undefined（/api/match/number 从未真正调用，诱饵）；`window.call` 为 1 参函数（未使用）
8. `POST /a/22` 表单编码 `{answer}`：`{"result":"success","created":true,"code":2,"exp":107}` 通关
9. 传输对照矩阵：Node h1/h2、Python requests 发**未消费浏览器 token**均 403；curl_cffi chrome131 同 token 200；时间窗、头部缺失假说被亚秒级重放+全头部对照排除
10. 22.js 第 2 次计算在 MCP 调试器挂接时死循环（反调试，多次复现）；杀进程前须确认 profile 归属（chrome-devtools-mcp = MCP 专属，勿杀用户 Chrome）

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `cases/yuanrenxue-match19-tls-fingerprint-blocklist.md` | 同为 TLS 指纹白名单（match19 首例），本题"未消费 token 三客户端阶梯"判定法 |
| `cases/yuanrenxue-match21-sm3-variant-decoy-branch.md` | 同为环境分支诱饵（match21 = 算法常量变体，本题 = 编码表变体），native 探针对拍方法论同源 |
| `cases/yuanrenxue-match16-webpack-blackbox-branch.md` | 同为 webpack/混淆包黑盒 + keySize 碎片识别 |
| `cases/yuanrenxue-match15-wasm-deterministic-signature.md` | 同为 getTime 服务器时间源 |
| `references/env/env-detect-bypass.md` | [Unforgeable] 绑定探针（新增）：delete/赋值语义对齐 |
| `cases/yuanrenxue-match-index.md` | match 系列速查 |
