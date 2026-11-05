const assert = require('assert');
const { CHARACTERS, EVENTS, STAT_META, ENDINGS, getExamQuestions, semesterLabel } = require('../miniprogram/data/content');
const { GameCore } = require('../miniprogram/engine/core');
const { CampusWorld } = require('../miniprogram/engine/world');

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
  const game = new GameCore('lin');
  const result = game.applyChoice('library', 0, 0);
  assert.ok(result && result.reply);
  assert.strictEqual(game.stats.knowledge, 54);
  assert.strictEqual(game.week, 2);
});

test('重复完成任务收益递减且不重复计数', () => {
  const game = new GameCore('lin');
  game.applyChoice('library', 0, 0);
  const repeat = game.applyChoice('library', 0, 0);
  assert.ok(repeat.repeat);
  assert.ok(repeat.applied.knowledge <= 4);
  assert.strictEqual(game.completed.filter(key => key === 'library:0').length, 1);
});

test('同一场景的第二个任务独立计数', () => {
  const game = new GameCore('lin');
  game.applyChoice('library', 0, 0);
  game.applyChoice('library', 1, 0);
  assert.strictEqual(game.completed.length, 2);
  assert.ok(game.completed.includes('library:1'));
});

test('角色特长：陈屿学识加成与林知夏人缘加成生效', () => {
  const chen = new GameCore('chen'); chen.applyChoice('library', 0, 0);
  assert.strictEqual(chen.stats.knowledge, 60 + 8 + 2);
  const lin = new GameCore('lin'); lin.applyChoice('library', 0, 1);
  assert.strictEqual(lin.stats.social, 54 + 6 + 1);
});

test('每学期 4 周后进入期末，考完进入下一学期', () => {
  const game = new GameCore('lin');
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
  const game = new GameCore('lin');
  game.applyChoice('library', 0, 0);
  assert.strictEqual(game.startExam(), null);
});

test('连续八个学期后触发毕业结局并返回四年均分', () => {
  const game = new GameCore('chen');
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
    const game = new GameCore('lin'); game.stats = { ...stats };
    const ending = game.pickEnding(85);
    assert.strictEqual(ending.id, id);
  });
  const weak = new GameCore('lin'); weak.stats = { knowledge: 20, fitness: 20, mood: 20, social: 20, practice: 20 };
  assert.strictEqual(weak.pickEnding(50).id, 'ordinary');
});

test('题库每学期轮换 5 题，共 10 题覆盖四个年级', () => {
  assert.strictEqual(getExamQuestions(1).length, 5);
  assert.strictEqual(getExamQuestions(5).length, 5);
  assert.strictEqual(semesterLabel(1), '大一上学期');
  assert.strictEqual(semesterLabel(4), '大二下学期');
  assert.strictEqual(semesterLabel(6), '大三下学期');
  assert.strictEqual(semesterLabel(7), '大四上学期');
  assert.strictEqual(semesterLabel(8), '大四下学期');
});

test('高消耗路线会消耗精力，江野拥有额外恢复', () => {
  const normal = new GameCore('lin'); normal.applyChoice('lab', 0, 0);
  const jiang = new GameCore('jiang'); jiang.applyChoice('lab', 0, 0);
  assert.ok(normal.energy < jiang.energy);
  assert.strictEqual(jiang.energy, 82 - 16 + 10 + 8);
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
