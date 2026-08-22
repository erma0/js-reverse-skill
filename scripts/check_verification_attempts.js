#!/usr/bin/env node
'use strict';

// 验证码验证失败复盘（REAL_VERIFY 阶段）。
// 读 attempts.json，按 (authorization_scope, captcha_type, chosen_solution) 分组，
// 规则：有成功→方案可用需优化；连续5次失败+诊断全ok+无成功→先降级人工接管（人工不适用再切打码平台）。
// 与 references/captcha/verification-workflow.md 契约对齐。

const fs = require('fs');

function parseArgs(argv) {
  const args = { file: null, json: false, markdown: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--file' || a === '-f') args.file = nextVal(undefined);
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
  node scripts/check_verification_attempts.js --file attempts.json --markdown
  node scripts/check_verification_attempts.js --file attempts.json --json

不提供 --file 时从标准输入读取。契约定义见 references/captcha/verification-workflow.md。
字段与 answer JSON（captcha_type/provider/challenge_binding）复用，追加 success + diagnosis_status + failure_reason。`;
}

const FAILURE_THRESHOLD = 5;
const DIAGNOSIS_KEYS = ['image', 'coordinates', 'track', 'browser_env', 'challenge_freshness'];
const SKIP_PLATFORM_TYPES = ['pow-challenge', 'waf-challenge', 'biometric-liveness'];

function evaluate(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errors: ['顶层必须是 JSON 对象'], warnings, groups: [], escalation_decision: 'invalid' };
  }
  const scope = data.authorization_scope || '<未指定>';
  const captchaType = data.captcha_type || '<未指定>';
  const chosenSolution = data.chosen_solution || '<未指定>';
  const attempts = Array.isArray(data.attempts) ? data.attempts : null;
  if (!attempts) {
    errors.push('缺少 attempts 数组');
    return { errors, warnings, groups: [], escalation_decision: 'invalid' };
  }

  let hasSuccess = false;
  let consecutiveFailures = 0;
  let maxConsecutiveFailures = 0;
  let allDiagnosisOk = true;
  let failureCount = 0;
  let diagnosedFailures = 0;
  const failureReasons = [];
  const unknownDiagKeys = new Set();

  for (const att of attempts) {
    if (!att || typeof att !== 'object') { warnings.push('存在非对象 attempt，已跳过'); continue; }
    if (att.success) {
      hasSuccess = true;
      consecutiveFailures = 0;
      continue;
    }
    consecutiveFailures++;
    failureCount++;
    if (consecutiveFailures > maxConsecutiveFailures) maxConsecutiveFailures = consecutiveFailures;

    const diag = att.diagnosis_status || {};
    if (DIAGNOSIS_KEYS.some((k) => diag[k])) diagnosedFailures++;
    for (const k of DIAGNOSIS_KEYS) {
      if (diag[k] && diag[k] !== 'ok') allDiagnosisOk = false;
    }
    for (const k of Object.keys(diag)) {
      if (!DIAGNOSIS_KEYS.includes(k)) unknownDiagKeys.add(k);
    }
    if (att.failure_reason) failureReasons.push(att.failure_reason);
  }

  if (unknownDiagKeys.size > 0) {
    warnings.push(`诊断 key 不在已知清单（${[...unknownDiagKeys].join('、')}），不参与全 ok 判定；已知 key 为 ${DIAGNOSIS_KEYS.join('/')}`);
  }

  const diagnosisMissing = failureCount - diagnosedFailures;
  if (diagnosisMissing > 0) {
    allDiagnosisOk = false;
    warnings.push(`${diagnosisMissing} 次失败缺少 diagnosis_status，不能视为"诊断全 ok"；补齐诊断证据后再评估是否切平台`);
  }

  let decision = 'continue';
  let reason = '';

  if (hasSuccess) {
    decision = 'optimize-current';
    reason = `已有成功样本，当前方案可用但需优化稳定性（连续失败 ${maxConsecutiveFailures} 次）`;
  } else if (maxConsecutiveFailures < FAILURE_THRESHOLD) {
    decision = 'collect-more';
    reason = `连续失败 ${maxConsecutiveFailures} 次 < ${FAILURE_THRESHOLD}，继续收集样本和诊断证据`;
  } else if (diagnosisMissing > 0) {
    decision = 'need-diagnosis';
    reason = `${diagnosisMissing} 次失败缺少 diagnosis_status，无法确认图片/坐标/轨迹/环境/challenge 均无异常；先补齐诊断证据`;
  } else if (!allDiagnosisOk) {
    decision = 'fix-blocking-issue';
    reason = '诊断存在非 ok 项，优先修复对应问题（图片/坐标/轨迹/补环境/challenge）';
  } else if (SKIP_PLATFORM_TYPES.includes(captchaType)) {
    decision = 'official-or-manual';
    reason = `${captchaType} 不默认推荐普通打码平台，优先走官方协议/环境诊断/人工复核`;
  } else {
    // 与 captcha-solving-handoff.md 的优先级链对齐：②人工接管 在 ③打码平台 之前。
    // 当前方案已是人工接管时才直接推荐打码平台；否则先降级到人工接管（click_gap / RuyiTrace 手动通过）。
    const isManualSolution = /人工|manual|click_gap/i.test(chosenSolution);
    decision = isManualSolution ? 'recommend-platform-control' : 'try-manual-takeover';
    reason = isManualSolution
      ? `连续 ${maxConsecutiveFailures} 次失败且无成功，诊断全 ok，当前已是人工接管 → 建议切换打码平台做授权 QA 对照`
      : `连续 ${maxConsecutiveFailures} 次失败且无成功，诊断全 ok → 先降级人工接管（click_gap.py / RuyiTrace 手动通过）；人工不适用（需自动化/规模化）时再切打码平台`;
  }

  return {
    escalation_decision: decision,
    reason,
    authorization_scope: scope,
    captcha_type: captchaType,
    chosen_solution: chosenSolution,
    total_attempts: attempts.length,
    has_success: hasSuccess,
    max_consecutive_failures: maxConsecutiveFailures,
    failure_threshold: FAILURE_THRESHOLD,
    diagnosed_failures: diagnosedFailures,
    diagnosis_missing: diagnosisMissing,
    all_diagnosis_ok: allDiagnosisOk,
    platform_role: '授权 QA 对照',
    send_request: false,
    errors,
    warnings,
  };
}

function renderMarkdown(r) {
  const lines = [];
  const label = {
    'continue': 'CONTINUE',
    'optimize-current': 'OPTIMIZE',
    'collect-more': 'COLLECT',
    'need-diagnosis': 'DIAGNOSE',
    'fix-blocking-issue': 'FIX',
    'recommend-platform-control': 'ESCALATE',
    'official-or-manual': 'MANUAL',
    'invalid': 'INVALID',
  }[r.escalation_decision] || r.escalation_decision;
  lines.push(`## check_verification_attempts 结果：${label}`);
  lines.push('');
  lines.push(`- 决策：${r.escalation_decision}`);
  lines.push(`- 理由：${r.reason}`);
  lines.push(`- 授权范围：${r.authorization_scope}`);
  lines.push(`- 题型：${r.captcha_type} / 方案：${r.chosen_solution}`);
  lines.push(`- 总尝试：${r.total_attempts} / 有成功：${r.has_success ? '是' : '否'}`);
  lines.push(`- 最大连续失败：${r.max_consecutive_failures} / 阈值：${r.failure_threshold}`);
  lines.push(`- 诊断覆盖：${r.diagnosed_failures} 次已诊断 / ${r.diagnosis_missing} 次缺诊断`);
  lines.push(`- 诊断全 ok：${r.all_diagnosis_ok ? '是' : '否'}`);
  if (r.errors.length) { lines.push(''); lines.push('### Errors'); r.errors.forEach(e => lines.push(`- ${e}`)); }
  if (r.warnings.length) { lines.push(''); lines.push('### Warnings'); r.warnings.forEach(w => lines.push(`- ${w}`)); }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); process.exit(0); }

  let raw;
  try {
    raw = args.file
      ? fs.readFileSync(args.file, 'utf8').replace(/^\uFEFF/, '')
      : fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    console.error(`读取输入失败：${e.message}`);
    process.exit(2);
  }

  let data;
  try { data = JSON.parse(raw); }
  catch (e) { console.error(`JSON 解析失败：${e.message}`); process.exit(2); }

  const result = evaluate(data);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  else console.log(renderMarkdown(result));
  process.exit(result.errors.length ? 1 : 0);
}

main();
