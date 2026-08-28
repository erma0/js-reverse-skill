# Case：WASM 确定性签名 + 纯协议直跑（猿人学第15题）

> 难度：★
> 还原方案：C WASM 加载（Node 原生 WebAssembly，无补环境）
> 实现语言：Node.js（https + WebAssembly）
> 最后验证日期：2026-08-28
> 平台类型：match.yuanrenxue.cn（猿人学练习平台）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：页面内联 JS 直接 `fetch('/static/new_match/question/15/main.wasm')` 加载 WebAssembly；无混淆、无 JSVMP、无环境检测，签名构造逻辑完整暴露在 document.html 内联 script（约 712-769 行）
- 参数特征：`m = encode(t1,t2) + '|' + t1 + '|' + t2`（`encode` 为 wasm 导出函数 `(i32,i32)->i32`，返回值转十进制字符串）
- 请求特征：`GET /api/question/15?page=N&pageSize=10&kw=&m=...`；page5 要求 UA=yuanrenxue（否则返回中文提示数组而非 400）
- 反调试特征：无（纯 WASM 确定性签名题）
- 风控特征：数据**绑定 sessionid**（答案随登录用户变化）；服务端校验 t1 时效（须真实当前时间）

## 加密方案

- 路径：C WASM 加载
- 框架：Node.js 内置 `WebAssembly` + `https`（无第三方依赖）
- TLS 客户端：不发真实请求（Node 原生 https 直连，无 TLS 指纹校验）
- 核心思路：wasm 无外部导入、纯确定性 → `WebAssembly.instantiate(fs.readFileSync('main.wasm'))` 直接执行 `encode`；`t1 = floor(Date.now()/1000/2)`、`t2 = t1 - floor(random()*50+1)`，拼 `m` 后带 sessionid 拉 5 页求和
- 服务端校验语义：重算 `encode(t1,t2)` 与 m 首段比对 + 校验 t1 时效性；wasm 实例可复用（encode 无跨调用状态依赖）

## 踩坑记录

1. **坑：wasm 内联 base64 手工复制进 final.js → 静默损坏 → 400 token failed**（同一逻辑临时脚本 200、final.js 400，曾被误归因"时间窗口/服务端时间"，重跑临时脚本确认后才核对出内联 base64 被写坏、md5 不符）。正确做法：长 base64 用程序注入（读文件→base64→替换占位符）并注入后 md5 核对原始 wasm（`0c602212...`）；或直接以独立文件 `result/wasm/main.wasm` 加载（本 case 采用，同时规避代码质量门禁对超长内联行的误判）。详见反模式 25。
2. **坑：Node 全局 fetch 混用 `https.Agent` → 请求异常/400**（undici fetch 与 node:https Agent 不兼容，两者不可混传）。正确做法：要么纯 fetch 不传 agent，要么纯 `https.request({ agent: SESSION_AGENT })`（本 case 采用 keepAlive 连接池 + 结束 `destroy()`）。
3. **坑：第 5 页仍用普通 UA → 返回陷阱数组而非数据**（`["请","将","UA","改","为","yuan","ren","xue","哦"]`，HTTP 200 不报错，极易当成业务数据）。正确做法：page5 单独用 UA=`yuanrenxue`，并对每页响应做 `isNumeric` 校验兜底，非数字即告警。
4. **坑：sessionid 缺失 → 数据异常/无权限**。正确做法：外置 `config.json` 或环境变量读取，不硬编码进交付脚本。

## 可验证事实清单（经验资产）

1. 固定 sessionid 下 5 页加和稳定 **26550965**（sessionid `p4av26i0hl3t4dar70r5icog4vytlguo`，2026-08-28 实测）；数据绑定 sessionid，换登录用户答案变化
2. `encode` 对相同 `(t1,t2)` 确定性输出，同一 wasm 实例可跨请求复用（无跨调用状态）
3. wasm 无外部导入（`WebAssembly.Module.imports()` 为空）、3854 字节、md5 `0c602212bf68561c639b9ff99b3913e5`
4. `t2` 范围 `[t1-50, t1-1]`（`t2 = t1 - floor(random()*50+1)`）
5. 第 5 页普通 UA 返回中文提示数组（HTTP 200、data 非数字）；UA=`yuanrenxue` 返回 10 个数字
6. 各页小计：5,240,297 + 6,063,912 + 5,225,737 + 4,551,540 + 5,469,479 = 26,550,965
7. 提交 `POST /a/15` 表单编码（`answer` 字段），响应 `code===2` 通关、`code===1` 已做过

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/decision-tree.md` | 题型判定 + 路径决策（WebAssembly 信号 → 路径 C） |
| `references/workflow/common-pitfalls.md` | 反模式 25（交付物内联黑盒资源完整性：程序注入 + hash 核对）本 case 实证 |
| `references/env/env-wasm.md` | WASM 加载通用指南（先验证 I/O 不反编译、imports 检查） |
| `references/network/dynamic-resource.md` | 黑盒资源抓取纪律（二进制抓取 + 版本校验，match9），与反模式 25 闭环为"抓取→内联→交付"全链路 |
| `cases/yuanrenxue-match12-inline-btoa.md` | 同源题型：先读 document.html 内联 script 再谈文件级分析 |
| `cases/yuanrenxue-match-index.md` | match 系列速查（sessionid 数据绑定、末页 UA 红线） |
