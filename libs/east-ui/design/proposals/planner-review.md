# `Planner` review — optional per-row approval + batch foot

> **Status: proposed.** `Collections.Planner` today renders a `rows × ordered-slots`
> timeline with selection (`onSelectRow`) and per-cell status `markers`, but has
> **no native approve / reject / approve-all**. The Amplar `decide.html`
> `Planner.Review` mock wraps a machine-written roster in review chrome: each
> line carries its own **Approve / Reject at the end of the row** (the call sits
> beside the full week it governs), over a **`Commit.BatchBar` approve-all /
> reject-all foot**. This proposal adds that as an **optional** capability on the
> existing `Planner` — not a new component — so a plain Planner is unchanged and
> a review Planner is one `review={…}` prop plus two row accessors away.

Source mock: `design/decide.html#planner-review`. Category: `collections/planner`.
**No new DnD** — approval is click-only (the optimiser writes the plan; the
operator approves it, they don't key in lines). Colour stays theme-owned: a row
selects a `status` / `approval` and the renderer's recipe maps each to a token.

---

## The two approval granularities ("single row" and "whole plan")

- **Single row** — every row gets an `Approve` / `Reject` at the *end of the
  row* (a fixed "Decision" column), so the decision is made next to the shifts
  it governs, never in a second list below.
- **Whole plan** — a `Commit.BatchBar` foot approves or rejects the lot in one
  gesture (`Approve all` / `Reject all`, optional `Rerun`), with a summary line.

`status` steers attention: **clean lines rest pre-approved** (Approve is the
active state), **flagged lines** (OT threshold, coverage gap, model swing) wait
on an explicit call — carried as a **quiet dot beside the resource**, *not* a
per-cell ring (which reads too busy across a week, and is what the existing
`markers` already do for in-grid cell flags).

---

## TSX (the review surface)

```tsx
// @jsxImportSource @elaraai/east-ui
import { East, IntegerType, NullType, StringType, some, variant } from "@elaraai/east";
import { Planner, UIComponentType } from "@elaraai/east-ui";

const careLineReview = East.function([], UIComponentType, $ => {
    // The optimiser run is bound data; these closures write the decision back.
    const approve   = $.const(East.function([Planner.Types.ApproveEvent], NullType, (_$, _e) => null));
    const reject    = $.const(East.function([Planner.Types.ApproveEvent], NullType, (_$, _e) => null));
    const approveAll = $.const(East.function([], NullType, _$ => null));
    const rejectAll  = $.const(East.function([], NullType, _$ => null));
    const rerun      = $.const(East.function([], NullType, _$ => null));

    return (
        <Planner.Span
            axis={Planner.axis.ordinal({ range: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] })}
            now={Planner.at.ordinal("Wed")}
            columns={[{ key: "name", header: "Caregiver", width: "240px" }]}
            rows={rosterLines}
            groupBy={r => r.unit}                       // "Registered nurses" / "Enrolled nurses & carers"
            events={r => /* … the row's committed/proposed shifts … */ r.shifts}

            // ── review additions ──────────────────────────────────────────────
            status={r => r.flag}                        // a quiet row dot: "warning" / "danger" / absent (clean)
            approval={r => r.decision}                  // "approved" | "rejected" | "pending"; absent ⇒ derived from status
            review={{
                columnLabel: "Decision",                // the 168px decision-column header (default "Decision")
                summary: <Planner.reviewSummary lines={9n} flagged={2n} note="−$24k wage / fn" />,
                onApprove: approve, onReject: reject,    // per-row (single row) — event carries { rowIndex }
                onApproveAll: approveAll, onRejectAll: rejectAll,
                onRerun: rerun, rerunLabel: "Rerun",     // optional; omit ⇒ no Rerun button
            }}
        />
    );
});
```

A Planner with no `review` prop renders exactly as today (the decision column and
foot don't appear, and `status` / `approval` accessors are inert). `status` and
`approval` accept the literal shorthand (`"warning"`, `"pending"`) or the East
value (`Planner.Types.Status` / `Planner.Types.Approval`), and may be omitted per
row (resolved to defaults).

---

## Props (additions to `PlannerConfig<R>`)

| Prop | Type | Notes |
|---|---|---|
| `status?` | `(r) => StatusValueLiteral \| SubtypeExprOrValue<StatusValueType>` | the row's quiet dot beside the resource; absent ⇒ no dot (clean) |
| `approval?` | `(r) => PlannerApprovalLiteral \| SubtypeExprOrValue<PlannerApprovalType>` | per-row decision; absent ⇒ derived: `status` present ⇒ `pending`, else `approved` |
| `review?` | `PlannerReviewConfig` | **the opt-in** — presence renders the Decision column + the foot |

`PlannerReviewConfig`:

| Field | Type | Notes |
|---|---|---|
| `columnLabel?` | `SubtypeExprOrValue<StringType> \| string` | the decision-column header (default `"Decision"`) |
| `summary?` | `SubtypeExprOrValue<UIComponentType>` | the foot's left eyebrow (host-composed, e.g. `Planner.reviewSummary(...)`) |
| `onApprove?` | `SubtypeExprOrValue<FunctionType<[PlannerApproveEventType], NullType>>` | per-row Approve (`{ rowIndex }`) |
| `onReject?` | `SubtypeExprOrValue<FunctionType<[PlannerApproveEventType], NullType>>` | per-row Reject (`{ rowIndex }`) |
| `onApproveAll?` | `SubtypeExprOrValue<FunctionType<[], NullType>>` | the foot's `Approve all` |
| `onRejectAll?` | `SubtypeExprOrValue<FunctionType<[], NullType>>` | the foot's `Reject all` |
| `onRerun?` | `SubtypeExprOrValue<FunctionType<[], NullType>>` | optional `Rerun`; omit ⇒ no button |
| `rerunLabel?` | `SubtypeExprOrValue<StringType> \| string` | the Rerun button label (default `"Rerun"`) |

Sub-constructors added to the frozen `Planner` namespace:
`Planner.reviewSummary({ lines, flagged?, note? })` (a `UIComponentType` foot
eyebrow — mono count line + flagged count + an optional metric note). Value types
added to `Planner.Types.*`: `Approval` (`PlannerApprovalType`),
`ApproveEvent` (`PlannerApproveEventType`), `Review` (`PlannerReviewType` —
the non-`node` review fields, registered inline in `component.ts` for the
`summary: node` slot, mirroring the event `popover` precedent).

---

## Public IR — East type definitions

All in `packages/east-ui/src/collections/planner/types.ts` (+ `index.ts` for the
factory). `StatusValueType` is reused verbatim for the row dot; a new
`PlannerApprovalType` models the decision state (distinct from the event-level
`PlannerStateType` = `committed` / `proposed` / `rejected`).

```ts
/** A row's review decision — distinct from the event-level PlannerStateType.
 * `approved` rests pre-approved (Approve is the active state); `pending` awaits
 * an explicit call; `rejected` is an explicit decline. */
export const PlannerApprovalType = VariantType({
    approved: NullType,
    pending:  NullType,
    rejected: NullType,
});
export type PlannerApprovalType = typeof PlannerApprovalType;

/** The per-row approve/reject event payload (mirrors PlannerSelectEventType). */
export const PlannerApproveEventType = StructType({ rowIndex: IntegerType });
export type PlannerApproveEventType = typeof PlannerApproveEventType;
```

`PlannerRowType` gains two optional fields (the row dot + the resolved decision):

```ts
export const PlannerRowType = StructType({
    group:    OptionType(StringType),
    cells:    DictType(StringType, PlannerCellType),
    events:   ArrayType(PlannerEventType),
    markers:  ArrayType(PlannerMarkerType),
    status:   OptionType(StatusValueType),     // NEW — the quiet row dot (absent ⇒ clean)
    approval: OptionType(PlannerApprovalType),  // NEW — the resolved decision (absent ⇒ no decision column)
});
```

`PlannerRootType` gains an optional `review`. Because the foot's `summary` is a
`UIComponentType` child, the `review` field is registered **inline in
`component.ts`** (the `node` slot) — exactly the existing event-`popover`
precedent — while `PlannerReviewType` in `types.ts` carries the non-`node`
fields so `Planner.Types.Review` exists and the factory types statically:

```ts
// types.ts — the non-node review fields
export const PlannerReviewType = StructType({
    columnLabel:  StringType,
    onApprove:    OptionType(FunctionType([PlannerApproveEventType], NullType)),
    onReject:     OptionType(FunctionType([PlannerApproveEventType], NullType)),
    onApproveAll: OptionType(FunctionType([], NullType)),
    onRejectAll:  OptionType(FunctionType([], NullType)),
    onRerun:      OptionType(FunctionType([], NullType)),
    rerunLabel:   StringType,
    // summary: node — registered inline in component.ts (see Registration)
});

// component.ts — the Planner case gains, inside the existing inline StructType:
//   review: OptionType(StructType({ …PlannerReviewType fields…, summary: OptionType(node) })),
```

---

## Default derivation (the "clean rests pre-approved" rule)

The factory resolves each row's `approval` so the renderer never re-derives:

- `approval` accessor present ⇒ use it.
- absent ⇒ `status` present (a flagged line) ⇒ `pending`; else ⇒ `approved`.

This bakes the mock's behaviour: clean lines rest pre-approved (their Approve
renders as the active/primary state), flagged lines render both buttons neutral
and wait on an explicit call. The author can always override per row (e.g. mark a
clean line `pending` to force a look).

When `review` is **absent**, `approval` is left `none` and the decision column /
foot do not render, regardless of the accessors — a plain Planner is unchanged.

---

## Renderer notes (`east-ui-components/src/collections/planner/index.tsx`)

- **Decision column.** When `review` is set, append a fixed-width
  (`168px`, the mock's measure) column after the day band — a third
  `grid-template-columns` track (`<rowHeader> <day-band 1fr> <decision 168px>`),
  with a `Decision` header cell in the header row and a left rule
  (`border-left`). Each row's cell renders `Approve` / `Reject` (the
  `commitBar` / button recipes — never Chakra defaults), styled by the row's
  `approval`: `approved` ⇒ Approve **primary**, Reject ghost; `rejected` ⇒
  Reject active, Approve ghost; `pending` ⇒ both neutral (awaiting a call). The
  buttons `queueMicrotask` the resolved `review.onApprove` / `onReject` with
  `{ rowIndex }`.
- **Row status dot.** Render `row.status` as a small status dot **beside the
  resource name** in the row header (the `status` recipe's dot, mono micro
  rhythm), *not* a per-cell ring — the existing `markers` own the per-cell case.
- **The foot — `Commit.BatchBar`.** A sticky foot below the grid (the
  `commitBar` slot recipe, `brand.tint` surface + top rule): `review.summary`
  (left, host-composed) + `Reject all` / optional `Rerun` / `Approve all`
  (right), wired to `onRejectAll` / `onRerun` / `onApproveAll`. Buttons whose
  callback is absent are omitted.
- **Folded clean remainder.** Long clean runs may be folded by the *host* (a
  single `+ N clean lines · pre-approved` row) — the renderer does not
  auto-fold; it just renders whatever rows the data carries (the mock's
  `+ 6 clean lines` line is an ordinary row whose decision cell shows `✓ ×6`).
- **Interactive-state.** Follows the MANDATORY pattern — local `useState` for any
  optimistic button affordance + `useEffect([value])` sync; the decision itself
  is re-derived from the next IR after the host writes it (no renderer-owned
  decision state). `queueMicrotask` every East callback.
- **Density / memo.** The decision column + dot inherit the Planner `density`
  cascade; `equalFor(Planner.Types.Root)` memo covers the new fields.

---

## Decisions / open questions

1. **Optional config vs new `<Planner.Review>` component.** Recommend the
   optional `review` prop on the existing `Planner` (this proposal) — a plain
   Planner stays unchanged and review is additive. A separate component would
   duplicate the whole timeline. **Decision needed: confirm config-on-Planner.**
2. **Row dot reuses `status` semantics, not `markers`.** The dot is row-level
   (`PlannerRowType.status`); `markers` stay cell-level. Confirm the two coexist
   without visual collision (a flagged row with both a dot and a cell ring).
3. **`approval` default derivation** lives in the factory (clean ⇒ approved,
   flagged ⇒ pending). Alternative: require an explicit `approval` accessor (no
   magic). Recommend the derivation (matches the mock; overridable).
4. **`summary` as a `node` slot** (host-composed) vs a typed struct
   (`{ lines, flagged, note }`). Recommend `node` for flexibility, with
   `Planner.reviewSummary(...)` as the ergonomic default builder.
5. **Per-row event payload.** `PlannerApproveEventType = { rowIndex }` mirrors
   `PlannerSelectEventType`. Should it also carry the row's `group` / a row
   `key`? Rows are index-identified today; keep `{ rowIndex }` for parity unless
   a stable key is added Planner-wide.
6. **Reject-all / Rerun affordance.** Confirm `Reject all` and `Rerun` are
   plain buttons (not a destructive-confirm) at this layer — the mock shows
   plain buttons; a confirm could be host chrome.

---

## Acceptance criteria

- [ ] A `Planner` with no `review` prop renders identically to today; `status` /
      `approval` accessors are inert without `review`.
- [ ] `review={…}` renders a `168px` Decision column after the day band, with a
      per-row `Approve` / `Reject` whose styling reflects the row's `approval`
      (approved ⇒ Approve primary; rejected ⇒ Reject active; pending ⇒ neutral).
- [ ] `status` renders a quiet dot beside the resource name (not a per-cell
      ring); cell-level `markers` are unaffected.
- [ ] `approval` defaults derive in the factory (clean ⇒ `approved`, flagged ⇒
      `pending`) and are overridable per row.
- [ ] The foot renders `review.summary` + `Reject all` / optional `Rerun` /
      `Approve all`, each omitted when its callback is absent, composed from the
      `commitBar` recipe (no Chakra defaults).
- [ ] Per-row `onApprove` / `onReject` fire with `{ rowIndex }` via
      `queueMicrotask`; `onApproveAll` / `onRejectAll` / `onRerun` fire from the
      foot; the Planner re-derives from new IR after a host write (no renderer
      decision state).
- [ ] `PlannerApprovalType`, `PlannerApproveEventType`, `PlannerReviewType` +
      `Planner.Types.{Approval, ApproveEvent, Review}` and
      `Planner.reviewSummary` are exported and typed; the inline `review.summary`
      `node` slot round-trips through `EastIR.fromJSON`.
- [ ] `make build && make test && make lint` pass from `libs/east-ui`; a
      `planner.examples.tsx` review example renders and the snapshot shows the
      decision column, row dots, and the batch foot matching `decide.html`.
- [ ] `design/proposals/planner-review.md` added (this doc) and listed in the
      proposals README.
