// app/api/deploy/route.ts — explicit deploy trigger.
import { NextRequest, NextResponse } from 'next/server';
import { triggerDeploy } from '@/lib/vercel-deploy';
import { hasVercelDeploy } from '@/lib/env';
import { requireAuth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req);
  if (authErr) return authErr;

  if (!hasVercelDeploy()) {
    return NextResponse.json(
      { error: 'VERCEL_DEPLOY_HOOK_URL not configured' },
      { status: 501 },
    );
  }
  try {
    const result = await triggerDeploy();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
