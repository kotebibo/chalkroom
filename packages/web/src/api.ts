// REST helpers for the Chalk server. Same origin, so no auth or CORS.
import type { Course, Syllabus, Quiz, Deck, LessonEvent, ResourceEntry, ConnectionState } from '@chalk/schema';

export interface LessonInfo { id: string; topic: string; title: string; mode?: string; started?: string; ended?: string; events: number; hasNotes: boolean }
export interface AppState {
  course: Course | null;
  syllabus: Syllabus;
  lessons: LessonInfo[];
  lesson: string | null;
  connection: ConnectionState;
  mock: boolean;
  dir: string;
  library: string;
  cards: { total: number; due: number; proposed: number };
  mastery: Record<string, { score: number; updatedAt: string }>;
  tts: { browser: boolean; openai: boolean; elevenlabs: boolean };
}
export interface QuizSummary { id: string; title: string; createdAt: string; questions: number; attempts: number; best?: number }
export interface Chunk { id: string; resourceId: string; page?: number; section?: string; text: string }
export interface SearchHit { chunkId: string; resourceId: string; page?: number; section?: string; score: number; snippet: string }
export interface LibraryCourse { id: string; dir: string; title: string; goal?: string; due: number; topics: number; done: number; current: boolean }

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`./api/${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `${r.status} ${r.statusText}`);
  return data as T;
}

export const api = {
  state: () => req<AppState>('GET', 'state'),
  lessons: () => req<LessonInfo[]>('GET', 'lessons'),
  events: (lesson: string) => req<LessonEvent[]>('GET', `lessons/${encodeURIComponent(lesson)}/events`),
  notes: (lesson: string, kind: 'notes' | 'plan' = 'notes') => req<{ markdown: string }>('GET', `lessons/${encodeURIComponent(lesson)}/${kind}`),
  quizzes: () => req<QuizSummary[]>('GET', 'quizzes'),
  quiz: (id: string) => req<Quiz>('GET', `quizzes/${encodeURIComponent(id)}`),
  submitAttempt: (id: string, body: { startedAt: string; answers: Record<string, unknown>; results: Record<string, unknown> }) =>
    req<{ attemptId: string; score: number; max: number; pending: number }>('POST', `quizzes/${encodeURIComponent(id)}/attempts`, body),
  deck: () => req<Deck>('GET', 'deck'),
  review: (cardId: string, fsrs: unknown, rating: number) => req('POST', 'deck/review', { cardId, fsrs, rating }),
  upsertCard: (card: Record<string, unknown>) => req('POST', 'deck/upsert', card),
  setCardStatus: (ids: string[], status: 'active' | 'suspended' | 'proposed' | 'deleted') => req('POST', 'deck/status', { ids, status }),
  reviews: () => req<{ t: string; cardId: string; rating: number }[]>('GET', 'reviews'),
  progress: () => req<{ mastery: { topics: Record<string, { score: number; updatedAt: string; history: { at: string; score: number; reason: string }[] }> }; misconceptions: { text: string; open: boolean }[]; sessions: Record<string, unknown>[]; changes: Record<string, unknown>[] }>('GET', 'progress'),
  resources: () => req<ResourceEntry[]>('GET', 'resources'),
  chunks: (id: string) => req<Chunk[]>('GET', `resources/${encodeURIComponent(id)}/chunks`),
  addUrl: (url: string, role?: string) => req<ResourceEntry>('POST', 'resources/url', { url, role }),
  setRole: (id: string, role: string) => req('POST', `resources/${encodeURIComponent(id)}/role`, { role }),
  deleteResource: (id: string) => req('POST', `resources/${encodeURIComponent(id)}/delete`, {}),
  search: (query: string, resourceId?: string) => req<SearchHit[]>('POST', 'resources/search', { query, resourceId }),
  async upload(file: File, role?: string): Promise<ResourceEntry> {
    const r = await fetch(`./api/resources/upload?name=${encodeURIComponent(file.name)}${role ? `&role=${role}` : ''}`, { method: 'POST', body: file });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? 'upload failed');
    return data;
  },
  library: () => req<LibraryCourse[]>('GET', 'library'),
  settings: () => req<{ settings: Record<string, unknown>; tts: AppState['tts'] }>('GET', 'settings'),
  saveSettings: (s: Record<string, unknown>) => req('PUT', 'settings', s),
  saveCourse: (patch: Partial<Course>) => req<Course>('PUT', 'course', patch),
  readFileText: async (path: string) => {
    if (path === '~learner.md') return (await req<{ markdown: string }>('GET', `file?path=${encodeURIComponent(path)}`)).markdown;
    const r = await fetch(`./api/file?path=${encodeURIComponent(path)}`);
    return r.ok ? r.text() : '';
  },
  writeFileText: (path: string, text: string) => req('PUT', `file?path=${encodeURIComponent(path)}`, { text }),
  exportBoard: (name: string, data: string) => req<{ path: string }>('POST', 'export', { name, data }),
  heartbeat: () => req('POST', 'heartbeat', {}),
  fileUrl: (path: string) => `./api/file?path=${encodeURIComponent(path)}`,
  resourceFileUrl: (id: string) => `./api/resources/${encodeURIComponent(id)}/file`,
};
