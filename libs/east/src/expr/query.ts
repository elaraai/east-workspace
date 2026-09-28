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

import type { AST, VariableAST } from "../ast.js";
import { get_location_id } from "../location.js";
import { QueryError } from "../query/evaluate.js";
import { checkJq } from "../query/jq/check.js";
import { report } from "../query/jq/messages.js";
import { parseJq } from "../query/jq/parse.js";
import { printJq } from "../query/jq/print.js";
import { translateJq } from "../query/jq/translate.js";
import { describeType } from "../query/jq/shapes.js";
import { ArrayType, NullType, StringType, StructType, isTypeEqual, type EastType } from "../types.js";
import { valueOrExprToAstTyped } from "./ast.js";
import { fromAst } from "./block.js";
import { AstSymbol, Expr } from "./expr.js";

/**
 * A jq query over East values, as East code: the query is parsed, checked
 * against its inputs' types and translated to ordinary East IR when the
 * program is built, so it runs wherever East runs.
 *
 * @param input - the query's input: an expression, or an object of named
 *   expressions, which the query reads as an e3 root (`.orders` is the
 *   `orders` input, read alone, so a lazy input stays lazy)
 * @param program - the jq text
 * @param resultType - the result's type, when given: it must be the one the
 *   query checks to
 * @returns the result: the element for a query that gives one output, an
 *   `Option` for one that gives at most one, an `Array` for one that gives
 *   any number
 * @throws {QueryError} When the query does not check, with the checker's
 *   diagnostics; or when `resultType` is not the query's result type, naming
 *   both.
 * @throws East runtime error if the query raises one as it runs: `error(v)`,
 *   an integer division by zero, a date that does not parse; the error names
 *   its line and column in the jq text.
 *
 * @remarks
 * The expression is a block: a marker statement holding the query's canonical
 * text and its inputs' names, which printers read back as `East.jq(…)`; one
 * `let` per input; then the translation. The marker costs one constant and
 * nothing reads it at run time.
 *
 * @example
 * ```ts
 * const Order = StructType({ id: IntegerType, total: FloatType });
 * const bigOrders = East.function([ArrayType(Order)], ArrayType(IntegerType), ($, orders) =>
 *   East.jq(orders, "[.[] | select(.total > 1000) | .id]", ArrayType(IntegerType)));
 * const compiled = East.compile(bigOrders, []);
 * compiled([{ id: 1n, total: 250.0 }, { id: 2n, total: 1200.0 }]);  // [2n]
 * ```
 */
export function jq(input: Expr | { readonly [name: string]: Expr }, program: string, resultType?: EastType): Expr {
  const named = !(input instanceof Expr);
  const names = named ? Object.keys(input) : [];
  const values = named ? names.map(n => (input as Record<string, Expr>)[n]!) : [input];
  const inputType = named
    ? StructType(Object.fromEntries(names.map((n, i) => [n, Expr.type(values[i]!) as EastType])))
    : Expr.type(input) as EastType;
  const parsed = parseJq(program);
  const checked = checkJq(parsed, inputType, { root: named });
  if (checked.query === null) throw new QueryError(checked.diagnostics);
  const translation = translateJq(checked);
  if (resultType !== undefined && !isTypeEqual(resultType, translation.resultType)) {
    const message = `type_mismatch: the query gives ${describeType(translation.resultType)}, not the ${describeType(resultType)} it was given.`;
    throw new QueryError([report(program, "type_mismatch", undefined, message)]);
  }
  const loc = get_location_id();
  const canonical = parsed.program.type === "some" ? printJq(parsed.program.value).text : program;
  // The marker: the query as printers show it again.
  const marker = valueOrExprToAstTyped({ east_jq: canonical, inputs: names }, StructType({ east_jq: StringType, inputs: ArrayType(StringType) }), undefined, loc);
  const statements: AST[] = [marker];
  const bound = new Map<string, Expr>();
  values.forEach((value, i) => {
    const type = Expr.type(value) as EastType;
    const variable: VariableAST = { ast_type: "Variable", type, loc_id: loc, mutable: false, name: named ? names[i] : "input" };
    statements.push({ ast_type: "Let", type: NullType, loc_id: loc, variable, value: (value as any)[AstSymbol] as AST });
    bound.set(named ? names[i]! : "", fromAst(variable) as Expr);
  });
  const args = translation.inputs.map(i => bound.get(i.name ?? "")!);
  const result = (translation.build(...args) as any)[AstSymbol] as AST;
  if (result.ast_type === "Block") statements.push(...result.statements);
  else statements.push(result);
  const last = statements[statements.length - 1]!;
  return fromAst({ ast_type: "Block", type: last.type.type === "Never" ? last.type : translation.resultType, loc_id: loc, statements });
}
