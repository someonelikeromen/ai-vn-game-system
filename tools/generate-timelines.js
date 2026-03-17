'use strict';
/**
 * tools/generate-timelines.js
 * Batch-generates detailed timelines for all world archives that are missing one.
 *
 * Usage:
 *   node tools/generate-timelines.js            # process all archives without timeline
 *   node tools/generate-timelines.js --all      # regenerate even archives that already have one
 *   node tools/generate-timelines.js --id <id>  # process a single archive by ID
 *
 * Reads LLM config from config.json (uses shopApiKey/shopBaseUrl/shopModel if set).
 */

const path = require('path');
const { getConfig, buildShopLLMConfig } = require('../src/core/config');
const { createCompletion }              = require('../src/core/llmClient');
const worldArchiveStore                 = require('../src/features/world/worldArchiveStore');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const regenAll  = args.includes('--all');
const singleId  = (() => { const i = args.indexOf('--id'); return i >= 0 ? args[i + 1] : null; })();

// ─── Timeline generation prompt ───────────────────────────────────────────────
function buildTimelineMessages(archive) {
  const rulesText = (archive.worldRules || []).slice(0, 8)
    .map((r, i) => `${i + 1}. ${r}`).join('\n');
  const systemsText = (archive.powerSystems || [])
    .map(ps => `- ${ps.name}（${ps.category || '?'}）普通 ${ps.typicalTierRange || '?'} / 峰值 ${ps.peakTierRange || '?'}`)
    .join('\n');
  const factionsText = (archive.keyFactions || [])
    .map(f => `- ${f.name}（${f.attitude || '?'}）：${f.description || ''}`)
    .join('\n');

  const systemPrompt = `你是一名精通二次元作品年表的专业档案员，任务是为「${archive.displayName}」生成一份完整且极度精细的大事年表。

要求：
- **不设数量上限，越详细越好**。
- 按时间先后严格排列（最早→最近→未来预期）。
- \`time\` 字段精确到最小可知时间单位：能写「第3话·第2节课后」就不写「第1话」；能写「-2年3个月前」就不写「-约2年前」；对有明确年份/月份的事件，直接写出。
- \`event\` 字段：标题≤20字，不含具名技能/宝具名，但可出现角色名。
- \`impact\` 字段：1-2句话，说明对主线走向、势力消长、机遇/风险窗口的直接影响。
- 覆盖范围（缺一不可）：
  ① 塑造该世界现状的全部已知历史节点（神话起源→近代→故事开幕前）
  ② 以 "${archive.timePeriod || '故事开始'}" 为基准的完整剧情弧线（每一个重要场景/转折点单独一条）
  ③ 原作已发生的所有重要战斗/决策/死亡/觉醒事件
  ④ 未来可预见的关键节点（根据原作剧情走向推断，注明「预期」）
- 宁可多录不可少录。

输出格式（严格按此 JSON，\`\`\`json 包裹）：
\`\`\`json
{
  "timeline": [
    { "time": "时间节点", "event": "事件标题", "impact": "对主线/势力的影响" }
  ]
}
\`\`\``;

  const userContent = `请为「${archive.displayName}」（${archive.universe || ''}）生成完整大事年表。

## 档案基本信息
- 世界危险等级：${archive.worldTier ?? '?'}★（中位 ${archive.midTier ?? '?'}★）
- 当前时间背景：${archive.timePeriod || '未指定'}
- 定级依据：${archive.tierReason || '未记录'}
- 建议入场时间点：${archive.recommendedEntry || '未指定'}

## 主要世界法则（前8条）
${rulesText || '（无）'}

## 力量体系
${systemsText || '（无）'}

## 关键势力
${factionsText || '（无）'}

请根据你对「${archive.displayName}」原作的完整知识，生成不设上限的精细年表。`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userContent  },
  ];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const config    = getConfig();
  const llmConfig = buildShopLLMConfig(config);

  if (!llmConfig.apiKey) {
    console.error('ERROR: No API key configured. Set apiKey or shopApiKey in config.json.');
    process.exit(1);
  }

  let archives = worldArchiveStore.loadArchives();
  if (singleId) {
    archives = archives.filter(a => a.id === singleId);
    if (!archives.length) { console.error(`ERROR: Archive not found: ${singleId}`); process.exit(1); }
  } else if (!regenAll) {
    archives = archives.filter(a => !Array.isArray(a.timeline) || a.timeline.length === 0);
  }

  console.log(`\nGenerating timelines for ${archives.length} archive(s)…`);
  console.log(`Model: ${llmConfig.model} | Base URL: ${llmConfig.baseUrl}\n`);

  let ok = 0; let fail = 0;

  for (let i = 0; i < archives.length; i++) {
    const archive = archives[i];
    const label   = `[${i + 1}/${archives.length}] ${archive.displayName}`;
    process.stdout.write(`${label} … `);

    try {
      const messages = buildTimelineMessages(archive);
      let fullResponse = '';
      await createCompletion(llmConfig, messages, {
        stream:  true,
        onChunk: (_delta, accumulated) => {
          fullResponse = accumulated;
          // Show spinner progress
          const pct = Math.min(99, Math.round((fullResponse.length / 6000) * 99));
          process.stdout.write(`\r${label} … ${pct}%  `);
        },
      });
      process.stdout.write(`\r${label} … parsing…  `);

      // Parse JSON response
      let parsed;
      try {
        const m = fullResponse.match(/```json\s*([\s\S]*?)\s*```/i);
        parsed = JSON.parse(m ? m[1] : fullResponse.match(/\{[\s\S]*"timeline"[\s\S]*\}/)?.[0] || '');
      } catch (_) {
        parsed = null;
      }

      const timeline = parsed?.timeline;
      if (!Array.isArray(timeline) || timeline.length === 0) {
        process.stdout.write(`\r${label} … FAILED (parse error)\n`);
        fail++;
        continue;
      }

      // Save to archive
      worldArchiveStore.updateArchive(archive.id, { timeline });
      process.stdout.write(`\r${label} … OK (${timeline.length} events)\n`);
      ok++;

      // Small delay to avoid rate limiting
      if (i < archives.length - 1) await new Promise(r => setTimeout(r, 800));

    } catch (err) {
      process.stdout.write(`\r${label} … ERROR: ${err.message}\n`);
      fail++;
    }
  }

  console.log(`\n=== Done: ${ok} succeeded, ${fail} failed ===`);
  if (ok > 0) console.log('Timelines saved to data/world-archives.json');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
