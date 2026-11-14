/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records (#1398): the board's toolbar's key search over its bins'
 * record by primary key — never a field search, which is the rail's, and never
 * what the day draws. The record is sought through e3 with no choice of the
 * viewer's, as the Schematic's Find seeks its kinds': `recordSliceKeySearch`
 * places the query's run in the record's own order through the bins' source of
 * the slice — on a page whose source holds a scope (#1621), among the scope's
 * rows alone, a run of matches for each of its values — and
 * `recordSliceBasePage` reads the rows a list shows by their place there, each
 * read for its roles by the bin kind's `read`. A line names a bin by its key, its
 * arrival — or that it is a reservation — its lane and its time, and its day;
 * a pick hands the board the bin (`onPick`), which steps to its day and
 * selects it there, and the box shows its key. A bin the rail's narrowing
 * hides on the board says so, as every builder's line does (the shared hidden
 * pick) — `· hidden by Area: South — picking it clears that filter` once e3
 * has said, `· hidden by the filters` until then — asked of e3 for the bins the
 * box lists, through the board's sources that hide them (`hidden.ts`), and
 * listed again as the answers land. The box asks its query again as the record
 * moves to another revision. Its words are the board's message table's: a
 * query no bin's key matches says so, and that a bin's key is in its Details,
 * where the board has them (`messages.ts`).
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StringType, equalFor, toEastTypeValue, type EastTypeValue, type ValueTypeOf, type option } from "@elaraai/east";
import type { DatasetKeyMatchRange, DatasetKeyQuery, RecordSliceBindType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation, type Formatters, type KeySearchSource } from "@elaraai/east-ui-components";
import { awaitTracked, formatDatePattern, recordSliceBasePage, recordSliceKeySearch, recordSliceRevision, toSeekQuery } from "@elaraai/east-ui-components/internal";
import { blocksAt, type FoundBlock } from "../shared/schedule/found-blocks.js";
import { hiddenLine } from "../shared/schedule/hidden.js";
import type { HiddenBins } from "./hidden.js";
import type { AllocationWords } from "./messages.js";
import { partsOf, type AllocationDomain, type AllocationValue } from "./model.js";
import { one } from "./nouns.js";

/** A bin's key is a String: the search's text parses against that. */
const KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);
const keyEqual = equalFor(StringType);
/** An empty box lists the first of the record's bins. */
const BROWSE_QUERY: DatasetKeyQuery = { prefix: "" };

/** A record Slice's part: the bins' source of the slice. */
type RecordPart = ValueTypeOf<RecordSliceBindType>;
/** An entry of a record's window, as every record Slice binding reads one: its key and its row, joined. */
interface RecordEntry { readonly key: string; readonly row: option<unknown> }

/** A bin Search Records found: its key, and its place — its day and time, its lane — its arrival and its resources. */
export interface FoundBin {
    readonly key: string;
    readonly at: Date;
    readonly lane: string;
    /** Its arrival's key; `undefined` for a reservation. */
    readonly arrival: string | undefined;
    /** The resources it has parts on, the largest part first: the first, the one it is shown on. */
    readonly parts: readonly string[];
}

/**
 * How a found bin reads in the list: its key, its arrival — or that it is a reservation — its lane and time, and its day.
 *
 * @param bin - The bin
 * @param value - The payload: the lanes and the arrivals that name a bin's
 * @param format - The app's formatters
 * @returns Its line
 */
export function foundBinLine(bin: FoundBin, value: Pick<AllocationValue, "lanes" | "arrivals" | "labels">, format: Pick<Formatters, "weekdayDate">): string {
    const lane = value.lanes.find(l => keyEqual(l.key, bin.lane))?.label ?? bin.lane;
    const arrival = bin.arrival === undefined ? "reserved" : value.arrivals.find(a => keyEqual(a.key, bin.arrival!))?.label ?? bin.arrival;
    return [bin.key, arrival, `${lane} ${formatDatePattern("HH:mm", bin.at)}`, format.weekdayDate(bin.at)].join(" · ");
}

/** Props of {@link useAllocationFind}. */
export interface AllocationFindProps {
    /** The payload: its bin kind's `read`, its lanes and its arrivals. */
    readonly value: AllocationValue;
    /** The bin row type's domain: what a row's bytes are written by. */
    readonly domain: AllocationDomain;
    /** The bins' source of the slice: the record sought; `undefined` with none, and no search. */
    readonly part: RecordPart | undefined;
    /** The board's words: the app's formatters, which word a choice as the rail does, and its message table. */
    readonly words: AllocationWords;
    /** What hides a bin the rail's narrowing hides on the board, and what e3 has said of it (the hidden pick). */
    readonly hidden: HiddenBins;
    /** Told the bin a pick lands on. */
    readonly onPick: (bin: FoundBin) => void;
}

/**
 * Search Records' source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The payload, the domain, the bins' source, the words, the hidden pick and the pick
 * @returns The source; `undefined` without a source of the bins to seek
 */
export function useAllocationFind({ value, domain, part, words, hidden, onPick }: AllocationFindProps): KeySearchSource | undefined {
    const latest = useRef({ value, domain, part, words, hidden, onPick });
    useLayoutEffect(() => { latest.current = { value, domain, part, words, hidden, onPick }; });
    // What the last find found: the blocks of the page's rows it placed; a find answered after a newer one asked finds nothing here.
    const found = useRef<readonly FoundBlock[]>([]);
    const asked = useRef(0);
    const find = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        const mine = ++asked.current;
        const source = latest.current.part;
        if (source === undefined) return { found: false, row: 0, count: 0 };
        const blocks = await awaitTracked(() => recordSliceKeySearch(source, toSeekQuery(query)));
        if (mine === asked.current) found.current = blocks;
        const count = Number(blocks.reduce((sum, block) => sum + block.count, 0n));
        return { found: count > 0, row: 0, count };
    }, []);
    /** The bins at the list's rows `[row, row + limit)`. */
    const binsAt = useCallback(async (row: number, limit: number): Promise<FoundBin[]> => {
        const { part: source, value: board, domain: rows } = latest.current;
        if (source === undefined) return [];
        const pages = await Promise.all(blocksAt(found.current, row, limit).map(({ from, n }) =>
            awaitTracked(() => recordSliceBasePage(source, from, BigInt(n)))));
        const entries = pages.flat() as readonly RecordEntry[];
        return entries.flatMap((entry): FoundBin[] => {
            if (entry.row.type !== "some") return [];
            const roles = board.bin.read(rows.encodeRow(entry.row.value));
            return [{ key: entry.key, at: roles.at, lane: roles.lane, arrival: roles.arrival.type === "some" ? roles.arrival.value : undefined,
                parts: partsOf(roles).map(p => p.key) }];
        });
    }, []);
    const listRange = useCallback(async (row: number, limit: number) => {
        const bins = await binsAt(row, limit);
        const { value: board, words: format, hidden: hiding } = latest.current;
        // Which choices hide the bins the narrowing hides, asked of e3: a line says the filters do until it has said which.
        hiding.ask(bins);
        return bins.map((bin, i) => {
            const line = foundBinLine(bin, board, format);
            const hidden = hiding.of(bin);
            // A pick shows the bin's key in the box: what its query is typed against.
            return { row: row + i, label: hidden === undefined ? line : `${line} · ${hiddenLine(hidden, format, format.m)}`, text: bin.key };
        });
    }, [binsAt]);
    const jump = useCallback((row: number) => {
        void binsAt(row, 1).then(([bin]) => { if (bin !== undefined) latest.current.onPick(bin); })
            .catch((error: unknown) => { console.error("[Allocation] Search Records could not read the bin it found:", error); });
    }, [binsAt]);
    const clear = useCallback(() => { asked.current++; found.current = []; }, []);
    // The box asks its query again as the record moves to another revision — tracked, so a day the board reads moves none of it.
    const readRevision = useCallback(() => {
        if (part === undefined) return "";
        const revision = recordSliceRevision(part);
        return revision.type === "some" ? revision.value : "-";
    }, [part]);
    const { result } = useTrackedEvaluation(readRevision);
    const revision = result.ok ? result.value : "";
    const [requery, setRequery] = useState(0);
    const seen = useRef(revision);
    useEffect(() => {
        if (keyEqual(seen.current, revision)) return;
        seen.current = revision;
        setRequery(n => n + 1);
    }, [revision]);
    const any = part !== undefined;
    // What it searches, where nothing matches: bins' keys, which a bin's Details show where the board has them.
    const noMatches = words.m.keySearchNoMatches({ inspector: value.inspector, bin: one(value.labels.bin) });
    // The lines are listed again as e3 says what hides a bin, and as what the narrowing shows moves.
    const relist = hidden.relist;
    return useMemo(() => (any ? { resetKey: "allocation", requery, relist, keyType: KEY_TYPE, find, listRange, jump, clear, browseQuery: BROWSE_QUERY,
        noMatchesText: noMatches } : undefined), [any, requery, relist, find, listRange, jump, clear, noMatches]);
}
