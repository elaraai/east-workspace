/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */
import type * as ts from "typescript";

// East expression classes all extend `Expr` and are named `<Kind>Expr`
// (IntegerExpr, VariantExpr, NullExpr, …); `ExprType<T>` resolves to one of
// them. Walk union/intersection members and base types so subclasses and
// aliases are caught.
export function isEastExprType(type: ts.Type): boolean {
  const seen = new Set<ts.Type>();
  const stack: ts.Type[] = [type];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);

    const name = current.aliasSymbol?.name ?? current.symbol?.name;
    if (name !== undefined && (name === "Expr" || name.endsWith("Expr"))) return true;

    if (current.isUnionOrIntersection()) stack.push(...current.types);
    const bases = current.getBaseTypes?.();
    if (bases !== undefined) stack.push(...bases);
  }
  return false;
}

export function isBlockBuilderType(type: ts.Type): boolean {
  const name = type.aliasSymbol?.name ?? type.symbol?.name;
  return name === "BlockBuilder";
}