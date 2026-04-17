// lib/env.ts — validated, typed env access.
// Each secret has a single consumer and a single validation point.
import { z } from 'zod';

const schema = z.object({
  // --- Agent model ---
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-7'),

  // --- Vercel Sandbox (OIDC in prod, token fallback locally / in CI) ---
  VERCEL_TEAM_ID: z.string().optional(),
  VERCEL_PROJECT_ID: z.string().optional(),
  VERCEL_TOKEN: z.string().optional(),
  VERCEL_OIDC_TOKEN: z.string().optional(),

  // --- Vercel Deploy API (to trigger production deploys) ---
  VERCEL_DEPLOY_HOOK_URL: z.string().url().optional(),

  // --- GitHub (for PR creation on chat → commit → deploy flow) ---
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_DEFAULT_OWNER: z.string().optional(),

  // --- Runtime ---
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}

export function hasGitHub(): boolean {
  const e = env();
  return Boolean(e.GITHUB_TOKEN);
}

export function hasVercelDeploy(): boolean {
  return Boolean(env().VERCEL_DEPLOY_HOOK_URL);
}
