"""
Python TLS 指纹兼容客户端模板

支持三种客户端（按优先级）：
    1. curl_cffi（impersonate Chrome/Firefox，JA3/JA4/Akamai 对齐最完善）
    2. cffi_curl（curl_cffi 的 CFFI 封装，性能更好）
    3. cyCronet（基于 Chromium Cronet，HTTP/2 + QUIC 支持）

硬性要求：
    - Session 模式：同一 session 复用 Cookie jar / TLS 上下文
    - final.py 中必须使用 create_request_session + try-finally close
    - 不得使用普通 requests / httpx / urllib3 发送最终业务请求
    - 仅用于授权范围内的少量最终验证请求，不用于批量访问
    - 【默认强制】默认向真实 API 发请求验证（≥5 次交叉验证），仅当用户明确说"只输出参数"时才用 --sign-only 跳过
"""

from __future__ import annotations

import json
import logging
import time
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 客户端检测：按优先级选择可用的 TLS 兼容客户端
# ============================================================
def detect_available_client() -> str:
    """检测可用的 TLS 指纹兼容客户端，返回客户端名称。"""
    # 1. curl_cffi（推荐）
    try:
        from curl_cffi import requests as curl_requests  # noqa: F401
        return "curl_cffi"
    except ImportError:
        pass

    # 2. cffi_curl
    # 注意: cffi_curl 这个包名可能不存在于 PyPI,通常需要手动安装或从源码编译。
    # 若不可用,可改用 curl_cffi 作为替代(上面的分支已检测 curl_cffi)。
    try:
        import cffi_curl  # noqa: F401
        return "cffi_curl"
    except ImportError:
        pass

    # 3. cyCronet
    try:
        import cyCronet  # noqa: F401
        return "cyCronet"
    except ImportError:
        pass

    raise ImportError(
        "未检测到 TLS 指纹兼容客户端，请安装其一：\n"
        "  pip install curl_cffi   # 推荐\n"
        "  pip install cffi_curl\n"
        "  pip install cyCronet"
    )


# ============================================================
# CookieJar：与 Node 版 client.js 的 CookieJar 接口对齐（含属性解析与过期清理）
# ============================================================
class CookieJar:
    """
    Cookie Jar，与 templates/node-request/client.js 的 CookieJar 接口对齐。

    提供：
        - set(name, value, domain='', path='/', expires=None)  添加/覆盖单条 cookie（已过期则删除）
        - get(name, domain='')                   读取单条 cookie 值（过期自动清理）
        - delete(name, domain='')                删除单条 cookie
        - merge(set_cookie_headers, domain='')   从 Set-Cookie 响应头批量合并（解析 Domain/Path/Max-Age/Expires；
                                                  Max-Age<=0 或 Expires 已过期 → 删除语义）
        - to_string(domain='')                   生成请求 Cookie 头字符串（过滤已过期条目）
        - to_dict(domain='')                     转为 dict（用于调试）
        - cookies                                属性：Dict[str, dict] 存储

    与 Node 版差异：
        - Python 版 cookies 是 dict（key = "domain:name"），Node 版是 Map
        - length 用 len(jar)，Node 版用 .size
    """

    def __init__(self) -> None:
        # key: "domain:name", value: {"value": str, "domain": str, "path": str, "expires": float|None(epoch 秒)}
        self.cookies: Dict[str, Dict[str, Any]] = {}

    def set(self, name: str, value: str, domain: str = "", path: str = "/", expires: Optional[float] = None) -> None:
        key = f"{domain}:{name}"
        if expires is not None and expires <= time.time():
            self.cookies.pop(key, None)
            return
        self.cookies[key] = {"value": value, "domain": domain, "path": path, "expires": expires}

    def get(self, name: str, domain: str = "") -> Optional[str]:
        key = f"{domain}:{name}"
        entry = self.cookies.get(key)
        if not entry:
            return None
        if entry["expires"] is not None and entry["expires"] <= time.time():
            self.cookies.pop(key, None)
            return None
        return entry["value"]

    def delete(self, name: str, domain: str = "") -> None:
        self.cookies.pop(f"{domain}:{name}", None)

    def merge(self, set_cookie_headers: Any, domain: str = "") -> None:
        """从响应头 set-cookie（单条 str 或 List[str]）批量合并，解析属性并处理删除语义。"""
        if not set_cookie_headers:
            return
        if isinstance(set_cookie_headers, (list, tuple)):
            items: List[str] = [str(i) for i in set_cookie_headers]
        else:
            items = [str(set_cookie_headers)]

        for item in items:
            # set-cookie 头形如: "name=value; Path=/; Max-Age=3600; HttpOnly"
            parts = [p.strip() for p in item.split(";")]
            pair = parts[0]
            if "=" not in pair:
                continue
            name, value = pair.split("=", 1)
            name, value = name.strip(), value.strip()
            if not name:
                continue

            cookie_domain = domain
            path = "/"
            expires: Optional[float] = None
            expired = False
            for raw in parts[1:]:
                attr_eq = raw.find("=")
                attr_name = (raw if attr_eq < 0 else raw[:attr_eq]).strip().lower()
                attr_value = "" if attr_eq < 0 else raw[attr_eq + 1:].strip()
                if attr_name == "domain" and attr_value:
                    cookie_domain = attr_value.lstrip(".").lower()
                elif attr_name == "path" and attr_value:
                    path = attr_value
                elif attr_name == "max-age":
                    try:
                        seconds = int(attr_value)
                    except ValueError:
                        continue
                    if seconds <= 0:
                        expired = True
                    else:
                        expires = time.time() + seconds
                elif attr_name == "expires" and attr_value:
                    try:
                        dt = parsedate_to_datetime(attr_value)
                    except (TypeError, ValueError):
                        continue
                    ts = dt.timestamp()
                    if ts <= time.time():
                        expired = True
                    else:
                        expires = ts
                # Secure / HttpOnly / SameSite：纯协议请求层无需特殊处理，忽略

            if expired:
                self.delete(name, cookie_domain)
                continue
            self.set(name, value, cookie_domain, path=path, expires=expires)

    def to_string(self, domain: str = "") -> str:
        """生成请求 Cookie 头字符串（与 Node 版 toString 对齐；过滤已过期条目）。"""
        now = time.time()
        items: List[str] = []
        for key in list(self.cookies.keys()):
            c = self.cookies[key]
            if c["expires"] is not None and c["expires"] <= now:
                del self.cookies[key]
                continue
            if not domain or c["domain"] == domain or key.endswith(f":{domain}"):
                name = key.split(":", 1)[-1]
                items.append(f"{name}={c['value']}")
        return "; ".join(items)

    def to_dict(self, domain: str = "") -> Dict[str, str]:
        now = time.time()
        result: Dict[str, str] = {}
        for key in list(self.cookies.keys()):
            c = self.cookies[key]
            if c["expires"] is not None and c["expires"] <= now:
                del self.cookies[key]
                continue
            if not domain or c["domain"] == domain or key.endswith(f":{domain}"):
                name = key.split(":", 1)[-1]
                result[name] = c["value"]
        return result

    def __len__(self) -> int:
        return len(self.cookies)

    def __repr__(self) -> str:
        return f"CookieJar({len(self)} cookies)"


# ============================================================
# Session 工厂：创建 TLS 指纹兼容会话
# ============================================================
def create_request_session(
    impersonate: str = "chrome135",
    user_agent: Optional[str] = None,
    headers: Optional[Dict[str, str]] = None,
    proxy: Optional[str] = None,
    follow_redirects: bool = True,
    timeout: int = 30,
) -> "RequestSession":
    """
    创建请求 Session。

    Args:
        impersonate: 目标浏览器指纹（curl_cffi 支持 chrome/firefox/safari 等）
        user_agent: 自定义 UA（必须与签名用 UA 一致）
        headers: 默认 Header
        proxy: 代理地址
        follow_redirects: 是否跟随重定向
        timeout: 超时秒数

    Returns:
        RequestSession 实例
    """
    client_name = detect_available_client()

    final_headers = {
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    if headers:
        final_headers.update(headers)
    if user_agent:
        final_headers["User-Agent"] = user_agent

    if client_name == "curl_cffi":
        from curl_cffi import requests as curl_requests

        session = curl_requests.Session(
            impersonate=impersonate,
            headers=final_headers,
            proxies={"http": proxy, "https": proxy} if proxy else None,
            timeout=timeout,
            allow_redirects=follow_redirects,
        )
        return RequestSession(session, client_name, impersonate)

    elif client_name == "cffi_curl":
        import cffi_curl

        session = cffi_curl.Session(
            impersonate=impersonate,
            headers=final_headers,
            proxy=proxy,
            follow_redirects=follow_redirects,
            timeout=timeout,
        )
        return RequestSession(session, client_name, impersonate)

    else:  # cyCronet
        import cyCronet

        # cyCronet 基于 Chromium Cronet，不支持 impersonate 参数，使用其内置指纹
        session = cyCronet.Session(
            headers=final_headers,
            proxy=proxy,
            follow_redirects=follow_redirects,
            timeout=timeout,
        )
        return RequestSession(session, client_name, impersonate)


# ============================================================
# RequestSession 包装类（统一接口）
# ============================================================
class RequestSession:
    """统一封装三种 TLS 兼容客户端，对外暴露 request/get/post 方法。"""

    def __init__(self, raw_session, client_name: str, impersonate: str):
        self._raw = raw_session
        self._client_name = client_name
        self._impersonate = impersonate
        self._closed = False
        self._defaults: Dict[str, Any] = {}

    @property
    def client_name(self) -> str:
        return self._client_name

    @property
    def impersonate(self) -> str:
        return self._impersonate

    def defaults(self, **kwargs) -> "RequestSession":
        """设置默认请求参数（如 jar=CookieJar() 实现 Cookie 自动携带与合并）。"""
        self._defaults.update(kwargs)
        return self

    def request(
        self,
        method: Any = None,
        url: Any = None,
        **kwargs,
    ) -> "Response":
        """
        发送请求。支持两种调用形态：

            session.request(method, url, **kwargs)              —— 常规形式
            session.request({"method": ..., "url": ...})        —— 原始请求描述符
                描述符顶层键即请求字段（headers/params/data/json/body/timeout/jar 等）；
                adapter 契约的 {"method", "url", "opts"} 嵌套形式同样支持，
                可直接透传 trace/抓包导出的请求描述。body 映射为原始请求体。

        Cookie 生命周期：kwargs 或 defaults 传入 jar 时自动携带 Cookie（显式 Cookie 头优先），
        响应后自动合并 Set-Cookie（含 Domain/Max-Age/Expires 属性与删除语义）。
        """
        if self._closed:
            raise RuntimeError("Session 已关闭")

        if isinstance(method, dict) and url is None:
            descriptor = dict(method)
            method = descriptor.pop("method", None)
            url = descriptor.pop("url", None)
            opts = descriptor.pop("opts", None)
            if isinstance(opts, dict):
                descriptor.update(opts)
            if "body" in descriptor:
                descriptor["data"] = descriptor.pop("body")
            if "json" in descriptor:
                descriptor["json_body"] = descriptor.pop("json")
            # 显式 kwargs 优先于描述符同名字段
            for key, val in kwargs.items():
                descriptor[key] = val
            kwargs = descriptor

        if "body" in kwargs:
            kwargs["data"] = kwargs.pop("body")

        jar = kwargs.pop("jar", None) or self._defaults.get("jar")

        # Cookie 生命周期：请求带 jar 时自动携带（显式 Cookie 头优先）
        headers = dict(kwargs.get("headers") or {})
        if jar is not None and hasattr(jar, "to_string"):
            if not (headers.get("Cookie") or headers.get("cookie")):
                auto_cookie = jar.to_string()
                if auto_cookie:
                    headers["Cookie"] = auto_cookie
        kwargs["headers"] = headers

        request_kwargs: Dict[str, Any] = {}
        for key in ("headers", "params", "data", "json", "timeout"):
            if key in kwargs and kwargs[key] is not None:
                request_kwargs[key] = kwargs[key]
        if "json_body" in kwargs and kwargs["json_body"] is not None:
            request_kwargs["json"] = kwargs["json_body"]

        raw_res = self._raw.request(method.upper(), url, **request_kwargs)
        response = Response(raw_res)

        # Cookie 生命周期：响应后自动合并 Set-Cookie
        if jar is not None and hasattr(jar, "merge"):
            set_cookies = response.set_cookies()
            if set_cookies:
                jar.merge(set_cookies)
        return response

    def get(self, url: str, **kwargs) -> "Response":
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> "Response":
        return self.request("POST", url, **kwargs)

    def close(self):
        """关闭 Session，释放 TLS 上下文和连接池。"""
        if not self._closed:
            try:
                self._raw.close()
            except Exception as e:
                logger.warning(f"关闭 session 异常: {e}")
            self._closed = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


# ============================================================
# Response 包装类
# ============================================================
class Response:
    """统一封装响应，对外暴露 status/headers/body/text/json/set_cookies。"""

    def __init__(self, raw_response):
        self._raw = raw_response
        self.status_code: int = getattr(raw_response, "status_code", 0)
        self.headers: Dict[str, str] = dict(getattr(raw_response, "headers", {}) or {})
        self._body: bytes = getattr(raw_response, "content", b"") or b""
        self._text_cache: Optional[str] = None
        self._set_cookies: List[str] = self._extract_set_cookies(raw_response)

    @staticmethod
    def _extract_set_cookies(raw_response) -> List[str]:
        """提取全部 Set-Cookie 值（多条头并存时尽量取全，供 CookieJar.merge 使用）。"""
        raw_headers = getattr(raw_response, "headers", None)
        if raw_headers is None:
            return []
        for getter_name in ("get_list", "getlist"):
            getter = getattr(raw_headers, getter_name, None)
            if callable(getter):
                try:
                    values = getter("set-cookie")
                    if values:
                        return [str(v) for v in values]
                except Exception:
                    pass
        for key in ("set-cookie", "Set-Cookie"):
            value = raw_headers.get(key) if hasattr(raw_headers, "get") else None
            if value:
                return [str(value)] if isinstance(value, str) else [str(v) for v in value]
        return []

    @property
    def body(self) -> bytes:
        return self._body

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300

    def set_cookies(self) -> List[str]:
        """返回全部 Set-Cookie 原始值列表。"""
        return list(self._set_cookies)

    def text(self, encoding: str = "utf-8") -> str:
        if self._text_cache is None:
            self._text_cache = self._body.decode(encoding, errors="replace")
        return self._text_cache

    def json(self) -> Any:
        return json.loads(self.text())


# ============================================================
# 使用示例（在 final.py 中引用）
# ============================================================
#
# from client import create_request_session, CookieJar
#
# def main():
#     session = create_request_session(
#         impersonate="chrome135",
#         user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...",
#     )
#     jar = CookieJar()
#     # Cookie 生命周期交给请求层：自动携带、自动合并 Set-Cookie（含 Domain/Max-Age/Expires 属性与删除语义）
#     session.defaults(jar=jar)
#     try:
#         # 1. 访问主页刷新 Cookie（无需手动拼 Cookie 头）
#         session.get("https://example.com/")
#
#         # 2. 调用前置接口（需要手动控制 Cookie 时仍可显式传 headers={"Cookie": ...} 覆盖）
#         init = session.get("https://example.com/api/init")
#         secret_key = init.json().get("secretKey")
#
#         # 3. 生成签名
#         sign = generate_sign({"ts": int(time.time() * 1000)}, secret_key)
#
#         # 4. 发送目标请求（常规形式 / 原始请求描述符两种形态等价）
#         res = session.get(
#             "https://example.com/api/search",
#             headers={"x-sign": sign},
#         )
#         res2 = session.request({                  # 描述符形态：与 adapter 契约一致，
#             "method": "GET",                      # 可直接透传 trace 导出的请求描述
#             "url": "https://example.com/api/search",
#             "opts": {"headers": {"x-sign": sign}},
#         })
#         print(res.json())
#     finally:
#         session.close()
#
# if __name__ == "__main__":
#     main()


if __name__ == "__main__":
    # 自检：检测可用客户端 + CookieJar 生命周期（属性解析/过期删除）
    try:
        name = detect_available_client()
        print(f"检测到可用 TLS 客户端：{name}")
    except ImportError as e:
        print(str(e))
    jar = CookieJar()
    jar.merge([
        "sessionid=abc123; Path=/; Max-Age=3600",
        "token=xyz; HttpOnly",
        "dropme=1; Path=/; Max-Age=0",                        # 删除语义
        "expired=1; Expires=Thu, 01 Jan 1970 00:00:00 GMT",   # 已过期 → 删除
    ])
    assert jar.get("sessionid") == "abc123"
    assert jar.get("dropme") is None
    assert jar.get("expired") is None
    print(f"CookieJar 测试: {jar} -> {jar.to_string()!r}")
