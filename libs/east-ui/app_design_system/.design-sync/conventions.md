# East — build conventions (read before styling anything)

East is a decision-intelligence surface: operators observe live operations,
decide on model recommendations, and calibrate trust. Voice is an analyst's —
terse, factual, sentence case, quantified ("Utilisation exceeds 92% in week
3"), units and horizons stated ("next 14 days", "vs plan"). No exclamation
marks, no emoji (glyphs come from the mono font: ▲ ▾ △ ☐ ×).

## Setup

No provider needed. Components self-inject their CSS; you MUST load
`styles.css` (it pulls in `tokens/colors.css`, `tokens/typography.css`,
`tokens/layout.css` and the base element styles) or every `var(--*)`
resolves to nothing. Dark mode = set `data-theme="dark"` on any parent;
components adapt with zero code change.

## The styling idiom: semantic CSS custom properties, never raw values

Style your own layout glue with the semantic tokens ONLY — never a hex,
never a raw scale token (`--gray-400`, `--brand-300`):

- Text: `--ink` (primary) → `--ink-2` … `--ink-5` (faintest annotation)
- Surfaces: `--paper` (cards), `--paper-2` (page bg, header bands), `--paper-3` (wells)
- Borders: `--rule` (inside-card 1px dividers), `--rule-strong` (card edges, inputs)
- Brand: `--brand`, `--brand-d` (interactive), `--brand-dd` (hover), `--brand-tint`
  (the ONLY legal tinted background — means selected/active/dirty)
- Valence: `--pos`, `--neg`, `--warn`, `--info`; washes max 6–8% via
  `color-mix(in oklch, var(--pos) 6%, transparent)`
- Chart accents (marks only, in series order): `--brand-d` first, then
  `--teal-500`, `--purple-500`, `--blue-500`, `--orange-500`
- Type: `--font-brand` (DM Sans — titles, negative tracking), `--font-body`
  (Inter Tight — running text 12.5–14px), `--font-mono` (JetBrains Mono —
  EVERY numeral with `font-feature-settings: "tnum" 1`, plus labels/eyebrows/
  keys/statuses: 9.5–11px, 600, uppercase, `letter-spacing: 0.1em+`, `--ink-4`)
- Spacing `--sp-1`…`--sp-20` (4px base); radii `--r-sm` 4px chips, `--r-md` 6px
  buttons, 10px outer frames — nothing pill-shaped, `--r-full` only avatars/dots
- Motion `--dur-fast`/`--dur-base` + `--ease-out`; focus ring `--shadow-focus`

Hard rules: structure from 1px rules, not shadows (`--shadow-*` only on true
overlays); flat backgrounds, no gradients/imagery; dashed border = ephemeral/
stale/partial (never decorative); hover darkens a border or steps bg to
`--paper-3` — never lift/scale; one `primary` button per surface.

## Composition: 8 atoms, invent the rest — inside the East vocabulary

Actions → `Button`, filter/scope tokens → `Chip`, state → `Status` (dot +
uppercase mono word — NEVER a tinted badge), change → `DeltaPill`, named
facts → `Tag`, shortcuts → `Kbd`, notices → `Banner`, people → `Avatar`.
Larger patterns are deliberately not shipped as code — build them fresh
following the guidelines (they carry exact dimensions): app frame /
sidebar / app-bar densities / commit bar → `guidelines/app-layout.md`;
tables, forms, tabs, menus, dialogs, chips → `guidelines/base-components.md`;
charts → `guidelines/charts.md`; the hard-constraint checklist →
`guidelines/component-rules.md` (self-review: grep your CSS for `#` — any
hex is a violation; toggle dark; check numerals are mono tabular).

**Designs here are handed off to East engineers who implement them with the
`@elaraai/east-ui` / `@elaraai/e3-ui` component libraries** (East JSX:
`<App>`, `<Table>`, `<Chart>`, `<Planner>`, `<Banner>`, `<Status>`,
`<Tabs>`, `<Dialog>`, `<ChipRail>`, …). The guidelines name the matching
production tag for each pattern — keep that vocabulary and anatomy so every
mock translates 1:1; don't invent interaction idioms outside it.

## Idiomatic snippet

```jsx
<div style={{ background: 'var(--paper)', border: '1px solid var(--rule-strong)',
              borderRadius: 10, padding: 18 }}>
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 18,
                borderBottom: '1px solid var(--rule)', paddingBottom: 10 }}>
    <span style={{ fontFamily: 'var(--font-brand)', fontSize: 20,
                   fontWeight: 600, letterSpacing: '-0.01em' }}>Roster plan</span>
    <Tag k="horizon" v="14d" />
    <Status level="ok">Reconciled</Status>
    <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)',
                   fontFeatureSettings: '"tnum" 1', fontSize: 26, fontWeight: 600 }}>
      92.4%</span>
    <DeltaPill dir="up">+1.6 pts</DeltaPill>
  </div>
  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12 }}>
    <Button>Discard</Button>
    <Button variant="commit">Commit changes</Button>
  </div>
</div>
```

(Component loading follows this README's own Usage section; the atoms are
the bundle's exports.)

Where the truth lives: `styles.css` → `tokens/*.css` (every token above),
`guidelines/guidelines/component-rules.md` (the compliance checklist),
`guidelines/guidelines/{app-layout,base-components,charts}.md` (anatomy +
exact dimensions + production tag mapping), per-component `.prompt.md`.
