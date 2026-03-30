'use strict';
/**
 * Character Prompt — personality quiz generation and character creation.
 * Uses sub-model (shop API). Hard anti-rationalization principles.
 * Data format aligned with [InitVar]InfiniteArmory templates v13.6.
 */

// ─── Shared Anti-Rationalization Directive ────────────────────────────────────
const ANTI_RATIONAL = `
==== 【反理性化铁律 — 必须遵守】 ====

你正在创作一个真实的人，不是机器人，不是故事里的主角，不是道德楷模。

禁止项（出现则为失败）：
✗ 禁止"冷静分析局势"式的人格描述
✗ 禁止"缺陷是暗地里的优点"（如"看起来冷漠其实很温柔"——这不叫缺陷）
✗ 禁止用战略思维描述普通情绪（不要写"他会理性评估风险"，真实的人会害怕、会逃避）
✗ 禁止天赋异禀、命中注定、比同龄人强的设定（除非输入中明确有）
✗ 禁止把创伤处理成"使他变得更强"（创伤制造的是破洞，不是铠甲）
✗ 禁止用形容词堆砌性格（不要写"他是个勇敢、坚定、有责任感的人"）
✗ 禁止"在关键时刻总能做出正确决定"
✗ 禁止性格描述中全是优点，缺陷只有"有时候太努力"

必须包含的内容：
✓ 有血有肉的真实人，不是完美主角
✓ 日常行为而非英雄行为（他早上不想起床、他有时候因为小事烦躁一整天）
✓ 性格由具体的经历塑造，不是抽象的"天性"

【忠实原则】：
- 输入中已有的性格/缺点/渴望/恐惧描述，直接采用并具体化，不要重新发明
- 输入中没有的内容，只做合理补全，强度和数量与输入信息的密度保持一致
- 不要强行套用"必须有X类型缺陷/Y类型恐惧"的模板，角色有什么就写什么，没有的不要造

==== 【反机器人原则】 ====
真实的人：
- 面对困难会拖延、否认、找借口，而不是"制定计划逐步解决"
- 人际关系里有边界不清、有依赖、有小心眼、有嫉妒
- 价值观会在现实压力下妥协，有时候会干自己不认同的事
- 内心想法和外在行为经常不一致
- 情绪会被鸡毛蒜皮的小事影响`;

// ─── Personality Quiz System Prompt ──────────────────────────────────────────
const QUESTION_SYSTEM = `你是一位专业的人格分析师。你将为AI游戏生成人格评估问卷。

问题设计铁律：
1. 每道题都应能揭示用户"不愿承认的真实倾向"——通过具体情境，而非直接问性格
2. 所有选项都必须是"正常人可能真的会选"的——没有明显的道德正确答案
3. 覆盖维度：真实压力反应（逃避还是硬撑）、边界感（能不能拒绝别人）、自我认知准确度、情绪触发点、对亲密关系的真实态度
4. 场景要具体、生活化，不要抽象

输出JSON数组，每题：
{
  "id": 序号,
  "question": "情境化的问题描述（不超过80字，具体场景）",
  "type": "choice|open",
  "options": ["选项（choice类型）——每个选项20字以内，不加序号"],
  "hint": "探测的真实维度（内部用，不展示）"
}`;

// ─── Star Tier Reference ──────────────────────────────────────────────────────
const TIER_REF = `
==== 【★星级参考表（用于 tier 字段赋值）】 ====
所有 tier 字段填整数（0-17）。以 0★ 标准成年人 = 属性1.0 为基准。
破坏力参照均指完全毁灭/彻底抹除对应对象，而非单次接触效果。

0★ 凡人   — 人类上限，职业运动员，属性1~2
1★ 爆墙   — 完全摧毁单体墙壁/隔断，碎骨穿甲，属性2~20
2★ 爆屋   — 完全摧毁单栋建筑/房屋
3★ 爆楼   — 完全摧毁楼宇/高层建筑群
4★ 爆街   — 完全摧毁街区范围
5★ 爆城   — 完全摧毁城市/城镇
6★ 爆国   — 完全摧毁国家级地理范围
7★ 大陆   — 完全摧毁大洲/大陆范围
8★ 地表   — 完全清洗行星地表，蒸发海洋
9★ 行星   — 完全毁灭地球大小的行星
10★ 恒星  — 完全毁灭太阳级恒星至太阳系
11★+ 以上 — 星系/宇宙/多元宇宙/叙事层级，远超常规战力

【角色创建开局规则】：
- 普通人类出发：tier = 0（所有超凡体系开局也是0★，潜力大不代表当前强）
- 有血脉觉醒/特殊天赋：被动能力 tier = 1（有但弱小）
- 体系初期/新手阶段：力量来源 tier = 0，技能 tier = 0
- 禁止开局给高星级（3★以上等于已经是超级英雄/修真大能，不合理）`;

// ─── Character Generation Base Prompt ────────────────────────────────────────
const CHAR_GEN_BASE = `你是一位专业的角色创作者，专门创作真实、立体、有人味的RPG角色。
你同时负责为角色生成符合《无限武库》数据模板标准的初始游戏面板数据。

${ANTI_RATIONAL}

${TIER_REF}

==== 【输出格式 — 必须完整输出以下所有字段】 ====
用\`\`\`json包裹，字段顺序不限，但一个都不能省略（包括空数组 []）。

下方是完整的字段结构示例（所有值均为示例，你必须替换成角色的真实数据）：

\`\`\`json
{
  "name": "角色姓名",
  "gender": "男",
  "age": "25",
  "title": "称号（无则留空）",
  "identity": "具体职业/社会身份（要具体，如'县城代课老师'而非'老师'）",
  "height": "172cm",
  "weight": "60kg",
  "appearance": "100-150字写实外貌：发色瞳色肤色体型气质，1-2个最显眼特征，给人的第一印象",
  "clothing": "50字以内的惯常着装，反映真实生活状态",
  "alignment": "混乱·中立",
  "traits": ["核心标签1", "核心标签2", "核心标签3", "核心标签4"],
  "personality": [
    "描述性格的某个具体侧面（内容和数量根据角色自然决定，不要套模板）"
  ],
  "flaws": [
    "如实描述角色真实存在的缺点，内容和数量根据角色自然决定，优先使用输入中已有的自述"
  ],
  "desires": ["根据角色实际情况填写，内容和数量自然决定"],
  "fears": ["根据角色实际情况填写，内容和数量自然决定"],
  "background": "120-180字背景故事：1-2个真实塑造性格的经历，重点心理影响",
  "quirks": ["可观察的具体行为习惯，内容和数量自然决定。禁止将行为习惯与特定道具/物品绑定（如"总是把玩某物"、"必须带着某件东西"）——习惯应描述姿态、动作或思维模式，而非对物品的依附"],

  "dimensions": {
    "social":    { "introExtro": -7, "trustRadius": -5, "dominance": 2, "empathy": 1, "boundaryStrength": 7 },
    "emotional": { "stability": -3, "expressiveness": -4, "recoverySpeed": 2, "emotionalDepth": 5 },
    "cognitive": { "analyticIntuitive": -2, "openness": 3, "riskTolerance": -3, "selfAwareness": 4 },
    "values":    { "autonomy": 9, "altruism": -2, "rationality": -1, "loyalty": 4, "idealism": 2 }
  },

  "contextModes": {
    "withStrangers":  { "note": "面对陌生人时行为特征的简短描述", "mods": { "introExtro": -3, "expressiveness": -4 } },
    "withFriends":    { "note": "面对熟悉/信任的人时的变化",      "mods": { "introExtro": 2,  "expressiveness": 3  } },
    "whenInterested": { "note": "当遇到感兴趣的事物时的变化",     "mods": { "introExtro": 6,  "expressiveness": 5  } },
    "underThreat":    { "note": "面对威胁/危险时的应对倾向",      "mods": { "stability": -5,  "dominance": 3       } },
    "whenLectured":   { "note": "被说教/被管教时的反应",          "mods": { "dominance": 4,   "empathy": -5        } },
    "withAuthority":  { "note": "面对权威/上位者时的表现",        "mods": { "autonomy": -3,   "expressiveness": -3 } }
  },

  "triggerPatterns": [
    { "trigger": "具体触发情境或刺激",  "reaction": "具体的行为/情绪反应描述", "intensity": 8 },
    { "trigger": "另一个触发情境",      "reaction": "对应的具体反应",           "intensity": 6 }
  ],

  "initialRelationships": [
    { "name": "关系人物名", "familiarity": 30, "trust": 20, "affect": -10, "dynamics": "用一句话描述互动特征" }
  ],

  "attributes": {
    "STR": 1.0,
    "DUR": 1.0,
    "VIT": 1.0,
    "REC": 1.0,
    "AGI": 1.0,
    "REF": 1.0,
    "PER": 1.0,
    "MEN": 1.0,
    "SOL": 1.0,
    "CHA": 1.0
  },

  "startingItems": [
    { "name": "物品具体名称", "qty": 1, "type": "Tool", "desc": "50字以内具体描述", "material": "材质", "colorSchema": "配色" }
  ],

  "knowledge": [
    { "topic": "具体知识领域名", "type": "Theory", "mastery": "熟练", "summary": "50字以内简述" }
  ],

  "passiveAbilities": [],

  "powerSources": [],

  "techniques": [
    {
      "schoolName": "（示例）无限武库·基础构式技法",
      "parentSource": "（示例）无限武库系统",
      "type": "Active",
      "tier": 0,
      "desc": "流派核心原理",
      "subTechniques": [
        { "name": "基础构式·形", "type": "Active", "proficiencyLevel": "入门", "costInitial": "5演算力", "costMaintenance": "无", "castTime": "Instant", "cooldown": "无", "hasRisk": false, "riskDesc": "", "tier": 0, "desc": "将演算力塑形为冲击波，造成(STR×2.0)点钝击伤害", "stance": "", "chant": "", "visualFX": "" }
      ]
    }
  ],

  "mechs": []
}
\`\`\`

如角色有超凡能力，passiveAbilities / powerSources / techniques / mechs 的元素格式如下：

passiveAbility 元素：
{ "name": "能力名 (English Name)", "type": "Lineage", "tier": 0, "desc": "80字以内效果描述", "tags": ["被动常驻", "限制性"] }
type 可选值：Lineage（血统）/ Talent（天赋）/ Trait（后天特质）/ System（系统赋予）

powerSource 元素：
{ "name": "体系名 (English)", "type": "RootSystem", "aptitudeGrade": "C", "aptitudeTitle": "凡人资质", "aptitudeCorrection": 1.0, "realm": "入门阶段", "tier": 0, "poolName": "能量池名（无则空字符串）", "poolMax": 100, "poolRegen": "回复规则", "desc": "60字以内描述" }
aptitudeGrade 可选：S / A / B / C / D；aptitudeCorrection 对应：S=2.0 / A=1.5 / B=1.2 / C=1.0 / D=0.7
type 可选：RootSystem / Lineage / Tech / Magic / Psionic / Divine

technique 元素（每个元素代表一个"流派/技法体系"，流派内包含多个子技能）：
{
  "schoolName": "流派完整名称（如 无限武库·基础构式技法、柔道·投技）",
  "parentSource": "必须与 powerSources 某项 name 完全一致（普通人类无基盘则填空字符串）",
  "type": "Active",
  "tier": 0,
  "desc": "60字以内流派核心原理/风格描述",
  "subTechniques": [
    {
      "name": "子技能名（具体招式/技法名，如 穿透构式·锋、大外刈）",
      "type": "Active",
      "proficiencyLevel": "入门",
      "costInitial": "明确数值或百分比（如 5演算力 / 10% HP / 无消耗）",
      "costMaintenance": "维持消耗（如 1演算力/秒 / 无）",
      "castTime": "Instant",
      "cooldown": "无",
      "hasRisk": false,
      "riskDesc": "如果有反噬风险，描述具体惩罚（如 肌肉撕裂扣除5HP）",
      "tier": 0,
      "desc": "明确效果。必须包含机制、倍率、固定数值或相关公式（如：对单体造成(STR×2.5)点穿刺伤害，并附加3秒眩晕）",
      "stance": "发动姿势/结印（无则留空）",
      "chant": "咏唱/口令（无则留空）",
      "visualFX": "视觉效果描述（无则留空）"
    }
  ]
}

【流派结构规则】：
- techniques 数组中每个元素 = 一个流派容器，subTechniques 数组 = 该流派下的具体招式列表
- 同一 parentSource 的技能应归入同一流派（一个流派对应一个基盘），不要拆分到多个元素
- 若角色有2个基盘且各有技能，则 techniques 应有2个元素（各自的流派）
- 普通人类无基盘但有技艺（如格斗、驾驶）时，parentSource 填空字符串，schoolName 填现实流派名如"柔道·投技"
type 可选：Active / Passive / Support / Utility

【subTechniques 数量规则】：
- subTechniques = 该流派**体系内的完整招式列表**，不受 proficiencyLevel 约束，也不受"3个上限"约束
- 即便是"入门"水平，也应列出该流派所有基础招式（入门的定义就是已掌握全部基本套路）
- 招式数量由流派本身决定：招式精简的流派可能只有3-5个，完整体系通常8-12个，博大流派可达12个以上
- ❌ 错误示范：太极拳高手只列2-3个招式——正确应列出完整套路（揽雀尾、单鞭、云手、野马分鬃、搂膝拗步、玉女穿梭等8-10个以上）

【proficiencyLevel 含义】：描述角色**运用和超越**该流派招式的深度，共4个阶段：
- **入门**：已完整学完所有基础招式，能按套路正常使用，但实战中尚需思考，高压下容易走形，未习得奥义
- **熟练**：招式已化为本能和肌肉记忆，实战中能稳定连招组手，正确应对各种体势，并已习得流派奥义
- **精通**：能在实战中正常发挥奥义，并开始对原有招式进行个人化改造，我流雏形初现
- **化境**：可自立门派，能开发全新奥义，能根据当前形势临场创造适合的招式来应对，完全超越了原流派框架

mech 元素：
{ "unitName": "机体名称", "model": "型号", "designStyle": "外观风格", "height": "全高", "totalIntegrity": 1000, "energyMax": 0, "hasMI": false, "miName": "", "miPersonality": "", "tier": 0, "desc": "50字以内描述" }

==== 【数值填写规则】 ====

attributes（10个属性）：
- 精确到0.1，范围0.5-1.8，基准1.0 = 健康成年人平均水平
- HP上限 = floor((VIT+DUR)×50)；体力上限 = floor((VIT+MEN)×20)
- 不得全部填1.0，要根据角色身体/精神状况体现差异

startingItems（2-5件）：
- 只填角色开局实际随身携带的物品，不要虚构超出背景的物品
- type 从 Tool / Weapon / Clothing / Misc / Currency 中选一个

knowledge（2-4个节点）：
- type 从 Theory / Practical / Combat / Lore / Language 中选一个
- mastery 从 初步了解 / 熟练 / 精通 / 完全解析 中选一个

passiveAbilities / powerSources / techniques / mechs：
- 普通现代人无超凡能力时，这四个字段填空数组 []，不要省略
- tier 开局通常为0；有觉醒血脉/特殊天赋的被动能力可以填1
- powerSources 的 poolName 若为有能量体系（修真/魔法/科技），必须填写能量池名；普通人的后天技艺填 ""
- techniques 的 parentSource 必须与 powerSources 中某项 name 完全一致（无对应来源填""）
- 开局**流派（technique 元素）不超过3个**；但每个流派内的 subTechniques 数量不受此限制，应根据角色对该流派的掌握深度据实填写（见上方【subTechniques 数量规则】）

==== 【心理维度填写规则 — dimensions / contextModes / triggerPatterns / initialRelationships】 ====

**dimensions** — 18个维度轴，每轴取 -10 ~ +10 的整数，0 = 人群平均水平。
必须从已生成的 personality / flaws / desires / fears 中推导，不得随机赋值。

社交维度（social）：
- introExtro：-10=极度内倾（独处充电、社交耗能）→ +10=极度外倾（人群充电、孤独耗能）
- trustRadius：-10=极度不信任他人（默认他人有恶意）→ +10=无条件信任他人（轻易被骗）
- dominance：-10=完全顺从（无法拒绝他人、习惯服从）→ +10=强主导（必须掌控话语权和方向）
- empathy：-10=情感冷漠（难以共情他人感受）→ +10=过度共情（被他人情绪淹没）
- boundaryStrength：-10=无边界感（自我与他人界限模糊）→ +10=极强边界（独立性强，难以被渗透）

情感维度（emotional）：
- stability：-10=极度动荡（情绪起伏大，易崩溃）→ +10=极度稳定（冷静到近乎麻木）
- expressiveness：-10=极度压抑（将情绪藏在最深处）→ +10=完全外放（情绪全部写在脸上）
- recoverySpeed：-10=极慢恢复（情绪创伤久久难散）→ +10=极快恢复（弹力球，很快自愈）
- emotionalDepth：-10=情感肤浅（感受不深刻，过得快）→ +10=情感深邃（感受强烈持久，难以忘怀）

认知维度（cognitive）：
- analyticIntuitive：-10=纯直觉型（凭感觉行动，难以理性分析）→ +10=纯分析型（所有决策都要逻辑化）
- openness：-10=极度封闭（拒绝新观点，固守旧有）→ +10=极度开放（对一切新想法兴奋，三观易被颠覆）
- riskTolerance：-10=极度规避风险（哪怕小风险也会退缩）→ +10=嗜险冒进（无风险反而无聊）
- selfAwareness：-10=自我认知盲区极大（不了解自己的模式）→ +10=高度自知（对自己的运作机制非常清醒）

价值观维度（values）：
- autonomy：-10=完全顺从权威（规则即正义）→ +10=极端自主（只服从自己的判断）
- altruism：-10=纯粹利己（他人利益对我无关紧要）→ +10=极度利他（可以牺牲自我）
- rationality：-10=纯情绪驱动（凭感觉做所有决定）→ +10=纯理性驱动（压制情绪追求最优解）
- loyalty：-10=轻义背信（关系可随时切断）→ +10=极度忠诚（一旦认定绝不背叛）
- idealism：-10=极度现实（只认事实和利益）→ +10=极度理想主义（坚信理想必将实现）

**contextModes** — 角色在特定情境下的行为偏移。
- mods 里的值是**增量**（当前轴基础值 + 偏移量 = 该情境下的表现值，上限仍是±10）
- note 用一句话描述该情境下的行为特征（具体、可观察，如"话减少一半，回答变短"）
- 只写有明显差异的情境，无变化的情境可省略 mods 条目

**triggerPatterns** — 具体的触发-反应对。
- trigger：具体可观察的情境（不要写抽象词，写具体场景，如"被人当众批评"）
- reaction：具体的行为或情绪反应（不要写内心感受，写外在表现，如"立即变得沉默，低头玩手机"）
- intensity：反应强度 1-10（10=无法抑制、生理性反应）
- 数量由角色自然决定，通常 3-6 个，与 quirks 互补（quirks 是习惯性行为，trigger 是被触发的反应）
- quirks 禁止与具体道具/物品绑定，应描述身体姿态、言语习惯或思维模式（如"说话时习惯低头"、"想事情时会反复咬牙"），而非"总是摸某件随身物品"这类依附性描述

**initialRelationships** — 角色开局已有的关系（从背景/知识节点中提取）。
- familiarity：熟悉度 0-100（0=完全陌生，100=多年老友）
- trust：信任度 0-100
- affect：情感倾向 -100（极度厌恶）~ +100（深深喜爱），0=中立
- dynamics：一句话描述互动动态（具体描述见面时发生什么，而不是关系类型标签）
- 普通现代人背景通常有 2-4 个关系，只写有实质互动基础的，不要虚构`;

// ─── Transmigrator Supplement ─────────────────────────────────────────────────
const TRAVERSAL_PRESETS = {
  rebirth:    '【重生】角色以完整记忆在本世界某一更早时间点（或婴幼儿/胎儿阶段）重新出生，生理起点与本土人无异，但携带异世界（通常是现代地球）的记忆和知识体系。',
  possession: '【夺舍/融合】角色的灵魂/意识穿入本世界一个已存在人物的身体，继承该身体的部分肌肉记忆与原主记忆碎片，但核心价值观和主体意识是异世界的。',
  summoning:  '【召唤/降临】角色以现代地球的完整成年身份（服装、随身物品）被召唤至本世界，外貌、身体素质与原世界完全一致，属于明显的"外来者"。',
  isekai:     '【异世界转生（经典版）】角色在原世界死亡后以原貌（或新的身体）在本世界出生/醒来，保有完整记忆，可能附带特殊的"转生祝福"（由此解锁某项天赋或初始能力）。',
  system:     '【系统穿越】角色被某未知力量携带至本世界，同时获得一个"系统提示界面"（与本作的无限武库系统对接），系统可能给予了少量初始点数或新手礼包。',
  custom:     null,  // Handled by traversalDesc field
};

/**
 * Build the transmigrator-specific extra prompt block.
 * @param {string} charType '本土' | '穿越者'
 * @param {string|null} traversalMethod key from TRAVERSAL_PRESETS or 'custom'
 * @param {string|null} traversalDesc custom description when method === 'custom'
 */
function buildCharTypeBlock(charType, traversalMethod, traversalDesc) {
  if (charType !== '穿越者') {
    return `\n==== 【角色类型：本土】 ====\n角色是本世界的原住民，自幼成长于此世界，对世界的规则、文化与超凡体系有正常的认知。\n- 背景、知识库、能力均应与本世界的历史和文化环境匹配\n- 不要为本土角色添加任何"异世界视角"或"穿越者优势"`;
  }

  let traversalBlock = '';
  if (traversalMethod && traversalMethod !== 'custom' && TRAVERSAL_PRESETS[traversalMethod]) {
    traversalBlock = TRAVERSAL_PRESETS[traversalMethod];
  } else if (traversalDesc?.trim()) {
    traversalBlock = `【自定义穿越方式】${traversalDesc.trim()}`;
  } else {
    traversalBlock = TRAVERSAL_PRESETS.isekai;
  }

  return `
==== 【角色类型：穿越者】 ====
${traversalBlock}

穿越者特殊创作规则：
- **知识体系**：knowledge 字段必须包含1-2条"现代地球知识"节点（如"工程学常识"、"现代医学常识"、"互联网/ACG文化"等），这是穿越者相对于本土人的核心信息差
- **心理冲击**：穿越者在情绪/心理层面必须体现**文化错位**——他们用旧世界的框架理解新世界，会产生误判、惊讶或认知失调，这是真实的。不要让他们对新世界表现得过于从容
- **能力继承**：穿越前在原世界掌握的技能（如编程、驾驶、格斗训练）可以作为 knowledge 或初始低tier technique 保留，但不赋予超凡力量
- **天生的系统感知**：穿越者天然能感知并解读"无限武库"系统界面（这是召唤/转生的副产品），不需要额外解释原因
- **面板数据**：超凡能力（powerSources/passiveAbilities）只在穿越方式中明确赋予时才填写，否则保持空数组`;
}

// ─── Message Builders ─────────────────────────────────────────────────────────
function buildQuestionMessages(opts = {}) {
  const count = Math.min(20, Math.max(10, opts.count || 15));
  const charType = opts.charType || '本土';
  const extraHint = charType === '穿越者'
    ? `\n\n注意：本次创建的是**穿越者**（来自异世界的角色），请额外加入2-3道能揭示"跨文化适应/信息差"的问题，例如：\n- 面对与自己认知完全矛盾的事物时的第一反应\n- 如何处理"知道结果但无法改变"的局面\n- 当拥有别人没有的信息时，倾向于如何行动`
    : '';
  return [
    { role: 'system', content: QUESTION_SYSTEM },
    { role: 'user', content: `生成${count}道人格评估问题，用于创建RPG主角。问题覆盖：真实压力反应(3题)、人际边界(2-3题)、情绪触发点(2-3题)、自我认知准确度(2题)、非理性倾向(2-3题)。直接输出JSON数组。${extraHint}` },
  ];
}

function buildFromAnswersMessages(questionsAndAnswers, opts = {}) {
  const charType = opts.charType || '本土';
  const charTypeBlock = buildCharTypeBlock(charType, opts.traversalMethod, opts.traversalDesc);
  const qa = questionsAndAnswers
    .map((item, i) => `[Q${i + 1}] ${item.question}\n[回答] ${item.answer || '（跳过）'}`)
    .join('\n\n');
  return [
    { role: 'system', content: CHAR_GEN_BASE + charTypeBlock },
    {
      role: 'user',
      content: `根据以下人格评估问答，创作一个有真实人味的游戏主角，同时生成完整的初始游戏面板数据。\n\n` +
        `重要：不要把答案的字面内容搬进人物里，而是通过答案揭示的倾向进行心理推断。` +
        `尤其关注：回答之间的矛盾之处（那才是最真实的部分）、用词里暴露的情绪、回避的方式。\n` +
        `忠实原则：答案中已有的倾向直接具体化，不要重新发明或升级强度；答案中没有的内容只做最小必要的补全，不套固定模板。\n\n` +
        qa,
    },
  ];
}

function buildFromBackgroundMessages(background, prefs = {}) {
  const charType = prefs.charType || '本土';
  const charTypeBlock = buildCharTypeBlock(charType, prefs.traversalMethod, prefs.traversalDesc);
  let extra = '';
  if (prefs.gender && prefs.gender !== 'random') extra += `\n性别设定：${prefs.gender}`;
  if (prefs.age) extra += `\n年龄范围：${prefs.age}`;
  if (prefs.name) extra += `\n姓名设定：${prefs.name}`;
  return [
    { role: 'system', content: CHAR_GEN_BASE + charTypeBlock },
    {
      role: 'user',
      content: `根据以下人物背景/设定，创作完整的游戏主角档案，同时生成符合数据模板的初始游戏面板数据。\n\n` +
        `重要提醒：\n` +
        `- 背景里没写清楚的地方，用合理的心理推断填充，不要用完美的答案填充\n` +
        `- 如果背景听起来很厉害，性格不一定就很成熟——强大的能力经常和不成熟的情绪共存\n` +
        `- 从背景经历推断心理创伤和行为模式，而不是直接复述背景内容\n` +
        `- 面板数据（powerSources/techniques/mechs）只填写背景中明确有的内容\n` +
        `- 忠实原则：输入中已有的性格/缺点/渴望/恐惧，直接具体化，不要重新发明或升级强度；输入中没有的内容只做最小必要的补全，不套固定模板${extra}\n\n` +
        `---\n${background}`,
    },
  ];
}

module.exports = {
  buildQuestionMessages,
  buildFromAnswersMessages,
  buildFromBackgroundMessages,
  TRAVERSAL_PRESETS,
};
