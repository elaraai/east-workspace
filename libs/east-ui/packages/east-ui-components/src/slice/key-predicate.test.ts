/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Facet selection semantics (#188) — every `nextFieldFilters` transition and
 * the `selectedFieldKeys` read-back the Legend / Breakdown facet gestures are
 * built on, over real East values: filters are `Slice.Types.Predicate` values
 * decoded from East's own encoding, as the Slice holds them (a set is East's
 * sorted set); results are compared with East's equality; and every group key
 * is spelled as the groups spell theirs (`sliceGroupKey`).
 */

import { describe, test, expect } from "vitest";
import {
    ArrayType,
    decodeBeast2For,
    encodeBeast2For,
    equalFor,
    isValueOf,
    variant,
    type EastType,
    type ValueTypeOf,
} from "@elaraai/east";
import { Slice, sliceGroupKey } from "@elaraai/east-ui/internal";
import { breakdownKeyPredicate, nextFieldFilters, selectedFieldKeys, type PredicateValue } from "./key-predicate.js";

/** A value as the Slice holds it: decoded from East's own encoding. */
function stored<T extends EastType>(type: T, value: ValueTypeOf<T>): ValueTypeOf<T> {
    return decodeBeast2For(type)(encodeBeast2For(type)(value));
}
const predicate = (value: PredicateValue): PredicateValue => stored(Slice.Types.Predicate, value);

const equalFilters = equalFor(ArrayType(Slice.Types.Predicate));

/** East's verdict on a filter list. */
function expectFilters(actual: PredicateValue[] | undefined, expected: PredicateValue[]): void {
    expect(actual).toBeDefined();
    expect(equalFilters(actual!, expected)).toBe(true);
}

/** An `in` filter's members, in the order its set iterates them. */
function membersOf(filter: PredicateValue): unknown[] {
    const op = filter.value.op;
    return op.type === "in" ? [...op.value] : [];
}

const BIG = 9007199254740993n;   // 2^53 + 1: not a JavaScript number
const JAN_2 = new Date(Date.UTC(2026, 0, 2));

describe("nextFieldFilters — string/integer in-set multi-select", () => {
    test("no managed filter → a click adds an in{key} filter", () => {
        expectFilters(nextFieldFilters([], "string", "region", "EU"), [
            predicate(variant("string", { fieldId: "region", op: variant("in", new Set(["EU"])) })),
        ]);
    });

    test("a second value ORs into the SAME in-set (never an impossible AND), whose members are in East's order", () => {
        const start = [predicate(variant("string", { fieldId: "region", op: variant("in", new Set(["NA"])) }))];
        const next = nextFieldFilters(start, "string", "region", "EU")!;
        expectFilters(next, [predicate(variant("string", { fieldId: "region", op: variant("in", new Set(["EU", "NA"])) }))]);
        expect(membersOf(next[0]!)).toEqual(["EU", "NA"]);
    });

    test("clicking a selected value removes it; the last removal drops the filter", () => {
        const two = [predicate(variant("string", { fieldId: "region", op: variant("in", new Set(["EU", "NA"])) }))];
        const one = nextFieldFilters(two, "string", "region", "EU")!;
        expectFilters(one, [predicate(variant("string", { fieldId: "region", op: variant("in", new Set(["NA"])) }))]);
        expectFilters(nextFieldFilters(one, "string", "region", "NA"), []);
    });

    test("an existing eq merges in as a singleton selection", () => {
        const eq = [predicate(variant("string", { fieldId: "region", op: variant("eq", "EU") }))];
        expectFilters(nextFieldFilters(eq, "string", "region", "NA"), [
            predicate(variant("string", { fieldId: "region", op: variant("in", new Set(["EU", "NA"])) })),
        ]);
    });

    test("integer keys read back through East into Integer members — exact past 2^53, in East's order", () => {
        const one = nextFieldFilters([], "integer", "qty", sliceGroupKey(BIG))!;
        const two = nextFieldFilters(one, "integer", "qty", sliceGroupKey(10n))!;
        expectFilters(two, [predicate(variant("integer", { fieldId: "qty", op: variant("in", new Set([10n, BIG])) }))]);
        expect(membersOf(two[0]!)).toEqual([10n, BIG]);
        expectFilters(nextFieldFilters(two, "integer", "qty", sliceGroupKey(BIG)), [
            predicate(variant("integer", { fieldId: "qty", op: variant("in", new Set([10n])) })),
        ]);
    });

    test("other-field filters and other-op filters on the SAME field pass through untouched, in order", () => {
        const start = [
            predicate(variant("integer", { fieldId: "sessions", op: variant("gte", 10n) })),
            predicate(variant("string", { fieldId: "region", op: variant("contains", "E") })),
        ];
        expectFilters(nextFieldFilters(start, "string", "region", "EU"), [
            ...start,
            predicate(variant("string", { fieldId: "region", op: variant("in", new Set(["EU"])) })),
        ]);
    });
});

describe("nextFieldFilters — boolean/datetime replace-single; float inert", () => {
    test("boolean replaces the selection; clicking the selected value clears it", () => {
        const on = nextFieldFilters([], "boolean", "active", sliceGroupKey(true))!;
        expectFilters(on, [predicate(variant("boolean", { fieldId: "active", op: variant("is", true) }))]);
        const swapped = nextFieldFilters(on, "boolean", "active", sliceGroupKey(false))!;
        expectFilters(swapped, [predicate(variant("boolean", { fieldId: "active", op: variant("is", false) }))]);
        expectFilters(nextFieldFilters(swapped, "boolean", "active", sliceGroupKey(false)), []);
    });

    test("datetime pins a closed between on the group's instant; re-click clears", () => {
        const key = sliceGroupKey(JAN_2);
        const on = nextFieldFilters([], "datetime", "day", key)!;
        expectFilters(on, [predicate(variant("datetime", { fieldId: "day", op: variant("between", { from: JAN_2, to: JAN_2 }) }))]);
        expectFilters(nextFieldFilters(on, "datetime", "day", key), []);
    });

    test("float kinds, and keys East does not read as the kind's value, are inert", () => {
        expect(nextFieldFilters([], "float", "score", sliceGroupKey(1.5))).toBeUndefined();
        expect(nextFieldFilters([], "integer", "qty", "not-a-number")).toBeUndefined();
        expect(nextFieldFilters([], "integer", "qty", "0x10")).toBeUndefined();         // BigInt reads 16n
        expect(nextFieldFilters([], "integer", "qty", "")).toBeUndefined();             // BigInt reads 0n
        expect(nextFieldFilters([], "datetime", "day", "not-a-date")).toBeUndefined();
        expect(nextFieldFilters([], "datetime", "day", "2026-01-02")).toBeUndefined();  // new Date reads a bare date
    });
});

describe("breakdownKeyPredicate", () => {
    test("each kind's equality over the value its key names — a value East accepts as a Slice predicate", () => {
        const cases: Array<[kind: string, key: string, expected: PredicateValue]> = [
            ["string", "EU", variant("string", { fieldId: "f", op: variant("eq", "EU") })],
            ["integer", sliceGroupKey(BIG), variant("integer", { fieldId: "f", op: variant("eq", BIG) })],
            ["boolean", sliceGroupKey(false), variant("boolean", { fieldId: "f", op: variant("is", false) })],
            ["datetime", sliceGroupKey(JAN_2), variant("datetime", { fieldId: "f", op: variant("between", { from: JAN_2, to: JAN_2 }) })],
        ];
        for (const [kind, key, expected] of cases) {
            const built = breakdownKeyPredicate(kind, "f", key);
            expect(isValueOf(built, Slice.Types.Predicate), kind).toBe(true);
            expectFilters([built!], [predicate(expected)]);
        }
    });

    test("a Float group has no equality predicate", () => {
        expect(breakdownKeyPredicate("float", "f", sliceGroupKey(0.5))).toBeUndefined();
    });
});

describe("selectedFieldKeys", () => {
    test("reads in-set members, eq singletons, and a pinned instant as the groups spell their keys", () => {
        const regions = [predicate(variant("string", { fieldId: "region", op: variant("in", new Set(["NA", "EU"])) }))];
        expect(selectedFieldKeys(regions, "string", "region")).toEqual(new Set(["EU", "NA"]));
        const qty = [predicate(variant("integer", { fieldId: "qty", op: variant("in", new Set([BIG, 10n])) }))];
        expect(selectedFieldKeys(qty, "integer", "qty")).toEqual(new Set([sliceGroupKey(10n), sliceGroupKey(BIG)]));
        const eq = [predicate(variant("string", { fieldId: "region", op: variant("eq", "EU") }))];
        expect(selectedFieldKeys(eq, "string", "region")).toEqual(new Set(["EU"]));
        const day = [predicate(variant("datetime", { fieldId: "day", op: variant("between", { from: JAN_2, to: JAN_2 }) }))];
        expect(selectedFieldKeys(day, "datetime", "day")).toEqual(new Set([sliceGroupKey(JAN_2)]));
    });

    test("a between over a span selects no single group", () => {
        const span = [predicate(variant("datetime", { fieldId: "day", op: variant("between", { from: JAN_2, to: new Date(Date.UTC(2026, 0, 9)) }) }))];
        expect(selectedFieldKeys(span, "datetime", "day")).toEqual(new Set());
    });

    test("empty when no managed filter exists (other fields / other ops don't count)", () => {
        const contains = [predicate(variant("string", { fieldId: "region", op: variant("contains", "E") }))];
        expect(selectedFieldKeys(contains, "string", "region")).toEqual(new Set());
        expect(selectedFieldKeys([], "string", "region")).toEqual(new Set());
    });
});
