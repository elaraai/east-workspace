# `<Board>` — single-day areas × shifts assignment board

> **Status: implemented (IR + renderer + recipe + spec pattern), drag verified
> via the drag-layer + board DOM suites.** Design issue:
> `elaraai/east-workspace#198` (epic `#197`). Spec pattern:
> `configure.html#board`.

The transposed sibling question to [roster.md](./roster.md): not "what is
each person's week?" but *"who is in each area, on each shift, today?"*
Rows = areas, columns = the day's shifts, and each cell holds **multiple
people** as chips under the shared event-state grammar. The week `<Roster>`
was reviewed for this and can structurally *fake* the view (its rows and
day columns are generic, cells already stack chips) — but proposal-decorated
chip text, committed-chips-immobile drag rules, no coverage concept, and
people-on-shifts naming make that a misuse, so the board is its own
component.

## Naming (reviewed)

- **`<Roster.Board>` sub-tag — rejected.** No component has a bare tag that
  also namespaces a *structurally different* sibling: nested tags are
  same-component presets (`Text.MonoLabel`) or bare-tag-less families
  (`Planner.Point` / `Slice.Rail`).
- **`Roster.Calendar` + `Roster.Board` symmetric rename — shelved.** Fixes
  the asymmetry but churns a shipped tag; revisit only if a third rostering
  surface justifies the namespace.
- **`<Board>` standalone — chosen.** Matches the dominant bare-tag pattern,
  and "board" is already the spec's noun for this grid (`spec.css`
  `.board-grid` — "assignment board").

## TSX

```tsx
<Board
    id="board-tue"                        // DnD target id
    sources={["people"]}                  // permitted Library ids
    mode="edit"                           // published (default) | edit
    areas={areas}       area={a => ({ key: a.id, label: a.name, sublabel: a.wing })}
    areaHeader="Ward"                     // optional; omitted = blank (zero baked copy)
    shifts={dayShifts}  shift={s => ({ key: s.id, label: s.name, sublabel: s.window })}
    people={people}     person={p => ({ key: p.id, label: p.name, sublabel: p.role })}
    assignments={rows}  assignment={x => ({ key: x.id, person: x.personId,
                                            area: x.areaId, shift: x.shiftId, state: x.state })}
    requirements={reqs} requirement={r => ({ area: r.areaId, shift: r.shiftId, required: r.count })}
    maxVisible={6}                        // optional; unset = uncapped stack
    summary="2 open · 3 proposed"
    onDrag={onDrag} onSelect={onSelect} onAccept={onAccept} onAddAt={onAddAt}
/>
```

Flat tables + row-mapper field encodings (mappers omissible for resolved
rows). Cell = (`area.key`, `shift.key`); the chip face comes from joining
`assignment.person` to `people` by key (unknown person → the raw key;
assignments naming an unknown area/shift never render, as in Roster).

## Decisions (reviewed)

1. **Zero baked copy.** The component renders numerals, glyphs and tones
   only: coverage is `n/required` (+ tone under/ok/over), open slots are
   dashed `⊕` placeholders, added/ghost chips carry a `+` glyph prefix and
   removed chips a strikethrough (never `▸ —` / "ghost" words). All strings
   arrive as data or props (`summary`, `areaHeader`); the roster-style
   hardcoded strip hints were deliberately not carried over, and toolbar
   chrome is page composition.
2. **Same drag stack, unchanged.** `contracts/drag.ts` types map directly
   (`row` = area key, `slot` = shift key); the renderer reuses
   `useDragTarget` / `useDropCell` / `useDragEventChip` + the shared sinks.
   Committed chips refuse drags (grammar invariant); `move` is intra-surface
   by drag-layer design.
3. **Per-payload vetoes are first-class.** The drag layer's cell
   registration accepts a `canDrop(payload)` predicate: a connected-but-
   vetoed cell is never marked `data-drop-valid`, renders the invalid
   treatment while hovered (`data-drop-invalid` — red outline, ⊘ badge,
   not-allowed cursor, styled globally alongside the other drag stages), and
   the drop is a no-op. The board vetoes on **duplicate person in the cell**
   and on the host's **`canAssign(person, area, shift) => Boolean`**
   predicate (IR option; verdict-cached, fail-open on throw — the Schematic
   `canConnect` convention).
4. **Coverage counts committed + proposed-added**; ghosts fill visually but
   don't count; open slots = `required − filled − ghosts`, each a drop hint
   and an `onAddAt` target. No requirement row → plain stack, no chrome.
5. **Overflow** (`maxVisible`): `+N` chip opens a lazy-mounted popover
   listing the hidden chips with select/accept affordances; drag-out from
   the popover is deferred.
6. **No platform functions** — pure component; renders through the generic
   dispatcher in e3-ui with no `UITaskPreview` / `useDatasetValue` wiring.

## Deferred (tracked on epic #197)

Multi-day boards (day-grouped columns; cross-surface chip drags need a
further drag-layer extension) · drag-out from the overflow popover ·
committed-chip drag-to-propose · same-person-two-areas conflict flags ·
board↔week linked selection · e3-ui staged-writes recipe ·
`Communicate.Swap` routing · per-area / per-shift coverage totals · row
virtualization.
