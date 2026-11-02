---
tags: [east-py-datascience]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

A Python environment with the published east-py packages is ready at `./.venv` (run with `./.venv/bin/python`). With east-py-datascience from Python, train an XGBoost regressor on x = 0..39 (one feature) with y = 3x + 1, then predict y at x = 10 and print the prediction rounded to the nearest integer. Code in `solution.py`, and run it.
