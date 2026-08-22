#!/usr/bin/env node
'use strict';

// Cookie 归因融合分析：capture.json 的 Set-Cookie（服务端下发）× RuyiTrace NDJSON 的
// document.cookie / CookieStore 写入（JS 生成）→ 逐 Cookie 判定生成方与定位依据。
// 解决"这个 Cookie 是谁写的"：挑战 Cookie（JS 写入，如 412 challenge）需要还原算法；
// 服务端下发 Cookie 只需复现请求链，不得硬编码（对应 SKILL.md 纯协议红线的关键 Cookie 四分类）。

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { resolveCaseDir } = require('./lib/paths');

function parseArgs(argv) {
  const args = { caseDir: '.', capture: '', inputs: [], cookies: [], json: false, markdown: false, help: false, selfTest: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = nextVal('.');
    else if (a === '--capture') args.capture = nextVal('');
    else if (a === '--input' || a === '--inputs' || a === '-i') args.inputs.push(nextVal(''));
    else if (a === '--cookie' || a === '-c') args.cookies.push(nextVal(''));
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--self-test') args.selfTest = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  args.cookies = args.cookies.map((c) => String(c).trim()).filter(Boolean);
  return args;
}

function usage() {
  return `用法：
  node scripts/analyze_cookie_attribution.js --case-dir <project-root> --markdown
  node scripts/analyze_cookie_attribution.js --case-dir <project-root> --cookie <名称> --markdown
  node scripts/analyze_cookie_attribution.js --case-dir <project-root> --capture <capture.json> --input <trace.ndjson> --markdown
  node scripts/analyze_cookie_attribution.js --self-test

说明：
- 融合 Step 1（case/forensic/capture.json 中响应头 Set-Cookie）与 Step 2（case/ruyi-trace/logs/*.ndjson 中
  document.cookie / CookieStore 写入记录，含 stack.file:line:col），输出每个 Cookie 的生成方归因。
- 归因结论：
  - server（仅服务端 Set-Cookie）：会话/服务端下发值，复现请求链获取，禁止硬编码成功样本值。
  - js（仅 trace 观测到 JS 写入）：挑战/签名 Cookie，按写入点 stack 进入 TRACE_ANALYZE 还原算法。
  - both：通常是"先 JS 挑战后业务下发"的串联链，按时间顺序拆分。
  - unknown（指定了 --cookie 但两源均未见）：可能 iframe/Worker 写入（trace 未覆盖）或取证窗口外，需补采。
- 数据源缺失不算失败：只有 capture 和 NDJSON 同时缺失时退出 1。`;
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

// ---- 服务端侧：capture.json Set-Cookie ----
function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return [];
  const values = [];
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() !== name.toLowerCase()) continue;
    if (Array.isArray(v)) values.push(...v.map(String));
    else if (v != null) values.push(...String(v).split(/\r?\n/));
  }
  return values.filter(Boolean);
}

function parseSetCookieValue(value) {
  // "name=value; Path=/; HttpOnly" → { name, valuePreview, attrs }
  const parts = String(value).split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length || !parts[0].includes('=')) return null;
  const eq = parts[0].indexOf('=');
  const name = parts[0].slice(0, eq).trim();
  const rawValue = parts[0].slice(eq + 1).trim();
  if (!name) return null;
  const attrs = parts.slice(1).map((p) => (p.includes('=') ? p.split('=')[0].trim() : p));
  return {
    name,
    valuePreview: rawValue.length > 48 ? `${rawValue.slice(0, 24)}...${rawValue.slice(-12)}（len=${rawValue.length}）` : rawValue,
    attrs,
  };
}

function collectServerCookies(capturePath) {
  const found = new Map(); // name -> { count, requests: [{index,url,status,attrs,valuePreview}] }
  if (!exists(capturePath)) return { found, recordCount: 0, parseError: '' };
  let records;
  try { records = JSON.parse(fs.readFileSync(capturePath, 'utf8').replace(/^\uFEFF/, '')); } catch (err) {
    return { found, recordCount: 0, parseError: err.message };
  }
  if (!Array.isArray(records)) return { found, recordCount: 0, parseError: 'capture.json 不是记录数组' };
  records.forEach((rec, index) => {
    for (const raw of headerValue(rec.response_headers, 'set-cookie')) {
      const parsed = parseSetCookieValue(raw);
      if (!parsed) continue;
      if (!found.has(parsed.name)) found.set(parsed.name, { count: 0, requests: [] });
      const item = found.get(parsed.name);
      item.count += 1;
      item.requests.push({ index, url: rec.url || '', status: rec.response_status != null ? rec.response_status : '', attrs: parsed.attrs, valuePreview: parsed.valuePreview });
    }
  });
  return { found, recordCount: records.length, parseError: '' };
}

// ---- JS 侧：NDJSON cookie 写入 ----
function eventApi(evt) {
  return String(evt.api || evt.name || evt.path || evt.interface || (evt.member ? `${evt.interface || ''}.${evt.member}` : '') || '');
}

function isCookieWriteApi(api) {
  return /cookie/i.test(api) && /set|write|assign|append|put|create|document\.cookie|^cookie$/i.test(api.replace(/^on/i, ''));
}

function stackBrief(evt) {
  const stack = Array.isArray(evt && evt.stack) ? evt.stack : [];
  const frames = stack
    .filter((s) => s && (s.file || s.line || s.col))
    .slice(0, 3)
    .map((s) => [s.file || '', s.line || '', s.col || ''].filter((v) => v !== '').join(':'));
  return frames.join(' <- ');
}

// 从事件对象里提取 cookie 名/值：支持 "name=value; attrs" 字符串与 {name,value}/{key,value} 对象两种形态
// （只在 cookie 相关 API 事件上执行，控制误报）
function extractCookieNames(evt) {
  const names = new Map(); // name -> sample value preview
  const visit = (value) => {
    if (typeof value === 'string') {
      if (!value.includes('=')) return;
      for (const part of value.split(';')) {
        const seg = part.trim();
        const eq = seg.indexOf('=');
        if (eq <= 0) continue;
        const name = seg.slice(0, eq).trim();
        const val = seg.slice(eq + 1).trim();
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) continue;
        if (/^(?:path|domain|expires|max-age|samesite|secure|httponly)$/i.test(name)) continue;
        names.set(name, val.length > 48 ? `${val.slice(0, 24)}...（len=${val.length}）` : val);
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    // CookieStore.set({name, value}) / {key, value} 对象形态
    const objName = typeof value.name === 'string' ? value.name : (typeof value.key === 'string' ? value.key : '');
    const objValue = value.value != null ? String(value.value) : '';
    if (objName && /^[A-Za-z0-9_.-]{1,64}$/.test(objName) && objValue) {
      names.set(objName, objValue.length > 48 ? `${objValue.slice(0, 24)}...（len=${objValue.length}）` : objValue);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(evt.args != null ? evt.args : evt);
  return names;
}

async function collectJsCookies(ndjsonFiles) {
  const found = new Map(); // name -> { count, writes: [{file,line,api,ts,valuePreview}] }
  let cookieApiEvents = 0;
  let totalEvents = 0;
  for (const file of ndjsonFiles) {
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const raw of rl) {
      const line = raw.replace(/^\uFEFF/, '').trim();
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      totalEvents += 1;
      const api = eventApi(evt);
      // 兼容两代字段：api/interface+member；cookie 写入事件须带 cookie 关键词
      if (!/cookie/i.test(api) && !/cookie/i.test(String(evt.interface || '') + '.' + String(evt.member || ''))) continue;
      cookieApiEvents += 1;
      const stack = stackBrief(evt);
      const ts = evt.ts || evt.time || evt.timestamp || '';
      const names = extractCookieNames(evt);
      const frame = (Array.isArray(evt.stack) ? evt.stack[0] : null) || {};
      if (!names.size) {
        const key = '(名称未能解析)';
        if (!found.has(key)) found.set(key, { count: 0, writes: [] });
        const item = found.get(key);
        item.count += 1;
        if (item.writes.length < 5) item.writes.push({ api, file: frame.file || '', line: frame.line || '', stack, ts, valuePreview: '' });
        continue;
      }
      for (const [name, preview] of names) {
        if (!found.has(name)) found.set(name, { count: 0, writes: [] });
        const item = found.get(name);
        item.count += 1;
        if (item.writes.length < 5) {
          item.writes.push({ api, file: frame.file || '', line: frame.line || '', stack, ts, valuePreview: preview });
        }
      }
    }
  }
  return { found, cookieApiEvents, totalEvents };
}

function attribute(server, js) {
  const names = new Set([...server.found.keys(), ...js.found.keys()]);
  const rows = [];
  for (const name of names) {
    const s = server.found.get(name);
    const j = js.found.get(name);
    const source = s && j ? 'both' : s ? 'server' : 'js';
    let verdict;
    let next;
    if (source === 'server') {
      verdict = '服务端下发';
      next = '复现请求链获取（见 references/network/session-chain.md）；禁止把成功样本值硬编码进交付。';
    } else if (source === 'js') {
      verdict = 'JS 写入（挑战/签名 Cookie）';
      next = '按写入点 stack.file:line 进入 TRACE_ANALYZE 还原算法（见 references/network/cookie-generation.md）；入口 HTML 内联脚本是 412/challenge 常见来源。';
    } else {
      verdict = '双源（先 JS 挑战后业务下发的串联链）';
      next = '按请求顺序拆分：JS 写入在前的通常是挑战 Cookie，服务端下发的是会话值；分别按上述两条路径处理。';
    }
    rows.push({ name, source, verdict, next, server: s || null, js: j || null });
  }
  return rows;
}

function renderMarkdown(result, filterNames) {
  const lines = ['# Cookie 归因分析', ''];
  lines.push(`- capture 记录数：${result.server.recordCount}${result.server.parseError ? `（解析失败：${result.server.parseError}）` : ''}`);
  lines.push(`- 服务端 Set-Cookie 种类：${result.server.found.size}`);
  lines.push(`- trace cookie 写入事件：${result.js.cookieApiEvents} / 总事件 ${result.js.totalEvents}（NDJSON 文件 ${result.ndjsonFiles.length} 个）`);
  lines.push(`- JS 写入 Cookie 种类：${[...result.js.found.keys()].filter((k) => k !== '(名称未能解析)').length}`);
  if (filterNames.length) lines.push(`- 过滤：${filterNames.join('、')}`);
  lines.push('', '## 归因结论', '');
  const rows = filterNames.length ? result.rows.filter((r) => filterNames.some((n) => r.name.toLowerCase().includes(n.toLowerCase()))) : result.rows;
  if (!rows.length) {
    lines.push(filterNames.length
      ? `- 未在两源证据中观测到「${filterNames.join('、')}」：可能由 iframe/Worker 写入（trace 未覆盖）、或取证窗口外生成。建议按 references/workflow/trace-flow.md 补采，或扩大取证窗口覆盖 Cookie 首次出现的请求。`
      : '- 两源均未观测到 Cookie。');
    return lines.join('\n') + '\n';
  }
  lines.push('| Cookie | 生成方 | 判定 | 下一步 |');
  lines.push('|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.name} | ${r.source} | ${r.verdict} | ${r.next} |`);
  }
  lines.push('', '## 证据明细', '');
  for (const r of rows) {
    lines.push(`### ${r.name}`);
    if (r.server) {
      lines.push(`- 服务端下发：${r.server.count} 次`);
      for (const q of r.server.requests.slice(0, 3)) {
        lines.push(`  - #${q.index} ${q.method || ''} ${q.url}（status ${q.status}）set-cookie: ${r.name}=${q.valuePreview}；attrs: ${q.attrs.join(', ') || '无'}`);
      }
      if (r.server.count > 3) lines.push(`  - …共 ${r.server.count} 次`);
    } else {
      lines.push('- 服务端下发：capture.json 中未见 Set-Cookie');
    }
    if (r.js) {
      lines.push(`- JS 写入：trace 观测 ${r.js.count} 次`);
      for (const w of r.js.writes) {
        lines.push(`  - ${w.api || '(api 未记录)'} @ ${w.file ? `${w.file}:${w.line}` : w.stack || 'stack 未记录'}${w.ts ? ` ts=${w.ts}` : ''}${w.valuePreview ? ` = ${w.valuePreview}` : ''}`);
      }
      if (r.js.count > r.js.writes.length) lines.push(`  - …共 ${r.js.count} 次`);
    } else {
      lines.push('- JS 写入：trace 中未见 document.cookie / CookieStore 写入');
    }
  }
  lines.push('', '## 使用边界',
    '- 归因基于本次取证数据：capture 窗口或 trace 覆盖不全时结论会偏（unknown/缺失不代表不存在）。',
    '- Cookie 值预览可能被 RuyiTrace 截断（长值只代表最小长度），关键值以落盘证据为准。',
    '- 本脚本不修改任何证据文件，只读分析。');
  return lines.join('\n') + '\n';
}

async function analyze(args) {
  const caseDir = resolveCaseDir(args.caseDir);
  const capturePath = args.capture ? path.resolve(args.capture) : path.join(caseDir, 'forensic', 'capture.json');
  const ndjsonFiles = args.inputs.map((p) => path.resolve(p)).filter(exists);
  if (!ndjsonFiles.length) {
    const logDir = path.join(caseDir, 'ruyi-trace', 'logs');
    if (exists(logDir)) {
      for (const name of fs.readdirSync(logDir).sort()) {
        if (/\.ndjson$/i.test(name)) ndjsonFiles.push(path.join(logDir, name));
      }
    }
  }
  const server = collectServerCookies(capturePath);
  const js = await collectJsCookies(ndjsonFiles);
  const rows = attribute(server, js);
  return {
    caseDir,
    capturePath,
    ndjsonFiles,
    server,
    js,
    rows,
    hasAnySource: server.recordCount > 0 || server.found.size > 0 || js.totalEvents > 0,
  };
}

async function runSelfTest() {
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cookie-attr-'));
  try {
    const caseSub = path.join(root, 'case');
    fs.mkdirSync(path.join(caseSub, 'forensic'), { recursive: true });
    fs.writeFileSync(path.join(caseSub, 'forensic', 'capture.json'), JSON.stringify([
      { url: 'https://www.example.com/', method: 'GET', response_status: 200, response_headers: { 'content-type': 'text/html', 'set-cookie': 'SERVERSESS=abc123; Path=/; HttpOnly' } },
      { url: 'https://api.example.com/data', method: 'POST', response_status: 200, response_headers: { 'set-cookie': 'SERVERSESS=def456; Path=/; HttpOnly' } },
    ]), 'utf8');
    const logDir = path.join(caseSub, 'ruyi-trace', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, 'trace.ndjson'), [
      JSON.stringify({ api: 'document.cookie(set)', t: 'set', ts: 1, args: ['acw_sc__v2=xyz789; path=/; max-age=3600'], stack: [{ file: 'https://www.example.com/', line: 12, col: 3 }] }),
      JSON.stringify({ api: 'fetch', t: 'call', args: [], stack: [{ file: 'https://www.example.com/app.js', line: 99, col: 1 }] }),
      JSON.stringify({ interface: 'CookieStore', member: 'set', t: 'call', args: [{ name: 'js_only_ck', value: 'v1' }], stack: [{ file: 'https://static.example.com/sdk.js', line: 5, col: 10 }] }),
    ].join('\n') + '\n', 'utf8');

    const result = await analyze({ caseDir: root, capture: '', inputs: [], cookies: [] });
    const byName = new Map(result.rows.map((r) => [r.name, r]));
    if (byName.get('SERVERSESS').source !== 'server') throw new Error('SERVERSESS 应为 server');
    if (byName.get('acw_sc__v2').source !== 'js') throw new Error('acw_sc__v2 应为 js');
    if (byName.get('js_only_ck').source !== 'js') throw new Error('js_only_ck 应为 js');
    const jsRow = byName.get('acw_sc__v2');
    if (!jsRow.js.writes[0].file.includes('example.com')) throw new Error('js 写入应带 stack.file');
    const md = renderMarkdown(result, []);
    if (!/acw_sc__v2 \| js/.test(md)) throw new Error('markdown 应含归因表');
    if (!/SERVERSESS=abc123/.test(md)) throw new Error('markdown 应含服务端值预览');

    const filtered = renderMarkdown(result, ['not_exist_ck']);
    if (!/未在两源证据中观测到/.test(filtered)) throw new Error('未知 cookie 过滤应给出补采提示');
    return { clean: true, tests: 6 };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  (async () => {
    try {
      const args = parseArgs(process.argv);
      if (args.help) { console.log(usage()); process.exit(0); }
      if (args.selfTest) {
        const r = await runSelfTest();
        console.log(`analyze_cookie_attribution.js 自测通过：${r.tests} 项断言`);
        process.exit(0);
      }
      const result = await analyze(args);
      if (!result.hasAnySource) {
        console.error(`两源均缺失：capture（${result.capturePath}）无有效记录且无 NDJSON。先完成 Step 1 取证或提供 --input。`);
        process.exit(1);
      }
      if (args.json) console.log(JSON.stringify({ caseDir: result.caseDir, rows: result.rows }, null, 2));
      if (args.markdown) process.stdout.write(renderMarkdown(result, args.cookies));
      process.exit(0);
    } catch (err) {
      console.error(err.stack || err.message || String(err));
      console.error(usage());
      process.exit(1);
    }
  })();
}

module.exports = { collectServerCookies, collectJsCookies, attribute, parseSetCookieValue, runSelfTest };
