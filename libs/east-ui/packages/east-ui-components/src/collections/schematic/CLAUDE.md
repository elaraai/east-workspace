# Schematic renderer — architecture & invariants

Consolidated from the #57 P1–P11 comments, the #172 productionisation, and
the #176–#182/#189 feature era (#183 WS8). **Read before changing
`index.tsx`** — every rule here shipped as (or prevented) a real bug.

## Module map

| File | Role |
|---|---|
| `index.tsx` | Composition root: hooks, gesture handlers, DOM/JSX. All React state lives here. |
| `camera.ts` | Pure camera maths + the interaction-mode machine (`nextMode`, `cancelsFly`), rAF coalescer, projector, culling. |
| `paint.ts` | Pure Canvas2D painter + routing/hit geometry (`orthogonalize`, `distanceToPolyline`, `parallelLanes`, label pills, net trunks). |
| `selection.ts` | Pure selection/marquee/slice-composition helpers. |
| `model.ts` | Pure derived model: navigator tree (`buildNavTree`), LOD (`tierSize`, `buildCenterTree`, `declutterTiers`). |
| `theme.tsx` | Palette probe (semantic tokens → concrete colors for canvas paint). |
| `../../theme/slot-recipes/schematic.ts` | ALL styling. No inline styles in `index.tsx` beyond dynamic data bindings (positions, sizes). |

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
   state + `useEffect([value.X])` replace-on-prop-change + compute-next
   OUTSIDE updaters; PURE functional updaters only.

**Local-first editing (the form-input model)**
4. All local edits are overlays REPLACED by a reactive prop change:
   `linkEdits` {created, createdNets, retarget, deleted} on
   `[value.links]`-ish, `itemMoves` on `[value.items]`. The ONE seam into
   the painter is `paintValue` (`{...value, items: movedItems, links:
   effectiveLinks, nets: effectiveNets}`); never feed edits to paint any
   other way. `movedItems` applies UPSTREAM of the working set so centers /
   r-tree / LOD / nav / link+net endpoints follow moves for free.
5. **Declare-before-use is load-bearing**: memos execute during render in
   source order, so an overlay memo must be declared ABOVE its first
   consumer (`paintValue`). The jsdom mount smoke test
   (`schematic.dom.test.tsx`) exists precisely to catch this class.

**Callbacks & selection**
6. Every author callback goes through `dispatchEast(name, run)` —
   queueMicrotask + try/catch + Promise `.catch`. Never call an East
   callback bare, never inside a state updater.
7. ONE selection funnel (`commitSelection`) for every mutation (tap /
   marquee / prev-next / hygiene prune / clear); zone selection mirrors it
   (`commitZoneSelection`). Selection→slice writes are ONE-directional with
   canonical SORTED `in`-sets and an idempotence guard (no write when the
   filter already matches).
8. **Fly BEFORE commit.** A `selectZoomFocus` / nav / marquee fly must be
   initiated before the selection commit — commit-first leaves the fly dead
   (the commit's paint cancels it). `flyTo` is the single fly entry (it
   closes hover, re-aims per frame from the live viewport); gesture-vs-fly
   arbitration is the camera mode machine's job alone.
9. Hit-test = drawing: link/net hit-testing reuses the painter's exact
   routing maths (lanes, orthogonalization, trunk/branch composition). If a
   paint path changes, its hit path changes with it.

**Sessions, nets, hover**
10. Connect sessions key on a stable `net-…` key from gesture start; the
    first Shift-extension upgrades the pairwise link to a NET in place;
    `onCreateLink` always carries `{link, links, net, additive, existing}`
    so upsert-by-key handlers stay simple.
11. Hover is a read-only channel: ignores `readOnly*`, closes on ANY
    camera/edit gesture (pointerdown, wheel, `flyTo`, Esc topmost), opens
    after dwell, grace-closes so the pointer can travel onto the card. All
    hover helpers are dep-free (refs + functional setState) — gesture seams
    must never re-bind on hover churn.

**Perf (#183 WS6)**
12. Budget: ~2,000 items / 200 zones should pan at 60 fps with paint
    < 16 ms — pan/zoom is 3 CSS var writes + one coalesced canvas paint,
    never a per-card React re-layout (invariant 6 of #57).
13. Marquee HITS recompute at most once per animation frame (display-only;
    pointerup recomputes at commit). The frame rect and LOD tiers are
    memoised on their input identities. Anything per-pointermove must be
    O(visible), not O(items).
14. `schematicStress` (examples) is the manual perf probe — 320 items
    through the LOD bands; verify pan/zoom smoothness + declutter behaviour
    in the showcase after paint-path changes (visual snapshots are the
    regression gate; this sandbox cannot run them — use CI).

**A11y (#183 WS7)**
15. The canvas is a focusable `role="application"` surface: arrows step the
    selection via `stepSelection` (fly + select, the prev/next path), Enter
    fires `onItemOpen` on the anchor, ring on `:focus-visible` only.
    Pointer-only gestures must keep a nav-rail / control / callback
    equivalent. Nav rail + controls stay real `<button>`s with labels.

## Testing layers

| Layer | File(s) | Catches |
|---|---|---|
| Pure unit | `camera.test.ts`, `paint.test.ts`, `selection.test.ts`, `model.test.ts` | Geometry, mode machine, LOD, nav tree, slice composition |
| Mount smoke (jsdom) | `schematic.dom.test.tsx` | Hook-graph ordering (TDZ), decode of every root field, prop-replace path |
| IR contract | `east-ui/test/collections/schematic.spec.ts` + `.examples.tsx` | Factory encodings (absent ⇒ `none`), examples↔tests parity, plugin index |
| Visual | showcase snapshots (CI) | Pixel regressions — REQUIRED after paint-path changes |

Vite build does NOT typecheck this package: run
`./node_modules/.bin/tsc -p tsconfig.json --noEmit` (or `make lint`) —
that is the real gate, alongside eslint.
