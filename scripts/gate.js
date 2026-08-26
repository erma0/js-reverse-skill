#!/usr/bin/env node
'use strict';

// 按节点聚合门禁：一次跑完当前状态机节点应验的全部门禁脚本并汇总 PASS / FAIL / SKIP。
// 用途：
// 1) 解决"该跑三个门禁却跑零个 / 分不清该跑哪个"——进入每个节点前运行一次即可；
// 2) 无 --at 时从 <case-dir>/state.json 读取当前节点（依赖 scripts/state_machine.js 的状态跟踪）。
// 任一必跑门禁 FAIL（或脚本不存在 / 参数缺失导致无法验证）且非 SKIP 时退出码非 0，停在当前节点。

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require(process.env.GATE_PATHS || './lib/paths');

// 节点 → 门禁脚本清单。required 参数缺失时该门禁标记为 SKIP（总结中注明，不误报 PASS）。
// args 函数签名 (caseDir, ctx) => string[]，ctx 存放 --url/--inputs/--require-trace-signal 等透传参数。
const GATE_SCRIPTS = {
  'ENV_READY': [
    { script: 'check_session_resume.js', args: (c) => ['--case-dir', c, '--project-dir', c, '--markdown'] },
    { script: 'check_external_tools.js', args: () => ['--markdown', '--offline'] },
    { script: 'precheck_runtime.js', args: () => ['--markdown'] },
  ],
  'EVIDENCE_GATE': [
    { script: 'check_evidence.js', args: (c, ctx) => ['--case-dir', c, '--url', ctx.url, '--inputs', ctx.inputs, '--markdown'], required: ['url', 'inputs'], hint: '需要 --url 与 --inputs' },
  ],
  'TRACE_CAPTURE': [
    { script: 'check_trace_gate.js', args: (c, ctx) => ['--case-dir', c, '--url', ctx.url, ...(ctx.traceSignal ? ['--require-trace-signal', ctx.traceSignal] : []), '--markdown'], required: ['url'], hint: '需要 --url' },
  ],
  'TRACE_RETRY': [
    { script: 'check_trace_gate.js', args: (c, ctx) => ['--case-dir', c, '--url', ctx.url, ...(ctx.traceSignal ? ['--require-trace-signal', ctx.traceSignal] : []), '--markdown'], required: ['url'], hint: '需要 --url' },
  ],
  'FORENSIC_CAPTURE': [
    { script: 'check_trace_gate.js', args: (c, ctx) => ['--case-dir', c, '--url', ctx.url, ...(ctx.traceSignal ? ['--require-trace-signal', ctx.traceSignal] : []), '--markdown'], required: ['url'], hint: '需要 --url（补采后复核出口门禁）' },
  ],
  'IMPLEMENT': [
    { script: 'check_env_prerequisites.js', args: (c) => ['--case-dir', c, '--markdown'] },
    { script: 'check_trace_gate.js', args: (c, ctx) => ['--case-dir', c, '--url', ctx.url, ...(ctx.traceSignal ? ['--require-trace-signal', ctx.traceSignal] : []), '--markdown'], required: ['url'], hint: '需要 --url（Step 2 前置）' },
  ],
  'DIAGNOSE': [
    { script: 'check_risk_layer_diagnosis.js', args: (c) => ['--case-dir', c, '--markdown'] },
  ],
  'DELIVER': [
    { script: 'check_final_artifact.js', args: (c) => ['--case-dir', c, '--markdown'] },
    { script: 'check_code_quality.js', args: (c) => ['--case-dir', c, '--markdown'] },
  ],
  'SIGN_ONLY_DELIVER': [
    { script: 'check_final_artifact.js', args: (c) => ['--case-dir', c, '--markdown'] },
    { script: 'check_code_quality.js', args: (c) => ['--case-dir', c, '--markdown'] },
  ],
  'CLEANUP': [
    { script: 'check_final_artifact.js', args: (c) => ['--case-dir', c, '--markdown'] },
    { script: 'check_code_quality.js', args: (c) => ['--case-dir', c, '--markdown'] },
    { script: 'check_risk_layer_diagnosis.js', args: (c) => ['--case-dir', c, '--markdown'] },
  ],
};

function parseArgs(argv) {
  const args = {
    caseDir: '',
    at: '',
    url: '',
    inputs: '',
    traceSignal: '',
    list: false,
    json: false,
    markdown: false,
    help: false,
    selfTest: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = () => {
      if (i + 1 >= argv.length || typeof argv[i + 1] !== 'string' || argv[i + 1].startsWith('-')) {
        throw new Error(`参数 ${a} 缺少值`);
      }
      i += 1;
      return argv[i];
    };
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = nextVal();
    else if (a === '--at' || a === '--node') args.at = nextVal().toUpperCase();
    else if (a === '--url') args.url = nextVal();
    else if (a === '--inputs') args.inputs = nextVal();
    else if (a === '--require-trace-signal' || a === '--trace-signal') args.traceSignal = nextVal();
    else if (a === '--list') args.list = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/gate.js --case-dir <case-dir> --at <NODE> [--url <目标URL>] [--inputs <材料路径>] [--require-trace-signal <写入点>] [--markdown]
  node scripts/gate.js --case-dir <case-dir> [--markdown]      # 无 --at 时从 state.json 读取当前节点
  node scripts/gate.js --list                                    # 列出节点 → 门禁映射
说明：
- 聚合执行当前节点必验的门禁脚本并汇总 PASS / FAIL / SKIP；
  含 FAIL 或需参数缺失（SKIP 非因无需求而跳过）时退出码非 0，停在当前节点。
- EVIDENCE_GATE 需要 --url 与 --inputs；TRACE_CAPTURE / TRACE_RETRY / FORENSIC_CAPTURE / IMPLEMENT 需要 --url。`;
}

function nodeFromState(caseDir) {
  const p = path.join(caseDir, 'state.json');
  try {
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));
    return s.node || '';
  } catch { return ''; }
}

function runGate(caseDir, node, ctx) {
  const specs = GATE_SCRIPTS[node] || [];
  if (!specs.length) {
    return { node, items: [], note: `节点 ${node} 无聚合门禁（不是必验门禁节点）` };
  }
  const items = [];
  for (const spec of specs) {
    const missing = (spec.required || []).filter((k) => !ctx[k]);
    const scriptPath = path.join(__dirname, spec.script);
    let result = { script: spec.script, status: 'SKIP', code: 0, reason: '' };
    if (missing.length) {
      result.reason = `缺少参数 ${missing.join('/')}（${spec.hint || ''}）`;
    } else {
      const r = spawnSync(process.execPath, [scriptPath, ...spec.args(caseDir, ctx)], { encoding: 'utf8', timeout: 120000, windowsHide: true });
      const code = r.status == null ? 1 : r.status;
      result.code = code;
      result.status = code === 0 ? 'PASS' : 'FAIL';
      result.reason = (r.stderr || '').trim().split(/\r?\n/).filter(Boolean).slice(0, 3).join('\n') || `${code === 0 ? '退出码 0' : '退出码 ' + code}`;
      result.output = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(0, 12);
    }
    items.push(result);
  }
  return { node, items };
}

function renderMarkdown(res) {
  const lines = [];
  lines.push(`# 聚合门禁：${res.node}`);
  lines.push('');
  if (res.note) { lines.push(`> ${res.note}`); lines.push(''); }
  for (const it of res.items) {
    const mark = it.status === 'PASS' ? 'PASS' : it.status === 'FAIL' ? '**FAIL**' : 'SKIP';
    lines.push(`- ${mark} \`${it.script}\``);
    if (it.reason) lines.push(`  - ${it.reason}`);
    for (const o of (it.output || [])) lines.push(`    - ${o}`);
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); return 0; }
  if (args.selfTest) {
    const missing = [];
    for (const specs of Object.values(GATE_SCRIPTS)) {
      for (const s of specs) {
        if (!fs.existsSync(path.join(__dirname, s.script))) missing.push(s.script);
      }
    }
    if (missing.length) { console.error(`self-test: 门禁脚本不存在：${missing.join(', ')}`); return 1; }
    console.log('gate.js self-test: PASS');
    return 0;
  }
  if (args.list) {
    for (const [node, specs] of Object.entries(GATE_SCRIPTS)) {
      console.log(`${node}: ${specs.map((s) => s.script).join(', ') || '（无必验门禁）'}`);
    }
    return 0;
  }
  if (!args.caseDir) {
    console.error('缺少 --case-dir');
    console.error(usage());
    return 1;
  }
  const caseDir = paths.resolveCaseDir(args.caseDir);
  const node = args.at || nodeFromState(caseDir);
  if (!node) {
    console.error(`无法确定节点：未传 --at 且 ${path.join(caseDir, 'state.json')} 不存在（可先运行 scripts/state_machine.js --init 或直接传 --at）`);
    return 1;
  }
  const ctx = { url: args.url, inputs: args.inputs, traceSignal: args.traceSignal };
  const res = runGate(caseDir, node, ctx);
  const hasFail = res.items.some((it) => it.status === 'FAIL');
  const hasReqMissing = res.items.some((it) => it.status === 'SKIP' && it.reason && /缺少参数/.test(it.reason));
  if (args.json) {
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log(renderMarkdown(res));
  }
  return hasFail || hasReqMissing ? 1 : 0;
}

process.exit(main());