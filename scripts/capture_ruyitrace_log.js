#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const paths = require('./lib/paths');

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
    duration: 120,
    limit: 200000,
    ptype: '',
    targetSignals: [],
    traceSignals: [],
    signalPolicy: 'strict',
    dryRun: false,
    importAfter: false,
    json: false,
    markdown: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--url') args.url = nextVal('');
    else if (a === '--input') args.input = nextVal('');
    else if (a === '--case-dir' || a === '--dir') args.caseDir = nextVal('');
    else if (a === '--out-dir') args.outDir = nextVal('');
    else if (a === '--profile-dir') args.profileDir = nextVal('');
    else if (a === '--ruyitrace-home') args.ruyitraceHome = nextVal('');
    else if (a === '--ruyitrace-exe') args.ruyitraceExe = nextVal('');
    else if (a === '--project-dir') args.projectDir = nextVal('');
    else if (a === '--duration') args.duration = Number(nextVal('120'));
    else if (a === '--limit') args.limit = Number(nextVal('200000'));
    else if (a === '--ptype') args.ptype = nextVal('');
    else if (a === '--target-signal') args.targetSignals.push(nextVal(''));
    else if (a === '--trace-signal') args.traceSignals.push(nextVal(''));
    else if (a === '--signal-policy') args.signalPolicy = nextVal('strict');
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--import-after') args.importAfter = true;
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  if (!Number.isFinite(args.duration) || args.duration <= 0) args.duration = 120;
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 200000;
  if (!['strict', 'advisory'].includes(args.signalPolicy)) args.signalPolicy = 'strict';
  args.traceSignals = args.traceSignals.filter((s) => s && s.trim());
  if (args.traceSignals.length) args.targetSignals = args.traceSignals.slice();
  return args;
}

function usage() {
  return `用法（自动 trace / 手动 trace 二选一）：
  # 自动 trace：自动启动随 RuyiTrace 提供的 trace Firefox 捕获 NDJSON
  node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir . --ruyitrace-home <RuyiTrace-dir> --duration 120 --import-after --markdown
  # 手动 trace：用户已用 RuyiTrace 手动 trace 完成，指定 NDJSON 日志直接导入生成摘要
  node scripts/capture_ruyitrace_log.js --input <用户trace生成的.ndjson> --case-dir . --markdown
  # 仅检测环境并打印计划（不启动浏览器）
  node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir . --dry-run --json

说明：--case-dir 指项目根目录（其下应有 case/ 和 result/ 两个平级子目录），默认当前目录。
--project-dir <dir>：用户工程目录（tools/ 所在），未传时从 --case-dir 推断；安装模式下需靠此定位 RuyiTrace。
--url 与 --input 互斥：--url 为自动捕获（需 RuyiTrace 完整安装）；--input 为手动 trace 后直接导入用户指定的 NDJSON，无需 RuyiTrace 安装检测。
--trace-signal <信号>（可多次）：导入时只扫描 trace 的环境 API / writer / 参数写入点；推荐用于 JSONP、script 或导航请求。
--target-signal <信号>（兼容旧参数）：等价于 --trace-signal；不要传目标网络 URL。
--signal-policy strict|advisory：strict 未命中退出非 0；advisory 只记录覆盖不足，适合用户手动结束或信号尚未确定的采集。
--ptype <list>：启用 trace 的进程类型（逗号分隔，透传 MOZ_DOM_TRACE_PTYPE），不传则全部进程类型；大页面可只留主/content 进程减少无关日志。`;
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
    env: {
      MOZ_DOM_TRACE: '1',
      MOZ_DOM_TRACE_FILE: traceFile,
      MOZ_DOM_TRACE_LIMIT: String(args.limit),
      MOZ_DISABLE_LAUNCHER_PROCESS: '1',
      ...(args.ptype ? { MOZ_DOM_TRACE_PTYPE: args.ptype } : {}),
    },
  };
}

// 递归扫描目录下 NDJSON（兼容新版分目录结构：domtrace/ 主日志 + cookie/descriptor/event/storage 分类；
// 也兼容旧版顶层单文件）。优先返回 domtrace/ 下的主日志，其余按修改时间倒序。
// sinceMs 容差 10s：新版内核启动较慢（Firefox 155 重 fork），日志文件可能晚于采集起点才创建/写入。
function listNdjsonFiles(dir, sinceMs) {
  if (!isDir(dir)) return [];
  const out = [];
  const walk = (d) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { entries = []; }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.ndjson$/i.test(ent.name)) out.push(p);
    }
  };
  walk(dir);
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

// 读 NDJSON 首行识别 process_type：parent=浏览器父进程/内核活动（不含页面 JS，参与 target-signal 必然误报），
// tab/content=页面内容进程（真正的业务 JS 调用）。首行 parse 失败或缺失 process_type 返回空串。
function readProcessType(file) {
  try {
    const fd = fs.openSync(file, 'r');
    let firstLine = '';
    try {
      const buf = Buffer.alloc(8192);
      const n = fs.readSync(fd, buf, 0, 8192, 0);
      firstLine = buf.slice(0, n).toString('utf8').split('\n')[0];
    } finally {
      fs.closeSync(fd);
    }
    const evt = JSON.parse(firstLine);
    return evt && evt.process_type ? String(evt.process_type) : '';
  } catch {
    return '';
  }
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

function tailContains(files, signals) {
  if (!signals || !signals.length || !files.length) return false;
  const needles = signals.map((s) => String(s).toLowerCase());
  const observed = new Set();
  for (const file of files) {
    try {
      const st = fs.statSync(file);
      const size = Math.min(st.size, 1024 * 1024);
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, Math.max(0, st.size - size));
      fs.closeSync(fd);
      const text = buf.toString('utf8').toLowerCase();
      needles.forEach((n, idx) => { if (text.includes(n)) observed.add(idx); });
    } catch { /* file may still be rotating */ }
  }
  return observed.size === needles.length;
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

async function capture(args, plan) {
  ensureDir(plan.outDir);
  ensureDir(plan.profileDir);
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
    while (Date.now() < deadline) {
      const currentLogs = mainTraceFiles(listNdjsonFiles(plan.outDir, startedAt));
      if (args.targetSignals.length && tailContains(currentLogs, args.targetSignals)) {
        result.endReason = 'target-signal-observed';
        console.log('[capture] 已在日志尾部观察到全部 trace 信号，开始收尾');
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
    const domFiles = result.logs.filter(isDomtrace);
    const catFiles = result.logs.filter((f) => !isDomtrace(f));
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
      result.importResults.push(importLog(plan.caseDir, effectiveMain, args.markdown, args.targetSignals, true, importSignalPolicy));
      result.logLabels.push(`主 DOM trace（合并 ${effectiveMain.length} 个进程文件）`);
    }
    for (const file of catFiles) {
      result.importResults.push(importLog(plan.caseDir, file, args.markdown, [], false));
      result.logLabels.push(path.basename(file));
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
  if (args.targetSignals.length) lines.push(`- trace 信号：${args.targetSignals.join('、')}（策略 ${args.signalPolicy}）`);
  lines.push(`- DOM trace 行数上限：${args.limit}`);
  lines.push(`- 启动参数：${[plan.firefoxExe].concat(plan.firefoxArgs).join(' ')}`);
  lines.push(`- 环境变量：MOZ_DOM_TRACE=1，MOZ_DOM_TRACE_FILE=<case trace file>，MOZ_DOM_TRACE_LIMIT=${args.limit}${args.ptype ? `，MOZ_DOM_TRACE_PTYPE=${args.ptype}` : ''}，MOZ_DISABLE_LAUNCHER_PROCESS=1`);
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
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  // 手动 trace 模式：用户已用 RuyiTrace 手动采集完成，直接导入指定 NDJSON
  if (args.input) {
    const inputPath = path.resolve(args.input);
    if (!exists(inputPath)) throw new Error(`日志文件不存在：${inputPath}`);
    const ret = importLog(args.caseDir || '.', inputPath, args.markdown, args.targetSignals, true, args.signalPolicy);
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
  if (!result.logs.length) process.exitCode = 3;
  // 目标信号硬门禁只针对主 DOM trace 日志（importResults[0]）：分类日志无业务接口路径，
  // 逐文件判定必然误报；主日志命中即覆盖、未命中才退出 4。
  if (result.importResults && result.importResults.length && !result.importResults[0].ok) process.exitCode = 4;
}

main().catch((err) => {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
});
