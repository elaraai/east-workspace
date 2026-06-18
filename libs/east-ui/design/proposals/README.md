# Component proposals — for review

Interface proposals for the five missing spec patterns. Each doc leads with
the TSX + props (the review surface); renderer notes and open questions
follow. All five follow the existing collections conventions: accessor-based
config over typed data rows (`Planner`-style), `Xxx.item({...})`
sub-constructors for non-UI substructures, `SubtypeExprOrValue` everywhere,
and JSX tags whose props mirror the factory options.

| Doc | Component | Spec pattern | DnD role |
|---|---|---|---|
| [00-drag-grammar.md](00-drag-grammar.md) | shared `DragEventType` contract | `index__bsys__drag-drop-*` | — |
| [calendar.md](calendar.md) | `<Calendar>` | `configure__pattern__calendar-heatmap` | none (visualisation only) |
| [library.md](library.md) | `<Library>` | `configure__pattern__sourcelibrary` | source |
| [roster.md](roster.md) | `<Roster>` | `configure__pattern__roster` | target (add/move/remove) |
| [schematic.md](schematic.md) | `<Schematic>` | `configure__pattern__schematic` | none (read-only) |
| [blend.md](blend.md) | `<Blend>` (née Workbench) | `configure__pattern__workbench` | target (add/remove) |
| [map.md](map.md) | `<Map>` | net-new (interactive geographic basemap + overlay slot) | none (read-only / select) |
| [planner-review.md](planner-review.md) | `<Planner>` review (optional per-row approval + batch foot) | `decide.html#planner-review` | none (click approve / reject) |

Suggested build order once approved: drag contract → Library → Roster →
Calendar → Schematic → Blend (Roster exercises the full DnD path early;
Blend reuses everything).
