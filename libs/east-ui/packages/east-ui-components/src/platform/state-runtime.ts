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
    none,
    some,
    StringType,
    NullType,
    BooleanType,
    fromEastTypeValue,
    printType,
    type EastTypeValue,
    encodeBeast2For,
    decodeBeast2For,
} from "@elaraai/east";
import { type PlatformFunction } from "@elaraai/east/internal";
import { State, StateBindPrimitives, EditingRequestStore } from "@elaraai/east-ui/internal";
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

/** The keys the render being tracked has read, each with its version as the render first read it; `null` while none is. */
let trackingContext: Map<string, number> | null = null;

/**
 * Start recording the keys a render reads.
 *
 * @returns What it records: each key read, with its version as first read
 */
export function enableTracking(): ReadonlyMap<string, number> {
    trackingContext = new Map();
    return trackingContext;
}

/**
 * Stop recording.
 *
 * @returns Each key the render read, with its version as it first read it — what the render was computed from: a key
 *   it wrote after reading it stands at another in the store
 */
export function disableTracking(): ReadonlyMap<string, number> {
    const keys = trackingContext ?? new Map<string, number>();
    trackingContext = null;
    return keys;
}

export function isTracking(): boolean {
    return trackingContext !== null;
}

/**
 * Record a read of a key, while a render is tracked: its version as it is read now, unless the render read it before.
 *
 * @param key - The key read
 */
export function trackKey(key: string): void {
    if (trackingContext !== null && !trackingContext.has(key)) trackingContext.set(key, getStore().getKeyVersion(key));
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
// The editing contract's inline requests (#879): they outlive render-key
// garbage collection, but not the UI store.
const editingRequests = new WeakMap<UIStoreInterface, Map<string, Uint8Array>>();

const stateHandleCache = new Map<string, Record<string, unknown>>();

/** The values a read found kept under another type than the one it asked, each with the types asked of it: said once for each. */
const unreadable = new WeakMap<Uint8Array, Set<string>>();

/**
 * What the store keeps under a key, read as a type — or nothing, where it does
 * not read as that type (#1758).
 *
 * A store outlives a release: a persistent one across sessions, a page left
 * open across a deploy. A key can then hold a value written under the type an
 * earlier release gave it — a saved query before it held its sources, a
 * narrowing whose choices could be a window — which beast2 refuses to read as
 * another. That is nothing kept: its reader takes what it starts from, as over
 * a key that holds nothing, until a value is written. It is said once for each
 * value and type, naming the key, so two readers sharing a key by mistake are
 * not silent; and such a value is not decoded again. A reader of another type
 * still reads it: what marks a value is the type it did not read as.
 *
 * @typeParam T - What the bytes decode to
 * @param key - The key the bytes are kept under: what is said names it
 * @param bytes - What the store keeps under the key
 * @param type - The type asked, as East prints it
 * @param decode - The type's decoder
 * @returns The value; `undefined` where the bytes do not read as the type
 */
export function decodeStored<T>(key: string, bytes: Uint8Array, type: string, decode: (bytes: Uint8Array) => T): T | undefined {
    const refused = unreadable.get(bytes);
    if (refused?.has(type) === true) return undefined;
    try {
        return decode(bytes);
    } catch (error) {
        // The store keeps the buffer it holds until other bytes are written: said once, and not decoded again.
        if (refused === undefined) unreadable.set(bytes, new Set([type]));
        else refused.add(type);
        console.warn(`[east-ui] what the store keeps under "${key}" does not read as the type asked of it, and is nothing kept`, error);
        return undefined;
    }
}

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
    EditingRequestStore.read.implement((key) => {
        const payload = editingRequests.get(getStore())?.get(key);
        return payload === undefined ? none : some(payload.slice());
    }),
    EditingRequestStore.write.implement((key, payload) => {
        const store = getStore();
        let records = editingRequests.get(store);
        if (!records) { records = new Map(); editingRequests.set(store, records); }
        records.set(key, payload.slice());
        return null;
    }),
    // Primitive: read the key (registering the reactive dependency), falling back
    // to the captured default when the key is absent — e.g. after decode, where
    // `bind` did not re-run to eager-init it — and when what the store keeps
    // under it does not read as the state's type (#1758), which is nothing
    // kept ({@link decodeStored}): the state reads its default until it is
    // written.
    StateBindPrimitives.read.implement((type: EastTypeValue) => {
        // Built once per type-resolution, not per read().
        const decode = decodeBeast2For(type);
        const name = printType(fromEastTypeValue(type));
        return (key: unknown, defaultValue: unknown) => {
            const k = key as string;
            trackKey(k);
            const raw = getStore().read(k);
            if (raw === undefined) return defaultValue;
            const value = decodeStored(k, raw, name, decode);
            return value === undefined ? defaultValue : value;
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
