// Text-to-speech. The browser's Web Speech API is the default; OpenAI and
// ElevenLabs are synthesised by the Chalk server with the user's own keys.

export interface VoiceSettings {
  provider: 'browser' | 'openai' | 'elevenlabs';
  voice: string; // browser voiceURI or provider voice id
  rate: number; // 0.75 – 2
  muted: boolean;
  textOnly: boolean;
  lang: string;
}

const readingMs = (text: string, rate: number) => Math.max(1200, (text.split(/\s+/).length / 2.7) * 1000 / rate);

export class Speaker {
  settings: VoiceSettings = { provider: 'browser', voice: '', rate: 1, muted: false, textOnly: false, lang: 'en' };
  private stopFns = new Set<() => void>();
  private audioCache = new Map<string, Promise<string>>();
  private generation = 0;

  get silent() { return this.settings.muted || this.settings.textOnly; }

  /** Speak one sentence. Resolves when it ends, or when stop() is called. */
  speak(text: string): Promise<void> {
    const gen = this.generation;
    if (this.silent || !text.trim()) return this.wait(readingMs(text, this.settings.rate));
    const p = this.settings.provider === 'browser' ? this.speakBrowser(text) : this.speakServer(text).catch((e) => {
      console.warn('TTS provider failed, using browser voice', e);
      return gen === this.generation ? this.speakBrowser(text) : undefined;
    });
    return p;
  }

  /** Warm the cache for the next sentence so playback has no gaps. */
  prefetch(text: string) {
    if (this.silent || this.settings.provider === 'browser') return;
    void this.fetchAudio(text).catch(() => {});
  }

  stop() {
    this.generation++;
    for (const f of [...this.stopFns]) f();
    this.stopFns.clear();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(done, ms);
      const self = this;
      function done() { clearTimeout(t); self.stopFns.delete(done); resolve(); }
      this.stopFns.add(done);
    });
  }

  private speakBrowser(text: string): Promise<void> {
    if (!('speechSynthesis' in window)) return this.wait(readingMs(text, this.settings.rate));
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const v = voices.find((x) => x.voiceURI === this.settings.voice)
        ?? voices.find((x) => x.lang.toLowerCase().startsWith(this.settings.lang.toLowerCase()) && x.localService)
        ?? voices.find((x) => x.lang.toLowerCase().startsWith(this.settings.lang.toLowerCase()));
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = this.settings.lang;
      u.rate = this.settings.rate;
      let finished = false;
      // some engines never fire onend; never block the lesson on that
      const guard = setTimeout(() => done(), readingMs(text, this.settings.rate) * 2.2 + 2500);
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(guard);
        this.stopFns.delete(done);
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      this.stopFns.add(done);
      window.speechSynthesis.speak(u);
    });
  }

  private fetchAudio(text: string): Promise<string> {
    const key = `${this.settings.provider}|${this.settings.voice}|${text}`;
    let p = this.audioCache.get(key);
    if (!p) {
      p = fetch('./api/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, provider: this.settings.provider, voice: this.settings.voice || undefined }),
      }).then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `TTS ${r.status}`);
        return URL.createObjectURL(await r.blob());
      });
      p.catch(() => this.audioCache.delete(key));
      this.audioCache.set(key, p);
      if (this.audioCache.size > 200) this.audioCache.delete(this.audioCache.keys().next().value!);
    }
    return p;
  }

  private async speakServer(text: string): Promise<void> {
    const gen = this.generation;
    const url = await this.fetchAudio(text);
    if (gen !== this.generation) return;
    await new Promise<void>((resolve) => {
      const audio = new Audio(url);
      audio.playbackRate = this.settings.rate;
      const done = () => { audio.pause(); this.stopFns.delete(done); resolve(); };
      audio.onended = done;
      audio.onerror = done;
      this.stopFns.add(done);
      audio.play().catch(done);
    });
  }
}

export function listBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  const v = window.speechSynthesis.getVoices();
  if (v.length) return Promise.resolve(v);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1500);
    window.speechSynthesis.onvoiceschanged = () => { clearTimeout(t); resolve(window.speechSynthesis.getVoices()); };
  });
}
