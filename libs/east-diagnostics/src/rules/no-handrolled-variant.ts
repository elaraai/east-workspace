/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext } from "../types.js";

const NAME = "no-handrolled-variant";
const CODE = 990004;

const VARIANT_TYPE_NAMES = new Set(["variant", "some", "none", "option", "VariantExpr"]);

// Does `type` (or, for unions/intersections, any constituent) name an East
// variant / option type? A hand-rolled `{ type, value }` lacks the brand symbol
// East variants carry, so it drifts silently — flag it wherever a variant is
// contextually expected.
function expectsVariant(type: ts.Type): boolean {
  const stack: ts.Type[] = [type];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const name = current.aliasSymbol?.name ?? current.symbol?.name;
    if (name !== undefined && VARIANT_TYPE_NAMES.has(name)) return true;
    if (current.isUnionOrIntersection()) stack.push(...current.types);
  }
  return false;
}

export const noHandrolledVariant: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Disallow plain object literals where an East variant/option is expected; use variant()/some()/none.",
  check(node: ts.Node, ctx: RuleContext) {
    const t = ctx.ts;
    if (!t.isObjectLiteralExpression(node)) return;

    const contextualType = ctx.checker.getContextualType(node);
    if (contextualType === undefined || !expectsVariant(contextualType)) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText:
        'Hand-rolled variant: build with `variant("Tag", value)`, `some(value)`, or `none` from @elaraai/east — never a plain `{ type, value }` object literal.',
      category: "warning",
    });
  },
};