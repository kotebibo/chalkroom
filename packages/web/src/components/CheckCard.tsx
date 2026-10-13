// Inline check question shown over the board (check_ask).
import { useEffect, useState } from 'react';
import { useStore, player } from '../store';
import { usePlayer } from '../board/Board';
import { gradeItem, isObjective, correctAnswerText } from '../lib/grade';
import { QuestionInput } from './QuestionInput';
import { Markdown } from './Markdown';

export function CheckCard() {
  const check = useStore((s) => s.check);
  const send = useStore((s) => s.send);
  const [value, setValue] = useState<unknown>(undefined);
  const [result, setResult] = useState<null | { correct?: boolean }>(null);

  usePlayer(player);
  useEffect(() => { setValue(undefined); setResult(null); }, [check?.checkId]);
  // wait until the explanation before it has finished playing
  if (!check || (player.busy && !result)) return null;
  const q = check.question;
  const objective = isObjective(q) && !(q.type === 'tf' && q.justify);

  const submit = () => {
    let correct: boolean | undefined;
    if (objective) correct = gradeItem(q, value).score >= 1;
    setResult({ correct });
    send('check_answer', {
      text: typeof value === 'string' ? value : undefined,
      data: { checkId: check.checkId, prompt: q.prompt, answer: value, ...(correct !== undefined ? { correct, expected: correctAnswerText(q) } : {}) },
    });
  };

  const empty = value === undefined || value === '' || (Array.isArray(value) && !value.length);

  return (
    <div className="check-card" role="dialog" aria-label="Check question">
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="section-title" style={{ margin: 0 }}>Quick check</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={() => useStore.setState({ check: null })} aria-label="Dismiss">✕</button>
      </div>
      <h3><Markdown text={q.prompt} /></h3>
      <QuestionInput q={q} value={value} onChange={setValue} reveal={!!result && objective} disabled={!!result} />
      {result && objective && (
        <div className="feedback" style={{ marginTop: 10 }}>
          <b style={{ color: result.correct ? 'var(--ok)' : 'var(--danger)' }}>{result.correct ? 'Correct.' : 'Not quite.'}</b>{' '}
          {q.explanation && <Markdown text={q.explanation} />}
        </div>
      )}
      <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
        {result ? <span className="faint">Sent to your tutor…</span>
          : <button className="btn primary" disabled={empty} onClick={submit}>Check</button>}
      </div>
    </div>
  );
}
