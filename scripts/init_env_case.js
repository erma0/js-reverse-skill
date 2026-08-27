#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { caseDir: '', target: '', entry: '', param: '', api: '', force: false, json: false, markdown: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;
    if (a === '--case-dir' || a === '--dir' || a === '-d') args.caseDir = nextVal('');
    else if (a === '--target') args.target = nextVal('');
    else if (a === '--entry') args.entry = nextVal('');
    else if (a === '--param') args.param = nextVal('');
    else if (a === '--api') args.api = nextVal('');
    else     if (a === '--force') args.force = true;
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
  node scripts/init_env_case.js --case-dir case --target app.js --entry window.makeSign --param sign --api https://example.com/api/search

说明：已有文件默认不覆盖；如需覆盖模板文件，请显式添加 --force。`;
}

function isDangerousDir(p) {
  const resolved = path.resolve(p);
  const root = path.parse(resolved).root;
  return resolved === root || resolved.length <= root.length + 2;
}

function ensureDir(p, actions) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
    actions.push({ action: 'create-dir', path: p });
  } else {
    actions.push({ action: 'keep-dir', path: p });
  }
}

function writeFileIfNeeded(p, content, force, actions) {
  if (fs.existsSync(p) && !force) {
    actions.push({ action: 'keep-file', path: p });
    return;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const existed = fs.existsSync(p);
  fs.writeFileSync(p, content, 'utf8');
  actions.push({ action: existed ? 'write-file' : 'create-file', path: p });
}

function initCase(args) {
  if (!args.caseDir) throw new Error('必须提供 --case-dir');
  const caseDir = path.resolve(args.caseDir);
  if (isDangerousDir(caseDir)) throw new Error(`拒绝在危险目录中初始化：${caseDir}`);
  const actions = [];
  const caseSubDir = path.join(caseDir, 'case');
  const dirs = ['js/original', 'js/pretty', 'js/extracted', 'requests', 'fixtures', 'notes', 'hooks', 'env', 'ruyi-trace/logs', 'browser/ruyipage', 'tmp', '阶段报告', 'forensic'];
  ensureDir(caseDir, actions);
  ensureDir(path.join(caseDir, 'result'), actions);
  for (const d of dirs) ensureDir(path.join(caseSubDir, d), actions);

  const fixture = {
    name: 'sample-001',
    pageUrl: '',
    apiUrl: args.api || '',
    method: '',
    param: args.param || '',
    paramLocation: '',
    browser: {
      userAgent: '',
      language: 'zh-CN',
      timezone: 'Asia/Shanghai',
      screen: { width: 1920, height: 1080 },
    },
    request: { query: {}, headers: {}, body: {}, cookies: {}, localStorage: {}, sessionStorage: {} },
    runtime: { now: null, performanceNow: null, randomBytes: [] },
    fingerprint: {
      source: { mode: '', pageUrl: '', userAgent: '', timezone: '', locale: '', capturedAt: '' },
      canvas: { toDataURL: [], toBlob: [], measureText: [], getImageData: [] },
      webgl: { getParameter: [], getSupportedExtensions: null, getExtension: [], getShaderPrecisionFormat: [], readPixels: [] },
      webgpu: { requestAdapter: [] },
      audio: { startRendering: [], getChannelData: [] },
      domGeometry: { getBoundingClientRect: [], getClientRects: [], offset: [] },
    },
    entry: args.entry || '',
    args: [],
    expected: args.param ? { [args.param]: '' } : {},
  };

  writeFileIfNeeded(path.join(caseSubDir, 'fixtures', 'sample.fixture.json'), JSON.stringify(fixture, null, 2) + '\n', args.force, actions);

  const fingerprintFixture = {
    version: 1,
    source: { mode: '', pageUrl: '', userAgent: '', timezone: '', locale: '', capturedAt: '' },
    canvas: { toDataURL: [], toBlob: [], measureText: [], getImageData: [] },
    webgl: { getParameter: [], getSupportedExtensions: null, getExtension: [], getShaderPrecisionFormat: [], readPixels: [] },
    webgpu: { requestAdapter: [] },
    audio: { startRendering: [], getChannelData: [] },
    domGeometry: { getBoundingClientRect: [], getClientRects: [], offset: [] },
  };
  writeFileIfNeeded(path.join(caseSubDir, 'fixtures', 'fingerprint.fixture.json'), JSON.stringify(fingerprintFixture, null, 2) + '\n', args.force, actions);

  const notes = `# Node.js 补环境任务笔记

## 基本信息

- 目标 API：${args.api || ''}
- 目标 JS：${args.target || ''}
- 入口函数：${args.entry || ''}
- 目标参数：${args.param || ''}

## 前置材料检查

- [ ] 请求样本已确认
- [ ] 已列出请求样本中的全部可疑加密参数
- [ ] 已按证据定位本次要分析的加密参数（候选列出后不等待用户确认）
- [ ] 加密参数已在请求中确认
- [ ] 已输出 source / entry / builder / writer 四层链路
- [ ] 目标 JS 文件已保存
- [ ] 加密入口已定位
- [ ] 取证来源已由 EVIDENCE_GATE 判定（ruyipage 网络取证 / RuyiTrace 日志采集 / 用户手动材料）
- [ ] 取证需要 RuyiTrace 时 NDJSON 已自动采集导入，或按交互场景转手动导入
- [ ] Node 泄露阻断已检查
- [ ] 补环境初始化阶段已启用 NativeProtect 保护，并记录保护方式或豁免原因
- [ ] 默认启用 toString / 属性描述符 / 原型链 / 访问器 / 实例对象保护；如用户明确要求关闭，已记录原因
- [ ] 已读取 code-style.md，并先规划 result 目录、文件职责和调用关系
- [ ] 补环境代码默认要求简洁、模块化、具名函数清晰，并写入中文注释
- [ ] 中文注释使用 UTF-8 正常显示，没有问号、连续问号或乱码
- [ ] 已创建 / 读取 notes/代码变更记忆.md；修改关键源码前已搜索历史记录，修改后已记录失败尝试、禁止回退、验证范围和遗留风险
- [ ] 六项纯计算预检已执行或明确不需要
- [ ] 如目标访问 Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何指纹，已采集真实浏览器终端 API 返回值并写入 fixtures/fingerprint.fixture.json
- [ ] 用户已确认进入补环境阶段

## 缺失环境追踪

- trace 文件：tmp/env-trace.jsonl
- 缺失环境摘要：tmp/missing-env.json
- trace 分析：notes/missing-env-priority.md

## 可疑加密参数确认

| 参数名 | 位置 | 样本值摘要 | 疑似原因 | 用户是否确认分析 |
|---|---|---|---|---|

> cURL / HAR 中已有的加密参数值只能作为 fixture expected，最终产物必须通过补环境重新生成，不能直接复用。

## 补齐记录

| 轮次 | 缺失环境 | 处理方式 | 验证结果 |
|---|---|---|---|

## 通用代码变更记忆

- 记录文件：notes/代码变更记忆.md
- [ ] 修改关键源码前已读取该文件
- [ ] 修改关键源码后已追加本轮变更记录
- [ ] 已记录修改前逻辑、问题证据、本次修改、修改理由、已失败尝试、禁止回退、验证命令、验证结果、当前验证范围、遗留风险和当前状态
- [ ] 已运行 scripts/check_change_memory.js --case-dir case --markdown

## 代码质量

- [ ] 已运行 scripts/check_code_quality.js --case-dir case --markdown
- [ ] 已修复超长行、超长函数、压缩堆叠代码和过深嵌套
- [ ] 已确认每个手写源码文件顶部都有中文职责注释
- [ ] 已确认关键 WebAPI、getter / setter、NativeProtect 保护、fallback、指纹回放和加密入口有中文说明
- [ ] 已确认中文注释没有问号、连续问号或乱码

## 指纹值回放

- [ ] 已确认哪些指纹终端 API 被目标 JS 访问
- [ ] 已使用真实浏览器采样值回放，而不是在 Node.js 中真实模拟渲染
- [ ] 未把浏览器自动化代码放入最终 result 目录
- [ ] 缺失指纹样本时已阻塞并提示补采样，没有静默伪造默认值

## 最终请求验证

- [ ] fixtures 已通过
- [ ] 用户已确认是否发起真实请求
- [ ] 如普通客户端疑似 TLS 指纹不一致，已确认是否使用 CycleTLS / curl_cffi / cffi_curl / cyCronet
- [ ] 请求次数、状态码、响应关键字段已记录
- [ ] 临时响应和敏感请求副本已清理

## 最终总结

- [ ] 已从前置阶段开始生成 case/阶段报告/01-需求信息确认.md 等中文命名阶段报告
- [ ] 项目完成后已默认生成 result/最终项目总结.md
- [ ] 最终总结使用 UTF-8 写入，中文正常显示
- [ ] 总结包含 NativeProtect 使用情况、加密参数生成与样本复用检查、最终交付结构、测试结果和清理结果
- [ ] 如用户明确要求不生成最终总结，已记录原因

## 清理检查

- [ ] 已删除临时 trace / 日志
- [ ] 已删除失败 runner
- [ ] 已保留必要 fixtures 和 notes
`;
  writeFileIfNeeded(path.join(caseSubDir, 'notes', 'env-task.md'), notes, args.force, actions);

  const codeChangeMemory = `# 代码变更记忆

本文件由通用代码变更记忆机制维护，用于记录复杂 case 中关键源码修改的事实、原因、失败尝试、禁止回退、验证范围和遗留风险。不要把“当前报错消失”直接写成永久结论。

## 使用规则

- 修改关键源码前先读取本文件，并搜索文件名、函数名、错误关键词和参数名。
- 修改关键源码后立即追加一条“变更”记录。
- 不删除失败记录；如历史记录被新证据替代，新增记录说明替代原因。
- 状态只能使用：临时修复 / 当前验证通过 / 已失败 / 被替代 / 稳定基线。

## 变更 001 - 待填写

- 时间：YYYY-MM-DD HH:mm
- 涉及文件：
- 涉及函数 / 模块：
- 当前状态：临时修复

### 修改前逻辑

待填写。

### 问题证据

待填写。

### 本次修改

待填写。

### 修改理由

待填写。

### 已失败尝试

待填写。

### 禁止回退

待填写。

### 验证命令

\`\`\`bash
# 待填写
\`\`\`

### 验证结果

待填写。

### 当前验证范围

待填写。

### 遗留风险

待填写。
`;
  writeFileIfNeeded(path.join(caseSubDir, 'notes', '代码变更记忆.md'), codeChangeMemory, args.force, actions);

  const entryChain = `# 加密入口链路记录

## writer 最终写入

- 类型：fetch / XHR / URLSearchParams / Header / Cookie / Body
- 文件与行列号：
- 调用栈：
- 写入前对象快照：
- 写入后对象快照：

## builder 请求构造

- 函数 / 方法：
- 所在模块：
- 输入：
- 输出：
- 是否经过拦截器：

## entry 加密入口

- 函数名 / 表达式：${args.entry || ''}
- 文件 / chunk / module id：${args.target || ''}
- 行列号：
- 入参：
- 返回：
- 是否需要初始化：

## source 数据源

- URL / Query：
- Body：
- Cookie：
- localStorage / sessionStorage：
- 时间 / 随机数：
- navigator / screen / document / canvas / WebGL：
- Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何指纹 fixture：
- 其他：

## 可信度

- 证据来源：
- 是否可进入补环境：否
- 阻塞点：
`;
  writeFileIfNeeded(path.join(caseSubDir, 'notes', 'entry-chain.md'), entryChain, args.force, actions);

  const silentChecklist = `# 静默失败排查清单

当目标 JS 不报错但 ${args.param || '目标参数'} 不一致时逐项检查。

- [ ] 请求 URL、Query、Body、Header 与浏览器样本一致
- [ ] SDK 初始化参数、版本、appId、页面配置一致
- [ ] Cookie、localStorage、sessionStorage 已按 fixture 注入
- [ ] Date.now / new Date / performance.now 可复现
- [ ] Math.random / crypto.getRandomValues 可复现
- [ ] Canvas / WebGL / WebGPU / Audio / 字体 / DOM 几何等指纹终端 API 返回值来自真实浏览器采样并可回放
- [ ] navigator / screen / timezone / language 与浏览器样本一致
- [ ] JS 加载顺序、runtime chunk、动态 chunk 完整
- [ ] Function.prototype.toString / Object.prototype.toString 已处理
- [ ] 属性描述符与原型链已记录
- [ ] document.all 等特殊对象已处理或确认未触发
- [ ] Worker / WASM / postMessage 已排查
`;
  writeFileIfNeeded(path.join(caseSubDir, 'notes', 'silent-failure-checklist.md'), silentChecklist, args.force, actions);

  const trustMatrix = `# 证据可信度矩阵

| 项目 | 当前值 / 结论 | 来源 | 等级 A/B/C/D | 待验证 |
|---|---|---|---|---|
| 目标 API | ${args.api || ''} | 用户输入 | B |  |
| 目标参数 | ${args.param || ''} | 用户输入 | B |  |
| 加密入口 | ${args.entry || ''} | 用户输入 / 待验证 | C |  |
| JS 文件 | ${args.target || ''} | 用户输入 / 待验证 | C |  |
| Cookie / token | 仅记录键名和脱敏摘要 | fixture | A/B |  |
`;
  writeFileIfNeeded(path.join(caseSubDir, 'notes', 'trust-matrix.md'), trustMatrix, args.force, actions);
  return { caseDir, actions };
}

function render(result) {
  const label = { 'create-dir': '创建目录', 'keep-dir': '保留目录', 'create-file': '创建文件', 'write-file': '写入文件', 'keep-file': '保留已有文件' };
  const lines = ['# 补环境 case 初始化结果', '', `- case 目录：${result.caseDir}`];
  for (const a of result.actions) lines.push(`- ${label[a.action] || a.action}：${a.path}`);
  return lines.join('\n') + '\n';
}

try {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(usage()); process.exit(0); }
  const result = initCase(args);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  if (args.markdown) process.stdout.write(render(result));
} catch (err) {
  console.error(err.message || String(err));
  console.error(usage());
  process.exit(1);
}
