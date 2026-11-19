// 华为《测试用例编写规范》落地的测试骨架
// 规范来源：https://support.huawei.com/enterprise/zh/doc/EDOC1100452640/b1186e2d
//
// 这份骨架把规范从「建议」变成「强制」：一条用例必须声明
//   编号（英文特性名 + 三位序号）/ 测试类型 / 用例等级 / 名称 / 前置条件 / 测试步骤 / 预期结果
// 缺任何一项，或者名称带标点、用了禁用模糊词、检查点超过 3 个，
// 都在「定义用例」这一步直接报错，而不是等跑的时候才发现。
//
// 另外提供缺陷台账：用例失败时按缺陷编号关联「问题单编号」，
// 执行完导出可直接贴进测试计划的用例清单。

const fs = require('fs');
const path = require('path');

// —— 规则9.1 测试类型（一级质量属性下的常用二级类型）——
const TYPES = [
  '功能正确性测试', '功能交互测试', '一致性测试',
  '性能规格测试', '资源效率测试', '网络性能测试',
  '配套兼容性测试', '互通测试',
  '容错容灾测试', '可用性测试',
  '安全合规测试', '抗攻击性测试',
  '可部署性测试', '可维护性测试'
];

// —— 规则8 用例等级：1 最基本 / 2 基本 / 3 重要 / 4 一般与异常 / 5 特殊场景 ——
const LEVELS = {
  1: '最基本的功能验证',
  2: '基本功能验证',
  3: '重要特性验证',
  4: '一般功能与非重要功能的异常验证',
  5: '特殊输入、场景、阈值条件'
};

// —— 规则10.5 / 建议1.1 禁用模糊词 ——
const VAGUE_WORDS = [
  '等', '可能', '部分', '有的', '一定范围', '适量', '大约', '一些', '多个', '多于', '少于', '左右', '上下',
  '大量', '少量', '多次', '随机', '任意', '一段时间', '一会', '一点', '特殊', '很长', '较长', '很短', '较短',
  '几条', '数次', '变差', '所有', '大概', '频繁', '某些', '计数正常', '长时间', '死循环',
  '最大', '最小', '非法报文', '非法字符', '超长', '超小', '超短', '长包', '短包', '边界值', '过低', '过高',
  '全部', '缺省', '默认', '正常'
];

// —— 建议1.3 名称避免标点符号 ——
const NAME_PUNCT = /[，,。：:；;！!？?、（）()「」《》""'']/;

// —— 规则10.5 的单字词按子串匹配会误伤复合词，这里显式豁免 ——
// 豁免项是写清楚的，不是偷偷放水：复合词本身不构成「模糊描述」
const EXEMPT_COMPOUNDS = ['等于', '等级', '等待', '不等', '等于号', '对等'];

// —— 规则10.1 保留字：这些说法要换成规范说法 ——
const RESERVED = [
  ['观察', '检查'], ['查询', '检查'], ['确认', '检查'], ['查看', '检查'],
  ['赋值', '设置'], ['给予', '设置'], ['标记', '设置'],
  ['运行', '执行'], ['操作', '执行'],
  ['反复', '重复'], ['循环', '重复']
];

const defects = new Map();

/**
 * 登记一个缺陷（问题单）。
 * @param {string} id      问题单编号，如 ISSUE-A
 * @param {object} detail  { title, level, cause, status, owner, foundBy }
 */
function openIssue(id, detail) {
  if (!/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/.test(id)) {
    throw new Error(`缺陷编号 ${id} 不合规：应形如 ISSUE-A / ISSUE-SEED-001 / BUG-001`);
  }
  defects.set(id, {
    id,
    title: detail.title || '',
    level: detail.level || 3,
    cause: detail.cause || '',
    status: detail.status || 'open',      // open / fixed / closed
    owner: detail.owner || '',
    foundBy: detail.foundBy || '',
    cases: detail.cases || []
  });
  return id;
}

/** 关闭一个缺陷：登记修复方式与验证用例 */
function closeIssue(id, detail = {}) {
  const issue = defects.get(id);
  if (!issue) throw new Error(`缺陷 ${id} 未登记`);
  issue.status = detail.status || 'fixed';
  issue.fix = detail.fix || '';
  issue.verifiedBy = detail.verifiedBy || '';
  return issue;
}

const suites = [];
let currentSuite = null;

/**
 * 定义一组测试用例。
 * @param {string} featureId  一级特性的英文名，用例编号的前缀，如 campus_seed
 * @param {string} featureName 一级特性的中文名
 * @param {Array}  cases      用例数组
 */
function suite(featureId, featureName, cases) {
  if (!/^[a-z][a-z0-9_]*$/.test(featureId)) {
    throw new Error(`特性编号 ${featureId} 不合规：必须是英文小写字母、数字与下划线（规则7.1）`);
  }
  const list = cases.map((spec, index) => validate(spec, featureId, index));
  suites.push({ featureId, featureName, cases: list });
  currentSuite = suites[suites.length - 1];
  return currentSuite;
}

function validate(spec, featureId, index) {
  const where = `${featureId} 第 ${index + 1} 条用例`;
  const fail = msg => { throw new Error(`${where}：${msg}`); };

  // 建议7.3 序列号三位十进制；建议7.5 总长度 < 40
  const seq = String(index + 1).padStart(3, '0');
  const id = `${featureId}_${seq}`;
  if (id.length >= 40) fail(`用例编号 ${id} 超过 40 字符（建议7.5）`);

  // 建议1.2 名称动宾结构：用例意图_预置条件_观察点
  if (!spec.title) fail('缺少用例名称');
  if (spec.title.length > 60) fail(`用例名称超过 60 字符（规则1.1）：${spec.title}`);
  if (NAME_PUNCT.test(spec.title)) fail(`用例名称不要用标点符号，用下划线代替（建议1.3）：${spec.title}`);
  if (!spec.title.includes('_')) fail(`用例名称建议采用动宾结构「用例意图_预置条件_观察点」（建议1.2）：${spec.title}`);
  const seen = suites.flatMap(s => s.cases.map(c => c.title)).concat(
    (suites[currentSuiteIndex()] || { cases: [] }).cases.map(c => c.title));
  if (seen.includes(spec.title)) fail(`用例名称重复（建议1.3）：${spec.title}`);

  // 规则9.1 测试类型必选
  if (!spec.type) fail('缺少测试类型（规则9.1 为必选项）');
  if (!TYPES.includes(spec.type)) fail(`测试类型不在规范清单内：${spec.type}`);

  // 规则8 用例等级
  if (!spec.level) fail('缺少用例等级（规则8）');
  if (!LEVELS[spec.level]) fail(`用例等级只能是 1~5：${spec.level}`);

  // 规则4.2 前置条件
  if (!spec.pre || !spec.pre.trim()) fail('缺少前置条件（规则4.2）');

  // 规则5.x 测试步骤：至少一步，不超过 7 步
  if (!Array.isArray(spec.steps) || !spec.steps.length) fail('缺少测试步骤（规则1.1 必填项）');
  if (spec.steps.length > 7) fail(`测试步骤 ${spec.steps.length} 步，超过 7 步，建议拆分（规则10.3）`);

  // 规则6.x 预期结果
  if (!spec.expect || !spec.expect.trim()) fail('缺少预期结果（规则1.1 必填项）');
  if (/是否|能否|可否|可能会/.test(spec.expect)) {
    fail(`预期结果不能是假设性结论（规则6.1）：${spec.expect}`);
  }

  // 规则10.5 禁用模糊词：名称、步骤、预期结果、前置条件里都不该出现
  const raw = [spec.title, spec.pre, spec.expect, ...spec.steps].join('\n');
  const text = EXEMPT_COMPOUNDS.reduce((s, compound) => s.split(compound).join('〇'), raw);
  for (const word of VAGUE_WORDS) {
    if (text.includes(word)) fail(`出现了禁用模糊词「${word}」（规则10.5）：${raw.slice(0, 40)}…`);
  }

  // 规则10.1 保留字
  for (const [bad, good] of RESERVED) {
    if (text.includes(bad)) fail(`「${bad}」应换成规范保留字「${good}」（规则10.1）`);
  }

  // 建议1.2 检查点不超过 3 个
  const source = String(spec.run || '');
  const checks = (source.match(/\bassert\.\w+\(/g) || []).length;
  if (checks > 3) fail(`检查点 ${checks} 个，超过 3 个，建议拆分（建议1.2）`);

  if (typeof spec.run !== 'function') fail('缺少可执行的断言函数');

  // 缺陷复现用例：关联到已登记的问题单，期望断言失败（缺陷仍在）
  if (spec.defect) {
    if (!defects.has(spec.defect)) fail(`关联的问题单 ${spec.defect} 没有登记在缺陷台账里`);
    defects.get(spec.defect).cases.push(id);
  }
  // 已知边界的守护用例：断言的是当前行为，期望通过，只登记关联关系
  if (spec.linked) {
    if (!defects.has(spec.linked)) fail(`关联的问题单 ${spec.linked} 没有登记在缺陷台账里`);
    defects.get(spec.linked).cases.push(id);
  }

  return { ...spec, id, featureId, featureName: currentSuite ? currentSuite.featureName : '', checks };
}

function currentSuiteIndex() { return suites.length - 1; }

/** 跑完全部用例，返回统计与失败明细 */
function runAll() {
  const results = [];
  for (const s of suites) {
    for (const c of s.cases) {
      let status = 'PASS';
      let actual = '';
      let error = null;
      try { c.run(); }
      catch (e) { status = 'FAIL'; error = e; actual = e.message; }
      // 缺陷复现用例：断言失败才是预期结果（缺陷仍在）；断言通过说明缺陷已修复
      if (c.defect) {
        if (status === 'PASS') {
          status = '待转正';
          actual = `缺陷 ${c.defect} 已修复，该复现用例应转成正式用例`;
        } else {
          status = '已知缺陷';
        }
      }
      results.push({ ...c, status, actual, error });
      const mark = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⚠';
      console.log(`${mark} ${c.id}  ${c.title}${c.defect ? `　【${c.defect}】` : ''}`);
      if (status === 'FAIL') {
        console.log(`      实际结果：${actual}`);
        console.log(`      问题单编号：${c.defect || '（未登记，请补一条缺陷记录）'}`);
      } else if (status === '待转正') {
        console.log(`      ${actual}`);
      }
    }
  }
  return results;
}

/** 导出可直接贴进测试计划的用例清单（华为模板列） */
function exportCaseList(results) {
  const head = '| 用例编号 | 测试类型 | 用例等级 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 实际结果 | 问题单编号 |';
  const sep = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  const rows = results.map(r => {
    const issue = r.defect ? defects.get(r.defect) : [...defects.values()].find(d => d.cases.includes(r.id));
    const steps = r.steps.map((s, i) => `${i + 1}、${s}`).join('<br>');
    const actual = r.status === 'PASS' ? 'PASS' : r.status === '已知缺陷' ? `FAIL（${r.defect}）` : r.status;
    return `| ${r.id} | ${r.type} | ${r.level} | ${r.title} | ${r.pre} | ${steps} | ${r.expect} | ${actual} | ${issue ? issue.id : ''} |`;
  });
  return [head, sep, ...rows].join('\n');
}

/** 缺陷台账导出 */
function exportDefects() {
  if (!defects.size) return '（无缺陷记录）';
  const head = '| 问题单编号 | 标题 | 等级 | 状态 | 关联用例 | 原因 | 修复方式 |';
  const sep = '| --- | --- | --- | --- | --- | --- | --- |';
  const rows = [...defects.values()].map(d =>
    `| ${d.id} | ${d.title} | ${d.level} | ${d.status} | ${d.cases.join(' ')} | ${d.cause} | ${d.fix || ''} |`);
  return [head, sep, ...rows].join('\n');
}

module.exports = {
  suite, runAll, exportCaseList, exportDefects,
  openIssue, closeIssue, defects,
  TYPES, LEVELS, VAGUE_WORDS
};
