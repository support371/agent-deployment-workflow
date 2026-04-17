// lib/env.ts — validated, typed env access.
// Each secret has a single consumer and a single validation point.
import { z } from 'zod';

const schema = z.object({
  // --- Agent model provider ---
  AGENT_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),

  // --- Anthropic (Claude) ---
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-20250514'),

  // --- OpenAI ---
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o'),

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

  // --- API Authentication ---
  GEM_AGENT_TOKEN: z.string().optional(),

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

  // Validate that the selected provider has its API key
  const data = parsed.data;
  if (data.AGENT_PROVIDER === 'anthropic' && !data.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required when AGENT_PROVIDER=anthropic');
  }
  if (data.AGENT_PROVIDER === 'openai' && !data.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when AGENT_PROVIDER=openai');
  }

  cached = data;
  return cached;
}

export function hasGitHub(): boolean {
  const e = env();
  return Boolean(e.GITHUB_TOKEN);
}

export function hasVercelDeploy(): boolean {
  return Boolean(env().VERCEL_DEPLOY_HOOK_URL);
}
