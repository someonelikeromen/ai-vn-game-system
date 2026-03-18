'use strict';
/**
 * Variable Engine — manages the game's stat_data JSON tree.
 * Handles _.set / _.insert / _.remove / _.add operations and
 * executes <UpdateVariable> blocks embedded in LLM responses.
 */

const vm  = require('vm');
const log = require('../core/logger');

// ─── Path Utilities ──────────────────────────────────────────────────────────

/**
 * Parse 'CharacterSheet.Loadout.Items[0].Name' into
 * ['CharacterSheet', 'Loadout', 'Items', 0, 'Name']
 */
function parsePath(rawPath) {
  const path = rawPath.replace(/^stat_data\./, '');
  const segments = [];
  for (const part of path.split('.')) {
    const m = part.match(/^(.+?)\[(\d+)\]$/);
    if (m) {
      if (m[1]) segments.push(m[1]);
      segments.push(parseInt(m[2], 10));
    } else if (part) {
      segments.push(part);
    }
  }
  return segments;
}

function getAtPath(obj, segs) {
  let cur = obj;
  for (const s of segs) {
    if (cur == null) return undefined;
    cur = cur[s];
  }
  return cur;
}

function setAtPath(obj, segs, value) {
  if (!segs.length) return;
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    if (cur[s] == null) cur[s] = typeof next === 'number' ? [] : {};
    cur = cur[s];
  }
  cur[segs[segs.length - 1]] = value;
}

function deleteAtPath(obj, segs) {
  if (!segs.length) return;
  const parentSegs = segs.slice(0, -1);
  const last = segs[segs.length - 1];
  const parent = getAtPath(obj, parentSegs);
  if (parent == null) return;
  if (Array.isArray(parent) && typeof last === 'number') {
    parent.splice(last, 1);
  } else {
    delete parent[last];
  }
}

// ─── Engine Factory ───────────────────────────────────────────────────────────

function createEngine(statData) {
  return {
    /**
     * _.set('path', value) — deep-set a value
     */
    set(path, value) {
      setAtPath(statData, parsePath(path), value);
    },

    /**
     * _.insert('path', value)           → push to array
     * _.insert('path', 'key', value)    → set object[key] = value
     */
    insert(path, keyOrValue, maybeValue) {
      const segs = parsePath(path);
      if (maybeValue !== undefined) {
        // 3-arg form: obj[key] = value
        let obj = getAtPath(statData, segs);
        if (obj == null) {
          setAtPath(statData, segs, {});
          obj = getAtPath(statData, segs);
        }
        if (typeof obj === 'object' && !Array.isArray(obj)) {
          obj[keyOrValue] = maybeValue;
        }
      } else {
        // 2-arg form: arr.push(value)
        let arr = getAtPath(statData, segs);
        if (!Array.isArray(arr)) {
          setAtPath(statData, segs, []);
          arr = getAtPath(statData, segs);
        }
        arr.push(keyOrValue);
      }
    },

    /**
     * _.remove('path')         → delete key or splice index
     * _.remove('path', index)  → splice specific index from array
     */
    remove(path, index) {
      const segs = parsePath(path);
      if (index !== undefined) {
        const arr = getAtPath(statData, segs);
        if (Array.isArray(arr)) arr.splice(index, 1);
      } else {
        deleteAtPath(statData, segs);
      }
    },

    /**
     * _.add('path', delta) — numeric addition (creates 0 if missing)
     */
    add(path, delta) {
      const segs = parsePath(path);
      const cur = Number(getAtPath(statData, segs)) || 0;
      setAtPath(statData, segs, cur + delta);
    },
  };
}

// ─── Block Extraction ─────────────────────────────────────────────────────────

function extractUpdateVariableBlocks(text) {
  const blocks = [];
  const re = /<UpdateVariable[^>]*>([\s\S]*?)<\/UpdateVariable\s*>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

// ─── Code Preprocessing ───────────────────────────────────────────────────────

/**
 * State-machine quote normalizer.
 * - Curly quotes used AS delimiters  → converted to ASCII equivalents
 * - Curly quotes INSIDE a string     → escaped (\" or \')
 * This avoids the naive replacement that breaks strings like "副产品".
 */
function normalizeQuotes(code) {
  let result = '';
  let inString = false;
  let stringChar = '';
  let i = 0;
  while (i < code.length) {
    const cp = code.codePointAt(i);
    const ch = code[i];
    const isCurlyDblOpen  = cp === 0x201C; // "
    const isCurlyDblClose = cp === 0x201D; // "
    const isCurlySglOpen  = cp === 0x2018; // '
    const isCurlySglClose = cp === 0x2019; // '
    const isCurly = isCurlyDblOpen || isCurlyDblClose || isCurlySglOpen || isCurlySglClose;

    if (!inString) {
      if (ch === '"' || ch === "'") {
        inString = true;
        stringChar = ch;
        result += ch;
      } else if (isCurlyDblOpen || isCurlyDblClose) {
        // Curly double-quote used as a string delimiter
        result += '"';
        inString = true;
        stringChar = '"';
      } else if (isCurlySglOpen || isCurlySglClose) {
        // Curly single-quote used as a string delimiter
        result += "'";
        inString = true;
        stringChar = "'";
      } else {
        result += ch;
      }
    } else {
      // Inside a string
      if (ch === '\\') {
        // Pass escape sequences through unchanged
        result += ch + (code[i + 1] || '');
        i += 2;
        continue;
      } else if (ch === stringChar) {
        // End of string
        inString = false;
        result += ch;
      } else if (isCurlyDblOpen || isCurlyDblClose) {
        // Curly double-quote inside a string — escape it
        result += stringChar === '"' ? '\\"' : '"';
      } else if (isCurlySglOpen || isCurlySglClose) {
        // Curly single-quote inside a string — escape it
        result += stringChar === "'" ? "\\'" : "'";
      } else {
        result += ch;
      }
    }
    i++;
  }
  return result;
}

/**
 * Replace SillyTavern template variables ({{user}}, {{char}}) with actual names.
 */
function substituteTemplateVars(code, vars) {
  const user = vars.userName || 'User';
  const char = vars.charName || 'AI';
  return code
    .replace(/\{\{user\}\}/gi, user)
    .replace(/\{\{char\}\}/gi, char);
}

/**
 * Full preprocessing pipeline before VM execution.
 */
function preprocessCode(code, vars) {
  let clean = code;
  // 1. Strip <Analysis> sections
  clean = clean.replace(/<Analysis>[\s\S]*?<\/Analysis>/gi, '');
  // 2. Normalize fancy/curly quotes
  clean = normalizeQuotes(clean);
  // 3. Substitute template variables
  clean = substituteTemplateVars(clean, vars || {});
  return clean;
}

/**
 * Extract individual top-level _.set/insert/remove/add(...) call strings
 * by matching parentheses. Used as a per-statement fallback.
 */
function extractStatements(code) {
  const stmts = [];
  const re = /\b_\.(set|insert|remove|add)\s*\(/g;
  let match;
  while ((match = re.exec(code)) !== null) {
    const start = match.index;
    let depth = 0;
    let i = match.index + match[0].length - 1; // opening '('
    let inStr = false;
    let strCh = '';
    while (i < code.length) {
      const c = code[i];
      if (inStr) {
        if (c === '\\') { i += 2; continue; }
        if (c === strCh) inStr = false;
      } else {
        if (c === '"' || c === "'") { inStr = true; strCh = c; }
        else if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) {
            stmts.push(code.substring(start, i + 1) + ';');
            break;
          }
        }
      }
      i++;
    }
  }
  return stmts;
}

// ─── Block Execution ──────────────────────────────────────────────────────────

function executeBlock(code, statData, vars) {
  const clean = preprocessCode(code, vars);
  const engine = createEngine(statData);

  const ctx = {
    _: engine,
    getvar(path) { return getAtPath(statData, parsePath(path)); },
    setvar(path, val) { setAtPath(statData, parsePath(path), val); },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Number, Math, Array, Object, JSON, String, Boolean,
    parseInt, parseFloat, isNaN, undefined,
  };

  // First: try running the whole block at once
  try {
    vm.runInNewContext(clean, ctx, { timeout: 10000 });
    return;
  } catch (err) {
    log.debug(`UpdateVar: whole-block exec failed, falling back to per-statement. ${err.message.slice(0, 120)}`);
  }

  // Fallback: extract and run each _.xxx() statement individually
  // This survives missing commas, bad nested syntax, etc.
  const stmts = extractStatements(clean);
  let successCount = 0;
  for (const stmt of stmts) {
    try {
      vm.runInNewContext(stmt, ctx, { timeout: 5000 });
      successCount++;
    } catch (err) {
      log.debug(`UpdateVar: stmt failed [${stmt.slice(0, 100)}] — ${err.message.slice(0, 100)}`);
    }
  }
  if (stmts.length > 0) {
    log.debug(`UpdateVar: per-statement fallback completed ${successCount}/${stmts.length} statements`);
  }
}

// ─── Auto-Calc ────────────────────────────────────────────────────────────────

function runAutoCalc(statData) {
  try {
    const attrs = statData?.CharacterSheet?.CoreSystem?.Attributes;
    if (!attrs) return;

    const g = (k) => Number(Array.isArray(attrs[k]) ? attrs[k][0] : attrs[k]) || 1;
    const VIT = g('VIT'), DUR = g('DUR'), MEN = g('MEN');

    const maxHP = Math.floor((VIT + DUR) * 50);
    const maxStam = Math.floor((VIT + MEN) * 20);
    const maxMana = Math.floor(MEN * 10);

    const hp = statData.CharacterSheet.DynamicStatus?.HP;
    if (hp) {
      if (!hp.MaxValue) hp.MaxValue = [maxHP, 'Max'];
      else hp.MaxValue[0] = maxHP;
      if (hp.Value && hp.Value[0] > maxHP) hp.Value[0] = maxHP;
    }

    const pools = statData.CharacterSheet.DynamicStatus?.EnergyPools;
    if (Array.isArray(pools)) {
      pools.forEach((p) => {
        if (!p || !Array.isArray(p.Name)) return;
        const nm = String(p.Name[0]);
        if (nm.includes('体力') || nm.toLowerCase().includes('stamina')) {
          if (!p.MaxValue) p.MaxValue = [maxStam, 'Max'];
          else p.MaxValue[0] = maxStam;
          if (p.Value && p.Value[0] > maxStam) p.Value[0] = maxStam;
        }
        if (nm.includes('魔力') || nm.toLowerCase().includes('mana')) {
          if (!p.MaxValue) p.MaxValue = [maxMana, 'Max'];
          else p.MaxValue[0] = maxMana;
          if (p.Value && p.Value[0] > maxMana) p.Value[0] = maxMana;
        }
      });
    }
  } catch (_) {
    // Auto-calc is best-effort
  }
}

// ─── World Identity Sync ──────────────────────────────────────────────────────

/**
 * Get the current world key from statData.
 */
function _currentWorldKey(statData) {
  const w = statData?.Multiverse?.CurrentWorldName;
  return Array.isArray(w) ? w[0] : (w || null);
}

/**
 * Apply the WorldIdentity of the given world key to CharacterSheet.WorldContext.
 * Called whenever the current world changes.
 */
function syncWorldIdentity(statData, worldKey) {
  try {
    if (!worldKey) return;
    const identity = statData?.Multiverse?.Archives?.[worldKey]?.WorldIdentity;
    if (!identity) {
      // Clear WorldContext if the new world has no identity
      if (statData?.CharacterSheet) delete statData.CharacterSheet.WorldContext;
      return;
    }
    if (!statData.CharacterSheet) return;
    const archive    = statData.Multiverse?.Archives?.[worldKey];
    const timeFlow   = archive?.TimeFlow || null;
    statData.CharacterSheet.WorldContext = {
      WorldName:         worldKey,
      Name:              identity.name              || null,
      Title:             identity.title             || null,
      Occupation:        identity.occupation        || null,
      Background:        identity.background        || '',
      CoreMemories:      Array.isArray(identity.coreMemories)      ? identity.coreMemories      : [],
      SocialConnections: Array.isArray(identity.socialConnections) ? identity.socialConnections : [],
      TimeFlow:          timeFlow,
    };
  } catch (_) {
    // Best-effort
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Process all <UpdateVariable> blocks in text, mutating statData in place.
 * @param {string} text - raw text containing <UpdateVariable> blocks
 * @param {object} statData - mutable state object
 * @param {object} [vars] - template variable substitutions, e.g. { userName, charName }
 * Returns the number of blocks processed.
 */
function processUpdateVariables(text, statData, vars) {
  const prevWorld = _currentWorldKey(statData);
  const blocks = extractUpdateVariableBlocks(text);
  if (blocks.length > 0) {
    log.debug(`UpdateVar: found ${blocks.length} block(s), executing…`);
  }
  for (const b of blocks) {
    try {
      executeBlock(b, statData, vars);
    } catch (err) {
      log.error('UpdateVar: executeBlock threw unexpectedly', err);
    }
  }
  runAutoCalc(statData);
  // Sync world identity if world changed
  const newWorld = _currentWorldKey(statData);
  if (newWorld && newWorld !== prevWorld) {
    syncWorldIdentity(statData, newWorld);
  }
  return blocks.length;
}

/**
 * Build a filtered stat_data snapshot for the current world only
 * (mirrors the EJS Context Filter in world book entry 2).
 */
/**
 * StarMedals may be keyed as "1", "2" (numeric) or "1星", "2星" (from LLM).
 * Read count for a given star level (tries both key forms).
 */
function getMedalCount(medalsObj, stars) {
  if (!medalsObj || typeof medalsObj !== 'object') return 0;
  const s = String(stars);
  return Number(medalsObj[s]) || Number(medalsObj[s + '星']) || 0;
}

/**
 * Set medal count for a star level; normalizes to numeric key and removes "N星" to avoid duplicate.
 */
function setMedalCount(medalsObj, stars, count) {
  if (!medalsObj || typeof medalsObj !== 'object') return;
  const s = String(stars);
  medalsObj[s] = count;
  if (medalsObj[s + '星'] !== undefined) delete medalsObj[s + '星'];
}

function buildStatSnapshot(statData) {
  try {
    const rawKey = Array.isArray(statData?.Multiverse?.CurrentWorldName)
      ? statData.Multiverse.CurrentWorldName[0]
      : statData?.Multiverse?.CurrentWorldName;

    // rawKey may be a single string or an array of strings (ActiveWorlds)
    const activeKeys = Array.isArray(rawKey) ? rawKey : (rawKey ? [rawKey] : []);

    // Build Archives snapshot: include all active worlds
    const archivesSnap = {};
    for (const k of activeKeys) {
      archivesSnap[k] = statData.Multiverse?.Archives?.[k] || 'Data not initialized yet.';
    }

    return {
      CharacterSheet: statData.CharacterSheet,
      CompanionRoster: statData.CompanionRoster,
      Templates: statData.Templates,
      Arsenal: statData.Arsenal,
      Multiverse: {
        CurrentWorldName: statData.Multiverse?.CurrentWorldName,
        Archives: Object.keys(archivesSnap).length ? archivesSnap : statData.Multiverse?.Archives,
      },
    };
  } catch (_) {
    return statData;
  }
}

/**
 * Render the "Backend Data Stream" (world book entry 1) using plain JS
 * instead of EJS — produces the same structured status block.
 */
function renderBackendDataStream(statData) {
  try {
    const raw = statData || {};
    const sheet = raw.CharacterSheet || {};
    const multi = raw.Multiverse || {};
    const user = sheet.UserPanel || {};
    const core = sheet.CoreSystem || {};
    const dynamic = sheet.DynamicStatus || {};
    const loadout = sheet.Loadout || {};

    const curKey = Array.isArray(multi.CurrentWorldName)
      ? multi.CurrentWorldName[0]
      : (multi.CurrentWorldName || 'Unknown');
    const worldData = multi.Archives?.[curKey] || {};

    const gv = (obj, def = 'N/A') =>
      Array.isArray(obj) ? obj[0] : (obj != null ? obj : def);

    const fmtSocial = (sw) => {
      if (!sw || typeof sw !== 'object') return 'None yet';
      const keys = Object.keys(sw).filter((k) => !k.startsWith('$'));
      return keys.length
        ? keys.map((k) => `${k} [${gv(sw[k])}]`).join(', ')
        : 'None yet';
    };

    const fmtList = (arr) =>
      Array.isArray(arr)
        ? arr.filter((x) => x && !String(x).startsWith('$__META')).join('; ')
        : 'Standard Physics';

    const attrs = core.Attributes || {};
    const pools = Array.isArray(dynamic.EnergyPools)
      ? dynamic.EnergyPools.filter((p) => p && !String(p).startsWith('$__META'))
      : [];
    const techs = Array.isArray(loadout.ApplicationTechniques)
      ? loadout.ApplicationTechniques.filter((t) => t && typeof t === 'object' && t.Name)
      : [];
    const equipped = Array.isArray(loadout.Inventory?.Equipped)
      ? loadout.Inventory.Equipped.filter((i) => i && typeof i === 'object' && i.ItemName)
      : [];
    const milestones = Array.isArray(sheet.AchievementSystem?.Milestones)
      ? sheet.AchievementSystem.Milestones.filter((m) => m && !String(m).startsWith('$'))
      : [];
    const worldLog = Array.isArray(worldData.Log)
      ? worldData.Log.filter((e) => e && !String(e).startsWith('$'))
      : [];

    let out = `[Backend Data Stream - Invisible to Character]
⚠️ **NARRATION ENFORCEMENT**: Translate stats into sensory experience only.
⚠️ **WORLD RULES ENFORCEMENT**: WorldRules are objective laws of the world — the character does NOT know their names or that they are "rules". Never name them, quote them, or have the character reflect on them as rules. Express their effects only through physical sensation, instinct, or observed consequence.
---
### 0. WORLD CONTEXT: ${gv(worldData.WorldName) || curKey}
*  **Space-Time**: ${gv(worldData.Time?.Date)} @ ${gv(worldData.Time?.Clock)} | Loc: **${gv(worldData.Location)}**
*  **Relations**: ${fmtSocial(worldData.SocialWeb)}
*  **Local Laws (world physics only — character is unaware of these as named rules)**: ${fmtList(worldData.WorldRules)}

### 1. CHARACTER STATE
*  **HP**: ${gv(dynamic.HP?.Value)}/${gv(dynamic.HP?.MaxValue)}`;

    for (const p of pools) {
      out += `\n*  **${gv(p.Name)}**: ${gv(p.Value)}/${gv(p.MaxValue)}`;
    }
    out += `\n*  **Form**: ${gv(dynamic.CurrentForm?.Name)}`;

    const activeEffects = Array.isArray(dynamic.ActiveEffects)
      ? dynamic.ActiveEffects
          .filter((e) => e && typeof e === 'object')
          .map((e) => gv(e.Name))
          .join(', ')
      : 'None';
    out += `\n*  **Buffs**: ${activeEffects || 'None'}`;
    out += `\n*  **Attrs**: STR:${gv(attrs.STR)} AGI:${gv(attrs.AGI)} MEN:${gv(attrs.MEN)}`;

    out += '\n\n### 2. INTERNALIZED KNOWLEDGE';
    if (techs.length) {
      for (const t of techs) {
        out += `\n*  **${gv(t.Name)}**: ${gv(t.Description)}`;
      }
    } else {
      out += '\n  (No Active Techniques)';
    }

    out += '\n\n### 3. PHYSICAL INVENTORY';
    if (equipped.length) {
      for (const item of equipped) {
        out += `\n*  Holding/Wearing: **${gv(item.ItemName)}**`;
      }
    } else {
      out += '\n  (Empty hands)';
    }

    out += `\n\n### 4. ACTIVE MILESTONES\n*  **Recent**: ${milestones.slice(-1)[0] || 'Survival Start'}`;

    // World event log — last 5 entries, with write-path hint for LLM
    out += `\n\n### 5. WORLD EVENT LOG (path: Multiverse.Archives.${curKey}.Log)`;
    if (worldLog.length) {
      worldLog.slice(-5).forEach((e) => { out += `\n*  ${e}`; });
    } else {
      out += '\n*  (No events recorded yet)';
    }

    // World time flow
    const curArchive = statData.Multiverse?.Archives?.[curKey];
    if (curArchive?.TimeFlow || curArchive?.Time?.FlowRate) {
      const tf = curArchive.TimeFlow;
      const flowLabel = tf
        ? (tf.type === 'frozen'         ? `冻结（离开期间内部时间静止）`
         : tf.type === 'fixed_interval' ? `固定跳跃 ${tf.fixedJump || '?'}/次进入`
         : tf.type === 'hybrid'         ? (tf.description || '复合时间规则')
         : (() => {
             const r = tf.ratioToBase || '1:1';
             const parts = r.split(':').map(s => s.trim());
             if (parts.length === 2 && parts[0] !== parts[1]) {
               return `${r}（基准${parts[0]}天 = 此世界${parts[1]}天）`;
             }
             return `${r}（与基准世界同步）`;
           })())
        : (curArchive.Time?.FlowRate?.[0] || '1:1');
      out += `\n\n### 6. TIME FLOW (时间流速)`;
      out += `\n*  **FlowRate**: ${flowLabel}`;
      if (tf?.description) out += `\n*  **说明**: ${tf.description}`;
      if (tf?.notes) out += `\n*  **附注**: ${tf.notes}`;
    }

    // World identity — character's persona in the current world
    const wctx = sheet.WorldContext;
    if (wctx && wctx.WorldName === curKey) {
      out += `\n\n### 7. WORLD IDENTITY (在地身份)`;
      if (wctx.Name)       out += `\n*  **Name**: ${wctx.Name}`;
      if (wctx.Title)      out += `\n*  **Title**: ${wctx.Title}`;
      if (wctx.Occupation) out += `\n*  **Role**: ${wctx.Occupation}`;
      if (wctx.Background) out += `\n*  **Background**: ${wctx.Background}`;
      if (wctx.CoreMemories?.length) {
        out += `\n*  **Core Memories**:`;
        wctx.CoreMemories.forEach((m) => { out += `\n    - ${m}`; });
      }
      if (wctx.SocialConnections?.length) {
        out += `\n*  **Connections (World)**: ` + wctx.SocialConnections.map(c => `${c.name}(${c.relation})`).join(', ');
      }
    }

    // § 8: PERSONALITY FULL SNAPSHOT
    const pers  = sheet?.UserPanel?.Personality;
    const emoSt = dynamic?.EmotionalState;
    const rels  = Array.isArray(statData?.SocialWeb?.Relationships)
      ? statData.SocialWeb.Relationships.filter(r => r && (r.Name || r.name))
      : [];

    if (pers || emoSt || rels.length) {
      out += '\n\n### 8. PERSONALITY FULL SNAPSHOT';

      // EmotionalState — highest priority, affects THIS turn
      if (emoSt) {
        const baseline = Array.isArray(emoSt.Baseline) ? emoSt.Baseline[0] : (emoSt.Baseline ?? 0);
        out += `\n*  **Mood Baseline**: ${baseline > 0 ? '+' : ''}${baseline}/10`;
        if (Array.isArray(emoSt.ActiveEmotions) && emoSt.ActiveEmotions.length) {
          out += '\n*  **Active Emotions**: ' + emoSt.ActiveEmotions
            .map(e => `${e.emotion}(${e.intensity}/10, trigger:"${e.trigger}", decay:${e.decay || '?'})`).join(' | ');
        }
        if (Array.isArray(emoSt.RecentMoodShifts) && emoSt.RecentMoodShifts.length) {
          out += '\n*  **Recent Shifts**: ' + emoSt.RecentMoodShifts.slice(-3).join('; ');
        }
      }

      // Dimensions — all 18 axes
      if (pers?.Dimensions) {
        const fmtAxis = (v) => {
          const n = Array.isArray(v) ? v[0] : v;
          return (n > 0 ? '+' : '') + n;
        };
        const fmtCat = (catObj) => Object.entries(catObj || {})
          .map(([k, v]) => `${k}:${fmtAxis(v)}`).join(' ');
        out += `\n*  **[Social]**: ${fmtCat(pers.Dimensions.Social)}`;
        out += `\n*  **[Emotional]**: ${fmtCat(pers.Dimensions.Emotional)}`;
        out += `\n*  **[Cognitive]**: ${fmtCat(pers.Dimensions.Cognitive)}`;
        out += `\n*  **[Values]**: ${fmtCat(pers.Dimensions.Values)}`;
      }

      // ContextModes — behavior shifts in specific situations
      if (pers?.ContextModes && typeof pers.ContextModes === 'object') {
        const modes = Object.entries(pers.ContextModes);
        if (modes.length) {
          out += '\n*  **Context Modes**:';
          modes.forEach(([ctx, v]) => {
            const modsStr = v.mods
              ? Object.entries(v.mods).map(([k, n]) => `${k}${n >= 0 ? '+' : ''}${n}`).join(',')
              : '';
            out += `\n    - [${ctx}] ${v.note || ''}${modsStr ? ` (mods: ${modsStr})` : ''}`;
          });
        }
      }

      // TriggerPatterns — all triggers
      if (Array.isArray(pers?.TriggerPatterns) && pers.TriggerPatterns.length) {
        out += '\n*  **Trigger Patterns**:';
        pers.TriggerPatterns.forEach(t => {
          out += `\n    - (${t.intensity}/10) IF "${t.trigger}" → "${t.reaction}"`;
        });
      }

      // Relationships — name + affect + dynamics + recent history
      if (rels.length) {
        out += '\n*  **Relationships**:';
        rels.forEach(r => {
          const name       = Array.isArray(r.Name)   ? r.Name[0]   : (r.name   || '?');
          const famil      = Array.isArray(r.Familiarity) ? r.Familiarity[0] : (r.Familiarity ?? 0);
          const trust      = Array.isArray(r.Trust)  ? r.Trust[0]  : (r.Trust  ?? 0);
          const affect     = Array.isArray(r.Affect) ? r.Affect[0] : (r.Affect ?? 0);
          const dynamics   = r.Dynamics || '';
          const history    = Array.isArray(r.RecentHistory) && r.RecentHistory.length
            ? ` | recent: "${r.RecentHistory.slice(-1)[0]}"` : '';
          out += `\n    - ${name} [famil:${famil} trust:${trust} affect:${affect > 0 ? '+' : ''}${affect}] "${dynamics}"${history}`;
        });
      }
    }

    out += '\n---\n[End of Backend Data]';
    return out;
  } catch (_) {
    return '[Backend Data Stream — Error rendering state]';
  }
}

// ─── World Time Propagation ───────────────────────────────────────────────────

/**
 * Parse a TimeFlow object into a world/base seconds multiplier.
 * Format: ratioToBase = "BASE:WORLD" (e.g. "1:3" means 1 base sec = 3 world secs)
 */
function parseFlowRate(timeFlow) {
  if (!timeFlow || timeFlow.type === 'frozen') return 1;
  const parts = (timeFlow.ratioToBase || '1:1').split(':').map(parseFloat);
  if (parts.length === 2 && parts[0] > 0) return parts[1] / parts[0];
  return 1;
}

/**
 * Convert total seconds to HH:MM:SS string (wraps at 24h).
 */
function formatHHMMSS(totalSeconds) {
  const s = Math.abs(Math.round(totalSeconds)) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Called after processUpdateVariables in gameLoop FINALIZE.
 * Reads Multiverse.CurrentWorldElapsedSeconds (written by Phase 4 LLM),
 * updates the current world's TotalSeconds/Clock, calculates base elapsed,
 * and propagates to all other worlds proportionally.
 * Also clears the JustEntered flag after first-turn date sync.
 */
function propagateWorldTime(statData) {
  const mv = statData?.Multiverse;
  if (!mv || !mv.Archives) return;

  const elapsed = mv.CurrentWorldElapsedSeconds;
  if (!elapsed || elapsed <= 0) {
    // Still clear JustEntered even if no elapsed seconds reported
    const curKey = Array.isArray(mv.CurrentWorldName) ? mv.CurrentWorldName[0] : mv.CurrentWorldName;
    const cur = curKey && mv.Archives[curKey];
    if (cur?.Time?.JustEntered) delete cur.Time.JustEntered;
    return;
  }

  delete mv.CurrentWorldElapsedSeconds;

  const curKey = Array.isArray(mv.CurrentWorldName) ? mv.CurrentWorldName[0] : mv.CurrentWorldName;
  const cur    = curKey && mv.Archives[curKey];
  if (!cur) return;

  // Update current world
  if (!cur.Time) cur.Time = {};
  cur.Time.TotalSeconds = (cur.Time.TotalSeconds || 0) + elapsed;
  cur.Time.Clock = [formatHHMMSS(cur.Time.TotalSeconds), 'Time'];
  if (cur.Time.JustEntered) delete cur.Time.JustEntered;

  // Calculate base elapsed and update baseline
  const curRate     = parseFlowRate(cur.TimeFlow);
  const baseElapsed = elapsed / curRate;
  mv.BaselineSeconds = (mv.BaselineSeconds || 0) + baseElapsed;

  // Propagate to all other worlds
  for (const [name, arc] of Object.entries(mv.Archives)) {
    if (name === curKey || !arc?.Time) continue;
    const tf = arc.TimeFlow;
    if (!tf || tf.type === 'frozen' || tf.type === 'fixed_interval') continue;
    const worldElapsed = baseElapsed * parseFlowRate(tf);
    arc.Time.TotalSeconds = (arc.Time.TotalSeconds || 0) + worldElapsed;
    arc.Time.Clock = [formatHHMMSS(arc.Time.TotalSeconds), 'Time'];
  }
}

module.exports = {
  parsePath,
  getAtPath,
  setAtPath,
  createEngine,
  extractUpdateVariableBlocks,
  executeBlock,
  runAutoCalc,
  processUpdateVariables,
  syncWorldIdentity,
  buildStatSnapshot,
  renderBackendDataStream,
  getMedalCount,
  setMedalCount,
  parseFlowRate,
  formatHHMMSS,
  propagateWorldTime,
};
