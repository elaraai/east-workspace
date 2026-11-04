# Mobile Filters: the slice on a phone

**Status:** ruled 3 Nov 2026 (§6): every recommendation adopted. To be built on PR #1481.
**Visual source:** `Mobile Filters Spec.html` (self-contained), the designer's canvas trimmed to the Filters section: four phones (the toolbar, Filters with Status open, Filters with Due open, Search Records), the rules beside them, and spec cards 03 Search Records and 04 Filters view.
**Example it is drawn on:** `sheetRecordIndexes` / `sheetRecordIndexesMobile` (e3-ui `test/sheet/sheet-records.examples.tsx`): 50,000 work orders narrowed through the record's indexes, with one field of every kind.
**Applies at:** a frame 560 px wide or narrower. Above it, the rail and its popover are unchanged.

## 1 · Two controls, never one (SL1)

**SL1.** The toolbar holds two controls that do different things, and neither stands in for the other:

- **Search Records** jumps to one row by its key and never hides rows.
- **Filters** narrows the rows by their fields.

Both are production's today (the key search and the slice's rail). What changes on a phone is how each opens.

## 2 · The Filters button (SL2)

**SL2.** A 44 button, `fa-filter` 14. At rest it is a ghost, `--ink-3`. While any field is set it takes `--brand-tint`, 1 px `--brand-d`, `--brand-dd` ink and the count of active fields (`1`). Its accessible name lists the fields: `Filters: Status: Ready · Due · Job · Quantity · Urgent · Tag · Presets`.

Versus production: the rail folds to its filter icon alone at the toolbar's floor (`FLOOR_RANK`), with no count and no tint.

## 3 · The Filters view (SL3–SL9)

**SL3. Container.** A full-height view inside the builder: below the safe area, sliding in from the right over `--dur-base --ease-out`, with a 1 px `--rule-strong` left edge. A 48 px strip of the grid stays visible under a `--paper-3` veil (60 %); a tap on it closes the view. It is the frame's overlay geometry (`Mobile Builder Frame Spec.md` FR7), never a dialog.

**SL4. Head.** 44 tall:
- a ← back button (44, `fa-arrow-left` 16, `--ink-3`), named `Back to the sheet`;
- `Filters`, DM Sans 16/700;
- `N active` (or `none active`), mono 10.5 `--ink-4`.

Ruled 3 Nov 2026: the head's Done is gone. Two Dones confused; the foot's is the one (SL8), and ← closes the view too.

**SL5. Presets.** The first row, at least 52 tall: `PRESETS` in a 72 px column (mono label caps `--ink-4`), then a chip a preset (34 tall, mono 12/500). An applied preset takes `--brand-tint`, 1 px `--brand-d` and `--brand-dd` ink.

**SL6. Field rows.** One 44 row a field, in the slice's order:
- the field's name, 13/500, in a 72 px column;
- its choice, right-aligned (`Ready`, `Nov 2 – Nov 8`, `Starts with "Cut"`, `100 to 2,400`; `Any` in `--ink-4` when none);
- an `Applied` tag (20 tall, `--paper-3`, mono 9.5 `--ink-3`) while the field is set;
- a chevron, down when closed, up when open.

**SL7. One field open at a time.** A row tap toggles it; its editor opens inline under it on `--paper-2`. Each kind's editor:

| Kind | Example | Editor |
|---|---|---|
| Choice | Status | A 44 row a value: a 14 checkbox, the label 13, the faceted count mono 13/500 `--ink-2` at the end. Several can be on. `Clear Status` link (`--brand-d`). |
| Date range | Due | Preset chips Today · 7d · 30d · 90d · YTD (34 tall). `Start date` with `dd/mm/yyyy` and its field (44), and a time field (84 wide) when Include time is on. `Duration`: a 44 segmented strip 1 day · 1 week · 1 month · Custom. With Custom, `Until, excluded` and its field. The line `Until Mon, Nov 9 (excluded)`, or the error in `--neg-text`. An `Include time` switch. Clear and Apply, 44. |
| Text by prefix | Job | A 44 field, `Type the start of a job`. Once typed, an offer row `All starting with "Cut"` with its count; a tap applies it. `Clear Job`. |
| Number range | Quantity | `From` and `Until, excluded`, two 44 fields side by side, right-aligned mono. Help `From 100 to 2,400 · Until is excluded`, or `Enter valid bounds with From before Until` in `--neg-text` with the fields' borders `--neg`. Clear and Apply. |
| Yes / no | Urgent | Two 44 checkbox rows, Yes and No, each with its count. |
| One of a set | Tag | An eyebrow `Includes one value`, then one 44 radio row a value with its count. |

**SL8. Foot.** Sticky, 1 px `--rule-strong` above: `16,667 of 50,000 rows` mono 11 (the number 600 `--ink`), then Clear all and Done, 44, side by side.

**SL9. Behaviour.**
- **SL9.1** A value or a preset tap applies at once. Date and number ranges wait for Apply.
- **SL9.2** Counts are faceted: a value's count is the rows that have it under the other fields' choices.
- **SL9.3** A choice the record's indexes can't combine with the one in force says so under its label (`Replaces Status: Ready`), and picking it clears the choice it names.
- **SL9.4** A value that needs another field first is disabled: its label `--ink-5`, `Choose Kiln group first.` in `--ink-4` under it, no count.
- **SL9.5** A count still being read shows `…`, never 0; so does the foot's total.
- **SL9.6** The strip, ← and Done close the view; the grid keeps its rows.
- **SL9.7** Every row and button is 44 px or more.

Versus production: today the same contents open in the 380 px `SliceEditPopover` from the filter icon; at 402 px it is nearly full width and the open Due editor makes it 562 px tall. The contents are unchanged; the container, the presets' place (first rather than last), the field rows' value summary and the 44 px rows change.

## 4 · Search Records on a phone (SL10)

**SL10.** The magnifier opens the key search over the toolbar.
- Field row 44: magnifier 14 `--ink-4`, the input (mono 13, `Search Records`), Cancel (12.5/500 `--brand-d`).
- An eyebrow (`Type a reference, such as 10040` until typed; then `Records`, or `No record matches`).
- 44 result rows: the key mono 13/500, its row and name 13 `--ink-3`, a note mono 10.5 `--ink-4`.
- A hint under them: `Jumps to the row.` (ruled 4 Nov 2026: a pick of a row the filters hide clears what hides it.)
- **SL10.1** A tap closes the field, selects the row (unfolding its group) and scrolls it under the header.
- **SL10.2** The design: a record the filters hide reads `hidden by the filters` in `--ink-4` and does nothing on tap. See R2.

## 5 · Empty result (SL11)

**SL11.** A narrowing that leaves no row: a `☐` mark, `No rows match these filters` (DM Sans 18/700), then two hints, `Open Filters and clear a field.` and `Or Clear all to see the 50,000 rows.` Only once a completed read says so (CL13).

## 6 · Rulings (3 Nov 2026)

Every recommendation below is adopted. R2 and R5 were put to the user and ruled so; the rest stand as recommended.

| # | Question | The design | Production / rule | Ruled |
|---|---|---|---|---|
| R1 | Container on a phone | Full-height view, 48 px strip | 380 px anchored popover | The view: it is the frame's overlay pane, never a dialog |
| R2 | A hidden record in Search Records | Disabled, does nothing | The shared hidden pick: the line names the filters that hide it and a pick clears them and goes to the row (every builder) | Keep production's: it is ruled and shared; show the line in the design's 44 row |
| R3 | Date inputs | Plain `dd/mm/yyyy` text fields | The shared React Aria date field (segments, validation) | The shared date field at 44, as `fieldHeights.lg` sizes it |
| R4 | Presets' place | First row | Last section | First, as drawn |
| R5 | Scope | Drawn on the Sheet | One rail for every builder | Every builder's rail at ≤560 px |

## 7 · DX

None. The view is drawn from what `Slice.bindRecords` already declares: its fields, kinds, hints, range and search fields, and presets. Nothing new is asked of an author.
