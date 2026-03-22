'use strict';
/**
 * 清理脚本：移除之前错误预加载进 session 的 _preloaded: true BETA NPC 条目。
 * 运行：node scripts/patch-beta-npcs.js
 */
const fs   = require('fs');
const path = require('path');

const sessionsDir = path.join(__dirname, '..', 'data', 'sessions');
const files = fs.readdirSync(sessionsDir).filter(function(f){ return f.endsWith('.json'); });

let cleaned = 0;
for (const file of files) {
  const fPath = path.join(sessionsDir, file);
  const session = JSON.parse(fs.readFileSync(fPath, 'utf8'));
  const archives = session.statData && session.statData.Multiverse && session.statData.Multiverse.Archives || {};
  let modified = false;
  for (const worldKey of Object.keys(archives)) {
    const npcs = archives[worldKey].NPCs;
    if (!Array.isArray(npcs)) continue;
    const before = npcs.length;
    archives[worldKey].NPCs = npcs.filter(function(n){ return !n._preloaded; });
    const removed = before - archives[worldKey].NPCs.length;
    if (removed > 0) {
      console.log(file.slice(0,8), '| 世界:', worldKey, '| 移除预加载 NPC:', removed, '条');
      modified = true;
    }
  }
  if (modified) {
    fs.writeFileSync(fPath, JSON.stringify(session, null, 2), 'utf8');
    cleaned++;
  }
}
console.log('\n完成，共清理', cleaned, '个 session。');
