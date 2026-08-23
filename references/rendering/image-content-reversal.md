# 图片型内容反爬（base64/像素判定与还原）

> 分类：内容渲染层反爬，**不是验证码题型**——没有"答对/答错"的 verify 语义，只是让抓包拿到的图片内容难以直接识别。常与加密参数、风控指纹叠加出现（典型：数字验证图、雪碧图数字拼装、滑块图、订单/价格截图化）。
> 知识分级：本文只含 T1 识别信号与通用方法；具体站点的图片尺寸、干扰图规则、排序键、模板固定性属 T2，只能进 `cases/*.md` 并带验证日期。

## 1. 原理

接口返回的不是可读文本，而是内嵌的 base64 PNG 小图（HTML 里 `<img src="data:image/png;base64,...">` 或 JSON 的 `img`/`info` 字段）。目标内容（数字/字符/滑块缺口）藏在图片里，需要**先还原图片内容**才能继续解题（如求和、拼接、识别缺口位置）。

常见形态：

| 形态 | 特征 | 关键难点 |
|---|---|---|
| 雪碧图数字拼装 | 接口返回多张 base64 小图 + `class` + CSS `left` 偏移，页面用 CSS 拼成多位数（如猿人学 match/4） | 干扰图过滤 + **渲染顺序 ≠ HTML 顺序**（排序键含 CSS 偏移）+ 数字识别 |
| 混淆字号 | 数字图有多字形变体或套壳 | 判定"能否像素级匹配"决定是否必须 OCR |
| 滑块缺口图 | 返回背景图 + 缺口图 | 缺口坐标提取（见 `references/captcha/gap-coordinate-source.md`） |

## 2. T1 识别信号

- JSON/HTML 出现大量 `data:image/png;base64,` 或 `img`/`info`/`img1`/`img2` 字段。
- 接口响应无签名参数、但返回体积大（图片 base64 撑大 body），页面依赖 JS/CSS 把图片"还原成可见信息"。
- 图片旁带 `class`（区分隐藏/可见）、`left`/`top` 偏移、`width`/`height`，暗示有 CSS 布局参与拼装。
- 页面渲染值（用户能看到的内容）与抓包原始值差异大（抓包是图片，页面是还原后的数字）。

## 3. 判定"能否像素级匹配"——三步走（核心方法）

**当同站点有多张"目测相同"的图片需要识别时，先判定它们是否像素级相同，再决定要不要 OCR。** 绝不能按 base64 字符串去重下结论——这是本类反爬最大的坑：

| 层 | 含义 | 判别 |
|---|---|---|
| base64 层 | PNG 文件字节内容 | 每张都可能不同（可能带随机元数据） |
| 容器层 | PNG chunk 结构（`tEXt` 等元数据） | 服务端可能塞随机文本，防"base64 字符串字典" |
| **像素层** | 解码后的原始 RGBA 数组 | 服务端给同一张像素图套不同壳时，**像素完全相同** |

正确判定顺序：

1. **先按 base64 去重**；若全部唯一，**不要下结论**（base64 唯一 ≠ 像素唯一）。
2. **解码为像素数组再做哈希去重**（Python：`hashlib.sha256(Image.open(io.BytesIO(png)).tobytes()).hexdigest()`，键可带上图像尺寸；Node 用 raw pixel buffer）。统计像素级唯一数。
3. **跨请求像素级交集**：同页/同接口多次请求，对比像素哈希集合。固定 → 图池固定；不固定 → 每次重绘。
4. 像素唯一且跨请求固定 → **像素哈希字典法可行**：建"像素哈希 → 标签"映射（少量建表 + 大量查表），无需逐张 OCR。
5. 像素也唯一且每次刷新 → 才需要逐张 OCR/视觉识别。

> 实战教训（猿人学 match/4）：按 base64 去重误判"300/300 唯一 → 必须逐张 OCR"，实际像素层只有 0-9 十种模板且跨请求固定 → 像素哈希字典只需 10 次 OCR 建表，甚至可人工标注实现零 OCR。

## 4. 还原路径

### 4.1 构建图像哈希字典的通用骨架

```python
import io, hashlib
from PIL import Image

def pixel_key(b64: str):
    img = Image.open(io.BytesIO(base64.b64decode(b64)))
    return (img.size, hashlib.sha256(img.tobytes()).hexdigest())

# 建表：首次遇到新 key 时识别一次（OCR 或人工标注），之后全部查表
digit_map: dict[tuple, str] = {}
def resolve(b64: str, ocr_fn):
    k = pixel_key(b64)
    if k not in digit_map:
        digit_map[k] = ocr_fn(b64)   # 整个任务通常只触发几次
    return digit_map[k]
```

- 跨请求图池固定时，字典可在一次请求内建全（一页往往能见到全部标签），后续页面全查表。
- 建表若用人工标注（看一页识别 0-9），可实现纯协议零 OCR 依赖。

### 4.2 雪碧图数字拼装还原

- **干扰图过滤**：很多题用 `j_key` 类标记区分隐藏/可见图（如 `j_key = md5(base64(key+value).replace('=',''))`，class 含 j_key 的是 `display:none` 干扰图）。
- **排序键 ≠ HTML 顺序**：td 常用 `inline-flex` + 固定 `width`，可见图实际显示位置 = `有效图序号 × 宽度 + CSS left 偏移`。**排序键 = `有效图序号 + left/宽度`**。隐藏干扰图不占 flex 槽位。直按 HTML 顺序拼会错位（实战首次提交 wrong 的根因）。
- 用**页面渲染 DOM 坐标作为 ground truth** 验证（见节 5），确定排序规则后再写协议逻辑。

## 5. 用页面渲染 DOM 验证纯协议解析（通用技巧）

当纯协议解析结果（顺序/过滤/识别）不确定时，不要盲目提交：用 ruyipage 打开页面（注入必要 cookie/登录态），**同一时刻**做两件事——抓接口响应 + 从 DOM 提取渲染位置（`getBoundingClientRect` 的 x/y = 最终显示位置）。对比「协议解析结果」vs「DOM 实际显示顺序」，不一致时 dump 每张图的 index/left/x 找到排序规律，修正协议逻辑，一致后再提交做最终业务验证。这比"先提交碰运气"高效，且能定位具体规则。

## 6. 常见坑

- **按 base64 去重下结论**（最大坑）：base64 唯一 ≠ 像素唯一，PNG 可能带随机 `tEXt` 元数据。务必解码到像素层再判定。
- **忽略 PNG 尺寸差异**：同数字可能存在高度差 1px 的模板（如 25x30 与 25x31），像素哈希键要带上图像尺寸，否则误判。
- **忽略 CSS 排序**：雪碧图拼装的数字顺序依赖 CSS 偏移，不是 HTML 顺序。用 DOM ground truth 反推排序键。
- **画面字体多变字形**：若像素层确认有多个字形模板，建表时以"像素哈希"精确区分，不要用模板相似度（4/9、1/7 等易混）。
- **交付边界**：图片还原（OCR 建表、DOM 校验、像素判定）在取证/分析阶段完成；最终 `final.js`/`final.py` 只依赖"HTTP + 图像处理/OCR 库（作为库依赖）+ 像素哈希字典"，不得依赖浏览器或预置的图片文件渲染能力。

## 7. 相关路由

- 滑块缺口定位：`references/captcha/gap-coordinate-source.md`、`click_gap.py`
- 字体反爬（相近的渲染层还原）：`references/rendering/font-anti-crawl.md`
- 页面渲染 DOM 验证与 trace：`references/workflow/trace-flow.md`、`references/quality/validation.md`
- 案例：`cases/yuanrenxue-match4-sprite-pixelsort.md`（本方法实战验证）