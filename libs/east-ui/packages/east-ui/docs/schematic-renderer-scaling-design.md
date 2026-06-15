# Schematic renderer — scaling to tens of thousands of shapes (design)

> Status: **DECIDED — single Canvas2D renderer** (see banner). Authored
> 2026-06-15 as a follow-on to issue #49 (shape geometry for zones + item
> footprints). The deck.gl analysis in §2–§9 is **retained as the
> rejected-alternative record**; the binding decision is below.

## DECISION (revised after re-review + spike)

The original recommendation here was **deck.gl** (WebGL). A follow-up product
constraint — *do **not** maintain two full renderers; we want **one** renderer
that internally falls back safely when there's no GPU* — triggered a
four-proposal re-review, which surfaced two facts that flip the call:

1. **Browsers are removing the no-GPU safety net.** Chrome/Edge deprecated
   automatic SwiftShader software-WebGL fallback (security); a no-GPU /
   blocklisted laptop can now get a **null WebGL2 context and render nothing**
   (§3.4). So *any* WebGL renderer (deck.gl, PixiJS, regl) needs a non-GPU
   fallback we build — i.e. a second paint path — which is the exact tax the
   constraint forbids.
2. **Canvas2D is fast enough and needs no GPU.** A profiling spike (50k filled
   polygons, **Skia CPU/software raster — the no-GPU laptop proxy**) measured,
   against a 16.7ms/60fps budget:

   | regime (after cull + LOD) | dpr=1 p95 | dpr=2 p95 |
   |---|---|---|
   | zoomed-out overview (all 50k → **static-bitmap blit**) | **1.8ms** | **5.5ms** |
   | mid zoom (~930 visible, batched) | **0.9ms** | **0.5ms** |
   | mid zoom (~930 visible, *naive/unbatched*) | 1.5ms | 1.3ms |
   | deep zoom (~47 visible) | 0.04ms | 0.04ms |

   3–10× headroom **on the worst machine we'll ever hit**. (The one thing to
   avoid — drawing all 50k as individual marks every frame — measured ~700ms;
   the static-bitmap blit / aggregation replaces it. Spike:
   `packages/east-ui-components/spike/canvas2d-bench.html`.)

**Decision:** a **single Canvas2D renderer** for the schematic drawing layer.
It satisfies "one renderer, safe everywhere" *literally* — no GPU dependency, so
nothing to fall back from, no SwiftShader exposure — holds 60fps at 50k under
software raster, and fixes today's ~12fps SVG/DOM behaviour at 10k. Keep all the
existing brain (R-tree cull, semantic-zoom LOD, declutter, navigator/minimap/
scale-bar, fly-to, selection) and the **rich item cards as DOM** at close zoom;
only the *bulk shapes* (zone/footprint geometry, links, dots/pins) move to a
layered Canvas2D paint (static underlay/zones pre-rendered to an offscreen
bitmap, blitted on pan).

**WebGL is retired to an optional future backend** behind the same backend-
agnostic pipeline — added *only* if a real 100k+ / all-visible / animation use
case appears, at which point it's additive (Canvas2D stays its fallback), not a
rewrite. **deck.gl is not adopted.**

Two follow-through items: (a) **snapshot artifact** — any `<canvas>` serializes
blank into the standalone `.html` (the `.png` is fine; the DOM chrome + visible
cards still serialize); lean to **PNG-only verification for the schematic**.
(b) Validate against real (not synthetic) 50k floorplan data before the cutover;
the one place Canvas2D can break is many *large overlapping* fills (unusual for a
floorplan).

## Implementation status (built 2026-06-15)

The Canvas2D renderer is **implemented** in `east-ui-components`:

- **`collections/schematic/paint.ts`** — pure paint layer (zones rect/hatch +
  polyline/polygon geometry, links with orthogonal/rounded routing, item
  footprints, dot/pin LOD markers, labels). No React/Chakra/DOM → unit-testable
  under any Canvas2D impl. **Verified** by rendering it through Skia
  (`@napi-rs/canvas`) in Node — every path correct, incl. selection state and the
  hatch/band fills.
- **`collections/schematic/theme.tsx`** — token→RGB bridge: hidden Chakra-themed
  probes read via `getComputedStyle`, re-resolved on a light/dark `MutationObserver`.
- **`collections/schematic/index.tsx`** — refactored to a single `<canvas>` + a
  paint effect (repaints on data / camera / LOD / selection / theme change) +
  R-tree picking (footprint point-in-polygon, then nearest dot/pin) with a
  drag-guard. **Rich item cards stay DOM** at card zoom; **all** the existing
  brain is untouched (R-tree cull, semantic-zoom LOD/declutter, navigator,
  minimap, scale bar, viewport-spy, fly-to, selection). The SVG/HTML shape
  rendering is gone — there is now **one** drawing path.

Verified: `build` ✓, `lint` ✓ (both packages), east-ui IR tests ✓; paint output
visually confirmed via node-skia. **Pending CI / a browser env** (this box has no
Playwright browser for Ubuntu 26.04): the in-browser interaction pass (pan/zoom/
select/theme-toggle) and the example `.png` snapshot.

Remaining (follow-ups, non-blocking): the **offscreen static-overview blit** for
the fully-zoomed-out-50k regime (designed; a localized perf add behind the same
paint module); removing the now-dead slot-recipe styles (`zone*`, `footprints`,
`itemDot`, `itemPin`, `underlay`). Note: the **no-GPU gate (§3.4) is moot** —
Canvas2D needs no WebGL2, so there is no capability check or fallback to build.

---

## 1. Why

Issue #49 made `Schematic` zones and item footprints true **polylines /
polygons**, not just rects/points. That changes the cardinality assumptions the
renderer was built on. The current renderer
(`east-ui-components/src/collections/schematic/index.tsx`) paints:

- **items** — culled (RBush R-tree) + semantic-zoom LOD (card → labelled-dot →
  dot) + symmetric-NN declutter. Scales to thousands; only the visible set is
  drawn. ✅
- **item footprints** — inherit the item cull + only draw at *card* tier. ✅
- **zones / zone shapes** — drawn **every frame, un-culled** (`value.zones.map`),
  same for the minimap and the viewport-spy loop. Fine at tens of rooms; a cliff
  at thousands of CAD road/area polylines. ❌
- **links** — also un-culled, but typically few.

Everything is **retained-mode SVG/DOM**: each shape is a DOM node whose screen
coords are recomputed from world coords on every pan/zoom React render. Past a
few thousand simultaneously-visible vector nodes the SVG DOM itself (layout +
paint + React reconciliation) is the bottleneck — exactly the regime CAD
floorplans push us into.

**Target (agreed with product):**

| Dimension | Decision |
|---|---|
| Max simultaneously-loaded shapes | **tens of thousands (10k–50k)** |
| Coordinate model | **abstract world coords + a raster/vector floorplan underlay** (no geospatial/lat-lng) |
| Dependency weight | **heavy dep OK** (this lib is already ~4 MB unminified) |
| Interaction | stays **read-only**: single-click select, pan/zoom/fly-to (no editing/drag) |

## 2. Decision: adopt **deck.gl** for the drawing layer

A cited survey (PixiJS v8, deck.gl, Konva, regl, + alternatives) ranks **deck.gl
#1** for *exactly* this case — tens of thousands of filled polygons + image
underlay + abstract 2D coords + React 19 + read-only GPU picking — because it
ships **all** the hard pieces out of the box, where the alternatives make us
hand-build them:

| Requirement | deck.gl primitive (built-in) |
|---|---|
| Abstract 2D coords + extent | **`OrthographicView`** — top-down XY plane, Cartesian `[x,y]`, `target` + `zoom` (zoom 0 = 1 world-unit/px), `minZoom`/`maxZoom`. Explicitly "for non-geospatial use cases." |
| Pan / drag / wheel-zoom / inertia | **`OrthographicController`** (`controller: true`) — drag-pan, scroll-zoom, keyboard, inertia. |
| Filled polygons | **`SolidPolygonLayer`** (fill primitive; fastest path, no outline overhead) |
| Polylines / outlines | **`PathLayer`** |
| Points / dots | **`ScatterplotLayer`** |
| Polygon + outline together | **`PolygonLayer`** (composite of SolidPolygon + Path) |
| Floorplan underlay | **`BitmapLayer`** — raster at a world-coord bbox, drawn behind shapes |
| Hit-testing at scale | **built-in GPU color-picking** — renders a picking buffer, reads the *one pixel* under the cursor, decodes to object index. No JS ray-cast/octree, no O(n) scan. ~16.7M items/layer, 256 pickable layers → ~330× headroom over 50k. |

deck.gl is **MIT**, on the actively-maintained **v9.x** line (v9.2 Oct 2025,
v9.3.4 Jun 2026), WebGL2 with WebGPU progressively. It also ships an official
headless screenshot/golden-image harness (`SnapshotTestRunner`) — proving the
pattern works headless (it drives Puppeteer; we re-host the same pattern on our
existing Playwright pipeline).

**Ranked alternatives (why not):**

2. **PixiJS v8 + @pixi/react v8** — strong, genuinely React-19-only
   (`peerDependencies.react >= 19.0.0`, excludes 18), WebGL2/WebGPU. But it's a
   low-level 2D engine: camera, LOD/culling, **filled-polygon picking**, and the
   underlay are all glue we'd write. deck.gl gives those for free. Keep as the
   fallback if deck.gl hits a polygon-throughput wall (see §8 R1).
3. **Konva / react-konva** — Canvas2D only, no GPU-instanced path; its own docs
   route high-object-count workloads to PixiJS/WebGL. Disqualified at this scale.
4. **regl / hand-rolled WebGL** — for this *narrow, read-only* case you'd
   re-implement color-picking, culling, tesselation, camera, and the underlay
   that deck.gl already ships. Not worth it unless deck.gl can't hold frame rate
   *and* PixiJS is also rejected.

Full citations in §10.

## 3. Architecture: swap the *drawing layer*, keep everything else

The single most important design choice: **deck.gl replaces only the painting of
shapes.** All the logic and DOM chrome that make the Schematic good stay exactly
as they are.

```
┌─ EastChakraSchematic (React, unchanged orchestrator) ───────────────┐
│  state: view {zoom,tx,ty}, selected, openZone, query, size …        │
│  data:  value.items / value.zones / value.links (East values)       │
│  index: RBush R-tree (cull + LOD declutter)                         │
│                                                                     │
│  ┌─ drawing layer (SWAPPABLE) ──────────────┐   ┌─ DOM chrome ────┐ │
│  │  • SvgDrawing   (today; ≤ N shapes)       │   │ navigator rail  │ │
│  │  • DeckDrawing  (deck.gl; > N shapes)     │   │ minimap         │ │
│  │    BitmapLayer (underlay)                 │   │ zoom controls   │ │
│  │    SolidPolygonLayer (zone/footprint fill)│   │ scale bar       │ │
│  │    PathLayer (outlines, links)            │   │ search          │ │
│  │    ScatterplotLayer (dots)                │   │ selection ring  │ │
│  └───────────────────────────────────────────┘   └─────────────────┘ │
│         deck.gl <canvas> sits UNDER absolutely-positioned DOM        │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.1 Dual renderer (not deck.gl-only)

Keep the **SVG renderer as a first-class fallback**, selected by a threshold:

- **SVG path** (current code) for small drawings (≤ ~2k shapes) **and** for the
  Playwright **`.html` artifact** (see §6 — a WebGL canvas serializes blank into
  `innerHTML`; SVG serializes fully).
- **deck.gl path** above the threshold, **lazy-loaded** (§7) so the base bundle
  is untouched and only large-drawing users pay for it.

Both consume the *same* East value and drive the *same* `view`, selection, and
fly-to. This contains risk (a graceful degrade path), keeps the cheap case cheap,
and solves the blank-HTML + bundle problems at once.

### 3.2 What stays in React/DOM (overlaid on the canvas)

`navigator rail`, `minimap`, `zoom controls`, `scale bar`, `search`, and the
**selection highlight chrome** stay DOM — they're cheap, themable via CSS, and
already built. They read the same `view`/`selected` state. The deck.gl canvas is
`position: absolute; inset: 0; z-index: 0`; chrome sits above it.

### 3.4 No-GPU / no-WebGL2 fallback (load-bearing)

deck.gl — like **any** WebGL/WebGPU engine (PixiJS, regl included) — is
**WebGL2-or-nothing**; it has no internal Canvas2D mode. Critically, the browser
safety net that used to cover GPU-less laptops is **being removed**: as of
mid-2025 Chrome/Edge **deprecated automatic SwiftShader (software WebGL)
fallback** for security (SwiftShader JIT-compiles in the GPU process). The
canonical Chromium doc now says *"automatic fallback to WebGL backed by
SwiftShader has been deprecated and WebGL context creation will soon fail instead
of falling back to SwiftShader"* and directs developers to *"implement fallback
strategies using Canvas2D or other APIs."* `--enable-unsafe-swiftshader` opts
back in but is dev/headless-only and itself deprecating (Edge 144).

⇒ On a GPU-less / GPU-blocklisted machine in a current browser, deck.gl can get a
**null WebGL2 context and render nothing** (not "slow"). This makes the
**SVG renderer non-optional** — it is simultaneously the no-GPU path, the
headless-`.html` path, and the small-drawing fast path. The renderer-selection
gate (§3.1) therefore checks **WebGL2 capability first**, not just shape count:

```
chooseRenderer(shapeCount):
  if !hasWebGL2()                    → "svg"   // no-GPU / blocklisted / context error
  else if shapeCount <= SVG_MAX      → "svg"   // cheap case stays cheap + serializable
  else                               → "deck"  // large + GPU available
```

`hasWebGL2()` = a cached `canvas.getContext('webgl2') != null` probe; additionally
listen for `webglcontextcreationerror` and `webglcontextlost` to **degrade to SVG
at runtime** if the context dies. (Optional: detect software rendering via
`WEBGL_debug_renderer_info` → `UNMASKED_RENDERER` containing
`SwiftShader`/`llvmpipe`/`Software` and prefer SVG for large scenes even when a
slow software context exists — a heuristic, since the extension is privacy-gated
in some browsers.)

Sources: https://github.com/chromium/chromium/blob/main/docs/gpu/swiftshader.md ·
https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM ·
https://chromeenterprise.google/policies/enable-unsafe-swift-shader/

### 3.3 Single source of truth for the camera

Today `view = {zoom, tx, ty}` (screen = world·fit·zoom + t). deck.gl's
`OrthographicView` uses `{target:[x,y], zoom}`. We make **deck.gl's `viewState`
the source of truth** and derive our scale bar / minimap / grid from it (a pure
mapping; see §4.1). The controller handles pan/scroll-zoom/inertia; we add
cursor-anchored zoom + fly-to as `viewState` transitions (§5).

## 4. Mapping our model → deck.gl

### 4.1 Camera / coordinates

| Ours | deck.gl |
|---|---|
| `extent {width,height}` | world bounds; `target` initial = `[width/2, height/2]` |
| `fit = min(sizeW/W, sizeH/H)` | encode as initial `zoom = log2(fit)` |
| `view.zoom` (1 = fit) | `zoom` (additive log2; `zoomΔ = log2(view.zoom)`) |
| `wx/wy` world→screen | handled by `OrthographicViewport`; we stop hand-computing |
| `flyTo(rect)` | `viewState` transition to `target`=rect centre, `zoom`=fit-to-rect |
| scale bar `niceScaleLength(ppu)` | `ppu = 2^zoom`; same nice-number logic |
| minimap viewport rect | derive from `viewport.getBounds()` |

`y`-axis: deck.gl Orthographic `y` is up by default; our world `y` is down
(screen-like). Set the view's `flipY: true` (BitmapLayer/Orthographic support
this) **or** negate `y` in accessors — decided in the spike.

### 4.2 Geometry → layers (from `SchematicGeometryType`)

The East `geometry`/`footprint` variant (`rect | polyline | polygon`) maps to
layer + accessor selection. We **pre-split** the visible set into typed buckets
(memoised on data + cull), one layer each:

- `polygon` (+ `rect` expanded to 4 corners) → **`SolidPolygonLayer`**
  `getPolygon`, `getFillColor` (tone bridge §5.3). Outlines, when wanted, via a
  paired **`PathLayer`** (closed) rather than `PolygonLayer`, to keep the fill on
  the fast primitive.
- `polyline` → **`PathLayer`** `getPath`, `getWidth` (world-space band =
  existing `width` option), `getColor`.
- item anchors / dots → **`ScatterplotLayer`** `getPosition`, `getRadius`,
  `getFillColor`.
- floorplan underlay → **`BitmapLayer`** `image` + `bounds` (§4.4).
- item **cards** (rich: icon · label · meter · metric) stay **DOM** at card tier
  (there are few visible at close zoom); only their *footprint shape* goes to
  deck.gl. This preserves all the existing card styling for free.

### 4.3 Selection / hit-testing

Replace per-shape `onClick` with deck.gl **picking**: layers `pickable:true`;
deck `onClick(info)` → `info.index`/`info.object` → our item/zone key → existing
`setSelected` + `onSelectFn` (still `queueMicrotask`). The R-tree is **no longer
needed for hit-testing** (GPU does point-in-polygon), but we **keep it for
viewport culling + the LOD declutter** (§4.5).

### 4.4 Floorplan underlay

`BitmapLayer` draws a raster (PNG, or a rasterised DXF/SVG) at a world bbox
behind all shape layers. This needs a **new optional field on the East side** —
e.g. `Schematic` root gains `underlay?: { image: string; bounds: [x,y,w,h] }`
(a follow-up to #49's data model; out of scope for the renderer spike but noted
so the IR lands once). Vector DXF/SVG underlays are converted upstream (rasterise
to a tile, or import as `PathLayer`/`SolidPolygonLayer` geometry) — not the
renderer's job.

### 4.5 LOD + culling at scale

deck.gl will happily try to draw all 50k polygons every frame; **we must not let
it**. Reuse the machinery we already have:

- **Cull** with the RBush R-tree to the current viewport bounds (extend it to
  **zones** too — today only items are culled; this is the un-culled axis from
  §1). Feed only visible shapes to the layers' `data`.
- **Semantic-zoom LOD**: at low zoom, *drop sub-pixel shapes* and *simplify*
  polylines/polygons (decimate vertices whose on-screen segment < ~1px;
  Douglas-Peucker on the world path, memoised per shape). At high zoom, full
  detail. This is the lever that keeps filled-polygon throughput in budget
  (§8 R1).
- `updateTriggers` so layers only re-tesselate when the *visible set or LOD
  bucket* changes, not on every pan frame.

## 5. The glue we must write (feasible, but not turnkey)

deck.gl makes all of these straightforward; none are free:

1. **Cursor-anchored wheel zoom** — the controller does scroll-zoom; anchoring
   precisely about the pointer may need a small `onViewStateChange` adjust
   (confirm in spike whether default anchoring suffices).
2. **Animated fly-to** — `viewState` transitions (`transitionDuration` +
   interpolator) targeting a rect; replaces our hand-rolled rAF easing.
3. **Theme bridge** — Chakra v3 colors are CSS custom properties
   (`--colors-status-ok`, light/dark). deck.gl accessors want numeric RGBA. So:
   resolve tokens once via `getComputedStyle(root).getPropertyValue(...)` →
   parse to `[r,g,b,a]`, cache, and **invalidate on theme switch** (Mutation
   Observer on the `.dark` class / `color-scheme`) → bump `updateTriggers` to
   recolour. One small `useThemeColors()` hook.
4. **Chrome ↔ viewState sync** — minimap rect, scale bar length, grid offset,
   viewport-spy all derive from deck's `viewState`/`viewport` instead of our
   `view`.
5. **LOD policy + RBush integration** — §4.5.

Estimated glue: a `DeckDrawing.tsx` (~300–450 lines), a `useThemeColors` hook
(~40), an LOD/simplify util (~120), and the threshold/lazy-load wiring (~40).
The orchestrator, chrome, nav, minimap, selection, and fly-to *callers* are
reused.

## 6. Headless / Playwright snapshot plan

Our pipeline (`scripts/snapshot-capture.mts`) launches `chromium.launch({
headless: true })` with **no GPU flags** and writes a `.png` (real screenshot) +
a self-contained `.html` (`innerHTML` + CSS).

- **`.png` captures the WebGL canvas** ✅ (Playwright screenshot composites the
  page). This is the artifact the *Always visually verify* workflow reads.
- **`.html` would show a blank canvas** ❌ (framebuffer isn't in `innerHTML`).
  → For the schematic, the `.html` artifact uses the **SVG fallback** (§3.1), so
  it stays self-contained; the `.png` shows the real deck.gl output.
- **Software rendering**: headless Chromium uses **SwiftShader (WebGL2)**;
  WebGPU is *not* dependable headless → **target WebGL2** (WebGPU only as
  progressive enhancement). Confirmed both by deck.gl's own docs and Chromium/
  Playwright issues.
- **De-risk the diff**: pin one headless config; generate goldens in the *same*
  env; set a non-zero pixel-diff tolerance; evaluate `--use-gl=angle` /
  `--enable-unsafe-swiftshader` / `--headless=new` for stability.
- **Render-complete signal**: add a `data-schematic-ready` marker (set after the
  first deck.gl `onAfterRender`) for the harness to wait on, mirroring the
  existing `[data-snapshot-boot]` / `.elara-skeleton` waits.

## 7. Bundle / lazy-load plan

- deck.gl is large; the lib is a Vite library build (`minify:false`, es+cjs,
  externalises react/chakra). **Lazy-load** `DeckDrawing` via `React.lazy` /
  dynamic `import()` so deck.gl is a **separate chunk** loaded only when a large
  Schematic mounts. Base bundle and all non-Schematic consumers are unaffected —
  consistent with the existing `platform`/`fonts` entry-split philosophy.
- Pull only the scoped packages (`@deck.gl/core`, `@deck.gl/layers`,
  `@deck.gl/react`), not the geo/aggregation/mapbox bundles.

## 8. Risks & de-risking

- **R1 — filled-polygon throughput is the real unknown (gating).** deck.gl's
  famous "1M @ 60fps" is **points-only** (`ScatterplotLayer`); tesselated filled
  polygons cost more (vertex-shader invocations + overdraw). The realistic
  interactive ceiling for 10k–50k *filled* polygons during pan is **materially
  lower and must be measured**, not assumed. **De-risk:** a benchmark spike (§9
  Phase 0) on representative geometry + the target/CI hardware; prefer
  `SolidPolygonLayer` over `PolygonLayer`; cap vertex counts; lean on LOD +
  culling. If it can't hold frame rate → fall back to PixiJS (#2) with the same
  architecture, not a rewrite.
- **R2 — headless software rendering** differs from GPU output (§6). De-risk:
  pin config, same-env goldens, non-zero tolerance.
- **R3 — theme bridge** (§5.3) is pure glue and unaddressed by any library
  feature; small but real, plus a possible recolour cost at 50k on theme switch
  (measure in spike).

## 9. Phased plan (spike-gated)

**Phase 0 — de-risking spike (1–2 days, throwaway).** Stand up an
`OrthographicView` + `SolidPolygonLayer`/`PathLayer`/`BitmapLayer` with **50k
representative polygons**; measure pan/zoom FPS under real *and* SwiftShader
headless; prototype the theme bridge + picking. **Gate:** holds ~60fps with
LOD/culling → proceed with deck.gl; else evaluate PixiJS. *Answers the open
questions in §11.*

**Phase 1 — MVP drawing parity.** `DeckDrawing` renders zones (rect/polyline/
polygon), item footprints, links, dots from the East value; static `viewState`
from our `view`. SVG path stays default; deck.gl behind a flag.

**Phase 2 — interaction parity.** Controller pan/zoom + cursor-anchored zoom +
fly-to transitions; picking → selection/onSelect; chrome (minimap, scale bar,
grid, spy) driven by `viewState`; theme bridge live.

**Phase 3 — LOD + culling at scale.** RBush cull extended to zones; semantic-zoom
simplify/drop; `updateTriggers` discipline; benchmark 50k.

**Phase 4 — snapshot + threshold + lazy-load.** `data-schematic-ready`; Playwright
flags + tolerance + goldens; the SVG↔deck threshold; lazy chunk; visual-verify
both paths.

**Phase 5 — IR for the underlay** (`Schematic.underlay`) + examples + docs.

Each phase is independently reviewable; Phase 0 gates the whole thing.

## 10. Sources (from the cited survey)

- deck.gl OrthographicView / controller / coordinate systems —
  https://deck.gl/docs/api-reference/core/orthographic-view ·
  https://deck.gl/docs/developer-guide/coordinate-systems
- PolygonLayer / SolidPolygonLayer / PathLayer / BitmapLayer —
  https://deck.gl/docs/api-reference/layers/polygon-layer ·
  https://deck.gl/docs/api-reference/layers/solid-polygon-layer ·
  https://deck.gl/docs/api-reference/layers/bitmap-layer
- GPU picking architecture + limits —
  https://deck.gl/docs/developer-guide/custom-layers/picking ·
  https://deck.gl/docs/developer-guide/performance
- Headless software-render gotcha + snapshot harness —
  https://deck.gl/docs/api-reference/test-utils/snapshot-test-runner ·
  https://issues.chromium.org/issues/40277080 ·
  https://github.com/microsoft/playwright/issues/12683
- Release cadence / maintenance — https://deck.gl/docs/whats-new ·
  https://github.com/visgl/deck.gl/releases
- PixiJS v8 + @pixi/react v8 (React-19-only) —
  https://pixijs.com/blog/pixi-react-v8-live ·
  https://registry.npmjs.org/@pixi/react/latest · https://pixijs.com/blog/pixi-v8-launches
- Konva is Canvas2D, steers scale to WebGL —
  https://konvajs.org/docs/guides/best-canvas-library.html ·
  https://konvajs.org/docs/performance/All_Performance_Tips.html

## 11. Open questions for Phase 0

1. Real interactive FPS for 10k–50k **filled** polygons (representative vertex
   counts/overdraw) during pan/wheel-zoom, on target *and* CI/SwiftShader — at
   what count/zoom does LOD/culling become mandatory to hold 60fps?
2. Is cursor-anchored wheel-zoom + animated fly-to built into the
   OrthographicController/viewState transitions, or glue?
3. Cleanest Chakra-token → RGBA bridge + theme-switch recolour; flash/relayout
   cost at 50k?
4. Exact Chromium/ANGLE/SwiftShader flag combo + pixel-diff tolerance for stable
   Playwright golden diffs?
5. `flipY` vs negate-`y` for our screen-down world axis?

---

### Relationship to issue #49

#49's **data model is renderer-agnostic and ships now**: the
`SchematicGeometryType` variant, zone `geometry`, item `footprint`, the
`rect`/`polyline`/`polygon` factories, and the interim **SVG** rendering. This
WebGL initiative is a **separate, larger effort** that swaps the drawing layer
for scale; it does **not** block #49. The SVG renderer remains the small-drawing
path and the headless-`.html` path indefinitely.
