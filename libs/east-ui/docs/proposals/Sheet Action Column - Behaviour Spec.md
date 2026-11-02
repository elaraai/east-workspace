# Sheet action column: behaviour spec

The interaction contract for `Sheet.column.action`, written so it can be built and tested without reading the prototype's logic. It goes with the visual contract (`Sheet Action Column.dc.html`) and the API (`Sheet Actions - DX Proposal.md`). Values are East tokens; sizes are px at 1×. Each requirement has an id for tests and review. Requirements marked **Not in the prototype** are not demonstrated on the page.

## 0 · Terms

| Term | Meaning |
|---|---|
| Action cell | The cell of an action column: 32 tall, the column's `width` wide (304 in the examples) |
| Case | One case of the field's variant. It is an **action** (its verb, on a control) and a **state** (its word, after a dot, once taken) |
| Kind | How a case is taken: **button** (on click), **choice** (a Menu of its choices) or **form** (a Popover of fields). The kind comes from the payload's type or the author's hint |
| Offer | The cases a row can take now, in order, or the reason it can take none (`blocked`), from the author's `offer` |
| Next half | The control for the offer's first case, at the cell's right end |
| ▾ part | The control that opens a Menu of the rest of the offer |
| Held | A control whose Menu or Popover is open |
| Ring | The grid's selection on one active cell |
| Overlay | The one open Menu or Popover |
| Sets | What taking an action writes beside the field: the row patch and the group patch |
| Action bar | On a phone (§12): the docked strip, holding the selected row's actions |

## 1 · Anatomy and styles

The cell, left to right: **left zone** (the state, then its summary) · **next half** · **▾ part**.

| Id | Part | CSS, exactly |
|---|---|---|
| S1 | Cell | `position: relative; display: flex; align-items: stretch; height: 32px; box-sizing: border-box; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule); background: var(--paper);` Its width is the column's |
| S2 | Text line | Every text in a row (Step, Good, Done, the state word, the summary, control labels) uses `line-height: 16px` and is vertically centred, so baselines meet 20 below the cell's top. Set `line-height` on the row |
| S3 | Left zone | `flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0 8px;` |
| S4 | State | `display: inline-flex; align-items: center; gap: 8px; flex: none; min-width: <slot>; box-sizing: border-box; font: 600 var(--fs-label-md)/16px var(--font-mono); letter-spacing: 0.1em; text-transform: uppercase; white-space: nowrap; color: <tone text>;`. Then the dot: `width: 8px; height: 8px; flex: none; border-radius: var(--r-full); background: <tone base>;` |
| S5 | State slot | `<slot>` is the widest state word among the column's cases plus dot and gap, measured once per column at first render (84 in the examples), so summaries start on one line down the column |
| S6 | Tones | success `--pos` / `--pos-text` · warning `--warn` / `--warn-text` · danger `--neg` / `--neg-text` · info `--info` / `--info-text` · neutral `--ink-4` / `--ink-3` |
| S7 | Summary | `flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 400 var(--fs-body-sm)/16px var(--font-body); color: var(--ink-3);`, with numerals in `var(--font-mono)` at 500 |
| S8 | Absent value | When no case is taken it replaces the state: `font: italic 400 var(--fs-body)/16px var(--font-mono); color: var(--ink-4);`. It reads `not started` when the offer has cases, or the `blocked` reason (`waits for 20`) when it has none |
| S9 | Next half | `flex: none; width: 112px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: flex-start; gap: 8px; padding: 0 8px; margin: 0; border: 0; border-left: 1px solid var(--rule); border-radius: 0; background: transparent; font: 500 var(--fs-body-sm)/16px var(--font-body); color: var(--ink-2); white-space: nowrap; cursor: pointer;`. Content: a 14-wide icon slot (`width: 14px; flex: none; display: inline-flex; justify-content: center;`, kept empty when the case has no icon), then the label, then for a choice kind `fa-angle-down` 14 `--ink-3` |
| S10 | ▾ part | `flex: none; width: 24px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0; border: 0; border-left: 1px solid var(--rule); border-radius: 0; background: transparent; color: var(--ink-3); cursor: pointer;` holding `fa-angle-down` 14. Shown only when the offer has more than one case. On a row offered one case, a column that can offer more keeps its 24 as an empty slot, so the next halves line up down the column; a summary there gives way to it (I2), as it would to the ▾ part |
| S11 | Ring | **Never a `box-shadow` on the cell.** The cell's **last child** is `<span aria-hidden="true">` with `position: absolute; inset: 0; z-index: 1; pointer-events: none; box-shadow: var(--shadow-focus-inset);`, rendered only on the active cell. The next half and the ▾ part set no `position` or `z-index`, so their fills always paint under it |
| S12 | Flush rule | The next half and ▾ part fill the cell's full height inside its rules (31 with the bottom rule) and reach its right rule. They have no radius, no margin, no top, bottom or right border, and no outline; a fill never extends past their own box |
| S13 | Icons | Font Awesome 6 solid only: 14 in a cell, `fa-check` in `--pos`, all others `currentColor`, `aria-hidden`. The disclosure icon is `fa-angle-down` 14 `--ink-3`. Never a mono ▾ or an 8px caret |
| S14 | Label grammar | button kind: [icon] verb · choice kind: verb + `fa-angle-down` · form kind: verb + `…` (U+2026) |

## 2 · States

| Id | Part | Rest | Pointer on it | Selected cell | Dirty cell | Held | Disabled |
|---|---|---|---|---|---|---|---|
| ST1 | Cell | `--paper` | `--paper-2` | `--paper-3` and the ring (S11); unchanged by the pointer | `--brand-tint`; unchanged by the pointer | — | — |
| ST2 | Next half and ▾ part | transparent; `--ink-2`, the ▾ `--ink-3` | `--paper-3` fill and `--ink`, over the cell's `--paper-2` | no fill change; `--ink` | no fill change; `--ink` | `--paper-3` and `--ink` | `--ink-5`, no hover, `cursor: default`, not clickable |
| ST3 | State word and summary | tone text, `--ink-3` | — | unchanged | `--brand-dd`; the dot keeps its tone | — | — |

- **ST4** Selected wins over dirty for the fill (`--paper-3`); dirty text stays `--brand-dd`.
- **ST5** The cursor is the pointer on the next half and the ▾ part, and the default on the left zone.
- **ST6** Dirty cells: the action cell, every cell whose value `sets` changed (Good, Done) and every band cell the group patch changed. The tint clears on Save in batch mode, or when the save lands in auto mode.

## 3 · Pointer

| Id | Gesture | Result |
|---|---|---|
| P1 | Click the left zone, or any other cell | The ring moves there. Nothing is taken |
| P2 | Click a button-kind next half | The ring moves to the cell and the action is taken at once, as one transaction (T1). No overlay opens |
| P3 | Click a choice-kind next half | The ring moves to the cell; its Menu opens (§5); the half is held |
| P4 | Click a form-kind next half | The ring moves to the cell; its Popover opens (§6); the half is held |
| P5 | Click the ▾ part | A Menu of the rest of the offer opens, grouped as M5; the part is held |
| P6 | Click outside an open overlay | The overlay closes and nothing is taken. That click does nothing else. Focus returns as K6 |
| P7 | Any overlay is open | No second one opens; P6 applies first |
| P8 | Rest the pointer on a control for 120 ms | The strip previews that action (§7). On leaving, the strip returns to the ring's cell 120 ms later unless another control takes it |
| P9 | Rest the pointer on a Menu item | As P8, for that item |

## 4 · Keyboard

| Id | Key | Result |
|---|---|---|
| K1 | Tab | The next half and the ▾ part are never tab stops; the ring is the grid's focus (Sheet §6) |
| K2 | ⏎, the ring on an action cell | Takes the offer's first case: a button is taken, a choice opens its Menu, a form opens its Popover. No-op when nothing is offered |
| K3 | In a Menu: ↓ / ↑ | Moves the keyboard focus, wrapping. The first ↓ focuses the first item, the first ↑ the last |
| K4 | In a Menu: ⏎, a digit, Esc | ⏎ runs the focused item; a digit runs the item with that Kbd cap; Esc closes |
| K5 | In a Popover | On open, focus moves into the first field with its contents selected. ⏎ in a field takes the action (F9); Esc closes without taking. Tab moves through the fields, then Cancel, the verb and ×. In a number field ↑ / ↓ step by 1, or 10 with ⇧ |
| K6 | Any overlay closes | Focus returns to the control that opened it, or to its cell when the action removed that control |
| K7 | ⌘Z / Ctrl+Z · ⇧⌘Z / Ctrl+⇧Z / ⌘Y | Undo / redo one transaction, from anywhere in the sheet except inside a text field, which keeps its own undo |

## 5 · Menu

| Id | Specification |
|---|---|
| M1 | Chrome: the Menu card. 240 wide · `--paper` · 1px `--rule-strong` · `--r-md` · no shadow |
| M2 | Groups pad 4 0, split by 1px `--rule`. Group header: 24 tall, pad 0 12 4, text at the bottom, mono 9.5/600 at 0.14em, uppercase `--ink-4`, ellipsis |
| M3 | Item: 32 tall, pad 0 12, gap 8. A 16 icon slot (icon 14 `--ink-3`, `fa-check` `--pos`), the label in Inter Tight 12.5 `--ink`, and at the end, 24 clear of the label, the Kbd cap: 20 tall, min 20 wide, pad 0 4, `--paper-2`, 1px `--rule-strong`, `--r-sm`, mono 11/500 `--ink-2` |
| M4 | Item states: pointer `--paper-2` · keyboard focus `--paper-2` + `--shadow-focus-inset` · disabled `--ink-5`, its reason in the Kbd slot (mono 10.5 `--ink-4`), not runnable |
| M5 | Contents: group 1 is titled `Step {op} · {step}` and holds the direct actions (button and form kinds) in offer order, labelled by S14 and numbered 1…n. Then one group per choice action, titled `{verb} · reason`, holding its choices in their words: those `labels` names first, in that order, then the rest spelled out |
| M6 | Placement: top = the control's bottom + 4, its right edge on the control's right edge, clamped to the sheet's left edge. If it would pass the sheet's bottom, it flips above: its bottom = the control's top − 4 |
| M7 | It opens and closes at once, with no fade, slide or scale |
| M8 | Running an item closes the menu. A choice or a button-kind action is then taken (T1); a form-kind action opens its Popover, anchored to the control that opened the menu |

## 6 · Popover form

| Id | Specification |
|---|---|
| F1 | Chrome: the Popover card at md. 320 wide · `--paper` · 1px `--rule-strong` · `--r-md` · no shadow |
| F2 | Arrow: 12 wide, 6 deep, with a 1px `--rule-strong` edge. Its tip sits 4 from the control, on the control's centre, and at least 12 from the popover's corners |
| F3 | Placement: top = the control's bottom + 10; left = the control's centre − 24, clamped to [0, sheet width − 320]. If it would pass the sheet's bottom by more than 40, it flips above: its bottom = the control's top − 10, with the arrow on the bottom edge pointing down, filled `--paper-2` to match the foot |
| F4 | Head: pad 8 12, 1px `--rule` below. The eyebrow `{verb} · step {op}` in mono 10/600 at 0.14em, uppercase `--ink`. The meta `{group id} · {step}` in mono 9.5 `--ink-4`, with ellipsis. × is a ghost icon button, sm 24: `fa-xmark` 14 `--ink-3`, `--paper-3` + `--ink` on hover, aria-label `Close` |
| F5 | Body: pad 12, fields 12 apart. A field stacks 4 apart: the label (Inter Tight 12.5/600 `--ink`), its schema key under it (mono 11 `--ink-4`), the input, then the help (mono 10.5 `--ink-4`: range · unit · default) |
| F6 | Editors, from `Fields`. **Text**: a 32 box, pad 0 12, 1px `--rule-strong`, `--r-md`, Inter Tight 13. **Number**: a 120 × 32 box, the value right-aligned in mono 13/500, a 20-wide stepper column inside its right edge (`fa-angle-up` and `fa-angle-down` 14, split by 1px `--rule`), and the unit outside it in mono 10.5/500 `--ink-4`, 4 apart. **Variant of up to four empty cases**: a radio group, options 16 apart, each a 14 circle (1px `--rule-strong`; checked: 1px `--brand-d` with a 6 `--brand-d` dot) and its label in Inter Tight 13. **More than four**: a Select. **DateTime**: the common date field, dd / mm / yyyy segments, the armed one `--brand-tint` with `--brand-dd` text |
| F7 | The focused input shows `--shadow-focus`, outside its edge |
| F8 | Foot: pad 8 12, `--paper-2`, 1px `--rule` above. First the consequence, one line of mono 10.5 `--ink-3` with ellipsis, recomputed as the values change (`Sets WO-1042 On hold` · `WO-1042 stays In progress` · `Sets Good 12`). Then Cancel and the verb, both Default sm 24, never a Primary |
| F9 | Take: if a required field is empty, the popover stays open and focus goes to that field. The error replaces its help in `--neg-text`, its border turns 1px `--neg`, and nothing is drafted; the error clears as the field changes. Otherwise the action is taken (T1) and the popover closes |
| F10 | Initial values come from the case's `initial`; if the row already holds this case, from its current payload; otherwise the field is empty, or the type's zero |
| F11 | Stepper: a click moves ±1, ⇧-click ±10, clamped to the bounds. At a bound its icon is `--ink-5` |

## 7 · Strip

| Id | Specification |
|---|---|
| R1 | Docked under the grid: 32 tall, `--paper-2`, pad 0 16. The label in mono 10/600 at 0.14em, uppercase `--brand-d`; the text in Inter Tight 12.5 `--ink-2`, with ellipsis; the keys hint at the end in mono 10.5 `--ink-4` |
| R2 | First priority, a control or Menu item under the pointer (P8): `{verb} · step {op}` with a preview. A button: `Sets {facts}`, or `Sets nothing beside the action`. A choice: `Pick a reason · sets {facts}`, or `{group} stays {status}`. A form: `Opens its form · {what its values may set}` |
| R3 | Second, the ring on an action cell: `Action · step {op}`, then, joined ` · `, the state and summary and one of `offers {verbs}`, `waits for step {op} to complete`, `owned upstream, read only` or `nothing further to take`. The keys hint is `⏎ takes the next` |
| R4 | Third, the ring on another cell: its column, its value and what writes it |
| R5 | Facts are `{field label} {new value}` for each field a dry run of `sets` changes, row fields in patch order, then the group's, joined ` · `, for example `Good 24 · Done 14:02 · WO-1042 On hold` |
| R6 | The preview runs `sets` dry over the current draft, at `at` = now, and drafts nothing |

## 8 · Transactions

| Id | Specification |
|---|---|
| T1 | Taking an action is one transaction, origin `action`: the field's new value, the row patch from `sets` and its group patch. Undo and redo restore all three together |
| T2 | After taking, the ring sits on the action cell, which redraws at once with the new state and offer. Rows whose offer depends on it update in the same frame (step 30 offers Start once 20 completes) |
| T3 | The toolbar message is `aria-live="polite"`: `{state} step {op} · set {facts}` · `Undid one action and everything it set` · `Redid one action and everything it set` · `Saved {n} changes` |
| T4 | `applyMode="batch"`: changes stay dirty until Save. Save is Default sm 24 with a count chip (the dirty cells), and is disabled at 0 |
| T5 | `applyMode="auto"`: each action is sent as it is taken. The action cell's state dot runs the live pulse (N2) until the save is acknowledged; the toolbar shows a `Saving` Status with a live `--brand` dot, then `Saved` with a `--pos` dot, and the tint clears. A failed save raises the Sheet's banner, never a toast. **Not in the prototype**: failure |
| T6 | On a row whose draft is incomplete, the controls are disabled (ST2) and the strip says what is missing (`Fill Plan before starting`). **Not in the prototype** |
| T7 | ⌫, paste and fill never change an action cell, as with a stamped cell. A way back is an action the author declares |
| T8 | A range over action cells offers what every selected row offers. Taking it is one transaction across them; a form asks once. **Not in the prototype** |
| T9 | Owned rows, `readOnly` and `editable: false` show the state alone, with no next half and no ▾ part |

## 9 · Motion

| Id | Specification |
|---|---|
| N1 | Changes of fill and ink take `--dur-fast` (120 ms), `--ease-out`, with no lift, scale or shadow |
| N2 | Live pulse while an auto save is in flight: an echo of the 8px dot, in its colour, scales 1 → 2.5 and fades 0.6 → 0 over the first 25% of a `calc(var(--dur-slow) * 4)` cycle, `--ease-out`, infinite. The dot itself never moves. Under `prefers-reduced-motion` the echo is off |
| N3 | Overlays appear and disappear at once (M7) |
| N4 | A change of state redraws at once, with no fade-in of the new state or controls |
| N5 | The preview has a 120 ms dwell and a 120 ms leave grace (P8) |

## 10 · Fit

| Id | Specification |
|---|---|
| I1 | The next half is the offer's first case; every other offered case is in the ▾ Menu (M5) |
| I2 | When the column is too narrow for the state slot, 16 and the 136 of the half and the ▾ part, the summary gives way first, then the state word ellipsises. The half and the ▾ part never shrink |

## 11 · Accessibility

| Id | Specification |
|---|---|
| A1 | An action cell is a `gridcell` |
| A2 | The next half is a `button` named by its verb. The ▾ part is a `button` named `More actions`, with `aria-haspopup="menu"` and `aria-expanded` |
| A3 | A Menu has `role="menu"` and its items `role="menuitem"`. A Popover has `role="dialog"`, labelled by its eyebrow. A radio group has `role="radiogroup"`, each option `role="radio"` with `aria-checked`. Every input is labelled by its field |
| A4 | Icons are `aria-hidden`; their meaning is in the control's name |

## 12 · Phone and touch

Applies on a coarse pointer, and at a frame width of 560 or less.

| Id | Specification |
|---|---|
| X1 | On a coarse pointer, rows take the touch size, 44 tall, with cells padded 0 12. Every target is at least 44 × 44: controls, Menu items, Popover inputs and buttons. The toolbar band is 56: Undo and Redo are 44 squares (icon 16), Save is 44 tall |
| X2 | Hardware keyboards keep §4 |
| X3 | Touch has no hover, so P8 and P9 do not apply. The first offered action's consequence shows in the action bar as soon as its row is selected |
| X4 | At 560 or less the cell shows the state alone: the left zone with no next half and no ▾ part. The column is 112 wide there and the row's last, so its own place is the frame's right edge; it stays there as the other columns scroll sideways, over them and their rings, a `--rule-strong` rule on its left. The summary is not drawn |
| X5 | A tap on any cell of a row selects that cell (P1), and the docked strip becomes that row's **action bar**: `--paper-2`, 1px `--rule-strong` above, pad 12, gap 8. In order: the eyebrow `Step {op} · {step}` with the state at its end; the buttons (X6); the first action's consequence in mono 10.5 `--ink-3`. With no row selected, it is the 44 strip |
| X6 | Buttons: Default, 44 tall, content centred, icon 16 then the label with its grammar (S14). The first offered action takes the full width; the rest share one line below, up to three of equal width, 8 apart. With more than four offered, that line shows two and a third, `More…` (`fa-ellipsis`), which lists the rest inside the bar (X7). A case with no `icon` shows its label alone, centred, with no empty slot |
| X7 | A choice or form opens **inside the bar**, never floating. The bar's head becomes 44: ← back (a 44 target, `fa-arrow-left` 16, back to the buttons), the eyebrow `{verb} · step {op}` and the group id. A choice lists its items as 44 rows. A form shows its fields at 44, the consequence, then Cancel and the verb as two 44 halves. The bar grows to at most 60% of the frame, the grid keeps the selected row in view above it, and the on-screen keyboard pushes the bar up |
| X8 | Taking an action returns the bar to the row's new offer. Undo in the toolbar works as T1 |
| X9 | Taps only: no swipe-to-act and no long-press. A swipe scrolls the rows; a double-tap does what a tap does |
| X10 | Safe areas: the bar adds `env(safe-area-inset-bottom)` to its bottom padding; the toolbar adds `env(safe-area-inset-top)` when the sheet runs full screen |
| X11 | Landscape, or wider than 560 on a coarse pointer: §1–§10 with X1's touch sizes, and no action bar |
| X12 | `applyMode="auto"` is the advised mode on phones: a tap saves, and the toolbar's Saving and Saved Status (T5) is the only confirmation |
| X13 | A choice or form never opens a Dialog, a Drawer or a full-screen page, at any width |
