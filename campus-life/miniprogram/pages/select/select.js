const { CHARACTERS } = require('../../data/content');
const { randomSeedCode, resolveSeedInput, applySeedInput } = require('../../engine/random');

Page({
  data: { characters: CHARACTERS, selected: 'lin', current: CHARACTERS[0], seedCode: '', seedInput: '', seedHint: '' },
  onLoad() {
    const saved = wx.getStorageSync('campus-character') || 'lin';
    this.setData({ selected: saved, current: CHARACTERS.find(c => c.id === saved), seedCode: randomSeedCode(Math.random), seedHint: '本局种子码已备好；填入同学的种子码，可以复现他的四年' });
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
  start() {
    const result = resolveSeedInput(this.data.seedInput);
    if (result.error) {
      this.setData({ seedHint: `${result.error}；请改对后再开始，或清空输入框用本局种子码 ${this.data.seedCode}` });
      return;
    }
    // 输入框留空就用这一局自动生成的种子码，填了就用填的那个
    const seedCode = result.blank ? this.data.seedCode : result.code;
    wx.setStorageSync('campus-character', this.data.selected);
    getApp().globalData.characterId = this.data.selected;
    getApp().globalData.seedCode = seedCode;
    wx.navigateTo({ url: '/pages/game/game' });
  }
});
