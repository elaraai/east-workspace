---
tags: [east-ui]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`). Write `src/view.tsx` whose default export is an East function with no inputs returning a UIComponentType: a row of three KPI tiles — Revenue 1250000 shown as Australian dollars, Orders 342, Margin 0.183 shown as a percentage — above a table of four regions (North 420000 and +3.1%, South 310000 and −1.2%, East 280000 and +0.4%, West 240000 and +5.6%) with columns `region`, `revenue` (as Australian dollars) and `change` (as a percentage). Keep the numbers as numbers in the data and let the components format them. Then run `node --import tsx check.ts`, which prints the outline of the UI your component builds, and show me its output.
