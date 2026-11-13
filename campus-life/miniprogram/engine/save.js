/* 周目存档（meta save）
 *
 * 这里存的不是「这一局的进度」，而是「跨周目留下来的一件事」：
 *   - 玩过几周目、上一局是什么结局、四年最好成绩
 *   - 上一局的最高属性（决定下一周目能继承哪些遗物）
 *   - 已经解锁过的隐藏事件
 *   - 上一局最后几个选择的摘要（因果面板的「上一周目回声」）
 *
 * 浏览器用 localStorage，小程序用 wx storage，单元测试可以注入自己的 store。
 */
const { LEGACY_OPTIONS, HIDDEN_EVENTS } = require('../data/content');

const META_KEY = 'qingwu-meta-v1';
const STAT_KEYS = ['knowledge', 'fitness', 'mood', 'social', 'practice'];
const TOTAL_HIDDEN = Object.keys(HIDDEN_EVENTS).reduce((sum, scene) => sum + HIDDEN_EVENTS[scene].length, 0);

let memoryStore = {};

function memoryBackend() {
  return {
    type: 'memory',
    get: key => (key in memoryStore ? memoryStore[key] : null),
    set: (key, value) => { memoryStore[key] = value; },
    remove: key => { delete memoryStore[key]; }
  };
}

function wxBackend() {
  return {
    type: 'wx',
    get: key => { try { return wx.getStorageSync(key) || null; } catch (error) { return null; } },
    set: (key, value) => { try { wx.setStorageSync(key, value); } catch (error) { /* 存不下就算了 */ } },
    remove: key => { try { wx.removeStorageSync(key); } catch (error) { /* ignore */ } }
  };
}

function localBackend() {
  return {
    type: 'local',
    get: key => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (error) { return null; }
    },
    set: (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* ignore */ } },
    remove: key => { try { localStorage.removeItem(key); } catch (error) { /* ignore */ } }
  };
}

function detectBackend() {
  if (typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function') return wxBackend();
  if (typeof localStorage !== 'undefined' && localStorage && typeof localStorage.getItem === 'function') return localBackend();
  return memoryBackend();
}

function backend(store) { return store || detectBackend(); }

function emptyMeta() {
  return {
    version: 1,
    playthroughs: 0,                 // 已经走完的周目数
    runs: 0,                        // 开局次数（含没走完的）
    bestScore: 0,
    bestStats: { knowledge: 0, fitness: 0, mood: 0, social: 0, practice: 0 },
    endings: [],                    // 见过的结局 id
    hiddenEvents: [],               // 解锁过的隐藏事件 id
    lastEnding: null,               // { id, title, tag, score }
    lastLegacy: null,               // 上一次继承的遗物 id
    lastCharacter: null,
    lastChoiceLog: [],              // 上一局最后几个选择，给因果面板做回声
    updatedAt: 0
  };
}

function normalize(raw) {
  const meta = emptyMeta();
  if (!raw || typeof raw !== 'object') return meta;
  meta.version = Number(raw.version) || 1;
  meta.playthroughs = Number(raw.playthroughs) || 0;
  meta.runs = Number(raw.runs) || 0;
  meta.bestScore = Number(raw.bestScore) || 0;
  STAT_KEYS.forEach(key => {
    const value = raw.bestStats ? Number(raw.bestStats[key]) : 0;
    meta.bestStats[key] = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  });
  meta.endings = Array.isArray(raw.endings) ? raw.endings.filter(id => typeof id === 'string') : [];
  meta.hiddenEvents = Array.isArray(raw.hiddenEvents) ? raw.hiddenEvents.filter(id => typeof id === 'string') : [];
  meta.lastEnding = raw.lastEnding && typeof raw.lastEnding === 'object' ? raw.lastEnding : null;
  meta.lastLegacy = typeof raw.lastLegacy === 'string' ? raw.lastLegacy : null;
  meta.lastCharacter = typeof raw.lastCharacter === 'string' ? raw.lastCharacter : null;
  meta.lastChoiceLog = Array.isArray(raw.lastChoiceLog) ? raw.lastChoiceLog.slice(-8) : [];
  meta.updatedAt = Number(raw.updatedAt) || 0;
  return meta;
}

function readMeta(store) {
  let raw = null;
  try { raw = backend(store).get(META_KEY); } catch (error) { raw = null; }
  return normalize(raw);
}

function writeMeta(meta, store) {
  const next = normalize(meta);
  next.updatedAt = Date.now();
  try { backend(store).set(META_KEY, next); } catch (error) { /* ignore */ }
  return next;
}

function clearMeta(store) {
  try { backend(store).remove(META_KEY); } catch (error) { /* ignore */ }
  memoryStore = {};
}

// 一局走完（不论结局好坏）就把这一局的成绩并进存档
function recordRun(core, store) {
  const meta = readMeta(store);
  meta.playthroughs += 1;
  meta.runs += 1;
  if (core.ending) {
    meta.lastEnding = {
      id: core.ending.id, title: core.ending.title, tag: core.ending.tag, score: core.ending.score
    };
    meta.bestScore = Math.max(meta.bestScore, core.ending.score || 0);
    if (core.ending.id && !meta.endings.includes(core.ending.id)) meta.endings.push(core.ending.id);
  }
  STAT_KEYS.forEach(key => {
    meta.bestStats[key] = Math.max(meta.bestStats[key] || 0, core.stats[key] || 0);
  });
  (core.hiddenCleared || []).forEach(id => {
    if (!meta.hiddenEvents.includes(id)) meta.hiddenEvents.push(id);
  });
  if (core.legacyId) meta.lastLegacy = core.legacyId;
  if (core.character) meta.lastCharacter = core.character.id;
  meta.lastChoiceLog = (core.choiceLog || []).slice(-6).map(entry => ({
    at: entry.at, title: entry.title, choice: entry.choice, type: entry.type
  }));
  return writeMeta(meta, store);
}

// 上一周目的成绩够不够格继承这一项
function isUnlocked(option, meta) {
  const unlock = option.unlock || {};
  if (unlock.playthrough && (meta.playthroughs || 0) < unlock.playthrough) return false;
  if (unlock.stat && (meta.bestStats[unlock.stat] || 0) < unlock.at) return false;
  return true;
}

// 继承选择 UI 要的列表：每项都带上「能不能选」和「为什么不能选」
function legacyOptions(meta) {
  return LEGACY_OPTIONS.map(option => {
    const unlocked = isUnlocked(option, meta);
    const best = option.unlock && option.unlock.stat ? meta.bestStats[option.unlock.stat] || 0 : null;
    return {
      ...option,
      unlocked,
      best,
      progressText: unlocked ? option.unlockText : `${option.unlockText}（当前 ${best === null ? 0 : best}）`
    };
  });
}

// 默认选中：上一局继承过的那件还在，就继续；否则选第一件能用的
function defaultLegacy(meta) {
  const options = legacyOptions(meta).filter(option => option.unlocked);
  if (!options.length) return null;
  if (meta.lastLegacy && options.some(option => option.id === meta.lastLegacy)) return meta.lastLegacy;
  return options[0].id;
}

function summary(meta) {
  return {
    playthroughs: meta.playthroughs || 0,
    bestScore: meta.bestScore || 0,
    endings: meta.endings.slice(),
    endingCount: meta.endings.length,
    hiddenCleared: meta.hiddenEvents.slice(),
    hiddenTotal: TOTAL_HIDDEN,
    lastEnding: meta.lastEnding,
    lastLegacy: meta.lastLegacy,
    lastChoiceLog: meta.lastChoiceLog.slice()
  };
}

module.exports = {
  META_KEY, TOTAL_HIDDEN, STAT_KEYS,
  emptyMeta, normalize, readMeta, writeMeta, clearMeta, recordRun,
  isUnlocked, legacyOptions, defaultLegacy, summary, detectBackend
};
