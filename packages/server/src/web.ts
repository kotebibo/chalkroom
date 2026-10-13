// Local web server: static UI, REST API over the course folder, WebSocket for live events.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream, existsSync, watch, type FSWatcher } from 'node:fs';
import { join, extname, resolve, relative, sep, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  Envelope, Card, QuizAttempt, type ClientMessage, type ServerMessage, now, shortId,
} from '@chalk/schema';
import { applyStep } from '@chalk/board';
import type { CourseStore } from './course.js';
import { attemptScore } from './course.js';
import type { TurnManager } from './turns.js';
import { synthesize, providerStatus } from './tts.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon', '.map': 'application/json',
};

export interface WebOptions {
  store: CourseStore;
  turns: TurnManager;
  webRoot: string;
  port: number;
  mock: boolean;
  log: (...a: unknown[]) => void;
}

export class WebServer {
  private clients = new Set<WebSocket>();
  private snapshotWaiters = new Map<string, { resolve: (png: string) => void; reject: (e: Error) => void }>();
  private watcher: FSWatcher | null = null;
  port = 0;
  private http = createServer((req, res) => this.handle(req, res).catch((e) => this.error(res, e)));
  private wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });

  constructor(private o: WebOptions) {}

  async listen(): Promise<number> {
    this.http.on('upgrade', (req, socket, head) => {
      if (!this.originOk(req) || !this.hostOk(req)) { socket.destroy(); return; }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onSocket(ws));
    });
    for (let port = this.o.port; port < this.o.port + 20; port++) {
      const ok = await new Promise<boolean>((res) => {
        const onErr = () => { this.http.off('listening', onOk); res(false); };
        const onOk = () => { this.http.off('error', onErr); res(true); };
        this.http.once('error', onErr);
        this.http.once('listening', onOk);
        this.http.listen(port, '127.0.0.1');
      });
      if (ok) { this.port = port; break; }
    }
    if (!this.port) throw new Error(`no free port in ${this.o.port}-${this.o.port + 19}`);
    this.watch();
    return this.port;
  }

  close() { this.watcher?.close(); this.wss.close(); this.http.close(); }

  broadcast(m: ServerMessage) {
    const data = JSON.stringify(m);
    for (const c of this.clients) if (c.readyState === 1) c.send(data);
  }

  get clientCount() { return this.clients.size; }

  requestSnapshot(shapeIds?: string[]): Promise<string> {
    const client = [...this.clients].find((c) => c.readyState === 1);
    if (!client) return Promise.reject(new Error('no browser connected'));
    const reqId = shortId('s');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.snapshotWaiters.delete(reqId); reject(new Error('browser did not answer')); }, 8000);
      this.snapshotWaiters.set(reqId, {
        resolve: (png) => { clearTimeout(timer); resolve(png); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      client.send(JSON.stringify({ type: 'snapshot_request', reqId, shapeIds } satisfies ServerMessage));
    });
  }

  // --- security: only our own origin on loopback --------------------------------

  private hostOk(req: IncomingMessage) {
    const host = (req.headers.host ?? '').toLowerCase();
    return host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
  }

  private originOk(req: IncomingMessage) {
    const origin = req.headers.origin;
    if (!origin) return true; // same-origin GETs and non-browser clients
    const allowed = [`http://127.0.0.1:${this.port}`, `http://localhost:${this.port}`];
    if (process.env.CHALK_DEV_ORIGIN) allowed.push(process.env.CHALK_DEV_ORIGIN);
    return allowed.includes(origin);
  }

  // --- websocket -------------------------------------------------------------------

  private async onSocket(ws: WebSocket) {
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      this.onClientMessage(msg).catch((e) => this.o.log('ws message failed', e));
    });
    const { store, turns } = this.o;
    ws.send(JSON.stringify({ type: 'hello', course: await store.course(), lesson: store.currentLesson, connection: turns.state, mock: this.o.mock } satisfies ServerMessage));
  }

  private async onClientMessage(msg: ClientMessage) {
    const { store, turns } = this.o;
    if (msg.type === 'envelope') {
      const env = Envelope.safeParse({ ...msg.envelope, lesson: msg.envelope.lesson ?? store.currentLesson ?? undefined });
      if (!env.success) return;
      if (turns.busy) env.data.interrupt = true;
      const ev = await store.log('user', env.data.type, env.data);
      this.broadcast({ type: 'event', lesson: store.currentLesson, event: ev });
      const how = await turns.submit(env.data);
      if (how === 'held') this.broadcast({ type: 'toast', level: 'info', text: 'Tutor is mid-turn; your input will be handed over at its next step.' });
    } else if (msg.type === 'user_event') {
      const ev = await store.log('user', msg.kind, msg.data);
      const d = msg.data as any;
      if (msg.kind === 'draw' && d?.shape) {
        store.board = applyStep(store.board, { add: { ...d.shape, user: true } }).state;
      } else if (msg.kind === 'erase' && d?.ids) {
        store.board = applyStep(store.board, { remove: d.ids }).state;
      }
      this.broadcast({ type: 'event', lesson: store.currentLesson, event: ev });
    } else if (msg.type === 'snapshot_result') {
      const w = this.snapshotWaiters.get(msg.reqId);
      if (!w) return;
      this.snapshotWaiters.delete(msg.reqId);
      if (msg.png) w.resolve(msg.png.replace(/^data:image\/png;base64,/, '')); else w.reject(new Error(msg.error ?? 'snapshot failed'));
    }
  }

  // --- file watcher ---------------------------------------------------------------------

  private watch() {
    const pending = new Set<string>();
    let timer: NodeJS.Timeout | null = null;
    try {
      this.watcher = watch(this.o.store.dir, { recursive: true }, (_ev, file) => {
        if (!file) return;
        const f = String(file).split(sep).join('/');
        if (f.endsWith('.tmp') || f.endsWith('events.jsonl') || f.startsWith('.git/') || f.includes('node_modules/')) return;
        pending.add(f);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { this.broadcast({ type: 'files', paths: [...pending] }); pending.clear(); }, 250);
      });
    } catch (e) {
      this.o.log('file watching unavailable:', (e as Error).message);
    }
  }

  // --- http -------------------------------------------------------------------------------

  private error(res: ServerResponse, e: unknown) {
    this.o.log('http error', e);
    if (!res.headersSent) this.json(res, { error: (e as Error).message ?? String(e) }, 500);
    else res.end();
  }

  private json(res: ServerResponse, data: unknown, status = 200) {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  private async body(req: IncomingMessage, limit = 2 * 1024 * 1024): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }

  private async jsonBody<T = any>(req: IncomingMessage): Promise<T> {
    const b = await this.body(req);
    return b.length ? JSON.parse(b.toString('utf8')) : ({} as T);
  }

  private async sendFile(res: ServerResponse, path: string, cache = false, req?: IncomingMessage) {
    const st = await stat(path).catch(() => null);
    if (!st?.isFile()) { this.json(res, { error: 'not found' }, 404); return; }
    const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
    const range = req?.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
      createReadStream(path, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes',
      'cache-control': cache ? 'public, max-age=31536000, immutable' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    createReadStream(path).pipe(res);
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (!this.hostOk(req)) { res.writeHead(421).end('bad host'); return; }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD' && !this.originOk(req)) { res.writeHead(403).end('bad origin'); return; }

    if (path.startsWith('/api/')) return this.api(req, res, method, path.slice(5), url);

    // static UI; unknown paths fall back to index.html (client routing)
    const root = this.o.webRoot;
    let file = resolve(root, '.' + decodeURIComponent(path));
    if (!file.startsWith(resolve(root)) || !existsSync(file) || (await stat(file)).isDirectory()) file = join(root, 'index.html');
    if (!existsSync(file)) { res.writeHead(500, { 'content-type': 'text/plain' }).end('Chalk UI is not built. Run: npm run build'); return; }
    return this.sendFile(res, file, path.startsWith('/assets/'));
  }

  private async api(req: IncomingMessage, res: ServerResponse, method: string, path: string, url: URL) {
    const { store, turns } = this.o;
    const seg = path.split('/').map(decodeURIComponent);
    const route = `${method} ${seg[0]}`;

    switch (route) {
      case 'GET state': {
        const [course, syllabus, lessons, deck, mastery] = await Promise.all([store.course(), store.syllabus(), store.lessons(), store.deck(), store.mastery()]);
        const nowD = new Date();
        return this.json(res, {
          course, syllabus, lessons, lesson: store.currentLesson, connection: turns.state, mock: this.o.mock, dir: store.dir, library: store.library,
          cards: { total: deck.cards.filter((c) => c.status === 'active').length, due: deck.cards.filter((c) => c.status === 'active' && (!c.fsrs || new Date(c.fsrs.due) <= nowD)).length, proposed: deck.cards.filter((c) => c.status === 'proposed').length },
          mastery: Object.fromEntries(Object.entries(mastery.topics).map(([k, v]) => [k, { score: v.score, updatedAt: v.updatedAt }])),
          tts: providerStatus(store.library),
        });
      }
      case 'GET lessons': {
        if (seg[1] && seg[2] === 'events') return this.json(res, await store.events(seg[1]));
        if (seg[1] && (seg[2] === 'notes' || seg[2] === 'plan')) {
          return this.json(res, { markdown: await store.readText(`lessons/${seg[1]}/${seg[2]}.md`).catch(() => '') });
        }
        return this.json(res, await store.lessons());
      }
      case 'GET quizzes': {
        if (seg[1]) { const q = await store.quiz(seg[1]); return q ? this.json(res, q) : this.json(res, { error: 'not found' }, 404); }
        return this.json(res, await store.quizzes());
      }
      case 'POST quizzes': {
        // POST quizzes/:id/attempts  {answers, results}
        const id = seg[1];
        const body = await this.jsonBody(req);
        const attempt = QuizAttempt.parse({ id: shortId('a'), startedAt: body.startedAt ?? now(), submittedAt: now(), answers: body.answers ?? {}, results: body.results ?? {} });
        const quiz = await store.updateQuiz(id, (q) => { q.attempts.push(attempt); });
        const pending = quiz.questions.filter((q) => attempt.results[q.id]?.gradedBy === 'pending');
        const { score, max } = attemptScore(attempt.results);
        await store.log('user', 'quiz_attempt', { quizId: id, attemptId: attempt.id, score, max, pending: pending.length });
        if (pending.length) {
          const env = {
            chalk: 1 as const, type: 'quiz_submit' as const, lesson: store.currentLesson ?? undefined,
            data: {
              quizId: id, attemptId: attempt.id, autoScore: `${score}/${max}`,
              toGrade: pending.map((q) => ({ questionId: q.id, type: q.type, prompt: q.prompt, rubric: q.rubric, expected: q.answer ?? q.explanation, answer: attempt.answers[q.id] })),
              wrong: quiz.questions.filter((q) => { const r = attempt.results[q.id]; return r && r.gradedBy === 'browser' && r.score < r.max; }).map((q) => ({ questionId: q.id, prompt: q.prompt, topic: q.topic })),
            },
          };
          await turns.submit(env);
        }
        return this.json(res, { attemptId: attempt.id, score, max, pending: pending.length });
      }
      case 'GET deck': return this.json(res, await store.deck());
      case 'POST deck': {
        const body = await this.jsonBody(req);
        const op = seg[1];
        const out = await store.updateDeck((d) => {
          if (op === 'review') {
            const c = d.cards.find((x) => x.id === body.cardId);
            if (!c) throw new Error('unknown card');
            c.fsrs = body.fsrs;
            return { ok: true };
          }
          if (op === 'upsert') {
            const card = Card.parse({ id: body.id ?? shortId('c'), created: now(), status: 'active', ...body });
            const i = d.cards.findIndex((x) => x.id === card.id);
            if (i >= 0) d.cards[i] = { ...d.cards[i], ...card }; else d.cards.push(card);
            return card;
          }
          if (op === 'status') {
            for (const id of body.ids as string[]) {
              const c = d.cards.find((x) => x.id === id);
              if (c) c.status = body.status;
            }
            if (body.status === 'deleted') d.cards = d.cards.filter((c) => !(body.ids as string[]).includes(c.id));
            return { ok: true };
          }
          throw new Error('unknown deck op');
        });
        if (op === 'review') {
          // append a review log line for stats (retention, streak)
          await mkdir(store.p('flashcards'), { recursive: true });
          await writeFile(store.p('flashcards', 'reviews.jsonl'), JSON.stringify({ t: now(), cardId: body.cardId, rating: body.rating }) + '\n', { flag: 'a' });
        }
        return this.json(res, out);
      }
      case 'GET reviews': {
        const text = await store.readText('flashcards/reviews.jsonl').catch(() => '');
        return this.json(res, text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
      }
      case 'GET progress': {
        const [mastery, misconceptions, sessions, changes] = await Promise.all([
          store.mastery(), store.misconceptions(), store.sessions(), store.readText('progress/changes.jsonl').catch(() => ''),
        ]);
        return this.json(res, { mastery, misconceptions, sessions, changes: changes.split('\n').filter(Boolean).slice(-100).map((l) => JSON.parse(l)) });
      }
      case 'GET resources': {
        const idx = await store.resources();
        if (!seg[1]) return this.json(res, idx.resources);
        const r = idx.resources.find((x) => x.id === seg[1]);
        if (!r) return this.json(res, { error: 'not found' }, 404);
        if (seg[2] === 'chunks') return this.json(res, await store.chunks(r.id));
        if (seg[2] === 'file') {
          if (/^https?:/.test(r.source)) { res.writeHead(302, { location: r.source }).end(); return; }
          return this.sendFile(res, store.safePath(r.source), false, req);
        }
        return this.json(res, r);
      }
      case 'POST resources': {
        if (seg[1] === 'upload') {
          const name = basename(url.searchParams.get('name') ?? 'upload.bin');
          const data = await this.body(req, 300 * 1024 * 1024);
          const tmpDir = store.p('resources', 'files');
          await mkdir(tmpDir, { recursive: true });
          let target = join(tmpDir, name.replace(/[^\w.-]+/g, '_'));
          for (let i = 2; existsSync(target); i++) target = join(tmpDir, name.replace(/(\.[^.]*)?$/, `-${i}$1`).replace(/[^\w.-]+/g, '_'));
          await writeFile(target, data);
          return this.json(res, await this.ingested(await store.addResourceFile(target, { role: (url.searchParams.get('role') as any) ?? undefined })));
        }
        if (seg[1] === 'url') {
          const body = await this.jsonBody(req);
          if (!/^https?:\/\//.test(body.url ?? '')) return this.json(res, { error: 'url must be http(s)' }, 400);
          return this.json(res, await this.ingested(await store.addResourceUrl(body.url, { role: body.role })));
        }
        if (seg[1] && seg[2] === 'role') {
          const body = await this.jsonBody(req);
          await store.updateResources((idx) => { const r = idx.resources.find((x) => x.id === seg[1]); if (r) r.role = body.role; });
          return this.json(res, { ok: true });
        }
        if (seg[1] && seg[2] === 'delete') { await store.removeResource(seg[1]); return this.json(res, { ok: true }); }
        if (seg[1] === 'search') {
          const body = await this.jsonBody(req);
          return this.json(res, store.kb.search(String(body.query ?? ''), 20, body.resourceId));
        }
        break;
      }
      case 'PUT course': {
        // learner-editable course settings; ids and dates stay as created
        const body = await this.jsonBody(req);
        const cur = await store.course();
        if (!cur) return this.json(res, { error: 'no course' }, 404);
        const next = { ...cur };
        for (const k of ['title', 'goal', 'level', 'language', 'deadline', 'resourcesOnly'] as const) if (k in body) (next as any)[k] = body[k];
        await writeFile(store.p('course.json'), JSON.stringify(next, null, 2) + '\n');
        return this.json(res, next);
      }
      case 'GET library': return this.json(res, await store.libraryCourses());
      case 'GET settings': return this.json(res, { settings: await store.settings(), tts: providerStatus(store.library) });
      case 'PUT settings': {
        const body = await this.jsonBody(req);
        await store.saveSettings(body);
        return this.json(res, { ok: true });
      }
      case 'GET file': {
        // course-relative read of Markdown/JSON/images for the UI (notes, plan, learner, assets)
        const rel = url.searchParams.get('path') ?? '';
        if (rel === '~learner.md') return this.json(res, { markdown: await store.learner() });
        return this.sendFile(res, store.safePath(rel), false, req);
      }
      case 'PUT file': {
        // the UI may edit Markdown it shows (notes, syllabus, learner profile) — never progress/
        const rel = url.searchParams.get('path') ?? '';
        const body = await this.jsonBody(req);
        if (rel === '~learner.md') { await writeFile(join(store.library, 'learner.md'), String(body.text ?? '')); return this.json(res, { ok: true }); }
        if (!/\.md$/.test(rel) || rel.startsWith('progress/')) return this.json(res, { error: 'not editable' }, 403);
        await writeFile(store.safePath(rel), String(body.text ?? ''));
        return this.json(res, { ok: true });
      }
      case 'POST tts': {
        const body = await this.jsonBody(req);
        const settings = await store.settings();
        const provider = String(body.provider ?? settings.ttsProvider ?? 'browser');
        const voice = body.voice ? String(body.voice) : undefined;
        const text = String(body.text ?? '').slice(0, 1200);
        const key = createHash('sha1').update(`${provider}|${voice}|${text}`).digest('hex').slice(0, 20);
        const dir = join(store.library, '.cache', 'tts');
        const file = join(dir, `${key}.mp3`);
        if (!existsSync(file)) {
          const audio = await synthesize(store.library, provider, text, voice, (await store.course())?.language);
          await mkdir(dir, { recursive: true });
          await writeFile(file, audio);
        }
        return this.sendFile(res, file, true);
      }
      case 'POST export': {
        // save a board export (SVG or PNG data URL) into the lesson's assets
        const body = await this.jsonBody(req);
        const lesson = store.currentLesson ?? body.lesson;
        if (!lesson) return this.json(res, { error: 'no lesson' }, 400);
        const name = String(body.name ?? 'board').replace(/[^\w.-]+/g, '_');
        const isPng = String(body.data).startsWith('data:image/png;base64,');
        const out = store.p('lessons', lesson, 'assets', `${name}.${isPng ? 'png' : 'svg'}`);
        await mkdir(join(out, '..'), { recursive: true });
        await writeFile(out, isPng ? Buffer.from(String(body.data).split(',')[1], 'base64') : String(body.data));
        return this.json(res, { ok: true, path: relative(store.dir, out).split(sep).join('/') });
      }
      case 'POST heartbeat': {
        await turns.heartbeat();
        return this.json(res, { ok: true });
      }
    }
    return this.json(res, { error: `no route ${method} /api/${path}` }, 404);
  }

  private async ingested(entry: Awaited<ReturnType<CourseStore['addResourceFile']>>) {
    const { store, turns } = this.o;
    await store.log('system', 'resource_added', { resourceId: entry.id });
    await turns.submit({
      chalk: 1, type: 'resource_added', lesson: store.currentLesson ?? undefined,
      data: { resourceId: entry.id, title: entry.title, type: entry.type, pages: entry.pages, chunks: entry.chunks, needsVision: !!(entry as any).needsVision, text: `resources/extracted/${entry.id}/text.md`, file: entry.source },
    });
    return entry;
  }
}
