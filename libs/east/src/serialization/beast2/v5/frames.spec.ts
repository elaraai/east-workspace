/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The frame layer's synchronous inflate, which e3 inflates a zip's deflated
 * entries with too: to exactly the length it is told, through Node's zlib or
 * east's own inflate — including a stream of no bytes, which zlib cannot be
 * asked for.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, inflateRawSync as zlibInflateRawSync } from "node:zlib";
import { inflateRawSync } from "./frames.js";
import { inflateRawPure } from "./inflate.js";

describe("inflateRawSync", () => {
  test("inflates a stream of no bytes, which zlib takes no output limit for", () => {
    // What a zip writer deflates an empty entry to: one final fixed block.
    const empty = deflateRawSync(new Uint8Array(0));
    assert.deepEqual([...empty], [0x03, 0x00]);
    assert.throws(() => zlibInflateRawSync(empty, { maxOutputLength: 0 }), { code: "ERR_OUT_OF_RANGE" });
    assert.equal(inflateRawSync(empty, 0).byteLength, 0);
    assert.equal(inflateRawPure(empty, 0).byteLength, 0);
  });

  test("refuses a stream of bytes it is told inflates to none, or to more than it holds", () => {
    const deflated = deflateRawSync(new TextEncoder().encode("a zip entry's bytes"));
    assert.throws(() => inflateRawSync(deflated, 0), /past the declared 0 bytes/);
    assert.throws(() => inflateRawSync(deflated, 1000), /inflated to 19 bytes, header declared 1000/);
    assert.throws(() => inflateRawSync(deflateRawSync(new Uint8Array(0)), 1), /inflated to 0 bytes, header declared 1/);
  });

  test("gives zlib's bytes for every kind of block a zip writer deflates", () => {
    const text = new TextEncoder().encode("the same few words, again and again; ".repeat(400));
    const noise = new Uint8Array(70_000).map((_, i) => (i * 2654435761) >>> 24);
    for (const [bytes, level] of [[text, 0], [text, 1], [text, 9], [noise, 6], [new Uint8Array(1), 6]] as const) {
      const deflated = deflateRawSync(bytes, { level });
      // zlib gives a Buffer: both are compared as plain bytes.
      assert.deepEqual(new Uint8Array(inflateRawSync(deflated, bytes.byteLength)), new Uint8Array(zlibInflateRawSync(deflated)), `level ${level}, ${bytes.byteLength} bytes`);
      assert.deepEqual(inflateRawPure(deflated, bytes.byteLength), bytes, `level ${level}, ${bytes.byteLength} bytes, inflated here`);
    }
  });
});
