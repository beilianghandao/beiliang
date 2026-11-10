const { randomSeedCode } = require('./engine/random');

App({
  globalData: { characterId: 'lin', seedCode: randomSeedCode(Math.random) },
  onLaunch() {
    const saved = wx.getStorageSync('campus-character');
    if (saved) this.globalData.characterId = saved;
  }
});
