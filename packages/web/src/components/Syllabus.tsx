// Syllabus sidebar: topics with status, mastery, and a start-lesson menu.
import { useState } from 'react';
import type { SyllabusTopic } from '@chalk/schema';
import { useStore } from '../store';

export const MODES = [
  { id: 'lecture', label: 'Lecture', hint: 'Board + voice, checks each segment' },
  { id: 'socratic', label: 'Socratic', hint: 'Guiding questions only' },
  { id: 'feynman', label: 'Feynman', hint: 'You explain, the tutor critiques' },
  { id: 'worked', label: 'Worked example', hint: 'Step-by-step, then one for you' },
  { id: 'practice', label: 'Practice', hint: 'Problems of rising difficulty' },
  { id: 'review', label: 'Review', hint: 'Fast recap of weak spots' },
  { id: 'exam', label: 'Exam prep', hint: 'Timed test, then targeted review' },
  { id: 'eli5', label: 'ELI5', hint: 'Simplest possible version' },
  { id: 'expert', label: 'Expert', hint: 'Go deep' },
];

export function StatusIcon({ status }: { status: SyllabusTopic['status'] }) {
  const c = { done: 'var(--chalk-good)', progress: 'var(--chalk-accent)', review: 'var(--chalk-warn)', todo: 'var(--text-3)' }[status];
  return (
    <svg className="status-icon" viewBox="0 0 16 16" aria-label={status}>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke={c} strokeWidth="1.6" />
      {status === 'done' && <path d="M5 8.2l2 2 4-4.4" stroke={c} strokeWidth="1.8" fill="none" strokeLinecap="round" />}
      {status === 'progress' && <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill={c} />}
      {status === 'review' && <path d="M8 4.6v4M8 10.8v.6" stroke={c} strokeWidth="1.8" strokeLinecap="round" />}
    </svg>
  );
}

export function SyllabusList() {
  const app = useStore((s) => s.app);
  const send = useStore((s) => s.send);
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState('lecture');
  const topics = app?.syllabus.topics ?? [];
  const currentTopic = app?.lessons.find((l) => l.id === app.lesson)?.topic;
  const mastery = app?.mastery ?? {};

  if (!topics.length) return <SyllabusSetup />;
  return (
    <ul className="syllabus" aria-label="Syllabus">
      {topics.map((t) => {
        const m = mastery[t.id]?.score ?? t.mastery;
        const blocked = t.needs.filter((n) => {
          const dep = topics.find((x) => x.id === n);
          return dep && dep.status !== 'done' && (mastery[n]?.score ?? 0) < 0.7;
        });
        return (
          <li key={t.id}>
            <button className={`topic ${t.id === currentTopic ? 'current' : ''}`} style={{ paddingLeft: 8 + t.depth * 14 }}
              aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
              <StatusIcon status={t.status} />
              <span className="t-title">{t.title}</span>
              {m !== undefined && <span className="t-mastery" title={`Mastery ${Math.round(m * 100)}%`}><i style={{ width: `${m * 100}%` }} /></span>}
            </button>
            {open === t.id && (
              <div className="topic-menu">
                {blocked.length > 0 && <div className="faint" style={{ fontSize: 12.5 }}>Builds on: {blocked.map((b) => topics.find((x) => x.id === b)?.title ?? b).join(', ')}</div>}
                <select className="select" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Teaching mode">
                  {MODES.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.hint}</option>)}
                </select>
                <button className="btn primary small" onClick={() => { send('start_lesson', { topic: t.id, mode }); setOpen(null); useStore.setState({ view: 'classroom' }); }}>
                  {t.lesson ? 'Continue lesson' : 'Start lesson'}
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SyllabusSetup() {
  const app = useStore((s) => s.app);
  const send = useStore((s) => s.send);
  const [goal, setGoal] = useState(app?.course?.goal ?? '');
  const [sent, setSent] = useState(false);
  return (
    <div className="col" style={{ padding: 8 }}>
      <div className="muted" style={{ fontSize: 14 }}>This course has no syllabus yet. Tell your tutor what you want to learn and what you already know.</div>
      <textarea className="textarea" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Learn linear algebra for ML in 6 weeks. I know calculus." />
      <button className="btn primary" disabled={!goal.trim() || sent} onClick={() => { send('draft_syllabus', { text: goal, data: { goal } }); setSent(true); }}>
        {sent ? 'Drafting…' : 'Draft syllabus'}
      </button>
      <div className="faint" style={{ fontSize: 12.5 }}>Tip: add a textbook or slides under Resources first, and the syllabus will follow them.</div>
    </div>
  );
}
