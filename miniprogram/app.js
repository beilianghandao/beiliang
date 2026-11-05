App({
  globalData: { characterId: 'lin' },
  onLaunch() {
    const saved = wx.getStorageSync('campus-character');
    if (saved) this.globalData.characterId = saved;
  }
});
