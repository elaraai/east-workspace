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
    East,
    StringType,
    NullType,
    BooleanType,
    fromEastTypeValue,
    type EastTypeValue,
    encodeBeast2For,
    decodeBeast2For,
} from "@elaraai/east";
import { type PlatformFunction } from "@elaraai/east/internal";
import { State, StateBindPrimitives } from "@elaraai/east-ui/internal";
import { UIStore, type UIStoreInterface } from "./state-store.js";
import { registerReactiveTracker } from "../reactive/tracker.js";
import { registerPlatformImplementation, getRegisteredPlatformImplementations } from "./registry.js";

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

// Compiled-handle cache (issue #106 perf): State.bind compiles 3 East.functions
// per bind, and binds re-run on every reactive frame (e.g. a slider dragging).
// The method IR is a pure function of the state key (whose type + default are
// fixed by construction), and the methods resolve getStore() LIVE, so a cached
// handle still re-binds across store swaps. Module-level (State has no runtime
// instance — getStore() is a singleton).
const stateHandleCache = new Map<string, Record<string, unknown>>();

/**
 * Platform implementation for `State.bind` and its backing primitives.
 *
 * A `State.bind` handle is `{read,write,has}`. The methods are built as thin,
 * IR-bearing `East.function`s over the `state_read`/`state_write`/`state_has`
 * primitives, capturing only the plain-data key (+ default) — so the handle is
 * ordinary serializable East data (issue #106). A captured handle encodes, and
 * `decodeBeast2For({ platform })` recompiles these methods against the decoder's
 * platform map, re-binding every op to the decoder's {@link getStore} store.
 *
 * The primitives carry the host side-effects (store I/O + reactive tracking).
 */
export const StateImpl: PlatformFunction[] = [
    // Primitive: read the key (registering the reactive dependency), falling back
    // to the captured default when the key is absent — e.g. after decode, where
    // `bind` did not re-run to eager-init it.
    StateBindPrimitives.read.implement((type: EastTypeValue) => {
        const decode = decodeBeast2For(type); // built once per type-resolution, not per read()
        return (key: unknown, defaultValue: unknown) => {
            const k = key as string;
            trackKey(k);
            const raw = getStore().read(k);
            if (raw === undefined) return defaultValue;
            return decode(raw);
        };
    }),
    // Primitive: write the key.
    StateBindPrimitives.write.implement((type: EastTypeValue) => {
        const encode = encodeBeast2For(type); // built once per type-resolution, not per write()
        return (key: unknown, value: unknown) => {
            getStore().write(key as string, encode(value));
            return null;
        };
    }),
    // Primitive: existence check.
    StateBindPrimitives.has.implement((key: unknown) => getStore().has(key as string)),

    // State.bind — assemble the handle from IR-bearing method functions.
    State.bind.implement((type: EastTypeValue) => (key: unknown, defaultValue: unknown) => {
        const k = key as string;
        const T = fromEastTypeValue(type);

        // Eager-init at bind time so the non-serialized path keeps has() === true
        // and read() returns a value immediately after bind. On decode `bind` does
        // not re-run; the read primitive's default fallback covers that case. (Runs
        // every bind, before the cache, so the current store is always seeded.)
        if (!getStore().has(k)) {
            getStore().write(k, encodeBeast2For(type)(defaultValue));
        }

        // Compiled-handle cache: same key ⇒ same 3 method IRs; skip the compiles on
        // a hit (the methods resolve getStore() live, so the cached handle still
        // re-binds to whatever store is current).
        const cached = stateHandleCache.get(k);
        if (cached) return cached;

        // Compile the three method functions against the registered platform (which
        // includes the primitives above). Each captures only `key` (+ `default`),
        // so the resulting handle serializes.
        const platform = getRegisteredPlatformImplementations();
        const keyExpr = East.value(k, StringType);
        const defExpr = East.value(defaultValue as never, T);

        const handle: Record<string, unknown> = {
            read: East.compile(East.function([], T, ($) => { $.return(StateBindPrimitives.read([T], keyExpr, defExpr)); }), platform),
            write: East.compile(East.function([T], NullType, ($, v) => { $.return(StateBindPrimitives.write([T], keyExpr, v)); }), platform),
            has: East.compile(East.function([], BooleanType, ($) => { $.return(StateBindPrimitives.has(keyExpr)); }), platform),
        };
        stateHandleCache.set(k, handle);
        return handle;
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
