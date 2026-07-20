/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `EastChakraMap` — the renderer for the East `Map` component. It owns the
 * themed frame, the `overlays` slot (arbitrary East `UIComponent` children
 * positioned over the canvas via the recursive dispatcher), and the resolved
 * geo callbacks; the Leaflet basemap + H3 / area / marker / line layers live in
 * a lazily-loaded engine ({@link ./engine}) so the heavy, `window`-touching
 * Leaflet payload is code-split out of the main bundle and SSR-safe.
 *
 * @packageDocumentation
 */

import { lazy, memo, Suspense, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, chakra, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLayerGroup, faXmark } from "@fortawesome/free-solid-svg-icons";
import { equalFor } from "@elaraai/east";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { Map } from "@elaraai/east-ui/internal";
import { alignToFlex, type MapValue } from "./leaflet-setup";
import type { MapEngineProps } from "./engine";
import { useContainerBelow } from "../../contracts/adaptive.js";

/**
 * Compact hosts: an interactive overlay (legend / nav panel) starts
 * COLLAPSED to a 44px chip so the phone-sized map stays visible; tapping
 * toggles the panel. Regular hosts render the panel as-is.
 */
function OverlayHost({ compact, interactive, styles, children }: {
    compact: boolean;
    interactive: boolean;
    styles: SlotStyles;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(false);
    if (compact && interactive && !open) {
        return (
            <chakra.button
                type="button"
                css={styles.overlayToggle}
                aria-label="Show map panel"
                aria-expanded={false}
                onClick={() => setOpen(true)}
            >
                <FontAwesomeIcon icon={faLayerGroup} />
            </chakra.button>
        );
    }
    return (
        <Box css={styles.overlayItem} style={{ pointerEvents: interactive ? "auto" : "none" }}>
            {compact && interactive && (
                <chakra.button
                    type="button"
                    css={styles.overlayToggle}
                    data-dismiss=""
                    aria-label="Hide map panel"
                    aria-expanded={true}
                    onClick={() => setOpen(false)}
                >
                    <FontAwesomeIcon icon={faXmark} />
                </chakra.button>
            )}
            {children}
        </Box>
    );
}

export type { MapValue, MapAreaValue, MapMarkerValue, MapLineValue, MapOverlayValue } from "./leaflet-setup";

const MapEngine = lazy(() => import("./engine"));

const mapEqual = equalFor(Map.Types.Map);

type SlotStyles = Record<string, SystemStyleObject>;

/** Props for {@link EastChakraMap}. */
export interface EastChakraMapProps {
    value: MapValue;
    storageKey: string;
}

export const EastChakraMap = memo(function EastChakraMap({ value, storageKey }: EastChakraMapProps) {
    const styles = useSlotRecipe({ key: "map" })() as SlotStyles;

    const height = getSomeorUndefined(value.height);
    // `height="fill"` grows the panel to its parent; any other value is fixed.
    const heightStyle = height === undefined ? undefined
        : height === "fill" ? { height: "100%", maxHeight: "100%" }
        : { height, maxHeight: height };

    const onAreaClick = useMemo(() => getSomeorUndefined(value.onAreaClick), [value.onAreaClick]);
    const onMarkerClick = useMemo(() => getSomeorUndefined(value.onMarkerClick), [value.onMarkerClick]);
    const onZoom = useMemo(() => getSomeorUndefined(value.onZoom), [value.onZoom]);
    const onSelect = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);

    // Pass the engine a real `undefined` when no callback is bound, so it can
    // tell whether an area is interactive (a bound callback / flyTo) rather than
    // attaching a click handler to every area unconditionally.
    const onAreaClickFn = useMemo<MapEngineProps["onAreaClickFn"]>(
        () => onAreaClick ? (key) => { queueMicrotask(() => onAreaClick(key)); } : undefined, [onAreaClick]);
    const onMarkerClickFn = useMemo<MapEngineProps["onMarkerClickFn"]>(
        () => onMarkerClick ? (key) => { queueMicrotask(() => onMarkerClick(key)); } : undefined, [onMarkerClick]);
    const onZoomFn = useMemo<MapEngineProps["onZoomFn"]>(
        () => onZoom ? (z) => { queueMicrotask(() => onZoom(z)); } : undefined, [onZoom]);
    const onSelectFn = useMemo<MapEngineProps["onSelectFn"]>(
        () => onSelect ? (key) => { queueMicrotask(() => onSelect(key)); } : undefined, [onSelect]);

    // The Leaflet engine applies the basemap + zoom clamps + interaction config
    // imperatively on mount; remount it when any of that config identity changes
    // so a reactive value swap (e.g. a new basemap) actually re-applies.
    // Compact hosts: interactive overlays (legend / nav panels) start
    // collapsed so the phone-sized map stays visible.
    const rootRef = useRef<HTMLDivElement | null>(null);
    const compact = useContainerBelow(rootRef, 480);

    const engineKey = useMemo(() => {
        const tilesKey = value.tiles.type === "carto"
            ? `carto:${value.tiles.value.style.type}`
            : value.tiles.type === "custom" ? `custom:${value.tiles.value.url}` : "osm";
        const fit = getSomeorUndefined(value.fitBounds);
        return [
            tilesKey,
            String(getSomeorUndefined(value.minZoom) ?? ""),
            String(getSomeorUndefined(value.maxZoom) ?? ""),
            String(getSomeorUndefined(value.scrollWheelZoom) ?? true),
            String(getSomeorUndefined(value.attributionPrefix) ?? false),
            fit !== undefined ? fit.type : "",
        ].join("|");
    }, [value.tiles, value.minZoom, value.maxZoom, value.scrollWheelZoom, value.attributionPrefix, value.fitBounds]);

    return (
        <Box ref={rootRef} css={styles.root} {...(heightStyle !== undefined ? { style: heightStyle } : {})}>
            <Suspense fallback={<Box css={styles.fallback} />}>
                <MapEngine
                    key={engineKey}
                    value={value}
                    containerClassName="elara-map-canvas"
                    onAreaClickFn={onAreaClickFn}
                    onMarkerClickFn={onMarkerClickFn}
                    onZoomFn={onZoomFn}
                    onSelectFn={onSelectFn}
                />
            </Suspense>
            {value.overlays.map((overlay, i) => {
                const key = getSomeorUndefined(overlay.key) ?? String(i);
                const interactive = getSomeorUndefined(overlay.interactive) ?? true;
                return (
                    <Box
                        key={key}
                        css={styles.overlay}
                        style={{
                            justifyContent: alignToFlex(overlay.align.type),
                            alignItems: alignToFlex(overlay.verticalAlign.type),
                        }}
                    >
                        <OverlayHost compact={compact} interactive={interactive} styles={styles}>
                            <EastChakraComponent value={overlay.content} storageKey={`${storageKey}.overlay.${key}`} />
                        </OverlayHost>
                    </Box>
                );
            })}
        </Box>
    );
}, (prev, next) => mapEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
