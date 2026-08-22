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
| obfuscator.io 站点 | _0x 前缀 | OB 混淆 | AST 反混淆 + 通用流程 | `assets/ast-patterns/` |
| reese84 站点 | reese84 | Reese84 challenge | AST 反混淆 + 补环境 | `assets/ast-patterns/patterns.md` |
| 极验 geetest4 | w / challenge | geetest4 | AST 反混淆 + 验证码交接 | `assets/ast-patterns/patterns.md` |
| 顶象 dingxiang | dx | dingxiang | AST 反混淆 | `assets/ast-patterns/patterns.md` |
| 网易 yidun | 易盾验证参数 | yidun | AST 反混淆 | `assets/ast-patterns/patterns.md` |
| 同花顺 | token | tonghuashun | AST 反混淆 | `assets/ast-patterns/patterns.md` |
| 小红书 | x-s / x-t | xhs | AST 反混淆 | `assets/ast-patterns/patterns.md` |

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

### 混淆特征
```
_0x（OB 混淆）
switch-case 状态机 + while(true)（控制流平坦化）
eval(...) / new Function(...)（打包）
200KB+ 文件 + 字节码数组（JSVMP）
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
