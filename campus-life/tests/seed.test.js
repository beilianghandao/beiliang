// 种子码 / 确定性随机 / 选择日志 的专项用例
// 这些用例盯住「同码必然复现同一局」这条承诺：只要引擎还掷骰子，或者
// 存档少存了随机状态，这里就会红。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EXAM_BANK, STAT_META, statName } = require('../miniprogram/data/content');
const { GameCore, pickExamQuestions } = require('../miniprogram/engine/core');
const { buildChoiceLogView } = require('../miniprogram/engine/choicelog');
const { CODE_ALPHABET, decodeSeed, encodeSeed, createRng, randomSeedCode, resolveSeedInput, applySeedInput } = require('../miniprogram/engine/random');

const SEED = 'K7M2QX';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}

// 固定的一串种子码，用来代替掷骰子
const seedCodes = (count, rngSeed) => {
  const rng = createRng(rngSeed);
  return Array.from({ length: count }, () => {
    let code = '';
    for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(rng() * 32)];
    return code;
  });
};

// ——————————————————————————— 种子码编解码 ———————————————————————————

test('种子码字母表恰好 32 个字符，且不含容易混淆的 0 O 1 I', () => {
  assert.strictEqual(CODE_ALPHABET.length, 32);
  assert.strictEqual(new Set(CODE_ALPHABET).size, 32);
  ['0', 'O', '1', 'I'].forEach(ch => {
    assert.ok(!CODE_ALPHABET.includes(ch), `字母表不该出现 ${ch}`);
  });
});

test('字母表里的每个字符都能编码解码往返', () => {
  CODE_ALPHABET.split('').forEach(ch => {
    const code = ch.repeat(6);
    assert.strictEqual(encodeSeed(decodeSeed(code)), code, code);
  });
});

test('不同种子码映射到不同种子，同一个种子码只对应一个种子', () => {
  const seen = new Map();
  seedCodes(3000, 20261106).forEach(code => {
    const seed = decodeSeed(code);
    assert.ok(!seen.has(seed), `${code} 和 ${seen.get(seed)} 撞码了`);
    seen.set(seed, code);
    assert.strictEqual(encodeSeed(seed), code, `${code} 往返失败`);
  });
});

test('种子码会先归一化大小写、空格与连字符', () => {
  const seed = decodeSeed(SEED);
  ['k7m2qx', ' K7M2QX ', 'k7-m2-qx', 'K7 M2 QX', '\tK7M2QX\n'].forEach(text => {
    assert.strictEqual(decodeSeed(text), seed, `"${text}" 归一化后不该换种子`);
  });
});

test('含混淆字符、长度不对、非字符串的种子码一律拒绝', () => {
  ['K7M2Q0', 'K7M2QO', 'K7M2Q1', 'K7M2QI'].forEach(code => {
    assert.strictEqual(decodeSeed(code), null, `${code} 含混淆字符，该被拒绝`);
  });
  ['K7M2Q', 'K7M2QX1', '', 'K7M2QXY'].forEach(code => {
    assert.strictEqual(decodeSeed(code), null, `"${code}" 长度不对，该被拒绝`);
  });
  [null, undefined, 123456, {}, [], true].forEach(value => {
    assert.strictEqual(decodeSeed(value), null, `${String(value)} 不是种子码，该被拒绝`);
  });
});

test('超出范围的种子按 32^6 取模回绕，不会越界', () => {
  const space = 32 ** 6;
  assert.strictEqual(encodeSeed(space), encodeSeed(0));
  assert.strictEqual(encodeSeed(space + 5), encodeSeed(5));
  const wrapped = encodeSeed(4294967295);
  assert.strictEqual(wrapped.length, 6);
  assert.strictEqual(decodeSeed(wrapped), 4294967295 % space);
});

// ——————————————————————————— 确定性随机 ———————————————————————————

test('随机序列的每个数都落在 [0, 1) 区间内', () => {
  const rng = createRng(decodeSeed(SEED));
  for (let i = 0; i < 1000; i++) {
    const value = rng();
    assert.ok(value >= 0 && value < 1, `${value} 越界了`);
  }
});

test('随机序列可以存取状态，接上之后与原序列逐位一致', () => {
  const rng = createRng(decodeSeed(SEED));
  rng(); rng(); rng();
  const state = rng.getState();
  const expected = [rng(), rng(), rng()];
  const resumed = createRng(decodeSeed(SEED));
  resumed.setState(state);
  assert.deepStrictEqual([resumed(), resumed(), resumed()], expected);
  assert.strictEqual(createRng(decodeSeed(SEED)).getState(), decodeSeed(SEED));
});

test('同种子给同一串随机数，不同种子给出不同序列', () => {
  const draw = code => { const rng = createRng(decodeSeed(code)); return [rng(), rng(), rng()]; };
  assert.deepStrictEqual(draw(SEED), draw(SEED));
  assert.notDeepStrictEqual(draw(SEED), draw('R4T8WA'));
});

// ——————————————————————————— 抽题 ———————————————————————————

test('每次期末从题库抽 5 题，同一套题里不重复', () => {
  const questions = pickExamQuestions(createRng(decodeSeed(SEED)));
  assert.strictEqual(questions.length, 5);
  assert.strictEqual(new Set(questions.map(q => q.question)).size, 5);
  questions.forEach(q => {
    assert.ok(EXAM_BANK.some(bank => bank.question === q.question), `${q.question} 不在题库里`);
  });
});

test('不同的种子会抽出不同的考题，且这种差异是系统性的', () => {
  const draws = new Set();
  for (let seed = 0; seed < 50; seed++) {
    const rng = createRng(seed);
    draws.add(pickExamQuestions(rng).map(q => q.question).join('|'));
  }
  assert.ok(draws.size > 1, '换了种子却抽出同一套题，种子码没起作用');
  assert.ok(draws.size >= 10, `50 颗种子只抽出 ${draws.size} 套题，抽题分布太窄`);
});

test('题库每题都有题干、至少两个选项与合法答案下标', () => {
  assert.ok(EXAM_BANK.length >= 5);
  EXAM_BANK.forEach(q => {
    assert.ok(q.question, '题干不能为空');
    assert.ok(Array.isArray(q.options) && q.options.length >= 2, q.question);
    assert.ok(q.answer >= 0 && q.answer < q.options.length, `${q.question} 的答案下标越界`);
  });
});

// ——————————————————————————— 整局可复现 ———————————————————————————

test('同一个角色 + 同一个种子码，跑完一学期得到逐字段相同的存档', () => {
  const play = code => {
    const game = new GameCore('lin', code);
    const script = [['library', 0, 0], ['library', 1, 1], ['canteen', 0, 0], ['canteen', 1, 1]];
    while (!game.examReady) {
      const [scene, quest, choice] = script[(game.week - 1) % script.length];
      game.applyChoice(scene, quest, choice);
    }
    const questions = game.startExam();
    questions.forEach(q => game.answerExam(q.answer));
    game.finishExam();
    return { state: game.serialize(), exams: questions.map(q => q.question) };
  };
  const first = play(SEED);
  const second = play(SEED);
  assert.deepStrictEqual(second.state, first.state);
  assert.deepStrictEqual(second.exams, first.exams);
});

test('种子码决定抽题，角色只影响属性，不影响考题顺序', () => {
  const draw = id => {
    const game = new GameCore(id, SEED);
    while (!game.examReady) game.applyChoice('library', 0, 0);
    return game.startExam().map(q => q.question);
  };
  assert.deepStrictEqual(draw('chen'), draw('lin'));
  assert.deepStrictEqual(draw('su'), draw('jiang'));
});

test('一局从头玩到尾，种子码始终不变', () => {
  const game = new GameCore('lin', 'k7m2qx');
  assert.strictEqual(game.seedCode, 'K7M2QX', '种子码应当被归一化成大写');
  game.applyChoice('library', 0, 0);
  assert.strictEqual(game.seedCode, 'K7M2QX');
  assert.strictEqual(game.serialize().seedCode, 'K7M2QX');
});

// ——————————————————————————— 存档与还原 ———————————————————————————

test('种子码是开局必填项：缺失或非法时引擎立刻报错，不静默开局', () => {
  assert.throws(() => new GameCore('lin'), /种子码不合法/);
  assert.throws(() => new GameCore('lin', ''), /种子码不合法/);
  assert.throws(() => new GameCore('lin', 'K7M2QI'), /种子码不合法/);
  assert.throws(() => new GameCore('lin', 'K7M2Q'), /种子码不合法/);
  assert.doesNotThrow(() => new GameCore('lin', 'k7m2qx'));
});

test('存档 → 还原 → 再存档，两次存档逐字段相同', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  game.applyChoice('canteen', 0, 1);
  const first = game.serialize();
  const restored = GameCore.restore(first);
  assert.deepStrictEqual(restored.serialize(), first);
});

test('还原出来的存档与原存档互不影响（深拷贝）', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const saved = game.serialize();
  const restored = GameCore.restore(saved);
  restored.stats.knowledge = 999;
  restored.choiceLog[0].effects.knowledge = 999;
  restored.completed.push('fake:0');
  restored.visited['fake:0'] = 1;
  assert.notStrictEqual(saved.stats.knowledge, 999);
  assert.notStrictEqual(saved.choiceLog[0].effects.knowledge, 999);
  assert.ok(!saved.completed.includes('fake:0'));
  assert.ok(!saved.visited['fake:0']);
});

test('从存档还原后继续玩，后面的考题与成绩与原局一致', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const restored = GameCore.restore(game.serialize());
  const play = core => {
    while (!core.examReady) core.applyChoice('canteen', 0, 0);
    const questions = core.startExam();
    questions.forEach(q => core.answerExam(q.answer));
    const outcome = core.finishExam();
    return { exam: questions.map(q => q.question).join('|'), score: outcome.semesterResult.score, stats: { ...core.stats } };
  };
  assert.deepStrictEqual(play(restored), play(game));
});

test('还原后的存档仍能算出同一个毕业结局', () => {
  const game = new GameCore('lin', SEED);
  for (let semester = 1; semester <= 8; semester++) {
    while (!game.examReady) game.applyChoice('library', 0, 0);
    const questions = game.startExam();
    questions.forEach(q => game.answerExam(q.answer));
    game.finishExam();
  }
  assert.ok(game.ending, '八年跑完应该有结局');
  const restored = GameCore.restore(game.serialize());
  const avg = Math.round(restored.examScores.reduce((a, b) => a + b, 0) / restored.examScores.length);
  assert.strictEqual(restored.pickEnding(avg).id, game.ending.id);
});

test('已知边界：存档点在「考题已抽出」之后时，还原会重新抽一套题', () => {
  // 存档只记了 rngState，没有记 currentExam；所以还原后 startExam 会接着往下抽，
  // 抽到的就不是存档时那一套了。存档点必须落在开考前。
  // 若引擎改成把 currentExam 一起存进存档，这条会失败并提醒更新断言。
  const game = new GameCore('lin', SEED);
  while (!game.examReady) game.applyChoice('library', 0, 0);
  const drawn = game.startExam().map(q => q.question);
  const restored = GameCore.restore(game.serialize());
  while (!restored.examReady) restored.applyChoice('library', 0, 0);
  const redrawn = restored.startExam().map(q => q.question);
  assert.notDeepStrictEqual(redrawn, drawn);
});

// ——————————————————————————— 选择日志 ———————————————————————————

test('每次选择都留下一条结构完整的日志', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  assert.strictEqual(game.choiceLog.length, 1);
  const entry = game.choiceLog[0];
  assert.strictEqual(entry.semester, 1);
  assert.strictEqual(entry.week, 1);
  assert.strictEqual(entry.sceneId, 'library');
  assert.strictEqual(entry.sceneName, '图书馆');
  assert.ok(entry.questTitle, '缺少任务标题');
  assert.ok(entry.choiceText, '缺少选项文案');
  assert.strictEqual(entry.repeat, false);
  assert.ok(Object.keys(entry.effects).length > 0, '缺少属性变化');
});

test('日志里记的是结算后的实际数值（含角色加成与重复衰减）', () => {
  const chen = new GameCore('chen', SEED);
  const result = chen.applyChoice('library', 0, 0);
  assert.deepStrictEqual(chen.choiceLog[0].effects, result.applied);
  assert.ok(result.applied.knowledge > 8, '陈屿在图书馆应当有学识加成');

  const lin = new GameCore('lin', SEED);
  lin.applyChoice('library', 0, 0);
  lin.applyChoice('library', 0, 0);
  assert.strictEqual(lin.choiceLog[1].repeat, true);
  assert.ok(lin.choiceLog[1].effects.knowledge < lin.choiceLog[0].effects.knowledge, '重复体验应当收益递减');
});

test('日志视图按时间倒序，且不会改动原始日志', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  game.applyChoice('canteen', 0, 0);
  game.applyChoice('dorm', 0, 0);
  const snapshot = JSON.stringify(game.choiceLog);
  const view = buildChoiceLogView(game.choiceLog);
  assert.strictEqual(JSON.stringify(game.choiceLog), snapshot, '视图不该改动原始日志');
  assert.deepStrictEqual(view.map(item => item.sceneId), ['dorm', 'canteen', 'library']);
  assert.strictEqual(new Set(view.map(item => item.id)).size, view.length, '视图条目的 id 必须唯一');
});

test('没有选择过时，日志视图是空数组而不是报错', () => {
  assert.deepStrictEqual(buildChoiceLogView([]), []);
  assert.deepStrictEqual(buildChoiceLogView(undefined), []);
});

test('日志视图给出属性名字与变化量，并标出是否重复体验', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  game.applyChoice('library', 0, 0);
  const view = buildChoiceLogView(game.choiceLog);
  assert.strictEqual(view[0].repeat, true);
  assert.strictEqual(view[0].repeatLabel, '重复体验 · 收益递减');
  assert.strictEqual(view[1].repeat, false);
  assert.strictEqual(view[1].repeatLabel, '首次体验');
  assert.deepStrictEqual(view[1].effects.map(item => item.name), ['学识', '精力']);
});

test('属性名字有兜底：未知 key 原样返回，不会抛错', () => {
  assert.strictEqual(statName('energy'), '精力');
  assert.strictEqual(statName('knowledge'), STAT_META.knowledge.name);
  assert.strictEqual(statName('notAStat'), 'notAStat');
});

// ——————————————————————————— 输入规则 ———————————————————————————

test('种子码输入规则两端共用一份：留空 / 合法 / 非法各走各的路', () => {
  assert.deepStrictEqual(resolveSeedInput(''), { blank: true });
  assert.deepStrictEqual(resolveSeedInput('  \t '), { blank: true });
  const valid = resolveSeedInput('k7m2qx');
  assert.strictEqual(valid.code, 'K7M2QX');
  assert.ok(valid.hint);
  assert.ok(resolveSeedInput('K7M2QI').error);
  assert.ok(resolveSeedInput('K7M2Q').error);

  const blank = applySeedInput('', () => 0.5);
  assert.strictEqual(blank.code.length, 6);
  assert.ok(blank.hint);
  assert.strictEqual(applySeedInput('K7M2QX', () => 0.5).code, 'K7M2QX');
  assert.ok(applySeedInput('K7M2QI', () => 0.5).error);
});

test('铸新种子码必须由调用方给熵源，引擎自己不掷骰子', () => {
  assert.throws(() => randomSeedCode(), /熵源/);
  assert.throws(() => randomSeedCode(0.5), /熵源/);
  assert.strictEqual(randomSeedCode(() => 0), '222222');
  assert.strictEqual(randomSeedCode(() => 0.5).length, 6);
});

// ——————————————————————————— 不掷骰子守卫 ———————————————————————————

test('引擎与数据层不出现非确定性随机来源', () => {
  ['engine', 'data'].forEach(dir => {
    const files = fs.readdirSync(path.join(__dirname, '../miniprogram', dir)).filter(file => file.endsWith('.js'));
    files.forEach(file => {
      const source = fs.readFileSync(path.join(__dirname, '../miniprogram', dir, file), 'utf8');
      assert.ok(!/Math\.random|Date\.now|new Date\(/.test(source), `${dir}/${file} 出现了非确定性随机`);
    });
  });
});

test('熵源只允许出现在界面层，界面造出来的码引擎一定认', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '../miniprogram/app.js'), 'utf8');
  assert.ok(/randomSeedCode\(Math\.random\)/.test(appSource), 'app.js 应当用 Math.random 作熵源');
  const selectSource = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/select/select.js'), 'utf8');
  assert.ok(/randomSeedCode\(Math\.random\)/.test(selectSource), '选角页应当用 Math.random 作熵源');

  const code = randomSeedCode(() => 0.42);
  assert.notStrictEqual(decodeSeed(code), null, '造出来的码必须合法');
  assert.doesNotThrow(() => new GameCore('lin', code));
});

console.log(`\nAll ${passed} seed tests passed.`);
