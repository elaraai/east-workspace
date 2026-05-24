/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useRef, useMemo, useSyncExternalStore, useCallback } from "react";
import type { ValueTypeOf } from "@elaraai/east";
import type { UIComponentType } from "@elaraai/east-ui";
import { EastChakraComponent } from "../component.js";
import {
    getReactiveTrackers,
    subscribeTrackers,
    getTrackersVersion,
} from "./tracker.js";
import { EastErrorBoundary, EastErrorDisplay, toEastErrorInfo } from "./error-display.js";

/**
 * Value type for ReactiveComponent variant.
 */
export interface ReactiveValue {
    render: () => ValueTypeOf<typeof UIComponentType>;
}

/**
 * Renders a reactive component that re-renders independently when its dependencies change.
 *
 * @remarks
 * This component executes the render function with dependency tracking enabled.
 * It subscribes only to the state and dataset keys that were accessed during rendering,
 * enabling selective re-rendering when those specific keys change.
 *
 * Trackers are pluggable — State registers at module load, Data registers when
 * ReactiveDatasetProvider mounts. The component re-renders when trackers are
 * added/removed via useSyncExternalStore on the tracker registry.
 */
export function EastReactiveComponent({ value, storageKey }: { value: ReactiveValue; storageKey: string }) {
    // Re-render when trackers are added/removed (e.g. DatasetProvider mounts)
    const trackersVersion = useSyncExternalStore(subscribeTrackers, getTrackersVersion);
    const trackers = getReactiveTrackers();

    // Track which keys each tracker records
    const depsRef = useRef<Map<string, string[]>>(new Map());

    // Execute render with dependency tracking for all registered trackers.
    // Returns either a successful render result or an error to display.
    const executeWithTracking = useCallback((): { ok: true; value: ValueTypeOf<typeof UIComponentType> } | { ok: false; error: unknown } => {
        for (const t of trackers) t.enableTracking();

        try {
            const result = value.render();
            const deps = new Map<string, string[]>();
            for (const t of trackers) {
                deps.set(t.id, t.disableTracking());
            }
            depsRef.current = deps;
            return { ok: true, value: result };
        } catch (e) {
            // Capture deps even on error so we re-render when they change
            const deps = new Map<string, string[]>();
            for (const t of trackers) {
                deps.set(t.id, t.disableTracking());
            }
            depsRef.current = deps;
            return { ok: false, error: e };
        }
    }, [value, trackers]);

    // Subscribe to the keys we depend on across all trackers
    const subscribe = useCallback((cb: () => void) => {
        const unsubs: (() => void)[] = [];
        for (const t of trackers) {
            const store = t.getStore();
            if (!store) continue;
            const keys = depsRef.current.get(t.id) ?? [];
            for (const key of keys) {
                unsubs.push(store.subscribe(key, cb));
            }
        }
        return () => unsubs.forEach(fn => fn());
    }, [trackers]);

    // Snapshot based on our dependencies' versions across all trackers
    const getSnapshot = useCallback(() => {
        const parts: string[] = [];
        for (const t of trackers) {
            const store = t.getStore();
            if (!store) continue;
            const keys = depsRef.current.get(t.id) ?? [];
            parts.push(keys.map(k => `${t.id}:${k}:${store.getKeyVersion(k)}`).join(","));
        }
        return parts.join("|");
    }, [trackers]);

    const snapshot = useSyncExternalStore(subscribe, getSnapshot);

    // trackersVersion forces re-render when trackers change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const result = useMemo(() => executeWithTracking(), [executeWithTracking, snapshot, trackersVersion]);

    if (!result.ok) {
        const info = toEastErrorInfo(result.error);
        return <EastErrorDisplay title="East Render Error" message={info.message} stack={info.stack} />;
    }

    if (result.value === undefined || result.value === null) {
        return null;
    }

    return (
        <EastErrorBoundary title="East Render Error" resetKey={snapshot}>
            <EastChakraComponent value={result.value} storageKey={storageKey} />
        </EastErrorBoundary>
    );
}
