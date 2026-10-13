// Turn manager: decides how user input reaches Claude.
//
// Channel events never interrupt a running turn; they queue until it ends.
// So while Claude is busy we hold input and hand it over in the result of
// Claude's next Chalk tool call. When Claude is idle we push a channel event.
import type { Envelope, ConnectionState } from '@chalk/schema';

export type Deliver = (envelopes: Envelope[]) => Promise<void> | void;

export interface TurnOptions {
  deliver: Deliver;
  onState: (s: ConnectionState) => void;
  onDelivered?: (via: 'channel' | 'tool', count: number) => void;
  idleAfterMs?: number;
  ackTimeoutMs?: number;
}

export class TurnManager {
  busy = false;
  private held: Envelope[] = [];
  private lastActivity = 0;
  private timer: NodeJS.Timeout;
  private ackTimer: NodeJS.Timeout | null = null;
  private connection: ConnectionState = 'checking';
  private opts: Required<Omit<TurnOptions, 'onDelivered'>> & Pick<TurnOptions, 'onDelivered'>;

  constructor(opts: TurnOptions) {
    this.opts = { idleAfterMs: 30_000, ackTimeoutMs: 45_000, ...opts };
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref?.();
  }

  get state(): ConnectionState {
    if (this.connection === 'connected' && this.busy) return 'thinking';
    return this.connection;
  }

  setConnection(c: ConnectionState) {
    const before = this.state;
    this.connection = c;
    if (this.state !== before) this.opts.onState(this.state);
  }

  private setBusy(b: boolean) {
    const before = this.state;
    this.busy = b;
    if (b) this.lastActivity = Date.now();
    if (this.state !== before) this.opts.onState(this.state);
  }

  /** Send a heartbeat and wait for lesson_ack; fall back to terminal mode. */
  async heartbeat() {
    this.setConnection('checking');
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = setTimeout(() => { if (this.connection === 'checking') this.setConnection('terminal'); }, this.opts.ackTimeoutMs);
    this.ackTimer.unref?.();
    await this.opts.deliver([{ chalk: 1, type: 'heartbeat', text: 'Chalk UI is open. Call lesson_ack (no arguments) to confirm the channel works, then wait for input.' }]);
  }

  ack() {
    if (this.ackTimer) { clearTimeout(this.ackTimer); this.ackTimer = null; }
    this.setConnection('connected');
  }

  /** New input from the browser. */
  async submit(env: Envelope) {
    if (this.busy) {
      this.held.push(env);
      return 'held' as const;
    }
    this.setBusy(true);
    await this.opts.deliver([env]);
    this.opts.onDelivered?.('channel', 1);
    return 'sent' as const;
  }

  /** Called at the start of every Chalk tool call. Returns held input to attach to the result. */
  toolActivity(): Envelope[] {
    if (this.connection === 'terminal' || this.connection === 'checking') this.ack();
    this.setBusy(true);
    return this.take();
  }

  /** lesson_yield: Claude says its turn is done. Returns held input, if any, so Claude handles it now. */
  yieldTurn(): Envelope[] {
    const held = this.take();
    if (!held.length) this.setBusy(false);
    else this.lastActivity = Date.now();
    return held;
  }

  private take(via: 'channel' | 'tool' = 'tool'): Envelope[] {
    if (!this.held.length) return [];
    const out = this.held;
    this.held = [];
    this.opts.onDelivered?.(via, out.length);
    return out;
  }

  get pending() { return this.held.length; }

  private tick() {
    if (!this.busy || Date.now() - this.lastActivity < this.opts.idleAfterMs) return;
    // Claude went quiet without yielding: treat the turn as over and flush held input
    // as a channel event (which Claude Code queues until the session is free).
    this.setBusy(false);
    if (this.held.length) {
      const out = this.take('channel');
      this.setBusy(true);
      Promise.resolve(this.opts.deliver(out)).catch(() => {});
    }
  }

  dispose() { clearInterval(this.timer); if (this.ackTimer) clearTimeout(this.ackTimer); }
}
