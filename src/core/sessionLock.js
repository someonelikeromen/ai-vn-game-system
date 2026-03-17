'use strict';
/**
 * Session Lock — per-session Promise-chain mutex.
 * Prevents concurrent LLM calls / history mutations on the same session.
 * Each entry is a Promise chain; callers append to the tail.
 */

const locks = new Map();

function withSessionLock(sessionId, fn) {
  const prev = locks.get(sessionId) || Promise.resolve();
  const next = prev.then(() => fn()).finally(() => {
    if (locks.get(sessionId) === next) locks.delete(sessionId);
  });
  locks.set(sessionId, next);
  return next;
}

function hasLock(sessionId) {
  return locks.has(sessionId);
}

module.exports = { withSessionLock, hasLock };
