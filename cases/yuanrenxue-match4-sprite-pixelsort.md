# Case：雪碧图/样式干扰——图片数字拼装还原（猿人学第4题）

> 难度：★★★
> 还原方案：A 纯算还原 + DOM ground truth 验证
> 实现语言：Python（urllib + ddddocr + Pillow + requests.Session）
> 最后验证日期：2026-08-23
> 平台类型：猿人学练习平台（match.yuanrenxue.cn）
> 平台共性（请求/提交链路、末页 UA、sessionid 绑定、getTime 时间源、诱饵参数惯例、风控底座、token failed 语义）统一见 cases/yuanrenxue-match-platform.md；本文只保留本题差异与专属事实。

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`document.html` 内联脚本含 `hex_md5`/`str2binl`（标准 MD5 实现）、`btoa` 编码；页面 JS 存在"干扰图"逻辑（`$(j_key).css('display','none')`）
- 参数特征：接口返回 `{key, value, iv, info}`，`info` 为 HTML，内嵌大量 base64 PNG 小图（25x31）+ `class` + `left` CSS 偏移；提交接口为 `POST /a/4`（body `answer=<和>`）
- 请求特征：`GET /api/question/4?page=N&pageSize=10&kw=`，数据接口本身**无签名参数**，仅需 `sessionid` cookie；页面另有 `<img>` 双 class（一组隐藏干扰、一组可见数字）
- 反调试特征：`/api/match/4` 是死代码（404），页面传的 `m: window.match4` 可忽略

---

## 加密方案

- 路径：A 纯算还原（接口无签名，难点在服务端返回 HTML 中图片数字的还原）
- 框架：不使用
- TLS 客户端：不发真实请求（urllib/requests 直连，无 TLS 检测）
- 核心思路：三层还原——① 用 `j_key = md5(base64(key+value).replace('=',''))` 过滤隐藏干扰图；② 数字顺序按 `有效图序号 index + left/8.5` 升序（不是 HTML 顺序）；③ 图片识别用「像素哈希字典」而非逐张 OCR（base64 层每张不同但像素层仅 0-9 十种模板且跨请求固定，建表仅需 10 次 OCR）

### 还原细节

#### 1. 干扰图过滤（j_key）

- `j_key = md5(base64(key + value).replace('=', ''))`
- class 含 j_key 的 `<img>` 是页面 `display:none` 的干扰图，过滤后剩余为真实数字图

#### 2. 数字顺序（核心难点）

页面渲染规则（用 DOM ground truth 反推并验证）：

- td 为 `inline-flex`，`.img_number { width: 8.5px }`
- 显示 x = 有效图序号 `index` × 8.5 + CSS `left` 偏移
- **显示顺序 = 按 `index + left / 8.5` 升序**（left 恒为 8.5 整数倍；index 为有效图序号，隐藏干扰图不占 flex 槽位）
- 直按 HTML 顺序拼会错位（首次提交 wrong answer 正是栽在这）

#### 3. 数字识别（像素哈希字典）

- 每张图为 25x31 完整数字图
- **关键取证发现**：base64 层每张图都不同（PNG `tEXt` 元数据随机化），但**解码后的像素层只有 0-9 十种模板，跨请求完全固定**（两次请求像素级交集 10/10）
- 因此用「像素哈希 → 数字」字典：首次遇到新哈希用 ddddocr 识别一次（整个任务仅 10 次），后续全部查表，不需要逐张 OCR；建表也可人工标注，实现纯协议零 OCR

### 降级/验证信号

当纯协议解析顺序/过滤不确定时，不要盲提交：用 ruyipage 打开页面注入 sessionid，同时抓接口响应 + 提取 DOM 渲染坐标（`getBoundingClientRect`），对比"协议结果 vs DOM 实际显示"10/10 一致后再提交。这比"先提交碰运气"高效且能定位排序规则。

---

## 踩坑记录

1. **坑：HTML 顺序直接拼接** → 提交 wrong answer（5 页数字个别错位）。正确做法：理解 CSS 布局（`inline-flex` + `width:8.5px` + `left` 偏移），排序键 = `index + left/8.5`，用 DOM ground truth 对比验证。
2. **坑：按 base64 去重下结论"图片唯一必须 OCR"** → 实际上 base64 唯一 ≠ 像素唯一，PNG 带随机 `tEXt` 元数据，解码后像素层仅 10 种模板且固定。正确做法：按 base64 去重后不能下结论，应解码像素哈希去重 + 跨请求交集验证（base64 → 像素哈希 → 跨请求交集三步走）。
3. **坑：忽略 UA 要求** → 最后一页（第 5 页）UA 必须为 `yuanrenxue`，否则不返回数据。页面文案明确要求。
4. **坑：误以为接口被迫 m 参数** → `/api/match/4` 返回 404，`window.match4` 是死代码遗留，question/4 只需 sessionid + page，忽略 m 即可。
5. **坑：交付门禁反复卡 Session** → `check_final_artifact.js` 要求联网请求具备可复用 Session（创建/复用/清理）。用 `urllib.request` 无 Session 会被判不合格，改用成熟的 `requests.Session`（`session.get` + `session.close()`）即通过（符合"优先成熟库"偏好）。

---

## 可验证事实清单（经验资产）

1. 接口返回 `{key, value, iv, info}`，数据接口无签名参数，只需 `sessionid` cookie
2. `j_key = md5(base64(key + value).replace('=', ''))`，class 含 j_key 的 `<img>` 是 `display:none` 干扰图
3. 图片自然尺寸 25x31（完整数字）；页面可见 `.img_number` 经 CSS 缩放后渲染约 8.5x10
4. 显示顺序 = 按 `有效图序号 index + left/8.5` 升序（td 为 `inline-flex`，left 恒为 8.5 整数倍）
5. **base64 层每张图不同（PNG `tEXt` 元数据随机化），但像素层仅 0-9 十种模板且跨请求固定**（两次请求像素级交集 10/10）
6. 像素哈希字典法：10 个键 + 仅 10 次 OCR 建表，5 页求和与逐张 OCR 完全一致
7. 最后一页（第 5 页）UA 必须为 `yuanrenxue`
8. `/api/match/4` 返回 404（死代码），`m` 参数可忽略
9. 提交接口 `POST /a/4`，body `answer=<和>`；提交过频会封号
10. pageSize=10，5 页共 50 个多位数求和，每页 10 个 td（10 个多位数）

---

## BASE64 去重误导的教训（核心方法论）

**判断图片型反爬是否可绕过识别时，绝不能按 base64 去重下结论：**

`base64 唯一 ≠ 像素唯一`（PNG 字节不同可能仅来自元数据/重编码，像素完全一致）。正确判定顺序：

1. 先按 base64 去重；若唯一，**不要下结论**
2. 解码为像素数组（`Image.tobytes()`）再做哈希去重，统计像素级唯一数
3. 跨请求（同页多次请求）再做像素级交集对比，确认图池是否固定
4. 像素唯一且跨请求固定 → 像素哈希字典法可行（少量建表 + 大量查表）
5. 像素也唯一且每次刷新 → 才需要逐张 OCR/视觉识别

本案例实战正是踩了这个坑：按 base64 去重误判「300/300 唯一 → 必须 OCR」，实际像素层仅 10 种且跨请求固定 → 模板匹配/字典法完全可行且是最优解。

---

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/rendering/font-anti-crawl.md` | 同为图片/字体渲染类反爬的还原思路 |
| `references/workflow/decision-tree.md` | 题型判定 + 路径决策 |
| `cases/modified-md5-xhr-done-yuanrenxue.md` | 猿人学同平台其他题目（第5题修改版 MD5），CASE_LOOKUP 相互参照 |
| `cases/sm2-sm4-sm3-guomi-jobonline.md` | 纯算还原路径示例 |