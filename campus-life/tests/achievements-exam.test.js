/* 专项测试：成就系统（achievements）与期末考倒计时（exam timer）
 *
 * 覆盖两条能力：
 *   1. 成就系统——48 项常规成就 + 8 项隐藏成就；判定为纯函数，
 *      解锁走 pending 队列，隐藏成就在图鉴里默认遮罩，元成就需要两轮判定。
 *   2. 期末考倒计时——单题 30 秒限时，超时按错处理（记 -1），
 *      切后台暂停 / 回前台恢复；时间由调用方注入，引擎自身确定性可复现。
 */
const assert = require('assert');
const { GameCore, EXAM_QUESTION_MS } = require('../miniprogram/engine/core');
const { ACHIEVEMENTS, HIDDEN_ACHIEVEMENTS, evaluateAchievements, achievementById, buildAchievementList } = require('../miniprogram/data/achievements');

const SEED = 'K7M2QX';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}

// ---- 成就声明完整性 ----

test('成就总数 48 项，其中隐藏成就 8 项，且 id 无重复', () => {
  assert.strictEqual(ACHIEVEMENTS.length, 48);
  assert.strictEqual(HIDDEN_ACHIEVEMENTS.length, 8);
  const ids = ACHIEVEMENTS.map(item => item.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('每项成就都有 id / 类别 / 图标 / 等级 / 名称 / 描述 / 判定函数', () => {
  ACHIEVEMENTS.forEach(item => {
    assert.ok(item.id, '缺 id');
    assert.ok(item.cat, '缺 cat');
    assert.ok(item.icon, '缺 icon');
    assert.ok(['bronze', 'silver', 'gold'].includes(item.tier), '等级非法');
    assert.ok(item.name, '缺 name');
    assert.ok(item.desc, '缺 desc');
    assert.strictEqual(typeof item.check, 'function', '缺 check');
  });
});

test('成就类别覆盖 图鉴/成长/学业/生涯/隐藏 五类', () => {
  const cats = new Set(ACHIEVEMENTS.map(item => item.cat));
  ['story', 'growth', 'exam', 'career', 'secret'].forEach(c => assert.ok(cats.has(c), `缺类别 ${c}`));
});

// ---- 成就判定纯函数 ----

const SNAPSHOT_BASE = {
  stats: { knowledge: 0, fitness: 0, mood: 0, social: 0, practice: 0 },
  statKeys: ['knowledge', 'fitness', 'mood', 'social', 'practice'],
  energy: 82, energyLowReached: false,
  completedCount: 0, totalStories: 64, visitedScenes: 0, totalScenes: 8,
  sceneMaxCompleted: 0, sceneQuestTarget: 8, repeatedQuests: 0, maxVisited: 0,
  semestersFinished: 0, examScores: [], avgExamScore: 0, bestExamScore: 0,
  perfectExams: 0, calmExams: 0, perfectScoreExams: 0, minExamScore: 100, burnedExams: 0,
  graduated: false, endingId: null
};

test('evaluateAchievements 返回「应当解锁但尚未解锁」的成就', () => {
  const snapshot = { ...SNAPSHOT_BASE, completedCount: 1 };
  const fresh = evaluateAchievements(snapshot, []);
  const ids = fresh.map(item => item.id);
  assert.ok(ids.includes('first-story'), '初次启程应解锁');
  assert.ok(!ids.includes('story-16'), '故事收集者不应解锁');
});

test('已解锁的成就不会重复返回', () => {
  const snapshot = { ...SNAPSHOT_BASE, completedCount: 5 };
  const fresh = evaluateAchievements(snapshot, ['first-story']);
  assert.ok(!fresh.some(item => item.id === 'first-story'), '已解锁不应重复');
});

test('隐藏成就的判定函数同样生效', () => {
  const snapshot = { ...SNAPSHOT_BASE, perfectScoreExams: 1 };
  const fresh = evaluateAchievements(snapshot, []);
  assert.ok(fresh.some(item => item.id === 'secret-perfect'), '满分隐藏成就应被判定');
});

test('buildAchievementList 对未解锁的隐藏成就返回遮罩项', () => {
  const list = buildAchievementList({ ...SNAPSHOT_BASE }, []);
  const masked = list.filter(item => item.masked);
  assert.strictEqual(masked.length, HIDDEN_ACHIEVEMENTS.length, '未解锁隐藏成就应全部遮罩');
  masked.forEach(item => {
    assert.strictEqual(item.icon, '？');
    assert.strictEqual(item.name, '？？？');
    assert.strictEqual(item.progress || 0, 0, '遮罩项进度应为 0');
    assert.ok(!item.desc.includes('满分') && !item.desc.includes('毕业'), '遮罩项不得泄露条件');
  });
});

test('buildAchievementList 对已解锁的隐藏成就显形', () => {
  const list = buildAchievementList({ ...SNAPSHOT_BASE }, ['secret-perfect']);
  const item = list.find(i => i.id === 'secret-perfect');
  assert.ok(item && !item.masked, '已解锁隐藏成就应显形');
  assert.ok(item.name && item.name !== '？？？', '显形后应有真名');
});

// ---- 引擎内成就解锁流程 ----

test('完成第一段故事后解锁「初次启程」并进入 pending 队列', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.applyChoice('library', 0, 0);
  assert.ok(game.achievements.includes('first-story'), '初次启程应已入账');
  const pending = game.consumePendingAchievement();
  assert.strictEqual(pending.id, 'first-story');
});

test('元成就「图鉴完全体」需要两轮判定才解锁', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  // 直接把除元成就外的全部成就标记为已解锁，只留 secret-complete 未解锁
  game.achievements = ACHIEVEMENTS.filter(item => item.id !== 'secret-complete').map(item => item.id);
  const fresh = game.checkAchievements();
  assert.ok(fresh.some(item => item.id === 'secret-complete'), '图鉴完全体应通过两轮判定解锁');
});

test('精力跌破 20 会标记 energyLowReached（极限运转成就前置）', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.energy = 15;
  game.applyChoice('library', 0, 0);
  assert.strictEqual(game.energyLowReached, true);
});

test('成就字段随存档序列化并在读档后还原', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.applyChoice('library', 0, 0);
  const state = game.serialize();
  assert.ok(Array.isArray(state.achievements), '存档应含成就列表');
  const restored = GameCore.restore(state);
  assert.deepStrictEqual(restored.achievements, game.achievements);
  assert.strictEqual(restored.energyLowReached, game.energyLowReached);
});

// ---- 期末考倒计时 ----

test('倒计时常量与单题限时为 30000 毫秒', () => {
  assert.strictEqual(EXAM_QUESTION_MS, 30000);
});

test('开考后存在计时器，且初始剩余等于单题限时', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.week = game.weeksPerSemester + 1; // 触发 examReady
  const questions = game.startExam(1000);
  assert.ok(questions && questions.length > 0, '应能开考');
  assert.ok(game.examTimer, '应有计时器');
  assert.strictEqual(game.examTimer.remaining, EXAM_QUESTION_MS);
  assert.strictEqual(game.examTimer.lastAt, 1000);
});

test('tickExam 按时间差推进倒计时', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.week = game.weeksPerSemester + 1;
  game.startExam(1000);
  const t = game.tickExam(11000);
  assert.strictEqual(t.remaining, EXAM_QUESTION_MS - 10000);
  assert.strictEqual(t.timedOut, false);
});

test('倒计时耗尽后 timedOut 为真，且 timeoutExamQuestion 记 -1 判错', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.week = game.weeksPerSemester + 1;
  game.startExam(0);
  const t = game.tickExam(EXAM_QUESTION_MS + 1);
  assert.strictEqual(t.timedOut, true);
  const result = game.timeoutExamQuestion(EXAM_QUESTION_MS + 1);
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(game.examAnswers[0], -1);
  assert.strictEqual(game.examTimeouts, 1);
});

test('答题时若倒计时已耗尽，answerExam 走超时判错而非记录选项', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.week = game.weeksPerSemester + 1;
  game.startExam(0);
  const result = game.answerExam(0, EXAM_QUESTION_MS + 1);
  assert.strictEqual(result.timedOut, true);
  assert.strictEqual(game.examAnswers[0], -1);
});

test('正常答题会重置计时器', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.week = game.weeksPerSemester + 1;
  game.startExam(0);
  game.answerExam(0, 1000);
  assert.strictEqual(game.examTimer.remaining, EXAM_QUESTION_MS);
  assert.strictEqual(game.examTimer.lastAt, 1000);
});

test('pauseExam 暂停后 tickExam 不推进剩余时间', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.week = game.weeksPerSemester + 1;
  game.startExam(0);
  game.pauseExam(5000);
  const t = game.tickExam(5000); // 已暂停，lastAt 停在 5000
  assert.strictEqual(t.remaining, EXAM_QUESTION_MS - 5000);
  const t2 = game.tickExam(9000);
  assert.strictEqual(t2.remaining, EXAM_QUESTION_MS - 5000, '暂停期间不推进');
});

test('resumeExam 恢复计时后继续推进', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.week = game.weeksPerSemester + 1;
  game.startExam(0);
  game.pauseExam(5000);
  game.resumeExam(9000);
  const t = game.tickExam(12000);
  assert.strictEqual(t.remaining, EXAM_QUESTION_MS - 5000 - 3000);
});

test('finishExam 统计超时题数并计入 timeouts', () => {
  const game = new GameCore('lin', { seedCode: SEED });
  game.week = game.weeksPerSemester + 1;
  const questions = game.startExam(0);
  // 5 题全部超时判错
  let now = 0;
  for (let i = 0; i < questions.length; i++) {
    now += EXAM_QUESTION_MS + 1;
    game.tickExam(now);
    game.timeoutExamQuestion(now);
  }
  const outcome = game.finishExam();
  assert.ok(outcome.semesterResult, '应返回学期结果');
  assert.strictEqual(outcome.semesterResult.timeouts, 5);
});

// ---- 引擎确定性约束 ----

test('引擎与数据层仍不出现非确定性随机来源', () => {
  const fs = require('fs');
  const path = require('path');
  ['engine', 'data'].forEach(dir => {
    const files = fs.readdirSync(path.join(__dirname, '../miniprogram', dir)).filter(file => file.endsWith('.js'));
    files.forEach(file => {
      if (dir === 'engine' && file === 'save.js') return;
      const source = fs.readFileSync(path.join(__dirname, '../miniprogram', dir, file), 'utf8');
      assert.ok(!/Math\.random|Date\.now|new Date\(/.test(source), `${dir}/${file} 出现了非确定性随机`);
    });
  });
});

console.log(`\nAll ${passed} achievements & exam tests passed.`);
