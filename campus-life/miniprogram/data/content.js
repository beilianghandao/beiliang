const CHARACTERS = [
  { id: 'lin', name: '林知夏', title: '清醒温柔的记录者', quote: '想把平凡的日子，过成自己的答案。', color: '#e98b78', hair: '#3d2926', skin: '#ffd8bc', hairStyle: 'long', pants: '#5b6b85', avatar: 'lin_avatar.png', stats: { knowledge: 46, fitness: 40, mood: 62, social: 54, practice: 45 }, trait: '共情倾听：对话中获得的人缘 +1' },
  { id: 'chen', name: '陈屿', title: '理性可靠的技术宅', quote: '世界很复杂，但问题总能被拆解。', color: '#6688bb', hair: '#252936', skin: '#f2c9a9', hairStyle: 'short', pants: '#3f4a5c', accessory: 'glasses', avatar: 'chen_avatar.png', stats: { knowledge: 60, fitness: 36, mood: 48, social: 36, practice: 56 }, trait: '逻辑拆解：学习事件获得的学识 +2' },
  { id: 'su', name: '苏桃', title: '明亮热烈的组织者', quote: '别等故事发生，先去认识故事里的人们。', color: '#d99a45', hair: '#77462d', skin: '#ffd7b5', hairStyle: 'ponytail', pants: '#6b5a4a', avatar: 'su_avatar.png', stats: { knowledge: 42, fitness: 45, mood: 58, social: 65, practice: 48 }, trait: '气氛担当：首次完成任务时心态 +2' },
  { id: 'jiang', name: '江野', title: '自由果敢的行动派', quote: '想一千次，不如现在就出发。', color: '#57977b', hair: '#202d29', skin: '#eebf9e', hairStyle: 'messy', pants: '#4a5a4e', avatar: 'jiang_avatar.png', stats: { knowledge: 40, fitness: 65, mood: 55, social: 47, practice: 58 }, trait: '精力充沛：每周额外恢复 8 点精力' }
];

const STAT_META = {
  knowledge: { name: '学识', icon: '知', color: '#5d7ea8' },
  fitness: { name: '体魄', icon: '体', color: '#5b9272' },
  mood: { name: '心态', icon: '心', color: '#d88a75' },
  social: { name: '人缘', icon: '友', color: '#ae7b9f' },
  practice: { name: '实践', icon: '行', color: '#ba8b48' }
};

const YEAR_NAMES = ['大一', '大二', '大三', '大四'];
const SEMESTER_NAMES = ['上学期', '下学期'];
const semesterLabel = semester => `${YEAR_NAMES[Math.floor((semester - 1) / 2)]}${SEMESTER_NAMES[(semester - 1) % 2]}`;

const BUILDINGS = [
  { id: 'library', name: '图书馆', subtitle: '把未知，读成已知', x: 890, y: 100, w: 480, h: 250, doorX: 1130, doorY: 380, color: '#d68c69', roof: '#934f43', icon: 'LIBRARY', event: 'library' },
  { id: 'teaching', name: '明德教学楼', subtitle: '今天也要好好上课', x: 190, y: 250, w: 450, h: 240, doorX: 415, doorY: 520, color: '#e4b36f', roof: '#b9754d', icon: 'LECTURE', event: 'classroom' },
  { id: 'lab', name: '创新实验楼', subtitle: '让想法落地', x: 1720, y: 210, w: 400, h: 230, doorX: 1920, doorY: 470, color: '#86a9ad', roof: '#52737d', icon: 'LAB', event: 'lab' },
  { id: 'canteen', name: '拾光食堂', subtitle: '人间烟火气', x: 180, y: 1090, w: 430, h: 220, doorX: 400, doorY: 1080, color: '#e5a368', roof: '#bd674e', icon: 'FOOD', event: 'canteen' },
  { id: 'dorm', name: '学生公寓', subtitle: '熄灯以后，也有故事', x: 980, y: 1260, w: 450, h: 220, doorX: 1205, doorY: 1230, color: '#d69a87', roof: '#9b625e', icon: 'DORM', event: 'dorm' },
  { id: 'gym', name: '风雨体育馆', subtitle: '汗水会记得每一次坚持', x: 1770, y: 1080, w: 410, h: 240, doorX: 1975, doorY: 1050, color: '#80a08b', roof: '#527660', icon: 'SPORT', event: 'gym' },
  { id: 'club', name: '社团活动中心', subtitle: '遇见同频的人', x: 1640, y: 650, w: 310, h: 190, doorX: 1630, doorY: 790, color: '#b798b5', roof: '#826b8b', icon: 'CLUB', event: 'club' }
];

// 每个场景：scene 级美术配置 + 多个对话任务（quests）
const EVENTS = {
  library: {
    name: '图书馆', place: '图书馆 · 三层阅览区', speaker: '周予安', role: '总在同一个位置看书的学长', avatar: '周', color: '#6e87a6',
    art: { sky: ['#2c3a52', '#5b6b8c'], glow: '#f5d98a', motif: 'library' },
    quests: [
      {
        id: 'lib-1', title: '闭馆音乐响起之前', text: '闭馆音乐轻轻响起。你合上看了很久的参考书，却发现一道题仍没有头绪。邻座的周予安把一张便签推过来：“要不要试试换一种思路？”',
        choices: [
          { text: '和他一起拆解题干，整理自己的知识框架', hint: '学识 +8 · 精力 -12', effects: { knowledge: 8, energy: -12 }, reply: '你们把复杂的题目拆成几个小问题。走出图书馆时，夜色已经很深，但你的思路前所未有地清晰。' },
          { text: '先请他吃夜宵，聊聊大学里的学习方法', hint: '人缘 +6 · 学识 +3 · 精力 -6', effects: { social: 6, knowledge: 3, energy: -6 }, reply: '从错题本聊到社团，从专业聊到未来。你忽然发现，所谓前辈，也只是比你早走了几步的人。' },
          { text: '今天到此为止，去湖边吹吹风', hint: '心态 +7 · 精力 +10', effects: { mood: 7, energy: 10 }, reply: '你没有为难自己。晚风掠过湖面，未解的题依然在那里，但你已经攒好了明天再出发的力气。' }
        ]
      },
      {
        id: 'lib-2', title: '古籍修复室的午后', text: '图书馆角落的修复室里，老师正对着一页破损的旧书发愁。“缺个手稳心细的帮手。”她抬头看见了你。',
        choices: [
          { text: '戴上手套，陪她一点点修补书页', hint: '实践 +7 · 心态 +4 · 精力 -10', effects: { practice: 7, mood: 4, energy: -10 }, reply: '镊子夹起薄如蝉翼的补纸，你第一次觉得“慢”也是一种力量。旧书重获新生的那一刻，老师郑重地向你道谢。' },
          { text: '帮忙把修复过程做成数字化档案', hint: '学识 +5 · 实践 +5', effects: { knowledge: 5, practice: 5 }, reply: '你为每一页建立编号与影像档案。传统手艺与现代技术在你手里握了个手。' },
          { text: '安静读完了那本书的完整影印本', hint: '学识 +8 · 精力 -8', effects: { knowledge: 8, energy: -8 }, reply: '百年的文字穿过泛黄的纸页抵达你。离开时，你在借阅卡上郑重写下自己的名字。' }
        ]
      }
    ]
  },
  classroom: {
    name: '明德教学楼', place: '明德教学楼 · 203 教室', speaker: '许老师', role: '通识课教师', avatar: '许', color: '#b67d51',
    art: { sky: ['#31456b', '#7a8db3'], glow: '#ffe9b0', motif: 'classroom' },
    quests: [
      {
        id: 'cls-1', title: '被点名的三分钟', text: '课堂讨论陷入沉默。许老师看向你：“我想听听不同的观点，不用标准答案。”教室里安静下来，所有人都在等你的回应。',
        choices: [
          { text: '站起来，坦诚说出不成熟的想法', hint: '学识 +5 · 实践 +5 · 心态 +2', effects: { knowledge: 5, practice: 5, mood: 2 }, reply: '你的声音起初有些发紧，后来越说越流畅。老师没有评价对错，只追问了一个更深的问题——这正是思考开始的地方。' },
          { text: '先邀请同桌一起补充，再共同回答', hint: '人缘 +7 · 学识 +3', effects: { social: 7, knowledge: 3 }, reply: '你们一人一句，竟拼出了完整的答案。同桌悄悄松了口气，下课后约你下次继续组队。' },
          { text: '趁老师转身写板书，从后门溜出去', hint: '心态 +6 · 精力 +8 · 翘课会有连锁反应', effects: { mood: 6, energy: 8 }, chain: { event: 'roll-call', delay: 1 }, reply: '你把书包抱在胸前，沿着墙根溜进了走廊。阳光打在脸上的一瞬间，你觉得自己做了这学期最对的一件事——只是那时你还没想到，代价会在后面几周里一件件送到你面前。' }
        ]
      },
      {
        id: 'cls-2', title: '小组汇报前夜', text: '明晚就是小组汇报，可负责整合的同学突然病倒了。群里的消息停在半小时前，所有人都在等一个站出来的人。',
        choices: [
          { text: '接过整合工作，重新分配剩余任务', hint: '实践 +8 · 人缘 +4 · 精力 -14', effects: { practice: 8, social: 4, energy: -14 }, reply: '你把零散的稿件梳理成完整的逻辑线。第二天的汇报不算完美，但每个人都站在了自己该站的位置上。' },
          { text: '连夜给每位组员做一对一辅导', hint: '人缘 +8 · 学识 +4 · 精力 -12', effects: { social: 8, knowledge: 4, energy: -12 }, reply: '你没有替任何人完成任务，只是帮他们理清了自己的部分。散会时，群里第一次刷起了“辛苦了”。' }
        ]
      }
    ]
  },
  lab: {
    name: '创新实验楼', place: '创新实验楼 · 创客空间', speaker: '唐果', role: '机器人社成员', avatar: '唐', color: '#608e91',
    art: { sky: ['#1e3d46', '#4b7d84'], glow: '#a8e6d5', motif: 'lab' },
    quests: [
      {
        id: 'lab-1', title: '第 17 次失败', text: '样机第 17 次在终点前停下。唐果趴在桌边：“要不算了吧？”窗外天色渐暗，距离提交作品只剩最后一天。',
        choices: [
          { text: '重新检查日志，定位真正的故障', hint: '实践 +9 · 学识 +4 · 精力 -16', effects: { practice: 9, knowledge: 4, energy: -16 }, reply: '凌晨前，你们终于发现是一段被忽略的边界条件。小车冲过终点时，整个实验室都响起了欢呼。' },
          { text: '分工协作，同时测试三种可能方案', hint: '实践 +6 · 人缘 +5 · 精力 -10', effects: { practice: 6, social: 5, energy: -10 }, reply: '你们把焦虑拆成任务，把任务分给彼此。不是每种尝试都有结果，但每一种都让答案更近。' },
          { text: '暂停一小时，吃饱饭再回来', hint: '心态 +6 · 精力 +8 · 实践 +2', effects: { mood: 6, energy: 8, practice: 2 }, reply: '热腾腾的饭后，你们几乎立刻发现了问题。原来有时效率不是坚持不动，而是知道何时停下。' }
        ]
      },
      {
        id: 'lab-2', title: '开源社区的第一行代码', text: '唐果把屏幕转向你：“这个开源项目缺一个新手友好的小功能，很适合练手。敢不敢把你的名字写进贡献者名单？”',
        choices: [
          { text: '接下任务，从读懂别人的代码开始', hint: '学识 +6 · 实践 +7 · 精力 -14', effects: { knowledge: 7, practice: 7, energy: -14 }, reply: '提交被合并的那个深夜，你盯着“Merged”看了很久。世界某个角落的陌生人，正在运行你写的代码。' },
          { text: '先为项目补全中文文档与示例', hint: '学识 +6 · 人缘 +4 · 实践 +3', effects: { knowledge: 6, social: 4, practice: 3 }, reply: '清晰的文档让更多人得以入门。维护者给你留言：“好的文档和好的代码一样珍贵。”' }
        ]
      }
    ]
  },
  canteen: {
    name: '拾光食堂', place: '拾光食堂 · 二楼窗边', speaker: '阿岚', role: '刚转入专业的新同学', avatar: '岚', color: '#c98665',
    art: { sky: ['#5b3a33', '#b06a4e'], glow: '#ffd9a0', motif: 'canteen' },
    quests: [
      {
        id: 'can-1', title: '一张空出来的椅子', text: '午间食堂座无虚席。你端着餐盘寻找位置，看见阿岚独自坐在角落。她似乎不太适应新环境，餐盘里的饭几乎没动。',
        choices: [
          { text: '主动坐到对面，从“什么好吃”聊起', hint: '人缘 +8 · 心态 +3', effects: { social: 8, mood: 3 }, reply: '从糖醋排骨聊到家乡，你们交换了联系方式。后来你才知道，那句“这里有人吗”，是她那天听到的最温暖的话。' },
          { text: '帮她熟悉课程，分享一份校园攻略', hint: '人缘 +5 · 实践 +4', effects: { social: 5, practice: 4 }, reply: '你标出教学楼捷径、打印店和好吃的窗口。帮助别人复习生活，也让你重新认识了这座校园。' }
        ]
      },
      {
        id: 'can-2', title: '食堂阿姨的秘密菜单', text: '打饭窗口的阿姨看你总是最晚来，悄悄招手：“同学，后厨在试新菜，缺个尝味道的人，来不来？”',
        choices: [
          { text: '认真品尝，写下细致的改进建议', hint: '实践 +5 · 人缘 +5 · 心态 +2', effects: { practice: 5, social: 5, mood: 2 }, reply: '一周后，新菜挂上菜单，旁边多了一行小字：“感谢同学的建议”。阿姨每次见到你，都会多舀一勺。' },
          { text: '挽起袖子，帮后厨度过晚高峰', hint: '体魄 +5 · 实践 +6 · 精力 -10', effects: { fitness: 5, practice: 6, energy: -10 }, reply: '你第一次知道一份餐要经历多少双手。收工时阿姨塞给你一个热乎的烧饼：“好孩子，以后常来。”' }
        ]
      }
    ]
  },
  dorm: {
    name: '学生公寓', place: '学生公寓 · 412 寝室', speaker: '宋小满', role: '你的室友', avatar: '宋', color: '#a87988',
    art: { sky: ['#3a2f4a', '#7d6a8f'], glow: '#ffdca8', motif: 'dorm' },
    quests: [
      {
        id: 'dor-1', title: '凌晨一点的卧谈会', text: '熄灯后，宋小满忽然问：“你们觉得，毕业后的我们会在哪里？”黑暗里，没人急着回答。走廊尽头的灯还亮着。',
        choices: [
          { text: '坦诚聊聊自己的迷茫与期待', hint: '心态 +8 · 人缘 +4', effects: { mood: 8, social: 4 }, reply: '你们说起害怕的事，也说起小小的梦想。迷茫没有消失，但被说出口以后，似乎不再那么沉重。' },
          { text: '一起制定一个能实现的学期计划', hint: '学识 +4 · 实践 +6 · 心态 +2', effects: { knowledge: 4, practice: 6, mood: 2 }, reply: '你们没有写下宏大的目标，只约定早睡、运动和每周读完一本书。真正改变生活的，往往就是这样的小事。' }
        ]
      },
      {
        id: 'dor-2', title: '室友生病的那个雨夜', text: '暴雨敲打着窗户，宋小满忽然发起高烧。外卖停运，校医院在两公里外，宿舍楼下的积水已经没过了台阶。',
        choices: [
          { text: '背起她，蹚着水送去校医院', hint: '体魄 +6 · 人缘 +6 · 精力 -14', effects: { fitness: 6, social: 6, energy: -14 }, reply: '输液室的灯很白，她睡着前含糊地说了句“有你真好”。回程时雨停了，你浑身湿透，心里却暖的。' },
          { text: '联系宿管与同学，分工接力送医', hint: '人缘 +7 · 实践 +5 · 精力 -8', effects: { social: 7, practice: 5, energy: -8 }, reply: '有人找车，有人带药，有人垫付费用。那一夜你明白了，所谓靠谱，是懂得把事交给对的人。' }
        ]
      }
    ]
  },
  gym: {
    name: '风雨体育馆', place: '风雨体育馆 · 田径场', speaker: '陆教练', role: '校跑团发起人', avatar: '陆', color: '#56896d',
    art: { sky: ['#263d33', '#5e8a6a'], glow: '#ffe6a8', motif: 'gym' },
    quests: [
      {
        id: 'gym-1', title: '最后一圈', text: '跑到最后一圈，你的呼吸已经乱了。陆教练放慢脚步跟在旁边：“别盯着终点，先找到你自己的节奏。”',
        choices: [
          { text: '调整呼吸，坚持完成最后一圈', hint: '体魄 +9 · 心态 +3 · 精力 -14', effects: { fitness: 9, mood: 3, energy: -14 }, reply: '冲过终点时，你没有快过任何人，却超过了刚才想放弃的自己。晚霞落在跑道上，像一枚温柔的奖牌。' },
          { text: '和新认识的同学结伴慢跑', hint: '体魄 +5 · 人缘 +5 · 精力 -8', effects: { fitness: 5, social: 5, energy: -8 }, reply: '你们聊配速，也聊最近听的歌。原本漫长的跑道，因为有人并肩而变短了。' },
          { text: '量力而行，改为拉伸和散步', hint: '体魄 +4 · 心态 +5 · 精力 +4', effects: { fitness: 4, mood: 5, energy: 4 }, reply: '你学会听见身体的声音。坚持并不总是咬牙向前，也可以是长久而温和地照顾自己。' }
        ]
      },
      {
        id: 'gym-2', title: '校运会替补席', text: '校运会接力赛前十分钟，主力队员突然抽筋。陆教练看向你：“替补也是队员。上吗？”看台上的喧闹声一阵高过一阵。',
        choices: [
          { text: '站上跑道，拼尽全力跑完这一棒', hint: '体魄 +8 · 心态 +5 · 精力 -16', effects: { fitness: 8, mood: 5, energy: -16 }, reply: '你们没有拿到名次，但冲线时全队的欢呼比冠军还响。陆教练拍拍你的肩：“这就是体育。”' },
          { text: '退居后勤，保障全队状态', hint: '人缘 +6 · 实践 +4 · 心态 +2', effects: { social: 6, practice: 4, mood: 2 }, reply: '水、毛巾、号码布、加油声，你把每件小事都做到位。领奖台上，队友把你也拉进了合影。' }
        ]
      }
    ]
  },
  club: {
    name: '社团活动中心', place: '社团活动中心 · 排练厅', speaker: '顾星野', role: '学生会文艺部负责人', avatar: '顾', color: '#9679a2',
    art: { sky: ['#3d2f4f', '#8a6f9e'], glow: '#ffd9f0', motif: 'club' },
    quests: [
      {
        id: 'clu-1', title: '迎新晚会救场计划', text: '晚会开始前一小时，设备突然出现故障。顾星野抱着一摞流程表冲进来：“现在缺一个能协调大家的人，你愿意试试吗？”',
        choices: [
          { text: '接下协调工作，逐项确认备选方案', hint: '实践 +8 · 人缘 +5 · 精力 -12', effects: { practice: 8, social: 5, energy: -12 }, reply: '灯光重新亮起时，没人知道后台经历了什么。你站在侧幕旁，第一次感受到“被需要”也是一种成长。' },
          { text: '发挥创意，把等待变成观众互动', hint: '人缘 +7 · 心态 +4 · 实践 +3', effects: { social: 7, mood: 4, practice: 3 }, reply: '一个即兴小游戏让等待变成欢笑。意外没有被完全消灭，却被你们变成了晚会最特别的记忆。' }
        ]
      },
      {
        id: 'clu-2', title: '只属于我们的毕业歌', text: '社团计划为毕业季写一首原创歌。顾星野把歌词本递给你：“旋律有了，就差一段真正属于我们的词。”',
        choices: [
          { text: '写下这几年真实的校园记忆', hint: '心态 +6 · 人缘 +6 · 实践 +3', effects: { mood: 6, social: 6, practice: 3 }, reply: '首演那晚，唱到“湖畔的灯一盏盏熄灭”时，台下很多人悄悄红了眼眶。原来真诚永远是最好的歌词。' },
          { text: '负责编曲录制，把旋律做到完美', hint: '实践 +8 · 学识 +4 · 精力 -12', effects: { practice: 8, knowledge: 4, energy: -12 }, reply: '你逐轨调整每一个细节。成品放出时，评论区刷满了“这是我们学校的声音”。' }
        ]
      }
    ]
  },
  lake: {
    name: '青梧湖', place: '青梧湖 · 湖畔长椅', speaker: '未来的自己', role: '校园隐藏事件', avatar: '我', color: '#5b9a98',
    art: { sky: ['#1f3a4a', '#5d93a0'], glow: '#dff5f0', motif: 'lake' },
    quests: [
      {
        id: 'lake-1', title: '湖心岛的一封慢信', text: '你在长椅缝里发现一封没有署名的信：“亲爱的新同学，不必急着成为谁。大学不是一张标准答卷，而是一段允许试错的路。”',
        choices: [
          { text: '给学期结束的自己写一封回信', hint: '心态 +8 · 学识 +2', effects: { mood: 8, knowledge: 2 }, reply: '你写下此刻的期待，也写下对自己的宽容。信封投入邮筒时，未来仿佛不再那么遥远。' },
          { text: '沿湖走一圈，认真看看这座校园', hint: '体魄 +4 · 心态 +5 · 精力 +5', effects: { fitness: 4, mood: 5, energy: 5 }, reply: '你记住了风穿过柳树的方向，也记住了此刻轻松的心情。熟悉一个地方，是从愿意为它停留开始。' }
        ]
      },
      {
        id: 'lake-2', title: '毕业季的天台约定', text: '大四的夏夜，你和朋友们坐在湖边看星星。有人提议：“十年后的今天，我们回到这里，看看彼此变成了什么样。”',
        choices: [
          { text: '郑重许下约定，并写下来埋在老地方', hint: '心态 +7 · 人缘 +6', effects: { mood: 7, social: 6 }, reply: '铁盒埋进湖畔的泥土里，装着每个人的心愿。无论十年后身在何处，这个夏夜都会替你们记得。' },
          { text: '什么都不说，安静记住这一刻', hint: '心态 +9 · 精力 +6', effects: { mood: 9, energy: 9 }, reply: '有些时刻不需要誓言。湖水、星光和身边的人，已经足够成为一生的珍藏。' }
        ]
      }
    ]
  }
};

const NPCS = [
  { id: 'npc1', name: '周予安', x: 1110, y: 430, color: '#6e87a6', hair: '#3a302c', skin: '#f7d3b6', hairStyle: 'long', pants: '#4d5b70', avatar: 'npc1_avatar.png', event: 'library' },
  { id: 'npc2', name: '许老师', x: 500, y: 560, color: '#b67d51', hair: '#534237', skin: '#efc6a4', hairStyle: 'short', pants: '#5a4b40', accessory: 'glasses', avatar: 'npc2_avatar.png', event: 'classroom' },
  { id: 'npc3', name: '唐果', x: 1850, y: 510, color: '#608e91', hair: '#312b31', skin: '#ffd9bd', hairStyle: 'ponytail', pants: '#455a5e', avatar: 'npc3_avatar.png', event: 'lab' },
  { id: 'npc4', name: '阿岚', x: 650, y: 1150, color: '#c98665', hair: '#633e35', skin: '#e8b795', hairStyle: 'messy', pants: '#5e4a3d', avatar: 'npc4_avatar.png', event: 'canteen' },
  { id: 'npc5', name: '宋小满', x: 1480, y: 1310, color: '#a87988', hair: '#3d292b', skin: '#fbd6bb', hairStyle: 'long', pants: '#5a4a58', avatar: 'npc5_avatar.png', event: 'dorm' },
  { id: 'npc6', name: '陆教练', x: 1810, y: 980, color: '#56896d', hair: '#2f332e', skin: '#dfae8a', hairStyle: 'short', pants: '#3d4b44', avatar: 'npc6_avatar.png', event: 'gym' },
  { id: 'npc7', name: '顾星野', x: 1540, y: 820, color: '#9679a2', hair: '#403247', skin: '#f3c9b0', hairStyle: 'ponytail', pants: '#4a4058', avatar: 'npc7_avatar.png', event: 'club' },
  { id: 'npc8', name: '湖边信使', x: 1080, y: 850, color: '#5b9a98', hair: '#364747', skin: '#f0ccb0', hairStyle: 'messy', pants: '#3f5352', avatar: 'npc8_avatar.png', event: 'lake' }
];

const ENDINGS = [
  { id: 'scholar', title: '群星之间的求知者', tag: '学术深造', text: '四年过去，图书馆闭馆的灯光成了你最熟悉的夜色。毕业那天，你收到了深造录取通知。未来的路依旧漫长，但你早已学会与未知相处。', color: '#6687ad' },
  { id: 'leader', title: '让每个人发光的人', tag: '学生领袖', text: '四年里，你从人群中的倾听者变成了连接每个人的人。毕业典礼上，你作为学生代表发言。掌声响起时，你知道自己真正想守护的是什么。', color: '#a57b9c' },
  { id: 'maker', title: '把想法变成现实的人', tag: '创新实践', text: '四年里，你把一个又一个想法变成了真实的作品。毕业展上，你的项目前围满了人。那些失败的深夜，此刻都成了勋章。', color: '#5b9291' },
  { id: 'sunshine', title: '认真生活的追光者', tag: '温暖人生', text: '四年里，你学会了努力，也学会了休息；学会了向前，也学会了照顾身边的人。毕业照里，你的笑容和四年前一样明亮。', color: '#d18d69' },
  { id: 'ordinary', title: '正在生长的普通大人', tag: '未来可期', text: '四年过去，你没有成为最耀眼的人，却认真走过了每一天。学位帽抛向天空的那一刻，你知道：人生才刚刚开始。', color: '#7d9275' }
];

// 10 题题库，每学期轮换 5 题
const EXAM_BANK = [
  { question: '面对一个没有标准答案的复杂问题，更合理的第一步是？', options: ['等待别人给出结论', '拆解问题并确认已知条件', '直接选择最熟悉的答案', '回避问题'], answer: 1 },
  { question: '团队项目临近截止却出现故障，哪种做法最有效？', options: ['隐瞒问题', '一个人承担全部工作', '同步信息并拆分验证任务', '立即放弃项目'], answer: 2 },
  { question: '长期高压学习时，哪种安排更可持续？', options: ['持续熬夜', '完全停止学习', '只在考试前复习', '规律作息并拆分阶段目标'], answer: 3 },
  { question: '与新同学合作时，建立信任更好的方式是？', options: ['认真倾听并兑现承诺', '只表达自己的想法', '把所有任务交给别人', '避免任何分歧'], answer: 0 },
  { question: '一次尝试失败后，最有价值的行动是？', options: ['否定自己的能力', '记录反馈并调整方案', '重复完全相同的做法', '不再进行任何尝试'], answer: 1 },
  { question: '小组意见严重分歧时，成熟的做法是？', options: ['投票后不再讨论', '让职位最高的人决定', '先对齐共同目标再比较方案', '各自做各自的版本'], answer: 2 },
  { question: '接到一个完全陌生的任务，最高效的开局是？', options: ['立刻动手试一下', '先弄清交付标准与时间线', '找别人代做', '拖延到最后一刻'], answer: 1 },
  { question: '期末周时间紧张，复习策略更合理的是？', options: ['平均分配所有科目', '按权重与薄弱点排优先级', '只看最擅长的科目', '通宵刷题不休息'], answer: 1 },
  { question: '朋友向你倾诉烦恼，更好的回应是？', options: ['立刻给出一堆建议', '讲自己更惨的经历', '先倾听并确认对方的感受', '转移话题活跃气氛'], answer: 2 },
  { question: '大学四年最值得投资的资产是？', options: ['昂贵的外设装备', '成绩单上的数字', '可迁移的能力与真诚的关系', '社交平台上的粉丝数'], answer: 2 }
];

function getExamQuestions(semester) {
  const offset = ((semester - 1) * 5) % EXAM_BANK.length;
  const result = [];
  for (let i = 0; i < 5; i++) result.push(EXAM_BANK[(offset + i) % EXAM_BANK.length]);
  return result;
}

// 好感度分档：数值越高，NPC 越愿意为你多走一步
const AFFINITY_TIERS = [
  { min: 50, name: '挚友', color: '#c07a5a' },
  { min: 30, name: '亲近', color: '#8a9a6a' },
  { min: 10, name: '熟悉', color: '#6e87a6' },
  { min: -999, name: '生疏', color: '#9a958a' }
];

function affinityTier(value) {
  return AFFINITY_TIERS.find(tier => value >= tier.min) || AFFINITY_TIERS[AFFINITY_TIERS.length - 1];
}

// NPC 主动找上门的请求：答应或拒绝，都会写进你们之间的关系
const REQUESTS = [
  {
    id: 'req-npc1-a', npc: 'npc1', title: '还差一个人',
    text: '周予安敲开自习室的玻璃门，手里抱着一摞刚打印出来的文献：“这周的读书会临时缺一个人，我第一个想到你。要是有空的话……”他说话时有点不好意思，但你注意到那摞文献已经分好了两份。',
    requires: { affinity: 0, semester: 1 },
    choices: [
      { text: '答应下来，顺手帮他把文献索引也整理了', reply: '你们在空教室待到很晚。讨论结束后他把最后一篇综述递给你：“下周的分享，你来做吧。”', effects: { knowledge: 5, social: 4, energy: -8 }, affinity: 8 },
      { text: '这周实在排不开，改天再说', reply: '他点点头，把文献放回书包：“没事，你忙你的。”走的时候他回头补了一句“那也挺好的”，语气轻得像怕你听出别的意思。', effects: { mood: -3 }, affinity: -5 }
    ]
  },
  {
    id: 'req-npc1-b', npc: 'npc1', title: '旧书该有个去处了',
    text: '周予安在旧书箱前蹲了很久，翻出一本缺了封面的册子：“修复室那边在找懂行的人搭把手。我想到了你——你上次补页的手，稳。”',
    requires: { affinity: 30, semester: 3 },
    choices: [
      { text: '答应他，去修复室搭把手', reply: '旧纸的气味混着浆糊的清冽。你埋头修了整整两个周末，周予安每次都在旁边递工具。你们没怎么说话，但那摞书又厚了一指。', effects: { practice: 6, knowledge: 4, mood: 3, energy: -10 }, affinity: 10 },
      { text: '最近手头太乱，先不接了', reply: '他把册子放回箱子里，合上盖子时比平时用力一点。“理解，理解。”他说。那之后的好几天，他都没再找你。', effects: { mood: -2 }, affinity: -6 }
    ]
  },
  {
    id: 'req-npc3-a', npc: 'npc3', title: '最后一次通宵，还缺一双手',
    text: '唐果半夜十二点发来消息，附了一张示波器的照片：“车能跑了，但刹车那段老抖。明天就是最后一次调试，求你，来不来？不来我也自己调，就是可能调不出来。”',
    requires: { affinity: 0, semester: 2 },
    choices: [
      { text: '去，熬这一宿', reply: '凌晨四点，终于刹住了。唐果瘫在椅子上，忽然跳起来抱住你：“成了！明年一定要一起上场。”', effects: { practice: 7, energy: -14 }, affinity: 9 },
      { text: '太晚了，明天还有早课', reply: '他没有多说，只回了个“好的”。第二天路过实验楼，你看见他一个人抱着示波器进去，背影比平时小一号。', effects: { mood: -4 }, affinity: -6 }
    ]
  },
  {
    id: 'req-npc3-b', npc: 'npc3', title: '想请你当一次答辩评委',
    text: '唐果把评委表推到你面前，指了指空着的那一格：“社里的评委都是熟人，我不想让他们手下留情。你来，你不会放过我。”',
    requires: { affinity: 30, semester: 4 },
    choices: [
      { text: '答应他，认真问每一个问题', reply: '你的第三个问题让他卡了整整十秒。答辩结束后他长出一口气：“谢了。下次换我问别人。”', effects: { practice: 6, social: 5, knowledge: 3 }, affinity: 10 },
      { text: '自己也是学生，当评委不合适', reply: '他有点意外，随即把表收回去：“那也对。”接下来一整天，他都没再提这件事。', effects: { mood: -3 }, affinity: -7 }
    ]
  },
  {
    id: 'req-npc4-a', npc: 'npc4', title: '我不敢一个人去',
    text: '阿岚在教学楼门口站了很久，看见你才小跑过来：“我听说这个讲座要提前占位……我可以站你旁边吗？我怕一个人进去会不知道该坐在哪。”',
    requires: { affinity: 0, semester: 1 },
    choices: [
      { text: '带她一起进去，帮她占了个好位置', reply: '讲座结束后她说了整整十分钟她听懂的部分。你注意到她比刚转来时话多了很多。', effects: { social: 6, mood: 4 }, affinity: 9 },
      { text: '你先进去，她可以自己找位子', reply: '她往后退了半步，说了声“没事”，自己找了个角落坐下。你进场时，她正盯着手机屏幕。', effects: { mood: -2 }, affinity: -6 }
    ]
  },
  {
    id: 'req-npc4-b', npc: 'npc4', title: '可以陪我去面试吗',
    text: '阿岚攥着简历站在宿舍楼下，手心捏出了折痕：“下午的面试……我想找个人在外面等我。面试完告诉我结果就好，别的不用说。”',
    requires: { affinity: 30, semester: 3 },
    choices: [
      { text: '陪她去，在外面等她出来', reply: '她出来时脸是红的，把水递给你才发现自己一直在抖。她拿到实习 offer 的消息是晚上十一点发来的，只有一个字：“谢。”', effects: { social: 7, practice: 4, mood: 4, energy: -8 }, affinity: 11 },
      { text: '那天你有事，实在陪不了', reply: '她说“没事的”，然后自己去了。晚上她发来面试通过的截图，多打了一行：“谢谢你说的加油。”但你记得自己并没有说过。', effects: { mood: -4 }, affinity: -8 }
    ]
  },
  {
    id: 'req-npc5-a', npc: 'npc5', title: '帮我占个座儿？',
    text: '宋小满把书包往桌上一放，压低声音：“阶梯教室只剩最后一排了，你先去占座，我去买瓶水，马上回来！”说完人已经跑出了门。',
    requires: { affinity: 0, semester: 1 },
    choices: [
      { text: '占好座，等她回来', reply: '她回来时水洒了半瓶，笑着把纸巾递给你：“谢啦，我欠你一顿。”这顿饭后来真的吃了，就在食堂二楼。', effects: { social: 5, mood: 3 }, affinity: 7 },
      { text: '位置留给别人了，你坐到了后排', reply: '她回来的时候在门口愣了两秒，然后若无其事地坐到最后一排。下课你们谁都没提这件事。', effects: { mood: -1 }, affinity: -4 }
    ]
  },
  {
    id: 'req-npc5-b', npc: 'npc5', title: '这周末，回不回老家？',
    text: '熄灯前的卧谈会，宋小满忽然问：“你周末回老家吗？我妈问我学校的事，我一张嘴就‘还行’……其实我也不知道该怎么讲。你要是也回去，我可以跟我一起想想怎么说。”',
    requires: { affinity: 20, semester: 2 },
    choices: [
      { text: '陪她一起想，认真聊了整晚', reply: '你们轮流说着说着就天亮了。她说：“原来不是我不知道怎么讲，是我没敢真的讲。”', effects: { mood: 6, social: 4 }, affinity: 8 },
      { text: '你说你也还没想好', reply: '“那算了。”她翻了个身。宿舍安静下来之后，你听见对面床铺轻微的翻身声，一整晚。', effects: { mood: -2 }, affinity: -5 }
    ]
  },
  {
    id: 'req-npc7-a', npc: 'npc7', title: '迎新晚会的节目，还差一个主角',
    text: '顾星野把流程表卷成筒敲了敲桌面：“节目单上有一个空位，原本的主角家里有事来不了。我不想随便拉个人凑数——你来，这台戏你撑得住。”',
    requires: { affinity: 0, semester: 2 },
    choices: [
      { text: '接下这个角色，把整台节目扛下来', reply: '彩排到深夜，散场时后台只剩你们两个人和一地荧光棒。他说：“我就知道没找错人。”', effects: { practice: 6, social: 5, energy: -10 }, affinity: 9 },
      { text: '推掉这个位置，你不适合站那种舞台', reply: '他点点头，把流程表上的名字划掉，换了个不相干的人。“也行，”他说，“反正总得有人上。”', effects: { mood: -3 }, affinity: -5 }
    ]
  },
  {
    id: 'req-npc7-b', npc: 'npc7', title: '学生会换届，想推荐你',
    text: '顾星野把一份竞选表推过来，笔已经拧开了：“换届名单上我想写你的名字。不是因为我需要一个能干的帮手——是因为这四年的事，我看着你一件一件做成过。”',
    requires: { affinity: 40, semester: 4 },
    choices: [
      { text: '在竞选表上签下自己的名字', reply: '接下来一个月，你学会了怎么在会议里推进事情，也学会了怎么在失败之后不下台。那年你们拿下了社团年度评选。', effects: { social: 8, practice: 5, mood: 4, energy: -12 }, affinity: 12 },
      { text: '你只想当个普通的同学', reply: '他把笔盖盖好，点了点头：“也好，你本来就该做你自己。”可那之后，他再没提过类似的话。', effects: { mood: -4 }, affinity: -8 }
    ]
  }
];

// 连锁事件：一次翘课会滚成 点名 → 辅导员谈话 → 家长来电
// next 指向下一级，nextDelay 是它隔几周才发作；没有 next 就是链子的尽头
const CHAIN_EVENTS = {
  'roll-call': {
    id: 'roll-call', level: 1, title: '迟到的第三次点名',
    speaker: '许老师', role: '通识课教师', place: '明德教学楼 · 203 教室', scene: 'classroom',
    text: '第三次点名。你的书包还挂在肩上，鞋带散了两次才一路小跑过来。许老师的手指在名单上停住了，整间教室安静下来，所有人都在等你的解释。“这位同学，请说明一下。”',
    choices: [
      { text: '站起来认了，说昨晚赶实验到太晚', reply: '你站起来的瞬间，几十道目光一起落下来。老师看了你很久，最后只说了一句：“下次记得，困了可以请假。”下课后，她在走廊里叫住你，说这事记下了但不算处分。', effects: { mood: -4, knowledge: 2, practice: 1 } },
      { text: '小声说“我马上就到”', reply: '“马上就到”是最没有说服力的四个字。你含混地答了一句，教室里的目光像针一样扎在背上。你很清楚，这件事不会就这么过去。', effects: { mood: -3, practice: 2 } }
    ],
    next: 'counselor-talk', nextDelay: 2
  },
  'counselor-talk': {
    id: 'counselor-talk', level: 2, title: '辅导员办公室的谈话',
    speaker: '沈老师', role: '辅导员', place: '学工楼 · 辅导员办公室', scene: 'classroom',
    text: '你被叫进了辅导员办公室。沈老师把一份考勤记录推到你面前，上面是同一个名字的三次迟到。“我不问你为什么，我只想知道你现在过得怎么样。”她把茶推过来，示意你坐下。',
    choices: [
      { text: '坐下来，把这阵子真实的状态说一遍', reply: '你从翘课那天讲起，讲到最近的睡眠和那些说不出口的压力。沈老师听完只说了一句：“需要的话，我帮你调一次课。”那天下午的谈话，比任何一次安慰都管用。', effects: { mood: 6, social: 3, energy: 4 } },
      { text: '说一切都好，没什么好谈的', reply: '“那就好。”她点点头，把考勤记录收回去。你转身要走时，她叫住你：“下次别等我问。”门在身后合上，声音很轻。', effects: { mood: -3, knowledge: 1 } }
    ],
    next: 'parent-call', nextDelay: 2
  },
  'parent-call': {
    id: 'parent-call', level: 3, title: '家里来的电话',
    speaker: '妈妈', role: '家人', place: '学生公寓 · 412 寝室', scene: 'dorm',
    text: '晚上十一点，手机在枕头边震了一下。屏幕上跳出来两个字：妈妈。你接起来，那边先是很长的沉默，然后她说：“我听你辅导员说了一些事……我不吵你，我就问问，你最近到底怎么样。”',
    choices: [
      { text: '如实告诉她，承认自己最近有点撑不住', reply: '电话那头安静了一会儿，然后她说：“你怎么不早说。”她没有责怪你，只是让你这周末回家一趟，说要给你炖汤。挂断之后你在楼道里坐了很久，觉得轻了一点。', effects: { mood: 8, energy: 6, social: 2 } },
      { text: '轻描淡写，说只是最近有点忙', reply: '“哦，那你忙吧。”电话挂得很快。屏幕暗下去，映出你自己有点发慌的脸。你忽然明白，她其实早就知道了。', effects: { mood: -5, energy: -4 } }
    ],
    next: null
  }
};

module.exports = { CHARACTERS, STAT_META, BUILDINGS, EVENTS, NPCS, ENDINGS, EXAM_BANK, REQUESTS, CHAIN_EVENTS, AFFINITY_TIERS, affinityTier, getExamQuestions, semesterLabel, YEAR_NAMES };
