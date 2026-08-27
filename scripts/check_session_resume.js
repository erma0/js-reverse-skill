#!/usr/bin/env node
'use strict';

/**
 * 会话续接判定脚本
 *
 * 用途：新会话激活 skill 时，判定是否可跳过 ENV_READY 五项环境检测，
 *      直接读最新阶段报告续接（避免会话被 context 限制切断后另开会话重走环境检测流程）。
 *
 * 判定逻辑：
 *   1. 扫描 case 目录是否存在 notes/env-snapshot.json；
 *   2. 若存在，调用 check_external_tools.js --json 获取当前环境检测结果；
 *   3. 对比快照中的 nodeVersion / ruyipageRuntime / ruyitraceHome / projectRoot 与当前值；
 *   4. 全部一致 → 输出 resume=true，建议跳过 ENV_READY 环境检测，直接读最新阶段报告续接；
 *      任一不一致 → 输出 resume=false，需走完整环境检测，并在通过后写入新快照。
 *
 * 快照字段：
 *   {
 *     "schemaVersion": "env-snapshot/v1",
 *     "projectRoot": "<absolute path>",
 *     "nodeVersion": "v20.11.0",
 *     "ruyipageRuntime": "<verified runtime executable or empty>",
 *     "ruyipagePackageInstalled": true,
 *     "ruyitraceHome": "<RuyiTrace home or empty>",
 *     "ruyitraceKernelVerified": true,
 *     "caseDir": "<case directory absolute path>",
 *     "createdAt": "ISO-8601",
 *     "lastCheckAt": "ISO-8601"
 *   }
 *
 * 用法：
 *   node scripts/check_session_resume.js --case-dir <project-root> --markdown
 *   node scripts/check_session_resume.js --case-dir <project-root> --write-snapshot  # ENV_READY 检测通过后写快照
 *   node scripts/check_session_resume.js --case-dir <project-root> --json
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./lib/paths');

function parseArgs(argv) {
  const args = { caseDir: '', projectDir: '', ruyitraceHome: '', ruyitraceExe: '', writeSnapshot: false, json: false, markdown: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--case-dir') args.caseDir = nextVal('');
    else if (a === '--project-dir') args.projectDir = nextVal('');
    else if (a === '--ruyitrace-home') args.ruyitraceHome = nextVal('');
    else if (a === '--ruyitrace-exe') args.ruyitraceExe = nextVal('');
    else if (a === '--write-snapshot') args.writeSnapshot = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/check_session_resume.js --case-dir <project-root> --markdown
  node scripts/check_session_resume.js --case-dir <project-root> --write-snapshot --markdown
  node scripts/check_session_resume.js --case-dir <project-root> --json

说明：判定新会话是否可跳过 ENV_READY 五项环境检测。
--case-dir 指项目根（其下应有 case/ 和 result/ 两个平级子目录）；兼容直接传 case 目录。
--project-dir <dir>：用户工程目录（tools/ 所在）。未传时从 --case-dir 自动推断（向上查找
  包含 tools/ 的目录，兼容多 case 项目 <project-root>/<case-name>/ 与 <project-root>/tools/ 平级布局）；
  显式传入可覆盖推断，安装模式下建议按 GATE-1 与 check_external_tools.js 一致显式传 <project-root>。
--write-snapshot：仅在五项环境检测全部通过时写入/更新 case/notes/env-snapshot.json；失败退出非零且不写文件。
不带 --write-snapshot 时只做判定，不写文件。
--ruyitrace-home / --ruyitrace-exe：透传给 check_external_tools.js（安装模式下 tools/ 在用户工程目录而非 skill 根，靠此定位 RuyiTrace）。`;
}

function exists(p) { try { return !!p && fs.existsSync(p); } catch { return false; } }

// 归一化 --case-dir：统一走 scripts/lib/paths.js，兼容"项目根"与"case 目录"两种输入。
function resolveCaseDir(input) {
  return paths.resolveCaseDir(input || '.');
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

function runCheckExternalTools(projectRoot, toolsBase, extraArgs) {
  const script = path.join(projectRoot, 'scripts', 'check_external_tools.js');
  const spawnArgs = [script, '--json'];
  if (extraArgs?.ruyitraceHome) spawnArgs.push('--ruyitrace-home', extraArgs.ruyitraceHome);
  if (extraArgs?.ruyitraceExe) spawnArgs.push('--ruyitrace-exe', extraArgs.ruyitraceExe);
  if (toolsBase) spawnArgs.push('--project-dir', toolsBase);
  const ret = spawnSync(process.execPath, spawnArgs, {
    encoding: 'utf8',
    timeout: 60000,
    windowsHide: true,
    cwd: toolsBase,
  });
  if (ret.status !== 0) {
    return { ok: false, error: ret.stderr || ret.stdout || ret.error?.message || 'check_external_tools.js 退出非零' };
  }
  try {
    return { ok: true, data: JSON.parse(ret.stdout.replace(/^\uFEFF/, '')) };
  } catch (err) {
    return { ok: false, error: `解析 check_external_tools.js JSON 输出失败：${err.message}` };
  }
}

function buildSnapshotFromDetection(detect, caseDir, projectRoot) {
  return {
    schemaVersion: 'env-snapshot/v1',
    projectRoot: path.resolve(projectRoot),
    nodeVersion: detect.node?.version || '',
    ruyipageRuntime: detect.ruyiPage?.runtimeExecutable || '',
    ruyipagePackageInstalled: !!detect.ruyiPage?.packageInstalled,
    ruyipageManagedRuntimeVerified: !!detect.ruyiPage?.managedRuntimeVerified,
    ruyitraceHome: detect.ruyiTrace?.home || '',
    ruyitraceKernelVerified: !!detect.ruyiTrace?.kernelVerified,
    caseDir: path.resolve(caseDir),
    createdAt: new Date().toISOString(),
    lastCheckAt: new Date().toISOString(),
  };
}

function getEnvironmentChecks(detect) {
  return {
    node: !!detect?.node?.ok,
    ruyipagePackage: !!detect?.ruyiPage?.packageInstalled,
    ruyipageRuntime: !!detect?.ruyiPage?.managedRuntimeVerified,
    ruyitrace: !!detect?.ruyiTrace?.exeExists,
    ruyitraceKernel: !!detect?.ruyiTrace?.kernelVerified,
  };
}

function failedEnvironmentChecks(checks) {
  return Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
}

function normalizeStoredSnapshot(stored) {
  if (!stored || typeof stored !== 'object') return null;
  return {
    ...stored,
    projectRoot: stored.projectRoot || stored.root || '',
    nodeVersion: stored.nodeVersion || stored.node || '',
    ruyipageRuntime: stored.ruyipageRuntime || stored.ruyiPageRuntime || '',
    ruyipagePackageInstalled: stored.ruyipagePackageInstalled ?? stored.ruyiPagePackageInstalled,
    ruyipageManagedRuntimeVerified: stored.ruyipageManagedRuntimeVerified ?? stored.managedRuntimeVerified,
    ruyitraceHome: stored.ruyitraceHome || stored.ruyiTraceHome || '',
    ruyitraceKernelVerified: stored.ruyitraceKernelVerified ?? stored.kernelVerified,
  };
}

function diffSnapshot(stored, current) {
  const diffs = [];
  const keysToCompare = [
    'projectRoot', 'nodeVersion', 'ruyipageRuntime',
    'ruyipagePackageInstalled', 'ruyipageManagedRuntimeVerified',
    'ruyitraceHome', 'ruyitraceKernelVerified',
  ];
  for (const k of keysToCompare) {
    if (stored?.[k] === undefined) continue;
    const a = stored[k];
    const b = current?.[k];
    if (a !== b) diffs.push({ key: k, stored: a, current: b });
  }
  return diffs;
}

function findLatestStageReport(caseDir) {
  const stageDir = path.join(caseDir, '阶段报告');
  if (!exists(stageDir)) return null;
  let entries = [];
  try { entries = fs.readdirSync(stageDir, { withFileTypes: true }); } catch { return null; }
  const mdFiles = entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name).sort();
  if (!mdFiles.length) return null;
  return { dir: stageDir, latest: mdFiles[mdFiles.length - 1], all: mdFiles };
}

function findResultProgress(caseDir) {
  const resultDir = paths.resolveResultDir(caseDir);
  if (!exists(resultDir)) return null;
  const out = { dir: resultDir, hasFinalJs: false, hasFinalSummary: false, hasExperience: false, srcFiles: 0 };
  if (exists(path.join(resultDir, 'final.js')) || exists(path.join(resultDir, 'final.py'))) out.hasFinalJs = true;
  if (exists(path.join(resultDir, '最终项目总结.md'))) out.hasFinalSummary = true;
  try {
    const entries = fs.readdirSync(resultDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isFile() && /^经验沉淀-.*\.md$/.test(ent.name)) out.hasExperience = true;
    }
    const srcDir = path.join(resultDir, 'src');
    if (exists(srcDir)) {
      try { out.srcFiles = fs.readdirSync(srcDir, { withFileTypes: true }).filter(e => e.isFile()).length; } catch {}
    }
  } catch {}
  return out;
}

function renderMarkdown(result) {
  const lines = ['# 会话续接判定结果', ''];
  lines.push(`- 模式：${result.mode === 'resume' ? '续接模式（跳过 ENV_READY 环境检测）' : '全新模式（需走完整 ENV_READY 检测）'}`);
  lines.push(`- case 目录：${result.caseDir || '(未提供)'}`);
  if (result.snapshotPath) lines.push(`- 环境快照：${result.snapshotExists ? '存在' : '不存在'} - ${result.snapshotPath}`);
  if (result.mode === 'resume') {
    lines.push(`- 快照写入时间：${result.storedSnapshot?.lastCheckAt || result.storedSnapshot?.createdAt || '未知'}`);
    if (result.stageReport) {
      lines.push(`- 最新阶段报告：${result.stageReport.latest}`);
      lines.push(`- 阶段报告目录：${result.stageReport.dir}`);
      lines.push(`- 已生成阶段报告数：${result.stageReport.all.length}`);
    } else {
      lines.push('- 阶段报告：无（首次 case 或未生成阶段报告）');
    }
    if (result.resultProgress) {
      const r = result.resultProgress;
      lines.push(`- result/ 进度：${r.hasFinalJs ? '已有 final 入口' : '无 final 入口'} / ${r.hasFinalSummary ? '已有最终总结' : '无最终总结'} / ${r.hasExperience ? '已有经验沉淀' : '无经验沉淀'} / src 文件数=${r.srcFiles}`);
    } else {
      lines.push('- result/ 进度：无');
    }
    lines.push('', '## 续接动作');
    lines.push('1. 跳过 ENV_READY 环境检测（环境快照与当前一致）');
    lines.push('2. 直接读取最新阶段报告，恢复上次推进现场');
    lines.push('3. 按 INTENT_CONFIRM 确认本次范围后继续');
    lines.push('4. 若用户明确表示环境已变更（如重装 Node、换 Firefox、迁移 tools/ 目录），手动跑 `node scripts/check_external_tools.js --markdown` 重建快照');
  } else {
    lines.push('', '## 全新模式动作');
    if (!result.snapshotExists) {
      lines.push('- 未发现环境快照，视为首次会话');
    } else if (result.detectError) {
      lines.push(`- 调用 check_external_tools.js 失败：${result.detectError}`);
    } else {
      lines.push('- 环境快照与当前不一致，需重走 ENV_READY 完整环境检测');
      lines.push('', '## 差异项');
      for (const d of result.diffs) {
        lines.push(`- ${d.key}: 快照=${JSON.stringify(d.stored)} / 当前=${JSON.stringify(d.current)}`);
      }
    }
    lines.push('', '## ENV_READY 检测通过后');
    lines.push('运行 `node scripts/check_session_resume.js --case-dir <project-root> --write-snapshot` 写入/更新环境快照，供下次会话续接');
  }
  return lines.join('\n') + '\n';
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); process.exit(0); }
  if (!args.caseDir) {
    console.error('缺少 --case-dir 参数');
    console.error(usage());
    process.exit(1);
  }
  const projectRoot = paths.findProjectRoot();
  const caseDir = resolveCaseDir(args.caseDir);
  // tools/ 所在工程根：显式 --project-dir 优先；未传时从 --case-dir 自动推断（多 case 项目向上查找 tools/）。
  // 快照的 projectRoot 字段记录真实工程根而非 skill 安装根，避免 junction / 目录布局变更后续接失败。
  const toolsBase = args.projectDir ? path.resolve(args.projectDir) : paths.resolveProjectDirFromCaseDir(caseDir);
  const notesDir = paths.resolveNotesDir(caseDir);
  const snapshotPath = path.join(notesDir, 'env-snapshot.json');
  const snapshotExists = exists(snapshotPath);
  const storedSnapshot = snapshotExists ? normalizeStoredSnapshot(readJson(snapshotPath)) : null;

  // 写快照模式
  if (args.writeSnapshot) {
    const detectRet = runCheckExternalTools(projectRoot, toolsBase, args);
    if (!detectRet.ok) {
      console.error(`无法生成快照：${detectRet.error}`);
      process.exit(2);
    }
    const environmentChecks = getEnvironmentChecks(detectRet.data);
    const failedChecks = failedEnvironmentChecks(environmentChecks);
    if (failedChecks.length) {
      console.error(`环境检测未全部通过，拒绝写入快照：${failedChecks.join(', ')}`);
      process.exit(2);
    }
    const fresh = buildSnapshotFromDetection(detectRet.data, caseDir, toolsBase);
    if (storedSnapshot) fresh.createdAt = storedSnapshot.createdAt || fresh.createdAt;
    try { fs.mkdirSync(notesDir, { recursive: true }); } catch {}
    fs.writeFileSync(snapshotPath, JSON.stringify(fresh, null, 2) + '\n', 'utf8');
    const out = {
      mode: 'snapshot-written',
      caseDir,
      snapshotPath,
      snapshot: fresh,
    };
    if (args.json) console.log(JSON.stringify(out, null, 2));
    if (args.markdown) {
      const lines = ['# 环境快照已写入', '', `- 路径：${snapshotPath}`, `- Node：${fresh.nodeVersion}`, `- ruyiPage runtime：${fresh.ruyipageRuntime || '(未验证)'}`, `- ruyiPage 包：${fresh.ruyipagePackageInstalled ? '已安装' : '未安装'}`, `- ruyiTrace home：${fresh.ruyitraceHome || '(未验证)'}`, `- ruyiTrace 内核：${fresh.ruyitraceKernelVerified ? '已验证' : '未验证'}`, `- 写入时间：${fresh.lastCheckAt}`];
      process.stdout.write(lines.join('\n') + '\n');
    }
    process.exit(0);
  }

  // 判定模式
  if (!snapshotExists) {
    const out = { mode: 'fresh', caseDir, snapshotPath, snapshotExists: false, reason: '未发现环境快照，视为首次会话' };
    if (args.json) console.log(JSON.stringify(out, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(out));
    process.exit(0);
  }

  if (!storedSnapshot || storedSnapshot.schemaVersion !== 'env-snapshot/v1') {
    const out = { mode: 'fresh', caseDir, snapshotPath, snapshotExists: true, reason: '快照缺失或 schemaVersion 不兼容' };
    if (args.json) console.log(JSON.stringify(out, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(out));
    process.exit(0);
  }

  const detectRet = runCheckExternalTools(projectRoot, toolsBase, args);
  if (!detectRet.ok) {
    const out = { mode: 'fresh', caseDir, snapshotPath, snapshotExists: true, detectError: detectRet.error };
    if (args.json) console.log(JSON.stringify(out, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(out));
    process.exit(0);
  }

  const current = buildSnapshotFromDetection(detectRet.data, caseDir, toolsBase);
  const diffs = diffSnapshot(storedSnapshot, current);
  const stageReport = findLatestStageReport(caseDir);
  const resultProgress = findResultProgress(caseDir);

  const out = {
    mode: diffs.length === 0 ? 'resume' : 'fresh',
    caseDir,
    snapshotPath,
    snapshotExists: true,
    storedSnapshot,
    currentSnapshot: current,
    diffs,
    stageReport,
    resultProgress,
  };
  if (args.json) console.log(JSON.stringify(out, null, 2));
  if (args.markdown) process.stdout.write(renderMarkdown(out));
}

try {
  main();
} catch (err) {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
}
