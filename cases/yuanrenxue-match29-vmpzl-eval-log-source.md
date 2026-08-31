# 猿人学 match29：js混淆源码乱码（vmpzl 三脚本全 VM 化 + RuyiTrace eval 日志直读业务源码 + 魔改 MD5 黑盒）

- 验证日期：2026-09-01
- 域名：match.yuanrenxue.cn
- 题型：接口 `GET /api/question/29?page=N&pageSize=10&kw=&token=<32hex>&now=<13位ms>`；
  token = **魔改 MD5**（K 表被改 + 46 项环境探测分派，不可纯算）；now 来自 GET /api/getTime（纯文本服务器毫秒，每次翻页重新取）
- 策略：B 最小 JS 沙箱——**RuyiTrace eval 分类日志落盘的业务源码**原样执行（绕开 LZ 压缩/字节码/VM 指令三层）
- 答案：27105688（提交 POST /a/29 表单编码，code=2 通关，exp=107）；**数据绑定 sessionid**

## 为什么本题黑盒（而不是纯算）

```
token = 魔改MD5('/api/question/29' + now + (counter + _$v) + '()' + page)
```

- 源码内**搜不到标准 MD5 K 表的任何表示**（十六进制或十进制均无）→ K 表被魔改
- 哈希函数体内嵌 46 项环境探测（`typeof window==="object" && window.window===window`、
  `Object.prototype.toString.call(document)==="[object HTMLDocument]"` 等）参与常量/IV 分派
  → 环境分支必须让全部探测走浏览器路径，逐分支对齐成本高，**黑盒执行最稳**

## 决定性取证：RuyiTrace eval 日志直接落盘 VM 反序列化源码

vmpzl 的 VM 执行到业务层时，会通过 **eval 执行"反序列化生成的 JS 源码"**。RuyiTrace 的
**eval 分类日志**（`logs/eval/trace_eval_process_*.ndjson`）记录该 eval 的完整源码并落盘
`logs/eval/eval_<pid>_<seq>_eval-direct.js`：

| 落盘文件 | 对应 VM 脚本 | 源码大小 |
|---|---|---|
| `eval_<pid>_965_eval-direct.js` | `_jquery.js`（VM 化 jQuery，370KB） | 370619 B |
| `eval_<pid>_1237_eval-direct.js` | `_common.js`（VM 化公共库，48KB） | 48969 B |
| `eval_<pid>_1506_eval-direct.js` | `29.js`（题目逻辑，46KB） | 60732 B |

**破局用法**：
1. 先 grep eval 源码里的 `token` / `case 64`（vmpzl 编译产物里请求 data 构造常在 switch-case 中）
   → 直接读到 `token = _$hal8sh(path + now + (counter + _$v) + "()" + page)` 的拼接点
2. 再逆变量赋值链：`path = "/api/question/" + document.querySelector('meta[name="match_num"]').content`、
   `counter` 初值 28（`case 25: var _$hfhh7a=28`）随翻页 `+=1`/`-=1`、
   `_$v = document.all.pgxDebug || window.pgxDebug ? 1 : 0`（浏览器恒 0）
3. 确认哈希类型：`_$hal8sh` 函数体内有 rotl（`<< | >>>`）+ 32 位加法 + 消息填充
   （`(_$len+8>>6+1)*16`、`128<<...`、`len<<3`）→ MD5 结构，但 K 表缺失 → 魔改 → 黑盒

**eval 源码变量名是 `_$`+随机（每次加载不同）但结构稳定**：token 拼接点在 `case 3` 与 `case 64`
相邻的 switch 里，材料六段（path/now/counter/_$v/"()"/page）以字符串拼接形态固定出现。

## 关键坑点（均可复用）

1. **JSVMP 先查 eval 日志，别手写解压器**（反模式 37）：29.js 字节码是 `LZ.` 前缀自定义 LZ 压缩
   （`$fast_unpack("LZ.xxx")`，base64 字母表标准但加 LZ 头）→ WAFJ 魔数 → VM。手工复刻 LZ 解压
   （bit 流 + 动态码宽）极易出 bug 且毫无必要——eval 日志已把解压后的业务源码直接落盘。
2. **vmpzl 编译产物的三层包装特征**：`eval((function(){...VM 编译器...})())` 包裹 + 尾部
   `$fast_unpack("LZ.xxx")` 自动执行 + 字节码运行时 eval 反序列化。识别「三脚本全 VM 化」
   （页面 _jquery/_common/29.js 全部 eval 包裹）即知 eval 日志会落盘 3 份源码。
3. **环境探测 46 项形态统一**：`typeof X==="..." && X.xxx`（X ∈ window/document/navigator/location/
   globalThis/fetch/Worker/WebAssembly/crypto/performance/...）。桩须让它们**全 true**：
   `Symbol.toStringTag` 给 document/navigator 补 `[object HTMLDocument]`/`[object Navigator]`；
   `document.all` 给 `{}` 且 `pgxDebug` 恒 falsy（否则 `_$v=1` token 全错）。
4. **页面自驱动翻页的 now 注入**（match26 同款再实证）：jq 桩记录 `.on("click")` handler，
   signer 在**每次翻页前注入新的服务器时间**（真实页面每次翻页都重新 `$.ajax({url:"/api/getTime"})`）
   再触发 `#pgxNext` click —— 页面自身走"getTime → 算 token → ajax"链路，天然复用会话内递增计数器。
   沙箱必须跨页复用：token 材料含会话内递增的 counter，重建沙箱会让 counter 回到初值。
5. **jQuery 桩 `.add()` 必须有**（match26 同款坑再实证）：分页渲染直接调用 `$(#pgxPrev).add($(#pgxNext))`，
   缺失报 `xxx.add is not a function` 中断渲染链路。
6. **m 参数诱饵**（反模式 27 第 N 次实证）：`m: window.matchnumber` 恒 undefined，被 jQuery 序列化
   丢弃，真实请求 URL 无 m（debug 文本 `GET /api/question/29?...&m=&token=...` 可见 m= 但发出去没有）。
7. **末页（page5）UA=yuanrenxue**，否则 HTTP 200 + 中文提示数组（交付必须校验 `data` 元素类型）；
   数据绑定 sessionid（同会话数据恒定，两轮抓数完全一致）。
8. **check_final_artifact 的 Session 门禁按调用形态字面识别**：业务方法名（`client.getPage(`）不算
   复用——请求统一走 `client.get(...)`/`client.post(...)`，清理 `httpAgent.destroy()` 才过门禁
   （match29 返工点，与 match18 实测同规则再实证）。

## 交付形态

- Node `final.js`：`new https.Agent({ keepAlive: true })` 会话 → 逐页 getTime → vm 沙箱签名器
  （`src/signer.js` 增量会话，跨页复用）→ `client.get('/api/question/29?...')` → 5 页求和 →
  `client.post('/a/29', {answer})` 表单编码提交
- 环境桩拆 `src/env/browser-objects/{dom,jquery,window}.js`（顶层代码 + 具名函数 <90 行，不包裹
  IIFE——check_code_quality 单函数上限），在 `vm.runInContext` 沙箱内执行（match25 教训）
- 取证源码副本放 `result/src/target/original/29-eval.js`（质量门禁豁免路径）+ sha256 校验
- 离线对拍：`--selftest` 用 case/fixtures 的 (now→token) 真实样本逐字节验证（page1/page2 全匹配）
