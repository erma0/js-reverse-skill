#!/usr/bin/env node
'use strict';

// 验证码成功样本基线评估（REAL_VERIFY 阶段前置）。
// 读 success_samples.json，统计每个 (authorization_scope, captcha_type) 的成功次数，
// 规则：同一 scope 至少 5 次成功；新类型至少 2 次成功。不足时输出 missing 清单。
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
  node scripts/check_success_baseline.js --file success_samples.json --markdown
  node scripts/check_success_baseline.js --file success_samples.json --json

不提供 --file 时从标准输入读取。契约定义见 references/captcha/verification-workflow.md。
字段与 answer JSON（captcha_type/provider/challenge_binding）复用，追加 success + evidence。`;
}

const MIN_TOTAL = 5;
const MIN_PER_TYPE = 2;

function evaluate(data) {
  const errors = [];
  const warnings = [];

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errors: ['顶层必须是 JSON 对象'], warnings, groups: [], status: 'invalid' };
  }
  const scope = data.authorization_scope || '<未指定>';
  const samples = Array.isArray(data.success_samples) ? data.success_samples : null;
  if (!samples) {
    errors.push('缺少 success_samples 数组');
    return { errors, warnings, groups: [], status: 'invalid' };
  }

  // 按 captcha_type 分组统计成功次数
  const byType = new Map();
  for (const s of samples) {
    if (!s || typeof s !== 'object') { warnings.push('存在非对象样本，已跳过'); continue; }
    const type = s.captcha_type || '<未指定类型>';
    if (!s.success) continue;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(s);
  }

  const groups = [];
  let totalSuccess = 0;
  for (const [type, arr] of byType) {
    totalSuccess += arr.length;
    const need = arr.length >= MIN_TOTAL ? 0 : (MIN_TOTAL - arr.length);
    groups.push({
      captcha_type: type,
      success_count: arr.length,
      sufficient: arr.length >= MIN_PER_TYPE && arr.length >= MIN_TOTAL,
      missing: need > 0 ? need : 0,
    });
  }

  const status = totalSuccess >= MIN_TOTAL ? 'sufficient' : 'insufficient';
  const missingTypes = groups.filter(g => g.success_count < MIN_PER_TYPE);

  if (status === 'insufficient') {
    warnings.push(`成功样本总数 ${totalSuccess} < ${MIN_TOTAL}，基线不足`);
  }
  if (missingTypes.length > 0) {
    warnings.push(`新类型成功样本不足 2 次：${missingTypes.map(t => `${t.captcha_type}(${t.success_count})`).join(', ')}`);
  }

  return {
    status,
    authorization_scope: scope,
    total_success: totalSuccess,
    min_total: MIN_TOTAL,
    min_per_type: MIN_PER_TYPE,
    groups,
    recommended_next_route: status === 'sufficient' ? 'proceed' : 'collect-more-manual-success-samples',
    errors,
    warnings,
  };
}

function renderMarkdown(r) {
  const lines = [];
  lines.push(`## check_success_baseline 结果：${r.status === 'sufficient' ? 'SUFFICIENT' : 'INSUFFICIENT'}`);
  lines.push('');
  lines.push(`- 授权范围：${r.authorization_scope}`);
  lines.push(`- 成功样本总数：${r.total_success} / ${r.min_total}`);
  lines.push(`- 每类型最少：${r.min_per_type}`);
  lines.push(`- 下一步：${r.recommended_next_route}`);
  if (r.groups.length) {
    lines.push('');
    lines.push('### 分组统计');
    lines.push('');
    lines.push('| 题型 | 成功次数 | 是否充足 | 缺少 |');
    lines.push('|---|---|---|---|');
    for (const g of r.groups) {
      lines.push(`| ${g.captcha_type} | ${g.success_count} | ${g.sufficient ? '是' : '否'} | ${g.missing} |`);
    }
  }
  if (r.errors.length) {
    lines.push('');
    lines.push('### Errors');
    r.errors.forEach(e => lines.push(`- ${e}`));
  }
  if (r.warnings.length) {
    lines.push('');
    lines.push('### Warnings');
    r.warnings.forEach(w => lines.push(`- ${w}`));
  }
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
