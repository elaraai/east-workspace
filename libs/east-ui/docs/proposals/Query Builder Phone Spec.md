# The query builder on a phone

**Status:** proposal, 4 Nov 2026. **Visual source:** `Query Builder Phone.html` (self-contained). Every state is drawn at 390 in light and dark (ids 1a–5e), every phone is live, Tweaks › Frame width redraws them all at 324 or 294, and section 6 shows four states at both widths.
**Applies at:** a frame 560 px wide or narrower. It builds on `Mobile Builder Frame Spec.md` (FR1–FR8) and `Mobile Filters Spec.md`. Desktop does not change.

## Answers

1. **Reading comes first.** Main is the result. The steps are one tap away in the Query view. A new query has nothing to read yet, so it opens on its steps. Run in the Query view closes it onto the fresh result.
2. **A wide result uses paged columns, as the Sheet does.** The first field stays pinned, and as many columns as fit whole sit beside it. ‹ › page one column, and *Columns 1–3 of 4* jumps to any column. No value is cut. Tree reads one row whole.
3. **What stays and what moves.** The toolbar keeps Table · Tree, the count line and Run, and the session row stays as ruled. Everything else moves to where it acts:
   - The run's read-outs and Download go into *This result*, opened from the count line.
   - Copy jq and Save… go into the Query view.
   - The check goes to Issues and the Query view's foot.
   - The name and save state go to the Query view's head.
   - **Run** runs the query: the toolbar's Run on the result, and the foot's Run while writing.
4. **Steps read as sentences.** Each clause is one sentence in a 44 row, at 390 and 294 alike. A tap opens that clause's slots under it as full-width rows, as the Filters view opens a field, and one clause is open at a time. A slot's choices open as a full-height view. jq wraps between tokens with a hanging indent and never scrolls sideways.

**Nothing floats.** There are no popovers and no menus. Choices open as full-height views, and confirmations and actions open inline.

## 1 · The stack at 390

| Band | Height | Holds |
|---|---|---|
| Safe area | device (50 drawn) | — |
| Toolbar | 44 | Table · Tree, the count line, Run |
| Session row | 56 | summary, Issues, Undo, Redo, Discard, Save, 44 each (FR6) |
| Discard band | content | only while Discard asks (QP7) |
| Pager band | 44 | `Columns 1–3 of 4 ▾`, ‹ › (Table, when a column is off-screen) |
| Main | fills | a stale, error or reading band, then the Table, the Tree or the empty state |
| Live band | ≥ 44 | one notice while it stands (frame §7) |
| Pane strip | 44 | Query · Datasets · Library |
| Safe area | device (34 drawn) | — |

## 2 · Rules

**Toolbar**
- **QP1** One 44 row, padding 0 12, gap 8, 1 px `--rule` under it. Its items, in order: Table · Tree, the count line, and Run against the end. Run sits 12 px from the frame edge. Each control draws a 32 box centred in its 44 tap target, as the finished builders' first rows do, so no box touches the row's edges.
- **QP2** Table · Tree is the SegmentGroup at md: a 32 box (1 px `--rule-strong`, `--r-md`) in 44 targets. Options pad 0 12 and use mono 11/600/0.16em caps with a 14 icon (`fa-table`, `fa-sitemap`). Rest is `--ink-4`; active is `--brand-tint` with `--brand-dd`. Below 366 px it folds to two 44-wide icon options. Before the first run it is disabled (`--ink-5`).
- **QP3** The count line is a 44 target around a 32 ghost box, padding 0 8 (`--paper-2` on hover, `--paper-3` while its view is open). It uses mono 10.5 `--ink-3` with the number in 600 `--ink`, plus `fa-caret-down` 10 `--ink-4`. It opens *This result* (QP33). Before a run it reads `not run` in mono italic 400 `--ink-4`; while counting it reads `…`. A long count wraps at its spaces, to two lines at most.
- **QP4** Run is the one Primary on the result: a 32 box in a 44 target, padding 0 12, `fa-play` 14, 12.5/600, no key cap. The count line has no caret while counting. While a run is in flight the live dot takes the icon slot, the label stays, and the button carries `aria-busy`. ⌘⏎ still runs the query from a hardware keyboard.

**Session row** (FR6 as ruled)
- **QP5** The summary shows only when it fits whole, from 334 px up: `No changes`, the `1 change` chip, or `● Reading` while a read is in flight (R5).
- **QP6** Issues shows its icon and count (`⚠ 1`, the count in mono 11/600 `--warn-text`). A tap opens the Query view with the first issue's clause open. At 0 issues it is disabled. Save waits while any issue stands.
- **QP7** Discard opens a band under the session row and goes `--paper-3` while it is open. The band is `--paper-2` with a 1 px `--rule-strong` under it, padding 12 16 16. It holds the ruled copy: the eyebrow *Can't be undone*, the title *Discard 1 draft change?* in DM Sans 20/700, and a 13 `--ink-2` body. Below that, Cancel (Default) and Discard changes (Primary) sit as equal 44 halves.

**Result**
- **QP8** The pager band is the Sheet's: 44 tall, padding 0 4 0 16. The range is a menu button in mono 10.5, with the range in 600 `--ink`, and it opens *Columns*. ‹ › are 44 ghosts with a 16 chevron, `--ink-2`, or `--ink-5` at the ends. It shows only in Table mode, after a run, when some column is off-screen.
- **QP9** Table header: 32 tall on `--paper-2`, with 1 px `--rule-strong` under it. Labels are mono 10/600/0.16em caps `--ink-4`, right-aligned over numbers. Rows are 36 with a 1 px `--rule`, read-only, so comfortable touch rows.
- **QP10** The first field is pinned. Its width is its widest label or value plus 28 (padding 16 | 12), with a 1 px `--rule-strong` right edge.
- **QP11** Each other column's natural width is its widest label or value plus 24. The last column in view takes 16 on its right. As many columns as fit whole stand beside the pinned one, and any spare width is shared between them equally. › moves the first column in view by one. The last page holds the most columns that fit, counted back from the end. A value wider than the frame wraps at its spaces.
- **QP12** Numbers are mono 13/500 tabular; text is Inter Tight 13. An absent value reads `no data` in mono italic 400 `--ink-4`. The per-header pin and fold buttons are gone.
- **QP13** Tree branch rows are 44 tall: chevron `fa-angle-right` 14, label 13/500, and a preview in mono 10.5 `--ink-4` built from whole ` · ` parts, or none. Field rows are 36, indented 24 behind a 1 px `--rule` guide, with the key in 13 `--ink-3` in a 96 column. Values wrap.
- **QP14** Bands at the top of main:
  - *Stale*: `--paper-2`, a dashed `--rule-strong` bottom edge, a dashed Stale tag, the line *The query changed after this run.*, and a 44 Run again link. Rows below turn dashed.
  - *Not run*: a 6 % `--neg` wash with a 1 px `--neg` bottom edge, `circle-exclamation`, and the word in mono 10/600 caps `--neg-text`. The message is 13 `--ink`, followed by one 44 link (*Show the problem →* or *Run again →*). The last rows stay below it, dashed.
  - *Reading*: the live dot and *Reading customers and orders* in 13 `--ink-2`, over skeleton bars (12 tall, `--paper-3`) laid out as the final table, with the headers drawn.
- **QP15** A query that has never run shows the empty state, centred with padding 40/20: ☐ in mono 26 `--rule-strong`, then *Run the query to see results* in DM Sans 15/700, then a checklist in 13 `--ink-2`.

**Live band and strip**
- **QP16** The live band sits over the strip, min 44 tall, with a 1 px `--rule` above it and padding 4 4 4 16. It holds an 8 px `--info` dot or a `--pos` check, a 12.5 `--ink-2` notice that wraps, and a 44 ×. It carries *Opened “Top shipped orders, 2026” from the query library.* and *Saved “…” · 22:46*. Each notice stands until another replaces it or × dismisses it.
- **QP17** The strip has three equal tabs, one per pane tab, split by 1 px `--rule` inset 10: Query (`fa-diagram-project`, meta the step count), Datasets (`fa-database`, 5) and Library (`fa-layer-group`, 8). Labels are mono 11/600/0.16em caps `--ink-3`; meta is mono 10.5 `--ink-4`. Icons show from 360 px up, where each tab has 103 + 16 px.

**Pane views**
- **QP18** A tab opens its view over the whole builder, from below the safe area to the bottom edge. One view is open at a time. Main keeps its scroll and its columns.
- **QP19** The head is 44 tall: the three tabs (gap 20, padding-left 16, the active one `--ink` with a 2 px underline), then ⌄⌄ `fa-angles-down` 14 in a 44 square, which goes back to the result. The tabs carry no counts, since three don't fit at 294 with them.

**Query view**
- **QP20** Band, 56 tall: Visual · jq at 44 with labels at every width, and Copy jq, a 44 ghost, at the end. Copy jq shows *Copied* with a `--pos` check for 1.6 s.
- **QP21** The body is `--paper-2` and scrolls. Its head block is `--paper`, padding 12 16, with a 1 px `--rule` under it:
  - an eyebrow with the save state and step count (*Saved · 5 steps*, *Unsaved changes · 5 steps*, *Not saved · no steps*);
  - the name in DM Sans 16/700;
  - the description in 12.5 `--ink-3`, the author's or else the generated one.
- **QP22** The source card is an Item card with padding 12, a 36 tile, *Start with orders* in 13/600, and the path and kind in 12.5 `--ink-3`. Shape lines are min 44 tall, with a 1 px `--rule-strong` connector 20 in. They use mono 10.5, with the count in 600 `--ink` after a fresh run and words otherwise. Insert is a 44 ghost on each shape line.
- **QP23** A step card is `--paper` with a 1 px `--rule-strong` edge (dashed while unfinished) on `--r-md`. Its head is min 44: the number in mono 10.5 `--ink-4` in a 16 column, a 14 icon in a 16 column, the title in 13/600, which wraps at words, and ⋯ as a 44 ghost.
- **QP24** A clause row is min 44 tall, padding 8 12, with a 1 px `--rule` above it. It holds:
  - the joiner (`and` / `or`) in 12.5 `--ink-4` in a 28 column, so conditions line up;
  - the sentence in 13: field 500 `--ink`, words `--ink-3`, value 500 `--ink`, with numbers and dates in mono;
  - a 12 chevron that turns 180° when the clause is open.
  With two or more conditions, the first row reads *all of these are true*.
- **QP25** One clause is open at a time across the whole query, and a tap toggles it. Its editor opens under it on `--paper-2`, padding 12, gap 8. Each slot gets a label in 12.5/500 `--ink-3` in a 72 column, then a select trigger: min 44, 1 px `--rule-strong`, `--r-md`, value 13, caret 10. An empty slot is dashed and shows its placeholder word in `--ink-4`. A dirty slot is `--brand-tint` with `--brand-dd`. Remove condition, a 44 ghost, ends the editor.
- **QP26** A problem sits under its clause on a 6 % `--neg` wash: `circle-exclamation` 14, the checker's words in 12.5 `--neg-text`, and its fix as a Default 44 button (*Keep only shipped orders first*).
- **QP27** ⋯ opens the step's actions inline in the card: Move up, Move down and Remove step, as Default 44 buttons that wrap. A disabled end has a 1 px `--rule` and `--ink-5`. A second tap on ⋯ closes them.
- **QP28** The feet (*+ Add condition*, *+ Add group*, *+ Add field*) are 44 link buttons in `--brand-d`. *Add a step at the end* is a 44 button with a 1 px dashed `--rule-strong` edge, after the last step in the scrolling body. Nothing covers the steps.
- **QP29** The sticky foot has a 1 px `--rule-strong` above it, padding 12 16, gap 8.
  - First, the status: an 8 px dot and a word in mono 10.5/600/0.1em caps. *Checks clean* is `--ink-3` with a `--pos` dot, *1 to finish* is `--warn-text`, *1 problem* is `--neg-text`. After it, *Gives up to 10 orders* in 12.5 `--ink-2`.
  - Then Save… (Default) and Run (Primary) as equal 44 halves.
  - Run closes the view onto the result. With an issue it stays open, opens the issue's clause and doesn't run.

**jq**
- **QP30** The code is mono 12.5 on a 20 px line, with ligatures off so `>=` and `==` read as typed. The gutter is 36 wide on `--paper-2` with a 1 px `--rule`: numbers in mono 11 `--ink-4`, and an 8 px `--neg` dot on a line where a problem starts.
- **QP31** Lines wrap only between tokens: after a space or `( [ { , | ;`, and before a `.field` that follows a field, `]` or `)`. A wrapped line hangs 2ch in. The number stays on its first row.
- **QP32** Colours: keywords and variables `--brand-dd` 600, builtins `--brand-d`, fields `--ink`, strings `--ink-3`, numbers `--ink-2`, operators `--ink-4`. A problem gets a wavy `--neg` underline.
  - Problem rows follow the code: position in mono 10.5/600 `--neg-text`, code in mono 10.5 `--ink-4`, message in 13 `--ink`.
  - Completions dock between the code and the foot as three 44 rows: a 24 × 20 glyph, the label in mono 13 and the detail in mono 10.5. The active one is `--paper-3`, and its doc follows in 12.5 `--ink-3`.

**Full-height views** (instead of every popover)
- **QP33** A view covers the builder: the pane view if one is open, everything below the safe area otherwise.
  - Head, min 44: ← 44 (`fa-arrow-left` 16 `--ink-3`, named *Back to the step* or *Back to the result*), the title in DM Sans 16/700, then the context in mono 10.5 `--ink-4`, which wraps.
  - An optional 56 band with a 44 field: a filter, or a typed value in mono with `inputmode` numeric or decimal.
  - The list or form, then a foot: either a mono 10.5 note saying where the options come from, or the commit buttons.
  - List rows are min 44, padding 8 16, with a 1 px `--rule`. Each has a 16 icon column, the label in 13 (numbers in mono 500) and a sub-line in mono 10.5 `--ink-4`. The current row is `--paper-3` with a 12 `--brand-d` check. A disabled row is `--ink-5`, with its reason as the sub-line.
- **QP34** The views:
  - *Slot picker*: every slot. Picking returns to the step. When a new field clears the value, the Value picker opens next.
  - *Columns*: the pinned field first, then each column with its kind and a check while it is in view.
  - *This result*: key/value rows (key column 96, gaps 12 and 8) for Query, Gives, Run and Reads. Then *How this run reads its data*, then Download CSV · BEAST2 as Default 44 halves.
  - *Add a step*: Quick add's five, then the rest, with disabled steps saying why.
  - *Save query*: the name (44, with the focus ring) and the description (three lines, its help as on desktop). Cancel (Default) and Save (Primary) sit as halves in a foot that rides above the keyboard.

**Datasets and Library**
- **QP35** Band, 56 tall: a 44 search (`fa-magnifying-glass` 14 `--ink-4`, text 13, × 44 to clear) and a 44 group-by ghost. Group heads are mono 10/600/0.14em caps with the count in mono 10.5, padding 16 0 8.
- **QP36** Items are min 56 tall, padding 8 12, with a 1 px `--rule` on `--r-md` and gap 12: a 36 tile and the name in 13/600, which wraps.
  - Datasets meta is mono 10.5 `--ink-4` and wraps at its ` · ` joins.
  - Library descriptions are 12.5 `--ink-3`, two lines at most, ending on a whole word and `…`.
  - An item the open query reads is `--brand-tint` with 1 px `--brand-d`, the name `--brand-dd`, and a trailing 12 `--brand-d` glyph: play for the source, the arrows for a lookup.
- **QP37** The foot is a min 44 hint in mono 11 `--ink-3` saying what a tap does. With no match, the list shows `×` in mono 26 `--rule-strong`, *No queries match “refunds”* in DM Sans 15/700, and a checklist.

**States, motion, access**
- **QP38** Starting a query opens its Query view, with *Started a new query on orders.* at the top. Opening a saved query runs it and lands on the result with the Opened notice. After an edit the result is stale, and the shape lines show words until the next run.
- **QP39** Views and bands appear over `--dur-base --ease-out`, and at once under reduced motion. The live dot's echo is the only loop, and reduced motion removes it.
- **QP40** Every target is 44 or more, links included: a checklist's link sits on its own 44 line under the list, never inside a sentence. The count line keeps a 44 minimum while it reads `…`, and is disabled until a result exists. Tabs are tablists and views are named regions. Toggles carry `aria-expanded`. Every icon-only button has a name.

## 3 · Fit at 390 · 324 · 294

| Part | 390 | 324 | 294 |
|---|---|---|---|
| Table · Tree | labels | icons | icons |
| Toolbar, spare after Run | 24 | 41 | 11 |
| Session summary | shown | hidden | hidden |
| Columns in view (default query) | 1–3 of 4 | 1–2 of 4 | 1–2 of 4 |
| Strip icons | shown | hidden | hidden |
| Pane head, spare after ⌄⌄ | 119 | 53 | 23 |
| jq characters a row | 44 | 35 | 31 |
| Step titles | one line | wrap at words | wrap at words |

## 4 · Departures

**From desktop**
1. **Table · Tree joins the toolbar, and Download goes into *This result*.** This leaves one builder band, the Sheet's pager. The Flowchart puts its LR · TD in its toolbar the same way.
2. **Copy jq and Save… leave the toolbar for the Query view.** They act on the program. At 294 the toolbar holds three items whole, and the session row's Save already saves the query as it stands.
3. **The ⌘⏎ key cap goes.** It means nothing on glass. The shortcut still works.
4. **The status line and the results footer go** (frame §1, "the footer goes"). The count goes to the toolbar, the read-outs to *This result*, the check to Issues and the Query view's foot, and the save state and name to the Query view's head.
5. **Sideways scrolling gives way to paged columns with the first field pinned.** The per-header pin and fold buttons go. Paging keeps every value whole and says what is off-screen.
6. **Conditions read as sentences, and their slots open one clause at a time.** At 294 a condition's three slots can't share a line without cutting words.
7. **Step actions fold into ⋯ (inline), Quick add folds into *Add a step*, and Insert loses its dashed edge.** Three icon buttons, a chip rail and dashed boxes between steps crowd a 262 card. Quick add's five lead the step list.
8. **jq soft-wraps between tokens, *ctrl space · suggestions* is dropped, and completions dock above the foot.** There is no Ctrl key, and suggestions open as you type.
9. **Popovers become full-height views (pickers, Columns, This result, Add a step, Save query) or inline bands.** A floating card covers what it edits and fights the keyboard. The rule is: a choice gets a full view, a confirmation or an action stays in place.
10. **A run in flight reads *Run* with the live dot, where desktop shows *Running* with a spinner.** This follows the design system's loading rule.
11. **Library descriptions are prose: Inter 12.5 in two lines.** Production shows one mono line cut mid-word.
12. **The Opened notice moves to the live band.** You land on the result, where the Query tab's banner can't be seen. Notices about the steps (*Started…*, jq parts) stay in the Query view.

**From the frame rules and the brief**
1. **First-row controls draw a 32 box in a 44 tap target, not a 44 box (FR2).** A 44 box fills the 44 row edge to edge and its border merges with the row's rule. The finished builders draw theirs at 32 (the Plan's Filters, the Flowchart's LR · TD).
2. **The strip carries the pane's three tabs, not one tab per pane (FR4).** The query builder has a single pane, and its strip today holds one centred tab.
3. **Discard asks in a band under the session row, not an anchored popover (R1).** This follows the direction to remove popovers. The copy and both buttons are the ruled ones.
4. **Issues opens the Query view at the first issue, not Inspector · Issues (FR6.3).** There is no Inspector here; the issues live in the steps.
5. **The Elara eye isn't drawn (R4).** The builder draws no assistant (#875 §1).
6. **The pane head drops its counts, and strip icons start at 360.** Neither fits whole at 294 otherwise.
7. **Result rows are 36, not the Sheet's 44.** They are read-only, and touch keeps comfortable rows; every tappable row is 44.
8. **The brief allowed anchored popovers. None are used.** See desktop item 9.

## 5 · Open

- Move up and Move down are drawn but not wired in the mock; the rest of each phone is live.
- jq's transparent-textarea editor needs a highlight layer that wraps where the textarea does (QP31).
- A value wider than the whole frame wraps in its row (QP11). Its row height then grows past 36; check this against the Table renderer.
