'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  currentSessionId: null,
  isLoading: false,
  streamAbortCtrl: null,
  streamingMsgEl: null,
  streamingText: '',
  statFloat: { visible: false },
  latestStatData: null,
};

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const chatArea       = $('chat-area');
const optionsPanel   = $('options-panel');
const inputBox       = $('input-box');
const sendBtn        = $('send-btn');
const stopBtn        = $('stop-btn');
const sessionList    = $('session-list');
const sessionName    = $('session-name');
const danmuLayer     = $('danmu-layer');
const toastContainer = $('toast-container');
const statFloat      = $('stat-float');
const statFloatBody  = $('stat-float-body');

// ─── Utilities ────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Render streaming text with live think-block support.
 * Completed <think>...</think> blocks become collapsible <details>.
 * An open (in-progress) <think> block shows an animated "思考中" indicator.
 *
 * Also handles the "prefill" case: if the text contains </think> but no
 * opening <think>, we treat everything before </think> as thinking content.
 */
function renderStreamingText(rawText) {
  // Strip UpdateVariable blocks and structural tags not meant for display
  let text = rawText
    .replace(/<UpdateVariable[\s\S]*?<\/UpdateVariable\s*>/gi, '')
    .replace(/<current_event>[\s\S]*?<\/current_event\s*>/gi, '')
    .replace(/<progress>[\s\S]*?<\/progress\s*>/gi, '')
    .replace(/<content>([\s\S]*?)<\/content\s*>/gi, '$1');

  // Normalise: if text has </think> but no opening <think>, prepend one so
  // the regex below can handle it uniformly.
  if (/<\/think>/i.test(text) && !/<think>/i.test(text)) {
    text = '<think>' + text;
  }

  // Replace completed think blocks with a placeholder
  const thinkBlocks = [];
  text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner) => {
    const idx = thinkBlocks.length;
    thinkBlocks.push(inner.trim());
    return `\x00THINK${idx}\x00`;
  });

  // Check for an open (unclosed) think block
  const openStart = text.lastIndexOf('<think>');
  let openThinkHtml = '';
  if (openStart >= 0) {
    const thinkContent = text.substring(openStart + 7);
    text = text.substring(0, openStart);
    openThinkHtml =
      `<details class="think-block think-streaming" open>` +
      `<summary>💭 思考中<span class="think-dots">…</span></summary>` +
      `<div class="think-content">${esc(thinkContent).replace(/\n/g, '<br>')}</div></details>`;
  }

  // Escape the main text
  let html = esc(text).replace(/\n/g, '<br>');

  // Restore completed think blocks as collapsible <details>
  thinkBlocks.forEach((content, idx) => {
    html = html.replace(
      `\x00THINK${idx}\x00`,
      `<details class="think-block"><summary>💭 思维链</summary>` +
      `<div class="think-content">${esc(content).replace(/\n/g, '<br>')}</div></details>`
    );
  });

  return html + openThinkHtml;
}

function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + '分钟前';
  if (d < 86400000) return Math.floor(d / 3600000) + '小时前';
  return Math.floor(d / 86400000) + '天前';
}

function toast(msg, type = 'info', duration = 3000) {
  if (window.UIFeedback) {
    window.UIFeedback.toast(msg, { type, duration });
    return;
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// ─── Session List ─────────────────────────────────────────────────────────────

async function refreshSessionList() {
  if (window.UIFeedback) {
    sessionList.innerHTML = window.UIFeedback.renderLoadingLines(4);
  }
  const sessions = await api('GET', '/sessions');
  sessionList.innerHTML = '';
  if (!sessions.length) {
    sessionList.innerHTML = window.UIFeedback
      ? window.UIFeedback.renderEmpty('暂无存档，点击左上角「＋」创建一个新游戏。')
      : '<div style="padding:10px;font-size:12px;color:var(--text3);text-align:center">暂无存档</div>';
    return;
  }
  sessions.forEach((s) => {
    const el = document.createElement('div');
    el.className = 'session-item' + (s.id === state.currentSessionId ? ' active' : '');
    el.dataset.id = s.id;
    el.innerHTML = `
      <div class="session-item-content">
        <div class="session-item-name">${esc(s.name)}</div>
        <div class="session-item-meta">${s.messageCount} 条消息 · ${timeAgo(s.updatedAt)}</div>
      </div>
      <button class="session-delete-btn" data-id="${esc(s.id)}" title="删除">✕</button>
    `;
    el.querySelector('.session-item-content').addEventListener('click', () => loadSession(s.id));
    el.querySelector('.session-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSession(s.id, s.name);
    });
    sessionList.appendChild(el);
  });
}

async function deleteSession(id, name) {
  const ok = window.UIFeedback
    ? await window.UIFeedback.confirmDanger({
        title: '删除存档',
        message: `确定删除「${name}」吗？此操作不可撤销。`,
        confirmText: '确认删除',
      })
    : confirm(`删除存档「${name}」？此操作不可撤销。`);
  if (!ok) return;
  try {
    await api('DELETE', `/sessions/${id}`);
    if (state.currentSessionId === id) {
      state.currentSessionId = null;
      sessionName.textContent = '未选择场景';
      chatArea.innerHTML = '<div id="welcome-screen" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:var(--text2);padding:40px;text-align:center"><h2 style="font-size:22px">无限武库 · AI 驱动游戏系统</h2><p style="font-size:14px">存档已删除，请选择或新建游戏。</p></div>';
      optionsPanel.innerHTML = '';
      disableInput();
    }
    await refreshSessionList();
    toast('存档已删除', 'success');
  } catch (e) {
    toast('删除失败: ' + e.message, 'error');
  }
}

// ─── Load Session ─────────────────────────────────────────────────────────────

async function loadSession(id) {
  try {
    const data = await api('GET', `/sessions/${id}`);
    state.currentSessionId = id;
    sessionName.textContent = data.name || id;

    chatArea.innerHTML = '';
    optionsPanel.innerHTML = '';

    const HIDDEN = ['[Start a new chat]', '[游戏开始]'];
    data.history.forEach((m, idx) => {
      if (m.role === 'user' && HIDDEN.includes(m.displayContent)) return;
      if (m.role === 'user') {
        appendUserMsg(m.displayContent || '', idx);
      } else {
        const cleanHtml = sanitizeDisplayHtml(m.html || '');
        appendAssistantBubble(cleanHtml, m.options || [], m.danmu || [], idx, m.displayContent || '');
      }
    });

    if (data.statData) updateStatData(data.statData);
    enableInput();
    refreshSessionList();
    scrollToBottom();

    // Check for pending shop purchase prefill (from shop page)
    applyPendingShopPrefill(id);
  } catch (e) {
    toast('加载存档失败: ' + e.message, 'error');
  }
}

/** Check localStorage for a pending shop purchase prefill and apply it to the input box. */
function applyPendingShopPrefill(sessionId) {
  try {
    const raw = localStorage.getItem('pendingShopPrefill');
    if (!raw) return;
    const data = JSON.parse(raw);
    // Only apply if within 10 minutes and matches current session (or any session if no match)
    const age = Date.now() - (data.ts || 0);
    if (age > 10 * 60 * 1000) { localStorage.removeItem('pendingShopPrefill'); return; }
    if (data.sessionId && data.sessionId !== sessionId) return;
    if (data.text) {
      inputBox.value = data.text;
      autoResize(inputBox);
      toast('已从商城填入兑换内容', 'info');
    }
    localStorage.removeItem('pendingShopPrefill');
  } catch (_) {}
}

/** Strip UpdateVariable and think tags from stored HTML */
function sanitizeDisplayHtml(html) {
  return html
    .replace(/&lt;UpdateVariable[\s\S]*?&lt;\/UpdateVariable\s*&gt;/gi, '')
    .replace(/<UpdateVariable[\s\S]*?<\/UpdateVariable\s*>/gi, '')
    .trim();
}

// ─── Chat Rendering ───────────────────────────────────────────────────────────

const HIDDEN_MSGS = ['[Start a new chat]', '[游戏开始]'];

function appendUserMsg(text, msgIdx = -1) {
  if (!text || HIDDEN_MSGS.includes(text)) return;
  const msg = document.createElement('div');
  msg.className = 'msg user';
  if (msgIdx >= 0) msg.dataset.msgIdx = msgIdx;
  msg.innerHTML = `
    <div class="msg-bubble">${esc(text).replace(/\n/g, '<br>')}</div>
    <div class="msg-meta">${new Date().toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' })}</div>
    <div class="msg-actions">
      <button class="msg-action-btn" data-action="edit">✎ 编辑</button>
      <button class="msg-action-btn msg-action-del" data-action="delete" title="删除本轮对话并回退状态">🗑 删除</button>
    </div>
  `;
  msg.querySelector('[data-action="edit"]').addEventListener('click', () => startEditMessage(msg));
  msg.querySelector('[data-action="delete"]').addEventListener('click', () => deleteMessage(msg));
  chatArea.appendChild(msg);
  scrollToBottom();
  return msg;
}

function makeAssistantActions(msg) {
  msg.querySelector('[data-action="regen"]').addEventListener('click', () => regenerateFrom(msg));
  msg.querySelector('[data-action="edit"]').addEventListener('click', () => startEditAIMessage(msg));
  msg.querySelector('[data-action="revar"]').addEventListener('click', () => reprocessVars(msg));
  msg.querySelector('[data-action="reregex"]').addEventListener('click', () => reprocessDisplay(msg));
  msg.querySelector('[data-action="delete"]').addEventListener('click', () => deleteMessage(msg));
}

const ASSISTANT_ACTIONS = `
  <button class="msg-action-btn" data-action="edit">✎ 编辑</button>
  <button class="msg-action-btn" data-action="regen">↺ 重发</button>
  <button class="msg-action-btn" data-action="revar" title="从本回合快照重新处理 UpdateVariable 块">↺ 重变量</button>
  <button class="msg-action-btn" data-action="reregex" title="重新应用正则管道（修复乱码/渲染问题）">↺ 重正则</button>
  <button class="msg-action-btn msg-action-del" data-action="delete" title="删除本轮对话并回退状态">🗑 删除</button>
`;

function appendAssistantBubble(html, options = [], danmu = [], msgIdx = -1, rawContent = '') {
  const msg = document.createElement('div');
  msg.className = 'msg assistant';
  if (msgIdx >= 0) msg.dataset.msgIdx = msgIdx;
  if (rawContent) msg.dataset.rawContent = rawContent;
  // Store options so deleteMessage can restore them on the previous turn
  msg.dataset.options = JSON.stringify(options);
  msg.innerHTML = `
    <div class="msg-bubble">${html}</div>
    <div class="msg-meta">泉此方</div>
    <div class="msg-actions">${ASSISTANT_ACTIONS}</div>
  `;
  makeAssistantActions(msg);
  chatArea.appendChild(msg);
  if (options.length) setOptions(options);
  if (danmu.length) danmu.forEach((d, i) => setTimeout(() => fireDanmu(d), i * 1200));
  scrollToBottom();
  return msg;
}

function createStreamingMsg() {
  const msg = document.createElement('div');
  msg.className = 'msg assistant streaming';
  msg.innerHTML = `
    <div class="msg-bubble"></div>
    <div class="msg-meta">泉此方</div>
    <div class="msg-actions">${ASSISTANT_ACTIONS}</div>
  `;
  makeAssistantActions(msg);
  chatArea.appendChild(msg);
  state.streamingMsgEl = msg;
  state.streamingText = '';
  scrollToBottom();
  return msg;
}

function appendLoadingDots() {
  const el = document.createElement('div');
  el.className = 'loading-dots';
  el.id = 'loading-indicator';
  el.innerHTML = '<span></span><span></span><span></span>';
  chatArea.appendChild(el);
  scrollToBottom();
  return el;
}

function removeLoadingDots() {
  const el = $('loading-indicator');
  if (el) el.remove();
}

// ─── Options ──────────────────────────────────────────────────────────────────

/**
 * Show up to 4 option buttons above the input area.
 * Clicking an option fills the input box (user can edit before sending).
 */
function setOptions(options) {
  optionsPanel.innerHTML = '';
  if (!options.length) return;

  // Restore collapsed state
  const collapsed = localStorage.getItem('optionsPanelCollapsed') === '1';
  if (collapsed) optionsPanel.classList.add('collapsed');
  else optionsPanel.classList.remove('collapsed');

  // Header row with hint + toggle button
  const header = document.createElement('div');
  header.className = 'options-header';

  const hint = document.createElement('span');
  hint.className = 'options-hint';
  hint.textContent = '选择行动（可修改后发送）';

  const toggle = document.createElement('button');
  toggle.className = 'options-toggle';
  toggle.textContent = '▾';
  toggle.title = '收起 / 展开';

  header.appendChild(hint);
  header.appendChild(toggle);
  optionsPanel.appendChild(header);

  const row = document.createElement('div');
  row.className = 'options-row';
  options.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt.label;
    btn.title = '点击填入输入框';
    btn.addEventListener('click', () => {
      inputBox.value = opt.value;
      autoResize(inputBox);
      inputBox.focus();
      inputBox.setSelectionRange(inputBox.value.length, inputBox.value.length);
    });
    row.appendChild(btn);
  });
  optionsPanel.appendChild(row);

  // Toggle collapse on header click
  header.addEventListener('click', () => {
    const isCollapsed = optionsPanel.classList.toggle('collapsed');
    localStorage.setItem('optionsPanelCollapsed', isCollapsed ? '1' : '0');
  });
}

function clearOptions() { optionsPanel.innerHTML = ''; }

// ─── Danmu ────────────────────────────────────────────────────────────────────

function fireDanmu(text) {
  const el = document.createElement('div');
  el.className = 'danmu-item';
  el.style.top = Math.floor(Math.random() * 60) + 'px';
  el.textContent = text;
  danmuLayer.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}

// ─── SSE Streaming Core ───────────────────────────────────────────────────────

/**
 * Read an SSE stream from `fetchPromise` into `streamMsg`.
 * Handles abort via state.streamAbortCtrl.
 * Returns finalData or null on abort.
 */
async function readSSEStream(fetchRes, streamMsg) {
  const bubble = streamMsg.querySelector('.msg-bubble');
  const reader = fetchRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalData = null;
  let currentEvent = '';

  // ── Phase progress indicator (multi-phase mode) ───────────────────────────
  // Created on demand when the first `phase` event arrives.
  let phaseBar = null;
  let phase4Banner = null;
  let hasNarrativeText = false;

  function ensurePhaseBar() {
    if (phaseBar) return;
    phaseBar = document.createElement('div');
    phaseBar.className = 'phase-progress-bar';
    bubble.prepend(phaseBar);
  }

  function updatePhaseBar(phase, label, status) {
    ensurePhaseBar();
    const icons = ['', '✦', '◈', '✧', '⟳'];
    const icon  = icons[phase] || '•';
    const cls   = status === 'done' ? 'done' : 'active';
    phaseBar.innerHTML =
      `<span class="phase-step ${cls}">${icon} 第${phase}阶段：${label}` +
      (status === 'done' ? ' ✓' : ' <span class="phase-dot-anim">…</span>') +
      `</span>`;
    scrollToBottom();
  }

  function removePhaseBar() {
    if (phaseBar) { phaseBar.remove(); phaseBar = null; }
  }

  function showPhase4Banner(label, done) {
    if (!phase4Banner) {
      phase4Banner = document.createElement('div');
      phase4Banner.className = 'phase4-banner';
      bubble.appendChild(phase4Banner);
    }
    phase4Banner.innerHTML = done
      ? `<span class="phase4-done">⟳ ${label} ✓</span>`
      : `<span class="phase4-active">⟳ ${label} <span class="phase-dot-anim">…</span></span>`;
    scrollToBottom();
  }

  try {
    while (true) {
      let result;
      try { result = await reader.read(); }
      catch (e) {
        if (e.name === 'AbortError') break;
        throw e;
      }
      const { done, value } = result;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const t = line.trim();
        if (!t) { currentEvent = ''; continue; }

        // Track SSE event type
        if (t.startsWith('event: ')) {
          currentEvent = t.slice(7).trim();
          continue;
        }
        if (!t.startsWith('data: ')) continue;

        let payload;
        try { payload = JSON.parse(t.slice(6)); }
        catch (_) { continue; }

        const evt = currentEvent || 'message';
        currentEvent = '';

        // ── Phase progress events ─────────────────────────────────────────
        if (evt === 'phase') {
          const { phase, label, status } = payload;
          if (phase === 3 && status === 'start') {
            // Phase 3 is about to start streaming — remove the phase bar
            removePhaseBar();
          } else if (phase === 3 && status === 'retry') {
            // Phase 3 retry: clear previously streamed narrative and show retry indicator
            state.streamingText = '';
            hasNarrativeText = false;
            bubble.innerHTML = '';
            phaseBar = null; // ref is stale after innerHTML clear
            updatePhaseBar(3, `${label}（第${payload.attempt}次重试）`, 'active');
          } else if (phase === 4 && status === 'start') {
            showPhase4Banner(label, false);
          } else if (phase === 4 && status === 'done') {
            showPhase4Banner(payload.label || '更新状态', true);
            setTimeout(() => { if (phase4Banner) { phase4Banner.remove(); phase4Banner = null; } }, 2000);
          } else if (status === 'start') {
            updatePhaseBar(phase, label, 'active');
          } else if (status === 'done') {
            updatePhaseBar(phase, label, 'done');
          }
          continue;
        }

        // ── Normal narrative chunks (Phase 3) ─────────────────────────────
        if (evt === 'chunk' || evt === 'message') {
          if (payload.delta !== undefined) {
            if (!hasNarrativeText) {
              removePhaseBar();
              hasNarrativeText = true;
            }
            state.streamingText += payload.delta;
            bubble.innerHTML = renderStreamingText(state.streamingText);
            // Re-append phase4Banner if it was added (innerHTML wipes it)
            if (phase4Banner) bubble.appendChild(phase4Banner);
            scrollToBottom();
          }
          if (payload.html !== undefined) finalData = payload;
          if (payload.message !== undefined) throw new Error(payload.message);
          continue;
        }

        // ── Phase 4 update chunks (silent — not shown in narrative) ───────
        if (evt === 'chunk4') continue;

        // ── Done event ────────────────────────────────────────────────────
        if (payload.html !== undefined) finalData = payload;
        if (payload.message !== undefined) throw new Error(payload.message);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
    removePhaseBar();
  }

  return finalData;
}

/** Finalize a streaming message element with server data or partial text. */
function finalizeStreamMsg(streamMsg, finalData, userMsgEl) {
  streamMsg.classList.remove('streaming');
  const bubble = streamMsg.querySelector('.msg-bubble');

  if (finalData) {
    bubble.innerHTML = finalData.html || esc(state.streamingText).replace(/\n/g, '<br>');
    // Store raw text and options for editing/deletion recovery
    streamMsg.dataset.rawContent = state.streamingText;
    streamMsg.dataset.options = JSON.stringify(finalData.options || []);
    if (finalData.options?.length) setOptions(finalData.options);
    if (finalData.danmu?.length) finalData.danmu.forEach((d, i) => setTimeout(() => fireDanmu(d), i * 1200));
    if (finalData.statData) updateStatData(finalData.statData);
    if (finalData.aiMsgIdx !== undefined) streamMsg.dataset.msgIdx = finalData.aiMsgIdx;
    if (finalData.userMsgIdx !== undefined && userMsgEl) userMsgEl.dataset.msgIdx = finalData.userMsgIdx;
  } else if (state.streamingText) {
    // Aborted — keep partial text
    bubble.innerHTML = esc(state.streamingText).replace(/\n/g, '<br>');
    streamMsg.dataset.rawContent = state.streamingText;
  } else {
    streamMsg.remove();
  }
  state.streamingMsgEl = null;
}

// ─── Send Message ─────────────────────────────────────────────────────────────

async function sendMessage(text, { silent = false } = {}) {
  if (!state.currentSessionId || state.isLoading) return;
  const trimmed = text.trim();

  // Empty send = "continue" trigger, treated silently
  const isEmpty    = !trimmed;
  const actualText = isEmpty ? '[继续]' : trimmed;

  state.isLoading = true;
  disableInput();
  clearOptions();
  const userMsgEl = (silent || isEmpty) ? null : appendUserMsg(trimmed);
  inputBox.value = '';
  autoResize(inputBox);

  appendLoadingDots();
  const streamMsg = createStreamingMsg();

  const ctrl = new AbortController();
  state.streamAbortCtrl = ctrl;
  stopBtn.style.display = '';

  try {
    const res = await fetch(`/api/sessions/${state.currentSessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: actualText }),
      signal: ctrl.signal,
    });

    removeLoadingDots();
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || res.statusText); }

    const finalData = await readSSEStream(res, streamMsg);
    finalizeStreamMsg(streamMsg, finalData, userMsgEl);
    refreshSessionList();
  } catch (e) {
    removeLoadingDots();
    if (e.name === 'AbortError') {
      finalizeStreamMsg(streamMsg, null, userMsgEl);
    } else {
      streamMsg.remove();
      toast('发送失败: ' + e.message, 'error');
    }
  } finally {
    state.isLoading = false;
    state.streamAbortCtrl = null;
    stopBtn.style.display = 'none';
    enableInput();
    scrollToBottom();
  }
}

/** Stop the current streaming generation. */
function stopGeneration() {
  if (state.streamAbortCtrl) {
    state.streamAbortCtrl.abort();
    state.streamAbortCtrl = null;
  }
}

// ─── Regenerate / Retrace ─────────────────────────────────────────────────────

/**
 * Regenerate the AI response starting from an assistant bubble element.
 * Removes the clicked message and all after it, then calls /regenerate.
 */
async function regenerateFrom(aiMsgEl) {
  if (state.isLoading) return;
  const msgIdx = parseInt(aiMsgEl.dataset.msgIdx ?? '-1');

  // Remove everything in the DOM from aiMsgEl onwards
  removeDomFrom(aiMsgEl);
  clearOptions();

  state.isLoading = true;
  disableInput();
  appendLoadingDots();
  const streamMsg = createStreamingMsg();

  const ctrl = new AbortController();
  state.streamAbortCtrl = ctrl;
  stopBtn.style.display = '';

  try {
    const body = msgIdx >= 0 ? { truncateTo: msgIdx } : {};
    const res = await fetch(`/api/sessions/${state.currentSessionId}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    removeLoadingDots();
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || res.statusText); }

    const finalData = await readSSEStream(res, streamMsg);
    finalizeStreamMsg(streamMsg, finalData, null);

    // Update the preceding user message's msgIdx
    if (finalData?.userMsgIdx !== undefined) {
      const userEl = chatArea.querySelector(`.msg.user:last-of-type`);
      if (userEl) userEl.dataset.msgIdx = finalData.userMsgIdx;
    }
    refreshSessionList();
  } catch (e) {
    removeLoadingDots();
    if (e.name === 'AbortError') {
      finalizeStreamMsg(streamMsg, null, null);
    } else {
      streamMsg.remove();
      toast('重发失败: ' + e.message, 'error');
    }
  } finally {
    state.isLoading = false;
    state.streamAbortCtrl = null;
    stopBtn.style.display = 'none';
    enableInput();
    scrollToBottom();
  }
}

/**
 * Re-run the full display pipeline (regex rules + markdown) on a stored message.
 * Useful to fix garbled HTML caused by pipeline bugs or server restarts.
 */
async function reprocessDisplay(aiMsgEl) {
  if (state.isLoading) return;
  const msgIdx = parseInt(aiMsgEl.dataset.msgIdx ?? '-1');
  if (msgIdx < 0) { toast('消息索引无效，请先发送或重发', 'error'); return; }

  const btn = aiMsgEl.querySelector('[data-action="reregex"]');
  if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }

  try {
    const data = await fetch(
      `/api/sessions/${state.currentSessionId}/messages/${msgIdx}/reprocess-display`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    ).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    });
    const bubble = aiMsgEl.querySelector('.msg-bubble');
    if (bubble && data.html) bubble.innerHTML = data.html;
    if (data.options?.length) setOptions(data.options);
    toast('正则已重新处理', 'success');
  } catch (e) {
    toast('重新处理失败: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↺ 重正则'; }
  }
}

/**
 * Re-apply UpdateVariable processing for an assistant message from its saved
 * pre-turn state snapshot. Useful after regeneration to fix variable state.
 */
async function reprocessVars(aiMsgEl) {
  if (state.isLoading) return;
  const msgIdx = parseInt(aiMsgEl.dataset.msgIdx ?? '-1');
  if (msgIdx < 0) { toast('消息索引无效，请先发送或重发', 'error'); return; }

  const btn = aiMsgEl.querySelector('[data-action="revar"]');
  if (btn) { btn.disabled = true; btn.textContent = '处理中…'; }

  try {
    const data = await fetch(
      `/api/sessions/${state.currentSessionId}/messages/${msgIdx}/reprocess-vars`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } }
    ).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    });
    if (data.statData) updateStatData(data.statData);
    toast('变量已重新处理', 'success');
  } catch (e) {
    toast('重新处理失败: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↺ 重变量'; }
  }
}

/**
 * Delete a message (and its paired counterpart) with state rollback.
 * Can be called on either a user or assistant message element.
 */
async function deleteMessage(msgEl) {
  if (state.isLoading) return;
  const msgIdx = parseInt(msgEl.dataset.msgIdx ?? '-1');
  if (msgIdx < 0) { toast('消息索引无效', 'error'); return; }

  const btn = msgEl.querySelector('[data-action="delete"]');
  if (btn) { btn.disabled = true; btn.textContent = '删除中…'; }

  try {
    const data = await fetch(
      `/api/sessions/${state.currentSessionId}/messages/${msgIdx}`,
      { method: 'DELETE' }
    ).then(async r => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || r.statusText);
      return j;
    });

    // Remove DOM elements for all deleted indices
    const removedSet = new Set(data.removed || [msgIdx]);
    chatArea.querySelectorAll('[data-msg-idx]').forEach(el => {
      if (removedSet.has(parseInt(el.dataset.msgIdx))) el.remove();
    });

    // Re-index remaining message elements:
    // new index = original index − (number of removed indices strictly less than it)
    // This preserves correct server-side alignment even when some history entries
    // are hidden in the DOM (e.g. the hidden "[Start a new chat]" user message).
    const removedSorted = [...removedSet].sort((a, b) => a - b);
    chatArea.querySelectorAll('[data-msg-idx]').forEach(el => {
      const orig = parseInt(el.dataset.msgIdx);
      const shift = removedSorted.filter(r => r < orig).length;
      el.dataset.msgIdx = orig - shift;
    });

    // Restore options from the now-last assistant message (or clear if none)
    clearOptions();
    const allAssistant = chatArea.querySelectorAll('.msg.assistant[data-msg-idx]');
    if (allAssistant.length > 0) {
      const lastAssistant = allAssistant[allAssistant.length - 1];
      try {
        const prevOptions = JSON.parse(lastAssistant.dataset.options || '[]');
        if (prevOptions.length) setOptions(prevOptions);
      } catch (_) {}
    }

    if (data.statData) updateStatData(data.statData);
    toast(data.statData ? '已删除，状态已回退' : '已删除', 'success');
  } catch (e) {
    toast('删除失败: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '🗑 删除'; }
  }
}

/**
 * Show inline editor for a user message.
 */
function startEditMessage(userMsgEl) {
  if (state.isLoading) return;
  const bubble = userMsgEl.querySelector('.msg-bubble');
  const originalHtml = bubble.innerHTML;
  const originalText = bubble.innerText || bubble.textContent;

  // Replace bubble with an edit form
  bubble.innerHTML = `
    <div class="msg-inline-edit">
      <textarea>${esc(originalText)}</textarea>
      <div class="msg-inline-edit-btns">
        <button class="cancel">取消</button>
        <button class="confirm">确认重发</button>
      </div>
    </div>
  `;
  const ta = bubble.querySelector('textarea');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  bubble.querySelector('.cancel').addEventListener('click', () => {
    bubble.innerHTML = originalHtml;
  });

  bubble.querySelector('.confirm').addEventListener('click', async () => {
    const newText = ta.value.trim();
    if (!newText) return;
    const msgIdx = parseInt(userMsgEl.dataset.msgIdx ?? '-1');
    await retraceFrom(userMsgEl, msgIdx, newText);
  });
}

/**
 * Edit user message at msgIdx and regenerate everything after it.
 */
async function retraceFrom(userMsgEl, msgIdx, newContent) {
  if (state.isLoading) return;

  // Update the user bubble text
  const bubble = userMsgEl.querySelector('.msg-bubble');
  bubble.innerHTML = esc(newContent).replace(/\n/g, '<br>');

  // Remove everything in DOM after this user message
  removeDomAfter(userMsgEl);
  clearOptions();

  state.isLoading = true;
  disableInput();
  appendLoadingDots();
  const streamMsg = createStreamingMsg();

  const ctrl = new AbortController();
  state.streamAbortCtrl = ctrl;
  stopBtn.style.display = '';

  try {
    const res = await fetch(`/api/sessions/${state.currentSessionId}/retrace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgIdx, content: newContent }),
      signal: ctrl.signal,
    });

    removeLoadingDots();
    if (!res.ok) { const err = await res.json(); throw new Error(err.error || res.statusText); }

    const finalData = await readSSEStream(res, streamMsg);
    finalizeStreamMsg(streamMsg, finalData, userMsgEl);
    refreshSessionList();
  } catch (e) {
    removeLoadingDots();
    if (e.name === 'AbortError') {
      finalizeStreamMsg(streamMsg, null, userMsgEl);
    } else {
      streamMsg.remove();
      toast('编辑重发失败: ' + e.message, 'error');
    }
  } finally {
    state.isLoading = false;
    state.streamAbortCtrl = null;
    stopBtn.style.display = 'none';
    enableInput();
    scrollToBottom();
  }
}

/**
 * Manually edit the content of an AI message bubble (no LLM call).
 */
async function startEditAIMessage(aiMsgEl) {
  if (state.isLoading) return;

  const bubble   = aiMsgEl.querySelector('.msg-bubble');
  const savedHtml = bubble.innerHTML;
  const rawText   = aiMsgEl.dataset.rawContent || bubble.innerText || bubble.textContent;

  bubble.innerHTML = `
    <div class="msg-inline-edit">
      <textarea>${esc(rawText)}</textarea>
      <div class="msg-inline-edit-btns">
        <button class="cancel">取消</button>
        <button class="confirm">保存</button>
      </div>
    </div>
  `;
  const ta = bubble.querySelector('textarea');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  bubble.querySelector('.cancel').addEventListener('click', () => {
    bubble.innerHTML = savedHtml;
  });

  bubble.querySelector('.confirm').addEventListener('click', async () => {
    const newText = ta.value; // allow empty
    const msgIdx  = parseInt(aiMsgEl.dataset.msgIdx ?? '-1');
    if (msgIdx < 0) { bubble.innerHTML = savedHtml; return; }

    try {
      const data = await fetch(`/api/sessions/${state.currentSessionId}/messages/${msgIdx}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newText }),
      }).then(r => r.json());

      if (data.html) {
        bubble.innerHTML = data.html;
        aiMsgEl.dataset.rawContent = newText;
      } else {
        bubble.innerHTML = esc(newText).replace(/\n/g, '<br>');
        aiMsgEl.dataset.rawContent = newText;
      }
    } catch (e) {
      bubble.innerHTML = savedHtml;
      toast('编辑失败: ' + e.message, 'error');
    }
  });
}

/** Remove el and all siblings after it in chatArea. */
function removeDomFrom(el) {
  if (!el || !el.parentNode) return;
  const siblings = Array.from(chatArea.children);
  const idx = siblings.indexOf(el);
  if (idx < 0) return;
  siblings.slice(idx).forEach((s) => s.remove());
}

/** Remove all siblings AFTER el (not el itself). */
function removeDomAfter(el) {
  if (!el || !el.parentNode) return;
  const siblings = Array.from(chatArea.children);
  const idx = siblings.indexOf(el);
  if (idx < 0) return;
  siblings.slice(idx + 1).forEach((s) => s.remove());
}

// ─── Stat Data ────────────────────────────────────────────────────────────────

function updateStatData(statData) {
  state.latestStatData = statData;
  if (state.statFloat.visible) renderStatFloat(statData);
}

function toggleStatFloat() {
  state.statFloat.visible = !state.statFloat.visible;
  statFloat.style.display = state.statFloat.visible ? 'flex' : 'none';
  $('btn-stat-toggle').classList.toggle('active', state.statFloat.visible);
  if (state.statFloat.visible && state.latestStatData) {
    renderStatFloat(state.latestStatData);
  }
}

// ─── JSON Tree Renderer ───────────────────────────────────────────────────────

/** Chinese translation map for JSON keys */
const KEY_TRANS = {
  // Top-level sections
  CharacterSheet: '角色面板', Multiverse: '多元宇宙', CompanionRoster: '同伴名录', Templates: '模板库',
  // CharacterSheet sections
  UserPanel: '角色档案', CoreSystem: '核心系统', DynamicStatus: '当前状态', Resources: '系统资源', Loadout: '技能装备',
  // UserPanel
  Name: '名称', Title: '称号', Identity: '身份', Origin: '来源',
  Appearance: '外观', Height: '身高', Weight: '体重', Visuals: '外貌', Clothing: '服装', Gender: '性别', Age: '年龄',
  Personality: '性格', Alignment: '阵营', Traits: '性格标签', Analysis: '性格分析',
  Flaws: '缺陷', Desires: '渴望', Fears: '恐惧', Quirks: '怪癖', Background: '背景',
  // Personality dimensions (18-axis)
  Dimensions: '心理维度', Social: '社交', Emotional: '情感', Cognitive: '认知', Values: '价值观',
  IntroExtro: '内倾/外倾', TrustRadius: '信任半径', Dominance: '主导性', Empathy: '共情力', BoundaryStrength: '边界感',
  Stability: '情绪稳定', Expressiveness: '情感外显', RecoverySpeed: '恢复速度', EmotionalDepth: '情感深度',
  AnalyticIntuitive: '直觉/分析', Openness: '开放性', RiskTolerance: '风险容忍', SelfAwareness: '自我认知',
  Autonomy: '自主性', Altruism: '利他性', Rationality: '理性度', Loyalty: '忠诚度', Idealism: '理想主义',
  ContextModes: '情境模式', TriggerPatterns: '触发模式',
  // EmotionalState
  EmotionalState: '当前情绪', Baseline: '情绪基线', ActiveEmotions: '活跃情绪', RecentMoodShifts: '近期情绪变化',
  // Relationships
  Relationships: '关系网络', Familiarity: '熟悉度', Trust: '信任度', Affect: '情感倾向', Dynamics: '互动特征', RecentHistory: '近期记录',
  // CoreSystem
  Attributes: '能力值', Tier: '等阶', SubSystems: '子系统',
  STR: '力量', DUR: '耐力', VIT: '体质', REC: '恢复', AGI: '敏捷',
  REF: '反应', PER: '感知', MEN: '精神', SOL: '灵魂', CHA: '魅力',
  NormalTier: '常态等阶', BurstTier: '爆发等阶',
  // DynamicStatus
  HP: '生命值', EnergyPools: '能量池', Value: '当前', MaxValue: '上限', Formula: '公式', Cap: '上限公式',
  // Resources
  Points: '积分', StarMedals: '星徽',
  // Loadout
  PassiveAbilities: '被动能力', PowerSources: '力量来源', ApplicationTechniques: '应用技艺',
  Mechs: '机体', StartingItems: '起始道具', KnowledgeBase: '知识库',
  Description: '描述', Tags: '标签', Specs: '规格', Equivalence: '战斗当量', Resistances: '抗性',
  Offense: '攻击当量', Defense: '防御当量', Speed: '机动当量', Physical: '物理抗性',
  // PowerSource
  Type: '类型', Aptitude: '资质', Grade: '评级', Correction: '修炼效率',
  Cultivation: '修炼状态', Realm: '境界', Progress: '进度',
  Level: '等级', Rank: '等级数', CurrentXP: '当前经验', NextLevelXP: '升级经验',
  AutoLevelUp: '自动升级', Bonus: '加成',
  GeneratedPool: '能量池设定', PoolName: '池名', Regen: '回复',
  BaseSpecs: '基础规格', TechniqueRegistry: '流派索引',
  DerivedPassives: '衍生被动', DerivedTechniques: '衍生技艺',
  // Technique / School / SubMove
  School: '流派', ParentSource: '驱动基盘', Proficiency: '熟练度',
  SubMoves: '招式列表', SubMoveEntry: '招式',
  Mechanics: '技艺机制', State: '状态', CurrentStatus: '当前状态', Timers: '计时',
  DurationRemaining: '剩余持续', CooldownRemaining: '剩余冷却',
  ActivationManifestation: '发动方式', Stance: '发动姿势', Chant: '咏唱/口令', VisualFX: '视觉特效', SoundFX: '音效', Morph: '形态变化',
  Cost: '消耗', Initial: '启动消耗', Maintenance: '维持消耗', Material: '耗材',
  Timing: '时机', CastTime: '施放时间', CoolDown: '冷却', Duration: '持续时间',
  RiskProfile: '风险', HasSafeLimit: '反噬风险', OverloadThreshold: '过载阈值', OverloadPenalty: '过载惩罚',
  // KnowledgeBase
  KnowledgeBase: '知识库', Database: '数据库', RootNodes: '知识节点', SubNodes: '子节点',
  Topic: '主题', Mastery: '掌握程度', Content: '内容', Summary: '摘要',
  // AchievementSystem
  AchievementSystem: '成就系统', Achievements: '成就列表', Medals: '勋章',
  // Inventory
  Inventory: '物品栏', Equipped: '装备中', Unequipped: '未装备', ItemName: '物品名', Quantity: '数量',
  VisualDetails: '外观', Material: '材质', Texture: '质感',
  // Multiverse
  CurrentWorldName: '当前世界', Archives: '世界档案',
  WorldName: '世界名称', Location: '地点', Time: '时间', Date: '日期', SocialWeb: '社会关系',
  WorldRules: '世界法则', PowerSystems: '力量体系',
};

/** Icon hints for well-known branch keys */
const KEY_ICONS = {
  UserPanel: '👤', CoreSystem: '⚙', DynamicStatus: '💫', Resources: '💎', Loadout: '⚔',
  Appearance: '👁', Personality: '🧠',
  HP: '❤', EnergyPools: '🔮', Attributes: '📊', Tier: '⭐',
  PassiveAbilities: '✨', PowerSources: '⚡', ApplicationTechniques: '📖',
  StartingItems: '🎒', MechanizedUnits: '🤖',
  Cultivation: '🌱', Proficiency: '📈', Specs: '📋',
  TechniqueRegistry: '📋', DerivedPassives: '🔗',
  // School / SubMove hierarchy
  SubMoves: '⚔', School: '🏛',
  ActivationManifestation: '🌀', RiskProfile: '⚠',
  Mechanics: '⚙', Cost: '💠', Timing: '⏱',
  // Knowledge
  KnowledgeBase: '📚', Database: '🗄', RootNodes: '🔷', SubNodes: '◈',
  // Personality extensions
  Dimensions: '⚖', EmotionalState: '💭', TriggerPatterns: '⚡', ContextModes: '🎭',
  Relationships: '🔗',
  // World / Social
  Archives: '📁', SocialWeb: '🕸', CompanionRoster: '👥',
  // Achievement
  AchievementSystem: '🏆', Milestones: '🎯', Feats: '🌟',
  Inventory: '🎒',
};

/** Translate a JSON key to Chinese */
function tk(k) { return KEY_TRANS[k] || k; }

/** Returns true if arr is a [primitive, "description"] value-pair. */
function isValDesc(arr) {
  if (!Array.isArray(arr) || arr.length !== 2) return false;
  const [v, d] = arr;
  return typeof d === 'string' && (v === null || typeof v !== 'object');
}

/** Get a display label for an object (used for array item summaries). */
function getLabel(obj) {
  if (!obj || typeof obj !== 'object') return '';
  for (const k of ['Name','UnitName','SystemName','ItemName','Topic','WorldName','PoolName','SchoolName']) {
    const v = obj[k];
    if (v == null) continue;
    const s = Array.isArray(v) ? v[0] : v;
    if (s && typeof s === 'string' && !s.startsWith('$')) return s;
  }
  return '';
}

/** Render a number with context-aware color coding. */
function renderNum(n) {
  // Float attribute multipliers (0.3–5.0) → color-coded
  if (!Number.isInteger(n) && n >= 0.3 && n <= 5.0) {
    const cls = n >= 2.0 ? 'tree-num-legend'
              : n >= 1.5 ? 'tree-num-high'
              : n >= 1.1 ? 'tree-num-good'
              : n < 0.85 ? 'tree-num-low'
              : 'tree-num';
    return `<span class="${cls}">${esc(String(n))}</span>`;
  }
  return `<span class="tree-num">${esc(String(n))}</span>`;
}

/**
 * Recursively render a JSON value as an HTML tree.
 * @param {*}      data
 * @param {number} depth    current nesting depth
 * @param {boolean} rootOpen  whether to start expanded
 */
function renderTree(data, depth = 0, rootOpen = false) {
  if (data === null || data === undefined) return '<span class="tree-null">—</span>';

  if (typeof data !== 'object') {
    if (typeof data === 'number')  return renderNum(data);
    if (typeof data === 'boolean') return `<span class="tree-bool">${data ? '是' : '否'}</span>`;
    const s = String(data);
    if (s.startsWith('$__META')) return '';
    return `<span class="tree-str">${esc(s)}</span>`;
  }

  if (Array.isArray(data)) {
    // [value, "description"] pair
    if (isValDesc(data)) {
      const [v, d] = data;
      const valHtml = renderTree(v, depth + 1);
      return `${valHtml}<span class="tree-desc"> · ${esc(d)}</span>`;
    }

    const items = data.filter(x => !(typeof x === 'string' && x.startsWith('$__META')));
    if (!items.length) return '<span class="tree-empty">空</span>';

    // Pure short-string arrays → render as chips (tags, traits, etc.)
    if (items.every(x => typeof x === 'string') && items.every(x => x.length <= 28)) {
      return `<span class="stat-chips">${items.map(x => `<span class="stat-chip">${esc(x)}</span>`).join('')}</span>`;
    }

    let html = `<span class="tree-badge">${items.length}</span><ul class="tree-ul">`;
    items.forEach((item, i) => {
      const rendered = renderTree(item, depth + 1);
      if (!rendered) return;
      const isObj = item !== null && typeof item === 'object';
      const label = isObj ? getLabel(item) : '';
      const summary = label
        ? `<span class="tree-idx">${i + 1}</span> <span class="tree-item-label">${esc(label)}</span>`
        : `<span class="tree-idx">${i + 1}</span>`;
      if (isObj) {
        html += `<li class="tree-li tree-branch"><details${depth < 1 || rootOpen ? ' open' : ''}><summary>${summary}</summary><div class="tree-indent">${rendered}</div></details></li>`;
      } else {
        html += `<li class="tree-li tree-leaf"><span class="tree-key tree-idx-key">${i + 1}</span><span class="tree-sep">·</span>${rendered}</li>`;
      }
    });
    html += '</ul>';
    return html;
  }

  // Object
  const keys = Object.keys(data).filter(k => !k.startsWith('$') && !k.startsWith('//'));
  if (!keys.length) return '<span class="tree-empty">空</span>';

  // Pool pattern: object with both Value and MaxValue → progress bar
  const keysSet = new Set(keys);
  if (keysSet.has('Value') && keysSet.has('MaxValue')) {
    const v = Array.isArray(data.Value) ? data.Value[0] : data.Value;
    const m = Array.isArray(data.MaxValue) ? data.MaxValue[0] : data.MaxValue;
    if (typeof v === 'number' && typeof m === 'number' && m > 0) {
      const pct = Math.min(100, Math.max(0, v / m * 100)).toFixed(1);
      const clr = pct > 60 ? '#52c78e' : pct > 30 ? '#e0c052' : '#e05252';
      const barHtml = `<span class="stat-pool-row">
        <span class="stat-pool-bar"><span class="stat-pool-fill" style="width:${pct}%;background:${clr}"></span></span>
        <span class="stat-pool-nums" style="color:${clr}">${v}<span class="tree-sep">/</span>${m}</span>
      </span>`;
      const restKeys = keys.filter(k => k !== 'Value' && k !== 'MaxValue');
      if (!restKeys.length) return barHtml;
      const restObj = {};
      restKeys.forEach(k => { restObj[k] = data[k]; });
      const restHtml = renderTree(restObj, depth + 1);
      return `${barHtml}<details class="stat-pool-extra"><summary>▸ 详情</summary><div class="tree-indent">${restHtml}</div></details>`;
    }
  }

  let html = '<ul class="tree-ul">';
  for (const k of keys) {
    const val = data[k];
    const icon = KEY_ICONS[k] ? `<span class="tree-key-icon">${KEY_ICONS[k]}</span>` : '';
    const label = esc(tk(k));
    const rendered = renderTree(val, depth + 1);
    if (rendered === '') continue;

    const isComplex = val !== null && typeof val === 'object' && !isValDesc(val);
    if (isComplex) {
      const lbl = getLabel(val);
      const badge = Array.isArray(val)
        ? `<span class="tree-badge">${val.filter(x => !(typeof x === 'string' && x.startsWith('$__META'))).length}</span>`
        : '';
      const titleTxt = lbl
        ? `${icon}${label}<span class="tree-desc"> · ${esc(lbl)}</span>`
        : `${icon}${label}`;
      html += `<li class="tree-li tree-branch">
        <details${depth < 2 ? ' open' : ''}>
          <summary>${titleTxt}${badge}</summary>
          <div class="tree-indent">${rendered}</div>
        </details>
      </li>`;
    } else {
      html += `<li class="tree-li tree-leaf">
        ${icon}<span class="tree-key">${label}</span><span class="tree-sep">·</span>${rendered}
      </li>`;
    }
  }
  html += '</ul>';
  return html;
}

// ─── Stat Float Panel Renderer ────────────────────────────────────────────────

/** Tab definitions — each maps to a slice of statData */
const STAT_TABS = [
  { id: 'world',  en: 'WORLD',  zh: '世界',  fn: d => d.Multiverse || (Array.isArray(d?.Arsenal?.WorldAnchors) && d.Arsenal.WorldAnchors.length ? d.Multiverse || {} : null) || (Array.isArray(d?.Arsenal?.GachaPending) && d.Arsenal.GachaPending.length ? {} : null) || (Array.isArray(d?.Arsenal?.NarrativeGrants) && d.Arsenal.NarrativeGrants.length ? {} : null) },
  { id: 'core',   en: 'CORE',   zh: '属性',  fn: d => d.CharacterSheet?.CoreSystem },
  { id: 'user',   en: 'USER',   zh: '档案',  fn: d => d.CharacterSheet?.UserPanel },
  { id: 'status', en: 'STATUS', zh: '状态',  fn: d => {
    const ds = d.CharacterSheet?.DynamicStatus;
    if (!ds) return null;
    // Cross-reference PowerSources to enrich EnergyPools with missing Formula/Regen
    const psArr = d.CharacterSheet?.Loadout?.PowerSources || [];
    const regenMap = {};
    psArr.forEach(p => {
      const gp = p.GeneratedPool;
      if (!gp) return;
      const nm = Array.isArray(gp.PoolName) ? gp.PoolName[0] : gp.PoolName;
      if (nm && gp.Regen) regenMap[nm] = gp.Regen;
    });
    // Default formulas for built-in pools not tied to a PowerSource
    const capFml   = { '体力': ['(VIT+MEN)×20', '上限公式'] };
    const defRegen = { '体力': ['自然恢复 (REC×5/h)', '回复速率'] };
    const augmented = { ...ds };
    if (Array.isArray(ds.EnergyPools)) {
      augmented.EnergyPools = ds.EnergyPools.map(pool => {
        const nm = Array.isArray(pool.Name) ? pool.Name[0] : pool.Name;
        if (!nm) return pool;
        const ext = {};
        if (!pool.Formula && capFml[nm]) ext.Formula = { Cap: capFml[nm] };
        const regen = regenMap[nm] || defRegen[nm];
        if (!pool.Regen && regen) ext.Regen = regen;
        return Object.keys(ext).length ? { ...pool, ...ext } : pool;
      });
    }
    return augmented;
  }},
  { id: 'armory', en: 'ARMORY', zh: '武库',  fn: d => d.CharacterSheet?.Loadout },
  { id: 'data',   en: 'DATA',   zh: '知识',  fn: d => d.CharacterSheet?.KnowledgeBase },
  { id: 'social', en: 'SOCIAL', zh: '关系',  fn: d => {
    const rels = d.SocialWeb?.Relationships;
    if (!rels || !rels.length) return null;
    return { Relationships: rels };
  }},
  { id: 'team',   en: 'TEAM',   zh: '同伴',  fn: d => d.CompanionRoster },
  { id: 'feats',  en: 'FEATS',  zh: '成就',  fn: d => d.CharacterSheet?.AchievementSystem },
  { id: 'res',    en: 'RES',    zh: '资源',  fn: d => d.CharacterSheet?.Resources },
];

let statActiveTab = 'world';

function renderStatFloat(statData) {
  if (!statData) { statFloatBody.innerHTML = '<div class="hud-empty">无数据</div>'; return; }

  // Update header character name
  const up = statData.CharacterSheet?.UserPanel;
  const charName = up?.Name ? (Array.isArray(up.Name) ? up.Name[0] : up.Name) : '—';
  const nameEl = $('sf-char-name');
  if (nameEl) nameEl.textContent = charName;

  // Build tabs
  const tabsBar = $('stat-tabs-bar');
  if (tabsBar) {
    tabsBar.innerHTML = STAT_TABS.map(t => {
      if (!t.fn(statData)) return '';
      return `<button class="stat-tab${statActiveTab === t.id ? ' active' : ''}" data-tab="${t.id}">${t.en}<span class="stat-tab-zh"> / ${t.zh}</span></button>`;
    }).join('');
    tabsBar.querySelectorAll('.stat-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        statActiveTab = btn.dataset.tab;
        renderStatFloat(state.latestStatData);
      });
    });
  }

  // Render active tab
  const tab = STAT_TABS.find(t => t.id === statActiveTab) || STAT_TABS[0];
  const tabData = tab ? tab.fn(statData) : null;

  // Special rendering for WORLD tab: also show pending Arsenal.WorldAnchors
  if (tab?.id === 'world') {
    const pendingAnchors = statData?.Arsenal?.WorldAnchors;
    let html = tabData ? renderHudSection(tabData, 0) : '<div class="hud-empty">无数据</div>';
    if (Array.isArray(pendingAnchors) && pendingAnchors.length > 0) {
      html += `<div class="hud-anchor-pending">
        <div class="hud-anchor-pending-title">📦 武库·待激活世界锚点</div>
        ${pendingAnchors.map(a => {
          const name = Array.isArray(a.WorldName) ? a.WorldName[0] : (a.WorldName || a.worldKey || '未知世界');
          const loc  = Array.isArray(a.Location) ? a.Location[0] : (a.Location || '');
          const tf   = a.TimeFlow;
          const flowLabel = (() => {
            if (!tf) return '1:1';
            if (tf.type === 'frozen') return '冻结（离开期间内部静止）';
            if (tf.type === 'fixed_interval') return `固定跳跃 ${tf.fixedJump || '?'}/次进入`;
            if (tf.type === 'hybrid') return tf.description || '复合规则';
            const r = tf.ratioToBase || '1:1';
            const p = r.split(':').map(s => s.trim());
            return p.length === 2 && p[0] !== p[1] ? `${r}（基准${p[0]}天=此世界${p[1]}天）` : `${r}（与基准同步）`;
          })();
          const identity = a.WorldIdentity;
          const identityTitle = identity?.title || '外来穿越者';
          const identityOcc   = identity?.occupation || `在「${name}」世界中以外来者身份活动`;
          const identityBg    = (identity?.background || '').slice(0, 80);
          return `<div class="hud-anchor-card">
            <div class="hud-anchor-name">${esc(name)}</div>
            ${loc ? `<div class="hud-anchor-meta">📍 ${esc(loc)}</div>` : ''}
            <div class="hud-anchor-meta">⏱ 时间流速：${esc(flowLabel)}</div>
            <div class="hud-anchor-meta hud-anchor-identity">👤 身份：${esc(identityTitle)}</div>
            <button class="btn btn-sm hud-anchor-use-btn"
              data-world-key="${esc(a.worldKey || name)}"
              data-has-identity="1"
              data-identity-title="${esc(identityTitle)}"
              data-identity-occ="${esc(identityOcc)}"
              data-identity-bg="${esc(identityBg)}">🌐 使用</button>
          </div>`;
        }).join('')}
      </div>`;
    }
    // Gacha pending items
    const pendingGacha = statData?.Arsenal?.GachaPending;
    if (Array.isArray(pendingGacha) && pendingGacha.length > 0) {
      const TIER_COLORS_HUD = {
        0:'#888',1:'#aaa',2:'#7cc',3:'#7be',4:'#8acf',5:'#bada55',
        6:'#e8c87a',7:'#f4a460',8:'#e07070',9:'#c890e8',10:'#7ab8e8',
        11:'#40e0d0',12:'#ff69b4',13:'#ff4500',14:'#ffd700',15:'#e040fb',16:'#fff',
      };
      html += `<div class="hud-anchor-pending">
        <div class="hud-anchor-pending-title">🎰 武库·待领取抽卡物品 (${pendingGacha.length})</div>
        ${pendingGacha.map(p => {
          const item  = p.item || {};
          const tier  = item.tier ?? '?';
          const color = TIER_COLORS_HUD[tier] || '#aaa';
          return `<div class="hud-anchor-card hud-gacha-card" style="border-color:${color}40">
            <div class="hud-anchor-name" style="color:${color}">${esc(String(tier))}★ ${esc(item.name || '?')}</div>
            <div class="hud-anchor-meta">${esc(item.description ? item.description.slice(0, 60) + (item.description.length > 60 ? '…' : '') : '')}</div>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-sm hud-gacha-use-btn" data-pending-id="${esc(p.pendingId)}">✓ 使用</button>
              <button class="btn btn-sm btn-danger hud-gacha-discard-btn" data-pending-id="${esc(p.pendingId)}">✕ 丢弃</button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }

    // Narrative grants (剧情自动生成物品)
    const narrativeGrants = statData?.Arsenal?.NarrativeGrants;
    if (Array.isArray(narrativeGrants) && narrativeGrants.length > 0) {
      const STATUS_ICON = { generating: '⏳', applied: '✓', failed: '✕' };
      const STATUS_COLOR = { generating: '#a0b0c8', applied: '#7be896', failed: '#e87a7a' };
      const recentGrants = narrativeGrants.slice(0, 8);
      html += `<div class="hud-anchor-pending">
        <div class="hud-anchor-pending-title">📖 剧情奖励记录 (${narrativeGrants.length})</div>
        ${recentGrants.map(g => {
          const icon  = STATUS_ICON[g.status]  || '?';
          const color = STATUS_COLOR[g.status] || '#aaa';
          const itemInfo = g.appliedItem
            ? `${g.appliedItem.tier}★ ${esc(g.appliedItem.name)}`
            : esc(g.name || g.description?.slice(0, 40) || '生成中…');
          const subText = g.status === 'generating'
            ? '正在由兑换生成系统处理…'
            : g.status === 'failed'
            ? `生成失败：${esc((g.errorMsg || '').slice(0, 50))}`
            : `已录入商店并应用 · ${g.appliedItem?.type || ''}`;
          return `<div class="hud-anchor-card" style="border-color:${color}40;opacity:${g.status === 'generating' ? '0.75' : '1'}">
            <div class="hud-anchor-name" style="color:${color}">${icon} ${itemInfo}</div>
            <div class="hud-anchor-meta">${subText}</div>
          </div>`;
        }).join('')}
      </div>`;
    }

    statFloatBody.innerHTML = html;

    // Bind use-anchor buttons
    statFloatBody.querySelectorAll('.hud-anchor-use-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const worldKey = btn.dataset.worldKey;
        const sessionId = state.currentSessionId;
        if (!sessionId) { toast('未关联存档', 'error'); return; }

        // If world has identity info, ask whether to inherit
        let inheritIdentity = true;
        if (btn.dataset.hasIdentity === '1') {
          const lines = ['此世界携带预设身份信息：'];
          if (btn.dataset.identityTitle) lines.push(`  称号：${btn.dataset.identityTitle}`);
          if (btn.dataset.identityOcc)   lines.push(`  职业：${btn.dataset.identityOcc}`);
          if (btn.dataset.identityBg)    lines.push(`  背景：${btn.dataset.identityBg}${btn.dataset.identityBg.length >= 80 ? '…' : ''}`);
          lines.push('');
          lines.push('点击【确定】继承此世界身份');
          lines.push('点击【取消】不继承（以外来者身份进入）');
          inheritIdentity = window.confirm(lines.join('\n'));
        }

        btn.disabled = true;
        btn.textContent = '激活中…';
        try {
          const resp = await fetch(`/api/sessions/${sessionId}/use-anchor`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ worldKey, inheritIdentity }),
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || '激活失败');
          if (data.statData) updateStatData(data.statData);
          const identityNote = !inheritIdentity ? '（以外来者身份进入）' : '';
          toast(`✓ 已进入世界「${data.worldName}」${identityNote}`);
        } catch (e) {
          toast(e.message, 'error');
          btn.disabled = false;
          btn.textContent = '🌐 使用';
        }
      });
    });

    // Bind gacha pending use/discard buttons
    statFloatBody.querySelectorAll('.hud-gacha-use-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pendingId = btn.dataset.pendingId;
        const sessionId = state.currentSessionId;
        if (!sessionId) { toast('未关联存档', 'error'); return; }
        btn.disabled = true; btn.textContent = '应用中…';
        try {
          const resp = await fetch(`/api/sessions/${sessionId}/gacha/pending/${pendingId}/apply`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
          });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || '应用失败');
          if (data.statData) updateStatData(data.statData);
          toast(`✓ ${data.item?.name} 已应用到存档`);
          renderStatFloat(state.latestStatData);
        } catch (e) {
          toast(e.message, 'error');
          btn.disabled = false; btn.textContent = '✓ 使用';
        }
      });
    });

    statFloatBody.querySelectorAll('.hud-gacha-discard-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pendingId = btn.dataset.pendingId;
        const sessionId = state.currentSessionId;
        const ok = window.UIFeedback
          ? await window.UIFeedback.confirmDanger({
              title: '丢弃待领取物品',
              message: '确定丢弃此物品吗？\n丢弃后将退还一次单抽费用。',
              confirmText: '确认丢弃',
            })
          : confirm('确定丢弃此物品？\n丢弃后将退还一次单抽费用。');
        if (!sessionId || !ok) return;
        btn.disabled = true;
        try {
          const resp = await fetch(`/api/sessions/${sessionId}/gacha/pending/${pendingId}`, { method: 'DELETE' });
          const data = await resp.json();
          if (!resp.ok) throw new Error(data.error || '丢弃失败');
          // Update local statData from server response (reflects refunded balance)
          const updatedStat = data.statData || statData;
          const p = updatedStat?.Arsenal?.GachaPending;
          if (Array.isArray(p)) {
            const idx = p.findIndex(x => x.pendingId === pendingId);
            if (idx !== -1) p.splice(idx, 1);
          }
          updateStatData(updatedStat);
          renderStatFloat(updatedStat);
          toast(data.refund ? `已丢弃，已退还 ${data.refund}` : '已丢弃');
        } catch (e) {
          toast(e.message, 'error');
          btn.disabled = false;
        }
      });
    });
    return;
  }

  statFloatBody.innerHTML = tabData
    ? renderHudSection(tabData, 0)
    : '<div class="hud-empty">无数据</div>';
}

// ─── HUD Terminal Renderer ────────────────────────────────────────────────────

/**
 * Recursively render any JSON value as HUD terminal rows.
 * @param {*}      data   — the value to render
 * @param {number} depth  — current nesting depth
 */
// ─── Personality Dimension Rendering (stat-float HUD) ─────────────────────────
const HUD_DIM_LABELS = {
  IntroExtro: '内倾/外倾', TrustRadius: '信任半径', Dominance: '主导性', Empathy: '共情力', BoundaryStrength: '边界感',
  Stability: '情绪稳定', Expressiveness: '情感外显', RecoverySpeed: '恢复速度', EmotionalDepth: '情感深度',
  AnalyticIntuitive: '直觉/分析', Openness: '开放性', RiskTolerance: '风险容忍', SelfAwareness: '自我认知',
  Autonomy: '自主性', Altruism: '利他性', Rationality: '理性度', Loyalty: '忠诚度', Idealism: '理想主义',
};

function renderHudDimAxis(key, val) {
  const n = Array.isArray(val) ? val[0] : (typeof val === 'number' ? val : 0);
  const pct = Math.abs(n) * 5;
  const isPos = n >= 0;
  const label = HUD_DIM_LABELS[key] || key;
  return `<div class="hud-dim-row">
    <span class="hud-dim-label">${esc(label)}</span>
    <div class="hud-dim-track">
      <div class="hud-dim-fill ${isPos ? 'pos' : 'neg'}" style="width:${pct}%"></div>
    </div>
    <span class="hud-dim-val">${n > 0 ? '+' : ''}${n}</span>
  </div>`;
}

function renderHudDimensions(dims) {
  if (!dims || typeof dims !== 'object') return '';
  const cats = [
    ['Social', '社交'], ['Emotional', '情感'], ['Cognitive', '认知'], ['Values', '价值观'],
  ];
  return cats.map(([cat, label]) => {
    const catData = dims[cat];
    if (!catData || typeof catData !== 'object') return '';
    const axes = Object.entries(catData).map(([k, v]) => renderHudDimAxis(k, v)).join('');
    return `<div class="hud-dim-cat">
      <div class="hud-dim-cat-label">${label}</div>
      ${axes}
    </div>`;
  }).join('');
}

function renderHudEmotionalState(emo) {
  if (!emo || typeof emo !== 'object') return '';
  const baseline = Array.isArray(emo.Baseline) ? emo.Baseline[0] : (emo.Baseline ?? 0);
  const pct = ((baseline + 10) / 20 * 100).toFixed(1);
  let html = `<div class="hud-mood-bar"><div class="hud-mood-cursor" style="left:${pct}%"></div></div>
    <div class="hud-mood-label">基线: ${baseline > 0 ? '+' : ''}${baseline}/10</div>`;
  const emotions = Array.isArray(emo.ActiveEmotions) ? emo.ActiveEmotions.filter(Boolean) : [];
  if (emotions.length) {
    html += '<div class="hud-emotion-badges">' + emotions.map(e =>
      `<span class="hud-emotion-badge">${esc(e.emotion || '')} ${e.intensity || ''}/10</span>`
    ).join('') + '</div>';
  }
  const shifts = Array.isArray(emo.RecentMoodShifts) ? emo.RecentMoodShifts.filter(Boolean) : [];
  if (shifts.length) {
    html += '<div class="hud-mood-shifts">' + shifts.slice(-3).map(s =>
      `<div class="hud-mood-shift-item">${esc(String(s))}</div>`
    ).join('') + '</div>';
  }
  return html;
}

function renderHudTriggerPatterns(patterns) {
  if (!Array.isArray(patterns) || !patterns.length) return '';
  return patterns.map(t => {
    const intensity = Math.max(1, Math.min(10, Number(t.intensity) || 5));
    const cls = intensity >= 8 ? 'high' : intensity >= 5 ? 'mid' : 'low';
    return `<div class="hud-trigger-item">
      <span class="hud-trigger-badge ${cls}">${intensity}/10</span>
      <span class="hud-trigger-cond">${esc(t.trigger || '')}</span>
      <span class="hud-trigger-arrow">→</span>
      <span class="hud-trigger-react">${esc(t.reaction || '')}</span>
    </div>`;
  }).join('');
}

function renderHudRelationships(rels) {
  if (!Array.isArray(rels) || !rels.length) return '';
  return rels.map(r => {
    const name    = Array.isArray(r.Name)   ? r.Name[0]   : (r.name   || '?');
    const famil   = Array.isArray(r.Familiarity) ? r.Familiarity[0] : (r.Familiarity ?? 0);
    const trust   = Array.isArray(r.Trust)  ? r.Trust[0]  : (r.Trust  ?? 0);
    const affect  = Array.isArray(r.Affect) ? r.Affect[0] : (r.Affect ?? 0);
    const affectCls = affect > 20 ? 'pos' : affect < -20 ? 'neg' : 'neu';
    const dynamics = r.Dynamics || '';
    return `<div class="hud-rel-card">
      <div class="hud-rel-name">${esc(name)}</div>
      <div class="hud-rel-bars">
        <span>熟悉:${famil}</span>
        <span>信任:${trust}</span>
        <span class="hud-rel-affect ${affectCls}">情感:${affect > 0 ? '+' : ''}${affect}</span>
      </div>
      ${dynamics ? `<div class="hud-rel-dynamics">${esc(dynamics)}</div>` : ''}
    </div>`;
  }).join('');
}

function renderHudSection(data, depth) {
  if (data === null || data === undefined) return '<div class="hud-empty">—</div>';
  const d0 = Math.min(depth, 4);

  if (typeof data !== 'object') {
    return `<div class="hud-row hud-row-d${d0}"><div class="hud-val-group">${renderHudPrim(data)}</div></div>`;
  }

  if (Array.isArray(data)) {
    const items = data.filter(x => !(typeof x === 'string' && x.startsWith('$__META')));
    if (!items.length) return '';
    // Short string arrays → chips
    if (items.every(x => typeof x === 'string') && items.every(x => x.length <= 28)) {
      return `<div class="hud-row hud-row-d${d0}"><div class="hud-val-group"><div class="hud-chips">${items.map(x => `<span class="hud-chip">${esc(x)}</span>`).join('')}</div></div></div>`;
    }
    // Complex arrays → numbered groups
    return items.map((item, i) => {
      const label = (typeof item === 'object' && item !== null)
        ? (getLabel(item) || `#${i + 1}`)
        : `#${i + 1}`;
      if (typeof item === 'object' && item !== null) {
        return `<details class="hud-group hud-d${d0}" ${depth < 2 ? 'open' : ''}><summary class="hud-group-title">▾ ${esc(label)}</summary><div class="hud-group-body">${renderHudSection(item, depth + 1)}</div></details>`;
      }
      return `<div class="hud-row hud-row-d${d0}"><span class="hud-key">${i + 1}</span><div class="hud-val-group">${renderHudPrim(item)}</div></div>`;
    }).join('');
  }

  // Object: render each key as a row
  const keys = Object.keys(data).filter(k => !k.startsWith('$') && !k.startsWith('//'));
  if (!keys.length) return '';
  return keys.map(k => renderHudRow(k, data[k], depth)).filter(Boolean).join('');
}

/**
 * Render a single key→value pair in HUD style.
 */
function renderHudRow(key, val, depth) {
  const displayKey = tk(key);
  const icon = KEY_ICONS[key] ? KEY_ICONS[key] + ' ' : '';
  const keyHtml = `<span class="hud-key">${icon}${esc(displayKey)}</span>`;
  const d0 = Math.min(depth, 4);
  const rowCls = `hud-row hud-row-d${d0}`;

  // Personality special renderers
  if (key === 'Dimensions' && typeof val === 'object' && !Array.isArray(val)) {
    const inner = renderHudDimensions(val);
    if (!inner) return '';
    return `<details class="hud-group hud-d${d0}" open>
      <summary class="hud-group-title">⚖ ${esc(displayKey)}</summary>
      <div class="hud-group-body hud-dim-container">${inner}</div>
    </details>`;
  }
  if (key === 'EmotionalState' && typeof val === 'object' && !Array.isArray(val)) {
    const inner = renderHudEmotionalState(val);
    if (!inner) return '';
    return `<details class="hud-group hud-d${d0}" open>
      <summary class="hud-group-title">💭 ${esc(displayKey)}</summary>
      <div class="hud-group-body">${inner}</div>
    </details>`;
  }
  if (key === 'TriggerPatterns' && Array.isArray(val)) {
    const inner = renderHudTriggerPatterns(val);
    if (!inner) return '';
    return `<details class="hud-group hud-d${d0}">
      <summary class="hud-group-title">⚡ ${esc(displayKey)}</summary>
      <div class="hud-group-body">${inner}</div>
    </details>`;
  }
  if (key === 'Relationships' && Array.isArray(val)) {
    const inner = renderHudRelationships(val);
    if (!inner) return '';
    return `<details class="hud-group hud-d${d0}">
      <summary class="hud-group-title">🔗 ${esc(displayKey)}</summary>
      <div class="hud-group-body">${inner}</div>
    </details>`;
  }
  if (key === 'ContextModes' && typeof val === 'object' && !Array.isArray(val)) {
    const entries = Object.entries(val).filter(([,v]) => v && v.note);
    if (!entries.length) return '';
    const CTX_ZH = { withStrangers:'陌生人', withFriends:'熟人', whenInterested:'感兴趣', underThreat:'受威胁', whenLectured:'被说教', withAuthority:'面对权威' };
    const inner = entries.map(([ctx, v]) => {
      const modsStr = v.mods ? Object.entries(v.mods).map(([k,n]) => `${k}${n>=0?'+':''}${n}`).join(' ') : '';
      return `<div class="hud-ctx-item"><span class="hud-ctx-key">[${CTX_ZH[ctx]||ctx}]</span> <span class="hud-ctx-note">${esc(v.note||'')}</span>${modsStr?` <span class="hud-ctx-mods">(${esc(modsStr)})</span>`:''}</div>`;
    }).join('');
    return `<details class="hud-group hud-d${d0}">
      <summary class="hud-group-title">🎭 ${esc(displayKey)}</summary>
      <div class="hud-group-body">${inner}</div>
    </details>`;
  }

  // [value, "desc"] pair
  if (isValDesc(val)) {
    const [v, d] = val;
    return `<div class="${rowCls}">${keyHtml}<div class="hud-val-group">${renderHudPrim(v)}<span class="hud-hint">// ${esc(d)}</span></div></div>`;
  }

  if (val === null || val === undefined) {
    return `<div class="${rowCls}">${keyHtml}<div class="hud-val-group"><span class="hud-null">—</span></div></div>`;
  }

  if (typeof val !== 'object') {
    return `<div class="${rowCls}">${keyHtml}<div class="hud-val-group">${renderHudPrim(val)}</div></div>`;
  }

  // Pool pattern: object with Value + MaxValue
  if (!Array.isArray(val)) {
    const vkeys = Object.keys(val).filter(k => !k.startsWith('$'));
    if (vkeys.includes('Value') && vkeys.includes('MaxValue')) {
      const v = Array.isArray(val.Value)    ? val.Value[0]    : val.Value;
      const m = Array.isArray(val.MaxValue) ? val.MaxValue[0] : val.MaxValue;
      if (typeof v === 'number' && typeof m === 'number' && m > 0) {
        const pct = Math.min(100, Math.max(0, v / m * 100)).toFixed(1);
        const clr = pct > 60 ? '#52c78e' : pct > 30 ? '#e0c052' : '#e05252';
        const barHtml = `<div class="hud-pool-wrap">
          <span class="hud-pool-nums" style="color:${clr}">${v} / ${m}</span>
          <span class="hud-pool-bar"><span class="hud-pool-fill" style="width:${pct}%;background:${clr}"></span></span>
        </div>`;
        const extra = vkeys.filter(k => k !== 'Value' && k !== 'MaxValue');
        if (!extra.length) {
          return `<div class="${rowCls}">${keyHtml}<div class="hud-val-group">${barHtml}</div></div>`;
        }
        const extObj = {};
        extra.forEach(k => { extObj[k] = val[k]; });
        return `<details class="hud-group hud-d${d0}" open>
          <summary class="hud-group-title hud-group-pool"><span class="hud-group-k">${icon}${esc(displayKey)}</span>${barHtml}</summary>
          <div class="hud-group-body">${renderHudSection(extObj, depth + 1)}</div>
        </details>`;
      }
    }
  }

  // Short string chip array
  if (Array.isArray(val)) {
    const items = val.filter(x => !(typeof x === 'string' && x.startsWith('$__META')));
    if (items.length && items.every(x => typeof x === 'string') && items.every(x => x.length <= 28)) {
      return `<div class="${rowCls}">${keyHtml}<div class="hud-val-group"><div class="hud-chips">${items.map(x => `<span class="hud-chip">${esc(x)}</span>`).join('')}</div></div></div>`;
    }
  }

  // Complex nested → collapsible group
  const inner = renderHudSection(val, depth + 1);
  if (!inner) return '';
  return `<details class="hud-group hud-d${d0}" ${depth < 2 ? 'open' : ''}>
    <summary class="hud-group-title">${icon}${esc(displayKey)}</summary>
    <div class="hud-group-body">${inner}</div>
  </details>`;
}

/** Render a primitive value with HUD styling */
function renderHudPrim(v) {
  if (v === null || v === undefined) return '<span class="hud-null">—</span>';
  if (typeof v === 'boolean') return `<span class="hud-bool">${v ? '是' : '否'}</span>`;
  if (typeof v === 'number') {
    if (!Number.isInteger(v) && v >= 0.3 && v <= 5.0) {
      const cls = v >= 2.0 ? 'hud-num-legend'
                : v >= 1.5 ? 'hud-num-high'
                : v >= 1.1 ? 'hud-num-good'
                : v < 0.85 ? 'hud-num-low'
                : 'hud-num';
      return `<span class="${cls}">${v}</span>`;
    }
    return `<span class="hud-num">${v}</span>`;
  }
  return `<span class="hud-str">${esc(String(v))}</span>`;
}

// ─── Draggable Float Window ───────────────────────────────────────────────────

// initDraggable replaced by PanelManager.make — see panel.js

// ─── Input Helpers ────────────────────────────────────────────────────────────

function enableInput()  { inputBox.disabled = false; sendBtn.disabled = false; inputBox.focus(); }
function disableInput() { inputBox.disabled = true;  sendBtn.disabled = true; stopBtn.style.display = 'none'; }

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function scrollToBottom() { chatArea.scrollTop = chatArea.scrollHeight; }

// Settings modal removed — use /settings page (/settings)

// ─── New Game Wizard ──────────────────────────────────────────────────────────

const ngState = {
  step: 1,
  charType: '本土',
  traversalMethod: 'isekai',
  traversalDesc: '',
  selectedCharId: null,
  selectedCharName: null,
  /** Array of { id, name } for multi-world support */
  selectedWorlds: [],
};

const NG_TYPE_HINTS = {
  '本土':  '角色生于本世界，熟悉当地规则与文化。',
  '穿越者': '角色来自异世界，携带异世界记忆与知识。请选择穿越方式。',
};

const NG_TRAVERSAL_HINTS = {
  isekai:     '以完整记忆转生至本世界，保有异世界记忆，可能附带转生祝福。',
  rebirth:    '以完整记忆在本世界更早时间点重生，外表是本土人，内心装着异世界灵魂。',
  possession: '意识穿入本世界已存在人物身体，继承部分原主记忆，但核心是异世界灵魂。',
  summoning:  '以原世界完整成年身份被召唤至本世界，明显的外来者形象。',
  system:     '被未知力量携带至本世界，同时获得系统界面（与无限武库对接）。',
  custom:     '自定义穿越背景，在下方文本框中详细描述穿越方式。',
};

function ngGoStep(n) {
  ngState.step = n;
  [1, 2, 3].forEach(i => {
    const stepEl = $(`ng-step-${i}`);
    if (stepEl) stepEl.style.display = i === n ? 'flex' : 'none';
    const indicator = document.querySelector(`.wizard-step[data-step="${i}"]`);
    if (indicator) {
      indicator.classList.toggle('active', i === n);
      indicator.classList.toggle('done', i < n);
    }
  });
  if (n === 2) ngLoadWorlds();
  if (n === 3) { ngUpdateSummary(); }
}

function ngUpdateSummary() {
  const el = $('ng-summary');
  if (!el) return;
  let typeTag = ngState.charType;
  if (ngState.charType === '穿越者') {
    const tLabels = { isekai:'转生', rebirth:'重生', possession:'夺舍', summoning:'召唤', system:'系统穿越', custom:'自定义' };
    typeTag = `穿越者·${tLabels[ngState.traversalMethod] || ngState.traversalMethod}`;
  }
  const charLine = ngState.selectedCharName
    ? `<span class="ng-summary-item">👤 ${esc(ngState.selectedCharName)}</span><span class="ng-summary-tag">${esc(typeTag)}</span>`
    : `<span class="ng-summary-item text-muted">👤 无角色（稍后配置）</span><span class="ng-summary-tag">${esc(typeTag)}</span>`;
  const worldLine = ngState.selectedWorlds.length
    ? ngState.selectedWorlds.map(w => `<span class="ng-summary-item">🌍 ${esc(w.name)}</span>`).join('')
    : `<span class="ng-summary-item text-muted">🌍 默认世界背景</span>`;
  el.innerHTML = `<div class="ng-summary-row">${charLine}${worldLine}</div>`;
  // Pre-fill session name
  const nameEl = $('new-game-name');
  if (nameEl && !nameEl.value) {
    if (ngState.selectedCharName) nameEl.value = `${ngState.selectedCharName} 的故事`;
  }
}

async function ngLoadCharacters() {
  const listEl = $('ng-char-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="ng-loading">加载中…</div>';
  try {
    const chars = await api('GET', '/characters');

    // "no character" option always first
    const noneItem = document.createElement('div');
    noneItem.className = 'ng-char-item ng-item-none' + (ngState.selectedCharId === null ? ' selected' : '');
    noneItem.innerHTML = '<span class="ng-item-icon">⊘</span><span class="ng-item-label">不绑定角色（稍后在主角页配置）</span>';
    noneItem.addEventListener('click', () => {
      listEl.querySelectorAll('.ng-char-item').forEach(i => i.classList.remove('selected'));
      noneItem.classList.add('selected');
      ngState.selectedCharId = null;
      ngState.selectedCharName = null;
    });
    listEl.innerHTML = '';
    listEl.appendChild(noneItem);

    chars.forEach(c => {
      const item = document.createElement('div');
      const isSelected = ngState.selectedCharId === c.id;
      item.className = 'ng-char-item' + (isSelected ? ' selected' : '');
      const powerTag = c.hasPowers ? '<span class="ng-ctag ng-ctag-power">⚡超凡</span>' : '';
      const mechTag  = c.hasMechs  ? '<span class="ng-ctag ng-ctag-mech">🤖机体</span>'  : '';
      item.innerHTML = `
        <div class="ng-item-main">
          <span class="ng-item-name">${esc(c.name)}</span>
          ${c.title ? `<span class="ng-item-sub">${esc(c.title)}</span>` : ''}
          ${powerTag}${mechTag}
        </div>
        <div class="ng-item-meta">
          ${c.identity ? esc(c.identity) : ''}
          ${c.age ? `· ${esc(c.age)}岁` : ''}
        </div>`;
      item.addEventListener('click', () => {
        listEl.querySelectorAll('.ng-char-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        ngState.selectedCharId   = c.id;
        ngState.selectedCharName = c.name;
        // Auto-fill name
        const nameEl = $('new-game-name');
        if (nameEl && !nameEl.value) nameEl.value = `${c.name} 的故事`;
      });
      listEl.appendChild(item);
    });

    if (!chars.length) {
      const hint = document.createElement('p');
      hint.className = 'ng-empty-hint';
      hint.textContent = '档案库暂无角色。请前往「主角」页生成并保存角色。';
      listEl.appendChild(hint);
    }
  } catch (e) {
    listEl.innerHTML = `<div class="ng-loading" style="color:var(--danger)">加载失败: ${esc(e.message)}</div>`;
  }
}

async function ngLoadWorlds() {
  const listEl = $('ng-world-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="ng-loading">加载中…</div>';
  try {
    const worlds = await api('GET', '/worldanchor/archives');

    const TIER_LABELS = { low:'低危区', mid:'中危区', high:'高危区', stellar:'行星/恒星区', galactic:'星系/宇宙区', beyond:'超限区' };

    listEl.innerHTML = '';

    // Bind random world button
    const randBtn = $('btn-ng-world-random');
    if (randBtn) {
      randBtn.onclick = () => {
        if (!worlds.length) {
          toast('暂无世界档案，无法随机选择。', 'error');
          return;
        }
        const w = worlds[Math.floor(Math.random() * worlds.length)];
        const name = w.displayName || w.worldKey || '未命名世界';
        // 覆盖为单一随机世界，作为初始世界
        ngState.selectedWorlds = [{ id: w.id, name }];
        syncWorldSelection();
        ngUpdateSummary();
        toast(`已随机选择初始世界：「${name}」`, 'info');
      };
    }

    // Helper: sync visual selection state from ngState
    function syncWorldSelection() {
      const selMap = new Map(ngState.selectedWorlds.map(w => [w.id, w]));
      listEl.querySelectorAll('.ng-world-item[data-world-id]').forEach(el => {
        const entry = selMap.get(el.dataset.worldId);
        const sel = !!entry;
        el.classList.toggle('selected', sel);
        const cb = el.querySelector('.ng-world-check');
        if (cb) cb.checked = sel;
        // Show/hide identity toggle row
        const idRow = el.querySelector('.ng-world-identity-row');
        if (idRow) {
          idRow.style.display = sel ? '' : 'none';
          const idBtn = idRow.querySelector('.ng-identity-toggle');
          if (idBtn && entry) {
            const inherit = entry.inheritIdentity !== false;
            idBtn.textContent = inherit ? '✓ 继承世界身份' : '✕ 不继承身份';
            idBtn.style.color = inherit ? 'var(--success, #7be896)' : 'var(--muted, #888)';
          }
        }
      });
    }

    worlds.forEach(w => {
      const item = document.createElement('div');
      const isSelected = ngState.selectedWorlds.some(s => s.id === w.id);
      item.className = 'ng-world-item' + (isSelected ? ' selected' : '');
      item.dataset.worldId = w.id;
      const name = w.displayName || w.worldKey || '未命名世界';
      const tierLabel = TIER_LABELS[w.tierRange] || '';
      const meta = [w.universe, w.timePeriod].filter(Boolean).join(' · ');
      const selectedEntry = ngState.selectedWorlds.find(s => s.id === w.id);
      const initInherit = selectedEntry ? selectedEntry.inheritIdentity !== false : true;
      item.innerHTML = `
        <div class="ng-item-main" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" class="ng-world-check" ${isSelected ? 'checked' : ''} style="flex-shrink:0;width:15px;height:15px;cursor:pointer">
          <span class="ng-item-name">${esc(name)}</span>
          ${tierLabel ? `<span class="ng-ctag ng-ctag-tier">${esc(tierLabel)}</span>` : ''}
        </div>
        <div class="ng-item-meta">${meta ? esc(meta) : '<span style="opacity:.5">暂无描述</span>'}</div>
        <div class="ng-world-identity-row" style="${isSelected ? '' : 'display:none'}">
          <button class="btn btn-xs ng-identity-toggle" style="font-size:11px;padding:2px 8px;color:${initInherit ? 'var(--success,#7be896)' : 'var(--muted,#888)'}">${initInherit ? '✓ 继承世界身份' : '✕ 不继承身份'}</button>
        </div>`;

      // Toggle identity button (stop propagation so it doesn't trigger world selection)
      const idBtn = item.querySelector('.ng-identity-toggle');
      if (idBtn) {
        idBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const entry = ngState.selectedWorlds.find(s => s.id === w.id);
          if (!entry) return;
          entry.inheritIdentity = entry.inheritIdentity === false ? true : false;
          syncWorldSelection();
        });
      }

      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('ng-identity-toggle')) return;
        const alreadySel = ngState.selectedWorlds.some(s => s.id === w.id);
        if (alreadySel) {
          ngState.selectedWorlds = ngState.selectedWorlds.filter(s => s.id !== w.id);
        } else {
          ngState.selectedWorlds.push({ id: w.id, name, inheritIdentity: true });
        }
        syncWorldSelection();
      });
      listEl.appendChild(item);
    });

    if (!worlds.length) {
      const hint = document.createElement('p');
      hint.className = 'ng-empty-hint';
      hint.textContent = '暂无世界档案。请前往「商城 → 世界锚点」购买或在世界档案页生成。';
      listEl.appendChild(hint);
    }
  } catch (e) {
    listEl.innerHTML = `<div class="ng-loading" style="color:var(--danger)">加载失败: ${esc(e.message)}</div>`;
  }
}

async function ngGenerateWorld() {
  const worldName = $('ng-world-name-input').value.trim();
  if (!worldName) { toast('请输入世界名称', 'error'); return; }

  const btn = $('btn-ng-gen-world');
  const statusEl  = $('ng-world-gen-status');
  const statusTxt = $('ng-world-gen-text');
  const streamEl  = $('ng-world-gen-stream');

  btn.disabled = true;
  statusEl.style.display = '';
  streamEl.style.display = '';
  streamEl.textContent = '';
  statusTxt.textContent = `正在生成「${worldName}」世界档案…`;

  const additionalContext = $('ng-world-ctx-input').value.trim();
  let lastDoneData = null;
  let resolved = false;

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/worldanchor/generate');
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ worldName, additionalContext }));

      let rawBuf = '', sseBuf = '';

      function processBlock(block) {
        const lines = block.split('\n');
        let ev = null, data = null;
        for (const line of lines) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) { try { data = JSON.parse(line.slice(5).trim()); } catch (_) {} }
        }
        if (!ev || data === null) return;
        if (ev === 'chunk' && data.delta) {
          streamEl.textContent += data.delta;
          streamEl.scrollTop = streamEl.scrollHeight;
        } else if (ev === 'status') {
          statusTxt.textContent = data.message || '生成中…';
        } else if (ev === 'done') {
          lastDoneData = data;
          if (!resolved) { resolved = true; resolve(data); }
        } else if (ev === 'error') {
          if (!resolved) { resolved = true; reject(new Error(data.message || '生成失败')); }
        }
      }

      xhr.onreadystatechange = () => {
        if (xhr.readyState < 3) return;
        const newData = xhr.responseText.slice(rawBuf.length);
        rawBuf = xhr.responseText;
        sseBuf += newData;
        const blocks = sseBuf.split('\n\n');
        sseBuf = blocks.pop() || '';
        blocks.forEach(b => { if (b.trim()) processBlock(b); });
      };
      xhr.onload = () => {
        if (sseBuf.trim()) processBlock(sseBuf);
        if (!resolved) { resolved = true; resolve({}); }
      };
      xhr.onerror = () => { if (!resolved) reject(new Error('网络错误')); };
    });

    statusTxt.textContent = `✓ 「${worldName}」已生成并加入档案库`;
    streamEl.style.display = 'none';
    $('ng-world-name-input').value = '';
    $('ng-world-ctx-input').value  = '';

    await ngLoadWorlds();
    toast(`✓ 「${worldName}」世界档案已生成`);

    setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
  } catch (err) {
    statusTxt.textContent = `✗ ${err.message}`;
    toast(`世界档案生成失败: ${err.message}`, 'error');
  }

  btn.disabled = false;
}


async function openNewGame() {
  // Reset wizard state
  ngState.step = 1;
  ngState.selectedCharId = null;
  ngState.selectedCharName = null;
  ngState.selectedWorlds = [];
  ngState.charType = '本土';
  ngState.traversalMethod = 'isekai';
  ngState.traversalDesc = '';

  $('btn-confirm-new-game').disabled = false;
  $('new-game-name').value = '';
  if ($('ng-first-input')) $('ng-first-input').value = '';
  $('modal-new-game').style.display = 'flex';

  // Reset type buttons
  document.querySelectorAll('.ng-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === '本土');
  });
  const hintEl = $('ng-type-hint');
  if (hintEl) hintEl.textContent = NG_TYPE_HINTS['本土'];

  // Hide traversal block
  const travBlock = $('ng-traversal-block');
  if (travBlock) travBlock.style.display = 'none';

  // Reset traversal buttons
  const travPresets = $('ng-traversal-presets');
  if (travPresets) {
    travPresets.querySelectorAll('.traversal-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.method === 'isekai');
    });
  }
  const travHint = $('ng-traversal-hint');
  if (travHint) travHint.textContent = NG_TRAVERSAL_HINTS.isekai;
  const travDesc = $('ng-traversal-desc');
  if (travDesc) { travDesc.style.display = 'none'; travDesc.value = ''; }

  ngGoStep(1);
  ngLoadCharacters();
}

async function confirmNewGame() {
  const name = $('new-game-name').value.trim() ||
    `冒险 ${new Date().toLocaleString('zh-CN', {month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}`;

  try {
    $('btn-confirm-new-game').disabled = true;
    const session = await api('POST', '/sessions', {
      name,
      greetingIndex:    -1,
      characterId:      ngState.selectedCharId || undefined,
      characterType:    ngState.charType,
      traversalMethod:  ngState.charType === '穿越者' ? ngState.traversalMethod : undefined,
      traversalDesc:    ngState.charType === '穿越者' ? ngState.traversalDesc : undefined,
      worldAnchorOptions: ngState.selectedWorlds.map(w => ({ id: w.id, inheritIdentity: w.inheritIdentity !== false })),
    });
    $('modal-new-game').style.display = 'none';

    state.currentSessionId = session.id;
    sessionName.textContent = session.name;
    chatArea.innerHTML = '';
    optionsPanel.innerHTML = '';

    // Initialize session state (no greeting used), then auto-trigger first AI response
    await api('POST', `/sessions/${session.id}/init`, {});

    enableInput();
    refreshSessionList();
    toast('游戏开始！', 'success');

    // Auto-trigger first AI message (custom or default)
    const firstInputEl = $('ng-first-input');
    const firstInput = firstInputEl ? firstInputEl.value.trim() : '';
    await sendMessage(firstInput || '[游戏开始]', { silent: true });
  } catch (e) {
    $('btn-confirm-new-game').disabled = false;
    toast('开始失败: ' + e.message, 'error');
  }
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

inputBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage(inputBox.value);
  }
});
inputBox.addEventListener('input', () => autoResize(inputBox));
sendBtn.addEventListener('click', () => sendMessage(inputBox.value));
stopBtn.addEventListener('click', stopGeneration);

$('btn-new-game').addEventListener('click', openNewGame);
$('btn-sidebar-new').addEventListener('click', openNewGame);
$('btn-welcome-start').addEventListener('click', openNewGame);

// Settings button is now a link to /settings page

$('btn-confirm-new-game').addEventListener('click', confirmNewGame);
$('btn-cancel-new-game').addEventListener('click', () => { $('modal-new-game').style.display = 'none'; });

// Wizard navigation
$('btn-ng-next-1').addEventListener('click', () => ngGoStep(2));
$('btn-ng-back-2').addEventListener('click', () => ngGoStep(1));
$('btn-ng-next-2').addEventListener('click', () => ngGoStep(3));
$('btn-ng-back-3').addEventListener('click', () => ngGoStep(2));

// Toggle inline world generator
$('btn-ng-toggle-gen').addEventListener('click', () => {
  const panel = $('ng-world-gen');
  const isVisible = panel.style.display !== 'none';
  panel.style.display = isVisible ? 'none' : 'block';
  $('btn-ng-toggle-gen').textContent = isVisible ? '＋ 生成新世界' : '▲ 收起';
  if (!isVisible) $('ng-world-name-input').focus();
});

$('btn-ng-gen-world').addEventListener('click', ngGenerateWorld);

// Character type buttons
document.querySelectorAll('.ng-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ng-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ngState.charType = btn.dataset.type;
    const hint = $('ng-type-hint');
    if (hint) hint.textContent = NG_TYPE_HINTS[ngState.charType] || '';
    const travBlock = $('ng-traversal-block');
    if (travBlock) travBlock.style.display = ngState.charType === '穿越者' ? 'flex' : 'none';
  });
});

// Traversal method buttons (in New Game wizard)
{
  const travPresets = $('ng-traversal-presets');
  if (travPresets) {
    travPresets.querySelectorAll('.traversal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        travPresets.querySelectorAll('.traversal-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        ngState.traversalMethod = btn.dataset.method;
        const hint = $('ng-traversal-hint');
        if (hint) hint.textContent = NG_TRAVERSAL_HINTS[ngState.traversalMethod] || '';
        const desc = $('ng-traversal-desc');
        if (desc) desc.style.display = ngState.traversalMethod === 'custom' ? 'block' : 'none';
      });
    });
    const travDescEl = $('ng-traversal-desc');
    if (travDescEl) travDescEl.addEventListener('input', () => { ngState.traversalDesc = travDescEl.value; });
  }
}

['modal-new-game'].forEach(id => {
  $(id).addEventListener('click', e => { if (e.target === $(id)) $(id).style.display = 'none'; });
});

// Stat float
$('btn-stat-toggle').addEventListener('click', toggleStatFloat);
$('btn-stat-close').addEventListener('click', () => {
  state.statFloat.visible = false;
  statFloat.style.display = 'none';
  $('btn-stat-toggle').classList.remove('active');
});
$('btn-stat-refresh').addEventListener('click', () => {
  if (state.latestStatData) renderStatFloat(state.latestStatData);
  else if (state.currentSessionId) {
    api('GET', `/sessions/${state.currentSessionId}/stat`)
      .then(d => updateStatData(d))
      .catch(e => toast('刷新失败: ' + e.message, 'error'));
  }
});

PanelManager.make(statFloat, {
  storageKey: 'stat-float',
  handleSel:  '.stat-float-header',
  resizable:  true,
  minWidth:   340,
  minHeight:  240,
});

// ─── Shop Navigation ──────────────────────────────────────────────────────────

$('btn-shop').addEventListener('click', () => {
  stopGeneration();
  const id = state.currentSessionId;
  window.location.href = id ? `/shop?session=${encodeURIComponent(id)}` : '/shop';
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await refreshSessionList();
  // Auto-load session from URL param (e.g. returning from shop page)
  const urlSession = new URLSearchParams(window.location.search).get('session');
  if (urlSession) {
    await loadSession(urlSession);
    history.replaceState({}, '', '/');
  }
}
init().catch(console.error);
