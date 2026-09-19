#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function parseArgs(argv) {
  const args = {
    skill: 'SKILL.md',
    projectDir: null,
    json: false,
    markdown: false,
    help: false,
    selfTest: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = () => {
      if (i + 1 >= argv.length || typeof argv[i + 1] !== 'string' || argv[i + 1].startsWith('-')) {
        throw new Error(`参数 ${a} 缺少值`);
      }
      i += 1;
      return argv[i];
    };
    if (a === '--skill') args.skill = nextVal();
    else if (a === '--project-dir' || a === '--root') args.projectDir = nextVal();
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--self-test') args.selfTest = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/check_skill_consistency.js --project-dir <skill-root> --markdown
  node scripts/check_skill_consistency.js --skill SKILL.md --json
  node scripts/check_skill_consistency.js --self-test

检查项：
- SKILL.md frontmatter 合规（对齐官方 skill 校验器）：仅允许 name/description/license/allowed-tools/metadata；
  name 连字符小写且 ≤64；description 无尖括号、≤1024；正文无 [TODO:] 占位行。
- description 质量：体积预算 + 禁 catchall 措辞 + 必须有边界声明（选择阶段每次请求都要付这份上下文）。
- 关键硬门禁锚点存在：GATE-0 / GATE-1 / GATE-2 / EVIDENCE_GATE / 纯协议红线 / REAL_VERIFY /
  check_evidence.js / check_final_artifact.js / 最终项目总结.md / --target-signal / TRACE_RETRY。
- SKILL.md 中引用的 references / scripts / assets（含 assets/templates）/ cases 路径真实存在。
- reference-map 若被引用，其内部相对链接同样校验。
- scripts/README.md 索引同步：每个 scripts/ 顶层脚本都被索引、表格不指向不存在
  的脚本、头部计数（总/JS/Python）与实际文件数一致（防止加脚本忘更新索引的计数漂移）。
- SKILL.md 体积预算（常驻注入区防再膨胀）；README.md 与 SKILL.md 的小程序口径、
  专题目录/实证案例/交付模板计数一致性。`;
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function isDir(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; }
}

function readText(p) {
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
}

function stripRefEdge(value) {
  let v = value.trim();
  v = v.replace(/^[`<(]+|[`>)\].,;:!?]+$/g, '');
  v = v.replace(/[`>)\].,;:!?]+$/g, '');
  return v;
}

function collectRefs(text) {
  const refs = new Set();
  const re = /\b(?:references|scripts|assets|templates|cases)\/[A-Za-z0-9_./-]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const value = stripRefEdge(raw);
    if (!value) continue;
    if (value.endsWith('/') || !/\.[A-Za-z0-9]+$/.test(value)) {
      refs.add(value.replace(/\/$/, ''));
    } else {
      refs.add(value);
    }
  }
  return Array.from(refs);
}

function walkFiles(dir) {
  if (!exists(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

// scripts/README.md 索引漂移检测：脚本文件 ↔ 索引 ↔ 头部计数 三方一致。
// 只在 scripts/ 与其 README 同时存在时生效（最小分发安装不受影响）。
function checkScriptsIndex(root) {
  const problems = [];
  const scriptsDir = path.join(root, 'scripts');
  const readmePath = path.join(scriptsDir, 'README.md');
  if (!isDir(scriptsDir) || !exists(readmePath)) return problems;

  const scriptFiles = fs.readdirSync(scriptsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(js|py)$/.test(e.name))
    .map((e) => e.name)
    .sort();
  const readme = readText(readmePath);

  for (const name of scriptFiles) {
    if (!readme.includes(`\`${name}\``)) {
      problems.push({ type: 'script-index-missing', message: `脚本未在 scripts/README.md 索引：${name}` });
    }
  }

  // 表格行 `| \`name.js\` |` 指向的脚本必须存在（防删除脚本后索引残留）
  const tabled = new Set();
  for (const m of readme.matchAll(/^\|\s*`([^`]+\.(?:js|py))`/gm)) tabled.add(m[1]);
  for (const name of tabled) {
    if (!scriptFiles.includes(name)) {
      problems.push({ type: 'script-index-stale', message: `scripts/README.md 索引指向不存在的脚本：${name}` });
    }
  }

  // 头部计数（总/JS/Python）与实际一致：防止加脚本忘更新索引头
  const countMatch = readme.match(/(\d+)\s*个可执行脚本（\s*(\d+)\s*个 JavaScript、\s*(\d+)\s*个 Python）/);
  if (countMatch) {
    const jsCount = scriptFiles.filter((n) => n.endsWith('.js')).length;
    const pyCount = scriptFiles.filter((n) => n.endsWith('.py')).length;
    const actual = [String(scriptFiles.length), String(jsCount), String(pyCount)];
    const claimed = [countMatch[1], countMatch[2], countMatch[3]];
    if (claimed.join('/') !== actual.join('/')) {
      problems.push({
        type: 'script-index-count',
        message: `scripts/README.md 头部计数失同步：宣称 ${claimed.join('/')}（总/JS/Python），实际 ${actual.join('/')}——新增或删除脚本后必须同步索引`,
      });
    }
  }
  return problems;
}

// SKILL.md 引用的「反模式 N / 规则 N」编号必须真实存在（实条或指针），
// 防止 references 层合并/删除条目后 SKILL.md 留下死编号。
function checkNumberedRefs(root, skillText) {
  const problems = [];
  const pitfallPath = path.join(root, 'references', 'workflow', 'common-pitfalls.md');
  const rulesPath = path.join(root, 'references', 'workflow', 'experience-rules.md');
  if (!exists(pitfallPath) || !exists(rulesPath)) return problems;

  const pitfall = readText(pitfallPath);
  const rules = readText(rulesPath);

  // 反模式实条编号（## 反模式 N：）+ 指针表旧编号（| N | 反模式 M |）
  const validAntis = new Set();
  for (const m of pitfall.matchAll(/^#{2,6}\s+反模式\s*0*(\d+)(?!\d)/gm)) validAntis.add(Number(m[1]));
  let inPointerTable = false;
  for (const line of pitfall.split(/\r?\n/)) {
    if (/^##\s*已合并条目指针/.test(line)) { inPointerTable = true; continue; }
    if (inPointerTable && /^##\s/.test(line)) break;
    const m = inPointerTable ? line.match(/^\|\s*0*(\d+)\s*\|\s*反模式\s*0*(\d+)(?!\d)/) : null;
    if (m) validAntis.add(Number(m[1]));
  }
  // 规则实条编号（### N. 全局编号 + 显式「规则 N」标题）+ 指针表旧编号（| N | 规则 M |）
  const validRules = new Set();
  for (const m of rules.matchAll(/^#{2,6}\s+0*(\d+)[．.、]\s/gm)) validRules.add(Number(m[1]));
  for (const m of rules.matchAll(/^#{2,6}\s+(?:经验)?规则\s*0*(\d+)(?!\d)/gm)) validRules.add(Number(m[1]));
  let inRulePointerTable = false;
  for (const line of rules.split(/\r?\n/)) {
    if (/^##\s*已合并条目指针/.test(line)) { inRulePointerTable = true; continue; }
    if (inRulePointerTable && /^##\s/.test(line)) break;
    const m = inRulePointerTable ? line.match(/^\|\s*0*(\d+)\s*\|\s*规则\s*0*(\d+)(?!\d)/) : null;
    if (m) validRules.add(Number(m[1]));
  }

  for (const m of skillText.matchAll(/反模式\s*0*(\d+)(?!\d)/g)) {
    if (!validAntis.has(Number(m[1]))) {
      problems.push({ type: 'dead-anti-pattern-ref', message: `SKILL.md 引用的 反模式 ${m[1]} 不存在（common-pitfalls.md 无实条也无指针）` });
    }
  }
  for (const m of skillText.matchAll(/(?<!反模式)规则\s*0*(\d+)(?!\d)/g)) {
    if (!validRules.has(Number(m[1]))) {
      problems.push({ type: 'dead-rule-ref', message: `SKILL.md 引用的 规则 ${m[1]} 不存在（experience-rules.md 无该编号）` });
    }
  }
  return problems;
}

// SKILL.md 是常驻注入区：体积预算防止历史遗留重新堆积（新增内容优先沉淀到 references/ 与 cases/）。
const SKILL_CHAR_BUDGET = 35000;

function lfChars(text) {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').length;
}

function checkSkillBudget(text) {
  const problems = [];
  const chars = lfChars(text);
  if (chars > SKILL_CHAR_BUDGET) {
    problems.push({
      type: 'skill-budget',
      message: `SKILL.md 体积超预算：${chars} 字 > ${SKILL_CHAR_BUDGET} 字（LF 计），超出 ${chars - SKILL_CHAR_BUDGET} 字。`
        + '本文件是常驻注入区、每加一句按激活次数付费——新经验请按第 12 节路由沉淀到 references/ 或 cases/，'
        + '正文只保留「跨题通用且不写入就会犯错」的硬规则与指针。',
    });
  }
  return problems;
}

function countDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  } catch {
    return null;
  }
}

function countFiles(dir, re) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && re.test(e.name)).length;
  } catch {
    return null;
  }
}

function countCaseFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.md$/i.test(e.name) && !['README.md', '_template.md'].includes(e.name))
      .length;
  } catch {
    return null;
  }
}

// README 与 SKILL.md 的口径/计数必须一致：口径冲突（如小程序范围）或计数漂移会让使用者按错误前提作业。
function checkReadmeConsistency(root, skillText) {
  const problems = [];
  const readmePath = path.join(root, 'README.md');
  if (!exists(readmePath)) return problems;
  const readme = readText(readmePath);

  // 小程序口径：与 SKILL.md 一致（限纯 JS 参数还原、Native/加壳除外），不得整类排除
  if (!readme.includes('小程序')) {
    problems.push({ type: 'readme-scope', message: 'README.md 未提及小程序口径（应与 SKILL.md 一致：小程序限纯 JS 参数还原）' });
  }
  for (const line of readme.split(/\r?\n/)) {
    if (line.includes('小程序') && !line.includes('纯 JS')) {
      problems.push({
        type: 'readme-scope',
        message: `README.md 小程序口径与 SKILL.md 冲突（该行缺少「纯 JS」限定）：${line.trim().slice(0, 60)}`,
      });
    }
  }

  // 计数同步：README 声称的目录/案例/模板数与实际一致
  const counts = [
    { re: /(\d+)\s*个专题目录/, actual: countDirs(path.join(root, 'references')), label: 'references 专题目录' },
    { re: /(\d+)\s*个实证案例/, actual: countCaseFiles(path.join(root, 'cases')), label: 'cases 实证案例' },
    { re: /(\d+)\s*类交付入口模板/, actual: countDirs(path.join(root, 'assets', 'templates')), label: 'templates 交付模板' },
  ];
  for (const { re, actual, label } of counts) {
    const m = readme.match(re);
    if (m && actual != null && Number(m[1]) !== actual) {
      problems.push({ type: 'readme-count', message: `README.md 计数漂移：${label} 声称 ${m[1]} 个，实际 ${actual} 个` });
    }
  }
  return problems;
}

// ── 官方 skill 规范对齐 ────────────────────────────────────────────────
// 与 skill-creator 的 quick_validate.py 逐条对齐：官方校验器在 Python 侧，
// 这里做等价实现，使其能在 CI 与无 skill-creator 的环境里跑。
const FRONTMATTER_ALLOWED_KEYS = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata']);
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
// 描述在技能选择阶段常驻：超预算说明它在列举能力而非判据（规范：Avoid exhaustive capability lists）。
const DESCRIPTION_CHAR_BUDGET = 200;
// catchall 措辞会招致无关请求（规范：catchalls that attract unrelated requests）。
const DESCRIPTION_CATCHALLS = ['各类', '各种', '所有', '任何', '等场景', '等等', '任意'];

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const keys = [];
  const values = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const km = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i]);
    if (!km) continue;
    const key = km[1];
    keys.push(key);
    if (/^[>|][-+]?$/.test(km[2].trim())) {
      const block = [];
      let j = i + 1;
      for (; j < lines.length && /^[ \t]+\S/.test(lines[j]); j += 1) block.push(lines[j].trim());
      values[key] = block.join(' ');
      i = j - 1;
    } else {
      values[key] = km[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { keys, values, body: text.slice(m[0].length) };
}

function checkFrontmatterSpec(text) {
  const problems = [];
  const fm = parseFrontmatter(text);
  if (!fm) {
    problems.push({ type: 'frontmatter', message: 'SKILL.md 缺少可解析的 YAML frontmatter（须以 --- 开头并以 --- 收尾）' });
    return problems;
  }
  const unexpected = [...new Set(fm.keys.filter((k) => !FRONTMATTER_ALLOWED_KEYS.has(k)))];
  if (unexpected.length) {
    problems.push({
      type: 'frontmatter-key',
      message: `frontmatter 含不允许的键：${unexpected.join(', ')}（官方校验器仅允许 ${[...FRONTMATTER_ALLOWED_KEYS].join(' / ')}）`,
    });
  }
  const name = (fm.values.name || '').trim();
  if (!name) {
    problems.push({ type: 'frontmatter', message: 'frontmatter 缺少 name' });
  } else if (!/^[a-z0-9-]+$/.test(name)) {
    problems.push({ type: 'skill-name', message: `name「${name}」必须是小写连字符形态（只允许小写字母、数字、连字符）` });
  } else if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) {
    problems.push({ type: 'skill-name', message: `name「${name}」不得以连字符开头/结尾或含连续连字符` });
  } else if (name.length > MAX_SKILL_NAME_LENGTH) {
    problems.push({ type: 'skill-name', message: `name 超长（${name.length} > ${MAX_SKILL_NAME_LENGTH}）` });
  }
  const desc = (fm.values.description || '').trim();
  if (!desc) {
    problems.push({ type: 'frontmatter', message: 'frontmatter 缺少 description' });
  } else {
    if (desc.startsWith('[TODO:')) problems.push({ type: 'description-todo', message: 'description 仍是未完成的 [TODO:] 占位符' });
    if (/[<>]/.test(desc)) problems.push({ type: 'description-syntax', message: 'description 不得含尖括号 < >（官方校验器会直接拒绝）' });
    if (desc.length > MAX_DESCRIPTION_LENGTH) {
      problems.push({ type: 'description-syntax', message: `description 超长（${desc.length} > ${MAX_DESCRIPTION_LENGTH}）` });
    }
  }
  let fence = null;
  for (const line of fm.body.split(/\r?\n/)) {
    const f = /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (fence === null) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence === null && /^[ ]{0,3}\[TODO:[^\n]*\][ \t]*$/.test(line)) {
      problems.push({ type: 'body-todo', message: `正文存在未完成的 [TODO:] 占位行：${line.trim().slice(0, 60)}` });
    }
  }
  return problems;
}

function checkDescriptionQuality(text) {
  const problems = [];
  const fm = parseFrontmatter(text);
  if (!fm) return problems;
  const desc = (fm.values.description || '').trim();
  if (!desc) return problems;
  if (desc.length > DESCRIPTION_CHAR_BUDGET) {
    problems.push({
      type: 'description-budget',
      message: `description 超预算：${desc.length} 字 > ${DESCRIPTION_CHAR_BUDGET} 字。`
        + '描述在选择阶段常驻、每个请求都要付一次——列举能力的清单请移到正文或 references，'
        + '描述只留「做什么 + 什么时候适用 + 边界」（skill 规范：Keep discovery cheap and precise）。',
    });
  }
  const hits = DESCRIPTION_CATCHALLS.filter((w) => desc.includes(w));
  if (hits.length) {
    problems.push({
      type: 'description-catchall',
      message: `description 含 catchall 措辞：${hits.join(' / ')}——会招致无关请求，请换成可判定的适用面`,
    });
  }
  if (!/(不用于|不适用|不处理|Do not use|Not for)/i.test(desc)) {
    problems.push({
      type: 'description-boundary',
      message: 'description 缺少边界声明（规范：Include a meaningful boundary when similar requests should not activate the skill）',
    });
  }
  return problems;
}
const REQUIRED_ANCHORS = [
  'GATE-0',
  'GATE-1',
  'GATE-2',
  'EVIDENCE_GATE',
  '纯协议红线',
  'REAL_VERIFY',
  'check_evidence.js',
  'check_final_artifact.js',
  '最终项目总结.md',
  '--target-signal',
  'TRACE_RETRY',
];

function checkSkill(skillPath, root) {
  const problems = [];
  const references = [];

  if (!exists(skillPath)) {
    return { skillPath, references, problems: [{ type: 'missing-skill', message: `SKILL.md 不存在：${skillPath}` }] };
  }

  const text = readText(skillPath);
  problems.push(...checkFrontmatterSpec(text));
  problems.push(...checkDescriptionQuality(text));

  for (const anchor of REQUIRED_ANCHORS) {
    if (!text.includes(anchor)) {
      problems.push({ type: 'missing-anchor', message: `缺少关键锚点：${anchor}` });
    }
  }

  for (const rel of collectRefs(text)) {
    references.push(rel);
    if (!exists(path.join(root, rel))) {
      problems.push({ type: 'missing-reference', message: `引用路径不存在：${rel}` });
    }
  }

  const mapRel = 'references/workflow/reference-map.md';
  let mapText = '';
  if (text.includes(mapRel)) {
    const mapPath = path.join(root, mapRel);
    if (!exists(mapPath)) {
      problems.push({ type: 'missing-reference', message: `引用路径不存在：${mapRel}` });
    } else {
      mapText = readText(mapPath);
      for (const rel of collectRefs(mapText)) {
        references.push(rel);
        if (!exists(path.join(root, rel))) {
          problems.push({ type: 'missing-reference', message: `${mapRel} 引用路径不存在：${rel}` });
        }
      }
    }
  }

  const refsDir = path.join(root, 'references');
  for (const full of walkFiles(refsDir)) {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (rel === mapRel) continue;
    if (!text.includes(rel) && !mapText.includes(rel)) {
      problems.push({ type: 'orphan-reference', message: `references 文件未在 SKILL.md 或 ${mapRel} 中路由：${rel}` });
    }
  }

  problems.push(...checkScriptsIndex(root));
  problems.push(...checkNumberedRefs(root, text));
  problems.push(...checkSkillBudget(text));
  problems.push(...checkReadmeConsistency(root, text));

  return { skillPath, references, problems };
}

function renderMarkdown(result) {
  const lines = [];
  lines.push(`# Skill 一致性检查：${result.skillPath}`);
  lines.push('');
  lines.push(`- 引用条目：${result.references.length}`);
  lines.push(`- 问题数量：${result.problems.length}`);
  lines.push('');
  if (result.problems.length === 0) {
    lines.push('[通过] 通过');
  } else {
    for (const p of result.problems) {
      lines.push(`- [未通过] ${p.message}`);
    }
  }
  return lines.join('\n');
}

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-consistency-'));
  try {
    const skill = path.join(dir, 'SKILL.md');
    fs.writeFileSync(skill, [
      '---',
      'name: test',
      'description: 网页端参数还原；不用于 App 与桌面程序',
      '---',
      '',
      'GATE-0 GATE-1 GATE-2 EVIDENCE_GATE 纯协议红线 REAL_VERIFY check_evidence.js check_final_artifact.js 最终项目总结.md --target-signal TRACE_RETRY',
      'scripts/missing.js',
    ].join('\n'));
    const result = checkSkill(skill, dir);
    assert.strictEqual(result.problems.length, 1);
    assert.strictEqual(result.problems[0].type, 'missing-reference');
    assert(result.problems[0].message.includes('scripts/missing.js'));

    // scripts/README 索引漂移：脚本未索引 + 计数失同步必须被捕获；同步良好的索引零问题
    const scriptsDir = path.join(dir, 'scripts');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'alpha.js'), '', 'utf8');
    fs.writeFileSync(path.join(scriptsDir, 'beta.py'), '', 'utf8');
    fs.writeFileSync(path.join(scriptsDir, 'README.md'), '本目录包含 5 个可执行脚本（4 个 JavaScript、1 个 Python）\n\n| `gamma.js` | 不存在 |\n', 'utf8');
    const drift = checkScriptsIndex(dir);
    const types = drift.map((p) => p.type);
    assert(types.includes('script-index-missing'), '未索引脚本应报 problem');
    assert(types.includes('script-index-stale'), '索引指向不存在脚本应报 problem');
    assert(types.includes('script-index-count'), '计数失同步应报 problem');
    fs.writeFileSync(path.join(scriptsDir, 'README.md'), '本目录包含 2 个可执行脚本（1 个 JavaScript、1 个 Python）\n\n| `alpha.js` | ok |\n| `beta.py` | ok |\n', 'utf8');
    assert.strictEqual(checkScriptsIndex(dir).length, 0, '同步索引应零问题');
    // frontmatter 规范与描述质量：违规形态必须被捕获，合规形态零问题
    const fmSkill = (fm) => ['---', fm, '---', '', 'body'].join('\n');
    assert(checkFrontmatterSpec(fmSkill('name: Bad--Name\ndescription: x')).some((p) => p.type === 'skill-name'), '连续连字符应报 skill-name');
    assert(checkFrontmatterSpec(fmSkill('name: ok-name\nfoo: bar\ndescription: x')).some((p) => p.type === 'frontmatter-key'), '多余键应报 frontmatter-key');
    assert(checkFrontmatterSpec(fmSkill('name: ok-name\ndescription: "a <b> c"')).some((p) => p.type === 'description-syntax'), '尖括号应报 description-syntax');
    assert.strictEqual(checkFrontmatterSpec(fmSkill('name: ok-name\ndescription: 不用于 App，仅处理网页端参数')).length, 0, '合规 frontmatter 应零问题');
    assert(checkFrontmatterSpec(['---', 'name: ok-name', '---', '', '[TODO: finish]'].join('\n')).some((p) => p.type === 'body-todo'), '正文 TODO 占位行应报 body-todo');
    assert(checkDescriptionQuality(fmSkill('name: ok-name\ndescription: 处理各类动态参数')).some((p) => p.type === 'description-catchall'), 'catchall 应报 description-catchall');
    assert(checkDescriptionQuality(fmSkill('name: ok-name\ndescription: 处理网页端参数')).some((p) => p.type === 'description-boundary'), '缺边界应报 description-boundary');
    assert(checkDescriptionQuality(fmSkill('name: ok-name\ndescription: ' + '补'.repeat(300) + '不用于 App')).some((p) => p.type === 'description-budget'), '超预算应报 description-budget');
    assert.strictEqual(checkDescriptionQuality(fmSkill('name: ok-name\ndescription: 网页端参数还原，不用于 App')).length, 0, '合规描述应零问题');
    // 体积预算：超限必须报 skill-budget，正常长度零问题
    assert.strictEqual(checkSkillBudget('x'.repeat(SKILL_CHAR_BUDGET)).length, 0);
    assert.strictEqual(checkSkillBudget('x'.repeat(SKILL_CHAR_BUDGET + 1)).length, 1);
    assert.strictEqual(checkSkillBudget('x'.repeat(SKILL_CHAR_BUDGET + 1))[0].type, 'skill-budget');

    // README 一致性：口径冲突与计数漂移必须被捕获；口径一致且计数正确时零问题
    fs.writeFileSync(path.join(dir, 'README.md'), '不用于 App、小程序、桌面程序及 Native 逆向。\n', 'utf8');
    assert(checkReadmeConsistency(dir, '').some((p) => p.type === 'readme-scope'), '小程序整类排除应报 readme-scope');
    fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'references', 'workflow'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets', 'templates', 't1'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'cases-a.md'), '', 'utf8');
    fs.mkdirSync(path.join(dir, 'cases'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'cases', 'c1.md'), '', 'utf8');
    fs.writeFileSync(path.join(dir, 'README.md'), '小程序限纯 JS 参数还原（Native/加壳部分除外）\nreferences/ 含 1 个专题目录\ncases/ 共 1 个实证案例\n1 类交付入口模板\n', 'utf8');
    assert.strictEqual(checkReadmeConsistency(dir, '').length, 0, '口径一致且计数正确应零问题');
    fs.writeFileSync(path.join(dir, 'README.md'), '小程序限纯 JS 参数还原\nreferences/ 含 2 个专题目录\n', 'utf8');
    assert(checkReadmeConsistency(dir, '').some((p) => p.type === 'readme-count'), '计数漂移应报 readme-count');

    return 'self-test passed';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    console.log(usage());
    return;
  }

  if (args.selfTest) {
    console.log(selfTest());
    return;
  }

  const root = path.resolve(args.projectDir || path.join(__dirname, '..'));
  const skillPath = path.resolve(root, args.skill);
  const result = checkSkill(skillPath, root);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(renderMarkdown(result));
  }

  process.exitCode = result.problems.length === 0 ? 0 : 1;
}

main();
