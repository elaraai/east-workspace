/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * A kind's keys as the Flowchart and the Schematic speak them (#1549,
 * `kind-keys.ts`): each key's text — a String key as itself, any other as East
 * prints it — a text read back at the record's key type, a text no key prints
 * as reading nothing, and the keys' order at their type, where text order
 * would put `10` before `9`; made once a key type; a variant key's field
 * edited through the case it holds; and a recursive key type, which has no
 * default, made all the same. Over real East values, compared by East.
 */

import { describe, expect, test } from "vitest";
import { DateTimeType, IntegerType, RecursiveType, StringType, StructType, VariantType, equalFor, printFor, toEastTypeValue, variant, type ValueTypeOf } from "@elaraai/east";
import { keyEdited, kindKeys } from "./kind-keys.js";

const SpotKey = StructType({ row: IntegerType, col: IntegerType });
const RackKey = VariantType({ wall: IntegerType, floor: StringType });
/** A part's place in an assembly, down its parents: a type with no default. */
const PathKey = RecursiveType((self) => VariantType({ top: StringType, under: StructType({ part: StringType, parent: self }) }));

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

    test("keys in their order at their type, each read back once: Integer keys 2, 9 and 10, never 10 first", () => {
        const keys = kindKeys(toEastTypeValue(IntegerType));
        expect(keys.order(["10", "2", "9"]).map(({ text }) => text)).toEqual(["2", "9", "10"]);
        // Each beside the key it reads back as.
        const integerEqual = equalFor(IntegerType);
        expect(integerEqual(keys.order(["10"])[0]!.key as ValueTypeOf<typeof IntegerType>, 10n)).toBe(true);
        // A text no key prints as — a placeholder — after every key, in its text's order.
        expect(keys.order(["new b", "10", "new a", "9"]).map(({ text }) => text)).toEqual(["9", "10", "new a", "new b"]);
        // A struct key in East's order of its fields, a variant's by its cases.
        const spots = kindKeys(toEastTypeValue(SpotKey));
        expect(spots.order(["(row=2, col=1)", "(row=1, col=10)", "(row=1, col=9)"]).map(({ text }) => text))
            .toEqual(["(row=1, col=9)", "(row=1, col=10)", "(row=2, col=1)"]);
        // A String key in its text's order: as before.
        expect(kindKeys(toEastTypeValue(StringType)).order(["10", "9", "2"]).map(({ text }) => text)).toEqual(["10", "2", "9"]);
    });

    test("made once a key type: every read of a kind's keys is the same printer and reader", () => {
        const type = toEastTypeValue(IntegerType);
        expect(kindKeys(type)).toBe(kindKeys(type));
    });

    test("a variant key's field is its choice and its cases' values under it; an edit through the case it holds sets it, through another leaves it", () => {
        const racks = kindKeys(toEastTypeValue(RackKey));
        expect(racks.typed).toBe(true);
        expect(racks.specs.map((spec) => spec.path.join("."))).toEqual(["key", "key.floor", "key.wall"]);
        const rackEqual = equalFor(RackKey);
        const edited = (held: unknown, path: string[], next: unknown) => keyEdited(racks, held, path, next) as ValueTypeOf<typeof RackKey>;
        expect(rackEqual(edited(variant("wall", 3n), ["key", "wall"], 4n), variant("wall", 4n))).toBe(true);
        expect(rackEqual(edited(variant("wall", 3n), ["key", "floor"], "B"), variant("wall", 3n))).toBe(true);
        // Another case chosen: the key the choice wrote.
        expect(rackEqual(edited(variant("wall", 3n), ["key"], variant("floor", "")), variant("floor", ""))).toBe(true);
        // A placeholder, typed no key yet, starts from its type's default: its first case.
        expect(rackEqual(edited(undefined, ["key", "floor"], "B"), variant("floor", "B"))).toBe(true);
    });

    test("a recursive key type, which has no default, is made all the same: its keys print and read back, a key's text is what a kind's read takes, and the form types none", () => {
        const paths = kindKeys(toEastTypeValue(PathKey));
        const pathEqual = equalFor(PathKey);
        const motor: ValueTypeOf<typeof PathKey> = variant("under", { part: "motor", parent: variant("top", "pump") });
        const text = paths.textOf(motor);
        expect(pathEqual(paths.keyOf(text) as ValueTypeOf<typeof PathKey>, motor)).toBe(true);
        expect(paths.readKey(text)).toBe(text);
        expect(paths.typed).toBe(false);
    });
});
