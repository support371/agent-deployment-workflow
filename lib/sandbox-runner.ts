// lib/sandbox-runner.ts
// Thin wrapper around @vercel/sandbox that:
//   1. provisions a microVM from a template or repo
//   2. installs deps, runs build + tests
//   3. streams stdout/stderr into the session event bus
//   4. exposes a preview URL when a dev/prod server is detached
//
// Kept free of UI / framework concerns so it's reusable from any route,
// queue worker, or cron.
import { Sandbox } from '@vercel/sandbox';
import ms from 'ms';
import { emit } from './event-bus';
import { env } from './env';
import type { AgentPhase } from '@/types/events';

export interface RunnerInput {
  sessionId: string;
  repoUrl?: string;           // git source (takes precedence over template)
  template?: 'next14-ts' | 'vite-react-ts' | 'node-api' | 'blank';
  timeout?: string;           // e.g. "15m"
  ports?: number[];
}

export interface RunnerResult {
  sandboxId: string;
  previewUrl: string | null;
  buildOk: boolean;
  testOk: boolean;
  stop: () => Promise<void>;
  runCmd: (phase: AgentPhase, cmd: string, args: string[], opts?: { sudo?: boolean }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  writeFile: (path: string, content: string, phase?: AgentPhase) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  applyPatch: (path: string, patch: string, phase?: AgentPhase) => Promise<{ ok: boolean; error?: string }>;
}

const TEMPLATE_REPOS: Record<NonNullable<RunnerInput['template']>, string | null> = {
  'next14-ts': 'https://github.com/vercel/sandbox-example-next.git',
  'vite-react-ts': 'https://github.com/vitejs/vite.git', // users typically fork; placeholder
  'node-api': null,
  blank: null,
};

export async function provision(input: RunnerInput): Promise<RunnerResult> {
  const { sessionId } = input;
  const e = env();

  emit(sessionId, {
    phase: 'sandbox_provisioning',
    kind: 'status',
    message: 'Booting Firecracker microVM…',
  });

  const source = input.repoUrl
    ? { type: 'git' as const, url: input.repoUrl }
    : input.template && TEMPLATE_REPOS[input.template]
      ? { type: 'git' as const, url: TEMPLATE_REPOS[input.template]! }
      : undefined;

  const sandbox = await Sandbox.create({
    ...(e.VERCEL_TEAM_ID ? { teamId: e.VERCEL_TEAM_ID } : {}),
    ...(e.VERCEL_PROJECT_ID ? { projectId: e.VERCEL_PROJECT_ID } : {}),
    ...(e.VERCEL_TOKEN ? { token: e.VERCEL_TOKEN } : {}),
    ...(source ? { source } : {}),
    resources: { vcpus: 4 },
    timeout: ms(input.timeout ?? '15m'),
    ports: input.ports ?? [3000],
    runtime: 'node24',
  });

  emit(sessionId, {
    phase: 'sandbox_provisioning',
    kind: 'status',
    message: `Sandbox ready (${sandbox.sandboxId})`,
    data: { sandboxId: sandbox.sandboxId },
  });

  const runCmd: RunnerResult['runCmd'] = async (phase, cmd, args, opts) => {
    emit(sessionId, {
      phase,
      kind: 'tool_call',
      message: `$ ${cmd} ${args.join(' ')}`,
      data: { cmd, args },
    });

    // We collect output *and* stream it. Vercel SDK accepts writable streams
    // for stdout/stderr; we adapt with simple PassThroughs.
    const { PassThrough } = await import('node:stream');
    const out = new PassThrough();
    const err = new PassThrough();
    let stdoutBuf = '';
    let stderrBuf = '';
    out.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdoutBuf += text;
      emit(sessionId, { phase, kind: 'log', stream: 'stdout', message: text.replace(/\s+$/u, '') });
    });
    err.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderrBuf += text;
      emit(sessionId, { phase, kind: 'log', stream: 'stderr', message: text.replace(/\s+$/u, '') });
    });

    const result = await sandbox.runCommand({
      cmd,
      args,
      sudo: opts?.sudo ?? false,
      stdout: out,
      stderr: err,
    });

    emit(sessionId, {
      phase,
      kind: 'tool_result',
      message: `exit=${result.exitCode}`,
      data: { exitCode: result.exitCode },
    });

    return { exitCode: result.exitCode ?? 1, stdout: stdoutBuf, stderr: stderrBuf };
  };

  const writeFile: RunnerResult['writeFile'] = async (path, content, phase = 'scaffolding') => {
    // Vercel Sandbox SDK exposes writeFiles; we keep a tiny shim so the agent
    // loop can call a single-file primitive without caring about the batching API.
    await sandbox.writeFiles([{ path, content: Buffer.from(content, 'utf8') }]);
    emit(sessionId, {
      phase,
      kind: 'diff',
      message: `wrote ${path} (${content.length} bytes)`,
      data: { path, bytes: content.length },
    });
  };

  const readFile: RunnerResult['readFile'] = async (path) => {
    // SDK shape: readFileToBuffer resolves to Buffer | null (null if not found).
    // We prefer this over readFile() which returns an AsyncIterable<Buffer> stream.
    const buf = await sandbox.readFileToBuffer({ path });
    if (!buf) throw new Error(`File not found in sandbox: ${path}`);
    return buf.toString('utf8');
  };

  const applyPatch: RunnerResult['applyPatch'] = async (path, patch, phase = 'scaffolding') => {
    // Apply unified diff patch using the sandbox's patch utility.
    // We write the patch to a temp file, apply it with `patch`, then clean up.
    const patchPath = `/tmp/patch-${Date.now()}.diff`;
    try {
      await sandbox.writeFiles([{ path: patchPath, content: Buffer.from(patch, 'utf8') }]);
      const result = await sandbox.runCommand({
        cmd: 'patch',
        args: ['-u', path, patchPath],
        sudo: false,
      });
      // Clean up temp patch file
      await sandbox.runCommand({ cmd: 'rm', args: ['-f', patchPath], sudo: false });

      if (result.exitCode === 0) {
        emit(sessionId, {
          phase,
          kind: 'diff',
          message: `patched ${path}`,
          data: { path, patch: patch.slice(0, 500) },
        });
        return { ok: true };
      } else {
        return { ok: false, error: `patch failed with exit code ${result.exitCode}` };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  };

  const stop: RunnerResult['stop'] = async () => {
    try { await sandbox.stop(); } catch { /* best-effort */ }
  };

  return {
    sandboxId: sandbox.sandboxId,
    previewUrl: sandbox.domain(input.ports?.[0] ?? 3000),
    buildOk: false,
    testOk: false,
    stop,
    runCmd,
    writeFile,
    readFile,
    applyPatch,
  };
}
