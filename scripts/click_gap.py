#!/usr/bin/env python3
"""人工点击缺口工具（OpenCV）：显示背景图，用户点击缺口左边缘，输出 CSS x 坐标。

适用场景：ddddocr / OpenCV 模板匹配等自动识别失效时（如拼图块重着色、
背景图像素扰动/色彩偏移导致 Canny/Sobel/模板匹配不稳定），降级为人工点击。

- 背景图放大 2 倍显示便于精确点击（可通过 --scale 调整）
- 右上角叠加拼图块作形状参考（半透明，可选）
- 操作：鼠标左键点击缺口左边缘 → 点击即确认；ESC 取消输出 NO_CLICK
- 输出：CSS x 坐标整数（= jigsaw.left 真值），供 final.js / final.py 消费

用法:
  python click_gap.py <bg.jpg> [front.png] [--scale 2]

示例:
  python click_gap.py bg.jpg front.png --scale 2
  python click_gap.py bg.jpg            # 不叠加拼图块参考
"""
import argparse
import os
import sys

import cv2


def main():
    parser = argparse.ArgumentParser(description="人工点击缺口工具（OpenCV）")
    parser.add_argument("bg", help="背景图路径")
    parser.add_argument("front", nargs="?", default=None, help="拼图块图路径（可选，叠加参考）")
    parser.add_argument("--scale", type=int, default=2, help="显示放大倍数（默认 2）")
    args = parser.parse_args()

    bg = cv2.imread(args.bg)
    if bg is None:
        print("NO_CLICK")
        return 1

    H, W = bg.shape[:2]
    scale = max(1, args.scale)
    disp = cv2.resize(bg, (W * scale, H * scale), interpolation=cv2.INTER_CUBIC)

    # 右上角叠加拼图块参考（半透明）
    if args.front and os.path.exists(args.front):
        fr = cv2.imread(args.front, cv2.IMREAD_UNCHANGED)
        if fr is not None:
            fh, fw = fr.shape[:2]
            nh = int(H * scale * 0.62)
            nw = max(1, int(fw * nh / fh))
            fr_r = cv2.resize(fr, (nw, nh), interpolation=cv2.INTER_AREA)
            if fr_r.ndim == 3 and fr_r.shape[2] == 4:
                alpha = fr_r[:, :, 3:4] / 255.0
                rgb = fr_r[:, :, :3]
                pad = 10
                x0 = disp.shape[1] - nw - pad
                y0 = pad
                roi = disp[y0:y0 + nh, x0:x0 + nw]
                disp[y0:y0 + nh, x0:x0 + nw] = (roi * (1 - alpha) + rgb * alpha).astype('uint8')
                cv2.rectangle(disp, (x0 - 2, y0 - 2), (x0 + nw + 2, y0 + nh + 2), (0, 0, 0), 1)

    state = {'x': None, 'done': False}
    win = 'Click gap LEFT edge (click to confirm, ESC cancel)'
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)
    cv2.resizeWindow(win, W * scale, H * scale)
    cv2.imshow(win, disp)

    def on_mouse(e, x, y, flags, p):
        if e == cv2.EVENT_LBUTTONDOWN:
            state['x'] = round(x / scale)
            state['done'] = True
            d2 = disp.copy()
            cv2.line(d2, (x, 0), (x, d2.shape[0]), (0, 0, 255), 2)
            cv2.putText(d2, f'x={state["x"]}', (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
            cv2.imshow(win, d2)
            cv2.waitKey(30)

    cv2.setMouseCallback(win, on_mouse)
    while not state['done']:
        k = cv2.waitKey(50) & 0xFF
        if k == 27:
            break
    cv2.destroyAllWindows()

    if state['x'] is None:
        print("NO_CLICK")
        return 1
    print(state['x'])
    return 0


if __name__ == '__main__':
    sys.exit(main())
