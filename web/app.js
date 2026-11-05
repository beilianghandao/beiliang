const { CHARACTERS, STAT_META, EVENTS, NPCS, ENDINGS, getExamQuestions, semesterLabel } = CampusRequire('content');
const { ACHIEVEMENTS, buildAchievementList } = CampusRequire('achievements');
const { GameCore, EXAM_QUESTION_MS } = CampusRequire('core');
const { CampusRenderer, drawSceneArt, preloadStandees } = CampusRequire('renderer');
const { CampusWorld } = CampusRequire('world');

// event id -> 头像图片名（从 NPCS 反查）
const eventAvatar = {};
NPCS.forEach(n => { eventAvatar[n.event] = n.avatar; });

const $ = selector => document.querySelector(selector);
const selectScreen = $('#select-screen');
const gameScreen = $('#game-screen');
const modalMask = $('#modal-mask');
const modalContent = $('#modal-content');
const paleColors = ['#f0d9ce', '#d8e1eb', '#efe0c4', '#d5e4d8'];
let selected = 'lin';
const TOTAL_STORIES = Object.values(EVENTS).reduce((sum, scene) => sum + scene.quests.length, 0);
let core, world, renderer, canvas, ctx, modal = '', sceneId = '', questIndex = 0, dialogueRound = 0, artLoop = null;
let lastTime = performance.now();

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

function startGame() {
  // 先把所有角色的场景立绘丢进加载队列，避免进游戏后小人先是用线条画、再突然变成立绘
  preloadStandees(CHARACTERS.map(c => c.id).concat(NPCS.map(n => n.id)));
  core = new GameCore(selected); world = new CampusWorld();
  selectScreen.classList.add('hidden'); gameScreen.classList.remove('hidden');
  canvas = $('#campus'); ctx = canvas.getContext('2d');
  renderer = new CampusRenderer(ctx, innerWidth, innerHeight);
  resizeCanvas(); updateHUD(); closeModal();
  lastTime = performance.now(); requestAnimationFrame(loop);
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
  $('#quest-count').textContent = `已完成 ${core.completed.length} / ${TOTAL_STORIES} 段故事`;
  $('#quest-percent').textContent = `第 ${core.semester} / 8 学期`;
  $('#achv-count').textContent = `已解锁成就 ${core.achievements.length} / ${ACHIEVEMENTS.length}`;
  $('#exam-button').classList.toggle('hidden', !core.examReady);
}

// ---- 成就全屏飘条 ----
const TIER_META = { bronze: { label: '铜', color: '#b08d57' }, silver: { label: '银', color: '#8d9bab' }, gold: { label: '金', color: '#c49a3f' } };

function drainAchievements() {
  let item;
  while ((item = core.consumePendingAchievement())) {
    const tier = TIER_META[item.tier] || TIER_META.bronze;
    const toast = document.createElement('div');
    toast.className = 'achv-toast';
    toast.innerHTML = `<div class="achv-ribbon"><span class="achv-tag">ACHIEVEMENT UNLOCKED</span></div>
      <div class="achv-main"><span class="achv-icon" style="color:${tier.color};border-color:${tier.color}">${item.icon}</span><div class="achv-info"><b>${item.name}</b><small>${item.desc}</small></div><span class="achv-tier" style="background:${tier.color}">${tier.label}级成就</span></div>`;
    $('#achv-layer').appendChild(toast);
    setTimeout(() => { toast.classList.add('achv-out'); setTimeout(() => toast.remove(), 500); }, 2800);
  }
}

// ---- 学期成绩柱状对比 ----
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

// ---- 期末考倒计时 ----
let examTicker = null, examTimeoutBusy = false;
function startExamTicker() {
  stopExamTicker(); examTimeoutBusy = false;
  examTicker = setInterval(() => {
    if (modal !== 'exam') { stopExamTicker(); return; }
    const t = core.tickExam();
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
        const result = core.timeoutExamQuestion();
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
  if (outcome && outcome.ending) showEnding(outcome.ending);
  else if (outcome && outcome.semesterResult) showSemesterResult(outcome.semesterResult);
}

function updateNearby(nearby) {
  const toast = $('#location-toast');
  toast.classList.toggle('hidden', !nearby);
  if (nearby) {
    toast.setAttribute('aria-label', `进入${nearby.name}`);
    toast.innerHTML = `<span>⌖</span><div><b>${nearby.name}</b><small>点击进入，查看可做的任务</small></div>`;
  }
}

function openModal(name, html, mode = '') {
  modal = name; stopArt();
  world.setInput(0, 0); Object.keys(world.keys).forEach(key => world.keys[key] = false);
  modalContent.innerHTML = html;
  modalMask.classList.remove('hidden');
  modalMask.classList.toggle('story-mask', mode === 'story');
  modalMask.classList.toggle('scene-mode', mode === 'scene');
}
function closeModal() { modal = ''; stopArt(); stopExamTicker(); modalMask.classList.add('hidden'); modalContent.innerHTML = ''; }

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
  openModal('scene', `${artCanvas(scene.art)}<article class="story-panel scene-panel float-panel">
    <div class="story-visual scene-art-wrap" style="background:linear-gradient(130deg,${scene.art.sky[0]},${scene.art.sky[1]})"><div class="story-place">${scene.place}</div><div class="scene-title-over">${scene.name}</div><div class="story-lines"></div></div>
    <div class="story-content">
      <div class="story-kicker">SCENE · ${core.semesterName}</div>
      <h2 class="story-title">${scene.name}</h2>
      <div class="speaker-row"><div class="speaker-avatar" style="background:${scene.color}"><img src="assets/characters/${eventAvatar[id] || 'npc1_avatar.png'}" alt="${scene.speaker}"></div><div><div class="speaker-name">${scene.speaker}</div><div class="speaker-role">${scene.role}</div></div></div>
      <div class="quest-list">${progress.map(p => `<button class="quest-item ${p.done ? 'done' : ''}" data-quest="${p.index}">
        <span class="quest-badge">${p.done ? '✓ 已完成' : `第 ${p.index + 1} 轮`}</span>
        <span class="quest-name">${p.quest.title}</span>
        <span class="quest-meta-line">${p.done && p.times > 1 ? `已重复 ${p.times - 1} 次 · 收益递减` : p.done ? '可重温 · 收益递减' : `${p.quest.rounds.length} 轮问答 · ${p.quest.choices.length} 个最终选择`}</span>
        <span class="quest-arrow">›</span>
      </button>`).join('')}</div>
      <div class="story-footer">每次任务消耗 1 周；每学期 8 周，期末后进入下一学期</div>
    </div></article>`, 'scene');
  startArt($('#scene-full-art'), scene.art);
}

function showQuest(index) {
  const scene = EVENTS[sceneId]; const quest = scene.quests[index]; questIndex = index; dialogueRound = 0;
  renderDialogueRound();
}

function renderDialogueRound() {
  const scene = EVENTS[sceneId]; const quest = scene.quests[questIndex];
  const rounds = quest.rounds || [{ text: quest.text, choices: quest.choices }];
  const round = rounds[Math.min(dialogueRound, rounds.length - 1)];
  const key = `${sceneId}:${questIndex}`; const done = core.completed.includes(key);
  const isFinal = dialogueRound >= rounds.length - 1;
  openModal('quest', `${artCanvas(scene.art)}<article class="story-panel float-panel">
    <div class="story-visual scene-art-wrap" style="background:linear-gradient(130deg,${scene.art.sky[0]},${scene.art.sky[1]})"><div class="story-place">${scene.place}</div><div class="story-symbol">${scene.avatar}</div><div class="story-lines"></div></div>
    <div class="story-content"><div class="story-kicker">CAMPUS DIALOGUE · 第 ${dialogueRound + 1} / ${rounds.length} 轮 · ${core.semesterName} 第${Math.min(core.week, core.weeksPerSemester)}周</div>
      <h2 class="story-title">${quest.title}</h2>
      <div class="speaker-row"><div class="speaker-avatar" style="background:${scene.color}"><img src="assets/characters/${eventAvatar[sceneId] || 'npc1_avatar.png'}" alt="${scene.speaker}"></div><div><div class="speaker-name">${scene.speaker}</div><div class="speaker-role">${scene.role}</div></div></div>
      <div class="story-text">${round.text}</div>
      <div class="choices">${round.choices.map((choice, i) => `<button class="choice" data-choice="${i}"><span class="choice-index">${i + 1}</span><span class="choice-body">${choice.text}<span class="choice-hint">${choice.hint}${done && isFinal ? ' · 重温收益递减' : ''}</span></span><span class="choice-arrow">›</span></button>`).join('')}</div>
      <div class="story-footer">${isFinal ? '最终选择将完成任务并推进一周' : `过程问答 ${dialogueRound + 1} / ${rounds.length} · 继续对话后将进入下一轮`}</div>
    </div></article>`, 'scene');
  startArt($('#scene-full-art'), scene.art);
}

function showDialogueReply(result) {
  const scene = EVENTS[sceneId];
  const effects = Object.entries(result.applied).map(([key, value]) => `<span class="effect-item ${value >= 0 ? 'positive' : 'negative'}">${key === 'energy' ? '精力' : STAT_META[key].name} ${value >= 0 ? '+' : ''}${value}</span>`).join('');
  openModal('reply', `${artCanvas(scene.art)}<article class="reply-panel float-panel"><div class="reply-spark">✦</div><div class="reply-kicker">第 ${result.roundIndex + 1} / ${result.roundsLength} 轮问答已完成</div><h2 class="reply-title">${scene.quests[questIndex].title}</h2><p class="reply-text">${result.reply}</p><div class="effect-list">${effects}</div><button class="primary-button" data-action="next-round">继续第 ${result.roundIndex + 2} 轮问答 →</button></article>`, 'scene');
  startArt($('#scene-full-art'), scene.art);
}

function showGuide() {
  const items = [
    ['四年八学期','8 个学期覆盖完整大学四年。每学期 8 周行动 + 1 次期末考；每个场景有多轮剧情问答，可在不同学期持续探索。'],
    ['自由探索','使用 WASD / 方向键，或直接点击地面寻路。走近建筑入口与 NPC 后，点击提示卡片进入场景。'],
    ['做出选择',`${TOTAL_STORIES} 段故事均包含至少 5 轮连续问答；最终选择完成任务。重复完成仍有收益，但属性成长会递减。`],
    ['收集成就',`${ACHIEVEMENTS.length} 项成就等待解锁：完成故事、提升属性、考试全对……解锁时会有全屏飘条提示，结算页还能回看学期成绩柱状对比。`],
    ['照顾自己','行动消耗精力，每周恢复 10 点（江野 +8）。精力过低会影响心态，期末后假期会大幅恢复。'],
    ['迎接毕业',`每学期期末考由 5 道限时情境题（每题 30 秒，超时按错处理，切后台自动暂停）+ 日常成长计分。毕业时综合五项属性、属性组合和四年均分，走向 ${ENDINGS.length} 种不同结局之一。`]
  ];
  openModal('guide', `<article class="small-panel"><button class="panel-close" data-action="close">×</button><div class="panel-kicker">NEW STUDENT HANDBOOK</div><h2 class="panel-title">新生校园指南</h2>${items.map((item, i) => `<div class="guide-item"><span>0${i + 1}</span><div><b>${item[0]}</b><p>${item[1]}</p></div></div>`).join('')}<button class="secondary-button" data-action="achv">成就图鉴</button><button class="secondary-button" data-action="close">我准备好了</button><button class="text-button" data-action="restart">重新选择角色</button></article>`);
}

function showExamIntro() {
  openModal('examIntro', `<article class="small-panel"><div class="exam-emblem">末</div><div class="panel-kicker">FINAL EXAMINATION</div><h2 class="panel-title">${core.semesterName} · 期末考试</h2><p class="exam-desc">${core.semester < 8 ? '一学期的探索与选择，都将成为此刻的底气。' : '这是大学生涯的最后一场考试。'}共 5 道情境题，日常学识与实践也会影响成绩。</p><div class="exam-rule"><span>答题正确</span><b>50 分</b><span>日常成长</span><b>50 分</b></div><div class="exam-rule timer-rule"><span>每题限时</span><b>30 秒</b><span>超时</span><b>按错处理</b></div><button class="primary-button" data-action="start-exam">开始作答</button></article>`);
}

function showQuestion() {
  const questions = core.currentExam || [];
  const index = core.examAnswers.length;
  const q = questions[index]; if (!q) return showExamIntro();
  const t = core.tickExam();
  const secs = Math.max(0, Math.ceil(t.remaining / 1000));
  openModal('exam', `<article class="small-panel exam-panel-wrap"><div class="exam-progress-head"><span>第 ${core.semester} 学期期末考</span><span>${index + 1} / ${questions.length}</span></div><div class="exam-progress-track"><i style="width:${(index + 1) / questions.length * 100}%"></i></div><div class="exam-timer-row"><span class="exam-timer-label">⏱ 本题限时</span><div class="exam-timer-num" id="exam-timer">${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}</div><div class="exam-timer-track"><i id="exam-timer-bar" style="width:${t.remaining / EXAM_QUESTION_MS * 100}%"></i></div></div><div class="exam-question">${q.question}</div><div class="exam-options">${q.options.map((option, i) => `<button data-answer="${i}"><span>${option}</span><span>›</span></button>`).join('')}</div><div class="exam-note" id="exam-note">切后台会暂停计时；超时未作答按错处理</div></article>`);
  startExamTicker();
}

function showSemesterResult(result) {
  const scores = result.examScores || core.examScores;
  const chart = semesterChartHTML(scores, scores.length - 1);
  openModal('semester', `<article class="small-panel"><div class="exam-emblem" style="border-color:#7d9275;color:#5f7a5f">假</div><div class="panel-kicker">SEMESTER COMPLETE</div><h2 class="panel-title">${result.semesterName} 结束</h2><div class="score-ring"><b>${result.score}</b><small>期末成绩</small></div>${chart}<p class="exam-desc">假期里你好好休整了一番，精力大幅恢复。<br>接下来是 <b>${semesterLabel(result.semester + 1)}</b>，继续书写你的大学故事。</p><div class="exam-rule"><span>答对</span><b>${result.correct} / 5 题</b><span>超时</span><b>${result.timeouts || 0} 题</b></div><div class="exam-rule"><span>累计学期</span><b>${core.examScores.length} / 8</b><span>已解锁成就</span><b>${core.achievements.length} / ${ACHIEVEMENTS.length}</b></div><button class="primary-button" data-action="close">进入${semesterLabel(result.semester + 1)} →</button><button class="text-button" data-action="achv">查看成就图鉴</button></article>`);
}

function showEnding(ending) {
  const endingNumber = ENDINGS.findIndex(item => item.id === ending.id) + 1;
  const chart = semesterChartHTML(ending.examScores, -1, `四年成长轨迹 · 毕业均分 ${ending.score}`);
  openModal('ending', `<article class="ending-panel"><div class="ending-kicker">GRADUATION · 第 ${endingNumber} / ${ENDINGS.length} 种毕业结局</div><div class="ending-seal" style="color:${ending.color};border-color:${ending.color}">梧</div><div class="ending-tag">${ending.tag}</div><h2 class="ending-title">${ending.title}</h2><div class="score-ring"><b>${ending.score}</b><small>四年平均成绩</small></div>${chart}<p class="ending-text">${ending.text}</p><div class="ending-stats">${Object.entries(STAT_META).map(([key, meta]) => `<span>${meta.name}<b>${core.stats[key]}</b></span>`).join('')}</div><div class="ending-quote">“大学不是一张标准答卷，而是一段允许试错的路。”</div><div class="exam-rule"><span>已解锁成就</span><b>${core.achievements.length} / ${ACHIEVEMENTS.length}</b><span>全对场次</span><b>${core.perfectExams}</b></div><button class="primary-button" data-action="restart">开启另一种人生</button></article>`);
}

function showAchievements() {
  const list = buildAchievementList(core.achievementSnapshot(), core.achievements);
  const unlocked = list.filter(item => item.unlocked).length;
  openModal('achv', `<article class="small-panel achv-panel"><button class="panel-close" data-action="close">×</button><div class="panel-kicker">ACHIEVEMENT COLLECTION</div><h2 class="panel-title">成就图鉴</h2><div class="achv-summary"><div class="achv-summary-bar"><i style="width:${unlocked / list.length * 100}%"></i></div><span>${unlocked} / ${list.length} 已解锁</span></div><div class="achv-grid">${list.map(item => `<div class="achv-cell ${item.unlocked ? 'on' : ''}"><span class="achv-cell-icon" style="color:${item.catColor}">${item.icon}</span><div class="achv-cell-body"><b>${item.name}<small>${item.catName} · ${TIER_META[item.tier].label}级</small></b><p>${item.desc}</p><div class="achv-cell-bar"><i style="width:${Math.min(100, Math.round(item.current / item.target * 100))}%"></i></div></div></div>`).join('')}</div><button class="secondary-button" data-action="close">返回</button></article>`);
}

function interact() {
  if (modal) return;
  if (!world.nearby) {
    const toast = $('#location-toast'); toast.innerHTML = '<span>⌖</span><div><b>继续探索校园</b><small>走近建筑入口后，点击上方提示卡片进入</small></div>'; toast.classList.remove('hidden');
    setTimeout(() => { if (!world.nearby) toast.classList.add('hidden'); }, 1500); return;
  }
  showScene(world.nearby.event);
}

$('#guide-button').addEventListener('click', showGuide);
$('#location-toast').addEventListener('click', () => {
  if (modal || !world || !world.nearby) return;
  showScene(world.nearby.event);
});
$('#exam-button').addEventListener('click', showExamIntro);

modalContent.addEventListener('click', event => {
  const questBtn = event.target.closest('[data-quest]');
  if (questBtn) { showQuest(Number(questBtn.dataset.quest)); return; }
  const choice = event.target.closest('[data-choice]');
  if (choice) {
    const quest = EVENTS[sceneId].quests[questIndex];
    const rounds = quest.rounds || [{ choices: quest.choices }];
    const isFinal = dialogueRound >= rounds.length - 1;
    if (!isFinal) {
      const progressResult = core.applyDialogueChoice(sceneId, questIndex, dialogueRound, Number(choice.dataset.choice));
      if (!progressResult) return;
      updateHUD(); drainAchievements(); showDialogueReply(progressResult); return;
    }
    const result = core.applyChoice(sceneId, questIndex, Number(choice.dataset.choice)); if (!result) return;
    const effects = Object.entries(result.applied).map(([key, value]) => `<span class="effect-item ${value >= 0 ? 'positive' : 'negative'}">${key === 'energy' ? '精力' : STAT_META[key].name} ${value >= 0 ? '+' : ''}${value}</span>`).join('');
    updateHUD(); drainAchievements(); dialogueRound = 0;
    const scene = EVENTS[sceneId];
    openModal('reply', `${artCanvas(scene.art)}<article class="reply-panel float-panel"><div class="reply-spark">✦</div><div class="reply-kicker">五轮问答完成 · 故事已收入图鉴</div><h2 class="reply-title">${scene.quests[questIndex].title}</h2><p class="reply-text">${result.reply}</p><div class="effect-list">${effects}</div><button class="primary-button" data-action="continue">继续校园生活 →</button></article>`, 'scene');
    startArt($('#scene-full-art'), scene.art); return;
  }
  const answer = event.target.closest('[data-answer]');
  if (answer) {
    core.answerExam(Number(answer.dataset.answer));
    if (core.examAnswers.length >= core.currentExam.length) handleExamFinished();
    else showQuestion();
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'close') { closeModal(); updateHUD(); }
  if (action === 'continue') { core.examReady ? showExamIntro() : closeModal(); }
  if (action === 'next-round') { dialogueRound += 1; renderDialogueRound(); }
  if (action === 'start-exam') { core.startExam(); showQuestion(); }
  if (action === 'achv') showAchievements();
  if (action === 'restart') location.reload();
});

// 考试倒计时：切后台/失焦暂停，回到前台恢复
document.addEventListener('visibilitychange', () => { if (!core || !core.examTimer) return; document.hidden ? core.pauseExam() : core.resumeExam(); });
window.addEventListener('blur', () => { if (core && core.examTimer) core.pauseExam(); });
window.addEventListener('focus', () => { if (core && core.examTimer) core.resumeExam(); });

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
  if (modal) return;
  const point = renderer.screenToWorld(event.clientX, event.clientY); world.setTarget(point.x, point.y);
});

characterCards();
