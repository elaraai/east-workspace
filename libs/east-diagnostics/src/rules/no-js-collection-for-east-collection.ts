/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, RuleContext, TsModule } from "../types.js";
import { importsEastPackage } from "../east-source.js";
import { isGlobalBuiltin, landsInEastSlot } from "../east-value.js";

const NAME = "no-js-collection-for-east-collection";
const CODE = 990036;

/** The key type of the `Set<K>` / `Map<K, V>` `node` builds: its first type argument. */
function keyTypeOf(node: ts.NewExpression, ctx: RuleContext): ts.Type | undefined {
  const t = ctx.ts;
  const type = ctx.checker.getTypeAtLocation(node);
  if ((type.flags & t.TypeFlags.Object) === 0 || ((type as ts.ObjectType).objectFlags & t.ObjectFlags.Reference) === 0) return undefined;
  return ctx.checker.getTypeArguments(type as ts.TypeReference)[0];
}

/** Does JavaScript find a key of `type` by identity? It does for an object (a struct,
 * a variant, a DateTime's `Date`, a Blob's `Uint8Array`, a vector), and finds a
 * string, a number, a bigint, a boolean or `null` by value. A branded primitive
 * (`string & { brand }`) is a primitive at run time; `any`, `unknown` and a type
 * parameter say nothing. */
function keyedByIdentity(type: ts.Type, t: TsModule): boolean {
  const primitive = t.TypeFlags.StringLike | t.TypeFlags.NumberLike | t.TypeFlags.BigIntLike | t.TypeFlags.BooleanLike |
    t.TypeFlags.EnumLike | t.TypeFlags.ESSymbolLike | t.TypeFlags.Null | t.TypeFlags.Undefined;
  const members = type.isUnion() ? type.types : [type];
  return members.some((m) => {
    if (m.isIntersection()) return m.types.every((part) => (part.flags & primitive) === 0);
    return (m.flags & (t.TypeFlags.Object | t.TypeFlags.NonPrimitive)) !== 0;
  });
}

// East writes a Set or Dict keyed by strings, numbers, bigints, booleans or null
// as a JavaScript `Set` / `Map` (the `east` skill), and one keyed by structs,
// variants, DateTimes or Blobs as a `SortedSet` / `SortedMap` over
// `compareFor(K)`. JavaScript finds an object key by identity, so a plain
// collection of them never finds an equal key built elsewhere (the struct decoded
// from the store, the variant a callback returned) and holds two equal members
// side by side, where East finds keys by value. The order a plain collection
// keeps is East's to handle (#968), not this rule's.
export const noJsCollectionForEastCollection: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag new Set()/new Map() of object keys (structs, variants, DateTimes, Blobs) landing in an East Set or Dict — build SortedSet/SortedMap with compareFor(K).",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isNewExpression(node) || !t.isIdentifier(node.expression)) return;
    const kind = node.expression.text;
    if (kind !== "Set" && kind !== "Map") return;
    if (!importsEastPackage(ctx.sourceFile, t)) return;
    if (!isGlobalBuiltin(node.expression, ctx)) return;
    const key = keyTypeOf(node, ctx);
    if (key === undefined || !keyedByIdentity(key, t)) return;
    if (!landsInEastSlot(node, ctx)) return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText: kind === "Set"
        ? "A JavaScript `Set` finds a struct, variant, DateTime or Blob member by identity, so an equal value built elsewhere misses it. Build `new SortedSet(values, compareFor(K))`."
        : "A JavaScript `Map` finds a struct, variant, DateTime or Blob key by identity, so an equal key built elsewhere misses its entry. Build `new SortedMap(entries, compareFor(K))`.",
      category: "warning",
    });
  },
};
