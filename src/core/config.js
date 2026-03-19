'use strict';
/**
 * Config — centralized configuration management.
 * Handles: user config file (config.json), LLM config builders,
 * game asset loading (charCard + preset), and user persona helpers.
 */

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

// ─── User Config (config.json) ────────────────────────────────────────────────

function loadUserConfig(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch (_) { return {}; }
}

function saveUserConfig(filePath, config) {
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

function getConfig() {
  return loadUserConfig(CONFIG_PATH);
}

function updateConfig(updates) {
  const current = getConfig();
  const next    = { ...current, ...updates };
  saveUserConfig(CONFIG_PATH, next);
  return next;
}

// ─── LLM Config Builders ──────────────────────────────────────────────────────

function buildLLMConfig(userConfig) {
  return {
    apiKey:           userConfig.apiKey           || '',
    baseUrl:          userConfig.baseUrl          || 'https://api.openai.com',
    model:            userConfig.model            || 'gpt-4o',
    temperature:      userConfig.temperature      ?? 1.0,
    maxTokens:        userConfig.maxTokens        || 30000,
    topP:             userConfig.topP,
    frequencyPenalty: userConfig.frequencyPenalty,
    presencePenalty:  userConfig.presencePenalty,
    seed:             userConfig.seed,
    extraHeaders:     userConfig.extraHeaders,
    streaming:        userConfig.streaming,
  };
}

/**
 * Build a per-phase LLM config by overriding only the fields that are
 * explicitly set in opts (falsy values are ignored → inherit from base).
 * @param {object} base    - Result of buildLLMConfig(userConfig)
 * @param {object} opts    - { model, baseUrl, apiKey, maxTokens, temperature }
 */
function buildPhaseLLMConfig(base, opts = {}) {
  const out = { ...base };
  if (opts.model)                       out.model       = opts.model;
  if (opts.baseUrl)                     out.baseUrl     = opts.baseUrl;
  if (opts.apiKey)                      out.apiKey      = opts.apiKey;
  if (opts.maxTokens != null)           out.maxTokens   = opts.maxTokens;
  if (opts.temperature != null)         out.temperature = opts.temperature;
  return out;
}

/** Shop uses its own API settings; falls back to main config if shop fields are absent. */
function buildShopLLMConfig(userConfig) {
  return {
    apiKey:      userConfig.shopApiKey      || userConfig.apiKey   || '',
    baseUrl:     userConfig.shopBaseUrl     || userConfig.baseUrl  || 'https://api.openai.com',
    model:       userConfig.shopModel       || userConfig.model    || 'gpt-4o',
    temperature: userConfig.shopTemperature ?? userConfig.temperature ?? 1.0,
    maxTokens:   userConfig.shopMaxTokens   ?? userConfig.maxTokens  ?? 30000,
  };
}

// ─── Game Assets ──────────────────────────────────────────────────────────────

const { loadCharacterCard, loadPreset, loadPresetFromData, parseWorldBook } = require('./configLoader');
const { getBuiltinCharCard, getBuiltinPreset } = require('../content');

// Path to runtime overrides file (written by the preset/worldbook editor UI)
const OVERRIDES_PATH = path.join(__dirname, '..', '..', 'data', 'content-overrides.json');

// mtime cache so loadGameAssets() is cheap when nothing changed
let _assetsCache   = null;
let _assetsCacheAt = 0;   // mtimeMs of overrides file at last load

/**
 * Invalidate the asset cache (called by presetRoutes / worldRoutes after a save).
 */
function invalidateAssetsCache() {
  _assetsCache   = null;
  _assetsCacheAt = 0;
}

/**
 * Load game assets (charCard + preset), with mtime-based caching.
 * Priority order:
 *   1. content-overrides.json (written by the editor UI)
 *   2. External files from config.json  (legacy, being phased out)
 *   3. Built-in JS content  (default)
 */
function loadGameAssets(userConfig) {
  // Check overrides file mtime
  const overridesMtime = fs.existsSync(OVERRIDES_PATH)
    ? fs.statSync(OVERRIDES_PATH).mtimeMs
    : 0;

  if (_assetsCache && overridesMtime === _assetsCacheAt) {
    return _assetsCache;
  }

  // Load overrides if the file exists
  let overrides = {};
  if (overridesMtime > 0) {
    try {
      overrides = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf-8'));
    } catch (_) {
      overrides = {};
    }
  }

  // ── charCard ────────────────────────────────────────────────────────────────
  let charCard;
  if (overrides.worldbook?.entries) {
    // Editor saved worldbook → merge with built-in charCard shell
    const base = getBuiltinCharCard();
    // parseWorldBook expects { entries: [...] } book shape; filter enabled only
    const parsedWB = parseWorldBook({ entries: overrides.worldbook.entries });
    charCard = { ...base, worldBook: parsedWB };
  } else if (userConfig.charCardPath && fs.existsSync(userConfig.charCardPath)) {
    charCard = loadCharacterCard(userConfig.charCardPath);
  } else {
    charCard = getBuiltinCharCard();
  }

  // ── preset ──────────────────────────────────────────────────────────────────
  let preset;
  if (overrides.preset) {
    preset = loadPresetFromData(overrides.preset);
  } else if (userConfig.presetPath && fs.existsSync(userConfig.presetPath)) {
    preset = loadPreset(userConfig.presetPath);
  } else {
    preset = getBuiltinPreset();
  }

  _assetsCache   = { charCard, preset };
  _assetsCacheAt = overridesMtime;
  return _assetsCache;
}

// ─── User Persona ─────────────────────────────────────────────────────────────

function getUserPersona(userConfig) {
  return {
    name:        userConfig.userName        || 'User',
    alignment:   userConfig.userAlignment   || '',
    traits:      userConfig.userTraits      || '',
    description: userConfig.userDescription || '',
  };
}

/** Override persona.name with the session's active character name if set. */
function applySessionCharName(userPersona, session) {
  const name = session?.statData?.CharacterSheet?.UserPanel?.Name;
  if (name) userPersona.name = typeof name === 'string' ? name : (Array.isArray(name) ? name[0] : name);
}

/** Sync session.charProfile from current statData.CharacterSheet.UserPanel. */
function syncSessionCharProfile(session) {
  try {
    const up = session.statData?.CharacterSheet?.UserPanel;
    if (!up) return;
    const gv = (v) => (Array.isArray(v) ? v[0] : v) || '';
    session.charProfile = {
      name:       gv(up.Name),
      gender:     gv(up.Appearance?.Gender),
      age:        gv(up.Appearance?.Age),
      height:     gv(up.Appearance?.Height),
      weight:     gv(up.Appearance?.Weight),
      appearance: gv(up.Appearance?.Visuals),
      clothing:   gv(up.Appearance?.Clothing),
      alignment:  up.Personality?.Alignment || '',
      traits:     Array.isArray(up.Personality?.Traits)
        ? up.Personality.Traits.filter(t => t && !String(t).startsWith('$'))
        : [],
    };
  } catch (_) {}
}

module.exports = {
  CONFIG_PATH,
  OVERRIDES_PATH,
  getConfig,
  updateConfig,
  loadUserConfig,
  saveUserConfig,
  buildLLMConfig,
  buildPhaseLLMConfig,
  buildShopLLMConfig,
  loadGameAssets,
  invalidateAssetsCache,
  getUserPersona,
  applySessionCharName,
  syncSessionCharProfile,
};
