/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Runtime implementation for State.bind platform function.
 *
 * @packageDocumentation
 */

import {
    type EastTypeValue,
    encodeBeast2For,
} from "@elaraai/east";
import { type PlatformFunction } from "@elaraai/east/internal";
import { getWasmSync, decodeBeast2Value } from "./wasm.js";
import { State } from "@elaraai/east-ui";
import { UIStore, type UIStoreInterface } from "./state-store.js";
import { registerReactiveTracker } from "../reactive/tracker.js";
import { registerPlatformImplementation } from "./registry.js";

// =============================================================================
// Singleton Store
// =============================================================================

let _store: UIStoreInterface | null = null;

export function getStore(): UIStoreInterface {
    if (!_store) {
        _store = new UIStore();
    }
    return _store;
}

export function initializeStore(store: UIStoreInterface): void {
    _store = store;
}

// =============================================================================
// Reactive Dependency Tracking
// =============================================================================

let trackingContext: Set<string> | null = null;

export function enableTracking(): Set<string> {
    trackingContext = new Set();
    return trackingContext;
}

export function disableTracking(): string[] {
    const keys = trackingContext ? [...trackingContext] : [];
    trackingContext = null;
    return keys;
}

export function isTracking(): boolean {
    return trackingContext !== null;
}

export function trackKey(key: string): void {
    if (trackingContext) {
        trackingContext.add(key);
    }
}

// =============================================================================
// Platform Implementation — State.bind
// =============================================================================

/**
 * Platform implementation for State.bind.
 *
 * Returns a struct of closures: { read, write, has }.
 */
export const StateImpl: PlatformFunction[] = [
    State.bind.implement((type: EastTypeValue) => (key: unknown, defaultValue: unknown) => {
        const k = key as string;
        const encode = encodeBeast2For(type);

        // Eagerly initialize the key with defaultValue if not yet set.
        // This ensures read() always returns a value and has() is always true
        // after the first bind.
        if (!getStore().has(k)) {
            getStore().write(k, encode(defaultValue));
        }

        return {
            read: () => {
                trackKey(k);
                const ret = getStore().read(k);
                // Should never happen: bind() initialized the key above.
                // Defensive fallback returns the default rather than throwing.
                if (ret === undefined) {
                    return defaultValue;
                }
                return decodeBeast2Value(getWasmSync(), ret, type);
            },
            write: (value: unknown) => {
                getStore().write(k, encode(value));
                return null;
            },
            has: () => getStore().has(k),
        };
    }),
];

// Register State tracker and platform implementation at module load
registerReactiveTracker({
    id: "s",
    enableTracking,
    disableTracking,
    getStore: () => {
        const store = getStore();
        return {
            subscribe: (key: string, cb: () => void) => store.subscribe(key, cb),
            getKeyVersion: (key: string) => store.getKeyVersion(key),
        };
    },
});

registerPlatformImplementation(StateImpl);
