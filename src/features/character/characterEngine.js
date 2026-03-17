'use strict';
/**
 * Character Engine — applies a generated character profile to a session's statData.
 * Extracted from server.js. Handles the complex mapping of AI-generated character
 * data into the internal statData.CharacterSheet structure.
 */

const log = require('../../core/logger');
const { runAutoCalc } = require('../../engine/varEngine');

// ─── Build helpers ────────────────────────────────────────────────────────────

function buildSpecs(tier = 0) {
  return {
    Tier:        [Number(tier) || 0, '★评定'],
    Equivalence: { Offense: [0.0, '攻击当量'], Defense: [0.0, '防御当量'], Speed: [0.0, '机动当量'] },
    Resistances: { Physical: [1.0, '物理抗性'] },
  };
}

function buildProficiency(level = '入门') {
  return {
    Level:       [String(level), '等级描述'],
    Rank:        [1, '等级数值'],
    CurrentXP:   [0, '当前经验'],
    NextLevelXP: [100, '升级需求'],
    AutoLevelUp: [true, '标志:满经验自动升级'],
    Bonus:       ['', '等级加成'],
  };
}

function buildSubMove(st) {
  return {
    '$ref':      'Templates.SubMoveEntry',
    Name:        [String(st.name), '招式名'],
    Description: [String(st.desc || ''), '效果描述'],
    Proficiency: buildProficiency(st.proficiencyLevel || '入门'),
    Mechanics: {
      ActivationManifestation: {
        Stance:   [String(st.stance   || ''), '发动姿势'],
        Chant:    [String(st.chant    || ''), '咏唱/口令'],
        VisualFX: [String(st.visualFX || ''), '光效描述'],
        SoundFX:  ['', '音效'],
        Morph:    ['', '形态变化'],
      },
      Cost: {
        Initial:     [String(st.costInitial     || '无消耗'), '启动消耗'],
        Maintenance: [String(st.costMaintenance || '无'),     '维持消耗'],
        Material:    ['', '耗材'],
      },
      Timing: {
        CastTime: [String(st.castTime || 'Instant'), '准备时间'],
        CoolDown: [String(st.cooldown || 'None'),    '冷却时间'],
        Duration: ['Instant', '持续时间'],
      },
      RiskProfile: {
        HasSafeLimit: [Boolean(st.hasRisk), '反噬风险'],
        Backlash: {
          Trigger:           ['', '触发条件'],
          EffectDescription: [String(st.riskDesc || ''), '后果'],
        },
      },
    },
    Specs: buildSpecs(st.tier),
  };
}

// ─── Bootstrap statData structure ────────────────────────────────────────────

function bootstrapStatData(session) {
  if (!session.statData) session.statData = {};
  if (!session.statData.CharacterSheet) session.statData.CharacterSheet = {};

  const cs = session.statData.CharacterSheet;

  if (!cs.UserPanel) cs.UserPanel = {};

  if (!cs.CoreSystem) cs.CoreSystem = {};
  if (!cs.CoreSystem.Attributes) cs.CoreSystem.Attributes = {
    STR: [1.0, '力量'], DUR: [1.0, '耐力'], VIT: [1.0, '体质'], REC: [1.0, '恢复'],
    AGI: [1.0, '敏捷'], REF: [1.0, '反应'], PER: [1.0, '感知'], MEN: [1.0, '精神'],
    SOL: [1.0, '灵魂'], CHA: [1.0, '魅力'],
  };
  if (!cs.CoreSystem.Tier) cs.CoreSystem.Tier = {
    NormalTier: [0, 'Tier 0 (Human)'],
    BurstTier:  [0, 'Tier 0 (Human)'],
  };
  if (!cs.CoreSystem.SubSystems) cs.CoreSystem.SubSystems = ['$__META_EXTENSIBLE__$'];

  if (!cs.DynamicStatus) cs.DynamicStatus = {};
  if (!cs.DynamicStatus.HP) cs.DynamicStatus.HP = {
    Value:    [100, 'Current'],
    MaxValue: [100, 'Max'],
    Formula:  { Cap: ['(VIT+DUR)*50', 'Calc'] },
  };
  if (!Array.isArray(cs.DynamicStatus.EnergyPools)) {
    cs.DynamicStatus.EnergyPools = [
      { Name: ['体力', 'Pool'], Value: [100, 'Stamina'], MaxValue: [100, 'Max'] },
    ];
  }

  if (!cs.Resources) cs.Resources = { Points: 1000, StarMedals: {} };
  if (!cs.Resources.StarMedals) cs.Resources.StarMedals = {};

  if (!cs.Loadout) cs.Loadout = {};
  if (!Array.isArray(cs.Loadout.PassiveAbilities))      cs.Loadout.PassiveAbilities      = [];
  if (!Array.isArray(cs.Loadout.PowerSources))          cs.Loadout.PowerSources          = [];
  if (!Array.isArray(cs.Loadout.ApplicationTechniques)) cs.Loadout.ApplicationTechniques = [];
  if (!cs.Loadout.Inventory)                            cs.Loadout.Inventory             = {};
  if (!Array.isArray(cs.Loadout.Inventory.Equipped))    cs.Loadout.Inventory.Equipped    = [];
  if (!Array.isArray(cs.Loadout.MechanizedUnits))       cs.Loadout.MechanizedUnits       = [];

  if (!cs.KnowledgeBase)                                    cs.KnowledgeBase              = {};
  if (!cs.KnowledgeBase.Database)                           cs.KnowledgeBase.Database     = {};
  if (!Array.isArray(cs.KnowledgeBase.Database.RootNodes))  cs.KnowledgeBase.Database.RootNodes = [];

  if (!cs.AchievementSystem)                            cs.AchievementSystem            = {};
  if (!Array.isArray(cs.AchievementSystem.Milestones))  cs.AchievementSystem.Milestones = [];

  if (!session.statData.CompanionRoster) session.statData.CompanionRoster = { ActiveCompanions: {} };
  if (!session.statData.SocialWeb)       session.statData.SocialWeb       = { Relationships: [] };
  if (!session.statData.Multiverse)      session.statData.Multiverse      = { CurrentWorldName: ['未知'], Archives: {} };

  // EmotionalState bootstrap (under DynamicStatus)
  if (!cs.DynamicStatus.EmotionalState) {
    cs.DynamicStatus.EmotionalState = {
      Baseline:         [0, '情绪基线 -10低落~+10亢奋，0=平静'],
      ActiveEmotions:   [],
      RecentMoodShifts: [],
    };
  }
}

// ─── Main: applyCharacterToSession ───────────────────────────────────────────

function applyCharacterToSession(session, character) {
  bootstrapStatData(session);

  const cs = session.statData.CharacterSheet;
  const up = cs.UserPanel;

  // ── UserPanel base fields ──
  up.Name     = character.name;
  up.Title    = character.title    || '';
  up.Identity = character.identity || '';

  if (!up.Appearance) up.Appearance = {};
  up.Appearance.Height   = [character.height     || '?', 'Height'];
  up.Appearance.Weight   = [character.weight     || '?', 'Weight'];
  up.Appearance.Visuals  = [character.appearance || '', 'Desc'];
  up.Appearance.Clothing = [character.clothing   || '', 'Attire'];
  up.Appearance.Gender   = [character.gender     || '?', 'Gender'];
  up.Appearance.Age      = [character.age        || '?', 'Age'];

  if (!up.Personality) up.Personality = {};
  up.Personality.Alignment  = [character.alignment  || '中立', 'Align'];
  up.Personality.Traits     = character.traits     || [];
  up.Personality.Analysis   = character.personality || [];
  up.Personality.Flaws      = character.flaws      || [];
  up.Personality.Desires    = character.desires    || [];
  up.Personality.Fears      = character.fears      || [];
  up.Personality.Quirks     = character.quirks     || [];
  up.Personality.Background = [character.background || '', 'BG'];

  // ── Dimensions (18-axis quantified personality) ──
  if (character.dimensions && typeof character.dimensions === 'object') {
    const d = character.dimensions;
    const dim = (val, label) => [typeof val === 'number' ? Math.max(-10, Math.min(10, Math.round(val))) : 0, label];
    up.Personality.Dimensions = {
      Social: {
        IntroExtro:       dim(d.social?.introExtro,       '-10内倾~+10外倾'),
        TrustRadius:      dim(d.social?.trustRadius,      '-10极度不信任~+10无条件信任'),
        Dominance:        dim(d.social?.dominance,        '-10顺从~+10强主导'),
        Empathy:          dim(d.social?.empathy,          '-10冷漠~+10过度共情'),
        BoundaryStrength: dim(d.social?.boundaryStrength, '-10无边界~+10极强边界'),
      },
      Emotional: {
        Stability:      dim(d.emotional?.stability,      '-10极度动荡~+10极度稳定'),
        Expressiveness: dim(d.emotional?.expressiveness, '-10极度压抑~+10完全外放'),
        RecoverySpeed:  dim(d.emotional?.recoverySpeed,  '-10极慢恢复~+10极快恢复'),
        EmotionalDepth: dim(d.emotional?.emotionalDepth, '-10情感肤浅~+10情感深邃'),
      },
      Cognitive: {
        AnalyticIntuitive: dim(d.cognitive?.analyticIntuitive, '-10纯直觉~+10纯分析'),
        Openness:          dim(d.cognitive?.openness,          '-10极封闭~+10极开放'),
        RiskTolerance:     dim(d.cognitive?.riskTolerance,     '-10规避风险~+10嗜险冒进'),
        SelfAwareness:     dim(d.cognitive?.selfAwareness,     '-10自我认知盲区大~+10高度自知'),
      },
      Values: {
        Autonomy:    dim(d.values?.autonomy,    '-10顺从权威~+10极端自主'),
        Altruism:    dim(d.values?.altruism,    '-10纯粹利己~+10极度利他'),
        Rationality: dim(d.values?.rationality, '-10纯情绪驱动~+10纯理性驱动'),
        Loyalty:     dim(d.values?.loyalty,     '-10轻义背信~+10极忠'),
        Idealism:    dim(d.values?.idealism,    '-10极度现实~+10理想主义'),
      },
    };
  }

  // ── ContextModes ──
  if (character.contextModes && typeof character.contextModes === 'object') {
    up.Personality.ContextModes = character.contextModes;
  }

  // ── TriggerPatterns ──
  if (Array.isArray(character.triggerPatterns) && character.triggerPatterns.length > 0) {
    up.Personality.TriggerPatterns = character.triggerPatterns.map(t => ({
      trigger:   String(t.trigger   || ''),
      reaction:  String(t.reaction  || ''),
      intensity: Math.max(1, Math.min(10, Number(t.intensity) || 5)),
    }));
  }

  // ── EmotionalState (reset to neutral on new character) ──
  cs.DynamicStatus.EmotionalState = {
    Baseline:         [0, '情绪基线 -10低落~+10亢奋，0=平静'],
    ActiveEmotions:   [],
    RecentMoodShifts: [],
  };

  // ── SocialWeb.Relationships ──
  if (Array.isArray(character.initialRelationships) && character.initialRelationships.length > 0) {
    session.statData.SocialWeb = {
      Relationships: character.initialRelationships
        .filter(r => r && r.name)
        .map(r => ({
          Name:          [String(r.name), '关系名称'],
          Familiarity:   [Math.max(0, Math.min(100, Number(r.familiarity) || 0)), '熟悉度 0-100'],
          Trust:         [Math.max(0, Math.min(100, Number(r.trust)       || 0)), '信任度 0-100'],
          Affect:        [Math.max(-100, Math.min(100, Number(r.affect)   || 0)), '情感倾向 -100厌~+100好'],
          Dynamics:      String(r.dynamics || ''),
          RecentHistory: [],
        })),
    };
  } else if (!session.statData.SocialWeb?.Relationships) {
    session.statData.SocialWeb = { Relationships: [] };
  }

  // ── Character Origin ──
  const originType = session.characterType || '本土';
  if (!up.Origin) up.Origin = {};
  up.Origin.Type = [originType, '角色来源类型'];
  if (originType === '穿越者') {
    const tMethodMap = {
      isekai: '异世界转生', rebirth: '重生', possession: '夺舍/融合',
      summoning: '召唤/降临', system: '系统穿越', custom: '自定义',
    };
    const tMethod = tMethodMap[session.traversalMethod] || session.traversalMethod || '异世界转生';
    up.Origin.TraversalMethod = [tMethod, '穿越方式'];
    if (session.traversalDesc) up.Origin.TraversalDesc = [session.traversalDesc, '穿越详情'];
  }

  // ── Attributes ──
  if (character.attributes && typeof character.attributes === 'object') {
    const attrKeys   = ['STR','DUR','VIT','REC','AGI','REF','PER','MEN','SOL','CHA'];
    const attrLabels = { STR:'力量', DUR:'耐力', VIT:'体质', REC:'恢复', AGI:'敏捷', REF:'反应', PER:'感知', MEN:'精神', SOL:'灵魂', CHA:'魅力' };
    for (const key of attrKeys) {
      const val = parseFloat(character.attributes[key]);
      if (!isNaN(val) && val > 0) {
        cs.CoreSystem.Attributes[key] = [Math.round(val * 10) / 10, attrLabels[key]];
      }
    }
  }

  // ── Passive abilities ──
  if (Array.isArray(character.passiveAbilities) && character.passiveAbilities.length > 0) {
    cs.Loadout.PassiveAbilities = character.passiveAbilities
      .filter(a => a && a.name)
      .map(a => ({
        '$ref': 'Templates.PassiveAbility',
        Name:              [String(a.name), 'Talent'],
        Type:              [String(a.type || 'Talent'), '类型'],
        Description:       [String(a.desc || ''), '被动效果描述'],
        DerivedTechniques: ['$__META_EXTENSIBLE__$'],
        Specs:             buildSpecs(a.tier),
        Tags:              Array.isArray(a.tags) ? a.tags.map(String) : [],
      }));
  }

  // ── Power sources (+ energy pools) ──
  if (Array.isArray(character.powerSources) && character.powerSources.length > 0) {
    const existingPoolNames = new Set(cs.DynamicStatus.EnergyPools.map(p => p.Name?.[0]));
    cs.Loadout.PowerSources = character.powerSources
      .filter(p => p && p.name)
      .map(p => {
        if (p.poolName && !existingPoolNames.has(p.poolName) && !String(p.poolName).includes('体力')) {
          const poolMax = Number(p.poolMax) || 100;
          cs.DynamicStatus.EnergyPools.push({
            Name:     [String(p.poolName), 'Pool'],
            Value:    [poolMax, String(p.poolRegen || 'Energy')],
            MaxValue: [poolMax, 'Max'],
          });
          existingPoolNames.add(p.poolName);
        }
        return {
          '$ref':    'Templates.PowerSource',
          Name:      [String(p.name), '基盘名称'],
          Type:      [String(p.type || 'RootSystem'), '类型'],
          Aptitude: {
            Grade:      [String(p.aptitudeGrade || 'C'), '资质评级'],
            Title:      [String(p.aptitudeTitle || '常人资质'), '天赋描述'],
            Correction: [Number(p.aptitudeCorrection) || 1.0, '修炼效率倍率'],
          },
          Description: [String(p.desc || ''), '原理描述'],
          Cultivation: {
            Realm:    [String(p.realm || '初阶'), '当前境界'],
            Progress: buildProficiency('入门'),
          },
          GeneratedPool: {
            PoolName: [String(p.poolName || ''), '能量池名称'],
            MaxValue: [Number(p.poolMax) || 0, 'Max'],
            Regen:    [String(p.poolRegen || '无自动回复'), '回复公式'],
          },
          BaseSpecs:         buildSpecs(p.tier),
          TechniqueRegistry: ['$__META_EXTENSIBLE__$'],
          DerivedPassives:   ['$__META_EXTENSIBLE__$'],
        };
      });
  }

  // ── Explicit energy pools ──
  if (Array.isArray(character.energyPools) && character.energyPools.length > 0) {
    const existingPoolNames = new Set(cs.DynamicStatus.EnergyPools.map(p => p.Name?.[0]));
    for (const pool of character.energyPools) {
      if (!pool || !pool.name) continue;
      if (existingPoolNames.has(pool.name) || String(pool.name).includes('体力')) continue;
      const max = Number(pool.maxValue) || 100;
      cs.DynamicStatus.EnergyPools.push({
        Name:     [String(pool.name), 'Pool'],
        Value:    [max, String(pool.description || 'Energy')],
        MaxValue: [max, 'Max'],
      });
      existingPoolNames.add(pool.name);
    }
  }

  // ── Techniques (School → SubMoves) ──
  if (Array.isArray(character.techniques) && character.techniques.length > 0) {
    cs.Loadout.ApplicationTechniques = character.techniques
      .filter(t => t && (t.schoolName || t.name))
      .map(t => {
        const isNew      = Boolean(t.schoolName);
        const schoolName = isNew ? t.schoolName : (t.school || t.name || '');
        const dispName   = isNew ? t.schoolName : t.name;

        let subMoves = {};
        if (isNew && Array.isArray(t.subTechniques) && t.subTechniques.length > 0) {
          t.subTechniques.filter(st => st && st.name).forEach(st => {
            subMoves[st.name] = buildSubMove(st);
          });
        } else if (!isNew) {
          subMoves[dispName] = buildSubMove({
            name: dispName, desc: t.desc, proficiencyLevel: t.proficiencyLevel,
            costInitial: t.costInitial, costMaintenance: t.costMaintenance,
            castTime: t.castTime, cooldown: t.cooldown,
            hasRisk: t.hasRisk, riskDesc: t.riskDesc, tier: t.tier,
            stance: t.stance, chant: t.chant, visualFX: t.visualFX,
          });
        }

        return {
          '$ref':       'Templates.ApplicationTechnique',
          Name:         [String(dispName),           '技艺名称'],
          School:       [String(schoolName),         '所属流派'],
          Type:         [String(t.type || 'Active'), '类型'],
          Description:  [String(t.desc || ''),       '流派描述'],
          ParentSource: [String(t.parentSource || ''), '驱动基盘'],
          Proficiency:  buildProficiency('入门'),
          SubMoves:     Object.keys(subMoves).length > 0
            ? subMoves
            : { '$meta': { recursiveExtensible: true } },
          Mechanics: {
            State: {
              CurrentStatus: ['Ready', '状态'],
              Timers: { DurationRemaining: [0, 's'], CooldownRemaining: [0, 's'] },
            },
            Cost:       { Initial: ['—', '启动消耗'], Maintenance: ['—', '维持消耗'], Material: ['', '耗材'] },
            Timing:     { CastTime: ['—', '准备时间'], CoolDown: ['—', '冷却时间'], Duration: ['—', '持续时间'] },
            RiskProfile: { HasSafeLimit: [false, '反噬风险'], Backlash: { Trigger: ['', '触发条件'], EffectDescription: ['', '后果'] } },
          },
          Specs: buildSpecs(t.tier),
        };
      });

    // Sync technique names into parent PowerSource.TechniqueRegistry
    const psMap = {};
    (cs.Loadout.PowerSources || []).forEach(ps => {
      const n = Array.isArray(ps.Name) ? ps.Name[0] : ps.Name;
      if (n) psMap[n] = ps;
    });
    cs.Loadout.ApplicationTechniques.forEach(tech => {
      const parent = Array.isArray(tech.ParentSource) ? tech.ParentSource[0] : tech.ParentSource;
      const name   = Array.isArray(tech.Name)         ? tech.Name[0]         : tech.Name;
      if (parent && psMap[parent]) {
        const reg      = psMap[parent].TechniqueRegistry;
        const filtered = Array.isArray(reg)
          ? reg.filter(x => !(typeof x === 'string' && x.startsWith('$__META')))
          : [];
        if (!filtered.some(x => (Array.isArray(x.Name) ? x.Name[0] : x.Name) === name)) {
          filtered.push({ Name: [name, '流派'], School: tech.School, Type: tech.Type });
        }
        psMap[parent].TechniqueRegistry = filtered;
      }
    });
  }

  // ── Mechs ──
  if (Array.isArray(character.mechs) && character.mechs.length > 0) {
    cs.Loadout.MechanizedUnits = character.mechs
      .filter(m => m && m.unitName)
      .map(m => {
        const integrity = Number(m.totalIntegrity) || 1000;
        const enMax     = Number(m.energyMax)      || 100;
        return {
          '$ref':   'Templates.MechanizedUnit',
          UnitName: [String(m.unitName), '机体名称'],
          Model:    [String(m.model || ''), '型号'],
          Status:   ['Active', '状态'],
          VisualProfile: {
            DesignStyle: [String(m.designStyle || ''), '设计风格'],
            PaintJob:    ['', '涂装'], Silhouette: ['', '轮廓'],
            Height:      [String(m.height || ''), '全高'], Weight: ['', '全重'],
          },
          MachineIntelligence: {
            Installed:   [Boolean(m.hasMI), '是否安装心智'],
            Name:        [String(m.miName || ''), 'AI名'], Type: ['VI', '类型'],
            Personality: [String(m.miPersonality || ''), '性格'], SyncRate: [0, '同步率'],
          },
          BaseSpecs: buildSpecs(m.tier),
          Structure: {
            TotalIntegrity: [integrity, '结构值'], ArmorType: ['', '装甲'],
            Components: {
              '$meta': { recursiveExtensible: true },
              Head: { Name: ['头部', '部位'], HP: [Math.floor(integrity * 0.1), 'HP'], Status: ['OK', 'State'], Visuals: ['', '部位外观'] },
              Core: { Name: ['核心', '部位'], HP: [Math.floor(integrity * 0.5), 'HP'], Status: ['OK', 'State'], Visuals: ['', '部位外观'] },
            },
          },
          LocalResources: {
            Generator:  [String(m.desc || ''), '动力炉'],
            Energy:     { Value: [enMax, 'EN'], Max: [enMax, 'Max'] },
            Propellant: { Value: [100, 'Fuel'], Max: [100, 'Max'] },
          },
          Hardpoints: {
            '$meta':     { recursiveExtensible: true },
            MainHand:    ['$__META_EXTENSIBLE__$'],
            BackPack:    ['$__META_EXTENSIBLE__$'],
            InternalBay: ['$__META_EXTENSIBLE__$'],
          },
          SpecialSystems: ['$__META_EXTENSIBLE__$'],
        };
      });
  }

  // ── Starting items ──
  if (Array.isArray(character.startingItems) && character.startingItems.length > 0) {
    cs.Loadout.Inventory.Equipped = character.startingItems
      .filter(item => item && item.name)
      .map(item => ({
        '$ref':    'Templates.InventoryItem',
        ItemName:  [String(item.name), 'ID'],
        Quantity:  [Number(item.qty) || 1, 'Qty'],
        Type:      [String(item.type || 'Misc'), '分类'],
        Description: [String(item.desc || ''), '描述'],
        VisualDetails: {
          Material: [String(item.material || ''), '材质'], Texture: ['', '质感'],
          ColorSchema: [String(item.colorSchema || ''), '配色'], Inscription: ['', '铭文/标记'],
        },
        Durability: { Current: [100, '当前'], Max: [100, '上限'] },
      }));
  }

  // ── Knowledge nodes ──
  if (Array.isArray(character.knowledge) && character.knowledge.length > 0) {
    const masteryProgress = { '完全解析': 100, '精通': 80, '熟练': 60, '初步了解': 30 };
    cs.KnowledgeBase.Database.RootNodes = character.knowledge
      .filter(k => k && k.topic)
      .map(k => ({
        '$ref':  'Templates.KnowledgeNode',
        Topic:   [String(k.topic), '主题'],
        Type:    [String(k.type || 'Theory'), '类型'],
        Mastery: { Level: [String(k.mastery || '熟练'), 'Lv'], Progress: [masteryProgress[k.mastery] ?? 60, '%'] },
        Content: { Summary: [String(k.summary || ''), '摘要'] },
        SubNodes: ['$__META_EXTENSIBLE__$'],
      }));
  }

  // ── Recalculate derived stats ──
  runAutoCalc(session.statData);
  const hp = cs.DynamicStatus.HP;
  if (hp) hp.Value[0] = hp.MaxValue[0];
  const pools = cs.DynamicStatus.EnergyPools;
  if (Array.isArray(pools)) {
    pools.forEach(p => { if (p && Array.isArray(p.Value) && Array.isArray(p.MaxValue)) p.Value[0] = p.MaxValue[0]; });
  }

  session.isInitialized = true;
  session.name = character.name ? `${character.name} 的故事` : session.name;

  log.session('CHAR_APPLIED', `Applied character "${character.name}" to session ${session.id}`);
}

module.exports = { applyCharacterToSession, bootstrapStatData };
