/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Search Records (#1398): the board's toolbar's key search over its bins'
 * record by primary key — never a field search, which is the rail's, and never
 * what the day draws. It is every builder's Search Records
 * (`shared/schedule/search-records.ts`) over the bins' source of the slice: the
 * record sought through e3 with no choice of the viewer's — on a page whose
 * source holds a scope (#1621), among the scope's rows alone — each row a list
 * shows read for its roles by the bin kind's `read`. A line names a bin by its
 * key, its arrival — or that it is a reservation — its lane and its time, and
 * its day; a pick hands the board the bin and what hides it (`onPick`), which
 * steps to its day and selects it there, and the box shows its key. A bin the
 * rail's narrowing hides on the board says so, as every builder's line does (the
 * shared hidden pick) — `· hidden by Area: South — picking it clears that
 * filter` once e3 has said, `· hidden by the filters` until then — through the
 * board's sources that hide it (`hidden.ts`). Its words are the board's message
 * table's: a query no bin's key matches says so, and that a bin's key is in its
 * Details, where the board has them (`messages.ts`).
 *
 * @packageDocumentation
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { StringType, equalFor, type ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType } from "@elaraai/east-ui/internal";
import type { Formatters, KeySearchSource } from "@elaraai/east-ui-components";
import { formatDatePattern } from "@elaraai/east-ui-components/internal";
import { hiddenLine, type RowHidden } from "../shared/schedule/hidden.js";
import { STRING_KEYS } from "../shared/schedule/kind-keys.js";
import { readsRows, useSearchRecords, type SoughtSource } from "../shared/schedule/search-records.js";
import type { HiddenBins } from "./hidden.js";
import type { AllocationWords } from "./messages.js";
import { partsOf, type AllocationDomain, type AllocationValue } from "./model.js";
import { one } from "./nouns.js";

const keyEqual = equalFor(StringType);

/** A record Slice's part: the bins' source of the slice. */
type RecordPart = ValueTypeOf<RecordSliceBindType>;

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
    /** Which of the board's sources hide a bin, and what e3 has said of it (the hidden pick). */
    readonly hidden: HiddenBins;
    /** Told the bin a pick lands on, and what hides it on the board, as far as e3 has said; `undefined` for one nothing hides. */
    readonly onPick: (bin: FoundBin, hidden: readonly RowHidden[] | undefined) => void;
}

/**
 * Search Records' source, for the shared key search's toolbar item (see the module docs).
 *
 * @param props - The payload, the domain, the bins' source, the words, the hidden pick and the pick
 * @returns The source; `undefined` without a source of the bins to seek
 */
export function useAllocationFind({ value, domain, part, words, hidden, onPick }: AllocationFindProps): KeySearchSource | undefined {
    const latest = useRef({ value, domain, words, hidden, onPick });
    useLayoutEffect(() => { latest.current = { value, domain, words, hidden, onPick }; });
    // The bins' own source hides no bin on the board: their lanes', resources' and arrivals' do (`hidings`).
    const sources = useMemo((): SoughtSource<FoundBin>[] => (part === undefined ? [] : [{
        part, keys: STRING_KEYS,
        read: readsRows((id, row) => {
            const { value: board, domain: rows } = latest.current;
            const roles = board.bin.read(rows.encodeRow(row));
            return { key: id, at: roles.at, lane: roles.lane, arrival: roles.arrival.type === "some" ? roles.arrival.value : undefined,
                parts: partsOf(roles).map(p => p.key) };
        }),
    }]), [part]);
    return useSearchRecords({
        name: "Allocation", resetKey: "allocation", sources,
        line: ({ item: bin, hidden: hides }) => {
            const { value: board, words: format } = latest.current;
            const line = foundBinLine(bin, board, format);
            // A pick shows the bin's key in the box: what its query is typed against.
            return { label: hides === undefined ? line : `${line} · ${hiddenLine(hides, format, format.m)}`, text: bin.key };
        },
        onPick: ({ item, hidden: hides }) => { latest.current.onPick(item, hides); },
        // What it searches, where nothing matches: bins' keys, which a bin's Details show where the board has them.
        noMatchesText: words.m.keySearchNoMatches({ inspector: value.inspector, bin: one(value.labels.bin) }),
        hidings: (bins) => bins.map((bin) => latest.current.hidden.hidingsOf(bin)),
        // The lines are listed again as e3 says what hides a bin, and as what the narrowing shows moves.
        relistBy: [hidden.relist],
    });
}
