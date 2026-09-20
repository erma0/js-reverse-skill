# 加密入口定位模型（四层链路）

> **触发条件**：FORENSIC_CAPTURE 需要定位加密参数生成链路时读

## 四层链路模型

定位结果必须尽量拆成四层，不要只记录一个疑似函数名。

| 层级 | 含义 | 常见证据 | 输出要求 |
|---|---|---|---|
| source 数据源 | 参与签名的输入材料 | URL、Query、Body、Cookie、localStorage、时间、随机数、指纹 | 列出字段和值来源 |
| entry 加密入口 | 直接返回 sign/token 或中间签名的函数 | 调用栈、搜索参数名、断点命中、sourcemap | 函数名、模块号、文件、行列号 |
| builder 请求构造 | 把入口结果拼到请求对象的位置 | axios/fetch 封装、SDK request 方法、拦截器 | 参数位置与写入前后的对象快照 |
| writer 请求写入 | 最终写入网络请求的位置 | fetch、XMLHttpRequest.send、setRequestHeader、URLSearchParams、cookie | 最终 API、方法、Header/Query/Body/Cookie |

**只有记录到 `writer`，才能确认"找到的函数"确实影响目标请求。**
**只有记录到 `source`，才能解释为什么 Node.js 输出和浏览器样本可能不一致。**

## 响应方向四层链路（解密/解析对称模型）

请求方向四层（source→entry→builder→writer）只覆盖"怎么把参数写进请求"。目标接口的响应体若**不是明文 JSON**（`code` 字段非 0/非 1、`data` 是二进制或乱码），必须同步还原**响应方向**四层，不能只盯着请求签名：

| 层级 | 含义 | 常见证据 |
|---|---|---|
| response 原始响应 | 网络层拿到的 body（可能 gzip/br 压缩、二进制） | trace 的 xhrNative 响应记录、capture target_hits 的 `response_body` |
| reader 读取/解码入口 | 拦截器/请求封装里把响应转成中间形式的函数 | `JSON.parse`、`charCodeAt` 循环、`atob`、`pako.inflate`、axios 拦截器 |
| decoder 解密/解压 | 真正的算法（凯撒位移 / AES / 异或 / 解压） | 调用栈、密钥/位移量参数来源 |
| parser 业务解析 | 把解密结果转成业务对象 | `JSON.parse` 之后的字段映射 |

**响应方向定位顺序与请求方向对称**：先确认"响应体是什么形态"→ 追 reader 调用链（charCodeAt/atob/inflate）→ 定位 decoder → 确认 parser。

**两条关键原则**：

1. **先看 code 分支，再判"错误/风控"**：响应有 `code`/`status` 字段且非 0 时，先在前端搜 `if(...code...){...}` 的响应拦截器分支——`code` 可能是加密容器标识（如 `code-100` 作为凯撒位移量）或加密模式标识，而非业务错误码。没看分支前不得假设"风控/拒绝"。
2. **先判 data 编码特征，再套算法**：`data` 是二进制/乱码时，先 base64 解码看 magic number（`1f8b`=gzip、`789c`=zlib），或用 `长度 mod16==0` 判 AES；`mod16≠0` 基本排除 AES-ECB，转查压缩/位移/异或。别看到源码某处有 AES 密钥串就默认 data 是 AES——密钥可能作用于别的字段。

### 库语义判定：同一算法的两条调用路径（crypto-js 家族）

crypto-js 打包副本里**同时存在**两条同名 `encrypt/decrypt` 语义，密钥处理方式不同，判错会解不出且症状是"填充错误"而不是明文异常：

| 路径 | 密钥语义 | 触发条件 |
|---|---|---|
| 直接密钥型 | 传入的 WordArray **就是** key（`enc.Utf8.parse(k)` 的 word 切片按算法 keySize 用） | 调用点第二实参是 `enc.*.parse(...)` 产出或 WordArray |
| 口令派生型 | 传入的是**口令**，运行时派生 key+iv（`cfg.kdf` 默认 EvpKDF-MD5），密文自带 8 字节盐 | 第二实参是字符串口令，且密文头 8 字节 = `Salted__`（`53616c7465645f5f`） |

两条路径共用同一个 `Cipher._createHelper`（内部分叉在实参类型），**不能从 Helper 出处区分**。

**三步静态判定（不需要运行时）**：

1. 读 `CryptoJS.<算法>.encrypt/decrypt` 调用点的**第二实参类型**：`enc.*.parse(...)`/WordArray ⇒ 直接密钥；
   字符串口令 ⇒ 派生型（`cfg.kdf` 参与）；
2. 看密文串**自身**有无容器魔数：`Salted__` ⇒ 派生型（`cases/yuanrenxue-match22-openssl-salted-alphabet-branch.md`）；
   Salted__ 容器本身也块对齐，「裸 base64 且块对齐」不是直接密钥型判据；
3. 统计候选哈希/KDF 的**调用点**（`X.execute(`、`HmacSHA1(`、`MD5(` 形式）——
   **只有定义无调用点的属于打包死代码，不进还原链**（`MD5` 命中 4 次却一次没调是最常见的误导形态）。

配套纪律：密钥若是**随响应下发**的字段（不是站方常量），先用一次只读探针连打 3 次比对取值是否变化，
变化即禁止硬编码；轮换**粒度**（逐页换 / 每次运行换一套）未取证时不要在结论里写死。

### 时间派生的 key·iv：按加密方时区排候选，禁止写成常量

decoder 的 `iv`/`key` 实参若是**函数调用**（如 `iv: DES3.iv()` → `formatDate(new Date(),"yyyyMMdd")`）而不是字面量，
说明它是时间派生参数。站方前端取的是**浏览器本地日期**，而加密发生在**服务端时区**，
两者只在客户端与服务端同区时偶然一致；跨零点或客户端换时区即全量失败。落地要求：

- 候选顺序：加密方（服务端）时区日期 → 运行机本地日期 → 各 ±1 天；补零语义按站方 `formatDate` 实现核对；
- 每个候选**双校验**：去填充成功 **且** 明文 `JSON.parse` 成预期结构，任一不过即换下一候选；
- 全候选失败必须**抛错终止**（错误信息里带试过的候选值），不得取第一个候选硬解或吞异常返 0；
- 实际命中的候选值写进验证记录摘要（`ivUsed` 之类），便于事后判断当天用的是哪一天；
- 回归验证：把系统时区改成 UTC±0 再跑一次交付入口，仍成功才说明候选集完整（规则 55）。

## 三类常见架构

1. **直接写入型**：业务代码直接调用入口函数，然后把结果拼接到 Query/Header/Body。
2. **拦截器型**：axios/fetch/XHR 封装中统一补签名；业务调用栈上看不到参数名，需要看拦截器或 request wrapper。
3. **SDK 型**：第三方或站点 SDK 初始化后接管请求，入口函数可能藏在 runtime chunk、动态 chunk、WASM 或 Worker 中。

## 推荐定位顺序

1. 从成功请求样本确认 API，并先列出 Query / Header / Body / Cookie 中所有可疑加密参数作为候选假设；由取证与调用栈定位确认本次要分析的参数，不等待用户选择。
2. 在 DevTools Network 查看 Initiator，先记录请求发起文件和调用栈。
3. 对 `fetch`、`XMLHttpRequest.open/send/setRequestHeader` 设置断点或 Hook，捕获 `writer`。
4. 搜索参数名、Header 名、API path、接口封装方法名，寻找 `builder`。
5. 沿调用栈向上找返回值来源，确认 `entry`。
6. 回溯入口入参和读取的环境，整理 `source`。
7. 若源码压缩严重，结合 sourcemap、webpack module id、动态 chunk 名、运行时模块缓存定位。
8. 若存在 Worker、WASM、iframe 或 postMessage，单独建链。

## 断点与 Hook 组合

优先使用 Hook 快速缩小范围，再用断点确认源码位置：

- `fetch`：看 URL、init、Header、Body。
- `XMLHttpRequest.open/send/setRequestHeader`：看请求方法、URL、Header、Body。
- `URLSearchParams.append/set`：看 Query 参数写入。
- `FormData.append`：看表单 Body 参数写入。
- `document.cookie` setter：看 Cookie 写入。
- `localStorage/sessionStorage.getItem`：看 source 是否来自存储。
- `Date.now`、`performance.now`、`Math.random`、`crypto.getRandomValues`：看时间随机依赖。
- `Function`、`eval`、`setTimeout(string)`：看动态代码和混淆解包。

Hook 模板见 `references/hooks/hook-templates.md`。Hook 只用于授权调试和证据收集，不修改请求、不批量访问。

## 入口定位记录模板

```markdown
## 加密入口定位记录

### 目标请求
- API：
- 方法：
- 参数：
- 参数位置：

### writer 最终写入
- 类型：fetch / XHR / URLSearchParams / Header / Cookie / Body
- 文件与行列号：
- 调用栈：
- 写入前对象快照：
- 写入后对象快照：

### builder 请求构造
- 函数 / 方法：
- 所在模块：
- 输入：
- 输出：
- 是否经过拦截器：

### entry 加密入口
- 函数名 / 表达式：
- 文件 / chunk / module id：
- 行列号：
- 入参：
- 返回：
- 是否需要初始化：

### source 数据源
- URL / Query：
- Body：
- Cookie：
- localStorage / sessionStorage：
- 时间 / 随机数：
- navigator / screen / document / canvas / WebGL：
- 其他：

### 可信度
- 证据来源：Network / Hook / 断点 / sourcemap / 静态搜索 / 推断
- 是否可进入补环境：是 / 否
- 阻塞点：
```

## 进入补环境的最低条件

- 已列出所有可疑加密参数作为候选假设，并经证据（真实请求 / trace 调用栈）定位确认本次要分析的目标参数。
- 已确认目标参数在成功请求中存在。
- 已确认 `writer`，知道参数最终写入哪里。
- 已定位至少一个可调用或可追踪的 `entry`。
- 已收集入口所在 JS 文件及依赖 chunk。
- 已整理 `source` 初表，哪怕部分字段未知也要明确标记。
- 已有至少一组浏览器真实 fixtures；动态参数建议至少三组。

## 常见案例模式

### Header 签名型
信号：目标参数在 Header 中，例如 `x-sign`、`x-s`、`x-token`
- `setRequestHeader` 或 fetch init.headers 是 writer
- builder 常在 request interceptor 或 SDK request wrapper
- source 往往包含 URL、Body、时间戳、Cookie、设备标识

### Query 混淆参数型
信号：目标参数在 URL Query 中，例如 `sign`、`a_bogus`
- Hook `URLSearchParams.append/set` 与 XHR/fetch URL
- 注意 Query 排序、编码方式、空值和数组序列化
- 常依赖 UA、Referer、时间和随机数

### Body 签名型
信号：目标参数在 JSON 或表单 Body 中
- 保留原始 Body 字符串，避免 JSON 重新序列化造成差异
- 比对 Content-Type 与空格、顺序、转义
- Hook `JSON.stringify` 可辅助定位 builder

### SDK 初始化型
信号：入口函数找到了但直接调用失败，或必须先执行 init
- 查 `init`、`config`、`setConfig`、`install`、`use`、`start`
- 记录全局配置、meta 标签、script 标签参数
- 先补初始化链，再补环境对象

### 异步消息型
信号：签名结果通过 Promise、回调、Worker message 返回
- 记录消息类型和 payload
- 区分初始化消息与签名请求消息
- 用 fixtures 验证最终异步输出

### 信封型：不透明体 + 明文可复算尾段（跨载体通用）
信号：参数值是**一整串编码文本**，可拆成 `<不透明段><可解释段>`，且尾段能对上「固定盐 + 时间戳」明文
（形态如 `base64(salt + ts)` / `base64(body + ts)` / 尾部裸拼 `ts`）；载体是 Header、Query、Cookie 还是 Body 都见过。

- **先切段再决定还原深度**：服务端能自己复算的只有「请求里已存在的信息」，
  因此**尾段明文（盐、ts、回显的 body 字段）才是校验点所在**；不透明段含客户端随机量时
  （trace 里该函数栈上出现 `Math.random` / `crypto.getRandomValues`），服务端无法按字节复算，
  只能解密校验或干脆只校格式。
- 取证手段：这类尾段几乎都经 `btoa` / `atob` / `encodeURIComponent` 落地，
  RuyiTrace 的 `Window.btoa`、`Window.atob` 记录里 `args` 就是**未编码明文**（一次命中即拿到 source→writer 的配对证据），
  不必先反混淆。
- 定深度的动作是打靶而不是啃编码链（判据与用例矩阵见 `references/workflow/experience-rules.md` 规则 32 第 4 条）：
  至少跑「缺参 / 截断 / 同长度随机伪造体 / 改内嵌 ts / 时间戳超前 / 换载体 / 去掉伴生头」七个单变量用例，
  把「校长度、校 ts、不校内容」这类结论实测出来。同长度伪造体通过 ⇒ 闭式还原该段零增益，交付停在黑盒或最小环境；
  伪造即拒 ⇒ 真验密码学，必须还原或黑盒执行到产生点。
- 两个易错点：
  1. **伴生头/伴生参数可能完全不参与校验**（同一次打靶里"改掉 `timestamp` 头仍通过"与"改尾部内嵌 ts 即拒"可同时成立），
     不要因为浏览器发了就全部复刻，也不要因为它是"看起来像签名"的头就假定它是校验点。
  2. **时间窗可能不对称**（超前若干分钟同样被拒），排 ts 候选时同时测过去与未来方向，不要只测 −N/+0。
- 实证参考（同形态、不同算法族）：`cases/obfuscated-url-param-signer-safekodo-mashangpa-p14.md`、
  `cases/cookie-carrier-hexinv-fingerprint-struct-mashangpa-p15.md`、
  `cases/body-carrier-h5st-remote-algo-mashangpa-p16.md`、
  `cases/header-m-fingerprint-envelope-tail-ts-mashangpa-p18.md`。
