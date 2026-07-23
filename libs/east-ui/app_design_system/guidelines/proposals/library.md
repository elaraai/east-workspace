# `<Library>` — draggable palette (DnD source)
> **2026-06-11:** `Library.card` retired — the `item` mapper returns the card-face fields object directly; `Library.status` remains for status-pill values inside expressions.


> **Status: implemented.** IR in `east-ui/src/collections/library/`, JSX tag
> in `runtime/collections/library.ts`, renderer in
> `east-ui-components/src/collections/library/`, recipe
> `slot-recipes/library.ts`. **API delta from this proposal:** secondary
> dimensions and group-by options are plain discriminated config literals
> (`{ kind: "meter", ... }` / `{ key, label, value, summary? }`) rather than
> `Library.meterDim(...)` constructors — standalone generic constructors
> cannot infer the row type; literals follow the `PlannerColumnDef`
> convention and typecheck contextually. `Library.card` / `Library.status`
> remain as proposed.

Source spec: `configure__pattern__sourcelibrary` (`Collections.Library`).
Category: `collections/library`. Pure **source** role: drag-from only, never
receives drops (except the implicit return-to-palette sink).

## Anatomy (from spec)

- Frame: eyebrow title + count (`PEOPLE · SE REGION · 12 OF 18 VISIBLE`),
  hint caption right (`DRAG TO ROSTER · ⌥-DRAG DUPLICATE`).
- Toolbar: search input, `GROUP BY` segment group, `SECONDARY` dimension
  toggles (multi-select) on the right.
- Group sections: mono eyebrow head (`SENIOR · 4`) with a right-aligned group
  summary (`AVG 31H / 40 CAP`).
- Cards: grip glyph (hover, only when draggable), leading icon, primary label
  + role sublabel, the selected secondary dimensions (meter for hours, chips
  for skills/capacity/range/cert), and an optional status pill (`ON ROSTER`,
  `AT CAP`, `PTO MAR 4–8`, `IN SERVICE`). Cards **dim when filtered out**
  instead of disappearing; `AT CAP`/unavailable cards render dimmed and
  non-draggable.
- Footer: `N hidden by filter · SHOW ALL` + optional `+ ADD <noun>` action.

## TSX

```tsx
<Library
    id="people"                                    // DnD source id — targets declare it in `sources`
    data={people}                                  // ArrayType(StructType)
    item={p => Library.card({
        key: p.id,                                 // identity carried by LibraryRef on drag
        label: p.name,
        sublabel: p.role,
        icon: "user",                              // fa-solid name
        status: p.status,                          // optional Library.Status variant (label + tone)
        draggable: p.atCap.not(),                  // default true
    })}
    dimensions={[                                  // secondary dims — toggleable, shown on the card
        Library.meterDim({ key: "hours", label: "Hours", value: p => p.hours, max: 40, format: h => East.str`${h}h` }),
        Library.chipsDim({ key: "skills", label: "Skills", values: p => p.skills }),
        Library.chipsDim({ key: "cert", label: "Cert", values: p => p.certs }),
        Library.textDim({ key: "location", label: "Location", value: p => p.site }),
    ]}
    groupBy={[                                     // GROUP BY segment options; "None" added automatically
        Library.group({ key: "role", label: "Role", value: p => p.seniority,
                        summary: members => East.str`avg ${members.map(($, p) => p.hours).sum().divide(members.size())}h / 40 cap` }),
        Library.group({ key: "team", label: "Team", value: p => p.team }),
    ]}
    search={p => East.str`${p.name} ${p.role}`}    // searchable text accessor; omitting hides the input
    title="People · SE region"
    addLabel="Add person"                          // optional footer action
    onAdd={onAddPerson}
/>
```

## Props (`LibraryConfig<R>`)

| Prop | Type | Notes |
|---|---|---|
| `id` | `string` | DnD source identity (static — wiring is type-time, per the invariants) |
| `data` | `SubtypeExprOrValue<ArrayType<R>>` | |
| `item` | `(p: ExprType<R>) => card` | identity + primary face of the card |
| `dimensions?` | `LibraryDimensionDef<R>[]` | secondary dims; toolbar toggles which render |
| `defaultDimensions?` | `string[]` | initially-on dim keys (default: first two) |
| `groupBy?` | `LibraryGroupDef<R>[]` | segment options; `None` = flat list |
| `search?` | `(p) => SubtypeExprOrValue<StringType>` | filter text; dims cards rather than removing them |
| `title` | `SubtypeExprOrValue<StringType>` | frame eyebrow |
| `hint?` | `SubtypeExprOrValue<StringType>` | header-right caption (defaults to the drag hint) |
| `addLabel?` / `onAdd?` | string / `FunctionType([], NullType)` | footer action |

Sub-constructors (the `.Item({...})` pattern): `Library.card`,
`Library.meterDim` / `chipsDim` / `textDim`, `Library.group`,
`Library.status(label, tone)`.

`group.summary` is a plain accessor over the group's members
(`(members: ExprType<ArrayType<R>>) => SubtypeExprOrValue<StringType>`) —
standard East aggregation, no new helper API.

## DnD

- Declares role **source** with `id`. Cards with `draggable: false` show no
  grip and never start a drag.
- ⌥-drag duplicate is a renderer affordance — it sets `duplicate: true` on the
  resulting `add` event; the Library itself fires nothing.
- The Library is also the **return-to-palette sink** for its connected
  targets (`remove.to = source`), rendered as a brand-tint drop highlight on
  the frame during an eligible drag.

## Renderer notes

- New slot recipe `library` (frame / toolbar / group head / card / grip /
  status pill / dim slots / footer). Card chrome from the chip + meter
  building blocks; group heads are the standard mono eyebrow row.
- Filtering dims (`opacity` + non-draggable), never unmounts — stable mental
  map per spec. Group-by + dimension toggles + search text are renderer-local
  state (persistable via `storageKey`).

## Decisions (reviewed)

1. **Group summary is a plain members accessor** — no aggregate-handle API.
2. **Status pills use the standard Status tone set**
   (success / warning / danger / info / neutral).
