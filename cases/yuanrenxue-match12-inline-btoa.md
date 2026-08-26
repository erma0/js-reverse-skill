# Case：页面内联明文 btoa 签名 + 末页 UA 校验（猿人学第12题）

> 难度：★
> 还原方案：A 纯算还原
> 实现语言：Python
> 最后验证日期：2026-08-26
> 平台类型：match.yuanrenxue.cn（猿人学练习平台）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：签名逻辑内联在入口 HTML 的 `<script>` 中（document.html 第 738 行 `m:btoa("yuanrenxue" + p)` 明文可见），无独立加密 SDK、无混淆、无 JSVMP
- 参数特征：query 参数 `m` = Base64("yuanrenxue"+page)，长度 16 且以 `eXVhbnJlbnh1ZT` 开头（"yuanrenxue"+1 位数字的标准 base64 形态）；其余 page/pageSize/kw 全明文
- 请求特征：`GET /api/question/12?page=N&pageSize=10&kw=&m=<base64>`；提交 `POST /a/12` 表单编码 `{answer}`；页面上有 `window.match12 = arguments[0].data.m` 的 hook 遗留（无关干扰）
- 反调试特征：无

## 加密方案

- 路径：A 纯算还原
- 框架：不使用
- TLS 客户端：requests（无 TLS 指纹校验）
- 核心思路：`m = base64("yuanrenxue" + str(page))`，URL 编码后作为 query 参数；5 页数据求和后表单编码提交。签名生成逻辑直接读 document.html 内联脚本即可，无需 JS 文件级分析。

## 踩坑记录

1. **坑：一上来就翻 case/js/original/ 的 JS 文件找签名** → 正确做法：**先读 `case/forensic/document.html` 的内联 script**——入门级题型的 builder/writer 常常整段写在页面里（本题 m 生成与 `$.ajax` 写入点都在 document.html:738），取证已自动落盘，读完即完整证据链。
2. **坑：trace 信号写 `XMLHttpRequest.open` 报 ×0 未命中，误以为 trace 没采到** → 正确做法：RuyiTrace 把 XHR 调用记录为 `{"interface":"XMLHttpRequest","member":"open"}` 分存字段，无连续子串。skill 门禁已支持 `Interface.member` 结构化匹配，直接写 `XMLHttpRequest.open` 即可（2026-08-26 修复）；也可用宽信号 `XMLHttpRequest`。
3. **坑：trace 导入摘要只有 1 行内核记录，直接进 TRACE_RETRY 重采** → 正确做法：先 `LS case/ruyi-trace/logs/domtrace/`——本 case 自动导入只反映了 1 行，实际有 4 个内容进程文件；手动 `import_ruyitrace_log.js --input <各进程文件>` 合并后 10164 行、质量通过。摘要 1 行 ≠ trace 只有 1 行。
4. **坑：末页（page=5）数据返回为空** → 正确做法：match 系列固定红线——最后一页 UA 必须为 `yuanrenxue`（match/4、5、6、8、12 均实测），仅末页生效，其余页普通 UA 即可。
5. **坑：提交接口按 JSON 发送被拒** → 正确做法：页面用 jQuery `$.ajax({data:{...}})`，默认 `application/x-www-form-urlencoded` 表单编码（document.html submit 逻辑取证），提交必须表单编码。
6. **坑：验证记录.json 随手写成自由结构，交付门禁报不合格返工** → 正确做法：按 final-summary.md 的结构契约写——顶层 `mode:"online"` + `attempts` 数组（timestamp/httpStatus/parameterSummary/sessionStage/responseValid 五字段逐条校验）；入口脚本在每次请求时实时写入 attempts，不要交付后手工回填。总结头部记得带 `FINAL_ARTIFACT_NETWORK_MODE=online` / `FINAL_ARTIFACT_TLS_FINGERPRINT=not-required` 机器标记。
7. **坑：check_code_quality 对 Python 报"嵌套层级 14"反复重构仍不降** → 正确做法：那是续行对齐空格被误算成缩进深度（检查器 bug，2026-08-26 已修复为括号感知 + 4 空格标准）；修复后同一文件实测最大嵌套仅 3。Python 交付的中文 docstring 也已认可为文件头职责注释。

## 可验证事实清单（经验资产）

1. `m = base64("yuanrenxue" + page)`；page=1 时 `m=eXVhbnJlbnh1ZTE=`（URL 编码 `%3D`），与抓包逐字符一致
2. 数据接口 `GET /api/question/12?page=N&pageSize=10&kw=&m=<m>`，响应 `{"data":[10 个整数]}`
3. 末页 UA=yuanrenxue 是唯一 UA 校验点（page=5）；其余页任意常规 UA 均可
4. 数据绑定 sessionid：同 sessionid 多轮运行返回完全相同的数字序列（取证样本可复验，是签名正确性的强验证手段）
5. 提交接口 `POST /a/12`，`application/x-www-form-urlencoded`，body `answer=<总和>`；成功响应 `{"result":"success","created":true,"code":2,"exp":70}`；提交过频有封禁风险，交付默认不自动提交（显式 `--submit` 才提交）
6. sessionid 由用户登录态提供，必须作运行参数（CLI/env）传入，不得硬编码
7. xhrNative trace 记录含完整请求 URL（含 query 编码形态），可直接核对签名生成值与实际请求值

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/trace-flow.md` | trace 信号 Interface.member 结构化匹配 + xhrNative URL 核对 + 多进程导入诊断（本 case 实测固化） |
| `references/quality/final-summary.md` | 机器声明标记 + 验证记录 attempts 结构契约（本 case 返工教训固化） |
| `cases/yuanrenxue-match-index.md` | match 系列题号速查（末页 UA 红线、sessionid 数据绑定为多题共性） |
| `references/network/ip-risk-control.md` | 会话状态类风控（数据绑定 session 基线验证） |
