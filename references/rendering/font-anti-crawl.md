# 字体反爬（CSS/渲染层内容混淆）

> 分类：内容渲染层反爬（CSS/字体），**不是验证码题型**——没有"答对/答错"的 verify 语义，只是让页面文本与字符编码不一致。常与加密参数、风控指纹叠加出现。
> 知识分级：本文只含 T1 识别信号与通用方法；具体厂商的字体文件结构、码点布局、接口细节属 T2，只能进 `cases/*.md` 与 case adapter 并带验证日期。

## 1. 原理

页面用自定义字体（woff/woff2）渲染关键文本（价格、手机号、播放量、用户名），字体的 cmap（码点→字形映射）被故意打乱：字符 `3` 的码点位置放的是字形 `7`，或直接使用 PUA（私用区，U+E000–U+F8FF）码点。直接抓包拿到的 HTML 文本是"错"的，只有按字体重建码点→真实字符映射才能还原。

两类形态：

| 形态 | 特征 | 还原成本 |
|---|---|---|
| 静态映射 | 字体文件固定（URL 不变、hash 不变），映射表恒定 | 一次提取映射表，固化为 config |
| 动态映射 | 每次请求/每会话返回不同字体（URL 带随机参数或 hash 变化） | 交付必须"先取字体→解映射→再取数据"，映射可能与会话绑定 |

## 2. T1 识别信号

- HTML/CSS 中 `@font-face` 引用 woff/woff2，或 JS `FontFace` / `document.fonts` API 动态注册字体（trace 可见 `FontFace`、`fonts.add`）。
- 字体资源 URL 带动态参数或 hash 段（如 `/fonts/abc123.woff2?t=1690000000`），多次请求同一页面观察 URL 是否变化可区分静态/动态映射。
- **字体以 base64 内嵌在数据接口响应中**（JSON 字段如 `woff`/`font` 直接携带字体数据，页面用 `data:font/...;base64,` 或 FontFace 消费），无独立字体资源 URL——字体随数据响应逐次下发，必然是动态映射，不必再抓两次判定。
- 关键字段的文本出现 PUA 区码点（U+E000–U+F8FF，常见 ``-`` 私用区，HTML 实体形态如 `&#xc513;`）或与常识不符的字符（价格显示 3 位数但抓包是 4 位乱字符）。
- capture.json 中 CSS/字体资源与业务数据接口来自同一会话且字体先于数据请求加载。
- 纯数字字段抓包值与页面渲染值明显不一致（字段长度都对不上）。

## 3. 还原路径

1. **取证**：用 ruyipage 取证会话内抓到 ①字体资源（forensic bodies / related-hits）②同一会话的页面 HTML 与数据接口响应。静态/动态判定的证据是"多次取证会话中字体 URL/内容 hash 是否变化"。
2. **解析字体**：Python `fontTools`（`TTFont('x.woff2')`；woff2 需 brotli 支持）读取 cmap 与字形轮廓（`glyf`/`CFF ` 表）。Node 可用 `opentype.js`。
3. **构建映射**（三法按序尝试，数字类优先用指纹法）：
   - 有明文样本（页面上能看到真实值）：PUA/乱码点 ↔ 页面显示字符 逐位比对，直接得映射表。
   - **字形轮廓指纹法（无明文样本时的首选）**：动态映射常只轮换"码点↔字形"对应关系，而字形轮廓本身不变——对每个字形取 `glyf` 表的 flags 序列（on/off 曲线点模式）做 md5 指纹。指纹跨字体/跨请求稳定时（取两份不同请求的字体比对同一数字的指纹即可证明），"指纹→字符"表可作为静态 config 固化，交付运行时逐字体重建"码点→指纹→字符"映射。比位图聚类简单且不依赖字体风格。
   - 字形相似度聚类：把每个码点的字形轮廓渲染成位图，与标准字体字形做像素/哈希相似度匹配（指纹法失效、字形本身也在变时使用）。字形渲染比对属于**取证阶段分析**，允许在 ruyipage 环境完成。
4. **纯协议交付**：
   - 静态映射：映射表外置 `result/config` 的 JSON（`{"\uE003": "3", ...}`），解析函数纯查表，无字体依赖。
   - 动态映射：交付入口先请求字体 URL → 用 fontTools/opentype.js（作为**库依赖**而非浏览器依赖，允许）解出本次 cmap → 套用映射 → 再请求数据接口。注意字体 URL 本身可能带签名参数，此时先走常规请求链还原。
5. **验证（字体反爬的 ground truth 阶梯）**：注意 `@font-face`/FontFace 只改变**视觉渲染**，不修改 DOM 文本——`textContent`/`innerText` 读到的永远是 PUA 码点乱码，这是预期行为。因此经验法则 21 的 DOM ground truth（读渲染文本比对）对字体反爬**不适用**，不要反复尝试读渲染文本或转截图 OCR。按以下阶梯验证：
   - 无明文残留：所有码点均在映射表内命中，解码后无 `?`/乱码残留。
   - 可复现性：完整跑多次（每次请求字体都不同），还原结果完全一致——仅当映射正确时才可能（映射错误时不同字体会解码出不同结果）。
   - 交叉验证：指纹表与外部公开方案/多来源比对（如适用）。
   - 最终判定：提交验证（有 answer 语义的平台）或业务接口消费凭据；必要时人工比对页面视觉渲染。

**指纹法最小 Python 骨架**（注意：响应内嵌的 base64 字段解码后可能是 TTF（sfnt magic `00010000`）而非 WOFF，`TTFont` 都能直接读；必须先 `b64decode` 再喂 `BytesIO`，把 base64 字符串的字节直接当字体解析会报 `bad sfntVersion`）：

```python
import base64, io, re
from hashlib import md5
from fontTools.ttLib import TTFont

# "指纹 -> 真实字符" 静态表（取证阶段从两份以上字体验证稳定性后固化）
DIGIT_MD5 = {"9bb9...": "2", "0aef...": "0", ...}

def build_map(font_b64: str) -> dict:
    font = TTFont(io.BytesIO(base64.b64decode(font_b64)))   # 先解码！
    cmap, mapping = font.getBestCmap(), {}
    for cp, gname in cmap.items():
        # getattr 防空字形（flags 可能为 None，如 space/.notdef），空指纹不会命中字典
        digest = md5(bytes(getattr(font["glyf"][gname], "flags", b""))).hexdigest()
        if digest in DIGIT_MD5:
            mapping[cp] = DIGIT_MD5[digest]
    return mapping

def decode(entity_text: str, mapping: dict) -> str:
    return "".join(mapping.get(int(cp, 16), "?")
                   for cp in re.findall(r"&#x([0-9a-fA-F]+)", entity_text))
```

## 4. 与其他反爬层的叠加

- 映射可能参与签名：部分站点把映射表/字体 hash 当作签名入参或密钥材料——还原请求链时若发现签名输入含字体 URL/hash，把映射获取纳入请求链（IMPLEMENT 路径 E：Session 预热）。
- 字体 URL 可能需要 Cookie/UA/Referer 才可访问：对齐请求头顺序，禁止把浏览器抓的字体二进制硬编码为常量（动态映射下会话一变就失效）。
- 与 CSS 位移/伪元素（`::before content`）混淆叠加时，先解字体映射再解 CSS 层（content 值同样可能是 PUA 码点）。

## 5. 常见坑

- **woff2 需要 brotli**：`pip install fonttools brotli` 缺 brotli 时 woff2 解析直接报错，别误判为加密字体。
- **PUA 码点每会话轮换**：静态映射表交付后突然失效，先复查是否其实是动态映射（取证次数不够导致误判），再查映射是否参与签名。
- **映射样本必须同会话**：字体映射与页面文本必须来自同一次取证会话，跨会话拼样本会得出错误映射。
- **字形相似度匹配数字最稳、汉字最难**：数字/字母字形差异大、好匹配；大字符集汉字映射建议找明文样本比对，不要硬聚类。
- **内嵌字体必须先 base64 解码再解析**：把 base64 字符串的字节直接喂给 `TTFont`/`BytesIO` 会报 `bad sfntVersion`，先 `b64decode`；解码后是 TTF（magic `00010000`）还是 WOFF 都能直接读，别按字段名叫 `woff` 就当 WOFF 格式处理。
- **开窗/预热请求可能重置登录态**：GET HTML 页面时服务端可能 `Set-Cookie` 下发新的匿名 sessionid，**覆盖**已注入的登录 cookie，导致后续写请求（提交答案等）返回 401 not login。不是所有题都需要开窗（内容还原型接口通常直接请求即可）；确需开窗时，开窗后、写请求前复查 cookie jar 中登录 cookie 是否仍为注入值，被覆盖则重设。
- **交付边界**：映射提取（渲染比对、字体解析调试）在取证/分析阶段完成；最终 `final.js`/`final.py` 只依赖"HTTP + 字体解析库 + 映射表"，不得依赖浏览器或预置的字体文件渲染能力。

## 6. 相关路由

- 取证与动态资源：`references/network/dynamic-resource.md`
- 请求链与 Session 预热：`references/network/session-chain.md`
- 加密参数入口（映射参与签名时）：`references/crypto/crypto-entry.md`
- 字体资源抓取参数：`scripts/forensic_ruyipage.py`（WASM/大 body 同样落盘 forensic 目录）
