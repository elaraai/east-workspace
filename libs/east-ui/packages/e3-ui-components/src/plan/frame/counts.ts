/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the Plan's footer counts of its event kinds (#1193, PB23): the events
 * in the window, the backlog, the events to review, and when a kind's record
 * was last saved — read from the kinds' own seams, every kind's drafts in
 * place, and read again when a record they read commits.
 *
 * @packageDocumentation
 */

import { useCallback, useMemo, useRef } from "react";
import { DateTimeType, SortedMap, StringType, compareFor, type ValueTypeOf } from "@elaraai/east";
import type { PlanPayloadType } from "@elaraai/e3-ui/internal";
import { useTrackedEvaluation } from "@elaraai/east-ui-components";
import type { PlanScale } from "../scale.js";

/** One event kind, as the Plan's payload carries it (#1190). */
export type PlanEventKindValue = ValueTypeOf<typeof PlanPayloadType>["events"][number];

/** What the footer counts of the event kinds. */
export interface PlanEventCounts {
    /** The events in the window, every kind's. */
    readonly events: number;
    /** The unscheduled events — every backlog kind's; `undefined` when no kind has a backlog. */
    readonly backlog: number | undefined;
    /** The events in the window whose verdict waits on a call; `undefined` when no kind is reviewed. */
    readonly toReview: number | undefined;
    /** The newest commit to any kind's record; `undefined` while there is none. */
    readonly saved: Date | undefined;
}

/** One kind's drafts, by entry id, as its seams take them. */
type KindDrafts = Parameters<PlanEventKindValue["planItems"]>[2];

/** The drafts the kinds are read with: none yet — the event kinds' editing is #1194's. */
const NO_DRAFTS: KindDrafts = new SortedMap([], compareFor(StringType));
const compareDateTime = compareFor(DateTimeType);

/** A read whose kinds are still in flight: the counts stand as they were. */
const READING = "reading";

/** A `time` instant's epoch ms; `undefined` for an instant of another arm. */
function timeMs(t: PlanScale["window"]["min"]): number | undefined {
    return t.type === "time" ? t.value.getTime() : undefined;
}

/**
 * The event kinds' counts over the window the canvas shows.
 *
 * @param kinds - The Plan's event kinds; `undefined` or none for a Plan without them
 * @param scale - The shared scale: the window the events are counted over
 * @returns The counts — the last read's while a read is in flight or fails; `undefined` for a Plan without event kinds, or before the first read answers
 */
export function usePlanEventCounts(kinds: readonly PlanEventKindValue[] | undefined, scale: PlanScale | undefined): PlanEventCounts | undefined {
    const from = scale !== undefined ? timeMs(scale.window.min) : undefined;
    const to = scale !== undefined ? timeMs(scale.window.max) : undefined;
    const active = kinds !== undefined && kinds.length > 0;
    const read = useCallback((): PlanEventCounts | typeof READING | undefined => {
        if (kinds === undefined || kinds.length === 0 || from === undefined || to === undefined) return undefined;
        let events = 0;
        let backlog: number | undefined;
        let toReview: number | undefined;
        let saved: Date | undefined;
        for (const kind of kinds) {
            const items = kind.planItems(new Date(from), new Date(to), NO_DRAFTS);
            if (items.type === "none") return READING;
            events += items.value.length;
            if (kind.roles.review.type === "some") {
                toReview = (toReview ?? 0) + items.value.filter((item) => item.verdict.type === "some" && item.verdict.value.type === "pending").length;
            }
            if (kind.backlog) {
                const unscheduled = kind.planUnscheduled(NO_DRAFTS);
                if (unscheduled.type === "none") return READING;
                backlog = (backlog ?? 0) + unscheduled.value.length;
            }
            const commits = kind.history();
            const newest = commits.type === "some" ? commits.value[0]?.at : undefined;
            if (newest !== undefined && (saved === undefined || compareDateTime(newest, saved) > 0)) saved = newest;
        }
        return { events, backlog, toReview, saved };
    }, [kinds, from, to]);
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
