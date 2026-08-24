# Case：修改版 MD5 + WAF Cookie 纯协议还原（猿人学第5题）

> 难度：★★★★
> 还原方案：B vm 沙箱执行（Node 补环境跑 decoded5.js 生成全部参数）
> 实现语言：Python（主入口 curl_cffi）+ Node.js（签名器子进程）
> 最后验证日期：2026-08-24
> 平台类型：猿人学练习平台（match.yuanrenxue.cn）
> 方案演进：2026-07-11 曾降级浏览器提取（puppeteer）；2026-08-24 突破为 vm 沙箱纯协议，零浏览器依赖

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

### JS 特征
- [x] obfuscator.io 风格混淆（字符串数组 + 旋转 + 索引偏移函数）
- [x] 控制流平坦化（CFF，`while(0x1) { switch(...) }` dispatcher）
- [x] charCode 位移编码反 hook（`-76` 正常分支 vs `-2331-h.slice(0,1)*2` 反 hook 分支）
- [x] `window.$_zw` 指纹数组（27 项，含 Date/String/eval/window/document/global 等，**在页面 HTML 脚本中构建，非混淆 JS 内**）
- [x] **内嵌修改版 MD5**（4 个轮函数 F/G/H/I 标准，但 T 常量注入 + 分组步长依赖 `XMLHttpRequest.DONE`）
- [x] CryptoJS UMD 模块加载（页面引入 cryptoJS.min.js，但 m cookie 生成不用 CryptoJS）

### 参数特征
- [x] URL 参数 `m` = `_$is`（签名时刻毫秒时间戳）
- [x] URL 参数 `f` = `Date.parse(new Date())`（整秒时间戳，= `is // 1000 * 1000`）
- [x] cookie `m` = `pr[4]`（修改版 MD5(String(is))，32 位 hex）
- [x] cookie `RM4hZBv0dDon443M` = `AES-128-ECB-Pkcs7(pr.join(','), key)`，`key = btoa(String(is)).slice(0, 16)`
- [x] 第 5 页请求 UA 必须为 `yuanrenxue`（题目硬性要求）

### 请求特征
- [x] 缺/错 cookie `m` 或 `RM4hZBv0dDon443M` 均返回 `{"error":"token failed"}`（同一报错不区分原因）
- [x] 蜜月期：GET `/match/5`（HTML）开约 5 秒窗口，成功请求续期（与第 6 题同机制）
- [x] 页间隔 ≥ 2.5 秒；连续失败 5-10 次进惩罚期（全拒，冷却 10 分钟+）

---

## 加密方案

- **路径**：B vm 沙箱执行（vm 补环境加载 decoded5.js，输出 `{is, m, rm4}` JSON）
- **框架**：Node vm 沙箱（`case/tmp` 早期 JSDOM+api2/5 动态链路在 Node 卡死超时，最终走 5.js/decoded5.js 静态链路）
- **TLS 客户端**：curl_cffi（impersonate=chrome）
- **核心思路**：`pr` 为 5 元素数组（加载期时间轨迹的魔改 MD5 序列，`pr[1..3]` 为连续三次同输入结果）；服务端用 URL `m` 构造 key 解密 RM4 得到 pr，校验 `pr[4] == cookie m` 与时间新鲜度。**pr[0..3] 不需要与浏览器一致**（加载时序轨迹服务端无法校验），`pr[4]` 必须精确。

### 魔改 MD5 关键机制（本题核心陷阱）

- 初始向量：标准 MD5
- **T 表注入**：JSVMP opcode 将 T[12] 位常量替换为 `_$6_ = -0x173848aa`（保存在 `_$rx`），初始值 0x20DC5D57F
- **分组步长陷阱（token failed 根因）**：`_0x42fb36 = XMLHttpRequest.DONE * 4`（= 16，标准 MD5 分组步长）；环境缺 XHR 时 catch 退化为 1，算法彻底偏离
- 补环境必须提供：`XMLHttpRequest`（含静态 `DONE = 4`）、`navigator.connection`、`eval.toString()` 返回 Chrome 单行格式（JSVMP 分支检测）

### 历史降级结论的修正（重要）

2026-07-11 版本曾判定"T[22]/T[26] 被替换为动态时间戳 → 纯算不可还原 → 降级浏览器提取"。后续突破证明：

- **时间冻结对照法**（浏览器 init_script 冻结 Date）证明 pr 不依赖 `$_jd`/`$_tb` 等环境探测值（每次浏览器运行都不同，252/180 项），"动态时间戳常量"并不阻碍可复现性
- 真正的纯算阻断点不是 T 常量，而是**补环境缺 `XMLHttpRequest.DONE` 导致的步长退化**——这属于环境伪装可修范畴（路径 B/D），无需降级浏览器
- 教训：**"标准算法常量被替换为动态值"是降级信号，但降级前先确认动态值是否真的影响可复现性**（冻结对照法一测便知）

## 踩坑记录

1. **坑：XMLHttpRequest.DONE 缺失是全部 token failed 的根因** → MD5 步长退化（DONE*4=16 缺失时退化 1）导致 cookie m 与服务端期望不符；症状与惩罚期/UA/指纹问题全混淆为同一报错，极难定位。正确做法：对照报错先排查补环境静态属性完备性。
2. **坑：早期降级浏览器提取** → 曾因"T 常量动态值"判定纯算不可还原。正确做法：动态值 ≠ 不可复现，用时间冻结对照法验证后再决定降级。
3. **坑：缺 RM4hZBv0dDon443M cookie** → 返回 token failed。WAF cookie 必须携带（AES-ECB 可纯算生成，见参数表）。
4. **坑：$_zw 在页面 HTML 构建** → 在混淆 JS 中找不到定义；需先加载页面取证。
5. **坑：charCode 位移反 hook** → `-76` 是正常分支，`-2331-h.slice(0,1)*2` 是反 hook 分支，不能 hook fromCharCode。
6. **坑：m 参数 vs m cookie 混淆** → URL 参数 m = 时间戳，cookie m = 魔改 MD5 哈希，两者不同。
7. **坑：JSDOM 动态链路卡死** → 早期 api2/5 动态链路（KS 解密执行）在 Node 超时；改走 decoded5.js 静态链路直接生成全部参数。

## 可验证事实清单（经验资产）

1. URL 参数 `m` = 签名时刻毫秒时间戳；URL 参数 `f` = `m // 1000 * 1000`（整秒）
2. cookie `m` = `pr[4]` = 魔改 MD5(String(is))；cookie `RM4hZBv0dDon443M` = `AES-128-ECB-Pkcs7(pr.join(','), btoa(String(is)).slice(0,16))`
3. 魔改 MD5：IV 标准，T[12] 注入 `-0x173848aa`，分组步长 `XMLHttpRequest.DONE * 4`
4. pr[0..3] 不需要与浏览器一致；pr[4] 必须精确
5. MD5 输入纯时间，与指纹无关（$_jd/$_tb 探测值不参与）
6. 补环境必需：`XMLHttpRequest.DONE=4` 静态属性、`navigator.connection`、`eval.toString()` Chrome 单行格式
7. 蜜月期：GET HTML 开窗约 5 秒，成功请求续期；页间隔 ≥ 2.5 秒
8. 惩罚期：连续失败 5-10 次全拒（token failed），冷却 10 分钟+
9. 第 5 页 UA 必须为 `yuanrenxue`
10. 2026-08-24 验证：SUM = 27616481（5/5 页 HTTP 200，纯协议零浏览器依赖）

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `references/workflow/common-pitfalls.md` | 反模式 9（标准哈希常量篡改降级信号，本案例为其修正来源） |
| `cases/yuanrenxue-match6-aarcsa-honeymoon-risk.md` | 同平台第 6 题（同源蜜月期风控 + AAEncode/RSA） |
| `cases/vm-sandbox-custom-algo.md` | vm 沙箱自定义算法骨架（本案例为其具体填充） |
| `references/network/ip-risk-control.md` | 会话状态类风控识别专节（蜜月期/惩罚层） |
