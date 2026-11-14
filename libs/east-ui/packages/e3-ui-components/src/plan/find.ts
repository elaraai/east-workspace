/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records over the source of the rows a Plan pages (#1513) — its `rows`
 * source, or a paged resource kind's, whose windows are its narrowing's rows just
 * as theirs are: navigation over the rows the page holds, never a field search,
 * which is the rail's. The box seeks and lists the rows as the binding reads
 * them with no choice of the viewer's (`recordSliceKeySearch`) — the record's
 * own, by primary key where it joins its rows, else by its default index, a
 * lean binding reading no rows by their keys; on a page whose source holds a
 * scope (#1621), the scope's rows alone, in their keys' order under each of its
 * values, a block of matches each — so it finds a row the rail's choices hide,
 * and a line says what hides it (the shared hidden pick,
 * `shared/schedule/hidden.ts`). The canvas pages the narrowing's rows in its
 * index's order, so a row's place in the record says nothing of its place on
 * the canvas: a pick asks e3 where the row stands among the rows the narrowing
 * holds (`recordSlicePosition`); where it holds none of it, clears what hides
 * the row and asks again under the narrowing that leaves; and hands the place
 * to the controller, which opens its window once the source reads that
 * narrowing.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { StringType, isValueOf, none, printFor, some } from "@elaraai/east";
import { RecordSliceWhereType, type RecordSliceEntry } from "@elaraai/east-ui/internal";
import type { DatasetKeyMatchRange, DatasetKeyQuery, KeySearchSource } from "@elaraai/east-ui-components";
import { awaitTracked, recordSliceBasePage, recordSliceKeySearch, recordSlicePosition, recordSliceRows, toSeekQuery } from "@elaraai/east-ui-components/internal";
import { blocksAt, type FoundBlock } from "../shared/schedule/found-blocks.js";
import { CANVAS_KEY_TYPE } from "./controller/seek.js";
import type { PlanController } from "./controller/index.js";
import { hiddenLine, usePartRevision, useMoves, useRelist, type SourceHidden, type SourceHiding } from "../shared/schedule/hidden.js";
import type { PlanSourcePart } from "./root/sources.js";
import type { PlanWords } from "./words.js";

const printWhere = printFor(RecordSliceWhereType);
/** The box's `resetKey`: what tells this search from a paged source's own. */
const PLAN_ROWS_FIND = "plan-rows";

/**
 * Whether a search is this one, over the source the canvas pages: where the toolbar folds it first (`shell/Toolbar.tsx`).
 *
 * @param search - The Plan's search; `undefined` with none
 * @returns Whether it is {@link usePlanRowsFind}'s
 */
export function isPlanRowsFind(search: KeySearchSource | undefined): boolean {
    return search?.resetKey === PLAN_ROWS_FIND;
}

/**
 * What hides a row as far as e3 has said: nothing while it has not been asked of, or the narrowing holds it.
 *
 * @param pick - The source's hidden pick
 * @param id - The row's key
 * @returns What hides it, for its line and a pick's clear; `undefined` where nothing is known to
 */
function knownHiding(pick: SourceHidden, id: string): readonly SourceHiding[] | undefined {
    const state = pick.rows.stateOf(id);
    return state?.hidden === true ? [{ pick, answer: state.answer }] : undefined;
}

/** What {@link usePlanRowsFind} reads. */
export interface PlanRowsFindProps {
    /** The part of the source the canvas pages its rows from; `undefined` with none, or over inline rows: no box. */
    readonly part: PlanSourcePart | undefined;
    /** The hidden pick over it. */
    readonly pick: SourceHidden;
    /** Clears what hides a row, saying so where the Plan says a gesture's error; `false` where it could not. */
    readonly clear: (hidden: readonly SourceHiding[] | undefined) => boolean;
    /** The canvas's controller: what goes to the row. */
    readonly controller: PlanController;
    /** The canvas's words. */
    readonly words: PlanWords;
    /** Says why a pick could not go to its row; `undefined` as the next begins. */
    readonly onError: (words: string | undefined) => void;
}

/**
 * Search Records' source over the source the canvas pages — see the module docs.
 *
 * @param props - The source's part, its hidden pick, the clear, the controller, the words and where an error is said
 * @returns The source; `undefined` with no part
 */
export function usePlanRowsFind({ part, pick, clear, controller, words, onError }: PlanRowsFindProps): KeySearchSource | undefined {
    const latest = useRef({ part, pick, clear, controller, words, onError });
    latest.current = { part, pick, clear, controller, words, onError };
    // The keys the box's lines name, by their place in its list: a pick goes to the row its line named.
    const [listed] = useState(() => new Map<number, string>());
    // What the last find found: each block of matches among the rows the page holds, a list's rows one block after another.
    const found = useRef<readonly FoundBlock[]>([]);
    // The finds asked: one answered after a newer one asked finds nothing here.
    const asked = useRef(0);
    // The latest pick: a clear of the box, or another pick, leaves one on its way behind.
    const going = useRef(0);
    const find = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        const mine = ++asked.current;
        const source = latest.current.part;
        if (source === undefined) return { found: false, row: 0, count: 0 };
        const seekQuery = toSeekQuery(query);
        const blocks = await awaitTracked(() => recordSliceKeySearch(source, seekQuery));
        if (mine === asked.current) found.current = blocks;
        const count = blocks.reduce((sum, block) => sum + block.count, 0n);
        return { found: count > 0n, row: 0, count: Number(count) };
    }, []);
    const listRange = useCallback(async (row: number, limit: number) => {
        const source = latest.current.part;
        if (source === undefined) return [];
        const pages = await Promise.all(blocksAt(found.current, row, limit).map(({ from, n }) =>
            awaitTracked(() => recordSliceBasePage(source, from, BigInt(n)))));
        const entries = pages.flat() as readonly RecordSliceEntry[];
        const ids = entries.map((entry) => entry.key as string);
        ids.forEach((id, i) => listed.set(row + i, id));
        // Which of them the narrowing hides and what hides those, asked of e3: a line says so as the answers land.
        const { pick: rowsPick, words: said } = latest.current;
        rowsPick.rows.askIds(ids);
        return ids.map((id, i) => {
            const hidden = knownHiding(rowsPick, id);
            // A line names a row by what the query was asked of: the index the record's rows are read through — its name,
            // where it reads them by name — else its key.
            const sought = entries[i]!.ik.value;
            const name = isValueOf(sought, StringType) ? sought as string : id;
            return { row: row + i, text: name, label: hidden === undefined ? name : `${name} · ${hiddenLine(hidden, said, said.m)}` };
        });
    }, [listed]);
    const jump = useCallback((row: number) => {
        const { part: source, onError: say } = latest.current;
        const key = listed.get(row);
        if (source === undefined || key === undefined) return;
        const seq = ++going.current;
        say(undefined);
        /** Its place among the rows of the narrowing the source holds now, the narrowing beside it. */
        const placed = () => awaitTracked(() => {
            const rows = recordSliceRows(source, [key]);
            if (rows.type === "none") return none;
            const stored = rows.value[0]!;
            if (stored.type === "none") return some({ at: null, where: source.read().where });
            const where = source.read().where;
            const at = recordSlicePosition(source, where, key, stored.value);
            return at.type === "none" ? none : some({ at: at.value, where });
        });
        void (async () => {
            let place = await placed();
            if (seq !== going.current) return;
            if (place.at === null) {
                // The narrowing hides it: what e3 has said hides it, else every choice of the source.
                const { pick: now, clear: clearing } = latest.current;
                if (!clearing(knownHiding(now, key) ?? [{ pick: now, answer: undefined }])) return;
                place = await placed();
                if (seq !== going.current) return;
            }
            if (place.at !== null) latest.current.controller.goToRow(key, Number(place.at), printWhere(place.where));
        })().catch((error: unknown) => {
            if (seq === going.current) latest.current.onError(error instanceof Error ? error.message : latest.current.words.m.keySearchUnplaced());
        });
    }, [listed]);
    const clearBox = useCallback(() => {
        going.current += 1;
        listed.clear();
        asked.current += 1;
        found.current = [];
        latest.current.controller.leaveRow();
    }, [listed]);
    // The box asks its query again as the record moves, and lists its lines again as e3 says what hides a row.
    const requery = useMoves([usePartRevision(part)]);
    const relist = useRelist([pick]);
    const noMatchesText = words.m.keySearchNoMatches();
    const present = part !== undefined;
    return useMemo(() => (present ? {
        resetKey: PLAN_ROWS_FIND, requery, relist, keyType: CANVAS_KEY_TYPE, find, listRange, jump, clear: clearBox, noMatchesText,
    } : undefined), [present, requery, relist, find, listRange, jump, clearBox, noMatchesText]);
}
