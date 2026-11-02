---
tags: [e3]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `npx tsx`, and the e3 CLI with `npx e3`; e3 runs tasks with the `east-node` runner, which is in `node_modules/.bin`, so put that folder on PATH). Make an e3 package `shop` (in `src/index.ts`) with an input `orders` — an array of (customer: string, amount: float), initially b 2.5, a 1, b 4 — and a task `totals` giving each customer's total. Create a repository in `./repo`, deploy the package to a workspace `dev`, run the dataflow, and show me the `totals` output.
