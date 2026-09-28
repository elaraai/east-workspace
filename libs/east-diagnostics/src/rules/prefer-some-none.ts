/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext } from "../types.js";
import { resolvesToEastImport } from "../east-source.js";
import { isEastExprType } from "../east-type.js";

const NAME = "prefer-some-none";
const CODE = 990003;

/** The members of each type in `types`, a union's taken apart. */
function membersOf(types: readonly ts.Type[]): ts.Type[] {
  return types.flatMap((type) => (type.isUnion() ? type.types : [type]));
}

/** The string-literal values of `type` (a literal or a union of them). */
function literalsOf(type: ts.Type): string[] {
  return membersOf([type]).flatMap((m) => (m.isStringLiteral() ? [m.value] : []));
}

/** The variant-shaped members of `expected` (an object with a `value` and a
 * string-literal `type`), each with its tags. An `Expr` member (a factory's
 * authoring input) or a string shorthand is none. */
function variantMembers(expected: readonly ts.Type[], at: ts.Node, ctx: RuleContext): { member: ts.Type; tags: string[] }[] {
  const out: { member: ts.Type; tags: string[] }[] = [];
  for (const member of membersOf(expected)) {
    if (isEastExprType(member)) continue;
    if (ctx.checker.getPropertyOfType(member, "value") === undefined) continue;
    const tag = ctx.checker.getPropertyOfType(member, "type");
    if (tag === undefined) continue;
    out.push({ member, tags: literalsOf(ctx.checker.getTypeOfSymbolAtLocation(tag, at)) });
  }
  return out;
}

/** The types of property `name` across the members of `types`. */
function propertyTypes(types: readonly ts.Type[], name: string, at: ts.Node, ctx: RuleContext): ts.Type[] {
  return membersOf(types).flatMap((m) => {
    const prop = ctx.checker.getPropertyOfType(m, name);
    return prop === undefined ? [] : [ctx.checker.getTypeOfSymbolAtLocation(prop, at)];
  });
}

/** Does `type` say nothing about what is expected — `any`, `unknown`, a type
 * parameter still being inferred? */
function uninformative(type: ts.Type, ctx: RuleContext): boolean {
  const t = ctx.ts;
  return (type.flags & (t.TypeFlags.Any | t.TypeFlags.Unknown | t.TypeFlags.TypeParameter)) !== 0;
}

/** What `e` may be expected to be, as the types it could take — empty when
 * nothing says. The payload of the generic `variant(tag, payload)` gets no
 * context from TypeScript (its type is inferred from the payload itself), so
 * the expected type is read down from the enclosing value's instead: the payload
 * of an East `variant(tag, …)` is the `value` of each expected member with that
 * tag, and a property of an object literal is that property of the literal's
 * expected types. Anywhere else, TypeScript's own contextual type. */
function expectedTypes(e: ts.Expression, ctx: RuleContext, depth = 0): ts.Type[] {
  const t = ctx.ts;
  const parent = e.parent;
  if (depth < 8 && t.isPropertyAssignment(parent) && parent.initializer === e && (t.isIdentifier(parent.name) || t.isStringLiteral(parent.name))) {
    const literal = expectedTypes(parent.parent, ctx, depth + 1);
    if (literal.length > 0) return propertyTypes(literal, parent.name.text, e, ctx);
  }
  if (depth < 8 && t.isCallExpression(parent) && parent.arguments[1] === e && t.isIdentifier(parent.expression) &&
      parent.expression.text === "variant" && resolvesToEastImport(parent.expression, ctx.checker, t)) {
    const tag = parent.arguments[0];
    if (tag === undefined || !t.isStringLiteralLike(tag)) return [];
    const matches = variantMembers(expectedTypes(parent, ctx, depth + 1), e, ctx).filter((m) => m.tags.includes(tag.text));
    return propertyTypes(matches.map((m) => m.member), "value", e, ctx);
  }
  const direct = ctx.checker.getContextualType(e);
  return direct !== undefined && !uninformative(direct, ctx) ? [direct] : [];
}

// `some(x)` / `none` are the canonical Option constructors; `variant("some", x)`
// and `variant("none", null)` produce the same value but are discouraged. A
// variant whose type has other cases beside one named `none` or `some` (a text
// decoration's `none`, a path's `some` step) is not an Option, and keeps its
// `variant(…)`; the rule reads that type through the payloads the value sits in.
export const preferSomeNone: EastRule = {
  name: NAME,
  code: CODE,
  description: 'Prefer some()/none over variant("some", …)/variant("none", null) for an Option.',
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isCallExpression(node)) return;
    const callee = node.expression;
    if (!t.isIdentifier(callee) || callee.text !== "variant") return;
    // Only the East `variant` — an unrelated local function that happens to be
    // called `variant` (in a file that never touches East) is not our business.
    if (!resolvesToEastImport(callee, ctx.checker, t)) return;

    const first = node.arguments[0];
    if (first === undefined || !t.isStringLiteralLike(first)) return;
    const tag = first.text;
    if (tag !== "some" && tag !== "none") return;

    if (variantMembers(expectedTypes(node, ctx), node, ctx).some((m) => m.tags.some((other) => other !== "some" && other !== "none"))) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText:
        (tag === "some"
          ? 'Use `some(value)` instead of `variant("some", value)`.'
          : 'Use `none` instead of `variant("none", null)`.') +
        " If this is the case of a variant that is not an Option, type the value it builds (`ValueTypeOf<typeof T>`) so the case can be told apart.",
      category: "warning",
    });
  },
};
