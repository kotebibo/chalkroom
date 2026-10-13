// Top bar, connection banners and toasts.
import { useState } from 'react';
import type { ConnectionState } from '@chalk/schema';
import { useStore, type View } from '../store';
import { api } from '../api';
import { useInterval, fmtDuration } from '../lib/hooks';

const STATUS: Record<ConnectionState, string> = {
  connected: 'Tutor connected',
  thinking: 'Tutor is thinking…',
  terminal: 'Terminal mode',
  disconnected: 'No tutor',
  checking: 'Connecting to tutor…',
};

const NAV: { id: View; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'classroom', label: 'Classroom' },
  { id: 'review', label: 'Review' },
  { id: 'progress', label: 'Progress' },
  { id: 'resources', label: 'Resources' },
];

export function TopBar() {
  const { app, view, connection, lessonStartedAt, socketOpen } = useStore();
  const [now, setNow] = useState(Date.now());
  useInterval(() => setNow(Date.now()), lessonStartedAt ? 1000 : null);
  const lesson = app?.lessons.find((l) => l.id === app?.lesson);
  const due = app?.cards.due ?? 0;
  const state: ConnectionState = socketOpen ? connection : 'disconnected';
  return (
    <header className="topbar">
      <div className="brand" aria-label="Chalkroom">
        <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="var(--board)" /><path d="M7 21c3-8 9-12 17-11" stroke="var(--chalk)" strokeWidth="3" fill="none" strokeLinecap="round" /><circle cx="24" cy="10" r="2" fill="var(--chalk-accent)" /></svg>
        Chalkroom
      </div>
      <div className="crumbs">
        <b title={app?.course?.title}>{app?.course?.title ?? '…'}</b>
        {lesson && <><span aria-hidden>›</span><span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lesson.title}</span></>}
      </div>
      <nav className="nav" aria-label="Main">
        {NAV.map((n) => (
          <button key={n.id} className="btn small" aria-current={view === n.id ? 'page' : undefined} onClick={() => useStore.setState({ view: n.id })}>
            {n.label}{n.id === 'review' && due > 0 && <span className="badge">{due}</span>}
          </button>
        ))}
      </nav>
      <span className="spacer" />
      <span className="status" role="status" aria-live="polite"><span className={`dot ${state}`} />{STATUS[state]}{app?.mock && ' (mock)'}</span>
      {lessonStartedAt && <span className="timer" title="Lesson time">⏱ {fmtDuration(now - new Date(lessonStartedAt).getTime())}</span>}
      <button className="btn ghost icon-btn" aria-label="Settings" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => useStore.setState({ view: 'settings' })}>⚙</button>
    </header>
  );
}

export function ConnectionBanner() {
  const { connection, socketOpen, app } = useStore();
  const [copied, setCopied] = useState(false);
  const id = app?.course?.id ?? '<course>';
  if (!socketOpen) {
    return <div className="banner error" role="alert">Lost connection to Chalkroom. Reconnecting… If Claude Code was closed, start class again with <code>chalkroom start {id}</code>.</div>;
  }
  if (connection === 'terminal') {
    const cmd = `chalkroom start ${id}`;
    return (
      <div className="banner warn" role="alert">
        <b>Terminal mode.</b>
        <span className="grow">Your tutor isn't receiving input from this page. Type in the Claude Code terminal; the board still works. To fix it, restart with channels: <code>{cmd}</code></span>
        <button className="btn small" onClick={() => { void navigator.clipboard?.writeText(cmd); setCopied(true); }}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="btn small" onClick={() => api.heartbeat()}>Retry</button>
      </div>
    );
  }
  if (connection === 'disconnected') {
    return <div className="banner error">No Claude Code session is attached. Reviews, quizzes and lesson replays still work. Start class with <code>chalkroom start {id}</code>.</div>;
  }
  return null;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.level}`}>{t.text}</div>)}
    </div>
  );
}
