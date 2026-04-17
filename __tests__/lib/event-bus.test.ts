import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to reset the module state between tests
describe('event-bus', () => {
  let createSession: typeof import('@/lib/event-bus').createSession;
  let emit: typeof import('@/lib/event-bus').emit;
  let close: typeof import('@/lib/event-bus').close;
  let subscribe: typeof import('@/lib/event-bus').subscribe;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('@/lib/event-bus');
    createSession = module.createSession;
    emit = module.emit;
    close = module.close;
    subscribe = module.subscribe;
  });

  describe('createSession', () => {
    it('should create a new session', () => {
      expect(() => createSession('test-session-1')).not.toThrow();
    });
  });

  describe('emit', () => {
    it('should emit events to subscribers', async () => {
      const sessionId = 'test-emit-1';
      createSession(sessionId);
      
      emit(sessionId, { phase: 'planning', kind: 'status', message: 'test' });

      const gen = subscribe(sessionId);
      const { value: event } = await gen.next();
      
      expect(event).toMatchObject({
        phase: 'planning',
        kind: 'status',
        message: 'test',
      });
    });

    it('should include timestamp and id in events', async () => {
      const sessionId = 'test-emit-2';
      createSession(sessionId);
      
      emit(sessionId, { phase: 'building', kind: 'log', message: 'hello' });

      const gen = subscribe(sessionId);
      const { value: event } = await gen.next();

      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('ts');
    });
  });

  describe('subscribe', () => {
    it('should replay buffered events on subscribe', async () => {
      const sessionId = 'test-replay-1';
      createSession(sessionId);
      
      // Emit some events before subscribing
      emit(sessionId, { phase: 'planning', kind: 'status', message: 'first' });
      emit(sessionId, { phase: 'building', kind: 'status', message: 'second' });

      const gen = subscribe(sessionId);
      const events = [];
      
      // Get the two buffered events
      const result1 = await gen.next();
      events.push(result1.value);
      const result2 = await gen.next();
      events.push(result2.value);

      expect(events.length).toBe(2);
      expect(events[0].message).toBe('first');
      expect(events[1].message).toBe('second');
    });

    it('should support fromId for partial replay', async () => {
      const sessionId = 'test-replay-2';
      createSession(sessionId);
      
      emit(sessionId, { phase: 'planning', kind: 'status', message: 'first' });
      emit(sessionId, { phase: 'building', kind: 'status', message: 'second' });

      // Get the first event's id
      const gen1 = subscribe(sessionId);
      const { value: firstEvent } = await gen1.next();

      // Subscribe from after the first event
      const gen2 = subscribe(sessionId, firstEvent.id);
      const { value: nextEvent } = await gen2.next();

      expect(nextEvent.message).toBe('second');
    });
  });

  describe('close', () => {
    it('should clean up session resources', () => {
      const sessionId = 'test-close-1';
      createSession(sessionId);
      emit(sessionId, { phase: 'done', kind: 'done', message: 'complete' });
      
      expect(() => close(sessionId)).not.toThrow();
    });
  });
});
