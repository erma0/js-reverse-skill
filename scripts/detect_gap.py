#!/usr/bin/env python3
"""滑块缺口自动识别工具（C 路线本地识别一条龙）。

前提：已按 references/captcha/gap-coordinate-source.md 判定坐标来源为
C（纯图像识别）。A（参数解密）/ B（像素隐写）路线不走本脚本。

按依赖与素材可用性自动运行全部可行方法并汇总候选：
- ddddocr slide_match（滑块图 + 背景图，--simple-target 处理无透明背景滑块）
- ddddocr slide_comparison（缺口图 + 完整背景图差分）
- OpenCV absdiff（有 --full 时差分定位，精度最高）
- OpenCV 模板匹配（原图 + Canny 边缘两版）
输出图片像素坐标系下的缺口 x（左边缘）、各方法明细与方法间一致性；
CSS 换算交给 scripts/map_coordinates.py。依赖缺失不报错，逐方法标注
skipped 与原因；无任何候选输出 NO_CANDIDATE 并退出非 0。
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

try:
    import cv2
except ImportError:
    cv2 = None

try:
    import ddddocr
except ImportError:
    ddddocr = None

# 候选方法优先级（best 选取顺序，仅左边缘锚点方法参与）：完整背景差分 > 双图匹配 > 模板
METHOD_PRIORITY = ["absdiff", "slide_match", "template_edge", "template"]
AGREEMENT_PX = 5.0
DISAGREEMENT_PX = 8.0


def configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


configure_utf8_stdio()


def read_bytes(path: str) -> bytes | None:
    try:
        with open(path, "rb") as handle:
            return handle.read()
    except OSError:
        return None


def method_slide_match(bg_path: str, target_path: str, simple_target: bool) -> dict[str, Any]:
    if ddddocr is None:
        return {"method": "slide_match", "status": "skipped", "reason": "ddddocr 未安装（pip install ddddocr）"}
    bg_bytes = read_bytes(bg_path)
    target_bytes = read_bytes(target_path)
    if not bg_bytes or not target_bytes:
        return {"method": "slide_match", "status": "skipped", "reason": "bg/target 文件不可读"}
    det = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)
    res = det.slide_match(target_bytes, bg_bytes, simple_target=simple_target)
    x = float(res["target"][0])
    return {
        "method": "slide_match",
        "status": "ok",
        "x": x,
        "anchor": "left-edge",
        "detail": {"bbox": res["target"], "simple_target": simple_target},
    }


def method_slide_comparison(bg_path: str, full_path: str) -> dict[str, Any]:
    if ddddocr is None:
        return {"method": "slide_comparison", "status": "skipped", "reason": "ddddocr 未安装（pip install ddddocr）"}
    bg_bytes = read_bytes(bg_path)
    full_bytes = read_bytes(full_path)
    if not bg_bytes or not full_bytes:
        return {"method": "slide_comparison", "status": "skipped", "reason": "bg/full 文件不可读"}
    det = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)
    res = det.slide_comparison(full_bytes, bg_bytes)
    x = float(res["target"][0])
    return {
        "method": "slide_comparison",
        "status": "ok",
        "x": x,
        "anchor": "center",
        "detail": {
            "point": res["target"],
            "note": "ddddocr slide_comparison 返回缺口中心点；换算左边缘需减去缺口半宽（可从 absdiff bbox 或拼图块宽度获取）",
        },
    }


def method_absdiff(bg_path: str, full_path: str) -> dict[str, Any]:
    if cv2 is None:
        return {"method": "absdiff", "status": "skipped", "reason": "opencv 未安装（pip install opencv-python）"}
    bg = cv2.imread(bg_path)
    full = cv2.imread(full_path)
    if bg is None or full is None:
        return {"method": "absdiff", "status": "skipped", "reason": "bg/full 图片解码失败"}
    if bg.shape != full.shape:
        return {"method": "absdiff", "status": "skipped", "reason": f"bg/full 尺寸不一致: {bg.shape[:2]} vs {full.shape[:2]}"}
    diff = cv2.absdiff(cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY), cv2.cvtColor(full, cv2.COLOR_BGR2GRAY))
    _, mask = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
    mask = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return {"method": "absdiff", "status": "failed", "reason": "差分未找到差异区域（阈值 25）"}
    largest = max(contours, key=cv2.contourArea)
    x, _, w, _ = cv2.boundingRect(largest)
    return {
        "method": "absdiff",
        "status": "ok",
        "x": float(x),
        "anchor": "left-edge",
        "detail": {"bbox_w": w, "area": float(cv2.contourArea(largest))},
    }


def method_template(bg_path: str, target_path: str, edge_mode: bool) -> dict[str, Any]:
    name = "template_edge" if edge_mode else "template"
    if cv2 is None:
        return {"method": name, "status": "skipped", "reason": "opencv 未安装（pip install opencv-python）"}
    bg = cv2.imread(bg_path)
    target = cv2.imread(target_path, cv2.IMREAD_UNCHANGED)
    if bg is None or target is None:
        return {"method": name, "status": "skipped", "reason": "bg/target 图片解码失败"}
    th, tw = target.shape[:2]
    if th >= bg.shape[0] or tw >= bg.shape[1]:
        return {"method": name, "status": "skipped", "reason": "模板尺寸不小于背景图"}

    if target.ndim == 3 and target.shape[2] == 4 and not edge_mode:
        mask = target[:, :, 3]
        target_bgr = target[:, :, :3]
        result = cv2.matchTemplate(bg, target_bgr, cv2.TM_CCORR_NORMED, mask=mask)
    else:
        if edge_mode:
            target_bgr = cv2.Canny(cv2.cvtColor(target[:, :, :3] if target.ndim == 3 else target, cv2.COLOR_BGR2GRAY), 100, 200)
            bg_gray = cv2.Canny(cv2.cvtColor(bg, cv2.COLOR_BGR2GRAY), 100, 200)
        else:
            target_bgr = target[:, :, :3] if target.ndim == 3 else target
            bg_gray = bg
        result = cv2.matchTemplate(bg_gray, target_bgr, cv2.TM_CCOEFF_NORMED)
    _, score, _, max_loc = cv2.minMaxLoc(result)
    return {
        "method": name,
        "status": "ok",
        "x": float(max_loc[0]),
        "anchor": "left-edge",
        "detail": {"score": round(float(score), 4)},
    }


def detect(bg_path: str, target_path: str | None, full_path: str | None, simple_target: bool) -> dict[str, Any]:
    methods: list[dict[str, Any]] = []
    if full_path:
        methods.append(method_absdiff(bg_path, full_path))
        methods.append(method_slide_comparison(bg_path, full_path))
    if target_path:
        methods.append(method_slide_match(bg_path, target_path, simple_target))
        if cv2 is not None:
            methods.append(method_template(bg_path, target_path, edge_mode=True))
            methods.append(method_template(bg_path, target_path, edge_mode=False))
    ok_candidates = [m for m in methods if m["status"] == "ok"]
    # best/一致性只取左边缘锚点方法；slide_comparison（中心锚点）仅作候选参考
    left_edge = [m for m in ok_candidates if m.get("anchor") == "left-edge"]

    image_size: list[int] | None = None
    if cv2 is not None:
        bg_img = cv2.imread(bg_path)
        if bg_img is not None:
            image_size = [int(bg_img.shape[1]), int(bg_img.shape[0])]

    best: dict[str, Any] | None = None
    for name in METHOD_PRIORITY:
        for candidate in left_edge:
            if candidate["method"] == name:
                best = {"method": name, "x": candidate["x"]}
                break
        if best:
            break

    agreement: dict[str, Any] | None = None
    if len(left_edge) >= 2 and best:
        deltas = [abs(c["x"] - best["x"]) for c in left_edge]
        within = sum(1 for d in deltas if d <= AGREEMENT_PX)
        agreement = {
            "ok_methods": len(ok_candidates),
            "left_edge_methods": len(left_edge),
            "within_5px": within,
            "max_spread_px": round(max(deltas), 2),
        }

    result: dict[str, Any] = {
        "status": "OK" if best else "NO_CANDIDATE",
        "coordinate_space": "image-pixel",
        "image_size": image_size,
        "candidates": methods,
        "best": best,
        "agreement": agreement,
    }
    if best:
        result["next"] = (
            "CSS 换算：python scripts/map_coordinates.py --image-size {w}x{h} --display-size <显示尺寸> "
            "--point {x},<y> --point-space image"
        ).format(w=image_size[0] if image_size else "<W>", h=image_size[1] if image_size else "<H>", x=best["x"])
        if agreement and agreement["max_spread_px"] > DISAGREEMENT_PX:
            result["warning"] = (
                f"方法间最大分歧 {agreement['max_spread_px']}px，先复核 A/B 来源判定"
                "（gap-coordinate-source.md），不稳时降级人工 click_gap.py"
            )
    else:
        result["hint"] = "无可行方法：安装 ddddocr/opencv-python，或提供 --target/--full；仍失败按 gap-coordinate-source.md C 路线降级（人工 click_gap.py → 打码平台）"
    result["notes"] = [
        "仅用于授权验证分析；识别结果需与素材图目测交叉验证后再使用。",
        "高混淆滑块（像素扰动/重着色）自动识别普遍不稳，失败时优先复核坐标来源 A/B 判定。",
    ]
    return result


def run_self_test() -> int:
    # 依赖缺失/文件缺失路径：逐方法 skipped、状态 NO_CANDIDATE，不抛异常
    outcome = detect("nonexistent-bg.png", "nonexistent-target.png", None, False)
    statuses = {m["method"]: m["status"] for m in outcome["candidates"]}
    if ddddocr is None:
        assert statuses.get("slide_match") == "skipped", "ddddocr 缺失应 skipped 而非报错"
    if cv2 is None:
        assert outcome["image_size"] is None, "cv2 缺失时 image_size 应为 None"
    assert outcome["best"] is None and outcome["status"] == "NO_CANDIDATE"
    assert "hint" in outcome, "无候选时应给出降级提示"

    # 输出结构完整性
    for key in ("status", "coordinate_space", "candidates", "best", "agreement", "notes"):
        assert key in outcome, f"输出缺少字段 {key}"

    # 有 cv2 时用合成图验证差分/模板定位与锚点语义（无 cv2 环境跳过）
    if cv2 is not None:
        import numpy as np
        import os
        import tempfile

        full = np.random.randint(100, 200, (120, 320, 3), dtype=np.uint8)
        bg = full.copy()
        bg[:, 180:220] = (30, 30, 30)  # 在 x=180 处抠出宽 40 的缺口
        with tempfile.TemporaryDirectory() as tmp:
            bg_path = os.path.join(tmp, "bg.png")
            full_path = os.path.join(tmp, "full.png")
            cv2.imwrite(bg_path, bg)
            cv2.imwrite(full_path, full)
            outcome = detect(bg_path, None, full_path, False)
            ok = [m for m in outcome["candidates"] if m["status"] == "ok"]
            assert ok, f"合成差分图应至少一个方法命中: {outcome['candidates']}"
            for m in ok:
                if m.get("anchor") == "left-edge":
                    assert abs(m["x"] - 180) <= 6, f"{m['method']} 左边缘定位偏差过大: {m['x']}"
                else:
                    # slide_comparison 返回中心点：(180+220)/2 = 200
                    assert abs(m["x"] - 200) <= 6, f"{m['method']} 中心点定位偏差过大: {m['x']}"
            assert outcome["best"] is not None and abs(outcome["best"]["x"] - 180) <= 6, "best 必须取左边缘锚点"
    else:
        print("note: opencv 未安装，跳过合成图定位断言（CI 环境预期路径）")

    print("SELF-TEST OK")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return run_self_test()

    parser = argparse.ArgumentParser(description="滑块缺口自动识别（C 路线本地一条龙）")
    parser.add_argument("--bg", required=True, help="带缺口背景图路径")
    parser.add_argument("--target", default=None, help="滑块拼图块图路径（slide_match/模板匹配用）")
    parser.add_argument("--full", default=None, help="完整无缺口背景图路径（差分用，精度最高）")
    parser.add_argument("--simple-target", action="store_true", help="ddddocr slide_match simple_target 模式（滑块无透明背景时）")
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    try:
        result = detect(args.bg, args.target, args.full, args.simple_target)
    except Exception as exc:  # noqa: BLE001 - 顶层兜底，保证 JSON 形态输出
        print(json.dumps({"status": "ERROR", "error": str(exc)}, ensure_ascii=False))
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0 if result["status"] == "OK" else 1


if __name__ == "__main__":
    raise SystemExit(main())
