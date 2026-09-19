# Case：obfuscator.io string-array + 魔改 SHA-256 VM 沙箱黑盒签名链（码上爬平台题10）

> 难度：★★★★
> 还原方案：B vm 沙箱黑盒（整体加载 pagination10.js + 补环境直接调用 OOOO 函数）
> 实现语言：Node.js
> 最后验证日期：2026-09-19
> 平台类型：mashangpa.com（码上爬）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：`pagination10.js`（215387B 单行，obfuscator.io 混淆，`_0x` 前缀 + 顶部字符串数组 + 旋转 IIFE）；入口函数 `OOOO(url)` 生成 64 hex 签名 `t`
- 参数特征：URL 查询参数 `t`（64 hex，32 字节，类 SHA-256 输出长度）；响应体为**明文 JSON**（`current_array` 直接返回，无加密）
- 请求特征：GET `/api/problem-detail/10/data/?page=N&t=<64hex>`，带 referer(/problem-detail/10/)、`x-requested-with: XMLHttpRequest`、sessionid cookie
- 反调试特征：obfuscator.io string-array + self-defending 同家族；setInterval 死循环 + jQuery ajaxPrefilter 注入
- **关键识别信号**：标准 `crypto.createHash('sha256')` 对相同输入输出**不同** → 算法被魔改，无法用标准库替代

## 加密方案

- 路径：B vm 沙箱黑盒（整体加载目标 JS + 补浏览器 API stub）
- 框架：Node.js vm 模块
- TLS 客户端：Node https 直连（无 TLS 指纹白名单）
- 核心思路：pagination10.js 内含魔改 SHA-256 算法（`OOOO(url)` → `xo(url+mask)` → `xooo(sha256_digest)` → 64 hex），标准 `crypto.createHash('sha256')` 输出不匹配。将整个 pagination10.js 加载到 Node.js vm 沙箱，补全浏览器 API stub（jQuery/$、document、navigator、XMLHttpRequest 等），直接调用 `OOOO(url)` 生成签名 `t`。响应无加密，直接 JSON 返回 `current_array`。

## 沙箱补环境要点

1. **jQuery/$ stub**：`$.ajaxPrefilter` 必须打桩（pagination10.js 会注册 ajax 拦截器），否则报错
2. **setInterval 阻断**：`setInterval: () => 0` 打桩阻止脚本内死循环
3. **XMLHttpRequest 空操作**：`this.open = () => {}; this.send = () => {}; this.setRequestHeader = () => {};`
4. **window 自引用**：`sandbox.window = sandbox` 防止 undefined
5. **document/navigator/location 最小化 stub**：createElement/getElementById/querySelector 等返回 Proxy 对象
6. **crypto 空对象**：`crypto: {}`（不提供标准实现，让脚本用自己的魔改版本）

## 踩坑记录

1. **坑（标准 SHA-256 输出不匹配）**：一度尝试用 `crypto.createHash('sha256')` 重写 OOOO，但输出与浏览器样本不同。正确做法：识别为魔改算法后直接走 VM 沙箱黑盒，不浪费时间尝试标准算法组合。
2. **坑（VM stdout 缓冲导致脚本"挂起"）**：`console.log` 输出在 Node.js 非 TTY 模式下被缓冲，脚本实际已完成但输出未刷新。正确做法：用文件写入（`fs.writeFileSync`）替代 `console.log` 输出关键结果，或在 `process.exit(0)` 前显式刷新。
3. **坑（answer 动态变化）**：服务器每次请求返回随机数组，答案不固定。首次用旧答案 97664 提交返回"答案错误"。正确做法：每次提交前实时拉取 20 页并计算当前和。
4. **坑（submit 需先遍历所有页）**：直接获取 CSRF token 提交返回"暂无答案, 请依次翻页到最后一页..."。正确做法：先顺序请求 page=1..20（用签名 t），再获取 CSRF token 并立即提交（1 分钟有效期）。
5. **坑（pagination10.js 路径错误）**：`path.join(__dirname, 'original/...')` 在 result/ 目录执行时路径错误。正确做法：用 `path.join(__dirname, 'src', 'original', 'pagination10.js')` 或相对于脚本位置定位。

## 可验证事实清单（经验资产）

1. `OOOO('/api/problem-detail/10/data/?page=1')` = `5119c0673e8c2a17b5bb94430340b741d9576457d2a07caf0dc91dd40f4e19de`（64 hex，与取证样本逐字节一致）
2. 页 2/3/10/20 t 值确定性验证通过（同 URL 同 t）
3. 标准 `crypto.createHash('sha256')` 对相同 URL 输入输出不同 → 确认魔改
4. VM 沙箱加载 pagination10.js（215KB）72ms 完成，OOOO/OOXX/hoo 均为 function
5. 20 页 × 10 个数 = 200 个数，每次请求数组随机生成，答案需实时计算
6. 提交流程：顺序翻页 page=1..20 → 获取 CSRF token → POST `/problem/10/submit/` → 返回 `{"status":"success","message":"答案正确，加10积分..."}`
7. 答案有效期 1 分钟，超时需重新计算
8. 同平台题 7（MD5+SHA256+AES）、题 8（卷积+btoa）、题 10（魔改 SHA-256）签名链**完全不同**，证实"平台题号升级逐条核对，不跨题复用算法"

## 相关参考

| 参考文档 | 关联点 |
|---------|--------|
| `cases/ob-string-array-selfdefending-mashangpa.md` | 同平台题7：签名链完全不同，证实同平台逐题核对 |
| `cases/ob-string-array-purealgo-mashangpa-p8.md` | 同平台题8：签名链完全不同，b-io 变体可零执行 |
| `references/env/env-object-model.md` | VM 沙箱补环境策略 |
| `references/hooks/anti-debug.md` | self-defending 反调试家族 |
| `references/workflow/trace-flow.md` | RuyiTrace 定位入口（OOOO 函数） |
