# Charts — what East charts look like

The chart rules of `component-rules.md` §6, with their values.
Production implementation: `@elaraai/east-ui` `<Chart layers={…}>`
(Chart.Line / Chart.Column / Chart.Bar / Chart.Area / Chart.Scatter /
Chart.Band + Chart.refLine / refBand / refDot — **Column is vertical, Bar
is horizontal**) and `<Sparkline>`. Stack charts over planners/tables on a
shared x-axis with `<AlignedStack>`.

## Chrome — mono type on rule lines; color is data only

- Axis lines `--rule` · no axis ticks · gridlines **solid** `--rule`
  (dashed is reserved for ephemeral data); no gridlines top/right.
- Axis labels: JetBrains Mono · 10px · 500 · `--ink-4`. Axis names mono
  10px `--ink-4`. Every numeral tabular.
- All chart text is mono. Grid margins (reference): left 44 · right 24 ·
  top 24 · bottom 28. No animation on load.
- In-chart annotations (end labels, target labels, point callouts): mono
  10px, 600 when emphatic; `--ink-3`/`--ink-4` for neutral, series colour
  for the series' own end label; a valence-coloured label uses the text
  step (`--pos-text`, `--neg-text`).

## Series color — fixed order, semantic valence

- **Series 1 is always `--brand-d`** (line width 1.5–2).
- Comparison/scenario series take accent hues in fixed order:
  **teal → purple → blue → orange** (`--teal-500`, `--purple-500`,
  `--blue-500`, `--orange-500`). Accents appear ONLY inside chart marks.
- Positive/negative encodes as `--pos`/`--neg` (driver bars included).
- Observed/actual reference series: `--ink-3` solid 1.5px. "Do nothing"
  baselines: `--ink-4` dashed 1.5px with a mono end label.
- Hidden/legend-toggled-off series: opacity 0.45 + dashed stroke.

## Dashed = ephemeral (same convention as everywhere)

Forecasts, projections, targets, guardrails, and uncertainty render
**dashed**; committed/observed truth renders solid. Target/reference lines:
`--ink-3` dashed 1px with a mono label (`target $2.00M`).

## Bands & fills

Confidence envelopes (p10–p90), tolerance bands and area fills use
`--brand-tint` at opacity **0.7** — never a saturated fill. Valence washes
inside a chart are 6%.

## Sequential ramp — `--heat-1` … `--heat-5`

The one ramp for the magnitude of one measure: heat cells (`<Matrix>`,
`<Calendar>`) and map areas and hexes. `--brand-d` mixed into `--paper` at
12 / 32 / 56%, then `--brand-d`, then `--brand-dd`, declared per theme.
Five equal-width steps; the top step is closed with `≥` and values above
the domain clamp to it; zero is a value (step 1); no data is `--paper`
("no data" in a cell, the lattice alone on a map). Value text `--ink` on
steps 1–3, `--paper` on 4–5. Good / at-risk / bad against a threshold is
not a magnitude — it takes the valence washes. Never on chrome, never for
categories (those take the series order). A map hex on the ramp is filled
with no stroke; the lattice gutter separates it from its neighbours.

## Canonical chart shapes

- **Baseline vs action** — "do nothing" dashed `--ink-4` line vs the
  recommended `--brand-d` line with a `--brand-tint` 0.7 area fill; both
  carry mono end labels; dashed target line.
- **Forecast envelope** — observed solid `--ink-3`; forecast `--brand-d`
  **dashed**; p10–p90 band in `--brand-tint` 0.7.
- **Projection to target** — `--brand-d` 1.8px line + `--brand-tint` 0.7
  area; dashed target line labeled inside-start-top; an 8px `--brand-d`
  markPoint dot with mono callout at the crossing.
- **Driver bars** (tornado) — horizontal bars 8px wide, radius 2; positive
  drivers `--pos`, negative `--neg`; mono value labels at bar end; mono
  11px `--ink` category labels. Naturally half-width (`md` descriptor).
- **Stacked column** — bar width 18px; segment colors `--brand-d` /
  `--brand` / `--ink-5` (never accent hues for parts of one measure);
  dashed `--neg` 1.2px capacity/limit line.
- **Actual vs predicted** — scatter symbolSize 7 in `--brand-d`; dashed
  `--brand-d` 1px identity line; `--brand-tint` 0.7 tolerance band.
- **Sparkline** (`<Sparkline>`) — 1.5px line (default `--brand-d`) +
  `--brand-tint` 0.7 area; no axes, no chrome.

## Legend & slicing

Legend entries: 14×3px swatch · mono 10.5px/600 `--ink` label · mono
10.5px/500 `--ink-4` range · eye toggle (`--brand-d` shown / `--ink-4`
hidden). The legend is full-width inside the chart body; per-chart
narrowing (breakdown chips) lives in the chart frame's eyebrow. Filter
chips never aggregate; only the legend collapses series.

A ramp's legend is the heat legend: five 40 × 12 swatches in a 1px
`--rule` strip, thresholds mono 9.5 `--ink-4` under the joins.

**Map legend placement** — the map runs edge to edge in its Frame body,
and its legend sits full width directly under it, still inside the body:
pad 12/20, a 1px `--rule` top, entries 8 / 20 apart, each the legend entry
above (hidden: `--ink-4`, swatch at 0.45). A ramp layer's heat legend
comes first in that row. Nothing floats on the map but the overlay card
(Popover sm 280, 12 in from the top-end corner) and the attribution (mono
9.5 `--ink-4`, bottom-start).

## Placement

A chart never sits bare in Main — it lives inside a Frame whose eyebrow
names the chart + run anchor (`Chart · line`, mono uppercase). Charts are
`full · fill` unless explicitly a half-row compare (`md`).
