'use strict';
/**
 * World Archive Store — manages the pool of generated world archives.
 * Archives are separate from shop items; base anchor items draw randomly from these pools.
 */
const fs   = require('fs');
const path = require('path');

const ARCHIVES_PATH = path.join(__dirname, '..', '..', '..', 'data', 'world-archives.json');

// Tier config — mirrors shopPrompt.js pricing table
const TIER_CONFIG = {
  low:       { label: '低危区（凡人~爆屋）',     tierMin: 0,  tierMax: 2,  pricePoints: 1000,      requiredMedals: [] },
  mid:       { label: '中危区（爆楼~爆城）',     tierMin: 3,  tierMax: 5,  pricePoints: 5000,      requiredMedals: [{ stars: 2, count: 1 }] },
  high:      { label: '高危区（爆国~地表）',     tierMin: 6,  tierMax: 8,  pricePoints: 50000,     requiredMedals: [{ stars: 5, count: 1 }] },
  stellar:   { label: '行星/恒星区',            tierMin: 9,  tierMax: 10, pricePoints: 500000,    requiredMedals: [{ stars: 8, count: 1 }] },
  galactic:  { label: '星系/宇宙区',            tierMin: 11, tierMax: 13, pricePoints: 1000000,   requiredMedals: [{ stars: 10, count: 1 }] },
  beyond:    { label: '超限区（超单体~多元）',   tierMin: 14, tierMax: 15, pricePoints: 5000000,   requiredMedals: [{ stars: 13, count: 1 }] },
  absolute:  { label: '绝对区（超多元~叙事层）', tierMin: 16, tierMax: 99, pricePoints: 50000000,  requiredMedals: [{ stars: 15, count: 1 }] },
};

function ensureDir() {
  const dir = path.dirname(ARCHIVES_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadArchives() {
  try {
    ensureDir();
    if (!fs.existsSync(ARCHIVES_PATH)) return [];
    return JSON.parse(fs.readFileSync(ARCHIVES_PATH, 'utf-8')) || [];
  } catch (_) { return []; }
}

function saveArchives(archives) {
  ensureDir();
  fs.writeFileSync(ARCHIVES_PATH, JSON.stringify(archives, null, 2), 'utf-8');
}

function addArchive(data) {
  const archives = loadArchives();
  const id = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry = { id, createdAt: new Date().toISOString(), ...data };
  archives.unshift(entry);
  saveArchives(archives);
  return entry;
}

function deleteArchive(id) {
  const archives = loadArchives();
  const idx = archives.findIndex(a => a.id === id);
  if (idx === -1) return false;
  archives.splice(idx, 1);
  saveArchives(archives);
  return true;
}

/**
 * Update editable fields of an archive.
 * Protected fields (id, createdAt, worldKey) are never overwritten via this function.
 */
function updateArchive(id, updates) {
  const archives = loadArchives();
  const idx = archives.findIndex(a => a.id === id);
  if (idx === -1) return null;
  const { id: _i, createdAt: _c, worldKey: _w, ...safe } = updates;
  archives[idx] = { ...archives[idx], ...safe };
  saveArchives(archives);
  return archives[idx];
}

function getArchive(id) {
  return loadArchives().find(a => a.id === id) || null;
}

function getByTier(tierRange) {
  return loadArchives().filter(a => a.tierRange === tierRange);
}

function getRandom(tierRange) {
  const pool = getByTier(tierRange);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function countByTier() {
  const counts = {};
  for (const k of Object.keys(TIER_CONFIG)) counts[k] = 0;
  for (const a of loadArchives()) {
    if (counts[a.tierRange] !== undefined) counts[a.tierRange]++;
  }
  return counts;
}

/** Detect tier range from max tier number */
function detectTierRange(maxTier) {
  const n = Number(maxTier) || 0;
  if (n <= 2)  return 'low';
  if (n <= 5)  return 'mid';
  if (n <= 8)  return 'high';
  if (n <= 10) return 'stellar';
  if (n <= 13) return 'galactic';
  if (n <= 15) return 'beyond';
  return 'absolute';
}

module.exports = { TIER_CONFIG, loadArchives, addArchive, deleteArchive, updateArchive, getArchive, getByTier, getRandom, countByTier, detectTierRange };
