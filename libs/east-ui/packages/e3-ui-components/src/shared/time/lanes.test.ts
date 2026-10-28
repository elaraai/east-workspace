/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, expect } from "vitest";
import { packLanes, setLanesProbe, type LaneSpan } from "./lanes.js";

/** An event from one time of day to another, in minutes since midnight. */
const ev = (from: string, to: string): LaneSpan => {
    const min = (hm: string) => Number.parseInt(hm.slice(0, 2), 10) * 60 + Number.parseInt(hm.slice(3), 10);
    return { start: min(from), end: min(to) };
};

describe("packLanes", () => {
    it("gives an event alone one lane", () => {
        expect(packLanes([ev("09:00", "10:00")])).toEqual([{ lane: 0, lanes: 1, span: 1 }]);
    });

    it("cuts a cluster of three overlapping events into three lanes", () => {
        expect(packLanes([ev("09:00", "12:00"), ev("10:00", "13:00"), ev("11:00", "12:30")])).toEqual([
            { lane: 0, lanes: 3, span: 1 },
            { lane: 1, lanes: 3, span: 1 },
            { lane: 2, lanes: 3, span: 1 },
        ]);
    });

    it("puts an event in the first lane free at its start", () => {
        // B is done by 10:00, so C takes its lane, not a third one.
        expect(packLanes([ev("09:00", "12:00"), ev("09:00", "10:00"), ev("10:00", "11:00")])).toEqual([
            { lane: 0, lanes: 2, span: 1 },
            { lane: 1, lanes: 2, span: 1 },
            { lane: 1, lanes: 2, span: 1 },
        ]);
    });

    it("stretches an event over the free lanes to its right", () => {
        // Three lanes from 09:00; at 10:00 D takes B's lane, and C's lane is
        // free for all of D, so D spans two lanes.
        expect(packLanes([ev("09:00", "11:00"), ev("09:00", "10:00"), ev("09:00", "10:00"), ev("10:00", "11:00")])).toEqual([
            { lane: 0, lanes: 3, span: 1 },
            { lane: 1, lanes: 3, span: 1 },
            { lane: 2, lanes: 3, span: 1 },
            { lane: 1, lanes: 3, span: 2 },
        ]);
    });

    it("stops a stretch at the first lane that overlaps it", () => {
        // E, in lane 0, cannot stretch: lane 1's F overlaps it. H takes lane
        // 1 once F is done, and stretches into lane 2, free once G ends.
        expect(packLanes([ev("13:00", "15:00"), ev("13:00", "14:00"), ev("13:30", "14:30"), ev("14:30", "15:00")])).toEqual([
            { lane: 0, lanes: 3, span: 1 },
            { lane: 1, lanes: 3, span: 1 },
            { lane: 2, lanes: 3, span: 1 },
            { lane: 1, lanes: 3, span: 2 },
        ]);
    });

    it("packs each cluster on its own: events that only meet do not overlap", () => {
        expect(packLanes([ev("09:00", "10:00"), ev("09:30", "10:00"), ev("10:00", "11:00")])).toEqual([
            { lane: 0, lanes: 2, span: 1 },
            { lane: 1, lanes: 2, span: 1 },
            { lane: 0, lanes: 1, span: 1 },
        ]);
    });

    it("places the longer of two events that start together first", () => {
        expect(packLanes([ev("09:00", "10:00"), ev("09:00", "12:00")])).toEqual([
            { lane: 1, lanes: 2, span: 1 },
            { lane: 0, lanes: 2, span: 1 },
        ]);
    });

    it("stretches each event of a long cluster by searching each lane's events, never sweeping the cluster a lane (#1398, CL9)", () => {
        // A day-long event, 20 at once at its start, then 400 a minute or two each, one after another: one cluster of 421
        // in 21 lanes, as a year-long reservation and a press's jobs are. Each of the 400 takes lane 1 and stretches over the
        // 19 lanes the 20 left free.
        const spans: LaneSpan[] = [{ start: 0, end: 1440 }, ...Array.from({ length: 20 }, () => ({ start: 0, end: 10 })),
            ...Array.from({ length: 400 }, (_, i) => ({ start: 20 + i * 3, end: 22 + i * 3 }))];
        let examined = 0;
        setLanesProbe(() => { examined += 1; });
        try {
            const places = packLanes(spans);
            expect(places[0]).toEqual({ lane: 0, lanes: 21, span: 1 });
            expect(places.slice(1, 21).map(place => place.lane)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
            expect(places.slice(21).every(place => place.lane === 1 && place.lanes === 21 && place.span === 20)).toBe(true);
            // Each event examines the lanes to its right by a search of each lane's events, in order: a search its log.
            const lanes = 21;
            expect(examined).toBeLessThanOrEqual(spans.length * lanes * (Math.ceil(Math.log2(spans.length)) + 2));
        } finally {
            setLanesProbe(undefined);
        }
    });

    it("stretches every event exactly as far as no event of the lanes to its right overlaps it, instants and ties among them (#1398, CL9)", () => {
        // A seeded run over clusters of every shape — instants, events starting together, events inside others — held
        // to the rule itself: each lane an event spans beyond its own holds no event overlapping it, and the lane past
        // its span, where there is one, holds one that does. Events of other clusters overlap none of it.
        let seed = 1398;
        const next = (n: number): number => {
            seed = (seed * 16807) % 2147483647;
            return seed % n;
        };
        const overlapping = (a: LaneSpan, b: LaneSpan): boolean => a.start < b.end && b.start < a.end;
        for (let round = 0; round < 300; round += 1) {
            const spans: LaneSpan[] = Array.from({ length: 1 + next(40) }, () => {
                const start = next(80);
                return { start, end: start + next(3) * next(12) };
            });
            const places = packLanes(spans);
            spans.forEach((span, i) => {
                const place = places[i]!;
                const lanesHold = (lane: number): boolean =>
                    spans.some((other, j) => j !== i && places[j]!.lane === lane && overlapping(span, other));
                for (let lane = place.lane + 1; lane < place.lane + place.span; lane += 1) expect(lanesHold(lane)).toBe(false);
                if (place.lane + place.span < place.lanes) expect(lanesHold(place.lane + place.span)).toBe(true);
            });
        }
    });

    it("answers in the order the events were given, whatever their times", () => {
        const places = packLanes([ev("14:00", "15:00"), ev("09:00", "10:00"), ev("09:30", "10:30")]);
        expect(places).toEqual([
            { lane: 0, lanes: 1, span: 1 },
            { lane: 0, lanes: 2, span: 1 },
            { lane: 1, lanes: 2, span: 1 },
        ]);
        expect(packLanes([])).toEqual([]);
    });
});
