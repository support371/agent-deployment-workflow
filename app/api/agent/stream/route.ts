// app/api/agent/stream/route.ts
// Server-Sent Events stream. Client reconnects with ?lastEventId= to replay.
import { NextRequest } from 'next/server';
import { subscribe, getSession } from '@/lib/event-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  const lastEventId = req.nextUrl.searchParams.get('lastEventId') ?? undefined;

  if (!sessionId) return new Response('sessionId required', { status: 400 });
  // getSession is async via the adapter; must await (was previously `!Promise`
  // which is always false → 404 never triggered).
  if (!(await getSession(sessionId))) return new Response('unknown session', { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // SSE prelude — tells proxies not to buffer.
      controller.enqueue(encoder.encode(': gem-agent-builder stream\n\n'));

      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')); } catch {}
      }, 15_000);

      try {
        for await (const e of subscribe(sessionId, lastEventId)) {
          const payload =
            `id: ${e.id}\n` +
            `event: ${e.kind}\n` +
            `data: ${JSON.stringify(e)}\n\n`;
          controller.enqueue(encoder.encode(payload));
          if (e.kind === 'done') break;
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`,
          ),
        );
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
