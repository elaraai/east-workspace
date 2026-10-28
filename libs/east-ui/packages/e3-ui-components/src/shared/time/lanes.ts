/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Lane packing (#1148, the Calendar's B9): how events that overlap share the
 * room one column (or one row) has for them.
 *
 * A CLUSTER is a run of events each overlapping another of the run, directly
 * or through others. A cluster takes as many lanes as it needs: each event, in
 * order of start (the longer first where two start together), takes the first
 * lane free at its start. Then each event stretches over every lane to its
 * right that is free for the whole of it, up to the first that is not, so an
 * event beside a short one widens once the short one ends. A lane's events are
 * in order of start, so whether a lane is free for an event is a search of
 * that lane's events, never a sweep of the cluster, which a cluster of
 * hundreds — a year-long reservation over a press's jobs — made a sweep of
 * hundreds for every lane each event stretched over.
 *
 * Spans are half-open, `[start, end)`: two events that only meet, one ending
 * as the other starts, do not overlap. The numbers are any domain's (epoch ms,
 * minutes of the day), so the packing knows nothing of time.
 *
 * @packageDocumentation
 */

/** An event to pack: its start and its exclusive end, on any numeric domain. */
export interface LaneSpan {
    readonly start: number;
    readonly end: number;
}

/** Where a packed event sits. */
export interface LanePlace {
    /** Its lane, from 0. */
    readonly lane: number;
    /** The lanes its cluster takes: the room is cut into this many. */
    readonly lanes: number;
    /** How many lanes it spans, its own and the free ones to its right: 1 at least. */
    readonly span: number;
}

/**
 * Test-only probe — lets "an event stretches by searching each lane's events, never sweeping its cluster a lane" be
 * asserted as the events a stretch examines (#1398, CL9). `undefined` outside tests.
 */
let lanesProbe: (() => void) | undefined;
/**
 * Install (or clear) the lanes probe. Test use only.
 *
 * @param fn - Called for each event a stretch examines; `undefined` clears it
 */
export function setLanesProbe(fn: (() => void) | undefined): void {
    lanesProbe = fn;
}

/**
 * Whether a lane's events overlap a span. The lane's events are in order of start, so the ones starting before the
 * span ends are the first of them, found by a search of their starts; one of those overlaps the span exactly when the
 * latest end among them, `reach`, is past the span's start.
 *
 * @param spans - Every event
 * @param events - The lane's events, by index into `spans`, in order of start
 * @param reach - The latest end among the lane's events up to each of them
 * @param span - The span to test
 * @returns Whether an event of the lane overlaps `span`
 */
function laneOverlaps(spans: readonly LaneSpan[], events: readonly number[], reach: readonly number[], span: LaneSpan): boolean {
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        lanesProbe?.();
        if (spans[events[mid]!]!.start < span.end) lo = mid + 1;
        else hi = mid;
    }
    lanesProbe?.();
    return lo > 0 && reach[lo - 1]! > span.start;
}

/**
 * Pack events into lanes (see the module docs).
 *
 * @param spans - The events
 * @returns Each event's place, in the order the events were given
 */
export function packLanes(spans: readonly LaneSpan[]): LanePlace[] {
    const order = spans.map((_, i) => i).sort((a, b) =>
        spans[a]!.start - spans[b]!.start || spans[b]!.end - spans[a]!.end || a - b);
    const places = new Array<LanePlace>(spans.length);
    let at = 0;
    while (at < order.length) {
        // One cluster: every event that starts before the cluster's last end.
        const cluster: number[] = [order[at]!];
        let clusterEnd = spans[order[at]!]!.end;
        for (at += 1; at < order.length && spans[order[at]!]!.start < clusterEnd; at += 1) {
            cluster.push(order[at]!);
            clusterEnd = Math.max(clusterEnd, spans[order[at]!]!.end);
        }
        // Each event takes the first lane free at its start, so each lane's
        // events are in order of start, one after another.
        const laneEnds: number[] = [];
        const laneOf = new Map<number, number>();
        const laneEvents: number[][] = [];
        for (const i of cluster) {
            const s = spans[i]!;
            let lane = laneEnds.findIndex((end) => end <= s.start);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = s.end;
            laneOf.set(i, lane);
            (laneEvents[lane] ??= []).push(i);
        }
        const lanes = laneEnds.length;
        const reach = laneEvents.map((events) => {
            let latest = -Infinity;
            return events.map((j) => (latest = Math.max(latest, spans[j]!.end)));
        });
        // Each event stretches over the lanes to its right while none of their
        // events overlaps it, each lane searched, never the cluster swept.
        for (const i of cluster) {
            const lane = laneOf.get(i)!;
            let span = 1;
            while (lane + span < lanes && !laneOverlaps(spans, laneEvents[lane + span]!, reach[lane + span]!, spans[i]!)) {
                span += 1;
            }
            places[i] = { lane, lanes, span };
        }
    }
    return places;
}
