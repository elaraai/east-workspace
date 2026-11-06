/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The rows a Record's select column ticks (`Record - DX Proposal.md` SL1,
 * P5), by row id: held apart from the ring, which a tick never moves, and read
 * through `useSyncExternalStore` — a row by its own tick, so a tick draws that
 * row and the header again, and no other.
 *
 * @packageDocumentation
 */

/** The rows ticked, and the calls that change them. */
export interface RecordTicks {
    /** Hears every change; returns the call that stops it. */
    subscribe: (listener: () => void) => () => void;
    /** Whether a row is ticked. */
    has: (id: string) => boolean;
    /** Moves with every change: what the header reads. */
    version: () => number;
    /** Ticks a row, or unticks it. */
    toggle: (id: string) => void;
    /** Ticks these rows, and only them. */
    set: (ids: readonly string[]) => void;
    /** Unticks every row. */
    clear: () => void;
    /** How many of these rows are ticked. */
    count: (ids: readonly string[]) => number;
}

/**
 * Makes a Record's ticks, none ticked.
 *
 * @returns The ticks
 */
export function createRecordTicks(): RecordTicks {
    let ticked: ReadonlySet<string> = new Set();
    let version = 0;
    const listeners = new Set<() => void>();
    const change = (next: ReadonlySet<string>) => {
        ticked = next;
        version += 1;
        for (const listener of listeners) listener();
    };
    return {
        subscribe: (listener) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        has: (id) => ticked.has(id),
        version: () => version,
        toggle: (id) => {
            const next = new Set(ticked);
            if (!next.delete(id)) next.add(id);
            change(next);
        },
        set: (ids) => change(new Set(ids)),
        clear: () => { if (ticked.size > 0) change(new Set()); },
        count: (ids) => ids.reduce((n, id) => (ticked.has(id) ? n + 1 : n), 0),
    };
}
