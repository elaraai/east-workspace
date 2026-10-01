# App layout — the canonical East screen

The shell, the Frame and the breakpoints every East screen shares. The
values here are the spec; the App layout cards in `guidelines/cards/` draw
them. Production implementation: `@elaraai/east-ui` — `<App>` is the whole
shell (collapsible sidebar + breadcrumb + logo + routed body); `<NavList>`,
`<Breadcrumb>`, `<Card>`, `<Grid>`/`<Stack>` compose the rest.

## Eight rules every screen follows

1. **Decision-first density** — a screen exists to commit one kind of
   decision. Dashboards are forbidden: a surface listing "interesting data"
   without naming its decision doesn't ship.
2. **Trust is visible** — every output names its run, sources, assumptions,
   freshness (run anchor `run #N`, trust chips).
3. **Override is first-class** — every commit surface offers
   `Override · Modify · Apply` in that order; never behind a menu; reason
   capture required. A Dialog is not a commit surface.
4. **Status is dot + word** — never pills, coloured cards, badge fills.
5. **Brand-tint = active or dirty** — `--brand-tint` marks an active
   control or an unsaved value and is used nowhere else (chart bands
   aside). Selected rows and cells are `--paper-3`.
6. **Banners over modals** — stale/partial/guardrail/change render as
   in-flow banners next to what they describe; the one modal is
   `<Dialog>`, a confirmation step for irreversible and destructive actions.
7. **Mono labels frame everything** — eyebrows/statuses/keys:
   JetBrains Mono · 9.5–11px · 600 · 0.1–0.18em · uppercase.
8. **Composition over invention** — new surfaces compose catalogued
   patterns; a missing pattern gets specified first, not invented in the
   screen.

## Five regions

```
┌─ Logo ─┬──────────────── App bar (sticky top) ────────────────┐
│Sidebar │               Main               │       Rail        │
│ modes  │         pattern surface          │     evidence      │
│        ├──────────────────────────────────┴───────────────────┤
│        │     Commit.Bar (sticky bottom, only when dirty)      │
└────────┴──────────────────────────────────────────────────────┘
```

Invariants: the app bar always carries the run's trust stamp · the logo
region matches the app bar's height at each density · below 1080px the
rail becomes a tab strip, it never disappears · Commit.Bar is sticky-bottom
whenever a patch is dirty.

## Frame — the one card shape (east-ui: `<Card>`)

1px `--rule-strong` border · `--r-lg` (10px) radius · `--paper` fill · no
shadow. Three slots: **eyebrow row** (36px, content centred, same
horizontal padding as the body, `--paper-2` band with a bottom `--rule`;
sticky on long bodies; the name is mono 10 / 600 / 0.14em uppercase in
`--ink` — the one label that isn't `--ink-4` — with the run anchor after
" · ", and meta mono 9.5 `--ink-4` on the right) · **body** (required; 20px padding in Main, 12px in
the rail — a `<Table>` body runs edge to edge; its first and last cells
take this padding and the cells between pad 12px, so the eyebrow, body
text and first column share one edge)
· **footer** (optional, `--paper-2` band, top rule). Frames never nest more
than one level. Cards and columns that sit inside a Frame — the Item
card, the Board column, graph nodes — are parts, not Frames: they take
`--r-md`, one step inside the Frame's `--r-lg`, and never carry an
eyebrow row. Four roles, no other card shapes:

- **Surface** (default) — holds one pattern surface; eyebrow names it + run anchor
- **Inset** — evidence nested inside a Surface: dashed `--rule-strong`
  border, `--paper-2`, `--r-lg`, 12px padding, no eyebrow; reads as a
  quote, not a sibling
- **Stat** (`<Stat>`) — the one-number frame: mono eyebrow → large number
  (mono, tabular, 26px / 600) with a mono unit suffix → mono valence line
  in the text step (`+14% wow · conf 0.78`)
- **Stamp** — the provenance card: `--bg-inverse` fill, `--fg-inverse`
  text, `--r-lg`, no border; a rail frame (12px padding)

Never put bare content (a chart, table, stat) into Main without a Frame.

## App bar (east-ui: `<App>` — three build-time densities)

The shell app bar comes from `<App>`; sidebar and content are constant,
only the bar changes. Values are the source of truth — match
pixel-for-pixel (`--paper` fill, 1px `--rule` bottom border, no shadow):

| Density | Height | Rows | Padding | Breadcrumb | Title |
|---|---|---|---|---|---|
| **comfortable** (default) | ≈90px | 2 (row 1 24px, gap 8) | 16px block · 24px inline | mono 11px / .06em | DM Sans 24 / 700 / −.015em / lh 1.1 |
| **compact** (dense toolbars) | ≈68px | 2 (row 20px, gap 4) | 12px block · 20px inline | mono 10.5px | DM Sans 18 / 700 |
| **condensed** (data-dense) | 44px | 1 — crumb · 1×14px `--rule-strong` divider (margin 0 12) · title · toggle | 0 block · 20px inline | mono 10.5px | DM Sans 16 / 700 / −.01em / lh 1 |

- The same three names are the density names for collections
  (`base-components.md` › Collection density).
- Right cluster (pattern-spec header): trust chip + surface actions in
  commit order; state eyebrow (mono 10.5px uppercase: mode · N dirty)
  sits right of the title. No back-button (the breadcrumb is the
  back-button), no logo (it lives in the sidebar's logo region, which
  matches the bar's height at each density). Below 768px the breadcrumb
  collapses to the parent link; the right cluster wraps.

### Nested pages & breadcrumb depth

The breadcrumb reflects the **page route, not the nav tree** — it can go
deeper than the sidebar. Two rules make nesting predictable: the **title
always names the current page** (the leaf), and the **breadcrumb is every
ancestor above it** from the workspace root down (the workspace name is the
root crumb).

- **Nav depth and route depth move independently.** A sidebar that stops
  at two levels can host pages three or more deep. The sidebar highlights
  the *deepest route segment that also exists in the nav*; anything below
  that lives only in the breadcrumb and page title, never in the sidebar.
  (Example: the sidebar knows Staffing › Rosters; the route continues to
  one roster, DC-North — the sidebar highlights Rosters, the breadcrumb
  reads `Acme Ops / Staffing / Rosters`, the title is `DC-North`.)
- **Depth ladder** (comfortable): depth 1 = root only · depth 2 = root/one
  ancestor · depth 3 = root/two ancestors — title is always the leaf.
- **Overflow rule** — past four crumbs, collapse the middle into a `…`
  menu, always keeping the root and the last two ancestors. Never wrap the
  breadcrumb to a second line, never shrink its font.
- **Per density**: comfortable and compact carry the full path on their own
  row. Condensed shares one line with the title, so it collapses to
  `root · … · immediate parent` and lets the title hold the leaf.
- Tokens: ancestors `--ink-3` mono 500 · separators + overflow chip text
  `--ink-4` · overflow chip fill `--paper-3` / border `--rule` · active
  nav child `--brand-tint` / `--brand-dd` · condensed divider
  `--rule-strong` · title `--font-brand` / `--ink`. Dark mode inherits
  the same tokens.

## Sidebar (east-ui: `<App>` sidebar / `<NavList>`)

Top-level navigation only. **240px** expanded · **56px** collapsed (icons
only, tooltip after 400ms) · toggles by its chevron only (`[` and `]` page;
they never toggle the sidebar) · state persisted per user. Push, not
overlay, on desktop (Main reflows over `--dur-base` with `--ease-in-out`,
a state toggle); overlay only ≤560px; always collapsed below 768px.

- Right rule 1px · bg `--paper-2` · item height **36px** · hover
  `--paper-3` (one step below the sidebar) · active item = `--brand-tint`
  fill + `--brand-dd` text, `--r-sm`, 8px side inset · icon column 16px,
  gap 8px.
- Item label mono 11px / 600 / 0.12em uppercase · sub-item 11px / 500 /
  0.08em normal case, indented 36px, em-dash prefix · section eyebrow mono
  9.5px / 600 / 0.18em `--ink-4` · divider 1px rule, 8px margin.
- Max two levels. Forbidden: notifications, avatar, settings, anything not a
  mode / sub-item / scope.
- **Logo region**: the top of the sidebar, as tall as the app bar at each
  density (≈90 comfortable · ≈68 compact · 44 condensed), so its bottom
  edge lines up with the bar's bottom rule; 16px side padding; 12px
  rule-free gap below; identity only — no badges, version stamps, env
  tags, search. There is no logo yet: mocks show a dashed placeholder
  labelled `Logo`.

## Main

Padding 32px top/bottom · 24px sides · max content width **1480px** centred.
Gap between sibling frames 16px · split gap 20px · grid cell gap 12px ·
frames pad 20px.
Three layouts — pick one per surface, never mix (both needed → two screens):

- **Single** — one pattern surface fills the region (the default)
- **Split** — two columns (list left, briefing right); never deeper than 2
- **Grid** — repeated Stat/Reference tiles; 6 cols ≥1280 · 4 ≥960 · 3 ≥768 ·
  2 ≥560 · 1 below

### Layout descriptors (three orthogonal axes per pattern)

- **Size**: `xs` (chrome-inline, never a Main item) · `sm` (3 of 12 cols) ·
  `md` (6) · `lg` (8) · `full` (12, sits alone in its row)
- **Height**: `short` (~64px) · `default` (~140px) · `tall` (240px+, hero
  anchors). Density names (comfortable / compact / condensed) belong to
  the app bar and collections, never to this axis.
- **Stretch**: `fixed` · `flex` (grows to a cap) · `fill` (absorbs remainder)

Main is a 12-column grid; rows compose by size summing to 12; the rightmost
flex/fill item absorbs any remainder; hero (`full`) patterns are never tiled
with siblings. Tables/planners/queues are `full · fill`; stat cards `sm ·
fixed` (3–4 per KPI strip); tornado/compare/references `md · flex`; filter
chips/search/range/mode toggles are `xs` chrome that lives in eyebrows and
the header, never the Main grid.

## Rail (east-ui: `<Dock>` or a fixed `<Stack>` column)

**320px** fixed · bg `--paper-2` (recedes) · 1px left rule · padding 24px
top / 20px sides · frame stack gap 12px · rail frames pad 12px (tighter
than Main's 20px). Holds evidence only: provenance stamp, references,
journal. Forbidden: commit actions, settings, navigation.

Below 1080px the rail is a tab strip (`<Tabs>`, one tab per rail frame;
the topmost frame is the default open tab) — it never disappears. At 560px
and below, a tab opens its frame in the `<Drawer>`. On touch the strip is
44px tall.

## Commit.Bar (east-ui: `<ActionBar>`)

Hidden until a field is dirty. Sticky bottom · height **56px** · padding
12px/24px · `--brand-tint` bg · 1px `--brand-d` border · `--r-lg` (10px)
floating 16px above the viewport floor, or radius 0 edge-to-edge · no
shadow. Animates in over `--dur-base` with `--ease-out`, out instantly on
apply/discard.
Slots: left = brand dot + "**N changes** pending" + mono dirty-keys summary;
right = `Override · Modify · Apply`. No other actions.

## Responsive & mobile

East surfaces ship desktop, tablet, and mobile from one definition. The
breakpoint ladder (all values from the recipes above, collected):

| Width | What changes |
|---|---|
| <1280 | Main grid 6→4 columns (4 ≥960, 3 ≥768, 2 ≥560, 1 below) |
| <1080 | Rail becomes a tab strip (one tab per rail frame, topmost = default open tab) — never disappears |
| <768 | Sidebar always collapsed (56px, toggle hidden); breadcrumb collapses to the parent link; header right cluster wraps under the title |
| ≤560 | Sidebar becomes an **overlay** (full-height sheet from the left, scrim over Main, backdrop-tap/Esc dismiss); Main is one column, frames stack full-width; a rail tab opens its frame in the **Drawer** |

Mobile shell: prefer the **condensed app bar** (44px — it exists to reclaim
vertical chrome); the rail stays a tab strip and each tab opens its frame
in a **Drawer** (the only legitimate Drawer use); Commit.Bar goes
edge-to-edge (radius 0). Touch surfaces use the chip rail's `large` size
(34px), lg Pagination (40 in a 56 band) and keep comfortable (36px) rows.
Everything else is unchanged — same
tokens, same anatomy, narrower.

Implementation (east-ui): widths as `min(<ideal>px, 100%)` or
`clamp(…)` rather than bare pixels; `<Grid
templateColumns="repeat(auto-fit, minmax(240px, 1fr))">` reflows tiles to
one column on phones; `<Splitter collapseBelow={480}>` stacks split panels;
`<Tabs>` is the rail below 1080px and `<Drawer>` shows a rail frame at
≤560px; `height="fill"` + `<Box fill scrollY>` for scroll regions.

## Scenario chrome

Scenario controls (switch/compare toggles) live in the **Header right
cluster** (`xs · short · fixed`), never in Main. Comparison series take
accent hues in fixed order (see charts guideline).

## Production handoff

Every region has a first-class east-ui implementation: `<App>` (shell:
sidebar, breadcrumb slot, logo, routed body via Navigation.config /
`<Pages>`), `<NavList>`, `<Breadcrumb>`, `<Card>` + `<Stat>` (the Frame
roles), `<ActionBar>` (commit bar), `<Grid>` / `<Stack>` / `<Splitter>`
(main layouts), `<Dock>` (rail), `<Tabs>` + `<Drawer>` (rail below 1080px
and at ≤560px). Design to these names — a mock that uses this anatomy
translates 1:1 into East JSX.
