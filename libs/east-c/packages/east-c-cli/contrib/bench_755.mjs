/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Reproduction for issue #755: a long fold whose inner element runs several
// spliced East.function phases, each reading a Dict keyed by a two-string
// struct and touching struct fields. Generates IR + paged inputs for east-c.
//
//   node contrib/bench_755.mjs <outdir> [rows] [inner] [keys]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArrayType, DictType, East, FloatType, IntegerType, SortedMap, StringType, StructType,
  compareFor, encodeBeast2PagedFor, encodeEastIR,
} from '@elaraai/east';

const out = process.argv[2] ?? 'bench_755';
const NROWS = Number(process.argv[3] ?? 30000);
const NINNER = Number(process.argv[4] ?? 16);
const NKEYS = Number(process.argv[5] ?? 50000);

const KeyT = StructType({ k1: StringType, k2: StringType });
const InnerT = StructType({ a: FloatType, b: IntegerType, k1: StringType, k2: StringType, w: FloatType });
const RowT = StructType({ id: IntegerType, k1: StringType, k2: StringType, scale: FloatType, inner: ArrayType(InnerT) });
const TableT = DictType(KeyT, FloatType);

const phaseA = East.function([TableT, InnerT, FloatType], FloatType, ($, table, e, acc) => {
  const w = $.let(table.get({ k1: e.k1, k2: e.k2 }, () => 0.0));
  return acc.add(w.multiply(e.a));
});
const phaseB = East.function([TableT, InnerT, FloatType], FloatType, ($, table, e, acc) => {
  const w = $.let(table.get({ k1: e.k2, k2: e.k1 }, () => 1.0));
  const v = $.let(e.w.multiply(w));
  return acc.add(v).subtract(e.b.toFloat().multiply(0.001));
});
const phaseC = East.function([TableT, InnerT, FloatType, FloatType], FloatType, ($, table, e, acc, scale) => {
  const w = $.let(table.get({ k1: e.k1, k2: e.k1 }, () => 0.5));
  return acc.add(w.multiply(scale).multiply(e.a));
});

const main = East.function([ArrayType(RowT), TableT], FloatType, ($, rows, table) => {
  const total = $.let(0.0);
  $.for(rows, ($, row) => {
    const rowAcc = $.let(0.0);
    const scale = $.let(row.scale);
    $.for(row.inner, ($, e) => {
      $.assign(rowAcc, phaseA(table, e, rowAcc));
      $.assign(rowAcc, phaseB(table, e, rowAcc));
      $.assign(rowAcc, phaseC(table, e, rowAcc, scale));
    });
    $.assign(total, total.add(rowAcc));
  });
  return total;
});

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'ir.beast2'), encodeEastIR(main.toIR()));

let seed = 7;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const NK1 = 300, NK2 = 170;
const rows = [];
for (let i = 0; i < NROWS; i++) {
  const inner = [];
  for (let j = 0; j < NINNER; j++) {
    inner.push({ a: rnd(), b: BigInt(Math.floor(rnd() * 1000)), k1: `k${Math.floor(rnd() * NK1)}`, k2: `g${Math.floor(rnd() * NK2)}`, w: rnd() });
  }
  rows.push({ id: BigInt(i), k1: `k${i % NK1}`, k2: `g${i % NK2}`, scale: 1.0 + rnd(), inner });
}
writeFileSync(join(out, 'rows.beast2'), encodeBeast2PagedFor(ArrayType(RowT))(rows));

const table = new SortedMap([], compareFor(KeyT));
for (let i = 0; i < NKEYS; i++) {
  table.set({ k1: `k${i % NK1}`, k2: `g${Math.floor(i / NK1) % NK2}` }, rnd());
}
writeFileSync(join(out, 'table.beast2'), encodeBeast2PagedFor(TableT)(table));
console.log(`wrote ${out}: ${NROWS} rows x ${NINNER} inner, ${table.size} keys`);
