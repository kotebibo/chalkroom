// Board player: turns lesson events into an animated, narrated timeline.
// Board state comes from the same reducer the server uses (@chalk/board).
import type { BoardStep, LessonEvent } from '@chalk/schema';
import { applyStep, emptyBoard, splitSentences, type BoardState, type Effect } from '@chalk/board';
import { Speaker } from './speaker';

type Item =
  | { k: 'step'; step: BoardStep }
  | { k: 'say'; text: string }
  | { k: 'mark'; seq: number };

export interface ActiveEffect { key: number; kind: 'highlight' | 'underline' | 'circle' | 'pulse'; ids: string[]; until: number }

const DRAW_MS: Record<string, number> = {
  box: 650, circle: 650, arrow: 560, sticky: 600, formula: 750, code: 900, table: 900,
  chart: 1100, image: 500, path: 600, frame: 600, group: 200,
};

export class Player {
  state: BoardState = emptyBoard();
  /** ids drawn with animation, mapped to their draw duration in ms */
  animate = new Map<string, number>();
  effects: ActiveEffect[] = [];
  caption = '';
  paused = false;
  /** narration speed multiplier for animations (1 = normal) */
  pace = 1;
  /** page the learner is looking at; null follows the tutor */
  viewPage: number | null = null;
  playedSeq = 0;
  readonly speaker = new Speaker();

  private queue: Item[] = [];
  private running = false;
  private listeners = new Set<() => void>();
  private version = 0;
  private fxKey = 0;
  private wakeResume: (() => void) | null = null;
  /** bumped on reset/interrupt so in-flight narration stops */
  private gen = 0;

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  private emit() { this.version++; for (const l of this.listeners) l(); }

  get busy() { return this.running || this.queue.length > 0; }

  reset() {
    this.gen++;
    this.speaker.stop();
    this.queue = [];
    this.state = emptyBoard();
    this.animate.clear();
    this.effects = [];
    this.caption = '';
    this.viewPage = null;
    this.playedSeq = 0;
    this.emit();
  }

  /** Feed one lesson event. live=false applies it instantly (history, catch-up). */
  push(ev: LessonEvent, live: boolean) {
    const items = itemsFor(ev);
    if (!items.length) return;
    if (!live) {
      for (const it of items) this.applyInstant(it);
      this.playedSeq = Math.max(this.playedSeq, ev.seq);
      this.emit();
      return;
    }
    this.queue.push(...items, { k: 'mark', seq: ev.seq });
    void this.run();
  }

  /** Stop narration and jump to the end of everything queued. */
  interrupt() {
    this.gen++;
    this.speaker.stop();
    const rest = this.queue;
    this.queue = [];
    for (const it of rest) this.applyInstant(it);
    this.caption = '';
    this.emit();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.speaker.stop();
    this.emit();
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.emit();
    this.wakeResume?.();
    void this.run();
  }

  setViewPage(i: number | null) { this.viewPage = i; this.emit(); }

  private applyInstant(it: Item) {
    if (it.k === 'step') {
      const r = applyStep(this.state, it.step);
      this.state = r.state;
      if (r.effect.kind === 'draw' || r.effect.kind === 'update') this.animate.delete(r.effect.id);
    } else if (it.k === 'mark') this.playedSeq = Math.max(this.playedSeq, it.seq);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        if (this.paused) await new Promise<void>((r) => { this.wakeResume = r; });
        this.wakeResume = null;
        const it = this.queue.shift()!;
        await this.play(it);
      }
    } finally {
      this.running = false;
      this.caption = '';
      this.emit();
    }
  }

  private sleep(ms: number) { return new Promise((r) => setTimeout(r, ms / this.pace)); }

  private async play(it: Item) {
    if (it.k === 'mark') { this.playedSeq = Math.max(this.playedSeq, it.seq); return; }
    if (it.k === 'say') {
      const sentences = splitSentences(it.text);
      const g = this.gen;
      for (let i = 0; i < sentences.length; i++) {
        this.caption = sentences[i];
        this.emit();
        if (sentences[i + 1]) this.speaker.prefetch(sentences[i + 1]);
        await this.speaker.speak(sentences[i]);
        if (g !== this.gen) return;
        // paused mid-sentence: replay that sentence on resume
        if (this.paused) { this.queue.unshift({ k: 'say', text: sentences.slice(i).join(' ') }); return; }
      }
      return;
    }
    const before = this.state.current;
    const r = applyStep(this.state, it.step);
    this.state = r.state;
    if (this.state.current !== before) this.viewPage = null;
    const e: Effect = r.effect;
    if (e.kind === 'draw' || e.kind === 'update') {
      const shape = this.state.pages[this.state.current].shapes[e.id];
      const ms = (DRAW_MS[shape?.kind ?? ''] ?? Math.min(1200, Math.max(380, (shape?.text?.length ?? 10) * 22))) / this.pace;
      this.animate.set(e.id, ms);
      this.emit();
      await this.sleep(ms * this.pace + 120);
      // drawn: later re-renders (page switches) show it without animating again
      this.animate.delete(e.id);
    } else if (e.kind === 'highlight' || e.kind === 'underline' || e.kind === 'circle' || e.kind === 'pulse') {
      const fx: ActiveEffect = { key: ++this.fxKey, kind: e.kind, ids: e.ids, until: Date.now() + e.seconds * 1000 };
      this.effects = [...this.effects, fx];
      this.emit();
      setTimeout(() => { this.effects = this.effects.filter((x) => x !== fx); this.emit(); }, e.seconds * 1000);
      await this.sleep(e.kind === 'pulse' ? 700 : 450);
    } else if (e.kind === 'say') {
      await this.play({ k: 'say', text: e.text });
    } else if (e.kind === 'wait') {
      await this.sleep(e.seconds * 1000);
    } else {
      this.emit();
      await this.sleep(e.kind === 'camera' ? 800 : e.kind === 'error' ? 0 : 250);
    }
  }
}

function itemsFor(ev: LessonEvent): Item[] {
  const d = ev.data as any;
  switch (ev.kind) {
    case 'board_run': {
      const steps: BoardStep[] = Array.isArray(d?.steps) ? d.steps : [];
      const pre: Item[] = d?.page ? [{ k: 'step', step: { page: { title: d.page } } }] : [];
      return [...pre, ...steps.map((s): Item => ('say' in s ? { k: 'say', text: (s as { say: string }).say } : { k: 'step', step: s }))];
    }
    case 'board_clear': return [{ k: 'step', step: { clear: true } }];
    case 'board_page': return [{ k: 'step', step: { page: { title: d?.title } } }];
    case 'speak': return d?.text ? [{ k: 'say', text: d.text }] : [];
    case 'draw': return d?.shape ? [{ k: 'step', step: { add: { ...d.shape, user: true } } as BoardStep }] : [];
    case 'erase': return d?.ids ? [{ k: 'step', step: { remove: d.ids } }] : [];
    default: return [];
  }
}

/** Narration text of an event, for transcripts and chat. */
export function narrationOf(ev: LessonEvent): string | null {
  const d = ev.data as any;
  if (ev.kind === 'speak') return d?.text ?? null;
  if (ev.kind === 'board_run' && Array.isArray(d?.steps)) {
    const says = d.steps.filter((s: any) => typeof s.say === 'string').map((s: any) => s.say);
    return says.length ? says.join(' ') : null;
  }
  return null;
}
