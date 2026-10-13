// Speech input with the browser's speech recognition (Chrome, Edge, Safari).
type Rec = {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: any) => void) | null; onend: (() => void) | null; onerror: ((e: any) => void) | null;
  start(): void; stop(): void; abort(): void;
};

const Ctor: (new () => Rec) | undefined = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const sttSupported = !!Ctor;

export class Listener {
  private rec: Rec | null = null;
  private finalText = '';

  start(lang: string, onText: (text: string, final: boolean) => void, onEnd: (text: string) => void) {
    if (!Ctor) throw new Error('Speech input is not supported in this browser. Try Chrome or Edge.');
    this.stop();
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true;
    this.finalText = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.finalText += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      onText((this.finalText + interim).trim(), !interim);
    };
    rec.onerror = () => {};
    rec.onend = () => { if (this.rec === rec) { this.rec = null; onEnd(this.finalText.trim()); } };
    rec.start();
    this.rec = rec;
  }

  stop() { this.rec?.stop(); }
  get active() { return !!this.rec; }
}
