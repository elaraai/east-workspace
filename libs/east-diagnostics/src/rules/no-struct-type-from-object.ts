/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastFix, EastRule, RuleContext } from "../types.js";
import { importedNameOf, resolvesToEastImport } from "../east-source.js";

const NAME = "no-struct-type-from-object";
const CODE = 990037;

/** Is `name` an array index — the canonical decimal of an integer from 0 to
 * 2^32 − 2 — which a JavaScript object lists before every other name, in
 * numeric order, wherever it was written? */
function isArrayIndex(name: string): boolean {
  return /^(?:0|[1-9][0-9]{0,9})$/.test(name) && Number(name) <= 4294967294;
}

/** Is `call` East's `StructType` — imported by name (under an alias too), or a
 * member of an `@elaraai/*` namespace import? */
function isStructTypeCall(call: ts.CallExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  const callee = call.expression;
  if (t.isIdentifier(callee)) {
    return resolvesToEastImport(callee, ctx.checker, t) && importedNameOf(callee, ctx.checker, t) === "StructType";
  }
  return t.isPropertyAccessExpression(callee) && callee.name.text === "StructType" && t.isIdentifier(callee.expression)
    && resolvesToEastImport(callee.expression, ctx.checker, t);
}

/** `e` without the parentheses and assertions around it. */
function unwrapped(e: ts.Expression, t: RuleContext["ts"]): ts.Expression {
  while (t.isParenthesizedExpression(e) || t.isAsExpression(e) || t.isSatisfiesExpression(e) || t.isNonNullExpression(e) || t.isTypeAssertionExpression(e)) e = e.expression;
  return e;
}

/** Is `type` an array or a tuple — the list form `StructType` keeps in order? */
function isList(type: ts.Type, ctx: RuleContext): boolean {
  const constraint = type.isTypeParameter() ? ctx.checker.getBaseConstraintOfType(type) : type;
  return constraint !== undefined && (ctx.checker.isArrayType(constraint) || ctx.checker.isTupleType(constraint));
}

/** What `StructType`'s argument is: a list, or an object whose names are known
 * and none like an integer, which keeps its fields in their place (`ordered`);
 * an object naming a field like an integer (`index`, the name), which
 * `StructType` refuses; or an object whose names are known only at run time
 * (`object`), which may list one out of its place. */
type Fields = { kind: "ordered" } | { kind: "index"; name: string } | { kind: "object" };

const ORDERED: Fields = { kind: "ordered" };
const RUNTIME: Fields = { kind: "object" };

/** The fields of these names: `index` for the first like an integer, else `ordered`. */
function named(names: readonly string[]): Fields {
  const index = names.find(isArrayIndex);
  return index === undefined ? ORDERED : { kind: "index", name: index };
}

/** The names a computed key's type allows — a string or number literal, or a
 * union of them — or `undefined` for a wider type, a name known only at run time. */
function literalNames(type: ts.Type): string[] | undefined {
  const names: string[] = [];
  for (const member of type.isUnion() ? type.types : [type]) {
    if (member.isStringLiteral()) names.push(member.value);
    else if (member.isNumberLiteral()) names.push(String(member.value));
    else return undefined;
  }
  return names;
}

/** What one member of an object literal adds: a name written out, a computed
 * name by its type, a spread by what it spreads. */
function memberOf(member: ts.ObjectLiteralElementLike, ctx: RuleContext): Fields {
  const t = ctx.ts;
  if (t.isSpreadAssignment(member)) return fieldsOf(member.expression, ctx);
  const n = member.name;
  if (t.isIdentifier(n) || t.isStringLiteral(n) || t.isNumericLiteral(n) || t.isNoSubstitutionTemplateLiteral(n)) return named([n.text]);
  if (t.isComputedPropertyName(n)) {
    const names = literalNames(ctx.checker.getTypeAtLocation(n.expression));
    return names === undefined ? RUNTIME : named(names);
  }
  return RUNTIME;
}

/** What a value of `type` holds: an object whose type names every field holds
 * just those, in the order it was built; one with an index signature (a
 * `Record<string, …>`, `Object.fromEntries`'s result, a generic struct's
 * `fields`), names known only at run time. */
function fieldsOfType(type: ts.Type, ctx: RuleContext): Fields {
  for (const member of type.isUnion() ? type.types : [type]) {
    const constraint = member.isTypeParameter() ? ctx.checker.getBaseConstraintOfType(member) : member;
    if (constraint === undefined || ctx.checker.getIndexInfosOfType(constraint).length > 0) return RUNTIME;
    const fields = named(ctx.checker.getPropertiesOfType(constraint).map((p) => p.getName()));
    if (fields.kind !== "ordered") return fields;
  }
  return ORDERED;
}

function fieldsOf(arg: ts.Expression, ctx: RuleContext): Fields {
  const t = ctx.ts;
  const e = unwrapped(arg, t);
  if (t.isArrayLiteralExpression(e)) return ORDERED;
  if (t.isObjectLiteralExpression(e)) {
    // Member by member: a literal's type drops the index signature of what it
    // spreads, so `{ ...byName, x }` would look like `{ x }`
    let fields = ORDERED;
    for (const member of e.properties) {
      const part = memberOf(member, ctx);
      if (part.kind === "index") return part;
      if (part.kind === "object") fields = part;
    }
    return fields;
  }
  const type = ctx.checker.getTypeAtLocation(e);
  // `any` and `unknown` say nothing of what is passed
  if ((type.flags & (t.TypeFlags.Any | t.TypeFlags.Unknown)) !== 0) return ORDERED;
  if (isList(type, ctx)) return ORDERED;
  return fieldsOfType(type, ctx);
}

/** The fix for `StructType(Object.fromEntries(list))`: the list itself, which
 * `StructType` takes in its order. None for any other object. */
function entriesFix(arg: ts.Expression, ctx: RuleContext): EastFix | undefined {
  const t = ctx.ts;
  const e = unwrapped(arg, t);
  if (!t.isCallExpression(e) || e.arguments.length !== 1) return undefined;
  const callee = e.expression;
  if (!t.isPropertyAccessExpression(callee) || callee.name.text !== "fromEntries" || !t.isIdentifier(callee.expression) || callee.expression.text !== "Object") return undefined;
  const entries = e.arguments[0]!;
  if (!isList(ctx.checker.getTypeAtLocation(entries), ctx)) return undefined;
  const sf = ctx.sourceFile;
  const start = arg.getStart(sf);
  return {
    description: "Pass the entries as the field list",
    changes: [{ start, length: arg.getEnd() - start, newText: entries.getText(sf) }],
  };
}

// A struct's fields are in the order it declares them, and a JavaScript object
// cannot hold every order: it lists a name like an integer ("2024", "10") before
// every other, in numeric order, wherever it was written. So `StructType` takes
// an object only when its names are known and none is like an integer — written
// out, or named by its type (a const record, a declared struct's `fields`) —
// and refuses one that names such a field; a struct whose fields are known only
// at run time — another struct's, mapped or filtered, a row's columns, a
// query's keys — is declared with the list form, `StructType([[name, type], …])`,
// which keeps any order (#1574). `Object.entries` of a struct type's `fields`
// lists them in its order, so a mapped or filtered struct keeps it.
export const noStructTypeFromObject: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag StructType given an object whose fields are known only at run time, or naming a field like an integer — declare the fields as a list, StructType([[name, type], …]), which keeps their order.",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node) || node.arguments.length !== 1) return;
    if (!isStructTypeCall(node, ctx)) return;
    const arg = node.arguments[0]!;
    const fields = fieldsOf(arg, ctx);
    if (fields.kind === "ordered") return;
    const sf = ctx.sourceFile;
    const start = arg.getStart(sf);
    if (fields.kind === "index") {
      ctx.report({
        ruleName: NAME,
        code: CODE,
        start,
        length: arg.getEnd() - start,
        messageText:
          `\`StructType\` names a field "${fields.name}", like an integer: an object lists such a name before every other, wherever it is written, so \`StructType\` refuses it. Declare the fields as a list, in their order: \`StructType([[name, type], …])\`.`,
        category: "error",
      });
      return;
    }
    const fix = entriesFix(arg, ctx);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: arg.getEnd() - start,
      messageText:
        "`StructType` is given an object whose fields are known only at run time: an object lists a name like an integer (\"2024\") before every other, so it cannot keep such a field in its place, and `StructType` refuses one. Pass the fields as a list, in their order — `StructType(entries)`, `StructType(Object.entries(type.fields).map(…))` — which keeps any.",
      category: "warning",
      ...(fix === undefined ? {} : { fix }),
    });
  },
};
