/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The library's Index tab (#1389, `index-tree.ts`): the zones nested by
 * containment in natural label order, each counting the items it holds, its
 * nested zones' among them; an open zone listing its items, then its nested
 * zones; the items in no zone last; a hatched zone holding none; the search
 * keeping the items whose label, key or kind's name holds the query, under
 * their zones, opened; and the zone the viewport is in — the one covering most
 * of it, the smaller of two covering as much, kept until it clearly loses,
 * none at the fit. Fixtures are real East values, made what the canvas draws
 * by `drawn.ts`.
 */

import { describe, expect, test } from "vitest";
import { defaultValue, none, some, variant } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { drawnItem, drawnZone, type DrawnItem, type DrawnZone } from "./canvas/drawn.js";
import { buildNavTree } from "./canvas/model.js";
import { indexRows, zoneInView, type IndexRow } from "./index-tree.js";

const T = Schematic.Types;

/** An outlined zone, its box from its corner. */
function zone(key: string, label: string, x: number, y: number, w: number, h: number, hatch = false): DrawnZone {
    return drawnZone({ kind: "areas", key }, {
        ...defaultValue<typeof T.Zone>(T.Zone), x, y, width: w, height: h, label,
        pattern: hatch ? variant("hatch", { tone: none, spacing: none, angle: none }) : variant("outline", { tone: none }),
    });
}

/** A placed item of a kind. */
function item(kind: string, key: string, x: number, y: number): DrawnItem {
    return drawnItem({ kind, key }, { ...defaultValue<typeof T.Item>(T.Item), position: some({ x, y }), label: key }, undefined)!;
}

/** A hall holding Cage 10, Cage 2 and an aisle hatched across it; a frame room beside it. */
const HALL = zone("hall", "Hall", 0, 0, 20, 10);
const CAGE_2 = zone("cage-2", "Cage 2", 1, 1, 5, 4);
const CAGE_10 = zone("cage-10", "Cage 10", 8, 1, 5, 4);
const AISLE = zone("aisle", "Aisle", 0, 6, 20, 1, true);
const ROOM = zone("room", "Frame room", 22, 0, 6, 10);
const ZONES = [HALL, CAGE_10, CAGE_2, AISLE, ROOM];
const ITEMS = [
    item("racks", "A10", 3, 2), item("racks", "A2", 2, 3), item("racks", "B1", 9, 2),
    item("racks", "H1", 15, 6.5), item("network", "ODF-1", 24, 5), item("racks", "Z1", 40, 40),
];
const TREE = buildNavTree(ZONES, ITEMS);
const KIND_NAMES: Readonly<Record<string, string>> = { racks: "Rack", network: "Network frame" };

/** The rows as text: a zone's label, open mark and count, an item's key, each indented by its depth. */
function rows(open: readonly string[], query = ""): string[] {
    return indexRows(TREE, new Set(open), query, (slot) => KIND_NAMES[slot] ?? slot, "en").map((r: IndexRow) => {
        const pad = "  ".repeat(r.depth);
        return r.kind === "zone" ? `${pad}${r.zone.label}${r.open ? " ▾" : r.branch ? " ▸" : ""} ${r.count}` : `${pad}${r.item.ref.key}`;
    });
}

describe("indexRows", () => {
    test("lists the zones in natural label order, each counting its items, its nested zones' among them; the items in no zone last", () => {
        expect(rows([])).toEqual(["Frame room ▸ 1", "Hall ▸ 4", "Z1"]);
    });

    test("an open zone lists its own items, then its nested zones in natural order; a hatched zone holds none", () => {
        expect(rows([HALL.key, CAGE_2.key])).toEqual([
            "Frame room ▸ 1",
            "Hall ▾ 4",
            "  H1",
            "  Aisle 0",
            "  Cage 2 ▾ 2",
            "    A2",
            "    A10",
            "  Cage 10 ▸ 1",
            "Z1",
        ]);
    });

    test("the search keeps the items whose label, key or kind's name holds it, under their zones, opened; a zone with none leaves", () => {
        expect(rows([], "a1")).toEqual(["Hall ▾ 4", "  Cage 2 ▾ 2", "    A10"]);
        expect(rows([], "network")).toEqual(["Frame room ▾ 1", "  ODF-1"]);
        expect(rows([], "z")).toEqual(["Z1"]);
        expect(rows([], "nothing")).toEqual([]);
    });

    test("each row says where it stands among the rows listed beside it, under its zone or at the top — of what the search keeps", () => {
        const places = (open: readonly string[], query = "") => indexRows(TREE, new Set(open), query, (slot) => KIND_NAMES[slot] ?? slot, "en")
            .map((r: IndexRow) => `${r.kind === "zone" ? r.zone.label : r.item.ref.key} ${r.position}/${r.siblings}`);
        expect(places([HALL.key, CAGE_2.key])).toEqual([
            "Frame room 1/3", "Hall 2/3", "H1 1/4", "Aisle 2/4", "Cage 2 3/4", "A2 1/2", "A10 2/2", "Cage 10 4/4", "Z1 3/3",
        ]);
        expect(places([], "a1")).toEqual(["Hall 1/1", "Cage 2 1/1", "A10 1/1"]);
    });

    test("a kind read by area (#1393, D52): each item of it listed is a match of the search its source answered, and a zone counts only once its count is whole — openable until then", () => {
        const text = (open: readonly string[], query: string, options: Parameters<typeof indexRows>[5]) => indexRows(TREE, new Set(open), query,
            (slot) => KIND_NAMES[slot] ?? slot, "en", options).map((r: IndexRow) => {
            const pad = "  ".repeat(r.depth);
            return r.kind === "zone" ? `${pad}${r.zone.label}${r.open ? " ▾" : r.branch ? " ▸" : ""}${r.count === undefined ? "" : ` ${r.count}`}` : `${pad}${r.item.ref.key}`;
        });
        // The racks were searched through their source: every rack listed matches "Z", though neither label nor key holds it.
        expect(text([], "zz", { searched: new Set(["racks"]) })).toEqual(["Hall ▾ 4", "  H1", "  Cage 2 ▾ 2", "    A2", "    A10", "  Cage 10 ▾ 1", "    B1", "Z1"]);
        // Only the hall's box read: it and the zones it holds count; the frame room, not read, counts none and still opens.
        const whole = (key: string) => key !== ROOM.key;
        expect(text([], "", { whole })).toEqual(["Frame room ▸", "Hall ▸ 4", "Z1"]);
        // An empty zone not yet read opens, to be read; read, it has nothing to open.
        const empty = zone("empty", "Empty room", 30, 0, 4, 4);
        const tree = buildNavTree([...ZONES, empty], ITEMS);
        const rowOf = (counted: boolean) => indexRows(tree, new Set(), "", (slot) => slot, "en", { whole: () => counted }).find((r) => r.kind === "zone" && r.zone.key === empty.key);
        expect(rowOf(false)).toMatchObject({ branch: true, count: undefined });
        expect(rowOf(true)).toMatchObject({ branch: false, count: 0 });
    });
});

describe("zoneInView", () => {
    const view = (minX: number, minY: number, maxX: number, maxY: number, fitted = false) => ({ box: { minX, minY, maxX, maxY }, fitted });

    test("is none at the fit, and before the canvas reports a view", () => {
        expect(zoneInView(ZONES, view(0, 0, 28, 10, true), undefined)).toBeUndefined();
        expect(zoneInView(ZONES, undefined, undefined)).toBeUndefined();
    });

    test("is the zone covering most of the view, the smaller of two covering as much: a view inside a cage the cage, a view of the hall the hall, never the hatched aisle", () => {
        expect(zoneInView(ZONES, view(1.5, 1.5, 5, 4), undefined)).toBe(CAGE_2.key);
        expect(zoneInView(ZONES, view(0, 0, 20, 10), undefined)).toBe(HALL.key);
        expect(zoneInView(ZONES, view(4, 1, 8, 5), undefined)).toBe(HALL.key);
        expect(zoneInView(ZONES, view(0, 6, 20, 7), undefined)).toBe(HALL.key);
    });

    test("keeps the zone it had until it clearly loses: a view on a score's edge does not flap", () => {
        // As much of the hall as of the frame room: the room, the smaller, from none; the hall, held, from the hall.
        expect(zoneInView(ZONES, view(17, 2, 25, 8), undefined)).toBe(ROOM.key);
        expect(zoneInView(ZONES, view(17, 2, 25, 8), HALL.key)).toBe(HALL.key);
        // Well into the frame room: the room takes it.
        expect(zoneInView(ZONES, view(18.5, 2, 26.5, 8), HALL.key)).toBe(ROOM.key);
        // Off every zone: none.
        expect(zoneInView(ZONES, view(30, 30, 36, 36), ROOM.key)).toBeUndefined();
    });
});
