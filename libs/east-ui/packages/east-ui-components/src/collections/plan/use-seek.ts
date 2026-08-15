/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The paged canvas's KEY SEARCH — `search` stops being a row filter and becomes
 * a seek (#567 D9, the affordance table).
 *
 * # Why a key search can address canvas rows at all
 *
 * `seek` answers in SOURCE ELEMENT indices, and a Plan synthesizes its rows per
 * element (a series can emit several rows for one element, or none), so an
 * element index is not a canvas row index and never will be. What makes the
 * jump well-defined is #568: a leaf row's key IS its data key, and both the
 * source and the canvas collection are in canonical key order. So a query's
 * matches — one CONTIGUOUS run in the source's key order — are also a
 * contiguous run of canvas rows starting at the first row at-or-after the
 * sought key. The i-th match is the i-th canvas row of that run, derived
 * entirely in key space.
 *
 * The element index is still needed for one thing: knowing how FAR to load. The
 * loader keeps a contiguous prefix, so jumping to element 5,000 means asking
 * for the prefix that contains it. (Sparse, viewport-shaped demand is #577;
 * until then a far jump loads the rows in between.)
 *
 * # Bridging a tracked read to a promise
 *
 * `<DatasetKeySearch>` is promise-based (`onFind` returns a `Promise`), while
 * `seek` is a tracked platform read: `none` means "still searching" and the
 * channel re-fires when it lands. The two meet here — the query goes into
 * state, the read happens inside {@link useTrackedEvaluation} where its channel
 * is registered, and the pending promise resolves on the frame the answer
 * arrives.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    StringType, compareFor, none, parseFor, some, toEastTypeValue, variant,
    type EastTypeValue,
} from "@elaraai/east";
import type {
    DatasetKeyMatchRange, DatasetKeyQuery,
} from "../key-search/index.js";
import { useTrackedEvaluation } from "../../reactive/index.js";
import type { PlanPagedSourceValue } from "./use-paged-rows.js";
import type { PlanRowValue } from "./model.js";

/** Canvas keys are Strings (#568) — a Plan's search input is typed against
 *  that, whatever the underlying dataset keys its elements by. */
const CANVAS_KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);

/** East's own total order on the row keys — the order both the source windows
 *  and the merged canvas collection are in. */
const KEY_ORDER = compareFor(StringType);

/** What the toolbar needs to mount `<DatasetKeySearch>`. */
export interface PlanSearch {
    /** The key type the control parses typed input against. */
    keyType: EastTypeValue;
    /** Locate a query — resolves when the tracked search lands. */
    find: (query: DatasetKeyQuery) => Promise<DatasetKeyMatchRange>;
    /** Label the popup's rows, in match order, from the rows already loaded. */
    listRange: (row: number, limit: number) => Promise<string[]>;
    /** Jump to match at global element `row`. */
    jump: (row: number) => void;
    /** Drop the query and its jump target. */
    clear: () => void;
}

export interface PlanSeekState {
    /** Mount data for the search control — `undefined` when the source
     *  declares no `seek` (an Array-backed source cannot be searched). */
    search: PlanSearch | undefined;
    /** The source element the prefix must reach for the current jump. */
    wantedEnd: number | undefined;
    /** The canvas row key to scroll to, once it has loaded. */
    targetKey: string | undefined;
}

/** The `.east` literal of a String key is its quoted text; every other query
 *  shape carries its prefix plainly. `undefined` ⇒ nothing to position on. */
function soughtKeyOf(query: DatasetKeyQuery): string | undefined {
    if ("prefix" in query) return query.prefix;
    if ("key" in query) {
        const parsed = parseFor(StringType)(query.key);
        return parsed.success ? (parsed.value as string) : query.key;
    }
    return query.prefix;
}

/** The East `SeekQueryType` value for a control query — the inverse of the
 *  runtime's `toFindQuery`, so one vocabulary crosses the whole path. */
function toSeekQuery(query: DatasetKeyQuery): unknown {
    if ("key" in query) return variant("key", query.key);
    if ("prefix" in query) return variant("prefix", query.prefix);
    return variant("fields", {
        values: [...query.fields],
        prefix: query.prefix !== undefined ? some(query.prefix) : none,
    });
}

/**
 * Wire a paged source's `seek` to the canvas.
 *
 * @param source - The decoded `paged` arm (undefined ⇒ inline canvas)
 * @param rows - The loaded canvas rows, in canonical key order
 * @returns The search mount, the prefix demand, and the scroll target
 */
export function usePlanSeek(
    source: PlanPagedSourceValue | undefined,
    rows: ReadonlyArray<PlanRowValue>,
): PlanSeekState {
    /** The query being searched — `null` between searches. */
    const [query, setQuery] = useState<unknown>(null);
    /** The key the query sought, and where its run started in the source. */
    const [sought, setSought] = useState<{ key: string; row: number } | null>(null);
    /** The match offset within the run the user last committed to. */
    const [offset, setOffset] = useState(0);
    const [wantedEnd, setWantedEnd] = useState<number | undefined>(undefined);
    const pending = useRef<{
        resolve: (r: DatasetKeyMatchRange) => void;
        reject: (e: unknown) => void;
    } | null>(null);

    const seekFn = useMemo(() => {
        if (source === undefined) return undefined;
        return source.seek.type === "some" ? source.seek.value : undefined;
    }, [source]);

    // The read runs INSIDE a tracked evaluation, so the search channel is
    // registered and the settle notifies — the same rule the window reads live
    // by. Outside one it would register nothing and never re-fire.
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
        // `undefined` = no query; `none` = still searching. Neither settles.
        if (answer === undefined || answer.type !== "some" || answer.value === undefined) return;
        const range = answer.value;
        pending.current = null;
        setSought((s) => (s === null ? s : { key: s.key, row: Number(range.row) }));
        waiting.resolve({ found: range.found, row: Number(range.row), count: Number(range.count) });
    }, [result]);

    /** The canvas rows of the match run: everything at-or-after the sought key,
     *  in key order. Both the popup labels and the scroll target index it. */
    const run = useMemo(() => {
        if (sought === null) return [];
        const first = rows.findIndex((r) => KEY_ORDER(r.key, sought.key) >= 0);
        return first < 0 ? [] : rows.slice(first);
    }, [rows, sought]);

    const find = useCallback((q: DatasetKeyQuery) => new Promise<DatasetKeyMatchRange>((resolve, reject) => {
        // A superseded search is dropped, not left dangling — the control's own
        // sequence guard ignores a late answer anyway.
        pending.current?.reject(new Error("superseded by a newer query"));
        pending.current = { resolve, reject };
        setOffset(0);
        setSought({ key: soughtKeyOf(q) ?? "", row: 0 });
        setQuery(toSeekQuery(q));
    }), []);

    const listRange = useCallback(async (row: number, limit: number): Promise<string[]> => {
        // Labels come from the rows already loaded: the run is contiguous in
        // key order, so match `i` is `run[i]` whether or not the source has
        // been walked that far yet.
        const from = sought === null ? 0 : row - sought.row;
        return run.slice(Math.max(0, from), Math.max(0, from) + limit).map((r) => r.key);
    }, [run, sought]);

    const jump = useCallback((row: number) => {
        setOffset(sought === null ? 0 : Math.max(0, row - sought.row));
        // The loader keeps a contiguous prefix, so reaching element `row` means
        // asking for everything up to it (#577 makes this viewport-shaped).
        setWantedEnd((prev) => Math.max(prev ?? 0, row + 1));
    }, [sought]);

    const clear = useCallback(() => {
        pending.current?.reject(new Error("search cleared"));
        pending.current = null;
        setQuery(null);
        setSought(null);
        setOffset(0);
        setWantedEnd(undefined);
    }, []);

    const search = useMemo<PlanSearch | undefined>(
        () => (seekFn === undefined ? undefined : { keyType: CANVAS_KEY_TYPE, find, listRange, jump, clear }),
        [seekFn, find, listRange, jump, clear],
    );

    return {
        search,
        wantedEnd,
        targetKey: run[offset]?.key,
    };
}
