# Base components — the stdlib recipes

The parts every surface is built from, with exact values. Each recipe
names its production tag in `@elaraai/east-ui` — design to these so a mock
translates 1:1 into East JSX. A part that has a foundation card is drawn
from that card; the recipe here is its spec until then. A part of a
component is named `<Component> · slot` with the slot spelled as east-ui
spells it (`Table · columnHeader`, `Pagination · prevTrigger`); a slot
east-ui doesn't have yet is named here and marked "no east-ui slot".

## Buttons (`<Button>`, `<IconButton>`) — four roles, never invent a fifth

- **Primary** — commits a patch, or confirms in a `<Dialog>` · `--brand-d`
  fill, `--paper` text, hover `--brand-dd` · one per surface
- **Default** — non-destructive route · `--paper` fill, `--rule-strong`
  border, hover `--paper-2`
- **Override** — opens reason-capture · `--ink-3` border / `--ink-2` text
  600, hover `--paper-2` · always offered, never the default
- **Link/ghost** — navigation only · `--brand-d` text, hover `--brand-dd` ·
  trailing `→` if onward

**Sizes** — md 32 (default): 12px inline padding, icon 16 · sm 24: 8px
inline padding, icon 14. Both Inter Tight 12.5px (`--fs-body-sm`),
`--r-md`. sm is only for a 36px band — the eyebrow row, the 36 footer
band — for rows at compact 32 and condensed 28, and for the slice
toolbar's band and its popovers' feet (Toolbar & slice). Comfortable 36 rows
keep the md 32 ghost icon button. Primary and Override are always md.

**Loading** — an action that hasn't answered after `--dur-base` keeps its
label and fill; an 8px live dot in the label's colour (the Status pulse)
takes the leading icon's slot, or leads the label when there is none. The
button is `aria-busy`, takes no hover or clicks, and returns to rest when
the result lands in its surface (a Banner, a Status, the Commit bar
leaving). No spinner, no progress text.

**Commit cluster**: `Override · Modify · Apply`, left→right, increasing
commitment — every commit surface, always this order (trains a motor habit).

**Destructive actions** — there is no red button. The action (a menu item,
a row action) opens a `<Dialog>`; its Primary carries the named verb
(`Archive roster`, `Delete scenario`). `--neg` appears only on the
destructive menu item, as `--neg-text`.

**Icon buttons**: 32×32 (24×24 at sm) with `aria-label` and a Tooltip that
names them, toolbars and row-end only; ghost variant (no border, `--ink-3`,
hover `--paper-3` + `--ink`) for repeated in-row controls. Labelled
icon+text buttons: icon leading, 8px gap; trailing icons only for onward
navigation (arrow) or disclosure (chevron).

## Keyboard (`<Hotkey>`, `<Kbd>`, `<CommandPalette>`)

`⏎` apply/commit · `⌫` clear selection · `esc` discard dirty · `⌥`+drag
duplicate · `⌘ /` search · `⌘ k` command palette · `j`/`k` queue next/prev ·
`[`/`]` page prev/next · `g`/`G` first/last page. No key toggles the
sidebar — its chevron does.

**Kbd** — every key the UI shows is a Kbd cap: in running text, in the
search Input's hint, as a Menu accelerator and inside a Tooltip. Cap 20
tall, min 20 wide, pad 0 4, `--paper-2`, 1px `--rule-strong`, `--r-sm`,
mono 11/500 `--ink-2`, case kept (`g` and `G` are different keys). A chord
is caps 4 apart with no `+`; a pointer step is `+ drag` in mono `--ink-4`;
alternatives take a `/` in `--ink-4`. Inline, the cap centres on the text
line.
**On `--bg-inverse`** (inside a Tooltip) — no fill, 1px
`color-mix(in oklch, var(--fg-inverse) 40%, transparent)` edge,
`--fg-inverse` text; caps 8 after the tooltip text.

## Motion

`--dur-fast` 120ms hover/focus · `--dur-base` 200ms panel/accordion/banner/
Commit bar · `--dur-slow` 360ms run-pulse/diff settle · `--ease-out` for
everything that moves · `--ease-in-out` for state toggles only (switch,
sidebar collapse, disclosure chevrons). Forbidden: springs, bounce,
parallax, scroll-driven. The live pulse (values in README › Motion) is the
whole vocabulary for "in motion": on a Status dot, a node's dot, a map
marker and a loading button.

## Field & forms (`<Field>`, `<Input>`, `<Select>`, …)

- **Field** — three slots: label · input · help, in that order. Label
  carries the schema key beneath it (mono 11px `--ink-4`). Input value
  mono · tabular · right-aligned; units as mono suffix outside the field.
  Help = range, unit, default — inline, never a tooltip. Invalid tints
  `--neg` and replaces help with the error, set in `--neg-text`. Dirty =
  `--brand-tint` fill. Placeholders `--ink-4`; disabled text `--ink-5`.
- **Fieldset** — 2–6 related fields under one mono-uppercase legend;
  cross-field guardrails render as a banner above, never inline. Beyond
  six fields, split or move behind presets.
- **Number input** — only when there's a natural step; steppers disable at
  bound; `⇧`-click = 10× step. Continuous tunables → slider; precise
  floats → plain field.
- **Select** — >4 mutually-exclusive or dynamic options; trigger is mono
  (ids/versions/paths); dirty trigger picks up `--brand-tint`.
- **Radio group** — form choice from a small set; selected mark `--brand-d`.
- **Segmented control** (`<SegmentGroup>`, the SegmentGroup card) —
  view-state toggle (horizon, view-mode): 2–4 options, applies
  immediately, never inside a form. md 32 in toolbars, sm 24 in a 36px
  band. 1px `--rule-strong` box, `--r-md`, options split by 1px
  `--rule-strong`; mono uppercase 600 / 0.16em, 11px at md and 10.5px at
  sm; rest `--ink-4`, hover `--paper-2` + `--ink-2`, active `--brand-tint`
  fill + `--brand-dd` text, focus ring, disabled `--ink-5`.
- **Checkbox** (`<Checkbox>`, the Checkbox card) — 14×14 · 3px radius ·
  `--paper` with 1px `--rule-strong` · hover `--paper-2` · checked =
  `--brand-d` fill with a `--paper` tick, hover `--brand-dd` ·
  indeterminate = `--ink-4` minus 8×2 (the parent affordance) · focus ring
  outside · disabled 1px `--rule`, tick `--ink-5`. A label sits 8 after
  it, Inter Tight 13 `--ink`. In a collection it leads the row in a 46px
  column (20 + 14 + 12); `⇧`-click selects a range.
- **Search input** (`<Input>` · search, the Input card) — 240 × 32 in a
  form, dialog or panel, `--paper`, 1px `--rule-strong`, `--r-md`, pad 0 12, gap 8:
  `fa-magnifying-glass` 14 `--ink-4`, query 13 `--ink`, placeholder
  `--ink-4`, the `⌘ /` Kbd hint at the end while empty and unfocused.
  Hover `--paper-2`, focus ring (hint hidden), filled shows a `×` clear
  (mono 13 `--ink-3`), disabled 1px `--rule` + `--ink-5`. Never tinted: a
  query is not a dirty value. A collection's toolbar never holds it: there
  the slice rail's search pill takes its place (Toolbar & slice).
- **Switch** — persistent boolean that changes behaviour immediately;
  track `--brand-d` on / `--rule-strong` off (never red).
- **Slider** — never the only control: pair with typed input + tabular
  readout right. Range slider for bounded pairs (cap, band).
- **Tags input** (`<TagsInput>`) — set-valued entry; each value a brand
  chip with trailing `×`; `⏎` commits, `⌫` on empty deletes last;
  paste-comma splits; de-dupes silently.
- **Editable** — the only inline rename: dashed underline + pen in
  preview; `⏎` commits, `esc` discards; renames are journaled.

## Collection density

Collections name their densities as the app bar does: **comfortable**
(default), **compact**, **condensed** — east-ui's `density` cascade. A
collection shows one density throughout, set once for the surface.

- **Rows** — every row collection (`<Table>`, `<DataList>`, `<TreeView>`,
  `<ValueTree>`, and the list layout of `<Board>`, `<Deck>`, `<Library>`,
  `<Roster>`) offers all three: comfortable 36 · compact 32 · condensed
  28, rule included, header row the same height. Text 13 and header 10 at
  every density; cells pad 0 12, first and last take the Frame's padding.
  Parts per row height: comfortable holds avatar 24, chip 22, count 16,
  ghost icon button 32; compact and condensed hold avatar 20, chip 15,
  count 15, ghost icon button sm 24. Checkbox 14 and DeltaPill 20 at all
  three. Touch keeps comfortable.
- **Sheet** (`<Sheet>`) — one size: 32px cells, pad 0 8. It is a gridded
  editor, ruled on all four sides, and its cell is the Input's 32 box.
- **Chip rail** — comfortable 22 / 10px (default) · compact 15 / 9.5px ·
  large 34 / 11px, the touch size.

## Chips, Tags & the chip rail (`<ChipRail>`, `<Tag>`)

Chips are clickable filters/cohorts/segments — `--r-sm`; active =
`--brand-tint` fill + `--brand-dd` text; hover one paper step; dashed = the
trailing "+ add" empty slot; operator-set chips carry `×`. Trust chips are
read-only attribution (dot + label + meta), never filters. A `<ChipRail>` is
ONE dimension family per line; labeled mode stacks a mono uppercase caption
above each chip when the bare value is ambiguous. The slice rail is not a
`<ChipRail>`: it holds several families in one folding cluster and draws
east-ui's `chip` recipe (Toolbar & slice).
Densities (single knob, never mixed in a rail): comfortable 22px / 10px
(default) · compact 15px / 9.5px · large 34px / 11px (touch).

**Tag** (`<Tag>`) — a named fact, read-only: not clickable, not a filter,
not a status. 20 tall, pad 0 8, `--paper-3`, 1px `--rule`, `--r-sm`, mono
10/500 `--ink-3`. On a selected row its fill turns `--paper`, as the
Count's does.

## Toolbar & slice (`<Toolbar>`, `Slice.*`, `Pick.Panel`)

One shared toolbar row hosts the slice affordances wherever a collection
narrows: the Table, Deck, Library, Schematic and Chart eyebrows, the
Flowchart header, the Plan and Sheet toolbars, and the e3 decision queue's
header. Every component review composes it from the cards in Parts ·
Toolbar & slice: Toolbar, Slice affordances, Slice edit, Horizon brush,
Slice summary & legend, History bar, Pick panel. Anatomy, copy, geometry
and behaviour are east-ui's (branch `elaraai/feat/plan-epic-808`); colour
and type are East tokens. Where east-ui breaks a rule in this file or in
`component-rules.md`, the card draws the rule and the difference is an
engineering change. The cards also draw an improvement pass, each item
marked (proposed) on its card and listed in Toolbar & slice: proposed
changes, below; until an item lands, the values in this section stay
east-ui's.

**The row** (`toolbar` recipe) — one flex row: nowrap, never scrolls,
clips horizontally only, with 3px of clip room at each end so focus rings
show. It takes its width from its container, never its content. Items are
`flex: none`; the first end item takes the slack. Gap md 10 (the Plan) · lg
12 (every other host). Overlays float over the page: the band never
changes height.

**Bands** — eyebrow (`frameEyebrow`: Table, Deck, Library, Chart,
Schematic) ≥ 44, pad 8 12, `--paper`, hairline `--rule` below; Table, Deck
and Library add the 38 footer · the Flowchart's own 44 eyebrow, its search
capped at 128 · the Plan ≥ 44, pad 0 12, gap md, then the horizon 38, the
ruler 28 · the Sheet pad 8 20, gap 12 (46 with its 30 tabs) · the decision
queue: the rail right-aligned in its header row · a standalone `Slice.Rail`
has no band: its row, the brush, the legend, 6 apart.

**Fold** — every item has forms, widest first, and a rank for each step
between two forms. All steps merge into one sequence by rank, ties in row
order; an item's own steps keep their order (a lower-ranked later step
waits). The row renders the fewest steps that fit, tolerance 0.5; fully
folded and still too wide, it clips at its end. Widths are measured per
form and kept until the item's version changes; a width change resolves
before paint, with no animation. An item with one form never folds. A
**held** item (its trigger `data-state=open`, or the Sheet's strip while a
tab is renamed) keeps its form and the rest of the row folds around it.

| Rank | Step |
|---|---|
| 0 | a filter clause chip goes into `+N more`, trailing first, one per step |
| 1 · 2 · 3 · 4 · 5 | search · range · cohort and presets (and any unlisted kind) · breakdown · filter collapse to their summary chips |
| 6 | the folded chips merge into one terminal chip |
| 7 | the icon alone, with its caret |
| 10 · 11 · 12 · 13 | Plan: the summary shortens · resolution folds to its menu · grain folds to its menu · the summary hides |
| 10 … 15 | Sheet: tabs into `+n`, one per step, the active tab kept (10) · the count line goes (11) · the context label drops (12) · the strip goes compact (13), then capped at 72 (14) · the strip closes, then the context switch goes (15) |

Host items start at `HOST_RANK` 10; an item with no rank takes 100. A
cluster of one affordance has no terminal chip and no icon: its floor is
its summary chip and caret (the Plan's range cluster at Range, the Sheet's
default rail at Search). Series, the history bar, key search, diagnostics
and the paged badge never fold.

**Rail chip** (east-ui `chip`, not the `<ChipRail>` chip) — 22, pad 0 10,
gap 6, 1px `--rule-strong`, `--r-sm`, `--paper`, Inter Tight 12.5/500
`--ink-2`. Numeric: mono 11. Caps: mono 10.5/600/0.1em, a control's own
label (`+ FILTER`, `+ DIMENSION`, `+ COHORT`). Tones: neutral · brand
(`--brand-tint`, 1px `--brand-d`, `--brand-dd`) · dashed (`--ink-4`) · more
(1px `--brand-d`, 600). Parts: icon 10, caret 8, meta `--ink-3`. Hover one
paper step; a brand chip keeps its tint and its edge goes `--brand-dd`.
Every chip and trigger is a button and takes `--shadow-focus`; segments,
tabs and context options take the inset ring. One caret everywhere:
`fa-chevron-down` 8 in its part's ink, `--ink-4` after a trigger. Every part
that sits in the row is `--r-sm`: chips, the search pill, the seg strip,
the context switch, `+ TAB`, the badge; buttons (sm 24) and the edit
popover are `--r-md`. No chip has a disabled look: an unavailable part is
hidden.

**Affordances** — ten kinds: `filter`, `search`, `breakdown`, `range`,
`cohort`, `brush`, `presets`, `legend`, `resolution`, `summary`. Key search
(`seek`), the paged badge (`scope`, `badge`) and compare are not kinds. A
live slot is the family icon (14 wide, 10 `--ink-4`, tooltip the family
label) and its control, 6 apart; slots 12 apart. Densities: compact (the
rail) · focused (standalone) · editor (the sectioned editor).

- **filter** — clauses `{fieldId} {glyph} {value}` as brand numeric chips
  with `×`, then `+N more`, then `+ FILTER`. Folded: `Filter`, `N filters`.
- **search** — the pill: 28, 200–480, mono 11, `/` hint, no magnifier
  inside. Folded: `Search`, `"query"`. On a paged source that declares
  `seek`, key search replaces it: a 26 combobox, `N matches`, `k of n`,
  Previous / Next match.
- **range** — one numeric chip (`All time`, or `JUN 29 – SEP 20` + `84d`),
  the seg strip beside it when it has resolutions. Folded: `Range`.
- **cohort** · **presets** — dot, name, count (and the pencil in manage
  mode), `+ COHORT`; standalone first, then each family as a captioned run.
  OR within a family, AND across families. Folded: `name`, `name +N`,
  `a · b`, `N cohorts`.
- **breakdown** — `+ DIMENSION`, or `Site ×`. Folded: `Split`, its label.
- **summary**, **brush**, **legend** — never rail chips: Slice.Summary,
  the brush strip and Slice.Legend sit under the row. `resolution` is the
  Plan's strip or `Slice.Range`'s, never the rail's.

The terminal chip names its families, active first: the first two joined
" · ", the rest `+N` (`3 filters · Split +2`); `Slice` when empty; brand
if any is active; never "narrow". The icon floor's Tooltip names them all.

**Paged badge** — one form on every host: `loaded rows only` in capitals,
20, pad 0 6, `--paper-3`, `--r-sm`, mono 9.5/600/0.1em `--ink-4`, straight
after the cluster it qualifies. Shown while the source is paged and not
exhausted and the row narrows or counts loaded rows. The Plan's narrow row
says `~N` in its tab counts instead.

**Editing** — every folded trigger opens the sectioned editor (`Narrowing
· N active`, lg): every family of its cluster, flat, nothing folded; a
nested editor opens inline, never as a popover on a popover.
SliceEditPopover: `--paper`, 1px `--rule-strong`, `--r-md`, no shadow, sm
320 · lg 380, 12 arrow; head mono 10.5/600/0.04em with `×`; body pad 12
14, 50vh (flush 0); foot `--paper-2`, a link left, Default sm 24 actions
right, never a Primary. Presets, compare, resolution, picks, typing, `×`,
Clear all, toggles, the legend and the brush apply at once; Add, Apply and
Save wait for their button.

**Plan** — start: the cluster (cohort · filter · search), `scope`, `seek`,
the grain strip `GROUP · RESOURCE`, the range cluster, the resolution strip
`WEEK · DAY`, diagnostics (≤ 360, truncated); end: the summary, Series
(Default sm 24), the history bar. Under 480 wide there is no band: one
wrapping row, gap 8, pad 10 12 8, of the rail as one cluster (range
included), the resolution menu, diagnostics and history. **Sheet** —
start: the view tabs, the context switch (`CONTEXT none ± 1 ± 3`), the
count line; end: `seek`, the rail (default `search`), the badge, history.

**Hosts and what they take**

| Host | Clusters | Takes | Refuses |
|---|---|---|---|
| Table, Schematic, Flowchart | one | filter, search, range, cohort, presets, breakdown | brush; legend, resolution and summary draw nothing there |
| Deck, Library | one | filter, search, range, cohort, presets | brush, legend, breakdown |
| Chart | one | as the Table, plus legend under the chart while a breakdown is active | the brush strip (the chart brushes its own x axis) |
| Plan | two: narrowing, range | cohort, filter, search, presets, breakdown, range, resolution, brush (the horizon), summary | legend |
| Sheet | one | search (default), filter, cohort, presets, range | brush, legend, breakdown |
| Decision queue (e3-ui) | one, right-aligned | as the Table | brush |
| `Slice.Rail` | one | every kind; brush and legend under the row | resolution (only through `Slice.Range`) |

Never list a kind a host refuses: the rail leaves an empty slot and its
folded chip reads the raw kind name.

### Toolbar & slice: proposed changes

The improvement pass over the seven cards, as engineer changes: current
(what the cards drew from east-ui) → target (what they draw now), then the
reason. The architecture stays: one band per host that never wraps or
scrolls, the one fold ladder and its ranks, the terminal chip and the icon
floor, the sectioned editor with nested editors as inline disclosures, the
horizon as a slice affordance, and the host table above.

**Open behaviours**

- **One count** — `Narrowing · N active` counts the breakdown, Slice.Summary's K doesn't, and the Plan's summary says "3 filters" → a narrowing is the range, a filter clause, an active cohort or the search: exactly what Clear all resets. The breakdown is a split and is never counted. Slice.Summary counts the slice; the editor head counts the narrowings in its own sections (the same number on every one-cluster host; on the Plan the range cluster shows as its brand chip); the Plan's summary reads `K narrowings`; the icon floor carries the same count. Reason: two numbers for one thing, and a head should count what sits under it.
- **Compare** — in every Range editor, visible nowhere else, cleared by a Clear compare link → only on a datetime range and only on hosts that draw a comparison; while set, the range chip's meta says `· vs prev period` or `· vs prev year`; the resolve line adds `Compared with Apr 6 – Jun 28, 2026`; `— none` → `None`, which is how it clears (no Clear compare). Reason: a live state the band never showed, and a numeric range has no previous period.
- **Save as cohort** — only in the `N active filters` foot, reached only through `+N more`, only with two or more filters → from one filter, wherever the cluster manages cohorts: that foot, the sectioned editor's foot, and New cohort's `Start from the N current filters →`, which copies the clauses into the draft (Apply moves them out of the filter into the cohort). Reason: with the row unfolded there was no route to it at all.

**Off rows** (Slice.Legend, the Series panel)

- Opacity .5 (hidden), .55 (unselected in filter mode, swatch .45), the whole Series row .5 → no opacity: label and value `--ink-4` 500 (from `--ink` 600 and `--ink-3`), the swatch `--ink-5` (the muted mark), `fa-eye-slash` `--ink-4`; a Series row's kind icon and subtitle `--ink-4`. Reason: .5 put the text under 4.5:1; `--ink-4` holds 5.2 / 4.9 / 4.7:1 on `--paper` / -2 / -3 in light and 6.5 / 5.5 / 4.6:1 in dark, and weight, ink, the grey swatch and the eye still say off at a glance.

**Toolbar**

- **Band** — eyebrow ≥ 44 pad 8 12 · Plan ≥ 44 pad 0 12 · Sheet pad 8 20 (46) → every host 44, pad 0 + the Frame's padding (20 in Main, 12 in the rail). Reason: the row starts on the first column's and the lane names' edge (component-rules §3); one band on every host.
- **Row gap** — the Plan's md 10 → 12, as every host. Reason: the 4px scale.
- **Sheet tabs** — 30 tall in a 46 band, mono 10.5/600/0.12em, pad 0 2, gap 7 → the Tabs part, 11/600/0.16em, at the band's full height with the underline on its hairline; pad 0 4, gap 8; hover `--paper-2` + `--ink-2`; focus inset, kept with the underline. Reason: the Tabs part; the underline should mark the sheet beneath.
- **Tab ×** — on every tab → visible on the active, hovered and focused tab; its 14 box always kept. Reason: noise; hover never re-folds.
- **`+ TAB`** — solid 22, mono 9.5 → the dashed caps chip (`+ FILTER`'s), a 22 square when compact. Reason: one add affordance.
- **Context switch** — a hand-built 22 strip of tinted pills → SegmentGroup sm 24 after a `CONTEXT` caption (mono 10/600/0.14em), the caption being what drops at rank 12. Reason: view modes → SegmentGroup (component-rules §5).
- **Grain and resolution strips** — 25, pad 5 11, mono 10/600/0.1em, `--rule` splits, `--r-sm` → SegmentGroup sm 24: pad 0 8, mono 10.5/600/0.16em, `--rule-strong` splits, `--r-md`, the outside focus ring, disabled `--ink-5`; folded, the caps chip. Supersedes the earlier 6 → 4 radius change. Reason: the SegmentGroup card.
- **Plan summary, Sheet count line** — mono 10/600/0.1em caps `--ink-4`, and mono 10.5 `--ink-4` → Slice.Summary's voice: mono 10.5 `--ink-3`, tabular, the counts 600 `--ink`, sentence case. Reason: caps numerals at 10 read slowly; one voice for every count.
- **Paged badge** — 20, pad 0 6, `--paper-3`, mono 9.5/600/0.1em caps `--ink-4` → the Tag with a dashed edge: 20, pad 0 8, `--paper-3`, 1px dashed `--rule-strong`, mono 10/500 `--ink-3`, `Loaded rows only`, and a Tooltip with the n. Reason: a named fact is a Tag; dashed means partial; `--ink-3` at 10 reads.
- **Loading** — none → past `--dur-base`, the Loading Status takes the slot of the count it will change (the Plan's summary, the Sheet's count line, Slice.Summary's N of M), held at that count's width. Reason: a slice change had no in-flight state; nothing re-folds.
- **Open trigger** — the hover look → `--paper-3`; a brand chip keeps its tint with a `--brand-dd` edge; the caret turns up, 180° over `--dur-fast` `--ease-in-out`. Reason: open is pressed, not hover; disclosure chevrons toggle (Motion).
- **Icon floor** — the icon alone → the icon and the narrowing count, mono 11, while any is set. Reason: the brand tone says something is active, not how much.
- **Flowchart search** — capped at 128 → the pill's 200. Reason: one pill; the fold makes the room.
- **Narrow Plan row** — pad 10 12 8 → 8 12, and the history bar pinned to the end of the last line. Reason: the 4px scale; the session controls keep one place.
- **Touch** — none → on a coarse pointer: band 56, chips at the ChipRail's large 34 (pad 0 12, gap 8), × and pencil 34 squares, the pill, segments and buttons 44 (the history bar already grows). Reason: 44 targets; the fold absorbs the width.

**Slice affordances**

- **Rail chip** — pad 0 10, gap 6 → pad 0 8, gap 4 (the ChipRail chip's); clauses 6 → 8 apart; family icon → control 6 → 4; summary chips in a trigger 6 → 4. Reason: the 4px scale.
- **Chip type** — the breakdown chip Inter Tight 12.5 → mono 11, as every rail chip. Reason: one chip voice.
- **× and pencil** — glyph-sized targets → the chip's full height, 20 wide through its end pad. Reason: target size.
- **Search pill** — `--r-sm` → `--r-md` (an Input); placeholder `--ink-3` → `--ink-4`; the `/` hint (16, 1px `--rule`, mono 9.5/600 `--ink-3`) → the Kbd cap (20, `--paper-2`, 1px `--rule-strong`, mono 11/500 `--ink-2`), hidden on focus; pad 0 10 → 0 4 0 12. Reason: the Input and Kbd parts.
- **Key search** — 26, `--r-sm` → 28, `--r-md`, pad 0 12. Reason: one text-field height and radius in the row.
- **Dates** — `JUN 29 – SEP 20` in capitals, clauses `01/07/2026`, the resolve line in capitals → one display form, `Jun 29 – Sep 20` (the axis's), with the year once a span leaves the current one and in the resolve line; fields keep the locale's numeric date. Reason: four formats become one; capitals read slower; numeric dates are ambiguous.
- **Cohort dot** — seven colours (`--brand-d`, `--brand-dd`, `--warn`, `--info`, `--ink-4`, `--ink-5`, `--rule-strong`, the last also meaning off) → on or off only: 8 `--brand-d` on, a 1px `--ink-4` ring off. Reason: valence tokens aren't identities; `--brand-d` and `--brand-dd` can't be told apart as dots; the seventh read as off; the ring holds 3:1.
- **Family captions** — mono 11/600/0.18em → 10/600/0.14em, the section captions' voice (Slice edit).
- **Search dropdown** — no loading state → three Skeleton rows past `--dur-base`.
- **Editor-density search** — the rail pill → the Search Input, 32.

**Slice edit**

- **Chrome** — head pad 10 14, body 12 14, foot 10 14 → head and foot 8 12, body 12; sm 320 · lg 380 → the Popover's md 320 · lg 360; never wider than the viewport less 12 each side. Reason: the 4px scale; one set of popover widths; narrow screens.
- **Head ×** — 22, `--ink` → the ghost icon button sm 24 (`--ink-3`, hover `--paper-3` + `--ink`).
- **Section captions** — mono 11/600/0.18em → 10/600/0.14em. Reason: they outranked the popover's own 10.5 head.
- **Fields** — 26 → the Input's 32, mono 13/500 for ids and numbers, tags as 22 brand chips. Reason: the Field and Input parts.
- **Actions** — Add filter's body Add + foot Done, Edit's body Apply + foot Cancel, the disclosure's body Apply + Cancel → one row per editor, in its foot: Cancel · Add, Cancel · Apply. The cohort builder's clause Add stays in the body at md 32. Reason: sm 24 only in feet (component-rules §4); no duplicate closers.
- **Edit · {fieldId}** — the locked field repeated as a `--brand-dd` label → dropped; the head names it. Reason: brand means interactive.
- **Hints** — all mono 10 `--ink-3` → missing input stays help; invalid input (a start after its end, a non-whole number) is the Field's error: 1px `--neg` edge, `--neg-text`. Reason: Field › invalid.
- **Range presets** — Inter Tight 12.5 → the rail chip, mono 11. Reason: numerals are mono.
- **Split by** — link-style names 12 apart and a Done foot → a flush list of Menu items (32, pad 0 12, hover `--paper-2`, focus inset, the current dimension checked `--brand-d`), no foot. Reason: Links are navigation only; a pick applies and closes.
- **Remove cohort** — a `--neg-text` foot link → a Default sm 24 `Remove cohort…` that opens the Dialog. Reason: destructive → Dialog; `--neg` only on a destructive menu item.
- **Row ×** — a 20 glyph in `N active filters` and the cohort clause boxes → the ghost icon button sm 24, in 32 rows. Reason: target size.
- **Saving** — none → Save, Apply and Add take the Button's loading form past `--dur-base`.
- **Foot link** — mono 11 → the Link, Inter Tight 12.5/500 `--brand-d`. Reason: the foot's buttons are Inter Tight; the Link part.

**Horizon brush**

- **Window** — `--ink` 4% masks outside it → a `--brand-tint` band at 0.7 over the window (the chart band), no masks. Reason: in dark the `--ink` wash lifted the outside, so the unselected span read as the lit one.
- **Now** — 1.5, `--brand-d` at 80% → the Plan's nowLine, 1px `--brand-d`.
- **Axis** — mono 9.5 `--ink-3`, 2 below → the chart axis, mono 10/500 `--ink-4`, 4 below; the rail stack 6 → 8 apart. Reason: charts.md; the 4px scale.
- **Ruler** — a 28 ruler under the horizon, lane names and gutter at 12 → the Plan's 48 time axis (context 24 + ticks 24), the gutter caption and lane names at 20, the caption tracked 0.12em → 0.1em so `HORIZON · 26 WK` fits the 128 gutter. Reason: the Time axis card; first cell pad 20.
- **Handles** — zone 10 → 12; on a coarse pointer, tracks 44 and zones 24.
- **Keyboard** — none → each handle a slider (← → one bucket, one period on the Plan; ⇧ ten; Home, End; Esc clears), the window a third stop that moves both; `--shadow-focus` on a handle, the inset ring on the window.
- **Loading** — none → the 18 baseline form until the counts land, gestures live.

**Slice summary & legend**

- **Footer** — 38, pad 0 14 → the Footer band's 36, pad 0 20. Reason: the Footer band; the Frame's padding edge.
- **Footer copy** — `1,204 rows · of 3,480`, `14 nodes · narrowed from 22 ·`, `SHOWING 1,204 OF 3,480 SHIFTS` → one order and voice, `N of M noun` (1,204 of 3,480 rows · 36 of 120 cards · 14 of 22 nodes), no trailing separator.
- **Narrowed share** — 600 `--pos-text` → `--ink-3`. Reason: a narrowing has no valence.
- **Paged footer** — `Loading…` → the Loading Status.
- **Legend items** — no hover or focus → 20, pad 0 4, `--r-sm`, 8 apart: hover `--paper-2`, focus `--shadow-focus`; selected in filter mode `--brand-tint` + `--brand-dd` + a 10 funnel; the legend's pad 8 14 → 8 16, so the first swatch sits on the Frame's edge. Reason: they are buttons; an active control is tinted.

**History bar**

- **Messages** — a mono 11 status sentence before the buttons, and an error line that grows the band → no sentence in the band: stale, unknown outcome, rejected and conflict each raise the Banner band under the toolbar (stale; guard `Unconfirmed`; error `Rejected`, `Conflict`, the latest error joining the message); reconciling shows the Loading Status; applying shows only Apply's loading form. Reason: the band never changes height; the row keeps its width for the slice; Banner is the in-flow notice.
- **Buttons** — five Default icon squares (a hidden issues slot, Undo, Redo, Discard ×, Apply ✓ in `--pos`) → Undo and Redo ghost icon sm 24, Discard a Default icon `fa-trash-can`, Apply a labelled Default sm 24, at the same width; Retry request and Retry refresh (`fa-rotate`) → `Retry`, the aria-label keeping which. Reason: the commit reads as a word; × read as close; the check isn't a state icon.
- **Issues** — icon-only in a reserved 24 slot → icon + count (mono 11/600), only while there are issues.
- **Applying** — everything disabled, aria-busy only → Apply's loading form; Undo, Redo and Discard disabled.
- **Discard** — immediate → the Dialog (`Can't be undone` · `Discard N draft changes?` · Cancel + `Discard changes`). Reason: it clears the drafts and the history (component-rules §4).

**Pick panel**

- **Series button** — `fa-layer-group`, Split's family icon in the same row → `fa-eye`; `4 of 7` meta while any series is hidden; open `--paper-2` → `--paper-3`.
- **Rows** — hover `--paper-3` → `--paper-2` (`--paper-3` on a row means selected); focus the inset ring, ↑ ↓ move, Space toggles; pad 8 14 → 8 12, at least 44; eye 9 → 12 in a 14 slot.
- **Search** — the rail pill with a magnifier inside → the Search Input, 32.
- **Show all** — none → a foot `Show all` (Default sm 24) while any series is hidden.

**Drawing fix** — the cards' Tooltip gains the Tooltip card's 1px `--rule-strong` edge.

## Avatar (`<Avatar>`, `<AvatarGroup>`)

Initials only — no photo, no colour per person. `--r-full`, `--paper-3`,
1px `--rule-strong`, two initials mono 600 uppercase `--ink-2`. Sizes 20
(compact and condensed rows) · 24 (rows, cards, default) · 32 (popovers,
journal heads), initials 9.5 / 10 / 11. Beside a name: gap 8, name
Inter Tight 13 `--ink`. Group: three avatars 4 apart, never overlapped,
then a `+N` overflow on `--paper`, `--ink-3`. Unassigned: 1px dashed ring,
no fill, "Unassigned" in `--ink-4`.

## Tables (`<Table>`)

Rows at the collection density (comfortable 36 default · compact 32 ·
condensed 28, rule included) · content vertically centred · **12px
horizontal cell padding**, except the first and last cells, which take the
Frame's padding (20px in Main, 12px in the rail) so the first column lines
up with the eyebrow · ruled top-only. Hover `--paper-2`; selected
`--paper-3`, unchanged on hover; the focused cell or row takes the inset
focus ring (`--shadow-focus-inset`). Numeric columns tabular right-aligned;
identifiers left; status = dot + word. One selected row per surface unless
explicitly multi-select (leading checkbox column + batch bar). Inside a
Frame the table runs edge to edge.

Parts, top to bottom (cards: Batch bar, Header cell, Row, Cell
types, Summary rows, Footer band & Pagination, Row-level states; the
eyebrow band is Parts · Toolbar & slice):

- **eyebrow band** (`frameEyebrow`) — the slice rail as one toolbar row,
  ≥ 44, pad 8 12, `--paper`, hairline `--rule` below; it folds, never wraps
  (Toolbar & slice). The Table adds the 38 footer (`frameFooter`).
- **`batchBar`** (no east-ui slot) — takes the eyebrow band in place
  while ≥ 1 row is selected, at its 44: `--paper-3`, pad 0 12, `×` clear,
  "N selected of T", the selected keys, Default buttons in increasing
  commitment. `⌫` clears and the rail returns as it was.
- **`columnHeader`** — mono 10/600/0.16em uppercase `--ink-4`, sticky
  under the eyebrow on `--paper` with its own bottom rule while stuck;
  sort glyph ▲/▼ (before the label in right-aligned columns); hover
  `--paper-2`, sorted `--ink`, focus inset ring; resize handle 1 × 16
  `--rule-strong`.
- **`groupHead`** (`groupHeadCell`, `groupHeadAggregate`) — a row on
  `--paper`: chevron, key mono 10/600 caps `--ink`, Count, aggregates mono
  600 in their columns; hover `--paper-2`. One level; a second is a Tree.
- **`footer`** — east-ui's total row: `--paper-2`, top 1px `--rule`,
  non-interactive, function word mono 9.5 `--ink-4` before each mono
  13/600 value; sticks to the bottom of a scrolling body.
- **Footer band** — the Frame's footer (`<Card>` footer) under the table,
  holding `<Pagination>`: "Showing N–M of T" on the left, per-page stepper
  and page buttons right, 24 apart.

Lists >50 rows paginate — never infinite scroll, it kills attribution and
counters. **Pagination** sizes pair with their band: sm 24 in a 36 band
(tables and lists, the default) · md 32 in a 48 band (under card grids and
boards) · lg 40 in a 56 band (touch). Variants outline (default) and
subtle; current page `--brand-tint` + `--brand-dd` 600.

## Numbers & absent values (`<Numeric>`, `<Stat>`)

Every numeral mono, tabular, 500 (`.num`), `--ink`; large 26/600
(`.num-lg`); unit suffix mono 10.5/500 `--ink-4`, gap 4; true minus;
thousands comma; numeric cells right-aligned with the unit in the header.

**Absent values** — one rule everywhere: the value is said in words, never
a dash, a blank, a zero or "N/A". "no data" when the source has no value;
when the value can't exist yet, the reason in two words at most ("not
started"). Mono italic 400 `--ink-4`, in the value's alignment, at the
value's size — 13 in cells, rows and lists; 14 in a Stat, holding the 26px
line; 10 in a heat cell. A ValueTree `null` is the literal `null` in the
same style. A slot an item doesn't have (a card with no metric) collapses;
a person who is missing is the unassigned Avatar.

## Breadcrumb (`<Breadcrumb>`)

Part of the app bar, never freestanding. Ancestors only: every crumb is a
link to a page above the current one, from the workspace root down to the
immediate parent — mono 11px / .06em (10.5px in compact and condensed),
`--ink-3` 500. The current page is never a crumb; the title names it. `/`
separator `--ink-4` (never a chevron); trailing run anchor (`| run #42`)
pins to a trust stamp. Depth, overflow and per-density rules:
`app-layout.md` › Nested pages.

## Tabs (`<Tabs>`)

Underline style only — no pill-tabs, no boxed-tabs. Mono uppercase 11px /
600 / 0.16em; active = `--ink` text + 2px `--ink` underline; inactive
`--ink-4`. Tabs partition views of the same data — never navigation (that's
the sidebar). Counts are bare mono numerals after the label — no chip, no
pill.

## Status, counts & progress (`<Status>`, `<Badge>`, `<MetricChip>`, `<Progress>`, `<Skeleton>`)

- **Status** is dot + word — never a pill or a tinted badge. The dot takes
  the valence colour; a word set in valence takes its text step.
- **Count** (`<Badge>`) — a `--paper-3` chip at `--r-sm` holding mono
  tabular numerals at label size; `--paper` on a selected row. Nothing
  pill-shaped.
- **NEW** — the count's shape on `--brand-d` with `--paper` text.
- **DeltaPill** (`<MetricChip>` · tone positive | negative | neutral) — the
  change indicator: 20 tall, pad 0 4, gap 4, mono tabular 10.5/600,
  `--r-sm`. ▲/▼ + delta in `--pos-text`/`--neg-text` on a 6% wash of
  `--pos`/`--neg`; colour follows valence, the glyph follows direction (a
  rising cost is ▲ in `--neg-text`). **Flat** (tone neutral): `→ 0.0%`,
  `--ink-3` on `--paper-3`, `--paper` on a selected row. The text steps
  hold 4.5:1 on their wash over every paper and `--brand-tint`, so a
  DeltaPill needs no change in a selected or dirty row. A pill in name
  only.
- **Progress** — bars 6px, square-ended (a radius on 6px is a pill),
  `--brand-d` running / `--pos` complete / `--neg` failed on a `--paper-3`
  track (outline variant: 1px `--rule-strong` track on `--paper-2`
  bands), always paired with a mono 11/600 percent right-aligned in 32. A
  run of unknown length has no bar: the live Status + elapsed time.
- **Loading** (`<Skeleton>`, the Skeleton and Row-level states cards) —
  static `--paper-3` shapes in the final layout, shown after `--dur-base`:
  text bars 8 / 12 / 24 tall, rects at the part's footprint and radius,
  circles for avatars. Labels, headers and units stay real; the Loading
  Status in the eyebrow carries the pulse. No shimmer.

## Overlays (`<Tooltip>`, `<Popover>`, `<HoverCard>`, `<Menu>`, `<Dialog>`)

No overlay casts a shadow; each separates from the page with a 1px
`--rule-strong` edge.

- **Tooltip** — text only: a definition, a formula, an n, or the name of
  an icon-only control (the collapsed sidebar, icon buttons), with its
  shortcut as Kbd caps on `--bg-inverse`. Affordance is a 14px `ⓘ` ring in
  `--ink-4`, never coloured. `--bg-inverse` fill, `--fg-inverse` text,
  mono 11/1.5, pad 8/12, max 240, `--r-md`, no arrow; above and centred 4
  from the trigger (beside it for side controls); after 400ms hover, at
  once on focus. Never a field's help text.
- **Popover/HoverCard** — structured content, links, actions; same chrome
  as Menu (`--paper` · 1px `--rule-strong` · `--r-md` · no shadow) + 12px
  arrow. Widths xs 240 · sm 280 (default; the map's overlay card) · md 320
  · lg 360; the slice editor's own sm 320 · lg 380 (Toolbar & slice).
  Sections pad 12 split by 1px `--rule`; body is the key/value
  part. Links and Default actions, never a Primary. Trust chip → full
  stamp is the canonical popover.
- **Menu** — secondary/tertiary actions; kebab trigger (`fa-ellipsis`, the
  ghost icon button); 200–280 wide; group headers mono 9.5/600 caps; items
  32, pad 0 12; accelerators are Kbd caps, right-aligned, 24 clear of the
  label; a disabled item's reason sits in the accelerator slot in mono
  `--ink-4`; destructive items in `--neg-text` at the bottom after a
  hairline, no accelerator, each opening a `<Dialog>`.
- **Dialog** — the ONLY modal, and a confirmation step, not a commit
  surface: it confirms an irreversible or destructive action started
  elsewhere (publish, archive, delete) and never holds fields, edits or
  the `Override · Modify · Apply` cluster. `--paper` · 1px `--rule-strong`
  · `--r-lg` · no shadow. Mono eyebrow naming the irreversibility · DM
  Sans 20px title (`--fs-title-lg`) · concrete consequence in human terms
  · exactly Cancel (Default) + Primary carrying the named verb. No close-X.
  **Toast is forbidden** — transient feedback is a Banner in the
  originating surface. Drawer is only the rail's presentation at ≤560px.
- **Accordion** — long Configure surfaces only; headers carry eyebrow +
  field count + dirty count right-aligned mono; never auto-collapse on save.

## Grids, boards & time (`<Sheet>`, `<Board>`, `<Plan>`, `<Matrix>`, `<Calendar>`)

- **Sheet cell** (`<Sheet>` · cell) — 32 tall, pad 0 8, 1px `--rule` grid;
  header 24 mono 10/600/0.16em, row gutter 32 mono 10/500. Values mono
  13/500 tabular right (date, number, currency, percent); text Inter Tight
  13 and identifiers mono, left; enum text + `▾` `--ink-4`; boolean a
  centred Checkbox. Hover `--paper-2` · selected `--paper-3`, the active
  cell adds the inset ring · editing `--paper` + ring + 1px `--ink` caret
  · dirty `--brand-tint` + `--brand-dd` · invalid 6% `--neg` wash, 1px
  `--neg` inset, `circle-exclamation`, `--neg-text` · linked `fa-link` 14
  `--ink-4` · proposed 1px dashed `--brand-d`, value `--brand-d`.
  Selection edge 1px `--ink`; fill handle 8 × 8 `--ink` with a 1px
  `--paper` edge; fill extent 1px dashed `--ink`, preview `--ink-3`. A
  cell nobody has entered is empty; a null from the source reads "no data".
- **Board column** (`<Board>` column, header `headerCell`) — 272 wide,
  `--paper-2`, 1px `--rule`, `--r-md`. Header 36, pad 0 12: label mono
  10/600/0.14em `--ink`, Count, WIP readout mono 9.5 `--ink-4` → at the
  limit `--warn-text` → over it `--neg-text` + 6% `--neg` wash (advisory,
  never blocks a drop). Stack pad 8, gap 8, of Item cards; drop slot 1px
  dashed `--brand-d` at the carried card's height; add slot 36 (72 when
  the column is empty) 1px dashed `--rule-strong`. Columns 12 apart; a
  column never tints on drag.
- **Time axis** (`<Plan>` · `ruler`, ticks `rulerTick`) — 48: context tier
  24 (mono 10/600/0.16em caps `--ink-4`, sticky-left) over tick tier 24
  (mono 10/500 tabular `--ink-4`, centred), 1px `--rule` under each. Tick
  40 for hour, week and month, 48 for day. Non-working time `--paper-2`
  from the tick tier down; context boundaries 1px `--rule` through the
  lanes; `nowLine` 1px `--brand-d`; the current period's `nowChip` 16, pad
  0 4, `--r-sm`, `--brand-d` with `--paper` mono 600. Lane column 128,
  first cell pad 20.
- **Run bar** (`<Plan>` · `bar`, plan | actual) — lane 36, bar 20 at top 8,
  `--r-sm`, mono 10/600 label pad 0 8. Plan 1px dashed `--brand-d`, label
  `--brand-d`; actual `--brand-d`, `--paper` label, drawn over its plan up
  to now; overrun marks the plan end with a 1px `--paper` tick and reads
  the excess in `--neg-text`. Hover `--brand-dd` · selected 2px `--ink`
  outline, offset 1 · focus ring · dirty `--brand-tint` + 1px `--brand-d`
  · breach 6% `--neg` wash with 1px `--neg` edges through the lane. Marks:
  milestone ◆ 10 (`milestoneDot`: met `--ink`, missed `--neg`, planned
  dashed `--brand-d`), decision a 1px `--ink` line + 8 flag (pending
  dashed `--ink-3`), labels mono 10/500 `--ink-2` (`markLabel`). Links
  finish-to-start, 1.5 elbow, head 6: done `--ink-3`, planned dashed
  `--brand-d`, conflict `--neg`.
- **Heat cell** (`<Matrix>` cell 64 × 36, pad 0 8 · `<Calendar>` cell 80 ×
  48, pad 6 8) — 1px `--rule` grid; fill `--heat-1` … `--heat-5` over
  equal-width thresholds, value mono 13/500 `--ink` on steps 1–3 and
  `--paper` on 4–5. Zero is a value (step 1); no data is `--paper` with
  "no data" mono italic 10 `--ink-4`; out of range is `--paper`, blank;
  above the domain clamps to step 5 and keeps its true value. Hover 1px
  `--ink-2` inset · selected 2px `--ink` + 1px `--paper` inset, fill kept
  · focus inset ring. Calendar date mono 10/600 top-left.
- **Heat legend** (`<Matrix>` · legend, `<Calendar>` · legend) — five 40 ×
  12 swatches in a 1px `--rule` strip, thresholds mono 9.5 `--ink-4`
  under the joins, the last closed with `≥`; a `--paper` key for "out of
  range". Under the grid, full width, like the chart legend.

## Canvases — selection & halo (`<Flowchart>`, `<Schematic>`, `<Map>`, `<Plan>`)

Selection on a canvas is `--ink`, never a tint: a filled part (node,
item card, schematic item) takes `--paper-3` + a 1px `--ink` edge; a line
(edge, map line, hex, lane link) goes 2px `--ink` (planned lines
`--brand-dd`); a mark too small to fill (map marker) takes a 1px `--ink`
ring 3 outside it; a bar takes a 2px `--ink` outline, offset 1; a heat
cell keeps its fill under a 2px `--ink` + 1px `--paper` inset. A selected
label goes 600 `--ink`.
**Halo** — emphasis, not selection: a 1px ring in the tone (`--brand`,
`--warn`, `--neg`) 4px outside the part, its radius the part's + 4
(`--r-lg` around an `--r-md` node). **Pulse** — the live dot on the part;
the part never moves.

## File upload (`<FileUpload>`)

Dashed 1.5px dropzone on `--paper-2`; every upload shows its checksum in
mono (provenance is non-negotiable); errors in the help slot, not a toast.

## Icons

Font Awesome 6 Free, `fa-solid` only, from the CDN — 14px inline, 16px in
buttons. Icon colour inherits `currentColor`; only the three state icons
carry semantic colour (warn `triangle-exclamation`, neg
`circle-exclamation`, pos `check`). Every icon has an accessible label. No
`fa-regular`/`fa-brands`, no SVG, no emoji.

## Spacing & surfaces

4px scale — use the rung, never arbitrary px: Main frames pad 20px, rail
frames 12px, table cells 12px horizontally (the first and last take the
Frame's padding), internal gaps 8px. Radii: `--r-sm` 4px
chips, counts, NEW, DeltaPill, kbd, run bars · `--r-md` 6px buttons,
controls, menus, popovers, and the cards and columns inside a Frame (Item
card, Board column, graph node) · `--r-lg` 10px frames, dialogs, the
Commit bar, the Stamp. The focus ring is the only shadow: outside on
controls (`--shadow-focus`), inset on cells and rows
(`--shadow-focus-inset`).
