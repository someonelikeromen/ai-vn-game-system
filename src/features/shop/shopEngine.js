'use strict';
/**
 * Shop Engine — generates exchange items via LLM evaluation and
 * applies their effects to session stat data on redemption.
 */

const { processUpdateVariables, parsePath, getAtPath, setAtPath, getMedalCount, setMedalCount } = require('../../engine/varEngine');

// ─── Response Parser ──────────────────────────────────────────────────────────

function parseGenerationResponse(text) {
  // Try ```json ... ``` block first
  const jsonBlock = text.match(/```json\s*([\s\S]*?)\s*```/i);
  if (jsonBlock) {
    return JSON.parse(jsonBlock[1]);
  }
  // Fallback: find outermost { ... } containing "tier"
  const raw = text.match(/\{[\s\S]*"tier"[\s\S]*\}/);
  if (raw) {
    return JSON.parse(raw[0]);
  }
  throw new Error('AI 响应中未找到 JSON 数据');
}

/**
 * Parse a batch generation response (gacha pool replenishment).
 * Strips <think>...</think> blocks first, then expects a JSON array.
 * Falls back to single-item parse. Returns array (may be shorter than requested).
 */
function parseGachaBatchResponse(text) {
  // Strip <think>...</think> reasoning blocks
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // Try ```json [...] ``` block
  const arrayBlock = stripped.match(/```json\s*(\[[\s\S]*?\])\s*```/i);
  if (arrayBlock) {
    try {
      const arr = JSON.parse(arrayBlock[1]);
      if (Array.isArray(arr)) return arr;
    } catch (_) {}
  }

  // Try bare JSON array (with "tier" field to confirm it's item data)
  const arrMatch = stripped.match(/\[[\s\S]*?"tier"[\s\S]*?\]/);
  if (arrMatch) {
    try {
      const arr = JSON.parse(arrMatch[0]);
      if (Array.isArray(arr)) return arr;
    } catch (_) {}
  }

  // Fallback: single object (also strip think blocks)
  try {
    return [parseGenerationResponse(stripped)];
  } catch (_) {
    return [];
  }
}

// ─── Apply-Command Builder ────────────────────────────────────────────────────

/**
 * Converts an item's `effects` object into JS commands compatible with varEngine.
 * Returns a JS code string to be wrapped in <UpdateVariable>...</UpdateVariable>.
 */
function buildApplyScript(item) {
  const lines = [];
  const { effects } = item;
  if (!effects) return '';

  // 1. Attribute deltas — only apply to MAIN character for non-Companion/Mech items.
  // Companion stats live inside the companion object; Mech stats live inside the mech.
  const isCharacterItem = item.type !== 'Companion' && item.type !== 'Mech';
  if (isCharacterItem) {
    const attrs = effects.attributeDeltas || {};
    for (const [attr, delta] of Object.entries(attrs)) {
      if (delta && delta !== 0) {
        lines.push(`_.add('CharacterSheet.CoreSystem.Attributes.${attr}[0]', ${Number(delta)});`);
      }
    }
  }

  // 2. New energy pools
  for (const pool of effects.newEnergyPools || []) {
    const obj = {
      Name:     [pool.name || '能量', 'Pool'],
      Value:    [pool.value  || 100,   'Current'],
      MaxValue: [pool.max    || 100,   'Max'],
    };
    if (pool.description) obj.Description = [pool.description, 'Desc'];
    lines.push(`_.insert('CharacterSheet.DynamicStatus.EnergyPools', ${JSON.stringify(obj)});`);
  }

  // 3. Passive abilities → Loadout.PassiveAbilities
  for (const ab of effects.passiveAbilities || []) {
    const obj = {
      Name:        [ab.name || '未知能力',     'Ability'],
      Type:        [ab.type || 'Passive',       'Type'],
      Description: [ab.description || '',       'Desc'],
    };
    if (ab.specs) obj.Specs = ab.specs;
    lines.push(`_.insert('CharacterSheet.Loadout.PassiveAbilities', ${JSON.stringify(obj)});`);
  }

  // 4. Power sources → Loadout.PowerSources
  for (const ps of effects.powerSources || []) {
    const obj = {
      Name:        [ps.name || '未知基盘', 'System'],
      Type:        [ps.type || 'PowerSource', 'Type'],
      Description: [ps.description || '', 'Desc'],
      Aptitude:    { Grade: [ps.aptitude || 'B', 'Grade'] },
      Cultivation: {
        Realm:    [ps.initialRealm || '初入门', 'Stage'],
        Progress: { Level: ['0', '%'] },
      },
    };
    if (ps.generatedPool) {
      obj.GeneratedPool = {
        PoolName: [ps.generatedPool.name || '能量', 'Energy'],
        MaxValue: [ps.generatedPool.max  || 1000,   'Max'],
        Regen:    [ps.generatedPool.regen || '10/min', 'Rate'],
      };
      // Auto-create the energy pool too
      const poolObj = {
        Name:     [ps.generatedPool.name || '能量', 'Pool'],
        Value:    [0, 'Current'],
        MaxValue: [ps.generatedPool.max || 1000, 'Max'],
      };
      lines.push(`_.insert('CharacterSheet.DynamicStatus.EnergyPools', ${JSON.stringify(poolObj)});`);
    }
    lines.push(`_.insert('CharacterSheet.Loadout.PowerSources', ${JSON.stringify(obj)});`);
  }

  // 5. Application techniques → Loadout.ApplicationTechniques (School→SubMoves)
  for (const tech of effects.applicationTechniques || []) {
    const isRich = tech.SubMoves || (tech.Name && Array.isArray(tech.Name));
    if (isRich) {
      lines.push(`_.insert('CharacterSheet.Loadout.ApplicationTechniques', ${JSON.stringify(tech)});`);
    } else {
      const schoolName = tech.schoolName || tech.name || '未知技法';

      // Build SubMoves — either from subTechniques array (school format) or single entry
      const subMovesObj = {};
      const rawSubs = Array.isArray(tech.subTechniques) && tech.subTechniques.length > 0
        ? tech.subTechniques
        : [{ name: tech.subMoveName || tech.name || schoolName, desc: tech.description || '', costInitial: tech.cost || tech.costInitial, castTime: tech.castTime, cooldown: tech.cooldown, hasRisk: false, riskDesc: '', tier: tech.tier || 0, stance: '', chant: '', visualFX: '' }];

      for (const sub of rawSubs) {
        const moveName = sub.name || sub.subMoveName || schoolName;
        subMovesObj[moveName] = {
          '$ref': 'Templates.SubMoveEntry',
          Name:        [moveName, '招式名'],
          Description: [sub.desc || sub.description || '', '效果描述'],
          Proficiency: { Level: [sub.proficiencyLevel || '入门', 'Lv'], Rank: [1, 'Rank'] },
          Mechanics: {
            Cost: {
              Initial:     [sub.costInitial || sub.cost || '无消耗', '启动消耗'],
              Maintenance: [sub.costMaintenance || '无', '维持消耗'],
              Material:    ['', '耗材'],
            },
            Timing: {
              CastTime: [sub.castTime || 'Instant', '准备时间'],
              CoolDown: [sub.cooldown || '无', '冷却时间'],
              Duration: ['Instant', '持续时间'],
            },
            ActivationManifestation: {
              Stance: [sub.stance || '', '发动姿势'], Chant: [sub.chant || '', '咏唱'],
              VisualFX: [sub.visualFX || '', '光效'], SoundFX: ['', '音效'], Morph: ['', '形态变化'],
            },
            RiskProfile: { HasSafeLimit: [!!sub.hasRisk, '反噬风险'], Backlash: { Trigger: ['', '触发条件'], EffectDescription: [sub.riskDesc || '', '后果'] } },
          },
          Specs: { Tier: [sub.tier ?? tech.tier ?? 0, '★'], Equivalence: { Offense: [0, '攻击'], Defense: [0, '防御'], Speed: [0, '机动'] }, Resistances: { Physical: [1.0, '抗性'] } },
        };
      }

      const obj = {
        '$ref': 'Templates.ApplicationTechnique',
        Name:         [schoolName, '技艺名称'],
        School:       [tech.school || schoolName, '所属流派'],
        Type:         [tech.type || 'Active', '类型'],
        Description:  [tech.description || '', '流派描述'],
        ParentSource: [tech.parentSource || '', '驱动基盘'],
        Proficiency:  { Level: ['入门', 'Lv'], Rank: [1, 'Rank'] },
        SubMoves:     subMovesObj,
        Mechanics: {
          State: { CurrentStatus: ['Ready', '状态'], Timers: { DurationRemaining: [0, 's'], CooldownRemaining: [0, 's'] } },
          Cost: { Initial: ['—', '启动消耗'], Maintenance: ['—', '维持消耗'], Material: ['', '耗材'] },
          Timing: { CastTime: ['—', '准备时间'], CoolDown: ['—', '冷却时间'], Duration: ['—', '持续时间'] },
          RiskProfile: { HasSafeLimit: [false, '反噬风险'], Backlash: { Trigger: ['', '触发条件'], EffectDescription: ['', '后果'] } },
        },
        Specs: { Tier: [tech.tier || 0, '★'], Equivalence: { Offense: [0, '攻击'], Defense: [0, '防御'], Speed: [0, '机动'] }, Resistances: { Physical: [1.0, '抗性'] } },
      };
      lines.push(`_.insert('CharacterSheet.Loadout.ApplicationTechniques', ${JSON.stringify(obj)});`);
    }
  }

  // 6. Inventory items → Loadout.Inventory.Equipped
  for (const itm of effects.inventoryItems || []) {
    const obj = {
      ItemName:    [itm.name || '未知物品', 'Item'],
      Quantity:    [itm.quantity || 1, 'Qty'],
      Type:        [itm.type || 'Item', 'Type'],
      Description: [itm.description || '', 'Desc'],
    };
    lines.push(`_.insert('CharacterSheet.Loadout.Inventory.Equipped', ${JSON.stringify(obj)});`);
  }

  // 7. Knowledge nodes → KnowledgeBase.Database.RootNodes
  for (const node of effects.knowledgeNodes || []) {
    const obj = {
      Topic:   [node.topic || '未知知识', 'Node'],
      Type:    [node.type  || 'Data', 'Type'],
      Mastery: { Level: [node.mastery || '初窥', 'Lv'], Progress: [0, '%'] },
      Content: { Summary: [node.content || '', 'Desc'] },
    };
    lines.push(`_.insert('CharacterSheet.KnowledgeBase.Database.RootNodes', ${JSON.stringify(obj)});`);
  }

  // 8. Companions (biological/spiritual) → CompanionRoster.ActiveCompanions
  // The AI generates a full CompanionEntry-compatible object matching the template.
  for (const comp of effects.companions || []) {
    // If it's already a rich object (has UserPanel), write it directly
    // Ensure PersonalityModel is preserved if present at the root level
    if (comp.UserPanel) {
      // Hoist root-level PersonalityModel into UserPanel if not already there
      if (comp.PersonalityModel && !comp.UserPanel.PersonalityModel) {
        comp.UserPanel.PersonalityModel = comp.PersonalityModel;
        delete comp.PersonalityModel;
      }
      lines.push(`_.insert('CompanionRoster.ActiveCompanions', ${JSON.stringify(comp)});`);
    } else {
      // Fallback: build minimal entry from simple fields
      const obj = {
        RelationshipSystem: {
          Status:       comp.relationshipStatus || '队友',
          Sentiment:    comp.sentiment          || '中立',
          Favorability: comp.favorability       || 0,
        },
        UserPanel: {
          Name:     [comp.name        || '未知同伴', '姓名'],
          Title:    [comp.title       || '',          '称号'],
          Identity: [comp.identity    || '',          '身份'],
          Appearance: {
            Visuals:  [comp.visuals   || comp.description || '', '外貌'],
            Clothing: [comp.clothing  || '',                     '着装'],
          },
          Personality: {
            Alignment: [comp.alignment || '中立',                 '阵营'],
            Traits:    comp.traits     || [],
            Analysis:  [comp.analysis  || comp.description || '', '侧写'],
          },
          ...(comp.PersonalityModel ? { PersonalityModel: comp.PersonalityModel } : {}),
        },
        CoreSystem: {
          Attributes: {
            STR: [comp.STR ?? 1.0, '力量'], DUR: [comp.DUR ?? 1.0, '耐力'],
            VIT: [comp.VIT ?? 1.0, '体质'], REC: [comp.REC ?? 1.0, '恢复'],
            AGI: [comp.AGI ?? 1.0, '敏捷'], REF: [comp.REF ?? 1.0, '反应'],
            PER: [comp.PER ?? 1.0, '感知'], MEN: [comp.MEN ?? 1.0, '精神'],
            SOL: [comp.SOL ?? 1.0, '灵魂'], CHA: [comp.CHA ?? 1.0, '魅力'],
          },
          Tier: {
            NormalTier: [comp.tier ?? 0, '常态'],
            BurstTier:  [comp.burstTier ?? comp.tier ?? 0, '爆发'],
          },
          SubSystems: ['$__META_EXTENSIBLE__$'],
        },
        DynamicStatus: {
          HP: {
            Value:    [comp.hp ?? 100, '当前'],
            MaxValue: [comp.hp ?? 100, 'Max'],
            Formula:  { Cap: ['(VIT+DUR)*50', '公式'] },
          },
          EnergyPools: comp.energyPools || [],
        },
        Loadout: {
          PassiveAbilities:      comp.passiveAbilities      || [],
          ApplicationTechniques: comp.applicationTechniques || [],
          PowerSources:          comp.powerSources          || [],
          Inventory:             { Equipped: comp.inventory || [] },
          MechanizedUnits:       comp.mechanizedUnits       || [],
        },
      };
      lines.push(`_.insert('CompanionRoster.ActiveCompanions', ${JSON.stringify(obj)});`);
    }
  }

  // 9. Mechs / Robots / Mechanized Units → CharacterSheet.Loadout.MechanizedUnits
  // The AI generates a full MechanizedUnit-compatible object.
  for (const mech of effects.mechs || []) {
    // If it's already a rich object (has UnitName), write it directly
    if (mech.UnitName) {
      lines.push(`_.insert('CharacterSheet.Loadout.MechanizedUnits', ${JSON.stringify(mech)});`);
    } else {
      // Fallback: build minimal entry from simple fields
      const obj = {
        UnitName: [mech.name || '未知机体', '机体名'],
        Model:    [mech.model || '', '型号'],
        Status:   'Active',
        VisualProfile: {
          DesignStyle: [mech.designStyle || mech.description || '', '设计风格'],
          Height:      [mech.height      || '?', '全高'],
          Weight:      [mech.weight      || '?', '全重'],
        },
        MachineIntelligence: {
          Installed: mech.aiInstalled || false,
          Name:      mech.aiName     || null,
          Type:      mech.aiType     || 'VI',
          SyncRate:  mech.syncRate   || 0,
        },
        BaseSpecs: {
          Tier: mech.tier ?? 0,
          Equivalence: {
            Offense: mech.offense ?? 0.0,
            Defense: mech.defense ?? 0.0,
            Speed:   mech.speed   ?? 0.0,
          },
        },
        Structure: {
          TotalIntegrity: mech.integrity ?? 1000,
          ArmorType:      mech.armorType || '未知装甲',
        },
        LocalResources: {
          Generator: mech.generator || '未知动力炉',
          Energy:    { Value: [mech.energyMax ?? 100, 'EN'],   Max: [mech.energyMax ?? 100, 'Max'] },
          Propellant:{ Value: [mech.fuelMax   ?? 100, 'Fuel'], Max: [mech.fuelMax   ?? 100, 'Max'] },
        },
        Hardpoints:     mech.hardpoints     || {},
        SpecialSystems: mech.specialSystems || [],
      };
      lines.push(`_.insert('CharacterSheet.Loadout.MechanizedUnits', ${JSON.stringify(obj)});`);
    }
  }

  // Helper: build a human-readable FlowRate label from timeFlow object
  function _buildFlowRateLabel(tf) {
    if (!tf) return '1:1';
    if (tf.type === 'frozen') return '冻结（离开期间内部时间静止）';
    if (tf.type === 'fixed_interval') return `固定跳跃：${tf.fixedJump || '?'}/次进入`;
    if (tf.type === 'hybrid') return tf.description || '复合时间规则';
    const r = tf.ratioToBase || '1:1';
    const parts = r.split(':').map(s => s.trim());
    if (parts.length === 2 && parts[0] !== parts[1]) {
      return `${r}（基准${parts[0]}天=此世界${parts[1]}天）`;
    }
    return `${r}（与基准世界同步）`;
  }

  // 10. WorldTraverse — add to Arsenal.WorldAnchors (pending; user must activate via "使用")
  if (item.type === 'WorldTraverse' && effects.worldData) {
    const wd = effects.worldData;
    const worldKey = wd.worldKey || (item.name || 'World').replace(/[^a-zA-Z0-9_]/g, '_');
    const archiveEntry = {
      worldKey,
      WorldName:    [wd.displayName || item.name || '未知世界', 'Name'],
      Time:         {
        Date:         [wd.timePeriod || '?', 'Date'],
        Clock:        ['00:00:00', 'Time'],
        FlowRate:     [_buildFlowRateLabel(wd.timeFlow), 'Rate'],
        TotalSeconds: 0,
      },
      TimeFlow:     wd.timeFlow || null,
      Location:     [wd.initialLocation || '?', 'Loc'],
      SocialWeb:    Object.fromEntries((wd.keyFactions || []).map(f => [f.name, [f.description, f.attitude]])),
      WorldRules:   wd.worldRules || [],
      Log:          [],
      PowerSystems: Array.isArray(wd.powerSystems) && wd.powerSystems.length > 0
        ? wd.powerSystems
        : (wd.powerSystem ? [{ name: '综合力量体系', description: wd.powerSystem }] : []),
      WorldIdentity: wd.worldIdentity || null,
    };
    // Store in Arsenal.WorldAnchors instead of immediately activating
    lines.push(`_.insert('Arsenal.WorldAnchors', ${JSON.stringify(archiveEntry)});`);
  }

  // 11. WorldReturn — switch CurrentWorldName back to OriginWorldKey
  if (item.type === 'WorldReturn') {
    lines.push(`_.set('Multiverse.CurrentWorldName', [stat_data.Multiverse?.OriginWorldKey || '', 'Name']);`);
  }

  return lines.join('\n');
}

// ─── Redemption Executor ──────────────────────────────────────────────────────

/**
 * Validates resources and applies an item's effects to a session's statData.
 * @param {object} item       - shop item
 * @param {object} session    - game session
 * @param {object} [vars]     - template vars {userName, charName}
 * @returns {{ success, error, updatedStat }}
 */
function executeRedemption(item, session, vars) {
  const statData = session.statData;

  // ── Resource checks ──
  const currentPoints = Number(
    getAtPath(statData, parsePath('CharacterSheet.Resources.Points'))
  ) || 0;

  if (currentPoints < item.pricePoints) {
    return {
      success: false,
      error:   `积分不足。需要 ${item.pricePoints.toLocaleString()}，当前 ${currentPoints.toLocaleString()}`,
    };
  }

  // Medal checks (support keys "1" and "1星")
  const medals = getAtPath(statData, parsePath('CharacterSheet.Resources.StarMedals')) || {};
  for (const req of item.requiredMedals || []) {
    const have = getMedalCount(medals, req.stars);
    if (have < req.count) {
      return {
        success: false,
        error:   `${req.stars}星徽章不足。需要 ${req.count} 枚，当前 ${have} 枚`,
      };
    }
  }

  // ── Deduct costs ──
  setAtPath(statData, parsePath('CharacterSheet.Resources.Points'), currentPoints - item.pricePoints);

  for (const req of item.requiredMedals || []) {
    const have = getMedalCount(medals, req.stars);
    setMedalCount(medals, req.stars, have - req.count);
  }

  // ── Apply item operations first (remove/modify old items before adding new ones) ──
  processItemOperations(item.effects || {}, statData);

  // ── Apply effects ──
  const script = buildApplyScript(item);
  if (script) {
    processUpdateVariables(`<UpdateVariable>\n${script}\n</UpdateVariable>`, statData, vars || {});
  }

  // Record milestone
  const milestonePath = parsePath('CharacterSheet.AchievementSystem.Milestones');
  let milestones = getAtPath(statData, milestonePath);
  if (!Array.isArray(milestones)) {
    setAtPath(statData, milestonePath, []);
    milestones = getAtPath(statData, milestonePath);
  }
  milestones.push(`兑换：${item.name}（${item.tier}星，${item.pricePoints}积分）`);

  // Also append to world-bound event log
  const curWorldKey = (() => {
    const w = statData?.Multiverse?.CurrentWorldName;
    return Array.isArray(w) ? w[0] : (w || null);
  })();
  if (curWorldKey) {
    const logPath = parsePath(`Multiverse.Archives.${curWorldKey}.Log`);
    let worldLog = getAtPath(statData, logPath);
    if (!Array.isArray(worldLog)) {
      setAtPath(statData, logPath, []);
      worldLog = getAtPath(statData, logPath);
    }
    const ts = new Date().toISOString().slice(0, 10);
    worldLog.push(`[${ts}][商店] 兑换：${item.name}（${item.tier}★，${item.pricePoints}积分）`);
  }

  // Add to ShopInventory for tracking and prefill
  const invPath = parsePath('CharacterSheet.ShopInventory');
  let inv = getAtPath(statData, invPath);
  if (!Array.isArray(inv)) {
    setAtPath(statData, invPath, []);
    inv = getAtPath(statData, invPath);
  }
  inv.push({
    id:          item.id,
    name:        item.name,
    type:        item.type,
    tier:        item.tier,
    pricePoints: item.pricePoints || 0,
    redeemedAt:  new Date().toISOString(),
  });

  return { success: true, updatedStat: statData };
}

// ─── Item Operations Processor ───────────────────────────────────────────────

/**
 * Extract the display name from a loadout entry (handles [value, label] tuples).
 */
function getEntryName(entry) {
  if (!entry || typeof entry !== 'object') return '';
  for (const k of ['Name', 'ItemName', 'UnitName', 'Topic']) {
    if (entry[k] !== undefined) {
      const v = entry[k];
      return String(Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
    }
  }
  if (entry.UserPanel?.Name) {
    const v = entry.UserPanel.Name;
    return String(Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
  }
  return '';
}

/**
 * Process effects.itemOperations: delete or modify existing loadout entries.
 * Called BEFORE buildApplyScript so the old item is removed before the new one is added.
 */
function processItemOperations(effects, statData) {
  const ops = (effects.itemOperations || []).filter(
    op => op.targetItemName && (op.type === 'delete' || op.type === 'modify')
  );
  if (!ops.length) return;

  // Paths to search in the main character sheet
  const MAIN_PATHS = [
    parsePath('CharacterSheet.Loadout.PassiveAbilities'),
    parsePath('CharacterSheet.Loadout.PowerSources'),
    parsePath('CharacterSheet.Loadout.ApplicationTechniques'),
    parsePath('CharacterSheet.Loadout.Inventory.Equipped'),
    parsePath('CharacterSheet.Loadout.MechanizedUnits'),
  ];

  for (const op of ops) {
    const target = String(op.targetItemName).toLowerCase().trim();
    let found = false;

    // 1. Search main character loadout
    for (const pathSegs of MAIN_PATHS) {
      const arr = getAtPath(statData, pathSegs);
      if (!Array.isArray(arr)) continue;
      const idx = arr.findIndex(e => getEntryName(e).toLowerCase().includes(target));
      if (idx === -1) continue;

      if (op.type === 'delete') {
        arr.splice(idx, 1);
      } else if (op.type === 'modify' && Array.isArray(op.modifications)) {
        const entry = arr[idx];
        for (const mod of op.modifications) {
          if (mod.field && mod.newValue !== undefined) {
            setAtPath(entry, parsePath(mod.field), mod.newValue);
          }
        }
      }
      found = true;
      break;
    }

    if (found) continue;

    // 2. Search companion roster (companion itself or its loadout)
    const rawCompanions = getAtPath(statData, parsePath('CompanionRoster.ActiveCompanions'));
    const companions = Array.isArray(rawCompanions)
      ? rawCompanions
      : Object.values(rawCompanions || {}).filter(c => c && typeof c === 'object');
    const COMP_PATHS = [
      ['Loadout', 'PassiveAbilities'],
      ['Loadout', 'PowerSources'],
      ['Loadout', 'ApplicationTechniques'],
      ['Loadout', 'Inventory', 'Equipped'],
      ['Loadout', 'MechanizedUnits'],
    ];

    for (const comp of companions) {
      // Check if the companion itself is targeted
      if (getEntryName(comp).toLowerCase().includes(target)) {
        const arr = companions;
        const idx = arr.indexOf(comp);
        if (idx !== -1) arr.splice(idx, 1);
        found = true;
        break;
      }
      // Search within companion's loadout
      for (const relPath of COMP_PATHS) {
        const arr = getAtPath(comp, relPath);
        if (!Array.isArray(arr)) continue;
        const idx = arr.findIndex(e => getEntryName(e).toLowerCase().includes(target));
        if (idx === -1) continue;
        if (op.type === 'delete') {
          arr.splice(idx, 1);
        } else if (op.type === 'modify' && Array.isArray(op.modifications)) {
          const entry = arr[idx];
          for (const mod of op.modifications) {
            if (mod.field && mod.newValue !== undefined) {
              setAtPath(entry, parsePath(mod.field), mod.newValue);
            }
          }
        }
        found = true;
        break;
      }
      if (found) break;
    }
  }
}

module.exports = {
  parseGenerationResponse,
  parseGachaBatchResponse,
  buildApplyScript,
  executeRedemption,
  processItemOperations,
};
