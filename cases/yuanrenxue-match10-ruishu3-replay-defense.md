# Case：瑞数 v3 变种 + 重放攻击对抗（猿人学第10题）—— 反例案例

> ⚠️ **本案例是反例**：解题方案违反纯协议红线（§3），用 ruyipage 浏览器黑盒取数当作交付。收录目的：①沉淀瑞数 v3 + 重放对抗的技术指纹与可验证事实，供后续同站案例 CASE_LOOKUP 命中；②把本次 AI 执行走样的反模式固化进 `common-pitfalls.md` 反模式 16/19/20，避免重蹈覆辙。**不得作为"浏览器取数可接受"的先例引用**。
>
> 难度：★★★★（瑞数 v3 变种环境检测 + 重放对抗会话级动态签名）
> 还原方案：**违规**——浏览器黑盒取数（应走 B vm 沙箱补环境 + 对齐探针法，未完成）
> 实现语言：Python（违规：ruyipage 取数，非纯协议）
> 最后验证日期：2026-08-25
> 平台类型：猿人学练习平台（match.yuanrenxue.cn）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：页面内联 obfuscator.io 控制流平坦化脚本（73KB，20+ 函数，1 个 eval）是「代码组装器」——从 `$_ts` 字符串表解码并动态构建 JS 代码（`push("function ")`、`push("while(1){")`）；`rs.js`（118KB，题目专用，`r='m'` 属性）带可读函数名 `checkTimer`/`handleCandidate` 但整体是字符串表；`/api2/10` 返回 318KB 的 `$_ts['dfe1683']='...'` 字符串表；`/api/10/offset` 返回动态 JS（如 `window.cCFA = 624`，随机数参与签名）；meta 标签藏 challenge（`qqqh...4096...` 公钥元数据 + 密文）；含 jsjiami.com.v6 标记 + 同步 XHR 取 `document.scripts` src
- 参数特征：请求侧 `m` 参数（base64 风格长串，瑞数 v3 格式点号分 4 段，前缀固定 `4UrkgIwjsrchfAKOC2qRltb4jx0ieHyhXvZItorSg8hL5lGtjcIt_woJEPyvWewABEIiJjuvPYIOUv86BABZmAn1OFLT` + 变化段，典型 RSA 分块加密特征）；不同接口的 m 值不同（`/api/question/10`、`/api/topic_info`、`/api/user` 共用同前缀）；`m` 由瑞数 hook XHR.open 自动注入（页面代码传 token=undefined，最终 URL 却是 m=...）
- 请求特征：`GET /api/question/10?page=<p>&m=<动态签名>`；末页（第 5 页）UA 必须含 `yuanrenxue`；`/api/10/offset` 与 `/api2/10` 是 m 生成链的动态依赖
- 反调试特征：`Function("debugger")` 循环（3653 次构造）；`eval.toString()` 反调试检测（`yuanrenxue_63.eval` undefined 报错）；瑞数 v3 环境检测（canvas 指纹、WebRTC、WebGL、navigator 全套）；W5/W3 控制流空转（环境检测失败后的故意空转）

## 加密方案

> ⚠️ 下方为违规方案，仅供反例参考。

- 路径：**违规**——浏览器黑盒取数（ruyipage 让页面自然加载 5 页 + hook 收集数据）
- 框架：ruyipage（违规，应走 vm 沙箱）
- TLS 客户端：无（浏览器内取数，未做纯协议）
- 核心思路：复用取证 profile（sessionid 保留）+ UA=prefs 注入 yuanrenxue + hook XHR.open 捕获最终带 m 的 URL + 收集 5 页数据求和。**应走的正确路径**：B vm 沙箱补环境（执行 rs.js + api2/10 + 内联组装链生成 m）+ 对齐探针法对齐瑞数 v3 环境检测 + curl_cffi 提交。

## 踩坑记录

> 这些坑是 AI 执行走样的反模式，已固化进 `common-pitfalls.md`。

1. **坑：CASE_LOOKUP 前发起重放实验** → 在 TRACE_ANALYZE 之前提取 m 样本做重放（判断可重放性/绑定关系），消耗会话状态 + 在签名链未定位时归因错误（误判 TLS/cookie 问题）。正确做法：重放实验属 DIAGNOSE 范畴，前置阶段只做取证与本地分析，进入 IMPLEMENT 写出实现后再做对照实验（SKILL.md §4 阶段动作边界）。
2. **坑：数据绑定 sessionid 未先验** → 多次重放失败后才意识到服务端在页面加载时重置 sessionid，匿名 session 数据与用户 session 数据不同。正确做法：数据差异时先做 session 基线验证（固定 sessionid 重放两次，数据恒定 ⇒ 绑定会话），归因"平台重置/IP 限流"前必须先排除 session 因素（反模式 19）；同站案例 match9 已标注此特征，同站新题应作为数据异常排查的首选假设。
3. **坑：提交接口 Content-Type 猜错** → 用 `application/json` 提交答案持续 wrong answer，实际页面 jQuery `$.ajax({data:{answer:x}})` 默认表单编码。正确做法：写请求 Content-Type 必须从页面源码或 capture 取证，禁止猜测（SKILL.md §10 写请求格式取证）。
4. **坑：vm 补环境用「插桩 while(1)」定位空转** → 5 个控制流循环都进入但卡点定位失败，破坏字符串字面量与 native 检测。正确做法：vm.Script timeout 定位是否纯 CPU 死循环 → Proxy 探测 window 缺失属性 → 按缺失清单补齐（反模式 16）。
5. **坑：vm 卡死后转投浏览器黑盒取数** → 未走对齐探针法、未走 BLOCKED_FORENSIC 对齐用户，直接用 ruyipage 取数当作交付，违反纯协议红线。正确做法：vm 补环境卡死先过 IMPLEMENT 准入三件套 + Proxy 探测根因诊断（反模式 16），定位到内核级检测走 BLOCKED_FORENSIC 对齐用户，不得转投浏览器内核方案（反模式 20）。
6. **坑：跳过 IMPLEMENT 准入三件套** → 未产 entry-chain.md/missing-env-priority.md、未过 check_env_prerequisites.js 直接写 vm 执行框架，盲补环境必然空转。正确做法：进入 IMPLEMENT 前按序完成证据前置 + 门禁脚本复核 + Step 2 前置（SKILL.md §4.4 IMPLEMENT 准入三件套）。
7. **坑：trace 只导入空壳 event 文件** → RuyiTrace 多进程文件，主日志在 `domtrace/` 目录（8MB），先导入了空壳 event 文件误判 trace 为空。正确做法：`import_ruyitrace_log.js --input` 传多个 domtrace 文件合并，或传目录下所有 `trace_process_*.ndjson`（SKILL.md §4.2 多进程合并）。
8. **坑：hook eval 干扰瑞数执行** → add_preload_script hook eval 截获组装代码成功（43188 条记录），但 hook 干扰瑞数执行导致 token 未生成。正确做法：hook 干扰目标执行时改用 trace 法（无 hook）或 Proxy 监听式 hook 而非替换式 hook。

## 可验证事实清单（经验资产）

1. 瑞数 v3 变种架构：rs.js（118KB 题目专用）+ api2/10（318KB `$_ts` 字符串表）+ 内联组装脚本（73KB obfuscator.io）+ /api/10/offset（动态随机数）+ meta challenge 拼装出 m 生成链
2. m 由瑞数 hook XHR.open 自动注入：页面代码传 token=undefined，最终 URL 是 m=...；瑞数不暴露 window.request/token
3. m 实时生成、绑定 page：同会话内 m1 复用给 page2/3/4 全部 400；m 非一次性（浏览器会话内 fetch 重放同 m 成功）
4. m 外部重放失败：浏览器内 fetch 同 m 成功，外部 curl_cffi 全量复刻仍 400——差异在浏览器环境（TLS/HTTP2/完整 header 层），但未完成纯协议还原验证根因
5. 不同接口 m 值不同（`/api/question/10`、`/api/topic_info`、`/api/user`），前缀相同——RSA 分块加密特征（公共段 + 请求参数段）
6. 数据绑定 sessionid：服务端页面加载时重置 sessionid；复用取证 profile（sessionid=p4av26i0 保留）后数据与匿名 session 不同；用户会话答案 = 29178743
7. 末页（page=5）UA 必须含 `yuanrenxue`（与 match4/5/6/9 一致）；set_useragent 通过 prefs 注入 yuanrenxue 生效
8. 提交接口 `POST /a/10`，Content-Type 为表单编码（`application/x-www-form-urlencoded`），body `answer=<总和>`，非 JSON
9. 响应重放对抗核心：`res.k` 会动态设置全局变量（重放对抗的服务端动态 key 机制，如 `BAEc|806`）
10. 瑞数 v3 环境检测项：canvas 指纹、WebRTC、WebGL、navigator 全套；入口函数 `aiding_5702` → `_yrx4U7(1, _yrxJ_8)` 生成 m
11. 反调试：`Function("debugger")` 循环（3653 次构造）、`eval.toString()` 检测、W5/W3 控制流空转

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/common-pitfalls.md` | 反模式 16（补环境死循环诊断，含插桩 while(1) 禁令）+ 反模式 19（数据绑定 session 基线）+ 反模式 20（VM 卡死后转投浏览器黑盒取数，本案例为主体） |
| `references/workflow/experience-rules.md` | 规则 22（黑盒执行禁止缓存复用，瑞数循环加密同理） |
| `references/env/env-detect-bypass.md` | 瑞数 v3 环境检测对齐探针法（本案例应走未走的正确路径） |
| `references/network/dynamic-resource.md` | 黑盒加密 SDK 定期更新（rs.js/api2/10 同理，需二进制抓取） |
| `cases/yuanrenxue-match9-dynamic-cookie2.md` | 同站前序案例，数据绑定 sessionid 基线 + 末页 UA=yuanrenxue 迁移参考 |
| `cases/yuanrenxue-match-index.md` | 猿人学题号速查表（应同步登记 match10） |

---

> **复用警告**：本案例的技术指纹与可验证事实可作 CASE_LOOKUP 命中参考，但「加密方案」段是违规方案，不得照搬。后续做 match10 或同站瑞数 v3 变种题，必须走 B vm 沙箱补环境 + 对齐探针法纯协议还原。
