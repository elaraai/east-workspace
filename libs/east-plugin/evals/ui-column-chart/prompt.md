---
tags: [east-ui]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`). Write `src/view.tsx` whose default export is an East function with no inputs returning a UIComponentType: a chart of units sold per month, January to June 2026 (120, 95, 140, 160, 130, 175), drawn as vertical columns, with a dashed horizontal reference line at the target of 130 labelled "Target". Then run `node --import tsx check.ts`, which prints the outline of the UI your component builds, and show me its output.
