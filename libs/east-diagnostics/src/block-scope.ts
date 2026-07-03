/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { RuleContext, TsModule } from "./types.js";
import { isBlockBuilderType } from "./east-type.js";

/** `East.function(...)` / `East.asyncFunction(...)` — the classic East block root. */
function isEastFunctionCall(node: ts.Node, t: TsModule): node is ts.CallExpression {
  if (!t.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    t.isPropertyAccessExpression(callee) &&
    t.isIdentifier(callee.expression) &&
    callee.expression.text === "East" &&
    (callee.name.text === "function" || callee.name.text === "asyncFunction")
  );
}

/** True for an arrow/function whose first parameter is an East `BlockBuilder` —
 * the shape of every East block callback: `East.function`'s `$ => …`, the JSX
 * `<Reactive>{$ => …}}`, `ui(…, $ => …)`, a `.map(($, x) => …)` body. Keying on
 * the parameter type (not the wrapping function's name) makes the check work for
 * JSX authoring forms that have no `East.function` wrapper at all. */
export function isBlockBuilderCallback(node: ts.Node, ctx: RuleContext): boolean {
  const t = ctx.ts;
  if (!t.isArrowFunction(node) && !t.isFunctionExpression(node)) return false;
  const first = node.parameters[0];
  if (first === undefined) return false;
  return isBlockBuilderType(ctx.checker.getTypeAtLocation(first.name));
}

/**
 * The outermost enclosing East block scope of `node` — an `East.function` call
 * or a `BlockBuilder`-parameter callback — or `undefined` if there is none.
 *
 * Block-scoped rules used to look only for an enclosing `East.function`; East UI
 * authored as `<Reactive>{$ => …}}` or `ui(…)` has a `BlockBuilder` `$` with no
 * such wrapper, so those rules went silent inside it. Rooting on the BlockBuilder
 * callback restores coverage while still bucketing `East.function`-wrapped code
 * at the `East.function` call (it is the outermost scope, so the bucket key is
 * unchanged for existing code).
 */
export function enclosingBlockScope(node: ts.Node, ctx: RuleContext): ts.Node | undefined {
  const t = ctx.ts;
  let outermost: ts.Node | undefined;
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (isEastFunctionCall(current, t) || isBlockBuilderCallback(current, ctx)) {
      outermost = current;
    }
    current = current.parent;
  }
  return outermost;
}

/** Is `node` inside an East block scope (`East.function` body or BlockBuilder callback)? */
export function insideBlockScope(node: ts.Node, ctx: RuleContext): boolean {
  return enclosingBlockScope(node, ctx) !== undefined;
}

/** Is `node` (transitively) inside a `<Reactive>` element or a `Reactive.Root(…)`
 * factory call — i.e. inside a reactive re-render scope? */
export function insideReactive(node: ts.Node, t: TsModule): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (t.isJsxElement(cur) && cur.openingElement.tagName.getText().endsWith("Reactive")) return true;
    if (t.isJsxSelfClosingElement(cur) && cur.tagName.getText().endsWith("Reactive")) return true;
    if (t.isCallExpression(cur)) {
      const callee = cur.expression;
      if (t.isPropertyAccessExpression(callee) && t.isIdentifier(callee.expression) && callee.expression.text === "Reactive") {
        return true;
      }
    }
    cur = cur.parent;
  }
  return false;
}
