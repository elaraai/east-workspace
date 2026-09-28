/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { importsEastPackage } from "../east-source.js";
import { isEastValueExpression, isEastValueShape, skipValueWrappers } from "../east-value.js";

const NAME = "no-host-comparison-on-east-values";
const CODE = 990029;

function isNullish(e: ts.Expression, t: TsModule): boolean {
  return e.kind === t.SyntaxKind.NullKeyword || (t.isIdentifier(e) && e.text === "undefined");
}

/** Is `e` a decoded East value JavaScript holds as an object — a struct, a
 * variant, a collection, a DateTime, a Blob — so `===` compares its identity? */
function isEastObject(e: ts.Expression, ctx: RuleContext): boolean {
  const type = ctx.checker.getTypeAtLocation(e);
  if (isEastValueShape(type, ctx)) return true;
  const objectLike = (type.flags & ctx.ts.TypeFlags.Object) !== 0 ||
    (type.isUnion() && type.types.some((m) => (m.flags & ctx.ts.TypeFlags.Object) !== 0));
  return objectLike && isEastValueExpression(e, ctx);
}

/** The expressions a comparator callback returns. */
function returnedExpressions(fn: ts.ArrowFunction | ts.FunctionExpression, t: TsModule): ts.Expression[] {
  if (!t.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (t.isFunctionLike(n)) return;
    if (t.isReturnStatement(n) && n.expression !== undefined) out.push(n.expression);
    t.forEachChild(n, visit);
  };
  t.forEachChild(fn.body, visit);
  return out;
}

/** The subtraction of East values a `sort` / `toSorted` comparator returns, if any. */
function subtractingComparator(call: ts.CallExpression, ctx: RuleContext): ts.BinaryExpression | undefined {
  const t = ctx.ts;
  const callee = call.expression;
  if (!t.isPropertyAccessExpression(callee) || (callee.name.text !== "sort" && callee.name.text !== "toSorted")) return undefined;
  const fn = call.arguments[0];
  if (fn === undefined || (!t.isArrowFunction(fn) && !t.isFunctionExpression(fn))) return undefined;
  for (const r of returnedExpressions(fn, t)) {
    const e = skipValueWrappers(r, t);
    if (t.isBinaryExpression(e) && e.operatorToken.kind === t.SyntaxKind.MinusToken &&
      (isEastValueExpression(e.left, ctx) || isEastValueExpression(e.right, ctx))) {
      return e;
    }
  }
  return undefined;
}

// Host code handling DECODED East values (a `ValueTypeOf<…>` world: structs,
// variants, options, collections) must compare with `equalFor(T)` and order with
// `compareFor(T)` / `lessFor(T)`: `===` compares object identity (always false for
// two decoded structs, variants, DateTimes or Sets), `<` / `>` compare the wrong
// representation, and a comparator that subtracts is inconsistent over a `NaN`
// and rounds an Integer past 2^53. Code that does mean identity (a fold handing
// back the value it was given, a fast path ahead of `equalFor`) says so with
// `Object.is(a, b)`, which this rule leaves alone. Nothing else covers host-side
// code: the block rules only see East blocks.
export const noHostComparisonOnEastValues: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag ===/!==/</> and subtracting sort comparators on decoded East values — use equalFor(T) / compareFor(T).",
  check(node, ctx) {
    const t = ctx.ts;
    const sf = ctx.sourceFile;
    if (t.isCallExpression(node)) {
      if (!importsEastPackage(sf, t)) return;
      const subtraction = subtractingComparator(node, ctx);
      if (subtraction === undefined) return;
      const start = subtraction.getStart(sf);
      ctx.report({
        ruleName: NAME,
        code: CODE,
        start,
        length: subtraction.getEnd() - start,
        messageText:
          "A comparator that subtracts East values mis-orders them — a `NaN` makes it inconsistent and an Integer past 2^53 rounds. Order with `compareFor(T)` (`xs.sort((a, b) => compare(a.v, b.v))`).",
        category: "warning",
      });
      return;
    }
    if (!t.isBinaryExpression(node)) return;
    const k = t.SyntaxKind;
    const op = node.operatorToken.kind;
    const equality = op === k.EqualsEqualsEqualsToken || op === k.ExclamationEqualsEqualsToken || op === k.EqualsEqualsToken || op === k.ExclamationEqualsToken;
    const relational = op === k.LessThanToken || op === k.LessThanEqualsToken || op === k.GreaterThanToken || op === k.GreaterThanEqualsToken;
    if (!equality && !relational) return;
    if (!importsEastPackage(sf, t)) return;
    // `v === null` / `v !== undefined` are legitimate presence checks.
    if (isNullish(node.left, t) || isNullish(node.right, t)) return;

    const flagged = equality
      ? isEastObject(node.left, ctx) || isEastObject(node.right, ctx)
      : isEastValueShape(ctx.checker.getTypeAtLocation(node.left), ctx) || isEastValueShape(ctx.checker.getTypeAtLocation(node.right), ctx);
    if (!flagged) return;

    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText: equality
        ? "Host equality on a decoded East value compares object identity — two equal structs, variants, DateTimes or Sets are never `===`. Use `equalFor(T)(a, b)`, or `Object.is(a, b)` where you mean the same object."
        : "Host ordering on a decoded East value compares the wrong representation. Use `compareFor(T)` / `lessFor(T)` (e.g. `arr.sort(compareFor(T))`).",
      category: "warning",
    });
  },
};
