/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the queue's words load east-ui-components' entry,
 * which needs one as it loads (#1179).
 *
 * A zones target's preview, worked out (#1454, `Decision Queue Spec.md` P9,
 * P25): a tile an area at its place, at least twelve a row, in its zone as the
 * change leaves it, the areas it moves marked with the zone they leave; each
 * zone's count before and after; the moves, the most areas first — and the
 * words each says.
 */

import { describe, expect, test } from "vitest";
import { decisionQueueMessages as m } from "../messages.js";
import { ZONE_COLUMNS, zonesPreview, type ZoneAreaInput, type ZonesModel } from "./zones-model.js";

const area = (key: string, x: number, y: number, before: string | undefined, after: string | undefined, depot = false): ZoneAreaInput => ({ key, x, y, before, after, depot });
const AREAS = [
    area("a1", 0, 0, "A", "A"),
    area("a2", 1, 0, "A", "B"),
    area("a3", 2, 0, "B", "B", true),
    area("a4", 0, 1, "A", "B"),
    area("a5", 13, 1, "B", "B"),
];

/** The tiles holding an area: each one's place, key, zone, the zone it leaves and its depot. */
const heldTiles = (model: ZonesModel) => model.tiles.flatMap(tile => (tile.empty ? [] : [[tile.x, tile.y, tile.key, tile.zone, tile.from, tile.depot]]));

describe("zonesPreview", () => {
    test("a tile an area at its place, at least twelve a row, wider for an area past them; each in its zone as the change leaves it, a moved one with the zone it leaves", () => {
        const model = zonesPreview(AREAS, ["A", "B"], true);
        expect(ZONE_COLUMNS).toBe(12);
        expect([model.columns, model.tiles.length, model.areas]).toEqual([14, 28, 5]);
        expect(heldTiles(model)).toEqual([
            [0, 0, "a1", "A", undefined, false],
            [1, 0, "a2", "B", "A", false],
            [2, 0, "a3", "B", undefined, true],
            [0, 1, "a4", "B", "A", false],
            [13, 1, "a5", "B", undefined, false],
        ]);
        expect(model.counts).toEqual([{ zone: "A", before: 3, after: 1 }, { zone: "B", before: 2, after: 4 }]);
        expect(model.moves).toEqual([{ from: "A", to: "B", n: 2 }]);
    });

    test("unmarked (P4, P21): every area in its zone as it stands, none moved, the counts as they stand", () => {
        const model = zonesPreview(AREAS, ["A", "B"], false);
        expect(heldTiles(model).map(([, , key, zone, from]) => [key, zone, from])).toEqual([
            ["a1", "A", undefined], ["a2", "A", undefined], ["a3", "B", undefined], ["a4", "A", undefined], ["a5", "B", undefined],
        ]);
        expect(model.counts).toEqual([{ zone: "A", before: 3, after: 3 }, { zone: "B", before: 2, after: 2 }]);
        expect(model.moves).toEqual([]);
    });

    test("an area the change adds counts after it only, one it removes before it only, each drawn in its zone; two at one place, the first by key holds it", () => {
        const model = zonesPreview([area("n", 0, 0, undefined, "B"), area("g", 1.4, 0, "A", undefined), area("z", 1, 0, "B", "B")], ["A", "B"], true);
        expect(heldTiles(model).map(([x, , key, zone, from]) => [x, key, zone, from])).toEqual([[0, "n", "B", undefined], [1, "g", "A", undefined]]);
        expect(model.counts).toEqual([{ zone: "A", before: 1, after: 0 }, { zone: "B", before: 1, after: 2 }]);
        expect(model.moves).toEqual([]);
    });

    test("the moves, the most areas first", () => {
        const model = zonesPreview([area("a", 0, 0, "A", "B"), area("b", 1, 0, "B", "A"), area("c", 2, 0, "B", "A")], ["A", "B"], true);
        expect(model.moves).toEqual([{ from: "B", to: "A", n: 2 }, { from: "A", to: "B", n: 1 }]);
    });
});

describe("the zones preview's words", () => {
    test("a zone's count, a tile's title — moved, a depot, as it stands — and the sentence: the moves of how many, then how each zone's count moves", () => {
        expect(m.previewZoneCount({ before: "25", after: "19", same: false })).toBe("25 → 19");
        expect(m.previewZoneCount({ before: "15", after: "15", same: true })).toBe("15");
        expect(m.previewZoneTile({ name: "G2", zone: "Round B", from: "Round A", depot: false })).toBe("G2 · Round A → Round B");
        expect(m.previewZoneTile({ name: "B3", zone: "Round A", from: undefined, depot: true })).toBe("Round A depot · B3");
        expect(m.previewZoneTile({ name: "C1", zone: "Round A", from: undefined, depot: false })).toBe("C1 · Round A · no change");
        const counts = [{ zone: "Round A", before: "25", after: "19" }, { zone: "Round B", before: "15", after: "21" }];
        expect(m.previewZones({ moves: [{ n: "6", one: false, from: "Round A", to: "Round B" }], of: "40", counts }))
            .toBe("6 of 40 move from Round A to Round B: Round A goes from 25 to 19 and Round B from 15 to 21");
        expect(m.previewZones({ moves: [{ n: "4", one: false, from: "Round A", to: "Round B" }, { n: "1", one: true, from: "Round B", to: "Round A" }], of: "40", counts: [] }))
            .toBe("4 of 40 move from Round A to Round B; 1 moves from Round B to Round A");
        expect(m.previewZones({ moves: [], of: "40", counts: [] })).toBe("Nothing moves");
    });
});
