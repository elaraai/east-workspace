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

import { lazy, memo, Suspense, useCallback, useMemo } from "react";
import { Box, useSlotRecipe, type SystemStyleObject } from "@chakra-ui/react";
import { equalFor } from "@elaraai/east";
import { getSomeorUndefined } from "../../utils";
import { EastChakraComponent } from "../../component";
import { Map } from "@elaraai/east-ui/internal";
import { alignToFlex, type MapValue } from "./leaflet-setup";
import type { MapEngineProps } from "./engine";

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

    const onAreaClick = useMemo(() => getSomeorUndefined(value.onAreaClick), [value.onAreaClick]);
    const onMarkerClick = useMemo(() => getSomeorUndefined(value.onMarkerClick), [value.onMarkerClick]);
    const onZoom = useMemo(() => getSomeorUndefined(value.onZoom), [value.onZoom]);
    const onSelect = useMemo(() => getSomeorUndefined(value.onSelect), [value.onSelect]);

    const onAreaClickFn = useCallback<NonNullable<MapEngineProps["onAreaClickFn"]>>((key) => {
        if (onAreaClick) queueMicrotask(() => onAreaClick(key));
    }, [onAreaClick]);
    const onMarkerClickFn = useCallback<NonNullable<MapEngineProps["onMarkerClickFn"]>>((key) => {
        if (onMarkerClick) queueMicrotask(() => onMarkerClick(key));
    }, [onMarkerClick]);
    const onZoomFn = useCallback<NonNullable<MapEngineProps["onZoomFn"]>>((z) => {
        if (onZoom) queueMicrotask(() => onZoom(z));
    }, [onZoom]);
    const onSelectFn = useCallback<NonNullable<MapEngineProps["onSelectFn"]>>((key) => {
        if (onSelect) queueMicrotask(() => onSelect(key));
    }, [onSelect]);

    // The Leaflet engine applies the basemap + zoom clamps + interaction config
    // imperatively on mount; remount it when any of that config identity changes
    // so a reactive value swap (e.g. a new basemap) actually re-applies.
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
        <Box css={styles.root} {...(height !== undefined ? { style: { height, maxHeight: height } } : {})}>
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
                        <Box css={styles.overlayItem} style={{ pointerEvents: interactive ? "auto" : "none" }}>
                            <EastChakraComponent value={overlay.content} storageKey={`${storageKey}.overlay.${key}`} />
                        </Box>
                    </Box>
                );
            })}
        </Box>
    );
}, (prev, next) => mapEqual(prev.value, next.value) && prev.storageKey === next.storageKey);
