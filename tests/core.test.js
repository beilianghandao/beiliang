const assert = require('assert');
const { CHARACTERS, EVENTS, STAT_META, ENDINGS, ENDING_RULES, getExamQuestions, semesterLabel } = require('../miniprogram/data/content');
const { ACHIEVEMENTS, buildAchievementList } = require('../miniprogram/data/achievements');
const { GameCore, EXAM_QUESTION_MS } = require('../miniprogram/engine/core');
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

test('每个场景有至少 5 个、最终 8 个任务问答，共 64 段故事且选项合法', () => {
  const questIds = new Set();
  Object.values(EVENTS).forEach(scene => {
    assert.ok(scene.art && scene.art.motif, scene.name);
    assert.ok(Array.isArray(scene.art.sky) && scene.art.sky.length === 2, scene.name);
    assert.ok(scene.quests.length >= 5, scene.name);
    assert.strictEqual(scene.quests.length, 8, scene.name);
    scene.quests.forEach(quest => {
      assert.ok(quest.title && quest.text, quest.id);
      assert.ok(!questIds.has(quest.id), `重复剧情 ID：${quest.id}`);
      questIds.add(quest.id);
      assert.ok(quest.choices.length >= 2, quest.id);
      assert.ok(Array.isArray(quest.rounds) && quest.rounds.length >= 5, `${quest.id} 至少需要五轮问答`);
      quest.rounds.forEach((round, roundIndex) => {
        assert.ok(round.text && round.choices.length >= 2, `${quest.id}:round-${roundIndex + 1}`);
        round.choices.forEach(choice => {
          Object.keys(choice.effects).forEach(key => {
            const known = key === 'energy' || Object.keys(STAT_META).includes(key);
            assert.ok(known, `${quest.id}:round-${roundIndex + 1}:${key}`);
          });
        });
      });
      assert.strictEqual(quest.rounds[quest.rounds.length - 1].choices, quest.choices, `${quest.id} 最后一轮必须对应原最终选择`);
      quest.choices.forEach(choice => {
        Object.keys(choice.effects).forEach(key => {
          const known = key === 'energy' || Object.keys(STAT_META).includes(key);
          assert.ok(known, `${quest.id}:${key}`);
        });
      });
    });
  });
  assert.strictEqual(questIds.size, 64);
});

test('首次完成任务会成长并推进一周', () => {
  const game = new GameCore('lin');
  const result = game.applyChoice('library', 0, 0);
  assert.ok(result && result.reply);
  assert.strictEqual(game.stats.knowledge, 54);
  assert.strictEqual(game.week, 2);
});

test('剧情过程问答至少四轮轻量成长，最终轮才推进周数并完成任务', () => {
  const game = new GameCore('lin');
  const quest = EVENTS.library.quests[0];
  for (let round = 0; round < quest.rounds.length - 1; round++) {
    const result = game.applyDialogueChoice('library', 0, round, 0);
    assert.ok(result && result.reply, `第 ${round + 1} 轮`);
    assert.strictEqual(game.week, 1);
    assert.strictEqual(game.completed.length, 0);
  }
  const final = game.applyChoice('library', 0, 0);
  assert.ok(final && final.reply);
  assert.strictEqual(game.week, 2);
  assert.strictEqual(game.completed.length, 1);
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

test('每学期 8 周后进入期末，考完进入下一学期', () => {
  const game = new GameCore('lin');
  for (let week = 1; week <= game.weeksPerSemester; week++) game.applyChoice('library', (week - 1) % 8, 0);
  assert.strictEqual(game.weeksPerSemester, 8);
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

test('35 种毕业结局均可由属性组合或特殊状态独立触发', () => {
  assert.ok(ENDINGS.length >= 30);
  assert.strictEqual(new Set(ENDINGS.map(ending => ending.id)).size, ENDINGS.length);
  const statKeys = ['knowledge', 'fitness', 'mood', 'social', 'practice'];
  const covered = new Set();
  const check = (expected, values, avg = 85) => {
    const game = new GameCore('lin');
    game.stats = Object.fromEntries(statKeys.map(key => [key, values[key]]));
    const ending = game.pickEnding(avg);
    assert.strictEqual(ending.id, expected, `${expected} 实际得到 ${ending.id}`);
    covered.add(ending.id);
  };
  const profile = combo => Object.fromEntries(statKeys.map(key => [key, combo.includes(key) ? 80 : 50]));
  ['single', 'pair', 'triple', 'quad'].forEach(group => {
    Object.entries(ENDING_RULES[group]).forEach(([combo, endingId]) => check(endingId, profile(combo.split('-'))));
  });
  check('renaissance', Object.fromEntries(statKeys.map(key => [key, 90])), 90);
  check('balanced', Object.fromEntries(statKeys.map(key => [key, 65])), 85);
  check('steady', Object.fromEntries(statKeys.map(key => [key, 55])), 70);
  check('rest', { knowledge: 60, fitness: 30, mood: 20, social: 60, practice: 60 }, 70);
  check('secondChance', Object.fromEntries(statKeys.map(key => [key, 40])), 40);
  check('ordinary', Object.fromEntries(statKeys.map(key => [key, 30])), 70);
  assert.strictEqual(covered.size, ENDINGS.length, `未覆盖结局：${ENDINGS.filter(e => !covered.has(e.id)).map(e => e.id).join(', ')}`);
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

// ---- 成就系统（用户故事 4：ACHV + 飘条 + 结算页柱状对比）----

test('成就 id 唯一、描述完整且判定函数均为纯函数', () => {
  assert.strictEqual(new Set(ACHIEVEMENTS.map(a => a.id)).size, ACHIEVEMENTS.length);
  ACHIEVEMENTS.forEach(a => {
    assert.ok(a.icon && a.name && a.desc, a.id);
    assert.ok(['bronze', 'silver', 'gold'].includes(a.tier), a.id);
    assert.strictEqual(typeof a.check, 'function', a.id);
    assert.strictEqual(typeof a.progress, 'function', a.id);
  });
});

test('完成首段故事解锁「初次启程」，重复行动不会重复解锁', () => {
  const game = new GameCore('lin');
  assert.strictEqual(game.achievements.length, 0);
  game.applyChoice('library', 0, 0);
  assert.ok(game.achievements.includes('first-story'));
  assert.strictEqual(game.pendingAchievements.length, game.achievements.length);
  game.applyChoice('library', 1, 0);
  assert.strictEqual(game.achievements.filter(id => id === 'first-story').length, 1);
  const toast = game.consumePendingAchievement();
  assert.ok(toast && toast.icon && toast.name);
});

test('成就判定基于快照：属性与精力达标即可解锁并进入飘条队列', () => {
  const game = new GameCore('chen');
  game.stats.knowledge = 85;
  game.energy = 100;
  const fresh = game.checkAchievements();
  assert.ok(fresh.some(a => a.id === 'stat-knowledge'));
  assert.ok(fresh.some(a => a.id === 'full-energy'));
  assert.strictEqual(game.pendingAchievements.length, fresh.length);
  const list = buildAchievementList(game.achievementSnapshot(), game.achievements);
  assert.strictEqual(list.length, ACHIEVEMENTS.length);
  assert.ok(list.find(item => item.id === 'stat-knowledge').unlocked);
});

test('期末考全对解锁「全对答卷」与「从容应考」', () => {
  const game = new GameCore('chen');
  while (!game.examReady) game.applyChoice('library', 0, 0);
  const questions = game.startExam();
  questions.forEach(q => game.answerExam(q.answer));
  const outcome = game.finishExam();
  assert.ok(outcome.semesterResult);
  assert.ok(game.achievements.includes('exam-perfect'));
  assert.ok(game.achievements.includes('exam-no-timeout'));
  assert.strictEqual(game.calmExams, 1);
});

test('毕业时解锁「顺利毕业」并把成就进度写入存档', () => {
  const game = new GameCore('chen');
  for (let semester = 1; semester <= 8; semester++) {
    while (!game.examReady) game.applyChoice('library', 0, 0);
    const questions = game.startExam();
    questions.forEach(q => game.answerExam(q.answer));
    game.finishExam();
  }
  assert.ok(game.achievements.includes('graduate'));
  assert.ok(game.pendingAchievements.includes('graduate'));
  const saved = game.serialize();
  assert.ok(Array.isArray(saved.achievements) && saved.achievements.includes('graduate'));
  assert.ok(Array.isArray(saved.achievementLog));
});

// ---- 期末考倒计时（用户故事 3：限时答题，超时按错算）----

test('倒计时耗尽后：作答与自动超时都按错记录并推进题目', () => {
  const game = new GameCore('lin');
  while (!game.examReady) game.applyChoice('library', 0, 0);
  const questions = game.startExam();
  assert.strictEqual(game.examTimer.remaining, EXAM_QUESTION_MS);

  const state = game.tickExam(Date.now() + EXAM_QUESTION_MS + 1000);
  assert.ok(state.timedOut);

  // 超时后点击选项：同样按超时判错
  const late = game.answerExam(questions[0].answer, Date.now() + EXAM_QUESTION_MS + 2000);
  assert.ok(late.timedOut);
  assert.strictEqual(game.examAnswers[0], -1);
  assert.strictEqual(game.examTimeouts, 1);

  questions.slice(1).forEach(q => game.answerExam(q.answer));
  const outcome = game.finishExam();
  assert.strictEqual(outcome.semesterResult.correct, 4);
  assert.strictEqual(outcome.semesterResult.timeouts, 1);
  assert.strictEqual(game.calmExams, 0);
  assert.ok(outcome.semesterResult.examScores.length === 1);
});

test('切后台暂停计时：暂停期间倒计时不再流逝，恢复后继续', () => {
  const game = new GameCore('lin');
  while (!game.examReady) game.applyChoice('library', 0, 0);
  game.startExam();
  const pausedAt = Date.now();
  game.pauseExam(pausedAt); // 模拟 onHide
  const frozen = game.tickExam(pausedAt + 60000);
  assert.ok(!frozen.running);
  assert.ok(frozen.remaining > EXAM_QUESTION_MS - 1000, '暂停期间倒计时不应该流逝');

  game.resumeExam(pausedAt + 60000); // 模拟 onShow
  const resumed = game.tickExam(pausedAt + 60000 + 5000);
  assert.ok(Math.abs(resumed.remaining - (EXAM_QUESTION_MS - 5000)) < 500);
});

test('每题作答后倒计时重置为完整时长', () => {
  const game = new GameCore('lin');
  while (!game.examReady) game.applyChoice('library', 0, 0);
  const questions = game.startExam();
  game.answerExam(questions[0].answer);
  assert.strictEqual(game.examTimer.remaining, EXAM_QUESTION_MS);
  assert.strictEqual(game.examAnswers.length, 1);
});

console.log(`\nAll ${passed} gameplay tests passed.`);
