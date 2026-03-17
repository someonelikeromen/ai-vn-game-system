'use strict';
const ragEngine    = require('../src/engine/ragEngine');
const regexPipeline = require('../src/engine/regexPipeline');
const regex        = require('../src/content/regex');

let ok = true;

// 1. extractOptions — Chinese pattern fix
const { extractOptions } = regexPipeline;
const testText = '<options>\n>选项一：继续前进\n>选项二：原地等待\n>选项三：撤退\n</options>';
const result = extractOptions(testText);
const labels = result.options.map(o => o.label);
if (labels.length === 3 && labels[0] === '继续前进') {
  console.log('[OK] extractOptions:', JSON.stringify(labels));
} else {
  console.error('[FAIL] extractOptions:', JSON.stringify(labels));
  ok = false;
}

// 2. extractCombatData
const { extractCombatData, formatCombatData } = ragEngine;
const statData = {
  Multiverse: {
    CurrentWorldName: 'TestWorld',
    Archives: {
      TestWorld: {
        PowerSystems: [
          { name: '死体病毒变异', category: '生物', typicalTierRange: '0★', peakTierRange: '0★',
            description: '被感染的尸体', universalLimits: ['对声音敏感', '破坏大脑即停止'] },
          { name: '现代武术', category: '武道', typicalTierRange: '0★', description: '普通人类战斗' }
        ],
        Log: []
      }
    }
  }
};
const combatResult = extractCombatData(statData, ['死体', '感染']);
if (combatResult && combatResult.entities.length > 0) {
  console.log('[OK] extractCombatData:', combatResult.entities.map(e => e.name));
} else {
  console.error('[FAIL] extractCombatData returned null or empty');
  ok = false;
}

// 3. multiPhase enabled
const cfg = require('../config.json');
if (cfg.multiPhase && cfg.multiPhase.enabled === true) {
  console.log('[OK] multiPhase.enabled:', cfg.multiPhase.enabled);
} else {
  console.error('[FAIL] multiPhase.enabled:', cfg.multiPhase?.enabled);
  ok = false;
}

// 4. Rule2 regex fixed (no dangerous .*?</think> anymore)
const rule2 = regex.ALL_RULES.find(r => r.scriptName.startsWith('2去多余内容'));
if (rule2 && !rule2.findRegex.includes('.*?</think')) {
  console.log('[OK] Rule2 does not contain dangerous .*?</think> pattern');
} else {
  console.error('[FAIL] Rule2 still has dangerous pattern:', rule2?.findRegex?.slice(0, 80));
  ok = false;
}

// 5. Option beautify rules disabled
const optRule = regex.ALL_RULES.find(r => r.id === '88eccfd0-eaed-48a0-afc6-5e23d17116f7');
if (optRule && optRule.disabled === true) {
  console.log('[OK] Options beautify rule (可爱版) disabled');
} else {
  console.error('[FAIL] Options beautify rule still enabled');
  ok = false;
}

// 6. processForPrompt strips SystemGrant
const { processForPrompt } = regexPipeline;
const withGrant = 'some text<SystemGrant>{"name":"test"}</SystemGrant>more';
const stripped = processForPrompt([], withGrant, 0);
if (!stripped.includes('<SystemGrant>')) {
  console.log('[OK] processForPrompt strips SystemGrant');
} else {
  console.error('[FAIL] processForPrompt does not strip SystemGrant');
  ok = false;
}

console.log('\n' + (ok ? '=== ALL CHECKS PASSED ===' : '=== SOME CHECKS FAILED ==='));
process.exit(ok ? 0 : 1);
