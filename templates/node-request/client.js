/**
 * Node.js TLS 指纹兼容客户端模板
 *
 * 支持两种客户端（按优先级）：
 *   1. curl-cffi-node（impersonate Chrome/Firefox，JA3/JA4/Akamai 对齐最完善）
 *   2. impers（Node.js 原生 TLS 指纹伪装）
 *
 * 注：CycleTLS 因请求 API（ja3Request/strongRequest）与统一 request 包装不兼容，已不再作为可选客户端。
 *
 * 硬性要求：
 *   - Session 模式：同一 session 复用 Cookie jar / TLS 上下文 / HTTP2 连接
 *   - final.js 中必须使用 createRequestSession + try-finally close
 *   - 不得使用普通 fetch / axios / requests 发送最终业务请求
 *   - 仅用于授权范围内的少量最终验证请求，不用于批量访问
 */

'use strict';

// ============================================================
// 客户端检测：按优先级选择可用的 TLS 兼容客户端
// ============================================================
function detectAvailableClient() {
  // 1. curl-cffi-node（推荐：impersonate 支持最完善）
  try {
    const { CurlImpersonate } = require('curl-cffi-node');
    return { name: 'curl-cffi-node', Client: CurlImpersonate };
  } catch (e) {}

  // 2. impers
  try {
    const impers = require('impers');
    return { name: 'impers', Client: impers.Session };
  } catch (e) {}

  throw new Error(
    '未检测到 TLS 指纹兼容客户端，请安装其一：\n' +
    '  npm i curl-cffi-node   # 推荐\n' +
    '  npm i impers'
  );
}

// ============================================================
// Session 工厂：创建 TLS 指纹兼容会话
// ============================================================
/**
 * 创建请求 Session
 * @param {Object} options
 * @param {string} [options.impersonate='chrome135']  目标浏览器指纹（curl-cffi-node）
 * @param {string} [options.userAgent]                自定义 UA（必须与签名用 UA 一致）
 * @param {Object} [options.headers]                  默认 Header
 * @param {string} [options.proxy]                    代理
 * @param {boolean} [options.followRedirects=true]    是否跟随重定向
 * @returns {Promise<RequestSession>}
 */
async function createRequestSession(options = {}) {
  const { name, Client } = detectAvailableClient();
  const {
    impersonate = 'chrome135',
    userAgent,
    headers = {},
    proxy,
    followRedirects = true,
  } = options;

  const finalHeaders = {
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    ...headers,
  };
  if (userAgent) finalHeaders['User-Agent'] = userAgent;

  let session;
  if (name === 'curl-cffi-node') {
    // curl-cffi-node：impersonate 模式
    session = new Client({
      impersonate,
      headers: finalHeaders,
      proxy,
      follow_redirects: followRedirects,
    });
  } else if (name === 'impers') {
    session = new Client({
      headers: finalHeaders,
      proxy,
      followRedirects,
    });
  } else {
    throw new Error(`不支持的客户端：${name}`);
  }

  // 统一包装 request 方法（适配 curl-cffi-node / impers）
  // 支持两种调用形态：
  //   session.request(method, url, opts)                    —— 常规三参
  //   session.request({ method, url, ...opts })             —— 原始请求描述符（trace/抓包导出形态，
  //                                                            也兼容 adapter 契约的 { method, url, opts } 嵌套）
  const rawRequest = session.request ? session.request.bind(session) : null;
  if (rawRequest) {
    session.request = async function (methodOrDescriptor, urlArg, optsArg = {}) {
      let method = methodOrDescriptor;
      let url = urlArg;
      let opts = optsArg;
      if (methodOrDescriptor && typeof methodOrDescriptor === 'object' && !urlArg) {
        const { method: m, url: u, opts: nested = {}, ...rest } = methodOrDescriptor;
        method = m;
        url = u;
        opts = { ...rest, ...nested };
      }
      // 合并 defaults
      const defaults = session._defaults || {};
      const mergedOpts = { ...defaults, ...opts };
      // 构建 query string
      let finalUrl = url;
      if (mergedOpts.params) {
        const urlObj = new URL(url);
        for (const [k, v] of Object.entries(mergedOpts.params)) {
          urlObj.searchParams.set(k, String(v));
        }
        finalUrl = urlObj.toString();
      }
      const merged = {
        method,
        url: finalUrl,
        headers: { ...finalHeaders, ...(mergedOpts.headers || {}) },
        body: mergedOpts.body,
        proxy: mergedOpts.proxy || proxy,
        followRedirects: mergedOpts.followRedirects ?? followRedirects,
        timeout: mergedOpts.timeout || 30,
      };
      if (mergedOpts.json !== undefined) {
        merged.body = JSON.stringify(mergedOpts.json);
        if (!merged.headers['Content-Type']) merged.headers['Content-Type'] = 'application/json';
      }
      if (mergedOpts.data !== undefined) {
        merged.body = typeof mergedOpts.data === 'object'
          ? new URLSearchParams(mergedOpts.data).toString()
          : String(mergedOpts.data);
        if (!merged.headers['Content-Type']) merged.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      // Cookie 生命周期：请求带 jar 时自动携带（显式 Cookie 头优先）
      if (mergedOpts.jar && typeof mergedOpts.jar.toString === 'function' && !merged.headers.Cookie && !merged.headers.cookie) {
        const cookieStr = mergedOpts.jar.toString();
        if (cookieStr) merged.headers.Cookie = cookieStr;
      }
      const res = await rawRequest(merged);
      const response = {
        status: res.status,
        headers: res.headers,
        body: res.body,
        text: () => Promise.resolve(typeof res.body === 'string' ? res.body : JSON.stringify(res.body)),
        json: () => Promise.resolve(typeof res.body === 'string' ? JSON.parse(res.body) : res.body),
      };
      // data 属性：与 Axios 的 res.data 语义对齐
      Object.defineProperty(response, 'data', {
        get() {
          if (mergedOpts.responseType === 'arraybuffer' || mergedOpts.responseType === 'buffer') {
            return res.body;
          }
          if (typeof res.body === 'string') {
            try { return JSON.parse(res.body); } catch { return res.body; }
          }
          return res.body;
        },
      });
      // Cookie 自动管理
      if (mergedOpts.jar && res.headers['set-cookie']) {
        mergedOpts.jar.merge(res.headers['set-cookie']);
      }
      return response;
    };
  }

  // 便捷方法：get/post/defaults
  session.get = async function (url, opts = {}) { return session.request('GET', url, opts); };
  session.post = async function (url, opts = {}) { return session.request('POST', url, opts); };
  session._defaults = {};
  session.defaults = function (opts = {}) {
    Object.assign(session._defaults, opts);
    return session;
  };

  session._clientName = name;
  session._impersonate = impersonate;
  return session;
}

// ============================================================
// Cookie Jar（与 Session 绑定；含 Set-Cookie 属性解析与过期清理）
// ============================================================
class CookieJar {
  constructor() { this.cookies = new Map(); }

  /**
   * 添加/覆盖单条 cookie。
   * @param {Object} [attrs] { path, expires } —— expires 为 ms 时间戳；已过期则直接删除
   */
  set(name, value, domain = '', attrs = {}) {
    const expires = typeof attrs.expires === 'number' ? attrs.expires : null;
    const key = `${domain}:${name}`;
    if (expires !== null && expires <= Date.now()) {
      this.cookies.delete(key);
      return;
    }
    this.cookies.set(key, { value, domain, path: attrs.path || '/', expires });
  }

  get(name, domain = '') {
    const entry = this.cookies.get(`${domain}:${name}`);
    if (!entry) return undefined;
    if (entry.expires !== null && entry.expires <= Date.now()) {
      this.cookies.delete(`${domain}:${name}`);
      return undefined;
    }
    return entry.value;
  }

  delete(name, domain = '') {
    this.cookies.delete(`${domain}:${name}`);
  }

  toString(domain = '') {
    const now = Date.now();
    const items = [];
    for (const [key, c] of this.cookies) {
      if (c.expires !== null && c.expires <= now) { this.cookies.delete(key); continue; }
      if (!domain || c.domain === domain || key.endsWith(`:${domain}`)) {
        items.push(`${key.split(':').pop()}=${c.value}`);
      }
    }
    return items.join('; ');
  }

  /**
   * 从 Set-Cookie 响应头批量合并。
   * 解析属性：Domain / Path / Max-Age / Expires（大小写不敏感）；
   * 删除语义：Max-Age<=0 或 Expires 已过期 → 移除同名 cookie（服务端下线 cookie 的标准方式）。
   */
  merge(setCookieHeader, domain = '') {
    if (!setCookieHeader) return;
    const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const item of list) {
      const parts = String(item).split(';');
      const pair = parts[0];
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;

      const attrs = { path: '/', expires: null };
      let cookieDomain = domain;
      let expired = false;
      for (const raw of parts.slice(1)) {
        const attrEq = raw.indexOf('=');
        const attrName = (attrEq < 0 ? raw : raw.slice(0, attrEq)).trim().toLowerCase();
        const attrValue = attrEq < 0 ? '' : raw.slice(attrEq + 1).trim();
        if (attrName === 'domain' && attrValue) {
          cookieDomain = attrValue.replace(/^\./, '').toLowerCase();
        } else if (attrName === 'path' && attrValue) {
          attrs.path = attrValue;
        } else if (attrName === 'max-age') {
          const seconds = parseInt(attrValue, 10);
          if (Number.isFinite(seconds)) {
            if (seconds <= 0) expired = true;
            else attrs.expires = Date.now() + seconds * 1000;
          }
        } else if (attrName === 'expires' && attrValue) {
          const ts = Date.parse(attrValue);
          if (Number.isFinite(ts)) {
            if (ts <= Date.now()) expired = true;
            else attrs.expires = ts;
          }
        }
        // Secure / HttpOnly / SameSite：纯协议请求层无需特殊处理，忽略
      }
      if (expired) { this.delete(name, cookieDomain); continue; }
      this.set(name, value, cookieDomain, attrs);
    }
  }
}

// ============================================================
// 使用示例（在 final.js 中引用）
// ============================================================
//
// const { createRequestSession, CookieJar } = require('./request/client');
//
// async function main() {
//   const session = await createRequestSession({
//     impersonate: 'chrome135',
//     userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...',
//   });
//   const jar = new CookieJar();
//   // Cookie 生命周期交给请求层：自动携带、自动合并 Set-Cookie（含 Domain/Max-Age/Expires 属性与删除语义）
//   session.defaults({ jar });
//
//   try {
//     // 1. 访问主页刷新 Cookie（无需手动拼 Cookie 头）
//     await session.request('GET', 'https://example.com/');
//
//     // 2. 调用前置接口（需要手动控制 Cookie 时仍可显式传 headers.Cookie 覆盖）
//     const init = await session.request('GET', 'https://example.com/api/init');
//     const { secretKey } = init.json();
//
//     // 3. 生成签名
//     const sign = generateSign({ ts: Date.now() }, secretKey);
//
//     // 4. 发送目标请求（常规三参 / 原始请求描述符两种形态等价）
//     const res = await session.request('GET', 'https://example.com/api/search', {
//       headers: { 'x-sign': sign },
//     });
//     const res2 = await session.request({            // 描述符形态：method/url/opts 与 adapter 契约一致，
//       method: 'GET',                                // 可直接透传 trace 导出的请求描述
//       url: 'https://example.com/api/search',
//       opts: { headers: { 'x-sign': sign } },
//     });
//     console.log(res.json());
//
//     // 5. POST 请求（JSON / 表单）
//     await session.post(url, { json: { key: 'val' } });      // Content-Type: application/json
//     await session.post(url, { data: { key: 'val' } });      // Content-Type: application/x-www-form-urlencoded
//     await session.post(url, { body: 'raw string' });        // 原始 body
//   } finally {
//     if (session.close) session.close();
//   }
// }

module.exports = { createRequestSession, CookieJar, detectAvailableClient };
