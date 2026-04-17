// types/events.ts — single source of truth for the streaming event contract.
// Every producer (agent loop, sandbox runner, deploy step) emits these.
// The UI consumes them verbatim. Changing this file changes the wire format.

export type AgentPhase =
  | 'queued'
  | 'planning'
  | 'scaffolding'
  | 'sandbox_provisioning'
  | 'installing'
  | 'building'
  | 'testing'
  | 'fixing'
  | 'pr_opening'
  | 'deploying'
  | 'done'
  | 'failed';

export interface StreamEvent {
  id: string;           // monotonic per-session event id
  ts: number;           // epoch ms
  phase: AgentPhase;
  kind:
    | 'status'          // phase transition / high-level signal
    | 'thought'         // agent reasoning chunk
    | 'tool_call'       // agent invoked a tool
    | 'tool_result'     // tool returned
    | 'log'             // raw sandbox stdout/stderr
    | 'diff'            // file edit preview
    | 'url'             // preview URL available
    | 'error'
    | 'done';
  stream?: 'stdout' | 'stderr' | 'agent';
  message: string;
  data?: Record<string, unknown>;
}

export interface AgentRequest {
  instruction: string;
  repo?: { owner: string; name: string; branch?: string } | null;
  template?: 'next14-ts' | 'vite-react-ts' | 'node-api' | 'blank';
  autoDeploy: boolean;
  autoFix: boolean;
  maxIterations?: number;
}

export interface AgentSession {
  id: string;
  createdAt: number;
  request: AgentRequest;
}
