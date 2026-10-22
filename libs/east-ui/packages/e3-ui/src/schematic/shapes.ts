/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's pattern, style and geometry helpers (`Schematic Builder
 * Spec.md` §4.7): `Schematic.outline()`, `hatch()`, `solid()`, `dashed()`,
 * `rect()`, `circle()`, `polyline()` and `polygon()`, which write the value
 * types an app's rows hold — a zone's pattern, a link's style, a footprint.
 *
 * Geometry is drawn about its entity's anchor (D22): an item's centre, or a
 * zone's box centre. A `circle` centres on it, and a `polyline`'s or a
 * `polygon`'s vertices are offsets from it in world units.
 *
 * @packageDocumentation
 */

import { ArrayType, East, FloatType, none, some, variant, type ExprType, type SubtypeExprOrValue } from "@elaraai/east";
import { SchematicGeometryType, type SchematicVertexType } from "./types.js";

/** String literal form of `Schematic.Types.Tone`'s tags. */
export type SchematicToneLiteral = "brand" | "ink" | "muted" | "success" | "warning" | "danger";

/** Style configuration accepted by {@link SchematicShapes}' `outline`, `hatch`, `solid` and `dashed`. */
export interface SchematicPatternConfig {
    /** Theme tone for the stroke or the hatch lines. */
    tone?: SchematicToneLiteral;
    /** Hatch line spacing in pixels (hatch only). */
    spacing?: number;
    /** Hatch line angle in degrees (hatch only). */
    angle?: number;
    /** Stroke width in pixels (links only). */
    weight?: number;
}

/**
 * A tone's option, from its literal.
 *
 * @param tone - The tone's tag, if any
 * @returns `some` of the tone, or `none`
 * @internal
 */
export function toneValue(tone: SchematicToneLiteral | undefined) {
    return tone !== undefined ? some(variant(tone, null)) : none;
}

/**
 * A polyline or polygon vertex for `polyline` and `polygon`: an offset from
 * the entity's anchor, plus an optional DXF `bulge`.
 *
 * @property x - Offset from the anchor along x, in world units
 * @property y - Offset from the anchor along y, in world units
 * @property bulge - DXF bulge for the edge to the next vertex; `0` (default) is straight, nonzero is a circular arc (`tan(includedAngle / 4)`, sign = turn direction)
 */
export interface SchematicVertexInput {
    /** Offset from the anchor along x, in world units. */
    x: SubtypeExprOrValue<FloatType>;
    /** Offset from the anchor along y, in world units. */
    y: SubtypeExprOrValue<FloatType>;
    /** DXF bulge for the edge to the next vertex; `0` (default) = straight, nonzero = arc. */
    bulge?: SubtypeExprOrValue<FloatType>;
}

/**
 * Vertices accepted by `polyline` and `polygon`: either a plain array of
 * `{ x, y, bulge? }` (bulge defaults to `0`) or an East array of
 * {@link SchematicVertexType} values.
 */
export type SchematicVertices =
    | readonly SchematicVertexInput[]
    | SubtypeExprOrValue<ArrayType<SchematicVertexType>>;

/** Optional configuration for `polyline`. */
export interface SchematicPolylineConfig {
    /** Band width in world units — the stroke widens into a duct bank or an aisle. */
    width?: number;
}

/**
 * Normalises {@link SchematicVertices} into an East-coercible array of
 * {@link SchematicVertexType}: plain arrays get `bulge` defaulted to `0`, and
 * East expressions pass through as they are.
 */
function toVertices(vertices: SchematicVertices): SubtypeExprOrValue<ArrayType<SchematicVertexType>> {
    if (Array.isArray(vertices)) {
        return (vertices as readonly SchematicVertexInput[]).map(v => ({
            x: v.x,
            y: v.y,
            bulge: v.bulge !== undefined ? v.bulge : 0,
        }));
    }
    return vertices as SubtypeExprOrValue<ArrayType<SchematicVertexType>>;
}

/**
 * The pattern, style and geometry helpers the `Schematic` namespace carries.
 */
export const SchematicShapes = {
    /**
     * Builds an `outline` zone pattern value — the dashed boundary with an
     * eyebrow label (halls, cages).
     *
     * @param config - Optional style configuration (`tone`)
     * @returns A `Schematic.Types.ZonePattern` value
     */
    outline(config?: SchematicPatternConfig) {
        return variant("outline", { tone: toneValue(config?.tone) });
    },
    /**
     * Builds a `hatch` zone pattern value — the hatched band (hot and cold
     * aisles, exclusion zones): an annotation, holding no items and taking no
     * tap.
     *
     * @param config - Optional style configuration (`tone`, `spacing`, `angle`)
     * @returns A `Schematic.Types.ZonePattern` value
     */
    hatch(config?: SchematicPatternConfig) {
        return variant("hatch", {
            tone: toneValue(config?.tone),
            spacing: config?.spacing !== undefined ? some(config.spacing) : none,
            angle: config?.angle !== undefined ? some(config.angle) : none,
        });
    },
    /**
     * Builds a `solid` link style value — a physical run (fibre, power cable).
     *
     * @param config - Optional stroke configuration (`tone`, `weight`)
     * @returns A `Schematic.Types.LinkStyle` value
     */
    solid(config?: SchematicPatternConfig) {
        return variant("solid", {
            tone: toneValue(config?.tone),
            weight: config?.weight !== undefined ? some(config.weight) : none,
        });
    },
    /**
     * Builds a `dashed` link style value — a routing or logical connection.
     *
     * @param config - Optional stroke configuration (`tone`, `weight`)
     * @returns A `Schematic.Types.LinkStyle` value
     */
    dashed(config?: SchematicPatternConfig) {
        return variant("dashed", {
            tone: toneValue(config?.tone),
            weight: config?.weight !== undefined ? some(config.weight) : none,
        });
    },
    /**
     * Builds a `rect` geometry value — the entity's box itself: a zone's
     * rect, an item's card and marker. Equals leaving the geometry out.
     *
     * @returns A `Schematic.Types.Geometry` value
     */
    rect(): ExprType<SchematicGeometryType> {
        return East.value(variant("rect", null), SchematicGeometryType);
    },
    /**
     * Builds a `circle` geometry value — a circle centred on the entity's
     * anchor (an item's centre, or a zone's box centre): columns, cooling
     * towers and other round equipment.
     *
     * @param radius - Circle radius in world units
     * @returns A `Schematic.Types.Geometry` value
     */
    circle(radius: SubtypeExprOrValue<FloatType>): ExprType<SchematicGeometryType> {
        return East.value(variant("circle", { radius }), SchematicGeometryType);
    },
    /**
     * Builds a `polyline` geometry value — an open, arc-aware polyline about
     * the entity's anchor, optionally widened into a band (a duct bank, an
     * aisle). Each vertex is an offset from the anchor, and its `bulge` curves
     * the edge to the next vertex (0 = straight).
     *
     * @param vertices - Vertices, offsets from the anchor in world units, in order (`{ x, y, bulge? }`)
     * @param config - Optional `width` band in world units
     * @returns A `Schematic.Types.Geometry` value
     */
    polyline(vertices: SchematicVertices, config?: SchematicPolylineConfig): ExprType<SchematicGeometryType> {
        return East.value(variant("polyline", {
            vertices: toVertices(vertices),
            width: config?.width !== undefined ? some(config.width) : none,
        }), SchematicGeometryType);
    },
    /**
     * Builds a `polygon` geometry value — a closed, arc-aware polygon about
     * the entity's anchor (an L-shaped hall, an equipment footprint). Each
     * vertex is an offset from the anchor; the last vertex's `bulge` curves
     * the closing edge.
     *
     * @param vertices - Boundary vertices, offsets from the anchor in world units, in order (auto-closed; `{ x, y, bulge? }`)
     * @returns A `Schematic.Types.Geometry` value
     */
    polygon(vertices: SchematicVertices): ExprType<SchematicGeometryType> {
        return East.value(variant("polygon", { vertices: toVertices(vertices) }), SchematicGeometryType);
    },
} as const;
