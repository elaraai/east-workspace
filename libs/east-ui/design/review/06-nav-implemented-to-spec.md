## Nav — implemented to spec (supersedes the nav findings in 03 / 04)

The nav **spec changed**, so the renderer had to be updated to match it — nav
is not a deviation to preserve. (The main conformance workflow was mistakenly
told to treat the app-shell nav as an intentional deviation, so it
under-reported the drift.) This document re-reviews nav under "the spec is
canonical, the implementation follows" and records the fixes applied. It
**supersedes** the `navList` section of `03-slot-recipes.md` and the
`navigation-deep` group in `04-components.md`.

### Canonical spec source

- **Header recipe** — `design/index.html` (the `Header recipe` bsys block):
  84 px tall, sticky, no shadow; header bar background `--paper` (white), 1 px
  `--rule` bottom cut, padding `14px 24px 16px`. Row 1 = breadcrumb (mono
  11 px / 0.06 em, links `--brand-d`, `/` separator `--ink-4`) + right cluster;
  Row 2 = surface title (DM Sans 24 px / 700 / −0.015 em) + state eyebrow (mono
  10.5 px / 0.14 em uppercase `--ink-4`).
- **Sidebar recipe** — `design/index.html` (the `Sidebar recipe` bsys block):
  240 px / 56 px, background `--paper-2`, 1 px `--rule` right cut, item height
  36 px, **active = inset brand-tint pill** (8 px side inset, 4 px radius,
  `--brand-dd` label at weight 700), sub-item indent 36 px / 11 px / normal
  case, section eyebrow mono 9.5 px / 600 / 0.18 em `--ink-4`, logo region
  64 px / 56 px with a 12 px rule-free gap.

### Drift found and fixed

| Where | Was | Now | Severity |
|---|---|---|---|
| `theme/slot-recipes/navList.ts` · item **active** | 3 px `brand.600` left-rule accent, full-bleed band, weight 600 | inset pill: `marginInline 8px`, `width calc(100% − 16px)`, `paddingInline 12px`, `borderRadius sm` (4 px), `brandTint` bg, `brand.700`, **weight 700** | 🟠 major |
| `theme/slot-recipes/navList.ts` · item resting padding | `paddingInlineStart 11px` / `End 14px` (offset by the 3 px border) | uniform `paddingInline 14px` (border removed) | 🟡 minor |
| `theme/layer-styles.ts` · `header.bar` background | `bg.canvas` (gray.50) | `bg.surface` (white `--paper`, per the Header recipe) | 🟠 major |
| `theme/layer-styles.ts` · `header.bar` padding | `paddingBlock {spacing.3}` (12 px) | `paddingTop 14px` / `paddingBottom 16px` | 🟡 minor |
| `east-ui-showcase/App.tsx` · breadcrumb link | `brand.700` | `brand.600` (`--brand-d`) | ⚪ nit |

**Chrome rule strength — deliberately *not* the spec's literal `--rule`.** The
spec gives the header bottom cut and the sidebar right cut as `1px --rule`
(gray.200). But both chrome surfaces share the canvas plane — the sidebar is
`paper-2`, the same gray.50 as the main body — so a gray.200 hairline between
two same-luminance surfaces is near-invisible and the sidebar bleeds into the
body (an interim change to the literal gray.200 confirmed this regression).
Both chrome rules therefore stay at `border.strong` (gray.300): same hue, +1
contrast step, which renders the structural cut the spec intends. The spec's
`--rule` hairline is calibrated for a card edge *against* the canvas, not for
chrome that *is* the canvas plane. (Candidate spec-consolidation item: state
the chrome rule as `rule-strong` so spec and renderer agree explicitly.)

Already-matching (no change): logo region 64/56 px + 12 px gap + 16 px pad;
header row dims (28 / 36 px); `surface.title`, `state.eyebrow`, `nav.eyebrow`,
`nav.item` text-styles; sidebar 240/56 width; group-label 9.5 px / 0.18 em;
both chrome rules (kept at `border.strong`).

### Files changed

- `packages/east-ui-components/src/theme/layer-styles.ts` — `header.bar`, `nav.panel`.
- `packages/east-ui-components/src/theme/slot-recipes/navList.ts` — `item` resting + active.
- `packages/east-ui-components/src/navigation/nav-list/index.tsx` — doc comment.
- `packages/east-ui-showcase/App.tsx` — breadcrumb link colour + doc comment.

Because these live in the **shared theme**, both nav consumers inherit the fix:
`east-ui-showcase` (App.tsx) and `east-ui-extension/webview` (`Toolbar.tsx` →
`header.bar`; `WorkspaceTree.tsx` → `navList`). The extension's own structural
specifics (its custom toggle/tree wiring) are not re-audited here.

### Verification

- Re-snapshot of the `navigation/nav-list` example (`make
  east-ui-examples-html-navigation/nav-list`): the 3 px left-rule accent is gone
  and the active row is an inset, rounded brand-tint pill at weight 700
  (clearest in `navListReactive`). PNG read confirms it against the spec
  Sidebar recipe.
- Showcase dev server boots clean (`main.tsx` transforms HTTP 200, no resolve /
  hook errors) after the fixes.

### Not yet done

- The white `header.bar` + gray.200 rules apply to the app shell, which has no
  standalone example snapshot — confirm live via `make showcase` (the running
  app shell), then capture if a chrome snapshot target is added.
- `east-ui-extension/webview` structural specifics (custom sidebar toggle,
  workspace tree rows) — a focused pass if desired.
