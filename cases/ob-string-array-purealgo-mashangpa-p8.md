# Case：obfuscator.io b-io string-array + 环境注入全局解码 + 明文 JSON 纯算签名链（码上爬平台题8）

> 难度：★★★
> 还原方案：A 纯算还原（签名链核心 OOOoOo 逐字节相加卷积 + btoa 全纯算，配合 trace JSON.parse 参数快照直读字符串映射）
> 实现语言：Node.js
> 最后验证日期：2026-09-19
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`pagination8.js`（85019B 单行，obfuscator.io b-io 家族变体，`_0x` 前缀 16 进制索引 + 顶部统一字符串数组 `a0_0x4366`（len=290）+ 旋转 IIFE 终止 `0xcea7c`）；解码器 `a0_0x218b` 为**纯索引解码**（`idx-0x1da`），无 base64/RC4
- 参数特征：请求头 `m`（40 hex）、`t`（Base64 带 `==` 尾）；响应体为**明文 JSON**（非题7 的 `{"r":密文hex}`），含 `problem/pagination/current_array`
- 请求特征：POST `/api/problem-detail/{id}/data/` body `{"page":N}`，referer(/problem-detail/{id}/)、`x-requested-with: XMLHttpRequest`、cookie 含 `sessionid` + 静态 `s=51b351b351b351b370b05171b0903050f070b071f0`（平台置入，不带会触发 "小菜鸡，别爬了"）
- 反调试特征：obfuscator.io string-array + self-defending 同一家族；但**纯采集（非 eval 执行）路线可完全绕开 self-defending 触发**——只需通过 trace 的 `JSON.parse` 参数快照读字符串映射，不执行页面 JS
- 环境注入特征：签名中引用的 `sms/Jms/Sms/Gas/Has/Wms/Tms/Yms/xms/Ras` 等短名全局**不在任何脚本内定义**（pagination8/jquery/crypto-js/base/auto_block/document.html 均无），属平台页面运行时注入的环境全局；`sms` 有效值需从真实样本反推（=6 个 `o`）

## 加密方案

- 路径：A 纯算还原
- 框架：不使用
- TLS 客户端：Node https 直连
- 核心思路：**trace 的 `JSON.parse` 参数快照一次性泄露全部字符串映射**（seq896 中 args 878B JSON 明文含所有短名↔字符串对照，如 `Sms:"xoxoxoxo"`、`xms:"s="`、`Ras:"; path=/;"`、`sms` 所在调用栈指向 m 生成）——零执行反混淆直接得语义；`m=hex6×0xde + 每数字字节(OFFSET0x9f + digit) + 页字节`，`t=btoa(String(Date.now()))`；关键常量 `sms="oooooo"`（6 字节前缀 0xde 各由 `o`(0x6f)+`o`(0x6f)=0xde 推得）

## 踩坑记录

1. **坑（环境全局未在脚本定义但确为签名输入）**：`sms` 等短名全局 grep 全部脚本零定义，一度误判"漏抓脚本"。正确做法：以**请求样本反向推导**——m 前 6 字节 `de` 各=`o`+`o`（0x6f+0x6f=0xde），推得 `sms="oooooo"`，6 字节前缀长度与 sms 长度吻合闭环。
2. **坑（s cookie 静态但仍必带）**：取证 cookie 的 `s=51b351b3...` 在同会话多次请求间恒定、与 ts 无关，属平台预置静态 cookie；不带会 403 "小菜鸡，别爬了"。直接复用取证静态值即可，无需复刻 beforeSend 里的 `document.cookie=xms+OOOoO(Sms+ts)+Ras+u` 动态路径。
3. **坑（controller 端要求"依次翻页到最后"）**：跳页/乱序请求后提交返回 400 `{"status":"error","message":"暂无答案, 请依次翻页到最后一页..."}`。正确做法：**单请求链 page=1..20 顺序翻页到最后一页后立即提交**，中途不得穿插其它 /problem/8/ 页面请求打乱会话游记状态。
4. **坑（频控 403 与封禁文案二义）**：连续快速 20 发后命中 403 `{"error":"访问频率过快，请稍后再试","status":403}`（频率限制），稍后冷却可恢复；校验逻辑及时抛错而非盲跑。限速重试即可，非签名错误。
5. **坑（csrf 页面 404）**：`/problem/8/` 404，csrf 需从 `/problem-detail/8/` 的 HTML `name="csrfmiddlewaretoken"` 动态提取（每次会话 token 不同），不能硬编码取证页面旧 token，否则提交 400。
6. **坑（不执行 JS 也能还原）**：本变体 string-array 旋转 + self-defending 若走 vm 执行会很折腾；**trace 的 JSON.parse 参数快照 + 真实样本推导就这么够了**——b-io 家族优先查 trace 字符串映射快照，再决定是否需要 vm。

## 可验证事实清单（经验资产）

1. `m` 为 40 hex（20 字节），`t = btoa(String(Date.now()))` 为 13 位毫秒时间戳 base64（`t=MTc4OTc2MzA1MTc5Mg==` 对应 ts=1789763051792 MATCH）
2. `m` 结构：6 字节固定前缀 `de`+各 ts 数字字节（`0x9f + digit`）+页字节（`0x9f + page`）；完整算法 `OOOoOo(sms+ts+page, sms)` 中 `OOOoOo(input,key)` 对每个输入字符执行 `String.fromCharCode((charCode(input[i])+charCode(key[i%key.length]))%0x100)` 后逐字节 `toString(16).padStart(2,'0')` 拼 hex（**4 个真实样本全 MATCH**，含 ts=...3051792→`dedededededea0a6a7a8a6a5a29fa4a0a6a8a1a0`）
3. `sms="oooooo"`（6 字节），`key` 即 `sms` 本身；ts 固定 13 位、page 1 位 → m 恒 40 hex
4. 响应为明文 JSON：`{"problem":{title:"题八：迷踪步",...},"pagination":{"num_pages":20,...},"current_array":[10个数字]}`，无题7 的 AES r 字段
5. `num_pages=20`、每页 `current_array` 10 个数字；题目提示"依次向每个接口发起请求，获取接口返回的数组，对元素求和"——**求和不含去重**（答案 96640 与此相符）
6. 提交接口 `POST /problem/8/submit/`：FormData `csrfmiddlewaretoken` + `user_answer`，header `X-CSRFToken`；csrf 取自 `/problem-detail/8/` HTML；提交成功返回 `{"status":"success","message":"答案正确，加10积分..."}`
7. trace（seq896）`JSON.parse` 参数快照泄露完整字符串映射：`Sms="xoxoxoxo"`、`xms="s="`、`Ras="; path=/;"`、`Zms="log"`、`Eas="POST"`、`Gas="headers"`、`Yms="cookie"`、`Ums="padStart"`、`Kas="/data/"` 等全集对照
8. cookie 静态 `s=51b351b351b351b370b05171b0903050f070b071f0`（取证两样本一致，46 hex），与 beforeSend 的动态 cookie 路径无关
9. 多次独立运行（含一次完整 20 页链）`TOTAL=96640` 稳定一致；提交验证 `status=success`
10. b-io 变体解码器为纯索引 `idx-0x1da`（非题7 的 RC4/base64 双变体）；字符串表 len=290，较题7 场景更薄

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/deobfuscation/obfuscation-identify.md` | OB 字符串数组 + 旋转函数还原策略（b-io 变体）|
| `references/network/session-chain.md` | 请求链顺序=会话游记状态（翻页链、csrf 动态获取）|
| `references/network/cookie-generation.md` | 静态 s cookie 与环境注入全局判断 |
| `references/hooks/anti-debug.md` | self-defending 家族（本题走纯采集避开触发）|
| `cases/ob-string-array-selfdefending-mashangpa.md` | 同平台题7：签名链完全不同，证实"平台题号升级逐条核对，不跨题复用算法" |