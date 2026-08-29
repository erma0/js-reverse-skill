# Case：toString 自引用解码 + 环境分派 IV/移位表/加法器的魔改 MD5（猿人学第23题）

> 难度：★★★
> 还原方案：B 最小沙箱（Node vm + 原始 23.js 原码执行 + 4 处环境分支对齐 + 一行导出桩）
> 实现语言：Node.js（final.js；md5 变体不重写、不抠函数，整文件原码进沙箱）
> 最后验证日期：2026-08-29
> 平台类型：match.yuanrenxue.cn 第 23 题「js混淆源码乱码」

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`/match/23/js/23.js`（163864B 单行，obfuscator.io 家族但**短名混淆无 `_0x` 前缀**——a1/a3/Q/zk/yU 等，按 `_0x` 正则识别会漏）；内嵌 axios 风格请求库；自保护陷阱 `VVKAGE→'newState'` / `MKZrLm` 全程高频触发
- **自引用解码（本题最关键识别特征）**：base64 解码器 `g` 内 `q=o+g`（q 为 g 自身 toString 源码），解码条件 `q['charCodeAt'](u+0xa)-0xa!==0x0 ? String.fromCharCode(0xff&s>>(-0x2*r&0x6)) : r`——解码正确性**逐字节依赖 g 函数源码不变**；AST 重写 g 后字符串表解出垃圾 → 轮转 IIFE `parseInt(NaN)` 永不收敛死循环。RuyiTrace 中 Function.toString 对 g/MKZrLm 调用 3121 次即该机制工作痕迹
- 参数特征：`GET /api/question/23?page=N&pageSize=10&kw=&token=<32hex>&now=<13位ms>`；now = `GET /api/getTime` 响应裸数字文本（逐页独立获取）；响应 `{"data":[10 个 6~7 位整数]}` **明文**（与 match22 的 Salted 密文响应不同）
- 诱饵拓扑：内联 script#3 hook `/api/match/number`（永不发送）存 `window.matchnumber`；d() 返回 `m: window[...]` 恒 undefined，被 $.ajax 深拷贝丢弃（wire URL 无 m；debug 文本有 `&m=`）——反模式 27 第 6 次实证
- 风控特征：数据绑定 sessionid；末页(page5) UA=yuanrenxue；提交 `POST /a/23` 表单编码 `{answer}`，`code=2` 通关
- **传输层：本题 Node https 直连可用**（无 TLS 指纹白名单；与 match19 Node 全拦 / match22 全拦到 curl_cffi 才过形成对照——同站不同题风控强度不同，不能默认迁移）

## 加密方案（完整还原，4 浏览器样本逐字节验证）

```
token = md5变体( '/api/question/23' + now + page )      # 30 字符输入, 32 hex 小写输出
now   = GET /api/getTime 服务器毫秒文本
```

md5变体（23.js 内部，原码执行；与标准 MD5 的差异全部来自**环境分派** + 常量魔改）：

1. **环境分派 IV**（取代标准 IV 67452301/efcdab89/98badcfe/10325476，33-bit 值直接参与双精度运算）：
   - `_t = window instanceof EventTarget ? 0x188a7ae93 : 0x26beca73`（window 未定义 → 0x188a627f3）
   - `_u = window instanceof Window ? 0x127794fb3 : 0x26beca73`
   - `_v = typeof WindowProperties==='undefined' ? 0x20d90fe7e : (window instanceof WindowProperties ? 0x188a627f3 : 0x26beca73)` ——**Firefox 不暴露 WindowProperties，真实取证浏览器走 0x20d90fe7e fallback**（trace 全程仅 3 次 instanceof 记录、无第 4 次 = 直接证据；按 Chrome 常识注入该全局反而错）
   - `_w = document instanceof Document ? 0x4a5bc3c6 : 0x26beca73`
2. **移位表分派**：`typeof successAlert==='function' && successAlert` → 标准移位表 [7,12,17,22|5,9,14,20|4,11,16,23|6,10,15,21]；else 打乱移位表（诱饵）。successAlert 由 modallayer 脚本提供——**沙箱必须按 document.html 的 script 顺序加载全部落盘脚本**，只加载 jquery+23.js 会走诱饵移位表（16 字节中 11 字节仍相同，极具迷惑性）
3. **加法器 S(av,aw)**：`document.createElement(...) instanceof Node` → 掩码运算公式（常量 0x7fffffc0/0x7fffffa3/0x61fb6dc/0x3ce68b00/0x3fffffc1/0x400bbfcf/0x7ffff63c/0x3ff837d0/0xc0057e40/0x4000c350 + `ay&az` 值依赖分支）；else → 反篡改分支（console 检测，污染输出）。每次 add 前都会 createElement 一次（单次 md5 260 次探测）
4. **魔改 T 常量 11 处**：T2=0x152e641d9、T11=0x10f0d284e、T24=0x44ec933e、T49=0xf4294954、T50=0x432a6f0f、T51=0xab561297、T53=0x57506143、T54=0x5c00a204、T58=0xfe2cbb20、T62=0xbd318bf5、T64=0xeb86c7d9（其余 53 处标准值）
5. 输出：小端 word→hex 拼接 32 字符 toLowerCase

## 踩坑记录

1. **坑（AST 反混淆产物执行必炸：自引用解码）**：ast-patterns 流水线正常跑完（status ok），但产物在沙箱中轮转 IIFE 死循环——流水线重写了 g 的循环体，`q.charCodeAt(u+0xa)` 读到改写后的源码字节 → 解码垃圾。正确姿势：**obfuscator 家族一律"原码执行 + diff 魔改点"，AST 产物只用于阅读结构**；执行与打桩永远用原始字节文件（反模式 31，detect-patterns 现已内置自引用解码器告警）。
2. **坑（补丁位置约束）**：给原始单行文件注入导出桩/记录器时，改动点不得落在任何被 toString 引用的函数 body 内（g/VVKAGE/MKZrLm 等）；注入在 g 定义之前/之后都安全（toString 内容与在文件中的位置无关）。交付副本 patch 记录 sha256 前后值。
3. **坑（导出桩时序 vs 加载期崩溃）**：函数声明提升只保证"可调用"，导出语句仍按**字节序**执行——23.js 在 col≈79309（内嵌 axios 读 `navigator`、`createElement('a')` 锚点解析器）就崩，导出桩在 col≈152455。正确姿势：prelude 桩补齐到加载不崩（navigator/location/锚点 URL 语义/meta querySelector），导出桩放在所有初始化代码之前到达的位置；`catch(e){ if (导出缺失) throw e; }` 容忍尾部页面逻辑崩溃。
4. **坑（环境分支的"真实浏览器基准"以取证浏览器为准）**：match22 的对拍基准是 Chrome（暴露 WindowProperties），本题取证浏览器是 Firefox（不暴露）——**同站邻题不能迁移"真实浏览器行为"的假设**，一切以本 case 的 trace instanceof 记录为准（无记录 = typeof undefined = fallback 分支）。
5. **坑（jsdom/官方沙箱的默认桩泄漏改变分支）**：run_with_trace bootstrap 的 XHR/HTMLElement/performance/crypto 桩会让内嵌 axios 走错适配器、md5 IV 错位。分支关键型沙箱要用 minimal bootstrap + 完整自备环境模块（`--env-module` + `__overrideGlobal` 受控覆盖，写保护沙箱里直接赋值 document/window 会被静默拦截）。
6. **坑（页面级脚本加载顺序参与算法分支）**：md5 移位表由 `successAlert` 分派——沙箱必须按页面 script 顺序加载 alert.js/modallayer 等全部落盘资源，否则 token "结构极像但错误"（11/16 字节相同），极易误判为"差一点没对齐"而空耗。
7. **坑（低雪崩 token 的判别价值）**：多输入对比 token 仅个位 nibble 差异（run2p1 vs tracep1 相差 142 秒只变 1 字节；甚至 page1/page5 两个不同输入产出**完全相同 token**——弱扩散碰撞，服务端复算同一函数故仍验证通过）。看到这种扩散特性应立即排除"标准 MD5(动态输入)"假设，转向"环境分派 + 逐位置弱扩散掩码加法器"方向。
8. **坑（trace 折叠导致调用计数/输入长度误读）**：浏览器实际调用 md5 2 次（S 调用 543 ≈ 2×260），但 charCodeAt 读数会话只记录 1 组（RuyiTrace 对重复序列折叠）——曾据"只读到 10 字符 `/api/quest`"误判输入被截断，实为 30 字符。以轮函数/加法器调用计数反推真实调用次数。

## 可验证事实清单（经验资产）

1. 固定 sessionid 下 5 页数据和 **29674800**（2026-08-29 两轮独立验证一致；提交 code=2 通关，exp=107）
2. token 公式与 4 样本：`(now=1787994834467,page=1)→3b8a5c771baa9f58504a687278babf35`、`(1787994844133,2)→3b8a5c771c8a9f5851ca687279b29035`、`(1787994485120,1)→3c0a54371c8a9f58514a687279b2d875`、`(1787994976869,1)→3b8a5c771baa9f5850ca687278babf35`
3. IV 值指纹（沙箱可 dump `__iv`）＝ [0x188a7ae93, 0x127794fb3, 0x20d90fe7e, 0x4a5bc3c6]，环境分支对齐验收标准
4. 交付副本 patched sha256 = f8228b702cecd905006c8cd32cf1156b7e00963c291239602bc1cfe73525a3b7（原始 aa4252f4fa0ef567…，唯一改动 = md5 定义后注入 `;globalThis.__md5direct=md5;`）
5. Node https keepAlive 直连可用；末页 UA=yuanrenxue；pages 1-4 正常浏览器 UA；重复提交返回 code=1

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `cases/yuanrenxue-match22-openssl-salted-alphabet-branch.md` | 同接口族（api/question/N + token + now + getTime）；环境分支方法论来源；"同站邻题算法不迁移"的对照（Salted+AES vs 本题魔改 MD5） |
| `cases/yuanrenxue-match21-sm3-variant-decoy-branch.md` | 环境分支诱饵变体（分支指纹对拍法、桩 nativize） |
| `cases/yuanrenxue-match19-tls-fingerprint-blocklist.md` | 同接口族；末页 UA 红线；三级客户端阶梯（本题未触发） |
| `references/workflow/common-pitfalls.md` 反模式 31 | toString 自引用解码器：AST 产物禁执行、补丁位置约束、导出桩时序 |
| `references/workflow/experience-rules.md` 规则 29 | 低雪崩 token 扩散判别 + 自引用解码文件的执行纪律 |
| `references/env/env-debug-loop.md` | 「自引用解码与原码执行」+「trace instanceof 缺席 = typeof fallback 证据」专节 |
| `references/tooling/ruyitrace-cheatsheet.md` | 折叠/elision 与调用计数反推 |
