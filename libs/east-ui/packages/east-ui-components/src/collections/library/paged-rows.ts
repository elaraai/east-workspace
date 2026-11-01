/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The reading a paged collection shares (#1398, CL8; #1424): the paged
 * Library's rows (`PagedLibrary`) and e3-ui-components' DecisionQueue's cases
 * (`Decision Queue Spec.md` §6) read through it. The windows of
 * {@link PAGED_LIBRARY_PAGE} rows around the view are read as the view comes
 * to rest, a window either side ahead of it.
 *
 * A new narrowing never blinks: the rows that last landed stand in, retained
 * — aria-disabled in a busy region, readable and taking no gesture that edits
 * — until the new narrowing's count and its first rows land, and are swapped
 * whole then, its view starting again at its start; a new revision's rows, or
 * a new count's at the same revision — its host's drafts moving its rows —
 * stand in the same way, the view kept. A read again of the rows it showed —
 * the same narrowing, revision and count, its windows let go meanwhile — keeps
 * them until they land again. Only the first read, and rows scrolled into
 * view, are pending.
 *
 * @packageDocumentation
 */
import { useCallback, useRef, useState } from "react";
import type { option } from "@elaraai/east";
import { useTrackedEvaluation, type TrackedResult } from "../../reactive/index.js";
import { planWindows } from "../paged-window-store.js";

/**
 * How many rows a paged collection reads a page: its source's `page(offset, limit)` is asked a window of this many at
 * a time, its first `page(0, PAGED_LIBRARY_PAGE)` — what a host whose figures must swap with the collection's rows
 * waits on (the Calendar's Backlog count, #1424).
 */
export const PAGED_LIBRARY_PAGE = 32;

/** The rows a view shows, by place: from `start`, up to but not including `end`. */
export interface PagedRange {
    readonly start: number;
    readonly end: number;
}

/**
 * One read of a paged collection's rows: what {@link usePagedRows} keeps and stands in with. A host's read may carry
 * more of its own beside them — the paged Library's, what its search read.
 *
 * @typeParam T - The collection's rows
 */
export interface PagedRowsRead<T> {
    /** How many rows it holds; `undefined` while it is counted. */
    readonly count: number | undefined;
    /** The rows read, by place. */
    readonly rows: ReadonlyMap<number, T>;
    /** The revision it read at; `undefined` before one is known. */
    readonly revision: string | undefined;
}

/** Retained content (#1398, CL8): what stands in while a new narrowing is read — aria-disabled in a busy region. */
export const PAGED_RETAINED = { "aria-busy": true, "aria-disabled": true } as const;

/** The rows a narrowing reads first: from its start. */
const FIRST_ROWS: PagedRange = { start: 0, end: 12 };

/**
 * Reads the windows a view needs (`planWindows`): each window of {@link PAGED_LIBRARY_PAGE} rows covering the range,
 * and one either side, asked of `page`; tracked where it is called, so a window landing reads them again.
 *
 * @param range - The rows the view shows
 * @param count - How many rows the source holds; `undefined` while it is counted
 * @param page - A window of the source's rows: `none` while it is read
 * @returns The rows the windows hold, by place
 */
export function readPagedWindows<T>(range: PagedRange, count: number | undefined,
    page: (offset: bigint, limit: bigint) => option<readonly T[]>): Map<number, T> {
    const rows = new Map<number, T>();
    if (count === 0) return rows;
    for (const window of planWindows(range, PAGED_LIBRARY_PAGE, count).needed) {
        const offset = window * PAGED_LIBRARY_PAGE;
        const got = page(BigInt(offset), BigInt(PAGED_LIBRARY_PAGE));
        if (got.type === "some") got.value.forEach((row, i) => rows.set(offset + i, row));
    }
    return rows;
}

/** Whether a read has landed: its count known, and every row of the range it reads that the count holds read. */
function landedAt<T>(read: PagedRowsRead<T>, range: PagedRange): boolean {
    if (read.count === undefined) return false;
    const end = Math.min(range.end, read.count);
    for (let at = range.start; at < end; at++) if (!read.rows.has(at)) return false;
    return true;
}

/**
 * What {@link usePagedRows} hands its collection.
 *
 * @typeParam R - The host's read
 */
export interface PagedRows<R> {
    /** The read as it last ran: its value, or what it threw. */
    readonly result: TrackedResult<R>;
    /**
     * The read to draw: the one that last landed while a new one stands behind it, the two together while a read
     * again of the rows it showed lands, else the read as it runs; `undefined` while the read throws.
     */
    readonly shown: R | undefined;
    /** The read that last landed: what a collection may keep drawn while the read throws; `undefined` before one lands. */
    readonly held: R | undefined;
    /** Whether the rows that last landed stand in, retained: a new narrowing's, revision's or count's rows are read. */
    readonly standing: boolean;
    /** Whether they stand in for a new narrowing: its rows are read from its start. */
    readonly filtering: boolean;
    /** Whether the view waits on a read: rows standing in, or rows in view not read yet. */
    readonly reading: boolean;
    /** Whether a read has landed: false until the first count and its rows in view are read. */
    readonly landed: boolean;
    /** The narrowing the rows shown are of: the collection keys its view by it, so a swap starts the new one at its start. */
    readonly identity: string;
    /** Hears where the collection's view rests: what `VirtualRows`' `onRangeChange` reports, read once it is still. */
    readonly onRangeChange: (range: { readonly startIndex: number; readonly endIndex: number }, scrolling: boolean) => void;
    /** The retained content's attributes on the collection's region while the rows stand in; `undefined` while they are live. */
    readonly retained: typeof PAGED_RETAINED | undefined;
}

/**
 * Reads a paged collection's rows (see the module docs): the host's read of the rows the view shows, the rows that
 * last landed standing in while a new narrowing's, revision's or count's land.
 *
 * @typeParam T - The collection's rows
 * @typeParam R - The host's read: the rows, their count and revision, and anything of its own beside them
 * @param identity - The narrowing the rows are of — the source's id and its `query()`, and any narrowing of the host's
 *   own — as one: a new one reads from its start
 * @param read - Reads the rows of a range — the windows {@link readPagedWindows} reads — tracked; keep it the same
 *   function while what it reads holds (`useCallback`)
 * @returns The read to draw, whether it stands in, and what the collection's view reports where it rests to
 */
export function usePagedRows<T, R extends PagedRowsRead<T>>(identity: string, read: (range: PagedRange) => R): PagedRows<R> {
    // The rows in view and the narrowing they are of: a new narrowing reads from its start.
    const [viewed, setViewed] = useState<{ readonly identity: string; readonly start: number; readonly end: number }>({ identity, ...FIRST_ROWS });
    const { start, end } = viewed.identity === identity ? viewed : FIRST_ROWS;
    const evaluate = useCallback(() => read({ start, end }), [read, start, end]);
    const { result } = useTrackedEvaluation(evaluate);
    // The read that last landed, and the narrowing it is of: while a new narrowing's count and first rows are read — or a
    // new revision's of the rows in view, or a new count's at the same revision, its host's drafts moving its rows — it
    // stands in, retained (#1398, CL8), and is swapped whole once they land, never the pending rows again. Rows scrolled
    // into view at the same revision and count are read as pending rows, the rest kept live.
    const landed = useRef<{ readonly identity: string; readonly read: R } | undefined>(undefined);
    const now = result.ok ? result.value : undefined;
    const arrived = now !== undefined && landedAt(now, { start, end });
    if (arrived) landed.current = { identity, read: now };
    const last = landed.current;
    const standing = now !== undefined && last !== undefined && (last.identity !== identity || last.read.revision !== now.revision
        || (now.count !== undefined && now.count !== last.read.count));
    // The narrowing the rows shown are of: its view is its own, so the swap starts the new one's at its start.
    const shownIdentity = standing ? last.identity : identity;
    const onRangeChange = useCallback((next: { readonly startIndex: number; readonly endIndex: number }, scrolling: boolean) => {
        if (scrolling) return;
        setViewed(old => old.identity === shownIdentity && old.start === next.startIndex && old.end === next.endIndex + 1
            ? old : { identity: shownIdentity, start: next.startIndex, end: next.endIndex + 1 });
    }, [shownIdentity]);
    // A read again of the rows it showed — the same narrowing, revision and count, or its count not read yet, its windows
    // let go meanwhile — keeps what landed of them until they land again: the same rows at the same places, never the
    // pending rows over them; rows scrolled into view still read as pending rows.
    const again = !standing && last !== undefined && now !== undefined && last.read !== now;
    const shown = now === undefined ? undefined : standing ? last!.read
        : again ? { ...now, count: now.count ?? last.read.count, rows: new Map([...last.read.rows, ...now.rows]) } as R : now;
    return {
        result, shown, held: last?.read, standing, filtering: standing && last!.identity !== identity,
        reading: standing || (now !== undefined && !arrived),
        landed: last !== undefined, identity: shownIdentity, onRangeChange, retained: standing ? PAGED_RETAINED : undefined,
    };
}
