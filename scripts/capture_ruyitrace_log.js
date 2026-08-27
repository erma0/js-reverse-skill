#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const paths = require('./lib/paths');
const { assertTraceSignals, traceSignalNeedleGroups } = require('./lib/trace-signal-policy');

const KNOWN_FLAGS = [
  '--url', '--input', '--case-dir', '--dir', '--out-dir', '--profile-dir', '--ruyitrace-home',
  '--ruyitrace-exe', '--project-dir', '--cookie', '--cookie-domain', '--duration', '--limit',
  '--ptype', '--trace-env', '--target-signal', '--trace-signal', '--evidence-signal',
  '--end-signal', '--signal-policy', '--dry-run', '--import-after', '--json', '--markdown',
  '--self-test', '--help',
];

// 参数拼错时给出最接近的合法参数名（编辑距离 ≤3），避免用户对着全量 usage 逐行找。
function suggestFlag(input) {
  const a = String(input || '');
  let best = '';
  let bestScore = Infinity;
  for (const flag of KNOWN_FLAGS) {
    const score = editDistance(a, flag);
    if (score < bestScore) { bestScore = score; best = flag; }
  }
  return bestScore <= 3 ? `，是否想用 ${best}？` : '';
}

function editDistance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function parseArgs(argv) {
  const args = {
    url: '',
    input: '',
    caseDir: '.',
    outDir: '',
    profileDir: '',
    ruyitraceHome: '',
    ruyitraceExe: '',
    projectDir: '',
    cookies: [],
    cookieDomain: '',
    duration: 120,
    limit: 200000,
    ptype: '',
    traceEnv: [],
    targetSignals: [],
    traceSignals: [],
    evidenceSignals: [],
    endSignals: [],
    signalPolicy: 'strict',
    dryRun: false,
    importAfter: false,
    json: false,
    markdown: false,
    help: false,
    selfTest: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    const needVal = (hint) => {
      const v = nextVal('');
      if (!v) throw new Error(`${a} 缺少取值${hint ? `：${hint}` : ''}`);
      return v;
    };
    if (a === '--url') args.url = nextVal('');
    else if (a === '--input') args.input = nextVal('');
    else if (a === '--case-dir' || a === '--dir') args.caseDir = nextVal('');
    else if (a === '--out-dir') args.outDir = nextVal('');
    else if (a === '--profile-dir') args.profileDir = nextVal('');
    else if (a === '--ruyitrace-home') args.ruyitraceHome = nextVal('');
    else if (a === '--ruyitrace-exe') args.ruyitraceExe = nextVal('');
    else if (a === '--project-dir') args.projectDir = nextVal('');
    else if (a === '--cookie') args.cookies.push(nextVal(''));
    else if (a === '--cookie-domain') args.cookieDomain = nextVal('');
    else if (a === '--duration') args.duration = Number(nextVal('120'));
    else if (a === '--limit') args.limit = Number(nextVal('200000'));
    else if (a === '--ptype') args.ptype = nextVal('');
    else if (a === '--trace-env') args.traceEnv.push(nextVal(''));
    else if (a === '--target-signal') {
      const signal = needVal('信号字符串，如 Headers.set 或目标参数名');
      args.targetSignals.push(signal);
      args.evidenceSignals.push(signal);
      args.endSignals.push(signal);
    }
    else if (a === '--trace-signal') {
      const signal = needVal('信号字符串，如 XMLHttpRequest 或目标参数名');
      args.traceSignals.push(signal);
      args.evidenceSignals.push(signal);
    }
    else if (a === '--evidence-signal') args.evidenceSignals.push(needVal('信号字符串，用于证据门禁'));
    else if (a === '--end-signal') args.endSignals.push(needVal('信号字符串，用于提前结束采集'));
    else if (a === '--signal-policy') {
      const v = needVal('strict 或 advisory');
      if (!['strict', 'advisory'].includes(v)) throw new Error(`--signal-policy 只接受 strict 或 advisory，收到：${v}`);
      args.signalPolicy = v;
    }
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--import-after') args.importAfter = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--self-test') args.selfTest = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}${suggestFlag(a)}（完整参数说明用 --help 查看）`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  if (!Number.isFinite(args.duration) || args.duration <= 0) args.duration = 120;
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 200000;
  if (!['strict', 'advisory'].includes(args.signalPolicy)) args.signalPolicy = 'strict';
  args.traceSignals = args.traceSignals.filter((s) => s && s.trim());
  args.evidenceSignals = args.evidenceSignals.filter((s) => s && s.trim());
  args.endSignals = args.endSignals.filter((s) => s && s.trim());
  assertTraceSignals(args.evidenceSignals, 'evidence-signal');
  assertTraceSignals(args.endSignals, 'end-signal');
  if (args.evidenceSignals.length) args.targetSignals = args.evidenceSignals.slice();
  args.traceEnvPairs = parseTraceEnv(args.traceEnv);
  return args;
}

// 定向 trace 开关透传：仅允许 MOZ_DOM_ 前缀（RuyiTrace 内核 trace 配置命名空间），
// 不允许覆盖脚本自身管理的 5 个 key（对应专用参数 --limit / --ptype / 输出路径），
// 避免采集计划与实际环境变量漂移。输出文件按锚点自动派生：设 MOZ_DOM_TRACE_FILE 后，
// jscall/cookie/eval 等模块日志落在同目录子文件夹，无需单独传 *_TRACE_FILE。
const SCRIPT_MANAGED_TRACE_ENV = new Set([
  'MOZ_DOM_TRACE', 'MOZ_DOM_TRACE_FILE', 'MOZ_DOM_TRACE_LIMIT',
  'MOZ_DOM_TRACE_PTYPE', 'MOZ_DISABLE_LAUNCHER_PROCESS',
]);

function parseTraceEnv(pairs) {
  const out = {};
  for (const item of (pairs || [])) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const eq = item.indexOf('=');
    if (eq <= 0) throw new Error(`--trace-env 需要 KEY=VALUE 形式，收到：${item}`);
    const key = item.slice(0, eq).trim();
    const value = item.slice(eq + 1).trim();
    if (!/^MOZ_DOM_[A-Z0-9_]+$/.test(key)) throw new Error(`--trace-env 只接受 MOZ_DOM_ 前缀的环境变量：${key}（完整开关清单见 references/tooling/ruyitrace-cheatsheet.md）`);
    if (SCRIPT_MANAGED_TRACE_ENV.has(key)) throw new Error(`--trace-env 不允许覆盖脚本管理的 ${key}：行数上限用 --limit、进程类型用 --ptype、输出路径由 --case-dir 决定`);
    out[key] = value;
  }
  return out;
}

function usage() {
  return `用法（自动 trace / 手动 trace 二选一）：
  # 自动 trace：自动启动随 RuyiTrace 提供的 trace Firefox 捕获 NDJSON
  node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir . --ruyitrace-home <RuyiTrace-dir> --duration 120 --import-after --markdown
  # 手动 trace：用户已用 RuyiTrace 手动 trace 完成，指定 NDJSON 日志直接导入生成摘要
  node scripts/capture_ruyitrace_log.js --input <用户trace生成的.ndjson> --case-dir . --markdown
  # 仅检测环境并打印计划（不启动浏览器）
  node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir . --dry-run --json
  # 本地自测（不启动浏览器）
  node scripts/capture_ruyitrace_log.js --self-test

说明：--case-dir 指项目根目录（其下应有 case/ 和 result/ 两个平级子目录），默认当前目录。
--project-dir <dir>：用户工程目录（tools/ 所在），未传时从 --case-dir 推断；安装模式下需靠此定位 RuyiTrace。
--url 与 --input 互斥：--url 为自动捕获（需 RuyiTrace 完整安装）；--input 为手动 trace 后直接导入用户指定的 NDJSON，无需 RuyiTrace 安装检测。
--trace-signal / --evidence-signal <信号>（可多次）：只用于导入和证据门禁，扫描环境 API / writer / 参数写入点。
--end-signal <信号>（可多次）：仅用于自动采集提前结束；不传时只在用户关闭或 duration 到期时结束。
--target-signal <信号>（兼容旧参数）：同时作为 evidence-signal 和 end-signal；新流程不要使用。
--signal-policy strict|advisory：strict 未命中退出非 0；advisory 只记录覆盖不足，适合用户手动结束或信号尚未确定的采集。
--ptype <list>：启用 trace 的进程类型（逗号分隔，透传 MOZ_DOM_TRACE_PTYPE），不传则全部进程类型；大页面可只留主/content 进程减少无关日志。
--trace-env KEY=VALUE（可多次）：透传 RuyiTrace 定向 trace 开关（仅 MOZ_DOM_ 前缀；KEY=VALUE 里的值含空格时整体加引号）。
  定向组合示例（先判题型再选最小开关，避免日志过大，完整清单见 references/tooling/ruyitrace-cheatsheet.md）：
    # 已知目标脚本，只缩小 jscall 记录范围并排除噪声（日志量最大的降幅来源）：
    --trace-env MOZ_DOM_JSCALL_TRACE=1 --trace-env "MOZ_DOM_JSCALL_SCRIPT_URL=challenge.js;static/crypto" --trace-env "MOZ_DOM_JSCALL_SCRIPT_URL_EXCLUDE=analytics;telemetry" --trace-env MOZ_DOM_JSCALL_SHALLOW=1
    # 已知函数名，只记目标函数及子调用并抓参数/返回值真值：
    --trace-env MOZ_DOM_JSCALL_TRACE=1 --trace-env MOZ_DOM_JSCALL_TARGET_ONLY=1 --trace-env "MOZ_DOM_JSCALL_DETAIL_FUNCS=encrypt,sign" --trace-env MOZ_DOM_JSCALL_SHALLOW=1
    # 不知函数名：按脚本来源整体抓真值（长密文补 DEEP_LONG_STR 防截断）：
    --trace-env MOZ_DOM_JSCALL_TRACE=1 --trace-env MOZ_DOM_JSCALL_SCRIPT_URL=target.js --trace-env MOZ_DOM_JSCALL_DETAIL_SCRIPT_URL=target.js --trace-env MOZ_DOM_JSCALL_SHALLOW=1 --trace-env MOZ_DOM_JSCALL_DEEP_LONG_STR=512
    # 还原 jsvmp 指令流（autodetect；重混淆站点加 MIN_BYTECODE=128 MIN_SPAN=200）：
    --trace-env MOZ_DOM_JSVMP_TRACE=1 --trace-env "MOZ_DOM_JSVMP_SCRIPT_URL=challenges.example.com" --trace-env MOZ_DOM_JSVMP_AUTODETECT=1
--cookie "name=value"（可多次，或 "a=1; b=2" 分号分隔）：启动前向 trace profile 的 cookies.sqlite 预写 Cookie，用于需预置登录态/会话的页面取 Business 完整链路。
--cookie-domain <domain>：--cookie 写入的目标域名（如 .bilibili.com），缺省取 --url 主机（含点前缀）。
`;
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function isDir(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function run(cmd, args, timeout = 8000) {
  const ret = spawnSync(cmd, args, { encoding: 'utf8', timeout, windowsHide: true });
  return { ok: ret.status === 0, stdout: ret.stdout || '', stderr: ret.stderr || '' };
}

function detectRuyiTrace(args) {
  const home = paths.normalizeTraceHome({ ruyitraceHome: args.ruyitraceHome, ruyitraceExe: args.ruyitraceExe, projectDir: args.projectDir || paths.resolveProjectDirFromCaseDir(args.caseDir) });
  const exeName = process.platform === 'win32' ? 'RuyiTrace.exe' : 'RuyiTrace';
  const exe = args.ruyitraceExe ? path.resolve(args.ruyitraceExe) : (home ? path.join(home, exeName) : '');
  // 兼容两代 RuyiTrace 内核路径：
  //   新版 2.5+（Electron 壳）：<home>/resources/kernel/firefox(.exe) + RUYI_DOMTRACE.txt
  //   旧版 1.x（自带 firefox/）：<home>/firefox/firefox(.exe) + RUYI_DOMTRACE.txt
  const firefoxName = process.platform === 'win32' ? 'firefox.exe' : 'firefox';
  const candidates = [
    { kind: 'new', firefoxExe: path.join(home || '', 'resources', 'kernel', firefoxName), marker: path.join(home || '', 'resources', 'kernel', 'RUYI_DOMTRACE.txt') },
    { kind: 'legacy', firefoxExe: path.join(home || '', 'firefox', firefoxName), marker: path.join(home || '', 'firefox', 'RUYI_DOMTRACE.txt') },
  ];
  const kernel = candidates.find((c) => exists(c.firefoxExe) && exists(c.marker)) || candidates[0];
  const firefoxExe = kernel.firefoxExe;
  const marker = kernel.marker;
  const installed = exists(exe) && exists(firefoxExe) && exists(marker);
  return {
    installed,
    home,
    exe,
    exeExists: exists(exe),
    firefoxExe,
    firefoxExists: exists(firefoxExe),
    marker,
    markerExists: exists(marker),
    reason: installed ? '' : `RuyiTrace 不完整：需要 RuyiTrace 可执行文件，以及 ${kernel.kind === 'new' ? 'resources/kernel' : 'firefox'}/firefox(.exe) 与同目录 RUYI_DOMTRACE.txt`,
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function buildPlan(args, trace) {
  const caseDir = path.resolve(args.caseDir || '.');
  const caseSubdir = path.join(caseDir, 'case');
  const outDir = path.resolve(args.outDir || path.join(caseSubdir, 'ruyi-trace', 'logs'));
  const profileDir = path.resolve(args.profileDir || path.join(caseSubdir, 'tmp', 'ruyitrace-profile'));
  const traceFile = path.join(outDir, `trace-${timestamp()}.ndjson`);
  const firefoxArgs = ['-no-remote', '-new-instance', '-profile', profileDir];
  if (args.url) firefoxArgs.push(args.url);
  return {
    caseDir,
    outDir,
    profileDir,
    traceFile,
    firefoxExe: trace.firefoxExe,
    firefoxArgs,
    presetCookies: {
      count: parseCookieArgs(args.cookies).length,
      domain: args.cookieDomain,
    },
    env: {
      MOZ_DOM_TRACE: '1',
      MOZ_DOM_TRACE_FILE: traceFile,
      MOZ_DOM_TRACE_LIMIT: String(args.limit),
      MOZ_DISABLE_LAUNCHER_PROCESS: '1',
      ...(args.ptype ? { MOZ_DOM_TRACE_PTYPE: args.ptype } : {}),
      ...(args.traceEnvPairs || {}),
    },
  };
}

// 递归扫描目录下 NDJSON/JSONL（兼容新版分目录结构：domtrace/ 主日志 + jscall/cookie/descriptor/event/storage
// 分类——jscall 等派生模块日志后缀为 .jsonl；也兼容旧版顶层单文件）。优先返回 domtrace/ 下的主日志，
// 其余按修改时间倒序。
// sinceMs 容差 10s：新版内核启动较慢（Firefox 155 重 fork），日志文件可能晚于采集起点才创建/写入。
function walkNdjson(dir) {
  if (!isDir(dir)) return [];
  const out = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { entries = []; }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(?:ndjson|jsonl)$/i.test(ent.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function listNdjsonFiles(dir, sinceMs) {
  const out = walkNdjson(dir);
  if (!out.length) return [];
  const fresh = out.filter((file) => {
    try { return fs.statSync(file).mtimeMs >= sinceMs - 10000; } catch { return false; }
  });
  const rank = (p) => {
    const inDom = /[\\/]domtrace[\\/]/.test(p) ? 0 : 1;
    let m = 0;
    try { m = fs.statSync(p).mtimeMs; } catch { m = 0; }
    return [inDom, -m];
  };
  return fresh.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1];
  });
}

// 读 NDJSON 识别 process_type：parent=浏览器父进程/内核活动（不含页面 JS，参与 target-signal 必然误报），
// tab/content=页面内容进程（真正的业务 JS 调用）。
// 兜底策略（match14 教训：52615 行的 content 日志被整体排除，自动导入只剩 1 行 event 日志）：
// 1) 单行可能超过 8KB（长 stack/args），只读 8KB 会截断导致 JSON.parse 失败 → 逐级放大到 1MB 重读；
// 2) 首行可能是非 JSON 头部或写入中的残行 → 依次探测前若干完整行；
// 3) 全部失败时正则兜底直接从文本里抓 "process_type":"xxx"。
function readProcessType(file) {
  for (const size of [8192, 262144, 1048576]) {
    let text = '';
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(size);
        const n = fs.readSync(fd, buf, 0, size, 0);
        text = buf.slice(0, n).toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return '';
    }
    if (!text) return '';
    const lines = text.split('\n');
    const complete = text.endsWith('\n') ? lines : lines.slice(0, -1);
    for (const line of complete.slice(0, 20)) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        if (evt && evt.process_type) return String(evt.process_type);
      } catch { /* 继续探测下一行 */ }
    }
    const m = /"process_type"\s*:\s*"([^"]+)"/.exec(text);
    if (m) return m[1];
    // 已读到完整行仍未识别：放大窗口也只是读到更后面的同类记录，直接判定未识别
    if (complete.length) return '';
  }
  return '';
}

// 统计 NDJSON 行数（用于导入不足时的候选文件诊断）。大文件按块读，不整体载入内存。
function countNdjsonLines(file) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const chunk = 1024 * 1024;
      const buf = Buffer.alloc(chunk);
      let cursor = 0;
      let lines = 0;
      let lastByte = 0;
      while (cursor < size) {
        const n = fs.readSync(fd, buf, 0, Math.min(chunk, size - cursor), cursor);
        if (n <= 0) break;
        for (let i = 0; i < n; i += 1) if (buf[i] === 10) lines += 1;
        lastByte = buf[n - 1];
        cursor += n;
      }
      if (size > 0 && lastByte !== 10) lines += 1;
      return lines;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return -1;
  }
}

// 自动导入未覆盖主 DOM trace 时，枚举输出目录下全部 NDJSON 候选（行数 / process_type / 被排除原因），
// 并给出可直接执行的手动导入命令，避免“静默只导入分类日志”让人误判为无日志可用。
function describeTraceCandidates(outDir, sinceMs, picked) {
  const pickedSet = new Set((picked || []).map((f) => path.resolve(f)));
  const all = walkNdjson(outDir);
  return all.map((file) => {
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch { mtimeMs = 0; }
    const isDom = /[\\/]domtrace[\\/]/.test(file);
    const processType = isDom ? readProcessType(file) : '';
    const stale = mtimeMs < sinceMs - 10000;
    const reasons = [];
    if (!isDom) reasons.push('非 domtrace 分类日志（cookie/storage/event/descriptor 等，不含业务接口调用）');
    if (stale) reasons.push(`早于本次采集起点（mtime ${new Date(mtimeMs).toISOString()}，采集起点 ${new Date(sinceMs).toISOString()}）`);
    if (isDom && processType === 'parent') reasons.push('process_type=parent（浏览器父进程/内核活动，不含页面 JS）');
    if (isDom && !processType) reasons.push('process_type 无法识别（首行非法/写入中）');
    return {
      file,
      lines: countNdjsonLines(file),
      processType: processType || (isDom ? '<未识别>' : '<分类日志>'),
      imported: pickedSet.has(path.resolve(file)),
      excludedReasons: reasons,
    };
  }).sort((a, b) => b.lines - a.lines);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 检测 kernel firefox 进程是否存活（Windows）。返回进程数；非 Windows 或查询失败返回 null（表示不检测）。
// 用户手动关闭浏览器（或浏览器崩溃）后，ExecutablePath 匹配内核 firefox 的进程数归零。
function kernelFirefoxAlive(firefoxExe) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !firefoxExe) { resolve(null); return; }
    const esc = (s) => String(s).replace(/'/g, "''");
    const ps = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `@(Get-CimInstance Win32_Process -Filter "Name='firefox.exe'" | Where-Object { $_.ExecutablePath -eq '${esc(firefoxExe.replace(/\//g, '\\'))}' }).Count`,
    ], { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    ps.once('error', () => resolve(null));
    ps.once('exit', () => {
      const n = parseInt(out.trim(), 10);
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    // child 已退出（exitCode !== null）时 once('exit') 不会触发，直接按已退出处理
    if (child.exitCode !== null || child.signalCode !== null) {
      finish({ exited: true, code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once('exit', (code, signal) => finish({ exited: true, code, signal }));
    // 不用 unref：若 child 已死且无其他引用，unref 定时器不阻止进程退出，
    // 会导致 promise 链被截断（输出丢失 / kill 未完成 / 残留进程）。保留引用等待超时。
    setTimeout(() => finish({ exited: false, code: null, signal: null }), timeoutMs);
  });
}

// 增量扫描新写入的 NDJSON。旧实现只扫描文件尾部 1MB，早先命中的 signal
// 在日志继续增长后会被漏掉；同时记录每个文件的 offset，避免反复读取大日志。
// 每个信号展开为 needle 组（组内 AND、组间 OR）：Interface.member 形态的信号除原子串外，
// 增加 interface/member 分存字段组——RuyiTrace 记录 {"interface":"X","member":"y"}，
// 原子串永不命中（match12 实测 XMLHttpRequest.open ×0）。
function scanSignalsIncremental(files, signals, state) {
  if (!signals || !signals.length || !files.length) return false;
  state.offsets = state.offsets || new Map();
  state.carry = state.carry || new Map();
  const sameSignals = state.signalSource && state.signalSource.length === signals.length
    && state.signalSource.every((s, i) => String(s) === String(signals[i]));
  if (!sameSignals) {
    state.signalSource = signals.slice();
    state.signalGroups = signals.map((s) => traceSignalNeedleGroups(s));
    state.observed = new Set();
  }
  const observed = state.observed;
  const allNeedles = state.signalGroups.flat(2);
  const maxNeedleLen = allNeedles.reduce((m, n) => Math.max(m, n.length), 1);
  for (const file of files) {
    try {
      const st = fs.statSync(file);
      const previous = state.offsets.get(file) || 0;
      const start = st.size < previous ? 0 : previous;
      const length = st.size - start;
      if (length <= 0) continue;
      const fd = fs.openSync(file, 'r');
      let carry = st.size < previous ? '' : (state.carry.get(file) || '');
      let cursor = start;
      const chunkSize = 1024 * 1024;
      while (cursor < st.size) {
        const size = Math.min(chunkSize, st.size - cursor);
        const buf = Buffer.alloc(size);
        fs.readSync(fd, buf, 0, size, cursor);
        const text = `${carry}${buf.toString('utf8')}`.toLowerCase();
        state.signalGroups.forEach((groups, index) => {
          if (observed.has(index)) return;
          if (groups.some((group) => group.every((needle) => text.includes(needle)))) observed.add(index);
        });
        carry = text.slice(-Math.max(0, maxNeedleLen - 1));
        cursor += size;
      }
      fs.closeSync(fd);
      state.offsets.set(file, st.size);
      state.carry.set(file, carry);
    } catch { /* file may still be rotating */ }
  }
  return observed.size === signals.length;
}

function runSelfTest() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-trace-signal-'));
  const file = path.join(root, 'trace.ndjson');
  const state = { offsets: new Map(), carry: new Map(), observed: new Set() };
  try {
    fs.writeFileSync(file, '{"api":"hand', 'utf8');
    if (scanSignalsIncremental([file], ['handshake'], state)) throw new Error('拆分信号不应在首段提前命中');
    fs.appendFileSync(file, 'shake"}\n', 'utf8');
    if (!scanSignalsIncremental([file], ['handshake'], state)) throw new Error('跨写入边界的信号应被命中');
    fs.appendFileSync(file, 'x'.repeat(1024 * 1024 + 128), 'utf8');
    if (!scanSignalsIncremental([file], ['handshake'], state)) throw new Error('日志继续增长后应记住已命中的信号');
    // Interface.member 分存字段匹配：记录无 "XMLHttpRequest.open" 连续子串，也应命中
    const file2 = path.join(root, 'trace2.ndjson');
    fs.writeFileSync(file2, '{"type":"call","interface":"XMLHttpRequest","member":"open","args":["GET","/api"]}\n', 'utf8');
    const state2 = { offsets: new Map(), carry: new Map() };
    if (!scanSignalsIncremental([file2], ['XMLHttpRequest.open'], state2)) throw new Error('Interface.member 信号应命中分存字段记录');
    // process_type 识别兜底：首行超过 8KB（长 stack）时不得判定失败（match14：content 日志被整体排除）
    const domDir = path.join(root, 'domtrace');
    fs.mkdirSync(domDir, { recursive: true });
    const bigFirst = path.join(domDir, 'trace_process_1.ndjson');
    const longStack = 'x'.repeat(20000);
    fs.writeFileSync(bigFirst, `${JSON.stringify({ process_type: 'tab', stack: longStack })}\n${JSON.stringify({ process_type: 'tab' })}\n`, 'utf8');
    if (readProcessType(bigFirst) !== 'tab') throw new Error('首行超 8KB 时应仍能识别 process_type');
    // 首行非法（写入中残行）时应探测后续行
    const brokenFirst = path.join(domDir, 'trace_process_2.ndjson');
    fs.writeFileSync(brokenFirst, `{"process_type":"pa\n${JSON.stringify({ process_type: 'content' })}\n`, 'utf8');
    if (readProcessType(brokenFirst) !== 'content') throw new Error('首行残缺时应从后续行识别 process_type');
    // 行数统计与候选诊断
    if (countNdjsonLines(brokenFirst) !== 2) throw new Error('countNdjsonLines 应统计 2 行');
    const cands = describeTraceCandidates(root, Date.now() - 60000, [bigFirst]);
    const picked = cands.find((c) => path.resolve(c.file) === path.resolve(bigFirst));
    const missed = cands.find((c) => path.resolve(c.file) === path.resolve(brokenFirst));
    if (!picked || !picked.imported) throw new Error('已导入文件应标记 imported');
    if (!missed || missed.imported) throw new Error('未导入文件应标记为未导入');
    if (missed.processType !== 'content') throw new Error('候选诊断应带出 process_type');
    if (cands.some((c) => c.lines < 0)) throw new Error('候选诊断行数不应为负');
    // 定向 trace 开关透传：合法 MOZ_DOM_ key、非法前缀、脚本托管 key 三种路径
    const envParsed = parseTraceEnv(['MOZ_DOM_JSCALL_TRACE=1', 'MOZ_DOM_JSCALL_SCRIPT_URL=a.js;b.js']);
    if (envParsed.MOZ_DOM_JSCALL_TRACE !== '1' || envParsed.MOZ_DOM_JSCALL_SCRIPT_URL !== 'a.js;b.js') throw new Error('--trace-env 应解析 KEY=VALUE');
    let threw = false;
    try { parseTraceEnv(['MOZ_DOM_JSVMP_TRACE=1', 'MOZ_OTHER=1']); } catch { threw = true; }
    if (!threw) throw new Error('非 MOZ_DOM_ 前缀应被拒绝');
    threw = false;
    try { parseTraceEnv(['MOZ_DOM_TRACE=0']); } catch { threw = true; }
    if (!threw) throw new Error('覆盖脚本管理的 key 应被拒绝');
    // walkNdjson 应同时发现 .ndjson 与 .jsonl（jscall 派生日志）
    const jscallDir = path.join(root, 'jscall');
    fs.mkdirSync(jscallDir, { recursive: true });
    fs.writeFileSync(path.join(jscallDir, 'trace_jscall_process_1.jsonl'), '{"kind":"jscall"}\n', 'utf8');
    if (walkNdjson(root).length !== 5) throw new Error('walkNdjson 应匹配 .ndjson 与 .jsonl');
    // 参数报错精细化：缺值 / 非法枚举 / 拼错参数名各给出定向提示，不再回落全量 usage
    threw = '';
    try { parseArgs(['node', 'x', '--trace-signal']); } catch (e) { threw = e.message; }
    if (!/--trace-signal 缺少取值/.test(threw)) throw new Error('信号参数缺值应报出参数名');
    threw = '';
    try { parseArgs(['node', 'x', '--signal-policy', 'loose']); } catch (e) { threw = e.message; }
    if (!/只接受 strict 或 advisory/.test(threw)) throw new Error('--signal-policy 非法取值应列出合法值');
    threw = '';
    try { parseArgs(['node', 'x', '--trace-signals', 'abc']); } catch (e) { threw = e.message; }
    if (!/是否想用 --trace-signal/.test(threw)) throw new Error('拼错参数名应给出最接近的合法参数');
    threw = '';
    try { parseArgs(['node', 'x', '--trace-signal', 'ab']); } catch (e) { threw = e.message; }
    if (!/最少 3 字符/.test(threw)) throw new Error('信号过短应告知最短长度');
    return { clean: true, tests: 19 };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function mainTraceFiles(files) {
  const dom = files.filter((f) => /[\\/]domtrace[\\/]/.test(f));
  const content = dom.filter((f) => {
    const pt = readProcessType(f);
    return pt && pt !== 'parent';
  });
  return content.length ? content : dom;
}

async function waitForTraceFlush(outDir, sinceMs, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let previous = '';
  while (Date.now() < deadline) {
    // 进程退出后某些 content 进程可能才创建/关闭自己的 NDJSON；每轮重新发现文件，
    // 不把“第一次扫描时尚不存在的日志”漏掉。
    const files = listNdjsonFiles(outDir, sinceMs);
    let signature = '';
    let allStable = true;
    for (const file of files) {
      try {
        const st = fs.statSync(file);
        signature += `${file}:${st.size}:${st.mtimeMs};`;
        if (st.size > 0) {
          const fd = fs.openSync(file, 'r');
          const buf = Buffer.alloc(1);
          fs.readSync(fd, buf, 0, 1, st.size - 1);
          fs.closeSync(fd);
          // 只接受完整 NDJSON 行：日志尾部“某处出现过换行”不能证明最后一条已刷盘。
          // 用户关闭浏览器时尤其容易留下半条 JSON；等到最后一个字节为 LF 再导入。
          if (buf[0] !== 0x0a) allStable = false;
        }
      } catch { allStable = false; }
    }
    if (signature === previous && allStable) return;
    previous = signature;
    await wait(250);
  }
}

async function waitForKernelStopped(firefoxExe, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await kernelFirefoxAlive(firefoxExe);
    if (last === null || last === 0) return last;
    await wait(250);
  }
  return last;
}

// 结束 trace Firefox 进程（多进程树 + 内核迁移兜底）：
// 1. 先按 spawn 主 PID 用 taskkill /T /F 杀进程树（旧版结构有效）；
// 2. 新版（2.5+ / Firefox 155）主进程可能重 fork，CommandLine 不含 profile，
//    因此再按 firefox 可执行文件路径精确匹配（ExecutablePath == kernel firefox）
//    杀掉全部实例（主进程 + content/GPU 子进程），避免残留锁 profile；
//    profile 匹配作为第三层兜底（旧版结构 CommandLine 含 profile）。
function killProcessTree(pid, profileDir, firefoxExe) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(ok);
    };

    // 带超时包装的 spawn 调用，防止 taskkill/PowerShell 卡死导致进程清理 hang 住
    function spawnWithTimeout(cmd, args, timeoutMs = 15000) {
      return new Promise((res) => {
        const child = spawn(cmd, args, { windowsHide: true });
        const timer = setTimeout(() => {
          try { child.kill(); } catch { /* ignore */ }
          res(false);
        }, timeoutMs);
        child.once('error', () => { clearTimeout(timer); res(false); });
        child.once('exit', (code) => { clearTimeout(timer); res(code === 0); });
      });
    }

    const attempts = [];
    if (pid) {
      attempts.push(spawnWithTimeout(
        process.platform === 'win32' ? 'taskkill' : 'kill',
        process.platform === 'win32' ? ['/PID', String(pid), '/T', '/F'] : ['-TERM', `-${pid}`]
      ));
    }

    if (process.platform === 'win32') {
      const esc = (s) => String(s).replace(/'/g, "''");
      const matchers = [];
      // 第 2 层：按 kernel firefox 可执行文件路径精确匹配（主进程重 fork 后 CommandLine 可能无参数）
      if (firefoxExe) {
        matchers.push(`($_.ExecutablePath -eq '${esc(firefoxExe.replace(/\//g, '\\'))}')`);
      }
      // 第 3 层：按 profile 路径匹配 CommandLine（旧版结构）
      if (profileDir) {
        const back = esc(profileDir.replace(/\//g, '\\'));
        const fwd = esc(profileDir.replace(/\\/g, '/'));
        matchers.push(`($_.CommandLine -like '*${back}*')`);
        matchers.push(`($_.CommandLine -like '*${fwd}*')`);
      }
      if (matchers.length) {
        attempts.push(spawnWithTimeout('powershell', [
          '-NoProfile', '-NonInteractive', '-Command',
          `Get-CimInstance Win32_Process -Filter "Name='firefox.exe'" | Where-Object { ${matchers.join(' -or ')} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
        ], 15000));
      }
    }

    if (!attempts.length) { finish(false); return; }
    Promise.all(attempts).then((results) => finish(results.some(Boolean)));
  });
}

function importLog(caseDir, files, markdown, targetSignals, writeSummary, signalPolicy = 'strict') {
  const script = path.join(__dirname, 'import_ruyitrace_log.js');
  const list = Array.isArray(files) ? files : [files];
  const args = [script, '--case-dir', caseDir, '--truncation-threshold', '3900', markdown ? '--markdown' : '--json'];
  for (const f of list) args.push('--input', f);
  if (writeSummary === false) args.push('--no-summary-write');
  for (const s of targetSignals || []) args.push('--trace-signal', s);
  args.push('--signal-policy', signalPolicy);
  const ret = spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true });
  return { ok: ret.status === 0, status: ret.status, stdout: ret.stdout || '', stderr: ret.stderr || '' };
}

// 解析 cookies 输入：合并多次 --cookie，支持 "a=1; b=2" 分号分隔，以及单元素内含分号的字符串。
// 与 ruyipage --cookie 语义一致：值是纯字符串集合（由 set/get 层透传给目标浏览器），
// 这里解析为 [name, value] 列表以便写入 cookies.sqlite。
function parseCookieArgs(rawList) {
  const out = [];
  for (const item of (rawList || [])) {
    if (typeof item !== 'string' || !item.trim()) continue;
    for (const seg of item.split(';')) {
      const s = seg.trim();
      if (!s) continue;
      const eq = s.indexOf('=');
      if (eq <= 0) continue;
      out.push({ name: s.slice(0, eq).trim(), value: s.slice(eq + 1).trim() });
    }
  }
  return out;
}

function defaultCookieHost(url) {
  try {
    const host = new URL(url).hostname; // 'match.x.com'；Firefox 要求 host 以点前缀 .x.com 才跨子域
    return host.startsWith('.') ? host : `.${host}`;
  } catch { return ''; }
}

// 启动前把预置 Cookie 写入 trace profile 的 cookies.sqlite（Firefox 116+ schema）。
// 必须在 Firefox 未运行时调用（spawn 之前），否则文件被锁/WAL 冲突。
// 返回写入条数；失败返回 0 并告警（不阻断后续启动，可继续手动登录兜底）。
function writePresetCookies(args, profileDir, url) {
  if (!(args.cookies && args.cookies.length)) return 0;
  const pairs = parseCookieArgs(args.cookies);
  if (!pairs.length) return 0;
  const dbPath = path.join(profileDir, 'cookies.sqlite');
  ensureDir(profileDir);
  // 旧 cookie 文件残留（如上次 session 生成）会带已有记录与不同 schema；这里不删除，
  // 仅做 INSERT OR REPLACE 按 (name, host, path, originAttributes) 唯一约束覆盖。
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath);
  } catch (e) {
    console.error(`[警告] 预置 Cookie 写入跳过（无法打开 SQLite）：${e.message}`);
    return 0;
  }
  try {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='moz_cookies'").get()) {
      // 首次无 cookies.sqlite 时按 Firefox schema 建表（表版本与 Firefox 116+ 一致，
      // zstd/JSON 等扩展列缺省；仅常规 host cookie，无 partitionKey 场景）
      db.exec(`CREATE TABLE IF NOT EXISTS moz_cookies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        originAttributes TEXT NOT NULL DEFAULT '',
        name TEXT, value TEXT, host TEXT, path TEXT,
        expiry INTEGER, lastAccessed INTEGER, creationTime INTEGER,
        isSecure INTEGER, isHttpOnly INTEGER, inBrowserElement INTEGER DEFAULT 0,
        sameSite INTEGER DEFAULT 0, schemeMap INTEGER DEFAULT 0,
        isPartitionedAttributeSet INTEGER DEFAULT 0, updateTime INTEGER,
        CONSTRAINT moz_uniqueid UNIQUE (name, host, path, originAttributes))`);
    }
    db.prepare('CREATE INDEX IF NOT EXISTS moz_cookies_host_idx ON moz_cookies(host)');
    const ins = db.prepare(`INSERT INTO moz_cookies
      (originAttributes, name, value, host, path, expiry, lastAccessed, creationTime, isSecure, isHttpOnly, inBrowserElement, sameSite, schemeMap, isPartitionedAttributeSet, updateTime)
      VALUES (@originAttributes, @name, @value, @host, @path, @expiry, @lastAccessed, @creationTime, @isSecure, @isHttpOnly, @inBrowserElement, @sameSite, @schemeMap, @isPartitionedAttributeSet, @updateTime)
      ON CONFLICT(name, host, path, originAttributes) DO UPDATE SET value=@value, expiry=@expiry`);
    const now = Date.now();
    const host = args.cookieDomain || defaultCookieHost(url);
    db.exec('BEGIN');
    try {
      for (const c of pairs) {
        ins.run({
          originAttributes: '',
          name: c.name,
          value: c.value,
          host,
          path: '/',
          // Firefox expiry 用毫秒时间戳（PRTime/微秒的 ms 兼容），这里给未来一年
          expiry: now + 365 * 24 * 3600 * 1000,
          lastAccessed: now * 1000,
          creationTime: now * 1000,
          isSecure: 1, // 预置登录态 cookie 通常需 Secure；跨子域用 https
          isHttpOnly: 0,
          inBrowserElement: 0,
          sameSite: 256, // LAX
          schemeMap: 2,  // https
          isPartitionedAttributeSet: 0,
          updateTime: now * 1000,
        });
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    console.log(`已向 trace profile 预写 ${pairs.length} 条 Cookie（host=${host || '<缺省>'}）`);
    return pairs.length;
  } catch (e) {
    console.error(`[警告] 预置 Cookie 写入失败（继续启动，可手动登录兜底）：${e.message}`);
    try { db.close(); } catch {}
    return 0;
  } finally {
    try { db.close(); } catch {}
  }
}

async function capture(args, plan) {
  ensureDir(plan.outDir);
  ensureDir(plan.profileDir);
  writePresetCookies(args, plan.profileDir, args.url);
  const startedAt = Date.now();
  const child = spawn(plan.firefoxExe, plan.firefoxArgs, {
    env: { ...process.env, ...plan.env },
    stdio: 'ignore',
    windowsHide: false,
  });
  const result = {
    launched: true,
    pid: child.pid,
    waitedSeconds: args.duration,
    killAttempted: false,
    killMethod: '',
    killOk: false,
    exitedEarly: false,
    exit: null,
    logs: [],
    importResult: null,
    endReason: 'duration',
    startedAt: new Date(startedAt).toISOString(),
    collectionDeadlineAt: new Date(startedAt + args.duration * 1000).toISOString(),
  };
  child.on('error', (err) => { result.launchError = err.message || String(err); });
  try {
    // 等待采集：duration 为总兜底；用户手动关闭浏览器（或浏览器崩溃）→
    // kernel firefox 进程归零 → 立即提前结束，不必等满 duration。
    // 进程检测只在 Windows 且"曾经见过内核进程"后生效（启动慢/从未出现进程时按 duration 兜底）。
    const pollMs = 1500;
    const deadline = Date.now() + args.duration * 1000;
    let everSeen = false;
    const signalState = { offsets: new Map(), carry: new Map(), observed: new Set() };
    while (Date.now() < deadline) {
      const currentLogs = mainTraceFiles(listNdjsonFiles(plan.outDir, startedAt));
      if (args.endSignals.length && scanSignalsIncremental(currentLogs, args.endSignals, signalState)) {
        result.endReason = 'end-signal-observed';
        console.log('[capture] 已观察到全部 end-signal，开始收尾');
        break;
      }
      const alive = await kernelFirefoxAlive(plan.firefoxExe);
      if (alive !== null) {
        if (alive > 0) {
          everSeen = true;
        } else if (everSeen) {
          result.exitedEarly = true;
          result.endReason = 'browser-closed-by-user-or-crash';
          console.log(`[capture] 检测到浏览器已关闭，提前结束采集（已用时 ${Math.round((Date.now() - startedAt) / 1000)}s）`);
          break;
        }
      }
      await wait(pollMs);
    }
    if (Date.now() >= deadline && result.endReason === 'duration') result.endReason = 'duration-timeout';
  } finally {
    // 采集结束（成功或异常）一律主动关闭浏览器进程树，避免残留进程锁住 profile。
    // 注意：spawn 的 launcher PID 可能在采集期间自己退出（Firefox 155 重 fork 主进程），
    // 不能因 child 已退出就跳过 kill —— 真实浏览器主进程/子进程可能仍存活。
    if (!result.launchError) {
      result.killAttempted = true;
      result.killMethod = process.platform === 'win32' ? 'taskkill-tree+exe/profile-match' : 'kill-group';
      try {
        result.killOk = await killProcessTree(child.pid, plan.profileDir, plan.firefoxExe);
        if (!result.killOk) {
          result.killError = '进程树/按 exe·profile 匹配结束失败，回退 child.kill()';
          try {
            child.kill();
            result.killOk = await waitForExit(child, 3000).then((e) => e.exited);
          } catch (err) {
            result.killError = err.message || String(err);
          }
        }
      } catch (err) {
        result.killError = err.message || String(err);
      }
      result.exit = await waitForExit(child, 3000);
      result.remainingFirefoxProcesses = await waitForKernelStopped(plan.firefoxExe, 5000);
      if (result.remainingFirefoxProcesses > 0) {
        result.killOk = false;
        result.killError = `结束后仍有 ${result.remainingFirefoxProcesses} 个 trace Firefox 进程存活`;
      }
    }
  }
  result.logs = listNdjsonFiles(plan.outDir, startedAt);
  await waitForTraceFlush(plan.outDir, startedAt, 3000);
  result.logs = listNdjsonFiles(plan.outDir, startedAt);
  result.finishedAt = new Date().toISOString();
  result.elapsedSeconds = Math.round((Date.now() - startedAt) / 100) / 10;
  if (args.importAfter && result.logs.length) {
    // 主 DOM trace = domtrace/ 下 process_type 非 parent 的内容进程文件，合并导入（RuyiTrace 多进程各写一个
    // domtrace 文件：tab/content 进程才是业务 JS，parent 是浏览器父进程/内核活动）。按 mtime 取单个文件会漏掉
    // 真正的业务 JS 调用、或误取 parent 内核空壳（resource://gre/modules 等，不含页面 JS，参与 target-signal
    // 必然误报）。分类日志（cookie/storage/event/descriptor/eval/wasm）不含业务目标接口路径，逐文件硬门禁必然误报，
    // 只导入做摘要（不带 --target-signal、不写 summary）。ruyitrace-summary.md 只反映主 DOM trace 合并结果。
    const isDomtrace = (f) => /[\\/]domtrace[\\/]/.test(f);
    let domFiles = result.logs.filter(isDomtrace);
    const catFiles = result.logs.filter((f) => !isDomtrace(f));
    // 抢救分支（match14 教训）：mtime 容差把真正的 content 进程日志过滤掉后，domFiles 为空，
    // 原实现会静默只导入分类日志（event 1 行）而看不出问题。此处忽略 mtime，直接取输出目录下
    // 全部 domtrace 文件重新参与选择，并记录抢救原因供摘要展示。
    if (!domFiles.length) {
      const rescued = walkNdjson(plan.outDir).filter(isDomtrace);
      if (rescued.length) {
        domFiles = rescued;
        result.mainTraceRescued = `按采集起点（mtime 容差 10s）未发现 domtrace 主日志，已忽略时间过滤抢救 ${rescued.length} 个 domtrace 文件参与导入`;
      }
    }
    const mainFiles = domFiles.filter((f) => {
      const pt = readProcessType(f);
      return pt && pt !== 'parent';
    });
    // 识别不出非 parent 的 domtrace 文件（异常或全 parent）时退化为全部 domtrace 文件，
    // 交由 import_ruyitrace_log 的质量判定（无页面 JS → 重度不足）兜底报错。
    const effectiveMain = mainFiles.length ? mainFiles : domFiles;
    result.importResults = [];
    result.logLabels = [];
    // 人工关闭通常意味着用户刚完成交互但尚未提前配置准确 writer 信号；
    // 保留有效 NDJSON 并在摘要中报告覆盖不足，避免把“有日志但信号未命中”误报成导入失败。
    // 后续 check_trace_gate 仍按 targetCoverage 严格阻断，因此 advisory 只改变分类，不放宽门禁。
    const importSignalPolicy = result.endReason === 'browser-closed-by-user-or-crash'
      ? 'advisory'
      : args.signalPolicy;
    result.importSignalPolicy = importSignalPolicy;
    if (effectiveMain.length) {
      result.importResults.push(importLog(plan.caseDir, effectiveMain, args.markdown, args.evidenceSignals, true, importSignalPolicy));
      result.logLabels.push(`主 DOM trace（合并 ${effectiveMain.length} 个进程文件）`);
    }
    for (const file of catFiles) {
      result.importResults.push(importLog(plan.caseDir, file, args.markdown, [], false));
      result.logLabels.push(path.basename(file));
    }
    // 导入覆盖自查：主 trace 缺失、或输出目录里存在未导入且比已导入主 trace 更大的候选
    //（说明真正的页面 JS 日志被漏掉），一律输出候选清单与手动导入命令，禁止静默降级为“只有分类日志”。
    const candidates = describeTraceCandidates(plan.outDir, startedAt, effectiveMain.concat(catFiles));
    const mainSet = new Set(effectiveMain.map((f) => path.resolve(f)));
    const mainMaxLines = candidates
      .filter((c) => mainSet.has(path.resolve(c.file)))
      .reduce((m, c) => Math.max(m, c.lines), 0);
    const missedBigger = candidates.filter((c) => !c.imported && c.lines > mainMaxLines);
    if (!effectiveMain.length || result.mainTraceRescued || missedBigger.length) {
      result.traceCandidates = candidates;
      result.manualImportCommands = candidates
        .filter((c) => !c.imported && c.lines > 1)
        .map((c) => `node scripts/import_ruyitrace_log.js --case-dir ${path.resolve(plan.caseDir)} --input ${c.file} --markdown`);
      result.importCoverageWarning = !effectiveMain.length
        ? '未导入任何主 DOM trace（domtrace/ 下无可用文件），当前摘要只反映分类日志，不能作为 trace 证据；请按下方候选清单手动导入或重新采集。'
        : (missedBigger.length
          ? `存在未导入的更大候选日志（最大 ${missedBigger[0].lines} 行 > 已导入主 trace 最大 ${mainMaxLines} 行），可能漏掉真正的页面 JS trace；请核对候选清单并按需手动导入。`
          : result.mainTraceRescued);
    }
  }
  return result;
}

function renderMarkdown(obj) {
  const { args, trace, plan, result } = obj;
  const lines = ['# RuyiTrace 自动捕获日志', ''];
  lines.push(`- RuyiTrace 检测结果：${trace.installed ? '通过' : '不通过'}`);
  if (trace.home) lines.push(`- RuyiTrace 目录：${trace.home}`);
  if (trace.exe) lines.push(`- RuyiTrace 可执行文件：${trace.exeExists ? '存在' : '不存在'} - ${trace.exe}`);
  if (trace.firefoxExe) lines.push(`- trace Firefox：${trace.firefoxExists ? '存在' : '不存在'} - ${trace.firefoxExe}`);
  if (trace.marker) lines.push(`- trace 标志文件：${trace.markerExists ? '存在' : '不存在'} - ${trace.marker}`);
  if (trace.reason) lines.push(`- 原因：${trace.reason}`);
  lines.push('', '## 自动捕获计划');
  lines.push(`- 目标页面：${args.url || '未提供'}`);
  lines.push(`- 输出目录：${plan.outDir}`);
  lines.push(`- Profile 目录：${plan.profileDir}`);
  lines.push(`- 计划 trace 文件：${plan.traceFile}`);
  lines.push(`- 采集窗口：${args.duration} 秒（窗口结束后仍会执行关闭进程、等待日志刷盘和可选导入，因此命令总耗时可能略长）`);
  lines.push(`- 结束原因：${result.endReason || 'unknown'}`);
  lines.push(`- 信号策略：${args.signalPolicy}`);
  if (result.importSignalPolicy && result.importSignalPolicy !== args.signalPolicy) {
    lines.push(`- 实际导入策略：${result.importSignalPolicy}（人工关闭/浏览器退出时保留有效 NDJSON，覆盖门禁仍由 check_trace_gate.js 执行）`);
  }
  if (args.evidenceSignals.length) lines.push(`- evidence-signal：${args.evidenceSignals.join('、')}（策略 ${args.signalPolicy}）`);
  if (args.endSignals.length) lines.push(`- end-signal：${args.endSignals.join('、')}`);
  lines.push(`- DOM trace 行数上限：${args.limit}`);
  if (plan.presetCookies && plan.presetCookies.count) {
    lines.push(`- 预置 Cookie：${plan.presetCookies.count} 条（domain=${plan.presetCookies.domain || '<缺省取url主机>'}）`);
  }
  lines.push(`- 启动参数：${[plan.firefoxExe].concat(plan.firefoxArgs).join(' ')}`);
  lines.push(`- 环境变量：MOZ_DOM_TRACE=1，MOZ_DOM_TRACE_FILE=<case trace file>，MOZ_DOM_TRACE_LIMIT=${args.limit}${args.ptype ? `，MOZ_DOM_TRACE_PTYPE=${args.ptype}` : ''}，MOZ_DISABLE_LAUNCHER_PROCESS=1`);
  const extraEnv = Object.entries(args.traceEnvPairs || {});
  if (extraEnv.length) {
    lines.push(`- 定向 trace 开关（--trace-env）：${extraEnv.map(([k, v]) => `${k}=${v}`).join('，')}`);
    lines.push('  - jscall/eval/cookie 等派生模块日志按锚点派生到输出目录子文件夹（如 jscall/trace_jscall_process_<pid>.jsonl），导入时按分类日志生成摘要，检索用 search_trace.js。');
  }
  if (args.dryRun) {
    lines.push('', '## Dry-run 结果');
    lines.push('- 未启动浏览器，未创建日志文件。');
    if (trace.installed) {
      lines.push('- RuyiTrace 检测通过：自动 trace 可用；用户已提供日志时可改用手动 trace（--input 指定日志），不询问用户选择采集方式。');
    } else {
      lines.push('- RuyiTrace 检测未通过，不能进入自动 trace：按 GATE-1 自动安装（install_all.js --yes，执行前先宣布缺失组件、安装目标 <project-root>/tools/ 与预计规模）；自动安装失败后才可让用户安装 / 提供 RuyiTrace 路径，或改用手动 trace（用户 trace 后 --input 指定日志），或明确确认降级为仅 ruyiPage。');
    }
    return lines.join('\n') + '\n';
  }
  lines.push('', '## 捕获结果');
  if (result.launchError) lines.push(`- 启动错误：${result.launchError}`);
  lines.push(`- 是否已启动：${result.launched ? '是' : '否'}`);
  if (result.exitedEarly) lines.push('- 浏览器在 duration 前已被关闭/退出，采集提前结束（NDJSON 日志保留，需结合结束原因判断是否为用户正常结束）');
  if (result.pid) lines.push(`- 进程 PID：${result.pid}`);
  if (typeof result.elapsedSeconds === 'number') lines.push(`- 命令实际耗时：${result.elapsedSeconds} 秒`);
  lines.push(`- 是否尝试结束进程：${result.killAttempted ? '是' : '否'}`);
  if (result.killAttempted) lines.push(`- 结束方式：${result.killMethod}，是否成功：${result.killOk ? '是' : '否'}${result.killError ? `（${result.killError}）` : ''}`);
  if (result.killAttempted && !result.killOk) lines.push('- [警告] **浏览器未能自动关闭，请手动关闭残留的 trace Firefox（profile: ' + plan.profileDir + '）**');
  lines.push(`- 发现 NDJSON 数量：${result.logs.length}`);
  for (const file of result.logs) lines.push(`  - ${file}`);
  if (!result.logs.length) {
    lines.push('- 未发现 NDJSON：应检查 RuyiTrace trace Firefox 是否能写入日志、目标页面是否触发了环境访问、是否需要登录/验证码/权限交互；自动 trace 失败后可改用手动 trace（--input 指定用户采集的日志）。');
  }
  if (result.importResults && result.importResults.length) {
    lines.push('', '## 导入结果');
    result.importResults.forEach((imp, idx) => {
      const label = result.logLabels && result.logLabels[idx] ? result.logLabels[idx] : (result.logs && result.logs[idx] ? path.basename(result.logs[idx]) : `#${idx + 1}`);
      lines.push(`- ${label} 导入是否成功：${imp.ok ? '是' : '否'}`);
      if (imp.stdout.trim()) lines.push('', '```text', imp.stdout.trim(), '```');
      if (imp.stderr.trim()) lines.push('', '```text', imp.stderr.trim(), '```');
    });
  }
  if (result.importCoverageWarning) {
    lines.push('', '## [警告] 导入覆盖不足');
    lines.push(`- ${result.importCoverageWarning}`);
    if (result.mainTraceRescued) lines.push(`- 抢救记录：${result.mainTraceRescued}`);
    if (result.traceCandidates && result.traceCandidates.length) {
      lines.push('', '### 输出目录下全部 NDJSON 候选');
      lines.push('', '| 行数 | process_type | 是否已导入 | 文件 | 未导入原因 |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const c of result.traceCandidates) {
        const reason = c.imported ? '-' : (c.excludedReasons.length ? c.excludedReasons.join('；') : '未被选为主 trace');
        lines.push(`| ${c.lines} | ${c.processType} | ${c.imported ? '是' : '否'} | ${c.file} | ${reason} |`);
      }
    }
    if (result.manualImportCommands && result.manualImportCommands.length) {
      lines.push('', '### 手动导入命令（PowerShell，按需逐条执行）', '', '```powershell');
      for (const cmd of result.manualImportCommands) lines.push(cmd);
      lines.push('```');
    }
    lines.push('', '> 行数最大的 domtrace 文件通常才是页面内容进程（业务 JS）日志；若它未被导入，必须手动导入后再判定 trace 质量，不得直接进入分析。');
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.selfTest) {
    const result = runSelfTest();
    console.log(`capture_ruyitrace_log.js 自测通过：${result.tests} 项断言`);
    return;
  }
  // 手动 trace 模式：用户已用 RuyiTrace 手动采集完成，直接导入指定 NDJSON
  if (args.input) {
    const inputPath = path.resolve(args.input);
    if (!exists(inputPath)) throw new Error(`日志文件不存在：${inputPath}`);
    const ret = importLog(args.caseDir || '.', inputPath, args.markdown, args.evidenceSignals, true, args.signalPolicy);
    if (args.markdown) {
      const lines = ['# RuyiTrace 手动日志导入', ''];
      lines.push(`- 手动 trace 日志：${inputPath}`);
      lines.push(`- case 目录：${path.resolve(args.caseDir || '.')}`);
      lines.push(`- 导入是否成功：${ret.ok ? '是' : '否'}`);
      lines.push('', '> 以下为 import_ruyitrace_log.js 生成的摘要：', '');
      if (ret.stdout.trim()) lines.push('```text', ret.stdout.trim(), '```');
      if (ret.stderr.trim()) lines.push('', '```text', ret.stderr.trim(), '```');
      process.stdout.write(lines.join('\n') + '\n');
    } else {
      process.stdout.write(JSON.stringify({
        ok: ret.ok,
        mode: 'manual',
        input: inputPath,
        caseDir: path.resolve(args.caseDir || '.'),
        importStatus: ret.status,
        importStdout: ret.stdout,
        importStderr: ret.stderr,
      }, null, 2) + '\n');
    }
    process.exitCode = ret.ok ? 0 : 1;
    return;
  }
  if (!args.url) throw new Error('缺少 --url（自动 trace）或 --input（手动 trace 指定日志）之一。');
  const trace = detectRuyiTrace(args);
  const plan = buildPlan(args, trace);
  if (!trace.installed) {
    const obj = { args, trace, plan, result: { launched: false, logs: [] } };
    if (args.json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
    if (args.markdown) process.stdout.write(renderMarkdown(obj));
    process.exitCode = 2;
    return;
  }
  if (args.dryRun) {
    const obj = { args, trace, plan, result: { launched: false, logs: [] } };
    if (args.json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
    if (args.markdown) process.stdout.write(renderMarkdown(obj));
    return;
  }
  const result = await capture(args, plan);
  const obj = { args, trace, plan, result };
  if (result.killAttempted && !result.killOk) {
    console.error(`[警告] 浏览器未能自动关闭，请手动关闭残留的 trace Firefox（profile: ${plan.profileDir}）`);
  }
  if (args.json) process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  if (args.markdown) process.stdout.write(renderMarkdown(obj));
  if (result.importCoverageWarning) {
    console.error(`[警告] 导入覆盖不足：${result.importCoverageWarning}`);
    for (const cmd of result.manualImportCommands || []) console.error(`[手动导入] ${cmd}`);
  }
  if (!result.logs.length) process.exitCode = 3;
  // 目标信号硬门禁只针对主 DOM trace 日志（importResults[0]）：分类日志无业务接口路径，
  // 逐文件判定必然误报；主日志命中即覆盖、未命中才退出 4。
  if (result.importResults && result.importResults.length && !result.importResults[0].ok) process.exitCode = 4;
  // 主 DOM trace 完全未导入时，importResults[0] 是分类日志（不带信号判定，恒 ok），
  // 不能让它把“没有页面 JS 证据”伪装成成功；直接按覆盖不足退出 4。
  if (args.importAfter && result.logs.length && !(result.logLabels || []).some((l) => l.startsWith('主 DOM trace'))) {
    process.exitCode = 4;
  }
}

main().catch((err) => {
  console.error(err.message || String(err));
  console.error('完整参数说明：node scripts/capture_ruyitrace_log.js --help');
  process.exit(1);
});
