'use strict';
/**
 * NPC/Monster Prompt — generates entity stat sheets for world NPCs and monsters.
 *
 * Uses the same star tier evaluation framework as shopPrompt, but:
 *   - No pricing/medals calculation required
 *   - Generates CombatProfile (attributes, abilities, weaknesses, tactics)
 *   - For NPC/Boss types: generates PersonalityModel for AI roleplay
 *   - Results are stored in Multiverse.Archives.<World>.NPCs[]
 */

// ─── Shared Star Tier Table (mirrors shopPrompt.js §三) ───────────────────────
const STAR_TIER_TABLE = `
## 星级总表（0-17★）

> 基准：0★ 标准成年健康人类 = 所有属性基准 "1"。数值 X = 标准人类的 X 倍。

| 星级 | 称号    | 属性值范围              | 能量输出参考             | 破坏力参照（完全毁灭基准）                       |
|:---:|:-----:|:-------------------:|:--------------------:|:---------------------------------------------|
| **0★** | 凡人   | 1 ~ 2               | ~100 J               | 人类上限，职业运动员/搏击冠军                       |
| **1★** | 爆墙   | 2 ~ 20              | ~1.6 kJ              | 完全摧毁单体墙壁/隔断，碎骨穿甲                      |
| **2★** | 爆屋   | 20 ~ 100            | ~25 kJ               | 完全摧毁单栋建筑/房屋                            |
| **3★** | 爆楼   | 100 ~ 500           | ~6.5 MJ              | 完全摧毁楼宇/高层建筑群                           |
| **4★** | 爆街   | 500 ~ 2,000         | ~1.6 GJ              | 完全摧毁街区/数个城市街道范围                        |
| **5★** | 爆城   | 2,000 ~ 10,000      | ~430 GJ              | 完全摧毁城市/城镇                               |
| **6★** | 爆国   | 10,000 ~ 50,000     | ~110 TJ              | 完全摧毁国家级地理范围                            |
| **7★** | 大陆   | 50,000 ~ 200,000    | ~28 PJ               | 完全摧毁大洲/大陆级地理范围                         |
| **8★** | 地表   | 200,000 ~ 1,000,000 | ~7.2×10⁶ TJ          | 完全清洗行星地表，蒸发海洋/击穿地壳                     |
| **9★** | 行星   | 1M ~ 10M            | ~1.8×10⁹ TJ          | 完全毁灭地球大小的岩石行星                          |`;

// ─── NPC System Prompt ────────────────────────────────────────────────────────
const NPC_SYSTEM_PROMPT = `你是《无限武库》系统的「遭遇档案生成器」，负责为游戏叙事中出现的NPC、怪物和Boss生成完整的实体档案。

${STAR_TIER_TABLE}

---

## 任务说明

根据提供的实体描述，生成一份结构化的实体档案（NPC/Monster/Boss）。

**评估原则（与商城三轮评估对标）**：
1. **实证主义**：只记录该实体在原作中明确展示的能力，不夸大
2. **功能维度分析**：评估该实体真正增强了哪些核心属性维度
3. **实战裁判**：能击败什么级别的敌人？能造成什么规模的破坏？

---

## 输出格式

严格输出以下 JSON 格式，使用 \`\`\`json ... \`\`\` 包裹：

\`\`\`json
{
  "name": "实体全名（原文+必要翻译）",
  "type": "Monster|NPC|Boss",
  "hostile": true,
  "tier": 0,
  "description": "外貌、背景、战斗风格、来源世界的简要概述（100字以内）",
  "CombatProfile": {
    "Attributes": {
      "STR": [1.0, "力量·说明（原作依据）"],
      "DUR": [1.0, "耐力·说明"],
      "VIT": [1.0, "体质·说明"],
      "REC": [1.0, "恢复·说明"],
      "AGI": [1.0, "敏捷·说明"],
      "REF": [1.0, "反应·说明"],
      "PER": [1.0, "感知·说明"],
      "MEN": [1.0, "精神·说明"],
      "SOL": [1.0, "灵魂·说明"],
      "CHA": [1.0, "魅力·说明"]
    },
    "Tier": {
      "NormalTier": [0, "常态星级·简要依据"],
      "BurstTier":  [0, "爆发星级·简要依据（若与常态相同则相同）"]
    },
    "Abilities": [
      {
        "name": "技能/能力名称",
        "tier": 0,
        "description": "效果描述（含具体数值/范围/限制，禁用模糊语言）",
        "type": "Active|Passive|Innate"
      }
    ],
    "Weaknesses": ["弱点描述1（含原作依据）", "弱点描述2"],
    "TacticsAndBehavior": "战术模式：该实体如何战斗？优先攻击目标？逃跑条件？特殊行为规律？（100字以内）"
  },
  "PersonalityModel": null
}
\`\`\`

**PersonalityModel 字段规则**：
- type = **Monster** 时：填 \`null\`
- type = **NPC** 或 **Boss** 时：填以下结构：

\`\`\`json
{
  "CoreValues": ["核心价值观标签1", "标签2"],
  "SpeakingStyle": "说话特征：语速/语气/口头禅/用词风格，20字以内",
  "EmotionalBaseline": "情绪基准状态：平时是什么感觉？如何表达情绪？",
  "MotivationCore": "核心驱动力：追求什么？恐惧什么？",
  "RelationshipDynamic": "对主角的初始态度和关系模式（友好/敌对/中立/复杂）",
  "SecretOrConflict": "隐藏信息或内心冲突（对AI扮演有意义的隐藏层），如无则填null",
  "RoleplayDirective": "角色扮演要点：3-5条具体的行为规则，告诉AI如何扮演这个角色"
}
\`\`\`

---

**重要规范**：
- 每个 Abilities 条目必须有具体数值（范围、倍率、持续时间等），禁止"大幅提升"等模糊描述
- Weaknesses 必须基于原作实证，包含利用方法
- TacticsAndBehavior 必须描述行为模式而非单纯能力列表
- tier 填整体战力星级（参照上方星级表）
`;

// ─── Prompt Builder ───────────────────────────────────────────────────────────

/**
 * Build messages for NPC/Monster stat generation.
 *
 * @param {string} description   - SystemSpawn tag body (name, description, type, context)
 * @param {string} worldKey      - Current world name for context
 * @param {object[]} worldPowerSystems - PowerSystems from the world archive
 * @returns {Array<{role: string, content: string}>}
 */
function buildMessages(description, worldKey, worldPowerSystems = []) {
  let systemContent = NPC_SYSTEM_PROMPT;

  // Inject world power systems for accurate tier calibration
  if (worldPowerSystems.length > 0) {
    const psText = worldPowerSystems.map(ps =>
      `▸ **${ps.name}**（${ps.category || '?'}）典型星级：${ps.typicalTierRange || '?'} | 峰值：${ps.peakTierRange || '?'}\n  ${ps.description || ''}`
    ).join('\n');
    systemContent += `\n\n---\n\n## 当前世界（${worldKey}）力量体系参照\n\n${psText}\n\n请确保生成的实体星级与该世界的力量上限相匹配。`;
  }

  const userContent = `请为以下实体生成完整档案：\n\n${description}`;

  return [
    { role: 'system', content: systemContent },
    { role: 'user',   content: userContent },
  ];
}

module.exports = { buildMessages };
