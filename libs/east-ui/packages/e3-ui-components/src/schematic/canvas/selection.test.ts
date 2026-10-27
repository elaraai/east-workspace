/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Unit tests for the pure selection rules (`selection.ts`) — the marquee hit
 * collection, and the link or the net under a point, read through the links'
 * R-tree (#1403). Fixtures are real East values typed from the drawn entities'
 * East types, their default values keyed and placed.
 */

import { describe, it, expect } from "vitest";
import { defaultValue, none, some, variant } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import RBush from "rbush";
import { SchematicDrawnItemType, drawnItem, drawnLink, drawnNet, type DrawnItem, type DrawnLink } from "./drawn";
import { linkRoutes, netRoutes, routeEnv, type EdgeGeometry } from "./routes";
import { EMPTY_STRING_SET, type ItemBox, linkAt, linkIndex, marqueeHits } from "./selection";

describe("marqueeHits", () => {
    // Padded boxes (±2 world units), mirroring the culling tree: an item whose
    // PADDING overlaps the region but whose CENTER is outside must not select.
    const box = (key: string, x: number, y: number): ItemBox => ({
        minX: x - 2, minY: y - 2, maxX: x + 2, maxY: y + 2,
        item: { ...defaultValue<typeof SchematicDrawnItemType>(SchematicDrawnItemType), key, label: key, x, y },
    });
    const tree = () => {
        const t = new RBush<ItemBox>();
        t.load([box("A", 5, 5), box("B", 9, 5), box("C", 11.5, 5), box("D", 30, 30)]);
        return t;
    };
    const region = { minX: 4, minY: 4, maxX: 10, maxY: 6 };

    it("selects items whose CENTER lies in the region — padded overlap alone does not select", () => {
        // C's padded box (9.5..13.5) overlaps the region edge at 10, but its centre (11.5) is outside.
        expect([...marqueeHits(tree(), region, EMPTY_STRING_SET, EMPTY_STRING_SET)].sort()).toEqual(["A", "B"]);
    });

    it("skips locked items and narrowed-out items drawn dimmed", () => {
        expect([...marqueeHits(tree(), region, new Set(["A"]), EMPTY_STRING_SET)]).toEqual(["B"]);
        expect([...marqueeHits(tree(), region, EMPTY_STRING_SET, new Set(["B"]))]).toEqual(["A"]);
        expect([...marqueeHits(tree(), region, new Set(["A"]), new Set(["B"]))]).toEqual([]);
    });

    it("returns empty for a region with no candidates", () => {
        expect(marqueeHits(tree(), { minX: 100, minY: 100, maxX: 101, maxY: 101 }, EMPTY_STRING_SET, EMPTY_STRING_SET).size).toBe(0);
    });
});

describe("linkAt, through the links' R-tree (#1403)", () => {
    const T = Schematic.Types;
    const at = (key: string, x: number, y: number): DrawnItem => drawnItem({ kind: "racks", key }, {
        ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y }), label: key,
    }, undefined)!;
    const run = (key: string, from: string, to: string): DrawnLink => drawnLink({ kind: "fibre", key }, {
        ...defaultValue<typeof T.Link>(T.Link), from: { kind: "racks", key: from }, to: { kind: "racks", key: to },
        route: variant("direct", null), style: variant("solid", { tone: none, weight: none }),
    });
    // A thousand runs, each along a row of its own, ten metres apart: at 10 px a metre, a hundred px.
    const items = Array.from({ length: 1000 }, (_, i) => [at(`a${i}`, 0, i * 10), at(`b${i}`, 6, i * 10)]).flat();
    const links = Array.from({ length: 1000 }, (_, i) => run(`r${i}`, `a${i}`, `b${i}`));
    const centers = new Map(items.map((item) => [item.key, { x: item.x, y: item.y }]));
    const env = routeEnv({
        cam: { ppu: 10, tx: 0, ty: 0 }, centers, items: new Map(items.map((item) => [item.key, item])),
        tiers: new Map(items.map((item) => [item.key, "dot" as const])), cardSizes: undefined, lanes: new Map(), measure: (text) => text.length * 6,
    });
    const byId = new Map(links.map((link) => [link.key, link]));

    it("asks the routes of only the runs near the point, and finds the one under it: a move costs what is near it, never every link", () => {
        const index = linkIndex(links, [], centers, EMPTY_STRING_SET, new Map());
        const asked: string[] = [];
        const routeOf = (id: string): EdgeGeometry | undefined => { asked.push(id); return linkRoutes(byId.get(id)!, env); };
        // Midway along r500, on its line.
        expect(linkAt(index, routeOf, { x: 3, y: 5000 }, { x: 30, y: 50000 }, 10, () => true)).toEqual({ key: links[500]!.key, leg: null });
        expect(asked).toEqual([links[500]!.key]);
        // Between two rows, nothing near: no route asked, nothing found.
        asked.length = 0;
        expect(linkAt(index, routeOf, { x: 3, y: 5005 }, { x: 30, y: 50050 }, 10, () => true)).toBeUndefined();
        expect(asked).toEqual([]);
    });

    it("finds a run within its weight and the hit reach of its line, and passes by one that takes no point", () => {
        const index = linkIndex(links, [], centers, EMPTY_STRING_SET, new Map());
        const routeOf = (id: string) => linkRoutes(byId.get(id)!, env);
        // 6 px off r500's 2.5 px line: within its 1.25 and the reach of 5.
        expect(linkAt(index, routeOf, { x: 3, y: 5000.6 }, { x: 30, y: 50006 }, 10, () => true)?.key).toBe(links[500]!.key);
        expect(linkAt(index, routeOf, { x: 3, y: 5000.7 }, { x: 30, y: 50007 }, 10, () => true)).toBeUndefined();
        expect(linkAt(index, routeOf, { x: 3, y: 5000 }, { x: 30, y: 50000 }, 10, (id) => id !== links[500]!.key)).toBeUndefined();
    });

    it("leaves out a run on a hidden layer and one an item it joins isn't drawn for, as the painter leaves them out", () => {
        const hidden = linkIndex(links, [], centers, new Set([links[500]!.key]), new Map());
        expect(hidden.tree.all().some((box) => box.id === links[500]!.key)).toBe(false);
        // b7, r7's destination, drawn nowhere: r7 goes, and every other run stays.
        const ids = linkIndex(links, [], new Map([...centers].filter(([key]) => key !== items[15]!.key)), EMPTY_STRING_SET, new Map()).tree.all().map((box) => box.id);
        expect([ids.length, ids.includes(links[7]!.key)]).toEqual([999, false]);
    });

    it("a net's trunk and bar are the whole net, and a leg its leg", () => {
        const p = at("P", 8, 12), a = at("A", 2, 2), c = at("C", 14, 2);
        const feed = drawnNet({ kind: "feeds", key: "f" }, {
            ...defaultValue<typeof T.Net>(T.Net), sources: [{ kind: "racks", key: "P" }], destinations: [{ kind: "racks", key: "A" }, { kind: "racks", key: "C" }],
            route: variant("direct", null), style: variant("solid", { tone: none, weight: none }),
        });
        const members = [p, a, c];
        const centres = new Map(members.map((item) => [item.key, { x: item.x, y: item.y }]));
        const feedEnv = routeEnv({
            cam: { ppu: 10, tx: 0, ty: 0 }, centers: centres, items: new Map(members.map((item) => [item.key, item])),
            tiers: new Map(members.map((item) => [item.key, "dot" as const])), cardSizes: undefined, lanes: new Map(), measure: (text) => text.length * 6,
        });
        const index = linkIndex([], [feed], centres, EMPTY_STRING_SET, new Map());
        const routeOf = () => netRoutes(feed, feedEnv);
        // The trunk, up from P; the bar under the racks; A's leg, up to A.
        expect(linkAt(index, routeOf, { x: 8, y: 9 }, { x: 80, y: 90 }, 10, () => true)).toEqual({ key: feed.key, leg: null });
        expect(linkAt(index, routeOf, { x: 11, y: 5 }, { x: 110, y: 50 }, 10, () => true)).toEqual({ key: feed.key, leg: null });
        expect(linkAt(index, routeOf, { x: 2, y: 3.5 }, { x: 20, y: 35 }, 10, () => true)).toEqual({ key: feed.key, leg: { end: "destination", item: a.key } });
    });

    it("a net is filed under the box its bus spans: a bar standing off its side toward the trunk past every member, the other side level with it, is found (hand retest, 27 Oct 2026)", () => {
        // A rack into two frames, as a Shift-connect grows a trunk: the frames' bar 0.9 m above them, toward the rack level
        // with the nearer frame — past every member.
        const r = at("R", 16.8, 2.9), m = at("M", 24.2, 2.9), o = at("O", 8.4, 9.6);
        const trunk = drawnNet({ kind: "trunks", key: "t" }, {
            ...defaultValue<typeof T.Net>(T.Net), sources: [{ kind: "racks", key: "R" }], destinations: [{ kind: "racks", key: "M" }, { kind: "racks", key: "O" }],
            route: variant("direct", null), style: variant("solid", { tone: none, weight: none }),
        });
        const members = [r, m, o];
        const centres = new Map(members.map((item) => [item.key, { x: item.x, y: item.y }]));
        const trunkEnv = routeEnv({
            cam: { ppu: 10, tx: 0, ty: 0 }, centers: centres, items: new Map(members.map((item) => [item.key, item])),
            tiers: new Map(members.map((item) => [item.key, "dot" as const])), cardSizes: undefined, lanes: new Map(), measure: (text) => text.length * 6,
        });
        const index = linkIndex([], [trunk], centres, EMPTY_STRING_SET, new Map());
        const routeOf = () => netRoutes(trunk, trunkEnv);
        // The bar, at 2 m, between the rack and the nearer frame: the whole trunk.
        expect(linkAt(index, routeOf, { x: 20, y: 2 }, { x: 200, y: 20 }, 10, () => true)).toEqual({ key: trunk.key, leg: null });
        // The nearer frame's leg, from the bar down to its rim: that leg.
        expect(linkAt(index, routeOf, { x: 24.2, y: 2.2 }, { x: 242, y: 22 }, 10, () => true)).toEqual({ key: trunk.key, leg: { end: "destination", item: m.key } });
    });
});
