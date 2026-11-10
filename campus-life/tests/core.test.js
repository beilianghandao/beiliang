const assert = require('assert');
const { CHARACTERS, EVENTS, STAT_META, ENDINGS, REQUESTS, CHAIN_EVENTS, getExamQuestions, semesterLabel } = require('../miniprogram/data/content');
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

// ============ 请求事件调度器 ============

test('请求调度器会把符合条件的请求排给 NPC 上门', () => {
  const game = new GameCore('lin');
  assert.strictEqual(game.requests.length, 0, '开局不该有人来敲门');
  const result = game.applyChoice('library', 0, 0);
  assert.ok(result.request, '第一次行动后应当有请求上门');
  assert.strictEqual(game.requests.length, 1);
  assert.strictEqual(game.requests[0].id, result.request.id);
  assert.strictEqual(game.requests[0].npc, result.request.npc);
});

test('答应请求加好感度，拒绝则掉好感度', () => {
  const game = new GameCore('lin');
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  const accepted = game.resolveRequest(request.id, 0);
  assert.ok(accepted.affinity > 0);
  assert.strictEqual(game.affinityOf(request.npc), accepted.affinity);
  assert.strictEqual(game.requests.length, 0);
  assert.ok(game.resolvedRequests.includes(request.id));
  // 同一个请求不会再来第二次
  game.applyChoice('library', 0, 0);
  assert.ok(!game.pendingRequests().some(item => item.id === request.id));
});

test('拒绝请求会拉低好感度', () => {
  const game = new GameCore('lin');
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  const refused = game.resolveRequest(request.id, 1);
  assert.ok(refused.affinity < 0);
  assert.strictEqual(game.affinityOf(request.npc), refused.affinity);
});

test('好感度达到门槛才解锁更高级的请求', () => {
  const game = new GameCore('lin');
  game.semester = 3;
  game.affinity.npc1 = 29;
  assert.ok(!game.eligibleRequests().some(item => item.id === 'req-npc1-b'));
  game.affinity.npc1 = 30;
  assert.ok(game.eligibleRequests().some(item => item.id === 'req-npc1-b'));
});

test('请求拖太久没人管，NPC 会走并掉好感度', () => {
  const game = new GameCore('lin');
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  const before = game.affinityOf(request.npc);
  for (let i = 0; i < 4; i++) game.applyChoice('library', 0, 0);
  assert.ok(game.affinityOf(request.npc) < before, '被放鸽子的关系应该变差');
});

test('关系维护到位时，同一个 NPC 场景的行动收益更高', () => {
  const cold = new GameCore('lin'); cold.applyChoice('library', 0, 0);
  const warm = new GameCore('lin'); warm.affinity.npc1 = 30; warm.applyChoice('library', 0, 0);
  assert.strictEqual(cold.stats.knowledge, 46 + 8);
  assert.strictEqual(warm.stats.knowledge, 46 + Math.round(8 * 1.3));
});

// ============ chain 字段与延迟触发队列 ============

test('翘课的连锁事件排进延迟队列，不会当场发作', () => {
  const game = new GameCore('lin');
  const result = game.applyChoice('classroom', 0, 2);   // 从后门溜出去
  assert.ok(result.chained, '这个选择应该埋下后果');
  assert.strictEqual(game.triggers.length, 1);
  assert.strictEqual(game.triggers[0].eventId, 'roll-call');
  assert.strictEqual(game.pendingChains.length, 0, '不能当场发作');
});

test('连锁事件按周数依次发作：点名 → 辅导员谈话 → 家长来电', () => {
  // 往前推进一周；撞上期末就先考完，让时间继续走
  const advance = game => {
    if (game.examReady) {
      const questions = game.startExam();
      questions.forEach(q => game.answerExam(q.answer));
      game.finishExam();
      return;
    }
    game.applyChoice('library', 0, 0);
  };

  const game = new GameCore('lin');
  game.applyChoice('classroom', 0, 2);
  assert.deepStrictEqual(game.pendingChains, []);

  advance(game);                                         // 点名发作
  assert.deepStrictEqual(game.pendingChains, ['roll-call']);
  assert.strictEqual(game.triggers[0].eventId, 'counselor-talk', '下一级应自动排队');
  assert.strictEqual(game.triggers[0].fireAt, game.absoluteWeek + 2);

  advance(game);                                         // 还没到
  assert.deepStrictEqual(game.pendingChains, ['roll-call']);

  advance(game);                                         // 辅导员谈话发作
  assert.deepStrictEqual(game.pendingChains, ['roll-call', 'counselor-talk']);
  assert.strictEqual(game.triggers[0].eventId, 'parent-call');

  advance(game);                                         // 还没到
  advance(game);                                         // 家长来电发作
  assert.deepStrictEqual(game.pendingChains, ['roll-call', 'counselor-talk', 'parent-call']);
  assert.strictEqual(game.triggers.length, 0, '链子到第三级就该停');
});

test('连锁事件处理后从待办里消失，且不能重复结算', () => {
  const game = new GameCore('lin');
  game.applyChoice('classroom', 0, 2);
  game.applyChoice('library', 0, 0);
  const outcome = game.resolveChain('roll-call', 0);
  assert.ok(outcome.reply);
  assert.ok(outcome.applied);
  assert.ok(!game.pendingChains.includes('roll-call'));
  assert.strictEqual(game.resolveChain('roll-call', 0), null);
});

test('连锁事件每一级都有选项，且能接到对应的场景美术', () => {
  ['roll-call', 'counselor-talk', 'parent-call'].forEach(id => {
    const event = CHAIN_EVENTS[id];
    assert.ok(event, id);
    assert.ok(event.title && event.text, id);
    assert.ok(event.choices.length >= 2, id);
    assert.ok(EVENTS[event.scene], `${id} 的场景 ${event.scene} 必须存在`);
    event.choices.forEach(choice => {
      Object.keys(choice.effects).forEach(key => {
        assert.ok(key === 'energy' || Object.keys(STAT_META).includes(key), `${id}:${key}`);
      });
    });
  });
  assert.strictEqual(CHAIN_EVENTS['roll-call'].next, 'counselor-talk');
  assert.strictEqual(CHAIN_EVENTS['counselor-talk'].next, 'parent-call');
  assert.strictEqual(CHAIN_EVENTS['parent-call'].next, null);
});

test('每个请求都有答应与拒绝两个分支，并写明好感度变化', () => {
  assert.ok(REQUESTS.length >= 8, '请求数量应该足够撑起四年');
  REQUESTS.forEach(request => {
    assert.ok(request.id && request.npc && request.title && request.text, request.id);
    assert.strictEqual(request.choices.length, 2, request.id);
    request.choices.forEach(choice => {
      assert.ok(choice.text && choice.reply, request.id);
      assert.ok(typeof choice.affinity === 'number' && choice.affinity !== 0, request.id);
      Object.keys(choice.effects).forEach(key => {
        assert.ok(key === 'energy' || Object.keys(STAT_META).includes(key), `${request.id}:${key}`);
      });
    });
  });
});

console.log(`\nAll ${passed} gameplay tests passed.`);
