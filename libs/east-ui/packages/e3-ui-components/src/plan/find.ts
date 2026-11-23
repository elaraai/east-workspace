/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records over the source of the rows a Plan pages (#1513) — its `rows`
 * source, whose windows are its narrowing's rows — the rows its event kinds
 * land on among them (#1541): navigation over the rows the page holds, never a field search,
 * which is the rail's. It is every builder's Search Records
 * (`shared/schedule/search-records.ts`) over that one source: the box seeks and
 * lists the rows as the binding reads them with no choice of the viewer's — the
 * record's own, by primary key where it joins its rows, else by its default
 * index; on a page whose source holds a scope (#1621), the scope's rows alone —
 * so it finds a row the rail's choices hide, and a line says what hides it. A
 * line names a row by what the query was asked of: the index the record's rows
 * are read through, where it reads them by name, else its key — on a scoped
 * page always its key, which the query is asked of among the scope's rows, the
 * index they are read through naming the scope's value. The canvas pages
 * the narrowing's rows in its index's order, so a row's place in the record says
 * nothing of its place on the canvas: a pick asks e3 where the row stands among
 * the rows the narrowing holds (`recordSlicePosition`); where it holds none of
 * it, clears what hides the row and asks again under the narrowing that leaves;
 * and hands the place to the controller, which opens its window once the source
 * reads that narrowing. A clear of the box, or a new query, leaves the row.
 * Over rows keyed by any type (east-workspace#1696) the box reads a key typed
 * into it at the rows' key type and orders the keys it finds by it, a line
 * names a row by its key's text, and a pick reads its row and its place by
 * the key itself.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { StringType, isValueOf, none, printFor, some } from "@elaraai/east";
import { RecordSliceWhereType, recordSliceScoped } from "@elaraai/east-ui/internal";
import type { KeySearchSource } from "@elaraai/east-ui-components";
import { awaitTracked, recordSlicePosition, recordSliceRows } from "@elaraai/east-ui-components/internal";
import type { PlanController } from "./controller/index.js";
import { hiddenLine, hiddenOf, type SourceHidden, type SourceHiding } from "../shared/schedule/hidden.js";
import type { KindKeys } from "../shared/schedule/kind-keys.js";
import { useSearchRecords, type Found, type PickTurn, type SoughtSource } from "../shared/schedule/search-records.js";
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

/** A row Search Records found: its key's text, its key, and what its line names it by. */
interface FoundRow {
    readonly id: string;
    readonly key: unknown;
    readonly name: string;
}

/** What {@link usePlanRowsFind} reads. */
export interface PlanRowsFindProps {
    /** The part of the source the canvas pages its rows from; `undefined` with none, or over inline rows: no box. */
    readonly part: PlanSourcePart | undefined;
    /**
     * The keys its rows are held by (`planRowKeys`): what a key typed into the box is read at, and its keys ordered by;
     * `undefined` with no part.
     */
    readonly keys: KindKeys | undefined;
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
 * @param props - The source's part and its rows' keys, its hidden pick, the clear, the controller, the words and where an
 *   error is said
 * @returns The source; `undefined` with no part
 */
export function usePlanRowsFind({ part, keys, pick, clear, controller, words, onError }: PlanRowsFindProps): KeySearchSource | undefined {
    const latest = useRef({ part, pick, clear, controller, words, onError });
    useLayoutEffect(() => { latest.current = { part, pick, clear, controller, words, onError }; });
    const sources = useMemo((): SoughtSource<FoundRow>[] => {
        if (part === undefined || keys === undefined) return [];
        // On a scoped page (#1621) the query is asked of the rows' keys among the scope's rows, read through the index on
        // exactly the scope's fields, whose key is the scope's value: the row's key names it.
        const byKey = recordSliceScoped(part);
        return [{
            part, keys, pick,
            // The index the record's rows are read through names a row where it reads them by name; else its key does.
            read: ({ id, key, entry }) => some(some({ id, key, name: !byKey && isValueOf(entry.ik.value, StringType) ? entry.ik.value as string : id })),
        }];
    }, [part, keys, pick]);
    /** Goes to a found row: its place among the rows of the narrowing the source holds, cleared of what hides it first. */
    const goTo = (found: Found<FoundRow>, turn: PickTurn) => {
        const { part: source, onError: say } = latest.current;
        if (source === undefined) return;
        // The row is read, and placed, by its key; the hidden pick and the canvas name it by its key's text.
        const { id, key } = found.item;
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
            if (!turn.current()) return;
            if (place.at === null) {
                // The narrowing hides it: what e3 has said hides it, else every choice of the source.
                const { pick: now, clear: clearing } = latest.current;
                if (!clearing(hiddenOf([{ pick: now, id }]) ?? [{ pick: now, answer: undefined }])) return;
                place = await placed();
                if (!turn.current()) return;
            }
            if (place.at !== null) latest.current.controller.goToRow(id, Number(place.at), printWhere(place.where));
        })().catch((error: unknown) => {
            if (turn.current()) latest.current.onError(error instanceof Error ? error.message : latest.current.words.m.keySearchUnplaced());
        });
    };
    return useSearchRecords({
        name: "Plan", resetKey: PLAN_ROWS_FIND, sources,
        line: ({ item, hidden }) => ({
            text: item.name, label: hidden === undefined ? item.name : `${item.name} · ${hiddenLine(hidden, latest.current.words, latest.current.words.m)}`,
        }),
        onPick: goTo,
        onCleared: () => latest.current.controller.leaveRow(),
        noMatchesText: words.m.keySearchNoMatches(),
    });
}
