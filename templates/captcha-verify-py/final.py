"""
final.py — 验证码逆向交付物【单一入口】（load → solve → verify 三段链路，Python 版）。

与 captcha-verify/final.js（Node 版）的区别：
  - Node 版 solver.js 调 ddddocr 需跨语言桥接（child_process/HTTP）
  - Python 版 solver.py 直接 import ddddocr，答案层工具链（ddddocr/OpenCV/Whisper）原生可用
  - 两版 config.json 字段一致，可共用；answer JSON 契约一致

双重角色：
  - 自验：   python final.py            → 完整走 load→solve→verify→业务接口，交叉验证 5 次
  - 库调用： from final import solve_captcha, verify_chain  → 只取 API，不自动执行

含 __main__ 守卫。硬编码纪律（红线）：不含浏览器自动化代码；challenge 每次重新 load，不复用。

使用方式：
  python final.py                       # 默认：完整链路发真实请求，交叉验证 5 次
  python final.py --verify 5            # 指定验证次数
  python final.py --sign-only           # 仅输出 verify 参数（w 等），不发真实请求
  python final.py --cookie "name=value" # 注入用户 cookie（业务接口需要登录态时）

answer JSON 契约见 references/captcha/captcha-overview.md；
坐标来源判定见 references/captcha/gap-coordinate-source.md；
成功基线/失败复盘见 scripts/check_success_baseline.js + check_verification_attempts.js。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import random

# ============================================================
# 依赖（由用户从 templates 复制到 result/src/ 后填充）
# ============================================================
# 请求客户端：从 templates/python-request/client.py 复制到 result/src/request/client.py
try:
    from src.request.client import create_request_session
except ImportError:
    create_request_session = None

# 真实平台协议适配器：必须由本 case 根据 trace/抓包实现。
try:
    from src.adapter import (
        load_challenge as adapter_load_challenge,
        resolve_assets as adapter_resolve_assets,
        prepare_answer as adapter_prepare_answer,
        build_verify_request as adapter_build_verify_request,
        parse_verify_response as adapter_parse_verify_response,
        consume_credential as adapter_consume_credential,
    )
except ImportError:
    adapter_load_challenge = adapter_resolve_assets = adapter_prepare_answer = None
    adapter_build_verify_request = adapter_parse_verify_response = adapter_consume_credential = None

# 答案求解器：ddddocr / OpenCV / 打码平台适配器，需导出 solve(image_bytes, captcha_type, options) → answer dict
try:
    from src.solver import solve
except ImportError:
    solve = None

# ============================================================
# 配置（provider-neutral；真实接口属于 case adapter）
# ============================================================
def load_config() -> dict:
    cfg = {}
    try:
        here = os.path.dirname(os.path.abspath(__file__))
        with open(os.path.join(here, "config.json"), encoding="utf-8") as f:
            cfg = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    defaults = {
        "target": {"page_url": "<本 case 目标页>"},
        "captcha": {
            "provider": "<由本 case 证据确定>",
            "captcha_type": "<由本 case 证据确定>",
        },
        "solver": {
            "mode": "<case-defined>",
            "platform": "",
            "api_key": "",
        },
        "verify_count": 5,
    }
    # 浅合并顶层键，嵌套 dict 用 defaults 兜底
    for key, val in defaults.items():
        if key not in cfg:
            cfg[key] = val
        elif isinstance(val, dict) and isinstance(cfg[key], dict):
            for sub_key, sub_val in val.items():
                cfg[key].setdefault(sub_key, sub_val)
    return cfg


# ============================================================
# 三段链路：load → solve → verify
# ============================================================

def load_challenge(session: object, config: dict) -> dict:
    """① bootstrap/load 阶段：完全交给 case adapter。"""
    require_adapter()
    return adapter_load_challenge(session, config)


def solve_captcha(session: object, config: dict, load_result: dict) -> dict:
    """② solve 阶段：下载素材 → 本地求解/打码 → answer JSON。"""
    if solve is None:
        raise RuntimeError("未配置 solver，请实现 result/src/solver.py")
    require_adapter()

    assets = adapter_resolve_assets(session, config, load_result)

    answer = solve(assets["primary"], config["captcha"]["captcha_type"], {
        **assets,
        "provider": config["captcha"]["provider"],
    })
    return adapter_prepare_answer(answer, session=session, config=config,
                          load_result=load_result, assets=assets)


def verify_chain(session: object, config: dict, load_result: dict, answer: dict) -> dict:
    """③ verify 阶段：加密 answer+track → 提交 → 换取通过凭据。"""
    require_adapter()
    request = adapter_build_verify_request(session=session, config=config,
                                   load_result=load_result, answer=answer)
    if not isinstance(request, dict) or not request.get("method") or not request.get("url"):
        raise ValueError("adapter.build_verify_request 必须返回 {method, url, opts}")
    opts = request.get("opts") or {}
    res = session.request(request["method"], request["url"], **opts)
    return adapter_parse_verify_response(res, session=session, config=config,
                                 load_result=load_result, answer=answer,
                                 request=request)


def call_business_api(session: object, config: dict, credential: dict) -> dict:
    """④ 业务接口消费凭据，由 case adapter 决定请求和成功判定。"""
    require_adapter()
    return adapter_consume_credential(session, config, credential)


# ============================================================
# 主流程：完整链路 + 交叉验证
# ============================================================
def run_once(config: dict, cookie_str: str = "") -> dict:
    require_adapter()
    headers = {"Cookie": cookie_str} if cookie_str else {}
    session = create_request_session(headers=headers)
    try:
        load_result = load_challenge(session, config)
        answer = solve_captcha(session, config, load_result)
        credential = verify_chain(session, config, load_result, answer)
        biz_result = call_business_api(session, config, credential)
        return {"answer": answer, "credential": credential, "biz_result": biz_result}
    finally:
        session.close()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="验证码逆向交付物自验入口（Python）")
    parser.add_argument("--verify", type=int, default=5, help="交叉验证次数（默认 5）")
    parser.add_argument("--sign-only", action="store_true", help="仅输出 verify 参数，不发真实请求")
    parser.add_argument("--cookie", default="", help="注入用户 cookie")
    args = parser.parse_args(argv)

    config = load_config()
    verify_count = args.verify or config.get("verify_count", 5)

    require_adapter()
    print(f"[captcha-verify-py] provider={config['captcha']['provider']} "
          f"type={config['captcha']['captcha_type']} verify={verify_count}")

    if args.sign_only:
        session = create_request_session()
        try:
            load_result = load_challenge(session, config)
            answer = solve_captcha(session, config, load_result)
            request = adapter_build_verify_request(session=session, config=config,
                                                   load_result=load_result, answer=answer)
            print(json.dumps({"load": load_result, "answer": answer, "verify_request": request},
                             ensure_ascii=False, indent=2))
        finally:
            session.close()
        return 0

    success = 0
    for i in range(verify_count):
        try:
            result = run_once(config, args.cookie)
            success += 1
            biz_str = json.dumps(result["biz_result"], ensure_ascii=False)[:100]
            print(f"  [{i + 1}/{verify_count}] OK  biz={biz_str}")
        except Exception as e:
            print(f"  [{i + 1}/{verify_count}] FAIL  {e}")
        if i < verify_count - 1:
            time.sleep(1.0 + random.random() * 2.0)

    print(f"[captcha-verify-py] 完成 {success}/{verify_count}")
    # 要求全部成功才算通过（与 README ≥5 次交叉验证一致）
    return 0 if success == verify_count else 1


def require_adapter() -> None:
    required = {
        "load_challenge": adapter_load_challenge,
        "resolve_assets": adapter_resolve_assets,
        "prepare_answer": adapter_prepare_answer,
        "build_verify_request": adapter_build_verify_request,
        "parse_verify_response": adapter_parse_verify_response,
        "consume_credential": adapter_consume_credential,
    }
    missing = [name for name, fn in required.items() if not callable(fn)]
    if missing:
        raise RuntimeError("缺少 result/src/adapter.py 或方法：" + ", ".join(missing))


if __name__ == "__main__":
    sys.exit(main())
