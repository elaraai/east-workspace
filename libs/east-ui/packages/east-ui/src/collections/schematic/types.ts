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
 * Shared shape geometry for zones (`geometry`) and item footprints
 * (`footprint`) — one variant, three cases.
 *
 * @remarks
 * Geometry is **additive**: a zone keeps its required `x/y/width/height`
 * bounding box and an item keeps its required `x/y` anchor/centroid; the
 * shape, when present, is what the renderer strokes/fills. Absent geometry
 * (`none`) means today's behaviour — a zone is its rect, an item is its
 * point + icon. Points are world coordinates (the same {@link SchematicPointType}
 * that link `via` waypoints use). `polyline` / `polygon` render in the SVG
 * layer; `rect` keeps the HTML fast path.
 *
 * @property rect - Axis-aligned box (zones: the `x/y/width/height` box; items: the existing sized-bar form)
 * @property polyline - Open polyline in world coords; optional world-space band `width`
 * @property polygon - Closed polygon in world coords (>= 3 points, auto-closed)
 */
export const SchematicGeometryType = VariantType({
    /** Axis-aligned box — zones use `x/y/width/height`; items, the existing sized-bar form. */
    rect: NullType,
    /** Open polyline in world coords; optional world-space band width. */
    polyline: StructType({
        /** Vertices in world coords, in order. */
        points: ArrayType(SchematicPointType),
        /** Optional band width in world units — the stroke widens into a road / aisle. */
        width: OptionType(FloatType),
    }),
    /** Closed polygon in world coords (>= 3 points, auto-closed). */
    polygon: StructType({
        /** Boundary vertices in world coords, in order. */
        points: ArrayType(SchematicPointType),
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
    /** Optional fixed panel height (any CSS length, e.g. `"400px"`); default: aspect-driven, capped at 75vh */
    height: OptionType(StringType),
    /** Optional item-click callback (receives the item key) */
    onSelect: OptionType(FunctionType([StringType], NullType)),
});

/**
 * Type representing the Schematic component.
 */
export type SchematicRootType = typeof SchematicRootType;
