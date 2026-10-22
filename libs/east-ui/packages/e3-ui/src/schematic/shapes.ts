/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Schematic's pattern, style and geometry helpers (`Schematic Builder
 * Spec.md` §4.7, D35): `Schematic.outline()`, `hatch()`, `solid()`,
 * `dashed()`, `rect()`, `circle()`, `polyline()` and `polygon()`. An accessor
 * builds a zone's pattern, a link's style, a footprint or a zone's shape with
 * them from the row's own fields — `(unit) => some(Schematic.circle(unit.radius))`
 * — so the app's record holds only its own types. Each returns an East value
 * of its type, so an accessor's `match` arms may each return one.
 *
 * Geometry is drawn about its entity's anchor (D22): an item's centre, or a
 * zone's box centre. A `circle` centres on it, and a `polyline`'s or a
 * `polygon`'s vertices are offsets from it in world units: the row's own
 * points, `{ x, y }` (a bulge of 0) or `{ x, y, bulge }`.
 *
 * @packageDocumentation
 */

import {
    ArrayType, East, Expr, FloatType, StructType, isTypeEqual, none, printType, some, variant,
    type EastType, type ExprType, type SubtypeExprOrValue,
} from "@elaraai/east";
import { SchematicGeometryType, SchematicLinkStyleType, SchematicVertexType, SchematicZonePatternType } from "./types.js";

/** String literal form of `Schematic.Types.Tone`'s tags. */
export type SchematicToneLiteral = "brand" | "ink" | "muted" | "success" | "warning" | "danger";

/** Style configuration accepted by {@link SchematicShapes}' `outline`, `hatch`, `solid` and `dashed`. */
export interface SchematicPatternConfig {
    /** Theme tone for the stroke or the hatch lines. */
    tone?: SchematicToneLiteral;
    /** Hatch line spacing in pixels (hatch only): a number, or a Float of the row's. */
    spacing?: SubtypeExprOrValue<FloatType>;
    /** Hatch line angle in degrees (hatch only): a number, or a Float of the row's. */
    angle?: SubtypeExprOrValue<FloatType>;
    /** Stroke width in pixels (links only): a number, or a Float of the row's. */
    weight?: SubtypeExprOrValue<FloatType>;
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

/** A point of the row's own: an `{ x, y }` of Floats, a vertex with a bulge of 0. */
const PointsType = ArrayType(StructType({ x: FloatType, y: FloatType }));

/** The vertices of a shape, on the wire. */
const VerticesType = ArrayType(SchematicVertexType);

/**
 * Vertices accepted by `polyline` and `polygon`: a plain array of
 * `{ x, y, bulge? }` (bulge defaults to `0`), or an East array of the row's own
 * points — `{ x, y }` Floats, each with a bulge of 0, or `{ x, y, bulge }`
 * ({@link SchematicVertexType}).
 */
export type SchematicVertices =
    | readonly SchematicVertexInput[]
    | ExprType<ArrayType<StructType<{ x: FloatType; y: FloatType }>>>
    | SubtypeExprOrValue<ArrayType<SchematicVertexType>>;

/** Optional configuration for `polyline`. */
export interface SchematicPolylineConfig {
    /** Band width in world units — the stroke widens into a duct bank or an aisle: a number, or a Float of the row's. */
    width?: SubtypeExprOrValue<FloatType>;
}

/**
 * Normalises {@link SchematicVertices} into an East-coercible array of
 * {@link SchematicVertexType}: plain arrays get `bulge` defaulted to `0`, an
 * East array of `{ x, y }` points each a bulge of 0, and an East array of
 * vertices passes through as it is.
 *
 * @param vertices - The vertices
 * @param where - The helper, as a refusal names it
 * @returns The vertices, as the wire takes them
 * @throws {Error} For an East array of another element type, naming it
 */
function toVertices(vertices: SchematicVertices, where: string): SubtypeExprOrValue<ArrayType<SchematicVertexType>> {
    if (Array.isArray(vertices)) {
        return (vertices as readonly SchematicVertexInput[]).map(v => ({
            x: v.x,
            y: v.y,
            bulge: v.bulge !== undefined ? v.bulge : 0,
        }));
    }
    if (vertices instanceof Expr) {
        const type = Expr.type(vertices as Expr) as EastType;
        if (isTypeEqual(type, VerticesType)) return vertices as ExprType<ArrayType<SchematicVertexType>>;
        if (isTypeEqual(type, PointsType)) {
            return (vertices as unknown as ExprType<typeof PointsType>).map((_$, p) => East.value({ x: p.x, y: p.y, bulge: 0.0 }, SchematicVertexType));
        }
        throw new Error(`${where}: vertices are the row's own points, an Array of { x, y } or { x, y, bulge } Floats — and these are ${printType(type)}`);
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
    outline(config?: SchematicPatternConfig): ExprType<SchematicZonePatternType> {
        return East.value(variant("outline", { tone: toneValue(config?.tone) }), SchematicZonePatternType);
    },
    /**
     * Builds a `hatch` zone pattern value — the hatched band (hot and cold
     * aisles, exclusion zones): an annotation, holding no items and taking no
     * tap.
     *
     * @param config - Optional style configuration (`tone`, `spacing`, `angle`)
     * @returns A `Schematic.Types.ZonePattern` value
     */
    hatch(config?: SchematicPatternConfig): ExprType<SchematicZonePatternType> {
        return East.value(variant("hatch", {
            tone: toneValue(config?.tone),
            spacing: config?.spacing !== undefined ? some(config.spacing) : none,
            angle: config?.angle !== undefined ? some(config.angle) : none,
        }), SchematicZonePatternType);
    },
    /**
     * Builds a `solid` link style value — a physical run (fibre, power cable).
     *
     * @param config - Optional stroke configuration (`tone`, `weight`)
     * @returns A `Schematic.Types.LinkStyle` value
     */
    solid(config?: SchematicPatternConfig): ExprType<SchematicLinkStyleType> {
        return East.value(variant("solid", {
            tone: toneValue(config?.tone),
            weight: config?.weight !== undefined ? some(config.weight) : none,
        }), SchematicLinkStyleType);
    },
    /**
     * Builds a `dashed` link style value — a routing or logical connection.
     *
     * @param config - Optional stroke configuration (`tone`, `weight`)
     * @returns A `Schematic.Types.LinkStyle` value
     */
    dashed(config?: SchematicPatternConfig): ExprType<SchematicLinkStyleType> {
        return East.value(variant("dashed", {
            tone: toneValue(config?.tone),
            weight: config?.weight !== undefined ? some(config.weight) : none,
        }), SchematicLinkStyleType);
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
     * @param vertices - Vertices, offsets from the anchor in world units, in order: `{ x, y, bulge? }`, or the row's own points
     * @param config - Optional `width` band in world units
     * @returns A `Schematic.Types.Geometry` value
     * @throws {Error} For an East array of neither `{ x, y }` nor `{ x, y, bulge }` Floats, naming its type
     */
    polyline(vertices: SchematicVertices, config?: SchematicPolylineConfig): ExprType<SchematicGeometryType> {
        return East.value(variant("polyline", {
            vertices: toVertices(vertices, "Schematic.polyline"),
            width: config?.width !== undefined ? some(config.width) : none,
        }), SchematicGeometryType);
    },
    /**
     * Builds a `polygon` geometry value — a closed, arc-aware polygon about
     * the entity's anchor (an L-shaped hall, an equipment footprint). Each
     * vertex is an offset from the anchor; the last vertex's `bulge` curves
     * the closing edge.
     *
     * @param vertices - Boundary vertices, offsets from the anchor in world units, in order (auto-closed): `{ x, y, bulge? }`, or the row's own points
     * @returns A `Schematic.Types.Geometry` value
     * @throws {Error} For an East array of neither `{ x, y }` nor `{ x, y, bulge }` Floats, naming its type
     */
    polygon(vertices: SchematicVertices): ExprType<SchematicGeometryType> {
        return East.value(variant("polygon", { vertices: toVertices(vertices, "Schematic.polygon") }), SchematicGeometryType);
    },
} as const;
