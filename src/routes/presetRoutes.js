'use strict';
/**
 * Preset Routes — unified preset + worldbook editor API.
 *
 * GET /api/preset/data
 *   Returns a merged ST JSON view:
 *     preset (overrides or built-in) + worldbook entries interleaved.
 *   The worldbook entries appear as special prompts with `_wb: true`.
 *
 * POST /api/preset/data
 *   Accepts the unified view from the editor.
 *   Splits it back into two stores:
 *     overrides.preset       ← preset prompts only (no _wb entries)
 *     overrides.worldbook.entries ← extracted WB entries in raw ST format
 */

const fs   = require('fs');
const path = require('path');
const log  = require('../core/logger');

function registerRoutes(app, deps) {
  const {
    OVERRIDES_PATH,
    invalidateAssetsCache,
    buildPresetSTJsonBase,
    mergeWbIntoPreset,
    getBuiltinWorldbookRaw,
  } = deps;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function readOverrides() {
    if (!fs.existsSync(OVERRIDES_PATH)) return {};
    try { return JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8')); }
    catch (_) { return {}; }
  }

  function writeOverrides(overrides) {
    const dir = path.dirname(OVERRIDES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2), 'utf-8');
  }

  // ── GET /api/preset/data ───────────────────────────────────────────────────

  app.get('/api/preset/data', (req, res) => {
    try {
      const overrides = readOverrides();

      // Base preset: saved override or built-in (without WB entries)
      let basePreset, presetSource;
      if (overrides.preset && typeof overrides.preset === 'object') {
        basePreset   = overrides.preset;
        presetSource = '(overrides)';
      } else {
        basePreset   = buildPresetSTJsonBase();
        presetSource = '(built-in)';
      }

      // WB entries: saved override or built-in
      const wbEntries = overrides.worldbook?.entries || getBuiltinWorldbookRaw();

      // Return merged view (preset + WB interleaved)
      const merged = mergeWbIntoPreset(basePreset, wbEntries);
      res.json({ path: presetSource, data: merged });
    } catch (e) {
      log.error('GET /api/preset/data error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/preset/data ──────────────────────────────────────────────────

  app.post('/api/preset/data', (req, res) => {
    try {
      const { data } = req.body;
      if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: 'Missing or invalid data field' });
      }

      // ── Extract WB entries from unified data ───────────────────────────────
      const wbPrompts = (data.prompts || []).filter(p => p._wb === true);

      const wbEntries = wbPrompts.map(p => {
        const wb = p._wbData || {};
        const entry = {
          id:              wb.id,
          keys:            wb.keys            || [],
          secondary_keys:  wb.secondary_keys  || [],
          comment:         p.name             || '',
          content:         p.content          || '',
          constant:        wb.constant        !== false,
          selective:       wb.selective       !== false,
          insertion_order: wb.insertion_order ?? 100,
          enabled:         p.enabled          !== false,
          position:        wb.position        || 'before_char',
          use_regex:       wb.use_regex       !== false,
          extensions:      wb.extensions      || {},
        };
        // Preserve explicit phase assignment — null means auto-derive in promptBuilder
        if (Array.isArray(wb._phases) && wb._phases.length > 0) {
          entry._phases = wb._phases;
        }
        return entry;
      });

      // ── Strip WB entries from the preset ──────────────────────────────────
      const cleanedData = {
        ...data,
        prompts: (data.prompts || []).filter(p => !p._wb),
        prompt_order: [{
          ...(data.prompt_order?.[0] || { character_id: 100001 }),
          order: (data.prompt_order?.[0]?.order || [])
            .filter(e => !String(e.identifier).startsWith('wb_')),
        }],
      };

      // ── Persist ───────────────────────────────────────────────────────────
      const overrides = readOverrides();
      overrides.preset = cleanedData;

      if (wbEntries.length > 0) {
        if (!overrides.worldbook) overrides.worldbook = {};
        overrides.worldbook.entries = wbEntries;
      }

      writeOverrides(overrides);
      invalidateAssetsCache();

      log.info(`Preset saved (${cleanedData.prompts?.length ?? 0} prompts, ${wbEntries.length} WB entries) → content-overrides.json`);
      res.json({ ok: true });
    } catch (e) {
      log.error('POST /api/preset/data error', e);
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerRoutes };
