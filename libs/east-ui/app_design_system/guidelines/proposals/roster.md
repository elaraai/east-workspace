# `<Roster>` — people-on-shifts grid (Planner.Point specialisation)
> **2026-06-11:** interface unified to the row-mapper pattern — `person={p => ({...})}` / `shift={s => ({...})}` fields objects (omissible for resolved rows); `personHeader` is config.


> **Status: implemented (IR + renderer + recipe), drag verified end-to-end.** The interface was redesigned
> in review away from this proposal's Planner-shaped accessor/constructor
> form, to the Table/Chart house style: **two flat tables + field
> encodings**. The component owns the week — no axis machinery, no
> `Roster.shift` / `Roster.at` constructors.
>
> ```tsx
> <Roster
>     id="roster-se"
>     sources={["people"]}
>     mode="edit"
>     people={people}
>     person={{ key: p => p.id, label: p => p.name, sublabel: p => p.target }}
>     shifts={shifts}
>     shift={{ key: s => s.id, person: s => s.person, day: s => s.day,
>              hours: s => s.hours, state: s => s.state }}
>     days={["Mon", "Tue", "Wed", "Thu", "Fri"]}   // optional; defaults Mon–Sun
>     summary="3 dirty · 1 new · 2 ghost"
>     onDrag={onDrag} onSelect={onSelect} onAccept={onAccept} onAddAt={onAddAt}
> />
> ```
>
> Shift `state` is a typed `PlannerStateType` field in the data
> (`variant("committed", null)`, `variant("proposed", variant("model",
> null))`, …) — the shared event-state grammar is the part of the Planner
> chassis that survives in the API. `onSelect` / `onAccept` / `onAddAt` all
> take drag-grammar `CellRefType` refs. Planner reuse beyond that is an
> IR/renderer implementation detail.

Source spec: `configure__pattern__roster` (`Collections.Roster`).
Category: `collections/roster`. Per spec it is **a configuration of
`Planner.Point`** — rows = people, axis = datetime, same event-state grammar
(committed / proposed / rejected) — so the proposal reuses the Planner chassis
(types, axis builders, renderer core) rather than forking it.

## Anatomy (from spec)

- Frame: eyebrow title (`EDIT ROSTER · SE REGION · WK OF SEP 16`) +
  header-right dirty summary (`3 DIRTY · 1 NEW · 2 GHOST · SHOW DIFF →`).
- Tools row: `Edit` toggle (solid when active), `+ Add shift`, `Constraints`;
  caption right (`DRAG HANDLES ⠿ · CLICK EMPTY CELL TO ADD`).
- Grid: frozen operator column (name + hours sublabel `38h → 30h`, grip when
  row-draggable), day columns, shift chips per cell. Chip states:
  - **committed** — outlined chip, grip only in edit mode
  - **changed/added** — `+8h` brand-tint treatment
  - **rejected/removed** — strikethrough arrow form (`8h ▸ —`, warn tone)
  - **model ghost** — dashed `+ ghost 4h`, accept affordance
  - selected chip gets the ink outline
- Status strip: selection + counts left, keyboard hints right
  (`⌫ delete · ⌥-drag duplicate · ⏎ accept ghost`).
- Footer: impact summary left (`−$8k OT · 0 SLA risk · 2 ghost shifts
  pending`), `Reset` / `Review diff` actions right (Commit.Bar pairing).

## TSX

```tsx
<Roster
    id="roster-se"                                  // DnD target id
    sources={["people"]}                            // permitted Library ids (declared connection)
    data={operators}                                // ArrayType(StructType)
    columns={[{ key: "operator", header: "Operator", frozen: true,
                value: r => r.name, sublabel: r => East.str`${r.hours}h` }]}
    axis={Planner.axis.time({ start: weekStart, end: weekEnd, step: "day", format: "ddd" })}
    shifts={r => r.shifts.map(s => Roster.shift({
        key: s.id,
        slot: Planner.at.time(s.day),
        hours: s.hours,                             // chip label is `${hours}h`
        state: s.state,                             // "committed" | "added" | "removed" | "ghost"
    }))}
    mode={editMode.ifElse("edit", "published")}     // published = committed-only, no grips
    title="Edit roster · SE region · wk of Sep 16"
    summary={East.str`${dirty} dirty · ${added} new · ${ghosts} ghost`}
    onDrag={onDrag}                                 // DragEventType — add / move / remove
    onSelect={onSelectShift}                        // shift click → RosterSelectEvent
    onAccept={onAcceptGhost}                        // ⏎ / click on a ghost chip
    onAddAt={onClickEmptyCell}                      // click empty cell in edit mode → CellRef
/>
```

The frame/tools/footer chrome (`Show diff`, `Add shift`, `Constraints`,
`Reset` / `Review diff`, impact strip) is **page composition**, not baked into
the component — same division as Planner today. The component owns the grid +
status strip; the host composes Commit.Bar and toolbar buttons around it. The
spec's tools row maps to ordinary `Button`s the host places in the frame.

## Props (`RosterConfig<R>`) — delta from `PlannerConfig`

| Prop | Type | Notes |
|---|---|---|
| `id` | `string` | DnD target identity |
| `sources?` | `string[]` | Library ids accepted for `add`; omitted = no adds |
| `shifts` | `(r) => ArrayType<RosterShiftType>` | replaces Planner's `events`; `Roster.shift` constructor |
| `mode?` | `"published" \| "edit"` (expr ok) | published renders committed-only, pointer-immutable |
| `summary?` | `StringType` | status-strip left text (counts) |
| `onDrag?` | `FunctionType([DragEventType], NullType)` | one funnel for add/move/remove |
| `onSelect?` | `FunctionType([RosterSelectEventType], NullType)` | row/slot/shift key |
| `onAccept?` | `FunctionType([RosterShiftRefType], NullType)` | ghost acceptance |
| `onAddAt?` | `FunctionType([CellRefType], NullType)` | empty-cell click in edit mode |

Inherited unchanged from Planner: `columns`, `axis`, `groupBy`, `density`,
`slotMinWidth`, `markers`.

`Roster.shift({ key, slot, hours, state, note? })` wraps `Planner.event` with
the shift-label rendering and the ghost state. `state: "ghost"` is the only
new state — committed/added/removed reuse the Planner event-state grammar.

## DnD semantics (per the matrix + grammar)

- `add` from a declared Library lands as a **proposed** shift (`added`).
- `move` within a row applies directly (still a proposed patch). **Cross-row
  move fires the same `move` event** — the host derives the
  `Communicate.Swap` proposal from `from.row ≠ to.row`; the component does
  not special-case it beyond the spec's visual (proposed treatment on both
  cells).
- `remove` = drag off the cell to trash or back to the Library.
- No resize (point events). Committed chips show no grip and refuse drags.
- Every event funnels through `onDrag` → host commit pipeline; no silent
  writes.

## Renderer notes

- Reuses the Planner renderer chassis (virtualised rows, frozen columns,
  slot grid) with a `roster` slot recipe for the chip states (ghost dashes,
  changed tint, rejected strike) layered on the planner recipe.
- Grip glyphs, drag ghost, drop indicators come from the shared
  `DragLayerProvider` (see `00-drag-grammar.md`), gated on `mode = edit` and
  per-chip state.

## Decisions (reviewed)

1. **`onAccept` is its own callback** — ghosts get the first-class
   affordance the spec gives them.
2. **The status strip stays visible in published mode** (selection summary is
   useful read-only); only the edit-only keyboard hints (`⌫ delete ·
   ⌥-drag duplicate · ⏎ accept ghost`) hide outside edit mode.
