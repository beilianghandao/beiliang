const { BUILDINGS, NPCS } = require('../data/content');

const TAU = Math.PI * 2;
const TREE_POSITIONS = [
  [90,160],[160,130],[250,150],[350,120],[480,130],[590,145],[720,150],[790,230],[800,370],[730,510],
  [90,390],[110,530],[200,600],[310,610],[470,600],[600,570],[700,640],[830,590],[910,520],
  [1450,130],[1540,170],[1630,100],[1770,100],[1910,110],[2070,130],[2220,180],[2290,300],[2250,480],
  [1510,310],[1530,450],[1430,480],[1460,590],[1580,570],[2000,560],[2140,580],[2250,660],[2200,790],
  [90,830],[180,760],[300,730],[440,730],[580,770],[650,870],[580,970],[160,980],[80,1100],[100,1270],
  [130,1420],[280,1430],[450,1420],[620,1370],[720,1270],[760,1130],[850,1200],[900,1380],[880,1510],
  [1030,1540],[1180,1540],[1360,1530],[1500,1450],[1560,1300],[1570,1150],[1510,1030],[1650,970],
  [1730,1430],[1900,1450],[2080,1430],[2250,1370],[2290,1200],[2260,1030],[2170,920],[2040,890],
  [2040,690],[1030,1120],[1300,1110],[1390,1190],[1380,1390],[700,330],[1500,730],[1580,920]
];
const FLOWERS = [[730,700],[780,760],[600,680],[1520,560],[1580,500],[2110,530],[2130,990],[1690,1010],[870,1140],[760,1350],[1460,1370],[580,1240]];
const BENCHES = [[770,870,0],[1230,950,0],[1310,600,1],[1510,890,1],[640,1030,0],[1600,1140,0]];
const LAMPS = [[700,800],[850,800],[1420,800],[1580,800],[1760,800],[2010,800],[1370,550],[1370,1040],[720,1050],[600,520],[1500,470],[1540,1210]];

function roundedRect(ctx, x, y, w, h, r) {
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function ellipse(ctx, x, y, rx, ry, color) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}

function text(ctx, value, x, y, size = 16, color = '#263d38', align = 'center', weight = 'normal') {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y);
}

/* ===================================================================
   人物比例尺：脚底为 y=0，向上为负值。
   逻辑总高 148，头部在 drawHead 里绕下巴再缩 0.85，
   视觉头高约 19.55、视觉总高约 137，头身比 ≈ 7。
   要点：腿占 55%（约 76），肩宽约 2 倍视觉头宽（13.9→肩半宽约 14）。
   =================================================================== */
const FIG = {
  H: 148,
  // 头（逻辑值；视觉上在 drawHead 缩 0.85）
  top: -148, chin: -125, headY: -136.5, headRx: 8.2, headRy: 9.6,
  brow: -139.4, eye: -134.5, nose: -131, mouth: -128.4, ear: -135,
  // 颈与躯干
  neckTop: -125.6, neckBot: -120.6, neckW: 2.95,
  shoulder: -120.4, shoulderW: 15.2,
  chest: -108, chestW: 13.4,
  waist: -92, waistW: 11.2,
  hip: -76, hipW: 13.0,
  hem: -75,
  // 四肢
  knee: -36, ankle: -8,
  thighTop: -77, thighTopW: 10.5, kneeW: 8.0, ankleW: 5.6,
  legX: 6.4,
  armY: -116, elbowY: -101, wristY: -83, handY: -78,
  armX: 15.8, elbowX: 16.6, wristX: 15.6,
  upperArmW: 6.7, foreArmW: 5.7,
  footLen: 12.8
};

/* ===================================================================
   场景立绘贴图
   文件：assets/characters/<id>_standee.png（正面）、<id>_standee_back.png（背面）
   生成的立绘是纯白底，加载后用「边缘连通泛洪」把外部白底抠成透明，
   再按 alpha 包围盒裁紧，得到紧贴人物轮廓的精灵。
   注意不能用「凡白即透明」——米白衬衫、白球鞋会被一起抠穿。
   小程序端没有 document，自动退回 Canvas 逐笔绘制。
   =================================================================== */
const STANDEE_SRC = 'assets/characters/';
const _standeeCache = {};

function matteStandee(img) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return null;
  // 场景里只有 150px 高，没必要按 1536px 原图逐像素抠——先缩到高 480 再处理，快 10 倍
  const MAXH = 480;
  const k = Math.min(1, MAXH / ih);
  const W = Math.max(1, Math.round(iw * k));
  const H = Math.max(1, Math.round(ih * k));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return null;
  g.drawImage(img, 0, 0, W, H);
  const data = g.getImageData(0, 0, W, H);
  const px = data.data;
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1); }
  for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y); }
  while (stack.length) {
    const y = stack.pop(); const x = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const idx = y * W + x;
    if (seen[idx]) continue;
    seen[idx] = 1;
    const i = idx * 4;
    // 阈值偏严，避免把白色衣物啃掉
    if (px[i] < 236 || px[i + 1] < 236 || px[i + 2] < 236) continue;
    px[i + 3] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  // 边缘半透明过渡，去掉生硬的白边
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = (y * W + x) * 4;
      if (px[i + 3] < 128) continue;
      if (px[i - 3] < 40 || px[i + 7] < 40 || px[i - W * 4 + 3] < 40 || px[i + W * 4 + 3] < 40) px[i + 3] = 168;
    }
  }
  // 按 alpha 包围盒裁紧
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px[(y * W + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  g.putImageData(data, 0, 0);
  const cw = maxX - minX + 1; const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const og = out.getContext('2d');
  if (!og) return null;
  og.drawImage(cv, minX, minY, cw, ch, 0, 0, cw, ch);
  return { cv: out, w: cw, h: ch };
}

function standeeTexture(id, view) {
  if (!id) return null;
  const suffix = view === 'back' ? '_back' : (view === 'side' ? '_side' : '');
  const key = id + '|' + (view || 'front');
  if (key in _standeeCache) return _standeeCache[key];
  _standeeCache[key] = null;
  if (typeof document === 'undefined' || !document.createElement) return null;
  const img = document.createElement('img');
  img.onload = () => { const sp = matteStandee(img); if (sp) _standeeCache[key] = sp; };
  img.src = STANDEE_SRC + id + '_standee' + suffix + '.png';
  return null;
}

/* 脚下的径向渐变投影。调用前坐标原点必须已经在脚底位置 */
function groundShadow(ctx, rx, alpha, ry) {
  const g = ctx.createRadialGradient(0, 1.6, .8, 0, 1.6, rx);
  g.addColorStop(0, `rgba(38,52,38,${alpha.toFixed(3)})`);
  g.addColorStop(.55, `rgba(38,52,38,${(alpha * .47).toFixed(3)})`);
  g.addColorStop(1, 'rgba(38,52,38,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(0, 1.6, rx, ry || 5, 0, 0, TAU); ctx.fill();
}

/* 走路帧：离线已经抠好透明底（tools/matte.py），直接用，不能再走 matteStandee，
   否则透明区若存着黑色 RGB 会被当成实体内容。 */
function walkTexture(id, n, view) {
  if (!id) return null;
  const v = view || 'side';
  const key = id + '|walk|' + v + '|' + n;
  if (key in _standeeCache) return _standeeCache[key];
  _standeeCache[key] = null;
  if (typeof document === 'undefined' || !document.createElement) return null;
  const img = new Image();
  img.onload = () => { _standeeCache[key] = { cv: img, w: img.naturalWidth, h: img.naturalHeight }; };
  // 侧面沿用旧命名；正面 / 背面加 f / b 后缀，各自是独立素材
  const tail = v === 'front' ? '_walk_f' + n : v === 'back' ? '_walk_b' + n : '_walk' + n;
  // 换图后必须带版本串：预览面板会按 URL 缓存旧图，导致「站着是新形象、一走还是旧图」
  img.src = STANDEE_SRC + id + tail + '.png?v=11';
  return null;
}

/* 每个角色一个固定的步态/呼吸相位，避免十几个人像广播体操一样同步起伏 */
function phaseSeed(person) {
  const s = String(person.id || person.name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return h / 997 * TAU;
}

function preloadStandees(ids) {
  if (typeof document === 'undefined') return;
  (ids || []).forEach(id => {
    standeeTexture(id, 'front');
    standeeTexture(id, 'back');
    standeeTexture(id, 'side');
    walkTexture(id, 1);
    walkTexture(id, 2);
    walkTexture(id, 1, 'front');
    walkTexture(id, 2, 'front');
    walkTexture(id, 1, 'back');
    walkTexture(id, 2, 'back');
  });
}

class CampusRenderer {
  constructor(ctx, width, height) {
    this.ctx = ctx;
    this.width = width;
    this.height = height;
    this.worldWidth = 2400;
    this.worldHeight = 1600;
    this.camera = { x: 0, y: 0 };
    this.time = 0;
    this.nearby = null;
  }

  resize(width, height) { this.width = width; this.height = height; }

  updateCamera(player) {
    this.camera.x = Math.max(0, Math.min(this.worldWidth - this.width, player.x - this.width / 2));
    this.camera.y = Math.max(0, Math.min(this.worldHeight - this.height, player.y - this.height / 2));
  }

  screenToWorld(x, y) { return { x: x + this.camera.x, y: y + this.camera.y }; }

  drawGround(ctx) {
    ctx.fillStyle = '#cbdcb6';
    ctx.fillRect(0, 0, this.worldWidth, this.worldHeight);
    ctx.fillStyle = '#c4d6ae';
    for (let x = 30; x < this.worldWidth; x += 85) {
      for (let y = 30; y < this.worldHeight; y += 75) {
        if ((x + y) % 4 < 2) { ctx.fillRect(x, y, 2, 7); ctx.fillRect(x + 5, y + 3, 2, 5); }
      }
    }
    ctx.strokeStyle = '#e9dfc8';
    ctx.lineWidth = 104;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-50, 840); ctx.lineTo(2450, 840);
    ctx.moveTo(1400, -50); ctx.lineTo(1400, 1650);
    ctx.moveTo(410, 520); ctx.lineTo(410, 840);
    ctx.moveTo(1130, 380); ctx.lineTo(1130, 580); ctx.lineTo(1400, 650);
    ctx.moveTo(1920, 470); ctx.lineTo(1920, 840);
    ctx.moveTo(400, 1080); ctx.lineTo(400, 840);
    ctx.moveTo(1205, 1230); ctx.lineTo(1205, 840);
    ctx.moveTo(1975, 1050); ctx.lineTo(1975, 840);
    ctx.moveTo(1630, 790); ctx.lineTo(1500, 840);
    ctx.stroke();
    ctx.strokeStyle = '#f5eddd';
    ctx.lineWidth = 88;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(181,164,133,.28)';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 14]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Central plaza
    ellipse(ctx, 1400, 840, 150, 110, '#e4d8c0');
    ellipse(ctx, 1400, 840, 132, 94, '#efe5d2');
    ctx.strokeStyle = '#d1c1a5'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(1400, 840, 104, 72, 0, 0, TAU); ctx.stroke();
    for (let a = 0; a < 12; a++) {
      const angle = a * TAU / 12;
      ctx.beginPath(); ctx.moveTo(1400, 840); ctx.lineTo(1400 + Math.cos(angle) * 102, 840 + Math.sin(angle) * 70); ctx.stroke();
    }
  }

  drawLake(ctx) {
    ctx.save();
    ctx.shadowColor = 'rgba(62,100,94,.2)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 7;
    ellipse(ctx, 1010, 790, 300, 166, '#9bbfb0');
    ctx.restore();
    ellipse(ctx, 1010, 782, 286, 152, '#81b8b3');
    ellipse(ctx, 980, 754, 245, 112, '#91c6bd');
    ctx.strokeStyle = 'rgba(235,250,230,.52)'; ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const y = 690 + i * 28;
      const shift = Math.sin(this.time * 0.0015 + i) * 12;
      ctx.beginPath(); ctx.moveTo(810 + shift, y); ctx.quadraticCurveTo(920 + shift, y - 8, 1020 + shift, y); ctx.stroke();
    }
    // Island and footbridge
    ellipse(ctx, 1110, 830, 80, 45, '#d9d2aa');
    ellipse(ctx, 1110, 822, 72, 40, '#b8cc94');
    ctx.strokeStyle = '#b78c61'; ctx.lineWidth = 22;
    ctx.beginPath(); ctx.moveTo(1235, 842); ctx.lineTo(1310, 842); ctx.stroke();
    ctx.strokeStyle = '#e0b986'; ctx.lineWidth = 16; ctx.stroke();
    ctx.strokeStyle = '#8e704e'; ctx.lineWidth = 2;
    for (let x = 1240; x < 1310; x += 12) { ctx.beginPath(); ctx.moveTo(x, 833); ctx.lineTo(x, 851); ctx.stroke(); }
    // Lotus leaves
    [[840,730],[910,850],[1030,690],[1160,720],[790,810]].forEach(([x,y], i) => {
      ellipse(ctx, x, y, 15, 7, '#6f9e82');
      if (i % 2 === 0) { ellipse(ctx, x + 2, y - 6, 5, 5, '#f4c4c5'); ellipse(ctx, x + 6, y - 5, 4, 4, '#f7dbcf'); }
    });
    text(ctx, '青 梧 湖', 1000, 790, 18, 'rgba(39,92,89,.58)', 'center', 'bold');
  }

  drawTree(ctx, x, y, index) {
    const sway = Math.sin(this.time * 0.001 + index) * 1.5;
    ellipse(ctx, x + 6, y + 10, 25, 11, 'rgba(63,85,52,.15)');
    ctx.fillStyle = '#80654a'; ctx.fillRect(x - 4, y - 20, 8, 32);
    const colors = index % 3 === 0 ? ['#648c62','#7ba16b','#91b478'] : ['#557e5b','#709768','#86ab72'];
    ellipse(ctx, x - 13 + sway, y - 30, 23, 25, colors[0]);
    ellipse(ctx, x + 15 + sway, y - 32, 24, 27, colors[0]);
    ellipse(ctx, x + sway, y - 51, 28, 29, colors[1]);
    ellipse(ctx, x - 8 + sway, y - 58, 16, 16, colors[2]);
    ellipse(ctx, x - 14 + sway, y - 64, 7, 6, 'rgba(205,225,158,.38)');
  }

  drawFlowerbed(ctx, x, y, index) {
    ellipse(ctx, x, y, 52, 26, '#ded4b6');
    ellipse(ctx, x, y - 3, 46, 21, '#789567');
    const colors = ['#f3c0ad','#f1d589','#d7b5ce'];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4;
      const fx = x + Math.cos(a) * (10 + (i % 4) * 8);
      const fy = y - 4 + Math.sin(a) * (5 + (i % 3) * 4);
      ellipse(ctx, fx, fy, 4, 3, colors[(i + index) % 3]);
      ellipse(ctx, fx, fy - 2, 2, 2, '#fff2c9');
    }
  }

  drawBench(ctx, x, y, vertical) {
    ctx.save(); ctx.translate(x, y); if (vertical) ctx.rotate(Math.PI / 2);
    ellipse(ctx, 2, 9, 35, 8, 'rgba(66,72,48,.13)');
    ctx.fillStyle = '#7f6b50'; ctx.fillRect(-27, -4, 4, 18); ctx.fillRect(23, -4, 4, 18);
    ctx.fillStyle = '#b68d5f'; roundedRect(ctx, -34, -9, 68, 12, 4); ctx.fill();
    ctx.fillStyle = '#c99e6b'; roundedRect(ctx, -34, -23, 68, 10, 4); ctx.fill();
    ctx.restore();
  }

  drawLamp(ctx, x, y) {
    ellipse(ctx, x + 3, y + 5, 12, 5, 'rgba(50,70,50,.16)');
    ctx.fillStyle = '#52675d'; ctx.fillRect(x - 2, y - 42, 4, 46);
    ellipse(ctx, x, y + 2, 7, 3, '#52675d');
    ctx.fillStyle = '#52675d'; roundedRect(ctx, x - 9, y - 54, 18, 16, 4); ctx.fill();
    ctx.fillStyle = '#ffe7a3'; roundedRect(ctx, x - 6, y - 51, 12, 10, 2); ctx.fill();
  }

  drawBuilding(ctx, b) {
    ctx.save();
    ellipse(ctx, b.x + b.w / 2 + 10, b.y + b.h + 14, b.w * .52, 25, 'rgba(64,76,56,.18)');
    // Main facade
    const gradient = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    gradient.addColorStop(0, b.color); gradient.addColorStop(1, this.shade(b.color, -13));
    ctx.fillStyle = gradient; roundedRect(ctx, b.x, b.y + 25, b.w, b.h - 25, 9); ctx.fill();
    // Roof with depth
    ctx.fillStyle = this.shade(b.roof, -15);
    ctx.beginPath(); ctx.moveTo(b.x - 18, b.y + 38); ctx.lineTo(b.x + 28, b.y - 12); ctx.lineTo(b.x + b.w - 25, b.y - 12); ctx.lineTo(b.x + b.w + 18, b.y + 38); ctx.closePath(); ctx.fill();
    ctx.fillStyle = b.roof;
    ctx.beginPath(); ctx.moveTo(b.x - 12, b.y + 26); ctx.lineTo(b.x + 30, b.y - 20); ctx.lineTo(b.x + b.w - 28, b.y - 20); ctx.lineTo(b.x + b.w + 12, b.y + 26); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.17)'; ctx.lineWidth = 3;
    for (let x = b.x + 25; x < b.x + b.w - 20; x += 28) { ctx.beginPath(); ctx.moveTo(x, b.y - 11); ctx.lineTo(x - 17, b.y + 18); ctx.stroke(); }
    // Windows
    const cols = Math.max(3, Math.floor(b.w / 88));
    const rows = b.h > 210 ? 2 : 1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const wx = b.x + 30 + col * ((b.w - 60) / (cols - 1));
        const wy = b.y + 63 + row * 70;
        if (Math.abs(wx - b.doorX) < 42 && row === rows - 1) continue;
        ctx.fillStyle = 'rgba(71,89,89,.25)'; roundedRect(ctx, wx - 20, wy - 16, 43, 40, 4); ctx.fill();
        ctx.fillStyle = '#b9d7d2'; roundedRect(ctx, wx - 22, wy - 19, 43, 38, 4); ctx.fill();
        ctx.fillStyle = '#e5efdb'; ctx.fillRect(wx - 18, wy - 15, 16, 13);
        ctx.fillStyle = '#91b5b5'; ctx.fillRect(wx + 2, wy + 2, 15, 13);
        ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(wx, wy - 18); ctx.lineTo(wx, wy + 18); ctx.stroke();
      }
    }
    // Entrance
    const dx = b.doorX;
    const dy = b.y + b.h;
    ctx.fillStyle = this.shade(b.color, -28); roundedRect(ctx, dx - 35, dy - 61, 70, 63, 5); ctx.fill();
    ctx.fillStyle = '#5f7e7d'; roundedRect(ctx, dx - 27, dy - 54, 54, 55, 3); ctx.fill();
    ctx.fillStyle = '#a9d0c7'; ctx.fillRect(dx - 22, dy - 49, 19, 42); ctx.fillRect(dx + 3, dy - 49, 19, 42);
    ctx.fillStyle = '#f4df9e'; ellipse(ctx, dx + 17, dy - 25, 2, 2, '#f4df9e');
    ctx.fillStyle = '#e4d7c1'; ctx.fillRect(dx - 48, dy, 96, 8); ctx.fillRect(dx - 55, dy + 8, 110, 7);
    // Signboard
    const signW = Math.max(126, b.name.length * 23 + 30);
    ctx.shadowColor = 'rgba(44,54,43,.16)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#fff8e9'; roundedRect(ctx, b.x + b.w / 2 - signW / 2, b.y + 22, signW, 38, 8); ctx.fill();
    ctx.shadowColor = 'transparent';
    text(ctx, b.name, b.x + b.w / 2, b.y + 42, 18, '#3e5048', 'center', 'bold');
    text(ctx, b.icon, b.x + 18, b.y + b.h - 15, 9, 'rgba(255,255,255,.68)', 'left', 'bold');
    ctx.restore();
  }

  shade(hex, amount) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.min(255, (num >> 16) + amount));
    const g = Math.max(0, Math.min(255, ((num >> 8) & 255) + amount));
    const b = Math.max(0, Math.min(255, (num & 255) + amount));
    return `rgb(${r},${g},${b})`;
  }

  drawFountain(ctx) {
    ellipse(ctx, 1400, 850, 56, 24, 'rgba(62,73,51,.15)');
    ellipse(ctx, 1400, 834, 52, 29, '#b8b7a4');
    ellipse(ctx, 1400, 828, 47, 24, '#e5dfc9');
    ellipse(ctx, 1400, 826, 39, 18, '#81b9b4');
    ctx.fillStyle = '#d7d2bd'; ctx.fillRect(1395, 790, 10, 38);
    ellipse(ctx, 1400, 790, 15, 7, '#eee7d3');
    ctx.strokeStyle = 'rgba(223,248,239,.8)'; ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const a = i * TAU / 4 + this.time * .0002;
      ctx.beginPath(); ctx.moveTo(1400, 787); ctx.quadraticCurveTo(1400 + Math.cos(a) * 24, 766, 1400 + Math.cos(a) * 31, 820); ctx.stroke();
    }
  }

  drawPerson(ctx, person, isPlayer, time) {
    const dir = (person.facing === 'up' || person.facing === 'left' || person.facing === 'right') ? person.facing : 'down';
    // 有立绘贴图就用贴图，没有（小程序端 / 图还没加载完）就退回逐笔绘制
    let tex = null;
    if (person.moving) {
      // 侧面走路有真·走路帧（腿真的换了姿势），左右交替两帧循环
      if (person._ph === undefined) person._ph = phaseSeed(person);
      const frame = Math.sin(time * .0104 + person._ph) > 0 ? 1 : 2;
      tex = this.pickStandee(person.id, dir, frame);
    }
    if (!tex) tex = this.pickStandee(person.id, dir);
    if (tex) {
      this.drawStandee(ctx, tex, person, isPlayer, time);
      if (!isPlayer) this.drawNameTag(ctx, person);
      return;
    }
    if (!isPlayer) {
      const sp = this.npcSprite(person, time);
      if (sp) {
        ctx.drawImage(sp.cv, person.x - sp.ox, person.y - sp.oy, sp.w, sp.h);
        this.drawNameTag(ctx, person);
        return;
      }
    }
    this.drawPersonRaw(ctx, person, isPlayer, time);
    if (!isPlayer) this.drawNameTag(ctx, person);
  }

  /* 按朝向挑贴图：正/背/侧。侧图是「面朝左」画的，朝右时镜像。
     没有侧图就退回正面图压扁 72% 顶替。 */
  pickStandee(id, dir, walkFrame) {
    if (!id) return null;
    if (dir === 'up') {
      if (walkFrame) {
        const wk = walkTexture(id, walkFrame, 'back');
        if (wk) return { cv: wk.cv, w: wk.w, h: wk.h, flip: false, squash: 1, walk: true };
      }
      const back = standeeTexture(id, 'back');
      if (back) { back.flip = false; back.squash = 1; return back; }
      const front = standeeTexture(id, 'front');
      if (front) { front.flip = false; front.squash = 1; }
      return front;
    }
    if (dir === 'left' || dir === 'right') {
      // 走路帧也是「面朝左」画的，朝右时镜像；取不到就退回站姿侧图
      if (walkFrame) {
        const wk = walkTexture(id, walkFrame);
        if (wk) return { cv: wk.cv, w: wk.w, h: wk.h, flip: dir === 'right', squash: 1, walk: true };
      }
      const side = standeeTexture(id, 'side');
      if (side) { side.flip = dir === 'right'; side.squash = 1; return side; }
      const front = standeeTexture(id, 'front');
      if (front) { front.flip = dir === 'left'; front.squash = .72; }
      return front;
    }
    if (walkFrame) {
      const wk = walkTexture(id, walkFrame, 'front');
      if (wk) return { cv: wk.cv, w: wk.w, h: wk.h, flip: false, squash: 1, walk: true };
    }
    const front = standeeTexture(id, 'front');
    if (front) { front.flip = false; front.squash = 1; }
    return front;
  }

  /* 立绘贴图：脚底对齐 person.y，按朝向做镜像与侧身压扁。
     步态靠四件事叠出来 —— 离地起伏、重心左右移、上身剪切摆、落地轻微压缩。
     刻意不用整体 rotate：旋转会带着脚掌一起转，看着像崴脚。 */
  drawStandee(ctx, tex, person, isPlayer, time) {
    const moving = !!person.moving;
    const h = isPlayer ? 152 : 138;
    const w = h * tex.w / tex.h;
    const squash = tex.squash || 1;
    const isSide = squash < 1;

    if (person._ph === undefined) person._ph = phaseSeed(person);

    /* 真·走路帧：两张不同的迈步姿势交替，腿是真的换了位置。
       这时程序化动效要全部收敛，否则两层动效打架，看着像抽搐。 */
    if (tex.walk) {
      const bob = Math.abs(Math.sin(time * .0104 + person._ph)) * 1.1;
      ctx.save();
      ctx.translate(person.x, person.y);
      groundShadow(ctx, (isSide ? 17 : 21) * (1 - bob * .03), .34 * (1 - bob * .06));
      ctx.translate(0, -bob);
      ctx.scale(tex.flip ? -1 : 1, 1);
      ctx.drawImage(tex.cv, -w / 2, -h, w, h);
      ctx.restore();
      return;
    }

    /* 起停过渡：0 = 静止，1 = 全速。松手那一刻从起伏滑回呼吸，不会「哒」地跳一下。
       k 按帧间隔归一化，掉帧时不至于慢动作滑行一秒。 */
    const dt = Math.min(48, time - (person._wt === undefined ? time - 16.7 : person._wt));
    person._wt = time;
    if (person._wb === undefined) person._wb = 0;
    const goal = moving ? 1 : 0;
    person._wb += (goal - person._wb) * Math.min(.42, (dt / 16.7) * .17);
    if (Math.abs(goal - person._wb) < .005) person._wb = goal;
    const wb = person._wb;
    const idle = 1 - wb;

    /* 步态相位：220px/s 行进约占 3.3 步/秒，一个完整周期 = 左右各一步 */
    const phase = time * .0104 + person._ph;
    const step = Math.sin(phase);        // 跨步：左右重心
    const lift = Math.cos(phase * 2);    // 起伏：每迈一步一个峰
    const landing = Math.max(0, -lift);  // 1 = 双脚同时触地

    // 落地时身体最低、腿并拢通过时最高；静止时只剩很轻的呼吸
    const bob = wb * (2.2 - lift * 2.2) + idle * Math.sin(time * .0024 + person._ph) * (isPlayer ? .6 : .35);
    // 重心左右微移，侧身时更明显（侧向的步幅看着更大）
    const swayX = wb * step * (isSide ? 1.3 : 1.0);
    // 上身以脚底为轴剪切摆动，外加侧身时的一点前倾，走起来才有推进感
    const lean = isSide ? (tex.flip ? -.008 : .008) * wb : 0;
    const skew = wb * step * .009 + lean;
    // 落地压扁、腾空拉长
    const sy = 1 - wb * landing * .018;
    const sx = 1 + wb * landing * .013;
    // 侧身时腿段的前后摆角
    const legAngle = wb * step * .2;

    ctx.save();
    ctx.translate(person.x, person.y);

    /* 地面投影钉在地面上，不跟着身体起伏走：
       身体弹起来时脚和影子拉开几像素，才有「离地」的感觉，否则永远像贴地滑行 */
    groundShadow(ctx, (isSide ? 15 : 21) * (1 - bob * .03), .34 * (1 - bob * .06), 5 * (1 - bob * .02));

    ctx.translate(swayX, -bob);

    ctx.transform(1, 0, skew, 1, 0, 0);
    ctx.scale(tex.flip ? -squash : squash, 1);
    ctx.scale(sx, sy);

    /* 腰线把立绘切成上下两段：
       腿段绕大腿根转（侧身迈步）+ 纵向拉伸（身体抬多少，腿就伸多少），
       两块咬合在同一个锚点上，接缝处位移为 0，看不出来。
       拉伸是关键——不拉的话身体一起伏，连脚一起飘离地面，就成了纸片人。 */
    if (wb > .01) {
      const splitY = -h * .46;
      const stretch = 1 + bob / -splitY;
      ctx.save();
      ctx.beginPath(); ctx.rect(-w * 2, splitY, w * 4, -splitY + bob + 2); ctx.clip();
      ctx.translate(0, splitY);
      if (isSide) ctx.rotate(legAngle);
      ctx.scale(1, stretch);
      ctx.translate(0, -splitY);
      ctx.drawImage(tex.cv, -w / 2, -h, w, h);
      ctx.restore();
      // 上身保持原样，不跟着腿转，否则腰两侧角度不一致，看着像腰折了
      ctx.save();
      ctx.beginPath(); ctx.rect(-w * 2, -h * 3, w * 4, splitY + h * 3 + 2); ctx.clip();
      ctx.drawImage(tex.cv, -w / 2, -h, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(tex.cv, -w / 2, -h, w, h);
    }
    ctx.restore();
  }

  /* NPC 完全静止，把整只人烘焙成一张图，省掉每帧几千次路径绘制 */
  npcSprite(person, time) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    const dir = (person.facing === 'up' || person.facing === 'left' || person.facing === 'right') ? person.facing : 'down';
    const key = [person.color, person.hair, person.skin, person.pants, person.hairStyle, person.accessory, dir].join('|');
    this._sprites = this._sprites || {};
    if (this._sprites[key]) return this._sprites[key];

    const W = 58, H = 165, OX = 29, OY = 155, SS = 2;
    const cv = document.createElement('canvas');
    cv.width = W * SS; cv.height = H * SS;
    const g = cv.getContext('2d');
    if (!g) return null;
    g.scale(SS, SS);
    this.drawPersonRaw(g, { ...person, x: OX, y: OY, moving: false }, false, time);
    const sp = { cv, ox: OX, oy: OY, w: W, h: H };
    this._sprites[key] = sp;
    return sp;
  }

  drawNameTag(ctx, person) {
    if (!this.nearby || this.nearby.id !== person.id) return;
    ctx.save();
    ctx.fillStyle = 'rgba(255,252,240,.95)';
    roundedRect(ctx, person.x - 44, person.y - 160, 88, 28, 14); ctx.fill();
    text(ctx, person.name, person.x, person.y - 146, 13, '#42584f', 'center', 'bold');
    ellipse(ctx, person.x, person.y - 171, 10, 10, '#f2c96f');
    text(ctx, '!', person.x, person.y - 171, 13, '#6b5631', 'center', 'bold');
    ctx.restore();
  }

  drawPersonRaw(ctx, person, isPlayer, time) {
    const moving = !!person.moving;
    const dir = (person.facing === 'up' || person.facing === 'left' || person.facing === 'right') ? person.facing : 'down';
    const phase = time * .0125;
    const step = moving ? Math.sin(phase) : 0;
    const bob = moving ? Math.abs(Math.cos(phase)) * 1.5 : (isPlayer ? Math.sin(time * .0026) * .45 : 0);
    const scale = isPlayer ? 1.02 : .94;

    const skin = person.skin || '#f6cdb0';
    const hair = person.hair || '#3b302c';
    const cloth = person.color || '#7d92b8';
    const pants = person.pants || '#46586c';
    const style = person.hairStyle || 'short';
    const back = dir === 'up';
    const profile = dir === 'left' || dir === 'right';
    const side = dir === 'right' ? 1 : -1;

    const P = {
      skin, hair, cloth, pants, style, dir, side, back, profile, time, step,
      // 侧面看，身体厚度只有肩宽的六成——不缩就会变成两片纸板
      wideK: profile ? .62 : 1,
      skinHi: this.tone(skin, 16), skinLo: this.tone(skin, -18), skinDeep: this.tone(skin, -40),
      hairHi: this.tone(hair, 50), hairMid: this.tone(hair, 26), hairLo: this.tone(hair, -14), hairDeep: this.tone(hair, -42),
      clothHi: this.tone(cloth, 34), clothLo: this.tone(cloth, -26), clothDeep: this.tone(cloth, -56),
      pantsHi: this.tone(pants, 20), pantsLo: this.tone(pants, -30), pantsDeep: this.tone(pants, -52),
      accessory: person.accessory
    };

    ctx.save();
    ctx.translate(person.x, person.y - bob);
    ctx.scale(scale, scale);

    this.drawShadow(ctx, isPlayer, step, time);

    const sw = step * (profile ? 5.4 : 1.0);
    const liftFront = moving ? Math.max(0, step) * (profile ? 1.0 : 3.2) : 0;
    const liftBack = moving ? Math.max(0, -step) * (profile ? 1.0 : 3.2) : 0;

    const near = profile ? side : 1;
    const far = -near;

    const hasLongHair = style === 'long' || style === 'ponytail';

    this.drawHips(ctx, P);
    this.drawLeg(ctx, P, far, -sw * .56, liftBack);
    this.drawLeg(ctx, P, near, sw * .56, liftFront);

    // 正面：长发在衣服底下，只从两侧露一点
    if (hasLongHair && !back) this.drawHairBack(ctx, P);

    if (!profile) this.drawArm(ctx, P, far, -step * 2.8, true);
    this.drawTorso(ctx, P);

    // 背面：长发是披在背上的，必须盖在衣服上面
    if (hasLongHair && back) this.drawHairBack(ctx, P);
    if (back) this.drawBackpack(ctx, P);

    this.drawArm(ctx, P, near, step * 2.8, false);
    this.drawNeck(ctx, P);
    this.drawHead(ctx, P);

    ctx.restore();
  }

  /* ---- 工具：颜色明暗（非 hex 时原样返回） ---- */
  tone(color, amount) {
    return /^#[0-9a-fA-F]{6}$/.test(color) ? this.shade(color, amount) : color;
  }

  /* ---- 落地阴影 ---- */
  drawShadow(ctx, isPlayer, step, time) {
    ctx.save();
    ctx.translate(0, 1.6);
    const rx = 11.8 - Math.abs(step) * .9;
    const g = ctx.createRadialGradient(0, 0, .8, 0, 0, rx);
    g.addColorStop(0, 'rgba(38,52,38,.36)');
    g.addColorStop(.55, 'rgba(38,52,38,.18)');
    g.addColorStop(1, 'rgba(38,52,38,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, 4.5, 0, 0, TAU); ctx.fill();
    if (isPlayer) {
      const puls = Math.sin(time * .004) * 1.3;
      ctx.strokeStyle = 'rgba(255,240,150,.72)'; ctx.lineWidth = 1.7;
      ctx.beginPath(); ctx.ellipse(0, 0, 15.5 + puls, 6.6, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = .9;
      ctx.beginPath(); ctx.ellipse(0, 0, 19 + puls, 8.2, 0, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---- 胯：把两条腿的大腿根连成一片，否则会像两根棍子插在地上 ---- */
  drawHips(ctx, P) {
    const k = P.wideK;
    const hw = FIG.hipW * k;
    const g = ctx.createLinearGradient(-hw, FIG.thighTop, hw, FIG.hip);
    g.addColorStop(0, P.pantsHi);
    g.addColorStop(.5, P.pants);
    g.addColorStop(1, P.pantsLo);
    ctx.beginPath();
    ctx.moveTo(-hw, FIG.hip - 1);
    ctx.quadraticCurveTo(-hw - .6, FIG.thighTop + 3, -hw + 1.6, FIG.thighTop + 11);
    ctx.quadraticCurveTo(0, FIG.thighTop + 13.6, hw - 1.6, FIG.thighTop + 11);
    ctx.quadraticCurveTo(hw + .6, FIG.thighTop + 3, hw, FIG.hip - 1);
    ctx.quadraticCurveTo(0, FIG.hip + 1.8, -hw, FIG.hip - 1);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
  }

  /* ---- 单条腿：大腿 → 膝 → 小腿 ---- */
  drawLeg(ctx, P, sgn, swing, lift) {
    const k = P.profile ? .34 : 1;
    const x0 = sgn * FIG.legX * k;
    const hipY = FIG.thighTop;
    const kneeY = FIG.knee + lift * .42;
    const ankleY = FIG.ankle + lift;
    const kx = x0 + swing * .5;
    const ax = x0 + swing;
    const tw = FIG.thighTopW / 2, kw = FIG.kneeW / 2, aw = FIG.ankleW / 2;

    const g = ctx.createLinearGradient(x0 - tw, hipY, x0 + tw, FIG.ankle);
    g.addColorStop(0, P.pantsHi);
    g.addColorStop(.32, P.pants);
    g.addColorStop(1, P.pantsLo);

    const calfY = kneeY + (ankleY - kneeY) * .34;   // 小腿肚最高点
    const calf = kw * 1.16;
    ctx.beginPath();
    ctx.moveTo(x0 - tw, hipY);
    ctx.quadraticCurveTo(kx - tw - .35, (hipY + kneeY) / 2, kx - kw, kneeY);
    ctx.quadraticCurveTo(ax - calf - .2, calfY, ax - aw, ankleY);
    ctx.lineTo(ax + aw, ankleY);
    ctx.quadraticCurveTo(ax + calf + .2, calfY, kx + kw, kneeY);
    ctx.quadraticCurveTo(kx + tw + .35, (hipY + kneeY) / 2, x0 + tw, hipY);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(28,24,30,.15)'; ctx.lineWidth = .7; ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = .8;
    ctx.beginPath();
    ctx.moveTo(kx - kw + .7, kneeY + 1.4);
    ctx.quadraticCurveTo(kx, kneeY + 2.6, kx + kw - .9, kneeY + 1.3);
    ctx.stroke();
    // 外侧裤缝
    ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = .7;
    ctx.beginPath();
    ctx.moveTo(x0 + tw * .72, hipY + 3);
    ctx.quadraticCurveTo(kx + kw * .72, (hipY + kneeY) / 2, ax + aw * .6, ankleY - 1);
    ctx.stroke();

    this.drawShoe(ctx, P, ax, ankleY, sgn);
  }

  /* ---- 鞋 ---- */
  drawShoe(ctx, P, x, y, sgn) {
    const top = y + .2;
    const tip = sgn * FIG.footLen * .58;
    const g = ctx.createLinearGradient(x, top - 3.4, x, .4);
    g.addColorStop(0, '#fbf6ea');
    g.addColorStop(.45, '#e3dac8');
    g.addColorStop(1, '#b9ae9a');

    ctx.beginPath();
    ctx.moveTo(x - sgn * 3.9, top - .2);
    ctx.quadraticCurveTo(x + sgn * 3.2, top - 1.2, x + tip * .74, -3.4);
    ctx.quadraticCurveTo(x + tip, -2.2, x + tip * .96, -1.1);
    ctx.quadraticCurveTo(x + tip * .7, .5, x + sgn * 1.8, .7);
    ctx.lineTo(x - sgn * 4.2, .7);
    ctx.quadraticCurveTo(x - sgn * 4.8, top + 1.6, x - sgn * 3.9, top - .2);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(64,58,48,.2)'; ctx.lineWidth = .6; ctx.stroke();

    const x1 = Math.min(x - sgn * 4.4, x + tip), x2 = Math.max(x - sgn * 4.4, x + tip);
    ctx.fillStyle = '#a09684';
    roundedRect(ctx, x1, -.9, x2 - x1, 1.7, .8); ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.beginPath(); ctx.ellipse(x + tip * .55, -4.6, 1.6, .75, -.12 * sgn, 0, TAU); ctx.fill();
  }

  /* ---- 躯干：斜方肌 → 肩头 → 腋下 → 收腰 → 胯 ---- */
  drawTorso(ctx, P) {
    const k = P.wideK;
    const sh = FIG.shoulderW * k, ws = FIG.waistW * k, hp = FIG.hipW * k;

    const nw = Math.max(2.9, 3.9 * k);
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(-nw, FIG.shoulder - 2.4);                                    // 颈根
      ctx.bezierCurveTo(-sh * .6, FIG.shoulder - 1.8, -sh * .88, FIG.shoulder + 1.6, -sh + .5, FIG.shoulder + 4.8);
      ctx.bezierCurveTo(-sh - .2, FIG.shoulder + 7, -sh + .6, FIG.chest + .8, -ws - .9, FIG.waist + 2.6);
      ctx.quadraticCurveTo(-hp + .4, FIG.hip + 3.4, -hp, FIG.hem);            // 腰到胯
      ctx.quadraticCurveTo(0, FIG.hem + 2.2, hp, FIG.hem);                    // 下摆
      ctx.quadraticCurveTo(hp - .4, FIG.hip + 3.4, ws + .9, FIG.waist + 2.6);
      ctx.bezierCurveTo(sh - .6, FIG.chest + .8, sh + .2, FIG.shoulder + 7, sh - .5, FIG.shoulder + 4.8);
      ctx.bezierCurveTo(sh * .88, FIG.shoulder + 1.6, sh * .6, FIG.shoulder - 1.8, nw, FIG.shoulder - 2.4);
      ctx.quadraticCurveTo(0, FIG.shoulder - .2, -nw, FIG.shoulder - 2.4);    // 领口
      ctx.closePath();
    };

    const g = ctx.createLinearGradient(-sh, FIG.shoulder, ws * .6, FIG.hem);
    g.addColorStop(0, P.clothHi);
    g.addColorStop(.4, P.cloth);
    g.addColorStop(1, P.clothLo);
    body();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(30,26,32,.18)'; ctx.lineWidth = .8; ctx.stroke();

    ctx.save();
    body(); ctx.clip();

    if (P.back) {
      const bd = ctx.createLinearGradient(0, FIG.shoulder, 0, FIG.hem);
      bd.addColorStop(0, 'rgba(0,0,0,.12)');
      bd.addColorStop(.45, 'rgba(0,0,0,0)');
      bd.addColorStop(1, 'rgba(0,0,0,.12)');
      ctx.fillStyle = bd;
      ctx.fillRect(-sh, FIG.shoulder - 6, sh * 2, 40);
    } else {
      // 左侧受光
      const lg = ctx.createLinearGradient(-sh, 0, -ws * .3, 0);
      lg.addColorStop(0, 'rgba(255,255,255,.22)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(-sh, FIG.shoulder - 6, sh * .62, 34);

      // 右侧背光
      const rg = ctx.createLinearGradient(sh, 0, ws * .45, 0);
      rg.addColorStop(0, 'rgba(0,0,0,.18)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(ws * .3, FIG.shoulder - 6, sh, 34);

      // 腋下暗面，把手臂和躯干分开
      [-1, 1].forEach(s => {
        const ag = ctx.createLinearGradient(s * (sh - 2), 0, s * (ws + .5), 0);
        ag.addColorStop(0, 'rgba(0,0,0,.16)');
        ag.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ag;
        ctx.fillRect(s > 0 ? ws : -sh, FIG.chest - 6, sh - ws, 20);
      });

      if (!P.profile) {
        // 拉链
        ctx.strokeStyle = 'rgba(28,26,32,.28)'; ctx.lineWidth = .85;
        ctx.beginPath(); ctx.moveTo(0, FIG.shoulder - 1.2); ctx.lineTo(0, FIG.hem + 1); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.20)'; ctx.lineWidth = .5;
        ctx.beginPath(); ctx.moveTo(.85, FIG.shoulder - 1.2); ctx.lineTo(.85, FIG.hem + 1); ctx.stroke();

        // 口袋
        ctx.strokeStyle = 'rgba(28,26,32,.15)'; ctx.lineWidth = .7;
        [-1, 1].forEach(s => {
          ctx.beginPath();
          ctx.moveTo(s * ws * .74, FIG.waist + 1.2);
          ctx.quadraticCurveTo(s * hp * .7, FIG.waist + 5.6, s * hp * .46, FIG.waist + 4);
          ctx.stroke();
        });
      }

      // 领口阴影
      ctx.fillStyle = 'rgba(0,0,0,.14)';
      ctx.beginPath();
      ctx.moveTo(-nw, FIG.shoulder - 2.4);
      ctx.quadraticCurveTo(0, FIG.shoulder + 2.6, nw, FIG.shoulder - 2.4);
      ctx.quadraticCurveTo(0, FIG.shoulder - .2, -nw, FIG.shoulder - 2.4);
      ctx.fill();
    }
    ctx.restore();

    // 肩线受光
    if (!P.profile) {
      ctx.strokeStyle = 'rgba(255,255,255,.24)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s * (sh * .28), FIG.shoulder + .4);
        ctx.quadraticCurveTo(s * (sh * .78), FIG.shoulder + 1.2, s * (sh - 1.4), FIG.shoulder + 5.6);
        ctx.stroke();
      });
    }

    // 下摆投影
    ctx.strokeStyle = 'rgba(24,22,28,.22)'; ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(-hp + .6, FIG.hem - .6);
    ctx.quadraticCurveTo(0, FIG.hem + 1.8, hp - .6, FIG.hem - .6);
    ctx.stroke();
  }

  /* ---- 单条手臂：圆肩头 → 肘 → 腕 ---- */
  drawArm(ctx, P, sgn, swing, isFar) {
    const k = P.wideK;
    const s = sgn;
    const ax = s * FIG.armX * k;
    const ex = s * FIG.elbowX * k;
    const wx = s * FIG.wristX * k + swing * .5;
    const awid = FIG.upperArmW / 2 * (P.profile ? .82 : 1);
    const fwid = FIG.foreArmW / 2 * (P.profile ? .82 : 1);
    const shY = FIG.shoulder + 2.6;      // 袖山高度

    const g = ctx.createLinearGradient(-FIG.shoulderW, 0, FIG.shoulderW, 0);
    g.addColorStop(0, P.clothHi);
    g.addColorStop(.55, P.cloth);
    g.addColorStop(1, P.clothLo);

    // 圆肩头：一个半圆顶，比平顶自然得多
    ctx.beginPath();
    ctx.moveTo(ax - awid, shY + 3.4);
    ctx.bezierCurveTo(ax - awid - .5, shY - .4, ax + awid + .5, shY - .4, ax + awid, shY + 3.4);
    ctx.quadraticCurveTo(ax + awid + .5, (shY + FIG.elbowY) / 2, ex + fwid + swing * .3, FIG.elbowY);
    ctx.quadraticCurveTo(wx + fwid + .4, (FIG.elbowY + FIG.wristY) / 2, wx + fwid, FIG.wristY);
    ctx.lineTo(wx - fwid, FIG.wristY);
    ctx.quadraticCurveTo(wx - fwid - .3, FIG.elbowY - 5.4, ex - fwid + swing * .3, FIG.elbowY);
    ctx.quadraticCurveTo(ax - awid - .5, FIG.elbowY + 3.4, ax - awid, shY + 3.4);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();

    if (isFar) { ctx.fillStyle = 'rgba(26,32,50,.11)'; ctx.fill(); }
    else {
      const ig = ctx.createLinearGradient(ax - s * awid, 0, ax + s * awid * .2, 0);
      ig.addColorStop(0, 'rgba(0,0,0,.07)');
      ig.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ig; ctx.fill();
    }

    // 只描外侧轮廓——内侧描边会变成一道竖直分界线
    ctx.beginPath();
    ctx.moveTo(ax + s * awid, shY + 3.4);
    ctx.bezierCurveTo(ax + s * awid + s * .5, shY - .4, ax - s * awid - s * .5, shY - .4, ax - s * awid, shY + 3.4);
    ctx.quadraticCurveTo(ax + s * (awid + .5), (shY + FIG.elbowY) / 2, ex + s * (fwid + swing * .3), FIG.elbowY);
    ctx.quadraticCurveTo(wx + s * (fwid + .4), (FIG.elbowY + FIG.wristY) / 2, wx + s * fwid, FIG.wristY);
    ctx.strokeStyle = 'rgba(28,24,32,.22)'; ctx.lineWidth = .75; ctx.stroke();

    // 腋下暗面，制造手臂与身体的分离感
    const ag = ctx.createLinearGradient(ax - s * awid, 0, ax + s * awid, 0);
    ag.addColorStop(0, 'rgba(0,0,0,0)');
    ag.addColorStop(s > 0 ? 1 : 0, 'rgba(0,0,0,.13)');
    ctx.fillStyle = ag;
    ctx.fillRect(ax - awid, shY + 2, awid * 2, 16);

    // 袖口
    const cw = fwid * 2 + 1.6;
    ctx.fillStyle = P.clothDeep;
    roundedRect(ctx, wx - cw / 2, FIG.wristY - 2.6, cw, 3.2, 1.3); ctx.fill();

    // 手掌
    const hx2 = wx + s * .1;
    const hg = ctx.createRadialGradient(hx2 - .5, FIG.handY - 1.2, .4, hx2, FIG.handY + .6, 3.6);
    hg.addColorStop(0, P.skinHi);
    hg.addColorStop(1, P.skin);
    ctx.fillStyle = isFar ? P.skinLo : hg;
    ctx.beginPath();
    ctx.ellipse(hx2, FIG.handY + .4, 2.4, 3.0, s * .1, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(122,82,60,.16)'; ctx.lineWidth = .6; ctx.stroke();

    ctx.strokeStyle = 'rgba(160,104,80,.26)'; ctx.lineWidth = .5;
    ctx.beginPath();
    ctx.moveTo(hx2 - 1.1, FIG.handY + 2.4);
    ctx.quadraticCurveTo(hx2, FIG.handY + 2.8, hx2 + 1.1, FIG.handY + 2.4);
    ctx.stroke();
  }

  /* ---- 脖子 ---- */
  drawNeck(ctx, P) {
    const w = FIG.neckW;
    const g = ctx.createLinearGradient(-w, FIG.neckTop, w, FIG.neckBot);
    g.addColorStop(0, P.skinLo);
    g.addColorStop(.55, P.skin);
    g.addColorStop(1, P.skinLo);

    ctx.beginPath();
    ctx.moveTo(-w + .5, FIG.neckTop);
    ctx.quadraticCurveTo(-w - .3, FIG.neckBot - 1.2, -w - 2, FIG.neckBot + 1.4);
    ctx.lineTo(w + 2, FIG.neckBot + 1.4);
    ctx.quadraticCurveTo(w + .3, FIG.neckBot - 1.2, w - .5, FIG.neckTop);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();

    ctx.fillStyle = 'rgba(150,96,72,.22)';
    ctx.beginPath();
    ctx.ellipse(0, FIG.neckTop + 1, w * .95, 1.6, 0, 0, TAU);
    ctx.fill();
  }

  /* ---- 头 ----
     为了逼近 7 头身，这里把整颗头（含五官、头发）绕下巴锚点
     等比缩小到 0.85，使头高从 23 降到约 19.5，头身比提升，
     同时五官相对位置不变、不会错位。 */
  drawHead(ctx, P) {
    const hx = P.profile ? -P.side * 1.0 : 0;
    const HS = 0.85; // 头部缩放系数

    ctx.save();
    // 以头部中心为锚点缩放（锚点 x 用 0，避免侧面镜像时错位）
    ctx.translate(0, FIG.chin);
    ctx.scale(HS, HS);
    ctx.translate(0, -FIG.chin);

    const hx2 = P.profile ? -P.side * 1.0 : 0;

    if (P.back) {
      this.drawSkull(ctx, P, hx2);
      this.drawHairBackHead(ctx, P, hx2);
      ctx.restore();
      return;
    }
    if (P.profile) this.drawProfileSkull(ctx, P, hx2);
    else this.drawSkull(ctx, P, hx2);

    this.drawFace(ctx, P, hx2);
    if (P.profile) {
      this.drawHairBackTop(ctx, P, hx2);
      this.drawHairProfile(ctx, P, hx2);
    } else {
      this.drawHairFront(ctx, P, hx2);
    }
    ctx.restore();
  }

  /* 后脑发型：背面视角专用，整颗头都被头发包住 */
  drawHairBackHead(ctx, P, hx) {
    ctx.save();
    ctx.translate(hx, 0);
    const g = ctx.createLinearGradient(-9, FIG.top, 6, FIG.chin);
    g.addColorStop(0, P.hairHi);
    g.addColorStop(.38, P.hair);
    g.addColorStop(1, P.hairDeep);

    const isLong = P.style === 'long' || P.style === 'ponytail';
    const bottom = isLong ? FIG.chin - .6 : FIG.headY + 3.2;
    ctx.beginPath();
    ctx.moveTo(-8.8, bottom);
    ctx.bezierCurveTo(-9.6, FIG.top + 5, -5.6, FIG.top - 2.6, 0, FIG.top - 2.6);
    ctx.bezierCurveTo(5.6, FIG.top - 2.6, 9.6, FIG.top + 5, 8.8, bottom);
    ctx.quadraticCurveTo(0, bottom + 3.4, -8.8, bottom);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(18,14,14,.22)'; ctx.lineWidth = .7; ctx.stroke();

    const sway = Math.sin(P.time * .003) * .5;
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = .7; ctx.lineCap = 'round';
    [-1, 1].forEach(k => {
      ctx.beginPath();
      ctx.moveTo(k * 1.2, FIG.top + 7);
      ctx.quadraticCurveTo(k * 4.4 + sway, FIG.headY, k * 3.8, bottom - 2.4);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      ctx.beginPath();
      ctx.moveTo(k * 4.2, FIG.top + 9);
      ctx.quadraticCurveTo(k * 7 + sway, FIG.headY + 2, k * 6.4, bottom - 3.6);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.15)';
    });

    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath(); ctx.ellipse(-1.4, FIG.top + 5.2, 3.4, 2.2, -.3, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.26)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, FIG.top + 7.4, 6.6, Math.PI * 1.16, Math.PI * 1.44); ctx.stroke();
    ctx.restore();
  }

  /* 正面头骨 */
  drawSkull(ctx, P, hx) {
    const g = ctx.createLinearGradient(hx - 8, FIG.top, hx + 7, FIG.chin);
    g.addColorStop(0, P.skinHi);
    g.addColorStop(.5, P.skin);
    g.addColorStop(1, P.skinLo);

    ctx.beginPath();
    ctx.moveTo(hx, FIG.top + .4);
    ctx.bezierCurveTo(hx - 5.2, FIG.top + .4, hx - 8.2, FIG.top + 6.4, hx - 8.2, FIG.headY + 1);
    ctx.bezierCurveTo(hx - 8.2, FIG.chin + 1.4, hx - 5.4, FIG.chin + 2.4, hx - 2.9, FIG.chin + 1.2);
    ctx.quadraticCurveTo(hx - 1.4, FIG.chin - .4, hx, FIG.chin - .4);
    ctx.quadraticCurveTo(hx + 1.4, FIG.chin - .4, hx + 3.4, FIG.chin + 1);
    ctx.bezierCurveTo(hx + 5.4, FIG.chin + 2.4, hx + 8.2, FIG.chin + 1.4, hx + 8.2, FIG.headY + 1);
    ctx.bezierCurveTo(hx + 8.2, FIG.top + 6.4, hx + 5.2, FIG.top + .4, hx, FIG.top + .4);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(146,92,66,.22)'; ctx.lineWidth = .6; ctx.stroke();

    // 耳朵
    if (!P.back) {
      [-1, 1].forEach(s => {
        ctx.fillStyle = P.skin;
        ctx.beginPath(); ctx.ellipse(hx + s * 8.2, FIG.ear + 1.4, 1.5, 2.2, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(140,88,64,.24)'; ctx.lineWidth = .55;
        ctx.beginPath(); ctx.arc(hx + s * 8.2, FIG.ear + 1.4, .8, .6, Math.PI - .6); ctx.stroke();
      });
    }
  }

  /* 侧面头骨：额头 → 鼻梁 → 鼻尖 → 唇 → 下巴 → 下颌 → 后脑 */
  drawProfileSkull(ctx, P, hx) {
    ctx.save();
    ctx.translate(hx, 0);
    ctx.scale(P.side, 1);

    const g = ctx.createLinearGradient(-7, FIG.top, 8, FIG.chin);
    g.addColorStop(0, P.skinHi);
    g.addColorStop(.45, P.skin);
    g.addColorStop(1, P.skinLo);

    ctx.beginPath();
    ctx.moveTo(-2.4, FIG.top + .2);
    ctx.bezierCurveTo(3.8, FIG.top + .8, 6.6, FIG.top + 5, 6.9, FIG.top + 8.8);   // 额
    ctx.quadraticCurveTo(7.3, FIG.top + 10.8, 7.0, FIG.top + 12.6);                // 眉骨
    ctx.quadraticCurveTo(7.2, FIG.top + 13.8, 8.3, FIG.top + 16.4);                // 鼻梁
    ctx.quadraticCurveTo(8.9, FIG.top + 17.4, 8.2, FIG.top + 18.1);                // 鼻尖
    ctx.quadraticCurveTo(7.4, FIG.top + 18.6, 7.1, FIG.top + 19.4);                // 人中
    ctx.quadraticCurveTo(7.6, FIG.top + 20.4, 6.7, FIG.top + 20.9);                // 上唇
    ctx.quadraticCurveTo(6.6, FIG.top + 21.8, 5.2, FIG.top + 22.3);                // 下唇
    ctx.quadraticCurveTo(3.4, FIG.top + 23.2, 1.6, FIG.top + 22.8);                // 下巴
    ctx.quadraticCurveTo(-3.4, FIG.top + 21.6, -5.6, FIG.top + 16.4);              // 下颌角
    ctx.bezierCurveTo(-7.8, FIG.top + 11.8, -7.4, FIG.top + 4, -2.4, FIG.top + .2);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(146,92,66,.22)'; ctx.lineWidth = .6; ctx.stroke();

    // 耳朵
    ctx.fillStyle = P.skin;
    ctx.beginPath(); ctx.ellipse(-1.2, FIG.ear + 1.6, 1.8, 2.5, .14, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(140,88,64,.28)'; ctx.lineWidth = .6;
    ctx.beginPath(); ctx.arc(-1, FIG.ear + 1.6, 1, .5, Math.PI - .5); ctx.stroke();

    ctx.fillStyle = 'rgba(150,94,70,.09)';
    ctx.beginPath(); ctx.ellipse(2.6, FIG.ear + 7, 3.6, 2.2, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /* ---- 五官 ---- */
  drawFace(ctx, P, hx) {
    const eyeY = FIG.eye;
    const browY = FIG.brow;

    if (P.profile) {
      ctx.save();
      ctx.translate(hx, 0);
      ctx.scale(P.side, 1);
      this.drawEye(ctx, 5.2, eyeY + .4, .9, P);
      ctx.strokeStyle = P.hairLo; ctx.lineWidth = 1; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(2.4, browY + .6);
      ctx.quadraticCurveTo(4.2, browY - .6, 6.2, browY + .2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(168,92,80,.8)'; ctx.lineWidth = .9; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(4.6, FIG.mouth - .5);
      ctx.quadraticCurveTo(5.7, FIG.mouth + .3, 6.7, FIG.mouth - .6);
      ctx.stroke();
      this.drawBlush(ctx, 4.4, FIG.mouth + 1.6, .5);
      if (P.accessory === 'glasses') this.drawGlasses(ctx, 0, eyeY, 1, .92);
      ctx.restore();
      return;
    }

    const ex = 3.5;
    this.drawEye(ctx, hx - ex, eyeY, 1, P);
    this.drawEye(ctx, hx + ex, eyeY, 1, P);

    ctx.strokeStyle = P.hairLo; ctx.lineWidth = 1; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx - ex - 2, browY + .6);
    ctx.quadraticCurveTo(hx - ex, browY - .7, hx - ex + 2, browY);
    ctx.moveTo(hx + ex - 2, browY);
    ctx.quadraticCurveTo(hx + ex, browY - .7, hx + ex + 2, browY + .6);
    ctx.stroke();

    // 鼻
    ctx.fillStyle = 'rgba(160,102,78,.22)';
    ctx.beginPath(); ctx.ellipse(hx + .35, FIG.nose + .6, 1.2, .8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.26)';
    ctx.beginPath(); ctx.ellipse(hx + .2, FIG.nose - .2, .55, .38, 0, 0, TAU); ctx.fill();

    // 嘴
    ctx.strokeStyle = 'rgba(190,116,104,.8)'; ctx.lineWidth = .95; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx - 1.8, FIG.mouth);
    ctx.quadraticCurveTo(hx, FIG.mouth + 1.15, hx + 1.8, FIG.mouth);
    ctx.stroke();
    ctx.fillStyle = 'rgba(226,146,136,.22)';
    ctx.beginPath(); ctx.ellipse(hx, FIG.mouth + .3, 1.8, .75, 0, 0, TAU); ctx.fill();

    this.drawBlush(ctx, hx - 5.7, FIG.mouth + .6, .95);
    this.drawBlush(ctx, hx + 5.7, FIG.mouth + .6, .95);

    if (P.accessory === 'glasses') this.drawGlasses(ctx, hx, eyeY, ex, 1);
  }

  drawGlasses(ctx, hx, eyeY, ex, s) {
    ctx.strokeStyle = 'rgba(58,62,72,.66)'; ctx.lineWidth = .8;
    [-1, 1].forEach(k => {
      ctx.beginPath();
      ctx.ellipse(hx + k * ex, eyeY - .1, 2.12 * s, 1.94 * s, 0, 0, TAU);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(hx - ex + 2.12 * s, eyeY - .3);
    ctx.lineTo(hx + ex - 2.12 * s, eyeY - .3);
    ctx.stroke();
    ctx.fillStyle = 'rgba(198,224,240,.16)';
    [-1, 1].forEach(k => {
      ctx.beginPath();
      ctx.ellipse(hx + k * ex - .5, eyeY - 1, 1.05 * s, .85 * s, -.4, 0, TAU);
      ctx.fill();
    });
  }

  /* 单只眼 */
  drawEye(ctx, x, y, s, P) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, 1.82 * s, 2.12 * s, 0, 0, TAU);
    ctx.fillStyle = '#fdfaf3'; ctx.fill();

    const ig = ctx.createRadialGradient(x, y + .45 * s, .2, x, y + .25 * s, 2.05 * s);
    ig.addColorStop(0, '#6a7d92');
    ig.addColorStop(.62, '#3a4a53');
    ig.addColorStop(1, '#212a30');
    ctx.beginPath(); ctx.ellipse(x, y + .2 * s, 1.34 * s, 1.6 * s, 0, 0, TAU);
    ctx.fillStyle = ig; ctx.fill();

    ctx.fillStyle = '#11161a';
    ctx.beginPath(); ctx.ellipse(x, y + .26 * s, .68 * s, .9 * s, 0, 0, TAU); ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,.97)';
    ctx.beginPath(); ctx.ellipse(x - .58 * s, y - .68 * s, .6 * s, .7 * s, -.3, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.ellipse(x + .62 * s, y + .92 * s, .32 * s, .38 * s, 0, 0, TAU); ctx.fill();

    // 上眼睑（厚一点，才有精神）
    ctx.strokeStyle = '#2a2220'; ctx.lineWidth = 1.15 * s; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(x, y + .36 * s, 1.9 * s, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    ctx.strokeStyle = 'rgba(72,58,52,.3)'; ctx.lineWidth = .5 * s;
    ctx.beginPath(); ctx.arc(x, y - .3 * s, 1.78 * s, Math.PI * .22, Math.PI * .78); ctx.stroke();
    ctx.restore();
  }

  drawBlush(ctx, x, y, s) {
    const g = ctx.createRadialGradient(x, y, .2, x, y, 2.7 * s);
    g.addColorStop(0, 'rgba(240,140,130,.32)');
    g.addColorStop(1, 'rgba(240,140,130,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, 2.7 * s, 1.5 * s, 0, 0, TAU); ctx.fill();
  }

  /* ---- 前发：底层壳 + 三到四束发束 + 高光，避免"头盔"感 ---- */
  drawHairFront(ctx, P, hx) {
    const { style } = P;
    ctx.save();
    ctx.translate(hx, 0);

    const cap = () => {
      // 头发外壳：比头骨略大一圈，顶部略高
      ctx.beginPath();
      ctx.moveTo(-8.8, FIG.brow + 3.4);
      ctx.bezierCurveTo(-9, FIG.top + 4.6, -5, FIG.top - 2.2, 0, FIG.top - 2.2);
      ctx.bezierCurveTo(5, FIG.top - 2.2, 9, FIG.top + 4.6, 8.8, FIG.brow + 1.6);
      ctx.quadraticCurveTo(0, FIG.brow - 1.6, -8.8, FIG.brow + 1.6);
      ctx.closePath();
    };

    // 底色（最暗的一层，只在发束缝隙里露出来）
    const bg = ctx.createLinearGradient(-8, FIG.top, 4, FIG.brow);
    bg.addColorStop(0, P.hairLo);
    bg.addColorStop(.55, P.hairDeep);
    bg.addColorStop(1, P.hairDeep);
    cap();
    ctx.fillStyle = bg; ctx.fill();

    ctx.save();
    cap(); ctx.clip();

    // 发束：从发旋向四周铺开，颜色深浅交替
    const swirl = { x: -1.2, y: FIG.top + 4.2 };
    const tips = style === 'long'
      ? [[-7.4, FIG.brow + 1.2], [-3.8, FIG.brow - 1.1], [.2, FIG.brow + .2], [4.2, FIG.brow - 1.3], [7.6, FIG.brow + 1]]
      : style === 'messy'
        ? [[-7.6, FIG.brow + 1.4], [-4.4, FIG.brow - 1.6], [-.6, FIG.brow + 1], [3.4, FIG.brow - 1.8], [7.4, FIG.brow + .8]]
        : style === 'ponytail'
          ? [[-7.6, FIG.brow + 2], [-3.4, FIG.brow + 2.6], [1.2, FIG.brow + 1.2], [5.4, FIG.brow - .8], [8, FIG.brow + .8]]
          : [[-7.8, FIG.brow + 1.6], [-3.6, FIG.brow + .2], [1.4, FIG.brow + 1.4], [5.6, FIG.brow - .4], [8, FIG.brow + 1.2]];

    tips.forEach((t, i) => {
      const lift = i % 2 === 0 ? P.hairMid : P.hairHi;
      const gg = ctx.createLinearGradient(swirl.x, swirl.y, t[0], t[1]);
      gg.addColorStop(0, P.hairLo);
      gg.addColorStop(.45, lift);
      gg.addColorStop(1, P.hairMid);
      ctx.beginPath();
      ctx.moveTo(swirl.x, swirl.y - .6);
      // 沿头顶外扩到发梢
      const mx = (swirl.x + t[0]) * .5 + (t[0] > swirl.x ? 1.6 : -1.6);
      ctx.quadraticCurveTo(mx, (swirl.y + t[1]) * .5 - 2.2, t[0], t[1]);
      // 发梢收细，回到发旋
      const nx = t[0] + (t[0] > swirl.x ? -1.5 : 1.5);
      ctx.quadraticCurveTo(nx, t[1] - 2.6, swirl.x + (t[0] - swirl.x) * .34, swirl.y + (t[1] - swirl.y) * .34);
      ctx.closePath();
      ctx.fillStyle = gg; ctx.fill();
    });

    // 发束之间压一道暗缝
    ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.lineWidth = .55;
    tips.forEach(t => {
      ctx.beginPath();
      ctx.moveTo(swirl.x, swirl.y + .4);
      ctx.quadraticCurveTo((swirl.x + t[0]) * .55, (swirl.y + t[1]) * .55, t[0], t[1] - .4);
      ctx.stroke();
    });
    ctx.restore();

    // 外轮廓与高光
    cap();
    ctx.strokeStyle = 'rgba(18,14,14,.28)'; ctx.lineWidth = .7; ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(-1.4, FIG.top + 7.2, 6.6, Math.PI * 1.12, Math.PI * 1.42); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = .8;
    ctx.beginPath(); ctx.arc(2.2, FIG.top + 8.6, 4.6, Math.PI * 1.16, Math.PI * 1.44); ctx.stroke();

    // 鬓发：贴着脸侧垂下来
    if (style === 'long') {
      [-1, 1].forEach(s => {
        const g2 = ctx.createLinearGradient(s * 8, FIG.brow, s * 9.4, FIG.chest);
        g2.addColorStop(0, s < 0 ? P.hairMid : P.hair);
        g2.addColorStop(.55, P.hairLo);
        g2.addColorStop(1, P.hairDeep);
        ctx.beginPath();
        ctx.moveTo(s * 8.5, FIG.brow + 1.6);
        ctx.bezierCurveTo(s * 10.6, FIG.headY + 6, s * 10.4, FIG.chest + 4, s * 9, FIG.chest - 2);
        ctx.quadraticCurveTo(s * 8.2, FIG.chest - 6, s * 7.6, FIG.chest + 2);
        ctx.bezierCurveTo(s * 7.6, FIG.headY + 8, s * 7.4, FIG.brow + 7, s * 8.5, FIG.brow + 1.6);
        ctx.closePath();
        ctx.fillStyle = g2;
        ctx.fill();
        ctx.strokeStyle = 'rgba(18,14,14,.18)'; ctx.lineWidth = .55; ctx.stroke();
      });
    } else {
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s * 8.6, FIG.brow + 2.6);
        ctx.quadraticCurveTo(s * 9.4, FIG.headY + 3, s * 8.4, FIG.mouth - 1);
        ctx.quadraticCurveTo(s * 7.9, FIG.mouth + .6, s * 8, FIG.headY + 4);
        ctx.closePath();
        ctx.fillStyle = P.hairLo;
        ctx.fill();
      });
    }

    ctx.restore();
  }

  /* 侧脸时头顶那一层后发 */
  drawHairBackTop(ctx, P, hx) {
    ctx.save();
    ctx.translate(hx, 0);
    ctx.scale(P.side, 1);
    const g = ctx.createLinearGradient(-9, FIG.top, 3, FIG.brow + 8);
    g.addColorStop(0, P.hairDeep);
    g.addColorStop(.45, P.hair);
    g.addColorStop(1, P.hairMid);
    ctx.beginPath();
    ctx.moveTo(-8.2, FIG.brow + 5);
    ctx.bezierCurveTo(-9.6, FIG.top + 4, -5.6, FIG.top - 2.6, -.2, FIG.top - 2.6);
    ctx.bezierCurveTo(3.4, FIG.top - 2.4, 5.2, FIG.top + .6, 5.4, FIG.top + 3.2);
    ctx.quadraticCurveTo(2, FIG.top + 2, -.8, FIG.top + 4.4);
    ctx.quadraticCurveTo(-4.6, FIG.top + 7.6, -8.2, FIG.brow + 5);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(18,14,14,.24)'; ctx.lineWidth = .7; ctx.stroke();
    ctx.restore();
  }

  /* 侧脸刘海：只盖额头，前缘停在 x≈5，露出鼻子和嘴 */
  drawHairProfile(ctx, P, hx) {
    ctx.save();
    ctx.translate(hx, 0);
    ctx.scale(P.side, 1);
    const g = ctx.createLinearGradient(-6, FIG.top, 5, FIG.brow + 2);
    g.addColorStop(0, P.hairMid);
    g.addColorStop(.55, P.hair);
    g.addColorStop(1, P.hairLo);
    ctx.beginPath();
    ctx.moveTo(-8.4, FIG.top + 14);
    ctx.bezierCurveTo(-9.4, FIG.top + 4, -5.4, FIG.top - 2, -.2, FIG.top - 2);
    ctx.bezierCurveTo(3.6, FIG.top - 1.8, 5.6, FIG.top + 1.8, 5.7, FIG.top + 4.4);
    ctx.quadraticCurveTo(4.4, FIG.top + 6, 2.6, FIG.top + 7.2);
    ctx.quadraticCurveTo(-.4, FIG.top + 9, -3.2, FIG.top + 9.6);
    ctx.quadraticCurveTo(-6, FIG.top + 10.4, -8.4, FIG.top + 14);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(18,14,14,.26)'; ctx.lineWidth = .65; ctx.stroke();

    // 发丝
    ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = .5;
    ctx.beginPath();
    ctx.moveTo(-.6, FIG.top - .6);
    ctx.quadraticCurveTo(2.4, FIG.top + 4.6, 1.6, FIG.top + 9.6);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(-1.6, FIG.top + 6.4, 6.2, Math.PI * 1.1, Math.PI * 1.4); ctx.stroke();
    ctx.restore();
  }

  /* ---- 后发 ---- */
  drawHairBack(ctx, P) {
    const { style, dir, time } = P;
    const sway = Math.sin(time * .0032) * .7;
    const prof = dir === 'left' || dir === 'right';

    if (style === 'long') {
      const wf = prof ? .74 : 1;
      // 正面时头发在衣服底下，不能露出下摆；背面时才是披在衣服外面
      const endY = (P.dir === 'up') ? FIG.hem + 6.2 : FIG.hem - 1;
      const g = ctx.createLinearGradient(-10, FIG.top, 9, FIG.waist);
      g.addColorStop(0, P.hairHi);
      g.addColorStop(.35, P.hair);
      g.addColorStop(1, P.hairDeep);
      ctx.beginPath();
      ctx.moveTo(-8.4, FIG.headY - 2);
      ctx.bezierCurveTo(-10.8, FIG.top + 2, -6, FIG.top - 2.8, 0, FIG.top - 2.8);
      ctx.bezierCurveTo(6, FIG.top - 2.8, 10.8, FIG.top + 2, 8.4, FIG.headY - 2);
      ctx.quadraticCurveTo(11, FIG.chest + 2, 10 * wf, FIG.waist + 2);
      ctx.quadraticCurveTo(9.4 * wf, endY + 1, 7.4 * wf + sway, endY);
      ctx.quadraticCurveTo(3.4, endY + 1.8, 0, endY + 1.6);
      ctx.quadraticCurveTo(-3.4, endY + 1.8, -7.4 * wf + sway, endY);
      ctx.quadraticCurveTo(-9.4 * wf, endY + 1, -10 * wf, FIG.waist + 2);
      ctx.quadraticCurveTo(-11, FIG.chest + 2, -8.4, FIG.headY - 2);
      ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(18,14,14,.2)'; ctx.lineWidth = .7; ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = .7;
      [-1, 1].forEach(s => {
        ctx.beginPath();
        ctx.moveTo(s * 5.4, FIG.top + 7);
        ctx.quadraticCurveTo(s * 8.6, FIG.chest, s * 7.4, endY + 1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s * 7.6, FIG.top + 9);
        ctx.quadraticCurveTo(s * 10, FIG.chest + 6, s * 8.8, endY - 1);
        ctx.strokeStyle = 'rgba(255,255,255,.07)';
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.13)';
      });
      ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = .7;
      ctx.beginPath();
      ctx.moveTo(0, FIG.top + 5);
      ctx.quadraticCurveTo(1.2, FIG.chest, .4, endY);
      ctx.stroke();
    } else if (style === 'ponytail') {
      const tx = dir === 'left' ? -1 : 1;
      const g = ctx.createLinearGradient(4 * tx, FIG.top, 14 * tx, FIG.waist);
      g.addColorStop(0, P.hairHi);
      g.addColorStop(.38, P.hair);
      g.addColorStop(1, P.hairDeep);
      ctx.beginPath();
      ctx.moveTo(5, FIG.top + 4);
      ctx.bezierCurveTo((5 + 9) * tx, FIG.top + 9, (5 + 11) * tx + sway, FIG.chest + 2, (5 + 7) * tx + sway, FIG.waist + 1);
      ctx.quadraticCurveTo((5 + 2) * tx, FIG.hem + 2, (5 - 2.6) * tx, FIG.hip + 1);
      ctx.quadraticCurveTo((5 + 1) * tx, FIG.chest + 4, 2.8 * tx, FIG.top + 11);
      ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(18,14,14,.2)'; ctx.lineWidth = .6; ctx.stroke();

      const tg = ctx.createLinearGradient(4 * tx, FIG.top + 7, 8 * tx, FIG.top + 12);
      tg.addColorStop(0, '#f7e3b2'); tg.addColorStop(1, '#dfc084');
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.ellipse(5.4 * tx, FIG.top + 9.6, 2.3, 1.8, -.5 * tx, 0, TAU); ctx.fill();
    }
  }

  /* ---- 背包：只在背面出现 ---- */
  drawBackpack(ctx, P) {
    const g = ctx.createLinearGradient(-8, FIG.shoulder, 8, FIG.waist);
    g.addColorStop(0, P.clothLo);
    g.addColorStop(.42, this.tone(P.clothLo, -12));
    g.addColorStop(1, P.clothDeep);
    ctx.beginPath();
    ctx.moveTo(-7.6, FIG.shoulder + 4);
    ctx.quadraticCurveTo(-8.8, FIG.chest, -8, FIG.waist + 2.4);
    ctx.quadraticCurveTo(0, FIG.waist + 4.8, 8, FIG.waist + 2.4);
    ctx.quadraticCurveTo(8.8, FIG.chest, 7.6, FIG.shoulder + 4);
    ctx.quadraticCurveTo(0, FIG.shoulder + 1.4, -7.6, FIG.shoulder + 4);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(24,22,30,.26)'; ctx.lineWidth = .7; ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,.09)';
    roundedRect(ctx, -5.6, FIG.chest + 5, 11.2, 7.6, 2); ctx.fill();
    ctx.strokeStyle = 'rgba(24,22,30,.2)'; ctx.lineWidth = .55;
    roundedRect(ctx, -5.6, FIG.chest + 5, 11.2, 7.6, 2); ctx.stroke();

    ctx.strokeStyle = P.clothDeep; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    [-1, 1].forEach(s => {
      ctx.beginPath();
      ctx.moveTo(s * 6.2, FIG.shoulder + 1);
      ctx.quadraticCurveTo(s * 9, FIG.chest, s * 7.8, FIG.waist + 1);
      ctx.stroke();
    });
  }



  render(player, character, time = 0) {
    this.time = time;
    this.updateCamera(player);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save(); ctx.translate(-this.camera.x, -this.camera.y);
    this.drawGround(ctx);
    this.drawLake(ctx);
    FLOWERS.forEach(([x,y], i) => this.drawFlowerbed(ctx, x, y, i));
    BENCHES.forEach(([x,y,v]) => this.drawBench(ctx, x, y, v));
    LAMPS.forEach(([x,y]) => this.drawLamp(ctx, x, y));
    // Sort major objects by base y for believable occlusion
    const objects = [];
    TREE_POSITIONS.forEach(([x,y], i) => objects.push({ y, draw: () => this.drawTree(ctx, x, y, i) }));
    BUILDINGS.forEach(b => objects.push({ y: b.y + b.h, draw: () => this.drawBuilding(ctx, b) }));
    NPCS.forEach(n => {
      // 主动找上门来的 NPC 画在它当下的位置，而不是出生点
      const live = this.npcPositions && this.npcPositions[n.id];
      const person = live ? { ...n, x: live.x, y: live.y, moving: live.moving, facing: live.facing } : n;
      objects.push({ y: person.y, draw: () => this.drawPerson(ctx, person, false, time) });
    });
    objects.push({ y: 850, draw: () => this.drawFountain(ctx) });
    objects.push({ y: player.y, draw: () => this.drawPerson(ctx, { ...player, ...character }, true, time) });
    objects.sort((a,b) => a.y - b.y).forEach(item => item.draw());
    // Door markers
    BUILDINGS.forEach(b => {
      const active = this.nearby && this.nearby.id === b.id;
      const pulse = 1 + Math.sin(time * .005) * .12;
      ctx.strokeStyle = active ? '#fff4a8' : 'rgba(255,248,199,.7)'; ctx.lineWidth = active ? 4 : 2;
      ctx.beginPath(); ctx.ellipse(b.doorX, b.doorY + 13, 23 * pulse, 10 * pulse, 0, 0, TAU); ctx.stroke();
      if (active) {
        ctx.fillStyle = 'rgba(43,63,54,.88)'; roundedRect(ctx, b.doorX - 68, b.doorY - 40, 136, 28, 14); ctx.fill();
        text(ctx, `进入${b.name}`, b.doorX, b.doorY - 26, 13, '#fff8df', 'center', 'bold');
      }
    });
    this.drawRequestMarkers(ctx, time);
    ctx.restore();
    this.drawVignette(ctx);
  }

  /* 有请求找上门的 NPC，头顶冒一个感叹号 */
  drawRequestMarkers(ctx, time) {
    Object.keys(this.requestNpcs || {}).forEach(id => {
      const npc = NPCS.find(n => n.id === id);
      if (!npc) return;
      const live = this.npcPositions && this.npcPositions[id];
      const x = live ? live.x : npc.x;
      const y = live ? live.y : npc.y;
      const bob = Math.sin(time * .005) * 4;
      ctx.save();
      ctx.fillStyle = '#f7d774';
      ctx.beginPath(); ctx.arc(x, y - 178 + bob, 15, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(120,88,32,.5)'; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, '!', x, y - 178 + bob + 6, 18, '#6b5631', 'center', 'bold');
      ctx.restore();
    });
  }

  drawVignette(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, 'rgba(255,250,224,.08)');
    gradient.addColorStop(.7, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, 'rgba(37,68,56,.08)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, this.width, this.height);
  }
}

// ============ 场景插画背景 ============
// 进入每个场景时，在剧情面板顶部绘制一幅该场景的插画风背景
function drawSceneArt(ctx, w, h, art, time = 0) {
  const [c1, c2] = art.sky || ['#2c3a52', '#5b6b8c'];
  const glow = art.glow || '#f5d98a';
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // 星星
  ctx.fillStyle = 'rgba(255,255,255,.5)';
  for (let i = 0; i < 24; i++) {
    const sx = (i * 137.5) % w, sy = (i * 61.8) % (h * .55);
    const tw = .4 + Math.abs(Math.sin(time * .002 + i)) * .6;
    ctx.globalAlpha = tw * .8;
    ctx.fillRect(sx, sy, 2, 2);
  }
  ctx.globalAlpha = 1;
  // 月亮 / 主光源
  const moonG = ctx.createRadialGradient(w * .78, h * .3, 4, w * .78, h * .3, 60);
  moonG.addColorStop(0, glow); moonG.addColorStop(.35, glow + 'cc'); moonG.addColorStop(1, 'transparent');
  ctx.fillStyle = moonG; ctx.beginPath(); ctx.arc(w * .78, h * .3, 60, 0, TAU); ctx.fill();
  ellipse(ctx, w * .78, h * .3, 20, 20, glow);

  const horizon = h * .72;
  const motif = art.motif;
  ctx.save();

  if (motif === 'library') {
    // 书架剪影
    for (let i = 0; i < 4; i++) {
      const bx = w * .06 + i * w * .24;
      ctx.fillStyle = 'rgba(20,26,40,.85)'; ctx.fillRect(bx, horizon - h * .42, w * .18, h * .42);
      for (let r = 0; r < 4; r++) {
        ctx.fillStyle = 'rgba(60,70,95,.9)'; ctx.fillRect(bx + 4, horizon - h * .42 + 8 + r * (h * .1), w * .18 - 8, 3);
        for (let b = 0; b < 6; b++) {
          ctx.fillStyle = ['#c9a25e', '#8a6f9e', '#6e87a6', '#a87988'][(i + r + b) % 4];
          ctx.globalAlpha = .85; ctx.fillRect(bx + 6 + b * (w * .024), horizon - h * .42 + 10 + r * (h * .1), w * .014, h * .085); ctx.globalAlpha = 1;
        }
      }
    }
    // 窗户透光
    ctx.fillStyle = glow + '55'; roundedRect(ctx, w * .4, h * .12, w * .2, h * .3, 8); ctx.fill();
    ctx.strokeStyle = glow; ctx.lineWidth = 2; ctx.strokeRect(w * .4, h * .12, w * .3, 0 + h * .3);
    ctx.beginPath(); ctx.moveTo(w * .55, h * .12); ctx.lineTo(w * .4, h * .42); ctx.stroke();
  } else if (motif === 'classroom') {
    // 黑板与讲台
    ctx.fillStyle = 'rgba(18,30,34,.9)'; roundedRect(ctx, w * .2, h * .14, w * .6, h * .36, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(245,233,176,.35)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(w * .28, h * .24); ctx.lineTo(w * .6, h * .24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * .28, h * .32); ctx.lineTo(w * .52, h * .32); ctx.stroke();
    // 几何图形
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.arc(w * .68, h * .32, 14, 0, TAU); ctx.stroke();
    // 课桌剪影
    ctx.fillStyle = 'rgba(20,26,40,.9)';
    for (let i = 0; i < 3; i++) { const dx = w * .14 + i * w * .3; ctx.fillRect(dx, horizon - 26, w * .2, 8); ctx.fillRect(dx + 4, horizon - 18, 5, 26); ctx.fillRect(dx + w * .2 - 8, horizon - 18, 5, 26); }
    // 粉笔灰光束
    const beam = ctx.createLinearGradient(w * .8, 0, w * .3, h); beam.addColorStop(0, glow + '30'); beam.addColorStop(1, 'transparent');
    ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(w * .72, 0); ctx.lineTo(w * .92, 0); ctx.lineTo(w * .45, h); ctx.lineTo(w * .2, h); ctx.closePath(); ctx.fill();
  } else if (motif === 'lab') {
    // 实验台
    ctx.fillStyle = 'rgba(16,30,36,.9)'; ctx.fillRect(0, horizon - 14, w, 14);
    // 烧瓶
    const flasks = [[w * .25, 16, '#7fe0c3'], [w * .5, 22, '#9fd8ff'], [w * .75, 14, '#e8b7ff']];
    flasks.forEach(([fx, size, color], fi) => {
      ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fx - size * .3, horizon - 14 - size * 2.2); ctx.lineTo(fx - size * .3, horizon - 14 - size * 1.2);
      ctx.quadraticCurveTo(fx - size, horizon - 16, fx, horizon - 14);
      ctx.quadraticCurveTo(fx + size, horizon - 16, fx + size * .3, horizon - 14 - size * 1.2);
      ctx.lineTo(fx + size * .3, horizon - 14 - size * 2.2); ctx.stroke();
      ctx.fillStyle = color + '66'; ctx.beginPath(); ctx.moveTo(fx - size * .62, horizon - 14 - size * .5); ctx.quadraticCurveTo(fx, horizon - 12, fx + size * .62, horizon - 14 - size * .5); ctx.lineTo(fx + size * .3, horizon - 14 - size * 1.2); ctx.lineTo(fx - size * .3, horizon - 14 - size * 1.2); ctx.closePath(); ctx.fill();
      // 气泡
      for (let b = 0; b < 3; b++) { const bubY = horizon - 20 - ((time * .02 + b * 20 + fi * 13) % (size * 1.4)); ellipse(ctx, fx + (b - 1) * size * .3, bubY, 2.4, 2.4, color + 'aa'); }
    });
    // 顶部试管架
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(w * .1, h * .18, w * .8, 4);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = ['#7fe0c3', '#9fd8ff', '#ffd9a0'][i % 3] + '88'; ctx.fillRect(w * .14 + i * w * .12, h * .18 + 4, 5, 22); }
  } else if (motif === 'canteen') {
    // 遮阳棚条纹
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? 'rgba(255,217,160,.9)' : 'rgba(176,106,78,.9)'; ctx.beginPath(); ctx.moveTo(i * w / 8, 0); ctx.lineTo((i + 1) * w / 8, 0); ctx.lineTo((i + 1) * w / 8 - w / 32, h * .2); ctx.quadraticCurveTo(i * w / 8 + w / 16 - w / 32, h * .24, i * w / 8 - w / 32, h * .2); ctx.closePath(); ctx.fill(); }
    // 餐台
    ctx.fillStyle = 'rgba(30,22,20,.92)'; ctx.fillRect(0, horizon - 10, w, 12);
    // 三碗热腾腾的食物
    [[w * .25, '#e8a25e'], [w * .5, '#d97f5e'], [w * .75, '#c96a4e']].forEach(([bx, color], bi) => {
      ellipse(ctx, bx, horizon - 12, 26, 9, '#f5efe2');
      ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(bx, horizon - 15, 22, 7, 0, Math.PI, TAU); ctx.fill();
      // 蒸汽
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2;
      for (let s = 0; s < 2; s++) { const off = Math.sin(time * .002 + s * 2 + bi) * 3; ctx.beginPath(); ctx.moveTo(bx - 6 + s * 12 + off, horizon - 26); ctx.quadraticCurveTo(bx - 10 + s * 12 + off, horizon - 38, bx - 4 + s * 12 + off, horizon - 50); ctx.stroke(); }
    });
    // 吊灯
    for (let i = 0; i < 3; i++) { const lx = w * .25 + i * w * .25; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, h * .18); ctx.stroke(); const lg = ctx.createRadialGradient(lx, h * .2, 2, lx, h * .2, 26); lg.addColorStop(0, glow); lg.addColorStop(1, 'transparent'); ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, h * .2, 26, 0, TAU); ctx.fill(); ellipse(ctx, lx, h * .2, 8, 6, glow); }
  } else if (motif === 'dorm') {
    // 双层床剪影
    ctx.fillStyle = 'rgba(24,20,34,.92)';
    ctx.fillRect(w * .1, horizon - h * .34, 6, h * .34); ctx.fillRect(w * .42, horizon - h * .34, 6, h * .34);
    ctx.fillRect(w * .08, horizon - h * .34, w * .36, 8); ctx.fillRect(w * .08, horizon - h * .12, w * .36, 8);
    // 床品
    ctx.fillStyle = '#7d6a8f'; roundedRect(ctx, w * .1, horizon - h * .34 + 8, w * .32, 14, 4); ctx.fill();
    ctx.fillStyle = '#a87988'; roundedRect(ctx, w * .1, horizon - h * .12 + 8, w * .32, 12, 4); ctx.fill();
    // 串灯
    ctx.strokeStyle = 'rgba(255,220,168,.4)'; ctx.beginPath(); ctx.moveTo(0, h * .12); ctx.quadraticCurveTo(w * .5, h * .28, w, h * .1); ctx.stroke();
    for (let i = 0; i < 9; i++) { const t = i / 8; const lx = t * w; const ly = h * .12 + Math.sin(t * Math.PI) * h * .13; const flicker = .6 + Math.sin(time * .004 + i * 1.7) * .4; const lg = ctx.createRadialGradient(lx, ly, 1, lx, ly, 12); lg.addColorStop(0, glow); lg.addColorStop(1, 'transparent'); ctx.globalAlpha = flicker; ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 12, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; ellipse(ctx, lx, ly, 3, 4, glow); }
    // 窗与月光
    ctx.fillStyle = 'rgba(255,255,255,.1)'; roundedRect(ctx, w * .62, h * .16, w * .24, h * .34, 6); ctx.fill();
    ellipse(ctx, w * .74, h * .28, 13, 13, glow);
    ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 2; ctx.strokeRect(w * .62, h * .16, w * .24, h * .34);
    ctx.beginPath(); ctx.moveTo(w * .74, h * .16); ctx.lineTo(w * .74, h * .5); ctx.moveTo(w * .62, h * .33); ctx.lineTo(w * .86, h * .33); ctx.stroke();
    // 桌上台灯
    ctx.fillStyle = 'rgba(24,20,34,.92)'; ctx.fillRect(w * .56, horizon - 30, w * .14, 8);
    const lampG = ctx.createRadialGradient(w * .66, horizon - 34, 2, w * .66, horizon - 34, 34); lampG.addColorStop(0, glow); lampG.addColorStop(1, 'transparent'); ctx.fillStyle = lampG; ctx.beginPath(); ctx.arc(w * .66, horizon - 34, 34, 0, TAU); ctx.fill();
    ctx.fillStyle = glow; ctx.beginPath(); ctx.moveTo(w * .62, horizon - 30); ctx.lineTo(w * .7, horizon - 30); ctx.lineTo(w * .67, horizon - 46); ctx.lineTo(w * .65, horizon - 46); ctx.closePath(); ctx.fill();
  } else if (motif === 'gym') {
    // 跑道
    for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? 'rgba(200,90,70,.85)' : 'rgba(178,80,62,.9)'; ctx.fillRect(0, horizon - 12 + i * 12, w, 12); }
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.setLineDash([14, 10]);
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, horizon - 12 + i * 12); ctx.lineTo(w, horizon - 12 + i * 12); ctx.stroke(); }
    ctx.setLineDash([]);
    // 看台
    ctx.fillStyle = 'rgba(20,32,28,.85)';
    for (let i = 0; i < 3; i++) ctx.fillRect(0, h * .2 + i * 14, w * .55, 10);
    // 篮球架
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * .82, horizon - 14); ctx.lineTo(w * .82, h * .26); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(w * .78, h * .22, w * .08, h * .1);
    ctx.strokeStyle = '#e8863e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(w * .82, h * .35, 12, 4, 0, 0, TAU); ctx.stroke();
    // 跃动的球
    const ballY = h * .3 + Math.abs(Math.sin(time * .003)) * 20;
    ellipse(ctx, w * .7, ballY, 9, 9, '#e8863e');
    ctx.strokeStyle = 'rgba(60,30,20,.6)'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(w * .7 - 9, ballY); ctx.lineTo(w * .7 + 9, ballY); ctx.moveTo(w * .7, ballY - 9); ctx.lineTo(w * .7, ballY + 9); ctx.stroke();
  } else if (motif === 'club') {
    // 舞台聚光灯
    [[w * .25, '#ffd9f0'], [w * .5, '#e0d0ff'], [w * .75, '#d0ecff']].forEach(([lx, color], i) => {
      const sway = Math.sin(time * .0015 + i * 2) * w * .06;
      const beam = ctx.createLinearGradient(lx, 0, lx + sway, h); beam.addColorStop(0, color + '55'); beam.addColorStop(1, 'transparent');
      ctx.fillStyle = beam; ctx.beginPath(); ctx.moveTo(lx - 8, 0); ctx.lineTo(lx + 8, 0); ctx.lineTo(lx + sway + 50, h * .85); ctx.lineTo(lx + sway - 50, h * .85); ctx.closePath(); ctx.fill();
      ellipse(ctx, lx + sway, h * .82, 40, 8, color + '44');
    });
    // 舞台
    ctx.fillStyle = 'rgba(24,18,34,.95)'; ctx.fillRect(0, horizon - 8, w, 10);
    // 麦克风架
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(w * .5, horizon - 8); ctx.lineTo(w * .5, h * .42); ctx.stroke();
    ellipse(ctx, w * .5, h * .4, 6, 8, '#d0d4e0');
    // 音符
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < 5; i++) {
      const nx = w * .15 + i * w * .16, ny = h * .2 + ((time * .015 + i * 30) % (h * .3));
      const alpha = 1 - ((time * .015 + i * 30) % (h * .3)) / (h * .3);
      ctx.globalAlpha = Math.max(0, alpha);
      ellipse(ctx, nx, ny, 4, 3, '#fff'); ctx.fillRect(nx + 3, ny - 12, 2, 12); ctx.fillRect(nx + 3, ny - 12, 7, 3);
    }
    ctx.globalAlpha = 1;
    // 侧幕
    ctx.fillStyle = 'rgba(40,20,50,.9)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(w * .1, h * .5, 0, h); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(w, 0); ctx.quadraticCurveTo(w * .9, h * .5, w, h); ctx.closePath(); ctx.fill();
  } else { // lake
    // 夜空渐变已铺；画湖面
    const lakeG = ctx.createLinearGradient(0, horizon - 30, 0, h);
    lakeG.addColorStop(0, '#3d6a78'); lakeG.addColorStop(1, '#1f3a4a');
    ctx.fillStyle = lakeG; ctx.fillRect(0, horizon - 14, w, h - horizon + 14);
    // 月亮倒影
    const refG = ctx.createLinearGradient(0, horizon - 14, 0, h); refG.addColorStop(0, glow + '88'); refG.addColorStop(1, 'transparent');
    ctx.fillStyle = refG; ctx.beginPath(); ctx.moveTo(w * .74, horizon - 14); ctx.lineTo(w * .82, horizon - 14); ctx.lineTo(w * .86, h); ctx.lineTo(w * .7, h); ctx.closePath(); ctx.fill();
    // 波纹
    ctx.strokeStyle = 'rgba(223,245,240,.35)'; ctx.lineWidth = 1.6;
    for (let i = 0; i < 6; i++) { const wy = horizon + i * 9; const off = Math.sin(time * .0015 + i) * 10; ctx.beginPath(); ctx.moveTo(w * .1 + off, wy); ctx.quadraticCurveTo(w * .3 + off, wy - 4, w * .5 + off, wy); ctx.stroke(); }
    // 垂柳
    ctx.strokeStyle = 'rgba(60,90,80,.9)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(w * .12, horizon - 14); ctx.quadraticCurveTo(w * .13, h * .3, w * .18, h * .18); ctx.stroke();
    ctx.strokeStyle = 'rgba(90,140,110,.7)'; ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) { const sway = Math.sin(time * .0012 + i) * 4; ctx.beginPath(); ctx.moveTo(w * .18 + i * 6, h * .18 + i * 2); ctx.quadraticCurveTo(w * .16 + i * 6 + sway, h * .4, w * .17 + i * 6 + sway, horizon - 20); ctx.stroke(); }
    // 萤火虫
    for (let i = 0; i < 7; i++) { const fx = (i * 173.3 + time * .02) % w; const fy = h * .3 + Math.sin(time * .002 + i * 2) * h * .2; const fl = .4 + Math.abs(Math.sin(time * .005 + i * 3)) * .6; ctx.globalAlpha = fl; ellipse(ctx, fx, fy, 2.4, 2.4, glow); ctx.globalAlpha = 1; }
  }

  ctx.restore();
  // 地面剪影
  ctx.fillStyle = 'rgba(10,14,20,.55)';
  ctx.beginPath(); ctx.moveTo(0, horizon); ctx.quadraticCurveTo(w * .5, horizon - 16, w, horizon); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fill();
  // 底部渐隐方便文字过渡
  const fade = ctx.createLinearGradient(0, h * .75, 0, h);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(20,20,26,.5)');
  ctx.fillStyle = fade; ctx.fillRect(0, h * .75, w, h * .25);
}

module.exports = { CampusRenderer, drawSceneArt, preloadStandees };
