'use strict';
/**
 * AI-VN 无限武库 — Server Entry Point
 *
 * This file is intentionally minimal. All business logic lives in:
 *   src/core/      — config, logger, session, llmClient, sessionLock
 *   src/content/   — built-in worldbook, presets, regex
 *   src/engine/    — varEngine, regexPipeline, promptBuilder, gameLoop
 *   src/features/  — shop, gacha, character, world
 *   src/routes/    — all Express route handlers
 */

const express = require('express');
const cors    = require('cors');
const path    = require('path');

// ─── Core Modules ─────────────────────────────────────────────────────────────

const log          = require('./src/core/logger');
const sessionMgr   = require('./src/core/session');
const { withSessionLock, hasLock } = require('./src/core/sessionLock');
const {
  CONFIG_PATH, OVERRIDES_PATH,
  getConfig, updateConfig,
  loadUserConfig, saveUserConfig,
  buildLLMConfig, buildShopLLMConfig,
  loadGameAssets, invalidateAssetsCache,
  getUserPersona, applySessionCharName, syncSessionCharProfile,
} = require('./src/core/config');

const { buildPresetSTJson, buildPresetSTJsonBase, mergeWbIntoPreset, getBuiltinWorldbookRaw } = require('./src/content');

// ─── Feature Seeding ──────────────────────────────────────────────────────────

const shopStore          = require('./src/features/shop/shopStore');
const worldArchiveStore  = require('./src/features/world/worldArchiveStore');

function seedBaseAnchors() {
  const existing = shopStore.loadItems().filter(i => i.baseAnchor);
  if (existing.length >= 6) return;

  const { TIER_CONFIG } = worldArchiveStore;
  for (const [tierRange, cfg] of Object.entries(TIER_CONFIG)) {
    if (existing.find(i => i.tierRange === tierRange)) continue;
    const medalDesc = cfg.requiredMedals.length
      ? cfg.requiredMedals.map(m => `${m.count}枚${m.stars}★徽章`).join(' + ')
      : '无徽章需求';
    shopStore.addItem({
      name:             `随机世界锚点 · ${cfg.label}`,
      type:             'WorldTraverse',
      tier:             cfg.tierMax,
      pricePoints:      cfg.pricePoints,
      requiredMedals:   cfg.requiredMedals,
      description:      `抽取一个 ${cfg.label}（Tier ${cfg.tierMin}-${cfg.tierMax === 99 ? '14+' : cfg.tierMax}★）的随机世界坐标。消耗 ${cfg.pricePoints.toLocaleString()} 积分，需要 ${medalDesc}。兑换后从已储备的世界档案库中随机抽取。`,
      systemEvaluation: `基础穿越锚点·${cfg.label}，按《无限武库》卷一1.6.1定价标准定价。`,
      effects:          {},
      sourceDescription: `Tier ${cfg.tierMin}-${cfg.tierMax === 99 ? '14+' : cfg.tierMax}`,
      baseAnchor:       true,
      tierRange,
      system:           true,
    });
  }
}

// ─── Express App ──────────────────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Request logger middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (!req.path.startsWith('/api/')) return;
    log.req(req.method, req.path, res.statusCode, Date.now() - start);
  });
  next();
});

// ─── Register Routes ──────────────────────────────────────────────────────────

const { registerAllRoutes } = require('./src/routes');

// Dependency injection object shared across all route modules
const routeDeps = {
  sessionMgr,
  withSessionLock,
  hasLock,
  getConfig,
  updateConfig,
  loadUserConfig,
  saveUserConfig,
  buildLLMConfig,
  buildShopLLMConfig,
  loadGameAssets,
  invalidateAssetsCache,
  getUserPersona,
  applySessionCharName,
  syncSessionCharProfile,
  CONFIG_PATH,
  OVERRIDES_PATH,
  buildPresetSTJson,
  buildPresetSTJsonBase,
  mergeWbIntoPreset,
  getBuiltinWorldbookRaw,
};

registerAllRoutes(app, routeDeps);

// ─── SPA Fallback Routes ──────────────────────────────────────────────────────

app.get('/character', (req, res) => res.sendFile(path.join(__dirname, 'public', 'character.html')));
app.get('/shop',      (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop.html')));
app.get('/preset',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'preset.html')));
app.get('/settings',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html')));
// Worldbook editor removed — entries are now managed in the unified preset editor (/preset).
app.get('*',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Global Error Handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  log.error(`Unhandled Express error [${req.method} ${req.path}]`, err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ─── Startup ──────────────────────────────────────────────────────────────────

sessionMgr.loadAllSessions();
seedBaseAnchors();

app.listen(PORT, () => {
  log.info(`Server started on http://localhost:${PORT}`);
  log.info(`Workspace: ${__dirname}`);

  const config = getConfig();
  if (!config.charCardPath) {
    log.info('No external character card configured — using built-in content.');
  } else {
    log.info(`Character card: ${config.charCardPath}`);
    log.info(`Preset: ${config.presetPath || '(not set, using built-in)'}`);
  }
});
