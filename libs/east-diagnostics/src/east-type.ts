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

/** Walk `type` (union/intersection members included) asking `match` of each
 * constituent's alias/symbol name. */
function someTypeName(type: ts.Type, match: (name: string) => boolean): boolean {
  const seen = new Set<ts.Type>();
  const stack: ts.Type[] = [type];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    const name = current.aliasSymbol?.name ?? current.symbol?.name;
    if (name !== undefined && match(name)) return true;
    if (current.isUnionOrIntersection()) stack.push(...current.types);
  }
  return false;
}

// East platform-function definitions — `East.platform(…)` / `East.asyncPlatform(…)`
// and the generic pair — are callable TS values typed by the named aliases
// `PlatformDefinition` / `AsyncPlatformDefinition` / `GenericPlatformDefinition` /
// `AsyncGenericPlatformDefinition` (declared in @elaraai/east). CALLING one emits a
// single `Platform` IR node — an East-level call exactly like calling a bound
// `East.function`, not a host macro — so the host-vs-East rules must treat such a
// callee as East wherever it lives (a project's own platform stubs included).
// Name-keyed, like `isEastExprType`.
export function isEastPlatformDefinitionType(type: ts.Type): boolean {
  return someTypeName(type, (name) => name.endsWith("PlatformDefinition"));
}

// e3 program declarations: `e3.task` → `TaskDef`, `e3.input` → `DatasetDef`,
// `e3.function` → `FunctionDef`, … . A module-scope helper returning one of these
// (or a platform definition) is a DECLARATION factory — host-side composition of
// the program's structure, which the host language is allowed to do — not a value
// macro that hand-builds East IR.
const E3_DEFINITION_NAMES = new Set([
  "TaskDef",
  "DatasetDef",
  "DataTreeDef",
  "FunctionDef",
  "MutationDef",
  "RecordDef",
  "PackageDef",
]);

export function isEastDefinitionType(type: ts.Type): boolean {
  return someTypeName(
    type,
    (name) => E3_DEFINITION_NAMES.has(name) || name.endsWith("PlatformDefinition"),
  );
}