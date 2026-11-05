const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '../web');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 8080);
function handler(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// 端口被占用时自动往后找，避免双击启动脚本后直接报错退出
const server = http.createServer(handler);
let current = port;
function start(p) {
  current = p;
  server.listen(p, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${p}`;
    console.log(`Campus preview: ${url}`);
    // 双击启动脚本时自动拉起浏览器（设 NO_OPEN=1 可关闭，便于脚本化调试）
    if (process.env.NO_OPEN === '1') return;
    const opener = process.platform === 'win32' ? 'explorer.exe'
      : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try { spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref(); } catch (error) { /* 打不开就算了，窗口里有地址 */ }
  });
}
server.on('error', error => {
  if (error.code === 'EADDRINUSE' && current < port + 20) {
    console.log(`Port ${current} busy, trying ${current + 1} ...`);
    start(current + 1);
  } else {
    console.error(error.message);
    process.exit(1);
  }
});
start(port);
