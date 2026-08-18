/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import { VectorType, FloatType, IntegerType, StructType, type EastType, ArrayType, printType } from "../../types.js";
import { AstSymbol, Expr, TypeSymbol } from "../expr.js";
import type { ExprType, SubtypeExprOrValue, TypeOf } from "../types.js";
import type { VectorExpr } from "../vector.js";

/** A sparse numeric accumulator: strictly ascending indices paired with values. */
export type SparsePair<E> = StructType<{ ix: VectorType<IntegerType>, v: VectorType<E> }>;

/** The Float/Integer element type of a lifted values vector. */
function sparseElemType(fnName: string, ast: { type: EastType }): EastType {
  const t = ast.type as VectorType;
  const elem = t.element as EastType;
  if (elem.type !== "Float" && elem.type !== "Integer") {
    throw new Error(`Vector.${fnName} requires a Float or Integer element type, got ${printType(elem)}`);
  }
  return elem;
}

export default {
  zeros(length: Expr<typeof IntegerType> | bigint): VectorExpr<typeof FloatType> {
    const len = Expr.from(length, IntegerType);
    return Expr.fromAst({
      ast_type: "Builtin", type: VectorType(FloatType), builtin: "VectorZeros",
      type_parameters: [FloatType], arguments: [len[AstSymbol]], loc_id: len[AstSymbol].loc_id,
    }) as any;
  },

  ones(length: Expr<typeof IntegerType> | bigint): VectorExpr<typeof FloatType> {
    const len = Expr.from(length, IntegerType);
    return Expr.fromAst({
      ast_type: "Builtin", type: VectorType(FloatType), builtin: "VectorOnes",
      type_parameters: [FloatType], arguments: [len[AstSymbol]], loc_id: len[AstSymbol].loc_id,
    }) as any;
  },

  fill<V extends SubtypeExprOrValue<EastType>>(length: Expr<typeof IntegerType> | bigint, value: V): VectorExpr<TypeOf<V>> {
    const len = Expr.from(length, IntegerType);
    const val = Expr.from(value as any);
    const elemType = val[TypeSymbol];
    return Expr.fromAst({
      ast_type: "Builtin", type: VectorType(elemType), builtin: "VectorFill",
      type_parameters: [elemType as EastType], arguments: [len[AstSymbol], val[AstSymbol]], loc_id: len[AstSymbol].loc_id,
    }) as any;
  },

  fromArray<V extends readonly unknown[] | Expr<ArrayType<EastType>>>(arr: V): VectorExpr<TypeOf<V> extends ArrayType<infer U> ? U : EastType> {
    const arrExpr = Expr.from(arr as any);
    const arrAst = Expr.ast(arrExpr as any);
    const elemType = (arrAst.type as ArrayType).value;
    if (elemType.type !== "Float" && elemType.type !== "Integer" && elemType.type !== "Boolean") {
      throw new Error(`Vector.fromArray requires Float, Integer, or Boolean element type, got ${elemType.type}`);
    }
    return Expr.fromAst({
      ast_type: "Builtin", type: VectorType(elemType), builtin: "VectorFromArray",
      type_parameters: [elemType as EastType], arguments: [arrAst], loc_id: arrAst.loc_id,
    }) as any;
  },

  /**
   * Combines two sparse accumulators over the union of their strictly
   * ascending index vectors: `vA + alpha * vB`, as a single two-pointer
   * merge. Merge, scaled deposit and single-key accumulate all fall out of
   * one call (`alpha` of one, a scale factor, or a one-element right-hand
   * side). Entries absent from a side are structurally absent, not explicit
   * zeros: an A-only entry passes through unscaled, a B-only entry
   * contributes `alpha * vB` even when `alpha` is NaN or infinite.
   *
   * @param ixA - The left accumulator's strictly ascending indices
   * @param vA - The left accumulator's values (same length as ixA)
   * @param ixB - The right accumulator's strictly ascending indices
   * @param vB - The right accumulator's values (same length as ixB)
   * @param alpha - The scalar factor applied to vB
   * @returns A struct of the merged `ix` and `v` vectors
   *
   * @throws East runtime error if an index vector is not strictly ascending, or index and value lengths differ
   */
  sparseAxpy<V extends SubtypeExprOrValue<VectorType<EastType>>>(
    ixA: SubtypeExprOrValue<VectorType<IntegerType>>,
    vA: V,
    ixB: SubtypeExprOrValue<VectorType<IntegerType>>,
    vB: NoInfer<V>,
    alpha: TypeOf<V> extends VectorType<infer E> ? SubtypeExprOrValue<E> : never,
  ): ExprType<TypeOf<V> extends VectorType<infer E> ? SparsePair<E> : never> {
    const vAAst = Expr.ast(Expr.from(vA as any) as any);
    const elem = sparseElemType("sparseAxpy", vAAst);
    const ixAAst = Expr.ast(Expr.from(ixA as any, VectorType(IntegerType)));
    const ixBAst = Expr.ast(Expr.from(ixB as any, VectorType(IntegerType)));
    const vBAst = Expr.ast(Expr.from(vB as any, VectorType(elem)));
    const alphaAst = Expr.ast(Expr.from(alpha as any, elem) as any);
    return Expr.fromAst({
      ast_type: "Builtin",
      type: StructType({ ix: VectorType(IntegerType), v: VectorType(elem) }),
      builtin: "SparseAxpy",
      type_parameters: [elem],
      arguments: [ixAAst, vAAst, ixBAst, vBAst, alphaAst],
      loc_id: vAAst.loc_id,
    }) as any;
  },

  /**
   * Builds the canonical sparse accumulator from unsorted `(index, value)`
   * pairs: indices sort ascending and duplicate indices sum, stably, in
   * input order — so the float result is deterministic for a given input
   * order.
   *
   * @param ix - The indices, in any order, possibly with duplicates
   * @param v - The values (same length as ix)
   * @returns A struct of the canonical strictly ascending `ix` and summed `v`
   *
   * @throws East runtime error if the index and value lengths differ
   */
  sparseFromPairs<V extends SubtypeExprOrValue<VectorType<EastType>>>(
    ix: SubtypeExprOrValue<VectorType<IntegerType>>,
    v: V,
  ): ExprType<TypeOf<V> extends VectorType<infer E> ? SparsePair<E> : never> {
    const vAst = Expr.ast(Expr.from(v as any) as any);
    const elem = sparseElemType("sparseFromPairs", vAst);
    const ixAst = Expr.ast(Expr.from(ix as any, VectorType(IntegerType)));
    return Expr.fromAst({
      ast_type: "Builtin",
      type: StructType({ ix: VectorType(IntegerType), v: VectorType(elem) }),
      builtin: "SparseFromPairs",
      type_parameters: [elem],
      arguments: [ixAst, vAst],
      loc_id: vAst.loc_id,
    }) as any;
  },

  /**
   * Compacts a sparse accumulator by keeping only the entries whose value
   * is strictly greater than the threshold under East's total order —
   * shedding entries that have decayed below a noise floor, so later
   * operations on the accumulator stay proportional to its live entries.
   *
   * @param ix - The accumulator's strictly ascending indices
   * @param v - The accumulator's values (same length as ix)
   * @param threshold - The exclusive lower bound a value must exceed to survive
   * @returns A struct of the surviving `ix` and `v` entries, in order
   *
   * @throws East runtime error if the index vector is not strictly ascending, or index and value lengths differ
   */
  sparseFilterGt<V extends SubtypeExprOrValue<VectorType<EastType>>>(
    ix: SubtypeExprOrValue<VectorType<IntegerType>>,
    v: V,
    threshold: TypeOf<V> extends VectorType<infer E> ? SubtypeExprOrValue<E> : never,
  ): ExprType<TypeOf<V> extends VectorType<infer E> ? SparsePair<E> : never> {
    const vAst = Expr.ast(Expr.from(v as any) as any);
    const elem = sparseElemType("sparseFilterGt", vAst);
    const ixAst = Expr.ast(Expr.from(ix as any, VectorType(IntegerType)));
    const thresholdAst = Expr.ast(Expr.from(threshold as any, elem) as any);
    return Expr.fromAst({
      ast_type: "Builtin",
      type: StructType({ ix: VectorType(IntegerType), v: VectorType(elem) }),
      builtin: "SparseFilterGt",
      type_parameters: [elem],
      arguments: [ixAst, vAst, thresholdAst],
      loc_id: vAst.loc_id,
    }) as any;
  },
};
