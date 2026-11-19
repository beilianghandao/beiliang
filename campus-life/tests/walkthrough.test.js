// 走查验收单：NPC 请求事件调度器 + 答应/拒绝分支 + 好感度结算
//         chain 字段 + 三级触发（点名/辅导员谈话/家长来电）+ 延迟触发队列
//
// 覆盖的是 tests/core.test.js 之外的边界与规则细节：派发节奏、过期、门槛可达性、
// 连锁的时间轴与去重、存档字段。core.test.js 里的主路径用例不在这里重复。
//
// 已知缺陷用 knownIssue() 记录：现在断言失败 = 缺陷仍在；哪天断言通过了，
// 会提示你把它挪回正式断言，避免缺陷被悄悄带进发布。
//
// 与走查原稿的唯一差别：GameCore 需要种子码，构造时统一传 SEED。

const assert = require('assert');
const { REQUESTS, CHAIN_EVENTS, AFFINITY_TIERS, affinityTier, NPCS, EVENTS, ENDINGS } = require('../miniprogram/data/content');
const { GameCore } = require('../miniprogram/engine/core');

const SEED = 'K7M2QX';

let passed = 0;
const failures = [];
const known = [];

function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`✗ ${name}`); }
}

// 已知缺陷：断言应当失败（说明缺陷还在）；如果哪天通过了，会提示转正
function knownIssue(id, name, fn) {
  try {
    fn();
    known.push({ id, name, note: '断言已经通过 —— 说明缺陷修好了，请把这段挪回正式用例' });
    console.log(`◌ ${name}　【${id} 已修复，待转正】`);
  } catch (error) {
    known.push({ id, name, note: error.message });
    console.log(`⚠ ${name}　【${id} 已知缺陷】`);
  }
}

// 走一周：撞上期末就先考完，保证时间一直在往前走
function advance(game) {
  if (game.ending) return 'ended';
  if (game.examReady) {
    const questions = game.startExam();
    if (!questions) return 'ended';
    questions.forEach(q => game.answerExam(q.answer));
    game.finishExam();
    return 'exam';
  }
  game.applyChoice('library', 0, 0);
  return 'action';
}

// 一路答应所有上门请求，返回这一局处理过的请求 id
function playAcceptingEverything(game, weeks) {
  for (let i = 0; i < weeks; i++) {
    advance(game);
    game.pendingRequests().slice().forEach(request => game.resolveRequest(request.id, 0));
  }
  return game;
}

const REQ_ACCEPT = 0;
const REQ_REFUSE = 1;

// ============ 请求事件调度器 ============

test('开局没人来，第一次行动之后第一个请求才上门', () => {
  const game = new GameCore('lin', SEED);
  assert.strictEqual(game.requests.length, 0, '开局不该有人来敲门');
  assert.strictEqual(game.pendingRequests().length, 0);

  const result = game.applyChoice('library', 0, 0);
  assert.ok(result.request, '第一次行动之后应当有请求上门');
  assert.strictEqual(game.requests.length, 1);
  assert.strictEqual(game.requests[0].id, result.request.id);
  assert.strictEqual(game.requests[0].npc, result.request.npc);
  assert.strictEqual(game.requests[0].since, game.absoluteWeek, '上门时间要记清楚，逾期判断靠它');
});

test('同时最多只有一条请求在等回复', () => {
  const game = new GameCore('lin', SEED);
  for (let i = 0; i < 8; i++) {
    advance(game);
    assert.ok(game.requests.length <= 1, `同时堆了 ${game.requests.length} 条请求`);
  }
});

test('两次派发之间至少隔一周', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const first = game.pendingRequests()[0];
  game.resolveRequest(first.id, REQ_ACCEPT);
  const weekAfterFirst = game.absoluteWeek;

  game.applyChoice('library', 0, 0);
  assert.strictEqual(game.requests.length, 1, '下一周应该轮到下一个请求');
  assert.ok(game.requests[0].since >= weekAfterFirst + 1, '两次派发之间必须至少隔一周');
});

test('好感度高的人会被先想起', () => {
  const game = new GameCore('lin', SEED);
  game.affinity.npc5 = 20;   // 宋小满
  game.affinity.npc1 = 2;    // 周予安
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  assert.strictEqual(request.npc, 'npc5', '好感更高的 NPC 应该先来敲门');
});

test('请求按 NPC 查得到，等的是谁的回复一目了然', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  assert.ok(game.pendingRequestFor(request.npc), '应该能按 NPC 找到正在等他回复的请求');
  assert.strictEqual(game.pendingRequestFor('npc-not-in-town'), null);
});

test('有学期门槛的请求在门槛之前不会上门', () => {
  const first = new GameCore('lin', SEED);
  first.semester = 1;
  first.applyChoice('library', 0, 0);
  assert.ok(!first.pendingRequests().some(item => item.id === 'req-npc3-a'), '大二才开放的请求不该在大一上门');

  const later = new GameCore('lin', SEED);
  later.semester = 2;
  assert.ok(later.eligibleRequests().some(item => item.id === 'req-npc3-a'), '到了大二它就该可派发了');
});

test('请求放太久没人管，NPC 会走并扣好感度', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  const before = game.affinityOf(request.npc);

  for (let i = 0; i < 3; i++) advance(game);

  assert.ok(!game.pendingRequests().some(item => item.id === request.id), '过期的请求应该被清掉');
  assert.strictEqual(game.affinityOf(request.npc), before - 4, '被放鸽子要扣 4 点好感（好感度允许为负）');
  assert.ok(game.log.some(line => line.includes('等了你很久')), '日志里应该写明有人走了');
});

test('答应分支按内容表结算属性与好感度', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  const def = REQUESTS.find(item => item.id === request.id);
  const choice = def.choices[REQ_ACCEPT];

  const outcome = game.resolveRequest(request.id, REQ_ACCEPT);
  assert.ok(outcome, '答应之后应该返回结算结果');
  assert.strictEqual(outcome.affinity, choice.affinity, '好感增量要和内容表一致');
  assert.strictEqual(outcome.total, choice.affinity, '当前好感应该是增量本身（初始为 0）');
  assert.strictEqual(outcome.accepted, true);
  assert.strictEqual(outcome.tier.name, affinityTier(choice.affinity).name);
  Object.keys(choice.effects).forEach(key => {
    assert.ok(Object.prototype.hasOwnProperty.call(outcome.applied, key), `结算结果少了 ${key}`);
  });
  assert.strictEqual(outcome.applied.energy, choice.effects.energy, '精力按原值扣');
  assert.strictEqual(game.requests.length, 0, '答复之后请求应该出队');
  assert.ok(game.resolvedRequests.includes(request.id), '已答复记录里要有它');
});

test('拒绝分支同样结算效果并扣好感度', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  const def = REQUESTS.find(item => item.id === request.id);
  const choice = def.choices[REQ_REFUSE];

  const outcome = game.resolveRequest(request.id, REQ_REFUSE);
  assert.ok(outcome);
  assert.strictEqual(outcome.affinity, choice.affinity);
  assert.ok(outcome.affinity < 0, '拒绝应该掉好感度');
  assert.strictEqual(outcome.accepted, false);
});

test('答应与拒绝的日志写清楚加了多少', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  game.resolveRequest(request.id, REQ_ACCEPT);
  assert.ok(game.log.some(line => line.includes('你答应了')), '日志里应该有答应记录');
  assert.ok(game.log.some(line => line.includes('好感')), '日志里应该写明好感变化');

  const refused = new GameCore('lin', SEED);
  refused.applyChoice('library', 0, 0);
  refused.resolveRequest(refused.pendingRequests()[0].id, REQ_REFUSE);
  assert.ok(refused.log.some(line => line.includes('你拒绝了')), '日志里应该有拒绝记录');
});

test('应答不存在的请求、越界的分支都返回 null', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  assert.strictEqual(game.resolveRequest('req-does-not-exist', 0), null);
  assert.strictEqual(game.resolveRequest(request.id, 99), null);
  assert.strictEqual(game.resolveRequest(request.id, -1), null);
});

test('应答请求不消耗周次，也不顺带派发新请求', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  const week = game.absoluteWeek;
  game.resolveRequest(request.id, REQ_ACCEPT);
  assert.strictEqual(game.absoluteWeek, week, '答复请求不该推进时间');
  assert.strictEqual(game.requests.length, 0);
});

test('答复过的请求不会再上门第二次', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  game.resolveRequest(request.id, REQ_ACCEPT);
  for (let i = 0; i < 5; i++) advance(game);
  assert.ok(!game.pendingRequests().some(item => item.id === request.id));
  assert.ok(!game.eligibleRequests().some(item => item.id === request.id));
});

test('好感度分档的边界值判对', () => {
  assert.strictEqual(affinityTier(50).name, '挚友');
  assert.strictEqual(affinityTier(49).name, '亲近');
  assert.strictEqual(affinityTier(30).name, '亲近');
  assert.strictEqual(affinityTier(29).name, '熟悉');
  assert.strictEqual(affinityTier(10).name, '熟悉');
  assert.strictEqual(affinityTier(9).name, '生疏');
  assert.strictEqual(affinityTier(-5).name, '生疏');
  assert.strictEqual(AFFINITY_TIERS.length, 4, '分档数量不该悄悄变');
});

test('存档带上好感度、请求、延迟队列与全局周次', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('classroom', 0, 2);   // 翘课 → 入队
  game.applyChoice('library', 0, 0);     // 点名发作
  const state = game.serialize();
  assert.ok(state.affinity && typeof state.affinity === 'object');
  assert.ok(Array.isArray(state.requests));
  assert.ok(Array.isArray(state.resolvedRequests));
  assert.ok(Array.isArray(state.triggers));
  assert.ok(Array.isArray(state.pendingChains));
  assert.strictEqual(typeof state.absoluteWeek, 'number');
  assert.deepStrictEqual(state.pendingChains, game.pendingChains);
  assert.deepStrictEqual(state.requests, game.requests);
});

test('每条请求都指向真实存在的 NPC，门槛字段齐备', () => {
  REQUESTS.forEach(request => {
    assert.ok(NPCS.some(npc => npc.id === request.npc), `${request.id} 的 npc ${request.npc} 不在 NPCS 里`);
    assert.ok(request.requires, `${request.id} 缺少 requires`);
    assert.strictEqual(typeof request.requires.affinity, 'number', request.id);
    assert.strictEqual(typeof request.requires.semester, 'number', request.id);
    assert.ok(request.choices.some(choice => choice.affinity > 0), `${request.id} 缺少「答应」分支`);
    assert.ok(request.choices.some(choice => choice.affinity < 0), `${request.id} 缺少「拒绝」分支`);
  });
});

// ============ chain 字段与延迟触发队列 ============

test('翘课的连锁事件排进延迟队列，不会当场发作', () => {
  const game = new GameCore('lin', SEED);
  const result = game.applyChoice('classroom', 0, 2);
  assert.ok(result.chained, '这个选择应该埋下后果');
  assert.strictEqual(game.triggers.length, 1);
  assert.strictEqual(game.triggers[0].eventId, 'roll-call');
  assert.strictEqual(game.pendingChains.length, 0, '不能当场发作');
  assert.strictEqual(result.chained.fireAt, game.absoluteWeek + 1, '到期周数算错了');
});

test('延迟队列能看出还有几周才发作', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('classroom', 0, 2);
  const scheduled = game.scheduledTriggers();
  assert.strictEqual(scheduled.length, 1);
  assert.strictEqual(scheduled[0].def.title, CHAIN_EVENTS['roll-call'].title);
  assert.strictEqual(scheduled[0].inWeeks, 1);
});

test('连锁按全局周次依次发作：点名 → 辅导员谈话 → 家长来电', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('classroom', 0, 2);
  assert.deepStrictEqual(game.pendingChains, []);

  advance(game);                                        // 点名发作
  assert.deepStrictEqual(game.pendingChains, ['roll-call']);
  assert.strictEqual(game.triggers[0].eventId, 'counselor-talk', '下一级应自动排队');
  assert.strictEqual(game.triggers[0].fireAt, game.absoluteWeek + 2, '下一级隔 2 周');

  advance(game);                                        // 还没到
  assert.deepStrictEqual(game.pendingChains, ['roll-call']);

  advance(game);                                        // 辅导员谈话发作
  assert.deepStrictEqual(game.pendingChains, ['roll-call', 'counselor-talk']);
  assert.strictEqual(game.triggers[0].eventId, 'parent-call');

  advance(game);                                        // 还没到（这一周撞上期末考）
  assert.deepStrictEqual(game.pendingChains, ['roll-call', 'counselor-talk']);

  advance(game);                                        // 家长来电发作
  assert.deepStrictEqual(game.pendingChains, ['roll-call', 'counselor-talk', 'parent-call']);
  assert.strictEqual(game.triggers.length, 0, '链子到第三级就该停');
});

test('同一个连锁事件不会重复发作', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('classroom', 0, 2);
  advance(game);
  assert.deepStrictEqual(game.pendingChains, ['roll-call']);
  assert.strictEqual(game.collectTriggers().length, 0, '已发作的事件不该再发一次');
  assert.deepStrictEqual(game.pendingChains, ['roll-call']);
});

test('连锁事件处理后从待办里消失，且不能重复结算', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('classroom', 0, 2);
  advance(game);
  const outcome = game.resolveChain('roll-call', 0);
  assert.ok(outcome.reply && outcome.applied);
  assert.ok(!game.pendingChains.includes('roll-call'));
  assert.strictEqual(game.resolveChain('roll-call', 0), null);
  assert.strictEqual(game.resolveChain('not-a-chain', 0), null);
});

test('连锁事件只结算属性，不写好感度', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('classroom', 0, 2);
  advance(game);
  const before = { ...game.affinity };
  game.resolveChain('roll-call', 0);
  assert.deepStrictEqual(game.affinity, before, '连锁事件不该改好感度');
});

test('连锁入队与发作都会写进日志', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('classroom', 0, 2);
  assert.ok(game.log.some(line => line.includes('被记下了')), '入队应该有日志');
  advance(game);
  assert.ok(game.log.some(line => line.includes('件事情找上门了')), '发作应该有日志');
});

test('三级链的每一级都接得上对应的场景美术', () => {
  assert.strictEqual(CHAIN_EVENTS['roll-call'].level, 1);
  assert.strictEqual(CHAIN_EVENTS['counselor-talk'].level, 2);
  assert.strictEqual(CHAIN_EVENTS['parent-call'].level, 3);
  assert.strictEqual(CHAIN_EVENTS['roll-call'].next, 'counselor-talk');
  assert.strictEqual(CHAIN_EVENTS['counselor-talk'].next, 'parent-call');
  assert.strictEqual(CHAIN_EVENTS['parent-call'].next, null);
  Object.keys(CHAIN_EVENTS).forEach(id => {
    const event = CHAIN_EVENTS[id];
    assert.ok(EVENTS[event.scene], `${id} 的场景 ${event.scene} 必须存在`);
    assert.ok(event.choices.length >= 2, id);
  });
});

test('负向的精力效果照常生效（精力不受属性下限保护）', () => {
  const game = new GameCore('lin', SEED);
  const applied = game.applyEffects({ energy: -4 });
  assert.strictEqual(applied.energy, -4);
});

// ============ 走查发现的三个缺陷（已修复，转成正式用例） ============

test('A. 带好感门槛的请求在真实玩法里够得到：好感度天花板不再是 9', () => {
  const game = playAcceptingEverything(new GameCore('lin', SEED), 40);
  const reached = Math.max(0, ...Object.values(game.affinity));
  const gated = REQUESTS.filter(request => request.requires.affinity > 0).map(request => request.id);
  gated.forEach(id => {
    assert.ok(game.resolvedRequests.includes(id), `门槛请求 ${id} 一整局都没能上门`);
  });
  assert.ok(reached >= 30, `一整局打完好感度最高只有 ${reached}，到不了 30 的门槛`);
});

test('B. 拒绝分支的负面属性确实下降，不会被翻成 +1', () => {
  const game = new GameCore('lin', SEED);
  game.applyChoice('library', 0, 0);
  const request = game.pendingRequests()[0];
  const def = REQUESTS.find(item => item.id === request.id);
  const choice = def.choices[REQ_REFUSE];
  const negativeKey = Object.keys(choice.effects).find(key => choice.effects[key] < 0 && key !== 'energy');
  assert.ok(negativeKey, '这条拒绝分支应该有负向属性');
  const outcome = game.resolveRequest(request.id, REQ_REFUSE);
  assert.ok(outcome.applied[negativeKey] < 0, `${negativeKey} 应该下降，实际结算成 ${outcome.applied[negativeKey]}`);
});

test('C. 好感度参与毕业结局判定：高好感度导向「众望所归」', () => {
  assert.ok(ENDINGS.some(ending => ending.id === 'beloved'), '结局表里缺少「众望所归」这一档');
  const warm = new GameCore('lin', SEED);
  warm.stats = { knowledge: 20, fitness: 20, mood: 20, social: 20, practice: 20 };
  NPCS.forEach(npc => { warm.affinity[npc.id] = 90; });
  assert.strictEqual(warm.pickEnding(50).id, 'beloved', '高好感度应该导向众望所归结局');

  // 反过来：一路拒绝就拿不到这个结局
  const cold = new GameCore('lin', SEED);
  cold.stats = { knowledge: 20, fitness: 20, mood: 20, social: 20, practice: 20 };
  NPCS.forEach(npc => { cold.affinity[npc.id] = -20; });
  assert.notStrictEqual(cold.pickEnding(50).id, 'beloved', '关系冷下来就不该白拿众望所归');
});

// ============ 汇总 ============

if (failures.length) {
  console.error(`\n${failures.length} 条用例未通过：\n`);
  failures.forEach(({ name, error }) => console.error(`  ✗ ${name}\n      ${error.message}\n`));
}

if (known.length) {
  console.log(`\n已知缺陷 ${known.length} 条：`);
  known.forEach(item => console.log(`  · [${item.id}] ${item.name}\n      ${item.note}`));
}

console.log(`\n通过 ${passed} 条，失败 ${failures.length} 条，已知缺陷 ${known.length} 条。`);
if (failures.length) process.exit(1);
