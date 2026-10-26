/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Where a builder's virtual rows rest (#1398): the row at the top of the view,
 * by its key, and the px scrolled into it — what the shared `VirtualRows`
 * reports as a scroll settles (`onAnchorChange`), saved by the builder under
 * its key, and brought back once the rows are laid out (`restoreAnchor`): the
 * row it left, wherever the rows above it moved. Never a pixel offset of the
 * whole, which the rows above it would move (the Table's #143 rule). The
 * Roster's People rows and cards, the Calendar's timeline and the
 * Allocation's Table keep their places so.
 *
 * A builder whose rows a narrowing chooses says which narrowing they are under
 * ({@link RowNarrowing}): a new one keeps the row the view rested on, by its
 * key and the px into it, where the narrowing holds it, and else starts the
 * view at the top — once the narrowing's rows are in, as the Sheet keeps its
 * own (the Allocation's Table).
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { StringType, equalFor } from "@elaraai/east";

const sameText = equalFor(StringType);

/** Where a virtual view rests: its top row, by key, and the px scrolled into it. */
export interface RowAnchor {
    readonly key: string;
    readonly offset: number;
}

/** The narrowing a builder's rows are under, and whether its rows are in. */
export interface RowNarrowing {
    /** The narrowing, as text: a new one keeps the view's place. */
    readonly query: string;
    /** Whether its rows are in: its membership read, the last no longer standing in. */
    readonly settled: boolean;
}

/**
 * A virtual view's place (see the module docs).
 *
 * @param rows - The view's rows, each by its key
 * @param saved - Where it last rested
 * @param save - Told where it rests as its scroll settles
 * @param ready - Whether the rows are placed as they will be — a builder whose rows' estimate is measured from its first
 *   rows waits for that measure, so the rows above the one brought back stand where they will
 * @param narrowing - The narrowing the rows are under, where one chooses them: across a new one the view keeps the row it
 *   rested on where the narrowing holds it, else starts at the top
 * @returns What its frame restores, and what it reports a settle to
 */
export function useRowAnchor(rows: readonly { readonly key: string }[], saved: RowAnchor | undefined, save: ((at: RowAnchor) => void) | undefined, ready = true,
    narrowing?: RowNarrowing): {
    restore: { index: number; offset: number } | undefined;
    onAnchorChange: (at: { index: number; offset: number }) => void;
} {
    const pending = useRef(saved);
    // Where the view last rested, as its scroll settled — or where it was brought back to: what a new narrowing keeps.
    const rested = useRef(saved);
    // The narrowing the view's place was last kept across.
    const kept = useRef(narrowing?.query);
    const [restore, setRestore] = useState<{ index: number; offset: number }>();
    const query = narrowing?.query;
    const settled = narrowing?.settled ?? false;
    useLayoutEffect(() => {
        if (query !== undefined && settled && (kept.current === undefined || !sameText(kept.current, query))) {
            kept.current = query;
            pending.current = undefined;
            const at = rested.current;
            const index = at === undefined ? -1 : rows.findIndex(row => row.key === at.key);
            setRestore(at !== undefined && index >= 0 ? { index, offset: at.offset } : { index: 0, offset: 0 });
            return;
        }
        const at = pending.current;
        if (at === undefined || !ready) return;
        const index = rows.findIndex(row => row.key === at.key);
        if (index < 0) return;
        pending.current = undefined;
        setRestore({ index, offset: at.offset });
    }, [rows, ready, query, settled]);
    const onAnchorChange = useCallback((at: { index: number; offset: number }) => {
        const row = rows[at.index];
        if (row === undefined) return;
        rested.current = { key: row.key, offset: at.offset };
        save?.(rested.current);
    }, [rows, save]);
    return { restore, onAnchorChange };
}
