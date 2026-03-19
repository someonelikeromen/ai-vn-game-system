'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function toast(msg, type = 'ok', dur = 3000) {
  if (window.UIFeedback) {
    const map = { ok: 'success', err: 'error' };
    window.UIFeedback.toast(msg, { type: map[type] || 'info', duration: dur });
    return;
  }
  const el = $('st-toast');
  el.textContent = msg;
  el.className = type;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = ''; }, dur);
}

// ── Dirty tracking ────────────────────────────────────────────────────────────
let dirty = false;
function markDirty() {
  dirty = true;
  $('btn-save').classList.add('dirty');
}
function clearDirty() {
  dirty = false;
  $('btn-save').classList.remove('dirty');
}

// ── Navigation ────────────────────────────────────────────────────────────────
document.querySelectorAll('.st-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.st-nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.st-panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    const panel = $('panel-' + item.dataset.panel);
    if (panel) panel.classList.add('active');
  });
});

// ── Toggle helper ─────────────────────────────────────────────────────────────
function bindToggle(toggleId, checkboxId) {
  const toggleEl = $(toggleId);
  const cbEl     = $(checkboxId);
  if (!toggleEl || !cbEl) return;

  function sync() {
    toggleEl.classList.toggle('on', cbEl.checked);
  }
  sync();

  toggleEl.closest('.st-toggle-row').addEventListener('click', () => {
    cbEl.checked = !cbEl.checked;
    sync();
    markDirty();
    toggleEl.dispatchEvent(new Event('change'));
  });
}

bindToggle('toggle-streaming', 'cfg-streaming');
bindToggle('toggle-mp-enabled', 'cfg-mp-enabled');

// Toggle multi-phase config visibility
$('cfg-mp-enabled').addEventListener('change', () => {
  $('mp-config').style.opacity = $('cfg-mp-enabled').checked ? '1' : '0.4';
  $('mp-config').style.pointerEvents = $('cfg-mp-enabled').checked ? '' : 'none';
});

// ── Password visibility toggle ────────────────────────────────────────────────
function bindEyeBtn(btnId, inputId) {
  const btn = $(btnId), inp = $(inputId);
  if (!btn || !inp) return;
  btn.addEventListener('click', () => {
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁' : '🙈';
  });
}
bindEyeBtn('btn-toggle-key',     'cfg-apikey');
bindEyeBtn('btn-toggle-shopkey', 'cfg-shop-apikey');

// Bind all phase API key toggle buttons via data-toggle-pw attribute
document.querySelectorAll('[data-toggle-pw]').forEach(btn => {
  const inputId = btn.getAttribute('data-toggle-pw');
  const inp = $(inputId);
  if (!inp) return;
  btn.addEventListener('click', () => {
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁' : '🙈';
  });
});

// ── Slider sync ───────────────────────────────────────────────────────────────
function bindSlider(rangeId, numberId) {
  const r = $(rangeId), n = $(numberId);
  if (!r || !n) return;
  r.addEventListener('input', () => { n.value = r.value; markDirty(); });
  n.addEventListener('input', () => { r.value = n.value; markDirty(); });
}
bindSlider('cfg-temperature-range', 'cfg-temperature');
bindSlider('cfg-rag-topk-range',    'cfg-rag-topk');

// ── Load config ───────────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    const cfg = await api('GET', '/config');
    $('cfg-baseurl').value       = cfg.baseUrl    || '';
    $('cfg-apikey').value        = cfg.apiKey     || '';
    $('cfg-model').value         = cfg.model      || '';
    $('cfg-temperature').value   = cfg.temperature ?? 1.0;
    $('cfg-temperature-range').value = cfg.temperature ?? 1.0;
    $('cfg-maxtokens').value     = cfg.maxTokens  || 30000;
    $('cfg-streaming').checked   = cfg.streaming !== false;
    $('toggle-streaming').classList.toggle('on', cfg.streaming !== false);

    $('cfg-shop-baseurl').value  = cfg.shopBaseUrl || '';
    $('cfg-shop-apikey').value   = cfg.shopApiKey  || '';
    $('cfg-shop-model').value    = cfg.shopModel   || '';
    const charState = cfg.shopCharStateOnRedeem || 'full';
    $('cfg-shop-charstate').value = charState;

    const mp = cfg.multiPhase || {};
    $('cfg-mp-enabled').checked  = mp.enabled !== false;
    $('toggle-mp-enabled').classList.toggle('on', mp.enabled !== false);
    $('cfg-p1-baseurl').value    = mp.phase1BaseUrl    || '';
    $('cfg-p1-apikey').value     = mp.phase1ApiKey     || '';
    $('cfg-p1-model').value      = mp.phase1Model      || '';
    $('cfg-p1-maxtokens').value  = mp.phase1MaxTokens  || 512;
    $('cfg-p3-baseurl').value    = mp.phase3BaseUrl    || '';
    $('cfg-p3-apikey').value     = mp.phase3ApiKey     || '';
    $('cfg-p3-model').value      = mp.phase3Model      || '';
    $('cfg-p3-maxtokens').value  = mp.phase3MaxTokens  || '';
    $('cfg-p4-baseurl').value    = mp.phase4BaseUrl    || '';
    $('cfg-p4-apikey').value     = mp.phase4ApiKey     || '';
    $('cfg-p4-model').value      = mp.phase4Model      || '';
    $('cfg-p4-maxtokens').value  = mp.phase4MaxTokens  || 2048;
    $('cfg-rag-topk').value      = mp.ragTopK          || 8;
    $('cfg-rag-topk-range').value = mp.ragTopK         || 8;
    $('mp-config').style.opacity = mp.enabled !== false ? '1' : '0.4';
    $('mp-config').style.pointerEvents = mp.enabled !== false ? '' : 'none';

    $('cfg-username').value      = cfg.userName       || '';
    $('cfg-alignment').value     = cfg.userAlignment  || '';
    $('cfg-traits').value        = cfg.userTraits     || '';
    $('cfg-userdesc').value      = cfg.userDescription|| '';

    clearDirty();
  } catch (e) {
    toast('加载配置失败：' + e.message, 'err');
  }
}

// ── Save config ───────────────────────────────────────────────────────────────
async function saveConfig() {
  const data = {
    baseUrl:       $('cfg-baseurl').value.trim(),
    apiKey:        $('cfg-apikey').value.trim(),
    model:         $('cfg-model').value.trim(),
    temperature:   parseFloat($('cfg-temperature').value) || 1.0,
    maxTokens:     parseInt($('cfg-maxtokens').value)     || 30000,
    streaming:     $('cfg-streaming').checked,

    shopBaseUrl:   $('cfg-shop-baseurl').value.trim(),
    shopApiKey:    $('cfg-shop-apikey').value.trim(),
    shopModel:     $('cfg-shop-model').value.trim(),
    shopCharStateOnRedeem: $('cfg-shop-charstate').value,

    multiPhase: {
      enabled:          $('cfg-mp-enabled').checked,
      phase1BaseUrl:    $('cfg-p1-baseurl').value.trim()  || undefined,
      phase1ApiKey:     $('cfg-p1-apikey').value.trim()   || undefined,
      phase1Model:      $('cfg-p1-model').value.trim()    || undefined,
      phase1MaxTokens:  parseInt($('cfg-p1-maxtokens').value) || 512,
      phase3BaseUrl:    $('cfg-p3-baseurl').value.trim()  || undefined,
      phase3ApiKey:     $('cfg-p3-apikey').value.trim()   || undefined,
      phase3Model:      $('cfg-p3-model').value.trim()    || undefined,
      phase3MaxTokens:  parseInt($('cfg-p3-maxtokens').value) || undefined,
      phase4BaseUrl:    $('cfg-p4-baseurl').value.trim()  || undefined,
      phase4ApiKey:     $('cfg-p4-apikey').value.trim()   || undefined,
      phase4Model:      $('cfg-p4-model').value.trim()    || undefined,
      phase4MaxTokens:  parseInt($('cfg-p4-maxtokens').value) || 2048,
      ragTopK:          parseInt($('cfg-rag-topk').value) || 8,
    },

    userName:        $('cfg-username').value.trim(),
    userAlignment:   $('cfg-alignment').value.trim(),
    userTraits:      $('cfg-traits').value.trim(),
    userDescription: $('cfg-userdesc').value.trim(),
  };

  try {
    await api('POST', '/config', data);
    toast('设置已保存 ✓', 'ok');
    clearDirty();
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
  }
}

$('btn-save').addEventListener('click', saveConfig);

// Mark dirty on input changes
document.querySelectorAll('.st-input, .st-select').forEach(el => {
  el.addEventListener('input', markDirty);
  el.addEventListener('change', markDirty);
});

// ── Fetch model lists ─────────────────────────────────────────────────────────
async function fetchModels(baseUrlId, apiKeyId, listContainerId, selectId) {
  const baseUrl = $(baseUrlId).value.trim();
  const apiKey  = $(apiKeyId).value.trim();
  if (!baseUrl) { toast('请先填写 API 地址', 'err'); return; }
  try {
    const params = new URLSearchParams({ baseUrl });
    if (apiKey) params.append('apiKey', apiKey);
    const res = await fetch('/api/models?' + params);
    const data = await res.json();
    const models = (data.models || data.data || []).map(m => typeof m === 'string' ? m : m.id).filter(Boolean);
    if (!models.length) { toast('未获取到模型列表', 'err'); return; }

    const container = $(listContainerId);
    const sel = $(selectId);
    sel.innerHTML = '<option value="">-- 从列表选择 --</option>';
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = opt.textContent = m;
      sel.appendChild(opt);
    });
    container.style.display = 'block';
    toast(`获取到 ${models.length} 个模型`, 'ok');
  } catch (e) {
    toast('获取列表失败：' + e.message, 'err');
  }
}

$('btn-fetch-models').addEventListener('click', () => fetchModels('cfg-baseurl', 'cfg-apikey', 'st-model-list', 'cfg-model-select'));
$('cfg-model-select').addEventListener('change', function () {
  if (this.value) { $('cfg-model').value = this.value; markDirty(); }
});

$('btn-fetch-shop-models').addEventListener('click', () => {
  fetchModels('cfg-shop-baseurl', 'cfg-shop-apikey', 'st-shop-model-list', 'cfg-shop-model-select');
});
$('cfg-shop-model-select').addEventListener('change', function () {
  if (this.value) { $('cfg-shop-model').value = this.value; markDirty(); }
});

// Phase model fetch helpers (fall back to main baseUrl/apiKey when phase field is empty)
function fetchPhaseModels(phaseBaseUrlId, phaseApiKeyId, listId, selectId, modelInputId) {
  const baseUrl = $(phaseBaseUrlId).value.trim() || $('cfg-baseurl').value.trim();
  const apiKey  = $(phaseApiKeyId).value.trim()  || $('cfg-apikey').value.trim();
  if (!baseUrl) { toast('请先填写 API 地址（或主接口地址）', 'err'); return; }
  $(phaseBaseUrlId)._fallbackUrl = baseUrl;
  $(phaseApiKeyId)._fallbackKey  = apiKey;
  fetchModels(phaseBaseUrlId, phaseApiKeyId, listId, selectId);
  // restore original values after fetchModels reads them
}

$('btn-fetch-p1-models').addEventListener('click', () => {
  const baseUrl = $('cfg-p1-baseurl').value.trim() || $('cfg-baseurl').value.trim();
  const apiKey  = $('cfg-p1-apikey').value.trim()  || $('cfg-apikey').value.trim();
  if (!baseUrl) { toast('请先填写阶段1或主接口的 API 地址', 'err'); return; }
  const tmpBase = $('cfg-p1-baseurl').value; const tmpKey = $('cfg-p1-apikey').value;
  $('cfg-p1-baseurl').value = baseUrl; $('cfg-p1-apikey').value = apiKey;
  fetchModels('cfg-p1-baseurl', 'cfg-p1-apikey', 'st-p1-model-list', 'cfg-p1-model-select')
    .finally(() => { $('cfg-p1-baseurl').value = tmpBase; $('cfg-p1-apikey').value = tmpKey; });
});
$('cfg-p1-model-select').addEventListener('change', function () {
  if (this.value) { $('cfg-p1-model').value = this.value; markDirty(); }
});

$('btn-fetch-p3-models').addEventListener('click', () => {
  const baseUrl = $('cfg-p3-baseurl').value.trim() || $('cfg-baseurl').value.trim();
  const apiKey  = $('cfg-p3-apikey').value.trim()  || $('cfg-apikey').value.trim();
  if (!baseUrl) { toast('请先填写阶段3或主接口的 API 地址', 'err'); return; }
  const tmpBase = $('cfg-p3-baseurl').value; const tmpKey = $('cfg-p3-apikey').value;
  $('cfg-p3-baseurl').value = baseUrl; $('cfg-p3-apikey').value = apiKey;
  fetchModels('cfg-p3-baseurl', 'cfg-p3-apikey', 'st-p3-model-list', 'cfg-p3-model-select')
    .finally(() => { $('cfg-p3-baseurl').value = tmpBase; $('cfg-p3-apikey').value = tmpKey; });
});
$('cfg-p3-model-select').addEventListener('change', function () {
  if (this.value) { $('cfg-p3-model').value = this.value; markDirty(); }
});

$('btn-fetch-p4-models').addEventListener('click', () => {
  const baseUrl = $('cfg-p4-baseurl').value.trim() || $('cfg-baseurl').value.trim();
  const apiKey  = $('cfg-p4-apikey').value.trim()  || $('cfg-apikey').value.trim();
  if (!baseUrl) { toast('请先填写阶段4或主接口的 API 地址', 'err'); return; }
  const tmpBase = $('cfg-p4-baseurl').value; const tmpKey = $('cfg-p4-apikey').value;
  $('cfg-p4-baseurl').value = baseUrl; $('cfg-p4-apikey').value = apiKey;
  fetchModels('cfg-p4-baseurl', 'cfg-p4-apikey', 'st-p4-model-list', 'cfg-p4-model-select')
    .finally(() => { $('cfg-p4-baseurl').value = tmpBase; $('cfg-p4-apikey').value = tmpKey; });
});
$('cfg-p4-model-select').addEventListener('change', function () {
  if (this.value) { $('cfg-p4-model').value = this.value; markDirty(); }
});

// ── Test API ──────────────────────────────────────────────────────────────────
async function testAPI(statusId, saveFirst = false) {
  if (saveFirst) await saveConfig();
  const statusEl = $(statusId);
  statusEl.className = '';
  statusEl.textContent = '测试中…';
  statusEl.style.display = 'block';
  try {
    const res = await api('POST', '/config/test', {});
    statusEl.textContent = res.ok ? `✅ 连接成功：${res.response || 'OK'}` : `❌ 失败：${res.error || '未知错误'}`;
    statusEl.className = res.ok ? 'st-test-status ok' : 'st-test-status err';
  } catch (e) {
    statusEl.textContent = '❌ 请求失败：' + e.message;
    statusEl.className = 'st-test-status err';
  }
}
$('btn-test-api').addEventListener('click', () => testAPI('api-test-status', true));
$('btn-test-shop-api').addEventListener('click', () => testAPI('shop-test-status', true));

// ── Appearance: Theme cards ───────────────────────────────────────────────────
function syncThemeCards(theme) {
  document.querySelectorAll('.st-theme-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.theme === theme);
  });
}
// ── Appearance: Font size sliders ─────────────────────────────────────────────

/**
 * 获取某个 group 当前的 px 值
 */
function _getFontPx(group) {
  if (group === 'ui')   return window.UITheme.getFontPx();
  if (group === 'chat') return window.UITheme.getChatPx();
  if (group === 'stat') return window.UITheme.getStatPx();
  return 14;
}

/**
 * 将三个 group 的最新 px 值应用到 UITheme
 */
function _applyFontChange(changedGroup, newPx) {
  const theme  = window.UITheme.getTheme();
  const uiPx   = changedGroup === 'ui'   ? newPx : window.UITheme.getFontPx();
  const chatPx = changedGroup === 'chat' ? newPx : window.UITheme.getChatPx();
  const statPx = changedGroup === 'stat' ? newPx : window.UITheme.getStatPx();
  window.UITheme.applyTheme(theme, uiPx, chatPx, statPx);
}

/**
 * 同步某个 group 的滑块、数字输入和预览
 */
function syncFontControls(group, px) {
  const slider  = document.getElementById('fontSlider-' + group);
  const input   = document.getElementById('fontInput-'  + group);
  const preview = document.getElementById('fontPreview-' + group);
  if (slider)  slider.value = px;
  if (input)   input.value  = px;
  if (preview) preview.style.fontSize = px + 'px';
}

// Wire up each font group
['ui', 'chat', 'stat'].forEach(group => {
  const slider  = document.getElementById('fontSlider-' + group);
  const input   = document.getElementById('fontInput-'  + group);

  function onFontChange(rawVal) {
    const px = Math.max(8, Math.min(38, parseInt(rawVal, 10) || 8));
    syncFontControls(group, px);
    _applyFontChange(group, px);
    // Update slider fill via CSS custom property
    if (slider) slider.style.setProperty('--val', px);
  }

  if (slider) {
    slider.addEventListener('input', () => onFontChange(slider.value));
  }
  if (input) {
    input.addEventListener('input',  () => onFontChange(input.value));
    input.addEventListener('change', () => {
      // Clamp on blur/enter
      const px = Math.max(8, Math.min(38, parseInt(input.value, 10) || 8));
      syncFontControls(group, px);
      _applyFontChange(group, px);
    });
  }
});

// Reset buttons
document.querySelectorAll('.st-font-reset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.dataset.group;
    const def   = parseInt(btn.dataset.default, 10) || 14;
    syncFontControls(group, def);
    _applyFontChange(group, def);
  });
});

document.querySelectorAll('.st-theme-card').forEach(card => {
  card.addEventListener('click', () => {
    const theme = card.dataset.theme;
    window.UITheme.applyTheme(theme, window.UITheme.getFontPx(), window.UITheme.getChatPx(), window.UITheme.getStatPx());
    syncThemeCards(theme);
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadConfig();
syncThemeCards(window.UITheme.getTheme());
['ui', 'chat', 'stat'].forEach(g => {
  const px = g === 'ui' ? window.UITheme.getFontPx() : g === 'chat' ? window.UITheme.getChatPx() : window.UITheme.getStatPx();
  syncFontControls(g, px);
  const s = document.getElementById('fontSlider-' + g);
  if (s) s.style.setProperty('--val', px);
});

// Handle hash navigation from external links
const hash = location.hash.replace('#', '');
if (hash) {
  const mapped = {
    'shop-api':   'api',
    'api':        'api',
    'appearance': 'appearance',
    'multiphase': 'multiphase',
    'other':      'other',
  };
  const target = mapped[hash];
  if (target) {
    const navItem = document.querySelector(`.st-nav-item[data-panel="${target}"]`);
    if (navItem) navItem.click();
  }
}

// Warn before leaving with unsaved changes
window.addEventListener('beforeunload', e => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
