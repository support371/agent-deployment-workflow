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

  it('should throw if ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    
    const { env } = await import('@/lib/env');
    expect(() => env()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('should parse valid environment', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-20250514';
    process.env.NODE_ENV = 'test';
    
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
    
    expect(result.ANTHROPIC_MODEL).toBe('claude-opus-4-7');
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
