# Case：动态 Cookie m——RSA(ts) + 循环前缀（猿人学第9题）

> 难度：★★★（算法简单，但三个隐蔽坑导致纯协议极易失败）
> 还原方案：B vm 沙箱补环境（纯协议）
> 实现语言：Python（curl_cffi）+ Node（vm 沙箱执行挑战代码生成 m）
> 最后验证日期：2026-08-25
> 平台类型：猿人学练习平台（match.yuanrenxue.cn）

---

## 技术指纹（供 CASE_LOOKUP 自动匹配）

- JS 特征：接口响应 `data` 为动态混淆 JS（obfuscator 变体 + jsjiami v5 字符串表 `$b` 解码）；
  挑战代码含 `if(global)` 反检测、`debugger`、`Function('{}.constructor("return this")()')` 等反调试；
  浏览器页面引用的 `udc.js`（719KB，jsjiami v5）定义 RSA 加密函数 `window.decrypt = _0x4f6d79`
- 参数特征：请求侧仅 `page/pageSize/kw` 明文 + `sessionid` cookie + **动态 cookie `m`**；
  `m` 走 cookie 传递（页面 `m: window.match1` 参数实为 undefined，旧逻辑残留可忽略）
- 请求特征：`GET /api/question/9?page=N&pageSize=10&kw=`；首次无 m 请求返回挑战 JS；
  sessionid 由 **API 响应 set-cookie** 下发（非页面）；末页（第 5 页）UA 必须为 `yuanrenxue`
- 反调试特征：挑战代码每次动态混淆；udc.js 会**定期更新**（公钥随之变化，旧副本必失败）；
  jsjiami v5 反调试会**覆盖 console.log**（Node 输出必须用 `process.stdout.write`）

---

## 加密方案

- 路径：B vm 沙箱补环境（纯协议：Node vm 执行 udc.js + 挑战代码生成 m，curl_cffi 提交）
- 框架：不使用
- TLS 客户端：curl_cffi（impersonate=firefox）；无 TLS 指纹层拦截（浏览器原生 m 用 curl 重放同样成功，已排除连接层）
- 核心思路：挑战代码 eval 后设置 cookie `m = prefix + encodeURIComponent(RSA_PKCS1_v1.5(ts)) + 'r'`，
  Node vm 原样执行挑战代码捕获 m，curl 带 m 提交完成 session 验证，验证后直接拉取 5 页

### 还原细节

#### 1. m 算法（脱壳确认，100% 破解）

```js
// 挑战代码脱壳后（$b 字符串表已还原）：
f['hXQSH'] = (n, o) => n(o);       // 调用
f['RRjCj'] = (n, o) => n <= o;     // 循环条件比较
f['esrBr'] = (n, o) => n + o;      // 拼接
f['HnRrE'] = '; path=/';           // cookie 后缀

try { if (global) { f['hXQSH'](decrypt, '<ts>'); } } catch (n) { global = new Array(); }
window = new Array();
for (var m = 1; f['RRjCj'](m, <N>); m++) {        // m <= N，循环 N 次（N=2~5 随机）
  res = f['esrBr'](decrypt('<ts>'), 'r');         // res = decrypt(ts) + 'r'
}
document['cookie'] = 'm=' + (m - 1) + res + '; path=/';
```

**`m = prefix + encodeURIComponent(RSA_PKCS1_v1.5(ts)) + 'r'`**
- `ts`：挑战代码 `decrypt,'(\d+)'` 提取（服务端注入 Unix 秒时间戳）
- `prefix`：循环次数 N（= 循环结束 `m-1`），2~5 随机，**必须执行挑战代码获取**（不能只提取数字，比较运算符随机）
- RSA 公钥：udc.js 内 PKCS#8（392 字符）；明文 = 裸 ts（hook `JSEncrypt.prototype.encrypt` 参数确认为 ts）

#### 2. 签名器实现（signer_http.js 常驻服务）

- 启动时 Node vm 加载 udc.js 一次（拿到 `_0x4f6d79`），HTTP POST `/sign` 提交挑战代码返回 m
- 挑战执行沙箱：删除 `global` 模拟浏览器（`if(global)` 抛 ReferenceError 进 catch）；
  注入 `document`（捕获 cookie setter）、`navigator`、`location`、`window/self` 等
- **关键：decrypt 不得缓存**——挑战循环 N 次调用 decrypt，浏览器每次真实 RSA 加密（随机 padding），
  `res` 取最后一次结果。缓存版（复用 1 次加密）实测 8/8 失败，无缓存版稳定通过

#### 3. session 验证与拉取

- 固定 sessionid → 请求 page1 → 返回挑战 → 生成 m → 带 m 提交（失败重试 ≤8 次，间隔 2s）
- session 验证通过后**每页无需 m**，直接拉 page1~5（page5 UA=yuanrenxue）
- 数据绑定 sessionid：固定 sessionid → 数据固定 → **答案不变（27848571）**

---

## 踩坑记录

1. **坑：udc.js 定期更新，本地副本公钥过期** → m 密文服务端解不开，永远被拒。
   修复：每次运行**二进制抓取**最新 udc.js（`urlopen().read()` + `wb` 写回）。
2. **坑：udc.js 用 `decode('utf-8', errors='ignore')` 下载会丢字节损坏文件** → md5 变化、公钥损坏、
   m 无效且难以排查。修复：全程二进制处理（`read()` 字节 + `wb`）。
3. **坑：signer 缓存 RSA 结果（循环 N 次只加密 1 次）** → 缓存版 8/8 提交失败；
   无缓存版（N 次真实加密取最后一次）稳定通过。服务端校验的是**挑战代码语义**，
   任何"性能优化"改变 m 语义都会失败。
4. **坑：jsjiami v5 反调试覆盖 `console.log`** → Node 里 `console.log(m)` 输出为空（exit 0 无输出）。
   修复：输出一律用 `process.stdout.write`。
5. **坑：误判「平台数据按周期重置」** → 实际是**数据绑定 sessionid**：匿名 session 每次不同数据就不同；
   固定 sessionid 数据恒定。答题类先确认 session 基线。
6. **坑：误判「TLS 指纹层拦截」** → 浏览器原生 m 用 curl_cffi 重放同样成功，连接层无拦截；
   真正根因是 udc.js 过期 + signer 缓存 + session 差异（对照实验正反双验，见 SKILL.md §10）。

---

## 可验证事实清单（经验资产）

1. `GET /api/question/9?page=N&pageSize=10&kw=` 首次无 m 返回挑战 JS（data 为字符串）；
   带正确 cookie m 返回 `{data: [10个数字]}`；sessionid 由 API 响应 set-cookie 下发
2. m 算法 = `prefix + encodeURIComponent(RSA_PKCS1_v1.5(ts)) + 'r'`；prefix=挑战循环次数 N（2~5 随机）
3. 挑战代码每次动态混淆（`$b` 字符串表 + `f` 工具函数对象），循环条件/比较运算符/ts 均随机
4. udc.js（`/static/new_match/question/9/udc.js`）会更新（2026-08-25 站点 md5=5aeae9...），
   公钥随版本变化；必须每次运行二进制抓取
5. 浏览器页面 `m: window.match1` 参数实为 undefined（旧逻辑残留），m 实际走 cookie 传递
6. 数据绑定 sessionid：固定 sessionid `p4av26i0hl3t4dar70r5icog4vytlguo` → 答案 27848571 不变
7. session 验证通过后每页无需 m 直接拉取；page5 UA 必须为 `yuanrenxue`
8. 提交接口 `POST /a/9` data=`{"answer": <总和>}`（需微信扫码登录）

## 经验资产

- 交付脚本：`yuanrenxue-match9/result/final.py`（一键运行）、`signer_http.js`（常驻签名服务）
- 完整复盘：`yuanrenxue-match9/result/逆向分析报告.md`（含三个关键坑与可复用方法论）
