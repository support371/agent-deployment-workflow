// lib/agent.ts
// Multi-provider (Claude/OpenAI) build/test/fix loop.
//
// Design:
//   - The model is the planner; we expose 5 tools that map 1:1 to sandbox ops.
//   - We enforce a hard iteration cap so a flaky test can't burn the budget.
//   - Every tool call and model message is surfaced on the event bus so the UI
//     renders a live transcript, not a black box.
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
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

// Tool schemas shared by both providers
const TOOL_SCHEMAS = {
  run_command: {
    description: 'Execute a shell command inside the sandbox and return stdout, stderr, exit code.',
    parameters: {
      type: 'object' as const,
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
  write_file: {
    description: 'Create or overwrite a file at the given absolute path inside the sandbox.',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        phase: {
          type: 'string',
          enum: ['installing', 'building', 'testing', 'fixing', 'scaffolding'],
          description: 'Which build phase this edit belongs to (for the UI phase stepper).',
        },
      },
      required: ['path', 'content'],
    },
  },
  read_file: {
    description: 'Read a UTF-8 file and return its contents.',
    parameters: {
      type: 'object' as const,
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  apply_patch: {
    description: 'Apply a unified diff patch to an existing file. Prefer this over write_file for small edits.',
    parameters: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Absolute path to the file to patch' },
        patch: { type: 'string', description: 'Unified diff format patch content' },
        phase: {
          type: 'string',
          enum: ['installing', 'building', 'testing', 'fixing', 'scaffolding'],
          description: 'Which build phase this edit belongs to (for the UI phase stepper).',
        },
      },
      required: ['path', 'patch'],
    },
  },
  mark_ready_for_deploy: {
    description: 'Declare that the project builds and tests pass; orchestrator will open PR and deploy.',
    parameters: {
      type: 'object' as const,
      properties: {
        changelog: { type: 'string', description: 'One-paragraph summary of changes' },
        preview_cmd: { type: 'string', description: 'Command to start the dev server, e.g. "npm run dev"' },
      },
      required: ['changelog'],
    },
  },
};

// Anthropic format
const ANTHROPIC_TOOLS: Anthropic.Messages.Tool[] = Object.entries(TOOL_SCHEMAS).map(
  ([name, schema]) => ({
    name,
    description: schema.description,
    input_schema: schema.parameters,
  }),
);

// OpenAI format
const OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = Object.entries(TOOL_SCHEMAS).map(
  ([name, schema]) => ({
    type: 'function' as const,
    function: {
      name,
      description: schema.description,
      parameters: schema.parameters,
    },
  }),
);

// Unified tool call interface
interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResult {
  id: string;
  content: string;
  isError: boolean;
}

// Execute a single tool call against the runner
async function executeTool(
  sessionId: string,
  runner: RunnerResult,
  tc: ToolCall,
): Promise<{ result: ToolResult; changelog?: string; previewCmd?: string; done?: boolean }> {
  const { id, name, input } = tc;
  
  try {
    if (name === 'run_command') {
      const cmd = String(input.cmd);
      const args = Array.isArray(input.args) ? (input.args as string[]) : [];
      const phase = (input.phase as
        | 'installing' | 'building' | 'testing' | 'fixing' | 'scaffolding') ?? 'building';
      const r = await runner.runCmd(phase, cmd, args, { sudo: Boolean(input.sudo) });
      return {
        result: {
          id,
          content: JSON.stringify({
            exitCode: r.exitCode,
            stdoutTail: r.stdout.slice(-4_000),
            stderrTail: r.stderr.slice(-4_000),
          }),
          isError: r.exitCode !== 0,
        },
      };
    } else if (name === 'write_file') {
      const phase = (input.phase as
        | 'installing' | 'building' | 'testing' | 'fixing' | 'scaffolding' | undefined);
      await runner.writeFile(String(input.path), String(input.content), phase);
      return {
        result: {
          id,
          content: JSON.stringify({ ok: true, path: input.path }),
          isError: false,
        },
      };
    } else if (name === 'read_file') {
      const txt = await runner.readFile(String(input.path));
      return {
        result: {
          id,
          content: txt.length > 20_000 ? txt.slice(0, 20_000) + '\n…[truncated]' : txt,
          isError: false,
        },
      };
    } else if (name === 'apply_patch') {
      const filePath = String(input.path);
      const patch = String(input.patch);
      const phase = (input.phase as
        | 'installing' | 'building' | 'testing' | 'fixing' | 'scaffolding' | undefined);
      const patchResult = await runner.applyPatch(filePath, patch, phase);
      return {
        result: {
          id,
          content: JSON.stringify(patchResult),
          isError: !patchResult.ok,
        },
      };
    } else if (name === 'mark_ready_for_deploy') {
      const changelog = String(input.changelog ?? 'Build ready.');
      const previewCmd = input.preview_cmd ? String(input.preview_cmd) : 'npm run dev';
      return {
        result: {
          id,
          content: JSON.stringify({ accepted: true }),
          isError: false,
        },
        changelog,
        previewCmd,
        done: true,
      };
    } else {
      return {
        result: {
          id,
          content: `Unknown tool: ${name}`,
          isError: true,
        },
      };
    }
  } catch (err) {
    emit(sessionId, {
      phase: 'failed',
      kind: 'error',
      message: `tool ${name} failed: ${(err as Error).message}`,
    });
    return {
      result: {
        id,
        content: (err as Error).message,
        isError: true,
      },
    };
  }
}

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
  const provider = e.AGENT_PROVIDER;
  const maxIters = Math.max(1, Math.min(req.maxIterations ?? 12, 25));

  emit(sessionId, {
    phase: 'planning',
    kind: 'status',
    message: `Agent online (${provider}). Planning…`,
  });

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

  let changelog: string | null = null;
  let previewCmd: string | null = null;
  let iter = 0;
  let done = false;

  try {
    if (provider === 'openai') {
      // ─────────────────────────────────────────────────────────────
      // OpenAI path
      // ─────────────────────────────────────────────────────────────
      const openai = new OpenAI({ apiKey: e.OPENAI_API_KEY });
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userSeed },
      ];

      while (iter < maxIters && !done) {
        iter++;
        emit(sessionId, {
          phase: iter === 1 ? 'planning' : 'building',
          kind: 'status',
          message: `iteration ${iter}/${maxIters}`,
        });

        const response = await openai.chat.completions.create({
          model: e.OPENAI_MODEL,
          max_tokens: 4096,
          tools: OPENAI_TOOLS,
          messages,
        });

        const choice = response.choices[0];
        if (!choice) break;

        const assistantMsg = choice.message;

        // Surface any prose the model emits
        if (assistantMsg.content?.trim()) {
          emit(sessionId, {
            phase: 'planning',
            kind: 'thought',
            stream: 'agent',
            message: assistantMsg.content,
          });
        }

        // Add assistant message to history
        messages.push(assistantMsg);

        if (choice.finish_reason === 'stop' || !assistantMsg.tool_calls?.length) {
          emit(sessionId, {
            phase: 'failed',
            kind: 'error',
            message: 'Agent stopped without marking ready for deploy.',
          });
          break;
        }

        // Process tool calls
        for (const tc of assistantMsg.tool_calls) {
          // Handle both standard function calls and custom tool calls
          if (tc.type !== 'function') continue;
          
          const toolCall: ToolCall = {
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments || '{}'),
          };

          const { result, changelog: cl, previewCmd: pc, done: isDone } = await executeTool(
            sessionId,
            runner,
            toolCall,
          );

          if (cl) changelog = cl;
          if (pc) previewCmd = pc;
          if (isDone) done = true;

          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: result.content,
          });
        }
      }
    } else {
      // ─────────────────────────────────────────────────────────────
      // Anthropic path
      // ─────────────────────────────────────────────────────────────
      const anthropic = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY });
      const messages: Anthropic.Messages.MessageParam[] = [
        { role: 'user', content: userSeed },
      ];

      while (iter < maxIters && !done) {
        iter++;
        emit(sessionId, {
          phase: iter === 1 ? 'planning' : 'building',
          kind: 'status',
          message: `iteration ${iter}/${maxIters}`,
        });

        const response = await anthropic.messages.create({
          model: e.ANTHROPIC_MODEL,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: ANTHROPIC_TOOLS,
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
          emit(sessionId, {
            phase: 'failed',
            kind: 'error',
            message: 'Agent stopped without marking ready for deploy.',
          });
          break;
        }

        if (response.stop_reason !== 'tool_use') {
          // Anything that isn't end_turn / stop_sequence / tool_use is a state
          // we can't recover from by simply re-prompting (max_tokens, pause_turn,
          // tool_use with no blocks, etc.). Continuing the loop without
          // updating message history would re-send the same prompt and spin
          // until the iteration budget is exhausted — fail fast instead.
          emit(sessionId, {
            phase: 'failed',
            kind: 'error',
            message: `Agent halted unexpectedly: stop_reason=${response.stop_reason}`,
          });
          break;
        }

        const toolUses = response.content.filter(
          (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
        );

        // Append assistant turn verbatim so the tool_result ids line up.
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];

        for (const tu of toolUses) {
          const toolCall: ToolCall = {
            id: tu.id,
            name: tu.name,
            input: tu.input as Record<string, unknown>,
          };

          const { result, changelog: cl, previewCmd: pc, done: isDone } = await executeTool(
            sessionId,
            runner,
            toolCall,
          );

          if (cl) changelog = cl;
          if (pc) previewCmd = pc;
          if (isDone) done = true;

          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: result.content,
            is_error: result.isError,
          });
        }

        messages.push({ role: 'user', content: toolResults });
      }
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
