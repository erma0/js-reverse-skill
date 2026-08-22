#!/usr/bin/env node
'use strict';

// TRACE_CAPTURE / FORENSIC_CAPTURE 出口门禁：复检 Step 2（RuyiTrace NDJSON）是否真实产出。
// 防止 AI"声明已采集 trace"但实际跳过 RuyiTrace，直接进入 CASE_LOOKUP / EXTERNAL_LOOKUP 拼凑。
// 内部复用 check_evidence.js 的 check()，判定标准为 result.step2.evidence。
// 退出码：0 = Step 2 已具备（可进 CASE_LOOKUP）；1 = Step 2 缺失（停在 TRACE_CAPTURE / TRACE_RETRY）。
// --require-trace-signal 要求 NDJSON 命中环境 API / 写入点；网络 URL 不属于 trace 信号。
// --require-target-signal 仅保留兼容旧调用。
// 本脚本只卡 Step 2；Step 1 是否齐全由 GATE-2 入口门禁（check_evidence.js）负责，不重复判定。

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { check: checkEvidence } = require('./check_evidence');

function parseArgs(argv) {
  const args = { caseDir: '.', inputs: '', url: '', requireTargetSignal: [], requireTraceSignal: [], json: false, markdown: false, help: false, selfTest: false };
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
    else if (a === '--inputs' || a === '-i') args.inputs = nextVal();
    else if (a === '--url' || a === '-u') args.url = nextVal();
    else if (a === '--require-target-signal') args.requireTargetSignal.push(nextVal());
    else if (a === '--require-trace-signal') args.requireTraceSignal.push(nextVal());
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  args.requireTargetSignal = args.requireTargetSignal.filter((s) => s && s.trim());
  args.requireTraceSignal = args.requireTraceSignal.filter((s) => s && s.trim());
  return args;
}

function usage() {
  return `用法：
  node scripts/check_trace_gate.js --case-dir <project-root> --url <目标URL> --markdown
  node scripts/check_trace_gate.js --case-dir <project-root> --url <目标URL> --require-trace-signal <环境API/写入点> --markdown
  node scripts/check_trace_gate.js --self-test

说明：
- TRACE_CAPTURE / FORENSIC_CAPTURE 出口门禁：采集声明完成后、进入 CASE_LOOKUP 前必跑。
- 复用 check_evidence.js 判定 Step 2（RuyiTrace NDJSON）是否真实产出，判定标准为 result.step2.evidence。
- 退出码是硬信号：Step 2 已具备（NDJSON 存在 + 关联目标域 + 命中目标信号）退出 0，可进入 CASE_LOOKUP；
  Step 2 缺失退出 1，停在 TRACE_CAPTURE / TRACE_RETRY，不得进入 CASE_LOOKUP / EXTERNAL_LOOKUP。
- 声明"已采集 trace"不等于 Step 2 已产出：以本脚本退出码为准，防止"声明不执行"直接跳到 EXTERNAL_LOOKUP 拼凑。
- --require-trace-signal（可多次）：只要求 NDJSON 命中环境 API / writer / 参数写入点。
- --require-target-signal：兼容旧调用；新流程不要传目标接口 URL，JSONP/script/导航 URL 通常不会出现在 trace。
- 本脚本只卡 Step 2；Step 1 是否齐全由 GATE-2 入口门禁负责，本脚本不重复判定 Step 1。`;
}

function step2MissingReasons(result) {
  return (result.missing || []).filter((m) => /Step 2|RuyiTrace|NDJSON/.test(m));
}

function renderMarkdown(result, step2Ready) {
  const lines = [
    '# TRACE_CAPTURE 出口门禁复检',
    '',
    `case 目录：${result.caseSubdir}`,
    `目标 URL：${result.url || '未提供'}`,
    `Step 2（RuyiTrace NDJSON）证据：${result.step2 && result.step2.evidence ? '已具备' : '缺失'}`,
    `目标 writer/参数链覆盖：${result.step2 && result.step2.targetCoverage ? '已命中或未要求' : '未命中'}`,
    '',
    '## Step 2 证据详情',
  ];
  for (const c of result.step2.checks) {
    lines.push(`- [${c.ok ? 'x' : ' '}] ${c.label}${c.detail ? `：${c.detail}` : ''}`);
  }
  const step2User = (result.userInputs || []).filter((u) => u.step2);
  if (step2User.length) lines.push(`- [x] 用户材料计入 Step 2：${step2User.map((u) => `${u.path}（${u.kind}）`).join('；')}`);

  if (!step2Ready) {
    lines.push('', '## 缺失原因（不可跳过）');
    const reasons = step2MissingReasons(result);
    if (reasons.length) {
      for (const m of reasons) lines.push(`- ${m}`);
    } else {
      lines.push(result.step2 && result.step2.evidence
        ? '- NDJSON 已产出，但目标 writer/参数链信号未命中；这不是“没有 trace”，应修正信号或进入 TRACE_RETRY。'
        : '- Step 2 NDJSON 未产出或未通过内容校验');
    }
  }

  lines.push('', '## 结论');
  if (step2Ready) {
    lines.push('- [PASS] Step 2 已具备，可进入 CASE_LOOKUP。');
  } else {
    lines.push(result.step2 && result.step2.evidence
      ? '- [BLOCK] Step 2 已具备，但目标链路覆盖不足，停在 TRACE_RETRY。'
      : '- [BLOCK] Step 2 缺失，停在 TRACE_CAPTURE / TRACE_RETRY。');
    lines.push('- 不得进入 CASE_LOOKUP / EXTERNAL_LOOKUP；不得以 EXTERNAL_LOOKUP 方案、边界声明或 mock 替代 Step 2 证据。');
    lines.push('- 声明"已采集 trace"不等于 Step 2 已产出，以本脚本退出码为准。');
  }
  return `${lines.join('\n')}\n`;
}

function checkStep2Gate(args) {
  const explicitTraceSignals = Array.isArray(args.requireTraceSignal) ? args.requireTraceSignal : [];
  const legacySignals = Array.isArray(args.requireTargetSignal) ? args.requireTargetSignal : [];
  const traceSignals = explicitTraceSignals.length ? explicitTraceSignals : legacySignals;
  const result = checkEvidence({
    caseDir: args.caseDir,
    url: args.url,
    inputs: args.inputs,
    requireTargetSignal: [],
    requireNetworkSignal: [],
    requireTraceSignal: traceSignals,
  });
  const step2Ready = !!(result.step2 && result.step2.evidence && result.step2.targetCoverage !== false);
  return { result, step2Ready };
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-gate-'));
  try {
    const targetUrl = 'https://api.example.com/page';

    // case 1: 只有 Step 1（capture 命中目标接口），Step 2 缺失 → 退出 1
    const case1 = path.join(root, 'step1-only');
    const case1Forensic = path.join(case1, 'case', 'forensic');
    fs.mkdirSync(case1Forensic, { recursive: true });
    fs.writeFileSync(path.join(case1Forensic, 'capture.json'), JSON.stringify([
      { url: targetUrl, method: 'POST', request_body: 'x', response_status: 200 },
    ]), 'utf8');
    const r1 = checkStep2Gate({ caseDir: case1, inputs: '', url: targetUrl });
    if (r1.step2Ready) throw new Error('case1 应 Step 2 缺失');
    const cli1 = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', case1, '--url', targetUrl, '--json'], { encoding: 'utf8' });
    if (cli1.status !== 1) throw new Error(`case1 应退出 1，实际 ${cli1.status}`);

    // case 2: Step 1 + Step 2 齐备 → 退出 0
    const case2 = path.join(root, 'both');
    const case2Forensic = path.join(case2, 'case', 'forensic');
    const case2Trace = path.join(case2, 'case', 'ruyi-trace', 'logs');
    fs.mkdirSync(case2Forensic, { recursive: true });
    fs.mkdirSync(case2Trace, { recursive: true });
    fs.writeFileSync(path.join(case2Forensic, 'capture.json'), JSON.stringify([
      { url: targetUrl, method: 'POST', request_body: 'x', response_status: 200 },
    ]), 'utf8');
    fs.writeFileSync(path.join(case2Trace, 'trace.ndjson'), `${JSON.stringify({ api: 'fetch', url: targetUrl })}\n`, 'utf8');
    const r2 = checkStep2Gate({ caseDir: case2, inputs: '', url: targetUrl });
    if (!r2.step2Ready) throw new Error('case2 应 Step 2 具备');
    const cli2 = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', case2, '--url', targetUrl, '--json'], { encoding: 'utf8' });
    if (cli2.status !== 0) throw new Error(`case2 应退出 0，实际 ${cli2.status}`);

    // case 3: Step 2 存在但 target-signal 未命中 → step2.evidence=false → 退出 1
    const cli3 = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', case2, '--url', targetUrl, '--require-target-signal', 'handshake', '--markdown'], { encoding: 'utf8' });
    if (cli3.status !== 1) throw new Error(`case3 应退出 1（target-signal 未命中），实际 ${cli3.status}`);
    if (!/目标信号未命中/.test(cli3.stdout)) throw new Error('case3 输出应含「目标信号未命中」');

    // case 4: Step 2-only（用户仅提供 NDJSON）→ step2.evidence=true → 退出 0
    const ndjson = path.join(root, 'input.ndjson');
    fs.writeFileSync(ndjson, `${JSON.stringify({ stack: { file: 'https://static.example.com/app.js' } })}\n`, 'utf8');
    const cli4 = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', path.join(root, 'empty'), '--url', targetUrl, '--inputs', ndjson, '--json'], { encoding: 'utf8' });
    if (cli4.status !== 0) throw new Error(`case4 应退出 0（用户提供 NDJSON），实际 ${cli4.status}`);

    // case 5: 空目录（无任何证据）→ Step 2 缺失 → 退出 1
    const cli5 = childProcess.spawnSync(process.execPath, [__filename, '--case-dir', path.join(root, 'empty2'), '--url', targetUrl, '--markdown'], { encoding: 'utf8' });
    if (cli5.status !== 1) throw new Error(`case5 应退出 1（无证据），实际 ${cli5.status}`);
    if (!/停在 TRACE_CAPTURE/.test(cli5.stdout)) throw new Error('case5 输出应含「停在 TRACE_CAPTURE」');

    return { clean: true, tests: 5 };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) { console.log(usage()); process.exit(0); }
    if (args.selfTest) {
      const result = runSelfTest();
      console.log(`check_trace_gate.js 自测通过：${result.tests} 项断言`);
      process.exit(0);
    }
    const { result, step2Ready } = checkStep2Gate(args);
    if (args.json) {
      console.log(JSON.stringify({
        caseDir: result.caseDir,
        url: result.url,
        mode: result.mode,
        step2Evidence: step2Ready,
        exitCode: step2Ready ? 0 : 1,
      }, null, 2));
    }
    if (args.markdown) process.stdout.write(renderMarkdown(result, step2Ready));
    process.exit(step2Ready ? 0 : 1);
  } catch (err) {
    console.error(err.stack || err.message || String(err));
    console.error(usage());
    process.exit(1);
  }
}

module.exports = { checkStep2Gate, renderMarkdown };
