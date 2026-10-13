# Chalkroom

**Your own Claude Code session becomes a tutor with a whiteboard.** Claude draws and narrates on a
chalkboard while it explains. It quizzes you, writes flashcards you review with spaced repetition,
cites the PDFs you give it, and remembers what you got wrong. Each course is a folder of Markdown
and JSON that you own.

- **Local only.** A Claude Code plugin plus a web UI served on `127.0.0.1`. No accounts, no hosted
  service, no telemetry.
- **Runs on your Claude subscription through normal Claude Code use.** Chalkroom never calls the
  Anthropic API, never runs `claude -p`, and never touches your credentials.
- **Cheap on usage.** Flashcard reviews, scheduling, playback and objective quiz grading run in the
  browser. Claude is only asked to think.

## Quick start

Requires Claude Code **v2.1.80+** (channels), logged in with a Claude account, and **Node 20+**.

```bash
# 1. Install the plugin (inside Claude Code)
/plugin marketplace add kotebibo/chalkroom
/plugin install chalkroom@chalkroom

# 2. Install the CLI and create a course
npm i -g chalkroom
chalkroom new "Linear algebra" --goal "Ready for ML maths in 6 weeks; I know calculus"

# 3. Start class: opens Claude Code in the course folder with the Chalkroom channel
chalkroom start linear-algebra
```

The browser opens at `http://127.0.0.1:4747`. Press **Draft syllabus**, or add a textbook under
**Resources** first, then pick a topic and **Start lesson**.

> Until Chalkroom is on Claude Code's channel allowlist, `chalkroom start` uses
> `--dangerously-load-development-channels plugin:chalkroom@chalkroom`. That flag only affects
> channel loading. Chalkroom never asks for `--dangerously-skip-permissions`. Team and Enterprise
> orgs need an admin to enable channels. Without channels, Chalkroom runs in **terminal mode**: you
> type in the terminal and the board still draws.

## What's in the classroom

| | |
|---|---|
| **Whiteboard** | Hand-drawn boxes, arrows, KaTeX formulas, highlighted code, tables, charts and Mermaid diagrams, drawn stroke by stroke in sync with narration. Pages, pen, select-and-ask ("explain this part"), SVG/PNG export. |
| **Voice** | Browser speech by default (free, offline). OpenAI or ElevenLabs voices with your own key in `~/chalkroom/.env`. Push-to-talk questions (hold <kbd>Space</kbd>); speaking interrupts the tutor. |
| **Lessons** | Plan → short segments → inline checks → notes. Modes: lecture, Socratic, Feynman, worked example, practice, review, exam prep, ELI5/expert. Resume where you stopped; replay any lesson. |
| **Quizzes** | 11 question types. Objective items are graded in the browser; free-text answers go to Claude in one turn. Turn misses into flashcards in one click. |
| **Flashcards** | Basic, reverse and cloze cards scheduled with FSRS (ts-fsrs). Claude proposes cards and you approve them. Reviews never use Claude. CSV import/export. |
| **Resources** | Drop in PDF, DOCX, HTML, Markdown, text or code, or paste a URL. Text is extracted locally and searched with BM25, and the tutor cites `[[res:book#p142]]`. A chip opens the page. "Only use my resources" mode. |
| **Progress** | A knowledge map coloured by mastery, streak, retention, quiz trend, misconceptions, and an audit log of every change the tutor made to your learner model. |

## How it works

```
browser UI ──ws──▶ Chalkroom server ──channel event / tool result──▶ your Claude Code session
     ▲                 (MCP, stdio)                                          │
     └────────── board, voice, quiz, cards ◀── MCP tool calls ──────────────┘
                         │
                   course folder (Markdown + JSON, watched for changes)
```

Claude Code starts the plugin's MCP server, which also serves the UI. Learner input reaches
Claude as a [channel](https://code.claude.com/docs/en/channels) event when the session is idle.
While Claude is mid-turn, the input is attached to the result of its next Chalkroom tool call
instead, because channel events only queue until the turn ends. Claude answers through 23 tools
(`board_run`, `speak`, `check_ask`, `quiz_create`, `cards_propose`, `kb_search`,
`progress_update`, …) and 5 skills that load on demand.

The full design, including the course file format and Board Script, is in
[`docs/design.md`](docs/design.md).

## A course on disk

```
~/chalkroom/
  learner.md              your background and preferences (all courses)
  settings.json, .env     UI settings; optional voice keys
  courses/linear-algebra/
    CLAUDE.md             tutor instructions for this course
    course.json           title, goal, level, language, deadline
    syllabus.md           - [x] Vectors  <!-- id: vectors -->
    resources/            your files + extracted text
    lessons/01-vectors/   plan.md, notes.md, events.jsonl (replayable)
    quizzes/  flashcards/deck.json  progress/
```

Edit any of it by hand, commit it to git, or zip it to share. The UI picks up changes live.

## CLI

```
chalkroom new "<title>" [--goal "…"] [--level …] [--language en]
chalkroom start [course] [--approved]   # Claude Code + channel; --approved once allowlisted
chalkroom serve [course] [--mock]       # UI without Claude (reviews, replay) or with a scripted tutor
chalkroom list | doctor
```

`/chalkroom:new` inside Claude Code also creates a course.

## Development

```bash
npm install
npm run build          # web UI → dist/web, server + CLI → dist/*.mjs (committed, so the plugin needs no npm install)
npm test               # unit tests + an end-to-end MCP/channel/WebSocket test against dist/server.mjs
npm run dev:mock       # server with the mock tutor on :4747
npm run dev:web        # Vite dev server on :5173, proxied to :4747 (set CHALK_DEV_ORIGIN=http://localhost:5173)
node scripts/e2e-ui.mjs http://127.0.0.1:4747 ./shots   # drive the UI in Edge/Chrome (playwright-core)
```

| package | |
|---|---|
| `packages/schema` | Zod schemas for every file format and wire message; syllabus parser |
| `packages/board` | Board Script reducer and layout (shared by server and browser) |
| `packages/server` | MCP tools, channel, turn manager, web server, file watcher, TTS proxy |
| `packages/ingest` | PDF/DOCX/HTML extraction and MiniSearch index |
| `packages/web` | React UI: board renderer, player, chat, quizzes, review, progress |
| `packages/mock-tutor` | Scripted stand-in for Claude, for UI work and tests |
| `packages/cli` | `chalkroom` command |

Environment: `CHALK_HOME` (library root, default `~/chalkroom`), `CHALK_PORT` (default 4747; the
next free port is used if busy), `CHALK_NO_OPEN=1` (don't open a browser).

## Privacy

Chalkroom makes no network calls of its own, apart from fetching URLs you add as resources and
calling the TTS provider you configure. Course data leaves your machine only through Claude Code
itself.

## License

MIT
