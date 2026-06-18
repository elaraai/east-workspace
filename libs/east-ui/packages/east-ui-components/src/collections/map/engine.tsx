/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
/// <reference types="vite/client" />

/**
 * The imperative Leaflet engine for the Map renderer — code-split behind a
 * `React.lazy` boundary so the Leaflet + H3 payload (and its `window` access)
 * is only paid for, and only loaded, when a Map actually renders. It owns the
 * `L.map` lifecycle (create on mount, sync layers from the immutable East
 * value, tear down on unmount) and keeps the current zoom in React state so the
 * caller's LOD gate and overlays can react.
 *
 * @packageDocumentation
 */

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { findIconDefinition, icon as faIcon, library, type IconName } from "@fortawesome/fontawesome-svg-core";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { getSomeorUndefined } from "../../utils";
import { arrowHead, bboxOfRings, cellRings, diskRings, type LatLng } from "./geo";
import {
    areaClassName,
    arrowHeadClassName,
    hexCellClassName,
    lineClassName,
    markerToneClass,
    resolveTile,
    type MapAreaValue,
    type MapValue,
} from "./leaflet-setup";

library.add(fas);

// Leaflet throws "Map container is already initialized" on a hot update; force a
// full reload instead of a white-screen.
if (import.meta.hot) import.meta.hot.accept(() => import.meta.hot?.invalidate());

/** Renders a Font Awesome solid icon name to an inline SVG string for a divIcon. */
function iconGlyph(name: string): string {
    const def = findIconDefinition({ prefix: "fas", iconName: name as IconName });
    return def ? faIcon(def).html.join("") : "";
}

/** Props for the lazy Leaflet engine. */
export interface MapEngineProps {
    value: MapValue;
    containerClassName?: string;
    onAreaClickFn?: (key: string) => void;
    onMarkerClickFn?: (key: string) => void;
    onZoomFn?: (zoom: bigint) => void;
    onSelectFn?: (key: string) => void;
    /** Reports the current zoom up to the renderer for the LOD gate. */
    onZoomChange?: (zoom: number) => void;
}

/** Resolves the rings for an area shape. */
function areaRings(area: MapAreaValue): LatLng[][] {
    const shape = area.shape;
    if (shape.type === "hexDisk") {
        return diskRings(
            [shape.value.center.lat, shape.value.center.lng],
            Number(shape.value.k),
            Number(shape.value.resolution),
        );
    }
    if (shape.type === "cells") return cellRings(shape.value);
    return [shape.value.map(p => [p.lat, p.lng] as LatLng)];
}

export default function MapEngine({
    value,
    containerClassName,
    onAreaClickFn,
    onMarkerClickFn,
    onZoomFn,
    onSelectFn,
    onZoomChange,
}: MapEngineProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<L.Map | null>(null);
    const dataLayerRef = useRef<L.LayerGroup | null>(null);
    const [zoom, setZoom] = useState(() => Number(value.zoom));

    // Latest callbacks, read through a ref so the mount effect runs once.
    const handlers = useRef({ onAreaClickFn, onMarkerClickFn, onZoomFn, onSelectFn, onZoomChange });
    handlers.current = { onAreaClickFn, onMarkerClickFn, onZoomFn, onSelectFn, onZoomChange };

    const lodZoom = getSomeorUndefined(value.lodZoom);
    const detail = lodZoom !== undefined && zoom >= Number(lodZoom);

    // ── Mount: create the map, the basemap, and the bridge ───────────────────
    useEffect(() => {
        const container = containerRef.current;
        if (container === null) return;

        const map = L.map(container, {
            center: [value.center.lat, value.center.lng],
            zoom: Number(value.zoom),
            minZoom: value.minZoom.type === "some" ? Number(value.minZoom.value) : undefined,
            maxZoom: value.maxZoom.type === "some" ? Number(value.maxZoom.value) : undefined,
            scrollWheelZoom: getSomeorUndefined(value.scrollWheelZoom) ?? true,
            attributionControl: true,
        });
        mapRef.current = map;

        const tile = resolveTile(value.tiles);
        L.tileLayer(tile.url, {
            subdomains: tile.subdomains,
            attribution: tile.attribution,
            maxZoom: tile.maxZoom,
            detectRetina: tile.detectRetina,
        }).addTo(map);

        // Strip Leaflet's "Leaflet" prefix but keep the OSM / CARTO tile credit.
        if ((getSomeorUndefined(value.attributionPrefix) ?? false) !== true) {
            map.attributionControl.setPrefix(false);
        }

        const fit = getSomeorUndefined(value.fitBounds);
        if (fit !== undefined) {
            if (fit.type === "bounds") {
                map.fitBounds([[fit.value.sw.lat, fit.value.sw.lng], [fit.value.ne.lat, fit.value.ne.lng]]);
            } else {
                map.setView([fit.value.center.lat, fit.value.center.lng], Number(fit.value.zoom));
            }
        }

        dataLayerRef.current = L.layerGroup().addTo(map);

        // The map mounts inside a freshly-laid-out panel — re-measure once it settles.
        map.invalidateSize();
        const t = setTimeout(() => map.invalidateSize(), 250);

        const onZoomEnd = () => {
            const z = map.getZoom();
            setZoom(z);
            handlers.current.onZoomChange?.(z);
            handlers.current.onZoomFn?.(BigInt(Math.round(z)));
        };
        map.on("zoomend", onZoomEnd);

        return () => {
            clearTimeout(t);
            map.off("zoomend", onZoomEnd);
            map.remove();
            mapRef.current = null;
            dataLayerRef.current = null;
        };
        // Rebuild only when identity of the map config changes; the data layer
        // re-syncs in its own effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Sync the data layers from the (immutable) value + LOD band ────────────
    useEffect(() => {
        const map = mapRef.current;
        const group = dataLayerRef.current;
        if (map === null || group === null) return;
        group.clearLayers();

        // Faint decorative hex lattice under everything.
        const hexes = getSomeorUndefined(value.hexes);
        if (hexes !== undefined) {
            const lattice = getSomeorUndefined(hexes.lattice);
            if (lattice !== undefined) {
                const rings = diskRings(
                    [lattice.center.lat, lattice.center.lng],
                    Number(lattice.k),
                    Number(lattice.resolution),
                );
                for (const ring of rings) {
                    L.polygon(ring, { className: "elara-map-hex", interactive: false }).addTo(group);
                }
            }
            // Per-cell detail — status-coloured cells, detail labels gated on LOD.
            const cellInteractive = getSomeorUndefined(hexes.interactive) ?? false;
            for (const cell of hexes.cells) {
                const ring = cellRings([cell.id])[0];
                if (ring === undefined) continue;
                const cellStatus = getSomeorUndefined(cell.status);
                const cellDetail = getSomeorUndefined(cell.detail);
                const poly = L.polygon(ring, {
                    className: hexCellClassName(cellStatus?.type),
                    weight: 0.6,
                    fillOpacity: cell.fillOpacity.type === "some" ? cell.fillOpacity.value : 0.12,
                    interactive: cellInteractive,
                }).addTo(group);
                if (detail && cellDetail !== undefined) {
                    poly.bindTooltip(cellDetail, { permanent: true, direction: "center", className: "elara-map-tip", opacity: 1 });
                }
            }
        }

        // Filled, clickable areas (postcodes) — each carries colour + pulse via class.
        for (const area of value.areas) {
            const rings = areaRings(area);
            const className = areaClassName(area);
            const label = getSomeorUndefined(area.label);
            const detailLabel = getSomeorUndefined(area.detailLabel);
            const tip = detail ? (detailLabel ?? label) : label;
            const flyTo = getSomeorUndefined(area.flyTo);
            // A raw `color` override wins over the tone class (Leaflet path options
            // beat the className-driven theme stroke / fill).
            const color = getSomeorUndefined(area.color);
            const polys = rings.map(ring => L.polygon(ring, {
                className,
                weight: area.weight.type === "some" ? area.weight.value : 1.5,
                fillOpacity: area.fillOpacity.type === "some" ? area.fillOpacity.value : 0.14,
                interactive: true,
                ...(color !== undefined ? { color, fillColor: color } : {}),
            }).addTo(group));
            const onClick = () => {
                handlers.current.onAreaClickFn?.(area.key);
                handlers.current.onSelectFn?.(area.key);
                if (flyTo !== undefined) {
                    if (flyTo.type === "point") {
                        map.flyTo([flyTo.value.center.lat, flyTo.value.center.lng], Number(flyTo.value.zoom), { duration: 1.1 });
                    } else {
                        map.flyToBounds([[flyTo.value.sw.lat, flyTo.value.sw.lng], [flyTo.value.ne.lat, flyTo.value.ne.lng]], { duration: 1.1 });
                    }
                } else {
                    const bbox = bboxOfRings(rings);
                    if (bbox !== undefined) map.flyToBounds(bbox, { duration: 1.1 });
                }
            };
            for (const poly of polys) poly.on("click", onClick);
            if (tip !== undefined && polys[0] !== undefined) {
                polys[0].bindTooltip(tip, { permanent: true, direction: "top", className: "elara-map-tip", opacity: 1 });
            }
        }

        // Connector / move-arrow lines.
        for (const line of value.lines) {
            const dashed = line.style.type === "dashed";
            const weight = line.style.value.weight.type === "some" ? line.style.value.weight.value : (dashed ? 2 : 2.5);
            const pts = line.points.map(p => [p.lat, p.lng] as LatLng);
            L.polyline(pts, {
                className: lineClassName(line),
                weight,
                dashArray: dashed ? "6 8" : undefined,
                interactive: false,
            }).addTo(group);
            if ((getSomeorUndefined(line.arrow) ?? false)) {
                const head = arrowHead(pts);
                if (head !== undefined) {
                    L.polygon(head, { className: arrowHeadClassName(line), weight: 1, interactive: false }).addTo(group);
                }
            }
        }

        // Standalone labels.
        for (const lab of value.labels) {
            L.marker([lab.at.lat, lab.at.lng], {
                interactive: false,
                icon: L.divIcon({ className: "elara-map-label", html: escapeHtml(lab.text) }),
            }).addTo(group);
        }

        // Pins — gated by their LOD `minZoom`.
        for (const marker of value.markers) {
            const minZoom = getSomeorUndefined(marker.minZoom);
            if (minZoom !== undefined && zoom < Number(minZoom)) continue;
            const text = getSomeorUndefined(marker.label);
            const interactive = getSomeorUndefined(marker.interactive) ?? true;
            const toneClass = markerToneClass(marker);
            const iconName = getSomeorUndefined(marker.icon);
            const glyph = iconName !== undefined ? iconGlyph(iconName) : "";
            const pinHtml = glyph !== ""
                ? `<span class="elara-map-pin-icon elara-map-pin-icon${toneClass}">${glyph}</span>`
                : `<span class="elara-map-pin-dot elara-map-pin-dot${toneClass}"></span>`;
            const labelHtml = text !== undefined ? `<span class="elara-map-pin-label">${escapeHtml(text)}</span>` : "";
            const m = L.marker([marker.at.lat, marker.at.lng], {
                interactive,
                icon: L.divIcon({ className: "elara-map-pin", html: `${pinHtml}${labelHtml}` }),
            }).addTo(group);
            if (interactive) {
                m.on("click", () => {
                    handlers.current.onMarkerClickFn?.(marker.key);
                    handlers.current.onSelectFn?.(marker.key);
                });
            }
        }
    }, [value, detail, zoom]);

    return <div ref={containerRef} className={containerClassName} style={{ height: "100%", width: "100%" }} />;
}

/** Minimal HTML escape for divIcon label text (renderer-internal, not East IR). */
function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c =>
        c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;");
}
