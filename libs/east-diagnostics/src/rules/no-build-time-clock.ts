/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, TsModule } from "../types.js";
import { importsEastPackage } from "../east-source.js";

const NAME = "no-build-time-clock";
const CODE = 990027;

/** Is `node` lexically inside any function-like scope? Module-scope clock reads
 * are the abuse; a platform `.implement((…) => Date.now())` body runs at
 * RUNTIME and is fine. */
function insideFunction(node: ts.Node, t: TsModule): boolean {
  let cur: ts.Node | undefined = node.parent;
  while (cur !== undefined) {
    if (
      t.isArrowFunction(cur) ||
      t.isFunctionExpression(cur) ||
      t.isFunctionDeclaration(cur) ||
      t.isMethodDeclaration(cur) ||
      t.isConstructorDeclaration(cur) ||
      t.isGetAccessorDeclaration(cur) ||
      t.isSetAccessorDeclaration(cur)
    ) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

// East/e3 source is compiled and DEPLOYED; reading the clock at module
// evaluation (`Date.now()`, argless `new Date()`) freezes the BUILD moment into
// the program — a seed of `new Date(Date.now() - 2h)` means "2 hours before the
// deploy", drifting meaningless afterwards. Author constant datetimes, or read
// time at runtime inside a task via the Time platform. (Complements
// `no-compile-time-seed-data`, which only inspects `e3.input` seed arguments.)
export const noBuildTimeClock: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag Date.now() / argless new Date() at module scope of East/e3 source — the build clock gets baked into the deployed program.",
  check(node, ctx) {
    const t = ctx.ts;
    let target: ts.Node | undefined;
    if (
      t.isCallExpression(node) &&
      t.isPropertyAccessExpression(node.expression) &&
      t.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "Date" &&
      node.expression.name.text === "now"
    ) {
      target = node;
    } else if (
      t.isNewExpression(node) &&
      t.isIdentifier(node.expression) &&
      node.expression.text === "Date" &&
      (node.arguments === undefined || node.arguments.length === 0)
    ) {
      target = node;
    }
    if (target === undefined) return;
    if (!importsEastPackage(ctx.sourceFile, t)) return;
    if (insideFunction(target, t)) return;

    const sf = ctx.sourceFile;
    const start = target.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: target.getEnd() - start,
      messageText:
        "Module-scope clock read in East/e3 source — this bakes the BUILD moment into the deployed program. Author a constant datetime (`new Date(\"2026-06-30T07:00:00Z\")`), or read time at runtime inside a task (the `Time` platform).",
      category: "warning",
    });
  },
};
