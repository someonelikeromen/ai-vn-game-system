'use strict';
/**
 * 迁移脚本：将 session 中旧的 world key（锚点 WorldName）
 * 替换为对应档案库的 displayName，实现 1:1 匹配。
 * 运行：node scripts/migrate-world-keys.js
 */
const sessionMgr        = require('../src/core/session');
const worldArchiveStore = require('../src/features/world/worldArchiveStore');

sessionMgr.loadAllSessions();
const allArchives = worldArchiveStore.loadArchives();

function findMatchingArchive(worldKey) {
  return allArchives.find(a => {
    const dn = (a.displayName || '').toLowerCase();
    const wk = worldKey.toLowerCase();
    return dn === wk ||
           dn.includes(wk.slice(0, 4)) ||
           wk.includes(dn.slice(0, 4));
  });
}

let totalMigrated = 0;

for (const meta of sessionMgr.listSessions()) {
  const session  = sessionMgr.getSession(meta.id);
  if (!session) continue;

  const archives = session.statData?.Multiverse?.Archives;
  if (!archives) continue;

  let changed = false;

  for (const oldKey of Object.keys(archives)) {
    const matched = findMatchingArchive(oldKey);
    if (!matched) continue;

    const newKey = matched.displayName;
    if (newKey === oldKey) continue;  // 已经正确，跳过

    console.log(`[${meta.id.slice(0,8)}] "${oldKey}" → "${newKey}"`);

    // 迁移 Archives key
    archives[newKey] = archives[oldKey];
    delete archives[oldKey];

    // 迁移 CurrentWorldName
    const curWorld = session.statData.Multiverse.CurrentWorldName;
    const cur = Array.isArray(curWorld) ? curWorld[0] : curWorld;
    if (cur === oldKey) {
      session.statData.Multiverse.CurrentWorldName = [newKey, 'Name'];
    }

    // 迁移 OriginWorldKey
    if (session.statData.Multiverse.OriginWorldKey === oldKey) {
      session.statData.Multiverse.OriginWorldKey = newKey;
    }

    changed = true;
    totalMigrated++;
  }

  if (changed) {
    sessionMgr.saveSession(session);
    console.log(`  → 已保存`);
  }
}

console.log(`\n完成，共迁移 ${totalMigrated} 个世界 key。`);
