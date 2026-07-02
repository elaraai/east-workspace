/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Unit tests for the pure selection rules (`selection.ts`) — the managed slice
 * `in`-clause splice (the selection→slice bridge) and the marquee hit
 * collection. Fixtures follow the `slice.dom.test.tsx` precedent: minimal
 * decoded-value shapes built with `variant()` (never hand-rolled tag objects),
 * cast where the full struct would be noise.
 */

import { describe, it, expect } from "vitest";
import { variant } from "@elaraai/east";
import RBush from "rbush";
import {
    EMPTY_STRING_SET,
    type ItemBox,
    type SlicePredicateValue,
    type SliceStateValue,
    isSelectionClause,
    managedSelectionSet,
    marqueeHits,
    sameStringSet,
    sliceWithSelection,
} from "./selection";

const inClause = (fieldId: string, keys: string[]): SlicePredicateValue =>
    variant("string", { fieldId, op: variant("in", new Set(keys)) }) as SlicePredicateValue;
const eqClause = (fieldId: string, v: string): SlicePredicateValue =>
    variant("string", { fieldId, op: variant("eq", v) }) as SlicePredicateValue;

const state = (filters: SlicePredicateValue[]): SliceStateValue =>
    ({ filters, search: "untouched", cohorts: ["untouched"] } as unknown as SliceStateValue);

describe("sameStringSet", () => {
    it("is order-free equality over string sets", () => {
        expect(sameStringSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
        expect(sameStringSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
        expect(sameStringSet(new Set(["a", "b"]), new Set(["a", "c"]))).toBe(false);
        expect(sameStringSet(new Set(), new Set())).toBe(true);
    });
});

describe("isSelectionClause / managedSelectionSet", () => {
    it("matches only a string `in` clause on the target field", () => {
        expect(isSelectionClause(inClause("id", ["A"]), "id")).toBe(true);
        expect(isSelectionClause(inClause("kind", ["A"]), "id")).toBe(false);
        expect(isSelectionClause(eqClause("id", "A"), "id")).toBe(false);
    });

    it("reads the managed key set, defaulting to the shared empty set", () => {
        const filters = [eqClause("kind", "unit"), inClause("id", ["A", "B"])];
        expect([...managedSelectionSet(filters, "id")].sort()).toEqual(["A", "B"]);
        expect(managedSelectionSet(filters, "missing")).toBe(EMPTY_STRING_SET);
        expect(managedSelectionSet([], "id")).toBe(EMPTY_STRING_SET);
    });
});

describe("sliceWithSelection", () => {
    it("appends the managed clause when absent, leaving other clauses + state fields untouched", () => {
        const s = state([eqClause("kind", "unit")]);
        const out = sliceWithSelection(s, "id", ["A", "B"]);
        expect(out.filters).toHaveLength(2);
        expect(out.filters[0]).toBe(s.filters[0]);                       // other clause untouched, position kept
        expect([...managedSelectionSet(out.filters, "id")].sort()).toEqual(["A", "B"]);
        expect((out as unknown as { search: string }).search).toBe("untouched");   // non-filter fields preserved
        expect(s.filters).toHaveLength(1);                               // input not mutated
    });

    it("replaces the managed clause IN PLACE (order preserved)", () => {
        const s = state([inClause("id", ["A"]), eqClause("kind", "unit")]);
        const out = sliceWithSelection(s, "id", ["B", "C"]);
        expect(out.filters).toHaveLength(2);
        expect(isSelectionClause(out.filters[0]!, "id")).toBe(true);     // still first
        expect([...managedSelectionSet(out.filters, "id")].sort()).toEqual(["B", "C"]);
        expect(out.filters[1]).toBe(s.filters[1]);
    });

    it("removes the managed clause when the selection empties, and is a no-op-shape when absent", () => {
        const s = state([eqClause("kind", "unit"), inClause("id", ["A"])]);
        const out = sliceWithSelection(s, "id", []);
        expect(out.filters).toHaveLength(1);
        expect(isSelectionClause(out.filters[0]!, "id")).toBe(false);
        const s2 = state([eqClause("kind", "unit")]);
        expect(sliceWithSelection(s2, "id", []).filters).toHaveLength(1);
    });

    it("only ever touches the clause on ITS field", () => {
        const s = state([inClause("other", ["X"])]);
        const out = sliceWithSelection(s, "id", ["A"]);
        expect([...managedSelectionSet(out.filters, "other")].sort()).toEqual(["X"]);
        expect([...managedSelectionSet(out.filters, "id")].sort()).toEqual(["A"]);
    });
});

describe("marqueeHits", () => {
    // Padded boxes (±2 world units), mirroring the culling tree: an item whose
    // PADDING overlaps the region but whose CENTER is outside must not select.
    const box = (key: string, x: number, y: number): ItemBox =>
        ({ minX: x - 2, minY: y - 2, maxX: x + 2, maxY: y + 2, item: { key, x, y } as ItemBox["item"] });
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

    it("skips locked and slice-excluded items", () => {
        expect([...marqueeHits(tree(), region, new Set(["A"]), EMPTY_STRING_SET)]).toEqual(["B"]);
        expect([...marqueeHits(tree(), region, EMPTY_STRING_SET, new Set(["B"]))]).toEqual(["A"]);
        expect([...marqueeHits(tree(), region, new Set(["A"]), new Set(["B"]))]).toEqual([]);
    });

    it("returns empty for a region with no candidates", () => {
        expect(marqueeHits(tree(), { minX: 100, minY: 100, maxX: 101, maxY: 101 }, EMPTY_STRING_SET, EMPTY_STRING_SET).size).toBe(0);
    });
});
