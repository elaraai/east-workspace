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

/** The ordinary linked list: an Option of the struct itself, flat at every depth. */
const ChainType = RecursiveType((self: any) => StructType({ head: IntegerType, next: OptionType(self) }));

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
    // Every form an Option takes: flat over each kind of payload, and tagged
    // over the two payloads that can themselves be null.
    ["Option<Integer>", OptionType(IntegerType)],
    ["Option<Float>", OptionType(FloatType)],
    ["Option<Null>", OptionType(NullType)],
    ["Option<Option<String>>", OptionType(OptionType(StringType))],
    ["Option<Variant>", OptionType(VariantType({ ok: NullType, err: StringType }))],
    ["Option<Struct>", OptionType(StructType({ a: IntegerType }))],
    ["Array<Option<String>>", ArrayType(OptionType(StringType))],
    ["Dict<String,Option<Integer>>", DictType(StringType, OptionType(IntegerType))],
    ["Option<recursive>", OptionType(LinkedListType)],
    ["chain", ChainType],
    ["Option<chain>", OptionType(ChainType)],
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

        test("reads nullable beside a type as an Option of it", () => {
            // East JSON writes a none whose payload cannot be null as null, so
            // the nulls the contract permits are exactly what the reader accepts.
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: "string", nullable: true }), OptionType(StringType)));
            assert.ok(isTypeEqual(
                typeFromJsonSchema({ type: "array", items: { type: "integer" }, nullable: true }),
                OptionType(ArrayType(IntegerType))));
            assert.ok(isTypeEqual(
                typeFromJsonSchema({ $ref: "#/$defs/L", nullable: true, $defs: { L: { type: "string" } } }),
                OptionType(StringType)));
            assert.ok(isTypeEqual(typeFromJsonSchema({
                nullable: true,
                oneOf: [{
                    type: "object", properties: { type: { const: "ok" }, value: { type: "integer" } },
                    required: ["type", "value"], additionalProperties: false,
                }],
            }), OptionType(VariantType({ ok: IntegerType }))));
            assert.ok(isTypeEqual(typeFromJsonSchema({ "x-east-type": "Integer", nullable: true }), OptionType(IntegerType)));
            // `nullable: false` asserts nothing.
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: "string", nullable: false }), StringType));
        });

        test("leaves nullable alone beside a spelling that already admits null", () => {
            // Wrapping these would make their nulls a tagged none, which is not
            // what the document says.
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: "null", nullable: true }), NullType));
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: ["string", "null"], nullable: true }), OptionType(StringType)));
            const flat = jsonSchemaFor(OptionType(StringType), { draft: "openapi-3.0" });
            assert.ok(isTypeEqual(typeFromJsonSchema({ ...flat, nullable: true }), OptionType(StringType)));
        });

        test("reads one type beside null in a type union as an Option of it", () => {
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: ["string", "null"] }), OptionType(StringType)));
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: ["null", "integer"] }), OptionType(IntegerType)));
            assert.ok(isTypeEqual(
                typeFromJsonSchema({ type: ["object", "null"], properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false }),
                OptionType(StructType({ a: StringType }))));
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: ["null"] }), NullType));
        });

        test("reads a oneOf of null and one other schema as an Option of it", () => {
            assert.ok(isTypeEqual(typeFromJsonSchema({ oneOf: [{ type: "null" }, { type: "string" }] }), OptionType(StringType)));
            assert.ok(isTypeEqual(typeFromJsonSchema({ oneOf: [{ type: "integer" }, { type: "null" }] }), OptionType(IntegerType)));
            assert.ok(isTypeEqual(
                typeFromJsonSchema({ oneOf: [{ type: "null" }, { type: "array", items: { type: "string" } }] }),
                OptionType(ArrayType(StringType))));
            // Two nulls, or none, is not that spelling: it is an untagged union.
            for (const oneOf of [[{ type: "null" }, { type: "null" }], [{ type: "string" }, { type: "integer" }]]) {
                assert.throws(() => typeFromJsonSchema({ oneOf }), /an untagged union is not an East variant/);
            }
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

        test("binds a two-definition cycle on one definition", () => {
            // A → B → A needs one RecursiveType: B is inlined under A's binder.
            const T = typeFromJsonSchema({
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
            });
            const want = RecursiveType((self: any) => StructType({ b: StructType({ a: self }) }));
            assert.ok(isTypeEqual(T, want), `got ${printType(T)}`);
        });

        test("binds a cycle through an array alias, the ordinary recursive shape", () => {
            // Node → NodeList → Node is how recursive schemas are usually
            // written (the JSON Schema meta-schemas do it), and it is one East
            // type with the alias inlined.
            const $defs = {
                Node: {
                    type: "object", properties: { children: { $ref: "#/$defs/NodeList" } },
                    required: ["children"], additionalProperties: false,
                },
                NodeList: { type: "array", items: { $ref: "#/$defs/Node" } },
            };
            const node = RecursiveType((self: any) => StructType({ children: ArrayType(self) }));
            const T = typeFromJsonSchema({ $ref: "#/$defs/Node", $defs });
            assert.ok(isTypeEqual(T, node), `got ${printType(T)}`);
            // Entered at the alias, the same node is read as an array of it.
            const list = typeFromJsonSchema({ $ref: "#/$defs/NodeList", $defs });
            assert.ok(isTypeEqual(list, ArrayType(node)), `got ${printType(list)}`);
        });

        test("shares a cyclic alias referenced from outside its cycle", () => {
            const T = typeFromJsonSchema({
                $ref: "#/$defs/Root",
                $defs: {
                    Root: {
                        type: "object",
                        properties: { a: { $ref: "#/$defs/NodeList" }, b: { $ref: "#/$defs/Node" } },
                        required: ["a", "b"], additionalProperties: false,
                    },
                    Node: {
                        type: "object", properties: { children: { $ref: "#/$defs/NodeList" } },
                        required: ["children"], additionalProperties: false,
                    },
                    NodeList: { type: "array", items: { $ref: "#/$defs/Node" } },
                },
            });
            const node = RecursiveType((self: any) => StructType({ children: ArrayType(self) }));
            assert.ok(isTypeEqual(T, StructType({ a: ArrayType(node), b: node })), `got ${printType(T)}`);
        });

        test("refuses a cycle group that needs two binders, naming its members", () => {
            // Both definitions loop on themselves and on each other, so no one
            // definition lies on every cycle — East cannot bind that.
            refuses({
                $ref: "#/$defs/A",
                $defs: {
                    A: {
                        type: "object",
                        properties: { a: { $ref: "#/$defs/A" }, b: { $ref: "#/$defs/B" } },
                        required: ["a", "b"], additionalProperties: false,
                    },
                    B: {
                        type: "object",
                        properties: { a: { $ref: "#/$defs/A" }, b: { $ref: "#/$defs/B" } },
                        required: ["a", "b"], additionalProperties: false,
                    },
                },
            }, /definitions "A" and "B" are mutually recursive in a way East cannot express/, "/$defs/A");
        });

        test("decides recursion by reachability, never by the order references appear in", () => {
            // Every ordering of the self and cross references is refused the
            // same way, with the same pointer.
            const props = (selfFirst: boolean, self: string, other: string): JsonSchema =>
                selfFirst
                    ? { self: { $ref: `#/$defs/${self}` }, other: { $ref: `#/$defs/${other}` } }
                    : { other: { $ref: `#/$defs/${other}` }, self: { $ref: `#/$defs/${self}` } };
            for (const aSelfFirst of [true, false]) {
                for (const bSelfFirst of [true, false]) {
                    refuses({
                        $ref: "#/$defs/A",
                        $defs: {
                            A: { type: "object", properties: props(aSelfFirst, "A", "B"), required: ["self", "other"], additionalProperties: false },
                            B: { type: "object", properties: props(bSelfFirst, "B", "A"), required: ["self", "other"], additionalProperties: false },
                        },
                    }, /mutually recursive in a way East cannot express/, "/$defs/A");
                }
            }
        });

        test("treats a definition that is not a schema object as an error at its pointer", () => {
            refuses(
                { $ref: "#/$defs/L", $defs: { L: null } },
                /expected definition "L" to be a schema object/, "/$defs/L");
        });

        test("refuses a reference it cannot resolve", () => {
            refuses({ $ref: "#/$defs/Nope" }, /no such definition/, "/$ref");
            refuses(
                { $ref: "https://example.com/other.json" },
                /only local #\/\$defs\/… references are supported/, "/$ref");
        });
    });

    describe("the declared release", () => {
        test("honours $schema on the releases it emits", () => {
            for (const draft of ["2020-12", "draft-07"] as const) {
                const schema = jsonSchemaFor(ArrayType(IntegerType), { draft });
                assert.ok(schema["$schema"] !== undefined, `${draft} must stamp $schema`);
                assert.ok(isTypeEqual(typeFromJsonSchema(schema), ArrayType(IntegerType)));
            }
        });

        test("accepts a fragment carrying no $schema", () => {
            // An OpenAPI 3.0 schema object lives inside an OpenAPI document and
            // carries no $schema of its own, so requiring one would reject what
            // jsonSchemaFor emits for that release.
            const schema = jsonSchemaFor(ArrayType(IntegerType), { draft: "openapi-3.0" });
            assert.equal(schema["$schema"], undefined);
            assert.ok(isTypeEqual(typeFromJsonSchema(schema), ArrayType(IntegerType)));
            assert.ok(isTypeEqual(typeFromJsonSchema({ type: "string" }), StringType));
        });

        test("refuses a release it cannot read, rather than guessing", () => {
            refuses(
                { $schema: "http://json-schema.org/draft-04/schema#", type: "string" },
                /cannot read the JSON Schema release/, "/$schema");
            refuses(
                { $schema: "https://json-schema.org/draft/2019-09/schema", type: "string" },
                /cannot read the JSON Schema release/, "/$schema");
        });

        test("ignores the scheme and a trailing # in $schema", () => {
            // Neither is significant in a $schema value, and producers vary.
            for (const uri of [
                "https://json-schema.org/draft/2020-12/schema",
                "http://json-schema.org/draft/2020-12/schema#",
                "http://json-schema.org/draft-07/schema#",
                "https://json-schema.org/draft-07/schema",
            ]) {
                assert.ok(isTypeEqual(typeFromJsonSchema({ $schema: uri, type: "string" }), StringType), uri);
            }
        });

        test("refuses a non-string $schema", () => {
            refuses({ $schema: 7, type: "string" }, /expected "\$schema" to be a string/, "/$schema");
        });

        test("resolves draft-07 definitions even though it declares them", () => {
            const T = typeFromJsonSchema({
                $schema: "http://json-schema.org/draft-07/schema#",
                $ref: "#/definitions/Leaf",
                definitions: { Leaf: { type: "string" } },
            });
            assert.ok(isTypeEqual(T, StringType));
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

        test("refuses a union of more than one type, with or without null", () => {
            // Only one type beside "null" has an East reading, as an Option.
            refuses({ type: ["string", "integer"] },
                /East unions are discriminated variants, and only one type beside "null" reads, as an Option/, "/type");
            refuses({ type: ["string", "integer", "null"] },
                /cannot express a union of primitive types \[string, integer, null\]/, "/type");
        });

        test("refuses a malformed Option annotation, pointing at its oneOf", () => {
            refuses({ "x-east-type": "Option", oneOf: [{ type: "string" }] },
                /needs an Option's "oneOf" to hold exactly two alternatives/, "/oneOf");
            refuses({ "x-east-type": "Option", oneOf: [{ type: "string" }, { type: "integer" }] },
                /needs an Option's "oneOf" to hold one null alternative and one payload/, "/oneOf");
            refuses({ "x-east-type": "Option", oneOf: [{ type: "null" }, { type: "null" }] },
                /needs an Option's "oneOf" to hold one null alternative and one payload/, "/oneOf");
            refuses({ "x-east-type": "Option", oneOf: [{ type: "null" }, { not: { type: "string" } }] },
                /have no negation/, "/oneOf/1/not");
        });

        test("treats an explicit null as present, never as absent", () => {
            // A null is a value the document carries; refusing it at its own
            // pointer is what keeps the two language twins reading alike.
            refuses({ type: "array", items: null }, /expected items to be a schema object/, "/items");
            refuses({ $schema: null, type: "string" }, /expected "\$schema" to be a string/, "/$schema");
            refuses({ type: null }, /does not recognise the type "null"/, "/type");
            refuses({ type: null, nullable: true }, /does not recognise the type "null"/, "/type");
            refuses(
                { type: "object", properties: null, additionalProperties: false },
                /expected properties to be a schema object/, "/properties");
            refuses({
                oneOf: [{
                    type: "object", properties: { type: { const: "ok" }, value: null },
                    required: ["type", "value"], additionalProperties: false,
                }],
            }, /expected value to be a schema object/, "/oneOf/0/properties/value");
        });

        test("ignores entries of required that are not names", () => {
            refuses({
                type: "object",
                properties: { a: { type: "string" } },
                required: [["a"], 7, null],
                additionalProperties: false,
            }, /"a" is optional/, "/properties/a");
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
