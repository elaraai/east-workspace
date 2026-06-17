/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { RuleContext } from "./types.js";
import { isBlockBuilderType } from "./east-type.js";
import { matchBlockBuilderCall } from "./block-builder.js";
import { isBlockBuilderCallback } from "./block-scope.js";

/**
 * Walk a call/member chain down to its base receiver — `a.b().c[d]` -> `a`. Used
 * to find the thing a chained expression is ultimately rooted on (e.g. to ask
 * whether a `$.if(...).else(...)` chain is rooted on the block builder `$`).
 */
export function chainRootReceiver(node: ts.Node, ctx: RuleContext): ts.Node {
  const t = ctx.ts;
  let root = node;
  for (;;) {
    if (t.isCallExpression(root)) root = root.expression;
    else if (t.isPropertyAccessExpression(root) || t.isElementAccessExpression(root)) {
      root = root.expression;
    } else {
      return root;
    }
  }
}

/**
 * Does `body` EMIT East IR into the enclosing block — i.e. contain a call rooted
 * on the block builder `$` (`$.let`/`$.const`/`$(…)`/`$.assign`/`$.if`/…)? This
 * is the discriminator between a host loop that BUILDS East IR (abuse) and one
 * that only assembles a plain JS array/object (legitimate — the array is bound
 * once afterwards). It deliberately does NOT count mere East-`Expr` reads
 * (`p.x.get(k)` inside a `jsArray.push({...})`), and does not descend into a
 * nested East block callback (`data.map(($, x) => …)`) — that is its own scope.
 */
export function bodyBuildsEastIr(body: ts.Node, ctx: RuleContext): boolean {
  const t = ctx.ts;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    // A nested East block callback (`($, x) => …`) is its own scope — emissions
    // inside it belong to that East collection op, not to the host loop.
    if (isBlockBuilderCallback(n, ctx)) return;
    if (t.isCallExpression(n)) {
      // `$.let(...)` / `$.const(...)`, or anything rooted on the builder `$`.
      if (
        matchBlockBuilderCall(n, ctx) !== undefined ||
        isBlockBuilderType(ctx.checker.getTypeAtLocation(chainRootReceiver(n.expression, ctx)))
      ) {
        found = true;
        return;
      }
    }
    t.forEachChild(n, visit);
  };
  visit(body);
  return found;
}
