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

## 用法

- 刷题前：`node scripts/search_cases.js <题号或技术关键词>` 命中案例则重读踩坑记录 + 可验证事实清单，按最新结构核对后沿用。
- 首次做某题：正常走完整流程，完成后同步新增 `cases/` 案例 + 更新本表 + 追加 index.json 索引。
- 命中案例后仍须按 SKILL.md 状态机走完整流程，不得直接照搬算法（平台可能升级）。
- 第 4/5/6 题风控底座同源：蜜月期开窗（GET HTML 约 5 秒窗口、成功请求续期）、无页间隔要求（签名正确时无缝连发全过，"放慢速度"文案实为签名错误信号）、失败 5-10 次进惩罚期（冷却 10 分钟+）、末页 UA=yuanrenxue。**新题按此基线逐项验证，不是照搬步骤**——各题风控配置独立：match7 数据接口无蜜月期、无需开窗，且开窗 HTML 响应会 Set-Cookie 重置登录 sessionid 导致提交 401；迁移任何预热/开窗步骤前先直接请求一次数据接口验证是否必要（反模式 18）。

## 相关参考

- `cases/_template.md`：新增案例骨架。
- `references/rendering/image-content-reversal.md`：图片型内容反爬通用方法（match/4 核心）。
- `references/rendering/font-anti-crawl.md`：字体反爬通用方法（match/7 核心：内嵌形态识别、字形指纹法、ground truth 验证阶梯）。
- `references/network/ip-risk-control.md`：会话状态类风控识别专节（蜜月期/惩罚计数，match/5/6 实测）。
- `references/workflow/experience-rules.md`：规则 21（DOM ground truth）+ 规则 10（签名哈希常量篡改降级信号）。
