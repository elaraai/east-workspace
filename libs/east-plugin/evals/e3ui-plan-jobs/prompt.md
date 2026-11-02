---
tags: [e3-ui]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 80
timeout_seconds: 1800
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`, and the e3 CLI with `npx e3`; e3 runs tasks with the runners in `node_modules/.bin`, so put that folder on PATH). Make an e3 package (default export of `src/index.tsx`) with a record `machines` (Lathe, Mill and Press, keyed m1–m3) and a record `jobs`, keyed J-1…J-4, each a title, the machine it runs on, and a start and end time in the week of 2 November 2026. Add a UI task `schedule`: a planning canvas for that week with a row per machine and each job drawn as a bar on its machine's row, which a planner can drag to reschedule, the change saved to the jobs record. Deploy it to workspace `dev` in a repository at `./repo`, run the dataflow, then run `node --import tsx check.ts` — it prints what your package declares — and show me its output.
