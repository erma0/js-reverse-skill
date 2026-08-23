#!/usr/bin/env python3
"""生成授权验证分析用的鼠标/触摸轨迹 JSON。

脚本只生成离线轨迹，不控制浏览器、不点击页面、不提交验证码。
移植自 xbsReverseSkill/web-verify-patcher/scripts（2026-07-30）。

轨迹模型（T1 通用能力，不含任何厂商实测参数）：
- eased      先加速后减速的连续曲线（通用近似，弱风控场景可用）
- staircase  移动步+微调步交替的离散阶梯（步长/间隔全部参数化；厂商实证
             参数属于 T2，只能以 --profile 参数包形式由 case adapter 提供，
             见 SKILL.md T1/T2 知识分级政策与 cases/yidun-jigsaw.md 示例）

模式：slider / drag-drop（用 --model 选模型）、scratch、trace、click（点选
点击时序）。移动 H5 的 touch 事件形态（触摸点列表/力度等字段）本脚本不
产出，需按成功样本明文字段由 case adapter 适配，不要把鼠标轨迹直接当
touch 轨迹提交。

seed 未显式指定时每次随机并回显在输出 JSON 中，禁止复用固定轨迹。
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
from typing import Any

PROFILE_KEYS = {
    "mode",
    "model",
    "distance",
    "vertical",
    "start",
    "end",
    "box",
    "points",
    "move_interval_ms",
    "adjust_interval_ms",
    "adjust_step_px",
    "first_x",
    "first_t_ms",
    "pairs",
    "first_delay_ms",
    "click_interval_ms",
    "click_dwell_ms",
    "duration_ms",
    "steps",
    "rows",
    "jitter",
}


def configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


configure_utf8_stdio()


def parse_pair(value: str) -> tuple[float, float]:
    parts = [part.strip() for part in value.split(",")]
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(f"需要 x,y: {value}")
    return float(parts[0]), float(parts[1])


def parse_box(value: str) -> tuple[float, float, float, float]:
    parts = [part.strip() for part in value.split(",")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(f"需要 left,top,right,bottom: {value}")
    left, top, right, bottom = (float(part) for part in parts)
    if right <= left or bottom <= top:
        raise argparse.ArgumentTypeError("box 的 right/bottom 必须大于 left/top")
    return left, top, right, bottom


def parse_points(value: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for item in value.split():
        points.append(parse_pair(item))
    if len(points) < 2:
        raise argparse.ArgumentTypeError("至少需要两个点")
    return points


def parse_range(value: str) -> tuple[float, float]:
    """解析 "min,max" 数值区间。"""
    pair = parse_pair(value)
    if pair[0] > pair[1]:
        raise argparse.ArgumentTypeError(f"区间 min 不能大于 max: {value}")
    return pair


def ease_in_out_cubic(t: float) -> float:
    """先加速后减速，比纯 ease_out 更接近人类滑动手势。"""
    if t < 0.5:
        return 4 * t ** 3
    return 1 - ((-2 * t + 2) ** 3) / 2


def make_slider_track(
    start: tuple[float, float],
    end: tuple[float, float],
    duration_ms: int,
    steps: int,
    jitter: float,
    rng: random.Random,
) -> list[dict[str, float]]:
    """生成拟人滑块轨迹：起手静止 → 加速 → 减速 → 末端微调回弹。

    人类滑动的关键特征（缺一容易被风控识别）：
    - 起手 1-3 个点静止（按下后犹豫/瞄准）
    - 主体段先加速后减速（ease_in_out），不是匀速也不是纯 ease_out
    - 末端有 1-2 个微调点（超出再回拉，或不到再前推）
    - 时间间隔不均匀（人手速度波动，±2-5ms）
    - y 轴有微小抖动（±1-3px，不是均匀分布）
    """
    if steps < 8:
        raise ValueError("steps 必须至少为 8（拟人轨迹需要起手+主体+末端段）")

    sx, sy = start
    ex, ey = end
    total_dx = ex - sx

    # 段分配：起手静止(约8%) + 主体滑动(约80%) + 末端微调(约12%)
    hold_count = max(1, steps // 12)
    tail_count = max(1, steps // 8)
    main_count = steps - hold_count - tail_count

    result: list[dict[str, float]] = []

    # 起手静止段（按下后不动，模拟瞄准）
    for i in range(hold_count):
        t = round(duration_ms * i / (steps - 1) * 0.08)
        result.append({"x": round(sx, 3), "y": round(sy, 3), "t": t})

    # 主体滑动段（先加速后减速）
    main_duration_start = 0.08
    main_duration_end = 0.88
    for i in range(main_count):
        progress = i / max(1, main_count - 1)
        eased = ease_in_out_cubic(progress)
        x = sx + total_dx * eased
        y = sy + (ey - sy) * eased
        if jitter:
            x += rng.uniform(-jitter, jitter)
            y += rng.uniform(-jitter * 0.45, jitter * 0.45)
        t = round(duration_ms * (main_duration_start + (main_duration_end - main_duration_start) * progress))
        result.append({"x": round(x, 3), "y": round(y, 3), "t": t})

    # 末端微调段：超出目标 1-3px 再回拉（模拟人手 overshoot 纠正）
    overshoot = rng.uniform(1.0, 3.0)
    for i in range(tail_count):
        progress = (i + 1) / tail_count
        if progress < 0.5:
            x = ex + overshoot * (1 - progress * 2)
        else:
            x = ex
        y = ey + rng.uniform(-jitter * 0.3, jitter * 0.3)
        t = round(duration_ms * (main_duration_end + (1.0 - main_duration_end) * progress))
        result.append({"x": round(x, 3), "y": round(y, 3), "t": t})

    # 时间间隔抖动（人手速度波动，±2-5ms）
    if len(result) > 2:
        for i in range(1, len(result) - 1):
            result[i]["t"] = round(result[i]["t"] + rng.uniform(-3, 3))
        # 确保时间单调递增
        for i in range(1, len(result)):
            if result[i]["t"] <= result[i - 1]["t"]:
                result[i]["t"] = result[i - 1]["t"] + 1

    return result


def make_staircase_track(
    start: tuple[float, float],
    distance: float,
    duration_ms: int,
    move_interval_ms: tuple[float, float],
    adjust_interval_ms: tuple[float, float],
    adjust_step_px: float,
    first_x: float,
    first_t_ms: tuple[float, float],
    pairs: int | None,
    rng: random.Random,
) -> list[dict[str, float]]:
    """生成「移动步 + 微调步」严格交替的离散阶梯轨迹。

    与 eased 连续曲线相对：部分厂商真实 SDK 轨迹是离散阶梯（见
    references/captcha/captcha-motion-encryption.md 实证补充）。特征：
    - 点数由时长决定（每对 = 一个移动步 + 一个微调步），与距离无关
    - 移动步长自适应 = (总位移 - pairs*微调步长) / pairs
    - X/T 严格递增；y 恒为起点 y（不抖动）；末端精确落在目标点
    本函数只实现通用数学结构，具体步长/间隔参数由成功样本统计或
    case profile 提供（--profile），禁止凭猜填数。
    """
    sx, sy = start
    if distance <= 0:
        raise ValueError("staircase 需要 distance > 0")
    if first_x <= sx or first_x >= sx + distance:
        raise ValueError(f"first_x 必须落在 (起点x, 起点x+distance) 区间内: {first_x}")
    for name, span in (("move_interval_ms", move_interval_ms), ("adjust_interval_ms", adjust_interval_ms)):
        if span[0] < 1:
            raise ValueError(f"{name} 的 min 必须 >= 1ms（保证 T 严格递增）")

    if pairs is None:
        avg_pair_ms = (sum(move_interval_ms) + sum(adjust_interval_ms)) / 2
        pairs = max(8, round((duration_ms - sum(first_t_ms) / 2) / avg_pair_ms))

    end_x = sx + distance
    move_px = (end_x - first_x - pairs * adjust_step_px) / pairs
    if move_px <= adjust_step_px:
        raise ValueError(
            f"pairs={pairs} 过大或微调步过长，移动步长 {move_px:.3f}px <= 微调步 {adjust_step_px}px；"
            "调小 --pairs / --adjust-step-px，或增大 --duration-ms"
        )

    result: list[dict[str, float]] = []
    x = float(first_x)
    t = rng.uniform(*first_t_ms)
    result.append({"x": round(x, 3), "y": round(sy, 3), "t": round(t, 1)})

    for _ in range(pairs):
        x += move_px
        t += rng.uniform(*move_interval_ms)
        result.append({"x": round(x, 3), "y": round(sy, 3), "t": round(t, 1)})
        x += adjust_step_px
        t += rng.uniform(*adjust_interval_ms)
        result.append({"x": round(x, 3), "y": round(sy, 3), "t": round(t, 1)})

    # 取整误差校准：末点必须精确等于目标（轨迹终点与答案一致性要求）
    result[-1]["x"] = round(end_x, 3)
    return result


def make_click_track(
    targets: list[tuple[float, float]],
    first_delay_ms: tuple[float, float],
    click_interval_ms: tuple[float, float],
    click_dwell_ms: tuple[float, float],
    jitter: float,
    rng: random.Random,
) -> list[dict[str, float]]:
    """生成点选题的点击时序：坐标微抖动 + 首次反应延迟 + 点间间隔随机化。

    输出是 {x,y,t,order,dwell_ms} 中间格式；厂商采集形态（mousedown/
    mouseup 对、click 序列、是否含移动轨迹）由 case adapter 按成功样本
    明文展开，不要直接把本格式当厂商格式提交。
    """
    result: list[dict[str, float]] = []
    t = rng.uniform(*first_delay_ms)
    for order, (px, py) in enumerate(targets, start=1):
        x = px + rng.uniform(-jitter, jitter)
        y = py + rng.uniform(-jitter, jitter)
        dwell = rng.uniform(*click_dwell_ms)
        result.append(
            {
                "x": round(x, 3),
                "y": round(y, 3),
                "t": round(t, 1),
                "order": order,
                "dwell_ms": round(dwell, 1),
            }
        )
        t += dwell + rng.uniform(*click_interval_ms)
    return result


def make_scratch_track(
    box: tuple[float, float, float, float],
    duration_ms: int,
    rows: int,
    rng: random.Random,
) -> list[dict[str, float]]:
    left, top, right, bottom = box
    rows = max(2, rows)
    points: list[tuple[float, float]] = []
    for row in range(rows):
        y = top + (bottom - top) * row / (rows - 1)
        y += rng.uniform(-1.5, 1.5)
        if row % 2 == 0:
            points.append((left, y))
            points.append((right, y))
        else:
            points.append((right, y))
            points.append((left, y))
    return resample_polyline(points, duration_ms, max(2, rows * 8), jitter=0.8, rng=rng)


def polyline_length(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for first, second in zip(points, points[1:]):
        total += math.dist(first, second)
    return total


def resample_polyline(
    points: list[tuple[float, float]],
    duration_ms: int,
    steps: int,
    jitter: float,
    rng: random.Random,
) -> list[dict[str, float]]:
    total_length = polyline_length(points)
    if total_length <= 0:
        raise ValueError("路径长度必须大于 0")
    result: list[dict[str, float]] = []
    segment_index = 0
    segment_start_distance = 0.0
    segment_length = math_dist(points[0], points[1])
    for index in range(steps):
        target_distance = total_length * index / (steps - 1)
        while segment_index < len(points) - 2 and segment_start_distance + segment_length < target_distance:
            segment_start_distance += segment_length
            segment_index += 1
            segment_length = math.dist(points[segment_index], points[segment_index + 1])
        local = 0.0 if segment_length == 0 else (target_distance - segment_start_distance) / segment_length
        x1, y1 = points[segment_index]
        x2, y2 = points[segment_index + 1]
        x = x1 + (x2 - x1) * local
        y = y1 + (y2 - y1) * local
        if 0 < index < steps - 1 and jitter:
            x += rng.uniform(-jitter, jitter)
            y += rng.uniform(-jitter, jitter)
        result.append({"x": round(x, 3), "y": round(y, 3), "t": round(duration_ms * index / (steps - 1))})
    return result


def validate_profile(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("profile 必须是 JSON 对象")
    unknown = sorted(k for k in set(data) - PROFILE_KEYS if not k.startswith("_"))
    if unknown:
        raise ValueError(f"profile 含未知键 {unknown}；合法键见 scripts/README.md profile 说明")
    if "start" in data and not (isinstance(data["start"], list) and len(data["start"]) == 2):
        raise ValueError("profile.start 必须是 [x,y] 数组")
    return data


def load_profile(path: str) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        return validate_profile(json.load(handle))


def apply_profile(args: argparse.Namespace, profile: dict[str, Any], argv: list[str] | None = None) -> None:
    """profile 提供参数包基线，命令行显式传入的旗标优先生效；下划线开头键为元数据（T2 验证日期等），不参与赋值。"""
    explicit = collect_explicit_dests(argv)
    for key, value in profile.items():
        if key.startswith("_") or key in explicit:
            continue
        setattr(args, key, value)


def collect_explicit_dests(argv: list[str] | None = None) -> set[str]:
    """收集命令行显式旗标对应的 argparse dest；profile 不得覆盖它们。"""
    tokens = sys.argv[1:] if argv is None else argv
    flag_to_dest: dict[str, str] = {}
    for action in build_parser()._actions:
        for flag in action.option_strings:
            flag_to_dest[flag] = action.dest
    dests: set[str] = set()
    for token in tokens:
        if not token.startswith("--"):
            continue
        flag = token.split("=", 1)[0]
        if flag in flag_to_dest:
            dests.add(flag_to_dest[flag])
    return dests


def build_track(args: argparse.Namespace, seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    result: dict[str, Any] = {
        "mode": args.mode,
        "seed": seed,
        "coordinate_space": "element-css",
        "duration_ms": args.duration_ms,
        "points": [],
    }
    if args.mode in ("slider", "drag-drop"):
        if args.mode == "slider":
            start = args.start or (0.0, 0.0)
            end = (start[0] + args.distance, start[1] + args.vertical)
        else:
            if args.start is None or args.end is None:
                raise ValueError("drag-drop 需要 --start 和 --end")
            start, end = args.start, args.end
        result["model"] = args.model
        if args.model == "staircase":
            result["points"] = make_staircase_track(
                start=start,
                distance=end[0] - start[0],
                duration_ms=args.duration_ms,
                move_interval_ms=args.move_interval_ms,
                adjust_interval_ms=args.adjust_interval_ms,
                adjust_step_px=args.adjust_step_px,
                first_x=args.first_x,
                first_t_ms=args.first_t_ms,
                pairs=args.pairs,
                rng=rng,
            )
        else:
            result["points"] = make_slider_track(start, end, args.duration_ms, args.steps, args.jitter, rng)
    elif args.mode == "click":
        if args.points is None:
            raise ValueError("click 需要 --points（按点击顺序给点列）")
        result["points"] = make_click_track(
            targets=args.points,
            first_delay_ms=args.first_delay_ms,
            click_interval_ms=args.click_interval_ms,
            click_dwell_ms=args.click_dwell_ms,
            jitter=args.jitter,
            rng=rng,
        )
        result.pop("duration_ms")
    elif args.mode == "scratch":
        if args.box is None:
            raise ValueError("scratch 需要 --box")
        result["points"] = make_scratch_track(args.box, args.duration_ms, args.rows, rng)
    elif args.mode == "trace":
        if args.points is None:
            raise ValueError("trace 需要 --points")
        result["points"] = resample_polyline(args.points, args.duration_ms, args.steps, args.jitter, rng)
    else:
        raise ValueError(f"未知 mode: {args.mode}")
    result["notes"] = [
        "轨迹仅用于授权验证分析。",
        "真实页面执行前必须再次确认授权范围和浏览器取证模式。",
    ]
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="生成验证码验证分析用轨迹 JSON")
    parser.add_argument("--mode", choices=["slider", "drag-drop", "scratch", "trace", "click"], required=True)
    parser.add_argument("--model", choices=["eased", "staircase"], default="eased", help="slider/drag-drop 轨迹模型；staircase 需配 --profile 提供实测参数")
    parser.add_argument("--distance", type=float, default=0.0, help="slider 水平距离")
    parser.add_argument("--vertical", type=float, default=0.0, help="slider 垂直偏移")
    parser.add_argument("--start", type=parse_pair, help="起点 x,y")
    parser.add_argument("--end", type=parse_pair, help="终点 x,y")
    parser.add_argument("--box", type=parse_box, help="scratch 区域 left,top,right,bottom")
    parser.add_argument("--points", type=parse_points, help='点列，如 "10,10 80,30 120,90"；click 模式按点击顺序传入')
    parser.add_argument("--move-interval-ms", type=parse_range, default=(50.0, 70.0), help="staircase 移动步时间区间 min,max")
    parser.add_argument("--adjust-interval-ms", type=parse_range, default=(17.0, 27.0), help="staircase 微调步时间区间 min,max")
    parser.add_argument("--adjust-step-px", type=float, default=1.0, help="staircase 微调步步长 px")
    parser.add_argument("--first-x", type=float, default=5.0, help="staircase 首点绝对 x")
    parser.add_argument("--first-t-ms", type=parse_range, default=(146.0, 250.0), help="staircase 首点时间区间 min,max")
    parser.add_argument("--pairs", type=int, default=None, help="staircase 移动/微调对数；缺省按 --duration-ms 推导")
    parser.add_argument("--first-delay-ms", type=parse_range, default=(300.0, 700.0), help="click 首次点击反应延迟区间 min,max")
    parser.add_argument("--click-interval-ms", type=parse_range, default=(400.0, 900.0), help="click 相邻点击间隔区间 min,max")
    parser.add_argument("--click-dwell-ms", type=parse_range, default=(60.0, 150.0), help="click 按下-抬起停留区间 min,max")
    parser.add_argument("--duration-ms", type=int, default=1200)
    parser.add_argument("--steps", type=int, default=64, help="采样点数；真实鼠标事件流约 8-16ms/点，24 点/1.1s 密度过低易被风控识别，默认 64（staircase 按时长推导点数，忽略本参数）")
    parser.add_argument("--rows", type=int, default=6)
    parser.add_argument("--jitter", type=float, default=1.2)
    parser.add_argument("--seed", type=int, default=None, help="随机种子；缺省每次随机并在输出 JSON 回显，禁止固定复用同一条轨迹")
    parser.add_argument("--profile", type=str, default=None, help="参数包 JSON 路径（case adapter 提供的 T2 实测参数；显式 CLI 旗标优先于 profile）")
    parser.add_argument("--pretty", action="store_true")
    parser.add_argument("--self-test", action="store_true", help="运行内置自测（离线确定性）")
    return parser


def run_self_test() -> int:
    # eased 模型：时间严格递增、起手段静止、终点落在距离附近（±jitter+overshoot）
    eased = make_slider_track((0.0, 0.0), (128.0, 0.0), 1100, 64, 1.2, random.Random(7))
    assert all(b["t"] > a["t"] for a, b in zip(eased, eased[1:])), "eased: t 必须严格递增"
    assert eased[0]["x"] == 0.0 and eased[0]["y"] == 0.0, "eased: 首点应等于起点"
    assert abs(eased[-1]["x"] - 128.0) <= 3.0, "eased: 末点应落在目标附近（微调段）"

    # staircase 模型：X/T 严格递增、末点精确等于目标、y 恒定、步长交替
    stairs = make_staircase_track(
        start=(0.0, 0.0),
        distance=150.0,
        duration_ms=1829,
        move_interval_ms=(50.0, 70.0),
        adjust_interval_ms=(17.0, 27.0),
        adjust_step_px=1.0,
        first_x=5.0,
        first_t_ms=(146.0, 250.0),
        pairs=None,
        rng=random.Random(7),
    )
    assert all(b["x"] > a["x"] for a, b in zip(stairs, stairs[1:])), "staircase: x 必须严格递增"
    assert all(b["t"] > a["t"] for a, b in zip(stairs, stairs[1:])), "staircase: t 必须严格递增"
    assert stairs[-1]["x"] == 150.0, "staircase: 末点必须精确等于目标"
    assert all(p["y"] == 0.0 for p in stairs), "staircase: y 恒为起点 y"
    steps_dx = [round(b["x"] - a["x"], 2) for a, b in zip(stairs, stairs[1:])]
    assert steps_dx[-1] == 1.0, "staircase: 微调步应恒为 adjust_step_px"
    move_steps = steps_dx[0::2]
    assert all(2.0 <= s <= 7.0 for s in move_steps), "staircase: 移动步长应明显大于微调步"

    # click 模式：order 连续、t 递增、坐标在 jitter 内
    clicks = make_click_track(
        targets=[(30.5, 40.0), (100.0, 80.5), (60.0, 120.0)],
        first_delay_ms=(300.0, 700.0),
        click_interval_ms=(400.0, 900.0),
        click_dwell_ms=(60.0, 150.0),
        jitter=1.5,
        rng=random.Random(7),
    )
    assert [c["order"] for c in clicks] == [1, 2, 3], "click: order 必须连续"
    assert all(b["t"] > a["t"] for a, b in zip(clicks, clicks[1:])), "click: t 必须递增"
    assert abs(clicks[0]["x"] - 30.5) <= 1.5, "click: 坐标抖动必须在 jitter 内"

    # profile：未知键拦截、_meta 元数据豁免、显式 CLI 优先
    try:
        validate_profile({"vendor_secret": 1})
        raise AssertionError("profile 未知键应被拦截")
    except ValueError:
        pass
    validate_profile({"model": "staircase", "_meta": {"verified": "2026-08-09"}})

    argv = ["--mode", "slider", "--distance", "150", "--model", "staircase"]
    args = build_parser().parse_args(argv)
    apply_profile(args, {"model": "eased", "jitter": 2.0, "_meta": {"verified": "2026-08-09"}}, argv=argv)
    # argv 中显式给了 --model staircase，profile 的 eased 不得覆盖
    assert args.model == "staircase", "profile 不得覆盖显式 CLI 旗标"
    assert args.jitter == 2.0, "profile 应填补未显式给出的参数"

    print("SELF-TEST OK")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return run_self_test()
    parser = build_parser()
    args = parser.parse_args()
    if args.profile:
        apply_profile(args, load_profile(args.profile))
    seed = args.seed if args.seed is not None else random.randrange(1, 2 ** 31)
    result = build_track(args, seed)
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
