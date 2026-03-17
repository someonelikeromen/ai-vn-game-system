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

module.exports = { loadItems, addItem, getItem, updateItem, deleteItem };


