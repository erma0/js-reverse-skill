#!/usr/bin/env node
'use strict';

// 403/风控码分层定位门禁（DIAGNOSE/REAL_VERIFY 阶段）：
// 验证记录出现 401/403/412/429 失败尝试时，校验 result/验证记录.json 的 riskLayerDiagnosis
// 双对照记录——正向（浏览器**新鲜**签名 + 纯协议客户端重放）与反向（自己签名 + 浏览器 hook 连接），
// 拦截两类实战误判：
//   1. 用过期样本 / 无对照就下「连接层风控 / 纯协议不可绕过」结论（拼多多 40002 误判）；
//   2. 注入 hook 未验证执行标记，把页面自身行为当成实验结果。
// 约定 riskLayerDiagnosis 结构（写在验证记录.json 顶层）：
// {
//   "riskLayerDiagnosis": {
//     "forwardControl":  { "signatureSource": "browser-fresh", "client": "curl_cffi/firefox",
//                          "captureToReplayMs": 4200, "httpStatus": 200 },
//     "reverseControl":  { "signatureSource": "self", "connection": "browser-hook",
//                          "hookVerified": true, "httpStatus": 403 },
//     "conclusion": "signature-content"   // signature-content|connection|session|resource|frequency|param|other
//   }
// }

const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('./lib/paths');

function usage() {
  return [
    '用法：',
    '  node scripts/check_risk_layer_diagnosis.js --case-dir <project-root> --markdown',
    '  node scripts/check_risk_layer_diagnosis.js --case-dir <project-root> --json',
    '  node scripts/check_risk_layer_diagnosis.js --self-test',
    '',
    '说明：--case-dir 指项目根目录（其下应有 case/ 和 result/ 两个平级子目录）。',
    '触发条件：验证记录 attempts 中存在 httpStatus 为 401/403/412/429 的失败尝试。',
    '未触发时直接通过；触发后要求 riskLayerDiagnosis 双对照记录齐备、新鲜、与结论自洽；',
    '文档宣称连接层/不可绕过结论而无对照支撑时失败（详见 SKILL.md 第 10 节分层定位协议）。',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { caseDir: '', markdown: false, json: false, selfTest: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--case-dir') args.caseDir = argv[++i] || '';
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--json') args.json = true;
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

function walkMd(p, out = []) {
  if (!exists(p)) return out;
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    let names = [];
    try { names = fs.readdirSync(p); } catch { names = []; }
    for (const name of names) walkMd(path.join(p, name), out);
  } else if (st.isFile() && path.extname(p).toLowerCase() === '.md') {
    out.push(p);
  }
  return out;
}

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

const RISK_STATUS = new Set([401, 403, 412, 429]);
const ALLOWED_CONCLUSIONS = new Set(['signature-content', 'connection', 'session', 'resource', 'frequency', 'param', 'other']);
// 连接层 / 不可绕过类结论措辞（出现即要求对照支撑）
const CONNECTION_CLAIM_RE = /(连接层|TLS\s*指纹拦截|TLS\s*风控|JA3?\s*指纹被|无法绕过|不可绕过|纯协议不可|纯协议无法)/;

function collectDocText(caseDir) {
  const evidenceDir = paths.resolveCaseDir(caseDir);
  const roots = [
    paths.resolveResultDir(caseDir),
    path.join(evidenceDir, 'notes'),
    path.join(evidenceDir, '阶段报告'),
  ];
  const files = [];
  for (const r of roots) {
    for (const f of walkMd(r)) if (!files.includes(f)) files.push(f);
  }
  return files.map(readText).join('\n');
}

function loadRecord(resultDir) {
  const file = path.join(resultDir, '验证记录.json');
  if (!exists(file)) return { ok: false, file };
  try {
    return { ok: true, file, data: JSON.parse(readText(file).replace(/^\uFEFF/, '')) };
  } catch (err) {
    return { ok: false, file, parseError: err.message };
  }
}

function riskFailedAttempts(record) {
  const attempts = Array.isArray(record && record.attempts) ? record.attempts : [];
  return attempts.filter(a => RISK_STATUS.has(Number(a && a.httpStatus)));
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateDiagnosis(diag) {
  const problems = [];
  const warnings = [];
  const info = { present: true, conclusion: '', forwardHttpStatus: null, reverseHttpStatus: null };
  if (!diag || typeof diag !== 'object') {
    return { problems: ['riskLayerDiagnosis 必须是对象（含 forwardControl / reverseControl / conclusion）'], warnings, info: { present: false } };
  }
  const fwd = diag.forwardControl;
  const rev = diag.reverseControl;
  if (!fwd || typeof fwd !== 'object') problems.push('缺正向对照 forwardControl（浏览器新鲜签名 + 纯协议客户端重放）');
  if (!rev || typeof rev !== 'object') problems.push('缺反向对照 reverseControl（自己签名 + 真实浏览器 hook 连接）');
  if (fwd && typeof fwd === 'object') {
    if (typeof fwd.signatureSource !== 'string' || !/browser/i.test(fwd.signatureSource)) {
      problems.push('正向对照 signatureSource 必须是浏览器生成签名（如 browser-fresh）');
    }
    if (typeof fwd.client !== 'string' || !fwd.client.trim()) {
      problems.push('正向对照缺 client（纯协议客户端，如 curl_cffi/firefox）');
    }
    if (!isNum(fwd.httpStatus)) problems.push('正向对照缺 httpStatus');
    else info.forwardHttpStatus = fwd.httpStatus;
    if (!isNum(fwd.captureToReplayMs)) {
      problems.push('正向对照缺 captureToReplayMs（采集→重放延迟）：无新鲜度记录的对照不构成结论');
    } else if (fwd.captureToReplayMs > 300000) {
      problems.push(`正向对照样本采集→重放延迟 ${fwd.captureToReplayMs}ms（>5 分钟）：内嵌时间戳的签名大概率已过期，结果不构成结论`);
    } else if (fwd.captureToReplayMs > 60000) {
      warnings.push(`正向对照采集→重放延迟 ${fwd.captureToReplayMs}ms（>60s），结论可信度减弱，建议重放更快的新鲜样本`);
    }
  }
  if (rev && typeof rev === 'object') {
    if (typeof rev.signatureSource !== 'string' || /browser/i.test(rev.signatureSource)) {
      problems.push('反向对照 signatureSource 必须是本地/自己生成的签名（如 self）');
    }
    if (rev.hookVerified !== true) {
      problems.push('反向对照 hookVerified 不为 true：注入 hook 未验证执行标记（如 window.__hookInstalled），实验结果无效');
    }
    if (!isNum(rev.httpStatus)) problems.push('反向对照缺 httpStatus');
    else info.reverseHttpStatus = rev.httpStatus;
  }
  if (typeof diag.conclusion !== 'string' || !ALLOWED_CONCLUSIONS.has(diag.conclusion)) {
    problems.push(`conclusion 必须是 ${[...ALLOWED_CONCLUSIONS].join(' / ')} 之一`);
  } else {
    info.conclusion = diag.conclusion;
    // 结论与对照自洽（拦截实战误判的核心断言）
    if (diag.conclusion === 'connection' && isNum(fwd && fwd.httpStatus) && fwd.httpStatus >= 200 && fwd.httpStatus < 300) {
      problems.push(`正向对照 HTTP ${fwd.httpStatus} 说明连接层可用，与「connection」结论矛盾——实战误判形态：过期签名重放 403 被当作连接层证据`);
    }
    if (diag.conclusion === 'signature-content' && isNum(rev && rev.httpStatus) && rev.httpStatus >= 200 && rev.httpStatus < 300) {
      problems.push(`反向对照 HTTP ${rev.httpStatus} 说明签名内容可被接受，与「signature-content」结论矛盾——问题更可能在协议客户端实现`);
    }
  }
  return { problems, warnings, info };
}

function check(args) {
  const caseDir = path.resolve(args.caseDir);
  const resultDir = paths.resolveResultDir(caseDir);
  const problems = [];
  const warnings = [];
  const result = { caseDir, triggered: false, diagnosisPresent: false, conclusion: '', connectionClaim: false, problems, warnings };

  const rec = loadRecord(resultDir);
  if (!rec.ok) {
    problems.push(rec.parseError ? `验证记录.json 解析失败：${rec.parseError}` : '缺少 result/验证记录.json，无法核对分层定位记录');
    result.clean = problems.length === 0;
    return result;
  }
  const failed = riskFailedAttempts(rec.data);
  result.triggered = failed.length > 0;
  const docText = collectDocText(caseDir);
  result.connectionClaim = CONNECTION_CLAIM_RE.test(docText);
  if (!result.triggered) {
    result.clean = true;
    return result;
  }
  const diag = rec.data.riskLayerDiagnosis;
  if (!diag) {
    warnings.push(`存在 ${failed.length} 条 401/403/412/429 失败尝试，但验证记录未记录 riskLayerDiagnosis 双对照——再次失败或要下拦截层结论前必须补齐（SKILL.md 第 10 节分层定位协议）`);
    if (result.connectionClaim) {
      problems.push('文档宣称连接层 / 不可绕过类结论，但验证记录无 riskLayerDiagnosis 双对照支撑：先完成正向对照（浏览器新鲜签名 + 纯协议客户端，记录采集→重放延迟）与反向对照（自己签名 + 浏览器 hook 连接，验证 hook 执行标记）');
    }
    result.clean = problems.length === 0;
    return result;
  }

  result.diagnosisPresent = true;
  const v = validateDiagnosis(diag);
  problems.push(...v.problems);
  warnings.push(...v.warnings);
  result.conclusion = v.info.conclusion || '';
  if (result.connectionClaim && v.info.conclusion && v.info.conclusion !== 'connection') {
    problems.push(`文档宣称连接层 / 不可绕过类结论，与 riskLayerDiagnosis.conclusion=${v.info.conclusion} 不一致：结论必须来自双对照，不得先定结论再找证据`);
  }
  result.clean = problems.length === 0;
  return result;
}

function renderMarkdown(result) {
  const lines = [
    '# 403/风控码分层定位门禁',
    '',
    `项目根目录：${result.caseDir}`,
    `是否触发：${result.triggered ? '是（存在 401/403/412/429 失败尝试）' : '否'}`,
    `- 分层定位记录（riskLayerDiagnosis）：${result.diagnosisPresent ? '已记录' : '未记录'}`,
    `- 拦截层结论：${result.conclusion || '无'}`,
    `- 文档连接层/不可绕过宣称：${result.connectionClaim ? '命中' : '未命中'}`,
    `是否通过：${result.clean ? '是' : '否'}`,
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
  return lines.join('\n') + '\n';
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-risk-layer-'));
  let casesPassed = 0;
  try {
    const mk = (name, record, docs) => {
      const dir = path.join(root, name);
      fs.mkdirSync(path.join(dir, 'result'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'result', '验证记录.json'), JSON.stringify(record), 'utf8');
      if (docs) fs.writeFileSync(path.join(dir, 'result', '最终项目总结.md'), docs, 'utf8');
      return check({ caseDir: dir, markdown: true });
    };
    const okAttempt = { timestamp: new Date().toISOString(), httpStatus: 200, responseValid: true };
    const fail403 = { timestamp: new Date().toISOString(), httpStatus: 403, responseValid: false };
    const goodDiag = {
      riskLayerDiagnosis: {
        forwardControl: { signatureSource: 'browser-fresh', client: 'curl_cffi/firefox', captureToReplayMs: 4200, httpStatus: 200 },
        reverseControl: { signatureSource: 'self', connection: 'browser-hook', hookVerified: true, httpStatus: 403 },
        conclusion: 'signature-content',
      },
    };

    let r = mk('not-triggered', { mode: 'online', attempts: [okAttempt, okAttempt] });
    if (!r.clean || r.triggered) throw new Error('无风险失败尝试应直接通过');
    casesPassed += 1;

    r = mk('missing-diag-no-claim', { mode: 'online', attempts: [fail403, okAttempt] });
    if (!r.clean || r.problems.length) throw new Error('缺对照但无连接层宣称应仅提醒不失败');
    casesPassed += 1;

    r = mk('missing-diag-with-claim', { mode: 'online', attempts: [fail403] }, '# 总结\n40002 为连接层风控，纯协议不可绕过\n');
    if (r.clean || !r.problems.length) throw new Error('连接层宣称 + 无对照必须失败');
    casesPassed += 1;

    r = mk('valid-diagnosis', { mode: 'online', attempts: [fail403, okAttempt], ...goodDiag }, '# 总结\n分层定位为签名内容层，已按探针法对齐\n');
    if (!r.clean || r.problems.length || r.warnings.length) throw new Error('齐备自洽的双对照应通过且无提醒');
    casesPassed += 1;

    r = mk('stale-forward', { mode: 'online', attempts: [fail403], riskLayerDiagnosis: { ...goodDiag.riskLayerDiagnosis, forwardControl: { ...goodDiag.riskLayerDiagnosis.forwardControl, captureToReplayMs: 400000 } } });
    if (r.clean || !r.problems.some(p => p.includes('过期') || p.includes('不构成结论'))) throw new Error('过期正向对照（>5 分钟）必须失败');
    casesPassed += 1;

    r = mk('no-freshness', { mode: 'online', attempts: [fail403], riskLayerDiagnosis: { ...goodDiag.riskLayerDiagnosis, forwardControl: { signatureSource: 'browser-fresh', client: 'curl_cffi', httpStatus: 200 } } });
    if (r.clean || !r.problems.some(p => p.includes('captureToReplayMs'))) throw new Error('缺新鲜度记录必须失败');
    casesPassed += 1;

    r = mk('hook-unverified', { mode: 'online', attempts: [fail403], riskLayerDiagnosis: { ...goodDiag.riskLayerDiagnosis, reverseControl: { signatureSource: 'self', connection: 'browser-hook', hookVerified: false, httpStatus: 403 } } });
    if (r.clean || !r.problems.some(p => p.includes('hookVerified'))) throw new Error('hook 未验证执行标记必须失败');
    casesPassed += 1;

    r = mk('connection-contradiction', { mode: 'online', attempts: [fail403], riskLayerDiagnosis: { forwardControl: { signatureSource: 'browser-fresh', client: 'curl_cffi/firefox', captureToReplayMs: 3000, httpStatus: 200 }, reverseControl: { signatureSource: 'self', connection: 'browser-hook', hookVerified: true, httpStatus: 403 }, conclusion: 'connection' } });
    if (r.clean || !r.problems.some(p => p.includes('矛盾'))) throw new Error('正向对照 200 却下 connection 结论（误判形态）必须失败');
    casesPassed += 1;

    r = mk('claim-mismatch', { mode: 'online', attempts: [fail403], ...goodDiag }, '# 总结\n结论：连接层 TLS 指纹拦截\n');
    if (r.clean || !r.problems.some(p => p.includes('不一致'))) throw new Error('文档连接层宣称与对照结论不符必须失败');
    casesPassed += 1;

    r = mk('slow-forward-warn', { mode: 'online', attempts: [fail403], riskLayerDiagnosis: { ...goodDiag.riskLayerDiagnosis, forwardControl: { ...goodDiag.riskLayerDiagnosis.forwardControl, captureToReplayMs: 90000 } } });
    if (!r.clean || !r.warnings.some(w => w.includes('60s'))) throw new Error('60s~5min 延迟应提醒不失败');
    casesPassed += 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return { cases: casesPassed };
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
    if (!args.caseDir) { console.error(usage()); process.exit(1); }
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

module.exports = { check, validateDiagnosis, runSelfTest };
