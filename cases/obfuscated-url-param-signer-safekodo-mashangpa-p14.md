# Case：safekodo 打包器把签名挂上 `XMLHttpRequest.prototype.open` 重写 URL（码上爬平台题14）

> 难度：★★★
> 还原方案：B 最小 vm 沙箱黑盒执行站方原始签名脚本（CODE4 闭式未还原，黑盒与真机逐字节对齐）
> 实现语言：Node.js
> 最后验证日期：2026-09-20
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：入口页 `if (problemId === 14) document.head.appendChild(<script src="/static/js/xhr.js">)`；
  `xhr.js` 38981B **单行**，打包器标记 `var _0x17w='safekodo.com.V8.2.8'`，解码器形如
  `function __sk_Q(G,F){const z=__sk_z();...}`；常量以**算术表达式**编码（`-0x110f+-0x22dc+0x33ef`）、
  属性名以 `\xNN` 转义；内部函数名 5 字符随机（`dUltK`/`fDawx`/`BohQq`）；**非 ob-io 字符串数组家族**
- 参数特征：签名是 **URL query 参数 `m`**（24 字符 base64），**不是 header、不改 body**；
  `m = base64( CODE4 + String(ts) + "\u0000" )`（明文 18 字节，标准 base64 字母表，解码后 NUL 结尾）
- 请求特征：`POST /api/problem-detail/14/data/?m=...`，body 仍为裸 JSON 串 `{"page":N}`（**数字值**，
  与题13 的字符串值不同）；需 referer + `x-requested-with` + sessionid
- 拒绝特征：缺 `m` → **HTTP 200** + `{"code":"400","message":"小鸡，别爬了"}`（72B）；成功 → 200 + 641B
  （键固定 `problem`/`pagination`/`current_array`）
- 竞态特征：与题13 同族但**非恒定**——ruyipage 两轮复现裸发，RuyiTrace 轮次 xhr.js 抢先执行成功

## 加密方案

- 路径：B 最小 JS 沙箱黑盒（CODE4 = H(ts) 为打包器内部哈希，闭式未还原）
- 框架：不使用；交付侧 Node 原生 `https`（keepAlive Agent）+ `node:vm`
- TLS 客户端：Node 原生 `https`（首次直连即通过，无 TLS 指纹校验）
- 核心思路：签名写入点是 `Object.defineProperty(XMLHttpRequest.prototype,'open',{value:function(b,f,...){f=x(f);Z.call(this,b,f,...)}})`
  ——**只重写 URL**。沙箱里放一个记录 `open` 入参的 XHR 原型桩，加载站方原始 `xhr.js` 后
  直接 `new StubXHR().open('POST', url)` 即取出改写后的 URL 与 `m`，无需真实 jQuery

```text
ts    = new Date().getTime()          // 13 位毫秒全精度；Date.now() 不参与（桩 Date.now 无效）
CODE4 = 4 位小写十六进制，取值域恰 16 个固定值：
        1019 10c7 117a 11a4 1201 12df 1362 13bc 1428 14f6 154b 1595 1630 16ee 1753 178d
      结构 = (0x10+a)<<8 | (b[a] ^ (c ? 0xDE : 0))，a∈0..7、c∈{0,1}（即 4 bit 索引）
      CODE4 = H(ts) 确定性：桩 Date 构造器冻结 ts 后连续 12 次调用 CODE4 不变
```

## 踩坑记录

1. **坑（把题13 的「恒定竞态」结论跨题套用，差点误判降级）**：题13 是冷/暖缓存各采一次均复现的恒定竞态；
   题14 在 ruyipage 两轮复现裸发后，**RuyiTrace 轮次却采到两组带签名成功样本**。
   → 竞态是时序性的，**换采集工具本身就会改变时序**；判「恒定」前必须换工具重采一轮。
2. **坑（`--targets` 把 HTTP 200 业务拒绝当终态命中，取证提前收尾）**：终态判定按「非 OPTIONS 2xx」，
   被拒请求也是 200 → 脚本在首个**被拒**请求上进入收尾窗口，`--click`/`--click-delay` 驱动的后续请求永不发生。
   → 分页类目标先读 `target-hits.json` 响应 body 确认业务成功；预期首屏被拒时去掉 `--targets` 改用 `--settle`。
3. **坑（在宿主桩 `Date.now` 对 vm 内目标 JS 无效，fixture 对拍全 FAIL）**：签名取时入口是 `new Date()`，
   且 vm context 有**独立 realm 的内建对象**，宿主 `globalThis.Date = X` 完全不生效，且无任何报错。
   → 冻结时间必须写 context 侧：`vm.runInContext('Date', sandbox)` 取 realm 原生 Date 再覆盖 `sandbox.Date`，用完还原。
4. **坑（锁 `Math.random` 定值当通用探针，误判 CODE4 是随机盐）**：题13 的 `r` 锁 0.5 即复现；
   题14 锁 `Math.random` 后 CODE4 照变（沙箱里 `crypto` 是 undefined，熵不来自 WebCrypto）。
   → 「锁随机源」只对真随机参数有效；锁完仍变说明是确定性哈希，下一步应锁**时钟**而不是继续找随机源。
5. **坑（会话 Cookie 缺 `name=` 前缀）**：裸 `sessionid` 值直接当 Cookie 头发出 → 服务端按匿名会话应答，
   `current_array` 变成 16 长度非数组，表象像解析/算法问题，实为凭据格式问题。
   → 凭据注入做规范化（裸值补 `name=`，已含 `=` 原样透传），报错信息带会话阶段。
6. **坑（`status:info` 被当失败）**：重复提交返回 `{"status":"info","message":"你已经完成过这道题目了..."}`，
   按 `status!=='success'` 判失败会把「已成功过」误报成还原失败。
   → 平台提交结果三态：`success` / `info`(已完成，退出码 0) / `error`(答案错)。

## 可验证事实清单（经验资产）

1. `m = base64( CODE4 + String(ts) + "\u0000" )`，明文 18 字节 = 4 + 13 + 1，标准 base64 字母表。
2. `ts = new Date().getTime()` 全精度；`Date.now` 不参与。
3. `CODE4` 取值域**恰 16 个值**（见上）；同一 `a` 的两成员恒相差异或 `0xDE`（8 对配对结构）。
4. `H` 闭式未还原：520 组受控 ts 样本排除 `ts%2^k`、`ts>>>k&15`、digit-sum、djb2/FNV、字节异或折叠、
   GF(2) ≤3 项线性组合（单比特最佳仅 56%）。
5. writer：`xhr.js` `1:16763` 的 `defineProperty(XMLHttpRequest.prototype,'open')`；原版 `open` 在 `1:14048` 保存；
   拼接点 `fDawx(CODE4, ts)` @ `1:16605`（jscall_detail seq 7134 实测 `args=["16ee",1789868827328]`）；
   base64 编码器自研（`1:10476` 逐字符拼接 + `1:10806~11109` 辅助），不依赖 `btoa`。
6. 沙箱最小环境（`missingGlobals`/`runtimeErrors` 全空）：XHR 原型桩、`Date`、`window`/`self` 自引用、
   定时器 no-op、最小 `document`、`navigator.userAgent`、`location`；**不需要** `crypto`/`fetch`/`localStorage`/
   `sessionStorage`/`performance`/`WebAssembly`/真实 jQuery。
7. 对齐证据：以两组真机 ts 驱动沙箱，`m` **逐字节一致**（`compare_fixture` 退出码 0）→ 黑盒分支与真机一致，
   非诱饵变体；真机出现过的 `11a4`/`16ee` 均落在沙箱输出集合内。
8. 答案口径：20 页 × 10 元素 = 200 项**全量求和不去重**；答案按分钟窗口轮换
   （相隔约 2 分钟实测 103291 / 99128）→ 取数与提交必须同运行同窗，`pageIntervalMs=0`（20 页约 2 秒，无频率墙）。
9. 提交链：`POST /problem/14/submit/`，`multipart/form-data`（`csrfmiddlewaretoken` + `user_answer`）+
   头 `X-CSRFToken`；成功 `{"status":"success","message":"答案正确，加10积分..."}`。
10. `current_array` 元素为整数（如 `[676,145,820,413,69,84,31,791,884,126]`）；`m` 不含页码，服务端不校验请求序号。

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/trace-flow.md` | 「签名脚本注入竞态」非恒定性修订 + 翻页取证第 ④ 坑（`--targets` 业务拒绝当终态） |
| `references/env/env-debug-loop.md` | vm realm 边界：时间冻结必须 context 侧，宿主 `globalThis.Date` 不跨 realm |
| `references/workflow/experience-rules.md` | 规则 48（锁随机源 vs 锁时钟探针二分法 + 小值域折叠索引信号） |
| `references/workflow/experience-rules.md` | 规则 36（数据每次请求随机 → 同运行取数即提交）本题第二次实证 |
| `cases/obio-md5-header-triple-script-inject-race-mashangpa-p13.md` | 同平台题13：竞态同族但恒定；头名/参数形不可跨题复用 |
| `cases/ob-string-array-modified-sha256-blackbox-mashangpa-p10.md` | 同平台题10：B 沙箱黑盒交付同路径 |
