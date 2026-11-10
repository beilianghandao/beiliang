const { STAT_META, EVENTS, NPCS, REQUESTS, CHAIN_EVENTS, semesterLabel } = require('../../data/content');
const { GameCore } = require('../../engine/core');
const Save = require('../../engine/save');
const { CampusRenderer, drawSceneArt } = require('../../engine/renderer');
const { CampusWorld } = require('../../engine/world');

// 场景 -> 那个场景的主角
const npcByEvent = {};
NPCS.forEach(n => { npcByEvent[n.event] = n; });

// 因果面板的分类标签
const CAUSE_TYPES = { all: '全部', quest: '任务', request: '关系', chain: '后果', hidden: '隐藏', exam: '学业', legacy: '继承' };
const CAUSE_EMPTY = { quest: '这一段还没有可选的任务。', hidden: '还没有解锁隐藏事件。', request: '还没有人向你开口。', chain: '还没有滚出后果。', exam: '还没有考过试。', legacy: '这一局没有继承任何东西。', all: '还没有做过任何选择。' };

Page({
  data: {
    modal: '', nearby: null, joyX: 0, joyY: 0, examReady: false, sceneProgress: [],
    eventBadge: 0, causeCount: 0, legacyInfo: '', hiddenText: '',
    causeFilter: 'all', cause: null,
    toastVisible: false, toastTitle: '', toastDetail: '',
    request: null, requestChoices: [], requestSpeaker: '', requestRole: '', requestAffinity: '', requestInitial: '',
    chain: null, chainChoices: [], chainInitial: '', eventChains: [], eventRequests: [], eventTriggers: [],
    replyTitle: '', replyKicker: '', replyAffinity: '', replyAffinityClass: '', replyConsequence: '',
    endingLegacy: ''
  },

  onLoad() {
    const app = getApp();
    this.core = new GameCore(app.globalData.characterId, {
      playthrough: app.globalData.playthrough || 1,
      legacyId: app.globalData.legacyId || null
    });
    this.world = new CampusWorld();
    this.syncData();
    this.setData({
      character: this.core.character, characterInitial: this.core.character.name.charAt(0),
      maxWeeks: this.core.weeksPerSemester,
      legacyInfo: this.core.legacy ? `第 ${this.core.playthrough} 周目 · 继承「${this.core.legacy.name}」${this.core.legacy.effectText}` : ''
    });
    if (this.core.legacy) {
      setTimeout(() => this.showToast(`第 ${this.core.playthrough} 周目 · 继承了「${this.core.legacy.name}」`, this.core.legacy.effectText), 600);
    }
  },

  onReady() {
    const query = wx.createSelectorQuery();
    query.select('#campus').fields({ node: true, size: true }).exec(res => {
      if (!res[0]) return;
      const { node: canvas, width, height } = res[0];
      this.canvas = canvas;
      this.width = width; this.height = height;
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
      canvas.width = width * dpr; canvas.height = height * dpr;
      const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
      this.renderer = new CampusRenderer(ctx, width, height);
      this.lastTime = Date.now();
      this.loop();
    });
  },

  onUnload() { this.stopped = true; },
  onHide() { this.world && this.world.setInput(0, 0); },

  loop() {
    if (this.stopped || !this.renderer) return;
    const now = Date.now();
    const delta = now - this.lastTime; this.lastTime = now;
    if (!this.data.modal) {
      const nearby = this.world.update(delta);
      const oldId = this.data.nearby && this.data.nearby.id;
      const newId = nearby && nearby.id;
      if (oldId !== newId) this.setData({ nearby });
    } else this.world.player.moving = false;
    this.renderer.nearby = this.world.nearby;
    this.renderer.npcPositions = this.world.visitorPositions();
    this.renderer.requestNpcs = this.requestNpcMap();
    this.renderer.render(this.world.player, this.core.character, now);
    if (this.canvas.requestAnimationFrame) this.canvas.requestAnimationFrame(() => this.loop());
    else setTimeout(() => this.loop(), 16);
  },

  syncData() {
    const statsArray = Object.keys(STAT_META).map(key => ({ key, ...STAT_META[key], value: this.core.stats[key] }));
    this.setData({
      statsArray, energy: this.core.energy, week: this.core.week, semester: this.core.semester,
      semesterName: this.core.semesterName, weekLabel: Math.min(this.core.week, this.core.weeksPerSemester),
      completed: this.core.completed, progress: this.core.totalProgress,
      examReady: this.core.examReady,
      eventBadge: this.core.pendingChainEvents().length + this.core.pendingRequests().length,
      causeCount: this.core.choiceLog.length,
      hiddenText: `隐藏事件 ${this.core.hiddenCleared.length} / ${this.core.totalHiddenQuests}`
    });
  },

  // 哪些 NPC 带着请求找上门（给渲染器画感叹号）
  requestNpcMap() {
    const map = {};
    this.core.pendingRequests().forEach(request => { map[request.npc] = true; });
    return map;
  },

  // 属性变化的胶囊标签
  effectList(applied) {
    return Object.keys(applied || {}).map(key => ({
      key, name: key === 'energy' ? '精力' : STAT_META[key].name, value: applied[key]
    }));
  },

  effectHint(effects) {
    return Object.keys(effects || {}).map(key => `${key === 'energy' ? '精力' : STAT_META[key].name} ${effects[key] >= 0 ? '+' : ''}${effects[key]}`).join(' · ');
  },

  showToast(title, detail) {
    this.setData({ toastVisible: true, toastTitle: title, toastDetail: detail || '' });
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.setData({ toastVisible: false }), 4200);
  },

  // 全屏场景插画绘制（弹窗打开后调用）
  drawSceneArt() {
    if (!this.data.scene || !this.data.scene.art) return;
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    wx.createSelectorQuery().select('#scene-full-art').fields({ node: true }).exec(res => {
      if (!res[0]) return;
      const node = res[0].node;
      const width = info.windowWidth, height = info.windowHeight;
      const dpr = info.pixelRatio || 1;
      node.width = width * dpr; node.height = height * dpr;
      const ctx = node.getContext('2d');
      const render = time => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawSceneArt(ctx, width, height, this.data.scene.art, time);
      };
      render(Date.now());
      if (node.requestAnimationFrame) {
        const frame = () => {
          if (this.data.modal !== 'scene' && this.data.modal !== 'quest' && this.data.modal !== 'reply'
            && this.data.modal !== 'request' && this.data.modal !== 'chain') return;
          render(Date.now());
          node.requestAnimationFrame(frame);
        };
        node.requestAnimationFrame(frame);
      }
    });
  },

  mapTouch(event) {
    if (this.data.modal || !this.renderer) return;
    const touch = event.touches[0];
    const point = this.renderer.screenToWorld(touch.x, touch.y);
    this.world.setTarget(point.x, point.y);
  },

  joyStart(event) { this.joyTouch = event.touches[0].identifier; this.joyMove(event); },
  joyMove(event) {
    if (this.data.modal) return;
    const touch = Array.from(event.touches).find(item => item.identifier === this.joyTouch) || event.touches[0];
    if (!this.joyCenter) {
      wx.createSelectorQuery().select('.joystick').boundingClientRect(rect => { this.joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; }).exec();
      return;
    }
    let dx = touch.clientX - this.joyCenter.x; let dy = touch.clientY - this.joyCenter.y;
    const distance = Math.hypot(dx, dy); const max = 34;
    if (distance > max) { dx = dx / distance * max; dy = dy / distance * max; }
    this.world.setInput(dx / max, dy / max);
    this.setData({ joyX: dx, joyY: dy });
  },
  joyEnd() { this.world.setInput(0, 0); this.joyTouch = null; this.setData({ joyX: 0, joyY: 0 }); },

  interact() {
    if (this.data.modal) return;
    const nearby = this.world.nearby;
    if (!nearby) { wx.showToast({ title: '走近建筑或同学再试试吧', icon: 'none' }); return; }
    if (this.core.examReady) { this.showExamIntro(); return; }
    // 找上门的 NPC 有话要说，直接进请求
    if (nearby.type === 'npc') {
      const request = this.core.pendingRequestFor(nearby.id);
      if (request) { this.showRequest(request); return; }
    }
    this.showScene(nearby.event);
  },

  showScene(sceneId) {
    const scene = EVENTS[sceneId];
    if (!scene) return;
    this.world.setInput(0, 0);
    this.sceneId = sceneId;
    const npc = npcByEvent[sceneId];
    const request = npc ? this.core.pendingRequestFor(npc.id) : null;
    this.setData({
      modal: 'scene', scene, sceneId,
      sceneProgress: this.core.sceneProgress(sceneId),
      request: request ? { ...request, npcName: npc.name } : null,
      affinityText: npc ? `好感 ${this.core.affinityOf(npc.id)} · ${this.core.affinityTierOf(npc.id).name}` : '',
      storyNumber: String(this.core.completed.length + 1).padStart(2, '0')
    });
    setTimeout(() => this.drawSceneArt(), 80);
  },

  // NPC 带着请求找上门：答应还是拒绝
  showRequest(request) {
    const npc = NPCS.find(n => n.id === request.npc);
    if (!npc) return;
    this.world.setInput(0, 0);
    this.activeRequest = request;
    const scene = EVENTS[npc.event];
    this.setData({
      modal: 'request', requestScene: scene, request,
      requestSpeaker: npc.name, requestRole: scene.role, requestInitial: npc.name.charAt(0),
      requestAffinity: `好感 ${this.core.affinityOf(npc.id)} · ${this.core.affinityTierOf(npc.id).name}`,
      requestChoices: request.choices.map(choice => ({
        text: choice.text,
        hint: `${this.effectHint(choice.effects)} · 好感 ${choice.affinity >= 0 ? '+' : ''}${choice.affinity}`
      }))
    });
    setTimeout(() => this.drawSceneArt(), 80);
  },

  chooseRequest(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.activeRequest) return;
    const outcome = this.core.resolveRequest(this.activeRequest.id, index);
    if (!outcome) return;
    this.world.dismissNpc(outcome.npc);
    wx.setStorageSync('campus-progress', this.core.serialize());
    this.syncData();
    const npc = NPCS.find(n => n.id === outcome.npc);
    this.setData({
      modal: 'reply', reply: outcome.reply,
      replyTitle: this.activeRequest.title,
      replyKicker: outcome.accepted ? '你答应了下来' : '你拒绝了',
      effects: this.effectList(outcome.applied),
      replyAffinity: `${npc.name} 好感 ${outcome.affinity >= 0 ? '+' : ''}${outcome.affinity}（当前 ${outcome.total} · ${outcome.tier.name}）`,
      replyAffinityClass: outcome.affinity >= 0 ? 'positive' : 'negative'
    });
  },

  // 连锁事件：之前那个小决定，滚到了眼前
  showChain(event) {
    this.world.setInput(0, 0);
    this.activeChain = event;
    const scene = EVENTS[event.scene];
    this.setData({
      modal: 'chain', chainScene: scene, chain: event, chainInitial: event.speaker.charAt(0),
      chainChoices: event.choices.map(choice => ({ text: choice.text, hint: this.effectHint(choice.effects) }))
    });
    setTimeout(() => this.drawSceneArt(), 80);
  },

  chooseChain(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.activeChain) return;
    const outcome = this.core.resolveChain(this.activeChain.id, index);
    if (!outcome) return;
    wx.setStorageSync('campus-progress', this.core.serialize());
    this.syncData();
    this.setData({
      modal: 'reply', reply: outcome.reply,
      replyTitle: outcome.event.title,
      replyKicker: '一件小事滚成了另一件事',
      effects: this.effectList(outcome.applied),
      replyAffinity: '', replyAffinityClass: ''
    });
  },

  // ============ 因果面板：翻看自己做过哪些选择、各自影响了什么 ============
  causeItem(entry) {
    return {
      id: entry.id,
      type: entry.type,
      typeLabel: CAUSE_TYPES[entry.type] || '选择',
      title: entry.title,
      at: entry.at,
      choice: entry.choice,
      effects: Object.keys(entry.effects || {}).map(key => ({
        key, name: key === 'energy' ? '精力' : STAT_META[key].name, value: entry.effects[key], positive: entry.effects[key] >= 0
      })),
      affinity: entry.affinity ? {
        text: `${entry.affinity.name} 好感 ${entry.affinity.delta >= 0 ? '+' : ''}${entry.affinity.delta} → ${entry.affinity.total}`,
        positive: entry.affinity.delta >= 0
      } : null,
      links: (entry.consequences || []).map(item => {
        const left = item.fireAt - this.core.absoluteWeek;
        return {
          text: item.fired ? `第 ${item.firedAt || item.fireAt} 周引发「${item.title}」` : left > 0 ? `${left} 周后发作「${item.title}」` : `马上到你面前「${item.title}」`,
          fired: item.fired, label: item.fired ? '已发作' : '排队中'
        };
      }),
      note: (entry.consequences || []).length ? '' : (entry.note || '')
    };
  },

  showCause() {
    this.world.setInput(0, 0);
    const report = this.core.causeReport();
    const filter = this.causeFilter || 'all';
    const entries = filter === 'all' ? report.entries : report.entries.filter(entry => entry.type === filter);
    const groups = [];
    entries.forEach(entry => {
      const label = entry.semesterName || '开学之前';
      let group = groups.find(item => item.label === label);
      if (!group) { group = { label, count: 0, items: [] }; groups.push(group); }
      group.count += 1;
      group.items.push(this.causeItem(entry));
    });
    const info = Save.summary(Save.readMeta());
    this.setData({
      modal: 'cause',
      cause: {
        total: report.total,
        summary: Object.keys(report.totals).map(key => ({
          key, name: key === 'energy' ? '精力' : STAT_META[key].name, value: report.totals[key], positive: report.totals[key] >= 0
        })),
        tabs: Object.keys(CAUSE_TYPES).map(id => ({ id, label: CAUSE_TYPES[id], count: id === 'all' ? report.total : (report.counts[id] || 0), active: filter === id })),
        groups,
        empty: groups.length ? '' : (CAUSE_EMPTY[filter] || CAUSE_EMPTY.all),
        pending: report.pending,
        legacy: report.legacy ? { name: report.legacy.name, effectText: report.legacy.effectText, color: report.legacy.color, icon: report.legacy.icon } : null,
        hiddenText: `隐藏事件 ${report.hidden.cleared.length} / ${report.hidden.total} · 本局已显形 ${report.hidden.unlocked.length} 个`,
        echo: info.playthroughs > 0 ? info.lastChoiceLog.slice(-2) : []
      }
    });
  },

  switchCauseFilter(event) {
    this.causeFilter = event.currentTarget.dataset.id;
    this.showCause();
  },

  // 右上角的「等着你的事」
  showEvents() {
    this.world.setInput(0, 0);
    const eventChains = this.core.pendingChainEvents().map(item => ({
      id: item.id, level: item.level, title: item.title, sub: `${item.speaker} · ${item.place}`
    }));
    const eventRequests = this.core.pendingRequests().map(item => {
      const npc = NPCS.find(n => n.id === item.npc);
      return { id: item.id, title: item.title, sub: `${npc ? npc.name : ''} · 好感 ${this.core.affinityOf(item.npc)}` };
    });
    const eventTriggers = this.core.scheduledTriggers().map(item => ({
      title: item.def ? item.def.title : item.eventId, inWeeks: item.inWeeks
    }));
    this.setData({ modal: 'events', eventChains, eventRequests, eventTriggers });
  },

  openChainFromList(event) {
    const chainEvent = CHAIN_EVENTS[event.currentTarget.dataset.id];
    if (chainEvent) this.showChain(chainEvent);
  },

  openRequestFromList(event) {
    const request = REQUESTS.find(item => item.id === event.currentTarget.dataset.id);
    if (request) this.showRequest(request);
  },

  chooseQuest(event) {
    const index = Number(event.currentTarget.dataset.index);
    const quest = this.core.questAt(this.sceneId, index);
    if (!quest) return;
    const key = `${this.sceneId}:${index}`;
    this.questIndex = index;
    this.setData({
      modal: 'quest', quest, questDone: this.core.completed.includes(key),
      questHidden: !!quest.requires, replyConsequence: '',
      storyNumber: String(this.core.completed.length + 1).padStart(2, '0')
    });
    setTimeout(() => this.drawSceneArt(), 80);
  },

  backToScene() { this.setData({ modal: 'scene', sceneProgress: this.core.sceneProgress(this.sceneId) }); setTimeout(() => this.drawSceneArt(), 80); },

  chooseStory(event) {
    const result = this.core.applyChoice(this.sceneId, this.questIndex, Number(event.currentTarget.dataset.index));
    if (!result) return;
    const effects = Object.keys(result.applied).map(key => ({ key, name: key === 'energy' ? '精力' : STAT_META[key].name, value: result.applied[key] }));
    wx.setStorageSync('campus-progress', this.core.serialize());
    this.syncData();
    // 有请求上门 / 有连锁事件发作，排队等这段回复关掉再提示
    if (result.request) {
      const npc = NPCS.find(n => n.id === result.request.npc);
      if (npc) this.world.sendNpc(npc.id);
      this.pendingNotice = { title: `${npc ? npc.name : '有人'} 来找你了`, detail: result.request.title };
    }
    if (result.fired && result.fired.length) {
      const names = result.fired.map(id => CHAIN_EVENTS[id] ? CHAIN_EVENTS[id].title : id).join('、');
      this.pendingNotice = { title: '事情找上门了', detail: names };
    }
    const quest = this.core.questAt(this.sceneId, this.questIndex) || { title: '' };
    const chainNote = result.chained
      ? `埋下了一个后果：${CHAIN_EVENTS[result.chained.eventId] ? CHAIN_EVENTS[result.chained.eventId].title : result.chained.eventId} 会在 ${Math.max(1, result.chained.fireAt - this.core.absoluteWeek)} 周后找上来。`
      : '';
    this.setData({
      modal: 'reply', reply: result.reply, effects,
      replyTitle: quest.title,
      replyKicker: result.hidden ? '隐藏事件 · 已收入因果' : '故事已收入图鉴',
      replyConsequence: chainNote, replyAffinity: ''
    });
  },

  closeReply() {
    this.core.examReady ? this.showExamIntro() : this.setData({ modal: '' });
    // 关掉这段回复，再把排队中的提示放出来
    if (this.pendingNotice) {
      const notice = this.pendingNotice;
      this.pendingNotice = null;
      this.showToast(notice.title, notice.detail);
    }
  },

  openGuide() { this.world.setInput(0, 0); this.setData({ modal: 'guide' }); },
  closeModal() { this.setData({ modal: '' }); },

  showExamIntro() {
    this.world.setInput(0, 0);
    this.setData({ modal: 'examIntro', examSemesterName: this.core.semesterName, isFinal: this.core.semester >= this.core.maxSemesters });
  },
  startExam() {
    const questions = this.core.startExam();
    if (!questions) return;
    this.setData({ modal: 'exam', examQuestions: questions, examIndex: 0, currentQuestion: questions[0] });
  },
  answerExam(event) {
    if (this.answering) return;
    this.answering = true;
    this.core.answerExam(Number(event.currentTarget.dataset.index));
    setTimeout(() => {
      this.answering = false;
      if (this.core.examAnswers.length >= this.core.currentExam.length) {
        const outcome = this.core.finishExam();
        this.syncData();
        if (outcome && outcome.ending) {
          this.recordRun();
          this.setData({ modal: 'ending', ending: outcome.ending });
        } else if (outcome && outcome.semesterResult) {
          this.setData({ modal: 'semester', semesterResult: outcome.semesterResult, nextSemesterName: outcome.nextSemesterName });
        }
      } else {
        const examIndex = this.core.examAnswers.length;
        this.setData({ examIndex, currentQuestion: this.core.currentExam[examIndex] });
      }
    }, 180);
  },
  nextSemester() { this.setData({ modal: '' }); },

  // 一局走完就把成绩并进存档，下一周目的继承列表靠它决定哪些能选
  recordRun() {
    if (this.runRecorded) return;
    this.runRecorded = true;
    const meta = Save.recordRun(this.core);
    const unlocked = Save.legacyOptions(meta).filter(option => option.unlocked).length;
    this.setData({
      endingLegacy: `第 ${meta.playthroughs} 周目完成 · 下一周目可继承 ${unlocked} 项 · 隐藏事件 ${(meta.hiddenEvents || []).length} / ${Save.TOTAL_HIDDEN}`
    });
  },

  restart() { wx.setStorageSync('campus-progress', null); wx.navigateBack({ delta: 1 }); }
});
