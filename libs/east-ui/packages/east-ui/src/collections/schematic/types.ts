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
    /** Render style (`solid` / `dashed`, with stroke config) */
    style: SchematicLinkStyleType,
    /** Routing mode (`orthogonal` / `direct`) */
    route: SchematicRouteType,
    /** Optional world-coordinate waypoints, in order */
    via: ArrayType(SchematicPointType),
});

/**
 * Type representing resolved links.
 */
export type SchematicLinkType = typeof SchematicLinkType;

/**
 * How a slice-excluded item (its `excluded` flag `some(true)`) renders when a
 * {@link SchematicSliceEffectType} is active.
 *
 * @remarks
 * `hide` drops the item entirely — the default, and today's behaviour when
 * data is pre-narrowed through `Slice.rows`. `keep` retains the item as spatial
 * context, with optional, composable de-emphasis: `opacity` fades it,
 * `desaturate` drains its colour to grey, and `dot` collapses it to a bare
 * marker (dropping its card / label / footprint) so survivors dominate. A
 * `keep` with no modifiers leaves the item at full styling — a pure
 * "emphasise the remainder" effect.
 *
 * @property hide - Remove excluded items entirely (the default)
 * @property keep - Retain excluded items, optionally de-emphasized
 */
export const SchematicExcludedStyleType = VariantType({
    /** Remove excluded items entirely (the default). */
    hide: NullType,
    /** Retain excluded items, optionally de-emphasized. */
    keep: StructType({
        /** Fade alpha (0–1) for excluded items; absent ⇒ full opacity. */
        opacity: OptionType(FloatType),
        /** Drain excluded items' colour to grey. */
        desaturate: OptionType(BooleanType),
        /** Collapse excluded items to a bare dot (drop card / label / footprint). */
        dot: OptionType(BooleanType),
    }),
});

/**
 * Type representing the excluded-item render style.
 */
export type SchematicExcludedStyleType = typeof SchematicExcludedStyleType;

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
 * A bounding frame drawn around the matched-item set.
 *
 * @property fit - Auto-fit the camera to the matched extent when it changes
 */
export const SchematicFrameType = StructType({
    /** Auto-fit the camera to the matched extent when the matched set changes. */
    fit: OptionType(BooleanType),
});

/**
 * Type representing the matched-set bounding frame.
 */
export type SchematicFrameType = typeof SchematicFrameType;

/**
 * Optional slice-driven render effect — how the Schematic treats items once a
 * bound slice narrows them, instead of the default "hidden completely".
 *
 * @remarks
 * Feed the **full** item set (not `Slice.rows`) and mark each item's `excluded`
 * flag (e.g. via `Slice.partition`, or `Slice.apply.matches(...).not()`). Each
 * axis is independently optional: `excluded` styles the filtered-out items
 * (absent ⇒ `hide`), `emphasis` highlights the remainder (absent ⇒ none), and
 * `frame` draws a box around the matched set (absent ⇒ none). All three absent
 * is a no-op.
 *
 * @property excluded - Treatment of filtered-out items (absent ⇒ `hide`)
 * @property emphasis - Positive emphasis on matched items (absent ⇒ none)
 * @property frame - Bounding frame around the matched set (absent ⇒ none)
 */
export const SchematicSliceEffectType = StructType({
    /** Treatment of filtered-out items; absent ⇒ `hide`. */
    excluded: OptionType(SchematicExcludedStyleType),
    /** Positive emphasis on matched items; absent ⇒ none. */
    emphasis: OptionType(SchematicEmphasisType),
    /** Bounding frame around the matched set; absent ⇒ none. */
    frame: OptionType(SchematicFrameType),
});

/**
 * Type representing the slice-driven render effect.
 */
export type SchematicSliceEffectType = typeof SchematicSliceEffectType;

/**
 * East StructType for the Schematic component.
 *
 * @remarks
 * A 2D world-coordinate canvas for placing real-world entities (tanks,
 * bays, lines, cells) plus annotation zones and links, all from flat data
 * tables. **Read-only**: single-click selection only — no events, no drag
 * & drop; editing routes through the linked Library.
 *
 * @property extent - World-coordinate bounds (the canvas scales to fit)
 * @property items - The placed items
 * @property zones - Annotation zones (rooms, cells, walkway bands)
 * @property links - Connections between items, addressed by key
 * @property scaleUnit - Optional unit for the bottom-right scale bar
 * @property grid - Metric grid aligned to the scale legend
 * @property navigator - Navigator rail (zones → items TOC)
 * @property minimap - Minimap with the viewport rectangle
 * @property slice - Optional Slice chrome rail mounting the affordances
 * @property sliceEffect - Optional slice-driven render effect (ghost / emphasis / frame)
 * @property height - Optional fixed panel height (any CSS length)
 * @property onSelect - Optional item-click callback (receives the item key)
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
    /** Optional fixed panel height (any CSS length, e.g. `"400px"`); default: aspect-driven, capped at 75vh */
    height: OptionType(StringType),
    /** Optional item-click callback (receives the item key) */
    onSelect: OptionType(FunctionType([StringType], NullType)),
});

/**
 * Type representing the Schematic component.
 */
export type SchematicRootType = typeof SchematicRootType;
