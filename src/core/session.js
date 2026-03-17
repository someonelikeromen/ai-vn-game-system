'use strict';
/**
 * Session Manager — maintains in-memory game sessions with disk persistence.
 *
 * Each session stores:
 *   - id, name, createdAt, updatedAt
 *   - statData: the current variable JSON tree (CharacterSheet, Arsenal, Multiverse, etc.)
 *   - history: [{role, promptContent, displayContent, options, danmu, html, timestamp}]
 *   - charProfile: lightweight summary synced from statData after each turn
 *   - isInitialized, charCardPath, presetPath
 */

const fs   = require('fs');
const path = require('path');
const log  = require('./logger');

const SESSIONS_DIR = path.join(__dirname, '..', '..', 'data', 'sessions');

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function ensureDir() {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

const sessions = new Map();

function createSession({ name, greetingIndex = -1, charCardPath, presetPath } = {}) {
  const id = uuidv4();
  const session = {
    id,
    name: name || `Session ${new Date().toLocaleString('zh-CN')}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    greetingIndex,
    charCardPath: charCardPath || null,
    presetPath:   presetPath   || null,
    statData:     {},
    history:      [],
    charProfile:  null,
    isInitialized: false,
  };
  sessions.set(id, session);
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
}

function listSessions() {
  return Array.from(sessions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      greetingIndex: s.greetingIndex,
      isInitialized: s.isInitialized,
      messageCount: s.history.length,
      charProfile: s.charProfile || null,
    }));
}

function deleteSession(id) {
  sessions.delete(id);
  const filePath = path.join(SESSIONS_DIR, `${id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return true;
}

function addMessage(session, role, promptContent, displayContent, extras = {}) {
  const entry = {
    role,
    promptContent,
    displayContent,
    options:   extras.options || [],
    danmu:     extras.danmu   || [],
    html:      extras.html    || '',
    timestamp: Date.now(),
  };
  if (extras.statSnapshotBefore != null) entry.statSnapshotBefore = extras.statSnapshotBefore;
  session.history.push(entry);
  session.updatedAt = Date.now();
}

function updateStatData(session, statData) {
  session.statData  = statData;
  session.updatedAt = Date.now();
}

function truncateHistory(session, fromIdx) {
  session.history   = session.history.slice(0, Math.max(0, fromIdx));
  session.updatedAt = Date.now();
}

function saveSession(session) {
  try {
    ensureDir();
    const filePath   = path.join(SESSIONS_DIR, `${session.id}.json`);
    const serialized = JSON.stringify(session, null, 2);
    const tmpPath    = filePath + '.tmp';
    fs.writeFileSync(tmpPath, serialized, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    log.error(`Failed to save session ${session?.id}`, e);
  }
}

function loadAllSessions() {
  try {
    ensureDir();
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
    let loaded = 0;
    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf-8'));
        if (!data.id) throw new Error('session file missing id field');
        sessions.set(data.id, data);
        loaded++;
      } catch (e) {
        log.warn(`Failed to load session file "${f}": ${e.message}`);
      }
    }
    log.info(`Sessions loaded: ${loaded}/${files.length} from disk`);
  } catch (e) {
    log.error('loadAllSessions: failed to read sessions directory', e);
  }
}

module.exports = {
  createSession,
  getSession,
  listSessions,
  deleteSession,
  addMessage,
  updateStatData,
  truncateHistory,
  saveSession,
  loadAllSessions,
};
