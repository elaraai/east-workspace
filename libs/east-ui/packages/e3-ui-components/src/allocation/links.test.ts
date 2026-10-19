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
import { dragFamilies, dragLine, familyOf, guideLines, layoutLinks, linkIds, type LinkView } from "./links.js";
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

describe("a drag's links (#1328)", () => {
    const SLOTS = [
        { lane: "B-1", at: at(1, 15), status: variant("booked", null), bins: ["a"] },
        { lane: "B-2", at: at(2, 35), status: variant("booked", null), bins: ["b"] },
        { lane: "B-3", at: at(3, 55), status: variant("booked", null), bins: ["c"] },
        { lane: "B-1", at: at(4, 15), status: variant("reserved", null), bins: ["r"] },
    ] as never;
    const cards = new Map(laneGrid(["B-1", "B-2", "B-3"], SLOTS, PLAN).cards.map(c => [c.id, c] as const));
    const rows = new Map([["K-1", 2], ["K-2", 5]]);

    test("A69 — the day numbers its links once: a link keeps its id in a focus's family and in a drag's", () => {
        const ids = linkIds(PLAN);
        // Its bins by time, each one's parts largest first: a, b (K-1 8, then K-2 4), c, r.
        expect([...ids].map(([bin, parts]) => [bin, [...parts]])).toEqual([
            ["a", [["K-1", 0]]], ["b", [["K-1", 1], ["K-2", 2]]], ["c", [["K-2", 3]]], ["r", [["K-1", 4]]],
        ]);
        const k1 = familyOf(PLAN, PLAN, "K-1", ids), k2 = familyOf(PLAN, PLAN, "K-2", ids);
        expect(k1.find(l => l.bin === "b" && l.resource === "K-2")!.id).toBe(k2.find(l => l.bin === "b" && l.resource === "K-2")!.id);
        expect(familyOf(PLAN, PLAN, "K-2").map(l => l.id)).toEqual(k2.map(l => l.id));
    });

    test("A65 — a drag's links: the dragged bin's resource's family plain, the link it moves its `was` line over them, the target's in the verdict; a draft keeps the brand; a link of both families once", () => {
        const ids = linkIds(PLAN);
        // `a`'s link dragged off K-1 over K-2, which takes it: K-1's family plain, a→K-1 the was line, K-2's links ink-2.
        const fits = dragFamilies(PLAN, PLAN, ids, "K-1", { bin: "a", resource: "K-1" }, { resource: "K-2", verdict: "fits" });
        expect(fits.map(l => [l.bin, l.resource, l.look])).toEqual([
            ["b", "K-1", undefined], ["r", "K-1", undefined], ["b", "K-2", "fits"], ["c", "K-2", "fits"], ["a", "K-1", "was"],
        ]);
        const routed = layoutLinks(fits, cards, rows, VIEW, l => `${l.quantity} m³`);
        expect(routed.map(r => [r.link.bin, r.link.resource, r.tone])).toEqual([
            ["b", "K-1", undefined], ["r", "K-1", undefined], ["b", "K-2", "fits"], ["c", "K-2", "fits"], ["a", "K-1", undefined],
        ]);
        // Each family's weights are its own: c's 20 m³ is K-2's largest, b's 4 m³ into K-2 a fifth of it; a's 30 m³ is K-1's.
        expect(routed.map(r => [r.link.bin, r.link.resource, r.width])).toEqual([["b", "K-1", 2], ["r", "K-1", 1.5], ["b", "K-2", 2], ["c", "K-2", 8], ["a", "K-1", 8]]);
        // Refused there: warn; a draft link keeps its brand.
        const held = day([["a", bin("B-1", at(1, 15), "E1", 30, [["K-1", 30]])], ["c", bin("B-3", at(3, 55), "E3", 20, [["K-2", 18]])]]);
        const refused = layoutLinks(dragFamilies(PLAN, held, ids, "K-1", { bin: "a", resource: "K-1" }, { resource: "K-2", verdict: "refused" }), cards, rows, VIEW, () => "q");
        expect(refused.filter(r => r.link.resource === "K-2").map(r => [r.link.bin, r.tone])).toEqual([["b", "draft"], ["c", "draft"]]);
        expect(layoutLinks(dragFamilies(PLAN, PLAN, ids, "K-1", undefined, { resource: "K-2", verdict: "refused" }), cards, rows, VIEW, () => "q")
            .filter(r => r.link.resource === "K-2").map(r => r.tone)).toEqual(["refused", "refused"]);
        // While the fit's answer is on its way, the target's family is drawn plain; a Library card's drag has no family of its own.
        expect(dragFamilies(PLAN, PLAN, ids, undefined, undefined, { resource: "K-2", verdict: undefined }).map(l => [l.bin, l.resource, l.look]))
            .toEqual([["b", "K-1", undefined], ["b", "K-2", undefined], ["c", "K-2", undefined]]);
        // A body's drag: its bin's resource's family alone, plain.
        expect(dragFamilies(PLAN, PLAN, ids, "K-2", undefined, undefined).map(l => [l.bin, l.resource, l.look])).toEqual([["b", "K-1", undefined], ["b", "K-2", undefined], ["c", "K-2", undefined]]);
    });

    test("A69 — a link drag's new line, the mock's: out of its card, rising at the channel's riser once the pointer is past it, else halfway; into a 9 × 12 head at the pointer", () => {
        // The mock's own figures for LD-2219's link: its card's right edge at 342, its middle at 630; the rows' edge at 395.
        const card = { leftX: 254, rightX: 342, top: 616, bottom: 644 };
        const view = { channelRight: 395, height: 824 };
        // Past the riser (368): it rises there, and runs on to the pointer in the rows.
        expect(dragLine(card, 695, 378, view)).toEqual({
            stroke: "M 342.0 630.0 L 360.0 630.0 A 8.0 8.0 0 0 0 368.0 622.0 L 368.0 386.0 A 8.0 8.0 0 0 1 376.0 378.0 L 687.0 378.0",
            head: "M 686.0 372.0 L 695.0 378.0 L 686.0 384.0 Z",
        });
        expect(dragLine(card, 380, 530, view)!.stroke).toBe("M 342.0 630.0 L 360.0 630.0 A 8.0 8.0 0 0 0 368.0 622.0 L 368.0 532.0 A 2.0 2.0 0 0 1 370.0 530.0 L 372.0 530.0");
        // Just past the riser it doubles back a px, as the mock's does.
        expect(dragLine(card, 375, 486, view)).toEqual({
            stroke: "M 342.0 630.0 L 360.0 630.0 A 8.0 8.0 0 0 0 368.0 622.0 L 368.0 486.5 A 0.5 0.5 0 0 0 367.5 486.0 L 367.0 486.0",
            head: "M 366.0 480.0 L 375.0 486.0 L 366.0 492.0 Z",
        });
        // Level with the card, straight; below it, down.
        expect(dragLine(card, 695, 630, view)!.stroke).toBe("M 342.0 630.0 L 368.0 630.0 L 687.0 630.0");
        expect(dragLine(card, 695, 666, view)!.stroke).toBe("M 342.0 630.0 L 360.0 630.0 A 8.0 8.0 0 0 1 368.0 638.0 L 368.0 658.0 A 8.0 8.0 0 0 0 376.0 666.0 L 687.0 666.0");
        // Short of the riser it turns halfway to the pointer — from a card further off, at 330 — and 12 out of the card at the least.
        expect(dragLine({ leftX: 212, rightX: 300, top: 616, bottom: 644 }, 360, 500, view)!.stroke)
            .toBe("M 300.0 630.0 L 322.0 630.0 A 8.0 8.0 0 0 0 330.0 622.0 L 330.0 508.0 A 8.0 8.0 0 0 1 338.0 500.0 L 352.0 500.0");
        expect(dragLine(card, 362, 560, view)!.stroke).toBe("M 342.0 630.0 L 348.0 630.0 A 6.0 6.0 0 0 0 354.0 624.0 L 354.0 560.0");
        // Within 16px of the card, or outside the panes: nothing.
        expect([dragLine(card, 358, 560, view), dragLine(card, 600, 0, view), dragLine(card, 600, 824, view)]).toEqual([undefined, undefined, undefined]);
    });

    test("A30 — the lines from the pointer into the three best fits' rows: Plan's S out of the pointer, its stub toward a row out of view; none 12px short of the riser, outside the panes, or into a hidden row", () => {
        // The mock's figures for LD-2236 over the lane grid: the pointer at (36, 353), the rows' edge at 395; K-107, its #1, the seventh row.
        const view: LinkView = { gridLeft: 0, channelRight: 395, height: 824, laneTop: 0, rowsTop: 0 };
        const shown = new Map([["K-107", 6], ["K-103", 2], ["K-601", 31]]);
        const lines = guideLines(36, 353, ["K-107", "K-103", "K-601", "K-999"], shown, view);
        expect(lines[0]).toEqual({
            stroke: "M 36.0 353.0 L 360.0 353.0 A 8.0 8.0 0 0 0 368.0 345.0 L 368.0 242.0 A 8.0 8.0 0 0 1 376.0 234.0 L 387.0 234.0",
            head: "M 387.0 230.0 L 395.0 234.0 L 387.0 238.0 Z",
        });
        expect(lines[1]!.stroke.endsWith("L 368.0 98.0 A 8.0 8.0 0 0 1 376.0 90.0 L 387.0 90.0")).toBe(true);
        // K-601 below the view: Plan's stub down the riser, toward it; a hidden row has no line.
        expect(lines[2]).toEqual({ stroke: "M 36.0 353.0 L 360.0 353.0 A 8.0 8.0 0 0 1 368.0 361.0 L 368.0 816.0", head: "M 364.0 816.0 L 368.0 824.0 L 372.0 816.0 Z" });
        expect(lines).toHaveLength(3);
        // Over the Library, left of the board: still from the pointer, as the mock's are.
        expect(guideLines(-202, 553, ["K-107"], shown, view)[0]!.stroke.startsWith("M -202.0 553.0 L 360.0 553.0")).toBe(true);
        // At the riser less 12, and outside the panes: none.
        expect([guideLines(356, 353, ["K-107"], shown, view), guideLines(100, 0, ["K-107"], shown, view), guideLines(100, 824, ["K-107"], shown, view)]).toEqual([[], [], []]);
        expect(guideLines(355, 353, ["K-107"], shown, view)).toHaveLength(1);
    });
});
