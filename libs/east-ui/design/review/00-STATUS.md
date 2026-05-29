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

7. **(uncommitted)** — **long-tail batch 1.** Recipe-only spec fixes: **metricChip** (11.5px, radius xs, paddingY 3px, base/flat → fg.subtle per `.delta.flat`, brand → brand.600 per `.delta.brand`), **showMore** (hover colour-only per `.btn-link:hover`, dropped underline), **tabs** (inactive fg.muted→fg.subtle; removed `§Tabs`/L-ref/style-dump JSDoc), **select** (trigger → input parity: border.strong, focus brand.600, control font, 7/10 padding), **menu** + **popover** + **hoverCard** (swept raw `{colors.gray.*}`/`{colors.white}` literals → semantic tokens fg / bg.surface / border.strong / fg.subtle / fg.muted — now dark-mode-correct). **tag** banner corrected (was already fixed in de9e748d). Inline-visible recipes snapshot-verified; overlays (menu/popover/hoverCard) confirmed via clean build (content not visible in static snapshot). Known minor: popover/hoverCard arrow CSS-var bg stays literal (Chakra arrow needs a concrete value).

8. **(uncommitted)** — **long-tail batch 2.** **optionList** (itemDescription fg.subtle, padding 12/16, hover bg.subtle), **treeView** (_selected text brand.700), **avatar** (brand variant + fontWeight bold + letterSpacing 0.05em per `.mx-avatar`). Snapshot-verified (avatar/option-list/tree-view PNGs). Stale banners corrected: **dataList** + **emptyState** were already at spec (fixes had landed earlier / the recon rows were stale). **field** deferred — its label drift is in the shared `caption.eyebrow` textStyle (also used by select/dataList/optionList), so it's a one-place `text-styles.ts` edit belonging to a foundation textStyle pass, not a per-recipe patch.

All built + snapshot/probe-verified, pushed to origin. **Remaining:** the structural batch (gantt/matrix-size-shape/planner/shared-table-chrome/table-numeric-IR/commandPalette) + the long tail of partial colour/px drifts in the per-section tables of `00-RECONCILIATION.md`.

> A concurrent agent is editing `packages/east-ui-components/src/charts/**` (and likely `slice/**`) on this same branch — leave charts + slice to them; scope every commit to your own files; don't build simultaneously.

Governing decisions (from the owner):
- **Primary ink = `brand.900` `#111b22`** (spec.css `--ink`). ✅ applied 2026-05-29: renderer `fg`/`fg.DEFAULT`/`fg.default` base + `colors_and_type --fg-primary` now brand.900 (dark mode unchanged). Resolves the systemic "text gray.900 vs --ink" class across the review.
- **Dead slot-recipes → adopt the recipe everywhere** (rewire the renderer to consume it; fix recipe values to spec), not inline patches.
- **Theme is the single source of truth** (HARD CONSTRAINT): design values live in tokens/recipes/slot-recipes; components consume them, never hardcode hex/palette literals. See memory `feedback-theme-single-source`.
- Nav: the **spec changed**; the renderer follows it (not a deviation to preserve).

All changes so far are **uncommitted** in the working tree.

## Status by area

| Area | Doc | Status | Verified | Notes |
|---|---|---|---|---|
| Review docs written | all | ✅ done | — | 537 non-intentional findings (23🔴 / 101🟠 / 288🟡 / 125⚪) |
| **Nav** (header/sidebar/navList/breadcrumb) | `06` | ✅ done | ✅ snapshot + live | inset pill, white header, gray.300 chrome rules (bleed fix) |
| **Charts** series palette | `04` charts | ✅ done | ✅ snapshot | now consumes `accent` token, brand-first |
| **Matrix** colours | `03`/`04` | ✅ done (colour) | ✅ snapshot | blue/yellow defaults → brand/status/ink tokens; emphasis=neg outline (red, verified); selection=2px ink outline + brandTint; segment fallback=brand.solid. **Size/shape + full recipe adoption deferred to structural batch** (below). |
| **Table** header colour + tracking | `03`/`04` | ✅ done (header) | ✅ build | header `fg.muted`→`fg.subtle` (gray.500=`--ink-4`) in recipe + component default; tracking 0.12→**0.16em**. **Still open (structural):** numeric columns left-aligned body font → needs IR `align`/`numeric` field; cells flex-centered vs spec `vertical-align:top`; footer double-rule. |
| **Pagination** (adopt recipe + colours) | `03` | ✅ done | ✅ snapshot | now consumes the `pagination` slot recipe (was ButtonGroup+IconButton); bordered chips, brand-tint active + brand.700 text + brand border, muted "•••" ellipsis (was a dark btn-fill box), ghost chevrons |
| **editableChip** (adopt recipe + colours) | `03` | ✅ done | ✅ probe | recipe simplified to a trigger-chip (root + trigger slots, size variant); component now consumes it; resting = white bg + 1px `border.strong` + `brand.fg` text (was a `gray.100` filled pill); `style.*` overrides preserved. ⚠ `make east-ui-examples-html-display/editable-chip` snapshot is FLAKY — captures "Loading…" before the dynamic import settles; verify via a direct Playwright probe (`/tmp/probe.ts` against the snapshot vite server) instead. |
| **codeBlock** (off-palette colours) | `03` | ✅ done (colours) | ✅ snapshot | diff +/- → `status.pos`/`status.neg` (muted green/red, was Chakra `green.*`/`red.*`); highlight → `bg.warning.subtle` (was `yellow.100`); line-number → `fg.subtle`. **Recipe-chrome adoption deferred** — the `codeBlock` recipe is an incomplete model (doesn't cover diff/highlight/line-numbers); extend or delete it (misleading dead code) — structural-batch item. |
| commandPalette (adopt recipe) | `03`/`04` | 📋 backlog | — | dead recipe; bypasses with raw Dialog (a dialog rebuild, not a swap) |
| **Dialog/drawer backdrop scrim** | `04` | ✅ done | ✅ probe (open) | dialog + drawer backdrop `rgba(17,27,34,0.04)` → `{colors.overlay.backdrop}` (0.40 scrim), matching commandPalette. Verified by opening a dialog: proper 40% dim + computed bg `rgba(17,27,34,0.4)`. Still open in overlays-inline (`04`): dialog content radius 10px (non-token) vs spec, popover radius 3-way inconsistency. |
| **ToggleTip** dark surface | `04` | ✅ done | ✅ probe (open) | was a white default popover; now consumes the `tooltip` recipe's `content`+`arrow` slots → dark ink chip (`fg.default` bg `rgb(17,27,34)` + white text + dark arrow), verified by opening it. Added `borderWidth:0` to the tooltip `content` slot (borderless dark chip; no-op for Tooltip, removes the popover border for ToggleTip). Single-source reuse — no inline values. |
| **segmentedMeter** | `03` | ✅ clean (no fix) | code review | component is already token-driven (`TONE_FILL` → `fg.success/warning/danger/info`; track `gray.100`; default `fg.info`; NO off-palette literals). Recipe is dead AND models a different idiom (gapped `.bf2-conf`, 2px segment gaps) vs the component's FLUSH meter — adopting it would change the visual; adopt-vs-delete needs a flush-vs-gapped design call. Deferred. |
| **Gantt** (SVG renderer refactor) | `03` | 📋 backlog | — | status palette + mono axis + now-line + fixed diamond; >recipe |
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

2. **Table is NOT fully spec-compliant** (`03` slot:table). Majors: column-header text `fg.muted` gray.600 → spec `--ink-4` gray.500 (`fg.subtle`); **numeric columns render left-aligned body font** — `TableColumnType`/`TableColumnConfigBase` have **no `align`/`numeric` field** (spec `.num` = right-aligned mono) → **IR change**. Minors: header tracking 0.12 → 0.16em; cells vertically centered → spec `vertical-align: top`; footer/total possible double bottom rule.

3. **Matrix size + shape** (live renderer, not just the dead recipe). Live cell height = `SIZE_PRESETS.md` **52px** → spec `.mx-cell` **44px**; bars render **height 100% (full-cell fill)** → spec `.mx-bar` **fixed 24px centered** (vert `.mx-cell.vert .mx-bar` 32px + 1px rule border). **Coupled to the drag-resize math** (`segPxV = pct% × cellHeight`, resize handlers pass `cellHeight`) — cannot be a safe one-liner; must be reworked alongside the recipe adoption.

4. **Matrix / Gantt / Planner recipe adoption** — consume `useSlotRecipe` (each recipe is currently dead code); brings the correct 44px/24px/mono-header/now-line values from the theme.

5. **Planner** also needs the `Planner.Event` event-state IR field + a **design decision** (spec CSS-grid model vs keep Gantt + re-spec) — see above. **Blocked.**

Suggested sequence: (a) settle Table to spec incl. the numeric-align IR field → (b) extract/share the table chrome → (c) Matrix recipe adoption (size+shape+headers) → (d) Gantt SVG refactor → (e) Planner (after the design decision).
