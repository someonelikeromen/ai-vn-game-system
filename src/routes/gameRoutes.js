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
const { buildStatSnapshot, processUpdateVariables, runAutoCalc } = require('../engine/varEngine');
const { fullDisplayPipeline } = require('../engine/regexPipeline');
const { syncWorldIdentity } = require('../engine/varEngine');
const { runStreamTurn } = require('../engine/gameLoop');
const { loadGameAssets, getUserPersona, applySessionCharName } = require('../core/config');

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function registerRoutes(app, deps) {
  const { sessionMgr, withSessionLock, hasLock, getConfig } = deps;

  // ── POST /api/sessions/:id/message ─────────────────────────────────────────
  app.post('/api/sessions/:id/message', async (req, res) => {
    const session = sessionMgr.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { content } = req.body || {};
    if (!content) return res.status(400).json({ error: 'content required' });

    if (hasLock(req.params.id)) {
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

    if (hasLock(req.params.id)) {
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

    if (hasLock(req.params.id)) {
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

      const anchor      = anchors[idx];
      const displayName = Array.isArray(anchor.WorldName) ? anchor.WorldName[0] : (anchor.WorldName || worldKey);

      if (!session.statData.Multiverse) session.statData.Multiverse = { CurrentWorldName: null, Archives: {} };
      if (!session.statData.Multiverse.Archives) session.statData.Multiverse.Archives = {};
      // When not inheriting identity, use a generic location to prevent
      // identity-specific text baked into anchor.Location from leaking to LLM.
      const anchorLocationRaw = Array.isArray(anchor.Location) ? anchor.Location[0] : anchor.Location;
      const locationValue = inheritIdentity !== false
        ? (anchor.Location || ['?', 'Loc'])
        : [`「${displayName}」世界的某处起始区域（以外来穿越者身份抵达，尚未确定具体位置）`, 'Loc'];

      session.statData.Multiverse.Archives[displayName] = {
        WorldName:     anchor.WorldName,
        Time:          anchor.Time,
        TimeFlow:      anchor.TimeFlow || null,
        Location:      locationValue,
        SocialWeb:     anchor.SocialWeb     || {},
        WorldRules:    anchor.WorldRules    || [],
        Log:           anchor.Log           || [],
        PowerSystems:  anchor.PowerSystems  || [],
        WorldIdentity: inheritIdentity !== false ? (anchor.WorldIdentity || null) : null,
      };

      session.statData.Multiverse.CurrentWorldName = [displayName, 'Name'];
      if (inheritIdentity !== false) {
        syncWorldIdentity(session.statData, displayName);
      } else if (session.statData.CharacterSheet) {
        delete session.statData.CharacterSheet.WorldContext;
      }
      anchors.splice(idx, 1);

      sessionMgr.saveSession(session);
      log.session('USE_ANCHOR', `Session ${session.id} activated world "${displayName}" inheritIdentity=${inheritIdentity}`);
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
}

module.exports = { registerRoutes };
