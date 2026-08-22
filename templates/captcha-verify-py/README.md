# captcha-verify-py 验证码逆向交付骨架（Python 版）

验证码逆向通用骨架（load → solve → verify 三段链路 + 业务接口消费凭据），Python 版。
与 `captcha-verify/`（Node 版）的区别：solver 直接 `import ddddocr`，答案层工具链原生可用，无需跨语言桥接。

本目录只提供接口骨架，不内置任何真实平台协议。厂商、版本、接口顺序、HTTP 方法、JSONP、字段名、加密和成功凭据都必须从本 case 的抓包与 RuyiTrace 证据实现到 `result/src/adapter.py`。

## 何时选 Python 版

- 答案层用 ddddocr / OpenCV / Whisper（均为 Python 生态）→ **选 Python 版**
- 答案层走 A 参数解密 / B 像素提取，且封装层加密逻辑已用 Python 还原 → 选 Python 版
- 封装层加密逻辑只在 Node 侧还原（vm 沙箱/JS 执行）→ 选 Node 版

## 文件清单

| 文件 | 作用 |
|------|------|
| `final.py` | 唯一执行入口（带 `__main__` 守卫）：完整链路自验 + 可被 import 调用 |
| `config.json` | 外置配置（目标页、case 标识和 solver 配置；不预填平台接口） |
| `requirements.txt` | 依赖契约（curl_cffi + ddddocr + opencv + pillow + numpy） |

## 使用方式

1. IMPLEMENT 编码时复制到 `result/`：
   ```
   cp templates/captcha-verify-py/final.py result/
   cp templates/captcha-verify-py/config.json result/
   cp templates/captcha-verify-py/adapter_example.py result/src/adapter.py
   cp templates/captcha-verify-py/requirements.txt result/
   ```
2. 从 `templates/python-request/client.py` 复制 TLS 客户端到 `result/src/request/client.py`
3. 实现 `result/src/adapter.py`，至少提供 `load_challenge`、`resolve_assets`、`prepare_answer`、`build_verify_request`、`parse_verify_response`、`consume_credential`
4. 实现 `result/src/solver.py`（答案求解：`solve(image_bytes, captcha_type, options)` → answer dict，参考 `references/captcha/captcha-solving-handoff.md`）
5. 轨迹生成或行为构造由 adapter / solver 按本 case 证据决定，不使用默认通用轨迹冒充真实协议

## 三段链路结构

```
final.py（唯一执行入口）
  ├── ① adapter.load_challenge()   → 按本 case 证据完成 bootstrap/load 链
  │     └── result/src/request/client.py（TLS 客户端，复制自 python-request/）
  ├── ② solve_captcha()    → 下载素材 → 本地求解 → answer JSON（含 offset/points/track/challenge_binding）
  │     ├── result/src/solver.py（ddddocr / OpenCV / 打码平台适配器，直接 import ddddocr）
  │     └── result/src/track.py（轨迹生成，slider/drag-drop/scratch/trace）
  ├── ③ adapter.build_verify_request() → 按本 case 原始请求语义构造 verify 请求
  │     └── adapter.parse_verify_response() → 按本 case 响应格式解析凭据
  └── ④ adapter.consume_credential() → 业务接口消费凭据
```

## solver.py 示例（ddddocr 直接调用）

```python
import ddddocr

_det = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)

def solve(image_bytes, captcha_type, options=None):
    options = options or {}
    slice_bytes = options.get("slice")
    if captcha_type == "slider" and slice_bytes:
        res = _det.slide_match(slice_bytes, image_bytes)
        # res['target'] = [x1, y1, x2, y2]（bbox），x1 即缺口左边缘 x（官方 README 返回格式）
        x = res["target"][0]
        return {
            "captcha_type": "slider",
            "solver": "ddddocr-slide_match",
            "confidence": 0.9,
            "coordinate_space": "image-pixel",
            "offset": {"x": x, "y": None, "angle": None},
            "points": [],
        }
    raise ValueError(f"不支持的题型: {captcha_type}")
```

## answer JSON 契约

`solve_captcha()` 返回的 answer dict 必须符合 `references/captcha/captcha-overview.md` 的接口契约（`source_image_size` 必填，缺了会被 `check_captcha_answer.js` 判 FAIL）。
交付前跑 `node scripts/check_captcha_answer.js --file answer.json` 校验。

## 注意

- challenge 一次性：每次验证必须从 load 重新走，禁止复用旧 challenge
- 素材下载用与业务请求一致的 TLS 指纹客户端 + Session cookie（部分厂商素材 URL 绑 Session）
- 凭据形态按 case 不同，由 adapter 按证据实现
- 没有 adapter 时模板必须失败，不得猜测平台协议或把示例字段当作通用字段
- config.json 与 Node 版完全一致，同一份配置可互换两版交付物
