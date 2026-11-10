const { BUILDINGS, NPCS } = require('../data/content');

class CampusWorld {
  constructor() {
    this.player = { x: 1370, y: 1020, facing: 'down', moving: false };
    this.input = { x: 0, y: 0 };
    this.keys = {};
    this.target = null;
    this.nearby = null;
    this.visitors = {};   // 主动找上门来的 NPC：id -> { x, y, npc, state }
  }

  setInput(x, y) { this.input.x = x; this.input.y = y; this.target = null; }
  setKey(key, pressed) { this.keys[key] = pressed; }
  setTarget(x, y) { this.target = { x, y }; }

  // 让 NPC 离开原来的位置，过来找你
  sendNpc(npcId) {
    const npc = NPCS.find(n => n.id === npcId);
    if (!npc) return null;
    const visitor = this.visitors[npcId];
    if (visitor) { visitor.state = 'approach'; return visitor; }
    const created = { x: npc.x, y: npc.y, npc, state: 'approach' };
    this.visitors[npcId] = created;
    return created;
  }

  // 事办完了，送回原来的位置
  dismissNpc(npcId) {
    const visitor = this.visitors[npcId];
    if (visitor) visitor.state = 'leave';
  }

  // NPC 的实时位置（给渲染器用）
  visitorPositions() {
    const map = {};
    Object.keys(this.visitors).forEach(id => {
      map[id] = { x: this.visitors[id].x, y: this.visitors[id].y };
    });
    return map;
  }

  updateVisitors(delta) {
    const speed = 155 * Math.min(delta, 40) / 1000;
    Object.keys(this.visitors).forEach(id => {
      const v = this.visitors[id];
      const target = v.state === 'approach' ? this.player : { x: v.npc.x, y: v.npc.y };
      const dx = target.x - v.x;
      const dy = target.y - v.y;
      const distance = Math.hypot(dx, dy);
      const stopAt = v.state === 'approach' ? 74 : 6;
      if (distance > stopAt) {
        const nextX = v.x + dx / distance * speed;
        const nextY = v.y + dy / distance * speed;
        if (!this.collides(nextX, v.y)) v.x = nextX;
        if (!this.collides(v.x, nextY)) v.y = nextY;
        v.moving = true;
        v.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      } else {
        v.moving = false;
        if (v.state === 'leave') delete this.visitors[id];
      }
    });
  }

  collides(x, y) {
    if (x < 35 || y < 55 || x > 2365 || y > 1550) return true;
    return BUILDINGS.some(b => x > b.x - 20 && x < b.x + b.w + 20 && y > b.y - 25 && y < b.y + b.h + 12);
  }

  update(delta) {
    this.updateVisitors(delta);
    let x = this.input.x;
    let y = this.input.y;
    if (this.keys.ArrowLeft || this.keys.a) x -= 1;
    if (this.keys.ArrowRight || this.keys.d) x += 1;
    if (this.keys.ArrowUp || this.keys.w) y -= 1;
    if (this.keys.ArrowDown || this.keys.s) y += 1;
    if (this.target) {
      const dx = this.target.x - this.player.x;
      const dy = this.target.y - this.player.y;
      const distance = Math.hypot(dx, dy);
      if (distance < 10) this.target = null;
      else { x = dx / distance; y = dy / distance; }
    }
    const length = Math.hypot(x, y);
    this.player.moving = length > .08;
    if (length > 0) {
      x /= Math.max(1, length); y /= Math.max(1, length);
      const speed = 220 * Math.min(delta, 40) / 1000;
      const nextX = this.player.x + x * speed;
      const nextY = this.player.y + y * speed;
      if (!this.collides(nextX, this.player.y)) this.player.x = nextX;
      if (!this.collides(this.player.x, nextY)) this.player.y = nextY;
      /* 朝向带滞后：斜向走时 x/y 分量几乎相等，若无脑取绝对值大的那个，
         立绘会在正面和侧面之间每帧横跳。只有明显偏向某轴才换向。 */
      const ax = Math.abs(x), ay = Math.abs(y);
      if (ax > ay * 1.18) this.player.facing = x > 0 ? 'right' : 'left';
      else if (ay > ax * 1.18) this.player.facing = y > 0 ? 'down' : 'up';
    }
    this.nearby = this.findNearby();
    return this.nearby;
  }

  findNearby() {
    const p = this.player;
    let nearest = null;
    let min = 110;
    BUILDINGS.forEach(b => {
      const distance = Math.hypot(p.x - b.doorX, p.y - b.doorY);
      if (distance < min) { min = distance; nearest = { type: 'building', id: b.id, name: b.name, event: b.event, x: b.doorX, y: b.doorY }; }
    });
    NPCS.forEach(n => {
      const visitor = this.visitors[n.id];
      const nx = visitor ? visitor.x : n.x;
      const ny = visitor ? visitor.y : n.y;
      const distance = Math.hypot(p.x - nx, p.y - ny);
      if (distance < Math.min(min, 82)) { min = distance; nearest = { type: 'npc', id: n.id, name: n.name, event: n.event, x: nx, y: ny }; }
    });
    return nearest;
  }
}

module.exports = { CampusWorld };
