/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Beast2 cross-runtime byte-parity fixtures (issue #416).
 *
 * e3 content-addresses beast2 bytes, so one logical value must encode to
 * exactly one byte string — in every runtime. This suite pins those bytes for
 * the value shapes whose encodings have actually diverged between the TS, C
 * and Python backends, and asserts that decoding and re-encoding reproduces
 * them. It is exported to /tmp/east-test-ir and replayed by the east-c and
 * east-py compliance harnesses, so a runtime that disagrees fails here rather
 * than silently splitting an e3 object store across two hashes.
 *
 * Each fixture asserts two things:
 *   1. exact encoded bytes — cross-runtime parity;
 *   2. `encode(decode(encode(v))) == encode(v)` — round-trip stability, which
 *      is version-independent and so survives a container-version change.
 *
 * The shapes are chosen from real divergences, not for coverage:
 *   - Sets and Dicts, built out of order. East orders them by its total order;
 *     the TS decoder used to rebuild them as insertion-ordered `Set`/`Map`, so
 *     a decoded value re-encoded to different bytes than east-c's btrees did.
 *   - Containers of zero-width elements (`Array<Null>`, and `Array<Null>`
 *     inside a Dict). east-c and east-py assumed every element costs at least
 *     one byte and could not decode these at all.
 *   - Nested recursive types referenced from several positions — the shape
 *     whose type table stopped being canonical when rebuilt from the wire.
 *
 * This suite lives apart from blob.beast2.spec.ts deliberately: that file's
 * golden bytes embed its own source line numbers (serialized function
 * fixtures), so appending to it would shift and break them. Nothing here
 * serializes a function, so these bytes depend on no source location.
 *
 * Values are inline literals and expectations are East stdlib code — no host
 * helpers in or around East blocks (east/no-host-in-east-block,
 * no-module-scope-east-macro).
 */
import {
  East,
  NullType, IntegerType, StringType,
  ArrayType, SetType, DictType, StructType, VariantType, OptionType, RecursiveType,
  variant, some, none,
} from "../src/index.js";
import { describeEast as describe, assertEast as assert } from "./platforms.spec.js";

await describe("Blob (Beast v2 parity)", (test) => {
  // =========================================================================
  // Zero-width elements — every element costs 0 bytes
  // =========================================================================

  test("Beast v2 parity - Array<Null>", $ => {
    const empty = $.let(East.value([], ArrayType(NullType)));
    const encEmpty = $.let(East.Blob.encodeBeast(empty, 'v2'));
    $(assert.equal(East.str`${encEmpty}`, "0x89456173740d0a0500050102000a0001000002020000"));
    $(assert.equal(East.Blob.encodeBeast(encEmpty.decodeBeast(ArrayType(NullType), 'v2'), 'v2'), encEmpty));

    // Three nulls occupy no value bytes at all — only the count changes.
    const three = $.let(East.value([null, null, null], ArrayType(NullType)));
    const encThree = $.let(East.Blob.encodeBeast(three, 'v2'));
    $(assert.equal(East.str`${encThree}`, "0x89456173740d0a0500050102000a000100000303000300"));
    $(assert.equal(East.Blob.encodeBeast(encThree.decodeBeast(ArrayType(NullType), 'v2'), 'v2'), encThree));
  });

  test("Beast v2 parity - Dict<Integer, Array<Null>>", $ => {
    const value = $.let(East.value(
      new Map([[2n, [null, null]], [1n, []]]),
      DictType(IntegerType, ArrayType(NullType)),
    ));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v2'));
    $(assert.equal(East.str`${encoded}`, "0x89456173740d0a050009030402000a010b00020100000a0a00020200000400020000"));
    $(assert.equal(East.Blob.encodeBeast(encoded.decodeBeast(DictType(IntegerType, ArrayType(NullType)), 'v2'), 'v2'), encoded));
    // Keys come back in East order regardless of how the Dict was built.
    $(assert.equal(
      encoded.decodeBeast(DictType(IntegerType, ArrayType(NullType)), 'v2').toArray(($, _v, k) => k),
      [1n, 2n],
    ));
  });

  // =========================================================================
  // Set / Dict ordering — East's total order, not insertion order
  // =========================================================================

  test("Beast v2 parity - Set<String> built out of order", $ => {
    const value = $.let(East.value(new Set(["pear", "apple", "fig"]), SetType(StringType)));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v2'));
    // The string table holds "apple", "fig", "pear" — sorted, not as written.
    $(assert.equal(East.str`${encoded}`, "0x89456173740d0a0500050102010c0001000012120003056170706c6503666967047065617200"));
    $(assert.equal(East.Blob.encodeBeast(encoded.decodeBeast(SetType(StringType), 'v2'), 'v2'), encoded));
    $(assert.equal(encoded.decodeBeast(SetType(StringType), 'v2').toArray(), ["apple", "fig", "pear"]));
  });

  test("Beast v2 parity - Dict<String, Integer> built out of order", $ => {
    const value = $.let(East.value(
      new Map([["z", 26n], ["a", 1n], ["m", 13n]]),
      DictType(StringType, IntegerType),
    ));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v2'));
    $(assert.equal(East.str`${encoded}`, "0x89456173740d0a050007020301020b00010100000c0c0003016102016d1a017a3400"));
    $(assert.equal(East.Blob.encodeBeast(encoded.decodeBeast(DictType(StringType, IntegerType), 'v2'), 'v2'), encoded));
    $(assert.equal(
      encoded.decodeBeast(DictType(StringType, IntegerType), 'v2').toArray(($, _v, k) => k),
      ["a", "m", "z"],
    ));
  });

  test("Beast v2 parity - Set of structs orders by East's total order", $ => {
    const StructKey = StructType({ k: StringType, n: IntegerType });
    const value = $.let(East.value(
      new Set([{ k: "b", n: 2n }, { k: "a", n: 9n }, { k: "a", n: 1n }]),
      SetType(StructKey),
    ));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v2'));
    $(assert.equal(East.str`${encoded}`, "0x89456173740d0a05000e030401020902016b00016e010c020100000c0c000301610201611201620400"));
    $(assert.equal(East.Blob.encodeBeast(encoded.decodeBeast(SetType(StructKey), 'v2'), 'v2'), encoded));
    // Field-wise ordering: a/1 before a/9 before b/2.
    $(assert.equal(
      encoded.decodeBeast(SetType(StructKey), 'v2').toArray(($, s) => East.str`${s.k}/${s.n}`),
      ["a/1", "a/9", "b/2"],
    ));
  });

  test("Beast v2 parity - Sets nested inside Options", $ => {
    const value = $.let(East.value(
      [some(new Set(["b", "a"])), none, some(new Set([]))],
      ArrayType(OptionType(SetType(StringType))),
    ));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v2'));
    $(assert.equal(East.str`${encoded}`, "0x89456173740d0a050016040500010c010802046e6f6e650004736f6d65020a030100000f0f000301000201610162000001000000"));
    $(assert.equal(East.Blob.encodeBeast(encoded.decodeBeast(ArrayType(OptionType(SetType(StringType))), 'v2'), 'v2'), encoded));
  });

  // =========================================================================
  // Nested recursive types — the canonical type table
  // =========================================================================

  test("Beast v2 parity - a recursive type referenced from several positions", $ => {
    // TreeType names ListType from three positions and itself from two. Each
    // distinct sub-type must occupy exactly one type-table entry, however the
    // table was built — from the static type or rebuilt off the wire.
    const ListType = RecursiveType(self => VariantType({
      nil: NullType,
      cons: StructType({ head: IntegerType, tail: self }),
    }));
    const TreeType = RecursiveType(self => VariantType({
      leaf: ListType,
      node: StructType({ left: self, right: self, tag: ListType }),
    }));

    const value = $.let(East.value(
      variant("node", {
        left: variant("leaf", variant("cons", { head: 1n, tail: variant("cons", { head: 2n, tail: variant("nil", null) }) })),
        right: variant("leaf", variant("nil", null)),
        tag: variant("cons", { head: 1n, tail: variant("cons", { head: 2n, tail: variant("nil", null) }) }),
      }),
      TreeType,
    ));
    const encoded = $.let(East.Blob.encodeBeast(value, 'v2'));
    $(assert.equal(East.str`${encoded}`, "0x89456173740d0a050045000812071205020902046865616402047461696c0100080204636f6e7303036e696c040903046c656674000572696768740003746167010802046c65616601046e6f6465060100000e0e0100000200040100010002000401"));
    $(assert.equal(East.Blob.encodeBeast(encoded.decodeBeast(TreeType, 'v2'), 'v2'), encoded));
    $(assert.equal(encoded.decodeBeast(TreeType, 'v2'), value));
  });
});
