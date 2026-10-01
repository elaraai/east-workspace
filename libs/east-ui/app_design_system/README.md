# East — design system

East is Elara's decision-intelligence surface: operators observe live
operations, decide on model recommendations, and calibrate their trust in
them. Every screen exists to commit one kind of decision, and every output
says where it came from.

This project is the whole design system. It is visual and design-first: no
components ship as code, nothing is captured from production, and every
change happens here. Production is built by East engineers with
`@elaraai/east-ui` / `@elaraai/e3-ui`; each guideline and card names the
production tag it maps to.

## Source of truth

What East looks like is prescribed by three things, and only these:

1. **Tokens** — `styles.css` → `tokens/colors.css`, `tokens/typography.css`,
   `tokens/layout.css`, plus the base element styles in `_ds_bundle.css`.
2. **Guidelines** — `guidelines/guidelines/`: `component-rules.md` (the
   compliance checklist); `app-layout.md`, `base-components.md`, `charts.md`
   (anatomy, exact dimensions, the production tag for each pattern);
   `component-review.md` (the protocol for reviewing one component).
3. **Spec cards** — `guidelines/cards/`. Foundation cards: Colors, Type,
   Foundations, App layout, then the foundation parts (Button, Checkbox,
   Input, SegmentGroup, Chip, Status, DeltaPill, Tag, Kbd, Banner, Avatar;
   rows, cells, toolbars, grids, time, canvases, overlays). Component spec cards: `Components · <Category>`, one
   or more per reviewed component, composed only of foundation parts.

A spec card is a token-only, high-fidelity mock drawn at 1:1 — every
colour, font, size, radius and shadow a `var(--…)` from `tokens/`, no hex —
showing the real states. It ends with one mono annotation line: the
production tag first, then the exact values. Shell anatomy and Main layouts
are the two schematic cards and say so in that line.

A component review starts from 2–4 screenshots of the live component
attached to the chat and writes its spec cards straight into
`guidelines/cards/`; `component-review.md` has the full recipe.

## Setup

Link `styles.css` — it pulls in the three token files (with the Google
Fonts import) and the base element styles; without it every `var(--*)`
resolves to nothing. Dark mode = `data-theme="dark"` on any parent;
anything written against the semantic tokens adapts with zero code change.
Icons come from the Font Awesome CDN (see Icons).

## Writing style

- **Voice** — an analyst's: terse, factual, quantified. Say what the number
  is and what it is measured against: "Utilisation exceeds 92% in week 3",
  "Fill rate 96.4% · target ≥ 95%". No exclamation marks, no emoji, no
  marketing adjectives.
- **Case** — sentence case everywhere in source: titles, buttons, menu
  items, labels. Mono labels are uppercased by CSS (`text-transform`), so
  their text stays sentence case.
- **Numbers** — numerals, never words, with units and horizons stated
  ("214 staffed-hrs", "next 14 days", "vs plan"). Signed deltas carry ▲/▼
  and a true minus: "▲ +4.2%", "−$18k". Confidence as "conf 0.78", runs as
  "run #42", freshness as "14m ago". ISO dates in data (2026-07-22); short
  ranges in captions (Jul 22 – Aug 05).
- **Absent values** — said in words, never a dash, a blank, a zero or
  "N/A": "no data" when the source has no value; when the value cannot
  exist yet, the reason ("not started"). Set in mono italic 400 `--ink-4`
  in the value's alignment. A slot an item doesn't have collapses instead.
- **Joining facts** — " · " between facts on one line; " / " in paths and
  breadcrumbs.
- **Actions** — buttons are verbs. The commit cluster is always
  "Override · Modify · Apply". A Dialog's Primary names the verb and its
  object ("Archive roster"), never "OK" or "Yes".
- **Status** — one or two words after a dot: Committed, Pending, Stale.
- **Consequences, not warnings** — say what happens in plain terms: "3
  shifts fall below minimum cover on Thursday." Help text states range,
  unit and default inline; an error replaces the help text, never a toast.
- **Empty states** — a short title and a checklist of what to do next.
- **Spelling** — British: utilisation, optimise.

## Visual foundations

### Colour

Cool green-grey neutrals and one deep teal. Colour carries information;
nothing is decorative.

- **Ink** (text): `--ink` → `--ink-4`. Everything a user reads is `--ink-4`
  or darker — at least 4.5:1 on `--paper`, `--paper-2`, `--paper-3` and
  `--brand-tint` in both themes, so text keeps its ink in a selected or
  dirty row.
  `--ink-5` is never readable text. It is for disabled text and icons and
  for muted marks: the muted tone of map markers and graph nodes, and the
  third segment of a stacked column. A muted mark is context; it never
  carries the only sign of something to act on.
- **Paper** (surfaces): `--paper` frames, rows and controls · `--paper-2`
  page, bands, sidebar, rail · `--paper-3` wells, count chips, selected
  rows.
- **Rules**: `--rule` inside frames · `--rule-strong` frame edges, inputs,
  overlay edges.
- **Brand**: `--brand` marks and dots · `--brand-d` interactive (Primary,
  links, checks — text and ticks on it are `--paper`) · `--brand-dd` hover
  and pressed · `--brand-tint`, the only tinted background in chrome: an
  active control or a dirty value.
- **Valence**: `--pos`, `--neg`, `--warn`, `--info` (its own blue, never
  `--brand-d`) for dots, marks and the 6% wash,
  `color-mix(in oklch, var(--pos) 6%, transparent)` — at least 3:1. Set as
  text, valence uses its text step (`--pos-text`, `--neg-text`,
  `--warn-text`, `--info-text`), at least 4.5:1 on every paper and on
  `--brand-tint`, and on its own wash over each of them, in both themes —
  a DeltaPill holds in a selected or dirty row, card or node.
- **Heat ramp**: `--heat-1` … `--heat-5`, the one sequential ramp —
  `--brand-d` mixed into `--paper` at 12 / 32 / 56%, then `--brand-d`,
  then `--brand-dd`. Value text `--ink` on steps 1–3, `--paper` on 4–5. It
  fills Matrix and Calendar heat cells and map areas that encode one
  measure's magnitude; good / at-risk / bad stays the valence wash.
- **Inverse**: `--bg-inverse` / `--fg-inverse`, for the Stamp and the
  Tooltip only.
- **Chart accents** (marks only, in series order): `--brand-d`, then
  `--teal-500`, `--purple-500`, `--blue-500`, `--orange-500`.

### Type

- Three families, all from Google Fonts: **DM Sans** (`--font-brand`) for
  titles, with negative tracking; **Inter Tight** (`--font-body`) for
  running text; **JetBrains Mono** (`--font-mono`) for every numeral and
  every label — the data voice.
- The sizes are tokens and there are no others: labels 9.5 / 10 / 10.5 /
  11px (`--fs-label-*`), running text 12.5 / 13 / 14px (`--fs-body-*`),
  titles 15 / 16 / 18 / 20 / 24px (`--fs-title-*`), large numbers 26px
  (`--fs-num`). `h1`–`h3` are 24 / 20 / 18.
- Every numeral is mono, tabular (`font-feature-settings: "tnum" 1`) and
  500 (`.num`) — cells, values, numerals in running text. A numeral inside
  a label, meta line or caption takes that line's weight. Large numbers
  are mono, tabular, 26px, weight 600 (`.num-lg`).
- Labels — eyebrows, keys, statuses, tabs, table headers, axis labels —
  are mono, 600, uppercase, 0.1–0.18em tracking, `--ink-4`.
- No italic, except muted "no data" values (JetBrains Mono italic 400 is
  loaded for them).

### Space & density

- 4px scale (`--sp-1` … `--sp-20`), never an off-scale px. Main frames pad
  20px, rail frames 12px; table cells pad 12px horizontally, except the
  first and last, which take the Frame's padding so the eyebrow, body text
  and first column share one edge; internal gaps are
  8px; siblings are spaced with flex/grid `gap`, never margins.
- Rows are a fixed height per density, rule included, content centred:
  comfortable 36 (default), compact 32, condensed 28. Every row
  collection — Table, DataList, TreeView, ValueTree and the list layout
  of Board, Deck, Library and Roster — offers all three and shows one
  throughout. The Sheet is a gridded editor with one size: 32px cells.
- Density names come from the app bar — comfortable (default), compact,
  condensed — and collections use the same names. The chip rail adds large
  (34px) as its touch size; touch keeps comfortable rows. The layout axis
  for a pattern's height is Height (short / default / tall), never density.

### Structure, radii & shadow

- Structure comes from 1px rules. There is one card shape, the Frame (1px
  `--rule-strong`, `--r-lg`, `--paper`), in four roles: Surface, Inset,
  Stat, Stamp.
- Radii: `--r-sm` 4px chips, counts, NEW, DeltaPill, kbd, bars · `--r-md`
  6px buttons, inputs, menus, popovers, and the cards and columns that sit
  inside a Frame (Item card, Board column, graph node) · `--r-lg` 10px
  frames, dialogs, the Commit bar, the Stamp · `--r-full` avatars and dots
  only. Nothing is pill-shaped; a 6px Progress bar is square-ended.
- The focus ring is the one allowed shadow: outside on controls
  (`--shadow-focus`), inset on cells and rows (`--shadow-focus-inset`) —
  3px of `--brand` at 35% in light, of `--brand-d` at 80% in dark.
  Frames, overlays, dialogs and the Commit bar cast none.
- Dashed means ephemeral, partial, stale or placeholder; solid is committed
  truth. Never decorative.

### States

- **Hover** — one paper step darker than the resting surface (`--paper` →
  `--paper-2` → `--paper-3`); brand fills `--brand-d` → `--brand-dd`. Never
  lift, scale or shadow.
- **Active control** (segmented option, active chip, current nav item) —
  `--brand-tint` fill, `--brand-dd` text.
- **Dirty value** — `--brand-tint` fill; the Commit bar appears.
- **Selected row or cell** — `--paper-3`, unchanged on hover.
- **Selected on a canvas** (nodes, items, marks, bars, lines) — `--ink`:
  `--paper-3` fill plus a 1px `--ink` edge where the part has a fill, a
  2px `--ink` stroke where it is a line, a 1px `--ink` ring outside a mark
  too small to fill. A halo is emphasis, not selection: a 1px ring in the
  tone 4px outside the part.
- **Loading** — the Skeleton: static `--paper-3` shapes in the final
  layout after `--dur-base`; a button in flight keeps its label and shows
  the live dot.
- **Focus** — the focus ring, inset on cells and rows.
- **Disabled** — `--ink-5` text and icons.
- **Destructive** — through a `<Dialog>` whose Primary carries the named
  verb; `--neg-text` only on the destructive menu item. There is no red button.

### Motion

`--dur-fast` 120ms (hover, focus) · `--dur-base` 200ms (panels, banners,
the Commit bar) · `--dur-slow` 360ms (run pulse, diff settle). `--ease-out`
for everything that moves; `--ease-in-out` for state toggles only. No
bounces, springs, parallax or scroll-driven motion; the status-dot pulse is
the only loop.

The live pulse (the Status card's `live` dot): an `::after` echo of the
8px dot, in the dot's colour, scales 1 → 2.5 (8 → 20px) while fading
0.6 → 0 over the first 25% of a `calc(var(--dur-slow) * 4)` cycle — the
echo takes 360ms, then rests 1080ms — `--ease-out`, infinite. The dot
itself never moves. Under `prefers-reduced-motion` the echo is removed.

### Layout

- Five regions: the logo region and app bar across the top (the same
  height at each density), sidebar (240 / 56px), Main (max 1480px, pad
  32/24), rail (320px, evidence only), Commit bar (sticky bottom, only when
  dirty).
- Main is a 12-column grid with one layout per surface: Single, Split or
  Grid. Nothing sits in Main without a Frame.
- Breakpoints: <1280 grid 6 → 4 columns · <1080 the rail becomes a tab
  strip · <768 the sidebar locks collapsed · ≤560 sidebar overlay, one
  column, and the rail's tabs open the Drawer.
- The sidebar toggles by its chevron only; `[` and `]` page.
- Banners over modals: the one modal is `<Dialog>`, a confirmation step,
  never a commit surface.

### Charts

Chrome is mono type on solid `--rule` lines; colour is data only. Series 1
is `--brand-d`, comparisons teal → purple → blue → orange. Positive driver
bars are `--pos`, negative `--neg`. Bands are `--brand-tint` at 0.7.
Sequential fills (heat cells, map areas) are `--heat-1` … `--heat-5`.
Forecasts, targets and uncertainty are dashed.

### Backgrounds & imagery

Flat surfaces only — no gradients, textures, photography or illustration.
Empty states use a mono glyph in `--rule-strong`, a 15px title and a
checklist.

## Icons

- **Font Awesome 6 Free, `fa-solid` only**, from the CDN:
  `<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">`
- 14px inline, 16px in buttons; colour inherits `currentColor`. Three icons
  carry semantic colour: `triangle-exclamation` (`--warn`),
  `circle-exclamation` (`--neg`), `check` (`--pos`).
- Every icon has an accessible label; icon-only buttons are 32×32 (24×24
  at sm) with an `aria-label` and a Tooltip that names them.
- Mono glyphs from JetBrains Mono stand in for icons inside data: ▲ ▼ ▾ △
  ☐ × →. The Tooltip affordance is a 14px ⓘ ring in `--ink-4`.
- Never `fa-regular` or `fa-brands`, never hand-drawn SVG, never emoji.
- There is no logo yet. Mocks show a dashed placeholder labelled "Logo" in
  the sidebar's logo region.

## Tokens

**Allowed** — the semantic set: `--ink`…`--ink-5`, `--paper`…`--paper-3`,
`--rule`, `--rule-strong`, `--brand`, `--brand-d`, `--brand-dd`,
`--brand-tint`, `--pos`, `--neg`, `--warn`, `--info`, `--pos-text`,
`--neg-text`, `--warn-text`, `--info-text`, `--heat-1`…`--heat-5`, `--bg-inverse`,
`--fg-inverse`; `--font-*`, `--fs-*`, `--fw-*`, `--lh-*`; `--sp-*`;
`--r-sm`, `--r-md`, `--r-lg`, `--r-full`; `--shadow-focus`,
`--shadow-focus-inset`; `--dur-*`, `--ease-*`. The raw scales
(`--brand-50`…`--brand-900`, `--gray-*`) feed the aliases and are never
referenced directly; the accent hues appear only in chart marks.

**Deprecated** — kept only so older mocks resolve; never use:
`--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--fg-primary`,
`--fg-secondary`, `--fg-muted`, `--border-subtle`, `--border-strong`,
`--border-focus`, `--card-bg`, `--card-border`, `--link`, `--link-hover`,
`--brand-l` (each now an alias of its replacement), and `--shadow-xs` …
`--shadow-xl`.

**Retired** — removed: `--r-xl`, `--r-2xl`, and the `--fs-xs` … `--fs-6xl`
scale.

## Composition & handoff

Build mocks from the spec cards and the guidelines, which carry exact
dimensions: app frame, sidebar, app-bar densities, commit bar →
`app-layout.md`; buttons, forms, collections, tables, tabs, menus, dialogs,
chips → `base-components.md`; charts → `charts.md`; the hard constraints →
`component-rules.md`. A part a foundation card defines is reproduced from
that card, never redrawn; a part with no card yet is proposed, not
improvised. One Primary button per surface, right-aligned in its cluster.

Self-review before handing over: grep the CSS for `#` (any hex is a
violation), toggle dark mode, check every numeral is mono tabular and every
label 9.5–11px, and check the only shadow is the focus ring.

Designs here are handed off to East engineers who implement them with the
`@elaraai/east-ui` / `@elaraai/e3-ui` component libraries (East JSX:
`<App>`, `<Card>`, `<Stat>`, `<Table>`, `<Chart>`, `<Plan>`, `<Banner>`,
`<Status>`, `<Tabs>`, `<Dialog>`, `<ActionBar>`, `<ChipRail>`, …). The
guidelines and cards name the matching production tag for each pattern —
keep that vocabulary and anatomy so every mock translates 1:1; don't invent
interaction idioms outside it.

## Where things are

- `styles.css` — the single stylesheet entry. Link this one file.
- `tokens/colors.css`, `tokens/typography.css`, `tokens/layout.css` — the
  tokens; dark overrides under `[data-theme="dark"]`.
- `_ds_bundle.css` — base element styles (headings, text classes, links),
  imported by `styles.css`.
- `guidelines/index.md` — the guideline index; the five guidelines live in
  `guidelines/guidelines/`.
- `guidelines/cards/` — foundation and component spec cards.
- `SKILL.md` — the agent entry point · `thumbnail.html` — the project tile.
