# 最终项目总结

每次 case 完成后必须生成 `result/最终项目总结.md`。总结报告使用 UTF-8 写入，避免 Windows PowerShell / cmd 默认编码把中文写乱码。

> 适用范围：所有 case 必选。只有用户明确要求不生成时方可跳过。

## 编码硬规则

- 使用 `node scripts/write_markdown_utf8.js` 写入，避免编码问题：
  ```bash
  node scripts/write_markdown_utf8.js --input case/tmp/总结草稿.md --out result/最终项目总结.md --require-chinese-name --markdown
  ```
- 报告中不得明文写入 Cookie、Authorization、localStorage、账号标识等敏感内容。

## 解题必需模板（默认）

```markdown
# 项目总结

FINAL_ARTIFACT_NETWORK_MODE=online
FINAL_ARTIFACT_TLS_FINGERPRINT=not-required

生成时间：
任务范围：网页端 JS 逆向

## 1. 目标与边界

- 目标网站 URL：
- 目标 API：
- 请求方法：
- 目标加密参数：
- 参数位置：Query / Header / Body / Cookie
- 是否需要登录：
- 取证模式：ruyiPage + RuyiTrace / 用户手动取证
- 还原方式：纯算还原 / vm 沙箱 / WASM 加载 / 补环境
- 明确排除：App / 移动端 / Native / 批量爬虫

## 2. 用户提供材料

- 成功请求样本：
- 响应样本：
- 已知 JS 文件：
- HAR / cURL：
- RuyiTrace NDJSON：
- 证据门禁结果（`check_evidence.js` 输出：Step 1 / Step 2 是否跳过）：
- 其他说明：
> 注：URL 不是材料。仅提供 URL 时本 case 必须走完整两步取证，本栏应注明"仅 URL，无手动材料"。

## 3. 取证流程与证据来源

- 使用的取证工具：
- 抓包 / Hook 策略：
- JS 文件收集来源：
- 关键调用栈来源：

## 4. 加密参数定位结论

- source（参数来源）：
- entry（加密入口）：
- builder（构造逻辑）：
- writer（写入位置）：
- 关键 JS 文件：
- 关键函数：

## 5. 算法还原 / 补环境概览

- 还原方式：纯算还原 / vm 沙箱 / WASM / 补环境
- 算法类型：md5 / sha / aes / hmac / SM2 / 自定义 / 其他
- 补环境范围（如涉及）：navigator / document / canvas / webgl / 其他
- 关键环境依赖：

## 6. 最终交付结构

- 执行入口：`final.js` / `final.py`
- 必要模块：`src/signer.js` / `src/env/` / `src/request/`
- 是否包含浏览器自动化代码：否
- 动态资源刷新：有 / 无

## 7. 测试结果

- 签名稳定性验证：≥5 次请求
- 响应状态码：
- 业务成功判断：
- 失败原因或限制：

## 8. 风险与后续建议

- 未确认风险：
- 需要补充样本：
- 后续复测建议：
```
## 生产级交付附加章节

用户要求“生产级交付”时，在上述 8 章基础上追加以下 9 个章节，并与 `check_final_artifact.js --production` 的检查口径一致：

- NativeProtect 使用情况
- 指纹基线一致性
- 环境与指纹 API 调用回放明细：按环境模块分组（Navigator / Document / Window / Canvas / WebGL / Storage / XHR / WebRTC / 其它），每项四列——API（含访问类型）/ trace 频次 / 回放值或实现方式 / 验证结果，把 trace 证据、补环境实现、请求验证三者闭环（match10 形态）；频次数据来自过滤目标站来源后的统计（见 `references/workflow/trace-flow.md` TRACE_ANALYZE）
- 高强度环境检测覆盖矩阵
- Session 请求链
- 加密参数生成与样本复用检查
- 代码质量与中文注释
- 清理结果
- 阶段报告索引

## 机器声明标记（check_final_artifact.js 按此识别）

在 `result/`（或 `case/`）的 Markdown / JSON / TXT 文档中写以下两行标记，联网模式与 TLS 判定按机器标记识别（自然语言声明仅旧文档兼容）：

```text
FINAL_ARTIFACT_NETWORK_MODE=online        # 或 sign-only
FINAL_ARTIFACT_TLS_FINGERPRINT=not-required  # 或 required
```

match12 实测教训：总结缺这两行标记时，门禁会报"网络模式未声明"并要求返工重写文档——写总结时直接按模板头部带上。

## 验证记录.json 结构契约（联网模式）

`check_final_artifact.js` 对联网模式的 `result/验证记录.json` 逐字段校验，缺结构会被判不合格（match12 实测曾先写成自由结构后返工）：

```json
{
  "mode": "online",
  "attempts": [
    {
      "timestamp": "2026-08-26T14:05:01+08:00",
      "httpStatus": 200,
      "parameterSummary": { "page": 1, "m": "eXVhbnJlbnh1ZTE=" },
      "sessionStage": "page-1",
      "responseValid": true
    }
  ]
}
```

- `attempts` ≥ 5 条；每条 `timestamp` 必须是可解析的时间字符串（真实请求时刻，不要事后伪造）、`httpStatus` 2xx 整数、`parameterSummary` 非空字符串或非空对象（目标参数摘要）、`sessionStage` 非空字符串、`responseValid` 严格 `true`。
- 顶层可附加 `total`、`submit` 等字段记录业务结果；敏感值（sessionid 等）脱敏后再写入。
- sign-only 模式：顶层 `signOnlyExempt: true` + 非空 `exemptionReason`，无 attempts 要求。
- 最稳妥做法是入口脚本在每次请求时实时写入 attempts（带真实 timestamp），而不是交付后手工回填。
