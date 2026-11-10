const { CHARACTERS, STAT_META, EVENTS, NPCS, REQUESTS, CHAIN_EVENTS, LEGACY_OPTIONS, HIDDEN_EVENTS, affinityTier, getExamQuestions, semesterLabel } = CampusRequire('content');
const { GameCore } = CampusRequire('core');
const Save = CampusRequire('save');
const { CampusRenderer, drawSceneArt, preloadStandees } = CampusRequire('renderer');
const { CampusWorld } = CampusRequire('world');

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
let selected = 'lin';
let meta = Save.readMeta();
let legacyPick = Save.defaultLegacy(meta);
let causeFilter = 'all';
let core, world, renderer, canvas, ctx, modal = '', sceneId = '', questIndex = 0, artLoop = null;
let activeRequest = null, activeChain = null, toastTimer = null, pendingNotice = null, runRecorded = false;
let lastTime = performance.now();

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
  // 先把所有角色的场景立绘丢进加载队列，避免进游戏后小人先是用线条画、再突然变成立绘
  preloadStandees(CHARACTERS.map(c => c.id).concat(NPCS.map(n => n.id)));
  runRecorded = false;
  core = new GameCore(selected, { playthrough: (meta.playthroughs || 0) + 1, legacyId: legacyPick || null });
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

function updateHUD() {
  $('#week-pill').textContent = `${core.semesterName} · 第 ${Math.min(core.week, core.weeksPerSemester)} / ${core.weeksPerSemester} 周`;
  $('#profile-avatar').innerHTML = `<img src="assets/characters/${core.character.avatar}" alt="${core.character.name}">`; $('#profile-avatar').style.background = 'transparent';
  $('#profile-name').textContent = core.character.name; $('#profile-title').textContent = core.character.title;
  $('#energy-value').textContent = core.energy; $('#energy-bar').style.width = `${core.energy}%`;
  $('#stats-row').innerHTML = Object.entries(STAT_META).map(([key, meta]) => `<span class="stat-chip"><i style="color:${meta.color}">${meta.icon}</i>${meta.name}<b>${core.stats[key]}</b></span>`).join('');
  $('#quest-bar').style.width = `${core.totalProgress}%`;
  $('#quest-count').textContent = `已完成 ${core.completed.length} / 16 段故事`;
  $('#quest-percent').textContent = `第 ${core.semester} / 8 学期`;
  $('#exam-button').classList.toggle('hidden', !core.examReady);
  // 有等着处理的事，右上角就亮一个红点
  const pending = core.pendingChainEvents().length + core.pendingRequests().length;
  const badge = $('#event-badge');
  badge.textContent = pending;
  badge.classList.toggle('hidden', !pending);
  $('#event-button').classList.toggle('alert', pending > 0);
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
}

function updateNearby(nearby) {
  $('#location-toast').classList.toggle('hidden', !nearby);
  $('#action-button').classList.toggle('active', !!nearby);
  $('#action-button span').textContent = nearby ? '✦' : '＋';
  $('#action-button b').textContent = nearby ? (nearby.type === 'npc' ? '聊一聊' : '进入') : '探索';
  if (nearby) $('#location-toast').innerHTML = `<span>⌖</span><div><b>${nearby.name}</b><small>点击进入，查看可做的任务</small></div>`;
}

function openModal(name, html, mode = '') {
  modal = name; stopArt();
  world.setInput(0, 0); Object.keys(world.keys).forEach(key => world.keys[key] = false);
  modalContent.innerHTML = html;
  modalMask.classList.remove('hidden');
  modalMask.classList.toggle('story-mask', mode === 'story');
  modalMask.classList.toggle('scene-mode', mode === 'scene');
}
function closeModal() { modal = ''; stopArt(); modalMask.classList.add('hidden'); modalContent.innerHTML = ''; }

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
        <span class="quest-meta-line">${p.done && p.times > 1 ? `已重复 ${p.times - 1} 次 · 收益递减` : p.done ? '可重温 · 收益递减' : `${p.quest.choices.length} 个选择`}</span>
        <span class="quest-arrow">›</span>
      </button>`;
      }).join('')}</div>
      <div class="story-footer">每次任务消耗 1 周；每学期 4 周，期末后进入下一学期 · 隐藏事件 ${core.hiddenCleared.length} / ${core.totalHiddenQuests}</div>
    </div></article>`, 'scene');
  startArt($('#scene-full-art'), scene.art);
}

function showQuest(index) {
  const scene = EVENTS[sceneId]; const quest = core.questAt(sceneId, index);
  if (!quest) return;
  questIndex = index;
  const key = `${sceneId}:${index}`; const done = core.completed.includes(key);
  const hidden = !!quest.requires;
  openModal('quest', `${artCanvas(scene.art)}<article class="story-panel float-panel">
    <div class="story-visual scene-art-wrap" style="background:linear-gradient(130deg,${scene.art.sky[0]},${scene.art.sky[1]})"><div class="story-place">${scene.place}</div><div class="story-symbol">${scene.avatar}</div><div class="story-lines"></div></div>
    <div class="story-content"><div class="story-kicker">${hidden ? 'HIDDEN SCENE · 只有这一周目才看得到' : `CAMPUS STORY · ${done ? 'REPLAY' : 'NEW'}`} · ${core.semesterName} 第${Math.min(core.week, 4)}周</div>
      <h2 class="story-title">${quest.title}</h2>
      <div class="speaker-row"><div class="speaker-avatar" style="background:${scene.color}"><img src="assets/characters/${eventAvatar[sceneId] || 'npc1_avatar.png'}" alt="${scene.speaker}"></div><div><div class="speaker-name">${scene.speaker}</div><div class="speaker-role">${scene.role}</div></div>${hidden ? '<span class="affinity-chip hidden-chip">隐藏事件</span>' : ''}</div>
      <div class="story-text">${quest.text}</div>
      <div class="choices">${quest.choices.map((choice, i) => `<button class="choice" data-choice="${i}"><span class="choice-index">${i + 1}</span><span class="choice-body">${choice.text}<span class="choice-hint">${choice.hint}${done ? ' · 重温收益递减' : ''}</span></span><span class="choice-arrow">›</span></button>`).join('')}</div>
      <div class="story-footer">选择没有标准答案，它会塑造独一无二的你 —— 每一次选择都会写进「因」面板</div>
    </div></article>`, 'scene');
  startArt($('#scene-full-art'), scene.art);
}

// 属性变化的胶囊标签，和剧情面板里用的是一套
function effectChips(applied) {
  return Object.entries(applied || {}).map(([key, value]) => `<span class="effect-item ${value >= 0 ? 'positive' : 'negative'}">${key === 'energy' ? '精力' : STAT_META[key].name} ${value >= 0 ? '+' : ''}${value}</span>`).join('');
}
function effectHint(effects) {
  return Object.keys(effects || {}).map(key => `${key === 'energy' ? '精力' : STAT_META[key].name} ${effects[key] >= 0 ? '+' : ''}${effects[key]}`).join(' · ');
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
      <div class="choices">${request.choices.map((choice, i) => `<button class="choice" data-request-choice="${i}"><span class="choice-index">${i + 1}</span><span class="choice-body">${choice.text}<span class="choice-hint">${effectHint(choice.effects)} · 好感 ${choice.affinity >= 0 ? '+' : ''}${choice.affinity}</span></span><span class="choice-arrow">›</span></button>`).join('')}</div>
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
  openModal('examIntro', `<article class="small-panel"><div class="exam-emblem">末</div><div class="panel-kicker">FINAL EXAMINATION</div><h2 class="panel-title">${core.semesterName} · 期末考试</h2><p class="exam-desc">${core.semester < 8 ? '一学期的探索与选择，都将成为此刻的底气。' : '这是大学生涯的最后一场考试。'}共 5 道情境题，日常学识与实践也会影响成绩。</p><div class="exam-rule"><span>答题正确</span><b>50 分</b><span>日常成长</span><b>50 分</b></div><button class="primary-button" data-action="start-exam">开始作答</button></article>`);
}

function showQuestion() {
  const questions = core.currentExam || [];
  const index = core.examAnswers.length;
  const q = questions[index]; if (!q) return showExamIntro();
  openModal('exam', `<article class="small-panel"><div class="exam-progress-head"><span>第 ${core.semester} 学期期末考</span><span>${index + 1} / ${questions.length}</span></div><div class="exam-progress-track"><i style="width:${(index + 1) / questions.length * 100}%"></i></div><div class="exam-question">${q.question}</div><div class="exam-options">${q.options.map((option, i) => `<button data-answer="${i}"><span>${option}</span><span>›</span></button>`).join('')}</div><div class="exam-note">请凭直觉作答，大学里的经验会帮助你的成绩</div></article>`);
}

function showSemesterResult(result) {
  openModal('semester', `<article class="small-panel"><div class="exam-emblem" style="border-color:#7d9275;color:#5f7a5f">假</div><div class="panel-kicker">SEMESTER COMPLETE</div><h2 class="panel-title">${result.semesterName} 结束</h2><div class="score-ring"><b>${result.score}</b><small>期末成绩</small></div><p class="exam-desc">假期里你好好休整了一番，精力大幅恢复。<br>接下来是 <b>${semesterLabel(result.semester + 1)}</b>，继续书写你的大学故事。</p><div class="exam-rule"><span>答对</span><b>${result.correct} / 5 题</b><span>累计学期</span><b>${core.examScores.length} / 8</b></div><button class="primary-button" data-action="close">进入${semesterLabel(result.semester + 1)} →</button></article>`);
}

function showEnding(ending) {
  const unlocked = Save.legacyOptions(meta).filter(option => option.unlocked);
  const savedLine = runRecorded
    ? `<div class="ending-legacy"><b>本局已存入存档</b><span>第 ${meta.playthroughs} 周目完成 · 下一周目可继承 ${unlocked.length} 项 · 隐藏事件 ${(meta.hiddenEvents || []).length} / ${Save.TOTAL_HIDDEN}</span></div>`
    : '';
  openModal('ending', `<article class="ending-panel"><div class="ending-kicker">GRADUATION · 四年旅程结束</div><div class="ending-seal" style="color:${ending.color};border-color:${ending.color}">梧</div><div class="ending-tag">${ending.tag}</div><h2 class="ending-title">${ending.title}</h2><div class="score-ring"><b>${ending.score}</b><small>四年平均成绩</small></div><p class="ending-text">${ending.text}</p><div class="ending-stats">${Object.entries(STAT_META).map(([key, meta2]) => `<span>${meta2.name}<b>${core.stats[key]}</b></span>`).join('')}</div><div class="ending-quote">“大学不是一张标准答卷，而是一段允许试错的路。”</div>${savedLine}<button class="primary-button" data-action="restart">带着一样东西重开 →</button><button class="text-button" data-action="cause">先翻翻这一局的因果</button></article>`);
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
$('#cause-button').addEventListener('click', showCause);
$('#action-button').addEventListener('click', interact);
$('#exam-button').addEventListener('click', showExamIntro);
$('#event-button').addEventListener('click', showEvents);

modalContent.addEventListener('click', event => {
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
    const result = core.applyChoice(sceneId, questIndex, Number(choice.dataset.choice)); if (!result) return;
    const effects = effectChips(result.applied);
    updateHUD();
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
    openModal('reply', `${artCanvas(scene.art)}<article class="reply-panel float-panel"><div class="reply-spark">✦</div><div class="reply-kicker">${kicker}</div><h2 class="reply-title">${quest.title}</h2><p class="reply-text">${result.reply}</p><div class="effect-list">${effects}</div>${chainNote}<div class="reply-cause">已写入因果面板 · 右上角「因」可随时翻看</div><button class="primary-button" data-action="continue">继续校园生活 →</button></article>`, 'scene');
    startArt($('#scene-full-art'), scene.art); return;
  }
  const answer = event.target.closest('[data-answer]');
  if (answer) {
    core.answerExam(Number(answer.dataset.answer));
    if (core.examAnswers.length >= core.currentExam.length) {
      const outcome = core.finishExam(); updateHUD();
      if (outcome && outcome.ending) { recordRunOnce(); showEnding(outcome.ending); }
      else if (outcome && outcome.semesterResult) showSemesterResult(outcome.semesterResult);
    } else showQuestion(); return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'close') { closeModal(); updateHUD(); flushNotice(); }
  if (action === 'continue') { core.examReady ? showExamIntro() : closeModal(); flushNotice(); }
  if (action === 'start-exam') { core.startExam(); showQuestion(); }
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
$('#campus').addEventListener('pointerdown', event => {
  if (modal || event.pointerType === 'touch') return;
  const point = renderer.screenToWorld(event.clientX, event.clientY); world.setTarget(point.x, point.y);
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
renderLegacy();
