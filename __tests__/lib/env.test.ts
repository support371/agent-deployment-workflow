import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('env', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should throw if ANTHROPIC_API_KEY is missing when provider is anthropic', async () => {
    process.env.AGENT_PROVIDER = 'anthropic';
    delete process.env.ANTHROPIC_API_KEY;
    
    const { env } = await import('@/lib/env');
    expect(() => env()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('should throw if OPENAI_API_KEY is missing when provider is openai', async () => {
    process.env.AGENT_PROVIDER = 'openai';
    delete process.env.OPENAI_API_KEY;
    
    const { env } = await import('@/lib/env');
    expect(() => env()).toThrow(/OPENAI_API_KEY/);
  });

  it('should parse valid environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
    // NODE_ENV is already 'test' in vitest, don't reassign (read-only in strict mode)
    
    const { env } = await import('@/lib/env');
    const result = env();
    
    expect(result.ANTHROPIC_API_KEY).toBe('sk-test-key');
    expect(result.ANTHROPIC_MODEL).toBe('claude-sonnet-4-20250514');
    expect(result.NODE_ENV).toBe('test');
  });

  it('should use default model if not provided', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    delete process.env.ANTHROPIC_MODEL;
    
    const { env } = await import('@/lib/env');
    const result = env();
    
    expect(result.ANTHROPIC_MODEL).toBe('claude-sonnet-4-20250514');
  });

  it('should parse OpenAI provider configuration', async () => {
    process.env.AGENT_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    process.env.OPENAI_MODEL = 'gpt-4-turbo';
    
    const { env } = await import('@/lib/env');
    const result = env();
    
    expect(result.AGENT_PROVIDER).toBe('openai');
    expect(result.OPENAI_API_KEY).toBe('sk-openai-test');
    expect(result.OPENAI_MODEL).toBe('gpt-4-turbo');
  });

  it('should validate optional GitHub token', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    process.env.GITHUB_TOKEN = 'ghp_test_token';
    
    const { env, hasGitHub } = await import('@/lib/env');
    env(); // Initialize
    
    expect(hasGitHub()).toBe(true);
  });

  it('should report GitHub unavailable when token missing', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    delete process.env.GITHUB_TOKEN;
    
    const { env, hasGitHub } = await import('@/lib/env');
    env();
    
    expect(hasGitHub()).toBe(false);
  });

  it('should validate optional deploy hook URL', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    process.env.VERCEL_DEPLOY_HOOK_URL = 'https://api.vercel.com/deploy/hook';
    
    const { env, hasVercelDeploy } = await import('@/lib/env');
    env();
    
    expect(hasVercelDeploy()).toBe(true);
  });
});
