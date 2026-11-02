---
tags: [e3-ui]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`, and the e3 CLI with `npx e3`; e3 runs tasks with the runners in `node_modules/.bin`, so put that folder on PATH). Make an e3 package (default export of `src/index.tsx`) with an input `count` (an integer, 50000) and a task `orders` that generates that many order rows — id `O-1`, `O-2`, …, a customer cycling through Acme, Birch, Cobalt, Dune and Ember, and an amount of (i mod 97) × 10.5 — as an array. Add a UI task `orders_view` showing the orders in a table, amounts in Australian dollars, without loading the whole collection into the page at once. Deploy it to workspace `dev` in a repository at `./repo`, run the dataflow, then run `node --import tsx check.ts` — it prints what your package declares — and show me its output.
