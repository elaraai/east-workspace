---
tags: [east-py]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

A Python environment with the published east-py packages is ready at `./.venv` (run with `./.venv/bin/python`). With east-py, run a jq query over an East array of orders (customer: string, total: float) — x 50.0, y 150.0, z 101.0 — that gives the customers whose total is over 100, and print them joined by commas. Code in `solution.py`, and run it.
