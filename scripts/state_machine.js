#!/usr/bin/env node
'use strict';

// 状态机强制跟踪 + 动作守卫
// 职责：
// 1) 把执行状态持久化到 <case-dir>/state.json（当前节点、已访问节点、转换历史、越权动作记录），
//    让"当前在哪个步骤"有客观依据，杜绝口头宣称代替执行。
// 2) --set 做状态转换合法性校验：只允许走 SKILL.md §4 状态机的直接后继，或回退到已访问节点；
//    跳过必经节点（如 EVIDENCE_GATE → IMPLEMENT 跳过 CASE_LOOKUP/EXTERNAL_LOOKUP）会被拒绝。
// 3) --guard <replay|external> 做动作边界守卫：重放/写请求类联网入口只能在 REAL_VERIFY / DIAGNOSE 执行；
//    外部题解检索只能在 CASE_LOOKUP/EXTERNAL_LOOKUP/DIAGNOSE 执行（取证前外查会被过期情报误导）。
// 4) TODO 清单落盘在 state.json.todo，--init/--set/--get 每次输出都渲染带勾选框的 11 项清单，
//    让"清单与进度"成为脚本产出的客观事实，而不是可被静默忽略的文字提示（match14 实测教训）。
// 违反时退出码非 0，并写入 state.json 的 blocks 审计记录；--force 可显式放行（仍留审计痕迹）。

const fs = require('fs');
const path = require('path');
const paths = require(process.env.STATE_MACHINE_PATHS || './lib/paths');

// SKILL.md §4 状态机的直接后继（回退到已访问节点始终允许）
const EDGES = {
  'INTENT_CONFIRM': ['ENV_READY'],
  'ENV_READY': ['EVIDENCE_GATE'],
  'EVIDENCE_GATE': ['CASE_LOOKUP', 'TRACE_CAPTURE', 'STEP2_ONLY', 'MATERIALS_FALLBACK', 'FORENSIC_CAPTURE'],
  'MATERIALS_FALLBACK': ['CASE_LOOKUP', 'FORENSIC_CAPTURE'],
  'STEP2_ONLY': ['CASE_LOOKUP'],
  'FORENSIC_CAPTURE': ['TRACE_CAPTURE', 'BLOCKED_FORENSIC'],
  'BLOCKED_FORENSIC': ['TRACE_CAPTURE', 'MATERIALS_FALLBACK', 'CASE_LOOKUP'],
  'TRACE_CAPTURE': ['CASE_LOOKUP', 'TRACE_RETRY', 'FORENSIC_CAPTURE'],
  'TRACE_RETRY': ['CASE_LOOKUP', 'TRACE_CAPTURE'],
  'CASE_LOOKUP': ['IDENTIFY', 'EXTERNAL_LOOKUP', 'INTENT_CONFIRM', 'ENV_READY'],
  'EXTERNAL_LOOKUP': ['IMPLEMENT', 'FORENSIC_CAPTURE'],
  'IDENTIFY': ['TRACE_ANALYZE'],
  'TRACE_ANALYZE': ['IMPLEMENT'],
  'IMPLEMENT': ['REAL_VERIFY'],
  'REAL_VERIFY': ['DELIVER', 'DIAGNOSE', 'SIGN_ONLY_DELIVER', 'FORENSIC_CAPTURE', 'IMPLEMENT'],
  'DIAGNOSE': ['IMPLEMENT', 'REAL_VERIFY', 'FORENSIC_CAPTURE'],
  'DELIVER': ['CLEANUP', 'DIAGNOSE'],
  'SIGN_ONLY_DELIVER': ['CLEANUP'],
  'CLEANUP': ['DONE'],
  'DONE': [],
};

// 允许发起重放/写请求的节点（重放类动作守卫）
const REPLAY_NODES = ['REAL_VERIFY', 'DIAGNOSE'];

// 允许做外部题解/情报检索的节点（外查类动作守卫）。
// match14 实测教训：在 EVIDENCE_GATE 阶段就先去搜"XX 网站怎么破"，搜到的是数年前的旧文章
// （旧接口路径、旧风控版本），此后所有假设都被过期情报带偏，直到取证完成才发现"与网上完全不同"。
// 因此外查必须排在本地取证与 CASE_LOOKUP 之后，用真实证据去校验外部情报，而不是反过来。
const EXTERNAL_NODES = ['CASE_LOOKUP', 'EXTERNAL_LOOKUP', 'DIAGNOSE'];

const GUARDS = {
  replay: {
    nodes: REPLAY_NODES,
    deny: (node) => `当前节点 ${node} 禁止发起重放/写请求；该动作只能在 ${REPLAY_NODES.join(' / ')} 执行（先完成 TRACE_ANALYZE/IMPLEMENT 写出实现）`,
  },
  external: {
    nodes: EXTERNAL_NODES,
    deny: (node) => `当前节点 ${node} 禁止外部题解检索；该动作只能在 ${EXTERNAL_NODES.join(' / ')} 执行（先用本地取证证据确定真实终态接口与参数，再拿外部情报做校验，避免被过期文章带偏——match14 教训）`,
  },
};

// SKILL.md §4 的 11 项执行 TODO 与状态节点映射（节点 → TODO 序号，1-based）。
// 脚本输出 [TODO] 提示驱动清单维护，把口头约定变成技术约束；
// 分支/降级节点（TRACE_RETRY、BLOCKED_FORENSIC 等）归入最近的主 TODO 项。
const TODO_ITEMS = [
  'INTENT_CONFIRM',
  'ENV_READY（续接模式直接勾掉）',
  'EVIDENCE_GATE',
  'FORENSIC_CAPTURE / TRACE_CAPTURE（含 TRACE_RETRY 与降级分支）',
  'CASE_LOOKUP（本地 search_cases + EXTERNAL_LOOKUP）',
  'IDENTIFY',
  'TRACE_ANALYZE',
  'IMPLEMENT',
  'REAL_VERIFY（含 DIAGNOSE）',
  'DELIVER / SIGN_ONLY_DELIVER',
  'CLEANUP',
];
const NODE_TO_TODO = {
  INTENT_CONFIRM: 1,
  ENV_READY: 2,
  EVIDENCE_GATE: 3,
  STEP2_ONLY: 3,
  MATERIALS_FALLBACK: 4,
  FORENSIC_CAPTURE: 4,
  BLOCKED_FORENSIC: 4,
  TRACE_CAPTURE: 4,
  TRACE_RETRY: 4,
  CASE_LOOKUP: 5,
  EXTERNAL_LOOKUP: 5,
  IDENTIFY: 6,
  TRACE_ANALYZE: 7,
  IMPLEMENT: 8,
  REAL_VERIFY: 9,
  DIAGNOSE: 9,
  DELIVER: 10,
  SIGN_ONLY_DELIVER: 10,
  CLEANUP: 11,
  DONE: 11,
};

function todoHint(node, mode) {
  const idx = NODE_TO_TODO[node];
  if (!idx) return '';
  const label = TODO_ITEMS[idx - 1];
  const heads = {
    init: `[TODO] 立即创建 SKILL.md §4 的 11 项执行 TODO，第 ${idx} 项「${label}」置为进行中`,
    resume: `[TODO] 续接时核对执行 TODO：当前节点对应第 ${idx} 项「${label}」`,
    enter: `[TODO] 勾选完成第 ${idx} 项「${label}」（不新建子任务）`,
    back: `[TODO] 第 ${idx} 项「${label}」重新置为进行中（回退，不新建子任务）`,
    same: `[TODO] 第 ${idx} 项「${label}」保持进行中`,
  };
  const head = heads[mode] || heads.same;
  return `${head}；宿主环境无 TODO 工具时在状态行中报告该项进度`;
}

// TODO 状态推导：节点对应项为进行中，其之前的项按已访问推断为完成，之后的项待办。
// 落盘到 state.json.todo 后每次输出都渲染清单，AI 无法"只推进状态不维护清单"（match14 实测教训）。
function computeTodo(state) {
  const cur = NODE_TO_TODO[state.node] || 1;
  return TODO_ITEMS.map((label, i) => {
    const no = i + 1;
    let status = 'pending';
    if (no === cur) status = 'in_progress';
    else if (no < cur) status = 'completed';
    return { no, label, status };
  });
}

function renderTodo(todo) {
  const mark = { completed: '[x]', in_progress: '[~]', pending: '[ ]' };
  const lines = ['### 执行 TODO 清单（11 项，脚本产出即事实）', ''];
  for (const t of todo) {
    const tail = t.status === 'in_progress' ? ' ← 进行中' : '';
    lines.push(`- ${mark[t.status]} ${t.no}. ${t.label}${tail}`);
  }
  lines.push('');
  lines.push('> 该清单必须同步到宿主 TODO 工具（逐项同名同序，不新建子任务）；宿主无 TODO 工具时把本清单原样输出给用户。');
  return lines;
}

function syncTodo(state) {
  state.todo = computeTodo(state);
  return state.todo;
}

function parseArgs(argv) {
  const args = {
    caseDir: '',
    set: '',
    get: false,
    init: false,
    guard: '',
    node: '',
    note: '',
    force: false,
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
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = nextVal();
    else if (a === '--set') args.set = nextVal();
    else if (a === '--get') args.get = true;
    else if (a === '--init') args.init = true;
    else if (a === '--guard') args.guard = nextVal();
    else if (a === '--node') args.node = nextVal();
    else if (a === '--note') args.note = nextVal();
    else if (a === '--force' || a === '-f') args.force = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/state_machine.js --case-dir <case-dir> --init [--node INTENT_CONFIRM] [--markdown]      # 初始化状态跟踪（不存在时）
  node scripts/state_machine.js --case-dir <case-dir> --set <NODE> [--note "<关键结论>"] [--markdown]  # 状态转换（非法跳转被拒绝，--force 放行）
  node scripts/state_machine.js --case-dir <case-dir> --get [--json]                                   # 查看当前状态、TODO 清单与历史
  node scripts/state_machine.js --case-dir <case-dir> --guard replay [--force] [--markdown]            # 动作守卫：重放/写请求入口必须调用
  node scripts/state_machine.js --case-dir <case-dir> --guard external [--force] [--markdown]          # 动作守卫：外部题解检索（联网搜索）前必须调用

说明：
- 状态持久化到 <case-dir>/state.json；--case-dir 兼容 <project-root> 与 <project-root>/case。
- 状态转换校验：目标必须是当前节点的直接后继（见 SKILL.md §4），或回退到已访问节点；
  跳过必经节点会被拒绝并提示合法路径。
- --guard replay：当前节点不在 REAL_VERIFY/DIAGNOSE 时拒绝（退出码 2），并写入 blocks 审计；
  --guard external：当前节点不在 CASE_LOOKUP/EXTERNAL_LOOKUP/DIAGNOSE 时拒绝（退出码 2）；
  --force 放行但保留审计记录。
- --init/--set/--get 都会渲染 state.json.todo 中的 11 项 TODO 清单（含 [x]/[~]/[ ] 勾选态），
  该清单必须同步到宿主 TODO 工具；宿主无 TODO 工具时把清单原样输出给用户。
- 每次状态转换后必须输出状态行（当前状态(证据状态) → 目标状态(关键结论)）。`;
}

function exists(p) { try { return !!p && fs.existsSync(p); } catch { return false; } }

function statePath(caseDir) {
  return path.join(caseDir, 'state.json');
}

function readState(caseDir) {
  const p = statePath(caseDir);
  if (!exists(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeState(caseDir, state) {
  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(statePath(caseDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function initState(caseDir, node) {
  const existing = readState(caseDir);
  if (existing && existing.node) {
    syncTodo(existing);
    writeState(caseDir, existing);
    return { state: existing, created: false };
  }
  const now = new Date().toISOString();
  const start = node || 'INTENT_CONFIRM';
  const state = {
    version: 1,
    node: start,
    updatedAt: now,
    visited: [start],
    history: [],
    blocks: [],
  };
  syncTodo(state);
  writeState(caseDir, state);
  return { state, created: true };
}

function suggestNext(state) {
  const cur = state ? state.node : '';
  const nexts = EDGES[cur] || [];
  return nexts.length ? `合法后继：${nexts.join(' → ')}` : '该节点已是终态';
}

function renderMarkdown(state, extraLines) {
  const lines = [];
  lines.push(`# 状态机跟踪 <case-dir>/state.json`);
  lines.push('');
  lines.push(`- 当前节点：**${state.node}**`);
  lines.push(`- 已访问：${state.visited.join(' → ')}`);
  lines.push(`- 最近更新：${state.updatedAt}`);
  if (extraLines && extraLines.length) {
    lines.push('');
    lines.push(...extraLines);
  }
  lines.push('');
  lines.push(...renderTodo(state.todo && state.todo.length ? state.todo : computeTodo(state)));
  if (state.history.length) {
    lines.push('');
    lines.push('### 转换历史');
    lines.push('');
    lines.push('| 目标节点 | 从节点 | 时间 | 结论 |');
    lines.push('|---|---|---|---|');
    for (const h of state.history) {
      lines.push(`| ${h.to} | ${h.from} | ${h.at} | ${h.note || ''} |`);
    }
  }
  if (state.blocks.length) {
    lines.push('');
    lines.push('### 越权/违反动作记录（审计）');
    lines.push('');
    lines.push('| 时间 | 类型 | 节点 | 说明 |');
    lines.push('|---|---|---|---|');
    for (const b of state.blocks) {
      lines.push(`| ${b.at} | ${b.type} | ${b.node} | ${b.message} |`);
    }
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); return 0; }
  if (args.selfTest) {
    // 内置冒烟：非法跳转被拒、合法后继通过、回退通过、guard 拒绝
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'state-machine-'));
    const state = initState(tmp, 'EVIDENCE_GATE').state;
    if (state.node !== 'EVIDENCE_GATE') { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: init 失败'); }
    const doSet = (to, force) => {
      const prev = readState(tmp);
      const allowed = to === prev.node || (prev.visited || []).includes(to) || (EDGES[prev.node] || []).includes(to);
      if (!allowed && !force) return { ok: false };
      const next = JSON.parse(JSON.stringify(prev));
      next.visited = (next.visited || []).concat(to);
      next.history = (next.history || []).concat({ from: prev.node, to, at: new Date().toISOString(), note: 'self-test' });
      next.node = to;
      writeState(tmp, next);
      return { ok: true };
    };
    const illegal = doSet('IMPLEMENT', false); // 跳过 CASE_LOOKUP/IDENTIFY/TRACE_ANALYZE
    if (illegal.ok) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: 非法跳转未被拒绝'); }
    if (!doSet('TRACE_CAPTURE', false).ok) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: 合法后继被拒'); }
    if (!doSet('EVIDENCE_GATE', false).ok) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: 回退到已访问节点被拒'); }
    if (doSet('INTENT_CONFIRM', false).ok) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: 未访问节点回退未拒绝'); }
    const guardOk = REPLAY_NODES.includes(readState(tmp).node);
    if (guardOk) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: guard 误放行'); }
    if (TODO_ITEMS.length !== 11) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: TODO_ITEMS 应为 11 项'); }
    for (const node of Object.keys(EDGES)) {
      if (!NODE_TO_TODO[node]) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error(`self-test: 节点 ${node} 缺少 TODO 映射`); }
    }
    for (const node of Object.keys(NODE_TO_TODO)) {
      if (!(node in EDGES)) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error(`self-test: TODO 映射含未知节点 ${node}`); }
    }
    if (!todoHint('FORENSIC_CAPTURE', 'enter').includes('第 4 项')) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: todoHint 输出异常'); }
    // TODO 清单必须落盘并可渲染：init 后 state.json 带 todo 字段，且 markdown 输出含勾选框
    const inited = readState(tmp);
    if (!inited.todo || inited.todo.length !== 11) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: state.json 未落盘 11 项 todo'); }
    const md = renderMarkdown(inited);
    if (!md.includes('执行 TODO 清单') || !md.includes('[~]')) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: markdown 未渲染 TODO 勾选清单'); }
    const todoAtImplement = computeTodo({ node: 'IMPLEMENT' });
    if (todoAtImplement[7].status !== 'in_progress' || todoAtImplement[0].status !== 'completed' || todoAtImplement[10].status !== 'pending') {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw new Error('self-test: TODO 状态推导异常');
    }
    // 外查守卫：取证前节点必须被拒绝，CASE_LOOKUP 起放行
    if (EXTERNAL_NODES.includes('EVIDENCE_GATE') || EXTERNAL_NODES.includes('FORENSIC_CAPTURE')) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: 外查守卫不应放行取证前节点'); }
    if (!EXTERNAL_NODES.includes('CASE_LOOKUP')) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: 外查守卫应放行 CASE_LOOKUP'); }
    for (const kind of ['replay', 'external']) {
      if (typeof GUARDS[kind].deny('EVIDENCE_GATE') !== 'string') { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error(`self-test: 守卫 ${kind} 拒绝文案缺失`); }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('state_machine.js self-test: PASS');
    return 0;
  }

  if (!args.caseDir) {
    console.error('缺少 --case-dir');
    console.error(usage());
    return 1;
  }
  const caseDir = paths.resolveCaseDir(args.caseDir);

  if (args.init) {
    const { state, created } = initState(caseDir, args.node);
    const hint = todoHint(state.node, created ? 'init' : 'resume');
    const head = created ? `已初始化状态跟踪：${state.node}` : `状态已存在，当前节点：${state.node}`;
    if (args.json) {
      console.log(JSON.stringify(state, null, 2));
      return 0;
    }
    console.log(renderMarkdown(state, ['', `> ${head}`, ...(hint ? ['', hint] : [])]));
    return 0;
  }

  let state = readState(caseDir);
  if (!state) {
    console.error(`未找到状态文件 ${statePath(caseDir)}；请先运行 --init 初始化状态机跟踪`);
    return 1;
  }

  if (args.guard) {
    const kind = args.guard.toLowerCase();
    const guard = GUARDS[kind];
    if (!guard) {
      console.error(`未知守卫类型：${args.guard}（当前支持 ${Object.keys(GUARDS).join(' / ')}）`);
      return 1;
    }
    const allowed = guard.nodes.includes(state.node);
    if (!allowed && !args.force) {
      const msg = guard.deny(state.node);
      state.blocks = (state.blocks || []).concat({ at: new Date().toISOString(), type: `${kind}-guard`, node: state.node, message: msg });
      syncTodo(state);
      writeState(caseDir, state);
      if (args.markdown) console.log(renderMarkdown(state, ['', `> 拒绝：${msg}`, '', `> ${suggestNext(state)}`]));
      else console.error(`${kind.toUpperCase()}_GUARD_DENIED: ${msg}`);
      return 2;
    }
    if (!allowed) {
      state.blocks = (state.blocks || []).concat({ at: new Date().toISOString(), type: `${kind}-guard-force`, node: state.node, message: `--force 放行越权动作（${kind}）` });
      syncTodo(state);
      writeState(caseDir, state);
    }
    if (args.markdown) {
      console.log(renderMarkdown(state, ['', `> **${kind} 守卫通过**：当前节点 ${state.node}`]));
    } else {
      console.log(`${kind} 守卫通过：当前节点 ${state.node}`);
      console.log(renderTodo(state.todo && state.todo.length ? state.todo : computeTodo(state)).join('\n'));
    }
    return 0;
  }

  if (args.set) {
    const to = args.set.toUpperCase();
    const allowed = to === state.node || (state.visited || []).includes(to) || (EDGES[state.node] || []).includes(to);
    if (!allowed && !args.force) {
      const msg = `非法状态跳转：${state.node} → ${to}（跳过必经节点）；${suggestNext(state)}`;
      state.blocks = (state.blocks || []).concat({ at: new Date().toISOString(), type: 'illegal-transition', node: state.node, message: msg });
      syncTodo(state);
      writeState(caseDir, state);
      if (args.markdown) console.log(renderMarkdown(state, ['', `> 拒绝：${msg}`]));
      else console.error(`ILLEGAL_TRANSITION: ${msg}`);
      return 2;
    }
    const from = state.node;
    const wasVisited = (state.visited || []).includes(to);
    state.node = to;
    state.updatedAt = new Date().toISOString();
    if (!state.visited.includes(to)) state.visited.push(to);
    state.history = (state.history || []).concat({ from, to, at: state.updatedAt, note: args.note || '' });
    if (!allowed) {
      state.blocks = (state.blocks || []).concat({ at: state.updatedAt, type: 'illegal-transition-force', node: from, message: `--force 放行非法跳转 ${from} → ${to}` });
    }
    syncTodo(state);
    writeState(caseDir, state);
    const hint = todoHint(to, to === from ? 'same' : wasVisited ? 'back' : 'enter');
    if (args.markdown) {
      const extra = [`> 状态转换：${from} → **${to}**${args.note ? '（' + args.note + '）' : ''}`];
      if (hint) extra.push('', hint);
      console.log(renderMarkdown(state, ['', ...extra]));
    } else {
      console.log(`STATE_TRANSITION: ${from} → ${to}${args.note ? ' | ' + args.note : ''}`);
      if (hint) console.log(hint);
      console.log(renderTodo(state.todo).join('\n'));
    }
    return 0;
  }

  if (args.get || args.markdown) {
    if (args.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(renderMarkdown(state));
    }
    return 0;
  }

  console.error(usage());
  return 1;
}

process.exit(main());