/*
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

// Reproduction for issue #756 at the issue's scale: each emitted value is
// built in-East from a tiny seed row (so the input stays small) and carries
// ~NARR*NITEMS nested values; keys arrive out of order; runs of many GB.
//
//   node contrib/bench_756b.mjs <outdir> [rows] [arrays] [items]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArrayType, East, FloatType, FunctionType, IntegerType, NullType, StringType, StructType,
  encodeBeast2PagedFor, encodeEastIR,
} from '@elaraai/east';

const out = process.argv[2] ?? 'bench_756b';
const NROWS = Number(process.argv[3] ?? 100000);
const NARR = BigInt(process.argv[4] ?? 30);
const NITEMS = BigInt(process.argv[5] ?? 40);

const ItemT = StructType({ x: IntegerType, y: FloatType, tag: StringType });
const PartT = StructType({ name: StringType, items: ArrayType(ItemT) });
const SeedT = StructType({ key: IntegerType, label: StringType, base: FloatType });
const ValT = StructType({ label: StringType, total: FloatType, parts: ArrayType(PartT) });
const emitPair = FunctionType([IntegerType, ValT], NullType);

const main = East.function([ArrayType(SeedT), emitPair], NullType, ($, rows, emit) => {
  $.for(rows, ($, row) => {
    const total = $.let(0.0);
    const parts = $.let(East.Array.range(0n, NARR).map(($, a) => {
      const items = $.let(East.Array.range(0n, NITEMS).map(($, k) => {
        const y = $.let(row.base.multiply(k.toFloat()).add(a.toFloat()));
        $.assign(total, total.add(y));
        return { x: k.add(a), y, tag: East.str`t${k.modulo(7n)}` };
      }));
      return { name: East.str`part-${a}`, items };
    }));
    $(emit(row.key, { label: row.label, total, parts }));
  });
});

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'ir.beast2'), encodeEastIR(main.toIR()));

let seed = 11;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const keys = Array.from({ length: NROWS }, (_, i) => BigInt(i));
for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
const rows = [];
for (let i = 0; i < NROWS; i++) rows.push({ key: keys[i], label: `row-${i}`, base: rnd() });
writeFileSync(join(out, 'rows.beast2'), encodeBeast2PagedFor(ArrayType(SeedT), { batchSize: 1000 })(rows));
console.log(`wrote ${out}: ${NROWS} seed rows, ${NARR} arrays x ${NITEMS} items each per value`);
