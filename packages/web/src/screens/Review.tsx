// Full-screen flashcard review with FSRS. Only "I don't get this card" reaches Claude.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card } from '@chalk/schema';
import { api } from '../api';
import { useStore } from '../store';
import { useData } from '../lib/hooks';
import { RATINGS, isDue, schedule, previews, cloze, LEECH_LAPSES, toCsv, parseCsv } from '../lib/srs';
import { fuzzyEqual } from '../lib/grade';
import { Markdown } from '../components/Markdown';
import { escape } from '../components/CardsPanel';
import { download } from '../board/exportBoard';

export function Review() {
  const { data: deck, reload } = useData(() => api.deck(), [], { live: false });
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [done, setDone] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [typed, setTyped] = useState('');
  const [typeMode, setTypeMode] = useState(false);
  const send = useStore((s) => s.send);
  const toast = useStore((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!deck || queue) return;
    // due cards first (oldest due first), new cards capped at 20 per session
    const due = deck.cards.filter((c) => isDue(c));
    const reviews = due.filter((c) => c.fsrs).sort((a, b) => a.fsrs!.due.localeCompare(b.fsrs!.due));
    const fresh = due.filter((c) => !c.fsrs).slice(0, 20);
    setQueue([...reviews, ...fresh]);
  }, [deck, queue]);

  const card = queue?.[0];
  const pv = useMemo(() => (card ? previews(card) : {}), [card]);

  const rate = async (grade: number) => {
    if (!card || !queue) return;
    const fsrs = schedule(card, grade as any);
    const updated = { ...card, fsrs };
    await api.review(card.id, fsrs, grade).catch((e) => toast(String(e.message), 'error'));
    // cards due again within this session go back in the queue
    const rest = queue.slice(1);
    const again = new Date(fsrs.due).getTime() - Date.now() < 10 * 60000;
    setQueue(again ? [...rest, updated] : rest);
    setDone((d) => d + 1);
    setFlipped(false);
    setTyped('');
    if (fsrs.lapses >= LEECH_LAPSES && (card.fsrs?.lapses ?? 0) < LEECH_LAPSES) toast('This card keeps slipping. Ask your tutor for a mini-lesson on it.', 'warn');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useStore.getState().view !== 'review' || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) return;
      if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); if (!flipped) setFlipped(true); }
      else if (flipped && ['1', '2', '3', '4'].includes(e.key)) void rate(Number(e.key));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const importCsv = async (f: File) => {
    const rows = parseCsv(await f.text());
    for (const r of rows) await api.upsertCard({ ...r, type: /\{\{c\d+::/.test(r.front) ? 'cloze' : 'basic', status: 'active' });
    toast(`Imported ${rows.length} cards.`);
    setQueue(null);
    reload();
  };

  const active = deck?.cards.filter((c) => c.status === 'active') ?? [];
  const leeches = active.filter((c) => (c.fsrs?.lapses ?? 0) >= LEECH_LAPSES);
  const isCloze = card?.type === 'cloze';
  const answerText = card ? (isCloze ? (/\{\{c\d+::(.+?)(?:::.+?)?\}\}/.exec(card.front)?.[1] ?? '') : card.back) : '';

  return (
    <div className="review">
      <div className="row" style={{ width: 'min(680px, 100%)' }}>
        <h1 style={{ fontSize: 20 }}>Review</h1>
        <span className="spacer" />
        <span className="muted">{done} done · {queue?.length ?? 0} left</span>
        <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={typeMode} onChange={(e) => setTypeMode(e.target.checked)} /> Type answers</label>
      </div>
      {!deck && <div className="empty">Loading…</div>}
      {deck && card && (
        <>
          <div className="flashcard" onClick={() => !flipped && setFlipped(true)} role="button" tabIndex={0} aria-label={flipped ? 'Card answer' : 'Card question, press Space to flip'}>
            <div>{isCloze ? <span dangerouslySetInnerHTML={{ __html: cloze(escape(card.front), flipped) }} /> : <Markdown text={card.front} />}</div>
            {flipped && !isCloze && <div className="back"><Markdown text={card.back} /></div>}
            {flipped && typeMode && typed && (
              <div style={{ fontSize: 18, fontFamily: 'var(--font-ui)', color: fuzzyEqual(typed, answerText) ? 'var(--chalk-good)' : 'var(--chalk-bad)' }}>
                You typed: {typed} {fuzzyEqual(typed, answerText) ? '✓' : '✗'}
              </div>
            )}
          </div>
          {!flipped && typeMode && (
            <form className="row" style={{ width: 'min(680px, 100%)' }} onSubmit={(e) => { e.preventDefault(); setFlipped(true); }}>
              <input className="input" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your answer, then Enter" />
            </form>
          )}
          {flipped ? (
            <div className="ratings">
              {RATINGS.map((r) => (
                <button key={r.grade} className={`btn ${r.grade === 3 ? 'primary' : ''}`} onClick={() => rate(r.grade)}>
                  <span>{r.label}</span><small>{pv[r.grade]} · <span className="kbd">{r.key}</span></small>
                </button>
              ))}
            </div>
          ) : (
            <button className="btn primary" onClick={() => setFlipped(true)}>Show answer <span className="kbd">Space</span></button>
          )}
          <div className="row">
            <button className="btn ghost small" onClick={() => { send('question', { text: `I don't get this flashcard: "${card.front}" → "${card.back}". Explain it simply.`, topic: card.topic }); toast('Asked your tutor. The answer appears in the classroom chat.'); }}>I don't get this card</button>
            <button className="btn ghost small" onClick={async () => { await api.setCardStatus([card.id], 'suspended'); setQueue(queue!.slice(1)); }}>Suspend</button>
            {(card.fsrs?.lapses ?? 0) >= LEECH_LAPSES && <span className="chip" style={{ color: 'var(--warn)' }}>leech</span>}
          </div>
        </>
      )}
      {deck && queue && !card && (
        <div className="card col" style={{ width: 'min(680px, 100%)', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-hand)', fontSize: 30 }}>{done ? 'All done for now.' : 'Nothing due.'}</div>
          <div className="muted">{active.length} cards in this course. Next due: {nextDue(active)}</div>
          <button className="btn" onClick={() => useStore.setState({ view: 'classroom' })}>Back to class</button>
        </div>
      )}
      {leeches.length > 0 && (
        <div className="card" style={{ width: 'min(680px, 100%)' }}>
          <h3 className="section-title">Leeches</h3>
          <div className="muted" style={{ marginBottom: 8 }}>Cards you've missed {LEECH_LAPSES}+ times usually need a better explanation, not more reviews.</div>
          {leeches.slice(0, 5).map((c) => <div key={c.id} className="list-item"><span className="grow">{c.front}</span></div>)}
          <button className="btn small" onClick={() => { send('question', { text: `Give me a short mini-lesson on these cards I keep forgetting: ${leeches.slice(0, 5).map((c) => `"${c.front}"`).join(', ')}` }); useStore.setState({ view: 'classroom' }); }}>Mini-lesson on these</button>
        </div>
      )}
      <div className="row faint" style={{ fontSize: 13 }}>
        <button className="btn ghost small" onClick={() => download('flashcards.csv', new Blob([toCsv(active)], { type: 'text/csv' }))}>Export CSV</button>
        <button className="btn ghost small" onClick={() => fileRef.current?.click()}>Import CSV</button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
      </div>
    </div>
  );
}

function nextDue(cards: Card[]) {
  const ds = cards.map((c) => c.fsrs?.due).filter(Boolean).sort() as string[];
  return ds[0] ? new Date(ds[0]).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}
