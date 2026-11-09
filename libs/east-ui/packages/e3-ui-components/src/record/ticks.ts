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
 * A tick outlives its row's place among the rows read (#1579): a paged record
 * drops a row as the grid scrolls far from it, and its tick stays, holding
 * what the Sheet held of the row as it was ticked — so Delete takes it still.
 *
 * @packageDocumentation
 */

import type { SheetEntryHold } from "../sheet/index.js";

/** What a tick holds of its row: what the Sheet held of it as it was ticked, or `undefined` for a row not read. */
type Held = SheetEntryHold | undefined;

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
    /** How many rows are ticked: those the rows read no longer hold among them. */
    size: () => number;
    /** Each row ticked, in the order ticked, and what the Sheet held of it as it was ticked. */
    held: () => ReadonlyMap<string, Held>;
    /** Where a tick takes what the Sheet holds of its row: the frame's, as the Sheet's rows stand. */
    holdWith: (hold: (id: string) => Held) => void;
}

/**
 * Makes a Record's ticks, none ticked.
 *
 * @returns The ticks
 */
export function createRecordTicks(): RecordTicks {
    let ticked: ReadonlyMap<string, Held> = new Map();
    let version = 0;
    let hold: (id: string) => Held = () => undefined;
    const listeners = new Set<() => void>();
    const change = (next: ReadonlyMap<string, Held>) => {
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
            const next = new Map(ticked);
            if (!next.delete(id)) next.set(id, hold(id));
            change(next);
        },
        set: (ids) => change(new Map(ids.map((id) => [id, ticked.has(id) ? ticked.get(id) : hold(id)] as const))),
        clear: () => { if (ticked.size > 0) change(new Map()); },
        count: (ids) => ids.reduce((n, id) => (ticked.has(id) ? n + 1 : n), 0),
        size: () => ticked.size,
        held: () => ticked,
        holdWith: (next) => { hold = next; },
    };
}
