/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The parallel frame writer (issue #763), held to the serial algorithm.
 *
 * A pooled writer puts the same frames on the wire in the same order, so the
 * one thing that could move is the SEGMENTATION: the paged encoder sizes each
 * batch from the bytes emitted so far, and with frames still deflating on
 * workers those bytes are only known within bounds. The encoder decides at
 * both bounds and settles when they disagree. The oracle below is the serial
 * algorithm as it stood before #763 — a writer that never pools, refined from
 * the bytes its sink actually received — and every case must match it byte
 * for byte: at a target that pins the element cap (bounds always agree) and at
 * targets small enough that the refinement is live on every batch (bounds
 * often disagree).
 *
 * Throughput is printed under `EAST_POOL_BENCH=1`, never asserted.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ArrayType, DictType, IntegerType, StringType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap } from "../../../index.js";
import {
  Beast2Writer,
  BEAST2_PAGED_BATCH_DEFAULT,
  decodeBeast2For,
  encodeBeast2PagedFor,
} from "../index.js";
import { configureFramePool, framePool } from "./frame-pool.js";

/** xorshift32 — a fixed stream, so a failure reproduces exactly. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
}

/** Strings of widely varying width — the running average moves, so the
 *  refinement is exercised. Well past the pool's 8 MiB start threshold. */
function strings(n: number, seed: number): string[] {
  const next = rng(seed);
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const width = 8 + (next() % 1400);
    let s = "";
    for (let k = 0; k < width; k++) s += String.fromCharCode(97 + (next() % 26));
    out[i] = s;
  }
  return out;
}

/** The serial paged encode exactly as it stood before #763. */
function serialPaged<T>(type: Parameters<typeof encodeBeast2PagedFor>[0], items: T[], makeBatch: (items: T[]) => unknown, target: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const probeN = Math.min(16, items.length);
  let next = BEAST2_PAGED_BATCH_DEFAULT;
  if (probeN > 0) {
    let scratch = 0;
    const probe = new Beast2Writer(type, (b) => { scratch += b.length; });
    const header = scratch;
    probe.write(makeBatch(items.slice(0, probeN)) as never);
    const avg = Math.max(1, (scratch - header) / probeN);
    next = Math.max(1, Math.min(BEAST2_PAGED_BATCH_DEFAULT, Math.floor(target / avg)));
  }
  const writer = new Beast2Writer(type, (b) => { chunks.push(b); bytes += b.length; });
  const header = bytes;
  let written = 0;
  for (let i = 0; i < items.length;) {
    const j = Math.min(items.length, i + next);
    writer.write(makeBatch(items.slice(i, j)) as never);
    written += j - i;
    i = j;
    const avg = Math.max(1, (bytes - header) / written);
    next = Math.max(1, Math.min(BEAST2_PAGED_BATCH_DEFAULT, Math.floor(target / avg)));
  }
  writer.finish();
  const out = new Uint8Array(bytes);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

/** Resolves after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Chunks joined into one buffer. */
function concat(chunks: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const c of chunks) length += c.length;
  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

/** First differing index, or -1. */
function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

describe("beast2 v5 parallel frame writer", () => {
  const TARGETS = [2 * 1024 * 1024, 64 * 1024, 4096];

  test("a pooled Array encode is byte-identical to the serial algorithm", () => {
    const items = strings(24_000, 0x5eed);
    const type = ArrayType(StringType);
    for (const target of TARGETS) {
      const pooled = encodeBeast2PagedFor(type, { targetSegmentBytes: target })(items);
      const serial = serialPaged(type, items, (batch) => batch, target);
      assert.equal(firstDifference(pooled, serial), -1, `target ${target}: pooled and serial bytes differ`);
    }
  });

  test("a pooled Dict encode is byte-identical to the serial algorithm, and decodes", () => {
    const values = strings(20_000, 0xd1c7);
    const cmp = compareFor(IntegerType);
    const entries = values.map((v, i) => [BigInt(i * 3), v] as [bigint, string]);
    const type = DictType(IntegerType, StringType);
    const value = new SortedMap(entries, cmp);
    for (const target of TARGETS) {
      const pooled = encodeBeast2PagedFor(type, { targetSegmentBytes: target })(value);
      const serial = serialPaged(type, entries, (batch) => new Map(batch), target);
      assert.equal(firstDifference(pooled, serial), -1, `target ${target}: pooled and serial bytes differ`);
      if (target === TARGETS[0]) {
        const decoded = decodeBeast2For(type)(pooled);
        assert.equal(decoded.size, entries.length);
        assert.equal(decoded.get(3n * 777n), values[777]);
      }
    }
  });

  test("the pool is created on a multi-core Node host", () => {
    // Informational context for the identity tests above: on a single-core
    // runner the writer frames inline and they still hold, trivially.
    const pool = framePool();
    if (pool !== null) assert.ok(pool.workers >= 2);
  });

  test("reports throughput when asked", { skip: process.env.EAST_POOL_BENCH !== "1" }, () => {
    const items = strings(60_000, 0xbe7c);
    const type = ArrayType(StringType);
    framePool(); // start-up is once per process; keep it out of the timing
    const t0 = performance.now();
    const serial = serialPaged(type, items, (batch) => batch, 2 * 1024 * 1024);
    const t1 = performance.now();
    const pooled = encodeBeast2PagedFor(type)(items);
    const t2 = performance.now();
    console.log(`  paged encode of ${(serial.length / 1e6).toFixed(1)} MB: serial ${(t1 - t0).toFixed(0)} ms, ` +
      `pooled ${(t2 - t1).toFixed(0)} ms (${((t1 - t0) / (t2 - t1)).toFixed(2)}x on ${framePool()?.workers ?? 1} workers), ` +
      `identical: ${firstDifference(serial, pooled) === -1}`);
  });

  test("an idle pool retires its workers, and the next pooled encode starts a new pool", async (t) => {
    const before = framePool();
    if (before === null) {
      t.skip("no frame pool on this host — frames are written inline");
      return;
    }
    const previous = configureFramePool({ idleMs: 50 });
    try {
      const type = ArrayType(StringType);
      const items = strings(24_000, 0x1d1e);
      const target = 64 * 1024;
      const serial = serialPaged(type, items, (batch) => batch, target);
      assert.equal(firstDifference(encodeBeast2PagedFor(type, { targetSegmentBytes: target })(items), serial), -1);

      // The check runs on a timer, so wait for the retirement rather than for
      // a fixed time — a loaded host delays timers.
      const deadline = Date.now() + 10_000;
      while (framePool() === before && Date.now() < deadline) await sleep(25);
      assert.notEqual(framePool(), before, "the idle pool retired and a new one started");
      assert.equal(
        firstDifference(encodeBeast2PagedFor(type, { targetSegmentBytes: target })(items), serial),
        -1,
        "the new pool writes the same bytes",
      );
    } finally {
      configureFramePool(previous);
    }
  });

  test("a writer that outlives an idle retirement frames on the new pool, byte-identically", async (t) => {
    const pool = framePool();
    if (pool === null) {
      t.skip("no frame pool on this host — frames are written inline");
      return;
    }
    // A shorter wait too: if the writer handed frames to the retired workers,
    // this fails in seconds rather than a minute — yet far longer than any
    // healthy frame takes on a loaded runner.
    const previous = configureFramePool({ idleMs: 50, waitTimeoutMs: 10_000 });
    try {
      const type = ArrayType(StringType);
      const items = strings(24_000, 0x0a7e);
      const batches = (from: number, to: number): string[][] => {
        const out: string[][] = [];
        for (let i = from; i < to; i += 500) out.push(items.slice(i, Math.min(to, i + 500)));
        return out;
      };
      // A long-lived writer (an emit sink between batches) goes quiet with
      // nothing in flight, long enough for its pool to retire.
      const chunks: Uint8Array[] = [];
      const writer = new Beast2Writer(type, (b) => { chunks.push(b); }, { parallel: true });
      for (const batch of batches(0, 16_000)) writer.write(batch);
      writer.settle();
      const deadline = Date.now() + 10_000;
      while (framePool() === pool && Date.now() < deadline) await sleep(25);
      assert.notEqual(framePool(), pool, "the quiet pool retired");

      for (const batch of batches(16_000, items.length)) writer.write(batch);
      writer.finish();
      const inlineChunks: Uint8Array[] = [];
      const inline = new Beast2Writer(type, (b) => { inlineChunks.push(b); });
      for (const batch of batches(0, items.length)) inline.write(batch);
      inline.finish();
      assert.equal(firstDifference(concat(chunks), concat(inlineChunks)), -1, "the writer's stream is the inline stream");
      assert.notEqual(framePool(), null, "no worker was lost along the way");
    } finally {
      configureFramePool(previous);
    }
  });

  // LAST in this file: losing a worker abandons the process's pool, so every
  // encode after it in this process frames inline.
  test("a lost frame worker fails its frame instead of hanging, and the process frames inline after", async (t) => {
    const pool = framePool();
    if (pool === null) {
      t.skip("no frame pool on this host — frames are written inline");
      return;
    }
    const type = ArrayType(StringType);
    const items = strings(24_000, 0x1057);
    const batches = (from: number, to: number): string[][] => {
      const out: string[][] = [];
      for (let i = from; i < to; i += 500) out.push(items.slice(i, Math.min(to, i + 500)));
      return out;
    };
    // A parallel writer already framing on the pool — well past the pool's
    // start threshold — with nothing in flight when the worker is lost.
    const survivorChunks: Uint8Array[] = [];
    const survivor = new Beast2Writer(type, (b) => { survivorChunks.push(b); }, { parallel: true });
    for (const batch of batches(0, 16_000)) survivor.write(batch);
    survivor.settle();

    const logical = new Uint8Array(64 * 1024).fill(0x61);
    assert.ok(pool.submit(logical, "deflate").take().length > 0, "a live worker builds the frame");

    // A worker that dies without reporting: the thread is gone, the frame it
    // was handed stays pending. Only this wait is shortened — a healthy frame
    // on a loaded runner must never be mistaken for a lost one.
    await pool.terminateWorkers();
    const previous = configureFramePool({ waitTimeoutMs: 200 });
    try {
      const orphan = pool.submit(logical, "deflate");
      const started = Date.now();
      assert.throws(() => orphan.take(), /a frame worker stopped responding — its thread was lost/);
      assert.ok(Date.now() - started < 10_000, "the configured wait applies, not the minute-long default");
    } finally {
      configureFramePool(previous);
    }
    assert.equal(framePool(), null, "the process frames inline from then on");

    // The surviving writer follows the process inline rather than handing
    // frames to the abandoned pool, and its stream is the inline stream.
    for (const batch of batches(16_000, items.length)) survivor.write(batch);
    survivor.finish();
    const inlineChunks: Uint8Array[] = [];
    const inline = new Beast2Writer(type, (b) => { inlineChunks.push(b); });
    for (const batch of batches(0, items.length)) inline.write(batch);
    inline.finish();
    assert.equal(firstDifference(concat(survivorChunks), concat(inlineChunks)), -1, "a writer that outlives the loss writes the inline bytes");

    // ...and a new encode writes exactly the serial bytes.
    const target = 64 * 1024;
    assert.equal(
      firstDifference(encodeBeast2PagedFor(type, { targetSegmentBytes: target })(items), serialPaged(type, items, (batch) => batch, target)),
      -1,
      "inline framing after the loss is byte-identical to the serial algorithm",
    );
  });
});
