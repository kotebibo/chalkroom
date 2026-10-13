---
name: chalk-cards
description: Flashcard-writing rules for Chalk (cards_propose / cards_add) — basic, reverse and cloze cards for spaced repetition. Use before proposing flashcards from a lesson, a resource, a board selection or quiz misses.
---

# Writing Chalk flashcards

Reviews run in the browser with FSRS scheduling and never involve you, so each card must stand
on its own months later, without the lesson around it.

```json
{ "cards": [
  { "front": "Why does a PDA have no private key?", "back": "It is derived to lie off the ed25519 curve, so no keypair corresponds to it.", "topic": "pdas", "source": "res:solana-book#p42" },
  { "front": "find_program_address starts with bump {{c1::255}} and counts down.", "topic": "pdas" },
  { "type": "reverse", "front": "invoke_signed", "back": "CPI where the calling program signs for its PDA with the seeds", "topic": "cpi" }
] }
```

- `type`: `basic` (default), `reverse` (also asked back→front), `cloze` (front contains
  `{{c1::hidden}}` or `{{c1::hidden::hint}}`; no back needed).
- Always set `topic` (syllabus id). Set `source` when it came from a resource.

## Rules

- **One fact per card.** Split lists into separate cards or use several clozes.
- **Unambiguous front.** Only one correct answer should come to mind. Add context words
  ("In Solana, …") when the term is overloaded.
- **Cloze for definitions and key numbers;** basic Q→A for "why/how" questions.
- **Short backs:** ≤ 25 words. The "why" matters more than the "what".
- No yes/no questions, no "list all…" cards, no cards that depend on a diagram the learner
  won't see (describe it in words, or skip it).
- Prefer the learner's own misconceptions as cards (from `progress_get`).
- 5–15 cards per lesson. Propose (`cards_propose`); use `cards_add` only for cards the learner
  explicitly approved in chat.
