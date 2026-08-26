# 指纹基线一致性规则

本文件在每个新 case 的浏览器取证、指纹采样、RuyiTrace 日志采集、生成 `fingerprint.fixture.json` 或发现指纹冲突时读取。目标是保证同一 case 内所有浏览器证据来自同一套稳定指纹基线，避免多次随机化导致 navigator、screen、WebGL、语言、时区、UA、Client Hints 等互相冲突。

## 硬性规则

- 同一 case 必须维护一个指纹基线文件：`case/notes/fingerprint-baseline.json`。
- 第一次成功取证后立即固化 `baselineId`，后续抓包、Hook、RuyiTrace、指纹采样、fixture 对比、动态资源刷新取证都必须复用该基线。
- 禁止每次打开 ruyiPage 时重新随机一套指纹；不得把不同浏览器、不同 Profile、不同代理地区或不同随机 seed 的样本混用。
- ruyiPage 必须复用同一 case 的 `base_dir`、`userdir`、`smart_fingerprint` 输出和定制 Firefox runtime；RuyiTrace 若不是同一浏览器 / profile，必须先做基线 diff。
- 指纹 fixture、RuyiTrace 摘要、Hook 采样、最终总结都必须记录 `baselineId`。缺少 `baselineId` 或 baseline 文件时，涉及指纹的 case 不能进入最终交付。
- 如果 UA、Client Hints、language、timezone、platform、viewport、screen、DPR、WebGL vendor/renderer、Canvas、Audio、字体、DOM 几何、proxy/IP 地区之间出现冲突，自动重新采样统一基线并宣布后继续；重新采样无法统一才输出卡点、只推进不依赖该基线的分析。不得自动合并。
- 用户明确更换代理、地区、Profile、浏览器工具或登录态容器时，必须生成新的 `baselineId`，旧样本只能作为历史证据，不能和新基线混用。

## 基线文件建议结构

```json
{
  "version": 1,
  "baselineId": "fp-20260627-001",
  "caseId": "",
  "mode": "ruyiPage + RuyiTrace / 用户手动取证",
  "tool": {
    "name": "ruyiPage",
    "profile": "case/tmp/browser-profile",
    "fingerprintSeed": "",
    "browserPathDigest": "只写相对路径或脱敏摘要"
  },
  "network": {
    "proxyCountry": "",
    "ipCountry": "",
    "timezone": "Asia/Shanghai",
    "locale": "zh-CN"
  },
  "navigator": {
    "userAgent": "",
    "language": "zh-CN",
    "languages": ["zh-CN", "zh"],
    "platform": "",
    "hardwareConcurrency": 0,
    "deviceMemory": 0
  },
  "clientHints": {},
  "screen": {},
  "viewport": {},
  "webgl": {},
  "canvas": { "source": "fixture" },
  "audio": {},
  "font": {},
  "createdAt": "",
  "locked": true
}
```

## 采样与 diff 流程

1. 取证来源经 EVIDENCE_GATE 自动判定后，先准备本 case 专用 profile / userdir / fingerprint cache 目录。
2. 第一次成功打开目标页并完成基础自检后，采集 baseline，写入 `case/notes/fingerprint-baseline.json`。
3. 后续每次浏览器取证前读取 baseline；工具启动参数、profile、代理、locale、timezone、viewport 必须与 baseline 一致。
4. 多工具采样或重新启动浏览器后，先对比 baseline：
   - 一致：继续采样。
   - 不一致：写入 `case/notes/fingerprint-baseline-diff.md`，自动重新采样统一基线并宣布，统一后继续；无法统一才输出卡点、只推进不依赖该基线的分析。
5. 指纹 fixture 写入 `baselineId`，并在 `source` 中记录采样工具、页面、UA、时区、语言、采样时间。
6. 最终总结记录 baseline 文件、`baselineId`、是否发生 diff、冲突字段和处理方式。

## 冲突处理

发现冲突时优先处理顺序：

1. 判断是否更换了代理、地区、profile 或浏览器工具。
2. 如果是误切换，回到原 baseline 的 profile / seed / 配置重新采样。
3. 如果用户确认切换，生成新 baseline，并标记旧 fixture 不再用于当前最终交付。
4. 如果无法确认真实一致性，阻塞最终交付，不要把多个 baseline 的指纹值拼接进同一个 env。

## 输出记录

阶段报告和最终总结至少记录：

- `baselineId`。
- baseline 文件路径。
- 取证工具、profile / seed / 配置来源。
- UA / Client Hints / locale / timezone / viewport / screen / WebGL / Canvas / Audio / 字体 / DOM 几何是否一致。
- 是否发生 baseline diff，冲突字段与处理方式。
- `fingerprint.fixture.json` 是否绑定同一 `baselineId`。
