---
tags: [east]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`, and the e3 CLI with `npx e3`). Write an East function (TypeScript) that, given orders (customer: string, total: float), returns the customers whose total is over 100, using an East jq query inside the function. Run it on x 50, y 150, z 101 and print the result joined by commas. Code in `solution.ts`, and run it.
