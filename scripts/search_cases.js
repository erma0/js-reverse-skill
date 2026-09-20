#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.resolve(__dirname, '..', 'cases', 'index.json');
const REQUIRED_FIELDS = ['domains', 'signals', 'strategy', 'file', 'verifiedAt'];

function parseArgs(argv) {
  const args = {
    queries: [],
    domains: [],
    signals: [],
    strategies: [],
    json: false,
    markdown: false,
    includeTemplates: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const nextVal = () => {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) throw new Error(`参数 ${arg} 缺少值`);
      return argv[++i];
    };
    if (arg === '--domain' || arg === '-d') args.domains.push(nextVal());
    else if (arg === '--signal' || arg === '-s') args.signals.push(nextVal());
    else if (arg === '--strategy') args.strategies.push(nextVal());
    else if (arg === '--json') args.json = true;
    else if (arg === '--markdown') args.markdown = true;
    else if (arg === '--include-templates') args.includeTemplates = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('-')) throw new Error(`未知参数：${arg}`);
    else args.queries.push(arg);
  }
  return args;
}

function usage() {
  return `用法：
  node scripts/search_cases.js [关键词 ...]
  node scripts/search_cases.js --domain jd.com
  node scripts/search_cases.js --signal h5st --strategy vm
  node scripts/search_cases.js a_bogus --json

选项：
  -d, --domain <域名>    按域名筛选，可重复
  -s, --signal <信号>    按技术信号筛选，可重复
      --strategy <策略>  按策略文本筛选，可重复
      --json             输出 JSON
      --include-templates 包含方法论骨架模板（kind:template，默认排除）
  -h, --help             显示帮助

说明：匹配不区分大小写，使用子串匹配；多个条件必须同时命中。无条件时列出全部案例。方法论骨架模板（kind:template）默认从结果排除，需用 --include-templates 显式包含。`;
}

function normalize(value) {
  return String(value).toLowerCase();
}

function includes(value, query) {
  return normalize(value).includes(normalize(query));
}

function loadIndex() {
  let index;
  try {
    index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取案例索引 ${INDEX_FILE}：${error.message}`);
  }
  if (index.schemaVersion !== 1 || !Array.isArray(index.cases)) throw new Error('案例索引格式无效');

  const casesDir = path.dirname(INDEX_FILE);
  const caseFiles = new Set(fs.readdirSync(casesDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md' && entry.name !== '_template.md')
    .map((entry) => entry.name));
  const files = new Set();
  for (const [position, item] of index.cases.entries()) {
    const label = `第 ${position + 1} 条记录`;
    for (const field of REQUIRED_FIELDS) {
      if (!(field in item)) throw new Error(`${label} 缺少字段 ${field}`);
    }
    if (!Array.isArray(item.domains) || !Array.isArray(item.signals)) throw new Error(`${label} 的 domains/signals 必须是数组`);
    if (!item.title || !item.strategy || !item.file) throw new Error(`${label} 包含空的 title/strategy/file`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.verifiedAt)) throw new Error(`${label} 的 verifiedAt 格式无效`);
    if (files.has(item.file)) throw new Error(`案例文件重复：${item.file}`);
    files.add(item.file);
  }
  const missingFromIndex = [...caseFiles].filter((file) => !files.has(file));
  const missingFromCases = [...files].filter((file) => !caseFiles.has(file));
  if (missingFromIndex.length || missingFromCases.length) {
    const details = [];
    if (missingFromIndex.length) details.push(`索引缺少：${missingFromIndex.join(', ')}`);
    if (missingFromCases.length) details.push(`案例文件不存在：${missingFromCases.join(', ')}`);
    throw new Error(`案例索引与 cases 目录不一致（${details.join('；')}）`);
  }
  return index.cases;
}

function matchAll(values, queries) {
  return queries.every((query) => values.some((value) => includes(value, query)));
}

function search(cases, args) {
  return cases.filter((item) => {
    if (!args.includeTemplates && item.kind === 'template') return false;
    const searchable = [item.title, ...item.domains, ...item.signals, item.strategy, item.file];
    return matchAll(searchable, args.queries)
      && matchAll(item.domains, args.domains)
      && matchAll(item.signals, args.signals)
      && matchAll([item.strategy], args.strategies);
  });
}

function truncate(value, maxLength) {
  const text = String(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

// 多关键词是 AND 语义（每个词都至少要命中一个字段）：任一词在全库零命中 ⇒ 整体必然零命中。
// 题17 实证：`search_cases.js 字体 font unicode 字形` 返回"未找到匹配案例"，
// 而单词"字体"即命中直系先例——假阴性会让人误判"本地无案例"从而跳过可复用方法论（反模式 41）。
function zeroHitDiagnosis(allCases, args) {
  // 按 flag 限定统计字段：queries 全字段，domains/signals/strategies 只统计各自对应字段，
  // 避免"域名词在 signals 里偶合命中"制造假阴性（题17 实证见上注释）。
  const groups = [
    { terms: args.queries, fields: (item) => [item.title, ...item.domains, ...item.signals, item.strategy, item.file] },
    { terms: args.domains, fields: (item) => item.domains },
    { terms: args.signals, fields: (item) => item.signals },
    { terms: args.strategies, fields: (item) => [item.strategy] },
  ];
  const counts = [];
  for (const g of groups) {
    for (const term of g.terms) {
      counts.push({ term, hit: allCases.filter((item) => matchAll(g.fields(item), [term])).length });
    }
  }
  if (counts.length < 2) return '';
  const dead = counts.filter((c) => c.hit === 0).map((c) => c.term);
  const detail = counts.map((c) => `${c.term}=${c.hit}`).join(' ');
  const lines = ['', `[WARN] 多关键词是 AND 语义（每个词都要至少命中一个字段），逐词单独命中数：${detail}`];
  if (dead.length) {
    lines.push(
      `       「${dead.join('、')}」在全库零命中 ⇒ 组合必然为空：索引字段（title/domains/signals/strategy）` +
        '不含你的措辞 ≠ 站点无同类案例。'
    );
  } else {
    let alive = allCases;
    const steps = [];
    for (const c of counts) {
      const fieldOf = (groups.find((g) => g.terms.includes(c.term)) || groups[0]).fields;
      alive = alive.filter((item) => matchAll(fieldOf(item), [c.term]));
      steps.push(`+${c.term}→${alive.length}`);
    }
    lines.push(
      `       各词单独都有命中，但交集为空（按词序收敛：${steps.join(' ')}）⇒ 组合过严。` +
        '先用最宽的 1–2 个词复检（只留域名或只留算法族关键词）。'
    );
  }
  lines.push('       未做逐词复检就下"本地无案例"结论，会漏掉可复用的同族先例（反模式 41）。');
  return lines.join('\n');
}

function renderTable(cases) {
  if (!cases.length) return '未找到匹配案例。';
  const rows = cases.map((item) => ({
    file: item.file,
    domains: item.domains.length ? item.domains.join(', ') : '*',
    signals: item.signals.join(', '),
    strategy: item.strategy,
    verifiedAt: item.verifiedAt,
  }));
  const widths = {
    file: Math.max(4, ...rows.map((row) => row.file.length)),
    domains: Math.min(38, Math.max(7, ...rows.map((row) => row.domains.length))),
    signals: Math.min(48, Math.max(7, ...rows.map((row) => row.signals.length))),
    verifiedAt: 10,
  };
  const header = `${'FILE'.padEnd(widths.file)}  ${'DOMAINS'.padEnd(widths.domains)}  ${'SIGNALS'.padEnd(widths.signals)}  VERIFIED`;
  const separator = `${'-'.repeat(widths.file)}  ${'-'.repeat(widths.domains)}  ${'-'.repeat(widths.signals)}  ${'-'.repeat(widths.verifiedAt)}`;
  const lines = rows.map((row) => `${row.file.padEnd(widths.file)}  ${truncate(row.domains, widths.domains).padEnd(widths.domains)}  ${truncate(row.signals, widths.signals).padEnd(widths.signals)}  ${row.verifiedAt}`);
  const details = rows.map((row) => `\n${row.file}\n  策略：${row.strategy}`);
  return [`匹配 ${cases.length} 个案例：`, header, separator, ...lines, ...details].join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const allCases = loadIndex();
  const result = search(allCases, args);
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ count: result.length, cases: result }, null, 2)}\n`);
  } else if (args.markdown) {
    const lines = [`匹配 ${result.length} 个案例：`, ''];
    for (const item of result) {
      lines.push(`## ${item.file.replace(/\.md$/, '')}`);
      lines.push('');
      lines.push(`- 域名：${item.domains.join(', ') || '*'}`);
      lines.push(`- 信号：${item.signals.join(', ')}`);
      lines.push(`- 策略：${item.strategy}`);
      lines.push(`- 验证日期：${item.verifiedAt}`);
      lines.push('');
    }
    if (!result.length) lines.push('未找到匹配案例。');
    process.stdout.write(`${lines.join('\n')}\n`);
  } else {
    process.stdout.write(`${renderTable(result)}\n`);
  }
  if (!result.length) {
    const diagnosis = zeroHitDiagnosis(allCases, args);
    if (diagnosis) {
      if (args.json) process.stderr.write(`${diagnosis}\n`); // --json 时 stdout 必须纯净
      else process.stdout.write(`${diagnosis}\n`);
    }
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`错误：${error.message}\n`);
  process.exitCode = 2;
}
