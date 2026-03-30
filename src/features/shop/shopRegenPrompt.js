'use strict';
/**
 * Shop Regen Prompt — 商品字段级重新生成
 * 根据现有商品上下文，只重新生成指定字段。
 * 支持附加提示词（extraHint）进行定向修改。
 */

const FIELD_SCHEMAS = {
  description: {
    label:  '效果描述',
    schema: '{ "description": "效果描述文本" }',
    hint:   '用 2-4 句话客观描述该能力/物品的核心效果和实际表现',
  },
  appearance: {
    label:  '外观描述',
    schema: '{ "appearance": "外观描述文本" }',
    hint:   '描述该能力/物品的视觉外观、形态特征，15-40字',
  },
  abilities: {
    label:  '能力列表',
    schema: '{ "abilities": ["能力1", "能力2", ...] }',
    hint:   '列出核心能力点，每条 10-30 字，客观陈述',
  },
  restrictions: {
    label:  '限制条件',
    schema: '{ "restrictions": ["限制1", "限制2", ...] }',
    hint:   '列出使用限制、消耗、代价等，每条 10-25 字',
  },
  sideEffects: {
    label:  '副作用',
    schema: '{ "sideEffects": "副作用文本" }',
    hint:   '描述长期或偶发的负面效应，可为空字符串',
  },
  antiFeats: {
    label:  '反壮举',
    schema: '{ "antiFeats": ["反壮举1", ...] }',
    hint:   '列举该能力明确做不到的事，防止强度虚高，格式：「XXX级/类 的目标对此能力免疫/抵抗」',
  },
  lore: {
    label:  '背景设定',
    schema: '{ "lore": "背景设定文本" }',
    hint:   '该能力/物品的世界观背景与来源说明，30-80字',
  },
  rationale: {
    label:  '定价依据',
    schema: '{ "rationale": "定价依据文本" }',
    hint:   '说明该星级/定价的具体理由，引用比较对象',
  },
  systemEvaluation: {
    label:  '三轮评估报告',
    schema: '{ "systemEvaluation": "含第一轮属性审查、第二轮计价、第三轮结论的完整 Markdown 文本" }',
    hint:   '保持与卷一评估协议一致的结构化报告，可含 1A/1B/1C/1D、基准分与徽章结论',
  },
};

function buildItemContext(item) {
  return [
    `名称：${item.name}`,
    `类型：${item.type || '未分类'}`,
    `星级：${item.tier ?? '?'}★（${item.tierLabel || ''}）`,
    `价格：${item.pricePoints ?? '?'} 积分`,
    `来源世界：${item.sourceWorld || '未指定'}`,
    item.description ? `效果描述：${item.description}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * 构建商品字段级重新生成的 LLM 消息数组
 * @param {string} field     - 字段名
 * @param {object} item      - 完整的现有商品数据
 * @param {object} opts
 * @param {string} opts.extraHint - 用户附加提示词
 */
function buildRegenFieldMessages(field, item, { extraHint = '' } = {}) {
  const schemaInfo = FIELD_SCHEMAS[field] || {
    label:  field,
    schema: `{ "${field}": ... }`,
    hint:   '重新生成该字段',
  };

  const itemCtx = buildItemContext(item);
  const currentValue = item[field];
  const currentValueStr = currentValue != null
    ? `\n\n## 当前值（参考）\n\`\`\`json\n${JSON.stringify(currentValue, null, 2)}\n\`\`\``
    : '';

  const systemContent = `你是《无限武库》商城的 AI 评估引擎，负责对商品字段进行精准重写。

## 任务
只重新生成：**${schemaInfo.label}**
其他字段保持不变。

## 要求
${schemaInfo.hint}

## 返回格式
严格返回以下 JSON（用 \`\`\`json ... \`\`\` 包裹）：
\`\`\`json
${schemaInfo.schema}
\`\`\`
不要输出其他任何内容。`;

  const userContent = [
    `## 商品上下文\n${itemCtx}`,
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
