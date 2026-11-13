const { randomSeedCode } = require('./engine/random');

App({
  globalData: { characterId: 'lin', seedCode: randomSeedCode(Math.random), playthrough: 1, legacyId: null },
  onLaunch() {
    const saved = wx.getStorageSync('campus-character');
    if (saved) this.globalData.characterId = saved;
  }
});
