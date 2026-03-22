'use strict';
/**
 * Character Regen Prompt — 角色字段级重新生成
 * 根据现有角色数据上下文，只重新生成指定字段。
 * 支持附加提示词（extraHint）进行定向修改。
 */

const FIELD_SCHEMAS = {
  appearance: {
    label:  '外貌描述',
    schema: '{ "appearance": "外貌描述文本（100-300字）" }',
    hint:   '具体描述角色的外貌特征：身高体型、脸部特征、发型发色、常见穿着等，避免使用"迷人""帅气"等形容词，只陈述客观细节',
  },
  personality: {
    label:  '性格描述',
    schema: '{ "personality": "性格描述文本" }',
    hint:   '描述角色真实的行为模式、习惯、缺陷，用具体行为而非形容词，避免完美主角',
  },
  background: {
    label:  '背景故事',
    schema: '{ "background": "背景故事文本" }',
    hint:   '角色的成长经历、重要事件、如何塑造了现在的他/她，保持真实感',
  },
  coreDesires: {
    label:  '核心渴望',
    schema: '{ "coreDesires": ["渴望1", "渴望2", ...] }',
    hint:   '2-4 个具体的内心渴望，要有血有肉，不要是"成为英雄"之类的套话',
  },
  coreFears: {
    label:  '核心恐惧',
    schema: '{ "coreFears": ["恐惧1", "恐惧2", ...] }',
    hint:   '2-3 个具体的恐惧，要有来源，最好与背景故事呼应',
  },
  quirks: {
    label:  '怪癖/习惯',
    schema: '{ "quirks": ["怪癖1", "怪癖2", ...] }',
    hint:   '2-4 个具体的日常怪癖、习惯或口头禅，要具体可观察',
  },
  speechStyle: {
    label:  '说话风格',
    schema: '{ "speechStyle": "说话风格描述（30-80字）" }',
    hint:   '描述角色的说话方式、语气、常用措辞、避讳词汇等',
  },
  skills: {
    label:  '技能/专长',
    schema: '{ "skills": [{ "name": "技能名", "level": "水平描述", "source": "来源" }] }',
    hint:   '3-6 个具体技能，要有高有低，不要全是满级',
  },
  relationships: {
    label:  '人际关系',
    schema: '{ "relationships": [{ "name": "人物名", "relation": "关系类型", "description": "关系描述" }] }',
    hint:   '2-5 段重要人际关系，包括正面和复杂/负面的',
  },
};

const ANTI_RATIONAL_SHORT = `【反理性化原则】：
- 真实的人有缺陷、有矛盾、有说不清的情绪
- 禁止"完美主角"式描述，禁止把缺陷写成优点
- 用具体行为和细节，而非形容词堆砌`;

function buildCharContext(charData) {
  return [
    charData.name    ? `姓名：${charData.name}` : '',
    charData.age     ? `年龄：${charData.age}` : '',
    charData.gender  ? `性别：${charData.gender}` : '',
    charData.charType ? `类型：${charData.charType}` : '',
    charData.background ? `背景摘要：${String(charData.background).slice(0, 100)}…` : '',
    charData.personality ? `性格摘要：${String(charData.personality).slice(0, 80)}…` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 构建角色字段级重新生成的 LLM 消息数组
 * @param {string} field     - 字段名
 * @param {object} charData  - 完整的角色数据（可以是未保存的预览）
 * @param {object} opts
 * @param {string} opts.extraHint - 用户附加提示词
 */
function buildRegenFieldMessages(field, charData, { extraHint = '' } = {}) {
  const schemaInfo = FIELD_SCHEMAS[field] || {
    label:  field,
    schema: `{ "${field}": ... }`,
    hint:   '重新生成该字段',
  };

  const charCtx = buildCharContext(charData);
  const currentValue = charData[field];
  const currentValueStr = currentValue != null
    ? `\n\n## 当前值（参考）\n\`\`\`json\n${JSON.stringify(currentValue, null, 2)}\n\`\`\``
    : '';

  const systemContent = `你是《无限武库》系统的角色建模引擎，负责对角色档案中的特定字段进行精准重写。

## 任务
只重新生成：**${schemaInfo.label}**
其他字段保持不变。

## 要求
${schemaInfo.hint}

${ANTI_RATIONAL_SHORT}

## 返回格式
严格返回以下 JSON（用 \`\`\`json ... \`\`\` 包裹）：
\`\`\`json
${schemaInfo.schema}
\`\`\`
不要输出其他任何内容。`;

  const userContent = [
    `## 角色上下文\n${charCtx}`,
    currentValueStr,
    extraHint ? `\n## 修改要求（用户补充）\n${extraHint}` : '',
    `\n请重新生成【${schemaInfo.label}】。`,
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: systemContent },
    { role: 'user',   content: userContent },
  ];
}

module.exports = { buildRegenFieldMessages };
