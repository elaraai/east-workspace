# East component rules — the compliance checklist

Hard constraints. A design that fails ANY line below is wrong; fix it
before it ships. East ships no code components: every part is drawn from
the tokens, the guidelines and the spec cards, and these rules are the
contract every new component is drawn against.

## 1 · Color

- [ ] Uses ONLY semantic tokens: `--ink`…`--ink-5`, `--paper`…`--paper-3`,
      `--rule`, `--rule-strong`, `--brand`, `--brand-d`, `--brand-dd`,
      `--brand-tint`, `--pos`, `--neg`, `--warn`, `--info`, their text steps
      `--pos-text`, `--neg-text`, `--warn-text`, `--info-text`, the
      sequential ramp `--heat-1`…`--heat-5`, and
      `--bg-inverse` / `--fg-inverse` (Stamp and Tooltip only). Never a raw
      hex, never a raw scale token (`--gray-400`, `--brand-300`), never a
      deprecated token (`--bg-primary`, `--bg-secondary`, `--bg-tertiary`,
      `--fg-*`, `--border-*`, `--card-*`, `--link`, `--link-hover`,
      `--brand-l`).
- [ ] Works in BOTH themes: toggling `data-theme="dark"` on a parent must
      produce a legible component with no code change. If you wrote a hex,
      you failed this.
- [ ] Readable text is `--ink-4` or darker — at least 4.5:1 on `--paper`,
      `--paper-2`, `--paper-3` (selected) and `--brand-tint` (active,
      dirty) in both themes, so text keeps its ink on every state fill.
      `--ink-5` is never readable text: it is allowed only for disabled
      controls (label, value, icon) and muted marks (the muted tone of a
      marker or node, the third segment of a stacked column).
- [ ] Text and ticks on `--brand-d` are `--paper`.
- [ ] Chart accent hues (`--teal-500`, `--purple-500`, `--blue-500`, etc.)
      appear ONLY inside chart marks. Never on chrome, text, borders, or fills.
- [ ] The ONLY tinted background is `--brand-tint`, and it means an
      *active control* (segmented option, active chip, current nav item) or
      a *dirty value* (edited field, the Commit bar). Selected rows and
      cells are `--paper-3`, never tinted. In charts, `--brand-tint` bands
      run at 0.7 opacity. Data fills aside: the heat ramp fills heat cells
      and map areas, never chrome.
- [ ] Valence washes are 6%:
      `color-mix(in oklch, var(--pos) 6%, transparent)`.
- [ ] Valence set as text uses the text step — `--pos-text`, `--neg-text`,
      `--warn-text`, `--info-text` — at least 4.5:1 on `--paper`,
      `--paper-2`, `--paper-3`, `--brand-tint` and on its own 6% wash over
      each, in both themes. Dots,
      marks and washes use the base (`--pos` …), which holds 3:1.
- [ ] Status is a dot + uppercase mono word (`<Status>`), NEVER a tinted badge.

## 2 · Typography

- [ ] Every numeral is `--font-mono` with `font-feature-settings: "tnum" 1`
      at weight 500 (`.num`). No exceptions — table cells, chips, counts,
      ticks, dates, numerals inside running text. Inside a label, meta line
      or caption a numeral takes the line's weight.
- [ ] Large numbers (Stat values, data-rail cells) are mono, tabular, 26px
      (`--fs-num`), weight 600 (`.num-lg`).
- [ ] Labels are 9.5–11px everywhere (`--fs-label-xs` … `--fs-label-lg`):
      eyebrows, keys, statuses, tabs, table headers, axis labels,
      breadcrumbs, meta and annotation lines. All are mono and `--ink-4`
      unless their recipe names another ink; eyebrows, keys, statuses, tabs
      and table headers are also 600, uppercase, `letter-spacing:
      0.1em–0.18em`.
- [ ] Titles use `--font-brand` (DM Sans) with negative tracking (−0.01 to
      −0.02em) at the title sizes, 15–24px (`--fs-title-xs` …
      `--fs-title-xl`); running text uses `--font-body` (Inter Tight)
      12.5–14px (`--fs-body-sm` … `--fs-body-lg`). No other sizes.
- [ ] No font outside the three families. No italic except muted "no data" values.
- [ ] An absent value is words, never a dash, a blank or a zero: "no
      data", or the reason when the value cannot exist yet ("not
      started"), mono italic 400 `--ink-4` in the value's alignment.

## 3 · Structure & surfaces

- [ ] Structure comes from 1px rules: `--rule` for inside-card dividers,
      `--rule-strong` for frame edges, inputs and overlay edges. The focus
      ring (§4) is the one allowed shadow: frames, menus, popovers, dialogs
      and the Commit bar are never shadowed.
- [ ] Component sits on `--paper`; header/footer bands use `--paper-2`;
      wells use `--paper-3`. Page background is `--paper-2`.
- [ ] Radii: `--r-sm` 4px chips, counts, NEW, DeltaPill, kbd, bars ·
      `--r-md` 6px buttons, inputs, menus, popovers and the cards and
      columns inside a Frame (Item card, Board column, graph node) ·
      `--r-lg` 10px frames, dialogs, the Commit bar and the Stamp.
      `--r-full` only on avatars and dots. Nothing pill-shaped: a 6px
      Progress bar is square-ended.
- [ ] Dashed border/hairline = ephemeral, partial, stale, or placeholder.
      Never decorative. Solid = committed truth.
- [ ] Spacing stays on the 4px scale: Main frames pad 20px, rail frames
      12px, table cells pad 12px horizontally, internal gaps are 8px. Use
      flex/grid + `gap`, never margins between siblings.
- [ ] Everything in a Frame starts at the Frame's padding edge. A table
      runs edge to edge, and its first and last cells take the Frame's
      padding (20px in Main, 12px in the rail) instead of 12px, so the
      eyebrow, body text and first column line up.
- [ ] Rows are a fixed height per density — comfortable 36 (default),
      compact 32, condensed 28, rule included, content vertically centred.
      Every row collection offers the three; one density per collection.
      Sheet cells are 32.

## 4 · Behavior & interaction

- [ ] Hover goes one paper step darker than the resting surface: `--paper`
      → `--paper-2`, `--paper-2` → `--paper-3`; brand fills go `--brand-d`
      → `--brand-dd`. Rows rest on `--paper` and hover to `--paper-2`,
      because `--paper-3` on a row means selected; a selected row keeps
      `--paper-3` on hover. Never scale, lift, or shadow on hover.
- [ ] Focus: `--shadow-focus` on controls; on cells and rows the same ring
      is drawn inset (`--shadow-focus-inset`). No default outline rings.
- [ ] Selection is `--paper-3` on rows and cells; on a canvas it is
      `--ink` — a 1px edge on a filled part, 2px on a line, a ring outside
      a small mark. A halo marks emphasis, never selection.
- [ ] Motion: `--dur-fast`, `--dur-base`, `--dur-slow` with `--ease-out`;
      `--ease-in-out` for state toggles only. No bounces, no spring
      physics. The only animation loop allowed is the status-dot pulse.
- [ ] Actions use the four `<Button>` roles — never invent a new button
      style. Destructive actions go through `<Dialog>`, whose Primary
      button carries the named verb (Archive roster, Delete scenario);
      there is no red button. In a destructive flow `--neg` appears only on
      the destructive menu item, as `--neg-text`.
- [ ] One `primary` button per surface, right-aligned in its action cluster.
- [ ] Buttons are md 32. sm 24 only inside a 36px band (eyebrow row,
      footer band), a compact or condensed row, or the slice toolbar's band
      and its popovers' feet; Primary and Override are always 32.
- [ ] `[` and `]` page; the sidebar toggles by its chevron only.

## 5 · Composition (reuse before invention)

- [ ] Anything expressible with the foundation parts uses them: actions →
      Button, tokens → Chip, state → Status, change → DeltaPill, named
      facts → Tag, shortcuts → Kbd (in menus and tooltips too), notices →
      Banner, people → Avatar, selection → Checkbox, queries → Input, view
      modes → SegmentGroup. A part with a foundation card is reproduced from
      that card; until it
      has one, from its recipe in the guidelines.
- [ ] Bigger patterns (briefing, diff view, matrix, rails, tables) compose
      those parts. Their anatomy comes from the guidelines and, once
      reviewed, from the component's spec card (`Components · <Category>`).
      A part that no card or guideline defines is proposed, not improvised
      (see `component-review.md`).
- [ ] Empty states: centered, mono glyph in `--rule-strong`, a bold 15px
      title (`--fs-title-xs`), and a checklist of what to do — never an
      illustration.
- [ ] Icons: Font Awesome 6 Free solid (CDN) or mono-font glyphs (▲ ▼ ▾ ×
      ☐ △). Never hand-drawn SVGs, never emoji.

## 6 · Charts

- [ ] Chart chrome (axes, gridlines) is mono type on solid `--rule` lines;
      color is reserved for data marks.
- [ ] Series 1 is always `--brand-d`; comparison/scenario series take accent
      hues in the fixed order teal → purple → blue → orange.
- [ ] Bands and area fills are `--brand-tint` at 0.7 opacity; valence
      washes are 6%. Positive/negative encodes as `--pos`/`--neg`, driver
      bars included; valence-coloured labels use the text step.
- [ ] Uncertainty renders as dashed strokes or `--brand-tint` bands,
      matching the dashed-is-ephemeral convention.

## Self-review, in order

1. Grep your CSS for `#` — any hex is a violation (rule 1).
2. Toggle `data-theme="dark"` — everything still legible?
3. Find every digit — is it mono tabular? Large numbers 26px / 600?
4. Find every label — mono, 9.5–11px?
5. Find every shadow — is it the focus ring?
6. Find every color — semantic and not deprecated? Every tint either
   `--brand-tint` (active control or dirty value) or a 6% valence wash?
   Every selected row `--paper-3`? Every valence-coloured word a `-text`
   token?
