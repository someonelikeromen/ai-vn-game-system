'use strict';
/**
 * Logger — writes timestamped entries to daily log files in data/logs/.
 * Also mirrors to console with ANSI color coding.
 */

const fs   = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', '..', 'data', 'logs');

function ensureDir() {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function logFile() {
  const d   = new Date();
  const y   = d.getUTCFullYear();
  const m   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return path.join(LOGS_DIR, `${y}-${m}-${day}.log`);
}

function write(level, msg) {
  ensureDir();
  const ts   = new Date().toISOString();
  const line = `[${ts}] [${level.padEnd(5)}] ${msg}\n`;
  try { fs.appendFileSync(logFile(), line, 'utf-8'); } catch (_) {}
  if (level !== 'DEBUG' || process.env.DEBUG) {
    const c = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'API' ? '\x1b[36m' : '\x1b[0m';
    process.stdout.write(`${c}${line}\x1b[0m`);
  }
}

function writeAsync(level, msg) {
  ensureDir();
  const ts   = new Date().toISOString();
  const line = `[${ts}] [${level.padEnd(5)}] ${msg}\n`;
  if (level !== 'DEBUG' || process.env.DEBUG) {
    const c = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : level === 'API' ? '\x1b[36m' : '\x1b[0m';
    process.stdout.write(`${c}${line}\x1b[0m`);
  }
  try { fs.appendFile(logFile(), line, 'utf-8', () => {}); } catch (_) {}
}

const log = {
  info:  (msg)        => write('INFO',  String(msg)),
  warn:  (msg)        => write('WARN',  String(msg)),
  error: (msg, err)   => write('ERROR', err ? `${msg}: ${err.stack || err.message || err}` : String(msg)),
  debug: (msg)        => write('DEBUG', String(msg)),

  llm(opts) {
    const { model, baseUrl, msgCount, stream, durationMs, responseChars, error } = opts;
    const host = (() => { try { return new URL(baseUrl || '').host; } catch (_) { return baseUrl || '?'; } })();
    if (error) {
      write('API', `✗ LLM ${model}@${host} | msgs:${msgCount} stream:${stream} | ERROR: ${error}`);
    } else {
      write('API', `✓ LLM ${model}@${host} | msgs:${msgCount} stream:${stream} | ${durationMs}ms | ${responseChars} chars`);
    }
  },

  chatReq(sessionId, messages) {
    const lines = messages.map((m, i) => `  [${i}][${m.role}]\n${String(m.content || '')}`);
    write('CHAT', `▶ REQ sess:${sessionId} | ${messages.length} msgs\n${lines.join('\n---\n')}`);
  },

  chatResp(sessionId, text, durationMs) {
    write('CHAT', `◀ RSP sess:${sessionId} | ${durationMs}ms | ${text.length} chars\n${text}`);
  },

  req(method, url, statusCode, durationMs) {
    write('HTTP', `${method} ${url} → ${statusCode} [${durationMs}ms]`);
  },

  shopReq(description, messages) {
    const lines = messages.map((m, i) => `  [${i}][${m.role}]\n${String(m.content || '')}`);
    write('SHOP', `▶ SHOP_REQ desc="${String(description).slice(0, 80)}" | ${messages.length} msgs\n${lines.join('\n---\n')}`);
  },

  shopResp(description, text, durationMs) {
    write('SHOP', `◀ SHOP_RSP ${durationMs}ms | ${text.length} chars | desc="${String(description).slice(0, 60)}"\n${text}`);
  },

  shop(action, details) {
    write('SHOP', `[${action}] ${details}`);
  },

  session(action, details) {
    write('SESS', `[${action}] ${details}`);
  },

  listFiles() {
    ensureDir();
    return fs.readdirSync(LOGS_DIR)
      .filter((f) => f.endsWith('.log'))
      .sort()
      .reverse()
      .map((f) => path.join(LOGS_DIR, f));
  },

  tail(lines = 200) {
    ensureDir();
    const file = logFile();
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, 'utf-8');
    const all = content.split('\n').filter(Boolean);
    return lines === Infinity ? all : all.slice(-lines);
  },
};

module.exports = log;
