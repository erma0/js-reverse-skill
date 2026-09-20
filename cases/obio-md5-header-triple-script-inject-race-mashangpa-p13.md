# Case：ob-io 混淆的 `$.ajaxSettings.beforeSend` 三头签名 + 签名脚本注入竞态（码上爬平台题13）

> 难度：★★★
> 还原方案：A 纯算还原（MD5）；取证侧用 B vm 沙箱执行站方原始签名脚本取 writer 真值
> 实现语言：Node.js
> 最后验证日期：2026-09-20
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：入口页 `if (problemId === N) document.head.appendChild(<script>)` 按题号**动态注入签名脚本**
  （本题 `/static/js/jqueryxhr.js`，115447B 单行）；ob-io / cn-bidding 家族：顶部 `function a0_0x…(){…}` 字符串数组
  + `\xNN` 转义 + `'3|0|6|4|2|7|1|5'.split('|')` switch 平坦化；bundle 内嵌 UMD crypto，特征串
  `_ff` / `_gg` / `_hh` / `_ii` / `rotl` / `stringToBytes` / `bytesToString` / `_blocksize`
- 参数特征：请求头三件套 `r`（32 hex 随机盐）/ `s`（32 hex 校验值）/ `t`（13 位毫秒，**毫秒位恒 000**）；
  POST body 为 JSON 串 `{"page":"N"}`，但 `content-type` 仍是 `application/x-www-form-urlencoded; charset=UTF-8`
- 请求特征：`POST /api/problem-detail/13/data/`（本题型为 **POST**，同平台题7 为 GET + `x` 查询参数），
  需 referer + `x-requested-with: XMLHttpRequest` + sessionid cookie
- 拒绝特征：缺签名头 → **HTTP 200** + `{"code":"400","message":"小鸡，别爬了"}`（与题7 同文案；不能按 HTTP 状态码判成功）
- 竞态特征：业务分页脚本（`paginationN.js`，数百字节）在自身 `onload` 里立刻发首屏请求，
  体积大得多的签名脚本尚未执行 → 首屏请求裸发

## 加密方案

- 路径：A 纯算还原
- 框架：不使用（交付侧零依赖；仅取证期用 `run_with_trace.js` 跑站方原始脚本）
- TLS 客户端：Node 原生 `https`（keepAlive Agent，无 TLS 指纹白名单，实测首次直连即通过）
- 核心思路：签名层只是挂在 `$.ajaxSettings.beforeSend` 上的一个函数——
  沙箱里用 `{ ajaxSettings: {} }` 假 `$` 接住它，直接调用即拿到 `r/s/t` 真值，再用 7 组样本反推并锁定 `s = MD5(body + r + t)`。

```js
body = JSON.stringify({ page: String(n) })     // jQuery param 结果被重新 parse 后 stringify，值变字符串
t    = Math.floor(Date.now() / 1000) * 1000    // 站方写的是 Date.parse(new Date())，秒精度
r    = 32 位 hex：每字符 hex[floor(rand*16)]，再把第 14 位固定 '4'、第 19 位固定为 hex[(floor(rand*16)&3)|8]
s    = MD5(body + r + t)                       // 拼接顺序 body → r → t
```

## 踩坑记录

1. **坑（真实浏览器产不出带签名的成功样本，连采 4 轮）**：签名脚本异步注入且体积远大于业务分页脚本，
   首屏 `loadPage(1)` 恒在其之前发出 → 被服务端拒 → 响应缺 `pagination` 字段 → 分页控件不渲染 →
   页面上再没有第二个请求入口。冷/暖缓存均复现，不是缓存假象。
   → 正确做法：识别出「竞态型自阻断」后**停止加浏览器轮次**，改用 `run_with_trace.js` 沙箱执行落盘的签名脚本取 writer 真值，
   最后由服务端接受（业务判定正确）反证闭环。
2. **坑（`--click` 报「选择器未命中」被当成选择器语法问题）**：真实原因是分页 DOM 从未生成。
   → 正确做法：点击前先读 `target-hits.json` / `related-hits.json` 的响应 body，确认渲染分支真的进去了。
3. **坑（HTTP 200 被当终态成功）**：拒绝响应是 200 包业务码 400，`capture.json` 里 `is_failed=false` + `response_status=200`。
   → 正确做法：定性看 body 的 `code` 字段，不看 HTTP 状态码。
4. **坑（`--targets "/api/x/data/"` 一直 NO_TARGET，误判成共享脚本缺陷）**：Git Bash/MSYS 把以 `/` 开头的入参
   静默改写成 `D:/Program Files/Git/api/x/data/`，子串永不匹配。跨轮比对产物时又误读了已被轮转覆盖的 `capture.json`。
   → 正确做法：目标子串**不带前导斜杠**（`--targets "api/x/data"`）或用 `MSYS_NO_PATHCONV=1`；
   判「脚本有 bug」前先打印入参到达进程时的真实值，并核对 `.prev-N` 轮转文件归属哪一轮。
5. **坑（`--preload-script` 驱动页面自有函数翻页）**：箭头函数形会打印「hook 已安装」，但 hook 内调 `loadPage(n)`
   零请求产出（未定位到是 world 隔离还是执行时机；`run_js` 侧同族现象见反模式 11）。
   → 正确做法：取证侧要「页面自己再发一次请求」时，别在 hook 上连环试第 3 轮；一次不产请求就换路线。
6. **坑（自写 Node 客户端 advertise `accept-encoding` 却不解压）**：详情页 gzip → `text` 乱码 → CSRF 正则不命中 →
   误报「Cookie 失效」白跑一轮。→ 正确做法：Node 原生 https 直连不发 `accept-encoding`，或实现解压。

## 可验证事实清单（经验资产）

1. `s = MD5(body + r + t)`，`body = {"page":"N"}`（**值是字符串**），拼接顺序为 body→r→t。
2. `t` 秒精度（毫秒位恒 `000`），源自 `Date.parse(new Date())`；等价 `floor(Date.now()/1000)*1000`。
3. `r` 是随机盐不是数据哈希：锁 `Math.random=0.5` 后 `r` 稳定（`888…4…8`），第 14 位 `'4'`、第 19 位 ∈ `8/9/a/b`（UUIDv4 风格无连字符）。
4. 服务端只回读 `r` 参与 `s` 校验 → 随机盐合法，不属于「签名含服务端不可复算随机量 = 分支走错」（规则见 §反模式 23 族）。
5. 三头缺一即 `{"code":"400","message":"小鸡，别爬了"}`（HTTP 200）。
6. 上线形态是 **form-urlencoded 头 + JSON 串体** 的错配——jQuery 的 `contentType` 在 `beforeSend` 之前已定，站方只替换 `settings.data`。该错配本身即识别此链的强信号。
7. 本题答案口径：20 页 × 10 元素 = 200 项，**全量求和、不去重**。
8. 数组按分钟窗口轮换：同算法两次只读分别得 99300 / 98326 → 取数与提交必须同运行同窗完成。
9. 提交链：`POST /problem/13/submit/`，`multipart/form-data`（`csrfmiddlewaretoken` + `user_answer`）+ 头 `X-CSRFToken`；令牌取自详情页隐藏 input；成功返回 `{"status":"success","message":"答案正确，加10积分..."}`。
10. 沙箱跑 `jqueryxhr.js` 只需 4 类桩：`setInterval`/`clearInterval`（ob-io debug 保护轮询，no-op 即可）、`document`、`navigator`、`$ = {ajaxSettings:{}}`；**不需要真实 jQuery**（链上只用到被赋值的 `beforeSend`）。
11. 首屏被拒时 `updatePageContent` 不进 error 分支（判据是 `data.status === 'error'`，而服务端给的是 `code`/`message`）→ 页面渲染 `undefined` 且不渲染分页。
12. 本题 `t`/`r`/`s` 三个头名单字符，与同平台题7 的 `m`/`ts`/`x`、题9 的 `m`/`tt`、题12 的 `m`/`t` 均不同形——**头名不可跨题复用**。

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/trace-flow.md` | 「翻页点击三个静默失败坑」+「签名脚本注入竞态致浏览器无成功样本」取证降级路线 |
| `references/workflow/common-pitfalls.md` | 反模式 11（未测量就归因，含"判脚本缺陷前先打印入参真实值"形态） |
| `references/tooling/ruyi-tooling.md` | Windows/Git Bash 入参被 MSYS 改写；`--preload-script` 不能代打页面业务函数 |
| `references/workflow/experience-rules.md` | 规则 36（数据每次请求随机 → 同运行取数即提交） |
| `cases/ob-string-array-selfdefending-mashangpa.md` | 同平台题7：同为三头签名但 GET + `x` 查询参数，拒绝文案相同 |
| `cases/jsvmp-sha1-const-table-jscall-args-mashangpa-p12.md` | 同平台题12：头名 `m`/`t` 不同形，答案窗口轮换纪律同源 |
