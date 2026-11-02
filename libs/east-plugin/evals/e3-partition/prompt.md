---
tags: [e3]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`, and the e3 CLI with `npx e3`; e3 runs tasks with the `east-node` runner, which is in `node_modules/.bin`, so put that folder on PATH). Make an e3 package (in `src/index.ts`) with an input `sales`, an array of (region: string, amount: float) — north 1, south 2, north 3, east 4 — and a task `by_region` giving each region's total, written so e3 can split the work over the input in pieces by region rather than in one pass. In `./repo`, deploy to `dev`, run it and show me the output.
