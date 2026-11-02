---
tags: [east]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `npx tsx`, and the e3 CLI with `npx e3`). Using East's TypeScript API, encode an array of rows (id: integer, name: string) — ids 1 and 2, names a and b — to a beast2 file `rows.beast2`, read it back, and print `equal=<whether the decoded value equals the original> count=<rows read back>`. Compare the values the East way, not with JSON. Code in `solution.ts`, and run it.
