# Query Editor Spec — the visual query editor, written out

The anatomy, values, copy, behaviour and checking rules of the visual query editor, transcribed from
[`Query Editor Spec.html`](Query%20Editor%20Spec.html) so an implementation can be reviewed against text,
and joined with the design brief the mock was made from ("Visual query editor and Elara", §1). The HTML
is the ground truth for everything it shows: where this document and the mock disagree, the mock wins and
this document is the bug. Where the brief and the mock disagree, §19 says which one the product follows.

**What the design decides, and what it doesn't.** The brief and the mock were made by a designer. They
decide what the editor does, how it looks, what it says and how it behaves; they do not decide how it is
built. The prototype's mechanics — its keyed request props, its HTML5 drag with a custom MIME type, its
browser storage, its hand-drawn table and tree, its inline styles — are how a prototype stands up, not
east-ui's practice. The product is built the east-ui way (§18): an IR component and a renderer, data and
behaviour props, bound data sources, slot recipes on semantic tokens, and the production components and
layers for everything they already do. Where that changes something a user can see, §19 lists it.

**Scope.** The editor queries only the **bound data sources** it is given, and datasets can be dragged into
it from a **Library of those bindings** (§13). The brief's integration with the Elara chat is not part of
#875; the mock's parts for it are accounted for in §14 so nothing in the mock is unexplained.

The query language is #875's typed jq over East values. The design, the server and the phases are in issue
#875, and each part here names the child that builds it.

Conventions used below:

- Every colour, radius, shadow, duration and easing is a token from `libs/east-ui/app_design_system/tokens/`
  (`--ink`, `--paper-2`, `--rule-strong`, `--brand-d`, `--brand-tint`, `--shadow-md`, `--shadow-focus`,
  `--dur-base`, `--ease-out`, …). A value written in px is the mock's literal value. Valence colours are
  `--pos`, `--neg`, `--warn` and `--info`.
- **Label** means the design system's mono label: `--font-mono`, weight 600, uppercase, `--ink-4`. Its size
  and letter-spacing are given per use (9.5–10.5px, 0.1em–0.16em).
- **Numerals** are `--font-mono` with `font-feature-settings: "tnum" 1` (tabular).
- **Icon button N** means an N×N button with no border and a transparent fill. On hover it takes
  `--paper-3` with `--ink`.
- Font Awesome 6 icons are `fa-solid`.
- A box's height is its content height; a 1px rule on it is extra (the control rail's box is 48 + 1).
- "The step model" is east core's canonical steps — steps printed to and parsed from canonical jq, their
  shapes and their diagnostics (#933) — with the editor's plain words, cards and slots on top (#934);
  "the checker" is #875's `checkJq` (#921).

## Contents

1. Principles and vocabulary
2. Frame and anatomy
3. Control rail
4. Steps column
5. The step catalogue
6. Autocomplete
7. Checking and problems
8. Canonical jq: printing and parsing steps
9. The jq view
10. Results
11. Running, shapes and staleness
12. Saving, recent queries and copy
13. Bound data sources and dragging a dataset in
14. Not in #875: the mock's Elara parts
15. The mock's data
16. Keyboard
17. Copy
18. From the design to east-ui
19. Deviations from the mock and the brief
20. Open questions

---

## 1. Principles and vocabulary

From the brief (`SPEC.md`, "Visual query editor and Elara"), the principles that hold for the editor:

- **One program, two views.** The saved artefact is the jq program. Visual steps are a projection of it:
  canonical forms become steps, anything else stays a jq step and is still checked.
- **Checking is free, running costs.** Every edit is checked locally and at once. Data is read only on Run
  (⌘⏎), or when a saved query is opened. (Dataset summaries for autocomplete are the one small read, §6.4.)
- **Plain words first.** Visual mode shows no jq vocabulary. Shapes and problems are written in plain words;
  the East type and the jq message are one step away, on hover or in the jq view.

The brief's other two principles ("the editor is where a query is decided", "context is visible") are about
the Elara chat (§14).

| Term | Meaning |
|---|---|
| Query | A jq program over the editor's root, checked into a `QueryType` by the SDK checker |
| Bound data source | A dataset handed to the editor as a binding: `Data.bind`, `Data.bindPaged` or `Record.bind` |
| Root | The Struct of the editor's bound data sources, by the names the page gives them (`.orders`, `.customers`) |
| Library | A palette of the bound data sources, whose cards drag into the editor (§13) |
| Step | One stage of the pipeline, shown as a card: Keep rows where, Look up, Group and total, Sort, Keep the first, Count, Show only fields, Fill in missing, Open each list, Take part of a date, List every part, Try the model over a range, or a jq step |
| Slot | A button inside a step that holds a field, comparison, value or option, and opens autocomplete |
| Shape | The type the checker infers between steps, in plain words: "Many shipped orders", "One number" |
| Result | The output of a run, shown as a Table or a Value tree |
| Stale | A result whose program no longer matches the editor |

---

## 2. Frame and anatomy

| Property | Value |
|---|---|
| Box | `position: relative`, width 100%, column flex, `box-sizing: border-box`, `overflow: hidden` |
| Height | `100vh` in the mock (`100%` with the `fill` prop), min-height `min(560px, 100vh)`. In product, the east-ui sizing contract (#320) applies, default `height="fill"` |
| Border / radius / fill | 1px `--rule-strong` · 10px · `--paper` |
| Text | `--ink`, `--font-body` |
| Theme | `data-theme="light" \| "dark"` on the frame when the host forces one |
| Loading | Until the checker module loads: "LOADING THE CHECKER" centred, label 10.5px 0.14em |
| Layers (z-index) | results table header 2 · jq completion popover 5 · drop target 20 · results download menu scrim 20, panel 21 · save and autocomplete scrims 30, panels 31 |

**Regions**, top to bottom:

| Region | Size | Contents |
|---|---|---|
| Control rail (§3) | 48px, a 1px `--rule` below | No title. Collapse toggle, Visual \| jq on the left; Saved ▾, Copy jq, Save and Run ⌘⏎ on the right. Run is the only primary button |
| Body | the rest | A grid `{left} minmax(0, 1fr)`, one row `minmax(0, 1fr)`. `grid-template-columns` transitions over `--dur-base` `--ease-out` |
| — steps column (§4) | `min(480px, 52%)`; `min(640px, 52%)` in jq; 44px collapsed | Visual: source card, steps and shape lines, then the bottom bar. jq: the jq view (§9). A 1px `--rule` on its right, `--paper-2` fill |
| — results (§10) | the remaining width | Its own rail, bars, Table or Value tree, footer |
| Status line (§7.1) | 32px, a 1px `--rule` above, `--paper-2` | Check state, the final shape and its fields; the save state and the query name |

---

## 3. Control rail

`role="toolbar"`, `aria-label="Query controls"`. Row, `align-items: center`, gap 10, height 48, padding
`0 12 0 8`, a 1px `--rule` bottom border, no shrink. In order:

1. **Collapse toggle.** Icon button 28, radius 6, `--ink-4`, 11px icon: `fa-angles-left`, or
   `fa-angles-right` while collapsed. `title` and `aria-label`: "Hide steps" / "Show steps" in visual mode,
   "Hide jq" / "Show jq" in jq mode. `aria-expanded` = the column is open. Toggling closes any popover.
2. **Mode switch.** `role="group"`, `aria-label="Editor mode"`. Height 30, 1px `--rule-strong` border,
   radius 6, `overflow: hidden`. Two buttons, each padding `0 12`, gap 6, label 10.5px at 0.12em with a 10px
   icon; the first has a 1px `--rule-strong` right border:
   - **Visual** (`fa-diagram-project`) and **jq** (`fa-code`);
   - the active one is `--brand-tint` with `--brand-dd` text, the other `--paper` with `--ink-3`;
     `aria-pressed` on each.
   Switching mode expands a collapsed column.
3. **Spacer.** Flex 1, min-width 8.
4. **Saved ▾.** Height 32, padding `0 12`, gap 8, 1px `--rule-strong` border, radius 6, `--paper`, body
   12.5px/500, no wrap: a 12px `fa-clock-rotate-left` in `--ink-3`, "Saved", then "▾" (mono 9px `--ink-4`).
   Hover darkens the border to `--ink-3`. Opens the queries popover (§12.2).
5. **Copy jq.** Icon button 32, radius 6, 13px icon: `fa-copy` in `--ink-3`, or for 1 600 ms after a copy
   `fa-check` in `--pos`. `title` / `aria-label` "Copy jq", then "Copied" (§12.4).
6. **Save.** Height 32, padding `0 12`, radius 6, body 12.5px/500. While its popover is open it is
   `--brand-tint` / `--brand-dd` with a `--brand-d` border; otherwise `--paper`, `--ink`, `--rule-strong`.
   Hover darkens the border to `--ink-3`. Opens the save popover (§12.1). Hidden when the editor has no
   `saved` record (§12.2).
7. **Run.** Height 32, padding `0 12`, gap 8, radius 6, 1px `--brand-d` border and fill, `--paper` text,
   body 12.5px/600, no wrap: a 10px icon (`fa-play`, or `fa-circle-notch fa-spin` while running), "Run" /
   "Running", then "⌘⏎" in mono 10px/500 at `color-mix(in oklch, var(--paper) 80%, var(--brand-d))`. Hover:
   `--brand-dd` fill and border. `title` "Run · ⌘⏎" / "Running…" (§19).

The mock also has an Ask Elara button here, shown only with a chat (§14).

---

## 4. Steps column

### 4.1 Layout

A column, `min-height: 0`, `overflow: hidden`, `--paper-2`, 1px `--rule` right border. From top to bottom:
the visual note bar (§4.9), the steps scroller, and the bottom bar (§4.10). In jq mode the jq note bar
(§9.1) and the jq view replace them.

**Steps scroller.** Flex 1, `overflow: auto`, padding `16 16 28`. It holds the source card, a shape line,
then each step followed by its shape line.

### 4.2 Source card

Row, gap 12, padding `10 12`, `--paper`, 1px `--rule-strong`, radius 8:

- a 28×28 tile, radius 6, `--paper-3`, `--ink-3`, holding a 12px `fa-database`;
- a column (gap 3, min-width 0): "Start with {source}" (13px/600 `--ink`), then
  "{workspace}.{source} · {description}" (12px `--ink-3`, ellipsis). The mock shows `dev.orders · Orders
  with lines and status`. Product: the description is the source's plain kind ("list of orders"), since a
  binding carries no prose.

### 4.3 Shape lines

After the source card and after every step. Row, `align-items: stretch`, gap 10, min-height 30,
padding-left 25:

- a 1px `--rule-strong` spine;
- the shape text, mono 11px/500, line-height 1.2, tabular, no wrap: **main**, then **extra** in `--ink-4`
  with an ellipsis (gap 8). `title` = the East type of the shape (`Array<Order>`);
  - colour `--ink-2` when the line counts rows (after a fresh run, §11.2), else `--ink-3`; the source line is
    always `--ink-2` (it counts the source when the source is an array);
  - main: "{n} {adj} {noun}" when counted ("16 shipped orders"), otherwise the plain shape (§7.3);
  - extra, only where the East type changed: after Look up and Take part of a date, "+ {added fields}"
    ("+ name, region"); after any other step, all the fields after it;
- **Insert**: height 22, padding `0 7`, gap 5, 1px dashed `--rule-strong`, radius 4, transparent, `--ink-4`,
  body 11px/500, an 8px `fa-plus`, "Insert". Hover: border `--ink-3`, text `--ink`, fill `--paper`.
  `title` / `aria-label` "Insert a step here". Opens the add-step popover for that position (§6.3). It is
  also a drop point for a lookup-table dataset (§13.3).

### 4.4 Step card

`--paper`, radius 8, a 1px border: solid `--rule-strong` for a complete step, **dashed** `--rule-strong` for
an unfinished one. `data-step` = the step id.

**Head row.** Wrapping row, gap 8, min-height 40, padding `6 6 6 12`:

1. the number, "01", "02", … (mono 10.5px/600 `--ink-4`, tabular, width 18);
2. the step's icon (width 14, 12px, `--ink-3`, centred; §5);
3. the title (13px/600 `--ink`; §5);
4. the head parts, for Keep rows where with more than one condition: an `all` / `any` slot then "of these
   are true" / "of these is true" (12.5px `--ink-3`); head slots are 26 high;
5. a spacer, then the **controls**: a row, gap 2, at opacity 0.6 until the pointer is over them (then 1):
   - move up, move down: icon button 26, radius 4, `--ink-3`, 10px `fa-arrow-up` / `fa-arrow-down`;
     `aria-label` "Move step up" / "Move step down", `title` "Move up" / "Move down"; opacity 0.3 at the
     first / last step;
   - remove: icon button 26, radius 4, 12px `fa-xmark`, `aria-label` and `title` "Remove step"; closes any
     popover.

**Body.** Column, gap 6, padding `0 12 12 44`: its lines (§4.5–4.8), and for an unfinished step the note
"Not in the query until it's finished." (11.5px `--ink-4`).

### 4.5 Rows and their parts

A **row** is a wrapping row, gap 6, min-height 28, of parts:

| Part | Look | Behaviour |
|---|---|---|
| Word | 12.5px `--ink-3`, no wrap. On Keep rows where rows the first word is the joiner column: min-width **30** (empty on the first condition, then `and` / `or`), so conditions line up | — |
| Slot | Height 28 (26 in a head), max-width 200 (180 inside a group), padding `0 8`, gap 6, radius 6, then "▾" (mono 9px `--ink-4`). Filled: 1px solid `--rule-strong`, `--paper`, `--ink`, weight 500. Empty: **dashed**, the placeholder word in `--ink-4`, weight 400. With a problem: `--neg` border. Open: `--brand-tint` fill, `--brand-dd` text, `--brand-d` border. Numbers, IDs and dates are mono 12px; words 12.5px body. Label ellipsis. Hover border `--ink-3` | Opens autocomplete (§6); clicking an open slot closes it |
| Input | Height 28, width per use (below), padding `0 8`, `border-box`, 1px `--rule-strong` (`--neg` on a problem), radius 6, `--paper`, `--ink`, mono 12px/500, tabular. Focus: `--brand-d` border and `--shadow-focus` | Names ("as revenue") and counts ("first 10") are inputs, not slots. Typing keeps the raw draft until blur and applies each change (§6.6) |
| Chip | Height 24, padding `0 2 0 8`, gap 2, radius 4, `--brand-tint`, `--brand-dd`, 12px/500, then × (20×20, mono 12px, `aria-label="Remove"`) | Removes that field |
| Add | Height 26, padding `0 9`, gap 6, 1px dashed `--rule-strong`, radius 6, transparent, `--ink-3`, body 12px/500, a 9px `fa-plus`. Hover border `--ink-3`, text `--ink` | Opens a slot, or adds a part and opens its first slot |
| Ghost add (feet) | Height 24, padding `0 4`, gap 6, radius 4, no border, `--brand-d`, body 12px/600, 9px `fa-plus`. Hover `--paper-3` fill, `--brand-dd` | As Add |
| Remove | Icon button 24, radius 4, "×" mono 14px `--ink-4`; `aria-label` / `title` "Remove" or "Remove group" | Removes the condition, total, field or group |

Input widths: count 56; totals' and fields' names 96; fill value 72; date-part name 104; range numbers 56;
result name 96.

**Problem lines** follow the row they belong to: a wrapping row, gap 8, padding `0 0 4 36`, 12px/1.4 in
`--neg` (error) or `--warn` (warning): an 11px `fa-circle-exclamation` / `fa-triangle-exclamation`, the
plain-words message (flex `1 1 180px`, 160 inside a group), then the fixes: height 24, padding `0 8`, 1px
`--rule-strong`, radius 6, `--paper`, `--brand-d`, body 11.5px/600, no wrap; hover border `--brand-d`.
"Unfinished" warnings are not listed (the dashed card says it).

### 4.6 Groups

A nested condition group is a row, gap 6: the joiner column (width 30, padding-top 15, 12.5px `--ink-3`),
then a box (flex 1, column, gap 6, padding `8 6 8 10`, 1px `--rule`, radius 6, `--paper-2`) holding:

- a head row: the group's `all` / `any` slot and "of these are true" / "of these is true", a spacer, and
  the remove × ("Remove group");
- its condition rows (joiner column 30, slots max 180) with their problem lines;
- an add link (padding-left 30): a ghost add, "Add condition".

"Add group" adds a group of the opposite match (`any` inside an `all` step, and vice versa) with two empty
conditions, and opens the first one's field.

### 4.7 Feet, notes and code

- **Foot**: a wrapping row, gap 12, min-height 26, padding-left 32, of ghost adds ("Add condition",
  "Add group"; "Add a total"; "Add field"), followed by the problem lines that belong to no condition.
- **Note**: padding-left 36, 12px `--ink-4` ("Left empty when a customer isn't found.").
- **Code** (jq steps): a `pre`, padding `8 10`, radius 6, `--paper-3`, mono 12px/1.5 `--ink-2`,
  `white-space: pre-wrap`.

### 4.8 Empty

With no steps, under the source line: "Add a step to narrow, reshape or total the rows, or start from a
saved query." (12.5px/1.5 `--ink-3`, margin `4 4 0`).

### 4.9 Visual note bar

Info-tinted: row, gap 8, padding `8 10 8 16`, 1px `--rule` below,
`color-mix(in oklch, var(--info) 6%, transparent)`, 12.5px `--ink-2`: a 12px `fa-circle-info` in `--info`,
the note (flex 1), **Undo** when there is something to undo (height 24, padding `0 8`, radius 4,
transparent, `--brand-d` body 12px/600; hover `--paper-3` / `--brand-dd`), and dismiss (icon button 24,
"×" mono 13px `--ink-4`, `aria-label="Dismiss"`). Dismissing also drops the undo. The notes are in §17.2.

### 4.10 Bottom bar

Column, gap 8, padding `10 16 12`, 1px `--rule` above, `--paper-2`:

- **Add a step at the end**: full width, height 36, 1px dashed `--rule-strong`, radius 8, transparent,
  `--ink-3`, body 12.5px/500, a 10px `fa-plus`. Hover: border `--ink-3`, text `--ink`, fill `--paper`. Also
  a drop point for a lookup-table dataset (§13.3).
- **Quick add**: a wrapping row, gap 6: the label "QUICK ADD" (9.5px, 0.14em), then one button per quick
  step: height 26, padding `0 8`, gap 6, 1px `--rule-strong`, radius 4, `--paper`, `--ink`, body 12px/500, a
  10px icon in `--ink-3`; hover border `--ink-3`. A step that doesn't fit the shape at the end is disabled at
  opacity 0.45 with its reason as the `title`; otherwise the title is its hint (§6.3). The buttons are
  Keep rows, Group and total, Sort by, Keep the first, Show only fields (in that order), plus List every
  part in the tree and Try the model over a range when they fit. Clicking adds the step at the end, scrolls
  it into view (40px margin) and opens its first empty slot.

### 4.11 Collapsed rail

The whole 44px column is one button (`title` / `aria-label` "Show steps" / "Show jq"): column, gap 12,
padding `14 0`, transparent, hover `--paper-3`:

- a 30×30 tile, radius 4, `--paper-3`, `--ink-3`, 12px `fa-diagram-project` (or `fa-code` in jq);
- in visual mode, the step count: height 18, padding `0 5`, 1px border, radius 4, mono 10px/600, tabular;
  `--neg` border and text when the query has problems, else `--rule-strong` / `--ink-3`;
- "STEPS" or "JQ" set `writing-mode: vertical-rl`, label 10.5px 0.14em in `--ink-2`.

Clicking anywhere expands the column. Switching mode expands it too.

---

## 5. The step catalogue

Every step has a title, an icon, its rows, defaults when added, the canonical jq it prints (§8.1) and the
checks it makes (§7). Values in quotes are copy.

| Step | Title · icon | Rows | Defaults when added |
|---|---|---|---|
| Keep rows where | "Keep rows where" · `fa-filter` | Head (2+ conditions): `all\|any` "of these are true / is true". One row per condition: joiner, **field**, **compare**, **value** (or the inner condition, below), ×. Foot: Add condition, Add group | `all`, one empty condition |
| Look up | "Look up from another dataset" · `fa-arrow-right-arrow-left` | "find" **key** "in" **dataset**; "bring in" field chips + Add field; note "Left empty when a {singular} isn't found." | the first bound lookup table (the mock: `customers`), the key = the first field of its key type whose name contains its noun (`customer_id`), else the first of that type; fields `[the first value field]` (the mock: `region`) |
| Group and total | "Group and total" · `fa-layer-group` | "by" **field** (or "all rows together"); per total: "then" / "and" **total** **field** (not for count) "as" *name*, ×; foot Add a total | by empty, `[count as count]` |
| Sort | "Sort" · `fa-arrow-down-wide-short` | "by" **field** **order** | field empty, descending |
| Keep the first | "Keep the first" · `fa-list-ol` | *n* then the plural noun ("10 orders") | 10 |
| Count the rows | "Count the rows" · `fa-hashtag` | "gives one whole number" | — |
| Show only fields | card title "Show only these fields" · `fa-table-columns` | per field: **field** "as" *name*, ×; foot Add field | the first three non-list, non-payload fields, each named as itself |
| Fill in missing values | "Fill in missing values" · `fa-fill-drip` | "where" **field** "is missing, use" *value* | the first optional field; 0 for a number, else empty |
| Open each list | "Open each {noun}'s list" · `fa-arrow-turn-down` | "open" **list** "one row per {item}[, keeping the {noun} ID]" | the first list field |
| Take part of a date | "Take part of a date" · `fa-calendar-day` | "take the" **part** "of" **date** "as" *name* | the first date field, `month`, named "{case stem}_month" (`status.shipped.date` → `ship_month`) or "month" |
| List every part in the tree | "List every part in the tree" · `fa-sitemap` | "every level, keeping {scalar fields}" | — |
| Try the model over a range | "Try the model over a range" · `fa-chart-line` | "{input} from" *a* "to" *b* "every" *step*; one slot per other input ("region" **NSW**); "call the result" *name* | the first Float input (`price`), 10 to 12 every 0.5, the others empty (the mock: region NSW), named `demand` |
| jq step | "jq step" · `fa-code` | the jq text as code | — |

**Inner conditions** ("has any where"): after the list field and the comparison, the row continues with
**field in each item**, **compare** and **value** over the list's element (the mock: `lines` → `sku is
BRK-100`).

**Comparisons by field kind** (the compare slot offers only these):

| Kind | Comparisons |
|---|---|
| text | is, is not, contains, starts with |
| whole number, number | is, is not, is at least, is at most, is more than, is less than |
| date | is in year, is in month, is on or after, is before |
| one of (a case) | is, is not |
| yes or no | is yes, is no |
| list | has at least, has any where |
| an optional field, any kind (not a case's payload field) | the above plus is missing, has a value |

Picking a field sets a default comparison: date → is in year; list → has at least (value 1); yes or no →
is yes; numbers → is at least; else is. Changing the field keeps the comparison and value when the new field
has the same kind.

**Variant fields.** A variant field appears twice in the field list: its **case** ("status", compared with
is / is not against the case names) and each struct case's payload fields ("shipped date", "cancelled
reason"), grouped "Inside status" and marked "shipped orders only" until the rows are narrowed to that case.
Narrowing: under `all`, a condition `status is shipped` narrows the rows, so later conditions and steps can
read "shipped date", and the shape reads "Many shipped orders".

---

## 6. Autocomplete

### 6.1 Popover

A scrim (`inset: 0`, z 30; mousedown closes), then the panel (z 31): width 320, `--paper`, 1px
`--rule-strong`, radius 6, `--shadow-md`, `overflow: hidden`, column:

- **Placement.** Left-aligned with the slot, clamped to `[8, frame width − 328]`; 4px below it, or 4px
  above it when fewer than 280px remain below and more space is above. Positions are scale-aware (the frame's
  `getBoundingClientRect().width / offsetWidth`).
- **Header**: row, gap 10, height 40, padding `0 12`, 1px `--rule` below: the label (9.5px, 0.14em, no
  wrap; the slot's name, §17.3) and a text input (flex 1, height 30, no border or outline, body 13px/400
  `--ink`; `aria-label` = the label; placeholder per slot, §17.3). It takes focus when the popover opens.
- **List**: max-height 300, `overflow: auto`, padding 4. Group heads: padding `8 8 4`, label 9.5px 0.14em.
  Items: min-height 34, padding `5 8`, gap 10, radius 4; the active item `--brand-tint`; mousedown picks,
  mouseenter makes active; a disabled item is at opacity 0.55, `cursor: default`, never active:
  - an icon (width 14, 12px, `--ink-3`), for steps and queries;
  - a column (gap 3): the label (13px/1.25 `--ink`, ellipsis; weight 600 for a typed value, else 500; mono
    when it is numeric — `^[\d.,\-–\s]+$` — or looks like an ID — `^[A-Z]{2,}-?\d` — else body) and the
    sub-line (11.5px/1.3, ellipsis): `{detail} · {note}`, the note in `--warn` on an enabled item, or the
    reason alone on a disabled one, in `--ink-3`;
  - the meta, right: mono 10.5px/500 `--ink-4`, tabular.
  The active item is kept in view (24px above, 4px below).
- **Empty**: padding `14 10`, 12.5px `--ink-3`: "Type a value, then press ⏎." (value slots) or "Nothing
  matches."
- **Footer**: row, space-between, gap 8, padding `8 12`, 1px `--rule` above, `--paper-2`, mono 10px/500
  `--ink-4`: the source hint (§17.3) and "↑↓ ⏎ esc".

**Keys**: ↓ / ↑ move over enabled items and wrap; ⏎ (without ⌘/Ctrl) or Tab picks the active item; Esc
closes. Typing filters and resets the active item to the first. **Chaining**: picking fills the slot and
opens the next empty one, so a condition goes field → comparison → value without extra clicks (§6.6). The
popover opens with the slot's current value active (§19).

### 6.2 What each slot offers

Filters match the typed text anywhere in the label (or name), case-insensitively.

| Slot (popover label) | Offers | Groups · meta | Source hint |
|---|---|---|---|
| Field ("FIELD") | The fields of the shape at that step: detail = plain kind ("text", "number, sometimes missing"), meta = a summary ("8 values", "0.85 – 3,646.84", "3 cases", "2025-10-01 – 2026-09-19", "1–4 each", "· 12 missing"), note = "{case} {plural} only" for an un-narrowed payload field | "Fields" · "Inside {parent}" | Fields from the checked type |
| Compare ("COMPARE") | The comparisons for the field (§5); has any where has the detail "check the items in the list" | "Compare" | — |
| Value ("VALUE") | Case names with counts ("14 orders"); text values with counts, top 12 (the mock also names a customer ID's customer, §19); numbers as lowest, median, average and highest; years or months present in the data ("Years in the data", "Months in the data"), and for on or after / before the months' first days ("start of month · 7 orders"); has at least 1–4 ("item(s)"). A typed value not in the list comes first as "Use “x”" (numbers parsed, thousands commas dropped) | "Cases" · "Values in the data" · "From the data" · "Typed" · "Items" | Values from the dataset summary |
| Field in each item / Compare / Value (inner) | As above over the list's elements ("Each line") | — | — |
| Match ("MATCH") | all "every condition holds", any "at least one holds" | "Match" | — |
| Find by ("FIND BY") | Fields of the lookup table's key type | Fields | Fields from the checked type |
| Dataset ("DATASET") | The bound lookup tables (Dict-typed sources), meta "{n} {plural}" | "Other datasets" | — |
| Bring in ("BRING IN") | The dataset's value fields not yet brought in, detail = plain kind | "From {dataset}" | — |
| Group by ("GROUP BY") | "all rows together" ("one row of totals"), then fields of kind text, whole number, one of, date, yes or no | "Group" · "Fields" | Fields from the checked type |
| Total ("TOTAL") | add up, count, average, lowest, highest, count different (add up and average only for numbers) | "Total" | — |
| Of ("OF") | Numbers for add up and average; any field for count different; numbers, dates and text for lowest and highest | Fields | Fields from the checked type |
| Sort by ("SORT BY") | Fields of kind text, numbers, date, one of, yes or no | Fields | Fields from the checked type |
| Order ("ORDER") | "newest first" / "oldest first" (dates); "Z to A" / "A to Z" (text, cases); "highest first" / "lowest first" | "Order" | — |
| Field (show only; "ADD FIELD") | Fields, excluding those already chosen for Add field | Fields | Fields from the checked type |
| Field (fill) | Optional fields that are not payload fields | Fields | Fields from the checked type |
| List ("LIST") | List fields | Fields | Fields from the checked type |
| Part ("PART") | year "2026", month "2026-03", weekday "Tuesday" | "Part" | — |
| Date ("DATE") | Date fields | Fields | Fields from the checked type |
| Value (model input; "VALUE") | A typed value | "Typed" | Values from the dataset summary |
| Add a step ("ADD A STEP") | The steps that fit the shape at that point (§6.3); with an empty query, or when the typed text matches, up to 5 saved and recent queries on the same source | "Add a step" · "Start from a saved query" / "Replace with a saved query" | Only steps that fit the current shape |
| Queries ("QUERIES", from Saved ▾) | "New query on {name}" (`fa-plus`) for every bound data source, the current source first (§13.2); then every saved and recent query (`fa-bookmark` / `fa-clock-rotate-left`, detail "{source} · {when}") | "Start" · "Recent" · "Saved" | Recent and saved queries |

### 6.3 Add-step options

Each option has a label, a hint (the sub-line), keywords for filtering, and a condition. Options that don't
fit are listed disabled with a reason.

| Label | Hint | Fits when | Keywords |
|---|---|---|---|
| Keep rows where… | Keep only the rows that match | rows | filter where select only matching remove exclude |
| Look up from another dataset… | Bring in fields from another dataset by key (the mock: "…from customers by id") | rows, and a bound lookup table whose key type is a field's type | join lookup bring match |
| Group and total… | One row per group, with totals | rows | group sum total add up count average mean aggregate pivot per by |
| Sort by… | Order the rows | rows | sort order rank highest lowest top |
| Keep the first… | The first rows only | rows | first top limit head n |
| Count the rows | Gives one number | rows | count how many number length total rows |
| Show only some fields… | Pick and rename fields | rows | pick select columns fields rename show only hide choose |
| Fill in missing values… | Use a default where a value is missing | rows with an optional field | missing default null empty fill blank |
| Open each {noun}'s list… | One row per item in a list | rows with a list | flatten expand lines unnest open list each items |
| Take part of a date… | Year, month or weekday | rows with a date | date year month week day part time |
| List every part in the tree | Walk every nested level | one tree (a recursive value) | recurse tree walk nested children parts flatten all |
| Try the model over a range… | One row per input value | one calculation (a function value) | call model function range what if tabulate price |

Reasons: "Needs a tree of parts" (List every part), "Needs a calculation" (Try the model), "Nothing to use
it on here" (rows, but no such field), "Needs rows — the query gives {shape, lower-cased} here".

### 6.4 Dataset summaries

The Field summaries and the Value offers come from the **summary of the rows at that step**: counts per
value (text and cases, in case order for cases), missing counts, min / max / mean / median for numbers,
min / max and per-month and per-year counts for dates, min / max lengths for lists.

Product (#934): the summary is #875's `summarize` — one jq program generated from the shape's type
(`summaryProgram`, #922) — run by the query route over the program before the slot's step (`<program up
to here> | <summary program>`) when a popover that needs it opens, with limits `{ maxOutputs: 1,
timeoutMs: 5 000 }`, and cached by (program, input hashes). It is the one read that is not a Run, and it is
never shown as a result.

### 6.5 Summaries in words

| Kind | Summary |
|---|---|
| one of | "{n} case(s)" (cases present) |
| text | "{distinct} value(s)" + " · {m} missing" |
| numbers | "{min} – {max}" (IDs raw, others formatted) + missing |
| date | "{first day} – {last day}" |
| list | "{min}–{max} each" |

### 6.6 What picking does

- **Field**: sets the field (keeping the comparison and value when the kind matches) and opens the value, or
  the inner field for has any where, when the comparison needs one.
- **Compare**: keeps the value unless either comparison is is in year, is in month or has at least (whose
  values differ in kind), then opens the value when it is empty.
- **Total**: renames the total while its name is still automatic: count → "count", add up → the field's
  name (or "total"), others → "{total}_{field}" ("max_cost"); opens Of when it needs a field. A name typed
  by hand stops the renaming.
- **Show only field**: names the field by its last part (`status.shipped.date` → `date`).
- **Part**: rewrites a trailing year / month / weekday in the name ("ship_month" → "ship_year").
- **Add a step**: inserts the step with its defaults (§5) and opens its first empty slot.
- **A saved query** (from Add a step): replaces the whole query, its name and save state, and runs it.
- **Inputs**: counts, fill values and range numbers parse as numbers (thousands commas dropped) or stay text;
  names become identifiers (runs of non-word characters → "_", trimmed; empty → "value").

---

## 7. Checking and problems

### 7.1 Status line

Row, gap 16, height 32, padding `0 16`, 1px `--rule` above, `--paper-2`, no wrap, `overflow: hidden`.
Mixed text shares one baseline and a 16px line height; dots and dividers are centred on the row.

- **Left** (flex `1 1 auto`, baseline row, gap 10): a 6px dot; the word (mono 10px/600, line-height 16,
  0.14em, uppercase, same colour as the dot); a 1×12 `--rule-strong` divider; the shape, "Gives {shape,
  lower-cased}" (12.5px, 16, `--ink-2`, with its East type and multiplicity on hover, "Array<…> · many");
  the fields, "· a, b" (12px, 16, `--ink-4`, clipped with an ellipsis).
- **Right** (flex `0 1 auto`, max-width 45%, baseline row, gap 8): a 6px dot; the save state (mono 10px/600,
  16, 0.1em, uppercase); the name (12px, 16, `--ink-3`, clipped, the full name on hover).

| State | Word | Colour |
|---|---|---|
| Problems | "{n} problem(s)" | `--neg` |
| Unfinished steps (visual) | "{n} to finish" | `--warn` |
| Warnings only (jq) | "{n} warning(s)" | `--warn` |
| Clean | "Checks clean" | `--pos` |

In jq mode the shape is the checked program's ("Not checked" when it doesn't parse).

### 7.2 Problems

A problem appears under the row that causes it, in plain words, with one-click fixes when the checker has
one; the jq view shows the same problem with the checker's jq message and position (§9.6). Every problem's
words are in §17.4.

Product: east core's canonical steps print to canonical jq with spans (§8.1), the whole program goes
through the checker once, and each diagnostic maps back by span to the step, condition and slot it came
from (#933). The editor words it: the plain message of §17.4 for the checker codes it knows how to
phrase for that step, else the checker's own message (#934). Completeness ("Choose a field", "Enter a
value", "Finish this step") is the canonical steps' own check, since an unfinished step is not in the
program.

### 7.3 Shapes in words

| Shape | Words |
|---|---|
| rows | "Many {adj} {plural}" ("Many shipped orders"); after Keep the first, "Up to {n} {adj} {plural}" |
| one whole number | "One whole number" |
| one number | "One number" |
| one record | "One record" |
| one tree | "One {noun} tree" ("One part tree") |
| one calculation | "One calculation" |
| one text value | "One text value" |
| anything else | "One value" |
| after a jq step | the mock: "Shape known after the jq step"; product: the checked type's words (§19) |

Plain kinds: text · whole number · number · date · yes or no · nothing · "one of a, b, c" · "list of
{plural}" · lookup table · calculation · record · "tree of {plural}"; an Option adds ", sometimes missing".

Nouns and adjectives: a data source's noun is the singular of its name (orders → order); narrowing to a case
sets the adjective (shipped); grouping makes the group field the noun ("region"); opening a list makes its
singular the noun (lines → line). Plurals: `-us/-ss/-x/-ch/-sh` + "es", `-s` kept, consonant + `y` → "ies",
else "s".

### 7.4 Narrowing and its fix

Reading a payload field such as "shipped date" needs the rows narrowed to that case first. Without it the
problem is "Only shipped orders have a shipped date." with the fix **Keep only shipped orders first**, which
adds `status is shipped` as the first condition of this Keep rows where step (wrapping an `any` step as
`all [status is shipped, any (old conditions)]`), or inserts a Keep rows where step before a step of
another kind.

---

## 8. Canonical jq: printing and parsing steps

### 8.1 The canonical forms

The steps print as one program, one segment per line joined by "\n| ". Lookups bind their datasets first.
The default query prints:

```
.customers as $customers
| .orders
| map(select(.status.type == "shipped") | select(.total >= 100 and (.status.value.date | year) == 2026))
| map(. + {name: $customers[.customer_id].name, region: $customers[.customer_id].region})
| map({order: .id, customer: .name, region, total, shipped: .status.value.date})
| sort_by(-.total)
| .[:10]
```

| Step | Canonical jq |
|---|---|
| (prologue) | `.{ds} as ${ds}` for each dataset a complete Look up reads, then `.{source}` |
| Keep rows where | `map(<select(case) per narrowing condition> \| select(<rest joined by and / or>))`. Under `all`, each `case is v` is hoisted into its own `select(.F.type == "v")` first, so the payload reads after it check. Groups are parenthesised with their own joiner |
| — conditions | `p == v`, `p != v`, `>=`, `<=`, `>`, `<` (numbers bare, text as JSON strings); `(p \| contains("v"))`; `(p \| startswith("v"))`; `p == null` / `p != null`; `p == true` / `p == false`; `(p \| year) == 2026`; `(p \| strftime("%Y-%m")) == "2026-03"`; `p >= "2026-03-01"` / `p < "2026-03-01"` (ISO literals checked at check time); `(p \| length) >= n`; `any(p[]; <inner>)`. A payload field path is `.F.value.P`; a case is `.F.type` |
| Look up | `map(. + {f: $ds[<key>].f, …})`; a variant field brings its case, `.f.type` |
| Group and total | `group_by(<by>)\n\| map({<by name>: .[0]<by>, <name>: <total>, …})`; totals `length`, `(map(f) \| add)`, `(map(f) \| add / length)`, `(map(f) \| min)`, `(map(f) \| max)`, `(map(f) \| unique \| length)`; "all rows together" prints `{<name>: <total>, …}` |
| Sort | a required number, descending: `sort_by(-f)`; otherwise `sort_by(f)`, plus `\n\| reverse` for descending |
| Keep the first | `.[:n]` |
| Count the rows | `length` |
| Show only fields | `map({a, b: .x.y})` (the shorthand when the name is the field's) |
| Fill in missing | `map(f //= v)` |
| Open each list | `[.[] \| . as ${noun} \| f[] \| . + {{noun}_id: ${noun}.id}]`, or `[.[] \| f[]]` when the rows have no `id` |
| Take part of a date | `map(. + {name: (f \| year)})`, `strftime("%Y-%m")` for month, `strftime("%A")` for weekday |
| List every part | `[recurse(.children[]) \| {cost, sku}]` (the scalar fields) |
| Try the model | `[range(from; to + step/2; step) as $p \| {p: $p, name: call(.; {p: $p, k: "fixed", …})}]` |
| jq step | its text, trimmed |

Unfinished steps are left out. The printer records each step's and each condition's text range: problems
are placed by them (§7.2) and the jq view marks them (§9).

### 8.2 Parsing back

Switching to visual parses the jq. Each canonical form becomes its step again, including groups, inner
conditions and narrowing; anything else becomes a jq step, and everything after a jq step stays jq (its
shape is not a row shape the step model can follow). A syntax error keeps the editor in jq with the note
"Fix the syntax problem first — the visual steps are built from the jq." The program must start from a
data source: an unknown name is "There's no dataset called “x”." with the fix "Use .{closest}"; anything
else is "Start the query from a dataset."

Product (#933): the projection works on #875's parsed AST, not on text, so whitespace, comments and
formatting don't matter; every form above is recognised structurally, and printing a parsed query gives the
canonical text back (the round trip is tested over the step catalogue).

---

## 9. The jq view

### 9.1 Layout

In jq mode the steps column (640 wide) holds, top to bottom: the jq note bar, then the editor filling the
rest. **Note bar**: row, gap 8, padding `8 16`, 1px `--rule` below,
`color-mix(in oklch, var(--warn) 6%, transparent)`, 12.5px `--ink-2`, an 11px `fa-triangle-exclamation` in
`--warn` and the note: "{n} unfinished step is left out of the jq until it is finished." (§17.2).

The editor is a column, `--paper`: the code area (flex 1, `overflow: auto`) and the problems panel.

### 9.2 Code area

A grid `44px auto`, min-width `44 + 32 + longest line × char width + 24` (at least 20 characters), min-height
100%:

- **Gutter**: padding `12 0`, `--paper-2`, 1px `--rule` right, `user-select: none`. Per line: height 20,
  right-aligned, padding-right 10, gap 6, mono 11px/500 line-height 20 `--ink-5`, tabular: a 6px dot
  coloured by the worst problem starting on that line (`--neg`, `--warn`, or `--ink-5` for a note;
  transparent for none), then the line number.
- **Highlighting** (behind, `aria-hidden`, no pointer events): padding `12 16`, mono 12.5px/400
  line-height 20, `font-variant-ligatures: none`; one 20px line per line, `white-space: pre`.
- **Textarea** (in front): absolute, inset 0, 100% × 100%, padding `12 16`, no border, outline, resize or
  scrollbars, transparent fill and text, caret `--ink`, the same font, `white-space: pre`, `wrap="off"`,
  `aria-label="jq query"`, `spellcheck`, `autocomplete` and `autocapitalize` off.
- The character width is measured from 50 "x" in the code font, again once fonts load (7.5 until then).

### 9.3 Highlighting

| Token | Colour · weight |
|---|---|
| keyword (`as def if then elif else end reduce foreach try catch label import include and or not`) | `--brand-dd` 600 |
| builtin name | `--brand-d` 500 |
| field (`.name`) | `--ink` 400 |
| variable (`$x`) | `--brand-dd` 500 |
| string | `--ink-3` 400 |
| number | `--ink-2` 500 |
| pipe `\|` | `--ink-4` 600 |
| operator, punctuation | `--ink-4` 400 |
| comment | `--ink-5` 400 |
| format (`@base64`) | `--brand-d` 500 |
| identifier, space | `--ink` 400 |
| any character the lexer can't read | `--neg` 400 |

Problems underline their range (at least one character): error `underline wavy var(--neg)`, warning
`underline wavy var(--warn)`, note `underline dotted var(--ink-4)`, offset 4px, thickness 1px. Tokens are
split at problem boundaries and at line breaks. Going to a problem (§9.6) tints its range `--brand-tint`.

### 9.4 Completions

- **Opens** after typing when the character before the caret is a word character, `.`, `"` or `$`, and on
  Ctrl+Space (§19). Up to 40 items.
- **Popover** (z 5): top `12 + (line + 1) × 20 + 4`, left `max(4, 16 + column × char width − 26)` from the
  replacement's start; width 380, `--paper`, 1px `--rule-strong`, radius 6, `--shadow-md`. List max-height
  232, padding 4; items height 30, padding `0 8`, gap 10, radius 4, the active one `--brand-tint`, hover
  `--paper-2`, mousedown accepts:
  - a glyph (width 16, mono 9.5px/600 0.04em `--ink-4`, centred): field `.f`, case `cs`, value `"v`, key
    `[k]`, builtin `fn`, variable `$`, dataset `ds`, else `·`;
  - the label (mono 12.5px/500 `--ink`);
  - the detail, right (mono 11px, `--warn` for a field that only exists in one case, else `--ink-4`,
    ellipsis).
  Footer (min-height 30, padding `6 12`, 1px `--rule` above, `--paper-2`, 12px/1.4 `--ink-3`): the item's
  doc (or a builtin's signature, or "{label} · {detail}") and "↑↓ · ⏎ · esc" (mono 10px/500 `--ink-4`).
- **What it offers**: at the root, the bound data sources (detail the East type, doc the plain kind); after a
  path, the fields of its type (detail the East type, doc the plain kind); on a variant, `type` ("case name:
  a, b") and `value`; under `.F.value.`, the narrowed case's fields, or every case's as `Option<T>` with the
  doc "only when .F.type == "c"" and the warning colour; inside `.F.type == "` the case names ("case of
  Status"); inside `== "` on text, the values in the data ("12 in data"); inside `$ds["` the dict's keys;
  after `$ds[…].` the value fields; after `$` the bound variables; a word, the builtins with their signatures
  and docs (inserting "name(" for those with arguments). Product (#922): `completeJq` gives the typed
  items; values come from the summaries of §6.4.
- **Accepting** replaces from the item's start to the end of the word under the caret; an item ending in `"`
  before an existing `"` does not double it.
- **Keys** with the popover open: ↓ / ↑ wrap, ⏎ or Tab accept, Esc closes. Moving the caret closes it; blur
  closes it after 120 ms.

### 9.5 Keys

⌘/Ctrl+⏎ runs (and closes the popover); Ctrl+Space completes; Tab without a popover inserts two spaces.

### 9.6 Problems panel

1px `--rule` above, `--paper`:

- **Summary bar**: row, gap 8, height 32, padding `0 16`, label 10px 0.14em: a 6px dot and the summary in
  its colour — "{n} problem(s) · {m} warning(s)" (`--neg`), "{m} warning(s)" (`--warn`) or "Checks clean"
  (`--pos`), or "Checking" (`--ink-4`, dot `--ink-5`) until the checker loads; right, "ctrl space ·
  suggestions" (mono 10px/500 at 0.08em, not uppercase).
- **List** (max-height 150, `overflow: auto`), one item per problem: row, `align-items: flex-start`, gap 10,
  padding `7 16`, 1px `--rule` above, 12.5px/1.45; hover `--paper-2`:
  - a 6px dot (margin-top 6);
  - a go-to button (flex 1, column, gap 2, left-aligned): the code (mono 10px/600 0.1em uppercase in the
    severity's colour, underscores as spaces; "note" for a note) beside "L{line}:{column}" (mono 10.5px/500
    `--ink-4`), then the jq message (mono 12px `--ink-2`). Going selects the range in the textarea and tints
    it;
  - the fixes that are text edits: height 26, padding `0 8`, 1px `--rule-strong`, radius 6, `--paper`,
    `--brand-d`, mono 11.5px/600; hover border `--brand-d`. A fix applies its edit and leaves the caret after
    it.

---

## 10. Results

A column filling the right of the body, `--paper`. Width classes follow its own width: **narrow** under
600 (the run meta and the Download label hide), **tight** under 470 (the fields and the Table / Tree labels
hide).

### 10.1 Rail

`role="toolbar"`, `aria-label="Result controls"`. Row, gap 10, height 44, padding `0 12 0 16`, 1px `--rule`
below:

- **Left** (flex, baseline row, gap 10), with a result: the count (13px/600, line-height 16, tabular,
  `--ink`: "10 orders" for rows, the shape for one value); the fields, "· order, customer, region, total,
  shipped" (12.5px, 16, `--ink-3`, clipped); a spacer; the run meta (mono 10.5px/500, 16, `--ink-4`,
  tabular, clipped): "run #{n} · HH:MM:SS · {ms} ms" (the run's local time), with "{East type} ·
  {multiplicity}" on hover.
- **View switch**: `role="group"`, `aria-label="Result view"`, "Table or Value tree" on hover; height 28,
  1px `--rule-strong`, radius 6. **Table** (`fa-table` 10px, a right border) and **Tree**
  (`fa-folder-tree`): padding `0 10`, gap 6, label 10.5px 0.1em; active `--brand-tint` / `--brand-dd`,
  otherwise `--paper` / `--ink-3`; `aria-pressed`. On hover they say which was picked: "Table · picked for
  many rows" / "Value tree · picked for one value" on the automatic one, "Table" / "Value tree" otherwise.
- **Download ▾**: height 28, padding `0 10`, gap 8, 1px `--rule-strong`, radius 6, `--paper`, body 12px/500
  `--ink`: an 11px `fa-download` in `--ink-3`, "Download", "▾" (mono 10px `--ink-4`). Disabled at opacity
  0.5 without a result; hover border `--ink-3`. `aria-label` "Download".
- **Download menu**: scrim (z 20, click closes); panel (z 21) width 240, padding 4, `--paper`, 1px
  `--rule-strong`, radius 6, `--shadow-md`, right-aligned 4px under the button: items min-height 32, padding
  `6 10`, gap 10, radius 4, body 13px/1.3, hover `--paper-2`: a 12px icon in `--ink-4` (width 14), the
  label, the meta (mono 10.5px/500 `--ink-4`): **CSV** (`fa-file-csv`, "table"), **BEAST2**
  (`fa-file-code`, "typed").

### 10.2 Bars

Under the rail, each `flex-shrink: 0`, 12.5px `--ink-2`:

| Bar | When | Look | Content |
|---|---|---|---|
| Stale | a result, and the program changed since | min-height 36, padding `0 16`, gap 10, `--paper-2`, a 1px **dashed** `--rule-strong` bottom; the body gets `outline: 1px dashed var(--rule-strong)`, offset −5px | "STALE" (label 10px 0.14em) · "The query changed after this run." · right: "Run again" (height 26, padding `0 8`, gap 6, radius 6, transparent, `--brand-d` body 12px/600, hover `--paper-3`) + "⌘⏎" (mono 10px/500 `--ink-4`) |
| Error | the last run did not return a result | row, `align-items: flex-start`, gap 10, padding `10 16`, `color-mix(in oklch, var(--neg) 6%, transparent)`, 1px `--rule` below, line-height 1.45 | a 13px `fa-circle-exclamation` in `--neg` (margin-top 2); a column (gap 2): the title (600 `--ink`) and the message. Titles in §17.6 |
| Note | after a download | min-height 36, padding `6 12 6 16`, gap 10, `color-mix(in oklch, var(--info) 6%, transparent)`, 1px `--rule` below | a 12px `fa-circle-info` in `--info`, the note, dismiss (icon button 24, "×" mono 13px `--ink-4`, `aria-label="Dismiss"`) |

The mock also has a Preview bar, for Elara's proposals (§14).

### 10.3 Body

Flex 1, `overflow: auto`, `position: relative`.

- **Idle** (never run): centred column, gap 12, padding 24: "⏎" (mono 30px `--rule-strong`), "Run the query
  to see results" (body 15px/600/1.3 `--ink`), then two lines (column, gap 6, 12.5px `--ink-3`, left-aligned),
  each after a mono "☐" in `--ink-4`: "Checks run as you edit; nothing reads data yet." and "Press Run or ⌘⏎
  to read the datasets the query uses."
- **Running**: a head (height 36, padding `0 16`, gap 8, `--paper-2`, 1px `--rule-strong` below, label 10px
  0.14em): a 6px `--brand-d` dot pulsing (the mock's `qe-pulse`: opacity 1 → 0.3 → 1, 1.2 s ease-in-out,
  infinite) and "Reading {datasets joined by ', '}" ("Reading orders, customers"; "data" when unknown). Then
  six skeleton rows (height 36, padding `0 16`, gap 24, 1px `--rule` below) of three bars (height 10, radius
  3, `--paper-3`) with widths [80, 140, 60], [64, 180, 72], [92, 120, 56], [70, 160, 64], [84, 132, 70],
  [60, 150, 58].
- **Table**: the mock draws a sticky 36px header on `--paper-2` (a 1px `--rule-strong` below; labels mono
  10px/600 at 0.16em, uppercase, `--ink-4`; padding `0 14`) and 36px rows (a 1px `--rule` below, hover
  `--paper-2`; cells padding `0 14`, no wrap, ellipsis, the full text on hover). Numbers and IDs are
  right-aligned in tabular mono 12.5px; dates mono; text body 13px; missing values are "—" and nested values
  are summarised ("3 lines", "2 entries", "shipped · 2026-06-01 14:00"), both in `--ink-4`. A value that is
  not rows shows as one row: a record's fields, or a single "value" column. Labels are the field names with
  underscores as spaces and `id` / `sku` upper-cased. Product (#938): east-ui's Table renderer (§18).
- **Value tree**: `role="tree"`, `aria-label="Value tree"`, padding `4 0`; rows `role="treeitem"`, height
  32, padding-left `12 + depth × 20`, gap 8, 13px, hover `--paper-2`: a toggle for a branch (18×18, radius
  4, 9px `fa-chevron-down` / `fa-chevron-right`, `aria-label` "Collapse" / "Expand"; hover `--paper-3`), or
  an 18px spacer for a leaf; the label (flex `0 1 200px`, min 72, max 45%, 500 `--ink`, ellipsis); the value
  (mono 12px, tabular, ellipsis; `--ink-4` when muted) and the summary (12px `--ink-4`, when the node is
  closed or has no value). The root is "Result", open by default. Record fields are labelled in words
  ("Customer id"), array items by index, dict entries by key; a variant shows its case as the value with its
  payload's fields below. Product: east-ui's ValueTree renderer, read-only (§18).

The view is picked from the result: rows open as a Table, one value as a Value tree. The switch overrides it
until the next run; a new run also resets the tree's expansion, the note and the menu.

### 10.4 Footer

Row, gap 12, height 32, padding `0 16`, 1px `--rule` above, `--paper-2`, mono 10.5px/500 `--ink-4`,
tabular, no wrap. Left: "Running…", "No result" (after a failure), "No result yet", or for a Table "{n}
row(s)" / "Showing 1–{shown} of {total}", for a Tree "{n} item(s)" (rows) or "1 value". Right (ellipsis):
"reads {dataset} #{hash} · …" — every data source the run read, with the first 8 characters of its content
hash.

### 10.5 Downloads

The file name is the query's name lower-cased with every run of other characters as "-" ("top-shipped-
orders-2026"). **CSV** saves "{name}.csv", one row per output, header = the field names, and notes
"Downloaded {name}.csv — {count}, one row per output." **BEAST2**: the mock only notes "{name}.beast2 is the
typed, self-describing result the query route returns. This mock doesn't encode BEAST2." Product: it saves
the route's result blob as "{name}.beast2", and CSV cells are East CSV's (§19).

---

## 11. Running, shapes and staleness

### 11.1 Run

Run (or ⌘/Ctrl+⏎ anywhere in the editor) sends the canonical program (in jq mode, the jq, printed
canonically when it parses). It shows the running state with the data sources the program reads, then the
result. The mock waits 420 ms and evaluates in the page; product (#938): the query route, with the
statement checked on the client (`checked { query, root }`, the root being the bound data sources' names and paths), the
default limits (1 000 outputs, 1 MiB, 30 s), and a new run abandoning the previous one. A program that
doesn't parse is not sent: the error bar says the parser's message.

The editor runs the query when it opens with a program, and when a saved query is loaded. It never runs on
edit, and a dataset dropped in (§13) opens without running, as "New query" does.

### 11.2 Counting shape lines

After a fresh run (the program unchanged since, in visual mode), each step's shape line counts the rows at
that step ("16 shipped orders").

Product (#938): the program counts its own stages, so one run gives every line. In visual mode the
editor sends the canonical program with `length as $nK |` after each stage whose shape is rows, wrapped as
`{counts: [$n0, …], result: <the rows' first 1 000, or the value>}`; the route is unchanged, and the program
the editor shows, copies and saves is the plain one. The last count is the total ("Showing 1–1 000 of
{total}").

### 11.3 Stale

When the program changes after a run, the Stale bar appears and the result gets its dashed outline; shape
lines stop counting and show plain shapes.

---

## 12. Saving, recent queries and copy

### 12.1 Save popover

Save opens a popover under it: a scrim (z 30; mousedown closes), then `role="dialog"`,
`aria-label="Save query"`, z 31, width 300, right-aligned with the button (left `max(8, button right −
300)`, top `button bottom + 4`), column, gap 10, padding 12, `--paper`, 1px `--rule-strong`, radius 6,
`--shadow-md`:

- the label "SAVE AS" (9.5px, 0.14em);
- the name input (height 32, padding `0 10`, 1px `--rule-strong`, radius 6, body 13px/500; focus `--brand-d`
  border and `--shadow-focus`; `aria-label="Query name"`), prefilled with the name, focused and selected on
  open; typing renames the query live;
- the hint (12px/1.45 `--ink-3`): "Saving again updates this saved query." when the name is the saved name,
  else "Saved queries appear under Recent and saved.";
- Cancel (height 30, padding `0 10`, 1px `--rule-strong`, radius 6, `--paper`, `--ink-2` 12.5px/500; hover
  border `--ink-3`) and **Save** (height 30, padding `0 12`, the primary look).

⏎ saves, Esc closes. Saving is always the user's action.

### 12.2 Saved ▾

The queries popover (§6.2 "Queries"): "New query on {name}" starts an empty query on that data source
("Untitled {name} query", not saved, not run); picking a saved or recent query loads it, sets its name and
save state, and runs it.

Product (#935): saved queries are a **bound record** handed to the editor (`saved`, a `Record.bind`
handle — the editor only accepts bound sources): a Dict from name to `{ datasets, name, program, saved_at }`
(`QueryEditor.Types.Saved`), written through the record's patch mutation, so a save is audited and two
people saving at once don't lose each other's work. Without `saved`, Save is hidden and Saved ▾ lists only
recent queries. Recent queries are per viewer (the last 10 runs, in browser storage, keyed by the editor's
`id`). "When" labels: "Saved · today", "Saved · Tue", "Saved · 12 Sep" (from `saved_at`); recent "Today
09:12", "Yesterday", "Mon". A saved query that reads a data source the editor isn't bound to is listed
disabled ("Reads {name}, which isn't here").

### 12.3 Save state

| State | Words | Colour · dot |
|---|---|---|
| Just saved (1 800 ms) | "Saved" | `--pos` · `--pos` |
| The program or name differs from the saved one | "Unsaved changes" | `--brand-dd` · `--brand-d` |
| Saved | "Saved" | `--ink-4` · `--rule-strong` |
| Never saved | "Not saved" | `--ink-4` · `--rule-strong` |

The name falls back to the saved query whose program equals this one, else "Untitled {source} query".

### 12.4 Copy jq

Copies the program (in jq mode, the text as typed), then shows the check for 1 600 ms.

---

## 13. Bound data sources and dragging a dataset in

Product additions (#935, #939); the mock's datasets are fixed in the page.

### 13.1 The editor queries only what it is bound to

The page hands the editor its data sources as bindings, named:

```tsx
const orders    = $.let(Data.bindPaged(ordersInput));     // a large collection: windowed, never preloaded
const customers = $.let(Data.bind(customersInput));
const plan      = $.let(Record.bind(planRecord, []));      // a record is a data source too
const sources   = { orders, customers, plan };
// savedQueries = QueryEditor.savedQueries("saved_queries"): the record and its patch mutation (§12.2)
const saved     = $.let(Record.bind(savedQueries.record, [savedQueries.patch]));

<DataLibrary id="datasets" datasets={sources} />
<QueryEditor id="main" datasets={sources} saved={saved} sources={["datasets"]} />
```

- **The root is exactly these names** (`.orders`, `.customers`, `.plan`), typed from each binding. Nothing
  else in the workspace is reachable: the checker says `unknown_field` with the root's names, and the
  step model offers only these.
- **Scope comes from the bindings.** Each binding is already declared in the `ui` task's manifest (`paths`,
  `pages` and `records`), so the editor adds no declaration of its own.
- **Which binding.** `Data.bindPaged` for a collection the page doesn't need whole (the editor never
  downloads it: runs and summaries go to the query route); `Data.bind` for one it also uses elsewhere; a
  record through `Record.bind`.
- **Runs** send the bindings' names and dataset paths as the root (`checked { query, root }`), and the footer's "reads …" names
  them by the page's names.

### 13.2 Starting from a data source

The source card names the source; "New query on {name}" in Saved ▾ lists every bound data source, so a query
can start on any of them without dragging.

### 13.3 The Library and the drop

`<DataLibrary>` is east-ui's Library of the bound data sources (§18.3): one card per name — the name, the
plain kind and size as the sub-line ("list of orders · 40", "lookup table · 8 customers", "calculation",
"part tree"), an icon by kind (`fa-table-list` rows, `fa-book` lookup table, `fa-sitemap` tree,
`fa-calculator` calculation, `fa-cube` record), and its freshness as the status ("STALE" when the dataset is
stale). Its cards are drag sources under its `id`.

The editor is a drop target for the Libraries listed in its `sources`. A card whose name is one of the
editor's data sources can be dropped:

- **On the editor** (the steps and results, as the mock's target covers them): starts a new query on that
  source — the steps are cleared, the name becomes "Untitled {name} query", the save state "Not saved", the
  mode visual — with the visual note "Started a query on {name}." and **Undo** (which restores the steps,
  name, save state and result). It doesn't run.
- **On an Insert point, or on "Add a step at the end"**: when the source is a lookup table and the rows there
  have a field of its key type, adds a Look up step from it (key = that field; Bring in opens). Otherwise
  the point refuses the drop (⊘), and its reason is announced: "{name} isn't a lookup table" or "No field
  here matches {name}'s keys".

**The target** (the mock's drop design, now for data sources): while a card is dragged anywhere on the page,
every editor it can drop on shows a target over its body (top 48 to bottom 32, z 20, centred, padding 24):

- a wash, `--paper` at 0.8 (armed) or `--brand-tint` at 0.92 (over this editor);
- a dashed frame, 1px `--brand-d`, radius 8, inset 10;
- a card: column, gap 8, max-width 440, padding `18 22`, `--paper`, 1px border (`--rule-strong`, `--brand-d`
  when over), radius 8, `--shadow-md`, centred text: a 15px `fa-arrow-down` in `--brand-d`, the title
  (`--font-brand` 15px/700/1.3, −0.01em) "Drop to query “{name}”", and the sub-line (12.5px/1.5 `--ink-3`)
  "Starts a new query on {name}. Replaces the {n} step(s) in the editor; you can undo." (or "Starts a query
  on {name}." with no steps).

Insert points and the add bar show the drag layer's own drop stages while a lookup table is over them.
A card whose name the editor doesn't have is refused everywhere (⊘), with "{name} isn't a data source of
this editor".

**The drag layer.** The editor registers through the drag layer's public hooks (`useDragTarget`,
`useDropCell` with `canDrop`), which #608 keeps as it rebuilds the layer on dnd-kit (PR #827): keyboard drag
(Space picks up, arrows move, Space drops, Esc cancels), auto-scroll and announcements come with the layer.
The armed and over looks are the theme's drop stages (`data-drop-valid`, `data-drop-active`), styled by the
recipe, not tracked in component state.

---

## 14. Not in #875: the mock's Elara parts

The brief's integration with the Elara chat is left for later. The mock carries its editor-side half, which
#875 does not build; for the record:

- **Ask Elara** in the control rail (only with a `chat` prop): height 32, padding `0 12 0 9`, gap 8, radius
  6, body 12.5px/500; the Elara mark (idle, 16) and "Ask Elara", or "In chat" + a 10px `fa-check` on
  `--brand-tint` / `--brand-dd` with a `--brand-d` border when attached; `title` "Attach this query to the
  chat" / "Elara can read this query. Click to detach." While attached, the frame's border is `--brand-d`.
- **Opening a query from the chat**: a result card dropped on the editor (HTML5 drag, `application/x-east-
  query` + `text/plain`, armed by a `qe:drag` window event) replaces the steps and name, runs, and notes
  "Opened from Elara: “{name}”." with Undo. Its target card reads "Drop to open “{name}”" / "{k} steps.
  Replaces the {n} steps in the editor; you can undo."
- **Proposals**: a commit bar at the top of the steps column (`--brand-tint`, a `--brand-d` rule; the mark at
  18, "Elara proposes {n} change(s)", Discard and Apply; the mono summary "{a} added · {c} changed · {r}
  removed · checks clean · results show a preview"); ADDED / CHANGED tags, "Was:" lines and struck REMOVED
  rows on the steps; every step inert; Insert, the bottom bar and Run hidden; the jq switch and Saved ▾ at
  0.45; the results under a PREVIEW bar (`--brand-tint`, dashed `--brand-d` rule, "Elara’s change, not
  applied yet. Apply or discard it above the steps."); Apply runs and notes "Applied Elara’s change." with
  Undo; Discard restores the previous result. Steps are matched by id and printed jq (§8.1's spans).
- **The page contract** (`inContext`, `loadRequest`, `proposal`, `decision`, `onSnapshot`, `onAskElara`,
  `onProposal`) and the chat's side (context chips, result cards, change cards, the checked tool steps).

When this comes, the editor's value-driven props (§18.1) and its step diff are the pieces it builds on.

---

## 15. The mock's data

The page generates #875's shared fixture from a fixed seed (Park–Miller, seed 875):

| Dataset | Type | Noun · hash (mock) | About |
|---|---|---|---|
| `orders` | `Array<Order>` | order · `4f2a1c8d` | Orders with lines and status |
| `customers` | `Dict<String, Customer>` | customer · `9b07e3a4` | Customers by id |
| `forecast` | `Forecast` (`Struct{regions: Dict<String, Struct{weekly: Array<Float>}>}`) | forecast · `71ab0c19` | Weekly demand by region |
| `model` | `Function([Struct{price: Float, region: String}], Float)` | model · `2e9f4077` | Demand model: price and region to units |
| `bom` | `Part` (recursive) | part · `c81d55e0` | Bill of materials for PUMP-A |

- **Types** are #875's acceptance fixture: `Line {price: Float, qty: Integer, sku: String}`, `Status`
  (`cancelled {reason}` · `pending` · `shipped {date}`), `Order {customer_id, discount: Option<Float>, id:
  Integer, lines, status, total: Float}`, `Customer {name, region, tier: gold | standard}`.
- **Orders**: 40, ids 1001–1040; each has a customer drawn from C01–C08 and 1–4 distinct lines from eight
  SKUs (BRK-100 12.40, HNG-220 8.90, PLT-310 46.00, BLT-045 0.85, SCR-012 0.32, WSH-008 0.18, RAL-900 64.50,
  CLP-150 3.75; quantity 1–400 under $5, else 1–30). 62% shipped (at 2025-10-01 plus 0–353 days, 08:00–16:00
  UTC), 24% pending, 14% cancelled ("Customer request", "Out of stock", "Payment failed"); 35% discounted by
  5, 10 or 15%; total = gross × (1 − discount), to the cent. The seed gives 23 shipped, 14 pending, 3
  cancelled.
- **Customers**: C01 Harbour Foods NSW gold · C02 Coastline Retail NSW · C03 Ridge Grocers VIC gold · C04
  Southbank Market VIC · C05 Sunfield Traders QLD · C06 Northgate Supply QLD gold · C07 Westend Provisions WA
  · C08 Ironbark Stores SA (standard unless marked).
- **BOM**: PUMP-A 42 → MOTOR-1 120 (ROTOR-1 18.5, STATOR-1 22, BRG-6203 3.2), HOUSING-2 35 (GASKET-9 1.1,
  BOLT-M8 0.4), IMPELLER-3 27.5, SEAL-KIT 6.8 (ORING-12 0.3, ORING-18 0.35).
- **Forecast**: regions NSW 1 200, VIC 1 050, QLD 860, WA 540, SA 410; eight weeks each, `base × (0.9 +
  0.03w + 0.01i)` to one place. **Model**: `base[region] × (price / 10)^−1.4`, to the cent (300 for an
  unknown region).
- **Saved queries** (the mock's): Top shipped orders, 2026 (the default for orders) · Revenue by region ·
  Shipped revenue by month · Large orders with no discount · Units by SKU · Pump parts cost (the default for
  bom) · Demand at $10–$12, NSW (the default for model); recent: Cancelled orders · Orders shipped in 2026
  (draft) · Gold customers or big orders. They are the showcase's fixture (#940).
- **Props**: `dataset` (orders, bom or model) picks the default query; `theme` (light or dark). The
  product's props are §18.1's.

---

## 16. Keyboard

| Key | Where | Does |
|---|---|---|
| ⌘/Ctrl + ⏎ | anywhere in the editor, the jq view | Run |
| Esc | with a popover open | Close it |
| ↓ ↑ | autocomplete, completions | Move (wrapping; disabled items skipped) |
| ⏎, Tab | autocomplete, completions | Pick |
| Ctrl + Space | the jq view | Completions |
| Tab | the jq view, no popover | Two spaces |
| ⏎ / Esc | save popover | Save / close |
| Space, arrows, Space / Esc | a Library card (the drag layer, #608) | Pick up, move, drop / cancel |

---

## 17. Copy

### 17.1 Rail, columns, status

"Visual" · "jq" · "Saved" · "Save" · "Run" / "Running" · "⌘⏎" · "Hide steps" / "Show steps" / "Hide jq" /
"Show jq" · "Start with {source}" · "Insert" · "Insert a step here" · "Add a step at the end" · "QUICK ADD" ·
"Keep rows" · "Group and total" · "Sort by" · "Keep the first" · "Show only fields" · "Not in the query until
it's finished." · "Add a step to narrow, reshape or total the rows, or start from a saved query." · "STEPS"
/ "JQ" · "LOADING THE CHECKER" · "Checks clean" · "{n} to finish" · "{n} problem(s)" · "{n} warning(s)" ·
"Gives {shape}" · "Not checked" · "Saved" · "Unsaved changes" · "Not saved" · "Untitled {source} query" ·
"Untitled query".

### 17.2 Notes

- Visual: "{n} part of the jq doesn't match a visual step, so it stays as jq." / "{n} parts of the jq don't
  match a visual step, so they stay as jq." · "Started a query on {name}." (§13).
- jq: "{n} unfinished step is left out of the jq until it is finished." / "{n} unfinished steps are left out
  of the jq until they are finished." · "Fix the syntax problem first — the visual steps are built from the
  jq."

### 17.3 Popovers

Labels: QUERIES · FIELD · COMPARE · VALUE · FIELD IN EACH ITEM · MATCH · FIND BY · DATASET · BRING IN · GROUP
BY · TOTAL · OF · SORT BY · ORDER · ADD FIELD · LIST · PART · DATE · ADD A STEP (any other: CHOOSE).
Placeholders: "Find a query" (queries), "Type or pick a value" (values), "Type to filter" (the rest).
Empty: "Type a value, then press ⏎." / "Nothing matches." Hints: "Values from the dataset summary" · "Only
steps that fit the current shape" · "Recent and saved queries" · "Fields from the checked type". Keys: "↑↓ ⏎
esc". Items: "Use “{x}”" · "New query on {name}" · "Reads {name}, which isn't here" · "all rows together" /
"one row of totals" · "every condition holds" / "at least one holds" · "check the items in the list" · "start
of month · {n} {plural}" · "{n} {plural}" · "lowest" · "median" · "average" · "highest" · "add up" · "count" ·
"count different" · "newest first" · "oldest first" · "Z to A" · "A to Z" · "highest first" · "lowest first"
· "year" · "month" · "weekday".

### 17.4 Problems (plain words · jq message)

| Where | Plain words | jq message | Fix |
|---|---|---|---|
| any step on one value | "{Shape} — there are no rows to {verb} here." | `not_iterable: {form} needs an array; its input is {East}.` | Remove this step |
| a field slot | "Choose a {what}." | Missing field. | — |
| a field of the wrong kind | "{Label} is {kind} — pick a {what}." | `type_mismatch: {path} is {East}.` | — |
| an unknown field | "There's no “{name}” here. The rows have {first six labels}…" | `unknown_field: .{name} is not a field of {East}. Did you mean {path}?` | Use {label} |
| a payload field, not narrowed | "Only {case} {plural} have a {label}." | `type_mismatch: {path} is Option<{T}> here — only the "{case}" case of .{F} has {leaf}. Narrow first with select(.{F}.type == "{case}").` | Keep only {case} {plural} first |
| an unknown case | "{Label} can be {cases} — not “{v}”." | `unknown_case: {Variant} has no case "{v}". Did you mean "{x}"?` | Use {x} |
| a whole variant compared | "Compare the {label} case, not the whole value." | `type_mismatch: .{F} is {Variant}; variants read as {type, value} — compare .{F}.type with a case name.` | Use .{F}.type |
| no comparison | "Choose how to compare." | Missing comparison. | — |
| a comparison for another kind | "“{cmp}” doesn't work on {kind}." | `type_mismatch: {cmp} is not defined for {East}.` | — |
| no value | "Enter a value." | Missing value. | — |
| has at least | "Enter a whole number of items." | `type_mismatch: length compares with Integer, got {Float\|String}.` | — |
| is in year | "Enter a year, like 2026." | `type_mismatch: year gives Integer; compare with a year.` | — |
| is in month | "Enter a month, like 2026-03." | `type_mismatch: strftime("%Y-%m") gives text like "2026-03", not "{v}".` | — |
| on or after / before | "Enter a date, like 2026-03-01." | `type_mismatch: "{v}" is not an ISO-8601 date — DateTime literals are parsed at check time.` | — |
| a number that isn't | "{Label} is a {kind} — “{v}” isn't one." | `type_mismatch: {op} compares {East} with String.` | — |
| a whole number compared with a fraction | "{Label} is a whole number, so it can never equal {v}." | `type_mismatch: Integer == Float is never true here.` | — |
| has any where, no inner field | "Finish the inner condition." | Missing inner condition. | — |
| an empty group | "This group is empty." | Empty group. | — |
| a filter with no conditions | "Add a condition, or remove this step." | `select(true) keeps every row.` | — |
| Look up: not a lookup table | "{dataset} can't be looked up by key." | `not_indexable: .{dataset} is {East}.` | — |
| Look up: key of another type | "{Dataset} are found by {kind} ids, but {label} is a {kind}." | `type_mismatch: ${dataset}[…] needs a {K} key; {path} is {East}.` | — |
| Look up: unknown field | "{Noun} records have no “{f}”." | `unknown_field: .{f} is not a field of {East}.` | — |
| Group: no key | "Choose what to group by." | Missing group key. | — |
| Group: adding text | "Can't add up {label} — it's {kind}. Pick a number, or count instead." | `type_mismatch: add needs numbers; {path} is {East}.` | Use {first two number fields} |
| Group: lowest of a case | "{Label} has no lowest or highest." | `type_mismatch: {min\|max} over {East}.` | — |
| Group: two names alike (warning) | "Two fields are called {x}; the last one wins." | `lint: duplicate key "{x}" in object construction.` | — |
| Keep the first | "Keep the first needs a whole number, 1 or more." | `type_mismatch: .[:n] needs an Integer, got {n}.` | — |
| Fill: never missing (warning) | "{Label} is never missing, so this changes nothing." | `lint: {path} is {East}, not an Option.` | — |
| List every part | "There is no tree to walk here." | `type_mismatch: recurse(.children[]) needs a recursive value; input is {East}.` | — |
| Try the model | "There is no calculation to try here." | `type_mismatch: call needs a Function value; input is {East}.` | — |
| Try the model: range | "The range needs a start below the end and a step above 0." | `type_mismatch: range({a}; {b}; {s}) yields nothing.` | — |
| Try the model: long range (warning) | "That range gives more than 1,000 rows; results will be cut off." | `lint: more than maxOutputs (1 000).` | — |
| An unfinished step (warning) | "Finish this step — it is not in the query yet." | Unfinished step, not printed. | — |
| The program (parse) | "The jq has a stray bracket." · "A text value is missing its closing quote." · "A bracket is never closed." · "The query ends with a pipe." · "The query is empty." · "There's no dataset called “{x}”." · "Start the query from a dataset." | `syntax: unexpected "{c}" — "{o}" at column {n} is still open.` · `syntax: this string is never closed.` · `syntax: "{c}" is never closed.` · `syntax: expected a filter after "\|".` · `syntax: empty program.` · `unknown_field: .{x} is not a dataset in this workspace. Did you mean .{y}?` · `unsupported: the visual editor starts from a dataset, like .orders.` | Use .{y} |
| A jq step | "Custom jq step." | (note) `Not a visual step: it stays as jq in the visual editor.` (§19) | — |
| An excluded builtin | "{name} isn't available in queries." | `unsupported: {name} is excluded — queries are deterministic and have no host access.` | — |
| `select(.x[] \| …)` (warning) | "Rows can appear more than once." | `duplicate_outputs: select(.x[] \| …) emits the row once per matching element. Use any(.x[]; …).` | Use any(.x[]; …) |

Product: the jq messages are the checker's (#875 §4.11); the table is the mock's wording, which the step
model keeps for the plain words (#934). With bound sources, "not a dataset in this workspace" reads "not
a data source of this editor".

### 17.5 Save and drop

"SAVE AS" · "Query name" · "Saving again updates this saved query." · "Saved queries appear under Recent and
saved." · "Cancel" · "Save" · "Undo" · "Drop to query “{name}”" · "Starts a new query on {name}. Replaces the
{n} step(s) in the editor; you can undo." · "Starts a query on {name}." · "{name} isn't a lookup table" · "No
field here matches {name}'s keys" · "{name} isn't a data source of this editor".

### 17.6 Results

"Table" · "Tree" · "Table or Value tree" · "Table · picked for many rows" · "Value tree · picked for one
value" · "Download" · "CSV" / "table" · "BEAST2" / "typed" · "STALE" · "The query changed after this run." ·
"Run again" · "Run the query to see results" · "Checks run as you edit; nothing reads data yet." · "Press Run
or ⌘⏎ to read the datasets the query uses." · "Reading {datasets}" · "Running…" · "No result" · "No result
yet" · "{n} row(s)" · "Showing 1–{n} of {total}" · "{n} item(s)" · "1 value" · "reads {dataset} #{hash}" ·
"Result" · "Collapse" / "Expand" · "Downloaded {name}.csv — {count}, one row per output."

Error titles: "Not run — the checker found problems" (checker errors) · "Not run" (the mock's unsupported
jq step). Product additions (#938), one per route outcome: `timed_out` "Stopped after {s} s" / "Narrow the
query, or ask for fewer rows."; `too_large` "The result is too large" / "{bytes} is over the {limit} limit.
Total or narrow the query."; `needs_platform` "Not run — the query calls a function this server can't run" /
"It needs {functions}."; transport "Couldn't reach the server" / the message. A truncated result says
"Showing 1–{n} of {n}+" in the footer.

---

## 18. From the design to east-ui

The design says what; this section says how, from east-ui's standards (`libs/east-ui/packages/east-ui/
STANDARDS.md`, `east-ui-components/CLAUDE.md`), `docs/conventions/EAST_UI_PROP_PATTERNS.md` and the design
system's guidelines (`libs/east-ui/app_design_system/guidelines/`). The children cite it.

### 18.1 The components

- **IR and renderer.** `QueryEditor` and `DataLibrary` are e3-ui components, as `Experiment` is: an
  `EastUI.component(name, payload, { optional: true })` carrier, a factory (internal,
  `@elaraai/e3-ui/internal`), and a public JSX tag with its `Types`. Their renderers register with
  `implementUIComponent` in e3-ui-components and are imported for their side effect from that package's
  barrel (#935, #939). Once #746's moves land (two UI packages, one folder per component), each is one
  folder in e3-ui instead — `types.ts`, `index.ts`, `tag.ts`, examples and spec, and `react/` for the
  renderer and everything React-side (#746 D3, D4).
- **Bound data sources only.** `datasets` is an object of name → binding (`BoundValue`, `PagedValue` or
  `BoundRecord`); the factory reads each binding's descriptor (`binding.source`, the paged handle's `id`, the
  record's `binding.name`) and its value type (from the handle's own East type), so the payload carries
  `{ name, source, type }` per source and nothing else can be queried. `saved` is a bound record too.
- **Two prop kinds, never a third.** Data: `id`, `datasets`, `saved`, `sources`, `program`, `name`, `height`.
  Behaviour: `onChange(snapshot)` — a pass-through `FunctionType`, lifted and never invoked at build time,
  capturing only data and bind handles.
- **Value-driven, like every east-ui input.** `program` and `name` are the editor's value: the renderer keeps
  local state from them, syncs when they change, and reports every change through `onChange` with a
  `QueryEditor.Types.Snapshot` (`{ name, program, datasets, steps, shape, errors }`). A page that sets
  `program` opens a query; one that ignores `onChange` leaves the editor uncontrolled.
- **Server access** goes through e3-api-client under the page's `E3Provider` (`useE3Config`). The editor
  adds no platform functions (the bindings' runtimes and the record runtime already exist), so the two
  hard-coded platform arrays need nothing new.

### 18.2 Styling

- **Slot recipes, registered centrally** in east-ui-components' theme (`theme/slot-recipes/`): `queryEditor`
  (frame, rail, steps column, step card, shape line, bottom bar, collapsed rail, status line, drop target),
  `queryResults` (rail, bars, states, footer) and `jqEditor` (gutter, code, tokens, completions, problems).
  Semantic tokens only; no inline style objects or Chakra style props in the renderers. Once #746's
  theme step lands, each recipe lives in its component's `react/recipe.ts` and is used directly
  (`useSlotRecipe({ recipe })`), not registered in the theme (#746 D6).
- **State reaches styles through data attributes** (`data-mode`, `data-complete`, `data-empty`,
  `data-error`, `data-open`, `data-stale`, and the drag layer's `data-drop-valid` / `data-drop-active`), not
  through computed styles.
- **The only inline values are measured ones:** a popover's anchor position, the code area's width, a tree
  row's indent.
- The mock's px values are the recipe's values; where one sits off the 4px scale or duplicates a
  production component's size (the 26px and 24px in-row icon buttons, the 22px Insert button), the
  component's own size is used and §19 lists it.

### 18.3 Building blocks

| Part | east-ui building block |
|---|---|
| Visual \| jq · Table \| Tree | `SegmentGroup` (the segmented control) |
| Run · the save popover's Save | `Button`, primary: one per surface |
| Save · Saved ▾ · Cancel · Download ▾ · fixes | `Button`, default (a trailing chevron for the menus) |
| Undo · Run again · "Add condition" · "Add group" · "Add a total" · "Add field" | `Button`, link/ghost |
| Copy jq · collapse · move up / down · remove · dismiss | `IconButton` (ghost for in-row controls), each with its `aria-label` |
| The status line's check state and save state | `Status` (dot + mono word) |
| Stale · the error and note bars · the visual and jq notes | `Banner`, in flow beside what it describes |
| Autocomplete · the queries list · the save popover · the download menu | the `popover` / `menu` recipes' chrome, and the `combobox` recipe's list and items for the searchable lists |
| "⌘⏎" · "↑↓ ⏎ esc" | `Kbd` |
| Slots | the `select` trigger (mono for numbers, IDs and dates), with the dashed empty and `--neg` problem states |
| Lookup field chips | the chip with `×` (`--brand-tint`) |
| A jq step's code | the `codeBlock` recipe |
| The idle results | the `emptyState` recipe (mono glyph, bold title, checklist) |
| The running dot | the design system's status-dot pulse |
| Results as a Value tree | `EastChakraValueTree` over `ValueTree.materialize(type, value)`, read-only — as `DatasetPreview` shows a dataset |
| Results as a Table | `EastChakraTable` over a Table value built from the rows (cells as `LiteralValue`s, nested values as their summary text): virtualised, sticky header, 36px rows |
| The Library of data sources | east-ui's `Library` (`EastChakraLibrary`), its cards built from the bindings |
| Dropping a data source in | the drag layer's hooks (`useDragTarget`, `useDropCell` with `canDrop`), stable across #608's dnd-kit rebuild |
| Hover definitions (the shape's East type, a button's shortcut) | `Tooltip` |

### 18.4 Renderer rules

- Every React component is `memo`'d with an `equalFor` comparator; derived values use `useMemo`, handlers
  `useCallback`.
- The editor's value, and the name and count inputs, follow the interactive-state pattern
  (`east-ui-components/CLAUDE.md`): local state from the value, a `useEffect` sync, callbacks through
  `queueMicrotask`, and no side effect inside a state updater.
- Layout preferences persist per viewer with `usePersistedState` (`storageKey`): the column's collapsed
  state. Popovers, drafts and drags are plain state.
- Long lists virtualise: the results' rows, and autocomplete lists over 100 items.

### 18.5 Tests and verification

- Every public export has TypeDoc; every compilable `@example` has an `example()` in the sibling
  `*.examples.tsx`, and the tag and the factory give the same IR.
- Visual verification is a gate: the showcase snapshot of each example is re-rendered and read after every
  change, and a DOM-measurement probe checks this document's dimensions in both themes (#940). No pixel
  goldens.

---

## 19. Deviations from the mock and the brief

Where the brief (`SPEC.md`) and the mock disagree, or where the mock takes a demo shortcut:

| Mock | Product | Why |
|---|---|---|
| The datasets are fixed in the page, and a query can start from any of them | The editor queries only the bound data sources the page hands it (§13) | A component reads what it is bound to; scope is the manifest's |
| Runs evaluate in the page, visual steps only; a jq step can't run ("This mock runs visual steps only; custom jq steps run on the e3 query route.") | Every run goes to the query route, jq steps included | One engine; the route is the product |
| Its own type flow and regex parser stand in for the checker | #875's `checkJq` checks the printed program; the step model maps diagnostics to slots by span and phrases them (§7.2); the projection parses #875's AST | One meaning everywhere |
| The jq step's note says it "is checked on the server" | "Not a visual step: it stays as jq in the visual editor." | The whole program is checked locally |
| After a jq step the shape is unknown ("Shape known after the jq step") | The checker knows it: the status line gives the real shape; steps after a jq step still stay jq | The checker types every program |
| The status line's hover text hard-codes the multiplicity "one" | The checked multiplicity | It is known |
| Completions open after any word character as well as `.` `"` `$` (the brief names only those three) | As the mock | Builtin names complete while typed |
| Quick add says "First N" | "Keep the first" (the brief's list and the card's title) | One name per step |
| Popovers open with the first item active | With the slot's current value active | The value in the slot is the likely answer |
| The Run button's hover text is computed but never shown | "Run · ⌘⏎" / "Running…" | The shortcut is discoverable |
| A computed right-hand status text ("checked as you edit · 5 steps") is never shown | Not shown | The brief's status line has no such text |
| Saved queries live in the browser (`localStorage` `qe-saved-v1`, 20 at most) | A bound record with a patch mutation (§12.2); recent queries stay per viewer | Shared, audited, not lost with a browser |
| "New query on {source}" starts on the current source only | One per bound data source (§13.2) | The keyboard path for a drop |
| The drop target is for chat result cards, over HTML5 drag | For Library cards of the bound sources, over the shared drag layer (§13.3) | One drag system per page; chat is not in #875 |
| The table and tree are the mock's own drawing, column widths estimated from character counts (truncating the DateTime column) | east-ui's Table and ValueTree renderers, read-only | One implementation; the renderers measure |
| The table shows the first 500 rows | The route's first 1 000 outputs (its default), with "{n}+" when truncated; the Table virtualises | The route's limits are the product's |
| Download BEAST2 only shows a note; CSV prints nested values as JSON | BEAST2 saves the route's result blob; CSV cells are East CSV's | BEAST2 everywhere; no JSON |
| Group totals round to cents (sum, mean) | Exact values; the table formats them | Rounding is display |
| Look up offers only text-keyed Dicts and a text key; its hint names customers | Any bound Dict whose key type is a field's type; "Bring in fields from another dataset by key" | The checker decides |
| List every part assumes `.children` | The recursive field of the tree's type (a slot when there is more than one) | Generic trees |
| Try the model's other inputs offer the fixture's regions | A typed value | The fixture is data |
| The shape lines count by re-evaluating each prefix in the page | The run's program counts its stages (`length as $nK`, §11.2) | One run, no route change |
| Summaries evaluate each prefix in the page | The route runs `summarize` over the prefix, cached (§6.4) | One engine |
| Value offers name a customer ID's customer (the fixture's `customers`) | Not named | Nothing generic says which dataset an ID belongs to |
| The source card's description is prose from the page | The source's plain kind ("list of orders") | A binding carries no prose |
| 26px and 24px in-row icon buttons, a 22px Insert button | The `IconButton` and `Button` recipes' small sizes | One size scale |
| The running dot pulses 1 → 0.3 over 1.2 s (`qe-pulse`) | The design system's status-dot pulse | The system's one loop |
| Native `title` attributes for hover text | `Tooltip` for definitions; `aria-label`s on controls | The design system's overlay |

---

## 20. Open questions

- Should a dropped data source also be accepted on a Look up step's dataset slot (replacing it), beyond the
  Insert points?
- Should the Library show a data source's row count for a paged binding before any page has loaded (it
  needs a status read per source)?
- The brief's open questions are about the Elara chat (§14) and wait for that work.
