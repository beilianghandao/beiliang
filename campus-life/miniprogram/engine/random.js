// 种子码：6 位、30 bit，用 32 个没有歧义字符（去掉 0 O 1 I）编码，短到能手打。
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;
const SEED_SPACE = 32 ** CODE_LENGTH;

// 种子码 → 种子；非法输入返回 null
function decodeSeed(code) {
  if (typeof code !== 'string') return null;
  const text = code.trim().toUpperCase().replace(/[\s-]/g, '');
  if (text.length !== CODE_LENGTH) return null;
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    const index = CODE_ALPHABET.indexOf(text[i]);
    if (index < 0) return null;
    seed = seed * 32 + index;
  }
  return seed;
}

// 种子 → 种子码
function encodeSeed(seed) {
  let value = ((seed >>> 0) % SEED_SPACE);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code = CODE_ALPHABET[value % 32] + code;
    value = Math.floor(value / 32);
  }
  return code;
}

// 确定性随机序列：同一个种子必然给出同一串数（mulberry32）
// 额外给出 getState / setState，好让一局的中途状态可以被存档、还原。
function createRng(seed) {
  let state = seed >>> 0;
  const next = function () {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  next.getState = () => state;
  next.setState = nextState => { state = nextState >>> 0; };
  return next;
}

// 铸一局的新种子码：这是全局唯一需要熵的地方，熵由调用方递进来，
// 所以引擎与数据层自己不含任何非确定性随机来源。
function randomSeedCode(entropy) {
  if (typeof entropy !== 'function') throw new Error('randomSeedCode 需要一个熵源');
  return encodeSeed(Math.floor(entropy() * SEED_SPACE));
}

const SEED_HINT_BLANK = '留空则随机开启新的一局；填入同学的种子码，可以复现他的四年';
const SEED_HINT_VALID = '这一局将按这个种子码开始，同码可复现';
const SEED_HINT_INVALID = '种子码不合法，请输入 6 位字母数字（不含 0 O 1 I）';

// 界面输入的种子码 → 这一局真正使用的种子码。浏览器与小程序共用这一份规则。
// 留空表示「用这一局自动生成的码」，合法就照用，非法就把原因说清楚。
function resolveSeedInput(input) {
  const value = String(input || '').trim();
  if (!value) return { blank: true };
  const seed = decodeSeed(value);
  if (seed === null) return { error: SEED_HINT_INVALID };
  return { code: encodeSeed(seed), hint: SEED_HINT_VALID };
}

// 玩家按下「使用」时用：留空就摇一局新的种子码，合法就照用，非法就报错。
function applySeedInput(input, entropy) {
  const result = resolveSeedInput(input);
  if (result.blank) return { code: randomSeedCode(entropy), hint: SEED_HINT_BLANK };
  if (result.error) return { error: SEED_HINT_INVALID };
  return result;
}

module.exports = {
  CODE_ALPHABET, CODE_LENGTH, decodeSeed, encodeSeed, createRng, randomSeedCode,
  resolveSeedInput, applySeedInput, SEED_HINT_BLANK, SEED_HINT_VALID, SEED_HINT_INVALID
};
