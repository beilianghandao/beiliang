const { STAT_META, EVENTS, NPCS, REQUESTS, CHAIN_EVENTS, semesterLabel } = require('../../data/content');
const { GameCore } = require('../../engine/core');
const { CampusRenderer, drawSceneArt } = require('../../engine/renderer');
const { CampusWorld } = require('../../engine/world');

// 场景 -> 那个场景的主角
const npcByEvent = {};
NPCS.forEach(n => { npcByEvent[n.event] = n; });

Page({
  data: {
    modal: '', nearby: null, joyX: 0, joyY: 0, examReady: false, sceneProgress: [],
    eventBadge: 0, toastVisible: false, toastTitle: '', toastDetail: '',
    request: null, requestChoices: [], requestSpeaker: '', requestRole: '', requestAffinity: '', requestInitial: '',
    chain: null, chainChoices: [], chainInitial: '', eventChains: [], eventRequests: [], eventTriggers: [],
    replyTitle: '', replyKicker: '', replyAffinity: '', replyAffinityClass: ''
  },

  onLoad() {
    this.core = new GameCore(getApp().globalData.characterId);
    this.world = new CampusWorld();
    this.syncData();
    this.setData({ character: this.core.character, characterInitial: this.core.character.name.charAt(0), maxWeeks: this.core.weeksPerSemester });
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
      eventBadge: this.core.pendingChainEvents().length + this.core.pendingRequests().length
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
    const quest = EVENTS[this.sceneId].quests[index];
    const key = `${this.sceneId}:${index}`;
    this.questIndex = index;
    this.setData({
      modal: 'quest', quest, questDone: this.core.completed.includes(key),
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
    const quest = EVENTS[this.sceneId].quests[this.questIndex];
    this.setData({ modal: 'reply', reply: result.reply, effects, replyTitle: quest.title, replyKicker: '故事已收入图鉴', replyAffinity: '' });
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
        if (outcome && outcome.ending) this.setData({ modal: 'ending', ending: outcome.ending });
        else if (outcome && outcome.semesterResult) this.setData({ modal: 'semester', semesterResult: outcome.semesterResult, nextSemesterName: outcome.nextSemesterName });
      } else {
        const examIndex = this.core.examAnswers.length;
        this.setData({ examIndex, currentQuestion: this.core.currentExam[examIndex] });
      }
    }, 180);
  },
  nextSemester() { this.setData({ modal: '' }); },

  restart() { wx.setStorageSync('campus-progress', null); wx.navigateBack({ delta: 1 }); }
});
