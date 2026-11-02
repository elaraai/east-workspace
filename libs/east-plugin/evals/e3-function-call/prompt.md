---
tags: [e3]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`, and the e3 CLI with `npx e3`; e3 runs tasks with the `east-node` runner, which is in `node_modules/.bin`, so put that folder on PATH). Make an e3 package (in `src/index.ts`) with a named e3 function `greet` that takes a name (string) and returns `Hello, <name>!`. In `./repo`, deploy it to workspace `dev` and call the function with `Ada` from the e3 CLI, showing me the result.
