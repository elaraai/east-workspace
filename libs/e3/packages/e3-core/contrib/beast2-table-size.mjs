// Scratch: measure BEAST2-encoded size of a "table" (dict of structs).
// Uses the same encoder e3 uses for dataset values: encodeBeast2For(type).
import {
  encodeBeast2For, DictType, StructType, StringType, IntegerType,
  FloatType, BooleanType, ArrayType,
} from '@elaraai/east';

// A representative "row": a few primitives + simple collection fields.
const RowType = StructType({
  id: StringType,
  name: StringType,
  count: IntegerType,
  amount: FloatType,
  active: BooleanType,
  tags: ArrayType(StringType),     // simple collection
  scores: ArrayType(FloatType),    // simple collection
});
const TableType = DictType(StringType, RowType);
const encode = encodeBeast2For(TableType);

function makeTable(n) {
  const m = new Map();
  for (let i = 0; i < n; i++) {
    const id = `row-${String(i).padStart(7, '0')}`;
    m.set(id, {
      id,
      name: `Customer ${i} ${'x'.repeat(i % 17)}`,   // varied length
      count: BigInt(i * 3),
      amount: (i % 1000) + 0.125,
      active: i % 2 === 0,
      tags: ['alpha', 'beta', i % 3 === 0 ? 'gamma' : 'delta'],
      scores: [0.1, 0.5, 0.9, (i % 50) / 50],
    });
  }
  return m;
}

const fmt = (b) => b < 1024 ? `${b} B`
  : b < 1024*1024 ? `${(b/1024).toFixed(1)} KB`
  : `${(b/1024/1024).toFixed(2)} MB`;

console.log('rows\tbytes\t\tper-row\ttotal');
for (const n of [100, 1000, 10000, 50000, 100000, 250000]) {
  const bytes = encode(makeTable(n)).length;
  console.log(`${n}\t${bytes}\t${(bytes/n).toFixed(1)} B\t${fmt(bytes)}`);
}

// How many rows fit under common limits (using measured per-row at 100k)?
const big = encode(makeTable(100000)).length;
const perRow = big / 100000;
console.log(`\nper-row ~= ${perRow.toFixed(1)} B (measured at 100k rows)`);
for (const [label, limit] of [['1 MB (e3 SIZE_THRESHOLD)', 1024*1024], ['6 MB (Lambda)', 6*1024*1024], ['10 MB (API GW)', 10*1024*1024]]) {
  console.log(`  rows under ${label}: ~${Math.floor(limit/perRow).toLocaleString()}`);
}
