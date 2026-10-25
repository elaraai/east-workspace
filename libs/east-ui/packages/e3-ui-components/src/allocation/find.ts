/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records (#1398): the board's toolbar's key search over its bins'
 * record by primary key — never a field search, which is the rail's, and never
 * what the day draws. The record is sought through e3 with no narrowing, as
 * the Schematic's Find seeks its kinds': `recordSliceSeek` places the query's
 * run in the record's own order through the bins' source of the slice, and
 * `recordSlicePage` reads the rows a list shows by position, each read for
 * its roles by the bin kind's `read`. A line names a bin by its key, its
 * arrival — or that it is a reservation — its lane and its time, and its day;
 * a pick hands the board the bin (`onPick`), which steps to its day and
 * selects it there, and the box shows its key. The box asks its query again
 * as the record moves to another revision.
 *
 * @packageDocumentation
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { StringType, equalFor, toEastTypeValue, type EastTypeValue, type ValueTypeOf, type option } from "@elaraai/east";
import type { DatasetKeyMatchRange, DatasetKeyQuery, RecordSliceBindType, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import { useTrackedEvaluation, type Formatters, type KeySearchSource } from "@elaraai/east-ui-components";
import { awaitTracked, formatDatePattern, recordSlicePage, recordSliceRevision, recordSliceSeek, toSeekQuery } from "@elaraai/east-ui-components/internal";
import type { AllocationDomain, AllocationValue } from "./model.js";

/** A bin's key is a String: the search's text parses against that. */
const KEY_TYPE: EastTypeValue = toEastTypeValue(StringType);
const keyEqual = equalFor(StringType);
/** No narrowing: the record's own rows, in its order. */
const WHOLE: ValueTypeOf<typeof RecordSliceWhereType> = new Map();
/** An empty box lists the first of the record's bins. */
const BROWSE_QUERY: DatasetKeyQuery = { prefix: "" };

/** A record Slice's part: the bins' source of the slice. */
type RecordPart = ValueTypeOf<RecordSliceBindType>;
/** An entry of a record's window, as every record Slice binding reads one: its key and its row, joined. */
interface RecordEntry { readonly key: string; readonly row: option<unknown> }

/** A bin Search Records found: its key, and its place — its day and time, its lane — and its arrival. */
export interface FoundBin {
    readonly key: string;
    readonly at: Date;
    readonly lane: string;
    /** Its arrival's key; `undefined` for a reservation. */
    readonly arrival: string | undefined;
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
    /** The app's formatters. */
    readonly format: Pick<Formatters, "weekdayDate">;
    /** Told the bin a pick lands on. */
    readonly onPick: (bin: FoundBin) => void;
}

/**
 * Search Records' source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The payload, the domain, the bins' source, the words and the pick
 * @returns The source; `undefined` without a source of the bins to seek
 */
export function useAllocationFind({ value, domain, part, format, onPick }: AllocationFindProps): KeySearchSource | undefined {
    const latest = useRef({ value, domain, part, format, onPick });
    useLayoutEffect(() => { latest.current = { value, domain, part, format, onPick }; });
    // What the last find found: the run of the record's rows it placed; a find answered after a newer one asked finds nothing here.
    const found = useRef({ start: 0, count: 0 });
    const asked = useRef(0);
    const find = useCallback(async (query: DatasetKeyQuery): Promise<DatasetKeyMatchRange> => {
        const mine = ++asked.current;
        const source = latest.current.part;
        if (source === undefined) return { found: false, row: 0, count: 0 };
        const at = await awaitTracked(() => recordSliceSeek(source, WHOLE, toSeekQuery(query)));
        const run = at.found ? { start: Number(at.row), count: Number(at.count) } : { start: 0, count: 0 };
        if (mine === asked.current) found.current = run;
        return { found: run.count > 0, row: 0, count: run.count };
    }, []);
    /** The bins at the list's rows `[row, row + limit)`. */
    const binsAt = useCallback(async (row: number, limit: number): Promise<FoundBin[]> => {
        const { part: source, value: board, domain: rows } = latest.current;
        const run = found.current;
        const n = Math.max(0, Math.min(limit, run.count - row));
        if (source === undefined || n === 0) return [];
        const entries = await awaitTracked(() => recordSlicePage(source, WHOLE, BigInt(run.start + row), BigInt(n))) as readonly RecordEntry[];
        return entries.flatMap((entry): FoundBin[] => {
            if (entry.row.type !== "some") return [];
            const roles = board.bin.read(rows.encodeRow(entry.row.value));
            return [{ key: entry.key, at: roles.at, lane: roles.lane, arrival: roles.arrival.type === "some" ? roles.arrival.value : undefined }];
        });
    }, []);
    const listRange = useCallback(async (row: number, limit: number) => {
        const { value: board, format: words } = latest.current;
        // A pick shows the bin's key in the box: what its query is typed against.
        return (await binsAt(row, limit)).map((bin, i) => ({ row: row + i, label: foundBinLine(bin, board, words), text: bin.key }));
    }, [binsAt]);
    const jump = useCallback((row: number) => {
        void binsAt(row, 1).then(([bin]) => { if (bin !== undefined) latest.current.onPick(bin); })
            .catch((error: unknown) => { console.error("[Allocation] Search Records could not read the bin it found:", error); });
    }, [binsAt]);
    const clear = useCallback(() => { asked.current++; found.current = { start: 0, count: 0 }; }, []);
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
    return useMemo(() => (any ? { resetKey: "allocation", requery, keyType: KEY_TYPE, find, listRange, jump, clear, browseQuery: BROWSE_QUERY,
        noMatchesText: "No matching bins. Search by a bin's key." } : undefined), [any, requery, find, listRange, jump, clear]);
}
