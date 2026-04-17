#!/usr/bin/env npx tsx
/**
 * End-to-end test script for GEM Agent Builder.
 * 
 * Requires environment variables:
 *   ANTHROPIC_API_KEY - Required for agent execution
 *   GEM_AGENT_TOKEN   - Optional, for authenticated requests
 *   BASE_URL          - Optional, defaults to http://localhost:3000
 * 
 * Usage:
 *   pnpm test:e2e
 *   NODE_ENV=test npx tsx scripts/e2e-test.ts
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const GEM_TOKEN = process.env.GEM_AGENT_TOKEN;

interface SessionResponse {
  sessionId: string;
}

interface StreamEvent {
  id: string;
  phase: string;
  kind: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

async function main() {
  console.log('='.repeat(60));
  console.log('GEM Agent Builder E2E Test');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Auth: ${GEM_TOKEN ? 'Configured' : 'None'}`);
  console.log('');

  // 1. Health check
  console.log('[1/4] Health check...');
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  if (!healthRes.ok) {
    console.error('Health check failed:', healthRes.status);
    process.exit(1);
  }
  const health = await healthRes.json();
  console.log('  Status:', health.status);
  console.log('  Checks:', JSON.stringify(health.checks));
  
  if (!health.checks.anthropic) {
    console.error('ANTHROPIC_API_KEY not configured. Cannot proceed.');
    process.exit(1);
  }
  console.log('');

  // 2. Start agent session
  console.log('[2/4] Starting agent session...');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (GEM_TOKEN) {
    headers['Authorization'] = `Bearer ${GEM_TOKEN}`;
  }

  const startRes = await fetch(`${BASE_URL}/api/agent`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      instruction: 'Create a simple "Hello World" page with a timestamp.',
      template: 'next14-ts',
      autoDeploy: false,
      autoFix: true,
      maxIterations: 5,
    }),
  });

  if (startRes.status !== 202) {
    const errBody = await startRes.text();
    console.error('Failed to start session:', startRes.status, errBody);
    process.exit(1);
  }

  const { sessionId } = (await startRes.json()) as SessionResponse;
  console.log('  Session ID:', sessionId);
  console.log('');

  // 3. Subscribe to event stream
  console.log('[3/4] Subscribing to event stream...');
  const events: StreamEvent[] = [];
  let done = false;
  let failed = false;

  const streamUrl = `${BASE_URL}/api/agent/stream?sessionId=${sessionId}`;
  console.log('  Stream URL:', streamUrl);
  console.log('');

  // Use fetch with streaming for Node.js environment
  const streamRes = await fetch(streamUrl);
  if (!streamRes.ok || !streamRes.body) {
    console.error('Failed to connect to stream:', streamRes.status);
    process.exit(1);
  }

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const timeout = setTimeout(() => {
    console.error('Timeout: No done event received within 5 minutes.');
    process.exit(1);
  }, 5 * 60 * 1000);

  try {
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6)) as StreamEvent;
            events.push(event);
            
            const prefix = `  [${event.phase}/${event.kind}]`;
            console.log(prefix, event.message.slice(0, 80));

            if (event.kind === 'done') done = true;
            if (event.kind === 'error' || event.phase === 'failed') failed = true;
          } catch { /* skip malformed */ }
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  console.log('');

  // 4. Results summary
  console.log('[4/4] Results...');
  console.log('  Total events:', events.length);
  console.log('  Final phase:', events[events.length - 1]?.phase ?? 'unknown');
  console.log('  Failed:', failed);

  // Extract key data from events
  const previewUrl = events.find((e) => e.kind === 'url' && e.data?.url)?.data?.url;
  const changelog = events.find((e) => e.kind === 'done' && e.data?.changelog)?.data?.changelog;
  const prUrl = events.find((e) => e.data?.prUrl)?.data?.prUrl;

  if (previewUrl) console.log('  Preview URL:', previewUrl);
  if (changelog) console.log('  Changelog:', changelog);
  if (prUrl) console.log('  PR URL:', prUrl);

  console.log('');
  console.log('='.repeat(60));
  
  if (failed) {
    console.log('E2E TEST FAILED');
    process.exit(1);
  } else {
    console.log('E2E TEST PASSED');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
