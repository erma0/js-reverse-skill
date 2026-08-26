# 猿人学 match 题号速查

> 面向"按题号刷题"场景：输入题号即可定位技术特征与已有案例。只收录已实测的题号；未做过的题走正常流程，解完后再补案例与经验沉淀。
> 平台更新后个别题可能有变，解题前仍按 CASE_LOOKUP/取证流程核实最新结构。

| 题号 | 题名/特征 | 技术要点 | 案例文件 | 还原方案 | 最后验证 |
|---|---|---|---|---|---|
| 4 | 雪碧图、样式干扰 | 无签名参数，仅 sessionid + 末页 UA=yuanrenxue；j_key 干扰过滤 + `index+left/8.5` 排序 + 像素哈希字典识别 | `cases/yuanrenxue-match4-sprite-pixelsort.md` | A 纯算还原 + DOM ground truth | 2026-08-23 |
| 5 | 修改版 MD5 + WAF Cookie | 魔改 MD5（T 常量注入 + `XMLHttpRequest.DONE*4` 分组步长，缺 XHR 时步长退化 1 是 token failed 根因）→ vm 沙箱补环境跑 decoded5.js 纯协议还原；蜜月期开窗同第 6 题 | `cases/modified-md5-xhr-done-yuanrenxue.md` | B vm 沙箱补环境（纯协议） | 2026-08-24 |
| 6 | AAEncode 混淆 + RSA 签名 + 蜜月期风控 | AAEncode 段仅产出 `window.o=1`（幌子）；m=二次 URL 编码的 RSA-1024("1\|"+t)，q 单段链 `1-<t>\|` 即可（多段链反被拒）；jsbn `am` 初始化被 try-catch 吞错需手动挂回；蜜月期开窗（GET HTML 约 5 秒、成功续期）+ 末页 UA=yuanrenxue | `cases/yuanrenxue-match6-aarcsa-honeymoon-risk.md` | B vm 沙箱补环境 + curl_cffi（纯协议） | 2026-08-24 |
| 7 | 动态字体（随风漂移） | 接口响应内嵌 base64 TTF + data 为 PUA 码点实体；码点每请求轮换但 `glyf.flags` md5 指纹跨字体固定 → 指纹字典法还原；请求侧全明文无签名，requests 直连（无 TLS 检测、无蜜月期、**勿开窗**：开窗 HTML 会 Set-Cookie 重置登录态致提交 401）；`m` 参数是 `/api/match/7`（404）hook 遗留可忽略；末页 UA=yuanrenxue | `cases/yuanrenxue-match7-dynamic-font.md` | A 纯算还原（内容还原型，Step 2 豁免） | 2026-08-24 |
| 9 | 动态 Cookie m（RSA+循环前缀） | 挑战 JS 含 `decrypt(ts)` 循环 N 次（N=2~5 随机）→ `m = prefix + encodeURIComponent(RSA_PKCS1_v1.5(ts)) + 'r'` 走 cookie；udc.js **定期更新**（公钥随之变，必须二进制抓取最新版，文本解码会损坏文件）；signer **禁止缓存 RSA**（缓存版 8/8 失败，无缓存模拟浏览器循环加密稳定通过）；数据**绑定 sessionid**（固定 session → 答案 27848571 不变）；sessionid 由 API 响应 set-cookie 下发；提交有随机拒绝需重试（≤8 次）；末页 UA=yuanrenxue | `cases/yuanrenxue-match9-dynamic-cookie2.md` | B vm 沙箱补环境（纯协议，无缓存循环加密） | 2026-08-25 |
| 10 | 瑞数 v3 变种 boot+api2 配套解密 + 重放攻击对抗 | rs.js(98KB ÿ 混淆) + api2/10($_ts 318KB 密文) + HTML 第 9 个 script 的 boot 引导器(73KB，**每次渲染不同，与 api2 同次渲染配套**，跨渲染混用→解密错乱→m 动态段全零) + meta challenge 拼装 m 生成链；m(281 字符，前 76 静态段)由瑞数 hook XHR.open 自动注入，**m 出现 qqq 零值填充段 = 补环境不完整信号**（曾因此误判「TLS 封死/会话强绑定」，Node 原生 https 直连全通已推翻）；每页响应 k.k="变量\|数值"须回写 window 参与下一页 m 生成；数据**绑定 sessionid**（答案 29178743）；末页 UA=yuanrenxue（软提示≠校验通过）；提交接口 `POST /a/10` **表单编码**；`<a>` href 须接真实 URL 解析、meta content 须回填真实值 | `cases/yuanrenxue-match10-ruishu3-replay-defense.md` | B vm 沙箱补环境 + D 环境伪装（纯协议，Node 原生 https） | 2026-08-26 |
| 12 | 入门级 js（页面内联明文签名） | `m = base64("yuanrenxue"+page)` 直接内联在 document.html:738（`m:btoa("yuanrenxue" + p)`），无 SDK 无混淆；**先读 document.html 内联 script 再谈 JS 文件级分析**；数据绑定 sessionid（同 session 数据恒定可复验）；末页 UA=yuanrenxue；提交 `POST /a/12` 表单编码；本题同时是 trace 信号形态/多进程合并/验证记录结构三个工具坑的实测来源（均已固化修复） | `cases/yuanrenxue-match12-inline-btoa.md` | A 纯算还原（requests 直连） | 2026-08-26 |

## 用法

- 刷题前：`node scripts/search_cases.js <题号或技术关键词>` 命中案例则重读踩坑记录 + 可验证事实清单，按最新结构核对后沿用。
- 首次做某题：正常走完整流程，完成后同步新增 `cases/` 案例 + 更新本表 + 追加 index.json 索引。
- 命中案例后仍须按 SKILL.md 状态机走完整流程，不得直接照搬算法（平台可能升级）。
- 第 4/5/6 题风控底座同源：蜜月期开窗（GET HTML 约 5 秒窗口、成功请求续期）、无页间隔要求（签名正确时无缝连发全过，"放慢速度"文案实为签名错误信号）、失败 5-10 次进惩罚期（冷却 10 分钟+）、末页 UA=yuanrenxue。**新题按此基线逐项验证，不是照搬步骤**——各题风控配置独立：match7 数据接口无蜜月期、无需开窗，且开窗 HTML 响应会 Set-Cookie 重置登录 sessionid 导致提交 401；match10 数据接口每页都要 m（与 match9 验证后免 m 不同），服务端页面加载时重置 sessionid（取数须带用户登录 sessionid，纯协议下固定 cookie 头贯穿全链即可，无需取证 profile）；迁移任何预热/开窗步骤前先直接请求一次数据接口验证是否必要（反模式 18）。
- **数据绑定 sessionid 是 match9/10 共性**：match10 复用取证 profile（sessionid 保留）后数据与匿名 session 不同，固定 session → 答案不变。match 题数据类接口先做 session 基线验证（反模式 19）。

## 相关参考

- `cases/_template.md`：新增案例骨架。
- `references/rendering/image-content-reversal.md`：图片型内容反爬通用方法（match/4 核心）。
- `references/rendering/font-anti-crawl.md`：字体反爬通用方法（match/7 核心：内嵌形态识别、字形指纹法、ground truth 验证阶梯）。
- `references/network/ip-risk-control.md`：会话状态类风控识别专节（蜜月期/惩罚计数/数据绑定 session 基线，match/5/6/9/10 实测）。
- `references/network/dynamic-resource.md`：黑盒加密 SDK 定期更新专节（公钥随版本轮换 + 二进制抓取纪律，match/9 核心，match10 rs.js/api2 同理）+ 会话配套资源专节（boot 与 api2 同次渲染配套，match10 实测）。
- `references/env/env-detect-bypass.md`：瑞数 v3 环境检测对齐探针法（match10 终局验证路径）。
- `references/env/env-object-model.md`：元素语义真实化（`<a>` href 真实 URL 解析 + meta content 真实值回填，match10 实测）。
- `references/hooks/anti-debug.md`：沙箱执行侧输出劫持（jsjiami 覆写 console.log，match/9 实测）。
- `references/workflow/experience-rules.md`：规则 21（DOM ground truth）+ 规则 10（签名哈希常量篡改降级信号）+ 规则 22（黑盒执行禁止缓存复用）+ 规则 24（黑盒执行禁止预填状态快照，match10 实测）。
- `references/workflow/common-pitfalls.md`：反模式 16（补环境死循环诊断，含插桩 while(1) 禁令，match10 实测）+ 反模式 19（数据差异未先验 session 基线，match9/10 实测）+ 反模式 20（VM 卡死后转投浏览器黑盒取数，match10 为主体，含终局修正后记）+ 反模式 11（外部失败未验证签名内容就归因 TLS/会话强绑定，match10 为主体）。
