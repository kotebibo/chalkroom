# Chalkroom — AI Classroom for Claude Code

Design document · rev 2 · Oct 13, 2026 · @GeoSafety

## Changes from rev 1

| # | Problem in rev 1 | Fix |
|---|---|---|
| 1 | Tool names used dots (`board.run`). Claude tool names must match `^[a-zA-Z0-9_-]{1,64}$`. | All tools use `snake_case` (`board_run`, `chat_say`, …). In a session they appear as `mcp__plugin_chalkroom_chalk__board_run`. |
| 2 | `check.ask` "waits for the answer", which broke "tool results return quickly" and would hit MCP tool timeouts. | `check_ask` returns at once with a `checkId`. The answer comes back later as a `check_answer` envelope. |
| 3 | The rules for writing the learner model contradicted each other: "only through `progress.*`" vs "Claude may edit Markdown directly". | Everything under `progress/` is written **only** by `progress_*` tools, and every change is audited. Claude may edit `learner.md`, `syllabus.md`, `plan.md` and `notes.md` directly. |
| 4 | The roadmap referred to phases it never listed. | Phases are listed under [Roadmap](#roadmap). |
| 5 | Interrupts assumed a channel event can cut into a running turn. Per the channels reference, events **queue** and arrive together on the next turn. | Interrupts are delivered **in tool results**. While Claude is busy, input is held by the server and attached to the next Chalk tool result (`board_run`, `speak`, `lesson_yield`, …). The UI stops audio and playback locally at once. See [Turn rules](#turn-rules). |
| 6 | The whiteboard was tldraw, described as "MIT-friendly". The tldraw SDK is under its own licence and needs a licence key in production, which an MIT open-source tool cannot assume. | Chalk has its own SVG board renderer, drawn in a hand-drawn style with rough.js (MIT). This also gives exact control over draw-on animation timed to narration. Excalidraw (MIT) is the fallback if richer free-form editing is needed. |
| 7 | "The plugin ships an allowlist" for its tools. Plugins cannot declare a permission allowlist. | Each course template ships `.claude/settings.json` with `permissions.allow: ["mcp__plugin_chalkroom_chalk"]`. Claude runs in the course folder, so the project setting applies. |
| 8 | Install said `--channels plugin:chalk`. Third-party channels need the plugin@marketplace form, plus the development flag until the plugin is allowlisted. | `claude --dangerously-load-development-channels plugin:chalkroom@chalkroom`, wrapped by `chalkroom start`. When Chalk is approved, switch to `--channels plugin:chalkroom@chalkroom`. |
| 9 | The plugin installs from git but needs Node dependencies at runtime. | The server is bundled with esbuild into one file (`dist/server.mjs`) and the UI is prebuilt into `dist/web/`. Both are committed, so installing needs no `npm install`. |
| 10 | "Chalk" was a working name; npm `chalk` is the well-known terminal-colour library. | Published as **Chalkroom**: npm package and CLI `chalkroom`, plugin `chalkroom@chalkroom`, default library `~/chalkroom`. The internal MCP server key stays `chalk`, so tools are `mcp__plugin_chalkroom_chalk__*` and the channel tag is `<channel source="chalk">`. The rest of this document says "Chalk" for short. |

## Overview

Chalk turns a user's own Claude Code session into a live tutor with a whiteboard, voice, quizzes, flashcards and a course library. It ships as an open-source Claude Code plugin plus a local web UI. Nothing is hosted, and Chalk has no accounts or auth of its own.

## Goals

- Teach any topic visually: Claude draws, animates and narrates on a whiteboard while explaining.
- Keep every course as plain files in a folder the user owns, readable by both the user and Claude.
- Ground teaching in resources the user adds (PDFs, docs, links, code), with citations.
- Make retention part of the product: tests, flashcards with spaced repetition, and a learner model.
- Run on the user's existing Claude subscription through normal Claude Code use, with no setup beyond install.

## Non-goals

- No hosted service, user accounts, telemetry or sync server.
- No direct Anthropic API calls made by Chalk on the user's behalf.
- Not a general LMS: no classes, teachers, institutional grading or multi-user rooms (v1).
- Not a replacement for Claude Code's terminal; the terminal stays usable alongside the UI.

## Principles and constraints

The user runs Claude Code themselves; Chalk only gives that session tools and a screen.

1. **The user's session is the brain.** Chalk never spawns `claude -p`, never uses the Agent SDK, and never reads or stores Claude credentials. Anthropic does not permit third-party developers to offer Claude.ai login or route requests through Free, Pro or Max credentials on users' behalf.
2. **Local only.** Every process binds to `127.0.0.1`. The UI is served by the plugin's MCP server on the user's machine.
3. **Files are the database.** Courses are folders of Markdown and JSON. Users can edit them by hand, commit them to git, or share a course as a zip.
4. **Claude is called only when thinking is needed.** Flashcard reviews, scheduling, playback, navigation and objective grading run in the browser. Claude is invoked to teach, create, explain or grade free text.
5. **Degrade gracefully.** Without channels (unsupported auth, older Claude Code, disabled by admin) Chalk falls back to terminal mode: the user chats in the terminal and the board still renders.
6. **Optional extras bring their own keys.** Premium TTS or STT keys live in the library's local `.env`; the default path needs no key.
7. **Open source**, MIT licence, with a stable file format so third-party tools can read courses. All runtime dependencies are MIT/BSD/Apache.

## System architecture

Four parts, all local: browser UI, Chalk server, the user's Claude Code session, and the course folder. The browser never talks to Claude directly.

- **Chalk server**: launched by Claude Code as the plugin's MCP server (stdio). On start it opens an HTTP + WebSocket server on `127.0.0.1:4747`, or the next free port.
- **Claude Code session**: started by the user in a course folder with the Chalk channel enabled. It loads the tutor skills and the course `CLAUDE.md`.
- **Browser UI**: connects over WebSocket. It renders the board, plays audio, runs quizzes and reviews, and sends user input upstream.
- **Course folder**: shared state. The server and Claude both read and write it, and a file watcher keeps the UI in sync.

One Claude Code session serves one course. A second course starts a second session on another port.

### Request routing

Inbound: browser → Chalk server → (tool result **or** channel notification) → session. Outbound: Claude → MCP tool call → Chalk server → browser.

#### Inbound: browser to Claude

Chalk declares `capabilities.experimental['claude/channel']` and pushes `notifications/claude/channel` with `content` = the JSON envelope and `meta` = `{ type, lesson }`. Claude sees `<channel source="chalk" type="question" lesson="03-pdas">{…}</channel>`.

```json
{
  "chalk": 1,
  "type": "question",
  "lesson": "03-pdas",
  "text": "Why can't a PDA sign?",
  "interrupt": true,
  "context": { "boardSelection": ["pda"], "atStep": 14, "speaking": true }
}
```

| Type | Sent when | Expected Claude behaviour |
|---|---|---|
| `start_lesson` | User picks a topic or presses Start | Read syllabus and learner model, plan, begin teaching |
| `next` / `repeat` / `slower` | Lesson controls | Continue, re-explain, or simplify the last step |
| `question` | Typed or spoken question | Answer in context, then resume the lesson |
| `explain_selection` | User lassos part of the board | Explain the selected shapes |
| `check_answer` | User answers an inline check | Confirm, or re-explain from a different angle |
| `quiz_submit` | User finishes a test | Grade free-text items with `quiz_grade`, update the learner model |
| `feynman_submit` | User explains a concept back | Critique gaps and misconceptions |
| `make_flashcards` | User asks, or lesson ends | `cards_propose` from the lesson or a resource |
| `resource_added` | File dropped into Resources | Read extracted text, `kb_index` a summary, propose syllabus changes |
| `review_due` | Daily review opened | Short session on weak topics |
| `ui_state` | On reconnect | Re-sync what the board shows |
| `draft_syllabus` | New course, or "Draft syllabus" pressed | Load chalk-course; write syllabus.md from the goal and resources |
| `quiz_request` | "Quiz me", retake, or placement check | `quiz_create` (a retake asks new questions on the same objectives) |
| `heartbeat` | Session start | Call `lesson_ack` |

#### Outbound: Claude to browser

Claude calls Chalk's MCP tools. The server validates each call (Zod), appends it to the lesson's `events.jsonl`, and broadcasts it over WebSocket. Tool results return immediately as `{ ok, … }`, and playback is queued in the browser, so Claude is never blocked by animation time.

### Turn rules

- **Busy vs idle.** The server marks the session busy when it delivers an envelope, or when Claude calls any Chalk tool. It marks it idle when Claude calls `lesson_yield`, or after 30 s with no tool activity.
- **Delivery while idle:** a channel notification.
- **Delivery while busy:** channel notifications would only queue until the turn ends, so the server holds new input and attaches it to the result of Claude's next Chalk tool call as `"userInput": [envelope…]`. The tutor skill tells Claude to stop the current explanation at once, handle the input, then offer to resume. `lesson_yield` also returns any held input, so Claude answers instead of ending the turn. Input still held when the session goes idle is flushed as a channel notification.
- **Local interrupt.** A question while busy stops TTS and pauses board playback in the browser immediately, whatever Claude is doing.
- **Debounce and batch.** Flashcard flips, scrolling and navigation never reach Claude. Inputs within 1.5 s of each other merge into one envelope.
- **Replies always go through tools.** Claude speaks with `speak` and writes chat with `chat_say`. Plain terminal text is not shown in the UI.

### Fallback: terminal mode

At session start the server pushes a `heartbeat` and waits up to 45 s for `lesson_ack`. Without it, the UI shows an amber "Terminal mode" banner. The user types in the terminal, and Claude still calls board and voice tools, so the classroom still renders. Input typed in the UI is shown with a "copy to terminal" button. A later `lesson_ack` switches back to Connected.

## Course file system

A course is one folder, and Claude Code runs with it as its working directory. A library is a parent folder holding many courses plus a global learner profile.

```
~/chalkroom/                         ← library root (CHALK_HOME)
  learner.md                     ← global: goals, background, preferred style
  settings.json                  ← voice, theme, daily review time
  .env                           ← optional provider keys
  courses/
    solana-dev/
      CLAUDE.md                  ← tutor instructions for this course
      .claude/settings.json      ← allows Chalk's MCP tools without prompts
      course.json                ← title, level, goal, language, created, version
      syllabus.md                ← topic tree with status markers
      resources/
        index.json               ← every resource: id, type, title, source, role, summary
        files/                   ← PDFs, docs, images, code the user added
        links.md                 ← URLs with notes
        extracted/<id>/          ← chunk files (page or section), Markdown
      lessons/
        03-pdas/
          plan.md                ← Claude's lesson plan
          notes.md               ← final notes for the user
          events.jsonl           ← every board/speak/chat/user event, replayable
          assets/                ← images, exported board SVG/PNG
      quizzes/
        2026-10-13-pdas.json     ← questions, answer key, attempts, grades
      flashcards/
        deck.json                ← cards + FSRS state
      progress/
        mastery.json             ← per-topic mastery + history
        misconceptions.md        ← things the learner got wrong, with dates
        sessions.jsonl           ← one line per session
        changes.jsonl            ← audit log of every progress_* write
```

### Key formats

`syllabus.md`:

```markdown
# Solana development
- [x] Accounts model             <!-- id: accounts, mastery: 0.82 -->
- [~] Program Derived Addresses  <!-- id: pdas, lesson: 03-pdas, needs: accounts -->
- [ ] Cross-program invocation   <!-- id: cpi, needs: pdas -->
```

`[x]` covered, `[~]` in progress, `[ ]` to cover, `[!]` needs review. `needs:` lists prerequisite ids separated by spaces.

`events.jsonl`: one `{ seq, t, source: tutor|user|system, kind, data }` per line. Replay, export and resume all read it.

`deck.json`: `{ schema: 1, cards: [{ id, type, front, back, topic, source, status, created, fsrs }] }`. `fsrs` is the ts-fsrs card state.

### Rules

- **Who writes what.** Chalk's tools write JSON and logs. Claude may edit `learner.md`, `syllabus.md`, `plan.md` and `notes.md` directly with its file tools. Everything under `progress/` is written only by `progress_update`, which logs the reason to `changes.jsonl`.
- Every JSON file carries `"schema": n` for migrations.
- The server watches the folder and live-reloads the UI when files change on disk.

## Whiteboard

Claude never writes canvas code. It emits **Board Script**, a small declarative scene language. The browser renders it with Chalk's own SVG renderer (rough.js strokes, chalkboard theme) and plays it in sync with narration.

```json
{ "steps": [
  { "add": { "id": "wallet", "kind": "box", "text": "Wallet", "at": [1, 1] } },
  { "add": { "id": "pda", "kind": "box", "text": "PDA", "at": [4, 1], "style": "accent" } },
  { "add": { "id": "e1", "kind": "arrow", "from": "wallet", "to": "pda", "label": "seeds + program id" } },
  { "say": "A PDA is derived, not generated, so no private key exists." },
  { "highlight": "pda", "for": 2 },
  { "write": { "id": "f1", "latex": "PDA = H(seeds, programId, bump)", "at": [2, 3] } }
] }
```

- **Grid layout.** `at: [col, row]` on a 12 × 8 grid, with fractions allowed. An auto-layout pass nudges overlapping shapes apart.
- **Primitives:** box, circle, arrow, text, sticky, formula (KaTeX), code, image, table, chart (bar/line), path, group, frame, and Mermaid diagrams.
- **Actions:** add, write, update, remove, move, highlight, underline, circle, pulse, fade, camera, clear, page, say, wait.
- **Sync with speech.** A `say` step blocks the timeline until TTS finishes that sentence. Shapes draw on stroke by stroke.
- **Stable ids.** Shapes keep Claude's ids. The user's selection maps back to ids.
- **User interaction:** pen annotations (logged as user events), click or drag to select shapes, then "Ask about this" sends `explain_selection` with the ids and their text. A page strip shows each page. Pages export to SVG and PNG.

## Voice

| TTS provider | Setup | Notes |
|---|---|---|
| Browser Web Speech API | none (default) | Free, offline on most OSes |
| OpenAI TTS | `OPENAI_API_KEY` in `.env` | Synthesised by the server, cached per lesson |
| ElevenLabs | `ELEVENLABS_API_KEY` in `.env` | Synthesised by the server, cached per lesson |
| Piper | local binary path in settings | v1.1 |

- `speak` text is split into sentences and queued, so audio starts at once. Captions show the current sentence.
- Controls: mute, speed (0.75×–2×), voice picker, text-only mode.
- Speech input: browser speech recognition (default, Chrome/Edge) with push-to-talk (hold Space when not typing, or the mic button). whisper.cpp and OpenAI transcription are v1.1.
- Speaking or typing while the tutor talks stops TTS and sends an interrupting question.
- Language is per course (`course.json` → `language`).

## Lessons and teaching modes

Loop: **plan → teach in short segments → check → record**.

1. **Plan.** `lesson_start` creates `lessons/NN-topic/`. Claude reads the syllabus, `progress_get` and resources, then writes `plan.md`.
2. **Teach.** 2–4 minute segments, each a `board_run` with `say` steps, ending in `check_ask`.
3. **Check.** A wrong `check_answer` triggers re-explanation from a different angle.
4. **Wrap up.** Claude writes `notes.md`, calls `cards_propose`, `syllabus_update`, `progress_update`, then `lesson_end`.
5. **Resume.** `lesson_start` on a topic with an existing lesson returns a short summary of the last events, so Claude can offer a 30-second recap.

Modes: Lecture, Socratic, Feynman, Worked example, Practice, Review, Exam prep, ELI5 / Expert. The mode is passed in `start_lesson` and changes how Claude teaches, not the loop.

Course creation: from a goal (`chalkroom new "…" --goal "…"` then "Draft the syllabus" in the UI), from resources, or from a template folder. The placement check is a `kind: "placement"` quiz.

## Resources and knowledge base

- Add by drag-and-drop in the Resources panel (uploaded to `resources/files/`), by copying into `resources/files/`, or by pasting a URL.
- v1 extraction: PDF (pdf.js, per page), DOCX (mammoth), HTML/URL (readable text), Markdown, TXT and code. PPTX, EPUB and YouTube transcripts come in v1.1.
- Scanned PDFs (no text layer) are marked `needsVision`. Claude reads page images with its own file tools.
- After extraction the server sends `resource_added`. Claude calls `kb_index` with a summary and concepts, and proposes syllabus changes.
- `kb_search(query)` is BM25 (MiniSearch) over chunks and returns chunk ids, pages and snippets. `kb_read(chunkIds)` returns the text.
- Citations: `[[res:<id>#p<page>]]` renders as a chip that opens the resource viewer at that chunk.
- "Only use my resources" (`course.json → resourcesOnly`) makes the tutor refuse uncited facts.

## Tests and quizzes

Claude writes a quiz once (`quiz_create`). The browser runs it, grades objective items locally, and sends Claude only the free-text answers. A 20-question test costs one turn to create and at most one to grade.

| Type | Graded by |
|---|---|
| mcq, multi, tf, blank, numeric, order, match | Browser |
| tf with `justify` | Browser + Claude for the justification |
| short, code, diagram, explain | Claude (`quiz_grade`) |

Results go to `quizzes/<date>-<topic>.json`. Wrong answers can become flashcards in one click. A retake asks Claude for new questions on the same objectives.

## Flashcards

Claude creates cards and never takes part in reviews. Scheduling uses ts-fsrs in the browser, and reviews are saved through the server's REST API into `deck.json`.

- `cards_propose` adds cards with `status: "proposed"`; the user accepts, edits or drops each one. `cards_add` adds approved cards directly.
- Types: basic, reverse, cloze (`{{c1::…}}`).
- Ratings: Again / Hard / Good / Easy (keys 1–4, Space to flip).
- "I don't get this card" sends one `question` envelope.
- Leeches (6+ lapses) are flagged.
- Export to CSV in v1; Anki `.apkg` import/export in v1.1.

## Learner model

- `progress/mastery.json`: per-topic score 0–1 with history. When planning, it decays toward half its stored value without review (half-life 30 days). The stored value never changes because of decay.
- `progress/misconceptions.md`: appended by `progress_update` with a `misconception` note.
- `learner.md`: preferences, edited by the user or Claude.
- `progress/sessions.jsonl`: one line per `lesson_end`.
- `progress/changes.jsonl`: audit log, `{ t, topicId, before, after, reason }`.

Lesson planning picks the next topic whose prerequisites have mastery ≥ 0.7 (`progress_get` returns `nextTopics`).

## MCP tool reference

23 tools. Names are `snake_case`; detail lives in skills loaded on demand.

| Tool | Purpose | Key arguments |
|---|---|---|
| `board_run` | Play a Board Script on the current page | `steps[]`, `page?` |
| `board_clear` | Clear the current page | — |
| `board_page` | Open a new page | `title?` |
| `board_snapshot` | Return the current page as SVG/PNG (rendered by the browser) | `shapeIds?` |
| `board_state` | Shapes currently on the board as compact JSON | — |
| `speak` | Narrate text, queued with board steps | `text`, `voice?` |
| `chat_say` | Message in the chat panel (Markdown, citations) | `markdown` |
| `lesson_start` | Open a lesson folder and log | `topicId`, `mode?` |
| `lesson_end` | Close the lesson; log session | `summary`, `outcome?` |
| `lesson_yield` | End of turn; returns any held user input | `prompt?` |
| `lesson_ack` | Heartbeat reply | — |
| `check_ask` | Inline check question (returns immediately) | `question` |
| `quiz_create` | Create a quiz | `title`, `questions[]`, `timed?`, `kind?` |
| `quiz_grade` | Grades + feedback for free-text answers | `quizId`, `attemptId`, `grades[]` |
| `cards_propose` | Propose cards for approval | `cards[]` |
| `cards_add` | Add approved cards | `cards[]` |
| `kb_search` | BM25 search over resources | `query`, `limit?` |
| `kb_read` | Read chunks by id | `chunkIds[]` |
| `kb_index` | Save resource summary and concepts | `resourceId`, `summary`, `concepts[]` |
| `syllabus_update` | Status / add / remove / move / set topics | `ops[]` |
| `progress_update` | Update mastery or log a misconception, with reason | `topicId`, `delta?` or `score?`, `misconception?`, `reason` |
| `progress_get` | Mastery, due cards, misconceptions, next topics | `topicIds?` |
| `ui_show` | Switch UI panel | `panel`, `args?` |

Every result may include `userInput` (see [Turn rules](#turn-rules)).

### Skills

- `chalk-tutor`: envelope handling, lesson loop, interrupts, citations, the "I'm not sure" rule.
- `chalk-board`: Board Script reference and layout patterns.
- `chalk-quiz`, `chalk-cards`: writing rules for questions and cards.
- `chalk-course`: building a syllabus from a goal or resources.

## UI layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ Chalk  Solana dev › 03 PDAs        ● Tutor connected   ⏱ 18:42  ⚙  │
├──────────┬──────────────────────────────────────────┬───────────────┤
│ Syllabus │                                          │ Chat │Quiz│Cards│
│  ✓ Accts │              WHITEBOARD                  │               │
│  ◐ PDAs  │                                          │               │
│  ○ CPI   │                                          │               │
│ Resources│  ── captions: "A PDA is derived..." ──   │               │
├──────────┴──────────────────────────────────────────┴───────────────┤
│ ⏸ Next Repeat Slower │ mode ▾ │ 🎤 │ [ type a question… ]          │
└─────────────────────────────────────────────────────────────────────┘
```

Screens: Home (library, today's review), Classroom, Review (full-screen cards), Progress (knowledge map, stats, lesson history with replay), Resources, Settings.

| Connection state | Shown as |
|---|---|
| Checking | Grey dot, "connecting to tutor…" |
| Connected | Green dot |
| Thinking | Animated dot; input is held, not lost |
| Terminal mode | Amber banner with the launch command |
| Disconnected | Red banner; reviews and replay still work (`chalkroom serve`) |

## Tech stack and repo

| Layer | Choice |
|---|---|
| Plugin packaging | `.claude-plugin/plugin.json` with `mcpServers` + `channels`; `marketplace.json` at repo root |
| MCP + channel | Node 20+, `@modelcontextprotocol/sdk` low-level `Server`, stdio |
| Web server | Node `http` + `ws` on 127.0.0.1 |
| Frontend | React + Vite + Zustand |
| Board | Chalk SVG renderer + rough.js; KaTeX; Mermaid (lazy-loaded) |
| Spaced repetition | ts-fsrs |
| Search | MiniSearch |
| Extraction | pdfjs-dist, mammoth |
| Validation | Zod 4 (shared), JSON Schema for MCP via `z.toJSONSchema` |
| Tests | Vitest; mock tutor for end-to-end |

```
chalkroom/
  .claude-plugin/plugin.json, marketplace.json
  skills/chalk-{tutor,board,quiz,cards,course}/SKILL.md
  packages/
    schema/       Zod schemas + syllabus parser
    server/       MCP tools, channel, turn manager, web server, watcher
    board/        Board Script layout + SVG player
    web/          React app
    ingest/       extraction + search index
    mock-tutor/   scripted fake Claude
    cli/          chalkroom new / start / serve
  templates/course/
  examples/courses/
  dist/           committed build: server.mjs, cli.mjs, web/
```

## Installation

1. In Claude Code: `/plugin marketplace add kotebibo/chalkroom`, then `/plugin install chalkroom@chalkroom`.
2. `npx chalkroom new "Linear algebra" --goal "…"`, or `/chalkroom:new` in Claude Code.
3. `chalkroom start linear-algebra`, which runs in the course folder:
   `claude --dangerously-load-development-channels plugin:chalkroom@chalkroom`
   The browser opens `http://127.0.0.1:4747`.

Requirements: Claude Code with channels (v2.1.80+), Node 20+. Team and Enterprise orgs need `channelsEnabled` set by an admin, or Chalk runs in terminal mode. Chalk never asks for `--dangerously-skip-permissions`.

Without Claude: `chalkroom serve <course>` runs the UI for reviews, replay and browsing. `chalkroom serve --mock` runs the scripted mock tutor for UI development.

## Risks

| Risk | Mitigation |
|---|---|
| Channels API changes or is restricted | Channel code is one module (`channel.ts`); terminal mode always works |
| Development flag needed until allowlisted | `chalkroom start` passes it; documented |
| Turn latency | Sentence-level TTS, draw-on animation, short segments |
| Usage limits mid-lesson | Reviews/navigation/grading local; resumable lessons |
| Board quality | Grid + auto-layout + patterns in `chalk-board` |
| Tool descriptions cost context | Short descriptions; detail in skills |
| Hallucinated facts | Resource-only mode, citations, "I'm not sure" rule |
| Copyrighted resources in shared courses | Export excludes `resources/files/` by default |

Open questions: plugin channel allowlist process; whether the board can later live in Claude Code's own surfaces; default git sync for libraries.

## Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| 0 — Spike | Channel push, `board_run`, `speak`, heartbeat, mid-turn behaviour | Button → Claude → board draws while voice talks; held input delivered via tool result |
| 1 — Classroom (v1 core) | Plugin, server, SVG board, browser TTS/STT, chat, lesson loop, syllabus, terminal mode, replay, notes export, mock tutor, `chalkroom` CLI | One course taught end to end |
| 2 — Retention (v1) | Quizzes, inline checks, flashcards + FSRS, learner model, progress views | Quiz → grades → mastery → cards → review loop works |
| 3 — Resources (v1) | Ingestion (PDF/DOCX/HTML/MD), BM25, citations, resource viewer | Teach from a PDF with page citations |
| 4 — v1.1 | Piper/whisper.cpp, PPTX/EPUB/YouTube, Anki, glossary, daily review notification, code playground, i18n | — |
| 5 — v1.2+ | Homework, study plan, focus timer, course sharing, embeddings, simulations, debate mode, mobile review | — |
