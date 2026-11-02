---
tags: [e3]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `npx tsx`, and the e3 CLI with `npx e3`; e3 runs tasks with the `east-node` runner, which is in `node_modules/.bin`, so put that folder on PATH). Make an e3 package (in `src/index.ts`) with an input `prices` (an array of floats, initially 1, 2, 3) and a task `sum` adding them up. In `./repo`, deploy to workspace `dev` and run it. Then change the input to 10, 20, 30 from the CLI, run again, and tell me the new sum.
