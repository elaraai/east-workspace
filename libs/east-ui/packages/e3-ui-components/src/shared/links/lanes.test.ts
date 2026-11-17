/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The lane bands' case table (#1680's review): which rules open into bands,
 * how tall, the order of their tracks, and where captions go.
 */

import { describe, test, expect } from "vitest";
import { CAPTION_TRACK, LANE_TRACK_PAD, planLanes, sCaptionAt, type PlannedLink } from "./lanes.js";

/** A link between two rows, from its source's end to its destination's start. */
const link = (from: number, to: number, sourceEnd: number, destinationStart: number, weight = 6, captioned = true): PlannedLink =>
    ({ from, to, sourceEnd, destinationStart, weight, captioned });

describe("planLanes — lanes on rules, in bands (#1680's review)", () => {
    test("l5, a loopback down from row 0 into row 2: its rule, above row 2, opens into one track, weight + 6 tall, its lane at the track's middle", () => {
        const plan = planLanes(4, [link(0, 2, 300, 100, 6)]);
        expect([...plan.bands]).toEqual([[2, 12]]);
        expect(plan.lanes).toEqual([{ rule: 2, centre: 6 }]);
        expect(plan.captions).toEqual([undefined]);
    });

    test("a loopback up into a row runs on the rule below it", () => {
        const plan = planLanes(4, [link(3, 1, 300, 100, 4)]);
        expect([...plan.bands]).toEqual([[2, 4 + LANE_TRACK_PAD]]);
        expect(plan.lanes).toEqual([{ rule: 2, centre: 5 }]);
    });

    test("l3 and l5, two loopbacks down into one row: the one whose risers stand further left takes the upper track, so neither riser crosses the other's lane, whatever order they come in", () => {
        // A's risers at 73 and 319, B's at 173 and 419: A above B crosses nothing; B above A crosses twice.
        const a = link(0, 2, 300, 100, 6);
        const b = link(1, 2, 400, 200, 4);
        for (const [given, aAt, bAt] of [[[a, b], 0, 1], [[b, a], 1, 0]] as const) {
            const plan = planLanes(4, given);
            expect([...plan.bands]).toEqual([[2, 12 + 10]]);
            expect(plan.lanes[aAt]).toEqual({ rule: 2, centre: 6 });
            expect(plan.lanes[bAt]).toEqual({ rule: 2, centre: 12 + 5 });
        }
    });

    test("two loopbacks up into one row: the order mirrors, the one whose risers stand further left on the lower track", () => {
        const a = link(3, 1, 300, 100, 6);
        const b = link(3, 1, 400, 200, 6);
        const plan = planLanes(4, [a, b]);
        expect(plan.lanes).toEqual([{ rule: 2, centre: 18 }, { rule: 2, centre: 6 }]);
    });

    test("a feed's and a runoff's caption take a 14px track in the band above their row, after any lane there, nearest the row", () => {
        const plan = planLanes(4, [link(1, 1, 100, 200), link(0, 1, 300, 100, 2), link(2, 2, 300, 150)]);
        expect([...plan.bands]).toEqual([[1, 8 + CAPTION_TRACK], [2, CAPTION_TRACK]]);
        expect(plan.captions).toEqual([{ rule: 1, centre: 8 + 7 }, undefined, { rule: 2, centre: 7 }]);
        expect(plan.lanes).toEqual([undefined, { rule: 1, centre: 4 }, undefined]);
    });

    test("an S takes no lane, a one-row link with no caption no track, and a rule nothing uses stays a plain rule", () => {
        const plan = planLanes(4, [link(0, 3, 100, 300), link(2, 2, 100, 200, 1.5, false)]);
        expect(plan.bands.size).toBe(0);
        expect(plan.lanes).toEqual([undefined, undefined]);
        expect(plan.captions).toEqual([undefined, undefined]);
    });

    test("a link with an end on no row is planned nothing", () => {
        const plan = planLanes(2, [link(0, 5, 300, 100), link(-1, 1, 300, 100)]);
        expect(plan.bands.size).toBe(0);
        expect(plan.lanes).toEqual([undefined, undefined]);
    });
});

describe("sCaptionAt — an S's caption in the band its riser crosses (#1680's review)", () => {
    test("the band nearest the riser's mid-height, at its middle; none crossed, none", () => {
        expect(sCaptionAt([{ top: 40, bottom: 52 }, { top: 120, bottom: 134 }], 110)).toBe(127);
        expect(sCaptionAt([{ top: 40, bottom: 52 }, { top: 120, bottom: 134 }], 60)).toBe(46);
        expect(sCaptionAt([], 60)).toBeUndefined();
        expect(sCaptionAt([{ top: 40, bottom: 40 }], 60)).toBeUndefined();
    });
});
