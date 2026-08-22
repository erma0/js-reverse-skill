#!/usr/bin/env node
'use strict';

// 状态机/门禁路由回归基准 runner：把 SKILL.md 的硬规则落成可执行断言。
// 每条用例（tests/routing-benchmarks/cases.json）：
//   - files：在临时 caseDir 里还原的证据现场（相对路径 → 内容）；
//   - script + args：要执行的门禁/工具脚本（{caseDir} 占位符替换）；
//   - expectExit + stdoutIncludes/stdoutExcludes/outputIncludes：断言退出码与输出关键词；
//   - skillAnchors：必须在 SKILL.md 中存在的文本锚点（基准与文档双向防漂移）。
// 任何用例失败退出 1；全部通过退出 0。CI 全量运行，改 SKILL.md 门禁语义必须同步改基准。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_ROOT = path.dirname(__dirname);
const DEFAULT_CASES = path.join(SKILL_ROOT, 'tests', 'routing-benchmarks', 'cases.json');

function parseArgs(argv) {
  const args = { cases: DEFAULT_CASES, filter: '', selfTest: false, json: false, markdown: false, help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--cases') args.cases = nextVal(DEFAULT_CASES);
    else if (a === '--filter' || a === '-f') args.filter = nextVal('');
    else if (a === '--self-test') args.selfTest = true;
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
  node scripts/check_routing_benchmarks.js --markdown            # 全量运行路由/门禁基准
  node scripts/check_routing_benchmarks.js --filter RB-006 --markdown
  node scripts/check_routing_benchmarks.js --self-test

说明：
- 基准用例：tests/routing-benchmarks/cases.json（--cases 可覆盖）。
- 每条用例在独立临时目录还原证据现场，真实执行门禁脚本并断言退出码与输出关键词；
  skillAnchors 同步断言 SKILL.md 文本锚点存在，防止「改文档不改基准」或「改门禁不改文档」。
- 新增 SKILL.md 硬规则时同步加用例；新增用例必须先本地跑通再提交。`;
}

function loadCases(casesPath) {
  const doc = JSON.parse(fs.readFileSync(casesPath, 'utf8').replace(/^\uFEFF/, ''));
  if (!doc || !Array.isArray(doc.cases)) throw new Error('基准文件缺少 cases 数组');
  const seen = new Set();
  for (const c of doc.cases) {
    for (const field of ['id', 'title', 'skillAnchors']) {
      if (!c[field]) throw new Error(`用例缺少 ${field}：${JSON.stringify(c).slice(0, 120)}`);
    }
    if (seen.has(c.id)) throw new Error(`用例 id 重复：${c.id}`);
    seen.add(c.id);
    if (c.script != null && !/^scripts\/[A-Za-z0-9_-]+\.(js|py)$/.test(`scripts/${String(c.script).replace(/^scripts\//, '')}`)) {
      throw new Error(`${c.id}：script 必须是 scripts/ 下的脚本文件名`);
    }
  }
  return doc.cases;
}

function buildFixture(root, files) {
  for (const [rel, content] of Object.entries(files || {})) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
}

function runCase(acase, skillText, options = {}) {
  const problems = [];
  // 锚点断言：基准与 SKILL.md 双向防漂移
  for (const anchor of acase.skillAnchors || []) {
    if (!skillText.includes(anchor)) problems.push(`SKILL.md 缺少锚点：「${anchor}」（基准 ${acase.id} 依赖该规则文本）`);
  }
  // 纯锚点用例（script=null）：不执行脚本
  if (acase.script == null) {
    return { id: acase.id, title: acase.title, ok: problems.length === 0, problems };
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `route-bench-${acase.id}-`));
  let exitCode = -1;
  let stdout = '';
  let stderr = '';
  try {
    buildFixture(root, acase.files);
    const scriptPath = path.join(SKILL_ROOT, 'scripts', String(acase.script).replace(/^scripts\//, ''));
    const cliArgs = (acase.args || []).map((a) => String(a).replace(/\{caseDir\}/g, root));
    let ret;
    if (/\.py$/.test(scriptPath)) {
      ret = spawnSync('python', [scriptPath, ...cliArgs], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    } else {
      ret = spawnSync(process.execPath, [scriptPath, ...cliArgs], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    }
    exitCode = ret.status;
    stdout = ret.stdout || '';
    stderr = ret.stderr || '';
    const output = `${stdout}\n${stderr}`;
    if (exitCode !== acase.expectExit) problems.push(`退出码应为 ${acase.expectExit}，实际 ${exitCode}`);
    for (const needle of acase.stdoutIncludes || []) {
      if (!stdout.includes(needle)) problems.push(`stdout 应包含「${needle}」`);
    }
    for (const needle of acase.stdoutExcludes || []) {
      if (stdout.includes(needle)) problems.push(`stdout 不应包含「${needle}」`);
    }
    for (const needle of acase.outputIncludes || []) {
      if (!output.includes(needle)) problems.push(`输出应包含「${needle}」`);
    }
    if (options.verbose && problems.length) {
      problems.push(`--- stdout 片段 ---\n${stdout.slice(0, 800)}\n--- stderr 片段 ---\n${stderr.slice(0, 400)}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return { id: acase.id, title: acase.title, ok: problems.length === 0, problems, exitCode, expectExit: acase.expectExit };
}

function runAll(casesPath, filter, skillPath) {
  const cases = loadCases(casesPath);
  const skillText = fs.readFileSync(skillPath, 'utf8').replace(/^\uFEFF/, '');
  const selected = filter ? cases.filter((c) => c.id.toLowerCase().includes(filter.toLowerCase()) || String(c.title).includes(filter)) : cases;
  const results = selected.map((c) => runCase(c, skillText, { verbose: true }));
  return { total: selected.length, passed: results.filter((r) => r.ok).length, results };
}

function renderMarkdown(report) {
  const lines = ['# 路由/门禁回归基准', '', `- 用例数：${report.total}`, `- 通过：${report.passed}`, `- 失败：${report.total - report.passed}`, ''];
  for (const r of report.results) {
    lines.push(`- [${r.ok ? '通过' : '未通过'}] ${r.id}：${r.title}`);
    for (const p of r.problems || []) lines.push(`  - ${String(p).replace(/\n/g, '\n  ')}`);
  }
  return lines.join('\n') + '\n';
}

function runSelfTest() {
  const os2 = os;
  const root = fs.mkdtempSync(path.join(os2.tmpdir(), 'route-runner-'));
  try {
    const skill = path.join(root, 'SKILL.md');
    fs.writeFileSync(skill, '规则 A：URL 不是证据\n规则 B：TRACE_RETRY\n', 'utf8');
    // 用例 1：真实脚本 + 断言通过
    const ok = runCase({
      id: 'T1', title: '断言通过', skillAnchors: ['URL 不是证据'], script: 'check_evidence.js',
      args: ['--case-dir', '{caseDir}', '--url', 'https://a.example.com/x', '--markdown'],
      files: {}, expectExit: 1, stdoutIncludes: ['缺失证据'],
    }, fs.readFileSync(skill, 'utf8'));
    if (!ok.ok) throw new Error(`应通过：${JSON.stringify(ok.problems)}`);
    // 用例 2：期望退出码错误 → runner 必须报告失败
    const bad = runCase({
      id: 'T2', title: '断言失败', skillAnchors: [], script: 'check_evidence.js',
      args: ['--case-dir', '{caseDir}', '--url', 'https://a.example.com/x', '--markdown'],
      files: {}, expectExit: 0,
    }, fs.readFileSync(skill, 'utf8'));
    if (bad.ok) throw new Error('期望退出码错误时必须失败');
    // 用例 3：SKILL.md 锚点缺失 → 失败
    const anchor = runCase({
      id: 'T3', title: '锚点缺失', skillAnchors: ['不存在的锚点'], script: null, args: [], files: {}, expectExit: 0,
    }, fs.readFileSync(skill, 'utf8'));
    if (anchor.ok) throw new Error('锚点缺失必须失败');
    return { clean: true, tests: 3 };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) { console.log(usage()); process.exit(0); }
    if (args.selfTest) {
      const r = runSelfTest();
      console.log(`check_routing_benchmarks.js 自测通过：${r.tests} 项断言`);
      process.exit(0);
    }
    const report = runAll(args.cases, args.filter, path.join(SKILL_ROOT, 'SKILL.md'));
    if (args.json) console.log(JSON.stringify(report, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(report));
    process.exit(report.passed === report.total ? 0 : 1);
  } catch (err) {
    console.error(err.stack || err.message || String(err));
    console.error(usage());
    process.exit(1);
  }
}

module.exports = { loadCases, runCase, runAll };
