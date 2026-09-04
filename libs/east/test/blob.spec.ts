/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { East, StringType, BlobType, IntegerType, ArrayType, DictType, StructType, SortedMap, compareFor, encodeBeast2For, encodeBeast2PagedFor, none } from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import * as ex from "./blob.examples.js";

// An indexed, self-contained blob for the openBeast error paths: 30 rows in
// segments of 10 (the paged writers' shape).
const OpenRowType = StructType({ id: IntegerType, name: StringType });
const OpenTableType = DictType(IntegerType, OpenRowType);
const OPEN_TABLE_BLOB = encodeBeast2PagedFor(OpenTableType, { batchSize: 10 })(
  new SortedMap(
    Array.from({ length: 30 }, (_, i): [bigint, { id: bigint; name: string }] => [BigInt(i), { id: BigInt(i), name: `row-${i}` }]),
    compareFor(IntegerType),
  ),
);
// The same table as a legacy v4 container: its header names the type too.
const OPEN_TABLE_V4_BLOB = encodeBeast2For(OpenTableType, { version: 4 })(
  new SortedMap(
    Array.from({ length: 30 }, (_, i): [bigint, { id: bigint; name: string }] => [BigInt(i), { id: BigInt(i), name: `row-${i}` }]),
    compareFor(IntegerType),
  ),
);

await describe("Blob", (test) => {
  assert.examples(test, { blobSize: ex.blobSize, blobGetUint8: ex.blobGetUint8 });

  test("Array ops", $ => {
    $(assert.equal(East.value(Uint8Array.from([]), BlobType).size(), 0n));
    $(assert.equal(East.value(Uint8Array.from([1, 2, 3])).size(), 3n));
    $(assert.equal(East.value(Uint8Array.from([1, 2, 3])).getUint8(0n), 1n));
  });

  assert.examples(test, { blobEncodeUtf8: ex.blobEncodeUtf8, blobDecodeUtf8: ex.blobDecodeUtf8 });

  test("UTF-8 decoding/encoding", $ => {
    const hello_str = $.let(East.value("Hello", StringType));
    const hello_blob = $.let(East.value(Uint8Array.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]), BlobType));

    $(assert.equal(hello_str.encodeUtf8(), hello_blob));
    $(assert.equal(hello_blob.decodeUtf8(), hello_str));

    const invalid_utf8_blob = $.let(East.value(Uint8Array.from([0xff, 0xfe, 0xfd]), BlobType));

    $(assert.throws(invalid_utf8_blob.decodeUtf8(), /Blob is not valid UTF-8/));
  });

  assert.examples(test, { blobEncodeUtf16: ex.blobEncodeUtf16, blobDecodeUtf16: ex.blobDecodeUtf16 });

  test("UTF-16 decoding/encoding", $ => {
    // Basic round-trip
    const hello_str = $.let(East.value("Hello", StringType));
    const hello_utf16_blob = $.let(East.value(
      Uint8Array.from([
        0xFF, 0xFE,       // BOM (LE)
        0x48, 0x00,       // 'H'
        0x65, 0x00,       // 'e'
        0x6C, 0x00,       // 'l'
        0x6C, 0x00,       // 'l'
        0x6F, 0x00,       // 'o'
      ]),
      BlobType
    ));

    $(assert.equal(hello_str.encodeUtf16(), hello_utf16_blob));
    $(assert.equal(hello_utf16_blob.decodeUtf16(), hello_str));

    // Emoji with surrogate pairs
    const emoji_str = $.let(East.value("A😀B", StringType));
    const emoji_utf16_blob = $.let(East.value(
      Uint8Array.from([
        0xFF, 0xFE,       // BOM (LE)
        0x41, 0x00,       // 'A'
        0x3D, 0xD8,       // high surrogate for 😀
        0x00, 0xDE,       // low surrogate for 😀
        0x42, 0x00,       // 'B'
      ]),
      BlobType
    ));

    $(assert.equal(emoji_str.encodeUtf16(), emoji_utf16_blob));
    $(assert.equal(emoji_utf16_blob.decodeUtf16(), emoji_str));

    // UTF-16 BE with BOM (auto-detect)
    const hello_be_blob = $.let(East.value(
      Uint8Array.from([
        0xFE, 0xFF,       // BOM (BE)
        0x00, 0x48,       // 'H'
        0x00, 0x65,       // 'e'
        0x00, 0x6C,       // 'l'
        0x00, 0x6C,       // 'l'
        0x00, 0x6F,       // 'o'
      ]),
      BlobType
    ));

    $(assert.equal(hello_be_blob.decodeUtf16(), hello_str));

    // UTF-16 LE without BOM (defaults to LE)
    const hello_no_bom_blob = $.let(East.value(
      Uint8Array.from([
        0x48, 0x00,       // 'H'
        0x65, 0x00,       // 'e'
        0x6C, 0x00,       // 'l'
        0x6C, 0x00,       // 'l'
        0x6F, 0x00,       // 'o'
      ]),
      BlobType
    ));

    $(assert.equal(hello_no_bom_blob.decodeUtf16(), hello_str));
  });

  assert.examples(test, {
    blobOpenBeastDict: ex.blobOpenBeastDict,
    blobOpenBeastDictForLoop: ex.blobOpenBeastDictForLoop,
    blobOpenBeastArray: ex.blobOpenBeastArray,
    blobOpenBeastSet: ex.blobOpenBeastSet,
    blobOpenBeastIndexless: ex.blobOpenBeastIndexless,
    blobOpenBeastRefShape: ex.blobOpenBeastRefShape, blobOpenBeastV4: ex.blobOpenBeastV4,
    blobOpenBeastIs: ex.blobOpenBeastIs,
  });

  test("openBeast served reads, missing keys, the wire type check and the frozen contract", $ => {
    const blob = $.const(OPEN_TABLE_BLOB, BlobType);
    const table = $.let(blob.openBeast(OpenTableType));
    $(assert.equal(table.size(), 30n));
    $(assert.equal(table.has(29n), true));
    $(assert.equal(table.has(30n), false));
    $(assert.equal(table.get(12n).name, "row-12"));
    $(assert.equal(table.tryGet(9999n), none));
    $(assert.equal(table.get(9999n, (_$, key) => ({ id: key, name: "missing" })).name, "missing"));
    $(assert.throws(table.get(9999n), /Dict does not contain key/));

    // The header names the wire type; another type is refused up front,
    // never decoded by the declared type — for a v4 container as well.
    $(assert.throws(blob.openBeast(ArrayType(IntegerType)), /cannot open a blob of type/));
    const v4 = $.const(OPEN_TABLE_V4_BLOB, BlobType);
    $(assert.throws(v4.openBeast(ArrayType(IntegerType)), /cannot open a blob of type/));
    $(assert.equal(v4.openBeast(OpenTableType).get(12n).name, "row-12"));

    // Frozen: the mutating builtins refuse with the uniform copy-first
    // message, and a copy is an ordinary mutable value.
    $(assert.throws(table.insert(99n, { id: 99n, name: "new" }), /cannot mutate a frozen value/));
    $(assert.throws(table.delete(0n), /cannot mutate a frozen value/));
    const copy = $.let(table.copy());
    $(copy.insert(99n, { id: 99n, name: "new" }));
    $(assert.equal(copy.size(), 31n));
    $(assert.equal(table.size(), 30n));
  });

  test("Equality method aliases", $ => {
    const b1 = East.value(Uint8Array.from([1, 2, 3]));

    // Test short aliases (eq, ne)
    $(assert.equal(b1.eq(Uint8Array.from([1, 2, 3])), true));
    $(assert.equal(b1.eq(Uint8Array.from([1, 2])), false));
    $(assert.equal(b1.ne(Uint8Array.from([1, 2])), true));
    $(assert.equal(b1.ne(Uint8Array.from([1, 2, 3])), false));

    // Test medium aliases (equal, notEqual)
    $(assert.equal(b1.equal(Uint8Array.from([1, 2, 3])), true));
    $(assert.equal(b1.notEqual(Uint8Array.from([1, 2])), true));
  });
});
