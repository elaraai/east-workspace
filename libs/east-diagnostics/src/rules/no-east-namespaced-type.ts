/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { EastRule } from "../types.js";

const NAME = "no-east-namespaced-type";
const CODE = 990005;

// East type constructors (IntegerType, ArrayType, …) are top-level exports, not
// members of the `East` namespace object. `East.IntegerType` is already a type
// error, but the native message dumps the entire `East` type; this gives a
// clear, actionable one.
export const noEastNamespacedType: EastRule = {
  name: NAME,
  code: CODE,
  description: "Disallow East.<X>Type member access; import the type directly from @elaraai/east.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isPropertyAccessExpression(node)) return;
    if (!t.isIdentifier(node.expression) || node.expression.text !== "East") return;
    const name = node.name.text;
    if (!name.endsWith("Type")) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText: `\`East.${name}\` is not a member of the East namespace — import \`${name}\` directly from @elaraai/east.`,
      category: "warning",
    });
  },
};