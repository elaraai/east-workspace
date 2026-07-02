# Drag & drop contract (shared by Library / Roster / Blend)

> **Status: implemented.** Types in `east-ui/src/contracts/drag.ts`
> (exported from both barrels); renderer in
> `east-ui-components/src/dnd/drag-layer.tsx` (`DragLayerProvider` +
> registration hooks); stage visuals in the theme global CSS; provider
> mounted in the shared snapshot harness.

Source spec: `index__bsys__drag-drop-{grammar,roles,matrix,invariants,visuals}`.

The grammar is a **typed contract in east-ui**, not per-component ad-hoc callbacks.
One new module `src/contracts/drag.ts` exports the East types; DnD-aware
components reference them.

## Types

```ts
/** Where an item came from in a Library (source surface). */
export const LibraryRefType = StructType({
    /** The `id` the Library declared. */
    library: StringType,
    /** The dragged card's item key. */
    key: StringType,
});

/** A cell coordinate on a target surface (row key × slot key). */
export const CellRefType = StructType({
    /** The target surface's `id`. */
    surface: StringType,
    row: StringType,
    slot: StringType,
    /** The event's key when the ref names an existing event (move/remove). */
    event: OptionType(StringType),
});

/** The four event kinds — every drag reduces to exactly one. */
export const DragEventType = VariantType({
    /** New item from a sibling Library landing on a target. */
    add: StructType({ from: LibraryRefType, into: CellRefType, duplicate: BooleanType }),
    /** Within one surface. Cross-row is still `move`; the host derives Communicate.Swap from it. */
    move: StructType({ from: CellRefType, to: CellRefType }),
    /** Off-surface, into a sink. */
    remove: StructType({ from: CellRefType, to: VariantType({ trash: NullType, source: NullType }) }),
    /** Span events only (Gantt / Planner.Span) — not used by these five. */
    resize: StructType({ event: CellRefType, edge: VariantType({ start: NullType, end: NullType }) }),
});
```

## Role declaration (renderer wires the flow, hosts don't)

- A **source** declares `id` (Library). It never receives drops except
  return-to-palette.
- A **target** declares `id` + `sources: string[]` — the Library ids it
  accepts `add` from. Implicit cross-surface drops are forbidden, so an
  undeclared source simply doesn't connect.
- **Sinks** are renderer-provided: the trash affordance and the originating
  Library (return-to-palette). At most two per page.

The renderer (`east-ui-components`) hosts one `DragLayerProvider` (same
pattern as `OverlayManagerProvider`): sources register draggable cards,
targets register droppable cells keyed by `(surface, row, slot)`, and the
provider matches them by the declared ids. A cell registration may carry a
`canDrop(payload)` predicate — a connected-but-vetoed cell is never marked
valid, shows the invalid stage (`data-drop-invalid`: red outline + ⊘ +
not-allowed cursor) while hovered, and the drop is a no-op (Board uses this
for its duplicate-person guard and host `canAssign` predicate). Ghost/indicator/cancel visuals
follow `drag-drop-visuals` and live in the theme (layer styles), not in
components.

## Event funnel

Each target carries exactly one callback:

```ts
onDrag?: SubtypeExprOrValue<FunctionType<[DragEventType], NullType>>;
```

Per the invariants: the callback writes **proposed** state through the host's
normal commit pipeline (State/Data bind → Commit.Bar); no drop writes
directly. Committed events render with no grip and are pointer-immutable —
state comes from the data, the renderer enforces it.

## Per-surface matrix

| Surface | add | move | remove | resize |
|---|---|---|---|---|
| `Library` | — | — | — | — (pure source) |
| `Roster` | ✓ | ✓ | ✓ | — |
| `Board` | ✓ | ✓ | ✓ | — (duplicate-person / `canAssign` vetoes render the ⊘ invalid stage) |
| `Blend` | ✓ | — | ✓ | — |
| `Schematic` | — | — | — | — (read-only) |
| `Calendar` | — | — | — | — (visualisation only) |
