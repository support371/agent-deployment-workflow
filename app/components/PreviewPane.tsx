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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3 py-2.5 border-b border-bg-border">
        <div className="flex items-center justify-between sm:justify-start gap-2">
          <span className="chip border-bg-border text-fg-secondary">
            <span className={`w-1.5 h-1.5 rounded-full ${shutDown ? 'bg-fg-muted' : previewUrl ? 'bg-teal pulse-dot' : 'bg-fg-muted'}`} />
            PREVIEW
          </span>
          {sandboxId && (
            <span className="text-2xs font-mono text-fg-muted truncate max-w-[120px]">{sandboxId}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {previewUrl && !shutDown && (
            <>
              <button
                onClick={() => setFramed((v) => !v)}
                className="text-xs sm:text-2xs font-mono uppercase tracking-wider px-2.5 sm:px-2 py-1.5 sm:py-1 rounded-md sm:rounded-sm border border-bg-border text-fg-secondary hover:border-fg-muted transition-colors whitespace-nowrap"
              >
                {framed ? 'Hide' : 'Show'}
              </button>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs sm:text-2xs font-mono uppercase tracking-wider px-2.5 sm:px-2 py-1.5 sm:py-1 rounded-md sm:rounded-sm border border-teal text-teal hover:bg-teal-glow transition-colors whitespace-nowrap"
              >
                Open
              </a>
            </>
          )}
          {sandboxId && !shutDown && (
            <button
              onClick={shutdown}
              disabled={shuttingDown}
              className="text-xs sm:text-2xs font-mono uppercase tracking-wider px-2.5 sm:px-2 py-1.5 sm:py-1 rounded-md sm:rounded-sm border border-status-err/60 text-status-err hover:bg-status-err/10 transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              {shuttingDown ? 'Stopping...' : 'Stop'}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-bg-base">
        {shutDown ? (
          <div className="h-full p-4 flex flex-col items-center justify-center text-center">
            <div className="text-fg-muted font-mono text-sm sm:text-xs mb-1">
              Sandbox stopped
            </div>
            <div className="text-fg-muted/60 text-xs">
              Run a new build to provision a fresh microVM
            </div>
          </div>
        ) : previewUrl && framed ? (
          <iframe
            src={previewUrl}
            title="sandbox preview"
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className="h-full p-4 flex flex-col gap-4 overflow-auto">
            {!previewUrl && (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                <div className="w-12 h-12 rounded-full bg-bg-elevated border border-bg-border flex items-center justify-center mb-3">
                  <span className="text-fg-muted text-lg">⬡</span>
                </div>
                <div className="text-fg-muted font-mono text-sm sm:text-xs mb-1">
                  No preview yet
                </div>
                <div className="text-fg-muted/60 text-xs max-w-[200px]">
                  The sandbox URL will appear here once the dev server is running
                </div>
              </div>
            )}
            {previewUrl && !framed && (
              <div className="panel p-3">
                <div className="label mb-1">Preview URL</div>
                <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="font-mono text-sm sm:text-xs text-teal hover:underline break-all">
                  {previewUrl}
                </a>
              </div>
            )}
            {deployJobId && (
              <div className="panel p-3">
                <div className="label mb-1">Deploy Job</div>
                <span className="font-mono text-sm sm:text-xs text-status-info">{deployJobId}</span>
              </div>
            )}
            {changelog && (
              <div className="panel p-3">
                <div className="label mb-2">Changelog</div>
                <div className="font-mono text-sm sm:text-xs text-fg-primary whitespace-pre-wrap leading-relaxed">
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
