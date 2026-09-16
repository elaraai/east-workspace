/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// The paged read-path shape from issue #759: a 12-field row with two nested
// Array<Struct> of NIN five-field items, written paged with deflate and with
// no codec, and four scan bodies of increasing width over it. Generates the
// IR for each body plus the two inputs for east-c.
//
//   node contrib/bench_759.mjs <outdir> [rows] [items]
//
// Run, per body and codec:
//   EAST_LAZY_INPUT_BYTES=1 east-c run <outdir>/e3.beast2 -i <outdir>/erows.beast2 -v
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArrayType, BooleanType, DateTimeType, East, FloatType, IntegerType, StringType, StructType,
  encodeBeast2PagedFor, encodeEastIR,
} from '@elaraai/east';

const out = process.argv[2] ?? 'bench_759';
const NROWS = Number(process.argv[3] ?? 200000);
const NIN = Number(process.argv[4] ?? 10);

const ItemT = StructType({ sku: StringType, qty: IntegerType, price: FloatType, ok: BooleanType, when: DateTimeType });
const RowT = StructType({
  id: IntegerType, site: StringType, region: StringType, f1: FloatType, f2: FloatType, f3: FloatType,
  n1: IntegerType, n2: IntegerType, flag: BooleanType, ts: DateTimeType,
  lines: ArrayType(ItemT), moves: ArrayType(ItemT),
});

// e1: two scalar fields — the nested arrays project away.
const e1 = East.function([ArrayType(RowT)], FloatType, ($, rows) => {
  const t = $.let(0.0);
  $.for(rows, ($, r) => { $.assign(t, t.add(r.f1).add(r.n1.toFloat())); });
  return t;
});
// e2b: the size of one nested array — no inner loop, no item field read.
const e2b = East.function([ArrayType(RowT)], FloatType, ($, rows) => {
  const t = $.let(0.0);
  $.for(rows, ($, r) => { $.assign(t, t.add(r.lines.size().toFloat())); });
  return t;
});
// e2: one field of every item of one nested array.
const e2 = East.function([ArrayType(RowT)], FloatType, ($, rows) => {
  const t = $.let(0.0);
  $.for(rows, ($, r) => { $.for(r.lines, ($, l) => { $.assign(t, t.add(l.price)); }); });
  return t;
});
// e3: a scalar plus one field of every item of both nested arrays.
const e3 = East.function([ArrayType(RowT)], FloatType, ($, rows) => {
  const t = $.let(0.0);
  $.for(rows, ($, r) => {
    $.assign(t, t.add(r.f1));
    $.for(r.lines, ($, l) => { $.assign(t, t.add(l.price)); });
    $.for(r.moves, ($, m) => { $.assign(t, t.add(m.qty.toFloat())); });
  });
  return t;
});

mkdirSync(out, { recursive: true });
for (const [n, f] of [['e1', e1], ['e2b', e2b], ['e2', e2], ['e3', e3]]) {
  writeFileSync(join(out, `${n}.beast2`), encodeEastIR(f.toIR()));
}

let seed = 3;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const items = () => {
  const a = [];
  for (let j = 0; j < NIN; j++) {
    a.push({
      sku: `SKU-${Math.floor(rnd() * 5000)}`, qty: BigInt(Math.floor(rnd() * 100)), price: rnd() * 100,
      ok: rnd() > 0.5, when: new Date(1700000000000 + Math.floor(rnd() * 1e9)),
    });
  }
  return a;
};
const rows = [];
for (let i = 0; i < NROWS; i++) {
  rows.push({
    id: BigInt(i), site: `site-${i % 40}`, region: `R${i % 7}`, f1: rnd(), f2: rnd(), f3: rnd(),
    n1: BigInt(i % 1000), n2: BigInt(Math.floor(rnd() * 1e6)), flag: rnd() > 0.3,
    ts: new Date(1700000000000 + i * 1000), lines: items(), moves: items(),
  });
}
writeFileSync(join(out, 'erows.beast2'), encodeBeast2PagedFor(ArrayType(RowT))(rows));
writeFileSync(join(out, 'erows_none.beast2'), encodeBeast2PagedFor(ArrayType(RowT), { codec: 'none' })(rows));
console.log(`wrote ${out}: ${NROWS} rows x 2 nested arrays of ${NIN} items; e1 e2b e2 e3`);
