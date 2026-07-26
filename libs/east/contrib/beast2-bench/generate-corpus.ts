/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * beast2 benchmark corpus generator (issue #416 / #417).
 *
 * Writes one **v4** blob per case to the corpus directory. v4 is the shared
 * interchange: every runtime can already read it, so the TS, east-c and
 * east-py benchmarks all seed from identical values and their numbers are
 * directly comparable. A companion `<name>.type.beast2` carries the case's
 * type (encoded under EastTypeValueType) for runtimes with no way to recover
 * a type from a blob — east-py needs it.
 *
 * Run: node dist/contrib/beast2-bench/generate-corpus.js
 * See README.md for the full three-runtime pipeline.
 */

import {
  East, ArrayType, StructType, StringType, IntegerType, FloatType, BooleanType,
  RecursiveType, VariantType, NullType, encodeBeast2For,
} from "../../src/index.js";
import type { EastType } from "../../src/index.js";
import { randomType, randomValueFor } from "../../src/fuzz.js";
import { toEastTypeValue, EastTypeValueType } from "../../src/type_of_type.js";
import { IRType } from "../../src/ir.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OUT = process.env.BEAST2_BENCH_DIR ?? join(tmpdir(), "beast2-bench");
mkdirSync(OUT, { recursive: true });

const cases: { name: string; v4Size: number }[] = [];

/** Encode one case as v4 + its type, or report why it was skipped. */
function add(name: string, type: EastType, value: unknown): void {
  let blob: Uint8Array;
  try {
    blob = encodeBeast2For(type, { version: 4 })(value as never);
  } catch (e) {
    console.error(`skip ${name}: ${(e as Error).message}`);
    return;
  }
  writeFileSync(join(OUT, `${name}.v4.beast2`), blob);
  writeFileSync(
    join(OUT, `${name}.type.beast2`),
    encodeBeast2For(EastTypeValueType, { version: 4 })(toEastTypeValue(type)),
  );
  cases.push({ name, v4Size: blob.length });
}

// ── Deep recursion: a linked list ───────────────────────────────────────
// Both encoders recurse per cell, so this also probes the depth ceiling:
// 500 is comfortable; 5000 overflows the JS stack in v4 AND v5 alike (at
// node's default stack — raise it with --stack-size to go deeper).
const ListType = RecursiveType((self) =>
  VariantType({ nil: NullType, cons: StructType({ head: IntegerType, tail: self }) }));
for (const depth of [500, 5000]) {
  let v: unknown = { type: "nil", value: null };
  for (let i = 0; i < depth; i++) v = { type: "cons", value: { head: BigInt(i), tail: v } };
  add(`recursive-list-${depth}`, ListType, v);
}

// ── Wide recursion: a tree, 8 children per node, depth 5 (~37k nodes) ────
const TreeType = RecursiveType((self) =>
  StructType({ value: StringType, children: ArrayType(self) }));
{
  const tree = (depth: number, breadth: number): unknown => ({
    value: `node-${depth}-${(depth * 2654435761 % 1000).toString(36)}`,
    children: depth === 0 ? [] : Array.from({ length: breadth }, () => tree(depth - 1, breadth)),
  });
  add("recursive-tree-d5b8", TreeType, tree(5, 8));
}

// ── Payload-dominated: 50k flat rows, with realistic string repetition ──
{
  const RowType = StructType({
    id: IntegerType, name: StringType, score: FloatType, active: BooleanType,
  });
  const rows = Array.from({ length: 50000 }, (_, i) => ({
    id: BigInt(i),
    name: `row-${i % 997}`,   // repeats: v4 dedups these, v5 leans on the codec
    score: (i % 100) / 3,
    active: i % 2 === 0,
  }));
  add("rows-50k", ArrayType(RowType), rows);
}

// ── Schema-dominated: a real IR program, and a type value ───────────────
{
  const fn = East.function([IntegerType, IntegerType], IntegerType, ($, a, b) => {
    const s = $.let(a.add(b));
    const t = $.let(s.multiply(3n));
    return t.subtract(a);
  });
  add("ir-program", IRType, fn.toIR().ir);
}
{
  const T = StructType({
    a: IntegerType, b: StringType,
    c: ArrayType(StructType({ x: FloatType, y: ArrayType(StringType) })),
    d: TreeType,
  });
  add("type-value", EastTypeValueType as unknown as EastType, toEastTypeValue(T));
}

// ── Optional: UIComponentType, the largest schema in the platform ───────
// east-ui depends on east, never the reverse, so this is a RUNTIME-only
// import behind a computed specifier — present when east-ui is built,
// silently skipped otherwise. Never make this a static import.
{
  const uiEntry = process.env.EAST_UI_DIST
    ?? "../../../../east-ui/packages/east-ui/dist/src/index.js";
  try {
    const ui = await import(/* @vite-ignore */ uiEntry) as {
      UIComponentType: EastType;
      Text: (p: { children: string }) => unknown;
      VStack: (p: { children: unknown[] }) => unknown;
    };
    const fn = East.function([], ui.UIComponentType as never, () =>
      ui.VStack({ children: Array.from({ length: 40 }, (_, i) => ui.Text({ children: `row ${i}` })) }) as never);
    add("ui-component", ui.UIComponentType, East.compile(fn, [])());
  } catch {
    console.error("skip ui-component: east-ui not built (set EAST_UI_DIST to override)");
  }
}

// ── Fuzz corpus: random nested/recursive schemas, scaled up ─────────────
// randomType caps nesting at depth 3, so each case is an ARRAY of many
// random-typed elements: large values over genuinely varied schemas.
{
  let made = 0;
  for (let i = 0; made < 20 && i < 500; i++) {
    const elem = randomType(0, { includeRecursive: true, includeFunctions: false });
    let value: unknown[];
    try {
      const gen = randomValueFor(elem);
      value = Array.from({ length: 2000 }, () => gen());
    } catch { continue; }
    const before = cases.length;
    add(`fuzz-${String(made).padStart(2, "0")}`, ArrayType(elem), value);
    if (cases.length > before) made++;
  }
}

writeFileSync(join(OUT, "manifest.json"), JSON.stringify(cases, null, 2));
console.log(`corpus: ${cases.length} cases in ${OUT}`);
for (const c of cases) console.log(`  ${c.name.padEnd(22)} v4 ${String(c.v4Size).padStart(9)} B`);
