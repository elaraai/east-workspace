# App layout — the canonical East screen

Distilled from the pattern spec (the retired reference pages' `index.html`
§1.4–1.5h — git history; the per-pattern extracts live in
`guidelines/patterns/`), values verbatim. Production implementation:
`@elaraai/east-ui` — `<App>` is
the whole shell (collapsible rail + breadcrumb + logo + routed body);
`<NavList>`, `<Breadcrumb>`, `<Grid>`/`<Stack>` compose the rest.

## Eight rules every screen follows

1. **Decision-first density** — a screen exists to commit one kind of
   decision. Dashboards are forbidden: a surface listing "interesting data"
   without naming its decision doesn't ship.
2. **Trust is visible** — every output names its run, sources, assumptions,
   freshness (run anchor `run #N`, trust chips).
3. **Override is first-class** — every commit surface offers
   `Override · Modify · Apply` in that order; never behind a menu; reason
   capture required.
4. **Status is dot + word** — never tinted pills, coloured cards, badge fills.
5. **Brand-tint = dirty** — `--brand-tint` means an unsaved edit; used
   nowhere else.
6. **Banners over modals** — stale/partial/guardrail/change render as in-flow
   banners next to what they describe; modal only for blocking confirmation.
7. **Mono labels frame everything** — eyebrows/statuses/keys:
   JetBrains Mono · 10–11px · 600 · 0.16em · uppercase.
8. **Composition over invention** — new surfaces compose catalogued patterns;
   a missing pattern gets specified first, not invented in the screen.

## Five regions

```
┌──────────────── Header (sticky top) ────────────────┐
│ Sidebar │            Main             │    Rail     │
│  modes  │       pattern surface       │  evidence   │
└──────────── Commit.Bar (sticky bottom, dirty) ──────┘
```

Invariants: the header always carries the run's trust stamp · the rail
collapses to a tab strip, never disappears · Commit.Bar is sticky-bottom
whenever a patch is dirty.

## Frame — the one card shape

1px `--rule-strong` border · **10px radius** · `--paper` fill · **no shadow**.
Three slots: eyebrow-row (sticky on long bodies) · body (18–22px padding,
required) · footer (optional, `--paper-2` band, top rule). Frames never nest
more than one level. Four roles, no other card shapes:

- **Surface** (default) — holds one pattern surface; eyebrow names it + run anchor
- **Inset** — evidence nested inside a Surface: dashed border, `--paper-2`,
  no eyebrow; reads as a quote, not a sibling
- **Stat** — the one-number frame: mono eyebrow → brand 26px/700 numeral with
  mono unit suffix → mono valence line (`+14% wow · conf 0.78`)
- **Stamp** — dark provenance card (`--brand-900` bg, white text)

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

- Right cluster (pattern-spec header): trust chip + surface actions in
  commit order; state eyebrow (mono 10.5px uppercase: mode · N dirty)
  sits right of the title. No back-button (the breadcrumb is the
  back-button), no logo (lives in the sidebar shell). Below 768px the
  breadcrumb collapses to the parent link; the right cluster wraps.

### Nested pages & breadcrumb depth

The breadcrumb reflects the **page route, not the nav tree** — it can go
deeper than the sidebar. Two rules make nesting predictable: the **title
always names the current page** (the leaf), and the **breadcrumb is every
ancestor above it** from the workspace root down (the workspace name is the
root crumb).

- **Nav depth and route depth move independently.** A rail that stops at
  two levels can host pages three or more deep. The rail highlights the
  *deepest route segment that also exists in the nav*; anything below that
  lives only in the breadcrumb and page title, never in the rail.
  (Example: rail knows Settings › Integrations; the route continues to
  Slack connector — the rail highlights Integrations.)
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

## Sidebar (east-ui: `<App>` rail / `<NavList>`)

Top-level navigation only. **240px** expanded · **56px** collapsed icon rail
(tooltip after 400ms) · toggle chevron or `[` · state persisted per user.
Push, not overlay, on desktop (Main reflows over `--dur-base`); overlay only
≤560px; always collapsed below 768px.

- Right rule 1px · bg `--paper-2` · item height **36px** · active item =
  brand-tint fill, 4px radius, 8px side inset · icon column 16px, gap 10px.
- Item label mono 12px / 600 / 0.12em uppercase · sub-item 11px / 500 /
  0.08em normal case, indented 36px, em-dash prefix · section eyebrow mono
  9.5px / 600 / 0.18em `--ink-4` · divider 1px rule, 10px margin.
- Max two levels. Forbidden: notifications, avatar, settings, anything not a
  mode / sub-item / scope.
- **Logo region**: 64px expanded / 56px collapsed, aligns with Header; 16px
  side padding; 12px rule-free gap below; identity only — no badges,
  version stamps, env tags, search.

## Main

Padding 32px top/bottom · 24px sides · max content width **1480px** centred.
Gap between sibling frames 16px · split gap 20px · grid cell gap 12px.
Three layouts — pick one per surface, never mix (both needed → two screens):

- **Single** — one pattern surface fills the region (the default)
- **Split** — two columns (list left, briefing right); never deeper than 2
- **Grid** — repeated Stat/Reference tiles; 6 cols ≥1280 · 4 ≥960 · 3 ≥768 ·
  2 ≥560 · 1 below

### Layout descriptors (three orthogonal axes per pattern)

- **Size**: `xs` (chrome-inline, never a Main item) · `sm` (3 of 12 cols) ·
  `md` (6) · `lg` (8) · `full` (12, sits alone in its row)
- **Density**: `compact` (~64px row) · `default` (~140px) · `spacious`
  (240px+, hero anchors)
- **Stretch**: `fixed` · `flex` (grows to a cap) · `fill` (absorbs remainder)

Main is a 12-column grid; rows compose by size summing to 12; the rightmost
flex/fill item absorbs any remainder; hero (`full`) patterns are never tiled
with siblings. Tables/planners/queues are `full · fill`; stat cards `sm ·
fixed` (3–4 per KPI strip); tornado/compare/references `md · flex`; filter
chips/search/range/mode toggles are `xs` chrome that lives in eyebrows and
the header, never the Main grid.

## Rail (east-ui: `<Dock>` or a fixed `<Stack>` column)

**320px** fixed · bg `--paper-2` (recedes) · 1px left rule · padding 24px
top / 20px sides · frame stack gap 12px · rail frames padded 12–14px
(tighter than Main's 18–22px). Holds evidence only: provenance stamp,
references, journal. Forbidden: commit actions, settings, navigation.
Collapses to a tab strip below 1080px — never disappears.

## Commit.Bar (east-ui: `<ActionBar>`)

Hidden until a field is dirty. Sticky bottom · height **56px** · padding
12px/24px · `--brand-tint` bg · 1px `--brand-d` border · radius 8px floating
(16px above viewport floor, `--shadow-md`) or 0 edge-to-edge. Animates in
over `--dur-base`, out instantly on apply/discard.
Slots: left = brand dot + "**N changes** pending" + mono dirty-keys summary;
right = `Override · Modify · Apply`. No other actions.

## Responsive & mobile

East surfaces ship desktop, tablet, and mobile from one definition. The
breakpoint ladder (all values from the recipes above, collected):

| Width | What changes |
|---|---|
| <1280 | Main grid 6→4 columns (4 ≥960, 3 ≥768, 2 ≥560, 1 below) |
| <1080 | Rail collapses to a tab strip (topmost frame = default open tab) — never disappears |
| <768 | Sidebar always collapsed (56px icon rail, toggle hidden); breadcrumb collapses to the parent link; header right cluster wraps under the title |
| ≤560 | Sidebar becomes an **overlay** (full-height sheet from the left, scrim over Main, backdrop-tap/Esc dismiss); Main is one column, frames stack full-width |

Mobile shell: prefer the **condensed app bar** (44px — it exists to reclaim
vertical chrome); the rail's mobile presentation is a **Drawer** (the only
legitimate Drawer use); Commit.Bar goes edge-to-edge (radius 0). Touch
surfaces use the chip rail's `large` density (34px) and keep 36px table
rows. Everything else is unchanged — same tokens, same anatomy, narrower.

Implementation (east-ui): widths as `min(<ideal>px, 100%)` or
`clamp(…)` rather than bare pixels; `<Grid
templateColumns="repeat(auto-fit, minmax(240px, 1fr))">` reflows tiles to
one column on phones; `<Splitter collapseBelow={480}>` stacks split panels;
`<Drawer>` hosts the rail on mobile; `height="fill"` + `<Box fill scrollY>`
for scroll regions.

## Scenario chrome

Scenario controls (switch/compare toggles) live in the **Header right
cluster** (`xs · compact · fixed`), never in Main. Comparison series take
accent hues in fixed order (see charts guideline).

## Production handoff

Every region has a first-class east-ui implementation: `<App>` (shell: rail,
breadcrumb slot, logo, routed body via Navigation.config / `<Pages>`),
`<NavList>`, `<Breadcrumb>`, `<ActionBar>` (commit bar), `<Grid>` /
`<Stack>` / `<Splitter>` (main layouts), `<Dock>` (rail). Design to these
names — a mock that uses this anatomy translates 1:1 into East JSX.
