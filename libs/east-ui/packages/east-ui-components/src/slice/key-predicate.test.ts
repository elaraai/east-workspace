/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Facet selection semantics (#188) — every `nextFieldFilters` transition and
 * the `selectedFieldKeys` read-back the Legend / Breakdown facet gestures are
 * built on. Pure over decoded values.
 */

import { describe, test, expect } from "vitest";
import { variant } from "@elaraai/east";
import { nextFieldFilters, selectedFieldKeys, type PredicateValue } from "./key-predicate.js";

const p = (v: unknown) => v as PredicateValue;

describe("nextFieldFilters — string/integer in-set multi-select", () => {
    test("no managed filter → click adds an in{v} filter", () => {
        const next = nextFieldFilters([], "string", "region", "EU")!;
        expect(next.length).toBe(1);
        expect((next[0] as any).value.op.type).toBe("in");
        expect((next[0] as any).value.op.value).toEqual(new Set(["EU"]));
    });

    test("clicking a second value ORs into the SAME in-set (never an impossible AND)", () => {
        const start = [p(variant("string", { fieldId: "region", op: variant("in", new Set(["EU"])) }))];
        const next = nextFieldFilters(start, "string", "region", "NA")!;
        expect(next.length).toBe(1);
        expect((next[0] as any).value.op.value).toEqual(new Set(["EU", "NA"]));
    });

    test("clicking a selected value removes it; the last removal drops the filter", () => {
        const two = [p(variant("string", { fieldId: "region", op: variant("in", new Set(["EU", "NA"])) }))];
        const one = nextFieldFilters(two, "string", "region", "EU")!;
        expect((one[0] as any).value.op.value).toEqual(new Set(["NA"]));
        expect(nextFieldFilters(one, "string", "region", "NA")).toEqual([]);
    });

    test("an existing eq merges in as a singleton selection", () => {
        const eq = [p(variant("string", { fieldId: "region", op: variant("eq", "EU") }))];
        const next = nextFieldFilters(eq, "string", "region", "NA")!;
        expect(next.length).toBe(1);
        expect((next[0] as any).value.op.type).toBe("in");
        expect((next[0] as any).value.op.value).toEqual(new Set(["EU", "NA"]));
    });

    test("integer keys parse to bigint members", () => {
        const next = nextFieldFilters([], "integer", "qty", "10")!;
        expect((next[0] as any).value.op.value).toEqual(new Set([10n]));
        const more = nextFieldFilters(next, "integer", "qty", "20")!;
        expect((more[0] as any).value.op.value).toEqual(new Set([10n, 20n]));
    });

    test("other-field filters and other-op filters on the SAME field pass through untouched", () => {
        const start = [
            p(variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })),
            p(variant("string", { fieldId: "region", op: variant("contains", "E") })),
        ];
        const next = nextFieldFilters(start, "string", "region", "EU")!;
        expect(next.length).toBe(3);
        expect(next.slice(0, 2)).toEqual(start);      // untouched, in order
    });
});

describe("nextFieldFilters — boolean/datetime replace-single; float inert", () => {
    test("boolean replaces the selection; clicking the selected value clears it", () => {
        const on = nextFieldFilters([], "boolean", "active", "true")!;
        expect((on[0] as any).value.op).toEqual(expect.objectContaining({ type: "is", value: true }));
        const swapped = nextFieldFilters(on, "boolean", "active", "false")!;
        expect((swapped[0] as any).value.op.value).toBe(false);
        expect(nextFieldFilters(swapped, "boolean", "active", "false")).toEqual([]);
    });

    test("datetime pins a closed between on the instant; re-click clears", () => {
        const iso = "2026-01-02T00:00:00.000Z";
        const on = nextFieldFilters([], "datetime", "day", iso)!;
        const op = (on[0] as any).value.op;
        expect(op.type).toBe("between");
        expect(op.value.from.getTime()).toBe(new Date(iso).getTime());
        expect(op.value.to.getTime()).toBe(new Date(iso).getTime());
        expect(nextFieldFilters(on, "datetime", "day", iso)).toEqual([]);
    });

    test("float kinds and unparseable keys are inert (undefined)", () => {
        expect(nextFieldFilters([], "float", "score", "1.5")).toBeUndefined();
        expect(nextFieldFilters([], "integer", "qty", "not-a-number")).toBeUndefined();
        expect(nextFieldFilters([], "datetime", "day", "not-a-date")).toBeUndefined();
    });
});

describe("selectedFieldKeys", () => {
    test("reads in-set members, eq singletons, and pinned between instants as group keys", () => {
        expect(selectedFieldKeys([p(variant("string", { fieldId: "region", op: variant("in", new Set(["EU", "NA"])) }))], "string", "region"))
            .toEqual(new Set(["EU", "NA"]));
        expect(selectedFieldKeys([p(variant("integer", { fieldId: "qty", op: variant("in", new Set([10n])) }))], "integer", "qty"))
            .toEqual(new Set(["10"]));
        expect(selectedFieldKeys([p(variant("string", { fieldId: "region", op: variant("eq", "EU") }))], "string", "region"))
            .toEqual(new Set(["EU"]));
        const iso = "2026-01-02T00:00:00.000Z";
        expect(selectedFieldKeys([p(variant("datetime", { fieldId: "day", op: variant("between", { from: new Date(iso), to: new Date(iso) }) }))], "datetime", "day"))
            .toEqual(new Set([iso]));
    });

    test("empty when no managed filter exists (other fields / other ops don't count)", () => {
        expect(selectedFieldKeys([p(variant("string", { fieldId: "region", op: variant("contains", "E") }))], "string", "region"))
            .toEqual(new Set());
        expect(selectedFieldKeys([], "string", "region")).toEqual(new Set());
    });
});
