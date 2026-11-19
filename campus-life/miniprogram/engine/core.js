const { CHARACTERS, EVENTS, ENDINGS, NPCS, REQUESTS, CHAIN_EVENTS, LEGACY_OPTIONS, HIDDEN_EVENTS, EXAM_BANK, affinityTier, getExamQuestions, semesterLabel } = require('../data/content');
const { createRng, decodeSeed, encodeSeed } = require('./random');
const { evaluateAchievements, achievementById } = require('../data/achievements');

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

// 期末考单题限时（毫秒）：考试卡倒计时与超时判错共用
const EXAM_QUESTION_MS = 30000;

// 种子码必须由调用方给进来：引擎自己不掷骰子，同一个码必然复现同一局
function resolveSeedCode(seedCode) {
  const seed = decodeSeed(seedCode);
  if (seed === null) throw new Error('种子码不合法');
  return encodeSeed(seed);
}

// 按种子从题库里抽 5 题：同一套题里不重复，同一种子必然抽到同一套题
function pickExamQuestions(rng) {
  const pool = EXAM_BANK.slice();
  const result = [];
  while (result.length < 5 && pool.length) {
    const index = Math.floor(rng() * pool.length);
    result.push(pool.splice(index, 1)[0]);
  }
  return result;
}

// 属性 key -> 中文名，因果面板靠它把「影响」翻译成人话
const EFFECT_LABELS = { knowledge: '学识', fitness: '体魄', mood: '心态', social: '人缘', practice: '实践', energy: '精力' };

function effectLabel(key) { return EFFECT_LABELS[key] || key; }

// 一次选择会影响哪些维度（因果面板的分类标签）
function effectTags(effects) {
  const tags = [];
  Object.keys(effects || {}).forEach(key => {
    const label = effectLabel(key);
    if (!tags.includes(label)) tags.push(label);
  });
  return tags;
}

class GameCore {
  // options: { seedCode, playthrough, legacyId }；老调用也可以直接把种子码当第二个参数传
  constructor(characterId = 'lin', options = {}) {
    this.reset(characterId, options);
  }

  reset(characterId = 'lin', options = {}) {
    const opts = typeof options === 'string' ? { seedCode: options } : (options || {});
    this.character = CHARACTERS.find(item => item.id === characterId) || CHARACTERS[0];
    this.stats = { ...this.character.stats };
    this.energy = 82;
    this.semester = 1;          // 1..8，覆盖大学四年
    this.week = 1;              // 每学期 4 周
    this.weeksPerSemester = 4;
    this.maxSemesters = 8;
    this.completed = [];        // 任务 key: "scene:questIndex"
    this.visited = {};
    this.examAnswers = [];
    this.currentExam = null;
    this.examScores = [];       // 每学期成绩
    this.bestExamScore = 0;     // 单场最高期末分
    this.examTimer = null;      // { remaining, running, lastAt } 单题倒计时
    this.examTimeouts = 0;      // 本场考试超时题数（按错处理）
    this.perfectExams = 0;      // 全对场次
    this.calmExams = 0;         // 无超时题的完整场次
    this.perfectScoreExams = 0; // 满分 100 分场次
    this.minExamScore = null;   // 历史最低学期成绩
    this.burnedExams = 0;       // 精力低于 15 开考仍拿 85 分以上的场次
    this.examStartEnergy = null;// 本场开考时的精力（用于隐藏成就判定）
    this.ending = null;
    this.achievements = [];         // 已解锁成就 id（按解锁顺序）
    this.achievementLog = [];       // 解锁记录 { id, semester, week }
    this.pendingAchievements = [];  // 待 UI 弹出全屏飘条的成就 id 队列
    this.energyLowReached = false;  // 精力是否曾跌破 20（「极限运转」成就）
    // 关系：每个 NPC 一个好感度，答应加、拒绝减，久了不维护会淡
    this.affinity = {};
    // 主动找上门、还没答复的请求
    this.requests = [];
    this.resolvedRequests = [];
    // 延迟触发队列：还没发作的连锁事件 { eventId, fireAt, origin }
    this.triggers = [];
    // 已经发作、等着玩家处理的连锁事件
    this.pendingChains = [];
    this.absoluteWeek = 1;      // 跨学期连续累加的周序号，延迟队列靠它计时
    this.requestCooldown = 1;
    this.requestPatience = 3;   // NPC 等你几周就会走
    this.maxActiveRequests = 1;
    this.nextRequestWeek = 2;
    this.log = [`与${this.character.name}一起，在青梧大学开始四年的旅程。`];
    this.choiceLog = [];        // 结构化选择日志：每次选择记一条，供「选择日志」面板回看
    this.seedCode = resolveSeedCode(opts.seedCode);  // 本局的种子码：同码必然复现同一局
    this.seed = decodeSeed(this.seedCode);
    this.rng = createRng(this.seed);

    // ===== 周目继承 =====
    this.playthrough = Math.max(1, Math.floor(opts.playthrough || 1));
    this.legacy = null;         // 本局继承的遗物（LEGACY_OPTIONS 里的一项）
    this.legacyId = null;
    this.legacyEnergyBonus = 0; // 遗物带来的每周额外精力
    this.hiddenCleared = [];    // 本局完成过的隐藏事件 id

    // ===== 因果记录：每一次选择，以及它后来影响了什么 =====
    this.choiceSeq = 0;
    this.totalHiddenQuests = Object.keys(HIDDEN_EVENTS).reduce((sum, scene) => sum + HIDDEN_EVENTS[scene].length, 0);

    if (opts.legacyId) this.applyLegacy(opts.legacyId);
  }

  get semesterName() { return semesterLabel(this.semester); }
  get examReady() { return this.week > this.weeksPerSemester && !this.ending; }
  get totalProgress() { return Math.round(((this.semester - 1) * this.weeksPerSemester + Math.min(this.week, this.weeksPerSemester) - 1) / (this.maxSemesters * this.weeksPerSemester) * 100); }
  get isReplay() { return this.playthrough > 1; }

  getScene(sceneId) { return EVENTS[sceneId]; }

  // ============ 周目继承 ============

  // 接住上一周目留下的那一样东西：属性 / 道具 / 每周精力 / 初始好感
  applyLegacy(legacyId) {
    const option = LEGACY_OPTIONS.find(item => item.id === legacyId);
    if (!option) return null;
    const applied = {};
    Object.keys(option.effect || {}).forEach(key => {
      this.stats[key] = clamp((this.stats[key] || 0) + option.effect[key]);
      applied[key] = option.effect[key];
    });
    if (option.weeklyEnergy) this.legacyEnergyBonus = option.weeklyEnergy;
    if (option.affinityAll) NPCS.forEach(npc => { this.affinity[npc.id] = (this.affinity[npc.id] || 0) + option.affinityAll; });
    this.legacyId = option.id;
    this.legacy = option;
    this.log.unshift(`你带着「${option.name}」重新走进校门。`);
    this.pushLog({
      type: 'legacy', sceneName: '校门口', title: `第 ${this.playthrough} 周目 · 继承「${option.name}」`,
      choice: option.effectText, effects: applied, tags: effectTags(applied),
      note: option.hiddenEvent ? '隐藏事件的条件已满足，去对应场景看看。' : ''
    });
    return { option, applied };
  }

  // 这个遗物解锁的隐藏事件能不能进（需要继承指定遗物 + 场景前置任务已完成）
  hiddenUnlocked(def) {
    if (!def) return false;
    if (def.requires && this.legacyId !== def.requires) return false;
    if (def.after && !this.completed.includes(def.after)) return false;
    return true;
  }

  hiddenRequireText(def) {
    const legacy = LEGACY_OPTIONS.find(item => item.id === def.requires);
    const parts = [];
    if (legacy) parts.push(`继承「${legacy.name}」`);
    if (def.after) {
      const [sceneId, index] = def.after.split(':');
      const quest = EVENTS[sceneId] && EVENTS[sceneId].quests[Number(index)];
      parts.push(`完成「${quest ? quest.title : def.after}」`);
    }
    return parts.join(' · ');
  }

  // 该场景的隐藏事件（含锁定状态与它在任务列表里的序号）
  hiddenQuestsFor(sceneId) {
    const scene = EVENTS[sceneId];
    if (!scene) return [];
    return (HIDDEN_EVENTS[sceneId] || []).map((def, offset) => {
      const index = scene.quests.length + offset;
      return { ...def, index, locked: !this.hiddenUnlocked(def), requireText: this.hiddenRequireText(def) };
    });
  }

  // 统一取任务：先取普通任务，超出部分去隐藏事件里找
  questAt(sceneId, index) {
    const scene = EVENTS[sceneId];
    if (!scene) return null;
    if (index < scene.quests.length) return scene.quests[index] || null;
    const hidden = this.hiddenQuestsFor(sceneId)[index - scene.quests.length];
    return hidden || null;
  }

  hiddenClearedCount() { return this.hiddenCleared.length; }

  // ============ 因果记录 ============

  // 每一次选择都写一条，记下「我选了什么 / 当场影响了什么 / 后来会引发什么」
  pushLog(entry = {}) {
    this.choiceSeq += 1;
    const record = {
      id: `c${this.choiceSeq}`,
      type: entry.type || 'quest',
      semester: this.semester,
      semesterName: this.semesterName,
      week: Math.min(this.week, this.weeksPerSemester),
      absoluteWeek: this.absoluteWeek,
      at: `${this.semesterName} · 第 ${Math.min(this.week, this.weeksPerSemester)} 周`,
      scene: entry.scene || null,
      sceneName: entry.sceneName || '',
      title: entry.title || '',
      speaker: entry.speaker || '',
      choice: entry.choice || '',
      effects: entry.effects || {},
      affinity: entry.affinity || null,
      tags: entry.tags || [],
      note: entry.note || '',
      consequences: entry.consequences || [],
      // 选择日志面板（keioey 那套视图）用的字段别名
      sceneId: entry.scene || null,
      questTitle: entry.title || '',
      choiceText: entry.choice || '',
      repeat: !!entry.repeat
    };
    this.choiceLog.push(record);
    if (this.choiceLog.length > 240) this.choiceLog.shift();
    return record;
  }

  // 某个选择埋下的后果发作了，回头给那条记录补一笔
  markConsequenceFired(originId, eventId, firedAt) {
    if (!originId) return;
    const record = this.choiceLog.find(item => item.id === originId);
    if (!record) return;
    const consequence = record.consequences.find(item => item.eventId === eventId);
    if (consequence) { consequence.fired = true; consequence.firedAt = firedAt; }
  }

  // ============ 成就系统 ============

  // 快照：把成就判定需要的所有字段一次性算好，纯读不写
  achievementSnapshot() {
    const sceneCounts = {};
    this.completed.forEach(key => { const scene = key.split(':')[0]; sceneCounts[scene] = (sceneCounts[scene] || 0) + 1; });
    const visitedValues = Object.values(this.visited);
    const statKeys = ['knowledge', 'fitness', 'mood', 'social', 'practice'];
    return {
      characterId: this.character.id,
      stats: { ...this.stats },
      energy: this.energy,
      energyLowReached: this.energyLowReached,
      completedCount: this.completed.length,
      totalStories: Object.values(EVENTS).reduce((sum, scene) => sum + scene.quests.length, 0),
      visitedScenes: Object.keys(sceneCounts).length,
      totalScenes: Object.keys(EVENTS).length,
      sceneMaxCompleted: Object.keys(EVENTS).reduce((max, sceneId) => Math.max(max, sceneCounts[sceneId] || 0), 0),
      sceneQuestTarget: Math.max(...Object.values(EVENTS).map(scene => scene.quests.length)),
      repeatedQuests: visitedValues.filter(times => times > 1).length,
      maxVisited: visitedValues.reduce((max, times) => Math.max(max, times), 0),
      semestersFinished: this.ending ? this.maxSemesters : this.semester - 1,
      examScores: [...this.examScores],
      avgExamScore: this.examScores.length ? Math.round(this.examScores.reduce((a, b) => a + b, 0) / this.examScores.length) : 0,
      bestExamScore: this.bestExamScore,
      perfectExams: this.perfectExams,
      calmExams: this.calmExams,
      perfectScoreExams: this.perfectScoreExams,
      minExamScore: this.minExamScore === null ? 100 : this.minExamScore,
      burnedExams: this.burnedExams,
      unlockedIds: [...this.achievements],
      graduated: !!this.ending,
      endingId: this.ending ? this.ending.id : null,
      statKeys
    };
  }

  // 评估并解锁新成就，返回本次新解锁的完整成就对象列表
  // 两轮判定：「图鉴完全体」这类元成就要等其他成就先入账才满足条件
  checkAchievements() {
    const fresh = [];
    for (let pass = 0; pass < 2; pass++) {
      const snapshot = this.achievementSnapshot();
      const batch = evaluateAchievements(snapshot, this.achievements);
      if (!batch.length) break;
      batch.forEach(item => {
        this.achievements.push(item.id);
        this.achievementLog.push({ id: item.id, semester: this.semester, week: this.week });
        this.pendingAchievements.push(item.id);
        fresh.push(item);
      });
    }
    return fresh;
  }

  // UI 取走一条待弹出成就（全屏飘条队列）
  consumePendingAchievement() {
    const id = this.pendingAchievements.shift();
    return id ? achievementById(id) : null;
  }

  // ============ 期末考倒计时（超时按错处理） ============
  // 时间由调用方注入（毫秒时间戳），引擎自身不读墙钟，保持确定性可复现。

  // 单题倒计时推进：返回剩余毫秒与是否超时
  tickExam(now) {
    const timer = this.examTimer;
    if (!timer) return { remaining: 0, running: false, timedOut: false };
    if (!timer.running || !this.currentExam) return { remaining: timer.remaining, running: timer.running, timedOut: false };
    const delta = Math.max(0, now - timer.lastAt);
    timer.lastAt = now;
    timer.remaining = Math.max(0, timer.remaining - delta);
    return { remaining: timer.remaining, running: true, timedOut: timer.remaining <= 0 };
  }

  // 切后台/失焦时暂停计时
  pauseExam(now) {
    if (this.examTimer && this.examTimer.running) { this.tickExam(now); this.examTimer.running = false; }
  }

  // 回到前台时恢复计时
  resumeExam(now) {
    if (this.examTimer && !this.examTimer.running) { this.examTimer.running = true; this.examTimer.lastAt = now; }
  }

  // 超时判错：记 -1 并立即进入下一题
  timeoutExamQuestion(now) {
    const questions = this.currentExam;
    if (!questions || this.examAnswers.length >= questions.length) return null;
    this.examAnswers.push(-1);
    this.examTimeouts += 1;
    this.resetExamTimer(now);
    return { timedOut: true, finished: this.examAnswers.length >= questions.length };
  }

  resetExamTimer(now) {
    this.examTimer = { remaining: EXAM_QUESTION_MS, running: true, lastAt: now };
  }

  // 因果面板要的全部数据：总量、分类计数、时间线、还没发作的后果
  causeReport() {
    const entries = this.choiceLog.slice();
    const totals = {};
    entries.forEach(entry => {
      Object.keys(entry.effects || {}).forEach(key => { totals[key] = (totals[key] || 0) + entry.effects[key]; });
    });
    const counts = { quest: 0, request: 0, chain: 0, exam: 0, legacy: 0, hidden: 0 };
    entries.forEach(entry => { counts[entry.type] = (counts[entry.type] || 0) + 1; });
    const pending = this.scheduledTriggers().map(item => ({ title: item.def ? item.def.title : item.eventId, inWeeks: item.inWeeks }));
    const affinity = Object.keys(this.affinity)
      .filter(id => this.affinity[id])
      .map(id => ({ id, name: this.npcName(id), value: this.affinity[id] }));
    return {
      playthrough: this.playthrough,
      legacy: this.legacy,
      total: entries.length,
      totals, counts, entries, pending, affinity,
      hidden: { total: this.totalHiddenQuests, cleared: this.hiddenCleared.slice(), unlocked: this.hiddenQuestsForAllScenes().filter(item => !item.locked).map(item => item.id) }
    };
  }

  hiddenQuestsForAllScenes() {
    return Object.keys(HIDDEN_EVENTS).reduce((list, sceneId) => list.concat(this.hiddenQuestsFor(sceneId)), []);
  }

  // 该场景的任务完成状态列表（普通任务 + 隐藏事件）
  sceneProgress(sceneId) {
    const scene = EVENTS[sceneId];
    if (!scene) return [];
    const base = scene.quests.map((quest, index) => ({
      quest, index, hidden: false, locked: false,
      done: this.completed.includes(`${sceneId}:${index}`),
      times: this.visited[`${sceneId}:${index}`] || 0
    }));
    const hidden = this.hiddenQuestsFor(sceneId).map(def => ({
      quest: def, index: def.index, hidden: true, locked: def.locked, requireText: def.requireText,
      badge: def.locked ? '隐藏事件 · 未解锁' : '隐藏事件',
      done: this.completed.includes(`${sceneId}:${def.index}`),
      times: this.visited[`${sceneId}:${def.index}`] || 0
    }));
    return base.concat(hidden);
  }

  // ============ 关系 ============

  affinityOf(npcId) { return this.affinity[npcId] || 0; }
  affinityTierOf(npcId) { return affinityTier(this.affinityOf(npcId)); }
  npcOfScene(sceneId) { return NPCS.find(n => n.event === sceneId) || null; }

  // 统一结算属性/精力，角色特长与好感度加成都收在这里
  applyEffects(effects, options = {}) {
    const { sceneId = null, factor = 1, npcId = null } = options;
    const applied = {};
    Object.keys(effects || {}).forEach(key => {
      let value = effects[key];
      if (key !== 'energy') value = Math.max(1, Math.round(value * factor));
      if (key === 'knowledge' && this.character.id === 'chen' && value > 0 && sceneId && ['library', 'classroom', 'lab'].includes(sceneId)) value += 2;
      if (key === 'social' && this.character.id === 'lin' && value > 0) value += 1;
      // 关系维护到位时，和这个人有关的行动收益更高
      if (key !== 'energy' && value > 0 && npcId && this.affinityOf(npcId) >= 30) value = Math.round(value * 1.3);
      applied[key] = value;
      if (key === 'energy') this.energy = clamp(this.energy + value);
      else this.stats[key] = clamp(this.stats[key] + value);
    });
    return applied;
  }

  // ============ 请求事件调度器 ============

  // 当前排得上号的请求（已解锁、没答复过、也不在队列里）
  eligibleRequests() {
    return REQUESTS.filter(request => {
      const requires = request.requires || {};
      return !this.resolvedRequests.includes(request.id)
        && !this.requests.some(item => item.id === request.id)
        && this.affinityOf(request.npc) >= (requires.affinity || 0)
        && this.semester >= (requires.semester || 1);
    });
  }

  // 找一个 NPC 带着请求找上门，返回新排上的请求（没有则返回 null）
  scheduleRequest() {
    // 等太久的请求会过期：NPC 不再上门，关系也会淡下去
    this.requests = this.requests.filter(item => {
      if (this.absoluteWeek - item.since < this.requestPatience) return true;
      this.affinity[item.npc] = (this.affinity[item.npc] || 0) - 4;
      this.log.unshift(`有人等了你很久，最后还是走了。`);
      return false;
    });
    if (this.requests.length >= this.maxActiveRequests) return null;
    if (this.absoluteWeek < this.nextRequestWeek) return null;
    const candidates = this.eligibleRequests();
    if (!candidates.length) return null;
    // 越熟的人，越可能先想起你
    candidates.sort((a, b) => this.affinityOf(b.npc) - this.affinityOf(a.npc));
    const picked = candidates[0];
    this.requests.push({ id: picked.id, npc: picked.npc, since: this.absoluteWeek });
    this.nextRequestWeek = this.absoluteWeek + this.requestCooldown;
    this.log.unshift(`有同学来找你：${picked.title}`);
    return picked;
  }

  pendingRequestFor(npcId) {
    const item = this.requests.find(entry => entry.npc === npcId);
    if (!item) return null;
    const def = REQUESTS.find(request => request.id === item.id);
    return def ? { ...def, npc: item.npc } : null;
  }

  pendingRequests() {
    return this.requests.map(item => {
      const def = REQUESTS.find(request => request.id === item.id);
      return def ? { ...def, npc: item.npc, since: item.since } : null;
    }).filter(Boolean);
  }

  // 答应或拒绝：结果写进好感度
  resolveRequest(requestId, choiceIndex) {
    const def = REQUESTS.find(request => request.id === requestId);
    const item = this.requests.find(entry => entry.id === requestId);
    if (!def || !item) return null;
    const choice = def.choices[choiceIndex];
    if (!choice) return null;
    const applied = this.applyEffects(choice.effects, { npcId: item.npc });
    const delta = choice.affinity || 0;
    this.affinity[item.npc] = (this.affinity[item.npc] || 0) + delta;
    this.requests.splice(this.requests.indexOf(item), 1);
    this.resolvedRequests.push(requestId);
    const total = this.affinityOf(item.npc);
    const name = this.npcName(item.npc);
    this.log.unshift(`你${delta >= 0 ? '答应' : '拒绝了'}「${def.title}」，与${name}的好感 ${delta >= 0 ? '+' : ''}${delta}（当前 ${total}）。`);
    this.pushLog({
      type: 'request', title: def.title, sceneName: name, speaker: name,
      choice: choice.text, effects: applied, tags: effectTags(applied),
      affinity: { npc: item.npc, name, delta, total, accepted: delta > 0 },
      note: delta >= 0 ? '答应下来，关系往前走了一步。' : '拒绝也会被记住，关系往后退了一步。'
    });
    return { reply: choice.reply, applied, affinity: delta, total, npc: item.npc, tier: affinityTier(total), accepted: delta > 0 };
  }

  npcName(npcId) {
    const npc = NPCS.find(item => item.id === npcId);
    return npc ? npc.name : '对方';
  }

  // ============ 连锁事件与延迟触发队列 ============

  // 把一个连锁事件排进延迟队列，delay 周之后才发作；origin 指向埋下它的那条因果记录
  scheduleTrigger(eventId, delay = 1, origin = null) {
    const def = CHAIN_EVENTS[eventId];
    if (!def) return null;
    const entry = { eventId, fireAt: this.absoluteWeek + (delay || 1), origin };
    this.triggers.push(entry);
    this.log.unshift(`「${def.title}」被记下了，${entry.fireAt - this.absoluteWeek} 周之后才会发作。`);
    return entry;
  }

  // 把到期的连锁事件取出来，同时把下一级也排进队列（链条会自己往下滚）
  collectTriggers() {
    const fired = [];
    let guard = 0;
    while (guard++ < 32) {
      const due = this.triggers.filter(entry => entry.fireAt <= this.absoluteWeek);
      if (!due.length) break;
      due.forEach(entry => {
        const index = this.triggers.indexOf(entry);
        if (index >= 0) this.triggers.splice(index, 1);
        if (this.pendingChains.includes(entry.eventId)) return;
        this.pendingChains.push(entry.eventId);
        fired.push(entry.eventId);
        // 因果闭环：回头给当初那个选择补上「它后来引发了什么」
        this.markConsequenceFired(entry.origin, entry.eventId, this.absoluteWeek);
        const def = CHAIN_EVENTS[entry.eventId];
        if (def && def.next) this.scheduleTrigger(def.next, def.nextDelay || 2, entry.origin);
      });
    }
    if (fired.length) this.log.unshift(`${fired.length} 件事情找上门了。`);
    return fired;
  }

  pendingChainEvents() {
    return this.pendingChains.map(id => CHAIN_EVENTS[id]).filter(Boolean);
  }

  scheduledTriggers() {
    return this.triggers.map(entry => ({ ...entry, def: CHAIN_EVENTS[entry.eventId], inWeeks: Math.max(0, entry.fireAt - this.absoluteWeek) }));
  }

  resolveChain(eventId, choiceIndex) {
    const def = CHAIN_EVENTS[eventId];
    const index = this.pendingChains.indexOf(eventId);
    if (!def || index < 0) return null;
    const choice = def.choices[choiceIndex];
    if (!choice) return null;
    const applied = this.applyEffects(choice.effects);
    this.pendingChains.splice(index, 1);
    this.log.unshift(`处理了「${def.title}」。`);
    this.pushLog({
      type: 'chain', title: def.title, sceneName: def.place, speaker: def.speaker,
      choice: choice.text, effects: applied, tags: effectTags(applied),
      note: '这是之前某个选择滚出来的后果，你刚刚给它收了尾。'
    });
    return { reply: choice.reply, applied, event: def };
  }

  // ============ 主流程 ============

  /* 过程问答：一段任务先聊 3~4 轮，每轮只影响属性、不推进周数，
     最后那一轮才交给 applyChoice 结算（推进 1 周、写日志、触发请求与连锁）。
     rounds 由 data/expansion.js 的 buildDialogueRounds 在启动时挂到每个 quest 上。 */
  applyDialogueChoice(sceneId, questIndex, roundIndex, choiceIndex) {
    if (this.examReady || this.ending) return null;
    const scene = EVENTS[sceneId];
    const quest = scene && scene.quests[questIndex];
    if (!quest) return null;
    if (quest.requires && !this.hiddenUnlocked(quest)) return null;
    const rounds = quest.rounds || [];
    const round = rounds[roundIndex];
    const choice = round && round.choices && round.choices[choiceIndex];
    if (!choice) return null;

    const key = `${sceneId}:${questIndex}`;
    const repeat = (this.visited[key] || 0) > 0;
    const factor = repeat ? 0.5 : 1;
    const applied = {};
    Object.keys(choice.effects || {}).forEach(k => {
      const raw = choice.effects[k] || 0;
      let value = Math.round(raw * factor);
      // 过程问答里正收益至少给 1，别因为递减变成 0 让人白点一次
      if (k !== 'energy' && raw > 0) value = Math.max(1, value);
      applied[k] = value;
      if (k === 'energy') this.energy = clamp(this.energy + value);
      else if (this.stats[k] !== undefined) this.stats[k] = clamp(this.stats[k] + value);
    });
    if (this.energy < 20) this.energyLowReached = true;
    this.checkAchievements();

    return { reply: choice.reply, applied, repeat, roundIndex, roundsLength: rounds.length };
  }

  applyChoice(sceneId, questIndex, choiceIndex) {
    if (this.examReady || this.ending) return null;
    const scene = EVENTS[sceneId];
    const quest = this.questAt(sceneId, questIndex);
    if (!scene || !quest || !quest.choices) return null;
    // 隐藏事件没解锁前不给选
    if (quest.requires && !this.hiddenUnlocked(quest)) return null;
    const choice = quest.choices[choiceIndex];
    if (!choice) return null;

    const key = `${sceneId}:${questIndex}`;
    const hidden = !!quest.requires;
    const repeat = (this.visited[key] || 0) > 0;
    const factor = repeat ? 0.4 : 1;
    const npc = this.npcOfScene(sceneId);
    const applied = this.applyEffects(choice.effects, { sceneId, factor, npcId: npc ? npc.id : null });
    if (this.character.id === 'su' && !this.visited[key]) this.stats.mood = clamp(this.stats.mood + 2);
    if (this.energy < 20) { this.stats.mood = clamp(this.stats.mood - 2); this.energyLowReached = true; }

    this.visited[key] = (this.visited[key] || 0) + 1;
    if (!this.completed.includes(key)) this.completed.push(key);
    this.log.unshift(`${this.semesterName} · 第${this.week}周 · ${quest.title}`);
    if (hidden && !this.hiddenCleared.includes(quest.id)) this.hiddenCleared.push(quest.id);

    // 把这次选择写进因果记录，后面再有后果发作就能挂回这一条
    const record = this.pushLog({
      type: hidden ? 'hidden' : 'quest',
      scene: sceneId, sceneName: scene.name, title: quest.title, speaker: scene.speaker,
      choice: choice.text, effects: applied, tags: effectTags(applied),
      repeat,
      note: hidden ? `隐藏事件 · ${quest.title}` : ''
    });
    this.week += 1;
    this.absoluteWeek += 1;
    this.energy = clamp(this.energy + 10 + (this.character.id === 'jiang' ? 8 : 0) + this.legacyEnergyBonus);

    // 这个选择可能埋下后果：排进延迟队列，几周之后才发作
    let chained = null;
    if (choice.chain && choice.chain.event) {
      chained = this.scheduleTrigger(choice.chain.event, choice.chain.delay || 1, record.id);
      const chainDef = CHAIN_EVENTS[choice.chain.event];
      record.consequences.push({
        type: 'chain', eventId: choice.chain.event,
        title: chainDef ? chainDef.title : choice.chain.event,
        fireAt: chained ? chained.fireAt : this.absoluteWeek + 1, fired: false
      });
      record.note = `埋下了一个后果：${chainDef ? chainDef.title : choice.chain.event} 会在 ${chained ? Math.max(1, chained.fireAt - this.absoluteWeek) : 1} 周后找上来。`;
    }
    const fired = this.collectTriggers();
    const request = this.scheduleRequest();
    this.checkAchievements();
    return { reply: choice.reply, applied, repeat, examReady: this.examReady, chained, fired, request, logId: record.id, hidden: hidden ? quest : null };
  }

  startExam(now = 0) {
    if (!this.examReady) return null;
    this.currentExam = pickExamQuestions(this.rng);
    this.examAnswers = [];
    this.examTimeouts = 0;
    this.examStartEnergy = this.energy;
    this.resetExamTimer(now);
    return this.currentExam;
  }

  answerExam(index, now = 0) {
    const questions = this.currentExam;
    if (!questions || this.examAnswers.length >= questions.length || index < 0 || index > 3) return null;
    // 倒计时已耗尽时点击：按超时判错处理
    if (this.examTimer && this.tickExam(now).timedOut) return this.timeoutExamQuestion(now);
    this.examAnswers.push(index);
    this.resetExamTimer(now);
    return { timedOut: false, finished: this.examAnswers.length >= questions.length };
  }

  // 返回 { semesterResult } 进入下一学期，或 { ending } 大四毕业结算
  finishExam() {
    const questions = this.currentExam;
    if (!questions || this.examAnswers.length !== questions.length) return null;
    const correct = this.examAnswers.reduce((sum, a, i) => sum + (a === questions[i].answer ? 1 : 0), 0);
    const score = Math.round(clamp(correct * 10 + this.stats.knowledge * 0.35 + this.stats.practice * 0.15));
    this.examScores.push(score);
    if (score > this.bestExamScore) this.bestExamScore = score;
    if (correct === questions.length) this.perfectExams += 1;
    if (this.examTimeouts === 0) this.calmExams += 1;
    if (score >= 100) this.perfectScoreExams += 1;
    this.minExamScore = this.minExamScore === null ? score : Math.min(this.minExamScore, score);
    if (this.examStartEnergy !== null && this.examStartEnergy < 15 && score >= 85) this.burnedExams += 1;
    this.examStartEnergy = null;
    this.examTimer = null;
    this.pushLog({
      type: 'exam', title: `${this.semesterName} 期末考试`, sceneName: '考场',
      choice: `答对 ${correct} / ${questions.length} 题`,
      effects: {}, tags: ['学业'], note: `期末成绩 ${score} 分，已计入四年均分。`
    });
    this.absoluteWeek += 1;      // 考试与假期也占掉一周，延迟队列继续往下走
    this.collectTriggers();
    this.scheduleRequest();

    if (this.semester >= this.maxSemesters) {
      const avg = Math.round(this.examScores.reduce((a, b) => a + b, 0) / this.examScores.length);
      this.ending = { ...this.pickEnding(avg), score: avg, examScores: [...this.examScores], stats: { ...this.stats } };
      this.checkAchievements();
      return { ending: this.ending };
    }

    const result = { semester: this.semester, semesterName: semesterLabel(this.semester), score, correct, timeouts: this.examTimeouts, examScores: [...this.examScores] };
    this.semester += 1;
    this.week = 1;
    this.currentExam = null;
    this.examAnswers = [];
    this.energy = clamp(this.energy + 40); // 假期恢复
    this.checkAchievements();
    return { semesterResult: result, nextSemester: this.semester, nextSemesterName: semesterLabel(this.semester) };
  }

  pickEnding(avgExam) {
    const s = this.stats;
    const scores = {
      scholar: s.knowledge + avgExam,
      leader: s.social + s.practice,
      maker: s.practice + s.knowledge * 0.5 + avgExam * 0.3,
      sunshine: s.mood + s.fitness
    };
    const order = ['scholar', 'leader', 'maker', 'sunshine'];
    let best = order[0];
    order.forEach(id => { if (scores[id] > scores[best]) best = id; });
    if (scores[best] < 100) return ENDINGS.find(e => e.id === 'ordinary');
    return ENDINGS.find(e => e.id === best);
  }

  serialize() {
    return {
      characterId: this.character.id, stats: this.stats, energy: this.energy,
      semester: this.semester, week: this.week, completed: this.completed,
      visited: this.visited, examScores: this.examScores, log: this.log.slice(0, 40),
      affinity: this.affinity, requests: this.requests, resolvedRequests: this.resolvedRequests,
      triggers: this.triggers, pendingChains: this.pendingChains, absoluteWeek: this.absoluteWeek,
      choiceLog: this.choiceLog.slice(-120), choiceSeq: this.choiceSeq,
      seedCode: this.seedCode, rngState: this.rng.getState(),
      playthrough: this.playthrough, legacyId: this.legacyId,
      legacyEnergyBonus: this.legacyEnergyBonus, hiddenCleared: this.hiddenCleared,
      achievements: this.achievements.slice(), achievementLog: this.achievementLog.slice(),
      energyLowReached: this.energyLowReached, bestExamScore: this.bestExamScore,
      perfectExams: this.perfectExams, calmExams: this.calmExams,
      perfectScoreExams: this.perfectScoreExams, minExamScore: this.minExamScore,
      burnedExams: this.burnedExams
    };
  }

  // 从存档还原一局：种子码决定随机序列，rngState 决定序列走到了第几步，
  // 所以还原之后继续玩，抽到的考题和结局都和存档时一模一样。
  static restore(state) {
    const core = new GameCore(state.characterId, state.seedCode);
    core.stats = { ...state.stats };
    core.energy = state.energy;
    core.semester = state.semester;
    core.week = state.week;
    core.completed = state.completed.slice();
    core.visited = { ...state.visited };
    core.examScores = state.examScores.slice();
    core.choiceLog = state.choiceLog.map(entry => ({ ...entry, effects: { ...entry.effects } }));
    // 关系 / 请求 / 连锁事件的进度也要一起还原，否则读档后它们全部消失
    core.log = (state.log || []).slice();
    core.affinity = { ...(state.affinity || {}) };
    core.requests = (state.requests || []).map(item => ({ ...item }));
    core.resolvedRequests = (state.resolvedRequests || []).slice();
    core.triggers = (state.triggers || []).map(item => ({ ...item }));
    core.pendingChains = (state.pendingChains || []).map(item => ({ ...item }));
    if (state.absoluteWeek !== undefined) core.absoluteWeek = state.absoluteWeek;
    // 周目继承与因果记录的进度同样要还原
    if (state.playthrough !== undefined) core.playthrough = state.playthrough;
    if (state.legacyId) {
      core.legacyId = state.legacyId;
      core.legacy = LEGACY_OPTIONS.find(item => item.id === state.legacyId) || null;
    }
    core.legacyEnergyBonus = state.legacyEnergyBonus || 0;
    core.hiddenCleared = (state.hiddenCleared || []).slice();
    if (state.choiceSeq !== undefined) core.choiceSeq = state.choiceSeq;
    if (state.rngState !== undefined) core.rng.setState(state.rngState);
    // 成就与考试追踪字段（旧存档没有这些字段时保持默认，不报错）
    if (state.achievements !== undefined) core.achievements = state.achievements.slice();
    if (state.achievementLog !== undefined) core.achievementLog = state.achievementLog.map(item => ({ ...item }));
    if (state.energyLowReached !== undefined) core.energyLowReached = state.energyLowReached;
    if (state.bestExamScore !== undefined) core.bestExamScore = state.bestExamScore;
    if (state.perfectExams !== undefined) core.perfectExams = state.perfectExams;
    if (state.calmExams !== undefined) core.calmExams = state.calmExams;
    if (state.perfectScoreExams !== undefined) core.perfectScoreExams = state.perfectScoreExams;
    if (state.minExamScore !== undefined) core.minExamScore = state.minExamScore;
    if (state.burnedExams !== undefined) core.burnedExams = state.burnedExams;
    return core;
  }
}

module.exports = { GameCore, pickExamQuestions, clamp, EFFECT_LABELS, effectLabel, effectTags, EXAM_QUESTION_MS };
