#!/usr/bin/env node
'use strict';

// 查询历史记录与打转检测（SKILL.md §4.4 防耗尽检查点的脚本化落地）
// 动机：match14 实测 AI 对同一 (文件, 关键词) 重复检索 20 次、同一疑问重新推导横跨
// 1000+ 行日志——"同一决策重新权衡 ≥2 次"的规则依赖跨轮记忆，物理上不可执行。
// 本模块把重复计数固化为脚本输出：同一 (tool, target, query) 第 2 次出现输出 WARN，
// 第 3 次起输出"打转实证"强提示。日志落在 <case>/tmp/query-log.jsonl，只增不删。
// 记录失败一律降级静默（不阻断检索本身）。

const fs = require('fs');
const path = require('path');

// 从目标文件路径向上（最多 8 层）找名为 case 的目录，返回 <case>/tmp/query-log.jsonl；
// 找不到（任意位置运行、非 case 内文件）返回 ''，调用方跳过记录。
function inferQueryLogPath(targetPath) {
  let cur = path.resolve(path.dirname(targetPath));
  for (let i = 0; i < 8; i++) {
    if (path.basename(cur).toLowerCase() === 'case') {
      return path.join(cur, 'tmp', 'query-log.jsonl');
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return '';
}

function readLog(logPath) {
  try {
    const text = fs.readFileSync(logPath, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

const normalizeTarget = (s) => String(s).replace(/\\/g, '/').toLowerCase();

function warningMessage(tool, target, query, seq) {
  const short = (p) => String(p).replace(/\\/g, '/').split('/').slice(-2).join('/');
  if (seq === 2) {
    return `[WARN] 重复检索第 2 次：${tool} 在 ${short(target)} 查 "${query}"。触发防耗尽检查点（SKILL.md §4.4）：先核对已有结论是否已回答此问题；无法回答才继续，并考虑换检索词或换方法。`;
  }
  return `[WARN] 重复检索第 ${seq} 次：${tool} 在 ${short(target)} 查 "${query}"。同一查询 ≥3 次 = 打转实证（match14 教训），必须停止当前路线：落盘阶段报告（已证实事实/缺失证据/下一步输入）后换方法。`;
}

// 记录一次工具调用包含的所有 (target, query) 组合并返回 WARN 列表。
// entries: [{ target: <文件/trace路径>, query: <关键词/正则> }]
function recordQueries(tool, entries) {
  const warnings = [];
  const byLog = new Map();
  for (const { target, query } of entries) {
    if (!target || !query) continue;
    const logPath = inferQueryLogPath(target);
    if (!logPath) continue;
    if (!byLog.has(logPath)) byLog.set(logPath, { log: readLog(logPath), pending: [] });
    const slot = byLog.get(logPath);
    const same = (e) => e.tool === tool && normalizeTarget(e.target) === normalizeTarget(target) && String(e.query) === String(query);
    const prevCount = slot.log.filter(same).length + slot.pending.filter(same).length;
    slot.pending.push({ at: new Date().toISOString(), tool, target, query, seq: prevCount + 1 });
    if (prevCount + 1 >= 2) warnings.push(warningMessage(tool, target, query, prevCount + 1));
  }
  for (const [logPath, slot] of byLog) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, `${slot.pending.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
    } catch { /* 记录失败不阻断检索 */ }
  }
  return warnings;
}

module.exports = { inferQueryLogPath, recordQueries };
