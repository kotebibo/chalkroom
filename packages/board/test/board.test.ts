import { describe, it, expect } from 'vitest';
import { applyStep, applySteps, emptyBoard, describeBoard, splitSentences, arrowGeometry } from '../src/index';

describe('board reducer', () => {
  it('adds shapes at grid positions and nudges overlaps', () => {
    const { state, errors } = applySteps(emptyBoard(), [
      { add: { id: 'a', kind: 'box', text: 'A', at: [2, 2] } },
      { add: { id: 'b', kind: 'box', text: 'B', at: [2, 2] } },
    ]);
    expect(errors).toEqual([]);
    const { a, b } = state.pages[0].shapes;
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    expect(overlap).toBe(false);
  });

  it('removes attached arrows with their shapes', () => {
    let s = applySteps(emptyBoard(), [
      { add: { id: 'a', kind: 'box', text: 'A', at: [1, 1] } },
      { add: { id: 'b', kind: 'box', text: 'B', at: [6, 1] } },
      { add: { id: 'e', kind: 'arrow', from: 'a', to: 'b' } },
    ]).state;
    expect(arrowGeometry(s.pages[0], s.pages[0].shapes.e)).not.toBeNull();
    s = applyStep(s, { remove: 'b' }).state;
    expect(Object.keys(s.pages[0].shapes)).toEqual(['a']);
  });

  it('reports unknown ids as errors without throwing', () => {
    const r = applySteps(emptyBoard(), [{ highlight: 'ghost' }, { move: { id: 'ghost', to: [1, 1] } }]);
    expect(r.errors).toHaveLength(2);
  });

  it('renames an empty page instead of adding one', () => {
    let s = applyStep(emptyBoard(), { page: { title: 'Intro' } }).state;
    expect(s.pages.map((p) => p.title)).toEqual(['Intro']);
    s = applyStep(s, { add: { id: 'x', kind: 'text', text: 'hi' } }).state;
    s = applyStep(s, { page: { title: 'Next' } }).state;
    expect(s.pages.map((p) => p.title)).toEqual(['Intro', 'Next']);
    expect(s.current).toBe(1);
  });

  it('infers formula kind for write steps and describes the board', () => {
    const s = applyStep(emptyBoard(), { write: { id: 'f', latex: 'E=mc^2', at: [5.5, 3.5] } }).state;
    const d = describeBoard(s);
    expect(d.shapes[0]).toMatchObject({ id: 'f', kind: 'formula', latex: 'E=mc^2', at: [5.5, 3.5] });
  });

  it('splits narration into sentences, merging fragments', () => {
    expect(splitSentences('Hi. A PDA is derived from seeds and a program id. It has no private key at all!')).toEqual(['Hi. A PDA is derived from seeds and a program id.', 'It has no private key at all!']);
  });
});
