/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * CRC-32, the checksum each zip entry is named by: the check values every
 * implementation of the ISO-HDLC CRC gives, and the table-driven checksum held
 * to Node's zlib at every length, over views, and going on from an earlier
 * value — with zlib, where `crc32` is zlib's, and in a process that has no way
 * to zlib, where it is the table's.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { crc32 as zlibCrc32 } from "node:zlib";
import { crc32, crc32Pure } from "./crc32.js";

/** Bytes of a fixed pseudo-random stream, so a failure reproduces exactly. */
function bytesOf(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    out[i] = state & 0xff;
  }
  return out;
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("crc32", () => {
  test("gives the ISO-HDLC check values", () => {
    for (const checksum of [crc32, crc32Pure]) {
      assert.equal(checksum(new Uint8Array(0)), 0, checksum.name);
      assert.equal(checksum(text("123456789")), 0xcbf43926, checksum.name);
      assert.equal(checksum(text("The quick brown fox jumps over the lazy dog")), 0x414fa339, checksum.name);
      assert.equal(checksum(new Uint8Array(32)), 0x190a55ad, checksum.name);
      assert.equal(checksum(new Uint8Array(32).fill(0xff)), 0xff6cab0b, checksum.name);
    }
  });

  test("the table's agrees with zlib's at every length, and on large inputs", () => {
    for (let length = 0; length <= 600; length++) {
      const bytes = bytesOf(length, 0x5eed + length);
      assert.equal(crc32Pure(bytes), zlibCrc32(bytes), `length ${length}`);
    }
    for (const bytes of [bytesOf(3 * 1024 * 1024 + 7, 0xabc), new Uint8Array(1 << 20).fill(0x61)]) {
      assert.equal(crc32Pure(bytes), zlibCrc32(bytes), `${bytes.length} bytes`);
    }
  });

  test("checks a view by its own bytes, not its buffer's", () => {
    const buffer = bytesOf(1000, 0x77);
    for (const [start, end] of [[0, 1000], [1, 999], [37, 512], [500, 500], [999, 1000]] as const) {
      const view = buffer.subarray(start, end);
      assert.equal(crc32Pure(view), zlibCrc32(view), `[${start}, ${end})`);
      assert.equal(crc32(view), zlibCrc32(view), `[${start}, ${end})`);
    }
  });

  test("goes on from the CRC-32 of the bytes before, to that of the whole", () => {
    const bytes = bytesOf(300, 0x1234);
    const whole = zlibCrc32(bytes);
    for (let split = 0; split <= bytes.length; split++) {
      const [head, tail] = [bytes.subarray(0, split), bytes.subarray(split)];
      assert.equal(crc32Pure(tail, crc32Pure(head)), whole, `table, split at ${split}`);
      assert.equal(crc32(tail, crc32(head)), whole, `split at ${split}`);
    }
  });

  test("is zlib's where the runtime has zlib, and the table's where it has none", () => {
    const inputs = [new Uint8Array(0), text("123456789"), bytesOf(4096, 0x99), bytesOf(70_000, 0x42)];
    assert.deepEqual(inputs.map((bytes) => crc32(bytes)), inputs.map((bytes) => zlibCrc32(bytes)));

    // A process with no way to Node's builtins, as a browser has none: the
    // checksum is computed here, and gives zlib's answers.
    const child = [
      "delete process.getBuiltinModule;",
      `const { crc32 } = await import(${JSON.stringify(new URL("./crc32.js", import.meta.url).href)});`,
      "let text = '';",
      "process.stdin.setEncoding('utf8');",
      "for await (const chunk of process.stdin) text += chunk;",
      "const inputs = JSON.parse(text).map((bytes) => Uint8Array.from(bytes));",
      "process.stdout.write(JSON.stringify({ zlib: typeof process.getBuiltinModule, crcs: inputs.map((bytes) => crc32(bytes)) }));",
    ].join("\n");
    const ran = spawnSync(process.execPath, ["--input-type=module", "-e", child], {
      input: JSON.stringify(inputs.map((bytes) => [...bytes])),
      encoding: "utf8",
    });
    assert.equal(ran.status, 0, ran.stderr);
    const report = JSON.parse(ran.stdout) as { zlib: string; crcs: number[] };
    assert.equal(report.zlib, "undefined", "the child had no way to zlib");
    assert.deepEqual(report.crcs, inputs.map((bytes) => zlibCrc32(bytes)));
  });
});
