/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, it, expect } from "vitest";
import { packLanes, type LaneSpan } from "./lanes.js";

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
