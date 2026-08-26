# 部署 js-reverse-skill 防偏离机制（A：状态机+动作守卫；B：聚合门禁）
# 用法：右键"使用 PowerShell 运行"或 psh 下直接执行；建议先备份 skill 目录（git 仓库在 c:\Users\Administrator\.trae-cn\skills\js-reverse-skill）
$ErrorActionPreference = 'Stop'

$skillRoot = 'c:\Users\Administrator\.trae-cn\skills\js-reverse-skill'
$srcDir = Join-Path $PSScriptRoot 'scripts'

if (-not (Test-Path (Join-Path $skillRoot 'SKILL.md'))) { throw "未找到 skill 根：$skillRoot" }
if (-not (Test-Path (Join-Path $srcDir 'state_machine.js'))) { throw "未找到补丁源：$srcDir" }

# 1) 复制新脚本
Copy-Item (Join-Path $srcDir 'state_machine.js') (Join-Path $skillRoot 'scripts\state_machine.js') -Force
Copy-Item (Join-Path $srcDir 'gate.js') (Join-Path $skillRoot 'scripts\gate.js') -Force
Write-Host '[1/4] 已复制 state_machine.js / gate.js'

# 2) scripts/README.md：更新头部计数 + 插入新分类索引
$readme = Join-Path $skillRoot 'scripts\README.md'
$rm = [IO.File]::ReadAllText($readme)
if ($rm -notmatch '64 个可执行脚本') {
    $rm = $rm.Replace('62 个可执行脚本（53 个 JavaScript、9 个 Python）', '64 个可执行脚本（55 个 JavaScript、9 个 Python）')
}
$indexBlock = @'
## 状态机与聚合门禁（2 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `state_machine.js` | 执行状态强制跟踪：状态持久化到 case/state.json，`--set` 校验 SKILL.md §4 状态机转换合法性（跳过必经节点被拒）、`--guard replay` 拦截前置阶段重放/写请求（越权退出码 2 并留审计） | `node scripts/state_machine.js --case-dir <project-root> --set IMPLEMENT --markdown`；`node scripts/state_machine.js --case-dir <project-root> --guard replay` |
| `gate.js` | 节点聚合门禁：进入节点前一次跑完该节点必验门禁并汇总 PASS/FAIL/SKIP；无 `--at` 时从 state.json 读当前节点；含 FAIL 或需参数缺失退出码非 0 | `node scripts/gate.js --case-dir <project-root> --at IMPLEMENT --url <target> --markdown` |

'@
if ($rm -notmatch '状态机与聚合门禁') {
    $rm = $rm.Replace('## 网络取证与日志采集（5 个）', $indexBlock + "## 网络取证与日志采集（5 个）`n")
}
[IO.File]::WriteAllText($readme, $rm, [Text.UTF8Encoding]::new($false))
Write-Host '[2/4] scripts/README.md 索引与计数已更新'

# 3) SKILL.md：插入 0.0 状态机强制跟踪小节 + 更新 TODO 段落
$skillMd = Join-Path $skillRoot 'SKILL.md'
$sm = [IO.File]::ReadAllText($skillMd)
$sec0 = @'
### 0.0 状态机强制跟踪与动作守卫（不可跳过）

激活 skill 后立即初始化执行状态，之后全程用脚本跟踪"当前在哪个步骤"，让动作边界成为技术约束而非口头约定：

```powershell
# 激活后立即初始化（写入 case/state.json，起点 INTENT_CONFIRM）
node scripts/state_machine.js --case-dir <project-root> --init --markdown
# 每次状态转换：--set 校验合法性，跳过必经节点（如直跳 IMPLEMENT）直接报错；--force 放行但留审计
node scripts/state_machine.js --case-dir <project-root> --set <NODE> --note "<关键结论>" --markdown
# 任何向目标接口发起重放/写请求的执行入口（临时脚本、最终实现验证），运行前必须过守卫：
# 当前节点不在 REAL_VERIFY/DIAGNOSE 时拒绝执行（退出码 2），前置阶段越权重放从技术上被拦截
node scripts/state_machine.js --case-dir <project-root> --guard replay
# 进入每个节点前聚合跑该节点必验门禁；输出含 FAIL 或需参数缺失时停在当前节点
node scripts/gate.js --case-dir <project-root> --at <NODE> --url <目标URL> --inputs <材料路径> --markdown
```

违反规则：任何"当前执行与 state.json 不一致"（未 init、非法跳转、越权重放）都是任务失败信号；先回读 state.json 自修，禁止口头宣称"已进入某节点"代替 `--set` 与门禁实际输出。门禁/守卫拒绝即停，不得用 `--force` 常态绕过（`--force` 用于显式声明例外，仍须在阶段报告与最终总结写明）。

'@
if ($sm -notmatch '### 0\.0 状态机强制跟踪与动作守卫') {
    $sm = $sm.Replace('## 0. 分析前硬门禁（不可跳过）', "## 0. 分析前硬门禁（不可跳过）`n" + "`n" + $sec0)
}
$sm = $sm.Replace('激活后立即建立以下 11 项 TODO 并随状态推进勾选：', '激活后立即运行 `node scripts/state_machine.js --case-dir <project-root> --init --markdown` 建立执行状态，并建立以下 11 项 TODO 随状态推进勾选：')
[IO.File]::WriteAllText($skillMd, $sm, [Text.UTF8Encoding]::new($false))
Write-Host '[3/4] SKILL.md 已写入 0.0 状态机强制跟踪小节'

# 4) 部署后自测：两个新脚本语法 + 内置冒烟，并复跑文档一致性门禁（需在 skill 目录下执行以保证引用真实库）
Push-Location $skillRoot
try {
    node scripts/state_machine.js --self-test
    if ($LASTEXITCODE -ne 0) { throw 'state_machine.js self-test 失败' }
    node scripts/gate.js --self-test
    if ($LASTEXITCODE -ne 0) { throw 'gate.js self-test 失败' }
    node scripts/check_skill_consistency.js --project-dir $skillRoot --markdown
    if ($LASTEXITCODE -ne 0) { throw 'check_skill_consistency.js 未通过（先看其输出排查索引/引用漂移）' }
    Write-Host '[4/4] 自测通过：state_machine / gate / check_skill_consistency'
} finally {
    Pop-Location
}
Write-Host '部署完成。新流程要求：激活 skill 后 --init；每次状态转换 --set；联网入口 --guard replay；进节点 gate --at。'