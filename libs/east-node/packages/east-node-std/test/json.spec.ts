/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { describe, test as unitTest } from "node:test";
import assert from "node:assert/strict";
import {
    ArrayType, BlobType, BooleanType, DateTimeType, DictType, FloatType, IntegerType,
    OptionType, SetType, StringType, StructType,
    East, FunctionType, encodeJSONFor, equalFor, none, some, toEastTypeValue,
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

describeEast("Json platform functions", (test) => {
    Assert.examples(test, {
        jsonReadArray: ex.jsonReadArray,
        jsonReadPointer: ex.jsonReadPointer,
        jsonValueEnvelope: ex.jsonValueEnvelope,
        jsonReadText: ex.jsonReadText,
        jsonReadObjectAsEntries: ex.jsonReadObjectAsEntries,
    });

    test("open of a missing path throws", $ => {
        $(Assert.throws(Json.open("/definitely/does/not/exist-679.json", ""), /json_open/));
    });

    test("a pointer that does not resolve throws, naming the member", $ => {
        const path = $.let(East.value(join(tmpdir(), "json-missing-pointer.json")));
        $(FileSystem.writeFile(path, '{"data":[]}'));
        $(Assert.throws(Json.open(path, "/nope"), /no member "nope"/));
    });

    test("pointing at a scalar rather than a container throws", $ => {
        const path = $.let(East.value(join(tmpdir(), "json-scalar-pointer.json")));
        $(FileSystem.writeFile(path, '{"data":"not a container"}'));
        $(Assert.throws(Json.open(path, "/data"), /expected an array or object to iterate/));
    });

    test("a row that violates the contract throws, naming its pointer", $ => {
        const path = $.let(East.value(join(tmpdir(), "json-bad-row.json")));
        $(FileSystem.writeFile(path, '[{"id":"1"},{"id":"not-an-integer"}]'));
        const handle = $.let(Json.open(path, ""));
        $(Json.next(StructType({ id: IntegerType }), handle));
        $(Assert.throws(Json.next(StructType({ id: IntegerType }), handle), /\/1\/id/));
        $(Json.close(handle));
    });

    test("a handle cannot be used after it is closed", $ => {
        const path = $.let(East.value(join(tmpdir(), "json-closed.json")));
        $(FileSystem.writeFile(path, "[]"));
        const handle = $.let(Json.open(path, ""));
        $(Json.close(handle));
        $(Assert.throws(Json.more(handle), /no open JSON reader/));
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

    const IntStruct = StructType({ v: IntegerType });
    const DateStruct = StructType({ v: DateTimeType });
    const BlobStruct = StructType({ v: BlobType });

    // Each row is a payload the historic decoder tolerates and the published
    // contract does not. BigInt() swallows every one of the integer spellings.
    const rejected: [string, EastType, string][] = [
        ["Integer as hexadecimal", IntStruct, '{"v":"0x10"}'],
        ["Integer as binary", IntStruct, '{"v":"0b101"}'],
        ["Integer as octal", IntStruct, '{"v":"0o17"}'],
        ["Integer padded with spaces", IntStruct, '{"v":" 7 "}'],
        ["Integer with a leading zero", IntStruct, '{"v":"007"}'],
        ["Integer with an explicit plus", IntStruct, '{"v":"+7"}'],
        ["negative zero", IntStruct, '{"v":"-0"}'],
        ["Integer as a JSON number", IntStruct, '{"v":7}'],
        ["Integer past the i64 ceiling", IntStruct, '{"v":"9223372036854775808"}'],
        ["an unsigned 64-bit id", IntStruct, '{"v":"18446744073709551615"}'],
        ["DateTime with a Z suffix", DateStruct, '{"v":"2022-06-29T13:43:00.123Z"}'],
        ["DateTime with a numeric offset", DateStruct, '{"v":"2022-06-29T13:43:00.123+05:00"}'],
        ["DateTime without milliseconds", DateStruct, '{"v":"2022-06-29T13:43:00+00:00"}'],
        ["a day February does not have", DateStruct, '{"v":"2026-02-30T00:00:00.000+00:00"}'],
        ["a day April does not have", DateStruct, '{"v":"2026-04-31T00:00:00.000+00:00"}'],
        ["February 29 in a common year", DateStruct, '{"v":"2025-02-29T00:00:00.000+00:00"}'],
        ["Blob in uppercase hex", BlobStruct, '{"v":"0xDEADBEEF"}'],
        ["Blob with an odd digit count", BlobStruct, '{"v":"0x123"}'],
        ["Blob without the 0x prefix", BlobStruct, '{"v":"deadbeef"}'],
        ["an unmodelled field", IntStruct, '{"v":"1","extra":1}'],
        ["a missing field", IntStruct, "{}"],
        ["a duplicated field", IntStruct, '{"v":"1","v":"2"}'],
    ];

    for (const [name, type, text] of rejected) {
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
                import { JsonReader } from ${JSON.stringify(fileURLToPath(new URL("../src/json_reader.js", import.meta.url)))};
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
