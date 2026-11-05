const { CHARACTERS } = require('../../data/content');

Page({
  data: { characters: CHARACTERS, selected: 'lin', current: CHARACTERS[0] },
  onLoad() {
    const saved = wx.getStorageSync('campus-character') || 'lin';
    this.setData({ selected: saved, current: CHARACTERS.find(c => c.id === saved) });
  },
  choose(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ selected: id, current: CHARACTERS.find(c => c.id === id) });
  },
  start() {
    wx.setStorageSync('campus-character', this.data.selected);
    getApp().globalData.characterId = this.data.selected;
    wx.navigateTo({ url: '/pages/game/game' });
  }
});
