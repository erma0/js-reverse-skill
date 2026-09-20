#!/usr/bin/env node

'use strict';



const fs = require('fs');

const path = require('path');



function parseArgs(argv) {

  const args = { input: '', out: '', projectDir: '', stdout: false, append: false, requireChineseName: false, json: false, markdown: false };

  for (let i = 2; i < argv.length; i++) {
    const nextVal = (fb) => (i + 1 < argv.length && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('-')) ? argv[++i] : fb;

    const a = argv[i];

    if (a === '--input' || a === '-i') args.input = nextVal('');

    else if (a === '--out' || a === '-o') args.out = nextVal('');

    else if (a === '--project-dir') args.projectDir = nextVal('');

    else if (a === '--stdout') args.stdout = true;

    else if (a === '--append') args.append = true;

    else if (a === '--require-chinese-name') args.requireChineseName = true;

    else if (a === '--json') args.json = true;

    else if (a === '--markdown') args.markdown = true;

    else if (a === '--help' || a === '-h') args.help = true;

    else throw new Error(`未知参数：${a}`);

  }

  return args;

}



function usage() {

  return `用法：

  node scripts/write_markdown_utf8.js --input 草稿.md --out 最终项目总结.md --require-chinese-name --markdown

  node scripts/write_markdown_utf8.js --out 阶段报告.md --require-chinese-name --markdown < 草稿.md



说明：使用 UTF-8 写入 Markdown，避免 Windows PowerShell / cmd 默认编码导致中文变成问号。使用 --require-chinese-name 可强制输出 Markdown 文件名包含中文。`;

}



function readAllStdin() {

  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }

}



function ensureParent(file) {

  const dir = path.dirname(path.resolve(file));

  fs.mkdirSync(dir, { recursive: true });

}



function hasChinese(text) {

  return /[\u4e00-\u9fff]/.test(String(text || ''));

}

function isInside(child, parent) {
  const norm = (p) => process.platform === 'win32' ? p.toLowerCase() : p;
  const c = norm(path.resolve(child));
  const p = norm(path.resolve(parent));
  if (c === p) return true;
  return c.startsWith(p + path.sep);
}

function findRepoRoot(start) {
  let dir = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, 'SKILL.md')) || fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}



function hasReplacementQuestionMarks(text) {

  const replacementRunPattern = new RegExp('\\?{3,}', 'g');

  const runs = text.match(replacementRunPattern) || [];

  const questionCharCount = runs.reduce((n, item) => n + item.length, 0);

  const hasCJK = /[\u4e00-\u9fff]/.test(text);

  return questionCharCount >= 8 && !hasCJK;

}



function main() {

  const args = parseArgs(process.argv);

  if (args.help || (!args.out && !args.stdout)) {

    console.log(usage());

    process.exit(args.help ? 0 : 1);

  }

  const input = (args.input ? fs.readFileSync(args.input, 'utf8') : readAllStdin()).replace(/^\uFEFF/, '');

  if (!input) throw new Error('缺少要写入的 Markdown 内容');

  if (hasReplacementQuestionMarks(input)) {

    throw new Error('输入内容疑似已经发生中文编码损坏：检测到大量问号且没有中文字符；请从原始结论重新生成后再写入。');

  }

  if (args.stdout) process.stdout.write(input, 'utf8');

  if (args.out) {

    if (args.requireChineseName && !hasChinese(path.basename(args.out))) throw new Error(`输出 Markdown 文件名必须包含中文：${args.out}`);

    let allowedRoot;

    if (args.projectDir) {

      if (!fs.existsSync(args.projectDir)) throw new Error(`--project-dir 不存在：${args.projectDir}`);

      if (!fs.statSync(args.projectDir).isDirectory()) throw new Error(`--project-dir 不是目录：${args.projectDir}`);

      allowedRoot = path.resolve(args.projectDir);

    } else {

      allowedRoot = findRepoRoot(process.cwd());

    }

    if (!isInside(args.out, allowedRoot)) throw new Error(`输出路径越界（必须位于项目根目录内）。在 skill 仓库目录执行时请传 --project-dir <项目根目录>：${args.out}`);

    ensureParent(args.out);

    if (args.append) fs.appendFileSync(args.out, input, 'utf8');

    else fs.writeFileSync(args.out, input, 'utf8');

  }

  const result = { out: args.out || '', bytes: Buffer.byteLength(input, 'utf8'), encoding: 'utf8', chineseFileName: args.out ? hasChinese(path.basename(args.out)) : true, projectDir: args.projectDir ? path.resolve(args.projectDir) : '', ok: true };

  if (args.json) console.log(JSON.stringify(result, null, 2));

  if (args.markdown) {

    console.log('# Markdown UTF-8 写入结果');

    console.log('');

    console.log(`- 输出文件：${result.out || 'stdout'}`);

    console.log(`- 编码：${result.encoding}`);

    console.log(`- 中文文件名：${result.chineseFileName ? '是' : '否'}`);

    console.log(`- 字节数：${result.bytes}`);

    if (result.projectDir) console.log(`- 项目根目录（解析后）：${result.projectDir}`);

    console.log('- 状态：写入完成，中文应正常显示');

  }

}



try {

  main();

} catch (err) {

  console.error(err.message || String(err));

  console.error(usage());

  process.exit(1);

}

