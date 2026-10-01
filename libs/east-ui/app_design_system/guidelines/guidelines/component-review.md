# Component review — the protocol

One chat reviews one east-ui component. It reads the component as it is
today from screenshots, checks it against the tokens and guidelines, and
hands over two things: the component's spec card(s), written directly into
this project under `guidelines/cards/`, and a change list for the east-ui
engineers.

## 1 · Inputs

The review starts only when both are in the chat; ask for whichever is
missing.

- **Screenshots** — 2–4 of the live component in the product, attached to
  the chat, with real data, covering as many of the states in §2 as exist.
  They are the current state under review. Read them for anatomy — the
  parts, slots and examples — never for values: colours, sizes, radii and
  spacing come from `tokens/` and the guidelines, not from the render.
- **Visual props** — one line, e.g. `size sm|md|lg · variant outline|subtle`.

## 2 · Checklist

Run it twice: against the current component, where every failure becomes a
change-list row, and against the finished spec card, which must pass every
line.

- [ ] **Component rules** — every line of `component-rules.md` §1–6, then
      its self-review.
- [ ] **Density** — row heights, paddings and gaps at the values the
      guidelines give for this component; every density the component
      offers, each shown and named with the collection names (comfortable
      default, compact, condensed; large only where a recipe defines it).
      Every row collection offers all three (base-components › Collection
      density).
- [ ] **States** — each drawn on the spec card, or marked n/a in the change
      list with the reason:

| State | Defined in |
|---|---|
| default | the component's section of the guidelines |
| hover | component-rules §4 (one paper step darker) |
| active | component-rules §1 · base-components › Segmented control, Chips (`--brand-tint`) |
| selected | component-rules §1 · base-components › Tables (`--paper-3`) · on a canvas, base-components › Canvases (`--ink`) |
| dirty | component-rules §1 · app-layout rule 5 · base-components › Field |
| focus | component-rules §4 (focus ring, inset on cells and rows) |
| stale | component-rules §3 (dashed) · app-layout rule 6 |
| empty | component-rules §5 (empty states) |
| loading | the Skeleton card · the Row-level states card (collections) · base-components › Status, counts & progress (Loading) and › Buttons (Loading) |
| error | base-components › Field (invalid) |

- [ ] **Dark mode** — set `data-theme="dark"` on the card's `<body>`: every
      state legible, nothing that only works on white.
- [ ] **Numerals** — every digit is `--font-mono` with
      `font-feature-settings: "tnum" 1`: cell values, counts, page numbers,
      ticks, dates, totals.

## 3 · Outputs

The spec card is written directly into this project under
`guidelines/cards/`. The change list goes in the chat reply.

### (a) Spec card(s)

Most components need one card; split by facet (states, densities) only when
one card can't show everything at 1:1.

- **File** — `guidelines/cards/<category>-<component>[-<facet>].html`, e.g.
  `collections-pagination.html`, `collections-table-states.html`.
- **Marker** — first line:
  `<!-- @dsCard group="Components · <Category>" name="<Component>[ · <facet>]" viewport="700x<height>" subtitle="<what the card shows>" -->`
- **Page** — as the foundation cards:
  `<link rel="stylesheet" href="../../styles.css">`,
  `body { margin: 0; padding: 16px 20px; background: var(--paper-2); }`
- **Mock** — token-only and high-fidelity: every colour, font, size, radius
  and shadow is a `var(--…)` from `tokens/`; a value the guidelines state
  without a token (36px table rows, the 14×14 checkbox) is written as that
  literal. Drawn at 1:1 — show a slice of a large component rather than
  scaling it down. Real content in the analyst voice. Each state carries a
  mono caption naming it, as on the App bar densities card.
- **Composition** — only foundation parts, each reproduced exactly as its
  foundation card specifies (same markup, same values). A component card
  never restyles a part.
- **Props line** — at most one, mono:
  `<Pagination> · size sm|md|lg · variant outline|subtle`. Visual props
  only; no tables, types, defaults or descriptions.
- **Annotation line** — last, mono 9.5px `--ink-4` (the foundation cards'
  `.ann`): the production tag first, then the exact values separated by
  ` · `, e.g.
  `<ActionBar> · sticky bottom · 56px · pad 12/24 · --brand-tint · 1px --brand-d · --r-lg · Override → Modify → Apply`

### (b) Change list

Markdown, one row per change; elements that don't change get no row.

| Element | Current | Target | Token / value | Rule |
|---|---|---|---|---|

- **Element** — `<Component> · <part> · <state>`, e.g.
  `Pagination · prevTrigger · disabled`.
- **Current** — what the screenshots show, as values; prefix `≈` where a
  value is estimated from a screenshot rather than known.
- **Target** — what the spec card shows.
- **Token / value** — the exact token(s), or the literal the guideline gives.
- **Rule** — the line that requires it: `component-rules §2`,
  `base-components › Tables`.

Below the table, when needed:

- **Proposed parts** — a foundation part the component needs that no card
  defines: name · what it is · where this component uses it. The spec card
  shows it as a dashed placeholder labelled with the part name.
- **Conflicts** — two guideline lines that disagree for this component,
  quoted, left undecided.

## 4 · Forbidden

- New colours, fonts, sizes, radii or shadows — anything not in `tokens/`
  or stated in a guideline. Values copied from a screenshot.
- New interaction idioms — anything outside the guidelines' vocabulary:
  toasts, pill or boxed tabs, hover lift, a shadow other than the focus
  ring, a red button, a modal other than `<Dialog>`.
- Hand-building a row, cell, chip or toolbar that a foundation card
  already defines.
- Improvising a missing foundation part — propose it.
- Settling a guideline conflict inside a component review — list it.
- Props boilerplate — more than one props line, props tables, types,
  defaults.

## 5 · Naming

Everything is named by component.

- Cards and files: `name="Pagination"`, `name="Table · states"`,
  `collections-pagination.html`.
- Parts: the slot name as east-ui spells it (`Pagination · prevTrigger`,
  `Table · columnHeader`); base-components names the ones already settled.
  When the screenshots don't show it and base-components doesn't name it,
  ask.
- Foundation parts by their component name — `Button`, `Chip`, `Status` —
  never by description ("the teal button").
- Production tags as east-ui spells them: `<DataList>`, `<TreeView>`,
  `<ValueTree>`, `<PagedSource>`.
