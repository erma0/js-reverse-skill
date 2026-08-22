# 答案层接入（求解 → answer JSON → 封装）

> **交叉引用**：answer JSON schema 见 `captcha-overview.md`；完整求解 recipes（ddddocr/OpenCV/Whisper/各题型）见 `open-source-recipes.md` 与 `solution-playbooks.md`；坐标/轨迹脚本参数见本 skill `scripts/README.md`。

本文件规定封装层（本 skill 交付物）如何消费答案层产物。原则：**本地开源优先，打码平台兜底，接口契约统一**。

## 硬约束：答案必须由求解器计算，禁止随机/固定值

> 这是 skill 级约束，适用于所有验证码题型，违反即交付失败（等同红线违规）。

1. **滑块/拼图/旋转题型的偏移量必须由图像求解器计算**（ddddocr `slide_match` / OpenCV 模板匹配 / 打码平台），**禁止用随机值、固定值、`Math.random()` 模拟距离**。即使封装层加密参数全部正确，错误答案也会导致 verify 接口返回 `fail`。
2. **点选/网格/区域题型的坐标必须由求解器给出**（ddddocr `detection` + 语义分类 / 打码平台），禁止人工瞎猜坐标或用图片中心点。
3. 答案正确是验证通过的**必要非充分条件**：仍需配合人类轨迹（`scripts/generate_motion_track.py`）、合理 passtime/imgload、challenge 新鲜度。
4. **求解失败时的正确动作**：报告"答案层求解失败/置信度低"，按 `gap-coordinate-source.md` 的「滑动距离获取失败预案」逐步升级（复核来源 → B 路线三级降级 / C 路线升级 → 打码平台 → 人工接管）——**不是**继续用错误答案提交并把失败归因为"视觉解题范畴不属逆向目标"。答案层求解是验证码逆向交付的组成部分，不是可跳过的可选步骤。
5. 检测点：交付门禁 `scripts/check_final_artifact.js` 检测到验证码交付（config 含 `captcha` 配置或引用 adapter 契约）时，会校验 `result/src/adapter.*` 与答案层接入（`src/solver.*` 或等效求解代码）同时存在，缺一即 FAIL；连续失败复盘按 `verification-workflow.md` 的 5 次门槛走，不要把答案错误当作封装层 bug 反复调试。

## 求解路径优先级

```text
① 本地开源（默认）：ddddocr / OpenCV / 自训模型 —— 零按次成本、离线、可规模化
② 人工接管（降级）：click_gap.py 点击缺口坐标 / RuyiTrace 窗口手动通过取基线 —— 本地识别失效时
③ 打码平台（兜底）：云码 / 超级鹰 / 2Captcha / CapSolver —— 需自动化/规模化且人工不适用时
```

**交付语言选择**：ddddocr / OpenCV / Whisper 均为 Python 生态，答案层用这些工具时**优先选 `templates/captcha-verify-py/`（Python 版）**——solver 直接 `import ddddocr`，无需跨语言桥接。仅当封装层加密逻辑只在 Node 侧还原（vm 沙箱/JS 执行）时才用 `templates/captcha-verify/`（Node 版），此时 solver 需通过 `child_process` 或 HTTP 微服务调 Python ddddocr。

切换条件（自动判断）：同一 challenge 素材本地求解置信度低，或连续失败复盘确认"视觉答案正确但验证失败"非轨迹/环境问题 → 升级路径。

## ddddocr 三能力速查（用法与官方 README 一致）

```python
import ddddocr

# 文字类（text/math 题面）：classification(image) → str
ocr = ddddocr.DdddOcr(show_ad=False)
text = ocr.classification(img_bytes)

# 滑块类算法1 边缘匹配（滑块图 target + 背景图 background）
det = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)
res = det.slide_match(target_bytes, background_bytes)   # {'target': [x1,y1,x2,y2]} bbox，取 res['target'][0] 为缺口左边缘 x
# 滑块无透明背景时加 simple_target=True：det.slide_match(target_bytes, background_bytes, simple_target=True)

# 滑块类算法2 图像差异比较（带缺口阴影图 + 完整图，两图差分 → 点坐标）
res2 = det.slide_comparison(bg_with_shadow_bytes, fullpage_bytes)   # {'target': [x, y]}

# 目标检测（点选/图标类 → 候选框）：detection(image) → [[x1,y1,x2,y2], ...]
det2 = ddddocr.DdddOcr(det=True, ocr=False, show_ad=False)
boxes = det2.detection(img_bytes)
```

注意：detection 只出候选框**不含语义**——"点所有公交车"这类需要再叠分类/CLIP 或走打码平台。

## 人工接管降级（click_gap.py）

当 ddddocr / OpenCV 自动识别不稳定时（典型：拼图块重着色/背景像素扰动导致 Canny/Sobel/模板匹配失效），降级为人工接管。人工接管有两种形式：

```bash
python scripts/click_gap.py bg.jpg front.png --scale 2
# → 弹窗显示背景图放大 2 倍 + 右上角拼图块参考叠加
# → 鼠标左键点击缺口左边缘 → 输出 CSS x 坐标（整数）
# → ESC 取消输出 NO_CLICK
```

输出 x 坐标按 answer JSON 契约（`captcha-overview.md`）组装为 `offset.x`，交给本 case 的 `result/src/solver.*` 或直接进 `final` 入口的 solve 阶段；具体接口形态由 case adapter 决定，不使用任何厂商专属函数名。

**形式二：RuyiTrace 窗口完整手动通过**——用户在 RuyiTrace Firefox 窗口手动完成验证码交互（点击/拖拽/登录），获取成功链路基线（HAR/NDJSON），用于取证分析或验证加密逻辑正确性。

适用场景：开发调试期、低频调用、自动识别失效时的即时降级。不适合需要自动化/规模化的场景——此时走打码平台。

## 素材获取（封装层职责）

1. 素材 URL 从 load/get 响应 JSON 提取（字段名各厂商不同：极验 `bg`/`slice`/`fullbg`，注意路径可能是相对路径 + 混淆前缀）。
2. 素材图下载用**与业务请求一致的 TLS 指纹客户端**（curl_cffi / curl-cffi-node），且带相同 Session cookie——部分厂商素材 URL 绑 Session。
3. 素材落盘 `case/forensic/`（取证期）或内存直传 solver（交付物），禁止交付物把素材写临时文件后遗留。
4. canvas 绘制场景：取证阶段从页面提取合成图；交付物优先找接口直出的底图字段，没有时才考虑素材 URL 拼装。

## 坐标与轨迹脚本（本 skill scripts/ 已移植）

```bash
# 坐标换算：图片像素 → CSS/页面坐标（DPR/元素偏移/滚动）
python scripts/map_coordinates.py --image-size 300x150 --display-size 300x150 --point 120,75 --pretty

# 轨迹生成：slider / drag-drop / scratch / trace
python scripts/generate_motion_track.py --mode slider --distance 128 --duration-ms 1100 --pretty

# 切片乱序还原（image-restore / tile-scramble）
python scripts/analyze_tile_restore.py --image scrambled.png --rows 3 --cols 3 --pretty
```

滑块闭环：`ddddocr slide_match → target_x → 按显示比例换算（map_coordinates 思路）→ generate_motion_track --distance <x> → track 数组 → 填 answer JSON → 加密进 w`。

## 打码平台适配（兜底）

- 交付物中放 `result/src/solver/` 适配器：统一接口 `solve(image, type, options) → answer JSON`。
- 平台凭据走 `config.json` 外置（`solver.platform`、`solver.api_key`），脱敏交付，禁止硬编码。
- 请求模板见 `scripts/solver_request_template.py`；平台选型见 `solver-platform-recipes.md`。
- 平台返回坐标系与厂商图片坐标系可能不一致，必须经 map_coordinates 逻辑换算后再参数化。

## 接口校验

交付前对 solver 输出跑 schema 校验，不通过不进 IMPLEMENT：

```bash
node scripts/check_captcha_answer.js --file answer.json
```
