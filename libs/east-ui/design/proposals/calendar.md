# `<Calendar>` — day-of-week × week intensity grid
> **2026-06-11:** interface unified to the row-mapper pattern — one `cell={d => ({ week, day, value, text?, summary?, delta? })}` mapper (omissible for resolved rows); `format` dissolved into the `text` field.


> **Status: implemented.** Two deltas from this proposal, both from the
> Roster interface review: `day` is a plain string (`"Mon"` … `"Sun"`, exact
> match against the fixed week) rather than a variant, and `onSelect` /
> the drill action receive a `{ week, day }` cell ref (the IR cannot carry
> the host's row type). The drill is `actionLabel` + `onAction`.

Source spec: `configure__pattern__calendar-heatmap` (`Input.Calendar`).
Category: `collections/calendar`. **Visualisation only** — click drills into a
day; no events, no committed/proposed state, no DnD (per the support matrix).

## Anatomy (from spec)

- Frame with mono uppercase eyebrow header (`FORECASTED DEMAND · SE REGION · SEP–OCT`)
  and a `LOW → HIGH` legend on the right.
- Grid: columns Mon–Sun (mono eyebrow headers), one row per week with a mono
  row label (`W37`…). Cells print the value and fill with brand-scale
  intensity normalised over the visible values; missing cells render `−` on
  the neutral fill. Selected cell gets the ink outline.
- Footer: selection summary on the left (`Selected · Thu W38 · predicted 131 ·
  last yr 112 · ▲ +17%`), a drill action on the right (`Open day →`).

## TSX

```tsx
<Calendar
    data={days}                                    // ArrayType(StructType) — one element per day
    week={d => d.week}                             // row key + label, ordered by first appearance
    day={d => d.dow}                               // column: "mon" | … | "sun" (variant or literal)
    value={d => d.demand}                          // FloatType — drives intensity + printed number
    title="Forecasted demand · SE region · Sep–Oct"
    legend="low → high"                            // optional, default shown
    format={v => East.print(East.Float.round(v))}  // optional cell text (default East.print)
    summary={d => East.str`predicted ${d.demand} · last yr ${d.lastYear}`}
                                                   // optional footer text for the selected day
    delta={d => d.deltaPct}                        // optional ▲/▼ chip next to the summary
    action={{ label: "Open day", onClick: openDay }}  // optional footer-right drill
    onSelect={onSelectDay}                         // FunctionType([R], NullType) — fires with the day row
/>
```

## Props (`CalendarConfig<R>`)

| Prop | Type | Notes |
|---|---|---|
| `data` | `SubtypeExprOrValue<ArrayType<R>>` | one element per (week, day) cell; sparse OK |
| `week` | `(d: ExprType<R>) => SubtypeExprOrValue<StringType>` | row identity + label |
| `day` | `(d: ExprType<R>) => DayOfWeek` | column placement (`CalendarDayType` variant, string literals accepted) |
| `value` | `(d: ExprType<R>) => SubtypeExprOrValue<FloatType>` | intensity + cell text |
| `title` | `SubtypeExprOrValue<StringType>` | frame eyebrow |
| `legend?` | `SubtypeExprOrValue<StringType>` | header-right caption |
| `format?` | `(v) => SubtypeExprOrValue<StringType>` | cell text override |
| `domain?` | `{ min?, max? }` (Float) | explicit intensity domain; default = observed min/max |
| `summary?` | `(d: ExprType<R>) => SubtypeExprOrValue<StringType>` | footer text for the selected day |
| `delta?` | `(d: ExprType<R>) => SubtypeExprOrValue<FloatType>` | signed % → pos/neg chip in the footer |
| `action?` | `{ label, onClick }` | footer-right drill (btn-link style) |
| `onSelect?` | `SubtypeExprOrValue<FunctionType<[R], NullType>>` | cell click |

No sub-constructors needed — the whole surface is accessor-driven like
`Planner`/`Table`. Selection is renderer-local state (outline + footer);
`onSelect` is the only side effect.

## Renderer notes

- New slot recipe `calendar` (frame / header / legend / dayHeader / weekLabel /
  cell / cellSelected / footer / summary / action), composed from the
  eyebrowRow + frame building blocks.
- Intensity = brand scale steps (the spec mock uses the brand ramp), computed
  from the normalised value; the value text flips to on-tint ink above the
  contrast threshold. Steps + threshold live in the recipe, not the renderer.

## Decisions (reviewed)

1. Columns are fixed Mon–Sun in v1; a `weekStart` option waits for a real
   need.
2. `delta` is a separate accessor so the pos/neg chip styling is owned by
   the recipe.
