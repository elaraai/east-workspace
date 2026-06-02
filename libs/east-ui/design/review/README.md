# East UI — Design Conformance Review

This is the executive summary of a pixel-level conformance review of the east-ui renderer against the canonical visual design. Scope: the theme configuration (foundation tokens, semantic-token roles, text-styles, layer-styles), **13 recipes**, **49 slot-recipes**, **11 component groups** (charts, layout-primitives, slice-composites, typography-extras, display-extras, forms-composites, collections-inline, overlays-inline, navigation-deep, buttons-extras, feedback-extras), plus an internal audit of `spec.css` itself. Every renderer Chakra semantic token was resolved to a hex via the token crosswalk below and compared against `design/spec.css` + `design/colors_and_type.css` for pixel-level fidelity. The review flags **both** directions of divergence: renderer drift (the renderer disagrees with the spec) **and** spec inconsistency (the spec disagrees with itself, or with `colors_and_type.css` / `tokens.ts`).

> **Nav note.** The nav **spec changed**, so the renderer had to be updated to
> match it — nav is not a deviation to preserve; the spec is canonical and the
> implementation follows. (An earlier pass mis-framed nav as an intentional
> deviation and under-reported the drift.) Nav has since been re-reviewed under
> "spec is the law" and fixed — see
> [`06-nav-implemented-to-spec.md`](06-nav-implemented-to-spec.md); it
> supersedes the `navList` / `navigation-deep` findings in `03` / `04`.

## Headline counts

Non-intentional discrepancies by severity (intentional / documented deviations are excluded from these totals):

| Severity | Count |
|---|---:|
| Critical | 23 |
| Major | 101 |
| Minor | 288 |
| Nit | 125 |
| **Total** | **537** |

Per-category verdict tallies (direction of each non-intentional discrepancy):

| Category | Renderer drift | Spec-internal inconsistency | Spec-vs-tokens conflict | Spec drift |
|---|---:|---:|---:|---:|
| Foundation | dominant | secondary | secondary | — |
| Recipes (13) | dominant | secondary | rare | — |
| Slot-recipes (49) | dominant | secondary | secondary | rare |
| Components (11 groups) | dominant | secondary | secondary | — |
| spec.css consolidation | — | dominant | secondary | — |

The headline pattern: most discrepancies are **renderer drift** (the renderer should move toward the spec), with two recurring systemic roots — the `fg`/`fg.DEFAULT` = `gray.900 #1a2626` vs spec `--ink` = `brand.900 #111b22` split _(✅ resolved 2026-05-29 — `fg` → brand.900; see `00-STATUS.md`)_, and **dead slot-recipes** (codeBlock, commandPalette, gantt, matrix, planner, segmentedMeter, pagination) where a registered recipe is never consumed and the inline renderer is the de-facto spec.

## Top issues

The highest-impact discrepancies (critical and major), sorted critical → major, then by category. Each row: `item` · property · spec → renderer · direction · fix.

| # | item · property | spec → renderer | direction | fix |
|---|---|---|---|---|
| 1 | `charts` · default series colour scale | accent scale brand-first `#488e97` → `SERIES_COLOR_PALETTE` starts at Chakra built-in `blue.solid #3b82f6` | renderer-drift | Replace `SERIES_COLOR_PALETTE` (utils.ts) with the accent token order `[accent.brand, accent.purple, accent.orange, accent.blue, accent.teal, accent.yellow, accent.pink, accent.slate]`; first auto series becomes brand `#488e97`. |
| 2 | `collections-inline:matrix` · segment fill default (index.tsx:430) | `--brand-d #3a7780` (teal) → `"blue.400"` (off-palette Chakra blue) | renderer-drift | Change the matrix segment fallback from `"blue.400"` to `"brand.600"` (`#3a7780`). |
| 3 | `collections-inline:matrix` · selectedBackground default (index.tsx:76) | `--brand-tint #e8f6f7` → `"blue.200"` | renderer-drift | Default `selectedBackground` to `bg.brand.subtle` / brandTint (`#e8f6f7`). |
| 4 | `collections-inline:matrix` · selectedBorderColor default (index.tsx:77) | 2px solid `--brand-d #3a7780` → `"blue.700"` as inset 3px boxShadow | renderer-drift | Default `selectedBorderColor` to `brand.600` (`#3a7780`); use a 2px outline at offset −2px. |
| 5 | `collections-inline:matrix` · hover highlight (index.tsx:78,400) | brand-tint hover (no yellow anywhere in spec) → `"yellow.50"` / hardcoded `"yellow.100"` | renderer-drift | Default `hoverHighlightColor` to brandTint `#e8f6f7` (or `bg.muted`); replace the hardcoded `"yellow.100"`. |
| 6 | `slot:codeBlock` · recipe usage (structural) | `codeBlock` slot recipe should style the rendered block → index.tsx hand-builds a Box/Flex tree, never consumes the recipe (dead code) | renderer-drift | Rewrite index.tsx to consume `useSlotRecipe('codeBlock')` (fix recipe values first), or delete the dead recipe and treat index.tsx as the source. |
| 7 | `slot:commandPalette` · slot-recipe consumption | `commandPalette` slots should theme the palette → built from ChakraDialog + inline Box, recipe never referenced | renderer-drift | Render the dialog with the `elara-command-palette` slots so spec values take effect, or delete the recipe. |
| 8 | `slot:commitBar` · btnPrimary.background | `--brand-d #3a7780` (brand.600) → `brand.700 #2b4b55` | renderer-drift | Change `btnPrimary.background` and `borderLeftColor` to `brand.600` (`#3a7780` / `brand.solid`). |
| 9 | `slot:editableChip` · component vs registered recipe | `editableChip` slots (preview/input/edit/submit/cancel) → index.tsx hand-builds Box/Button, never consumes any slot | renderer-drift | Rewrite `editableChip.ts` to a single-state trigger recipe and consume it via `useSlotRecipe`, deleting unused inline/submit/cancel slots. |
| 10 | `slot:editableChip` · resting background | `.chip` / recipe root `#ffffff` → index.tsx default `gray.100 #f1f5f5` filled gray pill | renderer-drift | Default background to `bg.surface` (white); keep the `.chip.brand` style override path. |
| 11 | `slot:editableChip` · resting border | 1px solid `--rule-strong #cbd5d5` → border only present when `style.borderColor` supplied (defaults to none) | renderer-drift | Default `borderWidth` to `1px` and `borderColor` to `border.strong`; let style override colour only. |
| 12 | `slot:gantt` · slot recipe consumption (dead code) | recipe should style the Gantt → `ganttSlotRecipe` registered but never consumed; SVG reads `useToken("colors", [palette.500, palette.600])` | renderer-drift | Refactor the SVG renderer to read tokens from `useSlotRecipe({key:"gantt"})` and align to the status palette, or delete the recipe. |
| 13 | `slot:gantt` · task bar fill colour | status-driven on `--paper-2` track (committed `#2f7a5b`, proposed `#3a7780`, at-risk `#b85a4a`) → `colorPalette` defaults `"blue"`, solid blue/purple bars | renderer-drift | Map task state → spec status hexes; render a paper-2 track + 1px status border + status progress fill. |
| 14 | `slot:matrix` · slot recipe consumption (dead code) | `matrix` slots should style the renderer → index.tsx never calls `useSlotRecipe`, every slot inline | renderer-drift | Adopt the recipe (`const styles = useSlotRecipe({key:"matrix"})()`) and spread slots; resolves most matrix discrepancies. |
| 15 | `slot:matrix` · bar/selection/hover/emphasis colour family | brand/status hues → `blue.*`/`yellow.*` literals resolving to Chakra built-in palettes, outside the East brand/status palette | renderer-drift | Replace defaults: selection border `brand.900 #111b22`, fill brandTint, hover brandTint, emphasis `status.neg #b85a4a`, segment fallback `brand.500`; drive from tokens, never `blue.*`/`yellow.*`. |
| 16 | `slot:pagination` · renderer wiring (recipe dead) | bordered 28×28 paper chips via Pagination.Item/Ellipsis → `ButtonGroup` + ghost `IconButton`, recipe slots never mounted | renderer-drift | Render `ChakraPagination.Item`/`PrevTrigger`/`NextTrigger`/`Ellipsis` as recipe slots (asChild), then fix the recipe values. |
| 17 | `slot:pagination` · active page background | `--brand-tint #e8f6f7` → `fg.default gray.900 #1a2626` solid dark fill | renderer-drift | `item._selected`/`[data-selected]` background → `bg.brand.subtle` (brandTint); drop the ink-fill comment. |
| 18 | `slot:pagination` · active page text color | `--brand-dd #2b4b55` (brand.700) → `bg.surface` white | renderer-drift | `item._selected` color → `brand.fg` (`brand.700 #2b4b55`). |
| 19 | `slot:planner` · slot recipe consumption (dead code) | styled Planner via `.planner-grid`/`.evt`/`.scenario` → `plannerSlotRecipe` registered, never consumed; renderer is raw ChakraTable + SVG | renderer-drift | Re-architect `collections/planner` to a CSS-grid renderer consuming the recipe and the spec `.planner-*`/`.evt-*` model (spec marks these KEY), or delete the recipe. |
| 20 | `slot:planner` · overall structural model | CSS subgrid `.planner-grid` (240px rail + 1fr cells, AM/PM buckets, now-line) → TanStack-virtualized dual-pane Gantt with horizontal event bars | renderer-drift | Rebuild the renderer around the spec CSS-grid Planner (or formally re-spec the Gantt model — spec is the law). |
| 21 | `slot:planner` · event states (committed/proposed/rejected) | three spec states with dashed borders, grip, hatch, strikethrough → no state vocabulary; fill = `value.background ?? palette.500` | renderer-drift | Add an event-state field to `Planner.Event` IR; render committed (solid `brand.700`), proposed (dashed `brand.600` on brandTint + sub-states), rejected (`gray.400` outline + strikethrough). |
| 22 | `slot:segmentedMeter` · recipe never consumed | `segmentedMeter` slots with spec-aligned values → index.tsx inline Flex/Box, recipe never imported (all slots dead) | renderer-drift | Consume via `useSlotRecipe('segmentedMeter')` mapping bar→track, segments→segment, legend→keyRow/keyItem/keyDot/valueText, or delete and fold values inline. |
| 23 | `slot:treeView` · _selected background | canonical selection fill = paper-3 `#f1f5f5` (Principle 05: brandTint `#e8f6f7` means an unsaved EDIT, "used nowhere else") → `bg.brand.subtle` brandTint | renderer-drift | `_selected`/`[data-selected]` background → `bg.subtle` (`gray.100 #f1f5f5`); reserve brandTint strictly for dirty-edit affordances. |

## Documents

Full per-area findings live in the companion documents:

- [`00-STATUS.md`](00-STATUS.md) — living progress ledger (governing decisions + per-area fix status).
- [`00-RECONCILIATION.md`](00-RECONCILIATION.md) — full per-section + per-discrepancy reconciliation against the current source.
- [`06-nav-implemented-to-spec.md`](06-nav-implemented-to-spec.md) — nav, implemented to the changed spec (supersedes the nav findings in `03`/`04`).
- [`01-foundation.md`](01-foundation.md) — theme config: foundation tokens, semantic-token roles, text-styles, layer-styles, the `fg`/`--ink` split, off-grid policy.
- [`02-recipes.md`](02-recipes.md) — the 13 recipes (badge, button, chip, code, heading, icon-button, input, kbd, link, mark, note, separator, skeleton).
- [`03-slot-recipes.md`](03-slot-recipes.md) — the 49 slot-recipes, including the dead-recipe cluster (codeBlock, commandPalette, gantt, matrix, planner, segmentedMeter, pagination).
- [`04-components.md`](04-components.md) — the 11 component groups (charts, layout-primitives, slice-composites, typography-extras, display-extras, forms-composites, collections-inline, overlays-inline, navigation-deep, buttons-extras, feedback-extras).
- [`05-spec-consolidation.md`](05-spec-consolidation.md) — the internal `spec.css` audit: redundant tokens, dead rules, duplicate definitions, off-grid vs strict-grid conflicts.

## How to visually verify

Compare spec PNGs against renderer PNGs for every flagged atom:

- **Spec PNGs** — `make design-html-all` snapshots every `.pattern` / `.bsys` in `design/*.html` to `packages/east-ui-showcase/dist-design/`.
- **Renderer PNGs** — `make east-ui-examples-html-all` (or a single example via `make east-ui-examples-html-<key>`, e.g. `make east-ui-examples-html-disclosure/tabs`) snapshots every east-ui example to standalone HTML + PNG in `packages/east-ui-components/dist-examples/`.
- **Computed-CSS dumps** — `make probe-slice` / `make probe-collections` emit resolved computed-CSS for the slice and collections surfaces, for pixel-exact value comparison where a screenshot is ambiguous.

After any renderer or recipe change: rebuild, re-snapshot, and Read the PNG.

## Token crosswalk

```
TOKEN CROSSWALK — resolve every renderer Chakra semantic token to a hex via this table BEFORE comparing to the spec.
A "match" = identical resolved pixel value.

spec.css :root var | hex | tokens.ts scale | renderer semantic token (theme/semantic-tokens.ts)
--ink          #111b22  brand.900   ⚠ renderer fg / fg.DEFAULT = gray.900 (#1a2626). The spec's primary ink is brand.900 (#111b22), NOT gray.900 — treat any text using fg/gray.900 vs spec --ink as a candidate drift (#1a2626 vs #111b22).
--ink-2        #2b4b55  brand.700   (no dedicated fg.* role; equals brand.fg / brand.emphasized; spec uses it for emphasised body/value text)
--ink-3        #4a5f5f  gray.600     fg.muted ✓
--ink-4        #6b8080  gray.500     fg.subtle ✓
--ink-5        #9bb0b0  gray.400     (".muted-2"; no named role)
--paper        #ffffff  white        bg.surface ✓
--paper-2      #f8fafa  gray.50      bg.canvas / bg.panel ✓
--paper-3      #f1f5f5  gray.100     bg.muted / bg.subtle ✓
--rule         #e2e8e8  gray.200     border.subtle / border.muted ✓
--rule-strong  #cbd5d5  gray.300     border.strong ✓
--brand        #488e97  brand.500    border.focus / focusRing / border.brand
--brand-d      #3a7780  brand.600    brand.solid / link.DEFAULT ✓  (same hex as --info)
--brand-dd     #2b4b55  brand.700    brand.fg / brand.emphasized / link.hover ✓ (same hex as --ink-2)
--brand-l      #94f9f9  brand.200
--brand-tint   #e8f6f7  brandTint    bg.brand.subtle / brand.muted ✓
--pos          #2f7a5b  status.pos   fg.success / ink.success ✓
--neg          #b85a4a  status.neg   fg.danger / ink.danger / ink.caution ✓
--warn         #b8862d  status.warn  fg.warning / ink.warning ✓
--info         #3a7780  status.info  fg.info ✓
Fonts: --font-body = Inter Tight (Chakra "body"), --font-brand = DM Sans ("heading"), --font-mono = JetBrains Mono ("mono").
Radii: sm 4 / md 6 / lg 8 / xl 12 / 2xl 16 / full 9999. Spacing: 4px grid. Shadows: cool ink rgba(17,27,34,*). All match colors_and_type.css.
OFF-GRID NOTE: spec.css uses deliberate off-4px-grid values (font 12.5/13.5/11.5/10.5/9.5px; padding 6/10/14/18/22px). tokens.ts states a strict 4px grid. If the renderer rounds an atom to the grid (e.g. 12px instead of spec 12.5px, padding 16px instead of 18px), report exact values both sides — that is real visible drift.
```