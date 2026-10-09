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
 * event beside a short one widens once the short one ends.
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

/** Whether two half-open spans overlap. */
function overlaps(a: LaneSpan, b: LaneSpan): boolean {
    return a.start < b.end && b.start < a.end;
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
        // Each event takes the first lane free at its start.
        const laneEnds: number[] = [];
        const laneOf = new Map<number, number>();
        for (const i of cluster) {
            const s = spans[i]!;
            let lane = laneEnds.findIndex((end) => end <= s.start);
            if (lane < 0) lane = laneEnds.length;
            laneEnds[lane] = s.end;
            laneOf.set(i, lane);
        }
        const lanes = laneEnds.length;
        // Each event stretches over the lanes to its right while none of their
        // events overlaps it.
        for (const i of cluster) {
            const lane = laneOf.get(i)!;
            let span = 1;
            while (lane + span < lanes
                && !cluster.some((j) => laneOf.get(j) === lane + span && overlaps(spans[i]!, spans[j]!))) {
                span += 1;
            }
            places[i] = { lane, lanes, span };
        }
    }
    return places;
}
