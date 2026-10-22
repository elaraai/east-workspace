# Schematic renderer — architecture & invariants

Consolidated from the #57 P1–P11 comments, the #172 productionisation, and
the #176–#182/#189 feature era (#183 WS8). **Read before changing the
renderer** (`../index.tsx`, `view.tsx`) — every rule here shipped as (or
prevented) a real bug. The Schematic is e3's (#1384): its IR is e3-ui's
`src/schematic/`, and the renderer registers against its `Schematic` extension
as it loads. It draws the app's records (#1386): each kind's rows, read by
`../data.ts` and made what the canvas draws by `drawn.ts`. It renders in its
`BuilderFrame` wherever it is used (#1387): there is no canvas without the
frame, and no control on the canvas — its toolbar holds them. Every gesture
that writes is one step of one history over a session per record (#1388):
the canvas records what a gesture writes through the frame's editing, and
draws the stored rows with the drafts in place.

## Module map

| File | Role |
|---|---|
| `../index.tsx` | The frame over one shared state (`EastChakraSchematic`, #1387): the reader beside it, the toolbar's items — the history item last while a record is edited — the canvas in main, the footer, the banners over a kind whose read failed (Retry) and each record's session's (`SessionBanners`), and `BuilderFrame.loading` until the first read has settled. It holds what the parts share — the editing, the drawing with its drafts in place, the tool held, what the layers do, whether anything is selected, why the last gesture was refused — drives the canvas's camera, steps and Find's pick through its handle, and takes ⌘Z, ⇧⌘Z and ⌘Y anywhere in the frame but a field typed into. |
| `../editing.ts` | The editing (#1388): one history over a session per record the Schematic writes — each kind bound with its patch door, and each one's details so bound — through the shared Schedule editing (`useScheduleEditing`), each kind a record written a whole row at a time; a gesture's edits recorded as one step through its kinds' own `write` and `create` (an existing row rewritten from the row as its session finds it); a new row's key minted (`mintKey`); each draft decoded once. |
| `../edits.ts` | Pure: what each gesture writes (#1388) — a Move's rigid, clamped delta; Connect's link and its Shift session's net, which absorbs the links it grew from; a Retarget's end; an Extend's destination; a Delete's rows, every link and net leg naming a deleted item among them, refused where a read-only one names one; and the refusals of an end no kind's field holds. |
| `../drafted.ts` | Pure: the drawing with the drafts in place (#1388) — a drafted row the read holds drawn as drafted, or nowhere when deleted or unplaced; a new row drawn though no read holds it; a drafted row a narrowing hides waiting in its session. |
| `../toolbar.tsx` | The toolbar's items (`useSchematicToolbarItems`): the rail, the tools, the zoom and Fit, Find and the steps, on one fold ladder ending in the View bundle. |
| `../tools.ts` | The tool held and the link kind Connect draws, the viewer's, in the UI store under `schematicKeys(id).tools`; the tools the Schematic offers. |
| `../find.ts` | Find's source over the items the drawing holds, for the shared key search. |
| `../counts.ts`, `../footer.tsx` | What the footer counts (pure), and the footer on the shared rail: the counts and each record's last save. |
| `../messages.ts` | The Schematic's words. |
| `../data.ts` | The reads, in a component of their own (`SchematicDataReader`): each kind's rows through its `rows` — its record read whole, or its narrowing read complete through its source — and the details read whole beside them, each kind on its own: one whose read fails keeps what was drawn of it and says why. An entity whose roles read again as they were keeps what was drawn of it; while a read is in flight the canvas keeps the last complete drawing. It reads the stored rows alone, and says which each read holds (`held`), which the drafts are drawn over. |
| `view.tsx` | The canvas (`SchematicCanvas`): its hooks, gesture handlers and DOM/JSX — the camera, the selection, a Move's preview, the connect draft and its refusal's caption, the cards, the minimap and the scale bar. The canvas's React state lives here. |
| `drawn.ts` | Pure: what the canvas draws — an item, a zone, a link and a net from its kind's roles, typed from their East types. An entity's id is its reference printed (`entityId`); an item with no position draws nothing. |
| `camera.ts` | Pure camera maths + the interaction-mode machine (`nextMode`, `cancelsFly`), rAF coalescer, projector, culling. |
| `paint.ts` | Pure Canvas2D painter + routing/hit geometry (`orthogonalize`, `distanceToPolyline`, `parallelLanes`, label pills, net trunks and the leg each stub draws), and geometry about its anchor (`placedVertices`, `zoneAnchor`). It draws every colour and font from the palette and each entity's tint it is given — none of its own. |
| `selection.ts` | Pure marquee helpers (`marqueeHits`). |
| `model.ts` | Pure derived model: the zones' containment tree the steps walk (`buildNavTree`), LOD (`tierSize`, `buildCenterTree`, `declutterTiers`). |
| `layers.ts` | Pure: what the layers' author defaults hide, lock and dim (the viewer's own choices are the Layers tab's, #1389). |
| `tints.ts` | Pure: an entity's colour roles — its colour token, its tone, its status's, its pattern's — and every colour a drawing names. |
| `theme.tsx` | The theme bridge: the probe in the recipe's `probe` slot — the palette's roles, the mono fonts and each colour the drawing names — read as the page computes it. |
| east-ui-components' `src/theme/slot-recipes/schematic.ts` | ALL styling, the colour chain an entity's colour resolves through among it. No inline styles beyond geometry: positions, sizes, the camera's CSS variables and a layer's opacity. |

Pure modules stay pure — no React imports. New geometry/derivation logic
goes in a pure module with unit tests, not in the component.

## Invariants

**State & commit phase**
1. **No render-phase ref writes.** Async closures (rAF `applyCamera`,
   pointer handlers, timers) read `renderSnapRef` / `commitCtxRef`, both
   written by ONE dep-less `useLayoutEffect` (commit phase). A discarded /
   StrictMode render must never be observable. New paint/geometry inputs:
   add a field to the snapshot, never a new render-phase mirror ref. The
   palette and each entity's colour are read from the probe in that same
   effect, when the colours the drawing names or the theme moved.
2. **`lastPaintRef` identity short-circuit.** Paint-relevant state must be
   FRESH OBJECT identities on change (fresh `Set`/`Map`/array per commit) —
   the paint gate compares identities, never deep-equals. Every new
   paint-relevant feature extends the short-circuit's field tuple.
3. **Interactive-state pattern** (package CLAUDE.md) everywhere: local
   state + replace-on-change keyed on what was READ — the reader hands the
   canvas a new drawing only when what it draws moves, so a payload built
   again with closures of its own (#809) never replaces an edit — +
   compute-next OUTSIDE updaters; PURE functional updaters only.

**Editing through the sessions (#1388)**
4. Every gesture that writes is one step of the editing's history: the
   canvas works out what it writes (`edits.ts`) and records it through
   `props.editing`, and draws what the frame hands it — the stored rows with
   the drafts in place (`drafted.ts`). It holds no edit of its own: the ONE
   overlay is a Move's preview (`dragMoves`), while its drag is under way —
   the release records the move and drops it, Esc or a lost pointer drops
   it recording nothing. The ONE seam into the painter is `paintValue`
   (`{...data, items: movedItems}`); never feed a preview to paint any other
   way. `movedItems` applies UPSTREAM of the working set so centers / r-tree
   / LOD / steps / link+net endpoints follow a drag for free. Which gestures
   exist follows the kinds' bindings (`editKinds`): Connect draws the link
   kind its menu picks of those bound with their patch door, a Shift session
   grows into the first such net kind whose sides hold its items, Move moves
   the items of the item kinds so bound, Retarget and Extend write a link or
   a net so bound, and Del deletes what is selected of them — refused, its
   words in the footer, where a read-only link or net names an item it would
   delete. `readOnly` makes every kind read only. A gesture onto an item of a
   slot the kind's end or side holds no keys of is refused before its draft
   snaps, in words, as the veto's are.
5. **Declare-before-use is load-bearing**: memos execute during render in
   source order, so an overlay memo must be declared ABOVE its first
   consumer (`paintValue`). The jsdom mount test
   (`../schematic.dom.test.tsx`) exists precisely to catch this class.

**Callbacks & selection**
6. Every author callback goes through `dispatchEast(name, run)` —
   queueMicrotask + try/catch + Promise `.catch`. Never call an East
   callback bare, never inside a state updater. The one exception is the
   connect veto (`connectRefusal`), asked in place as a drag moves: it hears
   a `Candidate` — the link or net kind the gesture writes and its two items
   — and answers `none` or the refusal's words, which the draft keeps
   (`connectDraft.reason`) and shows in the shared drag caption
   (`[data-drag-caption][data-refused]`) under the item it would end at,
   placed by the camera as a card is (#1388). Its verdicts cache per (kind,
   from, to), and a veto that throws allows the pair and logs it.
7. ONE selection funnel per part — `commitSelection` the items,
   `commitZoneSelection` the zones, `commitLinkSelection` the link or net —
   for every mutation (tap / marquee / prev-next / hygiene prune / clear).
   Each writes its part to `selectedNowRef` and asks `reportSelection` for
   one report: `onSelect` hears the whole selection once, after a gesture's
   last funnel, and not again while it is what the host heard last
   (`equalFor`). The host hears each entity by its reference — its kind's
   slot and its key (`refById`, the drafted links and nets among them) —
   never by its canvas id. Nothing the canvas does writes a slice. The frame
   hears only whether anything is selected (its steps show while it is).
8. **Fly BEFORE commit.** A fly that comes with a selection — Find's pick,
   the steps', the arrow keys' (`flyToItem`) — must be initiated before the
   selection commit — commit-first leaves the fly dead (the commit's paint
   cancels it). A tap and the marquee select in place, and fly nowhere
   (#1401). `flyTo` is the single fly entry (it re-aims per frame from the
   live viewport); gesture-vs-fly arbitration is the camera mode machine's
   job alone.
9. Hit-test = drawing: link/net hit-testing reuses the painter's exact
   routing maths (lanes, orthogonalization, trunk/branch composition), and a
   footprint or a zone's geometry is hit about the anchor it is drawn about
   — an item's centre, a zone's box centre. If a paint path changes, its hit
   path changes with it.

**Colour (#1387, D14, SC26)**
10. One colour per entity, canvas and card alike: an entity's colour roles
    (`tints.ts`) are data attributes the recipe's one chain of custom
    properties resolves — `--schematic-color`, else its tone, else its
    status's, else its pattern's, else its surface's ground — on the card's
    dot and on the probe's element for the canvas. A value naming no theme
    colour token sets nothing, so it draws its tone. Never resolve a colour
    in JS, and never name a palette step or a Chakra default.

**Sessions, nets, hover**
11. A Connect session keeps the links its drags drew — or the selected
    link it was seeded with — and the net they grew into, each by its
    minted key, and reads their ends and sides from the drawing when its
    next drag lands, so Undo, Redo or another gesture between two drags is
    the session's too; one whose links or net the drawing no longer holds
    is over. Its first Shift-drag grows it into a NET, deleting the links it
    absorbs, as one step (invariant 4).
12. No hover channel: nothing opens on dwell. What an entity is shows in the
    inspector, never a card under the pointer.

**Perf (#183 WS6)**
13. Budget: ~2,000 items / 200 zones should pan at 60 fps with paint
    < 16 ms — pan/zoom is 3 CSS var writes + one coalesced canvas paint,
    never a per-card React re-layout (invariant 6 of #57).
14. Marquee HITS recompute at most once per animation frame (display-only;
    pointerup recomputes at commit). The frame rect and LOD tiers are
    memoised on their input identities. Anything per-pointermove must be
    O(visible), not O(items).
15. No example carries the budget while each kind is read whole or complete
    through its source: the scale probe is the area index's example, whose
    rows are read by area. Until then a paint-path change is held by the
    pure tests and the responsive suite.

**A11y (#183 WS7)**
16. The canvas is a focusable `role="application"` surface: arrows step the
    selection via `stepSelection` (fly + select, the steps' path), Enter
    — or a double-click — opens the selection in the inspector's Details
    once the inspector draws (#1391), ring on `:focus-visible` only.
    Pointer-only gestures must keep a toolbar / key / callback equivalent:
    the toolbar's controls are real `<button>`s and radios with names.

## Testing layers

| Layer | File(s) | Catches |
|---|---|---|
| Pure unit | `camera.test.ts`, `paint.test.ts`, `selection.test.ts`, `model.test.ts`, `drawn.test.ts`, `layers.test.ts`, `tints.test.ts`; `../find.test.ts`, `../tools.test.ts`, `../footer.test.ts`, `../edits.test.ts`, `../drafted.test.ts` | Geometry, the leg each net stub draws, mode machine, LOD, the containment tree, the marquee, what an entity draws from its roles, what the layers do, an entity's colour roles, Find's matches, the tools offered and held, the footer's counts, what each gesture writes, the drawing with its drafts in place |
| On e3 (jsdom) | `../schematic.dom.test.tsx` | Each example mounted as the showcase mounts it, its kinds' records read through e3-web: the cards drawn, a record another session changes redrawn, a kind read through its source never read whole, a footprint from its row's own fields; hook-graph ordering (TDZ) |
| The frame (jsdom) | `../schematic-frame.dom.test.tsx`, `../schematic-toolbar.dom.test.tsx` | The toolbar's items and their order and fold ladder, the tools kept under the `id`, Connect's menu, the keys, Find, the footer's counts and last saves, the skeleton on the first read, a failed read's banner and Retry, the probe and the cards' dots, inline styles |
| The editing (jsdom, on e3) | `../schematic-editing.dom.test.tsx` | Move with Esc and a lost pointer, writing each rack's centre alone; Connect under a minted key, and a refused end's words; a Shift session's trunk and Undo; Retarget; Extend and Del on a leg and a net; Del on racks with their runs and legs; Save per record, one refused; a drawing read only; a draft the rail narrows out |
| The carrier (jsdom) | `../schematic-carrier.dom.test.tsx` | `<Schematic>` as the `Schematic` extension through the dispatcher, in its frame; its functions decoded — each kind's rows, the zones' patterns from their rows, `onSelect` writing the whole selection to State, each entity named by its reference, drafts included, and `canConnect`'s words, `none` and a throw |
| IR contract | e3-ui's `test/schematic/schematic.spec.ts` + `.examples.tsx` + `schematic-docs.spec.ts` | The kinds' bindings and refusals, their closed functions over decoded bytes, the payload, examples↔tests parity, doc examples, plugin index |
| The move | `test/schematic-moved.spec.ts` (this package) | east-ui and east-ui-components publish nothing of the Schematic but its slot recipe |
| Visual | the showcase's responsive suite (`east-ui-showcase/tests/responsive/`) | `schematic-frame.spec.ts` — the frame's geometry, the fold ladder at 1440/1024/768/390/360px and a 294px parent, the colours on canvas and cards, the tokens and mono font, inline styles, in both themes; `schematic-editing.spec.ts` — Move and Connect by the mouse and by touch, and a refused end's caption in the danger ink; the toolbar sweep (`visual-invariants.spec.ts`), the touch targets (`toolbar-touch.spec.ts`), the cold load (`builder-loading.spec.ts`), the data centre's shadows (`foundations.spec.ts`) |

The jsdom files lay the canvas out — its box, pointer capture and the element
at a point — through `../schematic.test-utils.ts`, which also gives them a tap
at a world point and an item's card.

`make build` type-checks this package before vite bundles it
(`pnpm typecheck`, #589); `make lint` runs eslint.
