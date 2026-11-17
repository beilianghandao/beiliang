// 验收用例：NPC 请求事件调度器 + 答应/拒绝分支 + 好感度结算
//          chain 字段 + 三级触发（点名 / 辅导员谈话 / 家长来电）+ 延迟触发队列
//
// 本文件按本分支（feature/request-and-chain-events）的真实引擎接口编写：
//   好感度      affinity / affinityOf(npcId)
//   请求队列    requests / resolvedRequests / resolveRequest(id, choiceIndex)
//   延迟队列    triggers / pendingChains / resolveChain(eventId, choiceIndex)
//   全局周      absoluteWeek（跨学期累计，延迟计时用它，不用会归零的 week）
//   请求表      REQUESTS 为数组，choices[0] 答应、choices[1] 拒绝，好感字段 affinity
//   链字段      choice.chain = { event, delay }；CHAIN_EVENTS 用 next / nextDelay / level
//
// 运行：node tests/request-chain.test.js（或 npm run test:accept）

const assert = require('assert');
const { EVENTS, REQUESTS, CHAIN_EVENTS } = require('../miniprogram/data/content');
const { GameCore } = require('../miniprogram/engine/core');

let passed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`✗ ${name}`); }
}

// —— 脚手架：推进一个行动；撞上期末先考试，已毕业就停下 ——
function step(game, sceneId, questIndex, choiceIndex) {
  if (game.ending) return null;
  if (game.examReady) {
    const questions = game.startExam();
    if (!questions) return null;
    questions.forEach(q => game.answerExam(q.answer));
    game.finishExam();
    if (game.ending) return null;
  }
  return game.applyChoice(sceneId, questIndex, choiceIndex);
}

// 一路行动到有请求上门
function advanceUntilRequest(game, maxSteps = 30) {
  for (let i = 0; i < maxSteps; i++) {
    if (game.requests.length > 0) return true;
    if (game.ending) break;
    step(game, 'library', 0, 0);
  }
  return game.requests.length > 0;
}

// 翘课选项：classroom · cls-1 · 从后门溜出去
const CHAIN_CHOICE = { sceneId: 'classroom', questIndex: 0, choiceIndex: 2 };

// ============ 一、请求事件与好感度结算 ============

test('应答不存在的请求 / 越界分支返回 null，不抛错', () => {
  const game = new GameCore('lin');
  assert.strictEqual(game.resolveRequest('not-a-request', 0), null);
  assert.strictEqual(game.resolveRequest('req-npc1-a', 99), null);
});

test('答应结算正向效果并加好感，拒绝结算负向效果并扣好感，请求出队并入已处理记录', () => {
  const game = new GameCore('lin');
  assert.ok(advanceUntilRequest(game));
  const request = game.pendingRequests()[0];
  const def = REQUESTS.find(r => r.id === request.id);

  const before = game.affinityOf(request.npc);
  const accepted = game.resolveRequest(request.id, 0);
  assert.ok(accepted, '答应应返回结算结果');
  assert.ok(accepted.affinity > 0, '答应分支好感增量应为正');
  assert.strictEqual(game.affinityOf(request.npc), accepted.total);
  assert.ok(game.affinityOf(request.npc) > before, '答应后好感度应上升');
  Object.keys(def.choices[0].effects).forEach(key => {
    assert.ok(Object.prototype.hasOwnProperty.call(accepted.applied, key), `结算结果少了 ${key}`);
  });
  assert.ok(!game.requests.some(item => item.id === request.id), '应答后请求应出队');
  assert.ok(game.resolvedRequests.includes(request.id), '已处理记录应包含该请求');

  // 拒绝分支
  const other = new GameCore('lin');
  assert.ok(advanceUntilRequest(other));
  const otherRequest = other.pendingRequests()[0];
  const beforeRefuse = other.affinityOf(otherRequest.npc);
  const refuse = other.resolveRequest(otherRequest.id, 1);
  assert.ok(refuse.affinity < 0, '拒绝分支好感增量应为负');
  assert.ok(other.affinityOf(otherRequest.npc) < beforeRefuse, '拒绝后好感度应下降');
  assert.ok(other.resolvedRequests.includes(otherRequest.id));
});

test('同一个请求一局只上门一次：处理过后不再进入候选与待办', () => {
  const game = new GameCore('lin');
  assert.ok(advanceUntilRequest(game));
  const request = game.pendingRequests()[0];
  game.resolveRequest(request.id, 0);
  assert.ok(!game.eligibleRequests().some(item => item.id === request.id), '已处理请求不该再进候选');
  for (let i = 0; i < 10 && !game.ending; i++) step(game, 'library', 0, 0);
  assert.ok(!game.pendingRequests().some(item => item.id === request.id), '已处理请求不该再次上门');
});

test('好感度与学期双门槛：任一不满足都不解锁，都满足才进入候选', () => {
  const game = new GameCore('lin');
  const target = REQUESTS.find(r => r.id === 'req-npc1-b'); // affinity 30, semester 3
  assert.ok(target, '样例高级请求应存在');

  game.semester = 3;
  game.affinity.npc1 = 29;
  assert.ok(!game.eligibleRequests().some(item => item.id === target.id), '好感未到门槛不应解锁');
  game.affinity.npc1 = 30;
  assert.ok(game.eligibleRequests().some(item => item.id === target.id), '好感达标且学期满足应解锁');

  game.semester = 1;
  assert.ok(!game.eligibleRequests().some(item => item.id === target.id), '学期不满足不应解锁');
});

test('待处理请求队列不超过实现上限，不会无限堆积', () => {
  const game = new GameCore('lin');
  for (let i = 0; i < 16 && !game.ending; i++) {
    step(game, 'library', 0, 0);
    assert.ok(game.requests.length <= game.maxActiveRequests, `待处理请求堆到了 ${game.requests.length} 个`);
  }
});

test('对局状态序列化携带好感度、待办与已处理请求快照', () => {
  const game = new GameCore('lin');
  assert.ok(advanceUntilRequest(game));
  const state = game.serialize();
  assert.ok(state.affinity && typeof state.affinity === 'object', '存档应含 affinity');
  assert.ok(Array.isArray(state.requests), '存档应含 requests');
  assert.ok(Array.isArray(state.resolvedRequests), '存档应含 resolvedRequests');
  assert.deepStrictEqual(state.requests, game.requests);
  assert.deepStrictEqual(state.resolvedRequests, game.resolvedRequests);
});

// ============ 二、chain 字段与三级触发链 ============

test('没有 chain 的普通选择不会产生延迟事件', () => {
  const game = new GameCore('lin');
  const before = game.triggers.length;
  game.applyChoice('library', 0, 0);
  assert.strictEqual(game.triggers.length, before, '普通选择不该往延迟队列塞条目');
});

test('带 chain 的选择排进延迟队列，到期周数按 absoluteWeek + delay 计算', () => {
  const game = new GameCore('lin');
  const result = game.applyChoice(CHAIN_CHOICE.sceneId, CHAIN_CHOICE.questIndex, CHAIN_CHOICE.choiceIndex);
  assert.ok(result.chained, '翘课选择应埋下后果');
  assert.strictEqual(game.triggers.length, 1);
  assert.strictEqual(game.triggers[0].eventId, 'roll-call');
  assert.strictEqual(game.triggers[0].fireAt, game.absoluteWeek + 1);
  assert.strictEqual(game.pendingChains.length, 0, '未到期不能当场发作');
});

test('三级链数据完整：level 1→2→3，点名 → 辅导员谈话 → 家长来电，末级无 next', () => {
  const chain = [];
  let current = CHAIN_EVENTS['roll-call'];
  for (let depth = 0; depth < 3 && current; depth++) {
    chain.push(current);
    current = current.next ? CHAIN_EVENTS[current.next] : null;
  }
  assert.strictEqual(chain.length, 3, '链条应走满三级');
  assert.deepStrictEqual(chain.map(e => e.level), [1, 2, 3], '三级层级编号应为 1/2/3');
  assert.ok(chain[0].title.includes('点名'), `第一级标题应含「点名」，实际：${chain[0].title}`);
  assert.ok(chain[1].title.includes('辅导员'), `第二级标题应含「辅导员」，实际：${chain[1].title}`);
  assert.ok(chain[2].title.includes('家') || chain[2].speaker === '妈妈', `第三级应为家人来电，实际：${chain[2].title} / ${chain[2].speaker}`);
  assert.strictEqual(CHAIN_EVENTS['roll-call'].next, 'counselor-talk');
  assert.strictEqual(CHAIN_EVENTS['counselor-talk'].next, 'parent-call');
  assert.strictEqual(CHAIN_EVENTS['parent-call'].next, null);
  chain.forEach(event => {
    assert.ok(Array.isArray(event.choices) && event.choices.length >= 2, `${event.id} 应有两个分支`);
    assert.ok(EVENTS[event.scene], `${event.id} 接到的场景 ${event.scene} 应存在`);
  });
});

test('级联自动排队：一级发作后二级入队，二级发作后三级入队，到期周数正确', () => {
  const game = new GameCore('lin');
  game.applyChoice(CHAIN_CHOICE.sceneId, CHAIN_CHOICE.questIndex, CHAIN_CHOICE.choiceIndex);

  // 推进到第一级（点名）发作
  for (let i = 0; i < 3 && !game.pendingChains.includes('roll-call') && !game.ending; i++) {
    step(game, 'library', 0, 0);
  }
  assert.ok(game.pendingChains.includes('roll-call'), '点名应已发作');
  const second = game.triggers.find(item => item.eventId === 'counselor-talk');
  assert.ok(second, '二级应自动排进延迟队列');
  assert.strictEqual(second.fireAt, game.absoluteWeek + CHAIN_EVENTS['roll-call'].nextDelay);

  // 推进到第二级（辅导员谈话）发作
  for (let i = 0; i < 4 && !game.pendingChains.includes('counselor-talk') && !game.ending; i++) {
    step(game, 'library', 0, 0);
  }
  assert.ok(game.pendingChains.includes('counselor-talk'), '辅导员谈话应已发作');
  const third = game.triggers.find(item => item.eventId === 'parent-call');
  assert.ok(third, '三级应自动排进延迟队列');
  assert.strictEqual(third.fireAt, game.absoluteWeek + CHAIN_EVENTS['counselor-talk'].nextDelay);
});

test('同一个链事件只触发一次：不重复入待办，重复结算返回 null', () => {
  const game = new GameCore('lin');
  game.applyChoice(CHAIN_CHOICE.sceneId, CHAIN_CHOICE.questIndex, CHAIN_CHOICE.choiceIndex);
  for (let i = 0; i < 3 && !game.pendingChains.includes('roll-call') && !game.ending; i++) {
    step(game, 'library', 0, 0);
  }
  assert.strictEqual(game.pendingChains.filter(id => id === 'roll-call').length, 1, '点名不应重复进入待办');
  const first = game.resolveChain('roll-call', 0);
  assert.ok(first && first.reply, '首次处理应返回结果');
  assert.ok(!game.pendingChains.includes('roll-call'), '处理后应从待办移除');
  assert.strictEqual(game.resolveChain('roll-call', 0), null, '重复结算应返回 null');
});

test('对局状态序列化携带延迟队列、已发作链事件与全局周序号', () => {
  const game = new GameCore('lin');
  game.applyChoice(CHAIN_CHOICE.sceneId, CHAIN_CHOICE.questIndex, CHAIN_CHOICE.choiceIndex);
  const state = game.serialize();
  assert.ok(Array.isArray(state.triggers), '存档应含 triggers');
  assert.ok(Array.isArray(state.pendingChains), '存档应含 pendingChains');
  assert.strictEqual(state.absoluteWeek, game.absoluteWeek);
  assert.deepStrictEqual(state.triggers, game.triggers);
  assert.deepStrictEqual(state.pendingChains, game.pendingChains);
});

test('延迟计时用跨学期累计的 absoluteWeek：学期归零后周序号不归零', () => {
  const game = new GameCore('lin');
  // 跑完第一学期 4 周并考试，进入第二学期
  for (let i = 0; i < 4 && !game.examReady; i++) game.applyChoice('library', 0, 0);
  const questions = game.startExam();
  questions.forEach(q => game.answerExam(q.answer));
  game.finishExam();
  assert.strictEqual(game.semester, 2);
  assert.strictEqual(game.week, 1, '新学期 week 应归零为 1');
  assert.ok(game.absoluteWeek > 4, `absoluteWeek 应跨学期累计，实际 ${game.absoluteWeek}`);
});

// ============ 汇总 ============

if (failures.length) {
  console.error(`\n${failures.length} 条用例未通过：\n`);
  failures.forEach(({ name, error }) => console.error(`  ✗ ${name}\n      ${error.message}\n`));
  console.error(`通过 ${passed} 条，失败 ${failures.length} 条。\n`);
  process.exit(1);
}
console.log(`\nAll ${passed} request/chain acceptance tests passed.`);
