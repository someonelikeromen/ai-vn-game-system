'use strict';
/**
 * Prompt Builder — assembles the full message array sent to the LLM.
 *
 * Message structure per turn:
 *   [0] system  — preset prompts (stops BEFORE "nsfw") + world book pos:0/1 entries + char info
 *   [1..N-2]    — chat history (alternating user/assistant)
 *   [N-1] user  — world book pos:4 depth:0 entries
 *                 + depth:0 UpdateVariable injection (live snapshot)
 *                 + "nsfw" prompt (closes </Information>, wraps user input in <input>)
 *                 + all preset prompts AFTER "nsfw" (format_settings, CoT, output_format…)
 *   [N] asst    — assistant prefill (role:'assistant' prompts, e.g. "<think>")
 */

const { buildStatSnapshot, renderBackendDataStream } = require('./varEngine');

// ─── Template Variable Substitution ──────────────────────────────────────────

/**
 * Replace SillyTavern template vars with real values.
 */
function substituteVars(text, vars = {}) {
  return text
    .replace(/\{\{char\}\}/gi, vars.charName || '')
    .replace(/\{\{user\}\}/gi, vars.userName || 'User')
    .replace(/\{\{original\}\}/g, vars.original || '')
    .replace(/<user>/g, vars.userName || 'User')
    // {{lastUserMessage}} — used by the "nsfw" closing prompt to wrap user input
    .replace(/\{\{lastUserMessage\}\}/gi, vars.lastUserMessage || '')
    // Strip getvar/setvar macros (they're SillyTavern-specific)
    .replace(/\{\{getvar::[^}]+\}\}/g, '')
    .replace(/\{\{setvar::[^}]+::[^}]*\}\}/g, '')
    // Strip comment blocks {{//...}}
    .replace(/\{\{\/\/[\s\S]*?\}\}/g, '')
    // Strip random/roll macros
    .replace(/\{\{random::[^}]+\}\}/g, '')
    .replace(/\{\{roll[^}]+\}\}/g, '');
}

// ─── Phase Assignment Helpers ─────────────────────────────────────────────────

/**
 * Determine which generation phases a worldbook entry should inject into.
 *
 * Priority:
 *   1. Explicit `entry.phases` array (set via `_phases` in worldbook.js raw data)
 *   2. Derived from extPosition / insertionOrder / content
 *
 * Default derivation rules:
 *   extPosition 0 or 1 (world lore → system msg)  → [1, 3]
 *   extPosition 4, depth 0:
 *     • snapshot entry (contains <status_current_variables>)  → [3, 4] (handled specially)
 *     • insertionOrder >= 990 (update rules)                  → [4]
 *     • insertionOrder <  990 (meta/narrative rules)          → [3]
 *   anything else                                             → [1, 3]
 *
 * @param {object} entry - Game-engine format entry from charCard.worldBook
 * @returns {number[]}
 */
function getEntryPhases(entry) {
  if (Array.isArray(entry.phases)) return entry.phases;

  if (entry.extPosition === 0 || entry.extPosition === 1) return [1, 3];

  if (entry.extPosition === 4 && entry.depth === 0) {
    if ((entry.content || '').includes('<status_current_variables>')) return [3, 4];
    return (entry.insertionOrder || 0) >= 990 ? [4] : [3];
  }

  return [1, 3];
}

/**
 * Returns true if `entry` should be injected in the given `phase`.
 */
function entryForPhase(entry, phase) {
  return getEntryPhases(entry).includes(phase);
}

/**
 * Returns true if a preset prompt `p` should be injected in the given `phase`.
 * If `p._phases` is not set or empty, the prompt has no phase restriction (returns true).
 */
function promptForPhase(p, phase) {
  if (!Array.isArray(p._phases) || p._phases.length === 0) return true;
  return p._phases.includes(phase);
}

// ─── System Prompt Assembly ───────────────────────────────────────────────────

// IDs that should never be injected into the system prompt
const SKIP_PROMPT_IDS = new Set([
  '8b4c6b33-5301-436c-85e0-bf9fcc00e52c', // 说明 (doc/readme)
  '27a96df0-df6b-44ea-8bca-76881bf766be', // 初始化变量 (init vars, only used once)
  'chatHistory',       // conversation history — injected separately in buildContextWindow
  'dialogueExamples',  // example dialogues — skip for now
  'enhanceDefinitions',
]);

/**
 * Build the system message from preset prompts + char card + world book.
 *
 * STOPS at the "nsfw" prompt (identifier: 'nsfw').  Everything from "nsfw"
 * onward (format_settings, CoT, output_format…) belongs in the LAST USER
 * MESSAGE — see buildUserSuffix().
 *
 * @param {object}  preset
 * @param {object}  charCard
 * @param {object}  userPersona
 * @param {object}  vars        - Extra substitution vars
 * @param {number|null} phase   - If set, filter world book entries by phase
 */
function buildSystemPrompt(preset, charCard, userPersona, vars = {}, phase = null) {
  const allVars = {
    charName: charCard.name,
    userName: userPersona?.name || 'User',
    ...vars,
  };

  const parts = [];

  for (const p of preset.prompts) {
    if (!p.enabled) continue;
    if (SKIP_PROMPT_IDS.has(p.identifier)) continue;
    // WB placeholder entries are injected via charCard.worldBook — skip here.
    if (p.identifier && p.identifier.startsWith('wb_')) continue;

    // "nsfw" is the pivot: it closes </Information> and wraps user input.
    // It and everything after it go into the last user message, not system.
    if (p.identifier === 'nsfw') break;

    if (p.marker) {
      switch (p.identifier) {
        case 'worldInfoBefore': {
          // World book entries with extPosition === 0 (before char desc)
          // pos:4 "at depth" entries are intentionally excluded here — they
          // go into the last user message via buildUserSuffix().
          const entries = charCard.worldBook
            .filter((e) => e.constant && e.extPosition === 0 &&
              (phase === null || entryForPhase(e, phase)))
            .sort((a, b) => a.insertionOrder - b.insertionOrder);
          if (entries.length) parts.push(entries.map((e) => e.content).join('\n\n'));
          break;
        }
        case 'worldInfoAfter': {
          const entries = charCard.worldBook
            .filter((e) => e.constant && e.extPosition === 1 &&
              (phase === null || entryForPhase(e, phase)))
            .sort((a, b) => a.insertionOrder - b.insertionOrder);
          if (entries.length) parts.push(entries.map((e) => e.content).join('\n\n'));
          break;
        }
        case 'charDescription':
          if (charCard.description) parts.push(charCard.description);
          break;
        case 'charPersonality':
          if (charCard.personality) parts.push(charCard.personality);
          break;
        case 'scenario':
          if (charCard.scenario) parts.push(charCard.scenario);
          break;
        case 'personaDescription': {
          const adminBlock = buildAdminBlock(userPersona, preset.prompts, allVars);
          if (adminBlock) parts.push(adminBlock);
          break;
        }
        default:
          break;
      }
    } else {
      if (p.role && p.role !== 'system') continue;
      if (p.identifier === 'user') continue;

      const text = substituteVars(p.content, allVars).trim();
      if (text) parts.push(text);
    }
  }

  // Note: we do NOT auto-close <Information> here.
  // The "nsfw" prompt handles </history></Information> in the user message.
  return parts.filter(Boolean).join('\n\n');
}

function buildAdminBlock(userPersona, enabledPrompts, allVars) {
  const userPromptEntry = enabledPrompts.find((p) => p.identifier === 'user');
  let header = '';
  if (userPromptEntry) {
    header = substituteVars(userPromptEntry.content, allVars).trim();
  } else {
    header = `<Admin>\n${allVars.userName || 'User'}是Master在故事中的设定。`;
  }

  const descParts = [
    userPersona.alignment && `"${userPersona.alignment}"`,
    userPersona.traits && `"${userPersona.traits}"`,
    userPersona.description,
  ].filter(Boolean);

  return header + '\n' + descParts.join('\n') + '\n用户设定已结束\n</Admin>';
}

// ─── Depth-0 World Book Injection ─────────────────────────────────────────────

/**
 * Build the UpdateVariable injection block (world book entry depth:0, pos:4).
 * Replaces the placeholder <status_current_variables> with the live snapshot,
 * and preserves both the header (instructions) AND the footer (format rules).
 */
function buildDepthInjection(charCard, statData) {
  // Identify the snapshot entry by the placeholder tag, not by 'UpdateVariable',
  // so that split rule/example entries (which may also reference UpdateVariable)
  // are not mistakenly consumed here.
  const updateRulesEntry = charCard.worldBook.find(
    (e) => e.constant && e.depth === 0 && e.content.includes('<status_current_variables>')
  );

  if (!updateRulesEntry) return '';

  const rawContent = updateRulesEntry.content;
  const OPEN_TAG   = '<status_current_variables>';
  const CLOSE_TAG  = '</status_current_variables>';

  const tagStart = rawContent.indexOf(OPEN_TAG);
  const tagEnd   = rawContent.indexOf(CLOSE_TAG);

  const header = (tagStart >= 0 ? rawContent.substring(0, tagStart) : rawContent).trim();
  const footer = (tagEnd   >= 0 ? rawContent.substring(tagEnd + CLOSE_TAG.length) : '').trim();

  const snapshot     = buildStatSnapshot(statData);
  const snapshotJson = JSON.stringify(snapshot, null, 2);

  // Append SystemGrant + SystemSpawn tag definitions alongside UpdateVariable rules
  const systemGrantDef = `

---

## SystemGrant — 剧情物品/能力授予标签

当叙事中角色**确实获得**某件物品、能力或技法时（非描述性、非假设性），在 \`<UpdateVariable>\` 之后额外附加 \`<SystemGrant>\` 标签，触发商城生成系统将其正式录入。

**格式（JSON 体）**：
\`\`\`
<SystemGrant>{"name": "物品/能力名称", "description": "详细描述（来源、效果、背景，越详细越好）", "type": "PassiveAbility|PowerSource|ApplicationTechnique|Inventory|Knowledge|Companion|Mech", "sourceWorld": "来源世界（省略则使用当前世界）"}</SystemGrant>
\`\`\`

**使用规则**：
- 只在角色**实际获得**时才发出（不用于描述、期待或失败情境）
- 每次最多 1-2 个标签，避免滥用
- 若物品已在 \`<UpdateVariable>\` 中写入了完整属性，仍需同时发出 \`<SystemGrant>\` 以触发商城录入
- description 应包含：原作名称、核心效果、获取方式、相关限制等关键信息

---

## SystemSpawn — 实体登场标签

当叙事中出现**有名称或明确身份的NPC、怪物或Boss**时（首次遭遇或重要战斗），在 \`<UpdateVariable>\` 之后额外附加 \`<SystemSpawn>\` 标签，触发系统生成该实体的完整战斗档案与人格模型，存入世界NPC档案库。

**格式（JSON 体）**：
\`\`\`
<SystemSpawn>{"name": "实体名称", "description": "详细描述（外貌、来源、已知能力，越详细越好）", "type": "Monster|NPC|Boss", "sourceWorld": "来源世界（省略则使用当前世界）", "hostile": true, "location": "遭遇地点"}</SystemSpawn>
\`\`\`

**使用规则**：
- type 说明：**Monster** = 野生生物/无人格敌人；**NPC** = 有名有姓的人物/智慧生命；**Boss** = 头目/关键敌对角色（生成更详细的人格模型）
- **hostile**：若对主角友好/中立则填 \`false\`，敌对则填 \`true\`
- 只在实体**实际出现**于叙事场景时触发（非背景提及、非历史描述）
- 每次最多 1-2 个标签；已有档案的实体（在世界NPC列表中）可跳过
- description 应包含：外貌特征、已展示能力、行为模式、与主角关系等已知信息`;

  return (
    header +
    '\n\n<status_current_variables>\n' +
    snapshotJson +
    '\n</status_current_variables>' +
    (footer ? '\n' + footer : '') +
    systemGrantDef
  );
}

// ─── Last User Message Assembly ───────────────────────────────────────────────

/**
 * Build the content of the LAST USER MESSAGE.
 *
 * Order (mirrors SillyTavern's injection for this preset):
 *   1. World book entries with pos:4, depth:0 — EXCEPT the UpdateVariable
 *      entry (sorted by insertion_order).  These include the meta-rules
 *      entry that SillyTavern injects at the top of the last user turn.
 *   2. UpdateVariable (depth-0) injection with live stat snapshot.
 *   3. "nsfw" preset prompt — closes </history></Information>, wraps the
 *      user's text in <input>{{lastUserMessage}}</input>, then starts the
 *      format_settings section.
 *   4. All subsequent enabled system-role prompts after "nsfw"
 *      (text_constraints, Chain_of_Thought, output_format…).
 *      Assistant-role prompts are skipped here (they go to the prefill).
 */
function buildUserSuffix(preset, charCard, statData, userPersona, userInput) {
  const vars = {
    charName: charCard.name,
    userName: userPersona?.name || 'User',
    lastUserMessage: userInput,
  };

  const parts = [];

  // ── 1. World book pos:4, depth:0 entries (all except the snapshot entry) ──
  // Only the entry with <status_current_variables> is excluded here (it is
  // processed by buildDepthInjection with the live JSON snapshot instead).
  const inlineEntries = charCard.worldBook
    .filter((e) => (
      e.constant &&
      e.extPosition === 4 &&
      e.depth === 0 &&
      !e.content.includes('<status_current_variables>')
    ))
    .sort((a, b) => (a.insertionOrder || 0) - (b.insertionOrder || 0));

  for (const entry of inlineEntries) {
    if (entry.content) parts.push(entry.content.trim());
  }

  // ── 2. Depth-0 injection (UpdateVariable with live snapshot) ──────────────
  const depthInjection = buildDepthInjection(charCard, statData);
  if (depthInjection) parts.push(depthInjection);

  // ── 3 & 4. "nsfw" prompt + all enabled system-role prompts after it ────────
  let afterNsfw = false;
  for (const p of preset.prompts) {
    if (!p.enabled) continue;
    // WB placeholder entries are injected via charCard.worldBook — skip here.
    if (p.identifier && p.identifier.startsWith('wb_')) continue;
    if (p.identifier === 'nsfw') afterNsfw = true;
    if (!afterNsfw) continue;

    if (p.marker) continue;
    if (p.role === 'assistant') continue; // assistant prompts go to prefill

    const text = substituteVars(p.content, vars).trim();
    if (text) parts.push(text);
  }

  return parts.filter(Boolean).join('\n\n');
}

// ─── Backend Data Stream (depth:4) ────────────────────────────────────────────

/**
 * Build the "Backend Data Stream" injection for depth:4 entries.
 * Only inserted when there are 4+ messages in history.
 */
function buildBackendDataInjection(statData, historyLength) {
  if (historyLength < 4) return null;
  return renderBackendDataStream(statData);
}

// ─── Full Context Window ──────────────────────────────────────────────────────

/**
 * Build the complete messages array for the LLM.
 *
 * @param {object} preset       - Loaded preset
 * @param {object} charCard     - Loaded character card
 * @param {object} statData     - Current variable state
 * @param {Array}  history      - [{role, content, rawContent?}]
 * @param {object} userPersona  - { name, alignment, traits, description }
 * @param {string} userInput    - Current user turn text
 * @returns {Array<{role,content}>}
 */
function buildContextWindow(preset, charCard, statData, history, userPersona, userInput) {
  const messages = [];

  // ── System message (stops before "nsfw") ──────────────────────────────────
  const systemContent = buildSystemPrompt(preset, charCard, userPersona);
  messages.push({ role: 'system', content: systemContent });

  // ── History messages ───────────────────────────────────────────────────────
  for (const msg of history) {
    messages.push({
      role: msg.role,
      content: msg.promptContent ?? msg.content,
    });
  }

  // ── Depth-4 backend data stream (inject before last user turn) ────────────
  const backendData = buildBackendDataInjection(statData, history.length);
  if (backendData) {
    messages.push({ role: 'system', content: backendData });
  }

  // ── Last user message ──────────────────────────────────────────────────────
  // Contains: pos:4 world book entries → depth injection → nsfw → format prompts
  const lastUserContent = buildUserSuffix(preset, charCard, statData, userPersona, userInput);
  messages.push({ role: 'user', content: lastUserContent });

  // ── Assistant prefill ──────────────────────────────────────────────────────
  const prefillVars = { charName: charCard.name, userName: userPersona?.name || 'User' };
  const prefillParts = preset.prompts
    .filter((p) => p.enabled && p.role === 'assistant' && !p.marker && p.content.trim())
    .map((p) => substituteVars(p.content, prefillVars).trim())
    .filter(Boolean);

  if (prefillParts.length) {
    messages.push({ role: 'assistant', content: prefillParts.join('\n') });
  } else if (preset.assistantPrefill && preset.assistantPrefill.trim()) {
    messages.push({ role: 'assistant', content: preset.assistantPrefill });
  }

  return messages;
}

/**
 * Build the initial messages for a new game session.
 * Sends [Start a new chat] → model returns the first_mes / greeting.
 */
function buildInitMessages(preset, charCard, statData, userPersona, greetingIndex = -1) {
  const systemContent = buildSystemPrompt(preset, charCard, userPersona);

  const messages = [
    { role: 'system', content: systemContent },
    { role: 'user', content: '[Start a new chat]' },
  ];

  const greeting =
    greetingIndex >= 0
      ? charCard.alternateGreetings[greetingIndex]
      : charCard.firstMessage;

  if (greeting) {
    messages.push({ role: 'assistant', content: greeting });
  }

  return messages;
}

// ─── Multi-Phase Prompt Builders ─────────────────────────────────────────────

/**
 * Phase 1 — Planning / Outline Generation.
 *
 * Uses the SAME full context structure as Phase 3 (system prompt, lore,
 * char description, 5-round history, full state snapshot, CoT prompts),
 * but replaces the narrative output instruction with the ID-65 planning
 * atom (which asks for JSON outline only).
 *
 * Key differences from Phase 3:
 *   - System prompt filters entries for phase=1  (default: same lore)
 *   - History window: last 5 rounds (10 messages), no anchor truncation
 *   - User suffix: only phase-1 worldbook entries (ID 65) + snapshot
 *     + nsfw/format prompts + ID-65 planning output atom at the END
 *   - Meta-Rules (IDs 43-50, order<990): excluded (phase [3] only)
 *   - Update Rules (IDs 51-64, order>=990): excluded (phase [4] only)
 *
 * Expected response after </think>:
 * { "outline": [...], "logQueryTerms": [...], "reqCharUpdate": bool, "reqItemUpdate": ["道具（子系统）", ...] }
 *
 * @param {object} preset
 * @param {object} charCard
 * @param {object} statData
 * @param {Array}  prevHistory    - Full previous history (before current user msg)
 * @param {object} userPersona
 * @param {string} userInput
 */
function buildPhase1Messages(preset, charCard, statData, prevHistory, userPersona, userInput) {
  const messages = [];

  // ── System message (phase-1 filtered, same structure as Phase 3) ─────────
  messages.push({ role: 'system', content: buildSystemPrompt(preset, charCard, userPersona, {}, 1) });

  // ── History: last 5 rounds (10 messages), no anchor splitting ────────────
  const PHASE1_ROUNDS = 5;
  const p1History = prevHistory.slice(-(PHASE1_ROUNDS * 2));
  for (const msg of p1History) {
    messages.push({ role: msg.role, content: msg.promptContent ?? msg.content });
  }

  // ── Backend data stream (always inject in Phase 1, regardless of length) ─
  const { renderBackendDataStream } = require('./varEngine');
  const backendStream = renderBackendDataStream(statData);
  if (backendStream) messages.push({ role: 'system', content: backendStream });

  // ── User message ──────────────────────────────────────────────────────────
  const vars = {
    charName:        charCard.name,
    userName:        userPersona?.name || 'User',
    lastUserMessage: userInput,
  };
  const parts = [];

  // Phase-1 worldbook inline entries (extPos=4, depth=0, entryForPhase==1)
  // Excludes: Meta-Rules (phase [3] only), Update Rules (phase [4] only)
  // Includes: any entry explicitly tagged _phases: [1] or [1, ...]
  // NOTE: ID-65 (the planning atom, order=1009) is the only entry here by default.
  //       It will be appended AFTER the format prompts (see below).
  const phase1WbEntries = charCard.worldBook
    .filter(e =>
      e.constant &&
      e.extPosition === 4 &&
      e.depth === 0 &&
      !e.content.includes('<status_current_variables>') &&
      entryForPhase(e, 1) &&
      !entryForPhase(e, 3) // purely Phase-1-exclusive (not shared with Phase 3)
    )
    .sort((a, b) => (a.insertionOrder || 0) - (b.insertionOrder || 0));

  // Entries shared between Phase 1 and 3 that also belong to Phase 1
  // (i.e., explicitly tagged [1,3] — currently none by default, but possible)
  const sharedEntries = charCard.worldBook
    .filter(e =>
      e.constant &&
      e.extPosition === 4 &&
      e.depth === 0 &&
      !e.content.includes('<status_current_variables>') &&
      entryForPhase(e, 1) &&
      entryForPhase(e, 3)  // shared Phase 1+3 entries go in normal order
    )
    .sort((a, b) => (a.insertionOrder || 0) - (b.insertionOrder || 0));

  for (const entry of sharedEntries) {
    if (entry.content) parts.push(entry.content.trim());
  }

  // Full state snapshot (read-only in Phase 1 — no update instruction)
  const snapshotOnly = buildDepthInjectionSnapshotOnly(charCard, statData);
  if (snapshotOnly) parts.push(snapshotOnly);

  // nsfw + all format prompts (CoT, Chain_of_Thought, output_format, etc.)
  // These are the same prompts as Phase 3 — CoT does the planning thinking.
  let afterNsfw = false;
  for (const p of preset.prompts) {
    if (!p.enabled) continue;
    if (p.identifier && p.identifier.startsWith('wb_')) continue;
    if (p.identifier === 'nsfw') afterNsfw = true;
    if (!afterNsfw) continue;
    if (p.marker) continue;
    if (p.role === 'assistant') continue;
    if (!promptForPhase(p, 1)) continue;
    const text = substituteVars(p.content, vars).trim();
    if (text) parts.push(text);
  }

  // ── Phase-1-exclusive atoms appended LAST (after format prompts) ──────────
  // ID 65 (planning output instruction) overrides the narrative output format.
  for (const entry of phase1WbEntries) {
    if (entry.content) parts.push(entry.content.trim());
  }

  messages.push({ role: 'user', content: parts.filter(Boolean).join('\n\n') });

  // ── Assistant prefill (same as Phase 3 — enables CoT) ────────────────────
  const prefillVars = { charName: charCard.name, userName: userPersona?.name || 'User' };
  const prefillParts = preset.prompts
    .filter(p => p.enabled && p.role === 'assistant' && !p.marker && p.content.trim() && promptForPhase(p, 1))
    .map(p => substituteVars(p.content, prefillVars).trim())
    .filter(Boolean);

  if (prefillParts.length) {
    messages.push({ role: 'assistant', content: prefillParts.join('\n') });
  } else if (preset.assistantPrefill?.trim()) {
    messages.push({ role: 'assistant', content: preset.assistantPrefill });
  }

  return messages;
}

/**
 * Phase 3 — Main Narrative Generation.
 *
 * Identical to `buildContextWindow`, with three additions injected as
 * an extra system message immediately before the last user turn:
 *   1. Phase 1 outline (planning reference)
 *   2. Phase 2 retrieved logs (RAG context)
 *
 * Also suppresses UpdateVariable rules (insertion_order >= 990) from
 * the user suffix — those go to Phase 4 instead. In their place, a
 * one-line deferral notice is injected.
 *
 * @param {object} preset
 * @param {object} charCard
 * @param {object} statData
 * @param {Array}  history
 * @param {object} userPersona
 * @param {string} userInput
 * @param {{ outline: string[], retrievedLogs: object }} phaseContext
 */
function buildPhase3Messages(preset, charCard, statData, history, userPersona, userInput, phaseContext = {}) {
  const messages = [];

  // ── System message (phase-3 filtered) ────────────────────────────────────
  messages.push({ role: 'system', content: buildSystemPrompt(preset, charCard, userPersona, {}, 3) });

  // ── History ───────────────────────────────────────────────────────────────
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.promptContent ?? msg.content });
  }

  // ── Backend data stream (depth:4) ─────────────────────────────────────────
  const backendData = buildBackendDataInjection(statData, history.length);
  if (backendData) messages.push({ role: 'system', content: backendData });

  // ── Phase context injection (outline + retrieved logs) ────────────────────
  const phaseContextParts = [];

  if (phaseContext.outline?.length) {
    phaseContextParts.push(
      '【第一阶段规划大纲（仅供参考，可酌情调整）】\n' +
      phaseContext.outline.map((s, i) => `${i + 1}. ${s}`).join('\n')
    );
  }

  const { formatRetrievedLogs, formatCombatData } = require('./ragEngine');
  if (phaseContext.retrievedLogs && Object.keys(phaseContext.retrievedLogs).length > 0) {
    const formatted = formatRetrievedLogs(phaseContext.retrievedLogs);
    if (formatted) {
      phaseContextParts.push('【相关历史记录片段（从世界日志中检索）】\n' + formatted);
    }
  }

  // Combat entity data from Phase 2 PowerSystems extraction
  if (phaseContext.combatData) {
    const combatFormatted = formatCombatData(phaseContext.combatData);
    if (combatFormatted) {
      phaseContextParts.push(combatFormatted);
    }
  }

  // Phase 2 evaluated items (reqItemUpdate batch results) — narrative context
  if (Array.isArray(phaseContext.evaluatedItems) && phaseContext.evaluatedItems.length > 0) {
    const lines = phaseContext.evaluatedItems.map((item, i) => {
      const tier = item.tier ?? '?';
      const type = item.type || '?';
      const desc = item.description ? `：${item.description.slice(0, 80)}` : '';
      return `${i + 1}. **${item.name}**（${tier}★ | ${type}）${desc}`;
    });
    phaseContextParts.push(
      '【本回合预计涉及的道具/能力（Phase 2 商城评估结果）】\n' +
      lines.join('\n') + '\n' +
      '（以上物品已评估入库，叙事中若确实发生获取/变更，第四阶段将写入变量）'
    );
  }

  if (phaseContextParts.length > 0) {
    messages.push({ role: 'system', content: phaseContextParts.join('\n\n') });
  }

  // ── Last user message (UpdateVariable rules suppressed) ───────────────────
  const vars = {
    charName:        charCard.name,
    userName:        userPersona?.name || 'User',
    lastUserMessage: userInput,
  };
  const parts = [];

  // Phase-3 entries only (meta-rules [3], shared [1,3]); excludes update rules [4] and Phase-1-only [1]
  const inlineEntries = charCard.worldBook
    .filter(e =>
      e.constant &&
      e.extPosition === 4 &&
      e.depth === 0 &&
      !e.content.includes('<status_current_variables>') &&
      entryForPhase(e, 3) && !entryForPhase(e, 4)  // Phase 3 but not update rules
    )
    .sort((a, b) => (a.insertionOrder || 0) - (b.insertionOrder || 0));

  for (const entry of inlineEntries) {
    if (entry.content) parts.push(entry.content.trim());
  }

  // State snapshot (keep for situational awareness, but omit "please update" header)
  const snapshotOnly = buildDepthInjectionSnapshotOnly(charCard, statData);
  if (snapshotOnly) parts.push(snapshotOnly);

  // Deferral notice — replaces the full update instruction block
  parts.push(
    '【第三阶段】请生成本回合的叙事正文和选项。' +
    '**变量更新块（<UpdateVariable>）将在第四阶段单独生成，本阶段请勿输出 UpdateVariable 或 SystemGrant 标签。**'
  );

  // nsfw + format prompts (same as normal buildUserSuffix)
  let afterNsfw = false;
  for (const p of preset.prompts) {
    if (!p.enabled) continue;
    if (p.identifier && p.identifier.startsWith('wb_')) continue;
    if (p.identifier === 'nsfw') afterNsfw = true;
    if (!afterNsfw) continue;
    if (p.marker) continue;
    if (p.role === 'assistant') continue;
    if (!promptForPhase(p, 3)) continue;
    const text = substituteVars(p.content, vars).trim();
    if (text) parts.push(text);
  }

  messages.push({ role: 'user', content: parts.filter(Boolean).join('\n\n') });

  // ── Assistant prefill ─────────────────────────────────────────────────────
  const prefillVars = { charName: charCard.name, userName: userPersona?.name || 'User' };
  const prefillParts = preset.prompts
    .filter(p => p.enabled && p.role === 'assistant' && !p.marker && p.content.trim() && promptForPhase(p, 3))
    .map(p => substituteVars(p.content, prefillVars).trim())
    .filter(Boolean);

  if (prefillParts.length) {
    messages.push({ role: 'assistant', content: prefillParts.join('\n') });
  } else if (preset.assistantPrefill?.trim()) {
    messages.push({ role: 'assistant', content: preset.assistantPrefill });
  }

  return messages;
}

/**
 * Snapshot-only depth injection (no "please generate UpdateVariable" header).
 * Used in Phase 3 where we still need the state but not the update instruction.
 */
function buildDepthInjectionSnapshotOnly(charCard, statData) {
  const entry = charCard.worldBook.find(
    e => e.constant && e.depth === 0 && e.content.includes('<status_current_variables>')
  );
  if (!entry) return '';

  const { buildStatSnapshot } = require('./varEngine');
  const snapshot     = buildStatSnapshot(statData);
  const snapshotJson = JSON.stringify(snapshot, null, 2);

  return (
    '【当前变量快照（状态参考，本阶段不输出更新）】\n' +
    '<status_current_variables>\n' +
    snapshotJson +
    '\n</status_current_variables>'
  );
}

/**
 * Phase 4 — UpdateVariable Generation.
 *
 * Focused prompt that takes the Phase 3 narrative and asks the LLM to
 * output ONLY the <UpdateVariable> block.
 *
 * System:
 *   - Update rules (worldbook entries insertion_order >= 990, excluding
 *     the snapshot entry itself which is not an "instruction")
 *   - Current statData snapshot
 *
 * User:
 *   - Phase 3 full narrative
 *   - Instruction to output only the update block
 *
 * @param {object} charCard
 * @param {object} statData
 * @param {string} narrative   - Full text from Phase 3
 */
/**
 * Build the world time synchronization prompt block for Phase 4.
 * LLM is only responsible for the current world's elapsed seconds + narrative date.
 * Server handles propagation to all other worlds via propagateWorldTime().
 */
function buildTimeSyncBlock(statData) {
  const mv = statData?.Multiverse;
  if (!mv?.Archives) return '';

  const curKey = Array.isArray(mv.CurrentWorldName) ? mv.CurrentWorldName[0] : mv.CurrentWorldName;
  if (!curKey || !mv.Archives[curKey]) return '';

  const cur = mv.Archives[curKey];
  const tf  = cur.TimeFlow;

  // Build flow rate label
  let flowLabel = '1:1（与主世界同步）';
  if (tf) {
    if (tf.type === 'frozen')         flowLabel = '冻结（时间静止）';
    else if (tf.type === 'fixed_interval') flowLabel = `固定跳跃：每次进入 +${tf.fixedJump || '?'}`;
    else if (tf.type === 'hybrid')    flowLabel = tf.description || '复合规则';
    else {
      const r = tf.ratioToBase || '1:1';
      const parts = r.split(':').map(s => s.trim());
      flowLabel = parts[0] === parts[1] ? `${r}（与主世界同步）` : `${r}（基准${parts[0]}秒=此世界${parts[1]}秒）`;
    }
  }

  const curDate  = Array.isArray(cur.Time?.Date)  ? cur.Time.Date[0]  : (cur.Time?.Date  || '?');
  const curClock = Array.isArray(cur.Time?.Clock) ? cur.Time.Clock[0] : (cur.Time?.Clock || '?');
  const totalSec = cur.Time?.TotalSeconds || 0;
  const justEntered = cur.Time?.JustEntered === true;

  // Escape world key for use in path (handles special chars like colons, spaces)
  const escapedKey = curKey.includes('"') ? curKey.replace(/"/g, '\\"') : curKey;
  const pathKey    = `"${escapedKey}"`;

  if (justEntered) {
    const fixedJumpNote = tf?.type === 'fixed_interval'
      ? `\n⚡ 本次入境时间跳跃：${tf.fixedJump || '?'}，请将跳跃量一并计入流逝秒数。` : '';
    return [
      '---',
      '',
      '【世界时间同步任务（必须执行）】',
      `⚠️ 你刚刚进入此世界（${curKey}）。`,
      `系统时钟：${curClock}（已根据其他世界行动自动推进，累计 ${totalSec} 秒）`,
      `上次记录日期：${curDate}`,
      `时间流速：${flowLabel}`,
      fixedJumpNote,
      '',
      '请在 <UpdateVariable> 中完成以下两项：',
      '',
      '1. 根据系统时钟和上次记录日期，计算当前实际日期并更新（必须）：',
      `   _.set('Multiverse.Archives[${pathKey}].Time.Date', ["新日期描述", "Date"])`,
      '',
      '2. 估算进入本世界这一刻的流逝秒数（含入境跳跃 + 本回合行动时间，精确到秒，最少1秒）：',
      `   _.set('Multiverse.CurrentWorldElapsedSeconds', <整数>)`,
      '',
      '禁止输出 Time.Clock（系统自动生成）。',
    ].join('\n');
  }

  return [
    '---',
    '',
    '【世界时间同步任务（必须执行）】',
    `当前世界：${curKey} | 时间流速：${flowLabel}`,
    `当前时刻：${curDate} ${curClock}`,
    '',
    '请在 <UpdateVariable> 中完成以下操作：',
    '',
    '1. 估算本回合当前世界流逝了多少秒（精确到秒，最少1秒）：',
    `   _.set('Multiverse.CurrentWorldElapsedSeconds', <整数>)`,
    '   参考：日常对话约300~1200秒，战斗约60~1800秒，旅行按叙事时长估算。',
    '',
    '2. 若叙事中发生跨天日期变化，更新叙事日期（无变化可省略）：',
    `   _.set('Multiverse.Archives[${pathKey}].Time.Date', ["新日期描述", "Date"])`,
    '',
    '禁止输出 Time.Clock（系统自动生成）。',
  ].join('\n');
}

/**
 * @param {object}   charCard
 * @param {object}   statData
 * @param {string}   narrative      - Full text from Phase 3
 * @param {object[]} evaluatedItems - Items evaluated in Phase 2 (reqItemUpdate results); may be empty
 */
function buildPhase4Messages(charCard, statData, narrative, evaluatedItems = []) {
  const { buildStatSnapshot } = require('./varEngine');
  const snapshot = buildStatSnapshot(statData);

  // Phase-4 entries: update rules (phase [4] only, excluding snapshot entry)
  const updateRuleEntries = charCard.worldBook
    .filter(e =>
      e.constant &&
      e.extPosition === 4 &&
      e.depth === 0 &&
      entryForPhase(e, 4) &&
      !e.content.includes('<status_current_variables>')
    )
    .sort((a, b) => (a.insertionOrder || 0) - (b.insertionOrder || 0));

  const ruleText = updateRuleEntries.map(e => e.content).join('\n\n');

  const timeSyncBlock = buildTimeSyncBlock(statData);

  // Build evaluated items block for P4 — instructs LLM to emit <SystemRedeemItem> tags
  // for items actually obtained, rather than manually writing effects (shop pipeline handles that)
  let itemsBlock = '';
  if (Array.isArray(evaluatedItems) && evaluatedItems.length > 0) {
    const itemLines = evaluatedItems.map((item, i) => {
      const tier = item.tier ?? '?';
      const type = item.type || '?';
      const desc = item.description ? `：${item.description.slice(0, 80)}` : '';
      return `${i + 1}. **${item.name}**（${tier}★ | ${type}）${desc}`;
    }).join('\n');

    itemsBlock = [
      '',
      '---',
      '',
      '【本回合商城已评估物品（reqItemUpdate Phase 2 结果）】',
      '系统已为以下物品生成完整的兑换数据（effects/attributes/能量池等），无需在 <UpdateVariable> 中手动写入：',
      '',
      itemLines,
      '',
      '**操作规则**：',
      '- 若叙事确认角色**获得**了某物品 → 在 <UpdateVariable> 结束后另起一行输出：',
      '  `<SystemRedeemItem>物品名</SystemRedeemItem>`',
      '  系统将自动完成完整兑换（写入 Loadout、ShopInventory、属性加成、能量池等），无需重复写入',
      '- 若叙事确认角色**消耗/失去**了某物品 → 在 <UpdateVariable> 中用 _.remove 从对应 Loadout 字段删除',
      '- 若叙事中未实际发生变更（仅路过/提及）→ 不输出任何 SystemRedeemItem 标签',
    ].join('\n');
  }

  const system = [
    '你是《无限武库》变量更新引擎。',
    '根据本回合叙事内容和当前状态，生成精确的变量更新块。',
    '**只输出 <UpdateVariable>...</UpdateVariable>，不要输出任何其他内容（不要叙事、不要分析段落之外的文字）。**',
    '',
    '---',
    '',
    '【变量更新规则】',
    ruleText,
    '',
    '---',
    '',
    '【当前变量状态快照】',
    '<status_current_variables>',
    JSON.stringify(snapshot, null, 2),
    '</status_current_variables>',
    ...(timeSyncBlock ? [timeSyncBlock] : []),
    ...(itemsBlock ? [itemsBlock] : []),
  ].join('\n');

  const user = [
    '【本回合叙事内容】',
    narrative.slice(0, 6000), // cap to avoid token overflow
    '',
    '请根据以上叙事内容，严格按照上方的更新规则和当前状态快照，输出变量更新块。',
    '格式：',
    '<UpdateVariable>',
    '    <Analysis>（英文分析，简短）</Analysis>',
    '    _.set(...) / _.insert(...) / _.remove(...) / _.add(...)',
    '</UpdateVariable>',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user',   content: user   },
  ];
}

module.exports = {
  substituteVars,
  getEntryPhases,
  entryForPhase,
  buildSystemPrompt,
  buildDepthInjection,
  buildDepthInjectionSnapshotOnly,
  buildUserSuffix,
  buildBackendDataInjection,
  buildContextWindow,
  buildInitMessages,
  buildPhase1Messages,
  buildPhase3Messages,
  buildPhase4Messages,
};
