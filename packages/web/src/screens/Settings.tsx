// Settings: theme, voice, speech input, learner profile, course details.
import { useEffect, useState } from 'react';
import { useStore, player } from '../store';
import { api } from '../api';
import { listBrowserVoices } from '../lib/speaker';
import { sttSupported } from '../lib/stt';

export function Settings() {
  const { settings, saveSettings, app } = useStore();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [learner, setLearner] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const course = app?.course;
  const [deadline, setDeadline] = useState(course?.deadline?.slice(0, 10) ?? '');
  const [goal, setGoal] = useState(course?.goal ?? '');
  const [language, setLanguage] = useState(course?.language ?? 'en');

  useEffect(() => { void listBrowserVoices().then(setVoices); void api.readFileText('~learner.md').then(setLearner); }, []);
  useEffect(() => { setDeadline(course?.deadline?.slice(0, 10) ?? ''); setGoal(course?.goal ?? ''); setLanguage(course?.language ?? 'en'); }, [course?.id]);

  const lang = (course?.language ?? 'en').toLowerCase();
  const sorted = [...voices].sort((a, b) => Number(b.lang.toLowerCase().startsWith(lang)) - Number(a.lang.toLowerCase().startsWith(lang)) || a.name.localeCompare(b.name));
  const tts = app?.tts;

  return (
    <div className="page-scroll">
      <div className="page" style={{ maxWidth: 820 }}>
        <h1 style={{ fontSize: 24 }}>Settings</h1>

        <section className="card col">
          <h2 className="section-title">Look</h2>
          <div className="row" role="radiogroup" aria-label="Theme">
            {(['chalkboard', 'whiteboard', 'contrast'] as const).map((t) => (
              <button key={t} className="btn" aria-pressed={settings.theme === t} onClick={() => saveSettings({ theme: t })}>{t === 'contrast' ? 'High contrast' : t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>
          <label className="row"><input type="checkbox" checked={settings.showNarration} onChange={(e) => saveSettings({ showNarration: e.target.checked })} /> Show narration transcript in chat</label>
        </section>

        <section className="card col">
          <h2 className="section-title">Voice</h2>
          <label className="col" style={{ gap: 4 }}>Provider
            <select className="select" value={settings.ttsProvider} onChange={(e) => saveSettings({ ttsProvider: e.target.value as any, voice: '' })}>
              <option value="browser">Browser voice (free, offline)</option>
              <option value="openai" disabled={!tts?.openai}>OpenAI {tts?.openai ? '' : '— add OPENAI_API_KEY to .env'}</option>
              <option value="elevenlabs" disabled={!tts?.elevenlabs}>ElevenLabs {tts?.elevenlabs ? '' : '— add ELEVENLABS_API_KEY to .env'}</option>
            </select>
          </label>
          {settings.ttsProvider === 'browser' ? (
            <label className="col" style={{ gap: 4 }}>Voice
              <select className="select" value={settings.voice} onChange={(e) => saveSettings({ voice: e.target.value })}>
                <option value="">Automatic ({course?.language ?? 'en'})</option>
                {sorted.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}{v.localService ? '' : ' · online'}</option>)}
              </select>
            </label>
          ) : (
            <label className="col" style={{ gap: 4 }}>Voice id
              <input className="input" value={settings.voice} placeholder={settings.ttsProvider === 'openai' ? 'alloy, nova, shimmer…' : 'ElevenLabs voice id'} onChange={(e) => saveSettings({ voice: e.target.value })} />
            </label>
          )}
          <label className="col" style={{ gap: 4 }}>Speed: {settings.speed.toFixed(2)}×
            <input type="range" min={0.75} max={2} step={0.05} value={settings.speed} onChange={(e) => saveSettings({ speed: Number(e.target.value) })} />
          </label>
          <label className="row"><input type="checkbox" checked={settings.textOnly} onChange={(e) => saveSettings({ textOnly: e.target.checked })} /> Text only (captions, no audio)</label>
          <div className="row"><button className="btn small" onClick={() => { player.speaker.stop(); void player.speaker.speak('This is how your tutor sounds.'); }}>Test voice</button></div>
          <div className="faint" style={{ fontSize: 12.5 }}>Keys live in <code>{app?.library}/.env</code> and are used only by the local Chalk server.</div>
        </section>

        <section className="card col">
          <h2 className="section-title">Speech input</h2>
          {!sttSupported && <div className="muted">This browser has no speech recognition. Use Chrome or Edge, or type.</div>}
          <label className="col" style={{ gap: 4 }}>Recognition language
            <input className="input" value={settings.sttLang} placeholder={`Default: course language (${course?.language ?? 'en'})`} onChange={(e) => saveSettings({ sttLang: e.target.value })} />
          </label>
          <div className="faint" style={{ fontSize: 12.5 }}>Hold <span className="kbd">Space</span> in the classroom to talk. Speaking while the tutor talks interrupts it.</div>
        </section>

        <section className="card col">
          <h2 className="section-title">This course</h2>
          <label className="col" style={{ gap: 4 }}>Goal<textarea className="textarea" value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
          <div className="row">
            <label className="col grow" style={{ gap: 4 }}>Teaching language<input className="input" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="en, ka, de…" /></label>
            <label className="col grow" style={{ gap: 4 }}>Deadline<input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
          </div>
          <div className="row"><button className="btn primary small" onClick={async () => {
            await api.saveCourse({ goal, language, deadline: deadline ? new Date(deadline).toISOString() : undefined });
            await useStore.getState().refresh();
            setSaved(true); setTimeout(() => setSaved(false), 1500);
          }}>{saved ? 'Saved' : 'Save course'}</button><span className="faint" style={{ fontSize: 12.5 }}>{app?.dir}</span></div>
        </section>

        <section className="card col">
          <h2 className="section-title">About you (learner.md)</h2>
          <div className="faint" style={{ fontSize: 12.5 }}>Shared by all courses. Your tutor reads it when planning: background, goals, analogies that work for you.</div>
          <textarea className="textarea" style={{ minHeight: 220, fontFamily: 'var(--font-mono)', fontSize: 13 }} value={learner ?? ''} onChange={(e) => setLearner(e.target.value)} disabled={learner === null} />
          <div className="row"><button className="btn small" disabled={learner === null} onClick={async () => { await api.writeFileText('~learner.md', learner ?? ''); useStore.getState().toast('Saved learner profile.'); }}>Save profile</button></div>
        </section>
      </div>
    </div>
  );
}
