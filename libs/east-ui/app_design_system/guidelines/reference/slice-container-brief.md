# Design brief — Slice containers & per-density content

**For:** design (bsys / observe visual specs)
**From:** east-ui engineering
**Status:** request for spec — build follows your update

---

## Context (where we are)

`Slice.*` is the "filter once, narrow everywhere" system. The model in
`index__bsys` §1.5c is solid and not in question:

- **One `SliceHandle<T>` per data domain**, bound once. Affordances
  (Filter / Search / Range / Breakdown / Cohort) write to it; consumers
  (Table / Chart / Stat.*) read narrowed data via `Slice.apply.where`.
- Affordances live by region: **Header** = page-wide (Range, Cohort),
  **frame eyebrow** = per-frame (Filter, Search), **frame body** =
  per-visual (Breakdown, Legend), **Sidebar** = saved-cohort list.

What's **built** today: every affordance exists as a standalone
component, drawn exactly like the `observe__pattern__slice-*` cards.

## The problem

The `observe` pattern specs only show each affordance at its **maximal,
focused size** — Cohort is 4–6 lines tall (chips + ACTIVE block +
predicate box + Edit/Apply/Remove + re-eval footer); Breakdown shows
DIMENSIONS + RESULTING SERIES + ROLL-UP all stacked; Search is a full
open dropdown. That's correct for documenting the affordance in
isolation, but three things are unspecified, and they're blocking:

1. **There is no spec for the composed container** — the actual Frame
   that holds *eyebrow affordances + a consumer visual + a derived
   footer*. The Worked example in `index__bsys` mocks it once in raw
   HTML, but there's no pattern card defining its anatomy, dimensions,
   and states. Engineering needs first-class **slice container(s)**
   specced, not inferred from one mock.

2. **Each affordance needs a defined "compact" density**, not just the
   focused one. In a frame eyebrow the affordance must collapse to ~one
   row (chips + control), with the maximal version reserved for the
   standalone/focused use. Right now only the tall version is drawn, so
   any composition looks wrong (a 4–6 line control bar over a table).

3. **Editing must not resize the parent.** The headline pain: a compact
   top bar shows a cohort in ~1 row; the operator edits its predicate
   (a 4–6 line editor). Today the only drawn editor is the inline tall
   block — dropping that into a frame **shoves the visual down 4–6
   lines** every time someone opens it. That layout shift feels cheap
   and is out of spec (`§Overflow`: *chrome is one row, never wraps*).
   We need the editor to open **over** content (popover / overlay),
   leaving the bar and the body fixed.

## What to design

### A. First-class slice container(s)

Define the **Frame** as a proper pattern (it's a `Card` — the one
container shape). Spec its anatomy and dimensions for at least:

- **Table frame** — eyebrow: Filter chips (left, wraps within cap) +
  Search (right, fixed width); body: the table; footer: derived count
  ("4,218 of 12,840 · narrowed −67%").
- **Chart frame** — eyebrow: Breakdown chips ("Split by …"); body:
  chart + Slice.Legend; footer: optional.

Decide whether this is **one** container with a slot for the visual, or
**a small family** (Table-frame, Chart-frame, Stat-frame). Engineering's
lean: one `Slice.Card` with an eyebrow-affordance set + a body slot the
developer fills with the visual + an auto derived-count footer. Tell us
if the regions/labels differ enough to warrant separate patterns.

Specify: eyebrow height & one-row rule, the two-zone eyebrow grid
(filters flex left / search fixed right), footer treatment, and how the
page **Header** (Range + Cohort pills) relates to the frame visually so
they don't read as duplicate chrome.

### B. Per-density content for every affordance

For each of Filter / Search / Breakdown / Cohort / Legend, draw **two
densities** and the exact content each shows:

- **Compact** (in a frame eyebrow): one row. Active state as chips /
  pill / value, an `+ add` affordance, and overflow → `+M more`. This is
  the new thing we're missing.
- **Focused** (standalone, today's pattern card): the full editor /
  resulting-series / predicate block.

Define the **compress ladder** already named in `§Overflow`: full label
→ icon + value → icon-only → `+M more`. Give the per-pattern inline cap
(Filter cap 4, etc.) and how it drops in a half-width column.

### C. The edit-without-resize surface (the important one)

Specify the **overlay** that lets an operator edit from a compact bar
without moving anything underneath:

- Trigger: clicking a compact chip / `+M more` / "Edit predicate".
- Surface: floats **over** content (popover/overlay anchored to the
  trigger). The bar stays one row; the body never shifts.
- Contents per affordance: the cohort predicate editor (name + clause
  list + field/op/value builder + Create/Apply/Remove), the filter
  builder, the breakdown dimension+roll-up, the `+M more` full list with
  Clear all / Save as cohort foot.
- Spec the overlay's anchoring, max-height + internal scroll, width,
  arrow/no-arrow, dismiss behaviour, and how it reads against the table
  beneath it (shadow, border, z-order). `§Overflow` already says
  *one popover pattern* shared across Filter & Breakdown — please make
  the cohort/edit case fit that same shape so we build it once.

This replaces any "expanding inline panel" idea — we explicitly do **not**
want a region that grows the parent.

## Constraints (already in bsys — keep)

- The frame is a `Card`: 1px rule · 10px radius · paper fill · no shadow.
- Chrome is one row, never wraps, no horizontal scroll. Body may wrap;
  a body wrap never re-flows the chrome.
- Overflow collapses to a single `+M more` → popover; collapsed entries
  stay semantically active.
- Affordance ⇒ region by scope: page-wide → Header, per-frame → eyebrow,
  per-visual → body, cohort list → Sidebar. The container must not
  swallow page-wide controls into the frame eyebrow (a 5-control eyebrow
  is a smell).
- The "detail" of a narrowing is the **consumer visual itself** (rows /
  series), not a separate panel.

## Deliverables we'd then build against

1. Updated `observe__pattern__slice-*` cards showing **compact + focused**
   densities side by side (not just the tall one).
2. A new **slice-container** pattern card (or family) defining frame
   anatomy, the two-zone eyebrow, and the derived footer.
3. A **slice-edit-popover** spec: the shared overlay shape, dimensions,
   anchoring, scroll, and dismiss — covering cohort edit, filter builder,
   breakdown, and `+M more`.

Once these land we'll re-snapshot and implement to match pixel-for-pixel.
