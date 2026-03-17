'use strict';
/**
 * NPC Engine — parses LLM-generated NPC/monster stat sheets and stores them
 * in Multiverse.Archives.<World>.NPCs[].
 *
 * Flow:
 *   gameLoop Phase 3 → <SystemSpawn> tag → parseNarrativeSpawnTags()
 *   → processNarrativeSpawnsAsync() → npcPrompt.buildMessages() → LLM
 *   → npcEngine.parseSpawnResponse() → npcEngine.storeNPC()
 */

// ─── Response Parser ──────────────────────────────────────────────────────────

/**
 * Parse the LLM response into an NPC entry object.
 * Strips <think> blocks, extracts ```json block or bare object.
 */
function parseSpawnResponse(text) {
  // Strip thinking blocks
  const stripped = text.replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '').trim();

  // Try ```json ... ``` block first
  const jsonBlock = stripped.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonBlock) {
    return JSON.parse(jsonBlock[1]);
  }
  // Fallback: find outermost { ... } containing "CombatProfile"
  const raw = stripped.match(/\{[\s\S]*"CombatProfile"[\s\S]*\}/);
  if (raw) {
    return JSON.parse(raw[0]);
  }
  throw new Error('NPC生成响应中未找到有效 JSON 数据');
}

// ─── Storage ──────────────────────────────────────────────────────────────────

/**
 * Store a generated NPC/monster entry in the current world's NPCs array.
 *
 * @param {object} statData   - Mutable session statData
 * @param {object} parsed     - Parsed LLM output (npcEntry shape)
 * @param {object} spawnTag   - Original SystemSpawn tag data
 * @returns {object} The stored NPC entry (with spawnId and metadata)
 */
function storeNPC(statData, parsed, spawnTag) {
  const curWorld = Array.isArray(statData?.Multiverse?.CurrentWorldName)
    ? statData.Multiverse.CurrentWorldName[0]
    : (statData?.Multiverse?.CurrentWorldName || null);

  const worldKey = spawnTag.sourceWorld || curWorld || 'Unknown';

  if (!statData.Multiverse) statData.Multiverse = {};
  if (!statData.Multiverse.Archives) statData.Multiverse.Archives = {};
  if (!statData.Multiverse.Archives[worldKey]) statData.Multiverse.Archives[worldKey] = {};
  if (!Array.isArray(statData.Multiverse.Archives[worldKey].NPCs)) {
    statData.Multiverse.Archives[worldKey].NPCs = [];
  }

  const entry = {
    spawnId:    `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name:       parsed.name        || spawnTag.name || '未知实体',
    type:       parsed.type        || spawnTag.type || 'Monster',
    hostile:    parsed.hostile     ?? spawnTag.hostile ?? true,
    tier:       parsed.tier        ?? 0,
    description: parsed.description || spawnTag.description || '',
    status:     'encountered',   // alive | dead | fled | escaped
    CombatProfile:   parsed.CombatProfile   || null,
    PersonalityModel: parsed.PersonalityModel || null,
    encounter: {
      world:    worldKey,
      location: spawnTag.location || null,
    },
    generatedAt: new Date().toISOString(),
  };

  // Check for duplicate by name (update status rather than duplicate)
  const existing = statData.Multiverse.Archives[worldKey].NPCs
    .find(n => n.name === entry.name);
  if (existing) {
    // Update combat profile if richer data available, preserve status/history
    if (entry.CombatProfile) existing.CombatProfile = entry.CombatProfile;
    if (entry.PersonalityModel) existing.PersonalityModel = entry.PersonalityModel;
    existing.lastEncountered = new Date().toISOString();
    return existing;
  }

  // Cap at 50 NPCs per world (keep most recent)
  statData.Multiverse.Archives[worldKey].NPCs.unshift(entry);
  if (statData.Multiverse.Archives[worldKey].NPCs.length > 50) {
    statData.Multiverse.Archives[worldKey].NPCs =
      statData.Multiverse.Archives[worldKey].NPCs.slice(0, 50);
  }

  return entry;
}

/**
 * Get all NPCs for the current world (for Phase 2 combat data injection).
 *
 * @param {object} statData
 * @param {string} worldKey
 * @returns {object[]}
 */
function getWorldNPCs(statData, worldKey) {
  return statData?.Multiverse?.Archives?.[worldKey]?.NPCs || [];
}

module.exports = { parseSpawnResponse, storeNPC, getWorldNPCs };
