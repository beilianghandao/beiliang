// 种子码契约与存档健壮性专项：盯住「同码复现」这条承诺在存档边界上会不会塌。
const assert = require('assert');
const { GameCore } = require('../miniprogram/engine/core');
const { createRng, decodeSeed, encodeSeed } = require('../miniprogram/engine/random');

const SEED = 'K7M2QX';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}

// ———————— 存档往返 ————————

test('存档 → 还原 → 再存档，两次存档逐字段相同', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  game.applyChoice('canteen', 0, 1);
  const first = game.serialize();
  assert.deepStrictEqual(GameCore.restore(first).serialize(), first);
});

test('还原后的存档与原存档互不影响（深拷贝）', () => {
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

test('随机操作序列 fuzz：任意一串操作都能存档还原且往返幂等', () => {
  const scenes = ['library', 'canteen', 'lab', 'dorm', 'classroom', 'gym', 'club', 'court'];
  for (let round = 0; round < 30; round++) {
    const rng = createRng(round * 7919 + 13);
    const game = new GameCore('lin', encodeSeed(round * 1234567 % (32 ** 6)));
    const steps = 1 + Math.floor(rng() * 20);
    for (let i = 0; i < steps; i++) {
      const scene = scenes[Math.floor(rng() * scenes.length)];
      game.applyChoice(scene, Math.floor(rng() * 2), Math.floor(rng() * 3));
    }
    const saved = game.serialize();
    const restored = GameCore.restore(saved);
    assert.deepStrictEqual(restored.serialize(), saved, `第 ${round} 轮往返不一致`);
    assert.deepStrictEqual(restored.stats, game.stats);
    assert.strictEqual(restored.choiceLog.length, game.choiceLog.length);
    assert.strictEqual(restored.week, game.week);
  }
});

test('存档还原后继续玩，后续的考题与成绩与原局一致', () => {
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

test('存档能被 JSON 原样存进 storage 再取出来', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const json = JSON.stringify(game.serialize());
  const back = JSON.parse(json);
  assert.strictEqual(back.seedCode, SEED);
  assert.strictEqual(back.choiceLog.length, 1);
  assert.ok(!/undefined|NaN/.test(json), '存档里不该出现 undefined 或 NaN');
  assert.deepStrictEqual(GameCore.restore(back).serialize(), game.serialize());
});

test('存档体积可控：跑满四年也只有几 KB', () => {
  const game = new GameCore('lin', SEED);
  for (let semester = 1; semester <= 8; semester++) {
    while (!game.examReady) game.applyChoice('library', 0, 0);
    const questions = game.startExam();
    questions.forEach(q => game.answerExam(q.answer));
    game.finishExam();
  }
  const size = JSON.stringify(game.serialize()).length;
  assert.ok(size > 0, '存档不该是空的');
  assert.ok(size < 64 * 1024, `存档 ${size} 字节，超出预期`);
});

test('存档里的种子码是归一化后的大写形式', () => {
  const game = new GameCore('lin', 'k7m2qx');
  assert.strictEqual(game.seedCode, 'K7M2QX');
  assert.strictEqual(game.serialize().seedCode, 'K7M2QX');
  assert.strictEqual(decodeSeed(game.serialize().seedCode), decodeSeed(SEED));
});

// ———————— 存档健壮性 ————————

test('已知风险：serialize() 返回的是引擎内部状态的引用', () => {
  // 调用方拿到存档后如果改了它，会直接改到引擎身上。
  // 现在没有任何调用方这么干（落盘走 JSON.stringify 会快照），
  // 但一旦有人直接改返回值，就会污染当前这局。
  // 若引擎改成深拷贝，这条会失败并提醒更新断言。
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const saved = game.serialize();
  saved.stats.knowledge = 999;
  assert.strictEqual(game.stats.knowledge, 999, '当前实现确实把引用漏出去了');
});

test('存档缺关键字段时，restore 会明确报错而不是静默还原成空局', () => {
  const base = { characterId: 'lin', seedCode: SEED, stats: {}, energy: 80, semester: 1, week: 1, completed: [], visited: {}, examScores: [], choiceLog: [] };
  assert.throws(() => GameCore.restore({ ...base, seedCode: undefined }), /种子码不合法/);
  assert.throws(() => GameCore.restore({ ...base, seedCode: 'K7M2QI' }), /种子码不合法/);
  assert.throws(() => GameCore.restore({ ...base, choiceLog: undefined }), TypeError);
  assert.throws(() => GameCore.restore({ ...base, completed: undefined }), TypeError);
});

test('已知风险：存档缺 stats 时，restore 不会报错，但会把属性清空', () => {
  const base = { characterId: 'lin', seedCode: SEED, energy: 80, semester: 1, week: 1, completed: [], visited: {}, examScores: [], choiceLog: [] };
  const restored = GameCore.restore(base);
  assert.deepStrictEqual(restored.stats, {}, '当前实现会静默得到一份空属性表');
});

test('存档没有 rngState 时，还原后从种子重新开始数', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const saved = game.serialize();
  delete saved.rngState;
  const restored = GameCore.restore(saved);
  assert.strictEqual(restored.seedCode, SEED);
  assert.strictEqual(restored.rng.getState(), decodeSeed(SEED), '应当回到序列起点');
});

test('已知边界：存档点在「考题已抽出」之后时，还原会重新抽一套题', () => {
  // serialize() 只记了 rngState，没有记 currentExam；还原后 startExam 会接着往下抽。
  // 存档点必须落在开考前。
  const game = new GameCore('lin', SEED);
  while (!game.examReady) game.applyChoice('library', 0, 0);
  const drawn = game.startExam().map(q => q.question);
  const restored = GameCore.restore(game.serialize());
  while (!restored.examReady) restored.applyChoice('library', 0, 0);
  assert.notDeepStrictEqual(restored.startExam().map(q => q.question), drawn);
});

// ———————— 随机源性质 ————————

test('随机序列取值落在 [0,1)，且大致均匀', () => {
  const rng = createRng(decodeSeed(SEED));
  const buckets = new Array(10).fill(0);
  const total = 20000;
  for (let i = 0; i < total; i++) {
    const value = rng();
    assert.ok(value >= 0 && value < 1, `${value} 越界`);
    buckets[Math.floor(value * 10)]++;
  }
  buckets.forEach((count, index) => {
    assert.ok(count > total / 20, `第 ${index} 段只有 ${count} 个，明显偏斜`);
  });
});

test('随机序列没有可察觉的短周期', () => {
  // 取一段序列，找不到一个短周期能让它自己对上
  const rng = createRng(decodeSeed(SEED));
  const seq = Array.from({ length: 500 }, () => rng());
  for (let period = 1; period <= 50; period++) {
    let same = true;
    for (let i = 0; i + period < seq.length; i++) {
      if (seq[i] !== seq[i + period]) { same = false; break; }
    }
    assert.ok(!same, `出现了长度为 ${period} 的周期`);
  }
});

test('种子码与种子一一对应：不同码必然不同种子', () => {
  const seen = new Map();
  const rng = createRng(20261117);
  for (let i = 0; i < 5000; i++) {
    let code = '';
    for (let j = 0; j < 6; j++) code += '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(rng() * 32)];
    const seed = decodeSeed(code);
    assert.ok(!seen.has(seed), `${code} 与 ${seen.get(seed)} 撞码`);
    seen.set(seed, code);
  }
});

console.log(`\nAll ${passed} contract tests passed.`);
