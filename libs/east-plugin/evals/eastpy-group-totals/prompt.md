---
tags: [east-py]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

A Python environment with the published east-py packages is ready at `./.venv` (run with `./.venv/bin/python`). With east-py, write an East function in Python that takes an array of orders (customer: string, amount: float) and returns each customer's total. Compile and run it on b 2.5, a 1.0, b 4.0, and print `name=total` with two decimals, sorted by name, joined by commas. Code in `solution.py`, and run it.
