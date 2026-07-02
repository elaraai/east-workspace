/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType,
    BooleanType,
    FloatType,
    FunctionType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { StatusTokenType } from "../../style/interaction.js";
import { SliceChromeType } from "../../platform/slice/index.js";

/**
 * Theme tone for zone strokes, hatching, and links.
 *
 * @remarks
 * Colour stays theme-owned: data selects a tone and the renderer's recipe
 * maps each tone to its token.
 *
 * @property brand - Brand teal
 * @property ink - Foreground ink
 * @property muted - Muted foreground
 * @property success - Status ok
 * @property warning - Status warn
 * @property danger - Status bad
 */
export const SchematicToneType = VariantType({
    /** Brand teal */
    brand: NullType,
    /** Foreground ink */
    ink: NullType,
    /** Muted foreground */
    muted: NullType,
    /** Status ok */
    success: NullType,
    /** Status warn */
    warning: NullType,
    /** Status bad */
    danger: NullType,
});

/**
 * Type representing schematic tones.
 */
export type SchematicToneType = typeof SchematicToneType;

/**
 * Zone render pattern — each case carries its style configuration.
 *
 * @property outline - Dashed boundary with an eyebrow label (rooms, cells)
 * @property hatch - Hatched band (walkways, aisles, exclusion strips)
 */
export const SchematicZonePatternType = VariantType({
    /** Dashed boundary with an eyebrow label (rooms, cells) */
    outline: StructType({
        /** Stroke tone (default `muted`) */
        tone: OptionType(SchematicToneType),
    }),
    /** Hatched band (walkways, aisles, exclusion strips) */
    hatch: StructType({
        /** Hatch-line tone (default `muted`) */
        tone: OptionType(SchematicToneType),
        /** Line spacing in pixels (default 8) */
        spacing: OptionType(FloatType),
        /** Line angle in degrees (default 45) */
        angle: OptionType(FloatType),
    }),
});

/**
 * Type representing zone patterns.
 */
export type SchematicZonePatternType = typeof SchematicZonePatternType;

/**
 * Link render style — each case carries its stroke configuration.
 *
 * @property solid - A physical run (pipe, conveyor)
 * @property dashed - A routing / logical connection
 */
export const SchematicLinkStyleType = VariantType({
    /** A physical run (pipe, conveyor) */
    solid: StructType({
        /** Stroke tone (default `brand`) */
        tone: OptionType(SchematicToneType),
        /** Stroke width in pixels (default 2.5) */
        weight: OptionType(FloatType),
    }),
    /** A routing / logical connection */
    dashed: StructType({
        /** Stroke tone (default `muted`) */
        tone: OptionType(SchematicToneType),
        /** Stroke width in pixels (default 1.5) */
        weight: OptionType(FloatType),
    }),
});

/**
 * Link routing mode.
 *
 * @remarks
 * `orthogonal` (the default) routes axis-aligned with rounded corners —
 * the conventional pipe-diagram look; `direct` draws straight segments
 * between anchors. `via` waypoints apply in both modes.
 *
 * @property orthogonal - Axis-aligned with rounded corners
 * @property direct - Straight segments between anchors
 */
export const SchematicRouteType = VariantType({
    /** Axis-aligned with rounded corners */
    orthogonal: StructType({
        /** Corner radius in pixels (default 8) */
        corner: OptionType(FloatType),
    }),
    /** Straight segments between anchors */
    direct: NullType,
});

/**
 * Type representing link routing modes.
 */
export type SchematicRouteType = typeof SchematicRouteType;

/**
 * Type representing link styles.
 */
export type SchematicLinkStyleType = typeof SchematicLinkStyleType;

/**
 * A world-coordinate point (used by link waypoints).
 *
 * @property x - World x
 * @property y - World y
 */
export const SchematicPointType = StructType({
    /** World x */
    x: FloatType,
    /** World y */
    y: FloatType,
});

/**
 * Type representing world points.
 */
export type SchematicPointType = typeof SchematicPointType;

/**
 * A polyline / polygon vertex — a world point plus DXF `bulge`.
 *
 * @remarks
 * `bulge` encodes the edge from THIS vertex to the NEXT one: `0` is a
 * straight segment; nonzero is a circular arc where
 * `bulge = tan(includedAngle / 4)` and the sign gives the turn direction
 * (positive = counter-clockwise in world space). One polyline / polygon thus
 * stores true curved kerbs / walls exactly — no flattening into many short
 * segments. For a closed `polygon`, the last vertex's `bulge` applies to the
 * closing edge back to the first vertex.
 *
 * @property x - World x
 * @property y - World y
 * @property bulge - DXF bulge for the edge to the next vertex (0 = straight)
 */
export const SchematicVertexType = StructType({
    /** World x */
    x: FloatType,
    /** World y */
    y: FloatType,
    /** DXF bulge for the edge to the next vertex (0 = straight; `tan(includedAngle / 4)`). */
    bulge: FloatType,
});

/**
 * Type representing a polyline / polygon vertex (world point + DXF bulge).
 */
export type SchematicVertexType = typeof SchematicVertexType;

/**
 * Shared shape geometry for zones (`geometry`) and item footprints
 * (`footprint`) — one variant, four cases.
 *
 * @remarks
 * Geometry is **additive**: a zone keeps its required `x/y/width/height`
 * bounding box and an item keeps its required `x/y` anchor/centroid; the
 * shape, when present, is what the renderer strokes/fills. Absent geometry
 * (`none`) means today's behaviour — a zone is its rect, an item is its
 * point + icon. `circle` centres on the entity anchor (an item's `x/y`, a
 * zone's bbox centre). `polyline` / `polygon` carry {@link SchematicVertexType}
 * vertices in world coords, each with a DXF `bulge`, so curved kerbs / walls
 * are exact (no flattening); all of them paint on the Canvas2D layer, while
 * `rect` keeps the marker fast path.
 *
 * @property rect - Axis-aligned box (zones: the `x/y/width/height` box; items: the point / marker form)
 * @property circle - Circle centred on the entity anchor; `radius` in world units (tanks, silos)
 * @property polyline - Open, arc-aware polyline in world coords; optional world-space band `width`
 * @property polygon - Closed, arc-aware polygon in world coords (>= 3 vertices, auto-closed)
 */
export const SchematicGeometryType = VariantType({
    /** Axis-aligned box — zones use `x/y/width/height`; items, the point / marker form. */
    rect: NullType,
    /** Circle centred on the entity anchor (item `x/y` or zone bbox centre); `radius` in world units. */
    circle: StructType({
        /** Circle radius in world units. */
        radius: FloatType,
    }),
    /** Open, arc-aware polyline in world coords; optional world-space band width. */
    polyline: StructType({
        /** Vertices in world coords, in order (each carries a DXF bulge). */
        vertices: ArrayType(SchematicVertexType),
        /** Optional band width in world units — the stroke widens into a road / aisle. */
        width: OptionType(FloatType),
    }),
    /** Closed, arc-aware polygon in world coords (>= 3 vertices, auto-closed). */
    polygon: StructType({
        /** Boundary vertices in world coords, in order (each carries a DXF bulge). */
        vertices: ArrayType(SchematicVertexType),
    }),
});

/**
 * Type representing shared shape geometry.
 */
export type SchematicGeometryType = typeof SchematicGeometryType;

/**
 * A resolved placed item (node card).
 *
 * @property key - Item identity — links reference it; `onSelect` returns it
 * @property x - World x of the card centre
 * @property y - World y of the card centre
 * @property label - Primary identity line
 * @property sublabel - Optional muted second line (kind / capacity)
 * @property icon - Optional Font Awesome solid icon name
 * @property status - Optional status dot tone
 * @property meter - Optional mini utilisation bar
 * @property metric - Optional live metric text
 * @property width - Optional world width — renders the wide bar form
 * @property footprint - Optional shape footprint; absent ⇒ point + icon (`x/y` stay the anchor/centroid)
 * @property tone - Optional colour override (semantic tone); absent ⇒ `status` drives the colour
 * @property color - Optional raw CSS stroke / marker tint; wins over `tone`
 * @property bg - Optional raw CSS fill for a polygon / circle footprint
 * @property fillOpacity - Optional fill alpha (0–1) for a polygon / circle footprint
 * @property weight - Optional stroke width in px
 */
export const SchematicItemType = StructType({
    /** Item identity — links reference it; `onSelect` returns it */
    key: StringType,
    /** World x of the card centre */
    x: FloatType,
    /** World y of the card centre */
    y: FloatType,
    /** Primary identity line */
    label: StringType,
    /** Optional muted second line (kind / capacity) */
    sublabel: OptionType(StringType),
    /** Optional Font Awesome solid icon name */
    icon: OptionType(StringType),
    /** Optional status dot tone */
    status: OptionType(StatusTokenType),
    /** Optional mini utilisation bar */
    meter: OptionType(StructType({
        /** Current value */
        value: FloatType,
        /** Full-scale value */
        max: FloatType,
    })),
    /** Optional live metric text */
    metric: OptionType(StringType),
    /** Optional world width — renders the wide bar form */
    width: OptionType(FloatType),
    /** Optional shape footprint; absent ⇒ point + icon (`x/y` stay the anchor/centroid) */
    footprint: OptionType(SchematicGeometryType),
    /** Optional colour override (semantic tone); absent ⇒ `status` drives the colour */
    tone: OptionType(SchematicToneType),
    /** Optional raw CSS stroke / marker tint (e.g. `"#2D7FF9"`, `"teal"`); wins over `tone` */
    color: OptionType(StringType),
    /** Optional raw CSS fill for a polygon / circle footprint */
    bg: OptionType(StringType),
    /** Optional fill alpha (0–1) for a polygon / circle footprint */
    fillOpacity: OptionType(FloatType),
    /** Optional stroke width in px */
    weight: OptionType(FloatType),
    /** Optional slice-excluded flag — when a {@link SchematicSliceEffectType}
     * is active, a `some(true)` item is treated as filtered-out (ghosted /
     * hidden per the effect); absent / `some(false)` ⇒ included / normal. */
    excluded: OptionType(BooleanType),
    /** Optional layer membership — the `key` of a {@link SchematicLayerType} in
     * the root `layers`. Hidden when its layer is hidden; absent ⇒ unlayered
     * (always visible). An unknown key is treated as always-visible. */
    layer: OptionType(StringType),
});

/**
 * Type representing resolved placed items.
 */
export type SchematicItemType = typeof SchematicItemType;

/**
 * A resolved annotation zone (room, cell, walkway band).
 *
 * @property key - Zone identity
 * @property label - Mono eyebrow label on the boundary
 * @property x - World x of the top-left corner
 * @property y - World y of the top-left corner
 * @property width - World width
 * @property height - World height
 * @property pattern - Render pattern (`outline` / `hatch`)
 * @property geometry - Optional shape geometry; absent ⇒ rect (`x/y/width/height` stay the bounding box)
 * @property tone - Optional colour override (semantic tone); absent ⇒ the `pattern`'s tone drives the colour
 * @property color - Optional raw CSS stroke tint; wins over `tone`
 * @property bg - Optional raw CSS area fill (opt-in; zones are unfilled by default)
 * @property fillOpacity - Optional fill alpha (0–1) for the area fill
 * @property weight - Optional stroke width in px
 */
export const SchematicZoneType = StructType({
    /** Zone identity */
    key: StringType,
    /** Mono eyebrow label on the boundary */
    label: StringType,
    /** World x of the top-left corner */
    x: FloatType,
    /** World y of the top-left corner */
    y: FloatType,
    /** World width */
    width: FloatType,
    /** World height */
    height: FloatType,
    /** Render pattern (`outline` / `hatch`) */
    pattern: SchematicZonePatternType,
    /** Optional shape geometry; absent ⇒ rect (`x/y/width/height` stay the bounding box) */
    geometry: OptionType(SchematicGeometryType),
    /** Optional colour override (semantic tone); absent ⇒ the `pattern`'s tone drives the colour */
    tone: OptionType(SchematicToneType),
    /** Optional raw CSS stroke tint (e.g. `"#2D7FF9"`, `"teal"`); wins over `tone` */
    color: OptionType(StringType),
    /** Optional raw CSS area fill (opt-in; zones are unfilled by default) */
    bg: OptionType(StringType),
    /** Optional fill alpha (0–1) for the area fill */
    fillOpacity: OptionType(FloatType),
    /** Optional stroke width in px */
    weight: OptionType(FloatType),
    /** Optional layer membership — the `key` of a {@link SchematicLayerType};
     * hidden when its layer is hidden. Absent ⇒ unlayered (always visible). */
    layer: OptionType(StringType),
});

/**
 * Type representing resolved zones.
 */
export type SchematicZoneType = typeof SchematicZoneType;

/**
 * A resolved link between two placed items.
 *
 * @property key - Link identity
 * @property from - Source item key
 * @property to - Destination item key
 * @property label - Optional mid-path label (name / flow description)
 * @property metric - Optional mid-path metric readout (muted, after the label)
 * @property style - Render style (`solid` / `dashed`, with stroke config)
 * @property route - Routing mode (`orthogonal` / `direct`)
 * @property via - Optional world-coordinate waypoints, in order
 */
export const SchematicLinkType = StructType({
    /** Link identity */
    key: StringType,
    /** Source item key */
    from: StringType,
    /** Destination item key */
    to: StringType,
    /** Optional label rendered mid-path (a name / flow description); hidden when zoomed out past the label band */
    label: OptionType(StringType),
    /** Optional metric rendered after the label mid-path (a rate / capacity readout), muted */
    metric: OptionType(StringType),
    /** Render style (`solid` / `dashed`, with stroke config) */
    style: SchematicLinkStyleType,
    /** Routing mode (`orthogonal` / `direct`) */
    route: SchematicRouteType,
    /** Optional world-coordinate waypoints, in order */
    via: ArrayType(SchematicPointType),
    /** Optional layer membership — the `key` of a {@link SchematicLayerType};
     * hidden when its layer is hidden (a link also vanishes when either endpoint
     * item is hidden). Absent ⇒ unlayered (always visible). */
    layer: OptionType(StringType),
});

/**
 * Type representing resolved links.
 */
export type SchematicLinkType = typeof SchematicLinkType;

/**
 * Positive emphasis applied to the remaining (matched) items when a
 * {@link SchematicSliceEffectType} is active.
 *
 * @remarks
 * `halo` draws a static highlight ring behind each matched marker / card;
 * `pulse` animates that ring (a slow breathing glow) to pull the eye to the
 * survivors. `pulse` runs a lightweight animation loop; `halo` repaints on the
 * normal frame path.
 *
 * @property halo - Static highlight ring on matched items
 * @property pulse - Animated pulse ring on matched items
 */
export const SchematicEmphasisType = VariantType({
    /** Static highlight ring on matched items. */
    halo: NullType,
    /** Animated pulse ring on matched items. */
    pulse: NullType,
});

/**
 * Type representing the matched-item emphasis style.
 */
export type SchematicEmphasisType = typeof SchematicEmphasisType;

/**
 * Optional slice-driven render effect — how the Schematic treats items once a
 * bound slice narrows them, instead of the default "hidden completely". A flat
 * bag of independently-optional settings, mirroring the flat `sliceHidden` /
 * `sliceOpacity` / `sliceEmphasis` / … config props (each driven statically or
 * reactively via `SubtypeExprOrValue`).
 *
 * @remarks
 * Feed the **full** item set (not `Slice.rows`) and mark each item's `excluded`
 * flag (e.g. via `Slice.partition`, or `Slice.apply.matches(...).not()`).
 * `hidden` removes the filtered-out items entirely (else they stay as context);
 * `opacity` / `desaturate` / `dot` de-emphasise the kept ones; `emphasis`
 * highlights the remainder; `frame` boxes the matched set and `frameFit` also
 * flies the camera to it. Every field absent is a no-op.
 *
 * @property hidden - Remove filtered-out items entirely; absent / `some(false)` ⇒ keep as context
 * @property opacity - Fade alpha (0–1) for kept filtered-out items; absent ⇒ full
 * @property desaturate - Drain kept filtered-out items' colour to grey
 * @property dot - Collapse kept filtered-out items to a bare dot
 * @property emphasis - Positive emphasis on matched items (absent ⇒ none)
 * @property frame - Draw a bounding frame around the matched set
 * @property frameFit - Auto-fit the camera to the matched frame when the set changes
 */
export const SchematicSliceEffectType = StructType({
    /** Remove filtered-out items entirely; absent / `some(false)` ⇒ keep as context. */
    hidden: OptionType(BooleanType),
    /** Fade alpha (0–1) for kept filtered-out items; absent ⇒ full. */
    opacity: OptionType(FloatType),
    /** Drain kept filtered-out items' colour to grey. */
    desaturate: OptionType(BooleanType),
    /** Collapse kept filtered-out items to a bare dot (drop card / label / footprint). */
    dot: OptionType(BooleanType),
    /** Positive emphasis on matched items; absent ⇒ none. */
    emphasis: OptionType(SchematicEmphasisType),
    /** Draw a bounding frame around the matched set. */
    frame: OptionType(BooleanType),
    /** Auto-fit the camera to the matched frame when the matched set changes. */
    frameFit: OptionType(BooleanType),
});

/**
 * Type representing the slice-driven render effect.
 */
export type SchematicSliceEffectType = typeof SchematicSliceEffectType;

/**
 * A named layer — a cross-cutting group of items / zones / links that can be
 * shown, hidden, isolated (solo), locked, or dimmed together via the canvas
 * layer button.
 *
 * @remarks
 * Membership is by `key`: an entity's `layer` field names the layer it belongs
 * to. Layer visibility / lock are VIEW state (owned by the renderer, persisted
 * per panel); the `visible` / `locked` here are the AUTHOR defaults the user's
 * toggles override. `opacity` dims the layer's items (markers / footprints) in
 * v1 (zone / link dimming is not yet applied). `tone` colours the panel swatch
 * (theme-owned). Membership is strictly per-entity — hiding a container zone
 * does not hide the items geometrically inside it.
 *
 * @property key - Layer identity — entities reference it via their `layer` field
 * @property label - Display name shown in the layer panel
 * @property visible - Author default visibility; absent / `some(true)` ⇒ shown, `some(false)` ⇒ ships hidden
 * @property locked - Author default lock (non-selectable); absent ⇒ unlocked
 * @property opacity - Optional item dim (0–1) for the layer's items; absent ⇒ full
 * @property tone - Optional panel swatch tone
 */
export const SchematicLayerType = StructType({
    /** Layer identity — entities reference it via their `layer` field. */
    key: StringType,
    /** Display name shown in the layer panel. */
    label: StringType,
    /** Author default visibility; `some(false)` ships hidden, absent ⇒ shown. */
    visible: OptionType(BooleanType),
    /** Author default lock (non-selectable); absent ⇒ unlocked. */
    locked: OptionType(BooleanType),
    /** Optional item dim (0–1) for the layer's items; absent ⇒ full. */
    opacity: OptionType(FloatType),
    /** Optional panel swatch tone. */
    tone: OptionType(SchematicToneType),
});

/**
 * Type representing a schematic layer.
 */
export type SchematicLayerType = typeof SchematicLayerType;

/**
 * Selection cardinality for the Schematic. Absent on the root ⇒ `single`.
 *
 * @remarks
 * `single` keeps today's behaviour — one selected item at a time, no
 * marquee. `multiple` is the multi-select mode: it reveals a marquee tool
 * in a second control group, where a plain tap / box **replaces** the
 * selection and **Shift**+tap / **Shift**+box **extend** it (Shift-tap
 * toggles a single item; Shift-box unions). Esc / the clear button reset.
 *
 * @property single - At most one item selected; tap replaces (default; no marquee)
 * @property multiple - Multi-select; tap / box replace, Shift+tap / Shift+box extend
 */
export const SchematicSelectionModeType = VariantType({
    /** At most one item selected; tap replaces (default; no marquee). */
    single: NullType,
    /** Multi-select; tap / box replace, Shift+tap toggles and Shift+box unions. */
    multiple: NullType,
});

/**
 * Type representing the Schematic selection cardinality.
 */
export type SchematicSelectionModeType = typeof SchematicSelectionModeType;

/**
 * A world-coordinate rectangle swept by a marquee gesture — matches the
 * box handed to the spatial index, so coordinates are world units.
 *
 * @property minX - Left edge (world units)
 * @property minY - Top edge (world units)
 * @property maxX - Right edge (world units)
 * @property maxY - Bottom edge (world units)
 */
export const SchematicRegionType = StructType({
    /** Left edge (world units). */
    minX: FloatType,
    /** Top edge (world units). */
    minY: FloatType,
    /** Right edge (world units). */
    maxX: FloatType,
    /** Bottom edge (world units). */
    maxY: FloatType,
});

/**
 * Type representing a swept marquee region.
 */
export type SchematicRegionType = typeof SchematicRegionType;

/**
 * Selection-set change event — the Schematic analogue of Table's
 * `TableRowSelectionEventType`. Passed to `onSelectionChange` whenever the
 * selected set changes (a tap, a marquee sweep, or a clear).
 *
 * @remarks
 * `key` is `some` for a single-item tap and `none` for a bulk marquee or a
 * clear. `selectedKeys` is always the FULL selection after the gesture (the
 * spatial analogue of `selectedRowsIndices`). `region` is `some` only for a
 * marquee sweep.
 *
 * @property key - The item that triggered the change (some for a tap; none for marquee / clear)
 * @property selected - Whether `key` is now selected (for a tap); for bulk changes, whether the set is non-empty
 * @property selectedKeys - The full selected set after the gesture
 * @property additive - Whether the gesture added to the prior selection (true) or replaced it (false)
 * @property region - The world rectangle a marquee swept (some for a marquee; none for tap / clear)
 */
export const SchematicSelectionEventType = StructType({
    /** The item that triggered the change (some for a tap; none for marquee / clear). */
    key: OptionType(StringType),
    /** Whether `key` is now selected (tap); for bulk changes, whether the set is non-empty. */
    selected: BooleanType,
    /** The full selected set after the gesture. */
    selectedKeys: ArrayType(StringType),
    /** Whether the gesture added to the prior selection (true) or replaced it (false). */
    additive: BooleanType,
    /** The world rectangle a marquee swept (some for a marquee; none for tap / clear). */
    region: OptionType(SchematicRegionType),
});

/**
 * Type representing a Schematic selection-set change event.
 */
export type SchematicSelectionEventType = typeof SchematicSelectionEventType;

/**
 * Viewport-settled event — the camera zoom plus the visible world rectangle,
 * reported (debounced) after a pan / zoom / fly / resize settles. Passed to
 * `onViewportChange` so hosts can sync external UI, lazy-load data for the
 * visible region, or persist the view.
 *
 * @property zoom - The settled camera zoom (1 = fully zoomed out)
 * @property minX - Left edge of the visible world rect
 * @property minY - Top edge of the visible world rect
 * @property maxX - Right edge of the visible world rect
 * @property maxY - Bottom edge of the visible world rect
 */
export const SchematicViewportEventType = StructType({
    /** The settled camera zoom (1 = fully zoomed out). */
    zoom: FloatType,
    /** Left edge of the visible world rect. */
    minX: FloatType,
    /** Top edge of the visible world rect. */
    minY: FloatType,
    /** Right edge of the visible world rect. */
    maxX: FloatType,
    /** Bottom edge of the visible world rect. */
    maxY: FloatType,
});

/**
 * Type representing a Schematic viewport-settled event.
 */
export type SchematicViewportEventType = typeof SchematicViewportEventType;

/**
 * Zone (area) selection-set change event — the zone analogue of
 * `SchematicSelectionEventType`, passed to `onZoneSelectionChange` whenever
 * the selected ZONE set changes (a tap on a zone body, a nav-rail zone click,
 * or a clear).
 *
 * @remarks
 * `childItemKeys` reports the items sitting **inside** the selected zones —
 * an item counts when its innermost containing zone, or any of that zone's
 * ancestors, is selected (so selecting a hall includes items in its nested
 * cells). Items always take hit-test precedence: tapping an item never
 * selects its host zone.
 *
 * @property key - The zone that triggered the change (some for a tap; none for a clear)
 * @property selected - Whether `key` is now selected; for bulk changes, whether the set is non-empty
 * @property selectedKeys - The full selected zone set after the gesture
 * @property childItemKeys - Item keys inside the selected zones (nested descendants included)
 * @property additive - Whether the gesture added to the prior selection (true) or replaced it (false)
 */
export const SchematicZoneSelectionEventType = StructType({
    /** The zone that triggered the change (some for a tap; none for a clear). */
    key: OptionType(StringType),
    /** Whether `key` is now selected (tap); for bulk changes, whether the set is non-empty. */
    selected: BooleanType,
    /** The full selected zone set after the gesture. */
    selectedKeys: ArrayType(StringType),
    /** Item keys inside the selected zones (nested descendants included). */
    childItemKeys: ArrayType(StringType),
    /** Whether the gesture added to the prior selection (true) or replaced it (false). */
    additive: BooleanType,
});

/**
 * Type representing a Schematic zone selection-set change event.
 */
export type SchematicZoneSelectionEventType = typeof SchematicZoneSelectionEventType;

/**
 * Link-gesture mode for the connect tool. Absent on the root ⇒ `draw`.
 *
 * @remarks
 * `draw`: a committed connect gesture adds a **physical link** to the
 * renderer's local link state (the form-input model — works with no callback
 * wired), and `onCreateLink` fires in addition. `connect`: the gesture is a
 * **pure connection event** — nothing is added; only `onCreateLink` fires
 * (with the pair, the accumulated session, and any existing links between the
 * endpoints), and the gesture stays repeatable — the channel for planning
 * operations between plant areas rather than drawing pipes.
 *
 * @property draw - The gesture draws a physical link (local-state-first)
 * @property connect - The gesture only fires the event (nothing added; repeatable)
 */
export const SchematicLinkModeType = VariantType({
    /** The gesture draws a physical link (local-state-first). */
    draw: NullType,
    /** The gesture only fires the event (nothing added; repeatable). */
    connect: NullType,
});

/**
 * Type representing the Schematic link-gesture mode.
 */
export type SchematicLinkModeType = typeof SchematicLinkModeType;

/**
 * One connection's endpoints — the unit a connect gesture produces.
 *
 * @property key - Renderer-generated key for the gesture's connection
 * @property from - Source item key
 * @property to - Destination item key
 */
export const SchematicLinkEndpointsType = StructType({
    /** Renderer-generated key for the gesture's connection. */
    key: StringType,
    /** Source item key. */
    from: StringType,
    /** Destination item key. */
    to: StringType,
});

/**
 * Type representing a connect gesture's endpoints.
 */
export type SchematicLinkEndpointsType = typeof SchematicLinkEndpointsType;

/**
 * A connect-session collapsed to net endpoints — carried on every
 * `onCreateLink` so handlers can upsert ONE net per session.
 *
 * @remarks
 * `key` is the SESSION key, stable across all of a session's commits: the
 * plain drag and every Shift-extension report the same `key` with the
 * accumulated `sources` (distinct froms) and `destinations` (distinct tos).
 *
 * @property key - The session key (stable across the session's commits)
 * @property sources - Distinct source item keys so far
 * @property destinations - Distinct destination item keys so far
 */
export const SchematicNetEndpointsType = StructType({
    /** The session key (stable across the session's commits). */
    key: StringType,
    /** Distinct source item keys so far. */
    sources: ArrayType(StringType),
    /** Distinct destination item keys so far. */
    destinations: ArrayType(StringType),
});

/**
 * Type representing a session's net endpoints.
 */
export type SchematicNetEndpointsType = typeof SchematicNetEndpointsType;

/**
 * A net — a manifold / bus link joining MANY sources to MANY destinations as
 * ONE entity, rendered as a trunk with per-endpoint branches.
 *
 * @remarks
 * Use a net when the real topology is a shared run (a CIP manifold feeding
 * 30 units, a header bridging two banks) — one row instead of a pairwise
 * `links` explosion. The trunk routes like a link (`route`, with `via` as
 * TRUNK waypoints); each source branches into the trunk head, each
 * destination off the tail. A branch drops when its endpoint item is hidden
 * (layer / slice-hide); the whole net hides when either side empties, or
 * when its own `layer` is hidden.
 *
 * @property key - Net identity (participates in link selection / deletion)
 * @property sources - Source item keys (the feeding side)
 * @property destinations - Destination item keys (the fed side)
 * @property label - Optional mid-trunk label (name / flow description)
 * @property metric - Optional mid-trunk metric readout (muted, after the label)
 * @property style - Render style (`solid` / `dashed`) — one stroke for the whole net
 * @property route - Trunk routing mode (`orthogonal` / `direct`)
 * @property via - Optional world-coordinate TRUNK waypoints, in order
 * @property layer - Optional layer membership — hidden when its layer is hidden
 */
export const SchematicNetType = StructType({
    /** Net identity (participates in link selection / deletion) */
    key: StringType,
    /** Source item keys (the feeding side) */
    sources: ArrayType(StringType),
    /** Destination item keys (the fed side) */
    destinations: ArrayType(StringType),
    /** Optional label rendered mid-trunk */
    label: OptionType(StringType),
    /** Optional metric rendered after the label mid-trunk, muted */
    metric: OptionType(StringType),
    /** Render style (`solid` / `dashed`, with stroke config) */
    style: SchematicLinkStyleType,
    /** Trunk routing mode (`orthogonal` / `direct`) */
    route: SchematicRouteType,
    /** Optional world-coordinate trunk waypoints, in order */
    via: ArrayType(SchematicPointType),
    /** Optional layer membership — hidden when its layer is hidden */
    layer: OptionType(StringType),
});

/**
 * Type representing a net (manifold / bus link).
 */
export type SchematicNetType = typeof SchematicNetType;

/**
 * Link-creation event passed to `onCreateLink` on every committed connect
 * gesture.
 *
 * @remarks
 * Connect gestures build a **session**: a plain drag starts a new session
 * (one connection); a **Shift**+drag ADDS to the open session — mirroring
 * Shift = "extend the set" in the selection modes — so an operation relating
 * MORE than two items is built one visual link at a time. The event always
 * carries the newest `link`, the FULL accumulated `links` session (newest
 * included), whether the gesture was `additive` (Shift), and the keys of
 * `existing` links already joining the newest pair (either direction).
 *
 * @property link - The newest connection (this drag)
 * @property links - The full session set, `link` included (length 1 for a plain drag)
 * @property net - The session collapsed to net endpoints (stable session `key` — upsert-friendly)
 * @property additive - True when Shift extended an open session
 * @property existing - Keys of links already joining the newest from↔to (either direction)
 */
export const SchematicLinkCreateEventType = StructType({
    /** The newest connection (this drag). */
    link: SchematicLinkEndpointsType,
    /** The full session set, `link` included (length 1 for a plain drag). */
    links: ArrayType(SchematicLinkEndpointsType),
    /** The session collapsed to net endpoints — upsert ONE net per session by `net.key`. */
    net: SchematicNetEndpointsType,
    /** True when Shift extended an open session. */
    additive: BooleanType,
    /** Keys of links already joining the newest from↔to (either direction). */
    existing: ArrayType(StringType),
});

/**
 * Type representing a link-creation (connect gesture) event.
 */
export type SchematicLinkCreateEventType = typeof SchematicLinkCreateEventType;

/**
 * Link-edit event passed to `onEditLink` after an endpoint connector is
 * dragged to a new item.
 *
 * @property key - The edited link's key
 * @property from - Source item key AFTER the re-target
 * @property to - Destination item key AFTER the re-target
 */
export const SchematicLinkEditEventType = StructType({
    /** The edited link's key. */
    key: StringType,
    /** Source item key AFTER the re-target. */
    from: StringType,
    /** Destination item key AFTER the re-target. */
    to: StringType,
});

/**
 * Type representing a link-edit (re-target) event.
 */
export type SchematicLinkEditEventType = typeof SchematicLinkEditEventType;

/**
 * Item-move event passed to `onMoveItem` when a move-tool drag releases.
 *
 * @remarks
 * When the dragged item is part of the current selection the WHOLE selection
 * moves rigidly — `keys` lists every moved item (the pressed `key` included)
 * and `dx`/`dy` is the shared world delta; `x`/`y` is the pressed item's
 * final position. Fired once per gesture, on release.
 *
 * @property key - The pressed (dragged) item's key
 * @property x - The pressed item's final world x
 * @property y - The pressed item's final world y
 * @property keys - Every item moved by the gesture (`key` included)
 * @property dx - The gesture's world x delta (applies to all `keys`)
 * @property dy - The gesture's world y delta (applies to all `keys`)
 */
export const SchematicItemMoveEventType = StructType({
    /** The pressed (dragged) item's key. */
    key: StringType,
    /** The pressed item's final world x. */
    x: FloatType,
    /** The pressed item's final world y. */
    y: FloatType,
    /** Every item moved by the gesture (`key` included). */
    keys: ArrayType(StringType),
    /** The gesture's world x delta (applies to all `keys`). */
    dx: FloatType,
    /** The gesture's world y delta (applies to all `keys`). */
    dy: FloatType,
});

/**
 * Type representing an item-move event.
 */
export type SchematicItemMoveEventType = typeof SchematicItemMoveEventType;



/**
 * East StructType for the Schematic component.
 *
 * @remarks
 * A 2D world-coordinate canvas for placing real-world entities (tanks,
 * bays, lines, cells) plus annotation zones and links, all from flat data
 * tables. Interaction is **selection-only** — single-click selection plus,
 * when `selectionMode` is `multiple` / `range`, a marquee tool that selects
 * a region; there is no drag & drop and editing routes through the linked
 * Library. Selection is reported via `onSelect` (single key) and
 * `onSelectionChange` (the full set).
 *
 * @property extent - World-coordinate bounds (the canvas scales to fit)
 * @property items - The placed items
 * @property zones - Annotation zones (rooms, cells, walkway bands)
 * @property links - Connections between items, addressed by key
 * @property nets - Optional manifold / bus links (many sources → many destinations)
 * @property scaleUnit - Optional unit for the bottom-right scale bar
 * @property grid - Metric grid aligned to the scale legend
 * @property navigator - Navigator rail (zones → items TOC)
 * @property minimap - Minimap with the viewport rectangle
 * @property slice - Optional Slice chrome rail mounting the affordances
 * @property sliceEffect - Optional slice-driven render effect (ghost / emphasis / frame)
 * @property layers - Optional named layers (visibility / solo / lock / dim via the layer button)
 * @property height - Optional fixed panel height (any CSS length)
 * @property onSelect - Optional item-click callback (receives the item key)
 * @property selectionMode - Optional selection cardinality (single / multiple); absent ⇒ single
 * @property onSelectionChange - Optional selection-set change callback (receives the full set)
 * @property sliceSelectField - Optional bound-slice fieldId driven with an `in` filter of the selected item keys
 * @property selectZoomFocus - When true, a canvas selection also moves the camera (single tap flies, marquee fits); default false
 * @property onViewportChange - Optional debounced viewport-settled callback (zoom + visible world rect)
 * @property onItemOpen - Optional item double-click (drill-in) callback (receives the item key)
 * @property onSelectZone - Optional zone-click callback (receives the zone key)
 * @property onZoneSelectionChange - Optional zone selection-set change callback (zones + their child items)
 * @property linkMode - Optional connect-gesture mode (`draw` | `connect`); absent ⇒ draw
 * @property onCreateLink - Optional link-creation callback (newest link + session + existing links)
 * @property onSelectLink - Optional link-click callback (receives the link key)
 * @property onEditLink - Optional link re-target callback (endpoints after the edit)
 * @property onDeleteLink - Optional link-delete callback (receives the link key)
 * @property readOnly - Master read-only switch for ALL editing; absent ⇒ false
 * @property readOnlyLinks - Read-only for link editing only; absent ⇒ false
 * @property readOnlyItems - Read-only for item editing only; absent ⇒ false
 * @property onMoveItem - Optional item-move callback (final position + moved keys + shared delta)
 */
export const SchematicRootType = StructType({
    /** World-coordinate bounds (the canvas scales to fit) */
    extent: StructType({
        /** World width */
        width: FloatType,
        /** World height */
        height: FloatType,
    }),
    /** The placed items */
    items: ArrayType(SchematicItemType),
    /** Annotation zones (rooms, cells, walkway bands) */
    zones: ArrayType(SchematicZoneType),
    /** Connections between items, addressed by key */
    links: ArrayType(SchematicLinkType),
    /** Optional nets — manifold / bus links (many sources → many destinations, drawn as a trunk with branches) */
    nets: ArrayType(SchematicNetType),
    /** Optional unit for the bottom-right scale bar */
    scaleUnit: OptionType(StringType),
    /** Metric grid aligned to the scale legend; default on */
    grid: OptionType(BooleanType),
    /** Navigator rail (zones → items TOC); default: shown when zones exist */
    navigator: OptionType(BooleanType),
    /** Minimap with the viewport rectangle; default: shown for large canvases */
    minimap: OptionType(BooleanType),
    /** Optional Slice chrome — a full-width top-edge rail mounting the affordances (replaces the built-in search) */
    slice: OptionType(SliceChromeType),
    /** Optional slice-driven render effect — ghost / desaturate / shrink filtered-out items and emphasise the remainder (halo / pulse / frame); absent ⇒ excluded items are hidden completely */
    sliceEffect: OptionType(SchematicSliceEffectType),
    /** Optional named layers — cross-cutting groups toggled (visibility / solo / lock / dim) from the canvas layer button; absent ⇒ no layer chrome */
    layers: OptionType(ArrayType(SchematicLayerType)),
    /** Optional fixed panel height (any CSS length, e.g. `"400px"`); default: aspect-driven, capped at 75vh */
    height: OptionType(StringType),
    /** Optional item-click callback (receives the item key) */
    onSelect: OptionType(FunctionType([StringType], NullType)),
    /** Optional selection cardinality (single / multiple / range); absent ⇒ single (no selection chrome) */
    selectionMode: OptionType(SchematicSelectionModeType),
    /** Optional selection-set change callback — fired on any tap / marquee / clear with the full selected set */
    onSelectionChange: OptionType(FunctionType([SchematicSelectionEventType], NullType)),
    /** Optional bound-slice fieldId that selection drives with an `in` filter of the selected item keys (requires a bound `slice`); absent ⇒ selection leaves the slice untouched. Best paired with the ghost `sliceEffect` (items kept) rather than a `Slice.rows` feed on the SAME slice, which would hide the non-selected. */
    sliceSelectField: OptionType(StringType),
    /** When true, a canvas selection also moves the camera — a single tap flies to the item, a marquee fits to the selected set — regardless of `selectionMode`; default false (selection never moves the camera). The navigator rail + prev/next always fly. */
    selectZoomFocus: OptionType(BooleanType),
    /** Optional viewport-settled callback — fired (debounced) with the zoom + visible world rect after a pan / zoom / fly / resize settles; never per-frame */
    onViewportChange: OptionType(FunctionType([SchematicViewportEventType], NullType)),
    /** Optional item-open callback (receives the item key) — fired on double-click / double-tap of an item (the drill-in affordance); a background double-click keeps Fit / reset */
    onItemOpen: OptionType(FunctionType([StringType], NullType)),
    /** Optional zone-click callback (receives the zone key) — the single-key channel, parallel to `onSelect`; items take hit-test precedence over zones */
    onSelectZone: OptionType(FunctionType([StringType], NullType)),
    /** Optional zone selection-set change callback — fired on any zone tap / nav zone click / clear with the full selected zone set AND their child items */
    onZoneSelectionChange: OptionType(FunctionType([SchematicZoneSelectionEventType], NullType)),
    /** Optional link-gesture mode for the connect tool (`draw` adds a physical link locally; `connect` is event-only and repeatable); absent ⇒ draw */
    linkMode: OptionType(SchematicLinkModeType),
    /** Optional link-creation callback — fired on every committed connect gesture with the newest link, the accumulated Shift-session, and the pair's existing links */
    onCreateLink: OptionType(FunctionType([SchematicLinkCreateEventType], NullType)),
    /** Optional link-click callback (receives the link key) — the link analogue of `onSelect` */
    onSelectLink: OptionType(FunctionType([StringType], NullType)),
    /** Optional link-edit callback — fired after an endpoint connector is dragged to a new item, with the endpoints AFTER the re-target */
    onEditLink: OptionType(FunctionType([SchematicLinkEditEventType], NullType)),
    /** Optional link-delete callback (receives the deleted link's key) */
    onDeleteLink: OptionType(FunctionType([StringType], NullType)),
    /** Master read-only switch — disables ALL editing affordances (the connect tool, connectors, delete; future item / zone editing); absent ⇒ false */
    readOnly: OptionType(BooleanType),
    /** Per-domain read-only: disables LINK editing only (connect tool, connectors, delete); effective = `readOnly || readOnlyLinks`; absent ⇒ false */
    readOnlyLinks: OptionType(BooleanType),
    /** Per-domain read-only: disables ITEM editing only (the move tool / drag-to-reposition); effective = `readOnly || readOnlyItems`; absent ⇒ false */
    readOnlyItems: OptionType(BooleanType),
    /** Optional item-move callback — fired once per move-tool gesture on release, with the pressed item's final position, every moved key (group move rides the selection), and the shared world delta */
    onMoveItem: OptionType(FunctionType([SchematicItemMoveEventType], NullType)),
});

/**
 * Type representing the Schematic component.
 */
export type SchematicRootType = typeof SchematicRootType;
