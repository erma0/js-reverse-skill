# 猿人学 match 题号速查

> 面向"按题号刷题"场景：输入题号即可定位技术特征与已有案例。未建案例的题标记"未记录"，首次做时按正常流程解完再补案例与经验沉淀。
> 数据覆盖度随做题进度增加；平台更新后个别题可能有变，解题前仍按 CASE_LOOKUP/取证流程核实最新结构。

| 题号 | 题名/特征 | 技术要点 | 案例文件 | 还原方案 | 最后验证 |
|---|---|---|---|---|---|
| 1 | 数字加密（MD5，记忆待核实） | 特征为早期查阅记忆，未实测，仅作线索 | 未记录 | - | - |
| 2 | 美团字体反爬（记忆待核实） | 字体映射（woff），见 `references/rendering/font-anti-crawl.md` | 未记录 | - | - |
| 3 | 番茄小说 sessionID（记忆待核实） | 特征为早期查阅记忆，未实测，仅作线索 | 未记录 | - | - |
| 4 | 雪碧图、样式干扰 | 无签名参数，仅 sessionid + 末页 UA=yuanrenxue；j_key 干扰过滤 + `index+left/8.5` 排序 + 像素哈希字典识别 | `cases/yuanrenxue-match4-sprite-pixelsort.md` | A 纯算还原 + DOM ground truth | 2026-08-23 |
| 5 | 修改版 MD5 + WAF Cookie | 内嵌修改版 MD5（T 常量替换为动态值，不可纯算）→ 浏览器提取降级 | `cases/browser-extract-modified-md5-yuanrenxue.md` | 浏览器提取（降级） | 2026-07-11 |
| 6 | AAEncode 混淆 + RSA 签名 + 多层会话风控 | AAEncode 段仅产出 `window.o=1`（幌子）；m=二次 URL 编码的 RSA-1024("1\|"+t)，q=跨请求累加链 `1-<t>\|`（m 内 t 须与 q 末段同源）；JSEncrypt 的 SecureRandom 被魔改为**确定性 RC4**（种子=页面加载时间戳低 8 位，标准库随机 PS 密文会被拒）；风控含蜜月期窗口（真浏览器 GET HTML 开启约 5 秒、成功请求续期）+ q 链状态机 + 失败惩罚期（连发失败后浏览器请求也被拒，需冷却 10 分钟+）；末页 UA=yuanrenxue | 未记录（纯协议攻关进行中，根因已锁定：确定性 PRNG） | - | - |

> 注：第 1/2/3 题特征为日志早期未经验证的记忆内容，**解题前务必按取证流程核实最新结构**，不要直接采信本表特征；第 4/5/6 题为实测特征。

## 用法

- 刷题前：`node scripts/search_cases.js <题号或技术关键词>` 命中案例则重读踩坑记录 + 可验证事实清单，按最新结构核对后沿用。
- 首次做某题：正常走完整流程，完成后同步新增 `cases/` 案例 + 更新本表 + 追加 index.json 索引。
- 命中案例后仍须按 SKILL.md 状态机走完整流程，不得直接照搬算法（平台可能升级）。

## 相关参考

- `cases/_template.md`：新增案例骨架。
- `references/rendering/image-content-reversal.md`：图片型内容反爬通用方法（match/4 核心）。
- `references/workflow/experience-rules.md`：规则 21（DOM ground truth）+ 规则 10（签名哈希常量篡改降级信号）。