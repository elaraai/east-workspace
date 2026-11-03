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
| Builder's own band | 44, optional | the Sheet's column pager (`Mobile Sheet Spec.md`) |
| Main | fills | the builder's content, scrolling itself |
| Bottom container | content, at most 420 | the builder's bar or editor when open (the Sheet's action bar, a cell editor) |
| Pane strip | 44 | one tab per pane (FR4) |
| Session bar | 56 + safe area | the history (FR6) |

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
- **FR2.3** The history bar leaves the row (FR6). Every other item is east-ui's Sheet toolbar's.

**FR3.** The FiltersPhone canvas shows a narrower variant of the same row: the views folded into one `All ▾` menu button (a 240 px menu of the views with their counts, `--brand-d` check on the current one), the count `16,667 of 50,000`, Filters and Search Records. Either form is the toolbar's ladder at work: tabs inline while they fit, the menu when they don't.

## 4 · Pane strip and drawers (FR4, FR5)

**FR4. Strip.** 44 px, above the session bar: one equal tab per pane, split by a 1 px `--rule`.

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

## 6 · Session bar (FR6) and Discard (FR8)

**FR6. Session bar.** Production's history buttons, always on the bottom edge.

- 56 + 34 safe area, `--paper`, 1 px `--rule-strong` top, padding 0 12 0 16, buttons 4 apart.
- Summary at the start: `No changes` mono 11 `--ink-4`, or a `--brand-tint` chip `3 changes` mono 11/600 `--brand-dd`.
- Buttons, outline 44 squares, icon 16: Issues `fa-triangle-exclamation` · Undo `fa-arrow-rotate-left` · Redo `fa-arrow-rotate-right` · Discard `fa-xmark` · Save `fa-check`.
- Save fills `--brand-d` with a `--paper` tick while there are drafts. Disabled: 1 px `--rule`, icon `--ink-5`, no action.
- **FR6.1** Undo and Redo step through the session's history. Discard asks first (FR8).
- **FR6.2** Save sends one batch: a live dot replaces the tick while in flight (the `east-pulse` echo), then the bar returns to `No changes`.
- **FR6.3** Issues shows the count and opens Inspector · Issues; at 0 it is disabled, never hidden.

Versus production: the same five sit at the end of the toolbar at 24–28 px, and the issues slot hides at 0.

**FR8. Discard asks first.** Discard confirms before it clears the drafts and their history: eyebrow `Can't be undone`, title `Discard 3 draft changes?` (DM Sans 20/700), body `The drafts and their history go. The orders stay as they were when this session started.`, then Cancel (Default 44) and Discard changes (Primary 44). Cancel keeps the drafts; Discard changes clears them.

The design draws this as a centred `<Dialog>` over a veil. **East has no dialogs** (east-ui CLAUDE.md, "Where the code departs from the design system"): confirmations are anchored popovers built from the design system's popover card. The proposal here keeps the copy and the buttons and anchors them to the Discard button, rising from the session bar (§9, R1).

## 7 · Every builder, not only the Sheet

`BuilderFrame` lays out every builder: the Sheet, the Plan, the Calendar, the Roster, the Allocation, the Schematic, the Flowchart, Studio and the query builder. FR1, FR4–FR6 change the frame, so they reach all of them unless scoped (§9, R3). What each needs from its builder:

- **Toolbar items:** each builder's items keep their ranks; the history item leaves the row for the session bar.
- **Bottom container:** a builder that has one (the Sheet's action bar and editors) hands it to the frame; others give none.
- **Pane strip:** every builder's start and end panes become the strip's two tabs, by their labels and icons.
- **The Elara eye** (`OptimiseButton`): ruled to sit immediately before the history item and never leave the toolbar. With the history in the session bar, the eye moves with it, before Issues (§9, R4).
- **The footer's loading line** (#1398, CL3): the one place a builder says what it reads, live under the cold-load cover. With the footer gone it needs a home (§9, R5).

## 8 · Accessibility and motion

- Every target is 44 × 44 or more.
- The strip's tabs are a tablist; a drawer is a region named by its pane, focus moving into it as it opens and back to its tab as it closes.
- The drawers and the Filters view slide over `--dur-base`; under `prefers-reduced-motion` they appear at once.

## 9 · Rulings (3 Nov 2026)

Every recommendation below is adopted. R3, R6 with R1–R2 were put to the user and ruled so; the rest stand as recommended.

| # | Question | The design | Production / rule | Ruled |
|---|---|---|---|---|
| R1 | Discard's confirmation | A centred `<Dialog>` | No dialogs, ever; confirmations are anchored popovers | An anchored popover from Discard, the design's copy and buttons |
| R2 | Does Discard confirm at all? | Yes | Discard acts at once; Undo cannot bring it back | Confirm on a phone only, where a mis-tap is likely |
| R3 | Scope of the frame changes (FR1, FR4–FR6) | Drawn on the Sheet | One frame for every builder | Every builder at ≤560 px, so the phone frame is one thing |
| R4 | Where the Elara eye goes | Not drawn | Before the history item, never out of the toolbar | Into the session bar, before Issues |
| R5 | Where the loading line goes with no footer | Not drawn | The footer's one live line (CL3) | Into the session bar's summary slot while a read is in flight, the change count otherwise |
| R6 | History out of the toolbar row | The session bar | Ruled 26 Oct 2026: history and Save never leave the toolbar row at a phone's width | Overturn for ≤560 px frames: the session bar keeps them always visible, which is that ruling's aim |

## 10 · Not in this proposal

- Landscape phones and tablets between 560 and 1024 px keep today's frame.
- A builder's own bottom container content is its own spec (`Mobile Sheet Spec.md` for the Sheet).
