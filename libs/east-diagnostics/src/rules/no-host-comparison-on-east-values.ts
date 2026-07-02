/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { EastRule, TsModule } from "../types.js";
import { importsEastPackage } from "../east-source.js";

const NAME = "no-host-comparison-on-east-values";
const CODE = 990029;

// The DECODED-value shapes whose host comparison is broken: variants/options
// (tagged structs — `===` is reference equality, always false for two decoded
// values) and the sorted containers (no meaningful `<`). Same name-keyed
// recognition as `no-handrolled-variant`.
const VALUE_SHAPE_NAMES = new Set(["variant", "option", "SortedMap", "SortedSet"]);

function isEastValueShapeType(type: ts.Type): boolean {
  const seen = new Set<ts.Type>();
  const stack: ts.Type[] = [type];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    const name = current.aliasSymbol?.name ?? current.symbol?.name;
    if (name !== undefined && VALUE_SHAPE_NAMES.has(name)) return true;
    if (current.isUnionOrIntersection()) stack.push(...current.types);
  }
  return false;
}

function isNullish(e: ts.Expression, t: TsModule): boolean {
  return e.kind === t.SyntaxKind.NullKeyword || (t.isIdentifier(e) && e.text === "undefined");
}

// Host code handling DECODED East values (a `ValueTypeOf<…>` world: variants,
// options, SortedMap/SortedSet) must compare with `equalFor(T)` / order with
// `compareFor(T)`/`lessFor(T)` — `===` compares object identity (always false
// for two decoded variants) and `<`/`>` compare the wrong representation.
// Nothing else covers host-side code: the block rules only see East blocks.
export const noHostComparisonOnEastValues: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag ===/!==/</> on decoded East values (variants, options, SortedMap/SortedSet) — use equalFor(T) / compareFor(T).",
  check(node, ctx) {
    const t = ctx.ts;
    if (!t.isBinaryExpression(node)) return;
    const k = t.SyntaxKind;
    const op = node.operatorToken.kind;
    const equality = op === k.EqualsEqualsEqualsToken || op === k.ExclamationEqualsEqualsToken || op === k.EqualsEqualsToken || op === k.ExclamationEqualsToken;
    const relational = op === k.LessThanToken || op === k.LessThanEqualsToken || op === k.GreaterThanToken || op === k.GreaterThanEqualsToken;
    if (!equality && !relational) return;
    if (!importsEastPackage(ctx.sourceFile, t)) return;
    // `v === null` / `v !== undefined` are legitimate presence checks.
    if (isNullish(node.left, t) || isNullish(node.right, t)) return;

    const leftShaped = isEastValueShapeType(ctx.checker.getTypeAtLocation(node.left));
    const rightShaped = isEastValueShapeType(ctx.checker.getTypeAtLocation(node.right));
    if (!leftShaped && !rightShaped) return;

    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText: equality
        ? "Host equality on a decoded East value compares object identity — two equal variants are never `===`. Use `equalFor(T)(a, b)`."
        : "Host ordering on a decoded East value compares the wrong representation. Use `compareFor(T)` / `lessFor(T)` (e.g. `arr.sort(compareFor(T))`).",
      category: "warning",
    });
  },
};
