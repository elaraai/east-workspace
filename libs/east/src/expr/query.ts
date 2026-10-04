/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * `East.jq`: a typed jq query as East code, translated when the program is
 * built (`devdocs/QUERY.md` §15).
 *
 * @packageDocumentation
 */

import { QueryError } from "../query/evaluate.js";
import { checkJq } from "../query/jq/check.js";
import { report } from "../query/jq/messages.js";
import { translateJq } from "../query/jq/translate.js";
import { describeType } from "../query/jq/shapes.js";
import { StructType, isTypeEqual, type EastType } from "../types.js";
import { Expr } from "./expr.js";
import type { ExprType } from "./types.js";

/**
 * A jq query over East values, as East code: the query is parsed, checked
 * against its inputs' types and translated to ordinary East IR when the
 * program is built, so it runs wherever East runs.
 *
 * @typeParam T - the query's result type
 * @param input - the query's input: an expression, or an object of named
 *   expressions, which the query reads as an e3 root (`.orders` is the
 *   `orders` input, read alone, so a lazy input stays lazy)
 * @param program - the jq text
 * @param resultType - the query's result type: its outputs' type for a query
 *   that gives one output, an `Option` of it for one that gives at most one,
 *   an `Array` of it for one that gives any number. The query must check to
 *   exactly this type, and it types the expression.
 * @returns the query's result, an expression of `resultType`
 * @throws {QueryError} When the query does not check, with the checker's
 *   diagnostics; or when it does not check to `resultType`, naming both
 *   types.
 * @throws East runtime error if the query raises one as it runs: `error(v)`,
 *   an integer division by zero, a date that does not parse; the error names
 *   its line and column in the jq text.
 *
 * @remarks
 * The expression is a call of the `Query` builtin (#1041), whose arguments
 * are the program as written and a root's input names, a typed constant, and
 * its translation, an East function of the inputs; the call's arguments are
 * the inputs, each named input among them whether the query reads it or not.
 * Running the call runs the translation, and printers print it back as
 * `East.jq(…)` from its program.
 *
 * @example
 * ```ts
 * const Order = StructType({ id: IntegerType, total: FloatType });
 * const bigOrders = East.function([ArrayType(Order)], ArrayType(IntegerType), ($, orders) =>
 *   East.jq(orders, "[.[] | select(.total > 1000) | .id]", ArrayType(IntegerType)));
 * const compiled = East.compile(bigOrders, []);
 * compiled([{ id: 1n, total: 250.0 }, { id: 2n, total: 1200.0 }]);  // [2n]
 * ```
 *
 * @example
 * ```ts
 * // The result is an expression of its result type (here an ArrayExpr<FloatType>), so its methods chain.
 * const Order = StructType({ id: IntegerType, total: FloatType });
 * const revenue = East.function([ArrayType(Order)], FloatType, ($, orders) =>
 *   East.jq(orders, "map(.total)", ArrayType(FloatType)).sum());
 * const compiled = East.compile(revenue, []);
 * compiled([{ id: 1n, total: 250.0 }, { id: 2n, total: 1200.0 }]);  // 1450.0
 * ```
 */
export function jq<T extends EastType>(input: Expr | { readonly [name: string]: Expr }, program: string, resultType: T): ExprType<T> {
  const named = !(input instanceof Expr);
  const names = named ? Object.keys(input) : [];
  const values = named ? names.map(n => (input as Record<string, Expr>)[n]!) : [input];
  const inputType = named
    ? StructType(Object.fromEntries(names.map((n, i) => [n, Expr.type(values[i]!) as EastType])))
    : Expr.type(input) as EastType;
  const checked = checkJq(program, inputType, { root: named });
  if (checked.program === null) throw new QueryError(checked.diagnostics);
  const translation = translateJq(checked);
  if (!isTypeEqual(resultType, translation.resultType)) {
    const message = `type_mismatch: the query gives ${describeType(translation.resultType)}, not the ${describeType(resultType)} it was given.`;
    throw new QueryError([report(program, "type_mismatch", undefined, message)]);
  }
  return translation.call(...values) as ExprType<T>;
}
