/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Pure (no Leaflet / DOM) value types and helpers shared by the Map renderer
 * and its lazy Leaflet engine: the East value-type aliases, the CARTO / OSM
 * basemap presets, basemap resolution from a `MapTileType` value, the
 * tone / status → CSS-class mapping that drives the theme-owned area colours
 * and pulse, and the overlay anchor → inset mapping.
 *
 * @packageDocumentation
 */

import { type ValueTypeOf } from "@elaraai/east";
import { Map } from "@elaraai/east-ui/internal";

/** East Map value type. */
export type MapValue = ValueTypeOf<typeof Map.Types.Map>;
/** East Map area value type. */
export type MapAreaValue = ValueTypeOf<typeof Map.Types.Area>;
/** East Map marker value type. */
export type MapMarkerValue = ValueTypeOf<typeof Map.Types.Marker>;
/** East Map line value type. */
export type MapLineValue = ValueTypeOf<typeof Map.Types.Line>;
/** East Map label value type. */
export type MapLabelValue = ValueTypeOf<typeof Map.Types.Label>;
/** East Map hex-layer value type. */
export type MapHexValue = ValueTypeOf<typeof Map.Types.Hex>;
/** East Map basemap value type. */
export type MapTileValue = ValueTypeOf<typeof Map.Types.Tile>;
/** East Map camera-target value type. */
export type MapFocusValue = ValueTypeOf<typeof Map.Types.Focus>;
/** East Map overlay value type. */
export type MapOverlayValue = ValueTypeOf<typeof Map.Types.Overlay>;

/** A resolved basemap layer descriptor for Leaflet's `L.tileLayer`. */
export interface ResolvedTile {
    url: string;
    attribution: string;
    subdomains: string[];
    maxZoom: number;
    detectRetina: boolean;
}

const CARTO_SUBDOMAINS = ["a", "b", "c", "d"];
// CARTO terms require the OSM + CARTO credit to stay visible.
const CARTO_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const OSM_ATTRIBUTION =
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const CARTO_PATH: Record<string, string> = {
    positron: "light_all",
    darkMatter: "dark_all",
    voyager: "voyager",
};

/**
 * Resolves a `MapTileType` value into a Leaflet tile-layer descriptor.
 *
 * @param tile - The basemap value (`carto` / `osm` / `custom`)
 * @returns The URL template, attribution, subdomains, and layer options
 */
export function resolveTile(tile: MapTileValue): ResolvedTile {
    if (tile.type === "carto") {
        const segment = CARTO_PATH[tile.value.style.type] ?? "light_all";
        return {
            url: `https://{s}.basemaps.cartocdn.com/rastertiles/${segment}/{z}/{x}/{y}{r}.png`,
            attribution: CARTO_ATTRIBUTION,
            subdomains: CARTO_SUBDOMAINS,
            maxZoom: 20,
            detectRetina: true,
        };
    }
    if (tile.type === "osm") {
        return {
            url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            attribution: OSM_ATTRIBUTION,
            subdomains: ["a", "b", "c"],
            maxZoom: 19,
            detectRetina: true,
        };
    }
    const custom = tile.value;
    return {
        url: custom.url,
        attribution: custom.attribution,
        subdomains: custom.subdomains.type === "some" ? custom.subdomains.value : [],
        maxZoom: custom.maxZoom.type === "some" ? Number(custom.maxZoom.value) : 19,
        detectRetina: custom.detectRetina.type === "some" ? custom.detectRetina.value : false,
    };
}

/** The six Map tones. */
export type MapTone = "brand" | "ink" | "muted" | "success" | "warning" | "danger";

/** Maps a status token tag to its area / cell tone. */
export const STATUS_TONE: Record<string, MapTone> = {
    success: "success",
    danger: "danger",
    warning: "warning",
    info: "brand",
    neutral: "muted",
};

/** Resolves an area's effective tone from its explicit `tone` or its `status`. */
export function areaTone(area: MapAreaValue): MapTone {
    if (area.tone.type === "some") return area.tone.value.type as MapTone;
    if (area.status.type === "some") return STATUS_TONE[area.status.value.type] ?? "muted";
    return "muted";
}

/** Resolves an area's pulse kind, or `undefined` for static.
 *  `danger` ⇒ red, `warning` ⇒ amber, `success` / `info` ⇒ teal; `neutral` is static. */
export function areaPulse(area: MapAreaValue): "danger" | "success" | "warning" | undefined {
    const statusTag = area.status.type === "some" ? area.status.value.type : undefined;
    const derived = statusTag === "danger" ? "danger"
        : statusTag === "warning" ? "warning"
        : statusTag === "success" || statusTag === "info" ? "success"
        : undefined;
    if (area.pulse.type === "some") {
        if (!area.pulse.value) return undefined;
        if (derived !== undefined) return derived;
        const tone = areaTone(area);
        return tone === "danger" ? "danger" : tone === "warning" ? "warning" : "success";
    }
    return derived;
}

/** Builds the Leaflet path className list for an area (tone colour + optional pulse).
 *  A raw `color` override wins over the tone, so the tone colour class is dropped
 *  (the renderer passes `color` as a Leaflet path option, which beats the class). */
export function areaClassName(area: MapAreaValue): string {
    const pulse = areaPulse(area);
    const hasColor = area.color.type === "some";
    return [
        "elara-map-area",
        hasColor ? "" : `elara-map-area--${areaTone(area)}`,
        pulse !== undefined ? `elara-map-area--pulse-${pulse}` : "",
    ].filter(Boolean).join(" ");
}

/** Builds the Leaflet path className list for a hex-layer cell (status tone colour). */
export function hexCellClassName(status: string | undefined): string {
    return status !== undefined
        ? `elara-map-hex-cell elara-map-area--${STATUS_TONE[status] ?? "muted"}`
        : "elara-map-hex-cell elara-map-area--muted";
}

/** Resolves a line's tone tag. */
export function lineTone(line: MapLineValue): MapTone {
    return line.style.value.tone.type === "some" ? line.style.value.tone.value.type as MapTone : "brand";
}

/** Builds the Leaflet path className list for a line (tone colour + optional flow). */
export function lineClassName(line: MapLineValue): string {
    const flow = line.flow.type === "some" && line.flow.value;
    return ["elara-map-line", `elara-map-line--${lineTone(line)}`, flow ? "elara-map-line--flow" : ""]
        .filter(Boolean).join(" ");
}

/** Builds the className list for a line's arrowhead (filled tone). */
export function arrowHeadClassName(line: MapLineValue): string {
    return `elara-map-arrowhead elara-map-arrowhead--${lineTone(line)}`;
}

/** Builds the Leaflet divIcon className suffix for a marker's tone. */
export function markerToneClass(marker: MapMarkerValue): string {
    return marker.tone.type === "some" ? `--${marker.tone.value.type}` : "--brand";
}

/** Maps an `AlignType` tag to a flexbox justification value. */
export function alignToFlex(tag: string): "flex-start" | "center" | "flex-end" {
    return tag === "start" ? "flex-start" : tag === "end" ? "flex-end" : "center";
}
