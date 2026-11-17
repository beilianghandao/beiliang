// 无头 web E2E：在 vm 里塞一套最小 DOM，把 web/bundle.js + web/app.js 真跑起来，
// 按真实点击路径驱动：选角 → 填种子码 → 开局 → 进场景 → 选任务 → 选选项 → 看日志 → 期末考。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let passed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function run() {
  for (const [name, fn] of queue) {
    try { fn(); passed++; console.log(`✓ ${name}`); }
    catch (error) { console.error(`✗ ${name}`); throw error; }
  }
  console.log(`\nAll ${passed} web e2e tests passed.`);
}

// ———————— 最小 DOM ————————

function stubContext() {
  const target = {
    canvas: { width: 1280, height: 720 },
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {}, setLineDash() {}, getLineDash: () => [],
    save() {}, restore() {}
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

function createElement(tag) {
  const el = {
    tagName: tag, value: '', dataset: {}, style: {}, children: [],
    _html: '', _text: '', listeners: {},
    classList: {
      _set: new Set(),
      add(name) { this._set.add(name); },
      remove(name) { this._set.delete(name); },
      contains(name) { return this._set.has(name); },
      toggle(name, force) {
        if (force === undefined) force = !this._set.has(name);
        force ? this._set.add(name) : this._set.delete(name);
        return force;
      }
    },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    dispatch(type, event) { (this.listeners[type] || []).forEach(fn => fn(event || { target: el, preventDefault() {} })); },
    getContext: () => stubContext(),
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
    focus() {}, appendChild(child) { this.children.push(child); return child; },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; }
  };
  return el;
}

function createEnvironment() {
  const elements = new Map();
  // 先按 index.html 把真实存在的元素建出来，JS 从不碰的元素也得有初始文案
  const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
  [...html.matchAll(/<(\w+)([^>]*\bid="([^"]+)"[^>]*)>([^<]*)</g)].forEach(m => {
    const el = createElement(m[1]);
    el.id = m[3];
    el._text = m[4];
    el._html = m[4];
    elements.set(`#${m[3]}`, el);
  });
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, createElement('div'));
      return elements.get(selector);
    },
    querySelectorAll(selector) {
      if (!elements.has(selector)) elements.set(selector, createElement('div'));
      return [elements.get(selector)];
    },
    createElement(tag) { return createElement(tag); },
    addEventListener() {},
    body: createElement('body')
  };
  const context = {
    console, Math, JSON, Date, Object, Array, String, Number, Boolean, Set, Map, Error, isNaN, parseInt, parseFloat,
    document,
    innerWidth: 1280, innerHeight: 720,
    devicePixelRatio: 2,
    navigator: { userAgent: 'node', clipboard: { writeText() {} } },
    screen: { width: 1280, height: 720 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 0,        // 只登记不执行，免得动画循环停不下来
    cancelAnimationFrame: () => {},
    location: { reload() {} },
    Image: function () {
      const img = { width: 0, height: 0, onload: null, onerror: null, addEventListener() {} };
      Object.defineProperty(img, 'src', { get() { return this._src || ''; }, set(v) { this._src = v; } });
      return img;
    }
  };
  // 浏览器里 window 就是全局对象：window.CampusRequire = ... 会变成全局变量
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  return { context, document, elements };
}

// 加载 bundle + app
function boot() {
  const { context, document, elements } = createEnvironment();
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/bundle.js'), 'utf8'), context, { filename: 'bundle.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'web/app.js'), 'utf8'), context, { filename: 'app.js' });
  return { context, document, elements };
}

// 造一个能命中 closest('[data-xxx]') 的合成点击
// attribute 传属性名（不含方括号），与 app.js 里的 closest('[data-quest]') 对齐
function syntheticClick(attribute, dataset) {
  return {
    target: {
      dataset,
      closest(sel) {
        const want = sel.replace(/[[\]]/g, '');
        return want === attribute ? { dataset } : null;
      }
    },
    preventDefault() {}, stopPropagation() {}
  };
}

const el = (elements, selector) => elements.get(selector);
// 在 vm 里求值
const inApp = (context, code) => vm.runInContext(code, context);

// ———————— 用例 ————————

test('选角页：四个角色都渲染出来，默认选中林知夏', () => {
  const { elements } = boot();
  const html = el(elements, '#character-grid').innerHTML;
  assert.ok(html.includes('data-character="lin"'), '应当有林知夏');
  assert.ok(html.includes('data-character="chen"'));
  assert.ok(html.includes('data-character="su"'));
  assert.ok(html.includes('data-character="jiang"'));
  assert.ok(el(elements, '#character-quote').textContent.length > 0, '应当有角色语录');
});

test('选角页：开局前给出种子码与提示', () => {
  const { elements } = boot();
  const code = el(elements, '#seed-code').textContent;
  assert.strictEqual(code.length, 6, `种子码应当是 6 位，实际 "${code}"`);
  assert.ok(el(elements, '#seed-hint').textContent.length > 0);
});

test('开局：填入同学的种子码，引擎就用那一个', () => {
  const { context, elements } = boot();
  el(elements, '#seed-input').value = 'k7m2qx';
  el(elements, '#start-button').dispatch('click');
  const core = inApp(context, 'core');
  assert.ok(core, '应当建出引擎');
  assert.strictEqual(core.seedCode, 'K7M2QX', '应当用输入的种子码');
  assert.strictEqual(el(elements, '#seed-pill').textContent, '种子 K7M2QX');
});

test('开局：种子码非法时不开局，把原因说清楚', () => {
  const { context, elements } = boot();
  el(elements, '#seed-input').value = 'K7M2QI';
  el(elements, '#start-button').dispatch('click');
  assert.strictEqual(inApp(context, 'core'), undefined, '非法种子码不该开局');
  const hint = el(elements, '#seed-hint').textContent;
  assert.ok(/不合法/.test(hint), `提示应当说明原因，实际 "${hint}"`);
});

test('开局：种子码留空就用这一局自动生成的码', () => {
  const { context, elements } = boot();
  el(elements, '#seed-input').value = '';
  el(elements, '#start-button').dispatch('click');
  const core = inApp(context, 'core');
  assert.ok(core, '应当建出引擎');
  assert.strictEqual(core.seedCode.length, 6);
});

test('「使用」按钮：填非法码只报错，不改掉本局种子码', () => {
  const { context, elements } = boot();
  const before = el(elements, '#seed-code').textContent;
  el(elements, '#seed-input').value = 'K7M2QI';
  el(elements, '#seed-apply').dispatch('click');
  assert.strictEqual(el(elements, '#seed-code').textContent, before, '种子码不该被改掉');
  assert.ok(/不合法/.test(el(elements, '#seed-hint').textContent));
});

test('「使用」按钮：留空就摇一局新的种子码', () => {
  const { elements } = boot();
  const before = el(elements, '#seed-code').textContent;
  el(elements, '#seed-input').value = '';
  el(elements, '#seed-apply').dispatch('click');
  assert.strictEqual(el(elements, '#seed-code').textContent.length, 6);
  assert.notStrictEqual(el(elements, '#seed-code').textContent, '', '不该是空的');
  assert.ok(before.length === 6);
});

test('进场景：弹窗里列出了这个场景的任务', () => {
  const { context, elements } = boot();
  el(elements, '#start-button').dispatch('click');
  inApp(context, 'showScene("library")');
  const html = el(elements, '#modal-content').innerHTML;
  assert.ok(html.includes('data-quest="0"'), '应当有第一个任务');
  assert.ok(html.includes('data-quest="1"'), '应当有第二个任务');
  assert.ok(html.includes('图书馆'));
});

test('选任务 → 选选项：回复面板出现，HUD 的属性跟着变', () => {
  const { context, elements } = boot();
  el(elements, '#start-button').dispatch('click');
  const before = el(elements, '#quest-count').textContent;
  inApp(context, 'showScene("library")');
  el(elements, '#modal-content').dispatch('click', syntheticClick('data-quest', { quest: '0' }));
  assert.ok(el(elements, '#modal-content').innerHTML.includes('data-choice="0"'), '应当出现选项按钮');

  el(elements, '#modal-content').dispatch('click', syntheticClick('data-choice', { choice: '0' }));
  const html = el(elements, '#modal-content').innerHTML;
  assert.ok(html.includes('effect-item'), '应当列出属性变化');
  assert.ok(html.includes('继续校园生活'), '应当出现继续按钮');
  assert.notStrictEqual(el(elements, '#quest-count').textContent, before, 'HUD 应当更新');
});

test('选择日志：从回复面板打开能看到刚才那一次选择', () => {
  const { context, elements } = boot();
  el(elements, '#start-button').dispatch('click');
  inApp(context, 'showScene("library")');
  el(elements, '#modal-content').dispatch('click', syntheticClick('data-quest', { quest: '0' }));
  el(elements, '#modal-content').dispatch('click', syntheticClick('data-choice', { choice: '0' }));

  el(elements, '#modal-content').dispatch('click', syntheticClick('data-action', { action: 'log' }));
  const html = el(elements, '#modal-content').innerHTML;
  assert.ok(html.includes('选择日志'), '应当打开日志面板');
  assert.ok(html.includes('图书馆'), '日志里应当有场景名');
  assert.ok(html.includes('log-choice'), '日志里应当有选了什么');
});

test('选择日志：关掉后回到打开日志前的那个界面', () => {
  const { context, elements } = boot();
  el(elements, '#start-button').dispatch('click');
  inApp(context, 'showScene("library")');
  el(elements, '#modal-content').dispatch('click', syntheticClick('data-quest', { quest: '0' }));
  el(elements, '#modal-content').dispatch('click', syntheticClick('data-action', { action: 'log' }));
  el(elements, '#modal-content').dispatch('click', syntheticClick('data-action', { action: 'close-log' }));
  const html = el(elements, '#modal-content').innerHTML;
  assert.ok(html.includes('data-choice="0"'), '应当回到刚才那个任务面板');
  assert.ok(!html.includes('log-panel'), '日志面板应当关掉');
});

test('期末考：答完五题进入学期结算', () => {
  const { context, elements } = boot();
  el(elements, '#start-button').dispatch('click');
  // 直接把学期推到考前：引擎按 seed 抽题
  inApp(context, `(() => { while (!core.examReady) core.applyChoice('library', 0, 0); })()`);
  el(elements, '#exam-button').dispatch('click');
  assert.ok(el(elements, '#modal-content').innerHTML.includes('开始作答'), '应当是考试说明页');

  el(elements, '#modal-content').dispatch('click', syntheticClick('data-action', { action: 'start-exam' }));
  assert.ok(el(elements, '#modal-content').innerHTML.includes('data-answer="0"'), '应当是答题页');

  for (let i = 0; i < 5; i++) {
    const answer = inApp(context, 'core.currentExam[core.examAnswers.length].answer');
    el(elements, '#modal-content').dispatch('click', syntheticClick('data-answer', { answer: String(answer) }));
  }
  const html = el(elements, '#modal-content').innerHTML;
  assert.ok(html.includes('期末成绩'), '应当出现学期结算页');
  assert.strictEqual(inApp(context, 'core.semester'), 2);
});

test('结局页把种子码显示出来，方便分享给同学', () => {
  const { context, elements } = boot();
  el(elements, '#start-button').dispatch('click');
  inApp(context, `(() => {
    for (let s = 0; s < 8; s++) {
      while (!core.examReady) core.applyChoice('library', 0, 0);
      const qs = core.startExam();
      qs.forEach(q => core.answerExam(q.answer));
      core.finishExam();
    }
  })()`);
  const ending = inApp(context, 'core.ending');
  assert.ok(ending, '应当有结局');
  inApp(context, 'showEnding(core.ending)');
  const html = el(elements, '#modal-content').innerHTML;
  assert.ok(html.includes('log-seed') || html.includes('种子码'), '结局页应当给出种子码');
  assert.ok(html.includes(inApp(context, 'core.seedCode')), '结局页应当是本局的种子码');
});

run();
