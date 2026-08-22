#!/usr/bin/env node
'use strict';

// 供应链 pin 门禁：维护 scripts/lib/tool-pins.json 锁定清单，校验自动下载产物。
// 设计与「未 pin 即 CI fail」等价落地：download_ruyi_tool.js 命中记录强制校验；
// 本脚本负责记录（--record）、复验本地产物（默认）、下载前校验（--verify-file）。
// SKILL.md 规则「新增依赖写入依赖契约并确认来源和版本」的机器强制层。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DEFAULT_PINS = path.join(__dirname, 'lib', 'tool-pins.json');

function parseArgs(argv) {
  const args = {
    pins: DEFAULT_PINS, projectDir: '', record: false, verifyFile: '', file: '',
    tool: '', tag: '', note: '', python: '', strict: false, json: false, markdown: false, help: false, selfTest: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--pins') args.pins = nextVal(DEFAULT_PINS);
    else if (a === '--project-dir') args.projectDir = nextVal('');
    else if (a === '--record') args.record = true;
    else if (a === '--verify-file') args.verifyFile = nextVal('');
    else if (a === '--file') args.file = nextVal('');
    else if (a === '--tool') args.tool = nextVal('');
    else if (a === '--tag') args.tag = nextVal('');
    else if (a === '--note') args.note = nextVal('');
    else if (a === '--python') args.python = nextVal('');
    else if (a === '--strict') args.strict = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--self-test') args.selfTest = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/check_tool_pins.js --markdown                       # 校验 pins 清单 + 本地 tools/ 产物哈希
  node scripts/check_tool_pins.js --record --file <zip> --tool ruyitrace --tag v2.5 --markdown
  node scripts/check_tool_pins.js --verify-file <zip> --tool ruyitrace --markdown
  node scripts/check_tool_pins.js --self-test

说明：
- 锁定清单：scripts/lib/tool-pins.json（--pins 可覆盖）。records 键 '<tool>/<assetName>'；pythonPackages 键为 PyPI 包名。
- --record：计算 --file 的 sha256 并写入清单（--tool 必填，--tag 记来源 release，--note 可选）。
- --verify-file：校验单个产物。命中记录且匹配 → 通过；命中不匹配 → 失败（退出 1）；
  无记录 → 默认 WARN（退出 0），--strict 时失败（等价「未 pin 不得使用」）。
- --python <cmd>：复验 pythonPackages 锁定的 PyPI 包本机版本（pip show，只读）；版本漂移（SKEW）即失败。
- 默认模式：校验清单 schema；tools/ 下存在与记录同名的产物时复算哈希比对，不匹配即失败。`;
}

// 与 download_ruyi_tool.js 的 REPOS 对齐：--record 时已知工具自动带 repo，未知工具留空由 schema 校验拦截
const KNOWN_REPOS = {
  ruyitrace: 'LoseNine/Firefox-FingerPrint-Analyzer',
  'ruyipage-firefox': 'LoseNine/ruyipage',
};

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(file);
    rs.on('data', (c) => h.update(c));
    rs.on('end', () => resolve(h.digest('hex')));
    rs.on('error', reject);
  });
}

function loadPins(pinsPath) {
  const doc = JSON.parse(fs.readFileSync(pinsPath, 'utf8').replace(/^\uFEFF/, ''));
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('pins 清单必须是 JSON 对象');
  if (!doc.records || typeof doc.records !== 'object' || Array.isArray(doc.records)) throw new Error('pins 清单缺少 records 对象');
  return doc;
}

function validateRecords(records) {
  const problems = [];
  for (const [key, rec] of Object.entries(records)) {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(key)) problems.push(`记录键格式应为 <tool>/<assetName>：${key}`);
    if (!rec || typeof rec !== 'object') { problems.push(`记录值必须是对象：${key}`); continue; }
    if (!/^[0-9a-f]{64}$/i.test(rec.sha256 || '')) problems.push(`${key}：sha256 必须是 64 位 hex`);
    if (!rec.repo) problems.push(`${key}：缺少 repo（来源仓库）`);
    if (!rec.recordedAt) problems.push(`${key}：缺少 recordedAt（记录日期）`);
  }
  return problems;
}

function validatePythonPackages(pythonPackages) {
  const problems = [];
  if (pythonPackages == null) return problems;
  if (typeof pythonPackages !== 'object' || Array.isArray(pythonPackages)) {
    problems.push('pythonPackages 必须是对象（键为 PyPI 包名）');
    return problems;
  }
  for (const [pkg, rec] of Object.entries(pythonPackages)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(pkg)) problems.push(`pythonPackages 包名非法：${pkg}`);
    if (!rec || typeof rec !== 'object') { problems.push(`pythonPackages.${pkg} 必须是对象`); continue; }
    if (!/^\d+[A-Za-z0-9.*!+_-]*$/.test(rec.version || '')) problems.push(`pythonPackages.${pkg}：version 缺失或非法（应为 PEP 440 版本号，如 1.2.62）`);
    if (!rec.verifiedAt) problems.push(`pythonPackages.${pkg}：缺少 verifiedAt（验证日期）`);
  }
  return problems;
}

// 纯函数：锁定版本 vs 本机已装版本。installed 缺失该包时 SKIP（未安装不构成漂移）。
function comparePythonPackages(pinned, installed) {
  const results = [];
  for (const [pkg, rec] of Object.entries(pinned || {})) {
    const have = Object.prototype.hasOwnProperty.call(installed || {}, pkg) ? installed[pkg] : null;
    if (have == null) {
      results.push({ pkg, pinned: rec.version, installed: null, status: 'SKIP', detail: '本机未安装（或 pip show 无该包），跳过版本比对' });
    } else if (String(have) === String(rec.version)) {
      results.push({ pkg, pinned: rec.version, installed: have, status: 'PASS', detail: `版本一致（verifiedAt ${rec.verifiedAt || '未记录'}）` });
    } else {
      results.push({ pkg, pinned: rec.version, installed: have, status: 'SKEW', detail: `版本漂移：锁定 ${rec.version}，本机 ${have}。锁定组合之外的版本未经验证，按 install_all.js 重装锁定版本或更新锁定记录` });
    }
  }
  return results;
}

// 用 pip show 探测本机已装版本（只读，不安装）
function queryInstalledPythonPackages(pythonCmd, packages) {
  const installed = {};
  for (const pkg of packages) {
    const ret = spawnSync(pythonCmd, ['-m', 'pip', 'show', pkg], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    if (ret.status !== 0) continue;
    const m = /^Version:\s*(\S+)/m.exec(ret.stdout || '');
    if (m) installed[pkg] = m[1];
  }
  return installed;
}

// 在 projectDir（含其 tools/）下查找与记录资产同名的文件
function findLocalArtifact(projectDir, assetName) {
  if (!projectDir) return '';
  const candidates = [
    path.join(projectDir, assetName),
    path.join(projectDir, 'tools', assetName),
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* ignore */ }
  }
  return '';
}

async function verifyFileAgainstRecords(pinsPath, file, tool, strict) {
  const doc = loadPins(pinsPath);
  const assetName = path.basename(file);
  const key = `${tool}/${assetName}`;
  const rec = doc.records[key];
  if (!rec) {
    return { status: strict ? 'FAIL' : 'WARN', key, detail: `无 pin 记录：${key}。下载输出已给出 sha256，用 --record 固化。`, actual: await sha256File(file) };
  }
  const actual = await sha256File(file);
  if (actual.toLowerCase() === String(rec.sha256).toLowerCase()) {
    return { status: 'PASS', key, detail: `哈希匹配（${rec.repo} ${rec.tag || 'tag 未记录'}，recordedAt ${rec.recordedAt}）`, actual };
  }
  return { status: 'FAIL', key, detail: `哈希不匹配：期望 ${rec.sha256}，实际 ${actual}。产物可能被替换，删除后重下并核实来源。`, actual };
}

async function recordPin(pinsPath, file, tool, tag, note) {
  if (!tool) throw new Error('--record 需要 --tool');
  if (!file || !fs.existsSync(file)) throw new Error('--record 需要 --file（存在的产物文件）');
  const doc = loadPins(pinsPath);
  const assetName = path.basename(file);
  const key = `${tool}/${assetName}`;
  const sha = await sha256File(file);
  const previous = doc.records[key];
  doc.records[key] = {
    repo: KNOWN_REPOS[tool] || (previous && previous.repo) || '',
    tag: tag || (previous ? previous.tag : ''),
    sha256: sha,
    recordedAt: new Date().toISOString().slice(0, 10),
    note: note || (previous ? previous.note : ''),
  };
  fs.writeFileSync(pinsPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return { key, sha256: sha, updated: !!previous, record: doc.records[key] };
}

async function runChecks(args) {
  const problems = [];
  let doc = null;
  try { doc = loadPins(args.pins); } catch (err) { return { problems: [`pins 清单加载失败：${err.message}`], records: [], checks: [], pythonPackages: [] }; }
  problems.push(...validateRecords(doc.records));
  problems.push(...validatePythonPackages(doc.pythonPackages));
  let pythonPackages = [];
  if (args.python && doc.pythonPackages && Object.keys(doc.pythonPackages).length) {
    const installed = queryInstalledPythonPackages(args.python, Object.keys(doc.pythonPackages));
    pythonPackages = comparePythonPackages(doc.pythonPackages, installed);
    for (const item of pythonPackages) {
      if (item.status === 'SKEW') problems.push(`pythonPackages.${item.pkg}：${item.detail}`);
    }
  }
  const checks = [];
  const projectRoot = args.projectDir ? path.resolve(args.projectDir) : '';
  for (const [key, rec] of Object.entries(doc.records)) {
    const assetName = key.split('/')[1];
    const local = findLocalArtifact(projectRoot, assetName);
    if (!local) {
      checks.push({ status: 'SKIP', key, detail: '本地无同名产物（可能安装后已清理），跳过复验' });
      continue;
    }
    const actual = await sha256File(local);
    const ok = actual.toLowerCase() === String(rec.sha256).toLowerCase();
    checks.push({ status: ok ? 'PASS' : 'FAIL', key, detail: ok ? `本地产物哈希匹配：${local}` : `本地产物哈希不匹配：${local} 期望 ${rec.sha256} 实际 ${actual}` });
  }
  return { problems, records: Object.keys(doc.records), checks, pythonPackages };
}

function renderMarkdown(result) {
  const lines = ['# 供应链 pin 检查', '', `- pins 清单：${result.pinsPath}`, `- 记录数：${result.records.length}`, ''];
  if (result.recordResult) {
    lines.push(`- [记录${result.recordResult.updated ? '更新' : '新增'}] ${result.recordResult.key}`, `- sha256：${result.recordResult.sha256}`, '');
  }
  if (result.verifyResult) {
    lines.push(`- [${result.verifyResult.status}] ${result.verifyResult.key}：${result.verifyResult.detail}`, '');
  }
  if (result.checks && result.checks.length) {
    lines.push('## 本地产物复验');
    for (const c of result.checks) lines.push(`- [${c.status}] ${c.key}：${c.detail}`);
    lines.push('');
  }
  if (result.pythonPackages && result.pythonPackages.length) {
    lines.push('## Python 包版本复验');
    for (const p of result.pythonPackages) lines.push(`- [${p.status}] ${p.pkg}：${p.detail}`);
    lines.push('');
  }
  if (result.problems.length) {
    lines.push('## 未通过');
    for (const p of result.problems) lines.push(`- ${p}`);
  } else if (!result.verifyResult) {
    lines.push(result.checks && result.checks.length ? '- [通过] 清单与本地复验均通过' : '- [通过] 清单 schema 校验通过（暂无本地产物需要复验）');
  }
  return lines.join('\n') + '\n';
}

async function runSelfTest() {
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-pins-'));
  try {
    const pinsPath = path.join(root, 'pins.json');
    fs.writeFileSync(pinsPath, JSON.stringify({ records: {} }, null, 2), 'utf8');
    const artifact = path.join(root, 'RuyiTrace-9.9.9-win64.zip');
    fs.writeFileSync(artifact, 'fake-zip-content-v1', 'utf8');

    // 1) record → 写入并回读
    const rec = await recordPin(pinsPath, artifact, 'ruyitrace', 'v9.9.9', '自测');
    if (!/^[0-9a-f]{64}$/.test(rec.sha256)) throw new Error('record 应写入 64 位 hex');
    // 2) verify 命中且匹配 → PASS
    let v = await verifyFileAgainstRecords(pinsPath, artifact, 'ruyitrace', false);
    if (v.status !== 'PASS') throw new Error(`应 PASS，实际 ${v.status}`);
    // 3) 篡改产物 → FAIL
    fs.writeFileSync(artifact, 'tampered', 'utf8');
    v = await verifyFileAgainstRecords(pinsPath, artifact, 'ruyitrace', false);
    if (v.status !== 'FAIL') throw new Error(`篡改后应 FAIL，实际 ${v.status}`);
    // 4) 无记录 → WARN，strict → FAIL
    fs.writeFileSync(artifact, 'other-content', 'utf8');
    v = await verifyFileAgainstRecords(pinsPath, artifact, 'ruyitrace2', false);
    if (v.status !== 'WARN') throw new Error(`无记录应 WARN，实际 ${v.status}`);
    v = await verifyFileAgainstRecords(pinsPath, artifact, 'ruyitrace2', true);
    if (v.status !== 'FAIL') throw new Error(`strict 无记录应 FAIL，实际 ${v.status}`);
    // 5) schema 校验捕获坏记录
    const badPins = path.join(root, 'bad.json');
    fs.writeFileSync(badPins, JSON.stringify({ records: { 'x/y': { sha256: 'nothex' } } }), 'utf8');
    const problems = validateRecords(loadPins(badPins).records);
    if (!problems.some((p) => p.includes('sha256'))) throw new Error('schema 校验应捕获坏 sha256');
    // 6) 默认模式：本地匹配记录产物
    fs.writeFileSync(artifact, 'fake-zip-content-v1', 'utf8');
    const checks = await runChecks({ pins: pinsPath, projectDir: root });
    if (checks.problems.length) throw new Error(`默认模式不应有问题：${checks.problems.join('；')}`);
    if (!checks.checks.some((c) => c.status === 'PASS')) throw new Error('默认模式应复验本地产物');
    // 7) pythonPackages：schema 校验 + 版本比对纯函数（PASS/SKEW/SKIP）
    const ppProblems = validatePythonPackages({ '9bad!name': { version: '1.0' }, ruyiPage: { version: 'not a version!' } });
    if (!ppProblems.some((p) => p.includes('包名非法'))) throw new Error('schema 应捕获非法包名');
    if (!ppProblems.some((p) => p.includes('version'))) throw new Error('schema 应捕获坏版本号');
    const ok2 = comparePythonPackages({ ruyiPage: { version: '1.2.62', verifiedAt: '2026-08-21' } }, { ruyiPage: '1.2.62' });
    if (ok2[0].status !== 'PASS') throw new Error('版本一致应 PASS');
    const skew = comparePythonPackages({ ruyiPage: { version: '1.2.62', verifiedAt: 'x' } }, { ruyiPage: '1.3.0' });
    if (skew[0].status !== 'SKEW') throw new Error('版本漂移应 SKEW');
    const skip = comparePythonPackages({ ruyiPage: { version: '1.2.62', verifiedAt: 'x' } }, {});
    if (skip[0].status !== 'SKIP') throw new Error('未安装应 SKIP');
    return { clean: true, tests: 10 };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  (async () => {
    try {
      const args = parseArgs(process.argv);
      if (args.help) { console.log(usage()); process.exit(0); }
      if (args.selfTest) {
        const r = await runSelfTest();
        console.log(`check_tool_pins.js 自测通过：${r.tests} 项断言`);
        process.exit(0);
      }
      const result = { pinsPath: path.resolve(args.pins), records: [], problems: [], checks: [], pythonPackages: [] };
      let exitCode = 0;
      if (args.record) {
        result.recordResult = await recordPin(args.pins, args.file, args.tool, args.tag, args.note);
        result.records = Object.keys(loadPins(args.pins).records);
      } else if (args.verifyFile) {
        if (!args.tool) throw new Error('--verify-file 需要 --tool');
        result.verifyResult = await verifyFileAgainstRecords(args.pins, args.verifyFile, args.tool, args.strict);
        result.records = Object.keys(loadPins(args.pins).records);
        if (result.verifyResult.status === 'FAIL') exitCode = 1;
        else if (result.verifyResult.status === 'WARN' && args.strict) exitCode = 1;
      } else {
        const checks = await runChecks(args);
        Object.assign(result, checks);
        if (checks.problems.length) exitCode = 1;
        if (checks.checks.some((c) => c.status === 'FAIL')) exitCode = 1;
      }
      if (args.json) console.log(JSON.stringify(result, null, 2));
      if (args.markdown) process.stdout.write(renderMarkdown(result));
      process.exit(exitCode);
    } catch (err) {
      console.error(err.stack || err.message || String(err));
      console.error(usage());
      process.exit(1);
    }
  })();
}

module.exports = { loadPins, validateRecords, validatePythonPackages, comparePythonPackages, recordPin, verifyFileAgainstRecords, runChecks, sha256File };
