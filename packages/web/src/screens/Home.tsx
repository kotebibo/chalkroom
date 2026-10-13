// Home: today's review, suggested next lesson, and the course library.
import { useStore } from '../store';
import { api } from '../api';
import { useData } from '../lib/hooks';
import { StatusIcon } from '../components/Syllabus';

export function Home() {
  const app = useStore((s) => s.app);
  const send = useStore((s) => s.send);
  const { data: library } = useData(() => api.library());
  const topics = app?.syllabus.topics ?? [];
  const mastery = app?.mastery ?? {};
  const ready = (id: string) => (mastery[id]?.score ?? 0) >= 0.7 || topics.find((t) => t.id === id)?.status === 'done';
  const next = topics.find((t) => t.status === 'progress') ?? topics.find((t) => t.status !== 'done' && t.needs.every(ready));
  const review = topics.filter((t) => t.status === 'review');
  const due = app?.cards.due ?? 0;

  return (
    <div className="page-scroll">
      <div className="page">
        <h1 style={{ fontFamily: 'var(--font-hand)', fontSize: 38 }}>Today</h1>
        <div className="grid-2">
          <div className="card col">
            <h2 className="section-title">Review</h2>
            <div style={{ fontSize: 30, fontWeight: 700 }}>{due} <span className="muted" style={{ fontSize: 15, fontWeight: 400 }}>cards due</span></div>
            <div className="row">
              <button className="btn primary" disabled={!due} onClick={() => useStore.setState({ view: 'review' })}>Start review</button>
              <button className="btn" onClick={() => { send('review_due', { text: 'Run a short review session on my weak topics.' }); useStore.setState({ view: 'classroom' }); }}>Tutor review of weak topics</button>
            </div>
          </div>
          <div className="card col">
            <h2 className="section-title">Next lesson</h2>
            {next ? (
              <>
                <div className="row"><StatusIcon status={next.status} /><b style={{ fontSize: 18 }}>{next.title}</b></div>
                <div className="row">
                  <button className="btn primary" onClick={() => { send('start_lesson', { topic: next.id, mode: 'lecture' }); useStore.setState({ view: 'classroom' }); }}>{next.lesson ? 'Continue' : 'Start'}</button>
                  {review.length > 0 && <span className="muted">{review.length} topic{review.length > 1 ? 's' : ''} marked for review</span>}
                </div>
              </>
            ) : topics.length ? <div className="muted">Every topic is covered. Try a unit test from the Quiz tab.</div>
              : <div className="row"><span className="muted">No syllabus yet.</span><button className="btn" onClick={() => useStore.setState({ view: 'classroom' })}>Set one up</button></div>}
          </div>
        </div>
        <div className="card">
          <h2 className="section-title">Library</h2>
          <div className="list">
            {(library ?? []).map((c) => (
              <div key={c.id} className="list-item">
                <div className="grow">
                  <b>{c.title}</b>{c.current && <span className="chip" style={{ marginLeft: 8 }}>open</span>}
                  <div className="faint" style={{ fontSize: 13 }}>{c.done}/{c.topics} topics · {c.due} cards due{c.goal ? ` · ${c.goal}` : ''}</div>
                </div>
                {c.current ? <button className="btn small" onClick={() => useStore.setState({ view: 'classroom' })}>Go to class</button>
                  : <code className="faint" style={{ fontSize: 12.5 }} title="One Claude Code session per course: run this in a terminal">chalkroom start {c.id}</code>}
              </div>
            ))}
            {!library?.length && <div className="empty">This course lives outside the library ({app?.library}/courses).</div>}
          </div>
          <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>New course: <code>chalkroom new "Topic" --goal "…"</code></div>
        </div>
      </div>
    </div>
  );
}
