#!/usr/bin/env bun

/**
 * Tiny local stub for OpenAI-style /v1/chat/completions.
 * Always returns a fixed message echoing the last user content.
 */
const PORT = parseInt(process.env.UPSTREAM_PORT || '18789', 10);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const body = await req.json().catch(() => ({}));
      const messages = (body as any).messages ?? [];
      const lastUser =
        [...messages].reverse().find((m: any) => m?.role === 'user')?.content ??
        '';
      const content =
        typeof lastUser === 'string' && lastUser.trim().length
          ? `stub reply: ${lastUser}`
          : 'stub reply';
      const resp = {
        id: 'stub-chat',
        object: 'chat.completion',
        created: Date.now() / 1000,
        model: (body as any).model ?? 'stub-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
      return new Response(JSON.stringify(resp), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/health') return new Response('ok');
    return new Response('not found', { status: 404 });
  },
});

console.log(
  `[openai-stub] listening on http://127.0.0.1:${PORT}/v1/chat/completions`,
);

await server.closed;
