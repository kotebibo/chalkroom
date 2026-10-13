// Inputs for every question type, shared by inline checks and quizzes.
import { useMemo } from 'react';
import type { Question } from '@chalk/schema';
import { Markdown } from './Markdown';

interface Props {
  q: Question;
  value: unknown;
  onChange: (v: unknown) => void;
  reveal?: boolean;
  disabled?: boolean;
}

const LETTERS = 'ABCDEFGHIJ';

export function QuestionInput({ q, value, onChange, reveal, disabled }: Props) {
  const opts = q.options ?? [];
  switch (q.type) {
    case 'mcq':
    case 'multi': {
      const multi = q.type === 'multi';
      const chosen = new Set(multi ? ((value as number[]) ?? []) : value === undefined ? [] : [value as number]);
      const correct = new Set(multi ? ((q.answer as number[]) ?? []) : [q.answer as number]);
      return (
        <div role={multi ? 'group' : 'radiogroup'}>
          {opts.map((o, i) => {
            const cls = reveal ? (correct.has(i) ? 'correct' : chosen.has(i) ? 'wrong' : '') : '';
            return (
              <button key={i} type="button" className={`option ${cls}`} aria-pressed={chosen.has(i)} disabled={disabled}
                role={multi ? 'checkbox' : 'radio'} aria-checked={chosen.has(i)}
                onClick={() => {
                  if (!multi) return onChange(i);
                  const next = new Set(chosen);
                  if (next.has(i)) next.delete(i); else next.add(i);
                  onChange([...next].sort());
                }}>
                <span className="key">{LETTERS[i]}</span><span className="grow"><Markdown text={o} /></span>
              </button>
            );
          })}
          {multi && <div className="faint" style={{ fontSize: 12 }}>Select all that apply.</div>}
        </div>
      );
    }
    case 'tf': {
      const v = (typeof value === 'object' && value ? value : { value: value as boolean | undefined }) as { value?: boolean; why?: string };
      return (
        <div className="col">
          <div className="row">
            {[true, false].map((b) => (
              <button key={String(b)} type="button" disabled={disabled}
                className={`option ${reveal ? (q.answer === b ? 'correct' : v.value === b ? 'wrong' : '') : ''}`}
                aria-pressed={v.value === b} style={{ marginBottom: 0 }}
                onClick={() => onChange(q.justify ? { ...v, value: b } : b)}>
                {b ? 'True' : 'False'}
              </button>
            ))}
          </div>
          {q.justify && (
            <textarea className="textarea" placeholder="Why?" disabled={disabled} value={v.why ?? ''} onChange={(e) => onChange({ ...v, why: e.target.value })} />
          )}
        </div>
      );
    }
    case 'blank':
    case 'numeric':
      return (
        <input className="input" disabled={disabled} inputMode={q.type === 'numeric' ? 'decimal' : 'text'}
          value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder={q.type === 'numeric' ? 'Number' : 'Your answer'}
          aria-label="Answer" />
      );
    case 'order':
      return <OrderInput q={q} value={value as number[] | undefined} onChange={onChange} disabled={disabled} reveal={reveal} />;
    case 'match': {
      const right = q.matchRight ?? [];
      const v = (value as number[]) ?? [];
      return (
        <div className="col">
          {opts.map((left, i) => (
            <div key={i} className="row">
              <span className="grow">{left}</span>
              <select className="select" style={{ width: '55%' }} disabled={disabled} value={v[i] ?? ''} aria-label={`Match for ${left}`}
                onChange={(e) => { const n = [...v]; n[i] = Number(e.target.value); onChange(n); }}>
                <option value="" disabled>Choose…</option>
                {right.map((r, j) => <option key={j} value={j}>{r}</option>)}
              </select>
              {reveal && <span style={{ color: v[i] === (q.answer as number[])?.[i] ? 'var(--ok)' : 'var(--danger)' }}>{v[i] === (q.answer as number[])?.[i] ? '✓' : '✗'}</span>}
            </div>
          ))}
        </div>
      );
    }
    case 'code':
      return <textarea className="textarea" style={{ fontFamily: 'var(--font-mono)', minHeight: 130 }} disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="Write code…" spellCheck={false} />;
    case 'diagram':
      return <textarea className="textarea" disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="Draw it on the board (pen tool), then describe it here. The tutor will look at the board." />;
    default:
      return <textarea className="textarea" disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="Explain in your own words…" />;
  }
}

function OrderInput({ q, value, onChange, disabled, reveal }: { q: Question; value?: number[]; onChange: (v: unknown) => void; disabled?: boolean; reveal?: boolean }) {
  const opts = q.options ?? [];
  // stable shuffle per question so the answer is not shown in order
  const initial = useMemo(() => opts.map((_, i) => i).sort((a, b) => hash(q.id + a) - hash(q.id + b)), [q.id, opts.length]);
  const order = value ?? initial;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const n = [...order];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  const want = q.answer as number[] | undefined;
  return (
    <div>
      {order.map((idx, i) => (
        <div key={idx} className="order-item" style={reveal ? { borderColor: want?.[i] === idx ? 'var(--ok)' : 'var(--danger)' } : undefined}>
          <span className="faint" style={{ width: 18 }}>{i + 1}.</span>
          <span className="grow">{opts[idx]}</span>
          <button type="button" className="btn ghost small" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
          <button type="button" className="btn ghost small" disabled={disabled || i === order.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
        </div>
      ))}
      {value === undefined && !disabled && <button type="button" className="btn small" onClick={() => onChange(initial)}>Keep this order</button>}
    </div>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
