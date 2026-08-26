/**
 * final.js — JS 逆向交付物【单一入口】（轻量：自验 + 可被 require 调用）。
 *
 * 双重角色：
 *   - 自验：   node final.js            → 补环境 → 生成加密参数 → 用 TLS 客户端发真实请求 → 输出结果 → 销毁 session
 *   - 库调用： const { sign } = require('./result');  → 只取 API，不自动执行、不发请求
 *
 * 含 require.main 守卫：被其他项目 require 时只导出 API，不会自动跑主流程、不会发请求。
 *
 * 硬编码纪律（红线）：本文件不含任何 ruyiPage / RuyiTrace / Playwright / 浏览器自动化代码；
 * 所有加密参数均由补环境后的 signer 动态生成，不硬编码样本 sign/token 值。
 *
 * 使用方式：
 *   node final.js                          # 默认：发真实 API 请求，交叉验证 5 次
 *   node final.js --verify 5               # 指定验证次数
 *   node final.js --sign-only              # 仅输出签名，不发真实请求（需用户明确指定）
 *   node final.js --cookie "name=value"    # 注入用户 cookie（覆盖设备 cookie 同名项）
 *
 * 成功语义（自验）：HTTP 200 ≠ 成功。必须在 config.json 配置 responseValidation
 * （jsonPath / minLength / contains，从本 case 真实成功样本提取）才能判「通过」；
 * 未配置时所有 200 响应一律记为「未判定」，整体不能宣称通过。
 * 退出码：0=全部通过；1=入口异常；2=存在失败；3=存在未判定（缺 responseValidation）。
 *
 * 并发注意：signer 通常持有 vm context / WASM 实例 / Cookie 状态，非无状态。
 * 高并发场景需调用方自行池化 signer 实例（多个独立 vm context），不要跨线程/进程共享同一 signer。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ============================================================
// 依赖（由用户从 templates 复制到 result/src/ 后填充）
// ============================================================
// 补环境：从 templates/vm-sandbox/install-env.js 复制到 result/src/env/install-env.js
const { installEnv } = require('./src/env/install-env');
// 签名生成：用户自行实现（参考 cases/ 同类案例），需导出 generateSign + buildParams
const signer = require('./src/signer');
// 请求客户端：从 templates/node-request/client.js 复制到 result/src/request/client.js
const { createRequestSession, CookieJar } = require('./src/request/client');

// 指纹 fixture：用户从浏览器采集真实值写入 result/src/env/fixtures/index.js（可选）
let FIXTURES = {};
try {
  FIXTURES = require('./src/env/fixtures/index.js');
} catch (_) {
  FIXTURES = {};
}

// 动态资源刷新模块（可选）：复制到 result/src/resources/fetch-runtime-resources.js
let fetchRuntimeResources = null;
try {
  fetchRuntimeResources = require('./src/resources/fetch-runtime-resources').fetchRuntimeResources;
} catch (_) {
  fetchRuntimeResources = async () => ({});
}

// ============================================================
// 配置（静态外置 config.json + 内置默认，不做环境变量覆盖）
// ============================================================
function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (_) {
    // 无 config.json 时退回内置默认
  }
  return Object.assign(
    {
      TARGET_URL: '',
      HOME_URL: '',
      INIT_URL: '',
      METHOD: 'GET',
      USER_AGENT: '',
      IMPERSONATE: 'chrome135',
      SIGN_PARAM_NAME: 'sign',
      DEVICE_COOKIE: '',
      extraHeaders: {},
      // 响应校验规则：自验按规则判定业务数据是否成功。必须从本 case 真实成功样本提取。
      // 未配置时 HTTP 200 只记「未判定」，拒绝宣称通过（风控接口常以 200 + 错误码返回）。
      // 形如 { "jsonPath": "data.list", "minLength": 1, "contains": "success" }
      responseValidation: null,
    },
    cfg
  );
}
const CONFIG = loadConfig();

// ============================================================
// 补环境对象缓存（进程内复用，避免每次 sign 都重建 vm 上下文）
// ============================================================
let _envCache = null;
function getEnv(opts = {}) {
  if (_envCache) return _envCache;
  const config = opts.config || CONFIG;
  _envCache = installEnv({
    fixtures: FIXTURES,
    userAgent: config.USER_AGENT,
    cookie: mergeCookie(config.DEVICE_COOKIE, opts.userCookie),
  });
  return _envCache;
}

/** 合并 Cookie（用户 cookie 优先同名项） */
function mergeCookie(deviceCookie, userCookie) {
  if (!userCookie) return deviceCookie || '';
  if (!deviceCookie) return userCookie;
  const setPair = (map, pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) map.set(k, v);
  };
  const merged = new Map();
  for (const pair of deviceCookie.split(';').map(s => s.trim()).filter(Boolean)) setPair(merged, pair);
  for (const pair of userCookie.split(';').map(s => s.trim()).filter(Boolean)) setPair(merged, pair);
  return Array.from(merged.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ============================================================
// 可复用 API（被 require 时导出；本身不发请求）
// ============================================================
/**
 * 生成加密参数。只计算、不发任何网络请求。
 * @param {Object} [rawParams] 业务参数，会与 buildParams() 的默认参数合并（同名覆盖）
 * @param {Object} [opts]
 * @param {Object} [opts.config]    已加载的配置（不传则使用 CONFIG）
 * @param {string} [opts.userCookie] 注入的用户 cookie（覆盖设备 cookie 同名项）
 * @returns {{ params: Object, signature: string, env: Object }}
 */
function sign(rawParams = {}, opts = {}) {
  const config = opts.config || CONFIG;
  const env = getEnv(opts);
  const baseParams = typeof signer.buildParams === 'function' ? signer.buildParams(config) : {};
  const params = Object.assign({}, baseParams, rawParams);
  const signature = signer.generateSign(params, env);
  return { params, signature, env };
}

/**
 * 在 sign() 基础上组装出「待发送」请求描述符（仍不发请求）。
 * @param {Object} [opts]
 * @param {Object} [opts.rawParams]   业务参数（传给 sign）
 * @param {Object} [opts.config]      配置
 * @param {string} [opts.userCookie]   注入 cookie
 * @param {Object} [opts.extraHeaders] 额外请求头（如业务 token）
 * @returns {{ method: string, url: string, headers: Object, params: Object, signature: string }}
 */
function buildSignedRequest(opts = {}) {
  const config = opts.config || CONFIG;
  const { params, signature } = sign(opts.rawParams || {}, opts);

  const url = new URL(config.TARGET_URL);
  url.searchParams.set(config.SIGN_PARAM_NAME, signature);
  for (const [k, v] of Object.entries(params)) {
    if (k === config.SIGN_PARAM_NAME) continue;
    url.searchParams.set(k, String(v));
  }

  const headers = Object.assign(
    { 'User-Agent': config.USER_AGENT },
    config.extraHeaders || {},
    opts.extraHeaders || {}
  );

  return {
    method: config.METHOD,
    url: url.toString(),
    headers,
    params: Object.assign({}, params, { [config.SIGN_PARAM_NAME]: signature }),
    signature,
  };
}

/** 创建 TLS 指纹兼容 Session（与自验主流程共用） */
async function createClient(opts = {}) {
  const config = opts.config || CONFIG;
  return createRequestSession({
    impersonate: config.IMPERSONATE,
    userAgent: config.USER_AGENT,
    ...(opts.client || {}),
  });
}

// ============================================================
// 命令行参数解析
// ============================================================
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { verify: 5, noRealRequest: false, userCookie: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--verify' && args[i + 1]) {
      opts.verify = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--sign-only' || args[i] === '--no-real-request') {
      opts.noRealRequest = true;
    } else if (args[i] === '--cookie' && args[i + 1]) {
      opts.userCookie = args[i + 1];
      i++;
    }
  }
  return opts;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function writeValidationRecord(record) {
  fs.writeFileSync(path.join(__dirname, '验证记录.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

function summarizeParameters(params) {
  return { names: Object.keys(params).sort(), count: Object.keys(params).length };
}

/**
 * 校验响应体是否符合预期业务数据（三态判定）。
 * @param {string} body
 * @param {Object} [rule] CONFIG.responseValidation
 * @returns {{ judgment: 'pass'|'fail'|'unverified', reason: string }}
 *   - pass:       规则全部命中，可计为成功
 *   - fail:       规则命中失败或响应体为空
 *   - unverified: 未配置 responseValidation —— HTTP 200 只代表传输成功，不能证明业务成功
 */
function judgeResponseBody(body, rule) {
  if (!body) return { judgment: 'fail', reason: '响应体为空' };
  if (!rule || typeof rule !== 'object') {
    return {
      judgment: 'unverified',
      reason: '未配置 responseValidation：HTTP 200 不能证明业务成功，请从真实成功样本提取响应判定规则写入 config.json',
    };
  }

  // contains：响应体包含指定字符串（适用于非 JSON 响应或宽松校验）
  if (typeof rule.contains === 'string' && rule.contains) {
    if (!body.includes(rule.contains)) {
      return { judgment: 'fail', reason: `响应体未包含期望字符串 "${rule.contains}"` };
    }
  }

  // jsonPath + minLength：按简单点路径（如 "data.list"）取值并校验长度
  if (typeof rule.jsonPath === 'string' && rule.jsonPath) {
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) {
      return { judgment: 'fail', reason: `响应体非 JSON：${e.message}` };
    }
    const segments = rule.jsonPath.split('.');
    let cur = parsed;
    for (const seg of segments) {
      if (cur == null || typeof cur !== 'object') { cur = undefined; break; }
      cur = cur[seg];
    }
    if (cur == null) {
      return { judgment: 'fail', reason: `jsonPath "${rule.jsonPath}" 未命中` };
    }
    if (typeof rule.minLength === 'number') {
      const len = Array.isArray(cur) ? cur.length : String(cur).length;
      if (len < rule.minLength) {
        return { judgment: 'fail', reason: `jsonPath "${rule.jsonPath}" 长度 ${len} < minLength ${rule.minLength}` };
      }
    }
  }

  return { judgment: 'pass', reason: '' };
}

// ============================================================
// 主流程（仅自验时运行）
// ============================================================
async function main() {
  const opts = parseArgs();

  console.log('=== JS 逆向 final.js 启动（自验入口）===');
  console.log(`目标 API: ${CONFIG.TARGET_URL}`);
  console.log(`UA: ${CONFIG.USER_AGENT || '(未配置)'}`);
  console.log(`TLS 客户端: ${CONFIG.IMPERSONATE}`);
  console.log(`验证次数: ${opts.verify}`);
  console.log(`发送真实请求: ${opts.noRealRequest ? '否（--sign-only）' : '是（默认）'}`);

  // ----- 仅输出签名模式（需用户明确指定 --sign-only）-----
  if (opts.noRealRequest) {
    console.log('\n--- 仅输出签名（--sign-only，不发真实请求）---');
    for (let i = 0; i < opts.verify; i++) {
      const { params, signature } = sign({}, { userCookie: opts.userCookie });
      console.log(`[第 ${i + 1} 次] sign=${signature} params=${JSON.stringify(params)}`);
    }
    writeValidationRecord({
      mode: 'sign-only',
      signOnlyExempt: true,
      exemptionReason: '用户明确指定 --sign-only，只输出参数不执行真实 HTTP 验证',
      attempts: [],
    });
    return;
  }

  // ----- 创建请求 Session -----
  const session = await createClient({ userCookie: opts.userCookie });
  const jar = new CookieJar();
  // Cookie 生命周期交给请求层：每次请求自动携带 jar、响应后自动合并 Set-Cookie、过期自动清理
  session.defaults({ jar });

  try {
    // ----- 动态资源刷新（可选）-----
    console.log('\n--- 刷新动态资源 ---');
    const runtimeCtx = await fetchRuntimeResources(session, jar, {
      homeUrl: CONFIG.HOME_URL,
      initUrl: CONFIG.INIT_URL,
    });
    console.log(`动态资源刷新完成: cookie 数 ${jar.cookies.size}`);

    // ----- 交叉验证 -----
    console.log(`\n--- 交叉验证 ${opts.verify} 次 ---`);
    let successCount = 0;
    let failCount = 0;
    let unverifiedCount = 0;
    const attempts = [];

    for (let i = 0; i < opts.verify; i++) {
      let attempt = {
        timestamp: new Date().toISOString(),
        httpStatus: 0,
        parameterSummary: '参数生成失败',
        sessionStage: 'target-api',
        judgment: 'error',
        responseValid: false,
      };
      try {
        const req = buildSignedRequest({ userCookie: opts.userCookie });
        attempt.parameterSummary = summarizeParameters(req.params);
        console.log(`\n[第 ${i + 1} 次请求]`);
        console.log(`  URL: ${req.url}`);
        console.log(`  sign: ${req.signature}`);
        console.log(`  cookie: ${(jar.toString() || '').slice(0, 80)}...`);

        const res = await session.request(req.method, req.url, {
          headers: req.headers,
        });

        console.log(`  状态码: ${res.status}`);
        const body = res.body == null ? '' : (typeof res.body === 'string' ? res.body : JSON.stringify(res.body));
        console.log(`  响应: ${body.slice(0, 200)}`);

        attempt.httpStatus = res.status;
        if (res.status !== 200) {
          failCount++;
          attempt.judgment = 'fail';
          console.log(`  [WARN] 状态码非 200`);
        } else {
          // 业务数据判定：未配置 responseValidation 时记「未判定」，不能计为成功
          const check = judgeResponseBody(body, CONFIG.responseValidation);
          attempt.judgment = check.judgment;
          attempt.responseValid = check.judgment === 'pass';
          if (check.judgment === 'pass') {
            successCount++;
          } else if (check.judgment === 'unverified') {
            unverifiedCount++;
            console.log(`  [UNVERIFIED] ${check.reason}`);
          } else {
            failCount++;
            console.log(`  [WARN] 业务数据校验失败：${check.reason}`);
          }
        }
      } catch (e) {
        failCount++;
        attempt.judgment = 'error';
        console.log(`  [FAIL] 异常: ${e.message}`);
      }
      attempts.push(attempt);

      if (i < opts.verify - 1) {
        await sleep(1000 + Math.random() * 2000);
      }
    }

    console.log(`\n=== 验证结果 ===`);
    console.log(`通过: ${successCount} / ${opts.verify}`);
    console.log(`失败: ${failCount} / ${opts.verify}`);
    if (unverifiedCount > 0) {
      console.log(`未判定: ${unverifiedCount} / ${opts.verify}（未配置 responseValidation，拒绝宣称通过）`);
    }
    writeValidationRecord({
      mode: 'online',
      responseValidation: CONFIG.responseValidation,
      summary: { total: opts.verify, pass: successCount, fail: failCount, unverified: unverifiedCount },
      attempts,
    });
    if (failCount > 0) {
      process.exitCode = 2;
    } else if (unverifiedCount > 0) {
      process.exitCode = 3;
    }
  } finally {
    if (session.close) {
      session.close();
      console.log('Session 已关闭');
    }
  }
}

// ============================================================
// 启动（require.main 守卫：被 require 时不自动执行）
// ============================================================
if (require.main === module) {
  main().catch(err => {
    console.error('主流程异常:', err);
    process.exit(1);
  });
}

// 同时作为库导出（轻量透传，方便 require('./result') 直接拿到 API）
module.exports = { sign, buildSignedRequest, CONFIG, loadConfig };
