/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext } from "../types.js";
import { importsEastPackage } from "../east-source.js";
import { isEastValueExpression, isGlobalBuiltin, jsPrintDiffers } from "../east-value.js";

const NAME = "no-host-print-of-east-values";
const CODE = 990033;

/** Methods that print their receiver the JavaScript way. */
const PRINTING_METHODS = new Set(["toString", "toISOString", "toJSON"]);

/** The CSS units a number is written in to size or turn an element. `%`, `s`,
 *  `ms` and `pt` read as prose too ("50%", "5 s"), so a number printed with
 *  those is still a print. */
const CSS_UNIT = /^(?:px|r?em|ch|fr|deg|turn|[sdl]?v(?:h|w|min|max))(?![A-Za-z])/;

/** Does `span` write a number as a CSS length (`${w}px`), which the browser
 *  reads and no person does? East's printer (`180.0px`) and the locale
 *  formatters (`1.234,5px`) are wrong there, and JavaScript's number is right. */
function writesCssLength(span: ts.TemplateSpan, ctx: RuleContext): boolean {
  if (!CSS_UNIT.test(span.literal.text)) return false;
  const type = ctx.checker.getTypeAtLocation(span.expression);
  const members = type.isUnion() ? type.types : [type];
  return members.every((m) => (m.flags & ctx.ts.TypeFlags.NumberLike) !== 0);
}

/** The value `node` prints the JavaScript way, if it prints one. */
function printedValue(node: ts.Node, ctx: RuleContext): ts.Expression[] {
  const t = ctx.ts;
  if (t.isCallExpression(node)) {
    const callee = node.expression;
    // `String(x)`
    if (t.isIdentifier(callee) && callee.text === "String" && node.arguments.length === 1 && isGlobalBuiltin(callee, ctx)) {
      return [node.arguments[0]!];
    }
    if (t.isPropertyAccessExpression(callee)) {
      // `JSON.stringify(x, …)`
      if (t.isIdentifier(callee.expression) && callee.expression.text === "JSON" && callee.name.text === "stringify" && node.arguments.length > 0 && isGlobalBuiltin(callee.expression, ctx)) {
        return [node.arguments[0]!];
      }
      // `x.toString()`, `x.toISOString()`, `x.toJSON()`
      if (PRINTING_METHODS.has(callee.name.text)) return [callee.expression];
    }
    return [];
  }
  // `` `…${x}…` `` — an untagged template prints each span, save a number
  // written as a CSS length.
  if (t.isTemplateExpression(node) && !t.isTaggedTemplateExpression(node.parent)) {
    return node.templateSpans.filter((span) => !writesCssLength(span, ctx)).map((span) => span.expression);
  }
  // `"…" + x`
  if (t.isBinaryExpression(node) && node.operatorToken.kind === t.SyntaxKind.PlusToken) {
    const stringy = (e: ts.Expression) => (ctx.checker.getTypeAtLocation(e).flags & t.TypeFlags.StringLike) !== 0;
    if (stringy(node.left)) return [node.right];
    if (stringy(node.right)) return [node.left];
  }
  return [];
}

// A decoded East value printed the JavaScript way prints something East never
// does: a Float `5` for East's `5.0` (and `0` for `-0.0`), a DateTime in local
// time or with a `Z`, a Blob as `1,2,3`, a struct or variant as `[object Object]`
// or JSON East cannot read back. East prints a value with `printFor(T)`; a display
// prints it in the viewer's language with the locale `Formatters`. A String, an
// Integer and a Boolean print the same either way, so they pass, and so does a
// number written as a CSS length, which styles an element rather than telling
// anyone anything.
export const noHostPrintOfEastValues: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag String()/toString()/toISOString()/JSON.stringify/template printing of a decoded East value JavaScript prints differently — use printFor(T) or the locale Formatters.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node) && !t.isTemplateExpression(node) && !t.isBinaryExpression(node)) return;
    if (!importsEastPackage(ctx.sourceFile, t)) return;
    for (const value of printedValue(node, ctx)) {
      if (!jsPrintDiffers(ctx.checker.getTypeAtLocation(value), t)) continue;
      if (!isEastValueExpression(value, ctx)) continue;
      const sf = ctx.sourceFile;
      const start = value.getStart(sf);
      ctx.report({
        ruleName: NAME,
        code: CODE,
        start,
        length: value.getEnd() - start,
        messageText:
          "JavaScript prints this East value its own way — `5` for East's `5.0`, a DateTime in local time or with a `Z`, `[object Object]` for a struct. Print it with `printFor(T)`, or in the viewer's language with the locale `Formatters`.",
        category: "warning",
      });
    }
  },
};
