# `<Schematic>` — 2D coordinate canvas for placed entities

> **2026-06-11 (navigation):** map-grade interaction added — ctrl/⌘-wheel
> zoom about the cursor, drag-pan, double-click / ⤢ fit, animated fly-to;
> semantic zoom (status dots ⇢ labelled pins ⇢ full cards by px-per-world
> -unit) with rbush viewport culling; adaptive 1/2/5 scale bar; navigator
> rail (geometric zone nesting, search-to-fly, viewport spy) and minimap
> with viewport rectangle. IR gains optional `navigator` / `minimap`
> booleans (defaults: navigator when zones exist, minimap at 25+ items).
> **2026-06-11:** interface unified to the row-mapper pattern — `item`/`zone`/`link` mappers return fields objects and are omissible when rows are already resolved (e.g. `links` typed `ArrayType(Schematic.Types.Link)`).


> **Status: implemented.** Deltas from this proposal, per the conventions
> settled during Roster/Calendar review: no `Schematic.node/zone/band/link`
> constructors — up to three flat tables (`items`/`zones`/`links`) with
> chart-style field encodings (`item`/`zone`/`link`); a band is a zone with
> `pattern: variant("hatch", null)`; `title`/`caption`/`footer`/`action`
> dropped (bare component — identity chrome is host composition);
> `onSelect` receives the item key (string). Closed-set fields in data
> (`status`, `pattern`, `style`) are typed variants.

Source spec: `configure__pattern__schematic` (`Collections.Schematic`).
Category: `collections/schematic`. **Read-only by default**; no DnD (opts out
of the grammar entirely, like Matrix). Appearance of a placed item comes from
its linked Library entry; *position and live metrics are owned here*.

## Anatomy (from spec)

- Frame: eyebrow title (`SCHEMATIC · SITE 3 · HALL B · 8 ITEMS`),
  header-right caption (`READ-ONLY · LIVE · LAST REFRESH 12S AGO`) + an
  `EDIT LIBRARY →` link.
- Canvas (world coordinates, metres): placed **nodes** — card with leading
  icon tile, label, status dot, kind sublabel, a mini meter + metric text
  (`28.8 kL`, `3 / 5`, `1,800 u/h`). Wide nodes (LINE-2) render as a low bar
  with inline pills.
- **Annotations** from the same data layer: dashed zone outlines with mono
  eyebrow labels (`FERMENTATION HALL · HALL B`, `QA CELL`, `DISPATCH`), a
  hatched band (`AISLE 3 · 1.6 M WALKWAY`), and **links** between nodes
  (solid pipe runs with junction dots, dashed routing curves).
- Scale bar bottom-right (`0 ─── 10 m`); live-status footer
  (`LIVE · model feed · refresh 12s · status from` + model chip).

## TSX

```tsx
<Schematic
    data={equipment}                                  // ArrayType(StructType)
    extent={{ width: 30, height: 14 }}                // world units; canvas scales to fit
    item={e => Schematic.node({
        key: e.id,
        x: e.x, y: e.y,                               // world coords (FloatType)
        label: e.id,
        sublabel: e.kind,                             // "FERMENTER · 40 KL"
        icon: e.icon,                                 // from the linked Library entry
        status: e.status,                             // "ok" | "warn" | "danger" | "idle" dot
        meter: { value: e.fill, max: e.capacity },    // optional mini meter
        metric: East.str`${e.fill} kL`,               // optional metric text
        width: e.kind.equal("line").ifElse(18, 4),    // optional world-width (wide bar form)
    })}
    annotations={[                                    // plain config — constructors, not child tags
        Schematic.zone({ label: "Fermentation Hall · Hall B", x: 0, y: 0, width: 19, height: 5 }),
        Schematic.zone({ label: "QA Cell", x: 21, y: 0, width: 5, height: 5 }),
        Schematic.band({ label: "Aisle 3 · 1.6 m walkway", y: 6.5, height: 1.6, pattern: "hatch" }),
        Schematic.link({ from: "TANK-04", to: "LINE-2" }),
        Schematic.link({ from: "QA-1", to: "BAY-OUT", style: "dashed", via: [{ x: 22, y: 8 }] }),
    ]}
    title="Schematic · Site 3 · Hall B · 8 items"
    caption={East.str`read-only · live · last refresh ${age}s ago`}
    action={{ label: "Edit library", onClick: openLibrary }}   // header-right link
    scaleUnit="m"                                     // scale bar; omit to hide
    footer={East.str`model feed · refresh 12s · status from plant-ops-v1.4`}
    onSelect={onSelectItem}                           // node click → the data row
/>
```

`annotations` can also be an East expression
(`SubtypeExprOrValue<ArrayType<SchematicAnnotationType>>`) when zones are
data-driven; the constructors build the variant values either way.

## Props (`SchematicConfig<R>`)

| Prop | Type | Notes |
|---|---|---|
| `data` | `SubtypeExprOrValue<ArrayType<R>>` | one element per placed item |
| `extent` | `{ width, height }` (Float) | world-coordinate bounds |
| `item` | `(e) => Schematic.node(...)` | position + face + live metrics |
| `annotations?` | `SubtypeExprOrValue<ArrayType<SchematicAnnotationType>>` | zones / bands / links |
| `title` | `SubtypeExprOrValue<StringType>` | frame eyebrow |
| `caption?` | `SubtypeExprOrValue<StringType>` | header-right status caption |
| `action?` | `{ label, onClick }` | header-right link (`EDIT LIBRARY →`) |
| `scaleUnit?` | `SubtypeExprOrValue<StringType>` | bottom-right scale bar unit |
| `footer?` | `SubtypeExprOrValue<StringType>` | live-status footer line |
| `onSelect?` | `FunctionType([R], NullType)` | node click |

Sub-constructors: `Schematic.node`, `Schematic.zone`, `Schematic.band`,
`Schematic.link` — the annotation variant
(`SchematicAnnotationType = VariantType({ zone, band, link })`).

## Renderer notes

- SVG canvas (like the chart renderers) with HTML node cards positioned via
  the world→pixel transform; links/zones/bands draw in the SVG layer
  underneath. Aspect ratio preserved from `extent`; the frame scrolls or
  letterboxes rather than distorting.
- New slot recipe `schematic` (frame / canvas / node / nodeWide / statusDot /
  meter / zone / zoneLabel / band / link / scaleBar / footer). Zone labels
  are the standard mono eyebrow; hatch pattern + dash treatments live in the
  recipe.
- No DnD, no selection-rectangle — single click selection only, matching the
  read-only contract. An editable placement mode is explicitly out of scope
  for v1 (the spec routes editing through `EDIT LIBRARY →`).

## Decisions (reviewed)

1. **Links address endpoints by node `key`, with optional `via: [{x, y}]`
   waypoints in v1** for pipe runs that must dodge zones.
2. **The `EDIT LIBRARY →` link ships as the generic `action` prop** on the
   frame header.
