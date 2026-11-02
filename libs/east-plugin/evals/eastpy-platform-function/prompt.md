---
tags: [east-py]
plugins: ["../../marketplace/east-claude-plugin"]
runs: 2
max_turns: 60
timeout_seconds: 1200
allowed_tools: [Read, Glob, Grep, Skill, TodoWrite]
---

A Python environment with the published east-py packages is ready at `./.venv` (run with `./.venv/bin/python`). With east-py, expose a Python function that turns a title into a URL slug (lowercase, runs of non-alphanumerics become a single `-`, no leading or trailing `-`) to East, and write an East function that maps an array of titles to slugs with it. Compile and run it on `Hello World` and `East & e3!`, printing the slugs joined by commas. Code in `solution.py`, and run it.
