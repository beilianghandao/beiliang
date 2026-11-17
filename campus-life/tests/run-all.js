// 测试总入口：把所有测试文件跑一遍。
// 每个测试文件自己跑自己，这里只负责按顺序加载并等异步的那套跑完。
const path = require('path');

const FILES = [
  'core.test.js',            // 既有玩法单元测试
  'seed.test.js',            // 种子码与选择日志专项
  'seed-contract.test.js',   // 契约别名、存档健壮性、随机源性质
  'miniprogram-e2e.test.js', // 无头小程序逻辑层 E2E
  'web-e2e.test.js'          // 无头 web 端 E2E
];

(async () => {
  for (const file of FILES) {
    await require(path.join(__dirname, file));
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
