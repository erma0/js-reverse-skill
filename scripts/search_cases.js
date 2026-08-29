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
  const result = search(loadIndex(), args);
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
  if (!result.length) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`错误：${error.message}\n`);
  process.exitCode = 2;
}
