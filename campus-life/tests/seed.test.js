// 种子码 / 确定性序列 / 选择日志 —— 专项用例
//
// 这些用例盯住「同码必然复现同一局」这条承诺：只要引擎还掷骰子，或者
// 存档少存了随机状态，这里就会红。
//
// 写法遵循华为《测试用例编写规范》：每条用例都声明编号、测试类型、用例等级、
// 名称、前置条件、测试步骤、预期结果，由 tests/harness.js 统一校验并执行。
// 规范来源：https://support.huawei.com/enterprise/zh/doc/EDOC1100452640/b1186e2d
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EXAM_BANK, STAT_META, statName } = require('../miniprogram/data/content');
const { GameCore, pickExamQuestions } = require('../miniprogram/engine/core');
const { buildChoiceLogView } = require('../miniprogram/engine/choicelog');
const { CODE_ALPHABET, decodeSeed, encodeSeed, createRng, randomSeedCode, resolveSeedInput, applySeedInput } = require('../miniprogram/engine/random');
const { suite, runAll, exportCaseList, exportDefects, openIssue, closeIssue } = require('./harness');

const SEED = 'K7M2QX';

// —— 缺陷台账：把已知的坑登记在册，用例失败时按编号关联问题单 ——
// 问题单已提到 GitHub：https://github.com/beilianghandao/beiliang/issues
// ISSUE-SEED-001 存档序列化把内部状态引用漏出去（GitHub #25）
openIssue('ISSUE-SEED-001', {
  title: 'serialize() 返回的是引擎内部状态的引用',
  level: 4,
  cause: 'serialize() 直接返回 this.stats / this.choiceLog / this.completed 等引用，调用方改动返回值会污染当前这局。现无调用方这样干（落盘走 JSON.stringify 会快照），一旦有人直接改返回值即触发。',
  foundBy: '用例 campus_seed_043 复现时发现',
  url: 'https://github.com/beilianghandao/beiliang/issues/25'
});
// ISSUE-SEED-002 存档缺字段时还原会抛 TypeError（GitHub #26）
openIssue('ISSUE-SEED-002', {
  title: 'restore() 对缺字段的存档没有兜底',
  level: 3,
  cause: 'restore() 直接对 state.choiceLog.map / state.completed.slice 取值，存档缺这两个字段时抛 TypeError；缺 stats 时不报错，却会静默得到一份空属性表。脏存档或跨版本存档会打不开。',
  foundBy: '用例 campus_seed_044 与 campus_seed_045 复现时发现',
  url: 'https://github.com/beilianghandao/beiliang/issues/26'
});
// ISSUE-SEED-003 开考之后存档，还原会重抽一套考题（GitHub #27）
openIssue('ISSUE-SEED-003', {
  title: '存档点在开考之后时，还原会重新抽一套考题',
  level: 4,
  cause: 'serialize() 只记了 rngState，没有记 currentExam；还原后 startExam() 会接着往下抽，抽到的不是存档时那一套。当前存档点都落在开考前，触发不到；一旦接上读档功能即为坑。',
  foundBy: '用例 campus_seed_024 复核时发现',
  url: 'https://github.com/beilianghandao/beiliang/issues/27'
});
// ISSUE-SEED-004 存档写了从不读回，restore() 从未被界面调用（GitHub #24）
openIssue('ISSUE-SEED-004', {
  title: '存档写了从不读回：restore() 从未被界面调用',
  level: 2,
  cause: '小程序每次选择后写入 campus-progress 却从不读回，web 端完全没用 localStorage，两端都没有调用 GameCore.restore()。存档是死数据，退出即丢；种子码「复现同学那一局」只在测试里成立。接通读档后 ISSUE-SEED-002 与 ISSUE-SEED-003 才会真正暴露，建议一起排期。',
  foundBy: '用例 campus_seed_047 复现时发现',
  url: 'https://github.com/beilianghandao/beiliang/issues/24'
});

suite('campus_seed', '种子码与确定性序列', [
  {
    title: '校验种子码字母表_字符数与易混字符_通过',
    type: '功能正确性测试',
    level: 2,
    pre: '数据层 content.js 已加载，CODE_ALPHABET 为 32 个字符',
    steps: ['读取 CODE_ALPHABET', '统计字符数与去重后字符数', '逐个比对 0 O 1 I 是否在字母表中'],
    expect: '字母表长度为 32，去重后仍为 32，且不含 0 O 1 I',
    run: () => {
      assert.strictEqual(CODE_ALPHABET.length, 32);
      assert.strictEqual(new Set(CODE_ALPHABET).size, 32);
      ['0', 'O', '1', 'I'].forEach(ch => assert.ok(!CODE_ALPHABET.includes(ch), ch));
    }
  },
  {
    title: '往返编解码_字母表逐字符_编码还原为原码',
    type: '功能正确性测试',
    level: 2,
    pre: 'CODE_ALPHABET 为 32 个字符，encodeSeed 与 decodeSeed 可调用',
    steps: ['对每个字符生成六位同字符种子码', '执行 decodeSeed 得到种子', '执行 encodeSeed 得到种子码'],
    expect: '每个六位同字符种子码的编码结果与输入一致',
    run: () => {
      CODE_ALPHABET.split('').forEach(ch => {
        const code = ch.repeat(6);
        assert.strictEqual(encodeSeed(decodeSeed(code)), code, code);
      });
    }
  },
  {
    title: '校验种子码唯一性_抽样三千个_种子互不相同',
    type: '一致性测试',
    level: 3,
    pre: '引擎具备确定性的取值序列能力，取值落在零到一之间',
    steps: ['用固定种子生成三千个六位种子码', '逐个解码为种子', '比对种子之间是否有重复'],
    expect: '三千个种子码解码后互不相同，且各自编码回原码',
    run: () => {
      const seen = new Map();
      const rng = createRng(20261106);
      for (let i = 0; i < 3000; i++) {
        let code = '';
        for (let j = 0; j < 6; j++) code += CODE_ALPHABET[Math.floor(rng() * 32)];
        const seed = decodeSeed(code);
        assert.ok(!seen.has(seed), `${code} 与 ${seen.get(seed)} 撞码了`);
        seen.set(seed, code);
        assert.strictEqual(encodeSeed(seed), code, `${code} 往返失败`);
      }
    }
  },
  {
    title: '归一化种子码_大小写与空格连字符_得到同一颗种子',
    type: '功能正确性测试',
    level: 2,
    pre: '待归一化的基准种子码为 K7M2QX',
    steps: ['分别传入小写、带空格、带连字符、带制表符四种写法', '执行 decodeSeed', '比对解码结果'],
    expect: '四种写法的解码结果与基准种子码一致',
    run: () => {
      const seed = decodeSeed(SEED);
      ['k7m2qx', ' K7M2QX ', 'k7-m2-qx', '\tK7M2QX\n'].forEach(text => {
        assert.strictEqual(decodeSeed(text), seed, `"${text}" 归一化后不该换种子`);
      });
    }
  },
  {
    title: '拒绝非法种子码_混淆字符与长度错误_返回null',
    type: '功能正确性测试',
    level: 2,
    pre: 'decodeSeed 接受字符串类型的入参',
    steps: ['传入含 0 O 1 I 的六个字符', '传入长度为 5 与 7 的字符串', '传入非字符串类型的入参'],
    expect: '三类入参的解码结果均为 null',
    run: () => {
      ['K7M2Q0', 'K7M2QO', 'K7M2Q1', 'K7M2QI'].forEach(code => assert.strictEqual(decodeSeed(code), null, code));
      ['K7M2Q', 'K7M2QX1', ''].forEach(code => assert.strictEqual(decodeSeed(code), null, code));
      [null, undefined, 123456, {}, [], true].forEach(v => assert.strictEqual(decodeSeed(v), null, String(v)));
    }
  },
  {
    title: '回绕越界种子_超出三十二进制范围_编码落回范围内',
    type: '功能正确性测试',
    level: 4,
    pre: '种子空间的规模为 32 的 6 次方',
    steps: ['传入与种子空间同值的种子', '传入种子空间加五的种子', '传入二的三十二次方减一的种子'],
    expect: '前两个种子的编码结果与按空间取模后的编码结果一致，第三个种子的编码结果长度为六位',
    run: () => {
      const space = 32 ** 6;
      assert.strictEqual(encodeSeed(space), encodeSeed(0));
      assert.strictEqual(encodeSeed(space + 5), encodeSeed(5));
      assert.strictEqual(encodeSeed(4294967295).length, 6);
    }
  },
  {
    title: '解码回绕种子_二的三十二次方减一_种子落在空间内',
    type: '功能正确性测试',
    level: 4,
    pre: '种子空间的规模为 32 的 6 次方',
    steps: ['编码二的三十二次方减一的种子', '解码该种子码', '比对解码结果与按空间取模后的值'],
    expect: '解码结果与二的三十二次方减一按空间取模后的值一致',
    run: () => {
      const space = 32 ** 6;
      assert.strictEqual(decodeSeed(encodeSeed(4294967295)), 4294967295 % space);
    }
  },
  {
    title: '取序列取值_连续一千次_落在零到一之间',
    type: '功能正确性测试',
    level: 2,
    pre: 'createRng 以 K7M2QX 解码出的种子初始化',
    steps: ['连续取出一千个值', '逐个比对取值下界与上界'],
    expect: '一千个取值均满足大于等于零且小于一',
    run: () => {
      const rng = createRng(decodeSeed(SEED));
      for (let i = 0; i < 1000; i++) {
        const value = rng();
        assert.ok(value >= 0 && value < 1, `${value} 越界`);
      }
    }
  },
  {
    title: '存取序列状态_三次取值之后_后续序列接续',
    type: '功能正确性测试',
    level: 2,
    pre: 'createRng 具备 getState 与 setState 两个方法',
    steps: ['取三次值后记录当前状态', '再取三个值作为基准', '新建序列并写入刚才的状态', '按同一顺序取三个值'],
    expect: '写入状态后取出的三个值与基准逐位一致',
    run: () => {
      const rng = createRng(decodeSeed(SEED));
      rng(); rng(); rng();
      const state = rng.getState();
      const expected = [rng(), rng(), rng()];
      const resumed = createRng(decodeSeed(SEED));
      resumed.setState(state);
      assert.deepStrictEqual([resumed(), resumed(), resumed()], expected);
    }
  },
  {
    title: '比对序列取值_同种子与异种子_同序与异序',
    type: '一致性测试',
    level: 2,
    pre: 'createRng 以种子码解码出的种子初始化',
    steps: ['用同一颗种子取三次值并记录', '换一颗种子再取三次值并记录', '比对两组取值'],
    expect: '同种子的两组取值逐位一致，异种子的两组取值存在差异',
    run: () => {
      const draw = code => { const rng = createRng(decodeSeed(code)); return [rng(), rng(), rng()]; };
      assert.deepStrictEqual(draw(SEED), draw(SEED));
      assert.notDeepStrictEqual(draw(SEED), draw('R4T8WA'));
    }
  },
  {
    title: '抽取期末考题_题库十条_题目互不重复',
    type: '功能正确性测试',
    level: 2,
    pre: '题库 EXAM_BANK 有十条题目，pickExamQuestions 可调用',
    steps: ['以固定种子调用 pickExamQuestions', '统计题目条数与去重后条数', '比对每道题是否在题库中'],
    expect: '抽出五道题，去重后仍为五道，且每道题都在题库中',
    run: () => {
      const questions = pickExamQuestions(createRng(decodeSeed(SEED)));
      assert.strictEqual(questions.length, 5);
      assert.strictEqual(new Set(questions.map(q => q.question)).size, 5);
      questions.forEach(q => assert.ok(EXAM_BANK.some(b => b.question === q.question), q.question));
    }
  },
  {
    title: '抽取期末考题_五十颗种子_题序存在差异',
    type: '一致性测试',
    level: 3,
    pre: '题库 EXAM_BANK 有十条题目',
    steps: ['依次以零到四十九为种子抽取考题', '把每次的题目顺序拼成字符串', '统计拼成的字符串种数'],
    expect: '拼成的字符串种数大于一，且不小于十',
    run: () => {
      const draws = new Set();
      for (let seed = 0; seed < 50; seed++) {
        const rng = createRng(seed);
        draws.add(pickExamQuestions(rng).map(q => q.question).join('|'));
      }
      assert.ok(draws.size > 1, '换了种子却抽出同一套题，种子码没起作用');
      assert.ok(draws.size >= 10, `五十颗种子只抽出 ${draws.size} 套题，抽题分布太窄`);
    }
  },
  {
    title: '校验题库结构_十条题目_题干与选项齐备',
    type: '一致性测试',
    level: 3,
    pre: '题库 EXAM_BANK 可读取',
    steps: ['读取题库条数', '逐题读取题干', '逐题读取选项数组'],
    expect: '题库条数不小于五，每道题都有非空题干，选项数量不小于二',
    run: () => {
      assert.ok(EXAM_BANK.length >= 5);
      EXAM_BANK.forEach(q => {
        assert.ok(q.question, '题干不能为空');
        assert.ok(Array.isArray(q.options) && q.options.length >= 2, q.question);
      });
    }
  },
  {
    title: '校验题库答案_十条题目_下标落在选项范围',
    type: '一致性测试',
    level: 3,
    pre: '题库 EXAM_BANK 可读取，每道题带答案下标',
    steps: ['逐题读取答案下标与选项数量', '比对下标是否落在选项范围内'],
    expect: '每道题的答案下标都落在该题选项范围内',
    run: () => {
      EXAM_BANK.forEach(q => {
        assert.ok(q.answer >= 0 && q.answer < q.options.length, `${q.question} 的答案下标越界`);
      });
    }
  },
  {
    title: '复现整局存档_同角色同种子_字段逐项一致',
    type: '一致性测试',
    level: 2,
    pre: '引擎以 K7M2QX 与角色 lin 初始化',
    steps: ['用同一套选择序列各跑一局', '取出两局的存档', '逐字段比对两份存档'],
    expect: '两份存档逐字段一致，抽出的考题顺序也一致',
    run: () => {
      const play = code => {
        const game = new GameCore('lin', code);
        const script = [['library', 0, 0], ['library', 1, 1], ['canteen', 0, 0], ['canteen', 1, 1]];
        while (!game.examReady) {
          const [scene, quest, choice] = script[(game.week - 1) % script.length];
          game.applyChoice(scene, quest, choice);
        }
        const questions = game.startExam();
        questions.forEach(q => game.answerExam(q.answer));
        game.finishExam();
        return { state: game.serialize(), exams: questions.map(q => q.question) };
      };
      const first = play(SEED);
      const second = play(SEED);
      assert.deepStrictEqual(second.state, first.state);
      assert.deepStrictEqual(second.exams, first.exams);
    }
  },
  {
    title: '抽取考题_四名角色同种子_题序一致',
    type: '一致性测试',
    level: 3,
    pre: '引擎支持 chen lin su jiang 四名角色',
    steps: ['分别以四名角色开局并推进到开考', '各自抽取考题', '比对四组题目顺序'],
    expect: '四名角色抽到的题目顺序完全一致',
    run: () => {
      const draw = id => {
        const game = new GameCore(id, SEED);
        while (!game.examReady) game.applyChoice('library', 0, 0);
        return game.startExam().map(q => q.question);
      };
      assert.deepStrictEqual(draw('chen'), draw('lin'));
      assert.deepStrictEqual(draw('su'), draw('jiang'));
    }
  },
  {
    title: '校验种子码稳定性_一局全程_种子码保持一致',
    type: '功能正确性测试',
    level: 2,
    pre: '引擎以小写种子码 k7m2qx 初始化',
    steps: ['读取引擎中的种子码', '完成一次任务选择', '再次读取种子码', '读取序列化后的种子码'],
    expect: '三处种子码均为大写的 K7M2QX',
    run: () => {
      const game = new GameCore('lin', 'k7m2qx');
      assert.strictEqual(game.seedCode, 'K7M2QX');
      game.applyChoice('library', 0, 0);
      assert.strictEqual(game.seedCode, 'K7M2QX');
      assert.strictEqual(game.serialize().seedCode, 'K7M2QX');
    }
  },
  {
    title: '拒绝开局_种子码缺失_引擎抛出异常',
    type: '容错容灾测试',
    level: 2,
    pre: '引擎构造函数的第二个入参为种子码',
    steps: ['不传种子码构造引擎', '传入长度不足的种子码构造引擎', '传入含混淆字符的种子码构造引擎'],
    expect: '三次构造均抛出异常，异常信息包含「种子码不合法」',
    run: () => {
      assert.throws(() => new GameCore('lin'), /种子码不合法/);
      assert.throws(() => new GameCore('lin', ''), /种子码不合法/);
      assert.throws(() => new GameCore('lin', 'K7M2QI'), /种子码不合法/);
    }
  },
  {
    title: '还原存档_同一局两次序列化_字段逐项一致',
    type: '功能正确性测试',
    level: 2,
    pre: '引擎已完成两次任务选择',
    steps: ['序列化当前对局', '用存档还原出新的引擎', '对新的引擎再次序列化', '比对两次序列化结果'],
    expect: '两次序列化的结果逐字段一致',
    run: () => {
      const game = new GameCore('lin', SEED);
      game.applyChoice('library', 0,  0);
      game.applyChoice('canteen', 0, 1);
      const first = game.serialize();
      assert.deepStrictEqual(GameCore.restore(first).serialize(), first);
    }
  },
  {
    title: '隔离还原存档_修改副本_原存档保持不变',
    type: '功能正确性测试',
    level: 3,
    pre: '引擎已完成一次任务选择，并已序列化',
    steps: ['用存档还原出新的引擎', '改动还原引擎的属性与日志', '改动还原引擎的已完成任务列表', '读回原存档的对应字段'],
    expect: '原存档的属性与日志取值未变，已完成任务列表未新增条目',
    run: () => {
      const game = new GameCore('lin', SEED);
      game.applyChoice('library', 0, 0);
      const saved = game.serialize();
      const restored = GameCore.restore(saved);
      restored.stats.knowledge = 999;
      restored.choiceLog[0].effects.knowledge = 999;
      restored.completed.push('fake:0');
      assert.notStrictEqual(saved.stats.knowledge, 999);
      assert.notStrictEqual(saved.choiceLog[0].effects.knowledge, 999);
      assert.ok(!saved.completed.includes('fake:0'));
    }
  },
  {
    title: '复现存档往返_三十轮选择序列_往返结果一致',
    type: '一致性测试',
    level: 3,
    pre: '引擎具备八条场景线的任务表与十颗种子码',
    steps: ['按固定序列执行三十轮任务选择', '序列化后还原', '比对还原前后的序列化结果与属性与日志条数'],
    expect: '三十轮的还原结果与原存档逐字段一致，属性与日志条数也一致',
    run: () => {
      const scenes = ['library', 'canteen', 'lab', 'dorm', 'classroom', 'gym', 'club', 'court'];
      for (let round = 0; round < 30; round++) {
        const rng = createRng(round * 7919 + 13);
        const game = new GameCore('lin', encodeSeed(round * 1234567 % (32 ** 6)));
        const steps = 1 + Math.floor(rng() * 20);
        for (let i = 0; i < steps; i++) {
          game.applyChoice(scenes[Math.floor(rng() * scenes.length)], Math.floor(rng() * 2), Math.floor(rng() * 3));
        }
        const saved = game.serialize();
        const restored = GameCore.restore(saved);
        assert.deepStrictEqual(restored.serialize(), saved, `第 ${round} 轮往返不一致`);
        assert.strictEqual(restored.choiceLog.length, game.choiceLog.length);
      }
    }
  },
  {
    title: '续玩还原存档_与原局并行_考题成绩一致',
    type: '一致性测试',
    level: 2,
    pre: '引擎已完成一次任务选择，并已序列化',
    steps: ['用存档还原出新的引擎', '让原局与还原局各自推进到开考', '各自抽取考题并作答', '比对两边的考题与成绩'],
    expect: '两边的考题顺序与学期成绩一致',
    run: () => {
      const game = new GameCore('lin', SEED);
      game.applyChoice('library', 0, 0);
      const restored = GameCore.restore(game.serialize());
      const play = core => {
        while (!core.examReady) core.applyChoice('canteen', 0, 0);
        const questions = core.startExam();
        questions.forEach(q => core.answerExam(q.answer));
        const outcome = core.finishExam();
        return { exam: questions.map(q => q.question).join('|'), score: outcome.semesterResult.score, stats: { ...core.stats } };
      };
      assert.deepStrictEqual(play(restored), play(game));
    }
  },
  {
    title: '复算毕业结局_还原后的存档_结局编号一致',
    type: '功能正确性测试',
    level: 2,
    pre: '引擎已跑完八个学期并产生结局',
    steps: ['序列化这一局', '用存档还原出新的引擎', '用还原局的成绩均值复算结局', '比对两边的结局编号'],
    expect: '复算出的结局编号与原局的结局编号一致',
    run: () => {
      const game = new GameCore('lin', SEED);
      for (let semester = 1; semester <= 8; semester++) {
        while (!game.examReady) game.applyChoice('library', 0, 0);
        const questions = game.startExam();
        questions.forEach(q => game.answerExam(q.answer));
        game.finishExam();
      }
      assert.ok(game.ending, '八年跑完应该有结局');
      const restored = GameCore.restore(game.serialize());
      const avg = Math.round(restored.examScores.reduce((a, b) => a + b, 0) / restored.examScores.length);
      assert.strictEqual(restored.pickEnding(avg).id, game.ending.id);
    }
  },
  {
    title: '记录存档边界_开考之后存档_考题重新抽取',
    type: '一致性测试',
    level: 4,
    linked: 'ISSUE-SEED-003',
    pre: '引擎已推进到可开考的状态，存档只记了序列状态',
    steps: ['抽出一次考题', '序列化当前对局', '用存档还原出新的引擎', '让还原局重新开考并抽题'],
    expect: '还原局抽到的考题与存档前抽到的不一致，存档点须落在开考前',
    run: () => {
      const game = new GameCore('lin', SEED);
      while (!game.examReady) game.applyChoice('library', 0, 0);
      const drawn = game.startExam().map(q => q.question);
      const restored = GameCore.restore(game.serialize());
      while (!restored.examReady) restored.applyChoice('library', 0, 0);
      assert.notDeepStrictEqual(restored.startExam().map(q => q.question), drawn);
    }
  },
  {
    title: '记录选择日志_完成一次选择_条数与学期周次',
    type: '功能正确性测试',
    level: 2,
    pre: '引擎以 K7M2QX 初始化，完成一次图书馆任务选择',
    steps: ['读取选择日志的条数', '读取首条日志的学期', '读取首条日志的周次'],
    expect: '日志有一条，学期为一，周次为一',
    run: () => {
      const game = new GameCore('lin', SEED);
      game.applyChoice('library', 0, 0);
      assert.strictEqual(game.choiceLog.length, 1);
      assert.strictEqual(game.choiceLog[0].semester, 1);
      assert.strictEqual(game.choiceLog[0].week, 1);
    }
  },
  {
    title: '记录选择日志_完成一次选择_场景任务与选项文案',
    type: '功能正确性测试',
    level: 2,
    pre: '引擎以 K7M2QX 初始化，完成一次图书馆任务选择',
    steps: ['读取首条日志的场景标识', '读取首条日志的场景名', '读取首条日志的任务标题与选项文案'],
    expect: '场景标识为 library，场景名为图书馆，任务标题与选项文案均非空',
    run: () => {
      const game = new GameCore('lin', SEED);
      game.applyChoice('library', 0, 0);
      const entry = game.choiceLog[0];
      assert.strictEqual(entry.sceneId, 'library');
      assert.strictEqual(entry.sceneName, '图书馆');
      assert.ok(entry.questTitle && entry.choiceText);
    }
  },
  {
    title: '记录选择日志_完成一次选择_属性变化与重复标识',
    type: '功能正确性测试',
    level: 2,
    pre: '引擎以 K7M2QX 初始化，完成一次图书馆任务选择',
    steps: ['读取首条日志的属性变化键值对数量', '读取首条日志的重复标识'],
    expect: '属性变化键值对数量大于零，重复标识为假',
    run: () => {
      const game = new GameCore('lin', SEED);
      game.applyChoice('library', 0, 0);
      assert.ok(Object.keys(game.choiceLog[0].effects).length > 0);
      assert.strictEqual(game.choiceLog[0].repeat, false);
    }
  },
  {
    title: '核对日志数值_角色学识加成_与结算结果一致',
    type: '一致性测试',
    level: 3,
    pre: '引擎以角色 chen 初始化',
    steps: ['完成一次图书馆任务选择', '取回结算结果', '比对日志的属性变化与结算结果'],
    expect: '日志的属性变化与结算结果逐项一致，且学识增量大于八',
    run: () => {
      const chen = new GameCore('chen', SEED);
      const result = chen.applyChoice('library', 0, 0);
      assert.deepStrictEqual(chen.choiceLog[0].effects, result.applied);
      assert.ok(result.applied.knowledge > 8, '陈屿在图书馆应当有学识加成');
    }
  },
  {
    title: '核对日志数值_重复体验_第二次小于第一次',
    type: '一致性测试',
    level: 3,
    pre: '引擎以角色 lin 初始化',
    steps: ['连续两次完成同一任务选择', '读取第二条日志的重复标识', '比对两条日志的学识增量'],
    expect: '第二条日志的重复标识为真，第二条日志的学识增量小于第一条',
    run: () => {
      const lin = new GameCore('lin', SEED);
      lin.applyChoice('library', 0, 0);
      lin.applyChoice('library', 0, 0);
      assert.strictEqual(lin.choiceLog[1].repeat, true);
      assert.ok(lin.choiceLog[1].effects.knowledge < lin.choiceLog[0].effects.knowledge);
    }
  },
  {
    title: '检查日志视图_三次选择_按时间倒序排列',
    type: '功能正确性测试',
    level: 2,
    pre: '引擎连续完成三次任务选择，日志以数组存放',
    steps: ['记录日志数组的序列化结果', '调用 buildChoiceLogView 生成视图', '比对日志数组与视图条目的场景顺序'],
    expect: '日志数组的序列化结果未变，视图条目的场景顺序为倒序，视图条目编号互不相同',
    run: () => {
      const game = new GameCore('lin', SEED);
      game.applyChoice('library', 0, 0);
      game.applyChoice('canteen', 0, 0);
      game.applyChoice('dorm', 0, 0);
      const snapshot = JSON.stringify(game.choiceLog);
      const view = buildChoiceLogView(game.choiceLog);
      assert.strictEqual(JSON.stringify(game.choiceLog), snapshot, '视图不该改动原始日志');
      assert.deepStrictEqual(view.map(item => item.sceneId), ['dorm', 'canteen', 'library']);
      assert.strictEqual(new Set(view.map(item => item.id)).size, view.length, '视图条目的 id 必须唯一');
    }
  },
  {
    title: '检查日志视图_尚无选择_返回空数组',
    type: '容错容灾测试',
    level: 3,
    pre: '引擎尚未做出任何选择',
    steps: ['以空数组调用 buildChoiceLogView', '以未定义值调用 buildChoiceLogView'],
    expect: '两次调用的返回值都是空数组',
    run: () => {
      assert.deepStrictEqual(buildChoiceLogView([]), []);
      assert.deepStrictEqual(buildChoiceLogView(undefined), []);
    }
  },
  {
    title: '检查日志视图_含重复体验_首条标出收益递减',
    type: '功能正确性测试',
    level: 3,
    pre: '引擎连续两次完成同一任务',
    steps: ['生成日志视图', '读取视图首条的重复标识', '读取视图首条的重复标识文案'],
    expect: '首条重复标识为真，首条文案为重复体验与收益递减',
    run: () => {
      const game = new GameCore('lin', SEED);
      game.applyChoice('library', 0, 0);
      game.applyChoice('library', 0, 0);
      const view = buildChoiceLogView(game.choiceLog);
      assert.strictEqual(view[0].repeat, true);
      assert.strictEqual(view[0].repeatLabel, '重复体验 · 收益递减');
    }
  },
  {
    title: '检查日志视图_含重复体验_次条标出首次体验',
    type: '功能正确性测试',
    level: 3,
    pre: '引擎连续两次完成同一任务',
    steps: ['生成日志视图', '读取视图次条的重复标识', '读取视图次条的重复标识文案'],
    expect: '次条重复标识为假，次条文案为首次体验',
    run: () => {
      const game = new GameCore('lin', SEED);
      game.applyChoice('library', 0, 0);
      game.applyChoice('library', 0, 0);
      const view = buildChoiceLogView(game.choiceLog);
      assert.strictEqual(view[1].repeat, false);
      assert.strictEqual(view[1].repeatLabel, '首次体验');
    }
  },
  {
    title: '检查属性名称_未知属性键_原样返回键名',
    type: '容错容灾测试',
    level: 3,
    pre: '数据层 statName 可调用，STAT_META 给出已有属性的名称',
    steps: ['以 energy 调用 statName', '以 knowledge 调用 statName', '以未登记的属性键调用 statName'],
    expect: 'energy 返回精力，knowledge 返回学识，未登记的属性键原样返回键名',
    run: () => {
      assert.strictEqual(statName('energy'), '精力');
      assert.strictEqual(statName('knowledge'), STAT_META.knowledge.name);
      assert.strictEqual(statName('notAStat'), 'notAStat');
    }
  },
  {
    title: '校验种子码输入_空串与空白串_返回留空标识',
    type: '功能正确性测试',
    level: 2,
    pre: '数据层提供 resolveSeedInput 入口',
    steps: ['以空串调用 resolveSeedInput', '以含空格与制表符的串调用 resolveSeedInput'],
    expect: '两次调用的返回值都是留空标识',
    run: () => {
      assert.deepStrictEqual(resolveSeedInput(''), { blank: true });
      assert.deepStrictEqual(resolveSeedInput('  \t '), { blank: true });
    }
  },
  {
    title: '校验种子码输入_合法与非法种子码_归一化与报错',
    type: '功能正确性测试',
    level: 2,
    pre: '数据层提供 resolveSeedInput 入口',
    steps: ['以小写合法种子码调用 resolveSeedInput', '以含混淆字符的种子码调用 resolveSeedInput'],
    expect: '合法种子码返回归一化后的码与提示文案，含混淆字符的返回错误标识',
    run: () => {
      assert.strictEqual(resolveSeedInput('k7m2qx').code, 'K7M2QX');
      assert.ok(resolveSeedInput('k7m2qx').hint);
      assert.ok(resolveSeedInput('K7M2QI').error);
    }
  },
  {
    title: '校验种子码输入_留空路径_返回六位码与提示',
    type: '功能正确性测试',
    level: 2,
    pre: '数据层提供 applySeedInput 入口',
    steps: ['以空串与固定熵源调用 applySeedInput', '读取返回的种子码长度与提示文案'],
    expect: '返回的种子码长度为六位，提示文案非空',
    run: () => {
      const blank = applySeedInput('', () => 0.5);
      assert.strictEqual(blank.code.length, 6);
      assert.ok(blank.hint);
    }
  },
  {
    title: '校验种子码输入_合法与非法路径_原样与报错',
    type: '功能正确性测试',
    level: 2,
    pre: '数据层提供 applySeedInput 入口',
    steps: ['以合法种子码与固定熵源调用 applySeedInput', '以含混淆字符的种子码与固定熵源调用 applySeedInput'],
    expect: '合法种子码原样返回，含混淆字符的返回错误标识',
    run: () => {
      assert.strictEqual(applySeedInput('K7M2QX', () => 0.5).code, 'K7M2QX');
      assert.ok(applySeedInput('K7M2QI', () => 0.5).error);
    }
  },
  {
    title: '铸种子码_未给熵源_抛出异常',
    type: '容错容灾测试',
    level: 2,
    pre: '数据层 randomSeedCode 需要调用方提供熵源函数',
    steps: ['不传参数调用 randomSeedCode', '传入数值调用 randomSeedCode'],
    expect: '两次调用都抛出异常，异常信息含熵源',
    run: () => {
      assert.throws(() => randomSeedCode(), /熵源/);
      assert.throws(() => randomSeedCode(0.5), /熵源/);
    }
  },
  {
    title: '铸种子码_熵源取零与取半_返回六位种子码',
    type: '功能正确性测试',
    level: 2,
    pre: '数据层 randomSeedCode 接收一个返回零到一之间数值的熵源函数',
    steps: ['以返回零的熵源函数调用 randomSeedCode', '以返回半的熵源函数调用 randomSeedCode'],
    expect: '前一次返回种子码 222222，后一次返回的种子码长度为六位',
    run: () => {
      assert.strictEqual(randomSeedCode(() => 0), '222222');
      assert.strictEqual(randomSeedCode(() => 0.5).length, 6);
    }
  },
  {
    title: '扫描引擎与数据层_非确定性来源_零命中',
    type: '一致性测试',
    level: 2,
    pre: '引擎目录与数据目录下的脚本文件可读取',
    steps: ['遍历引擎目录与数据目录下的脚本文件', '逐个文件检索 Math.random 与 Date.now 与 new Date'],
    expect: '两个目录下的脚本文件都不含这三处非确定性来源',
    run: () => {
      ['engine', 'data'].forEach(dir => {
        const files = fs.readdirSync(path.join(__dirname, '../miniprogram', dir)).filter(file => file.endsWith('.js'));
        files.forEach(file => {
          const source = fs.readFileSync(path.join(__dirname, '../miniprogram', dir, file), 'utf8');
          assert.ok(!/Math\.random|Date\.now|new Date\(/.test(source), `${dir}/${file} 出现了非确定性来源`);
        });
      });
    }
  },
  {
    title: '校验界面熵源_应用入口与选角页_以Mathrandom作熵',
    type: '功能交互测试',
    level: 3,
    pre: '小程序 app.js 与选角页均可读取',
    steps: ['检索 app.js 中的熵源用法', '检索选角页中的熵源用法'],
    expect: '两个文件都以 Math.random 作为熵源',
    run: () => {
      const appSource = fs.readFileSync(path.join(__dirname, '../miniprogram/app.js'), 'utf8');
      assert.ok(/randomSeedCode\(Math\.random\)/.test(appSource), 'app.js 应当用 Math.random 作熵源');
      const selectSource = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/select/select.js'), 'utf8');
      assert.ok(/randomSeedCode\(Math\.random\)/.test(selectSource), '选角页应当用 Math.random 作熵源');
    }
  },
  {
    title: '复现存档引用_序列化后改动返回值_引擎状态被改动',
    type: '功能正确性测试',
    level: 4,
    defect: 'ISSUE-SEED-001',
    pre: '引擎已完成一次任务选择',
    steps: ['序列化当前对局', '改动序列化结果中的属性取值', '读取引擎当前的属性取值'],
    expect: '引擎当前的属性取值不随序列化结果改动，序列化结果应是独立副本',
    run: () => {
      const game = new GameCore('lin', SEED);
      game.applyChoice('library', 0, 0);
      const saved = game.serialize();
      saved.stats.knowledge = 999;
      assert.notStrictEqual(game.stats.knowledge, 999, '序列化结果把引擎内部状态引用漏了出去');
    }
  },
  {
    title: '复现脏存档_缺选择日志字段_还原抛出异常',
    type: '容错容灾测试',
    level: 3,
    defect: 'ISSUE-SEED-002',
    pre: '存档包含种子码但缺少选择日志字段',
    steps: ['构造一份缺选择日志字段的存档', '用该存档还原引擎'],
    expect: '还原过程不抛出异常，缺字段回退到初始值',
    run: () => {
      const broken = { characterId: 'lin', seedCode: SEED, stats: {}, completed: [], visited: {}, examScores: [] };
      assert.doesNotThrow(() => GameCore.restore(broken), '存档缺字段时还原抛出了异常');
    }
  },
  {
    title: '复现脏存档_缺属性表_还原后属性被清空',
    type: '容错容灾测试',
    level: 3,
    defect: 'ISSUE-SEED-002',
    pre: '存档包含种子码但缺少属性表字段',
    steps: ['构造一份缺属性表字段的存档', '用该存档还原引擎', '读取还原后引擎的属性表'],
    expect: '还原后属性表仍为角色初始值，不是一张空表',
    run: () => {
      const broken = { characterId: 'lin', seedCode: SEED, completed: [], visited: {}, examScores: [], choiceLog: [] };
      const restored = GameCore.restore(broken);
      assert.ok(Object.keys(restored.stats).length > 0, '存档缺属性表时还原后属性被清空');
    }
  },
  {
    title: '复现存档未接线_界面层检索还原调用_零命中',
    type: '功能交互测试',
    level: 2,
    defect: 'ISSUE-SEED-004',
    pre: '小程序页面脚本与 web 端脚本均可读取，引擎具备还原能力',
    steps: ['遍历小程序页面脚本与 web 端脚本', '检索其中对还原方法的调用', '统计命中文件数'],
    expect: '命中文件数大于零，界面层应当调用还原方法把存档读回来',
    run: () => {
      const targets = [
        path.join(__dirname, '../miniprogram/pages/game/game.js'),
        path.join(__dirname, '../miniprogram/pages/select/select.js'),
        path.join(__dirname, '../web/app.js')
      ];
      const hits = targets.filter(file => /GameCore\.restore|\.restore\(/.test(fs.readFileSync(file, 'utf8')));
      assert.ok(hits.length > 0, '界面层没有调用还原方法，存档写了从不读回');
    }
  },
  {
    title: '校验界面熵源_造出的种子码_引擎能够接受',
    type: '功能交互测试',
    level: 3,
    pre: '数据层 randomSeedCode 与引擎均可调用',
    steps: ['用固定熵造一颗种子码', '解码该种子码', '用该种子码构造引擎'],
    expect: '解码结果不为空，构造引擎时不抛出异常',
    run: () => {
      const code = randomSeedCode(() => 0.42);
      assert.notStrictEqual(decodeSeed(code), null, '造出来的码必须合法');
      assert.doesNotThrow(() => new GameCore('lin', code));
    }
  }
]);

// —— 执行并产出清单 ——
const results = runAll();
const failed = results.filter(r => r.status === 'FAIL');

// 把清单与缺陷台账落盘，方便直接贴进测试计划
const outDir = path.join(__dirname, 'cases');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'seed.md'),
  `# 种子码与确定性序列 —— 测试用例清单\n\n> 依据华为《测试用例编写规范》编写\n\n${exportCaseList(results)}\n\n## 缺陷台账\n\n${exportDefects()}\n`,
  'utf8');

console.log(`\n用例 ${results.length} 条，通过 ${results.length - failed.length} 条，失败 ${failed.length} 条。`);
console.log(`清单已写入 tests/cases/seed.md`);
if (failed.length) process.exit(1);
