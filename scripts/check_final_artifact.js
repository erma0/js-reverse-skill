#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('./lib/paths');

function parseArgs(argv) {
  const args = {
    caseDir: '.',
    file: null,
    requireFinalSummary: true,
    finalSummaryOptOut: false,
    requireExperience: true,
    experienceOptOut: false,
    production: false,
    selfTest: false,
    json: false,
    markdown: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = nextVal(undefined);
    else if (a === '--file' || a === '-f') args.file = nextVal(undefined);
    else if (a === '--no-require-final-summary' || a === '--allow-no-final-summary') {
      args.requireFinalSummary = false;
      args.finalSummaryOptOut = true;
    }
    else if (a === '--no-require-experience' || a === '--allow-no-experience') {
      args.requireExperience = false;
      args.experienceOptOut = true;
    }
    else if (a === '--production' || a === '--prod') args.production = true;
    else if (a === '--self-test') args.selfTest = true;
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
  node scripts/check_final_artifact.js --case-dir . --markdown
  node scripts/check_final_artifact.js --case-dir . --production --markdown
  node scripts/check_final_artifact.js --case-dir . --no-require-final-summary --markdown
  node scripts/check_final_artifact.js --case-dir . --no-require-experience --markdown
  node scripts/check_final_artifact.js --case-dir . --file result/final.js --json
  node scripts/check_final_artifact.js --self-test

说明：--case-dir 指项目根目录（其下应有 case/ 和 result/ 两个平级子目录），默认可省略用当前目录。
默认模式（解题必需）：检查 result 目录结构 / 唯一执行入口 / 联网模式的可复用 Session 与关闭清理 / 按证据声明检查 TLS 指纹兼容客户端 / 无浏览器自动化代码 / 无硬编码或复用样本加密参数值 / 联网模式 result/验证记录.json 至少 5 条全部有效 / sign-only 明确豁免 / result/最终项目总结.md 存在且包含默认 8 章 / result/经验沉淀-<站点>.md 存在 / result 无临时产物。
机器标记：在 result/ 或 case/ 的 Markdown / JSON / YAML / TXT 中声明 FINAL_ARTIFACT_NETWORK_MODE=online|sign-only 和 FINAL_ARTIFACT_TLS_FINGERPRINT=required|not-required。旧文档自然语言声明仍兼容；“目标无 TLS”只表示不强制 TLS 兼容客户端，不能豁免联网 Session 与清理。
--production（生产级交付）：在默认检查基础上，追加校验最终总结的 9 个生产级附加章节（NativeProtect / 指纹基线 / API 调用回放 / 高强度检测矩阵 / Session 请求链 / 加密参数生成与样本复用检查 / 代码质量与中文注释 / 清理结果 / 阶段报告索引）。
--no-require-final-summary：仅当用户明确要求不生成最终总结时传入，并在阶段输出中记录豁免原因。
--no-require-experience：仅当用户明确要求不沉淀经验时传入，并在阶段输出中记录豁免原因。`;
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function stat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

// 去除 JS 注释（// 与 /* */），保留字符串 / 模板字面量内的 // 和 /*。
// 供 AUTOMATION_PATTERNS 等工具名检测使用，避免注释里的说明文字（如"本算法由 RuyiTrace 实证"）
// 被误判为引用了取证 / 自动化工具。
function stripComments(source) {
  const SQ = 39, DQ = 34, BT = 96, BS = 92, SL = 47, NL = 10, ST = 42;
  let out = '';
  let i = 0;
  const n = source.length;
  let state = 0; // 0=code 1=line 2=block 3=sq 4=dq 5=tpl
  while (i < n) {
    const c = source.charCodeAt(i);
    const c2 = source.charCodeAt(i + 1);
    if (state === 0) {
      if (c === SL && c2 === SL) { state = 1; out += '  '; i += 2; continue; }
      if (c === SL && c2 === ST) { state = 2; out += '  '; i += 2; continue; }
      if (c === SQ) { state = 3; out += "'"; i += 1; continue; }
      if (c === DQ) { state = 4; out += '"'; i += 1; continue; }
      if (c === BT) { state = 5; out += '`'; i += 1; continue; }
      out += source[i]; i += 1; continue;
    }
    if (state === 1) {
      if (c === NL) { state = 0; out += source[i]; } else { out += ' '; }
      i += 1; continue;
    }
    if (state === 2) {
      if (c === ST && c2 === SL) { state = 0; out += '  '; i += 2; continue; }
      out += c === NL ? source[i] : ' '; i += 1; continue;
    }
    out += source[i];
    if (c === BS) { out += source[i + 1] || ''; i += 2; continue; }
    if ((state === 3 && c === SQ) || (state === 4 && c === DQ) || (state === 5 && c === BT)) state = 0;
    i += 1; continue;
  }
  return out;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walk(p, out = []) {
  if (!exists(p)) return out;
  const st = stat(p);
  if (!st) return out;
  if (st.isDirectory()) {
    let names = [];
    try { names = fs.readdirSync(p); } catch { names = []; }
    for (const name of names) walk(path.join(p, name), out);
  }
  out.push(p);
  return out;
}

function rel(root, p) {
  return (path.relative(root, p) || '.').replace(/\\/g, '/');
}

function ext(p) {
  return path.extname(p).toLowerCase();
}

const AUTOMATION_PATTERNS = [
  /\bruyipage\b/i,
  /\bFirefoxPage\b/,
  /\bRuyiTrace\b/i,
  /\bplaywright\b/i,
  /\bpuppeteer\b/i,
  /\bpyppeteer\b/i,
  /\bselenium\b/i,
  /\bwebdriver\.(?:Builder|Chrome|Firefox|Safari|Edge|Remote|Capabilities|Options)\b/i,
  /\bnew\s+webdriver\b/i,
  /\brequire\s*\(\s*['"]webdriver['"]\s*\)/i,
  /\bfrom\s+['"]webdriver['"]/i,
  /\bimport\s+webdriver\b/i,
  /\bwebdriverio\b/i,
  /\bbrowser\.new_page\b/i,
  /\bbrowser\.newPage\b/i,
  /\blaunch_browser\s*\(/i,
  /\bnetwork_capture\s*\(/i,
  /\bbrowser-use\b/i,
  /\bchromium\.launch\b/i,
  /\bfirefox\.launch\b/i,
  /\bbrowser\.launch\b/i,
  /\bpage\.goto\s*\(/i,
  /\bpage\.capture\b/i,
  /\bCDP\b/,
  /\bMarionette\b/i,
];

const JS_REQUEST_PATTERNS = [
  /\bcycleTLS\s*\(/i,
  /\bCycleTLS\b/,
  /\bcycletls\b/i,
  /\bimpers\b/i,
  /\bimpersFetch\b/i,
  /\bcurl-cffi\b/i,
  /\bcurl-cffi-node\b/i,
  /require\s*\(\s*['"]curl-cffi['"]\s*\)/,
  /from\s+['"]curl-cffi['"]/,
  /\bCurlSession\b/,
  /\bCurlRequest\b/,
  /\breq\.request\s*\(/,
];

const PY_REQUEST_PATTERNS = [
  /\bcurl_cffi\b/,
  /\bcffi_curl\b/,
  /\bcyCronet\b/i,
  /\bcycronet\b/i,
];

const NETWORK_MODE_MARKER_RE = /FINAL_ARTIFACT_NETWORK_MODE["']?\s*[=:]\s*["']?(online|sign-only)/ig;
const TLS_FINGERPRINT_MARKER_RE = /FINAL_ARTIFACT_TLS_FINGERPRINT["']?\s*[=:]\s*["']?(required|not-required)/ig;

const REQUEST_PATTERNS = [
  ...JS_REQUEST_PATTERNS,
  /\bfetch\s*\(/i,
  /\bhttps\.request\s*\(/i,
  /\baxios\.(?:get|post|request)\s*\(/i,
  /\bsession\.(?:get|post|request)\s*\(/i,
];

const SESSION_CREATE_PATTERNS = [
  /\bcreateRequestSession\s*\(/i,
  /\bcreate_request_session\s*\(/i,
  /\b(?:requests\.)?Session\s*\(/,
  /\bnew\s+Session\s*\(/i,
  /\bnew\s+https?\.Agent\s*\(/i,
  /\bnew\s+Agent\s*\([^)]*keepAlive/i,
  // HTTP/2 客户端：http2.connect 建立的就是可复用会话，与 https.Agent / requests.Session 同语义
  // （match17 实测：Node 原生 http2 交付因该模式缺失被判「未检测到 Session 创建」，只能靠显式封装绕开）
  /\bhttp2\.connect\s*\(/i,
];

const SESSION_REUSE_PATTERNS = [
  /\bsession\.(?:get|post|request)\s*\(/i,
  /\b(?:session|client)\.(?:request|get|post|put|delete)\s*\(/i,
  /\bwith\s+session\b/i,
  /\bsession\s*:\s*session\b/i,
];

const SESSION_CLEANUP_PATTERNS = [
  /\bsession\.(?:close|dispose|exit)\s*\(/i,
  /\b(?:client|requestClient)\.(?:close|dispose|exit)\s*\(/i,
  /\b(?:agent|httpsAgent|httpAgent)\.destroy\s*\(/i,
  /\b(?:cookieJar|jar)\.(?:clear|deleteAll|removeAll)\s*\(/i,
  /\b清理\s*(?:Cookie\s*jar|敏感|运行态)/i,
  /\b销毁\s*session/i,
];

// 从"创建的连接对象"提取变量名（keepAlive Agent 或 Session），
// 按变量名动态检测复用 / 清理，避免只认 session/client 字面量导致 req/sess/agent 等自然命名误报。
function extractSessionVarNames(source) {
  const names = new Set();
  const agentRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:(?:https?|http2|tls)\.)?Agent\s*\(([^)]*)\)/g;
  let m;
  while ((m = agentRe.exec(source))) {
    if (/keepAlive/i.test(m[2])) names.add(m[1]);
  }
  const sessionRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:(?:requests|creq|curl_cffi)\.)?Session\s*\(/g;
  // match22 实测：curl_cffi 交付写成 `session = creq.Session(impersonate=...)`，
  // 旧正则只认 `new Session(` 导致该变量名的复用/清理动态检测失效（sess.get 不匹配
  // 静态 `session\.` 模式）→ 扩展为 requests/creq/curl_cffi 前缀均可提取变量名。
  while ((m = sessionRe.exec(source))) names.add(m[1]);
  return Array.from(names);
}

function dynamicSessionHits(source) {
  const names = extractSessionVarNames(source);
  const reuse = [];
  const cleanup = [];
  for (const name of names) {
    const esc = escapeRe(name);
    const reuseRe = new RegExp(`\\b${esc}\\.(?:request|get|post|put|delete)\\s*\\(|\\bagent\\s*:\\s*${esc}\\b|\\{\\s*${esc}\\s*(?:,|\\})`, 'i');
    if (reuseRe.test(source)) reuse.push(`${name}（keepAlive 连接复用）`);
    const cleanupRe = new RegExp(`\\b${esc}\\.(?:destroy|close|dispose|end)\\s*\\(`, 'i');
    if (cleanupRe.test(source)) cleanup.push(`${name}（keepAlive 连接清理）`);
  }
  return { reuse, cleanup };
}

const DOC_ONLINE_PATTERNS = [
  /FINAL_ARTIFACT_NETWORK_MODE\s*[=:]\s*online/i,
  /默认(?:向|发)真实请求|发送真实请求|联网验证|真实 API 请求/i,
];

const DOC_SIGN_ONLY_PATTERNS = [
  /FINAL_ARTIFACT_NETWORK_MODE\s*[=:]\s*sign-only/i,
  /不发真实请求|不发送真实请求|未(?:发|执行|进行)真实请求/,
  /只输出本地\s*(?:sign|参数)|仅输出本地\s*(?:sign|参数)/i,
  /\bnoRealRequest\b/i,
  /\bno-real-request\b/i,
];

// 否定式声明必须被排除：「不需要 TLS 指纹」「TLS 指纹一律不需要」里的「需要」属于否定表述，
// 直接匹配会把"明确不需要"判成 required（match16 实测：case/notes 写「明确不需要……TLS 指纹」
// 导致门禁强制要求 TLS 兼容客户端，只能靠显式 marker 绕过）。
// required 侧用 lookbehind/lookahead 拦否定词，not-required 侧补齐否定式写法，两边互为兜底。
const DOC_TLS_REQUIRED_PATTERNS = [
  /FINAL_ARTIFACT_TLS_FINGERPRINT\s*[=:]\s*required/i,
  /(?<![不无未非没])(?:需要|要求|强制|依赖)[^\n]{0,20}TLS\s*(?:指纹|兼容客户端)/i,
  /TLS\s*(?:指纹|兼容客户端)(?![^\n]{0,20}[不无未非]需要)[^\n]{0,20}(?:需要|要求|强制|必需)/i,
];

const DOC_TLS_NOT_REQUIRED_PATTERNS = [
  /FINAL_ARTIFACT_TLS_FINGERPRINT\s*[=:]\s*not-required/i,
  /无\s*TLS\s*指纹(?:检测)?|未涉及\s*TLS|不涉及\s*TLS|TLS\s*[：:]\s*未涉及/,
  /目标(?:网站|站点|接口|服务)?\s*(?:无|无需|不需要|不要求)\s*TLS/,
  /(?:不需要|无需|不必|用不到|无要求)[^\n]{0,20}TLS/,
  /TLS\s*(?:指纹|兼容客户端)?[^\n]{0,10}(?:不需要|无需|不必|无要求)/,
  /明确\s*不(?:需要|要求)[^\n]{0,40}TLS/,
];

const NO_REAL_REQUEST_PATTERNS = [
  /不发真实请求|不发送真实请求/,
  /只输出本地\s*(sign|参数)|仅输出本地\s*(sign|参数)/i,
  /\bnoRealRequest\b/i,
  /\bno-real-request\b/i,
  /\bdryRunOnly\b/i,
  /\blocalSignOnly\b/i,
];

// 文档中的旧自然语言声明继续作为兼容输入；机器标记用于避免不同文案造成门禁歧义。
const DOC_NO_REAL_REQUEST_PATTERNS = [
  ...DOC_SIGN_ONLY_PATTERNS,
  ...DOC_TLS_NOT_REQUIRED_PATTERNS,
];

const FINGERPRINT_RENDER_PATTERNS = [
  /\b(require|import)\s*\(?\s*['"](?:canvas|node-canvas|gl|headless-gl)['"]|from\s+['"](?:canvas|node-canvas|gl|headless-gl)['"]/i,
  /__WEB_JS_ENV_PATCHER_FINGERPRINT__/,
  /generate_fingerprint_hook/i,
];

function findMatches(text, patterns) {
  const hits = [];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) hits.push(pattern.toString());
  }
  return hits;
}

function isTextLikeFile(p) {
  return ['.js', '.mjs', '.cjs', '.py', '.json', '.md', '.txt', '.yaml', '.yml', '.curl', '.http', '.har'].includes(ext(p));
}

function isCodeLikeFile(p) {
  return ['.js', '.mjs', '.cjs', '.py', '.json'].includes(ext(p));
}

// 源码文件（硬编码加密参数检查只对源码生效：package.json 等元数据里的
// 脚本名/配置键会命中 CRYPTO_PARAM_NAME_RE，造成"verify": "node ..." 这类误报）
function isSourceCodeFile(p) {
  return ['.js', '.mjs', '.cjs', '.py'].includes(ext(p));
}

// 内容关键词扫描目标（浏览器自动化 / 指纹渲染）：验证记录.json 是验证证据文档，
// 行文提及取证工具名不构成代码依赖，扫描会造成误报（实战：某 case 被迫改写记录措辞来过检查）
function isAutomationScanTarget(p) {
  return isCodeLikeFile(p) && path.basename(p) !== '验证记录.json';
}

// case/ 根层代码文件：标准结构下 case/ 只有子目录，根层 .js/.py 几乎必是
// 「把浏览器内核取数脚本挪出 result/ 规避检查」或未清理的调试残留。
// 临时文件判定只看文件名：直接子文件无子目录结构，且全路径判定会把
// 位于系统 Temp 目录下的 case 误判为临时目录。
function collectCaseRootCodeFiles(caseSubdir) {
  if (!exists(caseSubdir)) return [];
  let entries = [];
  try { entries = fs.readdirSync(caseSubdir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(d => d.isFile() && ['.js', '.mjs', '.cjs', '.py'].includes(ext(d.name)))
    .map(d => path.join(caseSubdir, d.name))
    .filter(p => !isTempOrTestFile(path.basename(p)));
}

function isTempOrTestFile(p) {
  const n = path.basename(p).toLowerCase();
  const normalized = String(p).replace(/\\/g, '/').toLowerCase();
  if (/(^|\/)(tmp|\.tmp|temp|\.temp|cache|\.cache|browser-profile|firefox-profile|chrome-profile|profile|screenshots|hooks|ruyi-trace|logs|trace)(\/|$)/.test(normalized)) return true;
  if (/\.(tmp|temp|log|jsonl|har|png|jpg|jpeg|webp|trace|cache|bak|old|orig|retry|partial|download|crdownload)$/i.test(n)) return true;
  if (/^(test-|tmp-|temp-|debug-|scratch-)/i.test(n)) return true;
  if (/\b(test|spec|debug|scratch|trace|hook|fixture|mock)\b/i.test(n)) return true;
  return false;
}

function isRootSecondEntry(resultDir, p, primary) {
  if (path.dirname(p) !== resultDir) return false;
  if (path.resolve(p) === path.resolve(primary)) return false;
  const n = path.basename(p).toLowerCase();
  if (n === 'package.json' || n === 'requirements.txt' || n === 'config.example.json') return false;
  return ['.js', '.mjs', '.cjs', '.py'].includes(ext(p));
}

function inspectPackageJson(resultDir, problems, warnings) {
  const pkg = path.join(resultDir, 'package.json');
  if (!exists(pkg)) return;
  let data;
  try {
    data = JSON.parse(readText(pkg));
  } catch (err) {
    problems.push(`package.json 解析失败：${err.message}`);
    return;
  }
  const scripts = data.scripts || {};
  for (const [name, cmd] of Object.entries(scripts)) {
    const lowerName = name.toLowerCase();
    const lowerCmd = String(cmd).toLowerCase();
    if (lowerName === 'start') {
      if (!/\bnode\s+(\.\/)?final\.js\b/.test(lowerCmd)) warnings.push('package.json 的 start 脚本建议只指向 node final.js');
    } else if (/(test|debug|dev|server|serve|watch|browser|playwright|puppeteer)/i.test(lowerName + ' ' + lowerCmd)) {
      problems.push(`package.json 存在非交付用途脚本：${name}=${cmd}`);
    }
  }
}

const CRYPTO_PARAM_NAME_RE = /^(?:sign|signature|_signature|x[-_]?sign|x[-_]?s|x[-_]?t|a[_-]?bogus|h5st|mtgsig|w[_-]?rid|x[-_]?bogus|x[-_]?(?:ladon|argus|gorgon|khronos|ss[-_]?stub|mini[-_]?wua|umt)|token|access[-_]?token|auth[-_]?token|x[-_]?token|csrf[-_]?token|csrftoken|verify|digest|hash|hmac|mac|nonce|sig)$/i;

function isPlaceholderValue(value) {
  const s = String(value || '');
  return !s || s.length < 8 || /^(?:xxx+|test+|example|placeholder|todo|replace|redacted|your[_-]?)/i.test(s) || /^[*]+$/.test(s);
}

function isLikelyConcatenationFragment(value) {
  const s = String(value || '');
  const t = s.trim();
  return /(?:^|\s)\+\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\s*\+\s*)?$/.test(s)
    || /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\+(?:\s|$)/.test(t)
    || (/^\+/.test(t) || /\+$/.test(t)) && /\s/.test(s);
}

function maskCryptoValue(value) {
  const s = String(value || '');
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}...${s.slice(-4)}(len=${s.length})`;
}

function addSampleCryptoValue(out, name, value, sourceFile, sourcePath) {
  if (!CRYPTO_PARAM_NAME_RE.test(String(name || ''))) return;
  if (isPlaceholderValue(value)) return;
  const key = `${String(name).toLowerCase()}:${String(value)}`;
  if (out.has(key)) return;
  out.set(key, { name: String(name), value: String(value), masked: maskCryptoValue(value), sourceFile, sourcePath });
}

function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

function extractJsonCryptoValues(obj, out, sourceFile, prefix = 'json') {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const p = `${prefix}.${k}`;
    if (v && typeof v === 'object') extractJsonCryptoValues(v, out, sourceFile, p);
    else addSampleCryptoValue(out, k, v, sourceFile, p);
  }
}

function extractSampleCryptoValuesFromText(text, sourceFile) {
  const out = new Map();
  const urlRe = /https?:\/\/[^\s'"<>]+/g;
  let m;
  while ((m = urlRe.exec(text))) {
    try {
      const u = new URL(m[0]);
      for (const [k, v] of u.searchParams.entries()) addSampleCryptoValue(out, k, v, sourceFile, `query.${k}`);
    } catch (_) {}
  }
  try { extractJsonCryptoValues(JSON.parse(text), out, sourceFile, 'json'); } catch (_) {}
  const pairRe = /["']?([A-Za-z_$][\w$-]{0,80})["']?\s*(?::|=)\s*["']([^"'\r\n&;,}\s]{8,})["']/g;
  while ((m = pairRe.exec(text))) addSampleCryptoValue(out, m[1], m[2], sourceFile, `pair.${m[1]}`);
  const formRe = /(?:^|[?&\s])([A-Za-z_$][\w$-]{0,80})=([^&\s'"<>]{8,})/g;
  while ((m = formRe.exec(text))) addSampleCryptoValue(out, m[1], decodeURIComponentSafe(m[2]), sourceFile, `form.${m[1]}`);
  const headerRe = /(?:^|\s)(?:-H|--header)\s+['"]([^:'"]{1,100})\s*:\s*([^'"\r\n]+)['"]/g;
  while ((m = headerRe.exec(text))) {
    const headerName = m[1].trim();
    const headerValue = m[2].trim();
    addSampleCryptoValue(out, headerName, headerValue, sourceFile, `header.${headerName}`);
    if (headerName.toLowerCase() === 'cookie') {
      for (const part of headerValue.split(';')) {
        const idx = part.indexOf('=');
        if (idx !== -1) {
          const cookieName = part.slice(0, idx).trim();
          const cookieValue = part.slice(idx + 1).trim();
          addSampleCryptoValue(out, cookieName, cookieValue, sourceFile, `cookie.${cookieName}`);
        }
      }
    }
  }
  return [...out.values()];
}

function collectSampleCryptoValues(caseSubdir) {
  const roots = ['requests', 'fixtures'].map(d => path.join(caseSubdir, d)).filter(exists);
  const values = [];
  for (const root of roots) {
    for (const f of walk(root).filter(p => stat(p) && stat(p).isFile() && isTextLikeFile(p))) {
      for (const item of extractSampleCryptoValuesFromText(readText(f), rel(caseSubdir, f))) values.push(item);
    }
  }
  return values;
}

function inspectReusedSampleCryptoValues(caseSubdir, caseDir, resultFiles, textFiles) {
  const sampleValues = collectSampleCryptoValues(caseSubdir);
  const textCache = new Map();
  for (const f of textFiles) {
    let text = '';
    try { text = readText(f); } catch (_) { text = ''; }
    textCache.set(f, text);
  }
  const reused = [];
  for (const sample of sampleValues) {
    for (const f of textFiles) {
      const text = textCache.get(f);
      if (text && text.includes(sample.value)) reused.push({ file: rel(caseDir, f), name: sample.name, value: sample.masked, source: sample.sourceFile, sourcePath: sample.sourcePath });
    }
  }
  const hardcoded = [];
  const hardcodedRe = /["']?([A-Za-z_$][\w$-]{0,80})["']?\s*(?::|=)\s*["']([^"'\r\n]{8,})["']/g;
  for (const f of resultFiles.filter(isSourceCodeFile)) {
    const text = readText(f);
    let m;
    while ((m = hardcodedRe.exec(text))) {
      const name = m[1];
      const value = m[2];
      if (CRYPTO_PARAM_NAME_RE.test(name) && !isPlaceholderValue(value) && !isLikelyConcatenationFragment(value)) {
        hardcoded.push({ file: rel(caseDir, f), name, value: maskCryptoValue(value) });
      }
    }
  }
  const generationEvidence = [];
  const generationRe = /install.*env|补环境|signer|makeSign|generate(?:Sign|Token|Params?)|compute(?:Sign|Token|Params?)|build(?:Sign|Token|Params?)|runTarget|target[\\/]entry|src[\\/]signer|vm\.Script|load.*(?:bundle|target|js)|createContext/i;
  for (const f of resultFiles.filter(isCodeLikeFile)) {
    const text = readText(f);
    if (generationRe.test(text)) generationEvidence.push(rel(caseDir, f));
  }
  return {
    sampleValues: sampleValues.map(x => ({ name: x.name, value: x.masked, source: x.sourceFile, sourcePath: x.sourcePath })),
    reused,
    hardcoded,
    generationEvidence,
  };
}


function inspectStageReports(caseSubdir) {
  const stageDir = path.join(caseSubdir, '阶段报告');
  const result = { dir: stageDir, present: exists(stageDir), files: [], initialPresent: false, chineseFileNames: true, mojibakeSuspected: false };
  const problems = [];
  const warnings = [];
  if (!result.present) {
    // SKILL.md 明确阶段报告默认不生成，仅在多轮复杂补环境 case 或用户明确要求时按需生成；目录缺失不视为问题
    warnings.push('未生成阶段报告目录 case/阶段报告（默认可省略；多轮复杂补环境 case 或用户明确要求时才需要）。');
    return { result, problems, warnings };
  }
  let names = [];
  try { names = fs.readdirSync(stageDir); } catch { names = []; }
  for (const name of names) {
    const file = path.join(stageDir, name);
    const st = stat(file);
    if (!st || !st.isFile() || ext(file) !== '.md') continue;
    const item = { file, chineseFileName: /[\u4e00-\u9fff]/.test(name), utf8Readable: false, mojibakeSuspected: false };
    if (!item.chineseFileName) result.chineseFileNames = false;
    try {
      const text = readText(file);
      item.utf8Readable = true;
      const questionRuns = text.match(/\?{3,}/g) || [];
      item.mojibakeSuspected = text.includes('\uFFFD') || (questionRuns.reduce((n, x) => n + x.length, 0) >= 8 && !/[\u4e00-\u9fff]/.test(text));
      if (item.mojibakeSuspected) result.mojibakeSuspected = true;
    } catch (_) {}
    result.files.push(item);
  }
  result.initialPresent = result.files.some(x => path.basename(x.file) === '01-需求信息确认.md');
  if (!result.files.length) warnings.push('case/阶段报告 中没有 Markdown 阶段报告（默认可省略）。');
  if (!result.initialPresent) warnings.push('缺少前置阶段报告：case/阶段报告/01-需求信息确认.md（默认可省略；若已生成阶段报告则建议补齐）。');
  if (!result.chineseFileNames) problems.push('阶段报告文件名必须包含中文，不能只使用英文文件名。');
  if (result.mojibakeSuspected) problems.push('阶段报告疑似存在中文乱码或连续问号。');
  return { result, problems, warnings };
}

// 默认解题必需章节（与 final-summary.md 的 8 章默认模板对应）
const FINAL_SUMMARY_DEFAULT_SECTIONS = [
  /目标与边界/,
  /用户提供材料/,
  /取证流程与证据来源/,
  /加密参数定位结论/,
  /算法还原|补环境概览/,
  /最终交付结构/,
  /测试结果/,
  /风险与后续建议/,
];

// trace 未覆盖目标接口 URL 字面量时的显式声明关键词（SKILL.md 4.2：未声明不得进入 IMPLEMENT）
const TRACE_COVERAGE_DECLARATION_PATTERNS = [
  /trace\s*未覆盖/i,
  /未覆盖目标接口/i,
  /定位依据为/i,
  /签名链定位依据/i,
  /目标接口 URL 字面量/i,
];

// 生产级交付附加章节（用户要求"生产级交付"时才检查）
const FINAL_SUMMARY_PRODUCTION_SECTIONS = [
  /阶段报告索引/,
  /NativeProtect\s*使用情况/i,
  /环境与指纹\s*API\s*调用回放明细/i,
  /高强度环境检测覆盖矩阵/,
  /加密参数生成与样本复用检查/,
  /代码质量与中文注释/,
  /指纹基线一致性/,
  /Session\s*请求链|Session 模式|TLS 请求验证与 Session 请求链/i,
  /清理结果/,
];

function inspectTraceCoverageDeclaration(caseSubdir, resultDir, requireFinalSummary) {
  // SKILL.md 4.2：trace 未覆盖目标接口 URL 字面量时，必须在最终总结中显式声明
  // 「trace 未覆盖目标接口 URL 字面量；签名链定位依据为 <写入点/关键词>」，未声明不得进入 IMPLEMENT。
  // 判定依据：case/notes/ruyitrace-summary.md 的「目标信号命中检查」若出现未命中信号，
  // 且 result/最终项目总结.md 中无对应声明 → 给出问题（规则兜底，防止文本规则无脚本校验）。
  const result = {
    summaryPresent: false,
    summaryFile: path.join(caseSubdir, 'notes', 'ruyitrace-summary.md'),
    signalMissed: false,
    missedSignals: [],
    declarationPresent: false,
  };
  const problems = [];
  const warnings = [];
  if (!exists(result.summaryFile)) return { result, problems, warnings };
  result.summaryPresent = true;
  let summaryText = '';
  try { summaryText = readText(result.summaryFile); } catch (_) { return { result, problems, warnings }; }
  // 提取「目标信号命中检查」段落（自该标题至下一个二级标题或文件结尾）
  const sectionStart = summaryText.indexOf('## 目标信号命中检查');
  if (sectionStart === -1) return { result, problems, warnings };
  const sectionRest = summaryText.slice(sectionStart);
  const nextSection = sectionRest.search(/\n##\s/);
  const hitSection = nextSection === -1 ? sectionRest : sectionRest.slice(0, nextSection);
  const missedMatches = hitSection.match(/(?:\[未通过\]|未命中)「([^」]+)」/g) || [];
  result.missedSignals = missedMatches.map((m) => (m.match(/「([^」]+)」/) || [])[1] || m);
  result.signalMissed = /\[未通过\]|目标信号未命中|未命中/.test(hitSection);
  if (!result.signalMissed) return { result, problems, warnings };
  if (!requireFinalSummary) {
    warnings.push(`trace 目标信号存在未命中（${result.missedSignals.join('、') || '见摘要'}），但已豁免最终总结要求；请确认已在对话/阶段报告中声明 trace 覆盖情况。`);
    return { result, problems, warnings };
  }
  const finalSummary = path.join(resultDir, '最终项目总结.md');
  if (!exists(finalSummary)) return { result, problems, warnings }; // 最终总结缺失由 inspectFinalSummary 处理
  let finalText = '';
  try { finalText = readText(finalSummary); } catch (_) { return { result, problems, warnings }; }
  result.declarationPresent = TRACE_COVERAGE_DECLARATION_PATTERNS.some((pattern) => pattern.test(finalText));
  if (!result.declarationPresent) {
    problems.push(`case/notes/ruyitrace-summary.md 的目标信号命中检查显示未命中信号（${result.missedSignals.join('、') || '见摘要'}）；SKILL.md 4.2 要求 trace 未覆盖目标接口 URL 字面量时必须在最终项目总结中显式声明「trace 未覆盖目标接口 URL 字面量；签名链定位依据为 <写入点/关键词>」，未声明不得进入 IMPLEMENT。`);
  }
  return { result, problems, warnings };
}

function inspectFinalSummary(resultDir, requireFinalSummary, production) {
  const finalSummary = path.join(resultDir, '最终项目总结.md');
  const legacyFinalSummary = path.join(resultDir, 'final-summary.md');
  const result = {
    required: !!requireFinalSummary,
    production: !!production,
    file: exists(finalSummary) ? finalSummary : '',
    legacyFile: exists(legacyFinalSummary) ? legacyFinalSummary : '',
    present: exists(finalSummary),
    utf8Readable: false,
    mojibakeSuspected: false,
    missingSections: [],
    missingProductionSections: [],
  };
  const problems = [];
  const warnings = [];
  if (!requireFinalSummary) return { result, problems, warnings };
  if (!result.present) {
    if (exists(legacyFinalSummary)) problems.push('最终总结必须使用中文文件名 result/最终项目总结.md；当前只检测到旧文件名 result/final-summary.md，请改名或重新写入。');
    else problems.push('项目完成后必须默认生成最终总结 result/最终项目总结.md；只有用户明确要求不生成时才可跳过，并需运行检查脚本时传入 --no-require-final-summary。');
    return { result, problems, warnings };
  }
  let text = '';
  try {
    text = readText(finalSummary);
    result.utf8Readable = true;
  } catch (err) {
    problems.push(`最终总结无法按 UTF-8 读取：${err.message || String(err)}`);
    return { result, problems, warnings };
  }
  if (/\uFFFD/.test(text) || /\?{6,}/.test(text) || (!/[\u4e00-\u9fff]/.test(text) && /[?]{3,}/.test(text))) {
    result.mojibakeSuspected = true;
    problems.push('最终总结疑似存在中文编码乱码或连续问号，请使用 write_markdown_utf8.js 重新生成 UTF-8 Markdown。');
  }
  for (const pattern of FINAL_SUMMARY_DEFAULT_SECTIONS) {
    if (!pattern.test(text)) result.missingSections.push(pattern.toString());
  }
  if (result.missingSections.length) {
    problems.push(`最终总结缺少默认必需章节：${result.missingSections.join('、')}。默认 8 章模板必须齐全：目标与边界 / 用户提供材料 / 取证流程与证据来源 / 加密参数定位结论 / 算法还原或补环境概览 / 最终交付结构 / 测试结果 / 风险与后续建议。`);
  }
  if (production) {
    for (const pattern of FINAL_SUMMARY_PRODUCTION_SECTIONS) {
      if (!pattern.test(text)) result.missingProductionSections.push(pattern.toString());
    }
    if (result.missingProductionSections.length) {
      problems.push(`生产级交付模式下最终总结缺少附加章节：${result.missingProductionSections.join('、')}。生产级总结需追加：NativeProtect 使用情况 / 指纹基线一致性 / 环境与指纹 API 调用回放明细 / 高强度环境检测覆盖矩阵 / Session 请求链 / 加密参数生成与样本复用检查 / 代码质量与中文注释 / 清理结果 / 阶段报告索引。`);
    }
  }
  if (!/^#\s+/.test(text.trim())) warnings.push('最终总结建议以一级标题开头。');
  return { result, problems, warnings };
}

// 经验沉淀文档检查：result/ 下必须存在 经验沉淀-*.md
function inspectExperienceReport(resultDir, requireExperience) {
  const result = {
    required: !!requireExperience,
    files: [],
    present: false,
  };
  const problems = [];
  const warnings = [];
  if (!exists(resultDir)) return { result, problems, warnings };
  let names = [];
  try { names = fs.readdirSync(resultDir); } catch { names = []; }
  const expFiles = names.filter(n => /^经验沉淀-.*\.md$/i.test(n) && !/^final-summary\.md$/i.test(n));
  result.files = expFiles.map(n => path.join(resultDir, n));
  result.present = expFiles.length > 0;
  if (!requireExperience) return { result, problems, warnings };
  if (!result.present) {
    problems.push('项目完成后必须默认生成经验沉淀文档 result/经验沉淀-<站点>.md（按 cases/_template.md 的 Part 2 格式）；只有用户明确要求不沉淀时才可跳过，并需运行检查脚本时传入 --no-require-experience。');
  } else if (expFiles.length > 1) {
    warnings.push(`result/ 下存在多份经验沉淀文档（${expFiles.join('、')}），建议只保留一份。`);
  }
  return { result, problems, warnings };
}


function inspectValidationRecord(resultDir, networkMode) {
  const file = path.join(resultDir, '验证记录.json');
  const result = { file, present: exists(file), mode: networkMode, attempts: 0, exempt: false, valid: false };
  const problems = [];
  const warnings = [];
  if (!result.present) {
    problems.push(`缺少 result/验证记录.json；${networkMode === 'sign-only' ? 'sign-only 也必须在该文件中明确标记豁免及原因' : '联网模式必须提供至少 5 条真实请求验证记录'}。`);
    return { result, problems, warnings };
  }
  let data;
  try {
    data = JSON.parse(readText(file));
  } catch (err) {
    problems.push(`验证记录.json 解析失败：${err.message}`);
    return { result, problems, warnings };
  }
  if (data.mode !== networkMode) problems.push(`验证记录.json 的 mode 必须为 ${networkMode}，当前为 ${JSON.stringify(data.mode)}。`);
  if (networkMode === 'sign-only') {
    result.exempt = data.signOnlyExempt === true;
    if (!result.exempt || typeof data.exemptionReason !== 'string' || !data.exemptionReason.trim()) {
      problems.push('sign-only 豁免必须在验证记录.json 中设置 signOnlyExempt=true，并提供非空 exemptionReason。');
    }
    result.valid = problems.length === 0;
    return { result, problems, warnings };
  }
  if (!Array.isArray(data.attempts)) {
    problems.push('联网模式的验证记录.json 必须包含 attempts 数组。');
    return { result, problems, warnings };
  }
  result.attempts = data.attempts.length;
  if (data.attempts.length < 5) problems.push(`联网模式至少需要 5 条 attempts，当前只有 ${data.attempts.length} 条。`);
  data.attempts.forEach((attempt, index) => {
    const prefix = `attempts[${index}]`;
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
      problems.push(`${prefix} 必须是对象。`);
      return;
    }
    if (typeof attempt.timestamp !== 'string' || !attempt.timestamp.trim() || Number.isNaN(Date.parse(attempt.timestamp))) problems.push(`${prefix}.timestamp 必须是有效时间字符串。`);
    if (!Number.isInteger(attempt.httpStatus) || attempt.httpStatus < 200 || attempt.httpStatus >= 300) problems.push(`${prefix}.httpStatus 必须是 2xx 整数。`);
    const summaryValid = typeof attempt.parameterSummary === 'string'
      ? attempt.parameterSummary.trim().length > 0
      : attempt.parameterSummary && typeof attempt.parameterSummary === 'object' && !Array.isArray(attempt.parameterSummary) && Object.keys(attempt.parameterSummary).length > 0;
    if (!summaryValid) problems.push(`${prefix}.parameterSummary 必须是非空字符串或非空对象。`);
    if (typeof attempt.sessionStage !== 'string' || !attempt.sessionStage.trim()) problems.push(`${prefix}.sessionStage 必须是非空字符串。`);
    if (attempt.responseValid !== true) problems.push(`${prefix}.responseValid 必须严格为 true。`);
  });
  result.valid = problems.length === 0;
  return { result, problems, warnings };
}

// 验证码答案层接入检查：检测到验证码交付（config 含 captcha 对象，或代码引用 adapter 契约）时，
// 要求 result/src/adapter.*（平台协议）与答案层接入（src/solver.* 或等效求解代码）同时存在。
// 对应 references/captcha/captcha-solving-handoff.md 的交付要求：答案层求解是交付组成部分。
const CAPTCHA_ADAPTER_REF_RE = /require\(['"]\.\/src\/adapter|from\s+src\.adapter|src[\/\\]adapter/;
const CAPTCHA_SOLVER_REF_RE = /ddddocr|slide_match|slide_comparison|solver|打码|click_gap/i;

function inspectCaptchaAnswerLayer(resultDir, resultFiles) {
  const problems = [];
  const warnings = [];
  let isCaptcha = false;
  const configPath = path.join(resultDir, 'config.json');
  if (exists(configPath)) {
    try {
      const cfg = JSON.parse(readText(configPath));
      if (cfg && typeof cfg === 'object' && cfg.captcha && typeof cfg.captcha === 'object') isCaptcha = true;
    } catch (_) { /* config.json 解析失败由其他检查处理 */ }
  }
  if (!isCaptcha) {
    for (const f of resultFiles) {
      if (!['.js', '.mjs', '.cjs', '.py'].includes(ext(f))) continue;
      const st = stat(f);
      if (!st || !st.isFile()) continue;
      if (CAPTCHA_ADAPTER_REF_RE.test(readText(f))) { isCaptcha = true; break; }
    }
  }
  if (!isCaptcha) return { result: { isCaptcha: false }, problems, warnings };

  const adapterPresent = ['src/adapter.js', 'src/adapter.py'].some((p) => exists(path.join(resultDir, p)));
  if (!adapterPresent) {
    problems.push('检测到验证码交付（captcha 配置或 adapter 契约引用），但缺少 result/src/adapter.js 或 src/adapter.py：真实平台协议必须由本 case 的 adapter 实现（契约示例见 templates/captcha-verify*/adapter*）');
  }
  const solverFilePresent = ['src/solver.js', 'src/solver.py'].some((p) => exists(path.join(resultDir, p)));
  const solverRefPresent = resultFiles
    .filter((p) => ['.js', '.mjs', '.cjs', '.py'].includes(ext(p)) && stat(p) && stat(p).isFile())
    .some((p) => CAPTCHA_SOLVER_REF_RE.test(readText(p)));
  if (!solverFilePresent && !solverRefPresent) {
    problems.push('验证码交付缺少答案层接入：result/src/solver.js|py 不存在，代码中也无 ddddocr/slide_match/打码等求解痕迹。答案层求解是验证码交付的组成部分（见 references/captcha/captcha-solving-handoff.md），不得只交封装层');
  }
  return { result: { isCaptcha: true, adapterPresent, solverPresent: solverFilePresent || solverRefPresent }, problems, warnings };
}

function check(args) {
  if (!args.caseDir && !args.file) throw new Error('必须提供 --case-dir 或 --file');
  const caseDir = args.caseDir ? path.resolve(args.caseDir) : path.resolve(path.dirname(args.file), '..');
  const caseSubdir = paths.resolveCaseDir(caseDir);
  const resultDir = paths.resolveResultDir(caseDir);
  const problems = [];
  const warnings = [];

  if (!exists(caseDir)) problems.push(`项目根目录不存在：${caseDir}`);
  if (!exists(resultDir)) problems.push(`结果目录不存在：${resultDir}（result/ 应与 case/ 平级）`);

  const candidate = args.file ? path.resolve(args.file) : null;
  let primary = candidate;
  if (!primary && exists(resultDir)) {
    const candidates = ['final.js', 'final.py'].map(name => path.join(resultDir, name)).filter(exists);
    if (candidates.length === 1) primary = candidates[0];
    else if (candidates.length === 0) problems.push('未找到唯一执行入口：result/final.js 或 result/final.py');
    else problems.push('同时存在 final.js 和 final.py；最终项目只能有一个执行入口');
  }

  const resultFiles = exists(resultDir) ? walk(resultDir).filter(p => stat(p) && stat(p).isFile()) : [];
  const textFiles = resultFiles.filter(isTextLikeFile);
  const codeFiles = resultFiles.filter(isCodeLikeFile);
  const docMdFiles = [];
  for (const f of [...resultFiles, ...(exists(caseSubdir) ? walk(caseSubdir) : [])]) {
    const st = stat(f);
    if (st && st.isFile() && ext(f) === '.md' && !docMdFiles.includes(f)) docMdFiles.push(f);
  }

  // 机器标记与旧文档声明分开解析：TLS 需求不能改变联网模式，联网也不能反向豁免 Session 生命周期。
  const declarationText = docMdFiles.map(f => readText(f)).join('\n');
  const markerValues = (pattern) => [...declarationText.matchAll(pattern)].map(m => m[1].toLowerCase());
  const networkMarkers = markerValues(NETWORK_MODE_MARKER_RE);
  const tlsMarkers = markerValues(TLS_FINGERPRINT_MARKER_RE);
  const docSignOnlyHits = findMatches(declarationText, DOC_SIGN_ONLY_PATTERNS);
  const docOnlineHits = findMatches(declarationText, DOC_ONLINE_PATTERNS);
  const docTlsRequiredHits = findMatches(declarationText, DOC_TLS_REQUIRED_PATTERNS);
  const docTlsNotRequiredHits = findMatches(declarationText, DOC_TLS_NOT_REQUIRED_PATTERNS);
  const docNoRealRequestHits = [];
  for (const f of docMdFiles) {
    const hits = findMatches(readText(f), DOC_NO_REAL_REQUEST_PATTERNS);
    if (hits.length) docNoRealRequestHits.push({ file: rel(caseDir, f), hits });
  }
  const networkMode = networkMarkers.includes('online') || docOnlineHits.length
    ? 'online'
    : networkMarkers.includes('sign-only') || docSignOnlyHits.length
      ? 'sign-only'
      : null;
  // 显式 marker 优先于自然语言：marker 是用户的明确声明，自然语言只是兼容旧文档的启发式，
  // 不能反过来否决 marker（match16 实测：文档已写 not-required，仍被自然语言命中判成 required）。
  const tlsFingerprint = tlsMarkers.includes('required') ? 'required'
    : tlsMarkers.includes('not-required') ? 'not-required'
      : docTlsRequiredHits.length && !docTlsNotRequiredHits.length ? 'required'
        : docTlsNotRequiredHits.length ? 'not-required'
          : null;
  if (!tlsMarkers.length && docTlsRequiredHits.length && docTlsNotRequiredHits.length) {
    warnings.push('文档中同时出现「需要 TLS 指纹」与「不需要 TLS 指纹」的表述，已按"需要"保守判定；确认不需要时用 FINAL_ARTIFACT_TLS_FINGERPRINT: not-required 显式声明消除歧义。');
  }
  const docNoRealRequest = networkMode === 'sign-only';
  // 请求/会话分析变量提升到 primary 块外：验证记录检查必须以"代码真实请求"为准，
  // 不能只依赖文档声明的 networkMode（文档未声明时联网项目会把验证记录检查整个跳过）。
  let requestHits = [];
  let noRealRequestHits = [];
  let online = false;
  let signOnly = false;
  let validationRecord = { result: { file: path.join(resultDir, '验证记录.json'), present: false, mode: null, attempts: 0, exempt: false, valid: false }, problems: [], warnings: [] };

  if (primary && !exists(primary)) problems.push(`指定执行入口不存在：${primary}`);
  if (primary && exists(primary)) {
    const primaryExt = ext(primary);
    if (!['.js', '.py'].includes(primaryExt)) problems.push('执行入口必须是 final.js 或 final.py');
    if (path.dirname(primary) !== resultDir) warnings.push('执行入口不在 result/ 目录中（result/ 应与 case/ 平级），建议移动到 result/final.js 或 result/final.py');

    const text = readText(primary);
    if (primaryExt === '.js' && !/require\.main\s*===\s*module|import\.meta\.url|main\s*\(\s*\)\.catch|await\s+main\s*\(/.test(text)) {
      warnings.push('未检测到清晰的 Node.js 直接运行入口；建议提供 main() 并在命令行运行时调用');
    }
    if (primaryExt === '.py' && !/if\s+__name__\s*==\s*['"]__main__['"]/.test(text)) {
      warnings.push('未检测到 Python 直接运行入口 if __name__ == "__main__"');
    }

    const rootSecondEntries = resultFiles.filter(p => isRootSecondEntry(resultDir, p, primary));
    if (rootSecondEntries.length) {
      problems.push(`结果目录根部存在多个疑似执行入口：${rootSecondEntries.map(p => rel(caseDir, p)).join('、')}`);
    }

    const requestPatterns = primaryExt === '.py' ? [...PY_REQUEST_PATTERNS, /\brequests\.(?:get|post|request)\s*\(/i] : REQUEST_PATTERNS;
    const requestSearchFiles = codeFiles.filter(p => primaryExt === '.py' ? ext(p) === '.py' : ['.js', '.mjs', '.cjs'].includes(ext(p)));
    requestHits = [];
    noRealRequestHits = [];
    const sessionCreateHits = [];
    const sessionReuseHits = [];
    const sessionCleanupHits = [];
    for (const f of requestSearchFiles) {
      const source = readText(f);
      const hits = findMatches(source, requestPatterns);
      if (hits.length) requestHits.push({ file: rel(caseDir, f), hits });
      const noRealHits = findMatches(source, NO_REAL_REQUEST_PATTERNS);
      if (noRealHits.length) noRealRequestHits.push({ file: rel(caseDir, f), hits: noRealHits });
      const createHits = findMatches(source, SESSION_CREATE_PATTERNS);
      if (createHits.length) sessionCreateHits.push({ file: rel(caseDir, f), hits: createHits });
      const reuseHits = findMatches(source, SESSION_REUSE_PATTERNS);
      const dynSession = dynamicSessionHits(source);
      if (reuseHits.length || dynSession.reuse.length) sessionReuseHits.push({ file: rel(caseDir, f), hits: [...reuseHits, ...dynSession.reuse] });
      const cleanupHits = findMatches(source, SESSION_CLEANUP_PATTERNS);
      if (cleanupHits.length || dynSession.cleanup.length) sessionCleanupHits.push({ file: rel(caseDir, f), hits: [...cleanupHits, ...dynSession.cleanup] });
    }
    online = networkMode === 'online' || requestHits.length > 0;
    signOnly = networkMode === 'sign-only' && !requestHits.length;
    const tlsRequired = tlsFingerprint === 'required';
    if (!signOnly && !online && !noRealRequestHits.length && !docNoRealRequest) {
      problems.push('未声明最终联网模式：请使用 FINAL_ARTIFACT_NETWORK_MODE=online 或 sign-only 明确标记。');
    }
    if (online && tlsRequired && !findMatches(requestSearchFiles.map(readText).join('\n'), JS_REQUEST_PATTERNS.concat(PY_REQUEST_PATTERNS)).length) {
      problems.push('证据/配置声明需要 TLS 指纹，但未检测到 TLS 指纹兼容请求客户端。');
    }
    if (online && (!sessionCreateHits.length || !sessionReuseHits.length || !sessionCleanupHits.length)) {
      problems.push(`最终联网请求必须具备可复用 Session 与清理：${[
        !sessionCreateHits.length && '未检测到 Session 创建',
        !sessionReuseHits.length && '未检测到 Session 复用请求',
        !sessionCleanupHits.length && '未检测到 Session 关闭或清理',
      ].filter(Boolean).join('；')}。`);
    }
    if (online && networkMode === 'sign-only') warnings.push('代码检测到联网请求，覆盖 sign-only 声明；按联网模式执行 Session 门禁。');
  }

  // 验证记录检查以"代码真实请求"为准（防文档未声明联网模式时整个跳过）：
  // - 代码存在真实请求 → 视为 online，强制检查验证记录.json 至少 5 条有效 attempts；
  // - 代码/文档明确 sign-only（含代码内 noRealRequest 标记）且无真实请求 → 检查 sign-only 豁免；
  // - 二者都不是 → 维持现状（"未声明最终联网模式"问题已在上方卡住）。
  const validationMode = online
    ? 'online'
    : (signOnly || (!requestHits.length && noRealRequestHits.length)) ? 'sign-only' : null;
  if (exists(resultDir) && validationMode) {
    validationRecord = inspectValidationRecord(resultDir, validationMode);
    problems.push(...validationRecord.problems);
    warnings.push(...validationRecord.warnings);
  }

  const automationHits = [];
  for (const f of codeFiles.filter(isAutomationScanTarget)) {
    const hits = findMatches(stripComments(readText(f)), AUTOMATION_PATTERNS);
    if (hits.length) automationHits.push({ file: rel(caseDir, f), hits });
  }
  if (automationHits.length) {
    problems.push(`最终项目源码疑似包含浏览器自动化 / 取证代码：${automationHits.map(x => `${x.file}(${x.hits.join('、')})`).join('；')}`);
  }

  // 防绕过：把浏览器内核取数脚本挪出 result/（如 case/ 根层）不改变其交付性质
  const caseRootAutomationHits = [];
  for (const f of collectCaseRootCodeFiles(caseSubdir)) {
    const hits = findMatches(stripComments(readText(f)), AUTOMATION_PATTERNS);
    if (hits.length) caseRootAutomationHits.push({ file: rel(caseDir, f), hits });
  }
  if (caseRootAutomationHits.length) {
    problems.push(`case/ 根层存在疑似浏览器自动化/取证脚本：${caseRootAutomationHits.map(x => `${x.file}(${x.hits.join('、')})`).join('；')}。取证 hook 属 case/hooks/（用完即删）；浏览器内核取数脚本放在 case/ 仍是交付依赖，违反纯协议红线。`);
  }

  const fingerprintRenderHits = [];
  for (const f of codeFiles.filter(isAutomationScanTarget)) {
    const hits = findMatches(readText(f), FINGERPRINT_RENDER_PATTERNS);
    if (hits.length) fingerprintRenderHits.push({ file: rel(caseDir, f), hits });
  }
  if (fingerprintRenderHits.length) {
    problems.push(`最终项目源码疑似包含指纹采样 Hook 或 Node.js 渲染库：${fingerprintRenderHits.map(x => `${x.file}(${x.hits.join('、')})`).join('；')}。指纹应由真实浏览器采样 fixture + 终端 API 值回放实现，采样 Hook 不得进入 result/。`);
  }

  const reuse = exists(resultDir) ? inspectReusedSampleCryptoValues(caseSubdir, caseDir, resultFiles, textFiles) : { sampleValues: [], reused: [], hardcoded: [], generationEvidence: [] };
  if (reuse.reused.length) {
    problems.push(`最终项目疑似直接复用了请求样本 / fixture 中的加密参数值：${reuse.reused.map(x => `${x.file} 中 ${x.name}=${x.value}（来源 ${x.source}:${x.sourcePath}）`).join('；')}。这些值只能作为 expected fixture，必须通过补环境重新生成。`);
  }
  if (reuse.hardcoded.length) {
    problems.push(`最终项目疑似硬编码加密参数字面量：${reuse.hardcoded.map(x => `${x.file} 中 ${x.name}=${x.value}`).join('；')}。应调用补环境后的目标 JS 入口或 signer 模块生成，不能写死 cURL 里的值。`);
  }
  if (reuse.sampleValues.length && !reuse.generationEvidence.length) {
    warnings.push('发现请求样本中存在可疑加密参数，但最终项目未明显体现补环境 / signer / 目标 JS 入口调用痕迹；请人工确认不是直接复用样本参数。');
  }

  const tempLike = resultFiles.filter(p => isTempOrTestFile(rel(resultDir, p)));
  if (tempLike.length) problems.push(`结果目录存在临时 / 测试 / 调试产物：${tempLike.map(p => rel(caseDir, p)).join('、')}`);

  inspectPackageJson(resultDir, problems, warnings);

  const stageReports = inspectStageReports(caseSubdir);
  problems.push(...stageReports.problems);
  warnings.push(...stageReports.warnings);

  const finalSummary = exists(resultDir) ? inspectFinalSummary(resultDir, args.requireFinalSummary, args.production) : {
    result: { required: !!args.requireFinalSummary, production: !!args.production, file: '', present: false, utf8Readable: false, mojibakeSuspected: false, missingSections: [], missingProductionSections: [] },
    problems: [],
    warnings: [],
  };
  problems.push(...finalSummary.problems);
  warnings.push(...finalSummary.warnings);

  const traceCoverage = exists(caseSubdir) ? inspectTraceCoverageDeclaration(caseSubdir, resultDir, args.requireFinalSummary) : {
    result: { summaryPresent: false, signalMissed: false, declarationPresent: false },
    problems: [],
    warnings: [],
  };
  problems.push(...traceCoverage.problems);
  warnings.push(...traceCoverage.warnings);

  const experience = exists(resultDir) ? inspectExperienceReport(resultDir, args.requireExperience) : {
    result: { required: !!args.requireExperience, files: [], present: false },
    problems: [],
    warnings: [],
  };
  problems.push(...experience.problems);
  warnings.push(...experience.warnings);

  const captchaLayer = exists(resultDir) ? inspectCaptchaAnswerLayer(resultDir, resultFiles) : {
    result: { isCaptcha: false },
    problems: [],
    warnings: [],
  };
  problems.push(...captchaLayer.problems);
  warnings.push(...captchaLayer.warnings);

  return {
    caseDir,
    caseSubdir,
    resultDir,
    entryFile: primary || null,
    clean: problems.length === 0,
    production: !!args.production,
    problems,
    warnings,
    docNoRealRequest,
    docNoRealRequestHits,
    networkMode,
    tlsFingerprint,
    validationRecord: validationRecord.result,
    reusedCryptoCheck: reuse,
    finalSummary: finalSummary.result,
    traceCoverage: traceCoverage.result,
    experience: experience.result,
    stageReports: stageReports.result,
    captchaAnswerLayer: captchaLayer.result,
    finalSummaryOptOut: args.finalSummaryOptOut,
    experienceOptOut: args.experienceOptOut,
    resultFiles: resultFiles.map(p => rel(caseDir, p)),
  };
}

function renderMarkdown(result) {
  const lines = [
    '# 最终项目检查结果',
    '',
    `项目根目录：${result.caseDir}`,
    `case 子目录：${result.caseSubdir}`,
    `结果目录：${result.resultDir}`,
    `唯一执行入口：${result.entryFile || '未找到'}`,
    `交付模式：${result.production ? '生产级交付（检查附加章节）' : '默认解题必需'}`,
    `是否通过：${result.clean ? '是' : '否'}`,
    '',
    '## 检查项',
    `- 是否只有一个执行入口：${result.problems.some(p => p.includes('执行入口')) ? '否' : '是'}`,
    `- 是否不含浏览器自动化代码：${result.problems.some(p => p.includes('自动化')) ? '否' : '是'}`,
    `- 网络模式：${result.networkMode || '未声明'}`,
    `- TLS 指纹要求：${result.tlsFingerprint || '未声明'}`,
    `- 验证记录：${result.validationRecord.valid ? (result.validationRecord.exempt ? 'sign-only 已明确豁免' : `${result.validationRecord.attempts} 条有效 attempts`) : '未通过'}`,
    `- TLS 指纹兼容客户端（仅 required 时强制）：${result.problems.some(p => p.includes('TLS 指纹兼容请求客户端')) ? '未通过' : (result.tlsFingerprint === 'required' ? '已检测' : '不强制')}`,
    `- 旧文档兼容声明命中：${result.docNoRealRequestHits.length ? result.docNoRealRequestHits.map(x => `${x.file}(${x.hits.join('、')})`).join('；') : '无'}`,
    `- 联网模式是否具备可复用 Session 与清理：${result.problems.some(p => p.includes('可复用 Session 与清理')) ? '否' : '是'}`,
    `- 是否不含指纹采样 Hook / Node.js 渲染库：${result.problems.some(p => p.includes('指纹采样 Hook') || p.includes('渲染库')) ? '否' : '是'}`,
    `- 是否未复用 cURL / fixture 中的加密参数样本值：${result.reusedCryptoCheck.reused.length || result.reusedCryptoCheck.hardcoded.length ? '否' : '是'}`,
    `- 是否已生成中文命名最终总结且包含默认 8 章：${result.finalSummary.required ? (result.finalSummary.present && !result.finalSummary.mojibakeSuspected && !result.finalSummary.missingSections.length ? '是' : '否') : (result.finalSummaryOptOut ? '用户明确豁免' : '未强制检查')}`,
    `- 是否已生成经验沉淀文档 result/经验沉淀-<站点>.md：${result.experience.required ? (result.experience.present ? '是' : '否') : (result.experienceOptOut ? '用户明确豁免' : '未强制检查')}`,
    `- 是否包含生产级附加章节（仅生产级交付检查）：${result.finalSummary.production ? (result.finalSummary.missingProductionSections.length ? '否' : '是') : '未要求'}`,
    `- result 目录是否无临时 / 测试产物：${result.problems.some(p => p.includes('临时') || p.includes('测试')) ? '否' : '是'}`,
    '',
    '## 样本加密参数复用检查',
    `- 样本中发现的可疑加密参数值数量：${result.reusedCryptoCheck.sampleValues.length}`,
    `- 直接复用样本值：${result.reusedCryptoCheck.reused.length ? '是' : '否'}`,
    `- 硬编码加密参数字面量：${result.reusedCryptoCheck.hardcoded.length ? '是' : '否'}`,
    `- 补环境 / signer 生成痕迹：${result.reusedCryptoCheck.generationEvidence.length ? result.reusedCryptoCheck.generationEvidence.join('、') : '未明显发现'}`,
    '',
    '## 阶段报告检查',
    `- 目录：${result.stageReports.dir}`,
    `- 是否存在 01-需求信息确认.md：${result.stageReports.initialPresent ? '是' : '否'}`,
    `- 文件名是否均含中文：${result.stageReports.chineseFileNames ? '是' : '否'}`,
    `- 疑似乱码：${result.stageReports.mojibakeSuspected ? '是' : '否'}`,
    `- 报告数量：${result.stageReports.files.length}`,
    '',
    '## 最终总结检查',
    `- 默认要求：${result.finalSummary.required ? '是' : '否'}`,
    `- 生产级附加章节检查：${result.finalSummary.production ? '是' : '否'}`,
    `- 文件：${result.finalSummary.file ? rel(result.resultDir, result.finalSummary.file) : '未发现，应为 最终项目总结.md'}`,
    `- UTF-8 可读：${result.finalSummary.utf8Readable ? '是' : '否'}`,
    `- 疑似乱码：${result.finalSummary.mojibakeSuspected ? '是' : '否'}`,
    `- 缺少默认章节：${result.finalSummary.missingSections.length ? result.finalSummary.missingSections.join('、') : '无'}`,
    `- 缺少生产级附加章节：${result.finalSummary.missingProductionSections.length ? result.finalSummary.missingProductionSections.join('、') : (result.finalSummary.production ? '无' : '未检查')}`,
    '',
    '## 经验沉淀文档检查',
    `- 默认要求：${result.experience.required ? '是' : '否'}`,
    `- 文件：${result.experience.files.length ? result.experience.files.map(f => rel(result.resultDir, f)).join('、') : '未发现，应为 经验沉淀-<站点>.md'}`,
    `- 存在：${result.experience.present ? '是' : '否'}`,
    '',
  ];
  if (result.problems.length) {
    lines.push('## 问题');
    for (const p of result.problems) lines.push(`- ${p}`);
    lines.push('');
  }
  if (result.warnings.length) {
    lines.push('## 提醒');
    for (const w of result.warnings) lines.push(`- ${w}`);
    lines.push('');
  }
  lines.push('## result 文件列表');
  if (result.resultFiles.length) for (const f of result.resultFiles) lines.push(`- ${f}`);
  else lines.push('- 无');
  return lines.join('\n') + '\n';
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-final-artifact-'));
  try {
    const resultDir = path.join(root, 'result');
    fs.mkdirSync(resultDir);
    const validAttempt = (index) => ({
      timestamp: new Date(Date.now() + index).toISOString(),
      httpStatus: 200,
      parameterSummary: { attempt: index + 1 },
      sessionStage: 'target-api',
      responseValid: true,
    });
    const cases = [
      { name: 'online-valid', mode: 'online', data: { mode: 'online', attempts: Array.from({ length: 5 }, (_, i) => validAttempt(i)) }, clean: true },
      { name: 'online-too-few', mode: 'online', data: { mode: 'online', attempts: Array.from({ length: 4 }, (_, i) => validAttempt(i)) }, clean: false },
      { name: 'online-invalid-response', mode: 'online', data: { mode: 'online', attempts: Array.from({ length: 5 }, (_, i) => ({ ...validAttempt(i), responseValid: i !== 2 })) }, clean: false },
      { name: 'sign-only-valid', mode: 'sign-only', data: { mode: 'sign-only', signOnlyExempt: true, exemptionReason: '用户明确要求只输出参数不验证' }, clean: true },
      { name: 'sign-only-missing-reason', mode: 'sign-only', data: { mode: 'sign-only', signOnlyExempt: true }, clean: false },
    ];
    for (const item of cases) {
      fs.writeFileSync(path.join(resultDir, '验证记录.json'), JSON.stringify(item.data), 'utf8');
      const actual = inspectValidationRecord(resultDir, item.mode).result.valid;
      if (actual !== item.clean) throw new Error(`${item.name} 预期 valid=${item.clean}，实际为 ${actual}`);
    }
    const allowedMock = path.join(resultDir, 'env-allowed.js');
    fs.writeFileSync(allowedMock, "const nav = {}; nav['web' + 'driver'] = false; // navigator.webdriver mock\n", 'utf8');
    if (findMatches(readText(allowedMock), AUTOMATION_PATTERNS).length) {
      throw new Error('webdriver 环境 mock 不应被误判为浏览器自动化');
    }
    const automation = path.join(resultDir, 'automation.js');
    fs.writeFileSync(automation, "const wd = require('selenium-webdriver'); new wd.Builder().forBrowser('chrome').build();\n", 'utf8');
    if (!findMatches(readText(automation), AUTOMATION_PATTERNS).length) {
      throw new Error('selenium-webdriver 应被识别为浏览器自动化');
    }
    const commentOnly = path.join(resultDir, 'comment-only.js');
    fs.writeFileSync(commentOnly, "// 本算法由 RuyiTrace / ruyipage 取证实证，交付物不依赖浏览器自动化\nconst a = 1;\n", 'utf8');
    if (findMatches(stripComments(readText(commentOnly)), AUTOMATION_PATTERNS).length) {
      throw new Error('注释中的 RuyiTrace 说明文字不应被误判为浏览器自动化');
    }
    if (isAutomationScanTarget(path.join(resultDir, '验证记录.json'))) {
      throw new Error('验证记录.json 是验证证据文档，不应参与自动化关键词扫描');
    }
    if (!isAutomationScanTarget(path.join(resultDir, 'src', 'gen.js'))) {
      throw new Error('result/src 源码应参与自动化关键词扫描');
    }
    const recordDoc = path.join(resultDir, '验证记录.json');
    fs.writeFileSync(recordDoc, JSON.stringify({ mode: 'online', note: '取证由 ruyipage 定制 Firefox 完成' }), 'utf8');
    if (findMatches(readText(recordDoc), AUTOMATION_PATTERNS).length === 0) {
      throw new Error('自测前置失败：记录文本应包含自动化关键词（豁免逻辑在文件集过滤层）');
    }
    const deliverRoot = path.join(root, 'deliver');
    const deliverCase = path.join(deliverRoot, 'case');
    fs.mkdirSync(deliverCase, { recursive: true });
    fs.writeFileSync(path.join(deliverCase, '方案-浏览器内核-fetch.py'), 'import ruyipage\n', 'utf8');
    const deliverFiles = collectCaseRootCodeFiles(deliverCase);
    if (deliverFiles.length !== 1 || !findMatches(stripComments(readText(deliverFiles[0])), AUTOMATION_PATTERNS).length) {
      throw new Error('case/ 根层浏览器内核取数脚本应被识别');
    }
    fs.writeFileSync(path.join(deliverCase, 'tmp-probe.py'), 'import ruyipage\n', 'utf8');
    if (collectCaseRootCodeFiles(deliverCase).length !== 1) {
      throw new Error('tmp- 前缀调试文件不应计入 case 根层交付扫描');
    }
    const naturalSession = "const agent = new https.Agent({ keepAlive: true });\nhttps.request({ agent, host: 'x' });\nagent.destroy();\n";
    const dynNatural = dynamicSessionHits(naturalSession);
    if (!dynNatural.reuse.length || !dynNatural.cleanup.length) {
      throw new Error('keepAlive Agent 自然命名（agent）的复用与清理应被识别');
    }

    // HTTP/2 原生客户端（match17 实测）：http2.connect 即 Session 创建，
    // 之前只能靠显式封装 createRequestSession() 绕开，现在应直接命中三件套。
    const http2Session = [
      "const http2 = require('node:http2');",
      "const client = http2.connect(`https://${host}`, { settings: { enablePush: false } });",
      "const stream = client.request(headers);",
      "client.close();",
    ].join('\n');
    if (!findMatches(http2Session, SESSION_CREATE_PATTERNS).length) {
      throw new Error('http2.connect( 应被识别为 Session 创建');
    }
    if (!findMatches(http2Session, SESSION_REUSE_PATTERNS).length) {
      throw new Error('client.request( 应被识别为 Session 复用');
    }
    if (!findMatches(http2Session, SESSION_CLEANUP_PATTERNS).length) {
      throw new Error('client.close( 应被识别为 Session 清理');
    }

    // TLS 声明：否定式表述不得被判成 required（match16 实测：case/notes 的「明确不需要……TLS 指纹」被误判）
    const tlsNegatives = ['不需要 TLS 指纹', 'TLS 指纹一律不需要', '一律不需要 TLS 指纹兼容客户端', '明确不需要：canvas、WebGL、TLS 指纹'];
    for (const text of tlsNegatives) {
      if (findMatches(text, DOC_TLS_REQUIRED_PATTERNS).length) throw new Error(`否定式 TLS 声明不应判为 required：${text}`);
      if (!findMatches(text, DOC_TLS_NOT_REQUIRED_PATTERNS).length) throw new Error(`否定式 TLS 声明应命中 not-required：${text}`);
    }
    const tlsPositives = ['需要 TLS 指纹兼容客户端', 'TLS 指纹兼容客户端为必需', '目标强制 TLS 指纹校验'];
    for (const text of tlsPositives) {
      if (!findMatches(text, DOC_TLS_REQUIRED_PATTERNS).length) throw new Error(`肯定式 TLS 声明应判为 required：${text}`);
      if (findMatches(text, DOC_TLS_NOT_REQUIRED_PATTERNS).length) throw new Error(`肯定式 TLS 声明不应命中 not-required：${text}`);
    }

    // trace 覆盖声明兜底：summary 出现未命中信号时，最终总结必须有声明
    const covRoot = path.join(root, 'cov');
    const covCase = path.join(covRoot, 'case'); // inspectTraceCoverageDeclaration 第一个参数为 caseSubdir
    const covNotes = path.join(covCase, 'notes');
    const covResult = path.join(covRoot, 'result');
    fs.mkdirSync(covNotes, { recursive: true });
    fs.mkdirSync(covResult, { recursive: true });
    const covSummary = '## 目标信号命中检查\n- [通过] 命中「noncestr」：98 次\n- [未通过] 未命中「appSignKey」：0 次\n- [警告] 目标信号未命中：若信号是环境 API / 写入点，说明目标路径未触发；若传的是目标接口 URL 字面量，则属预期，不要反复重试，改用写入点/参数名定位并声明豁免。\n';
    fs.writeFileSync(path.join(covNotes, 'ruyitrace-summary.md'), covSummary, 'utf8');
    fs.writeFileSync(path.join(covResult, '最终项目总结.md'), '# 测试总结\n## 目标与边界\n无声明示例\n', 'utf8');
    const covMissing = inspectTraceCoverageDeclaration(covCase, covResult, true);
    if (covMissing.problems.length === 0) {
      throw new Error('summary 未命中信号 + 最终总结无声明 → 应产生问题');
    }
    fs.writeFileSync(path.join(covResult, '最终项目总结.md'), '# 测试总结\n## 目标与边界\ntrace 未覆盖目标接口 URL 字面量；签名链定位依据为 noncestr\n', 'utf8');
    const covDeclared = inspectTraceCoverageDeclaration(covCase, covResult, true);
    if (covDeclared.problems.length > 0 || covDeclared.result.declarationPresent !== true) {
      throw new Error('summary 未命中信号 + 最终总结已声明 → 应通过');
    }
    const covClean = path.join(root, 'cov-clean');
    const covCleanCase = path.join(covClean, 'case');
    const covCleanNotes = path.join(covCleanCase, 'notes');
    const covCleanResult = path.join(covClean, 'result');
    fs.mkdirSync(covCleanNotes, { recursive: true });
    fs.mkdirSync(covCleanResult, { recursive: true });
    fs.writeFileSync(path.join(covCleanNotes, 'ruyitrace-summary.md'), '## 目标信号命中检查\n- [通过] 命中「noncestr」：98 次\n', 'utf8');
    fs.writeFileSync(path.join(covCleanResult, '最终项目总结.md'), '# 测试总结\n## 目标与边界\n无未命中信号，无需声明\n', 'utf8');
    const covCleanCheck = inspectTraceCoverageDeclaration(covCleanCase, covCleanResult, true);
    if (covCleanCheck.problems.length > 0 || covCleanCheck.result.signalMissed !== false) {
      throw new Error('summary 无未命中信号 → 不应产生问题');
    }

    // 验证码答案层检查：captcha config 存在时要求 adapter + solver；普通交付不触发
    const capRoot = path.join(root, 'captcha');
    fs.mkdirSync(path.join(capRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(capRoot, 'config.json'), JSON.stringify({ target: {}, captcha: { provider: 'x', captcha_type: 'slider' } }), 'utf8');
    const capFiles = [path.join(capRoot, 'config.json')];
    const capMissing = inspectCaptchaAnswerLayer(capRoot, capFiles);
    if (capMissing.result.isCaptcha !== true || capMissing.problems.length !== 2) {
      throw new Error(`captcha 交付缺 adapter+solver → 应产生 2 个问题，实际 ${capMissing.problems.length}`);
    }
    fs.writeFileSync(path.join(capRoot, 'src', 'adapter.js'), 'module.exports = {};\n', 'utf8');
    fs.writeFileSync(path.join(capRoot, 'src', 'solver.js'), 'const ddddocr = require("ddddocr");\n', 'utf8');
    capFiles.push(path.join(capRoot, 'src', 'adapter.js'), path.join(capRoot, 'src', 'solver.js'));
    const capComplete = inspectCaptchaAnswerLayer(capRoot, capFiles);
    if (capComplete.problems.length > 0 || capComplete.result.solverPresent !== true) {
      throw new Error('captcha 交付含 adapter+solver → 应通过');
    }
    const plainRoot = path.join(root, 'plain');
    fs.mkdirSync(plainRoot, { recursive: true });
    fs.writeFileSync(path.join(plainRoot, 'config.json'), JSON.stringify({ TARGET_URL: 'https://example.com/api' }), 'utf8');
    const plainCheck = inspectCaptchaAnswerLayer(plainRoot, [path.join(plainRoot, 'config.json')]);
    if (plainCheck.result.isCaptcha !== false || plainCheck.problems.length > 0) {
      throw new Error('普通交付（无 captcha 配置）→ 不应触发答案层检查');
    }
    return { clean: true, cases: cases.length };
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
      console.log(`self-test passed: ${result.cases} cases`);
      process.exit(0);
    }
    const result = check(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(result));
    process.exit(result.clean ? 0 : 1);
  } catch (err) {
    console.error(err.message || String(err));
    console.error(usage());
    process.exit(1);
  }
}

module.exports = { check, extractSampleCryptoValuesFromText, inspectValidationRecord, inspectTraceCoverageDeclaration, runSelfTest };
