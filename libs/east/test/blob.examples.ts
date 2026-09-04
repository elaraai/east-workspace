/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, BlobType, BooleanType, StringType, IntegerType, FloatType, StructType, ArrayType, DictType, SetType, RefType, SortedMap, SortedSet, compareFor, encodeBeast2For, encodeBeast2PagedFor, ref, example } from "@elaraai/east";

// ---------------------------------------------------------------------------
// Construction & Access
// ---------------------------------------------------------------------------

export const blobSize = example({
    keywords: ["blob", "BlobType", "size", "length", "bytes"],
    description: "Get the size of a blob in bytes",
    fn: East.function([], IntegerType, ($) => {
        const b = $.const(Uint8Array.from([1, 2, 3]), BlobType);
        return b.size();
    }),
    inputs: [],
    returns: 3n,
});

export const blobGetUint8 = example({
    keywords: ["blob", "BlobType", "getUint8", "byte", "index", "access"],
    description: "Get a byte value from a blob by index",
    fn: East.function([], IntegerType, ($) => {
        const b = $.const(Uint8Array.from([10, 20, 30]), BlobType);
        return b.getUint8(1n);
    }),
    inputs: [],
    returns: 20n,
});

// ---------------------------------------------------------------------------
// UTF-8 Encoding/Decoding
// ---------------------------------------------------------------------------

export const blobEncodeUtf8 = example({
    keywords: ["blob", "BlobType", "encodeUtf8", "string", "utf8", "encoding"],
    description: "Encode a string to a UTF-8 blob",
    fn: East.function([], BlobType, ($) => {
        const s = $.const("Hello", StringType);
        return s.encodeUtf8();
    }),
    inputs: [],
    returns: Uint8Array.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]),
});

export const blobDecodeUtf8 = example({
    keywords: ["blob", "BlobType", "decodeUtf8", "string", "utf8", "decoding"],
    description: "Decode a UTF-8 blob to a string",
    fn: East.function([], StringType, ($) => {
        const b = $.const(Uint8Array.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]), BlobType);
        return b.decodeUtf8();
    }),
    inputs: [],
    returns: "Hello",
});

// ---------------------------------------------------------------------------
// UTF-16 Encoding/Decoding
// ---------------------------------------------------------------------------

export const blobEncodeUtf16 = example({
    keywords: ["blob", "BlobType", "encodeUtf16", "string", "utf16", "encoding"],
    description: "Encode a string to a UTF-16 blob with BOM",
    fn: East.function([], BlobType, ($) => {
        const s = $.const("Hello", StringType);
        return s.encodeUtf16();
    }),
    inputs: [],
    returns: Uint8Array.from([
        0xFF, 0xFE,
        0x48, 0x00,
        0x65, 0x00,
        0x6C, 0x00,
        0x6C, 0x00,
        0x6F, 0x00,
    ]),
});

export const blobDecodeUtf16 = example({
    keywords: ["blob", "BlobType", "decodeUtf16", "string", "utf16", "decoding"],
    description: "Decode a UTF-16 blob to a string",
    fn: East.function([], StringType, ($) => {
        const b = $.const(Uint8Array.from([
            0xFF, 0xFE,
            0x48, 0x00,
            0x65, 0x00,
            0x6C, 0x00,
            0x6C, 0x00,
            0x6F, 0x00,
        ]), BlobType);
        return b.decodeUtf16();
    }),
    inputs: [],
    returns: "Hello",
});

// ---------------------------------------------------------------------------
// Beast v1 Encoding/Decoding
// ---------------------------------------------------------------------------

export const blobEncodeBeastV1 = example({
    keywords: ["blob", "BlobType", "encodeBeast", "beast", "v1", "binary", "serialization"],
    description: "Encode a value to Beast v1 binary format",
    fn: East.function([], BlobType, ($) => {
        const value = $.const(42n, IntegerType);
        return East.Blob.encodeBeast(value, 'v1');
    }),
    inputs: [],
    returns: new Uint8Array([
        69, 97, 115, 116, 0, 234, 87, 255,
        6,
        128, 0, 0, 0, 0, 0, 0, 42,
    ]),
});

export const blobDecodeBeastV1 = example({
    keywords: ["blob", "BlobType", "decodeBeast", "beast", "v1", "binary", "deserialization"],
    description: "Decode a Beast v1 blob back to a typed value",
    fn: East.function([], IntegerType, ($) => {
        const value = $.const(42n, IntegerType);
        const encoded = $.let(East.Blob.encodeBeast(value, 'v1'));
        return encoded.decodeBeast(IntegerType, 'v1');
    }),
    inputs: [],
    returns: 42n,
});

// ---------------------------------------------------------------------------
// Beast v2 Encoding/Decoding
// ---------------------------------------------------------------------------

export const blobEncodeBeastV2 = example({
    keywords: ["blob", "BlobType", "encodeBeast", "beast", "v2", "binary", "serialization"],
    description: "Encode a value to Beast v2 binary format",
    fn: East.function([], BlobType, ($) => {
        const value = $.const(42n, IntegerType);
        return East.Blob.encodeBeast(value, 'v2');
    }),
    inputs: [],
    returns: new Uint8Array([
        137, 69, 97, 115, 116, 13, 10, 5,  // magic v5
        0,                                   // type section: kind 0 (structural)
        3, 0, 1, 2,                          //   byte_len=3, root=0, count=1, Integer
        1, 0,                                // source map: payload_len=1, no stacks
        0, 1, 1,                             // frame: codec none, 1 byte
        84,                                  // zigzag(42) = 84
    ]),
});

export const blobDecodeBeastV2 = example({
    keywords: ["blob", "BlobType", "decodeBeast", "beast", "v2", "binary", "deserialization"],
    description: "Decode a Beast v2 blob back to a typed value",
    fn: East.function([], IntegerType, ($) => {
        const value = $.const(42n, IntegerType);
        const encoded = $.let(East.Blob.encodeBeast(value, 'v2'));
        return encoded.decodeBeast(IntegerType, 'v2');
    }),
    inputs: [],
    returns: 42n,
});

// ---------------------------------------------------------------------------
// Beast v2 lazy paged open
// ---------------------------------------------------------------------------
//
// The blobs below are what the paged writers produce — segmented, indexed,
// self-contained — 30 rows in segments of 10, so a keyed read decodes one of
// three segments. An in-expression `East.Blob.encodeBeast` writes no index
// and takes the whole-decode fallback (blobOpenBeastIndexless).

const OpenRowType = StructType({ id: IntegerType, name: StringType });
const OpenTableType = DictType(IntegerType, OpenRowType);
const OpenTagsType = SetType(StringType);
const OpenRowsType = ArrayType(StringType);
const OpenCellsType = DictType(IntegerType, StructType({ r: RefType(IntegerType) }));

const OPEN_TABLE_BLOB = encodeBeast2PagedFor(OpenTableType, { batchSize: 10 })(
    new SortedMap(
        Array.from({ length: 30 }, (_, i): [bigint, { id: bigint; name: string }] => [BigInt(i), { id: BigInt(i), name: `row-${i}` }]),
        compareFor(IntegerType),
    ),
);
const OPEN_TAGS_BLOB = encodeBeast2PagedFor(OpenTagsType, { batchSize: 10 })(
    new SortedSet(Array.from({ length: 30 }, (_, i) => `tag-${String(i).padStart(4, "0")}`), compareFor(StringType)),
);
const OPEN_ROWS_BLOB = encodeBeast2PagedFor(OpenRowsType, { batchSize: 10 })(
    Array.from({ length: 30 }, (_, i) => `row-${i}`),
);
const OPEN_CELLS_BLOB = encodeBeast2PagedFor(OpenCellsType, { batchSize: 10 })(
    new SortedMap(
        Array.from({ length: 30 }, (_, i): [bigint, { r: ref<bigint> }] => [BigInt(i), { r: ref(BigInt(i * 10)) }]),
        compareFor(IntegerType),
    ),
);

export const blobOpenBeastDict = example({
    keywords: ["blob", "BlobType", "openBeast", "beast2", "lazy", "paged", "dict", "DictType", "index", "segment", "frozen"],
    description: "Open an indexed beast2 dict blob lazily and read a key without decoding the whole collection",
    fn: East.function([BlobType], IntegerType, ($, blob) => {
        const table = $.let(blob.openBeast(OpenTableType));
        return table.size().add(table.get(7n).id);
    }),
    inputs: [OPEN_TABLE_BLOB],
    returns: 37n,
});

export const blobOpenBeastDictForLoop = example({
    keywords: ["blob", "BlobType", "openBeast", "beast2", "lazy", "paged", "dict", "for", "loop", "stream", "segment"],
    description: "Iterate a lazily opened beast2 dict with $.for, one decoded segment at a time",
    fn: East.function([BlobType], IntegerType, ($, blob) => {
        const table = $.let(blob.openBeast(OpenTableType));
        const sum = $.let(0n);
        $.for(table, ($, row) => {
            $.assign(sum, sum.add(row.id));
        });
        return sum;
    }),
    inputs: [OPEN_TABLE_BLOB],
    returns: 435n,
});

export const blobOpenBeastArray = example({
    keywords: ["blob", "BlobType", "openBeast", "beast2", "lazy", "paged", "array", "ArrayType", "index"],
    description: "Open an indexed beast2 array blob lazily and read one element by index",
    fn: East.function([BlobType], StringType, ($, blob) => {
        const rows = $.let(blob.openBeast(OpenRowsType));
        return rows.get(25n);
    }),
    inputs: [OPEN_ROWS_BLOB],
    returns: "row-25",
});

export const blobOpenBeastSet = example({
    keywords: ["blob", "BlobType", "openBeast", "beast2", "lazy", "paged", "set", "SetType", "has", "membership"],
    description: "Open an indexed beast2 set blob lazily and test membership",
    fn: East.function([BlobType], BooleanType, ($, blob) => {
        const tags = $.let(blob.openBeast(OpenTagsType));
        return tags.has("tag-0007");
    }),
    inputs: [OPEN_TAGS_BLOB],
    returns: true,
});

export const blobOpenBeastIndexless = example({
    keywords: ["blob", "BlobType", "openBeast", "beast2", "encodeBeast", "index-less", "fallback", "whole decode", "frozen"],
    description: "openBeast on an index-less beast2 blob falls back to the whole frozen decode",
    fn: East.function([], IntegerType, ($) => {
        const values = $.const([1n, 2n, 3n], ArrayType(IntegerType));
        const encoded = $.let(East.Blob.encodeBeast(values, 'v2'));
        return encoded.openBeast(ArrayType(IntegerType)).get(1n);
    }),
    inputs: [],
    returns: 2n,
});

// The same table in the legacy v4 container: no paging index, so the open
// decodes it whole — after the header's type has been checked, like v5.
const OPEN_TABLE_V4_BLOB = encodeBeast2For(OpenTableType, { version: 4 })(
    new SortedMap(
        Array.from({ length: 30 }, (_, i): [bigint, { id: bigint; name: string }] => [BigInt(i), { id: BigInt(i), name: `row-${i}` }]),
        compareFor(IntegerType),
    ),
);

export const blobOpenBeastV4 = example({
    keywords: ["blob", "BlobType", "openBeast", "beast2", "v4", "legacy", "container", "whole decode", "frozen"],
    description: "openBeast on a legacy v4 container decodes it whole, frozen, with the same values",
    fn: East.function([BlobType], IntegerType, ($, blob) => {
        const table = $.let(blob.openBeast(OpenTableType));
        return table.size().add(table.get(7n).id);
    }),
    inputs: [OPEN_TABLE_V4_BLOB],
    returns: 37n,
});

export const blobOpenBeastRefShape = example({
    keywords: ["blob", "BlobType", "openBeast", "beast2", "RefType", "shape gate", "fallback", "whole decode"],
    description: "openBeast on a Ref-bearing element shape decodes whole, with the same semantics",
    fn: East.function([BlobType], IntegerType, ($, blob) => {
        const cells = $.let(blob.openBeast(OpenCellsType));
        return cells.get(3n).r.get();
    }),
    inputs: [OPEN_CELLS_BLOB],
    returns: 30n,
});

export const blobOpenBeastIs = example({
    keywords: ["blob", "BlobType", "openBeast", "beast2", "frozen", "is", "value type", "equality"],
    description: "Two lazily opened beast2 values compare by value under East.is, like every frozen collection",
    fn: East.function([BlobType], BooleanType, ($, blob) => {
        const first = $.let(blob.openBeast(OpenTableType));
        const second = $.let(blob.openBeast(OpenTableType));
        return East.is(first, second);
    }),
    inputs: [OPEN_TABLE_BLOB],
    returns: true,
});

// ---------------------------------------------------------------------------
// CSV Decoding
// ---------------------------------------------------------------------------

export const blobDecodeCsv = example({
    keywords: ["blob", "BlobType", "decodeCsv", "csv", "parsing", "tabular"],
    description: "Decode a CSV blob into an array of structs",
    fn: East.function([], ArrayType(StructType({ name: StringType, age: IntegerType })), ($) => {
        const csv = $.const(new TextEncoder().encode("name,age\nAlice,30\nBob,25"), BlobType);
        return csv.decodeCsv(StructType({ name: StringType, age: IntegerType }));
    }),
    inputs: [],
    returns: [{ name: "Alice", age: 30n }, { name: "Bob", age: 25n }],
});

export const blobDecodeCsvSkipShortRows = example({
    keywords: ["blob", "decodeCsv", "csv", "skipShortRows", "ragged", "short rows", "tolerance", "machine-generated", "ingestion"],
    description: "Decode a ragged CSV, skipping short rows instead of erroring",
    fn: East.function([], ArrayType(StructType({ name: StringType, age: IntegerType })), ($) => {
        // The second line is ragged (one field) — machine-generated exports
        // commonly carry a few; skipShortRows drops it instead of erroring
        const csv = $.const(new TextEncoder().encode("name,age\nAlice,30\nshort\nBob,25"), BlobType);
        return csv.decodeCsv(
            StructType({ name: StringType, age: IntegerType }),
            { skipShortRows: true }
        );
    }),
    inputs: [],
    returns: [{ name: "Alice", age: 30n }, { name: "Bob", age: 25n }],
});

export const blobDecodeCsvDefaults = example({
    keywords: ["blob", "decodeCsv", "csv", "defaults", "ingestion", "defensive", "unparseable", "fallback", "constant-fill", "absent column"],
    description: "Decode a defensive CSV with per-column defaults for unparseable fields and absent columns",
    fn: East.function([], ArrayType(StructType({ name: StringType, qty: FloatType, region: StringType })), ($) => {
        // qty carries garbage/empty fields; region is absent entirely —
        // defaults recover both without a python/TS post-map
        const csv = $.const(new TextEncoder().encode("name,qty\nAlice,3.5\nBob,n/a\nCarol,"), BlobType);
        return csv.decodeCsv(
            StructType({ name: StringType, qty: FloatType, region: StringType }),
            { defaults: new Map([["qty", "0.0"], ["region", "unassigned"]]) }
        );
    }),
    inputs: [],
    returns: [
        { name: "Alice", qty: 3.5, region: "unassigned" },
        { name: "Bob", qty: 0.0, region: "unassigned" },
        { name: "Carol", qty: 0.0, region: "unassigned" },
    ],
});

