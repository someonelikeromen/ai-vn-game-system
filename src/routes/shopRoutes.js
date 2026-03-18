'use strict';
/**
 * Shop Routes — item generation, redemption, and management.
 * GET /api/shop/items
 * DELETE /api/shop/items/:id
 * POST /api/shop/generate (SSE)
 * POST /api/shop/redeem
 * GET/POST /api/shop/config
 * GET /api/shop/models
 * POST /api/shop/test
 */

const log        = require('../core/logger');
const { testConnection } = require('../core/llmClient');
const { createCompletion } = require('../core/llmClient');
const shopStore  = require('../features/shop/shopStore');
const shopEngine = require('../features/shop/shopEngine');
const shopPrompt = require('../features/shop/shopPrompt');
const { buildStatSnapshot } = require('../engine/varEngine');

// ─── Shop helpers ─────────────────────────────────────────────────────────────

function shopGv(obj, key) {
  if (!obj) return '';
  const v = obj[key];
  return Array.isArray(v) ? String(v[0] ?? '') : String(v ?? '');
}

function buildCharStateForRedeem(statData, mode) {
  const cs = statData?.CharacterSheet;
  if (!cs) return null;
  const attrs = cs?.CoreSystem?.Attributes || {};
  const tier  = cs?.CoreSystem?.Tier;
  const snap  = {
    normalTier: Array.isArray(tier?.NormalTier) ? tier.NormalTier[0] : (tier?.NormalTier ?? '?'),
    burstTier:  Array.isArray(tier?.BurstTier)  ? tier.BurstTier[0]  : (tier?.BurstTier  ?? '?'),
    attributes: Object.fromEntries(
      Object.entries(attrs)
        .filter(([k]) => !k.startsWith('$'))
        .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])
    ),
  };
  if (mode === 'full') {
    const lo = cs?.Loadout || {};
    snap.powerSources      = (lo.PowerSources      || []).map(p => shopGv(p, 'Name')).filter(Boolean);
    snap.passiveAbilities  = (lo.PassiveAbilities  || []).map(a => shopGv(a, 'Name')).filter(Boolean);
    snap.techniques        = (lo.ApplicationTechniques || []).map(t => shopGv(t, 'Name')).filter(Boolean);
    snap.inventory         = (lo.Inventory?.Equipped || []).map(i => shopGv(i, 'ItemName') || shopGv(i, 'Name')).filter(Boolean);
  }
  return snap;
}

function buildShopPrefillText(item, statData, charStateMode) {
  const tierLabel = item.tier != null ? `${item.tier}星` : '';
  const typeMap   = {
    PassiveAbility: '被动能力', PowerSource: '基盘能力',
    ApplicationTechnique: '应用技巧', Inventory: '物品',
    Knowledge: '知识', WorldTraverse: '世界锚点',
    Companion: '同伴', Mech: '机体', WorldReturn: '回归主世界',
  };
  const typeLabel = typeMap[item.type] || item.type || '';
  let text = `【系统】${typeLabel}【${item.name}】（${tierLabel}）已兑换并完成内化。`;

  if (charStateMode === 'off' || !statData) return text;

  const cs  = statData?.CharacterSheet;
  const pts = cs?.Resources?.Points;
  text += `\n剩余积分：${typeof pts === 'number' ? pts.toLocaleString() : (pts ?? '?')}`;

  const snap = buildCharStateForRedeem(statData, charStateMode);
  if (!snap) return text;

  text += `\n\n[兑换后角色状态]\n当前星级：常态 ${snap.normalTier}★`;
  if (snap.burstTier !== snap.normalTier) text += ` / 爆发 ${snap.burstTier}★`;

  const attrStr = Object.entries(snap.attributes || {}).map(([k, v]) => `${k}:${v}`).join(' | ');
  if (attrStr) text += `\n属性：${attrStr}`;

  if (charStateMode === 'full') {
    if (snap.powerSources?.length)     text += `\n基盘能力（${snap.powerSources.length}）：${snap.powerSources.join('、')}`;
    if (snap.passiveAbilities?.length) text += `\n被动能力（${snap.passiveAbilities.length}）：${snap.passiveAbilities.join('、')}`;
    if (snap.techniques?.length)       text += `\n应用技法（${snap.techniques.length}）：${snap.techniques.join('、')}`;
    if (snap.inventory?.length)        text += `\n装备物品（${snap.inventory.length}）：${snap.inventory.join('、')}`;
  }
  return text;
}

// ─── Route Registration ───────────────────────────────────────────────────────

function registerRoutes(app, deps) {
  const { sessionMgr, getConfig, buildShopLLMConfig, getUserPersona, applySessionCharName, saveUserConfig, CONFIG_PATH } = deps;

  // GET /api/shop/config
  app.get('/api/shop/config', (req, res) => {
    try {
      const cfg = getConfig();
      res.json({
        shopBaseUrl:          cfg.shopBaseUrl          || '',
        shopApiKey:           cfg.shopApiKey           || '',
        shopModel:            cfg.shopModel            || '',
        shopTemperature:      cfg.shopTemperature      ?? '',
        shopMaxTokens:        cfg.shopMaxTokens        ?? '',
        shopCharStateOnRedeem: cfg.shopCharStateOnRedeem || 'off',
        effectiveBaseUrl:   cfg.shopBaseUrl  || cfg.baseUrl || 'https://api.openai.com',
        effectiveModel:     cfg.shopModel    || cfg.model   || 'gpt-4o',
        effectiveMaxTokens: cfg.shopMaxTokens ?? cfg.maxTokens ?? 30000,
        hasShopKey: !!(cfg.shopApiKey),
        hasMainKey:  !!(cfg.apiKey),
      });
    } catch (e) {
      log.error('GET /api/shop/config error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/shop/config
  app.post('/api/shop/config', (req, res) => {
    try {
      const cfg = getConfig();
      const { shopBaseUrl, shopApiKey, shopModel, shopTemperature, shopMaxTokens, shopCharStateOnRedeem } = req.body || {};
      if (shopBaseUrl    !== undefined) cfg.shopBaseUrl    = shopBaseUrl    || undefined;
      if (shopModel      !== undefined) cfg.shopModel      = shopModel      || undefined;
      if (shopTemperature !== undefined) cfg.shopTemperature = shopTemperature !== '' ? Number(shopTemperature) : undefined;
      if (shopMaxTokens  !== undefined) cfg.shopMaxTokens  = shopMaxTokens  !== '' ? Number(shopMaxTokens)  : undefined;
      if (shopCharStateOnRedeem !== undefined) {
        if (!shopCharStateOnRedeem || shopCharStateOnRedeem === 'off') delete cfg.shopCharStateOnRedeem;
        else cfg.shopCharStateOnRedeem = shopCharStateOnRedeem;
      }
      if (shopApiKey !== undefined && shopApiKey !== '' && !shopApiKey.startsWith('••••')) {
        cfg.shopApiKey = shopApiKey;
      }
      if (shopBaseUrl   === '') delete cfg.shopBaseUrl;
      if (shopModel     === '') delete cfg.shopModel;
      if (shopApiKey    === '') delete cfg.shopApiKey;
      if (shopTemperature === '') delete cfg.shopTemperature;
      if (shopMaxTokens === '') delete cfg.shopMaxTokens;
      saveUserConfig(CONFIG_PATH, cfg);
      log.info(`Shop config updated: model=${cfg.shopModel || cfg.model || '?'}`);
      res.json({ ok: true });
    } catch (e) {
      log.error('POST /api/shop/config error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/shop/models
  app.get('/api/shop/models', async (req, res) => {
    try {
      const config    = getConfig();
      const llmConfig = buildShopLLMConfig(config);
      const baseUrl   = (llmConfig.baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
      const url       = `${baseUrl}/v1/models`;
      const headers   = { 'Content-Type': 'application/json' };
      if (llmConfig.apiKey) headers['Authorization'] = `Bearer ${llmConfig.apiKey}`;

      const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      const text     = await response.text();
      let data;
      try { data = JSON.parse(text); }
      catch (_) { return res.status(502).json({ error: `Invalid JSON: ${text.slice(0, 120)}` }); }

      if (!response.ok) {
        return res.status(response.status).json({ error: data?.error?.message || `HTTP ${response.status}` });
      }

      let raw = data.data || data.models || data;
      if (!Array.isArray(raw)) raw = [];
      const models = raw.map((m) => (typeof m === 'string' ? m : m.id || m.name || '')).filter(Boolean).sort((a, b) => a.localeCompare(b));
      res.json({ models, baseUrl });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/shop/test
  app.post('/api/shop/test', async (req, res) => {
    try {
      const config    = getConfig();
      const llmConfig = buildShopLLMConfig(config);
      const result    = await testConnection(llmConfig);
      res.json({ ok: true, message: result });
    } catch (err) {
      res.status(500).json({ ok: false, message: err.message });
    }
  });

  // GET /api/shop/items
  app.get('/api/shop/items', (req, res) => {
    try {
      res.json(shopStore.loadItems());
    } catch (e) {
      log.error('GET /api/shop/items error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/shop/items/:id
  app.delete('/api/shop/items/:id', (req, res) => {
    try {
      const item = shopStore.getItem(req.params.id);
      if (!item) return res.status(404).json({ error: 'Item not found' });
      if (item.system) return res.status(403).json({ error: '系统项目不可删除' });
      const ok = shopStore.deleteItem(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Item not found' });
      log.shop('DELETE', `Deleted item: ${item.name} [${item.id}]`);
      res.json({ ok: true });
    } catch (e) {
      log.error('DELETE /api/shop/items/:id error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/shop/generate (SSE)
  app.post('/api/shop/generate', async (req, res) => {
    const { description, sessionId, sourceWorld } = req.body || {};
    const count     = Math.min(5, Math.max(1, parseInt(req.body?.count) || 1));
    const useStream = req.body?.streamEnabled !== false;

    if (!description?.trim()) return res.status(400).json({ error: 'description is required' });

    if (sessionId && sourceWorld) {
      const sess = sessionMgr.getSession(sessionId);
      if (sess) {
        const archives  = sess.statData?.Multiverse?.Archives || {};
        const validKeys = Object.keys(archives).filter(k => k && !k.startsWith('$') && k !== 'TemplateWorld');
        if (!validKeys.includes(sourceWorld)) {
          return res.status(400).json({ error: `世界「${sourceWorld}」不在该存档的经历记录中` });
        }
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      const config    = getConfig();
      const llmConfig = buildShopLLMConfig(config);

      let sessionSnapshot = null;
      if (sessionId) {
        const sess = sessionMgr.getSession(sessionId);
        if (sess) sessionSnapshot = buildStatSnapshot(sess.statData);
      }

      const previousItems = shopStore.loadItems().slice(0, 10);
      const messages      = shopPrompt.buildMessages(description, previousItems, sessionSnapshot, sourceWorld);

      log.shop('GENERATE_START', `count=${count} stream=${useStream} model=${llmConfig.model} desc="${description.slice(0,60)}"`);
      log.shopReq(description, messages);

      for (let i = 0; i < count; i++) {
        if (count > 1) send('status', { message: `生成第 ${i + 1}/${count} 项…` });

        const t0 = Date.now();
        let fullResponse = '';

        if (useStream) {
          await createCompletion(llmConfig, messages, {
            stream:  true,
            onChunk: (delta, accumulated) => { fullResponse = accumulated; send('chunk', { delta, index: i }); },
          });
        } else {
          send('status', { message: `AI 评估中 (第${i + 1}项)，请稍候…` });
          fullResponse = await createCompletion(llmConfig, messages, {});
        }

        const duration = Date.now() - t0;
        let parsed;
        try { parsed = shopEngine.parseGenerationResponse(fullResponse); }
        catch (parseErr) { send('error', { message: `第${i + 1}项解析失败: ${parseErr.message}`, index: i }); continue; }

        const savedItem = shopStore.addItem({ ...parsed, sourceDescription: description, generatedSessionId: sessionId || null, sourceWorld: sourceWorld || null });
        log.shop('GENERATED', `${savedItem.name} | ${savedItem.tier}★ | ${savedItem.pricePoints}pt | ${duration}ms`);
        log.shopResp(description, fullResponse, duration);
        log.llm({ model: llmConfig.model, baseUrl: llmConfig.baseUrl, msgCount: messages.length, stream: useStream, durationMs: duration, responseChars: fullResponse.length });
        send('done', { item: savedItem, index: i, total: count });
      }
      res.end();
    } catch (err) {
      log.error('Shop generate error', err);
      send('error', { message: err.message });
      res.end();
    }
  });

  // POST /api/shop/redeem
  app.post('/api/shop/redeem', async (req, res) => {
    try {
      const { itemId, sessionId } = req.body || {};
      if (!itemId || !sessionId) return res.status(400).json({ error: 'itemId and sessionId are required' });

      const item    = shopStore.getItem(itemId);
      if (!item) return res.status(404).json({ error: 'Item not found' });

      const session = sessionMgr.getSession(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const config      = getConfig();
      const { charCard } = require('../core/config').loadGameAssets(config);
      const userPersona = getUserPersona(config);
      applySessionCharName(userPersona, session);
      const vars = { userName: userPersona.name, charName: charCard.name };

      log.shop('REDEEM_REQ', `item="${item.name}" tier=${item.tier}★ sess=${sessionId}`);
      const result = shopEngine.executeRedemption(item, session, vars);
      if (!result.success) {
        log.shop('REDEEM_FAIL', `${item.name} | ${item.tier}★ | sess:${sessionId} | ${result.error}`);
        return res.status(400).json({ error: result.error });
      }

      const charStateMode = config.shopCharStateOnRedeem || 'off';
      const prefillText   = buildShopPrefillText(item, result.updatedStat, charStateMode);

      if (charStateMode !== 'off') {
        const invArr = session.statData?.CharacterSheet?.ShopInventory;
        if (Array.isArray(invArr) && invArr.length > 0) {
          const last = invArr[invArr.length - 1];
          if (last.id === itemId) {
            last.charStateSnapshot = buildCharStateForRedeem(result.updatedStat, charStateMode);
          }
        }
      }

      sessionMgr.saveSession(session);
      log.shop('REDEEM', `${item.name} | ${item.tier}★ | ${item.pricePoints}pt | sess:${sessionId} | charState:${charStateMode}`);
      res.json({ ok: true, item, statData: result.updatedStat, prefillText });
    } catch (e) {
      log.error('POST /api/shop/redeem error', e);
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerRoutes };
