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
    SchematicEmphasisType,
    SchematicSliceEffectType,
    SchematicLayerType,
    SchematicSelectionModeType,
    SchematicRegionType,
    SchematicSelectionEventType,
    SchematicViewportEventType,
    SchematicZoneSelectionEventType,
    SchematicLinkModeType,
    SchematicLinkEndpointsType,
    SchematicLinkCreateEventType,
    SchematicLinkEditEventType,
    SchematicNetEndpointsType,
    SchematicNetType,
    SchematicItemMoveEventType,
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
    SchematicEmphasisType,
    SchematicSliceEffectType,
    SchematicLayerType,
    SchematicSelectionModeType,
    SchematicRegionType,
    SchematicSelectionEventType,
    SchematicViewportEventType,
    SchematicZoneSelectionEventType,
    SchematicLinkModeType,
    SchematicLinkEndpointsType,
    SchematicLinkCreateEventType,
    SchematicLinkEditEventType,
    SchematicNetEndpointsType,
    SchematicNetType,
    SchematicItemMoveEventType,
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
    /** Optional slice-excluded flag — when a `sliceEffect` is set, a `true` item
     * is treated as filtered-out (ghosted / hidden per the effect). Typically
     * `Slice.apply.matches(state, cfg, row).not()`, or read from `Slice.partition`. */
    excluded?: SubtypeExprOrValue<BooleanType>;
    /** Optional layer membership — the `key` of a `layers` entry; hidden when
     * that layer is hidden. Absent ⇒ unlayered (always visible). */
    layer?: SubtypeExprOrValue<StringType>;
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
    /** Optional layer membership — the `key` of a `layers` entry; hidden when
     * that layer is hidden. Absent ⇒ unlayered (always visible). */
    layer?: SubtypeExprOrValue<StringType>;
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
    /** Optional label rendered mid-path (a name / flow description); hidden when zoomed out past the label band. */
    label?: SubtypeExprOrValue<StringType>;
    /** Optional metric rendered after the label mid-path (a rate / capacity readout), muted. */
    metric?: SubtypeExprOrValue<StringType>;
    /** Optional style (default `Schematic.solid()`). */
    style?: SubtypeExprOrValue<SchematicLinkStyleType>;
    /** Optional routing (default orthogonal, rounded corners). */
    route?: SubtypeExprOrValue<SchematicRouteType>;
    /** Optional world-coordinate waypoints, in order. */
    via?: SubtypeExprOrValue<ArrayType<SchematicPointType>>;
    /** Optional layer membership — the `key` of a `layers` entry; hidden when
     * that layer is hidden (or when either endpoint item is hidden). */
    layer?: SubtypeExprOrValue<StringType>;
}

/**
 * Author-facing fields for one net (manifold / bus), produced by the `net`
 * mapper — many `sources` feeding many `destinations` through one trunk.
 */
export interface SchematicNetFields {
    /** Net identity. */
    key: SubtypeExprOrValue<StringType>;
    /** Source item keys (the feeding side). */
    sources: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Destination item keys (the fed side). */
    destinations: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Optional label rendered mid-trunk. */
    label?: SubtypeExprOrValue<StringType>;
    /** Optional metric rendered after the label mid-trunk, muted. */
    metric?: SubtypeExprOrValue<StringType>;
    /** Optional style (default `Schematic.solid()`). */
    style?: SubtypeExprOrValue<SchematicLinkStyleType>;
    /** Optional trunk routing (default orthogonal, rounded corners). */
    route?: SubtypeExprOrValue<SchematicRouteType>;
    /** Optional world-coordinate trunk waypoints, in order. */
    via?: SubtypeExprOrValue<ArrayType<SchematicPointType>>;
    /** Optional layer membership — hidden when that layer is hidden. */
    layer?: SubtypeExprOrValue<StringType>;
}

/** String literal form of {@link SchematicEmphasisType} tags. */
export type SchematicEmphasisLiteral = "halo" | "pulse";

/** String literal form of {@link SchematicSelectionModeType} tags. */
export type SchematicSelectionModeLiteral = "single" | "multiple";

/** String literal form of {@link SchematicLinkModeType} tags. */
export type SchematicLinkModeLiteral = "draw" | "connect";

/** Resolve a `sliceEmphasis` prop to its `option<Emphasis>` — a `"halo"` /
 *  `"pulse"` string is sugar for `some(variant(...))`; an East value is already
 *  the option (so it can be reactively `none` to turn the ring OFF). */
function emphasisOption(emphasis: SubtypeExprOrValue<OptionType<SchematicEmphasisType>> | SchematicEmphasisLiteral | undefined) {
    if (emphasis === undefined) return none;
    return typeof emphasis === "string" ? some(variant(emphasis, null)) : emphasis;
}

/**
 * A layer declaration for {@link SchematicConfig.layers}. Only `key` + `label`
 * are required; the rest are author defaults the user's panel toggles override.
 *
 * @property key - Layer identity — entities reference it via their `layer` field
 * @property label - Panel display name
 * @property visible - Author default visibility (default `true`); `false` ⇒ ships hidden
 * @property locked - Author default lock / non-selectable (default `false`)
 * @property opacity - Item-level dim (0–1) for the layer's items (default `1`)
 * @property tone - Panel swatch tone
 */
export interface SchematicLayerInput {
    /** Layer identity — entities reference it via their `layer` field. */
    key: string;
    /** Panel display name. */
    label: string;
    /** Author default visibility (default `true`); `false` ⇒ ships hidden. */
    visible?: boolean;
    /** Author default lock / non-selectable (default `false`). */
    locked?: boolean;
    /** Item-level dim (0–1) for the layer's items (default `1`). */
    opacity?: number;
    /** Panel swatch tone. */
    tone?: SchematicToneLiteral;
}

/** Build the East `SchematicLayer` value from the plain JS declaration. */
function toLayer(l: SchematicLayerInput): ExprType<SchematicLayerType> {
    return East.value({
        key: l.key,
        label: l.label,
        visible: l.visible !== undefined ? some(l.visible) : none,
        locked: l.locked !== undefined ? some(l.locked) : none,
        opacity: l.opacity !== undefined ? some(l.opacity) : none,
        tone: toneValue(l.tone),
    }, SchematicLayerType);
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
    N extends StructType = StructType,
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
    /** Optional nets — manifold / bus rows (one row = many sources → many destinations). */
    nets?: SubtypeExprOrValue<ArrayType<N>>;
    /** Maps a net row to its {@link SchematicNetFields} (or passes a resolved {@link SchematicNetType} through). */
    net?: (net: ExprType<N>) => SchematicNetFields;
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
    /**
     * Slice-driven render effect — instead of hiding filtered-out items, keep
     * them as ghosted / desaturated / shrunk context and emphasise the remainder.
     * Feed the **full** item set and mark each item's `excluded` flag (via
     * `Slice.partition`, or `Slice.apply.matches(...).not()`); every prop below is
     * `SubtypeExprOrValue`, so any can be static or driven reactively from a
     * `State.read`. All absent ⇒ excluded items hidden completely (today's default).
     */
    /** Remove filtered-out items entirely; absent / `false` ⇒ keep them as context. */
    sliceHidden?: SubtypeExprOrValue<BooleanType>;
    /** Ghost opacity (0–1) for kept filtered-out items; absent ⇒ full. */
    sliceOpacity?: SubtypeExprOrValue<FloatType>;
    /** Drain kept filtered-out items' colour to grey. */
    sliceDesaturate?: SubtypeExprOrValue<BooleanType>;
    /** Collapse kept filtered-out items to a bare dot (drop card / label / footprint). */
    sliceDot?: SubtypeExprOrValue<BooleanType>;
    /** Emphasise the matched remainder — `"halo"` (static ring) or `"pulse"`
     * (animated). A reactive `option<Emphasis>` value can be `none` to turn the
     * ring off; the string shorthands are sugar for `some(variant(...))`. */
    sliceEmphasis?: SubtypeExprOrValue<OptionType<SchematicEmphasisType>> | SchematicEmphasisLiteral;
    /** Draw a bounding frame around the matched set. */
    sliceFrame?: SubtypeExprOrValue<BooleanType>;
    /** Auto-fit the camera to the matched frame when the matched set changes. */
    sliceFrameFit?: SubtypeExprOrValue<BooleanType>;
    /**
     * Named layers — cross-cutting groups of items / zones / links, toggled
     * (visibility / solo / lock / dim) from a layer button on the canvas. Tag
     * each entity with a matching `layer` key. Absent ⇒ no layer chrome.
     */
    layers?: SchematicLayerInput[];
    /** Optional fixed panel height (any CSS length, e.g. `"400px"`); default: aspect-driven, capped at 75vh. */
    height?: SubtypeExprOrValue<StringType> | string;
    /** Optional item-click callback (receives the item key). */
    onSelect?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional selection cardinality (`"single"` / `"multiple"` / `"range"`); absent ⇒ single. `multiple` / `range` reveal the marquee tool. */
    selectionMode?: SubtypeExprOrValue<SchematicSelectionModeType> | SchematicSelectionModeLiteral;
    /** Optional selection-set change callback — fired on any tap / marquee / clear with the full selected set ({@link SchematicSelectionEventType}). */
    onSelectionChange?: SubtypeExprOrValue<FunctionType<[SchematicSelectionEventType], NullType>>;
    /** Optional bound-slice fieldId that selection drives with an `in` filter of the selected item keys (requires a bound `slice`); absent ⇒ selection leaves the slice untouched. Best paired with the ghost `slice*` effect rather than a `Slice.rows` feed on the same slice. */
    sliceSelectField?: SubtypeExprOrValue<StringType> | string;
    /** When true, a canvas selection also moves the camera — a single tap flies to the item, a marquee fits to the selected set — regardless of `selectionMode`; default false. The navigator rail + prev/next always fly. */
    selectZoomFocus?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional debounced viewport-settled callback ({@link SchematicViewportEventType}: zoom + visible world rect) — fired after a pan / zoom / fly / resize settles, never per-frame. */
    onViewportChange?: SubtypeExprOrValue<FunctionType<[SchematicViewportEventType], NullType>>;
    /** Optional item-open callback (receives the item key) — fired on double-click / double-tap of an item (drill-in); a background double-click keeps Fit / reset. Locked-layer items do not open. */
    onItemOpen?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional zone-click callback (receives the zone key) — the single-key channel, parallel to `onSelect`. Items take hit-test precedence; outline zones only (hatch bands are annotations); innermost zone wins for nested zones. */
    onSelectZone?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional zone selection-set change callback ({@link SchematicZoneSelectionEventType}) — fired on any zone tap / nav zone click / clear with the full selected zone set AND their `childItemKeys`. Zone gestures follow `selectionMode` (Shift extends in `multiple`). */
    onZoneSelectionChange?: SubtypeExprOrValue<FunctionType<[SchematicZoneSelectionEventType], NullType>>;
    /** Optional connect-gesture mode (`"draw"` adds a physical link locally, form-input style; `"connect"` is event-only and repeatable — the plan-an-operation channel); absent ⇒ draw. */
    linkMode?: SubtypeExprOrValue<SchematicLinkModeType> | SchematicLinkModeLiteral;
    /** Optional link-creation callback ({@link SchematicLinkCreateEventType}) — fired on every committed connect gesture with the newest link, the accumulated Shift-session (`links`), and the pair's `existing` links. */
    onCreateLink?: SubtypeExprOrValue<FunctionType<[SchematicLinkCreateEventType], NullType>>;
    /** Optional link-click callback (receives the link key) — the link analogue of `onSelect`. */
    onSelectLink?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional link-edit callback ({@link SchematicLinkEditEventType}) — fired after an endpoint connector re-target with the endpoints AFTER the edit. */
    onEditLink?: SubtypeExprOrValue<FunctionType<[SchematicLinkEditEventType], NullType>>;
    /** Optional link-delete callback (receives the deleted link's key). */
    onDeleteLink?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Master read-only switch — disables ALL editing affordances; default false. */
    readOnly?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Read-only for LINK editing only (connect tool, connectors, delete); effective = `readOnly || readOnlyLinks`; default false. */
    readOnlyLinks?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Read-only for ITEM editing only (the move tool); effective = `readOnly || readOnlyItems`; default false. */
    readOnlyItems?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional item-move callback ({@link SchematicItemMoveEventType}) — fired once per move-tool gesture on release; group move rides the current selection. */
    onMoveItem?: SubtypeExprOrValue<FunctionType<[SchematicItemMoveEventType], NullType>>;
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
                excluded: r.excluded !== undefined ? some(r.excluded) : none,
                layer: r.layer !== undefined ? some(r.layer) : none,
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
                    layer: r.layer !== undefined ? some(r.layer) : none,
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
                    label: r.label !== undefined ? some(r.label) : none,
                    metric: r.metric !== undefined ? some(r.metric) : none,
                    style: r.style !== undefined
                        ? r.style
                        : East.value(solid(), SchematicLinkStyleType),
                    route: r.route !== undefined
                        ? r.route
                        : East.value(variant("orthogonal", { corner: none }), SchematicRouteType),
                    via: r.via !== undefined
                        ? East.value(r.via, ArrayType(SchematicPointType))
                        : East.value([], ArrayType(SchematicPointType)),
                    layer: r.layer !== undefined ? some(r.layer) : none,
                }, SchematicLinkType);
            });

    const netMapper = config.net;
    const resolvedNets = config.nets === undefined
        ? East.value([], ArrayType(SchematicNetType))
        : netMapper === undefined
            ? East.value(config.nets as SubtypeExprOrValue<ArrayType<SchematicNetType>>, ArrayType(SchematicNetType))
            : (East.value(config.nets) as ExprType<ArrayType<StructType>>).map((_$, row) => {
                const r = netMapper(row);
                return East.value({
                    key: r.key,
                    sources: East.value(r.sources, ArrayType(StringType)),
                    destinations: East.value(r.destinations, ArrayType(StringType)),
                    label: r.label !== undefined ? some(r.label) : none,
                    metric: r.metric !== undefined ? some(r.metric) : none,
                    style: r.style !== undefined
                        ? r.style
                        : East.value(solid(), SchematicLinkStyleType),
                    route: r.route !== undefined
                        ? r.route
                        : East.value(variant("orthogonal", { corner: none }), SchematicRouteType),
                    via: r.via !== undefined
                        ? East.value(r.via, ArrayType(SchematicPointType))
                        : East.value([], ArrayType(SchematicPointType)),
                    layer: r.layer !== undefined ? some(r.layer) : none,
                }, SchematicNetType);
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
        nets: resolvedNets,
        scaleUnit: config.scaleUnit !== undefined ? some(config.scaleUnit) : none,
        grid: config.grid !== undefined ? some(config.grid) : none,
        navigator: config.navigator !== undefined ? some(config.navigator) : none,
        minimap: config.minimap !== undefined ? some(config.minimap) : none,
        slice: sliceChromeValue ? some(sliceChromeValue) : none,
        // Flat slice-effect props → the flat effect struct (each field static or
        // reactive via its `SubtypeExprOrValue`); `some` only when any is set.
        sliceEffect: (config.sliceHidden ?? config.sliceOpacity ?? config.sliceDesaturate
            ?? config.sliceDot ?? config.sliceEmphasis ?? config.sliceFrame ?? config.sliceFrameFit) !== undefined
            ? some(East.value({
                hidden: config.sliceHidden !== undefined ? some(config.sliceHidden) : none,
                opacity: config.sliceOpacity !== undefined ? some(config.sliceOpacity) : none,
                desaturate: config.sliceDesaturate !== undefined ? some(config.sliceDesaturate) : none,
                dot: config.sliceDot !== undefined ? some(config.sliceDot) : none,
                emphasis: emphasisOption(config.sliceEmphasis),
                frame: config.sliceFrame !== undefined ? some(config.sliceFrame) : none,
                frameFit: config.sliceFrameFit !== undefined ? some(config.sliceFrameFit) : none,
            }, SchematicSliceEffectType))
            : none,
        layers: config.layers !== undefined
            ? some(East.value(config.layers.map(toLayer), ArrayType(SchematicLayerType)))
            : none,
        height: config.height !== undefined ? some(config.height) : none,
        onSelect: config.onSelect !== undefined ? some(config.onSelect) : none,
        selectionMode: config.selectionMode !== undefined
            ? some(typeof config.selectionMode === "string" ? variant(config.selectionMode, null) : config.selectionMode)
            : none,
        onSelectionChange: config.onSelectionChange !== undefined ? some(config.onSelectionChange) : none,
        sliceSelectField: config.sliceSelectField !== undefined ? some(config.sliceSelectField) : none,
        selectZoomFocus: config.selectZoomFocus !== undefined ? some(config.selectZoomFocus) : none,
        onViewportChange: config.onViewportChange !== undefined ? some(config.onViewportChange) : none,
        onItemOpen: config.onItemOpen !== undefined ? some(config.onItemOpen) : none,
        onSelectZone: config.onSelectZone !== undefined ? some(config.onSelectZone) : none,
        onZoneSelectionChange: config.onZoneSelectionChange !== undefined ? some(config.onZoneSelectionChange) : none,
        linkMode: config.linkMode !== undefined
            ? some(typeof config.linkMode === "string" ? variant(config.linkMode, null) : config.linkMode)
            : none,
        onCreateLink: config.onCreateLink !== undefined ? some(config.onCreateLink) : none,
        onSelectLink: config.onSelectLink !== undefined ? some(config.onSelectLink) : none,
        onEditLink: config.onEditLink !== undefined ? some(config.onEditLink) : none,
        onDeleteLink: config.onDeleteLink !== undefined ? some(config.onDeleteLink) : none,
        readOnly: config.readOnly !== undefined ? some(config.readOnly) : none,
        readOnlyLinks: config.readOnlyLinks !== undefined ? some(config.readOnlyLinks) : none,
        readOnlyItems: config.readOnlyItems !== undefined ? some(config.readOnlyItems) : none,
        onMoveItem: config.onMoveItem !== undefined ? some(config.onMoveItem) : none,
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
    N extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    items: I,
    config: SchematicConfig<RowElement<I>, RowElement<Z>, RowElement<L>, RowElement<N>> & { zones?: Z; links?: L; nets?: N },
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
        /**
         * A named layer — a toggleable group of items / zones / links.
         *
         * @property key - Layer identity (entities reference it via `layer`)
         * @property label - Panel display name
         * @property visible - Author default visibility
         * @property locked - Author default lock (non-selectable)
         * @property opacity - Item dim (0–1)
         * @property tone - Panel swatch tone
         */
        Layer: SchematicLayerType,
        /**
         * The flat slice-driven render effect struct (mirrors the `slice*` props).
         */
        SliceEffect: SchematicSliceEffectType,
        /**
         * Matched-item emphasis (`halo` / `pulse`) — annotate `State` with it to
         * drive `sliceEmphasis` reactively.
         */
        Emphasis: SchematicEmphasisType,
        /**
         * Selection cardinality (`single` / `multiple` / `range`) — drive
         * `selectionMode` reactively or read it back.
         */
        SelectionMode: SchematicSelectionModeType,
        /**
         * A world-coordinate rectangle swept by a marquee gesture.
         *
         * @property minX - Left edge (world units)
         * @property minY - Top edge (world units)
         * @property maxX - Right edge (world units)
         * @property maxY - Bottom edge (world units)
         */
        Region: SchematicRegionType,
        /**
         * Selection-set change event passed to `onSelectionChange`.
         *
         * @property key - The item that triggered the change (some for a tap; none for marquee / clear)
         * @property selected - Whether `key` is now selected; for bulk changes, whether the set is non-empty
         * @property selectedKeys - The full selected set after the gesture
         * @property additive - Whether the gesture added to the prior selection vs replaced it
         * @property region - The world rectangle a marquee swept (some for a marquee; none otherwise)
         */
        SelectionEvent: SchematicSelectionEventType,
        /**
         * Viewport-settled event passed to `onViewportChange` — the camera zoom
         * plus the visible world rectangle, debounced to gesture settle points.
         *
         * @property zoom - The settled camera zoom (1 = fully zoomed out)
         * @property minX - Left edge of the visible world rect
         * @property minY - Top edge of the visible world rect
         * @property maxX - Right edge of the visible world rect
         * @property maxY - Bottom edge of the visible world rect
         */
        ViewportEvent: SchematicViewportEventType,
        /**
         * Zone selection-set change event passed to `onZoneSelectionChange` —
         * the selected zones plus the item keys inside them.
         *
         * @property key - The zone that triggered the change (some for a tap; none for a clear)
         * @property selected - Whether `key` is now selected; for bulk changes, whether the set is non-empty
         * @property selectedKeys - The full selected zone set after the gesture
         * @property childItemKeys - Item keys inside the selected zones (nested descendants included)
         * @property additive - Whether the gesture added to the prior selection vs replaced it
         */
        ZoneSelectionEvent: SchematicZoneSelectionEventType,
        /**
         * Connect-gesture mode (`draw` | `connect`) — `draw` adds a physical
         * link locally; `connect` is event-only and repeatable.
         */
        LinkMode: SchematicLinkModeType,
        /**
         * One connection's endpoints — the unit a connect gesture produces.
         *
         * @property key - Renderer-generated key for the gesture's connection
         * @property from - Source item key
         * @property to - Destination item key
         */
        LinkEndpoints: SchematicLinkEndpointsType,
        /**
         * Link-creation event passed to `onCreateLink` — the newest link, the
         * accumulated Shift-session, and the pair's existing links.
         *
         * @property link - The newest connection (this drag)
         * @property links - The full session set, `link` included
         * @property additive - True when Shift extended an open session
         * @property existing - Keys of links already joining the newest pair
         */
        LinkCreateEvent: SchematicLinkCreateEventType,
        /**
         * Link-edit event passed to `onEditLink` — the endpoints AFTER an
         * endpoint connector re-target.
         *
         * @property key - The edited link's key
         * @property from - Source item key after the edit
         * @property to - Destination item key after the edit
         */
        LinkEditEvent: SchematicLinkEditEventType,
        /**
         * A net — a manifold / bus link (many `sources` → many `destinations`,
         * drawn as a trunk with branches).
         *
         * @property key - Net identity
         * @property sources - Source item keys
         * @property destinations - Destination item keys
         * @property label - Optional mid-trunk label
         * @property metric - Optional mid-trunk metric (muted)
         * @property style - Stroke style for the whole net
         * @property route - Trunk routing mode
         * @property via - Optional trunk waypoints
         * @property layer - Optional layer membership
         */
        Net: SchematicNetType,
        /**
         * A connect-session collapsed to net endpoints (stable session `key`)
         * — carried on every `onCreateLink` for upsert-style handlers.
         *
         * @property key - The session key (stable across the session's commits)
         * @property sources - Distinct source item keys so far
         * @property destinations - Distinct destination item keys so far
         */
        NetEndpoints: SchematicNetEndpointsType,
        /**
         * Item-move event passed to `onMoveItem` — the pressed item's final
         * position, every moved key (group move rides the selection), and the
         * shared world delta.
         *
         * @property key - The pressed item's key
         * @property x - Final world x
         * @property y - Final world y
         * @property keys - Every moved item (`key` included)
         * @property dx - Shared world x delta
         * @property dy - Shared world y delta
         */
        ItemMoveEvent: SchematicItemMoveEventType,
    },
} as const;
