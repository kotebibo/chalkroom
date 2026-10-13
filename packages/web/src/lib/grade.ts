// Objective grading runs in the browser; free text goes to Claude.
import type { Question, ItemResult } from '@chalk/schema';

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '');

/** Levenshtein distance, for forgiving typed answers. */
export function distance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

export function fuzzyEqual(given: string, expected: string) {
  const g = norm(given), e = norm(expected);
  if (!g) return false;
  if (g === e) return true;
  return e.length >= 5 && distance(g, e) <= Math.floor(e.length / 6);
}

export const isObjective = (q: Question) => ['mcq', 'multi', 'tf', 'blank', 'numeric', 'order', 'match'].includes(q.type);

/** Grade one answer. Free-text types come back as pending for Claude. */
export function gradeItem(q: Question, answer: unknown): ItemResult {
  const max = 1;
  const r = (score: number): ItemResult => ({ score, max, gradedBy: 'browser' });
  switch (q.type) {
    case 'mcq': return r(answer === q.answer ? 1 : 0);
    case 'multi': {
      const want = new Set((q.answer as number[]) ?? []);
      const got = new Set((answer as number[]) ?? []);
      const n = q.options?.length ?? 0;
      let right = 0;
      for (let i = 0; i < n; i++) if (want.has(i) === got.has(i)) right++;
      return r(n ? Math.round((right / n) ** 2 * 100) / 100 : 0);
    }
    case 'tf': {
      const a = answer as { value?: boolean; why?: string } | boolean | undefined;
      const value = typeof a === 'object' ? a?.value : a;
      if (value !== q.answer) return r(0);
      return q.justify ? { score: 0.5, max, gradedBy: 'pending' } : r(1);
    }
    case 'blank': {
      const accepted = [q.answer as string, ...(q.accept ?? [])].filter((x) => typeof x === 'string');
      return r(accepted.some((e) => fuzzyEqual(String(answer ?? ''), e)) ? 1 : 0);
    }
    case 'numeric': {
      const v = Number(String(answer ?? '').replace(',', '.'));
      const tol = q.tolerance ?? Math.abs(Number(q.answer)) * 1e-6;
      return r(Number.isFinite(v) && Math.abs(v - Number(q.answer)) <= tol ? 1 : 0);
    }
    case 'order': {
      const want = (q.answer as number[]) ?? [];
      const got = (answer as number[]) ?? [];
      let right = 0;
      want.forEach((x, i) => { if (got[i] === x) right++; });
      return r(want.length ? Math.round((right / want.length) * 100) / 100 : 0);
    }
    case 'match': {
      const want = (q.answer as number[]) ?? [];
      const got = (answer as number[]) ?? [];
      let right = 0;
      want.forEach((x, i) => { if (got[i] === x) right++; });
      return r(want.length ? Math.round((right / want.length) * 100) / 100 : 0);
    }
    default:
      return { score: 0, max, gradedBy: 'pending' };
  }
}

export function correctAnswerText(q: Question): string {
  const o = q.options ?? [];
  switch (q.type) {
    case 'mcq': return o[q.answer as number] ?? '';
    case 'multi': return ((q.answer as number[]) ?? []).map((i) => o[i]).join(', ');
    case 'tf': return q.answer ? 'True' : 'False';
    case 'order': return ((q.answer as number[]) ?? []).map((i) => o[i]).join(' → ');
    case 'match': return ((q.answer as number[]) ?? []).map((r, i) => `${o[i]} → ${q.matchRight?.[r]}`).join('; ');
    default: return String(q.answer ?? '');
  }
}
