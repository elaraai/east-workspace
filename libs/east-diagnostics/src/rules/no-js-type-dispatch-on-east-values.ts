/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type { EastRule } from "../types.js";
import { importsEastPackage } from "../east-source.js";
import { isEastValueExpression } from "../east-value.js";

const NAME = "no-js-type-dispatch-on-east-values";
const CODE = 990035;

// `typeof` and `instanceof` ask JavaScript what a decoded East value is, and the
// answer loses its East type: an Integer and a Float are `bigint` and `number` only
// by accident of representation, every struct and variant is an `object`, and a
// Set and a Dict are whatever class built them. Dispatch on the value's East type
// — `isValueOf(v, T)`, or the static type it already has — or on its variant tag
// (`v.type`), which TypeScript narrows.
export const noJsTypeDispatchOnEastValues: EastRule = {
  name: NAME,
  code: CODE,
  description:
    "Flag typeof / instanceof on a decoded East value — dispatch on its East type (isValueOf) or its variant tag.",
  check(node, ctx) {
    const t = ctx.ts;
    let target;
    if (t.isTypeOfExpression(node)) target = node.expression;
    else if (t.isBinaryExpression(node) && node.operatorToken.kind === t.SyntaxKind.InstanceOfKeyword) target = node.left;
    if (target === undefined) return;
    if (!importsEastPackage(ctx.sourceFile, t)) return;
    if (!isEastValueExpression(target, ctx)) return;
    const sf = ctx.sourceFile;
    const start = node.getStart(sf);
    ctx.report({
      ruleName: NAME,
      code: CODE,
      start,
      length: node.getEnd() - start,
      messageText:
        "`typeof` / `instanceof` asks JavaScript what this East value is, and loses its East type. Dispatch on its East type (`isValueOf(v, T)`, or the type it already has) or on its variant tag (`v.type`).",
      category: "warning",
    });
  },
};
