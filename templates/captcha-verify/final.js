/**
 * final.js — 验证码逆向交付物【单一入口】（load → solve → verify 三段链路）。
 *
 * 这是 provider-neutral 骨架。真实平台协议必须由本 case 的 src/adapter.js 提供；
 * 本文件不假设厂商、接口名、HTTP 方法、JSONP、字段名或加密方案。
 *
 * 双重角色：
 *   - 自验：   node final.js            → 完整走 load→solve→verify→业务接口，交叉验证 5 次
 *   - 库调用： const { solveCaptcha, verifyChain } = require('./result');  → 只取 API，不自动执行
 *
 * 含 require.main 守卫。硬编码纪律（红线）：不含浏览器自动化代码；challenge 每次重新 load，不复用。
 *
 * 使用方式：
 *   node final.js                       # 默认：完整链路发真实请求，交叉验证 5 次
 *   node final.js --verify 5            # 指定验证次数
 *   node final.js --sign-only           # 仅输出 verify 参数（w 等），不发真实请求
 *   node final.js --cookie "name=value" # 注入用户 cookie（业务接口需要登录态时）
 *
 * answer JSON 契约见 references/captcha/captcha-overview.md；
 * 成功基线/失败复盘见 scripts/check_success_baseline.js + check_verification_attempts.js。
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// 依赖（由用户从 templates 复制到 result/src/ 后填充）
// ============================================================
// 请求客户端：从 templates/node-request/client.js 复制到 result/src/request/client.js
const { createRequestSession, CookieJar } = require('./src/request/client');
// 真实平台协议适配器：必须由本 case 根据 trace/抓包实现。
let adapter = null;
try { adapter = require('./src/adapter'); } catch (_) { adapter = null; }
// 答案求解器：本地 ddddocr 或打码平台适配器，需导出 solve(imageBytes, type, options) → answer JSON
let solver = null;
try { solver = require('./src/solver'); } catch (_) { solver = null; }

// ============================================================
// 配置（静态外置 config.json + 内置默认）
// ============================================================
function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch (_) {}
  return Object.assign({
    target: { page_url: '<本 case 目标页>' },
    captcha: {
      provider: '<由本 case 证据确定>',
      captcha_type: '<由本 case 证据确定>',
    },
    solver: {
      mode: '<case-defined>',
      platform: '',
      api_key: '',
    },
    verify_count: 5,
  }, cfg);
}

// ============================================================
// 三段链路：load → solve → verify
// ============================================================

/**
 * ① load/bootstrap 阶段：完全交给 case adapter。
 */
async function loadChallenge(session, config) {
  assertAdapter();
  return adapter.loadChallenge(session, config);
}

/**
 * ② solve 阶段：下载素材 → 本地求解/人工接管/打码 → answer JSON
 * 返回：{ captcha_type, provider, offset/points, source_image_size, ... }（见 answer JSON 契约）
 *
 * solver 求解路径（按优先级）：
 *   1. 本地开源：ddddocr slide_match / OpenCV 模板匹配（solver.mode='ddddocr'）
 *   2. 人工接管：ddddocr/OpenCV 失效时（如拼图块重着色、背景像素扰动），用 scripts/click_gap.py 点击缺口
 *      → Node 侧通过 child_process 调 Python click_gap.py，或预存坐标后命令行传入
 *   3. 打码平台：solver.mode='platform'，走 solver_request_template.py 生成请求
 */
async function solveCaptcha(session, config, loadResult) {
  assertAdapter();
  const assets = await adapter.resolveAssets(session, config, loadResult);

  if (!solver) throw new Error('未配置 solver，请实现 result/src/solver.js');
  const answer = await solver.solve(assets.primary, config.captcha.captcha_type, {
    ...assets,
    provider: config.captcha.provider,
  });
  return adapter.prepareAnswer(answer, { session, config, loadResult, assets });
}

/**
 * ③ verify 阶段：加密 answer+track → 提交 → 换取通过凭据
 * 返回：由本 case adapter 定义的已验证凭据对象。
 */
async function verifyChain(session, config, loadResult, answer) {
  const request = await adapter.buildVerifyRequest({ session, config, loadResult, answer });
  if (!request || typeof request !== 'object' || !request.method || !request.url) {
    throw new Error('adapter.buildVerifyRequest 必须返回 { method, url, opts }');
  }
  const response = await session.request(request.method, request.url, request.opts || {});
  return adapter.parseVerifyResponse(response, { session, config, loadResult, answer, request });
}

/**
 * ④ 业务接口消费凭据
 */
async function callBusinessApi(session, config, credential) {
  return adapter.consumeCredential(session, config, credential);
}

// ============================================================
// 主流程：完整链路 + 交叉验证
// ============================================================
async function runOnce(config, cookieStr) {
  assertAdapter();
  const session = await createRequestSession({
    headers: cookieStr ? { Cookie: cookieStr } : {},
  });
  const jar = new CookieJar();
  session.defaults({ jar });

  try {
    const loadResult = await loadChallenge(session, config);
    const answer = await solveCaptcha(session, config, loadResult);
    const credential = await verifyChain(session, config, loadResult, answer);
    const bizResult = await callBusinessApi(session, config, credential);
    return { answer, credential, bizResult };
  } finally {
    if (session.close) session.close();
  }
}

async function main() {
  const args = require('minimist')(process.argv.slice(2), {
    boolean: ['sign-only'],
    alias: { verify: 'n', cookie: 'c' },
    default: { verify: null },
  });
  const config = loadConfig();
  assertAdapter();
  const verifyCount = args.verify || config.verify_count || 5;

  console.log(`[captcha-verify] provider=${config.captcha.provider} type=${config.captcha.captcha_type} verify=${verifyCount}`);

  if (args['sign-only']) {
    const session = await createRequestSession();
    try {
      const loadResult = await loadChallenge(session, config);
      const answer = await solveCaptcha(session, config, loadResult);
      const verifyRequest = await adapter.buildVerifyRequest({ session, config, loadResult, answer });
      console.log(JSON.stringify({ load: loadResult, answer, verifyRequest }, null, 2));
    } finally {
      if (session.close) session.close();
    }
    return;
  }

  let success = 0;
  for (let i = 1; i <= verifyCount; i++) {
    try {
      const result = await runOnce(config, args.cookie);
      success++;
      console.log(`  [${i}/${verifyCount}] OK  biz=${JSON.stringify(result.bizResult).slice(0, 100)}`);
    } catch (e) {
      console.error(`  [${i}/${verifyCount}] FAIL  ${e.message}`);
    }
  }
  console.log(`[captcha-verify] 完成 ${success}/${verifyCount}`);
  // 要求全部成功才算通过（与 README ≥5 次交叉验证一致）
  process.exit(success === verifyCount ? 0 : 1);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { loadChallenge, solveCaptcha, verifyChain, callBusinessApi, runOnce };

function assertAdapter() {
  const required = ['loadChallenge', 'resolveAssets', 'prepareAnswer', 'buildVerifyRequest', 'parseVerifyResponse', 'consumeCredential'];
  if (!adapter) throw new Error('缺少 result/src/adapter.js：请先根据本 case 的真实 trace/抓包实现平台适配器');
  const missing = required.filter((name) => typeof adapter[name] !== 'function');
  if (missing.length) throw new Error(`adapter 缺少方法：${missing.join(', ')}`);
}
