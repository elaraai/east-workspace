---
tags: [east-py]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

A Python environment with the published east-py packages is ready at `./.venv` (run with `./.venv/bin/python`). With east-py, write the integers 0 to 199,999 as an East array to a beast2 file `big.beast2` without building a Python list, then open the file and print its length, the sum of its elements and the element at index 123456, separated by spaces — reading it the bounded-memory way. Code in `solution.py`, and run it.
