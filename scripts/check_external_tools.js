#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawnSync } = require('child_process');
const paths = require('./lib/paths');

function parseArgs(argv) {
  const args = {
    python: '',
    ruyitraceHome: '',
    ruyitraceExe: '',
    ruyiPageInstallDir: '',
    ruyiPageBrowserPath: '',
    projectDir: '',
    pythonArgsPrefix: '',
    json: false,
    markdown: false,
    quick: false,
    offline: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--python') args.python = nextVal('');
    else if (a === '--ruyitrace-home') args.ruyitraceHome = nextVal('');
    else if (a === '--ruyitrace-exe') args.ruyitraceExe = nextVal('');
    else if (a === '--ruyipage-install-dir') args.ruyiPageInstallDir = nextVal('');
    else if (a === '--ruyipage-browser-path') args.ruyiPageBrowserPath = nextVal('');
    else if (a === '--project-dir') args.projectDir = nextVal('');
    else if (a === '--python-args') args.pythonArgsPrefix = (i + 1 < argv.length) ? argv[++i] : '';
    else if (a === '--json') args.json = true;
    else if (a === '--markdown') args.markdown = true;
    else if (a === '--quick') args.quick = true;
    else if (a === '--offline') args.offline = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`未知参数：${a}`);
  }
  if (!args.json && !args.markdown) args.markdown = true;
  return args;
}

function usage() {
  return `用法：
  node scripts/check_external_tools.js --markdown
  node scripts/check_external_tools.js --python python --ruyipage-install-dir <ruyipage-browsers-dir> --markdown
  node scripts/check_external_tools.js --python python --ruyipage-browser-path <firefox.exe> --ruyitrace-home <RuyiTrace-dir> --json
  node scripts/check_external_tools.js --quick

说明：检测 ruyiPage Python 包、ruyiPage 定制 Firefox runtime、是否误用系统 Firefox fallback、RuyiTrace 目录结构。
同时顺带对比 GitHub 最新 release：发现新版只提示、不自动更新；网络失败或限流时静默跳过，不影响检测结果。
注意：选择 ruyiPage 时，只有“ruyiPage 包可用 + 定制 Firefox runtime 验证通过”才视为可用；普通系统 Firefox fallback 不视为通过。
--project-dir <dir>：用户工程目录（tools/ 所在）。安装模式下 skill 安装目录无 tools/（gitignore 不随分发），需靠此定位；未传时回退 cwd/tools + skill 根/tools。多 case 项目共享 tools 时，传 case 目录会自动向上查找含 tools/ 的工程根。
--python-args <args>：--python 指定解释器附带的参数前缀（如 --python py --python-args -3），与显式 Python 配合严格探测；不传则显式 Python 无前缀，失败时仍会回退 python/python3/py -3。
--quick：快速模式，只检测 Node.js 版本是否满足要求，不执行子命令、不扫描目录、不检测 ruyipage/ruyitrace。
--offline：跳过 GitHub release 更新查询（不访问网络）。用于离线环境或需要快速、确定性的纯本地检测；默认每次检测都会顺带查询更新（失败静默，不影响检测结果）。`;
}

function exists(p) {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function isDir(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (err) { return { __parseError: err.message || String(err) }; }
}

function run(cmd, args, timeout = 15000, options = {}) {
  const ret = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    cwd: options.cwd || undefined,
    env: options.env ? { ...process.env, ...options.env } : undefined,
  });
  return {
    ok: ret.status === 0,
    status: ret.status,
    stdout: (ret.stdout || '').trim(),
    stderr: (ret.stderr || '').trim(),
    error: ret.error ? ret.error.message : '',
    command: [cmd].concat(args).join(' '),
  };
}

function pythonCandidates(explicit, explicitArgs) {
  const out = [];
  if (explicit) out.push({ cmd: explicit, argsPrefix: explicitArgs || [] });
  out.push({ cmd: 'python', argsPrefix: [] });
  out.push({ cmd: 'python3', argsPrefix: [] });
  out.push({ cmd: 'py', argsPrefix: ['-3'] });
  const seen = new Set();
  return out.filter(x => {
    const k = x.cmd + ' ' + x.argsPrefix.join(' ');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function normalizePath(p) {
  if (!p) return '';
  try { return path.resolve(p); } catch { return p; }
}

function samePath(a, b) {
  if (!a || !b) return false;
  const ra = normalizePath(a);
  const rb = normalizePath(b);
  return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items.filter(Boolean)) {
    const k = process.platform === 'win32' ? String(item).toLowerCase() : String(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function detectRuyiPagePackage(explicitPython, explicitArgs) {
  const code = [
    'import json',
    'try:',
    ' import ruyipage',
    ' try:',
    '  import requests',
    '  requests_ok=True',
    '  requests_error=""',
    ' except Exception as re:',
    '  requests_ok=False',
    '  requests_error=str(re)',
    ' print(json.dumps({"ok": True, "version": getattr(ruyipage, "__version__", ""), "requests_ok": requests_ok, "requests_error": requests_error}, ensure_ascii=False))',
    'except Exception as e:',
    ' print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False))',
  ].join('\n');

  const checked = [];
  for (const c of pythonCandidates(explicitPython, explicitArgs)) {
    const ret = run(c.cmd, c.argsPrefix.concat(['-c', code]));
    checked.push({ python: [c.cmd].concat(c.argsPrefix).join(' '), ok: ret.ok, stderr: ret.stderr || ret.error });
    if (!ret.ok) continue;
    let parsed = null;
    try { parsed = JSON.parse(ret.stdout.replace(/^\uFEFF/, '')); } catch { parsed = null; }
    if (parsed && parsed.ok) {
      return {
        packageInstalled: true,
        installed: true,
        python: c.cmd,
        pythonArgsPrefix: c.argsPrefix,
        version: parsed.version || '',
        requestsAvailable: !!parsed.requests_ok,
        requestsError: parsed.requests_error || '',
        checked,
      };
    }
  }
  return {
    packageInstalled: false,
    installed: false,
    requestsAvailable: false,
    requestsError: '',
    reason: '未检测到可 import ruyipage 的 Python 环境',
    checked,
  };
}

function executableName() {
  return process.platform === 'win32' ? 'firefox.exe' : 'firefox';
}

function normalizeExecutableInput(input) {
  if (!input) return '';
  const p = path.resolve(input);
  if (isDir(p)) {
    const candidates = [
      path.join(p, 'firefox', executableName()),
      path.join(p, executableName()),
    ];
    for (const c of candidates) if (exists(c)) return c;
  }
  return p;
}

function findInstallJsonNearExecutable(exe) {
  const checked = [];
  let cur = path.dirname(path.resolve(exe));
  for (let i = 0; i < 8; i++) {
    const file = path.join(cur, 'install.json');
    checked.push(file);
    if (exists(file)) {
      const json = readJson(file);
      return { installJsonPath: file, installRoot: cur, installJson: json, checked };
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return { installJsonPath: '', installRoot: '', installJson: null, checked };
}

function findExecutablesFromInstallRoot(root) {
  const out = [];
  const installJsonPath = path.join(root, 'install.json');
  if (exists(installJsonPath)) {
    const json = readJson(installJsonPath);
    if (json && !json.__parseError && json.executable) out.push(path.join(root, json.executable));
    out.push(path.join(root, 'firefox', executableName()));
  }
  return unique(out);
}

function scanInstallDir(installDir) {
  const root = path.resolve(installDir);
  const candidates = [];
  for (const exe of findExecutablesFromInstallRoot(root)) candidates.push(exe);
  if (isDir(root)) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { entries = []; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const sub = path.join(root, ent.name);
      for (const exe of findExecutablesFromInstallRoot(sub)) candidates.push(exe);
    }
  }
  return unique(candidates);
}

function verifyRuyiRuntimeCandidate(label, executablePath) {
  const exe = normalizeExecutableInput(executablePath);
  const ret = {
    label,
    executable: exe,
    executableExists: exists(exe),
    installJsonPath: '',
    installJsonExists: false,
    installRoot: '',
    installJsonValid: false,
    runtimeName: '',
    runtimeVersion: '',
    runtimeRelease: '',
    runtimeAsset: '',
    runtimePlatform: '',
    executableDeclared: '',
    executableMatchesInstallJson: false,
    releaseLooksRuyi: false,
    assetLooksFirefox: false,
    pathLooksSystemFirefox: false,
    managedRuntimeInstalled: false,
    managedRuntimeVerified: false,
    isSystemFirefoxFallback: false,
    reason: '',
  };

  if (!exe) {
    ret.reason = '未提供 Firefox 可执行文件路径';
    return ret;
  }

  const lowered = exe.toLowerCase().replace(/\\/g, '/');
  ret.pathLooksSystemFirefox = /mozilla firefox\/firefox(\.exe)?$/.test(lowered)
    || lowered === '/usr/bin/firefox'
    || lowered === '/usr/local/bin/firefox'
    || lowered === '/snap/bin/firefox'
    || lowered.endsWith('/applications/firefox.app/contents/macos/firefox');

  if (!ret.executableExists) {
    ret.reason = 'Firefox 可执行文件不存在';
    return ret;
  }

  const near = findInstallJsonNearExecutable(exe);
  ret.installJsonPath = near.installJsonPath;
  ret.installRoot = near.installRoot;
  ret.installJsonExists = !!near.installJsonPath;

  if (!near.installJsonPath) {
    ret.isSystemFirefoxFallback = true;
    ret.reason = ret.pathLooksSystemFirefox
      ? '检测到普通系统 Firefox 路径；不是 ruyiPage managed runtime'
      : '未在 Firefox 路径上级目录找到 ruyiPage install.json，不能证明是定制 Firefox runtime';
    return ret;
  }

  const json = near.installJson;
  if (!json || json.__parseError) {
    ret.reason = `install.json 无法解析：${json && json.__parseError ? json.__parseError : '未知错误'}`;
    return ret;
  }

  ret.installJsonValid = true;
  ret.runtimeName = String(json.name || '');
  ret.runtimeVersion = String(json.version || '');
  ret.runtimeRelease = String(json.release || json.tag || '');
  ret.runtimeAsset = String(json.asset || '');
  ret.runtimePlatform = String(json.platform || '');
  ret.executableDeclared = json.executable ? path.join(near.installRoot, String(json.executable)) : '';
  ret.executableMatchesInstallJson = ret.executableDeclared ? samePath(ret.executableDeclared, exe) : false;

  const textForRuyi = [ret.runtimeRelease, ret.runtimeAsset, path.basename(near.installRoot)].join(' ');
  // ruyiPage 命名约定兼容三代：
  // 1) 含 "ruyi" 标识（如 151-ruyi / 155-ruyi）
  // 2) Firefox 版本号前缀（如 151-proxy / 155-proxy）
  // 3) 语义化版本 tag（如 v1.2.57）+ firefox nightly 定制 asset（如 firefox-155.0a1.en-US.win64-20260801.zip）
  // 4) install.json 下载来源 url 指向 LoseNine/ruyipage 仓库
  const releaseIsSemverTag = /^v?\d+\.\d+(\.\d+)?$/i.test(ret.runtimeRelease);
  const assetIsRuyiFirefox = /firefox-\d+\.0a1/i.test(ret.runtimeAsset);
  const urlIsRuyiRepo = /github\.com\/LoseNine\/ruyipage/i.test(String(json.url || ''));
  ret.releaseLooksRuyi = /ruyi/i.test(textForRuyi)
    || /^1\d{2,}-/i.test(ret.runtimeRelease)
    || (releaseIsSemverTag && assetIsRuyiFirefox)
    || urlIsRuyiRepo;
  ret.assetLooksFirefox = /firefox/i.test(ret.runtimeAsset || exe);
  ret.managedRuntimeInstalled = ret.installJsonValid && ret.executableExists;
  ret.managedRuntimeVerified = ret.managedRuntimeInstalled
    && ret.releaseLooksRuyi
    && ret.assetLooksFirefox
    && (!ret.executableDeclared || ret.executableMatchesInstallJson);
  ret.isSystemFirefoxFallback = !ret.managedRuntimeVerified;

  if (ret.managedRuntimeVerified) ret.reason = '已验证为 ruyiPage 定制 Firefox managed runtime';
  else if (!ret.releaseLooksRuyi) ret.reason = 'install.json 存在，但 release/asset/目录名未体现 ruyi 定制标识，不视为定制 Firefox';
  else if (ret.executableDeclared && !ret.executableMatchesInstallJson) ret.reason = 'Firefox 路径与 install.json 中声明的 executable 不一致';
  else ret.reason = 'runtime 结构不完整，不能验证为 ruyiPage 定制 Firefox';
  return ret;
}

function runtimePathFromRuyiPage(pkg, args, installDir) {
  if (!pkg.packageInstalled) return { defaultRuntimePath: '', defaultRuntimePathExists: false, pathCommandOk: false, pathCommandOutput: '', pathCommandError: '' };
  const pathArgs = ['-m', 'ruyipage', 'path'];
  if (installDir) pathArgs.push('--install-dir', installDir);
  const pathRet = run(pkg.python, pkg.pythonArgsPrefix.concat(pathArgs), 20000);
  const lines = (pathRet.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const last = lines.length ? lines[lines.length - 1] : '';
  return {
    defaultRuntimePath: pathRet.ok ? last : '',
    defaultRuntimePathExists: pathRet.ok && exists(last),
    pathCommandOk: pathRet.ok,
    pathCommandOutput: pathRet.stdout,
    pathCommandError: pathRet.stderr || pathRet.error,
    pathCommand: pathRet.command,
  };
}

function ruyiPageDoctor(pkg, args, installDir) {
  if (!pkg.packageInstalled) return { doctorOk: false, doctorJsonOk: false, doctorOutput: '', doctorJson: null };
  const baseArgs = ['-m', 'ruyipage', 'doctor'];
  if (installDir) baseArgs.push('--install-dir', installDir);
  const jsonRet = run(pkg.python, pkg.pythonArgsPrefix.concat(baseArgs, ['--json']), 20000);
  let doctorJson = null;
  try { doctorJson = JSON.parse((jsonRet.stdout || '').replace(/^\uFEFF/, '')); } catch { doctorJson = null; }
  if (jsonRet.ok && doctorJson) return { doctorOk: true, doctorJsonOk: true, doctorOutput: jsonRet.stdout, doctorJson };
  const ret = run(pkg.python, pkg.pythonArgsPrefix.concat(baseArgs), 20000);
  return { doctorOk: ret.ok, doctorJsonOk: false, doctorOutput: ret.stdout || ret.stderr || jsonRet.stderr || '', doctorJson: null };
}

function detectRuyiPage(args) {
  const pkg = detectRuyiPagePackage(args.python, (args.pythonArgsPrefix || '').split(' ').filter(Boolean));
  // 多版本 runtime 并存时（如 151-ruyi 旧版 + 155 新版），按 Firefox 主版本号降序选最新
  const pickLatest = (list) => {
    if (!list.length) return null;
    const rank = (c) => {
      const m = /firefox[-_]?(\d+)(?:\.\d+)*[a-z]?/i.exec((c.runtimeAsset || '') + ' ' + (c.runtimeVersion || '') + ' ' + path.basename(c.installRoot || ''));
      return m ? parseInt(m[1], 10) : 0;
    };
    return list.slice().sort((a, b) => rank(b) - rank(a))[0];
  };

  const checks = [];
  if (args.ruyiPageBrowserPath) {
    checks.push(verifyRuyiRuntimeCandidate('用户指定 --ruyipage-browser-path', args.ruyiPageBrowserPath));
  }
  if (process.env.RUYIPAGE_FIREFOX_EXECUTABLE_PATH) {
    checks.push(verifyRuyiRuntimeCandidate('环境变量 RUYIPAGE_FIREFOX_EXECUTABLE_PATH', process.env.RUYIPAGE_FIREFOX_EXECUTABLE_PATH));
  }
  if (process.env.RUYIPAGE_BROWSER_PATH) {
    checks.push(verifyRuyiRuntimeCandidate('环境变量 RUYIPAGE_BROWSER_PATH', process.env.RUYIPAGE_BROWSER_PATH));
  }

  for (const dir of paths.getDefaultRuyiBrowsersDirs(args.ruyiPageInstallDir, args.projectDir)) {
    for (const exe of scanInstallDir(dir)) {
      checks.push(verifyRuyiRuntimeCandidate(`managed runtime 扫描：${dir}`, exe));
    }
  }

  // 先确定实际生效的 managed runtime 目录，再让 ruyipage 的 path/doctor 检查同一目录：
  // 不传 --install-dir 时 ruyipage 只查默认路径（AppData），项目 tools/ 内已装好的 runtime 会被误报"尚未安装"
  const verified0 = checks.filter((c) => c.managedRuntimeVerified);
  const explicitCheck0 = checks.find((c) => c.label.startsWith('用户指定')) || null;
  const selected0 = explicitCheck0 && explicitCheck0.managedRuntimeVerified ? explicitCheck0 : pickLatest(verified0);
  const installDir = args.ruyiPageInstallDir || (selected0 && selected0.installRoot ? path.dirname(selected0.installRoot) : '') || '';
  const defaultPath = runtimePathFromRuyiPage(pkg, args, installDir);
  const doctor = ruyiPageDoctor(pkg, args, installDir);

  if (defaultPath.defaultRuntimePath) {
    checks.push(verifyRuyiRuntimeCandidate('ruyiPage 默认解析路径（python -m ruyipage path）', defaultPath.defaultRuntimePath));
  }

  const dedupedChecks = [];
  const seen = new Set();
  for (const c of checks) {
    const k = (c.executable || '') + '|' + (c.installJsonPath || '') + '|' + c.label;
    if (seen.has(k)) continue;
    seen.add(k);
    dedupedChecks.push(c);
  }

  const verified = dedupedChecks.filter(c => c.managedRuntimeVerified);
  const defaultCheck = dedupedChecks.find(c => c.label.startsWith('ruyiPage 默认解析路径')) || null;
  const explicitCheck = dedupedChecks.find(c => c.label.startsWith('用户指定')) || null;
  const selected = explicitCheck && explicitCheck.managedRuntimeVerified ? explicitCheck
    : (defaultCheck && defaultCheck.managedRuntimeVerified ? defaultCheck : pickLatest(verified));
  const defaultIsSystemFallback = !!defaultCheck && !!defaultCheck.executable && !defaultCheck.managedRuntimeVerified;
  const explicitPathNotVerified = !!explicitCheck && !explicitCheck.managedRuntimeVerified;
  const managedRuntimeVerified = !!selected;

  const result = {
    ...pkg,
    packageInstalled: pkg.packageInstalled,
    installed: pkg.packageInstalled,
    defaultRuntimePath: defaultPath.defaultRuntimePath,
    defaultRuntimePathExists: defaultPath.defaultRuntimePathExists,
    pathCommandOk: defaultPath.pathCommandOk,
    pathCommandOutput: defaultPath.pathCommandOutput,
    pathCommandError: defaultPath.pathCommandError,
    doctorOk: doctor.doctorOk,
    doctorJsonOk: doctor.doctorJsonOk,
    doctorOutput: doctor.doctorOutput,
    smartFingerprintDependencyReady: !!pkg.requestsAvailable,
    smartFingerprintDependencyMissing: pkg.packageInstalled && !pkg.requestsAvailable,
    requestsAvailable: !!pkg.requestsAvailable,
    requestsError: pkg.requestsError || '',
    minVersion: RUYIPAGE_MIN_VERSION,
    packageVersionOk: (() => { const c = versionAtLeast(pkg.version, RUYIPAGE_MIN_VERSION); return c === null ? true : c; })(),
    managedRuntimeInstalled: verified.length > 0,
    managedRuntimeVerified,
    defaultRuntimeVerified: !!defaultCheck && defaultCheck.managedRuntimeVerified,
    defaultIsSystemFirefoxFallback: defaultIsSystemFallback,
    explicitBrowserPathVerified: !!explicitCheck && explicitCheck.managedRuntimeVerified,
    explicitBrowserPathNotVerified: explicitPathNotVerified,
    runtimeRelease: selected ? selected.runtimeRelease : '',
    runtimeVersion: selected ? selected.runtimeVersion : '',
    runtimeAsset: selected ? selected.runtimeAsset : '',
    runtimeExecutable: selected ? selected.executable : '',
    runtimeInstallJson: selected ? selected.installJsonPath : '',
    isSystemFirefoxFallback: defaultIsSystemFallback || explicitPathNotVerified || dedupedChecks.some(c => c.isSystemFirefoxFallback && c.executableExists),
    mustInstallManagedRuntime: !managedRuntimeVerified,
    usable: pkg.packageInstalled && managedRuntimeVerified,
    recommendedForAntiDetectionProbe: pkg.packageInstalled && managedRuntimeVerified && !!pkg.requestsAvailable,
    conclusion: '',
    runtimeChecks: dedupedChecks,
    scannedInstallDirs: paths.getDefaultRuyiBrowsersDirs(args.ruyiPageInstallDir, args.projectDir),
  };

  if (!pkg.packageInstalled && !managedRuntimeVerified) result.conclusion = '不可使用：未检测到 ruyiPage 包，也未检测到定制 Firefox runtime。';
  else if (!pkg.packageInstalled) result.conclusion = '暂不可使用：已检测到定制 Firefox runtime，但当前 Python 环境未安装 ruyiPage 包。';
  else if (!managedRuntimeVerified) result.conclusion = '不可使用：ruyiPage 包存在，但未验证到 ruyiPage 定制 Firefox runtime；不能把系统 Firefox fallback 当作通过。';
  else if (!pkg.requestsAvailable) result.conclusion = '可启动但不建议取证：ruyiPage 包和定制 Firefox runtime 可用，但缺少 requests，默认 smart_fingerprint 地理探测会失败；请安装 requests 或显式提供 manual_geo。';
  else if (!result.defaultRuntimeVerified && result.runtimeExecutable) result.conclusion = '可使用但需显式指定：ruyiPage 包存在，且找到定制 Firefox runtime；启动时应通过 browser_path / set_browser_path 指向已验证路径。';
  else result.conclusion = '可使用：ruyiPage 包存在，默认解析路径已验证为定制 Firefox runtime。';

  return result;
}

function detectRuyiTrace(args) {
  const home = paths.normalizeTraceHome(args);
  if (!home) return {
    installed: false,
    kernelVerified: false,
    reason: '未检测到 RuyiTrace；如已安装，请提供 --ruyitrace-home、设置 RUYI_TRACE_HOME，或传 --project-dir <用户工程目录>（tools/ 所在；安装模式下 skill 安装目录无 tools/，必须靠此定位）',
  };
  const exeName = process.platform === 'win32' ? 'RuyiTrace.exe' : 'RuyiTrace';
  const exe = args.ruyitraceExe ? path.resolve(args.ruyitraceExe) : path.join(home, exeName);
  const exeExists = exists(exe);
  // 兼容两代 RuyiTrace 内核路径：
  //   新版 2.5+（Electron 壳）：<home>/resources/kernel/firefox(.exe) + RUYI_DOMTRACE.txt
  //   旧版 1.x（自带 firefox/）：<home>/firefox/firefox(.exe) + RUYI_DOMTRACE.txt
  const firefoxName = process.platform === 'win32' ? 'firefox.exe' : 'firefox';
  const candidates = [
    { kind: 'new', firefoxExe: path.join(home, 'resources', 'kernel', firefoxName), marker: path.join(home, 'resources', 'kernel', 'RUYI_DOMTRACE.txt') },
    { kind: 'legacy', firefoxExe: path.join(home, 'firefox', firefoxName), marker: path.join(home, 'firefox', 'RUYI_DOMTRACE.txt') },
  ];
  const kernel = candidates.find((c) => exists(c.firefoxExe) && exists(c.marker)) || candidates[0];
  const firefoxExe = kernel.firefoxExe;
  const marker = kernel.marker;
  const firefoxExists = exists(firefoxExe);
  const markerExists = exists(marker);
  const kernelVerified = firefoxExists && markerExists;
  // 尝试从目录名提取版本（如 RuyiTrace-2.5.5-win64 → 2.5.5）；install_all.js 归一为 tools/RuyiTrace 时无版本
  const dirVersionMatch = /RuyiTrace[-_]?v?(\d+(?:\.\d+)+)/i.exec(path.basename(home));
  let version = dirVersionMatch ? dirVersionMatch[1] : '';
  // 目录名无版本时，Windows 下从 RuyiTrace.exe 文件版本兜底
  if (!version && exeExists && process.platform === 'win32') {
    const ps = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Item -LiteralPath @'\n${exe}\n'@).VersionInfo.ProductVersion`], 8000);
    if (ps.ok && ps.stdout.trim()) version = ps.stdout.trim();
  }
  return {
    installed: exeExists && kernelVerified,
    kernelVerified,
    kernelKind: kernel.kind,
    home,
    exe,
    exeExists,
    firefoxExe,
    firefoxExists,
    marker,
    markerExists,
    version,
    reason: exeExists && kernelVerified ? '' : `RuyiTrace 目录不完整：需要 RuyiTrace 可执行文件，以及 ${kernel.kind === 'new' ? 'resources/kernel' : 'firefox'}/firefox(.exe) 与同目录 RUYI_DOMTRACE.txt`,
  };
}

function detectNode() {
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.replace(/^v/, '').split('.')[0], 10) || 0;
  const nodeOk = nodeMajor >= 18;
  return { version: nodeVersion, ok: nodeOk, major: nodeMajor };
}

// ----- 版本更新提示（仅提示，不自动更新）-----
const LATEST_RELEASES = [
  { tool: 'ruyipage', owner: 'LoseNine', repo: 'ruyipage' },
  { tool: 'ruyitrace', owner: 'LoseNine', repo: 'Firefox-FingerPrint-Analyzer' },
];
const UPDATE_FETCH_TIMEOUT = 8000;
// 透明代理自签 CA 场景可显式开启（默认关闭，强制 TLS 校验），与 download_ruyi_tool.js 保持一致
const TLS_OPTS = process.env.RUYI_INSECURE_TLS === '1'
  ? { rejectUnauthorized: false }
  : {};

function httpsGetJson(url, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'js-reverse-skill-check' }, timeout, ...TLS_OPTS }, (res) => {
      const { statusCode } = res;
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode}`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(new Error(`JSON 解析失败：${err.message}`)); }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

async function fetchLatestReleases() {
  const results = {};
  await Promise.all(LATEST_RELEASES.map(async ({ tool, owner, repo }) => {
    try {
      const json = await httpsGetJson(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, UPDATE_FETCH_TIMEOUT);
      results[tool] = {
        ok: true,
        tag: String(json.tag_name || ''),
        name: String(json.name || json.tag_name || ''),
        url: String(json.html_url || ''),
      };
    } catch (err) {
      results[tool] = { ok: false, error: err.message || String(err) };
    }
  }));
  return results;
}

function parseVersion(v) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v || '').trim());
  if (!m) return null;
  return [parseInt(m[1], 10) || 0, parseInt(m[2], 10) || 0, parseInt(m[3], 10) || 0];
}

// 返回 1/0/-1（a>b / a==b / a<b），无法比较返回 null
function compareVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

// 返回 true=最新版更新，false=不更新或相同，null=无法比较
function isNewer(latest, current) {
  return compareVersion(latest, current) === 1;
}

// 返回 true=current 满足最低版本（>= min），null=无法比较
function versionAtLeast(current, min) {
  const c = compareVersion(current, min);
  return c === null ? null : c >= 0;
}

// ruyipage 包最低版本：与 skill 内取证脚本 API 依据（>=1.2.45 内省确认）对齐
const RUYIPAGE_MIN_VERSION = '1.2.45';

function buildUpdates(result, latest) {
  const updates = [];
  const rp = result.ruyiPage;
  const rt = result.ruyiTrace;

  const ruyipageLatest = latest.ruyipage && latest.ruyipage.ok ? latest.ruyipage.tag : '';
  if (ruyipageLatest) {
    const pkgNewer = rp.packageInstalled && rp.version ? isNewer(ruyipageLatest, rp.version) : null;
    if (pkgNewer === true) {
      updates.push({
        tool: 'ruyipage',
        scope: 'ruyiPage Python 包',
        local: rp.version,
        latest: ruyipageLatest,
        hint: 'python -m pip install ruyiPage requests --upgrade',
        hintNote: '仅在用户确认后执行；升级后建议重跑本检测确认版本一致',
      });
    }
    const runtimeNewer = rp.managedRuntimeVerified && rp.runtimeRelease ? isNewer(ruyipageLatest, rp.runtimeRelease) : null;
    if (runtimeNewer === true) {
      updates.push({
        tool: 'ruyipage-firefox',
        scope: 'ruyiPage 定制 Firefox runtime',
        local: rp.runtimeRelease,
        latest: ruyipageLatest,
        hint: 'node scripts/download_ruyi_tool.js --tool ruyipage-firefox --dest <下载目录> --dry-run --markdown',
        hintNote: 'dry-run 确认后再去掉 --dry-run 下载；更新 runtime 会改变指纹基线，当前未完成的 case 建议保持版本不变',
      });
    }
  }

  if (latest.ruyitrace && latest.ruyitrace.ok && rt.installed) {
    const localRt = rt.version;
    const newer = localRt ? isNewer(latest.ruyitrace.tag, localRt) : null;
    // 本机版本无法识别时也提示最新版，便于用户自行核对
    if (newer === true || newer === null) {
      updates.push({
        tool: 'ruyitrace',
        scope: 'RuyiTrace 桌面工具 + trace 内核',
        local: localRt || '未知（本机目录名未含版本号）',
        latest: latest.ruyitrace.tag,
        hint: 'node scripts/download_ruyi_tool.js --tool ruyitrace --dest <下载目录> --dry-run --markdown',
        hintNote: 'dry-run 确认后再去掉 --dry-run 下载；更新 trace 内核可能改变 NDJSON 日志格式，当前 case 的日志采集完成后建议保持版本不变',
      });
    }
  }

  return updates;
}

function detect(args) {
  return {
    node: detectNode(),
    ruyiPage: detectRuyiPage(args),
    ruyiTrace: detectRuyiTrace(args),
    nextRequiredInput: [],
  };
}

function withNextSteps(result) {
  const next = [];
  if (!result.node.ok) {
    next.push('Node.js 版本不满足要求（需 ≥ v18），请先升级 Node.js 再继续。');
  }
  const rp = result.ruyiPage;
  if (!rp.packageInstalled) {
    next.push('ruyiPage Python 包未安装：按 GATE-1 自动安装——执行前先宣布安装内容与目标，随后运行 node scripts/install_all.js --project-dir <project-root> --yes --markdown（含 pip install ruyiPage requests），不询问用户选择。');
  }
  if (rp.smartFingerprintDependencyMissing) {
    next.push('如果选择 ruyiPage 做高保真取证，请安装 Python requests 依赖，或在 smart_fingerprint 中显式提供 manual_geo；否则默认地理位置 / 时区 / 指纹一致性初始化可能失败。');
  }
  if (rp.packageInstalled && rp.packageVersionOk === false) {
    next.push(`当前 ruyiPage 包版本 ${rp.version || '未知'} 低于 skill 取证脚本 API 依据的最低版本 ${rp.minVersion}，将导致取证脚本不兼容：按 GATE-1 自动升级（执行前先宣布），install_all.js --yes 会 pip 升级 ruyiPage 至最新，不询问用户选择。`);
  }
  if (!rp.managedRuntimeVerified) {
    next.push('未检测到 ruyiPage 定制 Firefox runtime：按 GATE-1 自动安装——执行前先宣布缺失组件、安装目标 <project-root>/tools/ 与预计规模，随后运行 node scripts/install_all.js --project-dir <project-root> --yes --markdown 自动下载并解压；自动安装失败后才询问用户是否已提前安装（提供 install-dir 或 firefox 可执行文件路径）或提供安装目录。');
  }
  if (rp.defaultIsSystemFirefoxFallback || rp.explicitBrowserPathNotVerified) {
    next.push('检测到可能的系统 Firefox fallback 或未验证 Firefox 路径：这不视为 ruyiPage 绕检测方案通过，必须改用 ruyiPage managed runtime / release 含 ruyi 标识的定制 Firefox。');
  }
  if (!result.ruyiTrace.installed) next.push('如果本 case 取证需要 ruyiPage + RuyiTrace，当前 RuyiTrace 未通过检测时不得自动降级为仅 ruyiPage；按 GATE-1 自动安装——执行前先宣布缺失组件、安装目标 <project-root>/tools/ 与预计规模，随后运行 node scripts/install_all.js --project-dir <project-root> --yes --markdown 自动下载 RuyiTrace.zip 并解压；自动安装失败后才由用户选择安装 / 提供 RuyiTrace.exe 所在目录，或明确确认降级为仅 ruyiPage。用户选择安装时，需等待 RuyiTrace.exe 可打开且 firefox/RUYI_DOMTRACE.txt 存在后再继续。');
  if (result.ruyiTrace.installed && !result.ruyiTrace.kernelVerified) next.push('RuyiTrace 已安装但定制 trace 内核未验证（需要 firefox/firefox(.exe) 和 firefox/RUYI_DOMTRACE.txt）；请确认 RuyiTrace 定制 Firefox 是否完整安装。');
  result.nextRequiredInput = next;
  return result;
}

function renderRuntimeCheck(c) {
  const status = c.managedRuntimeVerified ? '通过' : '不通过';
  const lines = [`  - ${c.label}：${status}`];
  if (c.executable) lines.push(`    - Firefox：${c.executableExists ? '存在' : '不存在'} - ${c.executable}`);
  if (c.installJsonPath) lines.push(`    - install.json：${c.installJsonExists ? '存在' : '不存在'} - ${c.installJsonPath}`);
  if (c.runtimeRelease) lines.push(`    - release：${c.runtimeRelease}`);
  if (c.runtimeVersion) lines.push(`    - version：${c.runtimeVersion}`);
  if (c.runtimeAsset) lines.push(`    - asset：${c.runtimeAsset}`);
  lines.push(`    - 原因：${c.reason || '无'}`);
  return lines;
}

function renderMarkdown(result) {
  const lines = ['# 外部浏览器工具检测结果', ''];
  lines.push('## Node.js');
  lines.push(`- 版本：${result.node.version}`);
  lines.push(`- 是否满足 ≥ v18：${result.node.ok ? '是' : '否'}`);
  lines.push('');
  const rp = result.ruyiPage;
  lines.push('## ruyiPage');
  lines.push(`- Python 包是否检测到：${rp.packageInstalled ? '是' : '否'}`);
  if (rp.packageInstalled) {
    lines.push(`- Python：${[rp.python].concat(rp.pythonArgsPrefix || []).join(' ')}`.trim());
    lines.push(`- ruyiPage 版本：${rp.version || '未知'}`);
    lines.push(`- 最低版本要求（skill 脚本 API 依据）：>= ${rp.minVersion || '1.2.45'}`);
    lines.push(`- 是否满足最低版本：${rp.packageVersionOk ? '是' : '否'}`);
    lines.push(`- smart_fingerprint 依赖 requests 是否可用：${rp.requestsAvailable ? '是' : '否'}`);
    if (rp.requestsError) lines.push(`- requests 检测错误：${rp.requestsError}`);
    lines.push(`- 默认解析路径：${rp.defaultRuntimePath || '未检测到'}`);
    lines.push(`- 默认解析路径是否存在：${rp.defaultRuntimePathExists ? '是' : '否'}`);
    lines.push(`- 默认解析路径是否为定制 Firefox：${rp.defaultRuntimeVerified ? '是' : '否'}`);
  } else {
    lines.push(`- 原因：${rp.reason}`);
  }
  lines.push(`- 定制 Firefox runtime 是否通过验证：${rp.managedRuntimeVerified ? '是' : '否'}`);
  if (rp.runtimeExecutable) lines.push(`- 已验证 runtime Firefox：${rp.runtimeExecutable}`);
  if (rp.runtimeRelease) lines.push(`- runtime release：${rp.runtimeRelease}`);
  if (rp.runtimeVersion) lines.push(`- runtime version：${rp.runtimeVersion}`);
  if (rp.runtimeInstallJson) lines.push(`- runtime install.json：${rp.runtimeInstallJson}`);
  lines.push(`- 是否存在系统 Firefox fallback / 未验证路径风险：${rp.isSystemFirefoxFallback ? '是' : '否'}`);
  lines.push(`- 是否需要安装或提供定制 runtime：${rp.mustInstallManagedRuntime ? '是' : '否'}`);
  lines.push(`- 是否满足推荐取证启动条件：${rp.recommendedForAntiDetectionProbe ? '是' : '否'}`);
  lines.push(`- ruyiPage 结论：${rp.conclusion}`);
  if (rp.runtimeChecks && rp.runtimeChecks.length) {
    lines.push('', '### ruyiPage runtime 路径验证明细');
    for (const c of rp.runtimeChecks) lines.push(...renderRuntimeCheck(c));
  }

  lines.push('', '## RuyiTrace');
  lines.push(`- 是否检测到：${result.ruyiTrace.installed ? '是' : '否'}`);
  lines.push(`- 定制 trace 内核是否验证：${result.ruyiTrace.kernelVerified ? '是' : '否'}`);
  if (result.ruyiTrace.home) lines.push(`- 目录：${result.ruyiTrace.home}`);
  if (result.ruyiTrace.exe) lines.push(`- 可执行文件：${result.ruyiTrace.exeExists ? '存在' : '不存在'} - ${result.ruyiTrace.exe}`);
  if (result.ruyiTrace.firefoxExe) lines.push(`- trace Firefox：${result.ruyiTrace.firefoxExists ? '存在' : '不存在'} - ${result.ruyiTrace.firefoxExe}`);
  if (result.ruyiTrace.marker) lines.push(`- 定制内核标志：${result.ruyiTrace.markerExists ? '存在' : '不存在'} - ${result.ruyiTrace.marker}`);
  if (result.ruyiTrace.reason) lines.push(`- 原因：${result.ruyiTrace.reason}`);
  if (result.ruyiTrace.installed) {
    lines.push('- 采集方式：RuyiTrace 已检测通过，采集方式默认自动 trace（`capture_ruyitrace_log.js --url ...`），自动失败、需登录/验证/权限交互或用户已提供日志时转手动 trace（`capture_ruyitrace_log.js --input <日志>` 导入）；不询问用户选择。');
    lines.push('- 自动 trace 示例：`node scripts/capture_ruyitrace_log.js --url <target-page-url> --case-dir case --ruyitrace-home <RuyiTrace-dir> --evidence-signal handshake --import-after --markdown`');
  }

  if (result.ruyiTrace.version) lines.push(`- 本机版本（目录名识别）：${result.ruyiTrace.version}`);

  if (result.updates && result.updates.length) {
    lines.push('', '## 版本更新提示（仅提示，不自动更新）');
    for (const u of result.updates) {
      lines.push(`- ${u.scope}：当前 ${u.local} → 最新 ${u.latest}`);
      lines.push(`  - 更新命令（需用户确认后执行）：\`${u.hint}\``);
      if (u.hintNote) lines.push(`  - 注意：${u.hintNote}`);
    }
    lines.push('', '> 检测到新版只做提示，不会自动下载或更新；确认更新前请先完成当前 case 或固定版本基线。更新工具版本可能改变指纹 / 日志格式，旧取证样本与新工具样本不能混用。');
  }

  if (result.nextRequiredInput.length) {
    lines.push('', '## 下一步');
    for (const item of result.nextRequiredInput) lines.push(`- ${item}`);
  }
  return lines.join('\n') + '\n';
}

function detectQuick(args) {
  return { node: detectNode() };
}

function renderQuickMarkdown(result) {
  const lines = ['# 快速工具检测', ''];
  lines.push('## Node.js');
  lines.push(`- 版本: ${result.node.version}`);
  lines.push(`- 是否满足 ≥ v18: ${result.node.ok ? '是' : '否'}`);
  lines.push('', '## 结论');
  if (result.node.ok) {
    lines.push('- Node.js 版本满足要求');
  } else {
    lines.push('- Node.js 版本不满足要求（需 ≥ v18）');
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); process.exit(0); }
  if (process.env.RUYI_INSECURE_TLS === '1') {
    console.error('[警告] RUYI_INSECURE_TLS=1：已关闭 TLS 证书校验，仅限可信内网透明代理场景。');
  }
  if (args.quick) {
    const result = detectQuick(args);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    if (args.markdown) process.stdout.write(renderQuickMarkdown(result));
    return;
  }
  // 多 case 项目共享 tools 时，--project-dir 可能被传成 case 目录：向上查找含 tools/ 的祖先，
  // 否则已装在共享工程根 tools/ 的 RuyiTrace/ruyipage runtime 会被误判缺失
  if (args.projectDir) args.projectDir = paths.normalizeProjectDir(args.projectDir);
  const result = withNextSteps(detect(args));
  if (args.offline) {
    result.latest = {};
    result.updates = [];
  } else {
    const latest = await fetchLatestReleases();
    result.latest = latest;
    result.updates = buildUpdates(result, latest);
  }
  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(renderMarkdown(result));
}

main().catch((err) => {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
});
