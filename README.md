# js-reverse-skill

网页端 JavaScript 请求参数逆向与纯协议还原。分析网页签名、Cookie/Token、设备指纹、混淆、WASM、JSVMP、验证码 verify 或 Session/TLS 请求链时触发，覆盖桌面网页、移动 H5 与内置浏览器，交付 Node.js/Python 实现。不用于 App、小程序、桌面程序及 Native 逆向；JSVMP 默认黑盒执行或最小环境复现。

## 来源

本 Skill 采用以下项目的流程、工具和案例，并按本仓库的证据门禁与交付规则组织。本仓库自身以 MIT 许可发布，但聚合自上游的流程、工具与代码仍受各上游项目自身许可证约束：

| 来源 | 贡献 | 许可证 |
|------|------|--------|
| [hello_js_reverse_skill](https://github.com/WhiteNightShadow/hello_js_reverse_skill) | 流程骨架 + 案例库 | 未声明（作者保留所有权利） |
| [xbsReverseSkill](https://github.com/lwjjike/xbsReverseSkill) | 补环境流程 + 工具链 + web-verify-patcher 验证码识别/求解模块（ddddocr/坐标/轨迹脚本 + 题型分类器） | MIT |
| [ruyipage](https://github.com/LoseNine/ruyipage) | Firefox WebDriver BiDi 取证 | BSD-3-Clause（上游 README 附加"仅限合法合规非盈利个人研究、商用需授权"限制） |
| [RuyiTrace](https://github.com/LoseNine/Firefox-FingerPrint-Analyzer) | NDJSON trace 内核 | 未声明（上游 README 声明其 Firefox 内核为 MPL-2.0） |
| [js-reverse-mcp](https://github.com/zhizhuodemao/js-reverse-mcp) | 浏览器 MCP 兜底取证通道（可选依赖；BLOCKED_FORENSIC 引擎检测降级时连接非 Firefox 内核浏览器采成功样本/指纹基线，工具含断点、网络追踪、脚本源码分析） | Apache-2.0 |

> ⚠️ 合规提示：hello_js_reverse_skill 与 RuyiTrace 两个上游项目未提供 LICENSE 文件，按默认版权法其作者保留所有权利；本仓库引用的上游流程/代码用于个人研究与技术交流，**商业分发或二次发布前需逐一与上游作者确认授权**。

## 能力边界

**触发**：
- 网页签名、Token、Cookie、指纹或设备参数生成逻辑
- JSVMP 黑盒执行或最小环境复现、WASM 加载、混淆还原、TLS 指纹模拟
- 验证码封装层的 verify 接口参数、轨迹加密和 challenge 绑定

**不触发**：App 内 JS、小程序容器、Windows 桌面程序、EXE、DLL、Native、Frida 或 IDA 逆向。

**JSVMP 边界**：默认黑盒执行或最小环境复现，不反编译字节码源码。

## 目录结构

```
js-reverse-skill/
├── SKILL.md              流程骨架 + 规则 + 索引（AI 加载的主文档；版本变更见 CHANGELOG.md）
├── README.md             本文件
├── CHANGELOG.md          版本变更记录（每次 bump 同步更新）
├── assets/               可复用资产（AST 反混淆 + 补环境片段 + fixture 模板）
├── templates/            7 类交付入口模板（Node/Python、请求客户端、vm 沙箱、WASM、验证码）
├── references/           知识参考（12 个专题目录，按需读取；含验证码封装层与答案层资产、字体映射反爬）
├── cases/                22 个实证案例 + `index.json` 机器索引
├── tests/                路由/门禁回归基准（状态机硬规则的可执行断言，CI 双平台运行）
└── scripts/              工具脚本（ruyipage+RuyiTrace 采集/导入/检查 + 密文特征识别/Cookie 归因 + 验证码题型分类/坐标/轨迹/答案校验 + 供应链 pin）
```

## 安装到 AI 编程助手

本 Skill 是纯目录 + `SKILL.md`，不绑定特定客户端。任选一种方式接入：

- **Agent Skills 机制**（Claude Code / ZCode / TRAE 等）：把整个仓库克隆到对应 skills 目录即可被自动发现，常见位置：用户级 `~/.agents/skills/js-reverse-skill/`、`~/.claude/skills/js-reverse-skill/`，或项目级 `<project>/.claude/skills/`、`<project>/.codex/skills/`。
- **自定义指令 / 系统提示注入**（Cursor / Copilot 等）：把 `SKILL.md` 内容作为项目规范注入（如 `.cursorrules`、copilot-instructions.md 引用），并保证 `scripts/`、`references/`、`templates/`、`cases/` 随仓库可访问——脚本按 skill 根相对路径调用。

运行要求：Node.js ≥ 18（门禁/检查脚本离线可用）；Python ≥ 3.9 仅取证（`forensic_ruyipage.py`）与验证码辅助脚本需要；ruyipage/RuyiTrace 由 `install_all.js` 按需安装到用户工程 `tools/`，首次安装后建议用 `check_tool_pins.js --record` 固化哈希锁定；浏览器 MCP 为可选兜底依赖（仅引擎检测降级场景使用，见「执行门禁」），不在 `install_all.js` 管理范围，由用户在宿主侧自行安装。

## 如何使用

把下面提示词喂给 AI 编程助手（如 TRAE / Cursor / Copilot），让它加载本 Skill 后按流程执行。技术细节由 skill 自动判断，提示词只给任务目标。

### 核心模板（纯逆向）

方括号 `< >` 内为占位说明，实际使用时替换为真实值：

```
请逆向还原JS加密生成逻辑：
- 目标网站：<网页浏览入口>
- 目标接口：<req.txt 文件路径 / 接口URL字符串 / "无，自动抓包">
- 目标参数：<参数名>
```

### 扩展模板（含业务要求）

在核心模板基础上追加输出与备注：

```
请逆向还原JS加密生成逻辑：
- 目标网站：<网页浏览入口>
- 目标接口：<req.txt 文件路径 / 接口URL字符串 / "无，自动抓包">
- 目标参数：<参数名>

# 输出（可选）
- 抽取为 HTTP API：<路径>
- 报告归档到：<路径>

# 备注（可选）
- 项目规范引用（如"项目结构见仓库 README"）
- 取证模式指定（如"手动取证，提供 cURL"）
- 一次性偏好（如"本次用原生 https，不模拟 TLS 指纹"）
```

## 执行门禁

环境检查通过后写入或更新快照，再执行证据门禁：

```powershell
node scripts/check_session_resume.js --case-dir <project-root> --project-dir <project-root> --write-snapshot --markdown
node scripts/check_evidence.js --case-dir <project-root> --url <target-url> --inputs <材料路径> --markdown
```

环境检测类脚本统一 `--project-dir` 定位 tools/ 所在工程根；多 case 项目共享 tools 时，`--project-dir`/`--case-dir` 传 case 目录或共享工程根均可（自动向上查找含 `tools/` 的祖先目录）。目标接口 URL/关键词已知时，`check_evidence.js` 加 `--require-target-signal <目标接口URL或关键词>` 同时约束 Step 1 与 Step 2。

Step 1 只接受有效 `capture.json` 网络记录（纯元数据；终态与关联记录索引在 `target-hits.json`/`related-hits.json`，超过 JSON 预览阈值的完整 body/WASM 分别在 `case/forensic/bodies/`、`case/forensic/wasm/`），或通过内容校验的 HAR、cURL、原始 HTTP 请求文本；单独 JS、截图和指纹基线只作辅助材料，不计为 Step 1。Step 2 只接受内容可解析、记录非空且关联目标域的 RuyiTrace NDJSON/JSONL（新版按进程类型分目录，脚本自动递归扫描）；摘要不能替代日志。脚本输出 `none`、`step1-only`、`step2-only` 或 `both`，据此补采缺失步骤。

取证浏览器被目标站引擎级检测拒绝（`--ua` 覆盖无效）时进入 BLOCKED_FORENSIC：经用户确认后可选用浏览器 MCP（如 [js-reverse-mcp](https://github.com/zhizhuodemao/js-reverse-mcp)）连接非 Firefox 内核浏览器兜底取证，成功样本/Cookie/指纹/JS 落盘 `case/` 并按用户材料过 `check_evidence.js` 校验。MCP 是可选依赖且仅限两个位置（动作守卫 `--guard mcp` 硬卡）：BLOCKED_FORENSIC 兜底取证、引擎检测 case 的 DIAGNOSE 双对照浏览器侧；无 MCP 时走用户提供 cURL/HAR 或降级路径，skill 完整可用。

## 案例查询

按域名、参数名或技术特征查询机器索引，命中后再读取对应案例：

```powershell
node scripts/search_cases.js --domain jd.com --signal h5st
```

### skill 默认交付内容

每次任务默认产出以下交付物（与 SKILL.md 交付规范一致，不通过不交付）：

```
result/
├── final.js                 # 唯一执行入口（默认发真实 API 请求验证）
├── config.json              # 外置配置（脱敏静态配置）
├── package.json             # 依赖契约（curl-cffi-node 等）
├── 最终项目总结.md           # 目标、分析过程、实现方案与交付说明
├── 经验沉淀-<站点>.md        # 可复用经验，供后续合并到 cases/
├── 验证记录.json             # 脱敏的真实请求结果（JSON：mode + attempts）
└── src/                     # 源码模块（按需拆分）
    ├── signer.js            # 签名生成
    ├── env/                 # 补环境（路径 D 时，含内联 native-protect.js）
    └── request/             # 请求客户端
```

- 纯协议、无浏览器自动化代码（可在无显示器 / Docker 环境独立运行）
- ≥5 次真实 API 请求验证通过（200 响应 + 正确业务数据）
- `最终项目总结.md`、`经验沉淀-<站点>.md`、`验证记录.json` 任一缺失 = 任务未完成

> Python 交付同理：`final.py` 入口 + `src/` 模块。完整交付规范见 SKILL.md。

## License

MIT
