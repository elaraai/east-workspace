/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A lanes crop's lanes and its Locked mark, worked out (#1453, `Decision Queue
 * Spec.md` P4, P17): the lanes it draws, once each — those the change's events
 * stand on before it and after it, then those the recommendation lands on —
 * as a preview counts them before it asks which events are pinned; and the
 * lock on every entry the target's `locked` pins, the change's own and those
 * it leaves as they are.
 */

import { describe, expect, test } from "vitest";
import { StringType, equalFor } from "@elaraai/east";
import { laneWindow, lanesOf, lanesPreview, type LaneEvent, type LanesInput } from "./lanes-model.js";

const stringEqual = equalFor(StringType);

/** A time on Tue 20 Oct 2026. */
const at = (h: number) => new Date(Date.UTC(2026, 9, 20, h));
/** A print job on a resource, its lane the resource's. */
const job = (key: string, resource: string, from: number, to: number): LaneEvent => ({ key, kind: "job", title: key, start: at(from), end: at(to), lane: resource, resource });

/** The crop of J-2 moving from B2 to A1 among other events, marked, those named locked pinned. */
function cropOf(context: readonly LaneEvent[], locked: readonly string[] = []): ReturnType<typeof lanesPreview> {
    const before = new Map([["J-2", job("J-2", "B2", 8, 11)]]);
    const after = new Map([["J-2", job("J-2", "A1", 11, 14)]]);
    const input: LanesInput = {
        window: laneWindow([...before.values(), ...after.values()])!, context, before, after, lands: [], marked: true,
        knockOn: () => false, locked: key => locked.some(k => stringEqual(k, key)), shared: () => 0, overlaps: () => false,
        pairs: "kind", measure: "share", nameOf: lane => lane,
    };
    return lanesPreview(input);
}

/** Each lane's key, and each of its entries' key, mark and lock. */
const rowsOf = (model: ReturnType<typeof lanesPreview>) => model.rows.map(row => [row.key, row.bars.map(bar => [bar.key, bar.op, bar.locked])]);

describe("lanesOf", () => {
    test("each lane once, in the order its events come — before, then after — then where the recommendation lands; none for an event that is not there", () => {
        expect(lanesOf([job("J-2", "B2", 8, 11), job("J-2", "A1", 11, 14), undefined, job("J-5", "B2", 6, 7), { lane: "C3" }])).toEqual(["B2", "A1", "C3"]);
        expect(lanesOf([undefined])).toEqual([]);
    });

    test("the lanes a crop draws: what a preview counts before it reads which events are pinned", () => {
        const model = cropOf([job("J-1", "B2", 6, 9), job("J-9", "C3", 9, 10)]);
        expect(model.rows.map(row => row.key)).toEqual(lanesOf([job("J-2", "B2", 8, 11), job("J-2", "A1", 11, 14)]));
    });
});

describe("lanesPreview's Locked mark (P17)", () => {
    test("an entry the change leaves as it is takes the lock its preview read; the others none", () => {
        const model = cropOf([{ ...job("J-1", "B2", 6, 9), locked: true }, job("J-3", "A1", 7, 9)]);
        expect(rowsOf(model)).toEqual([
            ["B2", [["J-1", undefined, true], ["J-2", "from", false]]],
            ["A1", [["J-3", undefined, false], ["J-2", "add", false]]],
        ]);
    });

    test("an entry the change moves takes the target's lock where it lands and on its ghost", () => {
        const model = cropOf([job("J-1", "B2", 6, 9)], ["J-2"]);
        expect(rowsOf(model)).toEqual([
            ["B2", [["J-1", undefined, false], ["J-2", "from", true]]],
            ["A1", [["J-2", "add", true]]],
        ]);
    });
});
