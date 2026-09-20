# Case：Body 内 `h5` 签名 = 京东 h5st v5.0（js-security-v3 RAC 算法下发型）整包移植（码上爬平台题16）

> 难度：★★★★
> 还原方案：B 最小 vm 沙箱黑盒执行站方 `PcSign.js` + 其运行时注入的 `js-security-v3-rac.js` 本地副本；
> 摘要算法由上游服务端实时下发 ⇒ **不追闭式**；上游请求经 Node `https` 网络桥接
> 实现语言：Node.js（`node:vm` + `node:https`，零第三方依赖）
> 最后验证日期：2026-09-20
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- 入口页特征：详情页 HTML 专属分支 `if (problemId === 16) document.head.appendChild(<script src="/static/js/PcSign.js">)`；
  另有通用 `pagination16.js` 动态注入与 `script.onload → loadPage(1)`
- JS 特征：`PcSign.js` 459798B / 10672 行**多行**（obfuscator.io 家族：`a04afa8n` 字符串表解码器 + RC4 式
  `_$R` 还原 + 常量写成算术表达式 `-0x14ea*0x1+...`），尾部明文 `window.Sign = _$lk` 与
  `window.PcSign = new window.Sign({appId:"b5216", preRequest:!1, onSign:…})`；
  `pagination16.js` 37118B **单行 safekodo V8.2.8**（同题14 `xhr.js` 家族）
- 血统特征（判定"这是移植版不是自写"）：`appId=b5216`、`fv=h5_file_v5.0.6`、
  `POST cactus.jd.com/request_algo` + `POST cactus.jd.com/behavior_report`、
  localStorage 键 `JDst_rac_last_update`/`JDst_behavior_flag`/`WQ_dy1_vk`/`WQ_gather_cv1`/`WQ_gather_wgl1`
  ⇒ 与 `cases/jsvmp-h5st-js-security-v3-jd.md` 的键名、接口、字段结构完全一致
- 参数特征：签名在 **POST body 的 `h5` 字段**，`h5 = base64(h5st + String(t))`，恒 **948 字符**；
  `h5st` 为 9 字段分号串 `<17位日期串>;<fp16>;b5216;<tk>;<64hex>;5.0;<13位ms>;<base64url 采集体>;<尾段>`
- 请求特征：`POST /api/problem-detail/16/data/`，body 是**裸 JSON 串** `{"page":N,"t":<ms>,"h5":"…"}`，
  `content-type: application/x-www-form-urlencoded; charset=UTF-8`（jQuery 传字符串时不改默认 content-type）
  + referer + `x-requested-with` + `sessionid`
- 拒绝特征：**HTTP 200** + `{"code":"400","message":"小菜鸡，别爬了"}`（72B；题13/14/15 记录为「小鸡」，
  **同平台文案会变，按前缀匹配不要全等**）；成功 200 + 617B（键 `problem`/`pagination`/`current_array`）
- 取证特征：取证浏览器**一次都不发**目标请求（3 轮定制 Firefox 含 UA 覆盖 + 1 轮日志采集内核，每轮 20 包），
  而 Node(V8) 沙箱同文件同入口跑通 ⇒ 引擎级分歧（`env-detect-bypass.md` 的 C 形态）

## 加密方案

- 路径：B 最小 JS 沙箱黑盒（+ 上游网络桥），**无闭式**：摘要函数体来自 HTTP 响应
- 框架：`vm.createContext` + context 内 realm 脚本（不可配置 `window/self/top/parent/frames` 与 realm 构造器）
- TLS 客户端：Node 原生 `https`（目标接口与 JD 上游首连均 200，实测**无 TLS 指纹层**，
  区别于 `cases/jsvmp-h5st-js-security-v3-jd.md` 中 `api.m.jd.com` 的 JA3/JA4 校验）
- 链路：

```text
source  ：script.onload → loadPage(1)                                  [document.html:302-307]
entry   ：pagination16.js `function loadPage(page)`（safekodo 包，可直调）
builder ：t = Date.now() → window.PcSign.sign({page:N, t:t})
          PcSign.js:10634-10646  sign(opt){ var x=this._$sdnmd(opt); return resolve(btoa(x.h5st+String(x.t))) }
                                    └─ _$sdnmd = while-switch 字节码 VM（静态还原不可行）
          _$sdnmd 运行中：createElement('script') 注入 js-security-v3-rac.js?v=<yyyyMMdd>
                          → POST cactus.jd.com/request_algo
                              req {version:"5.0", fp, appId:"b5216", timestamp, platform:"web",
                                   expandParams, fv:"h5_file_v5.0.6", localTk}
                              res data.result.{tk, fp, algo}
                                   algo 字面即 `function test(tk,fp,ts,ai,algo){var rd='…';
                                         return algo.MD5(''.concat(tk).concat(fp).concat(ts).concat(ai).concat(rd));}`
                          → POST cactus.jd.com/behavior_report（行为采集上报，响应 rFlag/cFlag 回写 localStorage）
writer  ：$.ajax({url:"/api/problem-detail/16/data/", method:"POST", data:'{"page":N,"t":t,"h5":…}', dataType:"json"})
```

## 踩坑记录

1. **坑（黑盒 SDK 的 Promise 永不 settle，被读成"被反调试拦了"）**：沙箱里 `sign()` 5 轮全挂、零报错，
   第一反应是环境被检测、要去逐字段对齐 canvas/plugins。真因是 SDK 自带 **asap 调度型 Promise**
   （`MutationObserver` + `MessageChannel` 驱动），而桩写成 `observe(){}` 空实现 ⇒ `resolve` 永不排上。
   补泵（`Promise.resolve().then(cb)` + `setInterval(cb,4)`）+ `MessageChannel`/`setImmediate`/`postMessage` 后 round 1 即出值。
   → 见规则 50 与 `env-debug-loop.md`「异步死等」。**与「`run_with_trace.js` 的 setTimeout 桩不执行回调」是两条不同根因**。
2. **坑（沙箱 XHR 回调抛错被 Promise 吞掉，症状与坑 1 完全相同）**：`done()` 里裸 `fire('readystatechange')`，
   SDK 处理器一抛错就进 rejection 黑洞。桩的事件回推必须逐个 try/catch 并记 `xhr.handler-error`。
3. **坑（`--ua` 覆盖被当成万能解，白烧一轮）**：改成 Chrome/141 UA 后包谱 20 包逐位同构、行为不变
   ⇒ 不是 UA 串判定。内核级分歧要靠**换执行环境**（沙箱直调）而不是换 UA。
4. **坑（"页面能打开、脚本都在跑"当成"签名链在跑"）**：`PcSign.js`/`js-security-v3-rac.js` 全 200、
   `behavior_report` 也 200，看着一切正常，但 data 请求 0 次。
   → 用 **localStorage 键位序列**当 SDK 进度探针：浏览器停在 `WQ_gather_cv1`/`WQ_gather_wgl1`/`JDst_*_nfd`，
   从未走到 `request_algo`（`ruyitrace-cheatsheet.md` §6.3）。比看请求列表早一步，零额外采集。
5. **坑（交付进程不退出被误判成签名卡死）**：`node final.js --sign-only | tail` 迟迟无输出，
   实则值已全部打印——SDK 挂的长周期 `setInterval` 吊住了事件循环，管道也就看不到 EOF。
   → 改用 `timeout N node final.js --sign-only` 不经管道直判退出码；交付侧定时器统一登记、`close()` 清空。
6. **坑（把上一题的宽松结论外推）**：题15 实测"伪造内容体照样过"，本题**伪造同长度 `h5` 直接拒**（打靶 #4）。
   链长与校验强度无因果，深度只能由「服务端能否复算」+「算法是否本地可得」定（规则 32 第 4 条 + 规则 51）。
7. **坑（失败处理器自身抛错导致静默无结果）**：`PcSign.js` 构造期传入的 `onSign` 回调体是
   `a.colorApi.postDraData(...)` 而 `a` 全作用域不存在 —— 沙箱实测 `window.PcSign._onSign({code:704})`
   直接抛 `ReferenceError: a is not defined`。签名一旦走失败分支，Promise 既不 resolve 也不 reject。
   这是整包搬运京东 SDK 时留下的死脚，不是本地环境问题；**看到"签名没出来"先确认它没走 catch**。
8. **注意（无真机 oracle 时的证据义务）**：本题 Step 1 永久缺失，不能靠"沙箱自己生成、自己对拍"宣布一致。
   合规形态 = fixture 固化为**结构基线** + 服务端接受作逐字节级 oracle + **伪造被拒**作反向证据（规则 52）。

## 可验证事实清单（经验资产）

1. `loadPage(N)` → `PcSign.sign({page:N, t:Date.now()})` → `$.ajax` POST，body 裸 JSON
   `{"page":N,"t":<ms>,"h5":base64(h5st+String(t))}`；`h5` 恒 948 字符、`h5st` 恒 9 字段。
2. `h5st` 第 7 字段（13 位 ms）由 **SDK 内部自取**，与调用方传入的 `t` 可差数毫秒 —— 真机同现象；
   ⇒ 逐字节不可复现，结构基线是唯一稳定的回归面。
3. 服务端实测规则（11 次单变量打靶）：验 `h5` 的**密码学有效性** ∧ `|h5 内 ts − now| < ~600s`；
   **不验** body `t` 是否存在；`page` 传字符串亦过；**无一次性绑定**（同 body 可重放）；
   匿名会话（无 `sessionid`）过验签但 `current_array` 退化为非数组 ⇒ 题面数据与会话绑定。
4. 摘要算法与远程 token 来自 `request_algo` 响应（`data.result.algo` 是 JS 源码串、`data.result.tk`）；
   本地沙箱内 `sign()` 稳定耗时 ~20ms/次。
5. 交付沙箱最小环境（P0，缺一即不 settle 或不出值）：调度四件套（`MutationObserver`/`MessageChannel`/
   `setImmediate`/`postMessage`）+ 语义完整且异常可见的 `XMLHttpRequest` + 真实上游网络桥 +
   `localStorage`/`sessionStorage` + `document.cookie` 可读写 + `createElement('script').src` 注入回调 +
   `btoa/atob` + `navigator`/`location` + context 侧 realm 全局。
   **不需要**：`WebAssembly`、`Worker`（`js-security-v3-rac.js` 内两者计数为 0）、真实 jQuery、
   canvas/WebGL 真值、`pagination16.js`（请求形态在交付侧显式重写）。
6. 答案口径：20 页 × 10 项 = 200 项全量求和、不去重；分钟轮换（实测 96938 / 97140）；
   `pageIntervalMs=0` 无频率墙；本次成功答案 **96938** → `{"status":"success","message":"答案正确，加10积分..."}`。
7. 提交链：`POST /problem/16/submit/`，multipart（`csrfmiddlewaretoken`+`user_answer`）+ `x-csrf-token` 头，
   csrf 取详情页隐藏 input；三态 `success` / `info`(已完成=此前已成功，退出码 0) / `error`(答案错)。
8. `check_final_artifact.js` 自动化扫描口径（本次实测并已修）：注释由 `stripComments` 豁免，
   但代码里的**字符串字面量仍会命中**（取证内核名写进交付代码的说明性常量即判失败）；
   `.json` 曾全部入扫且只豁免 `验证记录.json` 一个文件名 ⇒ `manifest.json` 的 `captureTool` 误判。
   现收窄为「代码文件 + `package.json`」。教训：取证工具名留在 `case/notes/` 与 `result/*.md`，
   交付代码的说明性文字不要写工具专有名。

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `cases/jsvmp-h5st-js-security-v3-jd.md` | 同族上游（京东 h5st）：`_$sdnmd` while-switch VM、`request_algo` 下发型算法、fp/tk 会话绑定；本 case 是其"平台移植版 + 无 TLS 指纹层"分支 |
| `references/env/env-debug-loop.md`「异步死等：签名 Promise 永不 settle」 | 规则 50 的最小实现与排查顺序 |
| `references/tooling/ruyitrace-cheatsheet.md` §6.3 | storage 键位序列 = SDK 执行进度探针 |
| `references/env/env-detect-bypass.md`「内核级差异检测」C 形态 | 目标请求 0 次时的降级证据形态（跨引擎对照 + 断点定位） |
| `references/workflow/experience-rules.md` 规则 51 | 算法下发型（RAC）= 还原深度止点；与规则 32 第 4 条、规则 49 构成三判据 |
| `references/workflow/experience-rules.md` 规则 52 | 无真机 oracle 时 fixture 的结构基线形态 |
| `cases/obfuscated-url-param-signer-safekodo-mashangpa-p14.md` | 同平台 safekodo 打包器同族；载体与算法互不复用 |
| `cases/cookie-carrier-hexinv-fingerprint-struct-mashangpa-p15.md` | 同平台"链长 ≠ 校验强度"对照样本（本题反向：链短但真验） |
| `references/network/dynamic-resource.md` | 上游动态资源（`js-security-v3-rac.js?v=<yyyyMMdd>`）的抓取 + sha256 校验纪律 |
