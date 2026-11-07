/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A kind's keys as the Schematic speaks them (#1549, `kind-rows.ts`): each
 * key's text — a String key as itself, any other as East prints it — and a
 * text read back at the record's key type, a text no key prints as reading
 * nothing; made once a key type. Over real East values, compared by East.
 */

import { describe, expect, test } from "vitest";
import { DateTimeType, IntegerType, StringType, StructType, VariantType, equalFor, printFor, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { kindKeys } from "./kind-rows.js";

const SpotKey = StructType({ row: IntegerType, col: IntegerType });
const RackKey = VariantType({ wall: IntegerType, floor: StringType });

describe("kindKeys", () => {
    test("a String key is its own text, both ways: an app keyed by String reads as before", () => {
        const keys = kindKeys(toEastTypeValue(StringType));
        expect(keys.textOf("A01")).toBe("A01");
        expect(keys.keyOf("A01")).toBe("A01");
        // Any text is a String's key.
        expect(keys.keyOf("10")).toBe("10");
    });

    test("an Integer key is its number's text, read back at its type; a text no number prints as reads nothing", () => {
        const keys = kindKeys(toEastTypeValue(IntegerType));
        const integerEqual = equalFor(IntegerType);
        expect(keys.textOf(10n)).toBe("10");
        expect(integerEqual(keys.keyOf("10") as ValueTypeOf<typeof IntegerType>, 10n)).toBe(true);
        expect(keys.keyOf("Deck")).toBeUndefined();
    });

    test("a DateTime, a struct and a variant key are each as East prints them, read back equal", () => {
        const at = new Date("2026-11-07T06:00:00.000Z");
        const times = kindKeys(toEastTypeValue(DateTimeType));
        expect(times.textOf(at)).toBe(printFor(DateTimeType)(at));
        expect(equalFor(DateTimeType)(times.keyOf(times.textOf(at)) as ValueTypeOf<typeof DateTimeType>, at)).toBe(true);

        const spots = kindKeys(toEastTypeValue(SpotKey));
        expect(spots.textOf({ row: 1n, col: 2n })).toBe("(row=1, col=2)");
        expect(equalFor(SpotKey)(spots.keyOf("(row=1, col=2)") as ValueTypeOf<typeof SpotKey>, { row: 1n, col: 2n })).toBe(true);
        expect(spots.keyOf("row 1")).toBeUndefined();

        const racks = kindKeys(toEastTypeValue(RackKey));
        expect(racks.textOf(variant("wall", 3n))).toBe(".wall 3");
        expect(equalFor(RackKey)(racks.keyOf(".wall 3") as ValueTypeOf<typeof RackKey>, variant("wall", 3n))).toBe(true);
    });

    test("made once a key type: every read of a kind's keys is the same printer and reader", () => {
        const type = toEastTypeValue(IntegerType);
        expect(kindKeys(type)).toBe(kindKeys(type));
    });
});
