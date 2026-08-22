#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const REPOS = {
  // 资产命名兼容两代：RuyiTrace.zip（旧）/ RuyiTrace-2.5.5-win64.zip（新）
  ruyitrace: { owner: 'LoseNine', repo: 'Firefox-FingerPrint-Analyzer', asset: /^RuyiTrace.*\.zip$/i },
  'ruyipage-firefox': { owner: 'LoseNine', repo: 'ruyipage', asset: null },
};

// 透明代理自签 CA 场景可显式开启（默认关闭，强制 TLS 校验）
const TLS_OPTS = process.env.RUYI_INSECURE_TLS === '1'
  ? { rejectUnauthorized: false }
  : {};

function parseArgs(argv) {
  const args = { tool: '', dest: '', extract: false, dryRun: false, sha256: '', json: false, markdown: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--tool') args.tool = nextVal('');
    else if (a === '--dest') args.dest = nextVal('');
    else if (a === '--extract') args.extract = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--sha256') args.sha256 = nextVal('');
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
  node scripts/download_ruyi_tool.js --tool ruyitrace --dest <download-dir> --dry-run --markdown
  node scripts/download_ruyi_tool.js --tool ruyitrace --dest <download-dir> --markdown
  node scripts/download_ruyi_tool.js --tool ruyitrace --dest <download-dir> --extract --markdown
  node scripts/download_ruyi_tool.js --tool ruyipage-firefox --dest <download-dir> --dry-run --markdown

说明：仅在用户确认后下载。--extract 自动解压 zip 到 dest 目录（Windows 用 Expand-Archive）。
供应链锁定：scripts/lib/tool-pins.json 中命中 '<tool>/<资产名>' 记录时强制 sha256 校验，
不匹配即删除产物并失败；--sha256 <hex> 可显式指定期望哈希（同样强制）。
未锁定的下载会在输出中报告实际 sha256，首次安装后用
  node scripts/check_tool_pins.js --record --file <产物> --tool <tool> --tag <release tag>
固化记录，防止上游 release 被替换后无感知引入篡改产物。`;
}

// 下载后哈希校验：命中 pin 或显式 --sha256 必须匹配，否则删除产物并抛错
function verifyDownloadedHash(tool, safeName, file, expectedFromArg) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  const actual = h.digest('hex');
  let pinRecord = null;
  try {
    const pins = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib', 'tool-pins.json'), 'utf8'));
    pinRecord = (pins.records || {})[`${tool}/${safeName}`] || null;
  } catch { /* pins 清单缺失/损坏不阻断下载，按未锁定处理 */ }
  const expected = expectedFromArg || (pinRecord ? pinRecord.sha256 : '');
  if (expected && actual.toLowerCase() !== String(expected).toLowerCase()) {
    try { fs.unlinkSync(file); } catch { /* ignore */ }
    throw new Error(`sha256 校验失败：期望 ${expected}，实际 ${actual}。产物已删除——上游资产与锁定记录/期望值不一致，核实 release 来源后再更新 scripts/lib/tool-pins.json。`);
  }
  return {
    sha256: actual,
    pinStatus: pinRecord ? 'pinned(verified)' : (expectedFromArg ? 'arg(verified)' : 'unpinned'),
    pinTag: pinRecord ? (pinRecord.tag || '') : '',
  };
}

// ----- URL 安全校验（SSRF / file:// / 明文 防御）-----
function isPrivateHost(host) {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '[::1]' || h === '::1') return true;
  if (/^127\./.test(h) || h === '0.0.0.0') return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // 含云元数据 169.254.169.254
  return false;
}

function assertSafeUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`非法 URL：${url}`); }
  if (u.protocol !== 'https:') throw new Error(`仅允许 https（拒绝明文/文件协议）：${url}`);
  if (isPrivateHost(u.hostname)) throw new Error(`拒绝访问内网 / 云元数据地址：${url}`);
  return u;
}

function httpsGet(url, options = {}) {
  const u = assertSafeUrl(url);
  return new Promise((resolve, reject) => {
    const req = https.get(u, Object.assign({ headers: { 'User-Agent': 'web-js-env-patcher-skill' }, timeout: options.timeout || 60000 }, TLS_OPTS), (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if ((options.redirects || 0) >= 5) return reject(new Error('重定向次数过多，拒绝继续'));
        const next = new URL(headers.location, u).href;
        return resolve(httpsGet(next, Object.assign({}, options, { redirects: (options.redirects || 0) + 1 })));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode}：${url}`));
      }
      resolve(res);
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
  });
}

function getJson(url) {
  return httpsGet(url, { timeout: 60000 }).then(res => new Promise((resolve, reject) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (err) { reject(new Error(`JSON 解析失败：${err.message}`)); }
    });
    res.on('error', reject);
  }));
}

function downloadFile(url, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return httpsGet(url, { timeout: 1800000 }).then(res => new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(file);
    res.pipe(ws);
    ws.on('finish', () => resolve(file));
    ws.on('error', reject);
  }));
}

function isDirectory(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; }
}

// ----- 资产名净化（防 Zip Slip / 路径穿越）-----
function sanitizeAssetName(name) {
  const base = path.basename(String(name || ''));
  if (!base || base === '.' || base === '..') throw new Error(`非法资产名：${name}`);
  if (/[\\/]/.test(base)) throw new Error(`资产名含路径分隔符：${name}`);
  if (!/^[A-Za-z0-9._-]+$/.test(base)) throw new Error(`资产名含非法字符：${name}`);
  return base;
}

// ----- 解压 + Zip Slip 校验 -----
function assertTreeInside(root) {
  const rootReal = fs.realpathSync(root);
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      const p = path.join(dir, name);
      const real = fs.realpathSync(p);
      if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
        throw new Error(`Zip Slip：条目越界：${p} -> ${real}`);
      }
      let st;
      try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isDirectory() && !st.isSymbolicLink()) stack.push(p);
    }
  }
}

function extractZip(zipFile, destDir) {
  if (/[\0]/.test(zipFile) || /[\0]/.test(destDir)) throw new Error('路径含非法字符（空字节）');
  fs.mkdirSync(destDir, { recursive: true });

  let ret;
  if (process.platform === 'win32') {
    // 使用 PowerShell here-string（@'...'@）嵌入路径，内容不被解析，杜绝单引号注入
    const cmd = `Expand-Archive -LiteralPath @'\n${zipFile}\n'@ -DestinationPath @'\n${destDir}\n'@ -Force`;
    ret = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  } else {
    ret = spawnSync('unzip', ['-o', zipFile, '-d', destDir], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  }

  if (ret.status !== 0) {
    return {
      ok: false,
      stdout: (ret.stdout || '').trim(),
      stderr: (ret.stderr || '').trim(),
      error: ret.error ? ret.error.message : '',
    };
  }

  // Zip Slip 兜底：解压后校验所有条目真实路径均落在 destDir 内
  assertTreeInside(destDir);

  // 修复嵌套目录：zip 内部常有单个根目录（如 RuyiTrace.zip → RuyiTrace/，
  // 新版 RuyiTrace-2.5.5-win64.zip → RuyiTrace-2.5.5-win64/ 或 RuyiTrace/），统一提升一层
  const entries = fs.readdirSync(destDir);
  if (entries.length === 1) {
    const nestedDir = path.join(destDir, entries[0]);
    if (isDirectory(nestedDir)) {
      const destReal = fs.realpathSync(destDir);
      for (const entry of fs.readdirSync(nestedDir)) {
        const src = path.join(nestedDir, entry);
        // 提升前逐项复核：拒绝符号链接 / junction / reparse point，并校验真实路径仍在目标内
        const st = fs.lstatSync(src);
        if (st.isSymbolicLink()) throw new Error(`拒绝符号链接条目：${src}`);
        const real = fs.realpathSync(src);
        if (real !== destReal && !real.startsWith(destReal + path.sep)) {
          throw new Error(`Zip Slip：提升条目越界：${src} -> ${real}`);
        }
        fs.renameSync(src, path.join(destDir, entry));
      }
      fs.rmdirSync(nestedDir);
    }
  }
  // 提升动作后再复验一次整树边界，防御提升引入的新越界
  assertTreeInside(destDir);
  return { ok: true, stdout: (ret.stdout || '').trim(), stderr: (ret.stderr || '').trim(), error: '' };
}

function pickRuyiPageAsset(assets) {
  // 资产命名兼容两代：firefox-<ver>.en-US.win64.zip（旧）/ firefox-<ver>.en-US.win64-<date>.zip（新，win64 后带日期戳）
  if (process.platform === 'win32') return assets.find(a => /firefox.*win64.*\.zip$/i.test(a.name)) || assets.find(a => /win64.*\.zip$/i.test(a.name));
  if (process.platform === 'linux' && process.arch === 'x64') return assets.find(a => /linux.*(x86_64|amd64).*\.tar\.(xz|gz)$/i.test(a.name));
  if (process.platform === 'darwin') return assets.find(a => /(mac|darwin|osx).*\.(zip|tar\.(xz|gz))$/i.test(a.name)) || assets.find(a => /firefox/i.test(a.name));
  return assets.find(a => /firefox/i.test(a.name));
}

function selectAsset(tool, assets) {
  if (tool === 'ruyipage-firefox') return pickRuyiPageAsset(assets);
  const rule = REPOS[tool].asset;
  return assets.find(a => rule.test(a.name));
}

function mirrorUrl(url) {
  const mirror = process.env.GITHUB_MIRROR || '';
  if (!mirror) return url;
  // 仅代理 github.com 的下载 URL（release asset），不代理 api.github.com
  if (url.startsWith('https://github.com/') || url.startsWith('http://github.com/')) {
    const prefixed = mirror.replace(/\/$/, '') + '/' + url;
    try { assertSafeUrl(prefixed); } catch { return url; } // 镜像不合规则回退直连
    return prefixed;
  }
  return url;
}

async function plan(args) {
  if (!args.tool || !REPOS[args.tool]) throw new Error(`必须提供 --tool，可选：${Object.keys(REPOS).join(', ')}`);
  if (!args.dest) throw new Error('必须提供 --dest');
  const repo = REPOS[args.tool];
  const apiUrl = mirrorUrl(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`);
  const release = await getJson(apiUrl);
  const asset = selectAsset(args.tool, release.assets || []);
  if (!asset) {
    const available = (release.assets || []).map(a => a.name).join(', ') || '(无资产)';
    throw new Error(`未找到适合当前工具 / 平台的 release asset：${args.tool}（release ${release.tag_name || ''} 可用资产：${available}）`);
  }
  const safeName = sanitizeAssetName(asset.name);
  const destDir = path.resolve(args.dest);
  const file = path.join(destDir, safeName);
  const isZip = /\.zip$/i.test(safeName);
  const extractDir = isZip ? path.join(destDir, safeName.replace(/\.zip$/i, '')) : '';
  const downloadUrl = mirrorUrl(asset.browser_download_url);
  const result = {
    tool: args.tool,
    repo: `${repo.owner}/${repo.repo}`,
    releaseName: release.name || '',
    tagName: release.tag_name || '',
    releaseUrl: release.html_url || '',
    assetName: safeName,
    assetSize: asset.size,
    downloadUrl,
    mirror: process.env.GITHUB_MIRROR || '',
    destFile: file,
    extractDir,
    dryRun: args.dryRun,
    downloaded: false,
    extracted: false,
  };
  if (!args.dryRun) {
    await downloadFile(downloadUrl, file);
    result.downloaded = true;
    const verified = verifyDownloadedHash(args.tool, safeName, file, args.sha256);
    Object.assign(result, verified);
    if (args.extract && isZip) {
      const ex = extractZip(file, extractDir);
      result.extracted = ex.ok;
      result.extractError = ex.ok ? '' : (ex.stderr || ex.error || '解压失败');
    }
  } else {
    result.sha256 = '';
    result.pinStatus = 'dry-run';
  }
  return result;
}

function renderMarkdown(result) {
  const lines = ['# Ruyi 工具下载结果', '', `- 工具：${result.tool}`, `- 仓库：${result.repo}`, `- Release：${result.releaseName || result.tagName}`, `- Release URL：${result.releaseUrl}`, `- 资产：${result.assetName}`, `- 大小：${result.assetSize}`, `- 目标文件：${result.destFile}`, `- dry-run：${result.dryRun ? '是' : '否'}`, `- 是否已下载：${result.downloaded ? '是' : '否'}`];
  if (result.downloaded) {
    lines.push(`- sha256：${result.sha256}`);
    lines.push(`- pin 状态：${result.pinStatus}${result.pinTag ? `（tag ${result.pinTag}）` : ''}`);
  }
  if (result.mirror) lines.unshift(`> GitHub 镜像：${result.mirror}`, '');
  if (result.extractDir) {
    lines.push(`- 解压目录：${result.extractDir}`);
    lines.push(`- 是否已解压：${result.extracted ? '是' : '否'}`);
    if (result.extractError) lines.push(`- 解压错误：${result.extractError}`);
  }
  lines.push('', '## 下一步');
  if (result.dryRun) lines.push('- 当前只是下载计划；只有用户确认后再去掉 `--dry-run` 下载。');
  else if (result.extracted) lines.push('- 下载并解压完成。请重新运行检测脚本验证。');
  else lines.push('- 下载完成。请用户解压 / 安装后，提供工具目录并重新运行检测脚本。');
  if (result.downloaded && result.pinStatus === 'unpinned') {
    lines.push('', `## 供应链提示（未锁定）`,
      `- 本次下载产物 sha256：\`${result.sha256}\``,
      '- 首次安装确认可用后固化锁定记录，之后同资产下载将强制校验：',
      '```bash',
      `node scripts/check_tool_pins.js --record --file "${result.destFile}" --tool ${result.tool} --tag ${result.tagName || 'v?'}`,
      '```');
  }
  return lines.join('\n') + '\n';
}

async function main() {
  if (process.env.RUYI_INSECURE_TLS === '1') {
    console.error('[警告] RUYI_INSECURE_TLS=1：已关闭 TLS 证书校验，仅限可信内网透明代理场景。');
  }
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); return; }
  const result = await plan(args);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(renderMarkdown(result));
}

try {
  main().catch((err) => {
    console.error(err.message || String(err));
    console.error(usage());
    process.exit(1);
  });
} catch (err) {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
}
