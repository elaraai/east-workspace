/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paged sheet's KEY SEARCH (`Sheet Spec.md` §3.13, §5 row 21) — on a
 * keyed source the rail's search stops being a row filter over the loaded
 * prefix and becomes a seek over the whole source: a query is answered in
 * SOURCE POSITIONS, a jump rebases the residency there (the windows in
 * between are never fetched), and the ring lands on the row once its window
 * is resident.
 *
 * Simpler than the Plan's (e3-ui-components' `plan/use-seek.ts`): a sheet row IS a source
 * element, so the k-th match is the row at `range.row + k` — the control's
 * prev / next step exactly.
 *
 * The box lists the match run's rows wherever they are (#1398, CL10): each
 * read through the source by its position, a far match's as well as one on
 * screen, never only the rows the sheet has drawn — and, under a narrowing of
 * the record's rows, each the narrowing hides marked so, which a pick opens.
 *
 * The bridge from the tracked `seek` read (`none` while searching, re-fires
 * when it lands) to the control's promise is the Plan's: the query goes into
 * state, the read runs inside {@link useTrackedEvaluation}, and the pending
 * promise resolves on the frame the answer arrives.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StringType, toEastTypeValue, type EastTypeValue, type option } from "@elaraai/east";
import { type DatasetKeyMatchRange, type DatasetKeyQuery, useTrackedEvaluation } from "@elaraai/east-ui-components";
import { pagedSnapshot, pagedSnapshotEqual, pagedSnapshotKey } from "./paged-snapshot.js";
import { awaitTracked, toSeekQuery } from "@elaraai/east-ui-components/internal";
import type { SheetPagedSourceValue, SheetRowValue } from "./values.js";

/** A sheet's keys are Strings — the search input parses against that. */
const KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);

/** A row the box lists: its place in the source, its line, and what the box shows once it is picked — its key. */
export interface SheetListed {
    readonly row: number;
    readonly label: string;
    readonly text: string;
}

/** What the toolbar's key search drives — the shared item's source (`useKeySearchToolbarItem`, #1221). */
export interface SheetSearch {
    /** Source snapshot identity; remounts cached positional search results. */
    resetKey: string;
    keyType: EastTypeValue;
    /** Locate a query — resolves when the tracked search lands. */
    find: (query: DatasetKeyQuery) => Promise<DatasetKeyMatchRange>;
    /** Label the popup's rows of the match run, each read through the source by its position — its row's id, and whether a narrowing hides it. */
    listRange: (row: number, limit: number) => Promise<SheetListed[]>;
    /** Jump to the match at source position `row`. */
    jump: (row: number) => void;
    /** Drop the query and its jump target. */
    clear: () => void;
}

export interface SheetSeekState {
    /** Mount data for the search control — `undefined` when the source declares no `seek`. */
    search: SheetSearch | undefined;
    /** The source position the ring should land on once resident. */
    target: number | undefined;
    /** The target landed (or was abandoned). */
    clearTarget: () => void;
}

/**
 * Which of the source's rows `[from, from + count)` a narrowing of them holds — a tracked read, `none` while pending:
 * the `rows` source's narrowing drawn over its record's rows as the lens (#1349).
 */
export type SheetSeekHeld = (from: number, count: number) => option<readonly boolean[]>;

/**
 * Wire a paged source's `seek` to the sheet.
 *
 * @param source - The decoded `paged` arm (undefined ⇒ inline sheet)
 * @param jumpToElement - Ask the driver to rebase residency on a position
 * @param clearJump - Drop the driver's pending jump pin
 * @param held - Under a narrowing of the source's rows that hides some of them, which of a run of them it holds; else `undefined`
 * @param hiddenLine - A listed row the narrowing hides, as the box lists it, by its key
 * @returns The search mount and the landing target
 */
export function useSheetSeek(
    source: SheetPagedSourceValue | undefined,
    jumpToElement: (element: number) => void,
    clearJump: () => void,
    held: SheetSeekHeld | undefined,
    hiddenLine: (key: string) => string,
): SheetSeekState {
    const [query, setQuery] = useState<unknown>(null);
    const [target, setTarget] = useState<number | undefined>(undefined);
    // What `listRange` reads — refs: the control awaits `onFind` and then calls
    // the `onListRange` it captured before the state committed (#614).
    const latest = useRef({ source, held, hiddenLine });
    useLayoutEffect(() => { latest.current = { source, held, hiddenLine }; });
    const pending = useRef<{ resolve: (r: DatasetKeyMatchRange) => void; reject: (e: unknown) => void } | null>(null);

    const seekFn = useMemo(() => {
        if (source === undefined) return undefined;
        return source.seek.type === "some" ? source.seek.value : undefined;
    }, [source]);

    const read = useCallback(() => {
        const revision = source?.revision?.();
        const answer = seekFn === undefined || query === null ? undefined
            : seekFn(query as never);
        return { revision, answer };
    }, [source, seekFn, query]);
    const { result } = useTrackedEvaluation(read);
    const revision = result.ok && result.value.revision?.type === "some"
        ? result.value.revision.value : undefined;
    const snapshot = useMemo(() => pagedSnapshot(source?.id, revision), [source?.id, revision]);
    const resetKey = pagedSnapshotKey(snapshot);
    const previousSnapshot = useRef(snapshot);
    const snapshotChanged = !pagedSnapshotEqual(previousSnapshot.current, snapshot);

    useEffect(() => {
        const waiting = pending.current;
        if (waiting === null) return;
        if (!result.ok) {
            pending.current = null;
            waiting.reject(result.error);
            return;
        }
        const answer = result.value.answer;
        if (answer === undefined || answer.type !== "some" || answer.value === undefined) return;
        pending.current = null;
        waiting.resolve({ found: answer.value.found, row: Number(answer.value.row), count: Number(answer.value.count) });
    }, [result]);

    const find = useCallback((q: DatasetKeyQuery) => new Promise<DatasetKeyMatchRange>((resolve, reject) => {
        pending.current?.reject(new Error("superseded by a newer query"));
        pending.current = { resolve, reject };
        setQuery(toSeekQuery(q));
    }), []);

    const listRange = useCallback(async (row: number, limit: number): Promise<SheetListed[]> => {
        // The head of the match run, by POSITION: its rows read through the source — on screen, far off, or hidden by
        // the narrowing, whose window the sheet has not drawn (#1398, CL10) — each its row's id.
        const { source: from, held: holds, hiddenLine: hidden } = latest.current;
        if (from === undefined || limit <= 0) return [];
        const rows = await awaitTracked(() => from.page(BigInt(row), BigInt(limit))) as readonly SheetRowValue[];
        const shown = holds === undefined || rows.length === 0 ? undefined : await awaitTracked(() => holds(row, rows.length));
        // A pick shows the row's key in the box: what its query is typed against.
        return rows.map((r, i) => ({ row: row + i, label: shown !== undefined && shown[i] === false ? hidden(r.id) : r.id, text: r.id }));
    }, []);

    const jump = useCallback((row: number) => {
        jumpToElement(row);
        setTarget(row);
    }, [jumpToElement]);

    const clear = useCallback(() => {
        pending.current?.reject(new Error("search cleared"));
        pending.current = null;
        setQuery(null);
        setTarget(undefined);
        clearJump();
    }, [clearJump]);

    const clearTarget = useCallback(() => setTarget(undefined), []);

    // Clear positions before passive effects can settle an answer from the
    // previous snapshot. A query can be repeated against the new source, but
    // its old element index cannot be reused there.
    useLayoutEffect(() => {
        if (pagedSnapshotEqual(previousSnapshot.current, snapshot)) return;
        previousSnapshot.current = snapshot;
        clear();
    }, [snapshot, clear]);
    const clearJumpRef = useRef(clearJump);
    useLayoutEffect(() => { clearJumpRef.current = clearJump; });
    useEffect(() => () => {
        pending.current?.reject(new Error("search source unmounted"));
        pending.current = null;
        clearJumpRef.current();
    }, []);

    const search = useMemo<SheetSearch | undefined>(
        () => (seekFn === undefined ? undefined : { resetKey, keyType: KEY_TYPE, find, listRange, jump, clear }),
        [resetKey, seekFn, find, listRange, jump, clear],
    );

    return { search, target: snapshotChanged ? undefined : target, clearTarget };
}
