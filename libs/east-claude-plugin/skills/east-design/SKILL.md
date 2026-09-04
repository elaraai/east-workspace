---
name: east-design
description: "Design and architect a solution with East / e3 before writing code. Use when: (1) A developer describes a goal or problem rather than an API ('I want to build X', 'make/create an app that …', 'how should I structure Y', 'I have data in Z and need W', 'where do I start') and hasn't committed to an implementation — including a greenfield/empty directory before any project exists, (2) Identifying which business decision a solution should improve (East + e3 solutions are decision-oriented), (3) Deciding which East packages/skills a solution needs (east, e3, east-node-std, east-node-io, east-py-datascience, east-ui, e3-ui, east-ontology), (4) Working out the data flow — where data comes from (files, databases, S3, HTTP, APIs), how it is transformed, and where results go (datasets, exports, dashboards, decision surfaces), (5) Producing a design document with the architecture, the skills to load, and example search terms to ground the implementation."
---

# East / e3 Solution Design

Turn a developer's goal into a concrete architecture **before** scaffolding or writing code. This skill is the front of the funnel: run discovery, decide which East packages the solution needs, sketch the data flow, and hand off to **east-project** (to scaffold) and the per-package skills (to implement).

You are designing, not coding. The output is a short design document the developer signs off on, not source files.

## Before writing code — search the example index

Every East API has a tested example in the plugin's index — the index IS the
API reference, printed from each example's IR in TypeScript or python. Before
writing or changing East code:

1. Call `mcp__plugin_east_east__search_east_examples` for each capability you
   are about to use — `language: "python"` for east-py, `"typescript"`
   otherwise. Summaries come back first: id, signature, the inputs and the
   expected result, a few hundred bytes each.
2. Fetch the one or two that match with `mcp__plugin_east_east__get_east_example`
   and pattern your code on them.
3. Do not read `node_modules/@elaraai/**` or `*.examples.ts` files wholesale,
   and do not reason from `.d.ts` signatures: the index holds the same
   programs, exact and far cheaper, and the signatures omit the runtime rules
   that make East code correct.

Nothing is injected for you; the search is the step.

## Start from the decision

East + e3 solutions are **decision-oriented**. A solution exists to improve a business **decision** and put defensible evidence behind it — not to move data or render a dashboard for its own sake ("decisions, not dashboards"). Design **backwards from the decision**: name the decision first, then work out what evidence it needs, what reasoning produces that evidence, and what data feeds the reasoning. The pipeline is the means; the committed decision is the end.

So before anything else, get a one-sentence answer to: **"What decision does this help someone make, and how would a better one show up?"** If the developer can't name a decision, the deliverable is probably a dashboard or report — that's fine, but say so explicitly, because it changes the design.

### The platform stack (mental model)

Solutions sit on a fixed stack (the placemat in `docs/east-architecture.svg` / the workspace README). Design top-down — decision first, foundation last:

- **The decision loop** — what the end user does: **Observe** (see the evidence) → **Decide** (commit, with alternatives + override) → **Configure** (tune objectives, policies, assumptions) → **Trust** (provenance + audit trail on every output). The model recommends; it doesn't decide for them.
- **Access** — how the answer is surfaced: **Render** a UI (`east-ui` / `e3-ui`), **Ask** an agent, or **Serve** a typed API (`e3-api-*`).
- **The model** — the hub: an **economic ontology**, the typed graph of the business (objectives, processes, resources, decisions, KPIs, policies, data) wired by *drives / produces / constrains / measures / simulates*. Everything reads and reasons over the *same* model. Build it with the **east-ontology** skill.
- **The engine** — **Interact** (`*-std`: files/HTTP/time/crypto) · **Integrate** (`*-io`: SQL/NoSQL/S3) · **Reason** (`east-py-datascience`: optimization/ML/Bayesian/simulation) · **Compute** (`e3`: durable, content-addressed dataflow).
- **East** — the foundation: typed TypeScript compiled to one portable IR (TypeScript / Python / C).

The discovery groups below map onto these layers: data source → Integrate/Interact, compute → Reason, output → Access + the decision loop, durability → Compute.

## Workflow

```
0. DECISION   → name the decision being improved (one sentence) + how "better" shows up
1. DISCOVER   → ask the developer the questions below (use AskUserQuestion)
2. MAP        → turn answers into a capability list → skills to load
3. SEARCH     → search_east_examples for each capability; embed terms/extracts
4. DESIGN     → write the design doc (decision → evidence → data flow + skills + searches)
5. CONFIRM    → developer signs off, then hand to east-project + per-package skills
```

Do **not** skip discovery. The most common design failures are (a) guessing the data source and execution model instead of asking, and (b) building a pipeline with no decision at the end of it. Use `AskUserQuestion` to ask several at once.

## 1. Discover — the question bank

Ask only what you can't already infer from the developer's description. Group questions so you can ask 2–4 at a time.

**What decision is this for?** (the north star — drives everything else)

| Answer | Implication |
|---|---|
| A recurring operational choice (what to order/schedule/price/assign) | decision-oriented; the design culminates in a **decision surface** + the reasoning behind it |
| Improving several related decisions across a business area | model the area as an **economic ontology** first → **east-ontology** |
| A one-off analysis / report / dashboard, no decision to commit | not decision-oriented — say so; design a simpler read-only surface |
| Don't know yet | run a lightweight **east-ontology** elicitation to surface the decisions |

**Where does data come from?** (drives the I/O skills)

| Answer | Implication |
|---|---|
| Local files — CSV / JSON / text | **east-node-std** `FileSystem` (read/write/glob) |
| Spreadsheets / XML | **east-node-io** `Format.XLSX`, `Format.XML` |
| SQL database (SQLite / Postgres / MySQL) | **east-node-io** `SQL.*` |
| NoSQL (Redis / MongoDB) | **east-node-io** `NoSQL.*` |
| Object storage (S3) | **east-node-io** `Storage.S3` |
| FTP / SFTP transfer | **east-node-io** `Transfer.*` |
| HTTP / REST API | **east-node-std** `Fetch` |
| Compressed archives (gzip / zip / tar) | **east-node-io** `Compression.*` |
| Hand-authored / inline constants | plain **east** values, no I/O skill |

**What happens to the data?** (drives the compute skills)

| Answer | Implication |
|---|---|
| Filter / map / aggregate / reshape | pure **east** expressions |
| Join / group / pivot across sources | **east** collections (Dict, Set, SortedMap) |
| Forecasting / regression / classification | **east-py-datascience** (XGBoost, LightGBM, NGBoost, GP, Torch) |
| Optimization / scheduling / routing | **east-py-datascience** (MADS, Optuna, SimAnneal, GoogleOr) |
| Bayesian inference / uncertainty | **east-py-datascience** (PyMC, MAPIE conformal) |
| Discrete-event simulation | **east-py-datascience** (Simulation) |
| Native code East can't express (a 3rd-party lib, bespoke algorithm) — Python or TS | a **project-owned platform module** → **east-project** (`--platform`), authored with **east** (`East.platform().implement()`) / **east-py** (`@East.platform_function`, callable in a body) |

**Where do results go?** (drives the output skills)

| Answer | Implication |
|---|---|
| A file or export on disk | **east-node-std** `FileSystem` / **east-node-io** `Format.*` |
| A queryable dataset / API result | **e3** datasets (`e3.export`, `e3 dataset get`) |
| An interactive dashboard / report | **east-ui** + **e3-ui** (`ui()`, `Data.bind`) |
| A static chart / table image | **east-ui** (rendered components) |
| Back into a database / S3 | **east-node-io** write side |

**How often and how durably does it run?** (drives e3 vs plain East)

| Answer | Implication |
|---|---|
| One-shot script, run by hand | plain **East** project (Node-only, AGPL-3.0) |
| Recurring / multi-step pipeline with caching | **e3** durable dataflow (BSL-1.1, Node + Python) |
| Reactive — recompute when inputs change | **e3** (content-addressable caching, `e3 watch`) |
| Interactive — users edit data and see results | **e3-ui** (`Data.bind` read/write/commit) |
| Needs Python compute (ML/opt) at all | **e3** (Python runtime) |

**Constraints to surface explicitly:**
- **Licensing** — plain East is AGPL-3.0; e3 is BSL-1.1. If the developer can't take BSL, the design must avoid e3 and Python compute.
- **Runtime** — Node-only vs Node + Python. Any `east-py-datascience` need pulls in Python, which means e3.
- **Secrets / credentials** — database URLs, S3 keys, API tokens → note where they're configured (e3 inputs vs env).

## 2. Map — capability → skill + search terms

For each capability the answers surface, record (a) the skill to load and (b) the example-search query you'll run. This table is the heart of the design.

| Capability | Skill | `search_east_examples` query |
|---|---|---|
| Model the business / its decisions as a graph | east-ontology | `Ontology process kpi decision objective` |
| Decision surface — commit a choice with provenance | e3-ui | `Ontology Diff Data.bind commit` |
| Read/write local files, glob | east-node-std | `FileSystem read file write glob` |
| HTTP fetch / REST | east-node-std | `Fetch http get post json` |
| Crypto / hashing / uuid | east-node-std | `Crypto hash uuid` |
| Spreadsheet parse/write | east-node-io | `XLSX read sheet parse rows` |
| SQL query | east-node-io | `SQL Postgres query select` |
| Redis / MongoDB | east-node-io | `NoSQL Redis MongoDB get set` |
| S3 storage | east-node-io | `S3 storage put get object` |
| Forecasting / boosting | east-py-datascience | `XGBoost forecast train predict` |
| Combinatorial optimization | east-py-datascience | `SimAnneal optimize assignment routing` |
| Black-box / hyperparameter opt | east-py-datascience | `Optuna MADS optimize objective` |
| LP / MIP / routing | east-py-datascience | `GoogleOr vehicle routing constraint` |
| Conformal / uncertainty | east-py-datascience | `MAPIE conformal NGBoost interval` |
| East transforms / collections | east | `map filter reduce groupBy SortedMap` |
| Variants / pattern match | east | `variant match some none` |
| e3 pipeline / tasks | e3 | `e3.input e3.task package export dataflow` |
| Dashboard / interactive UI | e3-ui | `ui Data.bind commit dataset` |
| Charts / tables / layout | east-ui | `Chart Line Table Stack layout` |
| Screenshot / visually verify a surface (CLI) | e3-ui-cli | `shot from-source png doctor` |

Always run the searches — the East API is large and idiom-heavy, and grounding the design in real examples beats guessing from type signatures. Nothing is injected for you: search (summaries first), then `get_east_example` for the closest match. Prefer **embedding the actual extract** of the 1–2 closest matches into the design doc; if a search is broad, record the **query** so the implementer reruns it.

## 3. Design — the document

Produce a compact design doc (Markdown, shown to the developer — not yet a file unless they ask):

```markdown
# Design: <goal>

## Decision
<the decision this improves, in one sentence — or "none: read-only <report/dashboard>">
How "better" shows up: <what changes when the decision improves>

## Evidence the decision needs
<the numbers / recommendation the user looks at to decide, and their provenance>

## Project type
e3 | East  — <why> (durability / Python / licensing)

## Data flow (decision ← evidence ← reasoning ← data)
<source> → <transform/reason> → <evidence> → <decision surface>
(a short diagram or numbered steps; name each e3 input/task if e3)

## Components
- <task/function name>: <responsibility> — skill: <skill>
- ...

## Skills to load
- east-project (scaffold) → <e3|east>
- <skill>: <what it's used for>
- ...

## Grounding examples
- <capability>: search `<query>` — <1-line note or inline extract>
- ...

## Build sequence
1. east-project: `npm create @elaraai/<e3|east> <name>`
2. <implement task X with skill Y>
3. ...
4. run / verify: <command>

## Open questions / risks
- <anything unresolved>
```

Keep it tight. Lead with the decision; the components list maps 1:1 to e3 inputs/tasks (or East functions) so the implementer can start immediately.

## 4. Hand off

Once the developer signs off:
- **east-project** scaffolds the skeleton (`npm create @elaraai/e3` or `@elaraai/east`).
- The per-package skills implement each component:
  - task/pipeline wiring → **e3**
  - function bodies & types → **east**
  - file/HTTP I/O → **east-node-std**; DB/S3/format I/O → **east-node-io**
  - ML / optimization tasks → **east-py-datascience**
  - dashboards → **east-ui** + **e3-ui**

## Worked example

> "I have monthly sales spreadsheets in S3 and want a dashboard that forecasts next quarter."

Note the decision-first reframe — "a forecast dashboard" on its own has no decision to commit:

- **Decision**: how much stock to order per SKU next quarter; "better" = fewer stockouts *and* less overstock.
- **Evidence**: a per-SKU demand forecast *with uncertainty*, plus a recommended order quantity.
- **Source**: XLSX in S3 → `east-node-io` (`Storage.S3` + `Format.XLSX`).
- **Reason**: forecast → `east-py-datascience` (NGBoost for prediction intervals) → Python → **e3**.
- **Decision surface**: dashboard showing the forecast band + recommended order, operator override → `east-ui` + `e3-ui`.
- **Execution**: recurring + reactive + Python ⇒ **e3 project** (BSL-1.1).
- **Searches**: `S3 storage get object`, `XLSX parse rows`, `NGBoost predict interval`, `Chart AreaRange`, `ui Data.bind commit`.
- **Build**: `npm create @elaraai/e3 reorder-planner` → e3 inputs (S3 config) → ingest task (east-node-io) → forecast task (east-py-datascience) → decision-surface ui task (e3-ui).

## Related skills

- **east-project** — scaffolds and runs what this skill designs.
- **e3** / **east** — the execution engine and language the design targets.
- **east-node-std** / **east-node-io** — the I/O surface the data-flow questions map to.
- **east-py-datascience** — ML / optimization components.
- **east-ui** / **e3-ui** — dashboard / output components.
