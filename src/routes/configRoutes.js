'use strict';
/**
 * Config Routes — API endpoints for application configuration.
 * GET/POST /api/config
 * POST /api/config/test
 * GET /api/models (model list proxy)
 */

const log = require('../core/logger');
const { testConnection } = require('../core/llmClient');

function registerRoutes(app, deps) {
  const { getConfig, updateConfig, buildLLMConfig } = deps;

  app.get('/api/config', (req, res) => {
    try {
      res.json(getConfig());
    } catch (e) {
      log.error('GET /api/config error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/config', (req, res) => {
    try {
      const next = updateConfig(req.body || {});
      log.info(`Config updated: model=${next.model || '?'} baseUrl=${next.baseUrl || '?'}`);
      res.json({ ok: true });
    } catch (e) {
      log.error('POST /api/config error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/config/test', async (req, res) => {
    try {
      const config    = getConfig();
      const llmConfig = buildLLMConfig(config);
      log.info(`Config test: model=${llmConfig.model} baseUrl=${llmConfig.baseUrl}`);
      const result = await testConnection(llmConfig);
      log.info(`Config test result: ok=${result.ok} response="${(result.response || result.error || '').slice(0, 80)}"`);
      res.json(result);
    } catch (e) {
      log.error('POST /api/config/test error', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Model list proxy — avoids browser CORS issues
  app.get('/api/models', async (req, res) => {
    let { baseUrl, apiKey } = req.query;
    baseUrl = (baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
    try {
      const url     = `${baseUrl}/v1/models`;
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey?.trim()) headers['Authorization'] = `Bearer ${apiKey.trim()}`;

      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      const text     = await response.text();
      let data;
      try { data = JSON.parse(text); }
      catch (_) { return res.status(502).json({ error: `Invalid JSON from upstream: ${text.slice(0, 120)}` }); }

      if (!response.ok) {
        return res.status(response.status).json({ error: data?.error?.message || data?.message || `HTTP ${response.status}` });
      }

      let raw = data.data || data.models || data;
      if (!Array.isArray(raw)) raw = [];
      const models = raw
        .map((m) => (typeof m === 'string' ? m : m.id || m.name || ''))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      res.json({ models });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerRoutes };
