// The classroom: syllabus, whiteboard with narration, chat/quiz/cards, controls.
import { useEffect, useRef, useState } from 'react';
import { useStore, player, unlockAudio, setMuted } from '../store';
import { Board, PageStrip, usePlayer, type Tool } from '../board/Board';
import { boardSvg, svgToPng, download } from '../board/exportBoard';
import { SyllabusList, MODES } from '../components/Syllabus';
import { ChatPanel } from '../components/ChatPanel';
import { QuizPanel } from '../components/QuizPanel';
import { CardsPanel } from '../components/CardsPanel';
import { CheckCard } from '../components/CheckCard';
import { Listener, sttSupported } from '../lib/stt';
import { api } from '../api';
import type { EnvelopeType } from '@chalk/schema';

export function Classroom() {
  const side = useStore((s) => s.side);
  const app = useStore((s) => s.app);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const proposed = app?.cards.proposed ?? 0;
  return (
    <div className={`classroom ${leftOpen ? '' : 'left-collapsed'} ${rightOpen ? '' : 'right-collapsed'}`}>
      <aside className="sidebar" aria-label="Course">
        <div className="scroll" style={{ padding: 10, flex: 1 }}>
          <h2 className="section-title">Syllabus</h2>
          <SyllabusList />
        </div>
        <div style={{ borderTop: '1px solid var(--line)', padding: 10 }} className="col">
          <button className="btn small" onClick={() => useStore.setState({ view: 'resources' })}>📚 Resources</button>
        </div>
      </aside>
      <Stage onToggleLeft={() => setLeftOpen((v) => !v)} onToggleRight={() => setRightOpen((v) => !v)} />
      <aside className="rightbar" aria-label="Chat and practice">
        <div className="tabs" role="tablist">
          {(['chat', 'quiz', 'cards'] as const).map((t) => (
            <button key={t} role="tab" className="tab" aria-selected={side === t} onClick={() => useStore.setState({ side: t })}>
              {t === 'chat' ? 'Chat' : t === 'quiz' ? 'Quiz' : 'Cards'}
              {t === 'cards' && proposed > 0 && <span className="badge">{proposed}</span>}
            </button>
          ))}
        </div>
        {side === 'chat' ? <ChatPanel /> : <div className="scroll" style={{ flex: 1 }}>{side === 'quiz' ? <QuizPanel /> : <CardsPanel />}</div>}
      </aside>
    </div>
  );
}

function Stage({ onToggleLeft, onToggleRight }: { onToggleLeft: () => void; onToggleRight: () => void }) {
  usePlayer(player);
  const { audioUnlocked, selection, lesson, app, muted } = useStore();
  const send = useStore((s) => s.send);
  const sendUserEvent = useStore((s) => s.sendUserEvent);
  const [tool, setTool] = useState<Tool>('select');
  const lessonInfo = app?.lessons.find((l) => l.id === lesson);
  const hasTopics = (app?.syllabus.topics.length ?? 0) > 0;

  const exportPage = async (kind: 'svg' | 'png') => {
    const svg = await boardSvg();
    const name = `${lesson ?? 'board'}-p${(player.viewPage ?? player.state.current) + 1}`;
    if (kind === 'svg') download(`${name}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
    else download(`${name}.png`, await svgToPng(svg, 2));
    if (lesson) void api.exportBoard(name, kind === 'png' ? await svgToPng(svg, 2) : svg).catch(() => {});
  };

  return (
    <section className="stage" aria-label="Whiteboard">
      <div className="stage-tools">
        <button className="btn ghost small" onClick={onToggleLeft} aria-label="Toggle syllabus">☰</button>
        <div className="row" role="group" aria-label="Board tools">
          <button className="btn small" aria-pressed={tool === 'select'} onClick={() => setTool('select')} title="Select shapes (drag for a box)">⬚ Select</button>
          <button className="btn small" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')} title="Draw on the board">✎ Pen</button>
          <button className="btn small" aria-pressed={tool === 'erase'} onClick={() => setTool('erase')} title="Erase your drawings">⌫ Erase</button>
        </div>
        <span className="spacer" />
        {lessonInfo?.mode && <span className="chip" title="Teaching mode">{MODES.find((m) => m.id === lessonInfo.mode)?.label ?? lessonInfo.mode}</span>}
        <button className="btn ghost small" onClick={() => exportPage('png')} title="Export page as PNG">⤓ PNG</button>
        <button className="btn ghost small" onClick={() => exportPage('svg')} title="Export page as SVG">⤓ SVG</button>
        <button className="btn ghost small" onClick={() => setMuted(!muted)} aria-pressed={muted} title={muted ? 'Unmute' : 'Mute'}>{muted ? '🔇' : '🔊'}</button>
        <button className="btn ghost small" onClick={onToggleRight} aria-label="Toggle side panel">◧</button>
      </div>
      <div className="board-wrap">
        <Board
          player={player}
          tool={tool}
          selection={selection}
          onSelect={(ids) => useStore.setState({ selection: ids })}
          onDraw={(points) => {
            const shape = { id: `u-${Date.now().toString(36)}`, kind: 'path' as const, points, style: 'warn' as const };
            player.push({ seq: 0, t: new Date().toISOString(), source: 'user', kind: 'draw', data: { shape } }, false);
            sendUserEvent('draw', { shape });
          }}
          onErase={(id) => {
            player.push({ seq: 0, t: new Date().toISOString(), source: 'user', kind: 'erase', data: { ids: [id] } }, false);
            sendUserEvent('erase', { ids: [id] });
          }}
          emptyHint={hasTopics ? 'Pick a topic to start a lesson' : 'Draft a syllabus to begin'}
        />
        {selection.length > 0 && (
          <div className="selection-bar">
            <span>{selection.length} selected</span>
            <button className="btn small primary" onClick={() => { send('explain_selection', { text: 'Explain this part.', context: { boardSelection: selection } }); useStore.setState({ selection: [] }); }}>Ask about this</button>
            <button className="btn small ghost" onClick={() => useStore.setState({ selection: [] })}>Clear</button>
          </div>
        )}
        <CheckCard />
        {!audioUnlocked && (
          <div className="gate">
            <h2>{app?.course?.title ?? 'Chalkroom'}</h2>
            <div className="muted">Your tutor talks and draws here. Click to let the page play sound.</div>
            <div className="row">
              <button className="btn primary" onClick={unlockAudio} autoFocus>Enter classroom</button>
              <button className="btn" onClick={() => { useStore.getState().saveSettings({ textOnly: true }); unlockAudio(); }}>Text only</button>
            </div>
          </div>
        )}
      </div>
      <PageStrip player={player} />
      <div>
        <Captions />
        <ControlBar send={send} />
      </div>
    </section>
  );
}

function Captions() {
  usePlayer(player);
  const connection = useStore((s) => s.connection);
  const text = player.caption;
  return (
    <div className="captions" aria-live="polite">
      {text ? <span>{text}</span> : <span className="faint">{player.paused ? 'Paused' : connection === 'thinking' ? 'Your tutor is preparing…' : ' '}</span>}
    </div>
  );
}

function ControlBar({ send }: { send: (t: EnvelopeType, f?: Record<string, unknown>) => void }) {
  usePlayer(player);
  const prompt = useStore((s) => s.prompt);
  const lesson = useStore((s) => s.lesson);
  const app = useStore((s) => s.app);
  const settings = useStore((s) => s.settings);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [feynman, setFeynman] = useState(false);
  const listener = useRef(new Listener());
  const lastControl = useRef<{ type: string; at: number }>({ type: '', at: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  const control = (type: EnvelopeType, extra: Record<string, unknown> = {}) => {
    // merge rapid repeats (e.g. Next, Next) into one request
    const now = Date.now();
    if (lastControl.current.type === type && now - lastControl.current.at < 1500) return;
    lastControl.current = { type, at: now };
    send(type, extra);
  };

  const ask = (q: string) => {
    if (!q.trim()) return;
    send('question', { text: q.trim() });
    setText('');
  };

  const startListening = () => {
    if (listening) return;
    try {
      player.interrupt();
      listener.current.start(settings.sttLang || app?.course?.language || navigator.language, (t) => setText(t), (final) => {
        setListening(false);
        if (final) ask(final);
      });
      setListening(true);
    } catch (e) {
      useStore.getState().toast(String((e as Error).message), 'warn');
    }
  };
  const stopListening = () => { listener.current.stop(); };

  // push-to-talk: hold Space when not typing
  useEffect(() => {
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.closest('input, textarea, select, [contenteditable]') !== null);
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || typing(e.target) || useStore.getState().view !== 'classroom' || !sttSupported) return;
      e.preventDefault();
      startListening();
    };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space' && listener.current.active) { e.preventDefault(); stopListening(); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  const lessonTopic = app?.lessons.find((l) => l.id === lesson)?.topic;
  return (
    <>
      {prompt && <div className="prompt-hint">{prompt}</div>}
      <div className="controlbar">
        <div className="row" role="group" aria-label="Lesson controls">
          {player.paused
            ? <button className="btn icon-btn" onClick={() => player.resume()} aria-label="Resume" title="Resume">▶</button>
            : <button className="btn icon-btn" onClick={() => player.pause()} aria-label="Pause" title="Pause">⏸</button>}
          <button className="btn" disabled={!lesson} onClick={() => control('next')}>Next</button>
          <button className="btn" disabled={!lesson} onClick={() => control('repeat')}>Repeat</button>
          <button className="btn" disabled={!lesson} onClick={() => control('slower')}>Slower</button>
          <button className="btn" disabled={!lesson} onClick={() => setFeynman(true)} title="Explain it back in your own words">Explain back</button>
          <button className="btn ghost" disabled={!lesson} onClick={() => control('next', { text: 'Wrap up this lesson.', data: { wrapUp: true } })} title="Notes, flashcards and progress">Wrap up</button>
        </div>
        <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
          {sttSupported && (
            <button type="button" className={`btn icon-btn mic ${listening ? 'on' : ''}`} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Speak a question'}
              title="Hold Space to talk" onClick={() => (listening ? stopListening() : startListening())}>🎤</button>
          )}
          <input ref={inputRef} className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={listening ? 'Listening…' : 'Ask a question…'} aria-label="Ask a question" />
          <button className="btn primary" disabled={!text.trim()}>Ask</button>
        </form>
      </div>
      {feynman && <FeynmanDialog topic={lessonTopic} onClose={() => setFeynman(false)} onSubmit={(t) => { send('feynman_submit', { text: t, topic: lessonTopic }); setFeynman(false); }} />}
    </>
  );
}

function FeynmanDialog({ topic, onClose, onSubmit }: { topic?: string; onClose: () => void; onSubmit: (t: string) => void }) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const l = useRef(new Listener());
  const app = useStore((s) => s.app);
  return (
    <div className="modal-back" role="dialog" aria-label="Explain it back" onClick={onClose}>
      <div className="modal" style={{ width: 'min(640px, 100%)' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><b>Explain it back{topic ? `: ${app?.syllabus.topics.find((t) => t.id === topic)?.title ?? topic}` : ''}</b><span className="spacer" /><button className="btn ghost small" onClick={onClose}>✕</button></div>
        <div className="col" style={{ padding: 14 }}>
          <div className="muted">Teach it as if to a friend. You can also draw on the board first — your tutor will look at it.</div>
          <textarea className="textarea" style={{ minHeight: 180 }} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="row">
            {sttSupported && <button className={`btn ${listening ? 'mic on' : ''}`} onClick={() => {
              if (listening) { l.current.stop(); return; }
              l.current.start(app?.course?.language ?? 'en', (t) => setText(t), () => setListening(false));
              setListening(true);
            }}>🎤 {listening ? 'Stop' : 'Speak'}</button>}
            <span className="spacer" />
            <button className="btn primary" disabled={!text.trim()} onClick={() => onSubmit(text.trim())}>Send to tutor</button>
          </div>
        </div>
      </div>
    </div>
  );
}
