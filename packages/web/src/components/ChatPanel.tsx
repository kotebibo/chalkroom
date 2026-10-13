// Chat: tutor messages, the learner's questions and (optionally) narration transcript.
import { useEffect, useRef } from 'react';
import type { LessonEvent } from '@chalk/schema';
import { useStore } from '../store';
import { narrationOf } from '../lib/player';
import { Markdown } from './Markdown';

const time = (t: string) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function Message({ ev, showNarration }: { ev: LessonEvent; showNarration: boolean }) {
  const d = ev.data as any;
  switch (ev.kind) {
    case 'chat_say':
      return <div className="msg tutor"><Markdown text={d.markdown} /></div>;
    case 'speak':
    case 'board_run': {
      if (!showNarration) return null;
      const t = narrationOf(ev);
      return t ? <div className="msg narration">{t}</div> : null;
    }
    case 'question':
    case 'explain_selection':
    case 'feynman_submit':
      return (
        <div className="msg user">
          {ev.kind !== 'question' && <div className="meta">{ev.kind === 'explain_selection' ? 'About the selection' : 'My explanation'}</div>}
          {d.text || (ev.kind === 'explain_selection' ? 'Explain this part, please.' : '')}
        </div>
      );
    case 'check_answer':
      return <div className="msg user"><div className="meta">Check answer</div>{d.data?.correct === true ? '✓ ' : d.data?.correct === false ? '✗ ' : ''}{formatAnswer(d.data?.answer)}</div>;
    case 'start_lesson':
      return <div className="msg system">Requested a lesson{d.topic ? ` on ${d.topic}` : ''}{d.mode ? ` · ${d.mode}` : ''}</div>;
    case 'lesson_start':
      return <div className="msg system">— {d.resumed ? 'Resumed' : 'Started'}: {d.title} · {time(ev.t)} —</div>;
    case 'lesson_end':
      return <div className="msg system">— Lesson finished · {time(ev.t)} —</div>;
    case 'quiz_create':
      return <div className="msg system">Quiz ready: <button className="chip" onClick={() => useStore.setState({ side: 'quiz', quizId: d.quizId })}>{d.title}</button></div>;
    case 'quiz_attempt':
      return <div className="msg system">Quiz submitted · {d.score}/{d.max}{d.pending ? ` · ${d.pending} for the tutor to grade` : ''}</div>;
    case 'cards_propose':
      return <div className="msg system"><button className="chip" onClick={() => useStore.setState({ side: 'cards' })}>{d.count} flashcards proposed</button></div>;
    default:
      return null;
  }
}

function formatAnswer(a: unknown): string {
  if (a === undefined || a === null) return '';
  if (typeof a === 'object') return JSON.stringify(a);
  return String(a);
}

export function ChatPanel() {
  const events = useStore((s) => s.events);
  const showNarration = useStore((s) => s.settings.showNarration);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [events.length]);
  return (
    <div className="scroll" style={{ flex: 1 }}>
      <div className="chat" aria-live="polite">
        {!events.length && <div className="empty">Messages from your tutor appear here.<br />Ask anything with the box below — or hold <span className="kbd">Space</span> to talk.</div>}
        {events.map((ev) => <Message key={`${ev.seq}-${ev.kind}`} ev={ev} showNarration={showNarration} />)}
        <div ref={end} />
      </div>
    </div>
  );
}
