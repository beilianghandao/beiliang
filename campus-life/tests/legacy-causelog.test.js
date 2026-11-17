/* 专项测试：周目继承（legacy）与选择回看（causelog）
 *
 * 覆盖两条用户故事：
 *   1. 周目继承——上一周目的最高属性够格后，下一周目能带走一样遗物，
 *      遗物带来开局属性 / 每周精力 / 初始好感，并解锁只在对应周目出现的隐藏事件。
 *   2. 随时回看——每一次选择都留下结构化记录（选了什么、当场影响了什么、
 *      后来引发了什么），随时能翻看，且读档后不丢。
 */
const assert = require('assert');
const { CHARACTERS, NPCS, EVENTS, LEGACY_OPTIONS, HIDDEN_EVENTS, statName } = require('../miniprogram/data/content');
const { GameCore } = require('../miniprogram/engine/core');
const { buildChoiceLogView } = require('../miniprogram/engine/choicelog');
const Save = require('../miniprogram/engine/save');

const SEED = 'K7M2QX';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { console.error(`✗ ${name}`); throw error; }
}

function fakeStore() {
  const data = {};
  return {
    data,
    get: key => (key in data ? data[key] : null),
    set: (key, value) => { data[key] = value; },
    remove: key => { delete data[key]; }
  };
}

// 直接做出一份「上一周目已经达标」的 meta，避免测试里真的去跑四周目
function metaWith(stats = {}, extra = {}) {
  const meta = Save.emptyMeta();
  meta.playthroughs = 1;
  Object.keys(stats).forEach(key => { meta.bestStats[key] = stats[key]; });
  return Object.assign(meta, extra);
}

const baseKnowledge = CHARACTERS.find(item => item.id === 'lin').stats.knowledge;
const legacyById = id => LEGACY_OPTIONS.find(item => item.id === id);

// ============ 一、周目继承：遗物效果 ============

test('周目继承：继承「写满批注的错题本」把学识加到开局属性上', () => {
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-notes' });
  assert.strictEqual(game.stats.knowledge, Math.min(100, baseKnowledge + 8));
  assert.strictEqual(game.legacyId, 'legacy-notes');
  assert.strictEqual(game.legacy.name, legacyById('legacy-notes').name);
});

test('周目继承：属性加成不会突破 100 上限', () => {
  const game = new GameCore('lin', SEED);
  game.stats.knowledge = 98;
  const result = game.applyLegacy('legacy-notes');
  assert.ok(result);
  assert.strictEqual(game.stats.knowledge, 100);
});

test('周目继承：护腕让每周结算多恢复 4 点精力', () => {
  const withLegacy = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-wristband' });
  const without = new GameCore('lin', SEED);
  withLegacy.energy = 40;
  without.energy = 40;
  withLegacy.applyChoice('library', 0, 0);
  without.applyChoice('library', 0, 0);
  assert.strictEqual(withLegacy.energy - without.energy, 4);
  assert.strictEqual(withLegacy.legacyEnergyBonus, 4);
});

test('周目继承：通讯录给所有同学 +12 初始好感', () => {
  const game = new GameCore('su', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-addressbook' });
  NPCS.forEach(npc => assert.strictEqual(game.affinityOf(npc.id), 12, npc.id));
});

test('周目继承：未知遗物 id 安全返回 null，不污染属性与状态', () => {
  const game = new GameCore('lin', SEED);
  const before = { ...game.stats };
  assert.strictEqual(game.applyLegacy('legacy-not-exist'), null);
  assert.strictEqual(game.legacyId, null);
  assert.deepStrictEqual(game.stats, before);
});

test('周目继承：继承会写进选择日志，并注明隐藏事件条件已满足', () => {
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-notes' });
  const record = game.choiceLog[0];
  assert.strictEqual(record.type, 'legacy');
  assert.ok(record.title.includes('第 2 周目'));
  assert.ok(record.title.includes(legacyById('legacy-notes').name));
  assert.strictEqual(record.effects.knowledge, 8);
  assert.ok(record.note.includes('隐藏事件'));
});

test('周目继承：playthrough 决定 isReplay，第一周目不标记为重玩', () => {
  assert.strictEqual(new GameCore('lin', SEED).isReplay, false);
  assert.strictEqual(new GameCore('lin', { seedCode: SEED, playthrough: 1 }).playthrough, 1);
  assert.strictEqual(new GameCore('lin', { seedCode: SEED, playthrough: 3 }).isReplay, true);
});

// ============ 二、周目继承：解锁条件与存档 ============

test('周目继承：属性没到 60 时遗物锁定，到 60 才解锁', () => {
  const locked = Save.legacyOptions(metaWith({ knowledge: 59 })).find(item => item.id === 'legacy-notes');
  assert.strictEqual(locked.unlocked, false);
  assert.ok(locked.progressText.includes('59'), '锁定时要告诉玩家当前值');
  const unlocked = Save.legacyOptions(metaWith({ knowledge: 60 })).find(item => item.id === 'legacy-notes');
  assert.strictEqual(unlocked.unlocked, true);
  assert.strictEqual(unlocked.best, 60);
});

test('周目继承：第一周目没有任何遗物可继承，毕业一次后「没寄出的信」解锁', () => {
  const fresh = Save.emptyMeta();
  assert.deepStrictEqual(Save.legacyOptions(fresh).filter(item => item.unlocked), []);
  assert.strictEqual(Save.defaultLegacy(fresh), null, '第一周目不该凭空多出属性');

  const afterOneRun = metaWith({});
  const available = Save.legacyOptions(afterOneRun).filter(item => item.unlocked).map(item => item.id);
  assert.deepStrictEqual(available, ['legacy-letter']);
  assert.strictEqual(Save.defaultLegacy(afterOneRun), 'legacy-letter');
});

test('周目继承：默认继承项优先沿用上一局选择，否则取第一件可用', () => {
  const all = { knowledge: 80, fitness: 80, mood: 80, social: 80, practice: 80 };
  assert.strictEqual(Save.defaultLegacy(metaWith(all, { lastLegacy: 'legacy-lamp' })), 'legacy-lamp');
  assert.strictEqual(Save.defaultLegacy(metaWith(all)), 'legacy-notes');
  assert.strictEqual(Save.defaultLegacy(metaWith({}, { lastLegacy: 'legacy-lamp' })), 'legacy-letter');
});

test('周目继承：recordRun 累积周目数、最高属性、结局与隐藏事件', () => {
  const store = fakeStore();
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 1, legacyId: 'legacy-notes' });
  game.ending = { id: 'ordinary', title: '普通结局', tag: 't', score: 72 };
  game.hiddenCleared = ['hidden-lib-margin'];
  game.applyChoice('library', 0, 0);
  Save.recordRun(game, store);

  const meta = Save.readMeta(store);
  assert.strictEqual(meta.playthroughs, 1);
  assert.strictEqual(meta.bestScore, 72);
  assert.ok(meta.endings.includes('ordinary'));
  assert.ok(meta.hiddenEvents.includes('hidden-lib-margin'));
  assert.strictEqual(meta.lastLegacy, 'legacy-notes');
  assert.strictEqual(meta.lastCharacter, 'lin');
  assert.ok(meta.bestStats.knowledge >= 54);
  assert.ok(meta.lastChoiceLog.length > 0 && meta.lastChoiceLog.length <= 6);
});

test('周目继承：重复 recordRun 只累加周目数，结局不重复记录', () => {
  const store = fakeStore();
  const game = new GameCore('lin', SEED);
  game.ending = { id: 'ordinary', title: '普通结局', tag: 't', score: 60 };
  Save.recordRun(game, store);
  game.ending = { id: 'ordinary', title: '普通结局', tag: 't', score: 88 };
  Save.recordRun(game, store);
  const meta = Save.readMeta(store);
  assert.strictEqual(meta.playthroughs, 2);
  assert.strictEqual(meta.endings.length, 1);
  assert.strictEqual(meta.bestScore, 88);
});

test('周目继承：脏存档能被 normalize 拉回合法范围', () => {
  const meta = Save.normalize({
    playthroughs: -3, runs: 'x', bestScore: 999,
    bestStats: { knowledge: 999, mood: -20, social: 'bad' },
    endings: 'oops', hiddenEvents: [1, 'hidden-lib-margin'], lastChoiceLog: new Array(20).fill({ title: 't' })
  });
  assert.strictEqual(meta.playthroughs, 0);
  assert.strictEqual(meta.runs, 0);
  assert.strictEqual(meta.bestScore, 100);
  assert.strictEqual(meta.bestStats.knowledge, 100);
  assert.strictEqual(meta.bestStats.mood, 0);
  assert.strictEqual(meta.bestStats.social, 0);
  assert.deepStrictEqual(meta.endings, []);
  assert.deepStrictEqual(meta.hiddenEvents, ['hidden-lib-margin']);
  assert.strictEqual(meta.lastChoiceLog.length, 8);
});

test('周目继承：summary 统计隐藏事件总数与已见结局，并返回副本', () => {
  const meta = metaWith({ knowledge: 70 }, { endings: ['ordinary'], hiddenEvents: ['hidden-lib-margin'] });
  const info = Save.summary(meta);
  assert.strictEqual(info.hiddenTotal, Object.keys(HIDDEN_EVENTS).reduce((sum, scene) => sum + HIDDEN_EVENTS[scene].length, 0));
  assert.strictEqual(info.endingCount, 1);
  assert.strictEqual(info.playthroughs, 1);
  info.hiddenCleared.push('x');
  assert.strictEqual(meta.hiddenEvents.length, 1, 'summary 不能把内部数组直接暴露出去');
});

test('周目继承：clearMeta 清空后回到零周目', () => {
  const store = fakeStore();
  const game = new GameCore('lin', SEED);
  game.ending = { id: 'ordinary', title: 'C', tag: 't', score: 60 };
  Save.recordRun(game, store);
  Save.clearMeta(store);
  assert.strictEqual(Save.readMeta(store).playthroughs, 0);
  assert.strictEqual(Save.defaultLegacy(Save.emptyMeta()), null, '清空后回到第一周目，没有遗物可继承');
});

// ============ 三、隐藏事件 ============

test('隐藏事件：没继承对应遗物时锁定，直接进任务会被拒绝', () => {
  const game = new GameCore('lin', SEED);
  const hidden = game.hiddenQuestsFor('library')[0];
  assert.strictEqual(hidden.id, 'hidden-lib-margin');
  assert.strictEqual(hidden.locked, true);
  assert.strictEqual(game.applyChoice('library', EVENTS.library.quests.length, 0), null);
});

test('隐藏事件：继承了遗物但前置任务没做完，仍然锁定', () => {
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-notes' });
  assert.strictEqual(game.hiddenQuestsFor('library')[0].locked, true);
  assert.strictEqual(game.applyChoice('library', EVENTS.library.quests.length, 0), null);
  assert.ok(game.hiddenRequireText(game.hiddenQuestsFor('library')[0]).includes('完成'));
});

test('隐藏事件：遗物 + 前置任务齐备后解锁，questAt 能取到隐藏剧情', () => {
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-notes' });
  game.applyChoice('library', 0, 0);
  const hidden = game.hiddenQuestsFor('library')[0];
  assert.strictEqual(hidden.locked, false);
  const quest = game.questAt('library', hidden.index);
  assert.strictEqual(quest.id, 'hidden-lib-margin');
  assert.ok(Array.isArray(quest.choices) && quest.choices.length >= 2);
});

test('隐藏事件：完成隐藏剧情后计入本局、写入日志并标记类型', () => {
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-notes' });
  game.applyChoice('library', 0, 0);
  const index = EVENTS.library.quests.length;
  const result = game.applyChoice('library', index, 0);
  assert.ok(result && result.hidden, '结算结果要带上隐藏事件信息');
  assert.ok(game.hiddenCleared.includes('hidden-lib-margin'));
  assert.strictEqual(game.hiddenClearedCount(), 1);
  assert.deepStrictEqual(game.completed.filter(key => key === `library:${index}`), [`library:${index}`]);
  const latest = game.choiceLog[game.choiceLog.length - 1];
  assert.strictEqual(latest.type, 'hidden');
  assert.ok(latest.note.includes('隐藏事件'));
});

test('隐藏事件：不同遗物只开各自的隐藏事件', () => {
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-wristband' });
  assert.strictEqual(game.hiddenQuestsFor('library')[0].locked, true);
  game.applyChoice('gym', 0, 0);
  assert.strictEqual(game.hiddenQuestsFor('gym')[0].locked, false);
});

test('隐藏事件：场景进度列表把隐藏事件排在末尾并带锁定标记', () => {
  const game = new GameCore('lin', SEED);
  const progress = game.sceneProgress('library');
  assert.strictEqual(progress.length, EVENTS.library.quests.length + HIDDEN_EVENTS.library.length);
  const hidden = progress[progress.length - 1];
  assert.strictEqual(hidden.hidden, true);
  assert.strictEqual(hidden.locked, true);
  assert.ok(hidden.badge.includes('隐藏事件'));
  assert.ok(hidden.requireText.length > 0);
});

test('隐藏事件：已通关的隐藏事件会随 recordRun 写进跨周目存档', () => {
  const store = fakeStore();
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-notes' });
  game.applyChoice('library', 0, 0);
  game.applyChoice('library', EVENTS.library.quests.length, 0);
  Save.recordRun(game, store);
  const meta = Save.readMeta(store);
  assert.ok(meta.hiddenEvents.includes('hidden-lib-margin'));
  assert.strictEqual(Save.summary(meta).hiddenCleared.length, 1);
});

// ============ 四、选择回看（因果记录） ============

test('选择回看：每次选择都留下可回看的完整记录', () => {
  const game = new GameCore('lin', SEED);
  const result = game.applyChoice('library', 0, 0);
  const record = game.choiceLog[game.choiceLog.length - 1];
  assert.strictEqual(game.choiceLog.length, 1);
  assert.strictEqual(record.id, 'c1');
  assert.strictEqual(record.type, 'quest');
  assert.strictEqual(record.sceneName, EVENTS.library.name);
  assert.strictEqual(record.title, EVENTS.library.quests[0].title);
  assert.strictEqual(record.choice, EVENTS.library.quests[0].choices[0].text);
  assert.ok(record.at.includes('第 1 周'));
  assert.ok(record.semesterName.length > 0);
  assert.ok(record.tags.length > 0);
  assert.deepStrictEqual(record.effects, result.applied, '日志记的必须是结算后的实际数值');
  assert.strictEqual(result.logId, record.id);
});

test('选择回看：重复体验会标记 repeat 且收益递减', () => {
  const game = new GameCore('lin', SEED);
  const first = game.applyChoice('library', 0, 0);
  const second = game.applyChoice('library', 0, 0);
  const record = game.choiceLog[game.choiceLog.length - 1];
  assert.strictEqual(second.repeat, true);
  assert.strictEqual(record.repeat, true);
  assert.strictEqual(record.repeatLabel, undefined, 'repeatLabel 由视图层补，不在原始记录里');
  const firstGain = Object.keys(first.applied).filter(k => k !== 'energy' && first.applied[k] > 0).reduce((s, k) => s + first.applied[k], 0);
  const secondGain = Object.keys(second.applied).filter(k => k !== 'energy' && second.applied[k] > 0).reduce((s, k) => s + second.applied[k], 0);
  assert.ok(secondGain < firstGain, `${secondGain} 应小于 ${firstGain}`);
});

test('选择回看：日志最多保留 240 条，超出后丢掉最早的', () => {
  const game = new GameCore('lin', SEED);
  for (let i = 0; i < 300; i++) game.pushLog({ title: `t${i}`, choice: 'x' });
  assert.strictEqual(game.choiceLog.length, 240);
  assert.strictEqual(game.choiceLog[239].title, 't299');
  assert.strictEqual(game.choiceSeq, 300);
});

test('选择回看：因果报告汇总属性总量、分类计数与未发作的后果', () => {
  const game = new GameCore('lin', SEED);
  const quest = EVENTS.classroom.quests[0];
  const chainIndex = quest.choices.findIndex(choice => choice.chain);
  assert.ok(chainIndex >= 0, '教室第一段剧情要有连锁选项，才能测后果');
  game.applyChoice('classroom', 0, chainIndex);

  const report = game.causeReport();
  assert.strictEqual(report.total, 1);
  assert.strictEqual(report.playthrough, 1);
  assert.strictEqual(report.counts.quest, 1);
  assert.strictEqual(report.counts.legacy, 0);
  assert.ok(Object.keys(report.totals).length > 0);
  assert.strictEqual(report.pending.length, 1);
  assert.ok(report.pending[0].title.length > 0);
  assert.strictEqual(report.hidden.total, Object.keys(HIDDEN_EVENTS).reduce((s, k) => s + HIDDEN_EVENTS[k].length, 0));
});

test('选择回看：后果发作后能回头把那条选择标记为已兑现', () => {
  const game = new GameCore('lin', SEED);
  const quest = EVENTS.classroom.quests[0];
  const chainIndex = quest.choices.findIndex(choice => choice.chain);
  const result = game.applyChoice('classroom', 0, chainIndex);
  const record = game.choiceLog.find(entry => entry.id === result.logId);
  assert.strictEqual(record.consequences.length, 1);
  assert.strictEqual(record.consequences[0].fired, false);

  game.markConsequenceFired(result.logId, record.consequences[0].eventId, game.absoluteWeek + 1);
  assert.strictEqual(record.consequences[0].fired, true);
  assert.strictEqual(record.consequences[0].firedAt, game.absoluteWeek + 1);
  game.markConsequenceFired('c-not-exist', 'roll-call', 1); // 不存在的记录不应抛错
});

test('选择回看：视图按时间倒序，并把属性键翻译成中文', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  game.applyChoice('canteen', 0, 0);
  const source = game.choiceLog.slice();
  const view = buildChoiceLogView(game.choiceLog);

  assert.strictEqual(view.length, 2);
  assert.strictEqual(view[0].questTitle, game.choiceLog[1].title, '最新的一条排最前');
  assert.strictEqual(view[1].questTitle, game.choiceLog[0].title);
  view.forEach(item => {
    assert.ok(item.id && item.sceneName && item.choiceText);
    assert.ok(item.effects.every(effect => effect.name === statName(effect.key)));
    assert.ok(['首次体验', '重复体验 · 收益递减'].includes(item.repeatLabel));
  });
  assert.strictEqual(game.choiceLog.length, source.length, '视图不能改动原始日志');
  assert.deepStrictEqual(buildChoiceLogView([]), []);
  assert.deepStrictEqual(buildChoiceLogView(null), []);
});

test('选择回看：读档后周目、遗物、隐藏事件与选择记录都还在', () => {
  const game = new GameCore('lin', { seedCode: SEED, playthrough: 2, legacyId: 'legacy-notes' });
  game.applyChoice('library', 0, 0);
  game.applyChoice('library', EVENTS.library.quests.length, 0);
  const saved = game.serialize();
  assert.strictEqual(saved.playthrough, 2);
  assert.strictEqual(saved.legacyId, 'legacy-notes');
  assert.ok(saved.hiddenCleared.includes('hidden-lib-margin'));
  assert.ok(saved.choiceLog.length >= 2);

  const restored = GameCore.restore(JSON.parse(JSON.stringify(saved)));
  assert.strictEqual(restored.playthrough, 2);
  assert.strictEqual(restored.isReplay, true);
  assert.strictEqual(restored.legacyId, 'legacy-notes');
  assert.strictEqual(restored.legacyEnergyBonus, 0);
  assert.deepStrictEqual(restored.hiddenCleared, ['hidden-lib-margin']);
  assert.strictEqual(restored.choiceLog.length, saved.choiceLog.length);
  assert.strictEqual(restored.choiceLog[0].choice, game.choiceLog[0].choice);
});

test('选择回看：还原出来的日志是深拷贝，改它不影响原存档对象', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const saved = JSON.parse(JSON.stringify(game.serialize()));
  const restored = GameCore.restore(saved);
  restored.choiceLog[0].effects.knowledge = 9999;
  assert.notStrictEqual(saved.choiceLog[0].effects.knowledge, 9999);
});

console.log(`\nAll ${passed} legacy & causelog tests passed.`);
