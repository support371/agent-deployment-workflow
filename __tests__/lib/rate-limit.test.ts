import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('rate-limit', () => {
  let checkRateLimit: typeof import('@/lib/rate-limit').checkRateLimit;
  let getClientId: typeof import('@/lib/rate-limit').getClientId;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const module = await import('@/lib/rate-limit');
    checkRateLimit = module.checkRateLimit;
    getClientId = module.getClientId;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkRateLimit', () => {
    it('should allow requests within limit', () => {
      const config = { windowMs: 60_000, maxRequests: 3 };
      const id = `test-ip-allow-${Date.now()}`;
      
      const result1 = checkRateLimit(id, config);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(2);

      const result2 = checkRateLimit(id, config);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(1);

      const result3 = checkRateLimit(id, config);
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(0);
    });

    it('should block requests over limit', () => {
      const config = { windowMs: 60_000, maxRequests: 2 };
      const id = `test-ip-block-${Date.now()}`;
      
      checkRateLimit(id, config);
      checkRateLimit(id, config);
      
      const result = checkRateLimit(id, config);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should reset after window expires', () => {
      const config = { windowMs: 60_000, maxRequests: 1 };
      const id = `test-ip-reset-${Date.now()}`;
      
      const result1 = checkRateLimit(id, config);
      expect(result1.allowed).toBe(true);

      const result2 = checkRateLimit(id, config);
      expect(result2.allowed).toBe(false);

      // Advance time past the window
      vi.advanceTimersByTime(61_000);

      const result3 = checkRateLimit(id, config);
      expect(result3.allowed).toBe(true);
    });

    it('should track different identifiers separately', () => {
      const config = { windowMs: 60_000, maxRequests: 1 };
      
      const resultA = checkRateLimit(`ip-a-${Date.now()}`, config);
      expect(resultA.allowed).toBe(true);

      const resultB = checkRateLimit(`ip-b-${Date.now()}`, config);
      expect(resultB.allowed).toBe(true);
    });
  });

  describe('getClientId', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
      });
      
      expect(getClientId(request)).toBe('1.2.3.4');
    });

    it('should extract IP from x-real-ip header', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-real-ip': '9.8.7.6' },
      });
      
      expect(getClientId(request)).toBe('9.8.7.6');
    });

    it('should return unknown when no IP headers present', () => {
      const request = new Request('http://localhost');
      
      expect(getClientId(request)).toBe('unknown');
    });
  });
});
