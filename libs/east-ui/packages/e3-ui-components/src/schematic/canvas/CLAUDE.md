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
draws the stored rows with the drafts in place. The library's cards drop on it
(#1390): the canvas is the drop's one cell, and each drop is one step of the
same history. What is selected shows in the inspector (#1391): the canvas
reports the selection, a net's leg with it, and Enter or a double-click opens
it in Details.

## Module map

| File | Role |
|---|---|
| `../index.tsx` | The frame over one shared state (`EastChakraSchematic`, #1387): the reader beside it, the toolbar's items — the history item last while a record is edited — the canvas in main, the library as the start pane (#1389) over the sources its tabs follow (`FollowSources`), the footer, the banners over a kind whose read failed (Retry), a followed source whose narrowing failed (Retry) and each record's session's (`SessionBanners`), and `BuilderFrame.loading` until the first read has settled. It holds what the parts share — the editing, the drawing with its drafts in place, the tool held, the layers as their author and the viewer have them, what is selected, the zone in view, why the last gesture was refused — drives the canvas's camera, steps, Find's pick and the Index's through its handle, and takes ⌘Z, ⇧⌘Z and ⌘Y anywhere in the frame but a field typed into. Its drops (`../use-drop.ts`, #1390) read that shared state as it stands: what a drop plans over, the selection a card's ⏎ drops on, the view's centre, and the item a drop adds or places, selected through the handle once the canvas draws it. Its inspector (#1391) is the end pane, given `inspector`: what is selected, its rows read in a component of their own beside the frame, and the drawing's issues; its tab is kept per viewer, and Enter or a double-click on the canvas opens it on Details. |
| `../inspect.ts`, `../inspector.tsx`, `../inspector-rows.ts` | Pure: what Details shows (`inspectedOf`: the drawing, an entity, a net's leg, several) and what an item is joined to (`joinsOf`); the end pane (`schematicInspectorPane`): Details — through the shared `FieldForm` and inspector head, a kind's form or its own `inspector`, its details' beside it, an item's position, a link's ends as Choosers, a net's sides as tags — and Issues, each edit one step of the history: a field through its record's `set`, an own Details' row whole, a position, ends or sides through the kind's `write`, Delete as Del; and the inspected entity's stored rows, read in a component of their own (`SchematicInspectedReader`), its own and its details', by its key. |
| `../issues.ts` | Pure: the drawing's issues (SC16) — an item outside the drawing, a shape past its box, a colour naming no theme colour, a link or a net naming an item no kind holds — and its sessions': the app's check refusing a drafted row, and a Save refused or in conflict. |
| `../record-keys.ts` | Pure: each record's key in the history — a kind's slot, or its details' (`detailsKey`, `recordSlot`). |
| `../editing.ts` | The editing (#1388): one history over a session per record the Schematic writes — each kind bound with its patch door, and each one's details so bound — through the shared Schedule editing (`useScheduleEditing`), each kind a record written a whole row at a time; a gesture's edits recorded as one step through its kinds' own `write` and `create` (an existing row rewritten from the row as its session finds it); a new row's key minted (`mintKey`); each draft decoded once. |
| `../edits.ts` | Pure: what each gesture writes (#1388) — a Move's rigid, clamped delta; Connect's link and its Shift session's net, which absorbs the links it grew from; a Retarget's end; an Extend's destination; a Delete's rows, every link and net leg naming a deleted item among them, refused where a read-only one names one; and the refusals of an end no kind's field holds. A drop's too (#1390): a new item from a template's values at a point, a link or a net given a template's values over the row as its session finds it — its ends, sides and key kept — and an author's field writes through the kind's `set`. |
| `../drafted.ts` | Pure: the drawing with the drafts in place (#1388) — a drafted row the read holds drawn as drafted, or nowhere when deleted or unplaced; a new row drawn though no read holds it; a drafted row a narrowing hides waiting in its session. |
| `../toolbar.tsx` | The toolbar's items (`useSchematicToolbarItems`): the rail, the tools, the zoom and Fit, Find and the steps, on one fold ladder ending in the View bundle. |
| `../tools.ts` | The tool held and the link kind Connect draws, the viewer's, in the UI store under `schematicKeys(id).tools`; the tools the Schematic offers. |
| `../find.ts` | Find's source over the items the drawing holds, for the shared key search. |
| `../counts.ts`, `../footer.tsx` | What the footer counts (pure), and the footer on the shared rail: the counts and each record's last save. |
| `../library.tsx` | The library pane (#1389): the start pane's tabs `library` lists, each with its count — Templates and the Backlog as Libraries, each card keyed by its entity's id, the templates following their records' sources (`sourcesTab`), the Index and the Layers, and an author's tabs (`sourceTab`); its sources read through `FollowSources` in `../index.tsx`. |
| `../backlog.ts` | Pure: the Backlog's rows — every item kind's rows with no position, the drafts in place, a drafted row the read does not hold waiting in its session. |
| `../index-tree.ts`, `../index-tab.tsx` | Pure: the Index's rows — the zones nested by containment (`buildNavTree`), each counting its items, the search keeping items under their zones, each row's place among its siblings — and the zone the viewport is in (`zoneInView`, a score with hysteresis); and the tab: one focusable tree around the shared virtual rows, pointing at its active row. |
| `../layers-view.ts`, `../layers-tab.tsx` | The viewer's layer choices — shown, locked, isolated — an East value in the UI store under `schematicKeys(id).layers`, and what they do (pure: `layersInForce`, the toggles, Show all); and the Layers tab drawing them. |
| `../drop.ts`, `../use-drop.ts` | Pure: what a library card does where it lands (#1390) — the cards each tab drops (`dropHostOf`: an item template adds an item, a link or net template retypes one of its kind, a backlog row is placed, an author's card sets its `Schematic.patch`'s fields), where a drag rests (`SchematicDropAt`: a point at the screen's resolution, or an entity), the plan over the Schematic as it stands (`planDrop`, `planEnter`, each refusal's words: outside the drawing, no entity of the card's kind, a kind read only or busy), the edits it records and the item it selects, its caption, its name for a screen reader, its step's label and its mark; and the drop target, the canvas its one cell, taking every dropping tab's cards — each drop, and each card's ⏎, one step of the history. |
| `../messages.ts` | The Schematic's words. |
| `../data.ts` | The reads, in a component of their own (`SchematicDataReader`): each kind's rows through its `rows` — its record read whole, or its narrowing read complete through its source — and the details read whole beside them, each kind on its own: one whose read fails keeps what was drawn of it and says why. An entity whose roles read again as they were keeps what was drawn of it; while a read is in flight the canvas keeps the last complete drawing. It reads the stored rows alone, and says which each read holds (`held`), which the drafts are drawn over. |
| `view.tsx` | The canvas (`SchematicCanvas`): its hooks, gesture handlers and DOM/JSX — the camera, the selection, a Move's preview, the connect draft and its refusal's caption, the cards, the minimap and the scale bar; and the drop's cell (#1390) — where a drag rests, a point or the entity of the card's kind under it, as a tap finds it, and its mark. The canvas's React state lives here. |
| `drawn.ts` | Pure: what the canvas draws — an item, a zone, a link and a net from its kind's roles, typed from their East types. An entity's id is its reference printed (`entityId`); an item with no position draws nothing. |
| `camera.ts` | Pure camera maths + the interaction-mode machine (`nextMode`, `cancelsFly`), rAF coalescer, projector, culling. |
| `paint.ts` | Pure Canvas2D painter + routing/hit geometry (`orthogonalize`, `distanceToPolyline`, `parallelLanes`, label pills, net trunks and the leg each stub draws), and geometry about its anchor (`placedVertices`, `zoneAnchor`), and a drop's mark (#1390): a zone's tint in a dashed brand rule, a link's or a net's brand wash under its line, a ring round a marker or the point. It draws every colour and font from the palette and each entity's tint it is given — none of its own. |
| `selection.ts` | Pure marquee helpers (`marqueeHits`). |
| `model.ts` | Pure derived model: the zones' containment tree the steps walk and the Index lists (`buildNavTree`), LOD (`tierSize`, `buildCenterTree`, `declutterTiers`). |
| `layers.ts` | Pure: what the layers hide, lock and dim — their author defaults, with the viewer's choices in the Layers tab over them (`../layers-view.ts`' `layersInForce`, #1389). |
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
   hears what is selected, by id, and the leg of a net a tap selected (its
   steps show while anything is, the Index marks its rows, and the inspector
   shows it). A plain tap selects what it lands on alone — an item, a zone,
   or a link or a net — clearing the other parts; Shift extends (D16).
7a. **A locked layer's entities never select (SC27).** Every path that
   selects passes them by — a tap (`itemKeyAt`, `zoneKeyAt`, `linkKeyAt`),
   the marquee (`marqueeHits`) and the steps (`itemOrder`) — and `reveal`
   (Find's pick, the Index's) flies to one and selects nothing. Locking or
   hiding a layer lets go of what is selected on it: the hygiene effects
   prune the items, the zones and the link through their funnels, so the
   host hears it. A pick by `reveal` — Find's, the Index's or the
   inspector's: an item, a zone, a link or a net — replaces the whole
   selection, flying to it (a link's or a net's box its members' and its
   bends'); `undefined` clears every part.
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
    selection via `stepSelection` (fly + select, the steps' path), Enter —
    or a double-click on an entity — opens the selection in the inspector's
    Details (`onOpen`), the pane expanded if it was collapsed (#1391), ring on
    `:focus-visible` only.
    Pointer-only gestures must keep a toolbar / key / callback equivalent:
    the toolbar's controls are real `<button>`s and radios with names.

**Drops (#1390)**
17. **The canvas is the drop's one cell**, registered on the Schematic's
    target (`schematicKeys(id).surface`), which takes the cards of every tab
    that drops; a drop plans over the Schematic as it stands, never a
    render's copy (`../drop.ts`' `planDrop`). Where a drag rests is a point —
    the pointer's world point at the screen's resolution, its digits from the
    ppu, so the caption says what is written, after the zone holding it by
    the Index's host rule (`hostZones`, `zoneHolding`) — or the entity of the
    card's kind under it, found as a tap finds it (invariant 9): a locked
    layer's entities and a hatched zone take no drop, and an item's card
    covers the zones and links beneath it.
18. **A drop's marks are the canvas's own** — the zone tinted, a link's or a
    net's line washed, a ring round a marker or the point, painted from the
    snapshot (`dropMark`, invariants 1–2), and a card's `data-drop-target`,
    which the recipe draws in the brand. The canvas takes none of the shared
    stage's frame, wash or badge, keeping its ground; where a drop is refused
    it takes the not-allowed cursor, and the ghost's red caption says why.
19. **⏎ on a card** — and, on a touch screen, a tap on the selected card —
    drops it on the selection (an author's card on every selected entity of
    its kind, one step) or a template or a backlog row at the view's centre;
    refused, the footer says why, and one that lands clears it. A drop that
    changes nothing records nothing. An item a drop adds or places is
    selected once the drawing draws it, never before.

## Testing layers

| Layer | File(s) | Catches |
|---|---|---|
| Pure unit | `camera.test.ts`, `paint.test.ts`, `selection.test.ts`, `model.test.ts`, `drawn.test.ts`, `layers.test.ts`, `tints.test.ts`; `../find.test.ts`, `../tools.test.ts`, `../footer.test.ts`, `../edits.test.ts`, `../drafted.test.ts`, `../backlog.test.ts`, `../index-tree.test.ts`, `../layers-view.test.ts`, `../drop.test.ts`, `../inspect.test.ts`, `../issues.test.ts` | Geometry, the leg each net stub draws, a drop's marks, what a card does where it lands and its words, mode machine, LOD, the containment tree, the marquee, what an entity draws from its roles, what the layers do, an entity's colour roles and a layer's swatch, Find's matches, the tools offered and held, the footer's counts, what each gesture writes, the drawing with its drafts in place, the Backlog's rows, the Index's rows and the zone in view, the viewer's layer choices, what Details shows and what an item is joined to, the drawing's issues and its sessions' |
| On e3 (jsdom) | `../schematic.dom.test.tsx` | Each example mounted as the showcase mounts it, its kinds' records read through e3-web: the cards drawn, a record another session changes redrawn, a kind read through its source never read whole, a footprint from its row's own fields; hook-graph ordering (TDZ) |
| The frame (jsdom) | `../schematic-frame.dom.test.tsx`, `../schematic-toolbar.dom.test.tsx` | The toolbar's items and their order and fold ladder, the tools kept under the `id`, Connect's menu, the keys, Find, the footer's counts and last saves, the skeleton on the first read, a failed read's banner and Retry, the probe and the cards' dots, inline styles |
| The editing (jsdom, on e3) | `../schematic-editing.dom.test.tsx` | Move with Esc and a lost pointer, writing each rack's centre alone; Connect under a minted key, and a refused end's words; a Shift session's trunk and Undo; Retarget; Extend and Del on a leg and a net; Del on racks with their runs and legs; Save per record, one refused; a drawing read only; a draft the rail narrows out |
| The library (jsdom, on e3) | `../schematic-library.dom.test.tsx` | The tabs and their counts, the rail's backlog count; the templates grouped, following their sources (`3 of 5`, emptied with Clear filters); an author's tab following its source; the Backlog, another session's change and a narrowing; a tab's search its own; the Index's rows, its fly, selection and zone in view, its keys and its search; the Layers' Hide, Isolate, Lock and Show all, persisting under the `id`; a locked layer's entities never selecting |
| The drops (jsdom, on e3) | `../schematic-drop.dom.test.tsx` | A rack template added where it lands, its key minted and selected, one step Undo takes back, Save writing it; a backlog row placed; a fibre template over a run, its ends and key kept; an owner's card setting a rack's owner, the rack marked; each refusal's words; a drawing read only; ⏎ on the selection, on several and at the view's centre; a touch screen's tap; Connect taking the picked template's values |
| The inspector (jsdom, on e3) | `../schematic-inspector.dom.test.tsx` | The pane's tabs and the issues' count; the drawing's counts and each record's last save with who made it; an item's head, its kind's form, its details' form, its position, Unplace, Delete and what it is joined to — each edit one step, tinted, Undo taking it back, Save writing it; a kind's own Details and its `update`; read only, every field shown and none edited; an area's form, a run's ends as Choosers, a feed's sides as tags, an emptied side refused, a leg's Remove; several by kind and Delete; Enter and a double-click opening Details; Issues — another session's commits, the app's check, a refused Save — each selecting what it names |
| The carrier (jsdom) | `../schematic-carrier.dom.test.tsx` | `<Schematic>` as the `Schematic` extension through the dispatcher, in its frame; its functions decoded — each kind's rows, the zones' patterns from their rows, `onSelect` writing the whole selection to State, each entity named by its reference, drafts included, and `canConnect`'s words, `none` and a throw |
| IR contract | e3-ui's `test/schematic/schematic.spec.ts` + `.examples.tsx` + `schematic-docs.spec.ts` | The kinds' bindings and refusals, their closed functions over decoded bytes, the payload, examples↔tests parity, doc examples, plugin index |
| The move | `test/schematic-moved.spec.ts` (this package) | east-ui and east-ui-components publish nothing of the Schematic but its slot recipe |
| Visual | the showcase's responsive suite (`east-ui-showcase/tests/responsive/`) | `schematic-frame.spec.ts` — the frame's geometry, the library's pane beside main, the fold ladder at 1440/1024/768/390/360px and a 294px parent, the colours on canvas and cards, the tokens and mono font, inline styles, in both themes; `schematic-editing.spec.ts` — Move and Connect by the mouse and by touch, and a refused end's caption in the danger ink; `schematic-library.spec.ts` — the pane, its tabs and cards, the Index's tree rows and focus ring, the Layers' pick-panel rows, on a desktop and on a phone, its touch targets, in both themes; `schematic-drop.spec.ts` — real drags of a rack template, an owner's card, a fibre template and a backlog row: the caption at the screen's resolution and the card drawn where it said, the canvas's own ground under a drop, a refusal's red caption and cursor, a drop target's card in the brand, in both themes, and the touch tap on a phone; `inspector-form.spec.ts` — the inspector's forms measured beside the Sheet's, the Plan's and the Flowchart's: the drawing, a rack, a run's ends, a feed's sides, a cooling unit's own Details, several, an area read only, a changed field's tint and an issue's row, pinned on a desktop in both themes and overlaid on a phone; the toolbar sweep (`visual-invariants.spec.ts`), the touch targets (`toolbar-touch.spec.ts`), the cold load (`builder-loading.spec.ts`), the data centre's shadows (`foundations.spec.ts`) |

The jsdom files lay the canvas out — its box, pointer capture and the element
at a point — through `../schematic.test-utils.ts`, which also gives them a tap
at a world point and an item's card.

`make build` type-checks this package before vite bundles it
(`pnpm typecheck`, #589); `make lint` runs eslint.
