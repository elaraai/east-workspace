/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Ajv } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
    ArrayType,
    AsyncFunctionType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    FunctionType,
    IntegerType,
    MatrixType,
    NeverType,
    NullType,
    OptionType,
    RecursiveType,
    RefType,
    SetType,
    StringType,
    StructType,
    VariantType,
    VectorType,
    type EastType,
    type ValueTypeOf,
} from "../types.js";
import { none, some } from "../containers/variant.js";
import { EAST_JSON_PATTERNS, jsonSchemaFor, type JsonSchema, type JsonSchemaDraft } from "./json_schema.js";
import { toJSONFor } from "./json.js";

/**
 * A validator a partner would use, for the releases JSON Schema validators
 * implement. Unknown keywords (`x-east-type`) and formats are tolerated, as a
 * partner's validator would be configured to tolerate them.
 */
function validatorFor(draft: Exclude<JsonSchemaDraft, "openapi-3.0">, schema: JsonSchema): (doc: unknown) => boolean {
    const ajv = draft === "2020-12"
        ? new Ajv2020({ strict: false, validateFormats: false })
        : new Ajv({ strict: false, validateFormats: false });
    const validate = ajv.compile(schema);
    return (doc: unknown) => validate(doc) === true;
}

/** The pattern a leaf type's schema pins, as a compiled regex. */
function patternOf(schema: JsonSchema): RegExp {
    const pattern = schema["pattern"];
    assert.equal(typeof pattern, "string", "expected the schema to carry a pattern");
    return new RegExp(pattern as string);
}

/** A schema with `$schema` dropped, for comparing the body alone. */
function body(schema: JsonSchema): JsonSchema {
    const { $schema: _drop, ...rest } = schema;
    return rest;
}

describe("jsonSchemaFor", () => {
    describe("primitives", () => {
        test("describes Null, Boolean and String directly", () => {
            assert.deepEqual(body(jsonSchemaFor(NullType)), { type: "null" });
            assert.deepEqual(body(jsonSchemaFor(BooleanType)), { type: "boolean" });
            assert.deepEqual(body(jsonSchemaFor(StringType)), { type: "string" });
        });

        test("describes Float as a number or one of the non-finite spellings", () => {
            assert.deepEqual(body(jsonSchemaFor(FloatType)), {
                oneOf: [
                    { type: "number" },
                    { type: "string", enum: ["-0.0", "-Infinity", "Infinity", "NaN"] },
                ],
                "x-east-type": "Float",
            });
        });

        test("stamps $schema for the releases that carry one", () => {
            assert.equal(
                jsonSchemaFor(StringType)["$schema"],
                "https://json-schema.org/draft/2020-12/schema");
            assert.equal(
                jsonSchemaFor(StringType, { draft: "draft-07" })["$schema"],
                "http://json-schema.org/draft-07/schema#");
            // An OpenAPI 3.0 schema object lives inside an OpenAPI document and
            // has no $schema of its own.
            assert.equal(jsonSchemaFor(StringType, { draft: "openapi-3.0" })["$schema"], undefined);
        });
    });

    describe("Integer", () => {
        const pattern = patternOf(jsonSchemaFor(IntegerType));

        test("accepts exactly the i64 range", () => {
            for (const ok of ["0", "1", "-1", "42", "9223372036854775807", "-9223372036854775808"]) {
                assert.ok(pattern.test(ok), `${ok} should be accepted`);
            }
            for (const bad of ["9223372036854775808", "-9223372036854775809"]) {
                assert.ok(!pattern.test(bad), `${bad} should be rejected`);
            }
        });

        test("rejects an unsigned 64-bit id", () => {
            // The naive `^(0|-?[1-9][0-9]{0,18})$` admits this, so a producer
            // would validate it and we would then reject it on receipt.
            assert.ok(!pattern.test("18446744073709551615"));
            assert.ok(!pattern.test("9999999999999999999"));
        });

        test("rejects everything the decoder tolerates but the encoder never emits", () => {
            // BigInt() accepts all of these; the published contract must not.
            for (const bad of ["0x10", "0b101", "0o17", " 7 ", "+7", "007", "-0", "", "1e3", "7.5"]) {
                assert.ok(!pattern.test(bad), `${JSON.stringify(bad)} should be rejected`);
            }
        });

        test("accepts everything the encoder emits", () => {
            const encode = toJSONFor(IntegerType);
            const values = [
                0n, 1n, -1n, 7n, -7n, 10n, 99n, 100n, 12345n, -12345n,
                9007199254740993n, -9007199254740993n,
                9223372036854775807n, -9223372036854775808n,
            ];
            for (const v of values) {
                assert.ok(pattern.test(encode(v) as string), `encoder output for ${v} should validate`);
            }
        });
    });

    describe("DateTime", () => {
        test("is RFC 3339's date-time by the standard format, with no pattern, in every release", () => {
            // Every decoder reads any RFC 3339 date-time, so the contract is the
            // format a partner's validator and code generator already know.
            for (const draft of ["2020-12", "draft-07", "openapi-3.0"] as const) {
                assert.deepEqual(body(jsonSchemaFor(DateTimeType, { draft })), {
                    type: "string",
                    format: "date-time",
                    "x-east-type": "DateTime",
                }, draft);
            }
        });

        test("no DateTime pattern is published", () => {
            // The pattern described only the encoder's own form; the readers
            // now take the whole format, which no regex can carry.
            assert.equal("datetime" in EAST_JSON_PATTERNS, false);
        });

        test("no pattern refuses another producer's RFC 3339 under a real validator", () => {
            // The old pattern failed "…Z" and "+05:00" even with formats
            // unchecked; the format itself is the readers' corpus to pin
            // (east-node-std test/json.spec.ts, libs/east test/json_strict.spec.ts).
            const valid = validatorFor("2020-12", jsonSchemaFor(ArrayType(DateTimeType)));
            const encode = toJSONFor(ArrayType(DateTimeType)) as (v: Date[]) => unknown;
            assert.ok(valid(encode([new Date(0), new Date("2022-06-29T13:43:00.123Z")])));
            assert.ok(valid(["2022-06-29T13:43:00Z", "2022-06-29T18:43:00.123456+05:00"]));
            assert.equal(valid([1656510180123]), false, "a DateTime is a string, not epoch milliseconds");
        });
    });

    describe("digit classes", () => {
        test("spells every digit as [0-9], never \\d", () => {
            // A validator built on python's `re` reads \d as any Unicode digit,
            // so a value in Arabic-Indic digits would pass a partner's check
            // and then fail on receipt. The contract has to read the same on
            // every regex engine a partner might use.
            for (const p of [EAST_JSON_PATTERNS.integer, EAST_JSON_PATTERNS.blob]) {
                assert.ok(!p.includes("\\d"), `${p} must not use \\d`);
            }
        });
    });

    describe("Blob", () => {
        const pattern = patternOf(jsonSchemaFor(BlobType));

        test("accepts the lowercase hex the encoder emits", () => {
            const encode = toJSONFor(BlobType);
            assert.ok(pattern.test(encode(new Uint8Array([])) as string));
            assert.ok(pattern.test(encode(new Uint8Array([1, 3, 3, 7])) as string));
            assert.ok(pattern.test(encode(new Uint8Array([0xde, 0xad, 0xbe, 0xef])) as string));
        });

        test("rejects uppercase hex, which only the decoder allows", () => {
            assert.ok(!pattern.test("0xDEADBEEF"));
            assert.ok(!pattern.test("0xAb"));
        });

        test("rejects a missing prefix or an odd digit count", () => {
            assert.ok(!pattern.test("deadbeef"));
            assert.ok(!pattern.test("0x123"));
            assert.ok(!pattern.test("0xgg"));
        });
    });

    describe("collections", () => {
        test("describes Array as an array of its element", () => {
            assert.deepEqual(body(jsonSchemaFor(ArrayType(StringType))), {
                type: "array",
                items: { type: "string" },
            });
        });

        test("marks Set unique", () => {
            assert.deepEqual(body(jsonSchemaFor(SetType(StringType))), {
                type: "array",
                items: { type: "string" },
                uniqueItems: true,
                "x-east-type": "Set",
            });
        });

        test("describes Dict as its array-of-entries encoding", () => {
            assert.deepEqual(body(jsonSchemaFor(DictType(StringType, BooleanType))), {
                type: "array",
                items: {
                    type: "object",
                    properties: { key: { type: "string" }, value: { type: "boolean" } },
                    required: ["key", "value"],
                    additionalProperties: false,
                },
                uniqueItems: true,
                "x-east-type": "Dict",
            });
        });

        test("closes Struct to its declared fields, all required", () => {
            const schema = body(jsonSchemaFor(StructType({ a: StringType, b: BooleanType })));
            assert.equal(schema["type"], "object");
            assert.deepEqual(schema["required"], ["a", "b"]);
            assert.equal(schema["additionalProperties"], false);
        });

        test("describes Vector and Matrix as arrays", () => {
            assert.deepEqual(body(jsonSchemaFor(VectorType(FloatType)))["type"], "array");
            const m = body(jsonSchemaFor(MatrixType(IntegerType)));
            assert.equal(m["type"], "array");
            assert.equal((m["items"] as JsonSchema)["type"], "array");
        });

        test("describes Ref as a one-element array, without the aliasing form", () => {
            // The encoder ALSO writes {"$ref": …} for a target it has already
            // written, but no reader resolves that back — a streaming reader has
            // discarded what the pointer refers to — so advertising it would
            // describe documents the reader then rejects. Excluded for the same
            // reason as Array/Set/Dict aliasing, with the same stated
            // consequence: a value with shared references does not validate
            // against its own published schema.
            assert.deepEqual(body(jsonSchemaFor(RefType(StringType))), {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 1,
                "x-east-type": "Ref",
            });
        });
    });

    describe("Variant", () => {
        test("pins each case's tag and closes the object", () => {
            const schema = body(jsonSchemaFor(VariantType({ ok: IntegerType, err: StringType })));
            const alternatives = schema["oneOf"] as JsonSchema[];
            // VariantType sorts its cases, so the order is fixed by the type.
            assert.equal(alternatives.length, 2);
            const tags = alternatives.map(a => ((a["properties"] as JsonSchema)["type"] as JsonSchema)["const"]);
            assert.deepEqual(tags, ["err", "ok"]);
            for (const a of alternatives) {
                assert.deepEqual(a["required"], ["type", "value"]);
                assert.equal(a["additionalProperties"], false);
            }
        });

        test("uses a single-valued enum where the release has no const", () => {
            const schema = body(jsonSchemaFor(VariantType({ ok: IntegerType, err: StringType }), { draft: "openapi-3.0" }));
            const alternatives = schema["oneOf"] as JsonSchema[];
            const tag = (alternatives[0]!["properties"] as JsonSchema)["type"] as JsonSchema;
            assert.deepEqual(tag["enum"], ["err"]);
            assert.equal(tag["const"], undefined);
        });
    });

    describe("Option", () => {
        test("describes a flat Option as null or its payload, annotated", () => {
            // The one type-directed choice of form East JSON makes: an Option
            // whose payload can never encode as null is null or the payload.
            assert.deepEqual(body(jsonSchemaFor(OptionType(StringType))), {
                oneOf: [{ type: "null" }, { type: "string" }],
                "x-east-type": "Option",
            });
            // The null alternative is the release's own spelling of Null.
            assert.deepEqual(body(jsonSchemaFor(OptionType(StringType), { draft: "openapi-3.0" })), {
                oneOf: [{ nullable: true, enum: [null] }, { type: "string" }],
                "x-east-type": "Option",
            });
            // A variant is always an object, so it is a flat payload.
            const inner = body(jsonSchemaFor(OptionType(VariantType({ ok: NullType, err: StringType }))));
            assert.equal(inner["x-east-type"], "Option");
            assert.deepEqual((inner["oneOf"] as JsonSchema[])[0], { type: "null" });
        });

        test("keeps the tagged form where the payload can itself be null", () => {
            // some(none) must stay distinct from none, and some(null) from
            // none, so these two carry the tag — and no Option annotation.
            for (const T of [OptionType(NullType), OptionType(OptionType(StringType))]) {
                const schema = body(jsonSchemaFor(T));
                assert.equal(schema["x-east-type"], undefined);
                const tags = (schema["oneOf"] as JsonSchema[])
                    .map(a => ((a["properties"] as JsonSchema)["type"] as JsonSchema)["const"]);
                assert.deepEqual(tags, ["none", "some"]);
            }
        });

        test("judges a recursive payload by what the wrapper encodes", () => {
            // next: Option<self> is the ordinary linked list; self is a struct.
            const ChainType = RecursiveType((self: any) => StructType({ head: IntegerType, next: OptionType(self) }));
            const schema = jsonSchemaFor(ChainType);
            const properties = ((schema["$defs"] as JsonSchema)["Recursive1"] as JsonSchema)["properties"] as JsonSchema;
            assert.deepEqual(properties["next"], {
                oneOf: [{ type: "null" }, { $ref: "#/$defs/Recursive1" }],
                "x-east-type": "Option",
            });
            assert.equal(body(jsonSchemaFor(OptionType(ChainType)))["x-east-type"], "Option");
        });

        test("a flat none validates and the tagged object no longer does, under a real validator", () => {
            // What the encoder writes validates against the published schema,
            // and the object the old encoding wrote is now refused by it — for
            // every form an Option takes, in the releases validators implement.
            const RowType = StructType({
                note: OptionType(StringType),
                count: OptionType(IntegerType),
                maybe: OptionType(OptionType(IntegerType)),
                unit: OptionType(NullType),
                flags: ArrayType(OptionType(BooleanType)),
                chain: RecursiveType((self: any) => StructType({ head: IntegerType, next: OptionType(self) })),
            });
            const rows: ValueTypeOf<typeof RowType>[] = [
                { note: none, count: some(7n), maybe: some(none), unit: some(null), flags: [none, some(true)], chain: { head: 1n, next: some({ head: 2n, next: none }) } },
                { note: some("x"), count: none, maybe: none, unit: none, flags: [], chain: { head: 0n, next: none } },
                { note: some(""), count: some(-1n), maybe: some(some(3n)), unit: none, flags: [some(false)], chain: { head: 3n, next: none } },
            ];
            const encode = toJSONFor(RowType) as (row: ValueTypeOf<typeof RowType>) => Record<string, unknown>;
            for (const draft of ["2020-12", "draft-07"] as const) {
                const valid = validatorFor(draft, jsonSchemaFor(RowType, { draft }));
                for (const row of rows) {
                    assert.ok(valid(encode(row)), `${draft}: the encoder's output validates`);
                }
                const base = encode(rows[0]!);
                assert.equal(valid({ ...base, note: { type: "none", value: null } }), false,
                    `${draft}: the tagged object no longer validates under a flat Option`);
                assert.equal(valid({ ...base, count: { type: "some", value: "7" } }), false,
                    `${draft}: the tagged object no longer validates under a flat Option`);
                assert.equal(valid({ ...base, maybe: null }), false,
                    `${draft}: a bare null does not validate under an Option of an Option`);
                assert.equal(valid({ ...base, unit: null }), false,
                    `${draft}: a bare null does not validate under an Option of Null`);
                assert.equal(valid({ ...base, chain: { head: "1", next: { type: "none", value: null } } }), false,
                    `${draft}: the tagged object no longer validates through a recursive wrapper`);
            }
        });
    });

    describe("recursive types", () => {
        const LinkedListType = RecursiveType((self: any) => VariantType({
            nil: NullType,
            cons: StructType({ head: IntegerType, tail: self }),
        }));

        test("lifts the body into $defs and refers to it", () => {
            const schema = jsonSchemaFor(LinkedListType);
            assert.deepEqual(body(schema)["$ref"], "#/$defs/Recursive1");
            const defs = schema["$defs"] as JsonSchema;
            assert.ok(defs["Recursive1"] !== undefined);
        });

        test("names definitions by encounter order, not by type id", () => {
            // Type ids come from a process-global counter, so a document keyed
            // on them would differ between runs and between languages.
            const a = JSON.stringify(jsonSchemaFor(LinkedListType));
            const b = JSON.stringify(jsonSchemaFor(LinkedListType));
            assert.equal(a, b);
            assert.ok(a.includes("Recursive1"));
            assert.ok(!/Recursive[0-9]{2,}/.test(a));
        });

        test("uses the release's definitions keyword", () => {
            const seven = jsonSchemaFor(LinkedListType, { draft: "draft-07" });
            assert.deepEqual(body(seven)["$ref"], "#/definitions/Recursive1");
            assert.ok(seven["definitions"] !== undefined);
            assert.equal(seven["$defs"], undefined);
        });
    });

    describe("releases", () => {
        test("spells Null without a null type on OpenAPI 3.0", () => {
            assert.deepEqual(body(jsonSchemaFor(NullType, { draft: "openapi-3.0" })), {
                nullable: true,
                enum: [null],
            });
        });

        test("pins the same integer range in every release", () => {
            const p2020 = jsonSchemaFor(IntegerType)["pattern"];
            const p07 = jsonSchemaFor(IntegerType, { draft: "draft-07" })["pattern"];
            const pOas = jsonSchemaFor(IntegerType, { draft: "openapi-3.0" })["pattern"];
            assert.equal(p2020, p07);
            assert.equal(p07, pOas);
        });
    });

    describe("types with no JSON form", () => {
        test("refuses Never, naming it", () => {
            assert.throws(() => jsonSchemaFor(NeverType), /cannot describe Never/);
        });

        test("refuses functions, naming them", () => {
            assert.throws(() => jsonSchemaFor(FunctionType([], IntegerType)), /cannot describe Function/);
            assert.throws(
                () => jsonSchemaFor(AsyncFunctionType([], IntegerType)),
                /cannot describe AsyncFunction/);
        });

        test("refuses a function nested inside a collection", () => {
            assert.throws(
                () => jsonSchemaFor(StructType({ f: FunctionType([], IntegerType) })),
                /cannot describe Function/);
        });
    });

    test("matches the cross-language corpus digest", () => {
        // The python twin asserts this same digest over the same corpus in the
        // same order (east-py tests/serialization/test_json_schema.py). Two
        // languages agreeing on one hash is what keeps a partner from being
        // handed different contracts; changing the emitted bytes deliberately
        // means updating both constants, which is the point.
        const RecursiveCorpusType = RecursiveType((self: any) => VariantType({
            nil: NullType,
            cons: StructType({ head: IntegerType, tail: self }),
        }));
        const ChainCorpusType = RecursiveType((self: any) => StructType({
            head: IntegerType, next: OptionType(self),
        }));
        const corpus: [string, EastType][] = [
            ["Null", NullType], ["Boolean", BooleanType], ["Integer", IntegerType],
            ["Float", FloatType], ["String", StringType], ["DateTime", DateTimeType],
            ["Blob", BlobType],
            ["Array", ArrayType(IntegerType)], ["Set", SetType(StringType)],
            ["Dict", DictType(StringType, IntegerType)],
            ["Struct", StructType({ a: StringType, b: IntegerType, c: DateTimeType })],
            ["Variant", VariantType({ ok: IntegerType, err: StringType })],
            ["Option", OptionType(StringType)],
            ["Ref", RefType(IntegerType)],
            ["Vector", VectorType(FloatType)], ["Matrix", MatrixType(IntegerType)],
            ["nested", ArrayType(StructType({
                id: IntegerType, tags: SetType(StringType),
                note: OptionType(StringType), when: DateTimeType,
            }))],
            ["recursive", RecursiveCorpusType],
            ["arrayRecursive", ArrayType(RecursiveCorpusType)],
            // Every form an Option takes: flat over each kind of payload, and
            // tagged over the two payloads that can themselves be null.
            ["optionInteger", OptionType(IntegerType)],
            ["optionNull", OptionType(NullType)],
            ["optionOption", OptionType(OptionType(StringType))],
            ["optionVariant", OptionType(VariantType({ ok: NullType, err: StringType }))],
            ["arrayOption", ArrayType(OptionType(StringType))],
            ["dictOption", DictType(StringType, OptionType(IntegerType))],
            ["optionRecursive", OptionType(RecursiveCorpusType)],
            ["chain", ChainCorpusType],
        ];
        const lines: string[] = [];
        for (const draft of ["2020-12", "draft-07", "openapi-3.0"] as const) {
            for (const [name, type] of corpus) {
                lines.push(`${draft}|${name}=${JSON.stringify(jsonSchemaFor(type, { draft }))}`);
            }
        }
        assert.equal(lines.length, 81);
        assert.equal(
            createHash("sha256").update(lines.join("\n")).digest("hex"),
            "4a281175573a86a22c3b562abb60c58ac03259e51851261d506134aa67edf9e7");
    });

    test("emits byte-identical documents for the same type and release", () => {
        const T = StructType({
            id: IntegerType,
            at: DateTimeType,
            tags: SetType(StringType),
            note: OptionType(StringType),
            blob: BlobType,
        });
        for (const draft of ["2020-12", "draft-07", "openapi-3.0"] as const) {
            const first = JSON.stringify(jsonSchemaFor(ArrayType(T), { draft }));
            const second = JSON.stringify(jsonSchemaFor(ArrayType(T), { draft }));
            assert.equal(first, second, `${draft} output should be stable`);
        }
    });
});
