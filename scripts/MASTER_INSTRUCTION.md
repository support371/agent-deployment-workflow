# Master Auto-Instruction

Paste this into the instruction panel, or click **⚡ Load Auto-Instruction** in
the UI to pre-fill it. This runs a full 5-phase audit and build lockdown on
`support371/agent-deployment-workflow`.

---

You are GEM Build Agent working on the repository cloned at `/vercel/sandbox`.

Target: https://github.com/support371/agent-deployment-workflow

## Phase 1 — Discovery

Read these files in order before touching anything:

```
read_file    /vercel/sandbox/package.json
read_file    /vercel/sandbox/README.md
run_command  bash -lc "find /vercel/sandbox -maxdepth 3 -type f \
               ! -path '*/node_modules/*' ! -path '*/.git/*' \
               ! -path '*/.next/*' | sort"
read_file    /vercel/sandbox/tsconfig.json
read_file    /vercel/sandbox/next.config.js
read_file    /vercel/sandbox/vercel.json
run_command  bash -lc "cat /vercel/sandbox/.env.example 2>/dev/null"
```

Then read every `app/api/**/route.ts`, `lib/*.ts`, and `types/*.ts`.

## Phase 2 — Audit

Score each item: `correct` | `broken` | `missing`.

**Core build**
- `package.json` — scripts: setup, dev, build, start, lint, typecheck
- `tsconfig.json` — strict: true, baseUrl + paths alias `@/*`
- `next.config.js` — serverActions enabled, nodejs runtime on routes
- `vercel.json` — maxDuration per route, build env defaults
- `tailwind.config.ts` — GEM tokens: `#00c9a0`, DM Sans, JetBrains Mono

**Env + auth**
- `lib/env.ts` — Zod schema, fail-fast on boot
- `lib/auth.ts` — bearer gate, `timingSafeEqual`, opt-in when unset
- `.env.example` — all vars documented
- `scripts/setup.sh` — CLI auto-discovery, deploy hook creation, Vercel push

**Event bus + SSE**
- `lib/event-bus.ts` — pub/sub, 2k ring buffer, lastEventId reconnect
- `app/api/agent/stream/route.ts` — SSE, heartbeat ping, replay
- `types/events.ts` — StreamEvent, AgentPhase, AgentRequest exported

**Sandbox**
- `lib/sandbox-runner.ts` — `readFileToBuffer` (not `readFile`)
- `lib/sandbox-export.ts` — git diff extractor for PR commits

**Agent loop**
- `lib/agent.ts` — 5 tools: run_command, write_file, read_file, apply_patch, mark_ready_for_deploy
- Iteration cap enforced (default 12, hard max 25)
- `AgentOutcome` exposes runner handle

**Integrations**
- `lib/github.ts` — Octokit blob → tree → commit → ref → PR
- `lib/vercel-deploy.ts` — deploy hook trigger
- `app/api/deploy/route.ts` — POST, auth-gated
- `app/api/sandbox/route.ts` — DELETE by sandboxId, auth-gated

**Orchestration**
- `app/api/agent/route.ts` — detached `orchestrate()`, keepWarm logic, `sandbox.stop()` on failure, PR export, deploy trigger

**UI**
- `app/globals.css` — Tailwind, scrollbar, pulse-dot, desktop overflow:hidden
- `app/layout.tsx` — DM Sans / Syne / JetBrains Mono fonts
- `app/page.tsx` — mobile tabs + `lg:3-col`, auto-switch on submit
- `PhaseStepper.tsx` — mobile progress bar, desktop short labels
- `Transcript.tsx` — filterable, auto-scroll, fills parent
- `LogLine.tsx` — kind/stream colour coding
- `InstructionPanel.tsx` — ⚡ Load Auto-Instruction button, repo defaults
- `PreviewPane.tsx` — iframe, shutdown button, changelog
- `useAgentStream.ts` — SSE reducer, phase reducer

## Phase 3 — Remediation

For every `broken` or `missing` — write or patch the file.
After every 3 file writes:

```
npm run build 2>&1 | tail -40
```

Fix all errors before continuing. Never use `@ts-ignore`.

**Critical implementation shapes**

```ts
// readFile
const buf = await sandbox.readFileToBuffer({ path });
if (!buf) throw new Error(`File not found: ${path}`);
return buf.toString('utf8');

// keepWarm
const keepWarm = outcome.ok && !req.autoDeploy;
if (!keepWarm && outcome.runner) await outcome.runner.stop();

// tab switch
setSessionId(sid);
setMobileTab('transcript');
```

## Phase 4 — Verification

All must exit 0:

```
npm install
npm run typecheck
npm run lint
npm run build
```

Verify build shows `nodejs` runtime for all 4 `/api` routes.
If any step fails — read full error, fix root cause, re-run from that step.

## Phase 5 — Lock

Write `/vercel/sandbox/BUILD_LOCK.md` containing:

- ISO timestamp + git HEAD
- Full Phase 2 checklist with status markers
- Last 20 lines of `npm run build`
- `node --version`, key dependency versions

Call `mark_ready_for_deploy` only after all Phase 4 commands exit 0.
Changelog must list every file changed plus the audit summary.
