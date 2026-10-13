// App state (Zustand) and the live connection to the Chalk server.
import { create } from 'zustand';
import type { ConnectionState, Envelope, EnvelopeType, LessonEvent, Question, ServerMessage, ClientMessage } from '@chalk/schema';
import { api, type AppState } from './api';
import { Player } from './lib/player';
import { snapshotPng } from './board/exportBoard';

export type View = 'home' | 'classroom' | 'review' | 'progress' | 'resources' | 'settings';
export type Side = 'chat' | 'quiz' | 'cards';

export interface Settings {
  theme: 'chalkboard' | 'whiteboard' | 'contrast';
  ttsProvider: 'browser' | 'openai' | 'elevenlabs';
  voice: string;
  speed: number;
  textOnly: boolean;
  showNarration: boolean;
  sttLang: string;
  [k: string]: unknown;
}

const DEFAULT_SETTINGS: Settings = { theme: 'chalkboard', ttsProvider: 'browser', voice: '', speed: 1, textOnly: false, showNarration: true, sttLang: '' };

export interface Toast { id: number; level: 'info' | 'warn' | 'error'; text: string }

interface Store {
  app: AppState | null;
  connection: ConnectionState;
  socketOpen: boolean;
  view: View;
  side: Side;
  quizId: string | null;
  resourceView: { id: string; page?: number; chunk?: string } | null;
  events: LessonEvent[];
  lesson: string | null;
  prompt: string | null;
  check: { checkId: string; question: Question } | null;
  toasts: Toast[];
  fileTick: number;
  settings: Settings;
  muted: boolean;
  audioUnlocked: boolean;
  lessonStartedAt: string | null;
  selection: string[];

  set: (p: Partial<Store>) => void;
  toast: (text: string, level?: Toast['level']) => void;
  refresh: () => Promise<void>;
  send: (type: EnvelopeType, fields?: Partial<Envelope>) => void;
  sendUserEvent: (kind: string, data: unknown) => void;
  saveSettings: (p: Partial<Settings>) => void;
}

export const player = new Player();

let socket: WebSocket | null = null;
const sendRaw = (m: ClientMessage) => { if (socket?.readyState === 1) socket.send(JSON.stringify(m)); };

const loadMuted = () => { try { return localStorage.getItem('chalk.muted') === '1'; } catch { return false; } };

export const useStore = create<Store>((set, get) => ({
  app: null,
  connection: 'checking',
  socketOpen: false,
  view: 'classroom',
  side: 'chat',
  quizId: null,
  resourceView: null,
  events: [],
  lesson: null,
  prompt: null,
  check: null,
  toasts: [],
  fileTick: 0,
  settings: DEFAULT_SETTINGS,
  muted: loadMuted(),
  audioUnlocked: false,
  lessonStartedAt: null,
  selection: [],

  set: (p) => set(p),

  toast: (text, level = 'info') => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, level, text }].slice(-4) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), level === 'error' ? 8000 : 4500);
  },

  refresh: async () => {
    try {
      const app = await api.state();
      set({ app, connection: app.connection });
    } catch (e) { console.warn('state refresh failed', e); }
  },

  send: (type, fields = {}) => {
    const s = get();
    const speaking = player.busy;
    const env: Envelope = {
      chalk: 1, type, lesson: s.lesson ?? undefined, ...fields,
      context: { ...(fields.context ?? {}), speaking, atStep: player.playedSeq, page: player.state.current, ...(s.selection.length ? { boardSelection: s.selection } : {}) },
    };
    // a question while the tutor is talking interrupts it locally right away
    if ((type === 'question' || type === 'explain_selection') && speaking) { player.interrupt(); env.interrupt = true; }
    sendRaw({ type: 'envelope', envelope: env });
  },

  sendUserEvent: (kind, data) => sendRaw({ type: 'user_event', kind, data }),

  saveSettings: (p) => {
    const settings = { ...get().settings, ...p };
    set({ settings });
    applySettings(settings, get().muted);
    void api.saveSettings(Object.fromEntries(Object.entries(settings).filter(([k]) => k !== 'muted'))).catch(() => {});
  },
}));

export function setMuted(muted: boolean) {
  useStore.setState({ muted });
  try { localStorage.setItem('chalk.muted', muted ? '1' : '0'); } catch { /* private mode */ }
  applySettings(useStore.getState().settings, muted);
  if (muted) player.speaker.stop();
}

export function applySettings(s: Settings, muted: boolean) {
  document.documentElement.dataset.theme = s.theme === 'chalkboard' ? '' : s.theme;
  if (s.theme === 'chalkboard') delete document.documentElement.dataset.theme;
  const lang = useStore.getState().app?.course?.language ?? 'en';
  player.speaker.settings = { provider: s.ttsProvider, voice: s.voice, rate: s.speed, muted, textOnly: s.textOnly, lang };
  player.pace = Math.max(0.6, Math.min(2, s.speed));
}

// ---------------------------------------------------------------------------
// Lesson feed: history + live events, without gaps or duplicates
// ---------------------------------------------------------------------------

let loading = false;
let buffered: { lesson: string | null; event: LessonEvent }[] = [];
let lastSeq = 0;

const CHAT_KINDS = new Set(['chat_say', 'speak', 'board_run', 'question', 'explain_selection', 'check_answer', 'feynman_submit', 'quiz_attempt', 'lesson_start', 'lesson_end', 'start_lesson', 'check_ask', 'quiz_create', 'cards_propose']);

async function loadLesson(lesson: string | null) {
  loading = true;
  buffered = [];
  player.reset();
  useStore.setState({ lesson, events: [], check: null, lessonStartedAt: null, selection: [] });
  if (lesson) {
    try {
      const events = await api.events(lesson);
      for (const ev of events) ingest(ev, false);
      lastSeq = events.at(-1)?.seq ?? 0;
      // restore an unanswered inline check
      const lastAsk = [...events].reverse().find((e) => e.kind === 'check_ask');
      if (lastAsk && !events.some((e) => e.seq > lastAsk.seq && e.kind === 'check_answer')) {
        const d = lastAsk.data as { checkId: string; question: Question };
        useStore.setState({ check: { checkId: d.checkId, question: d.question } });
      }
    } catch (e) { console.warn('could not load lesson', e); }
  } else lastSeq = 0;
  loading = false;
  const pending = buffered;
  buffered = [];
  for (const b of pending) if (b.lesson === lesson && b.event.seq > lastSeq) { ingest(b.event, true); lastSeq = b.event.seq; }
}

function ingest(ev: LessonEvent, live: boolean) {
  const s = useStore.getState();
  player.push(ev, live && s.audioUnlocked);
  if (ev.kind === 'lesson_start') useStore.setState({ lessonStartedAt: ev.t });
  if (CHAT_KINDS.has(ev.kind)) useStore.setState({ events: [...useStore.getState().events, ev] });
}

function onMessage(m: ServerMessage) {
  const st = useStore.getState();
  switch (m.type) {
    case 'hello':
      useStore.setState({ connection: m.connection });
      void st.refresh();
      void loadLesson(m.lesson);
      break;
    case 'connection':
      useStore.setState({ connection: m.state });
      break;
    case 'lesson':
      if (m.lesson !== st.lesson) void loadLesson(m.lesson);
      void st.refresh();
      if (m.lesson) useStore.setState({ view: 'classroom' });
      break;
    case 'event':
      if (loading) { buffered.push({ lesson: m.lesson, event: m.event }); break; }
      if (m.lesson !== st.lesson) break;
      if (m.lesson && m.event.seq <= lastSeq) break;
      lastSeq = Math.max(lastSeq, m.event.seq);
      ingest(m.event, true);
      if (m.event.kind === 'check_answer') useStore.setState({ check: null });
      break;
    case 'files':
      useStore.setState({ fileTick: st.fileTick + 1 });
      if (m.paths.some((p) => /^(syllabus\.md|course\.json|flashcards\/|progress\/|lessons\/[^/]+\/(notes|plan)\.md)/.test(p))) void st.refresh();
      break;
    case 'ui':
      if (m.panel === 'quiz') useStore.setState({ view: 'classroom', side: 'quiz', quizId: (m.args?.quizId as string) ?? st.quizId });
      else if (m.panel === 'cards') useStore.setState({ view: 'classroom', side: 'cards' });
      else if (m.panel === 'chat') useStore.setState({ view: 'classroom', side: 'chat' });
      else if (m.panel === 'board') useStore.setState({ view: 'classroom' });
      else if (m.panel === 'review' || m.panel === 'progress' || m.panel === 'resources') useStore.setState({ view: m.panel });
      else if (m.panel === 'resource') useStore.setState({ view: 'resources', resourceView: { id: String(m.args?.resourceId ?? ''), page: m.args?.page as number | undefined } });
      useStore.setState({ fileTick: useStore.getState().fileTick + 1 });
      break;
    case 'check':
      useStore.setState({ check: { checkId: m.checkId, question: m.question } });
      break;
    case 'prompt':
      useStore.setState({ prompt: m.text });
      break;
    case 'toast':
      st.toast(m.text, m.level);
      break;
    case 'delivered':
      break;
    case 'snapshot_request':
      snapshotPng(m.shapeIds)
        .then((png) => sendRaw({ type: 'snapshot_result', reqId: m.reqId, png }))
        .catch((e) => sendRaw({ type: 'snapshot_result', reqId: m.reqId, error: String(e?.message ?? e) }));
      break;
  }
}

let connected = false;
export function connect() {
  if (connected) return; // StrictMode runs effects twice in dev
  connected = true;
  let delay = 500;
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/ws`);
    socket.onopen = () => { delay = 500; useStore.setState({ socketOpen: true }); };
    socket.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    socket.onclose = () => {
      useStore.setState({ socketOpen: false, connection: 'disconnected' });
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 8000);
    };
  };
  open();
  api.settings().then(({ settings }) => {
    const s = { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings>) };
    if (typeof settings.speed !== 'number') s.speed = 1;
    useStore.setState({ settings: s });
    applySettings(s, useStore.getState().muted);
  }).catch(() => applySettings(DEFAULT_SETTINGS, useStore.getState().muted));
}

/** First click: browsers only allow speech after a user gesture. */
export function unlockAudio() {
  if ('speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }
  useStore.setState({ audioUnlocked: true });
}
