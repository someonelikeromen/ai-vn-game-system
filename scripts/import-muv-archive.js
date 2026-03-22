'use strict';
/**
 * 导入/更新脚本：将 docs/bestiary/MUV_world_archive.json 写入 data/world-archives.json
 * 运行：node scripts/import-muv-archive.js
 * - 首次运行：新增档案
 * - 再次运行：找到同 worldKey 的条目并覆盖更新（betaDatabase 外形描述等均同步）
 */
const path = require('path');
const { addArchive, loadArchives, updateArchive, detectTierRange } = require('../src/features/world/worldArchiveStore');

// 清除 require 缓存，确保每次读取最新文件内容
delete require.cache[require.resolve('../docs/bestiary/MUV_world_archive.json')];
const archiveData = require('../docs/bestiary/MUV_world_archive.json');

// 注入 tierRange
const tierRange = detectTierRange(archiveData.worldTier);
const payload = { ...archiveData, tierRange };

// 检查是否已存在同 worldKey 的档案
const existing = loadArchives().find(a => a.worldKey === archiveData.worldKey);
if (existing) {
  const { id, createdAt } = existing;
  updateArchive(id, payload);
  console.log('✅ 已更新现有档案！');
  console.log(`   id        : ${id}`);
  console.log(`   worldKey  : ${archiveData.worldKey}`);
  console.log(`   displayName: ${archiveData.displayName}`);
  console.log(`   worldTier : ${archiveData.worldTier}★  midTier: ${archiveData.midTier}★`);
  console.log(`   tierRange : ${tierRange}`);
  console.log(`   createdAt : ${createdAt}（保留原始时间）`);
} else {
  const entry = addArchive(payload);
  console.log('✅ 新增导入成功！');
  console.log(`   id        : ${entry.id}`);
  console.log(`   worldKey  : ${entry.worldKey}`);
  console.log(`   displayName: ${entry.displayName}`);
  console.log(`   worldTier : ${entry.worldTier}★  midTier: ${entry.midTier}★`);
  console.log(`   tierRange : ${entry.tierRange}`);
  console.log(`   createdAt : ${entry.createdAt}`);
}

console.log('\n前端刷新后即可在「世界档案库」中看到更新后的档案（含 betaDatabase 外形描述）。');
