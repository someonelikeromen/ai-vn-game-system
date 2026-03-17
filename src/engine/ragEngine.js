'use strict';
/**
 * RAG Engine — keyword-based retrieval over world archive logs.
 *
 * Each world's Multiverse.Archives.<World>.Log[] is treated as a
 * separate document store. Phase 1 supplies query terms; Phase 2
 * runs this retriever to surface the most relevant entries before
 * the main (Phase 3) generation call.
 */

// ─── Tokenizer ────────────────────────────────────────────────────────────────

/**
 * Tokenize a string into lowercase tokens.
 * CJK characters are treated individually; ASCII sequences as words.
 */
function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  const re = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\uff00-\uffef]|[a-zA-Z0-9]+/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text)) !== null) tokens.push(m[0].toLowerCase());
  return tokens;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score a single log entry against a Set of query tokens.
 * Returns number of unique query tokens matched.
 */
function scoreEntry(entryText, queryTokenSet) {
  if (!queryTokenSet.size) return 0;
  const entryTokens = new Set(tokenize(entryText));
  let hits = 0;
  for (const qt of queryTokenSet) {
    if (entryTokens.has(qt)) hits++;
  }
  return hits;
}

// ─── Core Retrieval ───────────────────────────────────────────────────────────

/**
 * Retrieve the top-K most relevant log entries from an array.
 *
 * Scoring: number of query token matches (descending), tie-broken by
 * recency (higher index = more recent, preferred).
 *
 * Always guarantees at least the last `recentFloor` entries (for freshness).
 *
 * @param {string[]} logs        - All log entries for one world
 * @param {string[]} queryTerms  - Query strings from Phase 1
 * @param {number}   topK        - Max entries to return
 * @param {number}   recentFloor - Minimum recent entries always included
 * @returns {string[]} - Chronologically ordered relevant entries
 */
function retrieveRelevantLogs(logs, queryTerms, topK = 8, recentFloor = 3) {
  if (!Array.isArray(logs) || logs.length === 0) return [];

  const entries = logs
    .map((e, i) => ({ text: String(e), index: i }))
    .filter(e => e.text && !e.text.startsWith('$'));

  if (!queryTerms || queryTerms.length === 0) {
    return entries.slice(-topK).map(e => e.text);
  }

  const queryTokenSet = new Set(queryTerms.flatMap(tokenize));

  // Score all entries
  const scored = entries.map(e => ({
    ...e,
    score: scoreEntry(e.text, queryTokenSet),
  }));

  // Always include the most recent `recentFloor` entries
  const recentIndices = new Set(
    entries.slice(-recentFloor).map(e => e.index)
  );

  // Sort by score DESC, then recency DESC
  const sorted = [...scored].sort(
    (a, b) => b.score - a.score || b.index - a.index
  );

  // Collect top-K, ensuring recent entries are in the set
  const selectedIndices = new Set();
  for (const e of sorted) {
    if (selectedIndices.size >= topK) break;
    selectedIndices.add(e.index);
  }
  for (const idx of recentIndices) {
    if (selectedIndices.size >= topK + recentFloor) break;
    selectedIndices.add(idx);
  }

  // Return in chronological order
  return entries
    .filter(e => selectedIndices.has(e.index))
    .map(e => e.text);
}

// ─── Multi-World Retrieval ────────────────────────────────────────────────────

/**
 * Retrieve relevant logs from all active world archives in statData.
 *
 * @param {object}   statData    - Full game state
 * @param {string[]} queryTerms  - Search terms from Phase 1
 * @param {number}   topK        - Max entries per world
 * @returns {{ [worldKey]: string[] }} - World-keyed results
 */
function retrieveFromStatData(statData, queryTerms, topK = 8) {
  const archives = statData?.Multiverse?.Archives || {};
  const result = {};

  for (const [worldKey, archive] of Object.entries(archives)) {
    if (!archive || typeof archive === 'string' || worldKey.startsWith('$')) continue;

    const logs = Array.isArray(archive.Log)
      ? archive.Log.filter(l => l && typeof l === 'string' && !l.startsWith('$'))
      : [];

    if (logs.length === 0) continue;

    const relevant = retrieveRelevantLogs(logs, queryTerms, topK);
    if (relevant.length > 0) result[worldKey] = relevant;
  }

  return result;
}

/**
 * Format retrieved logs as a compact context string for injection.
 *
 * @param {{ [worldKey]: string[] }} retrievedLogs
 * @returns {string}
 */
function formatRetrievedLogs(retrievedLogs) {
  const lines = [];
  for (const [worldKey, entries] of Object.entries(retrievedLogs)) {
    lines.push(`【${worldKey} — 相关历史记录（共 ${entries.length} 条）】`);
    for (const e of entries) lines.push(`  • ${e}`);
  }
  return lines.join('\n');
}

// ─── Combat Data Extraction ───────────────────────────────────────────────────

/**
 * Extract combat-relevant PowerSystem entries from the current world's archive.
 *
 * Called in Phase 2 when Phase 1 sets reqCombatEnemies.
 * Searches the current world's PowerSystems array for entries whose name or
 * description mentions any of the requested enemy/entity names.
 * Falls back to ALL power systems if no specific match is found (still useful
 * context for combat generation).
 *
 * @param {object}   statData    - Full game state
 * @param {string[]} enemyNames  - Enemy/NPC names from Phase 1 reqCombatEnemies
 * @returns {{ worldKey: string, entities: object[] } | null }
 */
function extractCombatData(statData, enemyNames) {
  if (!enemyNames || enemyNames.length === 0) return null;

  const curWorld = Array.isArray(statData?.Multiverse?.CurrentWorldName)
    ? statData.Multiverse.CurrentWorldName[0]
    : (statData?.Multiverse?.CurrentWorldName || null);
  if (!curWorld) return null;

  const worldData    = statData?.Multiverse?.Archives?.[curWorld] || {};
  const powerSystems = Array.isArray(worldData.PowerSystems) ? worldData.PowerSystems : [];
  const worldNPCs    = Array.isArray(worldData.NPCs) ? worldData.NPCs : [];

  if (powerSystems.length === 0 && worldNPCs.length === 0) return null;

  // Tokenize all enemy names for matching
  const enemyTokens = enemyNames.flatMap(tokenize);
  const enemySet    = new Set(enemyTokens);

  // ── Search PowerSystems for matching entries ────────────────────────────────
  const scoredPS = powerSystems.map(ps => {
    const text  = (ps.name || '') + ' ' + (ps.description || '') +
                  ' ' + (ps.category || '') + ' ' +
                  (Array.isArray(ps.universalMechanics) ? ps.universalMechanics.join(' ') : '') +
                  ' ' + (Array.isArray(ps.universalLimits) ? ps.universalLimits.join(' ') : '');
    return { item: ps, score: scoreEntry(text, enemySet), sourceType: 'PowerSystem' };
  });
  const matchedPS = scoredPS.filter(e => e.score > 0).sort((a, b) => b.score - a.score);

  // ── Search Archives.<World>.NPCs for matching entities ─────────────────────
  const scoredNPCs = worldNPCs.map(npc => {
    const text = (npc.name || '') + ' ' + (npc.description || '') +
                 ' ' + (npc.type || '') + ' ' +
                 (npc.CombatProfile
                   ? (npc.CombatProfile.TacticsAndBehavior || '') + ' ' +
                     (Array.isArray(npc.CombatProfile.Abilities)
                       ? npc.CombatProfile.Abilities.map(a => a.name || '').join(' ')
                       : '')
                   : '');
    return { item: npc, score: scoreEntry(text, enemySet), sourceType: 'NPC' };
  });
  const matchedNPCs = scoredNPCs.filter(e => e.score > 0).sort((a, b) => b.score - a.score);

  // Combine: matched NPCs take priority (they are more specific), then PS entries
  // Fallback: if nothing matched, return top PS entries
  const combinedMatched = [...matchedNPCs.slice(0, 3), ...matchedPS.slice(0, 2)];
  const fallback        = scoredPS.slice(0, 3);

  const selected = (combinedMatched.length > 0 ? combinedMatched : fallback)
    .slice(0, 4)
    .map(e => ({ ...e.item, _sourceType: e.sourceType }));

  return { worldKey: curWorld, entities: selected };
}

/**
 * Format combat data as a compact context string for Phase 3 injection.
 *
 * @param {{ worldKey: string, entities: object[] } | null} combatData
 * @returns {string}
 */
function formatCombatData(combatData) {
  if (!combatData || !combatData.entities || combatData.entities.length === 0) return '';
  const { worldKey, entities } = combatData;
  const lines = [`【战斗参照 — ${worldKey}（Phase 2 提取）】`];

  for (const entity of entities) {
    const sourceType = entity._sourceType || 'PowerSystem';

    if (sourceType === 'NPC') {
      // NPC/Monster entry from Archives.<World>.NPCs
      const cp = entity.CombatProfile || {};
      lines.push(`\n▸ **[${entity.type || 'NPC'}] ${entity.name}**（${entity.tier ?? '?'}★ | 敌对：${entity.hostile ? '是' : '否'}）`);
      if (entity.description) lines.push(`  简介：${entity.description}`);
      if (entity.status)      lines.push(`  当前状态：${entity.status}`);

      if (cp.Tier) {
        const nt = Array.isArray(cp.Tier.NormalTier) ? cp.Tier.NormalTier[0] : (cp.Tier.NormalTier ?? '?');
        const bt = Array.isArray(cp.Tier.BurstTier)  ? cp.Tier.BurstTier[0]  : (cp.Tier.BurstTier  ?? '?');
        lines.push(`  战力：常态${nt}★ / 爆发${bt}★`);
      }
      if (cp.TacticsAndBehavior) lines.push(`  战术：${cp.TacticsAndBehavior}`);
      if (Array.isArray(cp.Abilities) && cp.Abilities.length) {
        lines.push(`  能力：${cp.Abilities.slice(0, 3).map(a => `${a.name}（${a.tier ?? '?'}★）`).join(' | ')}`);
      }
      if (Array.isArray(cp.Weaknesses) && cp.Weaknesses.length) {
        lines.push(`  弱点：${cp.Weaknesses.slice(0, 2).join(' / ')}`);
      }

      // PersonalityModel for NPC/Boss roleplay context
      const pm = entity.PersonalityModel;
      if (pm && (pm.SpeakingStyle || pm.RoleplayDirective)) {
        lines.push(`  人格：${pm.SpeakingStyle || ''}${pm.EmotionalBaseline ? ' | ' + pm.EmotionalBaseline : ''}`);
        if (pm.RoleplayDirective) lines.push(`  扮演：${pm.RoleplayDirective}`);
      }
    } else {
      // PowerSystem entry from Archives.<World>.PowerSystems
      const ps = entity;
      lines.push(`\n▸ **[力量体系] ${ps.name}**（${ps.category || '?'}）`);
      if (ps.typicalTierRange)  lines.push(`  典型星级：${ps.typicalTierRange} | 峰值：${ps.peakTierRange || '?'}`);
      if (ps.description)       lines.push(`  描述：${ps.description}`);
      if (ps.coreResource)      lines.push(`  核心资源：${ps.coreResource}`);
      if (ps.entryBarrier)      lines.push(`  进入门槛：${ps.entryBarrier}`);
      if (Array.isArray(ps.universalMechanics) && ps.universalMechanics.length) {
        lines.push(`  运作机制：${ps.universalMechanics.slice(0, 3).join(' / ')}`);
      }
      if (Array.isArray(ps.universalLimits) && ps.universalLimits.length) {
        lines.push(`  核心弱点：${ps.universalLimits.slice(0, 3).join(' / ')}`);
      }
    }
  }
  return lines.join('\n');
}

module.exports = { tokenize, retrieveRelevantLogs, retrieveFromStatData, formatRetrievedLogs, extractCombatData, formatCombatData };
