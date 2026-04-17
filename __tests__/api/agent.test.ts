import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// Mock the sandbox module before importing the route
vi.mock('@vercel/sandbox', () => {
  const mockSandbox = {
    sandboxId: 'mock-sandbox-123',
    domain: function(port: number) { return 'https://preview.vercel.app'; },
    runCommand: function() { return Promise.resolve({ exitCode: 0 }); },
    writeFiles: function() { return Promise.resolve(undefined); },
    readFileToBuffer: function() { return Promise.resolve(Buffer.from('mock content')); },
    stop: function() { return Promise.resolve(undefined); },
  };
  return {
    Sandbox: {
      create: function() { return Promise.resolve(mockSandbox); },
    },
  };
});

// Mock Anthropic client
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: function() {
        return Promise.resolve({
          content: [
            { type: 'text', text: 'Planning complete' },
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'mark_ready_for_deploy',
              input: { changelog: 'Test changes' },
            },
          ],
          stop_reason: 'tool_use',
        });
      },
    };
  }
  return { default: MockAnthropic };
});

describe('POST /api/agent', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    process.env = {
      ...originalEnv,
      ANTHROPIC_API_KEY: 'sk-test-key',
      NODE_ENV: 'test',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    vi.resetModules();
  });

  it('should return 400 for invalid request body', async () => {
    const { POST } = await import('@/app/api/agent/route');
    const request = new Request('http://localhost/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction: 'ab' }), // Too short
    });

    const response = await POST(request as any);
    expect(response.status).toBe(400);
  });

  it('should return 202 for valid request', async () => {
    const { POST } = await import('@/app/api/agent/route');
    const request = new Request('http://localhost/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'Build a hello world Next.js app',
        autoDeploy: false,
        autoFix: true,
      }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(202);
    
    const data = await response.json();
    expect(data).toHaveProperty('sessionId');
    expect(typeof data.sessionId).toBe('string');
  });

  it('should accept repo configuration', async () => {
    const { POST } = await import('@/app/api/agent/route');
    const request = new Request('http://localhost/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instruction: 'Add a new feature',
        repo: {
          owner: 'test-org',
          name: 'test-repo',
          branch: 'main',
        },
        autoDeploy: true,
      }),
    });

    const response = await POST(request as any);
    expect(response.status).toBe(202);
  });

  it('should enforce rate limits', async () => {
    const { POST } = await import('@/app/api/agent/route');
    
    // Make many requests quickly
    const requests = Array.from({ length: 15 }, () =>
      new Request('http://localhost/api/agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.100', // Same IP
        },
        body: JSON.stringify({ instruction: 'Test request number ' + Math.random() }),
      })
    );

    const responses = await Promise.all(requests.map((r) => POST(r as any)));
    const statuses = responses.map((r) => r.status);
    
    // Some should be 202, some should be 429
    expect(statuses).toContain(202);
    expect(statuses).toContain(429);
  });
});
