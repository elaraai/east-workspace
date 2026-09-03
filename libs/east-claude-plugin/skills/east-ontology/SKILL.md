---
name: east-ontology
description: "Build an Economic Ontology of a business and render it with the e3-ui Ontology editor. Use when: (1) Modelling how a business creates value as a graph of resources, activities, KPIs, decisions, objectives, policies, data/systems ('map our supply chain', 'build an ontology', 'model the business', 'create a digital twin', 'what should we optimize or automate', 'where is the value created'), (2) Running an ontology-elicitation workshop and turning the captured activity table into nodes + links, (3) Encoding that graph as an `OntologyType` e3.input and surfacing it via `Ontology.Root` with staged commit/discard + Diff, (4) Using the ontology to identify high-value, decision-improving AI / optimization initiatives."
---

# Economic Ontology

An **Economic Ontology** describes how a business creates value: a graph whose nodes are the things a business cares about (resources, activities, KPIs, decisions, objectives, policies, data/systems) and whose links are the relationships between them. This skill covers two things: the **elicitation methodology** for building one with a stakeholder, and how to **encode + render** it with the `Ontology` component from `@elaraai/e3-ui`.

The point of an ontology is not the picture — it's to locate the **decisions** that drive objectives, so you can target the highest-value ones with AI / mathematical optimization (an east-py-datascience + e3 build).

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

## The conceptual model

A business creates value by **activities** that convert/exchange **resources** into other resources, **measured by** KPIs, **facilitated by** data/systems, **driven by** decisions, in service of **objectives**, **constrained by** policies. These map onto `NodeKindType` in `ontology.ts`:

| Workshop concept | Node kind | Meaning |
|---|---|---|
| Activity | `process` | A unit of value-creating work (source milk, pick & pack, dispatch) |
| Resource | `resource` | Something tracked + consumed/produced (inventory, money, employees, a forecast) |
| KPI | `kpi` | A quantitative measure of an activity's performance (fill rate, P99 latency) |
| Decision | `decision` | A choice about how to use resources in an activity to hit a KPI |
| Agent / role | `agent` | A person, team, or system role that executes activities and owns decisions |
| Objective | `objective` | A strategic goal — a function of resources ("maximise profit", "NPS ≥ 60") |
| Policy | `policy` | A rule constraining an activity (FEFO picking, least-privilege access) |
| Data / system | `data` | A dataset, signal, or system feeding an activity (WMS stream, SAP, carrier API) |
| Computation / model | `computation` | A derived quantity or model output |
| Document | `document` | Reference material — a procedure, contract, control spec |
| Group | `group` | A visual container only — no semantics |

Resources may be physical or abstract, ephemeral or long-lasting. Focus on **primary** value-creating activities (procurement, production, packaging, sales) over support functions (HR, Finance, IT), and on what's **quantitative** over qualitative.

## Canonical link directions

`LinkKindType` is directed (`source` → `target`). Treat the **activity (`process`) as the hub**: resources/KPIs/decisions/data attach to it. These are the patterns the editor's examples use — follow them so graphs read consistently:

| Pattern (`source --kind--> target`) | Reads as |
|---|---|
| `process --uses--> resource` | activity consumes an input resource |
| `process --produces--> resource` | activity emits an output resource |
| `process --results_in--> kpi` | activity's outcome lands in a KPI |
| `kpi --measures--> process` (or `resource`) | KPI quantifies the activity |
| `kpi --drives--> objective` | KPI moves a strategic goal |
| `decision --drives--> process` (or `kpi` / `objective`) | decision steers the activity toward goals |
| `agent --executes--> process` (or `decision`) | the role that performs the activity / makes the call |
| `kpi --measures--> agent` | KPI quantifies a team's performance |
| `data --informs--> process` | a system/signal feeds the activity ("facilitated by") |
| `process --inserts_data_into--> data` | activity writes back to a system |
| `data --gets_data_from--> data` (or other) | a read dependency between signals |
| `policy --constrains--> process` | a rule limits the activity |
| `document --defines--> policy` | a spec defines a rule |
| `document --references--> policy` (or node) | documentation pointer |

Full `LinkKindType` vocabulary: `uses`, `produces`, `results_in`, `gets_data_from`, `inserts_data_into`, `informs`, `drives`, `constrains`, `defines`, `executes`, `references`, `validates`, `measures`, `simulates`, `contains` (for `group` nodes), `used_by` (inverse of `uses`). There is no literal "facilitates" — model it with `informs` / `gets_data_from`.

## Elicitation workflow

Run this with the stakeholder; it mirrors the workshop sequence. Capture **problems, not solutions** until the graph is built. Use `AskUserQuestion` to drive each step.

```
1. PAIN     → What blocks target KPIs / creates bottlenecks? (capture, don't solve)
2. ACTIVITIES → List primary value-creating activities → `process` nodes
3. RESOURCES  → For each: what does it use / produce? → `resource` + uses/produces
4. MEASURE    → How is each measured? → `kpi` + measures / results_in
5. FACILITATE → Which data/systems feed it? → `data` + informs / gets_data_from
6. DRIVE      → What decision sets how resources are used? → `decision` + drives
6b. OWN       → Who executes it / makes that call? → `agent` + executes
7. OBJECTIVES → What goals do the KPIs serve? → `objective` + kpi drives objective
8. CONSTRAIN  → What rules limit activities? → `policy` + constrains (+ `document` defines)
9. PRIORITISE → Which decisions, if improved, move objectives most? → the AI/opt backlog
```

Start from the **biggest pain points** — don't try to model the whole business. The output of step 9 is the real deliverable: a ranked list of decisions worth improving.

### The activity table (intermediate artifact)

Before drawing the graph, fill one row per activity. Each row mechanically expands into nodes + links:

| Activity | Uses (resources) | Produces (resources) | Measured by (KPIs) | Facilitated by (data/systems) | Driven by (decision) | Owned by (agent) |
|---|---|---|---|---|---|---|
| Source raw milk | farm supplier base, demand forecast | raw-milk availability, supply contracts | fortnightly farmgate vs benchmark | SAP, supplier system | how much milk to contract, by region/term | procurement team |

Row → one `process` node, one `resource` per cell entry (dedup across rows by `id`), and a link per relationship using the canonical directions above. Decisions and objectives come last and attach with `drives`.

## Encode + render

The graph is the value of a single `OntologyType`-typed `e3.input`, surfaced through a `Data.bind` binding. Spell the default value out **fully inline** — no `node()` / `link()` helpers, every `variant()` / `some()` / `none` at the construction site.

```typescript
import { East, some, none, variant } from '@elaraai/east';
import { Reactive, UIComponentType } from '@elaraai/east-ui';
import { Data, Ontology, OntologyType } from '@elaraai/e3-ui';
import * as e3 from '@elaraai/e3';

const ontology = e3.input('supply_chain', OntologyType, {
  nodes: [
    { id: 'obj-1',  name: 'Reduce stockouts', description: some('FY26 target.'), type: variant('objective', null) },
    { id: 'kpi-1',  name: 'Fill rate',        description: none,                  type: variant('kpi',       null) },
    { id: 'proc-1', name: 'Source raw milk',  description: none,                  type: variant('process',   null) },
    { id: 'res-1',  name: 'Pallet inventory', description: none,                  type: variant('resource',  null) },
    { id: 'dec-1',  name: 'Contract volume',  description: none,                  type: variant('decision',  null) },
  ],
  links: [
    { id: 'l-1', source: 'proc-1', target: 'res-1', type: variant('produces',  null) },
    { id: 'l-2', source: 'kpi-1',  target: 'proc-1', type: variant('measures', null) },
    { id: 'l-3', source: 'kpi-1',  target: 'obj-1',  type: variant('drives',   null) },
    { id: 'l-4', source: 'dec-1',  target: 'proc-1', type: variant('drives',   null) },
  ],
  metadata: some({
    version: '1.0.0',
    created: new Date('2026-01-15T00:00:00Z'),
    updated: new Date('2026-05-01T12:00:00Z'),
    description: some('Supply-chain operations ontology.'),
  }),
});

const editor = East.function([], UIComponentType, (_$) =>
  Reactive.Root(East.function([], UIComponentType, $ => {
    const view = $.let(Data.bind(ontology));
    return Ontology.Root({ binding: view.binding });
  })),
);
```

### `Ontology.Root` options

`Ontology.Root({ value, ... })` — only `value` is required (pass the `Data.bind` handle over an `OntologyType` dataset). Options: `readonly` (hide mutation surfaces; commit-bar + drawer still render), `hideMiniMap`, `hideSearch`, `density` (`'comfortable'` | `'compact'` | `'condensed'`), `defaultView` (`'graph'` | `'table'` — the header's segmented control switches at runtime either way), `onCommitted` / `onDiscarded`, `style` (per-surface colour escape hatches — see `OntologyStyleType`).

### The table view

The editor's header has a segmented `Graph | Table` control. The table is a value-driver-tree projection of the same bound value: rows are `process` nodes **grouped by the objective they serve** (via KPI `drives` paths), ordered by **value-chain stage** (topological order of `uses`/`produces` resource flow, with cycles — e.g. cash → materials → goods → cash — condensed, sharing a stage, and flagged ↺). Each row shows uses/produces/KPIs/data/**decisions**/policies plus owning agents; expanding a row reveals what feeds it and what it feeds (with the carrying resources) and completeness warnings (no inputs, no outputs, no KPI, no decision). Hovering any chip highlights every occurrence of that node across the table.

### Edit modes, commit, and Diff

The editor uses the same staged-buffer machinery as `Diff`. `Data.bind(dataset)` **without `mode`** stages edits — the footer commit-bar applies or discards them, and you can stack a `Diff.Root({ bindings: [view.binding] })` beside the editor to review the pending node/link patch before commit. Pass `{ mode: 'direct' }` to write each mutation straight back instead (good for read-mostly demos). For a locked view, `readonly: some(true)`.

## Validation

- **`id` uniqueness** — every node `id` is distinct; link `id`s too.
- **No orphan links** — each link's `source` and `target` must match a node `id`; the editor surfaces orphans as warnings.
- **Direction matches semantics** — follow the canonical table; e.g. KPI is the `source` of `measures`, the activity is the `target`.
- **Objectives are apexes** — they should be reachable from KPIs/decisions via `drives`, not dangling.

## From ontology to initiatives

The graph exists to find the decisions worth improving. For each `decision` node, the question is: *what's the best way to use its resources to hit the connected KPIs and objectives?* That's an optimization/ML problem — hand it to **east-py-datascience** (MADS / Optuna / SimAnneal / GoogleOr for the decision, XGBoost / NGBoost for the forecasts that feed it) wrapped as **e3** tasks. Use the **east-design** skill to turn the prioritised decision list into that build.

## Related skills

- **e3-ui** — the `Ontology`, `Data.bind`, and `Diff` API this builds on (and `ui()` to ship the editor as an e3 task).
- **east-ui** — layout (`Card`, `Stack`) for composing the editor into a dashboard.
- **east-design** — turn the prioritised decisions into an implementation plan.
- **east-py-datascience** — the optimization / ML that improves a targeted decision.
- **east-project** — scaffold the e3 project that hosts the ontology + decision tasks.

## Example searches

Ground the encoding in real graphs via `search_east_examples`:
- `Ontology supply-chain process kpi objective` — a full activity/resource/KPI graph
- `Ontology governance policy decision document` — policy/decision/document-heavy graph
- `Ontology Diff review pending patch` — editor + Diff panel for staged commits
- `Ontology readonly viewer` — locked, mutation-free view
- `Ontology density compact` — density presets
