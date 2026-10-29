/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the queue's words load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * A builder's map, worked out (#1453, `Decision Queue Spec.md` D7, P5, P12,
 * P25) over lanes of its own: every resource of the kinds a change lands on a
 * tile under its group, marked by what the change does there — a group past a
 * row its touched tiles and one for the rest — at most three rows, the
 * touched groups first; the counts its sentence says; and the when strip of
 * the new times it gives its events.
 */

import { describe, expect, test } from "vitest";
import { StringType, equalFor } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { decisionQueueMessages, type DecisionQueueWords } from "../messages.js";
import { mapSentence, type MapNouns } from "./lanes.js";
import { laneWindow, lanesPreview, type LaneEvent, type LanesModel } from "./lanes-model.js";
import { CROP_LANES, lanesMap, shortNames, type MapModel, type MapResource } from "./map-model.js";

const stringEqual = equalFor(StringType);
const words: DecisionQueueWords = { ...formatters("en-US"), m: decisionQueueMessages };
const HOUR = 3_600_000;

/** A time on Tue 20 Oct 2026. */
const at = (h: number, min = 0) => new Date(Date.UTC(2026, 9, 20, h, min));
/** A print job on a resource, its lane the resource's. */
const job = (key: string, resource: string, from: number, to: number): LaneEvent => ({ key, kind: "job", title: key, start: at(from), end: at(to), lane: resource, resource });
const resource = (key: string, name: string, group: string): MapResource => ({ key, name, group });

/** The lanes a change draws, marked: each event as it stands and as the change leaves it — `undefined` for none — those named knocked on. */
function changeOf(events: readonly (readonly [string, LaneEvent | undefined, LaneEvent | undefined])[], knocked: readonly string[] = []): LanesModel {
    const before = new Map(events.map(([key, b]) => [key, b] as const));
    const after = new Map(events.map(([key, , a]) => [key, a] as const));
    const window = laneWindow(events.flatMap(([, b, a]) => [b, a]).filter((e): e is LaneEvent => e !== undefined))!;
    return lanesPreview({
        window, context: [], before, after, lands: [], marked: true,
        knockOn: key => knocked.some(k => stringEqual(k, key)), locked: () => false, shared: () => 0, overlaps: () => false,
        pairs: "kind", measure: "share", nameOf: lane => lane,
    });
}

/** Each row: its group, and each tile's label, mark and counts. */
const rowsOf = (map: MapModel) => map.rows.map(row => [row.group, row.tiles.map(tile => [tile.label, tile.op, tile.takes, tile.knocks, tile.loses, tile.more])]);
const sentence = (map: MapModel, nouns: MapNouns, guessed: readonly string[] = []) => mapSentence({ model: map, nouns }, guessed, words);

const PRESSES = [resource("A1", "Press A1", "Presses"), resource("A2", "Press A2", "Presses"), resource("B1", "Press B1", "Presses"), resource("B2", "Press B2", "Presses")];
const LATHES = [resource("L1", "Lathe 1", "Lathes"), resource("L2", "Lathe 2", "Lathes")];
const JOBS: MapNouns = { event: "print job", events: "print jobs", resources: "resources" };

describe("lanesMap", () => {
    test("past two lanes, a tile a resource under its group: lit where the change lands events, a ghost where it only takes them off, a knock-on counted apart; the counts the sentence says", () => {
        const model = changeOf([
            ["J-1", job("J-1", "B2", 6, 9), job("J-1", "A1", 6, 9)],
            ["J-2", job("J-2", "B2", 12, 15), job("J-2", "A1", 12, 15)],
            ["J-3", undefined, job("J-3", "B1", 8, 10)],
            ["J-4", job("J-4", "A2", 10, 11), job("J-4", "A2", 11, 12)],
        ], ["J-4"]);
        expect(model.rows.length).toBeGreaterThan(CROP_LANES);
        const map = lanesMap(model, [...PRESSES, ...LATHES], true);
        expect(rowsOf(map)).toEqual([
            ["Presses", [["A1", "chg", 2, 0, 0, 0], ["A2", undefined, 0, 1, 0, 0], ["B1", "chg", 1, 0, 0, 0], ["B2", "from", 0, 0, 2, 0]]],
            ["Lathes", [["1", undefined, 0, 0, 0, 0], ["2", undefined, 0, 0, 0, 0]]],
        ]);
        expect([map.changed, map.of, map.most, map.freed]).toEqual([4, 6, { name: "Press A1", n: 2 }, [{ name: "Press B2", loses: 2 }]]);
        expect(sentence(map, JOBS)).toBe("4 of 6 resources change; Press A1 takes 2 print jobs, Press B2 loses its print jobs");
        expect(sentence(map, JOBS, ["J-3"])).toBe("4 of 6 resources change; Press A1 takes 2 print jobs, Press B2 loses its print jobs. J-3 is a low-confidence guess");
    });

    test("the when strip: whole hours from two before the first new time to two after the last, cut in four or fewer steps, a tick at each new time — a move along its lane, to another, or an add — in the order they come", () => {
        const model = changeOf([
            ["J-1", job("J-1", "B2", 6, 9), job("J-1", "A1", 6, 9)],
            ["J-2", job("J-2", "B2", 12, 15), job("J-2", "A1", 12, 15)],
            ["J-3", undefined, job("J-3", "B1", 8, 10)],
            ["J-4", job("J-4", "A2", 10, 11), job("J-4", "A2", 11, 12)],
        ], ["J-4"]);
        const when = lanesMap(model, PRESSES, true).when!;
        expect(when.window).toEqual({ from: at(4), to: at(14), unit: "hour", step: 3 * HOUR });
        expect(when.grid).toEqual([3 / 10, 6 / 10]);
        expect(when.ticks.map(tick => [tick.landing.key, tick.at, tick.landing.start, tick.landing.added])).toEqual([
            ["J-1", 2 / 10, at(6), false],
            ["J-3", 4 / 10, at(8), true],
            ["J-4", 7 / 10, at(11), false],
            ["J-2", 8 / 10, at(12), false],
        ]);
    });

    test("a group past a row: the tiles the change touches first, back in their order, then one for the rest, counting them", () => {
        const KILNS = Array.from({ length: 10 }, (_, i) => resource(`K-${101 + i}`, `K-${101 + i}`, "Kilns"));
        const map = lanesMap(changeOf([["L-1", job("L-1", "K-109", 6, 9), job("L-1", "K-110", 6, 9)]]), KILNS, true);
        expect(rowsOf(map)).toEqual([["Kilns", [
            ["101", undefined, 0, 0, 0, 0], ["102", undefined, 0, 0, 0, 0], ["103", undefined, 0, 0, 0, 0], ["104", undefined, 0, 0, 0, 0],
            ["105", undefined, 0, 0, 0, 0], ["109", "from", 0, 0, 1, 0], ["110", "chg", 1, 0, 0, 0], ["", undefined, 0, 0, 0, 3],
        ]]]);
        expect(map.rows[0]!.tiles[7]!.key).toBe("Kilns");
        expect(sentence(map, { event: "load", events: "loads", resources: "kilns" })).toBe("2 of 10 kilns change; K-109 loses its load");
    });

    test("at most three rows, the groups the change touches first, back in their order; a kind read a window at a time counts none it has not read", () => {
        const HALLS = ["Hall A", "Hall B", "Hall C", "Hall D"].map((hall, i) => resource(`P${i + 1}`, `Press ${i + 1}`, hall));
        const map = lanesMap(changeOf([["J-1", undefined, job("J-1", "P4", 6, 9)]]), HALLS, false);
        expect(map.rows.map(row => row.group)).toEqual(["Hall A", "Hall B", "Hall D"]);
        expect([map.changed, map.of]).toEqual([1, undefined]);
        expect(sentence(map, { event: "print job", events: "print jobs", resources: "presses" })).toBe("1 of the presses changes");
    });

    test("a change giving no event a new time draws no when strip; one it only takes events off says it loses them", () => {
        const map = lanesMap(changeOf([["J-1", job("J-1", "A1", 6, 9), undefined]]), PRESSES.slice(0, 2), true);
        expect(map.when).toBeUndefined();
        expect(rowsOf(map)).toEqual([["Presses", [["A1", "from", 0, 0, 1, 0], ["A2", undefined, 0, 0, 0, 0]]]]);
        expect(sentence(map, { ...JOBS, resources: "presses" })).toBe("1 of 2 presses changes; Press A1 loses its print job");
    });
});

describe("shortNames", () => {
    test("the words every name opens with dropped, each name keeping one; what is left its one word, else the initials of its words before its last", () => {
        expect(shortNames(["Press A1", "Press A2"])).toEqual(["A1", "A2"]);
        expect(shortNames(["K-101", "K-102"])).toEqual(["101", "102"]);
        expect(shortNames(["Lathe 1", "Press 1"])).toEqual(["L1", "P1"]);
        expect(shortNames(["Press Hall A 1", "Press Hall B 2"])).toEqual(["A1", "B2"]);
        expect(shortNames(["Press A1"])).toEqual(["A1"]);
        expect(shortNames(["Kiln"])).toEqual(["Kiln"]);
    });
});
