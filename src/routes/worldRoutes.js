'use strict';
/**
 * World Routes — world book management, world anchor archives, and world pulls.
 * GET/POST /api/worldbook/data
 * GET/PATCH/DELETE /api/worldanchor/archives/:id
 * GET /api/worldanchor/archives
 * POST /api/worldanchor/generate (SSE)
 * POST /api/worldanchor/pull
 * POST /api/sessions/:id/use-anchor (handled in gameRoutes)
 */

const fs   = require('fs');
const log  = require('../core/logger');
const { createCompletion } = require('../core/llmClient');
const worldAnchorPrompt  = require('../features/world/worldAnchorPrompt');
const worldArchiveStore  = require('../features/world/worldArchiveStore');
const shopStore          = require('../features/shop/shopStore');
const { buildStatSnapshot, getMedalCount, setMedalCount } = require('../engine/varEngine');
const { applyWorldArchiveToSession } = require('../features/world/worldEngine');
const { syncWorldIdentity } = require('../engine/varEngine');
const characterStore = require('../features/character/characterStore');

function registerRoutes(app, deps) {
  const { sessionMgr, getConfig, buildShopLLMConfig, OVERRIDES_PATH, invalidateAssetsCache, getBuiltinWorldbookRaw } = deps;

  // ── Overrides helpers ─────────────────────────────────────────────────────

  const path = require('path');

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

  // ── Worldbook CRUD ────────────────────────────────────────────────────────
  // Overrides file → built-in fallback (no longer requires external charCard)

  app.get('/api/worldbook/data', (req, res) => {
    try {
      const overrides = readOverrides();

      if (overrides.worldbook?.entries) {
        return res.json({ entries: overrides.worldbook.entries, charCardPath: '(overrides)' });
      }

      // Return built-in raw entries (includes disabled ones for the editor)
      const entries = getBuiltinWorldbookRaw();
      res.json({ entries, charCardPath: '(built-in)' });
    } catch (e) {
      log.error('GET /api/worldbook/data error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/worldbook/data', (req, res) => {
    try {
      const { entries } = req.body;
      if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });

      const overrides = readOverrides();
      if (!overrides.worldbook) overrides.worldbook = {};
      overrides.worldbook.entries = entries;
      writeOverrides(overrides);
      invalidateAssetsCache();

      log.info(`World book saved: ${entries.length} entries → content-overrides.json`);
      res.json({ ok: true });
    } catch (e) {
      log.error('POST /api/worldbook/data error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── World Archive Pool ────────────────────────────────────────────────────────

  app.get('/api/worldanchor/archives', (req, res) => {
    try {
      const tierRange = req.query.tier;
      const archives  = tierRange ? worldArchiveStore.getByTier(tierRange) : worldArchiveStore.loadArchives();
      res.json(archives.map(a => ({
        id: a.id, worldKey: a.worldKey, displayName: a.displayName,
        tierRange: a.tierRange, timePeriod: a.timePeriod, universe: a.universe,
        worldTier: a.worldTier, midTier: a.midTier,
        ruleCount:   (a.worldRules   || []).length,
        systemCount: (a.powerSystems || []).length,
        tierReason:  a.tierReason || '',
        createdAt:   a.createdAt,
      })));
    } catch (e) {
      log.error('GET /api/worldanchor/archives error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/worldanchor/archives/:id', (req, res) => {
    try {
      const archive = worldArchiveStore.getArchive(req.params.id);
      if (!archive) return res.status(404).json({ error: 'Not found' });
      res.json(archive);
    } catch (e) {
      log.error('GET /api/worldanchor/archives/:id error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.patch('/api/worldanchor/archives/:id', (req, res) => {
    try {
      const archive = worldArchiveStore.getArchive(req.params.id);
      if (!archive) return res.status(404).json({ error: 'Not found' });
      const allowed = ['displayName','timePeriod','recommendedEntry','initialLocation','tierReason','worldRules','powerSystems','keyFactions','worldTier','midTier','worldIdentity','timeline'];
      const updates = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      const updated = worldArchiveStore.updateArchive(req.params.id, updates);
      if (!updated) return res.status(404).json({ error: 'Update failed' });
      log.shop('WORLD_ARCHIVE', `Edited archive: ${updated.displayName} [${updated.id}]`);
      res.json(updated);
    } catch (e) {
      log.error('PATCH /api/worldanchor/archives/:id error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/worldanchor/archives/:id', (req, res) => {
    try {
      const ok = worldArchiveStore.deleteArchive(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (e) {
      log.error('DELETE /api/worldanchor/archives/:id error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/worldanchor/generate (SSE)
  app.post('/api/worldanchor/generate', async (req, res) => {
    const { worldName, additionalContext, sessionId, charStateMode, charProfileId } = req.body || {};
    if (!worldName?.trim()) return res.status(400).json({ error: 'worldName required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      const config    = getConfig();
      const llmConfig = buildShopLLMConfig(config);

      let charSnapshot = null;
      if (charProfileId && charProfileId !== '__session__') {
        const entry = characterStore.getCharacter(charProfileId);
        if (entry?.character) charSnapshot = entry.character;
      } else if (charProfileId === '__session__' || sessionId) {
        const effectiveCharMode = charStateMode || config.shopCharStateOnRedeem || 'off';
        const sess = sessionId ? sessionMgr.getSession(sessionId) : null;
        if (sess) {
          if (sess.charProfile && Object.keys(sess.charProfile).length >= 3) {
            charSnapshot = sess.charProfile;
          } else if (effectiveCharMode === 'full') {
            charSnapshot = buildStatSnapshot(sess.statData);
          }
        }
      }

      const messages = worldAnchorPrompt.buildWorldAnchorMessages(worldName, additionalContext, charSnapshot);
      send('status', { message: `正在生成「${worldName}」世界档案…` });
      log.shopReq(`worldanchor/generate:${worldName}`, messages);

      const t0w = Date.now();
      let fullResponse = '';
      await createCompletion(llmConfig, messages, {
        stream:  true,
        onChunk: (delta, accumulated) => { fullResponse = accumulated; send('chunk', { delta }); },
      });
      const durationW = Date.now() - t0w;
      log.shopResp(`worldanchor/generate:${worldName}`, fullResponse, durationW);
      log.llm({ model: llmConfig.model, baseUrl: llmConfig.baseUrl, msgCount: messages.length, stream: true, durationMs: durationW, responseChars: fullResponse.length });

      let worldData;
      try {
        const m = fullResponse.match(/```json\s*([\s\S]*?)\s*```/i);
        worldData = JSON.parse(m ? m[1] : fullResponse.match(/\{[\s\S]*"worldKey"[\s\S]*\}/)?.[0] || '');
      } catch (_) {}

      if (!worldData?.worldKey) { send('error', { message: '世界档案解析失败，请重试' }); return res.end(); }

      const worldTierNum = Number.isFinite(worldData.worldTier) ? worldData.worldTier
        : (Number.isFinite(worldData.midTier) ? worldData.midTier : null);
      const tierRange = worldTierNum !== null
        ? worldArchiveStore.detectTierRange(worldTierNum)
        : (worldArchiveStore.TIER_CONFIG[worldData.tierRange] ? worldData.tierRange : worldArchiveStore.detectTierRange(5));
      const tierCfg = worldArchiveStore.TIER_CONFIG[tierRange];

      const powerSystems = Array.isArray(worldData.powerSystems) && worldData.powerSystems.length > 0
        ? worldData.powerSystems
        : (worldData.powerSystem ? [{ name: '综合力量体系', description: worldData.powerSystem }] : []);

      const archive = worldArchiveStore.addArchive({
        worldKey: worldData.worldKey, displayName: worldData.displayName || worldName,
        universe: worldData.universe || '', timePeriod: worldData.timePeriod || '',
        tierRange, worldTier: worldTierNum !== null ? worldTierNum : tierCfg.tierMax,
        midTier: Number.isFinite(worldData.midTier) ? worldData.midTier : undefined,
        tierReason: worldData.tierReason || '', recommendedEntry: worldData.recommendedEntry || '',
        initialLocation: worldData.initialLocation || '', worldRules: worldData.worldRules || [],
        powerSystems, keyFactions: worldData.keyFactions || [],
        worldIdentity: worldData.worldIdentity || null, timeFlow: worldData.timeFlow || null,
        timeline: Array.isArray(worldData.timeline) ? worldData.timeline : [],
      });

      const ruleCount   = (worldData.worldRules   || []).length;
      const systemCount = (worldData.powerSystems || []).length;
      log.shop('WORLD_ARCHIVE', `Generated world archive: ${archive.displayName} [${tierRange} / ${worldTierNum ?? '?'}★] | rules=${ruleCount} | powerSystems=${systemCount}`);
      const counts = worldArchiveStore.countByTier();
      send('done', { archive, tierRange, worldTier: worldTierNum, tierLabel: tierCfg.label, poolCount: counts[tierRange], counts });
      res.end();
    } catch (err) {
      log.error('World anchor generate error', err);
      send('error', { message: err.message });
      res.end();
    }
  });

  // POST /api/worldanchor/pull
  app.post('/api/worldanchor/pull', (req, res) => {
    try {
      const { itemId, sessionId } = req.body || {};
      if (!itemId || !sessionId) return res.status(400).json({ error: 'itemId and sessionId required' });

      const item = shopStore.loadItems().find(i => i.id === itemId);
      if (!item?.baseAnchor) return res.status(404).json({ error: 'Base anchor item not found' });

      const sess = sessionMgr.getSession(sessionId);
      if (!sess) return res.status(404).json({ error: 'Session not found' });

      const cs            = sess.statData?.CharacterSheet;
      const currentPoints = Number(cs?.Resources?.Points) || 0;
      const pricePoints   = Number(item.pricePoints) || 0;

      if (pricePoints > 0 && currentPoints < pricePoints) {
        return res.status(400).json({ error: `积分不足。需要 ${pricePoints.toLocaleString()}，当前 ${currentPoints.toLocaleString()}` });
      }
      const medals = cs?.Resources?.StarMedals || {};
      for (const medalReq of (item.requiredMedals || [])) {
        const have = getMedalCount(medals, medalReq.stars);
        if (have < medalReq.count) {
          return res.status(400).json({ error: `${medalReq.stars}星徽章不足。需要 ${medalReq.count} 枚，当前 ${have} 枚` });
        }
      }

      const archive = worldArchiveStore.getRandom(item.tierRange);
      if (!archive) return res.status(409).json({ error: `${item.tierRange} 档案库为空，请先生成对应世界档案` });

      if (cs?.Resources) {
        if (pricePoints > 0) cs.Resources.Points = currentPoints - pricePoints;
        if (!cs.Resources.StarMedals) cs.Resources.StarMedals = {};
        for (const medalReq of (item.requiredMedals || [])) {
          const have = getMedalCount(medals, medalReq.stars);
          setMedalCount(cs.Resources.StarMedals, medalReq.stars, have - medalReq.count);
        }
      }

      if (!sess.statData) sess.statData = {};
      if (!sess.statData.Arsenal) sess.statData.Arsenal = {};
      if (!Array.isArray(sess.statData.Arsenal.WorldAnchors)) sess.statData.Arsenal.WorldAnchors = [];

      const derivedIdentity = archive.worldIdentity || {
        title: '外来穿越者',
        occupation: `在「${archive.displayName}」世界中以隐匿观察者的身份活动`,
        background: `你以外来者的身份抵达「${archive.displayName}」的起始区域（${archive.initialLocation || '未指定起点'}）。`,
        coreMemories: [], socialConnections: [],
      };
      sess.statData.Arsenal.WorldAnchors.push({
        worldKey:    archive.worldKey || archive.displayName.replace(/[^a-zA-Z0-9_]/g, '_'),
        WorldName:   [archive.displayName, 'Name'],
        Time:        { Date: [archive.timePeriod || '?', 'Date'], Clock: ['?', 'Time'], FlowRate: [archive.timeFlow?.ratioToBase || '1:1', 'Rate'] },
        TimeFlow:    archive.timeFlow || null,
        Location:    [archive.initialLocation || '?', 'Loc'],
        SocialWeb:   Object.fromEntries((archive.keyFactions || []).map(f => [f.name, [f.description, f.attitude || '']])),
        WorldRules:  archive.worldRules || [],
        Timeline:    Array.isArray(archive.timeline) ? archive.timeline : [],
        Log:         [],
        PowerSystems: Array.isArray(archive.powerSystems) && archive.powerSystems.length > 0
          ? archive.powerSystems
          : (archive.powerSystem ? [{ name: '综合力量体系', description: archive.powerSystem }] : []),
        WorldIdentity: derivedIdentity,
      });

      if (!sess.statData.CharacterSheet) sess.statData.CharacterSheet = {};
      if (!Array.isArray(sess.statData.CharacterSheet.ShopInventory)) sess.statData.CharacterSheet.ShopInventory = [];
      sess.statData.CharacterSheet.ShopInventory.push({ id: item.id, name: archive.displayName, type: 'WorldTraverse', tier: item.tierRange, redeemedAt: new Date().toISOString() });

      sessionMgr.saveSession(sess);
      const prefillText = `【系统】世界锚点「${archive.displayName}」已加入武库，请在状态面板「世界」标签页中点击「🌐 使用」激活穿越。`;
      log.shop('WORLD_PULL', `Queued ${archive.displayName} [${item.tierRange}] cost=${pricePoints}pt to Arsenal for session ${sessionId}`);
      res.json({ ok: true, archive, worldKey: archive.worldKey, message: `「${archive.displayName}」已加入武库，待激活`, prefillText });
    } catch (e) {
      log.error('POST /api/worldanchor/pull error', e);
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerRoutes };
