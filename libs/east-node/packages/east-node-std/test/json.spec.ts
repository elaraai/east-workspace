/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, test as unitTest } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, FloatType, IntegerType,
    MatrixType, NullType, OptionType, RecursiveType, RefType, SetType, StringType, StructType,
    VariantType, VectorType,
    East, FunctionType, encodeJSONFor, equalFor, none, ref, some, toEastTypeValue, variant,
    type EastType, type ValueTypeOf,
} from "@elaraai/east";
import { describeEast, Assert, FileSystem, Json, NodePlatform } from "@elaraai/east-node-std";
import { JsonReader } from "../src/json_reader.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as ex from "./json.examples.js";

/** A regex matching exactly `text`, on every runtime's regex engine. */
function exactly(text: string): RegExp {
    return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

/** Reads a whole document as `type`, for the accept/reject cases. */
function read(type: EastType, text: string): unknown {
    const reader = JsonReader.openValueText(text, "");
    try {
        return reader.readValue(toEastTypeValue(type));
    } finally {
        reader.close();
    }
}

/** Whether the reader accepts `text` as `type`. */
function accepts(type: EastType, text: string): boolean {
    try {
        read(type, text);
        return true;
    } catch {
        return false;
    }
}

const IntStruct = StructType({ v: IntegerType });
const DateStruct = StructType({ v: DateTimeType });
const BlobStruct = StructType({ v: BlobType });
const FloatStruct = StructType({ v: FloatType });
const StringStruct = StructType({ v: StringType });
const BoolStruct = StructType({ v: BooleanType });
const NullStruct = StructType({ v: NullType });
const IntArrayStruct = StructType({ v: ArrayType(IntegerType) });
const StringSetStruct = StructType({ v: SetType(StringType) });
const DictStruct = StructType({ v: DictType(StringType, IntegerType) });
const RefStruct = StructType({ v: RefType(IntegerType) });
const OptionStruct = StructType({ v: OptionType(IntegerType) });
const VectorStruct = StructType({ v: VectorType(FloatType) });
const MatrixStruct = StructType({ v: MatrixType(IntegerType) });
const NestedStruct = StructType({ v: StructType({ a: IntegerType }) });

/**
 * Every payload the published contract excludes, with the exact text each
 * runtime refuses it with.
 *
 * This is ONE corpus, replayed by east-c and east-py through the `describeEast`
 * block below — not three hand-maintained lists that happen to agree. The
 * divergences that hid here (east-c taking an invalid escape, a raw control
 * character, a bad \u, and JSON numbers its own grammar forbids) were invisible
 * precisely because each runtime had its own list. The message is pinned too:
 * an East program that matches on it must get the same answer on every runner.
 * Each document is read as element 0 of an array, so every pointer starts /0.
 */
const REJECTED: [string, EastType, string, string][] = [
    ["Integer as hexadecimal", IntStruct, '{"v":"0x10"}',
        '/0/v: "0x10" is not a 64-bit integer in East JSON\'s form'],
    ["Integer as binary", IntStruct, '{"v":"0b101"}',
        '/0/v: "0b101" is not a 64-bit integer in East JSON\'s form'],
    ["Integer as octal", IntStruct, '{"v":"0o17"}',
        '/0/v: "0o17" is not a 64-bit integer in East JSON\'s form'],
    ["Integer padded with spaces", IntStruct, '{"v":" 7 "}',
        '/0/v: " 7 " is not a 64-bit integer in East JSON\'s form'],
    ["Integer with a leading zero", IntStruct, '{"v":"007"}',
        '/0/v: "007" is not a 64-bit integer in East JSON\'s form'],
    ["Integer with an explicit plus", IntStruct, '{"v":"+7"}',
        '/0/v: "+7" is not a 64-bit integer in East JSON\'s form'],
    ["negative zero", IntStruct, '{"v":"-0"}',
        '/0/v: "-0" is not a 64-bit integer in East JSON\'s form'],
    ["Integer as a JSON number", IntStruct, '{"v":7}',
        "/0/v: expected Integer as a quoted decimal string, got a number"],
    ["Integer past the i64 ceiling", IntStruct, '{"v":"9223372036854775808"}',
        '/0/v: "9223372036854775808" is not a 64-bit integer in East JSON\'s form'],
    ["an unsigned 64-bit id", IntStruct, '{"v":"18446744073709551615"}',
        '/0/v: "18446744073709551615" is not a 64-bit integer in East JSON\'s form'],
    ["DateTime with a Z suffix", DateStruct, '{"v":"2022-06-29T13:43:00.123Z"}',
        '/0/v: "2022-06-29T13:43:00.123Z" is not East JSON\'s UTC date-time form'],
    ["DateTime with a numeric offset", DateStruct, '{"v":"2022-06-29T13:43:00.123+05:00"}',
        '/0/v: "2022-06-29T13:43:00.123+05:00" is not East JSON\'s UTC date-time form'],
    ["DateTime without milliseconds", DateStruct, '{"v":"2022-06-29T13:43:00+00:00"}',
        '/0/v: "2022-06-29T13:43:00+00:00" is not East JSON\'s UTC date-time form'],
    ["a day February does not have", DateStruct, '{"v":"2026-02-30T00:00:00.000+00:00"}',
        '/0/v: "2026-02-30T00:00:00.000+00:00" is not a real date'],
    ["a day April does not have", DateStruct, '{"v":"2026-04-31T00:00:00.000+00:00"}',
        '/0/v: "2026-04-31T00:00:00.000+00:00" is not a real date'],
    ["February 29 in a common year", DateStruct, '{"v":"2025-02-29T00:00:00.000+00:00"}',
        '/0/v: "2025-02-29T00:00:00.000+00:00" is not a real date'],
    ["year zero", DateStruct, '{"v":"0000-01-01T00:00:00.000+00:00"}',
        '/0/v: "0000-01-01T00:00:00.000+00:00" is not East JSON\'s UTC date-time form'],
    ["DateTime as a number", DateStruct, '{"v":0}',
        "/0/v: expected DateTime as a string, got a number"],
    ["Blob in uppercase hex", BlobStruct, '{"v":"0xDEADBEEF"}',
        '/0/v: "0xDEADBEEF" is not East JSON\'s 0x-prefixed lowercase hex form'],
    ["Blob with an odd digit count", BlobStruct, '{"v":"0x123"}',
        '/0/v: "0x123" is not East JSON\'s 0x-prefixed lowercase hex form'],
    ["Blob without the 0x prefix", BlobStruct, '{"v":"deadbeef"}',
        '/0/v: "deadbeef" is not East JSON\'s 0x-prefixed lowercase hex form'],
    ["Blob as an array", BlobStruct, '{"v":[0,1]}',
        "/0/v: expected Blob as a string, got an array"],
    ["a String as a number", StringStruct, '{"v":1}',
        "/0/v: expected a String, got a number"],
    ["a Boolean as a string", BoolStruct, '{"v":"true"}',
        "/0/v: expected a boolean, got a string"],
    ["Null as an array", NullStruct, '{"v":[]}',
        "/0/v: expected null, got an array"],
    ["a Float as a boolean", FloatStruct, '{"v":true}',
        "/0/v: expected a Float, got a boolean"],
    ["a Float spelling that is not one of the specials", FloatStruct, '{"v":"nan"}',
        '/0/v: "nan" is not one of the non-finite float spellings'],
    ["an unmodelled field", IntStruct, '{"v":"1","extra":1}',
        '/0: unexpected field "extra"'],
    ["a missing field", IntStruct, "{}",
        '/0: missing field "v"'],
    ["a duplicated field", IntStruct, '{"v":"1","v":"2"}',
        '/0: duplicate field "v"'],
    ["a Struct that is not an object", NestedStruct, '{"v":"1"}',
        "/0/v: expected an object, got a string"],
    ["a field name that is not a string", IntStruct, '{v:"1"}',
        '/0: expected a field name, got "v"'],
    ["a field without its colon", IntStruct, '{"v" "1"}',
        '/0: expected ":" after a field name, got a string'],
    // JSON's own rules about strings, which the lenient decoder waved through.
    ["an escape JSON does not define", StringStruct, '{"v":"a\\qb"}',
        '/0/v: invalid escape "\\q"'],
    ["a raw control character in a string", StringStruct, '{"v":"ab"}',
        "/0/v: unescaped control character U+0001 in string"],
    ["a \\u escape that is not hex", StringStruct, '{"v":"\\uzzzz"}',
        '/0/v: invalid \\u escape "\\uzzzz"'],
    ["an unterminated string", StringStruct, '{"v":"abc',
        "/0/v: unexpected end of document"],
    // ...and about numbers.
    ["a Float with a leading zero", FloatStruct, '{"v":007}',
        '/0: expected "," or "}" in object'],
    ["a Float that is a bare minus", FloatStruct, '{"v":-}',
        '/0/v: expected a digit after "-"'],
    ["a Float with an empty exponent", FloatStruct, '{"v":1e}',
        "/0/v: expected a digit in the exponent"],
    ["a Float with an empty fraction", FloatStruct, '{"v":1.}',
        "/0/v: expected a digit after the decimal point"],
    // Collections.
    ["an Array that is not an array", IntArrayStruct, '{"v":{}}',
        "/0/v: expected an array, got an object"],
    ["an Array missing a separator", IntArrayStruct, '{"v":["1" "2"]}',
        '/0/v: expected "," or "]" in array'],
    ["a Set with a repeated element", StringSetStruct, '{"v":["a","b","a"]}',
        "/0/v/2: duplicate element in Set"],
    ["a Dict entry that is not an object", DictStruct, '{"v":[1]}',
        "/0/v/0: expected an object, got a number"],
    ["an empty Dict entry", DictStruct, '{"v":[{}]}',
        "/0/v/0: a Dict entry needs key and value"],
    ["a Dict entry missing its value", DictStruct, '{"v":[{"key":"a"}]}',
        "/0/v/0: a Dict entry needs both key and value"],
    ["a Dict entry with an extra field", DictStruct, '{"v":[{"key":"a","value":"1","x":1}]}',
        '/0/v/0: unexpected field "x" in Dict entry'],
    ["a Dict entry with two keys", DictStruct, '{"v":[{"key":"a","key":"b","value":"1"}]}',
        '/0/v/0: duplicate "key" in Dict entry'],
    ["a Dict with two entries for one key", DictStruct, '{"v":[{"key":"a","value":"1"},{"key":"a","value":"2"}]}',
        "/0/v/1: duplicate key in Dict"],
    ["a Ref holding two elements", RefStruct, '{"v":["1","2"]}',
        "/0/v: expected a Ref to hold exactly one element"],
    ["a Ref holding nothing", RefStruct, '{"v":[]}',
        "/0/v: expected a Ref to hold exactly one element"],
    ["a Ref written as the encoder's alias", RefStruct, '{"v":{"$ref":"1#"}}',
        "/0/v: expected a Ref as a one-element array, got an object"],
    ["a Vector element that is not a Float", VectorStruct, '{"v":["1"]}',
        '/0/v/0: "1" is not one of the non-finite float spellings'],
    ["a Matrix row that is not an array", MatrixStruct, '{"v":["1"]}',
        "/0/v/0: expected an array, got a string"],
    ["a ragged Matrix", MatrixStruct, '{"v":[["1","2"],["3"]]}',
        "/0/v: Matrix row 1 has 1 columns, expected 2"],
    // Variants.
    ["an unknown variant case", OptionStruct, '{"v":{"type":"maybe","value":"1"}}',
        '/0/v: unknown variant case "maybe"'],
    ["a Variant whose payload precedes its tag", OptionStruct, '{"v":{"value":"1","type":"some"}}',
        '/0/v: a Variant must carry "type" before "value"'],
    ["an empty Variant", OptionStruct, '{"v":{}}',
        "/0/v: a Variant needs type and value"],
    ["a Variant without its payload", OptionStruct, '{"v":{"type":"some"}}',
        "/0/v: a Variant needs both type and value"],
    ["a Variant with an extra field", OptionStruct, '{"v":{"type":"some","value":"1","extra":1}}',
        '/0/v: unexpected field "extra" in Variant'],
    ["a Variant with two tags", OptionStruct, '{"v":{"type":"some","type":"none","value":"1"}}',
        '/0/v: duplicate "type" in Variant'],
    ["a Variant whose tag is not a string", OptionStruct, '{"v":{"type":1,"value":"1"}}',
        "/0/v: expected a variant case name, got a number"],
    ["a Variant payload of the wrong form", OptionStruct, '{"v":{"type":"some","value":"x"}}',
        '/0/v/some: "x" is not a 64-bit integer in East JSON\'s form'],
];

/** Documents whose fault lies before the pointer target, on the skipped path. */
const REJECTED_ON_OPEN: [string, string, string][] = [
    ["a missing element in a skipped array", '{"junk":[1,,2],"data":[]}', 'unexpected character ","'],
    ["a misspelt literal in a skipped value", '{"junk":trux,"data":[]}', "expected true"],
    ["an undefined escape in a skipped string", '{"junk":"a\\qb","data":[]}', 'invalid escape "\\q"'],
    ["a skipped object missing its colon", '{"junk":{"a" 1},"data":[]}', 'expected ":" after a field name, got a number'],
    ["a skipped number with an empty exponent", '{"junk":[1e],"data":[]}', "expected a digit in the exponent"],
    ["a skipped array missing a separator", '{"junk":[1 2],"data":[]}', 'expected "," or "]" in array'],
    ["a skipped object with an unquoted key", '{"junk":{a:1},"data":[]}', 'expected a field name, got "a"'],
];

/**
 * Nesting of mixed bracket kinds past the limit: every value counts as one
 * level, an object and an array alike, on every runtime.
 */
const DEEP_MIXED = "{\"a\":[".repeat(1500) + "1" + "]}".repeat(1500);

const LinkedListType = RecursiveType((self: any) => VariantType({
    nil: NullType,
    cons: StructType({ head: IntegerType, tail: self }),
}));

/** Every type the reader constructs, for the round trip replayed on each runtime. */
const RoundTripType = StructType({
    id: IntegerType, name: StringType, at: DateTimeType, ratio: FloatType,
    ok: BooleanType, note: OptionType(StringType), tags: SetType(StringType),
    meta: DictType(StringType, IntegerType), raw: BlobType,
    vec: VectorType(FloatType), cell: RefType(IntegerType),
    list: LinkedListType, grid: ArrayType(ArrayType(IntegerType)), nothing: NullType,
});

describeEast("Json platform functions", (test) => {
    Assert.examples(test, {
        jsonReadArray: ex.jsonReadArray,
        jsonReadPointer: ex.jsonReadPointer,
        jsonValueEnvelope: ex.jsonValueEnvelope,
        jsonReadText: ex.jsonReadText,
        jsonReadObjectAsEntries: ex.jsonReadObjectAsEntries,
    });

    test("open of a missing path throws", $ => {
        // The detail is the host's own — three runtimes, three spellings, as
        // for the FileSystem family — so only the prefix is pinned.
        $(Assert.throws(Json.open("/definitely/does/not/exist-679.json", ""), /^json_open: /));
    });

    test("an empty document is refused by name", $ => {
        const path = $.let(East.value(join(tmpdir(), "json-empty.json")));
        $(FileSystem.writeFile(path, ""));
        $(Assert.throws(Json.open(path, ""), exactly("json_open: the document is empty")));
        $(Assert.throws(Json.openText("", ""),
            exactly("json_open_text: expected an array or object to iterate, got end of document")));
    });

    test("a pointer that does not resolve throws, naming the member", $ => {
        const path = $.let(East.value(join(tmpdir(), "json-missing-pointer.json")));
        $(FileSystem.writeFile(path, '{"data":[]}'));
        $(Assert.throws(Json.open(path, "/nope"), exactly('json_open: no member "nope"')));
        $(Assert.throws(Json.openText("[[1],[2]]", "/5"), exactly("json_open_text: no element 5")));
        $(Assert.throws(Json.openText("[[1],[2]]", "/x"),
            exactly('json_open_text: expected an array index, got "x"')));
        $(Assert.throws(Json.openText('{"a":"s"}', "/a/b"),
            exactly('json_open_text: /a: cannot descend into a string looking for "b"')));
        $(Assert.throws(Json.openText("[]", "data"),
            exactly('json_open_text: a JSON Pointer must be empty or start with "/", got "data"')));
    });

    test("pointing at a scalar rather than a container throws", $ => {
        const path = $.let(East.value(join(tmpdir(), "json-scalar-pointer.json")));
        $(FileSystem.writeFile(path, '{"data":"not a container"}'));
        $(Assert.throws(Json.open(path, "/data"),
            exactly("json_open: /data: expected an array or object to iterate, got a string")));
    });

    test("a row that violates the contract throws, naming its pointer", $ => {
        const path = $.let(East.value(join(tmpdir(), "json-bad-row.json")));
        $(FileSystem.writeFile(path, '[{"id":"1"},{"id":"not-an-integer"}]'));
        const handle = $.let(Json.open(path, ""));
        $(Json.next(StructType({ id: IntegerType }), handle));
        $(Assert.throws(Json.next(StructType({ id: IntegerType }), handle),
            exactly('json_next: /1/id: "not-an-integer" is not a 64-bit integer in East JSON\'s form')));
        $(Json.close(handle));
    });

    test("refuses every payload the contract excludes, with the same text on every runtime", $ => {
        for (const [, type, text, message] of REJECTED) {
            const handle = $.let(Json.openText(`[${text}]`, ""));
            $(Assert.throws(Json.next(type, handle), exactly(`json_next: ${message}`)));
            $(Json.close(handle));
        }
    });

    test("holds a skipped value to the grammar, with the same text on every runtime", $ => {
        // Navigating past junk is not reading it, but it is still JSON: a fault
        // before the pointer target is refused at open, and refused alike.
        for (const [, text, message] of REJECTED_ON_OPEN) {
            $(Assert.throws(Json.openText(text, "/data"), exactly(`json_open_text: ${message}`)));
        }
        $(Assert.throws(Json.openText(`{"junk":${DEEP_MIXED},"data":[]}`, "/data"),
            exactly("json_open_text: document nests deeper than 2048")));
    });

    test("refuses invalid UTF-8 in a string on every runtime", $ => {
        // Bytes, not text: an East String cannot carry them, so they arrive
        // through a file. Node used to repair them to U+FFFD, east-c to pass
        // them through — a document that read as different values per runtime.
        const path = $.let(East.value(join(tmpdir(), "json-invalid-utf8.json")));
        $(FileSystem.writeFileBytes(path, new Uint8Array([
            0x5b, 0x7b, 0x22, 0x76, 0x22, 0x3a, 0x22, 0x61, 0xff, 0x62, 0x22, 0x7d, 0x5d, // [{"v":"a<ff>b"}]
        ])));
        const handle = $.let(Json.open(path, ""));
        $(Assert.throws(Json.next(StringStruct, handle), exactly("json_next: /0/v: invalid UTF-8 in string")));
        $(Json.close(handle));
        // ...whereas a well-formed multi-byte character, escaped or raw, reads.
        const text = $.let(Json.openText('[{"v":"\\u00e9\\ud83d\\ude00é😀"}]', ""));
        $(Assert.equal(Json.next(StringStruct, text).v, "é😀é😀"));
        $(Json.close(text));
    });

    test("accepts what the contract includes", $ => {
        const ok: [EastType, string][] = [
            [IntStruct, '{"v":"0"}'],
            [IntStruct, '{"v":"-9223372036854775808"}'],
            [IntStruct, '{"v":"9223372036854775807"}'],
            [DateStruct, '{"v":"2024-02-29T00:00:00.000+00:00"}'],
            [DateStruct, '{"v":"0001-01-01T00:00:00.000+00:00"}'],
            [DateStruct, '{"v":"9999-12-31T23:59:59.999+00:00"}'],
            [BlobStruct, '{"v":"0x"}'],
            [BlobStruct, '{"v":"00ff"}'.replace("00ff", "0x00ff")],
            [FloatStruct, '{"v":0}'],
            [FloatStruct, '{"v":-1.5e10}'],
            [FloatStruct, '{"v":"NaN"}'],
            [StringStruct, '{"v":"a\\u0041b"}'],
            [BoolStruct, '{"v":false}'],
            [NullStruct, '{"v":null}'],
            [IntArrayStruct, '{"v":[]}'],
            [IntArrayStruct, '{"v":["1","2"]}'],
            [StringSetStruct, '{"v":["b","a"]}'],
            [DictStruct, '{"v":[{"value":"1","key":"a"}]}'],
            [RefStruct, '{"v":["7"]}'],
            [OptionStruct, '{"v":{"type":"none","value":null}}'],
            [VectorStruct, '{"v":[1.5,"NaN","-Infinity",2]}'],
            [MatrixStruct, '{"v":[["1","2"],["3","4"]]}'],
            [MatrixStruct, '{"v":[]}'],
            [MatrixStruct, '{"v":[[]]}'],
            [NestedStruct, '{"v":{"a":"1"}}'],
            // Pretty-printed input is JSON too.
            [IntStruct, '{\n\t"v" : "1"\n}'],
        ];
        for (const [type, text] of ok) {
            const handle = $.let(Json.openText(`[ ${text} ]`, ""));
            $(Json.next(type, handle));
            $(Assert.equal(Json.more(handle), false));
            $(Json.close(handle));
        }
    });

    test("everything the encoder emits reads back equal, on every runtime", $ => {
        // The other half of the invariant, for every type the reader
        // constructs — Vector, Ref and a recursive type included (a Matrix has
        // no literal, so it gets its own case): what this runtime's printJson
        // writes, its reader reads back as the same value.
        const rows = $.const(East.value([
            {
                id: 0n, name: "a", at: new Date(0), ratio: 1.5, ok: true, note: none,
                tags: new Set(["x", "y"]), meta: new Map([["k", 1n]]), raw: new Uint8Array([1, 255]),
                vec: new Float64Array([0.5, -2, 1e21]),
                cell: ref(7n), list: variant("cons", { head: 1n, tail: variant("cons", { head: 2n, tail: variant("nil", null) }) }),
                grid: [[1n], []], nothing: null,
            },
            {
                id: 9223372036854775807n, name: "é中\"\\\n\t", at: new Date("2026-02-28T23:59:59.999Z"),
                ratio: -0, ok: false, note: some("hi"), tags: new Set<string>(), meta: new Map<string, bigint>(),
                raw: new Uint8Array([]), vec: new Float64Array([]),
                cell: ref(-1n), list: variant("nil", null), grid: [], nothing: null,
            },
        ], ArrayType(RoundTripType)));
        const text = $.let(East.String.printJson(rows));
        const reader = $.let(Json.openText(text, ""));
        const back = $.let(East.value([], ArrayType(RoundTripType)));
        $.while(Json.more(reader), $ => {
            $(back.pushLast(Json.next(RoundTripType, reader)));
        });
        $(Json.close(reader));
        $(Assert.equal(back, rows));
    });

    test("a Matrix prints and reads back equal, on every runtime", $ => {
        const rows = $.let([], ArrayType(VectorType(IntegerType)));
        $(rows.pushLast(East.Vector.fromArray(East.value([1n, -2n], ArrayType(IntegerType)))));
        $(rows.pushLast(East.Vector.fromArray(East.value([3n, 9223372036854775807n], ArrayType(IntegerType)))));
        const mats = $.let([], ArrayType(MatrixType(IntegerType)));
        $(mats.pushLast(East.Matrix.fromRows(rows)));
        const text = $.let(East.String.printJson(mats));
        const reader = $.let(Json.openText(text, ""));
        const back = $.let([], ArrayType(MatrixType(IntegerType)));
        $.while(Json.more(reader), $ => {
            $(back.pushLast(Json.next(MatrixType(IntegerType), reader)));
        });
        $(Json.close(reader));
        $(Assert.equal(back, mats));
    });

    test("iterates an object as key and value in either field order, naming a bad member by name", $ => {
        // The two fields may be declared in either order — the struct is built
        // in the type's own order on every runtime — and an error inside a
        // member is located by its name, as RFC 6901 addresses an object.
        const KeyFirst = StructType({ key: StringType, value: IntegerType });
        const ValueFirst = StructType({ value: IntegerType, key: StringType });
        const a = $.let(Json.openText('{"a":"1","b":"2"}', ""));
        $(Assert.equal(Json.next(KeyFirst, a), { key: "a", value: 1n }));
        $(Assert.equal(Json.next(KeyFirst, a), { key: "b", value: 2n }));
        $(Json.close(a));
        const b = $.let(Json.openText('{"a":"1","b":"2"}', ""));
        $(Assert.equal(Json.next(ValueFirst, b), { value: 1n, key: "a" }));
        $(Assert.equal(Json.next(ValueFirst, b), { value: 2n, key: "b" }));
        $(Json.close(b));
        const bad = $.let(Json.openText('{"a":"1","b~/c":"x"}', ""));
        $(Json.next(KeyFirst, bad));
        $(Assert.throws(Json.next(KeyFirst, bad),
            exactly('json_next: /b~0~1c: "x" is not a 64-bit integer in East JSON\'s form')));
        $(Json.close(bad));
    });

    test("iterating an object with the wrong row type is refused at the container", $ => {
        const handle = $.let(Json.openText('{"a":"1"}', ""));
        $(Assert.throws(Json.next(IntegerType, handle),
            exactly("json_next: iterating an object needs a Struct with exactly the fields key and value")));
        $(Assert.throws(Json.next(StructType({ key: IntegerType, value: IntegerType }), handle),
            exactly("json_next: iterating an object needs a String key")));
        $(Json.close(handle));
    });

    test("a handle cannot be used after it is closed", $ => {
        const path = $.let(East.value(join(tmpdir(), "json-closed.json")));
        $(FileSystem.writeFile(path, "[]"));
        const handle = $.let(Json.open(path, ""));
        $(Json.close(handle));
        $(Assert.throws(Json.more(handle), exactly("json_more: no open JSON reader for this handle")));
        $(Assert.throws(Json.next(IntStruct, handle), exactly("json_next: no open JSON reader for this handle")));
        $(Assert.throws(Json.close(handle), exactly("json_close: no open JSON reader for this handle")));
    });

    test("reading past the end is refused, and the reader stays closed", $ => {
        const handle = $.let(Json.openText('[{"v":"1"}]', ""));
        $(Json.next(IntStruct, handle));
        $(Assert.throws(Json.next(IntStruct, handle), exactly("json_next: the reader is exhausted")));
        $(Assert.equal(Json.more(handle), false));
        $(Json.close(handle));
    });
}, {
    platformFns: NodePlatform,
});

describe("the reader accepts exactly what jsonSchemaFor describes", () => {
    // The invariant the contract rests on. The schema pins what the ENCODER
    // emits, so the encoder's own output is the accept corpus, and the decoder's
    // historic tolerances are the reject corpus.
    const RowType = StructType({
        id: IntegerType, name: StringType, at: DateTimeType, ratio: FloatType,
        ok: BooleanType, note: OptionType(StringType), tags: SetType(StringType),
        meta: DictType(StringType, IntegerType), raw: BlobType,
    });
    const rows: ValueTypeOf<typeof RowType>[] = [
        {
            id: 0n, name: "a", at: new Date(0), ratio: 1.5, ok: true, note: none,
            tags: new Set(["x", "y"]), meta: new Map([["k", 1n]]), raw: new Uint8Array([1, 255]),
        },
        {
            id: 9223372036854775807n, name: "é中\"\\\n", at: new Date("2026-02-28T23:59:59.999Z"),
            ratio: -0, ok: false, note: some("hi"), tags: new Set(), meta: new Map(),
            raw: new Uint8Array([]),
        },
        {
            id: -9223372036854775808n, name: "", at: new Date("1999-12-31T00:00:00.001Z"),
            ratio: Infinity, ok: true, note: some(""), tags: new Set(["z"]),
            meta: new Map([["a", -1n], ["b", 2n]]), raw: new Uint8Array([0]),
        },
    ];

    unitTest("everything the encoder emits reads back equal", () => {
        const T = ArrayType(RowType);
        const encoded = new TextDecoder().decode(encodeJSONFor(T)(rows));
        const reader = JsonReader.openText(encoded, "");
        const out: ValueTypeOf<typeof RowType>[] = [];
        while (reader.more()) out.push(reader.next(toEastTypeValue(RowType)) as ValueTypeOf<typeof RowType>);
        reader.close();
        assert.ok(equalFor(T)(out, rows), "the encoder's output must round-trip through the reader");
    });

    for (const [name, type, text] of REJECTED) {
        unitTest(`rejects ${name}`, () => {
            assert.equal(accepts(type, text), false, `${text} must not satisfy the contract`);
        });
    }

    unitTest("joins an escaped surrogate pair into one code point", () => {
        // A producer emitting ASCII-only JSON escapes an astral character as a
        // surrogate pair; every runtime must read it back as the character.
        const want = "a\u{1F600}b";
        assert.equal(read(StringType, JSON.stringify(want)), want);
        assert.equal(read(StringType, '"a\\ud83d\\ude00b"'), want);
    });

    unitTest("accepts February 29 in a leap year", () => {
        assert.ok(accepts(DateStruct, '{"v":"2024-02-29T00:00:00.000+00:00"}'));
    });

    unitTest("accepts an object's fields in any order", () => {
        // JSON objects are unordered, so the encoder's field order is not
        // something the contract can require.
        const T = StructType({ a: IntegerType, b: StringType });
        assert.ok(accepts(T, '{"a":"1","b":"x"}'));
        assert.ok(accepts(T, '{"b":"x","a":"1"}'));
    });

    unitTest("refuses a Variant whose payload precedes its tag", () => {
        // The payload cannot be typed before the case is known.
        const T = OptionType(IntegerType);
        assert.ok(accepts(T, '{"type":"some","value":"1"}'));
        assert.equal(accepts(T, '{"value":"1","type":"some"}'), false);
    });
});

describe("streaming and hardening", () => {
    unitTest("refuses a document nested deeper than the limit", () => {
        // Skipping past a value recurses per level, so a document of nothing
        // but brackets would otherwise exhaust the stack. east-c applies the
        // same bound, so every runtime refuses the same documents.
        const deep = "[".repeat(100_000) + "]".repeat(100_000);
        assert.throws(
            () => JsonReader.openText(`{"junk":${deep},"data":[]}`, "/data"),
            /nests deeper than 2048/);
    });

    unitTest("reports a pointer into the document, not just the root", () => {
        assert.throws(
            () => read(ArrayType(StructType({ v: IntegerType })), '[{"v":"1"},{"v":"x"}]'),
            /\/1\/v/);
    });

    unitTest("holds one row, not the document", () => {
        // The measurement runs in a child with the collector exposed: heap is
        // sampled after a forced collection, so it reflects what is retained
        // rather than what has yet to be swept.
        const path = join(tmpdir(), "json-stream-probe.json");
        const parts = ['{"data":['];
        for (let i = 0; i < 300_000; i++) parts.push(`${i ? "," : ""}{"id":"${i}","name":"row-${i}"}`);
        parts.push('],"meta":{"n":"300000"}}');
        writeFileSync(path, parts.join(""));
        try {
            const script = `
                import { JsonReader } from ${JSON.stringify(new URL("../src/json_reader.js", import.meta.url).href)};
                import { IntegerType, StringType, StructType, toEastTypeValue } from "@elaraai/east";
                import { statSync } from "node:fs";
                const T = toEastTypeValue(StructType({ id: IntegerType, name: StringType }));
                const bytes = statSync(${JSON.stringify(path)}).size;
                const settle = () => { globalThis.gc(); globalThis.gc(); return process.memoryUsage().heapUsed; };
                const before = settle();
                const r = JsonReader.openFile(${JSON.stringify(path)}, "/data");
                let n = 0, peak = 0, sum = 0n;
                while (r.more()) {
                    const row = r.next(T);
                    sum += row.id; n++;
                    if (n % 50000 === 0) peak = Math.max(peak, settle() - before);
                }
                r.close();
                console.log(JSON.stringify({ bytes, n, peak, sum: String(sum) }));
            `;
            const out = execFileSync(
                process.execPath,
                ["--expose-gc", "--input-type=module", "-e", script],
                { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8" });
            const { bytes, n, peak, sum } = JSON.parse(out.trim()) as
                { bytes: number; n: number; peak: number; sum: string };
            assert.equal(n, 300_000, "every row is read");
            assert.equal(sum, String((299_999n * 300_000n) / 2n), "every row is read correctly");
            assert.ok(
                peak < bytes / 8,
                `retained heap must not track the document (file ${bytes} bytes, retained ${peak})`);
        } finally {
            unlinkSync(path);
        }
    });

    unitTest("reads an envelope member that follows a large array", () => {
        const path = join(tmpdir(), "json-envelope-after.json");
        const parts = ['{"data":['];
        for (let i = 0; i < 20_000; i++) parts.push(`${i ? "," : ""}{"id":"${i}"}`);
        parts.push('],"meta":{"n":"20000"}}');
        writeFileSync(path, parts.join(""));
        try {
            const reader = JsonReader.openValueFile(path, "/meta");
            try {
                const meta = reader.readValue(toEastTypeValue(StructType({ n: IntegerType }))) as { n: bigint };
                assert.equal(meta.n, 20_000n);
            } finally {
                reader.close();
            }
        } finally {
            unlinkSync(path);
        }
    });

    unitTest("a type with no JSON form is refused when the expression is built", () => {
        assert.throws(
            () => East.function([StringType], IntegerType, ($, handle) =>
                (Json as unknown as { next: (t: unknown, h: unknown) => never }).next(
                    FunctionType([], IntegerType), handle)),
            /cannot read .* it has no JSON form/);
    });
});
