/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Licensed under AGPL-3.0. See LICENSE file for details.
 */

/**
 * Value conversion tests for the builder → predicate boundary (#166), over real
 * East values: the shared clause controls emit `string[]` (set input) and
 * `{ min, max }` (range input); the East op variants carry East Sets — sorted,
 * compared with East's `equalFor` — and `{ from, to }` ranges. Seeds are the op
 * values of real `Slice.Types.Predicate` values, decoded from East's encoding.
 */

import { describe, test, expect } from "vitest";
import {
    IntegerType,
    SetType,
    StringType,
    decodeBeast2For,
    encodeBeast2For,
    equalFor,
    isValueOf,
    variant,
    type EastType,
    type ValueTypeOf,
} from "@elaraai/east";
import { Slice } from "@elaraai/east-ui/internal";
import { predicateOpValue, predicateControlValue } from "./predicate-builder.js";

/** A value as a renderer holds it: decoded from East's own encoding. */
function stored<T extends EastType>(type: T, value: ValueTypeOf<T>): ValueTypeOf<T> {
    return decodeBeast2For(type)(encodeBeast2For(type)(value));
}

const IntegerSet = SetType(IntegerType);
const StringSet = SetType(StringType);
const equalIntegerSets = equalFor(IntegerSet);
const equalStringSets = equalFor(StringSet);

/** A predicate as the Slice holds it, and its op's value. */
type Predicate = ValueTypeOf<typeof Slice.Types.Predicate>;
const opValueOf = (predicate: Predicate): unknown => stored(Slice.Types.Predicate, predicate).value.op.value;

const JAN_5 = new Date(Date.UTC(2025, 0, 5));
const MAR_28 = new Date(Date.UTC(2025, 2, 28));

describe("predicateOpValue", () => {
    test("string in/notIn make an East Set<String>, in East's order", () => {
        const set = predicateOpValue("string", "in", ["b", "a"]) as ValueTypeOf<typeof StringSet>;
        expect(equalStringSets(set, stored(StringSet, new Set(["a", "b"])))).toBe(true);
        expect([...set]).toEqual(["a", "b"]);
        expect(equalStringSets(predicateOpValue("string", "notIn", ["x"]) as ValueTypeOf<typeof StringSet>, stored(StringSet, new Set(["x"])))).toBe(true);
    });

    test("integer in reads each entry with East's parser, dropping what is not an Integer (#166)", () => {
        const set = predicateOpValue("integer", "in", ["20", " 10 ", "abc", "1.5", "9223372036854775808"]) as ValueTypeOf<typeof IntegerSet>;
        expect(equalIntegerSets(set, stored(IntegerSet, new Set([10n, 20n])))).toBe(true);
        expect([...set]).toEqual([10n, 20n]);
    });

    test("integer in with nothing East reads yields undefined (the caller skips the add)", () => {
        expect(predicateOpValue("integer", "in", ["abc", "1.5"])).toBeUndefined();
    });

    test("datetime between remaps { min, max } to the { from, to } range", () => {
        expect(predicateOpValue("datetime", "between", { min: JAN_5, max: MAR_28 })).toEqual({ from: JAN_5, to: MAR_28 });
    });

    test("single-value ops pass through untouched", () => {
        expect(predicateOpValue("string", "contains", "abc")).toBe("abc");
        expect(predicateOpValue("integer", "gte", 10n)).toBe(10n);
    });

    test("every clause kind's value builds a predicate East accepts as a Slice.Types.Predicate", () => {
        const clauses: Array<[kind: string, op: string, raw: unknown]> = [
            ["string", "in", ["NA", "EU"]],
            ["string", "startsWith", "SKU-"],
            ["integer", "in", ["10", "20"]],
            ["integer", "gte", 10n],
            ["float", "lt", 1.5],
            ["datetime", "between", { min: JAN_5, max: MAR_28 }],
            ["datetime", "after", JAN_5],
            ["boolean", "is", true],
        ];
        for (const [kind, op, raw] of clauses) {
            const predicate = variant(kind, { fieldId: "f", op: variant(op, predicateOpValue(kind, op, raw)) });
            expect(isValueOf(predicate, Slice.Types.Predicate), `${kind} ${op}`).toBe(true);
        }
    });
});

describe("predicateControlValue (the edit-mode seed — inverse of predicateOpValue)", () => {
    test("an Integer set seeds its members as East prints them, in the set's order", () => {
        const seed = opValueOf(variant("integer", { fieldId: "sessions", op: variant("in", new Set([20n, 9007199254740993n, 10n])) }));
        expect(predicateControlValue("integer", "in", seed)).toEqual(["10", "20", "9007199254740993"]);
    });

    test("a String set seeds its members as they are, in the set's order", () => {
        const seed = opValueOf(variant("string", { fieldId: "region", op: variant("notIn", new Set(["b", "a"])) }));
        expect(predicateControlValue("string", "notIn", seed)).toEqual(["a", "b"]);
    });

    test("datetime between remaps { from, to } to the range pair's { min, max }", () => {
        const seed = opValueOf(variant("datetime", { fieldId: "day", op: variant("between", { from: JAN_5, to: MAR_28 }) }));
        expect(predicateControlValue("datetime", "between", seed)).toEqual({ min: JAN_5, max: MAR_28 });
    });

    test("single-value ops pass through untouched", () => {
        expect(predicateControlValue("string", "startsWith", "SKU-")).toBe("SKU-");
        expect(predicateControlValue("integer", "eq", 7n)).toBe(7n);
    });

    test("round trip: a seed read back through the submit conversion is the same East value", () => {
        const members = opValueOf(variant("integer", { fieldId: "sessions", op: variant("in", new Set([10n, 20n])) }));
        const seeded = predicateControlValue("integer", "in", members) as string[];
        expect(equalIntegerSets(predicateOpValue("integer", "in", seeded) as ValueTypeOf<typeof IntegerSet>, members as ValueTypeOf<typeof IntegerSet>)).toBe(true);

        const window = predicateControlValue("datetime", "between", { from: JAN_5, to: MAR_28 }) as { min: Date; max: Date };
        expect(predicateOpValue("datetime", "between", window)).toEqual({ from: JAN_5, to: MAR_28 });
    });
});
