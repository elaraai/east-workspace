---
tags: [east-ui]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`). Write `src/view.tsx` whose default export is an East function with no inputs returning a UIComponentType: a select of the categories All, Hardware, Software and Services and, below it, a table of these products showing only those of the selected category (every product for All): Router (Hardware, 129), Laptop (Hardware, 1899), Antivirus (Software, 49), Office suite (Software, 99), Setup (Services, 150), Support plan (Services, 300), with columns name, category and price. The selection is the component's own state, starting at All, so changing it re-renders the table. Then run `node --import tsx check.ts`, which prints the outline of the UI your component builds, and show me its output.
