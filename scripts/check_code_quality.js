#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    caseDir: '',
    dir: '',
    file: '',
    maxLineLength: 180,
    maxFileLines: 500,
    maxFunctionLines: 90,
    json: false,
    markdown: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--case-dir' || a === '--case' || a === '-d') args.caseDir = nextVal('');
    else if (a === '--dir') args.dir = nextVal('');
    else if (a === '--file' || a === '-f') args.file = nextVal('');
    else if (a === '--max-line-length') args.maxLineLength = Number(nextVal(undefined) || args.maxLineLength);
    else if (a === '--max-file-lines') args.maxFileLines = Number(nextVal(undefined) || args.maxFileLines);
    else if (a === '--max-function-lines') args.maxFunctionLines = Number(nextVal(undefined) || args.maxFunctionLines);
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
  node scripts/check_code_quality.js --case-dir <project-root> --markdown
  node scripts/check_code_quality.js --dir result --json
  node scripts/check_code_quality.js --file result/src/env/install-env.js --markdown

说明：--case-dir 指项目根目录（其下应有 case/ 和 result/ 两个平级子目录），检查 result/ 下最终补环境代码是否简洁、可读、模块化，并验证中文注释为 UTF-8、无乱码、无连续问号、中文注释不含问号。`;
}

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function stat(p) { try { return fs.statSync(p); } catch { return null; } }
function rel(root, p) { return (path.relative(root, p) || '.').replace(/\\/g, '/'); }
function ext(p) { return path.extname(p).toLowerCase(); }

function walk(p, out = []) {
  if (!exists(p)) return out;
  const st = stat(p);
  if (!st) return out;
  if (st.isDirectory()) {
    let names = [];
    try { names = fs.readdirSync(p); } catch { names = []; }
    for (const name of names) walk(path.join(p, name), out);
  } else if (st.isFile()) out.push(p);
  return out;
}

function isCodeFile(p) {
  return ['.js', '.mjs', '.cjs', '.py'].includes(ext(p));
}

function shouldSkipFile(root, p) {
  const r = rel(root, p).toLowerCase();
  if (/(^|\/)(node_modules|dist|build|coverage|vendor|third_party|third-party)(\/|$)/.test(r)) return true;
  if (/(^|\/)src\/target\/(original|vendor|bundle|bundles)(\/|$)/.test(r)) return true;
  if (/(\.min\.js|bundle\.js|vendor\.js|package-lock\.json)$/i.test(r)) return true;
  return false;
}

function readUtf8Strict(file) {
  const buf = fs.readFileSync(file);
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const text = buf.toString('utf8');
  return { text: text.replace(/^\uFEFF/, ''), hasBom };
}

function hasChinese(s) {
  return /[\u4e00-\u9fff]/.test(String(s || ''));
}

function extractJsComments(text) {
  const comments = [];
  const blockRe = /\/\*[\s\S]*?\*\//g;
  let m;
  while ((m = blockRe.exec(text))) {
    for (const line of m[0].split(/\r?\n/)) comments.push(line.replace(/^\/\*+|\*+\/$/g, '').replace(/^\s*\*\s?/, '').trim());
  }
  const lineRe = /(^|\s)\/\/(.*)$/gm;
  while ((m = lineRe.exec(text))) comments.push((m[2] || '').trim());
  return comments.filter(Boolean);
}

function extractPyComments(text) {
  const comments = [];
  const lineRe = /^\s*#(.*)$/gm;
  let m;
  while ((m = lineRe.exec(text))) comments.push((m[1] || '').trim());
  comments.push(...extractPyDocstrings(text));
  return comments.filter(Boolean);
}

// 提取 Python docstring（模块/函数/类定义后的三引号块）作为职责说明注释。
// 模块 docstring 是 Python 描述职责的惯例，含中文时计入中文注释（match12 实测：
// 中文 docstring 不被识别导致"文件开头缺少中文职责注释"误报）。
function extractPyDocstrings(text) {
  const out = [];
  const re = /("""|''')(?:\\[\s\S]|(?!\1)[\s\S])*?\1/g;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(0, m.index).split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
    const prev = before.length ? before[before.length - 1].trim() : '';
    const atDocPos = !prev || /:$/.test(prev) || /^[)\]}]/.test(prev);
    if (!atDocPos) continue;
    for (const line of m[0].slice(3, -3).split(/\r?\n/)) {
      const t = line.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function extractComments(file, text) {
  return ext(file) === '.py' ? extractPyComments(text) : extractJsComments(text);
}

function firstNonEmptyLines(text, count = 8) {
  return text.split(/\r?\n/).map(x => x.trim()).filter(Boolean).slice(0, count);
}

function stripJsLine(line) {
  return line
    .replace(/\/\*.*?\*\//g, '')
    .replace(/\/\/.*$/g, '')
    .trim();
}

// 去除字符串与模板字面量内容，避免其中出现的 { } 干扰括号深度/函数长度统计
function stripJsStringAndTemplate(line) {
  let out = '';
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    const prev = i > 0 ? line[i - 1] : '';
    if ((c === '"' || c === "'") && prev !== '\\') {
      out += c;
      i += 1;
      while (i < n) {
        const cc = line[i];
        const p2 = line[i - 1];
        if (cc === c && p2 !== '\\') { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (c === '`' && prev !== '\\') {
      out += '`';
      i += 1;
      while (i < n) {
        const cc = line[i];
        const p2 = line[i - 1];
        if (cc === '`' && p2 !== '\\') { i += 1; break; }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function codeLineCount(file, lines) {
  if (ext(file) === '.py') return lines.filter(line => line.trim() && !line.trim().startsWith('#')).length;
  return lines.filter(line => stripJsLine(line)).length;
}

function maxJsBraceDepth(lines) {
  let depth = 0;
  let maxDepth = 0;
  for (const raw of lines) {
    const line = stripJsStringAndTemplate(stripJsLine(raw));
    for (const ch of line) {
      if (ch === '{') {
        depth += 1;
        if (depth > maxDepth) maxDepth = depth;
      } else if (ch === '}') {
        depth = Math.max(0, depth - 1);
      }
    }
  }
  return maxDepth;
}

// Python 逻辑嵌套深度：只统计括号外代码行的行首缩进（4 空格 = 1 层）。
// 括号内的悬挂缩进/参数对齐是续行不是嵌套；三引号字符串与注释内容行不是代码
// （match12 实测：续行对齐空格被计入导致 14 层误报，返工两轮）。
function maxPyIndentDepth(lines) {
  let maxDepth = 0;
  let paren = 0;
  let triple = null;
  let cont = false;
  for (const raw of lines) {
    if (triple) {
      const close = raw.indexOf(triple);
      if (close >= 0) {
        triple = null;
        const rest = raw.slice(close + 3);
        for (const ch of rest) {
          if (ch === '(' || ch === '[' || ch === '{') paren += 1;
          else if (ch === ')' || ch === ']' || ch === '}') paren = Math.max(0, paren - 1);
        }
      }
      continue;
    }
    if (cont && !raw.trim()) continue;
    let code = '';
    let i = 0;
    const n = raw.length;
    while (i < n) {
      const c = raw[i];
      if (c === '#') break;
      if (c === '"' || c === "'") {
        const t = raw.substr(i, 3);
        if (t === '"""' || t === "'''") {
          const end = raw.indexOf(t, i + 3);
          if (end >= 0) { i = end + 3; continue; }
          triple = t;
          i = n;
          break;
        }
        i += 1;
        while (i < n) {
          if (raw[i] === '\\') { i += 2; continue; }
          if (raw[i] === c) { i += 1; break; }
          i += 1;
        }
        continue;
      }
      code += c;
      i += 1;
    }
    const lineCont = /\\\s*$/.test(raw);
    const isContinuation = paren > 0 || cont;
    if (!isContinuation && code.trim()) {
      const spaces = raw.match(/^\s*/)[0].replace(/\t/g, '    ').length;
      maxDepth = Math.max(maxDepth, Math.floor(spaces / 4));
    }
    for (const ch of code) {
      if (ch === '(' || ch === '[' || ch === '{') paren += 1;
      else if (ch === ')' || ch === ']' || ch === '}') paren = Math.max(0, paren - 1);
    }
    cont = lineCont;
  }
  return maxDepth;
}

function inspectJsFunctions(lines, maxFunctionLines) {
  const problems = [];
  const warnings = [];
  const starters = [
    /\bfunction\s+([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/,
    /\b(?:async\s+)?(?!if\b|for\b|while\b|switch\b|catch\b|finally\b|with\b|return\b|typeof\b|new\b|delete\b|else\b|do\b|try\b|case\b)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = stripJsStringAndTemplate(stripJsLine(lines[i]));
    if (!line.includes('{')) continue;
    if (!starters.some(re => re.test(line))) continue;
    let depth = 0;
    let end = i;
    let seenOpen = false;
    for (let j = i; j < lines.length; j++) {
      const cur = stripJsStringAndTemplate(stripJsLine(lines[j]));
      for (const ch of cur) {
        if (ch === '{') { depth += 1; seenOpen = true; }
        else if (ch === '}') depth -= 1;
      }
      if (seenOpen && depth <= 0) { end = j; break; }
    }
    const size = end - i + 1;
    if (size > maxFunctionLines) problems.push(`第 ${i + 1} 行附近函数过长：${size} 行，建议拆分到 ${maxFunctionLines} 行以内。`);
    const prev = lines.slice(Math.max(0, i - 3), i).join('\n');
    if (size > 15 && !hasChinese(prev)) warnings.push(`第 ${i + 1} 行附近函数较长但前置中文说明不足，建议补充职责、输入和输出说明。`);
  }
  return { problems, warnings };
}

function inspectPyFunctions(lines, maxFunctionLines) {
  const problems = [];
  const warnings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)def\s+([A-Za-z_]\w*)\s*\(/);
    if (!m) continue;
    const baseIndent = m[1].replace(/\t/g, '    ').length;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) { end = j; continue; }
      const indent = lines[j].match(/^\s*/)[0].replace(/\t/g, '    ').length;
      if (indent <= baseIndent) break;
      end = j;
    }
    const size = end - i + 1;
    if (size > maxFunctionLines) problems.push(`第 ${i + 1} 行附近函数过长：${size} 行，建议拆分到 ${maxFunctionLines} 行以内。`);
    const prev = lines.slice(Math.max(0, i - 3), i).join('\n');
    if (size > 15 && !hasChinese(prev)) warnings.push(`第 ${i + 1} 行附近函数较长但前置中文说明不足，建议补充职责、输入和输出说明。`);
  }
  return { problems, warnings };
}

function inspectEmbeddedScriptStrings(relFile, text) {
  const problems = [];
  const warnings = [];
  const normalized = relFile.replace(/\\/g, '/');
  const fileName = path.basename(normalized).toLowerCase();
  const isEnvFile = /(^|\/)src\/env\//i.test(normalized) || /(^|\/)env\//i.test(normalized);
  if (!/\.(?:js|mjs|cjs)$/i.test(normalized)) return { problems, warnings };

  const scriptRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*(?:SCRIPT|SOURCE|CODE)[A-Za-z_$]*)\s*=\s*String\.raw`([\s\S]*?)`/g;
  let match;
  while ((match = scriptRe.exec(text))) {
    const name = match[1];
    const body = match[2] || '';
    const bodyLines = body.split(/\r?\n/).length;
    const looksLikeWebApi = /\b(?:Navigator|Document|Window|Location|History|Screen|XMLHttpRequest|HTMLCanvasElement|WebGL|navigator|document|window|createProtoChains|createNativeFunction|createGetter|createSetter|createNativeCollection)\b/.test(body);
    if (isEnvFile && (bodyLines > 40 || looksLikeWebApi)) {
      problems.push('发现大段补环境字符串 `' + name + ' = String.raw 模板字符串`（约 ' + bodyLines + ' 行）。补环境源码必须拆成真实 .js 文件，例如 browser-objects/navigator.js、document.js、fingerprint/canvas.js，再由 runtime.runFile/runFiles 注入 Context。');
    } else if (bodyLines > 80) {
      warnings.push(`发现较大的 String.raw 字符串 \`${name}\`（约 ${bodyLines} 行），请确认不是补环境 WebAPI 主实现。`);
    }
  }

  if (isEnvFile && /^script-(?:core|browser|.*objects|.*env).*\.js$/i.test(fileName) && /String\.raw`/.test(text)) {
    problems.push('发现 script-*.js 聚合字符串补环境文件。补环境交付应使用真实模块文件，不应把主要 WebAPI 放入 script-core.js 或 script-browser-objects.js。');
  }
  if (isEnvFile && /\b[A-Z][A-Z0-9_]*SCRIPT\b[\s\S]{0,200}\.join\(\s*['"]\\n['"]\s*\)/.test(text)) {
    problems.push('发现把多个 *_SCRIPT 字符串 join 后执行的补环境聚合方式。请改为 runtime.runFiles([...]) 按真实文件注入。');
  }
  if (isEnvFile && /module\.exports\s*=\s*\{[\s\S]{0,300}\b[A-Z][A-Z0-9_]*SCRIPT\b/.test(text)) {
    warnings.push('发现导出 *_SCRIPT 字符串。除极小 bootstrap 外，补环境实现应导出安装函数或通过真实文件加载。');
  }
  return { problems, warnings };
}

const WEBAPI_DOMAIN_PATTERNS = [
  ['window/global', /\b(?:window|globalThis|self|top|parent|frames|innerWidth|outerWidth|devicePixelRatio)\b/],
  ['navigator', /\b(?:navigator|Navigator|PluginArray|MimeTypeArray|permissions|sendBeacon|hardwareConcurrency|webdriver|mimeTypes|plugins)\b/],
  ['document/dom', /\b(?:document|Document|HTMLDocument|Element|HTMLElement|createElement|createTextNode|currentScript|DOMRect|MutationObserver|HTMLCollection|NodeList)\b/],
  ['location/history', /\b(?:location|Location|history|History|pushState|replaceState)\b/],
  ['screen', /\b(?:screen|Screen|availWidth|availHeight|colorDepth|pixelDepth)\b/],
  ['storage/cookie', /\b(?:localStorage|sessionStorage|Storage|cookie|Cookie|document\.cookie)\b/],
  ['network', /\b(?:XMLHttpRequest|fetch|Request|Response|Headers|sendBeacon|open\s*\(|setRequestHeader|readyState)\b/],
  ['canvas', /\b(?:HTMLCanvasElement|CanvasRenderingContext2D|toDataURL|getImageData|measureText|canvas)\b/],
  ['webgl', /\b(?:WebGLRenderingContext|WebGL2RenderingContext|WebGLShaderPrecisionFormat|getParameter|readPixels|getSupportedExtensions|webgl)\b/],
  ['audio', /\b(?:AudioContext|OfflineAudioContext|AudioBuffer|HTMLAudioElement|getChannelData|startRendering|audio)\b/],
  ['performance/timing', /\b(?:performance|Performance|PerformanceNavigationTiming|timeOrigin|navigationStart|requestAnimationFrame)\b/],
  ['events', /\b(?:EventTarget|Event|MouseEvent|KeyboardEvent|CustomEvent|addEventListener|dispatchEvent|isTrusted)\b/],
  ['worker/wasm/message', /\b(?:Worker|postMessage|MessageChannel|MessagePort|WebAssembly|BroadcastChannel)\b/],
];

function detectWebApiDomains(text) {
  const found = [];
  for (const [name, pattern] of WEBAPI_DOMAIN_PATTERNS) {
    if (pattern.test(text)) found.push(name);
  }
  return found;
}

function isEnvModulePath(relFile) {
  return /(^|\/)src\/(?:env|node-runtime\/env)\//i.test(relFile) || /(^|\/)env\//i.test(relFile);
}

// 补环境主体域：env 模块 / signer / probe / runtime-runner 等文件。
// Object.assign 堆叠规则只对这些文件生效——普通 HTTP 客户端（src/request/ 等）合并
// headers/options 时用 Object.assign 是正常写法，不应被误报为补环境堆叠。
function isEnvPatchDomain(relFile) {
  const normalized = relFile.replace(/\\/g, '/');
  return isEnvModulePath(normalized)
    || /(^|\/)src\/signer\//i.test(normalized)
    || /(^|\/)[^/]*(?:probe|diagnostic|runtime-runner|runtime_probe|runtime-probe)[^/]*\.(?:js|mjs|cjs)$/i.test(normalized);
}

function inspectWebApiModuleBoundary(relFile, text, lines, args) {
  const problems = [];
  const warnings = [];
  const normalized = relFile.replace(/\\/g, '/');
  if (!/\.(?:js|mjs|cjs)$/i.test(normalized)) return { problems, warnings };

  const domains = detectWebApiDomains(text);
  if (!domains.length) return { problems, warnings };

  const envModule = isEnvModulePath(normalized);
  const orchestrationDir = /(^|\/)src\/(?:signer|request|resources)\//i.test(normalized);
  const signerFile = /(^|\/)src\/signer\//i.test(normalized);
  const probeLikeFile = /(^|\/)[^/]*(?:probe|diagnostic|runtime-runner|runtime_probe|runtime-probe)[^/]*\.(?:js|mjs|cjs)$/i.test(normalized);
  const codeLines = codeLineCount(normalized, lines);
  const implementationLike = /\b(?:installBrowserEnv|install[A-Z][\w$]*Env|create[A-Z][\w$]*(?:Environment|Constructors?|Env)|createNativeHelpers|defineValue\s*\(|defineGetter\s*\(|defineAccessor\s*\(|Object\.defineProperty|Object\.defineProperties|nativeApi\.fn|nativeApi\.getter|HTMLCanvasElement|WebGLRenderingContext|XMLHttpRequest)\b/.test(text);
  const domainText = domains.join('、');

  if (signerFile && domains.length >= 3 && implementationLike) {
    problems.push(`src/signer 文件承载了 ${domains.length} 类 WebAPI 补环境主体（${domainText}）。signer 只允许做入口编排、调用目标 signer 和整理输出；请把 WebAPI 安装逻辑拆到 src/env/ 或 src/node-runtime/env/ 下的真实模块。`);
  }

  if (probeLikeFile && !envModule && domains.length >= 4 && codeLines > 180 && implementationLike) {
    problems.push(`probe / runtime 入口文件承载了 ${domains.length} 类 WebAPI 补环境主体（${domainText}）。probe 只能是薄入口，建议少于 150 行；请拆分为 browser-objects、fingerprint、network、bootstrap 等模块。`);
  }

  if (!envModule && domains.length >= 5 && codeLines > args.maxFileLines && implementationLike) {
    problems.push(`单个非 env 文件同时实现 ${domains.length} 类 WebAPI 且超过 ${args.maxFileLines} 行（${domainText}），属于补环境主体堆叠。请先规划目录并拆分模块后再继续验证。`);
  }

  if (orchestrationDir && domains.length >= 2 && codeLines > 240 && implementationLike && !signerFile) {
    warnings.push(`编排目录文件包含多类 WebAPI 实现迹象（${domainText}）。请确认它只做请求、资源或摘要编排；WebAPI 主体必须放入 src/env/ 或 src/node-runtime/env/。`);
  }

  return { problems, warnings };
}

function inspectProjectStructure(root, files) {
  const problems = [];
  const warnings = [];
  const codeFiles = files.filter(isCodeFile);
  const fileEntries = codeFiles.map(filePath => {
    let text = '';
    try { text = readUtf8Strict(filePath).text; } catch { text = ''; }
    return { filePath, relFile: rel(root, filePath), text };
  });

  const envEntries = fileEntries.filter(entry => /(^|\/)src\/env\//i.test(entry.relFile));
  const embeddedEnvScripts = envEntries.filter(entry => /String\.raw`/.test(entry.text) && /\b(?:Navigator|Document|Window|XMLHttpRequest|HTMLCanvasElement|WebGL|navigator|document|window)\b/.test(entry.text));
  if (embeddedEnvScripts.length) {
    problems.push('补环境 WebAPI 仍以 String.raw 聚合字符串实现：' + embeddedEnvScripts.map(entry => entry.relFile).join('、') + '。请拆分为真实模块文件并用 runtime.runFile/runFiles 加载。');
  }

  const hasBrowserObjectModule = envEntries.some(entry => /(^|\/)src\/env\/browser-objects\/[^/]+\.js$/i.test(entry.relFile));
  const touchesBrowserObjects = envEntries.some(entry => /\b(?:navigator|document|window|location|screen|XMLHttpRequest|history|storage)\b/i.test(entry.text));
  if (touchesBrowserObjects && !hasBrowserObjectModule) {
    problems.push('补了浏览器对象但未发现 src/env/browser-objects/*.js 模块。请至少按 navigator.js、document.js、window.js 等职责拆分。');
  }

  const hasRunFiles = fileEntries.some(entry => /\brunFiles\s*\(|\brunFile\s*\(/.test(entry.text));
  if (embeddedEnvScripts.length && !hasRunFiles) {
    warnings.push('未发现 runtime.runFile/runFiles 文件化加载入口。建议 runtime 提供按文件注入 Context 的能力。');
  }
  return { problems, warnings };
}

function inspectFile(root, file, args) {
  const relFile = rel(root, file);
  const problems = [];
  const warnings = [];
  const { text, hasBom } = readUtf8Strict(file);
  const lines = text.split(/\r?\n/);
  const comments = extractComments(file, text);
  const chineseComments = comments.filter(hasChinese);
  const codeLines = codeLineCount(file, lines);
  const embeddedScriptCheck = inspectEmbeddedScriptStrings(relFile, text);
  problems.push(...embeddedScriptCheck.problems);
  warnings.push(...embeddedScriptCheck.warnings);
  const webApiBoundaryCheck = inspectWebApiModuleBoundary(relFile, text, lines, args);
  problems.push(...webApiBoundaryCheck.problems);
  warnings.push(...webApiBoundaryCheck.warnings);

  if (hasBom) problems.push('文件带 UTF-8 BOM，建议使用无 BOM UTF-8。');
  if (/\uFFFD/.test(text)) problems.push('文件包含替换字符，疑似 UTF-8 解码或写入异常。');
  if (/\?{6,}/.test(text)) problems.push('文件包含连续问号，疑似中文编码问题。');

  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    if (hasChinese(c) && /\?{2,}/.test(c)) problems.push(`中文注释包含连续问号（疑似乱码或 URL 截断）：第 ${i + 1} 条注释“${c.slice(0, 60)}”。`);
    if (/\uFFFD|\?{3,}/.test(c)) problems.push(`注释疑似乱码：第 ${i + 1} 条注释“${c.slice(0, 60)}”。`);
  }

  const header = firstNonEmptyLines(text, 8).join('\n');
  // Python 的中文 docstring 同样是合格的文件头职责说明
  const headerCommentRe = ext(file) === '.py' ? /^\s*(#|"""|''')/m : /^\s*(\/\/|\/\*|\*|#)/m;
  if (!hasChinese(header) || !headerCommentRe.test(header)) {
    warnings.push('文件开头缺少中文职责注释，建议在文件顶部说明模块用途。');
  }

  if (codeLines > 20 && chineseComments.length === 0) warnings.push('代码超过 20 行但没有中文注释，建议补充关键逻辑说明。');
  if (codeLines > 80 && chineseComments.length < Math.ceil(codeLines / 120)) {
    warnings.push(`中文注释过少：代码约 ${codeLines} 行，中文注释 ${chineseComments.length} 条，建议补充。`);
  }

  if (lines.length > args.maxFileLines) problems.push(`文件过大：${lines.length} 行，建议拆分到 ${args.maxFileLines} 行以内。`);
  lines.forEach((line, idx) => {
    if (line.length > args.maxLineLength) problems.push(`第 ${idx + 1} 行过长：${line.length} 字符，建议拆分到 ${args.maxLineLength} 字符以内。`);
    if (line.length > 320) problems.push(`第 ${idx + 1} 行疑似压缩或堆叠代码。`);
  });

  const semicolonDense = lines.filter(line => (line.match(/;/g) || []).length >= 6);
  if (semicolonDense.length) problems.push(`发现 ${semicolonDense.length} 行包含大量分号，疑似压缩或多语句堆叠。`);

  const denseLineProblems = [];
  lines.forEach((rawLine, idx) => {
    const line = stripJsLine(rawLine);
    if (!line) return;
    const lineNo = idx + 1;
    const defineCount = (line.match(/\b(?:Object\.defineProperty|Object\.defineProperties|defineValue|defineNativeValue|defineNativeGetter|defineNativeSetter|defineNativeAccessor)\s*\(/g) || []).length;
    if (defineCount >= 2) {
      denseLineProblems.push(`第 ${lineNo} 行同时包含 ${defineCount} 个属性定义调用，应拆成多行并补充 descriptor 说明。`);
    }
    if (/(?:Object\.defineProperty|Object\.defineProperties)\s*\([^;]+\{[^{}\n]*(?:value|get|set|writable|enumerable|configurable)[^{}\n]*\}[^;]*;?$/.test(line) && line.length > 110) {
      denseLineProblems.push(`第 ${lineNo} 行把属性描述符压在一行，建议展开 value/get/set/writable/enumerable/configurable。`);
    }
    if (isEnvPatchDomain(relFile) && /\bObject\.assign\s*\([^;]*\{.*\{.*\}/.test(line)) {
      denseLineProblems.push(`第 ${lineNo} 行疑似用 Object.assign 堆叠对象和方法，补环境代码应拆为 createProtoChains 与 defineProperty。`);
    }
    if (/\b(?:ctx|window|globalThis|globalObject|self)\s*(?:\.|\[).*=.*\{.*(?:function\b|=>|\b[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{)/.test(line)) {
      denseLineProblems.push(`第 ${lineNo} 行把全局 WebAPI 对象、方法或函数堆在一行，建议拆成模块化安装函数。`);
    }
    if (/\b(?:if|for|while|try|catch|finally)\b[^{;\n]*\{[^{}\n]*;[^{}\n]*\}/.test(line) && line.length > 120) {
      denseLineProblems.push(`第 ${lineNo} 行存在较长的单行控制流代码块，建议展开为多行。`);
    }
    if (/\bfunction\b[^{;\n]*\{[^{}\n]*;[^{}\n]*\}/.test(line) && line.length > 120) {
      denseLineProblems.push(`第 ${lineNo} 行存在单行函数体，建议提取为具名函数并展开实现。`);
    }
  });
  if (denseLineProblems.length) problems.push(...denseLineProblems.slice(0, 30));
  if (denseLineProblems.length > 30) problems.push(`还有 ${denseLineProblems.length - 30} 个疑似单行堆叠问题未逐条展示，请先格式化源码后重新检查。`);

  if (/\bdebugger\s*;/.test(text)) problems.push('存在 debugger 语句，最终代码不得保留调试断点。');
  if (/TODO|FIXME|临时|随便|测试用|先这样|debug/i.test(text)) warnings.push('发现 TODO/FIXME/临时/调试类标记，交付前建议清理或改为正式说明。');
  if (/\b(?:var\s+[a-z]\b|function\s+[a-z]\s*\(|const\s+[a-z]\s*=|let\s+[a-z]\s*=)/.test(text)) warnings.push('发现过短变量或函数名，建议使用表达业务含义的命名。');

  const depth = ext(file) === '.py' ? maxPyIndentDepth(lines) : maxJsBraceDepth(lines);
  if (depth > 8) problems.push(`嵌套层级过深：最大层级 ${depth}，建议拆分函数或提前返回。`);
  else if (depth > 6) warnings.push(`嵌套层级偏深：最大层级 ${depth}，建议优化结构。`);

  const funcs = ext(file) === '.py' ? inspectPyFunctions(lines, args.maxFunctionLines) : inspectJsFunctions(lines, args.maxFunctionLines);
  problems.push(...funcs.problems);
  warnings.push(...funcs.warnings);

  const anonymousCount = (text.match(/\bfunction\s*\(/g) || []).length + (text.match(/=>\s*\{/g) || []).length;
  if (anonymousCount > 8) warnings.push(`匿名函数较多：${anonymousCount} 个，建议提取为具名函数提升可读性。`);

  return {
    file: relFile,
    clean: problems.length === 0,
    lines: lines.length,
    codeLines,
    chineseCommentCount: chineseComments.length,
    maxDepth: depth,
    problems,
    warnings,
  };
}

function check(args) {
  const caseDirMode = !args.file && !args.dir;
  const root = args.file
    ? path.resolve(path.dirname(args.file))
    : args.dir
      ? path.resolve(args.dir)
      : path.join(path.resolve(args.caseDir || '.'), 'result');
  const files = args.file ? [path.resolve(args.file)] : walk(root).filter(p => isCodeFile(p) && !shouldSkipFile(root, p));
  const problems = [];
  const warnings = [];
  if (!files.length) {
    // --case-dir 模式且 result/ 不存在：这是"不适用"而非代码质量失败
    // （如对 skill 源码仓库执行，或用户项目尚未生成 result/）
    if (caseDirMode && !exists(root)) {
      return {
        root,
        clean: true,
        notApplicable: true,
        notApplicableReason: `--case-dir 模式的检查目标是 <project-root>/result，但该目录不存在：${root}。这不是代码质量失败：若目标是 skill 源码仓库或任意目录，请改用 --dir <目录> / --file <文件> 检查；若是用户项目，请先生成 result/ 最终代码再检查。`,
        filesChecked: 0,
        limits: {
          maxLineLength: args.maxLineLength,
          maxFileLines: args.maxFileLines,
          maxFunctionLines: args.maxFunctionLines,
        },
        problems,
        warnings,
        fileResults: [],
      };
    }
    problems.push(`未找到可检查的最终代码文件：${root}`);
  }
  const fileResults = files.map(f => inspectFile(root, f, args));
  for (const r of fileResults) {
    for (const p of r.problems) problems.push(`${r.file}: ${p}`);
    for (const w of r.warnings) warnings.push(`${r.file}: ${w}`);
  }
  const structure = inspectProjectStructure(root, files);
  for (const p of structure.problems) problems.push(p);
  for (const w of structure.warnings) warnings.push(w);
  return {
    root,
    clean: problems.length === 0,
    filesChecked: fileResults.length,
    limits: {
      maxLineLength: args.maxLineLength,
      maxFileLines: args.maxFileLines,
      maxFunctionLines: args.maxFunctionLines,
    },
    problems,
    warnings,
    fileResults,
  };
}

function renderMarkdown(result) {
  if (result.notApplicable) {
    return ['# 补环境代码质量检查', '', `检查范围：${result.root}`, '', `> ${result.notApplicableReason}`, ''].join('\n') + '\n';
  }
  const lines = [
    '# 补环境代码质量检查结果',
    '',
    `检查范围：${result.root}`,
    `是否通过：${result.clean ? '是' : '否'}`,
    `检查文件数：${result.filesChecked}`,
    '',
    '## 质量规则',
    `- 单行长度上限：${result.limits.maxLineLength}`,
    `- 单文件行数上限：${result.limits.maxFileLines}`,
    `- 单函数行数上限：${result.limits.maxFunctionLines}`,
    '- 建议有中文职责注释（# 注释或 docstring），中文注释不得包含连续问号或乱码。',
    '- 禁止压缩代码、过度堆叠语句、调试断点和临时测试标记。',
    '- signer / probe / runtime 入口不得承载 navigator、document、canvas、webgl、performance 等多域 WebAPI 补环境主体。',
    '- 补环境不得以大段 String.raw / *_SCRIPT 字符串作为主要交付形态，必须拆成真实文件模块并通过 runFile/runFiles 注入。',
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
  lines.push('## 文件摘要');
  for (const f of result.fileResults) {
    lines.push(`- ${f.file}：${f.clean ? '通过' : '失败'}，总行数 ${f.lines}，代码行 ${f.codeLines}，中文注释 ${f.chineseCommentCount}，最大嵌套 ${f.maxDepth}`);
  }
  if (!result.fileResults.length) lines.push('- 无');
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) { console.log(usage()); process.exit(0); }
    const result = check(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(result));
    process.exit(result.notApplicable || result.clean ? 0 : 1);
  } catch (err) {
    console.error(err.message || String(err));
    console.error(usage());
    process.exit(1);
  }
}

module.exports = { check, inspectFile, extractComments, inspectEmbeddedScriptStrings, inspectWebApiModuleBoundary, inspectProjectStructure };
