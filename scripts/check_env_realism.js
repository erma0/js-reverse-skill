#!/usr/bin/env node
// 移植自 xbsReverseSkill/web-js-env-patcher（2026-08-06），可能需要适配本 skill 的路径与资源；详见 references/env/ 对应文档。
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./lib/paths');

function parseArgs(argv) {
  const args = {
    caseDir: '',
    file: '',
    requireDocumentAll: false,
    requireRuyiTrace: false,
    requireFingerprintFixture: false,
    fingerprintFixture: '',
    json: false,
    markdown: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = argv[++i] || '';
    else if (a === '--file' || a === '-f') args.file = argv[++i] || '';
    else if (a === '--require-document-all') args.requireDocumentAll = true;
    else if (a === '--require-ruyitrace') args.requireRuyiTrace = true;
    else if (a === '--require-fingerprint-fixture') args.requireFingerprintFixture = true;
    else if (a === '--fingerprint-fixture') args.fingerprintFixture = argv[++i] || '';
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
  node scripts/check_env_realism.js --case-dir case --markdown
  node scripts/check_env_realism.js --case-dir case --require-document-all --require-ruyitrace --require-fingerprint-fixture --json
  node scripts/check_env_realism.js --file case/result/src/env/index.js --markdown

说明：检查补环境交付代码是否体现原型链、属性描述符、访问器、函数 / 访问器 / 实例对象 toString 保护、document.all 特殊对象处理、指纹终端 API 值回放策略，以及选择 RuyiTrace 时是否沉淀 NDJSON 证据。addon、xbs 或纯 JS 实现按目标证据和运行时能力选择，不作为默认强制前置。`;
}

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function stat(p) { try { return fs.statSync(p); } catch { return null; } }
function readText(p) { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); }
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

function codeFiles(root) {
  return walk(root).filter(p => ['.js', '.mjs', '.cjs', '.py'].includes(ext(p)));
}

function has(pattern, text) { return pattern.test(text); }
function any(pattern, files) { return files.some(f => has(pattern, readText(f))); }
function matchingFiles(pattern, files, root) {
  return files.filter(f => has(pattern, readText(f))).map(f => rel(root, f));
}

function listNdjson(caseDir) {
  const dir = path.join(caseDir, 'ruyi-trace', 'logs');
  if (!exists(dir)) return [];
  return walk(dir).filter(p => p.toLowerCase().endsWith('.ndjson'));
}

function inspectRuyiTrace(caseDir, requireRuyiTrace) {
  const problems = [];
  const warnings = [];
  const ndjson = listNdjson(caseDir);
  const shouldCheck = requireRuyiTrace || ndjson.length > 0;
  const summary = path.join(caseDir, 'notes', 'ruyitrace-summary.md');
  const priority = path.join(caseDir, 'notes', 'missing-env-priority.md');
  const result = {
    required: shouldCheck,
    ndjson: ndjson.map(p => rel(caseDir, p)),
    summary: exists(summary) ? rel(caseDir, summary) : '',
    priority: exists(priority) ? rel(caseDir, priority) : '',
  };
  if (!shouldCheck) return { result, problems, warnings };
  if (!ndjson.length) problems.push('已要求 RuyiTrace 优先诊断，但 case/ruyi-trace/logs/ 下未找到 NDJSON 日志。');
  if (!exists(summary)) problems.push('已要求 RuyiTrace 优先诊断，但未找到 notes/ruyitrace-summary.md；应先运行 import_ruyitrace_log.js。');
  else {
    const text = readText(summary);
    if (!/API|api|调用栈|stack|类别统计|RuyiTrace/i.test(text)) warnings.push('ruyitrace-summary.md 内容较弱，建议包含 API 统计、stack.file 和环境模块分类。');
  }
  if (!exists(priority)) problems.push('已选择 / 提供 RuyiTrace 日志，但未找到 notes/missing-env-priority.md；补环境前应把 NDJSON 命中的 api、stack.file、line、col 和补齐优先级写入该文件。');
  else {
    const text = readText(priority);
    if (!/RuyiTrace|NDJSON|api|stack\.file|line|col|证据/.test(text)) {
      problems.push('missing-env-priority.md 未体现 RuyiTrace/NDJSON 证据、api 或 stack.file/line/col；不能证明补环境阶段持续参考了 trace 日志。');
    }
  }
  return { result, problems, warnings };
}

function readJsonSafe(file) {
  try { return JSON.parse(readText(file)); } catch (err) { return { __error: err.message || String(err) }; }
}

function countArray(v) { return Array.isArray(v) ? v.length : 0; }

function fingerprintFixturePath(caseDir, explicit) {
  if (explicit) return path.resolve(explicit);
  const candidates = [
    path.join(caseDir, 'fixtures', 'fingerprint.fixture.json'),
    path.join(caseDir, 'fixtures', 'sample.fixture.json'),
  ];
  return candidates.find(exists) || candidates[0];
}

function inspectFingerprint(caseDir, files, args) {
  const problems = [];
  const warnings = [];
  const allText = files.map(f => readText(f)).join('\n');
  const terminalApiMentioned = /toDataURL|getImageData|measureText|getParameter|getSupportedExtensions|getShaderPrecisionFormat|readPixels|getBoundingClientRect|offsetWidth|offsetHeight|requestAdapter|OfflineAudioContext/.test(allText);
  const valueReplayMentioned = /fingerprint|回放|replay|fixture|findReplay|installFingerprintValueReplay|fingerprint\.fixture/i.test(allText);
  const badRenderLib = /\b(require|import)\s*\(?\s*['"](?:canvas|node-canvas|gl|headless-gl)['"]|from\s+['"](?:canvas|node-canvas|gl|headless-gl)['"]/i.test(allText);
  const automationForFingerprint = /\b(playwright|puppeteer|selenium|cloakbrowser|ruyipage|page\.goto|browser\.launch|chromium\.launch)\b/i.test(allText);
  const fixtureFile = fingerprintFixturePath(caseDir, args.fingerprintFixture);
  let fixtureExists = exists(fixtureFile);
  let counts = {};

  if (fixtureExists) {
    const raw = readJsonSafe(fixtureFile);
    if (raw.__error) {
      problems.push(`指纹 fixture 解析失败：${raw.__error}`);
    } else {
      const fp = raw.fingerprint && typeof raw.fingerprint === 'object' ? raw.fingerprint : raw;
      counts = {
        canvas: countArray(fp.canvas && fp.canvas.toDataURL) + countArray(fp.canvas && fp.canvas.measureText) + countArray(fp.canvas && fp.canvas.getImageData) + countArray(fp.canvas && fp.canvas.toBlob),
        webgl: countArray(fp.webgl && fp.webgl.getParameter) + countArray(fp.webgl && fp.webgl.getShaderPrecisionFormat) + countArray(fp.webgl && fp.webgl.readPixels) + (fp.webgl && fp.webgl.getSupportedExtensions ? 1 : 0),
        webgpu: countArray(fp.webgpu && fp.webgpu.requestAdapter),
        audio: countArray(fp.audio && fp.audio.startRendering) + countArray(fp.audio && fp.audio.getChannelData),
        domGeometry: countArray(fp.domGeometry && fp.domGeometry.getBoundingClientRect) + countArray(fp.domGeometry && fp.domGeometry.offset),
      };
    }
  }

  if (badRenderLib) problems.push('发现 node-canvas / headless-gl 等渲染库依赖；指纹补环境应优先真实浏览器采样值回放，不要在 Node.js 中强行模拟渲染管线。');
  if (automationForFingerprint) problems.push('补环境源码疑似包含浏览器自动化库或 page.goto / browser.launch；自动化只能用于前置取证采样，不能进入最终 env。');
  if ((args.requireFingerprintFixture || terminalApiMentioned) && !fixtureExists) {
    problems.push(`已涉及或要求指纹终端 API 值回放，但未找到指纹 fixture：${fixtureFile}`);
  }
  if (terminalApiMentioned && !valueReplayMentioned) {
    warnings.push('源码涉及指纹终端 API，但未明显体现 fingerprint fixture / replay；请确认不是静默伪造默认值。');
  }
  if (args.requireFingerprintFixture && fixtureExists && Object.values(counts).reduce((a, b) => a + b, 0) === 0) {
    problems.push('已要求指纹 fixture，但未发现 Canvas / WebGL / WebGPU / Audio / DOM 几何终端 API 采样值。');
  }

  return {
    result: {
      required: !!args.requireFingerprintFixture || terminalApiMentioned,
      fixture: fixtureExists ? rel(caseDir, fixtureFile) : '',
      terminalApiMentioned,
      valueReplayMentioned,
      badRenderLib,
      automationForFingerprint,
      counts,
    },
    problems,
    warnings,
  };
}

function check(args) {
  if (!args.caseDir && !args.file) throw new Error('必须提供 --case-dir 或 --file');
  const caseDir = args.caseDir ? paths.resolveCaseDir(args.caseDir) : path.resolve(path.dirname(args.file), '..', '..');
  const root = args.file ? path.dirname(path.resolve(args.file)) : paths.resolveResultDir(caseDir);
  const files = args.file ? [path.resolve(args.file)] : codeFiles(root);
  const allText = files.map(f => readText(f)).join('\n');
  const problems = [];
  const warnings = [];

  if (!files.length) problems.push(`未找到可检查的补环境源码文件：${root}`);

  const checks = {
    descriptors: any(/Object\.definePropert(?:y|ies)\s*\(/, files),
    prototypeChain: any(/Object\.setPrototypeOf\s*\(|Object\.create\s*\([^\n;]*\.prototype|createProtoChains\s*\(/, files),
    functionToString: any(/NativeProtect|Function\.prototype\.toString|createNativeFunction\s*\(|createNativeConstructor\s*\(|markNativeFunction\s*\(|setNativeFunc\s*\(/, files),
    accessorToString: any(/createGetter\s*\(|createSetter\s*\(|createNativeGetter\s*\(|createNativeSetter\s*\(|defineNativeGetter\s*\(|defineNativeSetter\s*\(|defineNativeAccessor\s*\(|setNativeFunc\s*\([^\n]*(get|set)\s+/i, files),
    instanceToString: any(/setObjFunc\s*\(|markObjectToString\s*\(|Symbol\.toStringTag|createNativeObject\s*\(|createProtoChains\s*\(/, files),
    documentAllExact: any(/(?:createUndetectable\s*\(|xbs\s*\.\s*dom\s*\.\s*createDocument\s*\(|\bdom\s*\.\s*createDocument\s*\()/, files),
    documentAllMentioned: /document\.all|['"]all['"]/.test(allText),
    fingerprintValueReplay: any(/installFingerprintValueReplay|findReplay|fingerprint\.fixture|指纹.*回放|value replay/i, files),
  };

  if (!checks.descriptors) problems.push('未发现 Object.defineProperty / defineProperties；补环境不能只用普通赋值，必须显式属性描述符。');
  if (!checks.prototypeChain) problems.push('未发现 Object.create(...prototype) / Object.setPrototypeOf / createProtoChains；需要按规则补构造函数和原型链。');
  if (!checks.functionToString) problems.push('未发现函数 toString 保护（NativeProtect / createNativeFunction / markNativeFunction 等）。');
  if (!checks.accessorToString) problems.push('未发现访问器 getter/setter 的 toString 保护（createGetter/createSetter/defineNativeGetter/defineNativeSetter 等）。');
  if (!checks.instanceToString) problems.push('未发现实例对象 Object.prototype.toString 保护（Symbol.toStringTag / setObjFunc / createNativeObject 等）。');
  if (args.requireDocumentAll && !checks.documentAllExact) problems.push('本 case 要求 document.all，但未发现可表达 HTMLDDA 语义的 createDocument 或 createUndetectable 实现；document.all 不应仅用普通对象或 undefined 近似。');
  if (!args.requireDocumentAll && checks.documentAllMentioned && !checks.documentAllExact) warnings.push('源码提到 document.all 但未发现可表达 HTMLDDA 语义的 createDocument 或 createUndetectable 实现；如目标确实检测该行为，应选择具备对应能力的运行时。');

  const ruyi = inspectRuyiTrace(caseDir, args.requireRuyiTrace);
  problems.push(...ruyi.problems);
  warnings.push(...ruyi.warnings);
  const fingerprint = inspectFingerprint(caseDir, files, args);
  problems.push(...fingerprint.problems);
  warnings.push(...fingerprint.warnings);

  return {
    caseDir,
    checkedRoot: root,
    clean: problems.length === 0,
    checks,
    matching: {
      descriptors: matchingFiles(/Object\.definePropert(?:y|ies)\s*\(/, files, caseDir),
      prototypeChain: matchingFiles(/Object\.setPrototypeOf\s*\(|Object\.create\s*\([^\n;]*\.prototype|createProtoChains\s*\(/, files, caseDir),
      functionToString: matchingFiles(/NativeProtect|Function\.prototype\.toString|createNativeFunction\s*\(|createNativeConstructor\s*\(|markNativeFunction\s*\(|setNativeFunc\s*\(/, files, caseDir),
      accessorToString: matchingFiles(/createGetter\s*\(|createSetter\s*\(|createNativeGetter\s*\(|createNativeSetter\s*\(|defineNativeGetter\s*\(|defineNativeSetter\s*\(|defineNativeAccessor\s*\(|setNativeFunc\s*\([^\n]*(get|set)\s+/i, files, caseDir),
      instanceToString: matchingFiles(/setObjFunc\s*\(|markObjectToString\s*\(|Symbol\.toStringTag|createNativeObject\s*\(|createProtoChains\s*\(/, files, caseDir),
      documentAllExact: matchingFiles(/(?:createUndetectable\s*\(|xbs\s*\.\s*dom\s*\.\s*createDocument\s*\(|\bdom\s*\.\s*createDocument\s*\()/, files, caseDir),
      fingerprintValueReplay: matchingFiles(/installFingerprintValueReplay|findReplay|fingerprint\.fixture|指纹.*回放|value replay/i, files, caseDir),
    },
    ruyiTrace: ruyi.result,
    fingerprint: fingerprint.result,
    problems,
    warnings,
    files: files.map(f => rel(caseDir, f)),
  };
}

function renderMarkdown(result) {
  const lines = [
    '# 补环境真实性与 RuyiTrace 证据检查',
    '',
    `case 目录：${result.caseDir}`,
    `检查范围：${result.checkedRoot}`,
    `是否通过：${result.clean ? '是' : '否'}`,
    '',
    '## 真实性检查项',
    `- 属性描述符：${result.checks.descriptors ? '通过' : '缺失'}`,
    `- 原型链 / 构造函数：${result.checks.prototypeChain ? '通过' : '缺失'}`,
    `- 函数 toString 保护：${result.checks.functionToString ? '通过' : '缺失'}`,
    `- 访问器 toString 保护：${result.checks.accessorToString ? '通过' : '缺失'}`,
    `- 实例对象 toString 保护：${result.checks.instanceToString ? '通过' : '缺失'}`,
    `- document.all 不可检测对象：${result.checks.documentAllExact ? '已发现精确能力实现' : (result.checks.documentAllMentioned ? '提到但未精确处理' : '未涉及')}`,
    `- 指纹终端 API 值回放：${result.checks.fingerprintValueReplay ? '已体现' : (result.fingerprint.terminalApiMentioned ? '涉及指纹 API 但未明显体现回放' : '未涉及')}`,
    '',
    '## RuyiTrace 证据检查',
    `- 是否要求检查：${result.ruyiTrace.required ? '是' : '否'}`,
    `- NDJSON：${result.ruyiTrace.ndjson.length ? result.ruyiTrace.ndjson.join('、') : '未发现'}`,
    `- 摘要：${result.ruyiTrace.summary || '未发现'}`,
    `- 优先级笔记：${result.ruyiTrace.priority || '未发现'}`,
    '',
    '## 指纹值回放检查',
    `- 是否要求检查：${result.fingerprint.required ? '是' : '否'}`,
    `- 指纹 fixture：${result.fingerprint.fixture || '未发现'}`,
    `- 是否涉及终端 API：${result.fingerprint.terminalApiMentioned ? '是' : '否'}`,
    `- 是否体现 fixture / replay：${result.fingerprint.valueReplayMentioned ? '是' : '否'}`,
    `- 是否发现渲染库依赖：${result.fingerprint.badRenderLib ? '是' : '否'}`,
    `- 是否发现自动化代码：${result.fingerprint.automationForFingerprint ? '是' : '否'}`,
    `- 样本计数：${JSON.stringify(result.fingerprint.counts || {})}`,
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
  lines.push('## 检查文件');
  for (const f of result.files) lines.push(`- ${f}`);
  return lines.join('\n') + '\n';
}

try {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); process.exit(0); }
  const result = check(args);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(renderMarkdown(result));
  process.exit(result.clean ? 0 : 1);
} catch (err) {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
}
