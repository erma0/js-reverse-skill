#!/usr/bin/env node
'use strict';

const fs = require('fs');

function parseArgs(argv) {
  const args = { fixture: '', actual: '', field: '', expectedPath: '', actualPath: '', sample: '', json: false, markdown: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--fixture') args.fixture = nextVal('');
    else if (a === '--actual') args.actual = nextVal('');
    else if (a === '--field') args.field = nextVal('');
    else if (a === '--expected-path') args.expectedPath = nextVal('');
    else if (a === '--actual-path') args.actualPath = nextVal('');
    else if (a === '--sample') args.sample = nextVal('');
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
  node scripts/compare_fixture.js --fixture sample.fixture.json --actual node-output.json --field sign --markdown
  node scripts/compare_fixture.js --fixture sample.fixture.json --actual node-output.json --expected-path expected.sign --actual-path output.sign --json
  node scripts/compare_fixture.js --fixture sample.fixture.json --actual node-output.json --field pageSum --sample 3 --markdown
    （翻页/批量类 fixture 用 samples[] 承载多样本：不给 --expected-path 时自动到 samples[].expected.<field> 取期望值，
     --sample 按样本的 page 值选，page 不匹配时按下标取）`;
}

function readJson(p, label) {
  if (!p) throw new Error(`必须提供 ${label}`);
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}

function getPath(obj, p) {
  if (!p) return undefined;
  let cur = obj;
  for (const part of p.split('.').filter(Boolean)) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function firstDefined(values) {
  for (const v of values) if (v !== undefined) return v;
  return undefined;
}

// 多样本 fixture（翻页/批量类案例常用 `samples[]` 承载每组请求-响应对）里取期望值：
// 自动识别时按 `--sample` 选样本（先匹配样本的 page/index 字段，再按数组下标），未指定则取首个含该字段的样本。
function pickFromSamples(fixture, field, sampleSel) {
  if (!field || !Array.isArray(fixture.samples) || fixture.samples.length === 0) return undefined;
  const wanted = sampleSel === '' ? null : String(sampleSel);
  const ordered = wanted === null ? fixture.samples : (() => {
    const byPage = fixture.samples.filter((s) => s && String(s.page) === wanted);
    if (byPage.length) return byPage;
    const idx = Number(wanted);
    if (!Number.isInteger(idx) || idx < 0 || idx >= fixture.samples.length) {
      throw new Error(`--sample ${wanted} 未命中任何样本（samples 共 ${fixture.samples.length} 个，按 page 值或数组下标选）`);
    }
    return [fixture.samples[idx]];
  })();
  for (const sample of ordered) {
    const v = getPath(sample, `expected.${field}`);
    if (v !== undefined) return { value: v, sample: sample && sample.page !== undefined ? `page ${sample.page}` : `index ${fixture.samples.indexOf(sample)}` };
  }
  return undefined;
}

function normalize(v) {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function compare(args) {
  const fixture = readJson(args.fixture, '--fixture');
  const actual = readJson(args.actual, '--actual');
  const field = args.field || fixture.param || '';
  const expectedPath = args.expectedPath || (field ? `expected.${field}` : 'expected');
  const actualPath = args.actualPath || '';
  const expected = firstDefined([getPath(fixture, expectedPath), field ? getPath(fixture, `expected.${field}`) : undefined, fixture.expectedValue]);
  let expectedFrom = '';
  let expectedResolved = expected;
  if (expectedResolved === undefined && !args.expectedPath) {
    const picked = pickFromSamples(fixture, field, args.sample);
    if (picked) {
      expectedResolved = picked.value;
      expectedFrom = `samples[${picked.sample}].expected.${field}`;
    }
  }
  const actualValue = actualPath ? getPath(actual, actualPath) : firstDefined([
    field ? getPath(actual, `output.${field}`) : undefined,
    field ? getPath(actual, field) : undefined,
    getPath(actual, 'output'),
    getPath(actual, 'result'),
  ]);
  const expectedText = normalize(expectedResolved);
  const actualText = normalize(actualValue);
  const pass = expectedResolved !== undefined && actualValue !== undefined && expectedText === actualText;
  return { pass, field, expectedPath: expectedFrom || expectedPath, actualPath: actualPath || '(自动识别)', expected: expectedResolved, actual: actualValue, expectedText, actualText, fixture: args.fixture, actualFile: args.actual };
}

function renderMarkdown(result) {
  const lines = ['# fixtures 对比结果', '', `- 结果：${result.pass ? '通过' : '失败'}`, `- 字段：${result.field || '未指定'}`, `- 期望路径：${result.expectedPath}`, `- 实际路径：${result.actualPath}`, `- 浏览器期望值：${result.expectedText === undefined ? '未找到' : result.expectedText}`, `- Node.js 实际值：${result.actualText === undefined ? '未找到' : result.actualText}`];
  return lines.join('\n') + '\n';
}

try {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); process.exit(0); }
  const result = compare(args);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(renderMarkdown(result));
  if (!result.pass) process.exit(2);
} catch (err) {
  const msg = err.message || String(err);
  // 参数/输入错误（退出码 1）：错误消息写 stdout 便于门禁断言捕获；用法仍走 stderr 不污染
  console.log(`错误：${msg}`);
  console.error(usage());
  process.exit(1);
}
