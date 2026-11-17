// 无头小程序 E2E：把 wx / Page / getApp 换成桩，真跑一遍 pages/game/game.js 的逻辑层。
// 这里覆盖的是「页面接线对不对、状态有没有同步对」，纯静态检查看不出来。
const assert = require('assert');
const path = require('path');

const PAGE_PATH = path.join(__dirname, '../miniprogram/pages/game/game.js');

let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
async function run() {
  for (const [name, fn] of queue) {
    try { await fn(); passed++; console.log(`✓ ${name}`); }
    catch (error) { console.error(`✗ ${name}`); throw error; }
  }
  console.log(`\nAll ${passed} miniprogram e2e tests passed.`);
}

// ———————— 桩 ————————

// 无头 canvas 上下文：任何方法都是空操作，任何属性读取都返回可调用函数
function stubContext() {
  const target = {
    canvas: { width: 390, height: 844 },
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {},
    setLineDash() {},
    getLineDash: () => []
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (typeof prop === 'symbol') return undefined;
      return () => {};
    },
    set(obj, prop, value) { obj[prop] = value; return true; }
  });
}

function stubCanvas() {
  const ctx = stubContext();
  return {
    width: 390, height: 844, getContext: () => ctx,
    // 只登记不执行，免得 loop() 无限递归
    requestAnimationFrame: () => 0
  };
}

// 记录所有 wx 副作用
function createWxStub() {
  const calls = { storage: {}, toasts: [], modals: [], navigateBack: [], clipboard: [] };
  return {
    calls,
    setStorageSync(key, value) { calls.storage[key] = value; },
    getStorageSync(key) { return calls.storage[key] === undefined ? '' : calls.storage[key]; },
    showToast(opts) { calls.toasts.push(opts); },
    showModal(opts) { calls.modals.push(opts); if (opts && opts.success) opts.success(); },
    navigateBack(opts) { calls.navigateBack.push(opts); },
    setClipboardData(opts) { calls.clipboard.push(opts); },
    getWindowInfo: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: 844 }),
    getSystemInfoSync: () => ({ pixelRatio: 2, windowWidth: 390, windowHeight: 844 }),
    createSelectorQuery: () => ({
      select: () => ({
        fields: () => ({ exec: cb => cb([{ node: stubCanvas(), width: 390, height: 844 }]) }),
        boundingClientRect: cb => ({ exec: () => cb({ left: 40, top: 600, width: 80, height: 80 }) })
      })
    })
  };
}

// 造一个页面实例：照着小程序的语义，data 是初始值的拷贝，setData 是合并
function createPage(globalData = { characterId: 'lin', seedCode: 'K7M2QX' }) {
  const wx = createWxStub();
  let definition = null;
  global.Page = def => { definition = def; };
  global.wx = wx;
  global.getApp = () => ({ globalData });

  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);

  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setDataCalls = [];
  page.setData = function (patch) {
    this.setDataCalls.push(patch);
    Object.assign(this.data, patch);
  };
  return { page, wx };
}

// 页面里用了 setTimeout(80/180) 推进，这里给一个可控的等待
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const tap = index => ({ currentTarget: { dataset: { index } } });

// ———————— 用例 ————————

test('页面加载：种子码写进 data，角色与初始属性到位', () => {
  const { CHARACTERS } = require('../miniprogram/data/content');
  const { page } = createPage({ characterId: 'su', seedCode: 'K7M2QX' });
  page.onLoad();
  assert.ok(page.core, '应当建出引擎');
  assert.strictEqual(page.data.seedCode, 'K7M2QX');
  assert.strictEqual(page.data.character.name, CHARACTERS.find(c => c.id === 'su').name);
  assert.strictEqual(page.data.statsArray.length, 5);
  assert.strictEqual(page.data.semesterName, '大一上学期');
  assert.strictEqual(page.data.weekLabel, 1);
});

test('种子码非法时不白屏：弹窗说清原因并退回选角页', () => {
  const { page, wx } = createPage({ characterId: 'lin', seedCode: 'K7M2QI' });
  page.onLoad();
  assert.strictEqual(page.broken, true);
  assert.strictEqual(wx.calls.modals.length, 1);
  assert.strictEqual(wx.calls.modals[0].title, '种子码不合法');
  assert.ok(/种子码不合法/.test(wx.calls.modals[0].content));
  assert.strictEqual(wx.calls.navigateBack.length, 1);
});

test('种子码非法时 onReady 不建渲染器，避免对着半残页面画', () => {
  const { page } = createPage({ characterId: 'lin', seedCode: 'K7M2QI' });
  page.onLoad();
  page.onReady();
  assert.strictEqual(page.renderer, undefined);
});

test('onReady 之后渲染器与画布就位', () => {
  const { page } = createPage();
  page.onLoad();
  page.onReady();
  assert.ok(page.renderer, '应当建出渲染器');
  assert.strictEqual(page.width, 390);
  assert.strictEqual(page.height, 844);
});

test('场景面板：进入场景列出该场景的全部任务', () => {
  const { page } = createPage();
  page.onLoad();
  page.showScene('library');
  assert.strictEqual(page.data.modal, 'scene');
  assert.strictEqual(page.data.scene.name, '图书馆');
  assert.strictEqual(page.data.sceneProgress.length, 2);
  assert.strictEqual(page.data.sceneProgress[0].done, false);
});

test('选任务 → 选选项 → 回到回复面板，属性变化跟着结算', () => {
  const { page, wx } = createPage();
  page.onLoad();
  page.showScene('library');
  page.chooseQuest(tap(0));
  assert.strictEqual(page.data.modal, 'quest');
  assert.ok(page.data.quest.choices.length >= 2);

  page.chooseStory(tap(0));
  assert.strictEqual(page.data.modal, 'reply');
  assert.ok(page.data.reply, '应当有回复文案');
  assert.ok(page.data.effects.length > 0, '应当列出属性变化');
  assert.ok(page.data.effects.some(item => item.name === '学识'));
  assert.ok(wx.calls.storage['campus-progress'], '应当把存档写进 storage');
  assert.strictEqual(wx.calls.storage['campus-progress'].seedCode, 'K7M2QX');
});

test('关掉回复后回到校园，引擎状态已经推进', () => {
  const { page } = createPage();
  page.onLoad();
  page.showScene('library');
  page.chooseQuest(tap(0));
  page.chooseStory(tap(0));
  page.closeReply();
  assert.strictEqual(page.data.modal, '');
  assert.strictEqual(page.core.week, 2);
  assert.strictEqual(page.data.weekLabel, 2);
});

test('选择日志：从回复里打开能回看到刚才那一次选择', () => {
  const { page } = createPage();
  page.onLoad();
  page.showScene('library');
  page.chooseQuest(tap(0));
  page.chooseStory(tap(0));
  page.openLog();
  assert.strictEqual(page.data.modal, 'log');
  assert.strictEqual(page.data.logEntries.length, 1);
  assert.strictEqual(page.data.logEntries[0].sceneId, 'library');
  assert.ok(page.data.logEntries[0].effects.length > 0);
});

test('选择日志：关掉后回到打开前的那个界面', () => {
  const { page } = createPage();
  page.onLoad();
  page.showScene('library');
  page.openLog();
  assert.strictEqual(page.data.modal, 'log');
  page.closeLog();
  assert.strictEqual(page.data.modal, 'scene', '应当回到场景面板');
  assert.strictEqual(page.data.logEntries.length, 0);
});

test('选择日志：重复体验会标出收益递减', () => {
  const { page } = createPage();
  page.onLoad();
  page.showScene('library');
  page.chooseQuest(tap(0));
  page.chooseStory(tap(0));
  page.closeReply();
  page.showScene('library');
  page.chooseQuest(tap(0));
  page.chooseStory(tap(0));
  page.openLog();
  assert.strictEqual(page.data.logEntries.length, 2);
  assert.strictEqual(page.data.logEntries[0].repeat, true);
  assert.strictEqual(page.data.logEntries[0].repeatLabel, '重复体验 · 收益递减');
  assert.strictEqual(page.data.logEntries[1].repeat, false);
});

test('期末考：答完五题进入学期结算', async () => {
  const { page } = createPage();
  page.onLoad();
  while (!page.core.examReady) {
    const scene = page.core.examReady ? null : 'library';
    page.core.applyChoice(scene, 0, 0);
  }
  assert.strictEqual(page.core.examReady, true);
  page.showExamIntro();
  assert.strictEqual(page.data.modal, 'examIntro');
  page.startExam();
  assert.strictEqual(page.data.modal, 'exam');
  assert.strictEqual(page.data.examQuestions.length, 5);

  for (let i = 0; i < 5; i++) {
    page.answerExam(tap(page.data.currentQuestion.answer));
    await sleep(220);
  }
  assert.strictEqual(page.data.modal, 'semester');
  assert.ok(page.data.semesterResult.score >= 0);
  assert.strictEqual(page.data.semester, 2);
});

test('答题时连点不会重复提交', async () => {
  const { page } = createPage();
  page.onLoad();
  while (!page.core.examReady) page.core.applyChoice('library', 0, 0);
  page.startExam();
  page.answerExam(tap(0));
  page.answerExam(tap(1));   // 第一次还在计时内，应当被挡掉
  assert.strictEqual(page.core.examAnswers.length, 1);
  await sleep(220);
  assert.strictEqual(page.core.examAnswers.length, 1);
});

test('存档写进 storage 后可以被引擎还原成同一局', () => {
  const { page, wx } = createPage();
  page.onLoad();
  page.showScene('library');
  page.chooseQuest(tap(0));
  page.chooseStory(tap(0));
  const saved = wx.calls.storage['campus-progress'];
  const { GameCore } = require('../miniprogram/engine/core');
  const restored = GameCore.restore(JSON.parse(JSON.stringify(saved)));
  assert.strictEqual(restored.seedCode, 'K7M2QX');
  assert.deepStrictEqual(restored.stats, page.core.stats);
  assert.strictEqual(restored.choiceLog.length, 1);
});

test('重新开始会清掉存档并退回选角页', () => {
  const { page, wx } = createPage();
  page.onLoad();
  page.showScene('library');
  page.chooseQuest(tap(0));
  page.chooseStory(tap(0));
  assert.ok(wx.calls.storage['campus-progress']);
  page.restart();
  assert.strictEqual(wx.calls.storage['campus-progress'], null);
  assert.strictEqual(wx.calls.navigateBack.length, 1);
});

module.exports = run().catch(error => { console.error(error); process.exit(1); });
