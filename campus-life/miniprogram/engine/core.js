const { CHARACTERS, EVENTS, ENDINGS, NPCS, REQUESTS, CHAIN_EVENTS, EXAM_BANK, affinityTier, getExamQuestions, semesterLabel } = require('../data/content');
const { createRng, decodeSeed, encodeSeed } = require('./random');

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

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

class GameCore {
  constructor(characterId = 'lin', seedCode) {
    this.reset(characterId, seedCode);
  }

  reset(characterId = 'lin', seedCode) {
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
    // 延迟触发队列：还没发作的连锁事件 { eventId, fireAt }
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
    this.seedCode = resolveSeedCode(seedCode);  // 本局的种子码：同码必然复现同一局
    this.seed = decodeSeed(this.seedCode);
    this.rng = createRng(this.seed);
  }

  get semesterName() { return semesterLabel(this.semester); }
  get examReady() { return this.week > this.weeksPerSemester && !this.ending; }
  get totalProgress() { return Math.round(((this.semester - 1) * this.weeksPerSemester + Math.min(this.week, this.weeksPerSemester) - 1) / (this.maxSemesters * this.weeksPerSemester) * 100); }

  getScene(sceneId) { return EVENTS[sceneId]; }

  // 该场景的任务完成状态列表
  sceneProgress(sceneId) {
    const scene = EVENTS[sceneId];
    if (!scene) return [];
    return scene.quests.map((q, i) => ({ quest: q, index: i, done: this.completed.includes(`${sceneId}:${i}`), times: this.visited[`${sceneId}:${i}`] || 0 }));
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
    this.log.unshift(`你${delta >= 0 ? '答应' : '拒绝了'}「${def.title}」，与${this.npcName(item.npc)}的好感 ${delta >= 0 ? '+' : ''}${delta}（当前 ${total}）。`);
    return { reply: choice.reply, applied, affinity: delta, total, npc: item.npc, tier: affinityTier(total), accepted: delta > 0 };
  }

  npcName(npcId) {
    const npc = NPCS.find(item => item.id === npcId);
    return npc ? npc.name : '对方';
  }

  // ============ 连锁事件与延迟触发队列 ============

  // 把一个连锁事件排进延迟队列，delay 周之后才发作
  scheduleTrigger(eventId, delay = 1) {
    const def = CHAIN_EVENTS[eventId];
    if (!def) return null;
    const entry = { eventId, fireAt: this.absoluteWeek + (delay || 1) };
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
        const def = CHAIN_EVENTS[entry.eventId];
        if (def && def.next) this.scheduleTrigger(def.next, def.nextDelay || 2);
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
    return { reply: choice.reply, applied, event: def };
  }

  // ============ 主流程 ============

  applyChoice(sceneId, questIndex, choiceIndex) {
    if (this.examReady || this.ending) return null;
    const scene = EVENTS[sceneId];
    const quest = scene && scene.quests[questIndex];
    const choice = quest && quest.choices[choiceIndex];
    if (!choice) return null;

    const key = `${sceneId}:${questIndex}`;
    const repeat = (this.visited[key] || 0) > 0;
    const factor = repeat ? 0.4 : 1;
    const npc = this.npcOfScene(sceneId);
    const applied = this.applyEffects(choice.effects, { sceneId, factor, npcId: npc ? npc.id : null });
    if (this.character.id === 'su' && !this.visited[key]) this.stats.mood = clamp(this.stats.mood + 2);
    if (this.energy < 20) this.stats.mood = clamp(this.stats.mood - 2);

    this.visited[key] = (this.visited[key] || 0) + 1;
    if (!this.completed.includes(key)) this.completed.push(key);
    this.choiceLog.push({
      semester: this.semester,
      week: this.week,
      sceneId,
      sceneName: scene.name,
      questTitle: quest.title,
      choiceText: choice.text,
      effects: { ...applied },
      repeat
    });
    this.week += 1;
    this.absoluteWeek += 1;
    this.energy = clamp(this.energy + 10 + (this.character.id === 'jiang' ? 8 : 0));

    // 这个选择可能埋下后果：排进延迟队列，几周之后才发作
    let chained = null;
    if (choice.chain && choice.chain.event) {
      chained = this.scheduleTrigger(choice.chain.event, choice.chain.delay || 1);
    }
    const fired = this.collectTriggers();
    const request = this.scheduleRequest();
    return { reply: choice.reply, applied, repeat, examReady: this.examReady, chained, fired, request };
  }

  startExam() {
    if (!this.examReady) return null;
    this.currentExam = pickExamQuestions(this.rng);
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
      choiceLog: this.choiceLog, seedCode: this.seedCode, rngState: this.rng.getState()
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
    if (state.rngState !== undefined) core.rng.setState(state.rngState);
    return core;
  }
}

module.exports = { GameCore, pickExamQuestions, clamp };
