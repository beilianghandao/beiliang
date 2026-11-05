const { CHARACTERS, EVENTS, ENDINGS, getExamQuestions, semesterLabel } = require('../data/content');

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
    this.week = 1;              // 每学期 4 周
    this.weeksPerSemester = 4;
    this.maxSemesters = 8;
    this.completed = [];        // 任务 key: "scene:questIndex"
    this.visited = {};
    this.examAnswers = [];
    this.currentExam = null;
    this.examScores = [];       // 每学期成绩
    this.ending = null;
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
    return { reply: choice.reply, applied, repeat, examReady: this.examReady };
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
      visited: this.visited, examScores: this.examScores, log: this.log.slice(0, 40)
    };
  }
}

module.exports = { GameCore, clamp };
