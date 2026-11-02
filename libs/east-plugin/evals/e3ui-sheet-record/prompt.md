---
tags: [e3-ui]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`, and the e3 CLI with `npx e3`; e3 runs tasks with the runners in `node_modules/.bin`, so put that folder on PATH). Make an e3 package (default export of `src/index.tsx`) with a record `orders`: order lines keyed by order id (SO-1001, SO-1002, SO-1003), each a customer (string), a quantity and an optional due date, starting with three orders of your choosing. Add a UI task `orders_sheet`: a spreadsheet over the record in which planners edit the customer, quantity and due date, each Save committing through the record. Deploy it to workspace `dev` in a repository at `./repo`, run the dataflow, then run `node --import tsx check.ts` — it prints what your package declares — and show me its output.
