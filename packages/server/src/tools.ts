// The 23 Chalk MCP tools. Descriptions stay short; detail lives in the skills.
import { z } from 'zod';
import {
  BoardScript, Question, CardInput, SyllabusOp, Quiz, type Envelope, type ServerMessage, now, slugify, shortId,
} from '@chalk/schema';
import { applySteps, applyStep, describeBoard, splitSentences, type BoardState } from '@chalk/board';
import type { CourseStore } from './course.js';
import { decayedMastery, attemptScore } from './course.js';
import type { TurnManager } from './turns.js';

export interface ToolContext {
  store: CourseStore;
  turns: TurnManager;
  broadcast: (m: ServerMessage) => void;
  requestSnapshot: (shapeIds?: string[]) => Promise<string>; // base64 PNG
}

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult { content: Content[]; isError?: boolean }

interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  input: S;
  run: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown | ToolResult>;
}

const tool = <S extends z.ZodRawShape>(d: ToolDef<S>) => d as unknown as ToolDef;

class ToolError extends Error {}
const fail = (msg: string): never => { throw new ToolError(msg); };

function formatIssues(err: z.ZodError, prefix = ''): string {
  return err.issues.slice(0, 6).map((i) => `${prefix}${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/** Log a tutor event and broadcast it to the browser. */
async function emit(ctx: ToolContext, kind: string, data: unknown) {
  const ev = await ctx.store.log('tutor', kind, data);
  ctx.broadcast({ type: 'event', lesson: ctx.store.currentLesson, event: ev });
  return ev;
}

const Steps = z.array(z.record(z.string(), z.unknown()));

export const TOOLS: ToolDef[] = [
  // --- board -----------------------------------------------------------------
  tool({
    name: 'board_run',
    description: 'Play Board Script steps on the whiteboard (see chalk-board skill). Steps: add/write/update/remove/move/highlight/underline/circle/pulse/fade/camera/clear/page/say/wait/mermaid. Positions are [col,row] on a 12x8 grid. Returns immediately; the browser animates.',
    input: { steps: Steps.min(1), page: z.string().optional().describe('open a new page with this title first') },
    async run(args, ctx) {
      const parsed = BoardScript.safeParse({ steps: args.steps });
      if (!parsed.success) {
        // report per-step problems so Claude can fix just those steps
        const bad = args.steps.map((s, i) => [i, BoardScript.shape.steps.element.safeParse(s)] as const).filter(([, r]) => !r.success);
        fail(`Invalid Board Script. ${bad.slice(0, 5).map(([i, r]) => `step ${i} ${JSON.stringify(args.steps[i]).slice(0, 80)}: ${(r as any).error.issues[0]?.message ?? 'invalid'}`).join(' | ')}. See the chalk-board skill.`);
      }
      let board: BoardState = ctx.store.board;
      if (args.page) board = applyStep(board, { page: { title: args.page } }).state;
      const { state, errors } = applySteps(board, parsed.data!.steps);
      ctx.store.board = state;
      await emit(ctx, 'board_run', { steps: parsed.data!.steps, page: args.page });
      return { ok: true, renderedAt: now(), shapes: Object.keys(state.pages[state.current].shapes).length, ...(errors.length ? { warnings: errors } : {}) };
    },
  }),
  tool({
    name: 'board_clear',
    description: 'Clear the current whiteboard page.',
    input: {},
    async run(_a, ctx) {
      ctx.store.board = applyStep(ctx.store.board, { clear: true }).state;
      await emit(ctx, 'board_clear', {});
      return { ok: true };
    },
  }),
  tool({
    name: 'board_page',
    description: 'Start a new whiteboard page (previous pages stay in the page strip).',
    input: { title: z.string().optional() },
    async run(args, ctx) {
      ctx.store.board = applyStep(ctx.store.board, { page: { title: args.title } }).state;
      await emit(ctx, 'board_page', { title: args.title });
      return { ok: true, page: ctx.store.board.current };
    },
  }),
  tool({
    name: 'board_snapshot',
    description: 'Get a PNG image of the current page (or only some shapes), e.g. to see what the learner drew.',
    input: { shapeIds: z.array(z.string()).optional() },
    async run(args, ctx) {
      try {
        const png = await ctx.requestSnapshot(args.shapeIds);
        return { content: [{ type: 'image', data: png, mimeType: 'image/png' }, { type: 'text', text: JSON.stringify(describeBoard(ctx.store.board)) }] } satisfies ToolResult;
      } catch (e) {
        return { ok: false, note: `No snapshot (${(e as Error).message}). Board as JSON instead.`, board: describeBoard(ctx.store.board) };
      }
    },
  }),
  tool({
    name: 'board_state',
    description: 'Shapes on the current page as compact JSON (ids, kinds, grid positions, text). Includes shapes the learner drew (user: true).',
    input: {},
    async run(_a, ctx) { return describeBoard(ctx.store.board); },
  }),

  // --- voice + chat ---------------------------------------------------------------
  tool({
    name: 'speak',
    description: 'Narrate text aloud (queued after pending board steps). Use for spoken explanation; keep sentences short.',
    input: { text: z.string().min(1), voice: z.string().optional() },
    async run(args, ctx) {
      await emit(ctx, 'speak', { text: args.text, voice: args.voice });
      return { ok: true, sentences: splitSentences(args.text).length };
    },
  }),
  tool({
    name: 'chat_say',
    description: 'Post a Markdown message in the chat panel. Cite resources as [[res:<id>#p<page>]]. LaTeX with $...$.',
    input: { markdown: z.string().min(1) },
    async run(args, ctx) {
      await emit(ctx, 'chat_say', { markdown: args.markdown });
      return { ok: true };
    },
  }),

  // --- lesson -----------------------------------------------------------------------
  tool({
    name: 'lesson_start',
    description: 'Open (or resume) the lesson for a syllabus topic. Returns the lesson folder and, when resuming, a recap of where it stopped. Write plan.md in that folder next.',
    input: { topicId: z.string(), mode: z.string().optional().describe('lecture|socratic|feynman|worked|practice|review|exam|eli5|expert'), title: z.string().optional() },
    async run(args, ctx) {
      const { store } = ctx;
      const syl = await store.syllabus();
      const topic = syl.topics.find((t) => t.id === args.topicId);
      if (!topic && !args.title) fail(`Unknown topic id "${args.topicId}". Known: ${syl.topics.map((t) => t.id).join(', ') || '(none)'}. Pass title to start an ad-hoc lesson.`);
      const lessons = await store.lessons();
      const existing = topic?.lesson && lessons.find((l) => l.id === topic.lesson)
        || lessons.filter((l) => l.topic === args.topicId).at(-1);
      let lessonId: string, resumed = false, recap: unknown;
      if (existing && !existing.ended) {
        lessonId = existing.id;
        resumed = true;
        const events = await store.events(lessonId);
        recap = {
          lastNarration: events.filter((e) => e.kind === 'speak').slice(-3).map((e) => (e.data as any).text),
          lastChat: events.filter((e) => e.kind === 'chat_say').slice(-2).map((e) => (e.data as any).markdown),
          userQuestions: events.filter((e) => e.source === 'user' && e.kind === 'question').slice(-3).map((e) => (e.data as any).text),
          steps: events.length,
          hasPlan: await store.fileExists(`lessons/${lessonId}/plan.md`),
        };
      } else {
        lessonId = await store.createLesson(args.topicId);
      }
      await store.openLesson(lessonId);
      const title = args.title ?? topic?.title ?? args.topicId;
      await store.log('system', 'lesson_start', { topicId: args.topicId, mode: args.mode ?? 'lecture', title, resumed });
      if (topic) await store.updateSyllabus([{ op: 'status', id: topic.id, status: topic.status === 'done' ? 'done' : 'progress' }, { op: 'set', id: topic.id, lesson: lessonId }]);
      ctx.broadcast({ type: 'lesson', lesson: lessonId, topic: args.topicId, mode: args.mode });
      return {
        lessonId, folder: `lessons/${lessonId}`, resumed, recap,
        next: resumed ? 'Offer a 30-second recap, then continue from the plan.' : `Write lessons/${lessonId}/plan.md, then teach the first segment.`,
      };
    },
  }),
  tool({
    name: 'lesson_end',
    description: 'Close the current lesson after writing notes.md. Logs the session.',
    input: { summary: z.string(), outcome: z.enum(['completed', 'partial', 'abandoned']).default('completed'), topics: z.array(z.string()).optional() },
    async run(args, ctx) {
      const { store } = ctx;
      const id = store.currentLesson ?? fail('No lesson is open.');
      const events = await store.events(id);
      const lastStart = [...events].reverse().find((e) => e.kind === 'lesson_start');
      const startData = (lastStart?.data ?? {}) as Record<string, string>;
      const minutes = lastStart ? Math.round((Date.now() - new Date(lastStart.t).getTime()) / 60000) : 0;
      await store.log('system', 'lesson_end', { summary: args.summary, outcome: args.outcome });
      await store.logSession({ lesson: id, minutes, topics: args.topics ?? [startData.topicId].filter(Boolean), mode: startData.mode, outcome: args.outcome, summary: args.summary });
      ctx.broadcast({ type: 'lesson', lesson: id });
      ctx.broadcast({ type: 'toast', level: 'info', text: `Lesson finished (${minutes} min).` });
      return { ok: true, minutes, notes: (await store.fileExists(`lessons/${id}/notes.md`)) ? 'saved' : `missing: write lessons/${id}/notes.md` };
    },
  }),
  tool({
    name: 'lesson_yield',
    description: 'Call at the end of every turn. If the learner sent input meanwhile it is returned in userInput: handle it instead of ending the turn.',
    input: { prompt: z.string().optional().describe('short hint shown above the input box, e.g. "Ready for the next part?"') },
    async run(args, ctx) {
      ctx.broadcast({ type: 'prompt', text: args.prompt ?? null });
      const held = ctx.turns.yieldTurn();
      if (held.length) return { ok: true, userInput: held, note: 'The learner sent input. Handle it now; do not end your turn yet.' };
      return { ok: true, idle: true };
    },
  }),
  tool({
    name: 'lesson_ack',
    description: 'Reply to a Chalk heartbeat to confirm channel delivery.',
    input: {},
    async run(_a, ctx) {
      ctx.turns.ack();
      const course = await ctx.store.course();
      return { ok: true, course: course?.title, lesson: ctx.store.currentLesson, next: 'Call lesson_yield and wait for input.' };
    },
  }),

  // --- checks + quizzes -------------------------------------------------------------
  tool({
    name: 'check_ask',
    description: 'Show one inline check question on the board. Returns at once; the answer arrives later as a check_answer envelope.',
    input: { question: z.record(z.string(), z.unknown()).describe('{type: mcq|tf|blank|numeric|short, prompt, options?, answer?, explanation?}') },
    async run(args, ctx) {
      const q = Question.safeParse({ id: shortId('k'), ...args.question });
      if (!q.success) fail(`Invalid question: ${formatIssues(q.error)}`);
      const checkId = q.data!.id;
      await emit(ctx, 'check_ask', { checkId, question: q.data });
      ctx.broadcast({ type: 'check', checkId, question: q.data! });
      return { ok: true, checkId };
    },
  }),
  tool({
    name: 'quiz_create',
    description: 'Create a quiz the browser runs and auto-grades (objective items). See chalk-quiz skill for question JSON. Returns quizId.',
    input: {
      title: z.string(),
      questions: z.array(z.record(z.string(), z.unknown())).min(1),
      topic: z.string().optional(),
      kind: z.enum(['check', 'topic', 'unit', 'placement', 'review']).optional(),
      timed: z.number().optional().describe('time limit in minutes'),
    },
    async run(args, ctx) {
      const id = await ctx.store.newQuizId(args.topic ?? args.title);
      const parsed = Quiz.safeParse({
        schema: 1, id, title: args.title, topic: args.topic, kind: args.kind ?? 'topic', timed: args.timed, createdAt: now(),
        questions: args.questions.map((q, i) => ({ id: `q${i + 1}`, topic: args.topic, ...q })), attempts: [],
      });
      if (!parsed.success) fail(`Invalid quiz: ${formatIssues(parsed.error)}`);
      const problems = parsed.data!.questions.flatMap((q) => validateAnswerKey(q));
      if (problems.length) fail(`Answer key problems: ${problems.join('; ')}`);
      await ctx.store.saveQuiz(parsed.data!);
      await emit(ctx, 'quiz_create', { quizId: id, title: args.title });
      ctx.broadcast({ type: 'ui', panel: 'quiz', args: { quizId: id } });
      return { ok: true, quizId: id, path: `quizzes/${id}.json` };
    },
  }),
  tool({
    name: 'quiz_grade',
    description: 'Grade free-text items of a submitted quiz attempt. score is 0..1 of the item. Also call progress_update for weak topics.',
    input: {
      quizId: z.string(),
      attemptId: z.string(),
      grades: z.array(z.object({ questionId: z.string(), score: z.number().min(0).max(1), feedback: z.string(), misconception: z.string().optional() })),
    },
    async run(args, ctx) {
      const quiz = await ctx.store.updateQuiz(args.quizId, (q) => {
        const a = q.attempts.find((x) => x.id === args.attemptId) ?? fail(`Unknown attempt ${args.attemptId}`);
        for (const g of args.grades) {
          const r = a.results[g.questionId] ?? { score: 0, max: 1, gradedBy: 'pending' as const };
          a.results[g.questionId] = { ...r, score: round2(g.score * r.max), gradedBy: 'claude', feedback: g.feedback, misconception: g.misconception };
        }
      });
      const attempt = quiz.attempts.find((x) => x.id === args.attemptId)!;
      const { score, max } = attemptScore(attempt.results);
      const pending = Object.entries(attempt.results).filter(([, r]) => r.gradedBy === 'pending').map(([k]) => k);
      await emit(ctx, 'quiz_grade', { quizId: args.quizId, attemptId: args.attemptId, score, max });
      ctx.broadcast({ type: 'ui', panel: 'quiz', args: { quizId: args.quizId, attemptId: args.attemptId } });
      return { ok: true, score: round2(score), max, percent: max ? Math.round((score / max) * 100) : 0, stillPending: pending };
    },
  }),

  // --- flashcards ----------------------------------------------------------------------
  tool({
    name: 'cards_propose',
    description: 'Propose flashcards; the learner accepts/edits/drops each in the UI. Cloze: front "The {{c1::bump}} keeps the PDA off-curve". See chalk-cards skill.',
    input: { cards: z.array(z.record(z.string(), z.unknown())).min(1).max(40) },
    async run(args, ctx) {
      const cards = parseCards(args.cards);
      const added = await ctx.store.addCards(cards, 'proposed');
      await emit(ctx, 'cards_propose', { count: added.length });
      ctx.broadcast({ type: 'ui', panel: 'cards', args: { proposed: true } });
      return { ok: true, proposed: added.length };
    },
  }),
  tool({
    name: 'cards_add',
    description: 'Add flashcards directly (only when the learner already approved them).',
    input: { cards: z.array(z.record(z.string(), z.unknown())).min(1).max(100) },
    async run(args, ctx) {
      const added = await ctx.store.addCards(parseCards(args.cards), 'active');
      await emit(ctx, 'cards_add', { count: added.length });
      return { ok: true, added: added.length };
    },
  }),

  // --- knowledge base ---------------------------------------------------------------------
  tool({
    name: 'kb_search',
    description: 'Keyword (BM25) search over the course resources. Returns chunk ids, pages and snippets; then kb_read the chunks you need.',
    input: { query: z.string(), limit: z.number().int().min(1).max(30).optional(), resourceId: z.string().optional() },
    async run(args, ctx) {
      if (!ctx.store.kb.size) return { results: [], note: 'No resources indexed yet.' };
      const results = ctx.store.kb.search(args.query, args.limit ?? 8, args.resourceId);
      return { results: results.map((r) => ({ ...r, cite: cite(r.resourceId, r.page) })) };
    },
  }),
  tool({
    name: 'kb_read',
    description: 'Read resource chunks by id (from kb_search). Each comes with its citation tag.',
    input: { chunkIds: z.array(z.string()).min(1).max(12) },
    async run(args, ctx) {
      return {
        chunks: args.chunkIds.map((id) => {
          const c = ctx.store.kb.get(id);
          return c ? { chunkId: id, cite: cite(c.resourceId, c.page), section: c.section, text: c.text } : { chunkId: id, error: 'not found' };
        }),
      };
    },
  }),
  tool({
    name: 'kb_index',
    description: 'Save your summary and key concepts for a resource (after resource_added).',
    input: { resourceId: z.string(), summary: z.string(), concepts: z.array(z.string()), role: z.enum(['primary', 'reference', 'exercise']).optional() },
    async run(args, ctx) {
      const found = await ctx.store.updateResources((idx) => {
        const r = idx.resources.find((x) => x.id === args.resourceId);
        if (!r) return false;
        r.summary = args.summary;
        r.concepts = args.concepts;
        if (args.role) r.role = args.role;
        return true;
      });
      if (!found) fail(`Unknown resource ${args.resourceId}`);
      return { ok: true };
    },
  }),

  // --- syllabus + learner model ------------------------------------------------------------
  tool({
    name: 'syllabus_update',
    description: 'Edit syllabus.md topics. ops: {op:"status",id,status:todo|progress|done|review} | {op:"add",title,id?,after?,parent?,needs?} | {op:"remove",id} | {op:"move",id,after} | {op:"set",id,title?,lesson?,needs?}.',
    input: { ops: z.array(z.record(z.string(), z.unknown())).min(1) },
    async run(args, ctx) {
      const ops = z.array(SyllabusOp).safeParse(args.ops);
      if (!ops.success) fail(`Invalid ops: ${formatIssues(ops.error)}`);
      try {
        const syl = await ctx.store.updateSyllabus(ops.data!);
        return { ok: true, topics: syl.topics.map((t) => `${t.id}:${t.status}`) };
      } catch (e) { return fail((e as Error).message); }
    },
  }),
  tool({
    name: 'progress_update',
    description: 'The only way to change the learner model. Set or shift a topic\'s mastery (0..1) and/or log or resolve a misconception. Always give a reason.',
    input: {
      topicId: z.string(),
      delta: z.number().min(-1).max(1).optional(),
      score: z.number().min(0).max(1).optional(),
      misconception: z.string().optional().describe('what the learner got wrong'),
      corrected: z.string().optional().describe('text identifying an earlier misconception that is now fixed'),
      reason: z.string(),
    },
    async run(args, ctx) {
      if (args.delta === undefined && args.score === undefined && !args.misconception && !args.corrected) fail('Nothing to update: pass delta, score, misconception or corrected.');
      return { ok: true, ...(await ctx.store.updateProgress(args)) };
    },
  }),
  tool({
    name: 'progress_get',
    description: 'Learner model: mastery per topic (decayed), open misconceptions, due flashcards, recent sessions and suggested next topics.',
    input: { topicIds: z.array(z.string()).optional() },
    async run(args, ctx) {
      const { store } = ctx;
      const [m, syl, deck, mis, sessions] = await Promise.all([store.mastery(), store.syllabus(), store.deck(), store.misconceptions(), store.sessions()]);
      const score = (id: string) => { const e = m.topics[id]; return e ? round2(decayedMastery(e.score, e.updatedAt)) : 0; };
      const topics = syl.topics.filter((t) => !args.topicIds || args.topicIds.includes(t.id))
        .map((t) => ({ id: t.id, title: t.title, status: t.status, mastery: score(t.id), needs: t.needs }));
      const nextTopics = syl.topics
        .filter((t) => t.status !== 'done' && t.needs.every((n) => score(n) >= 0.7 || syl.topics.find((x) => x.id === n)?.status === 'done'))
        .slice(0, 3).map((t) => t.id);
      const nowD = new Date();
      const due = deck.cards.filter((c) => c.status === 'active' && (!c.fsrs || new Date(c.fsrs.due) <= nowD));
      return {
        topics, nextTopics,
        misconceptions: mis.filter((x) => x.open).map((x) => x.text).slice(-15),
        flashcards: { active: deck.cards.filter((c) => c.status === 'active').length, due: due.length, leeches: deck.cards.filter((c) => (c.fsrs?.lapses ?? 0) >= 6).map((c) => c.front).slice(0, 10) },
        recentSessions: sessions.slice(-5),
        learnerProfile: (await store.learner()).slice(0, 2000) || '(learner.md is empty)',
      };
    },
  }),
  tool({
    name: 'ui_show',
    description: 'Switch the learner\'s UI: panel = board|chat|quiz|cards|review|progress|resources|resource. args e.g. {quizId} or {resourceId,page}.',
    input: { panel: z.enum(['board', 'chat', 'quiz', 'cards', 'review', 'progress', 'resources', 'resource']), args: z.record(z.string(), z.unknown()).optional() },
    async run(args, ctx) {
      ctx.broadcast({ type: 'ui', panel: args.panel, args: args.args });
      return { ok: true };
    },
  }),
];

export const cite = (resourceId: string, page?: number) => `[[res:${resourceId}${page ? `#p${page}` : ''}]]`;
const round2 = (n: number) => Math.round(n * 100) / 100;

function parseCards(raw: Record<string, unknown>[]) {
  return raw.map((c, i) => {
    const r = CardInput.safeParse(c);
    if (!r.success) fail(`card ${i}: ${formatIssues(r.error)}`);
    const card = r.data!;
    if (card.type === 'cloze' || /\{\{c\d+::/.test(card.front)) {
      if (!/\{\{c\d+::.+?\}\}/.test(card.front)) fail(`card ${i}: cloze needs {{c1::...}} in front`);
      card.type = 'cloze';
    } else if (!card.back) fail(`card ${i}: back is required for ${card.type ?? 'basic'} cards`);
    return card;
  });
}

function validateAnswerKey(q: z.infer<typeof Question>): string[] {
  const p = (m: string) => [`${q.id}: ${m}`];
  const n = q.options?.length ?? 0;
  switch (q.type) {
    case 'mcq': return typeof q.answer === 'number' && q.answer >= 0 && q.answer < n ? [] : p('mcq needs options and answer = option index');
    case 'multi': return Array.isArray(q.answer) && q.answer.every((x) => typeof x === 'number' && x < n) ? [] : p('multi needs answer = array of option indexes');
    case 'tf': return typeof q.answer === 'boolean' ? [] : p('tf needs answer true/false');
    case 'blank': return typeof q.answer === 'string' || q.accept?.length ? [] : p('blank needs answer string');
    case 'numeric': return typeof q.answer === 'number' ? [] : p('numeric needs answer number');
    case 'order': return Array.isArray(q.answer) && q.answer.length === n ? [] : p('order needs options and answer = indexes in correct order');
    case 'match': return Array.isArray(q.answer) && q.answer.length === n && q.matchRight?.length ? [] : p('match needs options (left), matchRight and answer = right index per left item');
    default: return [];
  }
}

export function toolList() {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(z.object(t.input), { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, description: t.description, inputSchema: schema };
  });
}

/** Run a tool by name. Attaches held learner input (see TurnManager) to every result. */
export async function callTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true };
  // lesson_yield hands over held input itself
  const held: Envelope[] = name === 'lesson_yield' ? [] : ctx.turns.toolActivity();
  const parsed = z.object(t.input).safeParse(rawArgs ?? {});
  let result: ToolResult;
  if (!parsed.success) {
    result = { content: [{ type: 'text', text: `Invalid arguments for ${name}: ${formatIssues(parsed.error)}` }], isError: true };
  } else {
    try {
      const out = await t.run(parsed.data, ctx);
      result = isToolResult(out) ? out : { content: [{ type: 'text', text: JSON.stringify(out) }] };
    } catch (e) {
      const msg = e instanceof ToolError ? e.message : `Internal error: ${(e as Error).stack ?? e}`;
      result = { content: [{ type: 'text', text: msg }], isError: true };
    }
  }
  if (held.length) {
    result.content.push({
      type: 'text',
      text: JSON.stringify({ userInput: held, note: 'The learner sent this while you were working. Stop the current explanation now, handle it, then offer to resume.' }),
    });
  }
  return result;
}

const isToolResult = (x: unknown): x is ToolResult => !!x && typeof x === 'object' && Array.isArray((x as ToolResult).content);
