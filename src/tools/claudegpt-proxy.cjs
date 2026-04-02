#!/usr/bin/env node

/**
 * Minimal Anthropic-style proxy to OpenAI-compatible chat/completions.
 * Runs on plain Node (no Bun), so it works even when Bun can't read
 * package/tsconfig due to sandbox limits.
 *
 * Env:
 * - PROXY_PORT (default 8787)
 * - UPSTREAM_URL (default http://127.0.0.1:18789)
 * - UPSTREAM_CHAT_PATH (default /v1/chat/completions)
 * - UPSTREAM_MODEL (optional override)
 * - UPSTREAM_AUTH (Bearer token; falls back to OPENAI_API_KEY)
 */

const http = require('http');
const { Readable } = require('stream');

const PORT = parseInt(process.env.PROXY_PORT || '8787', 10);
const UPSTREAM_BASE = (process.env.UPSTREAM_URL || 'http://127.0.0.1:18789').replace(/\/$/, '');
const UPSTREAM_CHAT_PATH = process.env.UPSTREAM_CHAT_PATH || '/v1/chat/completions';
const UPSTREAM_MODEL = process.env.UPSTREAM_MODEL;
const UPSTREAM_AUTH = process.env.UPSTREAM_AUTH || process.env.OPENAI_API_KEY || '';

function anthropicToOpenAIMessages(input = [], system) {
  const out = [];
  if (system) out.push({ role: 'system', content: system });

  for (const msg of input) {
    let text = '';
    if (typeof msg?.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg?.content)) {
      text = msg.content
        .map((part) => {
          if (part && typeof part === 'object' && 'type' in part && part.type === 'text') {
            return part.text || '';
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    out.push({ role: msg.role, content: text });
  }
  return out;
}

async function forwardToUpstream(body, res) {
  console.log('[proxy] incoming messages payload keys:', Object.keys(body || {}));
  const {
    messages = [],
    system,
    model,
    stream = true,
    max_tokens,
    temperature,
    top_p,
    metadata,
  } = body;

  const oaMessages = anthropicToOpenAIMessages(messages, system);
  const upstreamModel = UPSTREAM_MODEL || model || 'gpt-4o';

  const payload = {
    model: upstreamModel,
    messages: oaMessages,
    stream,
    max_tokens,
    temperature,
    top_p,
    metadata,
  };

  const headers = { 'Content-Type': 'application/json' };
  if (UPSTREAM_AUTH) headers.Authorization = `Bearer ${UPSTREAM_AUTH}`;

  const upstream = await fetch(`${UPSTREAM_BASE}${UPSTREAM_CHAT_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const headerObj = {};
  upstream.headers.forEach((val, key) => {
    headerObj[key] = val;
  });

  res.writeHead(upstream.status, headerObj);

  if (!upstream.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstream.body).on('data', (chunk) => {
    res.write(chunk);
  }).on('end', () => res.end())
    .on('error', (err) => {
      console.error('[proxy] upstream stream error', err);
      if (!res.headersSent) res.writeHead(502);
      res.end('upstream stream error');
    });
}

const server = http.createServer((req, res) => {
  const { method, url } = req;
  if (method === 'GET' && url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (method === 'POST' && url === '/v1/messages') {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) {
        req.destroy();
      }
    });
    req.on('end', async () => {
      let parsed;
      try {
        parsed = JSON.parse(data || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid JSON');
        return;
      }
      try {
        await forwardToUpstream(parsed, res);
      } catch (err) {
        console.error('[proxy] upstream fetch error', err);
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('upstream fetch error');
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[claudegpt-proxy] listening on http://127.0.0.1:${PORT} -> ${UPSTREAM_BASE}${UPSTREAM_CHAT_PATH} (model=${UPSTREAM_MODEL || 'passthrough'}, auth=${UPSTREAM_AUTH ? 'set' : 'missing'})`);
});
