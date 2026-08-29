#!/usr/bin/env node
'use strict';

// IMPLEMENT 前置两文件门禁：走路径 B/C/D（最小 JS 沙箱 / WASM / 环境伪装）且需要补浏览器对象前，
// case/notes/entry-chain.md 与 case/notes/missing-env-priority.md 必须已产出且内容达标。
// 防"根据 Node.js 报错盲补"导致的十几轮「加载→崩→猜→再加载」空转循环（SKILL.md 4.4 硬约束）。
// 退出码：0 = 两文件齐备且内容达标；1 = 缺文件或内容不达标（不得开始补环境）。

const fs = require('fs');
const path = require('path');
const { resolveCaseDir } = require('./lib/paths');

function parseArgs(argv) {
  const args = { caseDir: '.', json: false, markdown: false, help: false, selfTest: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = nextVal('.');
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
  node scripts/check_env_prerequisites.js --case-dir <project-root> --markdown
  node scripts/check_env_prerequisites.js --self-test

说明：
- IMPLEMENT 前置（SKILL.md 4.4）：补环境（路径 B/C/D）前必须基于 RuyiTrace 产出两份文件，缺一不得开始。
- entry-chain.md 校验：非空，且至少含一处 stack 定位（文件名:行号 形态，如 app.js:123 或 https://.../app.js:123:5；webpack sourceURL 的 js?:147:37 带查询串形态也接受）。
- missing-env-priority.md 校验：非空；含优先级标记（"优先级"或 P0/P1/P2 表述），且含证据来源标记
  （"RuyiTrace 证据" / "Node trace 补充" / "推断"）或黑盒声明（"黑盒执行，不逐项精确复现"）。
- 黑盒执行无法逐项精确复现时允许以"已观测环境读取清单 + 黑盒声明"替代逐项清单，但不得以黑盒为由跳过本门禁。`;
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

// stack 定位：文件路径/名 + :行号（可选 :列号）。兼容 https://host/a.js:1:2、app.js:33、chunk-1.js:88，
// 以及 webpack eval sourceURL 带查询串的形态 webpack:///./pkg/index_bg.js?:147:37（? 归一化前原样，match20 实测）
const STACK_REF_RE = /[\w./@~?=-]+\.[A-Za-z0-9]{1,5}\??\s*:\d+(?::\d+)?/;

function checkEntryChain(text) {
  const problems = [];
  if (!text.trim()) {
    problems.push('entry-chain.md 内容为空');
    return problems;
  }
  if (!STACK_REF_RE.test(text)) {
    problems.push('entry-chain.md 未发现 stack 定位（文件名:行号 形态）；入口→请求链必须落在具体 stack.file:line:col，不接受纯文字描述');
  }
  if (!/入口|entry/i.test(text)) {
    problems.push('entry-chain.md 未标明入口函数/入口点（应含「入口」或 entry 表述）');
  }
  return problems;
}

function checkMissingEnvPriority(text) {
  const problems = [];
  if (!text.trim()) {
    problems.push('missing-env-priority.md 内容为空');
    return problems;
  }
  if (!/优先级|P[012]\b/i.test(text)) {
    problems.push('missing-env-priority.md 未发现优先级标记（「优先级」或 P0/P1/P2）；补齐必须有先后依据');
  }
  // match23 实测放宽：「RuyiTrace seq7664」这类带 seq 号的引用也应视为 RuyiTrace 证据标记
  const hasEvidenceMark = /RuyiTrace\s*(证据|seq)|Node\s*trace\s*补充|trace\s*证据|推断/.test(text);
  const hasBlackboxDecl = /黑盒执行，不逐项精确复现/.test(text);
  if (!hasEvidenceMark && !hasBlackboxDecl) {
    problems.push('missing-env-priority.md 未发现证据来源标记（「RuyiTrace 证据/seq / Node trace 补充 / 推断」），也没有黑盒声明（「黑盒执行，不逐项精确复现」）');
  }
  return problems;
}

function check(caseDir) {
  const notesDir = path.join(resolveCaseDir(caseDir), 'notes');
  const files = {
    'entry-chain.md': path.join(notesDir, 'entry-chain.md'),
    'missing-env-priority.md': path.join(notesDir, 'missing-env-priority.md'),
  };
  const problems = [];
  const details = [];
  for (const [name, file] of Object.entries(files)) {
    if (!exists(file)) {
      problems.push(`缺少 case/notes/${name}（IMPLEMENT 前置硬约束，两文件缺一不得开始补环境）`);
      details.push({ name, ok: false, detail: '文件不存在' });
      continue;
    }
    let text = '';
    try { text = readText(file); } catch (err) {
      problems.push(`case/notes/${name} 读取失败：${err.message}`);
      details.push({ name, ok: false, detail: err.message });
      continue;
    }
    const sub = name === 'entry-chain.md' ? checkEntryChain(text) : checkMissingEnvPriority(text);
    for (const p of sub) problems.push(`${name}：${p}`);
    details.push({ name, ok: sub.length === 0, detail: sub.length ? sub.join('；') : '内容达标' });
  }
  return { caseDir, notesDir, details, problems, pass: problems.length === 0 };
}

function renderMarkdown(result) {
  const lines = ['# IMPLEMENT 补环境前置门禁', '',
    `- notes 目录：${result.notesDir}`, ''];
  for (const d of result.details) {
    lines.push(`- [${d.ok ? 'x' : ' '}] case/notes/${d.name}：${d.detail}`);
  }
  lines.push('', '## 结论');
  if (result.pass) {
    lines.push('- [PASS] 两文件齐备且内容达标，可开始补环境（按证据驱动的最小集合）。');
  } else {
    lines.push('- [BLOCK] 不得开始补环境：先基于 RuyiTrace NDJSON 补全两文件（scripts/analyze_trace.js --summary 可抽取环境读取清单），再复跑本门禁。');
    lines.push('- 禁止根据 Node.js 报错盲补——那会进入「加载→崩→猜→再加载」的空转循环。');
    lines.push('- 黑盒执行无法逐项精确复现时，missing-env-priority.md 至少列出已观测的环境读取/挂载点并标注「黑盒执行，不逐项精确复现」。');
  }
  return lines.join('\n') + '\n';
}

function runSelfTest() {
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'env-prereq-'));
  try {
    // case 1: 两文件缺失 → 不通过
    let r = check(root);
    if (r.pass) throw new Error('缺文件应不通过');
    if (r.problems.length !== 2) throw new Error('应报两个缺失问题');

    // case 2: 内容达标 → 通过
    fs.mkdirSync(path.join(root, 'case', 'notes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'case', 'notes', 'entry-chain.md'), '入口 window.sign\n请求链 fetch ← makeSign\n关键 stack https://static.example.com/app.js:120:8', 'utf8');
    fs.writeFileSync(path.join(root, 'case', 'notes', 'missing-env-priority.md'), '| 模块 | api | 优先级 | 证据 |\n|---|---|---|---|\n| navigator | userAgent | P0 | RuyiTrace 证据 |\n| screen | width | P1 | 推断 |', 'utf8');
    r = check(root);
    if (!r.pass) throw new Error(`达标应通过，实际：${r.problems.join('；')}`);

    // case 3: entry-chain 无 stack 定位 → 不通过
    fs.writeFileSync(path.join(root, 'case', 'notes', 'entry-chain.md'), '入口 sign，链条 fetch，全部文字描述', 'utf8');
    r = check(root);
    if (r.pass || !r.problems.some((p) => p.includes('stack 定位'))) throw new Error('无 stack 定位应拦截');

    // case 4: 黑盒声明可替代证据来源标记 → 通过
    fs.writeFileSync(path.join(root, 'case', 'notes', 'entry-chain.md'), '入口 window.sign stack sdk.js:8:1\n', 'utf8');
    fs.writeFileSync(path.join(root, 'case', 'notes', 'missing-env-priority.md'), '优先级：整体黑盒。已观测读取 document.cookie、navigator.userAgent；黑盒执行，不逐项精确复现', 'utf8');
    r = check(root);
    if (!r.pass) throw new Error(`黑盒声明应通过，实际：${r.problems.join('；')}`);

    // case 5: 空文件 → 不通过
    fs.writeFileSync(path.join(root, 'case', 'notes', 'missing-env-priority.md'), '   \n', 'utf8');
    r = check(root);
    if (r.pass || !r.problems.some((p) => p.includes('内容为空'))) throw new Error('空文件应拦截');

    // case 6: webpack eval sourceURL 带 ? 的 stack 形态 → 通过（match20 实测被旧正则误拒）
    fs.writeFileSync(path.join(root, 'case', 'notes', 'missing-env-priority.md'), '| 模块 | api | 优先级 | 证据 |\n|---|---|---|---|\n| wasm | sign | P0 | RuyiTrace 证据 |', 'utf8');
    fs.writeFileSync(path.join(root, 'case', 'notes', 'entry-chain.md'), '入口 req → builder sign\nstack webpack:///./pkg/index_bg.js?:147:37 func:sign\nstack webpack:///./index.js?:39:19 func:req\n', 'utf8');
    r = check(root);
    if (!r.pass) throw new Error(`webpack ? 形态 stack 应通过，实际：${r.problems.join('；')}`);
    return { clean: true, tests: 6 };
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
      console.log(`check_env_prerequisites.js 自测通过：${r.tests} 项断言`);
      process.exit(0);
    }
    const result = check(args.caseDir);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(result));
    process.exit(result.pass ? 0 : 1);
  } catch (err) {
    console.error(err.stack || err.message || String(err));
    console.error(usage());
    process.exit(1);
  }
}

module.exports = { check, checkEntryChain, checkMissingEnvPriority, runSelfTest };
