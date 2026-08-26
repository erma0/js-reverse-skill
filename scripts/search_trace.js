#!/usr/bin/env node
'use strict';

/**
 * search_trace.js — 按关键词 / 接口 / URL / 正则检索 RuyiTrace NDJSON 并输出行号 + 上下文。
 *
 * 设计动机：TRACE_ANALYZE 阶段反复出现"命令行 python -c 引号嵌套 grep NDJSON"翻车
 * （SyntaxError / AttributeError），本脚本把检索固化为一条命令，带行号、命名字段和上下文。
 */

const fs = require('fs');
const readline = require('readline');
const { recordQueries, stateHint } = require('./lib/query_log');

function parseArgs(argv) {
  const args = {
    traces: [],
    keywords: [],
    regexes: [],
    url: '',
    context: 0,
    max: 200,
    json: false,
    markdown: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--trace' || a === '-t') args.traces.push(nextVal(''));
    else if (a === '--keyword' || a === '-k') args.keywords.push(nextVal(''));
    else if (a === '--regex' || a === '-r') args.regexes.push(nextVal(''));
    else if (a === '--url' || a === '-u') args.url = nextVal('');
    else if (a === '--context' || a === '-c') args.context = Number(nextVal('0')) || 0;
    else if (a === '--max') args.max = Number(nextVal('200')) || 200;
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
  node scripts/search_trace.js --trace case/ruyi-trace/logs/trace.ndjson --keyword handshake --context 3 --markdown
  node scripts/search_trace.js --trace case/ruyi-trace/logs/trace.ndjson --url /api/verify --markdown
  node scripts/search_trace.js --trace <f1.ndjson> --trace <f2.ndjson> --keyword sign --regex "stack\\\\.file.*solar" --max 50 --json

说明：
  --keyword <kw>  子串检索（不区分大小写），可多次
  --regex <pat>   正则检索（忽略大小写），可多次
  --url <substr>  只命中 URL/文件字段（url/api/requestUrl/stack.file 等），不与 keyword/regex 混用
  --context <n>   每条命中前后各打印 n 行原始记录（默认 0）
  --max <n>       最多打印 n 条命中（默认 200）
  至少提供 --keyword / --regex / --url 之一；多个 --trace 合并检索。`;
}

function urlishFields(record) {
  const out = [];
  const pushUrl = (s) => {
    if (typeof s === 'string' && s.trim()) out.push(s);
  };
  const walk = (value, key) => {
    if (value == null) return;
    if (typeof value === 'string') {
      // RuyiTrace 的脚本 URL 大量出现在 stack 帧的 `file` 字段，以及 eval/descriptor
      // 日志的 `source`/`file` 字段，统一按「URL / 文件字段」收集。
      if (/^(url|api|requestUrl|request_url|href|scriptUrl|script_url|sourceUrl|source|file)$/i.test(key || '')) {
        pushUrl(value);
      }
      return;
    }
    if (Array.isArray(value)) {
      // stack 是帧数组 [{func,file,line,col},...]，逐帧递归而不是把数组当单对象处理。
      for (const item of value) walk(item, key);
      return;
    }
    if (typeof value === 'object') {
      for (const k of Object.keys(value)) walk(value[k], k);
    }
  };
  for (const k of Object.keys(record)) walk(record[k], k);
  return out;
}

function topLevelHitFields(record, predicate) {
  const hits = [];
  for (const key of Object.keys(record)) {
    let text = '';
    const v = record[key];
    try { text = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { text = String(v); }
    if (predicate(text)) hits.push(key);
  }
  return hits;
}

function matchRecord(record, args) {
  let haystack = '';
  try { haystack = JSON.stringify(record); } catch (e) { haystack = String(record); }
  const low = haystack.toLowerCase();
  const hasAny = args.keywords.length || args.regexes.length || args.url;
  if (!hasAny) return { matched: false, fields: [] };

  if (args.url) {
    const urls = urlishFields(record);
    const hit = urls.some((u) => u.toLowerCase().includes(args.url.toLowerCase()));
    return { matched: hit, fields: hit ? ['url'] : [] };
  }

  let matched = false;
  const predicate = (text) => {
    const tl = text.toLowerCase();
    if (args.keywords.some((k) => tl.includes(k.toLowerCase()))) return true;
    return args.regexes.some((r) => { try { return new RegExp(r, 'i').test(text); } catch (e) { return false; } });
  };
  matched = predicate(haystack);
  const fields = matched ? topLevelHitFields(record, predicate) : [];
  return { matched, fields };
}

async function searchFile(file, args, ctx, matches) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  const before = []; // 最近 ctx 行 {no,text}，供命中行取 before-context
  let active = null; // 正在收 after-context 的命中
  let afterRemain = 0;

  const finalize = () => {
    if (active) { matches.push(active); active = null; }
  };

  for await (const raw of rl) {
    lineNo += 1;
    const text = raw.replace(/^\uFEFF/, '').trim();

    if (active) {
      active.after.push({ no: lineNo, text });
      afterRemain -= 1;
      if (afterRemain <= 0) finalize();
    }

    if (text) {
      let record = null;
      try { record = JSON.parse(text); } catch { record = null; }
      if (record && typeof record === 'object' && !Array.isArray(record)) {
        const res = matchRecord(record, args);
        if (res.matched) {
          finalize(); // 关掉上一个未收完 after 的命中，避免被覆盖丢失
          if (ctx > 0) {
            active = { file, lineNo, fields: res.fields, text, before: before.slice(-ctx), after: [] };
            afterRemain = ctx;
          } else {
            matches.push({ file, lineNo, fields: res.fields, raw: text });
          }
          if (matches.length >= args.max) return true;
        }
      }
    }

    before.push({ no: lineNo, text });
    if (before.length > ctx) before.shift();
  }
  finalize();
  return matches.length >= args.max;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.traces.length) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }
  if (!args.keywords.length && !args.regexes.length && !args.url) {
    console.error('错误：至少提供 --keyword / --regex / --url 之一');
    console.error(usage());
    process.exit(1);
  }

  const files = args.traces.filter((f) => {
    if (!fs.existsSync(f)) {
      console.error(`trace 文件不存在：${f}`);
      return false;
    }
    return true;
  });
  if (!files.length) process.exit(1);

  const queries = args.keywords.concat(args.regexes).map((q) => ({ target: files[0], query: q }));
  if (args.url) queries.push({ target: files[0], query: `url:${args.url}` });
  const warnings = [...stateHint(files[0]), ...recordQueries('search_trace', queries)];

  const matches = [];
  const ctx = args.json ? 0 : Math.max(0, Math.min(args.context, 20));
  for (const file of files) {
    const reached = await searchFile(file, args, ctx, matches);
    if (reached) break;
  }

  if (args.json) {
    console.log(JSON.stringify({ total: matches.length, warnings, matches: matches.map((m) => ({ file: m.file, lineNo: m.lineNo, fields: m.fields })) }, null, 2));
    return;
  }

  const lines = ['# trace 检索结果', '', `- 命中：${matches.length} 条`];
  for (const w of warnings) lines.push('', w);
  if (matches.length >= args.max) lines.push(`- （达到 --max ${args.max} 上限，可调大）`);
  lines.push('');
  const emit = (tag, no, text) => {
    let t = text;
    if (t.length > 300) t = `${t.slice(0, 300)}…`;
    lines.push(`  ${tag} ${no}: ${t}`);
  };
  matches.forEach((m, idx) => {
    lines.push(`## ${idx + 1}. ${m.file}:${m.lineNo}${m.fields.length ? `（字段：${m.fields.slice(0, 5).join('、')}）` : ''}`);
    if (ctx > 0) {
      for (const b of m.before) emit(' ', b.no, b.text);
      emit('>', m.lineNo, m.text || '');
      for (const a of m.after) emit(' ', a.no, a.text);
    } else {
      emit('>', m.lineNo, m.raw || '');
    }
    lines.push('');
  });
  process.stdout.write(`${lines.join('\n')}\n`);
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  console.error(usage());
  process.exit(1);
});
