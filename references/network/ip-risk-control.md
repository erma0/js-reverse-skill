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
| 接口返回 `{"code": xxx, "type": "verify"}` | 业务层风控码 | 按业务码处理，通常需验证码 |
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
  │       └─ 签名参数缺失/null → 查 node-leakage.md
  │
  └─ 网络层错误
      ├─ ECONNRESET → 可能是 IP 被封或代理失效
      ├─ ETIMEDOUT → 网络问题或目标不可达
      └─ SSL 错误 → TLS 指纹问题，查 tls-validation.md
```

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
