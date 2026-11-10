const { CHARACTERS } = require('../../data/content');
const Save = require('../../engine/save');

Page({
  data: {
    characters: CHARACTERS, selected: 'lin', current: CHARACTERS[0],
    showLegacy: false, legacyOptions: [], legacyPick: 'none',
    legacyNote: '', playthrough: 1
  },
  onLoad() {
    const saved = wx.getStorageSync('campus-character') || 'lin';
    this.meta = Save.readMeta();
    const info = Save.summary(this.meta);
    const pick = Save.defaultLegacy(this.meta);
    const showLegacy = (this.meta.playthroughs || 0) > 0;
    this.setData({
      selected: saved,
      current: CHARACTERS.find(c => c.id === saved),
      showLegacy,
      playthrough: (this.meta.playthroughs || 0) + 1,
      legacyOptions: Save.legacyOptions(this.meta),
      legacyPick: showLegacy && pick ? pick : 'none',
      legacyNote: `第 ${(this.meta.playthroughs || 0) + 1} 周目 · 上一局${info.lastEnding ? `「${info.lastEnding.title}」${info.lastEnding.score} 分` : '未走完'} · 隐藏事件 ${info.hiddenCleared.length} / ${info.hiddenTotal}`
    });
  },
  choose(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ selected: id, current: CHARACTERS.find(c => c.id === id) });
  },
  // 继承选择：一周目只能带走一样东西，锁着的选不了
  chooseLegacy(event) {
    const id = event.currentTarget.dataset.id;
    if (id !== 'none') {
      const option = this.data.legacyOptions.find(item => item.id === id);
      if (!option || !option.unlocked) {
        wx.showToast({ title: option ? option.progressText : '还不能继承', icon: 'none' });
        return;
      }
    }
    this.setData({ legacyPick: id });
  },
  start() {
    wx.setStorageSync('campus-character', this.data.selected);
    const app = getApp();
    app.globalData.characterId = this.data.selected;
    app.globalData.playthrough = this.data.showLegacy ? this.data.playthrough : 1;
    app.globalData.legacyId = this.data.legacyPick === 'none' ? null : this.data.legacyPick;
    wx.navigateTo({ url: '/pages/game/game' });
  }
});
