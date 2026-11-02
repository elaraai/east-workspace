---
tags: [east-py-datascience]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

A Python environment with the published east-py packages is ready at `./.venv` (run with `./.venv/bin/python`). With east-py-datascience from Python, use simulated annealing over permutations to find the order to visit points on a line at positions 0, 5, 1, 4, 2, 3 (visiting each once, no return) that minimises the total distance travelled. Print `distance=<the minimal total distance>` with no decimals. Code in `solution.py`, and run it.
