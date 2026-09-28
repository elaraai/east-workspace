/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { importsEastPackage } from "../east-source.js";

const NAME = "no-handrolled-variant";
const CODE = 990004;

const VARIANT_TYPE_NAMES = new Set(["variant", "some", "none", "option", "VariantExpr"]);

// Does `type` (or, for unions/intersections, any constituent) name an East
// variant / option type? A hand-rolled `{ type, value }` lacks the brand symbol
// East variants carry, so it drifts silently — flag it wherever a variant is
// contextually expected.
function expectsVariant(type: ts.Type): boolean {
  const stack: ts.Type[] = [type];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    const name = current.aliasSymbol?.name ?? current.symbol?.name;
    if (name !== undefined && VARIANT_TYPE_NAMES.has(name)) return true;
    if (current.isUnionOrIntersection()) stack.push(...current.types);
  }
  return false;
}

/** The plain or shorthand property of `node` called `name`, if it has one. */
function propertyNamed(
  node: ts.ObjectLiteralExpression,
  name: string,
  t: TsModule,
): ts.PropertyAssignment | ts.ShorthandPropertyAssignment | undefined {
  for (const p of node.properties) {
    if ((t.isPropertyAssignment(p) || t.isShorthandPropertyAssignment(p)) &&
      (t.isIdentifier(p.name) || t.isStringLiteral(p.name)) && p.name.text === name) {
      return p;
    }
  }
  return undefined;
}

/** Is `node` a variant's shape — exactly a String tag and a payload, `{ type: "Tag", value }`? */
function spelledAsVariant(node: ts.ObjectLiteralExpression, ctx: RuleContext): boolean {
  const t = ctx.ts;
  if (node.properties.length !== 2) return false;
  const tag = propertyNamed(node, "type", t);
  if (tag === undefined || propertyNamed(node, "value", t) === undefined) return false;
  const tagType = ctx.checker.getTypeAtLocation(t.isPropertyAssignment(tag) ? tag.initializer : tag.name);
  const members = tagType.isUnion() ? tagType.types : [tagType];
  return members.every((m) => (m.flags & t.TypeFlags.StringLike) !== 0);
}

/** Is `type` a published API's own type — every member an object type declared
 * in a package's declarations: a library's (a React input's props, a DOM type),
 * or a host-side type of East's own (`Resolution`, what `mergeWithResolutionsFor`
 * takes)? An `any`, a type parameter, or a `{ type; value }` shape this
 * project's source wrote is not. */
function publishedShape(type: ts.Type, t: TsModule): boolean {
  const members = (type.isUnion() ? type.types : [type])
    .filter((m) => (m.flags & (t.TypeFlags.Null | t.TypeFlags.Undefined)) === 0);
  return members.length > 0 && members.every((m) => {
    if ((m.flags & t.TypeFlags.Object) === 0) return false;
    const declarations = (m.aliasSymbol ?? m.symbol)?.declarations ?? [];
    return declarations.length > 0 && declarations.every((d) => d.getSourceFile().isDeclarationFile);
  });
}

// A variant built by hand — a plain `{ type, value }` object — lacks the symbol
// East's variants carry, so East's encoders, printers and comparers do not treat
// it as one, and it drifts silently from the East type it spells. Two spellings
// are caught:
//
// - any object spelling a `type` where a variant is expected;
// - in a file that uses East, an object that IS a variant's shape — exactly a
//   String tag and a payload — whatever slot it lands in: a fixture handed
//   through `unknown`, a test matcher, a hand-written `{ type; value }`
//   parameter, or no slot at all. Only a published API's own type declaring
//   `type` and `value` is something else: a library's (a React input's props),
//   or East's host-side `Resolution`, which `mergeWithResolutionsFor` takes.
export const noHandrolledVariant: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Disallow a variant built as a plain `{ type, value }` object literal — where a variant is expected, or anywhere in East source; use variant()/some()/none.",
  check(node: ts.Node, ctx: RuleContext) {
    const t = ctx.ts;
    if (!t.isObjectLiteralExpression(node)) return;
    // A hand-rolled variant spells its tag: an object with no `type` is some other
    // input the expected union admits (a factory's options object).
    if (propertyNamed(node, "type", t) === undefined) return;

    const contextualType = ctx.checker.getContextualType(node);
    const inVariantSlot = contextualType !== undefined && expectsVariant(contextualType);
    const byHand = !inVariantSlot && importsEastPackage(ctx.sourceFile, t) && spelledAsVariant(node, ctx) &&
      (contextualType === undefined || !publishedShape(contextualType, t));
    if (!inVariantSlot && !byHand) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText:
        'Hand-rolled variant: build with `variant("Tag", value)`, `some(value)`, or `none` from @elaraai/east — never a plain `{ type, value }` object literal, which lacks the symbol East\'s variants carry.',
      category: "warning",
    });
  },
};
