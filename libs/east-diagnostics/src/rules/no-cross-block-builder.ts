/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext } from "../types.js";
import { isBlockBuilderType } from "../east-type.js";
import { isBlockBuilderCallback } from "../block-scope.js";
import { chainRootReceiver } from "../east-ir.js";

const NAME = "no-cross-block-builder";
const CODE = 990023;

/** The nearest enclosing BlockBuilder callback of `node`, or undefined. */
function nearestBlockCallback(node: ts.Node, ctx: RuleContext): ts.Node | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (isBlockBuilderCallback(cur, ctx)) return cur;
    cur = cur.parent;
  }
  return undefined;
}

/** Does any identifier in `call` (other than the builder root itself and
 * property names) resolve to a declaration whose nearest function-like scope
 * lies strictly BETWEEN `owner` and the call — i.e. an inner-callback binding
 * that will be out of scope where the outer builder emits? */
function referencesCrossedScope(call: ts.CallExpression, root: ts.Node, owner: ts.Node, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const isFnLike = (n: ts.Node): boolean =>
    t.isArrowFunction(n) || t.isFunctionExpression(n) || t.isFunctionDeclaration(n) || t.isMethodDeclaration(n);
  const enclosingFn = (n: ts.Node): ts.Node | undefined => {
    let cur: ts.Node | undefined = n.parent;
    while (cur !== undefined && !isFnLike(cur)) cur = cur.parent;
    return cur;
  };
  const contains = (outer: ts.Node, inner: ts.Node): boolean => outer.pos <= inner.pos && inner.end <= outer.end;

  let crossed = false;
  const visit = (n: ts.Node): void => {
    if (crossed) return;
    if (t.isIdentifier(n) && n !== root) {
      const p = n.parent;
      // Labels, not references: a property-access member name (`.let`), an
      // object-literal property NAME (`{ some: (_$, x) => … }` match arms — its
      // symbol's declaration is the PropertyAssignment inside the crossed arm),
      // a JSX attribute name. Shorthand `{ x }` IS a reference and stays.
      const isLabel =
        p !== undefined &&
        ((t.isPropertyAccessExpression(p) && p.name === n) ||
          (t.isPropertyAssignment(p) && p.name === n) ||
          (t.isJsxAttribute(p) && p.name === n));
      if (!isLabel) {
        const decl = ctx.checker.getSymbolAtLocation(n)?.valueDeclaration;
        if (decl !== undefined) {
          const declFn = enclosingFn(decl);
          if (declFn !== undefined && declFn !== owner && contains(owner, declFn) && contains(declFn, call)) {
            crossed = true;
            return;
          }
        }
      }
    }
    t.forEachChild(n, visit);
  };
  visit(call);
  return crossed;
}

// Every East block callback receives ITS OWN builder `$`; calling `$.let` /
// `$.const` / `$(…)` on an OUTER block's builder from inside a nested callback
// emits the binding into the outer block. When the emitted value references
// inner-callback bindings (`xs.map((_$, x) => { $.let(x.add(1n)) })` — the
// classic shadow-dodging shape) the binding lands where those values are out
// of scope: it type-checks (every `$` is a BlockBuilder) and breaks at East
// compile/run time. Hoisting a PURE constant via the outer `$`
// (`none: (_$) => $.const([], ArrayType(T))`) references nothing inner-scoped
// and is the established match-arm idiom — not flagged.
export const noCrossBlockBuilder: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Inside a nested East block callback, an outer-`$` emission referencing inner-scope values puts the binding where those values don't exist.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node)) return;
    const root = chainRootReceiver(node.expression, ctx);
    if (!t.isIdentifier(root)) return;
    if (!isBlockBuilderType(ctx.checker.getTypeAtLocation(root))) return;

    // Which callback OWNS this `$`? (Its declaration is that callback's parameter.)
    const sym = ctx.checker.getSymbolAtLocation(root);
    const decl = sym?.valueDeclaration;
    if (decl === undefined || !t.isParameter(decl)) return;
    const owner = decl.parent;
    if (!isBlockBuilderCallback(owner, ctx)) return;

    // The nearest enclosing block callback of the CALL must be that same owner.
    // (A plain TS closure between them doesn't open a new East block — walking
    // to the nearest BlockBuilder callback skips it, so capture through helper
    // closures resolves to the right block.)
    const nearest = nearestBlockCallback(node, ctx);
    if (nearest === undefined || nearest === owner) return;
    // Only a cross-scope REFERENCE breaks — a pure constant hoists harmlessly.
    if (!referencesCrossedScope(node, root, owner, ctx)) return;

    const sf = ctx.sourceFile;
    const start = root.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText:
        "This call uses an OUTER block's `$` inside a nested East callback while referencing inner-callback values — the binding is emitted into the outer block, where those values don't exist. Use the callback's own builder (name it `$`, not `_$`).",
      category: "error",
    });
  },
};
