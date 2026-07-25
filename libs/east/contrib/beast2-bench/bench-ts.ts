/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * beast2 TypeScript benchmark: encode time, encoded size, decode time for
 * each container variant, over the shared corpus.
 *
 * Each case is seeded by decoding its v4 blob, so TS, east-c and east-py all
 * measure the same values. Set EAST_DIST to point at another build of east
 * (e.g. a worktree of main) to A/B two versions; HAS_V5=0 restricts it to v4
 * for builds that predate the v5 container.
 *
 * Run: node dist/contrib/beast2-bench/bench-ts.js
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DIST = process.env.EAST_DIST ?? "../../src/index.js";
const { decodeBeast2, encodeBeast2For, decodeBeast2For } =
  await import(/* @vite-ignore */ DIST) as typeof import("../../src/index.js");

const DIR = process.env.BEAST2_BENCH_DIR ?? join(tmpdir(), "beast2-bench");
const OUT = process.env.OUT ?? join(DIR, "ts.json");
const HAS_V5 = process.env.HAS_V5 !== "0";
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 400);

/** Run `fn` for at least BUDGET_MS and return the mean ms per call. */
function timeIt(fn: () => unknown): number {
  fn(); fn();
  let iters = 0;
  const t0 = process.hrtime.bigint();
  const budget = BigInt(BUDGET_MS) * 1000000n;
  let elapsed: bigint;
  do { fn(); iters++; elapsed = process.hrtime.bigint() - t0; } while (elapsed < budget);
  return Number(elapsed) / iters / 1e6;
}

const names = readdirSync(DIR)
  .filter(f => f.endsWith(".v4.beast2") && !f.includes(".type."))
  .map(f => f.replace(".v4.beast2", ""))
  .sort();

const results: Record<string, unknown>[] = [];
for (const name of names) {
  const v4blob = new Uint8Array(readFileSync(join(DIR, `${name}.v4.beast2`)));
  let type, value;
  try {
    ({ type, value } = decodeBeast2(v4blob));
  } catch (e) { console.error(`skip ${name}: ${(e as Error).message}`); continue; }

  const row: Record<string, unknown> = { name };
  const variants: [string, Record<string, unknown> | undefined][] = HAS_V5
    ? [["v4", { version: 4 }],
       ["v5-none", { version: 5, codec: "none" }],
       ["v5-deflate", { version: 5, codec: "deflate" }]]
    : [["v4", undefined]];

  for (const [label, opts] of variants) {
    try {
      const enc = encodeBeast2For(type, opts as never);
      const blob = enc(value);
      const dec = decodeBeast2For(type);
      dec(blob);
      row[`${label}_size`] = blob.length;
      row[`${label}_enc`] = timeIt(() => enc(value));
      row[`${label}_dec`] = timeIt(() => dec(blob));
    } catch (e) {
      console.error(`skip ${name}/${label}: ${(e as Error).message}`);
    }
  }
  results.push(row);
  process.stderr.write(".");
}
process.stderr.write("\n");
writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log(`wrote ${results.length} rows to ${OUT}`);
