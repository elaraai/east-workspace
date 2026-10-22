# Schematic renderer — architecture & invariants

Consolidated from the #57 P1–P11 comments, the #172 productionisation, and
the #176–#182/#189 feature era (#183 WS8). **Read before changing the
renderer** (`../index.tsx`) — every rule here shipped as (or prevented) a real
bug. The Schematic is e3's (#1384): its IR is e3-ui's `src/schematic/`, and
the renderer registers against its `Schematic` extension as it loads. It
draws the app's records (#1386): each kind's rows, read by `../data.ts` and
made what the canvas draws by `drawn.ts`.

## Module map

| File | Role |
|---|---|
| `../index.tsx` | Composition root: the reader beside the canvas (`EastChakraSchematic`), and the canvas's hooks, gesture handlers and DOM/JSX. All React state lives here. |
| `../data.ts` | The reads, in a component of their own (`SchematicDataReader`): each kind's rows through its `rows` — its record read whole, or its narrowing read complete through its source — and the details read whole beside them. An entity whose roles read again as they were keeps what was drawn of it; while a read is in flight the canvas keeps the last complete drawing. |
| `drawn.ts` | Pure: what the canvas draws — an item, a zone, a link and a net from its kind's roles, typed from their East types. An entity's id is its reference printed (`entityId`); an item with no position draws nothing. |
| `camera.ts` | Pure camera maths + the interaction-mode machine (`nextMode`, `cancelsFly`), rAF coalescer, projector, culling. |
| `paint.ts` | Pure Canvas2D painter + routing/hit geometry (`orthogonalize`, `distanceToPolyline`, `parallelLanes`, label pills, net trunks), and geometry about its anchor (`placedVertices`, `zoneAnchor`). |
| `selection.ts` | Pure marquee helpers (`marqueeHits`). |
| `model.ts` | Pure derived model: navigator tree (`buildNavTree`), LOD (`tierSize`, `buildCenterTree`, `declutterTiers`). |
| `theme.tsx` | Palette probe (semantic tokens → concrete colors for canvas paint). |
| east-ui-components' `src/theme/slot-recipes/schematic.ts` | ALL styling. No inline styles in `../index.tsx` beyond dynamic data bindings (positions, sizes). |

Pure modules stay pure — no React imports. New geometry/derivation logic
goes in a pure module with unit tests, not in the component.

## Invariants

**State & commit phase**
1. **No render-phase ref writes.** Async closures (rAF `applyCamera`,
   pointer handlers, timers) read `renderSnapRef` / `commitCtxRef`, both
   written by ONE dep-less `useLayoutEffect` (commit phase). A discarded /
   StrictMode render must never be observable. New paint/geometry inputs:
   add a field to the snapshot, never a new render-phase mirror ref.
2. **`lastPaintRef` identity short-circuit.** Paint-relevant state must be
   FRESH OBJECT identities on change (fresh `Set`/`Map`/array per commit) —
   the paint gate compares identities, never deep-equals. Every new
   paint-relevant feature extends the short-circuit's field tuple.
3. **Interactive-state pattern** (package CLAUDE.md) everywhere: local
   state + replace-on-change keyed on what was READ — the reader hands the
   canvas a new drawing only when what it draws moves, so a payload built
   again with closures of its own (#809) never replaces an edit — +
   compute-next OUTSIDE updaters; PURE functional updaters only.

**Local-first editing (the form-input model)**
4. All local edits are overlays REPLACED by a change to what was read:
   `linkEdits` {created, createdNets, retarget, deleted, netEdits} on
   `[data.links, data.nets]`, `itemMoves` on `[data.items]`. The ONE seam
   into the painter is `paintValue` (`{...data, items: movedItems, links:
   effectiveLinks, nets: effectiveNets}`); never feed edits to paint any
   other way. `movedItems` applies UPSTREAM of the working set so centers /
   r-tree / LOD / nav / link+net endpoints follow moves for free. Which
   gestures exist follows the kinds' bindings: Connect draws into the first
   link kind bound with its patch door, a Shift session grows a net of the
   first such net kind, and Move moves the items of the item kinds so bound.
   No gesture writes a record yet: an edit lives in its overlay.
5. **Declare-before-use is load-bearing**: memos execute during render in
   source order, so an overlay memo must be declared ABOVE its first
   consumer (`paintValue`). The jsdom mount test
   (`../schematic.dom.test.tsx`) exists precisely to catch this class.

**Callbacks & selection**
6. Every author callback goes through `dispatchEast(name, run)` —
   queueMicrotask + try/catch + Promise `.catch`. Never call an East
   callback bare, never inside a state updater.
7. ONE selection funnel (`commitSelection`) for every mutation (tap /
   marquee / prev-next / hygiene prune / clear); zone selection mirrors it
   (`commitZoneSelection`). The host hears each entity by its reference —
   its kind's slot and its row's key (`refById`) — never by its canvas id.
   Nothing the canvas does writes a slice.
8. **Fly BEFORE commit.** A `selectZoomFocus` / nav / marquee fly must be
   initiated before the selection commit — commit-first leaves the fly dead
   (the commit's paint cancels it). `flyTo` is the single fly entry (it
   re-aims per frame from the live viewport); gesture-vs-fly arbitration is
   the camera mode machine's job alone.
9. Hit-test = drawing: link/net hit-testing reuses the painter's exact
   routing maths (lanes, orthogonalization, trunk/branch composition), and a
   footprint or a zone's geometry is hit about the anchor it is drawn about
   — an item's centre, a zone's box centre. If a paint path changes, its hit
   path changes with it.

**Sessions, nets, hover**
10. Connect sessions key on a stable `net-…` key from gesture start; the
    first Shift-extension upgrades the pairwise link (`connect-…`) to a NET
    in place, each in its kind (invariant 4).
11. No hover channel: nothing opens on dwell. What an entity is shows in the
    inspector, never a card under the pointer.

**Perf (#183 WS6)**
12. Budget: ~2,000 items / 200 zones should pan at 60 fps with paint
    < 16 ms — pan/zoom is 3 CSS var writes + one coalesced canvas paint,
    never a per-card React re-layout (invariant 6 of #57).
13. Marquee HITS recompute at most once per animation frame (display-only;
    pointerup recomputes at commit). The frame rect and LOD tiers are
    memoised on their input identities. Anything per-pointermove must be
    O(visible), not O(items).
14. No example carries the budget while each kind is read whole or complete
    through its source: the scale probe is the area index's example, whose
    rows are read by area. Until then a paint-path change is held by the
    pure tests and the responsive suite.

**A11y (#183 WS7)**
15. The canvas is a focusable `role="application"` surface: arrows step the
    selection via `stepSelection` (fly + select, the prev/next path), Enter
    fires `onItemOpen` on the anchor, ring on `:focus-visible` only.
    Pointer-only gestures must keep a nav-rail / control / callback
    equivalent. Nav rail + controls stay real `<button>`s with labels.

## Testing layers

| Layer | File(s) | Catches |
|---|---|---|
| Pure unit | `camera.test.ts`, `paint.test.ts`, `selection.test.ts`, `model.test.ts`, `drawn.test.ts` | Geometry, mode machine, LOD, nav tree, the marquee, what an entity draws from its roles |
| On e3 (jsdom) | `../schematic.dom.test.tsx` | Each example mounted as the showcase mounts it, its kinds' records read through e3-web: the cards drawn, a record another session changes redrawn, a kind read through its source never read whole; hook-graph ordering (TDZ) |
| The carrier (jsdom) | `../schematic-carrier.dom.test.tsx` | `<Schematic>` as the `Schematic` extension through the dispatcher; its functions decoded — each kind's rows, and the selection callbacks writing State, each entity named by its reference |
| IR contract | e3-ui's `test/schematic/schematic.spec.ts` + `.examples.tsx` + `schematic-docs.spec.ts` | The kinds' bindings and refusals, their closed functions over decoded bytes, the payload, examples↔tests parity, doc examples, plugin index |
| The move | `test/schematic-moved.spec.ts` (this package) | east-ui and east-ui-components publish nothing of the Schematic but its slot recipe |
| Visual | the showcase's responsive suite (`east-ui-showcase/tests/responsive/`) | Computed styles in the page, in both themes — the data centre's shadows (`foundations.spec.ts`) |

`make build` type-checks this package before vite bundles it
(`pnpm typecheck`, #589); `make lint` runs eslint.
