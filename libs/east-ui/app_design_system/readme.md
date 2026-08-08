# East Application design system

Design system for **East** — Elara AI's decision-intelligence application.
East surfaces let operators *observe* live operations, *decide* on
model-generated recommendations, *configure* plans (rosters, matrices,
parameters), and *calibrate* trust in the model over time. The system was
distilled from the East UI Pattern Specification (retired to git history;
its per-pattern extracts live on in `guidelines/patterns/`), itself derived
from the east-ui Chakra theme and elaraai.com.

**Design philosophy: tokens + rendered truth, constrain hard.** No
components ship as code. Everything is governed by
`guidelines/component-rules.md` — a hard-constraint checklist a new component
must pass — plus the rendered component captures in `components/rendered/`.
Agents are expected to *invent* screens and patterns, not assemble them from
a big kit.

## How to build something new (agents start here)

1. Read `guidelines/component-rules.md` — the compliance checklist. Every line
   is a hard constraint.
2. Check `components/rendered/<category>/` for the RENDERED example grid of
   the component you need — one standalone HTML per component, produced by
   the production renderer + theme (`collections/table.html`,
   `collections/planner.html`, `charts/chart.html`, …). This is the ground
   truth for how components actually look today.
3. Style everything with the semantic tokens only.
4. Self-review against the checklist (grep for hex; toggle dark; check
   numerals are mono tabular).

## Content fundamentals

- Voice is an analyst's: terse, factual, lowercase-calm. Verbs lead actions
  ("Apply", "Discard", "Commit changes"); no exclamation marks, no marketing.
- Sentence case for body and titles; UPPERCASE lives only in mono
  labels/eyebrows/statuses.
- Numbers do the talking: claims are quantified ("Utilisation exceeds 92% in
  week 3"), units and horizons always stated ("next 14 days", "vs plan").
- Uncertainty is named, never hidden: "Don't know", "stale", "partial",
  "outside guardrail" are first-class copy.
- No emoji, ever. Glyphs come from the mono font (▲ ▾ △ ☐ ─ ─).

## Visual foundations

- **Color**: cool green-gray neutrals (ink/paper), deep-teal brand. Chrome is
  near-monochrome; color is *meaning* — brand for interaction/selection,
  pos/neg/warn for valence, accent hues for chart series only. The single
  legal tinted background is `--brand-tint` (selected/dirty). Both themes ship;
  see `tokens/colors.css`.
- **Type**: DM Sans (display, negative tracking) · Inter Tight (body) ·
  JetBrains Mono (the "data voice": ALL numerals tabular, labels, keys,
  statuses). DM Sans is a flagged substitution for the lockup's rounded
  geometric sans — replace if brand fonts arrive.
- **Structure**: borders, not shadows. 1px `--rule` dividers inside frames,
  `--rule-strong` card edges, 10px frame radius. Shadows only on overlays.
  Dashed hairline = ephemeral/partial/stale.
- **Backgrounds**: flat `--paper-2` pages, `--paper` cards. No gradients, no
  imagery, no textures.
- **Motion**: 120–360ms ease-out fades/color shifts. No bounces, no hover
  lift/scale; the only loop is the pulsing live-status dot.
- **Hover**: border darkens or bg steps to `--paper-3`. **Focus**:
  `--shadow-focus` ring. **Density**: 8px min gaps, 10–14px row padding,
  18px frame padding.

## Iconography

No bespoke icon set. Two sources, in order of preference:
1. Mono-font glyphs (▲ ▾ × △ ☐ ⏎) — the spec's native idiom for inline marks.
2. Font Awesome 6 via CDN (`cdnjs…/font-awesome/6.5.2/css/all.min.css`) for
   real icons, used sparingly at 12–14px in `--ink-3`/`--ink-4`.
Never hand-drawn SVGs, never emoji. No logo files were provided — render
"East" / "Elara" in `--font-brand` where a mark would go.

## Index

- `styles.css` — global CSS entry (imports everything below).
- `tokens/` — `colors.css` (raw scales + semantic aliases, light & dark),
  `typography.css`, `layout.css` (spacing/radii/shadows/motion).
- `base/semantic.css` — element defaults (headings, links, `.num`, `.eyebrow`).
- `guidelines/component-rules.md` — **the hard-constraint checklist.**
- `guidelines/cards/` — foundation & convention specimen cards.
- `components/rendered/` — RENDERED example captures (generated, gitignored;
  regenerate via `make east-ui-examples-html-all` + the example-cards pass).
  One HTML per component, real renderer + theme — the ground truth for how
  components look. (The hand-drawn pattern specs, the full-page reference
  pages, and the component proposals were all retired to git history,
  2026-07-29.)

## Intentional additions

- The 8 hand-migrated code atoms (Button, Chip, Status, …) were retired
  2026-07-29 — they duplicated and diverged from the real components, whose
  rendered captures now live in `components/rendered/`.
- Dark values for the `--ink/--paper/--rule` aliases are new (the spec was
  light-only): inverted along the same gray scale, with interactive brand
  lifted one step for contrast. Marked untested against real product surfaces.

## Sources

- The East UI Pattern Specification (retired to git history 2026-07-29).
- Referenced but not attached: east-ui Chakra theme
  (`packages/east-ui-showcase/theme/index.ts`), elaraai.com platform page,
  `PATTERNS.review.md`.
