---
name: chalk-quiz
description: How to write Chalk quizzes and inline checks (quiz_create, check_ask, quiz_grade) — question JSON for every type, answer keys, difficulty, rubrics and grading. Use before creating or grading any Chalk quiz.
---

# Writing Chalk quizzes

The browser runs the quiz and grades objective items itself; only free-text answers come back
to you once, in a `quiz_submit` envelope. So answer keys must be exact.

## Question JSON

Common fields: `type`, `prompt` (Markdown, `$math$` ok), `difficulty` 1–5, `topic` (syllabus id),
`explanation` (shown after answering), `source` (`res:<id>#p<page>`), `rubric` (for free text).

| type | extra fields | answer |
|---|---|---|
| `mcq` | `options: [..]` (3–5) | index, e.g. `1` |
| `multi` | `options` | array of indexes `[0, 2]` |
| `tf` | `justify?: true` | `true` / `false` (justification graded by you) |
| `blank` | `accept?: [variants]` | string; matching is case-insensitive and forgiving of small typos |
| `numeric` | `tolerance?` | number |
| `order` | `options` (items in any order) | indexes in the correct order, e.g. `[2, 0, 1]` |
| `match` | `options` (left), `matchRight` (right) | for each left item, the index of its right match |
| `short` / `explain` | `rubric` | — (you grade) |
| `code` | `rubric` | — (you grade; you may run it in the course folder) |
| `diagram` | `rubric` | — (you grade from `board_snapshot`) |

`quiz_create({ title, topic, kind?: topic|unit|placement|review, timed?: minutes, questions })`.
`check_ask({ question })` takes one question of type mcq, tf, blank, numeric or short.

## Quality rules

- One idea per question; test understanding, not wording. Distractors must be plausible
  misconceptions (use `progress_get` → misconceptions), never jokes.
- Avoid "all/none of the above" and negatives ("Which is NOT…") unless essential.
- Mix types: about 60% objective, 40% free text for topic quizzes.
- Spread difficulty (mostly 2–3, one 4–5). Over-sample weak topics and open misconceptions.
- Every question gets an `explanation`; cite the source when resources exist.
- A topic quiz has 5–10 questions; a unit test 12–20; a placement check ~2 per topic, easy → hard.
- Retake (`data.retakeOf`): same objectives, new questions and numbers; don't reuse items.

## Grading (`quiz_submit` → `quiz_grade`)

- `score` is 0..1 per item. Give partial credit by rubric: core idea 0.5, correct reasoning 0.3,
  precision/terminology 0.2 (adapt to the rubric).
- `feedback`: 1–3 sentences: what was right, what's missing, how to fix it. Address the learner.
- Put a short `misconception` on an item when the answer reveals one, and also call
  `progress_update` with it.
- After grading: `progress_update` each topic with `score` ≈ the topic's quiz result (reason:
  "quiz <id>: 7/10"), then one `chat_say` summary with the next step.
