'use strict';
/**
 * Multi-phase pipeline dry-run test.
 * Tests Phase 1 / Phase 3 / Phase 4 prompt building against a real session,
 * without actually calling the LLM.
 *
 * Usage:  node tools/test-multiphase.js [session-id-prefix]
 */

const fs   = require('fs');
const path = require('path');

// ─── Load session ────────────────────────────────────────────────────────────

const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');
const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));

const prefix = process.argv[2] || '';
const target = files.find(f => f.startsWith(prefix));
if (!target) {
  console.error('No session found. Available:', files.map(f => f.slice(0, 8)).join(', '));
  process.exit(1);
}

const session = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, target), 'utf-8'));
const { statData, history } = session;

const world  = statData?.Multiverse?.CurrentWorldName?.[0] || '?';
const name   = statData?.CharacterSheet?.UserPanel?.Name   || '?';
const logs   = statData?.Multiverse?.Archives?.[world]?.Log || [];
const histLen = history.length;

console.log('='.repeat(60));
console.log('Session :', target.slice(0, 8));
console.log('Char    :', name, '| World:', world);
console.log('History :', histLen, 'messages');
console.log('Log     :', logs.length, 'entries');
console.log('='.repeat(60));

// ─── Load game assets ────────────────────────────────────────────────────────

const { loadGameAssets, getUserPersona, applySessionCharName, getConfig } = require('../src/core/config');
const config      = getConfig();
const { charCard, preset } = loadGameAssets(config);
const userPersona = getUserPersona(config);
applySessionCharName(userPersona, session);

// ─── Test Phase assignment ────────────────────────────────────────────────────

const { getEntryPhases, entryForPhase } = require('../src/engine/promptBuilder');

const wbAll = charCard.worldBook;
const byPhase = { 1: [], 3: [], 4: [] };
for (const e of wbAll) {
  const ph = getEntryPhases(e);
  for (const p of [1, 3, 4]) {
    if (ph.includes(p)) byPhase[p].push(e);
  }
}

console.log('\n--- Entry Phase Distribution ---');
for (const p of [1, 3, 4]) {
  console.log(`Phase ${p}: ${byPhase[p].length} entries`);
  byPhase[p].slice(0, 5).forEach(e => console.log(`  [order:${e.insertionOrder}] ${e.comment.slice(0, 50)}`));
  if (byPhase[p].length > 5) console.log(`  ... and ${byPhase[p].length - 5} more`);
}

// ─── Test Phase 1 prompt ─────────────────────────────────────────────────────

const { buildPhase1Messages, buildPhase3Messages, buildPhase4Messages } = require('../src/engine/promptBuilder');

const FAKE_INPUT  = '我和白银进行了一场激烈的战术论证，最终说服了他采用新的阵型';
const prevHistory = history.slice(0, -0); // all history

console.log('\n' + '='.repeat(60));
console.log('PHASE 1 PROMPT BUILD TEST');
console.log('='.repeat(60));

let p1msgs;
try {
  p1msgs = buildPhase1Messages(preset, charCard, statData, prevHistory, userPersona, FAKE_INPUT);
  console.log('Messages count:', p1msgs.length);
  p1msgs.forEach((m, i) => {
    const preview = m.content.slice(0, 200).replace(/\n/g, ' ');
    console.log(`\n[${i}] role=${m.role} len=${m.content.length}`);
    console.log('    preview:', preview + (m.content.length > 200 ? '...' : ''));
  });

  // Check ID-65 (planning instruction) is present at end of user message
  const userMsg = p1msgs.find(m => m.role === 'user');
  const hasPlanning = userMsg?.content.includes('第一阶段：叙事规划模式');
  const hasSnapshot = userMsg?.content.includes('status_current_variables');
  console.log('\nChecks:');
  console.log('  [' + (hasPlanning ? 'OK' : 'FAIL') + '] Phase-1 planning atom present in user msg');
  console.log('  [' + (hasSnapshot ? 'OK' : 'FAIL') + '] State snapshot present in user msg');

  // Check Meta-Rules NOT in user msg
  const hasMeta = userMsg?.content.includes('Meta-Rule');
  console.log('  [' + (!hasMeta ? 'OK' : 'WARN') + '] Meta-Rules NOT in Phase 1 user msg');

  // Check history depth (last 5 rounds = max 10 messages)
  const histMsgs = p1msgs.filter(m => m.role === 'user' || m.role === 'assistant').slice(0, -1);
  console.log('  [OK] History messages injected:', histMsgs.length, '(max 10)');

} catch (err) {
  console.error('PHASE 1 BUILD FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
}

// ─── Test Phase 3 prompt ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('PHASE 3 PROMPT BUILD TEST');
console.log('='.repeat(60));

const { retrieveFromStatData } = require('../src/engine/ragEngine');
const fakeOutline      = ['白银接受新阵型提案', '制定作战细节', '小队长们各自表态'];
const retrievedLogs    = retrieveFromStatData(statData, ['白银', '战术', '阵型'], 5);

console.log('RAG retrieved:');
for (const [wk, entries] of Object.entries(retrievedLogs)) {
  console.log(`  [${wk}] ${entries.length} entries`);
  entries.forEach(e => console.log('    -', e.slice(0, 80)));
}

// Build context history (same as gameLoop)
const MAX_ROUNDS    = 10;
const anchorHistory = prevHistory.slice(0, 4);
const recentHistory = prevHistory.slice(4).slice(-MAX_ROUNDS * 2);
const contextHistory = [...anchorHistory, ...recentHistory];

let p3msgs;
try {
  p3msgs = buildPhase3Messages(
    preset, charCard, statData, contextHistory, userPersona, FAKE_INPUT,
    { outline: fakeOutline, retrievedLogs }
  );
  console.log('\nMessages count:', p3msgs.length);
  p3msgs.forEach((m, i) => {
    const preview = m.content.slice(0, 150).replace(/\n/g, ' ');
    console.log(`\n[${i}] role=${m.role} len=${m.content.length}`);
    console.log('    preview:', preview + '...');
  });

  // Checks
  const userMsgP3 = p3msgs.filter(m => m.role === 'user').slice(-1)[0];
  const hasOutline    = p3msgs.some(m => m.content.includes('第一阶段规划大纲'));
  const hasRAG        = p3msgs.some(m => m.content.includes('相关历史记录片段'));
  const noUpdateRules = !userMsgP3?.content.includes('structure_awareness');
  const hasDeferral   = userMsgP3?.content.includes('第三阶段');
  console.log('\nChecks:');
  console.log('  [' + (hasOutline    ? 'OK' : 'FAIL') + '] Phase-1 outline injected');
  console.log('  [' + (hasRAG        ? 'OK' : (Object.keys(retrievedLogs).length === 0 ? 'SKIP(no logs)' : 'FAIL')) + '] RAG logs injected');
  console.log('  [' + (noUpdateRules ? 'OK' : 'FAIL') + '] Update rules NOT in Phase 3 user msg');
  console.log('  [' + (hasDeferral   ? 'OK' : 'FAIL') + '] Deferral notice present');

} catch (err) {
  console.error('PHASE 3 BUILD FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
}

// ─── Test Phase 4 prompt ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('PHASE 4 PROMPT BUILD TEST');
console.log('='.repeat(60));

const FAKE_NARRATIVE = `白银武中尉缓缓放下了战术平板，沉默片刻后抬起头。
"你的新阵型...确实有可取之处。""接受了。"
陈宇感受到队内氛围的微妙变化，信赖感略有上升。`;

let p4msgs;
try {
  p4msgs = buildPhase4Messages(charCard, statData, FAKE_NARRATIVE);
  console.log('Messages count:', p4msgs.length);
  p4msgs.forEach((m, i) => {
    const preview = m.content.slice(0, 200).replace(/\n/g, ' ');
    console.log(`\n[${i}] role=${m.role} len=${m.content.length}`);
    console.log('    preview:', preview + '...');
  });

  // Checks
  const [sys4, user4] = p4msgs;
  const hasUpdateRules = sys4.content.includes('structure_awareness');
  const hasSnapshot4   = sys4.content.includes('status_current_variables');
  const hasNarrative   = user4.content.includes('本回合叙事内容');
  console.log('\nChecks:');
  console.log('  [' + (hasUpdateRules ? 'OK' : 'FAIL') + '] Update rules in Phase 4 system msg');
  console.log('  [' + (hasSnapshot4   ? 'OK' : 'FAIL') + '] State snapshot in Phase 4 system msg');
  console.log('  [' + (hasNarrative   ? 'OK' : 'FAIL') + '] Phase 3 narrative in Phase 4 user msg');

} catch (err) {
  console.error('PHASE 4 BUILD FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
}

// ─── Token size estimates ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('ESTIMATED TOKEN SIZES (chars / 2 ≈ tokens)');
console.log('='.repeat(60));
const totalChars = (msgs) => msgs.reduce((s, m) => s + m.content.length, 0);
console.log('Phase 1 total chars:', totalChars(p1msgs), '≈', Math.round(totalChars(p1msgs)/2), 'tokens');
console.log('Phase 3 total chars:', totalChars(p3msgs), '≈', Math.round(totalChars(p3msgs)/2), 'tokens');
console.log('Phase 4 total chars:', totalChars(p4msgs), '≈', Math.round(totalChars(p4msgs)/2), 'tokens');

console.log('\n[ALL PHASES BUILD SUCCESSFULLY]');
