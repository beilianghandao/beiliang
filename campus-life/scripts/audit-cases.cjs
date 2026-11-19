// 用华为《测试用例编写规范》审测试用例文件，把机械可查的规则逐条跑出来。
// 规范来源：https://support.huawei.com/enterprise/zh/doc/EDOC1100452640/b1186e2d
//
// 两种写法都认：
//   1) 旧写法 test('名称', fn)              —— 只能查出命名与用词类问题
//   2) 新写法 tests/harness.js 的 suite()  —— 用例骨架本身就会强制校验规范字段
//
// 用法：npm run audit
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// —— 规则10.5 / 建议1.1：禁用模糊词 ——
const VAGUE_WORDS = [
  '等', '可能', '部分', '有的', '一定范围', '适量', '大约', '一些', '多个', '多于', '少于', '左右', '上下',
  '大量', '少量', '多次', '随机', '任意', '一段时间', '一会', '一点', '特殊', '很长', '较长', '很短', '较短',
  '几条', '数次', '变差', '所有', '大概', '频繁', '某些', '计数正常', '长时间', '死循环',
  '最大', '最小', '非法报文', '非法字符', '超长', '超小', '超短', '长包', '短包', '边界值', '过低', '过高',
  '全部', '缺省', '默认', '正常'
];
const EXEMPT_COMPOUNDS = ['等于', '等级', '等待', '不等', '对等'];

// —— 建议1.3：名称避免标点符号 ——
const NAME_PUNCT = /[，,。：:；;！!？?、（）()「」《》""'']/;

// —— 规则10.1 保留字 ——
const RESERVED = [['观察', '检查'], ['查询', '检查'], ['确认', '检查'], ['查看', '检查'],
  ['赋值', '设置'], ['给予', '设置'], ['标记', '设置'], ['运行', '执行'], ['操作', '执行'],
  ['反复', '重复'], ['循环', '重复']];

const mask = text => EXEMPT_COMPOUNDS.reduce((s, c) => s.split(c).join('〇'), text);

function readCases(src) {
  // 新写法：harness 的 suite() 用例（同时带 type 与 title 的才是用例，
  // 缺陷台账里的 openIssue({ title: ... }) 不算用例）
  const harness = [...src.matchAll(/title:\s*'((?:[^'\\]|\\.)*)'([\s\S]*?)(?=\n  \{|\n\]\);)/g)]
    .filter(m => /\btype\s*:/.test(m[2]))
    .map(m => ({ name: m[1], body: m[2], style: 'harness' }));
  if (harness.length) return harness;
  // 旧写法：test('名称', fn) —— 按花括号配平截出用例体，别把后面的用例也算进来
  const lines = src.split('\n');
  return [...src.matchAll(/\btest\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(?:async\s*)?\(/g)].map(m => {
    const lineNo = src.slice(0, m.index).split('\n').length;
    let depth = 0, started = false, end = lineNo - 1;
    for (let i = lineNo - 1; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '(') { depth++; started = true; }
        else if (ch === ')') { depth--; if (started && depth === 0) { end = i; i = lines.length; break; } }
      }
    }
    return { name: m[1], body: lines.slice(lineNo - 1, end + 1).join('\n'), style: 'legacy' };
  });
}

const files = process.argv.slice(2);
const targets = files.length ? files : [
  'tests/seed.test.js', 'tests/seed-contract.test.js',
  'tests/miniprogram-e2e.test.js', 'tests/web-e2e.test.js'
];

let totalCases = 0, totalProblems = 0;
for (const rel of targets) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log(`跳过 ${rel}（不存在）`); continue; }
  const src = fs.readFileSync(file, 'utf8');
  const cases = readCases(src);
  if (!cases.length) { console.log(`\n=== ${rel} ===\n  没找到用例`); continue; }

  const problems = [];
  const names = cases.map(c => c.name);
  cases.forEach((c, i) => {
    const body = c.body;
    const where = `第 ${i + 1} 条「${c.name}」`;
    if (c.style === 'legacy') {
      // 旧写法只能查命名与用词
      if (!/^\s*(type|level|pre|steps|expect)\s*:/.test(body)) {
        problems.push(`${where}：缺类型/等级/前置条件/步骤/预期结果（harness 写法才强制）`);
      }
    } else {
      ['type', 'level', 'pre', 'steps', 'expect'].forEach(field => {
        if (!new RegExp(`\\b${field}\\s*:`).test(body)) problems.push(`${where}：缺字段 ${field}`);
      });
      if (!/\bdefect\s*:|\blinked\s*:/.test(body) && !/\brun\s*:/.test(body)) {
        problems.push(`${where}：缺可执行断言`);
      }
    }
    if (c.name.length > 60) problems.push(`${where}：名称 ${c.name.length} 字符，超过 60`);
    if (NAME_PUNCT.test(c.name)) problems.push(`${where}：名称含标点符号`);
    if (!c.name.includes('_') && c.style === 'harness') problems.push(`${where}：名称未采用动宾结构（意图_条件_观察点）`);
    const text = mask(c.name + '\n' + body);
    for (const w of VAGUE_WORDS) {
      if (text.includes(w)) { problems.push(`${where}：出现禁用模糊词「${w}」`); break; }
    }
    for (const [bad, good] of RESERVED) {
      if (text.includes(bad)) { problems.push(`${where}：用了「${bad}」，应为「${good}」`); break; }
    }
    const checks = (body.match(/\bassert\.\w+\(/g) || []).length;
    if (checks > 3) problems.push(`${where}：检查点 ${checks} 个，超过 3 个`);
  });

  const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (dup.length) problems.push(`用例名称重复：${dup.join(' / ')}`);

  totalCases += cases.length;
  totalProblems += problems.length;
  console.log(`\n=== ${rel} ===`);
  console.log(`  用例 ${cases.length} 条，写法：${cases[0].style === 'harness' ? 'harness（规范强制字段）' : '旧写法（仅查命名与用词）'}`);
  if (problems.length) {
    console.log(`  ✗ ${problems.length} 处不合规：`);
    problems.slice(0, 12).forEach(p => console.log(`      · ${p}`));
    if (problems.length > 12) console.log(`      …… 还有 ${problems.length - 12} 处`);
  } else {
    console.log('  ✓ 全部通过');
  }
}

console.log(`\n合计 ${totalCases} 条用例，${totalProblems} 处不合规。`);
if (totalProblems) process.exit(1);
