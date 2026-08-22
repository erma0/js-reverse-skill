#!/usr/bin/env node
'use strict';

// 密文/哈希特征 → 算法族识别（T1 识别信号入口）。
// 把 references/crypto/algorithm-families.md 中的 T1 长度/字符集/结构特征脚本化，
// 供 IDENTIFY 阶段在"读源码猜算法"之前先做证据驱动的特征分析。
// 注意：识别≠协议复现。输出只是假设排序，最终实现仍须由 trace 定位的 builder/writer 证明。

const fs = require('fs');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = { value: '', file: '', label: '', json: false, markdown: false, help: false, selfTest: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--value') args.value = nextVal('');
    else if (a === '--file') args.file = nextVal('');
    else if (a === '--label' || a === '--param') args.label = nextVal('');
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
  node scripts/identify_crypto.js --value <密文/哈希样本> --markdown
  node scripts/identify_crypto.js --value <样本> --label <参数名> --markdown
  node scripts/identify_crypto.js --file <样本文件路径> --markdown
  node scripts/identify_crypto.js --self-test

说明：
- 按长度、字符集、结构与 base64 解码后 magic bytes 输出算法族假设排序（md5/sha 族/SM3/AES/DES/JWT/UUID/WASM/随机 token 等）。
- 识别信号属于 T1 级知识：只给出「可能是什么、下一步查哪里」，不构成协议复现依据。
- 与 references/crypto/algorithm-families.md（T1 识别指纹）配合使用；实现仍需 trace 定位 builder/writer。`;
}

function shannonEntropy(text) {
  if (!text) return 0;
  const freq = new Map();
  for (const ch of text) freq.set(ch, (freq.get(ch) || 0) + 1);
  let e = 0;
  for (const count of freq.values()) {
    const p = count / text.length;
    e -= p * Math.log2(p);
  }
  return e;
}

function charsetClass(text) {
  if (/^[0-9]+$/.test(text)) return '纯数字';
  if (/^[0-9a-fA-F]+$/.test(text)) return 'hex';
  if (/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(text)) return 'base64(标准)';
  if (/^[A-Za-z0-9_-]+$/.test(text)) return 'base64url/base62';
  if (/^[A-Za-z0-9]+$/.test(text)) return '字母数字(base62)';
  if (/^[A-Za-z0-9_.=+-]+$/.test(text)) return '字母数字+分隔符';
  return '混合字符';
}

function tryBase64Decode(text) {
  const clean = String(text || '').replace(/\s+/g, '');
  // base64 与 base64url 都尝试；长度须为 4 的倍数（补 padding）
  const padded = clean.replace(/-/g, '+').replace(/_/g, '/');
  const withPad = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(withPad) || withPad.length < 4 || withPad.length % 4 !== 0) return null;
  try {
    const buf = Buffer.from(withPad, 'base64');
    // 编码往返一致才认为是合法 base64（排除普通 hex/字母数字误判）
    const re = buf.toString('base64').replace(/=+$/, '');
    if (re.replace(/\+/g, '-').replace(/\//g, '_') !== clean.replace(/\+/g, '-').replace(/\//g, '_')) return null;
    return buf;
  } catch { return null; }
}

function magicBytes(buf) {
  if (!buf || buf.length < 4) return [];
  const magics = [
    { hex: '0061736d', name: 'WASM（\\0asm）' },
    { hex: '504b0304', name: 'ZIP（PK\\x03\\x04）' },
    { hex: '1f8b', name: 'gzip（\\x1f\\x8b）' },
    { hex: '377abcaf271c', name: '7z' },
    { hex: '526172211a0700', name: 'RAR' },
    { hex: '53514c69746520666f726d617420330000', name: 'SQLite' },
    { hex: 'ffd8ff', name: 'JPEG' },
    { hex: '89504e47', name: 'PNG' },
  ];
  const hex = buf.subarray(0, 16).toString('hex');
  return magics.filter((m) => hex.startsWith(m.hex)).map((m) => m.name);
}

// hex 长度 → 哈希族候选（T1；同长度多族并列，不下最终结论）
function hashCandidatesByByteLength(bytes) {
  switch (bytes) {
    case 16: return ['MD5', 'NTLM', 'AES-128 密钥/块材料', 'SM4 块材料'];
    case 20: return ['SHA-1', 'RIPEMD-160'];
    case 24: return ['3DES 密钥材料'];
    case 28: return ['SHA-224', 'SHA3-224'];
    case 32: return ['SHA-256', 'SHA3-256', 'SM3', 'BLAKE2s-256', 'AES-256 密钥材料'];
    case 48: return ['SHA-384', 'SHA3-384'];
    case 64: return ['SHA-512', 'SHA3-512', 'BLAKE2b-512'];
    default: return [];
  }
}

function analyze(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error('样本为空：用 --value 或 --file 提供密文/哈希样本');
  const features = {
    label: label || '',
    length: text.length,
    charset: charsetClass(text),
    entropy: Number(shannonEntropy(text).toFixed(2)),
    segments: text.split('.').length > 1 ? text.split('.').map((s) => s.length) : null,
    looksJson: false,
    looksUrlEncoded: /(?:^|&)[A-Za-z0-9_.-]+=[^&\s]+/.test(text) && /[=&]/.test(text),
    base64DecodedBytes: null,
    magic: [],
  };
  try { JSON.parse(text); features.looksJson = true; } catch { /* not json */ }

  const hypotheses = [];
  const push = (family, basis, confidence, next) => hypotheses.push({ family, basis, confidence, next });

  // 结构信号优先：JWT / UUID / JSON / URL 编码 / 分段点号
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(text)) {
    push('JWT（header.payload.signature）', `三段点号分隔，段长 ${features.segments.join('/')}，字符集 base64url`, '高',
      '解 header（第 1 段 base64url）确认 alg；签名段按 alg 缩小范围（HS256→HMAC-SHA256 对称密钥；RS/ES→非对称）。密钥/入参仍需 trace 定位。');
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    push('UUID v4（crypto.randomUUID 形态）', '8-4-4-4-12 hex 分段 + 版本/变体位', '高', '通常来自 crypto.randomUUID()；确认其是否参与签名输入或仅作 nonce。');
  }
  if (features.looksJson) push('明文 JSON / 序列化结构', '可被 JSON.parse 解析', '高', '按字段拆分：加密字段、时间字段、随机字段分别再过本脚本。');
  if (features.looksUrlEncoded) push('URL/表单编码的参数串', '含 key=value& 结构', '高', '按 & 与 = 拆出各参数后逐个分析，不要把整串当密文。');

  // hex 哈希族
  if (features.charset === 'hex' && text.length % 2 === 0) {
    const bytes = text.length / 2;
    for (const family of hashCandidatesByByteLength(bytes)) {
      push(family, `${bytes} 字节（${text.length} hex 字符）`, '中',
        '长度只是族级指纹：同长度族（如 SHA-256 与 SM3）需到 references/crypto/algorithm-families.md 对照 T1 信号，并用 trace 定位实际 builder 后确认。');
    }
    if (!hashCandidatesByByteLength(bytes).length) {
      push('定长二进制摘要/密文（非标准哈希长度）', `${bytes} 字节 hex，不符合常见哈希输出长度`, '低', '可能是自定义截断、异或/变换输出或 JSVMP 产物；走 trace 定位 writer。');
    }
  }

  // 纯数字
  if (features.charset === '纯数字') {
    push('计数器 / 时间戳 / 数值种子', '纯数字', '中', '与多组样本对比：递增→计数器；≈1e12→毫秒时间戳；随机分布→随机数种子。见 SKILL.md 第 7 节字段六分类。');
  }

  // base64 家族 + magic bytes
  const decoded = tryBase64Decode(text);
  if (decoded && decoded.length >= 4 && features.charset !== 'hex') {
    features.base64DecodedBytes = decoded.length;
    features.magic = magicBytes(decoded);
    for (const name of features.magic) {
      push(`二进制容器：${name}`, 'base64 解码后命中文件 magic bytes', '高',
        name.includes('WASM') ? 'WASM 加密路径：按 SKILL.md 第 9 节路径 C 整包黑盒执行，禁止先手撕字节码。'
          : '按对应容器格式解析内部结构后再分析载荷。');
    }
    const byteLen = decoded.length;
    for (const family of hashCandidatesByByteLength(byteLen)) {
      push(`${family}（base64 包装）`, `base64 解码后 ${byteLen} 字节`, '中', '同 hex 哈希族处理：族级指纹，需 trace 确认。');
    }
    if (/^[0-9a-f]+$/i.test(decoded.toString('latin1')) && byteLen % 2 === 0) {
      push('hex 摘要的 base64 包装', '解码后内容仍是 hex 字符', '中', '再对内层 hex 串跑一次本脚本。');
    }
  }

  // 高熵长随机串
  if (!hypotheses.length && text.length >= 24 && features.entropy >= 3.5) {
    push('加密结果或随机 token（无固定长度特征）', `长度 ${text.length}，熵 ${features.entropy}，字符集 ${features.charset}`, '低',
      '特征不足以定位算法族：按 SKILL.md 规则先 trace 定位 source→entry→builder→writer，再从 builder 内层看是否还有中间值可拆。');
  }
  if (!hypotheses.length) {
    push('未识别出显著特征', `长度 ${text.length}，字符集 ${features.charset}`, '低', '对照 references/crypto/algorithm-families.md 的 T1 表人工复核；仍无命中则走 trace。');
  }

  hypotheses.sort((a, b) => ({ 高: 0, 中: 1, 低: 2 }[a.confidence] - { 高: 0, 中: 1, 低: 2 }[b.confidence]));
  return { features, hypotheses };
}

function renderMarkdown(result) {
  const f = result.features;
  const lines = ['# 密文特征识别（T1 假设）', ''];
  if (f.label) lines.push(`- 参数名：${f.label}`);
  lines.push(`- 长度：${f.length} 字符`);
  lines.push(`- 字符集：${f.charset}`);
  lines.push(`- 香农熵：${f.entropy} bit/字符`);
  if (f.segments) lines.push(`- 点号分段：${f.segments.join(' / ')}`);
  if (f.base64DecodedBytes != null) lines.push(`- base64 解码长度：${f.base64DecodedBytes} 字节`);
  if (f.magic.length) lines.push(`- magic bytes：${f.magic.join('、')}`);
  lines.push('', '## 算法族假设（按置信度排序）', '');
  lines.push('| # | 算法族/结构 | 依据 | 置信度 | 下一步 |');
  lines.push('|---|---|---|---|---|');
  result.hypotheses.forEach((h, i) => {
    lines.push(`| ${i + 1} | ${h.family} | ${h.basis} | ${h.confidence} | ${h.next} |`);
  });
  lines.push('', '## 使用边界',
    '- 本输出是 T1 识别假设，识别≠协议复现：不得据此跳过 trace 直接写实现。',
    '- 同长度算法族（SHA-256/SM3/BLAKE2s、MD5/NTLM 等）无法仅凭密文区分，最终以 trace 定位的 builder/writer 为准。',
    '- 更多 T1 识别指纹见 `references/crypto/algorithm-families.md`；加密入口定位见 `references/crypto/crypto-entry.md`。');
  return lines.join('\n') + '\n';
}

function runSelfTest() {
  const cases = [
    { value: crypto.createHash('md5').update('a').digest('hex'), expect: 'MD5' },
    { value: crypto.createHash('sha1').update('a').digest('hex'), expect: 'SHA-1' },
    { value: crypto.createHash('sha256').update('a').digest('hex'), expect: 'SHA-256' },
    { value: crypto.createHash('sha512').update('a').digest('hex'), expect: 'SHA-512' },
  ];
  for (const c of cases) {
    const r = analyze(c.value, '');
    if (!r.hypotheses.some((h) => h.family.includes(c.expect))) {
      throw new Error(`自测失败：${c.value.slice(0, 12)}... 应含 ${c.expect}，实际：${r.hypotheses.map((h) => h.family).join('、')}`);
    }
  }
  const wasmB64 = Buffer.concat([Buffer.from([0x00, 0x61, 0x73, 0x6d]), Buffer.alloc(8, 1)]).toString('base64');
  const rw = analyze(wasmB64, '');
  if (!rw.hypotheses.some((h) => h.family.includes('WASM'))) throw new Error('自测失败：WASM magic 未识别');
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"a":1}').toString('base64url')}.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c`;
  const rj = analyze(jwt, '');
  if (!rj.hypotheses.some((h) => h.family.startsWith('JWT'))) throw new Error('自测失败：JWT 结构未识别');
  const rn = analyze('1234567890123', '');
  if (!rn.hypotheses.some((h) => /计数器|时间戳/.test(h.family))) throw new Error('自测失败：纯数字样本未给出计数器/时间戳假设');
  if (analyze(crypto.createHash('md5').update('a').digest('hex'), '').hypotheses.some((h) => /计数器/.test(h.family))) {
    throw new Error('自测失败：hex 摘要被误判为纯数字');
  }
  return { clean: true, tests: 6 };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv);
    if (args.help) { console.log(usage()); process.exit(0); }
    if (args.selfTest) {
      const r = runSelfTest();
      console.log(`identify_crypto.js 自测通过：${r.tests} 项断言`);
      process.exit(0);
    }
    let value = args.value;
    if (!value && args.file) value = fs.readFileSync(args.file, 'utf8').trim();
    const result = analyze(value, args.label);
    if (args.json) console.log(JSON.stringify(result, null, 2));
    if (args.markdown) process.stdout.write(renderMarkdown(result));
    process.exit(0);
  } catch (err) {
    console.error(err.stack || err.message || String(err));
    console.error(usage());
    process.exit(1);
  }
}

module.exports = { analyze, charsetClass, tryBase64Decode, magicBytes, runSelfTest };
