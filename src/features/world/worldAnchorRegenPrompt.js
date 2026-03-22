'use strict';
/**
 * World Anchor Regen Prompt — 字段级重新生成
 * 根据现有档案上下文，只重新生成指定字段。
 * 支持附加提示词（extraHint）进行定向修改。
 */

const FIELD_SCHEMAS = {
  worldRules: {
    label:   '世界法则',
    schema:  '{ "worldRules": ["规则1", "规则2", ...] }',
    hint:    '每条 10-25 字，不超过 15 条，客观陈述这个世界的物理/魔法/社会规则',
  },
  singleWorldRule: {
    label:   '单条世界法则',
    schema:  '{ "worldRules": "单条规则文本（10-25字）" }',
    hint:    '重新生成这一条世界法则，保持与其他规则风格一致',
  },
  timeline: {
    label:   '历史时间线',
    schema:  '{ "timeline": [{ "time": "时间点", "event": "事件标题", "impact": "对世界格局的影响" }, ...] }',
    hint:    '3-6 个关键历史节点，按时间顺序排列',
  },
  singleTimeline: {
    label:   '单条时间线事件',
    schema:  '{ "timeline": { "time": "时间点", "event": "事件标题", "impact": "对世界格局的影响" } }',
    hint:    '重新生成这一条历史事件记录',
  },
  powerSystems: {
    label:   '力量体系',
    schema:  '{ "powerSystems": [{ "name": "体系名", "category": "科技/魔法/武功/...", "typicalTierRange": "X-Y★", "peakTierRange": "X-Y★", "description": "简介", "coreResource": "核心资源", "entryBarrier": "入门门槛" }] }',
    hint:    '1-4 个力量体系，星级要与世界危险等级匹配',
  },
  singlePowerSystem: {
    label:   '单个力量体系',
    schema:  '{ "powerSystems": { "name": "体系名", "category": "科技/魔法/武功/...", "typicalTierRange": "X-Y★", "peakTierRange": "X-Y★", "description": "简介", "coreResource": "核心资源", "entryBarrier": "入门门槛" } }',
    hint:    '重新生成这一个力量体系条目',
  },
  worldIdentity: {
    label:   '本地身份',
    schema:  '{ "worldIdentity": { "name": "本地名", "identity": "身份职业", "appearance": "外貌描述", "background": "背景故事", "relationships": [...], "coreMemories": [...], "socialLinks": [...] } }',
    hint:    '穿越者在此世界的本地身份设定，需与世界背景协调',
  },
  tierReason: {
    label:   '定级依据',
    schema:  '{ "tierReason": "定级依据文本（50-100字）" }',
    hint:    '说明为何将此世界评定为当前危险等级，引用具体角色/能力作为实证',
  },
  recommendedEntry: {
    label:   '建议入场时间点',
    schema:  '{ "recommendedEntry": "建议入场时间点描述（30-60字）" }',
    hint:    '建议穿越者选择什么时间节点入场，以及理由',
  },
  initialLocation: {
    label:   '初始地点',
    schema:  '{ "initialLocation": "初始地点描述（20-40字）" }',
    hint:    '穿越者初次落地的具体地点和简要描述',
  },
};

function buildArchiveContext(archive) {
  const lines = [
    `世界：${archive.displayName}（${archive.timePeriod || '时代不明'}）`,
    `宇宙/IP：${archive.universe || '原创'}`,
    `危险等级：${archive.tierRange || '?'} / 世界最强约 ${archive.worldTier ?? '?'}★`,
    archive.tierReason ? `定级依据：${archive.tierReason}` : '',
    `世界法则数量：${(archive.worldRules || []).length} 条`,
    `力量体系数量：${(archive.powerSystems || []).length} 个`,
    `时间线事件数：${(archive.timeline || []).length} 条`,
  ].filter(Boolean).join('\n');
  return lines;
}

/**
 * 构建字段级重新生成的 LLM 消息数组
 * @param {string} field         - 字段名（如 'worldRules', 'timeline', 'worldIdentity'…）
 * @param {object} archive       - 完整的现有档案数据
 * @param {object} opts
 * @param {number|null} opts.fieldIndex - 数组内某一条的索引（null 表示重生成整个字段）
 * @param {string} opts.extraHint       - 用户附加的补充提示词
 * @returns {Array<{role:string, content:string}>}
 */
function buildRegenFieldMessages(field, archive, { fieldIndex = null, extraHint = '' } = {}) {
  const isArrayItem = fieldIndex != null && Array.isArray(archive[field]);
  const schemaKey   = isArrayItem ? `single${field.charAt(0).toUpperCase()}${field.slice(1, -1)}` : field;
  const schemaInfo  = FIELD_SCHEMAS[schemaKey] || FIELD_SCHEMAS[field] || {
    label:  field,
    schema: `{ "${field}": ... }`,
    hint:   '重新生成该字段',
  };

  const archiveCtx = buildArchiveContext(archive);

  // 现有值（用于参考和对比）
  let currentValue = archive[field];
  if (isArrayItem) currentValue = archive[field][fieldIndex];
  const currentValueStr = currentValue != null
    ? `\n\n## 当前值（参考）\n\`\`\`json\n${JSON.stringify(currentValue, null, 2)}\n\`\`\``
    : '';

  const systemContent = `你是《无限武库》系统的跨维度数据库引擎「坐标系」，负责对世界档案中的特定字段进行精准重写。

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
    `## 档案上下文\n${archiveCtx}`,
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
