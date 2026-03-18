'use strict';
/* ── Character Creator Frontend ─────────────────────────────────────────────── */

// ─── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const qs = sel => document.querySelector(sel);

function toast(msg, duration = 2800) {
  if (window.UIFeedback) {
    window.UIFeedback.toast(msg, { type: 'info', duration });
    return;
  }
  const el = $('toast');
  el.textContent = msg;
  el.style.display = 'block';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.style.display = 'none'; }, 300);
  }, duration);
}

async function confirmDanger(message, title = '确认操作', confirmText = '确认') {
  if (window.UIFeedback) {
    return window.UIFeedback.confirmDanger({ title, message, confirmText });
  }
  return confirm(message);
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  mode: 'quiz',
  charType: '本土',          // '本土' | '穿越者'
  traversalMethod: 'isekai', // key for preset, or 'custom'
  traversalDesc: '',         // only used when traversalMethod === 'custom'
  questions: [],
  generating: false,
  currentCharacter: null,
  lastGenMode: null,
  editData: null,            // editable section data (attributes, pools, abilities…)
};

const CHAR_TYPE_HINTS = {
  '本土':  '角色生于本世界，熟悉当地规则与文化。',
  '穿越者': '角色来自异世界（如现代地球），携带异世界的记忆与知识。请选择穿越方式。',
};

const TRAVERSAL_HINTS = {
  isekai:     '以完整记忆转生至本世界，保有异世界记忆，可能附带转生祝福。',
  rebirth:    '以完整记忆在本世界更早时间点重生，外表是本土人，内心装着异世界灵魂。',
  possession: '意识穿入本世界已存在人物身体，继承部分原主记忆，但核心是异世界灵魂。',
  summoning:  '以原世界完整成年身份被召唤至本世界，明显的外来者形象。',
  system:     '被未知力量携带至本世界，同时获得系统界面（与无限武库对接）。',
  custom:     '自定义穿越背景，在下方文本框中详细描述穿越方式。',
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSessions();
  setupTabs();
  setupCharTypeButtons();
  setupTraversalButtons();
  setupQuizMode();
  setupBgMode();
  setupResultPanel();
  setupTagEditors();
  setupArchivePanel();
});

// ─── Session Loading ──────────────────────────────────────────────────────────
async function loadSessions() {
  try {
    const sessions = await fetch('/api/sessions').then(r => r.json());
    const opts = sessions.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
    [$('applySession')].forEach(sel => {
      if (sel) sel.innerHTML = '<option value="">— 选择存档 —</option>' + opts;
    });
  } catch (_) {}
}

// ─── Tab Switching ────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', b === btn));
      $('quizPanel').style.display    = state.mode === 'quiz'       ? 'flex' : 'none';
      $('bgPanel').style.display      = state.mode === 'background' ? 'flex' : 'none';
      $('archivePanel').style.display = state.mode === 'archive'    ? 'flex' : 'none';
      if (state.mode === 'archive') loadArchiveList();
    });
  });
}

// ─── Character Type Buttons ───────────────────────────────────────────────────
function setupCharTypeButtons() {
  ['quizCharType', 'bgCharType'].forEach(containerId => {
    const prefix = containerId === 'quizCharType' ? 'quiz' : 'bg';
    const container = $(containerId);
    if (!container) return;
    const hintEl = $(containerId + 'Hint');
    const traversalBlock = $(`${prefix}TraversalBlock`);
    container.querySelectorAll('.char-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.char-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.charType = btn.dataset.type;
        if (hintEl) hintEl.textContent = CHAR_TYPE_HINTS[state.charType] || '';
        if (traversalBlock) {
          traversalBlock.style.display = state.charType === '穿越者' ? 'flex' : 'none';
        }
      });
    });
  });
}

// ─── Traversal Method Buttons ─────────────────────────────────────────────────
function setupTraversalButtons() {
  ['quizTraversalPresets', 'bgTraversalPresets'].forEach(containerId => {
    const prefix = containerId === 'quizTraversalPresets' ? 'quiz' : 'bg';
    const container = $(containerId);
    if (!container) return;
    const hintEl = $(`${prefix}TraversalHint`);
    const descEl = $(`${prefix}TraversalDesc`);

    container.querySelectorAll('.traversal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.traversal-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.traversalMethod = btn.dataset.method;
        if (hintEl) hintEl.textContent = TRAVERSAL_HINTS[state.traversalMethod] || '';
        if (descEl) {
          descEl.style.display = state.traversalMethod === 'custom' ? 'block' : 'none';
        }
      });
    });

    if (descEl) {
      descEl.addEventListener('input', () => { state.traversalDesc = descEl.value; });
    }
  });
}

// ─── Quiz Mode ────────────────────────────────────────────────────────────────
function setupQuizMode() {
  const countInput = $('questionCount');
  const countLabel = $('questionCountLabel');
  countInput.addEventListener('input', () => { countLabel.textContent = countInput.value; });
  $('btnGenQuestions').addEventListener('click', generateQuestions);
  $('btnGenFromQuiz').addEventListener('click', generateFromQuiz);
}

async function generateQuestions() {
  if (state.generating) return;
  const count = parseInt($('questionCount').value);
  setGenerating(true, `生成 ${count} 道评估问题中…`);
  clearError();

  const stream = $('quizStream');
  stream.textContent = '';
  stream.style.display = 'block';
  $('questionList').style.display = 'none';
  $('quizSubmitRow').style.display = 'none';

  let fullText = '';
  try {
    const result = await ssePost(
      '/api/character/questions',
      { count, charType: state.charType },
      delta => {
        fullText += delta;
        stream.textContent = fullText.slice(-800);
        stream.scrollTop = stream.scrollHeight;
      }
    );
    stream.style.display = 'none';

    let questions = result.questions;
    if (!Array.isArray(questions) || questions.length === 0) {
      try {
        const m = fullText.match(/```json\s*([\s\S]*?)\s*```/i);
        questions = JSON.parse(m ? m[1] : (fullText.match(/\[[\s\S]*\]/)?.[0] || ''));
      } catch (_) {}
    }

    if (Array.isArray(questions) && questions.length > 0) {
      state.questions = questions;
      renderQuestions(questions);
      toast(`已生成 ${questions.length} 道评估问题`);
    } else {
      showError('问题解析失败，请重试');
    }
  } catch (err) {
    stream.style.display = 'none';
    showError(err.message);
  }
  setGenerating(false);
}

function renderQuestions(questions) {
  const list = $('questionList');
  list.innerHTML = '';
  questions.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'question-item';
    div.dataset.id = i;

    const textHtml = `<p class="question-text"><span class="q-num">${i + 1}</span>${escHtml(q.question)}</p>`;
    let inputHtml = '';

    if (q.type === 'choice' && Array.isArray(q.options) && q.options.length > 0) {
      const opts = q.options.map(opt => `
        <label class="option-label">
          <input type="radio" name="q_${i}" value="${escHtml(opt)}">
          <span>${escHtml(opt)}</span>
        </label>`).join('');
      inputHtml = `<div class="question-options">${opts}</div>`;
    } else {
      inputHtml = `<textarea class="question-open-input" placeholder="你的回答…" data-qi="${i}" rows="3"></textarea>`;
    }

    const hintHtml = q.hint ? `<p class="q-hint">探测维度：${escHtml(q.hint)}</p>` : '';
    div.innerHTML = textHtml + inputHtml + hintHtml;
    list.appendChild(div);
  });

  list.style.display = 'flex';
  $('quizSubmitRow').style.display = 'flex';
}

async function generateFromQuiz() {
  if (state.generating) return;
  if (state.questions.length === 0) { showError('请先生成评估问题'); return; }

  const answers = collectQuizAnswers();
  if (answers.unanswered > Math.floor(state.questions.length * 0.4)) {
    const ok = await confirmDanger(`还有 ${answers.unanswered} 道题未回答，继续生成？`, '问卷未完成', '继续生成');
    if (!ok) return;
  }

  state.lastGenMode = 'quiz';
  await runCharGeneration({
    mode: 'quiz',
    questionsAndAnswers: answers.qa,
    charType: state.charType,
    traversalMethod: state.traversalMethod,
    traversalDesc: state.traversalDesc,
  });
}

function collectQuizAnswers() {
  const list = $('questionList');
  const items = list.querySelectorAll('.question-item');
  const qa = [];
  let unanswered = 0;

  items.forEach((item, i) => {
    const q = state.questions[i];
    if (!q) return;
    let answer = '';

    if (q.type === 'choice') {
      const checked = item.querySelector(`input[name="q_${i}"]:checked`);
      answer = checked ? checked.value : '';
    } else {
      const ta = item.querySelector('textarea');
      answer = ta ? ta.value.trim() : '';
    }

    if (!answer) unanswered++;
    qa.push({ question: q.question, answer, hint: q.hint });
  });

  return { qa, unanswered };
}

// ─── Background Mode ──────────────────────────────────────────────────────────
function setupBgMode() {
  $('btnGenFromBg').addEventListener('click', generateFromBackground);
}

async function generateFromBackground() {
  if (state.generating) return;
  const background = $('bgInput').value.trim();
  if (!background) { showError('请输入角色背景描述'); return; }

  const gender = qs('input[name="gender"]:checked')?.value;
  const age    = $('ageRange').value.trim();
  const name   = $('nameInput').value.trim();

  state.lastGenMode = 'background';
  await runCharGeneration({
    mode: 'background',
    background,
    preferences: { gender, age, name },
    charType: state.charType,
    traversalMethod: state.traversalMethod,
    traversalDesc: state.traversalDesc,
  });
}

// ─── Core Character Generation ────────────────────────────────────────────────
async function runCharGeneration(body) {
  setGenerating(true, '正在生成角色档案…');
  clearError();

  const streamEl = state.mode === 'quiz' ? $('quizStream') : $('bgStream');
  streamEl.textContent = '';
  streamEl.style.display = 'block';

  let fullText = '';
  try {
    const result = await ssePost(
      '/api/character/generate',
      body,
      delta => {
        fullText += delta;
        streamEl.textContent = fullText.slice(-600);
        streamEl.scrollTop = streamEl.scrollHeight;
      }
    );
    streamEl.style.display = 'none';

    let character = result.character;
    if (!character) {
      try {
        const m = fullText.match(/```json\s*([\s\S]*?)\s*```/i);
        character = JSON.parse(m ? m[1] : (fullText.match(/\{[\s\S]*"name"[\s\S]*\}/)?.[0] || ''));
      } catch (_) {}
    }

    if (character && character.name) {
      character._charType = state.charType;
      state.currentCharacter = character;
      populateCharacterCard(character);
      $('resultPanel').style.display = 'flex';
      $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('btnApply').disabled = false;
      toast('角色档案生成完成');
    } else {
      showError('角色数据解析失败，请重试');
    }
  } catch (err) {
    streamEl.style.display = 'none';
    showError(err.message);
  }
  setGenerating(false);
}

// ─── Archive Panel ────────────────────────────────────────────────────────────
function setupArchivePanel() {
  $('btnArchiveRefresh').addEventListener('click', loadArchiveList);
}

async function loadArchiveList() {
  const listEl = $('archiveList');
  listEl.innerHTML = window.UIFeedback
    ? window.UIFeedback.renderLoadingLines(4)
    : '<p class="archive-loading">加载中…</p>';
  try {
    const chars = await fetch('/api/characters').then(r => r.json());
    if (!chars.length) {
      listEl.innerHTML = window.UIFeedback
        ? window.UIFeedback.renderEmpty('暂无保存的角色档案。生成角色后点击「存入档案库」即可保存。')
        : '<p class="archive-empty">暂无保存的角色档案。<br>生成角色后点击「存入档案库」即可保存。</p>';
      return;
    }
    listEl.innerHTML = chars.map(c => renderArchiveCard(c)).join('');
    listEl.querySelectorAll('.archive-load-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        await loadCharFromArchive(id);
      });
    });
    listEl.querySelectorAll('.archive-del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const name = btn.dataset.name;
        const ok = await confirmDanger(`确定删除角色「${name}」吗？此操作不可恢复。`, '删除角色', '确认删除');
        if (!ok) return;
        await deleteCharFromArchive(id);
      });
    });
  } catch (e) {
    listEl.innerHTML = window.UIFeedback
      ? window.UIFeedback.renderEmpty(`加载失败：${escHtml(e.message)}`)
      : `<p class="archive-empty error">加载失败：${escHtml(e.message)}</p>`;
  }
}

function renderArchiveCard(c) {
  const typeTag = c.hasPowers
    ? '<span class="arch-tag arch-tag-power">⚡ 超凡</span>'
    : '<span class="arch-tag arch-tag-normal">👤 普通</span>';
  const mechTag = c.hasMechs ? '<span class="arch-tag arch-tag-mech">🤖 机体</span>' : '';
  const traits = (c.traits || []).slice(0, 3).map(t => `<span class="arch-trait">${escHtml(t)}</span>`).join('');
  const date = c.createdAt ? new Date(c.createdAt).toLocaleDateString('zh-CN') : '';
  return `
  <div class="archive-card" data-id="${c.id}">
    <div class="arch-head">
      <div class="arch-name-row">
        <span class="arch-name">${escHtml(c.name)}</span>
        ${c.title ? `<span class="arch-title-text">${escHtml(c.title)}</span>` : ''}
        ${typeTag}${mechTag}
      </div>
      <div class="arch-meta">
        ${c.identity ? `<span class="arch-identity">${escHtml(c.identity)}</span>` : ''}
        ${c.age ? `<span class="arch-age">${escHtml(c.age)}岁</span>` : ''}
        ${c.alignment ? `<span class="arch-align">${escHtml(c.alignment)}</span>` : ''}
      </div>
    </div>
    ${traits ? `<div class="arch-traits">${traits}</div>` : ''}
    <div class="arch-footer">
      <span class="arch-date">${date}</span>
      <div class="arch-actions">
        <button class="btn-ghost btn-sm archive-load-btn" data-id="${c.id}">载入预览</button>
        <button class="btn-danger btn-sm archive-del-btn" data-id="${c.id}" data-name="${escHtml(c.name)}">删除</button>
      </div>
    </div>
  </div>`;
}

async function loadCharFromArchive(id) {
  try {
    const entry = await fetch(`/api/characters/${id}`).then(r => r.json());
    const character = entry.character;
    if (!character) throw new Error('档案数据为空');
    state.currentCharacter = character;
    state.charType = character._charType || '本土';
    populateCharacterCard(character);
    // Switch to result view
    $('resultPanel').style.display = 'flex';
    $('resultPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('btnApply').disabled = false;
    toast(`已载入角色「${character.name}」`);
    // Switch to background tab so user can see the sidebar
    const bgTab = document.querySelector('.mode-tab[data-mode="background"]');
    if (bgTab) bgTab.click();
  } catch (e) {
    toast('载入失败：' + e.message);
  }
}

async function deleteCharFromArchive(id) {
  try {
    const res = await fetch(`/api/characters/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error((await res.json()).error);
    toast('已删除');
    await loadArchiveList();
  } catch (e) {
    toast('删除失败：' + e.message);
  }
}

// ─── Editable Section Schemas ─────────────────────────────────────────────────
const EDIT_SCHEMAS = {
  energyPools: {
    addLabel: '添加能量池', sectionId: 'poolsSection', containerId: 'fPools',
    titleField: 'name', getTitle: i => i.name || '',
    defaultItem: { name: '', maxValue: 100, description: '' },
    fields: [
      { key: 'name',        label: '名称',     type: 'text',   required: true, placeholder: '如：灵力 / 魔力' },
      { key: 'maxValue',    label: '初始上限', type: 'number', min: 0, max: 999999, step: 1, default: 100 },
      { key: 'description', label: '说明',     type: 'text',   placeholder: '能量池用途（可选）' },
    ],
  },
  passiveAbilities: {
    addLabel: '添加被动能力', sectionId: 'passivesSection', containerId: 'fPassives',
    titleField: 'name', getTitle: i => i.name || '', getBadge: i => `${i.tier || 0}★`,
    defaultItem: { name: '', type: 'Talent', tier: 0, desc: '', tags: [] },
    fields: [
      { key: 'name', label: '名称',         type: 'text',     required: true },
      { key: 'type', label: '类型',         type: 'text',     placeholder: 'Talent / Innate / Racial' },
      { key: 'tier', label: '星级',         type: 'number',   min: 0, max: 16, step: 1, default: 0 },
      { key: 'desc', label: '效果描述',     type: 'textarea', rows: 3 },
      { key: 'tags', label: '标签（逗号分隔）', type: 'tags', placeholder: '标签1, 标签2' },
    ],
  },
  powerSources: {
    addLabel: '添加力量来源', sectionId: 'powerSection', containerId: 'fPower',
    titleField: 'name', getTitle: i => i.name || '', getBadge: i => `${i.tier || 0}★`,
    defaultItem: { name: '', type: 'RootSystem', tier: 0, realm: '初阶', aptitudeGrade: 'C', aptitudeTitle: '', poolName: '', poolMax: 100, desc: '' },
    fields: [
      { key: 'name',          label: '名称',       type: 'text',   required: true },
      { key: 'type',          label: '类型',       type: 'text',   placeholder: 'RootSystem / Bloodline / Divine' },
      { key: 'tier',          label: '星级',       type: 'number', min: 0, max: 16, step: 1, default: 0 },
      { key: 'realm',         label: '当前境界',   type: 'text',   placeholder: '初阶 / 炼气期 / 等' },
      { key: 'aptitudeGrade', label: '资质评级',   type: 'select', options: ['S', 'A', 'B', 'C', 'D', 'F'] },
      { key: 'aptitudeTitle', label: '天赋称号',   type: 'text',   placeholder: '如：万古奇才（可留空）' },
      { key: 'poolName',      label: '能量池名称', type: 'text',   placeholder: '如：灵力（留空表示无专属能量池）' },
      { key: 'poolMax',       label: '能量池上限', type: 'number', min: 0, max: 999999, step: 1, default: 100 },
      { key: 'desc',          label: '原理描述',   type: 'textarea', rows: 3 },
    ],
  },
  techniques: {
    addLabel: '添加技法流派', sectionId: 'techSection', containerId: 'fTech',
    titleField: 'schoolName',
    getTitle: i => i.schoolName || i.name || '',
    getBadge: i => `${i.tier || 0}★`,
    defaultItem: { schoolName: '', type: 'Active', tier: 0, parentSource: '', desc: '', subTechniques: [] },
    fields: [
      { key: 'schoolName',   label: '流派名称',   type: 'text',     required: true, placeholder: '如：无限武库·基础构式技法 / 柔道·投技' },
      { key: 'type',         label: '类型',       type: 'select',   options: ['Active', 'Passive', 'Support', 'Utility'] },
      { key: 'tier',         label: '流派星级',   type: 'number',   min: 0, max: 16, step: 1, default: 0 },
      { key: 'parentSource', label: '驱动基盘',   type: 'text',     placeholder: '依赖的力量来源名称（无则留空）' },
      { key: 'desc',         label: '流派描述',   type: 'textarea', rows: 2, placeholder: '流派的风格、原理或来源' },
      { key: 'subTechniques', label: '招式列表（每行一个，格式：招式名 | 效果描述 | 消耗）',
        type: 'subtech', rows: 5,
        placeholder: '基础构式·形 | 将演算力塑形为钝击冲击波，造成ATK×2伤害 | 5演算力\n强化·体能 | 临时提升STR/AGI各×1.5，持续3回合 | 10演算力' },
    ],
  },
  mechs: {
    addLabel: '添加机体/法宝/召唤物', sectionId: 'mechsSection', containerId: 'fMechs',
    titleField: 'unitName', getTitle: i => i.unitName || '', getBadge: i => `${i.tier || 0}★`,
    defaultItem: { unitName: '', model: '', tier: 0, totalIntegrity: 1000, energyMax: 100, height: 'N/A', hasMI: false, miName: '', designStyle: '', desc: '' },
    fields: [
      { key: 'unitName',        label: '名称',      type: 'text',     required: true },
      { key: 'model',           label: '型号/代号', type: 'text',     placeholder: '型号或代号（可留空）' },
      { key: 'tier',            label: '星级',      type: 'number',   min: 0, max: 16, step: 1, default: 0 },
      { key: 'totalIntegrity',  label: '结构值',    type: 'number',   min: 0, max: 9999999, default: 1000 },
      { key: 'energyMax',       label: 'EN上限',    type: 'number',   min: 0, max: 9999999, default: 100 },
      { key: 'height',          label: '尺寸高度',  type: 'text',     placeholder: '如 18m / N/A' },
      { key: 'hasMI',           label: '搭载AI',    type: 'checkbox', checkLabel: '搭载机体AI / 意识核' },
      { key: 'miName',          label: 'AI名称',    type: 'text',     placeholder: 'AI或意识核的名字' },
      { key: 'designStyle',     label: '外观风格',  type: 'text',     placeholder: '外观设计描述' },
      { key: 'desc',            label: '机体描述',  type: 'textarea', rows: 3 },
    ],
  },
  startingItems: {
    addLabel: '添加随身物品', sectionId: 'itemsSection', containerId: 'fItems',
    titleField: 'name', getTitle: i => i.name || '',
    defaultItem: { name: '', type: 'Misc', desc: '' },
    fields: [
      { key: 'name', label: '名称', type: 'text',     required: true },
      { key: 'type', label: '类型', type: 'text',     placeholder: 'Weapon / Armor / Tool / Misc / Consumable' },
      { key: 'desc', label: '描述', type: 'textarea', rows: 2 },
    ],
  },
  knowledge: {
    addLabel: '添加知识节点', sectionId: 'knowledgeSection', containerId: 'fKnowledge',
    titleField: 'topic', getTitle: i => i.topic || '',
    defaultItem: { topic: '', mastery: '初步了解', summary: '' },
    fields: [
      { key: 'topic',   label: '主题',     type: 'text',     required: true, placeholder: '知识领域或技能主题' },
      { key: 'mastery', label: '掌握程度', type: 'select',   options: ['初步了解', '熟练', '精通', '完全解析'] },
      { key: 'summary', label: '内容摘要', type: 'textarea', rows: 3 },
    ],
  },
};

// ─── Editable Section Helpers ─────────────────────────────────────────────────

function initEditData(c) {
  let energyPools = [];
  if (Array.isArray(c.energyPools) && c.energyPools.length > 0) {
    energyPools = c.energyPools.map(p => ({ ...p }));
  } else if (Array.isArray(c.powerSources)) {
    energyPools = c.powerSources
      .filter(p => p && p.poolName && !String(p.poolName).includes('体力'))
      .map(p => ({ name: p.poolName, maxValue: p.poolMax || 100, description: `来自「${p.name}」` }));
  }
  state.editData = {
    attributes:       Object.assign({ STR:1.0, DUR:1.0, VIT:1.0, REC:1.0, AGI:1.0, REF:1.0, PER:1.0, MEN:1.0, SOL:1.0, CHA:1.0 }, c.attributes || {}),
    energyPools,
    passiveAbilities: (c.passiveAbilities || []).map(a => ({ ...a })),
    powerSources:     (c.powerSources     || []).map(p => ({ ...p })),
    techniques: (c.techniques || []).map(t => {
      const copy = { ...t };
      // Normalize: old format used `name` + `school`, new format uses `schoolName`
      if (!copy.schoolName && copy.name) copy.schoolName = copy.name;
      // Deep-copy subTechniques if present
      if (Array.isArray(copy.subTechniques)) copy.subTechniques = copy.subTechniques.map(st => ({ ...st }));
      else copy.subTechniques = [];
      return copy;
    }),
    mechs:            (c.mechs            || []).map(m => ({ ...m })),
    startingItems:    (c.startingItems    || []).map(i => ({ ...i })),
    knowledge:        (c.knowledge        || []).map(k => ({ ...k })),
  };
}

function renderEditableAttributes() {
  const ATTR_DEFS = [
    ['STR','力量'],['DUR','耐力'],['VIT','体质'],['REC','恢复'],['AGI','敏捷'],
    ['REF','反应'],['PER','感知'],['MEN','精神'],['SOL','灵魂'],['CHA','魅力'],
  ];
  const attrs = state.editData.attributes;
  $('statsSection').style.display = '';
  $('fAttributes').innerHTML = ATTR_DEFS.map(([key, label]) => {
    const val = parseFloat(attrs[key]) || 1.0;
    const pct = Math.min(100, Math.round((val / 2.0) * 100));
    const cls = val >= 1.4 ? 'high' : val <= 0.7 ? 'low' : '';
    return `<div class="attr-item">
      <div class="attr-head">
        <span class="attr-key">${key}</span>
        <span class="attr-label">${label}</span>
        <input type="number" class="attr-val-input ${cls}" data-attr="${key}"
               value="${val.toFixed(1)}" step="0.1" min="0.1" max="10.0">
      </div>
      <div class="attr-bar-bg"><div class="attr-bar ${cls}" id="attrBar_${key}" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
  $('fAttributes').querySelectorAll('.attr-val-input').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.attr;
      const val = Math.max(0.1, parseFloat(input.value) || 0.1);
      state.editData.attributes[key] = val;
      const pct = Math.min(100, Math.round((val / 2.0) * 100));
      const cls = val >= 1.4 ? 'high' : val <= 0.7 ? 'low' : '';
      input.className = `attr-val-input ${cls}`;
      const bar = $(`attrBar_${key}`);
      if (bar) { bar.className = `attr-bar ${cls}`; bar.style.width = pct + '%'; }
    });
  });
}

function createEditableList(schemaKey) {
  const schema = EDIT_SCHEMAS[schemaKey];
  const items  = state.editData[schemaKey];
  $(schema.sectionId).style.display = '';
  renderList(schema, items);
}

function renderList(schema, items) {
  const container = $(schema.containerId);
  const itemsHtml = items.map((item, idx) => buildItemHtml(item, idx, schema)).join('');
  container.innerHTML = itemsHtml +
    `<div class="add-item-row">
       <button class="btn-ghost btn-sm add-item-btn">＋ ${escHtml(schema.addLabel)}</button>
     </div>`;
  bindListEvents(schema, items);
}

function buildItemHtml(item, idx, schema) {
  const title = schema.getTitle(item);
  const badge = schema.getBadge ? schema.getBadge(item) : '';

  const fields = schema.fields.map(f => {
    const rawVal = item[f.key];
    const val    = (rawVal !== undefined && rawVal !== null) ? rawVal : (f.default !== undefined ? f.default : '');
    let input;
    switch (f.type) {
      case 'textarea':
        input = `<textarea class="ei-textarea" data-field="${f.key}" data-dtype="text" rows="${f.rows || 3}" placeholder="${escHtml(f.placeholder || '')}">${escHtml(String(val))}</textarea>`;
        break;
      case 'select': {
        const opts = (f.options || []).map(o => `<option value="${escHtml(o)}"${val === o ? ' selected' : ''}>${escHtml(o)}</option>`).join('');
        input = `<select class="ei-select" data-field="${f.key}" data-dtype="text">${opts}</select>`;
        break;
      }
      case 'checkbox':
        input = `<label class="ei-checkbox-row"><input type="checkbox" data-field="${f.key}" data-dtype="bool"${val ? ' checked' : ''}> ${escHtml(f.checkLabel || '')}</label>`;
        break;
      case 'number':
        input = `<input type="number" class="ei-input-num" data-field="${f.key}" data-dtype="number" value="${val}" step="${f.step || 1}" min="${f.min !== undefined ? f.min : 0}" max="${f.max !== undefined ? f.max : 9999}" placeholder="${escHtml(f.placeholder || '')}">`;
        break;
      case 'tags': {
        const tagStr = Array.isArray(val) ? val.join(', ') : String(val || '');
        input = `<input type="text" class="ei-input" data-field="${f.key}" data-dtype="tags" value="${escHtml(tagStr)}" placeholder="${escHtml(f.placeholder || '用逗号分隔')}">`;
        break;
      }
      case 'subtech': {
        // Serialize subTechniques[] → multi-line text "名称 | 描述 | 消耗"
        const subs = Array.isArray(item.subTechniques) ? item.subTechniques : [];
        const subtechText = subs.map(st => {
          const parts = [st.name || '', st.desc || '', st.costInitial || '无消耗'];
          return parts.join(' | ');
        }).join('\n');
        input = `<textarea class="ei-textarea" data-field="${f.key}" data-dtype="subtech" rows="${f.rows || 5}" placeholder="${escHtml(f.placeholder || '')}">${escHtml(subtechText)}</textarea>`;
        break;
      }
      default:
        input = `<input type="text" class="ei-input" data-field="${f.key}" data-dtype="text" value="${escHtml(String(val))}" placeholder="${escHtml(f.placeholder || '')}">`;
    }
    const reqMark = f.required ? '<span class="ei-required">*</span>' : '';
    return `<div class="ei-field"><label class="ei-label">${escHtml(f.label)}${reqMark}</label>${input}</div>`;
  }).join('');

  return `<div class="editable-item" data-idx="${idx}">
    <div class="ei-header">
      <span class="ei-title">${escHtml(title) || '<em style="opacity:.4">未命名</em>'}</span>
      ${badge ? `<span class="tier-badge ei-badge">${escHtml(badge)}</span>` : ''}
      <div class="ei-actions">
        <button class="btn-ghost btn-xs ei-toggle">编辑</button>
        <button class="btn-danger btn-xs ei-delete">×</button>
      </div>
    </div>
    <div class="ei-form" style="display:none">
      <div class="ei-fields">${fields}</div>
    </div>
  </div>`;
}

function bindListEvents(schema, items) {
  const container = $(schema.containerId);

  container.querySelectorAll('.ei-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.editable-item');
      const form = card.querySelector('.ei-form');
      const isOpen = form.style.display !== 'none';
      form.style.display = isOpen ? 'none' : 'block';
      btn.textContent = isOpen ? '编辑' : '收起';
    });
  });

  container.querySelectorAll('.ei-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('.editable-item');
      const idx  = parseInt(card.dataset.idx);
      items.splice(idx, 1);
      renderList(schema, items);
    });
  });

  const addBtn = container.querySelector('.add-item-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      items.push(JSON.parse(JSON.stringify(schema.defaultItem)));
      renderList(schema, items);
      const cards = container.querySelectorAll('.editable-item');
      const last  = cards[cards.length - 1];
      if (last) {
        last.querySelector('.ei-form').style.display = 'block';
        last.querySelector('.ei-toggle').textContent = '收起';
        last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  container.querySelectorAll('[data-field]').forEach(input => {
    const isCheck = input.type === 'checkbox';
    input.addEventListener(isCheck ? 'change' : 'input', () => {
      const card  = input.closest('.editable-item');
      if (!card) return;
      const idx   = parseInt(card.dataset.idx);
      const field = input.dataset.field;
      const dtype = input.dataset.dtype;
      let val;
      if (dtype === 'bool')   val = input.checked;
      else if (dtype === 'number') val = parseFloat(input.value) || 0;
      else if (dtype === 'tags')   val = input.value.split(',').map(s => s.trim()).filter(Boolean);
      else if (dtype === 'subtech') {
        // Parse "名称 | 描述 | 消耗" lines → subTechniques array
        items[idx].subTechniques = input.value.split('\n')
          .map(line => line.trim()).filter(Boolean)
          .map(line => {
            const parts = line.split('|').map(s => s.trim());
            return {
              name: parts[0] || '',
              desc: parts[1] || '',
              costInitial: parts[2] || '无消耗',
              type: 'Active', proficiencyLevel: '入门',
              costMaintenance: '无', castTime: 'Instant', cooldown: 'None',
              hasRisk: false, riskDesc: '', tier: 0,
              stance: '', chant: '', visualFX: '',
            };
          }).filter(st => st.name);
        // Re-render header (title updates on schoolName change, badge on tier)
        const card = input.closest('.editable-item');
        if (card) card.querySelector('.ei-title').textContent = schema.getTitle(items[idx]) || '';
        return;
      }
      else val = input.value;
      items[idx][field] = val;
      // Live-update header title
      if (field === schema.titleField) {
        const titleEl = card.querySelector('.ei-title');
        if (titleEl) titleEl.innerHTML = escHtml(schema.getTitle(items[idx])) || '<em style="opacity:.4">未命名</em>';
      }
      // Live-update tier badge
      if (field === 'tier' && schema.getBadge) {
        const badgeEl = card.querySelector('.ei-badge');
        if (badgeEl) badgeEl.textContent = schema.getBadge(items[idx]);
      }
    });
  });
}

// ─── Dimension Rendering ──────────────────────────────────────────────────────
const DIM_DEFS = {
  social:    [['introExtro','内倾/外倾'],['trustRadius','疑人/信人'],['dominance','顺从/主导'],['empathy','冷漠/共情'],['boundaryStrength','无界/强界']],
  emotional: [['stability','动荡/稳定'],['expressiveness','压抑/外放'],['recoverySpeed','慢愈/快愈'],['emotionalDepth','肤浅/深邃']],
  cognitive: [['analyticIntuitive','直觉/分析'],['openness','封闭/开放'],['riskTolerance','避险/嗜险'],['selfAwareness','自盲/自知']],
  values:    [['autonomy','顺从/自主'],['altruism','利己/利他'],['rationality','情绪/理性'],['loyalty','轻义/极忠'],['idealism','现实/理想']],
};

function renderDimBar(containerId, catKey, dimsData, defs) {
  const container = $(containerId);
  if (!container) return;
  const existingBars = container.querySelectorAll('.dim-row');
  existingBars.forEach(el => el.remove());
  if (!dimsData) return;
  defs.forEach(([key, label]) => {
    const rawVal = dimsData[key];
    const val = typeof rawVal === 'number' ? Math.max(-10, Math.min(10, rawVal)) : 0;
    const pct = Math.abs(val) * 5; // 0-50%
    const isPos = val >= 0;
    const row = document.createElement('div');
    row.className = 'dim-row';
    row.innerHTML = `
      <span class="dim-label">${label}</span>
      <div class="dim-track">
        <div class="${isPos ? 'dim-fill-pos' : 'dim-fill-neg'}" style="width:${pct}%"></div>
      </div>
      <span class="dim-value">${val > 0 ? '+' : ''}${val}</span>`;
    container.appendChild(row);
  });
}

function renderDimensions(dims) {
  const section = $('dimSection');
  if (!section) return;
  if (!dims || typeof dims !== 'object') { section.style.display = 'none'; return; }
  renderDimBar('dimSocial',    'social',    dims.social    || null, DIM_DEFS.social);
  renderDimBar('dimEmotional', 'emotional', dims.emotional || null, DIM_DEFS.emotional);
  renderDimBar('dimCognitive', 'cognitive', dims.cognitive || null, DIM_DEFS.cognitive);
  renderDimBar('dimValues',    'values',    dims.values    || null, DIM_DEFS.values);
  section.style.display = '';
}

function renderContextModes(modes) {
  const section = $('contextSection');
  const container = $('fContextModes');
  if (!section || !container) return;
  if (!modes || typeof modes !== 'object' || !Object.keys(modes).length) {
    section.style.display = 'none'; return;
  }
  const CTX_LABELS = {
    withStrangers: '面对陌生人', withFriends: '面对熟人', whenInterested: '感兴趣时',
    underThreat: '受到威胁', whenLectured: '被说教时', withAuthority: '面对权威',
  };
  container.innerHTML = Object.entries(modes).map(([ctx, v]) => {
    const modsArr = v.mods
      ? Object.entries(v.mods).map(([k, n]) => `<span class="ctx-mod">${k}${n >= 0 ? '+' : ''}${n}</span>`).join('')
      : '';
    return `<div class="ctx-card">
      <div class="ctx-title">${CTX_LABELS[ctx] || ctx}</div>
      <div class="ctx-note">${escHtml(v.note || '')}</div>
      ${modsArr ? `<div class="ctx-mods">${modsArr}</div>` : ''}
    </div>`;
  }).join('');
  section.style.display = '';
}

function renderTriggerPatterns(patterns) {
  const section = $('triggerSection');
  const container = $('fTriggerPatterns');
  if (!section || !container) return;
  if (!Array.isArray(patterns) || !patterns.length) { section.style.display = 'none'; return; }
  container.innerHTML = patterns.map(t => {
    const intensity = Math.max(1, Math.min(10, Number(t.intensity) || 5));
    const intensityClass = intensity >= 8 ? 'high' : intensity >= 5 ? 'mid' : 'low';
    return `<div class="trigger-item">
      <div class="trigger-header">
        <span class="trigger-intensity ${intensityClass}">${intensity}/10</span>
        <span class="trigger-cond">IF「${escHtml(t.trigger || '')}」</span>
      </div>
      <div class="trigger-react">→ ${escHtml(t.reaction || '')}</div>
    </div>`;
  }).join('');
  section.style.display = '';
}

// ─── Populate Card ────────────────────────────────────────────────────────────
function populateCharacterCard(c) {
  initEditData(c);
  $('fName').value       = c.name       || '';
  $('fGender').value     = c.gender     || '';
  $('fAge').value        = c.age        || '';
  $('fTitle').value      = c.title      || '';
  $('fHeight').value     = c.height     || '';
  $('fWeight').value     = c.weight     || '';
  $('fIdentity').value   = c.identity   || '';
  $('fAlignment').value  = c.alignment  || '';
  $('fAppearance').value = c.appearance || '';
  $('fClothing').value   = c.clothing   || '';
  $('fBackground').value = c.background || '';
  $('fPersonality').value = Array.isArray(c.personality)
    ? c.personality.join('\n')
    : (c.personality || '');

  setTags('fTraits',  c.traits   || []);
  setTags('fFlaws',   c.flaws    || []);
  setTags('fDesires', c.desires  || []);
  setTags('fFears',   c.fears    || []);
  setTags('fQuirks',  c.quirks   || []);

  // ── Psychological dimensions ──
  renderDimensions(c.dimensions || null);
  renderContextModes(c.contextModes || null);
  renderTriggerPatterns(c.triggerPatterns || []);

  // ── Editable sections ──
  renderEditableAttributes();
  createEditableList('energyPools');
  createEditableList('passiveAbilities');
  createEditableList('powerSources');
  createEditableList('techniques');
  createEditableList('mechs');
  createEditableList('startingItems');
  createEditableList('knowledge');
}

// Helper: show/hide a section and render card list
function toggleSection(sectionId, containerId, items, renderFn) {
  const section = $(sectionId);
  if (items.length > 0) {
    $(containerId).innerHTML = items.map(renderFn).join('');
    section.style.display = '';
  } else {
    section.style.display = 'none';
  }
}

// ─── Tag Editors ──────────────────────────────────────────────────────────────
function setupTagEditors() {
  document.querySelectorAll('.tag-editor').forEach(editor => {
    editor.addEventListener('click', (e) => {
      if (e.target === editor) {
        const inp = editor.querySelector('.tag-add-input');
        if (inp) inp.focus();
      }
    });
  });
}

function setTags(containerId, tags) {
  const editor = $(containerId);
  editor.innerHTML = '';
  tags.forEach(tag => addTagEl(editor, tag));
  addTagInput(editor);
}

function addTagEl(editor, text) {
  const span = document.createElement('span');
  span.className = 'tag-item';
  span.innerHTML = `${escHtml(text)}<button class="tag-del" title="删除">×</button>`;
  span.querySelector('.tag-del').addEventListener('click', () => span.remove());
  editor.insertBefore(span, editor.querySelector('.tag-add-input'));
}

function addTagInput(editor) {
  if (editor.querySelector('.tag-add-input')) return;
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'tag-add-input';
  inp.placeholder = '添加…';
  inp.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ',') && inp.value.trim()) {
      e.preventDefault();
      addTagEl(editor, inp.value.trim());
      inp.value = '';
    } else if (e.key === 'Backspace' && !inp.value) {
      const tags = editor.querySelectorAll('.tag-item');
      if (tags.length > 0) tags[tags.length - 1].remove();
    }
  });
  editor.appendChild(inp);
}

function getTagValues(containerId) {
  return [...$(containerId).querySelectorAll('.tag-item')]
    .map(el => el.childNodes[0]?.textContent?.trim())
    .filter(Boolean);
}

// ─── Result Panel Actions ─────────────────────────────────────────────────────
function setupResultPanel() {
  $('btnRegenerate').addEventListener('click', () => {
    if (state.lastGenMode === 'quiz') generateFromQuiz();
    else generateFromBackground();
  });
  $('btnSaveArchive').addEventListener('click', saveToArchive);
  $('btnApply').addEventListener('click', () => applyCharacter());
  $('btnApplyBottom').addEventListener('click', () => applyCharacter());
  $('btnNewSession').addEventListener('click', () => applyCharacter(true));
}

async function saveToArchive() {
  if (!state.currentCharacter) { toast('没有可保存的角色'); return; }
  const formValues = readCardValues();
  const character = Object.assign({}, state.currentCharacter, formValues, {
    _charType: state.charType,
  });
  if (!character.name) { toast('请先填写角色姓名'); return; }
  try {
    const res = await fetch('/api/characters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '保存失败');
    toast(`角色「${character.name}」已存入档案库`);
    $('btnSaveArchive').textContent = '✓ 已存入档案库';
  } catch (e) {
    toast('保存失败：' + e.message);
  }
}

function readCardValues() {
  const d = state.editData || {};
  return {
    name:        $('fName').value.trim(),
    gender:      $('fGender').value.trim(),
    age:         $('fAge').value.trim(),
    title:       $('fTitle').value.trim(),
    height:      $('fHeight').value.trim(),
    weight:      $('fWeight').value.trim(),
    identity:    $('fIdentity').value.trim(),
    alignment:   $('fAlignment').value.trim(),
    appearance:  $('fAppearance').value.trim(),
    clothing:    $('fClothing').value.trim(),
    background:  $('fBackground').value.trim(),
    personality: $('fPersonality').value.trim().split('\n').map(l => l.trim()).filter(Boolean),
    traits:      getTagValues('fTraits'),
    flaws:       getTagValues('fFlaws'),
    desires:     getTagValues('fDesires'),
    fears:       getTagValues('fFears'),
    quirks:      getTagValues('fQuirks'),
    // Editable sections
    attributes:       d.attributes       || {},
    energyPools:      d.energyPools      || [],
    passiveAbilities: d.passiveAbilities || [],
    powerSources:     d.powerSources     || [],
    techniques:       d.techniques       || [],
    mechs:            d.mechs            || [],
    startingItems:    d.startingItems    || [],
    knowledge:        d.knowledge        || [],
  };
}

async function applyCharacter(createNew = false) {
  const formValues = readCardValues();
  const character = Object.assign({}, state.currentCharacter || {}, formValues, {
    _charType: state.charType,
  });
  if (!character.name) { showApplyStatus('请填写角色姓名', true); return; }

  let sessionId = $('applySession').value;

  if (createNew || !sessionId) {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${character.name} 的故事`, greetingIndex: -1 }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '创建存档失败');
      }
      const sess = await res.json();
      sessionId = sess.id;
      await loadSessions();
      $('applySession').value = sessionId;
    } catch (err) {
      showApplyStatus(err.message, true);
      return;
    }
  }

  if (!sessionId) { showApplyStatus('请选择一个存档', true); return; }

  try {
    const res = await fetch('/api/character/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character, sessionId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '应用失败');
    showApplyStatus(`✓ 已将「${character.name}」应用到存档`);
    $('btnApply').textContent = '✓ 已应用';
    $('btnApply').disabled = false;
    toast(`角色「${character.name}」已应用到存档`);
    await loadSessions();
    if (sessionId) $('applySession').value = sessionId;
  } catch (err) {
    showApplyStatus(err.message, true);
  }
}

function showApplyStatus(msg, isError = false) {
  const el = $('applyStatus');
  el.textContent = msg;
  el.className = 'apply-status' + (isError ? ' error' : '');
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function setGenerating(on, msg = '') {
  state.generating = on;
  $('genSpinner').style.display = on ? 'flex' : 'none';
  if (msg) $('spinnerText').textContent = msg;
  ['btnGenQuestions', 'btnGenFromQuiz', 'btnGenFromBg'].forEach(id => {
    const el = $(id);
    if (el) el.disabled = on;
  });
}

function clearError() {
  const el = $('genError');
  el.textContent = '';
  el.style.display = 'none';
}

function showError(msg) {
  const el = $('genError');
  el.textContent = '⚠ ' + msg;
  el.style.display = 'block';
}

// ─── SSE Post Helper ──────────────────────────────────────────────────────────
function ssePost(url, body, onChunk) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify(body));

    let rawBuf = '';
    let sseBuf = '';
    let resolved = false;
    const result = {};

    function processBlock(block) {
      const lines = block.split('\n');
      let ev = null, data = null;
      for (const line of lines) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) {
          try { data = JSON.parse(line.slice(5).trim()); } catch (_) {}
        }
      }
      if (!ev || data === null) return;

      if (ev === 'chunk' && data.delta) {
        onChunk && onChunk(data.delta);
      } else if (ev === 'done') {
        Object.assign(result, data);
        if (!resolved) { resolved = true; resolve(result); }
      } else if (ev === 'error') {
        if (!resolved) { resolved = true; reject(new Error(data.message || '生成失败')); }
      }
    }

    xhr.onreadystatechange = () => {
      if (xhr.readyState < 3) return;
      const newData = xhr.responseText.slice(rawBuf.length);
      rawBuf = xhr.responseText;
      sseBuf += newData;
      const blocks = sseBuf.split('\n\n');
      sseBuf = blocks.pop() || '';
      blocks.forEach(b => { if (b.trim()) processBlock(b); });
    };

    xhr.onload = () => {
      if (sseBuf.trim()) processBlock(sseBuf);
      if (!resolved) { resolved = true; resolve(result); }
    };

    xhr.onerror = () => { if (!resolved) reject(new Error('网络错误')); };
    xhr.ontimeout = () => { if (!resolved) reject(new Error('请求超时')); };
  });
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
