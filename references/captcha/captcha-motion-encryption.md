# 轨迹加密专项

> **交叉引用**：轨迹生成脚本用法见 `captcha-solving-handoff.md`；Hook 纪律见 `hooks/hook-templates.md`（只观察不篡改）；经验法则 #1（Hook 必须在 SDK 加载前安装）。

轨迹是验证码风控的核心校验维度之一：**答案对、token 合法，轨迹不像人照样失败**。轨迹链路分三段：采集（浏览器事件）→ 结构化（数组）→ 加密（进 w/token）。逆向目标是后两段，轨迹本身由脚本生成（见交接文档）。

## 采集点定位（取证阶段）

1. 候选事件：`mousedown` / `mousemove` / `mouseup` / `click` / `pointerdown` / `pointermove` / `pointerup` / `touchstart` / `touchmove` / `touchend`。
2. Hook 必须在验证码 SDK 加载**之前**安装（经验法则 #1），否则处理器已绑定、轨迹已进加密流程。
3. 在 RuyiTrace NDJSON 中按 `api=addEventListener` + 事件类型过滤，找到 SDK 注册的处理器位置；再按时间邻近度找到轨迹数组的读写函数。
4. 注意 SDK 可能用 `addEventListener` 的 capture 阶段、或挂在 `document`/`window` 上代理——按 stack 确认，不要只看元素本身。
5. **移动 H5 / touch 场景**：先从成功样本确认 SDK 实际采集的是 mouse 还是 touch 事件形态（字段集可能含 touch 点列表/力度等额外维度）。`generate_motion_track.py` 目前只产鼠标式 `{x,y,t}` 轨迹；touch 形态需按成功样本明文字段由 case adapter 适配，不要把鼠标轨迹直接当 touch 轨迹提交。

## 轨迹数据结构（典型形态）

```text
极验 v3 滑块（示意，字段名以 trace dump 为准，不同版本有差异）：
  主轨迹数组 = [x1,y1,t1, x2,y2,t2, ...]   相对起点的位移 + 相对时间
  可能存在归一化/变换后的副轨迹数组 + 二次编码字符串形态
共同点：时间从按下开始累计（ms），x 单调递增大趋势 + 末端微调，y 有 ±1~3 抖动
```

**还原要点**：先在成功链路 trace 里 dump 出 SDK 实际产出的轨迹数组（加密前的明文），对比 `scripts/generate_motion_track.py` 生成的轨迹结构，对齐字段含义（绝对/相对、时间基准、单位、末端是否包含抬起后的静止段）。**禁止只凭猜**——以成功样本的明文轨迹为准。

## 人类轨迹特征（风控校验核心）

`generate_motion_track.py` 内置两种滑块轨迹模型 + 点选点击时序，按厂商真实形态选用（形态判定用 `analyze_track.py` 对成功样本统计得出）：

- **eased 模型**（`--model eased`，默认）：连续「先加速后减速」曲线，通用近似
- **staircase 模型**（`--model staircase`）：「移动步 + 微调步」严格交替的离散阶梯，参数全部可配（步长/间隔/首点/对数），部分厂商真实 SDK 就是这种形态
- **click 模式**（`--mode click`）：点选题点击时序——坐标微抖动、首次反应延迟、点间间隔与按下-抬起停留随机化

eased 模型内置以下拟人特征，缺一容易被风控识别：

| 特征 | 说明 | 脚本实现 |
| --- | --- | --- |
| 起手静止段 | 按下后 1-3 个点不动（瞄准/犹豫），50-100ms | 前 8% 采样点 x/y 不变 |
| 先加速后减速 | 主体段用 `ease_in_out_cubic`，不是匀速也不是纯 `ease_out` | 主体段 80% 时长 |
| 末端 overshoot 回弹 | 超出目标 1-3px 再回拉（人手纠正） | 末端 12% 采样点 |
| 时间间隔不均匀 | 人手速度波动，±2-5ms | 每点 t 加 `uniform(-3,3)` |
| y 轴微抖动 | ±1-3px，非均匀分布 | `jitter * 0.45` |

**关键纪律**：
1. **禁止用纯 `ease_out` + 均匀抖动**——这是最容易被风控识别的机器特征（缺少加速段和 overshoot）。
2. **每次请求重新生成轨迹**——`generate_motion_track.py` 的 seed 缺省每次随机并回显在输出 JSON 中，禁止复用固定轨迹数组。
3. **以成功样本明文轨迹为准**——从用户手动通过的成功链路 trace 中 dump 出 SDK 加密前的轨迹数组，先用 `scripts/analyze_track.py` 做逐点统计（点数/间隔分布/步长序列/单调性/**形态判定**），再选模型与参数，禁止只凭猜。
4. **厂商轨迹格式差异**——不同厂商对轨迹的编码不同，脚本生成的 `{x,y,t}` 数组只是中间格式，交付物必须按厂商 trace 证据转换：

| 厂商 | 轨迹格式特征（以 trace 为准） |
| --- | --- |
| 极验 v3 | 相对前一点偏移 + 偏移量映射，字符表 51 字符编码为 `aa` 字段 |
| 极验 v4 | 轨迹进 w 明文，格式与 v3 类似但字段名/编码可能不同 |
| 数美 | 轨迹与答案合并加密，字段名以 trace 为准 |
| 顶象 | token 分段（指纹段+行为段+答案段），行为段含轨迹 |
| 腾讯 | JSVMP 加密，轨迹格式需从 trace dump |
| 易盾 | check 的 `d` 字段：42-55 点阶梯状（移动步 5-6px/50-70ms + 微调步 1px/17-27ms 严格交替），点数由时长 1.8-2.5s 决定；移动步长自适应=(总距离-对数)/对数；**非贝塞尔曲线**（真实轨迹是离散阶梯） |
| 阿里云 | `sig` 含答案+会话签名，`afs` 是行为采集段 |

## 实证补充（易盾 jigsaw 2026-08-09，纯协议 3/3 通过）

`generate_motion_track.py` 的 eased 曲线是**通用近似**；易盾真实 SDK 轨迹是「移动步 + 微调步」严格交替的**离散阶梯**（已落成脚本的 staircase 模型），不是平滑曲线。写生成参数前必须先做逐点统计（`analyze_track.py`），再按真实样本重建：

- 点数由**时长**决定（40-55，1.8-2.5s，间隔约 45ms/点），**与距离无关**
- 微调步恒 1px；移动步长自适应 = (总距离 - 对数) / 对数（150px→5-6px，102px→2-4px）
- 移动步 T 间隔 50-70ms，微调步 17-27ms；Y 全程 0；X/T 严格递增；首点 X=5/T=146-250

## 轨迹参数包（profile）与生成-复核闭环

按 SKILL.md T1/T2 知识分级政策：**脚本与 templates 只保留通用模型（T1），厂商实测参数（T2）只进 case adapter**——

```text
① 成功样本明文 dump（trace 加密前轨迹数组）
② python scripts/analyze_track.py --input sample.json          # 统计 + 形态判定（staircase/eased/unknown）
③ 按统计写 result/src/track-profile.json（带验证日期；示例见 cases/yidun-jigsaw.md）
④ python scripts/generate_motion_track.py --mode slider --model staircase --profile result/src/track-profile.json --distance <本次 offset>
⑤ python scripts/analyze_track.py --input sample.json --compare generated.json   # 偏差 verdict 必须 ok
```

- profile 键名与 CLI 目标名一致（`model`/`move_interval_ms`/`adjust_step_px`/`first_x`/`first_t_ms`/`pairs`/`duration_ms` 等），显式 CLI 旗标优先于 profile（`--distance` 每次 challenge 都要单独传）
- 换新版本 SDK 时**必须重跑 ①②**，profile 时效随 case 版本时效（CASE_LOOKUP 校验），禁止拿旧 profile 直接提交

## 点选题轨迹/点击时序（click-select）

点选题不只校验坐标答案，也普遍采集**点击行为**。`generate_motion_track.py --mode click` 生成中间格式 `{x,y,t,order,dwell_ms}`：

- 坐标微抖动（±jitter px，不与目标完全重合）
- 首次点击反应延迟 300-700ms、点间间隔 400-900ms、按下-抬起停留 60-150ms（全部参数可配）
- 厂商实际采集形态（mousedown/mouseup 对、click 序列、是否含点间移动轨迹）**以成功样本明文为准**，由 case adapter 展开，不要直接把中间格式当厂商格式提交

**验证码链路调试铁律**：
1. 拿到成功样本 URL 第一步**全字段解密**（d/m/p/f/ext 一个不漏），m 空串陷阱是最隐蔽的失败源
2. 协议验证默认带坐标扫描（±8-15px 逐 px），人工/打码坐标误差实测 6-13px，单点必 false
3. 逐字段核对明文类型后再写代码，禁止只解关注字段后凭猜

## 加密入口定位

1. 从 verify 请求体里的 w/cb 倒推（四层链路：writer→builder→entry）。
2. 在 NDJSON 中搜轨迹数组变量的最后一次读到第一次加密调用之间的调用栈。
3. 极验系：轨迹常与 passtime/userresponse 一起进同一个 JSON，AES 加密；AES key 再 RSA。定位顺序：先找 JSON.stringify 点，再找加密函数。
4. 数美/顶象：轨迹可能与答案分字段、也可能合并；按 case trace 确认，不套用极验结论。

## 风控校验点清单（验证失败时按序排查）

```text
□ challenge 新鲜度：是否复用了旧 challenge（最常见，必查）
□ 轨迹合理性：时长(一般 0.8~2s)、x 单调性、y 抖动、末端减速、无跳变
□ 轨迹与答案一致性：轨迹终点 x ≈ 答案 offset（允许小误差，方向必须一致）
□ passtime 与轨迹总时长一致
□ 环境指纹：与成功样本基线一致（fp/constId/浏览器特征）
□ 答案精度：缺口偏移误差是否在厂商容差内（一般 ±5px 内安全）
□ 请求节奏：load → verify 间隔是否像人（太快=机器特征）
```

## 交付物要求

- 轨迹模板内置 `result/src/`（从成功样本提炼的典型轨迹 + 随机扰动函数），**不是**硬编码某一条成功轨迹；阶梯类厂商固化为 `track-profile.json` 参数包（T2，带验证日期）。
- 每次请求重新生成轨迹（距离 = 本次答案 offset，时长/抖动随机化，seed 缺省随机并回显），禁止复用固定轨迹数组。
- 轨迹加密算法按 IMPLEMENT 方案梯度还原：可提取 → 纯算法；不可提取 → vm 沙箱执行 SDK 加密段。
