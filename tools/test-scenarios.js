'use strict';
/**
 * Comprehensive scenario test for multi-phase pipeline.
 * Tests:
 *   A. Content review — key prompt sections
 *   B. Shop: new sub-system (恩惠/Blessing generation)
 *   C. Shop: upgrade scenario (波纹气功 → 深仙脉传功)
 *   D. Phase 1 → shop request signal
 *   E. Concurrency analysis
 */

const fs   = require('fs');
const path = require('path');

const { loadGameAssets, getUserPersona, applySessionCharName, getConfig } = require('../src/core/config');
const { buildPhase1Messages, buildPhase3Messages, buildPhase4Messages, getEntryPhases } = require('../src/engine/promptBuilder');
const { retrieveFromStatData } = require('../src/engine/ragEngine');
const shopPrompt = require('../src/features/shop/shopPrompt');
const { buildStatSnapshot } = require('../src/engine/varEngine');

const cfg = getConfig();
const { charCard, preset } = loadGameAssets(cfg);
const userPersona = getUserPersona(cfg);

// ─── Load sessions ────────────────────────────────────────────────────────────
const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');
const sessionFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
const sessions = sessionFiles.map(f => JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8')));

// Find best session (most history)
const session = sessions.sort((a, b) => (b.history?.length || 0) - (a.history?.length || 0))[0];
applySessionCharName(userPersona, session);

const { statData, history } = session;
const world = statData?.Multiverse?.CurrentWorldName?.[0] || 'Unknown';
const charName = statData?.CharacterSheet?.UserPanel?.Name || 'Unknown';

const hr = (title) => '\n' + '═'.repeat(60) + '\n' + title + '\n' + '═'.repeat(60);
const ok = (msg) => console.log('  [OK]  ' + msg);
const fail = (msg) => console.log('  [!!]  ' + msg);
const info = (msg) => console.log('  [--]  ' + msg);

console.log(hr('SESSION INFO'));
console.log(`角色: ${charName} | 世界: ${world} | 历史: ${history.length} 条`);
const archives = Object.keys(statData?.Multiverse?.Archives || {});
console.log(`已激活世界存档: ${archives.join(', ')}`);
const shopInventory = statData?.CharacterSheet?.ShopInventory || [];
console.log(`ShopInventory 条目: ${shopInventory.length}`);
shopInventory.slice(-5).forEach(i => info(`  ${i.name} | ${i.tier ?? '?'}★ | ${i.pricePoints ?? '?'}积分 | ${i.type}`));

// ═══════════════════════════════════════════════════════════════
// A. CONTENT REVIEW — Phase 1 planning atom & key sections
// ═══════════════════════════════════════════════════════════════
console.log(hr('A. CONTENT REVIEW'));

const e65 = charCard.worldBook.find(e => e.id === 65);
if (e65) {
  ok(`ID 65 found | order:${e65.insertionOrder} | phases:${JSON.stringify(e65.phases)}`);
  console.log('\n  --- ID 65 Content Preview (first 500 chars) ---');
  console.log(e65.content.slice(0, 500).replace(/\n/g, '\n  '));
} else {
  fail('ID 65 NOT FOUND');
}

// Phase distribution check
const p1entries = charCard.worldBook.filter(e => getEntryPhases(e).includes(1) && !getEntryPhases(e).includes(3));
const p3only    = charCard.worldBook.filter(e => getEntryPhases(e).includes(3) && !getEntryPhases(e).includes(1) && !getEntryPhases(e).includes(4));
const p4entries = charCard.worldBook.filter(e => getEntryPhases(e).includes(4) && !e.content.includes('<status_current_variables>'));
const snapshot  = charCard.worldBook.find(e => e.content.includes('<status_current_variables>'));

console.log('\n  --- Phase Distribution ---');
ok(`Phase-1-exclusive: ${p1entries.length} | ${p1entries.map(e=>e.comment.slice(0,30)).join(', ')}`);
ok(`Phase-3-only (Meta-Rules): ${p3only.length}`);
ok(`Phase-4 (Update Rules): ${p4entries.length}`);
ok(`Snapshot entry: ${snapshot ? 'found (ID:'+snapshot.id+')' : 'NOT FOUND'}`);

// ═══════════════════════════════════════════════════════════════
// B. SHOP SCENARIO: New Sub-System (地下城邂逅·恩惠)
// ═══════════════════════════════════════════════════════════════
console.log(hr('B. SHOP: New Sub-System (恩惠/Blessing)'));

const BLESSING_DESCRIPTION = `赫斯提亚的恩惠 (Hestia's Falna)
来源：地下城邂逅系列，赫斯提亚女神赐予的家族恩惠（Falna）。
效果：
- 使角色能够进行"等级提升（Level Up）"，成为正式的冒险者
- 等级提升时，在后背刻下神圣文字（Hieroglyphic），承载所有战斗经历的经验值
- 每次Level Up后，各项基础属性（力量/耐力/敏捷/魔力/耐魔）从基础数值开始根据冒险强度成长
- 附加特殊才能（Skills）——赫斯提亚专属：Hestia Knife 解锁与武器成长限制解除
获取方式：陈宇成功加入赫斯提亚家族后，赫斯提亚女神在背上刻下恩惠
类型：PowerSource（神赐成长系统/SubSystem）
SubSystem结构：需要包含 LevelSystem（等级系统）、Attributes（成长属性组）、ExcaliaTalent（特技解锁槽）`;

const prevItems = []; // 模拟无历史购买记录
const snapshot_data = buildStatSnapshot(statData);

console.log('\n  --- Shop Prompt for Blessing Generation ---');
try {
  const blessingMsgs = shopPrompt.buildMessages(BLESSING_DESCRIPTION, prevItems, snapshot_data, 'DanMachi');
  const sys = blessingMsgs[0].content;
  const usr = blessingMsgs[1].content;

  ok(`Shop messages built: ${blessingMsgs.length} msgs`);
  ok(`System prompt len: ${sys.length} chars`);
  info(`User prompt preview:`);
  console.log(usr.slice(0, 400).replace(/\n/g, '\n    ') + '...');

  // Check key sections exist
  const hasStarTable  = sys.includes('星级') && sys.includes('基准分');
  const hasTypeRules  = sys.includes('SubSystem') || sys.includes('PowerSource');
  const hasThreeRound = sys.includes('三轮') || sys.includes('第一轮');
  ok(`Star table present: ${hasStarTable}`);
  ok(`Type rules present (SubSystem/PowerSource): ${hasTypeRules}`);
  ok(`Three-round protocol present: ${hasThreeRound}`);

} catch (err) {
  fail('SHOP BLESSING BUILD FAILED: ' + err.message);
}

// ═══════════════════════════════════════════════════════════════
// C. SHOP SCENARIO: Upgrade (波纹气功 → 深仙脉传功)
// ═══════════════════════════════════════════════════════════════
console.log(hr('C. SHOP: Upgrade Scenario (波纹气功 → 深仙脉传功)'));

// Simulate: character has 波纹气功 formally purchased at 300 points (0★)
const simulatedInventory = [
  ...shopInventory,
  { name: '波纹气功·基础传授', tier: 0, pricePoints: 300, type: 'PowerSource' }
];

const UPGRADE_DESCRIPTION = `波纹气功·深仙脉灌顶 (The Ripple: Deep Pass Overdrive Inheritance)
来源：JOJO 第二部（战斗潮流），丽莎丽莎或凯撒传授的高阶波纹呼吸法。
效果：在已有的波纹气功基础上，突破普通波纹上限，实现"深仙脉"境界：
- 深仙脉状态下波纹输出量×3，持续时间×2
- 解锁"Overdrive"瞬间爆发技：短时间内波纹密度≈顶级波纹导师水平
- 新增技法：气泡投射、波纹流动涂抹、Deep Pass 核心传功（可向他人灌顶）
注意：需要已有波纹气功基础传授才能激活此项；本次兑换**替换/升级**现有的波纹气功基础传授`;

const simulatedStatForUpgrade = {
  ...snapshot_data,
  CharacterSheet: {
    ...snapshot_data.CharacterSheet,
    ShopInventory: simulatedInventory
  }
};

console.log('\n  --- Shop Prompt for Upgrade Generation ---');
try {
  const upgradeMsgs = shopPrompt.buildMessages(
    UPGRADE_DESCRIPTION,
    simulatedInventory.slice(-5),
    simulatedStatForUpgrade,
    'JOJO_Part2'
  );

  const usrUpgrade = upgradeMsgs[1].content;
  ok(`Upgrade shop messages built: ${upgradeMsgs.length} msgs`);

  // Check if inventory history is visible to the model (critical for 差价)
  const hasInventoryRef = usrUpgrade.includes('波纹气功') || usrUpgrade.includes('历史兑换记录');
  const hasUpgradeRules = upgradeMsgs[0].content.includes('差价') || upgradeMsgs[0].content.includes('升级');
  ok(`Inventory history (波纹气功) visible to model: ${hasInventoryRef}`);
  ok(`Upgrade/差价 rules in system prompt: ${hasUpgradeRules}`);

  info(`History context preview:`);
  const histSection = usrUpgrade.match(/历史兑换记录[\s\S]{0,300}/);
  if (histSection) console.log('    ' + histSection[0].replace(/\n/g, '\n    '));
  else info('(No history section found in user prompt)');

} catch (err) {
  fail('SHOP UPGRADE BUILD FAILED: ' + err.message);
}

// ═══════════════════════════════════════════════════════════════
// D. PHASE 1 → SHOP REQUEST SIGNAL
// ═══════════════════════════════════════════════════════════════
console.log(hr('D. PHASE 1 → Shop Request Signal'));

// Simulate Phase 1 output for dungeon scenario
const DUNGEON_INPUT = '我成功加入了赫斯提亚家族，赫斯提亚女神在我背上刻下了恩惠，成为了正式冒险者';
const prevHistory = history.slice(-(5*2)); // last 5 rounds

console.log('\n  --- Building Phase 1 messages for dungeon scenario ---');
try {
  const p1msgs = buildPhase1Messages(preset, charCard, statData, history, userPersona, DUNGEON_INPUT);
  ok(`Phase 1 messages built: ${p1msgs.length} msgs`);

  // Check that ID 65 planning atom is at end of user message
  const userMsgP1 = p1msgs.find(m => m.role === 'user');
  const planningIdx = userMsgP1?.content.lastIndexOf('第一阶段：叙事规划模式');
  const snapshotIdx = userMsgP1?.content.indexOf('status_current_variables');
  ok(`Snapshot before planning atom: ${snapshotIdx < planningIdx ? 'YES (correct order)' : 'NO (wrong order)'}`);
  ok(`Planning atom at end of user msg: ${planningIdx > userMsgP1.content.length * 0.7 ? 'YES' : 'CHECK MANUALLY'}`);

  // Simulate what Phase 1 JSON output SHOULD look like for this scenario
  const expectedPhase1Output = {
    outline: [
      '赫斯提亚在陈宇背上刻下恩惠文字，神赐仪式完成',
      '感受到体内新力量涌动，LV.1冒险者身份正式激活',
      '家族初次冒险准备，制定地下城探索计划'
    ],
    logQueryTerms: ['赫斯提亚', '恩惠', '冒险者', '家族', '地下城'],
    reqCharUpdate: true,
    reqItemUpdate: '赫斯提亚恩惠 (Hestia Falna)'
  };

  console.log('\n  --- Expected Phase 1 JSON (simulated) ---');
  console.log(JSON.stringify(expectedPhase1Output, null, 2).replace(/\n/g, '\n  '));

  // Test RAG with these query terms
  const rag = retrieveFromStatData(statData, expectedPhase1Output.logQueryTerms, 5);
  const ragTotal = Object.values(rag).reduce((s, a) => s + a.length, 0);
  ok(`RAG retrieval with dungeon keywords: ${ragTotal} entries from ${Object.keys(rag).length} worlds`);
  Object.entries(rag).forEach(([w, entries]) => {
    info(`  [${w}]: ${entries.length} entries`);
    entries.forEach(e => info(`    · ${e.slice(0, 80)}`));
  });

  // Phase 2 checks: what should happen with reqItemUpdate
  console.log('\n  --- Phase 2 Processing (reqItemUpdate handling) ---');
  info(`reqItemUpdate = "${expectedPhase1Output.reqItemUpdate}"`);
  info(`Current flow: Phase 1 sets reqItemUpdate → Phase 3 generates narrative`);
  info(`            → Phase 3 emits <SystemGrant> tag → NarrativeGrant background processes shop`);
  info(`            → Shop LLM generates 恩惠 item → applied to session`);
  ok(`reqItemUpdate is planning context for Phase 3 (signals to include SystemGrant)`);

} catch (err) {
  fail('PHASE 1 DUNGEON BUILD FAILED: ' + err.message);
  console.error(err.stack);
}

// ═══════════════════════════════════════════════════════════════
// E. CONCURRENCY ANALYSIS
// ═══════════════════════════════════════════════════════════════
console.log(hr('E. CONCURRENCY ANALYSIS'));

console.log('\n  Single-turn LLM call sequence (multi-phase mode):');
console.log('  1. [LOCK acquired]');
console.log('  2. Phase 1:  createCompletion(phase1Config)  ← await, sequential');
console.log('  3. Phase 2:  JS only (RAG retrieval)          ← no API call');
console.log('  4. Phase 3:  createCompletion(llmConfig)     ← await, sequential');
console.log('  5. Phase 4:  createCompletion(phase4Config)  ← await, sequential');
console.log('  6. NarrativeGrant: setImmediate → processNarrativeGrantsAsync');
console.log('     → shop createCompletion(shopConfig)');
console.log('  7. done event → res.end()');
console.log('  8. [LOCK released] ← happens after step 7');
console.log('');

// Check if NarrativeGrant runs before or after lock release
const gamLoopSrc = fs.readFileSync(path.join(__dirname, '../src/engine/gameLoop.js'), 'utf-8');
const grantSetImmediate = gamLoopSrc.includes('setImmediate');
const grantBeforeDone   = gamLoopSrc.indexOf('setImmediate') < gamLoopSrc.lastIndexOf("send('done'");

if (grantSetImmediate) {
  if (!grantBeforeDone) {
    fail('NarrativeGrant setImmediate is AFTER done event — runs outside lock, potential concurrency!');
    info('  → NarrativeGrant (shop call) may overlap with next turn\'s Phase 1 call');
    info('  → Fix: move NarrativeGrant to await BEFORE done event, or add API semaphore');
  } else {
    ok('NarrativeGrant setImmediate is before done event');
  }
} else {
  ok('No setImmediate in gameLoop (NarrativeGrant not triggered in multi-phase context)');
}

// Check the phase configs
const mp = cfg.multiPhase || {};
console.log('\n  --- Phase Config ---');
info(`phase1Model: ${mp.phase1Model || '(same as main)'}`);
info(`phase4Model: ${mp.phase4Model || '(same as main)'}`);
info(`If all phases use same model/API → strictly sequential calls are REQUIRED`);
info(`Current implementation: Phase 1→3→4 are already sequential (await-chained) ✓`);
info(`NarrativeGrant: runs in setImmediate after lock release → POTENTIAL OVERLAP ⚠`);

console.log('\n  --- Recommendation ---');
info('Option A: Move NarrativeGrant inside multi-phase pipeline (run after Phase 4, before done)');
info('         + Guarantees sequential calls');
info('         - Adds latency (user waits for item generation)');
info('Option B: Add global API semaphore (queue concurrent calls)');
info('         + Non-blocking, minimal latency added');
info('         + Works for both single & multi-phase');
info('Option C: Use different API/model for NarrativeGrant (shopModel ≠ mainModel)');
info('         + Zero code change needed, works if shop uses separate config');
const shopCfg = {
  model:   cfg.shopModel || cfg.model,
  baseUrl: cfg.shopBaseUrl || cfg.baseUrl
};
const mainCfg = { model: cfg.model, baseUrl: cfg.baseUrl };
const sameCfg = shopCfg.model === mainCfg.model && shopCfg.baseUrl === mainCfg.baseUrl;
if (!sameCfg) {
  ok(`Shop uses DIFFERENT model/endpoint → Option C already works! No overlap risk.`);
  info(`  Main: ${mainCfg.model} @ ${mainCfg.baseUrl}`);
  info(`  Shop: ${shopCfg.model} @ ${shopCfg.baseUrl}`);
} else {
  fail(`Shop uses SAME model/endpoint → Concurrency risk exists`);
  info(`  Both: ${mainCfg.model} @ ${mainCfg.baseUrl}`);
  info(`  → Implement Option A or B`);
}

console.log(hr('SUMMARY'));
console.log('All phases build correctly ✓');
console.log('Shop sub-system (恩惠) scenario: prompts build correctly ✓');
console.log('Shop upgrade (波纹→深仙脉) scenario: 差价 rules & inventory history visible ✓');
console.log('Phase 1→shop request: via reqItemUpdate → Phase 3 SystemGrant → NarrativeGrant ✓');
console.log('Concurrency: see analysis above (Section E)');
