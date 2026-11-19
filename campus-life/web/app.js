const { CHARACTERS, STAT_META, EVENTS, NPCS, BUILDINGS, REQUESTS, CHAIN_EVENTS, LEGACY_OPTIONS, HIDDEN_EVENTS, affinityTier, getExamQuestions, semesterLabel, statName } = CampusRequire('content');
const { GameCore, EXAM_QUESTION_MS } = CampusRequire('core');
const { buildChoiceLogView } = CampusRequire('choicelog');
const { randomSeedCode, resolveSeedInput, applySeedInput } = CampusRequire('random');
const Save = CampusRequire('save');
const { CampusRenderer, drawSceneArt, preloadStandees } = CampusRequire('renderer');
const { CampusWorld } = CampusRequire('world');
const { ACHIEVEMENTS, achievementById, buildAchievementList } = CampusRequire('achievements');

// event id -> 头像图片名（从 NPCS 反查）
const eventAvatar = {};
const npcByEvent = {};
NPCS.forEach(n => { eventAvatar[n.event] = n.avatar; npcByEvent[n.event] = n; });

const $ = selector => document.querySelector(selector);
const selectScreen = $('#select-screen');
const gameScreen = $('#game-screen');
const modalMask = $('#modal-mask');
const modalContent = $('#modal-content');
const paleColors = ['#f0d9ce', '#d8e1eb', '#efe0c4', '#d5e4d8'];
// 因果面板的分类标签
const CAUSE_TYPES = { all: '全部', quest: '任务', request: '关系', chain: '后果', hidden: '隐藏', exam: '学业', legacy: '继承' };
const CAUSE_EMPTY = { quest: '这一段还没有可选的任务。', hidden: '还没有解锁隐藏事件。', request: '还没有人向你开口。', chain: '还没有滚出后果。', exam: '还没有考过试。', legacy: '这一局没有继承任何东西。', all: '还没有做过任何选择。' };
// 成就等级元信息（图鉴与飘条共用）
const TIER_META = { bronze: { label: '铜', color: '#b08d57' }, silver: { label: '银', color: '#8d9bab' }, gold: { label: '金', color: '#c49a3f' }, hidden: { label: '秘', color: '#8a6bd1' } };
let selected = 'lin';
let meta = Save.readMeta();
let legacyPick = Save.defaultLegacy(meta);
let causeFilter = 'all';
let core, world, renderer, canvas, ctx, modal = '', modalMode = '', sceneId = '', questIndex = 0, dialogueRound = 0, artLoop = null;
let activeRequest = null, activeChain = null, toastTimer = null, pendingNotice = null, runRecorded = false;
let lastTime = performance.now();
// 种子码：开局前可以换，进了校园就一直带着，同码必然复现同一局
let seedCode = randomSeedCode(Math.random);
// 打开「选择日志」前的界面，关掉日志时原样回去
let logHistory = null;
let replyHtml = '';
// 换面板会改高度，「查看选择日志」这类链接可能正好落到刚才选项的位置上，
// 连点两下就会点穿。每次换面板后短暂屏蔽点击（280ms），正常点击完全无感。
let swapGuard = 0;

// 哪些 NPC 带着请求找上门（给渲染器画感叹号用）
function requestNpcMap() {
  const map = {};
  core.pendingRequests().forEach(request => { map[request.npc] = true; });
  return map;
}

// 右上角轻轻飘一条提示，不打断当前操作
function toast(title, detail) {
  const el = $('#toast');
  el.innerHTML = `<b>${title}</b>${detail ? `<small>${detail}</small>` : ''}`;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4200);
}

// 有人来敲门：让 NPC 真的走过来
function announceRequest(request) {
  const npc = NPCS.find(n => n.id === request.npc);
  if (!npc) return;
  world.sendNpc(npc.id);
  pendingNotice = { title: `${npc.name} 来找你了`, detail: request.title };
}

// 关掉当前弹窗之后，再把排队中的提示放出来
function flushNotice() {
  if (!pendingNotice) return;
  const notice = pendingNotice;
  pendingNotice = null;
  toast(notice.title, notice.detail);
}

function characterCards() {
  $('#character-grid').innerHTML = CHARACTERS.map((c, index) => `
    <button class="character-card ${selected === c.id ? 'selected' : ''}" data-character="${c.id}" style="--theme:${c.color};--hair:${c.hair};--skin:${c.skin};--pale:${paleColors[index]}">
      ${selected === c.id ? '<span class="selected-mark">✓</span>' : ''}
      <div class="portrait"><div class="portrait-bg"></div><img class="portrait-img" src="assets/characters/${c.avatar}" alt="${c.name}"></div>
      <div class="character-name">${c.name}<span class="character-number">0${index + 1}</span></div><div class="character-title">${c.title}</div>
      <div class="mini-stats"><span>学识<b>${c.stats.knowledge}</b></span><span>人缘<b>${c.stats.social}</b></span><span>心态<b>${c.stats.mood}</b></span></div><div class="trait">${c.trait}</div>
    </button>`).join('');
  const current = CHARACTERS.find(c => c.id === selected);
  $('#character-quote').textContent = current.quote;
}

$('#character-grid').addEventListener('click', event => {
  const card = event.target.closest('[data-character]');
  if (!card) return;
  selected = card.dataset.character;
  characterCards();
});
$('#start-button').addEventListener('click', startGame);

// 种子码：默认给一局新的，也可以换成别人的种子码复现同一局
function syncSeedCode() {
  $('#seed-code').textContent = seedCode;
}
function showSeedHint(text, error = false) {
  const hint = $('#seed-hint');
  hint.textContent = text;
  hint.classList.toggle('error', error);
}
// 按下「使用」：留空就摇一局新的，填了就用填的那个，填错了说清楚并退回自动生成的码
function useSeedCode() {
  const result = applySeedInput($('#seed-input').value, Math.random);
  if (result.error) {
    showSeedHint(`${result.error}；本局仍用种子码 ${seedCode}`, true);
    return;
  }
  seedCode = result.code;
  syncSeedCode();
  $('#seed-input').value = seedCode;
  showSeedHint(result.hint);
}
$('#seed-apply').addEventListener('click', useSeedCode);
$('#seed-input').addEventListener('keydown', event => { if (event.key === 'Enter') useSeedCode(); });
// ============ 周目继承：上一局结束后，可以带走一样东西 ============
function renderLegacy() {
  const section = $('#legacy-section');
  const options = Save.legacyOptions(meta);
  const show = (meta.playthroughs || 0) > 0;
  section.classList.toggle('hidden', !show);
  if (!show) return;
  const info = Save.summary(meta);
  const last = info.lastEnding;
  $('#legacy-note').textContent = `第 ${meta.playthroughs + 1} 周目 · 上一局${last ? `「${last.title}」${last.score} 分` : '未走完'} · 隐藏事件 ${info.hiddenCleared.length} / ${info.hiddenTotal}`;
  const cards = options.map(option => `
    <button class="legacy-card ${legacyPick === option.id ? 'selected' : ''} ${option.unlocked ? '' : 'locked'}" data-legacy="${option.id}" ${option.unlocked ? '' : 'disabled'}>
      <span class="legacy-icon" style="--tone:${option.color}">${option.unlocked ? option.icon : '锁'}</span>
      <span class="legacy-body">
        <b>${option.name}</b>
        <small>${option.unlocked ? option.desc : option.progressText}</small>
        <em>${option.unlocked ? option.effectText : '尚未满足继承条件'}</em>
      </span>
      ${legacyPick === option.id ? '<span class="legacy-mark">✓</span>' : ''}
    </button>`).join('');
  const noneCard = `
    <button class="legacy-card plain ${legacyPick ? '' : 'selected'}" data-legacy="none">
      <span class="legacy-icon" style="--tone:#9a958a">空</span>
      <span class="legacy-body"><b>什么都不带</b><small>像第一次那样，从零开始。</small><em>不继承任何属性或道具</em></span>
      ${legacyPick ? '' : '<span class="legacy-mark">✓</span>'}
    </button>`;
  $('#legacy-grid').innerHTML = cards + noneCard;
}

$('#legacy-grid').addEventListener('click', event => {
  const card = event.target.closest('[data-legacy]');
  if (!card || card.disabled) return;
  legacyPick = card.dataset.legacy === 'none' ? null : card.dataset.legacy;
  renderLegacy();
});

function startGame() {
  // 开局前再确认一次输入框：留空就用这一局自动生成的码，填了就用填的那个，填错了不开局
  const result = resolveSeedInput($('#seed-input').value);
  if (result.error) {
    showSeedHint(`${result.error}；请改对后再开始，或清空输入框用本局种子码 ${seedCode}`, true);
    return;
  }
  if (!result.blank) { seedCode = result.code; syncSeedCode(); }
  // 先把所有角色的场景立绘丢进加载队列，避免进游戏后小人先是用线条画、再突然变成立绘
  preloadStandees(CHARACTERS.map(c => c.id).concat(NPCS.map(n => n.id)));
  runRecorded = false;
  core = new GameCore(selected, { seedCode, playthrough: (meta.playthroughs || 0) + 1, legacyId: legacyPick || null });
  world = new CampusWorld();
  selectScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  canvas = $('#campus'); ctx = canvas.getContext('2d');
  renderer = new CampusRenderer(ctx, innerWidth, innerHeight);
  resizeCanvas(); updateHUD(); closeModal();
  if (core.legacy) toast(`第 ${core.playthrough} 周目 · 继承了「${core.legacy.name}」`, core.legacy.effectText);
  lastTime = performance.now(); requestAnimationFrame(loop);
}

// 一局走完就把成绩并进存档：下一周目的继承列表靠它来决定哪些能选
function recordRunOnce() {
  if (runRecorded) return;
  runRecorded = true;
  meta = Save.recordRun(core);
  legacyPick = Save.defaultLegacy(meta);
}

function resizeCanvas() {
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  canvas.style.width = `${innerWidth}px`; canvas.style.height = `${innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderer.resize(innerWidth, innerHeight);
}
window.addEventListener('resize', resizeCanvas);

function loop(now) {
  if (!core || gameScreen.classList.contains('hidden')) return;
  const delta = now - lastTime; lastTime = now;
  if (!modal) {
    const oldId = world.nearby && world.nearby.id;
    const nearby = world.update(delta);
    const newId = nearby && nearby.id;
    if (oldId !== newId) updateNearby(nearby);
  } else world.player.moving = false;
  renderer.nearby = world.nearby;
  renderer.npcPositions = world.visitorPositions();
  renderer.requestNpcs = requestNpcMap();
  renderer.render(world.player, core.character, now);
  requestAnimationFrame(loop);
}

/* ============ 选项不显示数值 ============
   选项下面那行「心态 +1」会让人照着数字选，改成只看方向：
   1~2 分一个箭头、3~5 两个、6+ 三个，负数对应 ↓。
   结算之后的效果条、日志、属性卡仍然显示具体数值。 */
function arrowOf(value) {
  const v = Number(value) || 0;
  if (!v) return '·';
  const steps = Math.abs(v) >= 6 ? 3 : Math.abs(v) >= 3 ? 2 : 1;
  return (v > 0 ? '↑' : '↓').repeat(steps);
}

function statLabel(key) {
  return key === 'energy' ? '精力' : (STAT_META[key] ? STAT_META[key].name : key);
}

/* 数据里写死的选项提示（如「心态 +1 · 精力 -2」）统一改写成箭头 */
function softHint(text) {
  return String(text || '').replace(/([\u4e00-\u9fa5]{2})\s*([+-])\s*(\d+)/g,
    (m, name, sign, num) => `${name} ${arrowOf(Number(sign + num))}`);
}

function updateHUD() {
  $('#week-pill').textContent = `${core.semesterName} · 第 ${Math.min(core.week, core.weeksPerSemester)} / ${core.weeksPerSemester} 周`;
  $('#profile-avatar').innerHTML = `<img src="assets/characters/${core.character.avatar}" alt="${core.character.name}">`; $('#profile-avatar').style.background = 'transparent';
  $('#profile-name').textContent = core.character.name; $('#profile-title').textContent = core.character.title;
  $('#energy-value').textContent = core.energy; $('#energy-bar').style.width = `${core.energy}%`;
  $('#stats-row').innerHTML = Object.entries(STAT_META).map(([key, meta]) => `<span class="stat-chip"><i style="color:${meta.color}">${meta.icon}</i>${meta.name}<b>${core.stats[key]}</b></span>`).join('');
  $('#exam-button').classList.toggle('hidden', !core.examReady);
  // 有等着处理的事，右上角就亮一个红点
  const pending = core.pendingChainEvents().length + core.pendingRequests().length;
  const badge = $('#event-badge');
  badge.textContent = pending;
  badge.classList.toggle('hidden', !pending);
  $('#event-button').classList.toggle('alert', pending > 0);
  const seedPill = $('#seed-pill');
  if (seedPill) seedPill.textContent = `种子 ${core.seedCode}`;
  // 因果面板：做了多少选择，角标就是多少
  const causeBadge = $('#cause-badge');
  causeBadge.textContent = core.choiceLog.length;
  causeBadge.classList.toggle('hidden', !core.choiceLog.length);
  // 继承来的东西挂在状态卡下面，随时知道自己带了什么重开
  const chip = $('#legacy-chip');
  chip.classList.toggle('hidden', !core.legacy);
  if (core.legacy) {
    chip.innerHTML = `<i style="--tone:${core.legacy.color}">${core.legacy.icon}</i>第 ${core.playthrough} 周目 · 继承「${core.legacy.name}」<span>${core.legacy.effectText}</span>`;
  }
  // 成就计数
  const achvCount = $('#achv-count');
  if (achvCount) achvCount.textContent = `已解锁成就 ${core.achievements.length} / ${ACHIEVEMENTS.length}`;
}

/* 交互只留一条路：走近之后点提示卡片（和「最新版游戏」分支一致，没有右下角圆按钮）。
   E / 空格键仍可代替点击。 */
function updateNearby(nearby) {
  const toast = $('#location-toast');
  toast.classList.toggle('hidden', !nearby);
  if (!nearby) return;
  const tip = nearby.type === 'npc' ? '点一下，和他聊两句' : '点击进入，查看可做的任务';
  toast.setAttribute('aria-label', nearby.type === 'npc' ? `与${nearby.name}交谈` : `进入${nearby.name}`);
  toast.innerHTML = `<span>⌖</span><div><b>${nearby.name}</b><small>${tip}</small></div>`;
}

function openModal(name, html, mode = '') {
  modal = name; modalMode = mode; stopArt();
  swapGuard = performance.now() + 280;
  world.setInput(0, 0); Object.keys(world.keys).forEach(key => world.keys[key] = false);
  modalContent.innerHTML = html;
  modalMask.classList.remove('hidden');
  modalMask.classList.toggle('story-mask', mode === 'story');
  modalMask.classList.toggle('scene-mode', mode === 'scene');
}
function closeModal() { modal = ''; modalMode = ''; stopArt(); stopExamTicker(); modalMask.classList.add('hidden'); modalContent.innerHTML = ''; }

function stopArt() { if (artLoop) cancelAnimationFrame(artLoop); artLoop = null; }
function startArt(canvasEl, art) {
  if (!canvasEl || !art) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const rect = canvasEl.getBoundingClientRect();
  canvasEl.width = rect.width * dpr; canvasEl.height = rect.height * dpr;
  const actx = canvasEl.getContext('2d'); actx.scale(dpr, dpr);
  const frame = now => { drawSceneArt(actx, rect.width, rect.height, art, now); if (artLoop) artLoop = requestAnimationFrame(frame); };
  artLoop = requestAnimationFrame(frame);
}

function artCanvas(art) {
  return `<canvas id="scene-full-art"></canvas><div class="scene-vignette" style="background:linear-gradient(180deg,transparent 30%,${art.sky[0]}ee 100%)"></div>`;
}

// 选择日志：随时翻看做过哪些选择、影响了什么
const logLink = '<button class="panel-link" data-action="log">查看选择日志 ›</button>';

function showReply(html = replyHtml) {
  replyHtml = html;
  openModal('reply', html, 'scene');
  startArt($('#scene-full-art'), EVENTS[sceneId].art);
}

function showLog() {
  logHistory = modal && modal !== 'log' ? { name: modal, html: modalContent.innerHTML, mode: modalMode } : null;
  const entries = buildChoiceLogView(core.choiceLog);
  const list = entries.length ? entries.map(item => `
    <div class="log-entry">
      <div class="log-meta"><span>${item.semesterName} · 第 ${item.week} 周</span><span class="log-scene">${item.sceneName}</span></div>
      <div class="log-quest">${item.questTitle}</div>
      <div class="log-choice">${item.choiceText}</div>
      <div class="log-effects">${item.effects.map(e => `<span class="effect-item ${e.value >= 0 ? 'positive' : 'negative'}">${e.name} ${e.value >= 0 ? '+' : ''}${e.value}</span>`).join('')}<span class="log-flag${item.repeat ? ' repeat' : ''}">${item.repeatLabel}</span></div>
    </div>`).join('') : '<p class="log-empty">还没有做过任何选择，去校园里走走吧。</p>';
  openModal('log', `<article class="small-panel log-panel"><button class="panel-close" data-action="close-log">×</button><div class="panel-kicker">CHOICE LOG</div><h2 class="panel-title">选择日志</h2><div class="log-list">${list}</div><button class="primary-button" data-action="close-log">回到刚才的地方</button></article>`);
}

function closeLog() {
  const back = logHistory; logHistory = null;
  if (!back) { closeModal(); updateHUD(); return; }
  // 原样还原刚才那一屏：之前对 reply 调 showReply() 用的是全局 replyHtml，
  // 而多轮问答是直接 openModal('reply', ...) 打开的，replyHtml 里是空串，
  // 结果「回到刚才的地方」回到一块空白面板（看起来像直接掉回地图）。
  openModal(back.name, back.html, back.mode);
  if (back.mode === 'scene' && EVENTS[sceneId]) startArt($('#scene-full-art'), EVENTS[sceneId].art);
}

function showScene(id) {
  if (core.examReady) return showExamIntro();
  const scene = EVENTS[id]; if (!scene) return;
  sceneId = id;
  const progress = core.sceneProgress(id);
  const npc = npcByEvent[id];
  const request = npc ? core.pendingRequestFor(npc.id) : null;
  const affinity = npc ? core.affinityOf(npc.id) : 0;
  const tier = npc ? core.affinityTierOf(npc.id) : { name: '生疏', color: '#9a958a' };
  openModal('scene', `${artCanvas(scene.art)}<article class="story-panel scene-panel float-panel">
    <div class="story-visual scene-art-wrap" style="background:linear-gradient(130deg,${scene.art.sky[0]},${scene.art.sky[1]})"><div class="story-place">${scene.place}</div><div class="scene-title-over">${scene.name}</div><div class="story-lines"></div></div>
    <div class="story-content">
      <div class="story-kicker">SCENE · ${core.semesterName}</div>
      <h2 class="story-title">${scene.name} · 可接任务</h2>
      <div class="speaker-row"><div class="speaker-avatar" style="background:${scene.color}"><img src="assets/characters/${eventAvatar[id] || 'npc1_avatar.png'}" alt="${scene.speaker}"></div><div><div class="speaker-name">${scene.speaker}</div><div class="speaker-role">${scene.role}</div></div>${npc ? `<span class="affinity-chip" style="--tier:${tier.color}">好感 ${affinity} · ${tier.name}</span>` : ''}</div>
      ${request ? `<button class="quest-item request-item" data-request="${request.id}">
        <span class="quest-badge request-badge">来找你了</span>
        <span class="quest-name">${request.title}</span>
        <span class="quest-meta-line">${npc.name} 有事相求 · 答应或拒绝都会影响你们的关系</span>
        <span class="quest-arrow">›</span>
      </button>` : ''}
      <div class="quest-list">${progress.map(p => {
        if (p.locked) return `<div class="quest-item locked-item">
          <span class="quest-badge locked-badge">隐藏事件</span>
          <span class="quest-name">？？？</span>
          <span class="quest-meta-line">解锁条件：${p.requireText}</span>
          <span class="quest-arrow">锁</span>
        </div>`;
        return `<button class="quest-item ${p.done ? 'done' : ''} ${p.hidden ? 'hidden-quest' : ''}" data-quest="${p.index}">
        <span class="quest-badge">${p.hidden ? '隐藏事件' : p.done ? '✓ 已完成' : `任务 ${p.index + 1}`}</span>
        <span class="quest-name">${p.quest.title}</span>
        <span class="quest-meta-line">${p.done && p.times > 1 ? `已重复 ${p.times - 1} 次 · 收益递减` : p.done ? '可重温 · 收益递减' : `${p.quest.rounds ? `${p.quest.rounds.length} 轮问答 · ` : ''}${p.quest.choices.length} 个最终选择`}</span>
        <span class="quest-arrow">›</span>
      </button>`;
      }).join('')}</div>
      <div class="story-footer">每次任务消耗 1 周；每学期 4 周，期末后进入下一学期 · 隐藏事件 ${core.hiddenCleared.length} / ${core.totalHiddenQuests}</div>
      ${logLink}
    </div></article>`, 'scene');
  startArt($('#scene-full-art'), scene.art);
}

/* 多轮问答的上下文：quest.rounds 由 data/expansion.js 在启动时生成；
   没有 rounds 的老任务按单轮处理，逻辑完全兼容。 */
function questRoundsOf(quest) {
  return quest && quest.rounds && quest.rounds.length ? quest.rounds : null;
}

function showQuest(index, keepRound) {
  const scene = EVENTS[sceneId]; const quest = core.questAt(sceneId, index);
  if (!quest) return;
  if (!keepRound || questIndex !== index) dialogueRound = 0;
  questIndex = index;
  const key = `${sceneId}:${index}`; const done = core.completed.includes(key);
  const hidden = !!quest.requires;
  const rounds = questRoundsOf(quest);
  const total = rounds ? rounds.length : 1;
  const roundIndex = rounds ? Math.min(dialogueRound, total - 1) : 0;
  const round = rounds ? rounds[roundIndex] : quest;
  const isFinal = roundIndex >= total - 1;
  const roundTag = total > 1 ? ` · 第 ${roundIndex + 1} / ${total} 轮` : '';
  const footer = isFinal
    ? '选择没有标准答案，它会塑造独一无二的你 —— 每一次选择都会写进「因」面板'
    : `过程问答 ${roundIndex + 1} / ${total} · 这一轮只小幅影响属性，最后才结算整段故事`;
  openModal('quest', `${artCanvas(scene.art)}<article class="story-panel float-panel">
    <div class="story-visual scene-art-wrap" style="background:linear-gradient(130deg,${scene.art.sky[0]},${scene.art.sky[1]})"><div class="story-place">${scene.place}</div><div class="story-symbol">${scene.avatar}</div><div class="story-lines"></div></div>
    <div class="story-content"><div class="story-kicker">${hidden ? 'HIDDEN SCENE · 只有这一周目才看得到' : `CAMPUS STORY · ${done ? 'REPLAY' : 'NEW'}`}${roundTag} · ${core.semesterName} 第${Math.min(core.week, 4)}周</div>
      <h2 class="story-title">${quest.title}</h2>
      <div class="speaker-row"><div class="speaker-avatar" style="background:${scene.color}"><img src="assets/characters/${eventAvatar[sceneId] || 'npc1_avatar.png'}" alt="${scene.speaker}"></div><div><div class="speaker-name">${scene.speaker}</div><div class="speaker-role">${scene.role}</div></div>${hidden ? '<span class="affinity-chip hidden-chip">隐藏事件</span>' : ''}</div>
      <div class="story-text">${round.text}</div>
      <div class="choices">${round.choices.map((choice, i) => `<button class="choice" data-choice="${i}"><span class="choice-index">${i + 1}</span><span class="choice-body">${choice.text}<span class="choice-hint">${softHint(choice.hint)}${done ? ' · 重温收益递减' : ''}</span></span><span class="choice-arrow">›</span></button>`).join('')}</div>
      <div class="story-footer">${footer}</div>
      ${logLink}
    </div></article>`, 'scene');
  startArt($('#scene-full-art'), scene.art);
}

function effectChips(applied) {
  return Object.entries(applied || {}).map(([key, value]) => `<span class="effect-item ${value >= 0 ? 'positive' : 'negative'}">${key === 'energy' ? '精力' : STAT_META[key].name} ${value >= 0 ? '+' : ''}${value}</span>`).join('');
}
function effectHint(effects) {
  return Object.keys(effects || {}).map(key => `${statLabel(key)} ${arrowOf(effects[key])}`).join(' · ');
}

// NPC 带着请求找上门：答应还是拒绝，由你决定
function showRequest(request) {
  const npc = NPCS.find(n => n.id === request.npc);
  if (!npc) return;
  activeRequest = request;
  const scene = EVENTS[npc.event];
  const tier = core.affinityTierOf(npc.id);
  openModal('request', `${artCanvas(scene.art)}<article class="story-panel float-panel">
    <div class="story-visual scene-art-wrap" style="background:linear-gradient(130deg,${scene.art.sky[0]},${scene.art.sky[1]})"><div class="story-place">${scene.place}</div><div class="story-symbol">${npc.name.charAt(0)}</div><div class="story-lines"></div></div>
    <div class="story-content">
      <div class="story-kicker">INCOMING REQUEST · ${core.semesterName}</div>
      <h2 class="story-title">${request.title}</h2>
      <div class="speaker-row"><div class="speaker-avatar" style="background:${npc.color}"><img src="assets/characters/${npc.avatar}" alt="${npc.name}"></div><div><div class="speaker-name">${npc.name}</div><div class="speaker-role">${scene.role}</div></div><span class="affinity-chip" style="--tier:${tier.color}">好感 ${core.affinityOf(npc.id)} · ${tier.name}</span></div>
      <div class="story-text">${request.text}</div>
      <div class="choices">${request.choices.map((choice, i) => `<button class="choice" data-request-choice="${i}"><span class="choice-index">${i + 1}</span><span class="choice-body">${choice.text}<span class="choice-hint">${effectHint(choice.effects)} · 好感 ${arrowOf(choice.affinity)}</span></span><span class="choice-arrow">›</span></button>`).join('')}</div>
      <div class="story-footer">关系需要经营 —— 答应还是拒绝，都会被记住</div>
    </div></article>`, 'scene');
  startArt($('#scene-full-art'), scene.art);
}

// 连锁事件：之前那个小决定，终于滚到了眼前
function showChain(event) {
  activeChain = event;
  const scene = EVENTS[event.scene];
  openModal('chain', `${artCanvas(scene.art)}<article class="story-panel float-panel">
    <div class="story-visual scene-art-wrap" style="background:linear-gradient(130deg,${scene.art.sky[0]},${scene.art.sky[1]})"><div class="story-place">${event.place}</div><div class="story-symbol">${event.speaker.charAt(0)}</div><div class="story-lines"></div></div>
    <div class="story-content">
      <div class="story-kicker">CONSEQUENCE · 连锁第 ${event.level} 级</div>
      <h2 class="story-title">${event.title}</h2>
      <div class="speaker-row"><div class="speaker-avatar" style="background:${scene.color}"><img src="assets/characters/${eventAvatar[event.scene] || 'npc1_avatar.png'}" alt="${event.speaker}"></div><div><div class="speaker-name">${event.speaker}</div><div class="speaker-role">${event.role}</div></div></div>
      <div class="story-text">${event.text}</div>
      <div class="choices">${event.choices.map((choice, i) => `<button class="choice" data-chain-choice="${i}"><span class="choice-index">${i + 1}</span><span class="choice-body">${choice.text}<span class="choice-hint">${effectHint(choice.effects)}</span></span><span class="choice-arrow">›</span></button>`).join('')}</div>
      <div class="story-footer">一件小事，滚成了另一件事</div>
    </div></article>`, 'scene');
  startArt($('#scene-full-art'), scene.art);
}

// 右上角的「等着你的事」：待处理的连锁、还在等回复的请求、以及还没发作的延迟队列
function showEvents() {
  const chains = core.pendingChainEvents();
  const triggers = core.scheduledTriggers();
  const requests = core.pendingRequests();
  openModal('events', `<article class="small-panel"><button class="panel-close" data-action="close">×</button><div class="panel-kicker">ON YOUR DESK</div><h2 class="panel-title">等着你的事</h2>
    ${chains.length ? `<div class="event-list">${chains.map(event => `<button class="event-row" data-chain="${event.id}"><span class="event-level">连锁 ${event.level}</span><span class="event-main"><b>${event.title}</b><small>${event.speaker} · ${event.place}</small></span><span class="quest-arrow">›</span></button>`).join('')}</div>` : '<p class="exam-desc">暂时没有需要马上处理的事。</p>'}
    ${requests.length ? `<div class="event-list">${requests.map(request => { const npc = NPCS.find(n => n.id === request.npc); return `<button class="event-row" data-request="${request.id}"><span class="event-level">请求</span><span class="event-main"><b>${request.title}</b><small>${npc ? npc.name : ''} · 好感 ${core.affinityOf(request.npc)}</small></span><span class="quest-arrow">›</span></button>`; }).join('')}</div>` : ''}
    ${triggers.length ? `<div class="trigger-list"><div class="trigger-head">延迟触发队列</div>${triggers.map(t => `<div class="trigger-row"><span>${t.def ? t.def.title : t.eventId}</span><span class="trigger-in">${t.inWeeks} 周后发作</span></div>`).join('')}</div>` : ''}
    <button class="secondary-button" data-action="close">知道了</button></article>`);
}

// ============ 因果面板：随时翻看自己做过哪些选择、各自影响了什么 ============
function causeRow(entry) {
  const chips = effectChips(entry.effects);
  const affinityChip = entry.affinity
    ? `<span class="effect-item ${entry.affinity.delta >= 0 ? 'positive' : 'negative'}">${entry.affinity.name} 好感 ${entry.affinity.delta >= 0 ? '+' : ''}${entry.affinity.delta} → ${entry.affinity.total}</span>`
    : '';
  const links = (entry.consequences || []).map(item => {
    const left = item.fireAt - core.absoluteWeek;
    const when = item.fired ? `第 ${item.firedAt || item.fireAt} 周引发` : left > 0 ? `${left} 周后发作` : '马上到你面前';
    return `<div class="cause-link ${item.fired ? 'fired' : ''}"><span>↳</span><b>${when}</b>「${item.title}」<em>${item.fired ? '已发作' : '排队中'}</em></div>`;
  }).join('');
  const note = !links && entry.note ? `<div class="cause-note">${entry.note}</div>` : '';
  return `<div class="cause-row type-${entry.type}">
    <div class="cause-head"><span class="cause-type">${CAUSE_TYPES[entry.type] || '选择'}</span><b>${entry.title}</b><span class="cause-at">${entry.at}</span></div>
    <div class="cause-choice">“${entry.choice}”</div>
    ${chips || affinityChip ? `<div class="cause-effects">${chips}${affinityChip}</div>` : ''}
    ${links}${note}
  </div>`;
}

function showCause() {
  const report = core.causeReport();
  const filter = CAUSE_TYPES[causeFilter] ? causeFilter : 'all';
  const entries = filter === 'all' ? report.entries : report.entries.filter(entry => entry.type === filter);
  const tabs = Object.keys(CAUSE_TYPES).map(id => {
    const count = id === 'all' ? report.total : (report.counts[id] || 0);
    return `<button class="cause-tab ${filter === id ? 'active' : ''}" data-cause-filter="${id}">${CAUSE_TYPES[id]}${count ? `<em>${count}</em>` : ''}</button>`;
  }).join('');
  const totals = Object.keys(report.totals).length
    ? Object.keys(report.totals).map(key => `<span class="effect-item ${report.totals[key] >= 0 ? 'positive' : 'negative'}">${key === 'energy' ? '精力' : STAT_META[key].name} ${report.totals[key] >= 0 ? '+' : ''}${report.totals[key]}</span>`).join('')
    : '<small class="cause-hint">还没有产生属性变化</small>';
  const groups = [];
  entries.forEach(entry => {
    const label = entry.semesterName || '开学之前';
    let group = groups.find(item => item.label === label);
    if (!group) { group = { label, items: [] }; groups.push(group); }
    group.items.push(entry);
  });
  const timeline = groups.length
    ? groups.map(group => `<div class="cause-group"><div class="cause-group-head">${group.label}<span>${group.items.length} 次选择</span></div>${group.items.map(causeRow).join('')}</div>`).join('')
    : `<p class="exam-desc">${CAUSE_EMPTY[filter] || CAUSE_EMPTY.all}</p>`;
  // 继承 / 隐藏事件 / 未发作的后果，压成一行标签，把纵向空间留给时间线
  const facts = [];
  if (report.legacy) facts.push(`<span class="cause-fact"><i style="--tone:${report.legacy.color}">${report.legacy.icon}</i>继承「${report.legacy.name}」<em>${report.legacy.effectText}</em></span>`);
  facts.push(`<span class="cause-fact">隐藏事件 ${report.hidden.cleared.length} / ${report.hidden.total} · 已显形 ${report.hidden.unlocked.length} 个</span>`);
  if (report.pending.length) {
    const first = report.pending[0];
    facts.push(`<span class="cause-fact pending">未发作 ${report.pending.length} 件 · ${first.title}（${first.inWeeks} 周后）</span>`);
  }
  const factsRow = `<div class="cause-facts">${facts.join('')}</div>`;
  const echo = (meta.playthroughs || 0) > 0 && (meta.lastChoiceLog || []).length
    ? `<div class="cause-echo"><div class="trigger-head">上一周目的最后几步</div>${meta.lastChoiceLog.slice(-2).map(item => `<div class="echo-row"><span>${item.at}</span><b>${item.title}</b><small>${item.choice}</small></div>`).join('')}</div>`
    : '';
  openModal('cause', `<article class="small-panel cause-panel"><button class="panel-close" data-action="close">×</button>
    <div class="panel-kicker">CAUSE &amp; EFFECT</div><h2 class="panel-title">因果面板</h2>
    <p class="exam-desc">共 <b>${report.total}</b> 次选择 · 按时间顺序记下每一次选择、当场的影响，以及它后来引发的后果。</p>
    <div class="cause-summary">${totals}</div>
    ${factsRow}
    <div class="cause-tabs">${tabs}</div>
    <div class="cause-timeline">${timeline}</div>
    ${echo}
    <button class="secondary-button" data-action="close">收起面板</button></article>`);
}

function showGuide() {
  const items = [
    ['四年八学期','8 个学期覆盖完整大学四年。每学期 4 周行动 + 1 次期末考；每个场景有 2 个可接任务。'],
    ['自由探索','拖动摇杆、使用 WASD / 方向键，或点击地面寻路。走近建筑入口与 NPC 即可进入场景接任务。'],
    ['做出选择','16 个任务各有多个选项。重复完成仍有收益，但属性成长会递减。'],
    ['有人会来找你','同学会带着请求找上门，你可以答应或拒绝。好感度记录你每一次选择，也决定你们之后能走多近。'],
    ['小决定会滚大','一次翘课会在几周后连锁引发点名、辅导员谈话、家长来电。右上角的 ✉ 提醒你还有什么事没处理。'],
    ['选择有因果','右上角的「因」随时可以翻：每一次选择、当场的影响，以及它几周后引发了什么，都按学期记在里面，不用事后回想。'],
    ['周目会累积','毕业之后可以带着一样东西重开：属性、道具、每周精力或一份好感。继承不同的东西，会让对应场景里藏着的隐藏事件显形。'],
    ['照顾自己','行动消耗精力，每周恢复 10 点（江野 +8）。精力过低会影响心态，期末后假期会大幅恢复。'],
    ['迎接毕业','每学期期末考由 5 道情境题 + 日常成长计分。大四下学期结束后，根据四年积累走向毕业结局。']
  ];
  openModal('guide', `<article class="small-panel"><button class="panel-close" data-action="close">×</button><div class="panel-kicker">NEW STUDENT HANDBOOK</div><h2 class="panel-title">新生校园指南</h2>${items.map((item, i) => `<div class="guide-item"><span>0${i + 1}</span><div><b>${item[0]}</b><p>${item[1]}</p></div></div>`).join('')}<button class="secondary-button" data-action="close">我准备好了</button><button class="text-button" data-action="restart">重新选择角色</button></article>`);
}

function showExamIntro() {
  openModal('examIntro', `<article class="small-panel"><div class="exam-emblem">末</div><div class="panel-kicker">FINAL EXAMINATION</div><h2 class="panel-title">${core.semesterName} · 期末考试</h2><p class="exam-desc">${core.semester < 8 ? '一学期的探索与选择，都将成为此刻的底气。' : '这是大学生涯的最后一场考试。'}共 5 道情境题，日常学识与实践也会影响成绩。</p><div class="exam-rule"><span>答题正确</span><b>50 分</b><span>日常成长</span><b>50 分</b></div><button class="primary-button" data-action="start-exam">开始作答</button>${logLink}</article>`);
}

function showQuestion() {
  const questions = core.currentExam || [];
  const index = core.examAnswers.length;
  const q = questions[index]; if (!q) return showExamIntro();
  const t = core.tickExam(Date.now());
  const secs = Math.max(0, Math.ceil(t.remaining / 1000));
  openModal('exam', `<article class="small-panel exam-panel-wrap"><div class="exam-progress-head"><span>第 ${core.semester} 学期期末考</span><span>${index + 1} / ${questions.length}</span></div><div class="exam-progress-track"><i style="width:${(index + 1) / questions.length * 100}%"></i></div><div class="exam-timer-row"><span class="exam-timer-label">⏱ 本题限时</span><div class="exam-timer-num" id="exam-timer">${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}</div><div class="exam-timer-track"><i id="exam-timer-bar" style="width:${t.remaining / EXAM_QUESTION_MS * 100}%"></i></div></div><div class="exam-question">${q.question}</div><div class="exam-options">${q.options.map((option, i) => `<button data-answer="${i}"><span>${option}</span><span>›</span></button>`).join('')}</div><div class="exam-note" id="exam-note">切后台会暂停计时；超时未作答按错处理</div>${logLink}</article>`);
  startExamTicker();
}

function showSemesterResult(result) {
  const scores = result.examScores || core.examScores;
  const chart = semesterChartHTML(scores, scores.length - 1);
  openModal('semester', `<article class="small-panel"><div class="exam-emblem" style="border-color:#7d9275;color:#5f7a5f">假</div><div class="panel-kicker">SEMESTER COMPLETE</div><h2 class="panel-title">${result.semesterName} 结束</h2><div class="score-ring"><b>${result.score}</b><small>期末成绩</small></div>${chart}${semesterAchvChipsHTML(result.semester)}<p class="exam-desc">假期里你好好休整了一番，精力大幅恢复。<br>接下来是 <b>${semesterLabel(result.semester + 1)}</b>，继续书写你的大学故事。</p><div class="exam-rule"><span>答对</span><b>${result.correct} / 5 题</b><span>超时</span><b>${result.timeouts || 0} 题</b></div><div class="exam-rule"><span>累计学期</span><b>${core.examScores.length} / 8</b><span>已解锁成就</span><b>${core.achievements.length} / ${ACHIEVEMENTS.length}</b></div><button class="primary-button" data-action="close">进入${semesterLabel(result.semester + 1)} →</button><button class="text-button" data-action="achv">查看成就图鉴</button>${logLink}</article>`);
}

function showEnding(ending) {
  const unlocked = Save.legacyOptions(meta).filter(option => option.unlocked);
  const savedLine = runRecorded
    ? `<div class="ending-legacy"><b>本局已存入存档</b><span>第 ${meta.playthroughs} 周目完成 · 下一周目可继承 ${unlocked.length} 项 · 隐藏事件 ${(meta.hiddenEvents || []).length} / ${Save.TOTAL_HIDDEN}</span></div>`
    : '';
  const chart = semesterChartHTML(ending.examScores, -1, `四年成长轨迹 · 毕业均分 ${ending.score}`);
  openModal('ending', `<article class="ending-panel"><div class="ending-kicker">GRADUATION · 四年旅程结束</div><div class="ending-seal" style="color:${ending.color};border-color:${ending.color}">梧</div><div class="ending-tag">${ending.tag}</div><h2 class="ending-title">${ending.title}</h2><div class="score-ring"><b>${ending.score}</b><small>四年平均成绩</small></div>${chart}<p class="ending-text">${ending.text}</p><div class="ending-stats">${Object.entries(STAT_META).map(([key, meta2]) => `<span>${meta2.name}<b>${core.stats[key]}</b></span>`).join('')}</div><div class="ending-quote">“大学不是一张标准答卷，而是一段允许试错的路。”</div><div class="exam-rule"><span>已解锁成就</span><b>${core.achievements.length} / ${ACHIEVEMENTS.length}</b><span>全对场次</span><b>${core.perfectExams}</b></div><div class="ending-seed">本局种子码 <b>${core.seedCode}</b> · 把它给同学，可以复现同一段四年</div>${savedLine}<button class="text-button" data-action="achv">查看成就图鉴</button>${logLink}<button class="primary-button" data-action="restart">带着一样东西重开 →</button><button class="text-button" data-action="cause">先翻翻这一局的因果</button></article>`);
}

// ============ 成就系统（飘条 / 音效 / 图鉴） ============

function drainAchievements() {
  let index = 0;
  let item;
  while ((item = core.consumePendingAchievement())) {
    const captured = item;
    setTimeout(() => showAchvToast(captured), index * 340);
    index++;
  }
}

function showAchvToast(item) {
  const secret = !!item.hidden;
  const tier = secret ? TIER_META.hidden : (TIER_META[item.tier] || TIER_META.bronze);
  const confetti = secret ? secretConfetti() : item.tier === 'gold' ? Array.from({ length: 10 }, (_, i) => `<i class="confetti c${i + 1}"></i>`).join('') : '';
  const layer = $('#achv-layer'); if (!layer) return;
  const toast = document.createElement('div');
  toast.className = `achv-toast ${secret ? 'tier-hidden secret' : `tier-${item.tier}`}`;
  toast.innerHTML = `<div class="achv-ribbon"><span class="achv-tag">${secret ? 'SECRET ACHIEVEMENT' : 'ACHIEVEMENT UNLOCKED'}</span><b class="achv-ribbon-title">${secret ? '隐藏成就 · 现世' : '成就解锁'}</b></div>
    <div class="achv-main"><span class="achv-icon" style="color:${tier.color};border-color:${tier.color}"><i>${item.icon}</i></span><div class="achv-info"><b>${item.name}</b><small>${item.desc}</small></div><span class="achv-tier" style="background:${tier.color};color:${secret ? '#2a1d44' : '#fffdf0'}">${secret ? '隐藏成就' : `${tier.label}级成就`}</span></div>${confetti}${secret ? '<span class="secret-rays"></span>' : ''}`;
  layer.appendChild(toast);
  playAchvSound(secret ? 'hidden' : item.tier);
  flashScreen(secret ? 'hidden' : item.tier);
  bumpAchvCount();
  setTimeout(() => { toast.classList.add('achv-out'); setTimeout(() => toast.remove(), 620); }, secret ? 5200 : 3100);
}

const SECRET_COLORS = ['#ffd76e', '#ff9f6e', '#ff7ea8', '#c99bff', '#7ec8ff', '#7ef0c4', '#e9ff8a'];
function secretConfetti() {
  return Array.from({ length: 26 }, (_, i) => {
    const angle = (i / 26) * Math.PI * 2;
    const radius = 128 + (i % 5) * 28;
    const cx = Math.round(Math.cos(angle) * radius);
    const cy = Math.round(Math.abs(Math.sin(angle)) * radius * 0.8 + 56);
    const rot = (i % 2 ? 1 : -1) * (300 + i * 14);
    const delay = 0.2 + (i % 6) * 0.06;
    return `<i class="confetti secret-bit" style="--cx:${cx}px;--cy:${cy}px;--rot:${rot}deg;background:${SECRET_COLORS[i % SECRET_COLORS.length]};animation-delay:${delay}s"></i>`;
  }).join('');
}

let achvAudio = null;
function playAchvSound(tier) {
  try {
    achvAudio = achvAudio || new (window.AudioContext || window.webkitAudioContext)();
    if (achvAudio.state === 'suspended') achvAudio.resume();
    const notes = tier === 'hidden' ? [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093] : tier === 'gold' ? [523.25, 659.25, 783.99, 1046.5] : tier === 'silver' ? [587.33, 880] : [440, 587.33];
    const volume = tier === 'hidden' ? 0.15 : tier === 'gold' ? 0.16 : 0.1;
    notes.forEach((freq, i) => {
      const osc = achvAudio.createOscillator();
      const gain = achvAudio.createGain();
      osc.type = tier === 'hidden' ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      const start = achvAudio.currentTime + i * (tier === 'hidden' ? 0.075 : 0.085);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
      osc.connect(gain); gain.connect(achvAudio.destination);
      osc.start(start); osc.stop(start + 0.44);
    });
  } catch (e) { /* 无音频环境时静默跳过 */ }
}

function flashScreen(tier) {
  const flash = $('#achv-flash');
  if (!flash) return;
  flash.classList.remove('achv-flash-on', 'tier-bronze', 'tier-silver', 'tier-gold', 'tier-hidden');
  void flash.offsetWidth;
  flash.classList.add('achv-flash-on', `tier-${tier}`);
  setTimeout(() => flash.classList.remove('achv-flash-on'), tier === 'hidden' ? 2200 : 1000);
}

function bumpAchvCount() {
  const el = $('#achv-count');
  if (!el) return;
  el.textContent = `已解锁成就 ${core.achievements.length} / ${ACHIEVEMENTS.length}`;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function semesterAchvChipsHTML(semester) {
  const items = core.achievementLog.filter(entry => entry.semester === semester).map(entry => achievementById(entry.id)).filter(Boolean);
  if (!items.length) return '';
  const chips = items.map(item => {
    const tier = item.hidden ? TIER_META.hidden : (TIER_META[item.tier] || TIER_META.bronze);
    return `<span class="achv-chip tier-${item.hidden ? 'hidden' : item.tier}"><i style="color:${tier.color}">${item.icon}</i>${item.name}</span>`;
  }).join('');
  return `<div class="semester-achv"><div class="semester-achv-title">本学期新解锁成就 × ${items.length}</div><div class="semester-achv-chips">${chips}</div></div>`;
}

function semesterChartHTML(scores, highlightIndex = -1, captionOverride = '') {
  const bars = scores.map((score, i) => `<div class="chart-col ${i === highlightIndex ? 'current' : ''}"><span class="chart-value">${scores[i]}</span><i style="height:${Math.max(4, Math.round(scores[i]))}px"></i><span class="chart-label">S${i + 1}</span></div>`).join('');
  let caption = '未来学期，继续成长';
  if (captionOverride) caption = captionOverride;
  else if (highlightIndex > 0) {
    const delta = scores[highlightIndex] - scores[highlightIndex - 1];
    caption = delta >= 0 ? `较上学期 <b class="up">+${delta}</b> 分` : `较上学期 <b class="down">${delta}</b> 分`;
  }
  return `<div class="semester-chart"><div class="chart-title">学期成绩柱状对比</div><div class="chart-bars">${bars}</div><div class="chart-caption">${caption}</div></div>`;
}

function showAchievements() {
  const list = buildAchievementList(core.achievementSnapshot(), core.achievements);
  const unlocked = list.filter(item => item.unlocked).length;
  const hiddenLeft = list.filter(item => item.masked).length;
  const cells = list.map(item => {
    if (item.masked) {
      return `<div class="achv-cell secret locked"><span class="achv-cell-icon">？</span><div class="achv-cell-body"><b>？？？<small>隐藏成就</small></b><p>${item.desc}</p><div class="achv-cell-bar"><i style="width:0%"></i></div></div></div>`;
    }
    const tierLabel = item.hidden ? '秘' : TIER_META[item.tier].label;
    return `<div class="achv-cell ${item.unlocked ? 'on' : ''} ${item.hidden ? 'secret' : ''}"><span class="achv-cell-icon" style="color:${item.catColor}">${item.icon}</span><div class="achv-cell-body"><b>${item.name}<small>${item.catName} · ${tierLabel}级</small></b><p>${item.desc}</p><div class="achv-cell-bar"><i style="width:${Math.min(100, Math.round(item.current / item.target * 100))}%"></i></div></div></div>`;
  }).join('');
  const hint = hiddenLeft ? `<div class="achv-hidden-hint">图鉴中还有 <b>${hiddenLeft}</b> 项隐藏成就，达成苛刻条件后才会揭开真容</div>` : `<div class="achv-hidden-hint done">隐藏成就已全部现世 · 你就是青梧的传说</div>`;
  openModal('achv', `<article class="small-panel achv-panel"><button class="panel-close" data-action="close">×</button><div class="panel-kicker">ACHIEVEMENT COLLECTION</div><h2 class="panel-title">成就图鉴</h2><div class="achv-summary"><div class="achv-summary-bar"><i style="width:${unlocked / list.length * 100}%"></i></div><span>${unlocked} / ${list.length} 已解锁</span></div>${hint}<div class="achv-grid">${cells}</div><button class="secondary-button" data-action="close">返回</button></article>`);
}

// ============ 期末考倒计时 ============

let examTicker = null, examTimeoutBusy = false;
function startExamTicker() {
  stopExamTicker(); examTimeoutBusy = false;
  examTicker = setInterval(() => {
    if (modal !== 'exam') { stopExamTicker(); return; }
    const t = core.tickExam(Date.now());
    const secs = Math.max(0, Math.ceil(t.remaining / 1000));
    const digits = $('#exam-timer'); if (!digits) return;
    digits.textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    const card = digits.closest('.exam-panel-wrap');
    if (card) card.classList.toggle('exam-hurry', t.remaining <= 10000);
    const bar = $('#exam-timer-bar'); if (bar) bar.style.width = `${t.remaining / EXAM_QUESTION_MS * 100}%`;
    if (t.timedOut && !examTimeoutBusy) {
      examTimeoutBusy = true;
      if (card) card.classList.add('exam-timeout-flash');
      const note = $('#exam-note'); if (note) note.textContent = '时间到 · 本题按错处理，自动进入下一题';
      setTimeout(() => {
        const result = core.timeoutExamQuestion(Date.now());
        if (result && result.finished) handleExamFinished();
        else { showQuestion(); examTimeoutBusy = false; }
      }, 700);
    }
  }, 100);
}
function stopExamTicker() { if (examTicker) clearInterval(examTicker); examTicker = null; }

function handleExamFinished() {
  stopExamTicker();
  const outcome = core.finishExam(); updateHUD(); drainAchievements();
  if (outcome && outcome.ending) { recordRunOnce(); showEnding(outcome.ending); }
  else if (outcome && outcome.semesterResult) showSemesterResult(outcome.semesterResult);
}

function interact() {
  if (modal) return;
  if (!world.nearby) {
    const tip = $('#location-toast'); tip.innerHTML = '<span>⌖</span><div><b>继续探索校园</b><small>走近发光入口或同学后再互动</small></div>'; tip.classList.remove('hidden');
    setTimeout(() => { if (!world.nearby) tip.classList.add('hidden'); }, 1500); return;
  }
  // 找上门的 NPC 有话要说，直接进请求，不用再点一次
  if (world.nearby.type === 'npc') {
    const request = core.pendingRequestFor(world.nearby.id);
    if (request) { showRequest(request); return; }
  }
  showScene(world.nearby.event);
}

$('#guide-button').addEventListener('click', showGuide);
$('#log-button').addEventListener('click', showLog);
$('#cause-button').addEventListener('click', showCause);
const achvButton = $('#achv-button');
if (achvButton) achvButton.addEventListener('click', showAchievements);

// 切后台暂停考试计时，回前台恢复（对应小程序的 onHide / onShow）
document.addEventListener('visibilitychange', () => {
  if (!core) return;
  if (document.hidden) core.pauseExam(Date.now());
  else core.resumeExam(Date.now());
});

// 提示卡片上写着「点击进入」，那就得真的能点：与右下角按钮同一个入口
$('#location-toast').addEventListener('click', interact);
$('#exam-button').addEventListener('click', showExamIntro);
$('#event-button').addEventListener('click', showEvents);

modalContent.addEventListener('click', event => {
  // 刚换过面板，这一下很可能是上一下的连击，直接吞掉
  if (performance.now() < swapGuard) return;
  // —— 因果面板的分类标签 ——
  const causeTab = event.target.closest('[data-cause-filter]');
  if (causeTab) { causeFilter = causeTab.dataset.causeFilter; showCause(); return; }
  const questBtn = event.target.closest('[data-quest]');
  if (questBtn) { showQuest(Number(questBtn.dataset.quest)); return; }
  // —— NPC 的请求：答应 / 拒绝 ——
  const requestBtn = event.target.closest('[data-request]');
  if (requestBtn) {
    const request = core.pendingRequests().find(item => item.id === requestBtn.dataset.request)
      || REQUESTS.find(item => item.id === requestBtn.dataset.request);
    if (request) showRequest(request);
    return;
  }
  const requestChoice = event.target.closest('[data-request-choice]');
  if (requestChoice) {
    if (!activeRequest) return;
    const outcome = core.resolveRequest(activeRequest.id, Number(requestChoice.dataset.requestChoice));
    if (!outcome) return;
    world.dismissNpc(outcome.npc);
    updateHUD();
    const npc = NPCS.find(n => n.id === outcome.npc);
    const scene = EVENTS[npc.event];
    openModal('reply', `${artCanvas(scene.art)}<article class="reply-panel float-panel"><div class="reply-spark">✦</div><div class="reply-kicker">${outcome.accepted ? '你答应了下来' : '你拒绝了'}</div><h2 class="reply-title">${activeRequest.title}</h2><p class="reply-text">${outcome.reply}</p><div class="effect-list">${effectChips(outcome.applied)}<span class="effect-item ${outcome.affinity >= 0 ? 'positive' : 'negative'}">${npc.name} 好感 ${outcome.affinity >= 0 ? '+' : ''}${outcome.affinity}（当前 ${outcome.total} · ${outcome.tier.name}）</span></div><button class="primary-button" data-action="continue">继续校园生活 →</button></article>`, 'scene');
    startArt($('#scene-full-art'), scene.art); return;
  }
  // —— 连锁事件 ——
  const chainBtn = event.target.closest('[data-chain]');
  if (chainBtn) { const chainEvent = CHAIN_EVENTS[chainBtn.dataset.chain]; if (chainEvent) showChain(chainEvent); return; }
  const chainChoice = event.target.closest('[data-chain-choice]');
  if (chainChoice) {
    if (!activeChain) return;
    const outcome = core.resolveChain(activeChain.id, Number(chainChoice.dataset.chainChoice));
    if (!outcome) return;
    updateHUD();
    const scene = EVENTS[outcome.event.scene];
    openModal('reply', `${artCanvas(scene.art)}<article class="reply-panel float-panel"><div class="reply-spark">✦</div><div class="reply-kicker">一件小事滚成了另一件事</div><h2 class="reply-title">${outcome.event.title}</h2><p class="reply-text">${outcome.reply}</p><div class="effect-list">${effectChips(outcome.applied)}</div><button class="primary-button" data-action="continue">继续校园生活 →</button></article>`, 'scene');
    startArt($('#scene-full-art'), scene.art); return;
  }
  const choice = event.target.closest('[data-choice]');
  if (choice) {
    // —— 过程问答：还有下一轮就只结算这一轮，不推进周数、不写日志 ——
    const curQuest = core.questAt(sceneId, questIndex);
    const curRounds = questRoundsOf(curQuest);
    if (curRounds && dialogueRound < curRounds.length - 1) {
      const step = core.applyDialogueChoice(sceneId, questIndex, dialogueRound, Number(choice.dataset.choice));
      if (!step) return;
      updateHUD(); drainAchievements();
      const stepScene = EVENTS[sceneId];
      openModal('reply', `${artCanvas(stepScene.art)}<article class="reply-panel float-panel"><div class="reply-spark">✦</div><div class="reply-kicker">第 ${step.roundIndex + 1} / ${step.roundsLength} 轮问答已完成</div><h2 class="reply-title">${curQuest.title}</h2><p class="reply-text">${step.reply || '你把这一步想清楚了。'}</p><div class="effect-list">${effectChips(step.applied)}</div><button class="primary-button" data-action="next-round">继续第 ${step.roundIndex + 2} 轮问答 →</button>${logLink}</article>`, 'scene');
      startArt($('#scene-full-art'), stepScene.art);
      return;
    }
    const result = core.applyChoice(sceneId, questIndex, Number(choice.dataset.choice)); if (!result) return;
    const effects = effectChips(result.applied);
    updateHUD(); drainAchievements();
    // 有新请求上门 / 有连锁事件发作，都排到关掉这段回复之后再提示
    if (result.request) announceRequest(result.request);
    if (result.fired && result.fired.length) {
      const names = result.fired.map(id => CHAIN_EVENTS[id] ? CHAIN_EVENTS[id].title : id).join('、');
      pendingNotice = { title: '事情找上门了', detail: names };
    }
    const scene = EVENTS[sceneId];
    const quest = core.questAt(sceneId, questIndex) || { title: '' };
    const kicker = result.hidden ? '隐藏事件 · 已收入因果' : '故事已收入图鉴';
    const chainNote = result.chained
      ? `<div class="reply-consequence">这个选择埋下了一个后果：${CHAIN_EVENTS[result.chained.eventId] ? CHAIN_EVENTS[result.chained.eventId].title : result.chained.eventId} 会在 ${Math.max(1, result.chained.fireAt - core.absoluteWeek)} 周后找上来。</div>`
      : '';
    openModal('reply', `${artCanvas(scene.art)}<article class="reply-panel float-panel"><div class="reply-spark">✦</div><div class="reply-kicker">${kicker}</div><h2 class="reply-title">${quest.title}</h2><p class="reply-text">${result.reply}</p><div class="effect-list">${effects}</div>${chainNote}<div class="reply-cause">已写入因果面板 · 右上角「因」可随时翻看</div><button class="primary-button" data-action="continue">继续校园生活 →</button>${logLink}</article>`, 'scene');
    startArt($('#scene-full-art'), scene.art); return;
  }
  const answer = event.target.closest('[data-answer]');
  if (answer) {
    core.answerExam(Number(answer.dataset.answer), Date.now());
    if (core.examAnswers.length >= core.currentExam.length) handleExamFinished();
    else showQuestion(); return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'close') { closeModal(); updateHUD(); flushNotice(); }
  if (action === 'close-log') { closeLog(); }
  if (action === 'log') { showLog(); }
  if (action === 'continue') { core.examReady ? showExamIntro() : closeModal(); flushNotice(); }
  if (action === 'next-round') { dialogueRound += 1; showQuest(questIndex, true); }
  if (action === 'start-exam') { core.startExam(Date.now()); showQuestion(); }
  if (action === 'achv') showAchievements();
  if (action === 'cause') { showCause(); }
  if (action === 'restart') location.reload();
});

window.addEventListener('keydown', event => {
  if (!world || modal) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'w', 'a', 's', 'd'].includes(key)) { event.preventDefault(); world.setKey(key, true); }
  if (key === 'e' || key === ' ') interact();
});
window.addEventListener('keyup', event => {
  if (!world) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  world.setKey(key, false);
});
/* 画布上不再写「进入XX」，走近之后只亮门口那圈呼吸光圈，
   真正的入口是底部那张提示卡片（可点，E / 空格同样可以）。 */
$('#campus').addEventListener('pointerdown', event => {
  if (modal || event.pointerType === 'touch') return;
  const point = renderer.screenToWorld(event.clientX, event.clientY);
  world.setTarget(point.x, point.y);
});
const joystick = $('#joystick'); const knob = $('#joy-knob');
function moveJoystick(event) {
  const rect = joystick.getBoundingClientRect();
  let dx = event.clientX - rect.left - rect.width / 2; let dy = event.clientY - rect.top - rect.height / 2;
  const distance = Math.hypot(dx, dy), max = 34;
  if (distance > max) { dx = dx / distance * max; dy = dy / distance * max; }
  knob.style.transform = `translate(${dx}px,${dy}px)`; world.setInput(dx / max, dy / max);
}
joystick.addEventListener('pointerdown', event => { if (modal) return; joystick.setPointerCapture(event.pointerId); moveJoystick(event); });
joystick.addEventListener('pointermove', event => { if (joystick.hasPointerCapture(event.pointerId)) moveJoystick(event); });
function endJoystick() { knob.style.transform = ''; world.setInput(0, 0); }
joystick.addEventListener('pointerup', endJoystick); joystick.addEventListener('pointercancel', endJoystick);

characterCards();
syncSeedCode();
renderLegacy();
