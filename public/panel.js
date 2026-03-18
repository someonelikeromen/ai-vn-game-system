/**
 * panel.js — 公共浮动面板管理模块
 * 为浮动面板提供拖拽、缩放（resize）以及位置/尺寸持久化能力。
 *
 * 使用方法:
 *   PanelManager.make(element, options)
 *
 * options:
 *   storageKey  {string}  localStorage 键名前缀，用于持久化位置和尺寸
 *   handleSel   {string}  拖拽手柄的 CSS 选择器（相对于 element），默认 '.panel-handle'
 *   resizable   {boolean} 是否启用 resize 手柄，默认 true
 *   minWidth    {number}  最小宽度（px），默认 280
 *   minHeight   {number}  最小高度（px），默认 180
 *   onMove      {fn}      位置/尺寸变化回调
 */
(function () {
  const STORAGE_PREFIX = 'panel:';

  function saveState(key, state) {
    try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state)); } catch (_) {}
  }

  function loadState(key) {
    try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + key) || 'null'); } catch (_) { return null; }
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  /**
   * 让一个面板可拖拽 + 可 resize，并持久化其位置/尺寸。
   * @param {HTMLElement} el
   * @param {object} opts
   */
  function make(el, opts) {
    opts = Object.assign({
      storageKey: null,
      handleSel:  null,
      resizable:  true,
      minWidth:   280,
      minHeight:  180,
      onMove:     null,
    }, opts);

    // ── Restore saved state ───────────────────────────────────────────────────
    if (opts.storageKey) {
      const saved = loadState(opts.storageKey);
      if (saved) {
        // 确保保存的位置仍在视口内
        const vw = window.innerWidth, vh = window.innerHeight;
        const w  = saved.width  || 340;
        const h  = saved.height || 300;
        const left = clamp(saved.left, 0, vw - Math.min(w, vw));
        const top  = clamp(saved.top,  0, vh - Math.min(h, vh));
        el.style.left   = left + 'px';
        el.style.top    = top  + 'px';
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
        if (saved.width)  el.style.width  = saved.width  + 'px';
        if (saved.height) el.style.height = saved.height + 'px';
      }
    }

    // ── Drag ──────────────────────────────────────────────────────────────────
    const handle = opts.handleSel ? el.querySelector(opts.handleSel) : el;
    if (handle) {
      let dragging = false, startX, startY, origLeft, origTop;

      function startDrag(clientX, clientY, target) {
        // Skip if clicking a button (but NOT the drag-hint icon)
        if (!target.classList.contains('sf-drag-hint') &&
            target !== handle &&
            target.closest('button,select,input,a')) return false;
        // Skip if clicking a resize handle
        if (target.classList.contains('panel-resize-handle')) return false;

        dragging = true;
        startX = clientX;
        startY = clientY;
        const rect = el.getBoundingClientRect();
        origLeft = rect.left;
        origTop  = rect.top;
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
        el.style.left   = origLeft + 'px';
        el.style.top    = origTop  + 'px';
        el.style.transition = 'none'; // 拖动时关闭过渡
        document.body.style.userSelect = 'none';
        handle.style.cursor = 'grabbing';
        return true;
      }

      function moveDrag(clientX, clientY) {
        if (!dragging) return;
        const vw = window.innerWidth, vh = window.innerHeight;
        const w  = el.offsetWidth,    h  = el.offsetHeight;
        const newLeft = clamp(origLeft + (clientX - startX), 0, vw - w);
        const newTop  = clamp(origTop  + (clientY - startY), 0, vh - h);
        el.style.left = newLeft + 'px';
        el.style.top  = newTop  + 'px';
        _persist(el, opts);
      }

      function endDrag() {
        if (dragging) {
          dragging = false;
          el.style.transition = '';
          document.body.style.userSelect = '';
          handle.style.cursor = '';
          _persist(el, opts);
        }
      }

      // Mouse events
      handle.addEventListener('mousedown', (e) => {
        if (startDrag(e.clientX, e.clientY, e.target)) {
          e.preventDefault();
        }
      });
      document.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
      document.addEventListener('mouseup',   endDrag);

      // Touch events (移动端支持)
      handle.addEventListener('touchstart', (e) => {
        const t = e.touches[0];
        if (startDrag(t.clientX, t.clientY, e.target)) {
          e.preventDefault();
        }
      }, { passive: false });
      document.addEventListener('touchmove', (e) => {
        const t = e.touches[0];
        moveDrag(t.clientX, t.clientY);
      }, { passive: true });
      document.addEventListener('touchend', endDrag);
    }

    // ── Resize ────────────────────────────────────────────────────────────────
    if (opts.resizable) {
      _addResizeHandles(el, opts);
    }
  }

  function _persist(el, opts) {
    if (!opts.storageKey) return;
    const state = {
      left:   Math.round(parseFloat(el.style.left) || 0),
      top:    Math.round(parseFloat(el.style.top)  || 0),
      width:  Math.round(el.offsetWidth),
      height: Math.round(el.offsetHeight),
    };
    saveState(opts.storageKey, state);
    if (opts.onMove) opts.onMove(state);
  }

  function _addResizeHandles(el, opts) {
    // Ensure el is positioned
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';

    const edges = [
      { cls: 'panel-resize-handle panel-resize-e',  dir: 'e'  },
      { cls: 'panel-resize-handle panel-resize-s',  dir: 's'  },
      { cls: 'panel-resize-handle panel-resize-se', dir: 'se' },
    ];

    edges.forEach(({ cls, dir }) => {
      const rh = document.createElement('div');
      rh.className = cls;
      rh.dataset.dir = dir;
      el.appendChild(rh);

      let active = false;
      let startX, startY, startW, startH, startLeft, startTop;

      rh.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        active  = true;
        startX  = e.clientX;
        startY  = e.clientY;
        startW  = el.offsetWidth;
        startH  = el.offsetHeight;
        const rect = el.getBoundingClientRect();
        startLeft = rect.left;
        startTop  = rect.top;
        el.style.right  = 'auto';
        el.style.bottom = 'auto';
        el.style.left   = startLeft + 'px';
        el.style.top    = startTop  + 'px';
        el.style.transition = 'none';
        document.body.style.userSelect = 'none';
        document.body.style.cursor = _cursor(dir);
      });

      document.addEventListener('mousemove', (e) => {
        if (!active) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (dir === 'e' || dir === 'se') {
          el.style.width = Math.max(opts.minWidth, startW + dx) + 'px';
        }
        if (dir === 's' || dir === 'se') {
          el.style.height = Math.max(opts.minHeight, startH + dy) + 'px';
        }
        _persist(el, opts);
      });

      document.addEventListener('mouseup', () => {
        if (active) {
          active = false;
          el.style.transition = '';
          document.body.style.userSelect = '';
          document.body.style.cursor = '';
          _persist(el, opts);
        }
      });
    });
  }

  function _cursor(dir) {
    return { e: 'ew-resize', s: 'ns-resize', se: 'nwse-resize' }[dir] || 'default';
  }

  /**
   * 最小化面板到仅显示标题栏状态。
   * 需要面板有 .panel-body 子元素，或通过 bodyEl 参数指定。
   */
  function minimize(el, bodyEl) {
    const body = bodyEl || el.querySelector('.panel-body, .stat-float-body, .panel-content');
    if (!body) return;
    el.dataset.minimized = '1';
    el.dataset.savedHeight = el.style.height || el.offsetHeight;
    body.style.display = 'none';
    el.style.height = 'auto';
    if (el.style.resize) el.dataset.savedResize = el.style.resize;
    el.style.resize = 'none';
  }

  function restore(el, bodyEl) {
    const body = bodyEl || el.querySelector('.panel-body, .stat-float-body, .panel-content');
    if (!body) return;
    delete el.dataset.minimized;
    body.style.display = '';
    if (el.dataset.savedHeight) el.style.height = el.dataset.savedHeight + 'px';
    if (el.dataset.savedResize) el.style.resize = el.dataset.savedResize;
    delete el.dataset.savedHeight;
    delete el.dataset.savedResize;
  }

  function isMinimized(el) { return el.dataset.minimized === '1'; }

  // Expose globally
  window.PanelManager = { make, minimize, restore, isMinimized };
})();
