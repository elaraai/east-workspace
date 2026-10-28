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
import {
  East, Expr, FloatType, IntegerType, OptionType, StructType, SetType, isTypeEqual, printType,
  type EastType, type FunctionExpr,
} from '@elaraai/east';
import type { IndexFunction } from './record-index.js';

/** The finest level: a level-28 cell is `cell` wide. */
export const AREA_FINEST_LEVEL = 28;

/** The key of a row with no place: its `x` or its `y` is `none`. */
export const AREA_UNPLACED = -1n;

/** The reserved name of the area index's generated key field. */
export const AREA_FIELD = '__area';

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
 * @param name - The index, for the refusal
 * @param cell - The finest cell's side the author declared, in world units
 * @returns `e`, with `2^e ≤ cell < 2^(e+1)`
 * @throws {Error} When `cell` is not a positive finite number, or is so large or
 *   small that the domain, `2^(e+27)` either side of zero, is not a finite Float
 */
export function areaCellExponent(name: string, cell: number): number {
  if (typeof cell !== 'number' || !Number.isFinite(cell) || cell <= 0) {
    throw new Error(
      `e3.recordIndex.area '${name}' takes a cell: the finest cell's side in world units, ` +
      `a positive number (0.01 for a floor in metres, 1 for one in millimetres) — got ${String(cell)}`,
    );
  }
  let e = Math.floor(Math.log2(cell));
  while (2 ** e > cell) e--;
  while (2 ** (e + 1) <= cell) e++;
  // The domain is 2^(e+27) either side of zero, and a cell 2^e: both must be
  // normal, finite Floats for the arithmetic to stay exact.
  if (e + 28 > 1023 || e < -1022) {
    throw new Error(`e3.recordIndex.area '${name}' cell ${cell} is out of range: its domain, 2^${e + 27} world units either side of zero, is not a finite Float`);
  }
  return e;
}

/**
 * The `__area` key of a box, from its centre and its larger side: an East
 * function, so every runtime computes it alike.
 *
 * @param exponent - The finest cell's side is `2^exponent` world units
 * @returns `(cx, cy, side) → Integer`: the level-28 Morton code of the box's
 *   cell, times 32, plus its level; `0`, the root, for a box outside the domain,
 *   not finite, or larger than half the domain
 */
export function areaCode(exponent: number) {
  const cell = 2 ** exponent;
  const half = 2 ** (exponent + 27);
  const finest = BigInt(AREA_FINEST_LEVEL);
  return East.function([FloatType, FloatType, FloatType], IntegerType, ($, cx, cy, side) => {
    // A value is finite exactly when it less itself is zero: an infinity's, or a NaN's, is a NaN.
    const finite = (value: typeof cx) => value.subtract(value).equal(0.0);
    const inside = (value: typeof cx) => value.greaterEqual(-half).and(() => value.less(half));
    $.if(finite(cx).and(() => finite(cy)).and(() => finite(side)).not()
      .or(() => inside(cx).not()).or(() => inside(cy).not()).or(() => side.greater(half)), ($) => {
      $.return(0n);
    });
    // The deepest level whose cell is at least twice the box's larger side:
    // each step up doubles the cell, exactly, and the step between its cells'
    // indices at the finest level. A side at most half the domain stops at the
    // root at the latest.
    const level = $.let(finest);
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
    const ix = $.let(East.Float.roundFloor(cx.divide(cell)).add(1n << 27n).divide(step).multiply(step));
    const iy = $.let(East.Float.roundFloor(cy.divide(cell)).add(1n << 27n).divide(step).multiply(step));
    // Its Morton code: x in the even bits, y in the odd.
    const code = $.let(0n);
    const bit = $.let(1n);
    $.for(East.Array.range(0n, finest), ($) => {
      $.assign(code, code.add(ix.remainder(2n).multiply(bit)).add(iy.remainder(2n).multiply(bit).multiply(2n)));
      $.assign(ix, ix.divide(2n));
      $.assign(iy, iy.divide(2n));
      $.assign(bit, bit.multiply(4n));
    });
    $.return(code.multiply(32n).add(level));
  });
}

/**
 * Generate the area index's pure key function: one entry per row (one per
 * element of a Set among the leading `on` fields), `{ …on, __area }`, using
 * the field index's generated function for the leading fields, as the
 * interval index does. It stays an ordinary maintained index: mutation,
 * rebuild, storage and transport are shared.
 *
 * @param name - The index, for the refusals
 * @param keyType - The record's key type
 * @param valueType - The record's row type
 * @param on - The exact leading fields
 * @param box - How the row's box is read
 * @param exponent - The finest cell's side is `2^exponent`
 * @param prefix - The leading fields' generated key function
 * @returns The key function, whether it fans out, and whether `x` and `y` are Options
 * @throws {Error} When a field is not of its option's type, naming the option,
 *   the field and its type; when `x` and `y` are not both Options or neither;
 *   when `width` and `height` are not given together; or when the row has a
 *   field named `__area`, which is reserved
 */
export function areaKey(name: string, keyType: EastType, valueType: EastType, on: readonly string[], box: AreaBox,
  exponent: number, prefix?: { fn: IndexFunction; multi: boolean }) {
  if (valueType.type !== 'Struct') throw new Error(`e3.recordIndex.area '${name}' indexes a record with Struct rows`);
  const rowType = valueType as StructType<Record<string, EastType>>;
  if (Object.hasOwn(rowType.fields, AREA_FIELD)) {
    throw new Error(`e3.recordIndex.area '${name}': the row has a field named '${AREA_FIELD}', which an area index reserves for its key`);
  }
  const typeOf = (option: string, field: string): EastType => {
    const type = rowType.fields[field];
    if (type === undefined) throw new Error(`e3.recordIndex.area '${name}' ${option} names unknown row field '${field}'`);
    return type;
  };
  const placeOptional = (option: string, field: string): boolean => {
    const type = typeOf(option, field);
    if (isTypeEqual(type, FloatType)) return false;
    if (isTypeEqual(type, OptionType(FloatType))) return true;
    throw new Error(`e3.recordIndex.area '${name}' ${option} names '${field}', of type ${printType(type)}: ${option} is a Float or an Option<Float> field`);
  };
  const optional = placeOptional('x', box.x);
  if (placeOptional('y', box.y) !== optional) {
    throw new Error(`e3.recordIndex.area '${name}': x '${box.x}' and y '${box.y}' are both Options, or neither — a row is placed, or not, by both`);
  }
  if ((box.width === undefined) !== (box.height === undefined)) {
    throw new Error(`e3.recordIndex.area '${name}' takes width and height together, or neither for a point`);
  }
  for (const [option, field] of [['width', box.width], ['height', box.height]] as const) {
    if (field === undefined) continue;
    const type = typeOf(option, field);
    if (!isTypeEqual(type, FloatType)) {
      throw new Error(`e3.recordIndex.area '${name}' ${option} names '${field}', of type ${printType(type)}: ${option} is a Float field`);
    }
  }
  if (box.at !== 'corner' && box.at !== 'centre') {
    throw new Error(`e3.recordIndex.area '${name}' at is "corner" or "centre", not ${JSON.stringify(box.at)}`);
  }
  const fields = Object.fromEntries(on.map((field) => {
    const type = rowType.fields[field]!;
    return [field, type.type === 'Set' ? type.key : type];
  }));
  const indexType = StructType({ ...fields, [AREA_FIELD]: IntegerType });
  const multi = prefix?.multi ?? false;
  const prefixType = prefix === undefined ? undefined : Expr.type(prefix.fn as unknown as Expr) as { output: EastType };
  const code = areaCode(exponent);
  // Dynamic field names are erased only inside this generated East function,
  // as in the field and interval key generators; every type was checked above.
  const fn = East.function([keyType as never, rowType], (multi ? SetType(indexType) : indexType) as never, ($: any, key: any, row: any) => {
    const locate = $.const(code);
    // The box's larger side; a point has none.
    const larger = $.let(box.width === undefined ? 0.0
      : row[box.width].abs().greaterEqual(row[box.height!].abs()).ifElse(() => row[box.width!].abs(), () => row[box.height!].abs()), FloatType);
    // Its centre: `x`, `y` itself, or the minimum corner plus half the box.
    const centre = (at: any, extent: string | undefined) => box.at === 'centre' || extent === undefined
      ? at : at.add(row[extent].divide(2.0));
    const area = $.let(AREA_UNPLACED, IntegerType);
    if (optional) {
      $.match(row[box.x], { some: ($: any, x: any) => {
        $.match(row[box.y], { some: ($: any, y: any) => {
          $.assign(area, locate(centre(x, box.width), centre(y, box.height), larger));
        } });
      } });
    } else {
      $.assign(area, locate(centre(row[box.x], box.width), centre(row[box.y], box.height), larger));
    }
    if (prefix === undefined) return { [AREA_FIELD]: area };
    const make = $.const(prefix.fn as FunctionExpr<any, any>);
    const values = $.let(make(key, row), prefixType!.output);
    const entry = (value: any) => ({ ...Object.fromEntries(on.map((field) => [field, on.length === 1 ? value : value[field]])), [AREA_FIELD]: area });
    if (!prefix.multi) return entry(values);
    const keys = $.let(new Set(), SetType(indexType));
    $.for(values, ($: any, value: any) => { $(keys.insert(entry(value))); });
    return keys;
  });
  return { fn, multi, optional };
}
