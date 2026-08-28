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

// 允许用浏览器 MCP 连接用户真实浏览器的节点（取证兜底通道守卫）。
// match14 实测教训：Firefox 取证浏览器被目标站引擎级检测全 400 拒绝（--ua 覆盖无效），
// trace 采到的全是被拒响应；经用户确认用浏览器 MCP 连真实 Chrome 才拿到 200 成功样本。
// MCP 定位是兜底而非主通道，防止其成为绕过 ruyipage/RuyiTrace 取证纪律的捷径。
// DIAGNOSE 仅限引擎检测 case（visited 含 BLOCKED_FORENSIC）的双对照浏览器侧：
// 站点拒绝 ruyipage 内核时，正向对照的"浏览器新鲜签名"只能来自 MCP 真实浏览器。
const MCP_NODES = ['BLOCKED_FORENSIC', 'DIAGNOSE'];

// SKILL.md §4.4 上下文防耗尽检查点：同一节点消耗 20+ 步仍未推进即为打转。
// 计入"步"的客观事件：每次 --guard 调用（一次重放/外查尝试）、每次 --set 回到同一节点。
// 到达 STEP_DENY 后 --guard 拒绝放行，必须先落阶段报告；--set 同节点且 --note 指向真实存在的
// 报告文件时归零计数（报告是否落盘由文件系统裁定，不认口头声明）。
const STEP_WARN = 12;
const STEP_DENY = 20;

const GUARDS = {
  replay: {
    nodes: REPLAY_NODES,
    deny: (node) => `当前节点 ${node} 禁止发起重放/写请求；该动作只能在 ${REPLAY_NODES.join(' / ')} 执行（先完成 TRACE_ANALYZE/IMPLEMENT 写出实现）`,
  },
  external: {
    nodes: EXTERNAL_NODES,
    deny: (node) => `当前节点 ${node} 禁止外部题解检索；该动作只能在 ${EXTERNAL_NODES.join(' / ')} 执行（先用本地取证证据确定真实终态接口与参数，再拿外部情报做校验，避免被过期文章带偏——match14 教训）`,
  },
  mcp: {
    nodes: MCP_NODES,
    check: (state) => state.node !== 'DIAGNOSE' || (state.visited || []).includes('BLOCKED_FORENSIC'),
    deny: (node, state) => {
      if (node === 'DIAGNOSE' && state && !(state.visited || []).includes('BLOCKED_FORENSIC')) {
        return `DIAGNOSE 的浏览器 MCP 仅限引擎检测 case 的双对照浏览器侧（本 case 未经过 BLOCKED_FORENSIC）：浏览器侧对照按 SKILL.md 第 10 节用 ruyipage hook 完成；确有引擎检测证据先回 BLOCKED_FORENSIC 对齐用户`;
      }
      return `当前节点 ${node} 禁止浏览器 MCP 取证；该动作只能在 BLOCKED_FORENSIC（引擎检测兜底取证）/ DIAGNOSE（双对照浏览器侧，须已过 BLOCKED_FORENSIC）执行（先定位引擎级检测证据并经用户确认，常规取证走 ruyipage/RuyiTrace——match14 教训：MCP 是兜底不是捷径）`;
    },
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
  node scripts/state_machine.js --case-dir <case-dir> --guard mcp [--force] [--markdown]               # 动作守卫：浏览器 MCP 兜底取证前必须调用（须用户确认）

说明：
- 状态持久化到 <case-dir>/state.json；--case-dir 兼容 <project-root> 与 <project-root>/case。
  --init 会检查另一候选目录是否也有 state.json，发现两份则告警并打印本次实际读写的绝对路径。
- 状态转换校验：目标必须是当前节点的直接后继（见 SKILL.md §4），或回退到已访问节点；
  跳过必经节点会被拒绝并提示合法路径。
- --guard replay：当前节点不在 REAL_VERIFY/DIAGNOSE 时拒绝（退出码 2），并写入 blocks 审计；
  --guard external：当前节点不在 CASE_LOOKUP/EXTERNAL_LOOKUP/DIAGNOSE 时拒绝（退出码 2）；
  --guard mcp：当前节点不在 BLOCKED_FORENSIC/DIAGNOSE 时拒绝（退出码 2）；
  DIAGNOSE 仅限已过 BLOCKED_FORENSIC 的引擎检测 case 双对照浏览器侧（未经过则拒绝）；
  --force 放行但保留审计记录。
- --init/--set/--get 都会渲染 state.json.todo 中的 11 项 TODO 清单（含 [x]/[~]/[ ] 勾选态），
  该清单必须同步到宿主 TODO 工具；宿主无 TODO 工具时把清单原样输出给用户。
- 步数预算（SKILL.md §4.4）：同一节点每次 --guard 或 --set 回到自身都累加 stepCount，
  ${STEP_WARN} 步起输出 WARN，${STEP_DENY} 步起 --guard 直接拒绝（退出码 2），必须先落阶段报告，
  再用 --set <同节点> --note "<报告文件路径>" 归零（路径必须真实存在，口头声明不算）。
- 每次状态转换后必须输出状态行（当前状态(证据状态) → 目标状态(关键结论)）。`;
}

function exists(p) { try { return !!p && fs.existsSync(p); } catch { return false; } }

function statePath(caseDir) {
  return path.join(caseDir, 'state.json');
}

function readState(caseDir) {
  const p = statePath(caseDir);
  if (!exists(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    // 无 node 视为未初始化；字段缺失则补齐，避免下游渲染/--set 崩在字段访问上
    if (!parsed || typeof parsed !== 'object' || !parsed.node) return null;
    parsed.visited = Array.isArray(parsed.visited) && parsed.visited.length ? parsed.visited : [parsed.node];
    parsed.history = Array.isArray(parsed.history) ? parsed.history : [];
    parsed.blocks = Array.isArray(parsed.blocks) ? parsed.blocks : [];
    return parsed;
  } catch { return null; }
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
    stepCount: 0,
    stepNode: start,
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

// 同一 --case-dir 输入可能落到两个不同目录（paths.resolveCaseDir：<input>/case 存在则取它，
// 否则取 input 本身）。若项目根与 case 子目录下各有一份 state.json，进度就被劈成两半，
// 而输出里看不出写的是哪一份——match14 实测中"--init 又回到起点"就是这么来的。
function detectSplitStates(caseDir) {
  const active = path.resolve(caseDir);
  const candidates = [path.join(active, 'case')];
  // 只有当前目录本身就是 case 子目录时，其父目录才是另一个可能的解析结果
  if (path.basename(active).toLowerCase() === 'case') candidates.push(path.dirname(active));
  const found = [];
  for (const dir of candidates) {
    if (path.resolve(dir) === active) continue;
    if (exists(statePath(dir))) found.push(statePath(dir));
  }
  return found;
}

// 标准布局下 state.json 必须落在 <project-root>/case/state.json，与后续所有脚本的
// paths.resolveCaseDir 结果一致。而 --init 通常早于取证脚本、此时 case/ 还不存在，
// resolveCaseDir 会退回输入目录本身 → state.json 写到项目根；等取证脚本建好 case/ 后再 --set，
// 解析结果切到 <project-root>/case，就读不到刚才写的文件（match16 实测"未找到状态文件"）。
// 因此 --init 阶段主动按标准布局固定到 <input>/case；仅当输入本身已带证据子目录
// （非标准布局的历史 case 目录）时才原样使用，避免凭空多套一层。
const CASE_MARKER_SUBDIRS = paths.CASE_EVIDENCE_SUBDIRS || ['notes', 'fixtures', 'ruyi-trace', 'js', 'forensic', 'requests', 'tmp'];
function resolveStateDir(input) {
  const p = path.resolve(input || '.');
  if (path.basename(p).toLowerCase() === 'case') return p;
  const caseSub = path.join(p, 'case');
  try { if (fs.statSync(caseSub).isDirectory()) return caseSub; } catch {}
  if (CASE_MARKER_SUBDIRS.some((n) => exists(path.join(p, n)))) return p;
  try { fs.mkdirSync(caseSub, { recursive: true }); return caseSub; } catch { return p; }
}

// 自愈既有项目的分裂：标准路径缺失、但父/子目录存在遗留 state.json 时迁移过来，
// 免得每次都靠人工挪文件。仅在 readState 为空时调用。
function migrateLegacyState(caseDir) {
  const legacy = detectSplitStates(caseDir);
  if (!legacy.length) return '';
  const from = legacy[0];
  const to = statePath(caseDir);
  try {
    fs.mkdirSync(caseDir, { recursive: true });
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
    return `检测到遗留状态文件 ${from}，已迁移到 ${to}`;
  } catch { return ''; }
}

function stepCount(state) {
  return Number((state && state.stepCount) || 0);
}

function bumpStep(state, reason) {
  state.stepCount = stepCount(state) + 1;
  state.stepNode = state.node;
  state.stepLastReason = reason;
  return state.stepCount;
}

function resetStep(state, why) {
  state.stepCount = 0;
  state.stepNode = state.node;
  state.stepLastReason = why || 'reset';
}

// --note 里出现的路径确实存在时才认定阶段报告已落盘（口头声明不算）。
function noteHasReport(caseDir, note) {
  const text = String(note || '');
  if (!text) return '';
  const tokens = text.match(/[^\s"'（），,；;]+\.(md|json|jsonl|txt)/gi) || [];
  for (const t of tokens) {
    for (const base of [caseDir, path.dirname(path.resolve(caseDir)), process.cwd()]) {
      const p = path.isAbsolute(t) ? t : path.join(base, t);
      if (exists(p)) return path.resolve(p);
    }
  }
  return '';
}

function stepWarning(state) {
  const n = stepCount(state);
  if (n >= STEP_DENY) {
    return `同一节点 ${state.node} 已累计 ${n} 步未推进（阈值 ${STEP_DENY}）；按 SKILL.md §4.4 必须先落阶段报告（当前状态、已证实事实、缺失证据、下一步输入），再用 --set ${state.node} --note "<报告文件路径>" 归零计数`;
  }
  if (n >= STEP_WARN) {
    return `同一节点 ${state.node} 已累计 ${n} 步（DENY 阈值 ${STEP_DENY}）；换检索词/换方法，别在同一路线上重复尝试`;
  }
  return '';
}

function renderMarkdown(state, extraLines, caseDir) {
  const lines = [];
  lines.push(`# 状态机跟踪 ${caseDir ? statePath(caseDir) : '<case-dir>/state.json'}`);
  lines.push('');
  lines.push(`- 当前节点：**${state.node}**`);
  lines.push(`- 已访问：${state.visited.join(' → ')}`);
  lines.push(`- 最近更新：${state.updatedAt}`);
  if (stepCount(state) > 0) {
    lines.push(`- 本节点累计步数：${stepCount(state)}（WARN ${STEP_WARN} / DENY ${STEP_DENY}）`);
  }
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
    if (MCP_NODES.includes('FORENSIC_CAPTURE') || MCP_NODES.includes('EVIDENCE_GATE')) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: MCP 守卫不应放行常规取证节点'); }
    if (!MCP_NODES.includes('BLOCKED_FORENSIC')) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: MCP 守卫应放行 BLOCKED_FORENSIC'); }
    // MCP 守卫：DIAGNOSE 仅在引擎检测语境（visited 含 BLOCKED_FORENSIC）放行双对照浏览器侧
    if (!GUARDS.mcp.check({ node: 'DIAGNOSE', visited: ['EVIDENCE_GATE', 'FORENSIC_CAPTURE', 'BLOCKED_FORENSIC', 'DIAGNOSE'] })) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: MCP 守卫应放行引擎检测语境的 DIAGNOSE'); }
    if (GUARDS.mcp.check({ node: 'DIAGNOSE', visited: ['EVIDENCE_GATE', 'DIAGNOSE'] })) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: MCP 守卫不应放行未经过 BLOCKED_FORENSIC 的 DIAGNOSE'); }
    if (typeof GUARDS.mcp.deny('DIAGNOSE', { node: 'DIAGNOSE', visited: [] }) !== 'string') { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('self-test: MCP 守卫 DIAGNOSE 拒绝文案缺失'); }
    for (const kind of ['replay', 'external', 'mcp']) {
      if (typeof GUARDS[kind].deny('EVIDENCE_GATE') !== 'string') { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error(`self-test: 守卫 ${kind} 拒绝文案缺失`); }
    }
    const fail = (msg) => { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error(`self-test: ${msg}`); };
    // 状态文件路径必须以绝对路径出现在输出里，否则路径分裂无法被察觉
    if (!renderMarkdown(readState(tmp), null, tmp).includes(statePath(tmp))) fail('markdown 未打印真实 state.json 路径');
    // 步数预算：同节点累加到 DENY 阈值必须给出含阈值的拒绝文案，未达 WARN 不出声
    const budget = readState(tmp);
    resetStep(budget, 'test');
    if (stepWarning(budget)) fail('零步数不应告警');
    for (let i = 0; i < STEP_WARN; i += 1) bumpStep(budget, 'test');
    if (!stepWarning(budget)) fail(`累计 ${STEP_WARN} 步应输出 WARN`);
    while (stepCount(budget) < STEP_DENY) bumpStep(budget, 'test');
    if (!stepWarning(budget).includes('阶段报告')) fail(`累计 ${STEP_DENY} 步应要求先落阶段报告`);
    resetStep(budget, 'report');
    if (stepCount(budget) !== 0 || stepWarning(budget)) fail('落报告后步数应归零');
    // 阶段报告以文件是否存在为准，口头声明不予认定
    fs.writeFileSync(path.join(tmp, '阶段报告.md'), '# 阶段报告\n', 'utf8');
    if (!noteHasReport(tmp, '已落 阶段报告.md')) fail('note 指向已存在的报告应被认定');
    if (noteHasReport(tmp, '报告已经写好了')) fail('无文件的口头声明不应被认定');
    // 路径分裂：<tmp>/case/state.json 与 <tmp>/state.json 并存时必须被检出
    fs.mkdirSync(path.join(tmp, 'case'), { recursive: true });
    fs.writeFileSync(statePath(path.join(tmp, 'case')), '{}\n', 'utf8');
    if (!detectSplitStates(tmp).includes(statePath(path.join(tmp, 'case')))) fail('未检出并存的第二份 state.json');
    fs.rmSync(tmp, { recursive: true, force: true });

    // 标准布局：--init 早于取证脚本、case/ 尚不存在时，state.json 必须落到 <project-root>/case/，
    // 且与后续 paths.resolveCaseDir 的解析结果一致（取证脚本建好 case/ 后不会读不到，match16 实测）
    const lay = fs.realpathSync(fs.mkdtempSync(path.join(require('os').tmpdir(), 'state-layout-')));
    try {
      const resolved = resolveStateDir(lay);
      if (path.basename(resolved) !== 'case' || path.dirname(resolved) !== lay) fail('case/ 不存在时 --init 应落到 <project-root>/case');
      initState(resolved, 'INTENT_CONFIRM');
      if (!exists(statePath(resolved))) fail('标准布局下 state.json 未落到 <project-root>/case/state.json');
      if (paths.resolveCaseDir(lay) !== resolved) fail('--init 与后续 --set 解析到了不同的 case 目录');
    } finally {
      fs.rmSync(lay, { recursive: true, force: true });
    }
    // 非标准布局：输入本身已带证据子目录时不应再套一层 case/
    const custom = fs.realpathSync(fs.mkdtempSync(path.join(require('os').tmpdir(), 'state-custom-')));
    try {
      fs.mkdirSync(path.join(custom, 'fixtures'), { recursive: true });
      if (resolveStateDir(custom) !== custom) fail('输入已是 case 目录时不应再创建 <input>/case');
    } finally {
      fs.rmSync(custom, { recursive: true, force: true });
    }
    // 遗留状态自愈：<root>/state.json 存在且已建好 <root>/case 时，--set 前应自动迁移
    const legacy = fs.realpathSync(fs.mkdtempSync(path.join(require('os').tmpdir(), 'state-legacy-')));
    try {
      fs.mkdirSync(path.join(legacy, 'case'), { recursive: true });
      fs.writeFileSync(statePath(legacy), JSON.stringify({ node: 'TRACE_ANALYZE' }), 'utf8');
      if (!migrateLegacyState(paths.resolveCaseDir(legacy))) fail('遗留 state.json 未迁移');
      if (!exists(statePath(path.join(legacy, 'case'))) || exists(statePath(legacy))) fail('迁移后应只剩 <project-root>/case/state.json');
    } finally {
      fs.rmSync(legacy, { recursive: true, force: true });
    }
    console.log('state_machine.js self-test: PASS');
    return 0;
  }

  if (!args.caseDir) {
    console.error('缺少 --case-dir');
    console.error(usage());
    return 1;
  }
  // --init 时 case/ 可能尚未创建，按标准布局固定到 <project-root>/case，
  // 避免"先写项目根、后读 case 目录"的路径分裂（match16 实测）。
  const caseDir = args.init ? resolveStateDir(args.caseDir) : paths.resolveCaseDir(args.caseDir);
  const migrated = args.init ? '' : migrateLegacyState(caseDir);

  if (args.init) {
    const { state, created } = initState(caseDir, args.node);
    const hint = todoHint(state.node, created ? 'init' : 'resume');
    const head = created ? `已初始化状态跟踪：${state.node}` : `状态已存在，当前节点：${state.node}`;
    const split = detectSplitStates(caseDir);
    if (args.json) {
      console.log(JSON.stringify({ ...state, statePath: statePath(caseDir), splitStates: split }, null, 2));
      return 0;
    }
    const extra = ['', `> ${head}`];
    if (split.length) {
      extra.push('', `> **警告：检测到另一份状态文件**：${split.join(' / ')}。本次读写的是 ${statePath(caseDir)}，两份进度互不可见（--case-dir 传项目根还是 case 目录会解析到不同位置）。请只保留一份，后续所有命令固定用同一个 --case-dir。`);
    }
    if (hint) extra.push('', hint);
    console.log(renderMarkdown(state, extra, caseDir));
    return 0;
  }

  if (migrated) console.error(`[state-machine] ${migrated}`);
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
    const allowed = guard.nodes.includes(state.node) && (!guard.check || guard.check(state));
    if (!allowed && !args.force) {
      const msg = guard.deny(state.node, state);
      state.blocks = (state.blocks || []).concat({ at: new Date().toISOString(), type: `${kind}-guard`, node: state.node, message: msg });
      syncTodo(state);
      writeState(caseDir, state);
      if (args.markdown) console.log(renderMarkdown(state, ['', `> 拒绝：${msg}`, '', `> ${suggestNext(state)}`], caseDir));
      else console.error(`${kind.toUpperCase()}_GUARD_DENIED: ${msg}`);
      return 2;
    }
    if (!allowed) {
      state.blocks = (state.blocks || []).concat({ at: new Date().toISOString(), type: `${kind}-guard-force`, node: state.node, message: `--force 放行越权动作（${kind}）` });
      syncTodo(state);
      writeState(caseDir, state);
    }
    // 节点合法但已在同一节点打转到阈值：先落阶段报告再继续（SKILL.md §4.4）
    bumpStep(state, `${kind}-guard`);
    const exhausted = stepCount(state) >= STEP_DENY && !args.force;
    const warn = stepWarning(state);
    if (exhausted) {
      state.blocks = (state.blocks || []).concat({ at: new Date().toISOString(), type: 'step-budget', node: state.node, message: warn });
    }
    syncTodo(state);
    writeState(caseDir, state);
    if (exhausted) {
      if (args.markdown) console.log(renderMarkdown(state, ['', `> 拒绝：${warn}`], caseDir));
      else console.error(`STEP_BUDGET_EXCEEDED: ${warn}`);
      return 2;
    }
    if (args.markdown) {
      const extra = ['', `> **${kind} 守卫通过**：当前节点 ${state.node}`];
      if (warn) extra.push('', `> WARN：${warn}`);
      console.log(renderMarkdown(state, extra, caseDir));
    } else {
      console.log(`${kind} 守卫通过：当前节点 ${state.node}`);
      if (warn) console.log(`WARN: ${warn}`);
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
      if (args.markdown) console.log(renderMarkdown(state, ['', `> 拒绝：${msg}`], caseDir));
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
    // 步数计数：换节点即归零；停在同一节点则累加，除非 --note 指向真实存在的阶段报告
    let stepNote = '';
    if (to !== from) {
      resetStep(state, `enter:${to}`);
    } else {
      const report = noteHasReport(caseDir, args.note);
      if (report) {
        resetStep(state, `report:${report}`);
        stepNote = `已确认阶段报告 ${report}，本节点步数归零`;
      } else {
        bumpStep(state, 'set-same-node');
        stepNote = stepWarning(state);
      }
    }
    syncTodo(state);
    writeState(caseDir, state);
    const hint = todoHint(to, to === from ? 'same' : wasVisited ? 'back' : 'enter');
    if (args.markdown) {
      const extra = [`> 状态转换：${from} → **${to}**${args.note ? '（' + args.note + '）' : ''}`];
      if (stepNote) extra.push('', `> ${stepNote}`);
      if (hint) extra.push('', hint);
      console.log(renderMarkdown(state, ['', ...extra], caseDir));
    } else {
      console.log(`STATE_TRANSITION: ${from} → ${to}${args.note ? ' | ' + args.note : ''}`);
      if (stepNote) console.log(stepNote);
      if (hint) console.log(hint);
      console.log(renderTodo(state.todo).join('\n'));
    }
    return 0;
  }

  if (args.get || args.markdown) {
    if (args.json) {
      console.log(JSON.stringify(state, null, 2));
    } else {
      console.log(renderMarkdown(state, null, caseDir));
    }
    return 0;
  }

  console.error(usage());
  return 1;
}

process.exit(main());