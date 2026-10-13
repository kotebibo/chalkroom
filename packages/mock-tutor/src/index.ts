// A scripted fake Claude. It reacts to envelopes by calling the real Chalk tools,
// so UI work and end-to-end tests need no Claude usage.
import type { Envelope } from '@chalk/schema';

export type CallTool = (name: string, args: Record<string, unknown>) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const parse = (r: Awaited<ReturnType<CallTool>>) => { try { return JSON.parse(r.content[0]?.text ?? '{}'); } catch { return {}; } };

export interface MockOptions { delayMs?: number; log?: (...a: unknown[]) => void }

export class MockTutor {
  private segment = 0;
  private topic = 'pdas';
  private busy = Promise.resolve();
  constructor(private call: CallTool, private opts: MockOptions = {}) {}

  /** Envelopes are handled one at a time, like a real session. */
  handle(envs: Envelope[]) {
    this.busy = this.busy.then(async () => {
      for (const env of envs) {
        try { await this.one(env); } catch (e) { this.opts.log?.('mock tutor error', e); }
      }
    });
    return this.busy;
  }

  private async t(name: string, args: Record<string, unknown> = {}) {
    await sleep(this.opts.delayMs ?? 250);
    const r = await this.call(name, args);
    if (r.isError) this.opts.log?.(`mock ${name} error:`, r.content[0]?.text);
    // honour input handed over in a tool result, like the real tutor skill says
    const extra = r.content.slice(1).map((c) => { try { return JSON.parse(c.text ?? ''); } catch { return null; } }).find((x) => x?.userInput);
    if (extra) {
      for (const env of extra.userInput as Envelope[]) await this.one(env);
      throw new Interrupted();
    }
    return parse(r);
  }

  private async one(env: Envelope) {
    try {
      await this.dispatch(env);
    } catch (e) {
      if (!(e instanceof Interrupted)) throw e;
    }
  }

  private async dispatch(env: Envelope) {
    const d = (env.data ?? {}) as Record<string, any>;
    switch (env.type) {
      case 'heartbeat':
        await this.t('lesson_ack');
        return void (await this.t('lesson_yield', { prompt: 'Pick a topic to start' }));

      case 'start_lesson': {
        this.topic = env.topic ?? 'pdas';
        this.segment = 0;
        const r = await this.t('lesson_start', { topicId: this.topic, mode: env.mode ?? 'lecture' });
        if (r.resumed) await this.t('speak', { text: 'Welcome back. Last time we sketched how a PDA is derived. Let us pick up from there.' });
        await this.teachSegment();
        return void (await this.t('lesson_yield', { prompt: 'Answer the check, or ask anything' }));
      }

      case 'next':
        this.segment++;
        await this.teachSegment();
        return void (await this.t('lesson_yield', { prompt: 'Ready for more?' }));

      case 'repeat':
      case 'slower':
        await this.t('speak', { text: env.type === 'slower' ? 'Let me slow down. One idea at a time.' : 'Once more, from the top of this step.' });
        await this.teachSegment();
        return void (await this.t('lesson_yield'));

      case 'check_answer': {
        const ok = d.correct === true;
        await this.t('board_run', { steps: [{ highlight: 'pda', for: 1.5 }, { say: ok ? 'Exactly right. No private key exists for a PDA.' : 'Not quite. Remember: a PDA sits off the curve, so no private key exists.' }] });
        if (!ok) await this.t('progress_update', { topicId: this.topic, misconception: 'Thought a PDA has a private key', reason: 'wrong inline check answer' });
        await this.t('progress_update', { topicId: this.topic, delta: ok ? 0.15 : -0.05, reason: `inline check ${ok ? 'correct' : 'wrong'}` });
        return void (await this.t('lesson_yield', { prompt: 'Press Next to continue' }));
      }

      case 'question':
      case 'explain_selection': {
        const sel = (env.context?.boardSelection as string[] | undefined) ?? [];
        const steps: unknown[] = [];
        if (sel.length) steps.push({ circle: sel, for: 2 });
        steps.push({ say: env.text ? `Good question: ${env.text}` : 'Let me explain the part you selected.' });
        steps.push({ say: 'In short, the program, not a person, is the only thing that can authorise this account.' });
        await this.t('board_run', { steps });
        await this.t('chat_say', { markdown: `**(mock tutor)** You asked: _${env.text ?? 'about the selection'}_.\n\nA PDA is derived with $\\text{hash}(seeds, programId, bump)$ and has no private key [[res:sample#p1]].` });
        return void (await this.t('lesson_yield', { prompt: 'Shall I continue?' }));
      }

      case 'quiz_submit': {
        const grades = (d.toGrade ?? []).map((q: any) => ({
          questionId: q.questionId,
          score: String(q.answer ?? '').length > 25 ? 0.8 : 0.3,
          feedback: String(q.answer ?? '').length > 25 ? 'Solid explanation; mention the bump explicitly.' : 'Too short: explain *why* there is no private key.',
        }));
        await this.t('quiz_grade', { quizId: d.quizId, attemptId: d.attemptId, grades });
        await this.t('chat_say', { markdown: 'Graded. Review the feedback in the Quiz tab; I can turn misses into flashcards.' });
        return void (await this.t('lesson_yield'));
      }

      case 'make_flashcards':
        await this.t('cards_propose', {
          cards: [
            { front: 'What is a PDA?', back: 'An address derived from seeds + program id that lies off the ed25519 curve, so it has no private key.', topic: this.topic },
            { front: 'A PDA is found by hashing seeds, the program id and a {{c1::bump}}.', topic: this.topic },
            { front: 'Who can sign for a PDA?', back: 'Only the program that derived it, via invoke_signed.', topic: this.topic },
          ],
        });
        return void (await this.t('lesson_yield', { prompt: 'Review the proposed cards' }));

      case 'feynman_submit':
        await this.t('chat_say', { markdown: '**Feedback on your explanation**\n\n- ✅ You said PDAs are derived from seeds.\n- ⚠️ You did not say why there is no private key (off-curve).\n- ❌ Programs sign with `invoke_signed`, not with a keypair.' });
        return void (await this.t('lesson_yield'));

      case 'resource_added': {
        const r = await this.t('kb_search', { query: 'the', limit: 1, resourceId: d.resourceId });
        await this.t('kb_index', { resourceId: d.resourceId, summary: `Mock summary of ${d.title} (${d.chunks} chunks). First match: ${r.results?.[0]?.snippet ?? 'n/a'}`, concepts: ['mock concept'] });
        await this.t('chat_say', { markdown: `Indexed **${d.title}**. I can build syllabus topics from it.` });
        return void (await this.t('lesson_yield'));
      }

      case 'review_due': {
        const p = await this.t('progress_get', {});
        await this.t('chat_say', { markdown: `You have ${p.flashcards?.due ?? 0} cards due. Weakest topics: ${(p.topics ?? []).sort((a: any, b: any) => a.mastery - b.mastery).slice(0, 2).map((x: any) => x.title).join(', ') || 'none yet'}.` });
        return void (await this.t('lesson_yield'));
      }

      default:
        return void (await this.t('lesson_yield'));
    }
  }

  private async teachSegment() {
    const s = this.segment % 3;
    if (s === 0) {
      await this.t('board_run', {
        page: 'What is a PDA?',
        steps: [
          { add: { id: 'title', kind: 'text', text: 'Program Derived Addresses', at: [5.5, 0.4], style: 'accent' } },
          { add: { id: 'wallet', kind: 'box', text: 'Wallet\n(has a key)', at: [1.5, 2] } },
          { say: 'Normal accounts are owned by a keypair. Whoever holds the private key can sign.' },
          { add: { id: 'program', kind: 'box', text: 'Program', at: [5.5, 2] } },
          { add: { id: 'pda', kind: 'circle', text: 'PDA', at: [9.5, 2], style: 'accent' } },
          { add: { id: 'e1', kind: 'arrow', from: 'program', to: 'pda', label: 'seeds + bump' } },
          { say: 'A PDA is derived from seeds and the program id. It is not generated from a keypair.' },
          { write: { id: 'f1', latex: '\\text{PDA} = H(\\text{seeds}, \\text{programId}, \\text{bump})', at: [5.5, 4.2] } },
          { highlight: 'pda', for: 2 },
          { say: 'Because the result lies off the curve, no private key exists for it.' },
          { add: { id: 'note', kind: 'sticky', text: 'Only the program can sign for its PDA', at: [9.5, 5.2] } },
        ],
      });
      await this.t('check_ask', { question: { type: 'mcq', prompt: 'Who can sign for a PDA?', options: ['Anyone with its private key', 'Only the program that derived it', 'The wallet that paid for it'], answer: 1, explanation: 'There is no private key; the program signs with invoke_signed.' } });
    } else if (s === 1) {
      await this.t('board_run', {
        page: 'Finding the bump',
        steps: [
          { add: { id: 'code1', kind: 'code', lang: 'rust', code: 'let (pda, bump) = Pubkey::find_program_address(\n    &[b"vault", user.key().as_ref()],\n    program_id,\n);', at: [4, 2] } },
          { say: 'find program address tries bump 255, then 254, and so on, until the hash lands off the curve.' },
          { add: { id: 'tbl', kind: 'table', rows: [['bump', 'on curve?'], ['255', 'yes'], ['254', 'yes'], ['253', 'no ✓']], at: [9.5, 2.2] } },
          { underline: 'tbl' },
          { add: { id: 'ch', kind: 'chart', chart: { type: 'bar', data: [{ x: '1st', y: 50 }, { x: '2nd', y: 25 }, { x: '3rd', y: 12.5 }, { x: '4th+', y: 12.5 }], yLabel: '% found' }, at: [4, 5.6] } },
          { say: 'About half the time the very first try works.' },
        ],
      });
    } else {
      await this.t('board_run', {
        page: 'Signing with invoke_signed',
        steps: [
          { mermaid: { id: 'seq', code: 'sequenceDiagram\n  participant P as Program\n  participant R as Runtime\n  participant T as Token program\n  P->>R: invoke_signed(ix, seeds)\n  R->>R: re-derive PDA from seeds\n  R->>T: ix with PDA as signer', at: [5.5, 3.5], size: [8, 5] } },
          { say: 'The runtime re-derives the address from the seeds. If it matches, the PDA counts as a signer.' },
        ],
      });
      await this.t('quiz_create', {
        title: 'PDAs — quick quiz', topic: this.topic,
        questions: [
          { type: 'mcq', prompt: 'What makes a PDA different from a normal address?', options: ['It is longer', 'It lies off the ed25519 curve', 'It is stored on-chain'], answer: 1, explanation: 'Off-curve means no private key.' },
          { type: 'tf', prompt: 'A PDA has a private key that the program stores.', answer: false, justify: true },
          { type: 'numeric', prompt: 'What is the highest bump value tried first?', answer: 255 },
          { type: 'blank', prompt: 'Programs sign for PDAs with invoke____.', answer: 'signed', accept: ['_signed', 'signed'] },
          { type: 'order', prompt: 'Order the derivation steps', options: ['Hash seeds + program id + bump', 'Start with bump 255', 'Check if on curve', 'Decrement bump and retry'], answer: [1, 0, 2, 3] },
          { type: 'short', prompt: 'Explain in your own words why a PDA cannot sign by itself.', rubric: 'Mentions no private key / off-curve; program signs via invoke_signed.' },
        ],
      });
    }
  }
}

class Interrupted extends Error {}
