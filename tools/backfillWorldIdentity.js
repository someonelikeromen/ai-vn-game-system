// Backfill worldIdentity for existing world archives.
// One-off maintenance script. Safe to re-run; it only fills missing identities.

const fs = require('fs');
const path = require('path');

const archivesPath = path.join(__dirname, '..', 'data', 'world-archives.json');

function loadArchives() {
  if (!fs.existsSync(archivesPath)) return [];
  return JSON.parse(fs.readFileSync(archivesPath, 'utf-8')) || [];
}

function saveArchives(list) {
  fs.writeFileSync(archivesPath, JSON.stringify(list, null, 2), 'utf-8');
}

function makeIdentity(a) {
  const name = null; // 保持角色原名，由角色卡决定
  const base = {
    name,
    title: '',
    occupation: '',
    background: '',
    coreMemories: [],
    socialConnections: [],
  };

  const key = a.worldKey || '';
  const world = a.displayName || key || '未知世界';
  const loc = a.initialLocation || '未指定起点';

  // 针对已存在的典型世界，给出略有针对性的「本地人身份」；禁止出现“穿越者/外来者/无限武库”等元叙事字样
  switch (key) {
    case 'Highschool_of_the_Dead_2006':
      return {
        ...base,
        title: '床主市本地居民',
        occupation: '藤美学园附近便利店夜班店员',
        background:
          '你从小在床主市长大，对藤美学园一带的街区和小巷了如指掌。平日里只是在便利店上夜班、顺手帮同学修修电脑，' +
          '从没想过有一天要靠记得哪条巷子有铁门、哪栋楼有应急楼梯，来决定一群人的生死。',
        coreMemories: [
          '你曾在深夜打工回家路上目击第一起“咬人事件”，当时只以为是醉汉斗殴，几天后才意识到那是噩梦的开端。',
          '你带路让一小队幸存者绕开堵满车辆的主干道，从一条连本地人都少走的河堤小路撤离成功。',
          '你亲眼看见有人因为慌乱推倒同伴，导致对方被死体淹没，那一刻你意识到真正危险的不是病毒，而是人心。',
        ],
        socialConnections: [
          { name: '便利店店长', relation: '前上司', note: '总说你“有点呆，但很靠谱”，爆发当天失联。' },
          { name: '藤美学园学生小队', relation: '同路人', note: '你负责记路和找物资，他们负责挥刀和开枪。' },
        ],
      };

    case 'Muv_Luv_Alternative':
      return {
        ...base,
        title: '战术机维护班技师',
        occupation: '联合国远东司令部·育空基地战术机整备班成员',
        background:
          '你从地方机修厂一路考核进了育空基地的战术机整备班，每天面对的是渗着液压油味道的钢铁机体和互相打趣的驾驶员。' +
          '你知道自己上不了前线，只能通过把每一台战术机的螺丝拧到极限来守护那些坐在驾驶舱里的家伙。',
        coreMemories: [
          '第一次走进格纳库，抬头看着被维修灯照得发白的战术机，你突然感到一种说不出的恐惧——那不是帅气，而是“这里每天都会有人死”。',
          '你曾在出击前夜加班到凌晨，只为给某位驾驶员换上一套你私下改良过的关节润滑配方，结果在归舰报告中看到他多撑了整整三分钟。',
          '有一次任务失败，回收回来的只有一只沾着血迹的战术机臂，你默默帮忙把编号抹掉，假装那台机体从未存在过。',
        ],
        socialConnections: [
          { name: '教导队某位教官', relation: '熟人', note: '嘴上嫌你动作慢，出击前总会检查你负责的机体。' },
          { name: '年轻驾驶员小队', relation: '半个朋友', note: '他们打趣叫你“老妈子”，却把性命交给你动的每一颗螺丝。' },
        ],
      };

    case 'Gundam_SEED_CE71_73':
      return {
        ...base,
        title: '奥布造船厂技术员',
        occupation: '奥布联合首长国·曙光社 MS 开发部门基层工程师',
        background:
          '你在奥布出生长大，考进了曙光社的机动战士开发部门，一开始只负责在图纸上画螺丝和电缆走线。' +
          '战争把这个中立小国推上了风口浪尖，你也在一次次紧急加班中，慢慢意识到自己画下的那条电缆，很可能决定某个驾驶员能否活着回来。',
        coreMemories: [
          '第一次站在试作 MS 的脚边，你抬头几乎看不清它的头部，只能从钢板的焊痕里想象驾驶舱里那个人的呼吸。',
          '你曾偷偷在废弃的 OS 代码里留下一行注释，吐槽“谁写的垃圾逻辑”，第二天就被前辈拍肩膀补上一句：“那是我年轻时写的”。',
          '当奥布的天空被战火染红，你在机库里帮人关舱门，却突然发现自己手在发抖——不是因为爆炸，而是因为你终于意识到这里也是战场的一部分。',
        ],
        socialConnections: [
          { name: '曙光社老工程师', relation: '师傅', note: '爱骂人，但会在下班后给你讲旧时代飞行器的故事。' },
          { name: '测试驾驶员班某成员', relation: '熟人', note: '常在调试休息时和你聊“要是没有战争就好了”。' },
        ],
      };

    case 'CodeGeass_Lelouch_Rebellion':
      return {
        ...base,
        title: '十一区本地学生',
        occupation: '11区租界附近高校的普通学生，兼职打工',
        background:
          '你出生在被改名为“11区”的这片土地，从小在租界与旧日本街区的夹缝里长大。' +
          '父母只是普通上班族，你每天挤电车去学校、放学打工补贴家用，对帝国与反抗军的事情既恐惧又麻木——直到某天，战火烧进了你熟悉的街道。',
        coreMemories: [
          '你曾亲眼看见皇族车队经过，街上的人被迫跪下，那一刻你第一次真正理解了“被征服”的含义。',
          '一次放学回家时，你被卷入 KMF 巷战的余波，看见一栋熟悉的居民楼在你面前被贯穿，粉尘和尖叫填满了整条街。',
          '你在深夜偷偷听收音机里播报的“恐怖分子袭击事件”，却从附近人的只言片语里，听出了另外一种说法。',
        ],
        socialConnections: [
          { name: '便利店老板', relation: '打工雇主', note: '总说“少看新闻，多搬箱子才是你能做的事”。' },
          { name: '同班同学（布里塔尼亚籍）', relation: '同学', note: '对你不坏，却习惯性用俯视的语气说话。' },
        ],
      };

    case 'Attack_on_Titan_Mainline':
      return {
        ...base,
        title: '托罗斯特区居民',
        occupation: '托罗斯特区城墙内的普通店家孩子／临时兵',
        background:
          '你在罗塞之墙内的托罗斯特区长大，从小听着关于“巨人”和“墙外世界”的传说长大，却从未真正在意——直到那一天，天空被一个比墙还高的脸遮住。' +
          '你没有天赋成为调查兵团里的怪物，只是一个被形势推着上阵的普通人。',
        coreMemories: [
          '儿时曾被父母抱着站在城墙阴影下，看着驻扎兵团换岗，觉得那些披着绿斗篷的人很帅。',
          '托罗斯特失守那天，你一边搬东西一边被人推搡着往内门跑，耳边全是“小心后颈！”的喊声。',
          '你第一次拿起立体机动装置时，手一直在抖——不是因为高度，而是因为你知道自己和巨人之间只隔着一条钢缆。',
        ],
        socialConnections: [
          { name: '托罗斯特区杂货铺老板', relation: '邻居', note: '小时候常给你塞几颗糖，后来看见他家门口只剩下血迹。' },
          { name: '同期训练兵', relation: '战友', note: '你们互相吐槽教官的训话，其实都在害怕下次出墙。' },
        ],
      };

    case 'One_Piece_Grand_Line':
      return {
        ...base,
        title: '香波地群岛本地居民',
        occupation: '香波地群岛涂装工坊学徒／酒馆杂工',
        background:
          '你在香波地群岛长大，童年记忆里都是冒泡的红树树脂、天龙人经过时被迫跪下的人群、还有被海军追着跑的海贼。' +
          '你只是个在工坊和酒馆之间跑腿的学徒，却亲眼看着一个个“传说中的名字”出现在自己眼前。',
        coreMemories: [
          '你第一次亲眼看见天龙人牵着“人”的锁链经过，老板一把把你按到柜台底下，捂住了你的嘴。',
          '有一次海军和海贼在街上交火，你躲在倒下的酒桶后面，闻着洒出来的酒味和血腥味混在一起的气味。',
          '你曾帮某个看起来很笨的草帽小子指路，对方笑着道谢，还顺手把你从天龙人的视线里拉开。',
        ],
        socialConnections: [
          { name: '工坊老板', relation: '师傅', note: '只关心你刷树脂刷得干不干净，对外面的风浪不感兴趣。' },
          { name: '酒馆常客老海贼', relation: '半个亲戚', note: '总在酒后给你讲新世界的故事。' },
        ],
      };

    case 'Ultraman_Tiga_1996':
      return {
        ...base,
        title: 'TPC 后勤职员',
        occupation: 'TPC 远东总部情报室的普通数据录入员',
        background:
          '你通过普通考试进了 TPC 情报室，每天的工作就是把现场队发回来的影像和传感器数据整理归档。' +
          '对于“巨人”和“怪兽”，你最开始只是觉得“真厉害”，后来才慢慢意识到，那意味着人类自己什么都做不到。',
        coreMemories: [
          '第一次在大屏上看到巨大光之巨人和怪兽对打时，你忘了手上还拿着报告，结果被主管训了一顿。',
          '你加班整理过一次几乎被列为绝密的录像，那里面的巨大光芒让画面摄像机都失真，你却反复看了好几遍。',
          '某次城市疏散演练中，你被临时调到现场做记录，看见普通人在警报声中惊慌奔跑的样子，突然觉得自己整天敲键盘的工作也许真有点用。',
        ],
        socialConnections: [
          { name: '情报室前辈', relation: '同事', note: '经常请你帮忙代班，却也会在你加班时塞你一罐咖啡。' },
          { name: '附近便利店店员', relation: '熟人', note: '见证你从普通上班族变成每天盯着怪兽新闻的人。' },
        ],
      };

    default: {
      // 通用模板：不剧透世界，只给一个中性、本地人的身份
      const occ = `在「${world}」世界中的普通居民`;
      return {
        ...base,
        title: '本地居民',
        occupation: occ,
        background:
          `你从小或在很早的时候就来到了「${world}」，在 ${loc} 一带生活与行动。` +
          '你没有显赫的头衔，也不是注定的主角，只是在这个世界的规则之下，努力维持一份勉强算安稳的日常。',
        coreMemories: [
          '童年时你曾在街角或田野里，看见过一次足以影响一生的奇景——那之后你才真正意识到这个世界并不普通。',
          '你在一场意外或冲突中被迫做出选择，从那之后你看待“强者”和“普通人”的方式发生了改变。',
          '你明白了一个事实：不管世界多么宏大，大多数人的故事都只会发生在几条街、几座山、几片海之间。',
        ],
        socialConnections: [
          { name: '邻居／同事', relation: '日常关系', note: '和你一起抱怨天气、物价和上司，却从不谈论世界的走向。' },
        ],
      };
    }
  }
}

function main() {
  const archives = loadArchives();
  let changed = 0;
  const updated = archives.map((a) => {
    const wi = makeIdentity(a);
    changed++;
    return { ...a, worldIdentity: wi };
  });
  saveArchives(updated);
  console.log(`Backfilled worldIdentity for ${changed} archive(s).`);
}

main();

