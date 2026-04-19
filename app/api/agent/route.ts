// app/api/agent/route.ts — kick off an agent session.
//
// Contract:
//   POST  { instruction, repo?, template?, autoDeploy, autoFix }
//     → 202  { sessionId }   on accept
//     → 401                  if GEM_AGENT_TOKEN configured and bearer missing/wrong
//
// The actual work runs detached in the background; the client subscribes via
// /api/agent/stream?sessionId=... for live events.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { createSession, emit, close } from '@/lib/event-bus';
import { runAgent } from '@/lib/agent';
import { openPullRequest } from '@/lib/github';
import { triggerDeploy } from '@/lib/vercel-deploy';
import { exportChangedFiles } from '@/lib/sandbox-export';
import { hasGitHub, hasVercelDeploy } from '@/lib/env';
import { requireAuth } from '@/lib/auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import type { AgentRequest } from '@/types/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // orchestration accept only — agent runs detached

const bodySchema = z.object({
  instruction: z.string().min(4).max(8_000),
  repo: z
    .object({
      owner: z.string().min(1),
      name: z.string().min(1),
      branch: z.string().optional(),
    })
    .nullable()
    .optional(),
  template: z.enum(['next14-ts', 'vite-react-ts', 'node-api', 'blank']).optional(),
  autoDeploy: z.boolean().default(true),
  autoFix: z.boolean().default(true),
  maxIterations: z.number().int().min(1).max(25).optional(),
});

export async function POST(req: NextRequest) {
  const authErr = requireAuth(req);
  if (authErr) return authErr;

  // Rate limiting: 10 requests per minute per IP
  const clientId = getClientId(req);
  const rateLimit = checkRateLimit(clientId, { windowMs: 60_000, maxRequests: 10 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
          'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const body: AgentRequest = {
    instruction: parsed.data.instruction,
    repo: parsed.data.repo ?? null,
    template: parsed.data.template,
    autoDeploy: parsed.data.autoDeploy,
    autoFix: parsed.data.autoFix,
    maxIterations: parsed.data.maxIterations,
  };

  const sessionId = randomUUID();
  createSession(sessionId);

  // Fire-and-forget orchestration. Any throw lands on the event bus as an error.
  void orchestrate(sessionId, body).catch((err: Error) => {
    emit(sessionId, { phase: 'failed', kind: 'error', message: err.message });
    close(sessionId);
  });

  return NextResponse.json({ sessionId }, { status: 202 });
}

async function orchestrate(sessionId: string, req: AgentRequest) {
  emit(sessionId, { phase: 'queued', kind: 'status', message: 'Session accepted.' });

  const outcome = await runAgent(sessionId, req);

  if (!outcome.ok) {
    if (outcome.runner) {
      try { await outcome.runner.stop(); } catch { /* ignore */ }
    }
    close(sessionId);
    return;
  }

  // --- PR flow (requires: repo mode + GITHUB_TOKEN + agent's runner handle) ---
  let prUrl: string | null = null;
  if (req.repo && hasGitHub() && outcome.runner) {
    emit(sessionId, {
      phase: 'pr_opening',
      kind: 'status',
      message: 'Exporting sandbox changes for PR…',
    });

    try {
      const baseRef = `origin/${req.repo.branch ?? 'main'}`;
      const { files, stats } = await exportChangedFiles(outcome.runner, 'repo', baseRef);

      emit(sessionId, {
        phase: 'pr_opening',
        kind: 'status',
        message: `Found ${Object.keys(files).length} changed file(s), ${stats.totalBytes} bytes total.`,
        data: { ...stats, fileCount: Object.keys(files).length },
      });

      if (Object.keys(files).length === 0 && stats.deleted.length === 0) {
        emit(sessionId, {
          phase: 'pr_opening',
          kind: 'status',
          message: 'No committable changes. Skipping PR.',
        });
      } else {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const headBranch = `gem-agent/${ts}-${sessionId.slice(0, 8)}`;
        const title = `GEM Agent · ${req.instruction.slice(0, 60)}${req.instruction.length > 60 ? '…' : ''}`;
        const prBody = [
          `**Instruction**\n\n${req.instruction}`,
          '',
          `**Changelog**\n\n${outcome.changelog ?? '(none)'}`,
          '',
          `**Stats**`,
          `- Files: ${Object.keys(files).length}`,
          `- Bytes: ${stats.totalBytes}`,
          `- Added: ${stats.added}`,
          `- Modified: ${stats.modified}`,
          stats.deleted.length
            ? `- Deleted: ${stats.deleted.join(', ')}`
            : '',
          '',
          `**Sandbox**: \`${outcome.sandboxId}\``,
          `**Session**: \`${sessionId}\``,
        ].filter(Boolean).join('\n');

        const pr = await openPullRequest({
          owner: req.repo.owner,
          repo: req.repo.name,
          baseBranch: req.repo.branch ?? 'main',
          headBranch,
          title,
          body: prBody,
          files,
          deleted: stats.deleted,
        });
        prUrl = pr.url;

        emit(sessionId, {
          phase: 'pr_opening',
          kind: 'url',
          message: `PR opened: #${pr.number}`,
          data: { url: pr.url, number: pr.number, headSha: pr.headSha },
        });
      }
    } catch (err) {
      emit(sessionId, {
        phase: 'failed',
        kind: 'error',
        message: `PR failed: ${(err as Error).message}`,
      });
      // Non-fatal — we still allow the deploy step below.
    }
  }

  // --- Deploy ---
  if (req.autoDeploy && hasVercelDeploy()) {
    emit(sessionId, { phase: 'deploying', kind: 'status', message: 'Triggering Vercel deploy…' });
    try {
      const { jobId } = await triggerDeploy();
      emit(sessionId, {
        phase: 'deploying',
        kind: 'status',
        message: `Deploy queued: ${jobId}`,
        data: { jobId },
      });
    } catch (err) {
      emit(sessionId, { phase: 'failed', kind: 'error', message: (err as Error).message });
    }
  }

  // Determine if we'll keep the sandbox warm for preview browsing.
  // Success + autoDeploy=false = keep warm (user wants to click through).
  // Success + autoDeploy=true  = production URL is what matters, tear down.
  const keepWarm = outcome.ok && !req.autoDeploy;

  if (outcome.previewUrl && keepWarm) {
    emit(sessionId, {
      phase: 'done',
      kind: 'url',
      message: 'Live preview available',
      data: { url: outcome.previewUrl, sandboxId: outcome.sandboxId },
    });
  }

  emit(sessionId, {
    phase: 'done',
    kind: 'done',
    message: 'Session complete.',
    data: { iterations: outcome.iterations, changelog: outcome.changelog, prUrl },
  });

  // Best-effort sandbox cleanup.
  if (outcome.runner && !keepWarm) {
    try { await outcome.runner.stop(); } catch { /* ignore */ }
  }

  close(sessionId);
}
