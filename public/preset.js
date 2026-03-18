'use strict';

// ─── SillyTavern system-marker identifiers ───────────────────────────────────
// These appear in prompt_order but never have entries in prompts[].
const SYSTEM_MARKERS = new Set([
  'main', 'worldInfoBefore', 'worldInfoAfter', 'charDescription',
  'charPersonality', 'scenario', 'personaDescription',
  'chatHistory', 'dialogueExamples', 'nsfw',
]);

const SYSTEM_MARKER_LABELS = {
  main:               '【系统提示 / System Prompt】',
  worldInfoBefore:    '【世界书 (前插)】',
  worldInfoAfter:     '【世界书 (后插)】',
  charDescription:    '【角色描述】',
  charPersonality:    '【角色性格】',
  scenario:           '【场景】',
  personaDescription: '【用户角色设定】',
  chatHistory:        '【对话历史】',
  dialogueExamples:   '【对话示例】',
  nsfw:               '【NSFW】',
};

// ─── State ────────────────────────────────────────────────────────────────────

let presetData   = null;   // raw JSON object
let presetPath   = '';
let isDirty      = false;
let editingPromptIdentifier = null;  // identifier of prompt being edited
let editingRegexIdx = -1;

// ─── DOM helpers ─────────────────────────────────────────────────────────────

const $           = (id) => document.getElementById(id);
const toastContainer = $('toast-container');

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

async function confirmDanger(message, title = '确认操作', confirmText = '确认') {
  if (window.UIFeedback) {
    return window.UIFeedback.confirmDanger({ title, message, confirmText });
  }
  return confirm(message);
}

function markDirty() {
  isDirty = true;
  $('btn-save').textContent = '💾 保存 *';
  $('btn-save').classList.add('dirty');
}

function clearDirty() {
  isDirty = false;
  $('btn-save').textContent = '💾 保存';
  $('btn-save').classList.remove('dirty');
}

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─── Preset data helpers ──────────────────────────────────────────────────────

function ensurePresetStructure() {
  if (!presetData) presetData = {};
  if (!Array.isArray(presetData.prompts)) presetData.prompts = [];
  if (!Array.isArray(presetData.prompt_order)) presetData.prompt_order = [];
  // Ensure at least one order slot
  if (!presetData.prompt_order[0]) {
    presetData.prompt_order[0] = { character_id: 100001, order: [] };
  }
  if (!Array.isArray(presetData.prompt_order[0].order)) {
    presetData.prompt_order[0].order = [];
  }
  if (!presetData.extensions) presetData.extensions = {};
  if (!presetData.extensions.SPreset) presetData.extensions.SPreset = {};
  if (!presetData.extensions.SPreset.RegexBinding) presetData.extensions.SPreset.RegexBinding = {};
  if (!Array.isArray(presetData.extensions.SPreset.RegexBinding.regexes)) {
    presetData.extensions.SPreset.RegexBinding.regexes = [];
  }
}

/** Returns the prompt_order[0].order array */
function getOrderList() {
  return presetData.prompt_order[0].order;
}

/** Build identifier → prompt-object map */
function buildPromptMap() {
  const map = {};
  (presetData.prompts || []).forEach(p => { if (p.identifier) map[p.identifier] = p; });
  return map;
}

/** Find index of a prompt in prompts[] by identifier */
function findPromptIdx(identifier) {
  return (presetData.prompts || []).findIndex(p => p.identifier === identifier);
}

// ─── Regex compile (mirrors backend) ─────────────────────────────────────────

function compileRegex(findRegex) {
  if (!findRegex) return null;
  const m = findRegex.match(/^\/(.+)\/([gimsuy]*)$/s);
  if (m) {
    try { return new RegExp(m[1], m[2] || 'g'); } catch (_) { return null; }
  }
  try { return new RegExp(findRegex, 'g'); } catch (_) { return null; }
}

// ─── Load / Save ──────────────────────────────────────────────────────────────

async function loadFromServer() {
  if (window.UIFeedback) {
    $('prompt-list').innerHTML = window.UIFeedback.renderLoadingLines(5);
    $('regex-list').innerHTML = window.UIFeedback.renderLoadingLines(3);
  }
  try {
    const res  = await fetch('/api/preset/data');
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    presetData = json.data;
    presetPath = json.path || '(unknown)';
    $('preset-path-label').textContent = presetPath;
    ensurePresetStructure();
    renderPromptList();
    renderRegexList();
    clearDirty();
    toast('预设已加载', 'success');
  } catch (e) {
    toast('加载失败: ' + e.message, 'error');
    $('preset-path-label').textContent = '加载失败: ' + e.message;
  }
}

async function saveToServer() {
  if (!presetData) { toast('没有数据可保存', 'error'); return; }
  try {
    $('btn-save').disabled = true;
    const res = await fetch('/api/preset/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: presetData }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || res.statusText);
    clearDirty();
    toast('预设已保存', 'success');
  } catch (e) {
    toast('保存失败: ' + e.message, 'error');
  } finally {
    $('btn-save').disabled = false;
  }
}


// ─── Tabs ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'phases') renderPhaseView();
  });
});

// ─── Drag & Drop for Sortable Lists ───────────────────────────────────────────

let dragSrcEl   = null;
let dragSrcList = null;

function makeDraggable(rowEl, listId, arr, onReorder) {
  rowEl.draggable = true;

  rowEl.addEventListener('dragstart', (e) => {
    dragSrcEl   = rowEl;
    dragSrcList = listId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(rowEl, 0, 0);
    setTimeout(() => rowEl.classList.add('dragging'), 0);
  });

  rowEl.addEventListener('dragend', () => {
    rowEl.classList.remove('dragging');
    document.querySelectorAll(`#${listId} .drag-over`).forEach(el => el.classList.remove('drag-over'));
    dragSrcEl   = null;
    dragSrcList = null;
  });

  rowEl.addEventListener('dragover', (e) => {
    if (dragSrcList !== listId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll(`#${listId} .drag-over`).forEach(el => el.classList.remove('drag-over'));
    if (rowEl !== dragSrcEl) rowEl.classList.add('drag-over');
  });

  rowEl.addEventListener('drop', (e) => {
    if (dragSrcList !== listId || !dragSrcEl || dragSrcEl === rowEl) return;
    e.preventDefault();
    rowEl.classList.remove('drag-over');

    const listEl = $(listId);
    const rows   = [...listEl.querySelectorAll(':scope > .prompt-row')];
    const srcIdx = rows.indexOf(dragSrcEl);
    const dstIdx = rows.indexOf(rowEl);
    if (srcIdx < 0 || dstIdx < 0) return;

    const [moved] = arr.splice(srcIdx, 1);
    arr.splice(dstIdx, 0, moved);
    onReorder();
    markDirty();
  });
}

// ─── Prompt List (uses prompt_order[0].order as source of truth) ──────────────

function renderPromptList() {
  const listEl    = $('prompt-list');
  const orderList = getOrderList();
  const promptMap = buildPromptMap();

  $('prompt-count').textContent = orderList.length;

  if (!orderList.length) {
    listEl.innerHTML = '<div class="empty-hint">暂无提示词条目（prompt_order 为空）</div>';
    return;
  }

  listEl.innerHTML = '';
  orderList.forEach((orderEntry, idx) => {
    const promptEntry = promptMap[orderEntry.identifier] || null;
    const isMarker    = SYSTEM_MARKERS.has(orderEntry.identifier) && !promptEntry;
    const row = buildPromptRow(orderEntry, promptEntry, isMarker, idx, orderList);
    listEl.appendChild(row);
  });
}

// WB ext-position labels
const WB_POS_LABELS = {
  '0': '系统前',
  '1': '系统后',
  '4': '用户消息',
};

function buildPromptRow(orderEntry, promptEntry, isMarker, idx, orderList) {
  const row     = document.createElement('div');
  const enabled = orderEntry.enabled !== false;
  const isWb    = promptEntry && promptEntry._wb === true;

  const name = isMarker
    ? (SYSTEM_MARKER_LABELS[orderEntry.identifier] || `【${orderEntry.identifier}】`)
    : (promptEntry?.name || orderEntry.identifier || '(未命名)');

  row.className = 'prompt-row'
    + (!enabled   ? ' disabled-row' : '')
    + (isMarker   ? ' marker-row'   : '')
    + (isWb       ? ' wb-row'       : '');

  // Badges
  let badges = '';
  if (isMarker) {
    badges += `<span class="row-badge marker">系统标记</span>`;
  } else if (isWb) {
    const extPos = String(promptEntry._wbData?.extensions?.position ?? '0');
    const posLabel = WB_POS_LABELS[extPos] || extPos;
    badges += `<span class="row-badge wb-badge">世界书</span>`;
    badges += `<span class="row-badge role-system">${esc(posLabel)}</span>`;
    if (promptEntry._wbData?.constant) badges += `<span class="row-badge">常量</span>`;
  } else if (promptEntry) {
    const role = promptEntry.role || 'system';
    const roleClass = role === 'user' ? 'role-user' : role === 'assistant' ? 'role-asst' : 'role-system';
    badges += `<span class="row-badge ${roleClass}">${esc(role)}</span>`;
    if (promptEntry.system_prompt) badges += `<span class="row-badge role-system">主提示</span>`;
    if (promptEntry.marker)        badges += `<span class="row-badge marker">标记</span>`;
  }

  const metaInfo = isWb
    ? `插入序${promptEntry._wbData?.insertion_order ?? 100}`
    : (promptEntry ? `深度${promptEntry.injection_depth ?? 4}` : '');

  row.innerHTML = `
    <span class="drag-handle" title="拖拽排序">⠿</span>
    <div class="toggle-switch ${enabled ? 'on' : ''}" title="启用/禁用"></div>
    <span class="row-name" title="${esc(orderEntry.identifier)}">${esc(name)}</span>
    ${badges}
    ${metaInfo ? `<span class="row-meta">${esc(metaInfo)}</span>` : ''}
    <div class="row-actions">
      ${isMarker
        ? `<span style="font-size:11px;color:var(--text3);padding:0 6px">只读</span>`
        : `<button class="btn" data-action="edit">编辑</button>`}
    </div>
  `;

  // Toggle enabled
  row.querySelector('.toggle-switch').addEventListener('click', (e) => {
    e.stopPropagation();
    orderEntry.enabled = !enabled;
    row.classList.toggle('disabled-row', !orderEntry.enabled);
    row.querySelector('.toggle-switch').classList.toggle('on', orderEntry.enabled);
    // sync enabled into prompts[] entry too
    if (promptEntry) promptEntry.enabled = orderEntry.enabled;
    markDirty();
  });

  // Edit button — WB entries use their own modal
  if (!isMarker) {
    row.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isWb) openWbModal(orderEntry.identifier);
      else      openPromptModal(orderEntry.identifier);
    });
  }

  makeDraggable(row, 'prompt-list', orderList, renderPromptList);
  return row;
}

// ─── Prompt Modal ─────────────────────────────────────────────────────────────

function openPromptModal(identifier) {
  const isNew = !identifier;
  editingPromptIdentifier = identifier || null;

  const promptEntry = isNew ? null : presetData.prompts.find(p => p.identifier === identifier);

  const defaults = {
    identifier: '', name: '', enabled: true, content: '',
    role: 'system', system_prompt: false, marker: false,
    injection_position: 0, injection_depth: 4, forbid_overrides: false,
  };
  const p = promptEntry || defaults;

  $('modal-prompt-title').textContent = isNew ? '新建提示词' : '编辑提示词';
  $('pe-identifier').value           = p.identifier || '';
  $('pe-name').value                 = p.name || '';
  $('pe-role').value                 = p.role || 'system';
  $('pe-enabled').checked            = p.enabled !== false;
  $('pe-system-prompt').checked      = !!(p.system_prompt);
  $('pe-marker').checked             = !!(p.marker);
  $('pe-injection-position').value   = p.injection_position ?? 0;
  $('pe-injection-depth').value      = p.injection_depth ?? 4;
  $('pe-forbid-overrides').checked   = !!(p.forbid_overrides);
  $('pe-content').value              = p.content || '';

  $('btn-pe-delete').style.display = isNew ? 'none' : '';
  $('modal-prompt').style.display  = 'flex';
  $('pe-name').focus();
}

$('btn-pe-save').addEventListener('click', () => {
  const isNew = !editingPromptIdentifier;
  const newId = isNew ? ($('pe-identifier').value.trim() || generateId()) : editingPromptIdentifier;

  // Find or create the prompts[] entry
  let pIdx = findPromptIdx(newId);
  let p;
  if (pIdx < 0) {
    p = { identifier: newId };
    presetData.prompts.push(p);
    pIdx = presetData.prompts.length - 1;
  } else {
    p = presetData.prompts[pIdx];
  }

  p.identifier        = newId;
  p.name              = $('pe-name').value.trim();
  p.role              = $('pe-role').value;
  p.enabled           = $('pe-enabled').checked;
  p.system_prompt     = $('pe-system-prompt').checked;
  p.marker            = $('pe-marker').checked;
  p.injection_position = parseInt($('pe-injection-position').value) || 0;
  p.injection_depth   = parseInt($('pe-injection-depth').value) ?? 4;
  p.forbid_overrides  = $('pe-forbid-overrides').checked;
  p.content           = $('pe-content').value;

  // If new, also add to prompt_order
  if (isNew) {
    getOrderList().push({ identifier: newId, enabled: p.enabled });
  } else {
    // Sync enabled state into prompt_order entry too
    const orderEntry = getOrderList().find(e => e.identifier === newId);
    if (orderEntry) orderEntry.enabled = p.enabled;
  }

  $('modal-prompt').style.display = 'none';
  renderPromptList();
  markDirty();
  toast(isNew ? '已添加提示词' : '已更新提示词', 'success');
});

$('btn-pe-delete').addEventListener('click', () => {
  if (!editingPromptIdentifier) return;
  const pIdx = findPromptIdx(editingPromptIdentifier);
  const name = pIdx >= 0 ? presetData.prompts[pIdx]?.name || editingPromptIdentifier : editingPromptIdentifier;
  confirmDanger(`删除「${name}」？这同时会从排列顺序中移除。`, '删除提示词', '确认删除').then((ok) => {
    if (!ok) return;

    // Remove from prompts[]
    if (pIdx >= 0) presetData.prompts.splice(pIdx, 1);
    // Remove from prompt_order
    const oList = getOrderList();
    const oIdx  = oList.findIndex(e => e.identifier === editingPromptIdentifier);
    if (oIdx >= 0) oList.splice(oIdx, 1);

    $('modal-prompt').style.display = 'none';
    renderPromptList();
    markDirty();
    toast('已删除', 'info');
  });
});

$('btn-pe-cancel').addEventListener('click', () => { $('modal-prompt').style.display = 'none'; });

$('btn-add-prompt').addEventListener('click', () => openPromptModal(null));

// ─── Worldbook Entry Modal ────────────────────────────────────────────────────

let editingWbIdentifier = null;
let creatingWbForPhase  = null;   // non-null when creating a new entry from a phase section

/**
 * Open the WB modal.
 * @param {string|null} identifier  - existing entry ID, or null to create new
 * @param {number|null} forPhase    - when creating: pre-assign to this phase
 */
function openWbModal(identifier, forPhase = null) {
  editingWbIdentifier = identifier;
  creatingWbForPhase  = identifier ? null : forPhase;

  const isNew = !identifier;
  const promptEntry = isNew ? null : (presetData.prompts || []).find(p => p.identifier === identifier);
  if (!isNew && !promptEntry) return;

  // Defaults for new entries
  const defaultExtPos = (forPhase === 1 || forPhase === 3 || forPhase === 4) ? 4 : 0;
  const defaultDepth  = (forPhase === 1 || forPhase === 3 || forPhase === 4) ? 0 : 4;
  const defaultOrder  = isNew ? computeNextInsertionOrder(forPhase) : 100;
  const wb = promptEntry?._wbData || {};

  $('modal-wb-title').textContent = isNew ? '新建世界书原子' : '编辑世界书条目';
  $('wb-name').value             = promptEntry?.name || '';
  $('wb-content').value          = promptEntry?.content || '';
  $('wb-enabled').checked        = promptEntry?.enabled !== false;
  $('wb-constant').checked       = isNew ? true : (wb.constant !== false);
  $('wb-selective').checked      = isNew ? true : (wb.selective !== false);
  $('wb-insertion-order').value  = isNew ? defaultOrder : (wb.insertion_order ?? 100);
  $('wb-depth').value            = isNew ? defaultDepth : (wb.extensions?.depth ?? 4);
  $('wb-ext-position').value     = isNew ? String(defaultExtPos) : String(wb.extensions?.position ?? 0);
  $('wb-keys').value             = (wb.keys || []).join(', ');

  // ── Phase assignment ──────────────────────────────────────────────────────
  let explicitPhases;
  if (isNew && forPhase) {
    explicitPhases = [forPhase];
  } else {
    explicitPhases = Array.isArray(wb._phases) ? wb._phases : null;
  }
  const isAuto = !explicitPhases || explicitPhases.length === 0;
  $('wb-phase-auto').checked  = isAuto;
  $('wb-phase-1').checked     = !isAuto && explicitPhases.includes(1);
  $('wb-phase-3').checked     = !isAuto && explicitPhases.includes(3);
  $('wb-phase-4').checked     = !isAuto && explicitPhases.includes(4);
  $('wb-phase-manual').style.opacity = isAuto ? '0.4' : '1';
  $('wb-phase-manual').style.pointerEvents = isAuto ? 'none' : '';
  updateWbPhaseDerivedHint(promptEntry);

  $('btn-wb-delete').style.display = isNew ? 'none' : '';

  $('modal-wb').style.display = 'flex';
  $('wb-name').focus();
}

/** Compute a sensible next insertion_order for a new entry in a given phase */
function computeNextInsertionOrder(phaseId) {
  if (!phaseId) return 500;
  const entries = (presetData.prompts || []).filter(p => p._wb);
  const inPhase = entries.filter(p => deriveEntryPhases(p).includes(phaseId));
  if (!inPhase.length) {
    // Default starting orders by phase
    return phaseId === 1 ? 1009 : phaseId === 4 ? 1000 : 200;
  }
  const orders = inPhase.map(p => p._wbData?.insertion_order ?? 100);
  return Math.max(...orders) + 10;
}

/** Update the "auto-derived phases" hint line in the WB modal */
function updateWbPhaseDerivedHint(promptEntry) {
  const hint = $('wb-phase-derived-hint');
  if (!$('wb-phase-auto').checked) { hint.textContent = ''; return; }
  const derived = deriveEntryPhases(promptEntry);
  hint.textContent = '推导结果：' + derived.map(n => `阶段${n}`).join(' + ');
}

/** Mirror of promptBuilder.getEntryPhases for client-side preview */
function deriveEntryPhases(promptEntry) {
  const wb = promptEntry?._wbData || {};
  if (Array.isArray(wb._phases) && wb._phases.length > 0) return wb._phases;
  const extPos = wb.extensions?.position ?? 0;
  const depth  = wb.extensions?.depth    ?? 4;
  const order  = wb.insertion_order      ?? 100;
  const content = promptEntry?.content || '';
  if (extPos === 0 || extPos === 1) return [1, 3];
  if (extPos === 4 && depth === 0) {
    if (content.includes('<status_current_variables>')) return [3, 4];
    return order >= 990 ? [4] : [3];
  }
  return [1, 3];
}

// auto/manual toggle
$('wb-phase-auto').addEventListener('change', () => {
  const isAuto = $('wb-phase-auto').checked;
  $('wb-phase-manual').style.opacity = isAuto ? '0.4' : '1';
  $('wb-phase-manual').style.pointerEvents = isAuto ? 'none' : '';
  if (isAuto) {
    const promptEntry = (presetData.prompts || []).find(p => p.identifier === editingWbIdentifier);
    updateWbPhaseDerivedHint(promptEntry);
  } else {
    $('wb-phase-derived-hint').textContent = '';
  }
});

$('btn-wb-save').addEventListener('click', () => {
  const isNew = !editingWbIdentifier;

  const extPos       = parseInt($('wb-ext-position').value) || 0;
  const depth        = parseInt($('wb-depth').value) ?? 4;
  const insertionOrd = parseInt($('wb-insertion-order').value) ?? 100;
  const keysRaw      = $('wb-keys').value.trim();
  const keys         = keysRaw ? keysRaw.split(',').map(k => k.trim()).filter(Boolean) : [];

  // Resolve phases
  let phasesVal = null;
  if (!$('wb-phase-auto').checked) {
    const phases = [];
    if ($('wb-phase-1').checked) phases.push(1);
    if ($('wb-phase-3').checked) phases.push(3);
    if ($('wb-phase-4').checked) phases.push(4);
    phasesVal = phases.length > 0 ? phases : null;
  }

  if (isNew) {
    // ── Create new WB entry ─────────────────────────────────────────────
    const newId    = 'wb_new_' + generateId().replace(/-/g, '').slice(0, 12);
    const newEntry = {
      identifier: newId,
      name:    $('wb-name').value.trim() || '新建原子',
      content: $('wb-content').value,
      enabled: $('wb-enabled').checked,
      role:    'system',
      system_prompt: false,
      marker: false,
      injection_position: 0,
      injection_depth: depth,
      injection_order: insertionOrd,
      forbid_overrides: false,
      _wb: true,
      _wbData: {
        id:              Date.now(),
        keys,
        secondary_keys:  [],
        position:        extPos === 4 ? 'after_char' : 'before_char',
        insertion_order: insertionOrd,
        constant:        $('wb-constant').checked,
        selective:       $('wb-selective').checked,
        use_regex:       true,
        extensions: { position: extPos, depth, probability: 100, useProbability: true },
        _phases: phasesVal,
      },
    };
    presetData.prompts.push(newEntry);
    // Insert into prompt_order before nsfw pivot (or at end if not found)
    const orderList  = getOrderList();
    const nsfwIdx    = orderList.findIndex(e => e.identifier === 'nsfw');
    const insertAt   = nsfwIdx >= 0 ? nsfwIdx : orderList.length;
    orderList.splice(insertAt, 0, { identifier: newId, enabled: newEntry.enabled });

    editingWbIdentifier = newId;
    $('modal-wb').style.display = 'none';
    renderPromptList();
    if ($('tab-phases').classList.contains('active')) renderPhaseView();
    markDirty();
    toast('世界书原子已创建', 'success');
    return;
  }

  // ── Edit existing entry ───────────────────────────────────────────────
  const promptEntry = (presetData.prompts || []).find(p => p.identifier === editingWbIdentifier);
  if (!promptEntry) return;

  promptEntry.name    = $('wb-name').value.trim();
  promptEntry.content = $('wb-content').value;
  promptEntry.enabled = $('wb-enabled').checked;

  if (!promptEntry._wbData) promptEntry._wbData = {};
  promptEntry._wbData.constant        = $('wb-constant').checked;
  promptEntry._wbData.selective       = $('wb-selective').checked;
  promptEntry._wbData.insertion_order = insertionOrd;
  promptEntry._wbData.keys            = keys;
  if (!promptEntry._wbData.extensions) promptEntry._wbData.extensions = {};
  promptEntry._wbData.extensions.position = extPos;
  promptEntry._wbData.extensions.depth    = depth;
  promptEntry._wbData.position  = extPos === 4 ? 'after_char' : 'before_char';
  promptEntry._wbData._phases   = phasesVal;

  const orderEntry = getOrderList().find(e => e.identifier === editingWbIdentifier);
  if (orderEntry) orderEntry.enabled = promptEntry.enabled;

  $('modal-wb').style.display = 'none';
  renderPromptList();
  if ($('tab-phases').classList.contains('active')) renderPhaseView();
  markDirty();
  toast('世界书条目已更新', 'success');
});

$('btn-wb-delete').addEventListener('click', () => {
  if (!editingWbIdentifier) return;
  const pIdx = findPromptIdx(editingWbIdentifier);
  const name = pIdx >= 0 ? presetData.prompts[pIdx]?.name || editingWbIdentifier : editingWbIdentifier;
  confirmDanger(`删除世界书原子「${name}」？此操作不可撤销。`, '删除世界书原子', '确认删除').then((ok) => {
    if (!ok) return;
    if (pIdx >= 0) presetData.prompts.splice(pIdx, 1);
    const oList = getOrderList();
    const oIdx  = oList.findIndex(e => e.identifier === editingWbIdentifier);
    if (oIdx >= 0) oList.splice(oIdx, 1);
    $('modal-wb').style.display = 'none';
    renderPromptList();
    if ($('tab-phases').classList.contains('active')) renderPhaseView();
    markDirty();
    toast('已删除', 'info');
  });
});

$('btn-wb-cancel').addEventListener('click', () => { $('modal-wb').style.display = 'none'; });

$('modal-wb').addEventListener('click', e => { if (e.target === $('modal-wb')) $('modal-wb').style.display = 'none'; });

// ─── Phase View ───────────────────────────────────────────────────────────────

const PHASE_META = {
  1: { label: '阶段1 · 规划',  color: '#7c3aed' },
  3: { label: '阶段3 · 生成',  color: '#0369a1' },
  4: { label: '阶段4 · 更新',  color: '#065f46' },
};

// Per-phase open/collapsed state
const phaseOpen = { 1: true, 3: true, 4: true };

// Drag-and-drop state for phase rows
let phaseDragSrc     = null;
let phaseDragPhaseId = null;

function renderPhaseView() {
  const allWb     = (presetData.prompts || []).filter(p => p._wb === true);
  const container = $('phase-view');
  container.innerHTML = '';

  [1, 3, 4].forEach(phaseId => {
    const meta    = PHASE_META[phaseId];
    const entries = allWb
      .filter(p => deriveEntryPhases(p).includes(phaseId))
      .sort((a, b) => (a._wbData?.insertion_order ?? 100) - (b._wbData?.insertion_order ?? 100));

    const section = document.createElement('div');
    section.className = 'phase-section';

    // ── Section header ──────────────────────────────────────────────────
    const header = document.createElement('div');
    header.className = 'phase-section-header';
    header.innerHTML = `
      <span class="phase-dot" style="background:${meta.color}"></span>
      <span>${esc(meta.label)}</span>
      <span class="item-count">${entries.length}</span>
      <button class="btn phase-add-btn" title="在此阶段新建原子" style="margin-left:8px;padding:2px 8px;font-size:11px">＋ 新建</button>
      <span class="phase-section-toggle" style="margin-left:auto">${phaseOpen[phaseId] ? '▾' : '▸'}</span>
    `;

    header.querySelector('.phase-add-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openWbModal(null, phaseId);
    });

    // ── Section body ────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'phase-section-body';
    body.id = `phase-body-${phaseId}`;
    body.style.display = phaseOpen[phaseId] ? '' : 'none';

    // Drop zone events for the body (empty-target drop)
    body.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    body.addEventListener('drop', e => {
      e.preventDefault();
      if (phaseDragSrc && phaseDragPhaseId === phaseId) {
        // Dropped on empty space → move to end
        const rows = [...body.querySelectorAll('.phase-entry-row[data-id]')];
        const srcIdx = rows.indexOf(phaseDragSrc);
        if (srcIdx >= 0) {
          body.appendChild(phaseDragSrc);
          reindexPhaseOrder(phaseId, body);
        }
      }
    });

    if (entries.length === 0) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.style.cssText = 'padding:12px 14px';
      hint.textContent = '暂无条目分配到此阶段 — 点击「＋ 新建」创建原子';
      body.appendChild(hint);
    } else {
      entries.forEach(p => body.appendChild(buildPhaseEntryRow(p, phaseId)));
    }

    // Toggle collapse
    header.addEventListener('click', (e) => {
      if (e.target.closest('.phase-add-btn')) return;
      phaseOpen[phaseId] = !phaseOpen[phaseId];
      body.style.display = phaseOpen[phaseId] ? '' : 'none';
      header.querySelector('.phase-section-toggle').textContent = phaseOpen[phaseId] ? '▾' : '▸';
    });

    section.appendChild(header);
    section.appendChild(body);
    container.appendChild(section);
  });
}

function buildPhaseEntryRow(promptEntry, phaseId) {
  const row = document.createElement('div');
  row.className = 'prompt-row phase-entry-row';
  row.dataset.id = promptEntry.identifier;
  row.draggable  = true;

  const wb        = promptEntry._wbData || {};
  const allPhases = deriveEntryPhases(promptEntry);
  const isExplicit = Array.isArray(wb._phases) && wb._phases.length > 0;
  const enabled   = promptEntry.enabled !== false;
  if (!enabled) row.classList.add('disabled-row');

  const phaseBadges = allPhases.map(n => {
    const color = n === 1 ? '#7c3aed' : n === 3 ? '#0369a1' : '#065f46';
    return `<span class="row-badge phase-badge" style="background:${color};border-color:${color}">P${n}</span>`;
  }).join('');

  const autoTag = !isExplicit
    ? `<span class="row-badge" style="font-style:italic;opacity:0.65;font-size:10px">自动</span>` : '';
  const orderTag = `<span class="row-meta" title="insertion_order">#${wb.insertion_order ?? '?'}</span>`;

  row.innerHTML = `
    <span class="drag-handle phase-drag-handle" title="拖拽排序">⠿</span>
    <div class="toggle-switch ${enabled ? 'on' : ''}" title="启用/禁用"></div>
    <span class="row-name" title="${esc(promptEntry.identifier)}">${esc(promptEntry.name || promptEntry.identifier)}</span>
    ${phaseBadges}
    ${autoTag}
    ${orderTag}
    <div class="row-actions" style="margin-left:auto;gap:4px">
      <button class="btn" data-action="edit" title="编辑内容与设置">编辑</button>
      <button class="btn danger-soft" data-action="remove" title="从此阶段移除">✕</button>
    </div>
  `;

  // Toggle enabled
  row.querySelector('.toggle-switch').addEventListener('click', (e) => {
    e.stopPropagation();
    promptEntry.enabled = !enabled;
    const orderEntry = getOrderList().find(oe => oe.identifier === promptEntry.identifier);
    if (orderEntry) orderEntry.enabled = promptEntry.enabled;
    renderPhaseView();
    markDirty();
  });

  // Edit
  row.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
    e.stopPropagation();
    openWbModal(promptEntry.identifier);
  });

  // Remove from this phase
  row.querySelector('[data-action="remove"]').addEventListener('click', (e) => {
    e.stopPropagation();
    removeEntryFromPhase(promptEntry, phaseId);
  });

  // ── Drag-and-drop (within phase) ──────────────────────────────────────
  row.addEventListener('dragstart', (e) => {
    phaseDragSrc     = row;
    phaseDragPhaseId = phaseId;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => row.classList.add('dragging'), 0);
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    document.querySelectorAll('.phase-entry-row.drag-over').forEach(r => r.classList.remove('drag-over'));
    phaseDragSrc     = null;
    phaseDragPhaseId = null;
  });
  row.addEventListener('dragover', (e) => {
    if (phaseDragPhaseId !== phaseId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.phase-entry-row.drag-over').forEach(r => r.classList.remove('drag-over'));
    if (row !== phaseDragSrc) row.classList.add('drag-over');
  });
  row.addEventListener('drop', (e) => {
    if (phaseDragPhaseId !== phaseId || !phaseDragSrc || phaseDragSrc === row) return;
    e.preventDefault();
    row.classList.remove('drag-over');
    const body = row.closest('.phase-section-body');
    if (!body) return;
    // Insert before target
    body.insertBefore(phaseDragSrc, row);
    reindexPhaseOrder(phaseId, body);
  });

  return row;
}

/**
 * After drag reorder: reassign insertion_order values for all entries in the
 * phase body's current DOM order, preserving spacing between other phases.
 */
function reindexPhaseOrder(phaseId, bodyEl) {
  const rows = [...bodyEl.querySelectorAll('.phase-entry-row[data-id]')];
  if (!rows.length) return;

  // Get the current set of orders for all WB entries NOT in this phase
  // to find a safe gap range. Use a base that doesn't collide:
  // Phase 1: 1000–1099, Phase 3: 100–899, Phase 4: 900–999 (rough defaults)
  const BASE = { 1: 1000, 3: 100, 4: 900 };
  const step = 10;
  let orderVal = BASE[phaseId] ?? 100;

  rows.forEach(r => {
    const id    = r.dataset.id;
    const entry = (presetData.prompts || []).find(p => p.identifier === id);
    if (entry && entry._wbData) {
      entry._wbData.insertion_order = orderVal;
      r.querySelector('.row-meta').textContent = `#${orderVal}`;
      orderVal += step;
    }
  });
  markDirty();
}

/**
 * Remove an entry from a specific phase (without deleting the entry).
 * - If explicit phases: remove phaseId from the array
 * - If auto-derive: compute derived phases, remove phaseId, set explicit
 * - If only one phase left: warns user, still allows it (entry just leaves this phase)
 */
async function removeEntryFromPhase(promptEntry, phaseId) {
  const wb     = promptEntry._wbData || {};
  const current = Array.isArray(wb._phases) && wb._phases.length > 0
    ? [...wb._phases]
    : deriveEntryPhases(promptEntry);

  const remaining = current.filter(n => n !== phaseId);
  if (remaining.length === 0) {
    const ok = await confirmDanger(
      `「${promptEntry.name || promptEntry.identifier}」将不再属于任何阶段（仍会保留在条目列表中）。确定移除？`,
      '移除阶段归属',
      '确认移除'
    );
    if (!ok) return;
  }
  if (!promptEntry._wbData) promptEntry._wbData = {};
  promptEntry._wbData._phases = remaining.length > 0 ? remaining : [];
  renderPhaseView();
  markDirty();
  toast('已从此阶段移除', 'info');
}

// ─── Regex List ───────────────────────────────────────────────────────────────

function renderRegexList() {
  const listEl = $('regex-list');
  const rules  = presetData?.extensions?.SPreset?.RegexBinding?.regexes || [];
  $('regex-count').textContent = rules.length;

  if (!rules.length) {
    listEl.innerHTML = '<div class="empty-hint">暂无正则规则</div>';
    return;
  }

  listEl.innerHTML = '';
  rules.forEach((r, idx) => {
    const row = buildRegexRow(r, idx, rules);
    listEl.appendChild(row);
  });
}

function buildRegexRow(r, idx, arr) {
  const row     = document.createElement('div');
  const enabled = !r.disabled;
  row.className = 'prompt-row' + (!enabled ? ' disabled-row' : '');

  const places = r.placement || [];
  let placeBadge = '';
  if (places.includes(1) && places.includes(2)) {
    placeBadge = `<span class="row-badge placement-both">用户+AI</span>`;
  } else if (places.includes(1)) {
    placeBadge = `<span class="row-badge placement-user">用户</span>`;
  } else if (places.includes(2)) {
    placeBadge = `<span class="row-badge placement-ai">AI</span>`;
  }
  const modeBadge = r.markdownOnly
    ? `<span class="row-badge">仅显示</span>`
    : r.promptOnly ? `<span class="row-badge">仅发送</span>` : '';

  const previewFind = (r.findRegex || '').substring(0, 50);

  row.innerHTML = `
    <span class="drag-handle" title="拖拽排序">⠿</span>
    <div class="toggle-switch ${enabled ? 'on' : ''}" title="启用/禁用"></div>
    <span class="row-name" title="${esc(r.findRegex || '')}">${esc(r.scriptName || '(未命名)')}</span>
    <span class="row-meta" style="font-family:monospace;font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.findRegex || '')}">${esc(previewFind)}</span>
    ${placeBadge}
    ${modeBadge}
    <div class="row-actions">
      <button class="btn" data-action="test" title="测试">▶</button>
      <button class="btn" data-action="edit">编辑</button>
    </div>
  `;

  row.querySelector('.toggle-switch').addEventListener('click', (e) => {
    e.stopPropagation();
    r.disabled = !r.disabled;
    row.classList.toggle('disabled-row', r.disabled);
    row.querySelector('.toggle-switch').classList.toggle('on', !r.disabled);
    markDirty();
  });

  row.querySelector('[data-action="test"]').addEventListener('click', (e) => {
    e.stopPropagation();
    openRegexModal(idx, true);
  });

  row.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
    e.stopPropagation();
    openRegexModal(idx, false);
  });

  makeDraggable(row, 'regex-list', arr, renderRegexList);
  return row;
}

// ─── Regex Modal ──────────────────────────────────────────────────────────────

function openRegexModal(idx, focusTest = false) {
  const isNew = idx === -1;
  editingRegexIdx = idx;

  const r = isNew ? {
    id: generateId(), scriptName: '', findRegex: '', replaceString: '',
    placement: [2], disabled: false,
    markdownOnly: false, promptOnly: false, runOnEdit: false,
    minDepth: null, maxDepth: null,
  } : presetData.extensions.SPreset.RegexBinding.regexes[idx];

  $('modal-regex-title').textContent = isNew ? '新建正则规则' : '编辑正则规则';
  $('re-name').value            = r.scriptName || '';
  $('re-find').value            = r.findRegex || '';
  $('re-replace').value         = r.replaceString || '';
  $('re-min-depth').value       = r.minDepth ?? '';
  $('re-max-depth').value       = r.maxDepth ?? '';
  $('re-place-user').checked    = (r.placement || []).includes(1);
  $('re-place-ai').checked      = (r.placement || []).includes(2);
  $('re-enabled').checked       = !r.disabled;
  $('re-markdown-only').checked = !!(r.markdownOnly);
  $('re-prompt-only').checked   = !!(r.promptOnly);
  $('re-run-on-edit').checked   = !!(r.runOnEdit);
  $('re-test-input').value      = '';
  $('re-test-output').textContent = '（点击测试查看结果）';
  $('re-test-output').className   = 'test-output empty';

  $('btn-re-delete').style.display = isNew ? 'none' : '';
  $('modal-regex').style.display   = 'flex';
  if (focusTest) $('re-test-input').focus();
  else $('re-name').focus();
}

$('btn-re-test').addEventListener('click', () => {
  const findRegex  = $('re-find').value.trim();
  const replaceStr = $('re-replace').value;
  const testInput  = $('re-test-input').value;
  const outputEl   = $('re-test-output');

  if (!findRegex) {
    outputEl.textContent = '请先填写查找正则';
    outputEl.className   = 'test-output error';
    return;
  }
  const re = compileRegex(findRegex);
  if (!re) {
    outputEl.textContent = '正则表达式无效';
    outputEl.className   = 'test-output error';
    return;
  }
  try {
    re.lastIndex = 0;
    const result = testInput.replace(re, replaceStr);
    if (result === testInput) {
      outputEl.textContent = '（无匹配，输出与输入相同）';
      outputEl.className   = 'test-output empty';
    } else {
      outputEl.textContent = result;
      outputEl.className   = 'test-output';
    }
  } catch (e) {
    outputEl.textContent = '执行错误: ' + e.message;
    outputEl.className   = 'test-output error';
  }
});

$('btn-re-save').addEventListener('click', () => {
  const isNew = editingRegexIdx === -1;
  const rules  = presetData.extensions.SPreset.RegexBinding.regexes;
  const r      = isNew ? { id: generateId() } : rules[editingRegexIdx];

  r.scriptName    = $('re-name').value.trim();
  r.findRegex     = $('re-find').value;
  r.replaceString = $('re-replace').value;

  const minD = $('re-min-depth').value;
  const maxD = $('re-max-depth').value;
  r.minDepth = minD !== '' ? parseInt(minD) : null;
  r.maxDepth = maxD !== '' ? parseInt(maxD) : null;

  const placement = [];
  if ($('re-place-user').checked) placement.push(1);
  if ($('re-place-ai').checked)   placement.push(2);
  r.placement = placement;

  r.disabled     = !$('re-enabled').checked;
  r.markdownOnly = $('re-markdown-only').checked;
  r.promptOnly   = $('re-prompt-only').checked;
  r.runOnEdit    = $('re-run-on-edit').checked;

  if (isNew) rules.push(r);

  $('modal-regex').style.display = 'none';
  renderRegexList();
  markDirty();
  toast(isNew ? '已添加规则' : '已更新规则', 'success');
});

$('btn-re-delete').addEventListener('click', () => {
  if (editingRegexIdx < 0) return;
  const rules = presetData.extensions.SPreset.RegexBinding.regexes;
  const name  = rules[editingRegexIdx]?.scriptName || '该规则';
  confirmDanger(`删除「${name}」？`, '删除正则规则', '确认删除').then((ok) => {
    if (!ok) return;
    rules.splice(editingRegexIdx, 1);
    $('modal-regex').style.display = 'none';
    renderRegexList();
    markDirty();
    toast('已删除', 'info');
  });
});

$('btn-re-cancel').addEventListener('click', () => { $('modal-regex').style.display = 'none'; });

$('btn-add-regex').addEventListener('click', () => openRegexModal(-1));

// ─── Toolbar Buttons ──────────────────────────────────────────────────────────

$('btn-save').addEventListener('click', saveToServer);
$('btn-reload').addEventListener('click', () => {
  if (!isDirty) {
    loadFromServer();
    return;
  }
  confirmDanger('有未保存的修改，确认重新加载？', '重新加载', '确认重载')
    .then((ok) => { if (ok) loadFromServer(); });
});

$('btn-back').addEventListener('click', async () => {
  if (isDirty) {
    const ok = await confirmDanger('有未保存的修改，确认离开？', '离开页面', '确认离开');
    if (!ok) return;
  }
  window.location.href = '/';
});

// Close modals on overlay click (modal-wb is handled in its own section above)
['modal-prompt', 'modal-regex'].forEach(id => {
  $(id).addEventListener('click', e => { if (e.target === $(id)) $(id).style.display = 'none'; });
});

// ─── Init ─────────────────────────────────────────────────────────────────────

loadFromServer();
