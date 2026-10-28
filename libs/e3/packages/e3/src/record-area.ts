/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The area index's keys (#1385): a loose quadtree laid along a Z-order curve
 * (XZ-ordering), embedded in an ordinary maintained record index, the 2D twin
 * of the interval index (`record-interval.ts`).
 *
 * The domain is the square `[−cell·2²⁷, cell·2²⁷)` world units, in 29 levels
 * `L = 0…28`, a level-L cell `cell · 2^(28−L)` wide: the finest is `cell`, the
 * root the whole domain. A row is filed once, under the deepest level whose
 * cell is at least twice its box's larger side, in the cell of that level
 * holding its box's centre — so its box lies within the cell grown by a
 * quarter of its side on each side, its loose bounds. Its key is the cell's
 * Morton code at level 28 (x in the even bits, y in the odd), times 32, plus
 * its level. A row with no place is `−1`; one outside the domain, not finite,
 * or larger than half the domain is the root's, `0`.
 *
 * `cell` is a power of two, so every step of the arithmetic is exact and every
 * runtime — TypeScript, C, Python — files a row under the same key, which is
 * what lets a maintained index equal its rebuild byte for byte.
 */
import { East, FloatType, IntegerType, OptionType, SetType, StructType, isTypeEqual, none, printType, some, type EastType } from '@elaraai/east';
import type { RecordDef, RecordIndexDef } from './types.js';
import { INDEX_PURITY, checkEntryParams, checkPure, indexRunner, indexedEntry, onlyOptions, signatureOf, type IndexConstructor, type IndexFunction } from './record-guards.js';
import { checkLeading, fieldReader, leadingValue, leadingValues, optionField, type RowType } from './record-keys.js';

/** The finest level: a level-28 cell is `cell` wide. */
export const AREA_FINEST_LEVEL = 28;

/** The key of a row with no place: its `x` or its `y` is `none`. */
export const AREA_UNPLACED = -1n;

/** How an area index reads a row's box: the fields naming it, and whether `x`, `y` is its centre or its minimum corner. */
export interface AreaBox {
  /** The field holding the box's `x`: its minimum corner's, or its centre's. */
  readonly x: string;
  /** The field holding the box's `y`. */
  readonly y: string;
  /** The field holding the box's width; absent for a point. */
  readonly width?: string;
  /** The field holding the box's height; absent for a point. */
  readonly height?: string;
  /** Whether `x`, `y` is the box's minimum corner or its centre. */
  readonly at: 'corner' | 'centre';
}

/**
 * The exponent of the largest power of two at most `cell`: the finest cell's
 * side, as the index files rows by it.
 *
 * @param constructor - The declaration, for the refusal
 * @param name - The index, for the refusal
 * @param cell - The finest cell's side the author declared, in world units
 * @returns `e`, with `2^e ≤ cell < 2^(e+1)`
 * @throws {Error} When `cell` is not a positive finite number, or is so large or
 *   small that the domain, `2^(e+27)` either side of zero, is not a finite Float
 */
export function areaCellExponent(constructor: IndexConstructor, name: string, cell: number): number {
  if (typeof cell !== 'number' || !Number.isFinite(cell) || cell <= 0) {
    throw new Error(
      `${constructor} '${name}' takes a cell: the finest cell's side in world units, ` +
      `a positive number (0.01 for a floor in metres, 1 for one in millimetres) — got ${String(cell)}`,
    );
  }
  let e = Math.floor(Math.log2(cell));
  while (2 ** e > cell) e--;
  while (2 ** (e + 1) <= cell) e++;
  // The domain is 2^(e+27) either side of zero, and a cell 2^e: both must be
  // normal, finite Floats for the arithmetic to stay exact.
  if (e + 28 > 1023 || e < -1022) {
    throw new Error(`${constructor} '${name}' cell ${cell} is out of range: its domain, 2^${e + 27} world units either side of zero, is not a finite Float`);
  }
  return e;
}

/** The finest level's cells either side of zero: the domain is `cell · 2^27` either side. */
const HALF_CELLS = 2 ** 27;
/** {@link HALF_CELLS}, an Integer. */
const HALF_CELLS_INTEGER = 1n << 27n;
/** {@link AREA_FINEST_LEVEL}, an Integer. */
const FINEST_LEVEL = 28n;

/**
 * The `area` part of a box's key, from its centre, its larger side and the
 * finest cell's side, a power of two: the level-28 Morton code of the box's
 * cell, times 32, plus its level; `0`, the root, for a box outside the domain,
 * not finite, or larger than half the domain. Every step is exact, so every
 * runtime computes it alike.
 *
 * `(cx, cy, side, cell) → Integer`
 */
export const areaCode = East.function([FloatType, FloatType, FloatType, FloatType], IntegerType, ($, cx, cy, side, cell) => {
  const half = $.let(cell.multiply(HALF_CELLS));
  // A value is finite exactly when it less itself is zero: an infinity's, or a NaN's, is a NaN.
  const finite = $.let(cx.subtract(cx).equal(0.0).and(() => cy.subtract(cy).equal(0.0)).and(() => side.subtract(side).equal(0.0)));
  const inside = $.let(cx.greaterEqual(half.negate()).and(() => cx.less(half)).and(() => cy.greaterEqual(half.negate())).and(() => cy.less(half)));
  $.if(finite.not().or(() => inside.not()).or(() => side.greater(half)), ($) => {
    $.return(0n);
  });
  // The deepest level whose cell is at least twice the box's larger side:
  // each step up doubles the cell, exactly, and the step between its cells'
  // indices at the finest level. A side at most half the domain stops at the
  // root at the latest.
  const level = $.let(FINEST_LEVEL);
  const size = $.let(cell);
  const step = $.let(1n);
  const twice = $.let(side.multiply(2.0));
  $.while(size.less(twice), ($) => {
    $.assign(size, size.multiply(2.0));
    $.assign(level, level.subtract(1n));
    $.assign(step, step.multiply(2n));
  });
  // The finest cell holding the centre: a division by a power of two, and its
  // floor, are exact; the domain's lower edge is cell 0. Then the level's
  // cell holding it, aligned to the finest level: the bits below it cleared.
  const ix = $.let(East.Float.roundFloor(cx.divide(cell)).add(HALF_CELLS_INTEGER).divide(step).multiply(step));
  const iy = $.let(East.Float.roundFloor(cy.divide(cell)).add(HALF_CELLS_INTEGER).divide(step).multiply(step));
  // Its Morton code: x in the even bits, y in the odd.
  const code = $.let(0n);
  const bit = $.let(1n);
  $.for(East.Array.range(0n, FINEST_LEVEL), ($) => {
    $.assign(code, code.add(ix.remainder(2n).multiply(bit)).add(iy.remainder(2n).multiply(bit).multiply(2n)));
    $.assign(ix, ix.divide(2n));
    $.assign(iy, iy.divide(2n));
    $.assign(bit, bit.multiply(4n));
  });
  $.return(code.multiply(32n).add(level));
});

/** `(width, height) → the larger of their sizes`: a box's larger side. */
const largerSide = East.function([FloatType, FloatType], FloatType, (_$, width, height) =>
  width.abs().greaterEqual(height.abs()).ifElse(() => width.abs(), () => height.abs()));

/** What an area index's declaration names (`e3.recordIndex.area`). */
export interface AreaSpec {
  readonly on?: readonly string[];
  readonly x: string;
  readonly y: string;
  readonly width?: string;
  readonly height?: string;
  readonly at?: 'corner' | 'centre';
  readonly cell: number;
}

/**
 * An area index's definition (`e3.recordIndex.area`): its key function, one
 * entry per row — one per combination of its leading values where a Set among
 * them fans out — `{ on: { …on }, area }`, the row's leading fields under `on`
 * and the cell's code beside them (#1432); and its projection, the whole row,
 * so a window reads the index alone and no record segment (D29). It stays an
 * ordinary maintained index: mutation, rebuild, storage and transport are
 * shared.
 *
 * @param constructor - The declaration, as a refusal names it
 * @param name - The index
 * @param rec - Its record
 * @param spec - The box's fields, whether `x`, `y` is its centre or its corner, the finest cell, and the optional leading `on`
 * @param config - Its runner selection
 * @returns The definition
 * @throws {Error} When a field is not of its option's type, naming the option, the field and its type; when `x` and `y`
 *   are not both Options or neither; when `width` and `height` are not given together; or on any guard every index applies
 */
export function areaDefinition(
  constructor: IndexConstructor, name: string, rec: RecordDef, spec: AreaSpec, config: { runner?: RecordIndexDef['runner'] } | undefined,
): RecordIndexDef {
  const { keyType, valueType } = indexedEntry(constructor, name, rec);
  onlyOptions(constructor, name, spec, ['on', 'x', 'y', 'width', 'height', 'at', 'cell'],
    'value' in spec ? 'an area index carries the whole row as its projection, so it takes no value' : undefined);
  const exponent = areaCellExponent(constructor, name, spec.cell);
  const box: AreaBox = {
    x: spec.x, y: spec.y,
    ...(spec.width !== undefined && { width: spec.width }),
    ...(spec.height !== undefined && { height: spec.height }),
    at: spec.at ?? 'corner',
  };
  if (valueType.type !== 'Struct') throw new Error(`${constructor} '${name}' indexes a record with Struct rows`);
  const rowType: RowType = valueType;
  const typeOf = (option: string, field: string): EastType => {
    const type = rowType.fields[field];
    if (type === undefined) throw new Error(`${constructor} '${name}' ${option} names unknown row field '${field}'`);
    return type;
  };
  const placeOf = (option: string, field: string) => {
    const type = typeOf(option, field);
    const place = optionField(rowType, field, FloatType);
    if (place === undefined) {
      throw new Error(`${constructor} '${name}' ${option} names '${field}', of type ${printType(type)}: ${option} is a Float or an Option<Float> field`);
    }
    return place;
  };
  const x = placeOf('x', box.x);
  const y = placeOf('y', box.y);
  if (x.optional !== y.optional) {
    throw new Error(`${constructor} '${name}': x '${box.x}' and y '${box.y}' are both Options, or neither — a row is placed, or not, by both`);
  }
  if ((box.width === undefined) !== (box.height === undefined)) {
    throw new Error(`${constructor} '${name}' takes width and height together, or neither for a point`);
  }
  for (const [option, field] of [['width', box.width], ['height', box.height]] as const) {
    if (field === undefined) continue;
    const type = typeOf(option, field);
    if (!isTypeEqual(type, FloatType)) {
      throw new Error(`${constructor} '${name}' ${option} names '${field}', of type ${printType(type)}: ${option} is a Float field`);
    }
  }
  if (box.at !== 'corner' && box.at !== 'centre') {
    throw new Error(`${constructor} '${name}' at is "corner" or "centre", not ${String(box.at)}`);
  }
  const on = spec.on ?? [];
  const leading = checkLeading(constructor, name, rowType, on);
  const indexType = StructType({ on: leading.onType, area: IntegerType });
  // The row's box as the code reads it: its centre, `none` for a row not placed, and its larger side, a point's none.
  const BoxType = StructType({ cx: OptionType(FloatType), cy: OptionType(FloatType), side: FloatType });
  const readX = fieldReader(keyType, rowType, { option: x });
  const readY = fieldReader(keyType, rowType, { option: y });
  const size = box.width === undefined || box.height === undefined ? undefined : {
    width: fieldReader(keyType, rowType, { field: box.width, type: FloatType }),
    height: fieldReader(keyType, rowType, { field: box.height, type: FloatType }),
  };
  const boxOf = size === undefined
    // A point: its place, no side.
    ? East.function([keyType, rowType], BoxType, ($, key, row) => {
      const xOf = $.const(readX);
      const yOf = $.const(readY);
      return { cx: xOf(key, row), cy: yOf(key, row), side: 0.0 };
    })
    : box.at === 'corner'
      // A box by its minimum corner: its centre half the box on.
      ? East.function([keyType, rowType], BoxType, ($, key, row) => {
        const xOf = $.const(readX);
        const yOf = $.const(readY);
        const widthOf = $.const(size.width);
        const heightOf = $.const(size.height);
        const larger = $.const(largerSide);
        const width = $.let(widthOf(key, row));
        const height = $.let(heightOf(key, row));
        return {
          cx: xOf(key, row).match({ some: (_$, cx) => some(cx.add(width.divide(2.0))), none: () => none }),
          cy: yOf(key, row).match({ some: (_$, cy) => some(cy.add(height.divide(2.0))), none: () => none }),
          side: larger(width, height),
        };
      })
      // A box by its centre.
      : East.function([keyType, rowType], BoxType, ($, key, row) => {
        const xOf = $.const(readX);
        const yOf = $.const(readY);
        const widthOf = $.const(size.width);
        const heightOf = $.const(size.height);
        const larger = $.const(largerSide);
        return { cx: xOf(key, row), cy: yOf(key, row), side: larger(widthOf(key, row), heightOf(key, row)) };
      });
  // The row's cell code: unplaced, or the cell of its box's centre and larger side.
  const areaOf = East.function([keyType, rowType], IntegerType, ($, key, row) => {
    const locate = $.const(areaCode);
    const read = $.const(boxOf);
    const at = $.let(read(key, row));
    const area = $.let(AREA_UNPLACED, IntegerType);
    $.match(at.cx, {
      some: ($, cx) => {
        $.match(at.cy, {
          some: ($, cy) => { $.assign(area, locate(cx, cy, at.side, 2 ** exponent)); },
          none: () => {},
        });
      },
      none: () => {},
    });
    return area;
  });
  // One entry a row, under its leading values; one a combination of them where a Set among them fans it out.
  let keyFn: IndexFunction;
  if (leading.multi) {
    const leads = leadingValues(keyType, rowType, leading);
    keyFn = East.function([keyType, rowType], SetType(indexType), ($, key, row) => {
      const areaFn = $.const(areaOf);
      const combinations = $.const(leads);
      const area = $.let(areaFn(key, row));
      return combinations(key, row).toSet((_$, on) => ({ on, area }));
    });
  } else {
    const lead = leadingValue(keyType, rowType, leading);
    keyFn = East.function([keyType, rowType], indexType, ($, key, row) => {
      const areaFn = $.const(areaOf);
      const values = $.const(lead);
      return { on: values(key, row), area: areaFn(key, row) };
    });
  }
  // It carries its rows (D29): each entry's projection is the whole row, so a window reads the index alone and no
  // record segment.
  const valueFn = East.function([keyType, rowType], rowType, (_$, _key, row) => row);
  const runner = indexRunner(config);
  const role = leading.multi ? "'keys' function" : "'key' function";
  checkPure(`${constructor} '${name}' ${role}`, keyFn, INDEX_PURITY);
  checkEntryParams(constructor, name, role, keyType, valueType, signatureOf(keyFn).inputs);
  return {
    kind: 'recordIndex',
    name,
    record: rec,
    on: Object.freeze([...on]),
    area: Object.freeze({ ...box, cell: 2 ** exponent }),
    keyFn,
    valueFn,
    multi: leading.multi,
    keyType: indexType,
    valueType: rowType,
    runner,
  };
}
