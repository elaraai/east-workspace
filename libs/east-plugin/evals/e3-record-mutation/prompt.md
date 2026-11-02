---
tags: [e3]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `npx tsx`, and the e3 CLI with `npx e3`; e3 runs tasks with the `east-node` runner, which is in `node_modules/.bin`, so put that folder on PATH). Make an e3 package (in `src/index.ts`) with a record `stock`: a dict from SKU (string) to quantity (integer), starting with apple 5, and a mutation `receive(sku, qty)` that adds qty to that SKU's quantity, creating it if missing — written so it touches only that entry. Add a task `total` summing all quantities. In `./repo`, deploy to workspace `dev`, receive 3 pear and 2 apple through the mutation, run the dataflow and tell me the total and how many commits the record's history has.
