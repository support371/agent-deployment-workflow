// lib/agent.ts
// Claude-driven build/test/fix loop.
//
// Design:
//   - The model is the planner; we expose 5 tools that map 1:1 to sandbox ops.
//   - We enforce a hard iteration cap so a flaky test can't burn the budget.
//   - Every tool call and model message is surfaced on the event bus so the UI
//     renders a live transcript, not a black box.
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';
import { emit } from './event-bus';
import { provision, type RunnerResult } from './sandbox-runner';
import type { AgentRequest } from '@/types/events';

const SYSTEM_PROMPT = `You are GEM Build Agent — an autonomous engineer that turns an instruction into a deployed application.

Operating contract:
- You run inside a Vercel Sandbox (Amazon Linux 2023, node24). Use only the provided tools.
- Prefer minimal, production-grade code. TypeScript strict. No dead files.
- After any meaningful edit, run the project's build and test scripts.
- If build or tests fail, read the error, fix the root cause, and retry — do not paper over.
- When the project is green, call \`mark_ready_for_deploy\` with a short changelog.
- Keep each tool call tightly scoped. Avoid long \`cat\`/\`ls\` explorations when not needed.

Tools:
- run_command: execute a shell command in the sandbox.
- write_file:  create or overwrite a file with provided content.
- read_file:   read an existing file.
- apply_patch: apply a unified diff to an existing file (prefer this for small edits).
- mark_ready_for_deploy: signal the orchestrator that the build is green and a deploy should proceed.`;

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'run_command',
    description: 'Execute a shell command inside the sandbox and return stdout, stderr, exit code.',
    input_schema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Executable, e.g. "npm"' },
        args: { type: 'array', items: { type: 'string' }, description: 'Argument list' },
        sudo: { type: 'boolean', description: 'Run as root (dnf install, etc.)' },
        phase: {
          type: 'string',
          enum: ['installing', 'building', 'testing', 'fixing', 'scaffolding'],
          description: 'Which build phase this call belongs to',
        },
      },
      required: ['cmd', 'args', 'phase'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file at the given absolute path inside the sandbox.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a UTF-8 file and return its contents.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'apply_patch',
    description: 'Apply a unified diff patch to an existing file. Prefer this over write_file for small edits.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to patch' },
        patch: { type: 'string', description: 'Unified diff format patch content' },
      },
      required: ['path', 'patch'],
    },
  },
  {
    name: 'mark_ready_for_deploy',
    description: 'Declare that the project builds and tests pass; orchestrator will open PR and deploy.',
    input_schema: {
      type: 'object',
      properties: {
        changelog: { type: 'string', description: 'One-paragraph summary of changes' },
        preview_cmd: { type: 'string', description: 'Command to start the dev server, e.g. "npm run dev"' },
      },
      required: ['changelog'],
    },
  },
];

export interface AgentOutcome {
  ok: boolean;
  iterations: number;
  changelog: string | null;
  previewCmd: string | null;
  previewUrl: string | null;
  sandboxId: string;
  /** Live handle for downstream steps (PR export, teardown). */
  runner: RunnerResult | null;
}

export async function runAgent(
  sessionId: string,
  req: AgentRequest,
): Promise<AgentOutcome> {
  const e = env();
  const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY });
  const maxIters = Math.max(1, Math.min(req.maxIterations ?? 12, 25));

  emit(sessionId, { phase: 'planning', kind: 'status', message: 'Agent online. Planning…' });

  const runner: RunnerResult = await provision({
    sessionId,
    repoUrl: req.repo ? `https://github.com/${req.repo.owner}/${req.repo.name}.git` : undefined,
    template: req.repo ? undefined : req.template ?? 'next14-ts',
    timeout: '20m',
    ports: [3000],
  });

  // Seed the model with the concrete context.
  const userSeed = [
    `Instruction: ${req.instruction}`,
    req.repo ? `Repo: ${req.repo.owner}/${req.repo.name}@${req.repo.branch ?? 'main'}` : 'Starting from template.',
    `Working dir: /vercel/sandbox`,
    `Auto-fix on test failure: ${req.autoFix}`,
    `You may iterate up to ${maxIters} tool-call rounds.`,
  ].join('\n');

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: userSeed },
  ];

  let changelog: string | null = null;
  let previewCmd: string | null = null;
  let iter = 0;
  let done = false;

  try {
    while (iter < maxIters && !done) {
      iter++;
      emit(sessionId, {
        phase: iter === 1 ? 'planning' : 'building',
        kind: 'status',
        message: `iteration ${iter}/${maxIters}`,
      });

      const response = await client.messages.create({
        model: e.ANTHROPIC_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      });

      // Surface any prose the model emits.
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          emit(sessionId, {
            phase: 'planning',
            kind: 'thought',
            stream: 'agent',
            message: block.text,
          });
        }
      }

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'stop_sequence') {
        // Model finished without calling mark_ready_for_deploy — treat as incomplete.
        emit(sessionId, {
          phase: 'failed',
          kind: 'error',
          message: 'Agent stopped without marking ready for deploy.',
        });
        break;
      }

      if (response.stop_reason !== 'tool_use') continue;

      const toolUses = response.content.filter(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );

      // Append assistant turn verbatim so the tool_result ids line up.
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

      for (const tu of toolUses) {
        const input = tu.input as Record<string, unknown>;
        try {
          if (tu.name === 'run_command') {
            const cmd = String(input.cmd);
            const args = Array.isArray(input.args) ? (input.args as string[]) : [];
            const phase = (input.phase as
              | 'installing' | 'building' | 'testing' | 'fixing' | 'scaffolding') ?? 'building';
            const r = await runner.runCmd(phase, cmd, args, { sudo: Boolean(input.sudo) });
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify({
                exitCode: r.exitCode,
                stdoutTail: r.stdout.slice(-4_000),
                stderrTail: r.stderr.slice(-4_000),
              }),
              is_error: r.exitCode !== 0,
            });
          } else if (tu.name === 'write_file') {
            await runner.writeFile(String(input.path), String(input.content));
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify({ ok: true, path: input.path }),
            });
          } else if (tu.name === 'read_file') {
            const txt = await runner.readFile(String(input.path));
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: txt.length > 20_000 ? txt.slice(0, 20_000) + '\n…[truncated]' : txt,
            });
          } else if (tu.name === 'apply_patch') {
            const filePath = String(input.path);
            const patch = String(input.patch);
            const result = await runner.applyPatch(filePath, patch);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(result),
              is_error: !result.ok,
            });
          } else if (tu.name === 'mark_ready_for_deploy') {
            changelog = String(input.changelog ?? 'Build ready.');
            previewCmd = input.preview_cmd ? String(input.preview_cmd) : 'npm run dev';
            done = true;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify({ accepted: true }),
            });
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tu.id,
              content: `Unknown tool: ${tu.name}`,
              is_error: true,
            });
          }
        } catch (err) {
          emit(sessionId, {
            phase: 'failed',
            kind: 'error',
            message: `tool ${tu.name} failed: ${(err as Error).message}`,
          });
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: (err as Error).message,
            is_error: true,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }

    if (done) {
      emit(sessionId, {
        phase: 'done',
        kind: 'status',
        message: 'Agent reports build green.',
        data: { changelog, previewCmd },
      });
    }

    return {
      ok: done,
      iterations: iter,
      changelog,
      previewCmd,
      previewUrl: runner.previewUrl,
      sandboxId: runner.sandboxId,
      runner,
    };
  } catch (err) {
    emit(sessionId, {
      phase: 'failed',
      kind: 'error',
      message: (err as Error).message,
    });
    return {
      ok: false,
      iterations: iter,
      changelog,
      previewCmd,
      previewUrl: runner.previewUrl,
      sandboxId: runner.sandboxId,
      runner,
    };
  } finally {
    // Intentionally do NOT stop the sandbox here — the preview URL stays live
    // for the UI until either the TTL expires or the user clicks "Shut down".
  }
}
