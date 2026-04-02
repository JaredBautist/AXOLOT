// Local dev entrypoint: wires up macro fallbacks and runs the CLI.
import './macros.dev.js';
import { main } from './main.js';

// Optional local stub for /v1/messages so dev runs without real Anthropic/OpenClaw.
if (process.env.CLAUDE_CODE_USE_STUB === '1') {
  const port = parseInt(process.env.ANTHROPIC_STUB_PORT || '8787', 10);
  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === 'POST' && url.pathname === '/v1/messages') {
        const body = await req.json().catch(() => ({}));
        const messages = (body as any).messages ?? [];
        const lastUser =
          [...messages].reverse().find((m: any) => m?.role === 'user')
            ?.content ?? '';
        console.log('[anthropic-stub] request', JSON.stringify({ model: (body as any).model, messages: messages.length }));
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
  console.log(
    `[anthropic-stub] listening on http://127.0.0.1:${port}/v1/messages`,
  );
}

void main();
