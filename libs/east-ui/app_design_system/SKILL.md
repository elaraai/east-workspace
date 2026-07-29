---
name: east-design
description: Use this skill to generate well-branded interfaces and assets for East (Elara AI's decision-intelligence application), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, and core UI atoms for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.

Non-negotiable for any East component or screen: pass every line of
guidelines/component-rules.md (semantic tokens only — no raw hex; every
numeral JetBrains Mono tabular; status = dot + uppercase mono word, never a
tinted badge; structure from 1px rules, shadows only on overlays; dashed =
ephemeral; must work with data-theme="dark" unchanged). For any component,
look at the RENDERED example captures in
components/rendered/<category>/ — one standalone HTML per component
(Board, Planner, Table, Chart, Story, …), produced by the production
renderer with the real theme, every example variant included. They are
the ground truth for how components actually look; reference them when a
mock must sit alongside real components.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy
assets out and create static HTML files for the user to view. If working on
production code, you can copy assets and read the rules here to become an
expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they
want to build or design, ask some questions, and act as an expert designer who
outputs HTML artifacts _or_ production code, depending on the need.
