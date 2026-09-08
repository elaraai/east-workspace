/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
    East, ArrayType, DateTimeType, DictType, FloatType, IntegerType, NullType, OptionType, RecursiveType,
    StringType, StructType, VariantType, none, some, variant, type option,
} from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";

/**
 * Where East JSON's encoder and decoder have to agree with each other, and
 * every runtime has to agree with the rest.
 *
 * Each case below was a real divergence: a year the encoder wrote in a form its
 * own decoder rejects, an integer spelling one runtime took and another
 * refused, and a calendar date that silently became a different day. They live
 * in the compliance corpus rather than a host-side spec precisely because
 * agreement across the TypeScript, C and Python runtimes is the property at
 * stake.
 */
await describe("JsonStrict", (test) => {
    test("printJson pads a year to four digits", $ => {
        const printJson = East.String.printJson;

        // The decoder's own check is \d{4}, so an unpadded year did not survive
        // its own round trip: "500-01-02T…" was written and then refused.
        $(assert.equal(
            printJson(East.value(new Date(Date.UTC(500, 0, 2, 3, 4, 5, 0)))),
            "\"0500-01-02T03:04:05.000+00:00\""));
        // Date.UTC maps years 0-99 onto 1900+, so a one- or two-digit year has
        // to be set explicitly rather than passed in.
        $(assert.equal(
            printJson(East.value(new Date(new Date(Date.UTC(2000, 5, 7, 8, 9, 10, 11)).setUTCFullYear(12)))),
            "\"0012-06-07T08:09:10.011+00:00\""));
        $(assert.equal(
            printJson(East.value(new Date(new Date(Date.UTC(2000, 0, 1, 0, 0, 0, 0)).setUTCFullYear(1)))),
            "\"0001-01-01T00:00:00.000+00:00\""));

        // And what it writes, it reads back.
        $(assert.equal(
            East.value("\"0500-01-02T03:04:05.000+00:00\"").parseJson(DateTimeType),
            East.value(new Date(Date.UTC(500, 0, 2, 3, 4, 5, 0)))));
    });

    test("parseJson takes only the decimal Integer form", $ => {
        // Canonical spellings still parse.
        $(assert.equal(East.value("\"0\"").parseJson(IntegerType), 0n));
        $(assert.equal(East.value("\"42\"").parseJson(IntegerType), 42n));
        $(assert.equal(East.value("\"-42\"").parseJson(IntegerType), -42n));
        $(assert.equal(East.value("\"9223372036854775807\"").parseJson(IntegerType), 9223372036854775807n));
        $(assert.equal(East.value("\"-9223372036854775808\"").parseJson(IntegerType), -9223372036854775808n));

        // Everything else is refused. TypeScript reached these through BigInt(),
        // which takes alternate bases and surrounding space; east-c never did,
        // so the same document decoded differently per runtime.
        $(assert.throws(East.value("\"0x10\"").parseJson(IntegerType), /expected string representing integer/));
        $(assert.throws(East.value("\"0b101\"").parseJson(IntegerType), /expected string representing integer/));
        $(assert.throws(East.value("\"0o17\"").parseJson(IntegerType), /expected string representing integer/));
        $(assert.throws(East.value("\"007\"").parseJson(IntegerType), /expected string representing integer/));
        $(assert.throws(East.value("\"+7\"").parseJson(IntegerType), /expected string representing integer/));
        $(assert.throws(East.value("\"-0\"").parseJson(IntegerType), /expected string representing integer/));
        $(assert.throws(East.value("\" 7 \"").parseJson(IntegerType), /expected string representing integer/));
        $(assert.throws(East.value("\"1_0\"").parseJson(IntegerType), /expected string representing integer/));
    });

    test("parseJson refuses a day its month does not have", $ => {
        // A real leap day is still a date.
        $(assert.equal(
            East.value("\"2024-02-29T00:00:00.000+00:00\"").parseJson(DateTimeType),
            East.value(new Date(Date.UTC(2024, 1, 29)))));

        // These matched the format and were then rolled forward into a
        // different day — 30 February became 2 March — which is silent
        // corruption of a date the sender got wrong.
        $(assert.throws(
            East.value("\"2026-02-30T00:00:00.000+00:00\"").parseJson(DateTimeType),
            /invalid date string/));
        $(assert.throws(
            East.value("\"2025-02-29T00:00:00.000+00:00\"").parseJson(DateTimeType),
            /invalid date string/));
        $(assert.throws(
            East.value("\"2026-04-31T00:00:00.000+00:00\"").parseJson(DateTimeType),
            /invalid date string/));
        $(assert.throws(
            East.value("\"2026-00-01T00:00:00.000+00:00\"").parseJson(DateTimeType),
            /invalid date string/));
        $(assert.throws(
            East.value("\"2026-01-00T00:00:00.000+00:00\"").parseJson(DateTimeType),
            /invalid date string/));

        // The offset cannot change whether the written day exists.
        $(assert.throws(
            East.value("\"2026-02-30T00:00:00.000+05:30\"").parseJson(DateTimeType),
            /invalid date string/));

        // Hour 24 is the same defect one unit up: `new Date` normalises it to
        // 00:00 the next day rather than refusing, so it read as a different
        // instant in TypeScript while east-c refused it.
        $(assert.throws(
            East.value("\"2026-01-01T24:00:00.000+00:00\"").parseJson(DateTimeType),
            /invalid date string/));
        $(assert.throws(
            East.value("\"2026-01-01T00:60:00.000+00:00\"").parseJson(DateTimeType),
            /invalid date string/));
        $(assert.throws(
            East.value("\"2026-01-01T00:00:60.000+00:00\"").parseJson(DateTimeType),
            /invalid date string/));
        $(assert.equal(
            East.value("\"2026-01-01T23:59:59.999+00:00\"").parseJson(DateTimeType),
            East.value(new Date(Date.UTC(2026, 0, 1, 23, 59, 59, 999)))));
    });

    test("printJson writes an Option as null or its payload where the payload cannot be null", $ => {
        const printJson = East.String.printJson;

        // The one type-directed choice of form East JSON makes: none is null
        // and some is the payload itself, because at this position the payload
        // can never encode as null — so null has one reading, on every runtime.
        $(assert.equal(printJson(East.value(none, OptionType(StringType))), "null"));
        $(assert.equal(printJson(East.value(some("x"), OptionType(StringType))), "\"x\""));
        $(assert.equal(printJson(East.value(some(7n), OptionType(IntegerType))), "\"7\""));
        $(assert.equal(printJson(East.value(some(NaN), OptionType(FloatType))), "\"NaN\""));
        $(assert.equal(printJson(East.value(some({ a: 1n }), OptionType(StructType({ a: IntegerType })))), "{\"a\":\"1\"}"));
        // A variant is always an object, so it is a flat payload — Null case and all.
        const OkErr = VariantType({ ok: NullType, err: StringType });
        $(assert.equal(printJson(East.value(some(variant("ok", null)), OptionType(OkErr))), "{\"type\":\"ok\",\"value\":null}"));
        $(assert.equal(printJson(East.value(none, OptionType(OkErr))), "null"));
        $(assert.equal(printJson(East.value([none, some("x")], ArrayType(OptionType(StringType)))), "[null,\"x\"]"));
        $(assert.equal(
            printJson(East.value(new Map<string, option<bigint>>([["a", none], ["b", some(1n)]]), DictType(StringType, OptionType(IntegerType)))),
            "[{\"key\":\"a\",\"value\":null},{\"key\":\"b\",\"value\":\"1\"}]"));

        // The two payloads that can themselves be null keep the tagged form:
        // some(none) stays distinct from none, and some(null) from none.
        $(assert.equal(printJson(East.value(none, OptionType(OptionType(StringType)))), "{\"type\":\"none\",\"value\":null}"));
        $(assert.equal(printJson(East.value(some(none), OptionType(OptionType(StringType)))), "{\"type\":\"some\",\"value\":null}"));
        $(assert.equal(printJson(East.value(some(some("x")), OptionType(OptionType(StringType)))), "{\"type\":\"some\",\"value\":\"x\"}"));
        $(assert.equal(printJson(East.value(none, OptionType(NullType))), "{\"type\":\"none\",\"value\":null}"));
        $(assert.equal(printJson(East.value(some(null), OptionType(NullType))), "{\"type\":\"some\",\"value\":null}"));

        // A recursive payload is judged by what the wrapper encodes: the
        // ordinary linked list, next: Option<self>, is flat at every depth.
        const ChainType = RecursiveType(self => StructType({ head: IntegerType, next: OptionType(self) }));
        const end = $.let({ head: 1n, next: none }, ChainType);
        const chain = $.let({ head: 2n, next: some(end) }, ChainType);
        $(assert.equal(printJson(end), "{\"head\":\"1\",\"next\":null}"));
        $(assert.equal(printJson(chain), "{\"head\":\"2\",\"next\":{\"head\":\"1\",\"next\":null}}"));
        const maybeChain = $.let(some(end), OptionType(ChainType));
        $(assert.equal(printJson(maybeChain), "{\"head\":\"1\",\"next\":null}"));
        // Whereas a wrapper around an Option is judged as that Option: flat
        // itself, but tagged as the payload of another Option.
        const MaybeChainType = RecursiveType(self => OptionType(StructType({ head: IntegerType, next: self })));
        const maybeEnd = $.let(some({ head: 1n, next: none }), MaybeChainType);
        $(assert.equal(printJson(maybeEnd), "{\"head\":\"1\",\"next\":null}"));
        $(assert.equal(printJson(East.value(some(none), OptionType(MaybeChainType))), "{\"type\":\"some\",\"value\":null}"));
    });

    test("parseJson reads an Option as null or its payload, and refuses the tagged object there", $ => {
        $(assert.equal(East.value("null").parseJson(OptionType(StringType)), none));
        $(assert.equal(East.value("\"x\"").parseJson(OptionType(StringType)), some("x")));
        $(assert.equal(East.value("\"7\"").parseJson(OptionType(IntegerType)), some(7n)));
        $(assert.equal(East.value("\"NaN\"").parseJson(OptionType(FloatType)), some(NaN)));
        $(assert.equal(East.value("{\"a\":\"1\"}").parseJson(OptionType(StructType({ a: IntegerType }))), some({ a: 1n })));
        const OkErr = VariantType({ ok: NullType, err: StringType });
        $(assert.equal(East.value("{\"type\":\"ok\",\"value\":null}").parseJson(OptionType(OkErr)), some(variant("ok", null))));
        $(assert.equal(East.value("null").parseJson(OptionType(OkErr)), none));
        $(assert.equal(
            East.value("[null,\"x\"]").parseJson(ArrayType(OptionType(StringType))),
            East.value([none, some("x")], ArrayType(OptionType(StringType)))));
        $(assert.equal(
            East.value("[{\"key\":\"a\",\"value\":null},{\"key\":\"b\",\"value\":\"1\"}]").parseJson(DictType(StringType, OptionType(IntegerType))),
            East.value(new Map<string, option<bigint>>([["a", none], ["b", some(1n)]]), DictType(StringType, OptionType(IntegerType)))));

        // The tagged form where the payload can be null.
        $(assert.equal(East.value("{\"type\":\"none\",\"value\":null}").parseJson(OptionType(OptionType(StringType))), none));
        $(assert.equal(East.value("{\"type\":\"some\",\"value\":null}").parseJson(OptionType(OptionType(StringType))), some(none)));
        $(assert.equal(East.value("{\"type\":\"some\",\"value\":\"x\"}").parseJson(OptionType(OptionType(StringType))), some(some("x"))));
        $(assert.equal(East.value("{\"type\":\"some\",\"value\":null}").parseJson(OptionType(NullType)), some(null)));

        // A recursive payload, at every depth.
        const ChainType = RecursiveType(self => StructType({ head: IntegerType, next: OptionType(self) }));
        const end = $.let({ head: 1n, next: none }, ChainType);
        const chain = $.let({ head: 2n, next: some(end) }, ChainType);
        $(assert.equal(East.value("{\"head\":\"2\",\"next\":{\"head\":\"1\",\"next\":null}}").parseJson(ChainType), chain));
        $(assert.equal(East.value("null").parseJson(OptionType(ChainType)), none));

        // The rule is a cut, not a negotiation: a document written with the
        // tagged object for a flat Option is refused by the payload's own
        // decoder, with the payload's own words on every runtime.
        $(assert.throws(
            East.value("{\"type\":\"none\",\"value\":null}").parseJson(OptionType(StringType)),
            /expected string, got \{"type":"none","value":null\}/));
        $(assert.throws(
            East.value("{\"type\":\"some\",\"value\":\"7\"}").parseJson(OptionType(IntegerType)),
            /expected string representing integer, got \{"type":"some","value":"7"\}/));
        $(assert.throws(
            East.value("{\"head\":\"1\",\"next\":{\"type\":\"none\",\"value\":null}}").parseJson(ChainType),
            /unexpected field "type" in Struct/));
        // ...and a bare null under a tagged Option is refused as the object it is not.
        $(assert.throws(
            East.value("null").parseJson(OptionType(OptionType(StringType))),
            /expected object with type and value for Variant, got null/));
        $(assert.throws(
            East.value("null").parseJson(OptionType(NullType)),
            /expected object with type and value for Variant, got null/));
    });
});
