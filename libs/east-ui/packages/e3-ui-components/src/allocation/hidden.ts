/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Allocation's hidden pick (#1398): a bin Search Records finds that the
 * rail's narrowing hides on the board — its lane, its arrival or its
 * resources narrowed out, as the layout shown draws a bin (`table-rows.ts`'
 * `rowHiding`) — is named by the choices that hide it, each as the rail words
 * it, asked of e3 through the record of each source that hides it (the
 * shared hidden pick, `shared/schedule/hidden.ts`): the bin's lane in the
 * lanes' source, its arrival in the arrivals', and the resource it is shown
 * on — its largest part — in the resources'; one request a choice a source for
 * the rows the bins the box lists stand on, and none again at the same
 * revision and narrowing. A pick of it clears just those choices, each
 * source's as the rail clears a choice — every choice of a source that hides
 * it while e3 has not said which — a write of the rail like a chip's.
 *
 * @packageDocumentation
 */

import { useMemo, useRef } from "react";
import type { option, ValueTypeOf } from "@elaraai/east";
import type { RecordSliceBindType, RecordSliceWhereType } from "@elaraai/east-ui/internal";
import type { Formatters } from "@elaraai/east-ui-components";
import { clearHiding, hidingWords, useSourceHidden, type HiddenAnswer, type HidingWords, type SourceHidden } from "../shared/schedule/hidden.js";
import type { FoundBin } from "./find.js";
import type { AllocationValue } from "./model.js";
import { narrowingPart, narrowingSlot, type NarrowedSource } from "./narrowed.js";
import { rowHiding } from "./table-rows.js";

type Bind = ValueTypeOf<RecordSliceBindType>;
type Where = ValueTypeOf<typeof RecordSliceWhereType>;

/**
 * What each source the rail narrows shows, as the board's layout draws a bin: `none` for a source that hides no bin
 * there — the resources' on the Timeline's lanes, the lanes' and the arrivals' on a phone's Timeline of resources.
 */
export interface BinShown {
    readonly lanes: option<ReadonlySet<string>>;
    readonly resources: option<ReadonlySet<string>>;
    readonly arrivals: option<ReadonlySet<string>>;
}

/** A source that hides a bin: its part of the slice, the row of it the bin stands on, and what e3 has said hides that row. */
export interface BinHiding {
    readonly source: NarrowedSource;
    readonly part: Bind;
    /** The row's key: the bin's lane, its arrival, or the resource it is shown on. */
    readonly row: string;
    /** What hides the row, once e3 has said. */
    readonly answer: HiddenAnswer | undefined;
}

/** A bin the rail's narrowing hides: each source that does, in the slice's order, and their choices as the rail words them. */
export interface HiddenBin {
    readonly sources: readonly BinHiding[];
    /** The choices that hide it and those a pick clears with them, every source's, once e3 has said for each; `undefined` until then. */
    readonly words: HidingWords | undefined;
}

/** The hidden pick over the bins Search Records finds. */
export interface HiddenBins {
    /**
     * What hides a bin on the board, as far as e3 has said.
     *
     * @param bin - The bin, as Search Records found it
     * @returns What hides it; `undefined` for a bin the narrowing shows
     */
    of(bin: FoundBin): HiddenBin | undefined;
    /**
     * Asks e3 which choices hide the bins a listing holds that the narrowing hides: each source's question of the rows
     * they stand on, one request a question.
     *
     * @param bins - The bins, as the box lists them
     */
    ask(bins: readonly FoundBin[]): void;
    /**
     * Clears the choices that hide a bin — those e3 named, else every choice of a source that hides it — as the rail
     * clears a choice, each source's narrowing written once.
     *
     * @param hidden - What hides it ({@link HiddenBins.of})
     */
    clear(hidden: HiddenBin): void;
    /** Moves as answers land and as what the narrowing shows moves: the box lists its lines again. */
    readonly version: number;
}

/** The sources the rail narrows a bin by, in the board's order. */
const SOURCES: readonly NarrowedSource[] = ["lanes", "resources", "arrivals"];
/** No narrowing: a source with no part. */
const NO_WHERE: Where = new Map();

/**
 * The row of a source a bin stands on: its lane, its arrival — a reservation has none — or the resource it is shown on,
 * its largest part.
 */
function rowOf(source: NarrowedSource, bin: FoundBin): string | undefined {
    return source === "lanes" ? bin.lane : source === "arrivals" ? bin.arrival : bin.parts[0];
}

/**
 * The hidden pick over the bins Search Records finds (see the module docs).
 *
 * @param value - The payload: its slice, and the slots its sources are named by
 * @param shown - What each source shows, as the board's layout draws a bin
 * @param words - The app's formatters, which word a choice as the rail does
 * @returns The pick
 */
export function useHiddenBins(value: AllocationValue, shown: BinShown, words: Formatters): HiddenBins {
    // One hidden pick a source, asked of the source's own record through its part: the same three every render.
    const lanes = useSourceHidden("Allocation", useMemo(() => narrowingPart(value, "lanes"), [value]));
    const resources = useSourceHidden("Allocation", useMemo(() => narrowingPart(value, "resources"), [value]));
    const arrivals = useSourceHidden("Allocation", useMemo(() => narrowingPart(value, "arrivals"), [value]));
    // The sources in the slice's order: what the rail lists, and the order the line names their choices in.
    const order = useMemo(() => {
        const slots = value.slice.type === "some" ? value.slice.value.slice.parts.map(part => part.source) : [];
        return [...SOURCES].sort((a, b) => slots.indexOf(narrowingSlot(value, a)) - slots.indexOf(narrowingSlot(value, b)));
    }, [value]);
    // What the narrowing shows, counted as it moves: a line says what hides a bin by it.
    const seen = useRef({ shown, n: 0 });
    if (!Object.is(seen.current.shown.lanes, shown.lanes) || !Object.is(seen.current.shown.resources, shown.resources) || !Object.is(seen.current.shown.arrivals, shown.arrivals)) {
        seen.current = { shown, n: seen.current.n + 1 };
    }
    const shownMoves = seen.current.n;
    return useMemo((): HiddenBins => {
        const picks: Record<NarrowedSource, SourceHidden> = { lanes, resources, arrivals };
        /** The sources that hide a bin as the board draws it, each with the row the bin stands on there. */
        const hidingOf = (bin: FoundBin): { source: NarrowedSource; part: Bind; row: string }[] => {
            const hides = rowHiding(bin.lane, { arrival: bin.arrival, parts: bin.parts }, shown.lanes, shown.resources, shown.arrivals);
            return order.flatMap(source => {
                const part = picks[source].part, row = rowOf(source, bin);
                return hides[source] && part !== undefined && row !== undefined ? [{ source, part, row }] : [];
            });
        };
        return {
            of: (bin) => {
                const sources = hidingOf(bin).flatMap((hiding): BinHiding[] => {
                    const state = picks[hiding.source].rows.stateOf(hiding.row);
                    // e3 says the narrowing holds its row: the board's shown keys are catching up, and nothing of this source hides it.
                    if (state !== undefined && !state.hidden) return [];
                    return [{ ...hiding, answer: state?.hidden === true ? state.answer : undefined }];
                });
                if (sources.length === 0) return undefined;
                const known = sources.every(s => s.answer !== undefined);
                const said = known ? sources.map(s => hidingWords(s.part.config.fields, picks[s.source].where ?? NO_WHERE, s.answer!, words)) : undefined;
                return { sources, words: said === undefined ? undefined : { filters: said.flatMap(w => w.filters), also: said.flatMap(w => w.also) } };
            },
            ask: (bins) => {
                for (const source of SOURCES) {
                    const rows = [...new Set(bins.flatMap(bin => hidingOf(bin).filter(h => h.source === source).map(h => h.row)))];
                    if (rows.length > 0) picks[source].rows.askIds(rows, true);
                }
            },
            clear: (hidden) => {
                for (const { part, answer } of hidden.sources) clearHiding(part, answer);
            },
            version: lanes.rows.version + resources.rows.version + arrivals.rows.version + shownMoves,
        };
    }, [lanes, resources, arrivals, order, shown, words, shownMoves]);
}
