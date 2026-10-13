// Shared formats for Chalk. Every file format and wire message is defined here
// once and used by the server, the web UI and the tests.
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Board Script
// ---------------------------------------------------------------------------

export const GridPos = z.tuple([z.number(), z.number()]).describe('[col, row] on the coarse board grid; fractions allowed');
export type GridPos = z.infer<typeof GridPos>;

export const ShapeStyle = z.enum(['default', 'accent', 'muted', 'good', 'warn', 'bad']);
export type ShapeStyle = z.infer<typeof ShapeStyle>;

export const ShapeKind = z.enum([
  'box', 'circle', 'arrow', 'text', 'sticky', 'formula', 'code',
  'image', 'table', 'chart', 'path', 'group', 'frame',
]);
export type ShapeKind = z.infer<typeof ShapeKind>;

export const ChartSpec = z.object({
  type: z.enum(['bar', 'line']),
  data: z.array(z.object({ x: z.union([z.string(), z.number()]), y: z.number() })),
  xLabel: z.string().optional(),
  yLabel: z.string().optional(),
});

export const Shape = z.object({
  id: z.string().min(1),
  kind: ShapeKind,
  text: z.string().optional(),
  at: GridPos.optional(),
  size: z.tuple([z.number(), z.number()]).optional().describe('[cols, rows]'),
  style: ShapeStyle.optional(),
  // arrow
  from: z.string().optional(),
  to: z.string().optional(),
  label: z.string().optional(),
  // formula / code
  latex: z.string().optional(),
  code: z.string().optional(),
  lang: z.string().optional(),
  // image: a course-relative path or a data: URL
  src: z.string().optional(),
  // table
  rows: z.array(z.array(z.string())).optional(),
  // chart
  chart: ChartSpec.optional(),
  // path: points in grid units
  points: z.array(GridPos).optional(),
  // group / frame
  children: z.array(z.string()).optional(),
  title: z.string().optional(),
  // citation, e.g. "res:strang#p142"
  source: z.string().optional(),
});
export type Shape = z.infer<typeof Shape>;

const Ids = z.union([z.string(), z.array(z.string())]);

export const BoardStep = z.union([
  z.object({ add: Shape }),
  z.object({ write: Shape.partial({ kind: true }) }).describe('add text or formula; kind defaults to formula when latex is set'),
  z.object({ update: Shape.partial().extend({ id: z.string() }) }),
  z.object({ remove: Ids }),
  z.object({ move: z.object({ id: z.string(), to: GridPos }) }),
  z.object({ highlight: Ids, for: z.number().optional() }),
  z.object({ underline: Ids }),
  z.object({ circle: Ids }),
  z.object({ pulse: Ids }),
  z.object({ fade: Ids }),
  z.object({ camera: z.object({ frame: z.string().optional(), at: GridPos.optional(), zoom: z.number().optional() }) }),
  z.object({ clear: z.literal(true) }),
  z.object({ page: z.object({ title: z.string().optional() }) }),
  z.object({ say: z.string() }),
  z.object({ wait: z.number() }),
  z.object({ mermaid: z.object({ id: z.string(), code: z.string(), at: GridPos.optional(), size: z.tuple([z.number(), z.number()]).optional() }) }),
]);
export type BoardStep = z.infer<typeof BoardStep>;

export const BoardScript = z.object({ steps: z.array(BoardStep).min(1) });
export type BoardScript = z.infer<typeof BoardScript>;

// ---------------------------------------------------------------------------
// Inbound envelopes (browser -> Claude, via channel)
// ---------------------------------------------------------------------------

export const EnvelopeType = z.enum([
  'start_lesson', 'next', 'repeat', 'slower', 'question', 'explain_selection',
  'check_answer', 'quiz_submit', 'feynman_submit', 'make_flashcards',
  'resource_added', 'review_due', 'ui_state', 'heartbeat', 'draft_syllabus', 'quiz_request',
]);
export type EnvelopeType = z.infer<typeof EnvelopeType>;

export const Envelope = z.object({
  chalk: z.literal(1),
  type: EnvelopeType,
  lesson: z.string().optional(),
  topic: z.string().optional(),
  mode: z.string().optional(),
  text: z.string().optional(),
  interrupt: z.boolean().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type Envelope = z.infer<typeof Envelope>;

// ---------------------------------------------------------------------------
// Lesson event log (events.jsonl)
// ---------------------------------------------------------------------------

export const LessonEvent = z.object({
  seq: z.number(),
  t: z.string(),
  source: z.enum(['tutor', 'user', 'system']),
  kind: z.string(), // tool name for tutor events; e.g. 'question', 'draw' for user events
  data: z.unknown(),
});
export type LessonEvent = z.infer<typeof LessonEvent>;

// ---------------------------------------------------------------------------
// Quizzes
// ---------------------------------------------------------------------------

export const QuestionType = z.enum([
  'mcq', 'multi', 'tf', 'blank', 'numeric', 'order', 'match',
  'short', 'code', 'diagram', 'explain',
]);
export type QuestionType = z.infer<typeof QuestionType>;

export const Question = z.object({
  id: z.string(),
  type: QuestionType,
  prompt: z.string(),
  options: z.array(z.string()).optional().describe('mcq/multi choices; order items (shuffled in UI); match left side'),
  matchRight: z.array(z.string()).optional().describe('match: right side, answer gives pairs'),
  answer: z.unknown().optional().describe('mcq: index; multi: index[]; tf: boolean; blank: string; numeric: number; order: correct order of option indexes; match: right index per left item'),
  accept: z.array(z.string()).optional().describe('blank: accepted variants'),
  tolerance: z.number().optional(),
  justify: z.boolean().optional().describe('tf: also ask for a justification graded by Claude'),
  rubric: z.string().optional(),
  explanation: z.string().optional(),
  difficulty: z.number().int().min(1).max(5).default(2),
  topic: z.string().optional(),
  source: z.string().optional(),
});
export type Question = z.infer<typeof Question>;

export const ItemResult = z.object({
  score: z.number(),
  max: z.number(),
  gradedBy: z.enum(['browser', 'claude', 'pending']),
  feedback: z.string().optional(),
  misconception: z.string().optional(),
});
export type ItemResult = z.infer<typeof ItemResult>;

export const QuizAttempt = z.object({
  id: z.string(),
  startedAt: z.string(),
  submittedAt: z.string().optional(),
  answers: z.record(z.string(), z.unknown()),
  results: z.record(z.string(), ItemResult),
});
export type QuizAttempt = z.infer<typeof QuizAttempt>;

export const Quiz = z.object({
  schema: z.literal(1),
  id: z.string(),
  title: z.string(),
  topic: z.string().optional(),
  kind: z.enum(['check', 'topic', 'unit', 'placement', 'review']).default('topic'),
  timed: z.number().optional().describe('minutes'),
  createdAt: z.string(),
  questions: z.array(Question).min(1),
  attempts: z.array(QuizAttempt).default([]),
});
export type Quiz = z.infer<typeof Quiz>;

// ---------------------------------------------------------------------------
// Flashcards
// ---------------------------------------------------------------------------

export const FsrsState = z.object({
  due: z.string(),
  stability: z.number(),
  difficulty: z.number(),
  elapsed_days: z.number().default(0),
  scheduled_days: z.number().default(0),
  learning_steps: z.number().default(0),
  reps: z.number(),
  lapses: z.number(),
  state: z.number().describe('0 new, 1 learning, 2 review, 3 relearning'),
  last_review: z.string().optional(),
});
export type FsrsState = z.infer<typeof FsrsState>;

export const Card = z.object({
  id: z.string(),
  type: z.enum(['basic', 'reverse', 'cloze']).default('basic'),
  front: z.string(),
  back: z.string().default(''),
  topic: z.string().optional(),
  source: z.string().optional(),
  status: z.enum(['proposed', 'active', 'suspended']).default('active'),
  created: z.string(),
  fsrs: FsrsState.optional(),
});
export type Card = z.infer<typeof Card>;

export const CardInput = Card.pick({ type: true, front: true, back: true, topic: true, source: true }).partial({ type: true, back: true });
export type CardInput = z.infer<typeof CardInput>;

export const Deck = z.object({ schema: z.literal(1), cards: z.array(Card) });
export type Deck = z.infer<typeof Deck>;

// ---------------------------------------------------------------------------
// Learner model
// ---------------------------------------------------------------------------

export const MasteryEntry = z.object({
  score: z.number().min(0).max(1),
  updatedAt: z.string(),
  history: z.array(z.object({ at: z.string(), score: z.number(), reason: z.string() })).default([]),
});
export const Mastery = z.object({ schema: z.literal(1), topics: z.record(z.string(), MasteryEntry) });
export type Mastery = z.infer<typeof Mastery>;

export const Course = z.object({
  schema: z.literal(1),
  id: z.string(),
  title: z.string(),
  goal: z.string().default(''),
  level: z.string().default('beginner'),
  language: z.string().default('en'),
  deadline: z.string().optional(),
  resourcesOnly: z.boolean().default(false),
  created: z.string(),
  version: z.number().default(1),
});
export type Course = z.infer<typeof Course>;

export const ResourceEntry = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  source: z.string().describe('course-relative path or URL'),
  role: z.enum(['primary', 'reference', 'exercise']).default('reference'),
  pages: z.number().optional(),
  chunks: z.number().default(0),
  summary: z.string().optional(),
  concepts: z.array(z.string()).default([]),
  addedAt: z.string(),
});
export type ResourceEntry = z.infer<typeof ResourceEntry>;

export const ResourceIndex = z.object({ schema: z.literal(1), resources: z.array(ResourceEntry) });
export type ResourceIndex = z.infer<typeof ResourceIndex>;

// ---------------------------------------------------------------------------
// Syllabus (Markdown checkbox convention)
// ---------------------------------------------------------------------------

export type TopicStatus = 'todo' | 'progress' | 'done' | 'review';
export interface SyllabusTopic {
  id: string;
  title: string;
  status: TopicStatus;
  depth: number;
  needs: string[];
  lesson?: string;
  mastery?: number;
  line: number;
}
export interface Syllabus { title: string; topics: SyllabusTopic[] }

const MARK: Record<string, TopicStatus> = { ' ': 'todo', '~': 'progress', x: 'done', X: 'done', '!': 'review' };
const MARK_OUT: Record<TopicStatus, string> = { todo: ' ', progress: '~', done: 'x', review: '!' };

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'item';
}

export function parseSyllabus(md: string): Syllabus {
  const lines = md.split(/\r?\n/);
  let title = '';
  const topics: SyllabusTopic[] = [];
  lines.forEach((line, i) => {
    const h = /^#\s+(.+)$/.exec(line);
    if (h && !title) { title = h[1].trim(); return; }
    const m = /^(\s*)[-*]\s+\[([ xX~!])\]\s+(.*?)\s*(?:<!--(.*?)-->)?\s*$/.exec(line);
    if (!m) return;
    const meta: Record<string, string> = {};
    for (const part of (m[4] ?? '').split(',')) {
      const kv = /^\s*([\w-]+)\s*:\s*(.*?)\s*$/.exec(part);
      if (kv) meta[kv[1]] = kv[2];
    }
    topics.push({
      id: meta.id || slugify(m[3]),
      title: m[3],
      status: MARK[m[2]],
      depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2),
      needs: meta.needs ? meta.needs.split(/[\s|;]+/).filter(Boolean) : [],
      lesson: meta.lesson,
      mastery: meta.mastery ? Number(meta.mastery) : undefined,
      line: i,
    });
  });
  return { title, topics };
}

export function formatTopicLine(t: Omit<SyllabusTopic, 'line'>): string {
  const meta = [`id: ${t.id}`];
  if (t.lesson) meta.push(`lesson: ${t.lesson}`);
  if (t.needs.length) meta.push(`needs: ${t.needs.join(' ')}`);
  if (t.mastery !== undefined) meta.push(`mastery: ${t.mastery.toFixed(2)}`);
  return `${'  '.repeat(t.depth)}- [${MARK_OUT[t.status]}] ${t.title}  <!-- ${meta.join(', ')} -->`;
}

export const SyllabusOp = z.union([
  z.object({ op: z.literal('status'), id: z.string(), status: z.enum(['todo', 'progress', 'done', 'review']) }),
  z.object({ op: z.literal('add'), title: z.string(), id: z.string().optional(), after: z.string().optional(), parent: z.string().optional(), needs: z.array(z.string()).optional() }),
  z.object({ op: z.literal('remove'), id: z.string() }),
  z.object({ op: z.literal('move'), id: z.string(), after: z.string() }),
  z.object({ op: z.literal('set'), id: z.string(), title: z.string().optional(), lesson: z.string().optional(), needs: z.array(z.string()).optional() }),
]);
export type SyllabusOp = z.infer<typeof SyllabusOp>;

/** Apply ops to syllabus markdown, preserving everything that is not a topic line. */
export function applySyllabusOps(md: string, ops: SyllabusOp[]): string {
  const lines = md.split(/\r?\n/);
  for (const op of ops) {
    const syl = parseSyllabus(lines.join('\n'));
    const find = (id: string) => {
      const t = syl.topics.find((x) => x.id === id);
      if (!t) throw new Error(`unknown topic id: ${id}`);
      return t;
    };
    if (op.op === 'status' || op.op === 'set') {
      const t = find(op.id);
      const next = { ...t, ...(op.op === 'status' ? { status: op.status } : {}),
        ...(op.op === 'set' ? { title: op.title ?? t.title, lesson: op.lesson ?? t.lesson, needs: op.needs ?? t.needs } : {}) };
      lines[t.line] = formatTopicLine(next);
    } else if (op.op === 'remove') {
      lines.splice(find(op.id).line, 1);
    } else if (op.op === 'move') {
      const t = find(op.id);
      const [line] = lines.splice(t.line, 1);
      const after = parseSyllabus(lines.join('\n')).topics.find((x) => x.id === op.after);
      if (!after) throw new Error(`unknown topic id: ${op.after}`);
      lines.splice(after.line + 1, 0, line);
    } else if (op.op === 'add') {
      const id = op.id ?? slugify(op.title);
      if (syl.topics.some((x) => x.id === id)) throw new Error(`topic id exists: ${id}`);
      const parent = op.parent ? find(op.parent) : undefined;
      const anchor = op.after ? find(op.after) : parent;
      const depth = parent ? parent.depth + 1 : anchor ? anchor.depth : 0;
      const line = formatTopicLine({ id, title: op.title, status: 'todo', depth, needs: op.needs ?? [] });
      if (anchor) {
        // insert after the anchor and its nested children
        let at = anchor.line + 1;
        const later = syl.topics.filter((x) => x.line > anchor.line);
        for (const x of later) { if (x.depth > anchor.depth) at = x.line + 1; else break; }
        lines.splice(at, 0, line);
      } else {
        let end = lines.length;
        while (end > 0 && lines[end - 1].trim() === '') end--;
        lines.splice(end, 0, line);
      }
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Wire protocol between Chalk server and browser
// ---------------------------------------------------------------------------

export type ConnectionState = 'connected' | 'thinking' | 'terminal' | 'disconnected' | 'checking';

export type ServerMessage =
  | { type: 'hello'; course: Course | null; lesson: string | null; connection: ConnectionState; mock: boolean }
  | { type: 'event'; lesson: string | null; event: LessonEvent }
  | { type: 'connection'; state: ConnectionState }
  | { type: 'files'; paths: string[] }
  | { type: 'lesson'; lesson: string | null; topic?: string; mode?: string }
  | { type: 'ui'; panel: string; args?: Record<string, unknown> }
  | { type: 'check'; checkId: string; question: Question }
  | { type: 'toast'; level: 'info' | 'warn' | 'error'; text: string }
  | { type: 'prompt'; text: string | null }
  | { type: 'delivered'; via: 'channel' | 'tool' | 'mock'; count: number }
  | { type: 'snapshot_request'; reqId: string; shapeIds?: string[] };

export type ClientMessage =
  | { type: 'envelope'; envelope: Envelope }
  | { type: 'user_event'; kind: string; data: unknown }
  | { type: 'snapshot_result'; reqId: string; png?: string; error?: string }
  | { type: 'ping' };

export const now = () => new Date().toISOString();
export const shortId = (prefix = '') => prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
