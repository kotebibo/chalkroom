import { describe, it, expect } from 'vitest';
import { parseSyllabus, applySyllabusOps, slugify } from '../src/index';

const MD = `# Solana

Intro paragraph stays.

- [x] Accounts model  <!-- id: accounts, mastery: 0.82 -->
- [~] Program Derived Addresses  <!-- id: pdas, lesson: 03-pdas, needs: accounts -->
  - [ ] Bumps  <!-- id: bumps, needs: pdas -->
- [ ] Cross-program invocation  <!-- id: cpi, needs: pdas -->
- [!] Rent
`;

describe('syllabus', () => {
  it('parses markers, ids, nesting and metadata', () => {
    const s = parseSyllabus(MD);
    expect(s.title).toBe('Solana');
    expect(s.topics.map((t) => [t.id, t.status, t.depth])).toEqual([
      ['accounts', 'done', 0], ['pdas', 'progress', 0], ['bumps', 'todo', 1], ['cpi', 'todo', 0], ['rent', 'review', 0],
    ]);
    expect(s.topics[0].mastery).toBe(0.82);
    expect(s.topics[1].lesson).toBe('03-pdas');
    expect(s.topics[2].needs).toEqual(['pdas']);
  });

  it('applies ops and keeps non-topic lines', () => {
    const out = applySyllabusOps(MD, [
      { op: 'status', id: 'cpi', status: 'progress' },
      { op: 'add', title: 'PDA signing', after: 'pdas' },
      { op: 'add', title: 'Seeds', parent: 'pdas' },
      { op: 'set', id: 'rent', needs: ['accounts'] },
    ]);
    expect(out).toContain('Intro paragraph stays.');
    const s = parseSyllabus(out);
    const ids = s.topics.map((t) => t.id);
    // added after pdas *and its children*
    expect(ids).toEqual(['accounts', 'pdas', 'bumps', 'seeds', 'pda-signing', 'cpi', 'rent']);
    expect(s.topics.find((t) => t.id === 'seeds')!.depth).toBe(1);
    expect(s.topics.find((t) => t.id === 'cpi')!.status).toBe('progress');
    expect(s.topics.find((t) => t.id === 'rent')!.needs).toEqual(['accounts']);
  });

  it('rejects unknown and duplicate ids', () => {
    expect(() => applySyllabusOps(MD, [{ op: 'status', id: 'nope', status: 'done' }])).toThrow(/unknown topic/);
    expect(() => applySyllabusOps(MD, [{ op: 'add', title: 'Rent' }])).toThrow(/exists/);
  });

  it('slugifies unicode titles', () => {
    expect(slugify('Program Derived Addresses!')).toBe('program-derived-addresses');
    expect(slugify('ლინეარული ალგებრა')).toBe('ლინეარული-ალგებრა');
  });
});
