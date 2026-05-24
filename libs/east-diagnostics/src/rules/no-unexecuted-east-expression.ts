/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule } from "../types.js";
import { isEastExprType, isBlockBuilderType } from "../east-type.js";

const NAME = "no-unexecuted-east-expression";
const CODE = 990009;

// A bare expression statement whose value is an East `Expr` is dead: East
// expressions are pure values, so unless executed with `$( … )` or bound with
// `$.let`/`$.const`, the statement has no effect. Catches both calling an
// effectful function without `$()` (`log(msg);`) and `East.value(x);` standing
// alone. The `$( … )` / `$.x( … )` execution forms return `void`, and are
// excluded explicitly so renamed builders never false-positive.
export const noUnexecutedEastExpression: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag a bare East expression statement that is never executed with $() or bound — it has no effect.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isExpressionStatement(node)) return;
    const expr = node.expression;

    // Exclude any statement rooted in the block builder `$`: `$(...)`, `$.if(...)`,
    // chained `$.if(...).else(...)`, `$.try(...).catch(...)`, etc. Walk down the
    // call/member chain to its base receiver and check that.
    let root: ts.Node = expr;
    for (;;) {
      if (t.isCallExpression(root)) {
        root = root.expression;
      } else if (t.isPropertyAccessExpression(root) || t.isElementAccessExpression(root)) {
        root = root.expression;
      } else {
        break;
      }
    }
    if (isBlockBuilderType(ctx.checker.getTypeAtLocation(root))) return;

    if (!isEastExprType(ctx.checker.getTypeAtLocation(expr))) return;

    const sf = ctx.sourceFile;
    const start = expr.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: expr.getEnd() - start,
      messageText:
        "This East expression is never executed or bound, so it has no effect. Wrap it in `$( … )` to run it for its effect, or bind it with `$.let` / `$.const`.",
      category: "warning",
    });
  },
};