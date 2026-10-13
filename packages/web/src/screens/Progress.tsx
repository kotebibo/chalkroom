// Progress: knowledge map, dashboard, goal pace, lesson history with replay and notes.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LessonEvent, SyllabusTopic } from '@chalk/schema';
import { api, type LessonInfo } from '../api';
import { useStore } from '../store';
import { useData } from '../lib/hooks';
import { Player } from '../lib/player';
import { Board, usePlayer } from '../board/Board';
import { Markdown, renderMarkdown } from '../components/Markdown';
import { download } from '../board/exportBoard';

const DAY = 86400000;
const dayKey = (t: string | number) => new Date(t).toLocaleDateString('sv'); // local YYYY-MM-DD

export function Progress() {
  const app = useStore((s) => s.app);
  const { data: prog } = useData(() => api.progress());
  const { data: reviews } = useData(() => api.reviews());
  const { data: quizzes } = useData(() => api.quizzes());
  const [replay, setReplay] = useState<LessonInfo | null>(null);
  const [notes, setNotes] = useState<LessonInfo | null>(null);
  const topics = app?.syllabus.topics ?? [];
  const sessions = (prog?.sessions ?? []) as { t: string; minutes?: number; lesson?: string; outcome?: string }[];

  const stats = useMemo(() => {
    const minutes = sessions.reduce((a, s) => a + (Number(s.minutes) || 0), 0);
    const days = new Set([...sessions.map((s) => dayKey(s.t)), ...(reviews ?? []).map((r) => dayKey(r.t))]);
    // today counts if you studied; otherwise the streak may still be alive from yesterday
    let d = days.has(dayKey(Date.now())) ? Date.now() : Date.now() - DAY;
    let streak = 0;
    while (days.has(dayKey(d))) { streak++; d -= DAY; }
    const recent = (reviews ?? []).filter((r) => Date.now() - new Date(r.t).getTime() < 30 * DAY);
    const retention = recent.length ? recent.filter((r) => r.rating > 1).length / recent.length : null;
    return { minutes, streak, retention, reviews30: recent.length };
  }, [sessions, reviews]);

  const done = topics.filter((t) => t.status === 'done').length;
  const course = app?.course;

  return (
    <div className="page-scroll">
      <div className="page">
        <h1 style={{ fontSize: 24 }}>Progress</h1>
        <div className="grid-4">
          <Stat v={`${Math.round(stats.minutes / 6) / 10}h`} l="Study time" />
          <Stat v={String(stats.streak)} l={`Day streak`} />
          <Stat v={`${done}/${topics.length}`} l="Topics covered" />
          <Stat v={stats.retention === null ? '—' : `${Math.round(stats.retention * 100)}%`} l={`Card retention (${stats.reviews30} reviews, 30d)`} />
          <Stat v={String(app?.cards.due ?? 0)} l="Cards due" />
        </div>
        {course?.deadline && <GoalPace created={course.created} deadline={course.deadline} done={done} total={topics.length} sessions={sessions} />}
        <div className="card">
          <h2 className="section-title">Knowledge map</h2>
          {topics.length ? <KnowledgeMap topics={topics} mastery={app?.mastery ?? {}} /> : <div className="empty">No syllabus yet.</div>}
        </div>
        <div className="grid-2">
          <div className="card">
            <h2 className="section-title">Lessons</h2>
            <div className="list">
              {[...(app?.lessons ?? [])].reverse().map((l) => (
                <div key={l.id} className="list-item">
                  <div className="grow">
                    <div>{l.title}</div>
                    <div className="faint" style={{ fontSize: 12.5 }}>{l.started ? new Date(l.started).toLocaleDateString() : ''} · {l.mode ?? 'lecture'} · {l.ended ? 'finished' : 'open'}</div>
                  </div>
                  <button className="btn small" onClick={() => setReplay(l)} disabled={!l.events}>▶ Replay</button>
                  <button className="btn small" onClick={() => setNotes(l)}>Notes</button>
                </div>
              ))}
              {!app?.lessons.length && <div className="empty">No lessons yet.</div>}
            </div>
          </div>
          <div className="card">
            <h2 className="section-title">Quiz results</h2>
            {quizzes?.length ? <QuizTrend data={quizzes.filter((q) => q.best !== undefined).map((q) => ({ label: q.title, v: q.best! }))} /> : <div className="empty">No quizzes taken yet.</div>}
          </div>
        </div>
        <div className="grid-2">
          <div className="card">
            <h2 className="section-title">Misconceptions</h2>
            {prog?.misconceptions.length ? prog.misconceptions.slice().reverse().map((m, i) => (
              <div key={i} className="list-item" style={{ opacity: m.open ? 1 : 0.55 }}><span>{m.open ? '•' : '✓'}</span><span className="grow">{m.text}</span></div>
            )) : <div className="empty">None recorded.</div>}
          </div>
          <div className="card">
            <h2 className="section-title">Learner-model changes</h2>
            <div className="faint" style={{ fontSize: 12.5, marginBottom: 6 }}>Every change your tutor made, with its reason (progress/changes.jsonl).</div>
            <div className="scroll" style={{ maxHeight: 280 }}>
              {(prog?.changes ?? []).slice().reverse().map((c: any, i) => (
                <div key={i} className="list-item" style={{ fontSize: 13.5 }}>
                  <span className="faint" style={{ width: 70 }}>{new Date(c.t).toLocaleDateString()}</span>
                  <span className="grow"><b>{c.topicId}</b>{c.after !== undefined && <> {fmtPct(c.before)} → {fmtPct(c.after)}</>}{c.misconception && <> · misconception</>} — <span className="muted">{c.reason}</span></span>
                </div>
              ))}
              {!prog?.changes.length && <div className="empty">No changes yet.</div>}
            </div>
          </div>
        </div>
      </div>
      {replay && <ReplayModal lesson={replay} onClose={() => setReplay(null)} />}
      {notes && <NotesModal lesson={notes} onClose={() => setNotes(null)} />}
    </div>
  );
}

const fmtPct = (v?: number) => (v === undefined || v === null ? '—' : `${Math.round(v * 100)}%`);

function Stat({ v, l }: { v: string; l: string }) {
  return <div className="card stat"><div className="v">{v}</div><div className="l">{l}</div></div>;
}

function GoalPace({ created, deadline, done, total, sessions }: { created: string; deadline: string; done: number; total: number; sessions: { minutes?: number }[] }) {
  const start = new Date(created).getTime(), end = new Date(deadline).getTime();
  const elapsed = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
  const progress = total ? done / total : 0;
  const daysLeft = Math.max(1, Math.ceil((end - Date.now()) / DAY));
  const perTopic = sessions.length ? sessions.reduce((a, s) => a + (Number(s.minutes) || 0), 0) / Math.max(1, done) : 30;
  const minutesPerDay = Math.ceil(((total - done) * perTopic) / daysLeft);
  return (
    <div className="card col">
      <h2 className="section-title">Goal: {new Date(deadline).toLocaleDateString()}</h2>
      <div className="scorebar" title="Topics covered"><i style={{ width: `${progress * 100}%` }} /></div>
      <div className="scorebar" title="Time elapsed"><i style={{ width: `${elapsed * 100}%`, background: 'var(--text-3)' }} /></div>
      <div className="muted">{progress >= elapsed ? 'On pace.' : 'Behind pace.'} {daysLeft} days left — about <b>{minutesPerDay} min/day</b> to finish.</div>
    </div>
  );
}

function KnowledgeMap({ topics, mastery }: { topics: SyllabusTopic[]; mastery: Record<string, { score: number }> }) {
  const layout = useMemo(() => {
    const byId = new Map(topics.map((t) => [t.id, t]));
    const layer = new Map<string, number>();
    const depth = (id: string, seen = new Set<string>()): number => {
      if (layer.has(id)) return layer.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      const t = byId.get(id);
      const d = t ? Math.max(0, ...t.needs.filter((n) => byId.has(n)).map((n) => depth(n, seen) + 1)) : 0;
      layer.set(id, d);
      return d;
    };
    topics.forEach((t) => depth(t.id));
    const cols: string[][] = [];
    for (const t of topics) (cols[layer.get(t.id)!] ??= []).push(t.id);
    const W = 210, H = 62;
    const pos = new Map<string, { x: number; y: number }>();
    cols.forEach((ids, c) => ids.forEach((id, r) => pos.set(id, { x: 20 + c * W, y: 20 + r * H })));
    const width = 40 + cols.length * W, height = 40 + Math.max(...cols.map((c) => c.length)) * H;
    return { pos, width, height };
  }, [topics]);
  const color = (t: SyllabusTopic) => {
    const m = mastery[t.id]?.score;
    if (m === undefined) return t.status === 'done' ? 'var(--chalk-good)' : 'var(--line-2)';
    return `color-mix(in srgb, var(--chalk-good) ${Math.round(m * 100)}%, var(--chalk-bad))`;
  };
  return (
    <div className="scroll">
      <svg className="kmap" viewBox={`0 0 ${layout.width} ${layout.height}`} style={{ minWidth: Math.min(layout.width, 900) }} role="img" aria-label="Knowledge map">
        {topics.flatMap((t) => t.needs.filter((n) => layout.pos.has(n)).map((n) => {
          const a = layout.pos.get(n)!, b = layout.pos.get(t.id)!;
          const x1 = a.x + 180, y1 = a.y + 21, x2 = b.x, y2 = b.y + 21;
          return <path key={`${n}-${t.id}`} d={`M${x1},${y1} C${x1 + 20},${y1} ${x2 - 20},${y2} ${x2},${y2}`} fill="none" stroke="var(--line-2)" strokeWidth="1.5" />;
        }))}
        {topics.map((t) => {
          const p = layout.pos.get(t.id)!;
          const m = mastery[t.id]?.score;
          return (
            <g key={t.id} transform={`translate(${p.x},${p.y})`}>
              <title>{`${t.title} — ${t.status}${m !== undefined ? `, mastery ${Math.round(m * 100)}%` : ''}`}</title>
              <rect width="180" height="42" rx="9" fill="var(--panel-2)" stroke={color(t)} strokeWidth="2" />
              <rect x="0" y="38" width={180 * (m ?? 0)} height="4" rx="2" fill={color(t)} />
              <text x="10" y="25">{t.title.length > 24 ? t.title.slice(0, 23) + '…' : t.title}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function QuizTrend({ data }: { data: { label: string; v: number }[] }) {
  if (!data.length) return <div className="empty">No graded quizzes yet.</div>;
  const w = 36;
  return (
    <svg viewBox={`0 0 ${Math.max(300, data.length * w + 20)} 140`} style={{ width: '100%', height: 160 }} role="img" aria-label="Quiz scores">
      <line x1="10" y1="120" x2={data.length * w + 10} y2="120" stroke="var(--line-2)" />
      {data.map((d, i) => (
        <g key={i}>
          <title>{`${d.label}: ${Math.round(d.v * 100)}%`}</title>
          <rect x={16 + i * w} y={120 - d.v * 100} width={w - 12} height={d.v * 100} rx="3" fill={d.v >= 0.8 ? 'var(--chalk-good)' : d.v >= 0.5 ? 'var(--chalk-warn)' : 'var(--chalk-bad)'} />
          <text x={16 + i * w + (w - 12) / 2} y={134} textAnchor="middle" style={{ fontSize: 10, fill: 'var(--text-3)' }}>{i + 1}</text>
        </g>
      ))}
    </svg>
  );
}

function ReplayModal({ lesson, onClose }: { lesson: LessonInfo; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const muted = useStore((s) => s.muted);
  const [p] = useState(() => new Player());
  usePlayer(p);
  const [events, setEvents] = useState<LessonEvent[]>([]);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1.25);
  const run = useRef(0);

  useEffect(() => { api.events(lesson.id).then(setEvents); return () => { run.current++; p.reset(); }; }, [lesson.id]);
  useEffect(() => {
    p.speaker.settings = { provider: settings.ttsProvider, voice: settings.voice, rate: speed, muted, textOnly: settings.textOnly, lang: 'en' };
    p.pace = speed;
  }, [speed, muted, settings]);

  const chapters = useMemo(() => events.map((e, i) => ({ e, i })).filter(({ e }) => (e.kind === 'board_run' && (e.data as any)?.page) || e.kind === 'board_page' || e.kind === 'lesson_start')
    .map(({ e, i }) => ({ i, title: (e.data as any)?.page ?? (e.data as any)?.title ?? 'Start' })), [events]);

  const jump = (to: number, play: boolean) => {
    const id = ++run.current;
    p.reset();
    for (let i = 0; i < to; i++) p.push(events[i], false);
    setIdx(to);
    setPlaying(play);
    if (play) void loop(to, id);
  };

  const loop = async (from: number, id: number) => {
    for (let i = from; i < events.length; i++) {
      if (run.current !== id) return;
      p.push(events[i], true);
      setIdx(i + 1);
      while (p.busy && run.current === id) await new Promise((r) => setTimeout(r, 120));
    }
    if (run.current === id) setPlaying(false);
  };

  const transcript = events.filter((e) => e.kind === 'chat_say' || (e.source === 'user' && e.kind === 'question')).slice(-50);

  return (
    <div className="modal-back" role="dialog" aria-label={`Replay ${lesson.title}`}>
      <div className="modal" style={{ height: 'min(860px, 100%)' }}>
        <div className="modal-head">
          <b>Replay: {lesson.title}</b>
          <span className="spacer" />
          <select className="select" style={{ width: 'auto' }} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed">
            {[0.75, 1, 1.25, 1.5, 2, 3].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
          {playing ? <button className="btn" onClick={() => { run.current++; p.interrupt(); setPlaying(false); }}>⏸ Pause</button>
            : <button className="btn primary" disabled={!events.length} onClick={() => jump(idx >= events.length ? 0 : idx, true)}>▶ {idx ? 'Continue' : 'Play'}</button>}
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', minHeight: 0, flex: 1 }}>
          <div className="col" style={{ padding: 12, minHeight: 0 }}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex' }}><Board player={p} id="replay-board" emptyHint="Press Play" /></div>
            <div className="captions" style={{ borderRadius: 8 }}>{p.caption || <span className="faint">{idx}/{events.length} events</span>}</div>
            <input type="range" min={0} max={events.length} value={idx} onChange={(e) => jump(Number(e.target.value), false)} aria-label="Position" />
          </div>
          <div className="scroll" style={{ borderLeft: '1px solid var(--line)', padding: 10 }}>
            <h3 className="section-title">Chapters</h3>
            {chapters.map((c) => <button key={c.i} className="btn ghost small" style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => jump(c.i, true)}>{c.title}</button>)}
            <h3 className="section-title" style={{ marginTop: 14 }}>Chat</h3>
            {transcript.map((e) => <div key={e.seq} style={{ fontSize: 13, marginBottom: 8 }}>{e.source === 'user' ? <i>Q: {(e.data as any).text}</i> : <Markdown text={(e.data as any).markdown} />}</div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function NotesModal({ lesson, onClose }: { lesson: LessonInfo; onClose: () => void }) {
  const { data } = useData(() => api.notes(lesson.id), [lesson.id]);
  const { data: plan } = useData(() => api.notes(lesson.id, 'plan'), [lesson.id]);
  const md = data?.markdown ?? '';
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<!doctype html><title>${lesson.title}</title><style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;line-height:1.55;padding:0 16px}pre{background:#f4f4f4;padding:10px;overflow:auto}img{max-width:100%}</style>${[...document.querySelectorAll('style, link[rel=stylesheet]')].map((n) => n.outerHTML).join('')}${renderMarkdown(md)}`);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <div className="modal-back" role="dialog" aria-label={`Notes for ${lesson.title}`} onClick={onClose}>
      <div className="modal" style={{ width: 'min(820px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Notes: {lesson.title}</b><span className="spacer" />
          <button className="btn small" disabled={!md} onClick={() => download(`${lesson.id}-notes.md`, new Blob([md], { type: 'text/markdown' }))}>⤓ Markdown</button>
          <button className="btn small" disabled={!md} onClick={print}>Print / PDF</button>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="scroll" style={{ padding: 18 }}>
          {md ? <Markdown text={md} /> : <div className="empty">No notes yet. Your tutor writes lessons/{lesson.id}/notes.md when the lesson wraps up.</div>}
          {plan?.markdown && <details style={{ marginTop: 18 }}><summary className="faint">Lesson plan</summary><Markdown text={plan.markdown} /></details>}
        </div>
      </div>
    </div>
  );
}
