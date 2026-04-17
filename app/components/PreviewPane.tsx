'use client';

import { useState } from 'react';

interface Props {
  previewUrl: string | null;
  sandboxId: string | null;
  deployJobId: string | null;
  changelog: string | null;
}

export function PreviewPane({ previewUrl, sandboxId, deployJobId, changelog }: Props) {
  const [framed, setFramed] = useState(true);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [shutDown, setShutDown] = useState(false);

  async function shutdown() {
    if (!sandboxId || shuttingDown || shutDown) return;
    if (!confirm(`Stop sandbox ${sandboxId}? The preview URL will die immediately.`)) return;
    setShuttingDown(true);
    try {
      const token =
        typeof window !== 'undefined'
          ? (window as { __GEM_AGENT_TOKEN__?: string }).__GEM_AGENT_TOKEN__
          : undefined;
      const res = await fetch(`/api/sandbox?sandboxId=${encodeURIComponent(sandboxId)}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(await res.text());
      setShutDown(true);
    } catch (err) {
      alert(`Shutdown failed: ${(err as Error).message}`);
    } finally {
      setShuttingDown(false);
    }
  }

  return (
    <div className="panel flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border">
        <div className="flex items-center gap-2">
          <span className="chip border-bg-border text-fg-secondary">
            <span className={`w-1.5 h-1.5 rounded-full ${shutDown ? 'bg-fg-muted' : previewUrl ? 'bg-teal' : 'bg-fg-muted'}`} />
            LIVE PREVIEW
          </span>
          {sandboxId && (
            <span className="text-2xs font-mono text-fg-muted">{sandboxId}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {previewUrl && !shutDown && (
            <>
              <button
                onClick={() => setFramed((v) => !v)}
                className="text-2xs font-mono uppercase tracking-wider px-2 py-1 rounded-sm border border-bg-border text-fg-secondary hover:border-fg-muted transition-colors"
              >
                {framed ? 'Hide frame' : 'Show frame'}
              </button>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-2xs font-mono uppercase tracking-wider px-2 py-1 rounded-sm border border-teal text-teal hover:bg-teal-glow transition-colors"
              >
                Open ↗
              </a>
            </>
          )}
          {sandboxId && !shutDown && (
            <button
              onClick={shutdown}
              disabled={shuttingDown}
              className="text-2xs font-mono uppercase tracking-wider px-2 py-1 rounded-sm border border-status-err/60 text-status-err hover:bg-status-err/10 transition-colors disabled:opacity-40"
            >
              {shuttingDown ? 'Stopping…' : 'Shut down'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-bg-base">
        {shutDown ? (
          <div className="h-full p-4 font-mono text-xs text-fg-muted">
            Sandbox stopped. Run a new build to provision a fresh microVM.
          </div>
        ) : previewUrl && framed ? (
          <iframe
            src={previewUrl}
            title="sandbox preview"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="h-full p-4 flex flex-col gap-3 overflow-auto">
            {!previewUrl && (
              <div className="text-fg-muted font-mono text-xs">
                No preview yet. The sandbox URL will appear here once the dev server is running.
              </div>
            )}
            {previewUrl && !framed && (
              <div className="font-mono text-xs text-fg-secondary break-all">
                <span className="text-fg-muted">URL · </span>
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">
                  {previewUrl}
                </a>
              </div>
            )}
            {deployJobId && (
              <div className="font-mono text-xs text-fg-secondary">
                <span className="text-fg-muted">DEPLOY · </span>
                <span className="text-status-info">{deployJobId}</span>
              </div>
            )}
            {changelog && (
              <div className="mt-2">
                <div className="label">CHANGELOG</div>
                <div className="font-mono text-xs text-fg-primary whitespace-pre-wrap leading-relaxed p-3 bg-bg-elevated border border-bg-border rounded">
                  {changelog}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
