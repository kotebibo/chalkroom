// Flashcards side panel: approve proposed cards, write your own, start a review.
import { useState } from 'react';
import type { Card } from '@chalk/schema';
import { api } from '../api';
import { useStore } from '../store';
import { useData } from '../lib/hooks';
import { isDue, cloze } from '../lib/srs';
import { Markdown } from './Markdown';

export function CardsPanel() {
  const { data: deck, reload } = useData(() => api.deck());
  const send = useStore((s) => s.send);
  const lesson = useStore((s) => s.lesson);
  const [adding, setAdding] = useState(false);
  const cards = deck?.cards ?? [];
  const proposed = cards.filter((c) => c.status === 'proposed');
  const active = cards.filter((c) => c.status === 'active');
  const due = active.filter((c) => isDue(c));

  const setStatus = async (ids: string[], status: 'active' | 'deleted') => { await api.setCardStatus(ids, status); reload(); };

  return (
    <div className="quiz">
      <div className="card row" style={{ flexWrap: 'wrap' }}>
        <div className="grow">
          <div style={{ fontSize: 22, fontWeight: 700 }}>{due.length} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>due · {active.length} cards</span></div>
        </div>
        <button className="btn primary" disabled={!due.length} onClick={() => useStore.setState({ view: 'review' })}>Review</button>
      </div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => send('make_flashcards', { lesson: lesson ?? undefined, text: 'Make flashcards from this lesson.' })}>Cards from this lesson</button>
        <button className="btn" onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : 'Write a card'}</button>
      </div>
      {adding && <CardEditor onSave={async (c) => { await api.upsertCard({ ...c, status: 'active' }); setAdding(false); reload(); }} />}
      {proposed.length > 0 && (
        <>
          <div className="row">
            <h3 className="section-title" style={{ margin: 0 }}>Proposed by your tutor ({proposed.length})</h3>
            <span className="spacer" />
            <button className="btn small" onClick={() => setStatus(proposed.map((c) => c.id), 'active')}>Accept all</button>
          </div>
          {proposed.map((c) => <ProposedCard key={c.id} card={c} onAccept={() => setStatus([c.id], 'active')} onDrop={() => setStatus([c.id], 'deleted')} onEdit={async (p) => { await api.upsertCard({ ...c, ...p, status: 'active' }); reload(); }} />)}
        </>
      )}
      {!proposed.length && !active.length && <div className="empty">No cards yet. At the end of a lesson your tutor proposes cards for you to approve.</div>}
    </div>
  );
}

function ProposedCard({ card, onAccept, onDrop, onEdit }: { card: Card; onAccept: () => void; onDrop: () => void; onEdit: (p: Partial<Card>) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <CardEditor initial={card} onSave={(p) => { onEdit(p); setEditing(false); }} onCancel={() => setEditing(false)} />;
  return (
    <div className="q">
      <div className="q-meta"><span>{card.type}</span>{card.topic && <span>{card.topic}</span>}</div>
      <div className="q-prompt">{card.type === 'cloze' ? <span className="md" dangerouslySetInnerHTML={{ __html: cloze(escape(card.front), true) }} /> : <Markdown text={card.front} />}</div>
      {card.back && <div className="muted"><Markdown text={card.back} /></div>}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn small primary" onClick={onAccept}>Keep</button>
        <button className="btn small" onClick={() => setEditing(true)}>Edit</button>
        <button className="btn small danger" onClick={onDrop}>Drop</button>
      </div>
    </div>
  );
}

export function CardEditor({ initial, onSave, onCancel }: { initial?: Partial<Card>; onSave: (c: Partial<Card>) => void; onCancel?: () => void }) {
  const [front, setFront] = useState(initial?.front ?? '');
  const [back, setBack] = useState(initial?.back ?? '');
  const [topic, setTopic] = useState(initial?.topic ?? '');
  const isCloze = /\{\{c\d+::/.test(front);
  return (
    <div className="q col">
      <label className="col" style={{ gap: 4 }}><span className="faint" style={{ fontSize: 12 }}>Front {isCloze && '(cloze)'}</span>
        <textarea className="textarea" style={{ minHeight: 60 }} value={front} onChange={(e) => setFront(e.target.value)} placeholder="Question, or a sentence with {{c1::hidden part}}" /></label>
      {!isCloze && <label className="col" style={{ gap: 4 }}><span className="faint" style={{ fontSize: 12 }}>Back</span>
        <textarea className="textarea" style={{ minHeight: 60 }} value={back} onChange={(e) => setBack(e.target.value)} /></label>}
      <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic id (optional)" />
      <div className="row">
        <button className="btn primary small" disabled={!front.trim() || (!isCloze && !back.trim())} onClick={() => onSave({ front: front.trim(), back: back.trim(), topic: topic.trim() || undefined, type: isCloze ? 'cloze' : initial?.type === 'reverse' ? 'reverse' : 'basic' })}>Save</button>
        {onCancel && <button className="btn small" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

export const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
