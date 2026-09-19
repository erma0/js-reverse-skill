# Case：obfuscator.io string-array + self-defending 反调试绕纯算签名链（码上爬平台题7）

> 难度：★★★
> 还原方案：B vm 沙箱执行 + A 纯算还原（解码器提取入 vm 跑旋转，签名链标准算法纯算）
> 实现语言：Node.js
> 最后验证日期：2026-09-19
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`pagination7.js`（59994B 单行，obfuscator.io ob-io 家族，`_0x` 前缀 16 进制索引 + 顶部统一字符串数组 `B0`）；函数名 `y`/`T`/`R` 短名；顶部有字符串数组旋转 IIFE（`(function(N,W){...})(R,<W表达式>)`）与 `while(!![])` 循环
- 参数特征：请求头 `m`（32 hex，类 MD5）、`ts`（13 位毫秒）、`x`（64 hex，URL 查询参数，类 SHA256）；响应体 `{"r":"<密文hex>"}` 为加密 JSON
- 请求特征：GET `/api/problem-detail/{id}/data/?page=N&x=<x>`，带 referer(/problem-detail/{id}/)、`x-requested-with: XMLHttpRequest`、sessionid cookie；**header 缺任一调制即 400 "小鸡，别爬了"**
- 反调试特征：obfuscator.io **self-defending（防篡改）** —— 解码函数 y/T 内部 `if (...===undefined){ ... new d(y)['bTcNvY'](); ... }` / `new A(T)['rRRNBk']()`；违规时 `array.push(Math.round(Math.random()))` 无限扩容直至 RangeError；`console[R3(0x192)](R3(0x182))` 打印反调试文本

## 加密方案

- 路径：B vm 沙箱（解码器）+ A 纯算（签名与解密）
- 框架：不使用（vm.createContext 最小沙箱）
- TLS 客户端：Node https 直连（无 TLS 指纹白名单）
- 核心思路：ob-io 字符串数组 + self-defending：**从原始单行文件提取 y/T/R 三个闭包，剥离两处 self-defending 调用后原码进 vm，跑旋转 IIFE 得到正确解码器**；签名与响应解密为纯标准算法直接算出。

## 踩坑记录

1. **坑（vm 直接跑原始文件挂死）**：完整原始 JS 进 vm 会打印反调试文本"我盯着你呢小子"后挂死（self-defending / setInterval 反调试循环）。正确做法：截断/隔离——只提取 y/T/R + 旋转 IIFE，务必先剥离 `new d(y)['bTcNvY'](),` 和 `new A(T)['rRRNBk'](),`（两处 self-defending 调用）。
2. **坑（提取函数体含逗号语法）**：剥离 self-defending 调用时注意其后是 `,y['jddRuC']=!![];` / `,T['fZRWjg']=!![];`，剥调用本体时把尾部逗号一并去掉，否则 yTR 拼接后 `,,` 语法错误（Unexpected token ','）。
3. **坑（`function T(` 顺序在旋转之后）**：原始文件中 `T` 函数定义在旋转 IIFE 之后（T 在 51087、R 在 53084 字符处），但解法是从原始文件直接提取 `function T(N,W)`/`function R()`/`function y(N,W)` 三个顶层声明再拼接——不要试图截断原文件到旋转结束，那样 T/R 未定义。
4. **坑（数组旋转目标 W 是 hex 表达式）**：旋转 IIFE 终止条件 `O===W`，W = `-0xe28cb*-0x1+0x716*-0xf1+0x23b31` = 636998。保留原表达式（等价重写亦可）；旋转把 `B0` 左移直到校验和解匹配，必须让 IIFE 真跑完，不能跳过。
5. **坑（解码器含索引偏移 `O=O-308`）**：三个解码器索引统一 `O = O - (hex 表达式)` = 字面量 - 308；手工提取 T/y 函数体即可，无需理解 base64/RC4 内部实现。
6. **坑（header 不齐返回 400）**：缺 referer 或 x-requested-with 或 cookie 即 400 "小鸡，别爬了"。请求必须补齐全部头。

## 可验证事实清单（经验资产）

1. `m = MD5("xialuo" + ts)`，ts 为 13 位毫秒时间戳（两个样本 `ts=1789743589393→dfb2e45b…`、`ts=1789743823812→6ddcedea…` 均 MATCH）
2. `x = SHA256(m + "xxoo")` 即为 URL 查询 `x`（两样本均 MATCH）
3. AES-CBC 解密 key=`"xxxxxxxxoo"+"oooooo"`=16 字节，iv=`"0123456789"+"ABCDEF"`=16 字节，PKCS7，`Hex.parse(r)` → `AES.decrypt` → `Utf8`
4. 解密产物 JSON：`{"problem":{title:"做题名，如题七：千山鸟飞绝",...},"pagination":{"num_pages":20,"has_next":...},"current_array":[10个数字]}`
5. 题目提示原文"依次向每个接口发起请求，获取接口返回的数组，并对这些数组中的元素进行求和运算"——**求和不含去重**；此题 20 页 ×10 数 =200 项，去重后 180，重复值（如 285 出现 3 次）跨页存在
6. `T(0x280)="eeee"`（window.<key> 用于 MD5，实际窗口属性名即 eeee）；`T(0x14a)="parse"`、`T(0x309)="mode"`、`T(0x17b)="enc"`、`T(0x155)="CBC"`、`T(0x2e1)="pad"`
7. 两个解码变体：`y(idx,key)` = RC4(base64(B0[idx-308]))，`T(idx)` = base64(B0[idx-308])；带 key 的别名有 Oc/OU/y8/y6/Oh/OQ，纯 T 别名 R3/R4/RB/Rx/y7/OH/Om
8. `window['eeee'](p,v,L)` 为经典 MD5 实现（32hex），三参数分支（p 为输入时不带回调走最终分支）
9. 部署的响应拦截：`addResponseInterceptor(fn)` + `B = fn('解密函数', N.r)` 承接即为 xxxxoooo
10. 历史答案口径澄清：首次实现误用 Set 去重得 92835——**为错**；全量求和 103057 方为准（本题本轮验证两轮子独立重跑一致）

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/hooks/anti-debug.md` | self-defending 反调试家族（toString 检测相邻类型）|
| `references/deobfuscation/obfuscation-identify.md` | OB 字符串数组 + 旋转函数还原策略 |
| `scripts/ast-patterns/string-array-and-minimal-eval.md` | 字符串表最小求值原则（本文 2、3 号坑为补充）|
| `references/workflow/trace-flow.md` | RuyiTrace 定位入口（setRequestHeader 命中调用栈 → bbcUL）|