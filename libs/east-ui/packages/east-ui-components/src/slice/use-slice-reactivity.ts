/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { useSyncExternalStore } from "react";
import { getStore } from "../platform/state-runtime.js";

/**
 * Subscribe a `Slice.*` renderer to its own slice key so it re-renders whenever
 * a mutator writes the store — independent of whether the enclosing
 * `Reactive.Root` happened to read the slice. This is what makes the slice
 * components self-driving: clicking a chip / preset / builder mutates the slice
 * and the surface updates with no consumer-side `slice.read()` required.
 *
 * @param key - The slice's store key (`slice.key`); a falsy key is a no-op
 *              (e.g. test fakes that don't go through the store).
 * @returns the store's current version for `key` — a monotonic counter that
 *          bumps on every mutation. Callers can use it as a memo dep to rebuild
 *          slice-derived UI only when the slice actually changes (not on
 *          unrelated re-renders, e.g. a Schematic's per-frame camera state).
 */
export function useSliceReactivity(key: string | undefined): number {
    const store = getStore();
    return useSyncExternalStore(
        cb => (key ? store.subscribe(key, cb) : () => {}),
        () => (key ? store.getKeyVersion(key) : 0),
        () => (key ? store.getKeyVersion(key) : 0),
    );
}
