const { STAT_META, EVENTS, semesterLabel } = require('../../data/content');
const { GameCore } = require('../../engine/core');
const { CampusRenderer, drawSceneArt } = require('../../engine/renderer');
const { CampusWorld } = require('../../engine/world');

Page({
  data: { modal: '', nearby: null, joyX: 0, joyY: 0, examReady: false, sceneProgress: [] },

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
      examReady: this.core.examReady
    });
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
    this.setData({ modal: 'reply', reply: result.reply, effects });
  },

  closeReply() { this.core.examReady ? this.showExamIntro() : this.setData({ modal: '' }); },

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
