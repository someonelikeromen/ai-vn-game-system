'use strict';
/**
 * Shop Store 鈥?persists generated shop items to data/shop-items.json
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = path.join(__dirname, '..', '..', '..', 'data');
const SHOP_FILE = path.join(DATA_DIR, 'shop-items.json');

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadItems() {
  ensureDir();
  if (!fs.existsSync(SHOP_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SHOP_FILE, 'utf-8'));
  } catch (_) {
    return [];
  }
}

function saveItems(items) {
  ensureDir();
  fs.writeFileSync(SHOP_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

function addItem(itemData) {
  const items = loadItems();
  const item = {
    id:        uuid(),
    createdAt: new Date().toISOString(),
    ...itemData,
  };
  items.unshift(item); // newest first
  saveItems(items);
  return item;
}

function getItem(id) {
  return loadItems().find((i) => i.id === id) || null;
}

function updateItem(id, updates) {
  const items = loadItems();
  const idx   = items.findIndex((i) => i.id === id);
  if (idx === -1) return null;
  items[idx] = { ...items[idx], ...updates };
  saveItems(items);
  return items[idx];
}

function deleteItem(id) {
  const items    = loadItems();
  const filtered = items.filter((i) => i.id !== id);
  if (filtered.length === items.length) return false;
  saveItems(filtered);
  return true;
}

/** Delete many items in one write. Skips system / baseAnchor entries. */
function deleteItems(ids) {
  if (!Array.isArray(ids) || !ids.length) return { removed: 0, skipped: 0 };
  const idSet = new Set(ids.map(String));
  const items = loadItems();
  let removed = 0;
  let skipped = 0;
  const next = items.filter((i) => {
    if (!idSet.has(i.id)) return true;
    if (i.system || i.baseAnchor) {
      skipped++;
      return true;
    }
    removed++;
    return false;
  });
  if (removed > 0) saveItems(next);
  return { removed, skipped };
}

function normalizeForShopMatch(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function splitBilingualName(s) {
  const n = normalizeForShopMatch(s);
  if (!n) return [];
  return n.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Match Phase 1 reqItemUpdate string to an existing shop row — skip re-eval / duplicate add.
 */
function findItemMatchingNarrativeReq(allItems, reqStr) {
  const req = normalizeForShopMatch(reqStr);
  if (!req || req.length < 2) return null;
  const reqParts = splitBilingualName(reqStr);

  for (const it of allItems) {
    if (it.system || it.baseAnchor) continue;
    const name = normalizeForShopMatch(it.name || '');
    if (!name) continue;
    const nameParts = splitBilingualName(it.name || '');

    if (req === name) return it;
    const shorter = req.length <= name.length ? req : name;
    const longer = req.length > name.length ? req : name;
    if (shorter.length >= 4 && longer.includes(shorter)) return it;

    for (const rp of reqParts) {
      for (const np of nameParts.length ? nameParts : [name]) {
        if (!rp || !np) continue;
        if (rp === np) return it;
        const a = rp.length <= np.length ? rp : np;
        const b = rp.length > np.length ? rp : np;
        if (a.length >= 4 && b.includes(a)) return it;
      }
    }
  }
  return null;
}

/** Shape expected by Phase 3 / Phase 4 prompts (subset of full shop item). */
function itemToPhase2ContextForPrompt(item) {
  return {
    name:        item.name,
    tier:        item.tier,
    type:        item.type,
    description: item.description || '',
  };
}

module.exports = {
  loadItems,
  addItem,
  getItem,
  updateItem,
  deleteItem,
  deleteItems,
  findItemMatchingNarrativeReq,
  itemToPhase2ContextForPrompt,
};


