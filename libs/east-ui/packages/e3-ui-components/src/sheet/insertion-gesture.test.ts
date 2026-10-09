/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * An insertion's destination: a line inserted into a group carries the
 * group's position, and a failed window before the group counts (#853); with
 * loose rows between the groups (#846), a row inserted above a band or beside
 * a loose row is a loose row of its own.
 */

import { expect, test } from "vitest";
import { none, some, variant } from "@elaraai/east";
import { insertionGesture, insertsLoose } from "./insertion-gesture.js";
import type { SheetRowValue } from "./values.js";

/** Two resident groups: `g1` at 199, then — window 1 (200–399) failed — `g2` at 400. */
const GROUPS: SheetRowValue[] = ["g1", "g2"].map((id) => ({
    id, owned: false, cells: new Map(), lines: [{ key: "0", cells: new Map(), subRows: [] }], band: some({ sub: "", folded: false }), subRows: [],
}));
const GROUPS_AT = [199, 400];

test("a line inserted into a group carries the group's position, a failed window before it counted", () => {
    const gesture = insertionGesture({ kind: "row", anchor: { entry: "g2", child: "0", side: "after" } }, GROUPS, (i) => GROUPS_AT[i]!, true, false,
        () => "unused", () => "+1");
    if (gesture === undefined || gesture.event.type !== "lineInsert") throw new Error("Expected a line insert");
    expect(gesture.event.value.offset).toBe(400n);
    expect(gesture.event.value.line).toBe("1");
    expect(gesture.child).toBe("+1");
});

/** A group `g`, then a loose row `l` (#846). */
const LOOSE: SheetRowValue[] = [
    { id: "g", owned: false, cells: new Map(), lines: [{ key: "0", cells: new Map(), subRows: [] }], band: some({ sub: "", folded: false }), subRows: [] },
    { id: "l", owned: false, cells: new Map(), lines: [], band: none, subRows: [] },
];

test("a row goes loose above a band, beside a loose row or on an empty sheet — never below a band, at a line or at a group's blank line (#846)", () => {
    expect(insertsLoose({ entry: "g", side: "before" }, LOOSE)).toBe(true);
    expect(insertsLoose({ entry: "l", side: "before" }, LOOSE)).toBe(true);
    expect(insertsLoose({ entry: "l", side: "after" }, LOOSE)).toBe(true);
    expect(insertsLoose({ entry: undefined, side: "after" }, [])).toBe(true);
    expect(insertsLoose({ entry: "g", side: "after" }, LOOSE)).toBe(false);
    expect(insertsLoose({ entry: "g", child: "0", side: "before" }, LOOSE)).toBe(false);
    expect(insertsLoose({ entry: "g", tail: true, side: "before" }, LOOSE)).toBe(false);
    expect(insertsLoose({ entry: "gone", side: "before" }, LOOSE)).toBe(false);
});

test("with loose rows a row above a band is a new entry placed before the group; without them it is the group's first line", () => {
    const request = { kind: "row" as const, anchor: { entry: "g", side: "before" as const } };
    const loose = insertionGesture(request, LOOSE, (i) => i, true, false, () => "new", () => "+1", true);
    if (loose === undefined || loose.event.type !== "insert") throw new Error("Expected an entry insert");
    expect(loose.id).toBe("new");
    expect(loose.placement).toEqual(some(variant("ordered", variant("before", "g"))));
    expect(loose.event.value.row.band).toEqual(none);
    const beside = insertionGesture({ kind: "row", anchor: { entry: "l", side: "after" } }, LOOSE, (i) => i, true, false, () => "next", () => "+1", true);
    expect(beside?.placement).toEqual(some(variant("ordered", variant("after", "l"))));
    const plain = insertionGesture(request, LOOSE.slice(0, 1), (i) => i, true, false, () => "new", () => "+1");
    if (plain === undefined || plain.event.type !== "lineInsert") throw new Error("Expected a line insert");
    expect(plain.event.value.line).toBe("0");
});
