/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, TsModule } from "../types.js";
import { insideBlockScope } from "../block-scope.js";

const NAME = "prefer-let-const-over-east-value";
const CODE = 990006;

// Inside an East block, bind block-local values with $.let / $.const
// (which carry the East type at the call site). Both `const xs = East.value(...)`
// and `return East.value(...)` erase the type there — bind with the East type
// and return the variable instead. The third form is a callback's concise-arrow
// body (`hits.map(($, r) => East.value({…}, T))`): the callback's expected
// element type already supplies `T`, so the wrapper is redundant — return the
// plain value. A bare `East.value(x)` as a method argument (wrapping an external
// constant, no contextual type) stays valid — and so does a RETURNED
// `East.value(v, T)` whose `T` is load-bearing: a callback's type is inferred
// from what it returns, and `none`, an empty collection, a `variant(...)` or a
// `some(...)` (alone it builds a one-case variant, not an Option) have no type
// of their own there (a printed module spells them so).

/** Whether `T` in `East.value(v, T)` is load-bearing for `v`: `none`, an empty
 * `[]` / `new Map()` / `new Set()`, a `variant(...)` or a `some(...)` anywhere
 * inside `v`. */
function typeIsLoadBearing(value: ts.Expression, t: TsModule): boolean {
  let found = false;
  const emptyArray = (n: ts.Node | undefined): boolean => n !== undefined && t.isArrayLiteralExpression(n) && n.elements.length === 0;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (t.isIdentifier(n) && n.text === "none") found = true;
    else if (emptyArray(n)) found = true;
    else if (t.isNewExpression(n) && t.isIdentifier(n.expression) && (n.expression.text === "Map" || n.expression.text === "Set")
      && (n.arguments === undefined || n.arguments.length === 0 || emptyArray(n.arguments[0]))) found = true;
    else if (t.isCallExpression(n) && t.isIdentifier(n.expression) && (n.expression.text === "variant" || n.expression.text === "some")) found = true;
    else t.forEachChild(n, visit);
  };
  visit(value);
  return found;
}

export const preferLetConstOverEastValue: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Inside East.function blocks, bind with $.let/$.const (and return that) rather than East.value().",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node)) return;
    const callee = node.expression;
    if (!t.isPropertyAccessExpression(callee)) return;
    if (!t.isIdentifier(callee.expression) || callee.expression.text !== "East") return;
    if (callee.name.text !== "value") return;

    const parent = node.parent;
    const asDeclaration =
      parent !== undefined && t.isVariableDeclaration(parent) && parent.initializer === node;
    const asReturn =
      parent !== undefined && t.isReturnStatement(parent) && parent.expression === node;
    // A concise-arrow body that is itself a callback argument: `.map(($, r) =>
    // East.value({…}, T))`. The callback's expected type supplies `T`, so the
    // wrapper is redundant. A free arrow assigned to a variable (no contextual
    // East type) is excluded — there the type argument is load-bearing.
    const asCallbackBody =
      parent !== undefined &&
      t.isArrowFunction(parent) &&
      parent.body === node &&
      parent.parent !== undefined &&
      t.isCallExpression(parent.parent) &&
      parent.parent.arguments.some((arg) => arg === parent);
    if (!asDeclaration && !asReturn && !asCallbackBody) return;
    if (!insideBlockScope(node, ctx)) return;
    const inner = node.arguments[0];
    // returned with a type the value cannot supply itself: the only spelling
    if ((asReturn || asCallbackBody) && node.arguments.length >= 2 && inner !== undefined && typeIsLoadBearing(inner, t)) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText: asCallbackBody
        ? "Don't wrap a callback's return in `East.value(...)` — the callback's expected element type already supplies the East type. Return the plain value."
        : asReturn
          ? "Don't `return East.value(...)` — it erases the East type. Bind the value with `$.let`/`$.const` (passing the East type) and return that variable."
          : "Inside an East block, declare with `$.const(value, Type)` / `$.let(value, Type)` instead of `East.value(...)`, which erases the East type at the call site.",
      category: "suggestion",
      ...(asCallbackBody && inner !== undefined
        ? {
            fix: {
              description: "Return the plain value (drop the redundant East.value wrapper)",
              changes: [
                { start, length: node.getEnd() - start, newText: inner.getText(sf) },
              ],
            },
          }
        : {}),
    });
  },
};