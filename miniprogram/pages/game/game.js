const { STAT_META, EVENTS, semesterLabel } = require('../../data/content');
const { ACHIEVEMENTS, HIDDEN_ACHIEVEMENTS, achievementById, buildAchievementList } = require('../../data/achievements');
const { GameCore, EXAM_QUESTION_MS } = require('../../engine/core');
const { CampusRenderer, drawSceneArt } = require('../../engine/renderer');
const { CampusWorld } = require('../../engine/world');

const TIER_META = { bronze: { label: '铜', color: '#b08d57' }, silver: { label: '银', color: '#8d9bab' }, gold: { label: '金', color: '#c49a3f' }, hidden: { label: '秘', color: '#8a6bd1' } };
const pad2 = value => String(value).padStart(2, '0');

Page({
  data: { modal: '', nearby: null, examReady: false, sceneProgress: [], dialogueRound: 0, currentRound: null, replyMode: '', achvToasts: [], achvFlash: '', achvCountBump: false, achvCount: 0, achvTotal: ACHIEVEMENTS.length, achvHiddenTotal: HIDDEN_ACHIEVEMENTS.length, achvHiddenLeft: 0, examTimerText: '00:30', examTimerWidth: 100, examHurry: false, examTimeoutFlash: false },

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

  onUnload() { this.stopped = true; this.stopExamTicker(); },
  onHide() { this.world && this.world.setInput(0, 0); this.core && this.core.pauseExam && this.core.pauseExam(); },
  onShow() { this.core && this.core.resumeExam && this.core.resumeExam(); },

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
      achvCount: this.core.achievements.length, achvTotal: ACHIEVEMENTS.length,
      perfectExams: this.core.perfectExams
    });
  },

  // ---- 成就全屏飘条（错峰弹出 + 震动 + 屏幕金光 + 计数弹跳）----
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
    // 震动反馈：隐藏成就长震动 + 重震，金重、银中、铜轻
    if (secret) {
      if (wx.vibrateLong) wx.vibrateLong({ fail: () => {} });
      setTimeout(() => { if (wx.vibrateShort) wx.vibrateShort({ type: 'heavy', fail: () => {} }); }, 380);
    } else if (wx.vibrateShort) {
      wx.vibrateShort({ type: item.tier === 'gold' ? 'heavy' : item.tier === 'silver' ? 'medium' : 'light', fail: () => {} });
    }
    // 屏幕边缘光晕：隐藏成就为全屏虹光
    this.setData({ achvFlash: `achv-flash-on tier-${secret ? 'hidden' : item.tier}` });
    setTimeout(() => this.setData({ achvFlash: '' }), secret ? 2200 : 1000);
    // HUD 计数弹跳
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

  // ---- 学期成绩柱状对比数据 ----
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
          if (this.data.modal !== 'scene' && this.data.modal !== 'quest' && this.data.modal !== 'reply') return;
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
    this.showScene(nearby.event);
  },

  showScene(sceneId) {
    const scene = EVENTS[sceneId];
    if (!scene) return;
    this.world.setInput(0, 0);
    this.sceneId = sceneId;
    this.setData({
      modal: 'scene', scene, sceneId,
      sceneProgress: this.core.sceneProgress(sceneId),
      storyNumber: String(this.core.completed.length + 1).padStart(2, '0')
    });
    setTimeout(() => this.drawSceneArt(), 80);
  },

  chooseQuest(event) {
    const index = Number(event.currentTarget.dataset.index);
    const quest = EVENTS[this.sceneId].quests[index];
    const key = `${this.sceneId}:${index}`;
    this.questIndex = index;
    this.setData({ modal: 'quest', quest, questDone: this.core.completed.includes(key), dialogueRound: 0 });
    this.renderDialogueRound();
  },

  renderDialogueRound() {
    const quest = EVENTS[this.sceneId].quests[this.questIndex];
    const rounds = quest.rounds || [{ text: quest.text, choices: quest.choices }];
    const dialogueRound = Math.min(this.data.dialogueRound, rounds.length - 1);
    this.setData({ dialogueRound, currentRound: rounds[dialogueRound], roundsLength: rounds.length });
    setTimeout(() => this.drawSceneArt(), 80);
  },

  backToScene() { this.setData({ modal: 'scene', sceneProgress: this.core.sceneProgress(this.sceneId) }); setTimeout(() => this.drawSceneArt(), 80); },

  chooseStory(event) {
    const quest = EVENTS[this.sceneId].quests[this.questIndex];
    const rounds = quest.rounds || [{ choices: quest.choices }];
    const choiceIndex = Number(event.currentTarget.dataset.index);
    const isFinal = this.data.dialogueRound >= rounds.length - 1;
    let result;
    if (isFinal) {
      result = this.core.applyChoice(this.sceneId, this.questIndex, choiceIndex);
      this.setData({ replyMode: 'final' });
    } else {
      result = this.core.applyDialogueChoice(this.sceneId, this.questIndex, this.data.dialogueRound, choiceIndex);
      this.setData({ replyMode: 'round' });
    }
    if (!result) return;
    const effects = Object.keys(result.applied).map(key => ({ key, name: key === 'energy' ? '精力' : STAT_META[key].name, value: result.applied[key] }));
    wx.setStorageSync('campus-progress', this.core.serialize());
    this.syncData();
    this.drainAchievements();
    this.setData({ modal: 'reply', reply: result.reply, effects, replyKicker: isFinal ? '五轮问答完成 · 故事已收入图鉴' : `第 ${result.roundIndex + 1} / ${result.roundsLength} 轮问答已完成` });
  },

  closeReply() {
    if (this.data.replyMode === 'round') {
      this.setData({ dialogueRound: this.data.dialogueRound + 1, replyMode: '' });
      this.renderDialogueRound();
      this.setData({ modal: 'quest' });
      return;
    }
    this.core.examReady ? this.showExamIntro() : this.setData({ modal: '' });
  },

  openGuide() { this.world.setInput(0, 0); this.setData({ modal: 'guide' }); },
  closeModal() { this.stopExamTicker(); this.setData({ modal: '' }); },

  showExamIntro() {
    this.world.setInput(0, 0);
    this.setData({ modal: 'examIntro', examSemesterName: this.core.semesterName, isFinal: this.core.semester >= this.core.maxSemesters });
  },
  startExam() {
    const questions = this.core.startExam();
    if (!questions) return;
    this.showQuestion();
  },
  showQuestion() {
    const questions = this.core.currentExam || [];
    const examIndex = this.core.examAnswers.length;
    const q = questions[examIndex]; if (!q) return;
    const t = this.core.tickExam();
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
      const t = this.core.tickExam();
      const secs = Math.max(0, Math.ceil(t.remaining / 1000));
      this.setData({
        examTimerText: `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`,
        examTimerWidth: t.remaining / EXAM_QUESTION_MS * 100, examHurry: t.remaining <= 10000
      });
      if (t.timedOut && !this.examTimeoutBusy) {
        this.examTimeoutBusy = true;
        this.setData({ examTimeoutFlash: true });
        setTimeout(() => {
          const result = this.core.timeoutExamQuestion();
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
    this.core.answerExam(Number(event.currentTarget.dataset.index));
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
    wx.setStorageSync('campus-progress', this.core.serialize());
    if (outcome && outcome.ending) {
      this.setData({ modal: 'ending', ending: outcome.ending, endingChart: this.buildChartData(outcome.ending.examScores, -1, `四年成长轨迹 · 毕业均分 ${outcome.ending.score}`) });
    } else if (outcome && outcome.semesterResult) {
      const scores = outcome.semesterResult.examScores || this.core.examScores;
      const semesterAchv = this.core.achievementLog.filter(entry => entry.semester === outcome.semesterResult.semester).map(entry => achievementById(entry.id)).filter(Boolean).map(item => ({ id: item.id, icon: item.icon, name: item.name, hidden: !!item.hidden, tierColor: item.hidden ? TIER_META.hidden.color : (TIER_META[item.tier] || TIER_META.bronze).color, tier: item.tier }));
      this.setData({ modal: 'semester', semesterResult: outcome.semesterResult, nextSemesterName: outcome.nextSemesterName, semesterChart: this.buildChartData(scores, scores.length - 1), semesterAchv });
    }
  },
  nextSemester() { this.setData({ modal: '' }); },

  restart() { wx.setStorageSync('campus-progress', null); wx.navigateBack({ delta: 1 }); }
});
