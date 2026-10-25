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
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Where a virtual view rests: its top row, by key, and the px scrolled into it. */
export interface RowAnchor {
    readonly key: string;
    readonly offset: number;
}

/**
 * A virtual view's place (see the module docs).
 *
 * @param rows - The view's rows, each by its key
 * @param saved - Where it last rested
 * @param save - Told where it rests as its scroll settles
 * @param ready - Whether the rows are placed as they will be — a builder whose rows' estimate is measured from its first
 *   rows waits for that measure, so the rows above the one brought back stand where they will
 * @returns What its frame restores, and what it reports a settle to
 */
export function useRowAnchor(rows: readonly { readonly key: string }[], saved: RowAnchor | undefined, save: ((at: RowAnchor) => void) | undefined, ready = true): {
    restore: { index: number; offset: number } | undefined;
    onAnchorChange: (at: { index: number; offset: number }) => void;
} {
    const pending = useRef(saved);
    const [restore, setRestore] = useState<{ index: number; offset: number }>();
    useLayoutEffect(() => {
        const at = pending.current;
        if (at === undefined || !ready) return;
        const index = rows.findIndex(row => row.key === at.key);
        if (index < 0) return;
        pending.current = undefined;
        setRestore({ index, offset: at.offset });
    }, [rows, ready]);
    const onAnchorChange = useCallback((at: { index: number; offset: number }) => {
        const row = rows[at.index];
        if (row !== undefined) save?.({ key: row.key, offset: at.offset });
    }, [rows, save]);
    return { restore, onAnchorChange };
}
