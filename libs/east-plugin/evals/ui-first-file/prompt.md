---
tags: [east-ui]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`). Nothing else is set up here. Write `src/hello.tsx` whose default export is an East function with no inputs returning a UIComponentType: a card titled "Welcome" holding the text "Signed in as Ada" and a button "Continue". Then run `node --import tsx check.ts src/hello.tsx`, which prints the outline of the UI your component builds, and show me its output.
