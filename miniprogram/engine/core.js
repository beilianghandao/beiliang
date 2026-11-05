const { CHARACTERS, EVENTS, ENDINGS, ENDING_RULES, getExamQuestions, semesterLabel } = require('../data/content');
const { evaluateAchievements, achievementById } = require('../data/achievements');

// 期末考单题限时（毫秒）：考试卡倒计时与超时判错共用
const EXAM_QUESTION_MS = 30000;

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

class GameCore {
  constructor(characterId = 'lin') {
    this.reset(characterId);
  }

  reset(characterId = 'lin') {
    this.character = CHARACTERS.find(item => item.id === characterId) || CHARACTERS[0];
    this.stats = { ...this.character.stats };
    this.energy = 82;
    this.semester = 1;          // 1..8，覆盖大学四年
    this.week = 1;              // 每学期 8 周
    this.weeksPerSemester = 8;
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
    this.ending = null;
    this.achievements = [];         // 已解锁成就 id（按解锁顺序）
    this.achievementLog = [];       // 解锁记录 { id, semester, week }
    this.pendingAchievements = [];  // 待 UI 弹出全屏飘条的成就 id 队列
    this.log = [`与${this.character.name}一起，在青梧大学开始四年的旅程。`];
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

  // 剧情过程轮次：只应用轻量成长，不推进周数、不标记任务完成。
  applyDialogueChoice(sceneId, questIndex, roundIndex, choiceIndex) {
    if (this.examReady || this.ending) return null;
    const scene = EVENTS[sceneId];
    const quest = scene && scene.quests[questIndex];
    const round = quest && quest.rounds && quest.rounds[roundIndex];
    const choice = round && round.choices[choiceIndex];
    if (!choice) return null;

    const key = `${sceneId}:${questIndex}`;
    const repeat = this.completed.includes(key);
    const factor = repeat ? 0.5 : 1;
    const applied = {};
    Object.keys(choice.effects).forEach(k => {
      let value = choice.effects[k];
      value = Math.round(value * factor);
      applied[k] = value;
      if (k === 'energy') this.energy = clamp(this.energy + value);
      else this.stats[k] = clamp(this.stats[k] + value);
    });
    this.checkAchievements();
    return { reply: choice.reply, applied, repeat, roundIndex, roundsLength: quest.rounds.length };
  }

  applyChoice(sceneId, questIndex, choiceIndex) {
    if (this.examReady || this.ending) return null;
    const scene = EVENTS[sceneId];
    const quest = scene && scene.quests[questIndex];
    const choice = quest && quest.choices[choiceIndex];
    if (!choice) return null;

    const key = `${sceneId}:${questIndex}`;
    const repeat = (this.visited[key] || 0) > 0;
    const factor = repeat ? 0.4 : 1;
    const applied = {};
    Object.keys(choice.effects).forEach(k => {
      let value = choice.effects[k];
      if (k !== 'energy') value = Math.max(1, Math.round(value * factor));
      if (k === 'knowledge' && this.character.id === 'chen' && value > 0 && ['library', 'classroom', 'lab'].includes(sceneId)) value += 2;
      if (k === 'social' && this.character.id === 'lin' && value > 0) value += 1;
      applied[k] = value;
      if (k === 'energy') this.energy = clamp(this.energy + value);
      else this.stats[k] = clamp(this.stats[k] + value);
    });
    if (this.character.id === 'su' && !this.visited[key]) this.stats.mood = clamp(this.stats.mood + 2);
    if (this.energy < 20) this.stats.mood = clamp(this.stats.mood - 2);

    this.visited[key] = (this.visited[key] || 0) + 1;
    if (!this.completed.includes(key)) this.completed.push(key);
    this.log.unshift(`${this.semesterName} · 第${this.week}周 · ${quest.title}`);
    this.week += 1;
    this.energy = clamp(this.energy + 10 + (this.character.id === 'jiang' ? 8 : 0));
    this.checkAchievements();
    return { reply: choice.reply, applied, repeat, examReady: this.examReady };
  }

  // ---- 成就系统 ----

  // 供成就判定使用的只读快照（纯数据，便于单测）
  achievementSnapshot() {
    const scenes = new Set(this.completed.map(key => key.split(':')[0]));
    const statKeys = ['knowledge', 'fitness', 'mood', 'social', 'practice'];
    return {
      characterId: this.character.id,
      stats: { ...this.stats },
      energy: this.energy,
      completedCount: this.completed.length,
      totalStories: Object.values(EVENTS).reduce((sum, scene) => sum + scene.quests.length, 0),
      visitedScenes: scenes.size,
      totalScenes: Object.keys(EVENTS).length,
      semestersFinished: this.ending ? this.maxSemesters : this.semester - 1,
      examScores: [...this.examScores],
      bestExamScore: this.bestExamScore,
      perfectExams: this.perfectExams,
      calmExams: this.calmExams,
      graduated: !!this.ending,
      endingId: this.ending ? this.ending.id : null,
      statKeys
    };
  }

  // 评估并解锁新成就，返回本次新解锁的完整成就对象列表
  checkAchievements() {
    const snapshot = this.achievementSnapshot();
    const fresh = evaluateAchievements(snapshot, this.achievements);
    fresh.forEach(item => {
      this.achievements.push(item.id);
      this.achievementLog.push({ id: item.id, semester: this.semester, week: this.week });
      this.pendingAchievements.push(item.id);
    });
    return fresh;
  }

  // UI 取走一条待弹出成就（全屏飘条队列）
  consumePendingAchievement() {
    const id = this.pendingAchievements.shift();
    return id ? achievementById(id) : null;
  }

  // ---- 期末考倒计时（超时按错处理） ----

  // 推进倒计时；返回 { remaining, running, timedOut }。now 可注入便于测试。
  tickExam(now = Date.now()) {
    const timer = this.examTimer;
    if (!timer) return { remaining: 0, running: false, timedOut: false };
    // 暂停或未开考：保持当前剩余时间不变
    if (!timer.running || !this.currentExam) return { remaining: timer.remaining, running: timer.running, timedOut: false };
    const delta = Math.max(0, now - timer.lastAt);
    timer.lastAt = now;
    timer.remaining = Math.max(0, timer.remaining - delta);
    return { remaining: timer.remaining, running: true, timedOut: timer.remaining <= 0 };
  }

  // 切后台/失焦时暂停计时
  pauseExam(now = Date.now()) {
    if (this.examTimer && this.examTimer.running) { this.tickExam(now); this.examTimer.running = false; }
  }

  // 回到前台时恢复计时
  resumeExam(now = Date.now()) {
    if (this.examTimer && !this.examTimer.running) { this.examTimer.running = true; this.examTimer.lastAt = now; }
  }

  // 超时判错：记 -1 并立即进入下一题
  timeoutExamQuestion() {
    const questions = this.currentExam;
    if (!questions || this.examAnswers.length >= questions.length) return null;
    this.examAnswers.push(-1);
    this.examTimeouts += 1;
    this.resetExamTimer();
    return { timedOut: true, finished: this.examAnswers.length >= questions.length };
  }

  resetExamTimer() {
    this.examTimer = { remaining: EXAM_QUESTION_MS, running: true, lastAt: Date.now() };
  }

  startExam() {
    if (!this.examReady) return null;
    this.currentExam = getExamQuestions(this.semester);
    this.examAnswers = [];
    this.examTimeouts = 0;
    this.resetExamTimer();
    return this.currentExam;
  }

  answerExam(index, now = Date.now()) {
    const questions = this.currentExam;
    if (!questions || this.examAnswers.length >= questions.length || index < 0 || index > 3) return null;
    // 倒计时已耗尽时点击：按超时判错处理
    if (this.examTimer && this.tickExam(now).timedOut) return this.timeoutExamQuestion();
    this.examAnswers.push(index);
    this.resetExamTimer();
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
    this.examTimer = null;

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
    this.log.unshift(`第 ${result.semester} 学期结束，成绩 ${score} 分。`);
    this.checkAchievements();
    return { semesterResult: result, nextSemester: this.semester, nextSemesterName: semesterLabel(this.semester) };
  }

  pickEnding(avgExam) {
    const s = this.stats;
    const statKeys = ['knowledge', 'fitness', 'mood', 'social', 'practice'];
    const ordinary = ENDINGS.find(e => e.id === 'ordinary');

    // 特殊结局优先：成绩低谷、身心修复、全属性卓越与均衡发展。
    if (avgExam < 50) return ENDINGS.find(e => e.id === 'secondChance');
    if (s.mood < 30 && s.fitness < 40) return ENDINGS.find(e => e.id === 'rest');
    if (statKeys.every(key => s[key] >= 88)) return ENDINGS.find(e => e.id === 'renaissance');

    const high = statKeys.filter(key => s[key] >= 75);
    if (high.length === 0) {
      if (statKeys.every(key => s[key] >= 60) && avgExam >= 80) return ENDINGS.find(e => e.id === 'balanced');
      if (statKeys.every(key => s[key] >= 50)) return ENDINGS.find(e => e.id === 'steady');
      return ordinary;
    }

    // 五项全高光但未达到卓越线时，取数值最高的四项；同分按固定属性顺序。
    const selected = high.length > 4
      ? [...statKeys].sort((a, b) => s[b] - s[a]).slice(0, 4)
      : high;
    const key = statKeys.filter(stat => selected.includes(stat)).join('-');
    const group = selected.length === 1 ? 'single' : selected.length === 2 ? 'pair' : selected.length === 3 ? 'triple' : 'quad';
    const endingId = ENDING_RULES[group][key];
    return ENDINGS.find(e => e.id === endingId) || ordinary;
  }

  serialize() {
    return {
      characterId: this.character.id, stats: this.stats, energy: this.energy,
      semester: this.semester, week: this.week, completed: this.completed,
      visited: this.visited, examScores: this.examScores, log: this.log.slice(0, 40),
      achievements: this.achievements, achievementLog: this.achievementLog,
      bestExamScore: this.bestExamScore, perfectExams: this.perfectExams, calmExams: this.calmExams
    };
  }
}

module.exports = { GameCore, clamp, EXAM_QUESTION_MS };
