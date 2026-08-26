# Cookie 生成链路与过期处理

当 Cookie/token 过期、不需要登录的网站请求因 Cookie 失败、目标参数位于 Cookie，或需要分析 `Set-Cookie` / `document.cookie` / JS 计算 / Storage 派生 / challenge 生成链路时读取本文件。

## 总原则

- 先判断 Cookie 是否与登录 / 账号授权相关，再决定处理方式。
- 对登录态 Cookie，不绕过登录、不索要账号密码、不破解验证码或 MFA；让用户手动登录或提供授权样本。
- 对非登录 Cookie，不要默认要求用户重新提供新 Cookie；应分析它如何生成、刷新和写入，并尽量纳入补环境或最终请求入口。
- 最终项目只能用 Node.js / Python 请求客户端发送请求；浏览器自动化只用于前置取证。

## Cookie 分类

| 分类 | 常见特征 | 处理策略 |
|---|---|---|
| 登录态 / 会话 Cookie | 与账号、session、SSO、权限、Authorization 绑定 | 用户手动登录或提供授权样本；不复现登录绕过 |
| 服务端首访 Cookie | 首次访问页面或接口时 `Set-Cookie` 下发 | 在最终 Node.js / Python 请求前增加首访 / challenge 请求，维护 Cookie jar |
| 前端写入 Cookie | 通过 `document.cookie = ...` 写入 | Hook setter 或用 RuyiTrace 查 `document.cookie` 调用栈 |
| JS 计算 Cookie | 混淆 JS、SDK、指纹模块生成 | 按 `source → entry → builder → writer` 搬运原始 JS 并补环境 |
| Storage 派生 Cookie | localStorage / sessionStorage / IndexedDB 参与 | 固化必要存储键，或在入口中先生成存储再生成 Cookie |
| 指纹 / challenge Cookie | 依赖 navigator、canvas、WebGL、时间、随机数、server seed | 结合 RuyiTrace / Hook / Node trace 补齐环境和 seed 传递 |
| 一次性服务端状态 | 与服务端临时状态、账号风控或设备校验强绑定 | 说明不可或不应复现，要求授权交互或离线样本 |
| 服务端下发脚本 cookie | 业务请求前有一个同域接口返回**非 JSON 的 JS 文本**，页面 `eval(data)` 后 cookie 出现；值本身是服务端令牌，本地无算法 | 复现该前置请求 + 解码下发脚本取值；令牌通常一次性，禁止缓存复用 |

## 分析流程

1. **确认是否需要登录**
   - 目标页面 / API 是否无需账号即可访问。
   - 失败响应是否明确是未登录、权限不足、账号风控、验证码或 MFA。
   - 若需要登录，进入用户手动登录流程，不继续尝试复现登录态 Cookie。

2. **定位 Cookie 来源**
   - 检查 HAR / cURL / 响应头中是否存在 `Set-Cookie`。
   - Hook `document.cookie` setter，记录写入值、调用栈和写入时机。
   - 若使用 ruyiPage + RuyiTrace，优先在 NDJSON 摘要和原始日志中搜索 `document.cookie`、`Document.cookie`、Storage、navigator、canvas、WebGL、crypto、performance 等相关调用。
   - 检查 localStorage / sessionStorage / IndexedDB 是否参与派生。
   - 检查 Worker、iframe、WASM、postMessage 是否参与生成。

3. **梳理四层链路**

| 层级 | Cookie 场景中要回答的问题 |
|---|---|
| source | Cookie 输入来自 URL、Body、响应 seed、时间、随机数、指纹、Storage 还是已有 Cookie |
| entry | 哪个函数、SDK、模块或 challenge 入口生成 Cookie 值 |
| builder | 哪个请求构造 / Cookie 构造函数拼装 name、value、domain、path、expires 等 |
| writer | 最终由 `Set-Cookie`、`document.cookie`、请求头 `Cookie`、fetch/XHR 拦截器或 Cookie jar 写入 |

只找到 Cookie 值或疑似函数，不代表完成；必须确认 writer。

4. **决定补环境方式**
   - `Set-Cookie` 可刷新：最终入口先执行首访 / challenge 请求，保存 Cookie jar，再发目标请求。
   - `document.cookie` / JS 计算：将目标 JS 与必要环境补齐到 Node.js，入口运行时生成 Cookie。
   - Storage 派生：在 `env.js` 或入口初始化阶段准备必要 Storage 值，并记录来源。
   - 指纹 / challenge 依赖：优先从 RuyiTrace 确认环境 API，再用 Node trace 补充。
   - 登录态 / 一次性服务端状态：不纳入补环境生成，转为手动登录或离线样本。

## 输出模板

```markdown
## Cookie 过期处理判断

- Cookie 名称：
- 当前失败现象：
- 是否需要登录：
- 是否账号 / 授权相关：
- 来源判断：Set-Cookie / document.cookie / JS 计算 / Storage 派生 / challenge / 未确认
- 关键证据：HAR / cURL / RuyiTrace api / stack.file / Hook 调用栈
- 是否可生成或刷新：
- source：
- entry：
- builder：
- writer：
- 是否纳入补环境：
- 最终入口中的处理方式：生成 Cookie / 刷新 Cookie jar / 用户手动登录 / 仅离线样本
- 是否需要用户补充材料：
```

## 不合格做法

- 不区分登录态与非登录 Cookie，直接要求“重新提供有效 Cookie”。
- 对不需要登录的网站，只把 Cookie 当固定样本复制到最终代码。
- 已有 RuyiTrace NDJSON 时，不查看 `document.cookie` / Storage / 指纹相关日志，直接盲补。
- 最终产物通过浏览器自动化生成 Cookie 后再请求。
- 把真实 Cookie / token 明文写入公开报告或最终交付物。

## Cookie 合并策略

实战中常有多个 Cookie 来源：用户传入、内置 DEVICE_COOKIE、接口 Set-Cookie 下发、JS document.cookie 写入。合并时必须明确优先级，否则会导致签名输入错误。

### 优先级规则

```
用户传入 cookie > 内置 DEVICE_COOKIE > 接口刷新 cookie > JS 生成 cookie
```

**同名项**：高优先级覆盖低优先级。

### 合并算法代码模板

```javascript
class CookieJar {
    constructor() {
        this.cookies = new Map(); // name -> { value, source }
    }

    // source: 'user' | 'device' | 'refresh' | 'js'
    static PRIORITY = { user: 4, device: 3, refresh: 2, js: 1 };

    set(name, value, source = 'js') {
        const existing = this.cookies.get(name);
        if (existing) {
            // 高优先级覆盖低优先级；同优先级允许更新值
            if (CookieJar.PRIORITY[source] >= CookieJar.PRIORITY[existing.source]) {
                this.cookies.set(name, { value, source });
            }
        } else {
            this.cookies.set(name, { value, source });
        }
    }

    merge(cookieStr, source = 'js') {
        if (!cookieStr) return;
        cookieStr.split(';').forEach(c => {
            const trimmed = c.trim();
            if (!trimmed) return;
            const idx = trimmed.indexOf('=');
            if (idx === -1) return;
            const name = trimmed.slice(0, idx).trim();
            const value = trimmed.slice(idx + 1).trim();
            this.set(name, value, source);
        });
    }

    get(name) {
        return this.cookies.get(name)?.value || null;
    }

    toString() {
        return Array.from(this.cookies.entries())
            .map(([name, { value }]) => `${name}=${value}`)
            .join('; ');
    }

    toDict() {
        const dict = {};
        for (const [name, { value }] of this.cookies) dict[name] = value;
        return dict;
    }
}

// 典型用法：用户 cookie 优先同名项合并
// const jar = new CookieJar();
// jar.merge(builtinDeviceCookie, 'device');
// jar.merge(refreshedCookie, 'refresh');
// jar.merge(userCookie, 'user');  // 用户传入同名项覆盖内置
```

### 场景示例

```javascript
// 场景：用户 cookie 无效，用内置 DEVICE_COOKIE 刷新后与用户 cookie 合并重试
async function requestWithCookieMerge(userCookie, targetUrl) {
    const jar = new CookieJar();

    // 1. 先加内置 DEVICE_COOKIE
    jar.merge(process.env.DEVICE_COOKIE, 'device');

    // 2. 用 DEVICE_COOKIE 访问主页刷新 cookie
    const refreshed = await fetchHomePage(targetUrl, jar.toString());
    jar.merge(refreshed.setCookie, 'refresh');

    // 3. 用户 cookie 优先同名项合并
    if (userCookie) jar.merge(userCookie, 'user');

    // 4. 用合并后的 cookie 发请求
    return await fetchApi(targetUrl, jar.toString());
}
```

## Cookie 失效自动重试闭环

检测到 Cookie 失效后，应自动触发刷新→重试，而非直接报错。

```javascript
async function requestWithCookieRetry(requestFn, refreshFn, options = {}) {
    const { maxRetries = 2, onRefresh = () => {} } = options;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const result = await requestFn();

        // 检测 Cookie 失效信号（按优先级）
        if (!isCookieExpired(result)) return result;

        if (attempt === maxRetries) {
            throw new Error(`Cookie 失效，重试 ${maxRetries} 次仍失败`);
        }

        onRefresh(attempt + 1);
        await refreshFn();  // 刷新 Cookie（访问主页/重新签名/重新 challenge）
    }
}

function isCookieExpired(response) {
    // 1. HTTP 401/403 + WWW-Authenticate 头
    if ([401, 403].includes(response.statusCode)) return true;
    // 2. 业务码指示登录态失效
    if (response.body?.code === 'not_login' || response.body?.code === -101) return true;
    // 3. 响应含 Set-Cookie 重新下发登录 Cookie
    if (response.headers['set-cookie']?.some(c => c.includes('sessionid='))) return true;
    // 4. 空 body + 风控响应头（可能是 Cookie 失效触发的风控）
    if (response.statusCode === 200 && !response.body && response.headers['x-vc-bdturing-parameters']) return true;
    return false;
}
```

**注意**：Cookie 失效重试与 IP 风控退避不冲突——先按 `ip-risk-control.md` 识别是否 IP 风控，若不是再走 Cookie 重试。

## 服务端下发脚本型 cookie 的最短定位路径

形态：业务请求前紧邻一个**同域、响应不是 JSON 的**接口，页面拿到响应后直接 `eval`，cookie 随即出现。挑战脚本不在任何静态 JS 文件里，靠关键词搜源码找不到。

四步定位（每步都有对应证据文件，全程不超过 10 分钟）：

1. **builder**：看 `case/ruyi-trace/logs/eval/` —— RuyiTrace 把每段 eval 编译的代码单独落盘为 `eval_<pid>_<seq>_eval-direct.js`，配套 `trace_eval_process_<pid>.ndjson` 的 `dynamicCode` 记录带 stack 顶帧，直接给出脚本全文 + 调用它的文件行号。
2. **writer**：看 `case/ruyi-trace/logs/cookie/` 的 `cookieWrites`（`source=document.cookie`）确认 cookie 名与最终写入值；`cookieSetAttempts` 与 `cookieWrites` 成对出现。
3. **source**：在 `capture.json` 里找业务请求**前紧邻的、响应非 JSON 的同域请求**，即下发脚本的来源接口。
4. **entry**：回到 `case/forensic/document.html` 确认调用点（常见形态是分页/请求函数里的同步 `$.ajax({async:false, success:function(data){eval(data)}})`，意味着每次业务请求前都会重取一次）。

实现纪律：

- **不要执行下发脚本**。这类脚本的混淆原子通常有限且可穷举（如字符串加法 + `([] + ![])[i]`/`([] + !![])[i]`/`({} + "")[i]` 取字符），写几十行定向表达式求值器即可，比补 `document` 环境更简单，也避免执行服务端下发的任意代码。遇未知原子显式抛错，不要静默回退到 `eval`。
- **令牌禁止缓存**（同经验法则规则 22）：值是一次性的，缺失或过期典型返回 `400 {"error":"token failed"}`。按浏览器行为在每次业务请求前重取。
- **不要按固定长度校验**：服务端下发的随机串长度每次不同（match13 实测 50~203 字节），只有前缀时间戳格式稳定。

## 相关案例

| 案例文件 | 关联点 |
|---------|--------|
| `cases/jsvmp-ruishu6-cookie-412-sdenv.md` | 瑞数6 412 挑战：`Set-Cookie` 下发 `acw_tc` + `XxxS`，JSVMP 生成 `XxxT` 写入 `document.cookie`，三 Cookie 组合通过验证 |
| `cases/universal-vmp-source-instrumentation.md` | 通用 VMP cookie 生成方法论：覆盖 RS 412 / Akamai `_abck` / `ttwid` / `msToken` 等多场景的 source/entry/builder/writer 分析 |
| `cases/jsvmp-xhr-interceptor-env-emulation.md` | `ttwid` Cookie 由浏览器 JS 生成后写入，纯协议无法直接获取，需补环境或调试浏览器导出 |
| `cases/yuanrenxue-match13-eval-cookie.md` | 服务端下发脚本型：`/api2/13` 返回字符串加法混淆的 `document.cookie=` 语句，eval 落盘取 builder + 定向求值器解码，令牌一次性禁缓存 |
| `cases/jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md` | `msToken` / `ttwid` 等 Cookie 字段作为 JSVMP 签名输入参与双签名生成 |
