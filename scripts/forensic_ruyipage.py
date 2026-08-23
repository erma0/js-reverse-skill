#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ruyiPage 通用取证脚本

目标：消除"每个 case 手写 ruyiPage 取证脚本"的重复劳动与 API 踩坑。
任何 ruyiPage 取证都应优先运行本脚本，而不是从示例片段重新拼装。

严格遵循 references/tooling/ruyi-tooling.md 的"ruyiPage 启动硬约束"：
  - 必须显式使用已验证的 ruyiPage 定制 Firefox（禁止系统 Firefox 回退）
  - 有头模式（无 --headless 选项，本身就是硬约束）
  - 独立 case 专用 profile
  - smart_fingerprint + apply_emulation
  - page.capture.start(...) 必须在 page.get(...) 之前执行
  - 导航后自检 navigator.webdriver === false
  - 抓所有包（targets=True），事后从 steps 过滤，避免漏掉 JS 文件

正确 API（基于 ruyipage >=1.2.45 内省确认，151/155 runtime 均适用，含 v1.2.57+/v1.2.62）：
  - page.capture.start(targets=True, collect_bodies=True)  # True=抓全部
  - page.capture.wait(timeout=, count=1)  -> 单个 CapturePacket 或 None
  - page.capture.steps                     -> list[CapturePacket]（全部包）
  - CapturePacket.to_dict(include_bodies=True) -> url/method/headers/status/bodies
  - opts.smart_fingerprint(...) -> FingerprintContext；ctx.apply_emulation(page)

Firefox 155+ 兼容：
  - ruyipage >=1.2.62 已原生内置：capture.start 订阅上下文失败自动降级全局；
    smart_fingerprint 默认带脚本可访问的 about:blank 启动页，提权窗口下
    allow_system_access 按需自动开启。旧版本（<1.2.62）依靠下方补丁：
      * 启动参数补 --remote-allow-system-access：管理员/提权 Windows 会话下
        Firefox 默认拒绝浏览器外的远程调试连接，缺参表现为"启动后连不上 BiDi"；
      * capture 订阅降级：1.2.45 自带、1.2.61 回退，由 _apply_ruyipage_capture_compat_patch 兜底。
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import inspect
import json
import logging
import os
import re
import signal
import subprocess
import sys
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

def configure_utf8_stdio() -> None:
    """Windows GBK 控制台下输出含 [警告]/[通过] 等非 GBK 字符会抛 UnicodeEncodeError 且退出 1。
    与仓库其他 Python 脚本一致：stdout/stderr 强制 UTF-8，errors=replace 兜底避免任何编码异常
    把整段输出吞掉。必须在 logging.basicConfig 之前调用，保证 handler 捕获到的就是 UTF-8 流。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            if hasattr(stream, "reconfigure"):
                stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


configure_utf8_stdio()

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("forensic_ruyipage")


# ============================================================
# 检测：ruyipage 包 + 定制 Firefox
# ============================================================
def detect_ruyipage() -> Tuple[bool, str, str]:
    try:
        import ruyipage  # noqa: F401
        version = getattr(ruyipage, "__version__", "?")
        return True, version, ""
    except Exception as e:  # pragma: no cover
        return False, "", str(e)


def is_ruyi_custom_firefox(path: str) -> bool:
    """判断 Firefox 路径是否来自 ruyiPage 定制 runtime（禁止系统 Firefox 回退）。

    兼容三代命名：151-ruyi（含 ruyi）/ 151-proxy、155-proxy（版本前缀）/
    v1.2.57 语义化 tag + firefox-155.0a1... 定制 asset（新版）。
    install.json 在 runtime 根目录（firefox.exe 的上级或更上），向上多级查找。
    """
    if not path:
        return False
    low = path.lower().replace("\\", "/")
    if "ruyi" in low:
        return True
    cur = os.path.dirname(os.path.abspath(path))
    for _ in range(8):
        marker = os.path.join(cur, "install.json")
        if os.path.isfile(marker):
            try:
                with open(marker, "r", encoding="utf-8") as f:
                    data = json.load(f)
                release = str(data.get("release", "") or data.get("tag", ""))
                asset = str(data.get("asset", ""))
                url = str(data.get("url", ""))
                text = " ".join([release, asset, url, os.path.basename(cur)]).lower()
                if "ruyi" in text:
                    return True
                if re.match(r"^1\d{2,}-", release):
                    return True
                if re.match(r"^v?\d+\.\d+(\.\d+)?$", release) and re.search(r"firefox-\d+\.0a1", asset, re.I):
                    return True
                if "github.com/losenine/ruyipage" in url.lower():
                    return True
            except Exception:
                pass
            return False
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return False


def resolve_browser(args: argparse.Namespace) -> Tuple[str, str]:
    """返回 (browser_path, error)。显式路径优先；否则强制 managed runtime（禁系统回退）。"""
    if args.browser_path:
        p = os.path.abspath(os.path.expanduser(args.browser_path))
        if not os.path.isfile(p):
            return "", f"--browser-path 不存在：{p}"
        if not is_ruyi_custom_firefox(p):
            return "", (
                f"提供的 Firefox 不是 ruyiPage 定制内核（路径/install.json 无 ruyi 标识）：{p}\n"
                "ruyiPage 取证禁止回退系统 Firefox；请提供定制 Firefox 路径，"
                "或先 `python -m ruyipage install`。"
            )
        return p, ""

    try:
        import ruyipage
        resolved = ruyipage.resolve_firefox_path(allow_system=False)
    except Exception as e:
        return "", f"resolve_firefox_path(allow_system=False) 失败：{e}"
    if not resolved:
        # 兜底：扫描工程 tools/ruyipage-browsers/ 下的 managed runtime（与 check_external_tools.js 同一来源），
        # 避免"检测已装好、取证脚本却不认"的不一致。安装模式下 skill 安装目录无 tools/，
        # 按 --project-dir / --case-dir 上级 / cwd 上级逐层查找真实工程目录。
        resolved = _find_managed_runtime(args.project_dir, args.case_dir)
    if not resolved:
        return "", "未能解析到 ruyiPage 定制 Firefox（已禁用系统回退）。请传 --browser-path 或先安装 runtime。"
    if not is_ruyi_custom_firefox(resolved):
        return "", f"解析到的 Firefox 非定制内核：{resolved}"
    return os.path.abspath(resolved), ""


def find_project_root() -> str:
    """向上查找项目根（含 SKILL.md 的目录）；找不到时回退当前工作目录。"""
    cur = os.path.dirname(os.path.abspath(__file__))
    for _ in range(5):
        if os.path.isfile(os.path.join(cur, "SKILL.md")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return os.getcwd()


def _resolve_exe_from_install_json(runtime_dir: str) -> Optional[str]:
    """读 managed runtime 根目录 install.json 的 executable 字段，解析出 Firefox 可执行文件路径。"""
    marker = os.path.join(runtime_dir, "install.json")
    if not os.path.isfile(marker):
        return None
    try:
        with open(marker, "r", encoding="utf-8") as f:
            data = json.load(f)
        exe_rel = str(data.get("executable") or "")
        if not exe_rel:
            return None
        p = os.path.abspath(os.path.join(runtime_dir, exe_rel))
        return p if os.path.isfile(p) else None
    except Exception:
        return None


def _tools_browsers_candidates_under(start: str, levels: int = 5) -> List[str]:
    """从 start 起（含自身）向上 levels 层，收集每层 <dir>/tools/ruyipage-browsers（去重）。
    多 case 项目布局 <project-root>/<case-name>/ 与 <project-root>/tools/ 平级，逐层向上查找。"""
    out: List[str] = []
    cur = os.path.abspath(start or os.getcwd())
    for _ in range(levels + 1):
        d = os.path.join(cur, "tools", "ruyipage-browsers")
        if d not in out:
            out.append(d)
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    return out


def _managed_runtime_candidates(project_dir: str = "", case_dir: str = "") -> List[str]:
    """managed runtime 候选目录列表，与 check_external_tools.js getDefaultRuyiBrowsersDirs 对齐：
    显式 --project-dir/tools → --case-dir 及其上级/tools → RUYIPAGE_BROWSERS_PATH →
    cwd 及其上级/tools → find_project_root()/tools → 平台缓存目录。"""
    candidates: List[str] = []
    for base in (project_dir, case_dir):
        if base:
            candidates.extend(_tools_browsers_candidates_under(base))
    env = os.environ.get("RUYIPAGE_BROWSERS_PATH", "")
    if env:
        candidates.append(os.path.abspath(os.path.expanduser(env)))
    candidates.extend(_tools_browsers_candidates_under(os.getcwd()))
    candidates.append(os.path.join(find_project_root(), "tools", "ruyipage-browsers"))
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
        candidates.append(os.path.join(base, "ruyipage", "browsers"))
    elif sys.platform == "darwin":
        candidates.append(os.path.join(os.path.expanduser("~"), "Library", "Caches", "ruyipage", "browsers"))
    else:
        base = os.environ.get("XDG_CACHE_HOME") or os.path.join(os.path.expanduser("~"), ".cache")
        candidates.append(os.path.join(base, "ruyipage", "browsers"))
    seen: set = set()
    return [d for d in candidates if not (d in seen or seen.add(d))]


def _find_managed_runtime(project_dir: str = "", case_dir: str = "") -> Optional[str]:
    """扫描候选 tools/ruyipage-browsers/ 下的 managed runtime，返回 Firefox 主版本号最高的定制内核路径。

    安装模式下 skill 安装目录无 tools/（gitignore 不随分发），find_project_root() 定位到的是
    skill 根而非用户工程；因此必须扫描 --project-dir / --case-dir 上级 / cwd 上级等真实工程目录。
    """
    for tools_dir in _managed_runtime_candidates(project_dir, case_dir):
        if not os.path.isdir(tools_dir):
            continue
        candidates = []
        for entry in os.listdir(tools_dir):
            d = os.path.join(tools_dir, entry)
            if not os.path.isdir(d):
                continue
            exe = _resolve_exe_from_install_json(d)
            if exe and is_ruyi_custom_firefox(exe):
                candidates.append((entry, exe))
        if not candidates:
            continue

        def rank(item) -> int:
            m = re.search(r"firefox[-_]?(\d+)(?:\.\d+)*", item[0], re.I)
            return int(m.group(1)) if m else 0
        return max(candidates, key=rank)[1]
    return None


# ============================================================
# 指纹
# ============================================================
def _parse_proxy(value: str, auth: str) -> Dict[str, Any]:
    """解析 --proxy host:port 与 --proxy-auth user:pass，返回 smart_fingerprint 的 proxy 关键字参数。

    国内站点默认直连（不传 --proxy）；仅当目标站需要固定出口 IP / 国家匹配时使用。
    代理账号密码只透传给 smart_fingerprint 写进 fpfile，不写入业务脚本或最终交付物。
    """
    kwargs: Dict[str, Any] = {}
    if not value:
        return kwargs
    host, _, port = value.rpartition(":")
    if not host or not port.isdigit():
        raise ValueError(f"--proxy 格式应为 host:port（如 1.2.3.4:8080），实际：{value}")
    kwargs["proxy_host"] = host
    kwargs["proxy_port"] = int(port)
    if auth:
        user, _, pwd = auth.partition(":")
        kwargs["proxy_user"] = user
        kwargs["proxy_pwd"] = pwd
    return kwargs


def apply_smart_fingerprint(opts, args: argparse.Namespace):
    """返回 FingerprintContext 或 None（--no-fp 时）。地理探测失败且无 manual_geo 时抛错。"""
    if args.no_fp:
        logger.info("已禁用 smart_fingerprint（--no-fp）。")
        return None

    kwargs: Dict[str, Any] = {
        "userdir": args.profile_dir,
        "base_dir": args.fp_dir,
        # 默认禁用国家强校验：1.2.6x 起 smart_fingerprint 默认 require_country="US"，
        # 代理/出口 IP 与 US 不一致（如 JP）会抛 CountryMismatchError，阻断取证。
        # 用户显式 --require-country 时用用户值；否则 None = 不校验出口国家。
        "require_country": args.require_country or None,
    }
    if args.manual_geo:
        kwargs["manual_geo"] = load_manual_geo(args.manual_geo)
    if args.proxy:
        kwargs.update(_parse_proxy(args.proxy, args.proxy_auth))

    try:
        return opts.smart_fingerprint(**kwargs)
    except Exception as e:
        msg = str(e)
        if ("geo" in msg.lower() or "country" in msg.lower()) and not args.manual_geo:
            raise RuntimeError(
                "smart_fingerprint 地理探测失败且未提供 manual_geo。\n"
                f"原始错误：{msg}\n"
                "解决：安装 requests（`python -m pip install requests`），"
                "或用 --manual-geo <json或文件路径> 提供地理信息，不要静默跳过智能指纹。"
            )
        raise


def load_manual_geo(value: str) -> Any:
    if os.path.isfile(value):
        with open(value, "r", encoding="utf-8") as f:
            return json.load(f)
    try:
        return json.loads(value)
    except Exception:
        return value


# ============================================================
# JS / target / 关联请求过滤
# ============================================================
_JS_EXT_RE = re.compile(r"\.js(\?|#|$)", re.IGNORECASE)
_WASM_EXT_RE = re.compile(r"\.wasm(\?|#|$)", re.IGNORECASE)
_FLOW_URL_RE = re.compile(
    r"captcha|challenge|verify|validate|slider|jigsaw|risk|security|ticket|seccode|"
    r"geetest|tcaptcha|yidun|dun\.163|captcha_output|pass_token",
    re.IGNORECASE,
)
_DYNAMIC_CONTENT_TYPES = (
    "application/json",
    "application/graphql",
    "application/x-www-form-urlencoded",
    "application/octet-stream",
    "application/wasm",
    "text/json",
    "text/plain",
)


def is_js_packet(pkt: Dict[str, Any]) -> bool:
    url = (pkt.get("url") or "").split("?")[0].split("#")[0]
    if _JS_EXT_RE.search(url):
        return True
    ct = ""
    for k, v in (pkt.get("response_headers") or {}).items():
        if str(k).lower() == "content-type":
            ct = str(v or "")
            break
    return "javascript" in ct.lower() or "ecmascript" in ct.lower()


def match_targets(pkt: Dict[str, Any], substrings: List[str], regexes: List[re.Pattern]) -> bool:
    """目标接口只按 URL 匹配，避免 Referer/响应头中的字样冒充真实接口命中。"""
    if not substrings and not regexes:
        return True
    url = pkt.get("url", "") or ""
    for s in substrings:
        if s and s in url:
            return True
    for r in regexes:
        if r.search(url):
            return True
    return False


def _related_reason(pkt: Dict[str, Any]) -> Optional[str]:
    """返回前置动态请求的保留原因；None 表示不拉取 body。"""
    method = str(pkt.get("method") or "").upper()
    if method == "OPTIONS" or is_js_packet(pkt):
        return None
    url = str(pkt.get("url") or "")
    ct = _response_content_type(pkt)
    if _WASM_EXT_RE.search(url) or "application/wasm" in ct:
        return "wasm"
    if _FLOW_URL_RE.search(url):
        return "flow-url"
    if method in ("POST", "PUT", "PATCH", "DELETE"):
        return "write-request"
    if any(marker in ct for marker in _DYNAMIC_CONTENT_TYPES):
        return "dynamic-response"
    return None


def _is_related_packet(pkt: Dict[str, Any]) -> bool:
    """筛选值得保留 body 的前置动态请求，不对所有页面资源做昂贵的 BiDi body RPC。"""
    return _related_reason(pkt) is not None


def _select_related_indices(records_meta: List[Dict[str, Any]], target_indices: List[int], max_packets: int) -> List[int]:
    """从终态接口向前回溯动态请求，优先保留最接近最终业务提交的链路材料。"""
    if max_packets <= 0 or not records_meta:
        return []
    accepted_targets = [
        i for i in target_indices
        if str(records_meta[i].get("method") or "").upper() != "OPTIONS"
        and int(records_meta[i].get("response_status") or 0) // 100 == 2
    ]
    # 以最后一次已捕获的有效终态为回溯锚点。一次会话可能先提交失败、
    # 重新完成验证码后再次提交；取最早命中会漏掉后续验证码链。
    terminal_index = max(accepted_targets or target_indices) if target_indices else len(records_meta) - 1
    target_set = set(target_indices)
    candidates = [
        i for i in range(terminal_index + 1)
        if i not in target_set and _is_related_packet(records_meta[i])
    ]
    return sorted(candidates[-max_packets:])


def _safe_body(body: Any) -> bytes:
    if body is None:
        return b""
    if isinstance(body, bytes):
        return body
    if isinstance(body, str):
        return body.encode("utf-8", "replace")
    return json.dumps(body, ensure_ascii=False).encode("utf-8", "replace")


def _header_value(headers: Optional[dict], name: str) -> str:
    wanted = name.lower()
    for key, value in (headers or {}).items():
        if str(key).lower() == wanted:
            return str(value or "")
    return ""


def _maybe_decompress(body: bytes, headers: Optional[dict]) -> bytes:
    """按 Content-Encoding / 魔数尝试解压 gzip / br / deflate 响应体；解压失败原样返回。

    背景：ruyipage 的 BiDi collector 对 gzip/br 响应经常拿不到 body，replay fetch 兜底
    拿到的又是已解码文本；但个别版本/场景 body 会以压缩字节原样到达这里，直接 UTF-8 解码
    会得到乱码或空，落盘 JS 不可用。这里对字节做幂等解压，失败不改变原值。
    """
    if not body:
        return body
    ce = _header_value(headers, "content-encoding").lower().strip()
    try:
        if "gzip" in ce or body[:2] == b"\x1f\x8b":
            import gzip
            return gzip.decompress(body)
        if "br" in ce:
            try:
                import brotli
            except ImportError:
                return body
            return brotli.decompress(body)
        if "deflate" in ce or (body[:2] == b"\x78\x9c"):
            import zlib
            return zlib.decompress(body)
    except Exception:
        return body
    return body


def _body_to_text(body: bytes, headers: Optional[dict]) -> Tuple[str, bool, int]:
    """body 落盘为可读文本；二进制（octet-stream 或 UTF-8 严格解码失败）落 base64 并标记。

    返回 (text, is_binary, original_len)。is_binary=True 时 text 为 base64 编码，
    调用方应另存原始字节字段；is_binary=False 时 text 为 UTF-8 字符串。
    """
    if not body:
        return "", False, 0
    body = _maybe_decompress(body, headers)
    ct = _header_value(headers, "content-type").lower()
    if "application/octet-stream" in ct or "application/wasm" in ct:
        return base64.b64encode(body).decode("ascii"), True, len(body)
    try:
        return body.decode("utf-8"), False, len(body)
    except UnicodeDecodeError:
        return base64.b64encode(body).decode("ascii"), True, len(body)


def _is_wasm_body(url: str, headers: Optional[dict]) -> bool:
    return bool(_WASM_EXT_RE.search(url or "")) or "application/wasm" in _header_value(headers, "content-type").lower()


def _body_extension(url: str, headers: Optional[dict], is_wasm: bool) -> str:
    if is_wasm:
        return ".wasm"
    ct = _header_value(headers, "content-type").lower().split(";", 1)[0].strip()
    by_type = {
        "application/json": ".json",
        "application/graphql": ".json",
        "application/xml": ".xml",
        "text/xml": ".xml",
        "text/html": ".html",
        "text/plain": ".txt",
        "application/x-www-form-urlencoded": ".txt",
        "application/octet-stream": ".bin",
        "application/protobuf": ".bin",
        "application/x-protobuf": ".bin",
    }
    if ct in by_type:
        return by_type[ct]
    clean = (url or "").split("?", 1)[0].split("#", 1)[0]
    ext = os.path.splitext(clean)[1].lower()
    if ext and re.fullmatch(r"\.[a-z0-9]{1,8}", ext):
        return ext
    return ".bin"


def _body_file_path(out_dir: str, pkt: Dict[str, Any], direction: str,
                    capture_index: int, headers: Optional[dict], is_wasm: bool) -> str:
    url = str(pkt.get("url") or "")
    clean = url.split("?", 1)[0].split("#", 1)[0].rstrip("/")
    base = clean.rsplit("/", 1)[-1] or "body"
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)[:80] or "body"
    ext = _body_extension(url, headers, is_wasm)
    if base.lower().endswith(ext):
        base = base[:-len(ext)] or "body"
    digest = hashlib.sha1(f"{url}|{direction}|{capture_index}".encode("utf-8")).hexdigest()[:10]
    subdir = "wasm" if is_wasm else "bodies"
    return os.path.join(out_dir, subdir, f"{capture_index:06d}-{direction}-{base}.{digest}{ext}")


def sanitize_filename(url: str) -> str:
    base = url.split("?")[0].split("#")[0].rstrip("/").split("/")[-1]
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base) or "script"
    if not base.endswith(".js"):
        base += ".js"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:10]
    return f"{base}.{digest}"


def extract_sourcemap(body_bytes: bytes) -> Optional[str]:
    try:
        text = body_bytes.decode("utf-8", "replace")
    except Exception:
        return None
    m = re.search(r"//#\s*sourceMappingURL=([^\s]+)", text)
    return m.group(1) if m else None


def _eval_js(page, expr: str) -> Tuple[Any, Optional[str]]:
    try:
        r = page.run_js(expr)
    except Exception as e:
        return None, str(e)
    if isinstance(r, bool):
        return r, None
    if hasattr(r, "value"):
        return r.value, None
    if hasattr(r, "success"):
        return bool(r.success), None
    return r, None


def _trigger_actions(page, args: argparse.Namespace, human: str) -> None:
    if args.scroll:
        try:
            amt = int(args.scroll)
            # page.scroll 是 PageScroller 属性（非方法）；向下滚动 amt 像素
            page.scroll.down(amt)
            logger.info("已向下滚动 %s px", amt)
        except Exception as e:
            logger.warning("scroll 失败：%s", e)
    if args.click:
        try:
            ele = page.ele(args.click, timeout=10)
            act = page.actions
            if hasattr(act, "human_click"):
                act.human_click(ele, algorithm=human).perform()
            else:
                act.move_to(ele).click().perform()
            logger.info("已拟人点击 %s", args.click)
        except Exception as e:
            logger.warning("click %s 失败：%s", args.click, e)


# ============================================================
# 主流程
# ============================================================
def build_options(args: argparse.Namespace, browser_path: str):
    from ruyipage import FirefoxOptions

    opts = FirefoxOptions()
    opts.set_browser_path(browser_path)
    opts.set_user_dir(args.profile_dir)
    opts.headless(False)
    w, h = (args.window_size or "1366,900").split(",")[:2]
    opts.set_window_size(int(w), int(h))
    opts.set_human_algorithm(args.human_algorithm)
    # Firefox 155+（v1.2.57+ runtime）在管理员/提权 Windows 会话下，远程调试
    # 连接默认只允许浏览器自身，必须显式放行系统级连接，否则 BiDi 握手表现为
    # "浏览器启动了但连不上"。ruyipage <1.2.62 均未自动附加，由共享脚本补齐。
    # （1.2.62+ 该参数被 set_argument 自动转发到 allow_system_access()，等价。）
    try:
        opts.set_argument("--remote-allow-system-access")
    except Exception as e:
        logger.warning("set_argument(--remote-allow-system-access) 失败：%s", e)
    # 进程级兜底：Python 进程退出（含异常/被杀前未走 finally）时自动关闭浏览器并清理临时 profile
    try:
        opts.close_on_exit(True)
    except Exception as e:
        logger.warning("close_on_exit 设置失败（%s），依赖 finally 关闭", e)
    return opts


def _response_content_type(d: Dict[str, Any]) -> str:
    return _header_value(d.get("response_headers"), "content-type").lower()


def _is_entry_document(d: Dict[str, Any], args_url: str) -> bool:
    """识别入口页面 HTML：content-type 为 text/html，或 URL 与目标 URL 一致（覆盖 412/challenge 页）。

    acw_sc__v2 等 challenge cookie 的首次 412 响应是 text/html 内联脚本，必须保存，
    否则后续无法还原 challenge 链。"""
    if _response_content_type(d).startswith("text/html"):
        return True
    url = (d.get("url") or "").split("?")[0].split("#")[0].rstrip("/")
    target = (args_url or "").split("?")[0].split("#")[0].rstrip("/")
    return bool(url and target and url == target)


def _serialize_packet_bodies(
    d: Dict[str, Any],
    per_body_limit: int,
    total_budget: Optional[int] = None,
    *,
    inline_limit: Optional[int] = None,
    max_wasm_bytes: Optional[int] = None,
    out_dir: Optional[str] = None,
    capture_index: int = -1,
) -> Tuple[Dict[str, Any], int]:
    """保留完整 body 证据，JSON 仅内联小 body 或大 body 预览。

    返回 (序列化记录, 本次占用预算的原始字节数)。普通 body 超过 per_body_limit、
    WASM 超过 max_wasm_bytes、或剩余总预算不足时不会写入不可用的半包；JSON 中仅保留
    预览并显式标记 omitted_reason。完整二进制、大文本和所有 WASM 写入独立文件。
    """
    out = dict(d)
    inline_limit = max(0, min(
        inline_limit if inline_limit is not None else min(per_body_limit, 1024 * 1024),
        per_body_limit,
    ))
    max_wasm_bytes = max_wasm_bytes if max_wasm_bytes is not None else per_body_limit
    remaining = total_budget if total_budget is not None else max(per_body_limit, max_wasm_bytes) * 2
    saved = 0

    for direction in ("response", "request"):
        body_key = f"{direction}_body"
        headers = out.get(f"{direction}_headers") or {}
        raw = _safe_body(out.get(body_key))
        if direction == "response":
            encoded = raw
            raw = _maybe_decompress(encoded, headers)
            if raw != encoded:
                out[f"{body_key}_content_decoded"] = _header_value(headers, "content-encoding") or "detected"
        total = len(raw)
        out[f"{body_key}_bytes"] = total
        out[f"{body_key}_complete"] = True
        if total == 0:
            out[body_key] = ""
            continue

        out[f"{body_key}_sha256"] = hashlib.sha256(raw).hexdigest()
        is_wasm = _is_wasm_body(str(out.get("url") or ""), headers)
        is_binary = is_wasm or _body_to_text(raw[:min(total, inline_limit or total)], headers)[1]
        size_limit = max_wasm_bytes if is_wasm else per_body_limit
        omitted_reason = None
        if total > size_limit:
            omitted_reason = "wasm-size-limit" if is_wasm else "body-size-limit"
        elif total > remaining:
            omitted_reason = "total-budget"

        complete = omitted_reason is None
        external_preferred = is_wasm or is_binary or total > inline_limit
        if complete and (not external_preferred or not out_dir):
            preview_size = total
        elif complete:
            preview_size = min(total, inline_limit)
        else:
            preview_size = min(total, inline_limit, size_limit, max(0, remaining))
        preview = raw[:preview_size]
        preview_text, preview_binary, _ = _body_to_text(preview, headers)
        out[body_key] = preview_text
        if preview_binary:
            out[f"{body_key}_binary"] = True
            out[f"{body_key}_preview_encoding"] = "base64"

        should_write_file = complete and out_dir and external_preferred
        if should_write_file:
            file_path = _body_file_path(out_dir, out, direction, capture_index, headers, is_wasm)
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            with open(file_path, "wb") as f:
                f.write(raw)
            out[f"{body_key}_saved_to"] = os.path.relpath(file_path, out_dir)
            out[f"{body_key}_file_type"] = "wasm" if is_wasm else ("binary" if is_binary else "text")

        if complete:
            if preview_size < total:
                out[f"{body_key}_preview_truncated"] = True
            # 完整内容已内联或外部落盘；不再把 JSON 预览截断误报为证据截断。
            out[f"{body_key}_complete"] = True
            saved += total
            remaining = max(0, remaining - total)
        else:
            out[f"{body_key}_complete"] = False
            out[f"{body_key}_truncated"] = True
            out[f"{body_key}_omitted_reason"] = omitted_reason
            if preview_size < total:
                out[f"{body_key}_preview_truncated"] = True
            saved += preview_size
            remaining = max(0, remaining - preview_size)
    return out, saved


def _body_storage_stats(records: List[Dict[str, Any]]) -> Dict[str, int]:
    stats = {
        "completeBytes": 0,
        "externalFileCount": 0,
        "incompleteBodyCount": 0,
        "previewTruncatedCount": 0,
    }
    for record in records:
        for direction in ("response", "request"):
            key = f"{direction}_body"
            if record.get(f"{key}_complete") is True:
                stats["completeBytes"] += int(record.get(f"{key}_bytes") or 0)
            elif record.get(f"{key}_complete") is False:
                stats["incompleteBodyCount"] += 1
            if record.get(f"{key}_saved_to"):
                stats["externalFileCount"] += 1
            if record.get(f"{key}_preview_truncated"):
                stats["previewTruncatedCount"] += 1
    return stats


def _classify_packets(steps, args, substrings, regexes):
    """遍历抓包 steps，分离目标、JS 和终态之前的关联动态请求。

    - records_meta：每包 to_dict(include_bodies=False)，纯 metadata、零 BiDi RPC，用于 capture.json
    - js_records：识别为 JS 的包，response_body 落盘到 case/js/original/
    - target_hits：命中 --targets/--targets-regex 的包，小 body 内联、大 body 完整文件落盘
    - related_hits：终态之前最近的 API/验证码/WASM 等候选包，完整证据受包数和总字节预算限制

    性能关键：metadata 全部用 include_bodies=False 读取（不触发 RPC）；
    只有 JS / 目标 / 受限的关联候选才 to_dict(include_bodies=True) 按需拉 body——
    避免对所有包逐包拉 body（每个都是 BiDi get_data RPC，京东几百包会拖到数百秒）。
    """
    js_records = []
    target_hits = []
    related_hits = []
    document = None
    js_dir = os.path.join(args.case_subdir, "js", "original")
    os.makedirs(js_dir, exist_ok=True)
    packets = []
    for p in steps:
        try:
            packets.append((p, p.to_dict(include_bodies=False)))
        except Exception as e:
            logger.warning("读取抓包元数据失败，跳过该包：%s", e)
    records_meta = [d for _, d in packets]
    has_target_filter = bool(substrings or regexes)
    target_indices = [
        i for i, d in enumerate(records_meta)
        if has_target_filter and match_targets(d, substrings, regexes)
    ]
    related_indices = set()
    if not args.no_related_bodies:
        related_indices = set(_select_related_indices(records_meta, target_indices, args.max_related_packets))
    related_saved_bytes = 0
    target_saved_bytes = 0

    # 容量预算从终态向前消费，确保接近最终业务提交的 verify/load 请求优先保留。
    related_by_index = {}
    for i in sorted(related_indices, reverse=True):
        if related_saved_bytes >= args.max_related_total_bytes:
            break
        p, meta = packets[i]
        try:
            body_packet = p.to_dict(include_bodies=True)
        except Exception as e:
            logger.warning("读取关联包 body 失败（%s）：%s", meta.get("url"), e)
            body_packet = meta
        remaining = args.max_related_total_bytes - related_saved_bytes
        serialized, saved = _serialize_packet_bodies(
            body_packet,
            args.max_body_bytes,
            remaining,
            inline_limit=args.body_inline_bytes,
            max_wasm_bytes=args.max_wasm_bytes,
            out_dir=args.out_dir,
            capture_index=i,
        )
        serialized["capture_index"] = i
        serialized["related_reason"] = _related_reason(meta) or "terminal-predecessor"
        related_by_index[i] = serialized
        related_saved_bytes += saved
    related_hits = [related_by_index[i] for i in sorted(related_by_index)]

    for i, (p, meta) in enumerate(packets):
        d = meta
        is_js = is_js_packet(d)
        is_target = has_target_filter and match_targets(d, substrings, regexes)
        is_doc = document is None and _is_entry_document(d, args.url)
        if is_js or is_target or is_doc:
            try:
                d = p.to_dict(include_bodies=True)
            except Exception as e:
                logger.warning("读取包 body 失败（%s）：%s", d.get("url"), e)
        if is_js:
            body = _maybe_decompress(_safe_body(d.get("response_body")), d.get("response_headers"))
            fname = sanitize_filename(d.get("url", ""))
            fpath = os.path.join(js_dir, fname)
            if body:
                with open(fpath, "wb") as f:
                    f.write(body)
            js_records.append({
                "url": d.get("url"),
                "status": d.get("response_status"),
                "saved_to": os.path.relpath(fpath, args.out_dir),
                "size": len(body),
                "body_missing": not body,
                "source_mapping_url": extract_sourcemap(body) if body else None,
            })
        if is_target:
            remaining = max(0, args.max_target_total_bytes - target_saved_bytes)
            serialized, saved = _serialize_packet_bodies(
                d,
                args.max_body_bytes,
                remaining,
                inline_limit=args.body_inline_bytes,
                max_wasm_bytes=args.max_wasm_bytes,
                out_dir=args.out_dir,
                capture_index=i,
            )
            serialized["capture_index"] = i
            target_hits.append(serialized)
            target_saved_bytes += saved
        if is_doc:
            body = _maybe_decompress(_safe_body(d.get("response_body")), d.get("response_headers"))
            os.makedirs(args.out_dir, exist_ok=True)
            doc_path = os.path.join(args.out_dir, "document.html")
            if body:
                with open(doc_path, "wb") as f:
                    f.write(body)
            document = {
                "url": d.get("url"),
                "status": d.get("response_status"),
                "saved_to": os.path.relpath(doc_path, args.out_dir),
                "size": len(body),
                "body_missing": not body,
            }
    related_stats = {
        "candidateCount": len(related_indices),
        "savedCount": len(related_hits),
        "budgetBytes": related_saved_bytes,
        "maxPackets": args.max_related_packets,
        "maxTotalBytes": args.max_related_total_bytes,
        **_body_storage_stats(related_hits),
    }
    return records_meta, js_records, target_hits, related_hits, related_stats, js_dir, document


def _split_acceptance(target_hits):
    """按验收规则拆分命中包：非 OPTIONS 的 2xx 为 accepted；仅 OPTIONS 预检为 only_options。"""
    accepted = [
        h for h in target_hits
        if (h.get("response_status") or 0) // 100 == 2 and (h.get("method") or "").upper() != "OPTIONS"
    ]
    only_options = [
        h for h in target_hits
        if (h.get("method") or "").upper() == "OPTIONS" and not accepted
    ]
    return accepted, only_options


def _target_reached(steps, substrings, regexes) -> bool:
    """任一目标 URL 出现非 OPTIONS 2xx 响应即到达终态；多个目标表示替代终态。"""
    for p in steps:
        try:
            d = p.to_dict(include_bodies=False)
        except Exception:
            continue
        if not match_targets(d, substrings, regexes):
            continue
        status = int(d.get("response_status") or 0)
        method = str(d.get("method") or "").upper()
        if method != "OPTIONS" and status // 100 == 2:
            return True
    return False


def _js_quality(js_records) -> str:
    """JS 落盘质量判定：无 JS → N/A；全过 → PASS；部分缺失 → WARN；缺失比例 ≥50% → FAIL。

    背景：JS 落盘 0B（gzip/br 响应体未拿回）时 capture.json 仍可能正常、目标命中仍 PASS，
    导致"带病 PASS"——这里把 JS 完整性单独暴露为硬信号。
    """
    total = len(js_records)
    if total == 0:
        return "N/A"
    missing = sum(1 for j in js_records if j.get("body_missing"))
    if missing == 0:
        return "PASS"
    if missing / total >= 0.5:
        return "FAIL"
    return "WARN"


def _build_result(args, browser_path, baseline_id, fingerprint, cookies,
                  records_meta, js_records, target_hits, related_hits, related_stats,
                  accepted, only_options, webdriver_flag, wd_err, has_filter, document=None,
                  end_reason="unknown"):
    """汇总取证结果为报告字典。has_filter 表示是否指定了 --targets/--targets-regex。"""
    acceptance = "PASS" if (not has_filter) or accepted else ("PARTIAL" if target_hits else "NO_TARGET")
    return {
        "url": args.url,
        "endReason": end_reason,
        "endedAt": _now(),
        "browserPath": browser_path,
        "profileDir": args.profile_dir,
        "fpDir": args.fp_dir,
        "baselineId": baseline_id,
        "packetCount": len(records_meta),
        "jsFileCount": len(js_records),
        "targetHitCount": len(target_hits),
        "acceptedTargetCount": len(accepted),
        "relatedHitCount": len(related_hits),
        "bodyPolicy": {
            "inlineBytes": args.body_inline_bytes,
            "maxBodyBytes": args.max_body_bytes,
            "maxWasmBytes": args.max_wasm_bytes,
        },
        "targetBodyCapture": {
            "maxTotalBytes": args.max_target_total_bytes,
            **_body_storage_stats(target_hits),
        },
        "relatedCapture": related_stats,
        "webdriverTrue": bool(webdriver_flag) if webdriver_flag is not None else None,
        "webdriverCheckError": wd_err,
        "navigatorWebdriverSelfCheck": "FAIL" if webdriver_flag is True else ("PASS" if webdriver_flag is False else "UNKNOWN"),
        "acceptance": acceptance,
        "jsMissingCount": sum(1 for j in js_records if j.get("body_missing")),
        "jsQuality": _js_quality(js_records),
        "fingerprint": fingerprint,
        "cookies": cookies,
        "jsFiles": js_records,
        "targetHitsSummary": [
            {"url": h.get("url"), "method": h.get("method"), "status": h.get("response_status"), "isFailed": h.get("is_failed")}
            for h in target_hits
        ],
        "onlyOptionsWarning": [h.get("url") for h in only_options],
        "entryDocument": document,
    }


def _write_outputs(args, browser_path, records_meta, target_hits, related_hits, fingerprint, baseline_id, js_dir):
    """落盘抓包元数据、终态目标、关联链路与指纹基线，返回输出路径字典。"""
    os.makedirs(args.out_dir, exist_ok=True)
    with open(os.path.join(args.out_dir, "capture.json"), "w", encoding="utf-8") as f:
        json.dump(records_meta, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out_dir, "target-hits.json"), "w", encoding="utf-8") as f:
        json.dump(target_hits, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out_dir, "related-hits.json"), "w", encoding="utf-8") as f:
        json.dump(related_hits, f, ensure_ascii=False, indent=2)

    notes_dir = os.path.join(args.case_subdir, "notes")
    os.makedirs(notes_dir, exist_ok=True)
    # 正常收尾成功：等待期间写的 partial 快照使命完成，删除避免与分析产物混淆
    # （若此文件残留，说明进程未正常收尾——被强杀/中断，metadata 仍可分析）。
    try:
        partial_path = os.path.join(args.out_dir, "partial-steps.jsonl")
        if os.path.exists(partial_path):
            os.remove(partial_path)
    except Exception:
        pass
    fp_path = None
    if fingerprint is not None:
        fp_path = os.path.join(notes_dir, "fingerprint-baseline.json")
        with open(fp_path, "w", encoding="utf-8") as f:
            json.dump({
                "baselineId": baseline_id,
                "browserPath": browser_path,
                "profileDir": args.profile_dir,
                "fpDir": args.fp_dir,
                "createdAt": _now(),
                "fingerprint": fingerprint,
            }, f, ensure_ascii=False, indent=2)
    return {
        "captureJson": os.path.join(args.out_dir, "capture.json"),
        "targetHitsJson": os.path.join(args.out_dir, "target-hits.json"),
        "relatedHitsJson": os.path.join(args.out_dir, "related-hits.json"),
        "bodyDir": os.path.join(args.out_dir, "bodies"),
        "wasmDir": os.path.join(args.out_dir, "wasm"),
        "jsDir": js_dir,
        "fingerprintBaseline": fp_path,
    }


def _resolve_browser_pid(page) -> Optional[int]:
    """尽力从 ruyipage 页面对象解析浏览器主进程 PID；解析不到返回 None。

    兼容两代对象模型：
    - 新版（>=1.2.5x）：pid 在 page.browser.process.pid（subprocess 对象）
    - 旧版：page / page.browser / page.driver 上的 pid/process_id/browser_pid 属性
    """
    if page is None:
        return None
    # 优先新版 subprocess 对象链：page.browser.process.pid
    try:
        proc = page.browser.process
        if proc is not None and getattr(proc, "pid", None):
            return int(proc.pid)
    except Exception:
        pass
    for holder in (page, getattr(page, "browser", None), getattr(page, "driver", None)):
        if holder is None:
            continue
        for attr in ("pid", "process_id", "browser_pid"):
            v = getattr(holder, attr, None)
            if isinstance(v, int) and v > 0:
                return v
            if isinstance(v, str) and v.isdigit():
                return int(v)
    return None


def _kill_process_tree(pid: int) -> bool:
    """强制结束进程树：Windows 用 taskkill /T /F，其他平台 kill 进程组。"""
    if not pid or pid <= 0:
        return False
    try:
        if os.name == "nt":
            cmd = ["taskkill", "/PID", str(pid), "/T", "/F"]
        else:
            cmd = ["kill", "-TERM", "-%d" % pid]
        ret = subprocess.run(cmd, capture_output=True, timeout=15)
        return ret.returncode == 0
    except Exception as e:
        logger.warning("进程树兜底结束异常：%s", e)
        return False


def _pid_alive(pid: int) -> bool:
    """查询进程是否仍存活。查询失败时保守返回 True（继续走兜底结束路径）。"""
    if not pid or pid <= 0:
        return False
    if os.name == "nt":
        try:
            ret = subprocess.run(
                ["tasklist", "/FI", "PID eq %d" % pid],
                capture_output=True, timeout=10,
            )
            out = (ret.stdout or b"").decode("gbk", "ignore")
            return ret.returncode == 0 and str(pid) in out
        except Exception:
            return True
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _close_browser(page) -> str:
    """主动关闭取证浏览器。

    注意（ruyipage >= 1.2.5x 行为变化）：`page.close()` 只关闭当前标签页，
    不再关闭整个浏览器；关闭浏览器必须用 `page.quit()`。这里优先 quit 整个
    浏览器，quit 不可用或失败时回退 close，再失败做进程树兜底。

    返回状态：none（未启动）/ closed（优雅关闭）/ force-killed（优雅失败后进程树兜底）/
    failed（优雅与兜底均失败，可能残留进程）。
    """
    if page is None:
        return "none"
    # 优先整浏览器关闭：新版 quit(timeout, force)；旧版无 quit 时回退 close
    for method in ("quit", "close"):
        closer = getattr(page, method, None)
        if closer is None:
            continue
        try:
            if method == "quit":
                closer(timeout=8, force=False)
            else:
                closer()
            return "closed"
        except Exception as e:
            logger.warning("page.%s() 失败（%s），尝试下一关闭方式", method, e)
    logger.warning("优雅关闭全部失败，尝试进程树兜底结束")
    pid = _resolve_browser_pid(page)
    if pid is None:
        logger.warning("无法解析浏览器进程 PID，无法兜底结束，浏览器可能残留")
        return "failed"
    if not _pid_alive(pid):
        # 用户手动关闭浏览器 / 浏览器自行退出：进程已不在，无需兜底，也不是失败
        logger.info("浏览器进程（PID %s）已退出（多为用户手动关闭），无需兜底结束", pid)
        return "closed"
    if _kill_process_tree(pid):
        logger.info("已强制结束浏览器进程树（PID %s）", pid)
        return "force-killed"
    logger.warning("进程树兜底结束失败（PID %s）", pid)
    return "failed"


# 抓包等待期间的中断状态（信号 handler 置位，等待循环逐轮检查后立即收尾）
_INTERRUPTED = {"reason": None}


def _request_interrupt(signum, _frame):
    if _INTERRUPTED["reason"] is None:
        _INTERRUPTED["reason"] = "signal-%s" % signum
    logger.warning("收到中断信号（%s）：不再等待，立即收尾落盘已捕获数据...", signum)


def _install_signal_watch():
    """监听 SIGINT/SIGTERM（Windows 另加 SIGBREAK），收到后置中断标志而非直接退出。

    直接默认退出（KeyboardInterrupt / 进程终止）不会走收尾落盘，已抓的包全部丢失——
    这正是「用户关完浏览器、脚本还在空转、被 kill 后目录全空」的数据丢失路径之一。
    注意：Windows 的 TerminateProcess 硬杀无法捕获，那条路径由 partial 快照兜底。
    """
    watched = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):
        watched.append(signal.SIGBREAK)
    for sig in watched:
        try:
            signal.signal(sig, _request_interrupt)
        except (ValueError, OSError):
            pass  # 非主线程或平台不支持时静默跳过


def _browser_gone(page, hb_state: Dict[str, Any]) -> bool:
    """检测取证浏览器连接是否已断开（用户手动关闭浏览器 / 浏览器崩溃）。

    首选零 RPC 的内部状态探测：ruyipage BrowserBiDiDriver 的接收线程在 WebSocket
    断开时会置 _is_running=False（websocket-client 连接对象另有 connected 属性）。
    注意 page.capture.wait()/steps 是纯本地队列操作，断连**永远不会**通过它们报错——
    必须主动探测，否则等待循环会空转到 --wait 死线。

    introspection 失败（ruyipage 版本差异拿不到内部对象）时，降级为每 10s 一次的
    轻量心跳 RPC（run_js），PageDisconnectedError 类错误视为断开。
    """
    if page is None:
        return True
    driver = None
    try:
        driver = getattr(getattr(page, "_driver", None), "_browser_driver", None)
        if driver is None:
            driver = getattr(getattr(page, "browser", None), "_driver", None)
    except Exception:
        driver = None
    if driver is not None:
        try:
            if getattr(driver, "_is_running", True) is False:
                return True
            ws = getattr(driver, "_ws", None)
            if ws is not None and getattr(ws, "connected", None) is False:
                return True
            return False
        except Exception:
            pass
    # 兜底心跳（仅在拿不到内部驱动对象时走到这里）
    now = time.time()
    if now - hb_state.get("last_beat", 0.0) >= 10:
        hb_state["last_beat"] = now
        try:
            page.run_js("return 1", timeout=5)
        except Exception as e:
            text = "%s:%s" % (type(e).__name__, e)
            if any(k in text.lower() for k in ("disconnect", "发送失败", "断开", "未连接")):
                return True
            logger.debug("心跳 RPC 异常（不视为断连）：%s", e)
    return False


def _flush_partial(args, steps) -> Optional[str]:
    """把已捕获包的元数据快照增量落盘（JSONL，每行一包，零 RPC）。

    收尾（分类 + 拉 body + 写 capture.json）只在最后执行；期间进程被硬杀
    （kill -9 / TerminateProcess，信号都收不到）时 capture.json 不会写出。
    partial 快照保证此时仍保留全部包的 URL/方法/状态/请求头元数据供初步分析。
    正常收尾成功后由 _write_outputs 删除。写失败只 debug 告警，绝不影响抓包。
    """
    try:
        os.makedirs(args.out_dir, exist_ok=True)
        path = os.path.join(args.out_dir, "partial-steps.jsonl")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(json.dumps({
                "_partial": True,
                "flushedAt": _now(),
                "packetCount": len(steps),
                "note": "抓包期间的增量元数据快照；正常收尾后会被删除。若此文件残留，说明进程未正常收尾（被强杀/中断），metadata 仍可用于分析，body 未拉取。",
            }, ensure_ascii=False) + "\n")
            for p in steps:
                try:
                    d = p.to_dict(include_bodies=False)
                except Exception:
                    continue
                f.write(json.dumps(d, ensure_ascii=False) + "\n")
        os.replace(tmp, path)
        return path
    except Exception as e:
        logger.debug("partial 快照写盘失败（不影响抓包）：%s", e)
        return None


def _apply_ruyipage_anti_hang_patch():
    """防挂补丁（依赖 ruyipage 内部实现，失败仅告警不阻断）：
    - CapturePacket._fallback_fetch_body 保留但仅对 JS 包放行：capture.stop() 逐包拉 body 时，
      拿不到 body 的 GET 会逐个在页面内 replay fetch（15s/个），京东等大页面 GET 多会拖到数百秒；
      本脚本收尾已不调 stop()，改为按需 to_dict(include_bodies=True)（仅 JS / 目标命中包拉 body），
      replay 成本有界。JS 是后续定位分析的关键证据，其 gzip/br 响应体 BiDi collector 常拿不到，
      必须保留 replay 兜底，否则 JS 落盘 0B 且取证质量不达标；非 JS 的 GET 跳过 replay，
      避免页面内多余的 fetch replay。
    - Settings.response_body_timeout 恢复到默认 10s：压到 1s 会让大 JS 在 collector 内超时返回空 body。
    """
    try:
        from ruyipage._units import capture as _cap
        orig = _cap.CapturePacket._fallback_fetch_body
        def _js_only_fallback(self):
            if self.method != "GET" or not self.url or not self._owner:
                return None
            if not is_js_packet({"url": self.url, "response_headers": dict(self.response_headers or {})}):
                return None
            return orig(self)
        _cap.CapturePacket._fallback_fetch_body = _js_only_fallback
    except Exception as e:
        logger.warning("防挂补丁 fallback 限流失败：%s", e)
    try:
        from ruyipage._functions import settings as _settings
        _settings.Settings.response_body_timeout = 10
    except Exception as e:
        logger.warning("防挂补丁 response_body_timeout 调整失败：%s", e)


def _ruyipage_geq(version: str, minv: str) -> bool:
    """语义化版本 >= 判断：1.2.62 >= 1.2.61 为真。解析失败时返回 False（保守，走补丁）。"""
    try:
        a = tuple(int(x) for x in version.split(".")[:3])
        b = tuple(int(x) for x in minv.split(".")[:3])
        for i in range(3):
            if a[i] != b[i]:
                return a[i] > b[i]
        return True
    except Exception:
        return False


def _apply_ruyipage_capture_compat_patch():
    """Firefox 155+（privileged scope）兼容补丁（依赖 ruyipage 内部实现，失败仅告警不阻断）。

    ruyipage 1.2.62+ 的 capture.start 已原生内置降级（capture.py：上下文的
    session.subscribe 失败时自动重试全局订阅），本补丁仅对 <1.2.62 生效：
    旧版本（1.2.61 及更早）的 capture.start 在 session.subscribe 时无条件传
    contexts，而 Firefox 155+ 的 privileged scope 下不支持该参数，subscribe 直接
    抛错导致抓包启动失败（1.2.45 自带降级，1.2.61 回退掉了）。这里给 subscribe
    包一层：带 contexts 失败时自动降级为全局订阅（不限定 context），事件仍覆盖
    全部标签页。1.2.45 自带同类降级，包装后由本补丁统一处理：仍是一次失败 + 一次
    全局重试，不产生额外 RPC，行为等效。
    """
    try:
        import ruyipage
        if _ruyipage_geq(getattr(ruyipage, "__version__", ""), "1.2.62"):
            return
    except Exception:
        pass
    try:
        import ruyipage._bidi.session as _sess
        orig = _sess.subscribe
        if getattr(orig, "_ruyipage_privileged_fallback", False):
            return
        # 1.2.45 的 subscribe(driver, events, contexts=None) 没有 user_contexts
        # 参数，1.2.61 新增了它；按签名条件传参，避免低版本 TypeError。
        try:
            _supports_user_contexts = "user_contexts" in inspect.signature(orig).parameters
        except Exception:
            _supports_user_contexts = True

        def subscribe(driver, events, contexts=None, user_contexts=None):
            kwargs = {"contexts": contexts}
            if _supports_user_contexts:
                kwargs["user_contexts"] = user_contexts
            try:
                return orig(driver, events, **kwargs)
            except Exception:
                if not kwargs.get("contexts") and not kwargs.get("user_contexts"):
                    raise
                logger.warning(
                    "session.subscribe 带 contexts/user_contexts 失败，降级为全局订阅重试"
                )
                return orig(driver, events)

        subscribe._ruyipage_privileged_fallback = True
        _sess.subscribe = subscribe
    except Exception as e:
        logger.warning("capture privileged-scope 兼容补丁安装失败：%s", e)


def run_forensic(args: argparse.Namespace, browser_path: str) -> Dict[str, Any]:
    """ruyiPage 取证主流程：启动浏览器 → 抓全部包 → 分类（元数据/JS/目标）→ JS 落盘 → 报告。

    浏览器生命周期：取证结束（成功或异常）一律在 finally 中主动关闭，
    优雅 close 失败时做进程树兜底强制结束，避免残留进程锁住 profile。
    """
    from ruyipage import FirefoxPage
    _apply_ruyipage_anti_hang_patch()
    _apply_ruyipage_capture_compat_patch()

    page = None
    result = None
    try:
        opts = build_options(args, browser_path)
        ctx = apply_smart_fingerprint(opts, args)

        logger.info("启动有头 ruyiPage 定制 Firefox 取证：%s", browser_path)
        page = FirefoxPage(opts)
        if ctx is not None:
            applied = ctx.apply_emulation(page)
            logger.info("智能指纹仿真已注入：%s", applied)

        regexes = []
        if args.targets_regex:
            for r in args.targets_regex.split(","):
                r = r.strip()
                if r:
                    regexes.append(re.compile(r))
        substrings = [s.strip() for s in (args.targets or "").split(",") if s.strip()]

        # 硬约束：capture.start 必须在 get 之前
        page.capture.start(targets=True, collect_bodies=True)
        logger.info("capture 已启动（targets=True 抓全部包）")

        get_timed_out = False
        try:
            # wait="interactive"（DOMContentLoaded 即返回）：京东等首页 load 事件因长轮询
            # 迟迟不触发，等 complete 无意义；interactive 让抓包更早开始，缩短 get 阻塞。
            # 注意：wait 是 BiDi 协议值（none/interactive/complete），不是 load_mode 的 "eager"。
            page.get(args.url, timeout=args.wait + 20, wait="interactive")
        except Exception as e:
            # 京东等首页常有长轮询/持续请求，load 事件迟迟不触发；
            # get 超时不能中断取证——已捕获的包必须照样 stop + 落盘。
            get_timed_out = True
            logger.warning("page.get 超时/异常（页面 load 未完成不影响已捕获流量），继续收尾：%s", e)

        if args.manual_pause:
            # 后台/非交互 stdin（AI 通过工具调用运行）会立即 EOF 抛异常导致脚本退出 →
            # finally 强制关浏览器，用户还没操作。容错：EOF 时不崩溃，跳过暂停直接进入
            # 后续 --wait 等待循环（默认 120s，可调大），让用户有时间在窗口完成操作。
            try:
                input("在浏览器中完成登录 / 业务操作后按回车继续取证...")
            except EOFError:
                logger.warning("--manual-pause 遇非交互 stdin（EOF），跳过暂停；请在浏览器窗口完成操作，脚本将在 --wait 时间内等待目标命中；操作完成后直接关闭浏览器窗口也会立即收尾落盘")

        _trigger_actions(page, args, args.human_algorithm)

        # 等待阶段公共状态与检查。
        # 关键背景：page.capture.wait()/steps 是纯本地队列操作，浏览器断连（用户手动
        # 关闭窗口 / 崩溃）**永远不会**让它们抛错——不主动探测的话等待循环会一路空转
        # 到 --wait 死线（几分钟），期间进程一旦被 kill，收尾落盘一次都不执行，
        # forensic 目录全空。断连探测 + partial 快照 + 信号中断三件套就是为了堵这条路。
        hb_state: Dict[str, Any] = {}
        partial_state: Dict[str, Any] = {"last_flush": 0.0, "count": -1}
        zero_warn_state: Dict[str, Any] = {"started": time.time(), "warned": False}
        end_reason = "wait-timeout"

        def _pre_wait_checks(steps_now) -> Optional[str]:
            """等待循环每轮公共检查：返回应立即收尾的终态原因（endReason），否则 None。"""
            count = len(steps_now)
            # 用户手动关闭浏览器 / 连接断开 = 合法的抓包结束信号（等价于"我抓完了"），
            # 立即收尾落盘，而不是傻等 --wait 超时
            if _browser_gone(page, hb_state):
                logger.warning(
                    "检测到浏览器已关闭/连接断开，视为手动结束抓包：已捕获 %s 个包，立即收尾落盘（不等待 --wait 超时）",
                    count,
                )
                return "browser-closed"
            if _INTERRUPTED["reason"]:
                logger.warning("收到中断信号：已捕获 %s 个包，立即收尾落盘", count)
                return _INTERRUPTED["reason"]
            if count == 0 and not zero_warn_state["warned"] \
                    and time.time() - zero_warn_state["started"] >= 30:
                zero_warn_state["warned"] = True
                logger.warning(
                    "[警告] 抓包启动 %ss 仍 0 个包：页面可能未加载成功、用户尚未开始操作，"
                    "或网络事件订阅失败（Firefox/ruyipage 版本兼容问题）。请确认浏览器窗口状态",
                    int(time.time() - zero_warn_state["started"]),
                )
            if count and count != partial_state["count"] \
                    and time.time() - partial_state["last_flush"] >= 5:
                partial_state["last_flush"] = time.time()
                partial_state["count"] = count
                _flush_partial(args, steps_now)
            return None

        _install_signal_watch()

        if substrings or regexes:
            # 用户给出的目标接口是本次流程的终态（如最终登录/提交接口）。命中后只短暂收尾，
            # 由后续分类从同一会话中回溯验证码等前置链路，不能要求预先列全中间接口。
            deadline = time.time() + args.wait
            target_done = False
            wait_fail = 0
            while time.time() < deadline:
                try:
                    steps_now = page.capture.steps
                except Exception:
                    steps_now = []
                stop = _pre_wait_checks(steps_now)
                if stop:
                    end_reason = stop
                    break
                if _target_reached(steps_now, substrings, regexes):
                    target_done = True
                    end_reason = "target-hit"
                    logger.info("终态目标接口已命中，开始 %ss 收尾窗口", args.target_settle)
                    break
                try:
                    pkt = page.capture.wait(timeout=2, count=1)
                    wait_fail = 0
                except Exception as e:
                    wait_fail += 1
                    logger.warning("capture.wait 异常（连续第 %s 次）：%s", wait_fail, e)
                    if wait_fail >= 5:
                        logger.warning("capture.wait 连续 %s 次异常，放弃等待", wait_fail)
                        end_reason = "wait-error"
                        break
            if not target_done and end_reason == "wait-timeout":
                logger.warning("[超时] 未在 %ss 内命中目标接口，按 --wait 收尾。若用户尚未在浏览器完成操作（登录/滑动验证码等），请调大 --wait 或重采；已捕获的包仍会落盘供分析。用户在浏览器内完成操作后直接关闭浏览器窗口也会立即收尾", args.wait)
            elif target_done and args.target_settle > 0:
                # --wait 只限制首次终态的等待时间；命中后应完整执行收尾窗口，
                # 避免目标在 deadline 附近出现时后置回调只抓到不足 target-settle 秒。
                settle_deadline = time.time() + args.target_settle
                while time.time() < settle_deadline:
                    # 命中终态后浏览器被关闭/收到中断：目标已到手，没必要等完窗口
                    if _browser_gone(page, hb_state) or _INTERRUPTED["reason"]:
                        logger.info("收尾窗口内浏览器关闭/收到中断，提前结束收尾")
                        break
                    try:
                        page.capture.wait(timeout=min(2, max(1, int(settle_deadline - time.time()))), count=1)
                        wait_fail = 0
                    except Exception as e:
                        wait_fail += 1
                        logger.warning("收尾 capture.wait 异常（连续第 %s 次）：%s", wait_fail, e)
                        if wait_fail >= 5:
                            logger.warning("收尾 capture.wait 连续 %s 次异常，结束收尾窗口", wait_fail)
                            break
        else:
            # 未指定目标：网络静默即停——包数不再增长且连续 settle 秒无新包视为抓包完成。
            # 比"首个包+固定 sleep"更早结束（早完成早停），避免页面加载完仍在空等。
            deadline = time.time() + args.wait
            prev_count = 0
            last_seen = time.time()
            done = False
            wait_fail = 0
            while time.time() < deadline:
                try:
                    steps_now = page.capture.steps
                except Exception:
                    steps_now = []
                stop = _pre_wait_checks(steps_now)
                if stop:
                    end_reason = stop
                    break
                count = len(steps_now)
                if count > prev_count:
                    prev_count = count
                    last_seen = time.time()
                elif count > 0 and time.time() - last_seen >= args.settle:
                    logger.info("包数保持 %s 个且连续 %ss 无新包，抓包完成", count, args.settle)
                    done = True
                    end_reason = "quiet-settle"
                    break
                try:
                    pkt = page.capture.wait(timeout=2, count=1)
                    wait_fail = 0
                except Exception as e:
                    wait_fail += 1
                    logger.warning("capture.wait 异常（连续第 %s 次）：%s", wait_fail, e)
                    if wait_fail >= 5:
                        logger.warning("capture.wait 连续 %s 次异常，放弃等待", wait_fail)
                        end_reason = "wait-error"
                        break
            if not done and end_reason == "wait-timeout":
                logger.info("未在 %ss 内达到静默，按 --wait 超时收尾（已捕获 %s 个包）", args.wait, prev_count)

        # 收尾：不调用 capture.stop()——它对每个包做 2 次 BiDi get_data RPC（共 2N 次），
        # 京东等大页面包多 + 浏览器繁忙时 RPC 慢，会拖到数百秒；浏览器关闭断连后才快速返回。
        # metadata 由 steps 快照直接读取（零 RPC），body 在 _classify_packets 里按需拉取。
        try:
            steps = page.capture.steps
        except Exception as e:
            logger.warning("读取 steps 失败：%s", e)
            steps = []

        records_meta, js_records, target_hits, related_hits, related_stats, js_dir, document = _classify_packets(
            steps, args, substrings, regexes
        )

        webdriver_flag, wd_err = _eval_js(page, "return navigator.webdriver === true")
        cookies = []
        try:
            cookies = page.get_cookies(all_info=True)
        except Exception as e:
            logger.warning("读取 Cookie 失败：%s", e)

        accepted, only_options = _split_acceptance(target_hits)

        baseline_id = args.baseline_id or uuid.uuid5(
            uuid.NAMESPACE_URL, os.path.abspath(args.case_dir)
        ).hex

        fingerprint = None
        if ctx is not None:
            try:
                fingerprint = ctx.to_dict()
            except Exception as e:
                logger.warning("指纹 to_dict 失败：%s", e)

        has_filter = bool(substrings) or bool(regexes)
        result = _build_result(
            args, browser_path, baseline_id, fingerprint, cookies,
            records_meta, js_records, target_hits, related_hits, related_stats,
            accepted, only_options, webdriver_flag, wd_err, has_filter, document,
            end_reason=end_reason,
        )
        result["getTimedOut"] = get_timed_out
        result["outputs"] = _write_outputs(
            args, browser_path, records_meta, target_hits, related_hits, fingerprint, baseline_id, js_dir
        )
        logger.info("=== FORENSIC DONE === 结束原因 %s，抓包 %s 个，目标命中 %s，关联材料 %s，已写入 capture.json",
                    end_reason, len(records_meta), len(target_hits), len(related_hits))
        return result
    except BaseException as e:
        # 兜底纪律：任何异常（含 KeyboardInterrupt）都不允许丢掉已抓的包——
        # 已捕获的 metadata 必须尽力落盘后再抛出。body 拉取可失败，元数据不能丢。
        logger.error("取证流程异常（%s），保底落盘已捕获数据后退出", e)
        try:
            steps_snap = []
            if page is not None:
                try:
                    steps_snap = page.capture.steps
                except Exception:
                    steps_snap = []
            if steps_snap:
                os.makedirs(args.out_dir, exist_ok=True)
                cap_path = os.path.join(args.out_dir, "capture.json")
                if not os.path.exists(cap_path):
                    records = []
                    for p in steps_snap:
                        try:
                            records.append(p.to_dict(include_bodies=False))
                        except Exception:
                            pass
                    with open(cap_path, "w", encoding="utf-8") as f:
                        json.dump(records, f, ensure_ascii=False, indent=2)
                    logger.error("已保底写入 %s 个包的元数据到 capture.json（body 未拉取）", len(records))
        except Exception as e2:
            logger.error("保底落盘失败：%s", e2)
        raise
    finally:
        # 取证结束（成功或异常）一律主动关闭浏览器，避免残留进程 / profile 锁
        closed = _close_browser(page)
        if result is not None and isinstance(result, dict):
            result["browserClosed"] = closed


def _now() -> str:
    from datetime import datetime
    return datetime.now().isoformat(timespec="seconds")


# ============================================================
# CLI
# ============================================================
def parse_args(argv: List[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="forensic_ruyipage.py",
        description="ruyiPage 通用取证：抓包 + JS 收集 + 指纹基线（严格有头/定制内核）。",
    )
    p.add_argument("--url", default="", help="目标页面 URL")
    p.add_argument("--browser-path", default="", help="ruyiPage 定制 Firefox 可执行文件；缺省自动解析 managed runtime（禁系统回退）")
    p.add_argument("--case-dir", default=".", help="项目根目录（其下应有 case/ 和 result/ 两个平级子目录），默认当前目录")
    p.add_argument("--project-dir", default="", help="用户工程目录（tools/ 所在）。未传时从 --case-dir / 当前目录向上查找 tools/；安装模式下 skill 安装目录无 tools/，靠此定位定制 Firefox runtime")
    p.add_argument("--out-dir", default="", help="取证输出目录，默认 <case-dir>/case/forensic")
    p.add_argument("--profile-dir", default="", help="独立浏览器 profile，默认 <case-dir>/case/tmp/ruyipage-profile")
    p.add_argument("--fp-dir", default="", help="智能指纹 base_dir，默认 <case-dir>/case/tmp/fingerprint")
    p.add_argument("--targets", default="", help="终态接口 URL 子串过滤（逗号分隔，可传多个替代终态）；任一非 OPTIONS 2xx 命中即结束取证，抓包始终覆盖全会话")
    p.add_argument("--targets-regex", default="", help="终态接口 URL 正则过滤（逗号分隔）；与 --targets 为 OR 关系")
    p.add_argument("--human-algorithm", default="windmouse", help="拟人算法：windmouse / bezier，默认 windmouse")
    p.add_argument("--window-size", default="1366,900", help="窗口尺寸 wxh，默认 1366,900")
    p.add_argument("--require-country", default="", help="smart_fingerprint require_country（ISO-2）；缺省不校验出口国家（适配代理出口 IP 与目标国家不一致）")
    p.add_argument("--proxy", default="", help="出口代理 host:port（如 1.2.3.4:8080），透传 smart_fingerprint 的 proxy_host/proxy_port；缺省直连（国内站点通常不需要）")
    p.add_argument("--proxy-auth", default="", help="出口代理认证 user:pass（透传 proxy_user/proxy_pwd），可选；账号密码只写 fpfile，不写业务脚本/交付物")
    p.add_argument("--manual-geo", default="", help="地理探测失败时的 manual_geo（JSON 字符串或文件路径）")
    p.add_argument("--no-fp", action="store_true", help="跳过 smart_fingerprint（禁用智能指纹）")
    p.add_argument("--wait", type=int, default=120, help="等待首次终态目标命中的超时秒；命中后另执行完整 --target-settle 收尾窗口，未命中到点自动关闭，默认 120；验证码/登录等需人工操作的场景建议调大（如 300）")
    p.add_argument("--settle", type=int, default=5, help="未指定 --targets 时的静默窗口：包数不再增长且连续 N 秒无新包视为抓包完成，默认 5")
    p.add_argument("--target-settle", type=int, default=3, help="终态接口首次出现 HTTP 2xx 后继续抓取的秒数，用于接收后置回调或额外业务重试；脚本无法通用判断响应体中的业务成功码，预期可能重试时请调大，默认 3")
    p.add_argument("--body-inline-bytes", type=int, default=1024 * 1024, help="请求体/响应体在 JSON 中完整内联或预览的最大原始字节数，默认 1MB；超过后完整内容单独落盘")
    p.add_argument("--max-body-bytes", type=int, default=10 * 1024 * 1024, help="普通请求体/响应体完整保留的单体上限，默认 10MB；超过后仅留预览并显式标记")
    p.add_argument("--max-wasm-bytes", type=int, default=50 * 1024 * 1024, help="WASM 完整原始文件的单体上限，默认 50MB；WASM 不保存不可执行的半包")
    p.add_argument("--max-target-total-bytes", type=int, default=100 * 1024 * 1024, help="全部终态命中 body 的总保留预算，默认 100MB")
    p.add_argument("--max-related-packets", type=int, default=60, help="终态前关联动态 body 的最大包数，默认 60；从终态向前优先保留")
    p.add_argument("--max-related-total-bytes", type=int, default=100 * 1024 * 1024, help="终态前关联动态 body 的总保留预算，默认 100MB")
    p.add_argument("--no-related-bodies", action="store_true", help="关闭终态前关联动态 body 自动保存，仅保留 JS/目标接口响应体")
    p.add_argument("--click", default="", help="导航后拟人点击的 CSS 选择器")
    p.add_argument("--scroll", type=int, default=0, help="导航后滚动像素数")
    p.add_argument("--manual-pause", action="store_true", help="导航后暂停，等待手动完成登录/业务再继续；AI 后台运行遇非交互 stdin（EOF）时自动退化为等待 --wait，不阻塞")
    p.add_argument("--baseline-id", default="", help="指定 baselineId（复用已有指纹基线）")
    p.add_argument("--dry-run", action="store_true", help="只检测环境并打印计划，不启动浏览器")
    p.add_argument("--json", action="store_true", help="输出 JSON")
    p.add_argument("--markdown", action="store_true", help="输出 Markdown（默认）")
    p.add_argument("--self-test", action="store_true", help="运行本地过滤与终态判定自测，不启动浏览器")
    a = p.parse_args(argv)
    if not a.self_test and not a.url:
        p.error("--url 为必填项（--self-test 除外）")
    if a.wait < 0 or a.settle < 0 or a.target_settle < 0:
        p.error("--wait/--settle/--target-settle 不能为负数")
    if a.body_inline_bytes < 0 or a.max_body_bytes <= 0 or a.max_wasm_bytes <= 0:
        p.error("body 内联预览不能为负数，普通 body/WASM 单体上限必须为正数")
    if a.body_inline_bytes > a.max_body_bytes:
        p.error("--body-inline-bytes 不能大于 --max-body-bytes")
    if a.max_target_total_bytes < 0 or a.max_related_packets < 0 or a.max_related_total_bytes < 0:
        p.error("目标/关联总预算与关联包数不能为负数")
    if not a.json and not a.markdown:
        a.markdown = True
    a.case_dir = os.path.abspath(a.case_dir)
    a.case_subdir = os.path.join(a.case_dir, "case")
    a.out_dir = os.path.abspath(a.out_dir) if a.out_dir else os.path.join(a.case_subdir, "forensic")
    a.profile_dir = os.path.abspath(a.profile_dir) if a.profile_dir else os.path.join(a.case_subdir, "tmp", "ruyipage-profile")
    a.fp_dir = os.path.abspath(a.fp_dir) if a.fp_dir else os.path.join(a.case_subdir, "tmp", "fingerprint")
    return a


class _SelfTestPacket:
    def __init__(self, value: Dict[str, Any]):
        self.value = value

    def to_dict(self, include_bodies: bool = False) -> Dict[str, Any]:
        return dict(self.value)


def run_self_test() -> int:
    """不依赖 ruyipage 的核心回归测试，覆盖终态 OR 语义与关联材料筛选。"""
    import tempfile
    from types import SimpleNamespace

    defaults = parse_args(["--self-test"])
    assert defaults.body_inline_bytes == 1024 * 1024, "JSON 内联预览默认值错误"
    assert defaults.max_body_bytes == 10 * 1024 * 1024, "普通 body 默认上限错误"
    assert defaults.max_wasm_bytes == 50 * 1024 * 1024, "WASM 默认上限错误"
    assert defaults.max_related_total_bytes == 100 * 1024 * 1024, "关联总预算默认值错误"

    header_only = {
        "url": "https://api.example.com/login",
        "method": "POST",
        "request_headers": {"referer": "https://example.com/captcha/verify"},
    }
    assert not match_targets(header_only, ["captcha/verify"], []), "target 不应匹配 Referer 头"

    records = [
        {"url": "https://example.com/login", "method": "GET", "response_status": 200, "response_headers": {"content-type": "text/html"}},
        {"url": "https://api.example.com/login/submit", "method": "OPTIONS", "response_status": 204, "response_headers": {}},
        {"url": "https://captcha.example.com/load", "method": "GET", "response_status": 200, "response_headers": {"content-type": "application/json"}},
        {"url": "https://captcha.example.com/verify", "method": "POST", "response_status": 200, "response_headers": {"content-type": "application/json"}},
        {"url": "https://cdn.example.com/site.css", "method": "GET", "response_status": 200, "response_headers": {"content-type": "text/css"}},
        {"url": "https://api.example.com/login/submit", "method": "POST", "response_status": 200, "response_headers": {"content-type": "application/json"}},
    ]
    related = _select_related_indices(records, [1, 5], 60)
    assert related == [2, 3], f"关联候选筛选或 OPTIONS 终态处理错误：{related}"

    # 多次终态提交时必须以最后一次有效提交为锚点，保留两次提交之间
    # 重新触发的验证码/风控链路，而不是只保留首次提交之前的材料。
    retry_records = [
        {"url": "https://captcha.example.com/load?attempt=1", "method": "GET", "response_status": 200, "response_headers": {"content-type": "application/json"}},
        {"url": "https://captcha.example.com/verify?attempt=1", "method": "POST", "response_status": 200, "response_headers": {"content-type": "application/json"}},
        {"url": "https://api.example.com/login/submit", "method": "POST", "response_status": 200, "response_headers": {"content-type": "application/json"}},
        {"url": "https://captcha.example.com/load?attempt=2", "method": "GET", "response_status": 200, "response_headers": {"content-type": "application/json"}},
        {"url": "https://captcha.example.com/verify?attempt=2", "method": "POST", "response_status": 200, "response_headers": {"content-type": "application/json"}},
        {"url": "https://api.example.com/login/submit", "method": "POST", "response_status": 200, "response_headers": {"content-type": "application/json"}},
    ]
    retry_related = _select_related_indices(retry_records, [2, 5], 60)
    assert retry_related == [0, 1, 3, 4], f"多次终态提交未保留最后一次验证码链：{retry_related}"

    packets = [_SelfTestPacket(records[0]), _SelfTestPacket(records[5])]
    assert _target_reached(packets, ["/login/submit"], []), "最终业务接口应触发终态"
    assert not _target_reached([_SelfTestPacket(records[0])], ["/login/submit"], []), "未到终态不应提前结束"

    serialized, saved = _serialize_packet_bodies(
        {"url": "https://api.example.com/x", "method": "POST", "request_body": "12345", "response_body": "abcdef"},
        4,
        6,
    )
    assert saved == 6 and serialized.get("response_body_truncated"), "关联 body 总预算/截断失效"

    records[2]["response_body"] = '{"challenge":"fresh"}'
    records[3]["request_body"] = "w=encrypted"
    records[3]["response_body"] = '{"ticket":"fresh"}'
    records[5]["request_body"] = "ticket=fresh"
    records[5]["response_body"] = '{"code":0}'
    with tempfile.TemporaryDirectory() as root:
        out_dir = os.path.join(root, "case", "forensic")

        large_json = ('{"data":"' + ("x" * (2 * 1024 * 1024)) + '"}').encode("utf-8")
        large_record, large_saved = _serialize_packet_bodies(
            {
                "url": "https://api.example.com/config.json",
                "method": "GET",
                "response_headers": {"Content-Type": "application/json"},
                "response_body": large_json,
            },
            10 * 1024 * 1024,
            20 * 1024 * 1024,
            inline_limit=1024,
            max_wasm_bytes=50 * 1024 * 1024,
            out_dir=out_dir,
            capture_index=7,
        )
        large_path = os.path.join(out_dir, large_record["response_body_saved_to"])
        with open(large_path, "rb") as f:
            assert f.read() == large_json, "大 JSON 外部落盘内容不完整"
        assert large_saved == len(large_json), "大 JSON 预算计数错误"
        assert large_record.get("response_body_complete") is True, "大 JSON 不应被标记为截断证据"
        assert large_record.get("response_body_preview_truncated") is True, "大 JSON 应仅截断 JSON 内预览"
        json.dumps(large_record, ensure_ascii=False)

        wasm_body = b"\x00asm\x01\x00\x00\x00" + (b"\xff" * (2 * 1024 * 1024))
        wasm_record, wasm_saved = _serialize_packet_bodies(
            {
                "url": "https://cdn.example.com/security/module.wasm",
                "method": "GET",
                "response_headers": {"Content-Type": "application/wasm"},
                "response_body": wasm_body,
            },
            10 * 1024 * 1024,
            20 * 1024 * 1024,
            inline_limit=1024,
            max_wasm_bytes=50 * 1024 * 1024,
            out_dir=out_dir,
            capture_index=8,
        )
        wasm_path = os.path.join(out_dir, wasm_record["response_body_saved_to"])
        with open(wasm_path, "rb") as f:
            assert f.read() == wasm_body, "WASM 必须完整逐字节落盘"
        assert wasm_path.endswith(".wasm") and wasm_saved == len(wasm_body), "WASM 路径或预算计数错误"
        assert wasm_record.get("response_body_file_type") == "wasm", "WASM 类型标记错误"
        assert wasm_record.get("response_body_complete") is True, "完整 WASM 被误标为截断"
        assert wasm_record.get("response_body_sha256") == hashlib.sha256(wasm_body).hexdigest(), "WASM SHA-256 错误"

        omitted_record, _ = _serialize_packet_bodies(
            {
                "url": "https://api.example.com/oversized.json",
                "method": "GET",
                "response_headers": {"content-type": "application/json"},
                "response_body": b"x" * 2048,
            },
            1024,
            4096,
            inline_limit=128,
            max_wasm_bytes=4096,
            out_dir=out_dir,
            capture_index=9,
        )
        assert omitted_record.get("response_body_complete") is False, "超单体上限 body 不应标记完整"
        assert omitted_record.get("response_body_omitted_reason") == "body-size-limit", "超限原因标记错误"
        assert not omitted_record.get("response_body_saved_to"), "超限 body 不应写入半包文件"

        budget_record, _ = _serialize_packet_bodies(
            {
                "url": "https://cdn.example.com/security/budget.wasm",
                "method": "GET",
                "response_headers": {"content-type": "application/wasm"},
                "response_body": wasm_body,
            },
            10 * 1024 * 1024,
            1024,
            inline_limit=128,
            max_wasm_bytes=50 * 1024 * 1024,
            out_dir=out_dir,
            capture_index=10,
        )
        assert budget_record.get("response_body_omitted_reason") == "total-budget", "总预算不足原因标记错误"
        assert not budget_record.get("response_body_saved_to"), "预算不足时禁止保存不可执行的 WASM 半包"

        import gzip
        decoded_payload = b'{"decoded":true}'
        decoded_record, _ = _serialize_packet_bodies(
            {
                "url": "https://api.example.com/compressed.json",
                "method": "GET",
                "response_headers": {"content-type": "application/json", "content-encoding": "gzip"},
                "response_body": gzip.compress(decoded_payload),
            },
            10 * 1024 * 1024,
            20 * 1024 * 1024,
            inline_limit=1024,
            max_wasm_bytes=50 * 1024 * 1024,
            out_dir=out_dir,
            capture_index=11,
        )
        assert decoded_record.get("response_body") == decoded_payload.decode("utf-8"), "压缩响应未保存解码 payload"
        assert decoded_record.get("response_body_content_decoded") == "gzip", "解码来源标记错误"
        assert decoded_record.get("response_body_sha256") == hashlib.sha256(decoded_payload).hexdigest(), "解码 payload 哈希错误"

        args = SimpleNamespace(
            case_subdir=os.path.join(root, "case"),
            out_dir=out_dir,
            url="https://example.com/login",
            no_related_bodies=False,
            body_inline_bytes=1024,
            max_related_packets=60,
            max_related_total_bytes=1024 * 1024,
            max_target_total_bytes=1024 * 1024,
            max_body_bytes=10 * 1024 * 1024,
            max_wasm_bytes=50 * 1024 * 1024,
        )
        classified = _classify_packets([_SelfTestPacket(r) for r in records], args, ["/login/submit"], [])
        _, _, target_hits, related_hits, _, _, _ = classified
        assert len(target_hits) == 2 and len(related_hits) == 2, "终态/前置材料分类错误"
        assert {h.get("related_reason") for h in related_hits} == {"flow-url"}, "关联材料原因标注错误"
        no_target = _classify_packets([_SelfTestPacket(r) for r in records], args, [], [])
        assert len(no_target[2]) == 0, "未指定 targets 时不应把所有包当成目标包"

        # ---- 断连探测 / partial 快照 / 信号中断 / 结束原因（收尾加固回归）----
        # 1) _browser_gone：驱动内部状态 introspection（零 RPC）
        dead_driver = SimpleNamespace(_is_running=False, _ws=SimpleNamespace(connected=False))
        dead_page = SimpleNamespace(_driver=SimpleNamespace(_browser_driver=dead_driver))
        assert _browser_gone(dead_page, {}) is True, "驱动 _is_running=False 应判定断连"
        live_driver = SimpleNamespace(_is_running=True, _ws=SimpleNamespace(connected=True))
        live_page = SimpleNamespace(_driver=SimpleNamespace(_browser_driver=live_driver))
        assert _browser_gone(live_page, {}) is False, "存活驱动不应误判断连"
        ws_dead_page = SimpleNamespace(_driver=SimpleNamespace(_browser_driver=SimpleNamespace(_is_running=True, _ws=SimpleNamespace(connected=False))))
        assert _browser_gone(ws_dead_page, {}) is True, "ws.connected=False 应判定断连"
        assert _browser_gone(None, {}) is True, "page 为 None 视为断连"

        # 2) _browser_gone：introspection 不可用时的心跳兜底（空 hb_state 首轮即探测）
        class _ProbePage:
            def __init__(self, exc=None):
                self._driver = SimpleNamespace()  # 无 _browser_driver
                self.browser = SimpleNamespace()  # 无 _driver
                self._exc = exc

            def run_js(self, *_a, **_k):
                if self._exc:
                    raise self._exc
                return 1
        assert _browser_gone(_ProbePage(Exception("PageDisconnectedError: 命令发送失败")), {}) is True, "心跳断连类异常应判定断连"
        assert _browser_gone(_ProbePage(Exception("invalid session id")), {}) is False, "非断连异常不应误判"
        assert _browser_gone(_ProbePage(), {}) is False, "心跳正常不应判定断连"

        # 3) partial 快照：抓包期间增量写出元数据，正常收尾后删除
        pkts = [_SelfTestPacket(r) for r in records[:3]]
        partial_path = _flush_partial(args, pkts)
        assert partial_path and os.path.exists(partial_path), "partial 快照应写入 out_dir"
        with open(partial_path, encoding="utf-8") as f:
            lines = [json.loads(l) for l in f if l.strip()]
        assert lines[0].get("_partial") is True and lines[0].get("packetCount") == 3, "partial 快照头行元数据错误"
        assert len(lines) == 4 and lines[1].get("url"), "partial 快照应包含全部包元数据"
        _write_outputs(args, "browser", records, [], [], None, "baseline-selftest", None)
        assert os.path.exists(os.path.join(args.out_dir, "capture.json")), "capture.json 应写出"
        assert not os.path.exists(partial_path), "正常收尾后应删除 partial 快照"

        # 4) _pid_alive：零值 PID 不存活、当前进程存活
        assert _pid_alive(0) is False, "PID=0 应判不存活"
        assert _pid_alive(os.getpid()) is True, "当前进程应判存活"

        # 5) 信号中断标志置位与复位
        _request_interrupt(15, None)
        assert _INTERRUPTED["reason"] == "signal-15", "信号中断标志未置位"
        _INTERRUPTED["reason"] = None

        # 6) 报告渲染结束原因（browser-closed 给出人类可读解释）
        md = render_markdown({"endReason": "browser-closed", "jsFileCount": 0})
        assert "结束原因：browser-closed" in md and "手动关闭" in md, "结束原因渲染缺失"

    print("forensic_ruyipage.py 自测通过：终态 OR、URL 匹配、多次终态回溯、完整 body/WASM 落盘、预算拒绝半包、分类落盘、断连探测、partial 快照、信号中断、结束原因渲染")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    if args.self_test:
        return run_self_test()

    ok, ver, err = detect_ruyipage()
    if not ok:
        msg = (
            "未检测到 ruyipage Python 包，无法执行取证。\n"
            f"错误：{err}\n"
            "请先安装：python -m pip install ruyiPage requests --upgrade"
        )
        if args.json:
            print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False, indent=2))
        else:
            print(msg)
        return 2

    browser_path, berr = resolve_browser(args)
    if berr:
        msg = f"ruyiPage 定制 Firefox 校验未通过：\n{berr}"
        if args.json:
            print(json.dumps({"ok": False, "error": msg, "ruyipageVersion": ver}, ensure_ascii=False, indent=2))
        else:
            print(msg)
        return 2

    plan = {
        "ruyipageVersion": ver,
        "browserPath": browser_path,
        "url": args.url,
        "outDir": args.out_dir,
        "profileDir": args.profile_dir,
        "fpDir": args.fp_dir,
        "headless": False,
        "humanAlgorithm": args.human_algorithm,
        "smartFingerprint": not args.no_fp,
        "targets": [s for s in args.targets.split(",") if s.strip()],
        "targetSettle": args.target_settle,
        "relatedBodies": not args.no_related_bodies,
        "bodyInlineBytes": args.body_inline_bytes,
        "maxBodyBytes": args.max_body_bytes,
        "maxWasmBytes": args.max_wasm_bytes,
        "maxTargetTotalBytes": args.max_target_total_bytes,
        "maxRelatedPackets": args.max_related_packets,
        "maxRelatedTotalBytes": args.max_related_total_bytes,
        "dryRun": args.dry_run,
    }

    if args.dry_run:
        out = {"ok": True, "plan": plan}
        if args.json:
            print(json.dumps(out, ensure_ascii=False, indent=2))
        else:
            print("# ruyiPage 取证计划（dry-run，不启动浏览器）")
            for k, v in plan.items():
                print(f"- {k}: {v}")
        return 0

    result = run_forensic(args, browser_path)
    target_substrings = [s.strip() for s in (args.targets or "").split(",") if s.strip()]
    target_regexes = [r.strip() for r in (args.targets_regex or "").split(",") if r.strip()]
    has_target_filter = bool(target_substrings or target_regexes)
    target_verified = result.get("acceptance") == "PASS"
    result["ok"] = (not has_target_filter) or target_verified
    result["ruyipageVersion"] = ver

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(render_markdown(result))
    if not result["ok"]:
        print(
            "[未通过] 取证终态未达成：指定了 --targets/--targets-regex，但未捕获到终态接口的非 OPTIONS 2xx 响应，"
            "Step 1 缺失。请重采（--click/--scroll/--manual-pause）或由用户提供 cURL/HAR/原始请求文本，"
            "不得转源码搜索。",
            file=sys.stderr,
        )
        return 1
    return 0


def render_markdown(r: Dict[str, Any]) -> str:
    L = ["# ruyiPage 取证报告", ""]
    L.append(f"- 目标：{r.get('url')}")
    L.append(f"- ruyipage 版本：{r.get('ruyipageVersion')}")
    L.append(f"- 浏览器：{r.get('browserPath')}")
    L.append(f"- 浏览器关闭状态：{r.get('browserClosed', 'unknown')}")
    end_reason_map = {
        "target-hit": "终态目标接口命中",
        "quiet-settle": "网络静默自动结束（未指定 --targets 的正常结束）",
        "wait-timeout": "--wait 超时收尾",
        "browser-closed": "浏览器被手动关闭/连接断开，已按手动结束立即收尾，数据已落盘",
        "wait-error": "capture.wait 连续异常，提前收尾",
    }
    er = r.get("endReason") or "unknown"
    extra = end_reason_map.get(er)
    L.append(f"- 结束原因：{er}" + (f"（{extra}）" if extra else ""))
    L.append(f"- baselineId：{r.get('baselineId')}")
    L.append(f"- 抓包总数：{r.get('packetCount')}")
    L.append(f"- JS 文件数：{r.get('jsFileCount')}")
    L.append(f"- 终态目标命中数：{r.get('targetHitCount')}（非 OPTIONS 2xx {r.get('acceptedTargetCount')}）")
    target_body = r.get("targetBodyCapture") or {}
    body_policy = r.get("bodyPolicy") or {}
    L.append(
        f"- body 策略：JSON 内联/预览 {body_policy.get('inlineBytes', 0)}B，普通单体 {body_policy.get('maxBodyBytes', 0)}B，"
        f"WASM 单体 {body_policy.get('maxWasmBytes', 0)}B"
    )
    L.append(
        f"- 终态 body：完整 {target_body.get('completeBytes', 0)}B，外部文件 {target_body.get('externalFileCount', 0)}，"
        f"未完整 {target_body.get('incompleteBodyCount', 0)}（总预算 {target_body.get('maxTotalBytes', 0)}B）"
    )
    related = r.get("relatedCapture") or {}
    L.append(
        f"- 关联动态材料：{r.get('relatedHitCount', 0)} 包，完整 {related.get('completeBytes', 0)}B，"
        f"外部文件 {related.get('externalFileCount', 0)}，未完整 {related.get('incompleteBodyCount', 0)}"
        f"（候选 {related.get('candidateCount', 0)}，总预算 {related.get('maxTotalBytes', 0)}B）"
    )
    doc = r.get("entryDocument")
    if doc:
        L.append(f"- 入口页面：{doc.get('saved_to')}（{doc.get('size')}B，状态 {doc.get('status')}）")
    else:
        L.append("- 入口页面：未捕获到 HTML 文档（纯 API 目标或无 text/html 响应属正常）")
    L.append(f"- JS 落盘质量：{r.get('jsQuality')}（{r.get('jsFileCount') - r.get('jsMissingCount', 0)}/{r.get('jsFileCount')} 完整）")
    L.append(f"- navigator.webdriver 自检：{r.get('navigatorWebdriverSelfCheck')}")
    if r.get("jsQuality") == "FAIL":
        L.append("- [警告] JS 落盘 0B 比例过高（≥50%），取证质量不达标：gzip/br 大 JS 响应体未拿回，无法用于定位分析，必须重采或补采 JS。")
    elif r.get("jsQuality") == "WARN":
        L.append("- [警告] 部分 JS 落盘缺失（0B）：以下 JS 未拿到响应体，定位关键资源时注意补采。")
    if r.get("getTimedOut"):
        L.append("- [警告] page.get 超时（页面 load 未完成），但已捕获流量并已落盘；验收以实际抓包为准，非取证失败")
    incomplete_bodies = target_body.get("incompleteBodyCount", 0) + related.get("incompleteBodyCount", 0)
    if incomplete_bodies:
        L.append(f"- [警告] 有 {incomplete_bodies} 个 body 因单体上限或总预算未完整保存；JSON 已标注 omitted_reason，分析前应调大对应参数重采")
    L.append(f"- 取证验收：{r.get('acceptance')}")
    if r.get("acceptance") in ("NO_TARGET", "PARTIAL"):
        L.append("")
        L.append("[未通过] 终态目标未达成：指定 --targets/--targets-regex 后未捕获到终态接口的非 OPTIONS 2xx 响应（Step 1 缺失）。")
        L.append("请重采（--click/--scroll/--manual-pause）或由用户提供 cURL/HAR/原始请求文本，不得转源码搜索。")
    if r.get("onlyOptionsWarning"):
        L.append(f"- [警告] 仅捕获到 OPTIONS 预检，未捕获真实业务响应：{r['onlyOptionsWarning']}")
    if r.get("webdriverCheckError"):
        L.append(f"- webdriver 检查错误：{r['webdriverCheckError']}")
    L.append("")
    L.append("## 目标接口命中")
    if r.get("targetHitsSummary"):
        for h in r["targetHitsSummary"]:
            L.append(f"- `{h.get('method')} {h.get('status')}` {h.get('url')}")
    else:
        L.append("- 无（未指定终态 --targets 或没有命中）")
    L.append("")
    L.append("## JS 文件")
    if r.get("jsFiles"):
        for j in r["jsFiles"]:
            extra = f"  sourceMappingURL={j['source_mapping_url']}" if j.get("source_mapping_url") else ""
            L.append(f"- {j.get('saved_to')} ({j.get('size')}B){extra}  {j.get('url')}")
    else:
        L.append("- 无")
    L.append("")
    L.append("## 输出")
    out = r.get("outputs", {})
    L.append(f"- 全部抓包：{out.get('captureJson')}")
    L.append(f"- 目标命中：{out.get('targetHitsJson')}")
    L.append(f"- 关联材料：{out.get('relatedHitsJson')}")
    L.append(f"- 完整 body 目录：{out.get('bodyDir')}")
    L.append(f"- 完整 WASM 目录：{out.get('wasmDir')}")
    if doc:
        L.append(f"- 入口页面：{doc.get('saved_to')}")
    L.append(f"- JS 目录：{out.get('jsDir')}")
    if out.get("fingerprintBaseline"):
        L.append(f"- 指纹基线：{out.get('fingerprintBaseline')}")
    L.append("")
    if r.get("navigatorWebdriverSelfCheck") == "FAIL":
        L.append("[警告] navigator.webdriver 为 true，本次取证不合格（疑似被识别为自动化）。")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    sys.exit(main())
