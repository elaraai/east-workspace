/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext } from "../types.js";
import { importsEastPackage } from "../east-source.js";
import { isGlobalBuiltin, landsInEastSlot } from "../east-value.js";

const NAME = "no-host-parse-to-east-values";
const CODE = 990034;

/** Global functions that read text into a JavaScript value. */
const PARSERS = new Set(["BigInt", "Number", "parseFloat", "parseInt"]);

/** Is `e` text? */
function isText(e: ts.Expression, ctx: RuleContext): boolean {
  return (ctx.checker.getTypeAtLocation(e).flags & ctx.ts.TypeFlags.StringLike) !== 0;
}

/** The text of a string literal, or `undefined` for text computed at run time. */
function literalText(e: ts.Expression, t: RuleContext["ts"]): string | undefined {
  return t.isStringLiteral(e) || t.isNoSubstitutionTemplateLiteral(e) ? e.text : undefined;
}

/** A date and time with no zone — the one literal JavaScript reads in local time. */
const ZONELESS_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/** Does `node` read text the JavaScript way — wrongly for East? Text written in
 * the source is its author's to check, save a zoneless date-time handed to
 * `new Date` / `Date.parse`, which reads it in local time. */
function parsesText(node: ts.Node, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const misread = (text: ts.Expression, date: boolean): boolean => {
    if (!isText(text, ctx)) return false;
    const literal = literalText(text, t);
    return literal === undefined || (date && ZONELESS_DATE_TIME.test(literal));
  };
  if (t.isCallExpression(node)) {
    const callee = node.expression;
    const text = node.arguments[0];
    if (text === undefined) return false;
    if (t.isIdentifier(callee)) return PARSERS.has(callee.text) && isGlobalBuiltin(callee, ctx) && misread(text, false);
    // `JSON.parse(s)`, `Date.parse(s)`
    if (!t.isPropertyAccessExpression(callee) || !t.isIdentifier(callee.expression) || !isGlobalBuiltin(callee.expression, ctx)) return false;
    if (callee.expression.text === "JSON" && callee.name.text === "parse") return misread(text, false);
    if (callee.expression.text === "Date" && callee.name.text === "parse") return misread(text, true);
    return false;
  }
  // `new Date(s)`
  if (t.isNewExpression(node) && t.isIdentifier(node.expression) && node.expression.text === "Date") {
    const text = node.arguments?.[0];
    return node.arguments?.length === 1 && text !== undefined && isGlobalBuiltin(node.expression, ctx) && misread(text, true);
  }
  return false;
}

// Text read into an East value by a JavaScript parser is read wrongly: `BigInt("")`
// is 0, `BigInt("0x10")` is 16 and `BigInt` takes values past 64 bits; `Number`
// and `parseFloat` read `""` as 0 and stop at the first bad character;
// `new Date(text)` reads a zoneless instant in local time. East reads text with
// `parseFor(T)` — or a pattern with East's datetime format — and says whether it
// succeeded. Flagged where the value lands in an East slot: an East function
// value's argument, an East API's, or a field of a decoded East struct.
export const noHostParseToEastValues: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag BigInt()/Number()/parseFloat()/parseInt()/JSON.parse()/new Date() reading text into an East slot — use parseFor(T) or East's datetime format.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node) && !t.isNewExpression(node)) return;
    if (!importsEastPackage(ctx.sourceFile, t)) return;
    if (!parsesText(node, ctx)) return;
    if (!landsInEastSlot(node as ts.Expression, ctx)) return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText:
        "A JavaScript parser reads this text into an East value wrongly — `BigInt(\"\")` is 0, `BigInt(\"0x10\")` is 16, `new Date(text)` reads local time. Read it with `parseFor(T)` (or East's datetime format) and act on its `success`.",
      category: "warning",
    });
  },
};
