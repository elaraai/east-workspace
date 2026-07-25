/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * beast2 benchmark aggregator: reads whichever `<runtime>.json` result files
 * exist in the corpus directory and prints the comparison tables.
 *
 * Run: node dist/contrib/beast2-bench/report.js
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DIR = process.env.BEAST2_BENCH_DIR ?? join(tmpdir(), "beast2-bench");

type Row = Record<string, string | number>;

function load(file: string): Map<string, Row> {
  const path = join(DIR, file);
  if (!existsSync(path)) return new Map();
  const rows = JSON.parse(readFileSync(path, "utf8")) as Row[];
  return new Map(rows.map(r => [r["name"] as string, r]));
}

const runtimes: [string, Map<string, Row>][] = [
  ["TypeScript", load("ts.json")],
  ["east-c", load("c.json")],
  ["east-py", load("py.json")],
];
const baseline = load("ts-main.json");   // optional: an older build, for A/B

const VARIANTS = ["v4", "v5-none", "v5-deflate"];
const NAMED = ["rows-50k", "recursive-tree-d5b8", "recursive-list-500",
               "ui-component", "ir-program", "type-value"];

const ms = (v: unknown) => v === undefined ? "       —"
  : (v as number) >= 0.01 ? (v as number).toFixed(3).padStart(8) : (v as number).toFixed(4).padStart(8);
const bytes = (v: unknown) => v === undefined ? "        —" : (v as number).toLocaleString().padStart(9);

function table(title: string, data: Map<string, Row>, cases: string[]): void {
  if (data.size === 0) return;
  console.log(`\n### ${title}\n`);
  let hdr = "case".padEnd(22);
  for (const v of VARIANTS) hdr += ` | ${(v + " enc").padStart(9)} ${(v + " size").padStart(10)} ${(v + " dec").padStart(9)}`;
  console.log(hdr);
  console.log("-".repeat(hdr.length));
  for (const name of cases) {
    const r = data.get(name);
    if (!r) { console.log(`${name.padEnd(22)} | (not measured)`); continue; }
    let line = name.padEnd(22);
    for (const v of VARIANTS) line += ` | ${ms(r[`${v}_enc`])} ${bytes(r[`${v}_size`])} ${ms(r[`${v}_dec`])}`;
    console.log(line);
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

/** Median of `variant / v4` for one measured field, across the fuzz cases. */
function summarize(label: string, data: Map<string, Row>, cases: string[]): void {
  for (const field of ["enc", "size", "dec"] as const) {
    for (const v of ["v5-none", "v5-deflate"]) {
      const rs: number[] = [];
      for (const name of cases) {
        const r = data.get(name);
        const a = r?.[`${v}_${field}`] as number | undefined;
        const b = r?.[`v4_${field}`] as number | undefined;
        if (a && b && b > 0) rs.push(a / b);
      }
      if (!rs.length) continue;
      const m = median(rs);
      console.log(`  ${label.padEnd(11)} ${v.padEnd(11)} ${field.padEnd(5)} median ${m.toFixed(2)}x vs v4` +
        `  (range ${Math.min(...rs).toFixed(2)}–${Math.max(...rs).toFixed(2)}x, n=${rs.length})`);
    }
  }
}

console.log("=".repeat(96));
console.log("beast2 v4 vs v5 — encode time (ms) / encoded size (B) / decode time (ms)");
console.log("=".repeat(96));

for (const [label, data] of runtimes) table(`${label} — named cases`, data, NAMED);

const fuzz = [...(runtimes[0]![1].keys())].filter(n => n.startsWith("fuzz-")).sort();
if (fuzz.length) {
  console.log(`\n### Fuzz corpus (${fuzz.length} random nested/recursive schemas)\n`);
  console.log("v5 relative to v4 — lower is better for v5:");
  for (const [label, data] of runtimes) if (data.size) summarize(label, data, fuzz);
}

if (baseline.size) {
  console.log("\n### A/B against EAST_DIST baseline (ts-main.json), same v4 format\n");
  console.log("case".padEnd(22) + " | " + "base dec".padStart(10) + " " + "new dec".padStart(10) + " | speedup");
  console.log("-".repeat(60));
  for (const name of [...NAMED, ...fuzz]) {
    const a = baseline.get(name), b = runtimes[0]![1].get(name);
    const ad = a?.["v4_dec"] as number | undefined, bd = b?.["v4_dec"] as number | undefined;
    if (!ad || !bd) continue;
    console.log(`${name.padEnd(22)} | ${ad.toFixed(4).padStart(10)} ${bd.toFixed(4).padStart(10)} | ${(ad / bd).toFixed(2)}x`);
  }
}
