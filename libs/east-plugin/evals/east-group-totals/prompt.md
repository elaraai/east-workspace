---
tags: [east]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`, and the e3 CLI with `npx e3`). Write an East function in TypeScript that takes an array of orders (customer: string, amount: float) and returns each customer's total amount. Compile it, run it on these orders — b 2.5, a 1, b 4 — and print the totals as `name=total` pairs with two decimals, sorted by name and joined by commas. Put the code in `solution.ts` and run it.
