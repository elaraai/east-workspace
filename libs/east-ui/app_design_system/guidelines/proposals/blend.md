# `<Blend>` — assembly surface for blending / batching decisions

> **Status: implemented.** Deltas from this proposal per the settled
> conventions: fields-form `target` mapper (`Blend.target` dissolved;
> `Blend.allocation` / `Blend.metric` remain as expression-level value
> constructors); `title` removed (bare component); allocation `state` is
> typed `PlannerStateType`; metrics carry `numeric` for the derived Δ;
> optimistic interactive-state renderer (drops / amount edits / removals
> apply locally, callbacks persist); Library A/B badges deferred (panel
> badges carry A/B); no cross-target drag gesture in v1 (grammar-pure
> add/remove via the Library, plus visible remove buttons).

Source spec: `configure__pattern__workbench` (`Collections.Workbench`) —
renamed **Blend** per direction. Category: `collections/blend`.
"What proportion of what": pull amounts from many sources into one or more
targets. Pairs with a `<Library>` on the left; **one pattern, three render
modes** driven by the number of targets:

- `single` (N=1) — focus: source list · composition · metrics, full width
- `compare` (N=2) — side-by-side + **auto diff table** at the foot
- `portfolio` (N≥3) — horizontal scroll of target cards (day/shift plans)

## Anatomy (from spec, single mode)

- Frame: eyebrow (`WORKBENCH · TARGET BLEND-318 · CAP 40,000 U`) +
  header-right context (`3 SOURCES · 14,000 U HEADROOM · OBJ: MIN COST …`).
- Target panel:
  - **Composition bar** — stacked segments per allocation + hatched headroom
    remainder, with an axis (`0 · 10k · 20k · 30k · 40k`).
  - **Allocation rows** — source id + class/site sublabel, amount (editable
    in proposed state), share %; a dashed **drop area** (`drop a source
    here`) below the rows.
  - **Predicted metrics** — label / value / trust-chip rows
    (`predicted grade A− · blend-v2.1`, `cost / unit $3.42 · cost-v1.4`,
    `spec X (interp.) 3.62 · band 3.55–3.68`).
  - **Objective line** (`objective min cost · Grade ≥ A · respect pins`) and
    actions `Reset · Optimise · Apply blend`.
- Compare mode: A/B chips on the shared source pool cards, per-target panels,
  and the diff table (`metric · target A · target B · Δ (B−A)`) with a verdict
  line (`A wins on cost · B wins on grade…`) + `Discard B · Optimise both ·
  Apply A`.

## TSX

```tsx
<Blend
    id="bench"                                       // DnD target id
    sources={["materials"]}                          // permitted Library ids
    targets={blends}                                 // ArrayType(StructType) — 1 = single, 2 = compare, 3+ = portfolio
    target={t => Blend.target({
        key: t.key,                                  // "BLEND-318a"
        label: t.label,
        capacity: t.capacity, unit: "u",
        objective: t.objective,                      // "min cost · Grade ≥ A · respect pins"
        allocations: t.allocations.map(a => Blend.allocation({
            source: a.sourceId,                      // Library item key — face comes from the Library card
            label: a.sourceId, sublabel: a.meta,     // overridable face for standalone use
            amount: a.amount,                        // FloatType, editable while proposed
            pinned: a.pinned,                        // "respect pins" — excluded from optimise + drag-out
            state: a.state,                          // "committed" | "added" | "removed"
        })),
        metrics: [
            Blend.metric({ key: "grade", label: "predicted grade", value: t.grade,    model: "blend-v2.1" }),
            Blend.metric({ key: "cost",  label: "cost / unit",     value: t.cost,     model: "cost-v1.4" }),
            Blend.metric({ key: "specx", label: "spec X (interp.)", value: t.specX,   band: { min: 3.55, max: 3.68 } }),
        ],
    })}
    diff={["grade", "cost", "capacity"]}             // compare mode: metric keys for the foot table
    verdict={East.str`A wins on cost · B wins on grade · pick by today's objective`}
    title="Workbench · target BLEND-318 · cap 40,000 u"
    onDrag={onDrag}                                  // add (from Library) / remove (back) — no move
    onAmountChange={onAmountChange}                  // (targetKey, sourceKey, amount) → proposed patch
    onAction={onAction}                              // Blend.Action variant: reset | optimise | apply | discard, per target
/>
```

## Props (`BlendConfig<R>`)

| Prop | Type | Notes |
|---|---|---|
| `id` | `string` | DnD target identity |
| `sources?` | `string[]` | Library ids accepted for `add` |
| `targets` | `SubtypeExprOrValue<ArrayType<R>>` | data; length picks the render mode |
| `target` | `(t) => Blend.target(...)` | per-target panel definition |
| `diff?` | `string[]` | metric keys in the compare foot table (compare mode only; default = all metrics) |
| `verdict?` | `SubtypeExprOrValue<StringType>` | compare verdict line |
| `title` | `SubtypeExprOrValue<StringType>` | frame eyebrow |
| `onDrag?` | `FunctionType([DragEventType], NullType)` | `add` / `remove` only (per the matrix — no intra-surface move) |
| `onAmountChange?` | `FunctionType([BlendAmountEventType], NullType)` | typed `{ target, source, amount }` |
| `onAction?` | `FunctionType([BlendActionEventType], NullType)` | `{ target: Option<String>, action: reset \| optimise \| apply \| discard }` |

Sub-constructors: `Blend.target`, `Blend.allocation`, `Blend.metric`.
The diff table and Δ column are **derived by the renderer** from the two
targets' metrics (numeric Δ for numbers, step delta for grades) — the host
doesn't compute the comparison.

## DnD semantics (per the matrix)

- `add` from a declared Library → new proposed allocation (amount starts at
  the dragged card's available quantity or a configured default; host
  confirms via `onAmountChange`).
- `remove` — drag an allocation row back to the Library (or trash). Pinned
  allocations are not draggable.
- **No `move`** — within a single target there is no position; in
  compare/portfolio mode dragging between targets is modelled as
  `remove` + `add` (two patches), keeping the grammar's "move is
  intra-surface" rule intact.
- Composition bar + drop area highlight with the standard brand-tint/outline
  treatment during an eligible drag.

## Renderer notes

- New slot recipe `blend` (frame / sourceStrip / target / compositionBar /
  segment / headroom / allocationRow / amount / dropArea / metricRow /
  trustChip / objective / actions / diffTable / verdict).
- Composition bar reuses the segmentedMeter building block; metric rows reuse
  the kv + trust-chip patterns; actions are standard buttons (`Apply` solid).
- The A/B badges on shared-pool Library cards come from the DragLayer
  connection (Library renders a per-target badge when 2+ targets declare the
  same source pool) — no Library config needed.

## Decisions (reviewed)

1. **Flow strip ships in v1** — thin ribbons from the source strip to the
   composition bar, derived entirely from the allocations (no extra props);
   `flowStrip` joins the slot recipe.
2. `optimise` is host-side: the component only emits the action event and
   re-renders from data.
3. Portfolio mode = uniform full target panels in a horizontal scroll.
