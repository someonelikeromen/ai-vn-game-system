'use strict';
/**
 * Gacha Engine — pool definitions, draw logic, and ownership checks
 * for the shop gacha system.
 *
 * Pools are aligned 1-to-1 with world anchor tierRanges.
 */

// ─── Pool Definitions ─────────────────────────────────────────────────────────

/**
 * Cost medal format: { stars: N, count: M } — matches shop item requiredMedals.
 * tenDrawDiscount: for points-only pools, apply 0.9× on 10-draw.
 */
const GACHA_POOLS = {
  low: {
    id:              'low',
    name:            '低危召唤',
    tierRange:       [0, 2],
    costPoints:      100,
    costMedals:      [],
    tenDrawDiscount: 0.9,
    pityHard:        100,
    pityTier:        2,
    tenPityTier:     1,
    tierWeights:     { 0: 45, 1: 35, 2: 20 },
    label:           '低危区 (0–2★)',
  },
  mid: {
    id:              'mid',
    name:            '中危召唤',
    tierRange:       [2, 5],
    costPoints:      300,
    costMedals:      [{ stars: 2, count: 1 }],
    tenDrawDiscount: 1,
    pityHard:        100,
    pityTier:        4,
    tenPityTier:     3,
    tierWeights:     { 2: 40, 3: 30, 4: 20, 5: 10 },
    label:           '中危区 (2–5★)',
  },
  high: {
    id:              'high',
    name:            '高危召唤',
    tierRange:       [5, 8],
    costPoints:      500,
    costMedals:      [{ stars: 5, count: 1 }],
    tenDrawDiscount: 1,
    pityHard:        100,
    pityTier:        7,
    tenPityTier:     6,
    tierWeights:     { 5: 40, 6: 30, 7: 20, 8: 10 },
    label:           '高危区 (5–8★)',
  },
  stellar: {
    id:              'stellar',
    name:            '行星召唤',
    tierRange:       [8, 10],
    costPoints:      1000,
    costMedals:      [{ stars: 8, count: 1 }],
    tenDrawDiscount: 1,
    pityHard:        100,
    pityTier:        9,
    tenPityTier:     8,
    tierWeights:     { 8: 50, 9: 35, 10: 15 },
    label:           '行星/恒星区 (8–10★)',
  },
  galactic: {
    id:              'galactic',
    name:            '星系召唤',
    tierRange:       [10, 13],
    costPoints:      2000,
    costMedals:      [{ stars: 10, count: 1 }],
    tenDrawDiscount: 1,
    pityHard:        100,
    pityTier:        12,
    tenPityTier:     11,
    tierWeights:     { 10: 40, 11: 30, 12: 20, 13: 10 },
    label:           '星系/宇宙区 (10–13★)',
  },
  beyond: {
    id:              'beyond',
    name:            '超限召唤',
    tierRange:       [13, 16],
    costPoints:      5000,
    costMedals:      [{ stars: 13, count: 1 }],
    tenDrawDiscount: 1,
    pityHard:        100,
    pityTier:        15,
    tenPityTier:     14,
    tierWeights:     { 13: 40, 14: 30, 15: 20, 16: 9, 17: 1 },
    label:           '超限区 (13–16★)',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Weighted random roll: returns a tier number from the weights map.
 * weights: { tierNum: weight, ... }
 */
function rollTier(weights) {
  const entries = Object.entries(weights).map(([k, w]) => ({ tier: Number(k), w: Number(w) }));
  const total = entries.reduce((s, e) => s + e.w, 0);
  let rand = Math.random() * total;
  for (const e of entries) {
    rand -= e.w;
    if (rand <= 0) return e.tier;
  }
  return entries[entries.length - 1].tier;
}

// ─── Ownership Check ──────────────────────────────────────────────────────────

/**
 * Check whether an item (by name) is already present in the session's stat data.
 * Searches across all major loadout / inventory sections, ShopInventory, and GachaPending
 * (items drawn but not yet applied also count as "owned" to prevent duplicate draws).
 */
function checkOwned(itemName, statData) {
  if (!statData || !itemName) return false;
  const nameLC = itemName.toLowerCase().trim();

  const extract = (v) => {
    if (Array.isArray(v)) return String(v[0] || '').toLowerCase().trim();
    return String(v || '').toLowerCase().trim();
  };

  const cs = statData.CharacterSheet;
  if (!cs) return false;

  const lo = cs.Loadout || {};

  // Check ShopInventory (previously redeemed items)
  for (const rec of cs.ShopInventory || []) {
    if (rec && String(rec.name || '').toLowerCase().trim() === nameLC) return true;
  }

  const sections = [
    ...(lo.PassiveAbilities         || []),
    ...(lo.ApplicationTechniques    || []),
    ...(lo.PowerSources             || []),
    ...((lo.Inventory?.Equipped)    || []),
    ...(lo.MechanizedUnits          || []),
    ...((cs.KnowledgeBase?.Database?.RootNodes) || []),
  ];

  for (const s of sections) {
    if (!s || typeof s !== 'object') continue;
    for (const key of ['Name', 'ItemName', 'UnitName', 'Topic', 'name']) {
      const n = extract(s[key]);
      if (n && n === nameLC) return true;
    }
  }

  // Check companions (object map or array)
  const companions = statData.CompanionRoster?.ActiveCompanions;
  const compArr = Array.isArray(companions)
    ? companions
    : Object.values(companions || {});
  for (const c of compArr) {
    if (!c || typeof c !== 'object') continue;
    const n = extract(c.UserPanel?.Name || c.Name || '');
    if (n && n === nameLC) return true;
  }

  // Check GachaPending — items drawn but not yet applied also count as owned
  // (prevents duplicate draws from the same pool when the pool has few items)
  for (const pending of statData.Arsenal?.GachaPending || []) {
    if (pending?.item && String(pending.item.name || '').toLowerCase().trim() === nameLC) return true;
  }

  return false;
}

// ─── Cost Helpers ─────────────────────────────────────────────────────────────

/**
 * Compute the total cost for a draw (single or ten).
 * Returns { points, medals: [{stars, count}] }
 */
function computeCost(pool, drawCount) {
  const isTen = drawCount === 10;
  const discount = isTen ? (pool.tenDrawDiscount ?? 1) : 1;
  const points = Math.floor(pool.costPoints * drawCount * discount);
  const medals = (pool.costMedals || []).map(m => ({
    stars: m.stars,
    count: m.count * drawCount,
  }));
  return { points, medals };
}

/**
 * Per-draw cost fraction (for single-item refunds within a batch).
 */
function computePerDrawCost(pool, totalDrawCount) {
  const { points, medals } = computeCost(pool, totalDrawCount);
  return {
    points: points / totalDrawCount,
    medals: medals.map(m => ({ stars: m.stars, count: m.count / totalDrawCount })),
  };
}

// ─── Single Draw Execution ────────────────────────────────────────────────────

function executeSingleDraw(pool, poolItems, state, isTenPityGuarantee) {
  if (poolItems.length === 0) {
    throw new Error(`${pool.name}池子为空，请等待物品补充后重试`);
  }

  let effectiveWeights = { ...pool.tierWeights };

  // Hard pity: force tier >= pityTier
  if (state.sinceLastPity + 1 >= pool.pityHard) {
    for (const k of Object.keys(effectiveWeights)) {
      if (Number(k) < pool.pityTier) delete effectiveWeights[k];
    }
  }

  // Ten-draw pity guarantee
  if (isTenPityGuarantee) {
    for (const k of Object.keys(effectiveWeights)) {
      if (Number(k) < pool.tenPityTier) delete effectiveWeights[k];
    }
  }

  // Ensure there are still weights
  if (Object.keys(effectiveWeights).length === 0) {
    effectiveWeights = { [pool.pityTier]: 1 };
  }

  let rolledTier = rollTier(effectiveWeights);
  let candidates = poolItems.filter(i => i.tier === rolledTier);

  // Fallback: find nearest tier with items
  if (candidates.length === 0) {
    const availableTiers = [...new Set(poolItems.map(i => i.tier))].sort((a, b) => a - b);
    const nearest = availableTiers.reduce((prev, curr) =>
      Math.abs(curr - rolledTier) < Math.abs(prev - rolledTier) ? curr : prev
    );
    candidates = poolItems.filter(i => i.tier === nearest);
    rolledTier = nearest;
  }

  const item = candidates[Math.floor(Math.random() * candidates.length)];
  return { item, tier: rolledTier };
}

// ─── Main Draw Function ───────────────────────────────────────────────────────

/**
 * Execute `count` draws from the given pool.
 * Mutates sess.statData.Arsenal.GachaState pity counters in-place.
 * Returns array of draw result objects (NOT yet added to GachaPending — caller does that).
 *
 * @param {object} sess     - session object
 * @param {Array}  allItems - all shop-items (already expanded with new LLM items)
 * @param {string} poolId   - pool identifier
 * @param {number} count    - 1 or 10
 * @returns {Array<{pendingId, drawnAt, poolId, tier, item, owned}>}
 */
function drawFromPool(sess, allItems, poolId, count) {
  const pool = GACHA_POOLS[poolId];
  if (!pool) throw new Error(`未知抽卡池: ${poolId}`);

  const [minTier, maxTier] = pool.tierRange;
  const poolItems = allItems.filter(
    i => !i.baseAnchor && typeof i.tier === 'number' && i.tier >= minTier && i.tier <= maxTier
  );

  // Initialise Arsenal / GachaState
  if (!sess.statData.Arsenal)               sess.statData.Arsenal = {};
  if (!sess.statData.Arsenal.GachaState)    sess.statData.Arsenal.GachaState = {};
  if (!Array.isArray(sess.statData.Arsenal.GachaPending)) sess.statData.Arsenal.GachaPending = [];

  const gachaState = sess.statData.Arsenal.GachaState;
  if (!gachaState[poolId]) gachaState[poolId] = { totalDraws: 0, sinceLastPity: 0 };

  const isBatch = count === 10;
  let batchHasTenPity = false;
  const results = [];

  // Track names drawn in THIS batch to catch intra-batch duplicates for refund
  const drawnNamesThisBatch = new Set();

  for (let i = 0; i < count; i++) {
    const isLastOfTen = isBatch && i === count - 1;
    const forceTenPity = isLastOfTen && !batchHasTenPity;

    const state = gachaState[poolId];
    const { item, tier } = executeSingleDraw(pool, poolItems, state, forceTenPity);

    if (tier >= pool.tenPityTier) batchHasTenPity = true;

    // Update pity counters
    state.totalDraws++;
    if (tier >= pool.pityTier) {
      state.sinceLastPity = 0;
    } else {
      state.sinceLastPity++;
    }

    // owned = already in loadout/pending (from statData) OR drawn earlier in this batch
    const nameLC = String(item.name || '').toLowerCase().trim();
    const owned = checkOwned(item.name, sess.statData) || drawnNamesThisBatch.has(nameLC);

    // Only mark as pending (non-duplicate) names for intra-batch tracking
    if (!owned) drawnNamesThisBatch.add(nameLC);

    results.push({
      pendingId: uuid(),
      drawnAt:   new Date().toISOString(),
      poolId,
      tier,
      item,
      owned,
    });
  }

  return results;
}

// ─── Pool Info ────────────────────────────────────────────────────────────────

/**
 * Returns enriched pool info array including live item counts and pity state.
 */
function getPoolsInfo(allItems, gachaState) {
  return Object.values(GACHA_POOLS).map(pool => {
    const [minTier, maxTier] = pool.tierRange;
    const poolItems = allItems.filter(
      i => !i.baseAnchor && typeof i.tier === 'number' && i.tier >= minTier && i.tier <= maxTier
    );
    const tierCounts = {};
    for (const item of poolItems) {
      tierCounts[item.tier] = (tierCounts[item.tier] || 0) + 1;
    }
    const state = gachaState?.[pool.id] || { totalDraws: 0, sinceLastPity: 0 };
    return {
      ...pool,
      itemCount:    poolItems.length,
      tierCounts,
      state,
      pityProgress: state.sinceLastPity,
    };
  });
}

module.exports = { GACHA_POOLS, drawFromPool, getPoolsInfo, checkOwned, computeCost, computePerDrawCost };
