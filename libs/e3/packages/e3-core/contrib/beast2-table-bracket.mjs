import { encodeBeast2For, DictType, StructType, StringType, IntegerType, FloatType, BooleanType, ArrayType } from '@elaraai/east';

const NarrowType = DictType(StringType, StructType({ id: StringType, count: IntegerType, amount: FloatType }));
const WideType = DictType(StringType, StructType({
  id: StringType, name: StringType, email: StringType, count: IntegerType, amount: FloatType,
  rate: FloatType, active: BooleanType, region: StringType,
  tags: ArrayType(StringType), scores: ArrayType(FloatType), notes: StringType,
}));

const mk = (n, wide) => {
  const m = new Map();
  for (let i = 0; i < n; i++) {
    const id = `row-${String(i).padStart(7,'0')}`;
    m.set(id, wide
      ? { id, name:`Customer ${i}`, email:`user${i}@example.com`, count:BigInt(i), amount:i+0.5, rate:0.073, active:i%2===0, region:['us','eu','apac'][i%3], tags:['a','b','c'], scores:[0.1,0.2,0.3,0.4,0.5], notes:`note ${i} ${'y'.repeat(i%23)}` }
      : { id, count:BigInt(i), amount:i+0.5 });
  }
  return m;
};

for (const [label, type, wide] of [['narrow (id,int,float)', NarrowType, false], ['wide (11 fields)', WideType, true]]) {
  const enc = encodeBeast2For(type);
  const per = enc(mk(50000, wide)).length / 50000;
  console.log(`${label}: ${per.toFixed(1)} B/row  ->  1MB≈${Math.floor(1048576/per).toLocaleString()} rows, 6MB≈${Math.floor(6*1048576/per).toLocaleString()} rows`);
}
