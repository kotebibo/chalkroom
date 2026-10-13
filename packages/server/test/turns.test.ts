import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Envelope } from '@chalk/schema';
import { TurnManager } from '../src/turns';

const env = (text: string): Envelope => ({ chalk: 1, type: 'question', text });

describe('TurnManager', () => {
  afterEach(() => vi.useRealTimers());

  it('pushes via channel when idle and holds input while busy', async () => {
    const delivered: Envelope[][] = [];
    const t = new TurnManager({ deliver: (e) => { delivered.push(e); }, onState: () => {} });
    expect(await t.submit(env('a'))).toBe('sent');
    expect(delivered).toHaveLength(1);
    // Claude is now working; new input must not go to the channel (it would queue until the turn ends)
    expect(await t.submit(env('b'))).toBe('held');
    expect(delivered).toHaveLength(1);
    // ...it rides along on the next tool result
    expect(t.toolActivity().map((e) => e.text)).toEqual(['b']);
    expect(t.toolActivity()).toEqual([]);
    t.dispose();
  });

  it('lesson_yield returns held input instead of going idle', async () => {
    const t = new TurnManager({ deliver: () => {}, onState: () => {} });
    await t.submit(env('a'));
    await t.submit(env('b'));
    expect(t.yieldTurn().map((e) => e.text)).toEqual(['b']);
    expect(t.busy).toBe(true);
    expect(t.yieldTurn()).toEqual([]);
    expect(t.busy).toBe(false);
    t.dispose();
  });

  it('flushes held input through the channel when Claude goes quiet without yielding', async () => {
    vi.useFakeTimers();
    const delivered: Envelope[][] = [];
    const t = new TurnManager({ deliver: (e) => { delivered.push(e); }, onState: () => {}, idleAfterMs: 5000 });
    await t.submit(env('a'));
    await t.submit(env('b'));
    vi.advanceTimersByTime(7000);
    expect(delivered.map((d) => d.map((e) => e.text))).toEqual([['a'], ['b']]);
    t.dispose();
  });

  it('falls back to terminal mode without an ack, and recovers on any tool call', async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const t = new TurnManager({ deliver: () => {}, onState: (s) => states.push(s), ackTimeoutMs: 1000 });
    await t.heartbeat();
    vi.advanceTimersByTime(1500);
    expect(t.state).toBe('terminal');
    t.toolActivity();
    expect(['connected', 'thinking']).toContain(t.state);
    t.dispose();
  });
});
