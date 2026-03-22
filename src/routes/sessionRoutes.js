'use strict';
/**
 * Session Routes — CRUD for game sessions.
 * GET/POST/DELETE /api/sessions
 * GET /api/sessions/:id
 * POST /api/sessions/:id/init
 * GET /api/sessions/:id/stat
 * GET /api/sessions/:id/worlds
 */

const log = require('../core/logger');
const { buildStatSnapshot } = require('../engine/varEngine');
const characterStore    = require('../features/character/characterStore');
const worldArchiveStore = require('../features/world/worldArchiveStore');
const { applyCharacterToSession } = require('../features/character/characterEngine');
const { applyWorldArchiveToSession } = require('../features/world/worldEngine');

function registerRoutes(app, deps) {
  const { sessionMgr, getConfig } = deps;

  app.get('/api/sessions', (req, res) => {
    try {
      res.json(sessionMgr.listSessions());
    } catch (e) {
      log.error('GET /api/sessions error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/sessions', (req, res) => {
    try {
      const { name, greetingIndex = -1, characterId, characterType, traversalMethod, traversalDesc, worldAnchorIds, worldAnchorId, worldAnchorOptions } = req.body || {};
      const config  = getConfig();
      const session = sessionMgr.createSession({
        name,
        greetingIndex,
        charCardPath: config.charCardPath,
        presetPath:   config.presetPath,
      });

      if (characterType) session.characterType = characterType;
      if (characterType === '穿越者') {
        session.traversalMethod = traversalMethod || 'isekai';
        session.traversalDesc   = traversalDesc   || '';
      }

      if (characterId) {
        const entry = characterStore.getCharacter(characterId);
        if (entry?.character) {
          try {
            applyCharacterToSession(session, entry.character);
            log.session('CHAR_APPLY', `Applied archived character "${entry.character.name}" to session ${session.id}`);
          } catch (e) {
            log.error('Failed to apply archived character', e);
          }
        }
      }

      // Support new worldAnchorOptions format [{id, inheritIdentity}] or legacy worldAnchorIds array
      let anchorEntries = [];
      if (Array.isArray(worldAnchorOptions) && worldAnchorOptions.length) {
        anchorEntries = worldAnchorOptions.map(o => ({ id: o.id, inheritIdentity: o.inheritIdentity !== false }));
      } else {
        const anchorIds = Array.isArray(worldAnchorIds) && worldAnchorIds.length
          ? worldAnchorIds
          : (worldAnchorId ? [worldAnchorId] : []);
        anchorEntries = anchorIds.map(id => ({ id, inheritIdentity: true }));
      }

      for (const entry of anchorEntries) {
        try {
          const archive = worldArchiveStore.getArchive(entry.id);
          if (archive) applyWorldArchiveToSession(session, archive, { inheritIdentity: entry.inheritIdentity });
        } catch (e) {
          log.error(`Failed to apply world archive "${entry.id}" to new session`, e);
        }
      }

      sessionMgr.saveSession(session);
      log.session('CREATE', `${session.name} (${session.id}) greeting=${greetingIndex} type=${characterType || 'none'} worlds=[${anchorEntries.map(e => e.id).join(',')}]`);
      res.json({ id: session.id, name: session.name });
    } catch (e) {
      log.error('POST /api/sessions error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/sessions/:id', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      sessionMgr.deleteSession(req.params.id);
      log.session('DELETE', req.params.id);
      res.json({ ok: true });
    } catch (e) {
      log.error('DELETE /api/sessions/:id error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/sessions/:id', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      res.json({
        id:            session.id,
        name:          session.name,
        isInitialized: session.isInitialized,
        statData:      buildStatSnapshot(session.statData),
        history:       session.history.map((m) => ({
          role:           m.role,
          html:           m.html           || '',
          displayContent: m.displayContent || '',
          options:        m.options        || [],
          danmu:          m.danmu          || [],
          timestamp:      m.timestamp,
        })),
      });
    } catch (e) {
      log.error('GET /api/sessions/:id error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/sessions/:id/init', async (req, res) => {
    const session = sessionMgr.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    try {
      session.isInitialized = true;
      sessionMgr.saveSession(session);
      res.json({ ok: true, statData: buildStatSnapshot(session.statData) });
    } catch (e) {
      log.error('Init error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/sessions/:id/stat', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      res.json(buildStatSnapshot(session.statData));
    } catch (e) {
      log.error('GET /api/sessions/:id/stat error', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/sessions/:id/worlds', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const archives = session.statData?.Multiverse?.Archives || {};
      const worlds   = Object.keys(archives)
        .filter(k => k && !k.startsWith('$') && k !== 'TemplateWorld')
        .map(k => {
          const entry       = archives[k];
          const displayName = (Array.isArray(entry?.WorldName) ? entry.WorldName[0] : entry?.WorldName) || k;
          return { key: k, displayName };
        });
      res.json(worlds);
    } catch (e) {
      log.error('GET /api/sessions/:id/worlds error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/sessions/:id/worlds/:worldKey/npcs
  app.get('/api/sessions/:id/worlds/:worldKey/npcs', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const worldKey = decodeURIComponent(req.params.worldKey);
      const archives = session.statData?.Multiverse?.Archives || {};
      const npcs     = archives[worldKey]?.NPCs || [];
      res.json(npcs);
    } catch (e) {
      log.error('GET /api/sessions/:id/worlds/:worldKey/npcs error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/sessions/:id/worlds/:worldKey/npcs/:npcName  — 更新单个 NPC
  app.put('/api/sessions/:id/worlds/:worldKey/npcs/:npcName', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const worldKey = decodeURIComponent(req.params.worldKey);
      const npcName  = decodeURIComponent(req.params.npcName);
      const archives = session.statData?.Multiverse?.Archives;
      if (!archives?.[worldKey]) return res.status(404).json({ error: 'World not found' });

      const npcs = archives[worldKey].NPCs || [];
      const idx  = npcs.findIndex(n => n.name === npcName);
      if (idx === -1) return res.status(404).json({ error: `NPC "${npcName}" not found` });

      // 合并更新，保留未提交字段
      npcs[idx] = { ...npcs[idx], ...req.body, name: npcs[idx].name };
      archives[worldKey].NPCs = npcs;
      sessionMgr.saveSession(session);
      log.session('NPC_UPDATE', `Updated "${npcName}" in ${worldKey} (sess:${session.id})`);
      res.json(npcs[idx]);
    } catch (e) {
      log.error('PUT /npcs/:npcName error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/sessions/:id/worlds/:worldKey/npcs/:npcName  — 删除单个 NPC
  app.delete('/api/sessions/:id/worlds/:worldKey/npcs/:npcName', (req, res) => {
    try {
      const session = sessionMgr.getSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const worldKey = decodeURIComponent(req.params.worldKey);
      const npcName  = decodeURIComponent(req.params.npcName);
      const archives = session.statData?.Multiverse?.Archives;
      if (!archives?.[worldKey]) return res.status(404).json({ error: 'World not found' });

      const npcs    = archives[worldKey].NPCs || [];
      const before  = npcs.length;
      archives[worldKey].NPCs = npcs.filter(n => n.name !== npcName);
      if (archives[worldKey].NPCs.length === before) return res.status(404).json({ error: `NPC "${npcName}" not found` });

      sessionMgr.saveSession(session);
      log.session('NPC_DELETE', `Deleted "${npcName}" from ${worldKey} (sess:${session.id})`);
      res.json({ ok: true });
    } catch (e) {
      log.error('DELETE /npcs/:npcName error', e);
      res.status(500).json({ error: e.message });
    }
  });
}

module.exports = { registerRoutes };
