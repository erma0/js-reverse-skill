'use strict';

// 这些裸 API 在普通页面中出现频率极高，只能证明页面运行过，不能证明目标
// 参数已进入请求 writer。若确实需要使用，必须提供更具体的接口/成员/参数组合。
const GENERIC_SIGNAL_RE = /^(?:window|document|createElement|appendChild|insertBefore|querySelector|querySelectorAll|addEventListener|dispatchEvent|setTimeout|setInterval|JSON\.stringify|Date\.now|Math\.random)$/i;

const MIN_SIGNAL_LENGTH = 3;

function validateTraceSignals(signals) {
  const issues = [];
  for (const raw of signals || []) {
    const signal = String(raw || '').trim();
    if (!signal) continue;
    if (signal.length < MIN_SIGNAL_LENGTH) {
      issues.push({ signal, reason: `信号过短（${signal.length} 字符，最少 ${MIN_SIGNAL_LENGTH} 字符），极易在无关字段中命中；请使用参数写入点、限定 API 或调用栈关键词` });
      continue;
    }
    if (GENERIC_SIGNAL_RE.test(signal)) {
      issues.push({ signal, reason: '裸泛化 DOM/运行时 API 不能证明目标 writer；请改用 HTMLScriptElement.src、Headers.set(<参数>)、目标参数名+API 等限定信号' });
    }
  }
  return issues;
}

// RuyiTrace 记录 XHR/fetch 等调用为 {"type":"call","interface":"XMLHttpRequest","member":"open",...}，
// interface 与 member 是分存字段：信号 "XMLHttpRequest.open" 作为整行 JSON 子串永不命中
// （match12 实测 XMLHttpRequest.open ×0，改 XMLHttpRequest 才命中）。本函数除子串匹配外，
// 同时支持 Interface.member 形态的结构化匹配。
function matchesTraceSignal(record, signal) {
  const needle = String(signal || '').trim().toLowerCase();
  if (!needle) return false;
  const dot = needle.indexOf('.');
  if (dot > 0 && dot < needle.length - 1 && record && typeof record === 'object') {
    const iface = needle.slice(0, dot);
    const member = needle.slice(dot + 1);
    if (String(record.interface || '').toLowerCase() === iface
      && String(record.member || '').toLowerCase() === member) {
      return true;
    }
  }
  try {
    return JSON.stringify(record).toLowerCase().includes(needle);
  } catch {
    return false;
  }
}

// 流式扫描（无法逐行 JSON.parse）用的 needle 组：任一组内全部 needle 出现即该信号命中。
// Interface.member 信号除原子串组外，增加 interface/member 分存字段组（RuyiTrace 序列化无空格）。
function traceSignalNeedleGroups(signal) {
  const s = String(signal || '').trim().toLowerCase();
  if (!s) return [];
  const groups = [[s]];
  const dot = s.indexOf('.');
  if (dot > 0 && dot < s.length - 1) {
    groups.push([`"interface":"${s.slice(0, dot)}"`, `"member":"${s.slice(dot + 1)}"`]);
  }
  return groups;
}

function assertTraceSignals(signals, label = 'trace/evidence signal') {
  const issues = validateTraceSignals(signals);
  if (!issues.length) return;
  const detail = issues.map((item) => `${JSON.stringify(item.signal)}：${item.reason}`).join('；');
  throw new Error(`${label} 不合格：${detail}`);
}

module.exports = { validateTraceSignals, assertTraceSignals, matchesTraceSignal, traceSignalNeedleGroups, MIN_SIGNAL_LENGTH };
