/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    BooleanType, IntegerType, FloatType, StringType, DateTimeType,
    NullType, BlobType,
    ArrayType, DictType, StructType, VariantType, RefType,
    toEastTypeValue,
    type EastTypeValue,
} from "@elaraai/east";

import { isPrimitiveLeafType, formatManualDraft, parseManualDraft } from "../../src/diff/manual.js";

const t = (T: any): EastTypeValue => toEastTypeValue(T);

// ============================================================================
// isPrimitiveLeafType — Manual chooser visibility gate
// ============================================================================

describe("isPrimitiveLeafType", () => {
    for (const [name, T] of [
        ["Boolean",  BooleanType],
        ["Integer",  IntegerType],
        ["Float",    FloatType],
        ["String",   StringType],
        ["DateTime", DateTimeType],
    ] as const) {
        test(`${name} → true`, () => {
            assert.equal(isPrimitiveLeafType(t(T)), true);
        });
    }

    for (const [name, T] of [
        ["Null", NullType],
        ["Blob", BlobType],
        ["Array<Int>",  ArrayType(IntegerType)],
        ["Dict",        DictType(StringType, IntegerType)],
        ["Struct",      StructType({ a: IntegerType })],
        ["Variant",     VariantType({ x: IntegerType })],
        ["Ref<Int>",    RefType(IntegerType)],
    ] as const) {
        test(`${name} → false (Manual chooser hidden)`, () => {
            assert.equal(isPrimitiveLeafType(t(T)), false);
        });
    }

    test("null leafType → false", () => {
        assert.equal(isPrimitiveLeafType(null), false);
    });
});

// ============================================================================
// formatManualDraft — value → input draft
// ============================================================================

describe("formatManualDraft", () => {
    test("Boolean true / false", () => {
        assert.equal(formatManualDraft(t(BooleanType), true), "true");
        assert.equal(formatManualDraft(t(BooleanType), false), "false");
    });

    test("Integer (bigint) → decimal string", () => {
        assert.equal(formatManualDraft(t(IntegerType), 42n), "42");
        assert.equal(formatManualDraft(t(IntegerType), 9007199254740993n), "9007199254740993");
    });

    test("Float → decimal string (number coercion)", () => {
        assert.equal(formatManualDraft(t(FloatType), 1.5), "1.5");
        assert.equal(formatManualDraft(t(FloatType), 0), "0");
    });

    test("String passthrough", () => {
        assert.equal(formatManualDraft(t(StringType), "hello"), "hello");
        assert.equal(formatManualDraft(t(StringType), ""), "");
    });

    test("DateTime → datetime-local format (YYYY-MM-DDTHH:mm)", () => {
        const d = new Date("2025-07-15T13:30:00Z");
        assert.equal(formatManualDraft(t(DateTimeType), d), "2025-07-15T13:30");
    });

    test("null/undefined value → empty string", () => {
        assert.equal(formatManualDraft(t(IntegerType), null), "");
        assert.equal(formatManualDraft(t(IntegerType), undefined), "");
    });

    test("null leafType → empty string", () => {
        assert.equal(formatManualDraft(null, "anything"), "");
    });
});

// ============================================================================
// parseManualDraft — input draft → typed value
// ============================================================================

describe("parseManualDraft", () => {
    test("Integer: valid → bigint", () => {
        const r = parseManualDraft(t(IntegerType), "42");
        assert.equal(r.ok, true);
        if (r.ok) {
            assert.equal(r.value, 42n);
            assert.equal(typeof r.value, "bigint");
        }
    });

    test("Integer: large bigint preserves precision", () => {
        const r = parseManualDraft(t(IntegerType), "9007199254740993");
        assert.equal(r.ok, true);
        if (r.ok) assert.equal(r.value, 9007199254740993n);
    });

    test("Integer: invalid → ok=false", () => {
        assert.equal(parseManualDraft(t(IntegerType), "not-a-number").ok, false);
        assert.equal(parseManualDraft(t(IntegerType), "1.5").ok, false);
    });

    test("Float: valid → number", () => {
        const r = parseManualDraft(t(FloatType), "3.14");
        assert.equal(r.ok, true);
        if (r.ok) {
            assert.equal(r.value, 3.14);
            assert.equal(typeof r.value, "number");
        }
    });

    test("Float: empty string parses as 0 (Number behaviour) — acceptable for staged drafts", () => {
        const r = parseManualDraft(t(FloatType), "");
        assert.equal(r.ok, true);
        if (r.ok) assert.equal(r.value, 0);
    });

    test("Float: NaN-producing input → ok=false", () => {
        assert.equal(parseManualDraft(t(FloatType), "abc").ok, false);
    });

    test("String: passthrough", () => {
        const r = parseManualDraft(t(StringType), "hello world");
        assert.equal(r.ok, true);
        if (r.ok) assert.equal(r.value, "hello world");
    });

    test("DateTime: ISO-shaped → Date instance", () => {
        const r = parseManualDraft(t(DateTimeType), "2025-07-15T13:30");
        assert.equal(r.ok, true);
        if (r.ok) {
            assert.ok(r.value instanceof Date);
            assert.equal((r.value as Date).getUTCFullYear(), 2025);
        }
    });

    test("DateTime: invalid → ok=false", () => {
        assert.equal(parseManualDraft(t(DateTimeType), "not-a-date").ok, false);
    });

    test("Boolean / Null / Blob / containers: ok=false (Manual not supported)", () => {
        assert.equal(parseManualDraft(t(BooleanType), "true").ok, false);
        assert.equal(parseManualDraft(t(NullType), "anything").ok, false);
        assert.equal(parseManualDraft(t(BlobType), "anything").ok, false);
        assert.equal(parseManualDraft(t(ArrayType(IntegerType)), "[]").ok, false);
        assert.equal(parseManualDraft(t(StructType({ a: IntegerType })), "{}").ok, false);
    });
});

// ============================================================================
// Round-trip: format → parse for primitives that support it
// ============================================================================

describe("Manual draft round-trip", () => {
    test("Integer: format(parse(s)) === s for canonical integer strings", () => {
        const r = parseManualDraft(t(IntegerType), "42");
        if (!r.ok) throw new Error("expected parse to succeed");
        assert.equal(formatManualDraft(t(IntegerType), r.value), "42");
    });

    test("Float: parse(format(v)) round-trips integer floats", () => {
        const initial = 1.5;
        const draft = formatManualDraft(t(FloatType), initial);
        const r = parseManualDraft(t(FloatType), draft);
        if (!r.ok) throw new Error("expected parse to succeed");
        assert.equal(r.value, initial);
    });

    test("String: parse(format(v)) === v", () => {
        const draft = formatManualDraft(t(StringType), "hello");
        const r = parseManualDraft(t(StringType), draft);
        if (!r.ok) throw new Error("expected parse to succeed");
        assert.equal(r.value, "hello");
    });

    test("DateTime: parse(format(d)) is the same minute (sub-minute precision lost in datetime-local)", () => {
        const original = new Date("2025-07-15T13:30:45Z");
        const draft = formatManualDraft(t(DateTimeType), original);
        const r = parseManualDraft(t(DateTimeType), draft);
        if (!r.ok) throw new Error("expected parse to succeed");
        assert.equal((r.value as Date).getUTCFullYear(), 2025);
        assert.equal((r.value as Date).getUTCMonth(), 6);
        assert.equal((r.value as Date).getUTCDate(), 15);
    });
});
