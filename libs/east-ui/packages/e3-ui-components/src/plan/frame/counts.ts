/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the Plan's footer counts of its event kinds (#1193, PB23): the events
 * in the window, the backlog, and when a kind's record was last saved — read
 * from the kinds' own seams, every kind's drafts in
 * place, and read again when a record they read commits. The inspector shows
 * them too when nothing is selected, with how long the events run (#1197,
 * PB41).
 *
 * The same read finds the overlaps among the window's events (#1198, PB51):
 * two events of a kind that warns of them, on one resource at once — what the
 * toolbar's chip counts, the inspector's banner lists, and each event in a
 * pair wears a warn ring for. A kind whose overlaps are allowed is never in a
 * pair. It reads the backlog the library's Backlog tab lists, too (#1196).
 *
 * The read runs in a component of its own, {@link PlanKindsReader}, beside
 * what the rail hides of the backlog (#1344): a kind narrowed through an
 * interval index lands some fifty-five key searches a window, and each would
 * otherwise render the whole frame. It hands the frame what it read only when
 * that moves.
 *
 * @packageDocumentation
 */

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { DateTimeType, SortedMap, StringType, compareFor, type ValueTypeOf } from "@elaraai/east";
import type { PlanEventDraftsType, PlanPayloadType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import { useBacklogNarrowing, type BacklogNarrowing } from "../../shared/schedule/backlog.js";
import { scheduleOverlaps, type ScheduleOverlaps } from "../../shared/schedule/overlaps.js";
import type { PlanEventPart } from "../root/sources.js";
import type { PlanScale } from "../scale.js";

/** One event kind, as the Plan's payload carries it (#1190). */
export type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];

/** One event as Plan draws it, as a kind's `planItems` reads it. */
export type PlanEventItemValue = Extract<ReturnType<PlanEventKindValue["planItems"]>, { type: "some" }>["value"][number];

/** The overlaps among the window's events (#1198). */
export type PlanOverlaps = ScheduleOverlaps<PlanEventItemValue>;

/** One unscheduled event, with the kind it is of: a card of the Backlog tab. */
export interface PlanBacklogEntry {
    readonly kind: PlanEventKindValue;
    readonly item: PlanEventItemValue;
}

/** What the footer counts of the event kinds. */
export interface PlanEventCounts {
    /** The events in the window, every kind's. */
    readonly events: number;
    /** How long they run, in minutes — a month counting 30 days, as a kind counts it. */
    readonly minutes: number;
    /** The unscheduled events — every backlog kind's; `undefined` when no kind has a backlog. */
    readonly backlog: number | undefined;
    /** The newest commit to any kind's record; `undefined` while there is none. */
    readonly saved: Date | undefined;
    /** The overlaps among the events in the window: two events of a kind that warns of them, on one resource at once (#1198, PB51). */
    readonly overlaps: PlanOverlaps;
    /** The unscheduled events, every backlog kind's, in the kinds' order: the Backlog tab's cards (#1196). */
    readonly unscheduled: readonly PlanBacklogEntry[];
}

/** One kind's drafts, by entry id, as its seams take them. */
type KindDrafts = Parameters<PlanEventKindValue["planItems"]>[2];

/** Every kind's drafts, by kind then by entry id. */
type EventDrafts = ValueTypeOf<typeof PlanEventDraftsType>;

/** No drafts: what a kind holds none of. */
const NO_DRAFTS: KindDrafts = new SortedMap([], compareFor(StringType));
const NONE_DRAFTED: EventDrafts = new SortedMap([], compareFor(StringType));
const compareDateTime = compareFor(DateTimeType);

/** A read whose kinds are still in flight: the counts stand as they were. */
const READING = "reading";

/** A `time` instant's epoch ms; `undefined` for an instant of another arm. */
function timeMs(t: PlanScale["window"]["min"]): number | undefined {
    return t.type === "time" ? t.value.getTime() : undefined;
}

/**
 * The event kinds' counts over the window the canvas shows, every kind's
 * drafts in place (#1194).
 *
 * @param kinds - The Plan's event kinds; `undefined` or none for a Plan without them
 * @param scale - The shared scale: the window the events are counted over
 * @param drafts - Every kind's drafts, by kind then by entry id — the same object while they hold; none for a Plan whose kinds hold none
 * @returns The counts — the last read's while a read is in flight or fails; `undefined` for a Plan without event kinds, or before the first read answers
 */
export function usePlanEventCounts(kinds: readonly PlanEventKindValue[] | undefined, scale: PlanScale | undefined, drafts: EventDrafts = NONE_DRAFTED): PlanEventCounts | undefined {
    const from = scale !== undefined ? timeMs(scale.window.min) : undefined;
    const to = scale !== undefined ? timeMs(scale.window.max) : undefined;
    const active = kinds !== undefined && kinds.length > 0;
    const read = useCallback((): PlanEventCounts | typeof READING | undefined => {
        if (kinds === undefined || kinds.length === 0 || from === undefined || to === undefined) return undefined;
        let events = 0;
        let minutes = 0;
        let backlog: number | undefined;
        let saved: Date | undefined;
        const unscheduled: PlanBacklogEntry[] = [];
        // Each kind that warns of its overlaps: two of its events are a pair (PB51).
        const warned: (readonly PlanEventItemValue[])[] = [];
        for (const kind of kinds) {
            const drafted = drafts.get(kind.key) ?? NO_DRAFTS;
            const items = kind.planItems(new Date(from), new Date(to), drafted);
            if (items.type === "none") return READING;
            if (kind.overlaps.type === "warn") warned.push(items.value);
            events += items.value.length;
            for (const item of items.value) minutes += Number(item.minutes);
            if (kind.backlog) {
                const waiting = kind.planUnscheduled(new Date(from), new Date(to), drafted);
                if (waiting.type === "none") return READING;
                backlog = (backlog ?? 0) + waiting.value.length;
                for (const item of waiting.value) unscheduled.push({ kind, item });
            }
            const commits = kind.history();
            const newest = commits.type === "some" ? commits.value[0]?.at : undefined;
            if (newest !== undefined && (saved === undefined || compareDateTime(newest, saved) > 0)) saved = newest;
        }
        return { events, minutes, backlog, saved, overlaps: scheduleOverlaps(warned), unscheduled };
    }, [kinds, from, to, drafts]);
    const { result } = useTrackedEvaluation(read);
    // The last counts read, held while a read is in flight or failed.
    const held = useRef<PlanEventCounts | undefined>(undefined);
    return useMemo(() => {
        if (!active) {
            held.current = undefined;
            return undefined;
        }
        if (!result.ok) {
            console.error("[Plan] the event kinds could not be counted:", result.error);
            return held.current;
        }
        if (result.value === READING || result.value === undefined) return held.current;
        held.current = result.value;
        return result.value;
    }, [active, result]);
}

/** What {@link PlanKindsReader} reads: the counts, and what the rail hides of the backlog. */
export interface PlanKindsRead {
    /** The event kinds' counts over the window; `undefined` before the first read answers. */
    readonly counts: PlanEventCounts | undefined;
    /** What the rail hides of the backlog (#1344). */
    readonly backlog: BacklogNarrowing<PlanEventPart>;
}

/** Props of {@link PlanKindsReader}. */
export interface PlanKindsReaderProps {
    /** The Plan's event kinds. */
    kinds: readonly PlanEventKindValue[];
    /** The shared scale: the window the events are counted over. */
    scale: PlanScale | undefined;
    /** Every kind's drafts. */
    drafts: EventDrafts | undefined;
    /** Each event kind narrowed through its source of the slice. */
    parts: readonly PlanEventPart[];
    /** Where what it read goes: called only when that moves. */
    onRead: (read: PlanKindsRead) => void;
}

/**
 * The event kinds' counts, and what the rail hides of the backlog, read in a
 * component of its own (see the module docs).
 *
 * @param props - What is read, over what, and where it goes
 * @returns Nothing: it reads
 */
export function PlanKindsReader({ kinds, scale, drafts, parts, onRead }: PlanKindsReaderProps): null {
    const counts = usePlanEventCounts(kinds, scale, drafts);
    const backlog = useBacklogNarrowing(parts);
    const reported = useRef<PlanKindsRead | undefined>(undefined);
    useLayoutEffect(() => {
        const was = reported.current;
        // The same counts and the same narrowing, by identity — each holds while what it read holds.
        if (was !== undefined && Object.is(was.counts, counts) && Object.is(was.backlog, backlog)) return;
        const read = { counts, backlog };
        reported.current = read;
        onRead(read);
    });
    return null;
}
