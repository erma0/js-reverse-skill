# Case：拼多多 anti_content 黑盒 fbeZ + 签名内嵌环境检测 flag 逐位对齐

> 难度：★★★★
> 还原方案：D 环境伪装（webpack 兼容运行时黑盒执行真实 SDK + 环境检测对齐）
> 实现语言：Node.js
> 最后验证日期：2026-08-23
> 平台类型：pinduoduo.com / apiv2.pinduoduo.com

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：webpack4 chunk（`window.webpackJsonp.push`）内 `fbeZ` 模块为字符串数组混淆 SDK（`W("0x..","salt")` RC4 动态解键，数组 281 次轮转）；内嵌 pako/msgpack 自包含子 bundle，外部仅依赖 `8oxB`（timers 垫片）与 `YuTi`（webpack 模块垫片）
- 参数特征：`anti_content` 超长 GET 查询参数（约 320~330 字符），`0aq` 开头，标准 base64 表（输出 `+`→`-`、`/`→`_`、去 `=`），**尾部追加 1 个盐字符**
- 请求特征：签名前有 `GET /api/server/_stm` 取 `server_time`（13 位毫秒）；SDK 生成时写入配对 `_nano_fp` cookie（前缀 `XpmJnqTy`），值内嵌进 anti_content
- 反爬特征：fbeZ `Wt()` 19 位环境检测（`window.Buffer`、`navigator.plugins.length`、`navigator.hasOwnProperty("webdriver")`、`document.getElementById.toString().indexOf("native code")`、PhantomJS/Electron/WebGL renderer 等），**检测结果嵌入签名由服务端校验**；业务失败返回 HTTP 403 + `{"error_code":40002}`

## 加密方案

- 路径：D 环境伪装
- 框架：vm（自建 webpack4 兼容运行时）
- TLS 客户端：Node https（H1 即可，keep-alive Agent）/ curl-cffi（firefox 系）
- 核心思路：不反混淆、不重写算法，直接运行真实 SDK 本体——伪造 `window.webpackJsonp` push 注册 commons.js + subject.js 两个 chunk 后 `require("fbeZ")`，调用 `new factory({serverTime}).messagePackSync()`；服务端校验签名内嵌环境检测 flag，用「探针对齐法」把 Node 沙箱 flag 修到与真实浏览器逐位一致后纯协议 8/8 通过。

链路（`subject.js` 的 `jomW.getGoods()`）：

```text
d = ".../query_tf_goods_info?tf_id=..&page=..&size=.."
d += "&anti_content=" + await Object(x.a)()      // x = n("TPp2")
TPp2.a = m() -> v(): 先 await l()（GET /api/server/_stm 取 server_time，失败回退 Date.now()）
                    再 return r.messagePackSync()  // r = new n("fbeZ")({serverTime})
```

序列化本质：msgpack + 压缩 + 自定义状态机 base64（标准表、尾部加盐），捆绑环境 flag、serverTime、配对 `_nano_fp`。**解码逆推成本高且无必要**——黑盒执行 + 检测对齐即可通过。

## 踩坑记录

1. **坑 1：用过期（取证时抓的）浏览器签名做对照实验，得出「40002 是连接层 TLS/h2 风控、纯协议不可绕过」的错误结论，转而交付浏览器内核取数方案** → 正确做法：内嵌 serverTime 的签名有有效期，对照实验必须用**新鲜**签名（取证后立即重放，记录采集→重放延迟）；正确对照显示浏览器新鲜签名经 curl_cffi 重放 = 200，连接层无问题。
2. **坑 2：注入实验证明服务端校验签名内容后，先入为主假设需要复现 canvas/行为轨迹等完整浏览器指纹，差点放弃纯协议** → 正确做法：先测量 SDK 实际内嵌什么（见「对齐探针法」），实测只差 4 个可修复的检测位，不需要 canvas/行为数据。
3. **坑 3：沙箱 `for (const k of Reflect.ownKeys(global)) win[k] = global[k]` 全量注入 Node 全局，泄露 `window.Buffer` 被 `Wt()` flag[2] 识别** → 正确做法：白名单注入标准全局（Math/Date/JSON/parseInt...），显式排除 Buffer/process/require/setImmediate 等（`references/network/node-leakage.md` 基线）。
4. **坑 4：`navigator = { webdriver: false }` 造成自有属性，`navigator.hasOwnProperty("webdriver")` = true 被 flag[14] 识别（真实 Firefox 定义在原型上）** → 正确做法：webdriver 移到原型 getter；对象形状（自有/继承属性）与取值同等重要。
5. **坑 5：沙箱 `navigator.plugins = {length:0}` 与 `document.getElementById` 为普通 JS 函数（toString 无 `[native code]`）分别被 flag[8]/flag[17] 识别** → 正确做法：填充真实 Firefox 插件（OpenH264/Widevine，length>0）；DOM 方法做 native toString 伪装（`env-native-protection.md` 默认基线）。
6. **坑 6：静态提取混淆字符串数组做 RC4 解码，正则匹配到了 pako 内嵌子模块的短数组，键索引越界产出乱码** → 正确做法：解键优先在**运行中的 SDK**上注入导出解码函数（如 `window.__fbezW = W`），在浏览器/沙箱内直接调用，不要静态正则抠数组。
7. **坑 7：ruyipage `add_preload_script` 传 IIFE 字符串静默不执行（无报错）** → 正确做法：传**函数声明字符串** `"() => {...}"`；hook 里设置标记（`window.__hookInstalled`）并在解读实验结果前验证标记，防止「注入未生效但把页面自身行为当成实验结果」。
8. **坑 8：Windows 下裸 `python` 命中 WindowsApps stub（exit 9009）** → 正确做法：用 `py -3` 或环境检查（GATE-1）选定的解释器跑后续脚本。

## 签名内嵌环境检测的对齐探针法（本案例核心方法）

当服务端校验「签名内嵌的环境检测结果」（黑盒无法从密文反推哪个字段被校验）时：

1. **注入导出**：在 SDK 源码的稳定锚点（如 `var de=new se;`）后注入 `window.__fbezWt=Wt;`（导出检测函数），Node 侧加载同一份注入版。
2. **浏览器采样**：ruyipage 空白页（取证用途）跑同一加载器（伪造 webpackJsonp + 两 chunk + require fbeZ），调 `__fbezWt()` 得真实浏览器 ground-truth（本例 `[0,0,0,0,0,0,0,null,0,0,0,0,1,1,0,0,0,0]`）。
3. **沙箱采样 + 逐位 diff**：Node 沙箱同样调用，diff 出差异位（本例 index 2/8/14/17）。
4. **翻译差异位**：在浏览器里用导出的解码函数 `W("0x..","salt")` 解出检测项语义（本例解出 `window.Buffer`、`plugins`、`webdriver`、`native code`、`ipcRenderer`、`_phantom` 等 101 个键），按检测项修环境。
5. **复测**：flag 逐位一致后重新生成签名做真实验证。

配套的**风控分层定位矩阵**（先定位拦截层再修）见 `references/network/ip-risk-control.md`。

## 可验证事实清单（经验资产）

1. `anti_content = new fbeZ_factory({serverTime: server_time_ms}).messagePackSync()`，`server_time` 来自 `GET https://apiv2.pinduoduo.com/api/server/_stm`（毫秒）。
2. fbeZ 编码为标准 base64 表，输出替换 `+`→`-`、`/`→`_`、去 `=`，尾部追加 1 个盐字符；生成值长度 320~330，前缀 `0aq`。
3. SDK 每次生成写入配对 `_nano_fp` cookie（前缀 `XpmJnqTy` + 随机段）；浏览器持久化复用已有值，沙箱空 cookie 时新生成。
4. 业务接口无 Cookie 也可 200（浏览器抓包目标请求 request_headers 无 cookie 字段）；`api_uid` 由业务接口**自身响应** Set-Cookie 种下，不是前置条件。
5. `Wt()` 为 19 元素数组（index 7 恒为 null/未设置），对齐后浏览器与沙箱输出完全一致。
6. 4 个差异位修复项：白名单注入排除 `window.Buffer`（flag[2]）、`navigator.plugins.length>0`（flag[8]）、webdriver 定义在原型非自有属性（flag[14]）、`document.getElementById.toString()` 含 `[native code]`（flag[17]）。
7. 环境对齐后 **Node 原生 https（HTTP/1.1 + keep-alive Agent）即可 200**——无需 TLS 指纹库；此前 H1/curl_cffi/tls_client 全 403 是签名内容问题，不是连接指纹问题。
8. 签名容忍本地时间与 `_stm` 偏差 <20ms，`--request` 缺省用 `Date.now()` 可通过。
9. 对齐后的纯协议验证 8/8：Node H1 5/5 + curl_cffi(firefox/firefox135) 3/3，每次 39 商品。

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/network/ip-risk-control.md` | 风控分层定位矩阵（新鲜签名对照 + 注入反向对照） |
| `references/env/env-detect-bypass.md` | 环境检测绕过清单 + 对齐探针法 |
| `references/env/env-native-protection.md` | native toString / 描述符 / 原型链默认基线 |
| `references/network/node-leakage.md` | Node 泄露阻断（Buffer/process 白名单注入） |
| `references/workflow/common-pitfalls.md` | 反模式 11/12（本案例两次误判的泛化） |
