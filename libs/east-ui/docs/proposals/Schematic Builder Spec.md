# Schematic builder — design

The Schematic moves from east-ui to e3-ui and becomes one component,
`<Schematic>`, that always renders in its `BuilderFrame`, as `<Plan>`,
`<Sheet>` and `<Flowchart>` do. It has one toolbar holding every control, the
canvas in main, a footer, a library pane and an inspector pane. It draws one
drawing from the app's own records: items, zones, links and nets. Each is a
record of the app's whose fields are mapped to the Schematic's roles, as
Schedule's kinds are. Each kind may also have a details record keyed the same,
which the inspector shows and the cards on screen draw.

Every gesture is one transaction of the shared editing session. Each record is
a session of one history, and Save sends each record's changes through its
patch door. One `Slice.bindRecords` narrows every place a source's rows appear.

A large drawing is read a window at a time. e3 gains an area index, the 2D twin
of the interval index (§11), and the canvas reads only what the viewport shows,
with a margin around it, from the index alone. The details of the cards on
screen and the far ends of the links drawn come in one request per window,
through #1351's rows form (§12), and a view too wide to draw item by item
draws its density from the index's counts.

This document is the design the epic builds. Its rulings were given on 21 and
22 Oct 2026 (§3); the rest follows the builders already on main, and §3 names the
precedent each decision follows. Each sub-issue copies the sections and rules
it owns (§18).

## 1. The rule

A Schematic declares its kinds over the app's records. It stores nothing in a
shape of its own (#1365).

```tsx
// What it draws and writes: your records, their fields mapped to its roles.
items={{
    racks: Schematic.items(Record.bind(racks, [racksPatch]), {
        name: "Rack", icon: "server", x: "x", y: "y", width: "w", height: "h", label: "name",
        layer: "system", entries: Data.bindPaged(racks),
    }),
    cooling: Schematic.items(Record.bind(units, [unitsPatch]), {
        name: "Cooling unit", icon: "fan", x: "x", y: "y", width: "w", height: "h", label: "name",
        footprint: (unit) => some(Schematic.circle(unit.radius)),   // its own `radius: Float`, drawn as a circle
    }),
}}
links={{ fibre: Schematic.links(Record.bind(fibres, [fibresPatch]), {
    name: "Fibre run", from: { field: "from", of: "racks" }, to: { field: "to", of: "racks" }, via: "path",
}) }}

// What it shows beside a kind: another record of yours, keyed the same,
// read only and read by key, as its kind is read through its source (rule 4).
details: Schematic.details(Data.bindPaged(rackLoads), {
    meter: (load) => ({ value: load.kw, max: load.capacity }),
    metric: (load) => some(East.str`${East.Float.printFixed(load.kw, 1n)} kW`),
    status: { field: "alarm", cases: { ok: { label: "OK", tone: variant("success", null), ring: false }, … } },
}),
```

1. **A role is a field of the app's row, named.** Its type is checked against
   the role when the code compiles, and again at build. A mismatch is refused,
   naming the role, the field and the field's type. A role the app computes
   (a sub-label, a meter, a tone) is an accessor `(row, key) => …`, reified
   once and called per row. So is a role whose value is one of the
   Schematic's own types (a footprint, a zone's shape, a pattern, a style):
   the accessor builds it with the Schematic's helpers from the row's own
   fields, so the app's record holds only its own types (D35).
2. **A gesture writes only the fields its roles map.** Every other field of the
   row reads back as it was. The inspector edits the other fields through the
   kind's `fields` hints, or through the kind's own `inspector`.
3. **An optional role left out turns off what it drives.** Without `layer`,
   the kind's entities are on no layer. Without `footprint`, an item draws as
   its card and its marker. With `x` and `y` Options, an item kind has a
   backlog: the rows with no position, listed in the Backlog tab (§7, §8).
4. **A kind is editable when bound with its patch door**,
   `Record.bind(record, [e3.mutation.patch(record)])`, and read only when
   bound with `Data.bind(record)` or `Data.bindPaged(record)`. How it is
   bound follows how it is read (§10.4):

   | | Read whole (no source) | Read through its source |
   |---|---|---|
   | Editable | `Record.bind(record, [patch])` | `Record.bind(record, [patch])`, with `entries: Data.bindPaged(record)` |
   | Read only | `Data.bind(record)` | `Data.bindPaged(record)`, as `Schedule.resources` takes one (#1199) |

   Every other form is refused, naming the one to use. `Data.bind` is
   fetched whole, which a source exists to avoid; a paged binding has no
   whole read; and beside `Data.bindPaged`, a record `Record.bind` reads
   isn't preloaded, so its read fails on the real e3 (#1343). `readOnly`
   makes every kind read only.
5. **Kinds are by slot.** `items={{ racks, cooling }}` and
   `links={{ fibre, power }}`: each slot is the kind's name in the payload and
   the name of the source of the slice that narrows it.

## 2. What is removed

Each of these is removed. An app that still passes one is refused at build, and
the message names the form that replaces it.

| Schematic today | Becomes |
|---|---|
| `items={rows}` with `item={(row) => ({ … })}`, and likewise `zones`/`zone`, `links`/`link`, `nets`/`net` | `items={{ <slot>: Schematic.items(record, roles) }}`, and `zones`, `links` and `nets` the same, over the app's records (§4) |
| `Schematic.Types.Item`, `Zone`, `Link`, `Net` as the rows an app passes | the app's own row types; those four remain only as the kinds' wire (§4.8) |
| `onMoveItem`, `onCreateLink`, `onEditLink`, `onDeleteLink`, `onEditNet` | the editing session: every gesture is a transaction, and Save writes the records (§7) |
| `linkMode` (`draw` or `connect`) | the Connect tool, which always records a link (§7). An app that plans operations between items gives them a link kind of their own |
| `readOnlyLinks`, `readOnlyItems` | the kind bound read only, with `Data.bind` or `Data.bindPaged` (§1, rule 4) |
| `itemHover`, `zoneHover`, `linkHover` | the inspector (`inspector`), and a kind's own `inspector` (§9) |
| `slice={Slice.bind(…)}` beside `items={Slice.partition(…)}`, and `affordances` | `slice={{ slice: Slice.bindRecords(key, { … }), affordances? }}`; each source is named after the kind it narrows (§10) |
| `sliceHidden`, `sliceOpacity`, `sliceDesaturate`, `sliceDot`, `sliceEmphasis`, `sliceFrame`, `sliceFrameFit`, and an item's `excluded` | `narrowed`, whose dim options are read from each source's shown keys (§10.3) |
| `sliceSelectField` | nothing: the selection drives the inspector, and the rail is the only narrowing |
| `selectionMode` | built in: a tap selects, Shift extends, and the Marquee tool boxes (§6.1) |
| `navigator` | the Library's Index tab (`Schematic.library.index()`, §8) |
| `layers={[ { key, label, tone, visible, locked, opacity } ]}`, a list written in the code | `layers={Schematic.layers(rows, { label, order?, tone?, color?, visible?, locked?, opacity? })}` over the app's record of layers (D36, §8); `visible` and `locked` stay the author's defaults, and the viewer's choices live in the Layers tab |
| `height`, `maxHeight` | the box the Schematic fills: `<Box height="640px"><Schematic … /></Box>` |
| `color` and `bg` as raw CSS strings | a theme colour token, such as `status.warn` or `heat.3`, resolved through the theme on the canvas and the cards alike (§4.1), or `tone` |
| a footprint's and a zone's `polyline` and `polygon` vertices in world coordinates | offsets from the entity's anchor, an item's centre or a zone's box centre, inside its box (§4.7) |
| a footprint or a zone's shape stored in the app's row as `Schematic.Types.Geometry`, its role naming that field | an accessor building the shape from the row's own fields with `Schematic.circle`, `polygon`, `polyline` or `rect` (D35, §4.1, §4.2) |
| `onSelect` and `onSelectZone` (one key each), `onSelectionChange`, `onZoneSelectionChange` and `onSelectLink` | `onSelect`, hearing the whole selection after each change, each entity by its `Ref` (D34, §5) |
| `onViewportChange` | nothing: the canvas reads its own window (§10.4) |
| `onItemOpen` | Enter or a double-click opens the selection in the inspector's Details (§9) |
| `selectZoomFocus` | nothing: a tap selects in place, and Find, the Index tab and the arrow keys fly to what they pick |
| `canConnect(from, to)` returning a Boolean | `canConnect(candidate)` returning `none`, or the refusal's words, which the draft shows (D34, §5) |
| `name` | `id` (D31, §5) |
| `inspector` on by default, and `inspector={{ <slot>: Details }}` | `inspector`, `true` or `false`, off by default; a kind's own Details is its kind's `inspector` (D32, §9) |
| `Schematic.library.templates(slot)`, `Schematic.library.unplaced(slot)` | `Schematic.library.templates()` and `Schematic.library.backlog()`, each over every kind (D33, §8) |

**No converter.** An app's rows become its records, as with any record whose
type an application changes. east-ui's `Schematic` arm goes from
`UIComponentType` (§16).

## 3. Decisions

| # | Decision | From |
|---|---|---|
| D1 | e3 gains an **area index**, the 2D twin of the interval index (§11). It is SDK-generated keys over the ordinary index build, mutation and paging machinery, with no new route and no new storage. It is a child of #1350. | ruled 21 Oct 2026 ("2d area index sounds awesome") |
| D2 | **All of #1350** lands in this epic's PR and is built alongside it: #1039 (the Plan's paging in two dimensions, re-designed: D27), #1349 (place and within), #1351 (several key searches in one request) and the area index. | ruled 21 Oct 2026 ("id like to add this to our PR", "and do that work at the same time") |
| D3 | **Details**: each kind may name a details record keyed the same (`Schematic.details`). The inspector shows it, editable when bound with its patch door, and the cards on screen draw its status, meter and metric. A window's details come in one request through #1351's new rows form (§12), never one per item. | ruled 21 Oct 2026 ("Inspector and cards") |
| D4 | **One drawing**: `extent` and `scaleUnit` are props, and the Schematic's records hold one drawing. | ruled 21 Oct 2026 |
| D5 | **Narrowed-out rows are hidden.** `narrowed="dim"` keeps them as context with today's ghost options: opacity, desaturate, dot, emphasis, frame and fit (§10.3). | ruled 21 Oct 2026 |
| D6 | **Unplaced items**: an item kind whose `x` and `y` are Options has a backlog, listed in the Library's Backlog tab (`Schematic.library.backlog()`, D33). A drop places a row; Unplace in the inspector clears its position (§7, §8). | ruled 21 Oct 2026 |
| D7 | **Deleting an item** deletes the links that name it and its legs of every net, in the same step. Undo restores them all. | ruled 21 Oct 2026 |
| D8 | **Sample data**: a data centre floor. Racks are items with power meters; halls and cages are zones; hot and cold aisles are hatched bands; fibre runs are links; power distribution units feeding many racks are nets; power, cooling, network and structure are layers. The current corpus is rewritten whole before the move (§18, task 2). | ruled 21 Oct 2026 |
| D9 | The app's own records, through kinds and roles. | #1365 ("a builder stores nothing in a shape of its own") |
| D10 | One `<Schematic>`, always in its `BuilderFrame`; the panes are optional props. | the Plan and Sheet ruling (2026-10-05) |
| D11 | Hover cards go; the inspector shows the selection, and a kind's own `inspector` gives the app's own Details. | the Flowchart (#1250, FB46) |
| D12 | Edit callbacks, `linkMode` and the sizes are refused: the gestures are the session's, and the Schematic fills its box. | the Flowchart (#1245, #1247) |
| D13 | One `Slice.bindRecords`; templates are records; a Library tab's search finds within that tab alone. | #1340 (rulings 9 and 11) |
| D14 | Colours are a `tone`, or a theme colour token that the canvas resolves through the theme. Today a token name never reaches the canvas, which can't parse one and silently draws the previous colour. | the design system's token rule (my call) |
| D15 | Below 480px of main, the canvas pans, pinches and selects. No drag source, drop target or handle is registered, and Move, Connect, Place and Delete are the inspector's actions. | the renderers' guide ("specify the equivalent domain actions"; my call) |
| D16 | Selection is built in: a tap, Shift to extend, and the Marquee tool. | the Flowchart's selection (my call) |
| D17 | Links and nets are read complete. A drawn link's end outside the window is read by its key, all of a window's in one request (§10.4). | my call: a link's row has no box of its own |
| D18 | **Bindings follow reads.** A kind or a details record read through its source binds `Record.bind` with `entries`, or `Data.bindPaged` read only; one read whole binds `Record.bind` or `Data.bind`. Every other form is refused (§1, rule 4). | `Schedule.resources`' paged form (#1199) and the preload finding (#1343) |
| D19 | **The window is a case of the one choice type.** The record slice's choice type gains `window`, which a read gives under an area index's `__area` and the rail never holds or shows. A narrowing is a `Dict` of choices, which beast2 reads at exactly the type it was written with, so one an earlier build wrote (a browser's kept rail, a Sheet's saved views) does not read under the new type and resets. No second type keeps it readable (§11.4, §16). | ruled 22 Oct 2026: while the product is unreleased, no type is added to keep earlier saved filters readable. The first draft's claim that they would still decode was wrong |
| D20 | **An area index with no `on`.** A kind read by area declares one, which reads the window whatever the rail chooses; an area index led by a field, beside it, reads a choice of that field and the window in one, while their searches stay within the record slice's bounds (§10.4). | my call: an index led by a field can't read a window for a rail that doesn't choose that field |
| D21 | **A constructor per generated index.** Each index that answers more than an order has its own constructor, its options typed by the row: `e3.recordIndex.interval` (the events overlapping a time window: `from`, `to`), `e3.recordIndex.area` (the boxes meeting a window: `x`, `y`, `width`, `height`, `at`), and the per-key time series #1039 is re-designed as (`{ key, at }`). `e3.recordIndex` keeps the plain indexes (`on`, `key`, `keys`) and refuses `interval`, naming the constructor (§11.1). | my call, 22 Oct, on the user's questions: "Are we sure we shouldn't just have explicit dx for different index types?"; "one of these index types is temporal, another is key temporal, i.e. { key: string, at: date }" |
| D22 | **Geometry is drawn about its entity's anchor**, an item's centre or a zone's box centre, inside its box. Move writes `x` and `y` and the outline follows, a template's outline lands where it is dropped, and the area index boxes every row by its fields, so no computed box or `Schematic.areaBox` is needed (§4.7). | my call, 22 Oct, on the user's question "why Schematic.areaBox?": today's move overlay writes `x` and `y` alone, and leaves a world-coordinate outline behind |
| D23 | **The area index's resolution is declared.** `e3.recordIndex.area` takes `cell`, the finest cell's side in world units, rounded down to a power of two so its arithmetic is exact on every runtime. It has no default (§11.1, §11.2). | ruled 22 Oct 2026 (the review's eight fixes, §19: "All eight") |
| D24 | **A runs read, and cells unmerged.** #1351 gains a runs form, the entries of several runs of one index in one request, so a window is one `findKeys` request and one runs read. The area index's cells aren't merged, so a cell's search is the same in every window that holds it (§11.3, §12). | ruled 22 Oct 2026 (the review's eight fixes, §19: "All eight") |
| D25 | **An overview density layer.** Past 5,000 rows in view, the canvas draws a density raster from the area index's cell counts, in one request with no rows read, and draws items again once a view holds fewer (§10.4). | ruled 22 Oct 2026 (the review's eight fixes, §19: "All eight") |
| D26 | **Finer planning, an explicit margin.** A window is the viewport grown by an eighth of its larger side on each side, planned at the deepest level whose cell is at least an eighth of that (§11.3). | ruled 22 Oct 2026 (the review's eight fixes, §19: "All eight") |
| D27 | **The Plan's time index files by tile.** #1039 is re-designed as the key-temporal index, `e3.recordIndex.series`, which files each event under each time tile it touches with the rows in key order inside a tile, so the Plan reads a rows × time rectangle as one range a tile and no pager changes (§11.7). | ruled 22 Oct 2026 (the review's eight fixes, §19: "All eight") |
| D28 | **A window's narrowing by `within`.** Under a narrowing its area index doesn't lead, a window asks #1349's `within` which of its rows the narrowing holds, in one request (§10.3). | ruled 22 Oct 2026 (the review's eight fixes, §19: "All eight") |
| D29 | **A window reads its index alone.** The area and key-temporal indexes carry their whole rows, so a window reads no record segment. `Data.bindPaged`'s rule of one projection a binding becomes: each index carries the whole row or nothing, and each is read as it can, one that carries the row without a join and one that doesn't with it (§10.4, §11.1). | ruled 22 Oct 2026 (the review's eight fixes, §19: "All eight"), with the binding rule my call: one source keeps every tab and the rail on one binding |
| D30 | **Each segment read once.** `findKeys`, the rows form and the runs form read each segment they touch once, several at a time, and decode it once, and the API process keeps decoded segments, by content hash and bounded by bytes, for every dataset route (§12). | ruled 22 Oct 2026 (the review's eight fixes, §19: "All eight") |
| D31 | **`id` names the Schematic.** Its frame's panes, its library, its layers, its tools and its drop surface are kept under `schematicKeys(id)`, as `planKeys(id)` keeps the Plan's. `name` is refused, naming `id`. | ruled 22 Oct 2026, on the user's "the schematic seems to have a different dx to the more common plan, roster, calendar etc" (#1401) |
| D32 | **The inspector is opted into.** `inspector` is `true` or `false`; left out, there is no end pane, as the Plan's, the Roster's and the Calendar's. A kind's own Details is its kind's `inspector`; `inspector={{ <slot>: Details }}` is refused, naming it. | ruled 22 Oct 2026 (#1401) |
| D33 | **The library's tabs cover every kind.** `Schematic.library.templates()` lists every kind's templates and `Schematic.library.backlog()` every item kind's rows with no position, each kind's under its name, in tabs named Templates and Backlog, as the Calendar's are. `templates(slot)` and `unplaced(slot)` are refused, naming them. | ruled 22 Oct 2026 (#1401) |
| D34 | **The Schematic reports as the Calendar does.** `onSelect` hears the whole selection after each change, each entity by its `Ref`, and `[]` when it is cleared. `canConnect` hears a `Candidate`, `{ kind, from, to }`, and returns `none`, or the refusal's words, which the draft shows, as `canDrop`'s show on the Calendar's ghost. `onSelectionChange`, `onZoneSelectionChange`, `onSelectLink`, `onViewportChange`, `onItemOpen` and `selectZoomFocus` are refused, each naming what replaces it. | ruled 22 Oct 2026 (#1401) |
| D35 | **Shapes are accessors over the app's own fields.** `footprint` and a zone's `geometry` return an `Option<Schematic.Types.Geometry>` built with `Schematic.circle`, `polygon`, `polyline` or `rect`, so the app's records hold only its own types; `pattern` and `style` were accessors already. A link's `via` stays a field: an `Array` of `{ x, y }` Floats, which any app's points already are. | ruled 22 Oct 2026, on the user's "also roster etc have like helpers to defined mapped entries etc, are we doing that?" (#1401) |
| D36 | **The layers are the app's rows.** `layers={Schematic.layers(rows, { label, order?, tone?, color?, visible?, locked?, opacity? })}` reads a keyed record of the app's through accessors, as `Roster.groups(teams.read(), { label, order })` does, in their `order`, then key order; an entity's `layer` names a layer by its key. A list written in the code is refused, naming `Schematic.layers`. | ruled 22 Oct 2026 (#1401) |

## 4. The kinds

Each declaration takes the app's record and its roles, checked as Schedule's
are (`e3-ui/src/schedule/events.ts`' `role(…)`). It closes the record behind
East functions over beast2 bytes (§4.8), so the payload is one type whatever
the rows hold.

### 4.1 `Schematic.items(record, config)`

One kind of placed item: racks, cooling units, power distribution units.

| Role | A field of the row of type | Written by | Drives |
|---|---|---|---|
| `x`, `y` | `Float`, or both `Option<Float>` | Move, Place, Unplace | the item's centre in world units. With Options, the kind has a backlog: rows with no position never draw and are listed in the Backlog tab |
| `label` | `String` (a field, or an accessor) | the inspector | the card's name and the labelled dot |
| `width`, `height`? | `Float` | the inspector | the item's world box about its centre: the card's width, the bounds its footprint lies inside, and its box in the area index (§11) |
| `footprint`? | an accessor to `Option<Schematic.Types.Geometry>`, built with `Schematic.circle`, `polygon`, `polyline` or `rect` from the row's own fields (D35) | the inspector, through those fields | the shape drawn at card zoom, about the item's centre (§4.7): a circle, a polyline or a polygon. One outside its box is listed in Issues |
| `layer`? | `String` | the inspector | the layer the item is on (§8) |
| `icon`? | a Font Awesome solid icon name, or an accessor returning one | — | the card's icon |
| `sublabel`?, `metric`? | accessors to `String` / `Option<String>` | — | the card's second line, and its figure |
| `meter`? | accessor to `{ value: Float, max: Float }` | — | the card's bar |
| `status`? | `{ field, cases }`: a variant field, with a `Schematic.Types.Status` per case (`label`, `tone`, `ring`) | the inspector | the card's dot and the marker's colour |
| `tone`?, `color`? | accessors to `Option<Schematic.Types.Tone>` and to `Option<String>` (a theme colour token) | — | an override of the status colour (D14) |
| `weight`?, `fillOpacity`? | accessors to `Option<Float>` | — | the footprint's stroke and its fill |

Options:
- `name` and `icon` (required);
- `entries`: `Data.bindPaged(record)`, the record's own entries, for an editable kind read through its source of the slice, and refused otherwise (§1, rule 4). It gives by-key reads for the inspector, for a gesture's original and for Save's confirmation, as Schedule's `entries` does. A kind bound with `Data.bindPaged` reads by key through that binding;
- `details` (§4.5);
- `templates` (§4.6);
- `fields`, the inspector form's hints over the fields no role writes (`Fields`);
- `inspector`, the kind's own Details (`(row, update) => UIComponentType`, wrapped by `rowInspector`);
- `ready`, the app's check on a drafted row, which holds Save, naming the item.

A status, a meter or a metric given both here and by the kind's `details` is
refused, naming the two, and so is a `footprint` without `width` and `height`.

### 4.2 `Schematic.zones(record, config)`

Halls, cages, aisles: drawn under the items, outlined or hatched.

| Role | Type | Drives |
|---|---|---|
| `x`, `y` | `Float` | the zone's top-left corner |
| `width`, `height` | `Float` | its box |
| `label` | `String` | the eyebrow on its boundary, and its line in the Index tab |
| `pattern`? | accessor to `Schematic.Types.ZonePattern` | outline (default) or hatch. A hatched zone is an annotation: it holds no items in the Index tab and takes no tap |
| `geometry`? | an accessor to `Option<Schematic.Types.Geometry>`, built from the row's own fields as a footprint is (D35) | its drawn shape, about the box's centre (§4.7); the box stays its bounds |
| `layer`?, `tone`?, `color`?, `fillOpacity`?, `weight`? | as an item's | |

Options are `name`, `icon`, `entries`, `details`, `fields`, `inspector` and
`ready`. Zones take no gesture on the canvas: their fields are edited through
the inspector, when the kind is bound with its patch door.

### 4.3 `Schematic.links(record, config)`

| Role | Type | Written by | Drives |
|---|---|---|---|
| `from`, `to` | `{ field, of }`: a `String` field holding a key of the item slot `of` names, or a variant field of String cases, `of` naming an item slot per case (Schedule's resource shapes) | Connect, Retarget | the link's ends |
| `via`? | an `Array` of `{ x: Float, y: Float }` (`Schematic.Types.Point`): the app's own points | the inspector | its waypoints |
| `label`?, `metric`? | accessors | — | the pill at the path's middle, from the label zoom |
| `style`?, `route`? | accessors to `Schematic.Types.LinkStyle` and `Route` | — | solid or dashed, its tone and weight; orthogonal or direct |
| `layer`? | `String` | the inspector | its layer |

Options are `name`, `icon`, `entries`, `details`, `templates` (§4.6, which
retype a link), `fields`, `inspector` and `ready`. A link Connect records
writes `from` and `to`. Its other fields take their type's default (East's
`defaultValue`), or the values of the link template selected when the drag
began (§7).

### 4.4 `Schematic.nets(record, config)`

| Role | Type | Written by | Drives |
|---|---|---|---|
| `sources`, `destinations` | `{ field, of }`: a `Set<String>` or `Array<String>` field of item keys, `of` as a link's | Connect's Shift session, a leg's Delete, Extend | the trunk's two sides |
| `via`?, `label`?, `metric`?, `style`?, `route`?, `layer`? | as a link's | | |

Options are as a link's.

### 4.5 `Schematic.details(record, config)`

A record of the app's, keyed as its kind is. It holds what the inspector shows
beside the row and what the cards on screen draw:

- `status`?, `meter`?, `metric`?, `sublabel`? — as §4.1, over the details row;
- `fields`?, `inspector`? — the inspector's form over the details row, or its
  own Details;
- `entries`: `Data.bindPaged(record)`, when the details are editable and their
  kind is read through its source.

The details are bound as their kind is read (§1, rule 4). Beside a kind read
whole, they are `Data.bind(record)`, read only, or `Record.bind(record,
[patch])`, and read whole with it. Beside a kind read through its source, they
are `Data.bindPaged(record)`, read only, or `Record.bind(record, [patch])`
with `entries`, and read by key: the selection's, and all of a window's in one
request (§12). Editable, they are a session of their own in the one history:
an edit in the inspector is one transaction, and Save sends it. A kind's row
with no details row shows none, and its card draws no meter.

### 4.6 `Schematic.templates(rows, config)`

Templates are records (#1340, ruling 9), as Schedule's are:
`Schematic.templates(templates.read(), { name, group?, icon?, values, source })`
over a record bound with `Data.bind`.

- For an item kind, `values` returns the row's fields except `x` and `y`.
  Dropped on the canvas, a template adds an item at the drop point, its key
  minted (§7).
- For a link kind, `values` returns the row's fields except `from` and `to`.
  Dropped on a link, a template retypes it: it writes its values and never
  the link's ends.

A list written in the code, or one naming no source of the slice, is refused,
naming the change (`templatesSource`).

### 4.7 Value types and helpers

`Schematic.Types` holds the value types the Schematic's accessors return and
its kinds' wire carries: `Geometry`, `Vertex`, `Point`, `Tone`, `ZonePattern`,
`LinkStyle`, `Route`, `Status`, `StatusCases(V)`, `Meter` and `Patch(R)`. An
app's records hold their own types, which its accessors map (D35). It adds:

- `Ref`, `{ kind: String, key: String }`: an entity named by its slot and its key;
- `Box`, `{ minX, minY, maxX, maxY }` in world units;
- `Candidate`, `{ kind: String, from: Ref, to: Ref }`: the link or net a Connect, a Retarget or an Extend would write, and its two items, as `canConnect` hears it (§5).

These helpers stay: `outline`, `hatch`, `solid`, `dashed`, `rect`, `circle`,
`polyline` and `polygon`. `polygon` and `polyline` take the row's own points,
`{ x, y }` (a bulge of 0) or `{ x, y, bulge }`, and `polyline`'s `width` takes
a row's Float. These are added:

- `Schematic.patch(R, { … })`: what an author's card dropped on an entity sets, as `Schedule.patch`;
- `Schematic.layers(rows, { … })`: the layers, from the app's record (§8);
- `Schematic.library.*` (§8).

**Geometry is drawn about its entity's anchor** (D22): an item's centre, or a
zone's box centre. A `circle` centres on it, as today, and the vertices of a
`polyline` or a `polygon` are offsets from it in world units, where today they
are world coordinates. So an item's outline moves with it, a template's lands
where it is dropped, and every kind's box is its fields. Geometry outside its
box still draws, and Issues lists it. An import that holds world coordinates
subtracts the anchor once.

### 4.8 The kinds' wire

Each kind is built under its slot into a closed struct, as
`ScheduleKindType`/`ScheduleRosterKindType` are. Every row crosses as bytes:

- `rows(where)`: the kind's stored rows a read holds, by key, each one's roles beside its bytes, read in one pass;
- `read(bytes, key)`: a drafted row's roles;
- `write(bytes, roles)`: the row with its mapped fields written and every other field as it was;
- `create(roles, values?)`: a new row, with its mapped fields written and every other field from a template's values or its type's default;
- `editing`: the shared session over the record (`scheduleRecordSession`), with its patch door;
- `entries`: the record read by key;
- `history`, `fields`, `inspector`, `ready`, `templates` and `templatesSource`;
- the kind's `details`, closed the same way.

`Schematic.Types.Item`, `Zone`, `Link` and `Net` remain only as the roles a
kind's `rows` gives the renderer.

## 5. `<Schematic>`

| Prop | Type | |
|---|---|---|
| `extent` | `{ width: number, height: number }` | the drawing's world bounds; the canvas fits them |
| `scaleUnit`? | `String` | the scale bar's unit |
| `items` | `{ [slot]: Schematic.items(…) }`, one at least | |
| `zones`?, `links`?, `nets`? | by slot | |
| `layers`? | `Schematic.layers(rows, { label, order?, tone?, color?, visible?, locked?, opacity? })` | the layers, from the app's record, and their defaults (§8) |
| `slice`? | `{ slice: Slice.bindRecords(key, { … }), affordances?, persist? }` | the rail (§10) |
| `narrowed`? | `"hide"` (default), `"dim"`, or `{ show: "hide" \| "dim", opacity?, desaturate?, dot?, emphasis?: "halo" \| "pulse", frame?, fit? }` | §10.3 |
| `library`? | `Schematic.library.*` calls, in order | the start pane; left out, none |
| `inspector`? | Boolean, `false` by default | the end pane (§9); left out, none. A kind's own Details is its kind's `inspector` |
| `readOnly`? | Boolean | no gesture, drop or inspector edit; selection stays |
| `id`? | String | the Schematic's keys (`schematicKeys`), when one surface holds two |
| `grid`?, `minimap`? | Boolean | the metric grid (on by default); the minimap (shown at 25 items or more by default) |
| `canConnect`? | `(candidate: Candidate) => Option<String>` | vetoes a link or a net before a draft snaps: `none` allows it, and words refuse it and show on the draft. A throwing veto allows the pair and logs it |
| `onSelect`? | `(selected: Array<Ref>) => Null` | hears the whole selection after each change, each entity by its `Ref`: items, zones, links and nets alike; `[]` when it is cleared |

The carrier is `EastUI.component("Schematic", SchematicPayloadType, { optional:
true })`, and its renderer registers through `implementUIComponent`.
`schematicKeys(id)` names the frame's storage, the library, the layers' and
the tools' UI-store keys and the drop surface, as `planKeys(id)` does.

## 6. The frame

### 6.1 Toolbar

The items, in order, on the frame's one folding row:

1. **The rail** — `useRecordSlicesToolbarItems` over the slice. It folds first, then its summary (`SUMMARY_RANK`).
2. **Tools**, one segment: Select (a tap selects; a drag on empty canvas pans), Zoom box, Marquee, Connect (shown while a link kind is editable), and Move (shown while an item kind is editable). Connect's menu chooses the link kind it draws, the first editable by default. Holding Space gives Select and holding Ctrl gives Zoom box, while the pointer is over the canvas.
3. **Zoom** − / + and **Fit**.
4. **Find** — `useKeySearchToolbarItem` over the item kinds' keys (each kind's `entries` seek). A pick flies to the item and selects it. ⌘F focuses it.
5. **Previous / next item**, while something is selected.
6. **History** — `historyToolbarItem`, last (Undo · Redo · Discard · Save), while any kind edits.

On a phone the row holds the rail's icon, a View bundle (Tools, Zoom, Fit,
Find) and the history item (the Plan's View-bundle precedent).

### 6.2 Main

Main holds the canvas. The minimap and the scale bar stay on it (bottom-right).
There are no controls of its own: what was its control column is the toolbar's
(§6.1).

### 6.3 Footer

On the shared `builder-footer.ts` rail:
- the counts: items drawn of the kind's total, zones, links;
- the changes waiting on Save;
- each record's last save;
- the shared Save notice, `RecordSliceSaveNotice`, for each source a Save took rows out of;
- why a drop or an inspector edit was refused.

### 6.4 Panes and banners

The library is in the start pane when `library` lists a tab (§8). The
inspector is in the end pane when `inspector` is given (§9). Their open tab and
collapsed state persist under `schematicKeys(id).frame`.

Banners sit under the toolbar: the sessions' (`SessionBanners`, each titled by
its record), and a source whose narrowing couldn't be read, with Retry.

### 6.5 Loading

`BuilderFrame.loading` covers the frame until the first window (or complete
read) and the zones have landed. Later reads keep the canvas, and the previous
window stays drawn until the next lands (§10.4).

## 7. Editing

| Gesture | Records | One step writes |
|---|---|---|
| Move (Move tool) | the item kinds | every selected item's `x`, `y` by the drag's delta, clamped to the extent; on release |
| Connect (Connect tool) | a link kind | a new link, its `from` and `to`, its key minted |
| Shift + Connect | a net kind | the session's net: its `sources` and `destinations`. The first Shift-extension turns the session's link into a net, deleting the link it absorbed |
| Retarget (a selected link's end handle) | a link kind | the link's `from` or `to` |
| Extend (Shift-drag from a member of a selected net) | a net kind | its `destinations` |
| Del on a link | a link kind | the link deleted |
| Del on a net leg, or on a net | a net kind | the leg's endpoint removed, or the net deleted. Removing a side's last member deletes the net |
| Del on items | items, links, nets | the items deleted, with every link naming one and every net leg naming one (D7) |
| Drop an item template | an item kind | a new item at the drop point, its key minted, its values the template's |
| Drop an unplaced item | an item kind | its `x`, `y` |
| Unplace (inspector) | an item kind | its `x`, `y` to `none` |
| Drop a link template on a link | a link kind | its values; never `from`, `to` or its key |
| An author's card dropped on an entity | the entity's kind | the fields its `Schematic.patch` sets |
| An inspector edit | the entity's kind, or its details | the field |

- **Sessions.** Each record the Schematic writes, a details record among them,
  is one session of one `EditHistory` (`useEditHistory`, over
  `shared/schedule/editing.ts`' `useScheduleEditing`). A gesture records the
  rows it changes across records as one step.
- **Save** sends each session's batch through its record's patch door
  (`Record.onApply(record, { keyed: true })`). A conflict or a refusal keeps
  that record's drafts and leaves the others' commits standing. An unknown
  outcome keeps the drafts and the request's identity for Retry.
- **Keys.** A new item's, link's or net's key is minted unique among every key
  the Schematic has read and drafted (`mintKey`, `crypto.randomUUID()`).
- **Drafts outside the window** stay in their sessions; Save includes them, and
  a draft moved into the window shows (§10.4).
- **Keys for history.** ⌘Z, ⇧⌘Z and ⌘Y work anywhere in the frame except a field
  being typed into (`historyShortcut`, `typedInto`).
- **Read only.** A kind bound read only (`Data.bind`, `Data.bindPaged`) takes
  no gesture, drop or edit.
  The tools that would write it don't show, and its fields show read only.

## 8. The library

`library` lists the tabs, in order:

- `Schematic.library.templates()`: every kind's templates (§4.6), each kind's
  under its name, then grouped by their `group`, each card a drag source: an
  item kind's land on the canvas, a link kind's on a link. Each kind's cards
  follow their templates' source. A Schematic none of whose kinds has
  templates is refused, naming the change (D33).
- `Schematic.library.backlog()`: every item kind's rows with no position,
  each kind's under its name, each a drag source, in the Backlog tab, as the
  Calendar's is. Read by area, a kind's are paged through the area index's
  unplaced clause (§11.4) with `PagedLibrary`, counted `N of M`; read whole or
  complete, they are listed from the rows in hand. A Schematic none of whose
  item kinds has `x` and `y` Options is refused, naming the change (D33).
- `Schematic.library.index()`: the zones, nested by containment. The zone the
  viewport is in is marked, a click flies to a zone and selects it, and an
  opened zone lists its items, read through each item kind's source by the
  zone's box (§10.4). Its search finds items by the sources' `search` fields
  (ruling 11). Hatched zones hold no items.
- `Schematic.library.layers()`: each layer `Schematic.layers` reads from the
  app's record (D36), its swatch, label and count, with Isolate, Lock and Show
  or Hide, and Show all. The viewer's choices persist under
  `schematicKeys(id).layers`. A locked layer's entities never select,
  and a hidden layer's never draw. Like the Plan's Series and the Sheet's
  Columns, these are view settings.
- `Schematic.library.tab(rows, { name, key, label, meta?, group?, icon?, drop?, source? })`:
  the author's own cards. A card's `drop` is a `Schematic.patch(R, …)` whose
  row type names the kind it lands on.

Each tab follows the source it names (`sourceTab`, `FollowSources`): its count
reads `10 of 33` while the rail narrows it. A tab the rail empties says so,
with Clear filters. A tab's search box finds within that tab alone.

## 9. The inspector

Given `inspector`, the end pane holds Details and Issues, on the shared
inspector parts (`inspector-head`, `FieldForm` through `Fields.specs`). Enter,
or a double-click on an entity, opens the selection in Details (D34).

**Details** shows what is selected:
- **An item** shows:
  - its kind's form over the fields no role writes;
  - its details record's form;
  - its position (`x`, `y` and their Unplace);
  - its links and nets, each one selecting;
  - Delete.
- **A zone** shows its form.
- **A link** shows its ends, as Choosers over the items of the slots its roles name, its form, and Delete.
- **A net** shows its sides, as tags over the items, its form, and Delete. A net leg shows its endpoint with Remove.
- **Several items** show their count, and Delete.
- **Nothing selected** shows the drawing: the counts by kind, and each record's last save with who made it.

A kind's own `inspector` replaces its form, and `update(edited)` writes one
transaction. Every edit is one transaction. A field its drafts changed is
tinted against the record. Read only, Details shows every field and edits none.

**Issues** lists, each selecting what it names:
- a link or a net naming an item no kind holds;
- two items of one key in one kind;
- an item outside the extent;
- geometry outside its entity's box;
- a colour naming no theme colour (D14);
- the app's `ready` refusals;
- a Save's conflict or refusal.

Below 480px of main, Details gains the actions the canvas doesn't take (D15):
- Move: the `x` and `y` fields;
- Connect to…: a Chooser over the items, recording a link of the chosen kind;
- Place: an unplaced item at the canvas's centre, its fields then editable;
- Delete.

## 10. Narrowing and reading

### 10.1 Sources

`slice={{ slice: Slice.bindRecords(key, { … }) }}` takes:
- a source named after each kind's slot that the rail narrows. Its source is
  `Data.bindPaged(record, { indexes })` over the kind's record, its rows
  joined;
- a source for each templates list and author's tab that names one.

The tag checks the slice with `recordSources(slice, { builder: "Schematic",
names, what, takes })`, and binds each source once in the payload's block
(`.bind($)`, #1356). A source nothing names is refused. So are `Slice.bind`, a
single `Slice.bindRecord` and the `brush` affordance.

### 10.2 Where a source narrows

A source narrows its kind on the canvas, in its tabs (Backlog, the Index's
item lists, the templates it names) and in the inspector's Choosers. A link or
a net draws only while both its ends draw.

### 10.3 Hidden or dimmed

By default a narrowed-out row is hidden. With `narrowed="dim"`, or `{ show:
"dim", … }`, it draws as context:
- `opacity` (0.35 by default);
- `desaturate` (on by default);
- `dot`, a bare marker.

Whatever `show` is:
- `emphasis` rings the matches (`halo`, or `pulse`, which breathes);
- `frame` boxes them;
- `fit` flies the camera to them when the narrowing changes.

The renderer reads which rows match from the source's shown keys
(`useSourceVisibility`), never from a predicate over rows. A window read by
area under a narrowing its area index doesn't lead asks #1349's `within`
which of its rows the narrowing holds, in one request, rather than reading
the narrowing's keys whole (D28).

### 10.4 Reading

A kind is read one of three ways:
1. **With no source of the slice**, its record is read whole (`read()`).
2. **Through its source**, its narrowing is read complete (the record slice's
   `PagedScan`).
3. **With an area index among its source's indexes** (§11), the canvas reads
   the viewport's window from the index alone, since it carries its rows
   (D29). The window is the viewport with its margin (§11.3), padded by the
   largest card's half size at the current zoom, so a card whose centre lies
   just outside still draws. It is read through an area index whose `on` the
   rail's exact choices fill, when its searches across those choices stay
   within the record slice's bound on landed searches (1,024). Otherwise it
   is read through an area index with no `on`, and `within` says which of its
   rows the narrowing holds (§10.3). So a kind read by area declares an area
   index with no `on`, and may declare led ones beside it; one without is
   refused, naming the index to declare. The window is a read: it's never a
   choice of the rail, and never counted.

What each read brings, in the reader components:
- **Two requests.** A window's searches go in one `findKeys` request, and its
  runs' entries in one runs read (#1351, D24). A pan or a zoom inside the
  margin reads nothing, and one into new cells searches only those.
- **Density at overview** (D25). Past 5,000 rows in view, by the counts its
  searches answer, the canvas draws a density raster in place of items: the
  counts of the area index's cells at the level whose cells are about a
  sixty-fourth of the view, one `findKeys` of at most 4,096 counted ranges,
  and no rows read. Rows at a coarser level than the raster's, boxes larger
  than half a raster cell, are read as rows: they are few. Through a led
  index the counts split by its leading field, a raster per value. A
  narrowing the index doesn't lead isn't drawn in the raster, and the footer
  says so. A tap on the raster zooms into it; Find, the Index tab and the
  minimap work as ever; the tools that need items wait for them.
- **Kept until replaced.** The previous window stays drawn until the next lands.
- **Details.** The details of the items a window holds, at card and label zoom,
  come in one request per details record (§12). They're read again when that
  record's revision moves.
- **Links and nets** are read complete (D17). A drawn link's end outside the
  window is read by its key, all of a window's in one request (§12).
- **Readers.** The reads run in components of their own (`SchematicDataReader`,
  as `CalendarDataReader` and `RosterDataReader` do). They hand the frame what
  they read only when that moves.
- **Bounds.** The paged runtime's and the record slice's caches keep their
  limits (24 windows; 32 windows of 2,048 rows; 1,024 searches).

## 11. The area index (#1350)

### 11.1 Declaring it

Each generated index has a constructor of its own (D21): the area index, the
interval index, and the per-key time series #1039 is re-designed as.

```ts
// The window, whatever the rail chooses:
export const racksByArea = e3.recordIndex.area("racks_by_area", racks, {
    x: "x", y: "y", width: "w", height: "h", at: "centre", cell: 0.01,
});
// Beside it, a choice of halls and the window in one read:
export const racksByHallArea = e3.recordIndex.area("racks_by_hall_area", racks, {
    on: ["hall"], x: "x", y: "y", width: "w", height: "h", at: "centre", cell: 0.01,
});
// The interval index, which `e3.recordIndex`'s `interval` option declared until now:
export const eventsByTime = e3.recordIndex.interval("by_status_time", events, {
    on: ["status"], from: "start", to: "end",
});
```

- `x`, `y`: the row's `Float` fields, or two of its `Option<Float>` fields.
  Their `none` is unplaced.
- `width`, `height`?: the row's `Float` fields. Left out, the row is a point.
- `at`: `"corner"` (the default: `x`, `y` are the box's minimum corner, as a
  zone's are) or `"centre"` (as an item's are).
- `cell`: the finest cell's side in world units, about the size of the
  smallest thing drawn: 0.01 for a floor in metres, 1 for one in
  millimetres. It is rounded down to a power of two, so the key's arithmetic
  is exact on every runtime. It has no default: it is the one thing the index
  can't infer, and a wrong value costs a silent tenfold read (D23).
- `on`?: exact leading fields, as the interval index takes them, Set fields
  fanning out.
- **It carries its rows.** Each entry's projection is the whole row, so a
  window reads the index alone and no record segment (D29). It takes no
  `value`.
- **Typed by the row, inferred from the record.** Each constructor reads the
  row's fields from the record's own East type, as `e3.recordIndex` does today
  (`T` inferred from `rec: RecordDef<T>`), so nothing is annotated. Each option
  takes only the row's fields of its type: `x` and `y` its `Float` and
  `Option<Float>` fields, `width` and `height` its `Float` ones, `on` any of
  its fields, and `at` its two words. An editor offers only those, and a wrong
  one doesn't compile, as the interval index's `from` and `to` take only
  `DateTime` fields (`IntervalField`). The index's key type follows from the
  spec the same way (`IndexKeyOf`), and types every read through it. The
  definition checks the fields again, naming the option, the field and its
  type, with what the types don't say: `x` and `y` both Options or neither,
  and no field named `__area`, which is reserved as `__interval` is.
- **Field names, not mapping functions.** The SDK builds the key function
  from them, the record slice names them, and the Schematic checks its kinds
  against them (§11.4). A mapping function makes an index opaque, which is
  what `key` and `keys` are for.
- **Plain indexes stay as they are.** `e3.recordIndex(name, record, { on |
  key | keys, value? })` declares an order to page in. It refuses `interval`,
  naming `e3.recordIndex.interval`. The objects the constructors build are the
  ones the options built, so no index changes form.

Their types, written as `IntervalField` is today:

```ts
type PlaceField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends FloatType | OptionType<FloatType> ? F : never }[keyof RowFields<T>] & string;
type FloatField<T> = { [F in keyof RowFields<T>]: RowFields<T>[F] extends FloatType ? F : never }[keyof RowFields<T>] & string;
interface AreaIndexSpec<T extends EastType> {
    on?: readonly (keyof RowFields<T> & string)[];
    x: PlaceField<T>; y: PlaceField<T>;
    width?: FloatField<T>; height?: FloatField<T>;
    at?: "corner" | "centre";
    cell: number;
}
// recordIndex.area<Name extends string, T extends EastType, const S extends AreaIndexSpec<T>>(name: Name, rec: RecordDef<T>, spec: S)
```

### 11.2 Its keys

The index is an ordinary multi-entry index, generated as the interval index's
key function is (`e3/src/record-interval.ts`), so the build, mutation, storage,
transport and reindex are shared.

- **The domain** is the square [−`cell`·2²⁷, `cell`·2²⁷) world units, in 29
  levels, `L = 0…28`. A level-L cell's side is `s_L = cell · 2^(28−L)`, so the
  finest is `cell` and the root spans the domain: ±1,342 km at a 1 cm cell.
- **Each row is one entry.** Its level is the deepest `L ≤ 28` whose `s_L` is
  at least twice the box's larger side, so the box lies within its centre's
  cell ± `s_L`/4 (its loose bounds). Its cell is the level-L cell holding the
  box's centre, and its key is `{ …on, __area: morton28(cell, aligned to level
  28) × 32 + L }`. A point is at level 28.
- **Unplaced** rows file under `__area = −1`. Rows with any coordinate outside
  the domain, or not finite, file under the root, as does a box whose larger
  side exceeds half the domain.
- **Exact membership.** One entry per row keeps membership exact.
- **Its type.** The index key is `{ …on, __area: Integer }`, and the index's
  `on` lists the leading fields, then `__area` (`IndexKeyOf`, `IndexOn`), as an
  interval index's lists its start. The declaration carries `area`, naming the
  box's fields and `at`, as it carries `interval`.

### 11.3 A window's searches

For a viewport and the exact leading values `P` of `on`, where `m` is a cell's
Morton code aligned to level 28:

1. **The window** `V` is the viewport grown by an eighth of its larger side on
   each side: the margin, which keeps a pan of that much in hand (D26).
2. `C` is the deepest level whose `s_C` is at least an eighth of `V`'s larger
   side.
3. For each level `L < C`, the exact key `m·32 + L` of each level-L cell whose
   loose bounds (the cell ± `s_L`/4) meet `V`.
4. At level `C`, for each cell whose bounds ± `s_C`/4 meet `V`, the range from
   `m·32 + C` up to `(m + 4^(28−C))·32`, excluded. It holds the cell's own
   entries and every descendant's: a deeper entry's loose bounds lie within
   its level-C cell ± `s_C`/8. It starts above the coarser cells that share
   the cell's corner, whose exact keys step 3 reads.
5. **Cells aren't merged** (D24). A cell's range is then the same search in
   every window that holds it, so a pan searches only the cells it adds, and
   the runs read takes a window's runs in one request however many there are.

Per axis, a level whose cells are `s` wide meets at most `⌊W/s + 1.5⌋ + 1`
cells of an interval `W` long:

| Level | Cells per axis, at most | Searches, at most |
|---|---|---|
| `C` | 10 | 100 ranges |
| `C − 1` | 6 | 36 exact keys |
| `C − 2` | 4 | 16 exact keys |
| `C − 3` | 3 | 9 exact keys |
| `C − 4` | 3 | 9 exact keys |
| each `L ≤ C − 5` | 2 | 4 exact keys |

That gives at most `100 + 36 + 16 + 9 + 9 + 4·(C − 4) ≤ 266` searches per exact
prefix, disjoint, which together hold every row whose box meets `V`, each once.
A coarser level's rows are boxes larger than an eighth of `V`'s larger side,
read while their cell's loose bounds meet it.

Simulated over 4,000 viewports from 2 m to 4 km at a 1 cm cell, a window reads a
median 2.48 times the rows its viewport shows (the margin's 1.56 among them;
p95 3.09, at most 3.49), in a median 131 searches (p95 182, at most 221). All of
a window's searches go in one `findKeys` request (#1351). The pure planner is
`areaQueries(prefix, box, cell)`, in east-ui's `platform/slice/record-area.ts`,
beside `record-interval.ts`.

### 11.4 Reading through the record slice

- **The window clause.** `RecordSliceChoiceType` gains a case, `window: {
  minX, minY, maxX, maxY }` (Floats), given under the index's `__area` field to
  a read's `where` (`pageWhere`, `countWhere`, `recordSliceReadPlatform`). It's
  never written into the rail's state, and the rail never shows it as a chip.
  A narrowing an earlier build wrote, such as a Sheet's saved view, does not
  read under the new type and resets: beast2 reads a collection's elements at
  exactly their written type (D19, §16).
- **Unplaced** is the clause `variant("values", [unplaced])` under `__area`,
  offered only when `x` and `y` are Options.
- **Metadata.** `RecordSliceIndexType` gains `area: Option<{ x: String, y:
  String, width: Option<String>, height: Option<String>, centre: Boolean,
  cell: Float, optional: Boolean }>`, after `interval`, as `interval` carries `{ from, to,
  optional }`. `Data.bindPaged` marks `__area` with a struct naming the box's
  fields in order — `x`, `y`, then `width` and `height` when given,
  `__centre` when `at` is `"centre"`, and the cell's power of two — as it marks an interval's start with a
  struct naming its end. `Slice.bindRecord` tells the two apart by the
  reserved name and reads them back, `optional` from `x`'s type. `__area` is
  never offered as a field of the rail.
- **Projections.** A binding may list indexes that carry the whole row beside
  ones that carry nothing (D29). `Data.bindPaged` refuses any other mix, and
  each index is read as it can: one that carries the row without a join, the
  others with one. An entry's row is then its `value` or its `row`.
- **Planning.** `planRecordSlice` plans a `where` holding a `window` (or the
  unplaced clause) under `__area` through an area index whose `on` the other
  choices fill exactly, the exact prefixes held to `MAX_RECORD_SLICE_RUNS` as
  an interval window's are. One it can't plan is refused, naming why. Which
  `where` the window reads is the Schematic's (§10.4).
- **Agreement.** The Schematic reads a kind by area only through an area index
  whose box is the kind's roles: the same `x`, `y`, `width` and `height` fields,
  at `"centre"` for items and `"corner"` for zones. It refuses another as it
  reads, naming both (SC34).

### 11.5 Tests

- **e3**: the generated keys, one per row, at the level and cell §11.2 gives.
  The maintained index equals the rebuilt one byte for byte after inserts,
  moves, deletes and unplacing, on TS, east-c and east-py alike. The
  definition refusals; the declared types (`IndexKeyOf`, `IndexOn`); a type
  test that a field of the wrong type doesn't compile, for `area` and
  `interval`; `e3.recordIndex`'s refusal of `interval`; and an entry's
  projection, the whole row, on every runtime.
- **east-ui**: `areaQueries` against a brute-force filter over random boxes,
  windows and leading fields, with boxes on cell corners and cells of several
  sizes, the margin and `cell`'s rounding. Every row whose box meets the window is read once, a
  coarser cell sharing a range's corner among them, and the count of searches
  is within §11.3's bound. `Slice.bindRecord` over an area index's metadata,
  and `planRecordSlice`'s window and unplaced plans and refusals.
- **e3-api-tests**: a `records-area` suite on every server (local, e3-web,
  e3-cloud). A window's pages, read without a join, hold exactly the brute force's rows plus the
  margin, each once, at one hash. The unplaced read, a moved row, and the 409
  on a stale pin.

### 11.6 Its changes, by package

| Package | Changes |
|---|---|
| e3 | `src/record-area.ts`, new: the generated keys, beside `record-interval.ts`. `src/record-index.ts`: `recordIndex.area` and `recordIndex.interval`, their typed specs and refusals, `cell`, the whole-row projection, `IndexKeyOf` and `IndexOn`, and `recordIndex`'s refusal of `interval`. `SKILL.md`: the constructors |
| east-ui | `platform/slice/record-types.ts`: the `window` choice and the `area` metadata. `platform/slice/record-area.ts`, new: `areaQueries`. `platform/slice/record-plan.ts`: the area path. `platform/slice/record.ts`: `Slice.bindRecord` reads the `__area` marker |
| e3-ui | `bind/data-indexed.ts`: the `__area` marker, naming the box's fields and its cell, and the projection rule (D29). `schematic/window.ts`: which `where` a window reads (§10.4), the agreement check, and the density read |
| e3-api-tests | the `records-area` suite, which every server runs |
| the interval index's users | every declaration of one moves to `e3.recordIndex.interval`: the Calendar's, the Plan's, the Roster's, the Allocation's and the data binding's examples, e3's specs, and the skills and guides that show one (some 45 declarations in 13 files, and the guides) |
| e3-ui-components | the batches through the paged runtime (#1351, §12); the record slice reads a covering index without a join |

No new route, storage or index build of its own. Each server's find and page
routes, and #1351's batches, answer its searches, and its existing index
maintenance keeps the keys.

### 11.7 The key-temporal index (#1039)

#1039 is re-designed as the third generated index (D21, D27), which pages
the Plan in two dimensions; its issue holds the design.

```ts
export const jobsByMachineWeek = e3.recordIndex.series("jobs_by_machine_week", jobs, {
    key: ["machine"], from: "start", to: "end", tile: "week",
});
```

- **Its keys** are `{ …on, __tile, …key, start }`: each event filed under each
  `tile` it touches, so inside a tile the events sit in the rows' key order.
  A rows × tile rectangle is one range when the rows are contiguous in that
  order, and a range per row inside the tile otherwise.
- **It carries its rows**, as the area index does (D29).
- **Its repeats**, an event in several tiles, are dropped by key. Nothing
  counts from it: the rail counts through the interval index.

## 12. #1351's rows and runs forms

#1351 makes several key searches one request (`findKeys`). This epic adds two
forms beside it, and how all three read (D24, D30):

- **The rows form.** `POST …/datasets/<record>?rows=true&hash=<state>` with
  `{ keys: [<.east>…] }`, at most 10,000 keys within the page budget. It answers
  each key's row, or its absence, and the row's position in the record's
  order, in order.
- **The runs form.** `POST …/datasets/<record>?runs=true&index=<name>&hash=<state>`
  with `{ runs: [[row, count], …] }`: the entries of those runs of one index,
  in order, as one index window within the page budget; past it, the entries
  it completed and where to continue. `RecordSliceSource.page` reads through it
  when the binding has it, as `resolve` uses `seekAll`.
- **How they read.** `findKeys`, the rows form and the runs form sort their
  bounds and keys, read each segment they touch once, several at a time, decode
  it once, and binary-search its keys: a window's searches decode its few
  segments, never a segment a search. `findKeys` takes at most 10,000 queries a
  request, and the record slice splits a plan beyond that.
- **Decoded segments are kept.** The API process keeps decoded segments by
  content hash, bounded by bytes, and every dataset route reads through them:
  page and find as well as the three batches. A host whose processes are
  short-lived gains on its warm ones: pans and repeated windows, not a first
  load.
- **Every backend** implements them through `StorageBackend`'s seams, and
  e3-api-tests holds each against its by-key and by-run reads.
- **e3-ui-components.** `PagedRuntime.rowsAll(source, keys)` and
  `runsAll(source, index, runs)` read a batch as one request and one channel,
  which notifies once. Each row is held at its position, so the source's
  by-key read — a search by the key, then a one-row page — answers from it,
  and a key a held window holds is answered from that window.
- **No East contract changes.** `Data.bindPaged`'s handle keeps its shape: it
  is released, and a platform call's return type is checked against its
  implementation's exactly. The batches are the runtime's, as #1351's `seekAll`
  is.
- **Its users.** The Schematic's reader asks `rowsAll` for a window's cards'
  details and its far link ends, and the record slice asks `runsAll` for a
  window's runs. Save's confirmation, which reads eight keys a pass, could move
  onto the rows form later; that isn't in scope here.

## 13. Examples

In `e3-ui/test/schematic/`, each defining its component inline, with its
records in the file, and each Schematic named by its `id`:

| Example | Shows |
|---|---|
| `schematicFloor` | the smallest: one hall's racks, read only (`Data.bind`), no panes |
| `schematicDataCentre` | the builder: racks, cooling units and power distribution units (three item kinds); halls and cages; hot and cold aisles; fibre runs; power feeds as nets; the racks' loads as details (cards and inspector); rack and fibre templates; Templates, Backlog, Index and Layers, its layers a systems record; the rail; `narrowed="dim"`; the inspector, and a kind's own Details; `onSelect`, the whole selection kept in a State of the host's; and `canConnect`, a run between two frames refused in its words. Its records hold their own fields, mapped by accessors: a cooling unit's radius, an area's kind, a fibre run's cable |
| `schematicShapes` | read only: polygon, circle and polyline footprints and zones, built by accessors from the rows' own fields; tones and theme colours; layers from a systems record |
| `schematicRecordIndexes` | 50,000 racks over the area index (`racks_by_area`, with `racks_by_hall_area` beside it, at a 1 cm cell), read from the index alone; the density layer at fit zoom; the rail; and the cards' loads, bound with `Data.bindPaged` and read by key, one request a window. Its record is seeded by the pure generator that also runs as an e3 task, as `sheetRecordIndexes`' is |
| `schematicRecordIndexesMobile` | the same in a phone-width container |
| `schematicHandover` | no panes: the toolbar, the canvas and the footer |

## 14. Behaviour

| # | Rule | Owner | Test |
|---|---|---|---|
| SC1 | A role naming a missing field, or a field of another type, is refused at build, naming the role, the field and its type. | `e3-ui/src/schematic/kinds.ts` | spec per role |
| SC2 | A gesture writes only its roles' fields; every other field of the row reads back as it was. | `kinds.ts` (`write`) | spec: a rack with fields of its own, moved and saved, reads back whole |
| SC3 | Each removed prop and type (§2) is refused at build, naming its replacement. | `schematic/payload.ts` | spec per prop |
| SC4 | An item kind with Option `x`, `y` has a backlog: its unplaced rows never draw, are listed in the Backlog tab, are placed by a drop, and are cleared by Unplace. | `kinds.ts`, renderer | DOM; responsive |
| SC5 | Del on items deletes them, every link naming one and every net leg naming one, in one step; Undo restores them; Save sends each record. | renderer `edits.ts` | DOM |
| SC6 | Save sends each changed record's batch as its own request; a conflict on one keeps its drafts and leaves the others committed. | `editing/history.ts` | DOM: one refused write |
| SC7 | A new item's, link's or net's key is minted unique among every key read and drafted. | renderer | DOM |
| SC8 | Move moves the selection rigidly, clamped to the extent, as one step on release; Esc or a lost pointer puts it back. | renderer canvas | DOM; responsive drag |
| SC9 | Connect records a link of the tool's kind, `from` and `to` written and its other fields defaulted or from the selected template. Shift grows the session into a net. `canConnect` vetoes a pair: the draft goes danger, doesn't snap, and shows the veto's words. | renderer | DOM; responsive |
| SC10 | Retarget writes the end it moves; Extend adds a net destination; Del on a leg removes its endpoint, and on a side's last member deletes the net. | renderer | DOM |
| SC11 | A link template dropped on a link writes its values and never its ends or key. | renderer `drop.ts` | DOM |
| SC12 | An item template dropped on the canvas adds an item at the drop point, minted and selected. | renderer `drop.ts` | DOM; responsive |
| SC13 | ⏎ on a selected card drops it on the selection, or at the canvas's centre; on a touch screen a tap on the selected card does the same. | renderer `use-drop.ts` | DOM |
| SC14 | A kind bound read only (`Data.bind`, `Data.bindPaged`) takes no gesture, drop or edit; `readOnly` makes every kind so. | renderer | DOM |
| SC15 | Details shows the selection as §9 says; a kind's own `inspector` replaces its form, and `update` is one step. | renderer `inspector.tsx` | DOM; `inspector-form.spec.ts` |
| SC16 | Issues lists §9's issues, each selecting what it names. | renderer `issues.ts` | pure + DOM |
| SC17 | One `Slice.bindRecords`; each source narrows its kind everywhere it appears (§10.2); a templates list or tab follows its source. | `payload.ts`, renderer | spec; DOM; responsive narrowing |
| SC18 | Narrowed-out rows are hidden, or with `narrowed="dim"` drawn as context with the options of §10.3, from the source's shown keys, or by `within` for a window under a narrowing its area index doesn't lead. | renderer | DOM; responsive |
| SC19 | A kind is read whole without a source, its narrowing complete through one, and its viewport's window through an area index; the window is never a rail choice or a count. | `schematic/window.ts`, renderer reader | spec: searches and pages counted, no whole read; e3-web: bounded reads |
| SC20 | A window is one `findKeys` request and one runs read, its rows read from the index alone; a pan inside the margin reads nothing, and one into new cells searches only those; the previous window stays until the next lands. | renderer reader | DOM: request log |
| SC21 | A window's cards' details are one rows request per details record, read again only when its revision moves. | renderer reader | DOM: request log |
| SC22 | A drawn link's far end outside the window is read by key, all of a window's in one request. | renderer reader | DOM: request log |
| SC23 | Drafts outside the window stay in their sessions and Save; a draft moved into the window shows. | renderer | DOM |
| SC24 | The toolbar holds §6.1's items in order; the rail folds first and the history last; the phone row holds the rail's icon, the View bundle and the history. | renderer `toolbar.tsx` | responsive at 1440/1024/768/390/360 and a 294px parent |
| SC25 | Below 480px of main no drag source, drop target or handle is registered; the inspector's actions do what the gestures did. | renderer | responsive phone |
| SC26 | Colours are a tone or a theme token, resolved through the theme on canvas and cards in both modes; a value naming no token draws the tone and is listed in Issues. | renderer `canvas/theme.tsx` | DOM; responsive both themes |
| SC27 | The Layers tab isolates, locks and hides each layer; the viewer's choices persist; locked entities never select. | renderer `library.tsx` | DOM; responsive |
| SC28 | Arrows step the selection, Enter and a double-click open the selection in Details, Del deletes, Esc unwinds the gesture then the selection; Space and Ctrl hold Select and Zoom box. | renderer canvas | DOM |
| SC29 | `onSelect` hears the whole selection after each change, items, zones, links and nets alike, each by its `Ref`, through the isolated dispatch; `[]` when it is cleared. | renderer | DOM |
| SC30 | Pans at 60 fps with 2,000 visible items and 200 zones (paint under 16 ms); the 50,000-rack drawing's fit view, a card-zoom window and a pan into a new window are within their budgets. | renderer | `E3_UI_PERF=1`, never in CI |
| SC31 | The canvas draws in the design system's tokens and its mono font; its recipe owns every style; inline values are geometry only. | renderer, `slot-recipes/schematic.ts` | lint; responsive |
| SC32 | The frame's skeleton covers the first read; later reads keep the canvas; a failed read is a banner with Retry. | renderer | DOM; `builder-loading.spec.ts` |
| SC33 | A kind or details record bound in a form its read doesn't take (§1, rule 4) is refused at build, naming the form to use. | `kinds.ts` | spec per form |
| SC34 | A window is read through an area index whose `on` the rail's exact choices fill while its searches stay within 1,024, and otherwise through one with no `on`, the source's shown keys deciding what draws. A kind read by area with no area index without `on`, or through one whose box isn't the kind's roles, is refused as it reads, naming what to declare. | `schematic/window.ts` | spec: the index each `where` reads; the refusals |
| SC35 | Geometry is drawn about its entity's anchor and moves with it; geometry outside its box draws and is listed in Issues; a `footprint` without `width` and `height` is refused at build. | `kinds.ts`, renderer `canvas/paint.ts` | spec; pure; DOM |
| SC36 | Past 5,000 rows in view, the canvas draws a density raster from the area index's cell counts, in one request with no rows read, and draws items again below it; a tap on the raster zooms into it, and a narrowing the index doesn't lead is named in the footer. | renderer reader, `canvas/paint.ts` | DOM: request log; `E3_UI_PERF=1` budget |
| SC37 | `Schematic.layers` reads the app's rows in their `order`, then key order, each layer keyed by its row's key; an accessor of another type is refused, naming it. `footprint` and `geometry` draw what their accessors return, about the anchor. | `schematic/layers.ts`, `kinds.ts` | spec; DOM |
| SC38 | `templates()` lists every kind's templates and `backlog()` every item kind's rows with no position; each is refused when no kind has any, naming the change. | `schematic/library.ts` | spec |
| SC39 | `canConnect` hears the gesture's `Candidate`: `none` lets it snap and record, and words refuse it; a veto that throws allows the pair and logs it. | renderer | DOM |

The area index's rules are §11.5's tests; the rows form's are §12's.

## 15. Implementation and reuse

**e3-ui (`src/schematic/`).**
- `types.ts`: the value types, moved from east-ui, plus `Ref`, `Box` and `Candidate`.
- `kinds.ts`: `Schematic.items`, `zones`, `links`, `nets` and `details`. They reuse Schedule's `role(…)`-style checks, `scheduleAccessor`, `scheduleRecordSession`, `checkEntries`, `fieldOf`, `refOf` and `resourceValue` for `of`, and `rowInspector`.
- `templates.ts`: `Schematic.templates`, over `templatesSource`.
- `layers.ts`: `Schematic.layers`, over the app's rows, as the Roster's lists are.
- `window.ts`: the kind's reads through its source's part — complete, a window, or the density's counts — over `recordSliceReadPlatform`.
- `library.ts`: `Schematic.library.*` and their wire.
- `payload.ts`: the payload, the carrier, `schematicKeys`, and every refusal.
- `schematic.ts`: the tag.

**e3-ui-components (`src/schematic/`).**
- `canvas/`: today's `camera.ts`, `paint.ts`, `model.ts`, `selection.ts` and `theme.tsx` moved, the canvas's hooks out of today's `index.tsx`, and the theme bridge on tokens.
- `index.tsx`: the frame (§6) over one shared state, as the Flowchart's is.
- `toolbar.tsx`, `footer.tsx`, `library.tsx`, `inspector.tsx`, `issues.ts`, `messages.ts`.
- `editing.ts`: one history over a session per record, through `useScheduleEditing`.
- `edits.ts`: each gesture's rows, pure.
- `drop.ts` (pure) and `use-drop.ts`.
- `data.ts`: `SchematicDataReader`: the window's, the density's, the details' and the far ends' reads.

**e3 (`packages/e3/src/record-area.ts`, `record-index.ts`).** The generated
keys, as `record-interval.ts`'s, `cell`, the whole-row projection, and the two
constructors (§11.1).

**east-ui (`platform/slice/`).** `record-area.ts` (`areaQueries`), the
`area` choice and metadata, and `planRecordSlice`'s area path.

**Reused as it is.**

| Part | Where |
|---|---|
| the frame, its panes, rails, scrim, loading | `east-ui-components/src/layout/builder-frame/` |
| the toolbar, its folding, the history item, the key search | `east-ui-components/src/toolbar/`, `editing/history-item.tsx`, `collections/key-search/toolbar-item.tsx` |
| the rail | `useRecordSlicesToolbarItems` (`east-ui-components/src/slice/record/`) |
| a tab over a source, several sources, shown keys | `e3-ui-components/src/shared/schedule/source-tab.ts`, `follow-sources.tsx`, `visibility.ts` |
| sessions, one history, Save, banners, the Save notice | `east-ui-components/src/editing/`, `SessionBanners`, `RecordSliceSaveNotice`, `prepareRecordSliceSave` |
| a minted key, a window kept at its revision, a row codec, a field's change | `e3-ui-components/src/shared/schedule/records.ts` |
| the library, its search, its empty and narrowed states, paging | `Library`, `PagedLibrary`, `LibrarySearchBox`, `narrowedCount`, `pagedCount` |
| the inspector's form | `FieldForm`, `Fields.specs`, `rowInspector` |
| drag and drop | `east-ui-components/src/dnd/` |
| the footer rail | `slot-recipes/builder-footer.ts` |
| narrow layout | `useContainerBelow` |
| a complete read | `PagedScan` through `recordSliceReadPlatform` |

## 16. Wires

Entries for `docs/conventions/WIRE_MIGRATION.md`:
- **east-ui's `UIComponentType` loses its `Schematic` arm (package-borne).**
  The Schematic is e3-ui's `<Schematic>`, carried as the `Schematic`
  extension, its payload its kinds, its canvas and its panes. Every case after
  `Schematic` moves down one, so a UI value encoded under either type doesn't
  decode under the other. Packages are re-exported, and the dataflow computes
  each UI task's output again. No repository upgrade step ships with it.
- **e3 gains the area and key-temporal indexes (package-borne).** Each one's
  object carries its generated key function and its whole-row projection, as
  an interval index's carries its key function, and a deploy builds an index
  its state lacks, so no upgrade step ships. `e3.recordIndex.interval`
  builds the object the `interval` option built, so no interval index changes
  form.
- **east-ui's record slice gains the `window` choice and the `area` index
  metadata (package-borne).** `RecordSliceChoiceType` gains `window`, and
  `RecordSliceIndexType` gains `area` after `interval`, which is built only
  from a package's declarations, so packages are re-exported. A narrowing is a
  `Dict` of choices, whose elements beast2 reads at exactly their written type,
  so one an earlier build wrote does not read under the new type: a browser's
  kept rail starts from its slice's `initial`, and an app's saved Sheet views
  change type with it (D19).

#1351's `findKeys`, its rows form and its runs form are new routes beside `find`
and `page`.
They change no existing wire and no stored form, so they take no entry.

## 17. What is lost

| Today | After |
|---|---|
| Rows in hand, mapped where they're drawn | the app's records; a task builds a keyed dataset from rows |
| `linkMode="connect"`: a gesture that records nothing | every connection records a link |
| Hover cards with any UI | the inspector, and a kind's own Details |
| `sliceSelectField`: the selection writing the rail | the selection drives the inspector only |
| Raw CSS colours | a theme colour token, or a tone |
| Per-domain read only (`readOnlyLinks`, `readOnlyItems`) | a kind bound read only |
| A frameless canvas | always in its frame; with no panes, the toolbar, the canvas and the footer |
| Footprints and zone shapes in world coordinates | drawn about their anchor; an import subtracts it once |
| Shapes and layers the Schematic's own, in the app's rows or the code | the app's own fields and records, mapped by accessors |
| `onViewportChange`: the app hearing where the camera settled | nothing: the canvas reads its own window |
| `selectZoomFocus`: a tap that flies | a tap selects in place; Find, the Index and the arrow keys fly |
| `onItemOpen`: the app opening an item | Enter or a double-click opens it in Details |
| `e3.recordIndex`'s `interval` option | `e3.recordIndex.interval` |

**Known limits** (§19):
- **Long, thin boxes** file at the level of their longer side, so a window
  near one reads it from afar. Several entries a row, with the
  reference-point rule, would keep each row once; it waits for a
  measurement.
- **Links and nets are read complete** (D17): fine for thousands. At tens of
  thousands they would be read by their ends, through field indexes on
  `from` and `to`, at the cost of links that cross a window with both ends
  outside it.
- **On a remote host, requests set the cost.** A window is two requests,
  plus one per details record and one for its far link ends.
- **A batch isn't HTTP-cached.** A pinned GET is the browser's to keep, and a
  POST is no cache's, so the paged runtime's caches serve repeated searches.
- **Each index costs about a segment rewrite per edit**, two for a move across
  cells, and an index that carries its rows rewrites on every edit to its
  row. So a source declares the led indexes its rail leads with, not one a
  field.
- **The density raster doesn't draw a narrowing** its area index doesn't
  lead, and says so.
- **A long event repeats** in every tile of a key-temporal index it touches.
- **The interval index's windows still join.** Carrying its rows too would
  speed the Calendar's and the Plan's reads alike: a follow-up.

## 18. Tasks, in landing order

Each is a sub-issue and a checkbox in the PR. #1350's children — #1039, #1349,
#1351 and the area index — are checkboxes in the same PR (D2).

1. **The spec** — this document, in `libs/east-ui/docs/proposals/`.
2. **The corpus moves to a data centre floor** — east-ui's Schematic examples,
   its tests' fixtures, its renderer's comments and tests, its SKILL.md
   section and the conventions docs that name its examples. The scan is clean
   before the move.
3. **The Schematic moves to e3** — its IR to e3-ui and its renderer to
   e3-ui-components, its behaviour and props unchanged; east-ui's arm goes; a
   `schematic-moved` guard; #1337 loses its Schematic row.
4. **#1351, with its rows and runs forms, the read-once batches and the
   decoded-segment cache** (§12) — #1350's.
5. **The area index — its `cell`, its rows carried, the projection rule — and
   the interval index's constructor** (§11.1–§11.6) — #1350's.
6. **The kinds over the app's records, the payload and the tag** (§1, §2, §4, §5). SC1–SC3, SC33, SC35.
6a. **The props of the Plan, the Roster and the Calendar** (D31–D36) — `id`, an
    inspector you opt into, tabs over every kind, `onSelect` and `canConnect`'s
    words, shapes as accessors over the app's own fields, and `Schematic.layers`
    (#1401). SC3, SC29, SC37–SC39.
7. **One `<Schematic>` in its BuilderFrame** (§6) — the toolbar, the footer, the canvas's chrome and theme. SC24, SC26, SC28, SC31, SC32.
8. **Editing, undo and Save** (§7). SC2, SC5–SC10, SC14, SC23.
9. **The library** (§8). SC4, SC27.
10. **Drag and drop** (§7, §8). SC11–SC13.
11. **The inspector** (§9). SC15, SC16.
12. **Narrowing** (§10.1–§10.3). SC17, SC18.
13. **Reading by area** (§10.4): the window from the index alone, the density
    layer, and narrowing by `within`, over tasks 4 and 5 and #1349. SC19–SC22,
    SC30, SC34, SC36.
14. **The narrow layout and touch** (§6.1, §9, D15). SC25.
15. **The showcase on e3-web, the examples, the responsive specs, the skill and the docs** (§13, §16).

#1039 (re-designed, §11.7) and #1349 land between them; task 13 reads through
#1349's `within`.

**The index work in this PR (#1350, D2):**

| Lands | Issue | What e3 can do after it | What reads it here |
|---|---|---|---|
| task 4 | #1351 | Several key searches in one request (`findKeys`), the rows of several keys and the entries of several runs in one each, each segment read once (§12) | a window's searches and runs; its details and far link ends |
| task 5 | the area index (§11) | A window over a record's boxes read as at most 266 disjoint searches per exact prefix, each row once, from the index alone | the canvas's window (task 13), Unplaced and the Index tab (task 9) |
| between | #1039 | A per-key time series (`{ key, at }`) read a rectangle of keys × time at a time; re-designed against the current Plan before it is built (D21) | the Plan's time paging; not the Schematic |
| between | #1349 | Where a narrowing's rows sit among a record's rows (`place`), and which rows on screen are in it (`within`) | the Sheet's lens; a Schematic window under a narrowing its index doesn't lead (D28) |

The area index needs #1351 only for its one request: without it, a window's
searches are up to 266 `findKey` requests, which the planner's tests and the
pure keys don't depend on. Task 13 reads through both.

## 19. Why these structures, and what they cost

The review of 22 Oct 2026, whose eight fixes D23–D30 adopt.

**The structures.** Each generated index embeds a classic structure in e3's
sorted keys, which is what lets it share e3's build, maintenance, storage and
routes:
- **The interval index** is a relational interval tree (Kriegel, Pötke and
  Seidl, VLDB 2000).
- **The area index** is XZ-ordering (Böhm, Klump and Kriegel, SSD 1999): a
  loose quadtree (Ulrich 2000) laid along a Z-order curve, as GeoMesa's XZ2
  index lays shapes with extent in a sorted key-value store.
- **The key-temporal index** is a composite key clustered by time tile.

Each is exact, one entry per row (three per event for the interval index), and
a maintained index equals its rebuild byte for byte. An R-tree (Guttman 1984)
would draw tighter boxes, but its shape depends on the order of its inserts, so
it could never equal its rebuild, and it needs node storage e3 doesn't have.

**What a read costs.**
- **A segment is the unit of every read.** A record is a manifest of content-cut
  segment objects, each one deflate frame of about 1,024 narrow entries or about
  1 MiB of wide ones, and nothing reads inside one (beast2 v5's `SPEC.md`). The
  manifest's fences place a key's segment without a read; its exact position
  costs that segment's decode.
- **The server reads in series and keeps no decoded segment.** A span's
  segments, a joined page's record segments (each whole) and a search's bound
  segments are read one at a time, and only each dataset's geometry is kept
  (`DatasetSegments`, `indexPage`, `findDatasetKey`). D30 changes that.
- **On a remote host** — the API in short-lived processes, objects and refs in
  remote stores, as e3-cloud keeps them — every segment read is a round trip,
  every request has a time limit and a response cap, and a process's caches
  live as long as it does. Requests per view set the cost there.

**What the fixes buy**, at 50,000 racks in 49 record segments:
- **A window reads its index alone** (D29). A joined window's rows scatter
  across the record, since the keys the Schematic mints are random: a window of
  50 racks decodes 31 of the 49 segments, and one of 200 decodes all 49. From
  the index, a card-zoom window decodes 2 to 4 index segments.
- **Each segment read once** (D30). A window's searches, answered one at a time
  as a single search is today, would decode up to two segments each; batched
  and read once, they decode the window's few.
- **Two requests a window** (D24). A window's rows were one request per run;
  with the runs read they are one.
- **Counts at overview** (D25). The fit view read every row; the density layer
  reads cell counts.
- **A declared cell, finer planning** (D23, D26). At today's fixed grid, finest
  cell 8 units, a small window reads up to 64 times what it shows; with a
  declared cell and the finer planning, a median 2.48 times, the margin's 1.56
  among them.
- **The Plan by tile** (D27). A rows × time rectangle filed by tile is one range
  a tile: 4,000 events in about four index segments, where reading every row's
  events in a three-week view is 3 million at 50,000 rows.
