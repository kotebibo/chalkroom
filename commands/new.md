---
description: Create a new Chalk course in the library
argument-hint: "<title> [--goal \"...\"]"
---

Create a new Chalk course by running this command with Bash, passing the user's arguments through:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" new $ARGUMENTS
```

If no title was given, ask the user what they want to learn (and their goal and background) first.
Then tell the user the course folder it printed and how to start class: `chalkroom start <id>` — or, without the
`chalk` alias, run `claude --dangerously-load-development-channels plugin:chalkroom@chalkroom` inside that folder.
Do not start teaching in this session; teaching happens in a session opened in the course folder.
