// 成就系统：全部成就在此声明，判定函数均为纯函数（只读快照）。
// 快照字段由 engine/core.js 的 achievementSnapshot() 提供，便于单测与双端复用。

const ACHIEVEMENT_CATEGORIES = {
  story: { name: '图鉴', color: '#a3845c' },
  growth: { name: '成长', color: '#5d7ea8' },
  exam: { name: '学业', color: '#5b9272' },
  career: { name: '生涯', color: '#ae7b9f' }
};

// tier: bronze 铜 / silver 银 / gold 金
const ACHIEVEMENTS = [
  // ---- 图鉴：故事收集与场景探索 ----
  { id: 'first-story', cat: 'story', icon: '启', tier: 'bronze', name: '初次启程', desc: '完成第一段校园故事', check: s => s.completedCount >= 1, progress: s => [s.completedCount, 1] },
  { id: 'story-16', cat: 'story', icon: '书', tier: 'bronze', name: '故事收集者', desc: '完成 16 段校园故事', check: s => s.completedCount >= 16, progress: s => [s.completedCount, 16] },
  { id: 'story-32', cat: 'story', icon: '藏', tier: 'silver', name: '校园通', desc: '完成 32 段校园故事', check: s => s.completedCount >= 32, progress: s => [s.completedCount, 32] },
  { id: 'story-all', cat: 'story', icon: '鉴', tier: 'gold', name: '图鉴全收', desc: '集齐全部 64 段校园故事', check: s => s.completedCount >= s.totalStories, progress: s => [s.completedCount, s.totalStories] },
  { id: 'all-scenes', cat: 'story', icon: '迹', tier: 'silver', name: '踏遍青梧', desc: '在全部 8 个场景留下足迹', check: s => s.visitedScenes >= s.totalScenes, progress: s => [s.visitedScenes, s.totalScenes] },
  { id: 'scene-master', cat: 'story', icon: '专', tier: 'silver', name: '场景大师', desc: '把某一个场景的 8 个任务全部做完', check: s => s.sceneMaxCompleted >= s.sceneQuestTarget, progress: s => [s.sceneMaxCompleted, s.sceneQuestTarget] },
  { id: 'revisit', cat: 'story', icon: '温', tier: 'bronze', name: '重温旧事', desc: '重温一段已完成的故事', check: s => s.repeatedQuests >= 1, progress: s => [s.repeatedQuests, 1] },
  { id: 'regular', cat: 'story', icon: '熟', tier: 'silver', name: '故事常客', desc: '同一段故事体验 3 次', check: s => s.maxVisited >= 3, progress: s => [s.maxVisited, 3] },

  // ---- 成长：属性与精力 ----
  { id: 'stat-knowledge', cat: 'growth', icon: '知', tier: 'silver', name: '饱学之士', desc: '学识达到 80', check: s => s.stats.knowledge >= 80, progress: s => [s.stats.knowledge, 80] },
  { id: 'stat-fitness', cat: 'growth', icon: '体', tier: 'silver', name: '晨光跑者', desc: '体魄达到 80', check: s => s.stats.fitness >= 80, progress: s => [s.stats.fitness, 80] },
  { id: 'stat-mood', cat: 'growth', icon: '心', tier: 'silver', name: '内核稳定', desc: '心态达到 80', check: s => s.stats.mood >= 80, progress: s => [s.stats.mood, 80] },
  { id: 'stat-social', cat: 'growth', icon: '友', tier: 'silver', name: '人缘满座', desc: '人缘达到 80', check: s => s.stats.social >= 80, progress: s => [s.stats.social, 80] },
  { id: 'stat-practice', cat: 'growth', icon: '行', tier: 'silver', name: '知行合一', desc: '实践达到 80', check: s => s.stats.practice >= 80, progress: s => [s.stats.practice, 80] },
  { id: 'stat-max', cat: 'growth', icon: '峰', tier: 'gold', name: '登峰造极', desc: '任意一项属性达到满值 100', check: s => s.statKeys.some(key => s.stats[key] >= 100), progress: s => [Math.max(...s.statKeys.map(key => s.stats[key])), 100] },
  { id: 'all-round', cat: 'growth', icon: '园', tier: 'gold', name: '全面开花', desc: '五项属性全部达到 70', check: s => s.statKeys.every(key => s.stats[key] >= 70), progress: s => [s.statKeys.filter(key => s.stats[key] >= 70).length, s.statKeys.length] },
  { id: 'full-energy', cat: 'growth', icon: '满', tier: 'bronze', name: '精力管理大师', desc: '精力恢复到满值 100', check: s => s.energy >= 100, progress: s => [s.energy, 100] },
  { id: 'low-energy', cat: 'growth', icon: '燃', tier: 'bronze', name: '极限运转', desc: '精力跌到 20 以下仍坚持行动', check: s => s.energyLowReached, progress: s => [s.energyLowReached ? 1 : 0, 1] },

  // ---- 学业：考试表现 ----
  { id: 'exam-perfect', cat: 'exam', icon: '满', tier: 'silver', name: '全对答卷', desc: '一次期末考 5 题全部答对', check: s => s.perfectExams >= 1, progress: s => [s.perfectExams, 1] },
  { id: 'exam-90', cat: 'exam', icon: '优', tier: 'gold', name: '高分通过', desc: '一次期末考取得 90 分以上', check: s => s.bestExamScore >= 90, progress: s => [s.bestExamScore, 90] },
  { id: 'exam-no-timeout', cat: 'exam', icon: '速', tier: 'bronze', name: '从容应考', desc: '完成一整场期末考且没有超时题', check: s => s.calmExams >= 1, progress: s => [s.calmExams, 1] },
  { id: 'exam-rise', cat: 'exam', icon: '梯', tier: 'silver', name: '步步高', desc: '期末成绩连续 3 个学期上升', check: s => s.examScores.length >= 3 && s.examScores.slice(-3).every((score, i, arr) => i === 0 || score > arr[i - 1]), progress: s => [Math.min(s.examScores.length, 3), 3] },
  { id: 'honor-graduate', cat: 'exam', icon: '誉', tier: 'gold', name: '荣誉毕业生', desc: '以 85 分以上的四年均分毕业', check: s => s.graduated && s.avgExamScore >= 85, progress: s => [s.avgExamScore, 85] },
  { id: 'all-pass', cat: 'exam', icon: '稳', tier: 'silver', name: '稳过四年', desc: '八场期末考成绩全部不低于 60', check: s => s.graduated && s.examScores.length >= 8 && s.examScores.every(score => score >= 60), progress: s => [s.examScores.filter(score => score >= 60).length, 8] },
  { id: 'calm-graduate', cat: 'exam', icon: '定', tier: 'gold', name: '从容毕业', desc: '整个大学期间期末考从未超时', check: s => s.graduated && s.calmExams >= 8, progress: s => [s.calmExams, 8] },

  // ---- 生涯：学期里程碑与结局 ----
  { id: 'freshman-done', cat: 'career', icon: '一', tier: 'bronze', name: '大一幸存者', desc: '读完大一全年（前两学期）', check: s => s.semestersFinished >= 2, progress: s => [s.semestersFinished, 2] },
  { id: 'halfway-done', cat: 'career', icon: '半', tier: 'silver', name: '半程纪念', desc: '读完大学前四年的一半学期', check: s => s.semestersFinished >= 4, progress: s => [s.semestersFinished, 4] },
  { id: 'graduate', cat: 'career', icon: '毕', tier: 'gold', name: '顺利毕业', desc: '走完八个学期，迎来毕业结局', check: s => s.graduated, progress: s => [s.semestersFinished, 8] },
  { id: 'star-of-qingwu', cat: 'career', icon: '星', tier: 'gold', name: '青梧之星', desc: '以「五项全能的青梧之星」结局毕业', check: s => s.endingId === 'renaissance', progress: s => [s.endingId === 'renaissance' ? 1 : 0, 1] },
  { id: 'rest-ending', cat: 'career', icon: '憩', tier: 'silver', name: '学会休息的人', desc: '以「重新学会休息」结局毕业', check: s => s.endingId === 'rest', progress: s => [s.endingId === 'rest' ? 1 : 0, 1] },
  { id: 'second-chance', cat: 'career', icon: '逆', tier: 'silver', name: '逆风翻盘', desc: '以「在下一程重新出发」结局毕业', check: s => s.endingId === 'secondChance', progress: s => [s.endingId === 'secondChance' ? 1 : 0, 1] },
  { id: 'graduate-lin', cat: 'career', icon: '夏', tier: 'bronze', name: '知夏的答卷', desc: '以林知夏的身份完成毕业', check: s => s.graduated && s.characterId === 'lin', progress: s => [s.graduated && s.characterId === 'lin' ? 1 : 0, 1] },
  { id: 'graduate-chen', cat: 'career', icon: '屿', tier: 'bronze', name: '陈屿的答卷', desc: '以陈屿的身份完成毕业', check: s => s.graduated && s.characterId === 'chen', progress: s => [s.graduated && s.characterId === 'chen' ? 1 : 0, 1] },
  { id: 'graduate-su', cat: 'career', icon: '桃', tier: 'bronze', name: '苏桃的答卷', desc: '以苏桃的身份完成毕业', check: s => s.graduated && s.characterId === 'su', progress: s => [s.graduated && s.characterId === 'su' ? 1 : 0, 1] },
  { id: 'graduate-jiang', cat: 'career', icon: '野', tier: 'bronze', name: '江野的答卷', desc: '以江野的身份完成毕业', check: s => s.graduated && s.characterId === 'jiang', progress: s => [s.graduated && s.characterId === 'jiang' ? 1 : 0, 1] }
];

const ACHIEVEMENT_MAP = {};
ACHIEVEMENTS.forEach(item => { ACHIEVEMENT_MAP[item.id] = item; });

// 返回 snapshot 下「应当解锁但尚未解锁」的成就列表（保持声明顺序）
function evaluateAchievements(snapshot, unlocked) {
  const done = new Set(unlocked || []);
  return ACHIEVEMENTS.filter(item => !done.has(item.id) && item.check(snapshot));
}

function achievementById(id) { return ACHIEVEMENT_MAP[id] || null; }

// 生成成就图鉴列表（含解锁状态与进度），供双端的成就面板渲染
function buildAchievementList(snapshot, unlocked) {
  const done = new Set(unlocked || []);
  return ACHIEVEMENTS.map(item => {
    const [current, target] = item.progress ? item.progress(snapshot) : [0, 1];
    return { id: item.id, icon: item.icon, name: item.name, desc: item.desc, tier: item.tier, cat: item.cat, catName: ACHIEVEMENT_CATEGORIES[item.cat].name, catColor: ACHIEVEMENT_CATEGORIES[item.cat].color, unlocked: done.has(item.id), current, target };
  });
}

module.exports = { ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, evaluateAchievements, achievementById, buildAchievementList };
