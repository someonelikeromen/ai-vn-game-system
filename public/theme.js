/**
 * theme.js — 公共主题/字体管理模块
 * 在所有页面的 <head> 最前面引入，立即执行以避免闪烁。
 *
 * localStorage 键:
 *   uiTheme    : 'purple' | 'blue' | 'green' | 'oled'  (默认 'purple')
 *   uiFontSize : 'sm' | 'md' | 'lg' | 'xl'             (默认 'md')
 */
(function () {
  const VALID_THEMES    = ['purple', 'blue', 'green', 'oled'];
  const VALID_FONTSIZES = ['sm', 'md', 'lg', 'xl'];
  const THEME_CLASSES   = VALID_THEMES.map(t => 'theme-' + t);
  const FONT_CLASSES    = VALID_FONTSIZES.map(s => 'font-' + s);

  function _get(key, valid, def) {
    try {
      const v = localStorage.getItem(key);
      return valid.includes(v) ? v : def;
    } catch (_) { return def; }
  }

  function applyTheme(theme, fontSize) {
    const root = document.documentElement;
    // Remove old classes
    root.classList.remove(...THEME_CLASSES, ...FONT_CLASSES);
    const t = VALID_THEMES.includes(theme) ? theme : 'purple';
    const f = VALID_FONTSIZES.includes(fontSize) ? fontSize : 'md';
    // Purple is the default (:root) — only add class for non-default or to enable switching
    root.classList.add('theme-' + t);
    root.classList.add('font-' + f);
    try {
      localStorage.setItem('uiTheme', t);
      localStorage.setItem('uiFontSize', f);
    } catch (_) {}
  }

  function getTheme()    { return _get('uiTheme',    VALID_THEMES,    'purple'); }
  function getFontSize() { return _get('uiFontSize', VALID_FONTSIZES, 'md'); }

  // Apply immediately (before DOM ready) to prevent FOUC
  applyTheme(getTheme(), getFontSize());

  // Expose globally
  window.UITheme = { applyTheme, getTheme, getFontSize };
})();
