/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Patches of a record's rows, whose type its declaration gives.
 *
 * A write program diffs, applies and composes patches of its record's rows.
 * East types those operations by the row's type as an author writes it — the
 * patch of a type is a type TypeScript computes from it — but a write
 * program's row type is the record's, known only as the program is built, and
 * TypeScript cannot compute the patch of a type it does not know: it recurses
 * without end. So a row's patch type is East's own, from the type's runtime
 * form, and the three operations are made here as East functions of the row's
 * type, typed as functions of some East type. East builds each from the real
 * types, which its expressions carry, and a write program calls them as it
 * calls any other function.
 *
 * The region meeting East's typed operations is marked so: it is the one place
 * a write program's types are not checked.
 *
 * @packageDocumentation
 */
import { East, PatchType, toEastTypeValue, type EastType, type Expr, type FunctionExpr } from '@elaraai/east';

/** The patches of a type's values — a record's rows, its state — and the operations a write program runs on them. */
export interface Patches {
  /** The rows' patch type, `PatchType(V)`. */
  readonly patchType: EastType;
  /** `(before, after) → the patch between them` */
  readonly diff: FunctionExpr<[EastType, EastType], EastType>;
  /** `(row, patch) → the row patched`: an East error when the patch was made against another row. */
  readonly apply: FunctionExpr<[EastType, EastType], EastType>;
  /** `(first, second) → one patch doing both` */
  readonly compose: FunctionExpr<[EastType, EastType], EastType>;
}

/**
 * The patch type of a type known only at run time: East's own, made from the
 * type's runtime form, as a generic factory makes it.
 *
 * @param type - The type
 * @returns `PatchType(type)`
 */
export function patchTypeOf(type: EastType): EastType {
  return PatchType(toEastTypeValue(type));
}

/* eslint-disable east/east-rules -- East's patch operations, over a row type whose patch TypeScript cannot compute */

/**
 * East's patch operations at the signature a write program uses them at:
 * values of some East type. East takes each value's real type from its
 * expression; TypeScript, which would compute the patch's type from it, cannot,
 * so these name none.
 */
const diffOf: (before: Expr<EastType>, after: Expr<EastType>) => never = East.diff as never;
const applyOf: (value: Expr<EastType>, patch: Expr<EastType>) => never = East.applyPatch as never;
const composeOf: (first: Expr<EastType>, second: Expr<EastType>, type: EastType) => never = East.composePatch as never;

/**
 * The patches of a type's values: their type, and the operations on them, each
 * an East function of the type.
 *
 * @param rowType - The values' type
 * @returns The patch type and the operations
 */
export function patchesOf(rowType: EastType): Patches {
  const patchType = patchTypeOf(rowType);
  return {
    patchType,
    diff: East.function([rowType, rowType], patchType, (_$, before, after) => diffOf(before, after)),
    apply: East.function([rowType, patchType], rowType, (_$, row, patch) => applyOf(row, patch)),
    compose: East.function([patchType, patchType], patchType, (_$, first, second) => composeOf(first, second, rowType)),
  };
}

/* eslint-enable east/east-rules */
