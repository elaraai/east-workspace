/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Reproduction for issue #756: a task emitting Dict entries whose keys arrive
// out of order, each value a struct of nested arrays of small structs built by
// the body. Generates IR, a paged input, and the unit `east-c exec` runs them
// in, the entries going to a dict output's sorted runs in out/.
//
//   node contrib/bench_756.mjs <outdir> [rows] [arrays] [items]
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import {
  ArrayType, East, FloatType, FunctionType, IntegerType, NullType, StringType, StructType, UnitType,
  encodeBeast2For, encodeBeast2PagedFor, encodeEastIR, none, variant,
} from '@elaraai/east';

const out = process.argv[2] ?? 'bench_756';
const NROWS = Number(process.argv[3] ?? 60000);
const NARR = Number(process.argv[4] ?? 8);
const NITEMS = Number(process.argv[5] ?? 12);

const ItemT = StructType({ x: IntegerType, y: FloatType, tag: StringType });
const PartT = StructType({ name: StringType, items: ArrayType(ItemT) });
const RowT = StructType({ key: IntegerType, label: StringType, parts: ArrayType(PartT) });
const ValT = StructType({ label: StringType, total: FloatType, parts: ArrayType(PartT) });
const emitPair = FunctionType([IntegerType, ValT], NullType);

const main = East.function([ArrayType(RowT), emitPair], NullType, ($, rows, emit) => {
  $.for(rows, ($, row) => {
    const total = $.let(0.0);
    const parts = $.let(row.parts.map(($, p) => {
      const items = $.let(p.items.map(($, it) => {
        $.assign(total, total.add(it.y));
        return { x: it.x.add(1n), y: it.y.multiply(2.0), tag: it.tag };
      }));
      return { name: p.name, items };
    }));
    $(emit(row.key, { label: row.label, total, parts }));
  });
});

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'ir.beast2'), encodeEastIR(main.toIR()));

let seed = 11;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
// keys: a fixed permutation so emission order is not ascending
const keys = Array.from({ length: NROWS }, (_, i) => BigInt(i));
for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
const rows = [];
for (let i = 0; i < NROWS; i++) {
  const parts = [];
  for (let a = 0; a < NARR; a++) {
    const items = [];
    for (let k = 0; k < NITEMS; k++) items.push({ x: BigInt(k), y: rnd(), tag: `t${k % 7}` });
    parts.push({ name: `part-${a}`, items });
  }
  rows.push({ key: keys[i], label: `row-${i}`, parts });
}
writeFileSync(join(out, 'rows.beast2'), encodeBeast2PagedFor(ArrayType(RowT))(rows));
writeFileSync(join(out, 'unit.beast2'), encodeBeast2For(UnitType)({
  work: variant('run', { program: 'ir.beast2', inputs: ['rows.beast2'], output: variant('dict', { dir: 'out', merge: none }) }),
  platforms: [],
  threads: BigInt(availableParallelism()),
  result: 'result.beast2',
}));
console.log(`wrote ${out}: ${NROWS} rows, ${NARR} arrays x ${NITEMS} items each`);
