/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule } from "../types.js";
import { isEastExprType } from "../east-type.js";
import { matchBlockBuilderCall } from "../block-builder.js";
import { enclosingBlockScope } from "../block-scope.js";

const NAME = "no-reinlined-east-binding";
const CODE = 990010;

// An East `Expr` is a value tree, not a slot. Bound to a JS `const`/`let` and
// referenced more than once inside the same East block, it is *re-inlined* at
// each use — the tree is duplicated, so it is re-evaluated per use and (for
// mutable values) gets a fresh identity each time. `$.let`/`$.const` introduce
// a single block binding evaluated once and referenced by name, which is the
// only way to get single-evaluation + shared identity. So multi-use JS bindings
// of an `Expr` are an error, not a style nit.
//
// Scoped to the hazard: a single use is a harmless alias / single-pass argument,
// and inline composition (`Stack.VStack([A(), B(), …])`) never binds, so neither
// trips. Re-inlining only duplicates within one East block tree, so the count is
// bucketed per enclosing East block scope (an `East.function` body or, for JSX
// authoring, a `<Reactive>{$ => …}}` / `ui(…)` BlockBuilder callback).

export const noReinlinedEastBinding: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "An East Expr bound to a JS const/let and reused inside an East block is re-inlined per use — bind it once with $.let/$.const.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isVariableDeclaration(node)) return;
    if (!t.isIdentifier(node.name)) return;
    if (node.initializer === undefined) return;

    let init: ts.Expression = node.initializer;
    while (t.isParenthesizedExpression(init)) init = init.expression;

    // `$.let(...)` / `$.const(...)` is the correct form — never flag it.
    if (matchBlockBuilderCall(init, ctx) !== undefined) return;
    // Aliasing an existing binding (`const a = b`) re-inlines nothing; the root
    // binding, if unbound, is flagged at its own declaration.
    if (t.isIdentifier(init)) return;
    // Only Expr-typed bindings re-inline. Types (`StructType(...)`), plain JS
    // objects, callbacks held for a single handoff, etc. are fine.
    if (!isEastExprType(ctx.checker.getTypeAtLocation(init))) return;

    const declSymbol = ctx.checker.getSymbolAtLocation(node.name);
    if (declSymbol === undefined) return;

    const name = node.name.text;
    const perBody = new Map<ts.Node, number>();
    const visit = (n: ts.Node): void => {
      if (t.isIdentifier(n) && n !== node.name && n.text === name) {
        if (ctx.checker.getSymbolAtLocation(n) === declSymbol) {
          const body = enclosingBlockScope(n, ctx);
          if (body !== undefined) perBody.set(body, (perBody.get(body) ?? 0) + 1);
        }
      }
      t.forEachChild(n, visit);
    };
    visit(ctx.sourceFile);

    let maxInBody = 0;
    for (const count of perBody.values()) if (count > maxInBody) maxInBody = count;
    if (maxInBody < 2) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText:
        "This East expression is bound to a JS `const`/`let` and used more than once inside an East block, so it is re-inlined — and re-evaluated, with a fresh identity for mutable values — at each use. Bind it once with `$.const`/`$.let`.",
      category: "error",
    });
  },
};
