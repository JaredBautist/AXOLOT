#!/usr/bin/env bun
import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const PORT = parseInt(process.env.PROXY_PORT || '8787', 10);
const UPSTREAM_BASE = (process.env.UPSTREAM_URL || '').replace(/\/$/, '') || 'http://127.0.0.1:18789';
const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '') || 'http://127.0.0.1:11434';
const OLLAMA_DIRECT = process.env.CLAUDEX_OLLAMA_DIRECT !== '0';
const UPSTREAM_MODEL = process.env.UPSTREAM_MODEL || 'openclaw';
const UPSTREAM_PROVIDER = (process.env.UPSTREAM_PROVIDER || '').trim().toLowerCase();
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
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    const safeMsg = redactSecrets(msg);
    const line = `[${new Date().toISOString()}] ${safeMsg}\n`;
    appendFileSync(LOG_FILE, line);
    console.log(safeMsg);
  } catch (e) {
    console.error(`Log error: ${e}`);
  }
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
  
  // Claude envia el system prompt en un campo aparte. OpenAI lo espera como primer mensaje.
  if (body.system) {
    let systemText = '';
    if (Array.isArray(body.system)) {
      systemText = body.system.map((p: any) => p.text || '').join('\n');
    } else {
      systemText = typeof body.system === 'string' ? body.system : JSON.stringify(body.system);
    }
    
    // Si el systemText parece un JSON stringificado (sucede con Claude), intentamos extraer el texto limpio
    if (systemText.includes('{"type":"text"')) {
      try {
        const parsed = JSON.parse(systemText);
        if (Array.isArray(parsed)) {
          systemText = parsed.map((p: any) => p.text || '').join('\n');
        }
      } catch { /* ignore */ }
    }

    oaiMessages.push({
      role: 'system',
      content: systemText
    });
  }

  for (const msg of body.messages || []) {
    if (Array.isArray(msg.content)) {
      let textBuf = '';
      for (const part of msg.content) {
        if (part.type === 'text') {
          textBuf += part.text;
        } else if (part.type === 'tool_result') {
          if (textBuf.trim().length) {
            oaiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: textBuf });
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
        oaiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: textBuf });
      }
    } else {
      oaiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
    }
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

function isGenericGatewayModel(model: string) {
  const normalized = model.trim().toLowerCase();
  return normalized === '' || normalized === 'openclaw' || normalized === 'claude';
}

function resolveTargetModel(requestModel: string | undefined) {
  const raw = (requestModel || '').trim();
  if (isGenericGatewayModel(raw)) {
    const envModel = (UPSTREAM_MODEL || '').trim();
    if (isGenericGatewayModel(envModel)) return 'openclaw';
    return resolveTargetModel(envModel);
  }

  if (raw.includes('/')) return raw;
  if (UPSTREAM_PROVIDER) return `${UPSTREAM_PROVIDER}/${raw}`;
  if (raw.includes(':')) return `ollama/${raw}`;
  return raw;
}

function isOllamaModel(model: string) {
  return model.trim().toLowerCase().startsWith('ollama/');
}

function makeSseResponseFromOpenAI(json: any, resolvedModel: string) {
  const choice = json?.choices?.[0] || {};
  const message = choice.message || {};
  const text = typeof message.content === 'string' ? message.content : '';
  const toolCalls = message.tool_calls || [];
  const usage = json?.usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  chunks.push(encoder.encode(`event: message_start\ndata: {"type": "message_start", "message": {"id": "msg_${Date.now()}", "type": "message", "role": "assistant", "content": [], "model": "${resolvedModel}", "usage": ${JSON.stringify(usage)}}}\n\n`));
  chunks.push(encoder.encode('event: content_block_start\ndata: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}\n\n'));

  if (text) {
    chunks.push(encoder.encode(`event: content_block_delta\ndata: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": ${JSON.stringify(text)}}}\n\n`));
  }

  let blockIndex = 0;
  for (const toolCall of toolCalls) {
    blockIndex += 1;
    let inputParsed = {};
    try {
      inputParsed = JSON.parse(toolCall.function?.arguments ?? '{}');
    } catch {
      inputParsed = toolCall.function?.arguments ?? {};
    }
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
  const requestModel = typeof body?.model === 'string' ? body.model : undefined;
  const targetModel = resolveTargetModel(requestModel);
  const directOllama = OLLAMA_DIRECT && isOllamaModel(targetModel);
  const upstreamBase = directOllama ? OLLAMA_BASE : UPSTREAM_BASE;
  const upstreamModel = directOllama
    ? targetModel.replace(/^ollama\//i, '')
    : 'openclaw';

  const payload: any = {
    model: upstreamModel,
    messages: toOpenAIMessages(body),
    stream: false,
  };

  const tools = toOpenAITools(body);
  if (tools) payload.tools = tools;
  if (tools && body.tool_choice) payload.tool_choice = body.tool_choice;
  if (body.max_tokens) payload.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) payload.temperature = body.temperature;

  if (payload.max_tokens > 4096) payload.max_tokens = 4096;

  const paths = directOllama
    ? ['/v1/chat/completions']
    : [
        ...(UPSTREAM_CHAT_PATH ? [UPSTREAM_CHAT_PATH] : []),
        '/v1/chat/completions',
        '/openai/v1/chat/completions',
        '/chat/completions',
        '/',
      ].filter((v, i, a) => a.indexOf(v) === i);

  const activeAuth = UPSTREAM_AUTH || '4826b470842264d01279842f13bb7d4e31270b59ab3224dd';
  
  let lastError = 'upstream unavailable';
  let statusCode = 502;

  for (const path of paths) {
    const targetUrl = `${upstreamBase}${path}`;
    
    const authSchemes = directOllama
      ? [{}]
      : [
          { [UPSTREAM_AUTH_HEADER]: buildAuthHeaderValue(activeAuth) },
          { 'x-api-key': activeAuth },
        ];

    for (const authHeader of authSchemes) {
      logToFile(`Trying: ${targetUrl} with auth ${JSON.stringify(Object.keys(authHeader))} model=${upstreamModel} directOllama=${directOllama}`);
      try {
        const bodyStr = JSON.stringify(payload);
        const safeAuthHeaders = Object.fromEntries(
          Object.entries(authHeader).filter(([, value]) => typeof value === 'string')
        ) as Record<string, string>;
        const resp = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...safeAuthHeaders
          },
          body: bodyStr
        });

        logToFile(`Status: ${resp.status}`);
        if (resp.ok) {
          const json = await resp.json();
          return makeSseResponseFromOpenAI(json, targetModel);
        }
        
        const errText = await resp.text();
        logToFile(`Error Body: ${errText}`);
        lastError = `status=${resp.status}, body=${errText.slice(0, 200)}`;
        statusCode = resp.status;
        
        if (resp.status !== 401 && resp.status !== 403) break;
      } catch (e: any) {
        lastError = e.message;
        logToFile(`Network error: ${e.message}`);
      }
    }
  }

  return new Response(JSON.stringify({ error: { message: `Proxy Error: ${lastError}`, type: 'proxy_error' } }), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' }
  });
}

assertUpstreamSafety();

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.includes('/bootstrap')) {
      return new Response(JSON.stringify({ config: { feature_flags: { enable_tool_use: true }, user: { email: 'codex@local' } } }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (req.method === 'POST' && url.pathname.includes('/messages')) {
      try {
        return await handleMessages(await req.json());
      } catch (e: any) {
        logToFile(`Critical proxy error: ${e.message}`);
        return new Response(JSON.stringify({ error: { message: e.message } }), { status: 500 });
      }
    }
    return new Response('OK');
  },
});

logToFile(`Proxy active on port ${PORT} (upstream=${UPSTREAM_BASE}, model=${UPSTREAM_MODEL})`);
