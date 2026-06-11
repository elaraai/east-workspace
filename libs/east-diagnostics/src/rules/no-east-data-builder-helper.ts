/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { isBlockBuilderType } from "../east-type.js";

const NAME = "no-east-data-builder-helper";
const CODE = 990011;

const VALUE_CONSTRUCTORS = new Set(["variant", "some"]);

// Is `expr` a hand-built East value constructor — `variant(...)`, `some(...)`,
// `none`, or `East.value(...)`? These produce East data at TS evaluation time.
function isEastValueConstructor(expr: ts.Expression, t: TsModule): boolean {
  if (t.isCallExpression(expr)) {
    const callee = expr.expression;
    if (t.isIdentifier(callee) && VALUE_CONSTRUCTORS.has(callee.text)) return true;
    return (
      t.isPropertyAccessExpression(callee) &&
      t.isIdentifier(callee.expression) &&
      callee.expression.text === "East" &&
      callee.name.text === "value"
    );
  }
  return t.isIdentifier(expr) && expr.text === "none";
}

// The expressions a function/arrow returns, not descending into nested functions
// (a concise arrow body counts as its single return).
function returnExpressions(
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  t: TsModule,
): ts.Expression[] {
  if (fn.body === undefined) return [];
  if (!t.isBlock(fn.body)) return [fn.body];
  const out: ts.Expression[] = [];
  const visit = (n: ts.Node): void => {
    if (t.isFunctionDeclaration(n) || t.isFunctionExpression(n) || t.isArrowFunction(n)) return;
    if (t.isReturnStatement(n) && n.expression !== undefined) out.push(n.expression);
    t.forEachChild(n, visit);
  };
  t.forEachChild(fn.body, visit);
  return out;
}

function isBuilderFunction(
  fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
  ctx: RuleContext,
): boolean {
  const t = ctx.ts;
  // East block callbacks (`($, x) => …`) take a BlockBuilder first; they are East
  // callbacks, not TS-level data helpers — exclude them.
  const first = fn.parameters[0];
  if (first !== undefined && isBlockBuilderType(ctx.checker.getTypeAtLocation(first.name))) {
    return false;
  }
  const returns = returnExpressions(fn, t);
  return returns.length > 0 && returns.every((r) => isEastValueConstructor(r, t));
}

// A TS function/arrow whose whole job is to return a hand-built East value
// (`variant`/`some`/`none`/`East.value`) is an authoring-time macro: it expands
// inline at each call, it is not a real `East.function` (it cannot be serialized,
// recursed, or sent to the engine), and it hides the East value's shape behind a
// JS call. Inline the constructor at each call site (repetition is welcome) or,
// when reuse is genuine, make it a real `East.function`. UI-composition helpers
// returning JSX (`(l) => <Badge>{l}</Badge>`) and `East.function(…)` bindings are
// structurally distinct (their bodies are not value constructors) and never match.
export const noEastDataBuilderHelper: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag a TS helper whose only job is to return a hand-built East value (variant/some/none/East.value) — inline it or make it a real East.function.",
  check(node, ctx) {
    const t = ctx.ts;

    let fn: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined;
    let reportNode: ts.Node | undefined;
    if (t.isFunctionDeclaration(node) && node.body !== undefined) {
      fn = node;
      reportNode = node.name ?? node;
    } else if (
      t.isVariableDeclaration(node) &&
      node.initializer !== undefined &&
      (t.isArrowFunction(node.initializer) || t.isFunctionExpression(node.initializer))
    ) {
      fn = node.initializer;
      reportNode = node.name;
    }
    if (fn === undefined || reportNode === undefined) return;

    if (!isBuilderFunction(fn, ctx)) return;

    const sf = ctx.sourceFile;
    const start = reportNode.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: reportNode.getEnd() - start,
      messageText:
        "This helper just returns a hand-built East value (`variant`/`some`/`none`/`East.value`), so it is an authoring-time macro, not a real East function. Inline the constructor at each call site (repetition is welcome), or make it a real `East.function` if you need a reusable East computation.",
      category: "warning",
    });
  },
};
