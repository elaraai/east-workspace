/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 v5 cross-runtime decode fixtures (issue #416).
 *
 * The pinned blobs below were produced by the TS v5 encoder (uncompressed
 * frames, except the deflate fixture). Every runtime's decode entry points
 * dispatch on the magic version byte, so `blob.decodeBeast(T, 'v2')` must
 * decode them identically on the TS, C, and Python backends — this suite is
 * exported to /tmp/east-test-ir and replayed by the east-c and east-py
 * compliance harnesses. The same segmented-stream bytes are also pinned (as
 * hex) in libs/east's v5/index.spec.ts, east-py's test_beast2_v5.py, and
 * east-c's test_beast2_hardening.c, where encoders are byte-checked as well.
 *
 * This suite lives apart from blob.beast2.spec.ts deliberately: that file's
 * golden bytes embed its own source line numbers (serialized function
 * fixtures), so appending to it would shift and break them.
 *
 * Fixture bytes are inline `new Uint8Array([...])` literals at each use site
 * and computed expectations are East stdlib code — no host helpers in or
 * around East blocks (east/no-host-in-east-block, no-module-scope-east-macro).
 */
import {
  East,
  IntegerType, FloatType, StringType, BlobType,
  ArrayType, SetType, DictType, StructType, OptionType,
  some,
} from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";

await describe("Blob (Beast v5 decode)", (test) => {
  test("Beast v5 - array of strings", $ => {
    const blob = $.let(new Uint8Array([
      0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05,             // magic v5
      0x00, 0x05, 0x01, 0x02, 0x01, 0x0a, 0x00,                   // structural type section: Array<String>
      0x01, 0x00,                                                 // empty source map
      0x00, 0x09, 0x09,                                           // frame: codec none, 9 bytes
      0x00, 0x03, 0x01, 0x61, 0x01, 0x62, 0x01, 0x63, 0x00,       // NEW, n=3, "a" "b" "c", terminator
    ]), BlobType);
    $(assert.equal(blob.getUint8(7n), 0x05n)); // format version 5
    $(assert.equal(blob.decodeBeast(ArrayType(StringType), 'v2'), ["a", "b", "c"]));
  });

  test("Beast v5 - set of integers", $ => {
    const blob = $.let(new Uint8Array([
      0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05,             // magic v5
      0x00, 0x05, 0x01, 0x02, 0x02, 0x0c, 0x00,                   // structural type section: Set<Integer>
      0x01, 0x00,                                                 // empty source map
      0x00, 0x06, 0x06,                                           // frame: codec none, 6 bytes
      0x00, 0x03, 0x02, 0x04, 0x06, 0x00,                         // NEW, n=3, zigzag 1 2 3, terminator
    ]), BlobType);
    $(assert.equal(blob.decodeBeast(SetType(IntegerType), 'v2'), new Set([1n, 2n, 3n])));
  });

  test("Beast v5 - dict keeps entries", $ => {
    const blob = $.let(new Uint8Array([
      0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05,             // magic v5
      0x00, 0x07, 0x02, 0x03, 0x01, 0x02, 0x0b, 0x00, 0x01,       // structural type section: Dict<String, Integer>
      0x01, 0x00,                                                 // empty source map
      0x00, 0x09, 0x09,                                           // frame: codec none, 9 bytes
      0x00, 0x02, 0x01, 0x61, 0x02, 0x01, 0x62, 0x04, 0x00,       // NEW, n=2, "a"→1 "b"→2, terminator
    ]), BlobType);
    $(assert.equal(
      blob.decodeBeast(DictType(StringType, IntegerType), 'v2'),
      new Map([["a", 1n], ["b", 2n]]),
    ));
  });

  test("Beast v5 - struct with nested array", $ => {
    const blob = $.let(new Uint8Array([
      0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05,             // magic v5
      0x00, 0x16, 0x03, 0x04, 0x01, 0x03, 0x0a, 0x01, 0x09,       // structural type section:
      0x02, 0x04, 0x6e, 0x61, 0x6d, 0x65, 0x00, 0x06, 0x73,       //   Struct{name: String,
      0x63, 0x6f, 0x72, 0x65, 0x73, 0x02,                         //          scores: Array<Float>}
      0x01, 0x00,                                                 // empty source map
      0x00, 0x15, 0x15,                                           // frame: codec none, 21 bytes
      0x01, 0x78,                                                 // name = "x"
      0x00, 0x02,                                                 // scores: NEW, n=2
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf8, 0x3f,             // 1.5
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0xc0,             // -2.5
      0x00,                                                       // terminator
    ]), BlobType);
    $(assert.equal(blob.decodeBeast(StructType({ name: StringType, scores: ArrayType(FloatType) }), 'v2'), { name: "x", scores: [1.5, -2.5] }));
  });

  test("Beast v5 - option variant", $ => {
    const blob = $.let(new Uint8Array([
      0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05,             // magic v5
      0x00, 0x12, 0x02, 0x03, 0x00, 0x02, 0x08, 0x02, 0x04,       // structural type section:
      0x6e, 0x6f, 0x6e, 0x65, 0x00, 0x04, 0x73, 0x6f, 0x6d,       //   Variant{none: Null,
      0x65, 0x01,                                                 //           some: Integer}
      0x01, 0x00,                                                 // empty source map
      0x00, 0x02, 0x02, 0x01, 0x54,                               // frame: codec none — some(42)
    ]), BlobType);
    $(assert.equal(blob.decodeBeast(OptionType(IntegerType), 'v2'), some(42n)));
  });

  test("Beast v5 - deflate-compressed frame", $ => {
    // 100 integers (i % 10) in one raw-DEFLATE frame: every runtime's inflate
    // must accept this stream (produced by zlib; miniz/py-zlib compatible).
    const blob = $.let(new Uint8Array([
      0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05,             // magic v5
      0x00, 0x05, 0x01, 0x02, 0x02, 0x0a, 0x00,                   // structural type section: Array<Integer>
      0x01, 0x00,                                                 // empty source map
      0x01, 0x67, 0x10,                                           // frame: codec deflate, 103 → 16 bytes
      0x63, 0x48, 0x61, 0x60, 0x62, 0x61, 0xe3, 0xe0, 0xe2,       // raw DEFLATE payload
      0xe1, 0x13, 0x10, 0xa2, 0x21, 0x0b, 0x00,
    ]), BlobType);
    const expected = $.let(East.Array.generate(100n, IntegerType, ($, i) => i.modulo(10n)));
    $(assert.equal(blob.decodeBeast(ArrayType(IntegerType), 'v2'), expected));
  });

  test("Beast v5 - segmented stream with index and footer", $ => {
    // Written by the streaming writer: batches ["a","b"] + ["c"], tag /
    // segment / terminator frames, self-contained index, footer.
    const blob = $.let(new Uint8Array([
      0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05,             // magic v5
      0x00, 0x05, 0x01, 0x02, 0x01, 0x0a, 0x00,                   // structural type section: Array<String>
      0x01, 0x00,                                                 // empty source map
      0x00, 0x01, 0x01, 0x00,                                     // tag frame: NEW
      0x00, 0x05, 0x05, 0x02, 0x01, 0x61, 0x01, 0x62,             // segment frame: n=2, "a" "b"
      0x00, 0x03, 0x03, 0x01, 0x01, 0x63,                         // segment frame: n=1, "c"
      0x00, 0x01, 0x01, 0x00,                                     // terminator frame
      0x01, 0x02, 0x15, 0x02, 0x08, 0x01,                         // index: self-contained, 2 segments
      0x27, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,             // footer: index offset 39
      0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0xf5,             // footer magic
    ]), BlobType);
    $(assert.equal(blob.decodeBeast(ArrayType(StringType), 'v2'), ["a", "b", "c"]));
  });

  test("Beast v5 - unknown container versions fail loudly", $ => {
    // Version byte 0x06 is unassigned: decode must throw, not misparse.
    const blob = $.let(new Uint8Array([
      0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x06, 0x00, 0x00, 0x00,
    ]), BlobType);
    $(assert.throws(blob.decodeBeast(ArrayType(StringType), 'v2')));
  });

  test("Beast v5 - truncated stream fails loudly", $ => {
    // The array-of-strings fixture cut mid-frame: strict decoders reject it.
    const blob = $.let(new Uint8Array([
      0x89, 0x45, 0x61, 0x73, 0x74, 0x0d, 0x0a, 0x05,
      0x00, 0x05, 0x01, 0x02, 0x01, 0x0a, 0x00, 0x01, 0x00,
      0x00, 0x09, 0x09, 0x00, 0x03, 0x01,
    ]), BlobType);
    $(assert.throws(blob.decodeBeast(ArrayType(StringType), 'v2')));
  });
});
