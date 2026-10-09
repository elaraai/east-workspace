/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Overlaps (#1198, and the Calendar's #1155): two events on one resource at
 * once, within the group the caller gives, per resource — its kind and its key
 * together — over half-open spans. An instant, an event with no time and one on
 * no resource overlap nothing. The pairs come earliest first, and each event's
 * peers too.
 */

import { describe, expect, test } from "vitest";
import { none, printFor, some } from "@elaraai/east";
import { ScheduleEventRefType } from "@elaraai/e3-ui/internal";
import { scheduleEventKey, scheduleOverlaps, type ScheduleItemValue } from "./overlaps.js";

/** An hour of Monday 5 October 2026, UTC. */
const hour = (h: number) => new Date(Date.UTC(2026, 9, 5, h));

/**
 * An event: its kind and key, from one hour to another of the 5th (`undefined`,
 * no time), on a resource of a kind (`undefined`, none).
 */
function event(kind: string, key: string, from: number | undefined, to: number | undefined, on: string | undefined, of = "presses"): ScheduleItemValue {
    return {
        kind, key, title: `${key} title`,
        start: from === undefined ? none : some(hour(from)),
        end: to === undefined ? none : some(hour(to)),
        resource: on === undefined ? none : some({ kind: of, key: on }),
        status: none, minutes: 0n, due: none,
    };
}

/** The pairs, by the two events' keys, when they begin to overlap and when they stop. */
const pairsOf = (items: Iterable<readonly ScheduleItemValue[]>) =>
    scheduleOverlaps(items).pairs.map((p) => ({ first: p.first.key, second: p.second.key, from: p.from, to: p.to }));

/** Each event's peers, by key. */
const peersOf = (items: Iterable<readonly ScheduleItemValue[]>) =>
    new Map([...scheduleOverlaps(items).peers].map(([ref, peers]) => [ref, peers.map((p) => p.key)]));

const key = (kind: string, k: string) => printFor(ScheduleEventRefType)({ kind, key: k });

describe("two events on one resource at once", () => {
    test("are a pair, the earlier first, overlapping from the later start to the earlier end; each is the other's peer", () => {
        const a = event("job", "J-1", 6, 12, "a1");
        const b = event("job", "J-2", 10, 13, "a1");
        const found = scheduleOverlaps([[b, a]]);
        expect(found.pairs).toEqual([{ first: a, second: b, from: hour(10), to: hour(12) }]);
        expect(found.peers).toEqual(new Map([[key("job", "J-1"), [b]], [key("job", "J-2"), [a]]]));
    });

    test("touching ends do not overlap: one ending as the next starts", () => {
        const found = scheduleOverlaps([[event("job", "J-1", 6, 10, "a1"), event("job", "J-2", 10, 12, "a1")]]);
        expect(found.pairs).toEqual([]);
        expect(found.peers.size).toBe(0);
    });

    test("containment: an event inside another pairs with it, over its own span", () => {
        expect(pairsOf([[event("job", "J-1", 6, 18, "a1"), event("job", "J-2", 8, 10, "a1")]]))
            .toEqual([{ first: "J-1", second: "J-2", from: hour(8), to: hour(10) }]);
    });

    test("three at once are three pairs, earliest first, and each event's peers are in order", () => {
        const items = [event("job", "J-3", 8, 10, "a1"), event("job", "J-1", 6, 12, "a1"), event("job", "J-2", 7, 11, "a1")];
        expect(pairsOf([items])).toEqual([
            { first: "J-1", second: "J-2", from: hour(7), to: hour(11) },
            { first: "J-1", second: "J-3", from: hour(8), to: hour(10) },
            { first: "J-2", second: "J-3", from: hour(8), to: hour(10) },
        ]);
        expect(peersOf([items])).toEqual(new Map([
            [key("job", "J-1"), ["J-2", "J-3"]],
            [key("job", "J-2"), ["J-1", "J-3"]],
            [key("job", "J-3"), ["J-1", "J-2"]],
        ]));
    });

    test("an event that ends before a third starts leaves the sweep: a chain pairs only its neighbours", () => {
        expect(pairsOf([[event("job", "J-1", 6, 9, "a1"), event("job", "J-2", 8, 11, "a1"), event("job", "J-3", 10, 12, "a1")]]))
            .toEqual([
                { first: "J-1", second: "J-2", from: hour(8), to: hour(9) },
                { first: "J-2", second: "J-3", from: hour(10), to: hour(11) },
            ]);
    });
});

describe("what never overlaps", () => {
    test("events on other resources — and two resources of one key in different kinds", () => {
        expect(pairsOf([[
            event("job", "J-1", 6, 12, "a1"),
            event("job", "J-2", 8, 10, "a2"),
            event("job", "J-3", 8, 10, "a1", "crews"),
        ]])).toEqual([]);
    });

    test("an event on no resource, one with no time, an instant, and an end before its start", () => {
        expect(pairsOf([[
            event("job", "J-1", 6, 12, "a1"),
            event("job", "J-2", 8, 10, undefined),
            event("job", "J-3", undefined, undefined, "a1"),
            event("job", "J-4", 9, 9, "a1"),
            event("job", "J-5", 11, 7, "a1"),
        ]])).toEqual([]);
    });

    test("two instants at one time on one resource", () => {
        expect(pairsOf([[event("stop", "S-1", 9, 9, "a1"), event("stop", "S-2", 9, 9, "a1")]])).toEqual([]);
    });

    test("events of two groups — on a Plan, two kinds — on one resource at once; in one group they pair", () => {
        const job = event("job", "J-1", 6, 12, "a1");
        const service = event("service", "S-1", 8, 10, "a1");
        expect(pairsOf([[job], [service]])).toEqual([]);
        expect(pairsOf([[job, service]])).toEqual([{ first: "J-1", second: "S-1", from: hour(8), to: hour(10) }]);
    });

    test("no pair: the one empty result, whatever the events", () => {
        expect(scheduleOverlaps([[event("job", "J-1", 6, 8, "a1")], []])).toBe(scheduleOverlaps([]));
    });
});

describe("the order of the pairs", () => {
    test("earliest first across resources and groups: by the first's start, then the second's, then the keys", () => {
        expect(pairsOf([
            // A later pair on Press A2, given first.
            [event("job", "J-7", 12, 16, "a2"), event("job", "J-8", 13, 14, "a2")],
            // Two pairs whose first events start together: the one whose second starts first leads.
            [event("shift", "X-1", 6, 9, "a1"), event("shift", "X-2", 8, 10, "a1"), event("shift", "Y-1", 6, 12, "b1"), event("shift", "Y-2", 7, 8, "b1")],
            // Two events that start together: the one whose key sorts first is first.
            [event("stop", "Z-2", 5, 7, "c1"), event("stop", "Z-1", 5, 6, "c1")],
        ])).toEqual([
            { first: "Z-1", second: "Z-2", from: hour(5), to: hour(6) },
            { first: "Y-1", second: "Y-2", from: hour(7), to: hour(8) },
            { first: "X-1", second: "X-2", from: hour(8), to: hour(9) },
            { first: "J-7", second: "J-8", from: hour(13), to: hour(14) },
        ]);
    });

    test("an event's key is East's print of its event ref, as its elements carry it", () => {
        expect(scheduleEventKey(event("job", "J-1", 6, 8, "a1"))).toBe(key("job", "J-1"));
    });
});
