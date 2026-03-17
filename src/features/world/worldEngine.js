'use strict';
/**
 * World Engine — applies world archive data to sessions.
 * Extracted from server.js.
 */

const log        = require('../../core/logger');
const sessionMgr = require('../../core/session');
const { syncWorldIdentity } = require('../../engine/varEngine');

/**
 * Apply a world archive entry to session.statData.
 * Does NOT save the session — caller is responsible.
 */
function applyWorldArchiveToSession(session, archive, opts = {}) {
  if (!session.statData) session.statData = {};

  const derivedIdentity = archive.worldIdentity || {
    name:        null,
    title:       '外来穿越者',
    occupation:  `在「${archive.displayName}」世界中以隐匿观察者的身份活动`,
    background:  `你以外来者的身份抵达「${archive.displayName}」的起始区域（${archive.initialLocation || '未指定起点'}）。` +
      `表面上维持普通人/路人的社会定位，暗中通过「无限武库」系统收集该世界的力量体系与世界法则的实证，以避免在早期就对原作进程造成失控干预。`,
    coreMemories:     [],
    socialConnections: [],
  };

  const inheritIdentity = opts.inheritIdentity !== false;

  // When not inheriting identity, use a generic location to avoid leaking
  // identity-specific text that the LLM may have baked into initialLocation.
  const locationValue = inheritIdentity
    ? (archive.initialLocation || '?')
    : `「${archive.displayName}」世界的某处起始区域（以外来穿越者身份抵达，尚未确定具体位置）`;

  const archiveEntry = {
    WorldName:   [archive.displayName, 'Name'],
    Time:        { Date: [archive.timePeriod || '?', 'Date'], Clock: ['?', 'Time'], FlowRate: ['1.0', 'Rate'] },
    Location:    [locationValue, 'Loc'],
    SocialWeb:   Object.fromEntries((archive.keyFactions || []).map(f => [f.name, [f.description, f.attitude || '']])),
    WorldRules:  archive.worldRules || [],
    Timeline:    Array.isArray(archive.timeline) ? archive.timeline : [],
    Log:         [],
    PowerSystems: Array.isArray(archive.powerSystems) && archive.powerSystems.length > 0
      ? archive.powerSystems
      : (archive.powerSystem ? [{ name: '综合力量体系', description: archive.powerSystem }] : []),
    WorldIdentity: inheritIdentity ? derivedIdentity : null,
  };

  const displayName = archive.displayName;

  if (!session.statData.Multiverse) {
    session.statData.Multiverse = { CurrentWorldName: null, Archives: {} };
  }
  if (!session.statData.Multiverse.Archives) {
    session.statData.Multiverse.Archives = {};
  }
  session.statData.Multiverse.Archives[displayName] = archiveEntry;

  const cur = session.statData.Multiverse.CurrentWorldName;
  if (!cur) {
    session.statData.Multiverse.CurrentWorldName = [displayName, 'Name'];
  } else if (Array.isArray(cur) && typeof cur[1] === 'string' && cur[1] !== 'ActiveWorlds') {
    const existing = cur[0];
    if (existing !== displayName) {
      session.statData.Multiverse.CurrentWorldName = [[existing, displayName], 'ActiveWorlds'];
    }
  } else if (Array.isArray(cur) && cur[1] === 'ActiveWorlds') {
    const list = Array.isArray(cur[0]) ? cur[0] : [cur[0]];
    if (!list.includes(displayName)) list.push(displayName);
    session.statData.Multiverse.CurrentWorldName = [list, 'ActiveWorlds'];
  } else {
    session.statData.Multiverse.CurrentWorldName = [displayName, 'Name'];
  }

  const curKey = Array.isArray(session.statData.Multiverse.CurrentWorldName)
    ? session.statData.Multiverse.CurrentWorldName[0]
    : session.statData.Multiverse.CurrentWorldName;
  if (curKey === displayName) {
    if (inheritIdentity) {
      syncWorldIdentity(session.statData, displayName);
    } else if (session.statData.CharacterSheet) {
      delete session.statData.CharacterSheet.WorldContext;
    }
  }

  log.session('WORLD_APPLY', `Applied world archive "${displayName}" to session ${session.id} inheritIdentity=${inheritIdentity}`);
}

module.exports = { applyWorldArchiveToSession };
