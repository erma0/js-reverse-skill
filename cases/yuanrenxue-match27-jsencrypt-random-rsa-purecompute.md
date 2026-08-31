# 猿人学 match27：js混淆源码乱码（336KB 短名混淆内嵌 JSEncrypt，随机填充 RSA-1024 纯算）

- 验证日期：2026-09-01
- 域名：match.yuanrenxue.cn
- 题型：接口 `GET /api/question/27?page=N&pageSize=10&kw=&token=<172B base64>&now=<13位ms>`；
  token = **RSA-1024 公钥加密密文**（128 字节，PKCS#1 v1.5 **随机**填充）；now 来自 GET /api/getTime（纯文本服务器毫秒，每次翻页重新取）
- 策略：A 纯算还原（Node `crypto.publicEncrypt` + 内嵌 X.509 SPKI 公钥），**完全不需要跑 336KB 混淆沙箱**
- 答案：26217857（提交 POST /a/27 表单编码，code=2 通关，exp=131）；**数据绑定 sessionid**

## 算法链（X 值扫描实证 + 服务端 200 闭环确认）

```
明文 = '/api/question/27' + now + '27' + page     （'27' = X = N + window._$v，运行时固定常量，扫描实证）
公钥 = 27.js 内嵌 X.509 SPKI hex（pubkey1，E=65537，N 128B）—— 非 JSBN limbs，是标准 DER 公钥
填充 = PKCS#1 v1.5 随机填充（jsencrypt 默认，crypto.getRandomValues(Uint32Array 256) 为随机源）
token = crypto.publicEncrypt({ key: <SPKI>, padding: RSA_PKCS1_PADDING }, Buffer.from(明文)).toString('base64')
```

- 27.js（336KB，短名混淆 + DOM API 字符串拼接构造）加载时 `crypto.getRandomValues(Uint32Array length=256)`
  → **随机填充源**（非确定性 RSA，token 每次不同属预期，无法字节级对拍）
- 公钥提取：混淆代码里 `30819f300d06092a864886f70d01...`（rsaEncryption OID 头）开头的长 hex 字符串
  就是 X.509 SPKI DER，`indexOf(Buffer.from([0x02,0x81,0x81,0x00]))` 定位 N
- 27.js 内嵌**两把**公钥（pubkey1/pubkey2），加密函数 ui() 按运行时布尔选择；**实测 pubkey1 被服务端接受**（pubkey2 全 403）

## 关键坑点（均可复用）

1. **X.509 SPKI hex 公钥 + getRandomValues = JSEncrypt 随机 RSA（与 match28 的 JSBN limbs 确定性 RSA 互补）**：
   识别特征三件套——①混淆代码内 `30819f300d06092a864886f70d01...` 开头的 162 字节 hex（标准 SPKI）；
   ②加载期 `crypto.getRandomValues(Uint32Array 256)`（PKCS#1 随机填充源）；③token 128B/172 字符标准 base64。
   → Node `publicEncrypt` 直出，无需沙箱。
2. **明文含运行时未知常量时用「候选 X × 候选公钥」扫描实证**：match27 明文里 X = N + window._$v 是
   混淆代码计算的运行时常量（无法静态确定），且有两把公钥候选——用 `publicEncrypt` 对
   X ∈ {0..123} × {pubkey1, pubkey2} 各生成 token 发真实请求（每请求 300ms 间隔防限流），
   找到 200 的那组（pubkey1 + X=27）。**X=28 失败、pubkey2 全 403 → 服务端校验明文确切值**，零猜测成本。
3. **沙箱跑通 + token 结构像 ≠ 服务端接受**：先写 vm 沙箱（jQuery 桩 + crypto 真随机）跑通 27.js
   自动生成 5 页签名，但沙箱 token 全 403——根因是 `_$v` 依赖 `document.all["pgxDebug"]` 环境分支，
   桩导致运行时常量算错（N+_$v≠27）。**当算法可纯算（公钥可提取）时，直接转纯算 + X 扫描实证，
   不要死磕沙箱环境对齐**（与 match21/26 的"环境分派诱饵分支"、match25 的"realm 自检"都不同：
   这是"环境依赖的数值常量"）。
4. **jQuery 桩 Proxy 缓存坑**：用 Proxy 给 jq 桩兜底缺失方法时，`__jqCache` 必须**缓存 Proxy 本体**
   而非原始 obj——否则同 key（如 `String(DOM元素)` = `[object Object]`）二次访问拿到裸对象，
   缺失方法（toggleClass）直接 `s[h] is not a function`，极易误判成"页面代码问题"。
5. **m 参数诱饵**（反模式 27 第五次实证）：`m = window["matchnumber"]` = undefined（`o+c+d` 拼接
   "matchnumber" 而非题目号），被 jQuery `$.param` 丢弃，真实请求无 m——trace 的
   `Object.prototype.toString` data 对象全文可见 `"m":"undefined"`。
6. **站点限流**（反模式 36 同族）：扫描实验连续 20+ 请求触发 429 too many requests；页间 3s +
   冷却 3~4 分钟；提交用 `--submit --answer <总和>` 单请求解耦。
7. **末页（page5）UA=yuanrenxue**，否则 HTTP 200 + 中文提示数组；数据绑定 sessionid
   （同会话数据恒定，page1 与取证 fixture 逐字节一致）。

## 调试弯路（match27 实证）

- 先做 vm 沙箱黑盒（jq 桩 + 页面自驱动翻页）跑通签名，再反推纯算——沙箱本身能自洽产出全部 5 页
  token 且结构全对（172 字符 base64），但 403；若一开始就从 trace 的 `Object.prototype.toString`
  data 对象全文 + 公钥提取直接走纯算 + X 扫描，可省掉整个沙箱环节。
- 扫 `getRandomValues` 误以为是"生成 RSA 密钥对"（256×uint32=1024B），实际是 PKCS#1 随机填充源——
  `Window.get crypto` 后紧跟 `getRandomValues(Uint32Array 256)` 且无 `crypto.subtle` 调用 = 纯 JS 加密
  库的随机源，不是 WebCrypto 加密。
