# Case：webpack 打包 + 轻度 obfuscator.io 混淆 + HmacSHA1 签名 + base64 时间戳（码上爬平台题9）

> 难度：★★★
> 还原方案：A 纯算还原（标准 HmacSHA1 + base64，无需沙箱）
> 实现语言：Node.js
> 最后验证日期：2026-09-19
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：webpack 打包 bundle + 轻度 obfuscator.io 字符串数组混淆（`_0x` 前缀）；页面同时加载 crypto-js.js（91728B）；字符串表含 `"RIPEMD160"`、`"9527"`、`"Error fetching problem details:"`、`"Native crypto module could not be used..."` 等提示
- 参数特征：POST JSON body `{"page":N,"m":"<40hex>","tt":"<base64>"}`；`m` 40 hex = SHA-1/RIPEMD-160 族；`tt` 为 base64 编码的时间戳字符串
- 请求特征：POST `/api/problem-detail/9/data/`，Content-Type: application/json、`x-requested-with: XMLHttpRequest`、Referer `/problem-detail/9/`、sessionid cookie；响应明文 JSON 含 `current_array`（10 元素/页）与 `pagination.num_pages=20`
- 反调试特征：轻度 OB 字符串数组（无 self-defending）；**死代码陷阱**——bundle 内 `init:function(n,r){...t(763)==t(763)...}` 恒真判断的 else 分支含伪造 `.m=`/`.tt=` 赋值 switch，恒不可达

## 加密方案

- 路径：A 纯算还原
- 框架：不使用（标准 crypto 直接复现）
- TLS 客户端：Node https 直连（无 TLS 指纹白名单）
- 核心思路：`m = HmacSHA1("9527" + ts, "xxxooo")`（40 hex），`tt = base64(String(ts))`，`ts = Date.now()` 13 位毫秒。标准算法直接 `crypto.createHmac('sha1', 'xxxooo')` 复现，无魔改、无需沙箱。

## 关键定位方法

1. **trace 常量命中**：RuyiTrace jscall 日志（seq 39416-39493）中 `eEEhN("9527", ts)`→`"9527"+ts`（callee_column:240078）→ `crypto-js.js` `_createHmacHelper/<`（line 200，key `"xxxooo"`）→ `c("9527"+ts)` 输出 40hex 与 m 一致；bundle 内明文 `dd.aa[...](n,"xxxooo")` 佐证 key。**签名特征常量（如前缀 "9527"）直接进 jscall 日志搜索即可命中构造点**。
2. **真实 builder 位置**：签名在 `$.ajax` 前缀 hook 内（switch case "3"→tt / "0"→m / "6"→header），**不在** webpack 模块的 `loadPage` 函数里。

## 踩坑记录

1. **坑（死代码伪造赋值）**：bundle 内 `init` 函数 `t(763)==t(763)` 恒真走 if 分支，else 分支的 `.m=`/`.tt=` 赋值 switch（`_0x42274a[...].m=u[t(715)](...)`）**恒不可达**，把阅读者引向错误构造点。→ 正确做法：签名构造点以 RuyiTrace jscall 实际调用链为准，bundle 内可疑赋值先验证可达性（恒真/恒假判断两侧）。
2. **坑（找 builder 找错文件）**：base.js 不含 `loadPage`，真实逻辑在混淆 bundle 内。→ 正确做法：用 trace 的 callee_column 直接定位实际执行函数。
3. **坑（SHA-1 与 RIPEMD-160 同长）**：40 hex 无法仅凭长度区分 SHA-1 / RIPEMD-160 / 自实现。→ 正确做法：trace 命中 `_createHmacHelper` 即可确认 HmacSHA1，不必先猜族。
4. **坑（提交时效）**：答案需在 1 分钟内提交，超时需重新拉取。→ 正确做法：先顺序翻页采集全部 20 页数据，再提取 CSRF（GET `/problem-detail/9/` 的 `name="csrfmiddlewaretoken"`）并立即提交。

## 可验证事实清单（经验资产）

1. 样本1：ts=1789771100516 → m=`d2ce859a115f817ed79ee2f922a88a03b7dd1285`，tt=`MTc4OTc3MTEwMDUxNg==`
2. 样本2：ts=1789771162316 → m=`5a424eb5b7b3b68c267ba4fbc09d475154358b79`，tt=`MTc4OTc3MTE2MjMxNg==`
3. `m = HmacSHA1("9527"+ts, "xxxooo")`，标准 `crypto.createHmac` 直接复现两样本 MATCH
4. `tt = base64(String(ts))`（btoa 对 number 自动转字符串），标准 Buffer.toString('base64') 复现
5. 数据接口 POST `/api/problem-detail/9/data/`，响应明文 JSON，20 页 × 10 数求和 TOTAL=99516 提交 success 加 10 分
6. 题9 数据稳定（跨请求同页数组一致，可作 fixture 回归）——与题10 的"每次请求数组随机"完全不同，**同平台逐题验证数据稳定性**
7. 提交表单字段 `csrfmiddlewaretoken` + `user_answer`，CSRF token 从 GET `/problem-detail/9/` HTML 提取
8. 同平台题7（MD5+SHA256+AES）、题8（卷积+btoa）、题9（HmacSHA1+base64）签名链各不相同，**不跨题复用算法**

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `cases/ob-string-array-modified-sha256-blackbox-mashangpa-p10.md` | 同平台题10：数据每次请求随机 vs 题9 数据恒定 |
| `cases/ob-string-array-purealgo-mashangpa-p8.md` | 同平台题8：签名链完全不同 |
| `references/workflow/trace-flow.md` | RuyiTrace 定位签名构造点（常量命中） |
| `references/workflow/experience-rules.md` | 规则 36（数据绑定会话）/ 反模式 18（数据差异误判） |
