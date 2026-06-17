/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { matchBlockBuilderCall } from "../block-builder.js";

const NAME = "no-redundant-east-cast";
const CODE = 990001;

/** Is `expr` exactly an `East.value(...)` call (not `East.value(...).foo`)? */
function isEastValueCall(expr: ts.Expression, t: TsModule): expr is ts.CallExpression {
  if (!t.isCallExpression(expr)) return false;
  const callee = expr.expression;
  return (
    t.isPropertyAccessExpression(callee) &&
    t.isIdentifier(callee.expression) &&
    callee.expression.text === "East" &&
    callee.name.text === "value"
  );
}

function report(ctx: RuleContext, target: ts.Node, messageText: string, fixDescription: string, newText: string): void {
  const sf = ctx.sourceFile;
  const start = target.getStart(sf);
  const length = target.getEnd() - start;
  ctx.report({
    ruleName: NAME,
    code: CODE,
    start,
    length,
    messageText,
    category: "warning",
    fix: { description: fixDescription, changes: [{ start, length, newText }] },
  });
}

// `$.let` / `$.const` two-arg overload is `(<T>(expr: SubtypeExprOrValue<NoInfer<T>>, type: T) => ...)`:
// `NoInfer<T>` makes the East type argument drive inference, so any TS type info on
// the value is dead weight — a cast (`as …`/`<…>`), a constructor's generic
// arguments (`new Map<K, V>()`), or an `East.value(x, T)` wrapper (the East type
// belongs on `$.let`/`$.const`, not duplicated inside). Each restates a type the
// East argument already governs and can silently drift from it.
export const noRedundantEastCast: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Disallow TypeScript type info on the value of $.let/$.const that the East type argument already governs (a cast, `new Map<K,V>()` generics, or an `East.value(x,T)` wrapper).",
  check(node, ctx) {
    const match = matchBlockBuilderCall(node, ctx);
    if (match === undefined) return;
    const t = ctx.ts;
    const value = match.args[0];
    if (value === undefined) return;
    const sf = ctx.sourceFile;

    // Arm B — `East.value(x, T)` as the WHOLE first arg (not a sub-term like
    // `East.value(1.0).divide(x)`): the East type belongs on `$.let`/`$.const`.
    // Lift the value (and the type, from whichever of $.let / East.value carries
    // it) up so the binding reads `$.let(x, T)`.
    if (isEastValueCall(value, t)) {
      const inner = value.arguments[0];
      if (inner === undefined) return;
      const typeArg = match.args[1] ?? value.arguments[1];
      const receiverText = match.call.expression.getText(sf);
      const newText = `${receiverText}(${inner.getText(sf)}${typeArg !== undefined ? `, ${typeArg.getText(sf)}` : ""})`;
      report(
        ctx,
        match.call,
        `Redundant \`East.value(...)\` inside \`$.${match.method}\`: pass the value (and its East type) to \`$.${match.method}\` directly.`,
        "Lift the value and type out of East.value(...)",
        newText,
      );
      return;
    }

    // The remaining arms need the explicit East type argument present (the one-arg
    // overload infers from the value, where TS type info would matter).
    if (match.args.length < 2) return;

    // Existing arm — a TS cast on the value.
    let cast: ts.Expression | undefined;
    if (t.isAsExpression(value)) cast = value.expression;
    else if (t.isTypeAssertionExpression(value)) cast = value.expression;
    if (cast !== undefined) {
      report(
        ctx,
        value,
        `Redundant cast: \`$.${match.method}\` infers the value type from the East type argument; drop the \`as …\` on the value.`,
        "Remove redundant cast",
        cast.getText(sf),
      );
      return;
    }

    // Arm A — redundant constructor generics, `new Map<K, V>()` / `new Set<T>()`.
    if (t.isNewExpression(value) && value.typeArguments !== undefined && value.typeArguments.length > 0) {
      const ctorArgs = (value.arguments ?? []).map((a) => a.getText(sf)).join(", ");
      report(
        ctx,
        value,
        `Redundant type arguments: \`$.${match.method}\` infers the value type from the East type argument; drop the \`<…>\` on \`new ${value.expression.getText(sf)}\`.`,
        "Remove redundant constructor type arguments",
        `new ${value.expression.getText(sf)}(${ctorArgs})`,
      );
    }
  },
};
