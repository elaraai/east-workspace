---
tags: [east-py]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

A Python environment with the published east-py packages is ready at `./.venv` (run with `./.venv/bin/python`). With east-py's East values (not an East function), take rows (name: string, price: float) c 3.0, a 1.5, b 2.0, keep those priced at least 2.0, sort them by price, and print the names joined by commas. Keep the data in East values the whole way. Code in `solution.py`, and run it.
