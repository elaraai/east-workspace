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
    State.bind.implement((type: EastTypeValue) => (key: unknown) => {
        const k = key as string;
        return {
            read: () => {
                trackKey(k);
                const ret = getStore().read(k);
                if (ret === undefined) {
                    throw new Error(`Key not found: ${k}`);
                }
                return decodeBeast2Value(getWasmSync(), ret, type);
            },
            write: (value: unknown) => {
                const encode = encodeBeast2For(type);
                getStore().write(k, encode(value));
                return null;
            },
            has: () => getStore().has(k),
        };
    }),
];
