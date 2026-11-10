App({
  globalData: { characterId: 'lin', playthrough: 1, legacyId: null },
  onLaunch() {
    const saved = wx.getStorageSync('campus-character');
    if (saved) this.globalData.characterId = saved;
  }
});
