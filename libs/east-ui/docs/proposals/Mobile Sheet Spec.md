# Mobile Sheet: the grid on a phone

**Status:** ruled 3 Nov 2026: every recommendation in §8 adopted, and the DX in §9 approved. To be built on PR #1481.
**Visual source:** `Mobile Sheet Spec.html` (self-contained), the designer's canvas trimmed to the Sheet: production at 402 px beside the proposal, and spec cards 05 Column pager, 06 Grid, 07 Action bar and 08 Cell editors.
**Example it is drawn on:** `sheetActionsWorkOrders` (e3-ui `test/sheet/sheet-actions.examples.tsx`), three orders and their steps, starting with one draft so the session row is live.
**Applies at:** a frame 560 px wide or narrower (the Sheet's `phoneFrame`). The frame around the grid is `Mobile Builder Frame Spec.md`; Filters and Search Records are `Mobile Filters Spec.md`.

## 1 · Why

At 402 px today the Sheet gives Step, Good and Done 94 px between its 108 px folded gutter and its 112 px pinned action column, with no sign that Good and Done exist (spec card 01). The proposal pins the first column, shows a window of the others, and pages that window.

## 2 · Column pager (SH1)

**SH1.** A 44 band under the toolbar.
- The readout `Columns 1–2 of 3` (mono 10.5 `--ink-3`, the range 600 `--ink`, a caret 8). It opens the jump menu.
- ‹ and › ghost icon buttons, 44, icons 16 `--ink-2`; `--ink-5` and inert at the ends.
- **SH1.1** ‹ › move the window one column. A pick in the jump menu brings that column into view.
- **SH1.2** The window's scroll animates over `--dur-base` for one column and `--dur-slow` for more, easing out (the design: 200 ms, 360 ms, quintic out); under reduced motion it jumps.
- **SH1.3** A swipe or a drag pans the columns; on release the view settles on the nearest column (`scroll-snap-type: x mandatory`, `scroll-padding-left` the pinned width). A fling carries to the next.
- **SH1.4** The slot: (frame width − pinned width) ÷ columns in view, two by default, one or three by the author's choice (§9 DX), and never more than there are columns to page: the window never ends at an empty slot, so one column beside the pinned one takes the whole width.

**SH2. Jump menu.** 240 wide, `--paper`, 1 px `--rule-strong`, `--r-md`.
- The eyebrow `Go to column`.
- One 44 item a column: a `--brand-d` check on the columns in view, the column's header, its kind in mono 10.5 (`integer`, `action`, `time`).
- A rule, then `Row number`, a checkbox item noted `off by default`; on, it adds a Row column and puts the window back at its start.

## 3 · Grid (SH3–SH7)

**SH3. Header.** 32 tall, `--paper-2`, 1 px `--rule-strong` below, one line: mono 10/600/0.16em caps `--ink-4`. Numeric headers right-aligned. The selected cell's header is tinted `--paper-3`, its label `--ink-2`.

**SH4. Pinned column.** The sheet's first column (Step), 150 wide, padding 0 8 0 16, sticky at the left, a 1 px `--rule-strong` right edge.

**SH5. Rows.** 44 on a coarse pointer, 32 on a fine one, 1 px `--rule`. Numbers mono 13/500 right-aligned; text 13 left.

**SH6. Order band.** 44 tall, `--paper-2`, the band's content sticky at the left across the frame's width:
- a 44 fold chevron (`fa-chevron-down`/`-right` 16, `--ink-3`), named `Fold WO-1042` / `Open WO-1042` — a touch icon alone, as every phone control's is (ruled 8 Nov 2026; the design drew it 12 in a 40);
- the order's name, DM Sans 14/600 (ellipsis);
- its id, mono 11 `--ink-4`;
- at the end, its status: an 8 dot and the word mono 10.5/600 caps in its tone, on a `--brand-tint` chip while drafted.
- **SH6.1** A tap on the band selects the order (`--paper-3`); the chevron folds it.

**SH7. Action cell.**
- Taken: the 8 dot and the state mono 10.5/600 caps in its tone's text step; under it, on a second line, the summary 12.5 `--ink-3` (16 px in, ellipsis). Only at 44 px rows.
- Startable: `Start` 12.5/500 `--brand-d` with `fa-play` 12.
- Blocked: the reason mono 13 italic `--ink-4` (`waits for 10`).

**SH8. Selection and drafts.**
- A tap on the pinned cell selects the row: `--paper-3`, 1 px `--ink` edge, the inset focus ring.
- A tap on any other cell selects it (the same look), tints its header, and opens its bar or editor in the bottom container (SH9, SH10).
- Drafted cells are `--brand-tint` with `--brand-dd` text; so is a drafted band status.
- **SH8.1** ← and → page the columns while the grid has the focus (§8, R4).

## 4 · Action bar (SH9)

**SH9.** Opens in the bottom container when an Action cell is tapped, and drives the step's state.
- Container: in flow above the pane strip, `--paper-2`, 1 px `--rule-strong` above, padding 0 16 12, at most 420 tall, then scrolling.
- Head 44: ‹ back in a sub-view (44); the eyebrow mono 10/600/0.14em (`Step 20 · Weld frame`, or `Hold · step 20` in a sub-view); the state (dot and word, or `not started` mono italic); ⌄ close (44, `fa-chevron-down`).
- Buttons: the first case full width, Default 44, icon 16 + label 12.5/600 (`fa-check` in `--pos`); the rest up to three in one row, Default 44. The consequence under them, mono 10.5 `--ink-3` (`Good 24 · done 14:02 · order stays in progress`).
- **SH9.1** Not started → Start. Started or Reported → Complete, Report, Hold, Alert. Held → Start. Alerted → Start, Complete. Completed and Verified end: `No further actions · 24 good · done 08:42`.
- **SH9.2** Hold opens its reasons as 44 rows (`Awaiting parts · Machine down · Quality hold`) and `Order goes on hold`. Report opens Good parts (− field + · `pcs`, help `Min 0 · plan 24 · default 0`), Report, and `Good becomes 12`. Alert opens What changed (required: `Say what changed before raising the alert.`), Severity Low | High (a 44 segmented strip, help `High puts the order on hold`), Alert, and its consequence.
- **SH9.3** Blocked: `Waits for step 10 · Laser cut. Complete or verify it first.`, no buttons.
- **SH9.4** Every action is a draft of the session.

Versus production (#1479): the same anatomy and cases as the phone bar today, but the bar opens on a tapped Action cell rather than on any selected row, has a ⌄ close, and the cell keeps the summary on its second line.

## 5 · Cell editors (SH10)

**SH10.** Good and Done edit in the same bottom container.
- Head 44: the eyebrow (`Good · step 20 · Weld frame`) and ⌄ close.
- Good: − (44) · the field 44 mono 13 right-aligned · `pcs` mono 10.5 `--ink-4` · + (44). Help `Min 0 · plan 24 · empty until reported`. Digits only.
- Done: the field 44 `hh:mm` mono 13, then Clear (Default 44). Help `24-hour time · digits fill a segment`; it fills hh then mm as typed.
- **SH10.1** Each change is a draft; consecutive edits to one cell are one undo step.
- **SH10.2** A read-only column (Plan) opens no editor.

Versus production: the grid edits in the cell (a stepper for numbers, segments for a time); on a phone those move under the grid.

## 6 · Panes on a phone (SH11, SH12)

The frame's drawers (`Mobile Builder Frame Spec.md` FR4–FR5) hold the Sheet's panes:

**SH11. Library.** Statuses 3 · Columns 4.
- Statuses: a hint (`Tap a status to set it on WO-1043 · Bracket kit. On desktop you drag it onto the order.`, or `Select an order or a step in the sheet, then tap a status here.` with nothing selected), then a 44 row a status: dot, label, `current` on the order's own. A tap sets it on the selected order.
- Columns: `Step stays pinned. Tap a column to go to it.`, then a 44 row a column: its header, its kind (`text · pinned` for Step), and `→`; a tap closes the drawer and pages to the column.

**SH12. Inspector.** Details · Issues N.
- Nothing selected: `Nothing selected`, with `Tap a step to see and edit its fields.` and `Tap an order band to see its totals and steps.`
- A step: the eyebrow `Line 2 · step 20 · WO-1042`, its name DM Sans 18/700, a `Draft` tag while drafted; Good with its stepper and help; Action with its state, its summary and its cases 2-up (a choice or form case closes the drawer and opens the action bar at its sub-view); Done with its time field and Clear.
- An order: the eyebrow `Order · WO-1042`, its name, its status; three stats (Lines · Complete · Good `24 of 72`); `Lines`, one 44 row a step with its state, a tap selecting it.
- Issues with none: `No issues`, `A draft that fails a check lands here.` and `Save waits while an issue is open.`

## 7 · Empty result (SH13)

**SH13.** A narrowing that leaves no line: `No lines match these filters`, `Open Filters and clear Status.` and `Or pick the All tab to see all 7 lines.`, once a completed read says so (CL13).

## 8 · Versus what this PR built, and the rules

| # | Point | The design | Today | Ruled |
|---|---|---|---|---|
| R1 | The action column | A paged column like the others | Pinned at the right, 112 wide, last in the row (`7e22dd4ea`) | The design's: the pager replaces the pin |
| R2 | The action cell's summary | On a second line at 44 px rows | Hidden on a phone (X4) | The design's |
| R3 | When the action bar opens | On a tapped Action cell, with ⌄ close | On any selected row | The design's: a tap on another cell opens its editor instead |
| R4 | ← → with the grid focused | Page the columns | Move the ring between cells (desktop grammar) | Page the columns on a phone frame only; a hardware keyboard on a phone is rare |
| R5 | The gutter on a phone | Gone: no checkbox, no #, no ⋮ row actions, no drag | Folded to 108 (checkbox, #, ⋮ with insert, discard and the grip) | Gone, as drawn; insert, delete and duplicate stay in the Inspector, discard in the session row; row number becomes the optional column |
| R6 | Range selection (T8) | Not drawn on a phone | A range down the action column takes one case on every row | Not on a phone in this round |
| R7 | The Columns tab | Tap goes to the column | Each column's eye hides or shows it | Both on a phone: the row goes to the column, its eye still hides it |
| R8 | The order's stats (Complete · Good) | Shown in the Inspector | The band's own fields; the Sheet knows no "complete" or "good" | The band's own fields, as today; stats an author wants come from their own `inspector` |
| R9 | Editors of other kinds | Number and time drawn | Every column kind edits in its cell | Every kind in the bottom container through `FieldForm`, the inspector's form at touch size, so no kind lacks an editor |
| R10 | Consecutive edits, one undo | One step a cell | A step an edit | Coalesce while the editor stays open on one cell |
| R11 | The Plan column | Optional in the canvas | Not in the example | Leave the example as it is |

## 9 · DX (approved 3 Nov 2026)

The pager needs to know which column to pin and how many to show. Proposed, on `<Sheet>`:

```tsx
<Sheet
    // …as today
    narrow={{ pin: "step", columns: 2 }}
/>
```

- `narrow.pin` — the column a phone frame pins at the left. Default: none — every column pages (ruled 3 Nov 2026, after this section was approved: a pinned first column took a third of a phone's width from every sheet whether its first column named the row or not). A sheet whose first column names its rows pins it here, as `sheetActionsPinned` pins its title.
- `narrow.columns` — how many other columns a phone frame shows at once, 1 to 3. Default: 2.
- Both optional; a sheet that sets neither gets the defaults. Above 560 px neither does anything.

Nothing else is new for an author. The row number column, the pager, the bottom container and the panes' phone forms are the renderer's.
