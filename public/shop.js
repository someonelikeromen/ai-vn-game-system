'use strict';
/* ── Shop Frontend ──────────────────────────────────────────────────────────── */

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  allItems:     [],
  sessions:     [],
  sessionWorlds: [],   // [{key, displayName}] for currently selected session
  allArchives:  [],    // all world archives (for fallback when no session)
  filters:      { type: '', tier: '', world: '' },
  sort:         'newest',
  generating:   false,
  cart:         [], // Array of itemId strings
  cartOpen:     false,
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// emptyState 会被 grid.innerHTML='' 从 DOM 中移除，需持久化引用
let _emptyStateEl = null;
function getEmptyState() {
  if (!_emptyStateEl) _emptyStateEl = $('emptyState');
  return _emptyStateEl;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadSessions();
  // Auto-select session from URL param (e.g. entered via shop button from game page)
  const urlSession = new URLSearchParams(window.location.search).get('session');
  if (urlSession) {
    const sel = $('sessionSelect');
    if (sel) {
      sel.value = urlSession;
      await onSessionChange();
    }
  }
  await loadItems();
  await loadShopConfig();
  await loadCharacterProfilesForWorld();
  renderArchivePool();
  bindEvents();
  initTabs();
  bindGachaEvents();
  // Make cart panel draggable and resizable
  if (typeof PanelManager !== 'undefined') {
    PanelManager.make($('cartPanel'), {
      storageKey: 'shop-cart',
      handleSel:  '.panel-handle',
      resizable:  true,
      minWidth:   280,
      minHeight:  200,
    });
  }
}

/** Navigate back to the game page, restoring session context and triggering prefill */
function goBackToGame() {
  const sessionId = $('sessionSelect')?.value;
  if (sessionId) {
    window.location.href = `/?session=${encodeURIComponent(sessionId)}`;
  } else {
    window.location.href = '/';
  }
}

// ── Character Profiles (for world anchor generation) ──────────────────────────
async function loadCharacterProfilesForWorld() {
  try {
    const profiles = await fetch('/api/characters').then((r) => r.json());
    const sel = $('worldCharProfileSelect');
    if (!sel) return;
    // Keep fixed options, remove previously loaded ones
    while (sel.options.length > 2) sel.remove(2);
    (profiles || []).forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      const label = [p.name, p.gender, p.age ? p.age + '岁' : ''].filter(Boolean).join(' · ');
      opt.textContent = `角色档案：${label || p.id}`;
      sel.appendChild(opt);
    });
  } catch (_) {}
}

// ── Sessions ──────────────────────────────────────────────────────────────────
async function loadSessions() {
  try {
    const sessions = await fetch('/api/sessions').then((r) => r.json());
    state.sessions = sessions;
    const sel = $('sessionSelect');
    sel.innerHTML = '<option value="">— 不关联存档 —</option>';
    sessions.forEach((s) => {
      const opt = document.createElement('option');
      opt.value   = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', onSessionChange);
  } catch (_) {}
}

async function onSessionChange() {
  const id = $('sessionSelect').value;
  if (!id) {
    $('sessionInfo').textContent = '';
    state.sessionWorlds = [];
    populateWorldSelector();
    return;
  }

  // Fetch full session detail (list API omits statData)
  let statData = null;
  try {
    const detail = await fetch(`/api/sessions/${id}`).then(r => r.json());
    statData = detail.statData || null;
  } catch (_) {}

  // Show session stats
  const pts    = statData?.CharacterSheet?.Resources?.Points ?? '?';
  const medals = statData?.CharacterSheet?.Resources?.StarMedals || {};
  const m      = Array.isArray(medals) ? medals[0] : medals;
  const medStr = Object.entries(m || {})
    .filter(([k, v]) => !k.startsWith('$') && Number(v) > 0)
    .map(([k, v]) => `${k}×${v}`)
    .join(' ') || '无';
  $('sessionInfo').textContent = `积分: ${typeof pts === 'number' ? pts.toLocaleString() : pts} | 徽章: ${medStr}`;

  // Load worlds this session has visited
  try {
    const worlds = await fetch(`/api/sessions/${id}/worlds`).then(r => r.json());
    state.sessionWorlds = Array.isArray(worlds) ? worlds : [];
  } catch (_) { state.sessionWorlds = []; }
  populateWorldSelector();

  // Update return-home panel
  updateReturnHomePanel(statData);

  // Refresh gacha pools if the gacha tab is currently active
  if ($('shopMainGacha')?.style.display !== 'none') {
    loadGachaPools();
    loadGachaPending();
  }
}

function updateReturnHomePanel(statData) {
  const panel      = $('returnHomePanel');
  const mv         = statData?.Multiverse;
  const originKey  = mv?.OriginWorldKey;
  const curName    = Array.isArray(mv?.CurrentWorldName) ? mv.CurrentWorldName[0] : (mv?.CurrentWorldName || null);

  if (!panel) return;
  if (!originKey || curName === originKey) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = '';
  $('originWorldName').textContent  = originKey;
  $('currentWorldName').textContent = curName || '未知';

  const pts = statData?.CharacterSheet?.Resources?.Points ?? 0;
  $('returnHomeBalance').textContent = typeof pts === 'number' ? pts.toLocaleString() : pts;

  const btn = $('btnReturnHome');
  if (btn) btn.disabled = pts < 20000;
}

async function executeReturnHome() {
  const sessionId = $('sessionSelect')?.value;
  if (!sessionId) { toast('请先选择存档', true); return; }

  const msgEl = $('returnHomeMsg');
  const btn   = $('btnReturnHome');
  if (btn) btn.disabled = true;
  if (msgEl) { msgEl.textContent = '传送中…'; msgEl.style.display = ''; }

  try {
    const res = await fetch('/api/shop/return-home', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '请求失败');

    toast(`已回归主世界「${data.worldName}」，消耗 20,000 积分`);
    if (msgEl) msgEl.style.display = 'none';
    // Re-load session to refresh panel
    await onSessionChange();
  } catch (e) {
    toast(e.message, true);
    if (msgEl) { msgEl.textContent = e.message; msgEl.style.display = ''; }
    if (btn) btn.disabled = false;
  }
}

function populateWorldSelector() {
  const sel   = $('genWorldSelect');
  const hint  = $('genWorldHint');
  const sessId = $('sessionSelect').value;

  // Source: session worlds if session bound, else all archives
  let worlds = [];
  if (sessId && state.sessionWorlds.length > 0) {
    worlds = state.sessionWorlds;
    hint.textContent = `（仅限该存档经历过的 ${worlds.length} 个世界）`;
  } else if (sessId && state.sessionWorlds.length === 0) {
    worlds = [];
    hint.textContent = '该存档尚无世界记录';
  } else {
    worlds = state.allArchives.map(a => ({ key: a.displayName || a.worldKey, displayName: a.displayName || a.worldKey }));
    hint.textContent = worlds.length ? `（来自档案库，共 ${worlds.length} 个世界）` : '（档案库为空）';
  }

  const prev = sel.value;
  sel.innerHTML = '<option value="">— 选择来源世界 —</option>';
  worlds.forEach(w => {
    const opt = document.createElement('option');
    opt.value       = w.key;
    opt.textContent = w.displayName;
    if (w.key === prev) opt.selected = true;
    sel.appendChild(opt);
  });

  // Also populate filter world dropdown
  const fSel = $('filterWorld');
  if (fSel) {
    fSel.innerHTML = '<option value="">全部</option>';
    const allWorlds = new Set(state.allItems.map(i => i.sourceWorld).filter(Boolean));
    allWorlds.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w; opt.textContent = w;
      fSel.appendChild(opt);
    });
  }
}

// ── Items ─────────────────────────────────────────────────────────────────────
async function loadItems() {
  const grid = $('itemsGrid');
  if (grid && window.UIFeedback) {
    grid.innerHTML = window.UIFeedback.renderLoadingLines(6);
  }
  try {
    state.allItems = await fetch('/api/shop/items').then((r) => r.json());
    await loadArchiveCounts();
    renderItems();
  } catch (_) {
    if (grid && window.UIFeedback) {
      grid.innerHTML = window.UIFeedback.renderEmpty('加载商城失败，请稍后重试。');
    }
  }
}

async function loadArchiveCounts() {
  try {
    const data = await fetch('/api/worldanchor/archives').then(r => r.json());
    const counts = {};
    for (const a of data) counts[a.tierRange] = (counts[a.tierRange] || 0) + 1;
    state.archiveCounts = counts;
    state.archives      = data;
    state.allArchives   = data;
  } catch (_) { state.archiveCounts = {}; state.archives = []; state.allArchives = []; }
  populateWorldSelector();
}

// ── Rendering ─────────────────────────────────────────────────────────────────
const TYPE_LABELS = {
  PassiveAbility:       '被动能力',
  PowerSource:          '基盘能力',
  ApplicationTechnique: '应用技巧',
  Inventory:            '物品',
  Knowledge:            '知识',
  WorldTraverse:        '穿越',
  Companion:            '同伴/召唤体',
  Mech:                 '机体/机器人',
};

const TIER_NAMES = ['凡躯','超凡','超能','毁灭','摩天','丘陵','都市','山岳','地壳','行星','恒星','星系','宇宙','单体','多元','超多元','虚空'];

function tierClass(tier) {
  if (tier >= 13) return 'tier-13p';
  if (tier >= 10) return 'tier-10p';
  return `tier-${tier}`;
}

function tierStars(tier) {
  const display = tier <= 5 ? '★'.repeat(tier) + '☆'.repeat(5 - tier) : '★'.repeat(Math.min(tier, 8));
  return `${display} ${tier}★`;
}

function getFilteredSorted() {
  let items = [...state.allItems];
  const { type, tier, world } = state.filters;
  if (type)     items = items.filter((i) => i.type === type);
  if (tier === '13+') items = items.filter((i) => i.tier >= 13);
  else if (tier !== '') items = items.filter((i) => i.tier === parseInt(tier, 10));
  if (world)    items = items.filter((i) => i.sourceWorld === world);

  const s = state.sort;
  if (s === 'newest')     items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (s === 'tier-asc')   items.sort((a, b) => a.tier - b.tier);
  if (s === 'tier-desc')  items.sort((a, b) => b.tier - a.tier);
  if (s === 'price-asc')  items.sort((a, b) => a.pricePoints - b.pricePoints);
  if (s === 'price-desc') items.sort((a, b) => b.pricePoints - a.pricePoints);
  return items;
}

function renderItems() {
  const items = getFilteredSorted();
  const grid  = $('itemsGrid');
  const empty = getEmptyState();          // 使用持久化引用，避免 innerHTML='' 后找不到
  $('itemCount').textContent = `${items.length} 个项目`;

  if (!items.length) {
    grid.innerHTML = '';
    if (empty) {
      grid.appendChild(empty);
      empty.style.display = '';
      const text = empty.querySelector('.muted');
      if (text) text.textContent = '输入描述并点击「生成评估」后，这里会出现可兑换条目。';
    }
    return;
  }
  if (empty) empty.style.display = 'none';
  grid.innerHTML = '';
  items.forEach((item) => grid.appendChild(buildCard(item)));
}

function buildCard(item) {
  const card = document.createElement('div');
  card.className = 'item-card';
  card.dataset.id = item.id;

  // Medal string
  const medStr = (item.requiredMedals || []).map((m) => `${m.stars}★×${m.count}`).join(' + ') || '无';

  // Attr deltas summary
  const attrs = item.effects?.attributeDeltas || {};
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v && v !== 0)
    .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
    .slice(0, 4).join('  ') || '';

  const isSystem       = !!item.system;
  const isWorldTraverse = item.type === 'WorldTraverse';
  const isBaseAnchor   = !!item.baseAnchor;

  const poolCount = isBaseAnchor ? (state.archiveCounts?.[item.tierRange] || 0) : 0;
  const poolBadge = isBaseAnchor
    ? `<div class="card-pool-badge ${poolCount > 0 ? 'pool-ok' : 'pool-empty'}">
        📦 ${poolCount} 个世界档案
      </div>`
    : '';

  card.innerHTML = `
    <div class="card-tier-badge ${tierClass(item.tier)}">${tierStars(item.tier)}</div>
    ${isSystem && !isBaseAnchor ? '<div class="card-system-badge">🔒 系统</div>' : ''}
    <div class="card-name">${escHtml(item.name || '未命名')}</div>
    <div class="card-type-tag">${isBaseAnchor ? '🌐 随机穿越锚点' : (TYPE_LABELS[item.type] || item.type)}</div>
    ${item.sourceWorld ? `<div class="card-world-tag">🌐 ${escHtml(item.sourceWorld)}</div>` : ''}
    ${poolBadge}
    ${isWorldTraverse && !isBaseAnchor
      ? `<div class="card-world-meta">
          <span>📜 ${(item.effects?.worldData?.worldRules||[]).length} 条法则</span>
          <span class="card-world-universe">${escHtml(item.effects?.worldData?.universe || '')}</span>
        </div>`
      : (attrStr ? `<div style="font-size:0.75rem;color:#5a8a9a;">${escHtml(attrStr)}</div>` : '')}
    <div class="card-desc">${escHtml(item.description || '')}</div>
    <div class="card-price-row">
      <span class="card-points">${(item.pricePoints || 0).toLocaleString()} 积分</span>
      ${medStr !== '无' ? `<span class="card-medal">🏅 ${medStr}</span>` : ''}
    </div>
    <div class="card-actions">
      <button class="btn btn-ghost btn-sm btn-detail" data-id="${item.id}">详情</button>
      ${isBaseAnchor
        ? `<button class="btn btn-success btn-sm btn-redeem" data-id="${item.id}" ${poolCount === 0 ? 'disabled title="档案库为空，请先生成世界档案"' : ''}>🎲 随机穿越</button>`
        : `<button class="btn btn-success btn-sm btn-redeem" data-id="${item.id}">${isWorldTraverse ? '🌐 穿越' : '兑换'}</button>`
      }
      ${!isBaseAnchor ? `<button class="btn btn-sm btn-add-cart${state.cart.includes(item.id) ? ' in-cart' : ''}" data-id="${item.id}" title="加入购物车">🛒</button>` : ''}
      ${isSystem && !isBaseAnchor
        ? `<span class="card-locked-tag" style="margin-left:auto;font-size:11px;color:#556">🔒不可删</span>`
        : `<button class="btn btn-danger btn-sm btn-delete" data-id="${item.id}" style="margin-left:auto">✕</button>`
      }
    </div>
  `;
  return card;
}

// ── Shop API Config ───────────────────────────────────────────────────────────
let shopConfigCache = {};

async function loadShopConfig() {
  try {
    shopConfigCache = await fetch('/api/shop/config').then((r) => r.json());
    updateApiIndicator();
    syncCharStateModeUi();
  } catch (_) {}
}

function syncCharStateModeUi() {
  const val  = shopConfigCache.shopCharStateOnRedeem || 'off';
  const sel  = $('charStateMode');
  const hint = $('charStateModeHint');
  if (sel) sel.value = val;
  if (hint) {
    const map = { off: '', snapshot: '兑换后 prefill 含属性摘要', full: '兑换后 prefill 含完整装备列表' };
    hint.textContent = map[val] || '';
  }
  const sModal = $('sCharStateOnRedeem');
  if (sModal) sModal.value = val;
}

function updateApiIndicator() {
  const el = $('apiIndicator');
  if (!el) return;
  const cfg = shopConfigCache;
  const model   = cfg.effectiveModel   || 'gpt-4o';
  const baseUrl = cfg.effectiveBaseUrl || 'https://api.openai.com';
  const host    = (() => { try { return new URL(baseUrl).host; } catch { return baseUrl; } })();
  const hasOwnKey = cfg.hasShopKey;
  el.title       = `商城 API\nBaseURL: ${baseUrl}\nModel: ${model}`;
  el.textContent = `${hasOwnKey ? '🔑' : '↗'} ${model} · ${host}`;
  el.className   = 'api-indicator' + (hasOwnKey ? '' : ' fallback');
}

// Shop settings modal removed — use /settings#shop-api

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents() {
  // Inline charState mode toggle (visible bar below header)
  $('charStateMode')?.addEventListener('change', async (e) => {
    const val = e.target.value;
    shopConfigCache.shopCharStateOnRedeem = val;
    syncCharStateModeUi();
    try {
      await fetch('/api/shop/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopCharStateOnRedeem: val }),
      });
    } catch (_) {}
  });

  // Shop settings button is now a link to /settings#shop-api

  // Generate
  $('btnGenerate').addEventListener('click', startGeneration);
  $('genInput').addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') startGeneration();
  });
  $('btnClear').addEventListener('click', () => { $('genInput').value = ''; });

  // Filter + sort
  $('btnApplyFilter').addEventListener('click', () => {
    state.filters.type  = $('filterType').value;
    state.filters.tier  = $('filterTier').value;
    state.filters.world = $('filterWorld')?.value || '';
    renderItems();
  });
  $('sortSelect').addEventListener('change', (e) => {
    state.sort = e.target.value;
    renderItems();
  });

  // Card actions (delegated)
  $('itemsGrid').addEventListener('click', (e) => {
    const el = e.target;
    const id = el.dataset.id;
    if (!id) return;
    if (el.classList.contains('btn-detail'))    openDetail(id);
    if (el.classList.contains('btn-redeem'))    quickRedeem(id);
    if (el.classList.contains('btn-delete'))    deleteItem(id);
    if (el.classList.contains('btn-add-cart'))  toggleCart(id);
  });

  // Modal
  $('modalBackdrop').addEventListener('click', closeModal);
  $('modalClose').addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // World anchor
  $('btnGenWorldAnchor').addEventListener('click', startWorldAnchorGen);

  // Return home
  $('btnReturnHome')?.addEventListener('click', executeReturnHome);

  // Cart
  $('btnCartToggle').addEventListener('click', () => {
    state.cartOpen = !state.cartOpen;
    $('cartPanel').style.display = state.cartOpen ? 'flex' : 'none';
    if (state.cartOpen) renderCartPanel();
  });
  $('btnCartClose').addEventListener('click', () => {
    state.cartOpen = false;
    $('cartPanel').style.display = 'none';
  });
  $('btnCartCheckout').addEventListener('click', checkoutCart);
}

// ── Cart ──────────────────────────────────────────────────────────────────────

function toggleCart(itemId) {
  const idx = state.cart.indexOf(itemId);
  if (idx === -1) {
    state.cart.push(itemId);
    toast('已加入购物车');
  } else {
    state.cart.splice(idx, 1);
    toast('已从购物车移除');
  }
  updateCartBadge();
  renderItems(); // refresh card states
  if (state.cartOpen) renderCartPanel();
}

function updateCartBadge() {
  const badge = $('cartBadge');
  if (!badge) return;
  badge.textContent = state.cart.length;
  badge.style.display = state.cart.length ? '' : 'none';
}

function renderCartPanel() {
  const listEl = $('cartList');
  const totalEl = $('cartTotal');
  const cartSelEl = $('cartSessionSelect');

  // Sync session selector
  if (cartSelEl) {
    const curSession = $('sessionSelect')?.value || '';
    cartSelEl.innerHTML = '<option value="">— 选择存档 —</option>' +
      state.sessions.map(s => `<option value="${s.id}"${s.id === curSession ? ' selected' : ''}>${escHtml(s.name)}</option>`).join('');
  }

  if (!state.cart.length) {
    listEl.innerHTML = '<p class="cart-empty">购物车是空的</p>';
    if (totalEl) totalEl.textContent = '0';
    return;
  }

  let total = 0;
  let html = '';
  for (const id of state.cart) {
    const item = state.allItems.find(i => i.id === id);
    if (!item) continue;
    total += item.pricePoints || 0;
    html += `<div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(item.name)}</div>
        <div class="cart-item-price">${(item.pricePoints || 0).toLocaleString()} 积分 · ${escHtml(item.type || '')}</div>
      </div>
      <button class="cart-item-remove" data-cart-remove="${id}" title="移除">✕</button>
    </div>`;
  }
  listEl.innerHTML = html;
  if (totalEl) totalEl.textContent = total.toLocaleString();

  // Bind remove buttons
  listEl.querySelectorAll('[data-cart-remove]').forEach(btn => {
    btn.addEventListener('click', () => { toggleCart(btn.dataset.cartRemove); });
  });
}

async function checkoutCart() {
  if (!state.cart.length) { toast('购物车是空的', true); return; }
  const sessionId = $('cartSessionSelect')?.value;
  if (!sessionId) { toast('请选择要兑换到的存档', true); return; }

  const items = state.cart.map(id => state.allItems.find(i => i.id === id)).filter(Boolean);
  const total = items.reduce((s, i) => s + (i.pricePoints || 0), 0);
  const okBatch = await confirmRisk({
    title: '批量兑换确认',
    message: `批量兑换 ${items.length} 件物品？\n\n${items.map(i => `• ${i.name}`).join('\n')}\n\n总费用：${total.toLocaleString()} 积分`,
    confirmText: '确认兑换',
  });
  if (!okBatch) return;

  const btn = $('btnCartCheckout');
  if (btn) { btn.disabled = true; btn.textContent = '兑换中…'; }

  const failed = [];
  const succeeded = [];
  for (const item of items) {
    try {
      const resp = await fetch('/api/shop/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, sessionId }),
      });
      const data = await resp.json();
      if (!resp.ok) { failed.push(`${item.name}: ${data.error}`); continue; }
      const idx = state.allItems.findIndex(i => i.id === item.id);
      if (idx !== -1) state.allItems[idx] = data.item;
      succeeded.push(item);
      state.cart = state.cart.filter(id => id !== item.id);
    } catch (err) {
      failed.push(`${item.name}: ${err.message}`);
    }
  }

  if (succeeded.length) {
    // Store prefill for main page
    localStorage.setItem('pendingShopPrefill', JSON.stringify({
      text: succeeded.map(i => `购买了${i.name}`).join('、'),
      sessionId,
      ts: Date.now(),
    }));
  }

  updateCartBadge();
  renderItems();
  renderCartPanel();

  if (btn) { btn.disabled = false; btn.textContent = '✓ 批量兑换全部'; }

  if (failed.length) {
    toast(`部分兑换失败: ${failed.join('; ')}`, true);
  } else {
    toast(`✓ 全部兑换成功！已记录到输入栏`);
  }
}

// ── World Anchor Generation ───────────────────────────────────────────────────
async function startWorldAnchorGen() {
  const worldName = $('worldNameInput')?.value.trim();
  if (!worldName) { toast('请输入世界名称', true); return; }
  if (state.generating) { toast('当前有生成任务在进行中', true); return; }

  const additionalContext = $('worldContextInput')?.value.trim() || '';
  const sessionId = $('sessionSelect')?.value || null;
  const charStateMode = $('charStateMode')?.value || shopConfigCache.shopCharStateOnRedeem || 'off';
  const charProfileId = $('worldCharProfileSelect')?.value || '';

  state.generating = true;
  $('btnGenWorldAnchor').disabled = true;
  $('worldAnchorStatus').style.display = '';
  $('worldAnchorStatusText').textContent = `生成「${worldName}」世界档案中…`;
  $('worldAnchorStream').textContent = '';
  $('worldAnchorStream').style.display = '';

  let fullText = '';
  let resolved = false;
  let lastDoneData = null;

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/worldanchor/generate');
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.send(JSON.stringify({ worldName, additionalContext, sessionId, charStateMode, charProfileId }));

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
          fullText += data.delta;
          $('worldAnchorStream').textContent = fullText.slice(-500);
          $('worldAnchorStream').scrollTop = $('worldAnchorStream').scrollHeight;
        } else if (ev === 'status') {
          $('worldAnchorStatusText').textContent = data.message || '生成中…';
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

    // Update archive pool in state
    if (lastDoneData?.archive) {
      if (!state.archives) state.archives = [];
      state.archives.unshift(lastDoneData.archive);
      if (!state.archiveCounts) state.archiveCounts = {};
      const tr = lastDoneData.archive.tierRange;
      state.archiveCounts[tr] = (state.archiveCounts[tr] || 0) + 1;
      renderItems(); // refresh pool badges on base anchor cards
      renderArchivePool(); // refresh sidebar pool panel
    }

    const tierLabel = lastDoneData?.tierLabel || '';
    $('worldAnchorStatusText').textContent = `✓ 已加入 ${tierLabel || ''} 档案库`;
    $('worldAnchorStream').style.display = 'none';
    toast(`✓ 「${worldName}」已加入${tierLabel ? ' ' + tierLabel : ''}档案库（${lastDoneData?.poolCount || '?'} 个世界）`);
    $('worldNameInput').value = '';
    $('worldContextInput').value = '';
  } catch (err) {
    $('worldAnchorStatusText').textContent = `✗ ${err.message}`;
    toast(`世界档案生成失败: ${err.message}`, true);
  }

  state.generating = false;
  $('btnGenWorldAnchor').disabled = false;
  setTimeout(() => { $('worldAnchorStatus').style.display = 'none'; }, 5000);
}

// ── Archive Pool Panel ────────────────────────────────────────────────────────
const TIER_LABELS = {
  low:      '低危区 (0-2★)',
  mid:      '中危区 (3-5★)',
  high:     '高危区 (6-8★)',
  stellar:  '行星/恒星 (9-10★)',
  galactic: '星系/宇宙 (11-13★)',
  beyond:   '超限 (14+★)',
};

function renderArchivePool() {
  const panel = $('archivePoolPanel');
  if (!panel) return;
  const archives = state.archives || [];
  if (!archives.length) {
    panel.innerHTML = '<div class="archive-pool-empty" style="padding:8px 0;font-size:0.78rem;color:#5a6a7a">尚无档案 — 请生成世界</div>';
    return;
  }
  // Group by tier
  const grouped = {};
  for (const a of archives) {
    if (!grouped[a.tierRange]) grouped[a.tierRange] = [];
    grouped[a.tierRange].push(a);
  }
  const tierOrder = ['low','mid','high','stellar','galactic','beyond'];
  panel.innerHTML = tierOrder
    .filter(t => grouped[t]?.length)
    .map(t => `
      <div class="archive-tier-group">
        <div class="archive-tier-label">${TIER_LABELS[t] || t} <span class="archive-tier-count">${grouped[t].length}</span></div>
        ${grouped[t].map(a => `
          <div class="archive-pool-row">
            <span class="archive-pool-name">${escHtml(a.displayName)}</span>
            <button class="btn btn-ghost btn-xs archive-del-btn-side" data-archive-id="${a.id}" title="删除">✕</button>
          </div>`).join('')}
      </div>`).join('');

  // Bind delete buttons
  panel.querySelectorAll('.archive-del-btn-side').forEach(btn => {
    btn.addEventListener('click', () => deleteArchive(btn.dataset.archiveId));
  });
}

// ── Generation ────────────────────────────────────────────────────────────────
async function startGeneration() {
  if (state.generating) return;
  const desc  = $('genInput').value.trim();
  if (!desc) { toast('请先输入描述内容', true); return; }

  const count       = parseInt($('genCount')?.value) || 1;
  const useStream   = $('toggleStream')?.checked !== false;
  const sessionId   = $('sessionSelect').value || null;
  const sourceWorld = $('genWorldSelect')?.value || null;

  // If session bound and no world selected, warn but allow
  if (sessionId && !sourceWorld) {
    const ok = await confirmRisk({
      title: '继续生成确认',
      message: '未选择来源世界，将不限制评估来源。\n建议选择一个世界以获得更准确的评估结果。\n\n继续生成？',
      confirmText: '继续生成',
    });
    if (!ok) return;
  }

  state.generating = true;
  $('btnGenerate').disabled = true;
  $('genStatus').style.display = '';
  $('genStatusText').textContent = 'AI 评估中…';
  $('genStream').textContent = '';
  $('genStream').style.display = useStream ? '' : 'none';

  try {
    await streamGenerate(desc, sessionId, count, useStream, sourceWorld);
  } catch (err) {
    $('genStatusText').textContent = `错误: ${err.message}`;
  } finally {
    state.generating = false;
    $('btnGenerate').disabled = false;
    // Hide the spinner, keep the status text visible
    const spinner = $('genStatus').querySelector('.gen-spinner');
    if (spinner) spinner.style.display = 'none';
  }
}

/**
 * Execute generation via XHR + SSE.
 * Handles both streaming (chunk events) and non-streaming (just done events).
 * Supports count > 1 by listening for multiple 'done' events.
 */
function streamGenerate(description, sessionId, count = 1, streamEnabled = true, sourceWorld = null) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/shop/generate');
    xhr.setRequestHeader('Content-Type', 'application/json');

    let lastLen  = 0;
    let resolved = false;
    const streamBufs = {};
    let currentIndex = 0;
    let doneCount = 0;

    // Resolve exactly once — called as soon as all items are complete
    function finish() {
      if (resolved) return;
      resolved = true;
      resolve(doneCount || null);
    }

    // ── SSE line-by-line parser ──
    let lineBuffer  = '';
    let pendingEvent = '';

    function processLine(line) {
      if (line === '') {
        pendingEvent = '';
        return;
      }
      if (line.startsWith('event: ')) {
        pendingEvent = line.slice(7).trim();
        return;
      }
      if (!line.startsWith('data: ')) return;

      let payload;
      try { payload = JSON.parse(line.slice(6)); } catch (_) { return; }

      const ev = pendingEvent;

      if (ev === 'chunk') {
        const idx = payload.index ?? 0;
        if (!streamBufs[idx]) streamBufs[idx] = '';
        streamBufs[idx] += payload.delta || '';
        if (idx >= currentIndex) {
          currentIndex = idx;
          $('genStream').textContent = streamBufs[idx].slice(-1200);
          $('genStream').scrollTop = $('genStream').scrollHeight;
        }
      } else if (ev === 'status') {
        $('genStatusText').textContent = payload.message || '';
      } else if (ev === 'done') {
        if (payload.item) {
          doneCount++;
          state.allItems.unshift(payload.item);
          renderItems();
          const total = payload.total || count;
          $('genStream').textContent = '';
          if (doneCount >= total) {
            $('genStatusText').textContent = total > 1
              ? `✓ 全部 ${total} 项生成完成`
              : `✓ 生成完成：${payload.item.name}`;
            toast(total > 1 ? `✓ 已生成 ${total} 项` : `✓ 已生成：${payload.item.name}`);
            finish(); // ← resolve immediately — don't wait for onload
          } else {
            $('genStatusText').textContent = `已完成 ${doneCount}/${total} 项…`;
            streamBufs[(payload.index ?? 0) + 1] = '';
          }
        }
      } else if (ev === 'error') {
        const msg = payload.message || '未知错误';
        $('genStatusText').textContent = `错误: ${msg}`;
        // Partial batch errors don't abort — keep going
      }
    }

    function flushBuffer() {
      const parts = lineBuffer.split('\n');
      lineBuffer = parts.pop();
      for (const line of parts) processLine(line);
    }

    xhr.onprogress = () => {
      const newText = xhr.responseText.slice(lastLen);
      lastLen = xhr.responseText.length;
      lineBuffer += newText;
      flushBuffer();
    };

    xhr.onload = () => {
      // Process any bytes not yet handled by onprogress
      const tail = xhr.responseText.slice(lastLen);
      if (tail) { lineBuffer += tail; }
      if (lineBuffer) {
        lineBuffer += '\n'; // ensure last event is dispatched
        flushBuffer();
      }
      finish(); // safety: resolve even if done event was missed
    };

    xhr.onerror   = () => reject(new Error('网络错误'));
    xhr.ontimeout = () => reject(new Error('请求超时'));
    xhr.timeout   = 300000; // 5 min timeout

    xhr.send(JSON.stringify({ description, sessionId, count, streamEnabled, sourceWorld }));
  });
}

// ── Quick Redeem (from card button, uses currently selected session) ───────────
async function quickRedeem(itemId) {
  const sessionId = $('sessionSelect').value;
  if (!sessionId) {
    toast('请先在右上角选择存档', true);
    return;
  }
  const item = state.allItems.find(i => i.id === itemId);
  if (item?.baseAnchor) {
    await doPull(itemId, sessionId);
  } else {
    await doRedeem(itemId, sessionId);
  }
}

async function doRedeem(itemId, sessionId) {
  const item = state.allItems.find((i) => i.id === itemId);
  if (!item) return;

  const confirmMsg =
    `确认兑换？\n\n${item.name}\n费用：${item.pricePoints.toLocaleString()} 积分` +
    ((item.requiredMedals || []).length
      ? '\n徽章：' + item.requiredMedals.map((m) => `${m.stars}★×${m.count}`).join(' + ')
      : '');
  if (!await confirmRisk({ title: '兑换确认', message: confirmMsg, confirmText: '确认兑换' })) return;

  try {
    const resp = await fetch('/api/shop/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, sessionId }),
    });
    const data = await resp.json();
    if (!resp.ok) { toast(data.error || '兑换失败', true); return; }

    // Update local state
    const idx = state.allItems.findIndex((i) => i.id === itemId);
    if (idx !== -1) state.allItems[idx] = data.item;
    renderItems();
    onSessionChange();
    toast(`✓ 兑换成功：${item.name}`);

    // Store prefill for main game page
    if (data.prefillText) {
      localStorage.setItem('pendingShopPrefill', JSON.stringify({
        text: data.prefillText,
        sessionId,
        ts: Date.now(),
      }));
    }

    closeModal();
  } catch (err) {
    toast(`兑换出错: ${err.message}`, true);
  }
}

// ── Base Anchor Pull (random world from tier pool) ────────────────────────────
async function doPull(itemId, sessionId) {
  const item = state.allItems.find(i => i.id === itemId);
  if (!item) return;

  const tierLabel = item.name || item.tierRange;
  const poolCount = state.archiveCounts?.[item.tierRange] || 0;
  if (poolCount === 0) {
    toast(`${tierLabel} 档案库为空，请先在左侧生成世界档案`, true);
    return;
  }

  const confirmMsg =
    `随机穿越至 ${tierLabel}？\n\n费用：${item.pricePoints.toLocaleString()} 积分` +
    ((item.requiredMedals || []).length
      ? '\n徽章：' + item.requiredMedals.map(m => `${m.stars}★×${m.count}`).join(' + ')
      : '') +
    `\n\n将从 ${poolCount} 个 ${tierLabel} 世界档案中随机抽取一个世界，加入武库（需在状态面板手动激活）。`;
  if (!await confirmRisk({ title: '随机穿越确认', message: confirmMsg, confirmText: '确认穿越' })) return;

  try {
    const resp = await fetch('/api/worldanchor/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, sessionId }),
    });
    const data = await resp.json();
    if (!resp.ok) { toast(data.error || '穿越失败', true); return; }
    onSessionChange();

    // Show identity choice dialog immediately after pull
    showAnchorIdentityChoice(data, sessionId);
  } catch (err) {
    toast(`穿越出错: ${err.message}`, true);
  }
}

/**
 * After a world anchor pull, show an identity choice modal so the user
 * can decide whether to inherit the world identity before activating.
 */
async function showAnchorIdentityChoice(pullData, sessionId) {
  const archive  = pullData.archive || {};
  const worldKey = pullData.worldKey || archive.worldKey || archive.displayName;
  const worldName = archive.displayName || worldKey || '未知世界';
  const identity = archive.worldIdentity;

  const identityTitle = identity?.title || '外来穿越者';
  const identityOcc   = identity?.occupation || `在「${worldName}」世界中以外来者身份活动`;
  const identityBg    = (identity?.background || '').slice(0, 120);

  const hasRealIdentity = !!(identity?.title || identity?.occupation);

  const modalContent = $('modalContent');
  if (!modalContent) {
    // Fallback: store prefill and close
    if (pullData.prefillText) {
      localStorage.setItem('pendingShopPrefill', JSON.stringify({ text: pullData.prefillText, sessionId, ts: Date.now() }));
    }
    toast(`✓ 「${worldName}」已加入武库，请在状态面板「世界」标签页激活`);
    closeModal();
    return;
  }

  modalContent.innerHTML = `
    <div style="padding:8px 0">
      <h3 style="margin:0 0 12px;font-size:1.1rem">🌐 世界锚点已就绪</h3>
      <div style="background:var(--surface2,#1e2230);border-radius:8px;padding:12px;margin-bottom:16px">
        <div style="font-weight:bold;font-size:1rem;margin-bottom:6px">「${escHtml(worldName)}」</div>
        <div style="color:var(--muted,#888);font-size:0.82rem;margin-bottom:4px">预设世界身份：</div>
        <div style="font-size:0.9rem;margin-bottom:2px">👤 称号：${escHtml(identityTitle)}</div>
        <div style="font-size:0.88rem;color:var(--text2,#b0b8cc);margin-bottom:2px">职业：${escHtml(identityOcc)}</div>
        ${identityBg ? `<div style="font-size:0.82rem;color:var(--muted,#888);margin-top:4px;line-height:1.5">${escHtml(identityBg)}${(identity?.background || '').length > 120 ? '…' : ''}</div>` : ''}
      </div>
      <div style="color:var(--text2,#b0b8cc);font-size:0.88rem;margin-bottom:16px">
        进入该世界时，是否以此身份开始？
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button id="anchor-inherit-yes" class="btn" style="flex:1;min-width:120px;background:var(--success,#3a7a4a);color:#fff;padding:10px">
          ✓ 继承世界身份
        </button>
        <button id="anchor-inherit-no" class="btn" style="flex:1;min-width:120px;background:var(--surface2,#1e2230);border:1px solid var(--border,#333);padding:10px">
          ✕ 以外来者身份进入
        </button>
      </div>
      <div style="text-align:center;margin-top:12px">
        <a href="#" id="anchor-inherit-later" style="font-size:0.82rem;color:var(--muted,#888);text-decoration:underline">
          稍后在游戏中手动激活
        </a>
      </div>
    </div>`;

  // Open modal if it's not already open
  const modal = $('detailModal');
  if (modal) modal.style.display = 'flex';

  async function activateAnchor(inheritIdentity) {
    try {
      const r = await fetch(`/api/sessions/${sessionId}/use-anchor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worldKey, inheritIdentity }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '激活失败');
      const note = inheritIdentity ? '' : '（以外来者身份进入）';
      localStorage.setItem('pendingShopPrefill', JSON.stringify({
        text: `【系统】已进入世界「${worldName}」${note}`,
        sessionId,
        ts: Date.now(),
      }));
      toast(`✓ 世界「${worldName}」已激活${note}`);
      closeModal();
      onSessionChange();
    } catch (e) {
      toast(`激活出错: ${e.message}`, true);
    }
  }

  $('anchor-inherit-yes').addEventListener('click', () => activateAnchor(true));
  $('anchor-inherit-no').addEventListener('click', () => activateAnchor(false));
  $('anchor-inherit-later').addEventListener('click', (e) => {
    e.preventDefault();
    if (pullData.prefillText) {
      localStorage.setItem('pendingShopPrefill', JSON.stringify({ text: pullData.prefillText, sessionId, ts: Date.now() }));
    }
    toast(`✓ 「${worldName}」已加入武库，请在游戏状态面板「世界」标签页手动激活`);
    closeModal();
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteItem(itemId) {
  const item = state.allItems.find((i) => i.id === itemId);
  if (!item) return;
  if (item.baseAnchor) { toast('随机锚点基础项不可删除', true); return; }
  if (item.system) { toast('系统项目不可删除', true); return; }
  if (!await confirmRisk({ title: '删除商品', message: `确认删除「${item.name}」？`, confirmText: '确认删除' })) return;
  try {
    const resp = await fetch(`/api/shop/items/${itemId}`, { method: 'DELETE' });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) { toast(data.error || '删除失败', true); return; }
    state.allItems = state.allItems.filter((i) => i.id !== itemId);
    renderItems();
    closeModal();
    toast('已删除');
  } catch (err) {
    toast(`删除出错: ${err.message}`, true);
  }
}

async function deleteArchive(archiveId) {
  if (!await confirmRisk({ title: '删除世界档案', message: '确认从档案库中删除该世界档案？', confirmText: '确认删除' })) return;
  try {
    const resp = await fetch(`/api/worldanchor/archives/${archiveId}`, { method: 'DELETE' });
    if (!resp.ok) { toast('删除档案失败', true); return; }
    state.archives = (state.archives || []).filter(a => a.id !== archiveId);
    // Recount
    const counts = {};
    for (const a of state.archives) counts[a.tierRange] = (counts[a.tierRange] || 0) + 1;
    state.archiveCounts = counts;
    renderArchivePool();
    renderItems(); // refresh pool badges
    toast('档案已删除');
  } catch (err) {
    toast(`删除出错: ${err.message}`, true);
  }
}

// ── Detail Modal ──────────────────────────────────────────────────────────────
async function openDetail(itemId) {
  const item = state.allItems.find((i) => i.id === itemId);
  if (!item) return;

  // Show immediately with no session stat, then re-render with comparison data
  $('detailModal').style.display = 'flex';
  $('modalContent').innerHTML = buildDetailHtml(item, null);
  $('modalContent').scrollTop = 0;

  // Fetch session stat for comparison view (only for non-WorldTraverse items)
  let sessionStat = null;
  const sessionId = $('sessionSelect').value;
  if (sessionId && item.type !== 'WorldTraverse') {
    try {
      const detail = await fetch(`/api/sessions/${sessionId}`).then(r => r.json());
      sessionStat = detail.statData || null;
    } catch (_) {}
    if (sessionStat) {
      $('modalContent').innerHTML = buildDetailHtml(item, sessionStat);
      $('modalContent').scrollTop = 0;
    }
  }

  // Bind modal actions (runs after final innerHTML assignment)
  const redeemBtn = $('modalContent').querySelector('.modal-redeem-btn');
  if (redeemBtn) {
    redeemBtn.addEventListener('click', () => {
      const selId = $('modalContent').querySelector('.modal-sess-sel')?.value || $('sessionSelect').value;
      if (!selId) { toast('请选择存档', true); return; }
      if (item.baseAnchor) doPull(itemId, selId);
      else doRedeem(itemId, selId);
    });
  }
  const delBtn = $('modalContent').querySelector('.modal-delete-btn');
  if (delBtn) {
    delBtn.addEventListener('click', () => deleteItem(itemId));
  }
  $('modalContent').querySelectorAll('.archive-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteArchive(btn.dataset.archiveId);
    });
  });
  $('modalContent').querySelectorAll('.archive-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openArchiveEdit(btn.dataset.archiveId, itemId);
    });
  });
}

// Dispatch to type-specific renderer
function buildDetailHtml(item, sessionStat) {
  if (item.type === 'Companion')      return buildCompanionDetailHtml(item, sessionStat);
  if (item.type === 'Mech')           return buildMechDetailHtml(item, sessionStat);
  if (item.type === 'WorldTraverse')  return buildWorldTraverseDetailHtml(item);
  return buildAbilityDetailHtml(item, sessionStat);
}

// Helper: get value from [val, label] tuple or plain value
function gv(obj, key, fallback = '') {
  if (!obj) return fallback;
  const v = obj[key];
  return Array.isArray(v) ? v[0] : (v ?? fallback);
}

// Shared: session selector + action bar
function detailActions(item) {
  const sessOptions = state.sessions.map(
    (s) => `<option value="${s.id}"${s.id === $('sessionSelect').value ? ' selected' : ''}>${escHtml(s.name)}</option>`
  ).join('');
  return `<div class="detail-actions">
  <div class="redeem-session-row">
    <label>兑换至：</label>
    <select class="shop-select modal-sess-sel">
      <option value="">— 选择存档 —</option>
      ${sessOptions}
    </select>
  </div>
  <button class="btn btn-success modal-redeem-btn">✓ 确认兑换</button>
  <button class="btn btn-danger modal-delete-btn">删除</button>
</div>`;
}

// Shared: evaluation report block
function evalBlock(item) {
  if (!item.systemEvaluation) return '';
  return `<div class="detail-section dc-eval">
  <h3>三轮评估报告</h3>
  <div class="eval-report">${escHtml(item.systemEvaluation)}</div>
</div>`;
}

// ── COMPANION detail ──────────────────────────────────────────────────────────
function buildCompanionDetailHtml(item, _sessionStat) {
  const comp = (item.effects?.companions || [])[0] || {};
  const up   = comp.UserPanel || {};
  const cs   = comp.CoreSystem || {};
  const ds   = comp.DynamicStatus || {};
  const rs   = comp.RelationshipSystem || {};
  const lo   = comp.Loadout || {};

  const name      = gv(up, 'Name')  || item.name || '未知同伴';
  const title     = gv(up, 'Title');
  const identity  = gv(up, 'Identity');
  const visuals   = gv(up.Appearance, 'Visuals');
  const clothing  = gv(up.Appearance, 'Clothing');
  const alignment = gv(up.Personality, 'Alignment');
  const traits    = up.Personality?.Traits || [];
  const analysis  = gv(up.Personality, 'Analysis');

  const normalTier = gv(cs.Tier, 'NormalTier') ?? '?';
  const burstTier  = gv(cs.Tier, 'BurstTier')  ?? '?';
  const hp         = gv(ds.HP, 'Value');
  const hpMax      = gv(ds.HP, 'MaxValue');

  const ATTR_KEYS  = ['STR','DUR','VIT','REC','AGI','REF','PER','MEN','SOL','CHA'];
  const attrs      = cs.Attributes || {};
  const attrRows   = ATTR_KEYS.map((k) => {
    const val = attrs[k];
    if (val == null) return '';
    const v   = Array.isArray(val) ? val[0] : val;
    const lbl = Array.isArray(val) ? (val[1] || k) : k;
    const fmt = typeof v === 'number' ? v.toLocaleString() : v;
    return `<tr><td class="ca-key">${k}</td><td class="ca-lbl">${escHtml(lbl)}</td><td class="ca-val">${fmt}</td></tr>`;
  }).join('');

  const pools   = ds.EnergyPools || [];
  const poolsH  = pools.map((p) => {
    const nm  = Array.isArray(p.Name)     ? p.Name[0]     : (p.Name  || '?');
    const cur = Array.isArray(p.Value)    ? p.Value[0]    : (p.Value  ?? 0);
    const mx  = Array.isArray(p.MaxValue) ? p.MaxValue[0] : (p.MaxValue ?? 0);
    return `<div class="comp-pool"><span class="pool-name">${escHtml(nm)}</span><span class="pool-val">${typeof cur==='number'?cur.toLocaleString():cur} / ${typeof mx==='number'?mx.toLocaleString():mx}</span></div>`;
  }).join('');

  // Ability rows helper
  const mkAbRows = (tag, cls, arr, nameF, descF) =>
    arr.map((ab) => `<div class="comp-ability ${cls}">
      <span class="comp-ab-tag">${tag}</span>
      <span class="comp-ab-name">${escHtml(nameF(ab))}</span>
      ${descF(ab) ? `<div class="comp-ab-desc">${escHtml(descF(ab))}</div>` : ''}
    </div>`).join('');

  const passivesH  = mkAbRows('被动', 'tag-passive', lo.PassiveAbilities || [],
    (a) => gv(a,'Name') || a.name || '?',
    (a) => gv(a,'Description') || a.description || '');
  const techsH     = mkAbRows('技巧', 'tag-tech', lo.ApplicationTechniques || [],
    (a) => gv(a,'Name') || a.name || '?',
    (a) => gv(a,'Description') || a.description || '');
  const psH        = mkAbRows('基盘', 'tag-ps', lo.PowerSources || [],
    (a) => gv(a,'Name') || a.name || '?',
    (a) => gv(a,'Description') || a.description || '');
  const eqH        = mkAbRows('装备', 'tag-inv', lo.Inventory?.Equipped || [],
    (a) => a.ItemName || a.name || '?',
    (a) => a.Description || a.description || '');

  // Mech body inside companion loadout (e.g. sentient robot)
  const mechsH = (lo.MechanizedUnits || []).map((m) => {
    const nm    = Array.isArray(m.UnitName) ? m.UnitName[0] : (m.UnitName || '机体');
    const model = m.Model || '';
    const tier  = m.BaseSpecs?.Tier ?? '?';
    return `<div class="comp-ability comp-mech-body">
      <span class="comp-ab-tag">机体</span>
      <span class="comp-ab-name">${escHtml(nm)}${model ? ` [${escHtml(model)}]` : ''} · ${tier}★</span>
    </div>`;
  }).join('');

  const loadoutH = psH + passivesH + techsH + eqH + mechsH;
  const medStr   = (item.requiredMedals || []).map((m) => `${m.stars}★×${m.count}`).join(' + ') || '无';

  return `<div class="detail-companion">
  <div class="dc-header">
    <div class="dc-name">${escHtml(name)}</div>
    ${title    ? `<div class="dc-title">${escHtml(title)}</div>`       : ''}
    ${identity ? `<div class="dc-identity">${escHtml(identity)}</div>` : ''}
  </div>
  <div class="detail-meta">
    <span class="meta-chip ${tierClass(item.tier)}">${tierStars(item.tier)} · ${TIER_NAMES[item.tier] || ''}</span>
    <span class="meta-chip">同伴/召唤体</span>
    <span class="meta-chip highlight">💰 ${(item.pricePoints || 0).toLocaleString()} 积分</span>
    <span class="meta-chip">🏅 ${medStr}</span>
  </div>
  <div class="dc-relation">
    <span class="dc-rel-badge">关系：${escHtml(rs.Status || '?')}</span>
    ${rs.Sentiment ? `<span class="dc-rel-badge">情感：${escHtml(rs.Sentiment)}</span>` : ''}
    <span class="dc-rel-badge">好感度：${rs.Favorability ?? 0}</span>
  </div>

  <div class="dc-body">
    <div class="dc-profile">
      ${visuals || clothing ? `<div class="dc-section-title">外貌</div>
      ${visuals  ? `<div class="dc-profile-text">${escHtml(visuals)}</div>` : ''}
      ${clothing ? `<div class="dc-profile-text clothing">${escHtml(clothing)}</div>` : ''}` : ''}
      ${alignment || traits.length || analysis ? `
      <div class="dc-section-title">性格</div>
      ${alignment ? `<div class="dc-alignment">${escHtml(alignment)}</div>` : ''}
      ${traits.length ? `<div class="dc-traits">${traits.map((t) => `<span class="dc-trait">${escHtml(String(t))}</span>`).join('')}</div>` : ''}
      ${analysis  ? `<div class="dc-analysis">${escHtml(analysis)}</div>` : ''}` : ''}
      ${item.description ? `
      <div class="dc-section-title">背景</div>
      <div class="dc-desc">${escHtml(item.description)}</div>` : ''}
    </div>

    <div class="dc-stats">
      <div class="dc-section-title">核心属性</div>
      <div class="dc-tier-row">
        <span class="dc-tier-badge ${tierClass(normalTier)}">常态 ${normalTier}★</span>
        ${burstTier !== normalTier ? `<span class="dc-tier-badge ${tierClass(burstTier)}">爆发 ${burstTier}★</span>` : ''}
      </div>
      ${attrRows ? `<table class="comp-attr-table"><tbody>${attrRows}</tbody></table>` : ''}
      ${(hp !== '' || hpMax !== '') ? `<div class="comp-hp">HP <span class="hp-val">${typeof hp==='number'?hp.toLocaleString():hp}</span> / ${typeof hpMax==='number'?hpMax.toLocaleString():hpMax}</div>` : ''}
      ${poolsH ? `<div class="dc-section-title">能量池</div><div class="comp-pools">${poolsH}</div>` : ''}
    </div>
  </div>

  ${loadoutH ? `<div class="dc-loadout">
    <div class="dc-section-title">装备 / 能力</div>
    <div class="comp-abilities">${loadoutH}</div>
  </div>` : ''}

  ${evalBlock(item)}
  ${detailActions(item)}
</div>`;
}

// ── MECH detail ───────────────────────────────────────────────────────────────
function buildMechDetailHtml(item, _sessionStat) {
  const mech = (item.effects?.mechs || [])[0] || {};
  const vp   = mech.VisualProfile || {};
  const mi   = mech.MachineIntelligence || {};
  const bs   = mech.BaseSpecs || {};
  const str  = mech.Structure || {};
  const lr   = mech.LocalResources || {};
  const hp   = mech.Hardpoints || {};
  const ss   = mech.SpecialSystems || [];

  const unitName = (Array.isArray(mech.UnitName) ? mech.UnitName[0] : mech.UnitName) || item.name || '未知机体';
  const model    = mech.Model || '';
  const status   = mech.Status || 'Active';

  const style      = gv(vp, 'DesignStyle') || (typeof vp.DesignStyle === 'string' ? vp.DesignStyle : '');
  const paint      = typeof vp.PaintJob === 'string' ? vp.PaintJob : '';
  const silhouette = typeof vp.Silhouette === 'string' ? vp.Silhouette : '';
  const height     = vp.Height ?? '';
  const weight     = vp.Weight ?? '';

  const aiInstalled = mi.Installed;
  const aiName      = mi.Name  || '无';
  const aiType      = mi.Type  || '';
  const syncRate    = mi.SyncRate ?? '';

  const bsTier  = bs.Tier ?? '?';
  const offense = bs.Equivalence?.Offense ?? '?';
  const defense = bs.Equivalence?.Defense ?? '?';
  const speed   = bs.Equivalence?.Speed   ?? '?';

  const integrity = str.TotalIntegrity ?? '?';
  const armorType = str.ArmorType || '?';
  const comps     = str.Components || {};

  const gen     = lr.Generator || '?';
  const enVal   = Array.isArray(lr.Energy?.Value)     ? lr.Energy.Value[0]     : (lr.Energy?.Value     ?? 0);
  const enMax   = Array.isArray(lr.Energy?.Max)       ? lr.Energy.Max[0]       : (lr.Energy?.Max       ?? 0);
  const fuelVal = Array.isArray(lr.Propellant?.Value) ? lr.Propellant.Value[0] : (lr.Propellant?.Value ?? 0);
  const fuelMax = Array.isArray(lr.Propellant?.Max)   ? lr.Propellant.Max[0]   : (lr.Propellant?.Max   ?? 0);

  const fmtN = (v) => typeof v === 'number' ? v.toLocaleString() : String(v);

  // Component bars
  const compH = Object.entries(comps).map(([, c]) => {
    if (!c) return '';
    const nm     = Array.isArray(c.Name)   ? c.Name[0]   : (c.Name   || '?');
    const chp    = Array.isArray(c.HP)     ? c.HP[0]     : (c.HP     ?? 0);
    const cstate = Array.isArray(c.Status) ? c.Status[0] : (c.Status || 'OK');
    const col    = cstate === 'OK' ? '#5a9a5a' : (cstate === 'Damaged' ? '#c8a040' : '#c84040');
    return `<div class="mech-comp-row">
      <span class="mech-comp-name">${escHtml(nm)}</span>
      <span class="mech-comp-hp">HP ${fmtN(chp)}</span>
      <span class="mech-comp-status" style="color:${col}">${escHtml(cstate)}</span>
    </div>`;
  }).join('');

  // Hardpoints
  const hpSlots = [['MainHand','主手'],['OffHand','副手'],['BackPack','背包'],['InternalBay','内置'],['FixedWeapons','固装']];
  const hpH = hpSlots.flatMap(([slot, label]) =>
    (hp[slot] || []).map((w) => {
      const nm   = w.ItemName || w.name || '?';
      const type = w.Type     || w.type || '';
      const desc = w.Description || w.description || '';
      return `<div class="mech-wp-item">
        <div class="mech-wp-header">
          <span class="mech-wp-slot">${label}</span>
          <span class="mech-wp-name">${escHtml(nm)}</span>
          ${type ? `<span class="mech-wp-type">${escHtml(type)}</span>` : ''}
        </div>
        ${desc ? `<div class="mech-wp-desc">${escHtml(desc)}</div>` : ''}
      </div>`;
    })
  ).join('');

  // Special systems
  const ssH = ss.map((sys) => {
    const nm   = sys.Name || '?';
    const type = sys.Type || '';
    const desc = sys.Description || '';
    return `<div class="mech-sys-item">
      <div class="mech-sys-header">
        <span class="mech-sys-name">${escHtml(nm)}</span>
        ${type ? `<span class="mech-sys-type">${escHtml(type)}</span>` : ''}
      </div>
      ${desc ? `<div class="mech-sys-desc">${escHtml(desc)}</div>` : ''}
    </div>`;
  }).join('');

  const medStr = (item.requiredMedals || []).map((m) => `${m.stars}★×${m.count}`).join(' + ') || '无';

  return `<div class="detail-mech">
  <div class="dm-header">
    <div class="dm-name">${escHtml(unitName)}</div>
    ${model ? `<div class="dm-model">${escHtml(model)}</div>` : ''}
    <span class="dm-status-badge">${escHtml(status)}</span>
  </div>
  <div class="detail-meta">
    <span class="meta-chip ${tierClass(item.tier)}">${tierStars(item.tier)} · ${TIER_NAMES[item.tier] || ''}</span>
    <span class="meta-chip">机体/机器人</span>
    <span class="meta-chip highlight">💰 ${(item.pricePoints || 0).toLocaleString()} 积分</span>
    <span class="meta-chip">🏅 ${medStr}</span>
  </div>

  <div class="dm-body">
    <div class="dm-profile">
      <div class="dm-section-title">外形参数</div>
      <table class="dm-spec-table">
        ${style      ? `<tr><td>设计风格</td><td>${escHtml(style)}</td></tr>` : ''}
        ${height     ? `<tr><td>全高</td><td>${escHtml(String(height))}</td></tr>` : ''}
        ${weight     ? `<tr><td>全重</td><td>${escHtml(String(weight))}</td></tr>` : ''}
        ${paint      ? `<tr><td>涂装</td><td>${escHtml(paint)}</td></tr>` : ''}
        ${silhouette ? `<tr><td>体型</td><td>${escHtml(silhouette)}</td></tr>` : ''}
      </table>
      ${aiInstalled ? `
      <div class="dm-section-title">机体智能</div>
      <table class="dm-spec-table">
        <tr><td>AI系统</td><td>${escHtml(aiName)}</td></tr>
        ${aiType   ? `<tr><td>类型</td><td>${escHtml(aiType)}</td></tr>` : ''}
        ${syncRate !== '' ? `<tr><td>同步率</td><td>${syncRate}%</td></tr>` : ''}
      </table>` : ''}
      ${item.description ? `
      <div class="dm-section-title">描述</div>
      <div class="dc-desc">${escHtml(item.description)}</div>` : ''}
    </div>

    <div class="dm-specs">
      <div class="dm-section-title">战力指标（${bsTier}★）</div>
      <div class="dm-equiv-grid">
        <div class="dm-equiv-item"><div class="eq-label">攻击</div><div class="eq-val">${offense}</div></div>
        <div class="dm-equiv-item"><div class="eq-label">防御</div><div class="eq-val">${defense}</div></div>
        <div class="dm-equiv-item"><div class="eq-label">机动</div><div class="eq-val">${speed}</div></div>
      </div>
      <div class="dm-section-title">结构</div>
      <table class="dm-spec-table">
        <tr><td>总完整度</td><td>${fmtN(integrity)}</td></tr>
        <tr><td>装甲类型</td><td>${escHtml(armorType)}</td></tr>
      </table>
      ${compH ? `<div class="dm-section-title">核心部件</div><div class="dm-comps">${compH}</div>` : ''}
      <div class="dm-section-title">本机资源</div>
      <table class="dm-spec-table">
        <tr><td>动力炉</td><td>${escHtml(gen)}</td></tr>
        <tr><td>能源</td><td>${fmtN(enVal)} / ${fmtN(enMax)}</td></tr>
        <tr><td>燃料</td><td>${fmtN(fuelVal)} / ${fmtN(fuelMax)}</td></tr>
      </table>
    </div>
  </div>

  ${hpH ? `<div class="dm-hardpoints">
    <div class="dm-section-title">武装挂载</div>
    <div class="mech-hardpoints">${hpH}</div>
  </div>` : ''}

  ${ssH ? `<div class="dm-systems">
    <div class="dm-section-title">特殊系统</div>
    <div class="mech-systems">${ssH}</div>
  </div>` : ''}

  ${evalBlock(item)}
  ${detailActions(item)}
</div>`;
}

// ── ABILITY / ITEM / KNOWLEDGE detail (all non-Companion/Mech types) ──────────

// ─── Loadout Comparison & Replacement Helpers ─────────────────────────────────

/** Extract display name from a loadout entry ([val,label] tuple, plain, or named field). */
function nameFromEntry(obj) {
  if (!obj) return '?';
  for (const k of ['Name', 'ItemName', 'Topic']) {
    if (obj[k] !== undefined) {
      const v = obj[k];
      return String(Array.isArray(v) ? (v[0] ?? '?') : (v ?? '?'));
    }
  }
  return obj.name || obj.topic || '?';
}

/** Get first value from [val, label] tuple or plain field on obj. */
function fieldVal(obj, key) {
  if (!obj) return '';
  const v = obj[key];
  if (v === undefined) return '';
  return String(Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
}

/**
 * Normalise CompanionRoster.ActiveCompanions which can be an array or
 * a keyed object (both forms exist in saves).
 */
function toCompanionArray(raw) {
  return Array.isArray(raw)
    ? raw
    : Object.values(raw || {}).filter(c => c && typeof c === 'object');
}

/**
 * Find an existing loadout entry by name in all sections of sessionStat.
 * Returns { item, type, companionName? } or null.
 */
function findItemInLoadout(sessionStat, targetLower) {
  const cs  = sessionStat?.CharacterSheet;
  const lo  = cs?.Loadout || {};
  const companions = toCompanionArray(sessionStat?.CompanionRoster?.ActiveCompanions);

  const getNm = (e) => {
    if (!e || typeof e !== 'object') return '';
    for (const k of ['Name', 'ItemName', 'UnitName', 'Topic']) {
      if (e[k] !== undefined) {
        const v = e[k];
        return String(Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
      }
    }
    if (e.UserPanel?.Name) {
      const v = e.UserPanel.Name;
      return String(Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
    }
    return '';
  };

  const mainSections = [
    { arr: lo.PassiveAbilities      || [], type: 'passive' },
    { arr: lo.PowerSources          || [], type: 'ps'      },
    { arr: lo.ApplicationTechniques || [], type: 'tech'    },
    { arr: lo.Inventory?.Equipped   || [], type: 'inv'     },
    { arr: lo.MechanizedUnits       || [], type: 'mech'    },
    { arr: cs?.KnowledgeBase?.Database?.RootNodes || [], type: 'kb' },
  ];
  for (const sec of mainSections) {
    const found = sec.arr.find(e => getNm(e).toLowerCase().includes(targetLower));
    if (found) return { item: found, type: sec.type };
  }

  for (const comp of companions) {
    const compNm = getNm(comp);
    if (compNm.toLowerCase().includes(targetLower)) {
      return { item: comp, type: 'companion', companionName: compNm };
    }
    const cLo = comp.Loadout || {};
    const compSections = [
      { arr: cLo.PassiveAbilities      || [], type: 'comp-passive' },
      { arr: cLo.PowerSources          || [], type: 'comp-ps'      },
      { arr: cLo.ApplicationTechniques || [], type: 'comp-tech'    },
      { arr: cLo.Inventory?.Equipped   || [], type: 'comp-inv'     },
      { arr: cLo.MechanizedUnits       || [], type: 'comp-mech'    },
    ];
    for (const sec of compSections) {
      const found = sec.arr.find(e => getNm(e).toLowerCase().includes(targetLower));
      if (found) return { item: found, type: sec.type, companionName: compNm };
    }
  }
  return null;
}

/** Render key-value preview of a found loadout entry (the "before" side). */
function buildEntryPreview(foundResult) {
  const { item, type, companionName } = foundResult;
  const rows = [];
  const push = (k, v) => { if (v != null && v !== '' && v !== '?') rows.push([k, String(v)]); };

  if (companionName && type !== 'companion') push('所属伙伴', companionName);

  if (type === 'inv' || type === 'comp-inv') {
    push('名称', fieldVal(item, 'ItemName') || fieldVal(item, 'Name'));
    push('类型', fieldVal(item, 'Type'));
    const qty = Array.isArray(item.Quantity) ? item.Quantity[0] : item.Quantity;
    if (qty > 1) push('数量', qty);
    push('描述', fieldVal(item, 'Description'));
  } else if (type === 'ps' || type === 'comp-ps') {
    push('名称', fieldVal(item, 'Name'));
    push('类型', fieldVal(item, 'Type'));
    push('阶段', fieldVal(item.Cultivation, 'Realm'));
    push('描述', fieldVal(item, 'Description'));
  } else if (type === 'passive' || type === 'comp-passive') {
    push('名称', fieldVal(item, 'Name'));
    push('类型', fieldVal(item, 'Type'));
    push('描述', fieldVal(item, 'Description'));
  } else if (type === 'tech' || type === 'comp-tech') {
    push('名称', fieldVal(item, 'Name'));
    push('流派', fieldVal(item, 'School'));
    const subs = Object.keys(item.SubMoves || {}).filter(k => !k.startsWith('$'));
    if (subs.length) push('子招式', subs.join('、'));
    push('描述', fieldVal(item, 'Description'));
  } else if (type === 'mech' || type === 'comp-mech') {
    push('名称', fieldVal(item, 'UnitName') || fieldVal(item, 'Name'));
    const tier = item.BaseSpecs?.Tier;
    if (tier != null) push('星级', `${tier}★`);
    push('装甲', item.Structure?.ArmorType);
    const integrity = item.Structure?.TotalIntegrity;
    if (integrity != null) push('完整度', integrity);
  } else if (type === 'companion') {
    const up = item.UserPanel || {};
    push('名称', fieldVal(up, 'Name'));
    const nt = item.CoreSystem?.Tier?.NormalTier;
    if (nt != null) push('星级', `${Array.isArray(nt) ? nt[0] : nt}★`);
    push('身份', fieldVal(up, 'Identity'));
    push('描述', fieldVal(up.Personality, 'Analysis'));
  } else {
    push('名称', nameFromEntry(item));
    push('描述', fieldVal(item, 'Description') || fieldVal(item, 'Content'));
  }

  if (!rows.length) return `<div class="replace-field"><span class="replace-val muted">(无详细数据)</span></div>`;
  return rows.map(([k, v]) => `<div class="replace-field">
    <span class="replace-key">${escHtml(k)}</span>
    <span class="replace-val">${escHtml(v)}</span>
  </div>`).join('');
}

/** Render preview of the new item (the "after" side). */
function buildAfterPreview(op, shopItem, beforeType) {
  const effects = shopItem.effects || {};
  const rows = [];
  const push = (k, v) => { if (v != null && v !== '') rows.push([k, String(v)]); };

  let src = op.newItemDetails || null;
  if (!src) {
    const typeMap = {
      inv: effects.inventoryItems, 'comp-inv': effects.inventoryItems,
      ps:  effects.powerSources,   'comp-ps':  effects.powerSources,
      passive: effects.passiveAbilities, 'comp-passive': effects.passiveAbilities,
      tech: effects.applicationTechniques, 'comp-tech': effects.applicationTechniques,
      mech: effects.mechs, 'comp-mech': effects.mechs,
      companion: effects.companions,
    };
    const arr = typeMap[beforeType] || [];
    if (arr && arr.length > 0) src = arr[0];
  }

  if (src) {
    if (beforeType === 'inv' || beforeType === 'comp-inv') {
      push('名称', src.name || src.ItemName || '?');
      push('类型', src.type || src.Type);
      if (src.quantity > 1) push('数量', src.quantity);
      push('描述', src.description || src.Description);
    } else if (beforeType === 'ps' || beforeType === 'comp-ps') {
      push('名称', src.name || '?');
      push('类型', src.type);
      push('初始阶段', src.initialRealm);
      push('描述', src.description);
    } else if (beforeType === 'passive' || beforeType === 'comp-passive') {
      push('名称', src.name || '?');
      push('类型', src.type);
      push('描述', src.description);
    } else if (beforeType === 'tech' || beforeType === 'comp-tech') {
      push('名称', src.schoolName || src.name || '?');
      push('流派', src.school);
      push('描述', src.description);
      if (Array.isArray(src.subTechniques) && src.subTechniques.length) {
        push('招式数', `${src.subTechniques.length} 个`);
        src.subTechniques.forEach((s, i) => push(`招式${i + 1}`, `[${s.proficiencyLevel || '入门'}] ${s.name || '?'}：${s.desc || s.description || ''}`));
      }
    } else if (beforeType === 'mech' || beforeType === 'comp-mech') {
      const nm = Array.isArray(src.UnitName) ? src.UnitName[0] : (src.UnitName || src.name || '?');
      push('名称', nm);
      const tier = src.BaseSpecs?.Tier ?? src.tier;
      if (tier != null) push('星级', `${tier}★`);
      push('装甲', src.Structure?.ArmorType);
    } else if (beforeType === 'companion') {
      const up = src.UserPanel || {};
      const nm = Array.isArray(up.Name) ? up.Name[0] : (up.Name || src.name || '?');
      push('名称', nm);
      const nt = src.CoreSystem?.Tier?.NormalTier;
      if (nt != null) push('星级', `${Array.isArray(nt) ? nt[0] : nt}★`);
      push('身份', Array.isArray(up.Identity) ? up.Identity[0] : up.Identity);
    } else {
      push('名称', src.name || src.topic || '?');
      push('描述', src.description || src.content);
    }
  } else {
    push('名称', shopItem.name || '?');
    push('描述', shopItem.description);
  }
  if (op.rationale) push('说明', op.rationale);

  if (!rows.length) return `<div class="replace-field"><span class="replace-val muted">(${escHtml(shopItem.name || '?')})</span></div>`;
  return rows.map(([k, v]) => `<div class="replace-field">
    <span class="replace-key">${escHtml(k)}</span>
    <span class="replace-val">${escHtml(v)}</span>
  </div>`).join('');
}

/**
 * Build before/after comparison panels from effects.itemOperations.
 * Only shown when the item has delete/modify operations and a session is selected.
 */
function buildItemOpsCompare(item, sessionStat) {
  const ops = (item.effects?.itemOperations || []).filter(
    op => op.targetItemName && (op.type === 'delete' || op.type === 'modify')
  );
  if (!ops.length) return '';

  const panels = ops.map(op => {
    const targetLower = String(op.targetItemName).toLowerCase().trim();
    const foundResult = sessionStat ? findItemInLoadout(sessionStat, targetLower) : null;

    const beforeHtml = foundResult
      ? buildEntryPreview(foundResult)
      : `<div class="replace-field replace-not-found">未找到「${escHtml(op.targetItemName)}」（将在兑换时按名称匹配删除）</div>`;

    const afterHtml = buildAfterPreview(op, item, foundResult?.type || 'inv');

    return `<div class="replace-panel">
  <div class="replace-col replace-before">
    <div class="replace-col-header">当前（替换前）</div>
    ${beforeHtml}
  </div>
  <div class="replace-arrow">→</div>
  <div class="replace-col replace-after">
    <div class="replace-col-header">兑换后</div>
    ${afterHtml}
  </div>
</div>`;
  });

  return `<div class="detail-section replace-ops-section">
  <h3>🔄 替换 / 升级对比</h3>
  ${panels.join('')}
</div>`;
}

/**
 * Build full-loadout overview for the detail modal (all sections as chips).
 * Highlights entries that would be replaced/upgraded by this item.
 */
function buildLoadoutCompare(item, sessionStat) {
  if (!sessionStat) return '';
  const cs         = sessionStat?.CharacterSheet;
  const lo         = cs?.Loadout || {};
  const kb         = cs?.KnowledgeBase?.Database?.RootNodes || [];
  const companions = toCompanionArray(sessionStat?.CompanionRoster?.ActiveCompanions);

  const grantedNames = new Set([
    ...(item.effects?.passiveAbilities      || []).map(a => (a.name || '').toLowerCase()),
    ...(item.effects?.powerSources          || []).map(p => (p.name || '').toLowerCase()),
    ...(item.effects?.applicationTechniques || []).map(t => ((t.schoolName || t.name) || '').toLowerCase()),
    ...(item.effects?.inventoryItems        || []).map(i => (i.name || '').toLowerCase()),
    ...(item.effects?.knowledgeNodes        || []).map(n => (n.topic || '').toLowerCase()),
    ...(toCompanionArray(item.effects?.companions)).map(c => {
      const up = c.UserPanel;
      return (Array.isArray(up?.Name) ? up.Name[0] : up?.Name || '').toLowerCase();
    }),
  ].filter(Boolean));

  const toChip = (obj, nameKey = 'Name', detailFn = null) => {
    const nm = nameFromEntry(obj) || (Array.isArray(obj?.[nameKey]) ? obj[nameKey][0] : obj?.[nameKey]) || '?';
    const detail = detailFn ? detailFn(obj) : '';
    return { nm: String(nm), detail };
  };

  const sections = [];

  const psChips = (lo.PowerSources || [])
    .filter(p => p && typeof p === 'object' && !String(p).startsWith('$'))
    .map(p => toChip(p, 'Name', o => {
      const realm = Array.isArray(o.Cultivation?.Realm) ? o.Cultivation.Realm[0] : (o.Cultivation?.Realm || '');
      return realm || '';
    }));
  if (psChips.length) sections.push({ key: 'ps', label: '基盘', chips: psChips });

  const abChips = (lo.PassiveAbilities || [])
    .filter(a => a && typeof a === 'object').map(a => toChip(a));
  if (abChips.length) sections.push({ key: 'ab', label: '被动', chips: abChips });

  const techChips = (lo.ApplicationTechniques || [])
    .filter(t => t && typeof t === 'object')
    .map(t => toChip(t, 'Name', o => {
      const subCount = Object.keys(o.SubMoves || {}).length;
      return subCount > 0 ? `${subCount}招` : '';
    }));
  if (techChips.length) sections.push({ key: 'tech', label: '技法', chips: techChips });

  const invChips = (lo.Inventory?.Equipped || [])
    .filter(i => i && typeof i === 'object')
    .map(i => {
      const nm  = Array.isArray(i.ItemName) ? i.ItemName[0] : (i.ItemName || nameFromEntry(i) || '?');
      const qty = Array.isArray(i.Quantity) ? i.Quantity[0] : (i.Quantity || 1);
      return { nm: String(nm), detail: qty > 1 ? `×${qty}` : '' };
    });
  if (invChips.length) sections.push({ key: 'inv', label: '装备', chips: invChips });

  const kbChips = kb.filter(n => n && typeof n === 'object')
    .map(n => toChip(n, 'Topic', o => {
      const mastery = Array.isArray(o.Mastery?.Level) ? o.Mastery.Level[0] : (o.Mastery?.Level || '');
      return mastery || '';
    }));
  if (kbChips.length) sections.push({ key: 'kb', label: '知识', chips: kbChips });

  if (companions.length) {
    const compChips = companions.map(c => {
      const up    = c.UserPanel;
      const nm    = Array.isArray(up?.Name) ? up.Name[0] : (up?.Name || '?');
      const ctier = Array.isArray(c.CoreSystem?.Tier?.NormalTier)
        ? c.CoreSystem.Tier.NormalTier[0]
        : (c.CoreSystem?.Tier?.NormalTier ?? '?');
      return { nm: String(nm), detail: `${ctier}★`, companion: c };
    });
    sections.push({ key: 'comp', label: '伙伴', chips: compChips });
  }

  if (!sections.length) return '';

  const totalItems    = sections.reduce((acc, s) => acc + s.chips.length, 0);
  const totalUpgrades = sections.reduce((acc, s) =>
    acc + s.chips.filter(ch => grantedNames.has(ch.nm.toLowerCase())).length, 0);

  const badge = totalUpgrades > 0
    ? ` <span class="compare-upgrade-badge">⬆ ${totalUpgrades} 项升级/替换</span>`
    : '';

  const sectionsHtml = sections.map(s => {
    const hasMatch  = s.chips.some(ch => grantedNames.has(ch.nm.toLowerCase()));
    const chipsHtml = s.chips.map(ch => {
      const matched = grantedNames.has(ch.nm.toLowerCase());
      const label   = matched ? `⬆ ${escHtml(ch.nm)}` : escHtml(ch.nm);
      const detail  = ch.detail ? ` <em>${escHtml(ch.detail)}</em>` : '';
      return `<span class="compare-chip${matched ? ' compare-chip-match' : ''}" title="${escHtml(ch.nm)}">${label}${detail}</span>`;
    }).join('');

    let subH = '';
    if (s.key === 'comp') {
      subH = s.chips.map(ch => {
        if (!ch.companion) return '';
        const cLo    = ch.companion.Loadout || {};
        const cabs   = (cLo.PassiveAbilities      || []).filter(a => a && typeof a === 'object').map(a => nameFromEntry(a)).filter(Boolean);
        const ctechs = (cLo.ApplicationTechniques || []).filter(t => t && typeof t === 'object').map(t => nameFromEntry(t)).filter(Boolean);
        const cps    = (cLo.PowerSources          || []).filter(p => p && typeof p === 'object').map(p => nameFromEntry(p)).filter(Boolean);
        const cinv   = (cLo.Inventory?.Equipped   || []).filter(i => i && typeof i === 'object').map(i => {
          const nm = Array.isArray(i.ItemName) ? i.ItemName[0] : (i.ItemName || '?');
          return String(nm);
        }).filter(Boolean);
        const parts = [];
        if (cps.length)    parts.push(`<span class="comp-sub-tag">基盘</span>${cps.join('·')}`);
        if (cabs.length)   parts.push(`<span class="comp-sub-tag">被动</span>${cabs.join('·')}`);
        if (ctechs.length) parts.push(`<span class="comp-sub-tag">技法</span>${ctechs.join('·')}`);
        if (cinv.length)   parts.push(`<span class="comp-sub-tag">装备</span>${cinv.join('·')}`);
        if (!parts.length) return '';
        return `<div class="comp-sub-row"><span class="comp-sub-name">${escHtml(ch.nm)}</span>${parts.join(' | ')}</div>`;
      }).filter(Boolean).join('');
    }

    return `<div class="compare-category${hasMatch ? ' compare-category-match' : ''}">
  <span class="compare-cat-label${hasMatch ? ' has-match' : ''}">${s.label}<span class="compare-count">${s.chips.length}</span></span>
  <div class="compare-chips">${chipsHtml}</div>
  ${subH ? `<div class="comp-sub-list">${subH}</div>` : ''}
</div>`;
  }).join('');

  return `<div class="detail-section compare-section">
  <h3>当前存档装备概览 <span class="compare-count">${totalItems}</span>${badge}</h3>
  <div class="compare-overview">${sectionsHtml}</div>
</div>`;
}

function buildAbilityDetailHtml(item, sessionStat) {
  const medStr  = (item.requiredMedals || []).map((m) => `${m.stars}星徽章 × ${m.count}`).join(' + ') || '无需徽章';
  const attrs   = item.effects?.attributeDeltas || {};
  const attrH   = Object.entries(attrs)
    .filter(([, v]) => v && v !== 0)
    .map(([k, v]) => `<span class="attr-delta ${v > 0 ? 'pos' : 'neg'}">${k} ${v > 0 ? '+' : ''}${v}</span>`)
    .join('');

  // Build enhanced effect rows (label + name + full description)
  const effRows = [];
  (item.effects?.newEnergyPools    || []).forEach((p) => effRows.push({ tag: '能量池', cls: 'tag-pool',    name: `${p.name} (0 / ${p.max})`,          desc: p.description || '' }));
  (item.effects?.passiveAbilities  || []).forEach((a) => effRows.push({ tag: '被动',   cls: 'tag-passive', name: a.name || '?',                       desc: a.description || '' }));
  (item.effects?.powerSources      || []).forEach((p) => effRows.push({ tag: '基盘',   cls: 'tag-ps',      name: `${p.name}${p.initialRealm ? ` [${p.initialRealm}]` : ''}`, desc: p.description || '' }));
  (item.effects?.applicationTechniques || []).forEach((t) => {
    const schoolName = t.schoolName || t.name || '?';
    effRows.push({ tag: '流派', cls: 'tag-tech', name: schoolName, desc: t.description || '' });
    (t.subTechniques || []).forEach((s) => {
      const lvl = s.proficiencyLevel ? `[${s.proficiencyLevel}] ` : '';
      const cost = s.costInitial && s.costInitial !== '无消耗' ? ` | 消耗：${s.costInitial}` : '';
      const cd   = s.cooldown && s.cooldown !== '无' ? ` | 冷却：${s.cooldown}` : '';
      effRows.push({ tag: '招式', cls: 'tag-submove', name: `${lvl}${s.name || '?'}`, desc: `${s.desc || s.description || ''}${cost}${cd}` });
    });
  });
  (item.effects?.inventoryItems    || []).forEach((i) => effRows.push({ tag: '物品',   cls: 'tag-inv',     name: `${i.name} ×${i.quantity || 1}`,     desc: i.description || '' }));
  (item.effects?.knowledgeNodes    || []).forEach((n) => effRows.push({ tag: '知识',   cls: 'tag-know',    name: n.topic || '?',                      desc: n.content || '' }));

  const effH = effRows.map((e) => `<div class="eff-item ${e.cls}">
    <div class="eff-item-header">
      <span class="eff-item-tag">${e.tag}</span>
      <span class="eff-item-name">${escHtml(e.name)}</span>
    </div>
    ${e.desc ? `<div class="eff-item-desc">${escHtml(e.desc)}</div>` : ''}
  </div>`).join('');

  const opsCompareH = buildItemOpsCompare(item, sessionStat);
  const compareH    = buildLoadoutCompare(item, sessionStat);

  return `<div class="detail-ability">
  <div class="detail-header">
    <div class="detail-name">${escHtml(item.name || '未命名')}</div>
  </div>
  <div class="detail-meta">
    <span class="meta-chip ${tierClass(item.tier)}">${tierStars(item.tier)} · ${TIER_NAMES[item.tier] || ''}</span>
    <span class="meta-chip">${TYPE_LABELS[item.type] || item.type}</span>
    <span class="meta-chip highlight">💰 ${(item.pricePoints || 0).toLocaleString()} 积分</span>
    <span class="meta-chip">🏅 ${medStr}</span>
  </div>

  <div class="detail-main-grid">
    <div class="detail-main-col">
      <div class="detail-section">
        <h3>描述</h3>
        <div class="detail-desc">${escHtml(item.description || '')}</div>
      </div>
      ${opsCompareH}
      ${attrH ? `<div class="detail-section">
        <h3>属性增量（应用至主角）</h3>
        <div class="attr-delta-row">${attrH}</div>
      </div>` : ''}
      ${compareH}
    </div>

    <div class="detail-main-col">
      ${effH ? `<div class="detail-section">
        <h3>获得内容</h3>
        <div class="eff-items-list">${effH}</div>
      </div>` : ''}
      ${evalBlock(item)}
    </div>
  </div>

  ${detailActions(item)}
</div>`;
}

// ── WORLD TRAVERSE detail ─────────────────────────────────────────────────────
// ── Archive Edit View ─────────────────────────────────────────────────────────

async function openArchiveEdit(archiveId, parentItemId) {
  const mc = $('modalContent');
  mc.innerHTML = `<div style="padding:20px;color:#7a9a7a">加载档案中…</div>`;

  let archive;
  try {
    const resp = await fetch(`/api/worldanchor/archives/${archiveId}`);
    if (!resp.ok) throw new Error('加载失败');
    archive = await resp.json();
  } catch (e) {
    mc.innerHTML = `<div style="padding:20px;color:#c07070">档案加载失败: ${e.message}</div>`;
    return;
  }

  mc.innerHTML = buildArchiveEditHtml(archive, parentItemId);
  mc.scrollTop = 0;
  bindArchiveEditEvents(archive, parentItemId);
}

function buildArchiveEditHtml(archive, parentItemId) {
  const dis = '';

  // Build worldRules rows
  const rulesHtml = (archive.worldRules || []).map((rule, i) => `
    <div class="ae-rule-row" data-idx="${i}">
      <textarea class="ae-rule-text" rows="3" ${dis}>${escHtml(rule)}</textarea>
      <button class="btn btn-ghost btn-xs ae-del-rule" data-idx="${i}" title="删除">✕</button>
    </div>`).join('');

  // Build timeline rows
  const timelineHtml = (archive.timeline || []).map((ev, i) => `
    <div class="ae-tl-row" data-idx="${i}">
      <div class="ae-tl-row-inner">
        <input class="ae-input ae-tl-time" value="${escHtml(ev.time || '')}" placeholder="时间节点（如：-5年/第1话/进行中）" ${dis}>
        <input class="ae-input ae-tl-event" value="${escHtml(ev.event || '')}" placeholder="事件标题（20字内）" ${dis}>
        <button class="btn btn-ghost btn-xs ae-del-tl" data-idx="${i}" title="删除">✕</button>
      </div>
      <textarea class="ae-input ae-tl-impact" rows="2" placeholder="对世界格局/主线的影响" ${dis}>${escHtml(ev.impact || '')}</textarea>
    </div>`).join('');

  // Build powerSystems rows
  const systemsHtml = (archive.powerSystems || []).map((ps, i) => `
    <div class="ae-ps-block" data-idx="${i}">
      <div class="ae-ps-block-header">
        <span class="ae-ps-block-num">${i + 1}</span>
        <input class="ae-input ae-ps-name" value="${escHtml(ps.name || '')}" placeholder="体系名称" ${dis}>
        <input class="ae-input ae-ps-cat" value="${escHtml(ps.category || '')}" placeholder="分类" ${dis}>
        <input class="ae-input ae-ps-tier-t" value="${escHtml(ps.typicalTierRange || '')}" placeholder="普通星级" ${dis}>
        <input class="ae-input ae-ps-tier-p" value="${escHtml(ps.peakTierRange || '')}" placeholder="峰值星级" ${dis}>
        <button class="btn btn-ghost btn-xs ae-del-ps" data-idx="${i}" title="删除体系">✕</button>
      </div>
      <textarea class="ae-input ae-ps-desc" rows="2" placeholder="描述" ${dis}>${escHtml(ps.description || '')}</textarea>
      <input class="ae-input ae-ps-res" value="${escHtml(ps.coreResource || '')}" placeholder="核心资源/门槛" ${dis}>
      <input class="ae-input ae-ps-bar" value="${escHtml(ps.entryBarrier || '')}" placeholder="入门条件" ${dis}>
      <div class="ae-sublist-label">通用机制：</div>
      <div class="ae-sublist ae-mechanics-list" data-ps-idx="${i}">
        ${(ps.universalMechanics || []).map((m, j) => `
          <div class="ae-sublist-row" data-sub-idx="${j}">
            <input class="ae-input ae-sub-input" value="${escHtml(m)}" ${dis}>
            <button class="btn btn-ghost btn-xs ae-del-sub" title="删除">✕</button>
          </div>`).join('')}
      </div>
      <button class="btn btn-ghost btn-xs ae-add-mech" data-ps-idx="${i}">+ 机制</button>
      <div class="ae-sublist-label">通用上限：</div>
      <div class="ae-sublist ae-limits-list" data-ps-idx="${i}">
        ${(ps.universalLimits || []).map((l, j) => `
          <div class="ae-sublist-row" data-sub-idx="${j}">
            <input class="ae-input ae-sub-input" value="${escHtml(l)}" ${dis}>
            <button class="btn btn-ghost btn-xs ae-del-sub" title="删除">✕</button>
          </div>`).join('')}
      </div>
      <button class="btn btn-ghost btn-xs ae-add-limit" data-ps-idx="${i}">+ 上限</button>
    </div>`).join('');

  return `<div class="archive-edit-view">
  <div class="ae-header">
    <button class="btn btn-ghost btn-sm ae-back-btn" data-parent-id="${parentItemId}">← 返回</button>
    <div class="ae-title-block">
      <h2 class="ae-title">${escHtml(archive.displayName)}</h2>
      <span class="ae-meta">${escHtml(archive.universe || '')} · ${escHtml(archive.timePeriod || '')}</span>
    </div>
    <span class="ae-editable-badge">可编辑</span>
  </div>

  <div class="ae-section">
    <h3 class="ae-section-title">基本信息</h3>
    <div class="ae-field-row"><label>世界名称</label><input class="ae-input" id="ae-displayName" value="${escHtml(archive.displayName || '')}" ${dis}></div>
    <div class="ae-field-row"><label>时间背景</label><input class="ae-input" id="ae-timePeriod" value="${escHtml(archive.timePeriod || '')}" ${dis}></div>
    <div class="ae-field-row"><label>建议入场时间点</label><textarea class="ae-input" id="ae-recommendedEntry" rows="2" ${dis}>${escHtml(archive.recommendedEntry || '')}</textarea></div>
    <div class="ae-field-row"><label>初始地点</label><textarea class="ae-input" id="ae-initialLocation" rows="2" ${dis}>${escHtml(archive.initialLocation || '')}</textarea></div>
    <div class="ae-field-row"><label>定级依据</label><input class="ae-input" id="ae-tierReason" value="${escHtml(archive.tierReason || '')}" ${dis}></div>
  </div>

  <div class="ae-section">
    <h3 class="ae-section-title">世界法则 <span class="ae-count">${(archive.worldRules || []).length} 条</span></h3>
    <div class="ae-rules-list" id="ae-rules-list">${rulesHtml}</div>
    <button class="btn btn-ghost btn-sm ae-add-rule-btn" style="margin-top:6px">+ 添加法则</button>
  </div>

  <div class="ae-section ae-timeline-section">
    <h3 class="ae-section-title">📅 大事年表 <span class="ae-count">${(archive.timeline || []).length} 条</span></h3>
    <div class="ae-tl-list" id="ae-tl-list">${timelineHtml}</div>
    <button class="btn btn-ghost btn-sm ae-add-tl-btn" style="margin-top:6px">+ 添加事件</button>
  </div>

  <div class="ae-section">
    <h3 class="ae-section-title">力量体系 <span class="ae-count">${(archive.powerSystems || []).length} 个</span></h3>
    <div class="ae-ps-list" id="ae-ps-list">${systemsHtml}</div>
    <button class="btn btn-ghost btn-sm ae-add-ps-btn" style="margin-top:6px">+ 添加体系</button>
  </div>

  <div class="ae-section ae-timeflow-section">
    <h3 class="ae-section-title">⏱ 时间流速</h3>
    <div class="ae-field-row">
      <label>类型</label>
      <select class="ae-input" id="ae-tf-type" ${dis}>
        <option value="ratio"${archive.timeFlow?.type === 'ratio' || !archive.timeFlow?.type ? ' selected' : ''}>比值（ratio）</option>
        <option value="fixed_interval"${archive.timeFlow?.type === 'fixed_interval' ? ' selected' : ''}>固定跳跃（fixed_interval）</option>
        <option value="frozen"${archive.timeFlow?.type === 'frozen' ? ' selected' : ''}>时间冻结（frozen）</option>
        <option value="hybrid"${archive.timeFlow?.type === 'hybrid' ? ' selected' : ''}>复合规则（hybrid）</option>
      </select>
    </div>
    <div class="ae-field-row ae-tf-hint" style="font-size:0.78rem;color:#6a8a9a;padding:2px 0 4px 0"></div>
    <div class="ae-field-row"><label>描述</label><input class="ae-input" id="ae-tf-desc" value="${escHtml(archive.timeFlow?.description || '')}" placeholder="一句话描述时间流速特性" ${dis}></div>
    <div class="ae-field-row ae-tf-ratio-row"><label>流速比值</label><input class="ae-input" id="ae-tf-ratio" value="${escHtml(archive.timeFlow?.ratioToBase || '')}" placeholder="格式：基准:此世界，如 1:1 / 1:10 / 10:1" ${dis}></div>
    <div class="ae-field-row ae-tf-jump-row"><label>固定跳跃量</label><input class="ae-input" id="ae-tf-jump" value="${escHtml(archive.timeFlow?.fixedJump || '')}" placeholder="每次进入固定跳跃的时间量，如 1个月 / 3年" ${dis}></div>
    <div class="ae-field-row"><label>附注</label><input class="ae-input" id="ae-tf-notes" value="${escHtml(archive.timeFlow?.notes || '')}" placeholder="补充说明，如特殊触发条件" ${dis}></div>
  </div>

  <div class="ae-section ae-identity-section">
    <h3 class="ae-section-title">🪪 在地身份</h3>
    <div class="ae-field-row"><label>头衔 / 绰号</label><input class="ae-input" id="ae-wi-title" value="${escHtml(archive.worldIdentity?.title || '')}" placeholder="如：幸存者、魔术学徒" ${dis}></div>
    <div class="ae-field-row"><label>职业 / 定位</label><input class="ae-input" id="ae-wi-occupation" value="${escHtml(archive.worldIdentity?.occupation || '')}" placeholder="在本世界的职业或社会定位" ${dis}></div>
    <div class="ae-field-row"><label>背景故事</label><textarea class="ae-input" id="ae-wi-background" rows="4" placeholder="100~200字背景故事，说明主角如何立足于此世界" ${dis}>${escHtml(archive.worldIdentity?.background || '')}</textarea></div>
    <div class="ae-field-row">
      <label>核心记忆</label>
      <div class="ae-sublist ae-wi-memories-list" id="ae-wi-memories-list">
        ${(archive.worldIdentity?.coreMemories || []).map((m, i) => `
          <div class="ae-sublist-row" data-sub-idx="${i}">
            <input class="ae-input ae-sub-input" value="${escHtml(m)}" placeholder="关键记忆" ${dis}>
            <button class="btn btn-ghost btn-xs ae-del-sub" title="删除">✕</button>
          </div>`).join('')}
      </div>
      <button class="btn btn-ghost btn-xs ae-add-wi-memory" style="margin-top:4px">+ 记忆</button>
    </div>
    <div class="ae-field-row">
      <label>社会关系</label>
      <div class="ae-wi-conn-list" id="ae-wi-conn-list">
        ${(archive.worldIdentity?.socialConnections || []).map((c, i) => `
          <div class="ae-wi-conn-row" data-conn-idx="${i}">
            <input class="ae-input ae-wi-conn-name" value="${escHtml(c.name || '')}" placeholder="人物/组织名" ${dis}>
            <input class="ae-input ae-wi-conn-rel" value="${escHtml(c.relation || '')}" placeholder="关系类型" ${dis}>
            <input class="ae-input ae-wi-conn-note" value="${escHtml(c.note || '')}" placeholder="备注（可选）" ${dis}>
            <button class="btn btn-ghost btn-xs ae-del-conn" title="删除">✕</button>
          </div>`).join('')}
      </div>
      <button class="btn btn-ghost btn-xs ae-add-wi-conn" style="margin-top:4px">+ 关系</button>
    </div>
  </div>

  <div class="ae-actions">
    <button class="btn btn-success ae-save-btn" data-archive-id="${archive.id}" data-parent-id="${parentItemId}">💾 保存修改</button>
    <button class="btn btn-ghost ae-cancel-btn" data-parent-id="${parentItemId}">取消</button>
  </div>
</div>`;
}

const TF_DEFAULTS = {
  ratio:          { hint: '比值格式：基准:此世界（第一个进入的世界为基准=1）。例：1:10 = 基准过1天此世界过10天；10:1 = 基准过10天此世界过1天', desc: '', showRatio: true, showJump: false },
  frozen:         { hint: '时间冻结：离开期间此世界内部时间完全静止', desc: '时间相对外界静止，离开期间内部时间不流逝', showRatio: false, showJump: false },
  fixed_interval: { hint: '固定跳跃：每次重新进入，无论外界过了多久，内部必定跳跃固定时间量', desc: '每次离开后再次进入，内部时间必定跳跃固定量，与外界经过多长时间无关', showRatio: false, showJump: true },
  hybrid:         { hint: '复合规则：在附注中说明各条件下分别适用哪种规则', desc: '', showRatio: true, showJump: true },
};

function updateTfTypeUi(mc, type, autoFillDesc) {
  const cfg = TF_DEFAULTS[type] || TF_DEFAULTS.ratio;
  const hintEl  = mc.querySelector('.ae-tf-hint');
  const ratioRow = mc.querySelector('.ae-tf-ratio-row');
  const jumpRow  = mc.querySelector('.ae-tf-jump-row');
  const descEl   = mc.querySelector('#ae-tf-desc');
  if (hintEl)   hintEl.textContent = cfg.hint;
  if (ratioRow) ratioRow.style.display = cfg.showRatio ? '' : 'none';
  if (jumpRow)  jumpRow.style.display  = cfg.showJump  ? '' : 'none';
  if (autoFillDesc && descEl && !descEl.value && cfg.desc) descEl.value = cfg.desc;
}

function bindArchiveEditEvents(archive, parentItemId) {
  const mc = $('modalContent');

  // Back / Cancel → reopen parent item detail
  mc.querySelectorAll('.ae-back-btn, .ae-cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => openDetail(btn.dataset.parentId));
  });

  // Time flow type selector — show/hide relevant fields and auto-fill defaults
  const tfTypeEl = mc.querySelector('#ae-tf-type');
  if (tfTypeEl) {
    updateTfTypeUi(mc, tfTypeEl.value, false); // initial render, don't overwrite saved desc
    tfTypeEl.addEventListener('change', () => updateTfTypeUi(mc, tfTypeEl.value, true));
  }

  // World identity editors
  bindWorldIdentityEditEvents();

  // Delete rule
  mc.querySelectorAll('.ae-del-rule').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.ae-rule-row').remove();
      updateRuleCount();
    });
  });

  // Add rule
  const addRuleBtn = mc.querySelector('.ae-add-rule-btn');
  if (addRuleBtn) {
    addRuleBtn.addEventListener('click', () => {
      const list = mc.querySelector('#ae-rules-list');
      const div = document.createElement('div');
      div.className = 'ae-rule-row';
      div.innerHTML = `<textarea class="ae-rule-text" rows="3"></textarea>
        <button class="btn btn-ghost btn-xs ae-del-rule" title="删除">✕</button>`;
      div.querySelector('.ae-del-rule').addEventListener('click', () => { div.remove(); updateRuleCount(); });
      list.appendChild(div);
      div.querySelector('textarea').focus();
      updateRuleCount();
    });
  }

  // Timeline: delete event
  function updateTlCount() {
    const h = mc.querySelector('.ae-timeline-section .ae-section-title');
    if (h) h.innerHTML = `📅 大事年表 <span class="ae-count">${mc.querySelectorAll('#ae-tl-list .ae-tl-row').length} 条</span>`;
  }
  mc.querySelectorAll('.ae-del-tl').forEach(btn => {
    btn.addEventListener('click', () => { btn.closest('.ae-tl-row').remove(); updateTlCount(); });
  });

  // Timeline: add event
  const addTlBtn = mc.querySelector('.ae-add-tl-btn');
  if (addTlBtn) {
    addTlBtn.addEventListener('click', () => {
      const list = mc.querySelector('#ae-tl-list');
      const div = document.createElement('div');
      div.className = 'ae-tl-row';
      div.innerHTML = `
        <div class="ae-tl-row-inner">
          <input class="ae-input ae-tl-time" placeholder="时间节点（如：-5年/第1话/进行中）">
          <input class="ae-input ae-tl-event" placeholder="事件标题（20字内）">
          <button class="btn btn-ghost btn-xs ae-del-tl" title="删除">✕</button>
        </div>
        <textarea class="ae-input ae-tl-impact" rows="2" placeholder="对世界格局/主线的影响"></textarea>`;
      div.querySelector('.ae-del-tl').addEventListener('click', () => { div.remove(); updateTlCount(); });
      list.appendChild(div);
      div.querySelector('.ae-tl-time').focus();
      updateTlCount();
    });
  }

  // Delete power system
  mc.querySelectorAll('.ae-del-ps').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.ae-ps-block').remove();
      updatePsCount();
    });
  });

  // Add power system
  const addPsBtn = mc.querySelector('.ae-add-ps-btn');
  if (addPsBtn) {
    addPsBtn.addEventListener('click', () => {
      const list = mc.querySelector('#ae-ps-list');
      const idx = list.querySelectorAll('.ae-ps-block').length;
      const div = document.createElement('div');
      div.className = 'ae-ps-block';
      div.dataset.idx = idx;
      div.innerHTML = `
        <div class="ae-ps-block-header">
          <span class="ae-ps-block-num">${idx + 1}</span>
          <input class="ae-input ae-ps-name" placeholder="体系名称">
          <input class="ae-input ae-ps-cat" placeholder="分类">
          <input class="ae-input ae-ps-tier-t" placeholder="普通星级">
          <input class="ae-input ae-ps-tier-p" placeholder="峰值星级">
          <button class="btn btn-ghost btn-xs ae-del-ps" title="删除体系">✕</button>
        </div>
        <textarea class="ae-input ae-ps-desc" rows="2" placeholder="描述"></textarea>
        <input class="ae-input ae-ps-res" placeholder="核心资源/门槛">
        <input class="ae-input ae-ps-bar" placeholder="入门条件">
        <div class="ae-sublist-label">通用机制：</div>
        <div class="ae-sublist ae-mechanics-list" data-ps-idx="${idx}"></div>
        <button class="btn btn-ghost btn-xs ae-add-mech" data-ps-idx="${idx}">+ 机制</button>
        <div class="ae-sublist-label">通用上限：</div>
        <div class="ae-sublist ae-limits-list" data-ps-idx="${idx}"></div>
        <button class="btn btn-ghost btn-xs ae-add-limit" data-ps-idx="${idx}">+ 上限</button>`;
      bindPsBlockEvents(div);
      list.appendChild(div);
      div.querySelector('.ae-ps-name').focus();
      updatePsCount();
    });
  }

  // Bind existing ps blocks' sub-item events
  mc.querySelectorAll('.ae-ps-block').forEach(block => bindPsBlockEvents(block));

  // Save
  const saveBtn = mc.querySelector('.ae-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => saveArchiveEdit(saveBtn.dataset.archiveId, saveBtn.dataset.parentId));
  }
}

function bindPsBlockEvents(block) {
  // Delete sub-items (mechanics / limits)
  block.querySelectorAll('.ae-del-sub').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.ae-sublist-row').remove());
  });
  // Delete this block
  const delPs = block.querySelector('.ae-del-ps');
  if (delPs) delPs.addEventListener('click', () => { block.remove(); updatePsCount(); });
  // Add mechanic
  const addMech = block.querySelector('.ae-add-mech');
  if (addMech) addMech.addEventListener('click', () => addSubItem(block.querySelector('.ae-mechanics-list')));
  // Add limit
  const addLimit = block.querySelector('.ae-add-limit');
  if (addLimit) addLimit.addEventListener('click', () => addSubItem(block.querySelector('.ae-limits-list')));
}

function addSubItem(listEl) {
  const div = document.createElement('div');
  div.className = 'ae-sublist-row';
  div.innerHTML = `<input class="ae-input ae-sub-input" placeholder="内容">
    <button class="btn btn-ghost btn-xs ae-del-sub" title="删除">✕</button>`;
  div.querySelector('.ae-del-sub').addEventListener('click', () => div.remove());
  listEl.appendChild(div);
  div.querySelector('input').focus();
}

function bindWorldIdentityEditEvents() {
  const mc = $('modalContent');
  // Add memory
  mc.querySelector('.ae-add-wi-memory')?.addEventListener('click', () => {
    const list = mc.querySelector('#ae-wi-memories-list');
    const div = document.createElement('div');
    div.className = 'ae-sublist-row';
    div.innerHTML = `<input class="ae-input ae-sub-input" placeholder="关键记忆">
      <button class="btn btn-ghost btn-xs ae-del-sub" title="删除">✕</button>`;
    div.querySelector('.ae-del-sub').addEventListener('click', () => div.remove());
    list.appendChild(div);
    div.querySelector('input').focus();
  });
  // Add connection
  mc.querySelector('.ae-add-wi-conn')?.addEventListener('click', () => {
    const list = mc.querySelector('#ae-wi-conn-list');
    const div = document.createElement('div');
    div.className = 'ae-wi-conn-row';
    div.innerHTML = `<input class="ae-input ae-wi-conn-name" placeholder="人物/组织名">
      <input class="ae-input ae-wi-conn-rel" placeholder="关系类型">
      <input class="ae-input ae-wi-conn-note" placeholder="备注">
      <button class="btn btn-ghost btn-xs ae-del-conn" title="删除">✕</button>`;
    div.querySelector('.ae-del-conn').addEventListener('click', () => div.remove());
    list.appendChild(div);
    div.querySelector('input').focus();
  });
  // Delete connection
  mc.querySelectorAll('.ae-del-conn').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.ae-wi-conn-row').remove());
  });
}

function updateRuleCount() {
  const mc = $('modalContent');
  const count = mc.querySelectorAll('.ae-rule-row').length;
  const badge = mc.querySelector('.ae-section:nth-child(3) .ae-count');
  if (badge) badge.textContent = `${count} 条`;
}

function updatePsCount() {
  const mc = $('modalContent');
  const count = mc.querySelectorAll('.ae-ps-block').length;
  const badge = mc.querySelector('.ae-section:nth-child(4) .ae-count');
  if (badge) badge.textContent = `${count} 个`;
}

function collectArchiveEdits() {
  const mc = $('modalContent');

  // Basic fields
  const displayName     = mc.querySelector('#ae-displayName')?.value.trim() || '';
  const timePeriod      = mc.querySelector('#ae-timePeriod')?.value.trim() || '';
  const recommendedEntry = mc.querySelector('#ae-recommendedEntry')?.value.trim() || '';
  const initialLocation  = mc.querySelector('#ae-initialLocation')?.value.trim() || '';
  const tierReason       = mc.querySelector('#ae-tierReason')?.value.trim() || '';

  // World rules
  const worldRules = [];
  mc.querySelectorAll('.ae-rule-row').forEach(row => {
    const val = row.querySelector('.ae-rule-text')?.value.trim();
    if (val) worldRules.push(val);
  });

  // Power systems
  const powerSystems = [];
  mc.querySelectorAll('.ae-ps-block').forEach(block => {
    const name            = block.querySelector('.ae-ps-name')?.value.trim() || '';
    const category        = block.querySelector('.ae-ps-cat')?.value.trim() || '';
    const typicalTierRange = block.querySelector('.ae-ps-tier-t')?.value.trim() || '';
    const peakTierRange   = block.querySelector('.ae-ps-tier-p')?.value.trim() || '';
    const description     = block.querySelector('.ae-ps-desc')?.value.trim() || '';
    const coreResource    = block.querySelector('.ae-ps-res')?.value.trim() || '';
    const entryBarrier    = block.querySelector('.ae-ps-bar')?.value.trim() || '';
    const universalMechanics = [];
    block.querySelectorAll('.ae-mechanics-list .ae-sub-input').forEach(inp => {
      const v = inp.value.trim();
      if (v) universalMechanics.push(v);
    });
    const universalLimits = [];
    block.querySelectorAll('.ae-limits-list .ae-sub-input').forEach(inp => {
      const v = inp.value.trim();
      if (v) universalLimits.push(v);
    });
    if (name) powerSystems.push({ name, category, typicalTierRange, peakTierRange, description, coreResource, entryBarrier, universalMechanics, universalLimits });
  });

  // Time flow
  const tfType  = mc.querySelector('#ae-tf-type')?.value || 'ratio';
  const tfDesc  = mc.querySelector('#ae-tf-desc')?.value.trim() || '';
  const tfRatio = mc.querySelector('#ae-tf-ratio')?.value.trim() || '';
  const tfJump  = mc.querySelector('#ae-tf-jump')?.value.trim() || '';
  const tfNotes = mc.querySelector('#ae-tf-notes')?.value.trim() || '';
  const timeFlow = (tfDesc || tfRatio || tfJump || tfNotes || tfType !== 'ratio')
    ? { type: tfType, description: tfDesc, ratioToBase: tfRatio, fixedJump: tfJump, notes: tfNotes }
    : null;

  // World identity
  const wiTitle      = mc.querySelector('#ae-wi-title')?.value.trim() || '';
  const wiOccupation = mc.querySelector('#ae-wi-occupation')?.value.trim() || '';
  const wiBackground = mc.querySelector('#ae-wi-background')?.value.trim() || '';
  const wiMemories = [];
  mc.querySelectorAll('#ae-wi-memories-list .ae-sub-input').forEach(inp => {
    const v = inp.value.trim();
    if (v) wiMemories.push(v);
  });
  const wiConnections = [];
  mc.querySelectorAll('#ae-wi-conn-list .ae-wi-conn-row').forEach(row => {
    const name     = row.querySelector('.ae-wi-conn-name')?.value.trim() || '';
    const relation = row.querySelector('.ae-wi-conn-rel')?.value.trim() || '';
    const note     = row.querySelector('.ae-wi-conn-note')?.value.trim() || '';
    if (name) wiConnections.push({ name, relation, note });
  });
  const worldIdentity = (wiTitle || wiOccupation || wiBackground || wiMemories.length || wiConnections.length)
    ? { title: wiTitle, occupation: wiOccupation, background: wiBackground, coreMemories: wiMemories, socialConnections: wiConnections }
    : null;

  // Timeline
  const timeline = [];
  mc.querySelectorAll('#ae-tl-list .ae-tl-row').forEach(row => {
    const time   = row.querySelector('.ae-tl-time')?.value.trim() || '';
    const event  = row.querySelector('.ae-tl-event')?.value.trim() || '';
    const impact = row.querySelector('.ae-tl-impact')?.value.trim() || '';
    if (time || event) timeline.push({ time, event, impact });
  });

  return { displayName, timePeriod, recommendedEntry, initialLocation, tierReason, worldRules, timeline, powerSystems, timeFlow, worldIdentity };
}

async function saveArchiveEdit(archiveId, parentItemId) {
  const saveBtn = $('modalContent').querySelector('.ae-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '保存中…'; }

  const updates = collectArchiveEdits();

  try {
    const resp = await fetch(`/api/worldanchor/archives/${archiveId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '保存失败');

    // Update local state.archives
    const idx = (state.archives || []).findIndex(a => a.id === archiveId);
    if (idx !== -1) {
      state.archives[idx] = {
        ...state.archives[idx],
        displayName:  data.displayName,
        timePeriod:   data.timePeriod,
        ruleCount:    (data.worldRules || []).length,
        systemCount:  (data.powerSystems || []).length,
        tierReason:   data.tierReason || '',
      };
    }

    toast(`✓ 档案「${data.displayName}」已保存`);
    openDetail(parentItemId); // return to pool view, refreshed
  } catch (err) {
    toast(`保存失败: ${err.message}`, true);
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 保存修改'; }
  }
}

function buildWorldTraverseDetailHtml(item) {
  if (item.baseAnchor) return buildBaseAnchorDetailHtml(item);
  // Legacy: old WorldTraverse items with embedded worldData
  const wd = item.effects?.worldData || {};
  return buildArchiveDetailSection(wd, item, false);
}

function buildBaseAnchorDetailHtml(item) {
  const { TIER_RANGE_LABELS } = window.__shopConst || {};
  const tierLabel = item.name || item.tierRange;
  const archivePool = (state.archives || []).filter(a => a.tierRange === item.tierRange);
  const poolCount = archivePool.length;

  const tierDesc = {
    low:      'Tier 0-2★ · 低危 — 正常人类上限，物理规则近似现实',
    mid:      'Tier 3-5★ · 中危 — 超人类，城市级威胁存在',
    high:     'Tier 6-8★ · 高危 — 国家/大陆级威胁，重型神秘力量',
    stellar:  'Tier 9-10★ · 行星/恒星 — 星球级威胁，顶级神话',
    galactic: 'Tier 11-13★ · 星系/宇宙 — 宇宙尺度威胁',
    beyond:   'Tier 14+★ · 超限 — 超越宇宙，极端高危',
  }[item.tierRange] || '';

  const sessionOpts = state.sessions.map(s =>
    `<option value="${s.id}"${s.id === $('sessionSelect').value ? ' selected' : ''}>${escHtml(s.name)}</option>`
  ).join('');

  const archiveListHtml = archivePool.length
    ? archivePool.map(a => `
      <div class="archive-pool-entry" data-archive-id="${a.id}">
        <div class="archive-entry-main">
          <span class="archive-entry-name">${escHtml(a.displayName)}</span>
          <span class="archive-entry-meta">${escHtml(a.universe || '')} · ${escHtml(a.timePeriod || '')} · ${a.ruleCount || 0}条法则 · ${a.systemCount || 0}个力量体系</span>
          ${a.tierReason ? `<span class="archive-entry-reason">${escHtml(a.tierReason)}</span>` : ''}
        </div>
        <div class="archive-entry-btns">
          <button class="btn btn-ghost btn-xs archive-edit-btn" data-archive-id="${a.id}" title="编辑此档案">✎</button>
          <button class="btn btn-ghost btn-xs archive-del-btn" data-archive-id="${a.id}" title="删除此档案">✕</button>
        </div>
      </div>`).join('')
    : `<div class="archive-pool-empty">档案库为空 — 请在左侧"世界档案生成"中生成 ${tierLabel} 世界</div>`;

  return `<div class="detail-worldtraverse detail-base-anchor">
  <div class="wt-header">
    <div class="wt-icon">🎲</div>
    <div class="wt-title-block">
      <h1 class="wt-world-name">${escHtml(tierLabel)}</h1>
      <div class="wt-meta-row">
        <span class="wt-tag">${escHtml(tierDesc)}</span>
        <span class="wt-tag wt-price-tag">🪙 ${item.pricePoints.toLocaleString()} 积分</span>
        ${(item.requiredMedals||[]).map(m => `<span class="wt-tag wt-medal-tag">🏅 ${m.stars}★ ×${m.count}</span>`).join('')}
      </div>
    </div>
  </div>

  <div class="wt-section">
    <h3 class="wt-section-title">📦 档案库
      <span class="wt-rule-count ${poolCount > 0 ? '' : 'pool-count-empty'}">${poolCount} 个世界</span>
    </h3>
    <div class="archive-pool-list">${archiveListHtml}</div>
  </div>

  <div class="detail-actions">
    ${poolCount > 0 ? `
    <div class="redeem-session-row">
      <label>穿越到存档：</label>
      <select class="shop-select modal-sess-sel">
        <option value="">— 选择存档 —</option>
        ${sessionOpts}
      </select>
    </div>
    <button class="btn btn-success modal-redeem-btn" ${poolCount === 0 ? 'disabled' : ''}>
      🎲 随机穿越 — 从 ${poolCount} 个世界中抽取
    </button>
    ` : `<div class="archive-pool-empty">无可用档案，请先生成世界</div>`}
  </div>
</div>`;
}

function buildPowerSystemsHtml(wd) {
  // New format: powerSystems array
  if (Array.isArray(wd.powerSystems) && wd.powerSystems.length > 0) {
    const items = wd.powerSystems.map(ps => `
      <div class="wt-ps-item">
        <div class="wt-ps-header">
          <span class="wt-ps-name">${escHtml(ps.name || '未知体系')}</span>
          ${ps.category ? `<span class="wt-ps-cat">${escHtml(ps.category)}</span>` : ''}
          ${ps.typicalTierRange ? `<span class="wt-ps-tier">普通 ${escHtml(ps.typicalTierRange)}</span>` : ''}
          ${ps.peakTierRange    ? `<span class="wt-ps-tier wt-ps-peak">峰值 ${escHtml(ps.peakTierRange)}</span>` : ''}
        </div>
        <div class="wt-ps-desc">${escHtml(ps.description || '')}</div>
        ${ps.coreResource ? `<div class="wt-ps-resource">核心资源：${escHtml(ps.coreResource)}</div>` : ''}
        ${ps.entryBarrier  ? `<div class="wt-ps-barrier">门槛：${escHtml(ps.entryBarrier)}</div>` : ''}
        ${(ps.universalMechanics||[]).length ? `
          <ul class="wt-ps-list">${ps.universalMechanics.map(m => `<li>${escHtml(m)}</li>`).join('')}</ul>` : ''}
        ${(ps.universalLimits||[]).length ? `
          <div class="wt-ps-limits-label">通用上限：</div>
          <ul class="wt-ps-list wt-ps-limits">${ps.universalLimits.map(l => `<li>${escHtml(l)}</li>`).join('')}</ul>` : ''}
      </div>`).join('');
    return `<div class="wt-section"><h3 class="wt-section-title">⚡ 力量体系 <span class="wt-rule-count">${wd.powerSystems.length} 个</span></h3><div class="wt-ps-list-wrap">${items}</div></div>`;
  }
  // Legacy fallback: single powerSystem string
  if (wd.powerSystem) {
    return `<div class="wt-section"><h3 class="wt-section-title">⚡ 力量体系</h3><div class="wt-power-text">${escHtml(wd.powerSystem)}</div></div>`;
  }
  return '';
}

function buildArchiveDetailSection(wd, item, isModal) {
  const rules = wd.worldRules || [];
  const factions = wd.keyFactions || [];

  const rulesHtml = rules.length
    ? rules.map((r, i) => `
      <div class="wt-rule-item">
        <span class="wt-rule-num">${i + 1}</span>
        <span class="wt-rule-text">${escHtml(r)}</span>
      </div>`).join('')
    : '<p class="muted">暂无世界法则</p>';

  const factionsHtml = factions.length
    ? factions.map(f => `
      <div class="wt-faction">
        <div class="wt-faction-name">
          ${escHtml(f.name)}
          <span class="wt-faction-attitude wt-att-${f.attitude || 'unknown'}">${
            { hostile: '敌对', neutral: '中立', friendly: '友好', unknown: '未知' }[f.attitude] || f.attitude || '未知'
          }</span>
        </div>
        <div class="wt-faction-desc">${escHtml(f.description || '')}</div>
        ${f.power ? `<div class="wt-faction-power">实力：${escHtml(f.power)}</div>` : ''}
      </div>`).join('')
    : '';

  const sessionOpts = state.sessions.map(s =>
    `<option value="${s.id}"${s.id === $('sessionSelect').value ? ' selected' : ''}>${escHtml(s.name)}</option>`
  ).join('');

  const wi = wd.worldIdentity || null;
  const worldIdentityHtml = wi ? (() => {
    const memories = (wi.coreMemories || []).filter(Boolean);
    const connections = (wi.socialConnections || []).filter(c => c && c.name);
    return `<div class="wt-section wt-identity-section">
      <h3 class="wt-section-title">🪪 在地身份</h3>
      <div class="wt-identity-card">
        <div class="wt-identity-header">
          <span class="wt-identity-name">${escHtml(wi.name || '（保留原名）')}</span>
          ${wi.title ? `<span class="wt-identity-title">${escHtml(wi.title)}</span>` : ''}
        </div>
        ${wi.occupation ? `<div class="wt-identity-occupation">职业 / 定位：${escHtml(wi.occupation)}</div>` : ''}
        ${wi.background ? `<div class="wt-identity-bg">${escHtml(wi.background)}</div>` : ''}
        ${memories.length ? `<div class="wt-identity-memories">
          <div class="wt-identity-sub-label">核心记忆</div>
          <ul class="wt-identity-memory-list">${memories.map(m => `<li>${escHtml(m)}</li>`).join('')}</ul>
        </div>` : ''}
        ${connections.length ? `<div class="wt-identity-connections">
          <div class="wt-identity-sub-label">社会关系</div>
          <div class="wt-identity-conn-list">${connections.map(c =>
            `<span class="wt-conn-chip"><span class="wt-conn-name">${escHtml(c.name)}</span><span class="wt-conn-rel">${escHtml(c.relation || '')}</span>${c.note ? `<span class="wt-conn-note">${escHtml(c.note)}</span>` : ''}</span>`
          ).join('')}</div>
        </div>` : ''}
      </div>
    </div>`;
  })() : '';

  // Build timeline section
  const timelineEvents = wd.timeline || [];
  const timelineHtml = timelineEvents.length ? `
  <div class="wt-section wt-timeline-section">
    <h3 class="wt-section-title">📅 大事年表 <span class="wt-rule-count">${timelineEvents.length} 条</span></h3>
    <div class="wt-timeline-list">
      ${timelineEvents.map((ev, i) => `
        <div class="wt-tl-item">
          <div class="wt-tl-node">
            <span class="wt-tl-dot"></span>
            ${i < timelineEvents.length - 1 ? '<span class="wt-tl-line"></span>' : ''}
          </div>
          <div class="wt-tl-content">
            <div class="wt-tl-header">
              <span class="wt-tl-time">${escHtml(ev.time || '?')}</span>
              <span class="wt-tl-event">${escHtml(ev.event || '')}</span>
            </div>
            ${ev.impact ? `<div class="wt-tl-impact">${escHtml(ev.impact)}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>
  </div>` : '';

  return `<div class="detail-worldtraverse">
  <div class="wt-header">
    <div class="wt-icon">🌐</div>
    <div class="wt-title-block">
      <h1 class="wt-world-name">${escHtml(wd.displayName || item?.name || '')}</h1>
      <div class="wt-meta-row">
        <span class="wt-tag">${escHtml(wd.universe || '未知宇宙')}</span>
        <span class="wt-tag">${escHtml(wd.timePeriod || '?')}</span>
        ${wd.tierRange ? `<span class="wt-tag wt-tier-tag">${wd.tierRange}</span>` : ''}
      </div>
    </div>
  </div>
  <div class="wt-section">
    <h3 class="wt-section-title">📍 坐标信息</h3>
    <div class="wt-entry-grid">
      <div class="wt-entry-row"><span class="wt-entry-label">建议入场时机</span><span class="wt-entry-val">${escHtml(wd.recommendedEntry || '未指定')}</span></div>
      <div class="wt-entry-row"><span class="wt-entry-label">初始地点</span><span class="wt-entry-val">${escHtml(wd.initialLocation || '未指定')}</span></div>
      ${wd.tierReason ? `<div class="wt-entry-row"><span class="wt-entry-label">定级依据</span><span class="wt-entry-val">${escHtml(wd.tierReason)}</span></div>` : ''}
    </div>
  </div>
  ${timelineHtml}
  ${worldIdentityHtml}
  ${buildPowerSystemsHtml(wd)}
  <div class="wt-section">
    <h3 class="wt-section-title">📜 世界法则 <span class="wt-rule-count">${rules.length} 条</span></h3>
    <div class="wt-rules-list">${rulesHtml}</div>
  </div>
  ${factions.length ? `<div class="wt-section"><h3 class="wt-section-title">🏛 关键势力</h3><div class="wt-factions-list">${factionsHtml}</div></div>` : ''}
  ${item ? `<div class="detail-actions">
    <div class="redeem-session-row"><label>穿越到存档：</label>
      <select class="shop-select modal-sess-sel"><option value="">— 选择存档 —</option>${sessionOpts}</select>
    </div>
    <button class="btn btn-success modal-redeem-btn" style="background:#3a7a5a">🌐 执行穿越 — 写入武库</button>
    <button class="btn btn-danger modal-delete-btn">删除坐标</button>
  </div>` : ''}
</div>`;
}

function closeModal() {
  $('detailModal').style.display = 'none';
  $('modalContent').innerHTML = '';
}

// ── Utilities ─────────────────────────────────────────────────────────────────
async function confirmRisk({ title, message, confirmText }) {
  if (window.UIFeedback) {
    return window.UIFeedback.confirmDanger({
      title: title || '确认操作',
      message: message || '是否继续？',
      confirmText: confirmText || '确认',
    });
  }
  return confirm(message || '是否继续？');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer;
function toast(msg, isError = false) {
  if (window.UIFeedback) {
    window.UIFeedback.toast(msg, { type: isError ? 'error' : 'success', duration: 3200 });
    return;
  }
  const existing = document.querySelector('.shop-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'shop-toast' + (isError ? ' error' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3500);
}

// ─── Gacha Module ─────────────────────────────────────────────────────────────

const gachaState = {
  selectedPoolId: null,
  pools:          [],
  drawing:        false,
};

// ── Tab switching ──────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.shop-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shop-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      $('shopMainItems').style.display = tab === 'items' ? '' : 'none';
      $('shopMainGacha').style.display = tab === 'gacha' ? ''  : 'none';
      if (tab === 'gacha') {
        loadGachaPools();
        loadGachaPending();
      }
    });
  });
}

// ── Pool Loading ───────────────────────────────────────────────────────────────
async function loadGachaPools() {
  const sessionId = $('sessionSelect')?.value;
  if (!sessionId) {
    $('gachaPoolGrid').innerHTML = '<div class="gacha-no-session">请先在右上角选择存档</div>';
    $('gachaControls').style.display = 'none';
    return;
  }

  try {
    const data = await fetch(`/api/sessions/${sessionId}/gacha/pools`).then(r => r.json());
    if (data.error) throw new Error(data.error);

    gachaState.pools = data.pools || [];

    // Update balance display
    $('gachaBalPoints').textContent = (data.points ?? 0).toLocaleString();
    const medalMap = data.medals || {};
    const medalEntries = Object.entries(medalMap)
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => `${k}★×${v}`);
    $('gachaMedalList').textContent = medalEntries.length ? '徽章：' + medalEntries.join(' ') : '';

    renderGachaPoolGrid(gachaState.pools);
    updateGachaControls();
    updateGachaPendingBadge();
  } catch (err) {
    $('gachaPoolGrid').innerHTML = `<div class="gacha-no-session">加载失败：${escHtml(err.message)}</div>`;
  }
}

// ── Pool Grid Renderer ─────────────────────────────────────────────────────────
function renderGachaPoolGrid(pools) {
  const grid = $('gachaPoolGrid');
  if (!pools.length) { grid.innerHTML = '<div class="gacha-loading">暂无池子数据</div>'; return; }

  grid.innerHTML = pools.map(pool => {
    const isSelected = gachaState.selectedPoolId === pool.id;
    const pityPct    = Math.min(100, Math.round((pool.pityProgress / pool.pityHard) * 100));
    const costPts    = pool.costPoints > 0
      ? `<span class="gacha-cost-pts">${pool.costPoints.toLocaleString()} 积分</span>` : '';
    const costMedals = (pool.costMedals || [])
      .map(m => `<span class="gacha-cost-medal">${m.stars}★徽章×${m.count}</span>`)
      .join('');
    return `
<div class="gacha-pool-card${isSelected ? ' selected' : ''}" data-pool-id="${pool.id}">
  <div class="gacha-pool-header">
    <span class="gacha-pool-name">${escHtml(pool.name)}</span>
    <span class="gacha-pool-label">${escHtml(pool.label)}</span>
  </div>
  <div class="gacha-pool-cost">${costPts}${costMedals}</div>
  <div class="gacha-pool-meta">
    <span class="gacha-pool-count">库存：${pool.itemCount} 件</span>
    <span class="gacha-pool-pity">${pool.pityProgress}/${pool.pityHard} 抽保底</span>
  </div>
  <div class="gacha-pity-bar"><div class="gacha-pity-fill" style="width:${pityPct}%"></div></div>
</div>`;
  }).join('');

  grid.querySelectorAll('.gacha-pool-card').forEach(card => {
    card.addEventListener('click', () => {
      gachaState.selectedPoolId = card.dataset.poolId;
      renderGachaPoolGrid(gachaState.pools);
      updateGachaControls();
    });
  });
}

// ── Controls Update ────────────────────────────────────────────────────────────
function updateGachaControls() {
  const pool = gachaState.pools.find(p => p.id === gachaState.selectedPoolId);
  const ctrl = $('gachaControls');
  if (!pool) { ctrl.style.display = 'none'; return; }
  ctrl.style.display = '';

  $('gachaSelectedLabel').textContent = `已选：${pool.name}（${pool.label}）`;

  const ten10Pts   = pool.costPoints * 10 * (pool.id === 'low' ? 0.9 : 1);
  const tenMedals  = (pool.costMedals || []).map(m => `${m.stars}★徽章×${m.count * 10}`).join(' + ');
  const cost1Pts   = pool.costPoints;
  const cost1Medal = (pool.costMedals || []).map(m => `${m.stars}★徽章×${m.count}`).join(' + ');

  const fmtCost = (pts, medal) => [
    pts > 0 ? `${Math.floor(pts).toLocaleString()} 积分` : '',
    medal || '',
  ].filter(Boolean).join(' + ');

  $('gachaCostInfo').innerHTML =
    `单抽：${fmtCost(cost1Pts, cost1Medal)} &nbsp;|&nbsp; 十连：${fmtCost(ten10Pts, tenMedals)}` +
    (pool.id === 'low' ? ' <span class="gacha-discount">（9折）</span>' : '');

  $('btnGachaDraw1').textContent  = `单抽 ×1`;
  $('btnGachaDraw10').textContent = `十连 ×10`;
}

// ── Draw ───────────────────────────────────────────────────────────────────────
async function executeDraw(count) {
  if (gachaState.drawing) return;
  const sessionId = $('sessionSelect')?.value;
  if (!sessionId) { toast('请先选择存档', true); return; }
  if (!gachaState.selectedPoolId) { toast('请先选择池子', true); return; }

  gachaState.drawing = true;
  $('btnGachaDraw1').disabled = true;
  $('btnGachaDraw10').disabled = true;
  $('gachaStatus').style.display = '';
  $('gachaStatusText').textContent = 'LLM 补充生成10件新物品中…';
  $('gachaResults').style.display = 'none';

  try {
    const resp = await fetch(`/api/sessions/${sessionId}/gacha/draw`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ poolId: gachaState.selectedPoolId, count }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '抽卡失败');

    $('gachaStatusText').textContent = '抽取结果出炉！';
    await new Promise(r => setTimeout(r, 400));

    renderGachaResults(data.results || []);
    await loadGachaPools();  // Refresh pool counts and balance
    loadGachaPending();
  } catch (err) {
    toast(err.message, true);
  } finally {
    gachaState.drawing = false;
    $('gachaStatus').style.display = 'none';
    $('btnGachaDraw1').disabled  = false;
    $('btnGachaDraw10').disabled = false;
  }
}

// ── Result Renderer ────────────────────────────────────────────────────────────
const TIER_COLORS = {
  0: '#888', 1: '#aaa', 2: '#7cc',
  3: '#7be', 4: '#8acf', 5: '#bada55',
  6: '#e8c87a', 7: '#f4a460', 8: '#e07070',
  9: '#c890e8', 10: '#7ab8e8', 11: '#40e0d0',
  12: '#ff69b4', 13: '#ff4500', 14: '#ffd700',
  15: '#e040fb', 16: '#ffffff',
};

function renderGachaResults(results) {
  const list = $('gachaResultList');
  list.innerHTML = '';
  $('gachaResults').style.display = '';

  results.forEach((r, i) => {
    const tier  = r.tier ?? r.item?.tier ?? '?';
    const color = TIER_COLORS[tier] || '#aaa';
    const card  = document.createElement('div');
    card.className = `gacha-result-card${r.refunded ? ' refunded' : ''} tier-${tier}`;
    card.style.setProperty('--tier-color', color);
    card.style.animationDelay = `${i * 80}ms`;

    const typeMap = {
      PassiveAbility: '被动', PowerSource: '基盘', ApplicationTechnique: '技法',
      Inventory: '物品', Knowledge: '知识', WorldTraverse: '锚点',
      Companion: '同伴', Mech: '机体',
    };
    const typeLabel = typeMap[r.item?.type] || r.item?.type || '?';

    card.innerHTML = `
<div class="grc-tier">${tier}★</div>
<div class="grc-body">
  <div class="grc-type">${escHtml(typeLabel)}</div>
  <div class="grc-name">${escHtml(r.item?.name || '?')}</div>
  <div class="grc-desc">${escHtml((r.item?.description || '').slice(0, 80))}${(r.item?.description || '').length > 80 ? '…' : ''}</div>
  ${r.refunded ? '<div class="grc-refund">⚠ 已持有，费用已返还</div>' : ''}
</div>
${!r.refunded ? `<button class="btn btn-sm grc-use-btn" data-pending-id="${escHtml(r.pendingId)}">使用</button>` : ''}`;

    if (!r.refunded) {
      card.querySelector('.grc-use-btn').addEventListener('click', () => applyGachaPending(r.pendingId, card));
    }
    list.appendChild(card);
  });
}

// ── Pending Items ──────────────────────────────────────────────────────────────
async function loadGachaPending() {
  const sessionId = $('sessionSelect')?.value;
  if (!sessionId) return;

  try {
    const sess = await fetch(`/api/sessions/${sessionId}`).then(r => r.json());
    const pending = sess?.statData?.Arsenal?.GachaPending || [];
    renderGachaPendingList(pending);
  } catch (_) {}
}

function updateGachaPendingBadge() {
  const sessionId = $('sessionSelect')?.value;
  if (!sessionId) return;
  fetch(`/api/sessions/${sessionId}`)
    .then(r => r.json())
    .then(sess => {
      const n = (sess?.statData?.Arsenal?.GachaPending || []).length;
      $('gachaPendingCount').textContent = n;
      $('gachaPendingSection').style.display = n > 0 ? '' : 'none';
    })
    .catch(() => {});
}

function renderGachaPendingList(pending) {
  const section = $('gachaPendingSection');
  const list    = $('gachaPendingList');
  $('gachaPendingCount').textContent = pending.length;
  section.style.display = pending.length > 0 ? '' : 'none';
  if (!pending.length) { list.innerHTML = ''; return; }

  list.innerHTML = pending.map(p => {
    const item  = p.item || {};
    const tier  = item.tier ?? '?';
    const color = TIER_COLORS[tier] || '#aaa';
    return `
<div class="gacha-pending-card" data-pending-id="${escHtml(p.pendingId)}" style="--tier-color:${color}">
  <div class="gpc-tier">${tier}★</div>
  <div class="gpc-body">
    <div class="gpc-name">${escHtml(item.name || '?')}</div>
    <div class="gpc-pool">来自：${escHtml(p.poolId || '?')}</div>
    <div class="gpc-desc">${escHtml((item.description || '').slice(0, 60))}${(item.description || '').length > 60 ? '…' : ''}</div>
  </div>
  <div class="gpc-actions">
    <button class="btn btn-success btn-sm gpc-use-btn" data-pending-id="${escHtml(p.pendingId)}">使用</button>
    <button class="btn btn-danger btn-sm gpc-discard-btn" data-pending-id="${escHtml(p.pendingId)}">丢弃</button>
  </div>
</div>`;
  }).join('');

  list.querySelectorAll('.gpc-use-btn').forEach(btn => {
    btn.addEventListener('click', () => applyGachaPending(btn.dataset.pendingId));
  });
  list.querySelectorAll('.gpc-discard-btn').forEach(btn => {
    btn.addEventListener('click', () => discardGachaPending(btn.dataset.pendingId));
  });
}

async function applyGachaPending(pendingId, resultCard) {
  const sessionId = $('sessionSelect')?.value;
  if (!sessionId) { toast('请先选择存档', true); return; }

  const btn = resultCard
    ? resultCard.querySelector('.grc-use-btn')
    : $('gachaPendingList')?.querySelector(`[data-pending-id="${pendingId}"] .gpc-use-btn`);
  if (btn) { btn.disabled = true; btn.textContent = '应用中…'; }

  try {
    const resp = await fetch(`/api/sessions/${sessionId}/gacha/pending/${pendingId}/apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '应用失败');

    toast(`✓ ${data.item?.name} 已应用到存档`);

    // Insert prefill if on game page redirect — just show a toast
    if (resultCard) resultCard.classList.add('applied');
    loadGachaPending();
  } catch (err) {
    toast(err.message, true);
    if (btn) { btn.disabled = false; btn.textContent = '使用'; }
  }
}

async function discardGachaPending(pendingId) {
  const sessionId = $('sessionSelect')?.value;
  if (!sessionId) return;

  if (!await confirmRisk({
    title: '丢弃待领取物品',
    message: '确定丢弃这件待领取物品？\n丢弃后将退还一次单抽费用。',
    confirmText: '确认丢弃',
  })) return;

  try {
    const resp = await fetch(`/api/sessions/${sessionId}/gacha/pending/${pendingId}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || '丢弃失败');
    toast(data.refund ? `已丢弃，已退还 ${data.refund}` : '已丢弃');
    loadGachaPending();
    loadGachaPools(); // refresh balance display
  } catch (err) {
    toast(err.message, true);
  }
}

// ── Gacha Event Bindings ───────────────────────────────────────────────────────
function bindGachaEvents() {
  $('btnGachaDraw1')?.addEventListener('click',  () => executeDraw(1));
  $('btnGachaDraw10')?.addEventListener('click', () => executeDraw(10));
  $('btnGachaClearResults')?.addEventListener('click', () => {
    $('gachaResults').style.display = 'none';
    $('gachaResultList').innerHTML = '';
  });
}

// ── Start ──────────────────────────────────────────────────────────────────────
init();
