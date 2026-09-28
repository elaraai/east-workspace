/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * SHA-256, the name of every object a manifest directory holds: the FIPS
 * 180-4 vectors, pinned in east-c's `tests/test_sha256.c` as well, and
 * agreement with Node's own digest at every length across the padding
 * boundaries.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Hex } from "../index.js";

describe("sha256Hex", () => {
  test("matches the FIPS 180-4 vectors", () => {
    const of = (s: string): string => sha256Hex(new TextEncoder().encode(s));
    assert.equal(of(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert.equal(of("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert.equal(
      of("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    assert.equal(
      sha256Hex(new Uint8Array(1_000_000).fill(0x61)),
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });

  test("agrees with Node's digest at every length across the padding boundaries", () => {
    // Lengths 55, 56 and 64 are where the length field moves to a second
    // block, and where the rest is empty.
    let seed = 0x9e3779b9;
    for (let n = 0; n <= 300; n++) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        bytes[i] = seed >>> 24;
      }
      assert.equal(sha256Hex(bytes), createHash("sha256").update(bytes).digest("hex"), `length ${n}`);
    }
  });

  test("hashes a view by its own bytes, not its buffer's", () => {
    const buffer = new Uint8Array(200).map((_, i) => i);
    const view = buffer.subarray(37, 150);
    assert.equal(sha256Hex(view), createHash("sha256").update(view).digest("hex"));
  });
});
