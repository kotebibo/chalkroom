// FSRS scheduling in the browser (ts-fsrs). Reviews never involve Claude.
import { fsrs, createEmptyCard, Rating, type Card as FCard, type Grade } from 'ts-fsrs';
import type { Card, FsrsState } from '@chalk/schema';

const f = fsrs({ enable_fuzz: true, request_retention: 0.9 });

export const RATINGS: { grade: Grade; label: string; key: string }[] = [
  { grade: Rating.Again, label: 'Again', key: '1' },
  { grade: Rating.Hard, label: 'Hard', key: '2' },
  { grade: Rating.Good, label: 'Good', key: '3' },
  { grade: Rating.Easy, label: 'Easy', key: '4' },
];

export const LEECH_LAPSES = 6;

function toF(c: Card): FCard {
  if (!c.fsrs) return createEmptyCard(new Date(c.created));
  const s = c.fsrs;
  return { ...s, due: new Date(s.due), last_review: s.last_review ? new Date(s.last_review) : undefined } as FCard;
}

function fromF(c: FCard): FsrsState {
  return {
    due: c.due.toISOString(), stability: c.stability, difficulty: c.difficulty, elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days, learning_steps: c.learning_steps, reps: c.reps, lapses: c.lapses, state: c.state,
    last_review: c.last_review?.toISOString(),
  };
}

export function isDue(c: Card, at = new Date()) {
  return c.status === 'active' && (!c.fsrs || new Date(c.fsrs.due) <= at);
}

export function schedule(c: Card, grade: Grade, at = new Date()): FsrsState {
  return fromF(f.next(toF(c), at, grade).card);
}

/** Human interval for each rating, shown on the buttons. */
export function previews(c: Card, at = new Date()): Record<number, string> {
  const rec = f.repeat(toF(c), at);
  const out: Record<number, string> = {};
  for (const r of RATINGS) out[r.grade] = humanize(rec[r.grade].card.due.getTime() - at.getTime());
  return out;
}

export function humanize(ms: number) {
  const m = ms / 60000;
  if (m < 1) return '<1m';
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 31) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${Math.round((d / 365) * 10) / 10}y`;
}

/** Render a cloze card: hide (front) or reveal (back) {{c1::answer::hint}} spans. */
export function cloze(text: string, reveal: boolean) {
  return text.replace(/\{\{c\d+::(.+?)(?:::(.+?))?\}\}/g, (_m, ans, hint) =>
    reveal ? `<span class="cloze">${ans}</span>` : `<span class="cloze">[${hint ?? '…'}]</span>`);
}

export function toCsv(cards: Card[]) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return ['front,back,topic,type,due', ...cards.map((c) => [c.front, c.back, c.topic ?? '', c.type, c.fsrs?.due ?? ''].map((x) => esc(String(x))).join(','))].join('\n');
}

export function parseCsv(text: string): { front: string; back: string; topic?: string }[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t' || ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const body = rows[0]?.[0]?.toLowerCase() === 'front' ? rows.slice(1) : rows;
  return body.filter((r) => r[0]?.trim()).map((r) => ({ front: r[0].trim(), back: (r[1] ?? '').trim(), topic: r[2]?.trim() || undefined }));
}
