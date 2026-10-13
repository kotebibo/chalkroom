import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ServerMessage } from '@chalk/schema';
import { CourseStore } from '../src/course';
import { TurnManager } from '../src/turns';
import { callTool, toolList, type ToolContext } from '../src/tools';

const EXAMPLE = resolve(__dirname, '../../../examples/courses/solana-dev');

let dir: string, ctx: ToolContext, sent: ServerMessage[], turns: TurnManager;

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await callTool(name, args, ctx);
  const text = r.content.map((c) => ('text' in c ? c.text : '')).join('\n');
  return { r, text, json: (() => { try { return JSON.parse((r.content[0] as { text: string }).text); } catch { return null; } })() };
}

beforeEach(async () => {
  const lib = await mkdtemp(join(tmpdir(), 'chalk-test-'));
  dir = join(lib, 'courses', 'solana-dev');
  await cp(EXAMPLE, dir, { recursive: true });
  const store = new CourseStore(dir);
  await store.init();
  sent = [];
  turns = new TurnManager({ deliver: () => {}, onState: () => {} });
  ctx = { store, turns, broadcast: (m) => sent.push(m), requestSnapshot: () => Promise.reject(new Error('no browser')) };
});

afterEach(async () => {
  turns.dispose();
  await rm(join(dir, '..', '..'), { recursive: true, force: true });
});

describe('tool list', () => {
  it('exposes 23 tools with valid names and object schemas', () => {
    const tools = toolList();
    expect(tools).toHaveLength(23);
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.inputSchema.type).toBe('object');
    }
    // descriptions are a per-session context cost: keep the whole list small
    expect(JSON.stringify(tools).length).toBeLessThan(12000);
  });
});

describe('lesson flow', () => {
  it('starts, logs, resumes and ends a lesson', async () => {
    const start = await call('lesson_start', { topicId: 'pdas', mode: 'socratic' });
    expect(start.json).toMatchObject({ lessonId: '01-pdas', resumed: false });
    expect(await readFile(join(dir, 'syllabus.md'), 'utf8')).toMatch(/\[~\] Program Derived Addresses .*lesson: 01-pdas/);

    await call('board_run', { steps: [{ add: { id: 'a', kind: 'box', text: 'A', at: [1, 1] } }, { say: 'Hello.' }] });
    await call('speak', { text: 'One more thing.' });
    const again = await call('lesson_start', { topicId: 'pdas' });
    expect(again.json).toMatchObject({ lessonId: '01-pdas', resumed: true });
    expect(again.json.recap.lastNarration).toContain('One more thing.');
    expect((await call('board_state')).json.shapes[0]).toMatchObject({ id: 'a', kind: 'box' });

    await writeFile(join(dir, 'lessons/01-pdas/notes.md'), '# Notes');
    const end = await call('lesson_end', { summary: 'Covered PDAs', outcome: 'completed' });
    expect(end.json).toMatchObject({ ok: true, notes: 'saved' });
    expect(await readFile(join(dir, 'progress/sessions.jsonl'), 'utf8')).toContain('"lesson":"01-pdas"');
  });

  it('rejects invalid board steps with a per-step message', async () => {
    const r = await call('board_run', { steps: [{ add: { id: 'x', kind: 'blob' } }, { say: 'ok' }] });
    expect(r.r.isError).toBe(true);
    expect(r.text).toMatch(/step 0/);
  });

  it('attaches held learner input to the next tool result', async () => {
    await turns.submit({ chalk: 1, type: 'start_lesson', topic: 'pdas' });
    await turns.submit({ chalk: 1, type: 'question', text: 'Wait, why?' });
    const r = await call('speak', { text: 'Segment one.' });
    expect(r.text).toContain('"userInput"');
    expect(r.text).toContain('Wait, why?');
    const y = await call('lesson_yield', {});
    expect(y.json).toMatchObject({ ok: true, idle: true });
  });
});

describe('quizzes', () => {
  it('validates answer keys and grades free-text attempts', async () => {
    const bad = await call('quiz_create', { title: 'Q', questions: [{ type: 'mcq', prompt: 'x', options: ['a'], answer: 3 }] });
    expect(bad.r.isError).toBe(true);
    const ok = await call('quiz_create', {
      title: 'PDA quiz', topic: 'pdas',
      questions: [{ type: 'mcq', prompt: 'x', options: ['a', 'b'], answer: 1 }, { type: 'short', prompt: 'why?', rubric: 'no key' }],
    });
    const quizId = ok.json.quizId as string;
    expect(sent.some((m) => m.type === 'ui' && m.panel === 'quiz')).toBe(true);
    // the browser saves an attempt with the short answer pending
    await ctx.store.updateQuiz(quizId, (q) => {
      q.attempts.push({ id: 'a1', startedAt: '', answers: { q1: 1, q2: 'no key' }, results: { q1: { score: 1, max: 1, gradedBy: 'browser' }, q2: { score: 0, max: 1, gradedBy: 'pending' } } });
    });
    const g = await call('quiz_grade', { quizId, attemptId: 'a1', grades: [{ questionId: 'q2', score: 0.5, feedback: 'Say why.' }] });
    expect(g.json).toMatchObject({ score: 1.5, max: 2, percent: 75, stillPending: [] });
  });
});

describe('learner model and cards', () => {
  it('audits every progress change and mirrors mastery into the syllabus', async () => {
    await call('progress_update', { topicId: 'pdas', score: 0.6, reason: 'quiz' });
    await call('progress_update', { topicId: 'pdas', delta: 0.1, misconception: 'thinks PDAs have keys', reason: 'check' });
    const changes = (await readFile(join(dir, 'progress/changes.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(changes.map((c) => c.after)).toEqual([0.6, 0.7]);
    expect(await readFile(join(dir, 'syllabus.md'), 'utf8')).toMatch(/id: pdas.*mastery: 0\.70/);
    await call('progress_update', { topicId: 'pdas', corrected: 'thinks PDAs', reason: 'fixed' });
    expect(await readFile(join(dir, 'progress/misconceptions.md'), 'utf8')).toMatch(/- \[x\] .*thinks PDAs have keys \(corrected/);
    const p = await call('progress_get');
    expect(p.json.nextTopics).toContain('pdas');
    const nothing = await call('progress_update', { topicId: 'pdas', reason: 'x' });
    expect(nothing.r.isError).toBe(true);
  });

  it('proposes cards and rejects cloze-less cloze cards', async () => {
    const ok = await call('cards_propose', { cards: [{ front: 'Bump starts at {{c1::255}}' }, { front: 'Q', back: 'A' }] });
    expect(ok.json.proposed).toBe(2);
    const deck = await ctx.store.deck();
    expect(deck.cards.map((c) => [c.type, c.status])).toEqual([['cloze', 'proposed'], ['basic', 'proposed']]);
    const bad = await call('cards_add', { cards: [{ type: 'cloze', front: 'no cloze here' }] });
    expect(bad.r.isError).toBe(true);
  });
});

describe('resources', () => {
  it('extracts, indexes and searches a Markdown resource', async () => {
    const entry = await ctx.store.addResourceFile(join(dir, 'resources/files/pda-notes.md'), { role: 'primary' });
    expect(entry.chunks).toBeGreaterThan(0);
    const s = await call('kb_search', { query: 'canonical bump' });
    expect(s.json.results[0]).toMatchObject({ resourceId: entry.id });
    expect(s.json.results[0].cite).toBe(`[[res:${entry.id}]]`);
    const r = await call('kb_read', { chunkIds: [s.json.results[0].chunkId] });
    expect(r.json.chunks[0].text).toMatch(/canonical bump/);
    await call('kb_index', { resourceId: entry.id, summary: 'PDA notes', concepts: ['PDA', 'bump'] });
    expect((await ctx.store.resources()).resources[0]).toMatchObject({ summary: 'PDA notes', role: 'primary' });
  });
});
