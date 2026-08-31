# Case：vmpzl 1.5.1 JSVMP 黑盒 + 状态数组常量偏移（XOR 30）就地修正（猿人学第24题）

> 难度：★★★★
> 还原方案：B vm 沙箱黑盒执行（Node vm + 原始 24.js 原码 + 最小环境桩 + 一处 TL 状态修正探针）+ E 桥式交付（Python requests 承担 HTTP）
> 实现语言：Python（final.py，HTTP）+ Node.js（bridge-vm.js，纯计算产 token）
> 最后验证日期：2026-08-31
> 平台类型：match.yuanrenxue.cn 第 24 题「js混淆源码乱码」

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`static/new_match/question/24/24.js`（22975B 单行，**vmpzl ver.1.5.1** JSVMP，阿拉伯变体字符标识符乱码混淆；与 match18 的 jsvmpzl v1.1.3 同族升级）；字符串表 `"ReferenceError(g(c(...".split("(")` 64 项；`Function.prototype.cilame_call = Function.prototype.call`；`new RegExp('[0-9a-f]{2}','g')`；`new Date()` 装入 VM 帧
- 参数特征：`GET /api/question/24?page=N&pageSize=10&kw=&token=<part1>|<part2>&now=<13位ms>`；now = `GET /api/getTime` 服务器毫秒文本；响应 `{"data":[10 个 6~7 位整数]}` 明文
- **token 结构**：`part1`（base64，约 24 字节）+ `|` + `part2`（密钥材料去重值序列 + 单字母间隔标记 `a`-`g` + `*`，数字集合 = 去重后的 TL 值）
- 诱饵拓扑：内联 hook 拦截 `/api/match/number`（`m=window.matchnumber`），真实数据请求不含 `m`（反模式 27 第七次实证）；`favicon.ico` 为真图片
- 风控特征：数据绑定 sessionid；末页(page5) UA=yuanrenxue 且**要求 token 生成环境 UA 同步为 yuanrenxue**；提交 `POST /a/24` 表单编码 `{answer}`，`code=2` 通关
- **传输层：Node https 直连被 TLS 指纹黑名单拒绝**（POST /a/24 实测 ECONNRESET，与 match19 一致）——HTTP 全部交给 Python requests，token 由 Node 沙箱纯计算产出经子进程桥交付

## 加密方案（黑盒执行 + 一处状态修正，6/7 组真实 token 逐字节验证）

VM 内部状态数组 `time_list`（下称 **TL**，41 元素，由 VM 分发器第一个形参的 `[1][0]` 直达）是本 case 的关键结构：

| 区段 | 含义 |
|---|---|
| TL[0..5] | 构建时钟的 base-127 低位（低位在前，`t = Σ d[i]×127^i`） |
| TL[6..40] | 材料的变换输出；材料 = `/api/question/24` + `now` + `page`（30 字符） |

变换：`out[i] = charCode(material[i]) XOR K[i]`，`K` 是**前缀链式密钥流**——实测 K[0..17] 与构建时钟、材料均无关（固定常数），K[18+] 随材料链式推进。所以变换输出必须靠 VM 实跑，无法静态推导。

**根因（本案唯一难点）**：沙箱与浏览器的差异**只有一个常量**——TL[11..]（材料第 5 字符起）恒差 `XOR 30`：

```
浏览器 TL[6..20] = [7,7,7,6,7, 65,15,30,7,65,31,27,11,29,26]
沙箱   TL[6..20] = [7,7,7,6,7, 95,17, 0,25,95, 1, 5,21, 3, 4]
逐位 XOR         = [0,0,0,0,0, 30,30,30,30,30,30,30,30,30,30]
```

位置 0-4 完全一致、5 起全部差 30 —— 这是**一次性注入的状态偏移**（VM 加载期解码链的状态初值落点），不是逐步发散的链式差异。补环境无法消除它，正确做法是**在 VM 输出上就地修正**。

**修法**：在 24.js 分发器入口（源码锚点 `ﱢﱠ){`，全文件唯一）注入一段探针，对 `[1][0].time_list` 下标 ≥11 逐元素 XOR 30，并用**不可枚举属性 `__mx` 记录已处理长度**防止数组增长时被重复异或。修正后由 VM 自行完成后续序列化，产物与浏览器逐字节一致。

## 踩坑记录

1. **坑（把常量偏移当"未知环境读取"逐环节对齐，越查越偏）**：攻坚前 17 轮一直把失败归因为"某个未知的环境读取/解码键链分岔/解码树偏移分歧"，范围越查越大。真正破局是**把两侧输出做逐位 XOR 而不是逐位比较**——差值是常数 30 → 一次性状态偏移 → 就地修正即可，省下十几个轮次。这 17 轮里第 12 轮"解码正确、分歧在编码期"的判断其实是对的，后续几轮退回追解码键链是被不同构建/页码的缓存混在一起对比误导（反模式 32）。
2. **坑（VM 探针太重直接 OOM/卡死）**：VM 分发器每条指令都会调用一次，递归扫描版探针在数百万次调用下 OOM。先定位内部状态的**直达路径**（分发器第一个形参的 `[1][0].time_list`），探针只剩 3 次属性读取，单次运行从 58s 降到 0.5s。
3. **坑（钩子装在错误的 realm）**：`vm.createContext({})` 有独立内建对象，在主 realm 上改 `String.prototype.charCodeAt` 对沙箱完全无效——钩子必须用 `vm.runInContext` 装进沙箱 realm 内。
4. **坑（修正输入而不是输出）**：改 `charCodeAt` 让材料字符变形是错的——链式密钥流会跟着变形而发散（输出位置 5-9 不变、10-14 变、15+ 又乱）。正确做法是等 VM 算完中间数组再就地修正，让 VM 自己完成序列化。
5. **坑（一次构建 5 页拖出伪需求）**：一次构建 5 页要依次派发 4 次点击，耗时 7.6s，超出服务端时效窗口（实测 age≤2s 通过、≥4s 拒绝）→ 403。第一反应是"加时间补偿"，实测窗口后才发现**只点目标页（跳过中间页）0.8~2.1s 天然落在窗口内**，补偿/重试全是自己造出来的复杂度。中间页能跳过是因为 K[0..17] 固定、K[18+] 只由材料链式推进，与翻页历史无关（规则 31）。
6. **坑（缩放时钟放大忙等）**：沙箱用 1/20 缩放时钟，getTime 桩里的 30ms 忙等在缩放时钟下等于 600ms 真实耗时——这是"一次构建 5 页要 7.6s"的直接来源；已实证去掉忙等后 token 仍逐字节正确。
7. **坑（探针加属性污染序列化）**：给 time_list 数组加可枚举属性会污染 VM 状态快照，触发循环引用 JSON 序列化崩溃；必须用 `Object.defineProperty(..., {enumerable:false})`。
8. **坑（ruyipage 重写 profile 的 user.js）**：tier-pin 的三层 pref（`javascript.options.blinterp/baselinejit/ion=false`）写在 user.js 里会被 ruyipage 每次启动重写冲掉，写 prefs.js 也不生效——只能**不经 ruyipage 直启 firefox**（subprocess 直启 + `attach_exist_browser` 驱动，或用 `capture_ruyitrace_log.js --pref` 由脚本自己 spawn）。此外 `tier=jit` 的 opcode 记录只有 pc 没有栈值，带栈对拍必须先 tier-pin（325 万条里仅 91 条 interp 带值）。
9. **坑（跨构建解码缓存混对比 → 假分歧）**：VM 解码缓存跨构建累积、页码=密钥选择器，把不同页码/不同构建序号的 {c,v} 集合混在一起对比，得出"解码键链分岔/常量池差异/诱饵编解码器"三个假结论（各耗数轮）——对拍前必须锁同源（反模式 33）。
10. **坑（jQuery expando 固定副本）**：VM 读取的 jQuery expando（`jQuery341062000212550838322`）是每次页面加载随机的，服务端只校验 token 结构自洽不校验其精确值——补环境时按**格式正确 + 运行时随机**生成即可，不必（也不能）固定对齐（规则 32）。

## 可验证事实清单（经验资产）

1. 固定 sessionid 下 5 页数据和 **25650736**（提交 code=2 通关，exp=176）
2. 修正后 `final.py fetch` 5 页全部 200，age 为 668/1945/1937/1952/1932ms；sum=25650736
3. 逐字节复现：冻结沙箱构建时钟到真实 token 的 build（build−now ∈ [−459,+170]ms，由 part2 数字集合反推），产物与 6/7 组真实 token 的 part1+part2 完全一致；第 7 组为浏览器会话解码缓存态差异（沙箱自身会话状态自洽，不影响交付）
4. 常量偏移 = **XOR 30**（TL[11..] 起）；K[0..17] 固定 = `[40,102,119,111,40,46,100,101,106,43,104,106,123,44,54,45,46,41]`（K[5..17] 与浏览器差 30）
5. 时效窗口实测（同一 token 递增延迟重放）：age=736ms/2019ms → 200；age=4016/6016/8015ms → 403
6. 原码 sha256 = `f6130cf8...`（24.js 一字未改）；TL 修正以运行时注入探针实现，不落盘改原码

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `cases/yuanrenxue-match23-selfref-decoder-env-dispatch.md` | 同接口族（api/question/N + token + now + getTime）；「环境分派 + 低雪崩 token」的方法论同族，但本题分歧形态是**常量偏移**而非分支选择 |
| `cases/yuanrenxue-match18-jsvmp-mouse-gated-signature.md` | 同族 vmpzl（v1.1.3 → 1.5.1 升级）；JSVMP 沙箱语义坑（静默退出/内建自有属性） |
| `cases/yuanrenxue-match19-tls-fingerprint-blocklist.md` | TLS ClientHello 黑名单 → 桥式交付语言切换（Python requests + Node 沙箱桥） |
| `references/workflow/experience-rules.md` 规则 30/31/32 | 沙箱对拍逐位 diff 判分布（常量偏移就地修正）；约束边界先实测（LEAD_MS 伪需求）；随机环境值格式正确+运行时随机（expando） |
| `references/workflow/common-pitfalls.md` 反模式 32/33 | 常量偏移被误判为未知环境读取；跨样本对拍未锁同源（解码缓存跨构建累积） |
| `references/tooling/ruyitrace-cheatsheet.md` | opcode 级 trace + 带栈采集（STACK_FULL/STACK_SLOTS 盲区）；tier-pin 的 blinterp pref 名；tier=jit 无栈值；判读三形态 |
| `references/tooling/ruyi-tooling.md` | 闸门窗口 + 外部驱动采集（--gate/--pref/--max-log-bytes；ruyipage 重写 user.js 的坑） |

## 对 skill 的贡献（2.3.89 固化）

- **脚本**：`capture_ruyitrace_log.js` 新增 `--user-js/--pref`（Firefox 层 pref 通道，tier-pin 不再需要绕过脚本直启）、`--gate/--gate-after/--gate-duration`（运行时闸门脚本化，不再需要手写 gated_capture）、`--max-log-bytes`（采集期日志体积熔断，补上文档要求但缺失的能力）；顺带修复 2.3.88 的 JIT_OPTION_ 驼峰名正则 bug。
- **方法**：反模式 33（跨样本锁同源）、规则 31（约束边界先实测）、规则 32（随机环境值格式+随机）；cheatsheet 判读形态扩为三种（常数/发散/值互换）+ 带栈前置条件。
