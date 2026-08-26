#!/usr/bin/env node
'use strict';

/**
 * search_js.js — 大文件 JS（含单行 8MB 压缩 bundle）关键词安全检索。
 *
 * 设计动机：TRACE_ANALYZE 定位关键资源时反复踩坑——
 *   1. grep/ripgrep 对单行超 64KB 的压缩 JS 报 "JSON record exceeded 65536 bytes"；
 *   2. PowerShell 下 `node -e "..."` 引号转义翻车（SyntaxError: Invalid string escape）。
 * 本脚本把「关键词/正则定位 + line:col + 有限上下文片段」固化为一条命令。
 *
 * 内存说明：JS bundle 通常是单个文件（≤ 数十 MB），直接读入字符串安全；
 * 与 NDJSON（几十万行）不同，不存在全量 readFileSync 导致 OOM 的风险。
 */

const fs = require('fs');
const { recordQueries, stateHint } = require('./lib/query_log');

function parseArgs(argv) {
  const args = {
    files: [],
    keywords: [],
    regexes: [],
    context: 200,
    max: 50,
    json: false,
    markdown: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--file' || a === '-f') args.files.push(nextVal(''));
    else if (a === '--keyword' || a === '-k') args.keywords.push(nextVal(''));
    else if (a === '--regex' || a === '-r') args.regexes.push(nextVal(''));
    else if (a === '--context' || a === '-c') args.context = Number(nextVal('200')) || 200;
    else if (a === '--max') args.max = Number(nextVal('50')) || 50;
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
  node scripts/search_js.js --file case/js/original/app.4098e81.js --keyword setRequestHeader --markdown
  node scripts/search_js.js --file <js> --regex "acw_sc__v2|team_info" --context 300 --json
  node scripts/search_js.js --file <a.js> --file <b.js> --keyword sign --max 20 --markdown

说明：
  --file <path>    JS 文件路径，可多次
  --keyword <kw>   子串检索（不区分大小写），可多次
  --regex <pat>    正则检索（忽略大小写），可多次
  --context <n>    每条命中前后各打印 n 个字符片段（默认 200，压缩 JS 单行下按字符算）
  --max <n>        最多打印 n 条命中（默认 50）
  至少提供 --file 与 --keyword/--regex 之一；输出 line:col + 上下文片段。`;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineColOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, col: offset - starts[lo] + 1 };
}

function clip(text, start, end, ctx) {
  const from = Math.max(0, start);
  const to = Math.min(text.length, end);
  let s = text.slice(from, to);
  if (from > 0) s = `…${s}`;
  if (to < text.length) s = `${s}…`;
  return s;
}

function collectMatches(text, args) {
  const parts = [];
  for (const k of args.keywords) if (k) parts.push(escapeRegex(k));
  for (const r of args.regexes) if (r) parts.push(r);
  if (!parts.length) return [];
  let re;
  try { re = new RegExp(parts.join('|'), 'gi'); } catch (err) { throw new Error(`正则无效：${err.message}`); }
  const out = [];
  for (const m of text.matchAll(re)) {
    out.push({ offset: m.index, length: m[0].length, text: m[0] });
    if (out.length >= args.max) break;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.files.length) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }
  if (!args.keywords.length && !args.regexes.length) {
    console.error('错误：至少提供 --keyword / --regex 之一');
    console.error(usage());
    process.exit(1);
  }

  const ctx = Math.max(0, Math.min(args.context, 2000));
  const warnings = [
    ...stateHint(args.files[0]),
    ...recordQueries('search_js', args.files.flatMap((f) => args.keywords.concat(args.regexes).map((q) => ({ target: f, query: q })))),
  ];
  const results = [];
  for (const file of args.files) {
    if (!fs.existsSync(file)) {
      console.error(`文件不存在：${file}`);
      continue;
    }
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const starts = buildLineStarts(text);
    const matches = collectMatches(text, args);
    const items = matches.map((m) => {
      const { line, col } = lineColOf(starts, m.offset);
      return {
        file,
        line,
        col,
        offset: m.offset,
        matched: m.text,
        snippet: clip(text, m.offset - ctx, m.offset + m.length + ctx, ctx),
      };
    });
    results.push({ file, size: Buffer.byteLength(text, 'utf8'), matches: items });
  }

  const total = results.reduce((n, r) => n + r.matches.length, 0);
  if (args.json) {
    console.log(JSON.stringify({ total, warnings, results }, null, 2));
    return;
  }

  const lines = ['# JS 文件检索结果', '', `- 命中：${total} 条`];
  for (const w of warnings) lines.push('', w);
  for (const r of results) {
    lines.push('', `## ${r.file}（${r.size} B）`);
    if (!r.matches.length) { lines.push('- 无命中'); continue; }
    for (const m of r.matches) {
      lines.push(`- \`${m.line}:${m.col}\` 匹配 \`${m.matched}\``);
      lines.push('', '```text', m.snippet, '```', '');
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

try { main(); } catch (err) {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
}
