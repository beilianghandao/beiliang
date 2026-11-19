const { STAT_META, EVENTS, NPCS, REQUESTS, CHAIN_EVENTS, semesterLabel, statName } = require('../../data/content');
const { GameCore, EXAM_QUESTION_MS } = require('../../engine/core');
const { buildChoiceLogView } = require('../../engine/choicelog');
const Save = require('../../engine/save');
const { CampusRenderer, drawSceneArt } = require('../../engine/renderer');
const { CampusWorld } = require('../../engine/world');
const { ACHIEVEMENTS, HIDDEN_ACHIEVEMENTS, achievementById, buildAchievementList } = require('../../data/achievements');

// 场景 -> 那个场景的主角
const npcByEvent = {};
NPCS.forEach(n => { npcByEvent[n.event] = n; });

// 因果面板的分类标签
const CAUSE_TYPES = { all: '全部', quest: '任务', request: '关系', chain: '后果', hidden: '隐藏', exam: '学业', legacy: '继承' };
const CAUSE_EMPTY = { quest: '这一段还没有可选的任务。', hidden: '还没有解锁隐藏事件。', request: '还没有人向你开口。', chain: '还没有滚出后果。', exam: '还没有考过试。', legacy: '这一局没有继承任何东西。', all: '还没有做过任何选择。' };

// 成就等级元信息（图鉴与飘条共用）
const TIER_META = { bronze: { label: '铜', color: '#b08d57' }, silver: { label: '银', color: '#8d9bab' }, gold: { label: '金', color: '#c49a3f' }, hidden: { label: '秘', color: '#8a6bd1' } };
const pad2 = value => String(value).padStart(2, '0');

Page({
  data: {
    modal: '', nearby: null, joyX: 0, joyY: 0, examReady: false, sceneProgress: [], logEntries: [], seedCode: '',
    eventBadge: 0, causeCount: 0, legacyInfo: '', hiddenText: '',
    causeFilter: 'all', cause: null,
    toastVisible: false, toastTitle: '', toastDetail: '',
    request: null, requestChoices: [], requestSpeaker: '', requestRole: '', requestAffinity: '', requestInitial: '',
    chain: null, chainChoices: [], chainInitial: '', eventChains: [], eventRequests: [], eventTriggers: [],
    replyTitle: '', replyKicker: '', replyAffinity: '', replyAffinityClass: '', replyConsequence: '',
    questText: '', questChoices: [], questRound: 1, questRounds: 1, questFinal: true, nextReply: false,
    endingLegacy: '',
    achvToasts: [], achvFlash: '', achvCountBump: false, achvCount: 0, achvTotal: ACHIEVEMENTS.length,
    achvHiddenTotal: HIDDEN_ACHIEVEMENTS.length, achvHiddenLeft: 0, achvList: [], achvUnlocked: 0,
    examTimerText: '00:30', examTimerWidth: 100, examHurry: false, examTimeoutFlash: false
  },

  onLoad() {
    const app = getApp();
    try {
      this.core = new GameCore(app.globalData.characterId, {
        seedCode: app.globalData.seedCode,
        playthrough: app.globalData.playthrough || 1,
        legacyId: app.globalData.legacyId || null
      });
    } catch (error) {
      // 种子码不合法：说清楚原因并退回选角页，不让页面白屏
      this.broken = true;
      wx.showModal({ title: '种子码不合法', content: error.message, showCancel: false, success: () => wx.navigateBack({ delta: 1 }) });
      return;
    }
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
    if (this.broken) return;
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

  onUnload() { this.stopped = true; this.stopExamTicker && this.stopExamTicker(); },
  onHide() { this.world && this.world.setInput(0, 0); this.core && this.core.pauseExam && this.core.pauseExam(Date.now()); },
  onShow() { this.core && this.core.resumeExam && this.core.resumeExam(Date.now()); },

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
      examReady: this.core.examReady, seedCode: this.core.seedCode,
      eventBadge: this.core.pendingChainEvents().length + this.core.pendingRequests().length,
      causeCount: this.core.choiceLog.length,
      hiddenText: `隐藏事件 ${this.core.hiddenCleared.length} / ${this.core.totalHiddenQuests}`,
      achvCount: this.core.achievements.length, achvTotal: ACHIEVEMENTS.length
    });
  },

  // 把待弹出的成就逐条错峰喂给全屏飘条
  drainAchievements() {
    let index = 0;
    let item;
    while ((item = this.core.consumePendingAchievement())) {
      const captured = item;
      setTimeout(() => this.showAchvToast(captured), index * 340);
      index++;
    }
  },

  showAchvToast(item) {
    const secret = !!item.hidden;
    const tier = secret ? TIER_META.hidden : (TIER_META[item.tier] || TIER_META.bronze);
    const toast = { id: item.id, icon: item.icon, name: item.name, desc: item.desc, tier: item.tier, hidden: secret, gold: item.tier === 'gold', tierLabel: secret ? '隐藏' : tier.label, tierColor: tier.color };
    this.setData({ achvToasts: this.data.achvToasts.concat(toast) });
    if (secret) {
      if (wx.vibrateLong) wx.vibrateLong({ fail: () => {} });
      setTimeout(() => { if (wx.vibrateShort) wx.vibrateShort({ type: 'heavy', fail: () => {} }); }, 380);
    } else if (wx.vibrateShort) {
      wx.vibrateShort({ type: item.tier === 'gold' ? 'heavy' : item.tier === 'silver' ? 'medium' : 'light', fail: () => {} });
    }
    this.setData({ achvFlash: `achv-flash-on tier-${secret ? 'hidden' : item.tier}` });
    setTimeout(() => this.setData({ achvFlash: '' }), secret ? 2200 : 1000);
    this.setData({ achvCount: this.core.achievements.length, achvCountBump: false });
    setTimeout(() => this.setData({ achvCountBump: true }), 30);
    const id = item.id;
    setTimeout(() => this.setData({ achvToasts: this.data.achvToasts.filter(t => t.id !== id) }), secret ? 5400 : 3400);
  },

  openAchievements() {
    const list = buildAchievementList(this.core.achievementSnapshot(), this.core.achievements).map(item => {
      const tierLabel = item.masked ? '？' : item.hidden ? '秘' : (TIER_META[item.tier] || TIER_META.bronze).label;
      return {
        ...item, tierLabel,
        metaText: item.masked ? '隐藏成就' : `${item.catName} · ${tierLabel}级`,
        progress: Math.min(100, Math.round(item.current / item.target * 100))
      };
    });
    this.setData({ modal: 'achv', achvList: list, achvUnlocked: list.filter(i => i.unlocked).length, achvHiddenLeft: list.filter(i => i.masked).length });
  },

  // 学期成绩柱状对比数据
  buildChartData(scores, highlightIndex, captionOverride) {
    const bars = scores.map((score, i) => ({ value: score, height: Math.max(4, Math.round(score)), label: `S${i + 1}`, current: i === highlightIndex }));
    let caption = '未来学期，继续成长', deltaClass = '';
    if (captionOverride) caption = captionOverride;
    else if (highlightIndex > 0) {
      const delta = scores[highlightIndex] - scores[highlightIndex - 1];
      caption = delta >= 0 ? `较上学期 +${delta} 分` : `较上学期 ${delta} 分`;
      deltaClass = delta >= 0 ? 'up' : 'down';
    }
    return { bars, caption, deltaClass };
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

  /* 选项提示不显示数值：1~2 分一个箭头、3~5 两个、6+ 三个 */
  arrowOf(value) {
    const v = Number(value) || 0;
    if (!v) return '·';
    const steps = Math.abs(v) >= 6 ? 3 : Math.abs(v) >= 3 ? 2 : 1;
    return (v > 0 ? '↑' : '↓').repeat(steps);
  },
  statLabel(key) {
    return key === 'energy' ? '精力' : (STAT_META[key] ? STAT_META[key].name : key);
  },
  softHint(text) {
    return String(text || '').replace(/([\u4e00-\u9fa5]{2})\s*([+-])\s*(\d+)/g,
      (m, name, sign, num) => `${name} ${this.arrowOf(Number(sign + num))}`);
  },
  effectHint(effects) {
    return Object.keys(effects || {}).map(key => `${this.statLabel(key)} ${this.arrowOf(effects[key])}`).join(' · ');
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
    if (this.broken || this.data.modal) return;
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
        hint: `${this.effectHint(choice.effects)} · 好感 ${this.arrowOf(choice.affinity)}`
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

  /* 多轮问答：quest.rounds 由 data/expansion.js 在启动时生成，
     没有 rounds 的老任务按单轮处理。 */
  renderQuestRound() {
    const quest = this.core.questAt(this.sceneId, this.questIndex) || {};
    const rounds = quest.rounds && quest.rounds.length ? quest.rounds : null;
    const total = rounds ? rounds.length : 1;
    const idx = rounds ? Math.min(this.dialogueRound || 0, total - 1) : 0;
    const round = rounds ? rounds[idx] : quest;
    return {
      questText: round.text || '',
      questChoices: (round.choices || []).map(c => Object.assign({}, c, { hint: this.softHint(c.hint) })),
      questRound: idx + 1,
      questRounds: total,
      questFinal: idx >= total - 1
    };
  },

  nextRound() {
    this.swapAt = Date.now();
    this.dialogueRound = (this.dialogueRound || 0) + 1;
    this.setData(Object.assign({ modal: 'quest', replyConsequence: '', nextReply: false }, this.renderQuestRound()));
    setTimeout(() => this.drawSceneArt(), 80);
  },

  chooseQuest(event) {
    const index = Number(event.currentTarget.dataset.index);
    const quest = this.core.questAt(this.sceneId, index);
    if (!quest) return;
    const key = `${this.sceneId}:${index}`;
    this.questIndex = index;
    this.dialogueRound = 0;
    this.setData(Object.assign({
      modal: 'quest', quest, questDone: this.core.completed.includes(key),
      questHidden: !!quest.requires, replyConsequence: '', nextReply: false,
      storyNumber: String(this.core.completed.length + 1).padStart(2, '0')
    }, this.renderQuestRound()));
    setTimeout(() => this.drawSceneArt(), 80);
  },

  backToScene() { this.setData({ modal: 'scene', sceneProgress: this.core.sceneProgress(this.sceneId) }); setTimeout(() => this.drawSceneArt(), 80); },

  chooseStory(event) {
    this.swapAt = Date.now();
    const choiceIndex = Number(event.currentTarget.dataset.index);
    const curQuest = this.core.questAt(this.sceneId, this.questIndex) || { title: '' };
    const curRounds = curQuest.rounds && curQuest.rounds.length ? curQuest.rounds : null;
    if (curRounds && (this.dialogueRound || 0) < curRounds.length - 1) {
      const step = this.core.applyDialogueChoice(this.sceneId, this.questIndex, this.dialogueRound, choiceIndex);
      if (!step) return;
      const stepEffects = Object.keys(step.applied).map(key => ({ key, name: statName(key), value: step.applied[key] }));
      wx.setStorageSync('campus-progress', this.core.serialize());
      this.syncData();
      this.drainAchievements();
      this.setData({
        modal: 'reply', reply: step.reply || '你把这一步想清楚了。', effects: stepEffects,
        replyTitle: curQuest.title,
        replyKicker: `第 ${step.roundIndex + 1} / ${step.roundsLength} 轮问答已完成`,
        replyConsequence: '', replyAffinity: '', nextReply: true
      });
      return;
    }
    const result = this.core.applyChoice(this.sceneId, this.questIndex, choiceIndex);
    if (!result) return;
    const effects = Object.keys(result.applied).map(key => ({ key, name: statName(key), value: result.applied[key] }));
    wx.setStorageSync('campus-progress', this.core.serialize());
    this.syncData();
    this.drainAchievements();
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
      replyConsequence: chainNote, replyAffinity: '', nextReply: false
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

  // 选择日志：随时翻看做过哪些选择、影响了什么；关掉后回到打开日志前的地方
  openLog() {
    // 换面板会改高度，第二下连点很容易点到挪上来的「查看选择日志」，先挡掉
    if (this.panelLocked()) return;
    this.world.setInput(0, 0);
    this.logReturnModal = this.data.modal;
    this.setData({ modal: 'log', logEntries: buildChoiceLogView(this.core.choiceLog) });
  },
  panelLocked() { return Date.now() - (this.swapAt || 0) < 300; },

  closeLog() {
    const back = this.logReturnModal || '';
    this.logReturnModal = '';
    this.setData({ modal: back, logEntries: [] });
    if (back === 'scene' || back === 'quest' || back === 'reply') setTimeout(() => this.drawSceneArt(), 80);
  },

  showExamIntro() {
    this.world.setInput(0, 0);
    this.setData({ modal: 'examIntro', examSemesterName: this.core.semesterName, isFinal: this.core.semester >= this.core.maxSemesters });
  },
  startExam() {
    const questions = this.core.startExam(Date.now());
    if (!questions) return;
    this.showQuestion();
  },
  // 展示当前题目并启动倒计时
  showQuestion() {
    const questions = this.core.currentExam || [];
    const examIndex = this.core.examAnswers.length;
    const q = questions[examIndex]; if (!q) return;
    const t = this.core.tickExam(Date.now());
    const secs = Math.max(0, Math.ceil(t.remaining / 1000));
    this.setData({
      modal: 'exam', examQuestions: questions, examIndex, currentQuestion: q,
      examTimerText: `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`,
      examTimerWidth: t.remaining / EXAM_QUESTION_MS * 100, examHurry: t.remaining <= 10000, examTimeoutFlash: false
    });
    this.startExamTicker();
  },
  // 每 100ms 刷新倒计时；耗尽时自动按错进入下一题
  startExamTicker() {
    this.stopExamTicker();
    this.examTimeoutBusy = false;
    this.examTicker = setInterval(() => {
      if (this.data.modal !== 'exam') { this.stopExamTicker(); return; }
      const t = this.core.tickExam(Date.now());
      const secs = Math.max(0, Math.ceil(t.remaining / 1000));
      this.setData({
        examTimerText: `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`,
        examTimerWidth: t.remaining / EXAM_QUESTION_MS * 100, examHurry: t.remaining <= 10000
      });
      if (t.timedOut && !this.examTimeoutBusy) {
        this.examTimeoutBusy = true;
        this.setData({ examTimeoutFlash: true });
        setTimeout(() => {
          const result = this.core.timeoutExamQuestion(Date.now());
          this.setData({ examTimeoutFlash: false });
          if (result && result.finished) this.handleExamFinished();
          else { this.showQuestion(); this.examTimeoutBusy = false; }
        }, 700);
      }
    }, 100);
  },
  stopExamTicker() { if (this.examTicker) { clearInterval(this.examTicker); this.examTicker = null; } },
  answerExam(event) {
    if (this.answering) return;
    this.answering = true;
    this.core.answerExam(Number(event.currentTarget.dataset.index), Date.now());
    setTimeout(() => {
      this.answering = false;
      if (this.core.examAnswers.length >= this.core.currentExam.length) this.handleExamFinished();
      else this.showQuestion();
    }, 180);
  },
  handleExamFinished() {
    this.stopExamTicker();
    const outcome = this.core.finishExam();
    this.syncData();
    this.drainAchievements();
    if (outcome && outcome.ending) {
      this.recordRun();
      this.setData({ modal: 'ending', ending: outcome.ending, perfectExams: this.core.perfectExams });
    } else if (outcome && outcome.semesterResult) {
      const scores = outcome.semesterResult.examScores || this.core.examScores;
      const semesterAchv = this.core.achievementLog.filter(entry => entry.semester === outcome.semesterResult.semester).map(entry => achievementById(entry.id)).filter(Boolean).map(item => ({ id: item.id, icon: item.icon, name: item.name, hidden: !!item.hidden, tierColor: item.hidden ? TIER_META.hidden.color : (TIER_META[item.tier] || TIER_META.bronze).color, tier: item.tier }));
      this.setData({ modal: 'semester', semesterResult: outcome.semesterResult, nextSemesterName: outcome.nextSemesterName, semesterChart: this.buildChartData(scores, scores.length - 1), semesterAchv });
    }
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
