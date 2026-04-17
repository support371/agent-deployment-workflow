// lib/vercel-deploy.ts
// Triggers a Vercel production deploy via Deploy Hook URL.
// Deploy Hooks are the simplest, least-privileged surface: no API token needed,
// the hook is scoped to one project+branch, and the response carries a job id
// we can use for status polls.
import { env, hasVercelDeploy } from './env';

export interface DeployTrigger {
  jobId: string;
  triggeredAt: number;
}

export async function triggerDeploy(): Promise<DeployTrigger> {
  if (!hasVercelDeploy()) throw new Error('VERCEL_DEPLOY_HOOK_URL not configured');
  const url = env().VERCEL_DEPLOY_HOOK_URL!;

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`Vercel deploy hook failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { job: { id: string } };
  return { jobId: json.job.id, triggeredAt: Date.now() };
}
