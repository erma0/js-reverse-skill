# 最终请求验证与 TLS 指纹兼容

本文件在新 case 需要最终发送真实请求、交付 `final.js` / `final.py`，或用户提到 CycleTLS、impers、curl-cffi-node、curl_cffi、cffi_curl、cyCronet 时读取。TLS 指纹兼容客户端从前置阶段开始自动探测（Node curl-cffi-node → impers → Python curl_cffi / cffi_curl），也不要求用户选择；最终请求一律使用 Session 模式。

**与规则 27「三级客户端阶梯」的关系（match19 修订）**：探测提前做（保证需要时客户端可用），**是否使用由阶梯判定**——普通客户端（Node 默认栈 / curl / requests）通过验证时按**最低可用栈**直接交付，不上指纹伪装（少依赖、少一个可被指纹检测与档位过期的伪装面，match19 即普通 requests 交付）；只有阶梯判定进入第三级（浏览器指纹白名单：普通栈全拒、指纹客户端通过）时，指纹客户端才成为交付客户端。"不要等失败后才临时切换"指的是**可用性探测与安装**要提前，不是要求所有站点一律用指纹客户端发请求。

## 使用边界

- 只用于用户授权范围内的网页端 JS 补环境结果验证。
- 只做低频、最小化请求，优先复现用户已提供的成功 cURL / HAR。
- TLS 指纹兼容只解决普通 HTTP 客户端与浏览器在 TLS ClientHello、ALPN、HTTP/2、JA3/JA4、Cronet / curl-impersonate 网络栈上的差异；不能替代登录态、验证码、一次性 token、设备校验或业务授权。
- 最终真实请求必须写入一体化 `final.js` 或 `final.py`，由 Node.js / Python TLS 指纹兼容 Session 客户端直接发起；不得生成加密参数后再使用 ruyiPage、Playwright、Puppeteer、Selenium 或其他浏览器自动化验证。

## 前置阶段自动探测客户端

在 GATE-0 意图声明时，加入以下字段：

```markdown
- 最终请求 TLS 指纹兼容客户端：Node.js CycleTLS / Node.js impers / Node.js curl-cffi / curl-cffi-node / Python curl_cffi / Python cffi_curl / Python cyCronet / 不发真实请求
- 最终请求 Session 模式：一律启用 / 不发真实请求
- 是否已安装：是 / 否 / 待检测
- 若未安装：自动安装优先客户端（默认）/ 按交付语言降级说明 / 不发真实请求
```

选择后立即检测：

```bash
node scripts/check_tls_clients.js --markdown
node scripts/check_tls_clients.js --python python --markdown
```

如果当前可用的 TLS 指纹兼容库未安装，而本 case 阶梯判定**已需要**指纹客户端（普通栈被拒、疑似浏览器指纹白名单），不要默认退回普通 `fetch` / `requests` 硬试已证明会拒的站点。默认自动安装优先客户端（Node curl-cffi-node / Python curl_cffi）；安装失败时才报告阻塞或按交付语言降级说明，不要求用户选择。普通客户端可通过的站点（阶梯第二级）无需安装，直接普通客户端交付。

## 工具选择

| 运行环境 | 可选工具 | 适用场景 |
|---|---|---|
| Node.js | CycleTLS / cycletls / @luminati-io/cycletls | 需要在 Node.js `final.js` 中指定 JA3 / User-Agent / Header 并发起少量验证请求 |
| Node.js | impers | Node.js curl-impersonate 路线；需要浏览器 TLS / JA3 / HTTP2/HTTP3 指纹时优先考虑 |
| Node.js | curl-cffi-node / curl-cffi | Node.js 侧 curl_cffi / curl-impersonate 路线；需要用 Node.js 维持 session 与 Cookie jar 时可选 |
| Python | curl_cffi / cffi_curl | Python curl-impersonate 路线；常用于 Chrome / Firefox / Safari impersonate |
| Python | cyCronet / cycronet | Python Cronet-Cloak / Chromium 网络栈路线；适合需要 Chrome 系网络栈特征时 |
| 不发真实请求 | 无 | 只交付本地参数生成结果，不进行最终接口验证 |

注意：不同机器安装包名、导入名、版本和 API 可能不同。先运行检测脚本，不要在 Skill 中硬编码本机路径或版本。库 API 变动时，以本机安装版本的 README / 官方文档为准。

## 安装提示

默认自动安装优先客户端（Node curl-cffi-node / Python curl_cffi），不要求用户选择；执行前先输出一行宣布安装内容（B 档宣布 + 可打断）。环境配置流程参见 `workflow/phase-flow.md` 的 nextRequiredInput 模式。

```bash
# Node.js
npm install cycletls
npm install @luminati-io/cycletls
npm install impers
npm install curl-cffi

# Python
python -m pip install curl_cffi
python -m pip install cffi_curl
python -m pip install cycronet
```

## 高强度网络指纹一致性

### 用户 cURL 与取证 baseline 的网络指纹优先级

用户提供的 cURL / HAR 不一定来自最终取证浏览器。最终请求代码必须优先对齐"已确认取证 baseline"，而不是无条件复用用户 cURL 中的 UA、Client Hints、Header、Cookie 或 TLS 线索。

硬性规则：

- 前置阶段必须识别用户 cURL 样本浏览器族和取证 baseline 浏览器族。
- 如果两者一致，仍需确认 Header、TLS / HTTP2、Cookie jar 和代理 / 地区是否属于同一会话链路。
- 如果两者不一致，默认以取证 baseline 为准；cURL 只作为请求结构、参数位置、业务字段和历史现象线索。
- Chrome cURL 与 Firefox 取证冲突时，不得在 Firefox baseline 的最终请求中保留 Chrome `sec-ch-ua`、`sec-ch-ua-platform`、`sec-ch-ua-mobile`，也不得只修改 UA 后继续使用 Chrome TLS / HTTP2 profile。
- 最终 `final.js` / `final.py` 的 UA、Accept-Language、Client Hints、Header 顺序、TLS / JA3 / JA4、HTTP/2 Akamai 指纹、Cookie jar 和代理必须来自同一取证 baseline 或经过重新取证确认。
- cURL 中已有的 sign、token、Cookie challenge 值只能作为 fixture / 历史线索；最终项目必须通过补环境后的 signer 和同一 session 请求链生成或刷新。
- 冲突记录必须写入 `case/notes/sample-baseline-conflict.md`、`case/notes/final-request-validation.md` 和最终总结。
- 如果用户坚持沿用 cURL 浏览器族，则暂停最终请求验证，要求使用同浏览器族取证工具重新采样 baseline，或让用户明确接受风险；风险确认不得替代成功验证。

高强度检测中，TLS 指纹兼容不是单独开关，而是要与浏览器取证 baseline 一起看。最终请求前必须核对：

- TLS / JA3 / JA4、ALPN、HTTP/2 / HTTP/3 能力与所选 impersonate 浏览器族一致。
- `User-Agent` 与 `navigator.userAgent` 一致。
- `sec-ch-ua`、`sec-ch-ua-platform`、`sec-ch-ua-mobile` 与 `navigator.userAgentData` 一致；取证浏览器是 Firefox 时不要伪造 Chrome Client Hints。
- `Accept-Language` 与 `navigator.language/languages` 一致。
- `Accept-Encoding`、Header 顺序、HTTP/2 pseudo-header 顺序、`sec-fetch-*`、`Referer`、`Origin` 与 HAR / 浏览器请求链一致。
- 代理 / IP / 地区、timezone、locale、WebRTC 策略与 fingerprint baseline 一致。
- Cookie jar 和 Storage 状态来自同一 session 链路，不复制旧 cURL 中已过期的风控状态。

如果以上任一项冲突，先修正请求链和 fixture，不要把失败直接归因于 JS 补环境。

## Firefox baseline 与 curl_cffi TLS 指纹对齐

当取证浏览器 baseline 是 Firefox（例如 ruyiPage 定制 Firefox、用户手动 Firefox 或其他 Firefox 系取证工具），而最终请求客户端选择 Python `curl_cffi` / Node.js `curl-cffi-node` 时，不得仅凭 `impersonate="firefox147"`、`impersonate="firefox"` 或修改 `User-Agent` 就宣称与取证浏览器一致。Firefox 版本标签只是 curl_cffi 支持的预设 profile 名称，真实是否兼容必须以当前 case 的浏览器 TLS / HTTP2 采样证据为准。

### 硬性流程

1. 先按 `fingerprint/fingerprint-baseline-consistency.md` 固化当前 case 的 Firefox 指纹基线，记录 `baselineId`、取证工具、profile / seed、代理、语言、时区、UA、Header 和浏览器路径摘要。
2. 使用已确认的取证工具在同一 baseline 下访问 TLS 指纹检测端点，建议至少采样：
   - `https://tls.peet.ws/api/all`
   - `https://tls.browserleaks.com/json`
3. 记录真实 Firefox baseline 的 `ja3`、`ja3_hash`、`ja3n_hash`、`ja4`、cipher suites、extension 顺序、supported groups / curves、signature algorithms、delegated credentials、record size limit、key_share、ALPN、HTTP/2 Akamai fingerprint、UA 和请求头。
4. 再用 curl_cffi 的候选 profile（例如 `firefox147` 或当前 `firefox` alias）访问同一端点并对比。
5. 如果裸 profile 与 Firefox baseline 不一致，不允许只改 UA 后继续；必须尝试通过 `ja3`、`akamai`、`extra_fp`、`curl_options` 和 HTTP Header 对齐。
6. 对齐后再次访问检测端点，只有 `ja3_hash`、`ja3n_hash`、`ja4`、HTTP/2 Akamai fingerprint、关键 TLS 字段和 UA / Header 与 baseline 一致或经过用户确认可接受等价时，才允许进入最终请求验证。
7. 对齐配置必须写入 `case/notes/final-request-validation.md` 和最终总结；如果仍不一致，必须暂停、换客户端或记录用户明确接受的风险，不得伪造成功。

### 必须对比的字段

- TLS：`ja3`、`ja3_hash`、`ja3n_hash`、`ja4`、TLS version、cipher suites 列表和顺序、TLS extensions 列表和顺序、supported groups / curves、signature algorithms、delegated credentials、record size limit、key_share 数量和顺序、ALPN、ECH / certificate compression 等扩展摘要。
- HTTP/2：Akamai fingerprint、settings、window update、streams、pseudo-header 顺序。
- HTTP Header：`User-Agent`、`Accept`、`Accept-Language`、`Accept-Encoding`、`Referer`、`Origin`、`Sec-Fetch-*`、Header 顺序和大小写。
- Session 与环境：Cookie jar、代理 / IP、timezone、locale、`navigator.userAgent`、`navigator.language/languages`、Firefox 不应伪造 Chrome UA-CH。

### curl_cffi Firefox 对齐模板

以下模板用于"Firefox baseline 已采样，且确认 curl_cffi 裸 profile 不一致"时的对齐。示例中的具体值来自某次 ruyiPage Firefox 151 baseline 验证，只能作为写法参考；真实 case 必须把 `FIREFOX_BASELINE_JA3`、`FIREFOX_BASELINE_AKAMAI`、`headers`、`extra_fp` 和 `curl_options` 替换为当前 case 采样结果。

```python
from curl_cffi import requests
from curl_cffi.const import CurlOpt

FIREFOX_BASELINE_JA3 = (
    "771,4865-4867-4866-49195-49199-52393-52392-49196-49200-"
    "49171-49172-156-157-47-53,"
    "0-23-65281-10-11-35-16-5-34-18-51-43-13-45-28-27-65037,"
    "4588-29-23-24-25-256-257,0"
)

FIREFOX_BASELINE_AKAMAI = "1:65536;2:0;4:131072;5:16384|12517377|0|m,p,a,s"

FIREFOX_HEADERS = {
    # UA 必须来自当前 case 的 Firefox baseline，不要沿用 curl_cffi 默认 UA。
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0",
    # Accept / Accept-Language / Accept-Encoding 等也要以 HAR 或浏览器样本为准。
}

FIREFOX_EXTRA_FP = {
    # signature_algorithms 必须按真实 Firefox baseline 的顺序填写。
    "tls_signature_algorithms": [
        "ecdsa_secp256r1_sha256",
        "ecdsa_secp384r1_sha384",
        "ecdsa_secp521r1_sha512",
        "rsa_pss_rsae_sha256",
        "rsa_pss_rsae_sha384",
        "rsa_pss_rsae_sha512",
        "rsa_pkcs1_sha256",
        "rsa_pkcs1_sha384",
        "rsa_pkcs1_sha512",
        "rsa_pkcs1_sha1",
    ],
    # delegated credentials 使用冒号分隔；不要把逗号分隔误写为最终配置。
    "tls_delegated_credential": "ecdsa_secp256r1_sha256:ecdsa_secp384r1_sha384:ecdsa_secp521r1_sha512",
    # record_size_limit 需来自真实浏览器样本，例如 Firefox 151 样本为 0x4001。
    "tls_record_size_limit": 0x4001,
}


def create_firefox_aligned_curl_cffi_session():
    # 最终项目必须使用 Session；动态资源刷新、Cookie 生成和目标 API 都复用同一 Session。
    # ja3 / akamai / extra_fp / curl_options 在 Session 初始化时固定，避免单次请求遗漏。
    session = requests.Session(
        impersonate="firefox147",
        ja3=FIREFOX_BASELINE_JA3,
        akamai=FIREFOX_BASELINE_AKAMAI,
        extra_fp=FIREFOX_EXTRA_FP,
        curl_options={
            # 用于对齐 Firefox key_share 数量；实际值必须通过采样验证。
            CurlOpt.TLS_KEY_SHARES_LIMIT: 2,
        },
    )
    session.headers.update(FIREFOX_HEADERS)
    return session


def send_with_firefox_aligned_tls(session, method, url, **kwargs):
    headers = dict(FIREFOX_HEADERS)
    headers.update(kwargs.pop("headers", {}) or {})
    return session.request(
        method=method,
        url=url,
        headers=headers,
        **kwargs,
    )
```

### cyCronet / cycronet 的边界

`cyCronet` / `cycronet` 更适合 Chromium / Chrome baseline。即使当前版本提供 `add_tls_profile` / `set_tls_profiles`，通常也主要控制 cipher suites、curves 和部分 extensions，底层仍是 Cronet / Chromium 网络栈，HTTP/2 Akamai 指纹、JA4 结构和 Firefox 的 BoringSSL / NSS 行为可能不同。

- 取证 baseline 是 Firefox：优先使用 curl_cffi 的 Firefox 对齐流程；不要把 cyCronet 作为 Firefox 对齐首选。
- 取证 baseline 是 Chrome / Chromium 类工具：可以考虑 cyCronet，并同样先采样 baseline、再对比 JA3 / JA4 / HTTP2 指纹。
- 如果用户明确要求用 cyCronet 对齐 Firefox，必须先实测；若 JA4 或 HTTP/2 指纹无法一致，暂停并说明能力边界。

## 客户端模板

### Node.js CycleTLS 模板

CycleTLS 的包名和导出在不同版本中可能不同，先用 `check_tls_clients.js` 确认。注意：本仓库 `templates/node-request/client.js` 的自动检测**不包含** CycleTLS（其 `ja3Request`/`strongRequest` API 与统一 `request` 包装不兼容）；如需使用，请按下方示例手动封装为 `result/src/request/client.js`，不依赖自动检测，只由 `result/final.js` 调用。

```javascript
'use strict';

async function createCycleTLSSession({ ja3, userAgent, headers = {} }) {
  const initCycleTLS = require('cycletls');
  const cycleTLS = await initCycleTLS();
  const cookieJar = new Map();

  async function request({ url, method = 'GET', headers: extraHeaders = {}, body }) {
    const response = await cycleTLS(url, {
      method,
      headers: { ...headers, ...extraHeaders },
      body,
      ja3,
      userAgent,
    }, method.toUpperCase());
    // 按项目需要解析 Set-Cookie 并写回 cookieJar，后续请求复用。
    return { status: response.status, headers: response.headers, body: response.body };
  }

  async function close() {
    cookieJar.clear();
    if (typeof cycleTLS.exit === 'function') cycleTLS.exit();
  }

  return { request, close, cookieJar };
}

module.exports = { createCycleTLSSession };
```

### Node.js impers 模板

`impers` 是 Node.js curl-impersonate 路线，官方说明它处于 alpha 状态，API 可能变化。使用时优先按本机安装版本确认导出。常见用法是指定 `impersonate`，例如 `chrome`。

```javascript
// ESM 示例；若最终项目使用 CommonJS，可把请求客户端单独写成 .mjs 或动态 import。
import * as impers from 'impers';

export async function sendRequestWithImpers({ url, method = 'GET', headers = {}, body, impersonate = 'chrome' }) {
  const fn = method.toLowerCase();
  if (typeof impers[fn] === 'function' && !body) {
    return await impers[fn](url, { headers, impersonate });
  }
  return await impers.request({ url, method, headers, body, impersonate });
}
```

### Python curl_cffi 模板

普通 Chrome / Safari / 已有预设 profile 可使用下列基础模板；如果取证 baseline 是 Firefox 且 curl_cffi 预设 profile 与真实浏览器 TLS / HTTP2 指纹不一致，必须优先按上文"Firefox baseline 与 curl_cffi TLS 指纹对齐"生成专用 Session 封装，不得只使用基础模板或只改 UA。

```python
from curl_cffi import requests


def create_curl_cffi_session(headers=None, impersonate="chrome"):
    session = requests.Session(impersonate=impersonate)
    session.headers.update(headers or {})
    return session


def send_request_with_curl_cffi(session, url, method="GET", data=None, json_data=None, headers=None):
    resp = session.request(
        method=method,
        url=url,
        headers=headers or {},
        data=data,
        json=json_data,
        timeout=30,
    )
    return {"status": resp.status_code, "headers": dict(resp.headers), "text": resp.text}


def close_curl_cffi_session(session):
    try:
        session.cookies.clear()
    finally:
        session.close()
```

### Python cffi_curl / cyCronet 模板

`cffi_curl` 与 `cyCronet` / `cycronet` 的 API 版本差异较大，Skill 不应硬编码某个本机版本。`cyCronet` / `cycronet` 默认优先用于 Chrome / Chromium baseline；Firefox baseline 应优先走 curl_cffi 对齐流程。使用方式：

1. 先运行 `check_tls_clients.js --python python --json` 确认导入名。
2. 在 `result/src/request/client.py` 封装一个统一函数 `send_request(...)`。
3. 只在封装内部处理库差异；`final.py` 不直接散落库调用。
4. 若当前包 API 与模板不一致，以本机包文档为准，并在 `notes/final-request-validation.md` 记录使用版本和参数。

```python
def send_request(url, method="GET", headers=None, body=None):
    # 根据用户已确认且本机已安装的 cffi_curl / cyCronet API 实现。
    # 必须返回 status、headers、text/body。
    raise NotImplementedError("请根据本机 cffi_curl / cyCronet 版本补齐请求客户端封装")
```

## 最终验证流程

1. 前置阶段确认最终请求客户端和是否已安装。
2. 确认 fixtures 已通过，Node.js 生成参数与浏览器样本一致。
3. 读取用户提供的成功 cURL / HAR，不凭空构造请求。
4. 脱敏保存请求样本；真实 Cookie / token 只保存在本地，不写入最终报告。
5. 使用已确认的 TLS 指纹兼容客户端创建 session client，并在同一 session 中仅发起少量验证请求；若用户选择"不发真实请求"，则只输出本地 sign / 参数。
6. 对比：
   - HTTP 状态码。
   - 响应 JSON 中关键字段。
   - 服务端是否接受新生成的加密参数。
   - 是否出现风控 / 验证码 / 登录失效。
7. 写入 `notes/final-request-validation.md`。
8. 在 `finally` 中销毁 session，清理 Cookie jar、临时响应、日志和敏感请求副本。
9. 将最终请求逻辑整合进 `result/final.js` 或 `result/final.py`，并运行 `check_final_artifact.js` 确认不包含浏览器自动化代码和多余产物。

## 输出模板

```markdown
## 最终请求验证

- 是否执行真实请求：是 / 否
- 用户授权：是 / 否
- 前置阶段已选客户端：Node.js CycleTLS / Node.js impers / Node.js curl-cffi / curl-cffi-node / Python curl_cffi / Python cffi_curl / Python cyCronet / 不发真实请求
- 客户端安装状态：已安装 / 未安装改选 / 未安装不发请求
- Session 模式：已创建 session / 不发真实请求
- 请求链是否复用同一 session：是 / 否，原因：
- Session 销毁方式：close / exit / dispose / Cookie jar 清理 / 不适用
- 最终项目入口：final.js / final.py
- TLS 指纹对齐：已对齐 / Firefox baseline 对齐 / 未涉及
- 是否出现风控 / 验证码：是 / 否
- 最终结果：成功 / 失败 / 不发真实请求
```

## 相关案例

| 案例文件 | 关联点 |
|---------|--------|
| `cases/jsvmp-xhr-interceptor-env-emulation.md` | TLS 指纹对齐（axios 被识别 → got-scraping） |
| `cases/jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md` | got-scraping Firefox TLS 指纹模拟 |
