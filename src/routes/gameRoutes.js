'use strict';
/**
 * Game Routes — core game turn endpoints.
 * POST /api/sessions/:id/message       (stream AI response)
 * POST /api/sessions/:id/regenerate    (regenerate last AI response)
 * POST /api/sessions/:id/retrace       (edit user message and regenerate)
 * POST /api/sessions/:id/use-anchor    (activate world anchor)
 * PATCH /api/sessions/:id/messages/:idx          (manual edit)
 * POST /api/sessions/:id/messages/:idx/reprocess-display
 * POST /api/sessions/:id/messages/:idx/reprocess-vars
 * DELETE /api/sessions/:id/messages/:idx
 */

const log = require('../core/logger');
const { buildStatSnapshot, processUpdateVariables, runAutoCalc, syncWorldIdentity, propagateWorldTime } = require('../engine/varEngine');
const { fullDisplayPipeline } = require('../engine/regexPipeline');
const { runStreamTurn, processNarrativeSpawnsAsync } = require('../engine/gameLoop');
const { loadGameAssets, getUserPersona, applySessionCharName } = require('../core/config');
const worldArchiveStore = require('../features/world/worldArchiveStore');

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function registerRoutes(app, deps) {
  const { sessionMgr, withSessionLock, hasLock, getConfig } = deps;

  /**
   * Wait up to `ms` milliseconds for the session lock to release.
   * Returns true if the lock is free (or became free within the window).
   * Handles the race condition where the client disconnects (stop / navigate away)
   * and the backend needs a brief moment to process the close event and release the lock.
   */
  async function waitForLock(sessionId, ms = 1500) {
    if (!hasLock(sessionId)) return true;
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 150));
      if (!hasLock(sessionId)) return true;
    }
    return false;
  }

  // ── POST /api/sessions/:id/message ─────────────────────────────────────────
  app.post('/api/sessions/:id/message', async (req, res) => {
    const session = sessionMgr.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { content } = req.body || {};
    if (!content) return res.status(400).json({ error: 'content required' });

    if (!await waitForLock(req.params.id)) {
      return res.status(409).json({ error: '当前存档正在处理中，请等待完成后再发送' });
    }

    sseHeaders(res);
    try {
      await withSessionLock(req.params.id, () => runStreamTurn(session, content, req, res));
    } catch (e) {
      log.error('Chat error', e);
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
        res.end();
      }
    }
  });

  // ── POST /api/sessions/:id/regenerate ──────────────────────────────────────
  app.post('/api/sessions/:id/regenerate', async (req, res) => {
    const session = sessionMgr.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (!await waitForLock(req.params.id)) {
      return res.status(409).json({ error: '当前存档正在处理中，请等待完成后再操作' });
    }

    sseHeaders(res);
    try {
      await withSessionLock(req.params.id, async () => {
        const { truncateTo } = req.body || {};

        if (truncateTo !== undefined) {
          sessionMgr.truncateHistory(session, truncateTo);
        } else {
          while (session.history.length > 0 && session.history[session.history.length - 1].role === 'assistant') {
            session.history.pop();
          }
        }

        let lastUserIdx = -1;
        for (let i = session.history.length - 1; i >= 0; i--) {
          if (session.history[i].role === 'user') { lastUserIdx = i; break; }
        }
        if (lastUserIdx < 0) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: 'No user message found' })}\n\n`);
          res.end(); return;
        }

        const lastUserMsg = session.history[lastUserIdx];
        session.history   = session.history.slice(0, lastUserIdx);
        sessionMgr.saveSession(session);
        await runStreamTurn(session, lastUserMsg.displayContent || lastUserMsg.promptContent, req, res);
      });
    } catch (e) {
      log.error('Regenerate error', e);
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
        res.end();
      }
    }
  });

  // ── POST /api/sessions/:id/retrace ─────────────────────────────────────────
  app.post('/api/sessions/:id/retrace', async (req, res) => {
    const session = sessionMgr.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { msgIdx, content } = req.body || {};
    if (msgIdx === undefined || !content) {
      return res.status(400).json({ error: 'msgIdx and content required' });
    }

    if (!await waitForLock(req.params.id)) {
      return res.status(409).json({ error: '当前存档正在处理中，请等待完成后再操作' });
    }

    sseHeaders(res);
    try {
      await withSessionLock(req.params.id, async () => {
        sessionMgr.truncateHistory(session, msgIdx);
        sessionMgr.saveSession(session);
        await runStreamTurn(session, content, req, res);
      });
    } catch (e) {
      log.error('Retrace error', e);
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: e.message })}\n\n`);
        res.end();
      }
    }
  });

  // ── POST /api/sessions/:id/use-anchor ──────────────────────────────────────
  app.post('/api/sessions/:id/use-anchor', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const { worldKey, inheritIdentity = true } = req.body || {};
      if (!worldKey) return res.status(400).json({ error: 'worldKey required' });

      const anchors = session.statData?.Arsenal?.WorldAnchors;
      if (!Array.isArray(anchors)) return res.status(404).json({ error: 'No pending world anchors found' });

      const idx = anchors.findIndex(a => a.worldKey === worldKey);
      if (idx === -1) return res.status(404).json({ error: `Anchor "${worldKey}" not found` });

      const anchor = anchors[idx];
      const rawName = Array.isArray(anchor.WorldName) ? anchor.WorldName[0] : (anchor.WorldName || worldKey);

      // 优先使用档案库的 displayName 作为 key，保证与世界档案 1:1 对应
      // 这样 Phase 2 存 NPC 和商店查询都使用同一个 key，无需模糊匹配
      const allArchivesForKey = worldArchiveStore.loadArchives();
      const matchedForKey = allArchivesForKey.find(a =>
        (a.displayName || '') === rawName ||
        a.worldKey === worldKey ||
        (a.displayName || '').includes(rawName.slice(0, 4)) ||
        rawName.includes((a.displayName || '').slice(0, 4))
      );
      const displayName = (matchedForKey && matchedForKey.displayName) ? matchedForKey.displayName : rawName;

      if (!session.statData.Multiverse) session.statData.Multiverse = { CurrentWorldName: null, Archives: {}, BaselineSeconds: 0, OriginWorldKey: null };
      const mv = session.statData.Multiverse;
      if (!mv.Archives) mv.Archives = {};

      // When not inheriting identity, use a generic location to prevent
      // identity-specific text baked into anchor.Location from leaking to LLM.
      const locationValue = inheritIdentity !== false
        ? (anchor.Location || ['?', 'Loc'])
        : [`「${displayName}」世界的某处起始区域（以外来穿越者身份抵达，尚未确定具体位置）`, 'Loc'];

      // Ensure Time has TotalSeconds and initialize JustEntered for first-turn date sync
      const anchorTime = anchor.Time || {};
      if (anchorTime.TotalSeconds == null) anchorTime.TotalSeconds = 0;
      anchorTime.JustEntered = true;

      mv.Archives[displayName] = {
        WorldName:     anchor.WorldName,
        Time:          anchorTime,
        TimeFlow:      anchor.TimeFlow || null,
        Location:      locationValue,
        SocialWeb:     anchor.SocialWeb     || {},
        WorldRules:    anchor.WorldRules    || [],
        Log:           anchor.Log           || [],
        PowerSystems:  anchor.PowerSystems  || [],
        WorldIdentity: inheritIdentity !== false ? (anchor.WorldIdentity || null) : null,
      };

      mv.CurrentWorldName = [displayName, 'Name'];

      // Auto-set OriginWorldKey on first world activation
      if (!mv.OriginWorldKey) mv.OriginWorldKey = displayName;
      if (mv.BaselineSeconds == null) mv.BaselineSeconds = 0;

      if (inheritIdentity !== false) {
        syncWorldIdentity(session.statData, displayName);
      } else if (session.statData.CharacterSheet) {
        delete session.statData.CharacterSheet.WorldContext;
      }
      anchors.splice(idx, 1);

      sessionMgr.saveSession(session);
      log.session('USE_ANCHOR', `Session ${session.id} activated world "${displayName}" originKey="${mv.OriginWorldKey}" inheritIdentity=${inheritIdentity}`);

      // ── Background: pre-generate NPCs from betaDatabase catalog ──────────────
      // Find the matching world archive and batch-spawn all betaDatabase entries
      // so Phase 2 extractCombatData can find them on first encounter.
      setImmediate(() => {
        try {
          const catalog = matchedForKey && matchedForKey.betaDatabase && matchedForKey.betaDatabase.catalog;
          if (Array.isArray(catalog) && catalog.length > 0) {
            log.info(`[USE_ANCHOR] betaDatabase found (${catalog.length} entries) — queuing background NPC pre-generation for "${displayName}"`);
            const snapshot = buildStatSnapshot(session.statData);
            const spawnTags = catalog.map(entry => ({
              name:        entry.name || '',
              type:        'Monster',
              sourceWorld: displayName,
              description: [
                entry.latinName  ? `学名：${entry.latinName}` : '',
                entry.nickname   ? `俗称：${entry.nickname}`  : '',
                entry.combatTier ? `战力星级：${entry.combatTier}` : '',
                entry.primaryThreat ? `主要威胁：${entry.primaryThreat}` : '',
                entry.tierBasis  ? `战力依据：${entry.tierBasis}` : '',
                entry.antiFeat   ? `Anti-Feat：${entry.antiFeat}` : '',
                entry.appearance ? `外形：${entry.appearance.slice(0, 200)}` : '',
              ].filter(Boolean).join('\n'),
              hostile:  true,
              location: null,
            }));
            processNarrativeSpawnsAsync(session.id, spawnTags, snapshot, session.statData)
              .catch(err => log.error(`[USE_ANCHOR] betaDatabase pre-spawn error: ${err.message}`));
          }
        } catch (e) {
          log.error('[USE_ANCHOR] betaDatabase pre-spawn setup error:', e.message);
        }
      });

      res.json({ ok: true, worldName: displayName, statData: session.statData });
    } catch (e) {
      log.error('POST /api/sessions/:id/use-anchor error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── PATCH /api/sessions/:id/messages/:idx ──────────────────────────────────
  app.patch('/api/sessions/:id/messages/:idx', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const idx = parseInt(req.params.idx, 10);
      const { content } = req.body || {};
      if (isNaN(idx) || idx < 0 || idx >= session.history.length) {
        return res.status(400).json({ error: 'Invalid message index' });
      }
      if (content === undefined) return res.status(400).json({ error: 'content required' });

      const msg = session.history[idx];
      msg.displayContent = content;
      msg.promptContent  = content;
      msg.html           = content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');

      sessionMgr.saveSession(session);
      log.session('EDIT', `msg[${idx}] in sess:${session.id}`);
      res.json({ ok: true, html: msg.html });
    } catch (e) {
      log.error('PATCH /api/sessions/:id/messages/:idx error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/sessions/:id/messages/:idx/reprocess-display ─────────────────
  app.post('/api/sessions/:id/messages/:idx/reprocess-display', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const idx = parseInt(req.params.idx, 10);
      if (isNaN(idx) || idx < 0 || idx >= session.history.length) {
        return res.status(400).json({ error: 'Invalid message index' });
      }

      const msg = session.history[idx];
      if (msg.role !== 'assistant') return res.status(400).json({ error: 'Target message is not an assistant message' });

      const config  = getConfig();
      const { preset } = require('../core/config').loadGameAssets(config);
      const { html, options, danmu } = fullDisplayPipeline(preset.regexRules, msg.displayContent || '', 0);
      msg.html    = html;
      msg.options = options;
      msg.danmu   = danmu;

      sessionMgr.saveSession(session);
      log.session('REPROCESS_DISPLAY', `msg[${idx}] in sess:${session.id}`);
      res.json({ ok: true, html, options, danmu });
    } catch (e) {
      log.error('POST reprocess-display error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/sessions/:id/messages/:idx/reprocess-vars ────────────────────
  app.post('/api/sessions/:id/messages/:idx/reprocess-vars', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      if (hasLock(req.params.id)) {
        return res.status(409).json({ error: '当前存档正在处理中，请等待完成后再操作' });
      }

      const idx = parseInt(req.params.idx, 10);
      if (isNaN(idx) || idx < 0 || idx >= session.history.length) {
        return res.status(400).json({ error: 'Invalid message index' });
      }

      const msg = session.history[idx];
      if (msg.role !== 'assistant') return res.status(400).json({ error: 'Target message is not an assistant message' });
      if (!msg.statSnapshotBefore) return res.status(400).json({ error: 'No state snapshot found for this message' });

      const config      = getConfig();
      const userPersona = getUserPersona(config);
      const { charCard } = loadGameAssets(config);
      applySessionCharName(userPersona, session);

      session.statData = JSON.parse(JSON.stringify(msg.statSnapshotBefore));
      const templateVars = { userName: userPersona.name, charName: charCard.name };
      processUpdateVariables(msg.displayContent || '', session.statData, templateVars);
      runAutoCalc(session.statData);

      const nextMsg = session.history[idx + 1];
      if (nextMsg && nextMsg.role === 'user') {
        const afterNext = session.history[idx + 2];
        if (afterNext && afterNext.role === 'assistant' && afterNext.statSnapshotBefore) {
          afterNext.statSnapshotBefore = JSON.parse(JSON.stringify(session.statData));
        }
      }

      sessionMgr.saveSession(session);
      log.session('REPROCESS_VARS', `msg[${idx}] in sess:${session.id}`);
      res.json({ ok: true, statData: buildStatSnapshot(session.statData) });
    } catch (e) {
      log.error('POST reprocess-vars error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── DELETE /api/sessions/:id/messages/:idx ─────────────────────────────────
  app.delete('/api/sessions/:id/messages/:idx', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      if (hasLock(req.params.id)) {
        return res.status(409).json({ error: '当前存档正在处理中，请等待完成后再操作' });
      }

      const idx = parseInt(req.params.idx, 10);
      if (isNaN(idx) || idx < 0 || idx >= session.history.length) {
        return res.status(400).json({ error: 'Invalid message index' });
      }

      const msg            = session.history[idx];
      const removeIndices  = new Set([idx]);
      let   rollbackSnapshot = null;

      if (msg.role === 'assistant') {
        if (idx > 0 && session.history[idx - 1].role === 'user') removeIndices.add(idx - 1);
        rollbackSnapshot = msg.statSnapshotBefore || null;
      } else if (msg.role === 'user') {
        const next = session.history[idx + 1];
        if (next && next.role === 'assistant') {
          removeIndices.add(idx + 1);
          rollbackSnapshot = next.statSnapshotBefore || null;
        }
      }

      if (rollbackSnapshot) {
        session.statData = JSON.parse(JSON.stringify(rollbackSnapshot));
      }

      const sorted = [...removeIndices].sort((a, b) => b - a);
      sorted.forEach(i => session.history.splice(i, 1));

      // Patch the snapshot on the first assistant message that now sits at
      // the splice point, so future rollbacks from it use the corrected base state.
      const fixIdx = Math.min(...removeIndices);
      // After splicing, history[fixIdx] is the element that slid into position.
      // It could be user or assistant — walk forward to find the next assistant.
      if (rollbackSnapshot) {
        for (let i = fixIdx; i < session.history.length; i++) {
          if (session.history[i].role === 'assistant') {
            session.history[i].statSnapshotBefore = JSON.parse(JSON.stringify(session.statData));
            break;
          }
          // Stop at the first user message after a gap (don't overshoot turns)
          if (i > fixIdx && session.history[i].role === 'user') break;
        }
      }

      sessionMgr.saveSession(session);
      log.session('DELETE_MSG', `indices=[${[...removeIndices].sort().join(',')}] rolledBack=${!!rollbackSnapshot} sess:${session.id}`);
      res.json({ ok: true, removed: [...removeIndices].sort(), statData: buildStatSnapshot(session.statData) });
    } catch (e) {
      log.error('DELETE /api/sessions/:id/messages/:idx error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── POST /api/shop/return-home ──────────────────────────────────────────────
  app.post('/api/shop/return-home', (req, res) => {
    try {
      const { sessionId } = req.body || {};
      if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

      const session = sessionMgr.getSession(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      const mv = session.statData?.Multiverse;
      if (!mv?.OriginWorldKey) return res.status(400).json({ error: '尚未设定主世界（未激活任何世界锚点）' });

      const originKey = mv.OriginWorldKey;
      const curKey    = Array.isArray(mv.CurrentWorldName) ? mv.CurrentWorldName[0] : mv.CurrentWorldName;
      if (curKey === originKey) return res.status(400).json({ error: '你已身处主世界，无需回归' });

      const RETURN_HOME_PRICE = 20000;
      const cs     = session.statData?.CharacterSheet;
      const points = cs?.Resources?.Points ?? 0;
      if (points < RETURN_HOME_PRICE) {
        return res.status(400).json({ error: `积分不足（需要 ${RETURN_HOME_PRICE}，当前 ${points}）` });
      }

      // Deduct points
      cs.Resources.Points = points - RETURN_HOME_PRICE;

      // Switch world
      mv.CurrentWorldName = [originKey, 'Name'];

      // Set JustEntered so Phase 4 re-syncs date on next turn
      if (mv.Archives[originKey]) {
        if (!mv.Archives[originKey].Time) mv.Archives[originKey].Time = {};
        mv.Archives[originKey].Time.JustEntered = true;
      }

      syncWorldIdentity(session.statData, originKey);
      sessionMgr.saveSession(session);

      log.shop('RETURN_HOME', `Session ${session.id} returned to origin "${originKey}" cost=${RETURN_HOME_PRICE}`);
      res.json({ ok: true, worldName: originKey, remainingPoints: cs.Resources.Points, statData: session.statData });
    } catch (e) {
      log.error('POST /api/shop/return-home error', e);
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerRoutes };
