/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { AST } from "../ast.js";
import { type BuiltinName } from "../builtins.js";
import { get_location_id } from "../location.js";
import { BooleanType, FloatType, IntegerType, VectorType, MatrixType, FunctionType, ArrayType, type EastType, type NeverType, isSubtype, printType, isTypeEqual } from "../types.js";
import { valueOrExprToAst, valueOrExprToAstTyped } from "./ast.js";
import type { IntegerExpr } from "./integer.js";
import { AstSymbol, Expr, FactorySymbol, TypeSymbol, type ToExpr } from "./expr.js";
import type { SubtypeExprOrValue, ExprType, TypeOf } from "./types.js";
import type { BlockBuilder } from "./block.js";
import type { ArrayExpr } from "./array.js";
import type { MatrixExpr } from "./matrix.js";

/**
 * Expression representing immutable vector (1D typed array) values and operations.
 *
 * VectorExpr provides methods for vector manipulation including element access,
 * functional update, slicing, concatenation, conversion, and higher-order
 * operations. Vectors are backed by contiguous typed arrays (Float64Array,
 * BigInt64Array, or Uint8Array) for efficient numeric computation and zero-copy
 * interop with ML libraries.
 */
export class VectorExpr<T extends any> extends Expr<VectorType<T>> {
  constructor(private element_type: T, ast: AST, createExpr: ToExpr) {
    super(ast.type as VectorType<T>, ast, createExpr);
  }

  /**
   * Returns the number of elements in the vector.
   *
   * @returns An IntegerExpr representing the length
   */
  length(): IntegerExpr {
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: IntegerType,
      loc_id: get_location_id(),
      builtin: "VectorLength",
      type_parameters: [this.element_type as EastType],
      arguments: [this[AstSymbol]],
    }) as IntegerExpr;
  }

  /**
   * Gets the element at the specified index.
   *
   * @param index - The zero-based index to access
   * @returns An expression of the element type
   *
   * @throws East runtime error if the index is out of bounds
   */
  get(index: SubtypeExprOrValue<IntegerType>): ExprType<T> {
    const idx = valueOrExprToAstTyped(index, IntegerType);
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: this.element_type as EastType,
      loc_id: get_location_id(),
      builtin: "VectorGet",
      type_parameters: [this.element_type as EastType],
      arguments: [this[AstSymbol], idx],
    }) as ExprType<T>;
  }

  /**
   * Returns a new vector with the element at the specified index replaced.
   *
   * @param index - The zero-based index to set
   * @param value - The new value to store at that index
   * @returns A new VectorExpr with the element at index replaced by value
   *
   * @throws East runtime error if the index is out of bounds
   */
  set(index: SubtypeExprOrValue<IntegerType>, value: SubtypeExprOrValue<T>): VectorExpr<T> {
    const idx = valueOrExprToAstTyped(index, IntegerType);
    const val = valueOrExprToAstTyped(value, this.element_type as EastType);
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: VectorType(this.element_type as EastType),
      loc_id: get_location_id(),
      builtin: "VectorSet",
      type_parameters: [this.element_type as EastType],
      arguments: [this[AstSymbol], idx, val],
    }) as VectorExpr<T>;
  }

  /**
   * Returns a new vector containing elements from start (inclusive) to end (exclusive).
   *
   * @param start - The start index (inclusive)
   * @param end - The end index (exclusive)
   * @returns A new VectorExpr containing the sliced elements
   *
   * @throws East runtime error if indices are out of bounds
   */
  slice(start: SubtypeExprOrValue<IntegerType>, end: SubtypeExprOrValue<IntegerType>): VectorExpr<T> {
    const s = valueOrExprToAstTyped(start, IntegerType);
    const e = valueOrExprToAstTyped(end, IntegerType);
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: VectorType(this.element_type as EastType),
      loc_id: get_location_id(),
      builtin: "VectorSlice",
      type_parameters: [this.element_type as EastType],
      arguments: [this[AstSymbol], s, e],
    }) as VectorExpr<T>;
  }

  /**
   * Concatenates this vector with another vector of the same element type.
   *
   * @param other - The other vector to concatenate
   * @returns A new VectorExpr containing elements from both vectors
   */
  concat(other: Expr<VectorType<T>>): VectorExpr<T> {
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: VectorType(this.element_type as EastType),
      loc_id: get_location_id(),
      builtin: "VectorConcat",
      type_parameters: [this.element_type as EastType],
      arguments: [this[AstSymbol], Expr.ast(other)],
    }) as VectorExpr<T>;
  }

  /**
   * Converts this vector to an Array.
   *
   * @returns An ArrayExpr containing the same elements
   */
  toArray(): ArrayExpr<T> {
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: ArrayType(this.element_type as EastType),
      loc_id: get_location_id(),
      builtin: "VectorToArray",
      type_parameters: [this.element_type as EastType],
      arguments: [this[AstSymbol]],
    }) as ArrayExpr<T>;
  }

  /**
   * Reshapes this vector into a matrix with the specified dimensions.
   * Requires rows * cols == length of the vector.
   *
   * @param rows - The number of rows in the resulting matrix
   * @param cols - The number of columns in the resulting matrix
   * @returns A MatrixExpr with the specified shape
   *
   * @throws East runtime error if rows * cols does not equal the vector length
   */
  toMatrix(rows: SubtypeExprOrValue<IntegerType>, cols: SubtypeExprOrValue<IntegerType>): MatrixExpr<T> {
    const r = valueOrExprToAstTyped(rows, IntegerType);
    const c = valueOrExprToAstTyped(cols, IntegerType);
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: MatrixType(this.element_type as EastType),
      loc_id: get_location_id(),
      builtin: "VectorToMatrix",
      type_parameters: [this.element_type as EastType],
      arguments: [this[AstSymbol], r, c],
    }) as any;
  }

  /**
   * Maps a function over each element and its index, producing a new vector.
   *
   * @param fn - Function taking (element, index) and returning a new value
   * @returns A new VectorExpr with the mapped values
   */
  map<T2>(fn: Expr<FunctionType<[T, IntegerType], T2>>): VectorExpr<T2>;
  map<F extends (($: BlockBuilder<NeverType>, v: ExprType<T>, k: ExprType<IntegerType>) => any)>(fn: F): VectorExpr<TypeOf<ReturnType<F>>>;
  map(fn: Expr<FunctionType> | (($: BlockBuilder<NeverType>, x: ExprType<T>, y: ExprType<IntegerType>) => any)): Expr<VectorType> {
    if (fn instanceof Expr) {
      if (!(fn[TypeSymbol] && fn[TypeSymbol].type === "Function")) {
        throw new Error("Expected a Function expression");
      }
      const output_type = (fn[TypeSymbol] as FunctionType<any[], any>).output as EastType;
      const n_inputs = (fn[TypeSymbol] as FunctionType<any[], any>).inputs.length;
      if (n_inputs === 2) {
        if (!isSubtype(this.element_type as EastType, (fn[TypeSymbol] as FunctionType<any[], any>).inputs[0] as EastType)) {
          throw new Error(`Expected Function input to be ${printType(this.element_type as EastType)}, got ${printType((fn[TypeSymbol] as FunctionType<any[], any>).inputs[0] as EastType)}`);
        }
        if (!isTypeEqual(IntegerType, (fn[TypeSymbol] as FunctionType<any[], any>).inputs[1] as EastType)) {
          throw new Error(`Expected Function second input to be ${printType(IntegerType)}, got ${printType((fn[TypeSymbol] as FunctionType<any[], any>).inputs[1] as EastType)}`);
        }

        return this[FactorySymbol]({
          ast_type: "Builtin",
          type: VectorType(output_type),
          loc_id: get_location_id(),
          builtin: "VectorMap",
          type_parameters: [this.element_type as EastType, output_type],
          arguments: [this[AstSymbol], fn[AstSymbol]],
        });
      } else {
        throw new Error(`Expected Function to have 2 inputs, got ${n_inputs} inputs`);
      }
    } else {
      const functionExpr = Expr.function([this.element_type, IntegerType], undefined, fn);
      return this.map(functionExpr);
    }
  }

  /**
   * Reduces the vector to a single value using an accumulator function and initial value.
   *
   * @param combineFn - Function taking (accumulator, element, index) and returning the new accumulator value
   * @param init - Initial value for the reduction (determines output type)
   * @returns The final accumulated value
   */
  reduce<T2>(combineFn: SubtypeExprOrValue<FunctionType<[previous: TypeOf<NoInfer<T2>>, value: T, key: IntegerType], TypeOf<NoInfer<T2>>>>, init: T2): ExprType<TypeOf<T2>> {
    const initAst = valueOrExprToAst(init);
    const returnType = initAst.type;

    const combineAst = valueOrExprToAstTyped(combineFn, FunctionType([returnType, this.element_type, IntegerType], returnType));

    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: returnType as EastType,
      loc_id: get_location_id(),
      builtin: "VectorFold",
      type_parameters: [this.element_type as EastType, returnType as EastType],
      arguments: [this[AstSymbol], initAst, combineAst],
    }) as ExprType<TypeOf<T2>>;
  }

  /** Requires a Float or Integer element type for the arithmetic builtins. */
  private numericElem(method: string): EastType {
    const t = this.element_type as EastType;
    if (t.type !== "Float" && t.type !== "Integer") {
      throw new Error(`Vector.${method} requires a Float or Integer element type, got ${printType(t)}`);
    }
    return t;
  }

  /** Requires a Boolean element type for the mask builtins. */
  private maskElem(method: string): void {
    if ((this.element_type as EastType).type !== "Boolean") {
      throw new Error(`Vector.${method} requires a Boolean element type, got ${printType(this.element_type as EastType)}`);
    }
  }

  /** Builds a unary/binary elementwise builtin returning a vector of this element type. */
  private elementwise(builtin: BuiltinName, args: AST[]): VectorExpr<T> {
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: VectorType(this.element_type as EastType),
      loc_id: get_location_id(),
      builtin,
      type_parameters: [this.element_type as EastType],
      arguments: [this[AstSymbol], ...args],
    }) as VectorExpr<T>;
  }

  /**
   * Multiplies every element by a scalar, producing a new vector.
   *
   * @param alpha - The scalar factor (same type as the elements)
   * @returns A new VectorExpr with every element scaled by alpha
   */
  scale(alpha: SubtypeExprOrValue<T>): VectorExpr<T> {
    const elem = this.numericElem("scale");
    return this.elementwise("VectorScale", [valueOrExprToAstTyped(alpha, elem)]);
  }

  /**
   * Sums the elements in index order, left to right.
   *
   * The accumulation order is part of the cross-runtime contract: a
   * reassociated float sum gives a different last bit. An empty vector sums
   * to zero.
   *
   * @returns An expression of the element type holding the sum
   */
  sum(): ExprType<T> {
    const elem = this.numericElem("sum");
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: elem,
      loc_id: get_location_id(),
      builtin: "VectorSum",
      type_parameters: [elem],
      arguments: [this[AstSymbol]],
    }) as ExprType<T>;
  }

  /**
   * Adds a scaled vector elementwise: `this + alpha * other`.
   *
   * Add and subtract fall out at `alpha` of one and minus one.
   *
   * @param other - The vector to scale and add (same length and element type)
   * @param alpha - The scalar factor applied to other
   * @returns A new VectorExpr holding the combined elements
   *
   * @throws East runtime error if the vector lengths differ
   */
  addScaled(other: SubtypeExprOrValue<VectorType<T>>, alpha: SubtypeExprOrValue<T>): VectorExpr<T> {
    const elem = this.numericElem("addScaled");
    return this.elementwise("VectorAddScaled", [
      valueOrExprToAstTyped(other, VectorType(elem)),
      valueOrExprToAstTyped(alpha, elem),
    ]);
  }

  /**
   * Multiplies two vectors elementwise.
   *
   * @param other - The vector to multiply with (same length and element type)
   * @returns A new VectorExpr holding the elementwise products
   *
   * @throws East runtime error if the vector lengths differ
   */
  mul(other: SubtypeExprOrValue<VectorType<T>>): VectorExpr<T> {
    const elem = this.numericElem("mul");
    return this.elementwise("VectorMul", [valueOrExprToAstTyped(other, VectorType(elem))]);
  }

  /**
   * Adds a scalar to every element, producing a new vector.
   *
   * @param value - The scalar addend (same type as the elements)
   * @returns A new VectorExpr with value added to every element
   */
  addScalar(value: SubtypeExprOrValue<T>): VectorExpr<T> {
    const elem = this.numericElem("addScalar");
    return this.elementwise("VectorAddScalar", [valueOrExprToAstTyped(value, elem)]);
  }

  /**
   * Computes the dot product, accumulating in index order, left to right.
   *
   * @param other - The vector to multiply with (same length and element type)
   * @returns An expression of the element type holding the dot product
   *
   * @throws East runtime error if the vector lengths differ
   */
  dot(other: SubtypeExprOrValue<VectorType<T>>): ExprType<T> {
    const elem = this.numericElem("dot");
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: elem,
      loc_id: get_location_id(),
      builtin: "VectorDot",
      type_parameters: [elem],
      arguments: [this[AstSymbol], valueOrExprToAstTyped(other, VectorType(elem))],
    }) as ExprType<T>;
  }

  /**
   * Returns the largest element under East's total order (NaN is greatest).
   * Ties resolve to the earliest occurrence.
   *
   * @returns An expression of the element type holding the maximum
   *
   * @throws East runtime error if the vector is empty
   */
  max(): ExprType<T> {
    const elem = this.numericElem("max");
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: elem,
      loc_id: get_location_id(),
      builtin: "VectorMax",
      type_parameters: [elem],
      arguments: [this[AstSymbol]],
    }) as ExprType<T>;
  }

  /**
   * Returns the smallest element under East's total order.
   * Ties resolve to the earliest occurrence.
   *
   * @returns An expression of the element type holding the minimum
   *
   * @throws East runtime error if the vector is empty
   */
  min(): ExprType<T> {
    const elem = this.numericElem("min");
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: elem,
      loc_id: get_location_id(),
      builtin: "VectorMin",
      type_parameters: [elem],
      arguments: [this[AstSymbol]],
    }) as ExprType<T>;
  }

  /**
   * Returns the index of the largest element under East's total order.
   * Ties resolve to the earliest occurrence.
   *
   * @returns An IntegerExpr holding the index of the maximum
   *
   * @throws East runtime error if the vector is empty
   */
  argMax(): IntegerExpr {
    const elem = this.numericElem("argMax");
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: IntegerType,
      loc_id: get_location_id(),
      builtin: "VectorArgMax",
      type_parameters: [elem],
      arguments: [this[AstSymbol]],
    }) as IntegerExpr;
  }

  /**
   * Returns the index of the smallest element under East's total order.
   * Ties resolve to the earliest occurrence.
   *
   * @returns An IntegerExpr holding the index of the minimum
   *
   * @throws East runtime error if the vector is empty
   */
  argMin(): IntegerExpr {
    const elem = this.numericElem("argMin");
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: IntegerType,
      loc_id: get_location_id(),
      builtin: "VectorArgMin",
      type_parameters: [elem],
      arguments: [this[AstSymbol]],
    }) as IntegerExpr;
  }

  /**
   * Computes the arithmetic mean as a Float, accumulating in index order.
   * Integer elements widen to Float per element; an empty vector yields NaN.
   *
   * @returns A FloatExpr holding the mean
   */
  mean(): ExprType<FloatType> {
    const elem = this.numericElem("mean");
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: FloatType,
      loc_id: get_location_id(),
      builtin: "VectorMean",
      type_parameters: [elem],
      arguments: [this[AstSymbol]],
    }) as ExprType<FloatType>;
  }

  /**
   * Computes the running sum in index order, left to right.
   * Element i of the result is the sum of elements 0 through i.
   *
   * @returns A new VectorExpr of the running sums
   */
  cumSum(): VectorExpr<T> {
    this.numericElem("cumSum");
    return this.elementwise("VectorCumSum", []);
  }

  /**
   * Takes the absolute value of every element.
   *
   * @returns A new VectorExpr with every element replaced by its magnitude
   */
  abs(): VectorExpr<T> {
    this.numericElem("abs");
    return this.elementwise("VectorAbs", []);
  }

  /**
   * Clamps every element between lo and hi under East's total order:
   * an element below lo becomes lo, one above hi becomes hi.
   *
   * @param lo - The lower bound (same type as the elements)
   * @param hi - The upper bound (same type as the elements)
   * @returns A new VectorExpr with every element clamped
   */
  clamp(lo: SubtypeExprOrValue<T>, hi: SubtypeExprOrValue<T>): VectorExpr<T> {
    const elem = this.numericElem("clamp");
    return this.elementwise("VectorClamp", [
      valueOrExprToAstTyped(lo, elem),
      valueOrExprToAstTyped(hi, elem),
    ]);
  }

  /**
   * Gathers elements at the given indices: element j of the result is
   * `this[indices[j]]`.
   *
   * @param indices - The indices to read, as a Vector of Integers
   * @returns A new VectorExpr with one element per index
   *
   * @throws East runtime error if any index is out of bounds
   */
  gather(indices: SubtypeExprOrValue<VectorType<IntegerType>>): VectorExpr<T> {
    return this.elementwise("VectorGather", [valueOrExprToAstTyped(indices, VectorType(IntegerType))]);
  }

  /**
   * Returns a copy of this vector with `src[j]` added at `indices[j]` for
   * each j in order. Duplicate indices accumulate in input order.
   *
   * @param indices - The target index for each source element
   * @param src - The values to add (same length as indices)
   * @returns A new VectorExpr with the additions applied
   *
   * @throws East runtime error if the index and source lengths differ, or any index is out of bounds
   */
  scatterAdd(indices: SubtypeExprOrValue<VectorType<IntegerType>>, src: SubtypeExprOrValue<VectorType<T>>): VectorExpr<T> {
    const elem = this.numericElem("scatterAdd");
    return this.elementwise("VectorScatterAdd", [
      valueOrExprToAstTyped(indices, VectorType(IntegerType)),
      valueOrExprToAstTyped(src, VectorType(elem)),
    ]);
  }

  /**
   * Finds, for each needle, the leftmost insertion index that keeps this
   * (sorted) vector sorted under East's total order — numpy's
   * `searchsorted` with side "left". Assumes this vector is sorted; the
   * result is unspecified otherwise.
   *
   * @param needles - The values to locate
   * @returns A VectorExpr of Integers holding one insertion index per needle
   */
  searchSorted(needles: SubtypeExprOrValue<VectorType<T>>): VectorExpr<IntegerType> {
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: VectorType(IntegerType),
      loc_id: get_location_id(),
      builtin: "VectorSearchSorted",
      type_parameters: [this.element_type as EastType],
      arguments: [this[AstSymbol], valueOrExprToAstTyped(needles, VectorType(this.element_type as EastType))],
    }) as VectorExpr<IntegerType>;
  }

  /** Builds an elementwise comparison builtin returning a Boolean mask. */
  private comparison(builtin: BuiltinName, other: SubtypeExprOrValue<VectorType<T>>): VectorExpr<BooleanType> {
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: VectorType(BooleanType),
      loc_id: get_location_id(),
      builtin,
      type_parameters: [this.element_type as EastType],
      arguments: [this[AstSymbol], valueOrExprToAstTyped(other, VectorType(this.element_type as EastType))],
    }) as VectorExpr<BooleanType>;
  }

  /**
   * Compares elementwise for equality under East's equality (NaN equals NaN,
   * negative zero differs from positive zero), producing a Boolean mask.
   *
   * @param other - The vector to compare with (same length and element type)
   * @returns A VectorExpr of Booleans, true where elements are equal
   *
   * @throws East runtime error if the vector lengths differ
   */
  eq(other: SubtypeExprOrValue<VectorType<T>>): VectorExpr<BooleanType> {
    return this.comparison("VectorEq", other);
  }

  /**
   * Compares elementwise with less-than under East's total order,
   * producing a Boolean mask.
   *
   * @param other - The vector to compare with (same length and element type)
   * @returns A VectorExpr of Booleans, true where this element is less
   *
   * @throws East runtime error if the vector lengths differ
   */
  lt(other: SubtypeExprOrValue<VectorType<T>>): VectorExpr<BooleanType> {
    return this.comparison("VectorLt", other);
  }

  /**
   * Compares elementwise with greater-than under East's total order,
   * producing a Boolean mask.
   *
   * @param other - The vector to compare with (same length and element type)
   * @returns A VectorExpr of Booleans, true where this element is greater
   *
   * @throws East runtime error if the vector lengths differ
   */
  gt(other: SubtypeExprOrValue<VectorType<T>>): VectorExpr<BooleanType> {
    return this.comparison("VectorGt", other);
  }

  /**
   * Selects elementwise from two vectors using this Boolean vector as the
   * mask: element i of the result is `a[i]` where this mask is true, else
   * `b[i]`.
   *
   * @param a - The vector supplying elements where the mask is true
   * @param b - The vector supplying elements where the mask is false
   * @returns A new VectorExpr of the selected elements
   *
   * @throws East runtime error if the vector lengths differ
   */
  select<T2>(a: Expr<VectorType<T2>>, b: SubtypeExprOrValue<VectorType<T2>>): VectorExpr<T2> {
    this.maskElem("select");
    const elem = (Expr.type(a) as VectorType).element as EastType;
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: VectorType(elem),
      loc_id: get_location_id(),
      builtin: "VectorSelect",
      type_parameters: [elem],
      arguments: [this[AstSymbol], Expr.ast(a), valueOrExprToAstTyped(b, VectorType(elem))],
    }) as VectorExpr<T2>;
  }

  /**
   * Keeps the elements where the mask is true, in order — the dense
   * analogue of the sparse noise-floor filter.
   *
   * @param mask - The Boolean vector deciding which elements survive
   * @returns A new VectorExpr holding the surviving elements
   *
   * @throws East runtime error if the mask and vector lengths differ
   */
  compress(mask: SubtypeExprOrValue<VectorType<BooleanType>>): VectorExpr<T> {
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: VectorType(this.element_type as EastType),
      loc_id: get_location_id(),
      builtin: "VectorCompress",
      type_parameters: [this.element_type as EastType],
      arguments: [valueOrExprToAstTyped(mask, VectorType(BooleanType)), this[AstSymbol]],
    }) as VectorExpr<T>;
  }

  /**
   * Counts the true elements of this Boolean vector.
   *
   * @returns An IntegerExpr holding the number of true elements
   */
  countTrue(): IntegerExpr {
    this.maskElem("countTrue");
    return this[FactorySymbol]({
      ast_type: "Builtin",
      type: IntegerType,
      loc_id: get_location_id(),
      builtin: "VectorCountTrue",
      type_parameters: [],
      arguments: [this[AstSymbol]],
    }) as IntegerExpr;
  }
}
