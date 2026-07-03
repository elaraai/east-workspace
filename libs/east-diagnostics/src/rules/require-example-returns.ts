/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, TsModule } from "../types.js";
import { resolvesToEastImport } from "../east-source.js";

const NAME = "require-example-returns";
const CODE = 990030;

// Output types for which omitting `returns` is the DOCUMENTED convention: a
// side-effect example (Null) and a UI example (component trees aren't asserted
// by value).
const RETURNS_EXEMPT = new Set(["NullType", "UIComponentType"]);

function propNamed(obj: ts.ObjectLiteralExpression, name: string, t: TsModule): ts.PropertyAssignment | undefined {
  for (const p of obj.properties) {
    if (t.isPropertyAssignment(p) && (t.isIdentifier(p.name) || t.isStringLiteralLike(p.name)) && p.name.text === name) {
      return p;
    }
  }
  return undefined;
}

// `example({ …, fn, inputs })` WITHOUT `returns` makes the harness run `fn` as
// a bare statement — the "test" false-passes forever, and the example ships to
// the plugin search index unverified. Omission is only legitimate for NullType
// (side-effect) and UIComponentType outputs.
export const requireExampleReturns: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "example() must declare `returns` unless the fn output is NullType/UIComponentType — omitting it false-passes the example's assertion.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node)) return;
    const callee = node.expression;
    if (!t.isIdentifier(callee) || callee.text !== "example") return;
    if (!resolvesToEastImport(callee, ctx.checker, t)) return;
    const arg = node.arguments[0];
    if (arg === undefined || !t.isObjectLiteralExpression(arg)) return;
    if (propNamed(arg, "returns", t) !== undefined) return;

    // The fn's declared output type (2nd East.function argument). A complex
    // output expression still needs `returns`; only the exempt identifiers pass.
    const fnProp = propNamed(arg, "fn", t);
    if (fnProp === undefined || !t.isCallExpression(fnProp.initializer)) return;
    const outputArg = fnProp.initializer.arguments[1];
    if (outputArg !== undefined && t.isIdentifier(outputArg) && RETURNS_EXEMPT.has(outputArg.text)) return;

    const sf = ctx.sourceFile;
    const start = callee.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: callee.getEnd() - start,
      messageText:
        "This `example()` has no `returns` — the harness runs `fn` as a bare statement and the assertion false-passes. Add the hand-verified `returns` value (omit it ONLY for NullType / UIComponentType outputs).",
      category: "warning",
    });
  },
};
