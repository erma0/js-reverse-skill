# Case：瑞数 v3 变种 boot+api2 配套解密 + XHR 劫持自动签名 vm 沙箱纯协议还原（猿人学第10题）

> 难度：★★★★★
> 还原方案：B vm 沙箱执行 + D 环境伪装（黑盒运行 rs.js / boot / core 全链，不还原 JSVMP 字节码）
> 实现语言：Node.js（vm 补环境 + 原生 https）
> 最后验证日期：2026-08-26（纯协议 5/5 页，三轮复跑总和恒定 29178743）
> 平台类型：猿人学练习平台（match.yuanrenxue.cn）
>
> 历史注记：本案例曾经历两个错误阶段并已终局修正——① 2026-08-25 浏览器黑盒取数违规（反模式 20，中途交付）；② 同期因「浏览器 200 + 外部 400」固化归因「TLS 指纹/会话强绑定封死纯协议」（反模式 11）。终局证明两个结论均错误：外部 400 真因是 m 动态段内容错误（boot+api2 不配套），Node 原生 https 直连全通。误判修正明细见下方「历史误判与修正」。

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`$_ts['dfe1675']`（rs.js 内置）+ `$_ts['dfe1683']`（/api2/10 下发 318KB 密文）双字符串表；HTML 第 9 个 `<script>` 为 73KB boot 引导器（`yuanrenxue_*` 前缀混淆 + `jsjiami.com.v6` 标记 + while(1) 控制流），**每次渲染内容不同**；rs.js 主体 ÿ 字符混淆（98KB 黑盒）；boot 流式解密拼出 238KB core（`_yrx` 前缀函数 + `aiding_5702` 引导入口 + while(1) 控制流）；meta 标签藏 challenge（`qqqh...4096...qqt<时间戳>` + 文件名列表，瑞数典型元数据）
- 参数特征：URL 参数 `m` = 281 字符 base64url 风格（点号分段），前 76 字符为静态段（跨接口相同）；由瑞数 hook `XMLHttpRequest.prototype.open` 自动注入（`arguments[1]=_yrxyA$(url)`），页面代码只传 token=undefined；m 动态段零值时输出字母表 q 重复填充串（qqqq 段）——**补环境不完整的直接信号**
- 请求特征：`/api2/10` 以 script 标签形式加载（`sec-fetch-dest: script`）；`/api/10/offset` 返回 `window.<随机变量名>=<数值>`（变量名每次变化，实测 bdfE / AbaB / dbGC / fFag / EABa）；数据接口每页响应含 `k.k="变量|数值"` 回写
- 反调试特征：`Function(arguments[0]+"bugger")()` 循环构造；boot 检查 `eval.toString()` native 形态；W5/W3 控制流空转（环境检测失败后的故意空转）

## 加密方案

- 路径：B vm 沙箱执行 + D 环境伪装
- 框架：vm（不使用第三方补环境框架）
- TLS 客户端：Node.js 原生 https（本例瑞数未校验 TLS 指纹，Node 直连全通）
- 核心思路：黑盒复刻浏览器加载链——每次运行新鲜 GET HTML 提取配套 boot，sandbox 顺序执行 rs.js → eval(api2) → eval(boot)，由 boot 解密生成 core 并劫持 XHR.open，随后每页 new XHR + open 即得带 m 的 URL，真实请求并回写 k.k 动态变量

### 完整签名链（entry-chain）

```
source: /match/10 HTML 第 9 个 <script>（boot 引导器，会话绑定）
        /api2/10 响应（$_ts['dfe1683'] 318KB 密文，与 boot 同次渲染配套）
        meta content（1240 字符 challenge，_yrxTY4 解码出 64 项字符串表）
entry:  eval(boot) → 流式解密 dfe1683 → 拼 238KB core → eval(core) → 劫持 XHR.open
builder: XHR.open(url) → _yrxyA$(url) → _yrxtSa/_yrxpce（<a>.href 规范化 URL）
        → _yrx4U7(mode, armin)：key=_yrxE5D(_yrxB3q()) + old_time() 时间块
          + new_wp(268,mode,armin) + puh → 加密 → base64url
writer: arguments[1] = 签名后 URL（m 参数自动附加），页面 $.ajax 正常发送
```

### 关键机制（实测）

1. `old_time() = _yrxozw`（meta 解码，会话内恒定 1598547535764，非运行时间——恒定是设计如此）
2. 字符串表查表：`_yrxWFt(N) = I6a[N-N%64 + (ULK(N%64)^Dkc)]`，表由 `_yrxTY4(metaContent)` 解码 64 项
3. `argarr = $_ts['_yrxdD_']`（921 键名数组）；完整 `$_ts` 由 boot 解密 dfe1683 后生成（rs.js 阶段仅 30 个值键，残本不够）
4. 动态 key 链：每页响应 `k.k="变量|数值"` → `window[变量]=数值` → 参与下一页 m 生成

## 踩坑记录

1. **坑：boot 与 api2 不配套** → 拿旧 HTML 的 boot 配新 api2，流式解密在 616 字节处错乱，拼出 1368 字节残缺 core，m 动态段全零（qqq 填充）→ 400 token failed。正确做法：每次运行新鲜 GET /match/10 提取同次渲染的 boot（boot 内含会话值如 yuanrenxue_59，两次渲染实测 271/822 不同）。通用化：多个动态资源存在解密配套关系时，必须同次渲染提取，禁止跨渲染混用（`references/network/dynamic-resource.md` 会话配套资源专节）。
2. **坑：`<a>` 元素 stub 无 URL 解析** → core 的 _yrxpce 用 createElement('a').href 规范化 URL 判协议，stub 返回 undefined → Kni>3 → _yrxyA$ 原样返回 URL 不注入 m。正确做法：`<a>` href setter 接 Node `URL` 解析回填 protocol/hostname/pathname/search/hash（`references/env/env-object-model.md` 元素语义章节）。
3. **坑：meta content 空串** → _yrxnhf() 取最后一个 meta 的 content 喂 _yrxTY4 解码字符串表，stub 空串 → 表长 1 → 25 次查表全 miss → 下游全崩。正确做法：meta 元素 content 回填抓包真实值（1240 字符）。教训：被目标代码实际读取的 DOM 属性必须回填真实值，不能用空 stub。
4. **坑：_yrx1dz 防护条件写错** → `String.fromCharCode(110)`='n' ≠ 'number'，条件恒真导致所有调用返回 []（全局函数只注册 32 个）。正确做法：防护只拦 undefined/null，其余放行。
5. **坑：page=5 软提示误判校验通过** → Firefox UA 请求 page=5 返回「请将UA改为yuanrenxue哦」是业务层提示；UA=yuanrenxue 时才暴露真实 token 校验结果。正确做法：软提示文案不能当校验通过证据，须用目标 UA 复测。
6. **坑：外部 400 归因「TLS 指纹/会话强绑定」** → 本项目最大教训：曾因「浏览器 200 + 外部 400」表象固化归因通道层，本库曾收录为反例。正确做法：外部失败先 dump 签名内部中间值（探针对比浏览器样本），确认生成内容正确性后再归因通道层（反模式 11）；m 出现 qqq 零值填充段即签名输入错误信号，先修签名再谈通道。
7. **坑：trace 统计被第三方反指纹库污染** → 27964 进程日志全是 airgap.js（transcend-cdn）记录，直接统计得出错误环境画像。正确做法：按调用栈 file 过滤目标站来源再统计（`references/workflow/trace-flow.md` TRACE_ANALYZE）。
8. **坑：注入旧 $_ts 快照导致 rs.js 静默跳过动态初始化** → sandbox 预填 tsFull 后 rs.js 走旁路不发 api2 请求（tsKeys 恒 2）。正确做法：空状态起步让链路自然驱动（终局方案直接手动按序 eval，不依赖 rs.js 自动化）。通用化：黑盒执行禁止预填"看起来完整"的状态快照——会改变引导代码的分支走向（经验法则 24）。
9. **坑：vm 补环境用「插桩 while(1)」定位空转** → 5 个控制流循环都进入但卡点定位失败，破坏字符串字面量与 native 检测。正确做法：vm.Script timeout 定位是否纯 CPU 死循环 → Proxy 探测 window 缺失属性 → 按缺失清单补齐（反模式 16）。
10. **坑：vm 卡死后转投浏览器黑盒取数** → 中途曾用 ruyipage 取数当作交付，违反纯协议红线。正确做法：补环境卡死先过 IMPLEMENT 准入三件套 + 根因诊断，定位到内核级检测走 BLOCKED_FORENSIC 对齐用户，不得转投浏览器内核方案（反模式 20）。

## 可验证事实清单（经验资产）

1. m 长度 281 字符，前 76 字符静态段跨接口一致（/api/topic_info、/api/user、/api/question/10 同前缀）
2. m 动态段由 boot+api2 配套解密的环境状态生成；零值时输出字母表 q 重复填充串
3. boot 每次渲染不同（yuanrenxue_59 两次实测 271/822）；meta content 会话内稳定（两次拉取 hash 相同）
4. /api2/10 是 script 标签形式加载（sec-fetch-dest: script），响应 318KB 单语句 `$_ts['dfe1683']='...'`
5. /api/10/offset 每次返回不同变量名（实测 bdfE/AbaB/dbGC/fFag/EABa），eval 后写 window
6. 数据接口每页响应含 k.k="变量|数值"，须回写 window[变量] 参与下一页 m 生成
7. page=5 要求 UA 含 yuanrenxue（猿人学系列惯例，match4/5/6/9/10 一致）
8. 提交接口 POST /a/10 必须表单编码（application/x-www-form-urlencoded），JSON 提交 wrong answer
9. 数据绑定 sessionid：服务端页面加载时 Set-Cookie 重置 sessionid，须带用户登录态取数
10. Node 原生 https 直连全通（无 TLS 指纹校验）；「TLS 封死纯协议」为误判
11. old_time() 会话内恒定 1598547535764，m 不含运行时新鲜时间戳要求
12. 2026-08-26 验证：纯协议 5/5 页 200，总和 29178743，三轮复跑恒定；提交返回 {"result":"success"}

## 历史误判与修正（本项目专项教训）

| 旧结论（2026-08-25 浏览器方案期） | 终局修正（2026-08-26 纯协议通关） |
|---|---|
| m 与浏览器会话强绑定，外部精确复刻必失败 | 真因是 m 动态段全零（boot+api2 不配套） |
| TLS 指纹检测封死纯协议 | Node 原生 https 直连全通 |
| page=5 软提示 = 瑞数层已过 | 软提示只是业务层；UA=yuanrenxue 才暴露真实校验 |

> 三个旧结论的共同根因：在签名生成内容未经中间值验证的情况下，把外部失败直接归因到通道层。已固化为反模式 11。

## RuyiTrace 取证要点

- 有效样本：trace_process_20056（主 tab 15613 行：GET 209 / CALL 104 / SET 44 项）；必须按调用栈 file 过滤后再统计（airgap.js 污染教训）
- 高频项定补环境优先级：cookie setter 9007x、setTimeout 688x、visibilityState 581x、fontFamily setter 458x（字体枚举）、atob 143x
- eval 捕获是破案钥匙：238KB 完整 `$_ts={...}` 的 eval 记录直接指明 sandbox 内 $_ts 残缺（仅 30 键 vs 应有 921 键名）
- 按类别分组的环境与指纹 API 回放明细见 `result/最终项目总结.md` 附章

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/common-pitfalls.md` | 反模式 16（插桩 while(1) 禁令）+ 反模式 20（VM 卡死转投浏览器黑盒，本案例为主体）+ 反模式 11（外部失败误归因通道层，本案例为主体） |
| `references/workflow/trace-flow.md` | TRACE_ANALYZE 双轨分析（本案例为「高频≠关键」实证）+ eval 捕获三用途（本案例为动态代码收集/状态对照实证） |
| `references/workflow/experience-rules.md` | 规则 24（黑盒执行禁止预填状态快照）+ 规则 22（禁止缓存复用） |
| `references/env/env-object-model.md` | `<a>` href 真实 URL 解析、meta content 真实值回填 |
| `references/network/dynamic-resource.md` | boot 每次渲染变化的动态资源新鲜拉取 + 会话配套资源专节 |
| `references/network/session-chain.md` | 同 sessionid 贯穿的 Session 请求链 |
| `cases/yuanrenxue-match9-dynamic-cookie2.md` | 同站前序案例，数据绑定 sessionid 基线 + 末页 UA=yuanrenxue 迁移参考 |
| `cases/yuanrenxue-match-index.md` | 猿人学题号速查表 |
