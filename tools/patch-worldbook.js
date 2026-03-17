'use strict';
/**
 * tools/patch-worldbook.js
 * Fixes label mismatches and order conflicts produced by split-worldbook.js.
 * Re-splits id:60 which contains 3 merged examples.
 * Run once: node tools/patch-worldbook.js
 */

const fs   = require('fs');
const path = require('path');
const { ENTRIES_RAW } = require('../src/content/worldbook');

// Deep-copy all entries
const entries = JSON.parse(JSON.stringify(ENTRIES_RAW));
const byId = Object.fromEntries(entries.map(e => [e.id, e]));

// ── Helper ────────────────────────────────────────────────────────────────────
function fix(id, comment) {
  if (!byId[id]) { console.warn('WARNING: id', id, 'not found'); return; }
  byId[id].comment = comment;
}
function setOrder(id, order) {
  if (!byId[id]) { console.warn('WARNING: id', id, 'not found'); return; }
  byId[id].insertion_order = order;
  byId[id].extensions = byId[id].extensions || {};
  byId[id].extensions.insertion_order = order;
}

// ── 卷一 label fixes (all off-by-one due to 法则零 triggering the --- splitter) ─
fix(10, '卷一-序章引言（法则总纲前言）');
fix(11, '卷一-法则零：实证主义至上原则');
fix(12, '卷一-法则一：量级权威与Hax抑制原则');
fix(13, '卷一-法则二：战术情报优先原则');
fix(14, '卷一-法则四+法则五+多元宇宙穿梭协议');
fix(15, '卷一-1.1 第一章标题（系统基础架构）');
fix(16, '卷一-1.1 系统交互原则（寂静观察者）');
fix(17, '卷一-1.2 双轨货币体系概述');
fix(18, '卷一-1.2.1 积分（Points）');
fix(19, '卷一-1.2.2 星级徽章与重复衰减');
fix(20, '卷一-1.2.3 战斗收益结算协议');
fix(21, '卷一-1.2.4 团队战斗与贡献分配');
fix(22, '卷一-1.3 主角状态栏');
fix(23, '卷一-1.4 核心维度与增长模型');
fix(24, '卷一-1.5 星级评定与综合战力总表');
fix(25, '卷一-1.6 被动成就记录系统');
fix(26, '卷一-1.7 加成计算与边际效应法则');

// ── 卷三 label fixes ────────────────────────────────────────────────────────────
fix(40, '卷三-第四章+4.1.1制御技巧+4.1.2构式法则（引言与分类）');
fix(41, '卷三-4.2 应用技巧的成长与规则文本');
fix(42, '卷三-5.1 资质评级标准');

// ── 更新规则 label fixes (示例编号偏移) ────────────────────────────────────────
fix(53, '更新规则-输出格式模板+示例1（学习复杂子招式）');
fix(54, '更新规则-示例2：挂载子系统与资质成长');
fix(55, '更新规则-示例3：物品变形与演出效果');
fix(56, '更新规则-示例4：招募同伴（10维属性初始化）');
fix(57, '更新规则-示例5：物品清理与成就');
fix(58, '更新规则-示例6：多元宇宙世界内更新与切换');
fix(59, '更新规则-示例7：更换装备（外观同步）');
// id:60 contains 示例8 + 社交关系 + 获取星级徽章 — split below

// ── Fix order conflict: id:59 clashes with id:2 (both order:999) ──────────────
setOrder(59, 1001);

// ── Split id:60 into 4 entries ────────────────────────────────────────────────
// id:60 actually contains: 示例8 + 示例9(世界内更新) + 机动兵器完整结构 + 获取星级徽章
const e60 = byId[60];
const raw60 = e60.content;

// Use exact marker strings found in the content (no leading spaces for 8/5/badge; 2 spaces for 9)
const MARKER9    = '\n  # === 示例 9:';        // 示例9 世界内更新
const MARKER_MECH = '\n# === 示例 5: 机动兵器'; // 机动兵器完整结构
const MARKER_BADGE = '\n# === 示例: 获取星级徽章'; // 获取星级徽章

const pos9    = raw60.indexOf(MARKER9);
const posMech = raw60.indexOf(MARKER_MECH);
const posBadge = raw60.indexOf(MARKER_BADGE);

console.log('id:60 length:', raw60.length);
console.log('示例9 marker at:', pos9, '  机动兵器 at:', posMech, '  星级徽章 at:', posBadge);

const base60 = { ...e60 };

if (pos9 > 0 && posMech > 0 && posBadge > 0) {
  // 示例8 chunk
  e60.content        = raw60.slice(0, pos9).trim();
  e60.comment        = '更新规则-示例8：属性成长与数值重算';
  e60.insertion_order = 1002;
  e60.extensions     = { ...e60.extensions, insertion_order: 1002 };

  // 示例9 世界内更新 — new entry id:61
  const c61 = raw60.slice(pos9, posMech).trim();
  entries.push({ ...base60, id: 61, comment: '更新规则-示例9：世界内更新与本地日志',
    content: c61, insertion_order: 1003,
    extensions: { ...base60.extensions, display_index: 61, insertion_order: 1003 } });

  // 机动兵器完整结构 — new entry id:62
  const c62 = raw60.slice(posMech, posBadge).trim();
  entries.push({ ...base60, id: 62, comment: '更新规则-示例：机动兵器完整结构',
    content: c62, insertion_order: 1004,
    extensions: { ...base60.extensions, display_index: 62, insertion_order: 1004 } });

  // 获取星级徽章 — new entry id:63
  const c63 = raw60.slice(posBadge).trim();
  if (c63.length > 30) {
    entries.push({ ...base60, id: 63, comment: '更新规则-示例：获取星级徽章',
      content: c63, insertion_order: 1005,
      extensions: { ...base60.extensions, display_index: 63, insertion_order: 1005 } });
  }
  console.log('\n✓ Split id:60 into 4 entries (60, 61, 62, 63)');
} else {
  // Partial splits based on what was found
  let cursor = 0;
  const markers = [
    { pos: pos9,    id: 61, comment: '更新规则-示例9：世界内更新', order: 1003 },
    { pos: posMech, id: 62, comment: '更新规则-示例：机动兵器完整结构', order: 1004 },
    { pos: posBadge,id: 63, comment: '更新规则-示例：获取星级徽章', order: 1005 },
  ].filter(m => m.pos > 0).sort((a, b) => a.pos - b.pos);

  if (markers.length > 0) {
    e60.content = raw60.slice(0, markers[0].pos).trim();
    e60.comment = '更新规则-示例8：属性成长与数值重算';
    e60.insertion_order = 1002;
    for (let i = 0; i < markers.length; i++) {
      const end = i + 1 < markers.length ? markers[i + 1].pos : raw60.length;
      const c = raw60.slice(markers[i].pos, end).trim();
      if (c.length > 30) {
        entries.push({ ...base60, id: markers[i].id, comment: markers[i].comment,
          content: c, insertion_order: markers[i].order,
          extensions: { ...base60.extensions, display_index: markers[i].id, insertion_order: markers[i].order } });
      }
    }
    console.log('\n✓ Partial split of id:60, created', markers.length, 'extra entries');
  } else {
    e60.comment = '更新规则-示例8+9+机动兵器+徽章（合并）';
    e60.insertion_order = 1002;
    console.log('\nWARN: id:60 split markers not found, relabelled only');
  }
}

// ── Re-sort and reassign display_index ───────────────────────────────────────
entries.sort((a, b) => {
  const pA = a.extensions?.position ?? 0;
  const pB = b.extensions?.position ?? 0;
  if (pA !== pB) return pA - pB;
  return (a.insertion_order ?? 100) - (b.insertion_order ?? 100);
});
entries.forEach((e, i) => {
  e.extensions = e.extensions || {};
  e.extensions.display_index = i;
});

// ── Print summary ─────────────────────────────────────────────────────────────
console.log('\n=== After patch ===');
console.log('Total entries:', entries.length);
entries.forEach(e => {
  const pos = e.extensions?.position ?? 0;
  const dep = e.extensions?.depth    ?? 4;
  console.log(`  [id:${String(e.id).padStart(3)}] order:${String(e.insertion_order).padStart(5)} pos:${pos} dep:${dep} en:${e.enabled?'Y':'N'}  ${e.comment}`);
});

// ── Write worldbook.js ────────────────────────────────────────────────────────
const lines = [
  `'use strict';`,
  `/**`,
  ` * Built-in World Book — atomised entries.`,
  ` * Generated by tools/split-worldbook.js then patched by tools/patch-worldbook.js.`,
  ` *`,
  ` * extPosition: 0=worldInfoBefore, 1=worldInfoAfter, 4=last user message`,
  ` * depth:       0=last message, 4=4 messages back`,
  ` * insertionOrder: lower = injected first (within same position group)`,
  ` */`,
  ``,
  `const ENTRIES_RAW = ${JSON.stringify(entries, null, 2)};`,
  ``,
  `/**`,
  ` * Get all worldbook entries in game-engine format (enabled entries only).`,
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
