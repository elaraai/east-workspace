/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The parallel frame writer (issue #763), held to the inline writer.
 *
 * A pooled writer deflates frames on worker threads and puts them on the wire
 * in submission order, assigning index offsets as they land. Where segments
 * fall is decided from the elements alone, never from bytes emitted, so the
 * oracle is simply the same elements through a writer that never pools: every
 * case must match it byte for byte, across a pool's retirement and a worker's
 * loss. The pool's peak memory is pinned at two output sizes (#841), and a
 * worker's failure never ends its process.
 *
 * Throughput is printed under `EAST_POOL_BENCH=1`, never asserted.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArrayType, DictType, IntegerType, StringType } from "../../../types.js";
import { compareFor } from "../../../comparison.js";
import { SortedMap } from "../../../index.js";
import {
  Beast2ElementWriter,
  Beast2Writer,
  decodeBeast2For,
  encodeBeast2PagedFor,
  type Beast2Segment,
} from "../index.js";
import { BufferWriter } from "../../binary-utils.js";
import { configureFramePool, framePool } from "./frame-pool.js";
import { DeflateScratch } from "./deflate.js";
import { FRAME_HEADER_MAX, writeFrame, writeFrameInto } from "./frames.js";

/** A pooled writer framing `count` rows of the shape #841 measured: the child
 *  prints its peak resident memory. It runs from a file: workers inherit the
 *  process's options, and an `--input-type` among them stops a worker loading
 *  its own file. */
const POOL_CHILD = `
import { readFileSync } from 'node:fs';
const [beast2Url, typesUrl, count] = process.argv.slice(2);
const { Beast2ElementWriter, configureFramePool } = await import(beast2Url);
const { DictType, IntegerType, StringType, StructType } = await import(typesUrl);
// Two workers, as a runner granted two threads has.
configureFramePool({ workers: 2 });
const type = DictType(StringType, StructType({ id: IntegerType, name: StringType }));
const writer = new Beast2ElementWriter(type, () => {}, { parallel: true });
for (let i = 0; i < Number(count); i++) {
  writer.add(['key' + String(i).padStart(9, '0'), { id: BigInt(i), name: 'name ' + i }]);
}
writer.finish();
const peak = /VmHWM:\\s+(\\d+) kB/.exec(readFileSync('/proc/self/status', 'utf8'));
console.log(JSON.stringify({ peakKiB: Number(peak[1]) }));
`;

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

/** Strings of widely varying width, well past the pool's 8 MiB start
 *  threshold in total. */
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

/** The elements through an element writer that never pools. */
function inlineEncode(type: ConstructorParameters<typeof Beast2ElementWriter>[0], elements: Iterable<unknown>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const writer = new Beast2ElementWriter(type, (b) => { chunks.push(b); });
  for (const element of elements) writer.add(element);
  writer.finish();
  return concat(chunks);
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
  test("a pooled Array encode is byte-identical to the inline one", () => {
    const items = strings(24_000, 0x5eed);
    const type = ArrayType(StringType);
    assert.equal(firstDifference(encodeBeast2PagedFor(type)(items), inlineEncode(type, items)), -1, "pooled and inline bytes differ");
  });

  test("a pooled Dict encode is byte-identical to the inline one, and decodes", () => {
    const values = strings(20_000, 0xd1c7);
    const cmp = compareFor(IntegerType);
    const entries = values.map((v, i) => [BigInt(i * 3), v] as [bigint, string]);
    const type = DictType(IntegerType, StringType);
    const pooled = encodeBeast2PagedFor(type)(new SortedMap(entries, cmp));
    assert.equal(firstDifference(pooled, inlineEncode(type, entries)), -1, "pooled and inline bytes differ");
    const decoded = decodeBeast2For(type)(pooled);
    assert.equal(decoded.size, entries.length);
    assert.equal(decoded.get(3n * 777n), values[777]);
  });

  test("a pooled writer hands over the segments an inline one does", () => {
    const items = strings(24_000, 0x5e95);
    const type = ArrayType(StringType);
    const segmentsOf = (parallel: boolean): Beast2Segment[] => {
      const segments: Beast2Segment[] = [];
      const writer = new Beast2ElementWriter(type, { segment: (segment) => { segments.push(segment); } }, { parallel });
      for (const item of items) writer.add(item);
      writer.finish();
      return segments;
    };
    const pooled = segmentsOf(true);
    const inline = segmentsOf(false);
    assert.equal(pooled.length, inline.length);
    for (let i = 0; i < inline.length; i++) {
      assert.equal(firstDifference(pooled[i]!.blob, inline[i]!.blob), -1, `segment ${i}`);
      assert.equal(pooled[i]!.count, inline[i]!.count);
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
    const serial = inlineEncode(type, items);
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
      const serial = inlineEncode(type, items);
      assert.equal(firstDifference(encodeBeast2PagedFor(type)(items), serial), -1);

      // The check runs on a timer, so wait for the retirement rather than for
      // a fixed time — a loaded host delays timers.
      const deadline = Date.now() + 10_000;
      while (framePool() === before && Date.now() < deadline) await sleep(25);
      assert.notEqual(framePool(), before, "the idle pool retired and a new one started");
      assert.equal(
        firstDifference(encodeBeast2PagedFor(type)(items), serial),
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

  test("a runner's grant caps the pool: one thread frames inline, two start two workers", (t) => {
    if (framePool() === null) {
      t.skip("no frame pool on this host — frames are written inline");
      return;
    }
    const type = ArrayType(StringType);
    const items = strings(24_000, 0x9a7e);
    const serial = inlineEncode(type, items);
    const previous = configureFramePool({ workers: 1 });
    try {
      assert.equal(framePool(), null, "a grant of one thread frames inline");
      assert.equal(firstDifference(encodeBeast2PagedFor(type)(items), serial), -1);
      configureFramePool({ workers: 2 });
      assert.equal(framePool()?.workers, 2, "a grant of two starts two workers");
      assert.equal(firstDifference(encodeBeast2PagedFor(type)(items), serial), -1);
    } finally {
      configureFramePool(previous);
    }
  });

  test("a frame written in place is the frame writeFrame writes", () => {
    const scratch = new DeflateScratch();
    const next = rng(0xf7a3);
    for (const logical of [
      new Uint8Array(0),
      new Uint8Array(63).fill(1),
      new Uint8Array(64).fill(1),
      new Uint8Array(4096).map(() => next() & 0xff),
      new TextEncoder().encode(strings(2_000, 0xf00d).join("")),
    ]) {
      for (const codec of ["none", "deflate"] as const) {
        const expected = new BufferWriter();
        writeFrame(expected, logical, codec);
        const target = new Uint8Array(logical.length + FRAME_HEADER_MAX);
        const length = writeFrameInto(target, logical, codec, scratch);
        assert.equal(Buffer.compare(target.subarray(0, length), expected.toUint8Array()), 0, `${logical.length} bytes, ${codec}`);
      }
    }
  });

  test("holds the frames in flight and nothing more: the same peak at three times the output",
    { skip: process.platform === "linux" ? false : "the peak is read from /proc" }, (t) => {
      if (framePool() === null) {
        t.skip("no frame pool on this host — frames are written inline");
        return;
      }
      const beast2Url = new URL("../index.js", import.meta.url).href;
      const typesUrl = new URL("../../../types.js", import.meta.url).href;
      const dir = mkdtempSync(join(tmpdir(), "east-frame-pool-"));
      const script = join(dir, "child.mjs");
      writeFileSync(script, POOL_CHILD);
      const peakKiB = (count: number): number => {
        const child = spawnSync(process.execPath, [
          // A young generation that never grows, so what differs is what the
          // pool holds (see e3-core's door-memory spec).
          "--min-semi-space-size=1", "--max-semi-space-size=1",
          script, beast2Url, typesUrl, String(count),
        ], { encoding: "utf8" });
        if (child.status !== 0) {
          throw new Error(`the child ended ${child.status ?? child.signal}: ${child.stderr.slice(-2_000)}`);
        }
        return (JSON.parse(child.stdout.trim().split("\n").pop()!) as { peakKiB: number }).peakKiB;
      };
      try {
        // Both well past the rows the writer frames inline before it starts
        // the pool, and the workers' first frames. A pool that held what it
        // framed grew by 55 MiB between them (#841).
        const small = peakKiB(400_000);
        const large = peakKiB(1_200_000);
        const peaks = `${Math.round(small / 1024)} MiB framing 400K rows, ${Math.round(large / 1024)} MiB framing 1.2M`;
        t.diagnostic(peaks);
        assert.ok(large - small < 16 * 1024, peaks);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

  test("a process started with --input-type frames on the pool", (t) => {
    if (framePool() === null) {
      t.skip("no frame pool on this host — frames are written inline");
      return;
    }
    // Workers that inherited the option could not load their file.
    const logical = new Uint8Array(64 * 1024).fill(0x61);
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      const { configureFramePool, framePool } = await import(${JSON.stringify(new URL("./frame-pool.js", import.meta.url).href)});
      configureFramePool({ workers: 2 });
      const pool = framePool();
      const frame = pool?.submit(new Uint8Array(${logical.length}).fill(0x61), 'deflate').take();
      console.log(JSON.stringify({ pooled: pool !== null, bytes: frame?.length ?? 0 }));
    `], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr.slice(-2_000));
    const expected = new BufferWriter();
    writeFrame(expected, logical, "deflate");
    assert.deepEqual(JSON.parse(child.stdout), { pooled: true, bytes: expected.size });
  });

  test("a worker that fails abandons the pool instead of ending its process", (t) => {
    if (framePool() === null) {
      t.skip("no frame pool on this host — frames are written inline");
      return;
    }
    // Every worker the child's pool starts reports it loaded, then throws.
    const failing = "import { workerData } from 'node:worker_threads';" +
      " const cells = new Int32Array(workerData.ready);" +
      " Atomics.store(cells, workerData.index, 1); Atomics.notify(cells, workerData.index);" +
      " throw new Error('a worker that fails');";
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      const threads = process.getBuiltinModule('node:worker_threads');
      const Worker = threads.Worker;
      threads.Worker = class extends Worker {
        constructor(_script, options) {
          super(new URL('data:text/javascript,' + encodeURIComponent(${JSON.stringify(failing)})), options);
        }
      };
      const { configureFramePool, framePool } = await import(${JSON.stringify(new URL("./frame-pool.js", import.meta.url).href)});
      configureFramePool({ workers: 2 });
      const started = framePool() !== null;
      const deadline = Date.now() + 10_000;
      while (framePool() !== null && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
      console.log(JSON.stringify({ started, abandoned: framePool() === null }));
    `], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr.slice(-2_000));
    assert.deepEqual(JSON.parse(child.stdout), { started: true, abandoned: true });
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

    // ...and a new encode writes exactly the inline bytes.
    assert.equal(
      firstDifference(encodeBeast2PagedFor(type)(items), inlineEncode(type, items)),
      -1,
      "framing after the loss is byte-identical to the inline writer",
    );
  });
});
