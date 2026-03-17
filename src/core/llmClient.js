'use strict';
/**
 * LLM Client — zero-dependency OpenAI-compatible HTTP client.
 * Uses raw https/http Node.js modules; no external packages required.
 * Supports streaming (SSE), abort, and DeepSeek-style reasoning_content.
 */

const https         = require('https');
const http          = require('http');
const { StringDecoder } = require('string_decoder');

// ─── Streaming Response Handler ───────────────────────────────────────────────

function handleStreamResponse(res, onChunk, onFinishReason, resolve, reject) {
  const decoder     = new StringDecoder('utf8');
  let   accumulated = '';
  let   buffer      = '';
  let   inThink     = false;

  res.on('data', (chunk) => {
    buffer += decoder.write(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      let parsed;
      try { parsed = JSON.parse(data); } catch (_) { continue; }

      const choice = parsed?.choices?.[0];
      if (!choice) continue;

      // Capture finish_reason when present
      if (choice.finish_reason && choice.finish_reason !== 'null' && onFinishReason) {
        onFinishReason(choice.finish_reason);
      }

      const delta = choice.delta || {};

      // DeepSeek reasoning_content — wrap in <think>…</think>
      if (delta.reasoning_content) {
        if (!inThink) { accumulated += '<think>'; inThink = true; }
        accumulated += delta.reasoning_content;
        if (onChunk) onChunk(delta.reasoning_content, accumulated);
      }

      if (delta.content) {
        if (inThink) { accumulated += '</think>\n'; inThink = false; }
        accumulated += delta.content;
        if (onChunk) onChunk(delta.content, accumulated);
      }
    }
  });

  res.on('end', () => {
    if (inThink) accumulated += '</think>\n';
    resolve(accumulated);
  });

  res.on('error', reject);
}

// ─── Non-Streaming Response Handler ──────────────────────────────────────────

function handleJsonResponse(res, resolve, reject) {
  const decoder = new StringDecoder('utf8');
  let   body    = '';

  res.on('data',  (chunk) => { body += decoder.write(chunk); });
  res.on('end',   () => {
    try {
      const parsed   = JSON.parse(body);
      const choice   = parsed?.choices?.[0];
      const content  = choice?.message?.content || '';
      const thinking = choice?.message?.reasoning_content || '';

      if (thinking) {
        resolve(`<think>${thinking}</think>\n${content}`);
      } else {
        resolve(content);
      }
    } catch (e) {
      reject(new Error(`Failed to parse LLM response: ${e.message}\nBody: ${body.slice(0, 200)}`));
    }
  });
  res.on('error', reject);
}

// ─── Core Request ─────────────────────────────────────────────────────────────

function createCompletion(config, messages, opts = {}) {
  return new Promise((resolve, reject) => {
    const {
      apiKey, baseUrl = 'https://api.openai.com',
      model = 'gpt-4o', temperature = 1.0, maxTokens = 4096,
      topP, frequencyPenalty, presencePenalty, seed, extraHeaders = {},
    } = config;

    const stream          = opts.stream || false;
    const onChunk         = opts.onChunk || null;
    const onRequest       = opts.onRequest || null;
    const onFinishReason  = opts.onFinishReason || null;

    const body = JSON.stringify({
      model,
      messages,
      stream,
      temperature,
      // Only include max_tokens when explicitly set (null/0/undefined = no limit)
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      ...(topP            != null && { top_p: topP }),
      ...(frequencyPenalty != null && { frequency_penalty: frequencyPenalty }),
      ...(presencePenalty  != null && { presence_penalty: presencePenalty }),
      ...(seed             != null && { seed }),
    });

    const base    = (baseUrl || 'https://api.openai.com').replace(/\/+$/, '');
    const fullUrl = `${base}/v1/chat/completions`;
    let   url;
    try { url = new URL(fullUrl); } catch (e) {
      return reject(new Error(`Invalid baseUrl: ${base} → ${e.message}`));
    }

    const headers = {
      'Content-Type':  'application/json',
      'Content-Length': Buffer.byteLength(body),
      ...extraHeaders,
    };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const transport = url.protocol === 'https:' ? https : http;
    const reqOpts   = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method:   'POST',
      headers,
    };

    const req = transport.request(reqOpts, (res) => {
      if (res.statusCode >= 400) {
        let errBody = '';
        res.on('data', (c) => { errBody += c.toString(); });
        res.on('end',  () => {
          let msg = `HTTP ${res.statusCode}`;
          try { msg = JSON.parse(errBody)?.error?.message || msg; } catch (_) {}
          reject(new Error(msg));
        });
        return;
      }
      if (stream) {
        handleStreamResponse(res, onChunk, onFinishReason, resolve, reject);
      } else {
        handleJsonResponse(res, resolve, reject);
      }
    });

    req.on('error', reject);
    if (onRequest) onRequest(req);
    req.write(body);
    req.end();
  });
}

// ─── Connection Test ──────────────────────────────────────────────────────────

async function testConnection(config) {
  try {
    const response = await createCompletion(config, [
      { role: 'user', content: 'Reply with the single word "OK" and nothing else.' },
    ], { stream: false });
    return { ok: true, response: response.trim() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { createCompletion, testConnection };
