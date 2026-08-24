# Case：动态字体映射——glyf 字形指纹还原（猿人学第7题）

> 难度：★★
> 还原方案：A 纯算还原（内容还原型：Step 2 豁免，无运行时签名链路）
> 实现语言：Python（requests + fontTools）
> 最后验证日期：2026-08-24
> 平台类型：猿人学练习平台（match.yuanrenxue.cn）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：页面 JS 成功回调里 `$('.pgx-num').addClass('fonteditor')` 后用 `data:font/truetype;charset=utf-8;base64,` 注册响应内嵌字体；无混淆、无 JSVMP
- 参数特征：接口响应 `{status, data, woff}`——`data` 为 `&#xNNNN;` 形态的 PUA 码点（U+E000–U+F8FF）HTML 实体串，`woff` 为 base64 字体；请求侧仅 `page/pageSize/kw` 明文参数 + `sessionid` cookie
- 请求特征：`GET /api/question/7?page=N&pageSize=10&kw=`，无签名参数、无蜜月期校验（带 sessionid 直接请求即 200）；末页（第 5 页）UA 必须为 `yuanrenxue`
- 反调试特征：无。`m: window.match7` 参数是 `/api/match/7`（404 死代码）hook 的遗留，`window.match7` 未定义时 `$.param` 自动省略，可忽略

---

## 加密方案

- 路径：A 纯算还原（动态字体映射，难点全在响应解码）
- 框架：不使用
- TLS 客户端：requests 直连（无 TLS 指纹检测，与 match5/6 不同）
- 核心思路：动态映射——每次请求 `cmap` 码点轮换但字形轮廓（glyf flags 序列）跨字体/跨请求固定；`md5(glyf flags)` 做「指纹→数字」静态字典（0-9 十项），逐页解析响应内嵌字体重建「码点→数字」映射后解码求和

### 还原细节

#### 1. 字体形态判定

- 响应 `woff` 字段 base64 解码后 magic 为 `00010000`（TrueType sfnt），不是 WOFF——`TTFont` 直接可读，无需 brotli（woff2 才需要）
- 每页请求返回独立字体，码点全在 PUA 区（如 `U+E513`/`U+E129`），glyph 名形如 `unic513`（`uni` + 码点 hex）

#### 2. 字形指纹字典（关键机制）

- 0-9 十个字形的 `glyf.flags`（on/off 曲线点模式）做 md5，**跨字体、跨会话、跨来源完全稳定**（本次取证字体与多个公开方案的指纹表逐项一致）
- 因此指纹表可静态固化进交付 config，等价于静态映射；运行时只需 `getBestCmap()` 建码点→glyph→指纹→数字链
- 几何统计特征不可替代指纹：如 6 和 9 的 (on,off) 计数同为 (19,22)，仅 flags 序列可区分

#### 3. ground truth 验证（字体反爬特化）

- `textContent`/`innerText` 恒为 PUA 码点（FontFace 只改视觉渲染不改 DOM 文本），DOM ground truth（经验法则 21）不适用，不要尝试读渲染文本或截图 OCR
- 验证阶梯：①解码无 `?` 残留 → ②两次完整运行 SUM 完全一致（字体每次不同，映射错误不可能得到一致结果）→ ③指纹表与公开方案交叉一致 → ④提交验证 `POST /a/7` 返回 `code=2`

---

## 踩坑记录

1. **坑：响应内嵌 base64 字体未解码直接解析** → `TTFont(io.BytesIO(woff_str.encode()))` 报 `TTLibError: bad sfntVersion`。正确做法：先 `base64.b64decode` 再 `BytesIO`（见 `references/rendering/font-anti-crawl.md` 骨架）。
2. **坑：从 match5/6 迁移"GET HTML 开窗"步骤** → 开窗响应 `Set-Cookie` 下发新匿名 sessionid 覆盖注入登录态，提交答案持续 401 not login；且 match7 数据接口本不需要开窗。正确做法：同站经验迁移前先直接请求一次数据接口验证；确需开窗时提交前复查 cookie jar（反模式 18）。
3. **坑：误以为 `m` 参数必填** → `m: window.match7` 来自 `/api/match/7`（404）的 hook 遗留，未定义时被 `$.param` 省略，请求不带 m 照样 200。正确做法：取证看实际请求 URL，死代码参数忽略（同 match4 的 `window.match4`）。
4. **坑：提交 401 后怀疑账号/csrftoken/cookie 域** → 数据接口正常而提交 401 时，优先排查「会话 cookie 被中途覆盖」而非账号状态。

---

## 可验证事实清单（经验资产）

1. `GET /api/question/7?page=N&pageSize=10&kw=` 无签名参数，仅需 `sessionid` cookie；requests 直连即可（无 TLS 检测）
2. 响应 `{status, data, woff}`：`data` 每条为 6 个 `&#xNNNN;` PUA 码点实体（6 位数字）；`woff` 为 base64 TrueType 字体
3. 字体码点随请求轮换（PUA 区），但 0-9 的 `glyf.flags` md5 指纹跨字体/跨会话固定
4. 指纹→数字表（2026-08 验证）：`9bb9…→2, 0aef…→0, f9d1…→8, 3dcf…→7, 9ebc…→5, ec94…→4, 4119…→9, af60…→6, 2c0e…→1, b024…→3`（完整值见交付 result/final.py）
5. 末页（第 5 页）UA 必须为 `yuanrenxue`（与 match4/5/6 同）
6. 提交接口 `POST /a/7`，body `answer=<5页之和>`；正确返回 `{"result":"success","created":true,"code":2}`，重复提交返回 `code=1`
7. GET `/match/7` HTML 会 `Set-Cookie` 重置 sessionid——本题无需开窗，也不要开窗
8. pageSize=10，5 页共 50 个 6 位数求和；`/api/match/7` 返回 404（死代码）
9. 依赖仅需 `requests` + `fonttools`（无 brotli：字体是 TTF 非 woff2）

---

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/rendering/font-anti-crawl.md` | 本题核心方法论：内嵌字体形态、字形指纹法、ground truth 验证阶梯 |
| `cases/yuanrenxue-match4-sprite-pixelsort.md` | 同平台内容还原型先例（图片拼装），同样无签名参数、Step 2 无证据价值 |
| `cases/yuanrenxue-match-index.md` | 猿人学题号速查表（本题已收录） |
| `references/workflow/common-pitfalls.md` | 反模式 17（决策循环）、18（开窗经验跨题迁移）实战来源 |
