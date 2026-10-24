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
it in Details. The rail's narrowing (#1392) draws what it leaves out as
context, never selected, and rings, frames and flies to its matches. Below
480px of main (#1394) it pans, pinches and selects: nothing drags on it, and
the inspector takes the gestures' place.

## Module map

| File | Role |
|---|---|
| `../index.tsx` | The frame over one shared state (`EastChakraSchematic`, #1387): the reader beside it, the toolbar's items — the history item last while a record is edited — the canvas in main, the library as the start pane (#1389) over the sources its tabs follow (`FollowSources`), the footer and its loading line (#1398) — what is read, in a kind's noun: its rows, the area in view, the counts or the details of the rows drawn waiting on theirs, or a read that failed, with Retry — the banners over a followed source whose narrowing failed (Retry) and each record's session's (`SessionBanners`), a kind whose read failed said on the canvas instead (`SchematicCanvasFailure`), one reveal clock around the frame (`LoadingReveal`, waiting while the line loads or the inspected rows are read), and `BuilderFrame.loading` until the first read has settled, main `busy` while a read is in flight after it. It holds what the parts share — the editing, the drawing with its drafts in place, the tool held, the layers as their author and the viewer have them, what is selected, the zone in view, why the last gesture was refused — drives the canvas's camera, steps, Find's pick and the Index's through its handle, and takes ⌘Z, ⇧⌘Z and ⌘Y anywhere in the frame but a field typed into. Its drops (`../use-drop.ts`, #1390) read that shared state as it stands: what a drop plans over, the selection a card's ⏎ drops on, the view's centre, and the item a drop adds or places, selected through the handle once the canvas draws it. Its inspector (#1391) is the end pane, given `inspector`: what is selected, its rows read in a component of their own beside the frame, and the drawing's issues; its tab is kept per viewer, and Enter or a double-click on the canvas opens it on Details. Its narrowing (#1392): each kind's source followed (`FollowSources`) while the narrowing dims or looks at its matches, what it does worked out (`../narrowing.ts`), and every list and count given the drawing it leaves in. Its narrow layout (#1394): main measured by the canvas's element (`useContainerBelow`, `NARROW_WIDTH`) — below 480px no Move or Connect offered, no card dragged, no drop target or cell, the canvas told `narrow`, and the Backlog's card picked what Details shows, an item with no position. |
| `../inspect.ts`, `../inspector.tsx`, `../inspector-rows.ts` | Pure: what Details shows (`inspectedOf`: the drawing, an entity, a net's leg, several; and the frame's item with no position, `SchematicUnplaced`, #1394) and what an item is joined to (`joinsOf`); the end pane (`schematicInspectorPane`): Details — through the shared `FieldForm` and inspector head, a kind's form or its own `inspector`, its details' beside it, an item's position, a link's ends as Choosers, a net's sides as tags, and below 480px of main an item's Connect to… and an item with no position's Place (#1394) — and Issues, each edit one step of the history: a field through its record's `set`, an own Details' row whole, a position, ends or sides through the kind's `write`, Connect to… a link as `connectStep` writes it, Place as the card's ⏎, Delete as Del — the ends, the sides and Connect to… held to the host's veto (`connectVeto`); and the inspected entity's stored rows, read in a component of their own (`SchematicInspectedReader`), its own and its details', by its key; a row it has not read yet drawn as its form's placeholders, no input among them (`Form`'s `pending`, #1398). |
| `../issues.ts` | Pure: the drawing's issues (SC16) — an item outside the drawing, a shape past its box, a colour naming no theme colour, a link or a net naming an item no kind holds — and its sessions': the app's check refusing a drafted row, and a Save refused or in conflict. |
| `../record-keys.ts` | Pure: each record's key in the history — a kind's slot, or its details' (`detailsKey`, `recordSlot`). |
| `../narrowing.ts` | Pure: what the rail's narrowing does to the drawing (#1392) — the matches, each a row its kind's source's shown keys hold; under `dim` the context, a link touching it and a net all of whose members on a side are it among it; what it takes out of every list and of the selection, a link or a net whose ends it hides among it; the drawing the lists show; and the look `narrowed` gives. |
| `../editing.ts` | The editing (#1388): one history over a session per record the Schematic writes — each kind bound with its patch door, and each one's details so bound — through the shared Schedule editing (`useScheduleEditing`), each kind a record written a whole row at a time; a gesture's edits recorded as one step through its kinds' own `write` and `create` (an existing row rewritten from the row as its session finds it); a new row's key minted (`mintKey`); each draft decoded once. |
| `../edits.ts` | Pure: what each gesture writes (#1388) — a Move's rigid, clamped delta; Connect's link and its Shift session's net, which absorbs the links it grew from; a Retarget's end; an Extend's destination; a Delete's rows, every link and net leg naming a deleted item among them, refused where a read-only one names one; and the refusals of an end no kind's field holds. A drop's too (#1390): a new item from a template's values at a point, a link or a net given a template's values over the row as its session finds it — its ends, sides and key kept — and an author's field writes through the kind's `set`. The host's veto as every route that connects asks it (`connectVeto`: its verdicts kept, a throw allowing) and the pairs a change of a net's sides newly joins, which it hears (`joinedPairs`, #1394). |
| `../drafted.ts` | Pure: the drawing with the drafts in place (#1388) — a drafted row the read holds drawn as drafted, or nowhere when deleted or unplaced; a new row drawn though no read holds it; a drafted row a narrowing hides waiting in its session. |
| `../toolbar.tsx` | The toolbar's items (`useSchematicToolbarItems`): the rail, the tools, the zoom and Fit, Find and the steps, on one fold ladder ending in the View bundle. |
| `../tools.ts` | The tool held and the link kind Connect draws, the viewer's, in the UI store under `schematicKeys(id).tools`; the tools the Schematic offers. |
| `../find.ts` | Find's source for the shared key search (#1404): every item kind's record sought by key, never what the drawing holds — a kind read through its source in its record's own order through e3 (`recordSliceSeek` for its matches' run, `recordSlicePage` for the rows a list shows, `recordSliceWithin` for which of them the rail's filters leave out, each over the whole record), one read whole in its rows (`wholeMatches`); each match's mark (`foundMark`: no position, then hidden or dimmed by the filters, then a hidden layer) and line (`foundLine`); and the kinds' matches addressed as one list (`runsAt`). |
| `../counts.ts`, `../footer.tsx` | What the drawing's Details counts with nothing selected, and the records whose commits say when each was last saved (pure); and the footer on the shared rail, holding only what is live (ruled 23 Oct 2026): each kind drawn as its density — how many rows it shades in the viewport (`../area.ts`' `densityInView`), and that zooming in draws them, the side of its cells named on it (`data-density-cell`) — why the last gesture was refused, each Save's notice, and where Find's last pick landed on an item the canvas doesn't show as itself — why, with Clear filters where the filters leave it out (#1404). |
| `../library.tsx` | The library pane (#1389): the start pane's tabs `library` lists, each with its count — Templates and the Backlog as Libraries, each card keyed by its entity's id, the templates following their records' sources (`sourcesTab`), the Index and the Layers, and an author's tabs (`sourceTab`); its sources read through `FollowSources` in `../index.tsx`. |
| `../backlog.ts` | Pure: the Backlog's rows — every item kind's rows with no position, the drafts in place, a drafted row the read does not hold waiting in its session. |
| `../index-tree.ts`, `../index-tab.tsx` | Pure: the Index's rows — the zones nested by containment (`buildNavTree`), each counting its items, the search keeping items under their zones, each row's place among its siblings — and the zone the viewport is in (`zoneInView`, a score with hysteresis); and the tab: one focusable tree around the shared virtual rows, pointing at its active row. |
| `../layers-view.ts`, `../layers-tab.tsx` | The viewer's layer choices — shown, locked, isolated — an East value in the UI store under `schematicKeys(id).layers`, and what they do (pure: `layersInForce`, the toggles, Show all); and the Layers tab drawing them. |
| `../drop.ts`, `../use-drop.ts` | Pure: what a library card does where it lands (#1390) — the cards each tab drops (`dropHostOf`: an item template adds an item, a link or net template retypes one of its kind, a backlog row is placed, an author's card sets its `Schematic.patch`'s fields), where a drag rests (`SchematicDropAt`: a point at the screen's resolution, or an entity), the plan over the Schematic as it stands (`planDrop`, `planEnter`, each refusal's words: outside the drawing, no entity of the card's kind, a kind read only or busy), the edits it records and the item it selects, its caption, its name for a screen reader, its step's label and its mark; and the drop target, the canvas its one cell, taking every dropping tab's cards — each drop, and each card's ⏎, one step of the history. |
| `../messages.ts` | The Schematic's words. |
| `../data.ts` | The reads, in a component of their own (`SchematicDataReader`): each kind's rows through its `rows` — its record read whole, or its narrowing read complete through its source, or its window read by area (`../area.ts`): its rows while the view holds no more than a window draws, by its cells' counts (`cellsInView`) and past them its density's (`densityInView`), else its density, a window drawn so holding only at its zoom (`windowHolds`, D49) — and the details read whole beside them, or beside a kind read by area by the runs of its window's cells, at every zoom, so a dot draws its item's status (D45), each kind on its own: one whose read fails keeps what was drawn of it and says why. An entity whose roles read again as they were keeps what was drawn of it; while a read is in flight the canvas keeps the last complete drawing. It reads the stored rows alone, and says which each read holds (`held`), which the drafts are drawn over. A kind read by area's rows are made by its `rowsOf` each once, and a budget's worth a read, the rest a task later (`../made-rows.ts`, #1393); a kind whose read is in flight, or whose rows are still being made, keeps what was drawn of it; and the frame is handed what was read in a task of its own. What it hands the frame says what is read (#1398): what each read in flight is for (`SchematicReading`: the rows, the area in view, the counts or the details, and how many drawn rows wait on theirs), the area of the view a kind read by area has not drawn (`unread`: its window less the reach its drawing holds, `../area.ts`' `unreadArea`) and what a failed read could not read (`failedAreas`). Once the drawing has settled once, rows that land draw before their details, a row drawn before keeping the details it had and a new one carrying the card roles its details give (`pending`). |
| `card.tsx` | An item's card (`SchematicCard`, #1393): a memoised component of its own, told how it stands in values — selected, locked, its layer's opacity, the narrowing's context, a match's emphasis, a Connect's refused end, a drop's target — so a frame the camera moves renders no card whose standing holds; its icon, label and status's dot, second line, bar and figure, and while its details are read a placeholder in each role's place (#1398). |
| `view.tsx` | The canvas (`SchematicCanvas`): its hooks, gesture handlers and DOM/JSX — the camera, the selection, a Move's preview, the connect draft and its refusal's caption, the cards, the minimap and the scale bar; the links' ends (#1403) — each card's size as the page lays it out, heard by a ResizeObserver — the link lit under the pointer (`data-lit-link`), a selected link's handles (`data-link-handles`, none below 480px of main, #1394), and the links' R-tree a hover, a tap and a drop search; and the drop's cell (#1390) — where a drag rests, a point or the entity of the card's kind under it, as a tap finds it, and its mark; and the narrowing's (#1392) — its context, which selects by no path, a card's `data-context`, and its matches' emphasis, frame and fit; and the loading's (#1398) — the wash over the area unread (`data-schematic-unread`), a layer under the grid, the paint and the cards that follows the camera's variables (`boxCss`), a card's placeholders where its details are read, the reveal clock heard through `RevealTell` into `placeholdersRef` for the painter, and a failed read's box (`LoadingFailedBox`) at the top-left of the area it could not read in view. The canvas's React state lives here. |
| `drawn.ts` | Pure: what the canvas draws — an item, a zone, a link and a net from its kind's roles, typed from their East types. An entity's id is its reference printed (`entityId`); an item with no position draws nothing; an item drawn before its details carries the card roles they give (`pending`), and its status is unread while they are (`statusUnread`, #1398). |
| `minimap.ts` | Pure: the minimap (#1393) — its size (`minimapSize`: the drawing at its aspect, 150px wide at most, a quarter of the canvas's width and a third of its height at most) and its paint (`paintMinimap`): each zone's floor, each kind read by area's whole drawing's density (`../area.ts`' `overview`) in the heat steps, each item of a kind read whole as a dot, each zone's outline over them. `view.tsx` paints it from the commit-phase snapshot, again only as what it shows moves, and names what it draws (`data-minimap-cells`, `data-minimap-items`); the viewport's box over it is DOM. |
| `camera.ts` | Pure camera maths + the interaction-mode machine (`nextMode`, `cancelsFly`), rAF coalescer, projector, culling; Fit's camera — the extent inside the canvas less its margin, centred (`fitView`, #1393) — and where a fly stands a time into it (`flyStep`); a world box as CSS geometry under the camera's variables (`boxCss`, #1398). |
| `paint.ts` | Pure Canvas2D painter + routing/hit geometry (`orthogonalize`, `distanceToPolyline`, `parallelLanes`, net trunks and the leg each stub draws), and geometry about its anchor (`placedVertices`, `zoneAnchor`); the links' and nets' drawing in the shared links look (#1403) — each one's runs from the edges of the items it joins where they draw at the zoom (`endShape`: a card's side, a pin's edge, a dot's rim; `leaveShape`, `meetShape`), its heads where it arrives, a net's on each destination leg, a link's handles and its caption's point (`linkRoutes`, `netRoutes`, over `routeEnv`) — painted through the shared painter (`shared/links/canvas.ts`), the lit and the selected ones last in the strong ink, their ends ringed; Connect's draft the shared drag preview, and a retarget's run its `was` line; and a drop's mark (#1390): a zone's tint in a dashed brand rule, a link's or a net's brand wash under its line, a ring round a marker or the point; and the narrowing's (#1392): context faded and greyed — an item, a zone, a link, a net, a net's leg to a context item — and the matches ringed and framed; and a kind's density at overview (#1393), each cell in one of the theme's five heat steps (`densityStep`), under the zones; and a marker or a footprint whose status is unread (#1398) in the placeholders' fill once the reveal clock says, nothing before, a selected marker's ring drawn either way. It draws every colour and font from the palette and each entity's tint it is given — none of its own. |
| `selection.ts` | Pure marquee helpers (`marqueeHits`), and the link or the net under a point (#1403): the links' R-tree (`linkIndex`) and the hit-test over it (`linkAt`), which asks the routes of only the links near the point. |
| `model.ts` | Pure derived model: the zones' containment tree the steps walk and the Index lists (`buildNavTree`), LOD (`tierSize`, `cardContentWidth`, `cardWhole`, `buildCenterTree`, `declutterTiers`), and the box the narrowing's matches span (`matchesExtent`, #1392). |
| `layers.ts` | Pure: what the layers hide, lock and dim — their author defaults, with the viewer's choices in the Layers tab over them (`../layers-view.ts`' `layersInForce`, #1389). |
| `tints.ts` | Pure: an entity's colour roles — its colour token, its tone, its status's, its pattern's; a link's or a net's its style's tone alone, one naming none drawing in the links look's ink (#1403) — and every colour a drawing names. |
| `theme.tsx` | The theme bridge: the probe in the recipe's `probe` slot — the palette's roles, the mono fonts, each colour the drawing names, and the shared links part's own elements (`linkRibbons`, #1403): the links' look the Plan's links draw with — read as the page computes it. |
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
   snaps, in words, as the veto's are. Below 480px of main none of Move,
   Connect, Retarget or a drop is offered (invariant 31): the inspector's
   actions write what they wrote.
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
   from, to), and a veto that throws allows the pair and logs it
   (`../edits.ts`' `connectVeto`, which the inspector's Connect to…, ends and
   sides ask too, #1394: one rule for every route that connects).
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
   or a link or a net — clearing the other parts; Shift extends (D16). Every
   tap goes through `tapAt`. A press on a selected link's end handle is a tap
   until it moves past `DRAG_THRESHOLD_PX`, and only then a Retarget (SC10):
   let go where it began, it selects the item under it.
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
7b. **What the narrowing takes out never selects (#1392).** Its context, and a
   link or a net whose ends it hides, are inert as a locked layer's entities
   are — `inertKeys`, by every path above, a reveal flying to one and
   selecting nothing — and a net's leg to a context item takes no tap; the
   hygiene effects let go of what goes out, a leg to an item gone to context
   demoting to its net. Find lists them, marked (#1404): a pick on one the
   canvas draws as context is a reveal; on one it draws nowhere — hidden by
   the filters or on a hidden layer — the handle's `look` flies to where it
   stands, selecting nothing, and the footer says why. Clear filters clears
   its kind's source and selects it through the handle once it draws.
8. **Fly BEFORE commit.** A fly that comes with a selection — Find's pick,
   the steps', the arrow keys' (`flyToItem`) — must be initiated before the
   selection commit — commit-first leaves the fly dead (the commit's paint
   cancels it). A tap and the marquee select in place, and fly nowhere
   (#1401). `flyTo` is the single fly entry (it re-aims per frame from the
   live viewport); gesture-vs-fly arbitration is the camera mode machine's
   job alone.
9. Hit-test = drawing: link/net hit-testing takes the painter's own routes
   (`linkRoutes`, `netRoutes`: lanes, orthogonalization, trunk/branch
   composition, each end on its item's edge where it draws at the zoom, to
   each head's tip), within each run's weight and the shared hit reach — a
   tap, a hover, a drop and a selected link's handles alike (#1403) — and a
   footprint or a zone's geometry is hit about the anchor it is drawn about
   — an item's centre, a zone's box centre. If a paint path changes, its hit
   path changes with it. A card's side is its size as the page lays it out,
   heard by a ResizeObserver, else as the declutter reckons it (`tierSize`).

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
    inspector, never a card under the pointer. The one thing the pointer's
    hover does (#1403): the link or the net under it lights — drawn last, in
    the strong ink, its ends ringed, named in `data-lit-link` — while no
    button is held and no gesture or card drag is under way, found as a tap
    finds it: an item over it, a card, a pin or a dot, keeps it unlit, as
    the minimap does. A press puts it out, and leaving the canvas.

**Perf (#183 WS6)**
13. Budget: ~2,000 items / 200 zones should pan at 60 fps with paint
    < 16 ms — pan/zoom is 3 CSS var writes + one coalesced canvas paint,
    never a per-card React re-layout (invariant 6 of #57). The canvas renders
    a frame at a time as its camera moves (its culling, its tiers), and each
    card is a memoised component of its own, told how it stands in values
    (`card.tsx`): a frame renders no card whose standing holds, so a pan where
    the items draw as cards works out no card's styles again (#1393). Never
    hand a card an object or a function made in the render.
14. Marquee HITS recompute at most once per animation frame (display-only;
    pointerup recomputes at commit). The frame rect and LOD tiers are
    memoised on their input identities. Anything per-pointermove must be
    O(visible), not O(items): the hover's link is searched through the links'
    R-tree (`linkIndex`), only those near the pointer routed (#1403).
15. No example carries the budget while each kind is read whole or complete
    through its source: the scale probe is the area index's example, whose
    rows are read by area. Until then a paint-path change is held by the
    pure tests and the responsive suite.
15a. **No stutter as a window lands** (#1393): wheeled from Fit to 40× and
    back over the floor of 20,000 racks, no frame takes over 50 ms and the
    browser reports no long animation frame (`east-ui-showcase`'s
    `schematic-perf.spec.ts`, `E3_UI_PERF=1`). A landing's work is bounded: a
    row is made once, a budget's worth a read (`../made-rows.ts`); the
    reader hands the frame what it read in a task of its own; and the canvas
    builds nothing a landing would build for no one — the steps' order is
    worked out as a step asks for it, the centre tree only past the dots'
    zoom, where the declutter reads it, and the recipe's styles once a
    recipe. Anything a new window's thousands of rows would cost the canvas
    must be of what it draws, never of what it might.

**A11y (#183 WS7)**
16. The canvas is a focusable `role="application"` surface: arrows step the
    selection via `stepSelection` (fly + select, the steps' path), Enter —
    or a double-click on an entity — opens the selection in the inspector's
    Details (`onOpen`), the pane expanded if it was collapsed (#1391), ring on
    `:focus-visible` only.
    Pointer-only gestures must keep a toolbar / key / callback equivalent:
    the toolbar's controls are real `<button>`s and radios with names. The
    window hears Space, Ctrl, Del and Esc for the canvas while the pointer is
    over it, never a key typed into a field nor one from a layer portaled out
    of the frame — a popover, a menu, a Chooser's list — which is that layer's
    (`keyIsCanvas`): Esc closing a Chooser keeps the selection.

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

**The narrowing (#1392)**
20. **The matches are the sources' shown keys**, read through
    `FollowSources` (`useSourceVisibility`), never a predicate over the
    rows; a first membership still resolving is no narrowing, never an empty
    one. Hidden — a kind reading only its narrowing — the keys are read only
    for an emphasis, a frame or a fit. A row a gesture created is neither a
    match nor context.
21. **Context is the look's**, at its opacity, greyed while it says so, a
    bare dot with `dot`: a card through the recipe (`data-context`,
    `data-desaturate`, `--schematic-context-opacity`), the canvas through the
    painter's effect (`SchematicPaintEffect`, its identity in the paint
    short-circuit); a net's leg to a context item fades with it.
22. **Fit is keyed on which entities match**, never on where they are, so a
    zoom or a Move never flies it; emphasis rings every match of every sort,
    the frame boxes two or more, and a pulse's phase moves on a loop of its
    own (`pulsePhaseRef`, the card layer's `--pulse`), with no render.

**The camera, Fit and the zoom (#1393, ruled 23 Oct 2026)**
23. **Fit frames the drawing** (`fitView`): its extent inside the canvas less
    `FIT_MARGIN_PX` each side — no more than an eighth of the canvas — centred
    on both axes, so the canvas's middle, which the toolbar's zoom zooms
    about, is the drawing's. That camera is home: the canvas takes it as it
    takes its size, and again as its size moves while it stands there; a
    zoom out to the least zoom snaps to it (`zoomAbout`'s `home`).
24. **The zoom's limit follows the drawing's smallest item** (`maxZoom`):
    40× Fit, or further — until every item held to its own width draws as a
    whole card — bounded by `MAX_PPU`. The toolbar hears where the zoom
    stands (`onZoomRange`): at Fit its Zoom out takes no press, at the limit
    its Zoom in. A fly to an item frames it so it lands on its card
    (`itemFrame`).
25. **A fly reads one clock** (`flyStep`): `performance.now()` as it began and
    as each frame runs, never the frame's own stamp — a page stamps its frames
    on its frame clock, which can stand before the gesture that began the fly
    or, off a browser, on another origin — and a time before its start stands
    where it began, never eased back past it. The pulse reads its clock so.

**What each item draws as (#1393, ruled 23 Oct 2026)**
26. **The declutter is order-free** (`declutterTiers`): each item's form is
    decided from where every item drawn stands — the centre tree is built
    over every item, never the viewport's — so neither the order items come
    in nor a pan changes what one draws as, and a uniformly dense row draws
    as one block. A card draws only where its band allows it, it draws whole
    (`cardWhole`: a card held to its item's own width once that width holds
    its words) and clear of every other item's dot and of every other card
    that could draw; else a pin, clear of every other item's mark — no pin
    covers another item's status — and of every other pin that could draw;
    else a dot. A selected item takes the richest whole form its band gives,
    whatever it covers, and draws over its neighbours: the painter draws it
    last, the recipe raises its card.
27. **A pin's dot stands on its item's point**, its words after it
    (`PIN_LEAD_PX`): its hitbox, its paint and a link's end at its edge
    (`endShape`) all take that box.
28. **The density draws in five heat steps** (`densityStep`, the theme's
    `heat.1`–`heat.5`): a cell's step by its share of the fullest cell on
    halving steps, so cells a row or two apart read alike — under the zones,
    whose outlines and eyebrows stand over it.

**What is read, drawn over (#1398)**
29. **A read in flight covers nothing it drew.** The canvas keeps the last
    complete drawing; once it has settled once, rows that land draw before
    their details, a row drawn before keeping the details it had, a new one
    a placeholder in each card role its details give (`pending`) — never a
    value it has not read. The wash lies only over what of the view a kind
    read by area wants and its drawing does not hold (`unreadArea`), under
    the grid, the paint and the cards, so what is drawn shows over it; a kind
    whose read failed takes none, its box saying so at the top-left of what
    it could not read.
30. **The reveal clock renders no canvas.** The cards' placeholders are the
    shared `PlaceholderShape`s, which read it themselves; the painter's read
    it through `RevealTell`, which writes `placeholdersRef` in a layout effect
    and asks `applyCamera()`, as the pulse's phase moves (invariant 22), and
    the paint short-circuit's tuple holds it (invariant 2).

**The narrow layout (#1394, D15, SC25)**
31. **Below 480px of main nothing drags.** The frame measures main by the
    canvas's element, which fills it (`useContainerBelow` over `onElement`,
    as the other builders measure theirs), its answer committed before paint.
    The tools hold no Move or Connect — the one the viewer holds kept for a
    wider main — no library card drags, the frame's drop target and the
    canvas's drop cell register none, and a selected link draws no handle and
    takes no re-target's press (`data-link-handles` names the link while its
    handles draw). The canvas pans, pinches and selects; a tap on the selected
    card is its ⏎ whatever the pointer. Resizing keeps the tool held, the
    selection and the drafts.
32. **The inspector takes the gestures' place**, writing what they write:
    Connect to… a link of the kind Connect draws, from the item, as
    `connectStep` writes a plain drag's; the position's `x` and `y` a Move's
    centre; the ends a Retarget's; the sides an Extend's; Delete Del's; and the
    Backlog's card picked — an item with no position, which Details shows
    until the canvas selects something, the card is let go or it is placed —
    its Place, the card's ⏎ at the view's centre. Every route that connects is
    held to the host's veto (invariant 6), a change of a net's sides by each
    pair it newly joins (`joinedPairs`).

## Testing layers

| Layer | File(s) | Catches |
|---|---|---|
| Pure unit | `camera.test.ts`, `paint.test.ts`, `selection.test.ts`, `model.test.ts`, `drawn.test.ts`, `layers.test.ts`, `tints.test.ts`, `minimap.test.ts`, `../../shared/links/canvas.test.ts`; `../find.test.ts`, `../tools.test.ts`, `../counts.test.ts`, `../density.test.ts`, `../edits.test.ts`, `../drafted.test.ts`, `../backlog.test.ts`, `../index-tree.test.ts`, `../layers-view.test.ts`, `../drop.test.ts`, `../inspect.test.ts`, `../issues.test.ts`, `../narrowing.test.ts`, `../made-rows.test.ts`, `../unread.test.ts` | Geometry, the leg each net stub draws, a drop's marks, what a card does where it lands and its words, mode machine, LOD, the containment tree, the marquee, what an entity draws from its roles, what the layers do, an entity's colour roles and a layer's swatch, Find's matches among a kind read whole, its marks, its lines and the kinds' matches as one list, the tools offered and held, the drawing's counts, a density's rows in view and its words, a window's cells' count of the view and when a window holds as it was drawn (D49), the minimap's size and what it paints, in order, what each gesture writes, the drawing with its drafts in place, the Backlog's rows, the Index's rows and the zone in view, the viewer's layer choices, what Details shows and what an item is joined to, the drawing's issues and its sessions', what the narrowing does — its matches, its context and what is out — its paint, and the box its matches span; the links' look (#1403) — each end on its item's edge, a card's side, a pin's edge, a dot's rim, as the page lays the card out or as reckoned; a feed's heads on its destination legs; every casing under every ink, a tone's ink, the lit and the selected runs last in the strong ink, their ends ringed, a caption on its knockout, a selected run's handles at its ends' edges, Connect's draft and a retarget's `was` line; and the link under a point through the links' R-tree, only those near it routed; Fit's margin and centring, a zoom out snapping home, a fly never before its start (#1393); the declutter free of the items' order and the viewport, no pin over another item's mark, a boxed card only once whole, a pin's dot on its item, the density's heat steps under the zones, and the selected marker drawn last; a kind read by area's rows each made once — the very row, or one East holds equal — a budget's worth a read, the rest left to the next, and past the most kept those a read does not ask for going (#1393); the area a kind's reads in flight have not drawn — what of one box another leaves, laid once where two kinds' meet — and a marker or a footprint whose status is unread, in the placeholders' fill once revealed, nothing before, a selected marker's ring either way (#1398); the host's veto as every route asks it — its words, its verdicts kept, a throwing veto and an item it can't name allowed — and the pairs a change of a net's sides newly joins (#1394) |
| On e3 (jsdom) | `../schematic.dom.test.tsx` | Each example mounted as the showcase mounts it, its kinds' records read through e3-web: the cards drawn, a record another session changes redrawn, a kind read through its source never read whole, a footprint from its row's own fields; hook-graph ordering (TDZ) |
| The frame (jsdom) | `../schematic-frame.dom.test.tsx`, `../schematic-toolbar.dom.test.tsx` | The toolbar's items and their order and fold ladder, the tools kept under the `id`, Connect's menu, the keys, Find, the footer holding only what is live, the skeleton on the first read and main busy after it, a failed read said on the canvas — its box at the top-left, its Retry asking again, no banner — the probe and the cards' dots, inline styles; a fly on frames stamped behind `performance`, never thrown back and landed as its time is up, and Zoom out and Zoom in taking no press at Fit and at the limit, and the minimap drawing every item of kinds read whole at its size (#1393) |
| Find (jsdom, on e3) | `../schematic-find.dom.test.tsx` | The racks' record sought through its source — a find of it, never a whole read — and a frame read whole found in its rows; a rack the rail hides listed `hidden`, its pick flying to where it stands and selecting nothing, the footer's words, and Clear filters showing it and selecting it; a rack with no position in the Backlog |
| The editing (jsdom, on e3) | `../schematic-editing.dom.test.tsx` | Move with Esc and a lost pointer, writing each rack's centre alone; Connect under a minted key, and a refused end's words; a Shift session's trunk and Undo; Retarget; Extend and Del on a leg and a net; Del on racks with their runs and legs; Save per record, one refused; a drawing read only; a draft the rail narrows out |
| The library (jsdom, on e3) | `../schematic-library.dom.test.tsx` | The tabs and their counts, the rail's backlog count; the templates grouped, following their sources (`3 of 5`, emptied with Clear filters); an author's tab following its source; the Backlog, another session's change and a narrowing; a tab's search its own; the Index's rows, its fly, selection and zone in view, its keys and its search; the Layers' Hide, Isolate, Lock and Show all, persisting under the `id`; a locked layer's entities never selecting |
| The drops (jsdom, on e3) | `../schematic-drop.dom.test.tsx` | A rack template added where it lands, its key minted and selected, one step Undo takes back, Save writing it; a backlog row placed; a fibre template over a run, its ends and key kept; an owner's card setting a rack's owner, the rack marked; each refusal's words; a drawing read only; ⏎ on the selection, on several and at the view's centre; a touch screen's tap; Connect taking the picked template's values |
| The inspector (jsdom, on e3) | `../schematic-inspector.dom.test.tsx` | The pane's tabs and the issues' count; the drawing's counts and each record's last save with who made it; an item's head, its kind's form, its details' form, its position, Unplace, Delete and what it is joined to — each edit one step, tinted, Undo taking it back, Save writing it; a kind's own Details and its `update`; read only, every field shown and none edited; an area's form, a run's ends as Choosers, a feed's sides as tags, an emptied side refused, a leg's Remove; several by kind and Delete; Enter and a double-click opening Details; Issues — another session's commits, the app's check, a refused Save — each selecting what it names |
| The loading (jsdom, on e3) | `../schematic-loading.dom.test.tsx` | The line's words — the racks in view on a zoom, the details of the racks drawn waiting on theirs, a narrowing's filtering (#1398); a pan into cells not read washed under the grid, the paint and the cards, once revealed, a rack drawn before standing in, and the wash gone once the window lands; a window the view leaves before it lands dropped, each of its requests aborted on its way to e3 (CL6); a rack drawn before its details with a placeholder in its meter's place, one drawn before keeping its own; the inspector's fields of a row not read yet as placeholders, no input; a failed area's box at the top-left of the area with Retry, the line saying so, no banner |
| The narrow layout (jsdom, on e3) | `../schematic-narrow.dom.test.tsx` | Below 480px of main no card dragging, the canvas no drop cell and a selected run no handle — a press at its end re-targeting nothing — the tools without Move or Connect, the one held kept for a wider main; resizing keeping the selection and the drafts; Connect to… recording a run as a Connect drag does, Save writing it, the host's veto refusing a pair in the footer; the Backlog's card picked in Details with its Place, and a tap on the selected card placing another, each at the view's centre; a run's ends and a trunk's sides held to the veto (#1394) |
| The camera (jsdom, on e3) | `../schematic-camera.dom.test.tsx` | A pan renders no card — the canvas committing a frame at a time as it moves — and a tap that selects a card renders that card again, and no other (#1393, invariant 13) |
| The links (jsdom, on e3) | `../schematic-links.dom.test.tsx` | The run under the pointer lit — named in `data-lit-link` — none over the bare floor, none under a card that covers it, none once the pointer leaves the canvas, and none while a press's gesture is under way (#1403) |
| The narrowing (jsdom, on e3) | `../schematic-narrowing.dom.test.tsx` | Hidden: a choice leaving the canvas, the counts, the Index, the Backlog, the Choosers and what an item is joined to the racks it holds, a run or a feed whose racks it hides going with them; dimmed: context faded, greyed and taking no tap, out of every list and count, every rack read once whatever the choice, a draft drawn where it stands as context and saved; a match's emphasis and fit; a choice building no builder, hidden or dimmed |
| The carrier (jsdom) | `../schematic-carrier.dom.test.tsx` | `<Schematic>` as the `Schematic` extension through the dispatcher, in its frame; its functions decoded — each kind's rows, the zones' patterns from their rows, `onSelect` writing the whole selection to State, each entity named by its reference, drafts included, and `canConnect`'s words, `none` and a throw |
| IR contract | e3-ui's `test/schematic/schematic.spec.ts` + `.examples.tsx` + `schematic-docs.spec.ts` | The kinds' bindings and refusals, their closed functions over decoded bytes, the payload, examples↔tests parity, doc examples, plugin index |
| The move | `test/schematic-moved.spec.ts` (this package) | east-ui and east-ui-components publish nothing of the Schematic but its slot recipe |
| Visual | the showcase's responsive suite (`east-ui-showcase/tests/responsive/`) | `schematic-frame.spec.ts` — the frame's geometry, the library's pane beside main, the fold ladder at 1440/1024/768/390/360px and a 294px parent, the colours on canvas and cards, the tokens and mono font, inline styles, in both themes; Fit's margin and centring on the data centre and the floor of 20,000 racks in boxes of every shape and on a phone, no two cards overlapping, and Zoom out and Zoom in at Fit and at the limit in the faint ink and not-allowed cursor (#1393); `schematic-editing.spec.ts` — Move and Connect by the mouse and by touch, and a refused end's caption in the danger ink; `schematic-library.spec.ts` — the pane, its tabs and cards, the Index's tree rows and focus ring, the Layers' pick-panel rows, on a desktop and on a phone, its touch targets, in both themes; `schematic-drop.spec.ts` — real drags of a rack template, an owner's card, a fibre template and a backlog row: the caption at the screen's resolution and the card drawn where it said, the canvas's own ground under a drop, a refusal's red caption and cursor, a drop target's card in the brand, in both themes, and the touch tap on a phone; `inspector-form.spec.ts` — the inspector's forms measured beside the Sheet's, the Plan's and the Flowchart's: the drawing, a rack, a run's ends, a feed's sides, a cooling unit's own Details, several, an area read only, a changed field's tint and an issue's row, pinned on a desktop in both themes and overlaid on a phone; `schematic-narrowing.spec.ts` — the rail at every width, with both pointers and in both themes, each source's counts, and context's look as the page computes it; `schematic-window.spec.ts` — the floor of 20,000 racks: its density's words in the footer, inside the rail on a phone, a tap on the density zooming in, the footer then saying nothing, and zoomed in until its racks draw as cards, no two overlapping and a pan leaving which draw as cards as it was (#1393); zoomed into a hall's front rows, the canvas's tier a dot's (`data-lod`), its racks reading their loads by the runs of the window's cells, no key sent, and a pan inside the window reading none (D45); the switch counting the view — past 5,000 racks in it shaded, the footer saying more, and a view of fewer drawn though its window's cells hold more — and the wheel out to Fit shading the floor in the cells it opened in (D49); the minimap drawing the floor's whole density wherever the view is, no rack's dot, and on a phone a quarter of the canvas's width at most; a pan past the window read washing the cells not read, under the grid, the paint and the cards, taking no pointer, following the camera, and gone once the window lands (#1398); `schematic-links.spec.ts` — the colours and the caption font the canvas's probe reads for its links are what the page computes for the Plan's links' parts, at rest and lit, in both themes (#1403); `schematic-phone.spec.ts` — on a phone at 390 and 360px and in a 294px parent, in both themes: the row's rail icon, View and history, nothing to drag, the View's tools without Move or Connect, Details' Position, Connect to… and Delete 44px tap targets inside the pane and Connect to…'s list inside the window; one finger panning and two pinching about their midpoint; a run Connect to… records and a Backlog card's Place through Save and a remount; and in a wide window a box narrowed to 294px and widened again, the selection and the draft kept (#1394); and, under `E3_UI_PERF=1` alone (`schematic-perf.spec.ts`, #1393, SC30, SC42), the floor as seeded and filled to its 50,000 racks through its patch doors: wheeled from Fit to 40× and back, and dragged along its rows where they draw as dots and as cards, no frame over 50 ms and no long animation frame as its windows land; and its first paint at Fit, a window the minimap jumps to at the cards' zoom and a pan into cells not read, each at its p50 and p95; the toolbar sweep (`visual-invariants.spec.ts`), the key search's box 28px and centred in the row beside the Sheet's, the Plan's and the Flowchart's, its popover's 32px (`toolbar-key-search.spec.ts`), the touch targets (`toolbar-touch.spec.ts`), the cold load (`builder-loading.spec.ts`), the data centre's shadows (`foundations.spec.ts`) |

The jsdom files lay the canvas out — its box, pointer capture and the element
at a point — through `../schematic.test-utils.ts`, which also gives them the
camera the canvas fits a drawing with (`fitted`, through `fitView`) and the one
it stands at (`cameraOf`), a world point and a tap there under a camera, a zoom
into a box, and an item's card.

`make build` type-checks this package before vite bundles it
(`pnpm typecheck`, #589); `make lint` runs eslint.
