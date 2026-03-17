'use strict';
/**
 * Gacha Routes — gacha pool management and draws.
 * GET  /api/sessions/:id/gacha/pools
 * POST /api/sessions/:id/gacha/draw
 * GET  /api/sessions/:id/gacha/pending
 * POST /api/sessions/:id/gacha/pending/apply
 * DELETE /api/sessions/:id/gacha/pending/:pendingId
 */

const log         = require('../core/logger');
const { createCompletion } = require('../core/llmClient');
const gachaEngine = require('../features/gacha/gachaEngine');
const shopStore   = require('../features/shop/shopStore');
const shopEngine  = require('../features/shop/shopEngine');
const shopPrompt  = require('../features/shop/shopPrompt');
const worldArchiveStore = require('../features/world/worldArchiveStore');
const { buildStatSnapshot, getMedalCount, setMedalCount } = require('../engine/varEngine');

function buildShopPrefillText(item, statData, charStateMode) {
  const tierLabel = item.tier != null ? `${item.tier}星` : '';
  const typeMap   = { PassiveAbility: '被动能力', PowerSource: '基盘能力', ApplicationTechnique: '应用技巧', Inventory: '物品', Knowledge: '知识', WorldTraverse: '世界锚点', Companion: '同伴', Mech: '机体' };
  const typeLabel = typeMap[item.type] || item.type || '';
  let text = `【系统】${typeLabel}【${item.name}】（${tierLabel}）已兑换并完成内化。`;
  if (charStateMode === 'off' || !statData) return text;
  const cs  = statData?.CharacterSheet;
  const pts = cs?.Resources?.Points;
  text += `\n剩余积分：${typeof pts === 'number' ? pts.toLocaleString() : (pts ?? '?')}`;
  return text;
}

function registerRoutes(app, deps) {
  const { sessionMgr, withSessionLock, getConfig, buildShopLLMConfig, getUserPersona, applySessionCharName, loadGameAssets } = deps;

  // GET /api/sessions/:id/gacha/pools
  app.get('/api/sessions/:id/gacha/pools', (req, res) => {
    try {
      const sess = sessionMgr.getSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not found' });
      const allItems   = shopStore.loadItems();
      const gachaState = sess.statData?.Arsenal?.GachaState || {};
      const pools      = gachaEngine.getPoolsInfo(allItems, gachaState);
      const points = Number(sess.statData?.CharacterSheet?.Resources?.Points) || 0;
      const medals = sess.statData?.CharacterSheet?.Resources?.StarMedals || {};
      res.json({ pools, points, medals });
    } catch (e) {
      log.error('GET /api/sessions/:id/gacha/pools error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/sessions/:id/gacha/draw
  app.post('/api/sessions/:id/gacha/draw', async (req, res) => {
    const sessionId = req.params.id;
    const { poolId, count = 1 } = req.body || {};

    const sess = sessionMgr.getSession(sessionId);
    if (!sess) return res.status(404).json({ error: 'Session not found' });

    const pool = gachaEngine.GACHA_POOLS[poolId];
    if (!pool) return res.status(400).json({ error: `未知池子: ${poolId}` });

    const drawCount = [1, 10].includes(Number(count)) ? Number(count) : 1;

    try {
      await withSessionLock(sessionId, async () => {
        const statData = sess.statData;
        if (!statData?.CharacterSheet) return res.status(400).json({ error: '存档无角色数据' });

        const { points: neededPoints, medals: neededMedals } = gachaEngine.computeCost(pool, drawCount);
        const cs            = statData.CharacterSheet;
        const currentPoints = Number(cs?.Resources?.Points) || 0;

        if (currentPoints < neededPoints) {
          return res.status(400).json({ error: `积分不足，需要 ${neededPoints.toLocaleString()}，当前 ${currentPoints.toLocaleString()}` });
        }
        const medalMap = cs?.Resources?.StarMedals || {};
        for (const medalReq of neededMedals) {
          const have = getMedalCount(medalMap, medalReq.stars);
          if (have < medalReq.count) {
            return res.status(400).json({ error: `${medalReq.stars}★徽章不足，需要 ${medalReq.count} 枚，当前 ${have} 枚` });
          }
        }

        if (!cs.Resources) cs.Resources = {};
        cs.Resources.Points = currentPoints - neededPoints;
        if (!cs.Resources.StarMedals) cs.Resources.StarMedals = {};
        for (const medalReq of neededMedals) {
          const have = getMedalCount(medalMap, medalReq.stars);
          setMedalCount(cs.Resources.StarMedals, medalReq.stars, have - medalReq.count);
        }

        const config    = getConfig();
        const llmConfig = buildShopLLMConfig(config);
        const [tierMin, tierMax] = pool.tierRange;
        const previousItems = shopStore.loadItems().filter(i => !i.baseAnchor).slice(0, 8);
        const gachaSnapshot = buildStatSnapshot(sess.statData);
        const genMessages   = shopPrompt.buildGachaGenerationMessages(tierMin, tierMax, 10, previousItems, gachaSnapshot);

        log.shopReq(`gacha/draw pool=${poolId}`, genMessages);
        const GACHA_GEN_MAX_RETRIES = 3;
        let generatedCount = 0;
        let lastGenErr = null;

        for (let attempt = 1; attempt <= GACHA_GEN_MAX_RETRIES; attempt++) {
          try {
            log.shop('GACHA_GENERATE', `Pool=${poolId} attempt=${attempt}/${GACHA_GEN_MAX_RETRIES} tier=${tierMin}-${tierMax}`);
            let fullResponse = '';
            const t0gen = Date.now();
            await createCompletion(llmConfig, genMessages, {
              stream:  true,
              onChunk: (_delta, accumulated) => { fullResponse = accumulated; },
            });
            log.shopResp(`gacha/draw pool=${poolId} attempt=${attempt}`, fullResponse, Date.now() - t0gen);
            const parsed = shopEngine.parseGachaBatchResponse(fullResponse);
            for (const p of (Array.isArray(parsed) ? parsed : [])) {
              if (!p || !p.name || typeof p.tier !== 'number') continue;
              if (p.tier < tierMin || p.tier > tierMax) continue;

              if (p.type === 'WorldTraverse') {
                const trRange = worldArchiveStore.detectTierRange(p.tier);
                worldArchiveStore.addArchive({
                  worldKey: p.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '_').slice(0, 40),
                  displayName: p.name, universe: '', timePeriod: '', tierRange: trRange,
                  worldTier: p.tier, midTier: p.tier, tierReason: p.systemEvaluation || p.description || '',
                  recommendedEntry: '', initialLocation: '', worldRules: [], powerSystems: [], keyFactions: [],
                  worldIdentity: null, timeFlow: null, sourceNote: `抽卡自动生成 [${pool.name}]`,
                });
                log.shop('GACHA_WORLD_ARCHIVE', `WorldTraverse item "${p.name}" (${p.tier}★) added to archive pool [${trRange}]`);
                generatedCount++;
                continue;
              }

              shopStore.addItem({
                ...p,
                sourceDescription:  `Gacha[${pool.name}] tier:${tierMin}-${tierMax}`,
                generatedSessionId: sessionId,
                gachaPool:          poolId,
              });
              generatedCount++;
            }

            if (generatedCount >= 5) break;
            lastGenErr = null;
            if (generatedCount > 0) break;
          } catch (genErr) {
            lastGenErr = genErr;
            log.error(`Gacha generate attempt ${attempt} failed: ${genErr.message}`);
            if (attempt < GACHA_GEN_MAX_RETRIES) await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }

        if (generatedCount === 0 && lastGenErr) {
          log.error(`Gacha generation failed after ${GACHA_GEN_MAX_RETRIES} attempts for pool=${poolId}`);
        }

        const allItems = shopStore.loadItems().filter(i => !i.baseAnchor && !i.gachaPool || i.gachaPool === poolId);
        const drawResults = gachaEngine.drawFromPool(sess, allItems, poolId, drawCount);

        if (!Array.isArray(drawResults) || drawResults.length === 0) {
          return res.status(409).json({ error: '抽卡失败：无法生成足够的物品，请重试' });
        }

        if (!sess.statData.Arsenal) sess.statData.Arsenal = {};
        if (!Array.isArray(sess.statData.Arsenal.GachaPending)) sess.statData.Arsenal.GachaPending = [];

        sess.statData.Arsenal.GachaPending.push(...drawResults);

        sessionMgr.saveSession(sess);
        log.shop('GACHA_DRAW', `Pool=${poolId} drew ${drawResults.length} items for session ${sessionId}`);
        res.json({ ok: true, items: drawResults.map(p => ({ ...p, statData: buildStatSnapshot(sess.statData) })) });
      });
    } catch (e) {
      log.error('POST /api/sessions/:id/gacha/draw error', e);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  // GET /api/sessions/:id/gacha/pending
  app.get('/api/sessions/:id/gacha/pending', (req, res) => {
    try {
      const sess = sessionMgr.getSession(req.params.id);
      if (!sess) return res.status(404).json({ error: 'Session not found' });
      const pending = sess.statData?.Arsenal?.GachaPending || [];
      res.json(pending);
    } catch (e) {
      log.error('GET /api/sessions/:id/gacha/pending error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/sessions/:id/gacha/pending/apply
  app.post('/api/sessions/:id/gacha/pending/apply', async (req, res) => {
    const { id: sessionId } = req.params;
    const { pendingId } = req.body || {};
    if (!pendingId) return res.status(400).json({ error: 'pendingId required' });

    try {
      await withSessionLock(sessionId, async () => {
        const sess = sessionMgr.getSession(sessionId);
        if (!sess) return res.status(404).json({ error: 'Session not found' });

        const pending = sess.statData?.Arsenal?.GachaPending;
        if (!Array.isArray(pending)) return res.status(400).json({ error: 'No pending items' });

        const idx = pending.findIndex(p => p.pendingId === pendingId);
        if (idx === -1) return res.status(404).json({ error: 'Pending item not found' });

        const config      = getConfig();
        const { charCard } = loadGameAssets(config);
        const userPersona = getUserPersona(config);
        applySessionCharName(userPersona, sess);
        const vars = { userName: userPersona.name, charName: charCard.name };

        const { item } = pending[idx];
        const freeItem  = { ...item, pricePoints: 0, requiredMedals: [] };
        const result    = shopEngine.executeRedemption(freeItem, sess, vars);
        if (!result.success) {
          log.shop('GACHA_APPLY_FAIL', `${item.name} | ${item.tier}★ | sess:${sessionId} | ${result.error}`);
          return res.status(400).json({ error: result.error });
        }

        pending.splice(idx, 1);
        sessionMgr.saveSession(sess);

        const charStateMode = config.shopCharStateOnRedeem || 'off';
        const prefillText   = buildShopPrefillText(item, result.updatedStat, charStateMode);
        log.shop('GACHA_APPLY', `${item.name} | ${item.tier}★ | sess:${sessionId}`);
        res.json({ ok: true, item, statData: result.updatedStat, prefillText });
      });
    } catch (e) {
      log.error('POST /api/sessions/:id/gacha/pending/apply error', e);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/sessions/:id/gacha/pending/:pendingId
  app.delete('/api/sessions/:id/gacha/pending/:pendingId', async (req, res) => {
    const { id: sessionId, pendingId } = req.params;
    try {
      await withSessionLock(sessionId, async () => {
        const sess = sessionMgr.getSession(sessionId);
        if (!sess) return res.status(404).json({ error: 'Session not found' });

        const pending = sess.statData?.Arsenal?.GachaPending;
        if (!Array.isArray(pending)) return res.status(400).json({ error: 'No pending items' });

        const idx = pending.findIndex(p => p.pendingId === pendingId);
        if (idx === -1) return res.status(404).json({ error: 'Pending item not found' });

        const [removed] = pending.splice(idx, 1);
        const pool = gachaEngine.GACHA_POOLS[removed.poolId];
        let refundSummary = '';
        if (pool) {
          const { points, medals } = gachaEngine.computeCost(pool, 1);
          const cs = sess.statData.CharacterSheet;
          if (cs?.Resources) {
            if (points > 0) { cs.Resources.Points = (Number(cs.Resources.Points) || 0) + points; refundSummary += `${points.toLocaleString()}积分`; }
            if (!cs.Resources.StarMedals) cs.Resources.StarMedals = {};
            for (const m of medals) {
              const have = getMedalCount(cs.Resources.StarMedals, m.stars);
              setMedalCount(cs.Resources.StarMedals, m.stars, have + m.count);
              refundSummary += (refundSummary ? ' + ' : '') + `${m.count}×${m.stars}★徽章`;
            }
          }
        }
        sessionMgr.saveSession(sess);
        log.shop('GACHA_DISCARD', `${removed.item?.name} | refund:${refundSummary || '无'} | sess:${sessionId}`);
        res.json({ ok: true, refund: refundSummary, statData: sess.statData });
      });
    } catch (e) {
      log.error('DELETE /api/sessions/:id/gacha/pending error', e);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerRoutes };
