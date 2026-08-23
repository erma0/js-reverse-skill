# 滑块缺口坐标来源判定（先判来源，再选路线）

> **交叉引用**：答案层求解闭环见 `captcha-solving-handoff.md`；verify 封装/轨迹加密见 `captcha-motion-encryption.md`；题型分类见 `captcha-types.md`；总览与 answer JSON 契约见 `captcha-overview.md`；取证纪律见 `workflow/trace-flow.md`。

## 为什么必须先判来源

滑块缺口 x 坐标的**来源**决定解法路线，走错路线必然失败或不精确：

- 坐标在**接口参数/图片像素**里（逆向可得，100% 精确），却去图像识别 → 识别结果差几像素、或直接找错缺口，反复调 ddddocr/打码平台也不 work。
- 坐标只能靠**看图**（纯图像题），却去翻参数找坐标 → 找不到，误判"接口没给坐标"。

"答案对但验证失败""图像识别永远差几像素"这类问题的最常见根因，不是轨迹或封装，而是**第一步坐标来源判错**。

## 三类来源总览

| 来源 | 原理 | 拿坐标的方式 | 典型场景 |
| --- | --- | --- | --- |
| **A 参数加密** | load/get 响应 JSON 里**本来就包含**缺口 x，但被加密/混淆/隐藏字段名 | 逆向解密参数 → 精确，**不需要看图** | 部分厂商 load 响应 |
| **B 图片隐写** | x 被编码进**图片像素**（特定像素/区域的值），SDK 下载图后从像素里"读"出来 | 逆向 SDK 像素读取逻辑，本地复现提取 → 精确，**也不需要 AI 看图** | 极验 v4 bg 图（部分版本） |
| **C 纯图像识别** | 只给背景图+滑块图，x 只能"看"出来 | ddddocr `slide_match` / OpenCV 模板匹配 / 打码平台 / VLM | 极验 v3 大部分、易盾、顶象、腾讯等 |

核心认知：A/B 属于**逆向**范畴（与封装层同一套方法论），C 属于**视觉求解**范畴。同一厂商不同版本可能切换实现（如极验 v4 部分版本隐写、部分版本纯图），**以本次 trace 证据为准，不套历史结论**。

## 判定流程（FORENSIC_CAPTURE → TRACE_CAPTURE 取证时完成）

拿到成功链路（用户手动通过一次）的 RuyiTrace NDJSON + ruyipage 抓包后，按顺序判定：

```text
① 抓 load → solve → verify 全链路，保存素材图（bg/slice/fullbg）原文件
② 查 load 响应 JSON：是否存在疑似坐标字段（x / offset / answer / gap / data 内嵌，含混淆名）
     → 有：走路线 A。先验证该值是否与图片缺口位置吻合（对比素材图目测）
③ 无 → 查 SDK 是否对素材图做像素级读取后再算 x：
     搜 JS 中 createImageBitmap / getImageData / canvas 像素读取 + 后续数值运算
     （trace 里按 api=canvas/getImageData/createImageBitmap 过滤）
     → 有：走路线 B。定位读取后的运算段（坐标解码函数）
④ 都无 → 走路线 C 图像识别
```

判定信号速查：

| 信号 | 指向 |
| --- | --- |
| load 响应含加密字段，解密后是数值型 | A |
| bg 图与 fullbg 图缺口处像素不是单纯"抠掉"，而是填充/编码色；SDK 含 `getImageData`/像素运算 | B |
| 素材图就是普通缺口图，SDK 无像素读取逻辑 | C |
| 同一厂商历史版本有 A/B 案例，但本次 JS 版本变了 | 重新按 ①②③ 判，禁止沿用 |

## 路线 A：参数解密取坐标

1. 在 trace/抓包里定位携带坐标的加密字段（可能在 load 响应、图片 URL query、或嵌套配置串里）。
2. 逆向解密逻辑：搜索该字段从响应到使用的调用链，定位解密函数（AES/RSA/自定义异或/混淆数组取下标均可，方法同封装层逆向）。
3. 解密后得到 x（可能还需换算：图片像素 → 显示像素，见 `scripts/map_coordinates.py`）。
4. 用素材图目测交叉验证 x 是否落在缺口中心，防止解到的是干扰值。

## 路线 B：图片隐写 / 像素提取

1. 取证：Hook canvas `getImageData` / `createImageBitmap` / `drawImage`，确认 SDK 在 load 后对 bg 图做了像素读取；按调用栈定位后续数值运算段（坐标解码函数）。
2. 还原：把"像素读取 + 解码运算"段从 SDK 提取为纯函数（Node 侧用 PNG 解码库喂入 bg 图），本地复现输出 x。
3. 验证：对多个不同素材图复现，x 均与缺口中心吻合，且数值稳定（隐写是确定性编码，不会像视觉识别那样抖动）。
4. 注意：不同版本编码方式（读取哪部分像素、如何运算、是否需先还原图片）不同，一律以本次 trace 的 SDK 逻辑为准。
5. 更彻底的替代：直接在内存层 Hook SDK 内部**算好的坐标变量**（trace 里定位 x 的赋值/解密点），绕过像素解码逻辑直接拿值，省去复现解码；Hook 纪律见 `hooks/hook-templates.md`（只观察不篡改）。

## 路线 C：图像识别（本地优先，打码兜底）

- 本地一条龙：`scripts/detect_gap.py`——自动运行 ddddocr `slide_match`/`slide_comparison` 与 OpenCV absdiff/模板匹配（有 `--full` 时差分精度最高），逐方法标注锚点（左边缘/中心）与可用性（依赖缺失自动 skip），输出方法间一致性；分歧 >8px 时先复核 A/B 判定。坐标换算用 `scripts/map_coordinates.py`。
- 局限性：现代高混淆滑块（网易易盾/腾讯防水墙/阿里 2.x 等）背景图常做像素扰动、色彩偏移、噪点、边缘抹平/反转，Canny/Sobel/模板匹配普遍失效——这正是"纯算不可行"说法的来源。本地识别不稳时，**优先回头复核 A/B 判定信号**（是否漏了参数字段或像素隐写线索），不要反复换识别算法。
- 精度：识别出的像素坐标需经 `scripts/map_coordinates.py` 换算为显示坐标，再喂轨迹脚本。
- 兜底：确认是纯 C 类且本地识别不稳时，切打码平台（`scripts/solver_request_template.py` + `solver-platform-recipes.md`），平台返回坐标同样要换算。

## 极验 v4 专项（bg 隐写坐标）

极验 v4（gcaptcha4）滑块是 B 类（隐写）的典型。注意点：

- **判定**：bg 图缺口位置不是普通"抠图"视觉缺口，SDK 靠读取图片像素拿 x；若按 C 类对它做模板匹配，结果通常不准且不稳定。
- **证据**：从 trace 抓 `getImageData`/`createImageBitmap` 调用与后续数值运算，定位解码函数；素材图 URL 与 load 响应字段一起保存。
- **复现**：把解码段提取为纯函数（Node PNG 解码喂入），输出 x 后与缺口目测位置交叉验证；数值必须稳定。
- **版本时效**：极验 SDK 周级更新，编码方式可能随版本变化；命中案例后必须过 SKILL.md CASE_LOOKUP 版本时效校验（JS URL / sha256 / 参数结构），不一致就以本次 trace 重新分析。
- **封装层照常**：坐标来源是 A/B/C 不影响 w 参数加密、轨迹加密与 challenge 绑定还原，照 `captcha-motion-encryption.md` 走。

## 三路线输出统一进 answer JSON

无论 A/B/C 哪条路线拿到 x，都按 `captcha-overview.md` 的 answer JSON 契约输出（`offset.x` + `coordinate_space` + `source_image_size`/`display_size`），后续轨迹生成、参数化链路不变：

```text
x（A 解密 / B 像素提取 / C 识别）→ map_coordinates 换算 → generate_motion_track --distance <x>
→ 填 answer JSON → 加密进 verify 参数 → 校验 node scripts/check_captcha_answer.js
```

## 验证失败排查补充

在 `captcha-motion-encryption.md` 风控排查清单基础上，先补一条：

```text
□ 坐标来源判定：A/B/C 是否判对？A/B 误走 C、或 C 用了错误换算，是最常见的前置根因
```

## 滑动距离获取失败预案（厂商通用）

> 触发条件：ddddocr `slide_match` 识别不准（偏差大、不稳定、找不到缺口），或确认坐标不在图里但还没定位到来源。
> 适用厂商：极验 v3/v4、数美、顶象、腾讯、易盾、阿里云、自托管开源库等所有滑块类验证码。

### 第一步：复核坐标来源（最常见根因，所有厂商通用）

ddddocr 不准 → **不要先换识别算法，先回头判 A/B/C**。复核：
- load/get 响应 JSON 有没有可疑加密字段？（→ A）
- SDK 有没有 `getImageData`/`createImageBitmap` + 数值运算？（→ B）
- 两样都没有？（→ 确认 C）

判错路线是最高频根因：B 类（隐写）误走 C 类（图像识别），ddddocr 永远差几像素。

### 通用降级路径（A/B/C 三路线，所有厂商共用）

| 路线 | 一级方法 | 二级降级 | 三级降级 |
| --- | --- | --- | --- |
| A 参数解密 | 逆向解密 load 响应字段 | — | — |
| B 像素提取 | B-1 内存 Hook 坐标变量 | B-2 提取像素解码纯函数 | B-3 vm 沙箱执行 SDK 片段 |
| C 图像识别 | `detect_gap.py` 一条龙（ddddocr+OpenCV 全方法汇总） | 单方法手调（slide_match/absdiff 模板/边缘参数） | 人工点击（`click_gap.py`）→ 打码平台 |

### 各厂商重点（坐标获取视角）

| 厂商 | 坐标来源常见路线 | 重点注意 |
| --- | --- | --- |
| 极验 v3 | C（纯图像） | ddddocr slide_match 通常可解；有 fullbg 时 absdiff 差分精度最高 |
| 极验 v4 | B（bg 隐写）或 C，**版本相关** | 优先判 B；B-1 Hook 坐标变量最彻底；SDK 周级更新，解码逻辑可能变 |
| 数美 | C 为主 | conf 动态加密配置影响链路，但不影响坐标来源判定；rid 全程绑定 |
| 顶象 | C 为主 | 题型多，先定题型再定坐标路线；constId 独立指纹链不影响坐标 |
| 腾讯 | C 为主 | JSVMP 重度混淆，坐标获取用 ddddocr/打码；封装层走补环境 |
| 易盾 | C 为主 | fp 独立指纹链不影响坐标；validate 含答案+轨迹加密 |
| 阿里云 | C 为主 | image-restore 题型需先还原图片再找坐标 |
| 自托管开源库 | A 或 C | 源码可读，直接读 load 响应或源码定位坐标字段 |

### B 路线三级降级（极验 v4 隐写为重点）

判定是 B 类后，按成本从低到高三级降级：

**B-1 内存 Hook 坐标变量（首选，最彻底）**
- 不复现像素解码逻辑，直接 Hook SDK 内部算好的 x 值
- trace 里定位 x 的赋值点（`getImageData` 调用后的数值运算段），Hook 该变量读取
- 交付物里 solver 不算坐标，而是在 vm 沙箱中执行 SDK 片段 + Hook 取 x
- 优点：绕过解码逻辑，100% 精确；缺点：需执行 SDK JS 片段

**B-2 提取像素解码纯函数（次选，纯协议）**
- 把"像素读取 + 解码运算"段从 SDK 提取为纯 JS/Python 函数
- Node 侧用 PNG 解码库喂入 bg 图字节，复现输出 x
- 优点：完全纯协议，不依赖 SDK 运行时；缺点：SDK 更新后解码逻辑可能变，需重新提取
- 验证：多个不同素材图复现，x 均与缺口吻合且数值稳定

**B-3 vm 沙箱执行 SDK 加密段（兜底）**
- B-2 提取不了（JSVMP/重度混淆）时，用 `templates/vm-sandbox/` 在 Node 侧执行 SDK 的坐标计算段
- 喂入 bg 图字节，沙箱内 Hook 取 x
- 优点：不需要理解解码逻辑，执行即可；缺点：交付物依赖 SDK JS 片段，SDK 更新需重新落盘

### C 路线升级（确认是纯图像题但 ddddocr 不准）

1. 先跑 `scripts/detect_gap.py --bg bg.jpg --target front.png [--full fullbg.jpg]`：一次拿到全部可行方法候选、锚点与一致性；有 `--full` 时 absdiff 差分精度最高，`slide_comparison` 返回**中心点**（注意锚点，脚本已标注）
2. 汇总结果不稳（方法分歧大/无候选）时再单方法手调：`cv2.matchTemplate`（`TM_CCOEFF_NORMED`）/ Canny 边缘匹配 / `cv2.absdiff(bg, fullbg)` 差分
3. 以上都不稳 → **人工点击**（`scripts/click_gap.py`）：显示背景图放大 2 倍 + 拼图块参考叠加，用户点击缺口左边缘，输出 CSS x 坐标。适用于易盾等拼图块重着色导致自动识别失效的场景
4. 人工点击也不适用（需自动化/规模化）→ 打码平台（`solver_request_template.py` + `solver-platform-recipes.md`）
5. 打码也不稳 → 检查图片是否被缩放/裁剪/DPR 不一致（`map_coordinates.py` 换算验证）

### 极验 v4 专项注意（B 路线厂商实例）

- v4 的 `load` 响应可能直接含加密字段（A 路线），也可能 bg 图隐写（B 路线），**不同版本不同**，以本次 trace 为准
- v4 w 内嵌 PoW（`pow_msg`/`pow_sign`），坐标获取方式不影响 PoW 计算
- v4 通过凭据是 seccode 四件套（`pass_token`/`gen_time`/`captcha_output`/`lot_number`），缺一即失败
- SDK 周级更新，B 路线解码逻辑可能随版本变化，命中案例后必须过 CASE_LOOKUP 版本时效校验
- 其他厂商若也出现 B 路线（隐写），同样按 B-1/B-2/B-3 降级，方法论不变

### 能力边界声明

skill 能保证流程完整、判定路径清晰、降级方案可执行，但**不保证每个厂商/版本都能纯算还原坐标**：
- B 路线 B-2（提取纯函数）依赖 SDK 可读性，JSVMP/重度混淆时可能不可行
- B-3（vm 沙箱）是兜底，但交付物需携带 SDK JS 片段，SDK 更新后需重新落盘
- 全部 B 路线降级失败 → 报告"坐标获取超出纯算能力"，建议打码平台或人工接管
- 这不是 skill 缺陷，而是验证码逆向的客观能力边界——厂商投入的混淆成本越高，纯算还原成本越高
