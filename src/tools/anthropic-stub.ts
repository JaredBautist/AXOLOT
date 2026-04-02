#!/usr/bin/env bun

const PORT = parseInt(process.env.STUB_PORT || '8787', 10);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/v1/messages') {
      const body = await req.json().catch(() => ({}));
      const messages = (body as any).messages ?? [];
      const lastUser =
        [...messages].reverse().find((m: any) => m?.role === 'user')?.content ??
        '';
      const text =
        typeof lastUser === 'string' && lastUser.trim().length
          ? `stub: ${lastUser}`
          : 'stub';
      const resp = {
        id: 'stub-msg',
        type: 'message',
        role: 'assistant',
        model: (body as any).model ?? 'stub-claude',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
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

console.log(`[anthropic-stub] listening on http://127.0.0.1:${PORT}/v1/messages`);

await server.closed;
