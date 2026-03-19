'use strict';
/**
 * Game Loop — core game turn execution.
 * Extracted from server.js to separate the game logic from routing.
 *
 * Main exports:
 *   runStreamTurn(session, userContent, req, res)
 *   processNarrativeGrantsAsync(sessionId, grantTags, snapshot)
 *   parseSystemGrantTags(text)
 */

const log          = require('../core/logger');
const sessionMgr   = require('../core/session');
const { buildContextWindow, buildPhase1Messages, buildPhase3Messages, buildPhase4Messages } = require('./promptBuilder');
const { processForPrompt, processUserInput, fullDisplayPipeline } = require('./regexPipeline');
const { createCompletion }                                 = require('../core/llmClient');
const { processUpdateVariables, buildStatSnapshot, runAutoCalc, syncWorldIdentity, propagateWorldTime } = require('./varEngine');
const { loadGameAssets, getUserPersona, applySessionCharName, syncSessionCharProfile, buildLLMConfig, buildPhaseLLMConfig, buildShopLLMConfig, getConfig } = require('../core/config');
const { retrieveFromStatData, extractCombatData } = require('./ragEngine');
const shopStore  = require('../features/shop/shopStore');
const shopEngine = require('../features/shop/shopEngine');
const shopPrompt = require('../features/shop/shopPrompt');
const npcPrompt  = require('../features/npc/npcPrompt');
const npcEngine  = require('../features/npc/npcEngine');

// ─── SystemGrant Tag Parser ───────────────────────────────────────────────────

/**
 * Parse <SystemGrant> tags from AI response text.
 * Supports JSON body and attribute+text body formats.
 */
function parseSystemGrantTags(text) {
  const grants = [];
  const re     = /<SystemGrant([^>]*)>([\s\S]*?)<\/SystemGrant>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrStr = m[1] || '';
    const body    = m[2].trim();

    let parsed = null;
    try { parsed = JSON.parse(body); } catch (_) {}

    const getAttr = (key) => {
      const am = attrStr.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, 'i'));
      return am ? am[1] : '';
    };

    const name        = parsed?.name        || getAttr('name')                 || '';
    const type        = parsed?.type        || getAttr('type')                 || '';
    const sourceWorld = parsed?.sourceWorld || parsed?.world
                     || getAttr('sourceWorld') || getAttr('world')             || '';
    const description = parsed?.description || body;

    if (description || name) grants.push({ name, type, sourceWorld, description });
  }
  return grants;
}

// ─── SystemSpawn Tag Parser ───────────────────────────────────────────────────

/**
 * Parse <SystemSpawn> tags from AI response text.
 * Used to trigger NPC/Monster stat generation for entities appearing in the narrative.
 *
 * Format: <SystemSpawn>{"name": "...", "description": "...", "type": "Monster|NPC|Boss",
 *           "sourceWorld": "...", "hostile": true, "location": "..."}</SystemSpawn>
 */
function parseSystemSpawnTags(text) {
  const spawns = [];
  const re = /<SystemSpawn([^>]*)>([\s\S]*?)<\/SystemSpawn>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const attrStr = m[1] || '';
    const body    = m[2].trim();

    let parsed = null;
    try { parsed = JSON.parse(body); } catch (_) {}

    const getAttr = (key) => {
      const am = attrStr.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']*)["']`, 'i'));
      return am ? am[1] : '';
    };

    const name        = parsed?.name        || getAttr('name')        || '';
    const type        = parsed?.type        || getAttr('type')        || 'Monster';
    const sourceWorld = parsed?.sourceWorld || getAttr('sourceWorld') || '';
    const description = parsed?.description || body;
    const hostile     = parsed?.hostile     ?? true;
    const location    = parsed?.location    || getAttr('location')    || null;

    if (name || description) {
      spawns.push({ name, type, sourceWorld, description, hostile, location });
    }
  }
  return spawns;
}

// ─── Core Game Turn (SSE Streaming) ──────────────────────────────────────────

/**
 * Run one complete game turn: build context → call LLM → stream to client
 * → process UpdateVariable blocks → save session.
 *
 * Callers must set SSE headers and resolve sessionLock before calling.
 */
async function runStreamTurn(session, userContent, req, res) {
  const config = getConfig();
  if (config.multiPhase?.enabled) {
    return runMultiPhaseTurn(session, userContent, req, res);
  }
  return runSinglePhaseTurn(session, userContent, req, res);
}

/**
 * Legacy single-phase turn (original implementation).
 */
async function runSinglePhaseTurn(session, userContent, req, res) {
  const config      = getConfig();
  const { charCard, preset } = loadGameAssets(config);
  const userPersona = getUserPersona(config);
  applySessionCharName(userPersona, session);
  const llmConfig   = buildLLMConfig(config);

  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Abort support: destroy LLM request when client disconnects.
  // 200ms guard prevents stale keep-alive events from previous response.
  let llmNodeReq    = null;
  let clientAborted = false;
  const reqStartMs  = Date.now();
  req.on('close', () => {
    if (!clientAborted && Date.now() - reqStartMs > 200) {
      clientAborted = true;
      if (llmNodeReq) llmNodeReq.destroy();
    }
  });

  // Process user input through regex pipeline
  const processedInput = processUserInput(preset.regexRules, userContent, 0);

  // Add user message to history and persist immediately so a mid-turn restart
  // does not erase the user's input from the session file.
  sessionMgr.addMessage(session, 'user', processedInput, userContent, {
    html: userContent.replace(/\n/g, '<br>'),
  });
  sessionMgr.saveSession(session);
  const userMsgIdx = session.history.length - 1;

  // Build context window — first 2 turns as stable anchor + last 10 recent turns
  const MAX_ROUNDS    = 10;
  const prevHistory   = session.history.slice(0, -1);
  const anchorHistory = prevHistory.slice(0, 4);
  const recentHistory = prevHistory.slice(4).slice(-MAX_ROUNDS * 2);
  const contextHistory = [...anchorHistory, ...recentHistory];

  const messages = buildContextWindow(
    preset, charCard, session.statData, contextHistory, userPersona, processedInput
  );

  log.chatReq(session.id, messages);

  // Prepend prefill if the last message is an assistant prefill
  const lastMsg = messages[messages.length - 1];
  const prefill = (lastMsg?.role === 'assistant') ? (lastMsg.content || '') : '';

  let fullResponse = '';
  const t0         = Date.now();
  const useStream  = config.streaming !== false;

  if (useStream) {
    if (prefill && !clientAborted) send('chunk', { delta: prefill });

    await createCompletion(llmConfig, messages, {
      stream:    true,
      onRequest: (nReq) => { llmNodeReq = nReq; if (clientAborted) nReq.destroy(); },
      onChunk:   (delta, accumulated) => {
        if (prefill && !accumulated.startsWith('<think>')) {
          fullResponse = prefill + accumulated;
        } else {
          fullResponse = accumulated;
        }
        if (!clientAborted) send('chunk', { delta });
      },
    });
    if (prefill && !fullResponse.startsWith('<think>') && !fullResponse.startsWith(prefill)) {
      fullResponse = prefill + fullResponse;
    }
  } else {
    const rawResponse = await createCompletion(llmConfig, messages, {
      onRequest: (nReq) => { llmNodeReq = nReq; if (clientAborted) nReq.destroy(); },
    });
    fullResponse = (prefill && !rawResponse.startsWith('<think>')) ? prefill + rawResponse : rawResponse;
    if (!clientAborted) send('chunk', { delta: fullResponse });
  }

  const durationMs = Date.now() - t0;
  log.llm({ model: llmConfig.model, baseUrl: llmConfig.baseUrl, msgCount: messages.length, stream: useStream, durationMs, responseChars: fullResponse.length });
  log.chatResp(session.id, fullResponse, durationMs);

  if (clientAborted) { if (!res.writableEnded) res.end(); return; }

  // Snapshot statData BEFORE variable processing (for reprocess-vars feature)
  const statSnapshotBefore = JSON.parse(JSON.stringify(session.statData));

  // Process UpdateVariable blocks
  const templateVars = { userName: userPersona.name, charName: charCard.name };
  processUpdateVariables(fullResponse, session.statData, templateVars);
  propagateWorldTime(session.statData);
  runAutoCalc(session.statData);
  syncSessionCharProfile(session);

  // Parse <SystemGrant> tags → queue background LLM generation
  const grantTags = parseSystemGrantTags(fullResponse);
  if (grantTags.length > 0) {
    if (!session.statData.Arsenal) session.statData.Arsenal = {};
    if (!Array.isArray(session.statData.Arsenal.NarrativeGrants)) {
      session.statData.Arsenal.NarrativeGrants = [];
    }
    for (const g of grantTags) {
      const grantName = g.name || g.description.slice(0, 40);
      session.statData.Arsenal.NarrativeGrants.unshift({
        grantId:     `ng-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name:        grantName,
        description: g.description,
        type:        g.type        || '',
        sourceWorld: g.sourceWorld || '',
        status:      'generating',
        createdAt:   new Date().toISOString(),
      });
    }
    if (session.statData.Arsenal.NarrativeGrants.length > 20) {
      session.statData.Arsenal.NarrativeGrants = session.statData.Arsenal.NarrativeGrants.slice(0, 20);
    }
    const _sessionIdForGrant = session.id;
    const _snapshotForGrant  = buildStatSnapshot(session.statData);
    setImmediate(() => {
      processNarrativeGrantsAsync(_sessionIdForGrant, grantTags, _snapshotForGrant)
        .catch(err => log.error('NarrativeGrant background error', err));
    });
  }

  // SystemSpawn tags trigger NPC/monster stat generation (async, non-blocking)
  const spawnTagsSingle = parseSystemSpawnTags(fullResponse);
  if (spawnTagsSingle.length > 0) {
    const _sessionIdForSpawn = session.id;
    const _snapshotForSpawn  = buildStatSnapshot(session.statData);
    const _statDataForSpawn  = session.statData;
    setImmediate(() => {
      processNarrativeSpawnsAsync(_sessionIdForSpawn, spawnTagsSingle, _snapshotForSpawn, _statDataForSpawn)
        .catch(err => log.error('NarrativeSpawn background error', err));
    });
  }

  // Process response for display
  const { html, options, danmu } = fullDisplayPipeline(preset.regexRules, fullResponse, 0);
  const promptContent = processForPrompt(preset.regexRules, fullResponse, 0);

  sessionMgr.addMessage(session, 'assistant', promptContent, fullResponse, { html, options, danmu, statSnapshotBefore });
  sessionMgr.saveSession(session);

  const aiMsgIdx = session.history.length - 1;

  send('done', {
    html, options, danmu,
    statData: buildStatSnapshot(session.statData),
    aiMsgIdx,
    userMsgIdx,
  });

  if (!res.writableEnded) res.end();
}

// ─── Multi-Phase Turn ────────────────────────────────────────────────────────

/**
 * Four-phase game turn pipeline.
 *
 * Phase 1 — Planning: small non-streaming LLM call → JSON outline + RAG query terms
 * Phase 2 — Info:     JS-only RAG retrieval over world archive logs
 * Phase 3 — Generate: main streaming LLM call with enhanced context, no UpdateVariable
 * Phase 4 — Update:   focused streaming LLM call → UpdateVariable only
 */
async function runMultiPhaseTurn(session, userContent, req, res) {
  const config      = getConfig();
  const { charCard, preset } = loadGameAssets(config);
  const userPersona = getUserPersona(config);
  applySessionCharName(userPersona, session);
  const llmConfig   = buildLLMConfig(config);

  // Phase-specific LLM configs — each phase can override model, baseUrl, apiKey, maxTokens
  const mp = config.multiPhase || {};
  const phase1Config = buildPhaseLLMConfig(llmConfig, {
    model:       mp.phase1Model,
    baseUrl:     mp.phase1BaseUrl,
    apiKey:      mp.phase1ApiKey,
    maxTokens:   mp.phase1MaxTokens || 512,
    temperature: 0.3,
  });
  const phase3Config = buildPhaseLLMConfig(llmConfig, {
    model:       mp.phase3Model,
    baseUrl:     mp.phase3BaseUrl,
    apiKey:      mp.phase3ApiKey,
    maxTokens:   mp.phase3MaxTokens || null,
    temperature: llmConfig.temperature,
  });
  const phase4Config = buildPhaseLLMConfig(llmConfig, {
    model:       mp.phase4Model,
    baseUrl:     mp.phase4BaseUrl,
    apiKey:      mp.phase4ApiKey,
    maxTokens:   mp.phase4MaxTokens || null,
    temperature: 0.6,
  });

  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Retry / quality thresholds
  const MAX_RETRIES  = 3;
  const MIN_P1_CHARS = 50;
  const MIN_P3_CHARS = 100;

  // Abort support
  let clientAborted = false;
  const reqStartMs  = Date.now();
  let   llmNodeReq  = null;
  req.on('close', () => {
    if (!clientAborted && Date.now() - reqStartMs > 200) {
      clientAborted = true;
      if (llmNodeReq) llmNodeReq.destroy();
    }
  });

  // Process user input
  const processedInput = processUserInput(preset.regexRules, userContent, 0);

  // Add user message to history and persist immediately so a mid-turn restart
  // does not erase the user's input from the session file.
  sessionMgr.addMessage(session, 'user', processedInput, userContent, {
    html: userContent.replace(/\n/g, '<br>'),
  });
  sessionMgr.saveSession(session);
  const userMsgIdx = session.history.length - 1;

  // Build context history (same window as single-phase)
  const MAX_ROUNDS    = 10;
  const prevHistory   = session.history.slice(0, -1);
  const anchorHistory = prevHistory.slice(0, 4);
  const recentHistory = prevHistory.slice(4).slice(-MAX_ROUNDS * 2);
  const contextHistory = [...anchorHistory, ...recentHistory];

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 1 — Planning  (up to MAX_RETRIES retries)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  send('phase', { phase: 1, label: '规划大纲', status: 'start' });

  let phase1Result = { outline: [], logQueryTerms: [], reqCharUpdate: false, reqItemUpdate: [], reqCombatEnemies: [] };
  {
    const p1Messages = buildPhase1Messages(preset, charCard, session.statData, prevHistory, userPersona, processedInput);
    log.chatReq(session.id + ':p1', p1Messages);

    let p1Done = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (clientAborted) break;
      if (attempt > 0) log.info(`[PHASE1] Retry ${attempt}/${MAX_RETRIES}`);

      let p1Raw = '';
      try {
        const t0p1 = Date.now();
        p1Raw = await createCompletion(phase1Config, p1Messages, {
          stream: false,
          onRequest: (nReq) => { llmNodeReq = nReq; if (clientAborted) nReq.destroy(); },
        });
        const durP1 = Date.now() - t0p1;
        log.llm({ model: phase1Config.model, baseUrl: phase1Config.baseUrl, msgCount: p1Messages.length, stream: false, durationMs: durP1, responseChars: p1Raw.length, phase: 1 });
        log.chatResp(session.id + ':p1', p1Raw, durP1);
      } catch (err) {
        log.warn(`[PHASE1] Attempt ${attempt + 1}/${MAX_RETRIES + 1} error: ${err.message}`);
        if (attempt < MAX_RETRIES) continue;
        log.error('[PHASE1] All attempts failed, aborting turn.');
        if (!res.writableEnded) res.end();
        return;
      }

      if (clientAborted) break;

      if (p1Raw.length < MIN_P1_CHARS) {
        log.warn(`[PHASE1] Response too short (${p1Raw.length} chars) on attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
        if (attempt < MAX_RETRIES) continue;
        log.error('[PHASE1] All attempts too short, aborting turn.');
        if (!res.writableEnded) res.end();
        return;
      }

      const p1Stripped = p1Raw.replace(/<think>[\s\S]*?<\/think>/gi, '');
      const jsonMatch = p1Stripped.match(/```json\s*([\s\S]*?)```/) || p1Stripped.match(/```\s*(\{[\s\S]*?\})\s*```/) || p1Stripped.match(/(\{[\s\S]*\})/);
      if (!jsonMatch) {
        log.warn(`[PHASE1] No JSON found on attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
        if (attempt < MAX_RETRIES) continue;
        log.error('[PHASE1] No valid JSON in all attempts, aborting turn.');
        if (!res.writableEnded) res.end();
        return;
      }

      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        phase1Result = {
          outline:          Array.isArray(parsed.outline)          ? parsed.outline          : [],
          logQueryTerms:    Array.isArray(parsed.logQueryTerms)    ? parsed.logQueryTerms    : [],
          reqCharUpdate:    Boolean(parsed.reqCharUpdate),
          reqItemUpdate:    Array.isArray(parsed.reqItemUpdate) ? parsed.reqItemUpdate : (parsed.reqItemUpdate ? [String(parsed.reqItemUpdate)] : []),
          reqCombatEnemies: Array.isArray(parsed.reqCombatEnemies) ? parsed.reqCombatEnemies : [],
        };
        p1Done = true;
        break;
      } catch (parseErr) {
        log.warn(`[PHASE1] JSON parse failed on attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${parseErr.message}`);
        if (attempt < MAX_RETRIES) continue;
        log.error('[PHASE1] JSON parse failed all attempts, aborting turn.');
        if (!res.writableEnded) res.end();
        return;
      }
    }

    if (!p1Done && !clientAborted) {
      log.error('[PHASE1] Exited retry loop without success, aborting turn.');
      if (!res.writableEnded) res.end();
      return;
    }
  }

  send('phase', { phase: 1, label: '规划大纲', status: 'done', outline: phase1Result.outline });

  if (clientAborted) { if (!res.writableEnded) res.end(); return; }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 2 — Info Retrieval (RAG + context assembly, no LLM)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  send('phase', { phase: 2, label: '检索信息', status: 'start' });

  const topK          = mp.ragTopK || 8;
  const retrievedLogs = retrieveFromStatData(session.statData, phase1Result.logQueryTerms, topK);
  const logCount      = Object.values(retrievedLogs).reduce((s, a) => s + a.length, 0);

  // Extract combat entity data from world PowerSystems when Phase 1 signals enemies
  const combatData = extractCombatData(session.statData, phase1Result.reqCombatEnemies);
  const combatCount = combatData?.entities?.length || 0;

  send('phase', { phase: 2, label: '检索信息', status: 'done', logCount, combatCount });

  if (clientAborted) { if (!res.writableEnded) res.end(); return; }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 3 — Main Narrative Generation (streaming, up to MAX_RETRIES retries)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  send('phase', { phase: 3, label: '生成叙事', status: 'start' });

  const p3Messages = buildPhase3Messages(
    preset, charCard, session.statData, contextHistory, userPersona, processedInput,
    { outline: phase1Result.outline, retrievedLogs, combatData }
  );
  log.chatReq(session.id + ':p3', p3Messages);

  const lastMsgP3 = p3Messages[p3Messages.length - 1];
  const prefillP3 = lastMsgP3?.role === 'assistant' ? (lastMsgP3.content || '') : '';

  let phase3Response = '';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (clientAborted) break;

    if (attempt > 0) {
      // Tell frontend to clear streamed text and show retry indicator
      send('phase', { phase: 3, label: '生成叙事', status: 'retry', attempt });
      log.info(`[PHASE3] Retry ${attempt}/${MAX_RETRIES} (prev: ${phase3Response.length} chars)`);
    }

    if (prefillP3 && !clientAborted) send('chunk', { delta: prefillP3 });

    let attemptResponse = '';
    const t0p3 = Date.now();
    try {
      await createCompletion(phase3Config, p3Messages, {
        stream:    true,
        onRequest: (nReq) => { llmNodeReq = nReq; if (clientAborted) nReq.destroy(); },
        onChunk:   (delta, accumulated) => {
          attemptResponse = (prefillP3 && !accumulated.startsWith('<think>'))
            ? prefillP3 + accumulated
            : accumulated;
          if (!clientAborted) send('chunk', { delta });
        },
      });
    } catch (err) {
      log.warn(`[PHASE3] Attempt ${attempt + 1}/${MAX_RETRIES + 1} error: ${err.message}`);
      if (attempt < MAX_RETRIES) continue;
      log.error('[PHASE3] All attempts failed, aborting turn.');
      if (!res.writableEnded) res.end();
      return;
    }

    if (prefillP3 && !attemptResponse.startsWith('<think>') && !attemptResponse.startsWith(prefillP3)) {
      attemptResponse = prefillP3 + attemptResponse;
    }
    const durP3 = Date.now() - t0p3;
    log.llm({ model: phase3Config.model, baseUrl: phase3Config.baseUrl, msgCount: p3Messages.length, stream: true, durationMs: durP3, responseChars: attemptResponse.length, phase: 3 });
    log.chatResp(session.id + ':p3', attemptResponse, durP3);

    if (clientAborted) break;

    if (attemptResponse.length < MIN_P3_CHARS) {
      log.warn(`[PHASE3] Response too short (${attemptResponse.length} chars) on attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
      if (attempt < MAX_RETRIES) continue;
      log.error('[PHASE3] All attempts too short, aborting turn.');
      if (!res.writableEnded) res.end();
      return;
    }

    phase3Response = attemptResponse;
    break;
  }

  if (!phase3Response && !clientAborted) {
    log.error('[PHASE3] Exited retry loop without valid response, aborting turn.');
    if (!res.writableEnded) res.end();
    return;
  }

  send('phase', { phase: 3, label: '生成叙事', status: 'done' });

  if (clientAborted) { if (!res.writableEnded) res.end(); return; }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PHASE 4 — UpdateVariable Generation (streaming)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  send('phase', { phase: 4, label: '更新状态', status: 'start' });

  let phase4Response = '';
  try {
    const MAX_P4_RETRIES = MAX_RETRIES;
    const p4BaseMessages  = buildPhase4Messages(charCard, session.statData, phase3Response);
    const t0p4 = Date.now();

    for (let attempt = 0; attempt <= MAX_P4_RETRIES; attempt++) {
      if (clientAborted) break;

      // On retry: attach partial response as assistant prefill + ask to continue
      const p4Messages = (attempt === 0 || !phase4Response)
        ? p4BaseMessages
        : [
            ...p4BaseMessages,
            { role: 'assistant', content: phase4Response },
            { role: 'user',      content: '请从上面中断处继续，直到输出完整的 </UpdateVariable>，不要重复已输出的内容。' },
          ];

      if (attempt === 0) log.chatReq(session.id + ':p4', p4Messages);
      else log.info(`[PHASE4] Incomplete response (attempt ${attempt}), retrying continuation...`);

      let chunkText     = '';
      let finishReason  = 'stop';
      await createCompletion(phase4Config, p4Messages, {
        stream:         true,
        onRequest:      (nReq) => { llmNodeReq = nReq; if (clientAborted) nReq.destroy(); },
        onFinishReason: (fr)   => { finishReason = fr; },
        onChunk:        (_delta, accumulated) => {
          chunkText = accumulated;
          // Stream Phase 4 chunks with a type marker so frontend can distinguish
          if (!clientAborted) send('chunk4', { delta: _delta });
        },
      });

      // Combine: first attempt sets response; retries append continuation
      phase4Response = (attempt === 0) ? chunkText : phase4Response + chunkText;

      log.llm({ model: phase4Config.model, baseUrl: phase4Config.baseUrl, msgCount: p4Messages.length, stream: true, durationMs: Date.now() - t0p4, responseChars: phase4Response.length, phase: 4 });
      log.chatResp(session.id + ':p4', phase4Response, Date.now() - t0p4);

      // Completeness check: <UpdateVariable> must have matching </UpdateVariable>
      const opens  = (phase4Response.match(/<UpdateVariable>/gi)  || []).length;
      const closes = (phase4Response.match(/<\/UpdateVariable>/gi) || []).length;
      const isComplete = opens > 0 && opens === closes;

      if (isComplete) {
        if (attempt > 0) log.info(`[PHASE4] Completed after ${attempt} continuation(s).`);
        break;
      }

      if (finishReason === 'length') {
        log.warn(`[PHASE4] finish_reason=length on attempt ${attempt + 1}, response truncated (${phase4Response.length} chars)`);
      } else {
        log.warn(`[PHASE4] Incomplete tags (open=${opens} close=${closes}) on attempt ${attempt + 1}`);
      }

      if (attempt === MAX_P4_RETRIES) {
        log.error(`[PHASE4] Still incomplete after ${MAX_P4_RETRIES} retries, proceeding with partial response.`);
      }
    }
  } catch (err) {
    log.error('Phase 4 failed:', err.message);
  }

  send('phase', { phase: 4, label: '更新状态', status: 'done' });

  if (clientAborted) { if (!res.writableEnded) res.end(); return; }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FINALIZE — combine Phase 3 + Phase 4, process variables, save
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // Snapshot BEFORE variable processing
  const statSnapshotBefore = JSON.parse(JSON.stringify(session.statData));

  // Process UpdateVariable from Phase 4 (and ignore any stray ones in Phase 3)
  const templateVars = { userName: userPersona.name, charName: charCard.name };
  processUpdateVariables(phase4Response, session.statData, templateVars);
  propagateWorldTime(session.statData);
  runAutoCalc(session.statData);
  syncSessionCharProfile(session);

  // SystemGrant tags can appear in Phase 3 narrative
  const grantTags = parseSystemGrantTags(phase3Response);
  if (grantTags.length > 0) {
    if (!session.statData.Arsenal) session.statData.Arsenal = {};
    if (!Array.isArray(session.statData.Arsenal.NarrativeGrants)) {
      session.statData.Arsenal.NarrativeGrants = [];
    }
    for (const g of grantTags) {
      const grantName = g.name || g.description.slice(0, 40);
      session.statData.Arsenal.NarrativeGrants.unshift({
        grantId:     `ng-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name:        grantName,
        description: g.description,
        type:        g.type        || '',
        sourceWorld: g.sourceWorld || '',
        status:      'generating',
        createdAt:   new Date().toISOString(),
      });
    }
    if (session.statData.Arsenal.NarrativeGrants.length > 20) {
      session.statData.Arsenal.NarrativeGrants = session.statData.Arsenal.NarrativeGrants.slice(0, 20);
    }
    const _sessionIdForGrant = session.id;
    const _snapshotForGrant  = buildStatSnapshot(session.statData);
    setImmediate(() => {
      processNarrativeGrantsAsync(_sessionIdForGrant, grantTags, _snapshotForGrant)
        .catch(err => log.error('NarrativeGrant background error', err));
    });
  }

  // SystemSpawn tags trigger NPC/monster stat generation (async, non-blocking)
  const spawnTags = parseSystemSpawnTags(phase3Response);
  if (spawnTags.length > 0) {
    const _sessionIdForSpawn = session.id;
    const _snapshotForSpawn  = buildStatSnapshot(session.statData);
    const _statDataForSpawn  = session.statData;
    setImmediate(() => {
      processNarrativeSpawnsAsync(_sessionIdForSpawn, spawnTags, _snapshotForSpawn, _statDataForSpawn)
        .catch(err => log.error('NarrativeSpawn background error', err));
    });
  }

  // Process Phase 3 response for display
  const { html, options, danmu } = fullDisplayPipeline(preset.regexRules, phase3Response, 0);
  const promptContent = processForPrompt(preset.regexRules, phase3Response, 0);

  // Store the combined content in history
  // promptContent = Phase 3 for future conversation context
  // displayContent = Phase 3 (what user sees) with Phase 4 appended as hidden data
  const fullStoredContent = phase4Response
    ? phase3Response + '\n<!-- phase4 -->\n' + phase4Response
    : phase3Response;

  sessionMgr.addMessage(session, 'assistant', promptContent, fullStoredContent, {
    html, options, danmu, statSnapshotBefore,
    phase4: phase4Response,
  });
  sessionMgr.saveSession(session);

  const aiMsgIdx = session.history.length - 1;

  send('done', {
    html, options, danmu,
    statData: buildStatSnapshot(session.statData),
    aiMsgIdx,
    userMsgIdx,
  });

  if (!res.writableEnded) res.end();
}

// ─── Narrative Grant Background Processing ────────────────────────────────────

/**
 * Background: call shop LLM to evaluate each grant → store in shop-items.json
 * → auto-apply to session at price=0. Updates Arsenal.NarrativeGrants status.
 */
async function processNarrativeGrantsAsync(sessionId, grantTags, snapshotAtGrant) {
  const config      = getConfig();
  const llmConfig   = buildShopLLMConfig(config);
  const { charCard } = loadGameAssets(config);
  const userPersona = getUserPersona(config);

  for (const grant of grantTags) {
    const grantName = grant.name || grant.description.slice(0, 40);
    try {
      log.shop('NARRATIVE_GRANT', `Generating "${grantName}" for session ${sessionId}`);

      const evalDesc = grant.name
        ? `${grant.name}${grant.type ? `（类型：${grant.type}）` : ''}${grant.description ? `\n${grant.description}` : ''}`
        : grant.description;

      const previousItems = shopStore.loadItems().slice(0, 8);
      const messages      = shopPrompt.buildMessages(evalDesc, previousItems, snapshotAtGrant, grant.sourceWorld || null);

      log.shopReq(`narrativeGrant:${grantName}`, messages);

      let fullResponse = '';
      const t0ng = Date.now();
      await createCompletion(llmConfig, messages, {
        stream:  true,
        onChunk: (_d, acc) => { fullResponse = acc; },
      });
      const durationNg = Date.now() - t0ng;
      log.shopResp(`narrativeGrant:${grantName}`, fullResponse, durationNg);
      log.llm({ model: llmConfig.model, baseUrl: llmConfig.baseUrl, msgCount: messages.length, stream: true, durationMs: durationNg, responseChars: fullResponse.length });

      const parsed = shopEngine.parseGenerationResponse(fullResponse);
      if (!parsed?.name) throw new Error('LLM 返回内容无法解析为有效物品');

      const savedItem = shopStore.addItem({
        ...parsed,
        sourceDescription:  grant.description || grant.name,
        narrativeGrant:     true,
        narrativeGrantedAt: new Date().toISOString(),
        sourceWorld:        grant.sourceWorld || parsed.sourceWorld || null,
      });

      const sess = sessionMgr.getSession(sessionId);
      if (!sess) return;
      applySessionCharName(userPersona, sess);
      const vars     = { userName: userPersona.name, charName: charCard.name };
      const freeItem = { ...savedItem, pricePoints: 0, requiredMedals: [] };
      shopEngine.executeRedemption(freeItem, sess, vars);

      const grantList = sess.statData.Arsenal?.NarrativeGrants;
      if (Array.isArray(grantList)) {
        const entry = grantList.find(x => x.name === grantName && x.status === 'generating');
        if (entry) {
          entry.status      = 'applied';
          entry.appliedItem = { name: savedItem.name, tier: savedItem.tier, type: savedItem.type, id: savedItem.id };
          entry.appliedAt   = new Date().toISOString();
        }
      }
      sessionMgr.saveSession(sess);
      log.shop('NARRATIVE_GRANT', `Applied "${savedItem.name}" (${savedItem.tier}★) to session ${sessionId}`);

    } catch (err) {
      log.error(`NarrativeGrant "${grantName}" failed: ${err.message}`);
      const sess = sessionMgr.getSession(sessionId);
      if (sess) {
        const grantList = sess.statData.Arsenal?.NarrativeGrants;
        if (Array.isArray(grantList)) {
          const entry = grantList.find(x => x.name === grantName && x.status === 'generating');
          if (entry) { entry.status = 'failed'; entry.errorMsg = err.message; }
        }
        sessionMgr.saveSession(sess);
      }
    }
  }
}

// ─── Narrative Spawn Background Processing ────────────────────────────────────

/**
 * Background: call shop LLM to generate NPC/monster stat sheets for SystemSpawn tags.
 * Results stored in Multiverse.Archives.<World>.NPCs[].
 *
 * @param {string}   sessionId
 * @param {object[]} spawnTags     - Parsed SystemSpawn tag objects
 * @param {object}   snapshot      - statData snapshot (for world context)
 * @param {object}   liveStatData  - Live statData (for storage)
 */
async function processNarrativeSpawnsAsync(sessionId, spawnTags, snapshot, liveStatData) {
  const config    = getConfig();
  const llmConfig = buildShopLLMConfig(config);

  // Get current world for power system context
  const curWorld = Array.isArray(snapshot.Multiverse?.CurrentWorldName)
    ? snapshot.Multiverse.CurrentWorldName[0]
    : (snapshot.Multiverse?.CurrentWorldName || null);
  const worldPowerSystems = curWorld
    ? (snapshot.Multiverse?.Archives?.[curWorld]?.PowerSystems || [])
    : [];

  for (const spawn of spawnTags) {
    const spawnName = spawn.name || spawn.description.slice(0, 40);
    try {
      log.shop('NARRATIVE_SPAWN', `Generating NPC/monster "${spawnName}" for session ${sessionId}`);

      const evalDesc = spawn.name
        ? `**${spawn.name}**（类型：${spawn.type}）\n${spawn.description || ''}`
        : spawn.description;

      const worldKey    = spawn.sourceWorld || curWorld || 'Unknown';
      const messages    = npcPrompt.buildMessages(evalDesc, worldKey, worldPowerSystems);
      log.shopReq(`narrativeSpawn:${spawnName}`, messages);

      let fullResponse = '';
      const t0 = Date.now();
      await createCompletion(llmConfig, messages, {
        stream:  true,
        onChunk: (_d, acc) => { fullResponse = acc; },
      });
      log.shopResp(`narrativeSpawn:${spawnName}`, fullResponse, Date.now() - t0);
      log.llm({ model: llmConfig.model, baseUrl: llmConfig.baseUrl, msgCount: messages.length, stream: true, durationMs: Date.now() - t0, responseChars: fullResponse.length });

      const parsed    = npcEngine.parseSpawnResponse(fullResponse);
      const sess      = sessionMgr.getSession(sessionId);
      if (!sess) return;

      const stored = npcEngine.storeNPC(sess.statData, parsed, spawn);
      sessionMgr.saveSession(sess);
      log.shop('NARRATIVE_SPAWN', `Stored "${stored.name}" (${stored.tier}★ ${stored.type}) → ${worldKey}.NPCs`);

    } catch (err) {
      log.error(`NarrativeSpawn "${spawnName}" failed: ${err.message}`);
    }
  }
}

module.exports = { runStreamTurn, processNarrativeGrantsAsync, processNarrativeSpawnsAsync, parseSystemGrantTags, parseSystemSpawnTags };
