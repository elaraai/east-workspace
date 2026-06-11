/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext } from "../types.js";
import { insideBlockScope } from "../block-scope.js";
import { isEastExprType } from "../east-type.js";

const NAME = "no-untracked-east-data";
const CODE = 990013;

// Inside an East block, data destined for an East-typed position (a factory
// `data` argument, a JSX `data={...}` prop — anything whose contextual type
// accepts an `Expr`) must be bound with `$.const` / `$.let`, not a bare JS
// `const` literal. A bare `const` isn't tracked by the block builder: it
// carries no East type at the binding, and consuming it twice inlines the
// literal twice in the IR. TS-side config (column defs, encodings, `days`
// string lists) has a non-Expr contextual type and is exempt naturally.

/** The plain-JS-literal initializer of `decl`, or undefined. */
function plainLiteralInitializer(
  decl: ts.VariableDeclaration,
  t: RuleContext["ts"],
): ts.Expression | undefined {
  const init = decl.initializer;
  if (init === undefined) return undefined;
  const unwrapped = t.isAsExpression(init) || t.isSatisfiesExpression(init) ? init.expression : init;
  if (t.isArrayLiteralExpression(unwrapped) || t.isObjectLiteralExpression(unwrapped)) {
    return unwrapped;
  }
  return undefined;
}

export const noUntrackedEastData: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Inside East blocks, bind data consumed in East-typed positions with $.const/$.let, not a bare JS const.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isIdentifier(node)) return;

    // Only identifiers in a consuming position: a call argument or a JSX
    // attribute expression value.
    const parent = node.parent;
    const isCallArg =
      parent !== undefined &&
      t.isCallExpression(parent) &&
      parent.expression !== node &&
      parent.arguments.some((arg) => arg === node);
    const isJsxValue = parent !== undefined && t.isJsxExpression(parent) && parent.expression === node;
    if (!isCallArg && !isJsxValue) return;
    if (!insideBlockScope(node, ctx)) return;

    // The position must be East-typed (its contextual type accepts an Expr).
    const contextual = ctx.checker.getContextualType(node);
    if (contextual === undefined || !isEastExprType(contextual)) return;

    // The identifier must resolve to a bare-const plain literal declared
    // inside an East block scope.
    const symbol = ctx.checker.getSymbolAtLocation(node);
    const decl = symbol?.valueDeclaration;
    if (decl === undefined || !t.isVariableDeclaration(decl)) return;
    if (plainLiteralInitializer(decl, t) === undefined) return;
    if (!insideBlockScope(decl, ctx)) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText:
        `Bare \`const ${node.text} = …\` isn't tracked by the East block builder. Bind East data with ` +
        "`$.const([...], Type)` (or `$.let`) so the binding carries its East type and is evaluated once.",
      category: "suggestion",
    });
  },
};
