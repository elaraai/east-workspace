---
tags: [east-py-datascience]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

A Python environment with the published east-py packages is ready at `./.venv` (run with `./.venv/bin/python`). With east-py-datascience from Python, solve the linear program: maximize 3x + 2y subject to x + y ≤ 4, x ≤ 3, x ≥ 0, y ≥ 0 (continuous). Print `objective=<value>` with no decimals. Code in `solution.py`, and run it.
