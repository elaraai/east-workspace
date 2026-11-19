/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * The order a row of filter chips draws its chips in, by their groups
 * (`groups.ts`, #1673): each group's chips together, the groups in the order
 * the host names them and then by their first chip, a group's chips in the
 * host's order, each named group's first chip marked; chips in no group drawn
 * as given, never named.
 */

import { describe, test, expect } from "vitest";
import { chipOrder } from "./groups.js";

describe("chipOrder (#1673)", () => {
    test("chips in no group: drawn as the host gives them, no group named", () => {
        expect(chipOrder([undefined, undefined, undefined])).toEqual({ order: [0, 1, 2], starts: [false, false, false] });
        expect(chipOrder([])).toEqual({ order: [], starts: [] });
    });

    test("one group: drawn as given, named once before its first chip", () => {
        expect(chipOrder(["orders", "orders"], ["orders"])).toEqual({ order: [0, 1], starts: [true, false] });
    });

    test("groups interleaved: each group's chips together, in the host's order within it, the groups in the order the host names them", () => {
        // Stock is named first, though Orders' filter came first.
        expect(chipOrder(["orders", "stock", "orders", "stock"], ["stock", "orders"])).toEqual({ order: [1, 3, 0, 2], starts: [true, false, true, false] });
    });

    test("a named group with no chip draws nothing; a group the host does not name comes after, by its first chip", () => {
        expect(chipOrder(["sales", "orders", "returns", "sales"], ["stock", "orders"])).toEqual({ order: [1, 0, 3, 2], starts: [true, true, false, true] });
    });

    test("a filter taken out of a group never moves the others: the groups keep the host's order", () => {
        const before = chipOrder(["orders", "stock", "orders"], ["orders", "stock"]);
        // Orders' first filter out: Stock's comes first among the host's places, Orders still draws first.
        const after = chipOrder(["stock", "orders"], ["orders", "stock"]);
        expect([before.order, after.order]).toEqual([[0, 2, 1], [1, 0]]);
        expect(after.starts).toEqual([true, true]);
    });

    test("chips in no group among named ones: one group of their own, after the named groups, never named", () => {
        expect(chipOrder([undefined, "orders", undefined], ["orders"])).toEqual({ order: [1, 0, 2], starts: [true, false, false] });
    });
});
