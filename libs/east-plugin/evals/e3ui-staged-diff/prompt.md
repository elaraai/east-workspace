---
tags: [e3-ui]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`, and the e3 CLI with `npx e3`; e3 runs tasks with the runners in `node_modules/.bin`, so put that folder on PATH). Make an e3 package (default export of `src/index.tsx`) with an input `limits`, a struct of three floats — overtime 10, travel 2500, training 1200 — and a UI task `limits_editor` where a user changes each limit. Changes are held back until the user presses Apply, Discard drops them, and a review of the pending changes is shown beside the controls. Deploy it to workspace `dev` in a repository at `./repo`, run the dataflow, then run `node --import tsx check.ts` — it prints what your package declares — and show me its output.
