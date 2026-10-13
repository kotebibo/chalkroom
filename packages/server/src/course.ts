// The course folder: the only database Chalk has.
import { mkdir, readFile, writeFile, rename, appendFile, readdir, stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename, extname, resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import {
  Course, Deck, Mastery, Quiz, ResourceIndex, type ResourceEntry, type LessonEvent, type Card,
  parseSyllabus, applySyllabusOps, formatTopicLine, type SyllabusOp, now, slugify, shortId,
} from '@chalk/schema';
import { applySteps, emptyBoard, type BoardState, applyStep } from '@chalk/board';
import { KnowledgeBase, extractFile, fetchUrl, resourceType, type Chunk, type Extracted } from '@chalk/ingest';

export const MASTERY_HALF_LIFE_DAYS = 30;

export function libraryRoot(courseDir?: string): string {
  if (process.env.CHALK_HOME) return resolve(process.env.CHALK_HOME);
  // a course normally lives in <library>/courses/<id>
  if (courseDir && basename(dirname(courseDir)) === 'courses') return dirname(dirname(courseDir));
  return join(homedir(), 'chalkroom');
}

export const isCourseDir = (dir: string) => existsSync(join(dir, 'course.json'));

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
}

let tmpCounter = 0;
async function writeJsonFile(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${tmpCounter++}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await rename(tmp, path);
}

async function readText(path: string, fallback = ''): Promise<string> {
  try { return await readFile(path, 'utf8'); } catch { return fallback; }
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const text = await readText(path);
  const out: T[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a torn line */ }
  }
  return out;
}

export interface LessonInfo { id: string; topic: string; title: string; mode?: string; started?: string; ended?: string; events: number; hasNotes: boolean }

/** Serialises writes per file so concurrent tool calls never interleave. */
class Locks {
  private chains = new Map<string, Promise<unknown>>();
  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(key, next.catch(() => {}));
    return next;
  }
}

export class CourseStore {
  readonly dir: string;
  readonly library: string;
  readonly kb = new KnowledgeBase();
  currentLesson: string | null = null;
  board: BoardState = emptyBoard();
  private seq = 0;
  private locks = new Locks();
  pdfWorkerSrc?: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
    this.library = libraryRoot(this.dir);
  }

  p(...parts: string[]) { return join(this.dir, ...parts); }

  /** Resolve a course-relative path, refusing anything outside the course folder. */
  safePath(rel: string): string {
    const abs = resolve(this.dir, rel);
    const r = relative(this.dir, abs);
    if (r.startsWith('..') || resolve(r) === r) throw new Error('path outside course');
    return abs;
  }

  async init() {
    for (const d of ['lessons', 'quizzes', 'flashcards', 'progress', 'resources/files', 'resources/extracted']) {
      await mkdir(this.p(d), { recursive: true });
    }
    await this.loadKb();
    // reopen the most recent unfinished lesson so the board survives a restart
    const lessons = await this.lessons();
    const open = lessons.filter((l) => !l.ended).at(-1);
    if (open) await this.openLesson(open.id);
  }

  // --- course + syllabus --------------------------------------------------

  async course(): Promise<Course | null> {
    const raw = await readJsonFile<unknown>(this.p('course.json'), null);
    const r = Course.safeParse(raw);
    return r.success ? r.data : null;
  }

  async syllabusText() { return readText(this.p('syllabus.md'), '# Syllabus\n'); }
  async syllabus() { return parseSyllabus(await this.syllabusText()); }

  async updateSyllabus(ops: SyllabusOp[]) {
    return this.locks.run('syllabus', async () => {
      const md = applySyllabusOps(await this.syllabusText(), ops);
      await writeFile(this.p('syllabus.md'), md);
      return parseSyllabus(md);
    });
  }

  // --- lessons --------------------------------------------------------------

  async lessons(): Promise<LessonInfo[]> {
    let names: string[] = [];
    try { names = (await readdir(this.p('lessons'), { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith('_')).map((d) => d.name).sort(); } catch { /* none */ }
    const out: LessonInfo[] = [];
    for (const id of names) {
      const events = await this.events(id);
      const start = events.find((e) => e.kind === 'lesson_start');
      const end = [...events].reverse().find((e) => e.kind === 'lesson_end');
      const sd = (start?.data ?? {}) as Record<string, string>;
      out.push({
        id, topic: sd.topicId ?? id.replace(/^\d+-/, ''), title: sd.title ?? id, mode: sd.mode,
        started: start?.t, ended: end && end.seq > (([...events].reverse().find((e) => e.kind === 'lesson_start'))?.seq ?? 0) ? end.t : undefined,
        events: events.length, hasNotes: existsSync(this.p('lessons', id, 'notes.md')),
      });
    }
    return out;
  }

  async createLesson(topicId: string): Promise<string> {
    const existing = await this.lessons();
    const n = existing.reduce((m, l) => Math.max(m, parseInt(l.id, 10) || 0), 0) + 1;
    const id = `${String(n).padStart(2, '0')}-${slugify(topicId)}`;
    await mkdir(this.p('lessons', id, 'assets'), { recursive: true });
    return id;
  }

  async openLesson(id: string | null) {
    this.currentLesson = id;
    this.board = emptyBoard();
    this.seq = 0;
    if (!id) return;
    const events = await this.events(id);
    this.seq = events.at(-1)?.seq ?? 0;
    this.board = replayBoard(events);
  }

  async events(lessonId: string): Promise<LessonEvent[]> {
    return readJsonl<LessonEvent>(this.p('lessons', lessonId, 'events.jsonl'));
  }

  /** Append to the current lesson's log. Without a lesson, events go to a scratch log. */
  async log(source: LessonEvent['source'], kind: string, data: unknown): Promise<LessonEvent> {
    const ev: LessonEvent = { seq: ++this.seq, t: now(), source, kind, data };
    const file = this.currentLesson ? this.p('lessons', this.currentLesson, 'events.jsonl') : this.p('lessons', '_scratch', 'events.jsonl');
    await this.locks.run(file, async () => {
      await mkdir(dirname(file), { recursive: true });
      await appendFile(file, JSON.stringify(ev) + '\n');
    });
    return ev;
  }

  // --- quizzes ----------------------------------------------------------------

  async quizzes(): Promise<{ id: string; title: string; createdAt: string; questions: number; attempts: number; best?: number }[]> {
    let files: string[] = [];
    try { files = (await readdir(this.p('quizzes'))).filter((f) => f.endsWith('.json')).sort(); } catch { /* none */ }
    const out = [];
    for (const f of files) {
      const q = await this.quiz(f.replace(/\.json$/, ''));
      if (!q) continue;
      const scores = q.attempts.map((a) => attemptScore(a.results)).filter((s) => s.max > 0).map((s) => s.score / s.max);
      out.push({ id: q.id, title: q.title, createdAt: q.createdAt, questions: q.questions.length, attempts: q.attempts.length, best: scores.length ? Math.max(...scores) : undefined });
    }
    return out;
  }

  async quiz(id: string): Promise<Quiz | null> {
    if (!/^[\w.-]+$/.test(id)) return null;
    const r = Quiz.safeParse(await readJsonFile<unknown>(this.p('quizzes', `${id}.json`), null));
    return r.success ? r.data : null;
  }

  async saveQuiz(q: Quiz) {
    await writeJsonFile(this.p('quizzes', `${q.id}.json`), q);
  }

  async newQuizId(slug: string) {
    const base = `${now().slice(0, 10)}-${slugify(slug)}`;
    let id = base, i = 2;
    while (existsSync(this.p('quizzes', `${id}.json`))) id = `${base}-${i++}`;
    return id;
  }

  updateQuiz(id: string, fn: (q: Quiz) => Quiz | void) {
    return this.locks.run(`quiz:${id}`, async () => {
      const q = await this.quiz(id);
      if (!q) throw new Error(`unknown quiz: ${id}`);
      const next = fn(q) ?? q;
      await this.saveQuiz(next);
      return next;
    });
  }

  // --- flashcards ---------------------------------------------------------------

  async deck(): Promise<Deck> {
    const r = Deck.safeParse(await readJsonFile<unknown>(this.p('flashcards', 'deck.json'), { schema: 1, cards: [] }));
    return r.success ? r.data : { schema: 1, cards: [] };
  }

  updateDeck<T>(fn: (d: Deck) => T): Promise<T> {
    return this.locks.run('deck', async () => {
      const d = await this.deck();
      const out = fn(d);
      await writeJsonFile(this.p('flashcards', 'deck.json'), d);
      return out;
    });
  }

  async addCards(cards: Partial<Card>[], status: Card['status']) {
    return this.updateDeck((d) => {
      const added = cards.map((c) => ({
        id: shortId('c'), type: c.type ?? 'basic', front: c.front ?? '', back: c.back ?? '',
        topic: c.topic, source: c.source, status, created: now(),
      } as Card));
      d.cards.push(...added);
      return added;
    });
  }

  // --- learner model ------------------------------------------------------------

  async mastery(): Promise<Mastery> {
    const r = Mastery.safeParse(await readJsonFile<unknown>(this.p('progress', 'mastery.json'), { schema: 1, topics: {} }));
    return r.success ? r.data : { schema: 1, topics: {} };
  }

  /** The only writer of progress/. Every change is logged with a reason. */
  async updateProgress(input: { topicId: string; delta?: number; score?: number; misconception?: string; corrected?: string; reason: string }) {
    return this.locks.run('progress', async () => {
      const m = await this.mastery();
      const before = m.topics[input.topicId]?.score;
      let after = before;
      if (input.score !== undefined || input.delta !== undefined) {
        after = clamp01(input.score ?? (before ?? 0) + (input.delta ?? 0));
        const entry = m.topics[input.topicId] ?? { score: 0, updatedAt: now(), history: [] };
        entry.score = after;
        entry.updatedAt = now();
        entry.history = [...entry.history, { at: now(), score: after, reason: input.reason }].slice(-50);
        m.topics[input.topicId] = entry;
        await writeJsonFile(this.p('progress', 'mastery.json'), m);
        // mirror into the syllabus marker so humans see it too
        const syl = await this.syllabus();
        if (syl.topics.some((t) => t.id === input.topicId)) {
          await this.locks.run('syllabus', async () => {
            const md = await this.syllabusText();
            const lines = md.split(/\r?\n/);
            const t = parseSyllabus(md).topics.find((x) => x.id === input.topicId)!;
            lines[t.line] = formatTopicLine({ ...t, mastery: after });
            await writeFile(this.p('syllabus.md'), lines.join('\n'));
          });
        }
      }
      const date = now().slice(0, 10);
      if (input.misconception) {
        const file = this.p('progress', 'misconceptions.md');
        const head = existsSync(file) ? '' : '# Misconceptions\n\n';
        await appendFile(file, `${head}- [ ] ${date} · ${input.topicId}: ${input.misconception.replace(/\n/g, ' ')}\n`);
      }
      if (input.corrected) {
        const file = this.p('progress', 'misconceptions.md');
        const md = await readText(file);
        const needle = input.corrected.toLowerCase();
        const lines = md.split('\n');
        const i = lines.findIndex((l) => l.startsWith('- [ ]') && l.toLowerCase().includes(needle));
        if (i >= 0) { lines[i] = lines[i].replace('- [ ]', '- [x]') + ` (corrected ${date})`; await writeFile(file, lines.join('\n')); }
      }
      await appendFile(this.p('progress', 'changes.jsonl'), JSON.stringify({ t: now(), topicId: input.topicId, before, after, misconception: input.misconception, corrected: input.corrected, reason: input.reason }) + '\n');
      return { topicId: input.topicId, before, after };
    });
  }

  async misconceptions(): Promise<{ text: string; open: boolean }[]> {
    const md = await readText(this.p('progress', 'misconceptions.md'));
    return md.split('\n').filter((l) => /^- \[[ x]\]/.test(l)).map((l) => ({ text: l.slice(6), open: l.startsWith('- [ ]') }));
  }

  async logSession(entry: Record<string, unknown>) {
    await appendFile(this.p('progress', 'sessions.jsonl'), JSON.stringify({ t: now(), ...entry }) + '\n');
  }

  async sessions() { return readJsonl<Record<string, unknown>>(this.p('progress', 'sessions.jsonl')); }

  // --- resources --------------------------------------------------------------------

  async resources(): Promise<ResourceIndex> {
    const r = ResourceIndex.safeParse(await readJsonFile<unknown>(this.p('resources', 'index.json'), { schema: 1, resources: [] }));
    return r.success ? r.data : { schema: 1, resources: [] };
  }

  updateResources<T>(fn: (idx: ResourceIndex) => T): Promise<T> {
    return this.locks.run('resources', async () => {
      const idx = await this.resources();
      const out = fn(idx);
      await writeJsonFile(this.p('resources', 'index.json'), idx);
      return out;
    });
  }

  private async loadKb() {
    this.kb.clear();
    const idx = await this.resources();
    for (const r of idx.resources) this.kb.addAll(await this.chunks(r.id));
  }

  async chunks(resourceId: string): Promise<Chunk[]> {
    return readJsonFile<Chunk[]>(this.p('resources', 'extracted', resourceId, 'chunks.json'), []);
  }

  /** Copy (if needed), extract and index a file. Returns the new entry. */
  async addResourceFile(absPath: string, opts: { role?: ResourceEntry['role']; title?: string } = {}): Promise<ResourceEntry & { needsVision?: boolean }> {
    const filesDir = this.p('resources', 'files');
    let target = absPath;
    if (!resolve(absPath).startsWith(resolve(filesDir) + sep)) {
      target = join(filesDir, uniqueName(filesDir, basename(absPath)));
      await copyFile(absPath, target);
    }
    const rel = relative(this.dir, target).split(sep).join('/');
    const existing = (await this.resources()).resources.find((r) => r.source === rel);
    if (existing) return existing;
    const extracted = await extractFile(target, { pdfWorkerSrc: this.pdfWorkerSrc });
    return this.saveExtracted(rel, resourceType(target), extracted, opts);
  }

  async addResourceUrl(url: string, opts: { role?: ResourceEntry['role'] } = {}) {
    const existing = (await this.resources()).resources.find((r) => r.source === url);
    if (existing) return existing;
    const ex = await fetchUrl(url);
    await this.appendLink(url, ex.title);
    return this.saveExtracted(url, 'web', ex, { ...opts, title: ex.title ?? url });
  }

  private async appendLink(url: string, title?: string) {
    const file = this.p('resources', 'links.md');
    const head = existsSync(file) ? '' : '# Links\n\n';
    await appendFile(file, `${head}- [${title ?? url}](${url})\n`);
  }

  private async saveExtracted(source: string, type: string, ex: Extracted, opts: { role?: ResourceEntry['role']; title?: string }) {
    const title = opts.title ?? ex.title ?? basename(source, extname(source));
    const idx = await this.resources();
    let id = slugify(title).slice(0, 40);
    for (let i = 2; idx.resources.some((r) => r.id === id); i++) id = `${slugify(title).slice(0, 36)}-${i}`;
    const chunks: Chunk[] = ex.chunks.map((c, i) => ({ ...c, id: `${id}:${c.page ? `p${c.page}` : 's'}:${i}`, resourceId: id }));
    const outDir = this.p('resources', 'extracted', id);
    await mkdir(outDir, { recursive: true });
    await writeJsonFile(join(outDir, 'chunks.json'), chunks);
    // a readable copy for Claude's own file tools
    await writeFile(join(outDir, 'text.md'), chunks.map((c) => `<!-- ${c.id}${c.page ? ` page ${c.page}` : ''} -->\n${c.text}`).join('\n\n'));
    const entry: ResourceEntry = { id, type, title, source, role: opts.role ?? 'reference', pages: ex.pages, chunks: chunks.length, concepts: [], addedAt: now() };
    await this.updateResources((r) => { r.resources.push(entry); });
    this.kb.addAll(chunks);
    return { ...entry, needsVision: ex.needsVision };
  }

  async removeResource(id: string) {
    await this.updateResources((r) => { r.resources = r.resources.filter((x) => x.id !== id); });
    this.kb.removeResource(id);
  }

  // --- library ------------------------------------------------------------------------

  async libraryCourses() {
    const dir = join(this.library, 'courses');
    let names: string[] = [];
    try { names = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* none */ }
    const out = [];
    for (const n of names) {
      const c = await readJsonFile<Record<string, unknown> | null>(join(dir, n, 'course.json'), null);
      if (!c) continue;
      const d = await readJsonFile<Deck>(join(dir, n, 'flashcards', 'deck.json'), { schema: 1, cards: [] });
      const due = d.cards.filter((x) => x.status === 'active' && (!x.fsrs || new Date(x.fsrs.due) <= new Date())).length;
      const syl = parseSyllabus(await readText(join(dir, n, 'syllabus.md')));
      out.push({ id: n, dir: join(dir, n), title: c.title, goal: c.goal, due, topics: syl.topics.length, done: syl.topics.filter((t) => t.status === 'done').length, current: resolve(join(dir, n)) === this.dir });
    }
    return out;
  }

  async learner() { return readText(join(this.library, 'learner.md')); }
  async settings() { return readJsonFile<Record<string, unknown>>(join(this.library, 'settings.json'), {}); }
  async saveSettings(s: Record<string, unknown>) { await writeJsonFile(join(this.library, 'settings.json'), s); }

  readText(rel: string) { return readText(this.safePath(rel)); }
  async fileExists(rel: string) { try { await stat(this.safePath(rel)); return true; } catch { return false; } }
}

export function replayBoard(events: LessonEvent[]): BoardState {
  let board = emptyBoard();
  for (const e of events) {
    const d = e.data as any;
    if (e.kind === 'board_run' && Array.isArray(d?.steps)) {
      if (d.page) board = applyStep(board, { page: { title: d.page } }).state;
      board = applySteps(board, d.steps).state;
    } else if (e.kind === 'board_clear') board = applyStep(board, { clear: true }).state;
    else if (e.kind === 'board_page') board = applyStep(board, { page: { title: d?.title } }).state;
    else if (e.kind === 'draw' && d?.shape) board = applyStep(board, { add: { ...d.shape, user: true } as any }).state;
    else if (e.kind === 'erase' && d?.ids) board = applyStep(board, { remove: d.ids }).state;
  }
  return board;
}

export function attemptScore(results: Record<string, { score: number; max: number }>) {
  let score = 0, max = 0;
  for (const r of Object.values(results)) { score += r.score; max += r.max; }
  return { score, max };
}

function uniqueName(dir: string, name: string) {
  const ext = extname(name), base = basename(name, ext).replace(/[^\w.-]+/g, '_');
  let n = `${base}${ext}`;
  for (let i = 2; existsSync(join(dir, n)); i++) n = `${base}-${i}${ext}`;
  return n;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, Math.round(n * 1000) / 1000));

/** Mastery shown to planners decays toward half its stored value without review (half-life 30 days). */
export function decayedMastery(score: number, updatedAt: string, at = Date.now()) {
  const days = Math.max(0, (at - new Date(updatedAt).getTime()) / 86400000);
  return score * (0.5 + 0.5 * Math.pow(0.5, days / MASTERY_HALF_LIFE_DAYS));
}
