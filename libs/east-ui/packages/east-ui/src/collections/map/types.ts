/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import {
    ArrayType,
    BooleanType,
    FloatType,
    IntegerType,
    NullType,
    OptionType,
    StringType,
    StructType,
    VariantType,
} from "@elaraai/east";

import { StatusTokenType } from "../../style/interaction.js";

/**
 * A geographic point.
 *
 * @remarks
 * Leaflet's coordinate order is `[lat, lng]` and H3 cell boundaries match,
 * so values flow straight through to the renderer with no swap.
 *
 * @property lat - Latitude in degrees
 * @property lng - Longitude in degrees
 */
export const MapLatLngType = StructType({
    /** Latitude in degrees */
    lat: FloatType,
    /** Longitude in degrees */
    lng: FloatType,
});

/**
 * Type representing geographic points.
 */
export type MapLatLngType = typeof MapLatLngType;

/**
 * Theme tone for area fills, hex strokes, markers, and lines.
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
export const MapToneType = VariantType({
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
 * Type representing map tones.
 */
export type MapToneType = typeof MapToneType;

/**
 * CARTO raster basemap preset.
 *
 * @property positron - Light, low-saturation base (default)
 * @property darkMatter - Dark base
 * @property voyager - Balanced colour base
 */
export const MapCartoStyleType = VariantType({
    /** Light, low-saturation base (default) */
    positron: NullType,
    /** Dark base */
    darkMatter: NullType,
    /** Balanced colour base */
    voyager: NullType,
});

/**
 * Type representing CARTO basemap presets.
 */
export type MapCartoStyleType = typeof MapCartoStyleType;

/**
 * Basemap source — closed CARTO / OSM presets plus a raw XYZ escape hatch.
 *
 * @remarks
 * The `custom` case keeps `attribution` required: tile providers (CARTO,
 * OSM) require their credit to stay visible.
 *
 * @property carto - A CARTO raster preset
 * @property osm - OpenStreetMap standard raster tiles
 * @property custom - A raw XYZ tile template with explicit attribution
 */
export const MapTileType = VariantType({
    /** A CARTO raster preset */
    carto: StructType({
        /** The CARTO preset */
        style: MapCartoStyleType,
    }),
    /** OpenStreetMap standard raster tiles */
    osm: NullType,
    /** A raw XYZ tile template with explicit attribution */
    custom: StructType({
        /** XYZ tile URL template (e.g. `https://{s}.tiles.example/{z}/{x}/{y}.png`) */
        url: StringType,
        /** Attribution HTML kept visible in the corner */
        attribution: StringType,
        /** Optional `{s}` subdomain list (default none) */
        subdomains: OptionType(ArrayType(StringType)),
        /** Optional max zoom for the layer (default the map's `maxZoom`) */
        maxZoom: OptionType(IntegerType),
        /** Optional retina `{r}` tiles (default off) */
        detectRetina: OptionType(BooleanType),
    }),
});

/**
 * Type representing basemap sources.
 */
export type MapTileType = typeof MapTileType;

/**
 * A `flyTo` / `fitBounds` camera target.
 *
 * @property point - Centre on a point at a zoom level
 * @property bounds - Frame a south-west / north-east bounding box
 */
export const MapFocusType = VariantType({
    /** Centre on a point at a zoom level */
    point: StructType({
        /** The centre */
        center: MapLatLngType,
        /** The zoom level to settle at */
        zoom: IntegerType,
    }),
    /** Frame a south-west / north-east bounding box */
    bounds: StructType({
        /** South-west corner */
        sw: MapLatLngType,
        /** North-east corner */
        ne: MapLatLngType,
    }),
});

/**
 * Type representing camera targets.
 */
export type MapFocusType = typeof MapFocusType;

/**
 * An area boundary — an H3 disk, an explicit ring, or explicit H3 cell ids.
 *
 * @remarks
 * The value stores H3 *inputs* (centre / `k` / resolution, or cell ids), not
 * expanded boundary coordinates — the renderer owns `h3-js` and computes the
 * rings, keeping the serialized value small.
 *
 * @property hexDisk - A `gridDisk(origin, k)` blob at a resolution
 * @property polygon - An explicit ring of points
 * @property cells - Explicit H3 cell ids
 */
export const MapAreaShapeType = VariantType({
    /** A `gridDisk(origin, k)` blob at a resolution */
    hexDisk: StructType({
        /** The disk origin */
        center: MapLatLngType,
        /** Ring count (`k`) around the origin */
        k: IntegerType,
        /** H3 resolution */
        resolution: IntegerType,
    }),
    /** An explicit ring of points */
    polygon: ArrayType(MapLatLngType),
    /** Explicit H3 cell ids */
    cells: ArrayType(StringType),
});

/**
 * Type representing area boundaries.
 */
export type MapAreaShapeType = typeof MapAreaShapeType;

/**
 * A filled, clickable area (e.g. a postcode).
 *
 * @remarks
 * `status` drives both colour and the pulse animation; `bad` ⇒ red pulse,
 * `success` / `info` ⇒ teal pulse, neutral ⇒ static.
 *
 * @property key - Area identity — `onAreaClick` returns it; `flyTo` target id
 * @property shape - The H3 / polygon boundary
 * @property label - Optional permanent tooltip
 * @property detailLabel - Optional richer label shown only at/after `lodZoom`
 * @property status - Optional status token; drives colour + pulse
 * @property tone - Optional explicit tone override; absent ⇒ `status` drives colour
 * @property color - Optional raw CSS colour; wins over `tone`
 * @property fillOpacity - Optional fill alpha (0–1)
 * @property weight - Optional stroke width in px
 * @property pulse - Optional explicit pulse override; absent ⇒ derived from `status`
 * @property flyTo - Optional click camera target; absent ⇒ frame the shape
 * @property interactive - Optional click flag; absent ⇒ derived (clickable only when `onAreaClick`/`onSelect`/`flyTo` is set)
 */
export const MapAreaType = StructType({
    /** Area identity — `onAreaClick` returns it; `flyTo` target id */
    key: StringType,
    /** The H3 / polygon boundary */
    shape: MapAreaShapeType,
    /** Optional permanent tooltip */
    label: OptionType(StringType),
    /** Optional richer label shown only at/after `lodZoom` */
    detailLabel: OptionType(StringType),
    /** Optional status token; drives colour + pulse */
    status: OptionType(StatusTokenType),
    /** Optional explicit tone override; absent ⇒ `status` drives colour */
    tone: OptionType(MapToneType),
    /** Optional raw CSS colour (e.g. `"#2D7FF9"`); wins over `tone` */
    color: OptionType(StringType),
    /** Optional fill alpha (0–1) */
    fillOpacity: OptionType(FloatType),
    /** Optional stroke width in px */
    weight: OptionType(FloatType),
    /** Optional explicit pulse override; absent ⇒ derived from `status` */
    pulse: OptionType(BooleanType),
    /** Optional click camera target; absent ⇒ frame the shape */
    flyTo: OptionType(MapFocusType),
    /** Optional click flag; absent ⇒ clickable only when a callback / `flyTo` is set */
    interactive: OptionType(BooleanType),
});

/**
 * Type representing resolved areas.
 */
export type MapAreaType = typeof MapAreaType;

/**
 * The res-8 hex lattice plus per-cell detail revealed at LOD.
 *
 * @remarks
 * First-class so the renderer can compute disks / boundaries with `h3-js`
 * and gate per-cell detail on zoom; the value stays compact (cell ids, not
 * boundary coordinates).
 *
 * @property lattice - Optional faint background lattice (a disk of cells)
 * @property cells - Per-cell detail (id + optional status / fill / detail text)
 * @property tone - Optional lattice stroke tone (default `muted`)
 * @property interactive - Optional click-through flag (default false — decorative)
 */
export const MapHexLayerType = StructType({
    /** Optional faint background lattice (a disk of cells around a centre) */
    lattice: OptionType(StructType({
        /** The lattice centre */
        center: MapLatLngType,
        /** Ring count (`k`) around the centre */
        k: IntegerType,
        /** H3 resolution */
        resolution: IntegerType,
    })),
    /** Per-cell detail */
    cells: ArrayType(StructType({
        /** H3 cell id (the renderer calls `cellToBoundary`) */
        id: StringType,
        /** Optional status token for the cell fill */
        status: OptionType(StatusTokenType),
        /** Optional fill alpha (0–1) */
        fillOpacity: OptionType(FloatType),
        /** Optional detail text shown only when zoom ≥ `lodZoom` */
        detail: OptionType(StringType),
    })),
    /** Optional lattice stroke tone (default `muted`) */
    tone: OptionType(MapToneType),
    /** Optional click-through flag (default false — decorative) */
    interactive: OptionType(BooleanType),
});

/**
 * Type representing the hex layer.
 */
export type MapHexLayerType = typeof MapHexLayerType;

/**
 * A pin (home / POI). `minZoom` is the LOD gate; `icon` is a Font Awesome name.
 *
 * @property key - Marker identity — `onMarkerClick` returns it
 * @property at - The pin location
 * @property label - Optional permanent tooltip
 * @property icon - Optional Font Awesome solid icon name
 * @property tone - Optional marker tone
 * @property minZoom - Optional LOD gate; the pin appears only at/after this zoom
 * @property interactive - Optional click flag (default true)
 */
export const MapMarkerType = StructType({
    /** Marker identity — `onMarkerClick` returns it */
    key: StringType,
    /** The pin location */
    at: MapLatLngType,
    /** Optional permanent tooltip */
    label: OptionType(StringType),
    /** Optional Font Awesome solid icon name */
    icon: OptionType(StringType),
    /** Optional marker tone */
    tone: OptionType(MapToneType),
    /** Optional LOD gate; the pin appears only at/after this zoom */
    minZoom: OptionType(IntegerType),
    /** Optional click flag (default true) */
    interactive: OptionType(BooleanType),
});

/**
 * Type representing resolved markers.
 */
export type MapMarkerType = typeof MapMarkerType;

/**
 * Line render style.
 *
 * @property solid - A solid connector
 * @property dashed - A dashed / routing connector
 */
export const MapLineStyleType = VariantType({
    /** A solid connector */
    solid: StructType({
        /** Stroke tone (default `brand`) */
        tone: OptionType(MapToneType),
        /** Stroke width in px (default 2.5) */
        weight: OptionType(FloatType),
    }),
    /** A dashed / routing connector */
    dashed: StructType({
        /** Stroke tone (default `brand`) */
        tone: OptionType(MapToneType),
        /** Stroke width in px (default 2) */
        weight: OptionType(FloatType),
    }),
});

/**
 * Type representing line styles.
 */
export type MapLineStyleType = typeof MapLineStyleType;

/**
 * A connector / move arrow between geographic points.
 *
 * @property key - Line identity
 * @property points - The polyline points, in order
 * @property style - Render style (`solid` / `dashed`)
 * @property flow - Optional animated dash-offset when active (default off)
 * @property arrow - Optional arrowhead at the destination (default off)
 */
export const MapLineType = StructType({
    /** Line identity */
    key: StringType,
    /** The polyline points, in order */
    points: ArrayType(MapLatLngType),
    /** Render style (`solid` / `dashed`) */
    style: MapLineStyleType,
    /** Optional animated dash-offset when active (default off) */
    flow: OptionType(BooleanType),
    /** Optional arrowhead at the destination (default off) */
    arrow: OptionType(BooleanType),
});

/**
 * Type representing resolved lines.
 */
export type MapLineType = typeof MapLineType;

/**
 * A standalone label (e.g. a suburb name) not tied to an area.
 *
 * @property key - Label identity
 * @property at - The label anchor
 * @property text - The label text
 */
export const MapLabelType = StructType({
    /** Label identity */
    key: StringType,
    /** The label anchor */
    at: MapLatLngType,
    /** The label text */
    text: StringType,
});

/**
 * Type representing standalone labels.
 */
export type MapLabelType = typeof MapLabelType;
