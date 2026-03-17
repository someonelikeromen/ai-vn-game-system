'use strict';
/**
 * Regex Pipeline — applies the preset's regex rules to text.
 *
 * Each rule has:
 *   placement: [1]=user input, [2]=AI output, [3]=slash cmd
 *   promptOnly:    if true, apply only when building the prompt (strip for LLM)
 *   markdownOnly:  if true, apply only when rendering for display
 *   disabled:      skip when true
 *   findRegex:     regex string (may include flags like /pattern/g)
 *   replaceString: replacement (supports $1, $2 captures)
 *   minDepth/maxDepth: only apply at specific message depths
 */

// ─── Rule Application ─────────────────────────────────────────────────────────

function compileRegex(findRegex) {
  // If the pattern is /pattern/flags style, parse it
  const m = findRegex.match(/^\/(.+)\/([gimsuy]*)$/s);
  if (m) {
    try {
      return new RegExp(m[1], m[2] || 'g');
    } catch (_) {
      return null;
    }
  }
  // Otherwise treat as a literal regex string with global flag
  try {
    return new RegExp(findRegex, 'g');
  } catch (_) {
    return null;
  }
}

function applyRule(rule, text) {
  if (rule.disabled) return text;
  const re = compileRegex(rule.findRegex);
  if (!re) return text;

  // replaceString supports $1, $2 etc.
  return text.replace(re, rule.replaceString || '');
}

/**
 * Apply a set of rules filtered by placement and mode.
 *
 * @param {Array}  rules      - regex rules from preset
 * @param {string} text       - text to process
 * @param {number} placement  - 1=user, 2=assistant
 * @param {'prompt'|'display'} mode
 * @param {number} [depth]    - message depth for min/maxDepth filtering
 */
function applyRules(rules, text, placement, mode, depth = 0) {
  let result = text;
  for (const rule of rules) {
    if (rule.disabled) continue;
    if (!rule.placement.includes(placement)) continue;
    if (rule.minDepth != null && depth < rule.minDepth) continue;
    if (rule.maxDepth != null && depth > rule.maxDepth) continue;

    if (mode === 'prompt') {
      // In prompt mode: apply promptOnly rules, skip markdownOnly rules
      if (rule.markdownOnly && !rule.promptOnly) continue;
    } else if (mode === 'display') {
      // In display mode: apply markdownOnly rules, skip promptOnly rules
      if (rule.promptOnly && !rule.markdownOnly) continue;
    }

    result = applyRule(rule, result);
  }
  return result;
}

// ─── Specialized Processors ───────────────────────────────────────────────────

/**
 * Process AI output for display (chat UI rendering).
 * Applies: markdownOnly rules + rules that are neither prompt-only nor markdown-only.
 */
function processForDisplay(rules, text, depth = 0) {
  return applyRules(rules, text, 2, 'display', depth);
}

/**
 * Process AI output for the prompt history (remove noise, compress).
 * The AI must NOT see its own UpdateVariable blocks or think chains in history —
 * it communicates state changes through the <status_current_variables> snapshot instead.
 */
function processForPrompt(rules, text, depth = 0) {
  let result = applyRules(rules, text, 2, 'prompt', depth);
  // Strip <UpdateVariable> blocks — AI reads state via status snapshot
  result = result.replace(/<UpdateVariable[\s\S]*?<\/UpdateVariable\s*>/gi, '');
  // Strip <think> / <thinking> chains — reduces token waste in history
  result = result.replace(/<think(?:ing)?[\s\S]*?<\/think(?:ing)?>/gi, '');
  // Strip <SystemGrant> tags — handled separately, no need in history
  result = result.replace(/<SystemGrant[\s\S]*?<\/SystemGrant\s*>/gi, '');
  // Collapse excess blank lines left after stripping
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

/**
 * Process user input before sending to LLM.
 */
function processUserInput(rules, text, depth = 0) {
  return applyRules(rules, text, 1, 'prompt', depth);
}

// ─── Built-in Post-Processing ─────────────────────────────────────────────────

/**
 * Extract options from display text (content inside <options> tags).
 * Supports ">选项N：text" format and plain line/bullet lists.
 * Returns { cleanText, options: [{label, value}] }
 */
function extractOptions(text) {
  const options = [];
  const cleanText = text.replace(
    /<options>([\s\S]*?)<\/options>/gi,
    (_, inner) => {
      // Match ">选项N：text" or ">选项N:text" (N = Chinese numerals or digits)
      const arrowMatches = inner.match(/>选项[一二三四五六七八九十\d]+[：:]\s*([\s\S]*?)(?=>选项|$)/g);
      if (arrowMatches) {
        for (const m of arrowMatches) {
          const label = m.replace(/^>选项[一二三四五六七八九十\d]+[：:]\s*/, '').trim();
          if (label) options.push({ label, value: label });
        }
        return '';
      }

      // Fallback: newline/bullet list
      const lines = inner
        .split(/\n/)
        .map((l) => l.replace(/^[\s*\-•\d.>\[\]]+/, '').trim())
        .filter(Boolean);
      for (const l of lines) options.push({ label: l, value: l });
      return '';
    }
  );

  // Also look for <option> tags
  text.replace(/<option[^>]*>([\s\S]*?)<\/option>/gi, (_, inner) => {
    const label = inner.trim();
    if (label) options.push({ label, value: label });
  });

  return { cleanText: cleanText.trim(), options };
}

/**
 * Extract <danmu> tags for floating comment display.
 */
function extractDanmu(text) {
  const danmu = [];
  const cleanText = text.replace(/<danmu[^>]*>([\s\S]*?)<\/danmu>/gi, (_, inner) => {
    danmu.push(inner.trim());
    return '';
  });
  return { cleanText: cleanText.trim(), danmu };
}

/**
 * Convert <think>...</think> into a collapsible thought block.
 * Returns HTML string.
 */
function renderThinkBlock(text) {
  return text.replace(
    /<think>([\s\S]*?)<\/think>/gi,
    (_, inner) => {
      const content = inner.trim();
      if (!content) return '';
      return (
        `<details class="think-block"><summary>💭 思维链</summary>` +
        `<div class="think-content">${escapeHtml(content)}</div></details>`
      );
    }
  );
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Apply markdown-ish formatting and convert newlines to <br>.
 * Used ONLY on plain text segments — never on HTML already produced by regex rules.
 */
function renderPlainText(text) {
  return text
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

/**
 * Handle the mixed output from the regex pipeline.
 *
 * Content inside code fences (```...```) is injected as raw HTML (for think-block
 * accordions produced by preset rules); all other text gets standard markdown + <br>.
 */
function renderMixed(text) {
  const parts = [];
  const fence = /```(?:[a-zA-Z0-9]*)\n([\s\S]*?)\n```/g;
  let lastIdx = 0;
  let m;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(renderPlainText(text.slice(lastIdx, m.index)));
    parts.push(m[1]); // raw HTML — inject directly, no further processing
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(renderPlainText(text.slice(lastIdx)));
  return parts.join('');
}

/**
 * Full display pipeline: extract options & danmu, apply preset regex rules,
 * render think blocks, and produce final HTML.
 *
 * Key design decisions:
 *  - extractOptions / extractDanmu run BEFORE regex transforms so HTML-panel
 *    rules don't accidentally consume option/danmu blocks
 *  - Preset rules handle think-block accordion, tucao widget, event+progress widget
 *  - Fallback renderThinkBlock() catches any <think> tags not handled by rules
 *  - renderMixed() extracts code fences (raw HTML) from remaining text
 */
function fullDisplayPipeline(rules, rawText, depth = 0) {
  // Strip UpdateVariable blocks — users never see them
  let text = rawText.replace(/<UpdateVariable[\s\S]*?<\/UpdateVariable\s*>/gi, '').trim();

  // Strip SystemGrant tags — processed separately by the backend
  text = text.replace(/<SystemGrant[\s\S]*?<\/SystemGrant\s*>/gi, '');

  // Unwrap <content> wrapper tags (keep inner story text, discard the tags)
  text = text.replace(/<content>([\s\S]*?)<\/content\s*>/gi, '$1');

  // Strip the leading <think> tag that was prepended for the streaming indicator.
  text = text.replace(/^<think>\s*/i, '');

  // Collapse excess blank lines
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  // Extract options and danmu BEFORE regex transforms
  const { cleanText: textNoOpts, options } = extractOptions(text);
  const { cleanText: textNoDanmu, danmu }  = extractDanmu(textNoOpts);

  // Apply preset display regex rules (think accordion, tucao widget, event widget, etc.)
  let processed = processForDisplay(rules, textNoDanmu, depth);

  // Fallback: convert any <think>...</think> not consumed by preset rules
  processed = renderThinkBlock(processed);

  // Remove leftover structural tags the rules did not consume
  processed = processed
    .replace(/<current_event>[\s\S]*?<\/current_event\s*>/gi, '')
    .replace(/<progress>[\s\S]*?<\/progress\s*>/gi, '');

  // Render: code-fence blocks pass through as raw HTML; everything else gets
  // markdown formatting and newline→<br>
  const html = renderMixed(processed);

  return { html, options, danmu };
}

module.exports = {
  applyRule,
  applyRules,
  processForDisplay,
  processForPrompt,
  processUserInput,
  extractOptions,
  extractDanmu,
  renderThinkBlock,
  renderPlainText,
  renderMixed,
  fullDisplayPipeline,
};
