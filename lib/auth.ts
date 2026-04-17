// lib/auth.ts
// Lightweight bearer-token gate for the orchestration routes.
//
// Opt-in design: if GEM_AGENT_TOKEN is unset the routes stay open so local
// development "just works". The moment the env var is set (recommended in
// production), every protected route requires `Authorization: Bearer <token>`.
//
// Constant-time comparison via timingSafeEqual to avoid leak on length match.
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

function tokenFromEnv(): string | null {
  const t = process.env.GEM_AGENT_TOKEN;
  return t && t.length > 0 ? t : null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Returns a NextResponse to short-circuit with, or null to proceed.
 * Call at the top of every protected route:
 *   const err = requireAuth(req); if (err) return err;
 */
export function requireAuth(req: NextRequest): NextResponse | null {
  const expected = tokenFromEnv();
  if (!expected) return null; // auth disabled — local/dev mode

  const header = req.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) {
    return NextResponse.json(
      { error: 'unauthorized', detail: 'Missing bearer token' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="gem-agent"' } },
    );
  }
  const presented = header.slice(prefix.length).trim();
  if (!safeEqual(presented, expected)) {
    return NextResponse.json(
      { error: 'unauthorized', detail: 'Invalid token' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="gem-agent"' } },
    );
  }
  return null;
}

/**
 * For SSE endpoints where the EventSource can't set an Authorization header,
 * accept a signed session id instead. Stream routes check that the sessionId
 * exists (already enforced in event-bus.ts), and since session ids are
 * unguessable UUIDv4s, that's a reasonable capability boundary. If stronger
 * auth is needed, put the orchestrator behind a reverse proxy with mTLS or
 * forward-auth (Cloudflare Access, etc.).
 */
export function isAuthEnabled(): boolean {
  return tokenFromEnv() !== null;
}
