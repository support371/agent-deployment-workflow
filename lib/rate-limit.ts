// lib/rate-limit.ts
// Simple in-memory sliding window rate limiter.
// For production at scale, swap to Upstash Redis adapter.

interface RateLimitEntry {
  timestamps: number[];
}

// Both the store and the cleanup interval are hung off `globalThis` so they
// survive Next.js dev-mode HMR reloads of this module. Without this, each
// hot-reload would leak a new setInterval timer AND reset the rate-limit
// state — effectively disabling the limiter in development.
const globalStore = globalThis as unknown as {
  __gemAgentRateLimit?: Map<string, RateLimitEntry>;
  __gemAgentRateLimitTimer?: ReturnType<typeof setInterval>;
};
const store: Map<string, RateLimitEntry> =
  globalStore.__gemAgentRateLimit ?? new Map<string, RateLimitEntry>();
globalStore.__gemAgentRateLimit = store;

export interface RateLimitConfig {
  windowMs: number;     // Time window in milliseconds
  maxRequests: number;  // Max requests per window
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 10,       // 10 requests per minute
};

/**
 * Check if a request from the given identifier is allowed.
 * Uses sliding window algorithm for smoother rate limiting.
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = DEFAULT_CONFIG
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Get or create entry
  let entry = store.get(identifier);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(identifier, entry);
  }

  // Remove timestamps outside the current window
  entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);

  const allowed = entry.timestamps.length < config.maxRequests;

  if (allowed) {
    entry.timestamps.push(now);
  }

  // Remaining is calculated after adding the current request
  const remaining = Math.max(0, config.maxRequests - entry.timestamps.length);

  // Calculate reset time (when the oldest request in window expires)
  const oldestInWindow = entry.timestamps[0];
  const resetAt = oldestInWindow ? oldestInWindow + config.windowMs : now + config.windowMs;

  return { allowed, remaining, resetAt };
}

/**
 * Get client identifier from request headers.
 * Uses X-Forwarded-For in production (behind Vercel's edge), falls back to IP.
 */
export function getClientId(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  return 'unknown';
}

/**
 * Periodic cleanup of old entries to prevent memory leak.
 * Call this on a timer or after N requests.
 */
export function cleanupRateLimitStore(maxAgeMs: number = 5 * 60 * 1000): void {
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, entry] of store.entries()) {
    const latest = entry.timestamps[entry.timestamps.length - 1];
    if (!latest || latest < cutoff) {
      store.delete(key);
    }
  }
}

// Auto-cleanup every 5 minutes. Guarded against HMR double-registration by
// checking `globalStore.__gemAgentRateLimitTimer` before creating the timer.
if (typeof setInterval !== 'undefined' && !globalStore.__gemAgentRateLimitTimer) {
  globalStore.__gemAgentRateLimitTimer = setInterval(
    () => cleanupRateLimitStore(),
    5 * 60 * 1000,
  );
}
