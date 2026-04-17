# GEM Agent Builder

Real-time, instruction-driven build agent. Give it an English instruction and a
template or a GitHub repo; it provisions a Vercel Sandbox microVM, writes code,
runs the build + tests, iteratively self-fixes failures, and (optionally) opens
a PR and triggers a production deploy — all streamed live to the UI.

```
┌────────────────┐   POST /api/agent   ┌───────────────────────┐
│   InstructionPanel ──────────────────▶│    orchestrator       │
└────────────────┘                     │  (detached, non-block) │
                                       └──────────┬────────────┘
                                                  │
                                                  ▼
                                       ┌───────────────────────┐
                                       │  Claude tool-use loop │
                                       │  run_command          │
                                       │  write_file           │
                                       │  read_file            │
                                       │  mark_ready_for_deploy│
                                       └──────────┬────────────┘
                                                  │
                                                  ▼
                                       ┌───────────────────────┐
                                       │   Vercel Sandbox      │
                                       │   Firecracker microVM │
                                       │   node24 · /vercel/sandbox
                                       └──────────┬────────────┘
                                                  │ stdout/stderr
                                                  ▼
                                       ┌───────────────────────┐
                                       │   event-bus (pub/sub) │
                                       │   + 2k ring buffer    │
                                       └──────────┬────────────┘
             GET /api/agent/stream (SSE)          │
┌────────────────┐ ◀────────────────────────────── ┘
│   Transcript   │
│   PhaseStepper │
│   PreviewPane  │
└────────────────┘
```

## Quick start

```bash
pnpm install
cp .env.example .env.local
vercel link                    # connect to your Vercel project
vercel env pull                # pulls VERCEL_OIDC_TOKEN for local sandbox auth
# fill ANTHROPIC_API_KEY in .env.local
pnpm dev
# open http://localhost:3000
```

## Required environment

| Var                        | Required | Purpose |
|----------------------------|----------|---------|
| `ANTHROPIC_API_KEY`        | ✅       | Drives the agent loop. |
| `ANTHROPIC_MODEL`          |          | Override model (default `claude-opus-4-7`). |
| `VERCEL_OIDC_TOKEN`        | prod via OIDC / local via `vercel env pull` | Sandbox auth. |
| `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID` | non-Vercel hosts | Sandbox auth fallback. |
| `VERCEL_DEPLOY_HOOK_URL`   | optional | Enables **Deploy on green**. |
| `GITHUB_TOKEN`             | optional | Enables PR creation on repo-mode builds. |
| `GEM_AGENT_TOKEN`          | **prod** | Bearer token for `/api/agent` and `/api/deploy`. If unset, routes are open (dev only). |

## The agent contract

The agent sees four tools (`lib/agent.ts`). The UI sees a single stream of
typed events (`types/events.ts`). Every other file bridges the two.

### Iteration cap
`maxIterations` (default 12, hard max 25) bounds the tool-call loop so a
flaky test or hallucinated fix can't burn the API budget.

### Preview lifecycle
The sandbox is **kept warm** after the agent reports green so you can click
through the preview URL. It is NOT stopped automatically. Use the sandbox
timeout (20m default) or call `sandbox.stop()` to release compute.

## Deployment runbook (Vercel)

1. Create a Vercel project pointing at this repo.
2. Set `ANTHROPIC_API_KEY` in project env.
3. Settings → Git → Deploy Hooks → create `gem-agent` hook on your deploy
   branch (e.g. `main`). Copy the URL into `VERCEL_DEPLOY_HOOK_URL`.
4. Settings → Functions → confirm default region (sandbox latency matters).
5. Deploy. OIDC auth for Vercel Sandbox is injected automatically.

## Security posture

- **Sandbox isolation**: every build runs in a dedicated Firecracker microVM
  with its own filesystem and network namespace. Agent output cannot touch
  the host or the orchestrator process.
- **Secret boundary**: agent code executes in the sandbox; `ANTHROPIC_API_KEY`,
  `GITHUB_TOKEN`, and the deploy hook live only in the orchestrator. The
  sandbox never receives them.
- **PR scope**: `GITHUB_TOKEN` should be a fine-grained PAT scoped to the
  target repo with `Contents: RW` and `Pull Requests: RW`.
- **Deploy hook**: the hook URL itself is the capability — rotate it if
  leaked. It cannot exfiltrate secrets.
- **Iteration cap**: see above. Also cap your Anthropic spend via org limits.

## Known limits (v1)

- **Binary files in PRs**: `sandbox-export.ts` reads files as UTF-8. Binary
  assets (images, fonts) added by the agent inside the sandbox won't be
  committed. Add a base64 path in `exportChangedFiles` if that matters.
- **PR diff cap**: 200 files / 2 MB per file. Agents producing larger diffs
  should be split across multiple sessions anyway.
- **Single-process event bus**: fine for one orchestrator node. For
  horizontal scale, swap `lib/event-bus.ts` for Upstash Redis / Vercel KV
  pub/sub — the interface is already contained.
- **SSE auth is capability-based**: the stream route authorizes by knowing
  the UUIDv4 session id (unguessable in practice). If you need stronger
  guarantees, put the orchestrator behind Cloudflare Access or similar
  forward-auth at the edge.

## File map

```
app/
├── api/
│   ├── agent/route.ts           POST — starts session, returns 202 { sessionId }
│   ├── agent/stream/route.ts    GET  — SSE event stream
│   ├── deploy/route.ts          POST — manual deploy trigger
│   └── sandbox/route.ts         DELETE — stop a running sandbox by id
├── components/
│   ├── InstructionPanel.tsx     submission form
│   ├── PhaseStepper.tsx         pipeline visualization
│   ├── Transcript.tsx           auto-scrolling event log
│   ├── LogLine.tsx              single-event renderer
│   └── PreviewPane.tsx          iframe of sandbox preview URL
├── hooks/useAgentStream.ts      SSE reducer hook
├── layout.tsx / page.tsx / globals.css
lib/
├── env.ts                       zod-validated env
├── auth.ts                      bearer-token gate (opt-in, constant-time)
├── event-bus.ts                 per-session pub/sub + ring buffer
├── sandbox-runner.ts            @vercel/sandbox wrapper
├── sandbox-export.ts            sandbox → file map extractor for PRs
├── agent.ts                     Claude tool-use loop
├── github.ts                    Octokit PR opener
└── vercel-deploy.ts             deploy hook trigger
types/events.ts                  wire contract
```
