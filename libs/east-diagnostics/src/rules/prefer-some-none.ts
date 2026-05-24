/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { EastRule } from "../types.js";

const NAME = "prefer-some-none";
const CODE = 990003;

// `some(x)` / `none` are the canonical Option constructors; `variant("some", x)`
// and `variant("none", null)` produce the same value but are discouraged.
export const preferSomeNone: EastRule = {
  name: NAME,
  code: CODE,
  description: 'Prefer some()/none over variant("some", …)/variant("none", null).',
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node)) return;
    const callee = node.expression;
    if (!t.isIdentifier(callee) || callee.text !== "variant") return;

    const first = node.arguments[0];
    if (first === undefined || !t.isStringLiteralLike(first)) return;
    const tag = first.text;
    if (tag !== "some" && tag !== "none") return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText:
        tag === "some"
          ? 'Use `some(value)` instead of `variant("some", value)`.'
          : 'Use `none` instead of `variant("none", null)`.',
      category: "warning",
    });
  },
};