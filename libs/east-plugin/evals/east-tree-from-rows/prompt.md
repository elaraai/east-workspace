---
tags: [east]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

The published @elaraai packages are already installed in this folder's node_modules (run TypeScript with `node --import tsx`, and the e3 CLI with `npx e3`). I have flat rows (id: string, parent: optional string, name: string) that form a tree of any depth: 1 root (no parent), 2 kid (parent 1), 3 grandkid (parent 2). Write an East function (TypeScript) that turns them into nested nodes (name, children), run it, and print the names along the deepest path joined by `>`. Code in `solution.ts`, and run it.
