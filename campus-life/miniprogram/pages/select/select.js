const { CHARACTERS } = require('../../data/content');
const { randomSeedCode, resolveSeedInput, applySeedInput } = require('../../engine/random');
const Save = require('../../engine/save');

Page({
  data: {
    characters: CHARACTERS, selected: 'lin', current: CHARACTERS[0],
    seedCode: '', seedInput: '', seedHint: '',
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
      seedCode: randomSeedCode(Math.random),
      seedHint: '本局种子码已备好；填入同学的种子码，可以复现他的四年',
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
  onSeedInput(event) {
    this.setData({ seedInput: event.detail.value.toUpperCase() });
  },
  // 留空就摇一局新的；填别人的种子码，就复现他那一局；填错了说清楚，不静默开局
  applySeed() {
    const result = applySeedInput(this.data.seedInput, Math.random);
    if (result.error) {
      this.setData({ seedHint: `${result.error}；本局仍用种子码 ${this.data.seedCode}` });
      return;
    }
    this.setData({ seedCode: result.code, seedInput: result.code, seedHint: result.hint });
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
    const result = resolveSeedInput(this.data.seedInput);
    if (result.error) {
      this.setData({ seedHint: `${result.error}；请改对后再开始，或清空输入框用本局种子码 ${this.data.seedCode}` });
      return;
    }
    // 输入框留空就用这一局自动生成的种子码，填了就用填的那个
    const seedCode = result.blank ? this.data.seedCode : result.code;
    wx.setStorageSync('campus-character', this.data.selected);
    const app = getApp();
    app.globalData.characterId = this.data.selected;
    app.globalData.seedCode = seedCode;
    app.globalData.playthrough = this.data.showLegacy ? this.data.playthrough : 1;
    app.globalData.legacyId = this.data.legacyPick === 'none' ? null : this.data.legacyPick;
    wx.navigateTo({ url: '/pages/game/game' });
  }
});
