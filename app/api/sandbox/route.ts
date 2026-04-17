// app/api/sandbox/route.ts
// Manual sandbox lifecycle — let the operator reclaim compute on demand.
//
// Vercel Sandbox SDK exposes Sandbox.get(sandboxId) to reconnect to a running
// microVM by id. We use it here so a detached preview can be torn down from
// the UI without holding a reference in orchestrator memory.
import { NextRequest, NextResponse } from 'next/server';
import { Sandbox } from '@vercel/sandbox';
import { requireAuth } from '@/lib/auth';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

export async function DELETE(req: NextRequest) {
  const authErr = requireAuth(req);
  if (authErr) return authErr;

  const sandboxId = req.nextUrl.searchParams.get('sandboxId');
  if (!sandboxId) {
    return NextResponse.json({ error: 'sandboxId required' }, { status: 400 });
  }

  const e = env();
  try {
    const sandbox = await Sandbox.get({
      sandboxId,
      ...(e.VERCEL_TEAM_ID ? { teamId: e.VERCEL_TEAM_ID } : {}),
      ...(e.VERCEL_PROJECT_ID ? { projectId: e.VERCEL_PROJECT_ID } : {}),
      ...(e.VERCEL_TOKEN ? { token: e.VERCEL_TOKEN } : {}),
    });
    await sandbox.stop();
    return NextResponse.json({ stopped: sandboxId });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, sandboxId },
      { status: 502 },
    );
  }
}
