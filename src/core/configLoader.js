'use strict';
/**
 * Config Loader — parses SillyTavern character card JSON and preset JSON
 * into structured objects used by the rest of the system.
 * Used when external files are configured; otherwise built-in content is used.
 */

const fs = require('fs');

// ─── Character Card ───────────────────────────────────────────────────────────

function loadCharacterCard(filePath) {
  const raw  = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const data = raw.data || raw;
  const ext  = data.extensions || {};

  const charBook = data.character_book || ext.character_book || null;
  const worldBook = charBook ? parseWorldBook(charBook) : [];

  return {
    name:               data.name            || raw.name            || '',
    description:        data.description     || '',
    personality:        data.personality     || '',
    scenario:           data.scenario        || '',
    systemPrompt:       data.system_prompt   || '',
    firstMessage:       data.first_mes       || raw.first_mes       || '',
    alternateGreetings: data.alternate_greetings || raw.alternate_greetings || [],
    worldBook,
    localRegex:  ext.regex_scripts || [],
    worldName:   ext.world         || '',
    depthPrompt: ext.depth_prompt  || null,
  };
}

function parseWorldBook(book) {
  if (!book || !Array.isArray(book.entries)) return [];
  return book.entries
    .map((e) => ({
      id:             e.id,
      comment:        e.comment || '',
      keys:           e.key    || [],
      content:        e.content || '',
      enabled:        e.enabled !== false,
      constant:       !!e.constant,
      position:       e.position || 'before_char',
      insertionOrder: e.insertion_order ?? 100,
      extPosition:    e.extensions?.position    ?? 0,
      depth:          e.extensions?.depth       ?? 4,
      role:           e.extensions?.role        ?? 0,
      probability:    e.extensions?.probability ?? 100,
      sticky:         e.extensions?.sticky      ?? 0,
      selective:      !!e.selective,
      selectiveLogic: e.selective_logic ?? 0,
      secondaryKeys:  e.secondary_keys  || [],
      // Explicit phase assignment saved by the preset editor (null = auto-derive)
      phases:         Array.isArray(e._phases) ? e._phases : null,
    }))
    .filter((e) => e.enabled);
}

// ─── Preset ───────────────────────────────────────────────────────────────────

const SYSTEM_MARKERS = new Set([
  'main', 'worldInfoBefore', 'worldInfoAfter',
  'charDescription', 'charPersonality', 'scenario',
  'personaDescription', 'chatHistory',
  'dialogueExamples', 'enhanceDefinitions', 'nsfw',
]);

/**
 * Parse a preset from a raw JSON object (already parsed, not a file path).
 * Used when loading from content-overrides.json.
 */
function loadPresetFromData(raw) {
  return parsePresetRaw(raw);
}

function loadPreset(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return parsePresetRaw(raw);
}

function parsePresetRaw(raw) {
  const spreset = raw.extensions?.SPreset || {};

  const orderSlot = (raw.prompt_order || [])[0];
  const orderMap  = {};
  if (orderSlot && Array.isArray(orderSlot.order)) {
    orderSlot.order.forEach((e, i) => {
      orderMap[e.identifier] = { enabled: e.enabled !== false, orderIndex: i };
    });
  }

  const promptById = {};
  (raw.prompts || []).forEach(p => { if (p.identifier) promptById[p.identifier] = p; });

  let prompts;
  if (orderSlot && Array.isArray(orderSlot.order)) {
    prompts = orderSlot.order
      .map((orderEntry) => {
        const p = promptById[orderEntry.identifier];
        if (!p) {
          if (SYSTEM_MARKERS.has(orderEntry.identifier) && orderEntry.enabled !== false) {
            return {
              identifier:        orderEntry.identifier,
              name:              orderEntry.identifier,
              enabled:           true,
              content:           '',
              role:              'system',
              isMainSystemPrompt: false,
              marker:            true,
              injectionPosition: 0,
              injectionDepth:    4,
              injectionOrder:    0,
              forbidOverrides:   false,
            };
          }
          return null;
        }
        return {
          identifier:          p.identifier || '',
          name:                p.name       || '',
          enabled:             orderEntry.enabled !== false,
          content:             p.content    || '',
          role:                p.role       || 'system',
          isMainSystemPrompt:  p.system_prompt === true,
          marker:              !!p.marker,
          injectionPosition:   p.injection_position ?? 0,
          injectionDepth:      p.injection_depth    ?? 4,
          injectionOrder:      p.injection_order    ?? 100,
          forbidOverrides:     !!p.forbid_overrides,
        };
      })
      .filter(Boolean);
  } else {
    prompts = (raw.prompts || []).map((p) => ({
      identifier:         p.identifier || '',
      name:               p.name       || '',
      enabled:            p.enabled !== false,
      content:            p.content    || '',
      role:               p.role       || 'system',
      isMainSystemPrompt: p.system_prompt === true,
      marker:             !!p.marker,
      injectionPosition:  p.injection_position ?? 0,
      injectionDepth:     p.injection_depth    ?? 4,
      injectionOrder:     p.injection_order    ?? 100,
      forbidOverrides:    !!p.forbid_overrides,
    }));
  }

  return {
    prompts,
    regexRules:      spreset.RegexBinding?.regexes || [],
    chatSquash:      spreset.ChatSquash            || {},
    temperature:     raw.temperature,
    maxTokens:       raw.max_new_tokens || raw.max_tokens || 2048,
    model:           raw.chat_completion_source   || '',
    topP:            raw.top_p,
    topK:            raw.top_k,
    frequencyPenalty: raw.frequency_penalty,
    presencePenalty:  raw.presence_penalty,
    seed:             raw.seed,
    continuePostfix:  raw.continue_postfix || '',
    showThoughts:     raw.show_thoughts !== false,
    assistantPrefill: raw.assistant_prefill || '',
  };
}

module.exports = { loadCharacterCard, parseWorldBook, loadPreset, loadPresetFromData };
