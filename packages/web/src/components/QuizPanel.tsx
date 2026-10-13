// Quizzes: the browser runs and grades objective items; free text goes to Claude once.
import { useEffect, useMemo, useState } from 'react';
import type { Quiz, Question, ItemResult } from '@chalk/schema';
import { api } from '../api';
import { useStore } from '../store';
import { useData, useInterval, fmtDuration } from '../lib/hooks';
import { gradeItem, correctAnswerText } from '../lib/grade';
import { QuestionInput } from './QuestionInput';
import { Markdown } from './Markdown';

export function QuizPanel() {
  const quizId = useStore((s) => s.quizId);
  return quizId ? <QuizView id={quizId} /> : <QuizList />;
}

function QuizList() {
  const { data } = useData(() => api.quizzes());
  const send = useStore((s) => s.send);
  const app = useStore((s) => s.app);
  const lessonTopic = app?.lessons.find((l) => l.id === app.lesson)?.topic;
  const list = [...(data ?? [])].reverse();
  return (
    <div className="quiz">
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => send('quiz_request', { topic: lessonTopic, data: { kind: 'topic' } })}>
          Quiz me{lessonTopic ? ' on this topic' : ''}
        </button>
        <button className="btn" onClick={() => send('quiz_request', { data: { kind: 'placement' }, text: 'Placement check across the syllabus to set my starting level.' })}>Placement check</button>
      </div>
      {!list.length && <div className="empty">No quizzes yet. The tutor writes one at the end of a lesson, or ask for one above.</div>}
      <div className="list">
        {list.map((q) => (
          <button key={q.id} className="list-item btn ghost" style={{ justifyContent: 'flex-start', textAlign: 'left', borderRadius: 8 }}
            onClick={() => useStore.setState({ quizId: q.id })}>
            <div className="grow">
              <div>{q.title}</div>
              <div className="faint" style={{ fontSize: 12.5 }}>{q.questions} questions · {new Date(q.createdAt).toLocaleDateString()} · {q.attempts ? `${q.attempts} attempt${q.attempts > 1 ? 's' : ''}` : 'not taken'}</div>
            </div>
            {q.best !== undefined && <span className="badge" style={{ background: q.best >= 0.8 ? 'var(--ok)' : q.best >= 0.5 ? 'var(--warn)' : 'var(--danger)' }}>{Math.round(q.best * 100)}%</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuizView({ id }: { id: string }) {
  const { data: quiz, error } = useData(() => api.quiz(id), [id]);
  const [mode, setMode] = useState<'take' | 'results' | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);

  useEffect(() => { setMode(null); setAttemptId(null); }, [id]);
  if (error) return <div className="quiz"><Back /><div className="empty">{error}</div></div>;
  if (!quiz) return <div className="quiz"><Back /><div className="empty">Loading…</div></div>;
  const latest = attemptId ? quiz.attempts.find((a) => a.id === attemptId) : quiz.attempts.at(-1);
  const m = mode ?? (latest ? 'results' : 'take');
  return m === 'take'
    ? <TakeQuiz quiz={quiz} onDone={(aid) => { setAttemptId(aid); setMode('results'); }} />
    : <Results quiz={quiz} attemptId={latest?.id} onRetry={() => setMode('take')} />;
}

function Back() {
  return <button className="btn ghost small" onClick={() => useStore.setState({ quizId: null })}>← All quizzes</button>;
}

function TakeQuiz({ quiz, onDone }: { quiz: Quiz; onDone: (attemptId: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [startedAt] = useState(() => new Date().toISOString());
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<number | null>(quiz.timed ? quiz.timed * 60000 : null);
  const toast = useStore((s) => s.toast);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const results: Record<string, ItemResult> = {};
    for (const q of quiz.questions) results[q.id] = gradeItem(q, answers[q.id]);
    try {
      const r = await api.submitAttempt(quiz.id, { startedAt, answers, results });
      if (r.pending) toast(`${r.pending} answer${r.pending > 1 ? 's' : ''} sent to your tutor for grading.`);
      onDone(r.attemptId);
    } catch (e) {
      toast(String((e as Error).message), 'error');
      setBusy(false);
    }
  };

  useInterval(() => {
    if (left === null) return;
    const next = quiz.timed! * 60000 - (Date.now() - new Date(startedAt).getTime());
    setLeft(next);
    if (next <= 0) void submit();
  }, left === null ? null : 500);

  const answered = quiz.questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== '').length;
  return (
    <div className="quiz">
      <div className="row"><Back /><span className="spacer" />{left !== null && <span className="timer" style={{ color: left < 60000 ? 'var(--danger)' : undefined }}>⏱ {fmtDuration(left)}</span>}</div>
      <h2 style={{ fontSize: 18 }}>{quiz.title}</h2>
      {quiz.questions.map((q, i) => (
        <div key={q.id} className="q">
          <div className="q-meta"><span>{i + 1} / {quiz.questions.length}</span><span>{label(q)}</span>{'★'.repeat(q.difficulty)}</div>
          <div className="q-prompt"><Markdown text={q.prompt} /></div>
          <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
        </div>
      ))}
      <div className="row">
        <span className="faint">{answered}/{quiz.questions.length} answered</span>
        <span className="spacer" />
        <button className="btn primary" disabled={busy} onClick={submit}>Submit</button>
      </div>
    </div>
  );
}

const label = (q: Question) => ({ mcq: 'Multiple choice', multi: 'Select all', tf: 'True / false', blank: 'Fill in', numeric: 'Number', order: 'Order', match: 'Match', short: 'Short answer', code: 'Code', diagram: 'Diagram', explain: 'Explain' } as Record<string, string>)[q.type];

function Results({ quiz, attemptId, onRetry }: { quiz: Quiz; attemptId?: string; onRetry: () => void }) {
  const attempt = quiz.attempts.find((a) => a.id === attemptId);
  const send = useStore((s) => s.send);
  const toast = useStore((s) => s.toast);
  const [madeCards, setMadeCards] = useState(false);
  const totals = useMemo(() => {
    let score = 0, max = 0, pending = 0;
    for (const r of Object.values(attempt?.results ?? {})) { score += r.score; max += r.max; if (r.gradedBy === 'pending') pending++; }
    return { score, max, pending };
  }, [attempt]);
  if (!attempt) return <div className="quiz"><Back /><div className="empty">No attempt yet.</div></div>;
  const misses = quiz.questions.filter((q) => { const r = attempt.results[q.id]; return r && r.gradedBy !== 'pending' && r.score < r.max; });

  const cardsFromMisses = async () => {
    for (const q of misses) {
      const fb = attempt.results[q.id]?.feedback;
      const ans = correctAnswerText(q);
      await api.upsertCard({ front: q.prompt, back: [ans, q.explanation, fb].filter(Boolean).join('\n\n') || '(see quiz feedback)', topic: q.topic ?? quiz.topic, source: `quiz:${quiz.id}#${q.id}` });
    }
    setMadeCards(true);
    toast(`${misses.length} card${misses.length === 1 ? '' : 's'} added to your deck.`);
  };

  const pct = totals.max ? Math.round((totals.score / totals.max) * 100) : 0;
  return (
    <div className="quiz">
      <div className="row"><Back /></div>
      <h2 style={{ fontSize: 18 }}>{quiz.title}</h2>
      <div className="card col">
        <div className="row"><b style={{ fontSize: 26 }}>{pct}%</b><span className="muted">{round(totals.score)} / {totals.max}</span><span className="spacer" />
          {totals.pending > 0 && <span className="faint">⏳ {totals.pending} waiting for your tutor</span>}</div>
        <div className="scorebar"><i style={{ width: `${pct}%` }} /></div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {misses.length > 0 && <button className="btn" disabled={madeCards} onClick={cardsFromMisses}>{madeCards ? 'Cards added' : `Make ${misses.length} card${misses.length > 1 ? 's' : ''} from misses`}</button>}
          <button className="btn" onClick={onRetry}>Try again</button>
          <button className="btn" onClick={() => send('quiz_request', { topic: quiz.topic, data: { retakeOf: quiz.id, kind: quiz.kind } })}>New questions</button>
        </div>
      </div>
      {quiz.questions.map((q, i) => {
        const r = attempt.results[q.id];
        const cls = !r || r.gradedBy === 'pending' ? '' : r.score >= r.max ? 'right' : 'wrong';
        return (
          <div key={q.id} className={`q ${cls}`}>
            <div className="q-meta"><span>{i + 1}</span><span>{label(q)}</span><span className="spacer" />
              {r && <span>{r.gradedBy === 'pending' ? '⏳ grading' : `${round(r.score)}/${r.max}`}</span>}</div>
            <div className="q-prompt"><Markdown text={q.prompt} /></div>
            <QuestionInput q={q} value={attempt.answers[q.id]} onChange={() => {}} reveal disabled />
            {(r?.feedback || (cls === 'wrong' && q.explanation)) && (
              <div className="feedback">
                {r?.feedback && <Markdown text={r.feedback} />}
                {cls === 'wrong' && q.explanation && <div className="muted" style={{ marginTop: 4 }}><Markdown text={q.explanation} /></div>}
                {cls === 'wrong' && !['short', 'code', 'diagram', 'explain'].includes(q.type) && <div className="faint" style={{ marginTop: 4 }}>Answer: {correctAnswerText(q)}</div>}
                {q.source && <div style={{ marginTop: 4 }}><Markdown text={q.source.startsWith('[[') ? q.source : `[[${q.source}]]`} /></div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
