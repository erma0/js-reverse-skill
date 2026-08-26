# Case：eval 下发的字符串加法混淆 cookie（猿人学第13题）

> 难度：★
> 还原方案：A 纯算还原（定向表达式求值）
> 实现语言：Python
> 最后验证日期：2026-08-26
> 平台类型：match.yuanrenxue.cn（猿人学练习平台）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`document.html:744` 同步 `$.ajax({url:'/api2/13', async:false, success:function(data){eval(data)}})`；挑战脚本由服务端每次下发，静态 JS 文件中不存在
- 参数特征：Cookie `yuanrenxue_cookie` = `<10 位秒级时间戳>|<随机串>`，值长度每次不同（实测 50~203 字节），无本地算法
- 混淆特征：`document.cookie=('y')+('u')+(([] + ![])[1])+...` 纯字符串加法，原子仅四类——字面量 / `([] + ![])[i]`("false") / `([] + !![])[i]`("true") / `({} + "")[i]`("[object Object]")
- 请求特征：`GET /api/question/13?page=N&pageSize=10&kw=`（**无 m 参数**）；提交 `POST /a/13` 表单编码 `{answer}`
- 干扰特征：页面 hook 了 `$.ajax` 并在 url === `/api/match/13` 时写 `window.match13`；`m:window.match13` 求值为 undefined 被 jQuery 丢弃，真实请求里没有 m
- 反调试特征：无

## 加密方案

- 路径：A 纯算还原
- 框架：不使用
- TLS 客户端：requests（无 TLS 指纹校验）
- 核心思路：每页请求前 `GET /api2/13`，用定向表达式求值器（正则 + 顶层 `+` 切分 + 四类原子查表）解出 `document.cookie` 赋值串，写入 session cookie jar 后拉数据。不调用 eval / JS 引擎，遇未知原子显式抛错。

## 踩坑记录

1. **坑：终态过滤用宽正则 `--targets-regex "api/[^/]*13"`** → 先命中 `/api/topic_info?href=13`，取证在数据接口之前收尾，`api/question/13` 只留元数据无响应体。正确做法：终态用完整路径子串 `--targets "api/question/13"`，避免误命中 `href=13` / `api2/13`。
2. **坑：去 `case/js/original/` 翻挑战脚本** → 脚本是 eval 出来的，静态文件里根本没有。正确做法：先看 `case/ruyi-trace/logs/eval/trace_eval_process_*.ndjson`——RuyiTrace 把 eval 编译的动态代码单独落盘为 `eval_<pid>_<seq>_eval-direct.js` 并带 stack 顶帧（本例直指 `match/13:744`），一步拿到 builder 全文 + entry 行号。这是 cookie 型题目最快的定位路径。
3. **坑：想用 `node -e` / Python `eval` 直接执行挑战脚本** → 原子有限，写 ~30 行定向求值器更简单也更安全（不执行服务端下发的任意代码）。
4. **坑：把 `m:window.match13` 当成签名参数去逆** → 参数名存在 ≠ 参数生效。先看 capture 的 target-hits 或 trace 的 xhrNative `url` 里是否真有该 query；本题请求侧全明文。
5. **坑：缓存解出的 cookie 复用** → 令牌一次性且逐次校验，缺失/过期直接 `400 {"error":"token failed"}`。每页请求前重新拉 `/api2/13`（与浏览器 `req()` 行为一致）。
6. **坑：`case/scripts/` 下的对照脚本用 `..` 拼项目根** → 脚本在 `case/scripts/`，回退项目根需两级。

## 可验证事实清单（经验资产）

1. 反向对照：同 session 去掉 `yuanrenxue_cookie` 请求数据接口 → `400 {"error":"token failed"}`，证明该 cookie 必需且服务端逐次校验
2. 末页 UA 对照最直白：page=5 普通 UA 返回 `["请","将","UA","改","为","yuan","ren","xue","哦"]`，UA=`yuanrenxue` 返回 10 个整数
3. 数据绑定 sessionid：同 sessionid 3 轮运行答案恒为 27121856，可作签名正确性自检
4. 提交 `POST /a/13`，`application/x-www-form-urlencoded`，body `answer=<总和>`，成功响应 `{"result":"success","created":true,"code":2,"exp":70}`
5. 无蜜月期、无需开窗、无 TLS 指纹校验，`requests` 直连全通
6. trace `cookieWrites` 记录（source=document.cookie，name=yuanrenxue_cookie）是确认 writer 的最短证据；`cookieSetAttempts` 与 `cookieWrites` 成对出现

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/trace-flow.md` | eval / dynamicCode 捕获的第四种用途：服务端下发的挑战脚本全文 + entry 行号（本 case 实测） |
| `references/network/dynamic-resource.md` | 一次性令牌类动态资源禁止缓存 |
| `cases/yuanrenxue-match-index.md` | match 系列题号速查（末页 UA 红线、sessionid 数据绑定为多题共性） |
| `cases/yuanrenxue-match9-dynamic-cookie2.md` | 同为 cookie 型题目：match9 是本地 RSA 算法，本题是服务端下发令牌，对比可快速判型 |