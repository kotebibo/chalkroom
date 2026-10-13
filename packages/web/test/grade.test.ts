import { describe, it, expect } from 'vitest';
import type { Question } from '@chalk/schema';
import { gradeItem, fuzzyEqual } from '../src/lib/grade';
import { schedule, isDue, parseCsv, toCsv } from '../src/lib/srs';

const q = (p: Partial<Question>): Question => ({ id: 'q1', type: 'mcq', prompt: 'x', difficulty: 2, ...p } as Question);

describe('objective grading', () => {
  it('grades each objective type', () => {
    expect(gradeItem(q({ type: 'mcq', options: ['a', 'b'], answer: 1 }), 1).score).toBe(1);
    expect(gradeItem(q({ type: 'multi', options: ['a', 'b', 'c'], answer: [0, 2] }), [0, 2]).score).toBe(1);
    expect(gradeItem(q({ type: 'multi', options: ['a', 'b', 'c'], answer: [0, 2] }), [0]).score).toBeLessThan(1);
    expect(gradeItem(q({ type: 'tf', answer: false }), false).score).toBe(1);
    expect(gradeItem(q({ type: 'tf', answer: false, justify: true }), { value: false, why: 'x' }).gradedBy).toBe('pending');
    expect(gradeItem(q({ type: 'blank', answer: 'invoke_signed' }), 'Invoke_Signed ').score).toBe(1);
    expect(gradeItem(q({ type: 'numeric', answer: 255 }), '255').score).toBe(1);
    expect(gradeItem(q({ type: 'numeric', answer: 3.14, tolerance: 0.01 }), '3,141').score).toBe(1);
    expect(gradeItem(q({ type: 'order', options: ['a', 'b', 'c'], answer: [2, 0, 1] }), [2, 0, 1]).score).toBe(1);
    expect(gradeItem(q({ type: 'match', options: ['a', 'b'], matchRight: ['x', 'y'], answer: [1, 0] }), [1, 0]).score).toBe(1);
    expect(gradeItem(q({ type: 'short' }), 'anything').gradedBy).toBe('pending');
  });

  it('forgives small typos only on longer answers', () => {
    expect(fuzzyEqual('invoke_signd', 'invoke_signed')).toBe(true);
    expect(fuzzyEqual('cat', 'car')).toBe(false);
  });
});

describe('spaced repetition', () => {
  it('schedules new cards and moves the due date forward', () => {
    const card = { id: 'c', type: 'basic' as const, front: 'f', back: 'b', status: 'active' as const, created: new Date().toISOString() };
    expect(isDue(card)).toBe(true);
    const fsrs = schedule(card, 3);
    expect(new Date(fsrs.due).getTime()).toBeGreaterThan(Date.now());
    expect(fsrs.reps).toBe(1);
  });

  it('round-trips CSV with quotes and commas', () => {
    const csv = toCsv([{ id: '1', type: 'basic', front: 'a, "b"', back: 'c', status: 'active', created: '' }]);
    expect(parseCsv(csv)).toEqual([{ front: 'a, "b"', back: 'c' }]);
  });
});
