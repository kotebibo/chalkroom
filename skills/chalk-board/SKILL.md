---
name: chalk-board
description: Board Script reference for Chalk's whiteboard (board_run). Use before drawing anything on the Chalk board — shapes, arrows, formulas, code, tables, charts, Mermaid diagrams, highlights, pages and narration timing.
---

# Board Script

`board_run({ steps: [...], page?: "Title" })` plays steps in order. Shapes draw on stroke by
stroke; a `say` step waits until its narration finishes, so interleave them:

```json
{ "page": "What is a PDA?", "steps": [
  { "add": { "id": "wallet", "kind": "box", "text": "Wallet", "at": [2, 2] } },
  { "say": "Normal accounts are controlled by a private key." },
  { "add": { "id": "pda", "kind": "circle", "text": "PDA", "at": [8, 2], "style": "accent" } },
  { "add": { "id": "e1", "kind": "arrow", "from": "wallet", "to": "pda", "label": "seeds + bump" } },
  { "say": "A PDA is derived from seeds, so no private key exists." },
  { "highlight": "pda", "for": 2 },
  { "write": { "id": "f1", "latex": "\\text{PDA} = H(\\text{seeds}, \\text{programId}, \\text{bump})", "at": [5.5, 5] } }
] }
```

## Grid

The board is **12 columns × 8 rows**. `at: [col, row]` is the **centre** of the shape;
`[0,0]` is top-left, `[11,7]` bottom-right, `[5.5, 3.5]` the middle. Fractions are fine.
Leave ~3 columns between boxes that an arrow connects so the label fits. Overlapping shapes
are nudged automatically, but plan the layout yourself. Omit `at` to auto-place.

## Shapes (`add`)

Every shape needs a unique, meaningful `id` (you and the learner refer to it later).
Optional on all: `style` = `default | accent | muted | good | warn | bad`, `size: [cols, rows]`,
`source: "res:<id>#p<page>"`.

| kind | fields | notes |
|---|---|---|
| `box` | `text` | `\n` for line breaks; keep ≤ 3 short lines |
| `circle` | `text` | |
| `text` | `text` | plain handwriting; `style: "accent"` for titles |
| `sticky` | `text` | a yellow note for takeaways |
| `formula` | `latex` | KaTeX. `write` is a shortcut that infers formula/text |
| `code` | `code`, `lang` | ≤ 12 lines, ≤ 60 chars per line |
| `table` | `rows: [["h1","h2"],["a","b"]]` | first row is the header |
| `chart` | `chart: { type: "bar"\|"line", data: [{x, y}], xLabel?, yLabel? }` | ~4×3 cells |
| `image` | `src` | a course-relative path (e.g. `resources/files/fig.png`) or a `data:` URL |
| `arrow` | `from`, `to`, `label?` | ids of other shapes; or `points: [[c,r],[c,r]]` |
| `path` | `points: [[c,r], …]` | freehand curve |
| `frame` | `title`, `at`, `size` | a named region for grouping and `camera` |
| `group` | `children: [ids]` | to highlight several shapes as one |

Diagrams from text: `{ "mermaid": { "id": "seq", "code": "sequenceDiagram\n A->>B: hi", "at": [5.5, 3.5], "size": [8, 5] } }`
(flowchart, sequence, state, class, ER). Use Mermaid for > 6 boxes; hand-place smaller ones.

## Actions

| step | effect |
|---|---|
| `{ "update": { "id", ...fields } }` | change text/style/position |
| `{ "move": { "id", "to": [c, r] } }` | move a shape |
| `{ "remove": "id" \| ["ids"] }` | erase (attached arrows go too) |
| `{ "highlight": ids, "for": 2 }` | glow behind shapes for N seconds |
| `{ "underline": ids }` / `{ "circle": ids }` | chalk underline / ring |
| `{ "pulse": ids }` | brief pulse |
| `{ "fade": ids }` | dim shapes no longer in focus |
| `{ "camera": { "frame": "id" } }` or `{ "camera": { "at": [c,r], "zoom": 1.5 } }` | pan/zoom; `{ "camera": {} }` resets |
| `{ "clear": true }` | empty the page |
| `{ "page": { "title" } }` | new page (or `board_run`'s `page` argument) |
| `{ "say": "…" }` | narrate; blocks until spoken |
| `{ "wait": 1 }` | pause N seconds |

## Layout patterns

- **Flow (left→right)**: boxes at rows 2–3, columns 1.5, 5.5, 9.5; arrows between; caption sticky at [9.5, 6].
- **Tree**: root [5.5, 1]; children [2.5, 3.5], [5.5, 3.5], [8.5, 3.5]; leaves at row 6.
- **Comparison**: two frames `[3, 4]` and `[8.5, 4]` size `[5, 6]`; matching rows inside each.
- **Timeline**: `path` along row 4 from col 0.5 to 11; `text` labels above at rows 3, ticks as small circles.
- **Derivation**: one `formula` per line at col 5.5, rows 1.5, 2.5, 3.5…; `say` between lines; `highlight` the term that changes.
- **Code walkthrough**: `code` on the left [3.5, 3.5]; explanation stickies on the right; `highlight` the code shape while discussing.

## Rules of thumb

- New idea → new page. Keep ≤ 10 shapes per page.
- Draw, then say. Narrate what just appeared, not what's coming.
- Use `accent` for the one thing that matters on the page; `muted` for context.
- Learner drawings come back from `board_state` with `user: true` (kind `path`).
- If `board_run` returns `warnings`, fix them in your next call (e.g. unknown ids).
