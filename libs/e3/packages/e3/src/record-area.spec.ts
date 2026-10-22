/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `e3.recordIndex.area` (#1385): its generated keys, against a direct oracle of
 * §11.2 written with bit operations rather than the East arithmetic the key
 * function uses; its declared types; its refusals; its projection, the whole
 * row; and its maintenance, which equals its rebuild after inserts, moves,
 * deletes and unplacing. That every runtime files a row under the same key is
 * e3-core's records spec, which runs the index's programs on each.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DictType, East, FloatType, IntegerType, OptionType, PatchType, SetType, SortedMap, StringType, StructType,
  compareFor, decodeBeast2For, encodeBeast2For, equalFor, none, printType, some, variant,
  type FunctionExpr, type ValueTypeOf,
} from '@elaraai/east';
import { record } from './record.js';
import { recordIndex, type IndexKeyOf, type IndexOn } from './record-index.js';
import { AREA_UNPLACED, areaCellExponent, areaCode } from './record-area.js';
import { buildMutationProgram, indexBuildProgram } from './record-programs.js';
import { mutation } from './mutation.js';
import { package_ } from './package.js';
import type { RecordIndexDef } from './types.js';

/** A rack on a floor: placed by its centre, or not yet; and a zone, by its corner. */
const RackRow = StructType({
  hall: StringType, tags: SetType(StringType),
  x: OptionType(FloatType), y: OptionType(FloatType), w: FloatType, h: FloatType, name: StringType,
});
const RacksType = DictType(StringType, RackRow);
type Rack = ValueTypeOf<typeof RackRow>;
const racks = () => record('racks', RacksType, new Map());

const ZoneRow = StructType({ x: FloatType, y: FloatType, w: FloatType, h: FloatType });
const ZonesType = DictType(StringType, ZoneRow);
const zones = () => record('zones', ZonesType, new Map());

// ── The oracle: §11.2 with bit operations ────────────────────────────────────

/** A box's `__area` key, as §11.2 states it, from its centre and its larger side, the finest cell `2^e`. */
function oracle(cx: number, cy: number, side: number, e: number): bigint {
  const cell = 2 ** e;
  const half = 2 ** (e + 27);
  const finite = Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(side);
  if (!finite || cx < -half || cx >= half || cy < -half || cy >= half || side > half) return 0n;
  let level = 28;
  while (cell * 2 ** (28 - level) < 2 * side) level--;
  const shift = BigInt(28 - level);
  const ax = ((BigInt(Math.floor(cx / cell)) + (1n << 27n)) >> shift) << shift;
  const ay = ((BigInt(Math.floor(cy / cell)) + (1n << 27n)) >> shift) << shift;
  let code = 0n;
  for (let bit = 0n; bit < 28n; bit++) {
    code |= ((ax >> bit) & 1n) << (2n * bit);
    code |= ((ay >> bit) & 1n) << (2n * bit + 1n);
  }
  return code * 32n + BigInt(level);
}

/** A seeded stream of numbers in [0, 1): a xorshift, so a failure names a case that comes again. */
function stream(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 2 ** 32;
  };
}

/** The `[entry, projection]` pairs a build program emits for `rows`. */
function emitted(recordType: typeof RacksType | typeof ZonesType, def: RecordIndexDef, rows: Map<string, unknown>): [unknown, unknown][] {
  const out: [unknown, unknown][] = [];
  const run = indexBuildProgram(recordType, def).compile([]) as (
    slice: unknown, emit: (entry: unknown, value: unknown) => null) => unknown;
  run(rows, (entry, value) => {
    out.push([entry, value]);
    return null;
  });
  return out;
}

describe('e3.recordIndex.area — its keys (§11.2)', () => {
  it('rounds cell down to a power of two, and refuses one that is no positive number', () => {
    assert.equal(areaCellExponent('a', 0.01), -7, '0.01 m is filed by 2^-7 = 0.0078125 m cells');
    assert.equal(areaCellExponent('a', 1), 0);
    assert.equal(areaCellExponent('a', 0.0078125), -7, 'a power of two is its own');
    assert.equal(areaCellExponent('a', 1000), 9);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => areaCellExponent('a', bad), /takes a cell: the finest cell's side in world units/);
    }
    assert.throws(() => areaCellExponent('a', 2 ** 1000), /out of range/);
  });

  it('files a box under the deepest level whose cell is twice its larger side, in the cell holding its centre — as the oracle does', () => {
    for (const e of [-7, 0, 3]) {
      const code = East.compile(areaCode(e), []) as (cx: number, cy: number, side: number) => bigint;
      const cell = 2 ** e;
      const half = 2 ** (e + 27);
      const cases: [number, number, number][] = [
        [0, 0, 0], [-half, -half, 0], [half - cell, half - cell, 0], [cell * 3, -cell * 5, 0],
        // On a cell's corner, and a side exactly half a level's cell.
        [cell * 4, cell * 8, cell], [cell * 4, cell * 8, cell * 2], [cell * 4.5, cell * 8.5, cell * 0.75],
        // The largest box a level takes, and the smallest the next up takes.
        [cell * 100, cell * 200, half / 2], [cell * 100, cell * 200, half], [cell * 100, cell * 200, half * 0.75],
        // Outside the domain, larger than half of it, not finite.
        [half, 0, 0], [0, -half - cell, 0], [0, 0, half * 1.5], [Number.NaN, 0, 0], [0, Number.POSITIVE_INFINITY, 0], [0, 0, Number.NaN],
      ];
      const next = stream(e + 100);
      for (let i = 0; i < 400; i++) {
        const span = half * 2 ** -Math.floor(next() * 30);
        cases.push([(next() * 2 - 1) * span, (next() * 2 - 1) * span, next() < 0.2 ? 0 : next() * span * 0.1]);
      }
      for (const [cx, cy, side] of cases) {
        assert.equal(code(cx, cy, side), oracle(cx, cy, side, e), `cell 2^${e}: (${cx}, ${cy}) side ${side}`);
      }
      // The root, for anything it cannot place in a cell of its own.
      assert.equal(code(half, 0, 0), 0n);
      assert.equal(code(0, 0, half * 1.5), 0n);
      // A point is at the finest level.
      assert.equal(code(cell * 3, cell * 3, 0) % 32n, 28n);
    }
  });

  it('keeps every box inside its cell grown by a quarter of the cell each side: its loose bounds', () => {
    const e = -7;
    const cell = 2 ** e;
    const code = East.compile(areaCode(e), []) as (cx: number, cy: number, side: number) => bigint;
    const next = stream(7);
    for (let i = 0; i < 2000; i++) {
      const cx = (next() * 2 - 1) * 5000;
      const cy = (next() * 2 - 1) * 5000;
      const side = next() < 0.3 ? 0 : next() ** 3 * 800;
      const key = code(cx, cy, side);
      const level = Number(key % 32n);
      const morton = key / 32n;
      let ax = 0n;
      let ay = 0n;
      for (let bit = 0n; bit < 28n; bit++) {
        ax |= ((morton >> (2n * bit)) & 1n) << bit;
        ay |= ((morton >> (2n * bit + 1n)) & 1n) << bit;
      }
      const s = cell * 2 ** (28 - level);
      const minX = (Number(ax) - 2 ** 27) * cell;
      const minY = (Number(ay) - 2 ** 27) * cell;
      assert.ok(cx - side / 2 >= minX - s / 4 && cx + side / 2 <= minX + s + s / 4, `x in its loose bounds: ${cx} ± ${side / 2}`);
      assert.ok(cy - side / 2 >= minY - s / 4 && cy + side / 2 <= minY + s + s / 4, `y in its loose bounds: ${cy} ± ${side / 2}`);
      assert.ok(level === 28 || s / 2 < 2 * side, 'the deepest level whose cell is twice its side');
    }
  });

  it('keys a row by its fields: its centre, or its corner plus half its box; unplaced is −1; leading fields fan out', () => {
    const byArea = recordIndex.area('racks_by_area', racks(), { x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 });
    const byHallArea = recordIndex.area('racks_by_hall_area', racks(), { on: ['hall'], x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 });
    const byTagArea = recordIndex.area('racks_by_tag_area', racks(), { on: ['tags'], x: 'x', y: 'y', at: 'centre', cell: 0.01 });
    const zonesByArea = recordIndex.area('zones_by_area', zones(), { x: 'x', y: 'y', width: 'w', height: 'h', cell: 0.01 });
    const rack = (x: number | null, y: number | null): Rack => ({
      hall: 'H1', tags: new Set(['a', 'b']), x: x === null ? none : some(x), y: y === null ? none : some(y), w: 0.6, h: -1.2, name: 'r',
    });
    const keyOf = (def: RecordIndexDef) => East.compile(def.keyFn as FunctionExpr<any, any>, []) as (key: string, row: unknown) => unknown;
    const decode = decodeBeast2For(RackRow);
    const encode = encodeBeast2For(RackRow);
    const placed = decode(encode(rack(12.34, -5.6)));
    assert.deepEqual(keyOf(byArea)('r1', placed), { __area: oracle(12.34, -5.6, 1.2, -7) }, 'the larger side, whatever its sign');
    assert.deepEqual(keyOf(byHallArea)('r1', placed), { hall: 'H1', __area: oracle(12.34, -5.6, 1.2, -7) });
    const tagged = keyOf(byTagArea)('r1', placed) as Set<{ tags: string; __area: bigint }>;
    assert.deepEqual([...tagged], [{ tags: 'a', __area: oracle(12.34, -5.6, 0, -7) }, { tags: 'b', __area: oracle(12.34, -5.6, 0, -7) }],
      'a point is filed at the finest level, once a tag');
    assert.deepEqual(keyOf(byArea)('r2', decode(encode(rack(null, -5.6)))), { __area: AREA_UNPLACED });
    assert.deepEqual(keyOf(byArea)('r3', decode(encode(rack(1, null)))), { __area: AREA_UNPLACED });
    const zone = decodeBeast2For(ZoneRow)(encodeBeast2For(ZoneRow)({ x: 10, y: 20, w: 4, h: 2 }));
    assert.deepEqual(keyOf(zonesByArea)('z1', zone), { __area: oracle(12, 21, 4, -7) }, 'a corner plus half the box is its centre');
  });
});

describe('e3.recordIndex.area — its declaration', () => {
  it('types its key, its fields and its projection from the spec, and carries the box and its rounded cell', () => {
    const def = recordIndex.area('racks_by_hall_area', racks(), { on: ['hall'], x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 });
    const keyType: StructType<{ hall: typeof StringType; __area: typeof IntegerType }> = def.keyType;
    const fields: readonly ['hall', '__area'] = def.on;
    const projection: typeof RackRow = def.valueType;
    assert.equal(printType(keyType), printType(StructType({ hall: StringType, __area: IntegerType })));
    assert.deepEqual(fields, ['hall', '__area']);
    assert.equal(printType(projection), printType(RackRow), 'it carries the whole row');
    assert.deepEqual(def.area, { x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.0078125 });
    assert.equal(def.multi, false, 'one entry a row');
    const alone = recordIndex.area('zones_by_area', zones(), { x: 'x', y: 'y', width: 'w', height: 'h', cell: 1 });
    const aloneKey: StructType<{ __area: typeof IntegerType }> = alone.keyType;
    const aloneOn: readonly ['__area'] = alone.on;
    assert.deepEqual(aloneOn, ['__area']);
    assert.equal(printType(aloneKey), printType(StructType({ __area: IntegerType })));
    assert.equal(alone.area.at, 'corner', 'the corner, unless it says');
    // The declared types, as the constructor's spec types them.
    type Spec = { on: ['hall']; x: 'x'; y: 'y'; cell: 1 };
    const on: IndexOn<Spec> = ['hall', '__area'];
    const key: IndexKeyOf<Spec, typeof RacksType> = StructType({ hall: StringType, __area: IntegerType });
    assert.ok(on.length === 2 && key.type === 'Struct');
  });

  it('projects each entry as its whole row', () => {
    const def = recordIndex.area('racks_by_area', racks(), { x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 });
    const rows = new SortedMap<string, Rack>([
      ['r1', { hall: 'H1', tags: new Set(), x: some(1.5), y: some(2.5), w: 0.6, h: 1.2, name: 'one' }],
      ['r2', { hall: 'H2', tags: new Set(['a']), x: none, y: none, w: 0.6, h: 1.2, name: 'unplaced' }],
    ], compareFor(StringType));
    const out = emitted(RacksType, def, rows);
    assert.equal(out.length, 2);
    for (const [entry, value] of out) {
      const k = (entry as { k: string }).k;
      assert.ok(equalFor(RackRow)(value as Rack, rows.get(k)!), `${k}'s projection is its row`);
    }
  });

  describe('refuses, at definition time', () => {
    it('a field of the wrong type, naming the option, the field and its type', () => {
      // @ts-expect-error — x takes a Float or an Option<Float> field
      assert.throws(() => recordIndex.area('bad_x', racks(), { x: 'name', y: 'y', cell: 1 }), /x names 'name', of type \.String: x is a Float or an Option<Float> field/);
      // @ts-expect-error — width takes a Float field, never an Option
      assert.throws(() => recordIndex.area('bad_w', racks(), { x: 'x', y: 'y', width: 'x', height: 'h', cell: 1 }), /width names 'x', of type .+: width is a Float field/);
      // @ts-expect-error — the row has no such field
      assert.throws(() => recordIndex.area('missing', racks(), { x: 'missing', y: 'y', cell: 1 }), /x names unknown row field 'missing'/);
    });

    it('x and y that are not both Options, width without height, and a cell that is no positive number', () => {
      const Mixed = StructType({ x: OptionType(FloatType), y: FloatType, w: FloatType });
      const mixed = record('mixed', DictType(StringType, Mixed), new Map());
      assert.throws(() => recordIndex.area('mixed_xy', mixed, { x: 'x', y: 'y', cell: 1 }), /both Options, or neither/);
      assert.throws(() => recordIndex.area('half_box', zones(), { x: 'x', y: 'y', width: 'w', cell: 1 }), /width and height together/);
      assert.throws(() => recordIndex.area('no_cell', zones(), { x: 'x', y: 'y', cell: 0 }), /takes a cell/);
    });

    it('a value, a row field named __area, and the guards every index applies to its name and its record', () => {
      // @ts-expect-error — an area index carries the whole row, and takes no value
      assert.throws(() => recordIndex.area('valued', zones(), { x: 'x', y: 'y', cell: 1, value: East.function([StringType, ZoneRow], FloatType, ($, _k, v) => v.x) }),
        /takes no value/);
      const Reserved = StructType({ x: FloatType, y: FloatType, __area: IntegerType });
      const reserved = record('reserved', DictType(StringType, Reserved), new Map());
      assert.throws(() => recordIndex.area('reserved_area', reserved, { x: 'x', y: 'y', cell: 1 }), /field named '__area'/);
      assert.throws(() => recordIndex.area('primary', zones(), { x: 'x', y: 'y', cell: 1 }), /e3.recordIndex.area cannot be named 'primary'/);
      assert.throws(() => recordIndex.area('by area', zones(), { x: 'x', y: 'y', cell: 1 }), /must be an identifier/);
    });
  });
});

describe('e3.recordIndex.area — through mutation and rebuild', () => {
  it('maintains the collection a rebuild emits after inserts, moves, deletes and unplacing, byte for byte', () => {
    const rec = racks();
    const indexes = [
      recordIndex.area('racks_by_area', rec, { x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 }),
      recordIndex.area('racks_by_hall_area', rec, { on: ['hall'], x: 'x', y: 'y', width: 'w', height: 'h', at: 'centre', cell: 0.01 }),
      recordIndex.area('racks_by_tag_area', rec, { on: ['tags'], x: 'x', y: 'y', cell: 0.5 }),
    ];
    const patch = mutation.patch(rec);
    const assembled = package_('area_indexes', '1.0.0', rec, patch, ...indexes).records.racks!;
    const at = (x: number, y: number, w = 0.6, h = 1.2, hall = 'H1', tags: string[] = ['a']): Rack =>
      ({ hall, tags: new Set(tags), x: some(x), y: some(y), w, h, name: `${x},${y}` });
    const before = new SortedMap<string, Rack>([
      ['r1', at(1, 2)], ['r2', at(3, 4, 0, 0, 'H2', ['b'])], ['r3', at(-50, 60, 30, 10)], ['r4', at(5, 5)],
    ], compareFor(StringType));
    const after = new SortedMap<string, Rack>([
      // r1 moves within its cell's level; r2 moves a long way and grows; r3 is unplaced; r4 is deleted; r5 is new.
      ['r1', at(1.001, 2, 0.6, 1.2)], ['r2', at(-400, 900, 12, 3, 'H2', ['b', 'c'])],
      ['r3', { ...at(0, 0), x: none, y: none }], ['r5', at(7, -7, 0.2, 0.2, 'H3', [])],
    ], compareFor(StringType));
    const diff = East.compile(East.function([RacksType, RacksType], PatchType(RacksType), (_$, a, b) => East.diff(a, b)), []);
    const changes: Array<{ index: string; key: unknown; op: unknown }> = [];
    const run = buildMutationProgram(assembled, patch).compile([]);
    run(before, diff(before, after), (key: { type: string; value: unknown }, op: { value: unknown }) => {
      changes.push({ index: key.type, key: key.value, op: op.value });
      return null;
    });
    for (const index of indexes) {
      const keyType = StructType({ ik: index.keyType, k: StringType });
      const collection = DictType(keyType, index.valueType);
      const held = new SortedMap(emitted(RacksType, index, before) as never, compareFor(keyType));
      const rebuilt = new SortedMap(emitted(RacksType, index, after) as never, compareFor(keyType));
      const ops = new SortedMap(changes.filter((change) => change.index === index.name).map((change) => [change.key, change.op]) as never, compareFor(keyType));
      const apply = East.compile(East.function([collection, PatchType(collection)], collection, (_$, value, p) => East.applyPatch(value, p)), []);
      const maintained = apply(held as never, variant('patch', ops) as never);
      assert.deepEqual(encodeBeast2For(collection)(maintained as never), encodeBeast2For(collection)(rebuilt as never), `${index.name}: maintained is rebuilt, byte for byte`);
    }
  });
});
