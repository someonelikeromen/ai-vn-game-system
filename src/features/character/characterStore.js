'use strict';
/**
 * Character Archive Store — persists saved character profiles to data/characters.json
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, '..', '..', '..', 'data');
const CHARS_FILE = path.join(DATA_DIR, 'characters.json');

function uuid() {
  return 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadAll() {
  ensureDir();
  if (!fs.existsSync(CHARS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(CHARS_FILE, 'utf-8'));
  } catch (_) {
    return [];
  }
}

function saveAll(chars) {
  ensureDir();
  fs.writeFileSync(CHARS_FILE, JSON.stringify(chars, null, 2), 'utf-8');
}

/** Save a new character profile to archive. Returns the saved entry. */
function saveCharacter(characterData) {
  const chars = loadAll();
  const entry = {
    id:        uuid(),
    createdAt: new Date().toISOString(),
    character: characterData,
  };
  chars.unshift(entry); // newest first
  saveAll(chars);
  return entry;
}

/** List all saved characters (id + createdAt + summary fields, no full data by default). */
function listCharacters(full = false) {
  return loadAll().map(entry => {
    const c = entry.character || {};
    const summary = {
      id:        entry.id,
      createdAt: entry.createdAt,
      name:      c.name      || '未命名',
      gender:    c.gender    || '',
      age:       c.age       || '',
      title:     c.title     || '',
      identity:  c.identity  || '',
      alignment: c.alignment || '',
      traits:    Array.isArray(c.traits) ? c.traits : [],
      hasPowers: Array.isArray(c.powerSources) && c.powerSources.length > 0,
      hasMechs:  Array.isArray(c.mechs)        && c.mechs.length        > 0,
    };
    return full ? { ...summary, character: entry.character } : summary;
  });
}

/** Get full character entry by id. */
function getCharacter(id) {
  return loadAll().find(e => e.id === id) || null;
}

/** Delete a character by id. Returns true if found and deleted. */
function deleteCharacter(id) {
  const chars   = loadAll();
  const filtered = chars.filter(e => e.id !== id);
  if (filtered.length === chars.length) return false;
  saveAll(filtered);
  return true;
}

module.exports = { saveCharacter, listCharacters, getCharacter, deleteCharacter };
