# 脚本索引

本目录包含 54 个可执行脚本（47 个 JavaScript、7 个 Python），按功能分为 9 类。以下索引以 `scripts/` 当前实际文件为准，不包含 `README.md`。

本文中的 `<project-root>` 指项目根目录，其下包含平级的 `case/` 与 `result/` 目录。需要 case 目录的脚本使用 `<project-root>/case`，需要项目根目录的脚本直接使用 `<project-root>`。`forensic_ruyipage.py` 与 `capture_ruyitrace_log.js` 会在 `--case-dir` 下创建 `case/`，因此必须传入 `<project-root>`。`check_session_resume`/`check_fingerprint_fixture`/`check_trace_api_coverage` 已归一化，传 `<project-root>` 或 `<project-root>/case` 均可。

## 环境与会话检测（7 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `check_external_tools.js` | 检测 Node.js、ruyiPage 包与定制 Firefox runtime、RuyiTrace 与 trace 内核 | `node scripts/check_external_tools.js --markdown` |
| `check_session_resume.js` | 对比环境快照，判定新会话应续接环境检查还是重走 ENV_READY；仅在 Node、ruyiPage 包、定制 runtime、RuyiTrace 可执行文件与 trace 内核五项检测全部通过时允许 `--write-snapshot`，失败退出非零且不写；兼容旧版 v1 快照；从 `<project-root>/result` 读取进度 | `node scripts/check_session_resume.js --case-dir <project-root> --markdown` |
| `check_node_leakage.js` | 检查 Node 宿主常见泄露变量与 Web API 兼容层，给出阻断清单 | `node scripts/check_node_leakage.js --markdown` |
| `check_node_runtime_compat.js` | 检测当前 Node 版本、ABI 与 nvm 可用性并给出恢复建议，不执行安装或切换 | `node scripts/check_node_runtime_compat.js --required-version 22.0.0 --markdown` |
| `check_tls_clients.js` | 检测 TLS 指纹兼容客户端（CycleTLS / impers / curl-cffi-node / curl_cffi / cyCronet） | `node scripts/check_tls_clients.js --markdown` |
| `check_web_verify_patcher.js` | 检测可选参考资源 web-verify-patcher 是否可用。注：web-verify-patcher 是**外部可选 skill**，不在本仓库内；references 中提及它处均为方法论参考，缺失时按本仓流程执行，不构成阻塞依赖 | `node scripts/check_web_verify_patcher.js --markdown` |
| `precheck_runtime.js` | 执行 Node.js 侧六项纯计算预检 | `node scripts/precheck_runtime.js --markdown` |

## 案例与项目管理（7 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `search_cases.js` | 按关键词、域名、技术信号或策略检索 `cases/index.json` | `node scripts/search_cases.js --domain jd.com --signal h5st` |
| `init_env_case.js` | 初始化 case / result 目录结构并写入模板，支持 `--force` 覆盖 | `node scripts/init_env_case.js --case-dir demo --target app.js --entry makeSign --param sign --api <API_URL>` |
| `clean_case.js` | 清理 case 内测试、临时、缓存文件和空目录 | `node scripts/clean_case.js --case-dir <project-root> --dry-run --markdown` |
| `check_intake.js` | 校验任务说明中的目标字段（必填仅目标 URL + 参数名，其余由门禁补采/自动探测补齐，不阻塞推进） | `node scripts/check_intake.js --input task.md --markdown` |
| `write_markdown_utf8.js` | 以 UTF-8 写入 Markdown，避免 Windows 编码问题 | `node scripts/write_markdown_utf8.js --input 草稿.md --out 最终项目总结.md --markdown` |
| `write_stage_report.js` | 以 UTF-8 写入中文命名阶段报告 | `node scripts/write_stage_report.js --case-dir <project-root> --stage 需求信息确认 --markdown` |
| `check_stage_reports.js` | 检查阶段报告中文文件名、UTF-8、必要阶段及动态字段 | `node scripts/check_stage_reports.js --case-dir <project-root> --require-stage 需求信息确认 --markdown` |

## 网络取证与日志采集（5 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `check_evidence.js` | 验证取证材料真实性并输出 none / step1-only / step2-only / both 路由；Step 1 只认有效 capture 网络记录或用户 HAR、cURL、原始 HTTP 请求文本，Step 2 只认有效 NDJSON | `node scripts/check_evidence.js --case-dir <project-root> --url <目标URL> --inputs <材料路径> --markdown` |
| `check_trace_gate.js` | TRACE_CAPTURE / FORENSIC_CAPTURE 出口门禁：复检 Step 2 NDJSON 及目标 writer 覆盖；网络 URL 与 trace writer 信号分开判定 | `node scripts/check_trace_gate.js --case-dir <project-root> --url <目标URL> --require-trace-signal <环境API/写入点> --markdown` |
| `forensic_ruyipage.py` | ruyiPage 通用取证：以最终业务接口为终态，抓全会话元数据并完整落盘大 body/WASM、JS 与指纹基线 | `python scripts/forensic_ruyipage.py --url <目标URL> --case-dir <project-root> --targets "login/submit" --browser-path <定制Firefox> --markdown` |
| `capture_ruyitrace_log.js` | 自动采集或手动导入 RuyiTrace NDJSON；默认采集窗口 120 秒，`--evidence-signal` 只做证据门禁，只有明确的 `--end-signal` 才提前收尾，等待末行完整刷盘，记录 `endReason` 并校验 Firefox 进程已退出；关闭与导入会使命令总耗时略长于窗口 | `node scripts/capture_ruyitrace_log.js --url <目标URL> --case-dir <project-root> --evidence-signal handshake --ruyitrace-home <RuyiTrace目录> --import-after --markdown` |
| `import_ruyitrace_log.js` | 导入 RuyiTrace NDJSON，生成摘要并标记截断字段；`--signal-policy advisory` 可在人工结束/信号不确定时只报告覆盖不足而不误报日志缺失；支持 `--trace-signal`，旧 `--target-signal` 兼容 | `node scripts/import_ruyitrace_log.js --input <trace.ndjson> --case-dir <project-root> --trace-signal handshake --signal-policy advisory --markdown` |

首次终态等待默认 `--wait 120` 秒：`--targets` 应填写最终登录/业务提交等终态接口；多个目标按 OR 处理，任一非 OPTIONS 2xx 命中后另完整抓取 `--target-settle`（默认 3 秒）并关闭浏览器，未命中到点自动关闭。HTTP 2xx 仅代表目标请求已取证，不代表站点业务码成功；预计会出现失败后重试时应调大 `--target-settle`，关联材料会以最后一次已捕获的有效终态向前回溯。JSON 默认只内联 1MB 预览；超过预览阈值的普通 body 完整写入 `case/forensic/bodies/`（默认单体上限 10MB），WASM 完整写入 `case/forensic/wasm/`（默认单体上限 50MB），关联动态材料总预算默认 100MB。`target-hits.json`/`related-hits.json` 的 `*_complete`、`*_saved_to`、`*_sha256` 字段决定是否有完整证据，不能把预览当作原始 body。指定 `--targets/--targets-regex` 后，若未捕获到非 OPTIONS 2xx 终态响应，脚本退出码非 0（报告 `NO_TARGET` 或 `PARTIAL`），作为 Step 1 缺失硬信号。目标请求需要登录 / 点击 / 验证码等手动触发时，浏览器打开期间应提示用户操作（登录场景可加 `--manual-pause`）；窗口不够可调大 `--wait`。终态接口未命中时，JS 源码搜索只能作辅助假设，不能替代 Step 1 网络记录。

`check_evidence.js` 退出码是硬信号：Step 1 使用 `--require-network-signal`，Step 2 使用 `--require-trace-signal`，二者分别判定。Step 2 的 NDJSON 已产出但 writer 信号未命中时，不得报告“没有 trace”，应报告“trace 已产出、目标链路未覆盖”并进入 TRACE_RETRY。旧的 `--require-target-signal` 仅为兼容，不应再用于 JSONP/script/导航 URL。仓库推送会由 `.github/workflows/skill-checks.yml` 自动运行语法、self-test 和引用一致性检查。可运行 `node scripts/check_evidence.js --self-test` 执行内置自测。

`check_trace_gate.js` 是 TRACE_CAPTURE / FORENSIC_CAPTURE 出口门禁：复检 Step 2 是否真实产出，并单独检查目标 writer 覆盖。NDJSON 已产出但 writer 未命中时，输出“覆盖不足”而不是“没有 trace”。网络 URL 使用 `--require-network-signal`，trace writer 使用 `--require-trace-signal`。可运行 `node scripts/check_trace_gate.js --self-test` 执行内置自测。

## Trace 分析与运行时闭环（9 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `analyze_trace.js` | 解析 trace JSONL，按模块归类环境访问并标注优先级 | `node scripts/analyze_trace.js --trace case/tmp/env-trace.jsonl --summary case/tmp/missing-env.json --markdown` |
| `search_trace.js` | 按关键词 / 接口 / URL / 正则检索 NDJSON，输出行号、命名字段与上下文，替代命令行手搓 grep | `node scripts/search_trace.js --trace case/ruyi-trace/logs/trace.ndjson --keyword handshake --context 3 --markdown` |
| `search_js.js` | 大文件 / 单行压缩 bundle 关键词检索，输出 line:col 与有限字符上下文，替代 grep 大行与 node -e | `node scripts/search_js.js --file case/js/original/app.js --keyword setRequestHeader --context 200 --markdown` |
| `analyze_trace_complexity.js` | 评估补环境复杂度、风险点与实现优先级 | `node scripts/analyze_trace_complexity.js --trace case/ruyi-trace/logs/trace.ndjson --markdown` |
| `build_trace_runtime_contract.js` | 从原始 Trace 生成逐 API、Realm、receiver 与行为观测组成的运行时契约 | `node scripts/build_trace_runtime_contract.js --case-dir <project-root> --markdown` |
| `run_with_trace.js` | 在隔离 vm 探测上下文运行目标脚本并输出环境访问日志 | `node scripts/run_with_trace.js --target case/js/original/app.js --entry window.makeSign --fixture case/fixtures/sample.fixture.json` |
| `run_trace_runtime_audit.js` | 在强制 no-send 模式下运行项目审计入口并生成 Node runtime audit | `node scripts/run_trace_runtime_audit.js --case-dir <project-root> --entry result/final.js --markdown` |
| `check_trace_runtime_conformance.js` | 比较 Trace 运行时契约与 Node audit，阻断关键行为不一致 | `node scripts/check_trace_runtime_conformance.js --case-dir <project-root> --markdown` |
| `check_trace_api_coverage.js` | 检查 Trace API inventory、环境覆盖矩阵与运行时闭环状态 | `node scripts/check_trace_api_coverage.js --case-dir <project-root> --markdown` |

## 补环境与网络语义检查（7 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `check_env_realism.js` | 检查原型链、描述符、toString 保护、document.all 与指纹值回放等真实性要求 | `node scripts/check_env_realism.js --case-dir <project-root> --markdown` |
| `check_object_shape_audit.js` | 检查浏览器对象私有状态泄露，并对比对象形状 baseline 与 Node audit | `node scripts/check_object_shape_audit.js --case-dir <project-root> --require --markdown` |
| `check_webapi_env_detection_matrix.js` | 检查 WebAPI 行为矩阵、浏览器 baseline 与 Node audit 的行为差异闭环 | `node scripts/check_webapi_env_detection_matrix.js --case-dir <project-root> --require --markdown` |
| `check_xhr_fetch_semantics.js` | 对比浏览器与 Node 的 XHR、fetch、导航请求/响应、Header、Session 和生命周期语义 | `node scripts/check_xhr_fetch_semantics.js --case-dir <project-root> --require --require-no-send --markdown` |
| `check_xhr_fetch_session_bridge.js` | 检查 XHR / fetch / sendBeacon 是否通过同一 TLS 指纹兼容 Session 发起真实请求 | `node scripts/check_xhr_fetch_session_bridge.js --case-dir <project-root> --require-live --markdown` |
| `check_environment_closure.js` | 汇总执行 Trace-runtime、WebAPI、对象形状与网络语义闭环检查 | `node scripts/check_environment_closure.js --case-dir <project-root> --before-real-request --markdown` |
| `generate_fingerprint_hook.js` | 生成浏览器侧指纹终端 API 采样 Hook，仅用于取证 | `node scripts/generate_fingerprint_hook.js --types canvas,webgl,dom-geometry --out case/hooks/fingerprint-hook.js` |

## 质量检查与交付门禁（7 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `check_code_quality.js` | 检查代码简洁性、模块化、编码与交付代码规则 | `node scripts/check_code_quality.js --case-dir <project-root> --markdown` |
| `check_final_artifact.js` | 检查交付目录、单一入口、禁用浏览器自动化、总结与经验沉淀等规则 | `node scripts/check_final_artifact.js --case-dir <project-root> --markdown` |
| `check_skill_consistency.js` | 检查 SKILL.md 关键门禁锚点、引用路径与 references 孤儿文件 | `node scripts/check_skill_consistency.js --project-dir <project-root> --markdown` |
| `check_fingerprint_fixture.js` | 检查指纹 fixture 对 Canvas、WebGL、Audio、DOM 几何等的覆盖 | `node scripts/check_fingerprint_fixture.js --case-dir <project-root> --markdown` |
| `check_dynamic_resources.js` | 检查动态资源是否仅作快照，并具备运行时刷新设计 | `node scripts/check_dynamic_resources.js --case-dir <project-root> --markdown` |
| `check_change_memory.js` | 检查代码变更记忆中的修改原因、禁止回退与验证记录 | `node scripts/check_change_memory.js --case-dir <project-root> --markdown` |
| `compare_fixture.js` | 对比 fixture 样本与实际输出，定位首个偏差点 | `node scripts/compare_fixture.js --fixture sample.fixture.json --actual node-output.json --field sign --markdown` |

## 安装与下载（3 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `install_all.js` | 检测并安装缺失组件到项目 `tools/` | `node scripts/install_all.js --project-dir <project-root> --yes --markdown` |
| `install_ruyipage_runtime.js` | 以 dry-run / install 双阶段安装 ruyiPage runtime 到指定目录 | `node scripts/install_ruyipage_runtime.js --python python --install-dir <目录> --install --markdown` |
| `download_ruyi_tool.js` | 下载 RuyiTrace 或 ruyipage-firefox，支持自动解压 zip | `node scripts/download_ruyi_tool.js --tool ruyitrace --dest <目录> --extract --markdown` |

## 验证码识别与求解辅助（6 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `classify_verify.py` | 离线识别验证码题型与厂商，内置冒烟自检 | `python scripts/classify_verify.py --html page.html --url "https://example.test" --text "拖动滑块" --pretty` |
| `analyze_tile_restore.py` | 离线分析切片乱序图片并辅助恢复原图 | `python scripts/analyze_tile_restore.py --image scrambled.png --rows 3 --cols 3 --pretty` |
| `map_coordinates.py` | 将图片像素坐标换算为 CSS / 页面坐标，处理 DPR、偏移与滚动 | `python scripts/map_coordinates.py --image-size 300x150 --display-size 300x150 --point 120,75 --pretty` |
| `generate_motion_track.py` | 生成滑块、拖放、刮刮卡或连线轨迹 JSON | `python scripts/generate_motion_track.py --mode slider --distance 128 --duration-ms 1100 --pretty` |
| `click_gap.py` | OpenCV 人工点击缺口工具，输出缺口左边缘 CSS x 坐标 | `python scripts/click_gap.py bg.jpg front.png --scale 2` |
| `solver_request_template.py` | 生成打码平台请求占位模板 | `python scripts/solver_request_template.py --platform yundama --captcha-type slider --pretty` |

## 验证码验证门禁（3 个）

| 脚本 | 功能 | 典型用法 |
|------|------|---------|
| `check_captcha_answer.js` | 校验答案层 answer JSON 是否符合验证码接口契约 | `node scripts/check_captcha_answer.js --file answer.json --markdown` |
| `check_success_baseline.js` | 评估验证码成功样本基线，检查成功次数与新类型覆盖 | `node scripts/check_success_baseline.js --file success_samples.json --markdown` |
| `check_verification_attempts.js` | 汇总验证码失败尝试并判断是否应切换求解方案 | `node scripts/check_verification_attempts.js --file attempts.json --markdown` |

## 数量核对

| 分类 | 独立脚本数 |
|------|-----------:|
| 环境与会话检测 | 7 |
| 案例与项目管理 | 7 |
| 网络取证与日志采集 | 4 |
| Trace 分析与运行时闭环 | 9 |
| 补环境与网络语义检查 | 7 |
| 质量检查与交付门禁 | 7 |
| 安装与下载 | 3 |
| 验证码识别与求解辅助 | 6 |
| 验证码验证门禁 | 3 |
| **合计** | **53** |

> 滑块缺口坐标来源判定（A 接口参数 / B 图片像素 / C 纯图像三路线）见 `references/captcha/gap-coordinate-source.md`。本目录中的验证码辅助脚本负责 C 类坐标换算、轨迹生成、答案校验与打码模板，A / B 类走封装层逆向。
