# Mobile Builder Frame: phone layout spec

**Status:** ruled 3 Nov 2026 (§9): every recommendation adopted. To be built on PR #1481.
**Visual source:** `Mobile Builder Frame Spec.html` (self-contained). It is the designer's "Mobile sheet view improvements" canvas trimmed to the frame: the Sheet section (production at 402 px beside the proposal) and spec cards 01 Frame, 02 Toolbar, 09 Pane strip and drawers, 10 Edit session bar and 11 Discard dialog.
**Siblings:** `Mobile Filters Spec.md` (the slice on a phone), `Mobile Sheet Spec.md` (the grid, pager, action bar and editors).
**Applies at:** a frame 560 px wide or narrower, the width at which `BuilderFrame` already overlays its panes (`placePanes`). Above 560 nothing changes.

Each requirement has an id for tests and review. "Versus production" names what changes from east-ui today.

## 1 · What the designer found in production

Measured on the work-orders Sheet at 402 px (spec card 01, the "Today" phone):

- The two pane rails take 88 px of 402 (44 each), and their targets are 24–30 px.
- The Sheet's gutter folds to 108 px on touch, and the action column pins right at 112 px. That leaves 94 px for Step, Good and Done, with no sign that Good and Done exist.
- The toolbar and pane targets are 24–30 px, below the 44 px touch size.
- The footer spends 28 px on counts.

The proposal answers each: the panes leave the sides, the toolbar's targets are 44, the footer goes, and the grid gets the full width.

## 2 · The stack (FR1)

**FR1.** On a phone the frame stacks its regions top to bottom and gives main the full frame width. Side panes never take width.

| Band | Height | Holds |
|---|---|---|
| Safe area | env | the device's top inset |
| Toolbar | 44 | views, the count line, Filters, Search Records (FR2) |
| Toolbar, second row | 56 | the session row: the change count, the Elara eye and the history (FR6) |
| Builder's own band | 44, optional | the Sheet's column pager (`Mobile Sheet Spec.md`) |
| Main | fills | the builder's content, scrolling itself |
| Bottom container | content, at most 420 | the builder's bar or editor when open (the Sheet's action bar, a cell editor) |
| Pane strip | 44 | one tab per pane (FR4) |

- **FR1.1** Above 560 px the frame is unchanged: one toolbar row, pinned side panes, the footer.
- **FR1.2** One overlay at a time: the Filters view, Search Records, a pane drawer, a menu, the Discard confirmation. Opening one closes the others; opening a drawer also closes the bottom container.
- **FR1.3** Main keeps its rows, scroll and selection under every overlay.

Versus production: today the panes collapse to two 44 px rails and open as 320 px overlays with a scrim; the 28 px footer is drawn at every width.

## 3 · Toolbar (FR2, FR3)

**FR2.** One 44 px row. In order:

| Part | Spec |
|---|---|
| Views | The tabs part: mono 11/600/0.16em caps, active `--ink` with a 2 px `--ink` underline, the count mono 500 `--ink-4` after the label. Scrolls sideways, never wraps. |
| + Tab | Dashed caps chip, 34 tall, mono 10.5/600. Shown only while the view has filters no tab holds. |
| Count line | Mono 10.5 `--ink-3`, the number 600 `--ink`: `3 orders`, `2 of 7 lines` while filtered, `…` while counting. |
| Filters | 44 button, `fa-filter` 14. While any field is set: `--brand-tint` fill, 1 px `--brand-d`, `--brand-dd` ink and the active count. |
| Search Records | 44 ghost button, `fa-magnifying-glass` 16 + `fa-caret-down` 10, `--ink-3`; hover `--paper-3`. |

- **FR2.1** A tab tap applies that tab's saved filters. + Tab saves the current filters as a tab named by its choices (`On hold`).
- **FR2.2** Filters opens the Filters view; Search Records opens the key search over the toolbar (`Mobile Filters Spec.md`).
- **FR2.3** The history leaves the first row for the toolbar's second row (FR6). Every other item is east-ui's Sheet toolbar's.

**FR3.** The FiltersPhone canvas shows a narrower variant of the same row: the views folded into one `All ▾` menu button (a 240 px menu of the views with their counts, `--brand-d` check on the current one), the count `16,667 of 50,000`, Filters and Search Records. Either form is the toolbar's ladder at work: tabs inline while they fit, the menu when they don't.

## 4 · Pane strip and drawers (FR4, FR5)

**FR4. Strip.** 44 px, on the frame's bottom edge (plus the safe area): one equal tab per pane, split by a 1 px `--rule`.

- Each tab: icon 14 (`fa-layer-group` for the Library, `fa-sliders` for the Inspector), label mono 11/600/0.16em caps, meta mono 10.5 `--ink-4`. The Library's meta is its tab count (`3`); the Inspector's is what is selected (`WO-1042`, `line 2`).
- Open: `--ink` with a 2 px underline.

**FR5. Drawer.** The pane opens as a drawer up from the strip.

- 500 tall, slides up over `--dur-base --ease-out`, `--r-lg` top corners, 1 px `--rule-strong`, a `--paper-3` veil (72 %) over main.
- Head 44: the pane's tabs (Library: Statuses 3 · Columns 4; Inspector: Details · Issues N), then a collapse button `fa-angles-down` 44.
- **FR5.1** A strip tab opens its drawer; tapping it again, the veil or collapse closes it. One drawer at a time.
- **FR5.2** The drawer's contents are the pane's own tabs (the Library's cards, the Inspector's Details and Issues), drawn at touch size; `Mobile Sheet Spec.md` §6 has the Sheet's.

Versus production: the start and end panes are 44 px side rails that open as 320 px overlays from their edge, with a 48 px scrim strip (`paneWidths`, `MIN_SCRIM`).

## 5 · Overlays from the right (FR7)

**FR7.** The Filters view is a full-height overlay from the right edge, below the safe area, with a 48 px strip of main left showing under a `--paper-3` veil (60 %); a tap on the strip closes it. This is the frame's existing overlay-pane geometry (`MIN_SCRIM` 48), used for the slice's editor. Contents: `Mobile Filters Spec.md`.

## 5a · The bottom panel (FR9)

**FR9.** A builder whose phone form is cards of actions (the Calendar, the Roster, the Allocation; `BuilderFrame`'s `phonePanel`) opens what its main and an open pane's body open in the bottom container of §2, not in a popover (ruled 3 Nov 2026, from the iPhone: "the actions trigger popovers, not a bottom panel like Sheet action cells"). It is drawn as the Sheet's action bar is (`Mobile Sheet Spec.md` SH9): in the flow, over the pane strip, `--paper-2` under a 1 px `--rule-strong`, padded 0 16 12, at most 420 tall and at most 70 % of the frame, the body scrolling while head and foot stay.

- Head 44: the label in mono caps, ⌄ close 44 at its end. Body at touch size; a list edge to edge. Foot: the actions, 44 tall, at its end.
- **FR9.1** Main, or the pane open over the builder, gives way above it, and the trigger is scrolled back into view. A pane's panel lies at the foot of the pane's own view.
- **FR9.2** ⌄, Esc, an action and a tap anywhere else close it; so one is open at a time. A scroll of main does not. Esc closes the panel, not the pane under it.
- **FR9.3** The toolbar's popovers stay views (FR7), Discard asks in its band (FR8), the session row's conflicts open in main's panel in every builder, and past 560 px every one stays the popover it was. The Sheet's own bar, Studio and the query builder do not take the frame's panel for main.

## 5b · Table and Value tree (FR10)

**FR10.** `Table` and `ValueTree` draw their phone forms by themselves at 560 px of their own width or narrower, wherever they stand, with no flag (ruled 4 Nov 2026). The forms are `Query Builder Phone Spec.md` QP8–QP13, generalised to what those parts can hold: sorting stays, as a tap on a header; selection, nested rows, expanded rows and a review's Decision column stay; column groups do not show; the pager lists its columns in place, not in a menu. An aligned stack's plot gutter keeps its own form.

## 6 · Session row (FR6) and Discard (FR8)

**FR6. Session row.** Production's history buttons, as the toolbar's second row, always shown (ruled 3 Nov 2026, after review: the designer drew a session bar on the bottom edge; it moves to the top, under the first row).

- 56 tall (the designer's bar is 90 with 34 of safe area under it: its buttons 6 clear of either rule), `--paper`, 1 px `--rule` between it and the first row, padding 0 12 0 16, buttons 4 apart.
- Summary at the start: `No changes` mono 11 `--ink-4`, or a `--brand-tint` chip `3 changes` mono 11/600 `--brand-dd`.
- Buttons, outline 44 squares on `--r-md`, icon 16: Issues `fa-triangle-exclamation` · Undo `fa-arrow-rotate-left` · Redo `fa-arrow-rotate-right` · Discard `fa-xmark` · Save `fa-check`. Acting: 1 px `--rule-strong`, `--ink`.
- Save fills `--brand-d` with a `--paper` tick while there are drafts. Disabled: 1 px `--rule`, icon `--ink-5`, no action.
- **FR6.1** Undo and Redo step through the session's history. Discard asks first (FR8).
- **FR6.2** Save sends one batch: a live dot replaces the tick while in flight (the `east-pulse` echo), then the row returns to `No changes`.
- **FR6.3** Issues shows the count and opens Inspector · Issues; at 0 it is disabled, never hidden.

Versus production: the same five sit at the end of the toolbar's one row at 24–28 px, folding with it, and the issues slot hides at 0. On a phone they get a row of their own at 44 px, so the toolbar's first row folds without them.

**FR8. Discard asks first.** Discard confirms before it clears the drafts and their history: eyebrow `Can't be undone`, title `Discard 3 draft changes?` (DM Sans 20/700), body `The drafts and their history go. The orders stay as they were when this session started.`, then Cancel (Default 44) and Discard changes (Primary 44). Cancel keeps the drafts; Discard changes clears them.

The design draws this as a centred `<Dialog>` over a veil. **East has no dialogs** (east-ui CLAUDE.md, "Where the code departs from the design system"): confirmations are anchored popovers built from the design system's popover card. It asks in a band under the session row instead (revised 4 Nov 2026, §9, R1): `--paper-2` over a 1 px `--rule-strong`, padded 12 16 16, Cancel and Discard changes as equal 44 halves, what is below giving way; Discard stays on `--paper-3` while it asks.

## 7 · Every builder, not only the Sheet

`BuilderFrame` lays out every builder: the Sheet, the Plan, the Calendar, the Roster, the Allocation, the Schematic, the Flowchart, Studio and the query builder. FR1, FR4–FR6 change the frame, so they reach all of them unless scoped (§9, R3). What each needs from its builder:

- **Toolbar items:** each builder's items keep their ranks; the history item leaves the first row for the session row.
- **Bottom container:** a builder that has one (the Sheet's action bar and editors) hands it to the frame; others give none.
- **Pane strip:** every builder's start and end panes become the strip's two tabs, by their labels and icons.
- **The Elara eye** (`OptimiseButton`): ruled to sit immediately before the history item and never leave the toolbar. It moves with the history into the session row, before Issues (§9, R4), so it stays in the toolbar.
- **The footer's loading line** (#1398, CL3): the one place a builder says what it reads, live under the cold-load cover. With the footer's rail gone it needs a home (§9, R5): laid over main's foot, with the notices below (revised 7 Nov 2026).
- **The footer's live notices** (ruled 3 Nov 2026): a Save's notice, a refused gesture's words, a density, where Find's pick landed, each until something moves it, so none is a toast. The footer's place keeps them: a band laid over main's foot while one stands (`data-footer-live`), taking no room so main never resizes (revised 7 Nov 2026), nothing of its legend or its counts, and no band at all otherwise.

## 8 · Accessibility and motion

- Every target is 44 × 44 or more.
- The strip's tabs are a tablist; a drawer is a region named by its pane, focus moving into it as it opens and back to its tab as it closes.
- The drawers and the Filters view slide over `--dur-base`; under `prefers-reduced-motion` they appear at once.

## 9 · Rulings (3 Nov 2026)

Every recommendation below is adopted. R3, R6 with R1–R2 were put to the user and ruled so; the rest stand as recommended.

| # | Question | The design | Production / rule | Ruled |
|---|---|---|---|---|
| R1 | Discard's confirmation | A centred `<Dialog>` | No dialogs, ever; confirmations are anchored popovers | A band under the session row, the design's copy and buttons (ruled 4 Nov 2026, in place of the anchored popover: no desktop-style popovers on a phone) |
| R2 | Does Discard confirm at all? | Yes | Discard acts at once; Undo cannot bring it back | Confirm on a phone only, where a mis-tap is likely |
| R3 | Scope of the frame changes (FR1, FR4–FR6) | Drawn on the Sheet | One frame for every builder | Every builder at ≤560 px, so the phone frame is one thing |
| R4 | Where the Elara eye goes | Not drawn | Before the history item, never out of the toolbar | Into the session row, before Issues, a 44 px square like its neighbours — from a 312 px frame up (padding 16 + 12, six 44 px buttons, five 4 px gaps); below that it stays in the first row and folds there as before, into the View where the floor needs its room (ruled 3 Nov 2026) |
| R5 | Where the loading line goes with no footer | Not drawn | The footer's one live line (CL3) | Into the session row's summary slot while a read is in flight, the change count otherwise. **Revised 7 Nov 2026:** laid over main's foot in every builder, with the live notices, taking no room. A builder with no second row of its own (read-only, so no history) drew one for the line alone, so main shrank and grew back on every read and a Schematic refitted its drawing each time. The second row keeps its change count |
| R6 | Where the history goes | A session bar on the bottom edge | Ruled 26 Oct 2026: history and Save never leave the toolbar at a phone's width | The toolbar's second row, always shown, its 44 px buttons in a 56 px row: the 26 Oct ruling stands, and the bottom edge is left to the action bar and the pane strip (ruled 3 Nov 2026, revising the first answer of the same day) |

## 10 · Not in this proposal

- Landscape phones and tablets between 560 and 1024 px keep today's frame.
- A builder's own bottom container content is its own spec (`Mobile Sheet Spec.md` for the Sheet).
