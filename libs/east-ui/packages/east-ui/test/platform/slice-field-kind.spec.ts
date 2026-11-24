/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * A row field's kind by its East type (`sliceFieldKind`, #1669) — the one
 * table a slice's config reads a field's kind from, and a Studio source reads
 * its fields' kinds from; and the display-format shorthand both declare a
 * field's format with (`toValueFormat`).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, StringType, StructType, VariantType, equalFor, variant,
} from "@elaraai/east";
import { ValueFormatType, sliceFieldKind, toValueFormat } from "@elaraai/east-ui/internal";

describe("sliceFieldKind (#1669)", () => {
    test("a primitive field's kind is its type's", () => {
        assert.deepEqual([StringType, IntegerType, FloatType, DateTimeType, BooleanType].map(sliceFieldKind),
            ["string", "integer", "float", "datetime", "boolean"]);
    });

    test("any other type has none: an Option, a Struct, a Variant, an Array, a Dict, a Blob, Null", () => {
        const others = [
            OptionType(StringType), StructType({ name: StringType }), VariantType({ a: NullType, b: StringType }),
            ArrayType(FloatType), DictType(StringType, FloatType), BlobType, NullType,
        ];
        assert.deepEqual(others.map(sliceFieldKind), others.map(() => undefined));
    });
});

describe("toValueFormat — a field's display-format shorthand (#1669)", () => {
    const same = equalFor(ValueFormatType);

    test("a word is its format; a currency takes its code, US dollars and not compact unless given; a date, a time and a date-time take their pattern", () => {
        assert.ok(same(toValueFormat("number"), variant("number", null)));
        assert.ok(same(toValueFormat("percent"), variant("percent", null)));
        assert.ok(same(toValueFormat("compact"), variant("compact", null)));
        assert.ok(same(toValueFormat({ currency: { code: "AUD" } }), variant("currency", { code: "AUD", compact: false })));
        assert.ok(same(toValueFormat({ currency: {} }), variant("currency", { code: "USD", compact: false })));
        assert.ok(same(toValueFormat({ currency: { compact: true } }), variant("currency", { code: "USD", compact: true })));
        assert.ok(same(toValueFormat({ date: "MMM D" }), variant("date", "MMM D")));
        assert.ok(same(toValueFormat({ time: "HH:mm" }), variant("time", "HH:mm")));
        assert.ok(same(toValueFormat({ datetime: "MMM D, HH:mm" }), variant("datetime", "MMM D, HH:mm")));
    });
});
