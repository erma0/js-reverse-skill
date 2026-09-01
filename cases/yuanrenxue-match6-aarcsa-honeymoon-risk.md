# Case：AAEncode + RSA 签名 + 蜜月期会话风控纯协议还原（猿人学第6题）

> 难度：★★★★
> 还原方案：B vm 沙箱执行（Node 跑原始 delect.js 生成签名）+ curl_cffi 请求
> 实现语言：Python（主入口）+ Node.js（签名器子进程）
> 最后验证日期：2026-08-24
> 平台类型：猿人学练习平台（match.yuanrenxue.cn）
> 平台共性（请求/提交链路、末页 UA、sessionid 绑定、getTime 时间源、诱饵参数惯例、风控底座、token failed 语义）统一见 cases/yuanrenxue-match-platform.md；本文只保留本题差异与专属事实。

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`delect.js` 开头 1458 字符 **AAEncode 颜文字混淆**（`ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻`，解码产物仅 `window.o = 1`）+ webpack 打包 JSEncrypt 2.3.1 + jsbn BigInteger；顶层 `navigator = {}` / `window = {}` 反检测赋值
- 参数特征：`GET /api/question/6?page=N&m=<enc>&q=<chain>`；m 为 172 字符 base64 的 RSA-1024 密文经**双层 URL 编码**（`/`→`%2F`→`%252F`）；q 格式 `1-<13位毫秒时间戳>|`
- 请求特征：失败返回 `HTTP 200 + {"0.0": "风控不通过，别匆忙，放慢速度"}`（业务层风控文案，非标准错误码）；页面加载（GET HTML）后短时间内请求放行（蜜月期）
- 反调试特征：jsbn `am/DB/DM/DV` 初始化包在 `try{...}catch(e){}` 中，其 jsfuck 环境检测在 Node 抛错被静默吞掉 → 大数解析全面错乱（`toString(16)` 死循环、"Message too long for RSA"）

## 加密方案

- 路径：B vm 沙箱执行（Node 补环境跑 delect.js 的 `z(t,1)`），Python curl_cffi 负责请求
- 框架：Node 全局执行（无 vm.createContext，直接 eval + globalThis 补环境）
- TLS 客户端：curl_cffi（impersonate=firefox）
- 核心思路：`m = 二次URL编码(base64(RSA-1024-PKCS1v1.5("1|" + t)))`，q 单段链 `1-<t>|`，m 内 t 与 q 末段 t 必须同源；先 GET HTML 开蜜月期窗口，再逐页无缝请求（默认 0 间隔，末页 UA=yuanrenxue）

### 签名链（entry-chain）

```
source: t = Date.parse(new Date())（毫秒）+ window.o（AAEncode 产物，恒 1）
entry: req(np)（document.html 内联，页面加载即 req(1)）
builder: r(t,o) → z(t,1) → JSEncrypt.encode：明文 "1|" + t → RSA-1024 PKCS#1 v1.5
         → base64 → encodeURIComponent
writer: $.ajax GET，jQuery $.param 对 m 值再编码一次 → URL 中双层编码
q 构造: window.i += "1-" + t + "|"（浏览器端跨请求累加，但服务端不校验链）
```

RSA 公钥（delect.js 内置，DER 结构标准无魔改）：

```
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDq04c6My441Gj0UFKgrqUhAUg+kQZeUeWSPlAU9fr4HBPDldAeqzx1UR99KJHuQh/zs1HOamE2dgX9z/2oXcJaqoRIA/FXysx+z2YlJkSk8XQLcQ8EBOkp//MZrixam7lCYpNOjadQBb2Ot0U/Ky+jF2p+Ie8gSZ7/u+Wnr5grywIDAQAB
```

### Node 补环境关键坑（signer.js 核心）

1. **jsbn `am` 初始化被 try-catch 静默吞错**：delect.js 内 BigInteger 的 `am/DB/DM/DV` 初始化包在 try-catch 里，其 jsfuck 环境检测在 Node 抛异常被吞，导致大数解析错乱（n 变垃圾、`toString(16)` 死循环爆内存）。修复：从源码正则提取 am3 乘法函数（`16383/268435455` 特征）手动挂回 prototype，并补 `DB=28, DM, DV, FV, F1=24, F2=4`。
2. **window/navigator 只读语义**：delect.js 顶层 `window={}`/`navigator={}` 在浏览器中静默失败（只读），Node 中直接赋值会覆盖全局。用 `Object.defineProperty(globalThis, 'window', {get:()=>globalThis, set:()=>{}})` 保持只读语义；Hex/Base64/ASN1 通过 `window.XXX=...` 挂到 globalThis（需先预热 `_n('encrypt')` 触发模块加载）。
3. **PRNG 种子**：jsbn SecureRandom 被魔改为确定性 RC4（`ne()` 里 `255 & t` 的 t 是页面全局变量）；Node 中置 `globalThis.t = Date.now()` 模拟即可——**种子不影响服务器校验，任何合法 PKCS#1 填充均可**。

### 风控模型（实测修正版）

1. **蜜月期窗口**：match4/5/6 同源底座；GET `/match/6`（HTML）开窗放行，窗口外返回风控文案
2. **签名层**：m 解密出的 t 必须与 q 最后一段的 t 一致且新鲜（约 10 秒内）
3. **链层（反直觉）**：服务器**不校验**跨请求链状态，每个请求独立用单段链 `"1-{t}|"` 即可全部通过；浏览器端 q 累加只是前端 JS 行为。注意：纯协议下**携带多段链反而被拒**（二分实验证实两段链失败、单段链成功）
4. ~~频率层~~（**误判已推翻**）：不存在页间隔要求——无缝连发 5 页（每请求仅 65ms 纯网络往返）全部通过。"放慢速度"文案的真实含义是签名错误失败累积触发惩罚，与请求速度无关；早期"页间隔 ≥2 秒"结论系惩罚态污染实验的产物（见踩坑 8）
5. **惩罚层**：失败累积进惩罚态后连页面自身请求也被拒（惩罚态污染实验，见踩坑 6/8）
6. **UA 层**：最后一页 UA 必须为 `yuanrenxue`（页面明文提示）

## 踩坑记录

1. **坑：通道层误判（最大教训）** → Python requests / Node https / curl_cffi 失败后归因于 "TLS 指纹深度检测"，结论固化成"只有真浏览器可过"，甚至一度违规交付浏览器自动化方案。正确做法：失败真因是 m 的签名与编码问题；二分实验（page/链长交叉验证）才是定位正解。
2. **坑：m 双层 URL 编码** → encode() 内 encodeURIComponent 一次 + jQuery $.param 一次，手工构造 URL 少一层必失败。requests/curl_cffi 对已含 `%` 的 URL 原样发送，单层编码形态与浏览器不同。
3. **坑：多段链陷阱** → 仿浏览器累加 q 链（"链必须衔接"假设）导致全部被拒。实测单段链（空链起步）恒通过——浏览器行为 ≠ 服务器要求。
4. **坑：阳性对照自身缺陷 → 误判"魔改 PRNG 被服务端校验"** → 对照实验中 browser m 成功 + Python m 失败，曾归因于"服务端校验确定性 RC4 的 PS 序列"。最终证明密文只要公钥/明文/填充标准一致即可被服务器解密，失败实为 Python 侧编码/实现细节问题。阳性对照实验代码必须先与成功样本逐字符 diff。
5. **坑：整秒时间戳红鲱鱼** → 所有捕获的 q 时间戳均为整秒，曾怀疑服务端校验取整。实际是取证环境（ruyipage Firefox）的 Date.now() 归一化特性；整秒与带毫秒的 t 均可通过。
6. **坑：惩罚态污染实验** → session 进入惩罚态后一切参数实验结果均无参考价值；连页面自身 req(1) 都失败。必须先确认页面渲染成功再下结论。
7. **坑：jsbn try-catch 静默吞错** → vm/Node 运行"成功"但签名输出为垃圾（大数解析错乱）。见上方"Node 补环境关键坑"第 1 条，与反模式 8 同类。
8. **坑：频率墙误判（惩罚态污染的另一面）** → "页间隔 ≥2 秒稳定通过"曾是错误结论：当时签名未修复，失败累积进惩罚态，加 sleep 恰好给了冷却时间，被误判为"频率限制生效"；签名修复后无缝连发（65ms/页）全部通过。正确做法：怀疑频率墙时先对照浏览器语义（翻页即点即发、无人工延迟）可直接证伪；"放慢速度"类文案按字面归因前先确认签名正确。

## 可验证事实清单（经验资产）

1. 接口 `GET /api/question/6?page=N&m=<enc>&q=<chain>`，需 `sessionid` cookie，末页 UA 必须为 `yuanrenxue`
2. m 明文 = `"1|" + <13位毫秒时间戳>`，RSA-1024 PKCS#1 v1.5，base64 后 172 字符，URL 中双层编码
3. m 内 t 与 q 末段 t 必须同一个值且新鲜（约 10 秒内）
4. q 单段链 `1-<t>|` 即可全通过；纯协议多段链会被拒（机制未完全探明）
5. AAEncode 颜文字段（1458 字符）解码产物仅 `window.o = 1`
6. RSA 公钥 modulus 1024 位 / e=65537，DER 结构标准，与页面 PEM 一致
7. jsbn SecureRandom 为确定性 RC4（种子 = 页面全局 t 低 8 位），但服务端不校验 PS 内容
8. 蜜月期/惩罚期为 match4/5/6 同源底座；**无页间隔要求**（无缝连发 65ms/页 5 页全通过，签名正确前提下）
9. 惩罚期内连浏览器自身请求也被拒（惩罚态污染一切实验，见踩坑 6）
10. 风控文案 `{"0.0": "风控不通过，别匆忙，放慢速度"}` 不区分具体原因（签名错/超窗/惩罚全同文案），且"放慢速度"字面语义与实测无关（无频率墙）
11. 2026-08-24 验证：5 页数据总和 26274652（纯协议零浏览器依赖）

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/network/ip-risk-control.md` | 会话状态类风控识别专节（蜜月期/频率/惩罚层，本案例实测来源之一） |
| `references/workflow/common-pitfalls.md` | 反模式 13/14（惩罚期污染实验、对照实验纪律） |
| `cases/modified-md5-xhr-done-yuanrenxue.md` | 同平台第 5 题（修改版 MD5 + 同源蜜月期风控） |
| `cases/yuanrenxue-match4-sprite-pixelsort.md` | 同平台第 4 题（雪碧图纯算还原） |
| `references/workflow/common-pitfalls.md` | 反模式 8（try-catch 静默吞错，jsbn am 初始化同类） |
