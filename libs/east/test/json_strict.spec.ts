/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, DateTimeType, IntegerType } from "../src/index.js";
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
    });
});
