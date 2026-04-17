'use client';

import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error('[GEM Agent] Client error:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
      <div className="max-w-md w-full panel p-6 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-status-err/10 flex items-center justify-center">
          <svg
            className="w-6 h-6 text-status-err"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        
        <h2 className="text-xl font-semibold text-fg-primary mb-2">
          Something went wrong
        </h2>
        
        <p className="text-fg-secondary text-sm mb-4">
          An unexpected error occurred while processing your request.
        </p>

        {error.digest && (
          <p className="text-fg-muted text-xs font-mono mb-4">
            Error ID: {error.digest}
          </p>
        )}

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="btn-ghost"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.href = '/'}
            className="btn-primary"
          >
            Go home
          </button>
        </div>
      </div>
    </div>
  );
}
