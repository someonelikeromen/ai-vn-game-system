'use strict';
/**
 * Character Routes — character generation, archive, and session application.
 * POST /api/character/questions (SSE)
 * POST /api/character/generate (SSE)
 * POST /api/character/apply
 * POST /api/character/regen-field (字段级重新生成, SSE)
 * GET/POST/DELETE /api/characters
 * GET/DELETE /api/characters/:id
 */

const log             = require('../core/logger');
const { createCompletion } = require('../core/llmClient');
const characterPrompt      = require('../features/character/characterPrompt');
const characterRegenPrompt = require('../features/character/characterRegenPrompt');
const characterStore  = require('../features/character/characterStore');
const { applyCharacterToSession } = require('../features/character/characterEngine');

function registerRoutes(app, deps) {
  const { sessionMgr, getConfig, buildShopLLMConfig, applySessionCharName } = deps;

  // POST /api/character/questions (SSE)
  app.post('/api/character/questions', async (req, res) => {
    const count    = Math.min(20, Math.max(10, parseInt(req.body?.count) || 15));
    const charType = req.body?.charType || '本土';
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      const config    = getConfig();
      const llmConfig = buildShopLLMConfig(config);
      const messages  = characterPrompt.buildQuestionMessages({ count, charType });

      send('status', { message: `正在生成 ${count} 道评估问题…` });
      log.shopReq('character/questions', messages);

      const t0q = Date.now();
      let fullResponse = '';
      await createCompletion(llmConfig, messages, {
        stream:  true,
        onChunk: (delta, accumulated) => { fullResponse = accumulated; send('chunk', { delta }); },
      });
      const durationQ = Date.now() - t0q;
      log.shopResp('character/questions', fullResponse, durationQ);
      log.llm({ model: llmConfig.model, baseUrl: llmConfig.baseUrl, msgCount: messages.length, stream: true, durationMs: durationQ, responseChars: fullResponse.length });

      let questions;
      try {
        const m = fullResponse.match(/```json\s*([\s\S]*?)\s*```/i);
        questions = JSON.parse(m ? m[1] : fullResponse.match(/\[[\s\S]*\]/)?.[0] || '');
      } catch (_) {}

      if (Array.isArray(questions) && questions.length > 0) {
        send('done', { questions });
      } else {
        send('error', { message: '问题解析失败，请重试' });
      }
      res.end();
    } catch (err) {
      log.error('Character questions error', err);
      send('error', { message: err.message });
      res.end();
    }
  });

  // POST /api/character/generate (SSE)
  app.post('/api/character/generate', async (req, res) => {
    const { mode, questionsAndAnswers, background, preferences, charType, traversalMethod, traversalDesc } = req.body || {};
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      let messages;
      const genOpts = { charType: charType || '本土', traversalMethod, traversalDesc };
      if (mode === 'quiz' && Array.isArray(questionsAndAnswers)) {
        messages = characterPrompt.buildFromAnswersMessages(questionsAndAnswers, genOpts);
      } else if (mode === 'background' && background?.trim()) {
        messages = characterPrompt.buildFromBackgroundMessages(background, { ...(preferences || {}), ...genOpts });
      } else {
        return res.status(400).end();
      }

      const config    = getConfig();
      const llmConfig = buildShopLLMConfig(config);

      send('status', { message: '正在生成人物档案…' });
      log.shopReq('character/generate', messages);

      const t0c = Date.now();
      let fullResponse = '';
      await createCompletion(llmConfig, messages, {
        stream:  true,
        onChunk: (delta, accumulated) => { fullResponse = accumulated; send('chunk', { delta }); },
      });
      const durationC = Date.now() - t0c;
      log.shopResp('character/generate', fullResponse, durationC);
      log.llm({ model: llmConfig.model, baseUrl: llmConfig.baseUrl, msgCount: messages.length, stream: true, durationMs: durationC, responseChars: fullResponse.length });

      let character;
      try {
        const m = fullResponse.match(/```json\s*([\s\S]*?)\s*```/i);
        character = JSON.parse(m ? m[1] : fullResponse.match(/\{[\s\S]*"name"[\s\S]*\}/)?.[0] || '');
      } catch (_) {}

      if (character && character.name) {
        send('done', { character });
      } else {
        send('error', { message: '角色解析失败，请重试' });
      }
      res.end();
    } catch (err) {
      log.error('Character generate error', err);
      send('error', { message: err.message });
      res.end();
    }
  });

  // POST /api/character/apply
  app.post('/api/character/apply', (req, res) => {
    try {
      const { character, sessionId } = req.body || {};
      if (!character || !sessionId) return res.status(400).json({ error: 'character and sessionId required' });
      if (!character.name?.trim()) return res.status(400).json({ error: 'character.name is required' });

      const session = sessionMgr.getSession(sessionId);
      if (!session) return res.status(404).json({ error: 'Session not found' });

      log.session('CHAR_APPLY_REQ', `Applying character "${character.name}" to session ${sessionId}`);
      applyCharacterToSession(session, character);
      sessionMgr.saveSession(session);
      log.session('CHAR_APPLY', `Applied character "${character.name}" to session ${sessionId}`);
      res.json({ ok: true, sessionName: session.name });
    } catch (e) {
      log.error('POST /api/character/apply error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/characters
  app.get('/api/characters', (req, res) => {
    try {
      res.json(characterStore.listCharacters());
    } catch (e) {
      log.error('GET /api/characters error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/characters
  app.post('/api/characters', (req, res) => {
    try {
      const { character } = req.body || {};
      if (!character || !character.name?.trim()) {
        return res.status(400).json({ error: 'character with name required' });
      }
      const entry = characterStore.saveCharacter(character);
      log.info(`Character archived: "${character.name}" → ${entry.id}`);
      res.json({ ok: true, id: entry.id, name: character.name });
    } catch (e) {
      log.error('POST /api/characters error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/characters/:id
  app.get('/api/characters/:id', (req, res) => {
    try {
      const entry = characterStore.getCharacter(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Character not found' });
      res.json(entry);
    } catch (e) {
      log.error('GET /api/characters/:id error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // DELETE /api/characters/:id
  app.delete('/api/characters/:id', (req, res) => {
    try {
      const ok = characterStore.deleteCharacter(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Character not found' });
      log.info(`Character deleted from archive: ${req.params.id}`);
      res.json({ ok: true });
    } catch (e) {
      log.error('DELETE /api/characters/:id error', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/character/regen-field — 字段级重新生成（SSE）
  // body: { charData, field, extraHint }
  // charData 为当前的角色 JSON（可以是未保存的预览数据）
  app.post('/api/character/regen-field', async (req, res) => {
    const { charData, field, extraHint } = req.body || {};
    if (!charData || !field) return res.status(400).json({ error: 'charData and field required' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const send = (ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      const config    = getConfig();
      const llmConfig = buildShopLLMConfig(config);
      const messages  = characterRegenPrompt.buildRegenFieldMessages(field, charData, { extraHint });

      let fullResponse = '';
      await createCompletion(llmConfig, messages, {
        stream:  true,
        onChunk: (delta, acc) => { fullResponse = acc; send('chunk', { delta }); },
      });

      let patch;
      try {
        const m = fullResponse.match(/```json\s*([\s\S]*?)\s*```/i) ||
                  fullResponse.match(/(\{[\s\S]*\})/);
        patch = JSON.parse(m ? m[1] : fullResponse);
      } catch (_) { send('error', { message: '解析失败，请重试' }); return res.end(); }

      log.info(`[CHAR_REGEN] field="${field}" char="${charData.name || '?'}"`);
      send('done', { field, newValue: patch[field] });
      res.end();
    } catch (e) {
      log.error('POST /api/character/regen-field error', e);
      send('error', { message: e.message });
      res.end();
    }
  });
}

module.exports = { registerRoutes };
