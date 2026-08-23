#!/usr/bin/env python3
"""成功样本明文轨迹统计与生成轨迹对比工具。

「以成功样本明文轨迹为准」纪律的可执行化：输入从成功链路 trace dump 出的
SDK 加密前明文轨迹（JSON），输出逐点统计（点数/时长/间隔分布/步长序列/
单调性/y 抖动/形态判定），并可对比 generate_motion_track.py 生成的轨迹，
偏差超阈值时给出 warn，用于推导生成参数前先核对样本结构。

只做离线统计，不打开浏览器、不提交验证。
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Any

# 阶梯形态判定阈值：步长 <= 1.5px 视为微调步，> 1.5px 视为移动步
SMALL_STEP_PX = 1.5
# 交替率 >= 0.7 且移动步中位数 >= 2.5px 判定为 staircase
ALTERNATION_RATIO = 0.7
LARGE_STEP_MIN_PX = 2.5
# 对比模式偏差阈值（中位数/点数/时长，相对百分比）
COMPARE_TOLERANCE_PCT = 20.0


def configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


configure_utf8_stdio()


def load_points(data: Any) -> list[tuple[float, float, float]]:
    """解析多种明文轨迹形态，统一为 [(x, y, t), ...]。

    支持：{"points": [{x,y,t}|[x,y,t]]}、[[x,y,t], ...]、扁平 [x,y,t, ...]。
    """
    points: list[tuple[float, float, float]] = []

    def push(entry: Any) -> None:
        if isinstance(entry, dict):
            points.append((float(entry["x"]), float(entry["y"]), float(entry["t"])))
        elif isinstance(entry, (list, tuple)) and len(entry) >= 3:
            points.append((float(entry[0]), float(entry[1]), float(entry[2])))
        else:
            raise ValueError(f"无法解析轨迹点: {entry!r}")

    if isinstance(data, dict) and "points" in data:
        for entry in data["points"]:
            push(entry)
    elif isinstance(data, list) and data and isinstance(data[0], (list, tuple, dict)):
        for entry in data:
            push(entry)
    elif isinstance(data, list):
        if len(data) < 3 or len(data) % 3 != 0:
            raise ValueError("扁平轨迹数组长度必须是 3 的倍数（x,y,t 交替）")
        for i in range(0, len(data), 3):
            points.append((float(data[i]), float(data[i + 1]), float(data[i + 2])))
    else:
        raise ValueError("输入必须是含 points 的对象或点列数组")

    if len(points) < 2:
        raise ValueError("至少需要两个轨迹点")
    return points


def median(values: list[float]) -> float:
    if not values:
        raise ValueError("median 需要非空列表")
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def percentile(values: list[float], ratio: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(ratio * (len(ordered) - 1))))
    return ordered[index]


def detect_pattern(steps_dx: list[float]) -> tuple[str, dict[str, Any]]:
    """形态判定：staircase（移动/微调交替）/ eased（连续变速）/ unknown。"""
    large = [s for s in steps_dx if s > SMALL_STEP_PX]
    small = [s for s in steps_dx if s <= SMALL_STEP_PX]
    if len(large) >= 4 and len(small) >= 4:
        classes = [s > SMALL_STEP_PX for s in steps_dx]
        transitions = sum(1 for a, b in zip(classes, classes[1:]) if a != b)
        alternation_ratio = transitions / max(1, len(classes) - 1)
        med_large = median(large)
        evidence = {
            "alternation_ratio": round(alternation_ratio, 3),
            "large_step_count": len(large),
            "small_step_count": len(small),
            "large_step_median_px": round(med_large, 3),
            "small_step_median_px": round(median(small), 3),
        }
        if alternation_ratio >= ALTERNATION_RATIO and med_large >= LARGE_STEP_MIN_PX:
            return "staircase", evidence
        return "unknown", evidence
    return "unknown", {
        "large_step_count": len(large),
        "small_step_count": len(small),
    }


def analyze(points: list[tuple[float, float, float]]) -> dict[str, Any]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    ts = [p[2] for p in points]

    intervals = [round(b - a, 3) for a, b in zip(ts, ts[1:])]
    steps_dx = [round(b - a, 3) for a, b in zip(xs, xs[1:])]
    x_violations = sum(1 for dx in steps_dx if dx < 0)
    t_violations = sum(1 for dt in intervals if dt <= 0)

    # 速度（px/ms）：按相邻点计算，首尾半段时间均值对比识别加减速形态
    velocities = [abs(dx) / dt if dt > 0 else 0.0 for dx, dt in zip(steps_dx, intervals)]
    half = len(velocities) // 2
    first_half_v = sum(velocities[:half]) / max(1, half)
    second_half_v = sum(velocities[half:]) / max(1, len(velocities) - half)

    pattern, pattern_evidence = detect_pattern(steps_dx)

    return {
        "point_count": len(points),
        "duration_ms": round(ts[-1] - ts[0], 3),
        "t_start": round(ts[0], 3),
        "first_point": {"x": round(xs[0], 3), "y": round(ys[0], 3), "t": round(ts[0], 3)},
        "last_point": {"x": round(xs[-1], 3), "y": round(ys[-1], 3), "t": round(ts[-1], 3)},
        "total_dx": round(xs[-1] - xs[0], 3),
        "intervals": {
            "min": min(intervals) if intervals else None,
            "median": round(median(intervals), 3) if intervals else None,
            "mean": round(sum(intervals) / len(intervals), 3) if intervals else None,
            "p90": round(percentile(intervals, 0.9), 3) if intervals else None,
            "max": max(intervals) if intervals else None,
        },
        "steps_x": {
            "min": min(steps_dx) if steps_dx else None,
            "median": round(median(steps_dx), 3) if steps_dx else None,
            "mean": round(sum(steps_dx) / len(steps_dx), 3) if steps_dx else None,
            "max": max(steps_dx) if steps_dx else None,
            "zero_count": sum(1 for dx in steps_dx if dx == 0),
        },
        "step_sequence_x": steps_dx,
        "interval_sequence": intervals,
        "x_monotonic_nondecreasing": x_violations == 0,
        "x_monotonic_violations": x_violations,
        "t_monotonic_increasing": t_violations == 0,
        "y_range": [round(min(ys), 3), round(max(ys), 3)],
        "y_jitter_px": round(max(ys) - min(ys), 3),
        "velocity": {
            "mean_px_per_ms": round(sum(velocities) / max(1, len(velocities)), 6),
            "first_half_mean": round(first_half_v, 6),
            "second_half_mean": round(second_half_v, 6),
        },
        "pattern": pattern,
        "pattern_evidence": pattern_evidence,
    }


def compare(sample: dict[str, Any], generated: dict[str, Any]) -> dict[str, Any]:
    """对比成功样本统计与生成轨迹统计，相对偏差超阈值标 warn。"""

    def delta_pct(a: float, b: float) -> float | None:
        if a == 0:
            return None if b == 0 else math.inf
        return round(abs(b - a) / abs(a) * 100, 2)

    fields: list[tuple[str, float | int | None]] = [
        ("point_count", sample["point_count"]),
        ("duration_ms", sample["duration_ms"]),
        ("intervals_median", sample["intervals"]["median"]),
        ("steps_x_median", sample["steps_x"]["median"]),
    ]
    gen_values = {
        "point_count": generated["point_count"],
        "duration_ms": generated["duration_ms"],
        "intervals_median": generated["intervals"]["median"],
        "steps_x_median": generated["steps_x"]["median"],
    }
    rows: list[dict[str, Any]] = []
    for name, sample_value in fields:
        gen_value = gen_values[name]
        pct = delta_pct(float(sample_value), float(gen_value)) if sample_value is not None and gen_value is not None else None
        rows.append(
            {
                "field": name,
                "sample": sample_value,
                "generated": gen_value,
                "delta_pct": pct,
                "status": "ok" if pct is not None and pct <= COMPARE_TOLERANCE_PCT else "warn",
            }
        )
    same_pattern = sample["pattern"] == generated["pattern"]
    if not same_pattern:
        rows.append(
            {
                "field": "pattern",
                "sample": sample["pattern"],
                "generated": generated["pattern"],
                "delta_pct": None,
                "status": "warn",
            }
        )
    has_warn = any(row["status"] == "warn" for row in rows)
    return {
        "tolerance_pct": COMPARE_TOLERANCE_PCT,
        "fields": rows,
        "same_pattern": same_pattern,
        "verdict": "ok" if not has_warn else "warn",
        "hint": "warn 字段表示生成参数与成功样本结构偏差超过阈值；按样本统计调 profile/CLI 参数后重生成再对比",
    }


def run_self_test() -> int:
    # staircase 样本：5 起步 + 严格交替（6.25 移动 / 1 微调），y 恒 0
    stairs: list[tuple[float, float, float]] = [(5.0, 0.0, 180.0)]
    x, t = 5.0, 180.0
    for _ in range(20):
        x, t = x + 6.25, t + 60.0
        stairs.append((x, 0.0, t))
        x, t = x + 1.0, t + 22.0
        stairs.append((x, 0.0, t))
    stats = analyze(stairs)
    assert stats["pattern"] == "staircase", f"阶梯样本应判定 staircase: {stats['pattern_evidence']}"
    assert stats["x_monotonic_nondecreasing"] and stats["t_monotonic_increasing"]
    assert stats["y_jitter_px"] == 0.0

    # eased 样本：连续变速 + y 抖动，应判 unknown（非阶梯）
    eased = [(0.0, 0.0, 0.0)]
    for i in range(1, 40):
        progress = i / 39
        eased_x = 128 * (4 * progress ** 3 if progress < 0.5 else 1 - ((-2 * progress + 2) ** 3) / 2)
        eased.append((round(eased_x, 3), round(math.sin(i) * 1.5, 3), i * 28.0))
    stats2 = analyze(eased)
    assert stats2["pattern"] != "staircase", "连续曲线不应误判为 staircase"
    assert stats2["y_jitter_px"] > 0

    # 多形态解析：dict points / 三元组列表 / 扁平数组
    assert load_points({"points": [{"x": 1, "y": 2, "t": 3}, {"x": 4, "y": 5, "t": 6}]}) == [(1.0, 2.0, 3.0), (4.0, 5.0, 6.0)]
    assert load_points([[1, 2, 3], [4, 5, 6]]) == [(1.0, 2.0, 3.0), (4.0, 5.0, 6.0)]
    assert load_points([1, 2, 3, 4, 5, 6]) == [(1.0, 2.0, 3.0), (4.0, 5.0, 6.0)]
    try:
        load_points([1, 2, 3, 4])
        raise AssertionError("扁平数组长度非 3 倍数应报错")
    except ValueError:
        pass

    # 对比：样本 41 点 vs 生成 64 点 → point_count warn
    gen_stats = analyze([(i * 2.0, 0.0, i * 18.0) for i in range(64)])
    verdict = compare(stats, gen_stats)
    assert verdict["verdict"] == "warn", "点数/间隔偏差大时应 warn"
    same = compare(stats, analyze(stairs))
    assert same["verdict"] == "ok", "同构轨迹对比应 ok"

    print("SELF-TEST OK")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return run_self_test()

    parser = argparse.ArgumentParser(description="成功样本明文轨迹统计与生成轨迹对比")
    parser.add_argument("--input", required=True, help="成功样本明文轨迹 JSON 路径（支持 points 对象/三元组列表/扁平数组）")
    parser.add_argument("--compare", default=None, help="生成轨迹 JSON 路径（generate_motion_track.py 输出），输出逐字段偏差对比")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    try:
        with open(args.input, "r", encoding="utf-8") as handle:
            sample_stats = analyze(load_points(json.load(handle)))
    except (OSError, ValueError, KeyError) as exc:
        print(json.dumps({"error": f"样本轨迹解析失败: {exc}"}, ensure_ascii=False))
        return 1

    result: dict[str, Any] = {"sample": sample_stats}
    if args.compare:
        try:
            with open(args.compare, "r", encoding="utf-8") as handle:
                generated_stats = analyze(load_points(json.load(handle)))
        except (OSError, ValueError, KeyError) as exc:
            print(json.dumps({"error": f"对比轨迹解析失败: {exc}"}, ensure_ascii=False))
            return 1
        result["generated"] = generated_stats
        result["comparison"] = compare(sample_stats, generated_stats)

    result["notes"] = [
        "统计仅用于授权验证分析；以成功样本明文为准，禁止凭猜填生成参数。",
        "生成参数推导顺序：样本统计 → profile/CLI 参数 → 重生成 → --compare 复核。",
    ]
    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
