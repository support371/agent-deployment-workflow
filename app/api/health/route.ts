// app/api/health/route.ts
// Health check endpoint for production monitoring and Vercel deployment health.
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  checks: {
    anthropic: boolean;
    github: boolean;
    vercelDeploy: boolean;
  };
}

export async function GET(): Promise<NextResponse<HealthStatus>> {
  const checks = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    github: Boolean(process.env.GITHUB_TOKEN),
    vercelDeploy: Boolean(process.env.VERCEL_DEPLOY_HOOK_URL),
  };

  // Core functionality requires ANTHROPIC_API_KEY
  const status = checks.anthropic ? 'healthy' : 'unhealthy';

  return NextResponse.json({
    status,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.0.0',
    checks,
  }, {
    status: status === 'unhealthy' ? 503 : 200,
  });
}
