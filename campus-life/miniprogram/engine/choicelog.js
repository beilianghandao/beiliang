const { semesterLabel, statName } = require('../data/content');

// 把引擎记录的选择日志整理成两端共用的展示数据：最新的一次排在最前。
// 浏览器预览和小程序都消费这份数据，保证两边看到的选择回顾完全一致。
function buildChoiceLogView(entries) {
  return (entries || []).slice().reverse().map((entry, index) => ({
    id: `${entry.sceneId}-${entry.semester}-${entry.week}-${index}`,
    semester: entry.semester,
    semesterName: semesterLabel(entry.semester),
    week: entry.week,
    sceneId: entry.sceneId,
    sceneName: entry.sceneName,
    questTitle: entry.questTitle,
    choiceText: entry.choiceText,
    repeat: !!entry.repeat,
    repeatLabel: entry.repeat ? '重复体验 · 收益递减' : '首次体验',
    effects: Object.keys(entry.effects || {}).map(key => ({
      key,
      name: statName(key),
      value: entry.effects[key]
    }))
  }));
}

module.exports = { buildChoiceLogView };
