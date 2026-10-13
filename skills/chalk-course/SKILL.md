---
name: chalk-course
description: How to create or revise a Chalk course syllabus (syllabus.md) from a learning goal or from the learner's resources, including prerequisites and placement. Use on draft_syllabus, after resource_added, or when the learner wants to change the course plan.
---

# Building a Chalk syllabus

`syllabus.md` is the course plan that both you and the learner edit. Format:

```markdown
# Solana development

- [ ] Accounts model  <!-- id: accounts -->
- [ ] Program Derived Addresses  <!-- id: pdas, needs: accounts -->
  - [ ] Bump seeds  <!-- id: bumps, needs: pdas -->
- [ ] Cross-program invocation  <!-- id: cpi, needs: pdas -->
```

- Markers: `[ ]` to cover, `[~]` in progress, `[x]` covered, `[!]` needs review.
- `id`: short kebab-case, stable forever (lessons, cards and mastery refer to it).
- `needs`: space-separated prerequisite ids. Only list direct prerequisites.
- Nest (2 spaces) for subtopics. Chalk adds `lesson:` and `mastery:` itself; leave them.
- Write the file directly, or use `syllabus_update` ops for small changes.

## From a goal (`draft_syllabus`)

1. Read `course.json` (goal, level, language, deadline), `../../learner.md` and any resources
   (`resources/index.json`).
2. Ask at most two clarifying questions in `chat_say` if the goal is vague (what they already
   know, what they want to be able to *do*). Otherwise draft immediately.
3. Draft 6–20 topics, each one teachable in 1–2 lessons of ~20 minutes, ordered so every
   `needs` comes earlier. End with an applied/capstone topic.
4. Write `syllabus.md`, then `chat_say` a short overview: the arc, rough time per topic, and
   what will be skipped. Invite edits. If there is a deadline, say whether it is realistic.
5. Offer a placement check (`quiz_create` with `kind: "placement"`, ~2 questions per topic);
   use its results to `progress_update` and mark known topics `[x]`.

## From resources (`resource_added`)

- For a textbook/slides marked `primary`, follow its table of contents and order; map each
  chapter or section to topics and keep the book's terminology. Cite the chapter pages in
  the topic title only if useful (`Bump seeds (ch. 3)`).
- For `reference` material, don't restructure the syllabus; mention which topics it covers.
- Propose changes in chat first; apply them after the learner agrees.

## Revising

- Learner struggles repeatedly → insert a smaller prerequisite topic before it.
- Learner already knows something (placement, quick checks) → mark it `[x]` with a reason in
  `progress_update`, not by deleting it.
- Never renumber or rename ids of topics that already have lessons.
