const { CHARACTERS, EVENTS, ENDINGS, getExamQuestions, semesterLabel } = require('../data/content');

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const DEFAULT_CHOICE_REACTION = Object.freeze({
  emotion: '✦',
  bubble: '这个选择被校园记住了，也许会在未来再次泛起回响。',
  tone: 'default',
  isDefault: true
});

function getChoiceReaction(choice = {}) {
  if (!choice.emotion && !choice.bubble) return { ...DEFAULT_CHOICE_REACTION };
  return {
    emotion: choice.emotion || DEFAULT_CHOICE_REACTION.emotion,
    bubble: choice.bubble || DEFAULT_CHOICE_REACTION.bubble,
    tone: choice.tone || 'custom',
    isDefault: false
  };
}

class GameCore {
  constructor(characterId = 'lin') {
    this.reset(characterId);
  }

  reset(characterId = 'lin') {
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
    this.choiceCount = 0;
    // 每条记录保留原选择、发生时间与回响状态；两次后进入抽签池，每条最多回响一次。
    this.echoList = [];
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

  drawEcho(turn = this.choiceCount + 1) {
    const candidates = this.echoList.filter(item => item.status === 'pending' && item.dueTurn <= turn);
    if (!candidates.length) return null;
    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    picked.status = 'resolved';
    picked.resolvedAt = { semester: this.semester, week: this.week, label: `${this.semesterName} · 第${this.week}周` };
    picked.text = `“${picked.choiceText}”——你曾在《${picked.questTitle}》中做出的选择，如今在${picked.resolvedAt.label}有了新的回响。`;
    this.log.unshift(`旧选择的回响 · ${picked.questTitle}`);
    return { ...picked, selectedAt: { ...picked.selectedAt }, resolvedAt: { ...picked.resolvedAt } };
  }

  rememberChoice(sceneId, quest, choiceIndex, choice, turn) {
    const entry = {
      id: `${sceneId}:${quest.id}:${choiceIndex}:${turn}`,
      sceneId,
      questId: quest.id,
      questTitle: quest.title,
      choiceIndex,
      choiceText: choice.text,
      selectedAt: { semester: this.semester, week: this.week, label: `${this.semesterName} · 第${this.week}周` },
      dueTurn: turn + 2,
      status: 'pending',
      text: ''
    };
    this.echoList.push(entry);
    return entry;
  }

  applyChoice(sceneId, questIndex, choiceIndex) {
    if (this.examReady || this.ending) return null;
    const scene = EVENTS[sceneId];
    const quest = scene && scene.quests[questIndex];
    const choice = quest && quest.choices[choiceIndex];
    if (!choice) return null;

    const turn = this.choiceCount + 1;
    const echo = this.drawEcho(turn);
    const reaction = getChoiceReaction(choice);
    this.rememberChoice(sceneId, quest, choiceIndex, choice, turn);
    this.choiceCount = turn;

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
    return { reply: choice.reply, applied, repeat, examReady: this.examReady, reaction, echo };
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
      choiceCount: this.choiceCount,
      echoList: this.echoList.map(item => ({ ...item, selectedAt: { ...item.selectedAt }, resolvedAt: item.resolvedAt ? { ...item.resolvedAt } : null }))
    };
  }
}

module.exports = { GameCore, clamp, DEFAULT_CHOICE_REACTION, getChoiceReaction };

