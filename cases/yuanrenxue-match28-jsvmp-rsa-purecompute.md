# 猿人学 match28：JSVMP 内嵌确定性 RSA-1024（字节码 limbs 直读，纯算无需跑 VM）

- 验证日期：2026-08-31
- 域名：match.yuanrenxue.cn
- 题型：接口 `/api/question/28?page=N&pageSize=10&kw=&token=<172B base64>&now=<13位ms>`；
  token = **RSA-1024 确定性密文**（128 字节）；now 来自 GET /api/getTime（每次翻页重新取）
- 策略：A 纯算还原（Node BigInt 模幂 + JSBN hex2b64），**完全不需要跑 VM**
- 答案：27673886（提交 POST /a/28 表单编码，code=2 通关，exp=176）；**数据绑定 sessionid**（旧会话数据总和 25808383）

> 平台共性（请求/提交链路、末页 UA、sessionid 绑定、getTime 时间源、诱饵参数惯例、风控底座、token failed 语义）统一见 cases/yuanrenxue-match-platform.md；本文只保留本题差异与专属事实。

## 算法链（经 capture 真实样本对拍逐字节验证）

```
明文 = '/api/question/28' + now + '28$' + page      （'28' 是 VM 内部计数器 27+1，固定字面量）
填充 = 00 02 || 01×k || 00 || 明文（总长 128，**固定 0x01，无随机**）
密文 = 明文大数 ^ 65537 mod N（N 由 36 个 28-bit limbs 重建，JSBN 大数）
编码 = JSBN hex2b64（每 3 个 hex 字符 → 2 个 base64 字符，剩余 1/2 hex 特判，'=' 补到 4 倍数）
```

对拍样本：now=1788175391255/page=1、now=1788175403067/page=2 生成的 token 与 target-hits.json
真实样本**逐字节一致** → 算法确认，服务端可复算，无需浏览器。

## 关键坑点（均可复用）

1. **JSVMP 不一定非要黑盒——先扫字节码数字字面量**：28.js 是单行 28KB JSVMP
   （`(function p(n,o,u,t,i,h,c,f,s,r,a){...opcode 分派表...})(<base64|huffman 字节码>)`），
   但字节码尾部形如 `m324665p2098959o9832905...` 的数字序列正是 **JSBN 28-bit limbs**（RSA 模数）。
   先扫字节码找大数字段、判断标准算法族（RSA/AES/哈希），命中即转纯算——黑盒调试（run_with_trace
   与 VM 元编程冲突、逐 opcode 插桩）全是弯路。
2. **确定性 padding 是纯算金矿**：PKCS#1 填充固定 0x01（非随机）→ token 可本地对拍
   （capture 样本 now+page → token 逐字节比对），零成本验证后再发真实请求。
3. **hex2b64 是 JSBN 自定义编码**（3 hex → 2 b64），不是标准 base64，别用
   `Buffer.toString('base64')`。识别特征：trace 中 `Math.floor(0.42857142857142855)`（3/7）分块运算。
4. **limbs 顺序陷阱**：字节码里 limb 字面量出现顺序 ≠ 数组顺序（VM 压栈/构建序），按出现序拼
   模数会得到错误 N（token 长度都对但全拒）→ 用对拍修正数组顺序。
5. **数据绑定 sessionid（换会话必须重算）**：page1 取证样本 [263432,...] vs 新会话 [636803,...]
   完全不同——答案按提交时所用会话重算，通关提交用的就是新会话答案。
6. **站点限流 403 token failed 误判陷阱**：连续数据请求约第 3 页起返回 403 `token failed`，而
   **单请求正常、第 1/2 页正常**——不是签名错，先做 page=1 单请求诊断（200 = 签名对）再放慢节奏。
7. 未登录 sessionid 也能 200 拉数据；提交接口返回 `not login`。
8. 明文可逆向：trace 中 `String.charCodeAt` 逐字符读取拼接串（index 顺序倒着读），可还原明文格式。

## 调试弯路（match28 实证）

- run_with_trace.js 的 bootstrap 桩与 VM 元编程 `(p.v=p.apply).v=p.call` 冲突（Function.prototype
  被包装后报 apply-on-undefined）——此类 VM 直接走纯算，不投入黑盒。
- 给 VM 桩全局 `$` 是画蛇添足：trace 证明浏览器侧 28.js 不访问全局 `$`（原生 DOM + 内部 ajax）。
