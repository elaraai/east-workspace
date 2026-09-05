/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
    ArrayType,
    BlobType,
    BooleanType,
    DateTimeType,
    DictType,
    FloatType,
    IntegerType,
    isTypeEqual,
    MatrixType,
    NullType,
    OptionType,
    printType,
    RecursiveType,
    RefType,
    SetType,
    StringType,
    StructType,
    VariantType,
    VectorType,
    type EastType,
} from "../types.js";
import { jsonSchemaFor, type JsonSchema, type JsonSchemaDraft } from "./json_schema.js";
import { JsonSchemaUnsupportedError, typeFromJsonSchema } from "./json_schema_to_type.js";

const LinkedListType = RecursiveType((self: any) => VariantType({
    nil: NullType,
    cons: StructType({ head: IntegerType, tail: self }),
}));

/** The corpus both directions are pinned against. */
const CORPUS: [string, EastType][] = [
    ["Null", NullType],
    ["Boolean", BooleanType],
    ["Integer", IntegerType],
    ["Float", FloatType],
    ["String", StringType],
    ["DateTime", DateTimeType],
    ["Blob", BlobType],
    ["Array<Integer>", ArrayType(IntegerType)],
    ["Set<String>", SetType(StringType)],
    ["Dict<String,Integer>", DictType(StringType, IntegerType)],
    ["Struct", StructType({ a: StringType, b: IntegerType, c: DateTimeType })],
    ["Variant", VariantType({ ok: IntegerType, err: StringType })],
    ["Option<String>", OptionType(StringType)],
    ["Ref<Integer>", RefType(IntegerType)],
    ["Vector<Float>", VectorType(FloatType)],
    ["Matrix<Integer>", MatrixType(IntegerType)],
    ["nested", ArrayType(StructType({
        id: IntegerType,
        tags: SetType(StringType),
        note: OptionType(StringType),
        when: DateTimeType,
    }))],
    ["recursive", LinkedListType],
    ["Array<recursive>", ArrayType(LinkedListType)],
];

const DRAFTS: JsonSchemaDraft[] = ["2020-12", "draft-07", "openapi-3.0"];

/** Assert a conversion is refused, and that it names the expected pointer. */
function refuses(schema: JsonSchema, message: RegExp, pointer?: string): void {
    try {
        typeFromJsonSchema(schema);
        assert.fail("should have refused the schema");
    } catch (e: unknown) {
        assert.ok(e instanceof JsonSchemaUnsupportedError, `expected JsonSchemaUnsupportedError, got ${e}`);
        assert.match(e.message, message);
        if (pointer !== undefined) assert.equal(e.pointer, pointer);
    }
}

describe("typeFromJsonSchema", () => {
    describe("round-trip with jsonSchemaFor", () => {
        for (const draft of DRAFTS) {
            test(`inverts every corpus type exactly (${draft})`, () => {
                for (const [name, type] of CORPUS) {
                    const back = typeFromJsonSchema(jsonSchemaFor(type, { draft }));
                    assert.ok(
                        isTypeEqual(back, type),
                        `${name}: got ${printType(back)}, want ${printType(type)}`);
                }
            });
        }
    });

    describe("structural mapping for a foreign document", () => {
        test("maps the primitive types", () => {
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: "null" }), NullType));
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: "boolean" }), BooleanType));
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: "string" }), StringType));
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: "number" }), FloatType));
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: "integer" }), IntegerType));
        });

        test("reads OpenAPI 3.0's nullable spelling of null", () => {
            assert.ok(isTypeEqual(typeFromJsonSchema({ nullable: true, enum: [null] }), NullType));
        });

        test("maps an array to an Array of its items", () => {
            assert.ok(isTypeEqual(
                typeFromJsonSchema({ type: "array", items: { type: "string" } }),
                ArrayType(StringType)));
        });

        test("maps a closed, fully-required object to a Struct", () => {
            const T = typeFromJsonSchema({
                type: "object",
                properties: { a: { type: "string" }, b: { type: "integer" } },
                required: ["a", "b"],
                additionalProperties: false,
            });
            assert.ok(isTypeEqual(T, StructType({ a: StringType, b: IntegerType })));
        });

        test("maps a tagged oneOf to a Variant, in either tag spelling", () => {
            const withConst = typeFromJsonSchema({
                oneOf: [
                    {
                        type: "object",
                        properties: { type: { const: "ok" }, value: { type: "integer" } },
                        required: ["type", "value"], additionalProperties: false,
                    },
                ],
            });
            assert.ok(isTypeEqual(withConst, VariantType({ ok: IntegerType })));

            // draft-04 / OpenAPI 3.0 has no `const`.
            const withEnum = typeFromJsonSchema({
                oneOf: [
                    {
                        type: "object",
                        properties: { type: { enum: ["ok"] }, value: { type: "integer" } },
                        required: ["type", "value"], additionalProperties: false,
                    },
                ],
            });
            assert.ok(isTypeEqual(withEnum, VariantType({ ok: IntegerType })));
        });

        test("without annotations, a Set is indistinguishable from an Array", () => {
            // The documented limit of the best-effort mapping: uniqueItems is
            // not enough to recover Set, so an un-annotated document does not
            // promise to round-trip.
            const T = typeFromJsonSchema({ type: "array", items: { type: "string" }, uniqueItems: true });
            assert.ok(isTypeEqual(T, ArrayType(StringType)));
        });
    });

    describe("definitions", () => {
        test("resolves a self-referential definition into a RecursiveType", () => {
            const schema = jsonSchemaFor(LinkedListType);
            const back = typeFromJsonSchema(schema);
            assert.equal(back.type, "Recursive");
            assert.ok(isTypeEqual(back, LinkedListType));
        });

        test("reads definitions from either keyword", () => {
            const modern = typeFromJsonSchema({
                $ref: "#/$defs/Leaf",
                $defs: { Leaf: { type: "string" } },
            });
            const legacy = typeFromJsonSchema({
                $ref: "#/definitions/Leaf",
                definitions: { Leaf: { type: "string" } },
            });
            assert.ok(isTypeEqual(modern, StringType));
            assert.ok(isTypeEqual(legacy, StringType));
        });

        test("refuses mutually recursive definitions", () => {
            refuses({
                $ref: "#/$defs/A",
                $defs: {
                    A: {
                        type: "object", properties: { b: { $ref: "#/$defs/B" } },
                        required: ["b"], additionalProperties: false,
                    },
                    B: {
                        type: "object", properties: { a: { $ref: "#/$defs/A" } },
                        required: ["a"], additionalProperties: false,
                    },
                },
            }, /mutually recursive; East supports self-recursion only/);
        });

        test("refuses a reference it cannot resolve", () => {
            refuses({ $ref: "#/$defs/Nope" }, /no such definition/, "/$ref");
            refuses(
                { $ref: "https://example.com/other.json" },
                /only local #\/\$defs\/… references are supported/, "/$ref");
        });
    });

    describe("keywords East cannot express", () => {
        const unsupported: [string, JsonSchema, RegExp, string][] = [
            ["allOf", { type: "object", allOf: [{ type: "string" }] }, /have no intersection/, "/allOf"],
            ["not", { not: { type: "string" } }, /have no negation/, "/not"],
            ["anyOf", { anyOf: [{ type: "string" }] }, /variants are discriminated/, "/anyOf"],
            ["if", { if: { type: "string" }, then: { type: "string" } }, /have no conditionals/, "/if"],
            ["patternProperties",
                { type: "object", patternProperties: { "^a": { type: "string" } } },
                /no pattern-keyed record/, "/patternProperties"],
            ["prefixItems",
                { type: "array", prefixItems: [{ type: "string" }] },
                /no tuple type/, "/prefixItems"],
        ];

        for (const [name, schema, message, pointer] of unsupported) {
            test(`refuses ${name}, naming the keyword and its pointer`, () => {
                refuses(schema, message, pointer);
            });
        }

        test("refuses an open record", () => {
            refuses(
                { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
                /East structs are closed/);
        });

        test("refuses an optional property, pointing at it", () => {
            refuses({
                type: "object",
                properties: { a: { type: "string" }, b: { type: "string" } },
                required: ["a"],
                additionalProperties: false,
            }, /"b" is optional.*model it as an Option/, "/properties/b");
        });

        test("refuses a union of primitive types", () => {
            refuses({ type: ["string", "null"] }, /East unions are discriminated variants/, "/type");
        });

        test("refuses an unconstrained schema", () => {
            refuses({ description: "anything at all" }, /an unconstrained schema has no East type/);
        });

        test("refuses an untagged oneOf", () => {
            refuses(
                { oneOf: [{ type: "string" }, { type: "number" }] },
                /an untagged union is not an East variant/, "/oneOf/0");
        });

        test("points into the document, not just at the root", () => {
            refuses({
                type: "array",
                items: {
                    type: "object",
                    properties: { inner: { not: { type: "string" } } },
                    required: ["inner"],
                    additionalProperties: false,
                },
            }, /have no negation/, "/items/properties/inner/not");
        });
    });
});
