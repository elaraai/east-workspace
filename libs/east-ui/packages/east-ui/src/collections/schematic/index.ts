/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Schematic` — a 2D world-coordinate canvas for placing real-world
 * entities (tanks, bays, lines, nodes, cells) in space, plus annotation
 * zones (rooms, walkways) and key-addressed links, all from flat data
 * tables with chart-style field encodings. **Read-only**: single-click
 * selection only — appearance belongs to the linked Library entry;
 * position and live metrics are owned here.
 *
 * @packageDocumentation
 */

import {
    type ExprType,
    type SubtypeExprOrValue,
    type TypeOf,
    East,
    Expr,
    variant,
    some,
    none,
    ArrayType,
    type BooleanType,
    FloatType,
    type FunctionType,
    type NullType,
    type OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { StatusTokenType } from "../../style/interaction.js";
import { type IconName } from "../../display/icon/types.js";
import { SliceBindType, SliceChromeType } from "../../platform/slice/index.js";
import { SliceAffordanceType, type SliceAffordanceLiteral } from "../../contracts/slice-affordances.js";
import {
    SchematicRootType,
    SchematicItemType,
    SchematicZoneType,
    SchematicLinkType,
    SchematicPointType,
    SchematicVertexType,
    SchematicGeometryType,
    SchematicZonePatternType,
    SchematicLinkStyleType,
    SchematicRouteType,
    SchematicToneType,
} from "./types.js";

// Re-export types
export {
    SchematicRootType,
    SchematicItemType,
    SchematicZoneType,
    SchematicLinkType,
    SchematicPointType,
    SchematicVertexType,
    SchematicGeometryType,
    SchematicZonePatternType,
    SchematicLinkStyleType,
    SchematicRouteType,
    SchematicToneType,
} from "./types.js";

/** String literal form of {@link SchematicToneType} tags. */
export type SchematicToneLiteral = "brand" | "ink" | "muted" | "success" | "warning" | "danger";

/** Style configuration accepted by {@link outline} / {@link hatch} / {@link solid} / {@link dashed}. */
export interface SchematicPatternConfig {
    /** Theme tone for the stroke / hatch lines. */
    tone?: SchematicToneLiteral;
    /** Hatch line spacing in pixels (hatch only). */
    spacing?: number;
    /** Hatch line angle in degrees (hatch only). */
    angle?: number;
    /** Stroke width in pixels (links only). */
    weight?: number;
}

function toneValue(tone: SchematicToneLiteral | undefined) {
    return tone !== undefined ? some(variant(tone, null)) : none;
}

/** Wrap an item/zone `tone` colour override into its option — accepts a string
 *  literal shorthand (`"brand"`) or an East tone expression / value. */
function toneOption(tone: SubtypeExprOrValue<SchematicToneType> | SchematicToneLiteral | undefined) {
    if (tone === undefined) return none;
    return typeof tone === "string" ? some(variant(tone, null)) : some(tone);
}

/**
 * Builds an `outline` zone pattern value — the dashed boundary with an
 * eyebrow label (rooms, cells).
 *
 * @param config - Optional style configuration (`tone`)
 * @returns A `SchematicZonePatternType` value
 */
function outline(config?: SchematicPatternConfig) {
    return variant("outline", { tone: toneValue(config?.tone) });
}

/**
 * Builds a `hatch` zone pattern value — the hatched band (walkways,
 * aisles, exclusion strips).
 *
 * @param config - Optional style configuration (`tone`, `spacing`, `angle`)
 * @returns A `SchematicZonePatternType` value
 */
function hatch(config?: SchematicPatternConfig) {
    return variant("hatch", {
        tone: toneValue(config?.tone),
        spacing: config?.spacing !== undefined ? some(config.spacing) : none,
        angle: config?.angle !== undefined ? some(config.angle) : none,
    });
}

/**
 * Builds a `solid` link style value — a physical run (pipe, conveyor).
 *
 * @param config - Optional stroke configuration (`tone`, `weight`)
 * @returns A `SchematicLinkStyleType` value
 */
function solid(config?: SchematicPatternConfig) {
    return variant("solid", {
        tone: toneValue(config?.tone),
        weight: config?.weight !== undefined ? some(config.weight) : none,
    });
}

/**
 * Builds a `dashed` link style value — a routing / logical connection.
 *
 * @param config - Optional stroke configuration (`tone`, `weight`)
 * @returns A `SchematicLinkStyleType` value
 */
function dashed(config?: SchematicPatternConfig) {
    return variant("dashed", {
        tone: toneValue(config?.tone),
        weight: config?.weight !== undefined ? some(config.weight) : none,
    });
}

/**
 * A polyline / polygon vertex for {@link polyline} / {@link polygon} — a world
 * point plus an optional DXF `bulge`.
 *
 * @property x - World x
 * @property y - World y
 * @property bulge - DXF bulge for the edge to the next vertex; `0` (default) is straight, nonzero is a circular arc (`tan(includedAngle / 4)`, sign = turn direction)
 */
export interface SchematicVertexInput {
    /** World x. */
    x: SubtypeExprOrValue<FloatType>;
    /** World y. */
    y: SubtypeExprOrValue<FloatType>;
    /** DXF bulge for the edge to the next vertex; `0` (default) = straight, nonzero = arc. */
    bulge?: SubtypeExprOrValue<FloatType>;
}

/**
 * Vertices accepted by {@link polyline} / {@link polygon}: either a plain array
 * of `{ x, y, bulge? }` (bulge defaults to `0`) or a resolved East array of
 * {@link SchematicVertexType} values.
 */
export type SchematicVertices =
    | readonly SchematicVertexInput[]
    | SubtypeExprOrValue<ArrayType<SchematicVertexType>>;

/** Optional configuration for {@link polyline}. */
export interface SchematicPolylineConfig {
    /** Band width in world units — the stroke widens into a road / aisle. */
    width?: number;
}

/**
 * Normalise {@link SchematicVertices} into an East-coercible array of
 * {@link SchematicVertexType} — plain arrays get `bulge` defaulted to `0`,
 * East expressions pass through unchanged (they must already be vertices).
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
 * Builds a `rect` geometry value — the axis-aligned box. For zones this is
 * the `x/y/width/height` bounding box; for items, the point / marker form.
 * Equivalent to omitting `geometry` / `footprint`.
 *
 * @returns A `SchematicGeometryType` value
 */
function rect(): ExprType<SchematicGeometryType> {
    return East.value(variant("rect", null), SchematicGeometryType);
}

/**
 * Builds a `circle` geometry value — a circle centred on the entity anchor
 * (an item's `x/y`, or a zone's bounding-box centre). Models tanks, silos,
 * and round equipment without flattening to a polygon.
 *
 * @param radius - Circle radius in world units
 * @returns A `SchematicGeometryType` value
 */
function circle(radius: SubtypeExprOrValue<FloatType>): ExprType<SchematicGeometryType> {
    return East.value(variant("circle", { radius }), SchematicGeometryType);
}

/**
 * Builds a `polyline` geometry value — an open, arc-aware polyline in world
 * coordinates, optionally widened into a band (a road / aisle / walkway).
 *
 * @param vertices - Vertices in world coords, in order (each `{ x, y, bulge? }`; `bulge` defaults to `0`)
 * @param config - Optional `width` band in world units
 * @returns A `SchematicGeometryType` value
 */
function polyline(vertices: SchematicVertices, config?: SchematicPolylineConfig): ExprType<SchematicGeometryType> {
    return East.value(variant("polyline", {
        vertices: toVertices(vertices),
        width: config?.width !== undefined ? some(config.width) : none,
    }), SchematicGeometryType);
}

/**
 * Builds a `polygon` geometry value — a closed, arc-aware polygon in world
 * coordinates (a rotated / L-shaped zone, or an equipment footprint).
 *
 * @param vertices - Boundary vertices in world coords, in order (auto-closed; each `{ x, y, bulge? }`)
 * @returns A `SchematicGeometryType` value
 */
function polygon(vertices: SchematicVertices): ExprType<SchematicGeometryType> {
    return East.value(variant("polygon", { vertices: toVertices(vertices) }), SchematicGeometryType);
}

/**
 * The struct element type of a `SubtypeExprOrValue<ArrayType<StructType>>`.
 */
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

// ============================================================================
// Row fields
// ============================================================================

/**
 * Fields the `item` mapper returns — one placed item, before defaults.
 *
 * @remarks
 * The mapper returns this plain object (optional fields omissible, defaults
 * applied by the factory) or a full `ExprType<SchematicItemType>` when the
 * row is already resolved.
 *
 * @property key - Item identity — links reference it; `onSelect` returns it
 * @property x - World x of the card centre
 * @property y - World y of the card centre
 * @property label - Primary identity line
 * @property sublabel - Optional muted second line (kind / capacity)
 * @property icon - Optional Font Awesome solid icon (static name or expression)
 * @property status - Optional status-dot option (a `StatusTokenType` option value)
 * @property meter - Optional mini utilisation bar (value / max)
 * @property metric - Optional live metric text
 * @property width - Optional world width — renders the wide bar form
 * @property footprint - Optional shape footprint (`Schematic.polygon()` / `polyline()` / `rect()`)
 * @property tone - Optional colour override (semantic tone); absent ⇒ `status` drives the colour
 * @property color - Optional raw CSS stroke / marker tint; wins over `tone`
 * @property bg - Optional raw CSS fill for a polygon / circle footprint
 * @property fillOpacity - Optional fill alpha (0–1) for a polygon / circle footprint
 * @property weight - Optional stroke width in px
 */
export interface SchematicItemFields {
    /** Item identity — links reference it; `onSelect` returns it. */
    key: SubtypeExprOrValue<StringType>;
    /** World x of the card centre. */
    x: SubtypeExprOrValue<FloatType>;
    /** World y of the card centre. */
    y: SubtypeExprOrValue<FloatType>;
    /** Primary identity line. */
    label: SubtypeExprOrValue<StringType>;
    /** Optional muted second line (kind / capacity). */
    sublabel?: SubtypeExprOrValue<StringType>;
    /** Optional Font Awesome solid icon (static name or expression). */
    icon?: IconName | ExprType<StringType>;
    /** Optional status-dot option (a `StatusTokenType` option value). */
    status?: SubtypeExprOrValue<OptionType<StatusTokenType>>;
    /** Optional mini utilisation bar (value / max). */
    meter?: {
        /** Current value. */
        value: SubtypeExprOrValue<FloatType>;
        /** Full-scale value. */
        max: SubtypeExprOrValue<FloatType>;
    };
    /** Optional live metric text. */
    metric?: SubtypeExprOrValue<StringType>;
    /** Optional world width — renders the wide bar form. */
    width?: SubtypeExprOrValue<FloatType>;
    /** Optional shape footprint (`Schematic.polygon()` / `polyline()` / `rect()`); absent ⇒ point + icon. */
    footprint?: SubtypeExprOrValue<SchematicGeometryType>;
    /** Optional colour override (semantic tone); absent ⇒ `status` drives the colour. */
    tone?: SubtypeExprOrValue<SchematicToneType> | SchematicToneLiteral;
    /** Optional raw CSS stroke / marker tint (e.g. `"#2D7FF9"`, `"teal"`); wins over `tone`. */
    color?: SubtypeExprOrValue<StringType>;
    /** Optional raw CSS fill for a polygon / circle footprint. */
    bg?: SubtypeExprOrValue<StringType>;
    /** Optional fill alpha (0–1) for a polygon / circle footprint. */
    fillOpacity?: SubtypeExprOrValue<FloatType>;
    /** Optional stroke width in px. */
    weight?: SubtypeExprOrValue<FloatType>;
}

/**
 * Fields the `zone` mapper returns — one annotation zone, before defaults.
 *
 * @property key - Zone identity
 * @property label - Mono eyebrow label on the boundary
 * @property x - World x of the top-left corner
 * @property y - World y of the top-left corner
 * @property width - World width
 * @property height - World height
 * @property pattern - Optional pattern (default `Schematic.outline()`)
 * @property geometry - Optional shape geometry (`Schematic.polyline()` / `polygon()` / `rect()`)
 * @property tone - Optional colour override (semantic tone); absent ⇒ the `pattern`'s tone drives the colour
 * @property color - Optional raw CSS stroke tint; wins over `tone`
 * @property bg - Optional raw CSS area fill (opt-in; zones are unfilled by default)
 * @property fillOpacity - Optional fill alpha (0–1) for the area fill
 * @property weight - Optional stroke width in px
 */
export interface SchematicZoneFields {
    /** Zone identity. */
    key: SubtypeExprOrValue<StringType>;
    /** Mono eyebrow label on the boundary. */
    label: SubtypeExprOrValue<StringType>;
    /** World x of the top-left corner. */
    x: SubtypeExprOrValue<FloatType>;
    /** World y of the top-left corner. */
    y: SubtypeExprOrValue<FloatType>;
    /** World width. */
    width: SubtypeExprOrValue<FloatType>;
    /** World height. */
    height: SubtypeExprOrValue<FloatType>;
    /** Optional pattern (default `Schematic.outline()`). */
    pattern?: SubtypeExprOrValue<SchematicZonePatternType>;
    /** Optional shape geometry (`Schematic.polyline()` / `polygon()` / `rect()`); absent ⇒ rect. */
    geometry?: SubtypeExprOrValue<SchematicGeometryType>;
    /** Optional colour override (semantic tone); absent ⇒ the `pattern`'s tone drives the colour. */
    tone?: SubtypeExprOrValue<SchematicToneType> | SchematicToneLiteral;
    /** Optional raw CSS stroke tint (e.g. `"#2D7FF9"`, `"teal"`); wins over `tone`. */
    color?: SubtypeExprOrValue<StringType>;
    /** Optional raw CSS area fill (opt-in; zones are unfilled by default). */
    bg?: SubtypeExprOrValue<StringType>;
    /** Optional fill alpha (0–1) for the area fill. */
    fillOpacity?: SubtypeExprOrValue<FloatType>;
    /** Optional stroke width in px. */
    weight?: SubtypeExprOrValue<FloatType>;
}

/**
 * Fields the `link` mapper returns — one connection, before defaults.
 *
 * @property key - Link identity
 * @property from - Source item key
 * @property to - Destination item key
 * @property style - Optional style (default `Schematic.solid()`)
 * @property route - Optional routing (default orthogonal, rounded corners)
 * @property via - Optional world-coordinate waypoints, in order
 */
export interface SchematicLinkFields {
    /** Link identity. */
    key: SubtypeExprOrValue<StringType>;
    /** Source item key. */
    from: SubtypeExprOrValue<StringType>;
    /** Destination item key. */
    to: SubtypeExprOrValue<StringType>;
    /** Optional style (default `Schematic.solid()`). */
    style?: SubtypeExprOrValue<SchematicLinkStyleType>;
    /** Optional routing (default orthogonal, rounded corners). */
    route?: SubtypeExprOrValue<SchematicRouteType>;
    /** Optional world-coordinate waypoints, in order. */
    via?: SubtypeExprOrValue<ArrayType<SchematicPointType>>;
}

// ============================================================================
// Root factory
// ============================================================================

/**
 * Configuration for {@link createSchematic}.
 *
 * @typeParam I - The item row struct
 * @typeParam Z - The zone row struct
 * @typeParam L - The link row struct
 * @property extent - World-coordinate bounds; the canvas scales to fit
 * @property item - Items row mapper (omit when rows are already resolved)
 * @property zones - Optional zones table
 * @property zone - Zones row mapper (omit when rows are already resolved)
 * @property links - Optional links table
 * @property link - Links row mapper (omit when rows are already resolved)
 * @property scaleUnit - Optional unit for the bottom-right scale bar
 * @property grid - Metric grid aligned to the scale legend
 * @property navigator - Navigator rail (zones → items TOC)
 * @property minimap - Minimap with the viewport rectangle
 * @property height - Optional fixed panel height (any CSS length)
 * @property onSelect - Optional item-click callback (receives the item key)
 */
export interface SchematicConfig<
    I extends StructType,
    Z extends StructType,
    L extends StructType,
> {
    /** World-coordinate bounds; the canvas scales to fit. */
    extent: { width: number; height: number };
    /** Items row mapper; omit when `items` is already `ArrayType(Schematic.Types.Item)`. */
    item?: (item: ExprType<I>) => SchematicItemFields;
    /** Optional zones table. */
    zones?: SubtypeExprOrValue<ArrayType<Z>>;
    /** Zones row mapper; omit when `zones` is already `ArrayType(Schematic.Types.Zone)`. */
    zone?: (zone: ExprType<Z>) => SchematicZoneFields;
    /** Optional links table. */
    links?: SubtypeExprOrValue<ArrayType<L>>;
    /** Links row mapper; omit when `links` is already `ArrayType(Schematic.Types.Link)`. */
    link?: (link: ExprType<L>) => SchematicLinkFields;
    /** Optional unit for the bottom-right scale bar. */
    scaleUnit?: SubtypeExprOrValue<StringType>;
    /** Metric grid aligned to the scale legend; default on. */
    grid?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Navigator rail (zones → items TOC); default: shown when zones exist. */
    navigator?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Minimap with the viewport rectangle; default: shown for 25+ items. */
    minimap?: SubtypeExprOrValue<BooleanType> | boolean;
    /**
     * Slice chrome — pass the bound handle and the Schematic renders a
     * full-width top-edge rail mounting the `affordances` (default
     * `["search"]`), replacing the old built-in navigator search. The search
     * affordance narrows the bound items (and flies to the top hit on Enter).
     */
    slice?: SubtypeExprOrValue<SliceBindType>;
    /** Rail affordances when `slice` is set. Default `["search"]`. */
    affordances?: SliceAffordanceLiteral[];
    /** Optional fixed panel height (any CSS length, e.g. `"400px"`); default: aspect-driven, capped at 75vh. */
    height?: SubtypeExprOrValue<StringType> | string;
    /** Optional item-click callback (receives the item key). */
    onSelect?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
}

function buildRoot(
    items: SubtypeExprOrValue<ArrayType<StructType>>,
    config: SchematicConfig<StructType, StructType, StructType>,
): ExprType<UIComponentType> {
    const itemMapper = config.item;
    const resolvedItems = itemMapper === undefined
        ? East.value(items as SubtypeExprOrValue<ArrayType<SchematicItemType>>, ArrayType(SchematicItemType))
        : (East.value(items) as ExprType<ArrayType<StructType>>).map((_$, row) => {
            const r: SchematicItemFields | ExprType<SchematicItemType> = itemMapper(row);
            if (r instanceof Expr) return East.value(r, SchematicItemType);
            return East.value({
                key: r.key,
                x: r.x,
                y: r.y,
                label: r.label,
                sublabel: r.sublabel !== undefined ? some(r.sublabel) : none,
                icon: r.icon !== undefined ? some(r.icon) : none,
                status: r.status !== undefined ? r.status : none,
                meter: r.meter !== undefined
                    ? some(East.value({ value: r.meter.value, max: r.meter.max },
                        StructType({ value: FloatType, max: FloatType })))
                    : none,
                metric: r.metric !== undefined ? some(r.metric) : none,
                width: r.width !== undefined ? some(r.width) : none,
                footprint: r.footprint !== undefined ? some(r.footprint) : none,
                tone: toneOption(r.tone),
                color: r.color !== undefined ? some(r.color) : none,
                bg: r.bg !== undefined ? some(r.bg) : none,
                fillOpacity: r.fillOpacity !== undefined ? some(r.fillOpacity) : none,
                weight: r.weight !== undefined ? some(r.weight) : none,
            }, SchematicItemType);
        });

    const zoneMapper = config.zone;
    const resolvedZones = config.zones === undefined
        ? East.value([], ArrayType(SchematicZoneType))
        : zoneMapper === undefined
            ? East.value(config.zones as SubtypeExprOrValue<ArrayType<SchematicZoneType>>, ArrayType(SchematicZoneType))
            : (East.value(config.zones) as ExprType<ArrayType<StructType>>).map((_$, row) => {
                const r: SchematicZoneFields | ExprType<SchematicZoneType> = zoneMapper(row);
                if (r instanceof Expr) return East.value(r, SchematicZoneType);
                return East.value({
                    key: r.key,
                    label: r.label,
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    pattern: r.pattern !== undefined
                        ? r.pattern
                        : East.value(outline(), SchematicZonePatternType),
                    geometry: r.geometry !== undefined ? some(r.geometry) : none,
                    tone: toneOption(r.tone),
                    color: r.color !== undefined ? some(r.color) : none,
                    bg: r.bg !== undefined ? some(r.bg) : none,
                    fillOpacity: r.fillOpacity !== undefined ? some(r.fillOpacity) : none,
                    weight: r.weight !== undefined ? some(r.weight) : none,
                }, SchematicZoneType);
            });

    const linkMapper = config.link;
    const resolvedLinks = config.links === undefined
        ? East.value([], ArrayType(SchematicLinkType))
        : linkMapper === undefined
            ? East.value(config.links as SubtypeExprOrValue<ArrayType<SchematicLinkType>>, ArrayType(SchematicLinkType))
            : (East.value(config.links) as ExprType<ArrayType<StructType>>).map((_$, row) => {
                const r: SchematicLinkFields | ExprType<SchematicLinkType> = linkMapper(row);
                if (r instanceof Expr) return East.value(r, SchematicLinkType);
                return East.value({
                    key: r.key,
                    from: r.from,
                    to: r.to,
                    style: r.style !== undefined
                        ? r.style
                        : East.value(solid(), SchematicLinkStyleType),
                    route: r.route !== undefined
                        ? r.route
                        : East.value(variant("orthogonal", { corner: none }), SchematicRouteType),
                    via: r.via !== undefined
                        ? East.value(r.via, ArrayType(SchematicPointType))
                        : East.value([], ArrayType(SchematicPointType)),
                }, SchematicLinkType);
            });

    if (config.affordances?.includes("brush")) {
        throw new Error("Schematic does not support the 'brush' affordance — its 2D canvas has no continuous 1D axis.");
    }
    const sliceChromeValue = config.slice !== undefined
        ? East.value({
            slice: config.slice,
            affordances: East.value(
                (config.affordances ?? ["search"]).map(a => variant(a, null)),
                ArrayType(SliceAffordanceType),
            ),
        }, SliceChromeType)
        : undefined;

    return East.value(variant("Schematic", {
        extent: { width: config.extent.width, height: config.extent.height },
        items: resolvedItems,
        zones: resolvedZones,
        links: resolvedLinks,
        scaleUnit: config.scaleUnit !== undefined ? some(config.scaleUnit) : none,
        grid: config.grid !== undefined ? some(config.grid) : none,
        navigator: config.navigator !== undefined ? some(config.navigator) : none,
        minimap: config.minimap !== undefined ? some(config.minimap) : none,
        slice: sliceChromeValue ? some(sliceChromeValue) : none,
        height: config.height !== undefined ? some(config.height) : none,
        onSelect: config.onSelect !== undefined ? some(config.onSelect) : none,
    }), UIComponentType);
}

/**
 * Creates a Schematic — a read-only 2D world-coordinate canvas.
 *
 * @typeParam I - The items-table input
 * @typeParam Z - The zones-table input
 * @typeParam L - The links-table input
 * @param items - The placed-item rows
 * @param config - The Schematic configuration ({@link SchematicConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East, variant } from "@elaraai/east";
 * import { Schematic, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Schematic.Root(
 *         [{ id: "UNIT-04", x: 3.0, y: 2.0, kind: "unit", fill: 28.8, cap: 40.0 }],
 *         {
 *             extent: { width: 30, height: 12 },
 *             item: e => ({
 *                 key: e.id, x: e.x, y: e.y, label: e.id,
 *                 sublabel: e.kind,
 *                 meter: { value: e.fill, max: e.cap },
 *             }),
 *         },
 *     ),
 * );
 * ```
 */
function createSchematic<
    I extends SubtypeExprOrValue<ArrayType<StructType>>,
    Z extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    L extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    items: I,
    config: SchematicConfig<RowElement<I>, RowElement<Z>, RowElement<L>> & { zones?: Z; links?: L },
): ExprType<UIComponentType> {
    return buildRoot(items, config as unknown as SchematicConfig<StructType, StructType, StructType>);
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Schematic component namespace.
 *
 * @remarks
 * `Schematic.Root(items, config)` builds the canvas from up to three flat
 * tables (items, zones, links); closed-set fields in data (`status`,
 * `pattern`, `style`) are typed variant values (`Schematic.Types.*`).
 */
export const Schematic = {
    /**
     * Creates a Schematic — a read-only 2D world-coordinate canvas.
     *
     * @typeParam I - The items-table input
     * @typeParam Z - The zones-table input
     * @typeParam L - The links-table input
     * @param items - The placed-item rows
     * @param config - The Schematic configuration ({@link SchematicConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @remarks
     * Links address endpoints by item key, so they survive repositioning;
     * `via` waypoints route around zones. A walkway band is a zone with
     * `pattern: variant("hatch", null)`.
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Schematic, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Schematic.Root(
     *         [{ id: "UNIT-04", x: 3.0, y: 2.0 }],
     *         {
     *             extent: { width: 30, height: 12 },
     *             item: e => ({ key: e.id, x: e.x, y: e.y, label: e.id }),
     *         },
     *     ),
     * );
     * ```
     */
    Root: createSchematic,
    /**
     * Builds an `outline` zone pattern value — the dashed boundary with an
     * eyebrow label.
     *
     * @param config - Optional style configuration (`tone`)
     * @returns A `SchematicZonePatternType` value
     *
     * @example
     * ```ts
     * Schematic.outline({ tone: "ink" })
     * ```
     */
    outline,
    /**
     * Builds a `hatch` zone pattern value — the hatched band.
     *
     * @param config - Optional style configuration (`tone`, `spacing`, `angle`)
     * @returns A `SchematicZonePatternType` value
     *
     * @example
     * ```ts
     * Schematic.hatch({ spacing: 10, angle: 45 })
     * ```
     */
    hatch,
    /**
     * Builds a `solid` link style value — a physical run.
     *
     * @param config - Optional stroke configuration (`tone`, `weight`)
     * @returns A `SchematicLinkStyleType` value
     *
     * @example
     * ```ts
     * Schematic.solid({ tone: "brand", weight: 3 })
     * ```
     */
    solid,
    /**
     * Builds a `dashed` link style value — a routing / logical connection.
     *
     * @param config - Optional stroke configuration (`tone`, `weight`)
     * @returns A `SchematicLinkStyleType` value
     *
     * @example
     * ```ts
     * Schematic.dashed({ tone: "muted" })
     * ```
     */
    dashed,
    /**
     * Builds a `rect` geometry value — the axis-aligned box (a zone's
     * `x/y/width/height`, or an item's point / marker form). Equals omitting
     * `geometry` / `footprint`.
     *
     * @returns A `SchematicGeometryType` value
     *
     * @example
     * ```ts
     * Schematic.rect()
     * ```
     */
    rect,
    /**
     * Builds a `circle` geometry value — a circle centred on the entity
     * anchor (an item's `x/y`, or a zone's bbox centre). Models tanks, silos,
     * and round equipment.
     *
     * @param radius - Circle radius in world units
     * @returns A `SchematicGeometryType` value
     *
     * @example
     * ```ts
     * Schematic.circle(2.5)
     * ```
     */
    circle,
    /**
     * Builds a `polyline` geometry value — an open, arc-aware polyline in
     * world coordinates, optionally widened into a band (a road / aisle).
     * Each vertex's `bulge` curves the edge to the next vertex (0 = straight).
     *
     * @param vertices - Vertices in world coords, in order (`{ x, y, bulge? }`)
     * @param config - Optional `width` band in world units
     * @returns A `SchematicGeometryType` value
     *
     * @example
     * ```ts
     * Schematic.polyline([{ x: 0, y: 4 }, { x: 12, y: 4, bulge: 0.42 }, { x: 12, y: 9 }], { width: 1.6 })
     * ```
     */
    polyline,
    /**
     * Builds a `polygon` geometry value — a closed, arc-aware polygon in
     * world coordinates (a rotated / L-shaped zone, or an equipment
     * footprint). The last vertex's `bulge` curves the closing edge.
     *
     * @param vertices - Boundary vertices in world coords, in order (auto-closed; `{ x, y, bulge? }`)
     * @returns A `SchematicGeometryType` value
     *
     * @example
     * ```ts
     * Schematic.polygon([{ x: 2, y: 2 }, { x: 7, y: 3 }, { x: 6, y: 8 }, { x: 1, y: 6 }])
     * ```
     */
    polygon,
    Types: {
        /**
         * East StructType for the Schematic component.
         *
         * @remarks
         * See {@link SchematicRootType} for per-field docs.
         *
         * @property extent - World-coordinate bounds
         * @property items - The placed items
         * @property zones - Annotation zones
         * @property links - Connections between items
         * @property scaleUnit - Optional scale-bar unit
         * @property onSelect - Optional item-click callback
         */
        Schematic: SchematicRootType,
        /**
         * A resolved placed item.
         *
         * @property key - Item identity
         * @property x - World x of the card centre
         * @property y - World y of the card centre
         * @property label - Primary identity line
         * @property sublabel - Optional muted second line
         * @property icon - Optional Font Awesome solid icon name
         * @property status - Optional status dot tone
         * @property meter - Optional mini utilisation bar
         * @property metric - Optional live metric text
         * @property width - Optional world width (wide bar form)
         * @property footprint - Optional shape footprint (point + icon when absent)
         */
        Item: SchematicItemType,
        /**
         * A resolved annotation zone.
         *
         * @property key - Zone identity
         * @property label - Eyebrow label
         * @property x - World x (top-left)
         * @property y - World y (top-left)
         * @property width - World width
         * @property height - World height
         * @property pattern - Render pattern
         * @property geometry - Optional shape geometry (rect when absent)
         */
        Zone: SchematicZoneType,
        /**
         * A resolved link between items.
         *
         * @property key - Link identity
         * @property from - Source item key
         * @property to - Destination item key
         * @property style - Render style
         * @property via - Waypoints, in order
         */
        Link: SchematicLinkType,
        /**
         * Zone render pattern (`outline` / `hatch`).
         *
         * @property outline - Dashed boundary with an eyebrow label
         * @property hatch - Hatched band
         */
        ZonePattern: SchematicZonePatternType,
        /**
         * Link render style (`solid` / `dashed`), each carrying stroke config.
         *
         * @property solid - A physical run
         * @property dashed - A routing / logical connection
         */
        LinkStyle: SchematicLinkStyleType,
        /**
         * Link routing mode (`orthogonal` / `direct`).
         *
         * @property orthogonal - Axis-aligned with rounded corners
         * @property direct - Straight segments between anchors
         */
        Route: SchematicRouteType,
        /**
         * Theme tone for zone strokes, hatching, and links.
         *
         * @property brand - Brand teal
         * @property ink - Foreground ink
         * @property muted - Muted foreground
         * @property success - Status ok
         * @property warning - Status warn
         * @property danger - Status bad
         */
        Tone: SchematicToneType,
        /**
         * Shared shape geometry for zones (`geometry`) and item footprints
         * (`footprint`).
         *
         * @property rect - Axis-aligned box
         * @property circle - Circle centred on the entity anchor (`radius` in world units)
         * @property polyline - Open, arc-aware polyline; optional world-space band width
         * @property polygon - Closed, arc-aware polygon (>= 3 vertices)
         */
        Geometry: SchematicGeometryType,
        /**
         * A polyline / polygon vertex — a world point plus DXF `bulge`.
         *
         * @property x - World x
         * @property y - World y
         * @property bulge - DXF bulge for the edge to the next vertex (0 = straight)
         */
        Vertex: SchematicVertexType,
    },
} as const;
