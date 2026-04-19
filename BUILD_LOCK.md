# BUILD_LOCK

**Timestamp (ISO):** 2026-04-17T00:00:00Z
**Repository:** [support371/agent-deployment-workflow](https://github.com/support371/agent-deployment-workflow)
**Branch:** `gem-agent-builder-manual`
**Git HEAD:** `eafc08ff6ad8fcfa42cdb5db90d945f63f7840f7`
**Node:** v24.14.1 (engines requires >=20)
**Package manager:** pnpm 10.33.0
**Status:** LOCKED — ready for deploy

---

## Phase 2 Audit Results

### Core build

| Item | Status | Notes |
| :--- | :--- | :--- |
| `package.json` scripts: setup, dev, build, start, lint, typecheck | OK | all present; also test, test:watch, test:coverage, test:e2e |
| `tsconfig.json` — strict + `@/*` alias | OK | strict: true, baseUrl + paths alias |
| `next.config.js` — nodejs runtime, server actions | OK | all 6 api routes declare `export const runtime = 'nodejs'` |
| `vercel.json` — maxDuration, build env | OK | present at repo root |
| `tailwind.config.ts` — GEM tokens `#00c9a0`, DM Sans, JetBrains Mono | OK | tokens defined |

### Env + auth

| Item | Status | Notes |
| :--- | :--- | :--- |
| `lib/env.ts` — Zod schema, fail-fast | OK | 10 vars validated on boot |
| `lib/auth.ts` — bearer gate, `timingSafeEqual` | OK | opt-in when token unset |
| `.env.example` — all vars documented | OK | created in previous turn |
| `scripts/setup.sh` — one-command bootstrap | OK | idempotent, reuses existing deploy hook; verified on re-run |

### Event bus + SSE

| Item | Status | Notes |
| :--- | :--- | :--- |
| `lib/event-bus.ts` — pub/sub, 2k ring, lastEventId replay | OK | |
| `app/api/agent/stream/route.ts` — SSE + heartbeat | OK | `dynamic = 'force-dynamic'` set |
| `types/events.ts` — `StreamEvent`, `AgentPhase`, `AgentRequest` exported | OK | imported by 10 call sites |

### Sandbox

| Item | Status | Notes |
| :--- | :--- | :--- |
| `lib/sandbox-runner.ts` — `readFileToBuffer` | OK | correct shape |
| `lib/sandbox-export.ts` — git diff extractor for PR | OK | |

### Agent loop

| Item | Status | Notes |
| :--- | :--- | :--- |
| `lib/agent.ts` — 5 tools | OK | run_command, write_file, read_file, apply_patch, mark_ready_for_deploy |
| Iteration cap enforced | OK | default 12, hard max 25 |
| `AgentOutcome` exposes runner handle | OK | |

### Integrations

| Item | Status | Notes |
| :--- | :--- | :--- |
| `lib/github.ts` — Octokit blob → tree → commit → ref → PR | OK | |
| `lib/vercel-deploy.ts` — deploy-hook trigger | OK | |
| `app/api/deploy/route.ts` — POST, auth-gated | OK | |
| `app/api/sandbox/route.ts` — DELETE, auth-gated | OK | |

### Orchestration

| Item | Status | Notes |
| :--- | :--- | :--- |
| `app/api/agent/route.ts` — detached orchestrate, keepWarm, PR export, deploy trigger | OK | `maxDuration = 300` |

### UI

| Item | Status | Notes |
| :--- | :--- | :--- |
| `app/globals.css` — Tailwind, pulse-dot, overflow:hidden | OK | |
| `app/layout.tsx` — DM Sans / Syne / JetBrains Mono | OK | |
| `app/page.tsx` — mobile tabs + lg:3-col | OK | |
| `PhaseStepper.tsx`, `Transcript.tsx`, `LogLine.tsx`, `InstructionPanel.tsx`, `PreviewPane.tsx`, `useAgentStream.ts` | OK | all present under `app/components` and `app/hooks` |

### Remediations applied in this pass

- Created `scripts/setup.sh` (idempotent; reuse-or-create deploy hook via `extract_hook_url` node parser over Vercel `link.deployHooks[]`)
- Created `scripts/MASTER_INSTRUCTION.md`
- Created `.env.example`
- Added `"setup": "bash scripts/setup.sh"` to `package.json`
- Created `.eslintrc.json` (Next.js strict) — unblocks `npm run lint` non-interactively
- Pinned `eslint@8.57.1` + `eslint-config-next@14.2.18` (pnpm had installed eslint v10 which is incompatible with Next 14 eslint config)

---

## Phase 4 Verification — all exit 0

```
pnpm install         exit 0
npm run typecheck    exit 0
npm run lint         exit 0   ✔ No ESLint warnings or errors
npm run build        exit 0   ✓ Compiled successfully
```

### Last 20 lines of `npm run build`

```
   Collecting build traces ...

Route (app)                              Size     First Load JS
┌ ○ /                                    5.45 kB        92.5 kB
├ ○ /_not-found                          872 B          87.9 kB
├ ƒ /api/agent                           0 B                0 B
├ ƒ /api/agent/stream                    0 B                0 B
├ ƒ /api/deploy                          0 B                0 B
├ ƒ /api/health                          0 B                0 B
├ ƒ /api/sandbox                         0 B                0 B
└ ƒ /api/sessions/[id]                   0 B                0 B
+ First Load JS shared by all            87.1 kB
  ├ chunks/588-3758d2d00790ade2.js       31.6 kB
  ├ chunks/7d771d05-def82783769ba646.js  53.6 kB
  └ other shared chunks (total)          1.86 kB

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

All 6 `/api/*` routes are emitted as `ƒ` (dynamic, server-rendered) under the `nodejs` runtime, as required.

---

## Key dependency versions

| Package | Version |
| :--- | :--- |
| next | 14.2.18 |
| react / react-dom | ^18.3.1 |
| @anthropic-ai/sdk | ^0.40.0 |
| @vercel/sandbox | ^1.0.0 |
| @octokit/rest | ^21.0.2 |
| zod | ^3.23.8 |
| ms | ^2.1.3 |
| tailwindcss | ^3.4.14 |
| typescript | ^5.6.3 |
| eslint | 8.57.1 |
| eslint-config-next | 14.2.18 |
| vitest | ^4.1.4 |

---

## Ready for deploy

`mark_ready_for_deploy` gate cleared. Orchestrator may fire the Vercel deploy hook.
