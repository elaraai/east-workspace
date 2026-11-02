---
tags: [east]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`, and the e3 CLI with `npx e3`). In East (TypeScript), write a function over an array of items (name: string, price: float, discount: an optional float fraction) that returns each item's net price — the price less its discount where it has one. Run it on: pen 10.0 with a 0.25 discount, cup 4.0 with no discount, and print `name=net` with two decimals, joined by commas in input order. Code in `solution.ts`, and run it.
