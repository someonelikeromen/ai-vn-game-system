'use strict';
/**
 * 一次性脚本：为已激活 MUV 世界的现有 session 触发 betaDatabase NPC 后台生成。
 * 运行：node scripts/trigger-beta-spawn.js
 */
const path = require('path');
const fs   = require('fs');

const sessionMgr        = require('../src/core/session');
const worldArchiveStore = require('../src/features/world/worldArchiveStore');
const { buildStatSnapshot } = require('../src/engine/varEngine');
const { processNarrativeSpawnsAsync } = require('../src/engine/gameLoop');

// 将所有 session 从磁盘加载进内存，否则 processNarrativeSpawnsAsync 内部 getSession 会返回 null
sessionMgr.loadAllSessions();

const allArchives = worldArchiveStore.loadArchives();

async function run() {
  const sessions = sessionMgr.listSessions();
  let triggered = 0;

  for (const meta of sessions) {
    const session = sessionMgr.getSession(meta.id);
    if (!session) continue;

    const archives = session.statData && session.statData.Multiverse && session.statData.Multiverse.Archives || {};
    const muvKeys = Object.keys(archives).filter(k =>
      k.includes('Muv') || k.includes('muv') || k.includes('ALT') || k.includes('Alternative')
    );
    if (muvKeys.length === 0) continue;

    for (const worldKey of muvKeys) {
      const matchedArchive = allArchives.find(a =>
        (a.displayName || '') === worldKey ||
        (a.displayName || '').includes(worldKey.slice(0, 4)) ||
        worldKey.includes((a.displayName || '').slice(0, 4))
      );
      const catalog = matchedArchive && matchedArchive.betaDatabase && matchedArchive.betaDatabase.catalog;
      if (!Array.isArray(catalog) || catalog.length === 0) {
        console.log(meta.id.slice(0, 8), '| 世界:', worldKey, '| 无 betaDatabase，跳过');
        continue;
      }

      const existingNPCs  = archives[worldKey].NPCs || [];
      const existingNames = new Set(existingNPCs.map(n => n.name));
      const pending = catalog.filter(e => e.name && !existingNames.has(e.name));

      if (pending.length === 0) {
        console.log(meta.id.slice(0, 8), '| 世界:', worldKey, '| 全部', catalog.length, '种 BETA 已有 NPC，跳过');
        continue;
      }

      console.log(meta.id.slice(0, 8), '| 世界:', worldKey, '| 生成', pending.length, '种 BETA NPC...');

      const snapshot  = buildStatSnapshot(session.statData);
      const spawnTags = pending.map(entry => ({
        name:        entry.name || '',
        type:        'Monster',
        sourceWorld: worldKey,
        description: [
          entry.latinName     ? ('学名：' + entry.latinName)       : '',
          entry.nickname      ? ('俗称：' + entry.nickname)        : '',
          entry.combatTier    ? ('战力星级：' + entry.combatTier)   : '',
          entry.primaryThreat ? ('主要威胁：' + entry.primaryThreat) : '',
          entry.tierBasis     ? ('战力依据：' + entry.tierBasis)    : '',
          entry.antiFeat      ? ('Anti-Feat：' + entry.antiFeat)   : '',
          entry.appearance    ? ('外形：' + entry.appearance.slice(0, 200)) : '',
        ].filter(Boolean).join('\n'),
        hostile:  true,
        location: null,
      }));

      await processNarrativeSpawnsAsync(meta.id, spawnTags, snapshot, session.statData);

      const updated  = sessionMgr.getSession(meta.id);
      const npcCount = (updated && updated.statData && updated.statData.Multiverse &&
                        updated.statData.Multiverse.Archives &&
                        updated.statData.Multiverse.Archives[worldKey] &&
                        updated.statData.Multiverse.Archives[worldKey].NPCs || []).length;
      console.log(meta.id.slice(0, 8), '| ✅ 完成，NPCs:', npcCount);
      triggered++;
    }
  }

  console.log('\n完成，共处理', triggered, '个世界档案。');
}

run().catch(e => { console.error('错误:', e.message); process.exit(1); });
