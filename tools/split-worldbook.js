'use strict';
/**
 * tools/split-worldbook.js
 * Atomise large worldbook entries into individual section-level entries.
 *
 * Run:  node tools/split-worldbook.js
 * Output: writes src/content/worldbook.js directly.
 */

const fs   = require('fs');
const path = require('path');
const { ENTRIES_RAW } = require('../src/content/worldbook');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Split content string at every occurrence of a regex boundary.
 *  The boundary itself is kept at the START of the next chunk.
 */
function splitAt(content, ...patterns) {
  // Build a single alternation regex from all patterns
  const combined = new RegExp(
    patterns.map(p => (p instanceof RegExp ? p.source : p)).join('|'),
    'g'
  );

  const chunks = [];
  let lastEnd  = 0;
  let m;
  combined.lastIndex = 0;
  while ((m = combined.exec(content)) !== null) {
    if (m.index > lastEnd) {
      chunks.push(content.slice(lastEnd, m.index));
    }
    lastEnd = m.index;          // boundary included in next chunk
  }
  chunks.push(content.slice(lastEnd));
  return chunks.map(c => c.trim()).filter(c => c.length > 30);
}

/** Clone WB entry skeleton, overriding provided fields. */
function mkEntry(base, id, comment, content, insertionOrder) {
  return {
    id,
    keys:            [],
    secondary_keys:  [],
    comment,
    content,
    constant:        base.constant  !== false,
    selective:       base.selective !== false,
    insertion_order: insertionOrder,
    enabled:         base.enabled   !== false,
    position:        base.position  || 'before_char',
    use_regex:       base.use_regex !== false,
    extensions: {
      ...base.extensions,
      display_index: id,
      insertion_order: insertionOrder,
    },
  };
}

// ─── labels: pick a short title from the first line of a chunk ───────────────

function titleOf(chunk, fallback) {
  const first = chunk.split('\n').find(l => l.trim().length > 0) || '';
  // strip markdown markers
  const t = first.replace(/^[#*_>\s]+/, '').replace(/[*_`]+/g, '').trim();
  return t.length > 5 && t.length < 80 ? t : fallback;
}

// ─── Split each large entry ───────────────────────────────────────────────────

const ORIG = Object.fromEntries(ENTRIES_RAW.map(e => [e.id, e]));

const newEntries = [];
let   nextId     = 10;   // start fresh after existing IDs (max is 9)

// ── Keep disabled/special entries unchanged ────────────────────────────────
// id:0  InitVar          (disabled, before_char)
// id:1  RENDER:BEFORE    (disabled, before_char)
// id:9  地错 Falna       (disabled, before_char)
for (const id of [0, 1, 9]) {
  newEntries.push({ ...ORIG[id], insertion_order: { 0: 900, 1: 901, 9: 902 }[id] });
}

// ─────────────────────────────────────────────────────────────────────────────
// id:3  卷一：总纲与基础架构  (before_char, extPos=0, depth=4)
// Split into 14 atomic entries, insertionOrder 101-114
// ─────────────────────────────────────────────────────────────────────────────
{
  const base = ORIG[3];
  const chunks = splitAt(
    base.content,
    /\n---\n\n\*\*法则/,
    /\n---\n#### \*\*第一章/,
    /\n\n\*\*1\.1 /,
    /\n\n\*\*1\.2 /,
    /\n#### \*\*1\.2\.1/,
    /\n\*\*1\.2\.2 /,
    /\n\*\*1\.2\.2\.1/,
    /\n#### \*\*1\.2\.3/,
    /\n\n#### \*\*1\.2\.4/,
    /\n\n\*\*1\.3 /,
    /\n\n\*\*1\.4 /,
    /\n### \*\*1\.5 /,
    /\n\n### \*\*1\.6 /,
    /\n\n\*\*1\.7 /
  );

  const names = [
    '卷一-序章与法则零：实证主义至上',
    '卷一-法则一：量级权威与Hax抑制',
    '卷一-法则二：战术情报优先',
    '卷一-法则四：信息来源纯净',
    '卷一-法则五：因果锁定',
    '卷一-1.1 系统交互原则（寂静观察者）',
    '卷一-1.2 积分',
    '卷一-1.2.2 星级徽章（获取与重复衰减）',
    '卷一-1.2.2.1 徽章流转协议',
    '卷一-1.2.3 战斗收益结算协议',
    '卷一-1.2.4 团队战斗与贡献分配',
    '卷一-1.3 主角状态栏',
    '卷一-1.4 核心维度与增长模型',
    '卷一-1.5 星级评定与综合战力总表',
    '卷一-1.6 被动成就记录系统',
    '卷一-1.7 加成计算与边际效应',
  ];

  chunks.forEach((c, i) => {
    const order = 101 + i;
    newEntries.push(mkEntry(base, nextId++, names[i] || titleOf(c, `卷一-[${i+1}]`), c, order));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// id:4  卷二：通用评估协议  (before_char, extPos=0, depth=4)
// ─────────────────────────────────────────────────────────────────────────────
{
  const base = ORIG[4];
  const chunks = splitAt(
    base.content,
    /\n\*   \*\*2\.1\.1 步骤一/,
    /\n    \*   \*\*C\) 属性提纯协议/,
    /\n\*   \*\*2\.1\.2 步骤二/,
    /\n\*   \*\*2\.1\.3 步骤三/,
    /\n\*   \*\*2\.1\.4 步骤四/,
    /\n---\n\n\*\*2\.2 /,
    /\n---\n\n\*\*2\.3 /
  );

  const names = [
    '卷二-引言与2.1定级总则',
    '卷二-2.1.1A-B 反向表现审查（扒盒子）',
    '卷二-2.1.1C-E 属性提纯与固有剥离',
    '卷二-2.1.2 原作表现定位',
    '卷二-2.1.3 功能维度判定与降级',
    '卷二-2.1.4 量级基准分总表',
    '卷二-2.2 第二轮：完整修正维度表',
    '卷二-2.3 第三轮：最终星级裁定',
  ];

  chunks.forEach((c, i) => {
    const order = 201 + i;
    newEntries.push(mkEntry(base, nextId++, names[i] || titleOf(c, `卷二-[${i+1}]`), c, order));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// id:5  卷三：能力体系与成长机制  (before_char, extPos=0, depth=4)
// ─────────────────────────────────────────────────────────────────────────────
{
  const base = ORIG[5];
  const chunks = splitAt(
    base.content,
    /\n\*   \*\*3\.1\.1 /,
    /\n\*\*3\.2 /,
    /\n\*\*3\.3 /,
    /\n\*\*3\.4 /,
    /\n---\n\n#### \*\*第四章/,
    /\n\*\*4\.1\.1 /,
    /\n\*\*4\.1\.2 /,
    /\n\*\*4\.2 /,
    /\n\*\*5\.1 /
  );

  const names = [
    '卷三-第三章引言：基盘能力的本质',
    '卷三-3.1.1 兑换基盘能力所获内容',
    '卷三-3.2 成长双轨模型（熟练度+境界）',
    '卷三-3.3 突破门槛类型',
    '卷三-3.4 科技树与能量特效规则文本',
    '卷三-第四章引言：应用技巧的本质',
    '卷三-4.1.1 制御技巧',
    '卷三-4.1.2 构式法则',
    '卷三-4.2 应用技巧成长与规则文本',
    '卷三-5.1 资质评级标准',
  ];

  chunks.forEach((c, i) => {
    const order = 301 + i;
    newEntries.push(mkEntry(base, nextId++, names[i] || titleOf(c, `卷三-[${i+1}]`), c, order));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// id:6  Meta-Rule: Player Knowledge Boundary  (after_char, extPos=4, depth=0)
// Split into 5 atomic entries, insertionOrder 1-5
// ─────────────────────────────────────────────────────────────────────────────
{
  const base = ORIG[6];
  const chunks = splitAt(
    base.content,
    /\n3\.\s+\*\*能力内化原则/,
    /\n1\.\s+\*\*\s+4\. 属性隐形/,
    /\n\*\*5\. 兑换的无痛内化/,
    /\n\*\*6\. 被动技能的静默/,
    /\n\*\*7\. 兑换事件的叙事/,
    /\n\*\*8\. 徽章完整性/,
    /\n\*\*9\. 本土与穿越者/
  );

  const names = [
    'Meta-Rule-1~3 基础规则、角色体验与系统静默',
    'Meta-Rule-3续 能力内化原则（最高核心指令）',
    'Meta-Rule-4 属性隐形与感知逻辑（No-Radar Rule）',
    'Meta-Rule-5 兑换的无痛内化原则',
    'Meta-Rule-6 被动技能静默运转原则',
    'Meta-Rule-7 兑换事件叙事处理',
    'Meta-Rule-8 徽章完整性原则',
    'Meta-Rule-9 本土与穿越者叙事区别',
  ];

  chunks.forEach((c, i) => {
    const order = i + 1;
    newEntries.push(mkEntry(base, nextId++, names[i] || titleOf(c, `Meta-Rule-[${i+1}]`), c, order));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// id:2  更新规则  (after_char, extPos=4, depth=0)
// Split into: core (snapshot, id stays 2) + rule groups + examples
// ─────────────────────────────────────────────────────────────────────────────
{
  const base = ORIG[2];
  const chunks = splitAt(
    base.content,
    /\n  structure_awareness:/,
    /\n  logic_core_mechanics:/,
    /\n  format: \|-/,
    /\n  # === 示例 1:/,
    /\n  # === 示例 2:/,
    /\n  # === 示例 3:/,
    /\n  # === 示例 4:/,
    /\n  # === 示例 5:/,
    /\n  # === 示例 6:/,
    /\n  # === 示例 7:/,
    /\n  # === 示例 8:/,
    /\n  # === 示例: 社交关系/,
    /\n  # === 示例: 获取星级徽章/
  );

  const names = [
    '更新规则-主体（变量快照指令）',       // ← must keep <status_current_variables>
    '更新规则-结构规则 structure_awareness',
    '更新规则-核心机制 logic_core_mechanics',
    '更新规则-输出格式模板 format',
    '更新规则-示例1：学习流派与复杂子招式',
    '更新规则-示例2：挂载子系统与资质成长',
    '更新规则-示例3：物品变形与演出效果',
    '更新规则-示例4：招募同伴（10维属性初始化）',
    '更新规则-示例5：物品清理与成就',
    '更新规则-示例6：多元宇宙世界内更新与切换',
    '更新规则-示例7：更换装备（外观同步）',
    '更新规则-示例8：属性成长与数值重算',
    '更新规则-示例：社交关系对象插入语法',
    '更新规则-示例：获取星级徽章',
  ];

  chunks.forEach((c, i) => {
    // Keep original id:2 for the snapshot entry (first chunk)
    const useId = (i === 0) ? 2 : nextId++;
    const order = (i === 0) ? 999 : (990 + i);
    newEntries.push(mkEntry(base, useId, names[i] || titleOf(c, `更新规则-[${i+1}]`), c, order));
  });
}

// ─── Sort entries for display: before_char by insertionOrder, then after_char ─

newEntries.sort((a, b) => {
  const posA = a.extensions?.position ?? 0;
  const posB = b.extensions?.position ?? 0;
  if (posA !== posB) return posA - posB;
  return (a.insertion_order ?? 100) - (b.insertion_order ?? 100);
});

// Reassign display_index sequentially
newEntries.forEach((e, i) => {
  e.extensions = e.extensions || {};
  e.extensions.display_index = i;
});

// ─── Print summary ────────────────────────────────────────────────────────────
console.log(`\n=== Split Summary ===`);
console.log(`Original entries: ${ENTRIES_RAW.length}`);
console.log(`New entries: ${newEntries.length}`);
console.log('');
newEntries.forEach(e => {
  const pos = e.extensions?.position ?? 0;
  const dep = e.extensions?.depth    ?? 4;
  console.log(`  [id:${String(e.id).padStart(3)}] order:${String(e.insertion_order).padStart(4)} pos:${pos} depth:${dep} en:${e.enabled?'Y':'N'}  ${e.comment}`);
});

// ─── Emit new worldbook.js ────────────────────────────────────────────────────

const lines = [
  `'use strict';`,
  `/**`,
  ` * Built-in World Book — atomised entries (generated by tools/split-worldbook.js).`,
  ` *`,
  ` * extPosition: 0=worldInfoBefore, 1=worldInfoAfter, 4=last user message`,
  ` * depth:       0=last message, 4=4 messages back`,
  ` * insertionOrder: lower = injected first`,
  ` */`,
  ``,
  `const ENTRIES_RAW = ${JSON.stringify(newEntries, null, 2)};`,
  ``,
  `/**`,
  ` * Get all worldbook entries in game-engine format (enabled entries only).`,
  ` * Compatible with configLoader.parseWorldBook() output.`,
  ` */`,
  `function getAllEntries() {`,
  `  return ENTRIES_RAW`,
  `    .filter(e => e.enabled !== false)`,
  `    .map(e => ({`,
  `      id:             e.id,`,
  `      comment:        e.comment || '',`,
  `      keys:           e.keys    || [],`,
  `      content:        e.content || '',`,
  `      enabled:        true,`,
  `      constant:       !!e.constant,`,
  `      position:       e.position || 'before_char',`,
  `      insertionOrder: e.insertion_order ?? 100,`,
  `      extPosition:    e.extensions?.position    ?? 0,`,
  `      depth:          e.extensions?.depth       ?? 4,`,
  `      role:           e.extensions?.role        ?? 0,`,
  `      probability:    e.extensions?.probability ?? 100,`,
  `      sticky:         e.extensions?.sticky      ?? 0,`,
  `      selective:      !!e.selective,`,
  `      selectiveLogic: e.selective_logic ?? 0,`,
  `      secondaryKeys:  e.secondary_keys  || [],`,
  `    }));`,
  `}`,
  ``,
  `module.exports = { ENTRIES_RAW, getAllEntries };`,
];

const outPath = path.join(__dirname, '..', 'src', 'content', 'worldbook.js');
fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`\n✓ Written to ${outPath}`);
