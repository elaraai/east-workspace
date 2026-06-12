# Decision loop — code design

Status: **proposed** (awaiting review). Companion to the visual spec —
`design/decide.html` (patterns, incl. the `Decision.Handle` architecture
block) and `design/use-cases.html` §3 (the seven-station loop and the three
decision tiers). This document is the build plan for the Decide component
family in `@elaraai/e3-ui` / `@elaraai/e3-ui-components`.

## Why

Decide is the front page of the platform: everything beneath it (ontology,
integrate/reason/compute, bindings) exists so an operator can commit one kind
of decision with defensible evidence. The loop the operator runs is fixed
(use-cases §3): **Triage → Understand → Probe → Compare → Judge → Commit →
Communicate**, with named back-edges, judgement gating commit, and the loop
always closing back to Triage.

The architectural rule that makes this buildable is the one the
`DecisionQueue` already follows: **components are pure projections of bound
data; every interaction is a write through a binding; every consequence is
observed, never short-circuited.** The loop formalizes that as *one handle
per surface*.

## Data flow — decisions come from many tasks

Real queues are unions. One reasoning task optimises the roster, another the
orders; each emits its own `ArrayType(DecisionType)` output for its decision
kind. Task outputs are **read-only and recomputed** — and the platform
already has the mechanism for operating on a read-only source: the **diff
binding** (`Data.bind(source, { patch })`). The patch input durably records
the operator's changes against the source; the bound view is source ⊕ patch;
staleness after a re-run is surfaced by `binding.status()` and reviewed /
committed / discarded through the existing `Diff` machinery. Each decision
source gets its own patch overlay.

```
roster data ──► task: optimise_roster ──► decisions_roster ⊕ patch_roster ─┐
order data  ──► task: optimise_orders ──► decisions_orders ⊕ patch_orders ─┤ union
                          ▲      ▲                              ▲          ├──► visible queue ──► DecisionQueue rows
                          │      │     writes routed by caseId ─┘          │
                          │      └──────────── judgements ◄────────────────┘
                          │                    (staged input: answers · knowledge ·
                          │                     constraints · verdict, keyed by caseId)
                          └── next dataflow run reads judgements:
                              fold injected constraints into the optimisation,
                              retire cases whose verdict is set
```

Three consequences fall out:

1. **Resolve writes twice, through existing mechanisms.** Apply/Reject write
   the `verdict` into the case's staged judgement (the audit record and the
   task's retirement signal) *and* the case's removal through the owning
   source's patch overlay (exactly what the queue's writers already do in
   patch mode). The row leaves because the bound view no longer contains it;
   the exit animation keys off observed data diffs, so it works unchanged.
   When the task later re-emits without the resolved case, the patch's
   removal reconciles to a no-op.
2. **The modify→recalc loop is judgement-mediated; the immediate edit is the
   patch.** `update(edited)` (the probe editor) writes the edited decision
   through the owning diff binding — visible immediately, durably staged.
   `inject(constraint)` writes a `ConstraintType` into the judgement; the
   task depends on the judgements input, so commit re-runs the optimiser
   with the constraint folded in, and the re-emitted decision supersedes the
   staged edit (stale-patch review via `status()` / `Diff`).
3. **Tasks own convergence.** A reasoning task's contract: read its domain
   data + the judgements input; fold constraints for its cases into the
   optimisation; don't emit cases whose verdict is set (retire them to
   history). Until a task honours judgements, the patch overlay keeps the
   UI correct anyway.

## Probe is a slot, not a component

How a decision is probed varies per decision kind — a couple of inputs, a
mini interactive UI, a combination of levers into a discrete simulation. The
probe contract is therefore the queue's existing `modify` option:

```ts
modify?: (decision, update) => UIComponentType
```

authored once per decision kind and rendered in **both** places — the queue
row's in-place expansion and the briefing's Modify-in-place (same option
type, so one probe serves both). Inside it, anything composes: form
controls writing `update(edited)` / `inject(constraint)`, and — once e3
exposes async function-calling RPC as platform functions — live impact
calls ("what would this modification do?") rendered alongside the controls.
Impact preview is read-only RPC, so the handle is unaffected: levers write
through the binding, previews just read.

## The handle — `Decision.bind`

A new platform binding in `@elaraai/e3-ui`, the Decide sibling of
`Slice.bind` / `Data.bind`. Bound once at the surface boundary inside a
`<Reactive>` block:

```tsx
const rosterView = $.let(Data.bind(rosterTask.output, { patch: rosterPatch }));
const ordersView = $.let(Data.bind(ordersTask.output, { patch: ordersPatch }));
const judgementsView = $.let(Data.bind(judgementsInput, { mode: 'staged' }));
const handle = $.let(Decision.bind({
    decisions: [rosterView, ordersView],   // diff bindings — source ⊕ patch each
    judgements: judgementsView,            // staged binding — commit / discard / status for free
}));
```

Everything the handle composes is a binding — the decision views and the
judgements view alike. `Decision.bind` adds the cross-cutting pieces only it
can: the union, write-routing by case id, the selection, and the derived
commit gate.

The selection — `Option(caseId)`, the currently open case — is owned by the
handle, not configured: it lives in workspace-scoped `State` under a key the
handle derives from its bound paths (deterministic, so it survives reloads
and stays addressable for the spec's deep-link invariant — without users
ever naming it). `select(caseId)` writes it, the briefing reads it,
`resolve` clears it — that clearing *is* the loop closing back to Triage.
Everything consuming the same handle shares the selection through the
handle; it's ephemeral UI state, deliberately not a dataset, so it never
pollutes dataflow inputs or the audit trail.

`Decision.bind` is a platform function (the `Data.bind` / `Slice.bind`
pattern): the East layer declares the handle's contract; the runtime in
`@elaraai/e3-ui-components` implements its closures once — unioning the
per-source views, routing writes to the owning source by case id, owning
the selection, deriving the commit gate. Component payloads are
beast2-encoded, so they never carry the closure-rich handle itself: the
factories embed the handle's *ref* (its binding descriptors — plain data)
and the renderer reconstructs the live handle from it. Single-task surfaces
pass one view; the seeded-input demo form is just a view whose source
happens to be an input.

### What the handle owns

| Concern | Storage | Read by | Written by |
|---|---|---|---|
| The queue | union of the bound views (source ⊕ patch each) | every station | Probe `update(edited)`, Commit `resolve` (removal) — through the owning patch |
| Case selection | `State` (handle-derived key) | the expanded row | Triage `select`, cleared on resolve |
| Judgement | the bound judgements view (staged) | Judge, Commit gate, tasks | `answer` / `addKnowledge` / `inject` / `resolve` (verdict) |
| Commit state | derived, never stored | Commit.Bar | — |

### Closure helpers (runtime-implemented, callable East-side)

- `handle.select(caseId)` / `handle.clearSelection()` / `handle.selected()`
- `handle.decision()` — `Option(DecisionType)` for the selected case (post-projection)
- `handle.update(edited)` — probe edit through the owning source's diff binding
- `handle.judgement(caseId)` — the staged `JudgementInputType` (created on first write)
- `handle.answer(caseId, prompt, answer)` · `handle.addKnowledge(caseId, text)` · `handle.inject(caseId, constraint)`
- `handle.resolve(caseId, verdict)` — writes the verdict to the judgement,
  removes the case through the owning patch, clears the selection (closes
  the loop)

### Renderer runtime

`useDecisionHandle(descriptor)` in `e3-ui-components/src/decision/` resolves
the descriptor to `{ decisions /* projected */, selected, judgementFor,
commitStateFor, select, update, answer, resolve, … }`, subscribing to every
bound view — decisions and judgements alike (the `useBindingDecisions`
pattern, extended to a list of bindings). Components never touch stores directly. Per-source provenance
(which task, which run) comes from the platform alongside each source.

### Derived commit state (per case)

```
gated(n)   — n judgement prompts unanswered
blocked    — some prompt answered `no`
handoff    — some prompt answered `unknown` (routes to Communicate later)
ready      — all prompts answered `yes` (or no prompts)
```

Apply is enabled exactly when `ready` — a data condition, not component
state. Resolved isn't a state: a resolved case has left the projection.

## Type changes (Phase 0, breaking — pre-release)

In `e3-ui/src/decision/types.ts`, same philosophy as the existing file
(required core, optional rest, primitives, `Format` reuse):

```ts
// NEW — drives the briefing chip row now; confirm/approval gating later.
StakesType = StructType({
    level: VariantType({ low, medium, high, critical }),
    reversible: OptionType(BooleanType),
    radius: OptionType(StringType),            // "3 people" — prose blast radius
})

// NEW — evidence chips ("FORECAST · SE +14% · next 2 wks · holiday driver").
EvidenceType = StructType({
    label: StringType,
    text: StringType,
    note: OptionType(StringType),
})

DecisionType:
    evidence: ArrayType(StringType)  →  ArrayType(EvidenceType)
  + stakes: OptionType(StakesType)
  + prompts: ArrayType(StringType)             // judgement checklist; one entry = the operational case

DecisionOptionType:
  + confidence: OptionType(FloatType)          // Scenario.Ranked shows per-option conf

JudgementInputType:
  + answers: DictType(StringType, VariantType({ yes, no, unknown }))   // keyed by prompt
    verdict: OptionType(StringType)  →  OptionType(VariantType({
        accepted: StringType,                  // the chosen option label ("" = the recommendation)
        rejected: NullType,
        deferred: OptionType(StringType),      // optional note ("revisit after wk 12")
        handoff: StringType,                   // recipient / routing note — the "don't know" exit
    }))
```

Storage conventions (not new types): the judgements dataset is
`DictType(StringType, JudgementInputType)` keyed by caseId — dict patches
give per-case write granularity for the staged store. Each decision source
keeps its own patch overlay (standard diff binding). Case ids must be
unique across tasks (convention: `<kind>-…`, as the existing seeds already
do).

Not added (deliberate): confidence decomposition (headline `confidence`
suffices for v1), run/model/case metadata (platform-supplied per source),
peer/base-rate reference fields (deferred with their components).

## Components

The public Decide API is the handle plus two surfaces:

- **`Decision.bind`** — the per-surface handle (above).
- **`DecisionQueue`** — *the* Decide surface. One queue over the handle's
  unioned cases, urgency-sorted with the routine tail collapsed behind a
  bulk-accept band. The case view is the row's expanded state, not a
  sibling component: selecting a row opens **one compact facet at a time**
  beneath it, swapped by the row's segmented toggles (the `facetTabs`
  recipe — mono, joined, active segment solid brand):
  - `Evidence` — the model's argument: stakes / if-wrong / confidence
    line, typed evidence chips, and the host's per-decision `detail`
    canvas (`detail: (decision) => UIComponentType`, the Table
    cell-render idiom).
  - `Options` — the recommendation and its alternatives ranked by uplift,
    downside and uplift bars sharing a zero anchor; stacks to meter cards
    in narrow hosts.
  - `Judgement` — prompts (gating Apply), knowledge capture, staged
    constraint chips, and the lever builder with typed editors derived
    from the solution's constraint contract; the gate hint and Defer form
    its footer. The toggle pulses while the gate is closed.
  - `Modify` — the host's per-kind probe via the `modify` slot.

  Apply / Reject stay on the row (Apply disabled-with-reason from commit
  state) and resolve through the handle; the verdict-aware exit animation
  is data-driven. `defaultExpanded` (a decision expression — derive it
  from the data, never an id literal) and `defaultFacet` set the initial
  view; `maxHeight` pins the header and scrolls the rows. Narrow hosts
  (~<560px) wrap rows to two lines with a full-width facet segment.
- **`DecisionJournal`** — the Decide↔Trust seam: resolved cases newest
  first (verdict, rationale quote, injected constraint chips, resolution
  time) — the projection of the judgements view *with* verdicts, the
  exact complement of the queue's projection without them.

The former standalone components (Briefing, Alternatives, Commit.Bar,
Judgement.Panel) were folded into the queue's facets — their renderers
live on as internal building blocks; their factories, JSX tags and
payloads are gone.

### Deferred until their data exists

`Decision.Diff` (needs a prior-run binding), `Communicate.*`
(recipients/routing), `Commit.Approval` (identity), typed-confirm
(stakes-gated `Commit.Confirm`), Slice-composed queue filter, and row
virtualization for very large queues.

## Examples / verification

- `test/decision/queue.examples.tsx` — the contract (`RosterConstraint`:
  bounded float lever + struct blackout lever) plus one queue: each facet
  open via `defaultFacet`, the narrow (~360px container) variant, and a
  `maxHeight` scroll case.
- `test/decision/loop.examples.tsx` — the multi-task scene: two seeded
  "task output" datasets union into one queue, judgement gating Apply,
  the journal beneath — the full loop without a live dataflow.
- `test/decision/journal.examples.tsx` — resolved-case projection.
- Snapshots compared against `dist-design/decide__pattern__decision-queue`
  and `…__decision-journal`; handle semantics covered by East-side spec
  tests.

## References — nothing stringly at use sites

The reference design, settled after the constraint-vocabulary review. The
rule everywhere: **a name is born at exactly one declaration site (or inside
the data itself); every reference flows through a typed handle, a by-name
variant, or an expression over the data.**

### Spec vs response — the envelope duality

Everything judgement-related splits into a task-authored **spec** (in the
decision envelope) and an operator-authored **response** (in the judgement
record); the handle joins them by case id:

| Decision envelope (task output, read-only) | Judgement record (operator input, staged) |
|---|---|
| `prompts: [{id, text}]` — the gate questions | `answers: Dict(promptId → yes/no/unknown)` |
| `levers: [{case, label}]` — what may be constrained | `constraints: [SolutionConstraint]` |
| `alternatives` (each with optional `id`) | `verdict: accepted(optionId) / …` |

Responses never live in the decision: decisions are regenerated wholesale by
every task run, so operator state stored there would be clobbered and writes
would race the task. The two-dataset split is lifecycle, not taste.

### Constraints — a solution-declared East variant

The constraint contract is an East `VariantType` declared once in the
solution package and imported by both the reasoning task and the surface.
Variants are by-name, validated at the dataset boundary, and matched with
`$.matchTag` — strictly stronger than any TS string const, and lever
payloads can be arbitrary East types (bounded-op variants for numerics,
structs for blackouts / pins):

```ts
export const RosterConstraint = VariantType({
    cho_hours_cap: VariantType({ atMost: FloatType, between: StructType({ min: FloatType, max: FloatType }) }),
    blackout:      StructType({ person: StringType, from: DateTimeType, to: DateTimeType }),
});
export const judgements = e3.input('roster_judgements',
    DictType(StringType, Decision.Types.JudgementInput(RosterConstraint)), new Map());
```

`JudgementInputType` is generic over the constraint variant (the
`sliceConfigFor(rowType)` precedent), defaulting to the primitive op-variant
for solutions that don't declare one. A decision's `levers` name which
variant cases apply to that case; the panel's builder renders a typed editor
from the case's payload type (derived from the judgements binding's
registered type — renderer-side, like `EastValueViewer`). `Decision.bind`
has **no** vocabulary option: the task that interprets constraints is the
only author of what can be constrained.

### Case identity — data-flow only

Case ids are minted by the task (like ontology node ids) and flow only as
data: selection is the primary reference (queue click → `handle.selected`
→ surfaces with `case` omitted follow); pinning derives the decision from
the bound data (`case` accepts a decision expression — the factory takes
`.id`); the runtime writes judgement keys / verdict routing from the
decision in hand. Literal ids belong only to deep links. A dangling
reference renders nothing — which is the briefing-closes-on-resolve
behaviour, not an error path.

## Open questions

1. **Source provenance surface** — how much per-source run/model metadata the
   briefing eyebrow shows in Phase 2, and where the platform exposes it on
   the binding.
2. **Stale-patch review surface** — when a re-run changes a source under a
   pending patch, `binding.status()` flags it; where does the operator
   review it in Phase 1 (the existing `Diff` component embedded in the
   briefing rail, or defer to the standard staged-commit surface)? Proposal:
   defer to the standard surface in Phase 1.
