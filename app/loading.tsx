export default function Loading() {
  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 rounded bg-teal-glow border border-teal/40 flex items-center justify-center">
          <span className="text-teal font-display font-bold text-lg pulse-dot">G</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-teal pulse-dot" />
          <span className="text-fg-secondary text-sm font-mono">Loading GEM Agent Builder...</span>
        </div>
      </div>
    </div>
  );
}
