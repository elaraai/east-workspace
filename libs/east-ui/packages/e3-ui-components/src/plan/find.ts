/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records over the source of the rows a Plan pages (#1513) — its `rows`
 * source, or a paged resource kind's, whose windows are its narrowing's rows just
 * as theirs are: navigation over the rows the page holds, never a field search,
 * which is the rail's. It is every builder's Search Records
 * (`shared/schedule/search-records.ts`) over that one source: the box seeks and
 * lists the rows as the binding reads them with no choice of the viewer's — the
 * record's own, by primary key where it joins its rows, else by its default
 * index; on a page whose source holds a scope (#1621), the scope's rows alone —
 * so it finds a row the rail's choices hide, and a line says what hides it. A
 * line names a row by what the query was asked of: the index the record's rows
 * are read through, where it reads them by name, else its key. The canvas pages
 * the narrowing's rows in its index's order, so a row's place in the record says
 * nothing of its place on the canvas: a pick asks e3 where the row stands among
 * the rows the narrowing holds (`recordSlicePosition`); where it holds none of
 * it, clears what hides the row and asks again under the narrowing that leaves;
 * and hands the place to the controller, which opens its window once the source
 * reads that narrowing. A clear of the box, or a new query, leaves the row.
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { StringType, isValueOf, none, printFor, some } from "@elaraai/east";
import { RecordSliceWhereType } from "@elaraai/east-ui/internal";
import type { KeySearchSource } from "@elaraai/east-ui-components";
import { awaitTracked, recordSlicePosition, recordSliceRows } from "@elaraai/east-ui-components/internal";
import type { PlanController } from "./controller/index.js";
import { hiddenLine, hiddenOf, type SourceHidden, type SourceHiding } from "../shared/schedule/hidden.js";
import { STRING_KEYS } from "../shared/schedule/kind-keys.js";
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

/** A row Search Records found: its key, and what its line names it by. */
interface FoundRow {
    readonly key: string;
    readonly name: string;
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
    useLayoutEffect(() => { latest.current = { part, pick, clear, controller, words, onError }; });
    const sources = useMemo((): SoughtSource<FoundRow>[] => (part === undefined ? [] : [{
        part, keys: STRING_KEYS, pick,
        // The index the record's rows are read through names a row where it reads them by name; else its key does.
        read: ({ id, entry }) => some(some({ key: id, name: isValueOf(entry.ik.value, StringType) ? entry.ik.value as string : id })),
    }]), [part, pick]);
    /** Goes to a found row: its place among the rows of the narrowing the source holds, cleared of what hides it first. */
    const goTo = (found: Found<FoundRow>, turn: PickTurn) => {
        const { part: source, onError: say } = latest.current;
        if (source === undefined) return;
        const key = found.item.key;
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
                if (!clearing(hiddenOf([{ pick: now, id: key }]) ?? [{ pick: now, answer: undefined }])) return;
                place = await placed();
                if (!turn.current()) return;
            }
            if (place.at !== null) latest.current.controller.goToRow(key, Number(place.at), printWhere(place.where));
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
