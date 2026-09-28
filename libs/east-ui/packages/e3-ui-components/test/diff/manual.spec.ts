/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Manual conflict editor's drafts, over real East values: each value is a
 * `ValueTypeOf` of its East type, decoded from East's own encoding as the Diff
 * holds it. A draft is East's text for the value and reads back through
 * East's parsers — so it round-trips, refuses what is not a value (an empty
 * field is not 0), and reads a DateTime in UTC in every timezone.
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import {
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    IntegerType,
    NullType,
    RefType,
    StringType,
    StructType,
    VariantType,
    decodeBeast2For,
    encodeBeast2For,
    equalFor,
    toEastTypeValue,
    type EastType,
    type ValueTypeOf,
} from "@elaraai/east";

import { formatManualDraft, isPrimitiveLeafType, parseManualDraft } from "../../src/diff/manual.js";

/** A value as the Diff holds it: decoded from East's own encoding. */
function stored<T extends EastType>(type: T, value: ValueTypeOf<T>): ValueTypeOf<T> {
    return decodeBeast2For(type)(encodeBeast2For(type)(value));
}

/** The draft reads back as exactly the value it was made from. */
function assertRoundTrips<T extends EastType>(type: T, value: ValueTypeOf<T>): void {
    const leafType = toEastTypeValue(type);
    const held = stored(type, value);
    const draft = formatManualDraft(leafType, held);
    const read = parseManualDraft(leafType, draft);
    assert.ok(read.ok, `the draft ${JSON.stringify(draft)} reads back`);
    assert.ok(equalFor(type)(read.value as ValueTypeOf<T>, held), `${JSON.stringify(draft)} reads back as the value it came from`);
}

/** 13:30 on 15 July 2025, UTC — to the minute, as a datetime-local input edits it. */
const MINUTE = new Date(Date.UTC(2025, 6, 15, 13, 30));

// ============================================================================
// isPrimitiveLeafType — the Manual chooser's visibility gate
// ============================================================================

describe("isPrimitiveLeafType", () => {
    for (const [name, type] of [
        ["Boolean",  BooleanType],
        ["Integer",  IntegerType],
        ["Float",    FloatType],
        ["String",   StringType],
        ["DateTime", DateTimeType],
    ] as const) {
        test(`${name} → true`, () => {
            assert.equal(isPrimitiveLeafType(toEastTypeValue(type)), true);
        });
    }

    for (const [name, type] of [
        ["Null",       NullType],
        ["Blob",       BlobType],
        ["Array<Int>", ArrayType(IntegerType)],
        ["Dict",       DictType(StringType, IntegerType)],
        ["Struct",     StructType({ a: IntegerType })],
        ["Variant",    VariantType({ x: IntegerType })],
        ["Ref<Int>",   RefType(IntegerType)],
    ] as const) {
        test(`${name} → false (Manual chooser hidden)`, () => {
            assert.equal(isPrimitiveLeafType(toEastTypeValue(type)), false);
        });
    }
});

// ============================================================================
// formatManualDraft — a value as the input's draft
// ============================================================================

describe("formatManualDraft", () => {
    test("a Boolean, an Integer and a Float draft as East prints them", () => {
        assert.equal(formatManualDraft(toEastTypeValue(BooleanType), stored(BooleanType, true)), "true");
        assert.equal(formatManualDraft(toEastTypeValue(IntegerType), stored(IntegerType, 9007199254740993n)), "9007199254740993");
        assert.equal(formatManualDraft(toEastTypeValue(IntegerType), stored(IntegerType, -9223372036854775808n)), "-9223372036854775808");
        assert.equal(formatManualDraft(toEastTypeValue(FloatType), stored(FloatType, 1.5)), "1.5");
        assert.equal(formatManualDraft(toEastTypeValue(FloatType), stored(FloatType, 42)), "42.0");
        assert.equal(formatManualDraft(toEastTypeValue(FloatType), stored(FloatType, -0)), "-0.0");
    });

    test("a String drafts as itself", () => {
        assert.equal(formatManualDraft(toEastTypeValue(StringType), stored(StringType, "Mech A")), "Mech A");
        assert.equal(formatManualDraft(toEastTypeValue(StringType), stored(StringType, "")), "");
    });

    test("a DateTime drafts as its UTC minute — what a datetime-local input edits", () => {
        const instant = new Date(Date.UTC(2025, 6, 15, 13, 30, 45, 123));
        assert.equal(formatManualDraft(toEastTypeValue(DateTimeType), stored(DateTimeType, instant)), "2025-07-15T13:30");
    });

    test("a change that leaves no value (a delete) drafts nothing", () => {
        assert.equal(formatManualDraft(toEastTypeValue(IntegerType), undefined), "");
    });
});

// ============================================================================
// parseManualDraft — East's parsers read the draft
// ============================================================================

describe("parseManualDraft", () => {
    test("an Integer reads as an East Integer, to either end of its 64-bit range", () => {
        const integer = toEastTypeValue(IntegerType);
        assert.deepEqual(parseManualDraft(integer, "42"), { ok: true, value: 42n });
        assert.deepEqual(parseManualDraft(integer, "9223372036854775807"), { ok: true, value: 9223372036854775807n });
        assert.deepEqual(parseManualDraft(integer, "-9223372036854775808"), { ok: true, value: -9223372036854775808n });
    });

    test("an Integer draft that is not one is refused — an empty field is not 0", () => {
        const integer = toEastTypeValue(IntegerType);
        for (const draft of ["", "1.5", "0x10", "not-a-number", "9223372036854775808"]) {
            assert.equal(parseManualDraft(integer, draft).ok, false, JSON.stringify(draft));
        }
    });

    test("a Float reads as an East Float", () => {
        const float = toEastTypeValue(FloatType);
        assert.deepEqual(parseManualDraft(float, "3.14"), { ok: true, value: 3.14 });
        assert.deepEqual(parseManualDraft(float, "1e5"), { ok: true, value: 100000 });
        const negativeZero = parseManualDraft(float, "-0.0");
        assert.ok(negativeZero.ok && Object.is(negativeZero.value, -0), "-0.0 reads as negative zero");
    });

    test("a Float draft that is not one is refused — an empty field is not 0", () => {
        const float = toEastTypeValue(FloatType);
        for (const draft of ["", "abc"]) {
            assert.equal(parseManualDraft(float, draft).ok, false, JSON.stringify(draft));
        }
    });

    test("a Boolean reads as East reads one", () => {
        const boolean = toEastTypeValue(BooleanType);
        assert.deepEqual(parseManualDraft(boolean, "false"), { ok: true, value: false });
        assert.equal(parseManualDraft(boolean, "yes").ok, false);
    });

    test("a String is the draft itself", () => {
        assert.deepEqual(parseManualDraft(toEastTypeValue(StringType), "hello world"), { ok: true, value: "hello world" });
        assert.deepEqual(parseManualDraft(toEastTypeValue(StringType), ""), { ok: true, value: "" });
    });

    test("a DateTime reads its minute in UTC", () => {
        assert.deepEqual(parseManualDraft(toEastTypeValue(DateTimeType), "2025-07-15T13:30"), { ok: true, value: MINUTE });
    });

    test("a DateTime draft that is not a minute is refused", () => {
        const datetime = toEastTypeValue(DateTimeType);
        for (const draft of ["", "2025-07-15", "not-a-date"]) {
            assert.equal(parseManualDraft(datetime, draft).ok, false, JSON.stringify(draft));
        }
    });

    test("the types the editor does not edit read nothing", () => {
        assert.equal(parseManualDraft(toEastTypeValue(NullType), "null").ok, false);
        assert.equal(parseManualDraft(toEastTypeValue(BlobType), "0x00").ok, false);
        assert.equal(parseManualDraft(toEastTypeValue(ArrayType(IntegerType)), "[]").ok, false);
        assert.equal(parseManualDraft(toEastTypeValue(StructType({ a: IntegerType })), "(a=1)").ok, false);
    });
});

// ============================================================================
// Round trip — the draft reads back as the value it came from
// ============================================================================

describe("a draft reads back as the value it came from", () => {
    test("Boolean", () => {
        assertRoundTrips(BooleanType, true);
        assertRoundTrips(BooleanType, false);
    });

    test("Integer", () => {
        for (const value of [0n, -5n, 9007199254740993n, 9223372036854775807n, -9223372036854775808n]) {
            assertRoundTrips(IntegerType, value);
        }
    });

    test("Float", () => {
        for (const value of [1.5, 42, -0, 0.1 + 0.2, 1e21, -2.5e-8]) {
            assertRoundTrips(FloatType, value);
        }
    });

    test("String", () => {
        for (const value of ["", "Mech A", "  padded  "]) {
            assertRoundTrips(StringType, value);
        }
    });

    test("DateTime, to the minute", () => {
        assertRoundTrips(DateTimeType, MINUTE);
    });
});

for (const tz of ["America/Los_Angeles", "Pacific/Kiritimati"]) {
    describe(`a DateTime draft is UTC whatever the timezone — TZ=${tz}`, () => {
        let previous: string | undefined;
        before(() => { previous = process.env.TZ; process.env.TZ = tz; });
        after(() => {
            if (previous === undefined) delete process.env.TZ;
            else process.env.TZ = previous;
        });

        test("the process really is off UTC (a local reading would move the instant)", () => {
            assert.notEqual(MINUTE.getHours(), MINUTE.getUTCHours());
        });

        test("the minute drafts and reads back as the same instant", () => {
            const leafType = toEastTypeValue(DateTimeType);
            assert.equal(formatManualDraft(leafType, MINUTE), "2025-07-15T13:30");
            assert.deepEqual(parseManualDraft(leafType, "2025-07-15T13:30"), { ok: true, value: MINUTE });
            assertRoundTrips(DateTimeType, MINUTE);
        });
    });
}
