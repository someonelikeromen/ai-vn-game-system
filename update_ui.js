const fs = require('fs');
let css = fs.readFileSync('public/shop.css', 'utf-8');

// 1. Inject modern CSS variables
const vars = `
:root {
  --shop-transition: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  --bg-base: #07080f;
  --bg-panel: rgba(20, 22, 30, 0.6);
  --bg-panel-hover: rgba(26, 30, 42, 0.8);
  --border-light: rgba(100, 150, 255, 0.12);
  --border-focus: rgba(100, 150, 255, 0.3);
  --text-main: #e2e8f0;
  --text-muted: #8b9bb4;
  --accent-primary: #00e5ff;
  --accent-secondary: #b480ff;
  --shadow-panel: 0 8px 32px rgba(0, 0, 0, 0.4);
  --shadow-glow: 0 0 20px rgba(0, 229, 255, 0.15);
  --radius-lg: 16px;
  --radius-md: 10px;
  --radius-sm: 6px;
}
html.theme-light {
  --bg-base: #f0f4f8;
  --bg-panel: rgba(255, 255, 255, 0.8);
  --bg-panel-hover: rgba(255, 255, 255, 1);
  --border-light: rgba(0, 50, 150, 0.1);
  --border-focus: rgba(0, 80, 200, 0.3);
  --text-main: #1a202c;
  --text-muted: #4a5568;
  --accent-primary: #0070f3;
  --accent-secondary: #805ad5;
  --shadow-panel: 0 8px 30px rgba(0, 0, 0, 0.05);
  --shadow-glow: 0 0 20px rgba(0, 112, 243, 0.15);
}
`;

css = css.replace(/:root\s*\{[^}]*--shop-transition[^}]*\}/, vars);

// 2. Update Body & Base Layout
css = css.replace(/body\s*\{[^}]*\}/, `body {
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  font-size: 1rem;
  background: var(--bg-base);
  color: var(--text-main);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  margin: 0;
  overflow: hidden;
}`);

// 3. Update Header
css = css.replace(/\.shop-header\s*\{[^}]*\}/, `.shop-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--bg-panel);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border-light);
  z-index: 100;
  flex-shrink: 0;
}`);

// 4. Update Tabs
css = css.replace(/\.shop-tab-nav\s*\{[^}]*\}/, `.shop-tab-nav {
  display: flex;
  gap: 8px;
  padding: 12px 24px;
  background: transparent;
  border-bottom: 1px solid var(--border-light);
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}`);
css = css.replace(/\.shop-tab-btn\s*\{[^}]*\}/, `.shop-tab-btn {
  padding: 10px 24px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: 99px;
  color: var(--text-muted);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: var(--shop-transition);
  white-space: nowrap;
  backdrop-filter: blur(8px);
}`);
css = css.replace(/\.shop-tab-btn:hover\s*\{[^}]*\}/, `.shop-tab-btn:hover {
  color: var(--text-main);
  background: var(--bg-panel-hover);
  border-color: var(--border-focus);
  transform: translateY(-1px);
}`);
css = css.replace(/\.shop-tab-btn\.active\s*\{[^}]*\}/, `.shop-tab-btn.active {
  color: #fff;
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  box-shadow: var(--shadow-glow);
  font-weight: 600;
}`);

// 5. Update Layout & Main
css = css.replace(/\.shop-layout\s*\{[^}]*\}/, `.shop-layout {
  display: flex;
  flex-direction: row;
  flex: 1;
  overflow: hidden;
  min-height: 0;
  position: relative;
}`);
css = css.replace(/\.shop-main\s*\{[^}]*\}/, `.shop-main {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 24px;
  scroll-behavior: smooth;
}`);

// 6. Update Gen Tab Layout
css = css.replace(/\.gen-tab-layout\s*\{[^}]*\}/, `.gen-tab-layout {
  display: flex;
  flex-direction: row;
  gap: 32px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
  align-items: flex-start;
}`);
css = css.replace(/\.gen-tab-input-col\s*\{[^}]*\}/, `.gen-tab-input-col {
  width: 380px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(12px);
  position: sticky;
  top: 0;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
}`);
css = css.replace(/\.gen-tab-preview-col\s*\{[^}]*\}/, `.gen-tab-preview-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
}`);
css = css.replace(/\.gen-preview-empty\s*\{[^}]*\}/, `.gen-preview-empty {
  text-align: center;
  padding: 60px 24px;
  color: var(--text-muted);
  border: 2px dashed var(--border-light);
  border-radius: var(--radius-lg);
  background: rgba(0,0,0,0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  transition: var(--shop-transition);
}`);

// 7. Update Filter Bar
css = css.replace(/\.items-filter-bar\s*\{[^}]*\}/, `.items-filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 20px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  margin-bottom: 8px;
  backdrop-filter: blur(8px);
  box-shadow: var(--shadow-panel);
}`);

// 8. Update Items Grid
css = css.replace(/\.items-grid\s*\{[^}]*\}/, `.items-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
  align-content: start;
}`);

// 9. Update Item Cards
css = css.replace(/\.item-card\s*\{[^}]*\}/, `.item-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  border-left-width: 4px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: var(--shop-transition);
  position: relative;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}`);
css = css.replace(/\.item-card:hover\s*\{[^}]*\}/, `.item-card:hover {
  transform: translateY(-4px);
  background: var(--bg-panel-hover);
  box-shadow: 0 12px 24px rgba(0,0,0,0.4);
}`);

// 10. Update Gacha Layout
css = css.replace(/\.gacha-main\s*\{[^}]*\}/, `.gacha-main {
  padding: 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 32px;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}`);

fs.writeFileSync('public/shop.css', css);
console.log('UI updated successfully!');
