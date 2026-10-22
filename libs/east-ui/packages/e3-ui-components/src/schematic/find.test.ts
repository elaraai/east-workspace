/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Find over the items the drawing holds (#1387, `find.ts`, §6.1): what a query
 * the shared key search's box parsed finds — bare text a key's start or a
 * label's words, in any case; a quoted key the items of that key; a range the
 * keys in it — in East's order of their keys, each kind's in the order the
 * Schematic lists its kinds where two share a key; and how an item reads in
 * Find's list.
 */

import { describe, test, expect } from "vitest";
import { findItems, itemLine, type FindableItem } from "./find.js";

/** An item of the data centre's floor, by its key, its card's name, and its kind's name and place. */
const item = (key: string, label: string, kind = "Rack", order = 0): FindableItem => ({ id: `${kind}:${key}`, key, label, kind, order });

const ITEMS: readonly FindableItem[] = [
    item("A03", "A03"), item("A01", "A01"), item("A02", "A02"),
    item("ODF-1", "Fibre frame ODF-1", "Network frame", 1),
    item("A01", "A01 cooler", "Cooling unit", 2),
    item("PDU-A", "Power A side", "Power distribution unit", 3),
];

const keys = (found: readonly FindableItem[]) => found.map((it) => `${it.kind} ${it.key}`);

describe("findItems", () => {
    test("bare text finds the items whose key starts with it or whose label holds it, in any case, in key order then kind order", () => {
        expect(keys(findItems(ITEMS, { prefix: "a0" }))).toEqual(["Rack A01", "Cooling unit A01", "Rack A02", "Rack A03"]);
        expect(keys(findItems(ITEMS, { prefix: "frame" }))).toEqual(["Network frame ODF-1"]);
        expect(keys(findItems(ITEMS, { prefix: "side" }))).toEqual(["Power distribution unit PDU-A"]);
        expect(findItems(ITEMS, { prefix: "zz" })).toEqual([]);
    });

    test("an empty box lists every item, in key order", () => {
        expect(keys(findItems(ITEMS, { prefix: "" }))).toEqual([
            "Rack A01", "Cooling unit A01", "Rack A02", "Rack A03", "Network frame ODF-1", "Power distribution unit PDU-A",
        ]);
    });

    test("a quoted key finds the items of that key, of every kind; text that is no key finds none", () => {
        expect(keys(findItems(ITEMS, { key: "\"A01\"" }))).toEqual(["Rack A01", "Cooling unit A01"]);
        expect(findItems(ITEMS, { key: "A01" })).toEqual([]);
    });

    test("a range finds the keys from its start, up to its end", () => {
        expect(keys(findItems(ITEMS, { from: ["\"A02\""], to: ["\"B\""] }))).toEqual(["Rack A02", "Rack A03"]);
        expect(keys(findItems(ITEMS, { from: ["\"O\""] }))).toEqual(["Network frame ODF-1", "Power distribution unit PDU-A"]);
    });
});

describe("itemLine", () => {
    test("an item reads as its key, its label where it is not its key, and its kind's name", () => {
        expect(itemLine(item("A01", "A01"))).toBe("A01 · Rack");
        expect(itemLine(item("ODF-1", "Fibre frame ODF-1", "Network frame", 1))).toBe("ODF-1 · Fibre frame ODF-1 · Network frame");
    });
});
