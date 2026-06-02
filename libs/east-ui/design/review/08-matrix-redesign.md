# Collections.Matrix — redesign

## 0. Why

The rendered Matrix is off-spec because the renderer **bypasses the theme
entirely** — it never calls `useSlotRecipe({ key: "matrix" })`, so the
registered `matrixSlotRecipe` is dead code and every element is hand-built with
inline Chakra props + raw hex/px. Segment fill resolves to
`seg.color ?? legendHex ?? "brand.solid"` (arbitrary hex from the example), so
the grid shows Chakra-default blue/green/orange instead of the brand/status
palette; bars fill edge-to-edge; slack-hatch, the inset rounded bar, and the
rich header chrome are absent.

The IR is the second problem: colour is raw `StringType` everywhere, the
options bag is flat (style + content + wiring + behaviour as siblings), there
are no public builders, the root struct is triplicated, and there is no reuse of
the shared **status** vocabulary or the **planner header chrome** the rest of the
collections now share.

This redesign makes Matrix a **planner-grade** primitive: a typed config object,
public builders that absorb the East envelope (modelled on `Planner.marker`),
**status-typed** segment fills, **group rows** (`groupBy`, like the Planner),
and a header that is **literally the planner/table header chrome** — no avatars,
no secondary header text.

Order of work (per request): **(1) lock this design → (2) land the IR/type
changes → (3) make it look right (recipe + renderer) once the types are in.**

---

## 1. Decisions (from review)

- **Group rows: YES.** Add an optional `groupBy` row accessor exactly like the
  Planner — the canonical Matrix is people/teams × time, and grouping rows under
  a group-head band (Team / Department / Region) is a common need. It reuses the
  Planner's `group: OptionType(StringType)` row field + group-head render path
  verbatim, so it is nearly free and keeps the two consistent.
- **No avatars.** Row headers are a plain label (the row's name). Drop the
  `mx-avatar` concept from IR and renderer.
- **No secondary text in headers.** Drop the row-header sublabel and the
  column-header DOW line. A column header is a **single label**; a row header is
  a **single label**.
- **Header == the Planner header.** Column headers reuse the shared header
  chrome already unified across Table/Gantt/Planner: mono-eyebrow `headerCell`,
  centred, `ColumnDividerBar` grips on the boundary, one strong bottom rule. The
  row-header column reuses the `colHeader` slot; the top-left corner is the
  planner corner cell.
- **Leverage `Planner.marker`.** The cell carries `markers` — full Planner
  parity: a marker is a status flag (`status` + `message` + corner `at`) that
  tints a corner ring and pins a status icon/badge, folding the old
  overlay-badge and emphasis-ring into one builder. Segment / marker
  construction copies the marker builder shape
  (`East.value({ …, status: variant(s, null) }, …)`) and reuses
  `StatusValueType` for the semantic fills.

---

## 2. Fill vocabulary — status-leveraged

The spec's six segment types collapse onto **one `MatrixFill` variant** that is a
*superset of `StatusValueType`* plus the three matrix-native fills. Reusing the
status names (`success`/`warning`/`danger`/`info`/`neutral`) keeps the semantics
identical to Planner markers / Gantt task status; `brand`/`slack`/`free` cover
the heat-grid track.

```ts
// matrix/types.ts  (UIComp-free)
export const MatrixFillType = VariantType({
    brand:   NullType,   // teal — "booked" / primary utilisation fill
    success: NullType,   // --pos green   (committed)
    warning: NullType,   // --warn gold   (pending)
    danger:  NullType,   // --neg red     (at-risk)
    info:    NullType,
    neutral: NullType,   // muted solid
    slack:   NullType,   // diagonal hatch — the auto-fill remainder
    free:    NullType,   // transparent track — empty/available
});
export type MatrixFillLiteral =
    "brand" | "success" | "warning" | "danger" | "info" | "neutral" | "slack" | "free";
```

Spec → fill mapping: `booked → brand`, `committed → success`, `pending →
warning`, `atrisk → danger`, `slack → slack`, `free → free`. The recipe (Phase 3)
maps each arm to tokens (`brand → accent.brand`, status arms → `fg.*`/`bg.*.subtle`,
`slack → repeating-linear-gradient`, `free → transparent`). A raw `color`
override stays as an escape hatch but is never needed for spec compliance.

---

## 3. IR — new types

```ts
// ---- segment: a weighted slice of the cell bar ----
export const MatrixSegmentType = StructType({
    fill:   MatrixFillType,
    weight: FloatType,                       // normalised so Σ = 100% of the cell axis
    label:  OptionType(LabelInputType),      // in-bar text ("50%", "6.4h"); hidden under minLabelSize
    color:  OptionType(StringType),          // override only
    min:    OptionType(FloatType),           // drag-resize bounds (honoured when onSegmentChange set)
    max:    OptionType(FloatType),
    step:   OptionType(FloatType),
});

// ---- marker: a status flag on the cell (full Planner.marker parity) ----
export const MatrixCornerType = VariantType({ tl: NullType, tr: NullType, bl: NullType, br: NullType });
export const MatrixMarkerType = StructType({
    at:      MatrixCornerType,                 // which corner the icon/badge sits in (default tr)
    status:  StatusValueType,                  // ring tint + paired corner icon (default danger)
    message: StringType,                       // hover tooltip text
    label:   OptionType(StringType),           // custom badge text replacing the status icon ("OT")
});

// ---- cell: a status-typed segment bar, or a free slot ----
export const MatrixOrientationType = VariantType({ horizontal: NullType, vertical: NullType });
export const MatrixCellType = StructType({   // (UIComp-coupled → lives in index.ts)
    segments:    ArrayType(MatrixSegmentType),
    markers:     ArrayType(MatrixMarkerType),  // status flags — tint a corner ring + pin a status icon
    orientation: OptionType(MatrixOrientationType), // per-cell override of the matrix default
    slot:        OptionType(UIComponentType), // FREE SLOT — when set, replaces the bar entirely
    popover:     OptionType(UIComponentType), // click-triggered rich body (popover-only, like Planner — no tooltip)
});

// ---- row / column: single-label headers, group support ----
export const MatrixRowType = StructType({     // (index.ts)
    key:    StringType,
    label:  OptionType(LabelInputType),       // single name; defaults to key. NO avatar, NO sub.
    group:  OptionType(StringType),           // group-head label (from groupBy) — like Planner
    cells:  DictType(StringType, MatrixCellType),
});
export const MatrixColumnType = StructType({  // (index.ts)
    key:   StringType,
    label: OptionType(LabelInputType),        // single header label. NO DOW/sub line.
});
```

The marker `status` reuses `StatusValueType` (from `feedback/status/types`),
exactly as `PlannerMarkerType.status` does — one shared status palette drives
the ring tint, the corner icon, and the Planner marker.

---

## 4. IR — root + grouped config

The flat `MatrixOptions` bag is replaced by a **typed `MatrixConfig`**, grouped
by concern (mirrors `PlannerConfig`). The factory moves to the Planner's
**data + accessor** shape so callers never hand-build a cells dict:

```ts
function createMatrix<R extends StructType>(
    data:    SubtypeExprOrValue<ArrayType<R>>,
    config:  MatrixConfig<R>,
): ExprType<UIComponentType>;

export interface MatrixConfig<R extends StructType> {
    // structure
    columns:      MatrixColumnInput[];                          // the x-axis columns
    cell:         (row: ExprType<R>, columnKey: string) => MatrixCellInput;  // ← per (row,col), like Planner events
    rowKey:       (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    rowLabel?:    (row: ExprType<R>) => SubtypeExprOrValue<StringType>;
    groupBy?:     (row: ExprType<R>) => SubtypeExprOrValue<StringType>;       // ← group rows (Planner parity)
    // presentation
    orientation?: "horizontal" | "vertical";                   // default; per-cell override on the cell
    legend?:      MatrixLegendEntry[] | boolean;               // explicit, or true = auto-derive from fills
    legendPosition?: "top" | "bottom" | "left" | "right";
    minLabelSize?: number;                                     // suppress in-bar labels under this px/%
    density?:     "compact" | "comfortable" | "condensed";    // shared density token (header/row heights)
    // interaction (presence ⇒ affordance, as today). NO brush/draw-selection.
    onCellClick?:     (e) => void;                            // general cell click (optional)
    onSegmentClick?:  (e) => void;
    onSegmentChange?: (e) => void;                            // presence ⇒ drag-resize handles (config 2)
}

export const MatrixRootType = StructType({
    rows:     ArrayType(MatrixRowType),
    columns:  ArrayType(MatrixColumnType),
    orientation: MatrixOrientationType,
    legend:   OptionType(ArrayType(MatrixLegendEntryType)),
    minLabelSize: OptionType(FloatType),
    density:  OptionType(DensityType),
    onCellClick / onSegmentClick / onSegmentChange: OptionType(FunctionType(...)),
});
```

**No brush / draw-selection.** The spec's Config-5 cell brush (2D drag-select,
`selected`/`onChange`) is intentionally dropped — not needed. Cell click +
`popover`/`tooltip` remain the cell's interaction surface.

**Grouping & narrowing come from Slice, not bespoke Matrix code.** Any
`UIComponent` (so any `Matrix.Root(...)`) is already a valid `Slice.Frame` body:
`Slice.Frame.Root(slice, Matrix.Root(narrowed, config))` gives the grid
filter / search / **breakdown** / range chrome over its row dataset for free.
Slice's **breakdown is the grouping** — it populates the row `group` field via
`Slice.apply.breakdownKey`, so the Matrix only has to *render* group-head bands
(it carries `group` + an optional direct `groupBy` accessor for the
non-Slice case). No filter/search/range logic lives in the Matrix IR.
```

The legend, when `true`, auto-derives from the distinct fills present (each fill
has a canonical default label: Brand/Committed/Pending/At-risk/Slack/Free),
overridable — callers stop hand-writing legend hex.

---

## 5. Builders — leverage `Planner.marker`

Promote public, envelope-absorbing builders onto the namespace. Each copies the
Planner marker shape — defaulted status/corner, flat JS in, enveloped East out:

```ts
// exact shape of createMarker — flat JS in, enveloped East value out
function createSegment(i: SegmentInput): ExprType<MatrixSegmentType> {
    return East.value({
        fill:   variant(i.fill ?? "brand", null),
        weight: i.weight,
        label:  i.label !== undefined ? some(buildLabel(i.label)) : none,
        color:  i.color !== undefined ? some(i.color) : none,
        min: …, max: …, step: …,
    }, MatrixSegmentType);
}
function createMarker(i: MarkerInput): ExprType<MatrixMarkerType> {
    return East.value({
        at:      variant(i.at ?? "tr", null),          // default corner
        status:  variant(i.status ?? "danger", null),  // default status → ring tint + icon
        message: i.message,
        label:   i.label !== undefined ? some(i.label) : none,
    }, MatrixMarkerType);
}
function createCell(i: CellInput): ExprType<MatrixCellType> { … }   // segments/markers/slot/popover

export const Matrix = {
    Root: createMatrix,
    segment: createSegment,   // Matrix.segment({ fill: "warning", weight: 30, label: "30%" })
    marker:  createMarker,    // Matrix.marker({ status: "danger", message: "Over capacity", at: "tr" })
    cell:    createCell,      // Matrix.cell({ segments: [...], markers: [Matrix.marker({...})] })
    Types: { … },             // mirror, in lockstep with an explicit MatrixNamespace interface
} as const satisfies MatrixNamespace;
```

`SegmentInput.fill` accepts the `MatrixFillLiteral` string shorthand (`"warning"`)
or an East variant — same ergonomics as `MarkerInput.status`.

Call site after redesign:

```ts
Matrix.Root(teams, {
    columns: [{ key: "mon", label: "Mon" }, … ],
    groupBy: r => r.department,
    cell: (r, col) => Matrix.cell({ segments: [
        Matrix.segment({ fill: "brand", weight: r.booked.get(col), label: East.print(r.booked.get(col)) }),
        Matrix.segment({ fill: "free",  weight: r.free.get(col) }),
    ]}),
    legend: true,
});
```

---

## 6. Header == Planner header (Phase 3 renderer)

The renderer stops hand-building headers and reuses the shared chrome:

- **Column headers** → the planner `headerCell` slot (mono eyebrow, centred,
  `whiteSpace:nowrap`), with `ColumnDividerBar` grips centred on each boundary
  and one strong bottom rule carried on the header cells (the unified treatment
  from the gantt double-line fix). Single label only.
- **Row-header column header (corner)** → the `colHeader` slot.
- **Row headers** → the planner `rowHeaderName` (mono name); no avatar, no sub.
- **Group-head rows** → the planner `groupHead` + `groupHeadCell` slots (bottom
  rule + the left-pane divider continuing through), spanning all columns.

This is the single biggest consistency win: Matrix, Planner, Gantt, Table all
share one header system.

---

## 7. Recipe + renderer (Phase 3 — after types land)

- **Renderer consumes `useSlotRecipe({ key:"matrix" })`** and applies every slot
  (`root`/`colHeader`/`headerCell`/`rowHeader`/`groupHead`/`cell`/`bar`/`marker`/
  `markerRing`/`legend`). Delete all inline px/hex/raw-gray.
- **Segment slot gains a `fill` variant** (8 arms) mapping to tokens:
  `brand→accent.brand`, `success/warning/danger/info → fg.*` on `bg.*.subtle`,
  `neutral → bg.emphasized`, `slack → repeating-linear-gradient(...)` hatch,
  `free → transparent`. In-bar label colour follows the fill (white on solid,
  ink on hatch/free).
- **Inset rounded bar**: cell padding insets the bar; `bar` slot is 24px·md
  (density-scaled), `borderRadius`, `overflow:hidden`. Vertical orientation =
  bottom-anchored bordered track, segments by height.
- **`minLabelSize`**: suppress a segment's in-bar label when the measured label
  width exceeds the segment width — reuse the gantt canvas-`measureText` thinning
  helper (already proven), not a guess.
- **markers** render from the cell's `markers` array: each pins a status icon /
  custom badge in its corner (`at`) via the `marker` slot and tints a
  status-coloured ring via the `markerRing` slot (a `status` variant), with
  `message` as the hover tooltip on the marker itself. This is the full Planner
  marker treatment — the old standalone overlay badge + emphasis ring folded
  into one. **Popover** stays — a cell with `popover` is click-triggered rich
  content via the shared overlay manager, popover-only (no cell tooltip),
  matching the Planner event. (No brush state to render.)
- **Fix the keyless Fragment**: `rows.map(r => <Fragment key={r.key}>…)` — clears
  the "EastChakraMatrix2" React warning (which is only the bundler-renamed inner
  `memo()` fn, not a duplicate renderer).

---

## 8. Phasing

1. **IR / types** (this doc): `MatrixFillType`, status-typed segments +
   `markers` (Planner-parity status flags, emphasis folded in), single-label
   headers + `group`, data+accessor factory, grouped `MatrixConfig`, public
   `Matrix.segment/cell/marker` builders, explicit namespace + `Types` mirror,
   de-triplicate the root struct, `component.ts` arm. Rewrite
   `matrix.examples.ts` (the spec configs, domain-neutral) + spec.
2. **Recipe**: rewrite `slot-recipes/matrix.ts` — `fill` variant + slack hatch +
   inset bar + `marker`/`markerRing` (status variant) + adopt the shared header
   slots; density variant.
3. **Renderer**: consume the recipe + shared header chrome + status tokens;
   per-cell orientation; canvas `minLabelSize`; Fragment-key fix; pixel-verify
   each of the 5 configs against `configure__pattern__valuematrix.png`.

## 9. Resolved decisions

- **Factory:** `Matrix.Root(data, config)` — data + accessors, Planner parity.
  The explicit-rows-with-cells-dict form is dropped.
- **Group rows:** in. Direct `groupBy` accessor *and* Slice-breakdown both feed
  the row `group` field; the Matrix renders group-head bands.
- **Slice:** Matrix is a first-class `Slice.Frame` consumer (row
  filter/search/breakdown/range comes from Slice); no narrowing logic in the
  Matrix IR. Ship a Slice-framed example.
- **Brush / draw cell-selection: REMOVED** (config + callbacks). Not needed.
- **Cell interaction: popover-only.** Click-triggered rich popover, no cell
  hover tooltip — matching the Planner event. (Marker `message` is the only
  hover affordance, on the marker itself.)
- **Overlay + emphasis folded into `marker`** — full Planner parity: one
  status flag carries the corner icon/badge *and* the status ring.

## 10. Deliberate deviations from spec

These are intentional — not compliance bugs — and the renderer should NOT try to
match the spec on them:

| Spec shows | We do instead | Why |
|---|---|---|
| Row-header **avatar** (`mx-avatar` circle + initials) | No avatar — row header is a single label | Avatars judged pointless for this primitive |
| Row-header **sub-label** (`mx-rh-sub`, e.g. "Senior PM") | Single row label only | Secondary header text dropped |
| **Rich date column header** — DOW line + date (`col-date` / `dow` / `dt`) | Single-label column header in the **planner header chrome** (mono eyebrow, grips, strong bottom rule) | Unify on one header system across Table/Gantt/Planner/Matrix |
| **Config 5 — brush selection** (2D cell drag-select, `selected`/`brushed`) | Not implemented; no brush state or callbacks | Not needed |
| Bespoke filter / grouping baked into Matrix | **Slice** drives filter/search/**breakdown(=grouping)**/range when framed | Reuse the Slice family; don't reinvent narrowing |
| Raw per-segment colour (`seg.color` hex) as the primary path | **Status-typed `MatrixFill`** (success/warning/danger/info/neutral + brand/slack/free); raw `color` is override-only | Theme-correct by construction, like Planner markers |

Everything else in §1–§7 (the configs' *substance* — heat-grid bars, the
multi-segment drag-resize with slack auto-fill + `minLabelSize`, vertical
orientation, the status markers (corner icon + ring), the legend, the inset
rounded status-coloured bars) IS the compliance target.
