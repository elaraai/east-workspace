/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import {
  East,
  Expr,
  NullType, BooleanType, IntegerType, FloatType, StringType, DateTimeType, BlobType,
  ArrayType, SetType, DictType, StructType, VariantType,
  variant,
  RecursiveType,
  ref,
  RefType,
  VectorType,
  MatrixType,
} from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";
import * as ex from "./blob.examples.js";

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
