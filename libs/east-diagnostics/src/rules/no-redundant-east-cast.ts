/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule } from "../types.js";
import { matchBlockBuilderCall } from "../block-builder.js";

const NAME = "no-redundant-east-cast";
const CODE = 990001;

// `$.let` / `$.const` two-arg overload is `(<T>(expr: SubtypeExprOrValue<NoInfer<T>>, type: T) => ...)`:
// `NoInfer<T>` makes the East type argument drive inference, so a TS cast on the
// value is dead weight. (The one-arg overload infers from the value, where a
// cast *would* matter — hence we only fire when the type argument is present.)
export const noRedundantEastCast: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Disallow a TypeScript cast on the value argument of $.let/$.const when the East type argument is present (the type argument already drives inference).",
  check(node, ctx) {
    const match = matchBlockBuilderCall(node, ctx);
    if (match === undefined || match.args.length < 2) return;

    const t = ctx.ts;
    const value = match.args[0];
    if (value === undefined) return;

    let inner: ts.Expression | undefined;
    if (t.isAsExpression(value)) inner = value.expression;
    else if (t.isTypeAssertionExpression(value)) inner = value.expression;
    if (inner === undefined) return;

    const sf = ctx.sourceFile;
    const start = value.getStart(sf);
    const length = value.getEnd() - start;
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length,
      messageText: `Redundant cast: \`$.${match.method}\` infers the value type from the East type argument; drop the \`as …\` on the value.`,
      category: "warning",
      fix: {
        description: "Remove redundant cast",
        changes: [{ start, length, newText: inner.getText(sf) }],
      },
    });
  },
};