#!/usr/bin/env bun
import { appendFileSync } from 'fs';

const PORT = parseInt(process.env.PROXY_PORT || '8787', 10);
const UPSTREAM_BASE = (process.env.UPSTREAM_URL || '').replace(/\/$/, '') || 'http://127.0.0.1:18789';
const UPSTREAM_MODEL = process.env.UPSTREAM_MODEL || 'openclaw';
const UPSTREAM_AUTH = process.env.UPSTREAM_AUTH || '';

function logToFile(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}
`;
  appendFileSync('proxy-output.log', line);
  console.log(msg);
}

async function* transformStream(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  yield encoder.encode(`event: message_start
data: {"type": "message_start", "message": {"id": "msg_${Date.now()}", "type": "message", "role": "assistant", "content": [], "model": "${UPSTREAM_MODEL}", "usage": {"input_tokens": 0, "output_tokens": 0}}}

`);
  yield encoder.encode(`event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

`);

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/); // dividir por nuevas líneas
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const json = JSON.parse(dataStr);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            yield encoder.encode(`event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": ${JSON.stringify(content)}}}

`);
          }
        } catch (e) {
          logToFile(`Error parsing JSON chunk: ${e}`);
        }
      }
    }
  } finally {
    yield encoder.encode(`event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

`);
    yield encoder.encode(`event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}

`);
    // Provide basic usage to satisfy clients expecting Anthropics fields
    yield encoder.encode(`event: message_stop
data: {"type": "message_stop", "usage": {"input_tokens": 0, "output_tokens": 0}}

`);
  }
}

async function tryFetch(path: string, payload: any) {
  logToFile(`PROBANDO RUTA: ${UPSTREAM_BASE}${path}`);
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${UPSTREAM_AUTH}`,
    'X-Auth-Token': UPSTREAM_AUTH,
    'x-api-key': UPSTREAM_AUTH
  };
  
  try {
    const response = await fetch(`${UPSTREAM_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    logToFile(`RESPUESTA RECIBIDA: Status=${response.status}`);
    if (!response.ok) {
      try {
        const headersText = JSON.stringify(Object.fromEntries(response.headers.entries()));
        logToFile(`Headers de error: ${headersText}`);
      } catch (hErr) {
        logToFile("Could not log response headers.");
      }
    }
    return response;
  } catch (e: any) {
    logToFile(`ERROR DE RED EN RUTA ${path}: ${e.message}`);
    return null;
  }
}

async function handleMessages(body: any) {
  // Convert Anthropic-style messages/tools to OpenAI format
  const oaiMessages: any[] = [];

  for (const msg of body.messages || []) {
    // Flatten Anthropics content array to OpenAI roles
    if (Array.isArray(msg.content)) {
      let textBuf = '';
      for (const part of msg.content) {
        if (part.type === 'text') {
          textBuf += part.text;
        } else if (part.type === 'tool_result') {
          // flush text as assistant message if present
          if (textBuf.trim().length) {
            oaiMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: textBuf });
            textBuf = '';
          }
          oaiMessages.push({
            role: 'tool',
            tool_call_id: part.tool_use_id || part.id || 'tool_' + Date.now(),
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

  // Map tools
  let oaiTools: any[] | undefined;
  if (Array.isArray(body.tools) && body.tools.length) {
    oaiTools = body.tools.map((t: any) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema || { type: 'object' },
      },
    }));
  }

  const payload: any = {
    model: UPSTREAM_MODEL,
    messages: oaiMessages,
    stream: false,
  };
  if (oaiTools) payload.tools = oaiTools;
  if (body.tool_choice) payload.tool_choice = body.tool_choice;
  if (body.max_tokens) payload.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.top_p !== undefined) payload.top_p = body.top_p;
  if (body.stop) payload.stop = body.stop;

  const paths = [
    '/openai/v1/chat/completions',        
    '/v1/chat/completions',               
    '/chat/completions',                  
    '/openai/chat/completions',           
    '/v1/messages',                       
    '/anthropic/v1/messages',             
    '/api/v1/chat/completions',           
    '/api/v1/messages',                   
    '/'                                   
  ];

  let upstream: Response | null = null;
  let lastErrorDetails: string | null = null;

  for (const path of paths) {
    upstream = await tryFetch(path, payload);
    if (upstream && upstream.ok) {
      logToFile(`¡RUTA CONFIRMADA! -> ${path} (Status: ${upstream.status})`);
      break;
    } else if (upstream) {
      lastErrorDetails = `Status=${upstream.status}, Body=${await upstream.text()}`;
      logToFile(`RUTA FALLIDA (${path}): ${lastErrorDetails}`);
    } else {
      lastErrorDetails = `Network error at ${path}`;
      logToFile(`RUTA FALLIDA (${path}): Network error`);
    }
  }

  if (!upstream || !upstream.ok) {
    const errMessage = lastErrorDetails || 'Servidor no responde';
    logToFile(`FALLO FINAL: ${errMessage}`);
    return new Response(JSON.stringify({ 
      error: { 
        message: `Proxy Error: ${errMessage}`, 
        type: 'proxy_error', 
        code: 'upstream_failed' 
      } 
    }), {
      status: upstream?.status || 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  logToFile(`Conexión exitosa. Iniciando stream.`);
  
  // Leemos JSON completo y emitimos SSE para la CLI (Anthropic-style stream)
  try {
    const json = await upstream.json();
    const choice = json?.choices?.[0] || {};
    const message = choice.message || {};
    const text = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((c: any) => (typeof c === 'string' ? c : c.text || '')).join('')
        : (choice.delta?.content ?? '');
    const toolCalls = message.tool_calls || choice.tool_calls || [];
    const usage = json?.usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    chunks.push(encoder.encode(`event: message_start
data: {"type": "message_start", "message": {"id": "msg_${Date.now()}", "type": "message", "role": "assistant", "content": [], "model": "${UPSTREAM_MODEL}", "usage": ${JSON.stringify(usage)}}}

`));
    chunks.push(encoder.encode(`event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

`));
    let blockIndex = 0;
    if (text) {
      chunks.push(encoder.encode(`event: content_block_delta
data: {"type": "content_block_delta", "index": ${blockIndex}, "delta": {"type": "text_delta", "text": ${JSON.stringify(text)}}}

`));
    }

    // Tool calls -> convert to Anthropics tool_use blocks
    for (const tc of toolCalls) {
      blockIndex += 1;
      const inputParsed = (() => {
        try { return JSON.parse(tc.function?.arguments ?? '{}'); } catch { return tc.function?.arguments ?? {}; }
      })();
      chunks.push(encoder.encode(`event: content_block_start
data: {"type": "content_block_start", "index": ${blockIndex}, "content_block": {"type": "tool_use", "id": "${tc.id}", "name": "${tc.function?.name}", "input": ${JSON.stringify(inputParsed)}}}

`));
      chunks.push(encoder.encode(`event: content_block_stop
data: {"type": "content_block_stop", "index": ${blockIndex}}

`));
    }
    chunks.push(encoder.encode(`event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

`));
    chunks.push(encoder.encode(`event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "${toolCalls.length ? 'tool_use' : 'end_turn'}"}, "usage": ${JSON.stringify(usage)}}

`));
    chunks.push(encoder.encode(`event: message_stop
data: {"type": "message_stop", "usage": ${JSON.stringify(usage)}}

`));

    return new Response(new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      }
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  } catch (e: any) {
    logToFile(`Error leyendo JSON upstream: ${e}`);
    return new Response(JSON.stringify({ error: { message: 'Proxy JSON parse error', detail: String(e) } }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.includes('/bootstrap')) return new Response(JSON.stringify({ 
      config: { 
        feature_flags: { enable_tool_use: true },
        user: { email: "gpt54@local.proxy" }
      } 
    }), { headers: { 'Content-Type': 'application/json' } });
    
    if (req.method === 'POST' && url.pathname.includes('/messages')) {
      const body = await req.json();
      return handleMessages(body);
    }
    return new Response('OK');
  }
});

logToFile(`🚀 Proxy Multiruta activo en puerto ${PORT}`);
