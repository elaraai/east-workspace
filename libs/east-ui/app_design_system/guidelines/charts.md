# Charts — what East charts look like

Distilled from the retired reference pages' chart bootstrap (`charts.js`,
git history), the chart convention specimen, and the component rules §6 —
values verbatim.
Production implementation: `@elaraai/east-ui` `<Chart layers={…}>`
(Chart.Line / Chart.Column / Chart.Bar / Chart.Area / Chart.Scatter /
Chart.Band + Chart.refLine / refBand / refDot — **Column is vertical, Bar
is horizontal**) and `<Sparkline>`. Stack charts over planners/tables on a
shared x-axis with `<AlignedStack>`.

## Chrome — mono type on rule lines; color is data only

- Axis lines `--rule` · no axis ticks · gridlines `--rule` **dashed**;
  no gridlines top/right.
- Axis labels: JetBrains Mono · 10px · 500 · `--ink-4`. Axis names mono
  10px `--ink-4`. Every numeral tabular.
- All chart text is mono. Grid margins (reference): left 44 · right 24 ·
  top 24 · bottom 28. No animation on load.
- In-chart annotations (end labels, target labels, point callouts): mono
  10px, 600 when emphatic; `--ink-3`/`--ink-4` for neutral, series colour
  for the series' own end label.

## Series color — fixed order, semantic valence

- **Series 1 is always `--brand-d`** (line width 1.5–2).
- Comparison/scenario series take accent hues in fixed order:
  **teal → purple → blue → orange** (`--teal-500`, `--purple-500`,
  `--blue-500`, `--orange-500`). Accents appear ONLY inside chart marks.
- Positive/negative encodes as `--pos`/`--neg` (e.g. driver bars).
- Observed/actual reference series: `--ink-3` solid 1.5px. "Do nothing"
  baselines: `--ink-4` dashed 1.5px with a mono end label.
- Hidden/legend-toggled-off series: opacity 0.45 + dashed stroke.

## Dashed = ephemeral (same convention as everywhere)

Forecasts, projections, targets, guardrails, and uncertainty render
**dashed**; committed/observed truth renders solid. Target/reference lines:
`--ink-3` dashed 1px with a mono label (`target $2.00M`).

## Bands & fills

Confidence envelopes (p10–p90) and area fills use `--brand-tint` at
opacity 0.6–0.7 — never a saturated fill, never above a ~10% wash
equivalent. Uncertainty can also render as lighter bands.

## Canonical chart shapes

- **Baseline vs action** — "do nothing" dashed `--ink-4` line vs the
  recommended `--brand-d` line with tint area fill; both carry mono end
  labels; dashed target line.
- **Forecast envelope** — observed solid `--ink-3`; forecast `--brand-d`
  **dashed**; p10–p90 band in `--brand-tint` 0.7.
- **Projection to target** — `--brand-d` 1.8px line + tint area; dashed
  target line labeled inside-start-top; an 8px `--brand-d` markPoint dot
  with mono callout at the crossing.
- **Driver bars** (tornado) — horizontal bars 8px wide, radius 2; positive
  drivers `--brand`, negative `--neg`; mono value labels at bar end; mono
  11px `--ink` category labels. Naturally half-width (`md` descriptor).
- **Stacked column** — bar width 18px; segment colors `--brand-d` /
  `--brand` / `--ink-5` (never accent hues for parts of one measure);
  dashed `--neg` 1.2px capacity/limit line.
- **Actual vs predicted** — scatter symbolSize 7 in `--brand-d`; dashed
  `--brand-d` 1px identity line; `--brand-tint` 0.5 tolerance band.
- **Sparkline** (`<Sparkline>`) — 1.5px line (default `--brand-d`) +
  `--brand-tint` 0.7 area; no axes, no chrome.

## Legend & slicing

Legend entries: 14×3px swatch · mono 10.5px/600 `--ink` label · mono
10.5px/500 `--ink-4` range · eye toggle (`--brand-d` shown / `--ink-4`
hidden). The legend is full-width inside the chart body; per-chart
narrowing (breakdown chips) lives in the chart frame's eyebrow. Filter
chips never aggregate; only the legend collapses series.

## Placement

A chart never sits bare in Main — it lives inside a Frame whose eyebrow
names the chart + run anchor (`Chart · line`, mono uppercase). Charts are
`full · fill` unless explicitly a half-row compare (`md`).
