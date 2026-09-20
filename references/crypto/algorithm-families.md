# 算法家族站点清单

> **触发条件**：IDENTIFY 识别目标站点时读，匹配已知算法家族
> **知识分级**：本文件的站点↔参数↔SDK 映射属于 T1 识别指纹（仅用于识别与路由，见 SKILL.md 厂商知识分级）；具体字段语义与加密结构（T2）以本次 case 证据、`references/captcha/captcha-providers.md` 与 `cases/` 为准。

## 站点速查表

| 站点 / 域名 | 签名参数 | SDK / 特征 | 推荐方案 | 对应案例 |
|---|---|---|---|---|
| douyin.com | a_bogus | webmssdk / _SdkGlueInit / byted_acrawler | jsdom 环境伪装 | `cases/jsvmp-xhr-interceptor-env-emulation.md` |
| tiktok.com | X-Bogus / X-Gnarly | webmssdk / cacheOpts | jsdom 环境伪装 | `cases/jsvmp-dual-sign-xhr-intercept-cacheOpts-jsdom-firefox.md` |
| nmpa.gov.cn | NfBCSins2OywS | sdenv / 412 / RS 6 | sdenv 纯 Node.js | `cases/jsvmp-ruishu6-cookie-412-sdenv.md` |
| 其他瑞数站点 | FSSBBIl1UgzbN7N / _RSG | 200KB 混淆 + 412 | sdenv 纯 Node.js | 同 nmpa |
| 通用 JSVMP | - | JSVMP 源码插桩 | 路径 A 算法追踪 | `cases/universal-vmp-source-instrumentation.md` |
| Aliyun WAF 站点 | acw_sc__v2 | acw_sc 系列签名 | 纯算还原 | 通用流程 |
| Akamai 站点 | sensor_data / _abck | acmescripts | 源码级插桩 + 补环境 | 通用流程 |
| obfuscator.io 站点 | _0x 前缀 | OB 混淆 | AST 反混淆 + 通用流程 | `scripts/ast-patterns/` |
| reese84 站点 | reese84 | Reese84 challenge | AST 反混淆 + 补环境 | `scripts/ast-patterns/patterns.md` |
| 极验 geetest4 | w / challenge | geetest4 | AST 反混淆 + 验证码交接 | `scripts/ast-patterns/patterns.md` |
| 顶象 dingxiang | dx | dingxiang | AST 反混淆 | `scripts/ast-patterns/patterns.md` |
| 网易 yidun | 易盾验证参数 | yidun | AST 反混淆 | `scripts/ast-patterns/patterns.md` |
| 同花顺 | token | tonghuashun | AST 反混淆 | `scripts/ast-patterns/patterns.md` |
| 同花顺系（含整包移植站点） | hexin-v / Cookie `v` | thsi.cn、chameleon、TOKEN_SERVER_TIME、X-Antispider-Message、CHAMELEON_LOADED | **非哈希签名**：设备指纹位打包结构体 + 滚动校验和 + XOR + 自研 base64 + 明文 ts；优先最小沙箱黑盒，先实测服务端校验强度再决定是否闭式还原 | `cases/vm-sandbox-chameleon-iwencai.md`（原版）、`cases/cookie-carrier-hexinv-fingerprint-struct-mashangpa-p15.md`（移植版） |
| 小红书 | x-s / x-t | xhs | AST 反混淆 | `scripts/ast-patterns/patterns.md` |
| 百度指数 | ascToken token | window.aes_encrypt / gtk 哈希族 | 纯算还原（自研哈希 + AES-CBC） | 通用流程 |
| youdao.com | sign / mysticTime | URI 伪装常量派生 + key-getter | 纯算还原（md5 + AES-128-CBC） | 通用流程 |

## 识别关键词

### 抖音 / TikTok 系
```
webmssdk / byted_acrawler / _SdkGlueInit / cacheOpts
a_bogus / X-Bogus / X-Gnarly
bdms.paths / bdms.init
```

### 瑞数系
```
sdenv / acmescripts
FSSBBIl1UgzbN7N / NfBCSins2OywS / _RSG
meta-12（RS 6 特征）
412 → 302 → 200 redirect chain
```

### Akamai 系
```
acmescripts / sensor_data / _abck
```

### Aliyun WAF
```
acw_sc__v2 / acw_tc
```

### 百度系
```
String.fromCharCode(103,116,107) 拼出 "gtk" 再取 window 属性（属性名混淆，明文检索盲区）
gtk 种子按 "." 切两段数字 + 操作串驱动位运算循环（3 字符步进，"+" 标志位切换 移位/加法 与 异或，& 4294967295 掩码）
超长输入 >30 字符截断：头 10 + 中 10 + 尾 10（含 surrogate 对分支，翻译 tk 与指数 token 同族）
token 形态：<固定seed时间戳>_<实时ms>_<base64(AES-CBC-PKCS7(JSON))>，JSON 绑 ua/url/platform/clientTs/version
写死的固定 seed 是可过期参数（源码注释自认"请求失败请更新"）→ 交付必须定位 seed 生成来源，禁止照抄
```

### 密钥来源两形态（下发 / 常量派生）
```
动态下发型：sign = md5(常量盐拼 KV 串) 只为调密钥下发接口，响应返回 secretKey/aesKey/aesIv
识别信号：keyid / secretKey / aesKey / aesIv / pointParam（pointParam 声明签名覆盖的字段集）
排查分支：JS 里找不到密钥来源时，先查前置接口响应是否下发密钥，再回 JS 死磕
常量派生型：密钥常量伪装成 URI 样式（xxx://query/key/…），md5 后 hex 截 16 字节当 AES-128-CBC key/iv
两形态可在同一站点并存（不同接口不同密钥形态），两条线都要查
```

### 混淆特征
```
_0x（OB 混淆）
switch-case 状态机 + while(true)（控制流平坦化）
eval(...) / new Function(...)（打包）
200KB+ 文件 + 字节码数组（JSVMP）
String.fromCharCode(...) 拼敏感属性名（103,116,107 = "gtk"，静态明文检索盲区）
\xHH 十六进制转义 + b('0x..') 字符串数组索引（OB 变体）
```

### RSA 家族（浏览器侧签名常见两形态）
```
确定性 RSA-1024（JSVMP 内嵌 JSBN，字节码尾部 28-bit limbs 字面量 m324665p2098959...，
固定 0x01 PKCS#1 填充，hex2b64 非标准编码）→ match28：Node BigInt 模幂纯算
随机 RSA-1024（混淆 JS 内嵌 JSEncrypt，X.509 SPKI hex 公钥 30819f300d06092a864886f70d01...，
crypto.getRandomValues(Uint32Array 256) 随机填充源，标准 base64 172 字符）→ match27：
Node crypto.publicEncrypt(RSA_PKCS1_PADDING) 纯算；明文含未知常量用候选 X×公钥扫描实证
```

## 按反爬类型分类

### 签名型反爬（环境即签名）
- 瑞数（nmpa 等）
- Akamai
- Shape Security

**特征**：redirect_chain 反复 412/302 → 200
**路径**：补环境（sdenv 纯 Node.js）

### 行为型反爬（参数签名 + 拦截器）
- 抖音
- TikTok
- 字节系

**特征**：HTTP 200 正常加载 + webmssdk
**路径**：路径 D 环境伪装（补环境）

### 纯混淆（无环境检测）
- obfuscator.io 类
- 各类小站

**特征**：`_0x` 大量前缀
**路径**：AST 反混淆 + 通用流程

## 验证码家族（封装层本 skill / 识别求解参考 web-verify-patcher）

| 类型 | 特征 | 处理 |
|---|---|---|
| 极验 geetest3/4 | gt.js / challenge / w 参数 | 封装层本 skill（references/captcha/）；识别求解参考 web-verify-patcher |
| 顶象 dingxiang | dx 验证码 | 同上 |
| 网易 yidun | 易盾验证参数 | 同上 |
| 同花顺验证码 | 验证码组件 | 同上 |
| Cloudflare Turnstile | cf-turnstile | 同上 |
| hCaptcha | h-captcha | 同上 |
| reCAPTCHA | g-recaptcha | 同上 |

验证码场景分层处理：封装层逆向（verify 接口加密参数/轨迹加密）走本 skill `references/captcha/` 子域；题型识别与图像求解参考 `web-verify-patcher`（源自 xbsReverseSkill）。

## T1 识别信号路由表（自 SKILL.md 迁入）

> 识别指纹 → 初始路径；识别≠协议复现，协议细节以本次 case 证据与厂商知识库为准。
> 识别结果必须引用落盘资源、NDJSON 或网络包具体字段，不以站点名称直接定类。

| 信号 | 初始路径 |
|---|---|
| md5、sha、aes、hmac、SM2/SM4/SM3 | 定位入口后优先纯算法还原 |
| 代码碎片含知名库路径/常量（crypto-js 的 ./cipher-core/./evpkdf 等） | **库家族优先**：原样执行原码 + diff 魔改点，标准件不重逆（match22） |
| `_0x`、obfuscator.io、控制流平坦化 | AST 反混淆工具链处理（命令入口见下方），再判断是否可纯算 |
| 200KB+、while-switch、dispatcher、字节码数组 | JSVMP 黑盒执行或最小环境复现，不反编译；**先查 RuyiTrace eval 分类日志落盘源码**（规则 39/反模式 37/match29），无落盘再扫字节码尾部大数字面量判断标准算法族（规则 35/match28） |
| 128B 密文 + 字节码尾部大数字面量 / X.509 SPKI hex + `getRandomValues` | RSA 族：JSBN 确定性（trace 拼接串逆明文、hex2b64）或 JSEncrypt 随机（SPKI 即公钥 DER，`publicEncrypt` 直出，token 每次不同属预期）——两形态细节见 `references/crypto/algorithm-families.md`（规则 35/38，match27/28） |
| WebAssembly、wasm base64、webpack 内嵌 wasm | 先整包黑盒，不默认补完整浏览器、禁止先手撕字节码；wasm-bindgen（`__wbg_*` 导入）原样还原 glue（match20，陷阱见路径 C） |
| 官方包 200 / 重建包必 500——同机同页同输入下唯一变量是 JS 包 | **自同构校验** → 停止环境层修补，转透明边界捕获 + 直接 wasm harness（规则 41~43/反模式 39/40） |
| 厂商/站点特征（webmssdk/byted_acrawler/bdms、geetest/smcp/dx-captcha/TCaptcha/NECaptcha、h5st/js_security_v3/JA3-JA4、sdenv 等） | 先查 `references/crypto/algorithm-families.md` 站点速查表与识别关键词，按厂商先例导航初始路径；验证码按封装层/答案层/verify 链分层（注意 `byted_acrawler.sign` 多返回老版 `_signature`，`a_bogus`/`X-Bogus` 由 `bdms` 生成，不可混淆） |
| 参数/状态输入在 trace 中无 writer，或依赖上一次会话、iframe/worker 上下文、渲染产物 | 浏览器隐蔽信道排查，见 `references/web/covert-channel.md` |
| `Salted__` 魔数、keySize/iterations+盐常量碎片 | OpenSSL Salted 格式：EvpKDF-MD5 派生 key/iv 多块链（match22 案例） |
| obfuscator **短名混淆**（无 `_0x`）+ 解码器 `charCodeAt(变量+常量)` | **toString 自引用解码**：AST 产物禁执行，原码执行 + 一行导出桩（反模式 31/match23） |
| 多组输入签名/token **低雪崩**（不同输入仅个位变化甚至同输出） | 结构化魔改哈希或环境分支，优先原码执行 + 环境分支对齐（反模式 29/31、规则 29） |
| 签名/token **成对或周期性相同**（如 page2/3 相同） | 先做字节级折叠分析（字符级掩码/取模折叠相邻字符，match26），真机与服务端一致时非沙箱 bug |
| @font-face/FontFace、woff/woff2 动态字体、PUA 码点（U+E000–U+F8FF） | 字体映射反爬：取证字体资源判静态/动态映射再提取 cmap（`references/rendering/font-anti-crawl.md`） |

> 与上文「识别关键词」配合使用；厂商精确名只在本文件出现，通用 workflow 文档只写指针（SKILL.md 第 3 节厂商知识分级）。
