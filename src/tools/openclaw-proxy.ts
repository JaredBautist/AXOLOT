#!/usr/bin/env bun
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const PORT = parseInt(process.env.PROXY_PORT || '8787', 10);
const UPSTREAM_BASE = (process.env.UPSTREAM_URL || '').replace(/\/$/, '') || 'http://127.0.0.1:18789';
const UPSTREAM_MODEL = process.env.UPSTREAM_MODEL || 'openclaw';
const UPSTREAM_AUTH = process.env.UPSTREAM_AUTH || '';
const UPSTREAM_AUTH_HEADER = (process.env.UPSTREAM_AUTH_HEADER || 'authorization').trim().toLowerCase();
const UPSTREAM_CHAT_PATH = (process.env.UPSTREAM_CHAT_PATH || '').trim();
const LOG_FILE = process.env.CLAUDEX_PROXY_LOG || '.claude_tmp/logs/proxy-output.log';
const LOCAL_UPSTREAM_ONLY = process.env.CLAUDEX_UPSTREAM_LOCAL_ONLY !== '0';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function redactSecrets(input: string) {
  let out = input;
  if (UPSTREAM_AUTH) {
    out = out.split(UPSTREAM_AUTH).join('[REDACTED]');
  }
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]');
  out = out.replace(/("?(x-api-key|authorization|x-auth-token)"?\s*:\s*"?)([^",\s]+)("?)/gi, '$1[REDACTED]$4');
  return out;
}

function logToFile(msg: string) {
  mkdirSync(dirname(LOG_FILE), { recursive: true });
  const safeMsg = redactSecrets(msg);
  const line = `[${new Date().toISOString()}] ${safeMsg}\n`;
  appendFileSync(LOG_FILE, line);
  console.log(safeMsg);
}

function assertUpstreamSafety() {
  let parsed: URL;
  try {
    parsed = new URL(UPSTREAM_BASE);
  } catch {
    throw new Error(`UPSTREAM_URL invalid: ${UPSTREAM_BASE}`);
  }

  if (!LOCAL_UPSTREAM_ONLY) return;

  const host = parsed.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`UPSTREAM_URL blocked by security policy (non-local host): ${UPSTREAM_BASE}. Set CLAUDEX_UPSTREAM_LOCAL_ONLY=0 to allow remote hosts.`);
  }
}

function toOpenAIMessages(body: any) {
  const oaiMessages: any[] = [];

  for (const msg of body.messages || []) {
    if (Array.isArray(msg.content)) {
      let textBuf = '';
      for (const part of msg.content) {
        if (part.type === 'text') {
          textBuf += part.text;
          continue;
        }

        if (part.type === 'tool_result') {
          if (textBuf.trim().length) {
            oaiMessages.push({
              role: msg.role === 'assistant' ? 'assistant' : 'user',
              content: textBuf,
            });
            textBuf = '';
          }

          oaiMessages.push({
            role: 'tool',
            tool_call_id: part.tool_use_id || part.id || `tool_${Date.now()}`,
            content: typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? ''),
          });
        }
      }

      if (textBuf.trim().length) {
        oaiMessages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: textBuf,
        });
      }
      continue;
    }

    oaiMessages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
    });
  }

  return oaiMessages;
}

function toOpenAITools(body: any) {
  if (!Array.isArray(body.tools) || body.tools.length === 0) return undefined;
  return body.tools.map((tool: any) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema || { type: 'object' },
    },
  }));
}

function buildAuthHeaderValue(token: string) {
  return UPSTREAM_AUTH_HEADER === 'authorization' ? `Bearer ${token}` : token;
}

async function tryFetch(path: string, payload: any) {
  logToFile(`Trying route: ${UPSTREAM_BASE}${path}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (UPSTREAM_AUTH) {
    headers[UPSTREAM_AUTH_HEADER] = buildAuthHeaderValue(UPSTREAM_AUTH);
  }

  try {
    const response = await fetch(`${UPSTREAM_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    logToFile(`Upstream response status=${response.status}`);

    if (!response.ok) {
      try {
        const headersObj: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headersObj[key] = value;
        });
        logToFile(`Upstream error headers: ${JSON.stringify(headersObj)}`);
      } catch {
        logToFile('Could not capture upstream response headers.');
      }
    }

    return response;
  } catch (error: any) {
    logToFile(`Network error on route ${path}: ${error?.message || String(error)}`);
    return null;
  }
}

function makeSseResponseFromOpenAI(json: any) {
  const choice = json?.choices?.[0] || {};
  const message = choice.message || {};
  const text = typeof message.content === 'string'
    ? message.content
    : Array.isArray(message.content)
      ? message.content.map((chunk: any) => (typeof chunk === 'string' ? chunk : chunk.text || '')).join('')
      : (choice.delta?.content ?? '');

  const toolCalls = message.tool_calls || choice.tool_calls || [];
  const usage = json?.usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  chunks.push(encoder.encode(`event: message_start\ndata: {"type": "message_start", "message": {"id": "msg_${Date.now()}", "type": "message", "role": "assistant", "content": [], "model": "${UPSTREAM_MODEL}", "usage": ${JSON.stringify(usage)}}}\n\n`));
  chunks.push(encoder.encode('event: content_block_start\ndata: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}\n\n'));

  if (text) {
    chunks.push(encoder.encode(`event: content_block_delta\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": ${JSON.stringify(text)}}}\n\n`));
  }

  let blockIndex = 0;
  for (const toolCall of toolCalls) {
    blockIndex += 1;
    const inputParsed = (() => {
      try {
        return JSON.parse(toolCall.function?.arguments ?? '{}');
      } catch {
        return toolCall.function?.arguments ?? {};
      }
    })();

    chunks.push(encoder.encode(`event: content_block_start\ndata: {"type": "content_block_start", "index": ${blockIndex}, "content_block": {"type": "tool_use", "id": "${toolCall.id}", "name": "${toolCall.function?.name}", "input": ${JSON.stringify(inputParsed)}}}\n\n`));
    chunks.push(encoder.encode(`event: content_block_stop\ndata: {"type": "content_block_stop", "index": ${blockIndex}}\n\n`));
  }

  chunks.push(encoder.encode('event: content_block_stop\ndata: {"type": "content_block_stop", "index": 0}\n\n'));
  chunks.push(encoder.encode(`event: message_delta\ndata: {"type": "message_delta", "delta": {"stop_reason": "${toolCalls.length ? 'tool_use' : 'end_turn'}"}, "usage": ${JSON.stringify(usage)}}\n\n`));
  chunks.push(encoder.encode(`event: message_stop\ndata: {"type": "message_stop", "usage": ${JSON.stringify(usage)}}\n\n`));

  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

async function handleMessages(body: any) {
  const payload: any = {
    model: UPSTREAM_MODEL,
    messages: toOpenAIMessages(body),
    stream: false,
  };

  const tools = toOpenAITools(body);
  if (tools) payload.tools = tools;
  if (body.tool_choice) payload.tool_choice = body.tool_choice;
  if (body.max_tokens) payload.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.top_p !== undefined) payload.top_p = body.top_p;
  if (body.stop) payload.stop = body.stop;

  const defaultPaths = [
    '/openai/v1/chat/completions',
    '/v1/chat/completions',
    '/chat/completions',
    '/openai/chat/completions',
    '/v1/messages',
    '/anthropic/v1/messages',
    '/api/v1/chat/completions',
    '/api/v1/messages',
    '/',
  ];

  const paths = [
    ...(UPSTREAM_CHAT_PATH.startsWith('/') ? [UPSTREAM_CHAT_PATH] : []),
    ...defaultPaths,
  ].filter((path, index, arr) => arr.indexOf(path) === index);

  let upstream: Response | null = null;
  let lastErrorDetails: string | null = null;

  for (const path of paths) {
    upstream = await tryFetch(path, payload);

    if (upstream && upstream.ok) {
      logToFile(`Confirmed route: ${path} (status=${upstream.status})`);
      break;
    }

    if (upstream) {
      const bodyText = (await upstream.text()).slice(0, 500);
      lastErrorDetails = `status=${upstream.status}, body=${bodyText}`;
      logToFile(`Failed route (${path}): ${lastErrorDetails}`);
      continue;
    }

    lastErrorDetails = `network error on ${path}`;
    logToFile(`Failed route (${path}): network error`);
  }

  if (!upstream || !upstream.ok) {
    const errMessage = lastErrorDetails || 'upstream unavailable';
    logToFile(`Final failure: ${errMessage}`);
    return new Response(JSON.stringify({
      error: {
        message: `Proxy Error: ${errMessage}`,
        type: 'proxy_error',
        code: 'upstream_failed',
      },
    }), {
      status: upstream?.status || 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const json = await upstream.json();
    return makeSseResponseFromOpenAI(json);
  } catch (error: any) {
    logToFile(`Error parsing upstream JSON: ${error?.message || String(error)}`);
    return new Response(JSON.stringify({ error: { message: 'Proxy JSON parse error', detail: String(error) } }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}

assertUpstreamSafety();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.includes('/bootstrap')) {
      return new Response(JSON.stringify({
        config: {
          feature_flags: { enable_tool_use: true },
          user: { email: 'gpt54@local.proxy' },
        },
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (req.method === 'POST' && url.pathname.includes('/messages')) {
      const body = await req.json();
      return handleMessages(body);
    }

    return new Response('OK');
  },
});

logToFile(`Proxy multiroute active on port ${PORT} (upstream=${UPSTREAM_BASE}, authHeader=${UPSTREAM_AUTH_HEADER}, localOnly=${LOCAL_UPSTREAM_ONLY ? '1' : '0'})`);
