'use strict';

// 这些裸 API 在普通页面中出现频率极高，只能证明页面运行过，不能证明目标
// 参数已进入请求 writer。若确实需要使用，必须提供更具体的接口/成员/参数组合。
const GENERIC_SIGNAL_RE = /^(?:window|document|createElement|appendChild|insertBefore|querySelector|querySelectorAll|addEventListener|dispatchEvent|setTimeout|setInterval|JSON\.stringify|Date\.now|Math\.random)$/i;

function validateTraceSignals(signals) {
  const issues = [];
  for (const raw of signals || []) {
    const signal = String(raw || '').trim();
    if (!signal) continue;
    if (signal.length < 3) {
      issues.push({ signal, reason: '信号过短，极易在无关字段中命中；请使用参数写入点、限定 API 或调用栈关键词' });
      continue;
    }
    if (GENERIC_SIGNAL_RE.test(signal)) {
      issues.push({ signal, reason: '裸泛化 DOM/运行时 API 不能证明目标 writer；请改用 HTMLScriptElement.src、Headers.set(<参数>)、目标参数名+API 等限定信号' });
    }
  }
  return issues;
}

function assertTraceSignals(signals, label = 'trace/evidence signal') {
  const issues = validateTraceSignals(signals);
  if (!issues.length) return;
  const detail = issues.map((item) => `${JSON.stringify(item.signal)}：${item.reason}`).join('；');
  throw new Error(`${label} 不合格：${detail}`);
}

module.exports = { validateTraceSignals, assertTraceSignals };
