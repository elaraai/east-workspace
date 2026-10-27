/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Which of the Allocation's sources hide a bin Search Records finds (#1398) —
 * the shared hidden pick's (`shared/schedule/hidden.ts`) over the board's own
 * sources: a bin the rail's narrowing hides on the board — its lane, its
 * arrival or its resources narrowed out, as the layout shown draws a bin
 * (`table-rows.ts`' `rowHiding`) — is hidden by the source of each, in the
 * slice's order, standing on the row of it the bin stands on there: its lane
 * in the lanes' source, its arrival in the arrivals', and the resource it is
 * shown on — its largest part — in the resources'. One hidden pick a source,
 * asked of the source's own record through its part.
 *
 * @packageDocumentation
 */

import { useMemo } from "react";
import type { option } from "@elaraai/east";
import { askHiding, hiddenOf, useRelist, useSourceHidden, type RowHidden, type RowHiding, type SourceHidden } from "../shared/schedule/hidden.js";
import type { FoundBin } from "./find.js";
import type { AllocationValue } from "./model.js";
import { narrowingPart, narrowingSlot, type NarrowedSource } from "./narrowed.js";
import { rowHiding } from "./table-rows.js";

/**
 * What each source the rail narrows shows, as the board's layout draws a bin: `none` for a source that hides no bin
 * there — the resources' on the Timeline's lanes, the lanes' and the arrivals' on a phone's Timeline of resources.
 */
export interface BinShown {
    readonly lanes: option<ReadonlySet<string>>;
    readonly resources: option<ReadonlySet<string>>;
    readonly arrivals: option<ReadonlySet<string>>;
}

/** The hidden pick over the bins Search Records finds. */
export interface HiddenBins {
    /**
     * What hides a bin on the board, as far as e3 has said: each source that does, in the slice's order.
     *
     * @param bin - The bin, as Search Records found it
     * @returns What hides it; `undefined` for a bin the narrowing shows
     */
    of(bin: FoundBin): readonly RowHidden[] | undefined;
    /**
     * Asks e3 which choices hide the bins a listing holds that the narrowing hides: each source's question of the rows
     * they stand on, one request a question.
     *
     * @param bins - The bins, as the box lists them
     */
    ask(bins: readonly FoundBin[]): void;
    /** Moves as answers land and as what the narrowing shows moves: the box lists its lines again. */
    readonly relist: number;
}

/** The sources the rail narrows a bin by, in the board's order. */
const SOURCES: readonly NarrowedSource[] = ["lanes", "resources", "arrivals"];

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
 * @returns The pick
 */
export function useHiddenBins(value: AllocationValue, shown: BinShown): HiddenBins {
    // One hidden pick a source, asked of the source's own record through its part: the same three every render.
    const lanes = useSourceHidden("Allocation", useMemo(() => narrowingPart(value, "lanes"), [value]));
    const resources = useSourceHidden("Allocation", useMemo(() => narrowingPart(value, "resources"), [value]));
    const arrivals = useSourceHidden("Allocation", useMemo(() => narrowingPart(value, "arrivals"), [value]));
    // The sources in the slice's order: what the rail lists, and the order the line names their choices in.
    const order = useMemo(() => {
        const slots = value.slice.type === "some" ? value.slice.value.slice.parts.map(part => part.source) : [];
        return [...SOURCES].sort((a, b) => slots.indexOf(narrowingSlot(value, a)) - slots.indexOf(narrowingSlot(value, b)));
    }, [value]);
    // The lines are listed again as e3 says what hides a bin, and as what the narrowing shows moves.
    const relist = useRelist([lanes, resources, arrivals], [shown.lanes, shown.resources, shown.arrivals]);
    return useMemo((): HiddenBins => {
        const picks: Record<NarrowedSource, SourceHidden> = { lanes, resources, arrivals };
        /** The sources that hide a bin as the board draws it, each with the row the bin stands on there. */
        const hidingsOf = (bin: FoundBin): RowHiding[] => {
            const hides = rowHiding(bin.lane, { arrival: bin.arrival, parts: bin.parts }, shown.lanes, shown.resources, shown.arrivals);
            return order.flatMap(source => {
                const pick = picks[source], row = rowOf(source, bin);
                return hides[source] && pick.part !== undefined && row !== undefined ? [{ pick, id: row }] : [];
            });
        };
        return {
            of: (bin) => hiddenOf(hidingsOf(bin)),
            ask: (bins) => askHiding(bins.flatMap(hidingsOf), true),
            relist,
        };
    }, [lanes, resources, arrivals, order, shown, relist]);
}
