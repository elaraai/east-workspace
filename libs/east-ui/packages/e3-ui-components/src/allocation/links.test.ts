/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The Timeline's links (#1327), pure: the focus's family and where each link
 * runs, from its card's right edge to its row's leading edge, by Plan's
 * grammar (A65, A66, A72).
 */
import { describe, expect, test } from "vitest";
import { SortedMap, StringType, compareFor, none, some, variant } from "@elaraai/east";
import { familyOf, layoutLinks, type LinkView } from "./links.js";
import { laneGrid } from "./timeline-layout.js";
import type { Bin, Day } from "./model.js";

const byString = compareFor(StringType);
const at = (h: number, m: number) => new Date(Date.UTC(2027, 4, 11, h, m));
const bin = (lane: string, when: Date, event: string | undefined, quantity: number, parts: [string, number][]): Bin => ({
    lane, at: when, event: event === undefined ? none : some(event), quantity, kind: none, hold: variant("days", 8),
    parts: new SortedMap(parts, byString), values: null,
}) as unknown as Bin;
const day = (bins: [string, Bin][]): Day => ({ status: variant("draft", null), bins: new SortedMap(bins, byString) }) as unknown as Day;

const PLAN = day([
    ["a", bin("B-1", at(1, 15), "E1", 30, [["K-1", 30]])],
    ["b", bin("B-2", at(2, 35), "E2", 12, [["K-1", 8], ["K-2", 4]])],
    ["c", bin("B-3", at(3, 55), "E3", 20, [["K-2", 20]])],
    ["r", bin("B-1", at(4, 15), undefined, 0, [["K-1", 0]])],
]);
const VIEW: LinkView = { gridLeft: 10, channelRight: 395, height: 400, laneTop: 0, rowsTop: 0 };

describe("the focus's links", () => {
    test("A65, A72 — the family: every bin with a part on the focus, by time, and each of its parts", () => {
        const family = familyOf(PLAN, PLAN, "K-1");
        expect(family.map(l => [l.bin, l.resource, l.quantity, l.draft])).toEqual([
            ["a", "K-1", 30, false], ["b", "K-1", 8, false], ["b", "K-2", 4, false], ["r", "K-1", undefined, false],
        ]);
        // A part the drafts changed, or a bin the day does not hold, is a draft link.
        const held = day([["a", bin("B-1", at(1, 15), "E1", 30, [["K-1", 25]])]]);
        expect(familyOf(PLAN, held, "K-1").map(l => l.draft)).toEqual([true, true, true, true]);
    });

    test("A66 — each link leaves its card's right edge for its row's leading edge, weighted by its share of the family's largest; a reservation's is thin, with no caption", () => {
        const slots = [
            { lane: "B-1", at: at(1, 15), status: variant("booked", null), bins: ["a"] },
            { lane: "B-2", at: at(2, 35), status: variant("booked", null), bins: ["b"] },
            { lane: "B-3", at: at(3, 55), status: variant("booked", null), bins: ["c"] },
            { lane: "B-1", at: at(4, 15), status: variant("reserved", null), bins: ["r"] },
        ] as never;
        const grid = laneGrid(["B-1", "B-2", "B-3"], slots, PLAN);
        const cards = new Map(grid.cards.map(c => [c.id, c] as const));
        // K-1's row two rows down, K-2's five: each link an S through the channel.
        const rows = new Map([["K-1", 2], ["K-2", 5]]);
        const links = layoutLinks(familyOf(PLAN, PLAN, "K-1"), cards, rows, VIEW, l => `${l.quantity} m³`);
        expect(links.map(r => [r.link.bin, r.link.resource, r.width, r.label, r.route])).toEqual([
            ["a", "K-1", 8, "30 m³", "s"], ["b", "K-1", 2, "8 m³", "s"], ["b", "K-2", 2, "4 m³", "s"], ["r", "K-1", 1.5, undefined, "s"],
        ]);
        // LD a's card: B-1 at 52 + its inset past the lane grid's edge; its row's leading edge, the channel's right edge.
        expect([links[0]!.from.rightX, links[0]!.to.leftX]).toEqual([10 + 48 + 4 + 88, 395]);
        // The selected link is drawn a px heavier.
        expect(layoutLinks(familyOf(PLAN, PLAN, "K-1"), cards, rows, VIEW, l => `${l.quantity} m³`, 1)[1]!.width).toBe(3);
        // A row the narrowing hides draws no link to it.
        expect(layoutLinks(familyOf(PLAN, PLAN, "K-1"), cards, new Map([["K-1", 2]]), VIEW, () => "q").map(r => r.link.resource)).toEqual(["K-1", "K-1", "K-1"]);
        // A card level with its row: a straight feed.
        expect(layoutLinks(familyOf(PLAN, PLAN, "K-1"), cards, new Map([["K-1", 0]]), VIEW, () => "q")[0]!.route).toBe("feed");
    });

    test("A66 — an end out of its pane's view meets the edge in Plan's stub; both past one edge draw nothing", () => {
        const slots = [
            { lane: "B-1", at: at(1, 15), status: variant("booked", null), bins: ["a"] },
            { lane: "B-2", at: at(2, 35), status: variant("booked", null), bins: ["b"] },
        ] as never;
        const grid = laneGrid(["B-1", "B-2", "B-3"], slots, PLAN);
        const cards = new Map(grid.cards.map(c => [c.id, c] as const));
        const family = familyOf(PLAN, PLAN, "K-1").filter(l => l.bin !== "r");
        // The rows scrolled far down: K-1's row is above the view.
        const scrolled = layoutLinks(family, cards, new Map([["K-1", 0], ["K-2", 30]]), { ...VIEW, rowsTop: 360 }, () => "q");
        expect(scrolled.filter(r => r.link.resource === "K-1").map(r => [r.route, r.to.off])).toEqual([["stub", "above"], ["stub", "above"]]);
        // The lane grid scrolled past both cards and the rows past K-1: nothing of those links in view.
        const gone = layoutLinks(family, cards, new Map([["K-1", 0], ["K-2", 30]]), { ...VIEW, laneTop: 300, rowsTop: 360 }, () => "q");
        expect(gone.filter(r => r.link.resource === "K-1")).toEqual([]);
    });
});
