/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/* The shared fixture of decoded weights (#1129): the checked-in bytes every
 * runtime holds its pager's cache to. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ArrayType, BlobType, EAST_CAPTURES_SYMBOL, IntegerType, StructType, decodeBeast2, equalFor, openBeast2PagesFor, type RuntimeContext } from "../src/index.js";
import { pagedWeightCases, pagedWeightsBytes } from "./paged-weights.fixture.js";

const FIXTURE_FILE = new URL("../../test/fixtures/paged-weights.beast2", import.meta.url);

describe("paged weights fixture", () => {
  test("the checked-in bytes are current", () => {
    if (!equalFor(BlobType)(new Uint8Array(readFileSync(FIXTURE_FILE)), pagedWeightsBytes())) {
      throw new Error(
        "test/fixtures/paged-weights.beast2 is not what test/paged-weights.fixture.ts makes now: " +
        "run `make paged-weights` in libs/east and commit the file",
      );
    }
  });

  test("each case's blob is an indexed Array of one segment, holding its one value", () => {
    for (const { name, blob } of pagedWeightCases()) {
      const { type, value } = decodeBeast2(blob);
      assert.equal(type.type, "Array", name);
      assert.equal((value as unknown[]).length, 1, name);
      assert.equal(openBeast2PagesFor(type)(blob).segmentCount, 1, name);
    }
  });

  test("the Struct holding one Array twice decodes to one Array, met twice", () => {
    const shared = pagedWeightCases().find(({ name }) => name === "Struct holding one Array twice");
    assert.ok(shared !== undefined);
    const Pair = StructType({ a: ArrayType(IntegerType), b: ArrayType(IntegerType) });
    const { value } = decodeBeast2(shared.blob);
    const [pair] = value as { a: bigint[]; b: bigint[] }[];
    assert.ok(pair !== undefined && equalFor(Pair)(pair, { a: [1n, 2n], b: [1n, 2n] }));
    // The same object, not an equal one: what the case's weight counts once.
    assert.ok(Object.is(pair.a, pair.b), "the blob holds the Array once, and a REF to it");
  });

  test("the Function's captured Array decodes as the one the Struct's other field holds, in either order", () => {
    for (const name of ["Struct of a Function capturing an Array, then the Array", "Struct of an Array, then a Function capturing it"]) {
      const captured = pagedWeightCases().find((c) => c.name === name);
      assert.ok(captured !== undefined, name);
      const [row] = decodeBeast2(captured.blob).value as { f: () => bigint; a: bigint[] }[];
      assert.ok(row !== undefined && equalFor(ArrayType(IntegerType))(row.a, [1n, 2n]), name);
      assert.equal(row.f(), 2n, name);
      const captures = (row.f as unknown as { [EAST_CAPTURES_SYMBOL]: RuntimeContext })[EAST_CAPTURES_SYMBOL];
      assert.ok(Object.is(Object.values(captures)[0]?.value, row.a), `${name}: the blob holds the Array once, and a REF to it`);
    }
  });
});
