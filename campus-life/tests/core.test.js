const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CHARACTERS, EVENTS, STAT_META, ENDINGS, REQUESTS, CHAIN_EVENTS, LEGACY_OPTIONS, HIDDEN_EVENTS, EXAM_BANK, getExamQuestions, semesterLabel, statName } = require('../miniprogram/data/content');
const { GameCore, pickExamQuestions } = require('../miniprogram/engine/core');
const { CampusWorld } = require('../miniprogram/engine/world');
const { buildChoiceLogView } = require('../miniprogram/engine/choicelog');
const { createRng, decodeSeed, encodeSeed, randomSeedCode, resolveSeedInput, applySeedInput } = require('../miniprogram/engine/random');
const Save = require('../miniprogram/engine/save');

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
  // 32 次主线选择 + 隐藏事件触发的额外记录（合并周目/因果分支后）
  assert.strictEqual(first.choices, 40);
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
      // save.js 是存储层：写存档时要记时间戳，允许它用 new Date()
      if (dir === 'engine' && file === 'save.js') return;
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

// ============ 请求事件调度器 ============

test('请求调度器会把符合条件的请求排给 NPC 上门', () => {
  const game = new GameCore('lin', SEED);
  assert.strictEqual(game.requests.length, 0, '开局不该有人来敲门');
  const result = game.applyChoice('library', 0, 0);
  assert.ok(result.request, '第一次行动后应当有请求上门');
  assert.strictEqual(game.requests.length, 1);
  assert.strictEqual(game.requests[0].id, result.request.id);
  assert.strictEqual(game.requests[0].npc, result.request.npc);
});

test('答应请求加好感度，拒绝则掉好感度', () => {
  const game = new GameCore('lin', SEED);
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
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  const refused = game.resolveRequest(request.id, 1);
  assert.ok(refused.affinity < 0);
  assert.strictEqual(game.affinityOf(request.npc), refused.affinity);
});

test('好感度达到门槛才解锁更高级的请求', () => {
  const game = new GameCore('lin', SEED);
  game.semester = 3;
  game.affinity.npc1 = 29;
  assert.ok(!game.eligibleRequests().some(item => item.id === 'req-npc1-b'));
  game.affinity.npc1 = 30;
  assert.ok(game.eligibleRequests().some(item => item.id === 'req-npc1-b'));
});

test('请求拖太久没人管，NPC 会走并掉好感度', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  const before = game.affinityOf(request.npc);
  for (let i = 0; i < 4; i++) game.applyChoice('library', 0, 0);
  assert.ok(game.affinityOf(request.npc) < before, '被放鸽子的关系应该变差');
});

test('关系维护到位时，同一个 NPC 场景的行动收益更高', () => {
  const cold = new GameCore('lin', SEED); cold.applyChoice('library', 0, 0);
  const warm = new GameCore('lin', SEED); warm.affinity.npc1 = 30; warm.applyChoice('library', 0, 0);
  assert.strictEqual(cold.stats.knowledge, 46 + 8);
  assert.strictEqual(warm.stats.knowledge, 46 + Math.round(8 * 1.3));
});

// ============ chain 字段与延迟触发队列 ============

test('翘课的连锁事件排进延迟队列，不会当场发作', () => {
  const game = new GameCore('lin', SEED);
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

  const game = new GameCore('lin', SEED);
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
  const game = new GameCore('lin', SEED);
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

// ============ 周目继承 ============

test('继承遗物：属性型遗物开局生效，并写进因果记录', () => {
  const plain = new GameCore('lin', SEED);
  const inherited = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-notes' });
  assert.strictEqual(inherited.stats.knowledge, plain.stats.knowledge + 8);
  assert.strictEqual(inherited.playthrough, 2);
  assert.strictEqual(inherited.legacyId, 'legacy-notes');
  assert.strictEqual(inherited.choiceLog[0].type, 'legacy');
  assert.strictEqual(inherited.choiceLog[0].effects.knowledge, 8);
});

test('继承道具：通讯录给所有同学初始好感，护腕每周多恢复精力', () => {
  const book = new GameCore('lin', { seedCode: SEED, legacyId: 'legacy-addressbook' });
  assert.strictEqual(book.affinityOf('npc1'), 12);
  assert.strictEqual(book.affinityTierOf('npc1').name, '熟悉');
  const base = new GameCore('lin', SEED); base.applyChoice('library', 0, 0);
  const wrist = new GameCore('lin', { seedCode: SEED, legacyId: 'legacy-wristband' }); wrist.applyChoice('library', 0, 0);
  assert.strictEqual(wrist.energy - base.energy, 4);
});

test('没继承对应遗物时，隐藏事件是锁着的，也进不去', () => {
  const game = new GameCore('lin', SEED);
  const hidden = game.sceneProgress('library').filter(item => item.hidden);
  assert.strictEqual(hidden.length, 1);
  assert.strictEqual(hidden[0].locked, true);
  assert.ok(hidden[0].requireText.includes('错题本'));
  assert.strictEqual(game.applyChoice('library', hidden[0].index, 0), null);
});

test('继承遗物并完成前置任务后，隐藏事件显形且能完成', () => {
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-notes' });
  assert.strictEqual(game.sceneProgress('library').filter(item => item.hidden)[0].locked, true, '前置任务没做时仍锁着');
  game.applyChoice('library', 0, 0);
  const hidden = game.sceneProgress('library').filter(item => item.hidden)[0];
  assert.strictEqual(hidden.locked, false);
  const result = game.applyChoice('library', hidden.index, 0);
  assert.ok(result && result.hidden, '隐藏事件应当能正常结算');
  assert.ok(game.hiddenCleared.includes('hidden-lib-margin'));
  assert.ok(game.completed.includes(`library:${hidden.index}`));
});

test('每个隐藏事件都有合法选项、可接场景美术，并且绑定一件遗物', () => {
  Object.keys(HIDDEN_EVENTS).forEach(sceneId => {
    assert.ok(EVENTS[sceneId], `${sceneId} 场景必须存在`);
    HIDDEN_EVENTS[sceneId].forEach(def => {
      assert.ok(def.title && def.text, def.id);
      assert.ok(def.choices.length >= 2, def.id);
      assert.ok(LEGACY_OPTIONS.some(option => option.id === def.requires), `${def.id} 的遗物必须存在`);
      def.choices.forEach(choice => {
        Object.keys(choice.effects).forEach(key => {
          assert.ok(key === 'energy' || Object.keys(STAT_META).includes(key), `${def.id}:${key}`);
        });
      });
    });
  });
  // 每件遗物都要能打开一个隐藏事件，继承才有意义
  LEGACY_OPTIONS.forEach(option => {
    const opened = Object.keys(HIDDEN_EVENTS).some(sceneId => HIDDEN_EVENTS[sceneId].some(def => def.id === option.hiddenEvent));
    assert.ok(opened, option.id);
  });
});

// ============ 因果记录 ============

test('每次选择都会写进 choiceLog，并带上当场的影响', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const entry = game.choiceLog[game.choiceLog.length - 1];
  assert.strictEqual(entry.type, 'quest');
  assert.strictEqual(entry.title, '闭馆音乐响起之前');
  assert.ok(entry.choice.length > 0);
  assert.ok(entry.effects.knowledge > 0);
  assert.ok(entry.tags.includes('学识'));
  assert.ok(entry.at.includes('第'));
  assert.strictEqual(entry.semester, 1);
});

test('因果记录覆盖任务、请求、连锁后果三类选择点', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('classroom', 0, 2);   // 埋下连锁
  game.applyChoice('library', 0, 0);     // 推进一周，点名发作
  game.resolveChain('roll-call', 0);
  const request = game.pendingRequests()[0];
  assert.ok(request, '应该有请求上门');
  game.resolveRequest(request.id, 0);
  const types = game.choiceLog.map(entry => entry.type);
  ['quest', 'chain', 'request'].forEach(type => assert.ok(types.includes(type), type));
  const requestEntry = game.choiceLog.find(entry => entry.type === 'request');
  assert.ok(requestEntry.affinity && requestEntry.affinity.name, '关系类选择要记下好感变化');
});

test('埋下的后果发作后，会回头标注在当初那个选择上', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('classroom', 0, 2);
  const origin = game.choiceLog.find(entry => entry.title === '被点名的三分钟');
  assert.ok(origin, '产生后果的那次选择必须留在记录里');
  assert.strictEqual(origin.consequences.length, 1);
  assert.strictEqual(origin.consequences[0].fired, false);
  assert.ok(origin.note.includes('点名'));
  game.applyChoice('library', 0, 0);
  assert.strictEqual(origin.consequences[0].fired, true);
});

test('causeReport 汇总属性总量、分类计数与还没发作的后果', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('classroom', 0, 2);
  const report = game.causeReport();
  assert.strictEqual(report.counts.quest, 1);
  assert.ok(report.totals.mood > 0);
  assert.strictEqual(report.pending.length, 1, '延迟队列里的后果要提前告知');
  assert.ok(report.pending[0].title.includes('点名'));
  assert.strictEqual(report.entries.length, 1);
  assert.ok(report.hidden.total >= 5);
});

test('考试也会写进因果记录，期末成绩算作学业影响', () => {
  const game = new GameCore('lin', SEED);
  ['library:0', 'library:1', 'canteen:0', 'canteen:1'].forEach(pair => {
    const [scene, quest] = pair.split(':'); game.applyChoice(scene, Number(quest), 0);
  });
  const questions = game.startExam();
  questions.forEach(q => game.answerExam(q.answer));
  game.finishExam();
  const examEntry = game.choiceLog.find(entry => entry.type === 'exam');
  assert.ok(examEntry);
  assert.ok(examEntry.choice.includes('答对'));
});

test('存档字段包含周目、继承遗物与整份因果记录', () => {
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-letter' });
  game.applyChoice('library', 0, 0);
  const saved = game.serialize();
  assert.strictEqual(saved.playthrough, 2);
  assert.strictEqual(saved.legacyId, 'legacy-letter');
  assert.ok(Array.isArray(saved.choiceLog) && saved.choiceLog.length >= 2);
  assert.ok(Array.isArray(saved.hiddenCleared));
});

// ============ 跨周目存档 ============

function fakeStore() {
  const data = {};
  return { type: 'fake', get: key => (key in data ? data[key] : null), set: (key, value) => { data[key] = value; }, remove: key => { delete data[key]; } };
}

test('存档：一局结束后记下周目数、最高属性与隐藏事件，并据此解锁继承项', () => {
  const store = fakeStore();
  const game = new GameCore('chen', SEED);
  game.stats = { knowledge: 78, fitness: 40, mood: 50, social: 30, practice: 55 };
  game.ending = { id: 'scholar', title: '群星之间的求知者', tag: '学术深造', score: 88 };
  game.hiddenCleared = ['hidden-lib-margin'];
  const meta = Save.recordRun(game, store);
  assert.strictEqual(meta.playthroughs, 1);
  assert.strictEqual(meta.lastEnding.id, 'scholar');
  assert.strictEqual(Save.readMeta(store).bestStats.knowledge, 78, '最高属性要落盘');
  assert.ok(meta.hiddenEvents.includes('hidden-lib-margin'));
  const options = Save.legacyOptions(meta);
  assert.strictEqual(options.find(option => option.id === 'legacy-notes').unlocked, true);
  assert.strictEqual(options.find(option => option.id === 'legacy-wristband').unlocked, false);
  assert.strictEqual(options.find(option => option.id === 'legacy-letter').unlocked, true, '毕业即解锁的保底项');
  assert.strictEqual(Save.defaultLegacy(meta), 'legacy-notes');
});

test('存档：第二周目结束后周目数继续累加，最高属性只升不降', () => {
  const store = fakeStore();
  const first = new GameCore('lin', SEED);
  first.stats = { knowledge: 72, fitness: 50, mood: 50, social: 50, practice: 50 };
  first.ending = { id: 'scholar', title: 'A', tag: 't', score: 80 };
  Save.recordRun(first, store);
  const second = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-notes' });
  second.stats = { knowledge: 60, fitness: 90, mood: 50, social: 50, practice: 50 };
  second.ending = { id: 'sunshine', title: 'B', tag: 't', score: 90 };
  const meta = Save.recordRun(second, store);
  assert.strictEqual(meta.playthroughs, 2);
  assert.strictEqual(meta.bestStats.knowledge, 72, '旧的最好成绩不能被覆盖');
  assert.strictEqual(meta.bestStats.fitness, 90);
  assert.deepStrictEqual(meta.endings.sort(), ['scholar', 'sunshine']);
});

test('存档：清空后回到第一周目状态', () => {
  const store = fakeStore();
  const game = new GameCore('lin', SEED);
  game.ending = { id: 'ordinary', title: 'C', tag: 't', score: 60 };
  Save.recordRun(game, store);
  assert.strictEqual(Save.readMeta(store).playthroughs, 1);
  Save.clearMeta(store);
  const meta = Save.readMeta(store);
  assert.strictEqual(meta.playthroughs, 0);
  assert.strictEqual(Save.defaultLegacy(meta), null, '没走完过任何一局时没有可继承的东西');
});

console.log(`\nAll ${passed} gameplay tests passed.`);
