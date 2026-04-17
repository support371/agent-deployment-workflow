import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

describe('auth', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should allow requests when no token is configured', async () => {
    delete process.env.GEM_AGENT_TOKEN;
    
    const { requireAuth } = await import('@/lib/auth');
    const request = new NextRequest('http://localhost/api/agent', {
      method: 'POST',
    });
    
    const result = requireAuth(request);
    expect(result).toBeNull();
  });

  it('should reject requests without auth header when token is configured', async () => {
    process.env.GEM_AGENT_TOKEN = 'secret-token';
    
    const { requireAuth } = await import('@/lib/auth');
    const request = new NextRequest('http://localhost/api/agent', {
      method: 'POST',
    });
    
    const result = requireAuth(request);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  it('should reject requests with wrong token', async () => {
    process.env.GEM_AGENT_TOKEN = 'correct-token';
    
    const { requireAuth } = await import('@/lib/auth');
    const request = new NextRequest('http://localhost/api/agent', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-token' },
    });
    
    const result = requireAuth(request);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(401);
  });

  it('should allow requests with correct token', async () => {
    process.env.GEM_AGENT_TOKEN = 'correct-token';
    
    const { requireAuth } = await import('@/lib/auth');
    const request = new NextRequest('http://localhost/api/agent', {
      method: 'POST',
      headers: { Authorization: 'Bearer correct-token' },
    });
    
    const result = requireAuth(request);
    expect(result).toBeNull();
  });
});
