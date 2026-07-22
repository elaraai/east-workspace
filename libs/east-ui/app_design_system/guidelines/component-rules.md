# East component rules — the compliance checklist

Hard constraints. A new component that fails ANY line below is wrong; fix it
before shipping. These rules exist so that agents can invent new components
freely — the migrated set is deliberately tiny (8 atoms in
`components/core/`); everything else is built fresh against this contract.

## 1 · Color

- [ ] Uses ONLY semantic tokens: `--ink`…`--ink-5`, `--paper`…`--paper-3`,
      `--rule`, `--rule-strong`, `--brand`, `--brand-d`, `--brand-dd`,
      `--brand-tint`, `--pos`, `--neg`, `--warn`, `--info`. Never a raw hex,
      never a raw scale token (`--gray-400`, `--brand-300`).
- [ ] Works in BOTH themes: toggling `data-theme="dark"` on a parent must
      produce a legible component with no code change. If you wrote a hex,
      you failed this.
- [ ] Chart accent hues (`--teal-500`, `--purple-500`, `--blue-500`, etc.)
      appear ONLY inside chart marks. Never on chrome, text, borders, or fills.
- [ ] The ONLY tinted background allowed is `--brand-tint`, and only to mean
      *selected / active / dirty*. Valence washes (pos/neg/warn) max out at
      6–8% via `color-mix(in oklch, var(--pos) 6%, transparent)`.
- [ ] Status is a dot + uppercase mono word (`<Status>`), NEVER a tinted badge.

## 2 · Typography

- [ ] Every numeral is `--font-mono` with `font-feature-settings: "tnum" 1`
      (or `.num`). No exceptions — table cells, chips, ticks, big heroes.
- [ ] Labels, eyebrows, keys, statuses, and meta lines are mono, 9.5–11px,
      600 weight, `letter-spacing: 0.1em–0.18em`, uppercase, `--ink-4`.
- [ ] Titles use `--font-brand` (DM Sans) with negative tracking (−0.01 to
      −0.02em); running text uses `--font-body` (Inter Tight) 12.5–14px.
- [ ] No font outside the three families. No italic except muted "no data" values.

## 3 · Structure & surfaces

- [ ] Structure comes from 1px rules, not shadows: `--rule` for inside-card
      dividers, `--rule-strong` for card edges and inputs. Nothing inside a
      frame is ever shadowed; `--shadow-*` is reserved for true overlays
      (menus, dialogs).
- [ ] Component sits on `--paper`; header/footer bands and wells use
      `--paper-2` / `--paper-3`. Page background is `--paper-2`.
- [ ] Radii: 2–4px chips/badges, 6px buttons/inputs, 10px outer frames.
      `--r-full` only on avatars and dots. Nothing pill-shaped.
- [ ] Dashed border/hairline = ephemeral, partial, stale, or placeholder.
      Never decorative. Solid = committed truth.
- [ ] Density: 8px minimum internal gap, 10–14px row padding, 18px frame
      padding. Use flex/grid + `gap`, never margins between siblings.

## 4 · Behavior & interaction

- [ ] Hover: border darkens (`--ink-3`) or bg steps to `--paper-3`. Never
      scale, lift, or shadow on hover.
- [ ] Focus: `box-shadow: var(--shadow-focus)`, no default outline rings.
- [ ] Motion: `--dur-fast`/`--dur-base` with `--ease-out`. No bounces, no
      spring physics. The only animation loop allowed is the status-dot pulse.
- [ ] Destructive and commit actions render as `<Button>` variants — never
      invent a new button style.
- [ ] One `primary` button per surface, right-aligned in its action cluster.

## 5 · Composition (reuse before invention)

- [ ] Anything expressible with the 8 core atoms uses them: actions →
      `Button`, tokens → `Chip`, state → `Status`, change → `DeltaPill`,
      named facts → `Tag`, shortcuts → `Kbd`, notices → `Banner`, people →
      `Avatar`.
- [ ] Bigger patterns (briefing, diff view, matrix, rails, tables) are NOT
      componentized here on purpose. Before designing one, read its wireframe
      in `guidelines/reference/` (index, observe, decide, configure, causal…)
      and copy its anatomy; the CSS in `guidelines/reference/spec.css` is the
      dimensional source of truth (copy values verbatim — 11.5px means
      11.5px, not 12).
- [ ] Empty states: centered, mono glyph in `--rule-strong`, a bold 15px
      title, and a checklist of what to do — never an illustration.
- [ ] Icons: Font Awesome 6 (CDN) or mono-font glyphs (▲ ▾ × ☐ △). Never
      hand-drawn SVGs, never emoji.

## 6 · Charts

- [ ] Chart chrome (axes, ticks, gridlines) is mono type on `--rule` lines;
      color is reserved for data marks.
- [ ] Series 1 is always `--brand-d`; comparison/scenario series take accent
      hues in the fixed order teal → purple → blue → orange.
- [ ] Bands/areas fill with `--brand-tint` or ≤10% washes; positive/negative
      encodes as `--pos`/`--neg`.
- [ ] Uncertainty renders as dashed strokes or lighter bands, matching the
      dashed-is-ephemeral convention.

## Self-review, in order

1. Grep your CSS for `#` — any hex is a violation (rule 1).
2. Toggle `data-theme="dark"` — everything still legible?
3. Find every digit — is it mono tabular?
4. Find every shadow — is it an overlay?
5. Find every color — is it semantic, and is any tint either `--brand-tint`
   (selection) or ≤8% valence wash?
