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
 * Simpler than the Plan's (`plan/use-seek.ts`): a sheet row IS a source
 * element, so the k-th match is the row at `range.row + k` — the control's
 * prev / next step exactly.
 *
 * The bridge from the tracked `seek` read (`none` while searching, re-fires
 * when it lands) to the control's promise is the Plan's: the query goes into
 * state, the read runs inside {@link useTrackedEvaluation}, and the pending
 * promise resolves on the frame the answer arrives.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StringType, toEastTypeValue, type EastTypeValue } from "@elaraai/east";
import type { DatasetKeyMatchRange, DatasetKeyQuery } from "../key-search/index.js";
import { useTrackedEvaluation } from "../../reactive/index.js";
import { soughtKeyOf, toSeekQuery } from "../plan/use-seek.js";
import type { SheetPagedSourceValue, SheetRowValue } from "./values.js";

/** A sheet's keys are Strings — the search input parses against that. */
const KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);

/** What the toolbar needs to mount `<DatasetKeySearch>`. */
export interface SheetSearch {
    keyType: EastTypeValue;
    /** Locate a query — resolves when the tracked search lands. */
    find: (query: DatasetKeyQuery) => Promise<DatasetKeyMatchRange>;
    /** Label the popup from the resident head of the match run (the row ids). */
    listRange: (row: number, limit: number) => Promise<string[]>;
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
 * Wire a paged source's `seek` to the sheet.
 *
 * @param source - The decoded `paged` arm (undefined ⇒ inline sheet)
 * @param rows - The resident rows, in stream order
 * @param rowsOffset - The source position of `rows[0]`
 * @param jumpToElement - Ask the driver to rebase residency on a position
 * @param clearJump - Drop the driver's pending jump pin
 * @returns The search mount and the landing target
 */
export function useSheetSeek(
    source: SheetPagedSourceValue | undefined,
    rows: readonly SheetRowValue[],
    rowsOffset: number,
    jumpToElement: (element: number) => void,
    clearJump: () => void,
): SheetSeekState {
    const [query, setQuery] = useState<unknown>(null);
    const [target, setTarget] = useState<number | undefined>(undefined);
    // What `listRange` reads — refs: the control awaits `onFind` and then calls
    // the `onListRange` it captured before the state committed (#614).
    const residentRef = useRef({ rows, rowsOffset });
    useLayoutEffect(() => { residentRef.current = { rows, rowsOffset }; });
    const pending = useRef<{ resolve: (r: DatasetKeyMatchRange) => void; reject: (e: unknown) => void } | null>(null);

    const seekFn = useMemo(() => {
        if (source === undefined) return undefined;
        return source.seek.type === "some" ? source.seek.value : undefined;
    }, [source]);

    const read = useCallback(() => {
        if (seekFn === undefined || query === null) return undefined;
        return seekFn(query as never) as { type: string; value?: { found: boolean; row: bigint; count: bigint } };
    }, [seekFn, query]);
    const { result } = useTrackedEvaluation(read);

    useEffect(() => {
        const waiting = pending.current;
        if (waiting === null) return;
        if (!result.ok) {
            pending.current = null;
            waiting.reject(result.error);
            return;
        }
        const answer = result.value;
        if (answer === undefined || answer.type !== "some" || answer.value === undefined) return;
        pending.current = null;
        waiting.resolve({ found: answer.value.found, row: Number(answer.value.row), count: Number(answer.value.count) });
    }, [result]);

    const find = useCallback((q: DatasetKeyQuery) => new Promise<DatasetKeyMatchRange>((resolve, reject) => {
        pending.current?.reject(new Error("superseded by a newer query"));
        pending.current = { resolve, reject };
        void soughtKeyOf(q);
        setQuery(toSeekQuery(q));
    }), []);

    const listRange = useCallback(async (row: number, limit: number): Promise<string[]> => {
        // The head of the match run, by POSITION: the resident rows at
        // `row` onward, as far as they have landed (a far match lists nothing
        // until its window arrives; the count still shows).
        const { rows: resident, rowsOffset: offset } = residentRef.current;
        const out: string[] = [];
        for (let p = row; p < row + limit; p++) {
            const r = resident[p - offset];
            if (r === undefined) break;
            out.push(r.id);
        }
        return out;
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

    const search = useMemo<SheetSearch | undefined>(
        () => (seekFn === undefined ? undefined : { keyType: KEY_TYPE, find, listRange, jump, clear }),
        [seekFn, find, listRange, jump, clear],
    );

    return { search, target, clearTarget };
}
