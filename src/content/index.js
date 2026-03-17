'use strict';
/**
 * Built-in Content — central export for all built-in game content.
 *
 * Returns structured objects compatible with configLoader.js output format,
 * allowing seamless replacement of external SillyTavern JSON files.
 *
 * Usage:
 *   const { getBuiltinCharCard, getBuiltinPreset } = require('./content');
 *   const charCard = getBuiltinCharCard();  // Same shape as loadCharacterCard()
 *   const preset   = getBuiltinPreset();    // Same shape as loadPreset()
 */

const CHAR_CARD                    = require('./charCard');
const { PROMPTS, PRESET_SETTINGS } = require('./presets');
const { ALL_RULES }                = require('./regex');
const { ENTRIES_RAW }              = require('./worldbook');

// ─── WB ↔ Preset merge helpers ────────────────────────────────────────────────

/**
 * Convert one raw WB entry (ST character_book.entries format) into a
 * prompt-like object that the preset editor can display and edit.
 * The extra `_wb` / `_wbData` fields are preserved through save/load.
 */
function wbEntry2Prompt(e) {
  return {
    identifier:         `wb_${e.id}`,
    name:               e.comment || `[WB #${e.id}]`,
    content:            e.content || '',
    role:               'system',
    system_prompt:      false,
    marker:             false,
    injection_position: 0,
    injection_depth:    e.extensions?.depth          ?? 4,
    injection_order:    e.insertion_order            ?? 100,
    forbid_overrides:   false,
    enabled:            e.enabled !== false,
    // ── WB-specific payload (round-trips through the editor) ───────────────
    _wb: true,
    _wbData: {
      id:              e.id,
      keys:            e.keys            || [],
      secondary_keys:  e.secondary_keys  || [],
      position:        e.position        || 'before_char',
      insertion_order: e.insertion_order ?? 100,
      constant:        e.constant        !== false,
      selective:       e.selective       !== false,
      use_regex:       e.use_regex       !== false,
      extensions:      e.extensions      || {},
      // Explicit phase assignment ([1], [3], [4], [1,3], etc.) — null means auto-derive
      _phases:         Array.isArray(e._phases) ? e._phases : null,
    },
  };
}

/**
 * Merge a flat array of raw WB entries into an existing ST-JSON preset object.
 * Inserts WB entries at their logical positions:
 *   extPosition 0  → right after the `worldInfoBefore` marker
 *   extPosition 1  → right after the `worldInfoAfter`  marker
 *   extPosition 4, depth 0 → right before the `nsfw` marker
 *
 * Any existing `wb_*` entries already present in stJson are first stripped so
 * this function is idempotent (safe to call repeatedly).
 *
 * @param {object}   stJson      - SillyTavern-format preset JSON
 * @param {Array}    wbRaw       - Raw WB entries array (character_book.entries)
 * @returns {object} new ST-JSON with WB entries interleaved
 */
function mergeWbIntoPreset(stJson, wbRaw) {
  if (!stJson || !Array.isArray(wbRaw)) return stJson;

  // Strip any existing WB placeholders so we always rebuild from source
  const basePrompts = (stJson.prompts || []).filter(p => !p._wb);
  const baseOrder   = ((stJson.prompt_order?.[0]?.order) || [])
    .filter(e => !String(e.identifier).startsWith('wb_'));

  // Bucket WB entries by injection position
  const wbPos0   = wbRaw
    .filter(e => (e.extensions?.position ?? 0) === 0)
    .sort((a, b) => (a.insertion_order ?? 100) - (b.insertion_order ?? 100));
  const wbPos1   = wbRaw
    .filter(e => (e.extensions?.position ?? 0) === 1)
    .sort((a, b) => (a.insertion_order ?? 100) - (b.insertion_order ?? 100));
  const wbPos4d0 = wbRaw
    .filter(e => (e.extensions?.position ?? 0) === 4 && (e.extensions?.depth ?? 4) === 0)
    .sort((a, b) => (a.insertion_order ?? 100) - (b.insertion_order ?? 100));

  const mergedPrompts = [];
  const mergedOrder   = [];

  // Process prompt_order as the source of truth for order
  for (const orderEntry of baseOrder) {
    const id = orderEntry.identifier;

    // depth:0 (pos:4) WB entries must appear BEFORE the nsfw pivot
    if (id === 'nsfw') {
      for (const e of wbPos4d0) {
        const wp = wbEntry2Prompt(e);
        if (!mergedPrompts.find(p => p.identifier === wp.identifier)) {
          mergedPrompts.push(wp);
        }
        mergedOrder.push({ identifier: wp.identifier, enabled: wp.enabled });
      }
    }

    // Add the real prompt entry
    const promptEntry = basePrompts.find(p => p.identifier === id);
    if (promptEntry) {
      if (!mergedPrompts.find(p => p.identifier === id)) mergedPrompts.push(promptEntry);
    }
    mergedOrder.push(orderEntry);

    // pos:0 WB entries go right after worldInfoBefore marker
    if (id === 'worldInfoBefore') {
      for (const e of wbPos0) {
        const wp = wbEntry2Prompt(e);
        if (!mergedPrompts.find(p => p.identifier === wp.identifier)) {
          mergedPrompts.push(wp);
        }
        mergedOrder.push({ identifier: wp.identifier, enabled: wp.enabled });
      }
    }

    // pos:1 WB entries go right after worldInfoAfter marker
    if (id === 'worldInfoAfter') {
      for (const e of wbPos1) {
        const wp = wbEntry2Prompt(e);
        if (!mergedPrompts.find(p => p.identifier === wp.identifier)) {
          mergedPrompts.push(wp);
        }
        mergedOrder.push({ identifier: wp.identifier, enabled: wp.enabled });
      }
    }
  }

  // Prompts that appear in prompts[] but not in prompt_order (edge case)
  for (const p of basePrompts) {
    if (!mergedPrompts.find(mp => mp.identifier === p.identifier)) {
      mergedPrompts.push(p);
    }
  }

  return {
    ...stJson,
    prompts:      mergedPrompts,
    prompt_order: [{
      ...(stJson.prompt_order?.[0] || { character_id: 100001 }),
      order: mergedOrder,
    }],
  };
}

// ─── Game-Engine Format (used by promptBuilder) ───────────────────────────────

/**
 * Get built-in character card (same format as configLoader.loadCharacterCard()).
 */
function getBuiltinCharCard() {
  return CHAR_CARD;
}

/**
 * Get built-in preset (same format as configLoader.loadPreset()).
 */
function getBuiltinPreset() {
  return {
    prompts:          PROMPTS,
    regexRules:       ALL_RULES,
    chatSquash:       {},
    temperature:      PRESET_SETTINGS.temperature,
    maxTokens:        PRESET_SETTINGS.maxTokens,
    model:            '',
    topP:             undefined,
    topK:             undefined,
    frequencyPenalty: undefined,
    presencePenalty:  undefined,
    seed:             undefined,
    continuePostfix:  PRESET_SETTINGS.continuePostfix,
    showThoughts:     PRESET_SETTINGS.showThoughts,
    assistantPrefill: PRESET_SETTINGS.assistantPrefill,
  };
}

// ─── ST JSON Format (used by the preset/worldbook editor UI) ─────────────────

/**
 * Get raw worldbook entries in SillyTavern format (including disabled entries).
 * Used by the worldbook editor API route.
 */
function getBuiltinWorldbookRaw() {
  return ENTRIES_RAW;
}

/**
 * Convert built-in preset (game-engine format) to SillyTavern ST JSON format.
 * Returns ONLY the preset prompts — no worldbook entries.
 * Use buildPresetSTJson() (below) to get the full merged view with WB.
 */
function buildPresetSTJsonBase() {
  const preset  = getBuiltinPreset();
  const prompts = preset.prompts;

  return {
    prompts: prompts.map(p => ({
      identifier:         p.identifier,
      name:               p.name,
      content:            p.content,
      role:               p.role,
      system_prompt:      p.isMainSystemPrompt,
      marker:             p.marker,
      injection_position: p.injectionPosition,
      injection_depth:    p.injectionDepth,
      injection_order:    p.injectionOrder,
      forbid_overrides:   p.forbidOverrides,
      enabled:            p.enabled,
    })),
    prompt_order: [{
      character_id: 100001,
      order: prompts.map(p => ({ identifier: p.identifier, enabled: p.enabled })),
    }],
    extensions: {
      SPreset: {
        RegexBinding: { regexes: preset.regexRules || [] },
      },
    },
    temperature:       preset.temperature,
    max_new_tokens:    preset.maxTokens,
    show_thoughts:     preset.showThoughts,
    assistant_prefill: preset.assistantPrefill,
    continue_postfix:  preset.continuePostfix,
  };
}

/**
 * Build the full merged ST JSON (preset + worldbook entries interleaved).
 * Used as the built-in fallback when no overrides exist.
 * The preset editor (preset.html) receives this format on GET /api/preset/data.
 */
function buildPresetSTJson() {
  return mergeWbIntoPreset(buildPresetSTJsonBase(), ENTRIES_RAW);
}

module.exports = {
  getBuiltinCharCard,
  getBuiltinPreset,
  getBuiltinWorldbookRaw,
  buildPresetSTJson,
  buildPresetSTJsonBase,
  mergeWbIntoPreset,
};
