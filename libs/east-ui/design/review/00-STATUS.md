# Design Conformance — Fix Progress Ledger

Living status of applying the `design/review/` findings to the renderer/theme.
**A new session should read this file first.** Update it as each area is fixed.

> **Full per-section + per-discrepancy reconciliation:** [`00-RECONCILIATION.md`](00-RECONCILIATION.md) — every one of the 77 review sections re-checked against the current source (resolved / partial / clean / open / deferred / blocked), and each `01`–`05` section now carries an inline status banner.

## Applied-fixes log — branch `ui-review-reconciliation` (PR #14)

Commits on this branch (oldest → newest):
1. **`48d19f64`** — review docs + reconciliation + the first 10 fixes: foundation ink → brand.900, nav→spec, charts→accent token, matrix colours, table header, pagination (recipe adopted), editableChip (recipe adopted), codeBlock colours, dialog/drawer backdrop scrim, ToggleTip dark chip. Plus showcase DX (src alias + slimmer `make showcase`).
2. **`b3df8817`** — atom-recipe spec drifts: **button** (md 12.5px, commit 0.14em + 14/22 padding, lh 1.15), **chip** (text brand.700, more-border brand.600), **input** (13px + 7/10), **kbd** (6px/0.04em/2px), **separator** (default → subtle gray.200).
3. **`de9e748d`** — slot-recipe spec drifts: **status** (label fg.muted, dot fg.subtle, gap 6px), **tag** (×+dashed fg.subtle, brand brand.700, gap 6px), **meter**+**barStrip** (fill brand.500, radius 3px), **accordion** (chevron fg.subtle, padding 18/14, gap 10px, lh 1.5), **dataList** (label fg.subtle+0.14em, 116px/14px).

4. **`f8c0d67b`** — extension-webview nav parity: flattened the workspace tree (dropped the INPUTS/TASKS group headings → one flat list of sub-rows with a leading type icon, database=input / bolt=task), fixed the nested active-pill (removed the 36px paddingInlineStart that fought the recipe's active state), breadcrumb link brand.700→brand.600. Webview built; extension repackaged + installed (v1.0.4). **To confirm live:** density/spacing parity with the showcase.

5. **`a91d4e53`** — five atom recipes to spec: **mark** (text brand.700 = --brand-dd), **badge** (brand variant brand.600 text + borderless per `.pattern-anchor`; stakesMid brand.700 text + brand.600 border per `.stakes-tag.mid`), **note** (accent stripe brand.600 = --brand-d on base + brand accent), **heading** (xs/h5 → Inter Tight `body` font, xl line-height → tight 1.25, sm/h4 stray -0.01em tracking removed), **icon-button** (xs glyph 12→13px per `.x-btn`). All 5 snapshot-verified. Remaining for these = spec-internal-inconsistency only (warn-hue, x-btn radius) → `05-spec-consolidation.md`, plus note's italic-leak (structural, 04).

6. **`f749cbdc`** — **new tokens + forms batch.** Promoted two repeated off-grid spec values to named tokens (owner-approved): `radii.xs` = 3px (small controls/chips) and `fontSizes.control` = 13px (form-control text); swept every `borderRadius: "3px"` (7 files) and `fontSize: "13px"` (17 files) across recipes/slot-recipes to reference them. Then forms recipes to spec: **checkbox** (box 14px, radius xs, border.strong, label control; indeterminate stays brand.600 — native `accent-color: --brand-d` tints it, so the "should be grey" recon note was NOT spec-backed), **combobox** (control border.strong + focus brand.600, input control/7-10), **input** (resting border.subtle→**border.strong** per `.p-input` spec; focus brand.500→brand.600; flushed too; stale box-shadow-glow JSDoc removed), **slider** (fill+thumb-border brand.500→brand.600, thumb 12→14px, track radius full — per `.wb-*`), **radioGroup** (control 16→14px, dot fixed 6px, label control; removed `§Radio (L…)` comment), **segmentGroup** (brand-tint active text brand.800→brand.700 per `.lib-seg-btn`; removed `§Segmented`/bsys-compliant/hex comments — recon's divider/tracking/uppercase claims were WRONG, spec already matches), **switch** (label control; brand.600 on-track is correct brand-d accent, no-spec-analog otherwise). Also cleaned badge JSDoc style-attr dump. All 7 forms snapshot-verified.

7. **`be733bcd`** — **long-tail batch 1.** Recipe-only spec fixes: **metricChip** (11.5px, radius xs, paddingY 3px, base/flat → fg.subtle per `.delta.flat`, brand → brand.600 per `.delta.brand`), **showMore** (hover colour-only per `.btn-link:hover`, dropped underline), **tabs** (inactive fg.muted→fg.subtle; removed `§Tabs`/L-ref/style-dump JSDoc), **select** (trigger → input parity: border.strong, focus brand.600, control font, 7/10 padding), **menu** + **popover** + **hoverCard** (swept raw `{colors.gray.*}`/`{colors.white}` literals → semantic tokens fg / bg.surface / border.strong / fg.subtle / fg.muted — now dark-mode-correct). **tag** banner corrected (was already fixed in de9e748d). Inline-visible recipes snapshot-verified; overlays (menu/popover/hoverCard) confirmed via clean build (content not visible in static snapshot). Known minor: popover/hoverCard arrow CSS-var bg stays literal (Chakra arrow needs a concrete value).

8. **`ef507d3f`** — **long-tail batch 2.** **optionList** (itemDescription fg.subtle, padding 12/16, hover bg.subtle), **treeView** (_selected text brand.700), **avatar** (brand variant + fontWeight bold + letterSpacing 0.05em per `.mx-avatar`). Snapshot-verified (avatar/option-list/tree-view PNGs). Stale banners corrected: **dataList** + **emptyState** were already at spec (fixes had landed earlier / the recon rows were stale). **field** deferred — its label drift is in the shared `caption.eyebrow` textStyle (also used by select/dataList/optionList), so it's a one-place `text-styles.ts` edit belonging to a foundation textStyle pass, not a per-recipe patch.

9. **`2bf92b09`** — **foundation textStyle pass.** `text-styles.ts` `caption.eyebrow`: letterSpacing `{letterSpacings.widest}` (0.12em)→`{letterSpacings.widest2}` (0.18em) + color fg.muted→fg.subtle (--ink-4), matching the unanimous spec caption-eyebrow tier (`.cell .lbl`, `.cap-eyebrow`, `.sc-eyebrow` all 0.18em/--ink-4). One edit corrects field + select/optionList/combobox eyebrow labels. The general `eyebrow` (0.12em/brand.600 per `.eyebrow`) is unchanged. dataList keeps its explicit 0.14em override (its own data-rail choice). Resolves the field banner.

10. **(uncommitted)** — **component-coupled renderer bugs.** First batch of fixes that live in the renderer (not a recipe value), each one a case where a component was overriding/blocking the theme rather than consuming it:
    - **collapsible** — the chevron was missing entirely (no indicator rendered) and the recipe's `&[data-state=open]` rotation selector on the `indicator` slot never fired (the indicator carries no `data-state`). Renderer now renders an explicit chevron span (`faChevronDown`) inside the Trigger, styled from `useSlotRecipe("collapsible").indicator`; the recipe drives rotation from the **trigger's** open state (`&[data-state=open] [data-collapsible-chevron] { rotate 0 }`, base `rotate(-90deg)`). `ChakraCollapsible.Context` render-prop was tried first and **silently renders nothing** — avoid it. Verified: chevron points right (closed) / down (open).
    - **carousel** — prev/next were `<PrevTrigger asChild><IconButton/></PrevTrigger>`, so the `carousel` slot-recipe's `prevTrigger`/`nextTrigger` slots never applied (the IconButton recipe won). Now bare `<ChakraCarousel.PrevTrigger>` with a `faChevronLeft/Right` child → recipe auto-applies the square outline-chip slots; `controlColor`/`controlBackground` style escape-hatches still passthrough. Verified: 28px square outline chips; ColourSlots example shows the escape-hatches.
    - **progress** — `trackColor` was set via an inert `--chakra-colors-bg-emphasized` CSS var on a wrapper `<Box>` that didn't reach the Track. Now applied directly as `style.background` on `ChakraProgress.Track` (fill already direct on Range).
    - **hover-card** — `<Content padding minW maxW>` hardcoded inline, blocking the `hoverCard` recipe's `size` variants. Dropped → recipe sizing applies (matches the `04` line-164 finding).
    All 4 snapshot-verified after an explicit `pnpm --filter @elaraai/east-ui-components run build` (the snapshot make target renders from `dist`, it does NOT rebuild — source changes need a build first).

All built + snapshot/probe-verified, pushed to origin (1–9). **Remaining:** the structural batch (gantt/matrix-size-shape/planner/shared-table-chrome/table-numeric-IR/commandPalette) + the long tail of partial colour/px drifts in the per-section tables of `00-RECONCILIATION.md`.

> A concurrent agent is editing `packages/east-ui-components/src/charts/**` (and likely `slice/**`) on this same branch — leave charts + slice to them; scope every commit to your own files; don't build simultaneously.

Governing decisions (from the owner):
- **Primary ink = `brand.900` `#111b22`** (spec.css `--ink`). ✅ applied 2026-05-29: renderer `fg`/`fg.DEFAULT`/`fg.default` base + `colors_and_type --fg-primary` now brand.900 (dark mode unchanged). Resolves the systemic "text gray.900 vs --ink" class across the review.
- **Dead slot-recipes → adopt the recipe everywhere** (rewire the renderer to consume it; fix recipe values to spec), not inline patches.
- **Theme is the single source of truth** (HARD CONSTRAINT): design values live in tokens/recipes/slot-recipes; components consume them, never hardcode hex/palette literals. See memory `feedback-theme-single-source`.
- Nav: the **spec changed**; the renderer follows it (not a deviation to preserve).

Commits 1–9 are pushed; the component-coupled batch (10) is uncommitted in the working tree.

## Status by area

| Area | Doc | Status | Verified | Notes |
|---|---|---|---|---|
| Review docs written | all | ✅ done | — | 537 non-intentional findings (23🔴 / 101🟠 / 288🟡 / 125⚪) |
| **Nav** (header/sidebar/navList/breadcrumb) | `06` | ✅ done | ✅ snapshot + live | inset pill, white header, gray.300 chrome rules (bleed fix) |
| **Charts** series palette | `04` charts | ✅ done | ✅ snapshot | now consumes `accent` token, brand-first |
| **Matrix** colours | `03`/`04` | ✅ done (colour) | ✅ snapshot | blue/yellow defaults → brand/status/ink tokens; emphasis=neg outline (red, verified); selection=2px ink outline + brandTint; segment fallback=brand.solid. **Size/shape + full recipe adoption deferred to structural batch** (below). |
| **Table** | `03`/`04` | ✅ done | ✅ build + snapshot | Recipe-driven via `useSlotRecipe({key:"table"})` (slots were inert — Chakra's built-in Table recipe won; now explicitly consumed + `css=`). Header eyebrow mono 10px/0.16em/`gray.500`(=`--ink-4`)/paper-2; **density-derived single row height** drives header + body (compact 27 / cozy 36 / comfortable 42px), `rowHeight` prop honoured only when no density; cells vertically centered (spec reads centered); resize handle hover-revealed matching the Matrix grip geometry. Examples pruned 27→16. Numeric-align IR field = **won't-do** (per-cell `render`). |
| **Pagination** (adopt recipe + colours) | `03` | ✅ done | ✅ snapshot | now consumes the `pagination` slot recipe (was ButtonGroup+IconButton); bordered chips, brand-tint active + brand.700 text + brand border, muted "•••" ellipsis (was a dark btn-fill box), ghost chevrons |
| **editableChip** (adopt recipe + colours) | `03` | ✅ done | ✅ probe | recipe simplified to a trigger-chip (root + trigger slots, size variant); component now consumes it; resting = white bg + 1px `border.strong` + `brand.fg` text (was a `gray.100` filled pill); `style.*` overrides preserved. ⚠ `make east-ui-examples-html-display/editable-chip` snapshot is FLAKY — captures "Loading…" before the dynamic import settles; verify via a direct Playwright probe (`/tmp/probe.ts` against the snapshot vite server) instead. |
| **codeBlock** (off-palette colours) | `03` | ✅ done (colours) | ✅ snapshot | diff +/- → `status.pos`/`status.neg` (muted green/red, was Chakra `green.*`/`red.*`); highlight → `bg.warning.subtle` (was `yellow.100`); line-number → `fg.subtle`. **Recipe-chrome adoption deferred** — the `codeBlock` recipe is an incomplete model (doesn't cover diff/highlight/line-numbers); extend or delete it (misleading dead code) — structural-batch item. |
| commandPalette (adopt recipe) | `03`/`04` | 📋 backlog | — | dead recipe; bypasses with raw Dialog (a dialog rebuild, not a swap) |
| **Dialog/drawer backdrop scrim** | `04` | ✅ done | ✅ probe (open) | dialog + drawer backdrop `rgba(17,27,34,0.04)` → `{colors.overlay.backdrop}` (0.40 scrim), matching commandPalette. Verified by opening a dialog: proper 40% dim + computed bg `rgba(17,27,34,0.4)`. Still open in overlays-inline (`04`): dialog content radius 10px (non-token) vs spec, popover radius 3-way inconsistency. |
| **ToggleTip** dark surface | `04` | ✅ done | ✅ probe (open) | was a white default popover; now consumes the `tooltip` recipe's `content`+`arrow` slots → dark ink chip (`fg.default` bg `rgb(17,27,34)` + white text + dark arrow), verified by opening it. Added `borderWidth:0` to the tooltip `content` slot (borderless dark chip; no-op for Tooltip, removes the popover border for ToggleTip). Single-source reuse — no inline values. |
| **segmentedMeter** | `03` | ✅ clean (no fix) | code review | component is already token-driven (`TONE_FILL` → `fg.success/warning/danger/info`; track `gray.100`; default `fg.info`; NO off-palette literals). Recipe is dead AND models a different idiom (gapped `.bf2-conf`, 2px segment gaps) vs the component's FLUSH meter — adopting it would change the visual; adopt-vs-delete needs a flush-vs-gapped design call. Deferred. |
| **Gantt** (renderer + IR refactor) | `03` | ✅ done | ✅ live-DOM probe + snapshot | `Gantt.Task.status` (committed/proposed/atRisk) → status palette (`fg.success`/`fg.info`/`fg.danger`, zero hexes) on a `bg.canvas` (paper-2) track + 1px status border + status progress fill, radius 2, fixed 26px bar centred in the row; `Gantt.Milestone.kind` (interim=`fg.warning` amber / release=`fg.info` teal) as a fixed 14px diamond + 2px white border, label centred below in the fill colour; **density** (compact/condensed/comfortable → row 44/56/64 + header 36/44/52, mirroring Table's mapping); mono uppercase eyebrow headers + month axis (`caption.eyebrow` = ink-4); 1px `fg.info` now-line (renders only when the present is in range); adopted `useSlotRecipe({key:"gantt"})` for the header band. Label colour fill-based (white on fill, ink on empty track). **Cut:** overlays, per-event colour escapes, chrome overrides, `taskBorderRadius`/`labelColor`/`labelFontSize`/`labelFontWeight`, **and tooltip** (popover only now — task + milestone). The Gantt **popover chrome matches the general east-ui Popover exactly** (padding 14/16, minW 240, maxW 360, fontSize 13 + the shared ChakraPopover recipe — verified identical computed styles). **Header matches the Table exactly:** the left-pane column headers AND the month axis consume the `table` `columnHeader` slot (mono 10px/0.16em/uppercase/gray.500) at the Table's header height; the shared `HeaderControls` was the culprit (hardcoded 14px sans) — fixed to inherit the slot, and Planner adopted the slot too. Milestone diamond uses `paint-order:stroke` so the 2px white border sits outside the fill (spec-crisp). Examples 25→13, 40 IR tests pass. Verified via live-DOM probe (status committed 41 / atRisk 1 / proposed 1; diamonds fg-info 4 / fg-warning 2; header font identical to Table) since the snapshot outerHTML is lossy for the flex-table SVGs. |
| **Planner** (renderer rebuild + IR) | `03` | ⛔ blocked | — | **needs design decision** (CSS-grid Planner vs re-spec Gantt) + `Planner.Event` event-state IR field |
| **Foundation: `fg`/`--ink`** = brand.900 | `01` | ✅ done | ✅ build+snapshot | `fg.DEFAULT`/`fg.default` base + `colors_and_type --fg-primary` → brand.900; `typography/text` renders clean |
| Off-grid rounding (12.5/13.5/10.5px etc.) | all | 📋 backlog | — | mostly minor/nit |
| **spec.css consolidation** | `05` | 📋 backlog | — | dead `._dummy_*`, dup `.btn.primary:hover`, `--ink` vs `--fg-primary`, off-grid, chrome-rule `--rule`→`rule-strong`, 3 banner systems |

Legend: ✅ done · 🚧 doing · 📋 backlog · ⛔ blocked (needs a decision)

## Detail

### Nav — ✅ done (2026-05-29)
Spec changed; renderer updated to match. See `06-nav-implemented-to-spec.md` for the full delta.
- Files: `theme/layer-styles.ts` (`header.bar` bg→white, 14/16 padding; chrome rules kept `border.strong`/gray.300 to avoid the same-luminance bleed), `theme/slot-recipes/navList.ts` (active = inset brand-tint pill), `navigation/nav-list/index.tsx` (comment), `east-ui-showcase/App.tsx` (breadcrumb link brand.600 + comment).
- Verified: `navigation/nav-list` re-snapshot (left-rule gone, inset pill); showcase shell live (bleed fixed, owner-confirmed).
- Supersedes the `navList`/`navigation-deep` findings in `03`/`04`.

### Charts — ✅ done (2026-05-29)
Fixed at source: series colour now resolves to the theme `accent` token in canonical order (brand-first), no hardcoded palette list.
- Files: `charts/utils.ts` — `SERIES_COLOR_PALETTE` = accent keys; `getDefaultSeriesColorToken` → `accent.<key>`; `getPivotColorToken` shades the matching scale family (`slate`→`gray`).
- Verified: `charts/bar` + `charts/line` re-snapshot — single/lead series render brand teal `#488e97`.
- Remaining nit (separate, `04`): `sparkline` default stroke is `currentColor`, not `brand`; can fold in with the sparkline pass.

### Matrix — 🚧 doing
Adopt `theme/slot-recipes/matrix.ts` and recolour the inline `blue.*`/`yellow.*` defaults in `collections/matrix/index.tsx` to spec tokens. Spec colours: selected = 2px outline `--ink` (brand.900) **no fill**; emphasis = 2px outline `status.neg` + 6% neg tint; brushed = 1px dashed `brand.600` + 5% brand tint; segments category-semantic (committed=pos, pending=warn, booked=brand-d, atrisk=neg); no blue/yellow.

### Gantt / Planner — backlog/blocked
Gantt is an SVG-renderer refactor (status palette + mono axis + now-line + fixed 14px diamond), tractable. Planner is a **rebuild** to the spec CSS-grid model + a `Planner.Event` event-state IR field, and needs a design decision first (spec CSS-grid Planner vs keep the Gantt model and re-spec). Do not start Planner without that decision.

## STRUCTURAL COLLECTIONS BATCH (the real next effort)

Point-fixing colour is insufficient for the collections. The review captured these as scattered per-component symptoms; they share roots and should be done together. **These items partly correct gaps the review under-emphasized — recorded here so they aren't lost.**

1. **Shared table chrome (consolidation gap — review caught symptoms only).** Table, Gantt, Planner, and Matrix each **hand-roll their own header/cell/axis chrome**; the Table recipe's header/cell styling was never made the shared source, so Table's fixes did **not** propagate. Symptoms in the docs: Matrix colHeader = body-font ~14px gray.700 (not mono-uppercase eyebrow); Gantt tick labels body-font; Planner axis sans `fg.default`. **Fix:** make the `table` recipe (or a shared `TableChrome`/header-cell primitive) the single source the Gantt/Planner/Matrix table panes consume.

2. **Table is NOT fully spec-compliant** (`03` slot:table). Column-header colour (→ `fg.subtle`) and tracking (0.16em) are RESOLVED. Remaining minors: cells vertically centered → spec `vertical-align: top`; footer/total possible double bottom rule. **Numeric-column align/mono is explicitly won't-do** (owner 2026-05-29) — per-cell `render` UIComponent covers it; no `align`/`numeric` IR field.

3. **Matrix size + shape** (live renderer, not just the dead recipe). Live cell height = `SIZE_PRESETS.md` **52px** → spec `.mx-cell` **44px**; bars render **height 100% (full-cell fill)** → spec `.mx-bar` **fixed 24px centered** (vert `.mx-cell.vert .mx-bar` 32px + 1px rule border). **Coupled to the drag-resize math** (`segPxV = pct% × cellHeight`, resize handlers pass `cellHeight`) — cannot be a safe one-liner; must be reworked alongside the recipe adoption.

4. **Matrix / Gantt / Planner recipe adoption** — consume `useSlotRecipe` (each recipe is currently dead code); brings the correct 44px/24px/mono-header/now-line values from the theme.

5. **Planner** also needs the `Planner.Event` event-state IR field + a **design decision** (spec CSS-grid model vs keep Gantt + re-spec) — see above. **Blocked.**

Suggested sequence: (a) settle Table to spec (cell vertical-align + footer rule; **no** numeric-align IR field — won't-do) → (b) extract/share the table chrome → (c) Matrix recipe adoption (size+shape+headers) → (d) Gantt SVG refactor → (e) Planner (after the design decision).

### Active plan — Table → shared chrome → Gantt (owner-confirmed 2026-05-29)

Decisions taken with the owner this session:

- **Spec compliance is mandatory, not a menu.** Renderer defaults *become* the spec; there is no "lighter-touch" variant. Where the spec contradicts itself, take the canonical **inline-Gantt** (`configure.html`) value and record the pick in `05`: month-header = mono 11px/600/**0.18em**/ink-4 (over the `.mx-h` 10px/0.1em); bar-label = **11px** (over `.mx-bar .seg` 10px).
- **The Gantt left pane reading as a different component IS the bug.** Grounded: Table + Gantt + Planner already share only the **layout** helpers in `collections/shared/column-pinning.tsx` (`getHeaderCellStyle`/`getCellStyle` = widths/pinning/flex). The **visual** chrome (mono-uppercase eyebrow header, paper-2 bg, hairline rules, cell padding/radius, numeric align) is hand-rolled inline in each component's JSX — so Table's fixes never reach Gantt/Planner/Matrix. Fix = extract the visual chrome into `shared/` next to the layout helpers and have all four panes consume it.

Sequence being executed (a→d above; Planner/e stays blocked on its design decision):

1. **Table to spec** — ✅ DONE. Recipe-driven (`useSlotRecipe({key:"table"})`), density-derived row height (compact 27/cozy 36/comfortable 42), header eyebrow mono/0.16em/gray.500/paper-2, centered cells, hover-revealed resize grip. Examples 27→16.
2. **Gantt** — ✅ DONE. IR: `Task.status` (committed/proposed/atRisk) + `Milestone.kind` (interim/release) + root `density`; cut overlays / per-event colour escapes / chrome overrides / `taskBorderRadius`/`label*`. Renderer: status palette via semantic tokens (`fg.success`/`fg.info`/`fg.danger`, no hexes) on a `bg.canvas` track + 1px status border + progress fill, fixed 26px bar, radius 2, density-driven row + header height, mono uppercase month axis (ink-4 via `caption.eyebrow`), fixed 14px diamond + 2px white border via `paint-order:stroke` (interim=`fg.warning` / release=`fg.info`), 1px `fg.info` now-line; adopted `useSlotRecipe({key:"gantt"})`. Header (left columns + month axis) + Planner consume the `table` `columnHeader` slot so all three collections share one header type (fixed `HeaderControls` to inherit the slot). Tooltip removed — popover only, and its chrome matches the general east-ui Popover. Examples 25→13, 40 IR tests pass; verified via live-DOM probe.
3. **Extract shared visual chrome** into `collections/shared/` (header-cell + body-cell chrome) so Gantt/Planner/Matrix consume one source — fold in opportunistically as the Gantt left pane is brought to the Table header/cell look.

**Gantt IR + example prune (owner-confirmed 2026-05-30).** Examples are search-index/doc fixtures — exercise each feature once, no more. From 25 → **13 keepers** (tooltip removed — popover only).

Keepers (13): `ganttBasic`, `ganttCustomHeaders`, `ganttWithMilestones`, `ganttWithProgress`, `ganttStatusByType` (was `ganttColorful`, rewritten: per-row `status` via `ifElse` — committed/proposed/at-risk), `ganttStyled`, `ganttComplexColumns` (absorbs `ganttColumnRenderWithRow` value+render coverage), `ganttInteractiveCallbacks`, `ganttReactiveDrag`, `ganttFrozenColumns`, `ganttRowStatus`, `ganttTaskPopover`, `ganttRichLabel` (absorbs `ganttVisualTokens` label-shape coverage).

Removed (11): `ganttCustomHeight` (one prop, inline elsewhere), `ganttPerEventColours` + `ganttMilestoneColours` (per-event colour escapes — feature cut), `ganttChromeColours` (chrome overrides — feature cut), `ganttTaskOverlays` + `ganttMilestoneOverlays` (overlays — feature cut), `ganttMilestoneTooltip` + `ganttMilestonePopover` (same slot API as the task examples), `ganttTaskPopoverWithCallback` (niche coexist), `ganttColumnRenderWithRow` (merged), `ganttVisualTokens` (merged; `taskBorderRadius`/`labelColor` cut).

**IR changes (east-ui `Gantt`):** add `Task.status` enum (committed/proposed/at-risk); add root `density`; remove `Task.background`/`stroke`/`labelColor`/`progressFill`, `Milestone.fill`/`stroke`, root `gridColor`/`todayMarkerColor`/`headerBackground`/`headerColor`/`taskBorderRadius`/`labelColor`/`labelFontSize`/`labelFontWeight`. Status drives colour — no `colorPalette` on tasks/milestones. Lockstep: `gantt.spec.ts` `Assert.examples` wiring + every matching `@example` JSDoc in `src` (TypeDoc parity HARD RULE).
