const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CHARACTERS, EVENTS, STAT_META, ENDINGS, EXAM_BANK, semesterLabel, statName } = require('../miniprogram/data/content');
const { GameCore, pickExamQuestions } = require('../miniprogram/engine/core');
const { CampusWorld } = require('../miniprogram/engine/world');
const { buildChoiceLogView } = require('../miniprogram/engine/choicelog');
const { createRng, decodeSeed, encodeSeed, randomSeedCode, resolveSeedInput, applySeedInput } = require('../miniprogram/engine/random');

// 固定一颗种子，让不涉及随机的用例也能逐项断言
const SEED = 'K7M2QX';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}

test('四名角色都拥有五项合法初始属性与发型设定', () => {
  CHARACTERS.forEach(c => {
    Object.keys(STAT_META).forEach(key => assert.ok(c.stats[key] >= 0 && c.stats[key] <= 100, c.id));
    assert.ok(['long', 'short', 'ponytail', 'messy'].includes(c.hairStyle), c.id);
  });
});

test('每个场景有美术配置和至少 2 个任务，任务均有合法选项', () => {
  Object.values(EVENTS).forEach(scene => {
    assert.ok(scene.art && scene.art.motif, scene.name);
    assert.ok(Array.isArray(scene.art.sky) && scene.art.sky.length === 2, scene.name);
    assert.ok(scene.quests.length >= 2, scene.name);
    scene.quests.forEach(quest => {
      assert.ok(quest.title && quest.text, quest.id);
      assert.ok(quest.choices.length >= 2, quest.id);
      quest.choices.forEach(choice => {
        Object.keys(choice.effects).forEach(key => {
          const known = key === 'energy' || Object.keys(STAT_META).includes(key);
          assert.ok(known, `${quest.id}:${key}`);
        });
      });
    });
  });
});

test('首次完成任务会成长并推进一周', () => {
  const game = new GameCore('lin', SEED);
  const result = game.applyChoice('library', 0, 0);
  assert.ok(result && result.reply);
  assert.strictEqual(game.stats.knowledge, 54);
  assert.strictEqual(game.week, 2);
});

test('重复完成任务收益递减且不重复计数', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const repeat = game.applyChoice('library', 0, 0);
  assert.ok(repeat.repeat);
  assert.ok(repeat.applied.knowledge <= 4);
  assert.strictEqual(game.completed.filter(key => key === 'library:0').length, 1);
});

test('同一场景的第二个任务独立计数', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  game.applyChoice('library', 1, 0);
  assert.strictEqual(game.completed.length, 2);
  assert.ok(game.completed.includes('library:1'));
});

test('角色特长：陈屿学识加成与林知夏人缘加成生效', () => {
  const chen = new GameCore('chen', SEED); chen.applyChoice('library', 0, 0);
  assert.strictEqual(chen.stats.knowledge, 60 + 8 + 2);
  const lin = new GameCore('lin', SEED); lin.applyChoice('library', 0, 1);
  assert.strictEqual(lin.stats.social, 54 + 6 + 1);
});

test('每学期 4 周后进入期末，考完进入下一学期', () => {
  const game = new GameCore('lin', SEED);
  ['library:0', 'library:1', 'canteen:0', 'canteen:1'].forEach(pair => {
    const [scene, quest] = pair.split(':'); game.applyChoice(scene, Number(quest), 0);
  });
  assert.ok(game.examReady);
  const questions = game.startExam();
  assert.strictEqual(questions.length, 5);
  questions.forEach(q => game.answerExam(q.answer));
  const outcome = game.finishExam();
  assert.ok(outcome.semesterResult);
  assert.strictEqual(outcome.semesterResult.semester, 1);
  assert.strictEqual(game.semester, 2);
  assert.strictEqual(game.week, 1);
  assert.strictEqual(game.examScores.length, 1);
  assert.strictEqual(game.semesterName, '大一下学期');
});

test('期末未就绪时不能开考', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  assert.strictEqual(game.startExam(), null);
});

test('连续八个学期后触发毕业结局并返回四年均分', () => {
  const game = new GameCore('chen', SEED);
  for (let semester = 1; semester <= 8; semester++) {
    while (!game.examReady) game.applyChoice('library', 0, 0);
    const questions = game.startExam();
    questions.forEach(q => game.answerExam(q.answer));
    const outcome = game.finishExam();
    if (semester < 8) assert.ok(outcome.semesterResult);
    else {
      assert.ok(outcome.ending);
      assert.strictEqual(game.examScores.length, 8);
      assert.ok(ENDINGS.map(e => e.id).includes(outcome.ending.id));
      assert.ok(outcome.ending.score >= 0 && outcome.ending.score <= 100);
    }
  }
});

test('四种毕业结局按主导属性可独立触发', () => {
  const cases = [
    ['scholar', { knowledge: 95, fitness: 40, mood: 40, social: 40, practice: 50 }],
    ['leader', { knowledge: 40, fitness: 40, mood: 40, social: 95, practice: 85 }],
    ['maker', { knowledge: 70, fitness: 40, mood: 40, social: 40, practice: 95 }],
    ['sunshine', { knowledge: 40, fitness: 90, mood: 95, social: 40, practice: 40 }]
  ];
  cases.forEach(([id, stats]) => {
    const game = new GameCore('lin', SEED); game.stats = { ...stats };
    const ending = game.pickEnding(85);
    assert.strictEqual(ending.id, id);
  });
  const weak = new GameCore('lin', SEED); weak.stats = { knowledge: 20, fitness: 20, mood: 20, social: 20, practice: 20 };
  assert.strictEqual(weak.pickEnding(50).id, 'ordinary');
});

test('题库共 10 题，每次抽 5 题且同学期不重复', () => {
  assert.strictEqual(EXAM_BANK.length, 10);
  const draw = code => pickExamQuestions(createRng(decodeSeed(code))).map(q => q.question);
  const first = draw('K7M2QX');
  assert.strictEqual(first.length, 5);
  assert.strictEqual(new Set(first).size, 5);
  assert.deepStrictEqual(draw('K7M2QX'), first);
  const variants = ['R4T8WA', 'YH3D6N', 'P9C2VB', 'M5F8ZR'].map(draw);
  assert.ok(variants.some(item => item.join('|') !== first.join('|')));
  assert.strictEqual(semesterLabel(1), '大一上学期');
  assert.strictEqual(semesterLabel(4), '大二下学期');
  assert.strictEqual(semesterLabel(6), '大三下学期');
  assert.strictEqual(semesterLabel(7), '大四上学期');
  assert.strictEqual(semesterLabel(8), '大四下学期');
});

test('高消耗路线会消耗精力，江野拥有额外恢复', () => {
  const normal = new GameCore('lin', SEED); normal.applyChoice('lab', 0, 0);
  const jiang = new GameCore('jiang', SEED); jiang.applyChoice('lab', 0, 0);
  assert.ok(normal.energy < jiang.energy);
  assert.strictEqual(jiang.energy, 82 - 16 + 10 + 8);
});

test('每次选择都会留下一条结构化选择日志', () => {
  const game = new GameCore('lin', SEED);
  const result = game.applyChoice('library', 0, 0);
  game.applyChoice('canteen', 0, 1);
  assert.strictEqual(game.choiceLog.length, 2);

  const first = game.choiceLog[0];
  assert.strictEqual(first.semester, 1);
  assert.strictEqual(first.week, 1);
  assert.strictEqual(first.sceneId, 'library');
  assert.strictEqual(first.sceneName, '图书馆');
  assert.strictEqual(first.questTitle, EVENTS.library.quests[0].title);
  assert.strictEqual(first.choiceText, EVENTS.library.quests[0].choices[0].text);
  assert.strictEqual(first.repeat, false);
  assert.deepStrictEqual(first.effects, { knowledge: 8, energy: -12 });
  assert.deepStrictEqual(first.effects, result.applied);

  assert.strictEqual(game.choiceLog[1].week, 2);
  assert.strictEqual(game.choiceLog[1].sceneId, 'canteen');
});

test('重复体验的选择会标记为收益递减', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  game.applyChoice('library', 0, 0);
  assert.strictEqual(game.choiceLog.length, 2);
  assert.strictEqual(game.choiceLog[0].repeat, false);
  assert.strictEqual(game.choiceLog[1].repeat, true);
});

test('选择日志视图按时间倒序，并给出属性名称与变化量', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  game.applyChoice('canteen', 0, 0);
  const view = buildChoiceLogView(game.choiceLog);
  assert.strictEqual(view.length, 2);
  assert.strictEqual(view[0].sceneId, 'canteen');
  assert.strictEqual(view[1].sceneId, 'library');
  assert.strictEqual(view[1].semesterName, '大一上学期');
  assert.strictEqual(view[1].week, 1);
  assert.strictEqual(view[1].questTitle, EVENTS.library.quests[0].title);
  assert.strictEqual(view[1].choiceText, EVENTS.library.quests[0].choices[0].text);
  assert.deepStrictEqual(view[1].effects.map(item => item.name), ['学识', '精力']);
  assert.deepStrictEqual(view[1].effects.map(item => item.value), [8, -12]);
  assert.strictEqual(view[1].repeat, false);
  assert.strictEqual(view[1].repeatLabel, '首次体验');
});

test('种子码可双向转换，非法种子码会被拒绝', () => {
  const seed = decodeSeed('K7M2QX');
  assert.ok(Number.isInteger(seed) && seed >= 0);
  assert.strictEqual(encodeSeed(seed), 'K7M2QX');
  assert.strictEqual(decodeSeed('k7m2qx'), seed);
  assert.strictEqual(decodeSeed(' K7M2QX '), seed);
  assert.strictEqual(decodeSeed('K7M2Q'), null);
  assert.strictEqual(decodeSeed('K7M2Q0'), null);
  assert.strictEqual(decodeSeed('K7M2QI'), null);
  assert.strictEqual(decodeSeed(''), null);
  assert.strictEqual(decodeSeed(null), null);
});

test('同一个种子产生同一串随机数，不同种子产生不同序列', () => {
  const draw = code => { const rng = createRng(decodeSeed(code)); return [rng(), rng(), rng()]; };
  const first = draw('K7M2QX');
  assert.deepStrictEqual(first, draw('K7M2QX'));
  assert.notDeepStrictEqual(first, draw('R4T8WA'));
  first.forEach(value => assert.ok(value >= 0 && value < 1));
});

test('同一个种子码开局，期末抽到同一套考题', () => {
  const first = new GameCore('lin', 'K7M2QX');
  const second = new GameCore('lin', 'K7M2QX');
  while (!first.examReady) first.applyChoice('library', 0, 0);
  while (!second.examReady) second.applyChoice('library', 0, 0);
  const questions = first.startExam();
  const mirrored = second.startExam();
  assert.strictEqual(questions.length, 5);
  assert.strictEqual(new Set(questions.map(q => q.question)).size, 5);
  assert.deepStrictEqual(questions.map(q => q.question), mirrored.map(q => q.question));
  assert.strictEqual(first.seedCode, 'K7M2QX');
});

test('同一个种子码跑完四年，得到完全相同的一局', () => {
  const playFourYears = code => {
    const game = new GameCore('lin', code);
    const script = [['library', 0, 0], ['library', 1, 1], ['canteen', 0, 0], ['canteen', 1, 1], ['lab', 0, 0], ['dorm', 0, 0]];
    const exams = [];
    for (let semester = 1; semester <= 8; semester++) {
      while (!game.examReady) {
        const [scene, quest, choice] = script[(game.week - 1) % script.length];
        game.applyChoice(scene, quest, choice);
      }
      const questions = game.startExam();
      exams.push(questions.map(q => q.question).join('|'));
      questions.forEach(q => game.answerExam(q.answer));
      game.finishExam();
    }
    return {
      stats: { ...game.stats }, energy: game.energy, examScores: [...game.examScores],
      exams, ending: game.ending.id, seedCode: game.seedCode,
      choices: game.serialize().choiceLog.length
    };
  };

  const first = playFourYears('K7M2QX');
  assert.deepStrictEqual(first, playFourYears('K7M2QX'));
  assert.strictEqual(first.choices, 32);
  assert.notDeepStrictEqual(first.exams, playFourYears('R4T8WA').exams);
});

test('对局状态序列化会带上种子码与完整的选择日志', () => {
  const game = new GameCore('lin', 'K7M2QX');
  game.applyChoice('library', 0, 0);
  game.applyChoice('canteen', 0, 0);
  const state = game.serialize();
  assert.strictEqual(state.seedCode, 'K7M2QX');
  assert.strictEqual(state.choiceLog.length, 2);
  assert.strictEqual(state.choiceLog[0].sceneId, 'library');
});

test('引擎与数据层不出现非确定性随机来源', () => {
  ['engine', 'data'].forEach(dir => {
    const files = fs.readdirSync(path.join(__dirname, '../miniprogram', dir)).filter(file => file.endsWith('.js'));
    files.forEach(file => {
      const source = fs.readFileSync(path.join(__dirname, '../miniprogram', dir, file), 'utf8');
      assert.ok(!/Math\.random|Date\.now|new Date\(/.test(source), `${dir}/${file} 出现了非确定性随机`);
    });
  });
});

test('铸新种子码必须由调用方给熵，引擎自己不掷骰子', () => {
  assert.throws(() => randomSeedCode(), /熵源/);
  assert.strictEqual(randomSeedCode(() => 0), '222222');
  assert.notStrictEqual(randomSeedCode(() => 0.999999), '222222');
});

test('种子码输入规则共用一份：留空、合法、非法各有各的走法', () => {
  assert.deepStrictEqual(resolveSeedInput(''), { blank: true });
  assert.deepStrictEqual(resolveSeedInput('   '), { blank: true });
  assert.strictEqual(resolveSeedInput('k7m2qx').code, 'K7M2QX');
  assert.ok(resolveSeedInput('K7M2QI').error);

  const blank = applySeedInput('', () => 0.5);
  assert.strictEqual(blank.code.length, 6);
  assert.ok(blank.hint);
  assert.ok(applySeedInput('K7M2QX', () => 0.5).code === 'K7M2QX');
  assert.ok(applySeedInput('K7M2QI', () => 0.5).error);
});

test('随机序列可以存取状态，好让一局的中途存档被还原', () => {
  const rng = createRng(decodeSeed('K7M2QX'));
  rng(); rng();
  const state = rng.getState();
  const expected = [rng(), rng()];
  const resumed = createRng(decodeSeed('K7M2QX'));
  resumed.setState(state);
  assert.deepStrictEqual([resumed(), resumed()], expected);
});

test('对局存档可以还原成同一局', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const restored = GameCore.restore(game.serialize());
  assert.strictEqual(restored.seedCode, SEED);
  assert.deepStrictEqual(restored.stats, game.stats);
  assert.strictEqual(restored.week, game.week);
  assert.strictEqual(restored.choiceLog.length, 1);

  const play = core => {
    while (!core.examReady) core.applyChoice('canteen', 0, 0);
    const questions = core.startExam();
    questions.forEach(q => core.answerExam(q.answer));
    const outcome = core.finishExam();
    return { exam: questions.map(q => q.question).join('|'), score: outcome.semesterResult.score, stats: { ...core.stats } };
  };
  assert.deepStrictEqual(play(restored), play(game));
});

test('属性名字由 statName 统一给出，两端口径一致', () => {
  assert.strictEqual(statName('energy'), '精力');
  assert.strictEqual(statName('knowledge'), '学识');
  assert.strictEqual(statName('mood'), '心态');
});

test('世界边界和建筑碰撞可阻挡人物，移动更新会改变位置', () => {
  const world = new CampusWorld();
  assert.strictEqual(world.collides(10, 500), true);
  assert.strictEqual(world.collides(1000, 200), true); // 图书馆区域
  assert.strictEqual(world.collides(1000, 800), false);
  world.setInput(1, 0); world.update(300);
  assert.ok(world.player.x > 1370);
});

console.log(`\nAll ${passed} gameplay tests passed.`);
