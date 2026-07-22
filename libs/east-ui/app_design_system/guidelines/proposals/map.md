# `<Map>` — interactive geographic map with an overlay slot

**Status: shipped.** `Map` is a first-class `UIComponentType` variant authored
in East like `Schematic` / `Planner`, rendered natively wherever East renders.
It pairs a real raster basemap (CARTO / OSM tiles) with H3 hex and filled-area
overlays, connector lines, pins, and standalone labels — and introduces the one
genuinely new primitive that unblocks an interactive map embedded *inside* an
East surface: an **overlay slot** of `UIComponentType` children positioned over
the canvas.

Category: `collections/map`. **No DnD** (opts out of the drag grammar, like
`Matrix` / `Schematic`). **Read-only / selection-only**: interaction is
click-an-area (returns its key), zoom, and fly-to; the only *writes* ride in for
free through ordinary East `Button` children hosted in the overlay slot (the map
IR knows nothing about the decision). Colour is theme-owned throughout — data
selects a `tone` / `status` and the renderer's recipe maps each to a Chakra
token; the renderer never hardcodes hex.

---

## TSX

The Amplar "Move EN 5000 → 5100" decision map, authored in East, embedded in a
DecisionQueue decision's detail slot. The required first table (`markers`) is a
named prop; each table has one whole-row `{mapper}` accessor (the Schematic /
Planner convention — omit the mapper when rows are already resolved); scalars and
callbacks are plain props; the HUD is a `Map.overlay(...)` child.

```tsx
// @jsxImportSource @elaraai/east-ui
import { East, StringType, NullType, variant, some } from "@elaraai/east";
import { Map, VStack, HStack, Text, Button, Box, UIComponentType } from "@elaraai/east-ui";

const moveMap = East.function([], UIComponentType, $ => {
    const onArea  = $.const(East.function([StringType], NullType, (_$, _key) => null));
    const approve = $.const(East.function([], NullType, _$ => null));
    const reject  = $.const(East.function([], NullType, _$ => null));

    return (
        <Map
            tiles={Map.carto("positron")}                 // CARTO Positron (default); Map.osm() / Map.tile({...})
            center={Map.at(-34.881, 138.600)} zoom={12n}
            minZoom={10n} maxZoom={18n}
            lodZoom={13n}                                  // ≥13 ⇒ detail LOD (detail labels, the pin)
            scrollWheelZoom

            hexes={Map.hex({                               // faint res-8 lattice
                lattice: { center: Map.at(-34.881, 138.600), k: 11n, resolution: 8n },
                tone: "muted",
            })}

            areas={[
                { id: "5000", name: "5000 · Adelaide CBD",  lat: -34.9258, lng: 138.5994, idle: true },
                { id: "5100", name: "5100 · Prospect",      lat: -34.836,  lng: 138.600,  idle: false },
            ]}
            area={a => ({
                key: a.id,
                label: a.name,                             // permanent tooltip
                detailLabel: East.str`${a.name} · EN move`,// shown only at/after lodZoom
                shape: Map.hexDisk(Map.at(a.lat, a.lng), 1n, 8n),
                status: some(variant(East.ifElse(a.idle, "success", "danger").value, null)),
                flyTo: Map.point(Map.at(a.lat, a.lng), 14n),
            })}

            lines={[{ id: "move", approved: false }]}
            line={l => ({
                key: l.id,
                points: [Map.at(-34.905, 138.600), Map.at(-34.852, 138.600)],
                style: East.ifElse(l.approved, Map.solid({ tone: "brand" }), Map.dashed({ tone: "brand" })),
                flow: l.approved, arrow: true,
            })}

            markers={[{ id: "okafor", lat: -34.842, lng: 138.598, name: "J. Okafor · home" }]}
            marker={m => ({ key: m.id, lat: m.lat, lng: m.lng, label: m.name, icon: "house", minZoom: 13n })}

            overlays={[
                Map.overlay(
                    <VStack align="stretch" gap="2">
                        <HStack gap="2">
                            <Box width="6px" height="6px" borderRadius="full" background="brand.solid" />
                            <Text fontFamily="mono" color="brand.solid">ELARA · AUTO-DETECTED</Text>
                        </HStack>
                        <Text fontWeight="semibold">Idle EN capacity one cluster south.</Text>
                        <HStack gap="2">
                            <Button colorPalette="teal" onClick={approve}>Approve swap</Button>
                            <Button variant="outline" onClick={reject}>Reject</Button>
                        </HStack>
                    </VStack>,
                    { align: "start", verticalAlign: "start", key: "elara-hud" },   // screen-anchored top-left
                ),
            ]}

            onAreaClick={onArea}                            // also performs the built-in flyTo
            height="540px"
        />
    );
});
```

Any table may equally be passed already-resolved (`areas` typed
`ArrayType(Map.Types.Area)`, mapper omitted) — identical to Schematic's omittable
row-mapper. Tone fields accept the `"success" | "danger" | "brand" | "ink" |
"muted" | "warning"` literal shorthand or a `Map.Types.Tone` value.

---

## Props (`MapConfig<M, A, La, L>`)

| Prop | Type | Notes |
|---|---|---|
| `markers` | `SubtypeExprOrValue<ArrayType<M>>` | required first table (home pins, POIs) |
| `marker` | `(m) => MapMarkerFields` | marker row mapper; omit when rows are resolved |
| `tiles` | `SubtypeExprOrValue<MapTileType>` | basemap (`Map.carto("positron")` default) |
| `center` / `zoom` | `SubtypeExprOrValue<MapLatLngType>` / `IntegerType` | initial camera |
| `minZoom?` / `maxZoom?` / `lodZoom?` | `SubtypeExprOrValue<IntegerType>` | clamp + detail-LOD threshold |
| `fitBounds?` | `SubtypeExprOrValue<MapFocusType>` | alternative to `center` / `zoom` |
| `areas?` / `area?` | table + `(a) => MapAreaFields` | filled boundaries (postcodes) |
| `hexes?` | `SubtypeExprOrValue<MapHexLayerType>` | H3 lattice + per-cell detail |
| `lines?` / `line?` | table + `(l) => MapLineFields` | connectors / move arrows |
| `labels?` / `label?` | table + `(s) => MapLabelFields` | standalone labels |
| `overlays?` | `MapOverlayInput[]` | **the generalised overlay slot** (HUD / back / legend) |
| `scrollWheelZoom?` / `attributionPrefix?` / `height?` | scalars | defaults: true / false / aspect |
| `onAreaClick?` / `onMarkerClick?` / `onSelect?` | `FunctionType<[StringType], NullType>` | key callbacks |
| `onZoom?` | `FunctionType<[IntegerType], NullType>` | `zoomend` notification |

Sub-constructors (frozen `Map` namespace): `Map.Root(markers, config)` ·
`Map.at(lat, lng)` · `Map.carto(...)` / `Map.osm()` / `Map.tile({...})` ·
`Map.hexDisk(center, k, resolution)` / `Map.cells(ids)` / `Map.polygon(points)` · `Map.hex({...})` ·
`Map.marker({...})` / `Map.area({...})` / `Map.line({...})` · `Map.solid({...})` /
`Map.dashed({...})` · `Map.point(center, zoom)` / `Map.bounds(sw, ne)` ·
`Map.overlay(content, { align, verticalAlign, key?, geoAnchor?, offset?, interactive? })`.
Value types: `Map.Types.{Map, Marker, Area, AreaShape, Hex, Line, LineStyle,
Label, Tile, CartoStyle, Tone, Focus, Overlay, LatLng}`.

---

## The generalised overlay primitive

The central new mechanism. Today a HUD over a canvas can only be a sibling React
node outside East IR. The fix reuses a proven precedent: **embedding an East
child is `node` rendered through `EastChakraComponent`** (Card `body`, Planner
`popover`). The overlay slot legitimises calling that recursive dispatcher over
*positioned* children:

```ts
// registered INLINE in component.ts so `content` references the recursion node
overlays: ArrayType(StructType({
    content: node,                                                  // the East child tree (HUD / legend)
    align: AlignType, verticalAlign: AlignType,                     // screen corner
    key: OptionType(StringType),                                    // stable child storageKey segment
    geoAnchor: OptionType(MapLatLngType),                           // OPTIONAL: pin to a coordinate
    offset: OptionType(StructType({ x: FloatType, y: FloatType })), // px nudge
    interactive: OptionType(BooleanType),                          // default true; false ⇒ pointer pass-through
})),
```

The renderer paints each overlay as an absolutely-positioned flex layer that is a
**sibling of the Leaflet container** (zIndex ≥ 1000), hosting
`<EastChakraComponent value={content} storageKey={…overlay.${key}} />`. The
overlay layer itself is `pointer-events: none` so map drag passes through the
empty area; the overlay item is `pointer-events: auto` so its `Button` children
fire their own East callbacks. The same `overlays` field could be lifted to a
shared `CanvasOverlayType` and adopted by `Schematic` — recommended Map-local in
v1, hoist in the Schematic follow-up.

---

## Renderer

`EastChakraMap` (`east-ui-components/src/collections/map/`) follows the standard
`memo(…, equalFor(Map.Types.Map) && storageKey)` scaffold and consumes the `map`
slot recipe. The Leaflet basemap + H3 / area / marker / line layers live in a
**lazily-loaded engine** (`React.lazy` + `Suspense`) so the ~850 KB Leaflet + H3
payload is code-split out of the main bundle and only paid for, and only
imported (it touches `window`), when a Map actually renders — keeping a page that
merely *contains* a Map isomorphic / SSR-safe. The engine owns the imperative
`L.map` lifecycle (create on mount, sync layers from the immutable East value,
`map.remove()` on unmount), strips Leaflet's prefix while keeping the CARTO / OSM
credit, and re-measures with `invalidateSize` once the panel settles. H3 disks
expand via `gridDisk(latLngToCell(center, res), k)` → `cellToBoundary` — H3's
`[lat, lng]` order is Leaflet's, no swap.

---

## Decisions / deviations from the original proposal

- **Engine: vanilla `leaflet` (BSD-2-Clause), not `react-leaflet`.** Every
  React-19-compatible `react-leaflet` release is licensed **Hippocratic-2.1** — a
  non-OSI ethical-source licence incompatible with `east-ui-components`'
  AGPL-3.0 distribution. The renderer drives `leaflet` directly through a thin
  React effect wrapper; `h3-js` (Apache-2.0) is kept for hex indexing. Both are
  AGPL-compatible.
- **Pulse via CSS class, not the stroke-hex hack.** Because vanilla Leaflet
  forwards `pathOptions.className` to the SVG `<path>`, areas carry a tone /
  pulse class (`elara-map-area--danger` / `--pulse-danger`), and the `map` slot
  recipe maps each class to a token + keyframe. No literal-hex coupling, and
  light/dark themes follow the token automatically. A `prefers-reduced-motion`
  block disables the pulses on the same selectors.
- **Warning status pulses too** (amber), alongside danger (red) and
  success / info (teal); neutral is static — colour is never the only signal
  (areas always carry a textual `label`).
- **Per-area `popover` folded into geo-anchored overlays.** Rather than a
  separate node-bearing area popover, a callout glued to an area is expressed as
  a `Map.overlay(..., { geoAnchor })` — one overlay mechanism, and `Map.Types.Area`
  stays a clean passthrough type.
- **Geo-anchored overlay tracking is v2.** v1 ships the full screen-anchored
  overlay slot (the HUD / back / legend case); `geoAnchor` is accepted in the IR
  but rendered screen-anchored for now.
- **Offline / headless tiles.** CARTO tiles need network; offline the basemap is
  blank but the hex graticule, areas, lines, labels, and overlays still render
  (SVG, no network), so the component degrades gracefully.
