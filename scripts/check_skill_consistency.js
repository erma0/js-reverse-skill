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
- SKILL.md 存在且 YAML frontmatter 包含 name / description。
- 关键硬门禁锚点存在：GATE-0 / GATE-1 / GATE-2 / EVIDENCE_GATE / 纯协议红线 / REAL_VERIFY /
  check_evidence.js / check_final_artifact.js / 最终项目总结.md / --target-signal / TRACE_RETRY。
- SKILL.md 中引用的 references / scripts / assets / templates / cases 路径真实存在。
- reference-map 若被引用，其内部相对链接同样校验。
- scripts/README.md 索引同步：每个 scripts/ 顶层脚本都被索引、表格不指向不存在
  的脚本、头部计数（总/JS/Python）与实际文件数一致（防止加脚本忘更新索引的计数漂移）。`;
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
  if (!/^---\s*\r?\n/.test(text) || !/name:\s*\S+/.test(text) || !/description:\s*\S+/.test(text)) {
    problems.push({ type: 'frontmatter', message: 'YAML frontmatter 必须包含 name 和 description' });
  }

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
      'description: test',
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
