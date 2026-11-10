const { CHARACTERS, EVENTS, ENDINGS, NPCS, REQUESTS, CHAIN_EVENTS, LEGACY_OPTIONS, HIDDEN_EVENTS, affinityTier, getExamQuestions, semesterLabel } = require('../data/content');

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

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
  constructor(characterId = 'lin', options = {}) {
    this.reset(characterId, options);
  }

  // options: { playthrough: 第几周目, legacyId: 继承的遗物 id }
  reset(characterId = 'lin', options = {}) {
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
    this.ending = null;
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

    // ===== 周目继承 =====
    this.playthrough = Math.max(1, Math.floor(options.playthrough || 1));
    this.legacy = null;         // 本局继承的遗物（LEGACY_OPTIONS 里的一项）
    this.legacyId = null;
    this.legacyEnergyBonus = 0; // 遗物带来的每周额外精力
    this.hiddenCleared = [];    // 本局完成过的隐藏事件 id

    // ===== 因果记录：每一次选择，以及它后来影响了什么 =====
    this.choiceLog = [];
    this.choiceSeq = 0;
    this.totalHiddenQuests = Object.keys(HIDDEN_EVENTS).reduce((sum, scene) => sum + HIDDEN_EVENTS[scene].length, 0);

    if (options.legacyId) this.applyLegacy(options.legacyId);
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
      consequences: entry.consequences || []
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
    if (this.energy < 20) this.stats.mood = clamp(this.stats.mood - 2);

    this.visited[key] = (this.visited[key] || 0) + 1;
    if (!this.completed.includes(key)) this.completed.push(key);
    this.log.unshift(`${this.semesterName} · 第${this.week}周 · ${quest.title}`);
    if (hidden && !this.hiddenCleared.includes(quest.id)) this.hiddenCleared.push(quest.id);

    // 把这次选择写进因果记录，后面再有后果发作就能挂回这一条
    const record = this.pushLog({
      type: hidden ? 'hidden' : 'quest',
      scene: sceneId, sceneName: scene.name, title: quest.title, speaker: scene.speaker,
      choice: choice.text, effects: applied, tags: effectTags(applied),
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
    return { reply: choice.reply, applied, repeat, examReady: this.examReady, chained, fired, request, logId: record.id, hidden: hidden ? quest : null };
  }

  startExam() {
    if (!this.examReady) return null;
    this.currentExam = getExamQuestions(this.semester);
    this.examAnswers = [];
    return this.currentExam;
  }

  answerExam(index) {
    const questions = this.currentExam;
    if (!questions || this.examAnswers.length >= questions.length || index < 0 || index > 3) return false;
    this.examAnswers.push(index);
    return true;
  }

  // 返回 { semesterResult } 进入下一学期，或 { ending } 大四毕业结算
  finishExam() {
    const questions = this.currentExam;
    if (!questions || this.examAnswers.length !== questions.length) return null;
    const correct = this.examAnswers.reduce((sum, a, i) => sum + (a === questions[i].answer ? 1 : 0), 0);
    const score = Math.round(clamp(correct * 10 + this.stats.knowledge * 0.35 + this.stats.practice * 0.15));
    this.examScores.push(score);
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
      return { ending: this.ending };
    }

    const result = { semester: this.semester, semesterName: semesterLabel(this.semester), score, correct };
    this.semester += 1;
    this.week = 1;
    this.currentExam = null;
    this.examAnswers = [];
    this.energy = clamp(this.energy + 40); // 假期恢复
    this.log.unshift(`第 ${result.semester} 学期结束，成绩 ${score} 分。`);
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
      // 存档继承字段：周目数、继承的遗物、已完成的隐藏事件，以及整份因果记录
      playthrough: this.playthrough, legacyId: this.legacyId,
      legacyEnergyBonus: this.legacyEnergyBonus, hiddenCleared: this.hiddenCleared,
      choiceLog: this.choiceLog.slice(-120), choiceSeq: this.choiceSeq
    };
  }
}

module.exports = { GameCore, clamp, EFFECT_LABELS, effectLabel, effectTags };
