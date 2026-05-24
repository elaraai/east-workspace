/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";
import type { RuleContext } from "./types.js";
import { isBlockBuilderType } from "./east-type.js";

export interface BlockBuilderCall {
  call: ts.CallExpression;
  method: "let" | "const";
  args: ts.NodeArray<ts.Expression>;
}

/** Match `<expr>.let(...)` / `<expr>.const(...)` where `<expr>` is an East
 * `BlockBuilder`. Confirmed through the checker, so an unrelated `.let` /
 * `.const` (lodash, a Map wrapper, …) never matches. */
export function matchBlockBuilderCall(
  node: ts.Node,
  ctx: RuleContext,
): BlockBuilderCall | undefined {
  const t = ctx.ts;
  if (!t.isCallExpression(node)) return undefined;
  const callee = node.expression;
  if (!t.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.name.text;
  if (method !== "let" && method !== "const") return undefined;

  if (!isBlockBuilderType(ctx.checker.getTypeAtLocation(callee.expression))) return undefined;

  return { call: node, method, args: node.arguments };
}