/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { NOT_KEPT, keptJson, keptReachable, useKept, type KeptReader } from "../platform/kept.js";

export interface PersistedStateResult<T> {
    state: T;
    setState: (updater: T | ((prev: T) => T)) => void;
    removeState: () => void;
    isPersistent: boolean;
}

/**
 * A stored value of the default's kind: a list for a list, a record for a
 * record, a primitive of the same type; anything for no default.
 *
 * @param value - The default
 * @returns The reader
 */
function sameKindAs<T>(value: T): KeptReader<T> {
    return (stored) => {
        if (value === undefined || value === null) return stored as T;
        if (Array.isArray(value)) return Array.isArray(stored) ? stored as T : NOT_KEPT;
        if (typeof value === "object") return typeof stored === "object" && stored !== null && !Array.isArray(stored) ? stored as T : NOT_KEPT;
        return typeof stored === typeof value ? stored as T : NOT_KEPT;
    };
}

/**
 * A component's view state, kept in the browser for a reload — one key per
 * component instance — through the kept state (`platform/kept.ts`): read
 * before the first draw, written before the task that changed it ends, the
 * same value in every component of the page that keeps the key, and a
 * storage failure never thrown.
 *
 * Storage outlives versions, so a stored value is taken only through `read`,
 * in the shape this version writes; with none, only a value of the default's
 * kind is taken. Only plain data — never an East value, which keeps its
 * beast2 (`keptBytes`).
 *
 * @typeParam T - The state
 * @param storageKey - The component instance's key
 * @param defaultValue - The state while nothing is kept
 * @param read - Reads a stored value in the shape this version writes
 * @returns The state, its setter and remover, and whether it survives a reload
 */
export function usePersistedState<T>(
    storageKey: string,
    defaultValue: T,
    read?: KeptReader<T>,
): PersistedStateResult<T> {
    const [state, setState, removeState] = useKept(storageKey, keptJson(read ?? sameKindAs(defaultValue)), defaultValue);
    return { state, setState, removeState, isPersistent: keptReachable("browser") };
}
