/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, TsModule } from "../types.js";

const NAME = "prefer-let-const-over-east-value";
const CODE = 990006;

function insideEastFunctionBody(node: ts.Node, t: TsModule): boolean {
  let current = node.parent;
  while (current !== undefined) {
    if (t.isCallExpression(current)) {
      const callee = current.expression;
      if (
        t.isPropertyAccessExpression(callee) &&
        t.isIdentifier(callee.expression) &&
        callee.expression.text === "East" &&
        (callee.name.text === "function" || callee.name.text === "asyncFunction")
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

// Inside an East.function block, bind block-local values with $.let / $.const
// (which carry the East type at the call site). Both `const xs = East.value(...)`
// and `return East.value(...)` erase the type there — bind with the East type
// and return the variable instead. The third form is a callback's concise-arrow
// body (`hits.map(($, r) => East.value({…}, T))`): the callback's expected
// element type already supplies `T`, so the wrapper is redundant — return the
// plain value. A bare `East.value(x)` as a method argument (wrapping an external
// constant, no contextual type) stays valid.
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
    if (!insideEastFunctionBody(node, t)) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    const inner = node.arguments[0];
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText: asCallbackBody
        ? "Don't wrap a callback's return in `East.value(...)` — the callback's expected element type already supplies the East type. Return the plain value."
        : asReturn
          ? "Don't `return East.value(...)` — it erases the East type. Bind the value with `$.let`/`$.const` (passing the East type) and return that variable."
          : "Inside an East.function block, declare with `$.const(value, Type)` / `$.let(value, Type)` instead of `East.value(...)`, which erases the East type at the call site.",
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