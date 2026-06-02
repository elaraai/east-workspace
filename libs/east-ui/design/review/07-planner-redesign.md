# Planner redesign — design + plan

Status: **proposed, for review.** Validating prototype:
`packages/east-ui/contrib/planner-spec-proto.ts` (compiles clean under the
package's strict tsconfig — every worked example below typechecks against the
real `@elaraai/east` + `@elaraai/east-ui`).

This document proposes replacing the current `Collections.Planner` IR and
renderer. It is modelled on the **`Chart.Spec` interface style** (not the Gantt
interface) and is the column/axis model we intend to converge Table and Gantt
onto afterwards.

---

## 0. Hard constraints (non-negotiable)

These bind the renderer work (Phase 3) and override any convenience:

1. **Pixel-perfect parity with the spec.** The rendered Planner must match
   `design/configure.html#planner` and its PNG
   (`dist-design/configure__pattern__planner.png`) exactly — event chrome,
   bucket grid, now-line + pip, conflict ring + badge, row/cell rhythm, the
   left-column header type. Verified pixel-level via the snapshot/probe loop
   (`make probe-collections` + `make east-ui-examples-html-*` → **Read the
   PNG**), diffing against `configure__pattern__planner`. "Close" is not done.

2. **Every visual value lives in a theme slot recipe.** All styling is
   **recipe-driven** — a `planner` slot recipe (+ the shared table column-header
   chrome + the general Popover recipe), consuming Chakra semantic tokens.
   **Zero inline styles, zero hardcoded hex/px** in the renderer components;
   components consume recipe slots / tokens only. The recipe is the single
   source of truth for the spec values, so the design tokens never rot into the
   components. (Per the theme-single-source and bsys-building-blocks rules.)

---

## 1. Why replace it

The current Planner (`src/collections/planner`, renderer
`east-ui-components/src/collections/planner`) is a **continuous float-axis**
model: a TanStack table on the left and an absolutely-positioned SVG slot grid
on the right, with per-event `colorPalette` / `background` / `stroke` /
`opacity` / `overlays` / `tooltip` escapes and a `slotMode` (single/span) style
flag.

The canonical spec (`design/configure.html#planner`, `design/spec.css`) is a
different thing: a **discrete `rows × ordered slots` grid** where each cell holds
zero or more **events** in one of three audit states, with **labelled sub-slot
buckets**, a **now-line**, **declared-conflict markers**, and a small set of
**typed left columns**. None of that is expressible in the float-axis model —
it's a rebuild, not a patch. The earlier review (`00-STATUS.md`,
`00-RECONCILIATION.md`) already flagged Planner as "rebuild or recipe-delete,
blocked on a design decision." This is that decision.

---

## 2. Design philosophy — what we took from `Chart.Spec`

`Chart.Spec` (`src/charts/spec`) is the reference for a *good* east-ui IR. The
lessons we adopt:

1. **Typed coordinates whose arm derives behaviour.** `ChartXType`
   (`category`/`number`/`time`) picks the scale from the data. Planner gets
   `PlannerSlotType` (`time`/`number`/`ordinal`) — the arm picks the axis kind,
   enforcing the spec's "one axis type per Planner" rule and the configurable
   datetime/numeric/ordinal axis.
2. **Data-derived domains.** The renderer derives the column set from the slot
   values (with an optional explicit `range`); the author never hand-places
   columns.
3. **A builder namespace with a `.Types.*` mirror**, and flat-object factories
   that normalise `some` / `none` / `variant` so call sites stay clean.
4. **Typed-arm vocabularies, not optional-boolean god-structs** — event `state`,
   the axis `scale`, conflict `severity` are variants.

### What we deliberately did **not** take: recursion

`ChartSpec` is a `RecursiveType` because a chart is an *open-ended composition*
(frames nest groups nest marks). A Planner is a **fixed shape**:
`root → axis + columns + rows`, `row → cells + events`, `event` is a leaf. A
recursive node-variant would make illegal states representable (an event
"containing" a row), buys authors no composition they need, and complicates the
renderer. So the IR is plain nested `StructType` / `ArrayType` at a fixed depth.
The one open-ended thing — an event's rich `popover` — delegates to
`UIComponentType`, which is *already* the recursive type. Recursion exactly
where it belongs, nowhere it doesn't.

> The takeaway for the later Table/Gantt convergence: adopt the `Chart.Spec`
> *interface style*, not its tree shape.

---

## 3. Scope

**In (v1):** typed axis + configurable labelled buckets; value/eyebrow left
columns + `groupBy`; the three-state event grammar; conflict markers; the
now-line; per-event `popover`; `density`; **Point + Span** variants.

**Deferred:** drag-and-drop interactions (add / move / remove / resize);
recurring **templates**; the **Summary** variant; per-row now override;
`resource` drop-target / Library integration; nested row hierarchies.

These cuts were taken deliberately during review — see §8.

---

## 4. The IR

Seventeen small types. Domain-neutral throughout. (Source of truth: the
prototype; reproduced here abridged.)

### 4.1 Axis — the spine

```ts
// One typed slot coordinate; the arm chooses the axis scale.
PlannerSlotType  = VariantType({ time: DateTimeType, number: FloatType, ordinal: StringType });
PlannerScaleType = VariantType({ time: NullType, number: NullType, ordinal: NullType });

// A labelled sub-slot bucket. An arbitrary labelled array — never a bare count.
PlannerBucketType = StructType({ key: StringType, label: StringType });

// Optional explicit domain (else derived from the data).
PlannerRangeType = VariantType({
  time:    StructType({ min: DateTimeType, max: DateTimeType }),
  number:  StructType({ min: FloatType, max: FloatType }),
  ordinal: ArrayType(StringType),
});

PlannerAxisType = StructType({
  scale:   PlannerScaleType,
  buckets: ArrayType(PlannerBucketType),   // [] = one slot per column
  range:   OptionType(PlannerRangeType),
  format:  OptionType(StringType),         // tick-label pattern
});
```

Spec backing: axis is `datetime` / `numeric` / `ordinal` ("one axis type per
Planner"); `slotsPerColumn = ['AM','PM']` is an arbitrary **labelled** array
("a bare `slotsPerColumn = 2` is rejected — operators need the bucket name").

### 4.2 Events — the three-state grammar

```ts
PlannerFlavourType  = VariantType({ added: NullType, model: NullType, removed: NullType });
PlannerStateType    = VariantType({ committed: NullType, proposed: PlannerFlavourType, rejected: NullType });

PlannerSeverityType = VariantType({ error: NullType, warning: NullType, info: NullType });
PlannerConflictType = StructType({ message: StringType, severity: PlannerSeverityType });

PlannerEventType = StructType({
  slot:     PlannerSlotType,
  endSlot:  OptionType(PlannerSlotType),     // Span only
  bucket:   OptionType(StringType),          // a declared bucket key
  label:    StringType,
  state:    PlannerStateType,
  conflict: OptionType(PlannerConflictType), // the invariant marker
  popover:  OptionType(UIComponentType),     // click body (popover-only)
});
```

The flavour rides *inside* the `proposed` arm — a committed event can never
carry a flavour (type-enforced). `committed` = audit-locked / read-only;
`proposed{added}` = operator draft; `proposed{model}` = model suggestion
(italic); `proposed{removed}` = proposed deletion of a committed event
(struck-through); `rejected` = kept for diff.

**Conflicts (the simplified "invariant"):** the spec wants conflict markers to
come from *declared rules*, not host-decorated red borders. We keep that
intent but split it cleanly: the **consumer computes the rule in East** (they
already have the whole language) and tags the offending events; the
**library only renders** the ring + badge from the `conflict` field. No rule
type, no engine, in the IR. Capacity overflow is just one such rule.

### 4.3 Left columns — one flat shape (value + eyebrow)

```ts
PlannerAlignType  = VariantType({ start: NullType, end: NullType });

PlannerColumnType = StructType({
  key:    StringType,
  header: StringType,
  width:  OptionType(StringType),
  frozen: OptionType(BooleanType),   // sticky-left (identity)
  align:  OptionType(PlannerAlignType),
});

PlannerCellType = StructType({
  value:    StringType,              // name / number / derived East value
  sublabel: OptionType(StringType),  // muted eyebrow line
});
```

This is the **same flat shape as Table/Gantt** — key + header + width + a
per-row value, no "column kinds." The spec's five kinds become *patterns you
write*, not API surface:

| Spec kind | How you build it |
|---|---|
| identity | `frozen: true`, `value` = name, `sublabel` = meta |
| derived | `value: r => East.print(r.events.size())` — a plain East expression (reactive recompute for free) |
| capacity | `value: r => East.str\`${used} / ${max} h\`` + a conflict rule for over-cap |
| action / custom / resource | deferred (a `render` escape hatch + DnD later) |

`.planner-rh .name` / `.meta` in the spec CSS is exactly `value` + `sublabel`;
the renderer styles them from the row-header recipe.

### 4.4 Shell

```ts
PlannerRowType     = StructType({ group: OptionType(StringType), cells: DictType(StringType, PlannerCellType), events: ArrayType(PlannerEventType) });
PlannerVariantType = VariantType({ point: NullType, span: NullType });
PlannerRootType    = StructType({
  variant:     PlannerVariantType,
  axis:        PlannerAxisType,
  columns:     ArrayType(PlannerColumnType),
  rows:        ArrayType(PlannerRowType),
  now:         OptionType(PlannerSlotType),   // explicit; else derived from data
  density:     OptionType(DensityType),
  onSelectRow: OptionType(FunctionType([PlannerSelectEventType], NullType)),
});
```

Rows are identified by **index** (no stable id needed without cross-row DnD).
`group` is the flat group-head label (`groupBy`). `now` is the optional explicit
committed/proposed divider — omit it and the renderer derives it from the data
(last committed slot ↔ first proposed slot), per "the now line is implicit."

---

## 5. The API

A `Chart.Spec`-style namespace: typed builders + a `.Types` mirror.

```ts
Planner = {
  Point, Span,                                   // the two variants
  axis: { time, number, ordinal },               // typed axis builders
  at:   { time, number, ordinal },               // slot-coordinate shorthands
  event,                                          // flat-input event factory
  Types: { … },
}
```

The factory is data-bound (like Table) — raw `data` + per-row accessors — with
the compositional pieces (axis, event state) as the typed `Chart.Spec`-style
builders:

```ts
Planner.Point(data, {
  axis, columns, events,        // required
  groupBy?, now?, density?, onSelectRow?,
})
```

---

## 6. Worked examples

All four compile (see the prototype). Domains are generic.

**Roster Point — AM/PM buckets, value/eyebrow + derived columns, groupBy, now:**

```ts
Planner.Point(data, {
  axis: Planner.axis.number({ buckets: [{key:"am",label:"AM"},{key:"pm",label:"PM"}], range: {min:1,max:7} }),
  groupBy: r => r.team,
  columns: [
    { key: "name",   frozen: true,   value: r => r.name, sublabel: r => r.role },
    { key: "cap",    header: "Hours", align: "end", value: r => East.str`${r.usedHrs} / ${r.maxHrs} h` },
    { key: "shifts", header: "Shifts", align: "end", value: r => East.print(r.events.size()) },
  ],
  events: r => r.events,
  now: Planner.at.number(4),
  onSelectRow: East.function([Planner.Types.SelectEvent], NullType, _$ => null),
})
```

**An event + a consumer-computed conflict marker:**

```ts
Planner.event({
  slot: Planner.at.number(1), bucket: "morning", label: "Open", state: "added",
  conflict: { message: "A resource cannot hold two events in one bucket", severity: "error" },
})
```

**Three labelled buckets (Morning/Afternoon/Evening), one slot per column
(ordinal phases), and the Span variant (datetime, committed + proposed spans)**
— see prototype examples 2–4. Buckets are fully configurable: `[]`, two, three,
or any labelled array, all the same way.

---

## 7. Renderer plan (CSS-grid, recipe-driven, pixel-perfect)

A rebuild of `east-ui-components/src/collections/planner`. CSS-grid
(`grid-template-columns: <frozen cols> 1fr`), **not** the SVG/TanStack model.

Per §0: the output is a **pixel-perfect** match to `configure__pattern__planner`,
and **all** visual values live in a **`planner` slot recipe** (`defineSlotRecipe`,
registered in `theme/index.ts`) consuming Chakra semantic tokens. The renderer
components carry **no** inline styles and **no** hardcoded hex/px — they consume
recipe slots only. Each spec class below names the slot that owns its values;
the `spec.css` numbers (e.g. `.evt` mono 10.5px/600/radius 2, `.planner-now`
1px + 5px pip, `.planner-conflict` 1.5px ring + 13px badge, `.planner-bucket`
16px min / 8.5px label) are encoded **once, in the recipe**, never in the JSX.
Mapping each spec class to its slot:

| Spec (`spec.css`) | Plan |
|---|---|
| `.planner-grid` / `.planner-row` / `.planner-cell` | CSS-grid; row + cell from the `planner` slot recipe; group-head row from the recipe's eyebrow slot |
| `.planner-rh .name` / `.meta` | the column cell — `value` + muted `sublabel`; left pane shares the **Table column-header chrome** (the convergence the Gantt work started) |
| `.evt` + `.evt-committed/proposed{.added,.model,.removed}/rejected` | the `event` slot, one modifier per `state` arm → semantic tokens (committed solid brand; proposed brand-tint + dashed border + grip; model italic/transparent; removed striped + strike; rejected ink outline + strike) |
| `.evt-span` | Span events render as bars across the slot range (committed solid, proposed dashed) |
| `.planner-cell.bucketed` / `.planner-bucket` / `-label` | a bucketed cell is a sub-grid of labelled buckets (`axis.buckets`) |
| `.planner-now` + pip + `.planner-now-hint` | 1px divider + top pip + 12px hover zone with a `now · <formatted slot>` tooltip; position from `now` (explicit or derived) |
| `.planner-conflict` + `-badge` | the ring + corner badge, painted from the event's `conflict` (colour by `severity`) |
| density | row/header heights from `density`, mirroring Table/Gantt's mapping |

The popover reuses the **general east-ui Popover recipe** (as the Gantt work
established — popover-only, no tooltip).

---

## 8. Migration from the current IR

| Current | New |
|---|---|
| `event.start` / `end` (float) | `event.slot` / `endSlot` (typed `PlannerSlotType`) |
| `event.colorPalette` / `background` / `stroke` / `opacity` | **removed** — appearance is driven by `state` |
| `event.overlays` | **removed** |
| `event.tooltip` | **removed** (popover-only) |
| `event.icon` | **removed** (v1; revisit with the render escape hatch) |
| — | `event.state` / `bucket` / `conflict` (new) |
| `slotMode` (single/span style flag) | the `variant` (Point / Span) |
| `minSlot` / `maxSlot` / `stepSize` / `slotLabel` / `boundaries` | `axis` (`range` / `format` / `buckets`) |
| `style.*` (height, variant, size, striped, slotLine\*, gridColor, nowMarkerColor, header\*, eventBorderRadius, label\*) | **removed** — theme/recipe owns visuals; `size` → `density` |
| column reuse of `TableColumnType` + render fns | flat `PlannerColumnType` (value + eyebrow) |
| `on{Cell,Row}{,Double}Click` / `onSortChange` / `onEvent{Click,DoubleClick,Drag,Resize,Add,Edit,Delete}` | `onSelectRow` only in v1; DnD deferred |

This is a breaking change to the `Planner` arm of `UIComponentType`. The Planner
is not yet shipped to external consumers in this shape, so no deprecation path is
required — replace it.

---

## 9. Decisions taken during review

- **No `rowId`.** Rows are index-identified; a stable id was only needed for
  cross-row DnD, which is deferred.
- **Conflicts are a marker, not an engine.** The consumer computes the rule in
  East and tags events; the library renders. (The spec's "declared, not
  host-decorated" intent is preserved — the *rule* is declared in East config.)
- **Columns are one flat value/eyebrow shape**, not typed kinds — the five
  spec kinds are authoring patterns. Converges with Table/Gantt.
- **Not a recursive type** — fixed nested structs (see §2).
- **Defer** DnD, templates, Summary, per-row now, hierarchy.

---

## 10. Implementation plan

**Phase 1 — IR.** Rewrite `src/collections/planner/{types,index}.ts` to the
above. Replace the `Planner` arm in `component.ts`. The namespace needs an
explicit `interface PlannerNamespace` annotation (the `as const` object exceeds
the declaration-emit serialization limit — TS7056; the *current* Planner already
does this). Full TypeDoc on every public export per the standard.

**Phase 2 — Tests + examples.** Rewrite `test/collections/planner.{examples,spec}.ts`
to the **consolidated set in §11** (27 → 9). Follow the `*.examples.ts` ↔
`*.spec.ts` convention and the UI example rules. Regenerate the plugin search
index.

**Phase 3 — Renderer.** Rebuild the renderer per §7 under the §0 constraints:
author the `planner` slot recipe first (all spec values encoded there), then the
CSS-grid components that consume it — event-state styles, buckets, now-line,
conflict markers, density, shared table column-header chrome. **No inline
styles.** Then iterate the **pixel-perfect** loop until it matches: `make
probe-collections` + `make east-ui-examples-html-*` → **Read the PNG** → diff
against `configure__pattern__planner` → adjust the *recipe* (never the JSX) →
repeat. Done = pixel match, not "close."

**Phase 4 — later.** DnD grammar (add/move/remove/resize), templates, Summary,
per-row now, nested row hierarchy. Then fold the column/axis lessons back into
Table and Gantt.

---

## 11. Example set (consolidated 27 → 9)

Examples drive the **plugin search index** *and* the **showcase**, so each must
exercise one feature once with good keywords — not re-demonstrate the same
shape. The current file is 27 examples / 866 lines; most exercise features this
redesign removes (per-event colour/chrome escapes, tooltip, overlays, icons,
label styling, height/style overrides, boundaries, slotLabel, readOnly,
rowStatus, render columns, drag/resize). The consolidated set:

| Example | Exercises | Keywords |
|---|---|---|
| `plannerPoint` | Point, numeric axis, identity column, committed events, now-line, `onSelectRow` | planner, point, slot, schedule, roster, committed, now, select |
| `plannerEventStates` | committed / proposed{added, model, removed} / rejected in one row | state, committed, proposed, rejected, model, draft, audit, diff |
| `plannerBuckets` | labelled sub-slot buckets (AM/PM; a 3-bucket variant in the same example) | bucket, sub-slot, slotsPerColumn, am, pm, shift, morning |
| `plannerOrdinalAxis` | ordinal phase axis, one slot per column (no buckets) | ordinal, phase, stage, category, axis |
| `plannerColumns` | value + eyebrow `sublabel`, a derived East-computed column, `align`, `frozen`, `groupBy` | column, eyebrow, sublabel, derived, group, groupBy, frozen, capacity |
| `plannerConflict` | an event tagged with a conflict marker + severity | conflict, invariant, marker, severity, violation, double-booking |
| `plannerPopover` | per-event click popover | popover, detail, click, rich content |
| `plannerSpan` | Span variant, datetime axis, committed + proposed spans | span, gantt, datetime, range, duration, timeline |
| `plannerDensity` | density (compact / comfortable / condensed) | density, compact, comfortable, condensed, size |

Coverage check: variants Point (1–7) + Span (8); axis kinds number (1,3) +
ordinal (4) + time (8); buckets 0 (4) / 2–3 (3); all event states (2); the full
left-pane column model + grouping (5); conflict (6); popover (7); now-line (1);
density (9). Every v1 feature exercised exactly once. (`plannerDensity` and the
now-line could fold into `plannerPoint` to reach 8 if we want it tighter.)

---

## Appendix — prototype

The design was validated by a scratch prototype (the full IR + builders + worked
examples) that compiled clean under the package's strict tsconfig
(`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`).
It has since been **promoted into `src/collections/planner/{types,index}.ts`** and
removed — the shipped source (which builds + tests green) is now the reference.
