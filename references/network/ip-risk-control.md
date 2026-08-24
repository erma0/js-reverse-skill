# IP 风控识别与代理策略

> **触发条件**：请求失败、返回风控页/验证码、HTTP 200 空 body、IP 被限流时读。选择代理类型、设计退避策略时也读。
> **知识分级**：本文件的厂商响应头/Cookie/状态码特征属于 T1 识别指纹（仅用于失败归因识别，见 SKILL.md 厂商知识分级）；各厂商协议还原细节（T2）以 case 证据与 `cases/` 为准。

## 风控信号识别表

实战中"请求失败"的原因可能是签名错、Cookie 失效、UA 不符、IP 限流。必须先准确识别才能对症下药。

| 信号 | 判定 | 处理 |
|---|---|---|
| HTTP 403 + 风控页 HTML（含 challenge JS） | Cloudflare/Akamai/DataDome challenge | 走 `web-verify-patcher` 参考，或换住宅代理 |
| HTTP 403 + `Server: cloudflare` + `cf-mitigated: challenge` | Cloudflare 主动挑战 | 同上 |
| HTTP 200 + 空 body + `x-vc-bdturing-parameters` 响应头 | 字节系滑块风控（code=10000, type=verify, subtype=slide） | IP 被限流，等待或换 IP |
| HTTP 200 + 空 body + 其他风控响应头 | 静默风控（签名通过但环境不对） | 查 `silent-failure-checklist` |
| HTTP 412 循环 + `Server: Akamai` | Akamai sensor data 失效 | 重算 sensor，查 `quality/high-strength-detection.md` |
| HTTP 200 + Set-Cookie 含 `__cf_bm` / `_abck` / `bm_sz` | 风控 Cookie 下发，需二次提交 | 采集后重发，详见 `cookie-generation.md` |
| HTTP 429 Too Many Requests | 明确频率限制 | 退避 + 降频 |
| HTTP 403 + `Server: tengine` + 空 body | 阿里系 WAF | 换 IP 或降频 |
| HTTP 403 + body `{"error_code":40002}` 等 JSON 风控码（拼多多 apiv2 网关） | 签名内容层 / 连接层待定位 | 必须先跑下方「分层定位矩阵」；未定位前不得判定为连接层拦截 |
| 接口返回 `{"code": xxx, "type": "verify"}` | 业务层风控码 | 按业务码处理，通常需验证码 |
| HTTP 200 + 业务层风控文案（如"风控不通过/别匆忙"）非标准错误码 | **会话状态类风控**（见下方专节） | 按会话状态三要素排查，别先怀疑 TLS/签名 |
| 连续多次请求后突然全失败 | IP 临时封禁 | 退避 + 换 IP |
| 同一 IP 间歇性成功 | IP 软限流（计数器） | 降频 + 随机延迟 |

### 识别决策树

```
请求失败
  │
  ├─ HTTP 状态码？
  │   ├─ 429 → 频率限制（退避 + 降频）
  │   ├─ 403 → 风控 challenge 或 WAF
  │   │   ├─ 有风控响应头（cf-mitigated / x-vc-bdturing）→ IP 风控
  │   │   ├─ 有 challenge JS → 走 web-verify-patcher
  │   │   └─ 无明显风控头 → 查签名/Cookie/UA
  │   ├─ 412 → Akamai/瑞数 sensor 失效（重算 sensor）
  │   └─ 200 但异常
  │       ├─ 空 body + 风控响应头 → IP 风控（静默拒绝）
  │       ├─ 空 body 无风控头 → 环境指纹不对（查 silent-failure-checklist）
  │       ├─ 业务码异常（code != 0）→ 查业务码含义
  │       ├─ 200 + 风控文案（"风控不通过"等）→ 会话状态类风控（见下方专节：
  │       │   先确认 session 健康，再查蜜月期窗口 / 链式状态 / 惩罚计数）
  │       └─ 签名参数缺失/null → 查 node-leakage.md
  │
  └─ 网络层错误
      ├─ ECONNRESET → 可能是 IP 被封或代理失效
      ├─ ETIMEDOUT → 网络问题或目标不可达
      └─ SSL 错误 → TLS 指纹问题，查 tls-validation.md
```

## 签名内容层 vs 连接层定位矩阵

> **触发条件**：自己的签名 + 纯协议客户端被 403/风控码拦截，且错误码无法区分是「签名内容被拒」还是「TLS/HTTP2 连接指纹被拒」时必用。下「连接层风控 / 纯协议不可绕过」结论前必须完成两个对照，缺一不可（实战误判案例：拼多多 40002——用过期浏览器签名做对照，误判为连接层拦截并转投浏览器内核方案；实际是签名内嵌环境检测 flag 不一致，修正后纯 Node H1 都能 200）。

用「签名来源 × 连接来源」双对照隔离变量：

| 实验 | 签名来源 | 连接来源 | 结果 → 结论 |
|---|---|---|---|
| ① 正向对照 | 浏览器生成（**必须新鲜**） | 纯协议客户端（curl_cffi / Node https） | 200 ⇒ 连接层无问题，拦截在自己的签名内容；403 ⇒ 连接层嫌疑成立 |
| ② 反向对照 | 自己生成 | 真实浏览器（hook 注入） | 403 ⇒ 服务端校验签名内容，与连接无关；200 ⇒ 签名内容可被接受，问题在协议客户端实现 |

执行纪律：

1. **新鲜度（最容易翻车的变量）**：内嵌 serverTime/时间戳的签名有有效期。对照样本必须「采集后立即重放」并记录采集→重放延迟；取证阶段抓的旧样本重放 403 **不构成任何结论**——过期签名与垃圾签名返回同一风控码时会制造「连接层拦截」假象。
2. **正向对照做法**：ruyipage 打开目标页抓到含签名的完整请求 URL 与请求头后，立即用 curl_cffi（impersonate 与目标浏览器同族）原样重放；UA/请求头与抓包对齐，控制变量只留签名来源。
3. **反向对照做法**：取证阶段 ruyipage `add_preload_script`（传函数声明字符串 `"() => {...}"`，IIFE 会静默不执行）hook `XMLHttpRequest.prototype.open`，命中目标接口时替换其中的签名为自己生成的值；hook 内设置 `window.__hookInstalled` 等标记并在解读结果前验证标记，防止把页面自身行为误当实验结果。
4. **结论 ①=200 且 ②=403** ⇒ 服务端校验签名内容（通常是签名内嵌的环境检测结果）：进入 `references/env/env-detect-bypass.md` 的对齐探针法，测量并逐位对齐 SDK 检测输出，不要先假设要复现 canvas/行为轨迹等完整指纹，更不要转投浏览器内核取数方案。
5. 对照结论与验证记录一并留档（两个对照各自的签名摘要、时间戳、HTTP 状态、业务码）。
6. **对照必须在健康 session 下做**：连续失败会触发站点惩罚机制（见下方专节），惩罚期内"正反对照全 403"是污染数据，会制造"连接层不可绕过"假象（实战误判：猿人学 match6 在惩罚期内跑对照得出 TLS 硬门槛结论，实际补齐 cookie 后 curl_cffi 直接过）。每组对照前先复刻一次确定成功的基线请求，基线失败即冷却后重做。
7. **单变量 + 阳性对照**：一次只改一个变量，其余复用最近一次成功请求的配置；每组实验先跑阳性对照（已知成功的构造）确认通道正常再发测试请求。多变量混测无法归因，实验代码自身 bug（编码级别、签名内 t 与链末段 t 不同源）制造的假阴性比不实验更糟（详见 common-pitfalls.md 反模式 13/14）。

## 会话状态类风控识别

> **触发条件**：HTTP 200 但返回风控文案（非标准错误码）、"浏览器成功而纯协议同参数失败"、"短窗口内重放成功超窗失败"时读。这类风控在「签名内容层 vs 连接层」二元矩阵之外，拦截点在服务端会话状态，教学/刷题站（猿人学等）常见。

三类机制（可叠加）：

| 机制 | 典型证据 | 破解方向 |
|---|---|---|
| **蜜月期窗口** | 页面加载（真浏览器 GET HTML）后短时间内 API 放行、成功请求续期；窗口外同构造请求被拒；重放"5 秒内成功、15 秒失败" | 纯协议需先 GET HTML 开窗（或验证非浏览器 GET 是否也开窗），并保持请求间隔小于续期窗口 |
| **链式会话状态（q/nonce 链）** | 参数在客户端跨请求累加（如 `q = 1-<t1>\|1-<t2>\|`）；全新链首段能成功、断链/跳段被拒 | 从空链起步顺序请求并自维护累加链；签名内时间戳必须与链末段同源 |
| **失败惩罚计数** | 连续失败 N 次（约 5-10）后连浏览器自身请求也被拒；冷却 10 分钟+恢复 | 诊断前先验基线（页面加载看数据渲染）；失败预算 3-5 次即停冷却；惩罚期内不做任何实验 |

识别纪律：
- 判定成败只看**响应体**（业务数据 vs 风控文案），客户端状态更新（window 变量累加、DOM 变化）不代表请求成功
- 风控文案≠字面含义（"别匆忙，放慢速度"实测与会话窗口/链状态相关，与请求频率无关）
- 这类站点常同时要求完整 cookie 链（含统计类 cookie 如 `Hm_lvt`）与特定页 UA 门槛（如末页 `UA: yuanrenxue`），对照时把 cookie 完整性当作独立变量测

## 退避策略

### 指数退避 + 抖动

```javascript
async function requestWithBackoff(requestFn, options = {}) {
    const {
        maxRetries = 5,
        baseDelay = 1000,      // 初始 1s
        maxDelay = 60000,      // 最大 60s
        jitter = 0.3,          // 30% 抖动
        onRetry = (err, attempt, delay) => console.log(`第${attempt}次重试，${delay}ms后`),
    } = options;

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await requestFn();
            // 成功后可选：重置退避计数器
            return result;
        } catch (err) {
            lastError = err;

            // 不可重试的错误直接抛出
            if (isNonRetryable(err)) throw err;

            if (attempt === maxRetries) break;

            // 计算退避时间：指数 + 抖动
            const expDelay = Math.min(
                baseDelay * Math.pow(2, attempt),
                maxDelay
            );
            const jitterAmount = expDelay * jitter * (Math.random() * 2 - 1);
            const delay = Math.max(0, Math.round(expDelay + jitterAmount));

            if (onRetry) onRetry(err, attempt + 1, delay);
            await sleep(delay);
        }
    }
    throw lastError;
}

function isNonRetryable(err) {
    // 4xx 中除了 429/403 通常不可重试
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
        return err.statusCode !== 429 && err.statusCode !== 403;
    }
    return false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
```

### 熔断阈值

连续失败超过阈值时停止重试，避免雪崩：

```javascript
class CircuitBreaker {
    constructor({ threshold = 10, cooldown = 300000 }) {
        this.threshold = threshold;    // 连续失败 10 次
        this.cooldown = cooldown;      // 熔断后冷却 5 分钟
        this.failures = 0;
        this.lastFailureTime = 0;
        this.isOpen = false;
    }

    async execute(fn) {
        if (this.isOpen) {
            if (Date.now() - this.lastFailureTime > this.cooldown) {
                this.isOpen = false;
                this.failures = 0;
            } else {
                throw new Error('Circuit breaker open');
            }
        }

        try {
            const result = await fn();
            this.failures = 0;
            return result;
        } catch (err) {
            this.failures++;
            this.lastFailureTime = Date.now();
            if (this.failures >= this.threshold) {
                this.isOpen = true;
            }
            throw err;
        }
    }
}
```

## 代理类型选型

| 代理类型 | 通过率 | 成本 | 适用风控 | 注意事项 |
|---|---|---|---|---|
| 住宅代理 | 高 | 高 | Cloudflare/Akamai/DataDome/Kasada | IP 真实性高，风控通过率最好 |
| 移动代理 | 极高 | 中高 | 字节系/微信系 | 移动 IP 段信任度高，4G/5G 出口 |
| 数据中心代理 | 低 | 低 | 轻度风控站点 | 容易被识别为机房 IP |
| 不用代理 | 取决于本机 IP | 免费 | 无风控站点 | 开发调试用，生产不推荐 |

### 按风控类型选代理

| 风控类型 | 推荐代理 | 理由 |
|---|---|---|
| Cloudflare | 住宅代理（优先）/移动代理 | CF 对数据中心 IP 严格，住宅通过率高 |
| Akamai | 住宅代理 | Akamai sensor 会检测 IP 信誉 |
| DataDome | 住宅代理 / 移动代理 | DataDome 对机房 IP 几乎全拦 |
| Kasada | 住宅代理 | Kasada 检测 IP ASN 类型 |
| 字节系（抖音/TikTok） | 移动代理 / 住宅代理 | 字节系对移动 IP 信任度高 |
| 阿里系 WAF | 住宅代理 | tengine WAF 对数据中心 IP 严格 |
| 无明显风控 | 数据中心代理即可 | 成本低 |

### 代理与 baseline 一致性

换代理后需注意 baseline 联动：

| 维度 | 一致性要求 | 说明 |
|---|---|---|
| timezone | 出口 IP 地理位置 → timezone 必须一致 | 美国 IP 配 Asia/Shanghai 会触发风控 |
| language | 出口 IP → Accept-Language 联动 | 美国 IP 配 zh-CN 可疑 |
| Client Hints | Chrome UA + 美国 IP → `sec-ch-ua` 区域正确 | `navigator.language` 与 IP 地理位置矛盾是常见风控信号 |
| ja3/JA4 | 代理通常不影响 TLS 指纹 | 除非用 MITM 代理会破坏 TLS |
| HTTP/2 fingerprint | 代理可能改变 HTTP/2 settings | 部分代理会重写 HTTP/2 帧 |

**实战检查清单**：
- [ ] 代理出口 IP 的地理位置已知
- [ ] `navigator.language` / `Accept-Language` 与出口 IP 地理位置一致
- [ ] `Intl.DateTimeFormat().resolvedOptions().timeZone` 与出口 IP 一致
- [ ] 代理不会 MITM TLS（否则 ja3 失效）
- [ ] 代理稳定性足够（频繁断连会触发风控）

## 风控触发后的处理流程

```
检测到风控信号
  │
  ├─ 是验证码/challenge？
  │   ├─ 是 → 参考 web-verify-patcher 处理
  │   └─ 否 → 继续判断
  │
  ├─ 是 IP 限流（429 / 空 body + 风控头）？
  │   ├─ 是 → 退避等待 / 换 IP / 降频
  │   └─ 否 → 继续判断
  │
  ├─ 是签名错误（412 / 签名参数缺失）？
  │   ├─ 是 → 查 debug-playbook.md 签名 7 环节
  │   └─ 否 → 继续判断
  │
  ├─ 是 Cookie 失效？
  │   ├─ 是 → 刷新 Cookie 后重试（见 session-chain.md）
  │   └─ 否 → 继续判断
  │
  └─ 是环境指纹不对（200 空 body 无风控头）？
      └─ 是 → 查 silent-failure-checklist 12 项
```

## 降频策略

避免触发风控的预防性措施：

| 策略 | 实现 | 适用 |
|---|---|---|
| 固定间隔 | `sleep(2000)` 每次请求 | 轻度风控 |
| 随机间隔 | `sleep(1000 + random(2000))` | 中度风控 |
| 模拟人类节奏 | 页面停留 3-10s + 滚动 + 随机点击 | 严格风控 |
| 并发限制 | 同时最多 1-3 个请求 | 所有场景 |
| 每日上限 | 单 IP 每日最多 N 次请求 | 严格风控 |

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/network/protocol-analysis.md` | 频率限制基础代码 + 代理轮换最小示例 |
| `references/network/session-chain.md` | Cookie 失效重试（与 IP 风控联动） |
| `references/network/cookie-generation.md` | 风控 Cookie（`__cf_bm`/`_abck`）的二次提交 |
| `references/network/tls-validation.md` | TLS 指纹 baseline 对齐 |
| `references/debug/debug-playbook.md` | 故障树总览（含风控分支） |
| `references/network/node-leakage.md` | 静默失败 12 项排查 |
| `references/env/env-detect-bypass.md` | 分层定位为「签名内容被校验」后的环境检测对齐探针法 |
