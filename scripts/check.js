const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const files = [];
function walk(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js') && !full.includes(`${path.sep}web${path.sep}bundle.js`)) files.push(full);
  });
}
['miniprogram','web','scripts','tests'].forEach(dir => walk(path.join(root, dir)));
files.forEach(file => {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
});
['project.config.json','miniprogram/app.json','miniprogram/sitemap.json','miniprogram/pages/select/select.json','miniprogram/pages/game/game.json','package.json'].forEach(file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
console.log(`Syntax checked ${files.length} JavaScript files and 6 JSON files.`);
