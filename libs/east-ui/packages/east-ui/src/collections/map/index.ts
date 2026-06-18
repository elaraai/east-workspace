/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `Map` — an interactive geographic basemap (CARTO / OSM raster tiles) with
 * H3 hex and filled-area overlays, connector lines, pins, standalone labels,
 * and a generalised overlay slot that hosts arbitrary East `UIComponent`
 * children (a HUD, a legend, a back button) positioned over the canvas.
 * **Read-only / selection-only**: click an area (returns its key), zoom, and
 * fly to; any writes ride in through ordinary `Button` children in the
 * overlay slot. Colour stays theme-owned — data selects a `tone` / `status`
 * and the renderer's recipe maps each to a token.
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
    BooleanType,
    FloatType,
    FunctionType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
} from "@elaraai/east";

import { UIComponentType } from "../../component.js";
import { AlignType, type AlignLiteral } from "../../style/content.js";
import { type StatusTokenType } from "../../style/interaction.js";
import { type IconName } from "../../display/icon/types.js";
import {
    MapLatLngType,
    MapToneType,
    MapCartoStyleType,
    MapTileType,
    MapFocusType,
    MapAreaShapeType,
    MapAreaType,
    MapHexLayerType,
    MapMarkerType,
    MapLineStyleType,
    MapLineType,
    MapLabelType,
} from "./types.js";

// Re-export types
export {
    MapLatLngType,
    MapToneType,
    MapCartoStyleType,
    MapTileType,
    MapFocusType,
    MapAreaShapeType,
    MapAreaType,
    MapHexLayerType,
    MapMarkerType,
    MapLineStyleType,
    MapLineType,
    MapLabelType,
} from "./types.js";

/** String literal form of {@link MapToneType} tags. */
export type MapToneLiteral = "brand" | "ink" | "muted" | "success" | "warning" | "danger";

/** String literal form of {@link MapCartoStyleType} tags. */
export type MapCartoLiteral = "positron" | "darkMatter" | "voyager";

function toneValue(tone: MapToneLiteral | undefined) {
    return tone !== undefined ? some(variant(tone, null)) : none;
}

/** Wrap a `tone` override into its option — accepts a string literal shorthand
 *  (`"brand"`) or an East tone expression / value. */
function toneOption(tone: SubtypeExprOrValue<MapToneType> | MapToneLiteral | undefined) {
    if (tone === undefined) return none;
    return typeof tone === "string" ? some(variant(tone, null)) : some(tone);
}

function buildAlign(a: AlignLiteral | SubtypeExprOrValue<AlignType>): SubtypeExprOrValue<AlignType> {
    return typeof a === "string" ? East.value(variant(a, null), AlignType) : a;
}

// ============================================================================
// Geometry + style sub-builders
// ============================================================================

/**
 * Builds a geographic point value.
 *
 * @param lat - Latitude in degrees
 * @param lng - Longitude in degrees
 * @returns A `MapLatLngType` value
 */
function at(lat: SubtypeExprOrValue<FloatType>, lng: SubtypeExprOrValue<FloatType>): ExprType<MapLatLngType> {
    return East.value({ lat, lng }, MapLatLngType);
}

/**
 * Builds a CARTO raster basemap.
 *
 * @param style - The CARTO preset (default `positron`)
 * @returns A `MapTileType` value
 */
function carto(style: MapCartoLiteral = "positron"): ExprType<MapTileType> {
    return East.value(variant("carto", { style: variant(style, null) }), MapTileType);
}

/**
 * Builds an OpenStreetMap raster basemap.
 *
 * @returns A `MapTileType` value
 */
function osm(): ExprType<MapTileType> {
    return East.value(variant("osm", null), MapTileType);
}

/** Configuration for {@link tile} — a raw XYZ basemap. */
export interface MapTileConfig {
    /** XYZ tile URL template. */
    url: SubtypeExprOrValue<StringType>;
    /** Attribution HTML kept visible in the corner. */
    attribution: SubtypeExprOrValue<StringType>;
    /** Optional `{s}` subdomain list. */
    subdomains?: SubtypeExprOrValue<ArrayType<StringType>>;
    /** Optional max zoom for the layer. */
    maxZoom?: SubtypeExprOrValue<IntegerType>;
    /** Optional retina `{r}` tiles. */
    detectRetina?: SubtypeExprOrValue<BooleanType> | boolean;
}

/**
 * Builds a raw XYZ basemap with explicit attribution.
 *
 * @param config - The tile URL, attribution, and optional `subdomains` / `maxZoom` / `detectRetina`
 * @returns A `MapTileType` value
 */
function tile(config: MapTileConfig): ExprType<MapTileType> {
    return East.value(variant("custom", {
        url: config.url,
        attribution: config.attribution,
        subdomains: config.subdomains !== undefined ? some(config.subdomains) : none,
        maxZoom: config.maxZoom !== undefined ? some(config.maxZoom) : none,
        detectRetina: config.detectRetina !== undefined ? some(config.detectRetina) : none,
    }), MapTileType);
}

/**
 * Builds an `hexDisk` area shape — a `gridDisk(origin, k)` blob at a resolution.
 *
 * @param center - The disk origin
 * @param k - Ring count around the origin
 * @param resolution - H3 resolution
 * @returns A `MapAreaShapeType` value
 */
function hexDisk(
    center: SubtypeExprOrValue<MapLatLngType>,
    k: SubtypeExprOrValue<IntegerType>,
    resolution: SubtypeExprOrValue<IntegerType>,
): ExprType<MapAreaShapeType> {
    return East.value(variant("hexDisk", { center, k, resolution }), MapAreaShapeType);
}

/**
 * Builds a `cells` area shape — an explicit set of H3 cell ids.
 *
 * @param ids - The H3 cell ids
 * @returns A `MapAreaShapeType` value
 */
function cells(ids: SubtypeExprOrValue<ArrayType<StringType>>): ExprType<MapAreaShapeType> {
    return East.value(variant("cells", ids), MapAreaShapeType);
}

/**
 * Builds a `polygon` area shape — an explicit ring of points (an irregular
 * region boundary). Two polygons that share an edge abut exactly, so adjacent
 * regions running up against each other are authored by reusing the shared
 * boundary points in both.
 *
 * @param points - The boundary points, in order (auto-closed; `Map.at(...)`)
 * @returns A `MapAreaShapeType` value
 */
function polygon(points: SubtypeExprOrValue<ArrayType<MapLatLngType>>): ExprType<MapAreaShapeType> {
    return East.value(variant("polygon", points), MapAreaShapeType);
}

/**
 * Builds a `point` camera target — centre on a point at a zoom level.
 *
 * @param center - The centre
 * @param zoom - The zoom level to settle at
 * @returns A `MapFocusType` value
 */
function point(center: SubtypeExprOrValue<MapLatLngType>, zoom: SubtypeExprOrValue<IntegerType>): ExprType<MapFocusType> {
    return East.value(variant("point", { center, zoom }), MapFocusType);
}

/**
 * Builds a `bounds` camera target — frame a south-west / north-east box.
 *
 * @param sw - South-west corner
 * @param ne - North-east corner
 * @returns A `MapFocusType` value
 */
function bounds(sw: SubtypeExprOrValue<MapLatLngType>, ne: SubtypeExprOrValue<MapLatLngType>): ExprType<MapFocusType> {
    return East.value(variant("bounds", { sw, ne }), MapFocusType);
}

/** Stroke configuration for {@link solid} / {@link dashed}. */
export interface MapLineStyleConfig {
    /** Stroke tone. */
    tone?: MapToneLiteral;
    /** Stroke width in px. */
    weight?: number;
}

/**
 * Builds a `solid` line style.
 *
 * @param config - Optional stroke configuration (`tone`, `weight`)
 * @returns A `MapLineStyleType` value
 */
function solid(config?: MapLineStyleConfig): ExprType<MapLineStyleType> {
    return East.value(variant("solid", {
        tone: toneValue(config?.tone),
        weight: config?.weight !== undefined ? some(config.weight) : none,
    }), MapLineStyleType);
}

/**
 * Builds a `dashed` line style.
 *
 * @param config - Optional stroke configuration (`tone`, `weight`)
 * @returns A `MapLineStyleType` value
 */
function dashed(config?: MapLineStyleConfig): ExprType<MapLineStyleType> {
    return East.value(variant("dashed", {
        tone: toneValue(config?.tone),
        weight: config?.weight !== undefined ? some(config.weight) : none,
    }), MapLineStyleType);
}

/** Configuration for {@link hex}. */
export interface MapHexConfig {
    /** Optional faint background lattice (a disk of cells around a centre). */
    lattice?: {
        /** The lattice centre. */
        center: SubtypeExprOrValue<MapLatLngType>;
        /** Ring count around the centre. */
        k: SubtypeExprOrValue<IntegerType>;
        /** H3 resolution. */
        resolution: SubtypeExprOrValue<IntegerType>;
    };
    /** Optional per-cell detail. */
    cells?: readonly MapHexCellInput[];
    /** Optional lattice stroke tone (default `muted`). */
    tone?: SubtypeExprOrValue<MapToneType> | MapToneLiteral;
    /** Optional click-through flag (default false — decorative). */
    interactive?: SubtypeExprOrValue<BooleanType> | boolean;
}

/** One per-cell detail entry for {@link hex}. */
export interface MapHexCellInput {
    /** H3 cell id. */
    id: SubtypeExprOrValue<StringType>;
    /** Optional status-token option for the cell fill. */
    status?: SubtypeExprOrValue<OptionType<StatusTokenType>>;
    /** Optional fill alpha (0–1). */
    fillOpacity?: SubtypeExprOrValue<FloatType>;
    /** Optional detail text shown only at/after `lodZoom`. */
    detail?: SubtypeExprOrValue<StringType>;
}

/**
 * Builds the hex layer — a faint background lattice plus optional per-cell
 * detail revealed at LOD.
 *
 * @param config - Optional `lattice`, `cells`, `tone`, and `interactive`
 * @returns A `MapHexLayerType` value
 */
function hex(config?: MapHexConfig): ExprType<MapHexLayerType> {
    return East.value({
        lattice: config?.lattice !== undefined
            ? some(East.value(
                { center: config.lattice.center, k: config.lattice.k, resolution: config.lattice.resolution },
                StructType({ center: MapLatLngType, k: IntegerType, resolution: IntegerType }),
            ))
            : none,
        cells: (config?.cells ?? []).map(c => ({
            id: c.id,
            status: c.status !== undefined ? c.status : none,
            fillOpacity: c.fillOpacity !== undefined ? some(c.fillOpacity) : none,
            detail: c.detail !== undefined ? some(c.detail) : none,
        })),
        tone: toneOption(config?.tone),
        interactive: config?.interactive !== undefined ? some(config.interactive) : none,
    }, MapHexLayerType);
}

// ============================================================================
// Overlay slot
// ============================================================================

/**
 * The generalised overlay slot value — an East `UIComponent` positioned over
 * the map, either screen-anchored (`align` / `verticalAlign`) or pinned to a
 * coordinate (`geoAnchor`).
 *
 * @property content - The East child tree rendered over the canvas
 * @property align - Horizontal screen anchor
 * @property verticalAlign - Vertical screen anchor
 * @property key - Optional stable child storage-key segment
 * @property geoAnchor - Optional coordinate the overlay follows on pan / zoom
 * @property offset - Optional px nudge from the anchor
 * @property interactive - Optional pointer-events flag (default true)
 */
export const MapOverlayType = StructType({
    /** The East child tree rendered over the canvas */
    content: UIComponentType,
    /** Horizontal screen anchor */
    align: AlignType,
    /** Vertical screen anchor */
    verticalAlign: AlignType,
    /** Optional stable child storage-key segment */
    key: OptionType(StringType),
    /** Optional coordinate the overlay follows on pan / zoom */
    geoAnchor: OptionType(MapLatLngType),
    /** Optional px nudge from the anchor */
    offset: OptionType(StructType({ x: FloatType, y: FloatType })),
    /** Optional pointer-events flag (default true; false ⇒ click-through) */
    interactive: OptionType(BooleanType),
});

/**
 * Type representing the overlay slot.
 */
export type MapOverlayType = typeof MapOverlayType;

/** A positioned overlay child, as produced by {@link overlay}. */
export type MapOverlayInput = ExprType<MapOverlayType>;

/** Options for {@link overlay}. */
export interface MapOverlayOptions {
    /** Horizontal screen anchor (default `start`). */
    align?: AlignLiteral | SubtypeExprOrValue<AlignType>;
    /** Vertical screen anchor (default `start`). */
    verticalAlign?: AlignLiteral | SubtypeExprOrValue<AlignType>;
    /** Optional stable child storage-key segment. */
    key?: SubtypeExprOrValue<StringType>;
    /** Optional coordinate the overlay follows on pan / zoom. */
    geoAnchor?: SubtypeExprOrValue<MapLatLngType>;
    /** Optional px nudge from the anchor. */
    offset?: { x: SubtypeExprOrValue<FloatType>; y: SubtypeExprOrValue<FloatType> };
    /** Optional pointer-events flag (default true; false ⇒ click-through). */
    interactive?: SubtypeExprOrValue<BooleanType> | boolean;
}

/**
 * Builds a positioned overlay child for the `overlays` slot.
 *
 * @param content - The East child tree (a HUD, legend, back button)
 * @param options - Anchor / offset / interactivity options
 * @returns A `MapOverlayType` value
 */
function overlay(content: SubtypeExprOrValue<UIComponentType>, options?: MapOverlayOptions): MapOverlayInput {
    return East.value({
        content,
        align: buildAlign(options?.align ?? "start"),
        verticalAlign: buildAlign(options?.verticalAlign ?? "start"),
        key: options?.key !== undefined ? some(options.key) : none,
        geoAnchor: options?.geoAnchor !== undefined ? some(options.geoAnchor) : none,
        offset: options?.offset !== undefined
            ? some(East.value({ x: options.offset.x, y: options.offset.y }, StructType({ x: FloatType, y: FloatType })))
            : none,
        interactive: options?.interactive !== undefined ? some(options.interactive) : none,
    }, MapOverlayType);
}

/**
 * The struct element type of a `SubtypeExprOrValue<ArrayType<StructType>>`.
 */
export type RowElement<T extends SubtypeExprOrValue<ArrayType<StructType>>> =
    TypeOf<T> extends ArrayType<infer S> ? (S extends StructType ? S : never) : never;

// ============================================================================
// Row fields + resolvers (each resolver doubles as a public sub-constructor)
// ============================================================================

/**
 * Fields the `marker` mapper returns — one pin, before defaults.
 *
 * @property key - Marker identity — `onMarkerClick` returns it
 * @property lat - Latitude in degrees
 * @property lng - Longitude in degrees
 * @property label - Optional permanent tooltip
 * @property icon - Optional Font Awesome solid icon (static name or expression)
 * @property tone - Optional marker tone
 * @property minZoom - Optional LOD gate; the pin appears only at/after this zoom
 * @property interactive - Optional click flag (default true)
 */
export interface MapMarkerFields {
    /** Marker identity — `onMarkerClick` returns it. */
    key: SubtypeExprOrValue<StringType>;
    /** Latitude in degrees. */
    lat: SubtypeExprOrValue<FloatType>;
    /** Longitude in degrees. */
    lng: SubtypeExprOrValue<FloatType>;
    /** Optional permanent tooltip. */
    label?: SubtypeExprOrValue<StringType>;
    /** Optional Font Awesome solid icon (static name or expression). */
    icon?: IconName | ExprType<StringType>;
    /** Optional marker tone. */
    tone?: SubtypeExprOrValue<MapToneType> | MapToneLiteral;
    /** Optional LOD gate; the pin appears only at/after this zoom. */
    minZoom?: SubtypeExprOrValue<IntegerType>;
    /** Optional click flag (default true). */
    interactive?: SubtypeExprOrValue<BooleanType> | boolean;
}

/**
 * Builds a resolved marker value.
 *
 * @param fields - The marker fields ({@link MapMarkerFields})
 * @returns A `MapMarkerType` value
 */
function marker(fields: MapMarkerFields): ExprType<MapMarkerType> {
    return East.value({
        key: fields.key,
        at: at(fields.lat, fields.lng),
        label: fields.label !== undefined ? some(fields.label) : none,
        icon: fields.icon !== undefined ? some(fields.icon) : none,
        tone: toneOption(fields.tone),
        minZoom: fields.minZoom !== undefined ? some(fields.minZoom) : none,
        interactive: fields.interactive !== undefined ? some(fields.interactive) : none,
    }, MapMarkerType);
}

/**
 * Fields the `area` mapper returns — one filled area, before defaults.
 *
 * @property key - Area identity — `onAreaClick` returns it
 * @property shape - The H3 / polygon boundary (`Map.hexDisk()` / `Map.cells()`)
 * @property label - Optional permanent tooltip
 * @property detailLabel - Optional richer label shown only at/after `lodZoom`
 * @property status - Optional status-token option; drives colour + pulse
 * @property tone - Optional explicit tone override; absent ⇒ `status` drives colour
 * @property color - Optional raw CSS colour; wins over `tone`
 * @property fillOpacity - Optional fill alpha (0–1)
 * @property weight - Optional stroke width in px
 * @property pulse - Optional explicit pulse override; absent ⇒ derived from `status`
 * @property flyTo - Optional click camera target; absent ⇒ frame the shape
 */
export interface MapAreaFields {
    /** Area identity — `onAreaClick` returns it. */
    key: SubtypeExprOrValue<StringType>;
    /** The H3 / polygon boundary (`Map.hexDisk()` / `Map.cells()`). */
    shape: SubtypeExprOrValue<MapAreaShapeType>;
    /** Optional permanent tooltip. */
    label?: SubtypeExprOrValue<StringType>;
    /** Optional richer label shown only at/after `lodZoom`. */
    detailLabel?: SubtypeExprOrValue<StringType>;
    /** Optional status-token option; drives colour + pulse. */
    status?: SubtypeExprOrValue<OptionType<StatusTokenType>>;
    /** Optional explicit tone override; absent ⇒ `status` drives colour. */
    tone?: SubtypeExprOrValue<MapToneType> | MapToneLiteral;
    /** Optional raw CSS colour (e.g. `"#2D7FF9"`); wins over `tone`. */
    color?: SubtypeExprOrValue<StringType>;
    /** Optional fill alpha (0–1). */
    fillOpacity?: SubtypeExprOrValue<FloatType>;
    /** Optional stroke width in px. */
    weight?: SubtypeExprOrValue<FloatType>;
    /** Optional explicit pulse override; absent ⇒ derived from `status`. */
    pulse?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional click camera target; absent ⇒ frame the shape. */
    flyTo?: SubtypeExprOrValue<MapFocusType>;
}

/**
 * Builds a resolved area value.
 *
 * @param fields - The area fields ({@link MapAreaFields})
 * @returns A `MapAreaType` value
 */
function area(fields: MapAreaFields): ExprType<MapAreaType> {
    return East.value({
        key: fields.key,
        shape: fields.shape,
        label: fields.label !== undefined ? some(fields.label) : none,
        detailLabel: fields.detailLabel !== undefined ? some(fields.detailLabel) : none,
        status: fields.status !== undefined ? fields.status : none,
        tone: toneOption(fields.tone),
        color: fields.color !== undefined ? some(fields.color) : none,
        fillOpacity: fields.fillOpacity !== undefined ? some(fields.fillOpacity) : none,
        weight: fields.weight !== undefined ? some(fields.weight) : none,
        pulse: fields.pulse !== undefined ? some(fields.pulse) : none,
        flyTo: fields.flyTo !== undefined ? some(fields.flyTo) : none,
    }, MapAreaType);
}

/**
 * Fields the `line` mapper returns — one connector, before defaults.
 *
 * @property key - Line identity
 * @property points - The polyline points, in order (`Map.at()`)
 * @property style - Optional style (default `Map.solid()`)
 * @property flow - Optional animated dash-offset when active
 * @property arrow - Optional arrowhead at the destination
 */
export interface MapLineFields {
    /** Line identity. */
    key: SubtypeExprOrValue<StringType>;
    /** The polyline points, in order (`Map.at()`). */
    points: SubtypeExprOrValue<ArrayType<MapLatLngType>>;
    /** Optional style (default `Map.solid()`). */
    style?: SubtypeExprOrValue<MapLineStyleType>;
    /** Optional animated dash-offset when active. */
    flow?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional arrowhead at the destination. */
    arrow?: SubtypeExprOrValue<BooleanType> | boolean;
}

/**
 * Builds a resolved line value.
 *
 * @param fields - The line fields ({@link MapLineFields})
 * @returns A `MapLineType` value
 */
function line(fields: MapLineFields): ExprType<MapLineType> {
    return East.value({
        key: fields.key,
        points: East.value(fields.points, ArrayType(MapLatLngType)),
        style: fields.style !== undefined ? fields.style : solid(),
        flow: fields.flow !== undefined ? some(fields.flow) : none,
        arrow: fields.arrow !== undefined ? some(fields.arrow) : none,
    }, MapLineType);
}

/**
 * Fields the `label` mapper returns — one standalone label, before defaults.
 *
 * @property key - Label identity
 * @property lat - Latitude in degrees
 * @property lng - Longitude in degrees
 * @property text - The label text
 */
export interface MapLabelFields {
    /** Label identity. */
    key: SubtypeExprOrValue<StringType>;
    /** Latitude in degrees. */
    lat: SubtypeExprOrValue<FloatType>;
    /** Longitude in degrees. */
    lng: SubtypeExprOrValue<FloatType>;
    /** The label text. */
    text: SubtypeExprOrValue<StringType>;
}

function label(fields: MapLabelFields): ExprType<MapLabelType> {
    return East.value({ key: fields.key, at: at(fields.lat, fields.lng), text: fields.text }, MapLabelType);
}

// ============================================================================
// Root type + factory
// ============================================================================

/**
 * East StructType for the Map component.
 *
 * @remarks
 * The `overlays` slot and (via `content`) any child trees are recursive
 * `UIComponentType` values; the registration in `component.ts` spells the
 * same shape with the recursion `node`.
 *
 * @property tiles - Basemap source
 * @property center - Initial centre
 * @property zoom - Initial zoom
 * @property minZoom - Optional minimum zoom clamp
 * @property maxZoom - Optional maximum zoom clamp
 * @property lodZoom - Optional detail-LOD threshold
 * @property fitBounds - Optional camera framing (alternative to center / zoom)
 * @property areas - Filled boundaries
 * @property hexes - Optional H3 lattice + per-cell detail
 * @property markers - Pins
 * @property lines - Connectors / move arrows
 * @property labels - Standalone labels
 * @property overlays - Positioned East children (HUD / legend / back)
 * @property scrollWheelZoom - Optional scroll-wheel zoom (default true)
 * @property attributionPrefix - Optional Leaflet prefix toggle (default false)
 * @property height - Optional fixed panel height
 * @property onAreaClick - Optional area-click callback (receives the area key)
 * @property onMarkerClick - Optional marker-click callback (receives the marker key)
 * @property onZoom - Optional zoom-end callback (receives the zoom level)
 * @property onSelect - Optional hex / marker selection callback (receives the key)
 */
export const MapRootType: StructType<{
    tiles: MapTileType,
    center: MapLatLngType,
    zoom: IntegerType,
    minZoom: OptionType<IntegerType>,
    maxZoom: OptionType<IntegerType>,
    lodZoom: OptionType<IntegerType>,
    fitBounds: OptionType<MapFocusType>,
    areas: ArrayType<MapAreaType>,
    hexes: OptionType<MapHexLayerType>,
    markers: ArrayType<MapMarkerType>,
    lines: ArrayType<MapLineType>,
    labels: ArrayType<MapLabelType>,
    overlays: ArrayType<MapOverlayType>,
    scrollWheelZoom: OptionType<BooleanType>,
    attributionPrefix: OptionType<BooleanType>,
    height: OptionType<StringType>,
    onAreaClick: OptionType<FunctionType<[StringType], NullType>>,
    onMarkerClick: OptionType<FunctionType<[StringType], NullType>>,
    onZoom: OptionType<FunctionType<[IntegerType], NullType>>,
    onSelect: OptionType<FunctionType<[StringType], NullType>>,
}> = StructType({
    tiles: MapTileType,
    center: MapLatLngType,
    zoom: IntegerType,
    minZoom: OptionType(IntegerType),
    maxZoom: OptionType(IntegerType),
    lodZoom: OptionType(IntegerType),
    fitBounds: OptionType(MapFocusType),
    areas: ArrayType(MapAreaType),
    hexes: OptionType(MapHexLayerType),
    markers: ArrayType(MapMarkerType),
    lines: ArrayType(MapLineType),
    labels: ArrayType(MapLabelType),
    overlays: ArrayType(MapOverlayType),
    scrollWheelZoom: OptionType(BooleanType),
    attributionPrefix: OptionType(BooleanType),
    height: OptionType(StringType),
    onAreaClick: OptionType(FunctionType([StringType], NullType)),
    onMarkerClick: OptionType(FunctionType([StringType], NullType)),
    onZoom: OptionType(FunctionType([IntegerType], NullType)),
    onSelect: OptionType(FunctionType([StringType], NullType)),
});

/**
 * Type representing the Map component.
 */
export type MapRootType = typeof MapRootType;

/**
 * Configuration for {@link createMap}.
 *
 * @typeParam M - The markers row struct
 * @typeParam A - The areas row struct
 * @typeParam La - The labels row struct
 * @typeParam L - The lines row struct
 * @property tiles - Optional basemap (default `Map.carto("positron")`)
 * @property center - Initial centre (`Map.at(lat, lng)`)
 * @property zoom - Initial zoom
 * @property minZoom - Optional minimum zoom clamp
 * @property maxZoom - Optional maximum zoom clamp
 * @property lodZoom - Optional detail-LOD threshold
 * @property fitBounds - Optional camera framing (alternative to center / zoom)
 * @property marker - Markers row mapper (omit when rows are already resolved)
 * @property areas - Optional areas table
 * @property area - Areas row mapper (omit when rows are already resolved)
 * @property hexes - Optional H3 lattice + per-cell detail (`Map.hex()`)
 * @property labels - Optional labels table
 * @property label - Labels row mapper (omit when rows are already resolved)
 * @property lines - Optional lines table
 * @property line - Lines row mapper (omit when rows are already resolved)
 * @property overlays - Positioned East children (`Map.overlay()`)
 * @property scrollWheelZoom - Optional scroll-wheel zoom (default true)
 * @property attributionPrefix - Optional Leaflet prefix toggle (default false)
 * @property height - Optional fixed panel height
 * @property onAreaClick - Optional area-click callback (receives the area key)
 * @property onMarkerClick - Optional marker-click callback (receives the marker key)
 * @property onZoom - Optional zoom-end callback (receives the zoom level)
 * @property onSelect - Optional hex / marker selection callback (receives the key)
 */
export interface MapConfig<
    M extends StructType,
    A extends StructType,
    La extends StructType,
    L extends StructType,
> {
    /** Optional basemap (default `Map.carto("positron")`). */
    tiles?: SubtypeExprOrValue<MapTileType>;
    /** Initial centre (`Map.at(lat, lng)`). */
    center: SubtypeExprOrValue<MapLatLngType>;
    /** Initial zoom. */
    zoom: SubtypeExprOrValue<IntegerType>;
    /** Optional minimum zoom clamp. */
    minZoom?: SubtypeExprOrValue<IntegerType>;
    /** Optional maximum zoom clamp. */
    maxZoom?: SubtypeExprOrValue<IntegerType>;
    /** Optional detail-LOD threshold; zoom ≥ this ⇒ detail. */
    lodZoom?: SubtypeExprOrValue<IntegerType>;
    /** Optional camera framing (alternative to `center` / `zoom`). */
    fitBounds?: SubtypeExprOrValue<MapFocusType>;
    /** Markers row mapper; omit when `markers` is already `ArrayType(Map.Types.Marker)`. */
    marker?: (m: ExprType<M>) => MapMarkerFields;
    /** Optional areas table. */
    areas?: SubtypeExprOrValue<ArrayType<A>>;
    /** Areas row mapper; omit when `areas` is already `ArrayType(Map.Types.Area)`. */
    area?: (a: ExprType<A>) => MapAreaFields;
    /** Optional H3 lattice + per-cell detail (`Map.hex()`). */
    hexes?: SubtypeExprOrValue<MapHexLayerType>;
    /** Optional labels table. */
    labels?: SubtypeExprOrValue<ArrayType<La>>;
    /** Labels row mapper; omit when `labels` is already `ArrayType(Map.Types.Label)`. */
    label?: (s: ExprType<La>) => MapLabelFields;
    /** Optional lines table. */
    lines?: SubtypeExprOrValue<ArrayType<L>>;
    /** Lines row mapper; omit when `lines` is already `ArrayType(Map.Types.Line)`. */
    line?: (l: ExprType<L>) => MapLineFields;
    /** Positioned East children (`Map.overlay()`). */
    overlays?: readonly MapOverlayInput[];
    /** Optional scroll-wheel zoom (default true). */
    scrollWheelZoom?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional Leaflet prefix toggle (default false — strips it, keeps the tile credit). */
    attributionPrefix?: SubtypeExprOrValue<BooleanType> | boolean;
    /** Optional fixed panel height (any CSS length, e.g. `"540px"`). */
    height?: SubtypeExprOrValue<StringType> | string;
    /** Optional area-click callback (receives the area key). */
    onAreaClick?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional marker-click callback (receives the marker key). */
    onMarkerClick?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
    /** Optional zoom-end callback (receives the zoom level). */
    onZoom?: SubtypeExprOrValue<FunctionType<[IntegerType], NullType>>;
    /** Optional hex / marker selection callback (receives the key). */
    onSelect?: SubtypeExprOrValue<FunctionType<[StringType], NullType>>;
}

function buildRoot(
    markers: SubtypeExprOrValue<ArrayType<StructType>>,
    config: MapConfig<StructType, StructType, StructType, StructType>,
): ExprType<UIComponentType> {
    const markerMapper = config.marker;
    const resolvedMarkers = markerMapper === undefined
        ? East.value(markers as SubtypeExprOrValue<ArrayType<MapMarkerType>>, ArrayType(MapMarkerType))
        : (East.value(markers) as ExprType<ArrayType<StructType>>).map((_$, row) => {
            const r: MapMarkerFields | ExprType<MapMarkerType> = markerMapper(row);
            if (r instanceof Expr) return East.value(r, MapMarkerType);
            return marker(r);
        });

    const areaMapper = config.area;
    const resolvedAreas = config.areas === undefined
        ? East.value([], ArrayType(MapAreaType))
        : areaMapper === undefined
            ? East.value(config.areas as SubtypeExprOrValue<ArrayType<MapAreaType>>, ArrayType(MapAreaType))
            : (East.value(config.areas) as ExprType<ArrayType<StructType>>).map((_$, row) => {
                const r: MapAreaFields | ExprType<MapAreaType> = areaMapper(row);
                if (r instanceof Expr) return East.value(r, MapAreaType);
                return area(r);
            });

    const labelMapper = config.label;
    const resolvedLabels = config.labels === undefined
        ? East.value([], ArrayType(MapLabelType))
        : labelMapper === undefined
            ? East.value(config.labels as SubtypeExprOrValue<ArrayType<MapLabelType>>, ArrayType(MapLabelType))
            : (East.value(config.labels) as ExprType<ArrayType<StructType>>).map((_$, row) => {
                const r: MapLabelFields | ExprType<MapLabelType> = labelMapper(row);
                if (r instanceof Expr) return East.value(r, MapLabelType);
                return label(r);
            });

    const lineMapper = config.line;
    const resolvedLines = config.lines === undefined
        ? East.value([], ArrayType(MapLineType))
        : lineMapper === undefined
            ? East.value(config.lines as SubtypeExprOrValue<ArrayType<MapLineType>>, ArrayType(MapLineType))
            : (East.value(config.lines) as ExprType<ArrayType<StructType>>).map((_$, row) => {
                const r: MapLineFields | ExprType<MapLineType> = lineMapper(row);
                if (r instanceof Expr) return East.value(r, MapLineType);
                return line(r);
            });

    return East.value(variant("Map", {
        tiles: config.tiles !== undefined ? config.tiles : carto("positron"),
        center: config.center,
        zoom: config.zoom,
        minZoom: config.minZoom !== undefined ? some(config.minZoom) : none,
        maxZoom: config.maxZoom !== undefined ? some(config.maxZoom) : none,
        lodZoom: config.lodZoom !== undefined ? some(config.lodZoom) : none,
        fitBounds: config.fitBounds !== undefined ? some(config.fitBounds) : none,
        areas: resolvedAreas,
        hexes: config.hexes !== undefined ? some(config.hexes) : none,
        markers: resolvedMarkers,
        lines: resolvedLines,
        labels: resolvedLabels,
        overlays: config.overlays !== undefined
            ? East.value([...config.overlays], ArrayType(MapOverlayType))
            : East.value([], ArrayType(MapOverlayType)),
        scrollWheelZoom: config.scrollWheelZoom !== undefined ? some(config.scrollWheelZoom) : none,
        attributionPrefix: config.attributionPrefix !== undefined ? some(config.attributionPrefix) : none,
        height: config.height !== undefined ? some(config.height) : none,
        onAreaClick: config.onAreaClick !== undefined ? some(config.onAreaClick) : none,
        onMarkerClick: config.onMarkerClick !== undefined ? some(config.onMarkerClick) : none,
        onZoom: config.onZoom !== undefined ? some(config.onZoom) : none,
        onSelect: config.onSelect !== undefined ? some(config.onSelect) : none,
    }), UIComponentType);
}

/**
 * Creates a Map — an interactive geographic basemap with H3 / area overlays
 * and a generalised East-child overlay slot.
 *
 * @typeParam M - The markers-table input
 * @typeParam A - The areas-table input
 * @typeParam La - The labels-table input
 * @typeParam L - The lines-table input
 * @param markers - The pin rows (the required first table)
 * @param config - The Map configuration ({@link MapConfig})
 * @returns An East expression of `UIComponentType`
 *
 * @example
 * ```ts
 * import { East } from "@elaraai/east";
 * import { Map, UIComponentType } from "@elaraai/east-ui";
 *
 * const example = East.function([], UIComponentType, _$ =>
 *     Map.Root(
 *         [{ id: "okafor", lat: -34.842, lng: 138.598, name: "J. Okafor" }],
 *         {
 *             center: Map.at(-34.881, 138.6), zoom: 12n,
 *             marker: m => ({ key: m.id, lat: m.lat, lng: m.lng, label: m.name }),
 *         },
 *     ),
 * );
 * ```
 */
function createMap<
    M extends SubtypeExprOrValue<ArrayType<StructType>>,
    A extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    La extends SubtypeExprOrValue<ArrayType<StructType>> = [],
    L extends SubtypeExprOrValue<ArrayType<StructType>> = [],
>(
    markers: M,
    config: MapConfig<RowElement<M>, RowElement<A>, RowElement<La>, RowElement<L>>
        & { areas?: A; labels?: La; lines?: L },
): ExprType<UIComponentType> {
    return buildRoot(markers, config as unknown as MapConfig<StructType, StructType, StructType, StructType>);
}

// ============================================================================
// Namespace export
// ============================================================================

/**
 * Map component namespace.
 *
 * @remarks
 * `Map.Root(markers, config)` builds the basemap from flat tables (markers,
 * areas, labels, lines) plus the `hexes` layer and the `overlays` slot;
 * closed-set fields in data (`status`, `tone`, `style`) are typed variant
 * values (`Map.Types.*`).
 */
export const Map = {
    /**
     * Creates a Map — an interactive geographic basemap with H3 / area
     * overlays and a generalised East-child overlay slot.
     *
     * @typeParam M - The markers-table input
     * @typeParam A - The areas-table input
     * @typeParam La - The labels-table input
     * @typeParam L - The lines-table input
     * @param markers - The pin rows (the required first table)
     * @param config - The Map configuration ({@link MapConfig})
     * @returns An East expression of `UIComponentType`
     *
     * @example
     * ```ts
     * import { East } from "@elaraai/east";
     * import { Map, UIComponentType } from "@elaraai/east-ui";
     *
     * const example = East.function([], UIComponentType, _$ =>
     *     Map.Root(
     *         [{ id: "okafor", lat: -34.842, lng: 138.598, name: "J. Okafor" }],
     *         {
     *             center: Map.at(-34.881, 138.6), zoom: 12n,
     *             marker: m => ({ key: m.id, lat: m.lat, lng: m.lng, label: m.name }),
     *         },
     *     ),
     * );
     * ```
     */
    Root: createMap,
    /**
     * Builds a geographic point value.
     *
     * @param lat - Latitude in degrees
     * @param lng - Longitude in degrees
     * @returns A `MapLatLngType` value
     *
     * @example
     * ```ts
     * Map.at(-34.881, 138.6)
     * ```
     */
    at,
    /**
     * Builds a CARTO raster basemap.
     *
     * @param style - The CARTO preset (default `positron`)
     * @returns A `MapTileType` value
     *
     * @example
     * ```ts
     * Map.carto("voyager")
     * ```
     */
    carto,
    /**
     * Builds an OpenStreetMap raster basemap.
     *
     * @returns A `MapTileType` value
     *
     * @example
     * ```ts
     * Map.osm()
     * ```
     */
    osm,
    /**
     * Builds a raw XYZ basemap with explicit attribution.
     *
     * @param config - The tile URL, attribution, and optional layer options
     * @returns A `MapTileType` value
     *
     * @example
     * ```ts
     * Map.tile({ url: "https://{s}.tiles.example/{z}/{x}/{y}.png", attribution: "© Example" })
     * ```
     */
    tile,
    /**
     * Builds an `hexDisk` area shape — a `gridDisk(origin, k)` blob.
     *
     * @param center - The disk origin
     * @param k - Ring count around the origin
     * @param resolution - H3 resolution
     * @returns A `MapAreaShapeType` value
     *
     * @example
     * ```ts
     * Map.hexDisk(Map.at(-34.9258, 138.5994), 1n, 8n)
     * ```
     */
    hexDisk,
    /**
     * Builds a `cells` area shape — an explicit set of H3 cell ids.
     *
     * @param ids - The H3 cell ids
     * @returns A `MapAreaShapeType` value
     *
     * @example
     * ```ts
     * Map.cells(["882830829bfffff"])
     * ```
     */
    cells,
    /**
     * Builds a `polygon` area shape — an explicit ring of points (an irregular
     * region boundary). Two polygons sharing an edge abut exactly.
     *
     * @param points - The boundary points, in order (auto-closed; `Map.at(...)`)
     * @returns A `MapAreaShapeType` value
     */
    polygon,
    /**
     * Builds the hex layer — a faint background lattice plus optional per-cell
     * detail revealed at LOD.
     *
     * @param config - Optional `lattice`, `cells`, `tone`, and `interactive`
     * @returns A `MapHexLayerType` value
     *
     * @example
     * ```ts
     * Map.hex({ lattice: { center: Map.at(-34.881, 138.6), k: 11n, resolution: 8n }, tone: "muted" })
     * ```
     */
    hex,
    /**
     * Builds a resolved marker value.
     *
     * @param fields - The marker fields ({@link MapMarkerFields})
     * @returns A `MapMarkerType` value
     *
     * @example
     * ```ts
     * Map.marker({ key: "okafor", lat: -34.842, lng: 138.598, label: "J. Okafor", icon: "house" })
     * ```
     */
    marker,
    /**
     * Builds a resolved area value.
     *
     * @param fields - The area fields ({@link MapAreaFields})
     * @returns A `MapAreaType` value
     *
     * @example
     * ```ts
     * Map.area({ key: "5000", shape: Map.hexDisk(Map.at(-34.9258, 138.5994), 1n, 8n), label: "5000 · CBD" })
     * ```
     */
    area,
    /**
     * Builds a resolved line value.
     *
     * @param fields - The line fields ({@link MapLineFields})
     * @returns A `MapLineType` value
     *
     * @example
     * ```ts
     * Map.line({ key: "move", points: [Map.at(-34.905, 138.6), Map.at(-34.852, 138.6)], style: Map.dashed({ tone: "brand" }), arrow: true })
     * ```
     */
    line,
    /**
     * Builds a `solid` line style.
     *
     * @param config - Optional stroke configuration (`tone`, `weight`)
     * @returns A `MapLineStyleType` value
     *
     * @example
     * ```ts
     * Map.solid({ tone: "brand" })
     * ```
     */
    solid,
    /**
     * Builds a `dashed` line style.
     *
     * @param config - Optional stroke configuration (`tone`, `weight`)
     * @returns A `MapLineStyleType` value
     *
     * @example
     * ```ts
     * Map.dashed({ tone: "brand" })
     * ```
     */
    dashed,
    /**
     * Builds a `point` camera target.
     *
     * @param center - The centre
     * @param zoom - The zoom level to settle at
     * @returns A `MapFocusType` value
     *
     * @example
     * ```ts
     * Map.point(Map.at(-34.9258, 138.5994), 14n)
     * ```
     */
    point,
    /**
     * Builds a `bounds` camera target.
     *
     * @param sw - South-west corner
     * @param ne - North-east corner
     * @returns A `MapFocusType` value
     *
     * @example
     * ```ts
     * Map.bounds(Map.at(-34.95, 138.55), Map.at(-34.80, 138.65))
     * ```
     */
    bounds,
    /**
     * Builds a positioned overlay child for the `overlays` slot.
     *
     * @param content - The East child tree (a HUD, legend, back button)
     * @param options - Anchor / offset / interactivity options
     * @returns A `MapOverlayType` value
     *
     * @example
     * ```ts
     * Map.overlay(Text.Root("ELARA"), { align: "start", verticalAlign: "start", key: "hud" })
     * ```
     */
    overlay,
    Types: {
        /**
         * East StructType for the Map component.
         *
         * @remarks
         * See {@link MapRootType} for per-field docs.
         *
         * @property tiles - Basemap source
         * @property center - Initial centre
         * @property zoom - Initial zoom
         * @property areas - Filled boundaries
         * @property markers - Pins
         * @property overlays - Positioned East children
         */
        Map: MapRootType,
        /**
         * A geographic point.
         *
         * @property lat - Latitude in degrees
         * @property lng - Longitude in degrees
         */
        LatLng: MapLatLngType,
        /**
         * Theme tone for areas / hexes / markers / lines.
         *
         * @property brand - Brand teal
         * @property ink - Foreground ink
         * @property muted - Muted foreground
         * @property success - Status ok
         * @property warning - Status warn
         * @property danger - Status bad
         */
        Tone: MapToneType,
        /**
         * CARTO basemap preset.
         *
         * @property positron - Light base
         * @property darkMatter - Dark base
         * @property voyager - Colour base
         */
        CartoStyle: MapCartoStyleType,
        /**
         * Basemap source (`carto` / `osm` / `custom`).
         *
         * @property carto - A CARTO raster preset
         * @property osm - OpenStreetMap raster tiles
         * @property custom - A raw XYZ template with attribution
         */
        Tile: MapTileType,
        /**
         * Camera target (`point` / `bounds`).
         *
         * @property point - Centre on a point at a zoom level
         * @property bounds - Frame a south-west / north-east box
         */
        Focus: MapFocusType,
        /**
         * Area boundary (`hexDisk` / `polygon` / `cells`).
         *
         * @property hexDisk - A `gridDisk(origin, k)` blob
         * @property polygon - An explicit ring of points
         * @property cells - Explicit H3 cell ids
         */
        AreaShape: MapAreaShapeType,
        /**
         * A resolved area.
         *
         * @property key - Area identity
         * @property shape - The boundary
         * @property status - Optional status (drives colour + pulse)
         * @property flyTo - Optional click camera target
         */
        Area: MapAreaType,
        /**
         * The hex layer (lattice + per-cell detail).
         *
         * @property lattice - Optional faint background lattice
         * @property cells - Per-cell detail
         * @property tone - Optional lattice stroke tone
         */
        Hex: MapHexLayerType,
        /**
         * A resolved marker.
         *
         * @property key - Marker identity
         * @property at - The pin location
         * @property minZoom - Optional LOD gate
         */
        Marker: MapMarkerType,
        /**
         * Line render style (`solid` / `dashed`).
         *
         * @property solid - A solid connector
         * @property dashed - A dashed / routing connector
         */
        LineStyle: MapLineStyleType,
        /**
         * A resolved line.
         *
         * @property key - Line identity
         * @property points - The polyline points
         * @property style - Render style
         * @property flow - Optional animated dash-offset
         */
        Line: MapLineType,
        /**
         * A resolved standalone label.
         *
         * @property key - Label identity
         * @property at - The anchor
         * @property text - The text
         */
        Label: MapLabelType,
        /**
         * The overlay slot value.
         *
         * @property content - The East child tree
         * @property align - Horizontal screen anchor
         * @property verticalAlign - Vertical screen anchor
         * @property geoAnchor - Optional coordinate anchor
         */
        Overlay: MapOverlayType,
    },
} as const;
