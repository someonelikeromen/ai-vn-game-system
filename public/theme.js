/**
 * theme.js — 公共主题/字体管理模块
 * 在所有页面的 <head> 最前面引入，立即执行以避免闪烁。
 *
 * localStorage 键:
 *   uiTheme      : 'purple' | 'blue' | 'green' | 'oled'  (默认 'purple')
 *   uiFontPx     : 数字字符串，如 "14"   (默认 14)  — 界面 UI 字体大小(px)
 *   chatFontPx   : 数字字符串，如 "14"   (默认 14)  — 聊天内容字体大小(px)
 *   statFontPx   : 数字字符串，如 "11"   (默认 11)  — 状态面板字体大小(px)
 *
 * 旧版 enum 键（xs/sm/md/lg/xl）会自动迁移到 px 值。
 */
(function () {
  const VALID_THEMES = ['purple', 'blue', 'green', 'oled'];
  const THEME_CLASSES = VALID_THEMES.map(t => 'theme-' + t);

  // 字体范围约束
  const FONT_MIN = 8;
  const FONT_MAX = 38;

  // 旧版 enum 到 px 的迁移映射
  const LEGACY_UI_MAP   = { xs: 10, sm: 12, md: 14, lg: 16, xl: 18 };
  const LEGACY_CHAT_MAP = { xs: 11, sm: 13, md: 14, lg: 16, xl: 18 };
  const LEGACY_STAT_MAP = { xs:  9, sm: 11, md: 12, lg: 14, xl: 16 };

  function _clamp(v) {
    return Math.max(FONT_MIN, Math.min(FONT_MAX, v));
  }

  function _get(key, def) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function _set(key, val) {
    try { localStorage.setItem(key, String(val)); } catch (_) {}
  }

  /**
   * 从 localStorage 读取某个字体键，支持旧版 enum 值自动迁移。
   * @param {string} key         新版 px 键名 (e.g. 'uiFontPx')
   * @param {string} legacyKey   旧版 enum 键名 (e.g. 'uiFontSize')
   * @param {object} legacyMap   旧版 enum -> px 映射
   * @param {number} def         默认 px 值
   */
  function _readFontPx(key, legacyKey, legacyMap, def) {
    const raw = _get(key);
    if (raw !== null) {
      const v = parseInt(raw, 10);
      if (!isNaN(v)) return _clamp(v);
    }
    // Try migrating from legacy enum key
    const legacy = _get(legacyKey);
    if (legacy !== null && legacyMap[legacy]) {
      const migrated = legacyMap[legacy];
      _set(key, migrated);
      return migrated;
    }
    return def;
  }

  /**
   * 将字体大小直接写入 html 元素的 inline style（setProperty）。
   * 内联样式优先级高于任何外部 stylesheet，不会被 style.css 的 :root 默认值覆盖。
   */
  function _injectFontVars(uiPx, chatPx, statPx) {
    const root = document.documentElement;
    const smPx = Math.max(8, uiPx - 2);
    root.style.setProperty('--font-ui',   uiPx   + 'px');
    root.style.setProperty('--font-chat', chatPx + 'px');
    root.style.setProperty('--font-sm',   smPx   + 'px');
    root.style.setProperty('--font-stat', statPx + 'px');
  }

  function applyTheme(theme, uiPx, chatPx, statPx) {
    const root = document.documentElement;
    root.classList.remove(...THEME_CLASSES);
    const t  = VALID_THEMES.includes(theme) ? theme : 'purple';
    const uf = _clamp(parseInt(uiPx,   10) || 14);
    const cf = _clamp(parseInt(chatPx, 10) || 14);
    const sf = _clamp(parseInt(statPx, 10) || 11);

    root.classList.add('theme-' + t);
    _injectFontVars(uf, cf, sf);

    _set('uiTheme',    t);
    _set('uiFontPx',   uf);
    _set('chatFontPx', cf);
    _set('statFontPx', sf);
  }

  function getTheme()    { return (_get('uiTheme') || 'purple'); }
  function getFontPx()   { return _readFontPx('uiFontPx',   'uiFontSize',  LEGACY_UI_MAP,   14); }
  function getChatPx()   { return _readFontPx('chatFontPx', 'chatFontSize', LEGACY_CHAT_MAP, 14); }
  function getStatPx()   { return _readFontPx('statFontPx', 'statFontSize', LEGACY_STAT_MAP, 11); }

  // 兼容旧版接口（返回 enum 字符串）
  function getFontSize() {
    const px = getFontPx();
    if (px <= 10) return 'xs';
    if (px <= 12) return 'sm';
    if (px <= 14) return 'md';
    if (px <= 16) return 'lg';
    return 'xl';
  }
  function getChatFont() {
    const px = getChatPx();
    if (px <= 11) return 'xs';
    if (px <= 13) return 'sm';
    if (px <= 15) return 'md';
    if (px <= 17) return 'lg';
    return 'xl';
  }
  function getStatFont() {
    const px = getStatPx();
    if (px <=  9) return 'xs';
    if (px <= 11) return 'sm';
    if (px <= 12) return 'md';
    if (px <= 14) return 'lg';
    return 'xl';
  }

  // Apply immediately (before DOM ready) to prevent FOUC
  applyTheme(getTheme(), getFontPx(), getChatPx(), getStatPx());

  // Expose globally
  window.UITheme = {
    applyTheme,
    getTheme,
    getFontPx,
    getChatPx,
    getStatPx,
    // legacy aliases
    getFontSize,
    getChatFont,
    getStatFont,
    FONT_MIN,
    FONT_MAX,
    VALID_THEMES,
  };
})();
