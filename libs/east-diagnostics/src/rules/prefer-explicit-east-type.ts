/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, TsModule } from "../types.js";
import { matchBlockBuilderCall } from "../block-builder.js";

const NAME = "prefer-explicit-east-type";
const CODE = 990002;

function isEmptyNewMapOrSet(node: ts.Expression, t: TsModule): boolean {
  if (!t.isNewExpression(node) || !t.isIdentifier(node.expression)) return false;
  const ctor = node.expression.text;
  if (ctor !== "Map" && ctor !== "Set") return false;
  return node.arguments === undefined || node.arguments.length === 0;
}

function isRawValueLiteral(node: ts.Expression, t: TsModule): boolean {
  return (
    t.isNumericLiteral(node) ||
    t.isBigIntLiteral(node) ||
    t.isStringLiteralLike(node) ||
    node.kind === t.SyntaxKind.TrueKeyword ||
    node.kind === t.SyntaxKind.FalseKeyword ||
    node.kind === t.SyntaxKind.NullKeyword ||
    t.isArrayLiteralExpression(node) ||
    t.isObjectLiteralExpression(node) ||
    t.isNewExpression(node)
  );
}

// The one-arg `$.let(x)` / `$.const(x)` form infers the East type from the JS
// value. That is fine when `x` is already an East expression (type fully
// determined), but for an under-determined literal — `[]`, `{}`, `new Map()` —
// the inferred type is `never`/empty and almost always wrong. Nudge toward the
// explicit two-arg form. Stays silent on East expressions so `$.let(arr.sum())`
// is not flagged.
export const preferExplicitEastType: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Encourage passing the East type as the second argument to $.let/$.const for raw JS values whose East type is under-determined.",
  check(node, ctx) {
    const match = matchBlockBuilderCall(node, ctx);
    if (match === undefined || match.args.length !== 1) return;

    const t = ctx.ts;
    const value = match.args[0];
    if (value === undefined) return;

    const underDetermined =
      (t.isArrayLiteralExpression(value) && value.elements.length === 0) ||
      (t.isObjectLiteralExpression(value) && value.properties.length === 0) ||
      isEmptyNewMapOrSet(value, t);

    const mode = ctx.options.preferExplicitEastType?.mode ?? "under-determined";
    const flag = underDetermined || (mode === "all-raw-values" && isRawValueLiteral(value, t));
    if (!flag) return;

    const sf = ctx.sourceFile;
    const start = value.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: value.getEnd() - start,
      messageText: `Provide the East type as the second argument to \`$.${match.method}\` — e.g. \`$.${match.method}([], ArrayType(FloatType))\` — to pin the value type; it is under-determined from the value alone.`,
      category: "suggestion",
    });
  },
};