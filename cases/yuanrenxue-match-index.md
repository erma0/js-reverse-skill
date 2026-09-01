# 猿人学 match 题号速查

> 面向"按题号刷题"场景：输入题号即可定位技术特征与已有案例。只收录已实测的题号；未做过的题走正常流程，解完后再补案例与经验沉淀。
> 平台更新后个别题可能有变，解题前仍按 CASE_LOOKUP/取证流程核实最新结构。
> 平台级共性（请求/提交链路、末页 UA、sessionid 绑定、getTime 时间源、诱饵参数惯例、风控底座、token failed 语义）统一见 `cases/yuanrenxue-match-platform.md`；本表只做题号 → 特征 → 案例的速查路由，详细事实以各案例文件为唯一真源。

| 题号 | 题名/特征 | 技术要点 | 案例文件 | 还原方案 | 最后验证 |
|---|---|---|---|---|---|
| 4 | 雪碧图、样式干扰 | 无签名参数；j_key 干扰图过滤 + `index+left/8.5` 排序 + 像素哈希字典识别 | `cases/yuanrenxue-match4-sprite-pixelsort.md` | A 纯算还原 + DOM ground truth | 2026-08-23 |
| 5 | 修改版 MD5 + WAF Cookie | 魔改 MD5（`XMLHttpRequest.DONE*4` 分组步长，缺 XHR 时步长退化 1 = token failed 根因）；vm 跑 decoded5.js；蜜月期同第 6 题 | `cases/modified-md5-xhr-done-yuanrenxue.md` | B vm 沙箱补环境（纯协议） | 2026-08-24 |
| 6 | AAEncode 混淆 + RSA 签名 + 蜜月期风控 | AAEncode 段仅产出 `window.o=1`（幌子）；m=二次 URL 编码的 RSA-1024("1\|"+t)；q 单段链即可（**多段链反被拒**）；jsbn `am` 初始化 try-catch 吞错需手动挂回 | `cases/yuanrenxue-match6-aarcsa-honeymoon-risk.md` | B vm 沙箱补环境 + curl_cffi（纯协议） | 2026-08-24 |
| 7 | 动态字体（随风漂移） | 内嵌 base64 TTF + PUA 码点；`glyf.flags` md5 指纹跨字体固定 → 指纹字典还原；requests 直连无 TLS 检测；**差异：勿开窗**（开窗 HTML Set-Cookie 重置登录态 → 提交 401） | `cases/yuanrenxue-match7-dynamic-font.md` | A 纯算还原（内容还原型，Step 2 豁免） | 2026-08-24 |
| 9 | 动态 Cookie m（RSA+循环前缀） | m=prefix+RSA(ts)+循环前缀（N=2~5 随机）走 cookie；udc.js **定期更新**须二进制抓最新；signer **禁缓存 RSA**（缓存版 8/8 失败，无缓存循环加密稳定过） | `cases/yuanrenxue-match9-dynamic-cookie2.md` | B vm 沙箱补环境（纯协议） | 2026-08-25 |
| 10 | 瑞数 v3 变种 boot+api2 配套解密 | boot 与 api2 **必须同次渲染配套**（跨渲染混用 → m 动态段全零）；**m 出现 qqq 零值填充段 = 补环境不完整信号**（曾误判 TLS 封死已推翻）；每页回写 k.k；每页都要 m（与 match9 不同） | `cases/yuanrenxue-match10-ruishu3-replay-defense.md` | B vm 沙箱补环境 + D 环境伪装（Node 原生 https） | 2026-08-26 |
| 12 | 入门级 js（内联明文签名） | `m=base64("yuanrenxue"+page)` 内联 document.html——**先读文档流再做 JS 文件级分析**；同时是 trace 信号/多进程合并/验证记录三工具坑的实测来源 | `cases/yuanrenxue-match12-inline-btoa.md` | A 纯算还原（requests 直连） | 2026-08-26 |
| 13 | 入门级cookie（eval 下发混淆 cookie） | 挑战脚本静态 JS 不存在，靠 RuyiTrace eval 落盘拿全文；混淆原子仅四类可穷举求值器；令牌一次性禁缓存 | `cases/yuanrenxue-match13-eval-cookie.md` | A 纯算还原（requests 直连） | 2026-08-26 |
| 14 | 动态 Cookie m/mz（指纹数组+哈希签名） | `mz=btoa(53 字段指纹数组)`、m 含 window.n 计数器（**须持久沙箱**，每页重建 → page2+ 400 而页 1 巧合通过）；服务端只校验 mz↔m **自洽**（指纹少量差异不影响）；改 UA 时指纹 UA 同步 | `cases/yuanrenxue-match14-fingerprint-cookie-m-mz.md` | B vm 沙箱补环境（持久沙箱，Node fetch） | 2026-08-28 |
| 15 | WASM 确定性签名 | main.wasm **无导入纯确定性**，Node `WebAssembly.instantiate` 直跑 encode(t1,t2)，无需补环境；wasm 内联 base64 须程序注入 + md5 核对（手贴损坏 → token failed 误归因时间/会话） | `cases/yuanrenxue-match15-wasm-deterministic-signature.md` | C WASM 加载（Node 原生） | 2026-08-28 |
| 16 | webpack 混淆包签名（模块黑盒） | 模块切片黑盒执行（127 混淆 MD5/732 变形 base64）；`n.g=globalThis` 缺失 → **静默走错分支，格式全对但服务端拒**；charAt 越界是算法语义；m 定长 57，中间 32 位才是签名本体 | `cases/yuanrenxue-match16-webpack-blackbox-branch.md` | B 最小 JS 沙箱（模块切片） | 2026-08-28 |
| 17 | 天杀的 Http2.0（传输层约束） | 请求侧**全明文零签名**（m:window.match17 是诱饵）；约束在传输层 = HTTP/2：Node `node:http2` 单 Session 复用、不发 accept-encoding | `cases/yuanrenxue-match17-http2-transport-plaintext.md` | A 纯算（无算法）+ E 传输层（http2） | 2026-08-28 |
| 18 | jsvmp 洞察先机（鼠标门控） | 内联 jsvmpzl VM **等真实鼠标事件**（不派发 → 静默不签名）；内建须自有属性 / webdriver 须挂原型；VM 不签 page 字面值 1/5 → **末页 page=05 + UA 双重校验** | `cases/yuanrenxue-match18-jsvmp-mouse-gated-signature.md` | B vm 沙箱黑盒 + D 环境伪装 | 2026-08-28 |
| 19 | 乌拉乌拉乌拉（TLS 指纹黑名单） | 请求/响应全明文（诱饵 m 丢弃机理在 `$.ajax` 深拷贝 `copy!==undefined` 守卫）；**Node https/http2 全 400 = 服务端 TLS ClientHello 黑名单**，跨客户端栈对照一轮定位 → 切 Python requests 交付 | `cases/yuanrenxue-match19-tls-fingerprint-blocklist.md` | A 纯算 + E 传输层（Python requests） | 2026-08-29 |
| 20 | 2022 新年挑战（wasm-bindgen） | glue 原样还原 + 桩语义：`instanceof_Window` 须 true、document/body 非空，否则 **wasm trap unreachable**；wasm 从 /api2/20 运行时二进制拉取（取证 streaming 无字节）；口径=全部 5 页求和 | `cases/yuanrenxue-match20-wasm-bindgen-sign.md` | C WASM + B 最小沙箱（glue） | 2026-08-29 |
| 21 | 守心（SM3 变体 + 诱饵分支） | SM3 变体常量真机提取；Function.toString 环境自检**双算法分支**——Firefox 内核走诱饵变体（浏览器自身 400，格式全对但被拒）；桩须 nativize；token 与 accept-time 头**同源同值** | `cases/yuanrenxue-match21-sm3-variant-decoy-branch.md` | A 纯算（真机常量）+ B 沙箱对拍 | 2026-08-29 |
| 22 | 魔改标准算法（OpenSSL Salted） | token=b64("Salted__"‖盐‖AES-256-CBC(EvpKDF-MD5,now+page)) 过逆练 MD5 变体；**base64 字母表环境分支**（同密文字节不同密文串）；TLS 指纹白名单（curl_cffi 过）；[Unforgeable] 沙箱探针；第 2 次计算反调试死循环（采样一次/会话） | `cases/yuanrenxue-match22-openssl-salted-alphabet-branch.md` | A 纯算 + B 沙箱 + 桥式交付 | 2026-08-29 |
| 23 | js混淆源码乱码（自引用解码） | toString 自引用解码器——**AST 反混淆产物禁执行**（重写即解出垃圾/死循环），原码执行 + 一行导出桩；IV/移位表/加法器多处环境分派逐分支 trace 对齐（Firefox 缺 WindowProperties → fallback 属预期） | `cases/yuanrenxue-match23-selfref-decoder-env-dispatch.md` | B 最小沙箱（原码执行） | 2026-08-29 |
| 24 | vmpzl 黑盒 + XOR 30 状态偏移 | 沙箱与浏览器唯一差异 = TL[11..] **恒差 XOR 30**（一次性状态偏移就地修正，非逐环节对齐）；Node 被 TLS 拒 → 桥式交付；**按页构建**才能落 2~4s 时效窗口；token 生成环境 UA 同步 | `cases/yuanrenxue-match24-jsvmp-blackbox-tl-xor30.md` | B vm 沙箱黑盒 + E 桥式交付 | 2026-08-31 |
| 25 | 控制流扁平化 VM 混淆 token | x 函数黑盒执行；**403 根因 = 环境桩在主 realm 定义致 `window.window` 自检失败误走诱饵分支**——环境桩必须在 `vm.runInContext` 内运行；服务端不校验时间窗口（T 偏移矩阵实测） | `cases/yuanrenxue-match25-cfa-vm-blackbox-env-realm.md` | B vm 沙箱黑盒（Node https） | 2026-08-31 |
| 26 | SM3 魔改（8 组环境分派 IV） | 与 match21 同族，分派扩到 8 组 + strToBytes 偶数化（page2/3 token **成对相同非 bug**）；取证浏览器必 403（内核诱饵分支）勿重采；页面自驱动翻页（jq 桩缓存 + 手动触发 click） | `cases/yuanrenxue-match26-sm3-blackbox-page-drive.md` | B vm 沙箱黑盒（Node https） | 2026-08-31 |
| 28 | JSVMP 内嵌确定性 RSA-1024 | 字节码尾部 **28-bit limbs 直读模数，纯算无需跑 VM**；确定性 padding（固定 0x01）可本地逐字节对拍；hex2b64 是 JSBN 自定义编码非标准 base64；**限流第 3 页起 403 非签名错**（单请求诊断区分） | `cases/yuanrenxue-match28-jsvmp-rsa-purecompute.md` | A 纯算（Node BigInt 模幂） | 2026-08-31 |
| 27 | js混淆源码乱码（JSEncrypt 随机 RSA） | 内嵌 X.509 SPKI 公钥直读 + `publicEncrypt` 直出（随机填充每次不同属预期）；明文常量 X 由**候选 X×公钥扫描**实证；**沙箱跑通 + 结构像 ≠ 服务端接受**（document.all 分支致常量算错，可纯算即转纯算） | `cases/yuanrenxue-match27-jsencrypt-random-rsa-purecompute.md` | A 纯算（Node publicEncrypt） | 2026-09-01 |
| 29 | js混淆源码乱码（vmpzl 全 VM 化） | 三脚本全 vmpzl VM 化：**RuyiTrace eval 日志落盘业务源码**（绕开 LZ/字节码/VM 三层直读逻辑）；魔改 MD5（K 表缺失 + 46 项探测）不可纯算黑盒执行；counter 随翻页递增 + 每次翻页注入新 now | `cases/yuanrenxue-match29-vmpzl-eval-log-source.md` | B 最小沙箱（黑盒执行 eval 源码） | 2026-09-01 |

## 用法

- 刷题前：`node scripts/search_cases.js <题号或技术关键词>` 命中案例则重读踩坑记录 + 可验证事实清单，按最新结构核对后沿用。
- 首次做某题：正常走完整流程，完成后同步新增 `cases/` 案例 + 更新本表 + 追加 index.json 索引。
- 命中案例后仍须按 SKILL.md 状态机走完整流程，不得直接照搬算法（平台可能升级）。
- 风控底座（蜜月期开窗、限流节奏、token failed 多义性、sessionid 数据绑定、末页 UA）等平台共性统一见 `cases/yuanrenxue-match-platform.md`。**各题风控配置独立，不是照搬步骤**——差异题示例：match7 无蜜月期且勿开窗、match10 每页都要 m 且页面加载重置 sessionid、match21 无 TLS 拦；迁移任何预热/开窗步骤前先直接请求一次数据接口验证是否必要（反模式 18）。

## 相关参考

- `cases/_template.md`：新增案例骨架。
- `references/rendering/image-content-reversal.md`：图片型内容反爬通用方法（match/4 核心）。
- `references/rendering/font-anti-crawl.md`：字体反爬通用方法（match/7 核心：内嵌形态识别、字形指纹法、ground truth 验证阶梯）。
- `references/network/ip-risk-control.md`：会话状态类风控识别专节（蜜月期/惩罚计数/数据绑定 session 基线，match/5/6/9/10 实测）。
- `references/network/dynamic-resource.md`：黑盒加密 SDK 定期更新专节（公钥随版本轮换 + 二进制抓取纪律，match/9 核心，match10 rs.js/api2 同理）+ 会话配套资源专节（boot 与 api2 同次渲染配套，match10 实测）。
- `references/env/env-detect-bypass.md`：瑞数 v3 环境检测对齐探针法（match10 终局验证路径）。
- `references/env/env-object-model.md`：元素语义真实化（`<a>` href 真实 URL 解析 + meta content 真实值回填，match10 实测）。
- `references/hooks/anti-debug.md`：沙箱执行侧输出劫持（jsjiami 覆写 console.log，match/9 实测）。
- `references/workflow/experience-rules.md`：规则 21（DOM ground truth）+ 规则 10（签名哈希常量篡改降级信号）+ 规则 22（黑盒执行禁止缓存复用）+ 规则 24（黑盒执行禁止预填状态快照，match10 实测）+ 规则 25（指纹对齐验收线是"参数自洽"非"逐字节复刻"，match14 实测）+ 规则 26（webpack bundle 模块切片黑盒执行：切片定界 + 隔离作用域 + require 桩 + 反调试处理，match16 实测）+ 规则 27（请求侧无签名的三条判据 + 传输层题型：Node http2 要点 match17 实测、跨客户端栈对照法与交付语言切换 match19 实测）+ 规则 28（JSVMP 沙箱静默退出双层插桩定位法 + 语义级环境对齐清单，match18 实测）。
- `references/workflow/common-pitfalls.md`：反模式 16（补环境死循环诊断，含插桩 while(1) 禁令，match10 实测）+ 反模式 19（数据差异未先验 session 基线，match9/10 实测）+ 反模式 20（VM 卡死后转投浏览器黑盒取数，match10 为主体，含终局修正后记）+ 反模式 11（外部失败未验证签名内容就归因 TLS/会话强绑定，match10 为主体）+ 反模式 23（签名含服务端不可复算随机量 → 分支判定失败信号）+ 反模式 24（请求序号计数器随沙箱重建被重置，match14 双实证）+ 反模式 25（交付物内联黑盒资源完整性：wasm/base64 程序注入 + hash 核对，失败先 diff 两版本差异点，match15 实证）+ 反模式 26（抠代码后分支静默漂移：宿主/打包器注入对象缺失导致走错分支，格式全对却被拒，match16 实证）+ 反模式 27（诱饵参数：参数名存在 ≠ 参数生效，`m` 恒 undefined 被序列化/深拷贝层丢弃仍去逆算法，match7/13/17/19 四次实证且 match19 修正丢弃机理——`$.ajax` 深拷贝 `copy!==undefined` 守卫而非 `$.param`）+ 反模式 28（环境语义级偏差 → JSVMP 沙箱静默退出：内建非自有属性 / webdriver 误为自有属性 / 鼠标事件门控未派发，match18 实证）。
- **接口路径随站点版本变化**：老题解里的 `/api/match/N` 多已改为 `/api/question/N`，外部老题解只作假设，接口路径一律以本次抓包为准（详见平台共性篇 §1）。
- `cases/yuanrenxue-match22-openssl-salted-alphabet-branch.md`：match22 案例本体（OpenSSL Salted + 字母表分支 + TLS 白名单 + [Unforgeable] 全细节见案例文件）。
- `cases/yuanrenxue-match-platform.md`：平台共性知识库（本表所引共性条目的完整版与实证题号标注）。
