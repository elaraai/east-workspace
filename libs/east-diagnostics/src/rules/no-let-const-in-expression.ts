/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule } from "../types.js";
import { matchBlockBuilderCall } from "../block-builder.js";

const NAME = "no-let-const-in-expression";
const CODE = 990008;

// `$.let` / `$.const` declare a variable in the block (a statement-like effect)
// and return the expression handle. The only correct position is the initializer
// of a JS `const`/`let`. Used anywhere else — as an argument (`$.if($.let(...))`),
// a chain target (`$.let(...).add(1n)`), or an operand — it buries a declaration
// inside an expression. Type-checks fine, so the checker won't catch it.
export const noLetConstInExpression: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Require $.let/$.const to be bound to a const; disallow using the result inline in an expression.",
  check(node, ctx) {
    const match = matchBlockBuilderCall(node, ctx);
    if (match === undefined) return;

    const t = ctx.ts;
    const call = match.call;

    // Walk out of wrapping parentheses.
    let current: ts.Node = call;
    let parent = current.parent;
    while (parent !== undefined && t.isParenthesizedExpression(parent)) {
      current = parent;
      parent = parent.parent;
    }
    if (parent === undefined) return;

    // Allow-list: `$.let`/`$.const` is only valid as a JS `const`/`let`
    // initializer, a bare statement, a `return`, or a concise arrow body. ANY
    // other position buries the declaration in an expression — a struct-field
    // value (`field: $.let(...)`), an array element, a call argument
    // (`$.if($.let(...))`), a chain target (`$.let(...).add(1n)`), an operator
    // operand, a ternary branch, etc. Flag everything that is not allowed.
    const allowed =
      (t.isVariableDeclaration(parent) && parent.initializer === current) ||
      (t.isExpressionStatement(parent) && parent.expression === current) ||
      (t.isReturnStatement(parent) && parent.expression === current) ||
      (t.isArrowFunction(parent) && parent.body === current);
    if (allowed) return;

    const sf = ctx.sourceFile;
    const start = call.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: call.getEnd() - start,
      messageText: `\`$.${match.method}\` declares a variable — bind it to a \`const\` first (\`const x = $.${match.method}(value, Type)\`), don't use the result inline (e.g. \`$.if($.let(...))\` or \`$.let(...).add(...)\`).`,
      category: "warning",
    });
  },
};