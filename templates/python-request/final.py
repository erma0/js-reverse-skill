"""
final.py — JS 逆向交付物【单一入口】（Python 轻量：自验 + 可被 import 调用）

双重角色：
  - 自验：   python final.py            → 补环境(可选) → 生成加密参数 → 用 TLS 客户端发真实请求 → 输出结果 → 销毁 session
  - 库调用： from final import sign, build_signed_request  → 只取 API，不自动执行、不发请求

含 __main__ 守卫：被其他项目 import 时只导出 API，不会自动跑主流程、不会发请求。

硬编码纪律（红线）：本文件不含任何 ruyiPage / RuyiTrace / Playwright / 浏览器自动化代码；
所有加密参数均由补环境后的 signer 动态生成，不硬编码样本 sign/token 值。

使用方式：
  python final.py                       # 默认：发真实 API 请求，交叉验证 5 次
  python final.py --verify 5            # 指定验证次数
  python final.py --sign-only           # 仅输出签名，不发真实请求（需用户明确指定）
  python final.py --cookie "name=value" # 注入用户 cookie（覆盖设备 cookie 同名项）

成功语义（自验）：HTTP 200 ≠ 成功。必须在 config.json 配置 responseValidation
（jsonPath / minLength / contains，从本 case 真实成功样本提取）才能判「通过」；
未配置时所有 200 响应一律记为「未判定」，整体不能宣称通过。
退出码：0=全部通过；1=入口异常；2=存在失败；3=存在未判定（缺 responseValidation）。

并发注意：signer 通常持有 vm context / WASM 实例 / Cookie 状态，非无状态。
高并发场景需调用方自行池化 signer 实例（多个独立 vm context），不要跨线程/进程共享同一 signer。
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from urllib.parse import urlencode

# ============================================================
# 依赖（由用户从 templates 复制到 result/src/ 后填充）
# ============================================================
# 签名生成：用户自行实现（参考 cases/ 同类案例），需导出 generate_sign + build_params
try:
    from src.signer import generate_sign, build_params
except ImportError:
    generate_sign = None
    build_params = None

# 补环境：可选。Node 侧有 vm-sandbox；Python 侧通常不需要，或用户用 execjs 桥接。
# 若提供 result/src/env/install_env.py 并导出 install_env(env_cfg) 即可启用。
try:
    from src.env.install_env import install_env
except ImportError:
    install_env = None

# 请求客户端：从 templates/python-request/client.py 复制到 result/src/request/client.py
try:
    from src.request.client import create_request_session, CookieJar
except ImportError:
    create_request_session = None
    CookieJar = None

# 指纹 fixture：用户从浏览器采集真实值写入 result/src/env/fixtures/__init__.py（可选）
try:
    from src.env.fixtures import FIXTURES
except ImportError:
    FIXTURES = {}

# 动态资源刷新模块（可选）：复制到 result/src/resources/fetch_runtime_resources.py
try:
    from src.resources.fetch_runtime_resources import fetch_runtime_resources
except ImportError:
    fetch_runtime_resources = None


# ============================================================
# 配置（静态外置 config.json + 内置默认，不做环境变量覆盖）
# 注意：字段名与 Node final.js 的 config.json 完全一致（含历史拼写），
#       以便同一份 config.json 在 Node / Python 两版交付物间共用。
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
        "TARGET_URL": "",
        "HOME_URL": "",
        "INIT_URL": "",
        "METHOD": "GET",
        "USER_AGENT": "",
        "IMPERSONATE": "chrome135",
        "SIGN_PARAM_NAME": "sign",
        "DEVICE_COOKIE": "",
        "extraHeaders": {},
        # 响应校验规则：从本 case 真实成功样本提取。未配置时 HTTP 200 只记「未判定」，拒绝宣称通过
        "responseValidation": None,
    }
    merged = dict(defaults)
    merged.update(cfg)
    return merged

CONFIG = load_config()


# ============================================================
# 补环境对象缓存（进程内复用，避免每次 sign 都重建 vm 上下文）
# ============================================================
_env_cache = None

def get_env(opts: dict | None = None) -> object | None:
    global _env_cache
    if _env_cache is not None:
        return _env_cache
    if install_env is None:
        return None
    config = (opts or {}).get("config", CONFIG)
    _env_cache = install_env({
        "fixtures": FIXTURES,
        "userAgent": config["USER_AGENT"],
        "cookie": merge_cookie(config["DEVICE_COOKIE"], (opts or {}).get("userCookie", "")),
    })
    return _env_cache


def merge_cookie(device_cookie: str, user_cookie: str) -> str:
    """合并 Cookie（用户 cookie 优先同名项）。"""
    def set_pair(store, pair):
        if "=" not in pair:
            return
        k, _, v = pair.partition("=")
        k, v = k.strip(), v.strip()
        if k:
            store[k] = v
    merged: dict[str, str] = {}
    for pair in (device_cookie or "").split(";"):
        pair = pair.strip()
        if pair:
            set_pair(merged, pair)
    for pair in (user_cookie or "").split(";"):
        pair = pair.strip()
        if pair:
            set_pair(merged, pair)
    return "; ".join(f"{k}={v}" for k, v in merged.items())


# ============================================================
# 可复用 API（被 import 时导出；本身不发请求）
# ============================================================
def sign(raw_params: dict | None = None, opts: dict | None = None) -> dict:
    """
    生成加密参数。只计算、不发任何网络请求。
    @returns: { "params": dict, "signature": str, "env": object|None }
    """
    if generate_sign is None or build_params is None:
        raise RuntimeError("未找到 src/signer.py（需导出 generate_sign + build_params）")
    opts = opts or {}
    config = opts.get("config", CONFIG)
    env = get_env(opts)
    base_params = build_params(config) if callable(build_params) else {}
    params = dict(base_params)
    params.update(raw_params or {})
    signature = generate_sign(params, env)
    return {"params": params, "signature": signature, "env": env}


def build_signed_request(opts: dict | None = None) -> dict:
    """
    在 sign() 基础上组装出「待发送」请求描述符（仍不发请求）。
    @returns: { "method", "url", "headers", "params", "signature" }
    """
    opts = opts or {}
    config = opts.get("config", CONFIG)
    result = sign(opts.get("rawParams"), opts)
    params, signature = result["params"], result["signature"]
    sign_name = config["SIGN_PARAM_NAME"]

    # 组装 query：sign 参数 + 其余业务参数
    query: dict[str, str] = {}
    for k, v in params.items():
        if k == sign_name:
            continue
        query[k] = str(v)
    query[sign_name] = signature

    base = config["TARGET_URL"].split("?")[0]
    url = base + ("?" + urlencode(query) if query else "")

    # 与 Node final.js 一致：extraHeaders 可覆盖默认 UA
    headers: dict[str, str] = {}
    headers.update(config.get("extraHeaders") or {})
    headers.update(opts.get("extraHeaders") or {})
    if config.get("USER_AGENT"):
        headers.setdefault("User-Agent", config["USER_AGENT"])

    return {
        "method": config["METHOD"],
        "url": url,
        "headers": headers,
        "params": {**params, sign_name: signature},
        "signature": signature,
    }


def create_client(opts: dict | None = None) -> object:
    """创建 TLS 指纹兼容 Session（与自验主流程共用）。"""
    if create_request_session is None:
        raise RuntimeError("未找到 src/request/client.py")
    opts = opts or {}
    config = opts.get("config", CONFIG)
    return create_request_session(
        impersonate=config["IMPERSONATE"],
        user_agent=config.get("USER_AGENT") or None,
        **(opts.get("client") or {}),
    )


# ============================================================
# 响应判定 + 验证记录（与 Node final.js 语义对齐）
# ============================================================
def judge_response_body(body: str, rule: dict | None) -> dict:
    """
    校验响应体是否符合预期业务数据（三态判定）。

    @returns: { "judgment": "pass"|"fail"|"unverified", "reason": str }
      - pass:       规则全部命中，可计为成功
      - fail:       规则命中失败或响应体为空
      - unverified: 未配置 responseValidation —— HTTP 200 不能证明业务成功
    """
    if not body:
        return {"judgment": "fail", "reason": "响应体为空"}
    if not isinstance(rule, dict):
        return {
            "judgment": "unverified",
            "reason": "未配置 responseValidation：HTTP 200 不能证明业务成功，请从真实成功样本提取响应判定规则写入 config.json",
        }

    contains = rule.get("contains")
    if isinstance(contains, str) and contains and contains not in body:
        return {"judgment": "fail", "reason": f"响应体未包含期望字符串 \"{contains}\""}

    json_path = rule.get("jsonPath")
    if isinstance(json_path, str) and json_path:
        try:
            cur: object = json.loads(body)
        except json.JSONDecodeError as e:
            return {"judgment": "fail", "reason": f"响应体非 JSON：{e}"}
        for seg in json_path.split("."):
            if not isinstance(cur, dict) or seg not in cur:
                cur = None
                break
            cur = cur[seg]
        if cur is None:
            return {"judgment": "fail", "reason": f"jsonPath \"{json_path}\" 未命中"}
        min_length = rule.get("minLength")
        if isinstance(min_length, int):
            length = len(cur) if isinstance(cur, list) else len(str(cur))
            if length < min_length:
                return {"judgment": "fail", "reason": f"jsonPath \"{json_path}\" 长度 {length} < minLength {min_length}"}

    return {"judgment": "pass", "reason": ""}


def _write_validation_record(record: dict) -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "验证记录.json"), "w", encoding="utf-8") as f:
        json.dump(record, f, ensure_ascii=False, indent=2)
        f.write("\n")


# ============================================================
# 主流程（仅自验时运行）
# ============================================================
def _parse_args(argv=None):
    parser = argparse.ArgumentParser(description="JS 逆向交付物自验入口")
    parser.add_argument("--verify", type=int, default=5, help="交叉验证次数（默认 5）")
    parser.add_argument("--sign-only", action="store_true", help="仅输出签名，不发真实请求")
    parser.add_argument("--cookie", default="", help="注入用户 cookie（覆盖设备 cookie 同名项）")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = _parse_args(argv)

    print("=== JS 逆向 final.py 启动（自验入口）===")
    print(f"目标 API: {CONFIG['TARGET_URL']}")
    print(f"UA: {CONFIG['USER_AGENT'] or '(未配置)'}")
    print(f"TLS 客户端: {CONFIG['IMPERSONATE']}")
    print(f"验证次数: {args.verify}")
    print(f"发送真实请求: {'否（--sign-only）' if args.sign_only else '是（默认）'}")

    # ----- 仅输出签名模式（需用户明确指定 --sign-only）-----
    if args.sign_only:
        print("\n--- 仅输出签名（--sign-only，不发真实请求）---")
        for i in range(args.verify):
            out = sign({}, {"userCookie": args.cookie})
            print(f"[第 {i + 1} 次] sign={out['signature']} params={json.dumps(out['params'], ensure_ascii=False)}")
        return 0

    # ----- 创建请求 Session -----
    session = create_client()
    jar = CookieJar() if CookieJar else None
    # Cookie 生命周期交给请求层：每次请求自动携带 jar、响应后自动合并 Set-Cookie、过期自动清理
    if jar and hasattr(session, "defaults"):
        session.defaults(jar=jar)

    try:
        # ----- 动态资源刷新（可选）-----
        if callable(fetch_runtime_resources):
            print("\n--- 刷新动态资源 ---")
            fetch_runtime_resources(session, jar, {
                "home_url": CONFIG["HOME_URL"],
                "init_url": CONFIG["INIT_URL"],
            })
            print(f"动态资源刷新完成: cookie 数 {len(jar) if jar else 0}")

        # ----- 交叉验证 -----
        print(f"\n--- 交叉验证 {args.verify} 次 ---")
        success = fail = unverified = 0
        attempts: list[dict] = []
        for i in range(args.verify):
            attempt: dict = {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "httpStatus": 0,
                "parameterSummary": "参数生成失败",
                "sessionStage": "target-api",
                "judgment": "error",
                "responseValid": False,
            }
            try:
                req = build_signed_request({"userCookie": args.cookie})
                attempt["parameterSummary"] = {
                    "names": sorted(req["params"].keys()),
                    "count": len(req["params"]),
                }
                print(f"\n[第 {i + 1} 次请求]")
                print(f"  URL: {req['url']}")
                print(f"  sign: {req['signature']}")
                cookie_str = jar.to_string() if jar else ""
                print(f"  cookie: {cookie_str[:80]}...")

                res = session.request(req["method"], req["url"], headers=req["headers"])

                text = res.text() if hasattr(res, "text") else ""
                status = getattr(res, "status_code", 0)
                attempt["httpStatus"] = status
                print(f"  状态码: {status}")
                print(f"  响应: {text[:200]}")

                if status != 200:
                    fail += 1
                    attempt["judgment"] = "fail"
                    print("  [WARN] 状态码非 200")
                else:
                    # 业务数据判定：未配置 responseValidation 时记「未判定」，不能计为成功
                    check = judge_response_body(text, CONFIG.get("responseValidation"))
                    attempt["judgment"] = check["judgment"]
                    attempt["responseValid"] = check["judgment"] == "pass"
                    if check["judgment"] == "pass":
                        success += 1
                    elif check["judgment"] == "unverified":
                        unverified += 1
                        print(f"  [UNVERIFIED] {check['reason']}")
                    else:
                        fail += 1
                        print(f"  [WARN] 业务数据校验失败：{check['reason']}")
            except Exception as e:
                fail += 1
                attempt["judgment"] = "error"
                print(f"  [FAIL] 异常: {e}")
            attempts.append(attempt)

            if i < args.verify - 1:
                time.sleep(1.0 + random.random() * 2.0)

        print("\n=== 验证结果 ===")
        print(f"通过: {success} / {args.verify}")
        print(f"失败: {fail} / {args.verify}")
        if unverified:
            print(f"未判定: {unverified} / {args.verify}（未配置 responseValidation，拒绝宣称通过）")
        _write_validation_record({
            "mode": "real-request",
            "responseValidation": CONFIG.get("responseValidation"),
            "summary": {"total": args.verify, "pass": success, "fail": fail, "unverified": unverified},
            "attempts": attempts,
        })
        if fail > 0:
            return 2
        if unverified > 0:
            return 3
        return 0
    finally:
        if hasattr(session, "close"):
            session.close()
            print("Session 已关闭")


# ============================================================
# 启动（__main__ 守卫：被 import 时不自动执行）
# ============================================================
if __name__ == "__main__":
    sys.exit(main())
