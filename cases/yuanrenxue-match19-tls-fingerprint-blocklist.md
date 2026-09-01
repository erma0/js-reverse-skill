# Case：请求/响应全明文 + Node TLS 指纹黑名单 + 末页 UA 分流（猿人学第19题）

> 难度：★
> 还原方案：A 纯算还原（无算法，仅 5 页求和）+ E 传输层对齐（客户端栈选择）
> 实现语言：Python（requests；Node https/http2 被服务端传输层指纹黑名单拦截，按证据切换）
> 最后验证日期：2026-08-29
> 平台类型：match.yuanrenxue.cn（猿人学练习平台）
> 平台共性（请求/提交链路、末页 UA、sessionid 绑定、getTime 时间源、诱饵参数惯例、风控底座、token failed 语义）统一见 cases/yuanrenxue-match-platform.md；本文只保留本题差异与专属事实。

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：零混淆零 SDK——页面仅 jquery + UI 库（alert/modallayer/expUp）+ 百度统计 + `general.js`；`favicon.ico` 实为 95KB JPEG 图片（Exif 头），非伪装 JS
- 诱饵拓扑（反模式 27 第五次实证）：内联 script#3 `$.ajax` hook 拦 `/api/match/19`（从未被请求）存 `window.match19`；内联 script#5 `req()` 的 `d={page,pageSize,kw,m:window.match19}` 中 `m` 恒 undefined；`window.request&&window.request()` 恒短路（未定义）
- **诱饵 m 的第三种消亡形态（机理新发现）**：`$.param(d)` 的 debug 文本明明含 `&m=`（trace seq733），但真实 XHR.open URL 无 m（seq814）——丢弃发生在 **jQuery `$.ajax` 内部 `k.extend(!0,{},{ajaxSettings},t)` 深拷贝 options 的 `copy!==undefined` 守卫**，而非 `$.param`（param 对 undefined 渲染空串 `m=`）；`$dbg.text("GET "+API+"?"+$.param(d))` 这类调试输出 ≠ wire URL
- 数据接口：`GET /api/question/19?page=N&pageSize=10&kw=`（N=1..5，TP=5/PS=10 写死在内联脚本#5）→ 明文 `{"data":[10 个整数]}`
- **传输层黑名单（本题主坑）**：Node `https`（http/1.1）与 Node `http2` 客户端无论头部/UA/时序如何复刻，全部 400 `{"error":"token failed"}`；curl（schannel）与 Python requests（OpenSSL）同参数直连 200——服务端按 **TLS ClientHello 指纹**放行/拦截
- 末页 UA 分流：page=5 普通 UA → HTTP 200 提示数组（非 4xx，须按 data 元素类型判别）；UA=`yuanrenxue` → 真实数据
- 风控特征：数据绑定 sessionid（7 个浏览器会话 + 3 轮协议取数逐字节恒定）
- 页面交互细节：翻页按钮在页面自身首屏 AJAX 期间被 `loading(true)` 置 disabled（取证点击被静默吞，见踩坑 5）

## 加密方案

- 路径：A 纯算还原（请求侧/响应侧均明文，唯一"计算"是 5 页 × 10 值求和）+ E 传输层对齐（客户端栈选择）
- 框架：不使用（无沙箱、无补环境——目标 JS 无需执行）
- TLS 客户端：Python `requests.Session`（keepAlive 连接池贯穿 5 页 + 提交，收尾 `session.close()`）
- 核心思路：请求侧明文过"无签名三判据"后**收手**（规则 27），难点转入传输层——Node 全系被拦后用跨客户端栈对照（curl/requests/Node）定位黑名单边界，改用 Python 交付
- 服务端校验语义：仅 sessionid（登录态）+ 末页 UA；无签名/时间戳/挑战 cookie；提交 `POST /a/19` 表单编码 `answer=<加和>`，`code=2` 通关 / `code=1` 已做过 / 其他=答案错误

## 踩坑记录

1. **坑（本题最大认知陷阱）："token failed" 文案 ≠ 令牌参数缺失**（该文案多义、match9 的 m-cookie 才是字面出处，见平台篇）——真实请求里根本没有 token。正确做法：先跨客户端栈对照（同参数分别用 Node/curl/Python 发），curl 与 requests 200 而 Node 400 → 结论是**传输层客户端指纹黑名单**，与任何参数无关。见规则 27 的跨栈对照法。
2. **坑：debug 输出 ≠ wire URL（诱饵 m 消亡机理与历史案例记载不同）**。`$dbg.text("GET "+API+"?"+$.param(d))` 显示 `...&kw=&m=`，`$.param` 对 undefined 渲染空串（`null==n?"":n`），**丢弃发生在 `k.extend(!0,{},{ajaxSettings},t)` 深拷贝的 `copy!==undefined` 守卫**——克隆后的 v.data 根本没有 m 键。反模式 27 原记载"被 `$.param` 丢弃"（match17 归因）不准确：两种记载的净效果相同，但机理判定要认 trace 的 open 参数全文。诊断价值：当"调试显示的参数串"与"实际请求 URL"不一致时，直接查序列化/拷贝链路，不要再找"参数去哪了"的玄学。
3. **坑：Node 交付路径被封死时的客户端栈/语言切换要有证据链**。Node https（http1.1）与 Node http2 双双 400 后，不要立刻给 Node 加 TLS 伪装——先按三级客户端阶梯对照（规则 27）：本题为第二级通过（curl/requests 普通栈 200），证明服务端是**窄黑名单**，普通客户端即可交付（最低可用栈原则，不上指纹伪装）；**若普通栈也全拒而指纹客户端（Python `curl_cffi` 固定 impersonate 档位 / Node `CycleTLS`）通过，则浏览器指纹白名单成立**——那时才用指纹客户端交付。语言选择以"哪个生态的指纹客户端可用且满足 Session 门禁"为准（`curl_cffi.requests.Session` 与 requests 同形，Session 门禁已识别）。
4. **坑：末页提示数组是 200 不是 4xx**（平台通用形态）。判别方式是**检查 data 元素类型**（`typeof v !== 'number'` 即提示数组）；实现里要把该形态显式报错并提示 UA 要求，避免把提示数组当数据求和。
5. **坑（取证工具）：翻页点击落在页面自身 loading 态的 disabled 按钮上，被静默吞掉**。`page.get(wait="interactive")` 在 DOMContentLoaded 即返回，此刻页面把翻页按钮 `prop("disabled",true)`，拟人点击（human_move + 悬停延迟约 1-3s）落在重新启用前则无任何请求、无任何报错，白等 `--wait` 超时。正确姿势（已固化为脚本参数）：`--click-delay 5~30` 让点击等 loading 结束；或 `--manual-pause` + stdin 管道延迟（`( sleep 30; echo ) | python forensic_ruyipage.py ...`）。
6. **坑（取证工具）：属性选择器在 ruyipage `page.ele()` 静默失配**。`css:button.pgx-page[data-page=5]` 查不到元素，`human_click(None)` 在当前位置盲点，日志仍打印"已拟人点击"误导排查。正确姿势：用 id/结构选择器（`css:#pgxNext`、`css:#pgxPages button:nth-child(5)`）；脚本已加"未命中即跳过并告警"防护。产物轮转：多轮取证会覆盖 capture.json/target-hits.json（run4 的 page2 样本曾被 run5 覆盖丢失），脚本现自动轮转 `.prev-1~3`。
7. **坑：`--targets` 用 `page=N` 参数片段而非接口路径**。`question/19` 会误命中静态资源（`static/new_match/question/19/...`）提前收尾；`page=1` 这类查询串片段可唯一锁定数据接口（match17 同款坑）。

## 可验证事实清单（经验资产）

1. 固定 sessionid 下 5 页加和恒 **27219355**（2026-08-29 三轮协议取数 + 4 个独立浏览器会话一致）
2. page1 fixture：`[684723, 428265, 170853, 359912, 836795, 727020, 853660, 829846, 562767, 291715]`；page2 fixture：`[959533, 781482, 265026, 570767, 445462, 937576, 981431, 370933, 966995, 243497]`
3. 数据接口 `GET /api/question/19?page=N&pageSize=10&kw=`，响应 `{"data":[10 个 6 位整数]}`；仅 page 5 要求 `User-Agent: yuanrenxue`
4. Node https/http2 → 400 `{"error":"token failed"}`（content-length 25，与请求头/时序无关）；curl（schannel）/ Python requests（OpenSSL）→ 200
5. `POST /a/19` 表单编码 `answer=<加和>`：`{"result":"success","created":true,"code":2,"exp":81}` 通关；重复提交 `{"created":false,"code":1}`
6. 页面 hook（内联 script#3）仅拦 `/api/match/19`；`window.match19` 恒 undefined；`window.request` 未定义（`window.request&&...` 恒短路）
7. 翻页期间页面把 `#pgxPager` 内全部按钮 disabled，loading 结束（约数百 ms）后恢复
8. trace 双铁证：seq733 `textContent="GET /api/question/19?page=1&pageSize=10&kw=&m="`（debug 文本）vs seq814 `open("GET","/api/question/19?page=1&pageSize=10&kw=",true)`（wire URL 无 m）

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/common-pitfalls.md` | 反模式 27（诱饵参数）第五次实证 + m 消亡机理修正（deep-extend 丢弃，非 $.param） |
| `references/workflow/experience-rules.md` | 规则 27（无签名三判据 + 传输层题型）跨客户端栈对照法扩充 |
| `references/network/tls-validation.md` | TLS 客户端选型与校验（本题为"服务端拉黑特定客户端栈"的反向形态） |
| `cases/yuanrenxue-match-index.md` | match 系列速查（末页 UA 红线第 5 次实证、sessionid 数据绑定） |
| `cases/yuanrenxue-match17-http2-transport-plaintext.md` | 同为"请求侧全明文 + 传输层约束"题型（h2 强制 vs 本题 TLS 栈黑名单）；其 `$.param` 丢弃归因已由本题 trace 修正 |
| `cases/yuanrenxue-match9-dynamic-cookie2.md` | "token failed" 文案的真实来源（match9 的 m-cookie 机制）——本题证伪"文案即病因"的直接迁移 |
